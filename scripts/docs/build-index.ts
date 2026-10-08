/**
 * `make docs` step 1: embeds every bench passage once, at build time, and writes the demo's prebuilt index.
 * VERIFIED: bench.json: Chromium embeds a Winzling passage in 123 ms on average, so 2,000 passages would take ~4 min in
 * the browser; a query takes 21 ms (p50). Node embeds here with native ONNX Runtime; README "Benchmark" records min
 * cosine 1 between Node and Chromium vectors for the same passages, so browser queries match these vectors.
 * Output (write-index.ts): docs/data/documents.json.gz (passages, queries), docs/data/vectors.bin.gz (the TurboQuant
 * index) and docs/data/manifest.json (their exact sizes, for the page's progress and transfer figures).
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createWinzlingEmbedder, WINZLING_FILES, WINZLING_MODEL_ID, WINZLING_PROFILE, WINZLING_REVISION } from "../../dist/onnx.mjs";
import { buildTurboQuantIndex } from "../../dist/turboquant.mjs";
import { buildBenchTasks, DATASET_SHA256, loadDataset } from "../bench/dataset.ts";
import { logLine } from "../bench/models.ts";
import { DEMO_INDEX_SCHEMA } from "./index-format.ts";
import { writeDemoIndex } from "./write-index.ts";

const MODEL_DIR = "public/models/winzling";

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

const modelFiles = Object.fromEntries(await Promise.all(Object.keys(WINZLING_FILES).map(async (file) =>
  [file, (await stat(path.join(MODEL_DIR, file))).size] as const)));
const manifest = await writeDemoIndex(demo, modelFiles);
console.error(logLine("INFO", "wrote demo index", { documents: String(manifest.documents.bytes), vectors: String(manifest.vectors.bytes) }));
