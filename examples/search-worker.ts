/// <reference types="vite/client" />
/**
 * The docs demo's worker (docs/index.html), grown from browser-worker.ts: it owns the models, ONNX Runtime and the
 * prebuilt index; the page only renders what it posts. It runs one of three modes, chosen on the page (`Mode`):
 * - "reranker" (the default, human decision 2026-11-09): MoEdernColBERT 1.5M alone. It encodes all 2,000 passages into
 *   token vectors once after loading and ranks every passage by MaxSim per query; no dense model, a 2.28 MB download.
 *   VERIFIED (tmp/colbert-all-probe.ts, Node WASM, 2026-11-09): encoding takes ~13 s, the vectors take 92.5 MB, a
 *   query's MaxSim over all of them ~560 ms.
 * - "embedder": Winzling alone, the TurboQuant hits as they are;
 * - "both": Winzling's TurboQuant hits, then the reranker's fusion of their top 25 (below).
 * Additions over browser-worker.ts:
 * - `loadFile` streams the pinned model files itself as `.br` files and decodes them with defuss-brotli, so the page
 *   sees byte progress (the library hash-checks the decoded bytes either way) and keeps them, decoded, in the Cache
 *   API for the next visit;
 * - the index is prebuilt (scripts/docs/build-index.ts) as two Brotli files, streamed with progress and decoded by the
 *   same defuss-brotli decoder on page load, so the 1,000 example queries are there before the user decides to
 *   download the model;
 * - searches keep only the newest pending query instead of queueing every keystroke;
 * - a second, user-made index: notes typed on the page are embedded here one by one (`note`), and searches name the
 *   index they ask (`bench` or `notes`). The notes index is rebuilt per change: at a handful of 256-byte codes that
 *   costs well under a millisecond, simpler than an incremental index.
 * - every search posts the TurboQuant hits at once, then MoEdernColBERT 1.5M (q8) reranks the top 25 and the fused
 *   order replaces them (`final`). VERIFIED: fusing the top 25 lifts R@1 from 67.3 to 78.5 on the bench's eight target
 *   languages (`make bench`, Chromium); posting the dense hits first keeps typing responsive.
 * Built by scripts/docs/build-worker.ts into docs/assets/search-worker.js.
 * Why `loadFile` instead of the library's own cache: it is the one hook that sees the bytes as they arrive.
 * VERIFIED: WinzlingEmbedderCore hash-checks bytes returned by `loadFile` (readAsset), so the override cannot weaken
 * integrity. Alternative rejected: a progress callback in the library would change its public API for a demo.
 */
import {
  buildTurboQuantIndex, createColbertReranker, createWinzlingEmbedder, MOEDERNCOLBERT_MODELS, rankEncoded, searchTurboQuantIndex, WINZLING_FILES,
  WINZLING_MODEL_ID, WINZLING_PROFILE, WINZLING_REVISION, type ColbertReranker, type SearchHit, type TokenMatrix, type TurboQuantSearchIndex,
  type WinzlingEmbedder,
} from "defuss-vectorsearch/browser.js";
import { decompress, init as initBrotli } from "defuss-brotli/decompressor/slim";
import brotliWasmUrl from "defuss-brotli/decompressor.wasm?url";
import { decodeDemoIndex, type DemoIndex } from "../scripts/docs/index-format.ts";
import { decodeTokenVectors, type TokenFileMeta } from "../scripts/docs/token-format.ts";

/** ONNX Runtime Web's WASM, from the CDN at the installed version; set by build-worker.ts. */
declare const __ORT_WASM_PATHS__: string;

