import { createServer } from "node:http";
import { brotliCompressSync } from "node:zlib";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Tokenizer } from "@huggingface/tokenizers";
import { fuseRanks, maxSim, rankEncoded, tokenIds, type TokenMatrix } from "./colbert-reranker.js";
import { MOEDERNCOLBERT_MODELS } from "./model-profiles.js";
import { createColbertReranker } from "./onnx.js";
import { loadOrtWeb } from "./ort-runtime.js";
import { readPinnedAsset, sha256Hex, type PinnedAssetCache } from "./pinned-asset.js";

const matrix = (data: number[], fingerprint = "test"): TokenMatrix =>
  ({ data: Float32Array.from(data), tokenCount: data.length / 2, dimensions: 2, fingerprint, truncated: false });

describe("MaxSim scoring", () => {
  it("sums each query token's best match, keeps negative scores and ranks ties stably", () => {
    const query = matrix([1, 0, 0, 1]);
    const document = matrix([-1, -2, -3, -1]);
    expect(maxSim(query, document)).toBe(-2);
    expect(rankEncoded(query, [document, document, matrix([1, 0, 0, 1])]).map(hit => hit.index)).toEqual([2, 0, 1]);
  });

  it("refuses mixed fingerprints, mismatched widths and malformed matrices", () => {
    const query = matrix([1, 0]);
    expect(() => maxSim(query, matrix([1, 0], "other graph"))).toThrow(/fingerprints/);
    expect(() => maxSim(query, { ...matrix([1, 0, 0]), dimensions: 3, tokenCount: 1 })).toThrow(/dimensions/);
    expect(() => maxSim(query, matrix([]))).toThrow(/Invalid token matrix/);
    expect(() => maxSim(query, matrix([Number.NaN, 0]))).toThrow(/Invalid token matrix/);
  });
});

describe("tokenizer input", () => {
  it("maps U+0085 to a space and U+FEFF to U+2060 before tokenizing, keeping the length", () => {
    const seen: string[] = [];
    const tokenizer = { encode: (text: string) => { seen.push(text); return { ids: [text.length] }; } } as unknown as Tokenizer;
    expect(tokenIds(tokenizer, "[D] ", "\uFEFFa\u0085b\uFEFF")).toEqual([9]);
    expect(seen).toEqual(["[D] \u2060a b\u2060"]);
  });
});

