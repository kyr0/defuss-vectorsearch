/**
 * Chromium entry for one model, loaded as /scripts/bench/browser.html?model=<key>; `reranker` runs the reranker alone.
 * The Playwright driver exposes `__benchMemory` and `__benchLog` and polls `__benchDone`.
 */
import { createColbertReranker, MOEDERNCOLBERT_MODELS, rankEncoded } from "../../dist/browser.mjs";
import { createEmbeddingClient } from "../../dist/client.mjs";
import { buildBenchTasks, loadDataset } from "./dataset.ts";
import { BENCH_CACHE_DIR, isModelKey, MODELS, RERANKER_KEY, RERANKER_MODEL } from "./models.ts";
import { runModelBench, runRerankerBench, type BenchEmbedder, type BenchProbes, type BenchReranker, type ModelResult, type RerankerResult } from "./runner.ts";

interface BenchWindow {
  __benchMemory(): Promise<number>;
  __benchLog(message: string): Promise<void>;
  __benchDone?: { result?: ModelResult | RerankerResult; error?: string };
}
const page = window as unknown as BenchWindow;

const run = async (): Promise<ModelResult | RerankerResult> => {
  const key = new URLSearchParams(location.search).get("model");
  if (!isModelKey(key) && key !== RERANKER_KEY) throw new Error(`unknown ?model=${String(key)}`);
  const tasks = buildBenchTasks(await loadDataset(new Uint8Array(await (await fetch("/bench/dataset.json")).arrayBuffer())));
  // The Node run cached the decoded files, not the `.br` files a mirror serves, so the pinned models read them through
  // `loadFile`; the library still checks every file's SHA-256.
  const loadFrom = (base: string) => async (file: string) => {
    const response = await fetch(`${base}/${file}`);
    if (!response.ok) throw new Error(`${base}/${file}: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  };
  // The reranker files the Node run cached, served by the same dev server; same ORT Web settings as Winzling, which
  // ORT Web keeps global. VERIFIED: make bench (2026-10-31) ran Winzling and Harrier with this reranker in Chromium.
  const profile = MOEDERNCOLBERT_MODELS[RERANKER_MODEL];
  const colbert = createColbertReranker({ model: RERANKER_MODEL, wasmPaths: "/ort/",
    loadFile: loadFrom(new URL(`/${BENCH_CACHE_DIR}/${profile.id}/${profile.revision}`, location.href).href) });
  // VERIFIED: the page logs crossOriginIsolated=false; without SharedArrayBuffer ONNX Runtime Web runs single-threaded.
  void page.__benchLog(`crossOriginIsolated=${String(crossOriginIsolated)}`);
  const probes: BenchProbes = { memoryBytes: () => page.__benchMemory(), log: (message) => void page.__benchLog(message) };
  if (key === RERANKER_KEY) {
    try {
      return await runRerankerBench(tasks, {
        modelId: profile.id, device: "wasm", load: () => colbert.load(),
        encodeDocument: async (text) => (await colbert.encodeDocuments([text], { truncate: true }))[0]!,
        encodeQuery: async (text) => (await colbert.encodeQueries([text], { truncate: true }))[0]!,
        rank: rankEncoded,
      }, probes);
    } finally {
      await colbert.dispose();
    }
  }
  // Same bytes as the Node run, served by the local dev server: no remote model download in the page.
  const modelUrl = new URL(`/${BENCH_CACHE_DIR}/${MODELS[key].cachePath}`, location.href).href;
  const runtime = createEmbeddingClient(
    key === "winzling"
      ? { model: modelUrl, modelProfile: "winzling", device: "wasm", winzling: { wasmPaths: "/ort/", loadFile: loadFrom(modelUrl) } }
      : { model: modelUrl, device: "wasm", warmCacheOnLoad: false },
  );
  const embedder: BenchEmbedder = {
    modelId: MODELS[key].modelId,
    device: "wasm",
    load: () => runtime.loadModel(modelUrl),
    embedPassage: async (text) => (await runtime.embedDocuments([text]))[0]!,
    embedQuery: (text) => runtime.embedQuery(text),
    dispose: () => runtime.dispose(),
  };
  const reranker: BenchReranker = {
    load: () => colbert.load(),
    rerankHits: (query, hits, documents) => colbert.rerankHits(query, hits, documents, { truncate: true }),
  };
  try {
    return await runModelBench(tasks, embedder, probes, reranker);
  } finally {
    await embedder.dispose();
    await colbert.dispose();
  }
};

run().then(
  (result) => { page.__benchDone = { result }; },
  (error: unknown) => { page.__benchDone = { error: error instanceof Error ? error.stack ?? error.message : String(error) }; },
);