type Device = "wasm" | "webgpu";
/** Which models search: the reranker alone, the embedder alone, or both fused. */
export type Mode = "reranker" | "embedder" | "both";
type Tone = "info" | "success" | "warning" | "destructive" | "muted";
type FileName = keyof typeof WINZLING_FILES;
/** One pinned Hugging Face release; `sizes` names the manifest entry holding its file sizes. */
type Release = { base: string; pins: Readonly<Record<string, string>>; files: readonly string[]; sizes: "modelFiles" | "rerankerFiles" };
export type DemoRequest =
  | { type: "probe"; mode: Mode; manifestUrl: string }
  | { type: "index"; manifestUrl: string }
  | { type: "load"; device: Device; mode: Mode; manifestUrl: string }
  | { type: "search"; index: SearchIndex; id: number; query: string; k: number }
  | { type: "note"; id: string; version: number; text: string }
  /** Encode the 2,000 passages again, in this browser, with the mode's model: what the prebuilt files save. */
  | { type: "reembed" }
  | { type: "clear-cache" };
/** "bench": the prebuilt 2,000 passages; "notes": the user's own notes, embedded in the browser. */
export type SearchIndex = "bench" | "notes";
/** `denseRank`: the hit's 1-based TurboQuant position, on fused results only. VERIFIED: the card turns it into the move badge (render.js). */
export type DemoHit = { row: number; score: number; text: string; language: number; group: number; denseRank?: number };
export type NoteHit = { id: string; score: number; text: string; denseRank?: number };
export type DemoEvent =
  | { type: "probe"; cached: boolean }
  /** "tokens": the prebuilt token vectors' bytes ("reranker" mode only); "reembed": passages encoded in the browser. */
  | { type: "progress"; phase: "model" | "index" | "tokens" | "reembed"; loaded: number; total: number; /** read from memory or the Cache API */ cached?: boolean }
  | { type: "phase"; phase: "runtime" | "warmup"; done: boolean }
  | { type: "log"; tone: Tone; text: string }
  | { type: "indexed"; vectors: Manifest["vectors"]; documents: Manifest["documents"]; passages: number; languages: readonly string[];
      queries: { text: string; language: number; gold: number; goldGroup: number }[];
      /** Each mode's model download, the `.br` bytes from the manifest. */ downloads: Record<Mode, number> }
  | { type: "ready"; mode: Mode; device: Device; fallback: string | null; ms: number; cached: boolean; downloadedBytes: number }
  | { type: "results"; index: SearchIndex; id: number; query: string; hits: (DemoHit | NoteHit)[]; embedMs: number; scanMs: number; size: number; strategy: string;
      /** Reranking time, on the fused results only. */ rerankMs?: number; /** false: the fused order follows. */ final: boolean }
  /** `shape`: what the note became, "384-d" (a Winzling vector) or "12 x 128-d" (reranker token vectors). */
  | { type: "note"; id: string; version: number; embedMs: number; indexMs: number; count: number; removed: boolean; shape: string }
  | { type: "error"; message: string; index?: SearchIndex; note?: string }
  | { type: "reembedded"; mode: Mode; ms: number; passages: number; model: string }
  | { type: "cleared" };
/** docs/data/manifest.json (scripts/docs/write-index.ts): `bytes` cross the network as `.br`, `rawBytes` are unpacked. */
interface Manifest {
  documents: { file: string; bytes: number; rawBytes: number };
  vectors: { file: string; bytes: number; rawBytes: number };
  modelFiles: Record<FileName, { bytes: number; rawBytes: number }>;
  /** The reranker files the worker loads: MoEdernColBERT 1.5M's tokenizer, runtime contract and q8 graph. */
  rerankerFiles: Record<string, { bytes: number; rawBytes: number }>;
  /** The reranker's prebuilt passage token vectors (scripts/docs/token-format.ts); `sha256` of the decoded file. */
  tokens: { file: string; bytes: number; rawBytes: number; sha256: string } & TokenFileMeta;
}

const RERANKER = MOEDERNCOLBERT_MODELS["1.5m"];
const WINZLING: Release = {
  base: `https://huggingface.co/${WINZLING_MODEL_ID}/resolve/${WINZLING_REVISION}/`, pins: WINZLING_FILES, files: Object.keys(WINZLING_FILES), sizes: "modelFiles",
};
const RERANKER_RELEASE: Release = {
  base: `https://huggingface.co/${RERANKER.id}/resolve/${RERANKER.revision}/`, pins: RERANKER.files,
  files: ["tokenizer.json", "tokenizer_config.json", "runtime.json", "model_q8.onnx"], sizes: "rerankerFiles",
};
/** The releases each mode loads. */
const RELEASES: Record<Mode, readonly Release[]> = { reranker: [RERANKER_RELEASE], embedder: [WINZLING], both: [WINZLING, RERANKER_RELEASE] };
const CACHE_NAME = `defuss-vectorsearch-demo-${WINZLING_REVISION.slice(0, 8)}`;
/** The reranker's pool in "both": TurboQuant's top 25, the library's default. */
const CANDIDATES = 25;
/** Passages per encode call in "reranker", so the page sees the token vectors grow. */
const ENCODE_BATCH = 50;