describe("reciprocal rank fusion", () => {
  it("weights either ranking explicitly while preserving the dense-margin override", () => {
    const colbert = [0.1, 0.9];
    expect(fuseRanks(colbert, { colbertWeight: 0 }).map(hit => hit.position)).toEqual([0, 1]);
    expect(fuseRanks(colbert, { colbertWeight: 1 }).map(hit => hit.position)).toEqual([1, 0]);
    const weighted = fuseRanks(colbert, { colbertWeight: 0.75 });
    expect(weighted[0]!.position).toBe(1);
    expect(weighted[0]!.score).toBeCloseTo(0.5 / 62 + 1.5 / 61, 14);
    expect(fuseRanks(colbert, { colbertWeight: 0.5 })).toEqual(fuseRanks(colbert));
    expect(fuseRanks(colbert, { colbertWeight: 1, denseScores: [0.8, 0.3] }).map(hit => hit.position)).toEqual([0, 1]);
    expect(fuseRanks(colbert, { colbertWeight: 1, denseScores: [0.8, 0.3], denseMargin: Infinity }).map(hit => hit.position)).toEqual([1, 0]);
    for (const value of [-1, 1.1, NaN, Infinity]) expect(() => fuseRanks(colbert, { colbertWeight: value })).toThrow(/colbertWeight/);
  });

  it("fuses the dense order with the ColBERT order and breaks ties by dense rank", () => {
    // Dense ranks 1, 2, 3; ColBERT ranks 3, 1, 2: rank pair (2, 1) beats (1, 3), which beats (3, 2).
    expect(fuseRanks([0.1, 0.9, 0.5]).map(hit => hit.position)).toEqual([1, 0, 2]);
    const [first, second] = fuseRanks([0.1, 0.9]); // rank pairs (1, 2) and (2, 1): equal fused scores
    expect(first!.score).toBe(second!.score);
    expect([first!.position, second!.position]).toEqual([0, 1]);
    expect(fuseRanks([0.4, 0.4]).map(hit => hit.position)).toEqual([0, 1]);
    expect(fuseRanks([0.7])).toEqual([{ position: 0, score: 2 / 61 }]);
    expect(fuseRanks([])).toEqual([]);
    expect(() => fuseRanks([1, Number.NaN])).toThrow(/finite/);
  });

  it("keeps the dense order when the dense top hit leads by denseMargin", () => {
    // VERIFIED scores of the demo's notes for "Bücher" with the Winzling release pinned by 0.2.x (tmp/notes-probe.ts):
    // fusion moved the library note to third.
    const colbert = [11.551, 13.514, 13.55, 13.255];
    const dense = [0.287, 0.101, 0.038, 0.006];
    expect(fuseRanks(colbert, { denseScores: dense })).toEqual([0, 1, 2, 3].map(position => ({ position, score: 2 / (61 + position) })));
    expect(fuseRanks(colbert, { denseScores: dense, denseMargin: Infinity }).map(hit => hit.position)).toEqual([2, 1, 0, 3]);
    expect(fuseRanks(colbert, { denseScores: [0.287, 0.2, 0.038, 0.006] }).map(hit => hit.position)).toEqual([2, 1, 0, 3]);
    expect(fuseRanks(colbert).map(hit => hit.position)).toEqual([2, 1, 0, 3]);
    expect(() => fuseRanks(colbert, { denseMargin: -1 })).toThrow(/denseMargin/);
    expect(() => fuseRanks(colbert, { denseMargin: Number.NaN })).toThrow(/denseMargin/);
    expect(() => fuseRanks(colbert, { denseScores: [1] })).toThrow(/denseScores/);
  });

  it("validates dense hits before loading anything", async () => {
    let loads = 0;
    const reranker = createColbertReranker({ model: "1.5m", loadFile: async () => { loads++; return new Uint8Array(); } });
    await expect(reranker.rerankHits("q", [{ index: 0, score: 1 }], ["a"], { candidates: 0 })).rejects.toThrow(/candidates/);
    await expect(reranker.rerankHits("q", [{ index: 2, score: 1 }], ["a"])).rejects.toThrow(/Hit index 2 has no document/);
    await expect(reranker.rerankHits("q", [{ index: 0.5, score: 1 }], ["a"])).rejects.toThrow(/no document/);
    await expect(reranker.rerankHits("q", [{ index: 0, score: 1 }], ["a"], { topK: -1 })).rejects.toThrow(/topK/);
    await expect(reranker.rerankHits("q", [{ index: 0, score: 1 }], ["a"], { denseMargin: -1 })).rejects.toThrow(/denseMargin/);
    await expect(reranker.rerankHits("q", [], [], { colbertWeight: NaN })).rejects.toThrow(/colbertWeight/);
    await expect(reranker.rerankHits("q", [{ index: 0, score: Number.NaN }], ["a"])).rejects.toThrow(/finite/);
    expect(await reranker.rerankHits("q", [], ["a"])).toEqual([]);
    expect(loads).toBe(0);
    await reranker.dispose();
  });
});

describe("reranker options", () => {
  it("rejects unknown models, unshipped precisions and invalid settings before loading anything", () => {
    // 0.4.0 dropped the unedited 1.5M and 27M exports; JavaScript callers still passing them get the one model left.
    expect(() => createColbertReranker({ model: "27m" as "1.5m" })).toThrow(/Unknown MoEdernColBERT model: 27m; use 1.5m$/);
    // The round-4 weight edit exists only as a q8 graph.
    expect(() => createColbertReranker({ model: "1.5m", precision: "fp32" as "q8" })).toThrow(/ships no fp32 graph; available: q8$/);
    expect(() => createColbertReranker({ model: "1.5m", device: "webgpu" as "wasm" })).toThrow(/Unsupported reranker device/);
    expect(() => createColbertReranker({ model: "1.5m", batchSize: 0 })).toThrow(/batchSize/);
    expect(() => createColbertReranker({ model: "1.5m", modelBaseUrl: "/models" })).toThrow(/HTTP\(S\)/);
    expect(createColbertReranker({ model: "1.5m" }).precision).toBe("q8");
  });

  it("checks every asset's SHA-256 before creating a session", async () => {
    const reranker = createColbertReranker({ model: "1.5m", device: "cpu", loadFile: async () => new Uint8Array([1, 2, 3]) });
    await expect(reranker.load()).rejects.toThrow(/MoEdernColBERT SHA-256 mismatch/);
    await reranker.dispose();
    await expect(reranker.rerank("x", ["y"])).rejects.toThrow(/disposed/);
  });

  it("pins every shipped graph plus the tokenizer and runtime contract", () => {
    for (const profile of Object.values(MOEDERNCOLBERT_MODELS)) {
      expect(Object.keys(profile.files).sort()).toEqual(["runtime.json", "tokenizer.json", "tokenizer_config.json",
        ...Object.keys(profile.precisions).map(p => `model_${p}.onnx`)].sort());
      expect(profile.revision).toMatch(/^[0-9a-f]{40}$/);
    }
  });
});

