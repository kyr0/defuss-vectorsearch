/**
 * The docs demo's worker (docs/index.html), grown from browser-worker.ts: it owns the model, ONNX Runtime and the
 * prebuilt index; the page only renders what it posts. Additions over browser-worker.ts:
 * - `loadFile` streams the pinned model files itself, so the page sees byte progress (the library hash-checks the
 *   bytes either way) and keeps them in the Cache API for the next visit;
 * - the index is prebuilt (scripts/docs/build-index.ts) as two gzipped files, streamed with progress and unpacked with
 *   DecompressionStream on page load, so the
 *   1,000 example queries are there before the user decides to download the model;
 * - searches keep only the newest pending query instead of queueing every keystroke;
 * - a second, user-made index: notes typed on the page are embedded here one by one (`note`), and searches name the
 *   index they ask (`bench` or `notes`). The notes index is rebuilt per change: at a handful of 256-byte codes that
 *   costs well under a millisecond, simpler than an incremental index.
 * Built by scripts/docs/build-worker.ts into docs/assets/search-worker.js.
 * Why `loadFile` instead of the library's own cache: it is the one hook that sees the bytes as they arrive.
 * VERIFIED: WinzlingEmbedderCore hash-checks bytes returned by `loadFile` (readAsset), so the override cannot weaken
 * integrity. Alternative rejected: a progress callback in the library would change its public API for a demo.
 */
import {
  buildTurboQuantIndex, createWinzlingEmbedder, searchTurboQuantIndex, WINZLING_FILES, WINZLING_MODEL_ID, WINZLING_PROFILE, WINZLING_REVISION,
  type TurboQuantSearchIndex, type WinzlingEmbedder,
} from "defuss-vectorsearch/browser.js";
import { decodeDemoIndex, type DemoIndex } from "../scripts/docs/index-format.ts";

/** ONNX Runtime Web's WASM, from the CDN at the installed version; set by build-worker.ts. */
declare const __ORT_WASM_PATHS__: string;

type Device = "wasm" | "webgpu";
type Tone = "info" | "success" | "warning" | "destructive" | "muted";
type FileName = keyof typeof WINZLING_FILES;
export type DemoRequest =
  | { type: "probe" }
  | { type: "index"; manifestUrl: string }
  | { type: "load"; device: Device; manifestUrl: string }
  | { type: "search"; index: SearchIndex; id: number; query: string; k: number }
  | { type: "note"; id: string; version: number; text: string }
  | { type: "clear-cache" };
/** "bench": the prebuilt 2,000 passages; "notes": the user's own notes, embedded in the browser. */
export type SearchIndex = "bench" | "notes";
export type DemoHit = { row: number; score: number; text: string; language: number; group: number };
export type NoteHit = { id: string; score: number; text: string };
export type DemoEvent =
  | { type: "probe"; cached: boolean }
  | { type: "progress"; phase: "model" | "index"; loaded: number; total: number }
  | { type: "phase"; phase: "runtime" | "warmup"; done: boolean }
  | { type: "log"; tone: Tone; text: string }
  | { type: "indexed"; vectors: Manifest["vectors"]; documents: Manifest["documents"]; passages: number; languages: readonly string[];
      queries: { text: string; language: number; gold: number; goldGroup: number }[] }
  | { type: "ready"; device: Device; fallback: string | null; ms: number; cached: boolean; downloadedBytes: number }
  | { type: "results"; index: SearchIndex; id: number; query: string; hits: (DemoHit | NoteHit)[]; embedMs: number; scanMs: number; size: number; strategy: string }
  | { type: "note"; id: string; version: number; embedMs: number; indexMs: number; count: number; removed: boolean }
  | { type: "error"; message: string; index?: SearchIndex; note?: string }
  | { type: "cleared" };
/** docs/data/manifest.json (scripts/docs/write-index.ts): `bytes` cross the network gzipped, `rawBytes` are unpacked. */
interface Manifest {
  documents: { file: string; bytes: number; rawBytes: number };
  vectors: { file: string; bytes: number; rawBytes: number };
  modelFiles: Record<FileName, number>;
}

const MODEL_BASE = `https://huggingface.co/${WINZLING_MODEL_ID}/resolve/${WINZLING_REVISION}/`;
const CACHE_NAME = `defuss-vectorsearch-demo-${WINZLING_REVISION.slice(0, 8)}`;
const FILES = Object.keys(WINZLING_FILES) as FileName[];

const post = (event: DemoEvent) => self.postMessage(event);
const log = (tone: Tone, text: string) => post({ type: "log", tone, text });
const mb = (bytes: number) => `${(bytes / 1e6).toFixed(2)} MB`;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
// Cache API needs a secure context; plain-http hosts just download every time.
const openCache = async () => (typeof caches === "undefined" ? undefined : caches.open(CACHE_NAME));

const sha256 = async (bytes: Uint8Array) => Array.from(
  new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer)), (x) => x.toString(16).padStart(2, "0"),
).join("");