const post = (event: DemoEvent) => self.postMessage(event);
const log = (tone: Tone, text: string) => post({ type: "log", tone, text });
const mb = (bytes: number) => `${(bytes / 1e6).toFixed(2)} MB`;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
// Cache API needs a secure context; plain-http hosts just download every time.
const openCache = async () => (typeof caches === "undefined" ? undefined : caches.open(CACHE_NAME));

const sha256 = async (bytes: Uint8Array) => Array.from(
  new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer)), (x) => x.toString(16).padStart(2, "0"),
).join("");

/**
 * defuss-brotli's slim decoder with its WASM fetched from next to this worker. Why fetch() instead of init()'s default:
 * the default reads a `file:` URL with node:fs, which a browser lacks, so a page opened from disk failed.
 */
let brotli: Promise<void> | undefined;
const unbrotli = async (bytes: Uint8Array, rawBytes: number): Promise<Uint8Array> => {
  await (brotli ??= initBrotli(fetch(brotliWasmUrl)).catch((error: unknown) => { brotli = undefined; throw error; }));
  try {
    return decompress(bytes);
  } catch (cause) {
    // A host that labels `.br` files `Content-Encoding: br` hands over decoded bytes; the hash checks still apply.
    if (bytes.length === rawBytes) return bytes;
    throw cause;
  }
};

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

let mode: Mode = "reranker";
let embedder: WinzlingEmbedder | undefined;
let reranker: ColbertReranker | undefined;
let demo: DemoIndex | undefined;
/** The passages' texts by row, what the reranker reads for each candidate. */
let passageTexts: string[] = [];
/** "reranker" only: every passage's token vectors by row; kept across reloads of that mode with the same model. */
let passageTokens: TokenMatrix[] | undefined;
let queue: Promise<unknown> = Promise.resolve();

/**
 * The token vectors' Cache API key: a fixed https URL with the file's content hash, never fetched. Why not the file's
 * own URL: the Cache API takes only http(s) keys, and a page opened from disk has `file:` URLs (VERIFIED: Chromium
 * threw "Request scheme 'file' is unsupported", 2026-11-09). The hash means a rebuilt file never matches an old entry.
 */
const tokensKey = (_manifestUrl: string, files: Manifest) => `https://cache.invalid/defuss-vectorsearch-demo/${files.tokens.file}?sha256=${files.tokens.sha256}`;
const isCached = async (wanted: Mode, manifestUrl: string) => {
  const cache = await openCache();
  const urls = RELEASES[wanted].flatMap((release) => release.files.map((file) => release.base + file));
  if (wanted === "reranker") urls.push(tokensKey(manifestUrl, await readManifest(manifestUrl)));
  return !!cache && (await Promise.all(urls.map((url) => cache.match(url)))).every(Boolean);
};
const downloadBytes = (manifest: Manifest, releases: readonly Release[]) => releases.reduce((sum, release) =>
  sum + release.files.reduce((part, file) => part + (manifest[release.sizes] as Record<string, { bytes: number }>)[file]!.bytes, 0), 0);

/**
 * The files of the mode's models through the Cache API, reporting their summed bytes as one "model" phase; `loadFile`
 * for the embedder and the reranker. Each call to `modelLoader` starts a new count, so a reload reports from zero.
 */
