/**
 * `make docs` step 1: embeds every bench passage once, at build time, and writes the demo's prebuilt index.
 * VERIFIED: bench.json: Chromium embeds a Winzling passage in 111 ms on average, so 2,000 passages would take ~4 min in
 * the browser; a query takes 21 ms (p50). Node embeds here with native ONNX Runtime; README "Benchmark" records min
 * cosine 1 between Node and Chromium vectors for the same passages, so browser queries match these vectors.
 * It also encodes every passage with the reranker into token vectors, so the "reranker" mode downloads them instead
 * of encoding in the browser (VERIFIED: 16.4 s in Chromium, tmp/mode-probe.ts, 2026-11-09).
 * Output (write-index.ts): docs/data/documents.json.br (passages, queries), docs/data/vectors.bin.br (the TurboQuant
 * index), docs/data/tokens.bin.br (the reranker's token vectors, token-format.ts) and docs/data/manifest.json (their
 * exact sizes and the model files' sizes, for the page's progress and transfer figures).
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createColbertReranker, createWinzlingEmbedder, MOEDERNCOLBERT_MODELS, WINZLING_FILES, WINZLING_MODEL_ID, WINZLING_PROFILE, WINZLING_REVISION } from "../../dist/onnx.mjs";
import { buildTurboQuantIndex } from "../../dist/turboquant.mjs";
import { buildBenchTasks, DATASET_SHA256, loadDataset } from "../bench/dataset.ts";
import { logLine } from "../bench/models.ts";
import { DEMO_INDEX_SCHEMA } from "./index-format.ts";
import { encodeTokenVectors } from "./token-format.ts";
import { writeDemoIndex } from "./write-index.ts";

const MODEL_DIR = "public/models/winzling";
// The demo worker's reranker (examples/search-worker.ts): MoEdernColBERT 1.5M at its default q8 precision.
const RERANKER_DIR = `public/models/${MOEDERNCOLBERT_MODELS["1.5m"].id.split("/")[1]}`;
const RERANKER_FILES = ["tokenizer.json", "tokenizer_config.json", "runtime.json", "model_q8.onnx"];
/**
 * Bits per token-vector component in docs/data/tokens.bin.br (token-format.ts). VERIFIED (tmp/token-store-probe.ts,
 * 2026-11-09, the 450 target-language queries): int4 is 8.2 MB as Brotli against 21.4 MB for int8, and reaches R@1 67.3,
 * R@5 83.8, R@10 87.3 where float32 and int8 reach 68.0 / 68.4, 83.8, 86.9.
 */
const TOKEN_BITS = 4;

const bytes = new Uint8Array(await readFile("bench/dataset.json"));
const dataset = await loadDataset(bytes);
const { source } = JSON.parse(new TextDecoder().decode(bytes)) as {
  source: { license: string; license_url: string; attribution: string; citation: string };
};
const tasks = buildBenchTasks(dataset);
const size = dataset.languages.length;

// VERIFIED: 2026-10-08, Apple M4: batchSize 1 builds the index in 515 s, batchSize 8 (the default) in 607 s; padding costs more than batching saves.
const embedder = createWinzlingEmbedder({ device: "cpu", batchSize: 1, loadFile: (file) => readFile(path.join(MODEL_DIR, file)) });
const started = performance.now();
let vectors: Float32Array[];
try {
  vectors = await embedder.embedDocuments(tasks.passages.map((passage) => passage.text));
} finally {
  await embedder.dispose();
}
console.error(logLine("INFO", "embedded passages", { passages: String(vectors.length), ms: String(Math.round(performance.now() - started)) }));

// The reranker on native CPU; the q8 graph gives the same vectors in every runtime (src/model-profiles.ts, parity "exact").
const reranker = createColbertReranker({ model: "1.5m", device: "cpu", loadFile: (file) => readFile(path.join(RERANKER_DIR, file)) });
let tokens: ReturnType<typeof encodeTokenVectors>;
try {
  const encoded = await reranker.encodeDocuments(tasks.passages.map((passage) => passage.text), { truncate: true });
  tokens = encodeTokenVectors(encoded, TOKEN_BITS, await reranker.fingerprint());
} finally {
  await reranker.dispose();
}
console.error(logLine("INFO", "encoded token vectors", { tokens: String(tokens.meta.tokens), bits: String(TOKEN_BITS) }));

const demo = {
  schema: DEMO_INDEX_SCHEMA,
  dataset: {
    name: dataset.name, sha256: DATASET_SHA256,
    license: source.license, licenseUrl: source.license_url, attribution: source.attribution, citation: source.citation,
  },
  model: { id: WINZLING_MODEL_ID, revision: WINZLING_REVISION, fingerprint: WINZLING_PROFILE.fingerprint },
  languages: dataset.languages,
  passages: tasks.passages.map((passage, row) => ({ text: passage.text, language: passage.language, group: Math.floor(row / size) })),
  queries: tasks.queries.map((query) => ({ text: query.text, language: query.language, gold: query.target })),
  index: buildTurboQuantIndex(vectors),
} as const;

// scripts/download-model.ts keeps each pinned file and its `.br` side by side; the worker downloads the `.br`.
const sizes = (dir: string, files: readonly string[]) => Promise.all(files.map(async (file) =>
  [file, { bytes: (await stat(path.join(dir, `${file}.br`))).size, rawBytes: (await stat(path.join(dir, file))).size }] as const))
  .then(Object.fromEntries);
const modelFiles = await sizes(MODEL_DIR, Object.keys(WINZLING_FILES));
const rerankerFiles = await sizes(RERANKER_DIR, RERANKER_FILES);
const manifest = await writeDemoIndex(demo, modelFiles, rerankerFiles, tokens);
console.error(logLine("INFO", "wrote demo index", { documents: String(manifest.documents.bytes), vectors: String(manifest.vectors.bytes), tokens: String(manifest.tokens.bytes) }));
