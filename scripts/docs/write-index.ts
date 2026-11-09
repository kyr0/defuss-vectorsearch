/**
 * Writes the demo index as three Brotli files (`.br`, node:zlib at quality 11: passages, TurboQuant vectors and the
 * reranker's token vectors) plus docs/data/manifest.json with their exact sizes and the token file's SHA-256, which the
 * worker checks before caching it: `bytes` is what crosses the network (the page's progress and transfer figures), `rawBytes` what the
 * browser unpacks.
 * Why Brotli at build time instead of trusting the host: pre-compressed files are the same size on every host, and the
 * worker decodes them with defuss-brotli's slim decoder, which it loads for the model files anyway. Brotli instead of
 * gzip: VERIFIED (2026-11-09) the passages shrink to 318 kB instead of 434 kB and the vectors to 412 kB instead of 436 kB.
 * HYPOTHESIS: GitHub Pages sends `.br` files without `Content-Encoding`; falsifier: `curl -sI <pages-url>/data/vectors.bin.br`.
 * The worker accepts already decoded bytes either way.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { brotliCompressSync } from "node:zlib";
import { encodeDemoIndex, type DemoIndex } from "./index-format.ts";
import type { TokenFileMeta } from "./token-format.ts";

export interface DemoManifest {
  documents: { file: string; bytes: number; rawBytes: number };
  vectors: { file: string; bytes: number; rawBytes: number };
  /** Winzling's files by name: `bytes` of the `.br` file the worker downloads, `rawBytes` decoded. */
  modelFiles: Record<string, ModelFileSize>;
  /** The reranker files the worker loads (tokenizer, runtime contract, q8 graph), sized like `modelFiles`. */
  rerankerFiles: Record<string, ModelFileSize>;
  /** The reranker's passage token vectors (scripts/docs/token-format.ts), for the "reranker" mode. */
  tokens: { file: string; bytes: number; rawBytes: number; sha256: string } & TokenFileMeta;
}
export interface ModelFileSize { bytes: number; rawBytes: number }

export const writeDemoIndex = async (
  demo: DemoIndex, modelFiles: Record<string, ModelFileSize>, rerankerFiles: Record<string, ModelFileSize>,
  tokens: { bytes: Uint8Array; meta: TokenFileMeta }, outDir = "docs/data",
): Promise<DemoManifest> => {
  const { documents, vectors } = encodeDemoIndex(demo);
  await mkdir(outDir, { recursive: true });
  const write = async (file: string, raw: Uint8Array) => {
    const packed = brotliCompressSync(raw); // quality 11, node:zlib's default
    await writeFile(path.join(outDir, file), packed);
    return { file, bytes: packed.length, rawBytes: raw.length };
  };
  const manifest: DemoManifest = {
    documents: await write("documents.json.br", new TextEncoder().encode(documents)),
    vectors: await write("vectors.bin.br", vectors),
    modelFiles,
    rerankerFiles,
    // The worker caches the decoded file under this hash and checks it before use.
    tokens: { ...await write("tokens.bin.br", tokens.bytes), sha256: createHash("sha256").update(tokens.bytes).digest("hex"), ...tokens.meta },
  };
  await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
};
