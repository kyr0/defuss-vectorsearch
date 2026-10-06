import { afterAll, expect, it } from "vitest";
import { createWinzlingEmbedder } from "./onnx.js";
import { createEmbeddingClient, WINZLING_MODEL_ID } from "./client.js";

const base = new URL("/models/winzling", location.href).href;
const embedder = createWinzlingEmbedder({ modelBaseUrl: base, device: "wasm", wasmPaths: "/ort/", batchSize: 4 });
afterAll(() => embedder.dispose());

it("runs the pinned graph in Chromium WASM and matches independent Python reference", async () => {
  const fixture = await (await fetch("/fixtures/winzling-reference.json")).json();
  const start = performance.now();
  const vectors = await embedder.embed(fixture.cases.map((c: { text: string }) => c.text));
  let error = 0;
  vectors.forEach((v, i) => {
    expect(v.length).toBe(384); expect(Math.hypot(...v)).toBeCloseTo(1, 6);
    v.forEach((value, d) => { error = Math.max(error, Math.abs(value - fixture.cases[i].embedding[d])); });
  });
  console.log(JSON.stringify({ backend: "Chromium WASM", cases: vectors.length, maxAbsoluteError: error, coldBatchMs: performance.now() - start }));
  expect(error).toBeLessThan(2e-5);
});

it("reuses browser cache with network loading disabled through the existing client API", async () => {
  const client = createEmbeddingClient({ model: base, modelProfile: "winzling", device: "wasm",
    winzling: { wasmPaths: "/ort/", allowRemoteModels: false } });
  try {
    const query = await client.embedQuery("The cat sleeps on the sofa.");
    const doc = await embedder.embedOne("The cat sleeps on the sofa.");
    expect(Math.max(...query.map((v, i) => Math.abs(v - doc[i]!)))).toBeLessThan(2e-5);
    const cache = await client.inspectModelCache();
    expect(cache.files.length).toBe(3);
    expect(cache.files.every(file => file.locations.length > 0)).toBe(true);
  } finally { await client.dispose(); }
});

it("fails explicitly when WebGPU is unavailable", async () => {
  const api = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (await api?.requestAdapter()) return;
  const gpu = createWinzlingEmbedder({ device: "webgpu" });
  await expect(gpu.load()).rejects.toThrow(/WebGPU/);
  await gpu.dispose();
});
