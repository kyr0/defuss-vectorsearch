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
 * - every search posts the TurboQuant hits at once, then MoEdernColBERT 1.5M (q8) reranks the top 25 and the fused
 *   order replaces them (`final`). VERIFIED: fusing the top 25 lifted R@1 from 66.4 to 76.2 on the bench's target
 *   languages (plans/2026-10-31_01-16_rerank-fusion-default.md); posting the dense hits first keeps typing responsive.
 * Built by scripts/docs/build-worker.ts into docs/assets/search-worker.js.
 * Why `loadFile` instead of the library's own cache: it is the one hook that sees the bytes as they arrive.
 * VERIFIED: WinzlingEmbedderCore hash-checks bytes returned by `loadFile` (readAsset), so the override cannot weaken
 * integrity. Alternative rejected: a progress callback in the library would change its public API for a demo.
 */
import {
  buildTurboQuantIndex, createColbertReranker, createWinzlingEmbedder, MOEDERNCOLBERT_MODELS, searchTurboQuantIndex, WINZLING_FILES,
  WINZLING_MODEL_ID, WINZLING_PROFILE, WINZLING_REVISION, type ColbertReranker, type SearchHit, type TurboQuantSearchIndex, type WinzlingEmbedder,
} from "defuss-vectorsearch/browser.js";
import { decodeDemoIndex, type DemoIndex } from "../scripts/docs/index-format.ts";

/** ONNX Runtime Web's WASM, from the CDN at the installed version; set by build-worker.ts. */
declare const __ORT_WASM_PATHS__: string;

type Device = "wasm" | "webgpu";
type Tone = "info" | "success" | "warning" | "destructive" | "muted";
type FileName = keyof typeof WINZLING_FILES;
/** One pinned Hugging Face release; `sizes` names the manifest entry holding its file sizes. */
type Release = { base: string; pins: Readonly<Record<string, string>>; files: readonly string[]; sizes: "modelFiles" | "rerankerFiles" };
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
  | { type: "results"; index: SearchIndex; id: number; query: string; hits: (DemoHit | NoteHit)[]; embedMs: number; scanMs: number; size: number; strategy: string;
      /** Reranking time, on the fused results only. */ rerankMs?: number; /** false: the fused order follows. */ final: boolean }
  | { type: "note"; id: string; version: number; embedMs: number; indexMs: number; count: number; removed: boolean }
  | { type: "error"; message: string; index?: SearchIndex; note?: string }
  | { type: "cleared" };
/** docs/data/manifest.json (scripts/docs/write-index.ts): `bytes` cross the network gzipped, `rawBytes` are unpacked. */
interface Manifest {
  documents: { file: string; bytes: number; rawBytes: number };
  vectors: { file: string; bytes: number; rawBytes: number };
  modelFiles: Record<FileName, number>;
  /** The reranker files the worker loads: MoEdernColBERT 1.5M's tokenizer, runtime contract and q8 graph. */
  rerankerFiles: Record<string, number>;
}

const RERANKER = MOEDERNCOLBERT_MODELS["1.5m"];
const WINZLING: Release = {
  base: `https://huggingface.co/${WINZLING_MODEL_ID}/resolve/${WINZLING_REVISION}/`, pins: WINZLING_FILES, files: Object.keys(WINZLING_FILES), sizes: "modelFiles",
};
const RERANKER_RELEASE: Release = {
  base: `https://huggingface.co/${RERANKER.id}/resolve/${RERANKER.revision}/`, pins: RERANKER.files,
  files: ["tokenizer.json", "tokenizer_config.json", "runtime.json", "model_q8.onnx"], sizes: "rerankerFiles",
};
const RELEASES = [WINZLING, RERANKER_RELEASE];
const CACHE_NAME = `defuss-vectorsearch-demo-${WINZLING_REVISION.slice(0, 8)}`;
/** The reranker's pool: TurboQuant's top 25, the library's default. */
const CANDIDATES = 25;

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
let reranker: ColbertReranker | undefined;
let demo: DemoIndex | undefined;
/** The passages' texts by row, what the reranker reads for each candidate. */
let passageTexts: string[] = [];
let queue: Promise<unknown> = Promise.resolve();

const isCached = async () => {
  const cache = await openCache();
  const urls = RELEASES.flatMap((release) => release.files.map((file) => release.base + file));
  return !!cache && (await Promise.all(urls.map((url) => cache.match(url)))).every(Boolean);
};

/**
 * The files of both models through the Cache API, reporting their summed bytes as one "model" phase; `loadFile` for
 * the embedder and the reranker. Each call to `modelLoader` starts a new count, so a reload reports from zero.
 */