describe("pinned asset reader", () => {
  const payload = new TextEncoder().encode('{"ok":true}');
  // node:zlib's encoder, not Hugging Face's: the reader must accept any encoder's `.br` that decodes to the pinned bytes.
  const files: Record<string, Uint8Array> = {
    "/mirror/runtime.json.br": brotliCompressSync(payload),
    "/mirror/other.json.br": brotliCompressSync(new TextEncoder().encode('{"ok":false}')),
    "/mirror/broken.json.br": new Uint8Array([1, 2, 3]),
  };
  let hits = 0;
  const server = createServer((request, response) => {
    hits++;
    const body = files[request.url ?? ""];
    // Like Vite's dev server: the `.br` file labelled as transport-compressed, so fetch decodes it on arrival.
    if (request.url === "/mirror/labelled.json.br") response.writeHead(200, { "content-encoding": "br" }).end(brotliCompressSync(payload));
    else if (body) response.writeHead(200).end(body);
    else response.writeHead(404).end();
  });
  let origin = "";
  beforeAll(async () => {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

  // A real in-memory cache implementation, not a mock: it stores and returns bytes by cache key.
  const memory = new Map<string, Uint8Array>();
  const cache: PinnedAssetCache = {
    load: async location => memory.get(location.cacheKey) ?? null,
    store: async (location, file) => { memory.set(location.cacheKey, file.bytes); },
  };

  it("downloads `.br` from a mirror, decodes, verifies, caches the decoded bytes, then serves the cache offline", async () => {
    const release = { label: "Test", modelId: "kyr0/test", revision: "abc", files: {
      "runtime.json": await sha256Hex(payload), "other.json": await sha256Hex(payload), "broken.json": "0".repeat(64),
      "labelled.json": await sha256Hex(payload), "onnx/model.onnx": "0".repeat(64) } };
    const options = { modelBaseUrl: `${origin}/mirror` };
    expect(await readPinnedAsset(release, "runtime.json", options, cache)).toEqual(payload);
    expect(hits).toBe(1);
    expect([...memory.values()]).toEqual([payload]);
    expect(await readPinnedAsset(release, "runtime.json", { ...options, allowRemoteModels: false }, cache)).toEqual(payload);
    expect(hits).toBe(1);
    // A `.br` that decodes to other bytes fails the pinned hash and is not cached.
    await expect(readPinnedAsset(release, "other.json", options, cache)).rejects.toThrow(/Test SHA-256 mismatch: other.json/);
    await expect(readPinnedAsset(release, "broken.json", options, cache)).rejects.toThrow(/Test could not decode broken.json.br/);
    expect(await readPinnedAsset(release, "labelled.json", options, cache)).toEqual(payload);
    // A mirror without `.br` files gets the command that creates them for every pinned file.
    await expect(readPinnedAsset(release, "onnx/model.onnx", options, cache)).rejects.toThrow(
      "Test download failed: onnx/model.onnx.br (HTTP 404). Model files are served Brotli-compressed; in a mirror's model directory, create them with: bunx defuss-brotli compress runtime.json other.json broken.json labelled.json onnx/model.onnx");
    await expect(readPinnedAsset(release, "other.json", { ...options, allowRemoteModels: false }, cache)).rejects.toThrow(/missing from cache/);
    await expect(readPinnedAsset(release, "missing.json", options, cache)).rejects.toThrow(/pins no file named missing.json/);
    expect(memory.size).toBe(2);
    memory.set([...memory.keys()][0]!, new Uint8Array([9]));
    await expect(readPinnedAsset(release, "runtime.json", { ...options, allowRemoteModels: false }, cache)).rejects.toThrow(/SHA-256 mismatch/);
  });
});

describe("ONNX Runtime loading", () => {
  it("keeps ORT Web's global configuration consistent", async () => {
    await loadOrtWeb({ numThreads: 1 });
    await expect(loadOrtWeb({ numThreads: 2 })).rejects.toThrow(/global/);
  });
});