const modelLoader = (manifest: Manifest, stats: { downloaded: number }, releases: readonly Release[]) => {
  const sizes = (release: Release) => manifest[release.sizes] as Record<string, { bytes: number; rawBytes: number }>;
  const total = downloadBytes(manifest, releases);
  const loaded = new Map<string, number>();
  const report = (url: string, bytes: number) => {
    loaded.set(url, bytes);
    post({ type: "progress", phase: "model", loaded: [...loaded.values()].reduce((a, b) => a + b, 0), total });
  };
  let finished = 0;
  const count = releases.reduce((sum, release) => sum + release.files.length, 0);
  return (release: Release, label: string) => async (file: string): Promise<Uint8Array> => {
    const url = release.base + file;
    const cache = await openCache();
    const hit = await cache?.match(url);
    let bytes: Uint8Array;
    if (hit) bytes = new Uint8Array(await hit.arrayBuffer());
    else {
      log("info", `fetch ${label} ${file}.br · ${mb(sizes(release)[file]!.bytes)}`);
      const compressed = await download(`${url}.br`, (n) => report(url, n));
      stats.downloaded += compressed.length;
      bytes = await unbrotli(compressed, sizes(release)[file]!.rawBytes);
      // Only verified bytes enter the cache, decoded, so a cached start needs no decoder; the library re-checks every file.
      if (cache && (await sha256(bytes)) === release.pins[file]) {
        await cache.put(url, new Response(new Uint8Array(bytes))).catch((error: unknown) => log("warning", `${file} not cached: ${message(error)}`));
      }
    }
    report(url, sizes(release)[file]!.bytes);
    log("success", `${label} ${file} · ${mb(bytes.length)} · ${hit ? "from cache" : "downloaded"}`);
    if (++finished === count) {
      post({ type: "phase", phase: "runtime", done: false });
      log("info", `ONNX Runtime Web · ${embedder?.device ?? "wasm"} · 1 thread · compiling WebAssembly`);
    }
    return bytes;
  };
};

type Loader = ReturnType<typeof modelLoader>;
/** The models' names on the page; the library pins their Hugging Face repos (src/model-profiles.ts). */
const EMBEDDER_NAME = "Winzling-embed";
const RERANKER_NAME = "Winzling-reranker";
const createEmbedder = (device: Device, loader: Loader) =>
  createWinzlingEmbedder({ device, numThreads: 1, wasmPaths: __ORT_WASM_PATHS__, loadFile: loader(WINZLING, EMBEDDER_NAME) });

/** Both index files, with one progress over their compressed sizes; then the documents and vectors decoded together. */
const loadIndex = async (manifestUrl: string, files: Manifest): Promise<DemoIndex> => {
  const parts = [files.documents, files.vectors];
  const total = parts.reduce((sum, part) => sum + part.bytes, 0);
  const loaded = parts.map(() => 0);
  log("info", `fetch index · ${mb(files.vectors.bytes)} vectors + ${mb(files.documents.bytes)} documents (Brotli)`);
  const [documents, vectors] = await Promise.all(parts.map((part, i) => download(new URL(part.file, manifestUrl).href, (n) => {
    loaded[i] = n;
    post({ type: "progress", phase: "index", loaded: loaded.reduce((a, b) => a + b, 0), total });
  }).then((bytes) => unbrotli(bytes, part.rawBytes))));
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
    // The reranker alone also downloads the passages' token vectors.
    downloads: { reranker: downloadBytes(files, RELEASES.reranker) + files.tokens.bytes, embedder: downloadBytes(files, RELEASES.embedder), both: downloadBytes(files, RELEASES.both) },
  });
  return demo;
};

/**
 * "reranker": every passage's token vectors, prebuilt (scripts/docs/build-index.ts) and kept decoded in the Cache API
 * after their SHA-256 matched the manifest; kept across reloads of this mode with the same model.
 */