const modelLoader = (manifest: Manifest, stats: { downloaded: number }) => {
  const sizes = (release: Release) => manifest[release.sizes] as Record<string, number>;
  const total = RELEASES.reduce((sum, release) => sum + release.files.reduce((part, file) => part + sizes(release)[file]!, 0), 0);
  const loaded = new Map<string, number>();
  const report = (url: string, bytes: number) => {
    loaded.set(url, bytes);
    post({ type: "progress", phase: "model", loaded: [...loaded.values()].reduce((a, b) => a + b, 0), total });
  };
  let finished = 0;
  const count = RELEASES.reduce((sum, release) => sum + release.files.length, 0);
  return (release: Release, label: string) => async (file: string): Promise<Uint8Array> => {
    const url = release.base + file;
    const cache = await openCache();
    const hit = await cache?.match(url);
    let bytes: Uint8Array;
    if (hit) bytes = new Uint8Array(await hit.arrayBuffer());
    else {
      log("info", `fetch ${label} ${file} · ${mb(sizes(release)[file]!)}`);
      bytes = await download(url, (n) => report(url, n));
      stats.downloaded += bytes.length;
      // Only verified bytes enter the cache; the library re-checks every file after this returns.
      if (cache && (await sha256(bytes)) === release.pins[file]) await cache.put(url, new Response(new Uint8Array(bytes)));
    }
    report(url, bytes.length);
    log("success", `${label} ${file} · ${mb(bytes.length)} · ${hit ? "from cache" : "downloaded"}`);
    if (++finished === count) {
      post({ type: "phase", phase: "runtime", done: false });
      log("info", `ONNX Runtime Web · ${embedder?.device ?? "wasm"} · 1 thread · compiling WebAssembly`);
    }
    return bytes;
  };
};

type Loader = ReturnType<typeof modelLoader>;
const createEmbedder = (device: Device, loader: Loader) =>
  createWinzlingEmbedder({ device, numThreads: 1, wasmPaths: __ORT_WASM_PATHS__, loadFile: loader(WINZLING, "Winzling") });

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
  passageTexts = demo.passages.map((passage) => passage.text);
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
  await reranker?.dispose();
  reranker = undefined;
  const loader = modelLoader(files, stats);
  // The reranker always runs on WASM, with the embedder's ORT Web settings: those are global (src/ort-runtime.ts).
  const next = createColbertReranker({ model: "1.5m", numThreads: 1, wasmPaths: __ORT_WASM_PATHS__, loadFile: loader(RERANKER_RELEASE, "MoEdernColBERT") });
  const rerankerLoaded = next.load();
  rerankerLoaded.catch(() => {}); // awaited below, after the embedder; this only keeps the rejection handled meanwhile
  let fallback: string | null = null;
  try {
    embedder = createEmbedder(device, loader);
    try {
      await embedder.load();
    } catch (error) {
      if (device !== "webgpu") throw error;
      fallback = message(error);
      log("warning", `WebGPU failed: ${fallback} · falling back to WASM`);
      embedder = createEmbedder("wasm", loader);
      await embedder.load();
    }
    await rerankerLoaded;
  } catch (error) {
    await next.dispose();
    throw error;
  }
  reranker = next;
  post({ type: "phase", phase: "runtime", done: true });
  log("success", `SHA-256 verified · sessions ready · Winzling ${embedder.device} · MoEdernColBERT wasm`);
  const index = await ensureIndex(manifestUrl);
  post({ type: "phase", phase: "warmup", done: false });
  const warm = performance.now();
  // One query through embedding, the TurboQuant scan and the reranker, so the first real search pays no JIT warm-up.
  const vector = await embedder.embedQuery("warm-up");
  await reranker.rerankHits("warm-up", searchTurboQuantIndex(index.index, vector, CANDIDATES), passageTexts, { truncate: true });
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

/** The searches both indexes use, named in every result: the 4-bit scan, then its top 25 fused with the reranker. */
const STRATEGY = "TurboQuant";
const FUSED = "TurboQuant + MoEdernColBERT";

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
      // Each index names its texts and how a hit becomes a card; the search itself is the same for both.
      const source: { index: TurboQuantSearchIndex | undefined; texts: string[]; size: number; hit: (hit: SearchHit) => DemoHit | NoteHit } = job.index === "bench"
        ? { index: demo.index, texts: passageTexts, size: demo.passages.length,
            hit: (hit: SearchHit): DemoHit => ({ row: hit.index, score: hit.score, ...demo!.passages[hit.index]! }) }
        : { index: notesIndex?.index, texts: notesIndex?.ids.map((id) => notes.get(id)!.text) ?? [], size: notes.size,
            hit: (hit: SearchHit): NoteHit => { const id = notesIndex!.ids[hit.index]!; return { id, score: hit.score, text: notes.get(id)!.text }; } };
      const hits = source.index ? searchTurboQuantIndex(source.index, vector, Math.max(job.k, CANDIDATES)) : [];
      const scanMs = performance.now() - embedded;
      const base = { type: "results", index: job.index, id: job.id, query: job.query, embedMs: embedded - started, scanMs, size: source.size } as const;
      const fuse = !!reranker && hits.length > 0;
      post({ ...base, strategy: STRATEGY, final: !fuse, hits: hits.slice(0, job.k).map(source.hit) });
      if (!fuse || pending) continue; // a newer query is waiting: its results supersede this fused order
      const reranking = performance.now();
      const fused = await reranker!.rerankHits(job.query, hits, source.texts, { topK: job.k, truncate: true });
      // Cards keep the dense similarity for their bar; the order is the fused one.
      const byIndex = new Map(hits.map((hit) => [hit.index, hit]));
      post({ ...base, strategy: FUSED, final: true, rerankMs: performance.now() - reranking, hits: fused.map((hit) => source.hit(byIndex.get(hit.index)!)) });
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
