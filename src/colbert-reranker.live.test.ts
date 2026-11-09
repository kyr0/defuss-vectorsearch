import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Tokenizer } from "@huggingface/tokenizers";
import { tokenIds } from "./colbert-reranker.js";
import { createColbertReranker, fuseRanks, maxSim, MOEDERNCOLBERT_MODELS, rankEncoded, type ColbertModel } from "./onnx.js";

// Assets come from `make setup` (scripts/download-model.ts), already checked against the pinned SHA-256.
const repoName = (model: ColbertModel) => MOEDERNCOLBERT_MODELS[model].id.split("/")[1]!;
const modelDir = (model: ColbertModel) => new URL(`../public/models/${repoName(model)}/`, import.meta.url);
const loadFileFor = (model: ColbertModel) => async (name: string) => new Uint8Array(await readFile(new URL(name, modelDir(model))));

interface Reference {
  queries: string[];
  documents: string[];
  exact_tolerance: { token: number; score: number };
  precisions: Record<string, { document_token_counts: number[]; scores: number[][] }>;
}
const reference = async (model: ColbertModel) =>
  JSON.parse(await readFile(new URL(`../fixtures/moederncolbert-${model}-reference.json`, import.meta.url), "utf8")) as Reference;
const top1 = (row: number[]) => row.indexOf(Math.max(...row));

// The pinned q8 graph on native CPU and WASM: identical vectors in every runtime, so both meet the Python scores.
describe("MoEdernColBERT against Python ONNX Runtime reference scores", () => {
  for (const device of ["cpu", "wasm"] as const) {
    it(`1.5m q8 ${device}`, async () => {
      const fixture = await reference("1.5m");
      const expected = fixture.precisions.q8!;
      const reranker = createColbertReranker({ model: "1.5m", device, loadFile: loadFileFor("1.5m") });
      try {
        const queries = await reranker.encodeQueries(fixture.queries);
        const documents = await reranker.encodeDocuments(fixture.documents);
        const scores = queries.map(q => documents.map(d => maxSim(q, d)));
        expect(documents.map(d => d.tokenCount)).toEqual(expected.document_token_counts);
        expect(queries.every(q => q.tokenCount === 32)).toBe(true);
        const error = Math.max(...scores.flatMap((row, q) => row.map((s, d) => Math.abs(s - expected.scores[q]![d]!))));
        expect(error, "max score error").toBeLessThanOrEqual(fixture.exact_tolerance.score);
        expect(scores.map(top1)).toEqual(expected.scores.map(top1));
        const profile = MOEDERNCOLBERT_MODELS["1.5m"];
        expect(await reranker.fingerprint()).toBe(`${profile.id}@${profile.revision}:${profile.files["model_q8.onnx"]}`);
      } finally { await reranker.dispose(); }
    }, 120_000);
  }
});

interface TokenizerReference { texts: string[]; tokenizers: Record<string, { query: number[][]; document: number[][] }> }

// Rust-tokenizer ids from scripts/generate-colbert-tokenizer-reference.py. Six texts contain U+FEFF or U+0085, which
// @huggingface/tokenizers 0.2.0 splits differently on its own; two contain neither.
describe("MoEdernColBERT token ids against Rust tokenizers", () => {
  for (const model of Object.keys(MOEDERNCOLBERT_MODELS) as ColbertModel[]) {
    it(`${model}: exact ids, and matching document token counts from the reranker`, async () => {
      const fixture = JSON.parse(await readFile(new URL("../fixtures/moederncolbert-tokenizer-reference.json", import.meta.url), "utf8")) as TokenizerReference;
      const expected = fixture.tokenizers[MOEDERNCOLBERT_MODELS[model].files["tokenizer.json"]]!;
      const json = async (name: string) => JSON.parse(await readFile(new URL(name, modelDir(model)), "utf8"));
      const tokenizer = new Tokenizer(await json("tokenizer.json"), await json("tokenizer_config.json"));
      expect(fixture.texts.map(text => tokenIds(tokenizer, "[Q] ", text))).toEqual(expected.query);
      expect(fixture.texts.map(text => tokenIds(tokenizer, "[D] ", text))).toEqual(expected.document);
      const skip = new Set<number>((await json("runtime.json")).skip_token_ids);
      const reranker = createColbertReranker({ model, loadFile: loadFileFor(model) });
      try {
        const documents = await reranker.encodeDocuments(fixture.texts);
        expect(documents.map(d => d.tokenCount)).toEqual(expected.document.map(ids => ids.filter(id => !skip.has(id)).length));
      } finally { await reranker.dispose(); }
    });
  }
});