const loadTokens = async (manifestUrl: string, files: Manifest, colbert: ColbertReranker, stats: { downloaded: number }): Promise<TokenMatrix[]> => {
  const fingerprint = await colbert.fingerprint();
  const meta = files.tokens;
  if (passageTokens?.[0]?.fingerprint === fingerprint) {
    post({ type: "progress", phase: "tokens", loaded: meta.bytes, total: meta.bytes, cached: true });
    return passageTokens;
  }
  if (meta.fingerprint !== fingerprint) throw new Error(`Token vectors were built with ${meta.fingerprint}, the reranker is ${fingerprint}`);
  const key = tokensKey(manifestUrl, files);
  const cache = await openCache();
  const hit = await cache?.match(key);
  let raw: Uint8Array;
  if (hit) raw = new Uint8Array(await hit.arrayBuffer());
  else {
    log("info", `fetch token vectors · ${mb(meta.bytes)} (Brotli, int${meta.bits})`);
    const packed = await download(new URL(meta.file, manifestUrl).href, (n) => post({ type: "progress", phase: "tokens", loaded: n, total: meta.bytes }));
    stats.downloaded += packed.length;
    raw = await unbrotli(packed, meta.rawBytes);
    if ((await sha256(raw)) !== meta.sha256) throw new Error(`${meta.file}: SHA-256 differs from the manifest`);
    // Caching only saves the next download; a cache that refuses (quota, private mode) must not fail the load.
    await cache?.put(key, new Response(new Uint8Array(raw))).catch((error: unknown) => log("warning", `token vectors not cached: ${message(error)}`));
  }
  post({ type: "progress", phase: "tokens", loaded: meta.bytes, total: meta.bytes, cached: !!hit });
  const passages = decodeTokenVectors(raw, meta);
  if (passages.length !== passageTexts.length) throw new Error(`Token vectors for ${passages.length} passages, the index has ${passageTexts.length}`);
  log("success", `${meta.tokens.toLocaleString("en")} token vectors · int${meta.bits} · ${hit ? "from cache" : "downloaded"}`);
  return passages.map((passage) => ({ data: passage.data, tokenCount: passage.tokenCount, dimensions: meta.dims, fingerprint, truncated: passage.truncated }));
};

/**
 * "Re-embed the index": the mode's model encodes all passages again in this browser, timed, and the searches use the
 * result. The reranker alone re-encodes its token vectors; the other modes re-embed Winzling's vectors and rebuild the
 * TurboQuant index ("both" reranks from text, so its reranker has nothing to re-encode).
 */
const reembed = async () => {
  if (!demo || (!embedder && !reranker)) throw new Error("Load the model first");
  const started = performance.now();
  const total = passageTexts.length;
  const model = mode === "reranker" ? RERANKER_NAME : EMBEDDER_NAME;
  log("info", `re-embed ${total.toLocaleString("en")} passages in this browser · ${model}`);
  if (mode === "reranker") {
    const tokens: TokenMatrix[] = [];
    for (let start = 0; start < total; start += ENCODE_BATCH) {
      tokens.push(...await reranker!.encodeDocuments(passageTexts.slice(start, start + ENCODE_BATCH), { truncate: true }));
      post({ type: "progress", phase: "reembed", loaded: tokens.length, total });
    }
    passageTokens = tokens;
  } else {
    const vectors: Float32Array[] = [];
    for (let start = 0; start < total; start += ENCODE_BATCH) {
      vectors.push(...await embedder!.embedDocuments(passageTexts.slice(start, start + ENCODE_BATCH)));
      post({ type: "progress", phase: "reembed", loaded: vectors.length, total });
    }
    demo = { ...demo, index: buildTurboQuantIndex(vectors) };
  }
  const ms = performance.now() - started;
  log("success", `re-embedded ${total.toLocaleString("en")} passages · ${model} · ${(ms / 1000).toFixed(1)} s`);
  post({ type: "reembedded", mode, ms, passages: total, model });
};

/** The user's notes: what the mode searches with, a Winzling vector or the reranker's token vectors (`encodeNote`). */
const notes = new Map<string, { text: string; version: number; vector?: Float32Array; tokens?: TokenMatrix }>();
let notesIndex: { ids: string[]; index: TurboQuantSearchIndex } | undefined;

/** "reranker" encodes a note into token vectors; the other modes embed it with Winzling ("both" reranks from text). */
const encodeNote = async (text: string, version: number) => (mode === "reranker"
  ? { text, version, tokens: (await reranker!.encodeDocuments([text], { truncate: true }))[0]! }
  : { text, version, vector: (await embedder!.embedDocuments([text]))[0]! });
