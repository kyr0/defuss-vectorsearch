/**
 * Node entry for one model: `node --expose-gc scripts/bench/node.ts <model> <out.json>`.
 * One process per model keeps RSS deltas from mixing two runtimes.
 */
import { readFile, writeFile } from "node:fs/promises";
import { createEmbeddingServer } from "../../dist/server.mjs";
import { buildBenchTasks, loadDataset } from "./dataset.ts";
import { BENCH_CACHE_DIR, isModelKey, logLine, MODELS } from "./models.ts";
import { runModelBench, type BenchEmbedder } from "./runner.ts";

const [key, out] = process.argv.slice(2);
if (!isModelKey(key) || !out) throw new Error("usage: node --expose-gc scripts/bench/node.ts <winzling|harrier> <out.json>");
const collect = (globalThis as { gc?: () => void }).gc;
if (!collect) throw new Error("run with --expose-gc so memory is measured after a full GC");

const { modelId } = MODELS[key];
const tasks = buildBenchTasks(await loadDataset(new Uint8Array(await readFile("bench/dataset.json"))));
// VERIFIED: native ONNX Runtime ("cpu") for both models; Winzling pins 1 thread, Transformers.js keeps ORT's default.
const runtime = createEmbeddingServer({ model: modelId, device: "cpu", cacheDir: BENCH_CACHE_DIR });
const embedder: BenchEmbedder = {
  modelId,
  device: "cpu",
  load: () => runtime.loadModel(modelId),
  embedPassage: async (text) => (await runtime.embedDocuments([text]))[0]!,
  embedQuery: (text) => runtime.embedQuery(text),
  dispose: () => runtime.dispose(),
};

try {
  const result = await runModelBench(tasks, embedder, {
    memoryBytes: async () => {
      collect();
      return process.memoryUsage().rss;
    },
    log: (message) => console.error(logLine("INFO", message, { env: "node", model: key })),
  });
  await writeFile(out, JSON.stringify(result));
} finally {
  await embedder.dispose();
}
