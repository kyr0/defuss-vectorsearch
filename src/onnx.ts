import { loadCachedModelFile, resolveModelCacheDir, storeCachedModelFile } from "./model-cache.js";
import type { EmbedOptions, FeatureExtractorLike } from "./types.js";
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