describe("MoEdernColBERT reranker behavior", () => {
  const reranker = createColbertReranker({ model: "1.5m", device: "cpu", loadFile: loadFileFor("1.5m") });
  afterAll(() => reranker.dispose());
  const passages = ["Die Zugspitze ist 2962 Meter hoch.", "Paris is the capital of France.", "A bicycle has two wheels."];

  it("reranks candidates, honors topK and returns nothing for no candidates", async () => {
    const ranked = await reranker.rerank("Wie hoch ist die Zugspitze?", passages);
    expect(ranked[0]!.index).toBe(0);
    expect(ranked.map(hit => hit.index).sort()).toEqual([0, 1, 2]);
    expect(await reranker.rerank("Wie hoch ist die Zugspitze?", passages, { topK: 1 })).toEqual([ranked[0]]);
    expect(await reranker.rerank("x", [])).toEqual([]);
    await expect(reranker.rerank("x", passages, { topK: -1 })).rejects.toThrow(/topK/);
    const [query] = await reranker.encodeQueries(["Wie hoch ist die Zugspitze?"]);
    expect(rankEncoded(query!, await reranker.encodeDocuments(passages))).toEqual(ranked);
  });

  it("fuses the first dense hits with their ColBERT scores and maps them back to corpus indices", async () => {
    const corpus = ["A bicycle has two wheels.", "Paris is the capital of France.", "Die Zugspitze ist 2962 Meter hoch.", "Bread needs flour."];
    // A 0.05 lead is below the default denseMargin (0.1), so these hits are fused.
    const dense = [{ index: 3, score: 0.9 }, { index: 1, score: 0.85 }, { index: 2, score: 0.7 }, { index: 0, score: 0.1 }];
    const query = "Wie hoch ist die Zugspitze?";
    const fused = await reranker.rerankHits(query, dense, corpus, { candidates: 3 });
    expect(fused.map(hit => hit.index).sort()).toEqual([1, 2, 3]); // the 4th dense hit is not a candidate
    const [encoded] = await reranker.encodeQueries([query]);
    const colbert = (await reranker.encodeDocuments([corpus[3]!, corpus[1]!, corpus[2]!])).map(d => maxSim(encoded!, d));
    expect(fused).toEqual(fuseRanks(colbert).map(({ position, score }) =>
      ({ index: dense[position]!.index, score, denseRank: position + 1, colbertScore: colbert[position]! })));
    expect(fused.find(hit => hit.index === 2)!.colbertScore).toBe(Math.max(...colbert));
    const weighted = await reranker.rerankHits(query, dense, corpus, { candidates: 3, colbertWeight: 1, denseMargin: Infinity });
    expect(weighted).toEqual(fuseRanks(colbert, { colbertWeight: 1 }).map(({ position, score }) =>
      ({ index: dense[position]!.index, score, denseRank: position + 1, colbertScore: colbert[position]! })));
    expect(weighted[0]!.index).toBe(2);
    expect(await reranker.rerankHits(query, dense, corpus, { candidates: 3, topK: 1 })).toEqual(fused.slice(0, 1));
    // A top hit that leads by denseMargin keeps the dense order; the ColBERT scores still come back.
    const kept = await reranker.rerankHits(query, [{ index: 3, score: 0.99 }, ...dense.slice(1)], corpus, { candidates: 3 });
    expect(kept.map(hit => [hit.index, hit.denseRank, hit.colbertScore])).toEqual([[3, 1, colbert[0]], [1, 2, colbert[1]], [2, 3, colbert[2]]]);
  });

  it("fails on overlong input unless truncation is explicit, and keeps the final [SEP]", async () => {
    await expect(reranker.encodeQueries(["word ".repeat(60)])).rejects.toThrow(/limit is 32/);
    const [query] = await reranker.encodeQueries(["word ".repeat(60)], { truncate: true });
    expect(query!.truncated).toBe(true);
    expect(query!.tokenCount).toBe(32);
    await expect(reranker.encodeDocuments(["word ".repeat(20)], { documentLength: 8 })).rejects.toThrow(/limit is 8/);
    await expect(reranker.encodeDocuments(["x"], { documentLength: 600 })).rejects.toThrow(/documentLength/);
  });

  it("can retry after a transient asset failure and finishes accepted work before disposal", async () => {
    let fail = true;
    const retry = createColbertReranker({ model: "1.5m", device: "cpu", loadFile: async name => {
      if (fail) throw new Error("Temporary transport failure");
      return loadFileFor("1.5m")(name);
    } });
    await expect(retry.load()).rejects.toThrow(/Temporary/);
    fail = false;
    const pending = [retry.rerank("Zugspitze", passages), retry.rerank("France", passages)];
    const closing = retry.dispose();
    const [first, second] = await Promise.all(pending);
    await closing;
    expect([first![0]!.index, second![0]!.index]).toEqual([0, 1]);
    await expect(retry.rerank("x", passages)).rejects.toThrow(/disposed/);
  });

  it("downloads from a mirror into the filesystem cache, then works with remote loading disabled", async () => {
    const files = new Set(Object.keys(MOEDERNCOLBERT_MODELS["1.5m"].files));
    let requests = 0;
    const server = createServer(async (request, response) => {
      requests++;
      // The mirror serves the `.br` files that scripts/download-model.ts keeps next to the decoded ones.
      const name = path.basename(new URL(request.url ?? "/", "http://localhost").pathname);
      if (!name.endsWith(".br") || !files.has(name.slice(0, -3))) return void response.writeHead(404).end();
      response.writeHead(200).end(await readFile(new URL(name, modelDir("1.5m"))));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), "colbert-cache-"));
    const modelBaseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mirror`;
    try {
      const online = createColbertReranker({ model: "1.5m", device: "cpu", modelBaseUrl, cacheDir });
      const expected = await online.rerank("Wie hoch ist die Zugspitze?", passages);
      await online.dispose();
      expect(requests).toBe(4); // the .br of tokenizer.json, tokenizer_config.json, runtime.json, model_q8.onnx
      const offline = createColbertReranker({ model: "1.5m", device: "cpu", modelBaseUrl, cacheDir, allowRemoteModels: false });
      try { expect(await offline.rerank("Wie hoch ist die Zugspitze?", passages)).toEqual(expected); }
      finally { await offline.dispose(); }
      expect(requests).toBe(4);
    } finally {
      server.close();
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});
