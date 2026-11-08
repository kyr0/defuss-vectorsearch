/**
 * Writes the demo index as two gzipped files plus docs/data/manifest.json with their exact sizes: `bytes` is what
 * crosses the network (the page's progress and transfer figures), `rawBytes` what the browser unpacks.
 * Why gzip at build time instead of trusting the host: pre-gzipped files are the same size on every host, and the
 * worker unpacks them with the browser's native DecompressionStream.
 * VERIFIED: vectors.bin.gz is 436,261 bytes, the 436 kB the page shows (scripts/test-docs.ts compares them).
 * HYPOTHESIS: GitHub Pages would not gzip a binary file itself; falsifier: `curl -sI --compressed <pages-url>/data/vectors.bin.gz`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { encodeDemoIndex, type DemoIndex } from "./index-format.ts";

export interface DemoManifest {
  documents: { file: string; bytes: number; rawBytes: number };
  vectors: { file: string; bytes: number; rawBytes: number };
  modelFiles: Record<string, number>;
  /** The reranker files the worker loads (tokenizer, runtime contract, q8 graph), by name. */
  rerankerFiles: Record<string, number>;
}

export const writeDemoIndex = async (
  demo: DemoIndex, modelFiles: Record<string, number>, rerankerFiles: Record<string, number>, outDir = "docs/data",
): Promise<DemoManifest> => {
  const { documents, vectors } = encodeDemoIndex(demo);
  await mkdir(outDir, { recursive: true });
  const write = async (file: string, raw: Uint8Array) => {
    const packed = gzipSync(raw, { level: 9 });
    await writeFile(path.join(outDir, file), packed);
    return { file, bytes: packed.length, rawBytes: raw.length };
  };
  const manifest: DemoManifest = {
    documents: await write("documents.json.gz", new TextEncoder().encode(documents)),
    vectors: await write("vectors.bin.gz", vectors),
    modelFiles,
    rerankerFiles,
  };
  await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
};