const shapeOf = (note: { vector?: Float32Array; tokens?: TokenMatrix }) =>
  (note.tokens ? `${note.tokens.tokenCount} x ${note.tokens.dimensions}-d` : `${note.vector?.length ?? 0}-d`);
/** The TurboQuant index over the notes' vectors; rebuilt per change (a handful of 256-byte codes, ~instant). */
const indexNotes = () => {
  const ids = [...notes.keys()];
  notesIndex = mode !== "reranker" && ids.length ? { ids, index: buildTurboQuantIndex(ids.map((key) => notes.get(key)!.vector!)) } : undefined;
};

const load = async (device: Device, nextMode: Mode, manifestUrl: string) => {
  const started = performance.now();
  const files = await readManifest(manifestUrl);
  const cached = await isCached(nextMode, manifestUrl);
  const stats = { downloaded: 0 };
  await embedder?.dispose();
  await reranker?.dispose();
  embedder = undefined;
  reranker = undefined;
  mode = nextMode;
  if (mode !== "reranker") passageTokens = undefined; // 92.5 MB the other modes never read
  const loader = modelLoader(files, stats, RELEASES[mode]);
  // The reranker always runs on WASM, with the embedder's ORT Web settings: those are global (src/ort-runtime.ts).
  const next = mode === "embedder" ? undefined
    : createColbertReranker({ model: "1.5m", numThreads: 1, wasmPaths: __ORT_WASM_PATHS__, loadFile: loader(RERANKER_RELEASE, RERANKER_NAME) });
  const rerankerLoaded = next?.load();
  rerankerLoaded?.catch(() => {}); // awaited below, after the embedder; this only keeps the rejection handled meanwhile
  let fallback: string | null = null;
  let nextEmbedder: WinzlingEmbedder | undefined;
  try {
    if (mode !== "reranker") {
      nextEmbedder = createEmbedder(device, loader);
      try {
        await nextEmbedder.load();
      } catch (error) {
        if (device !== "webgpu") throw error;
        fallback = message(error);
        log("warning", `WebGPU failed: ${fallback} · falling back to WASM`);
        nextEmbedder = createEmbedder("wasm", loader);
        await nextEmbedder.load();
      }
    }
    await rerankerLoaded;
  } catch (error) {
    await next?.dispose();
    await nextEmbedder?.dispose();
    throw error;
  }
  embedder = nextEmbedder;
  reranker = next;
  const ran = (embedder?.device ?? "wasm") as Device;
  post({ type: "phase", phase: "runtime", done: true });
  log("success", `SHA-256 verified · sessions ready · ${[embedder && `${EMBEDDER_NAME} ${ran}`, reranker && `${RERANKER_NAME} wasm`].filter(Boolean).join(" · ")}`);
  const index = await ensureIndex(manifestUrl);
  if (mode === "reranker") passageTokens = await loadTokens(manifestUrl, files, reranker!, stats);
  // Notes written in another mode carry the wrong representation for this one; their cards show the new one.
  const renoted: Extract<DemoEvent, { type: "note" }>[] = [];
  for (const [id, note] of notes) {
    const encoding = performance.now();
    const next = await encodeNote(note.text, note.version);
    notes.set(id, next);
    renoted.push({ type: "note", id, version: note.version, embedMs: performance.now() - encoding, indexMs: 0, count: notes.size, removed: false, shape: shapeOf(next) });
  }
  indexNotes();
  for (const event of renoted) post(event);
  post({ type: "phase", phase: "warmup", done: false });
  const warm = performance.now();
  // One query through the mode's whole search, so the first real search pays no JIT warm-up.
  if (mode === "reranker") rankEncoded((await reranker!.encodeQueries(["warm-up"], { truncate: true }))[0]!, passageTokens!.slice(0, CANDIDATES));
  else {
    const hits = searchTurboQuantIndex(index.index, await embedder!.embedQuery("warm-up"), CANDIDATES);
    if (reranker) await reranker.rerankHits("warm-up", hits, passageTexts, { truncate: true });
  }
  log("success", `warm-up query · ${Math.round(performance.now() - warm)} ms`);
  post({ type: "phase", phase: "warmup", done: true });
  post({ type: "ready", mode, device: ran, fallback, ms: performance.now() - started, cached, downloadedBytes: stats.downloaded });
};

