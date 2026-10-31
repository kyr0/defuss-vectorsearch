import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fuseRanks, maxSim, rankEncoded, type TokenMatrix } from "./colbert-reranker.js";
import { MOEDERNCOLBERT_MODELS } from "./model-profiles.js";
import { createColbertReranker } from "./onnx.js";
import { describeOrt, loadOrtNode, loadOrtWeb } from "./ort-runtime.js";
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

describe("reciprocal rank fusion", () => {
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

  it("validates dense hits before loading anything", async () => {
    let loads = 0;
    const reranker = createColbertReranker({ model: "1.5m", loadFile: async () => { loads++; return new Uint8Array(); } });
    await expect(reranker.rerankHits("q", [{ index: 0, score: 1 }], ["a"], { candidates: 0 })).rejects.toThrow(/candidates/);
    await expect(reranker.rerankHits("q", [{ index: 2, score: 1 }], ["a"])).rejects.toThrow(/Hit index 2 has no document/);
    await expect(reranker.rerankHits("q", [{ index: 0.5, score: 1 }], ["a"])).rejects.toThrow(/no document/);
    await expect(reranker.rerankHits("q", [{ index: 0, score: 1 }], ["a"], { topK: -1 })).rejects.toThrow(/topK/);
    expect(await reranker.rerankHits("q", [], ["a"])).toEqual([]);
    expect(loads).toBe(0);
    await reranker.dispose();
  });
});

describe("reranker options", () => {
  it("rejects unknown models, unshipped precisions and invalid settings before loading anything", () => {
    expect(() => createColbertReranker({ model: "115m" as "27m" })).toThrow(/Unknown MoEdernColBERT model/);
    // VERIFIED in the exporter: 1.5M q4 fails the 0.98 quality gate, so no q4 graph is pinned.
    expect(() => createColbertReranker({ model: "1.5m", precision: "q4" })).toThrow(/ships no q4 graph; available: fp32, fp16, q8, int8/);
    expect(() => createColbertReranker({ model: "27m", device: "webgpu" as "wasm" })).toThrow(/Unsupported reranker device/);
    expect(() => createColbertReranker({ model: "27m", batchSize: 0 })).toThrow(/batchSize/);
    expect(() => createColbertReranker({ model: "27m", modelBaseUrl: "/models" })).toThrow(/HTTP\(S\)/);
    expect(createColbertReranker({ model: "27m" }).precision).toBe("q8");
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
  let hits = 0;
  const server = createServer((request, response) => {
    hits++;
    if (request.url?.endsWith("/runtime.json")) response.writeHead(200).end(payload);
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

  it("downloads from a mirror, verifies, caches, then serves the cache without the network", async () => {
    const release = { label: "Test", modelId: "kyr0/test", revision: "abc", files: { "runtime.json": await sha256Hex(payload), "other.json": "0".repeat(64) } };
    const options = { modelBaseUrl: `${origin}/mirror` };
    expect(await readPinnedAsset(release, "runtime.json", options, cache)).toEqual(payload);
    expect(hits).toBe(1);
    expect(await readPinnedAsset(release, "runtime.json", { ...options, allowRemoteModels: false }, cache)).toEqual(payload);
    expect(hits).toBe(1);
    await expect(readPinnedAsset(release, "other.json", options, cache)).rejects.toThrow(/Test download failed: other.json \(HTTP 404\)/);
    await expect(readPinnedAsset(release, "other.json", { ...options, allowRemoteModels: false }, cache)).rejects.toThrow(/missing from cache/);
    await expect(readPinnedAsset(release, "missing.json", options, cache)).rejects.toThrow(/pins no file named missing.json/);
    memory.set([...memory.keys()][0]!, new Uint8Array([9]));
    await expect(readPinnedAsset(release, "runtime.json", { ...options, allowRemoteModels: false }, cache)).rejects.toThrow(/SHA-256 mismatch/);
  });
});

describe("ONNX Runtime loading", () => {
  it("names engine, version and device, and keeps ORT Web's global configuration consistent", async () => {
    expect(describeOrt(await loadOrtNode(), "cpu")).toMatch(/^onnxruntime-node@\d+\.\d+\.\d+\/cpu$/);
    const web = await loadOrtWeb({ numThreads: 1 });
    expect(describeOrt(web, "wasm")).toMatch(/^onnxruntime-web@\d+\.\d+\.\d+\/wasm$/);
    await expect(loadOrtWeb({ numThreads: 2 })).rejects.toThrow(/global/);
  });
});
