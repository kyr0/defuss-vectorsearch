# Plan: download the pinned model files as Brotli `.br` files, decoded with `defuss-brotli/decompressor/slim`

Tick a milestone `- [x]` only when its proof passes, then run `verify` on that milestone's scope.
Human request (2026-11-09): download the models and their runtime files in `.br` form with only the small
decompression export of defuss-brotli; Hugging Face sends large files without transport compression.

## Evidence (probe 2026-11-09, scratch script, Node.js 26.11, defuss-brotli 0.2.0)

VERIFIED:

- `.br` files exist for every file the default models pin, but only at the newest commits: Winzling `dc961ec` and the
  default reranker "1.5m" `bd312df`. The pinned commits `8f37def` and `9d3b299` have none.
- At those commits, every raw file equals the pinned one (LFS SHA-256, or a download for the small files), and every
  `.br` file decompressed with `defuss-brotli/decompressor/slim` matches the pinned raw SHA-256.
- "1.5m-original" (`kyr0/SauerkrautLM-MoEdernColBERT-1.5M-ONNX`) and "27m" have no `.br` files; their pinned commits
  are their newest.
- Hugging Face serves the `.br` files as `application/octet-stream` without `Content-Encoding`, so no runtime decodes
  them by itself. The large raw files (`model_uint4.onnx`, Winzling's `tokenizer.json`) arrive uncompressed from the
  CDN; small files from huggingface.co arrive gzipped.
- Decoding takes 220 ms for the Winzling graph, 18 ms for its tokenizer and 13 ms for the reranker graph (first call,
  WASM decoder in Node.js).

| Files | Raw bytes | `.br` bytes | Saved |
|---|---:|---:|---:|
| Winzling (`model_uint4.onnx`, `tokenizer.json`, `tokenizer_config.json`) | 39,759,598 | 28,806,300 | 27.5% |
| Reranker "1.5m" (`model_q8.onnx`, `tokenizer.json`, `tokenizer_config.json`, `runtime.json`) | 3,827,011 | 2,280,426 | 40.4% |
| The demo's download | 43,586,609 | 31,086,726 | 28.7% |

The decoder adds `decompressor-slim.js` (4,729 bytes) and `decompressor.wasm` (185,531 bytes; 51 kB at Brotli 11 by
the package's README). Its `init()` loads the `.wasm` next to its module, which works in Node.js, Bun and Vite
builds; `bun build` and the demo's single-file worker need its location passed.

## Human decisions (2026-11-09)

1. Drop "1.5m-original" and "27m": their repos have no `.br` files. Only "1.5m" (q8) remains.
2. Mirrors must serve `.br` files. A missing `<file>.br` fails with the `bunx defuss-brotli compress` command that
   creates it; the README documents it.
3. The newest version uses the newest model commits; fingerprints follow the pins, so vectors cached with 0.3.x
   are re-encoded once.
4. Release 0.4.0 (0.3.1 is published; this drops two models and changes every download).

## Design

- `src/pinned-asset.ts` stays the one owner of downloads. Every network download, from Hugging Face or a mirror,
  fetches `<file>.br`, decodes it with `defuss-brotli/decompressor/slim` and accepts it only when the decoded bytes
  match the pinned raw SHA-256. The cache stores the decoded bytes.
- Why no `.br` hash pins: a mirror's `.br` files come from the mirror owner's encoder, so their bytes differ from
  Hugging Face's; the raw hash checks both. The decoder caps output at defuss-brotli's 64 MiB default, above the
  largest pinned file (30.5 MB).
- Why cache decoded bytes rather than `.br`: a warm start never initializes the decoder, and the cache layout,
  `inspectModelCache`, `clearModelCache` and the `loadFile` contract (raw bytes) stay as they are.
- Why `.br` files rather than transport compression: Hugging Face does not compress the large files in transit.
  Why defuss-brotli rather than `DecompressionStream`: its README reports that Chromium 158 rejects `"brotli"` there.
- The decoder module is imported on the first download, as `onnxruntime-web` is: defuss-brotli exports ESM only,
  and the CommonJS build keeps `import()`. VERIFIED: the Vite production bundle with top-level await still loads
  (`scripts/test-browser-bundle.ts`); the 0.2.0 deadlock came from a lazy chunk that imported back from the entry,
  and defuss-brotli imports nothing. Option `brotliWasm` passes the `.wasm` location to `init()` for bundles that do
  not carry it.
- VERIFIED (2026-11-09): Vite's dev server sends `.br` files with `Content-Encoding: br`, so `fetch` decodes them;
  the reader accepts bytes that already match the pin. Pre-bundled by Vite's dev server, the decoder finds no
  `.wasm`, so `vite.config.ts` excludes `defuss-brotli` from `optimizeDeps`.
- HYPOTHESIS: decoding the Winzling graph holds the `.br` bytes, the decoded chunks and their concatenation at once,
  about 90 MB more for a moment in Chromium. Falsifier: a browser probe of `performance.memory` around the first
  load; `make bench` runtimeMiB swings between runs, so it cannot decide this (MEMORY).

## Milestones

- [x] **M1 Pins and removal.** `src/model-profiles.ts`: Winzling `dc961ec`, "1.5m" `bd312df`; "1.5m-original" and
  "27m" removed with their tests, fixtures and docs; `ColbertPrecision` is `q8`. `scripts/download-model.ts` keeps
  each `.br` file and its decoded file in `public/models/`. `package.json`: `defuss-brotli` 0.3.0, exact.
  *Proof:* `make setup` downloads and verifies all files; `make test` passes.
- [x] **M2 Loader.** `src/pinned-asset.ts:readPinnedAsset` as designed, with option `brotliWasm`. *Proof:*
  `src/colbert-reranker.test.ts` against a local HTTP server: a `.br` download decodes and is cached decoded; a
  missing `.br` fails with the `bunx defuss-brotli compress` command; a `.br` of other bytes fails the hash check;
  an offline cached load works.
- [x] **M3 Consumers.** `src/winzling-embedder.ts` and `src/colbert-reranker.ts` pass `brotliWasm` through. `examples/search-worker.ts:loadFile` streams `<file>.br` with byte progress and decodes it;
  `scripts/docs/build-worker.ts` copies `decompressor.wasm` into `docs/assets/`. The Vite fixture and the Bun
  consumer load `.br` files. *Proof:* `make e2e`: `scripts/test-docs.ts` asserts that the model requests are `.br`
  URLs and that the progress total is 31.09 MB; `test-browser-bundle` and `test-bun-consumer` pass.
- [x] **M4 Docs.** README download sizes, the mirror command, the `brotliWasm` option and the `bun build` note; ARCH.md the design
  above; CHANGELOG 0.4.0; `docs/index.html` download figures (model size stays 39.8 MB, download 28.8 MB).
  *Proof:* `vae.py gate` reports `VERIFIED[gate]=true`.

Out of scope: Harrier (unpinned, loaded by Transformers.js, no `.br` files) and the ONNX Runtime WASM files, which
the package loads from `wasmPaths`, not from Hugging Face.
