/**
 * Node entry for one model: `node --expose-gc scripts/bench/node.ts <model> <out.json>`; `reranker` runs the reranker
 * alone over all passages (runRerankerBench). One process per model keeps RSS deltas from mixing two runtimes.
 */
import { readFile, writeFile } from "node:fs/promises";
import { createColbertReranker, MOEDERNCOLBERT_MODELS, rankEncoded } from "../../dist/onnx.mjs";
import { createEmbeddingServer } from "../../dist/server.mjs";
import { buildBenchTasks, loadDataset } from "./dataset.ts";
import { BENCH_CACHE_DIR, isModelKey, logLine, MODELS, RERANKER_KEY, RERANKER_MODEL } from "./models.ts";
import { runModelBench, runRerankerBench, type BenchProbes, type ModelResult, type RerankerResult } from "./runner.ts";

const [key, out] = process.argv.slice(2);
if (!(isModelKey(key) || key === RERANKER_KEY) || !out) throw new Error("usage: node --expose-gc scripts/bench/node.ts <winzling|harrier|reranker> <out.json>");
const collect = (globalThis as { gc?: () => void }).gc;
if (!collect) throw new Error("run with --expose-gc so memory is measured after a full GC");

const probes: BenchProbes = {
  memoryBytes: async () => {
    collect();
    return process.memoryUsage().rss;
  },
  log: (message) => console.error(logLine("INFO", message, { env: "node", model: key })),
};
const tasks = buildBenchTasks(await loadDataset(new Uint8Array(await readFile("bench/dataset.json"))));
// Native CPU like the embedder; downloads the pinned q8 graph into the bench cache, hash-checked.
// VERIFIED: bench/cache/kyr0/<repo>/<commit>/ is the layout the Chromium run then serves (make bench, 2026-10-31).
const colbert = createColbertReranker({ model: RERANKER_MODEL, device: "cpu", cacheDir: BENCH_CACHE_DIR });

const runModel = async (modelKey: keyof typeof MODELS): Promise<ModelResult> => {
  const { modelId } = MODELS[modelKey];
  // VERIFIED: native ONNX Runtime ("cpu") for both models; Winzling pins 1 thread, Transformers.js keeps ORT's default.
  const runtime = createEmbeddingServer({ model: modelId, device: "cpu", cacheDir: BENCH_CACHE_DIR });
  try {
    return await runModelBench(tasks, {
      modelId,
      device: "cpu",
      load: () => runtime.loadModel(modelId),
      embedPassage: async (text) => (await runtime.embedDocuments([text]))[0]!,
      embedQuery: (text) => runtime.embedQuery(text),
      dispose: () => runtime.dispose(),
    }, probes, {
      load: () => colbert.load(),
      rerankHits: (query, hits, documents) => colbert.rerankHits(query, hits, documents, { truncate: true }),
    });
  } finally {
    await runtime.dispose();
  }
};

const runReranker = (): Promise<RerankerResult> => runRerankerBench(tasks, {
  modelId: MOEDERNCOLBERT_MODELS[RERANKER_MODEL].id,
  device: "cpu",
  load: () => colbert.load(),
  encodeDocument: async (text) => (await colbert.encodeDocuments([text], { truncate: true }))[0]!,
  encodeQuery: async (text) => (await colbert.encodeQueries([text], { truncate: true }))[0]!,
  rank: rankEncoded,
}, probes);

try {
  const result = key === RERANKER_KEY ? await runReranker() : await runModel(key);
  await writeFile(out, JSON.stringify(result));
} finally {
  await colbert.dispose();
}
