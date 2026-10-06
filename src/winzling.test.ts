import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createWinzlingEmbedder, poolWinzling, WINZLING_MODEL_ID, WINZLING_PROFILE, WINZLING_REVISION } from "./onnx.js";
import { buildRemoteModelFileUrl, DEFAULT_MODEL_ID, getRequiredModelFiles, resolveModelSource } from "./model-source.js";
import { createEmbeddingClient } from "./client.js";
import { createEmbeddingServer } from "./server.js";

describe("Winzling contract", () => {
  it("selects the pinned, single-file ONNX graph and no presumed external data", () => {
    const source = resolveModelSource(WINZLING_MODEL_ID);
    expect(source.revision).toBe(WINZLING_REVISION);
    expect(getRequiredModelFiles(source, "q4")).toEqual(WINZLING_PROFILE.requiredFiles);
    expect(buildRemoteModelFileUrl(source, "onnx/model_uint4.onnx")).toContain(`/resolve/${WINZLING_REVISION}/`);
    expect(createEmbeddingClient({ model: WINZLING_MODEL_ID }).dtype).toBe("q4");
  });
  it("excludes masked padding and normalizes once", () => {
    const data = new Float32Array(2 * 3 * 384).fill(999);
    data.fill(0, 0, 768); data[0] = 2; data[384 + 1] = 2;
    data.fill(0, 3 * 384, 4 * 384); data[3 * 384 + 2] = 4;
    const mask = [1, 1, 0, 1, 0, 0];
    const raw = poolWinzling({ data, dims: [2, 3, 384] }, mask, false);
    expect(Array.from(raw[0]!.slice(0, 3))).toEqual([1, 1, 0]);
    expect(raw[1]![2]).toBe(4);
    const norm = poolWinzling({ data, dims: [2, 3, 384] }, mask);
    expect(norm[0]![0]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(norm[1]![2]).toBe(1);
  });
  it("rejects malformed, fully masked, non-finite and zero outputs", () => {
    const data = new Float32Array(384);
    expect(() => poolWinzling({ data, dims: [1, 384] }, [1])).toThrow(/shape/);
    expect(() => poolWinzling({ data, dims: [1, 1, 384] }, [0])).toThrow(/masked/);
    expect(() => poolWinzling({ data, dims: [1, 1, 384] }, [1])).toThrow(/zero/);
    data[0] = NaN;
    expect(() => poolWinzling({ data, dims: [1, 1, 384] }, [1])).toThrow(/finite/);
  });
  it("validates options before loading assets", () => {
    for (const maxLength of [0, 1, 8193, NaN, 3.5]) expect(() => createWinzlingEmbedder({ maxLength })).toThrow();
    expect(() => createWinzlingEmbedder({ batchSize: 0 })).toThrow();
    expect(() => createWinzlingEmbedder({ numThreads: -1 })).toThrow();
    expect(() => createWinzlingEmbedder({ modelBaseUrl: "/tmp/model" })).toThrow(/loadFile/);
  });
  it("handles empty batches without I/O and closes idempotently", async () => {
    const embedder = createWinzlingEmbedder({ loadFile: async () => { throw new Error("Unexpected I/O"); } });
    expect(await embedder.embed([])).toEqual([]);
    await expect(embedder.embedQuery("hello", { preset: "sts_query" })).rejects.toThrow(/unprefixed/);
    await embedder.dispose(); await embedder.dispose();
    await expect(embedder.embed("hello")).rejects.toThrow(/disposed/);
  });
  it("never runs Winzling under another repo ID when modelProfile is winzling", async () => {
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), "winzling-profile-"));
    try {
      const options = { modelProfile: "winzling" as const, allowRemoteModels: false, cacheDir };
      const switched = createEmbeddingServer(options);
      await expect(switched.loadModel(DEFAULT_MODEL_ID)).rejects.toThrow(/accepts only/);
      await expect(createEmbeddingServer({ ...options, model: "someone/fork" }).embedOne("x")).rejects.toThrow(/accepts only/);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});
