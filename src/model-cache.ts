// VERIFIED: browser-path modules are imported statically (scripts/test-browser-bundle.ts). A lazy import makes
// Vite emit a chunk that imports back from the entry chunk, which deadlocks apps using top-level await.
import { loadBrowserCachedModelFile, storeBrowserCachedModelFile } from "./model-cache.browser.js";

const isNodeRuntime = (): boolean => {
  return typeof process !== "undefined" && process.release?.name === "node";
};

export const resolveModelCacheDir = async (
  cacheDir?: string | null,
): Promise<string | null> => {
  if (cacheDir) {
    return cacheDir;
  }

  if (!isNodeRuntime()) {
    return null;
  }

  const { getDefaultNodeCacheDir } = await import("./model-cache.node.js");
  return getDefaultNodeCacheDir();
};

export const loadCachedModelFile = async (options: {
  cacheDir: string | null;
  cacheKey: string;
  remoteUrl: string;
}): Promise<{
  bytes: Uint8Array;
  contentType: string | null;
  location: "filesystem" | "browser-cache" | "browser-db";
} | null> => {
  if (isNodeRuntime()) {
    const { getDefaultNodeCacheDir, readNodeCachedFile } = await import("./model-cache.node.js");
    const file = await readNodeCachedFile(options.cacheDir ?? getDefaultNodeCacheDir(), options.cacheKey);

    return file ? { ...file, location: "filesystem" } : null;
  }

  return loadBrowserCachedModelFile(options.cacheKey, options.remoteUrl);
};

export const storeCachedModelFile = async (options: {
  cacheDir: string | null;
  cacheKey: string;
  remoteUrl: string;
  fileName: string;
  modelId: string;
  revision: string;
  bytes: Uint8Array;
  contentType: string | null;
}): Promise<"filesystem" | "browser-db"> => {
  if (isNodeRuntime()) {
    const { getDefaultNodeCacheDir, writeNodeCachedFile } = await import("./model-cache.node.js");
    await writeNodeCachedFile(
      options.cacheDir ?? getDefaultNodeCacheDir(),
      options.cacheKey,
      options.bytes,
    );
    return "filesystem";
  }

  await storeBrowserCachedModelFile(options);
  return "browser-db";
};
