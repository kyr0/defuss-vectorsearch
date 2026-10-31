import { loadCachedModelFile, resolveModelCacheDir, storeCachedModelFile } from "./model-cache.js";
import type { EmbedOptions, FeatureExtractorLike } from "./types.js";
import { WinzlingEmbedderCore, type WinzlingAssetCache, type WinzlingOptions } from "./winzling-embedder.js";
import { ColbertRerankerCore, type ColbertRerankerOptions } from "./colbert-reranker.js";

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
export {
  fuseRanks,
  maxSim,
  rankEncoded,
  type ColbertEncodeOptions,
  type ColbertModel,
  type ColbertPrecision,
  type ColbertRerankerOptions,
  type FuseOptions,
  type FuseRanksOptions,
  type FusedHit,
  type RerankedHit,
  type TokenMatrix,
} from "./colbert-reranker.js";
export { MOEDERNCOLBERT_MODELS } from "./model-profiles.js";
// The public classes extend these; exporting their types keeps consumers' declaration emit portable (TS2742).
// VERIFIED: with these exports pkgroll no longer warns about private types in the .d.ts entries.
export type { ColbertRerankerCore } from "./colbert-reranker.js";
export type { WinzlingEmbedderCore } from "./winzling-embedder.js";

/** Filesystem cache in Node.js, Cache API + IndexedDB in browsers. */
const isomorphicCache: WinzlingAssetCache = {
  load: async ({ cacheDir, cacheKey, remoteUrl }) =>
    (await loadCachedModelFile({ cacheDir: await resolveModelCacheDir(cacheDir), cacheKey, remoteUrl }))?.bytes ?? null,
  store: async ({ cacheDir, cacheKey, remoteUrl }, file) => {
    await storeCachedModelFile({ ...file, cacheDir: await resolveModelCacheDir(cacheDir), cacheKey, remoteUrl });
  },
};

export class WinzlingEmbedder extends WinzlingEmbedderCore {
  constructor(options: WinzlingOptions = {}) {
    super(options, isomorphicCache);
  }
}

export const createWinzlingEmbedder = (options: WinzlingOptions = {}): WinzlingEmbedder => new WinzlingEmbedder(options);

export class ColbertReranker extends ColbertRerankerCore {
  constructor(options: ColbertRerankerOptions) {
    super(options, isomorphicCache);
  }
}

/**
 * MoEdernColBERT reranker with the same filesystem/browser cache and SHA-256 pins as Winzling. VERIFIED:
 * src/colbert-reranker.live.test.ts reloads it from a filesystem cache with remote loading disabled.
 */
export const createColbertReranker = (options: ColbertRerankerOptions): ColbertReranker => new ColbertReranker(options);

/** Bridge to the existing client/server API without changing the Harrier pipeline. */
export const createWinzlingExtractor = async (options: WinzlingOptions): Promise<FeatureExtractorLike> => {
  const embedder = createWinzlingEmbedder(options);
  await embedder.load();
  const extractor: FeatureExtractorLike = async (input, callOptions) => {
    const vectors = await embedder.embed(input, callOptions as EmbedOptions);
    const data = new Float32Array(vectors.length * 384);
    vectors.forEach((vector, i) => data.set(vector, i * 384));
    return { data, dims: [vectors.length, 384], type: "float32" };
  };
  extractor.dispose = () => embedder.dispose();
  return extractor;
};