/** Reads a response body chunk by chunk; `onBytes` sees the running total, at most every 40 ms plus once at the end. */
const download = async (url: string, onBytes: (loaded: number) => void): Promise<Uint8Array> => {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`${url}: HTTP ${response.status}`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  let reported = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (performance.now() - reported > 40) { reported = performance.now(); onBytes(loaded); }
  }
  onBytes(loaded);
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
};

let embedder: WinzlingEmbedder | undefined;
let demo: DemoIndex | undefined;
let queue: Promise<unknown> = Promise.resolve();

const isCached = async () => {
  const cache = await openCache();
  return !!cache && (await Promise.all(FILES.map((file) => cache.match(MODEL_BASE + file)))).every(Boolean);
};

/** The model files through the Cache API, reporting the summed bytes of all three as one "model" phase. */
const modelLoader = (manifest: Manifest, stats: { downloaded: number }) => {
  const total = FILES.reduce((sum, file) => sum + manifest.modelFiles[file], 0);
  const loaded = new Map<FileName, number>();
  const report = (file: FileName, bytes: number) => {
    loaded.set(file, bytes);
    post({ type: "progress", phase: "model", loaded: [...loaded.values()].reduce((a, b) => a + b, 0), total });
  };
  let finished = 0;
  return async (name: string): Promise<Uint8Array> => {
    const file = name as FileName;
    const cache = await openCache();
    const hit = await cache?.match(MODEL_BASE + file);
    let bytes: Uint8Array;
    if (hit) bytes = new Uint8Array(await hit.arrayBuffer());
    else {
      log("info", `fetch ${file} · ${mb(manifest.modelFiles[file])}`);
      bytes = await download(MODEL_BASE + file, (n) => report(file, n));
      stats.downloaded += bytes.length;
      // Only verified bytes enter the cache; the library re-checks every file after this returns.
      if (cache && (await sha256(bytes)) === WINZLING_FILES[file]) await cache.put(MODEL_BASE + file, new Response(new Uint8Array(bytes)));
    }
    report(file, bytes.length);
    log("success", `${file} · ${mb(bytes.length)} · ${hit ? "from cache" : "downloaded"}`);
    if (++finished === FILES.length) {
      post({ type: "phase", phase: "runtime", done: false });
      log("info", `ONNX Runtime Web · ${embedder?.device ?? "wasm"} · 1 thread · compiling WebAssembly`);
    }
    return bytes;
  };
};

const createEmbedder = (device: Device, manifest: Manifest, stats: { downloaded: number }) =>
  createWinzlingEmbedder({ device, numThreads: 1, wasmPaths: __ORT_WASM_PATHS__, loadFile: modelLoader(manifest, stats) });

