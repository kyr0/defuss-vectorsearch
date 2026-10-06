import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { Tokenizer } from "@huggingface/tokenizers";
import { createWinzlingEmbedder, WINZLING_MODEL_ID } from "./onnx.js";
import { createEmbeddingServer } from "./server.js";

const loadFile = async (name: string) => new Uint8Array(await readFile(new URL(`../public/models/winzling/${name}`, import.meta.url)));
const fixture = JSON.parse(await readFile(new URL("../fixtures/winzling-reference.json", import.meta.url), "utf8")) as {
  cases: { text: string; ids: number[]; embedding: number[]; raw: number[] }[];
};
const maxError = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.max(...Array.from(a, (v, i) => Math.abs(v - b[i]!)));

describe("real Winzling inference", () => {
  const wasm = createWinzlingEmbedder({ device: "wasm", loadFile, batchSize: 4 });
  const cpu = createWinzlingEmbedder({ device: "cpu", loadFile, batchSize: 4 });
  afterAll(async () => { await wasm.dispose(); await cpu.dispose(); });

  it("matches Rust token IDs exactly on all multilingual and adversarial fixtures", async () => {
    const tokenizer = new Tokenizer(JSON.parse(new TextDecoder().decode(await loadFile("tokenizer.json"))),
      JSON.parse(new TextDecoder().decode(await loadFile("tokenizer_config.json"))));
    for (const item of fixture.cases) expect(tokenizer.encode(item.text).ids, item.text).toEqual(item.ids);
  });

  for (const [device, embedder] of [["wasm", wasm], ["cpu", cpu]] as const) {
    it(`${device}: padded microbatches match independent Python single-text vectors`, async () => {
      const start = performance.now();
      const vectors = await embedder.embed(fixture.cases.map(item => item.text));
      const error = Math.max(...vectors.map((v, i) => maxError(v, fixture.cases[i]!.embedding)));
      console.log(JSON.stringify({ device, cases: vectors.length, maxAbsoluteError: error, coldBatchMs: performance.now() - start }));
      expect(error).toBeLessThan(2e-5);
      for (const v of vectors) { expect(v.length).toBe(384); expect(Math.hypot(...v)).toBeCloseTo(1, 6); }
    });
  }

  it("returns unnormalized means when requested and preserves singleton/batch parity", async () => {
    const one = await wasm.embedOne(fixture.cases[0]!.text, { normalize: false });
    expect(maxError(one, fixture.cases[0]!.raw)).toBeLessThan(2e-4);
    const batch = await wasm.embed([fixture.cases[0]!.text, fixture.cases[18]!.text]);
    expect(maxError(batch[0]!, await wasm.embedOne(fixture.cases[0]!.text))).toBeLessThan(2e-5);
    expect(maxError(await wasm.embedQuery("  hello  "), await wasm.embedOne("  hello  "))).toBe(0);
  });

  it("works through the existing server factory without injecting a Harrier prompt", async () => {
    const server = createEmbeddingServer({ model: WINZLING_MODEL_ID, device: "cpu", winzling: { loadFile } });
    try {
      const q = await server.embedQuery(fixture.cases[0]!.text);
      expect(maxError(q, fixture.cases[0]!.embedding)).toBeLessThan(2e-5);
      await expect(server.embedQuery("hello", { instruction: "search" })).rejects.toThrow(/unprefixed/);
      await expect(server.embed("hello", { pooling: "last_token" })).rejects.toThrow(/mean/);
    } finally { await server.dispose(); }
  });

  it("fails on overflow unless truncation is explicitly enabled; preserves EOS", async () => {
    const reject = createWinzlingEmbedder({ device: "cpu", loadFile, maxLength: 3 });
    const truncate = createWinzlingEmbedder({ device: "cpu", loadFile, maxLength: 3, truncate: true });
    try {
      await expect(reject.embedOne("hello world test")).rejects.toThrow(/maxLength/);
      expect(maxError(await truncate.embedOne("hello world test"), await cpu.embedOne("hello"))).toBeLessThan(2e-5);
    } finally { await reject.dispose(); await truncate.dispose(); }
  });

  it("rejects corrupt artifacts and can retry initialization after a fetch error", async () => {
    const corrupt = createWinzlingEmbedder({ device: "cpu", loadFile: async () => new Uint8Array([1, 2, 3]) });
    await expect(corrupt.load()).rejects.toThrow(/SHA-256/); await corrupt.dispose();
    let fail = true;
    const retry = createWinzlingEmbedder({ device: "cpu", loadFile: async name => {
      if (fail) throw new Error("Temporary transport failure");
      return loadFile(name);
    } });
    await expect(retry.load()).rejects.toThrow(/Temporary/);
    fail = false;
    try { expect((await retry.embedOne("hello")).length).toBe(384); } finally { await retry.dispose(); }
  });

  it("serializes concurrent runs and waits for accepted work before disposal", async () => {
    const embedder = createWinzlingEmbedder({ device: "cpu", loadFile });
    const pending = [embedder.embedOne("hello"), embedder.embedOne("world")];
    const closing = embedder.dispose();
    const results = await Promise.all(pending);
    expect(results.map(v => v.length)).toEqual([384, 384]);
    await closing;
    await expect(embedder.embedOne("later")).rejects.toThrow(/disposed/);
  });
});
