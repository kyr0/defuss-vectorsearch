/**
 * Chromium entry for one model, loaded as /scripts/bench/browser.html?model=<key>.
 * The Playwright driver exposes `__benchMemory` and `__benchLog` and polls `__benchDone`.
 */
import { createEmbeddingClient } from "../../dist/client.mjs";
import { buildBenchTasks, loadDataset } from "./dataset.ts";
import { BENCH_CACHE_DIR, isModelKey, MODELS } from "./models.ts";
import { runModelBench, type BenchEmbedder, type ModelResult } from "./runner.ts";

interface BenchWindow {
  __benchMemory(): Promise<number>;
  __benchLog(message: string): Promise<void>;
  __benchDone?: { result?: ModelResult; error?: string };
}
const page = window as unknown as BenchWindow;

const run = async (): Promise<ModelResult> => {
  const key = new URLSearchParams(location.search).get("model");
  if (!isModelKey(key)) throw new Error(`unknown ?model=${String(key)}`);
  const tasks = buildBenchTasks(await loadDataset(new Uint8Array(await (await fetch("/bench/dataset.json")).arrayBuffer())));
  // Same bytes as the Node run, served by the local dev server: no remote model download in the page.
  const modelUrl = new URL(`/${BENCH_CACHE_DIR}/${MODELS[key].cachePath}`, location.href).href;
  const runtime = createEmbeddingClient(
    key === "winzling"
      ? { model: modelUrl, modelProfile: "winzling", device: "wasm", winzling: { wasmPaths: "/ort/" } }
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
  // VERIFIED: the page logs crossOriginIsolated=false; without SharedArrayBuffer ONNX Runtime Web runs single-threaded.
  void page.__benchLog(`crossOriginIsolated=${String(crossOriginIsolated)}`);
  try {
    return await runModelBench(tasks, embedder, {
      memoryBytes: () => page.__benchMemory(),
      log: (message) => void page.__benchLog(message),
    });
  } finally {
    await embedder.dispose();
  }
};

run().then(
  (result) => { page.__benchDone = { result }; },
  (error: unknown) => { page.__benchDone = { error: error instanceof Error ? error.stack ?? error.message : String(error) }; },
);
