/**
 * Browser-only entry: Winzling embeddings + TurboQuant search, nothing else.
 * VERIFIED: scripts/test-browser-bundle.ts shows that a Vite production build of this entry contains no Node built-in,
 * Transformers.js or defuss-multicore code, and a reload serves the model from the browser cache.
 * The isomorphic `onnx.js` entry cannot promise that: its cache layer lazily imports the Node filesystem cache.
 */
import { loadBrowserCachedModelFile, storeBrowserCachedModelFile } from "./model-cache.browser.js";
import { WinzlingEmbedderCore, type WinzlingAssetCache, type WinzlingOptions } from "./winzling-embedder.js";

export {
  poolWinzling,
  WINZLING_FILES,
  WINZLING_MODEL_ID,
  WINZLING_PROFILE,
  WINZLING_REVISION,
  type WinzlingAssetCache,
  type WinzlingAssetLocation,
  type WinzlingOptions,
} from "./winzling-embedder.js";
export * from "./turboquant.js";
export { normalizeVector, normalizeVectors } from "./vector-math.js";
export type { SearchHit, TurboQuantSearchIndex, TurboQuantRerankedSearchHit, TurboQuantRerankResult, Vectors } from "./types.js";

/** Cache API first, IndexedDB as the durable copy; `cacheDir` is a filesystem concept and is ignored here. */
const browserCache: WinzlingAssetCache = {
  load: async ({ cacheKey, remoteUrl }) => (await loadBrowserCachedModelFile(cacheKey, remoteUrl))?.bytes ?? null,
  store: ({ cacheKey, remoteUrl }, file) => storeBrowserCachedModelFile({ ...file, cacheKey, remoteUrl }),
};

export class WinzlingEmbedder extends WinzlingEmbedderCore {
  constructor(options: Omit<WinzlingOptions, "device" | "cacheDir"> & { device?: "wasm" | "webgpu" | undefined } = {}) {
    super(options, browserCache);
  }
}

/**
 * Downloads the pinned Winzling release from Hugging Face on first use (SHA-256 checked), caches it in the
 * Cache API and IndexedDB, and reuses one ONNX Runtime Web session for every call.
 */
export const createWinzlingEmbedder = (options: ConstructorParameters<typeof WinzlingEmbedder>[0] = {}): WinzlingEmbedder =>
  new WinzlingEmbedder(options);
