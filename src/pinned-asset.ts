/**
 * Reads one file of a pinned Hugging Face release, from a caller's loader, the cache or the network, and accepts it
 * only when its SHA-256 matches the pin. Winzling and the MoEdernColBERT reranker share this one reader, so the
 * integrity and cache rules cannot drift apart between models. VERIFIED: src/colbert-reranker.test.ts covers download,
 * cache reuse, an offline miss and a hash mismatch against a local HTTP server.
 */
import { buildNodeCacheKey, buildRemoteModelFileUrl, resolveModelSource } from "./model-source.js";

/** Where a verified asset is cached; `cacheDir` matters only to the filesystem cache. */
export interface PinnedAssetLocation {
  readonly cacheDir: string | null | undefined;
  readonly cacheKey: string;
  readonly remoteUrl: string;
}

export interface PinnedAssetCache {
  load(location: PinnedAssetLocation): Promise<Uint8Array | null>;
  store(location: PinnedAssetLocation, file: {
    bytes: Uint8Array;
    fileName: string;
    modelId: string;
    revision: string;
    contentType: string;
  }): Promise<void>;
}

export interface PinnedAssetOptions {
  /** Mirror of the pinned release. Assets are checked against their SHA-256 hashes. */
  modelBaseUrl?: string | undefined;
  /** Overrides ALL asset I/O, for local files, bundled bytes, or application storage. */
  loadFile?: ((relativePath: string) => Promise<Uint8Array>) | undefined;
  cache?: boolean | undefined;
  cacheDir?: string | null | undefined;
  allowRemoteModels?: boolean | undefined;
}

/** A release: its label for error messages, Hugging Face ID, commit and the SHA-256 of every file. */
export interface PinnedRelease {
  readonly label: string;
  readonly modelId: string;
  readonly revision: string;
  readonly files: Readonly<Record<string, string>>;
}

export const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, "0")).join("");
};

export const readPinnedAsset = async (
  release: PinnedRelease,
  name: string,
  options: PinnedAssetOptions,
  cache: PinnedAssetCache,
): Promise<Uint8Array> => {
  const expected = release.files[name];
  if (!expected) throw new Error(`${release.label} release pins no file named ${name}`);
  const source = resolveModelSource(options.modelBaseUrl ?? release.modelId, { revision: release.revision });
  const remoteUrl = buildRemoteModelFileUrl(source, name);
  const location = { cacheDir: options.cacheDir, cacheKey: buildNodeCacheKey(source, name), remoteUrl };
  let bytes: Uint8Array;
  let downloaded = false;
  if (options.loadFile) {
    bytes = await options.loadFile(name);
  } else {
    const cached = options.cache === false ? null : await cache.load(location);
    if (cached) bytes = cached;
    else {
      if (options.allowRemoteModels === false) throw new Error(`${release.label} asset missing from cache: ${name}; remote loading disabled`);
      const response = await fetch(remoteUrl);
      if (!response.ok) throw new Error(`${release.label} download failed: ${name} (HTTP ${response.status})`);
      bytes = new Uint8Array(await response.arrayBuffer());
      downloaded = true;
    }
  }
  // Hash both network and cached bytes: stale/corrupt caches must not change outputs silently.
  if (await sha256Hex(bytes) !== expected) throw new Error(`${release.label} SHA-256 mismatch: ${name}. Use the pinned release or clear its corrupt cache.`);
  if (downloaded && options.cache !== false) {
    await cache.store(location, { bytes, fileName: name, modelId: source.modelId,
      revision: source.revision, contentType: name.endsWith(".json") ? "application/json" : "application/octet-stream" });
  }
  return bytes;
};