const putNote = async ({ id, version, text }: Extract<DemoRequest, { type: "note" }>) => {
  if (!embedder && !reranker) throw new Error("Load the model first");
  const started = performance.now();
  const removed = !text.trim();
  if (removed) notes.delete(id);
  else notes.set(id, await encodeNote(text, version));
  const embedded = performance.now();
  indexNotes();
  const note = notes.get(id);
  post({ type: "note", id, version, embedMs: removed ? 0 : embedded - started, indexMs: performance.now() - embedded, count: notes.size, removed, shape: note ? shapeOf(note) : "" });
};

/** What each mode's results are called, in every result and on the page. */
const STRATEGY = "TurboQuant";
const FUSED = "TurboQuant + MoEdernColBERT";
const MAXSIM = "MoEdernColBERT MaxSim, all passages";

type Source = {
  size: number; texts: string[]; index: TurboQuantSearchIndex | undefined; tokens: readonly TokenMatrix[];
  hit: (hit: SearchHit) => DemoHit | NoteHit;
};
/** Each index names its texts, its vectors and how a hit becomes a card; the search itself is the same for both. */
const sourceOf = (index: SearchIndex): Source => {
  if (index === "bench") {
    return { size: demo!.passages.length, texts: passageTexts, index: demo!.index, tokens: passageTokens ?? [],
      hit: (hit: SearchHit): DemoHit => ({ row: hit.index, score: hit.score, ...demo!.passages[hit.index]! }) };
  }
  const ids = mode === "reranker" ? [...notes.keys()] : notesIndex?.ids ?? [];
  return { size: notes.size, texts: ids.map((id) => notes.get(id)!.text), index: notesIndex?.index,
    tokens: mode === "reranker" ? ids.map((id) => notes.get(id)!.tokens!) : [],
    hit: (hit: SearchHit): NoteHit => { const id = ids[hit.index]!; return { id, score: hit.score, text: notes.get(id)!.text }; } };
};

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
      if ((!embedder && !reranker) || !demo) throw new Error("Load the model first");
      current = job.index;
      const source = sourceOf(job.index);
      const started = performance.now();
      if (mode === "reranker") {
        // MaxSim of the query against every passage's token vectors; the card's score is its mean per query token.
        const [query] = await reranker!.encodeQueries([job.query], { truncate: true });
        const embedded = performance.now();
        const ranked = source.tokens.length ? rankEncoded(query!, source.tokens).slice(0, job.k) : [];
        post({ type: "results", index: job.index, id: job.id, query: job.query, embedMs: embedded - started, scanMs: performance.now() - embedded,
          size: source.size, strategy: MAXSIM, final: true, hits: ranked.map((hit) => source.hit({ index: hit.index, score: hit.score / query!.tokenCount })) });
        continue;
      }
      const vector = await embedder!.embedQuery(job.query);
      const embedded = performance.now();
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
      post({ ...base, strategy: FUSED, final: true, rerankMs: performance.now() - reranking,
        hits: fused.map((hit) => ({ ...source.hit(byIndex.get(hit.index)!), denseRank: hit.denseRank })) });
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
      if (data.type === "probe") post({ type: "probe", cached: await isCached(data.mode, data.manifestUrl) });
      else if (data.type === "index") await ensureIndex(data.manifestUrl);
      else if (data.type === "note") await putNote(data).catch((error: unknown) => post({ type: "error", message: message(error), note: data.id }));
      else if (data.type === "load") await load(data.device, data.mode, data.manifestUrl);
      else if (data.type === "reembed") await reembed();
      else {
        if (typeof caches !== "undefined") await caches.delete(CACHE_NAME);
        post({ type: "cleared" });
      }
    } catch (error) {
      post({ type: "error", message: message(error) });
    }
  });
};