/** Gunzips with the platform's DecompressionStream: the files are gzipped at build time, so every host sends the same bytes. */
const gunzip = async (bytes: Uint8Array) =>
  new Uint8Array(await new Response(new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());

/** Both index files, with one progress over their compressed sizes; then the documents and vectors decoded together. */
const loadIndex = async (manifestUrl: string, files: Manifest): Promise<DemoIndex> => {
  const parts = [files.documents, files.vectors];
  const total = parts.reduce((sum, part) => sum + part.bytes, 0);
  const loaded = parts.map(() => 0);
  log("info", `fetch index · ${mb(files.vectors.bytes)} vectors + ${mb(files.documents.bytes)} documents (gzip)`);
  const [documents, vectors] = await Promise.all(parts.map((part, i) => download(new URL(part.file, manifestUrl).href, (n) => {
    loaded[i] = n;
    post({ type: "progress", phase: "index", loaded: loaded.reduce((a, b) => a + b, 0), total });
  }).then(gunzip)));
  const index = decodeDemoIndex(JSON.parse(new TextDecoder().decode(documents)), vectors!);
  if (index.model.fingerprint !== WINZLING_PROFILE.fingerprint) throw new Error(`Index was built with ${index.model.fingerprint}`);
  log("success", `${index.passages.length.toLocaleString("en")} passages · ${index.languages.length} languages · TurboQuant 4-bit · ${mb(files.vectors.rawBytes)} vectors`);
  return index;
};

let manifest: Promise<Manifest> | undefined;
const readManifest = (url: string) => (manifest ??= fetch(url).then(async (response) => {
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return (await response.json()) as Manifest;
}).catch((error: unknown) => { manifest = undefined; throw error; }));

/** The index loads on its own (page load), so the example queries exist before anyone downloads the model. */
const ensureIndex = async (manifestUrl: string): Promise<DemoIndex> => {
  if (demo) return demo;
  const files = await readManifest(manifestUrl);
  demo = await loadIndex(manifestUrl, files);
  const { passages, queries, languages } = demo;
  post({
    type: "indexed", vectors: files.vectors, documents: files.documents,
    passages: passages.length, languages,
    queries: queries.map((query) => ({ ...query, goldGroup: passages[query.gold]!.group })),
  });
  return demo;
};

const load = async (device: Device, manifestUrl: string) => {
  const started = performance.now();
  const files = await readManifest(manifestUrl);
  const cached = await isCached();
  const stats = { downloaded: 0 };
  await embedder?.dispose();
  let fallback: string | null = null;
  embedder = createEmbedder(device, files, stats);
  try {
    await embedder.load();
  } catch (error) {
    if (device !== "webgpu") throw error;
    fallback = message(error);
    log("warning", `WebGPU failed: ${fallback} · falling back to WASM`);
    embedder = createEmbedder("wasm", files, stats);
    await embedder.load();
  }
  post({ type: "phase", phase: "runtime", done: true });
  log("success", `SHA-256 verified · session ready · ${embedder.device}`);
  const index = await ensureIndex(manifestUrl);
  post({ type: "phase", phase: "warmup", done: false });
  const warm = performance.now();
  // One query through embedding and the TurboQuant scan, so the first real search is not paying for JIT warm-up.
  searchTurboQuantIndex(index.index, await embedder.embedQuery("warm-up"), 12);
  log("success", `warm-up query · ${Math.round(performance.now() - warm)} ms`);
  post({ type: "phase", phase: "warmup", done: true });
  post({ type: "ready", device: embedder.device as Device, fallback, ms: performance.now() - started, cached, downloadedBytes: stats.downloaded });
};

/** The user's notes: one vector each; the TurboQuant index over them is rebuilt on every change (tiny, so ~instant). */
const notes = new Map<string, { text: string; vector: Float32Array }>();
let notesIndex: { ids: string[]; index: TurboQuantSearchIndex } | undefined;

const putNote = async ({ id, version, text }: Extract<DemoRequest, { type: "note" }>) => {
  if (!embedder) throw new Error("Load the model first");
  const started = performance.now();
  const removed = !text.trim();
  if (removed) notes.delete(id);
  else notes.set(id, { text, vector: (await embedder.embedDocuments([text]))[0]! });
  const embedded = performance.now();
  const ids = [...notes.keys()];
  notesIndex = ids.length ? { ids, index: buildTurboQuantIndex(ids.map((key) => notes.get(key)!.vector)) } : undefined;
  post({ type: "note", id, version, embedMs: removed ? 0 : embedded - started, indexMs: performance.now() - embedded, count: notes.size, removed });
};

/** The search both indexes use (searchTurboQuantIndex: 4-bit codes, no float32 rerank); named in every result. */
const STRATEGY = "TurboQuant";

let pending: Extract<DemoRequest, { type: "search" }> | undefined;
let searching = false;
let current: SearchIndex = "bench";
/** Embeds only the newest query: one typed word costs one embedding, however many keystrokes arrive meanwhile. */
const pump = async () => {
  if (searching) return;
  searching = true;
  try {
    while (pending) {
      await queue;
      const job = pending;
      pending = undefined;
      if (!embedder || !demo) throw new Error("Load the model first");
      current = job.index;
      const started = performance.now();
      const vector = await embedder.embedQuery(job.query);
      const embedded = performance.now();
      if (job.index === "bench") {
        const hits = searchTurboQuantIndex(demo.index, vector, job.k);
        const scanMs = performance.now() - embedded;
        post({
          type: "results", index: job.index, id: job.id, query: job.query, embedMs: embedded - started, scanMs, size: demo.passages.length, strategy: STRATEGY,
          hits: hits.map((hit) => ({ row: hit.index, score: hit.score, ...demo!.passages[hit.index]! })),
        });
      } else {
        const hits = notesIndex ? searchTurboQuantIndex(notesIndex.index, vector, job.k) : [];
        const scanMs = performance.now() - embedded;
        post({
          type: "results", index: job.index, id: job.id, query: job.query, embedMs: embedded - started, scanMs, size: notes.size, strategy: STRATEGY,
          hits: hits.map((hit) => { const id = notesIndex!.ids[hit.index]!; return { id, score: hit.score, text: notes.get(id)!.text }; }),
        });
      }
    }
  } catch (error) {
    post({ type: "error", message: message(error), index: current });
  } finally {
    searching = false;
  }
};

self.onmessage = ({ data }: MessageEvent<DemoRequest>) => {
  if (data.type === "search") { pending = data; void pump(); return; }
  queue = queue.then(async () => {
    try {
      if (data.type === "probe") post({ type: "probe", cached: await isCached() });
      else if (data.type === "index") await ensureIndex(data.manifestUrl);
      else if (data.type === "note") await putNote(data).catch((error: unknown) => post({ type: "error", message: message(error), note: data.id }));
      else if (data.type === "load") await load(data.device, data.manifestUrl);
      else {
        if (typeof caches !== "undefined") await caches.delete(CACHE_NAME);
        post({ type: "cleared" });
      }
    } catch (error) {
      post({ type: "error", message: message(error) });
    }
  });
};
