# defuss-vectorsearch

Isomorphic (browser and Node.js) JavaScript library for vector search using Winzling Embedding model and TurboQuant. 

- Model download size (from HF): ~30.5 MB weights + 9.29 MB tokenizer
  - can be reduced further with compression (Zstd) when model is served from a CDN (~32 MB all-in is possible) 
- Index size: 4-bit over padded dimensions (TurboQuant) - **211 KiB** _gzipped_ for 1,000 documents indexed
- Single embedding speed (**CPU/WASM**, p95): ~123 ms (needle vector)
- Memory (RAM) footprint (runtime): ~200 MB
- Model loading time (p95): ~375 ms
- Search in TurboQuant index (p95): ~206 ms (needle against haystack)
- Recall (R@5): **~97%** for the top 3 languages (German, Russian, English) in [tiny-embedding-bench](https://github.com/kyr0/tiny-embedding-bench)

## Use case

Generate an index over documents server-side; store the index publicly.
Client downloads the index; if the user searches, embed the query as needle vector, run the search against the TurboQuant index downloaded to the client. 
Because the user types longer than the embedding model takes for downloading and loading, the perceived latency is reduced to < 0.5s (perceived as _instant_).

Combined with `defuss-search`, which offers classic exact search, phonetic and fuzzy search, as well as rank fusion with vector search, you get a comprehensive isomorphic (in-browser + Node.js) search solution for both structured and unstructured data.

## Quick start: browser, Winzling + TurboQuant

```ts
import { buildTurboQuantIndex, createWinzlingEmbedder, searchTurboQuantIndex } from "defuss-vectorsearch/browser.js";

const embedder = createWinzlingEmbedder(); // one ONNX Runtime Web session, reused for every call
const documents = ["The cat sleeps on the sofa.", "Die Börse schloss heute im Plus.", "Кошка спит на диване."];
const index = buildTurboQuantIndex(await embedder.embedDocuments(documents));
const hits = searchTurboQuantIndex(index, await embedder.embedQuery("A sleeping cat on a couch."), 2);
console.log(hits.map((hit) => documents[hit.index])); // both cat sentences
```

VERIFIED by `scripts/test-browser-bundle.ts` (part of `make e2e`) and one run against huggingface.co:

- **Auto-download and cache.** The first call downloads the pinned Winzling release from Hugging Face (39.76 MB) and checks every file's SHA-256. It stores the files in the Cache API and IndexedDB. A reload makes no model request: 3.7 s cold, 0.4 s warm in headless Chromium.
- **Bundle contents.** `browser.js` holds the Winzling embedder, TurboQuant search and `normalizeVector`. A Vite production build of the snippet contains no Transformers.js, `defuss-multicore`, `onnxruntime-node` or Node built-in code. It is 340 KB of JavaScript plus the 26.78 MB ONNX Runtime Web WASM, which Vite emits next to the bundle by itself.
- **Bundlers.** Only Vite was tested. Under Vite's dev server, keep `onnxruntime-web` out of dependency pre-bundling (`optimizeDeps: { exclude: ["onnxruntime-web"] }`), as this repo's `vite.config.ts` does. With another bundler, pass `wasmPaths` pointing at a copy of `onnxruntime-web/dist/`, as the demo does with `"/ort/"`.
- **Format.** The entry is ESM-only and accepts `device: "wasm"` (default) or `"webgpu"`.

This is the smallest and fastest setup in the [benchmark](#benchmark): 39.8 MB instead of 305 MB to download, 2.8× faster embedding in Chromium, and a TurboQuant index 6× smaller than float32. It retrieves less well than Harrier in the nine languages both models target (German, Russian, English, French, Indonesian, Dutch, Italian, Portuguese, Spanish). R@3 is 83.8% against 98.9%, and R@25 is 98.9% against 100% (Node.js, bruteforce). Its weakest target languages are Portuguese and Spanish, at 76% and 74% R@3. When the top 3 must be right, use Harrier through `client.js`.

## Start from this download

Bun installs dependencies and runs scripts. Node **22.18+** executes the TypeScript
(native type stripping) and the native ONNX Runtime; tested with Node 24.19.0 on Linux x64.

```sh
make setup                      # bun install, Playwright Chromium, build, model assets
node examples/node.ts           # CPU via ONNX Runtime Web/WASM
node examples/node.ts --cpu     # native Node CPU
bun run demo                    # open the printed localhost URL
```

`make setup` skips the optional CUDA download; the native CPU binaries ship in the
`onnxruntime-node` package, so Bun's blocked postinstall for it is harmless.

The ZIP includes the exact model graph and tokenizer under
`public/models/winzling/`. `models:download` validates their SHA-256 hashes;
when absent, it downloads the pinned release. It also copies the installed
ORT WASM/JavaScript assets into `public/ort/` for the local browser demo.
The model and runtime assets are ignored by Git and excluded from the npm tarball.
After dependency installation and asset preparation, the examples need no network.

Without `make` (e.g. Windows PowerShell), set `$env:ONNXRUNTIME_NODE_INSTALL_CUDA='skip'`,
then run `bun install`, `bunx playwright install chromium`, `bun run build` and
`bun run models:download`. A minimal Linux host needs `make setup PLAYWRIGHT_FLAGS=--with-deps`.

## Static demo page

`docs/index.html` is a standalone page built with defuss-shadcn from its CDN. On page load it fetches
a prebuilt index of the 2,000 benchmark passages; the first search loads the pinned Winzling model
with byte progress, and later searches run as you type. The ⌘K palette lists the 1,000 benchmark
questions by language; for those, the results mark the gold passage and its translations. A second
tab is a vector database you fill yourself: each note you write is embedded in the browser 500 ms
after you stop typing (or when it loses focus) into a TurboQuant index you can search right beside it.
The "Use it" section gives a prompt that points a coding agent at this repository.

```sh
python3 -m http.server -d docs 8080   # serves docs/ at http://localhost:8080/
make docs                            # rebuilds docs/data/ (~9 min) and docs/assets/search-worker.js
```

VERIFIED by `scripts/test-docs.ts` (part of `make e2e`), which serves the model and ONNX Runtime
from the local mirrors:

- **Prebuilt index.** In Chromium, Winzling embeds a passage in 123 ms on average and a query in
  21 ms (p50, `bench.json`). Indexing 2,000 passages in the browser would take about 4 minutes, so
  `make docs` embeds them once in Node.js. `docs/data/vectors.bin.gz` holds the 4-bit TurboQuant
  index (0.51 MB raw, 431 kB gzipped); `docs/data/documents.json.gz` the passages and questions
  (438 kB gzipped). They are gzipped at build time, so every host sends the same bytes, and the
  worker unpacks them with the browser's `DecompressionStream`.
- **No bundler on the page.** `examples/search-worker.ts` becomes one 294 KB file,
  `docs/assets/search-worker.js`. ONNX Runtime's `onnxruntime-web-use-extern-wasm` export condition
  keeps its WASM out of the bundle; the worker fetches it from jsDelivr at the installed version,
  and the model from Hugging Face. Both answer cross-origin requests.
- **Downloads on request.** Typing alone downloads nothing; the model downloads with the first search
  (the Search button, an example query) or "Load the model". The worker keeps the three files in the
  Cache API, and a reload loads them from there with no model request.
- **Steady scroll.** Picking an example query keeps the scroll position, so the re-ranked results
  stay in view.

## Supported models

| Model | Runtime | Pooling / queries |
|---|---|---|
| `kyr0/Winzling-Embed-a8m-64k` | Direct ONNX + `@huggingface/tokenizers` | Masked mean; unchanged, unprefixed input |
| `tss-deposium/harrier-oss-v1-270m-onnx-int8` | Existing Transformers.js pipeline | Existing last-token pooling and instruction formatting |
| `onnx-community/harrier-oss-v1-270m-ONNX` | Existing Transformers.js pipeline, `dtype: "q4"` | Existing Harrier behavior |

The no-argument client/server factory still defaults to Harrier. Explicit
OpenAI-compatible endpoints and existing vector-search exports are retained.
See [the preserved upstream README](docs/UPSTREAM_README.md) for those APIs and
historical benchmarks; those benchmark results were not reproduced for this release.

## Narrow Winzling entry point

```ts
import { createWinzlingEmbedder } from "defuss-vectorsearch/onnx.js";

const embedder = createWinzlingEmbedder({ device: "wasm" });
try {
  const documents = await embedder.embedDocuments([
    "The cat sleeps on the sofa.",
    "Die Katze schläft auf dem Sofa.",
    "Кошка спит на диване.",
  ]);
  const query = await embedder.embedQuery("A sleeping cat on a couch.");
  console.log(documents.length, query.length); // 3, 384
} finally {
  await embedder.dispose();
}
```

`onnx.js` does not import Transformers.js. The retained legacy dependencies
remain in the package's installation footprint. This release does not split
or remove them.

Methods: `load()`, `embed()`, `embedOne()`, `embedDocuments()`, `embedQuery()`,
`embedQueries()`, `dispose()`. `load()` is optional; inference initializes lazily.
Embeddings are `Float32Array`s. Empty batches return `[]`; empty strings are
encoded with the model's special tokens. Query whitespace is preserved.
Nonempty `instruction` or `preset` options are rejected for Winzling.

The provider fingerprint identifies the preset. Include `maxLength`, `truncate`,
and per-call normalization overrides in application embedding-cache keys.

Concurrent calls are serialized per instance. `dispose()` waits for accepted
work, releases the session, is idempotent, and rejects subsequent inference.
Initialization failures can be retried. There is no hosted-inference fallback.

## Existing client/server API

```ts
import { createEmbeddingServer, WINZLING_MODEL_ID } from "defuss-vectorsearch/server.js";

const embedder = createEmbeddingServer({
  model: WINZLING_MODEL_ID,
  device: "cpu", // use "wasm" for portable CPU execution
  winzling: { batchSize: 8 },
});
try {
  const vector = await embedder.embedQuery("Eine Suchanfrage");
  console.log(vector.length); // 384
} finally {
  await embedder.dispose();
}
```

The browser equivalent is `createEmbeddingClient` from `client.js`.
Known model IDs select their profile automatically. A Winzling mirror can use
`{ model: "https://example.com/models/winzling", modelProfile: "winzling" }`.
The folder must contain the unchanged pinned files at their original paths.
Use `WINZLING_MODEL_ID`, `WINZLING_PROFILE`, and `SUPPORTED_MODELS` for discovery.

Winzling's `dtype: "q4"` is selected automatically; its exact graph filename is
`onnx/model_uint4.onnx`. There is no external `.onnx_data` file. Arbitrary model
revisions, other dtypes, and non-mean pooling are not supported by this preset.

Legacy `prefetchModel()`, `inspectModelCache()`, and `clearModelCache()` know the
Winzling asset manifest. Actual inference verifies all three asset hashes,
including cache hits. `loadFile` bypasses this cache, so cache-management methods
do not inspect an application's custom loader/storage.

## Options and deployment

| `createWinzlingEmbedder` option | Default / behavior |
|---|---|
| `device` | `"wasm"`; `"cpu"` is Node-only; `"webgpu"` is experimental |
| `batchSize` | 8; bounded microbatches with right padding |
| `maxLength` | 8192 tokens including BOS/EOS; valid range 2–8192 |
| `truncate` | `false`; excess length throws. `true` preserves terminal EOS |
| `normalize` | `true`; per-call `normalize: false` returns the mean vector |
| `modelBaseUrl` | Optional HTTP(S) mirror of the pinned release |
| `loadFile` | Optional `(relativePath) => Promise<Uint8Array>` overriding all asset I/O |
| `cache` | `true`; filesystem in Node; Cache API + IndexedDB in browsers |
| `cacheDir` | Node OS temporary directory / `defuss-vectorsearch` |
| `allowRemoteModels` | `true`; `false` requires cached files unless `loadFile` is supplied |
| `wasmPaths` | ORT default; self-hosting example: `"/ort/"` |
| `numThreads` | 1; avoids a cross-origin-isolation requirement for WASM |

The wrapper APIs take these provider settings inside `winzling: { ... }`;
their existing top-level `device`, `normalize`, `cacheDir`, and
`allowRemoteModels` settings are also supported. Prefer the top-level settings
when using the wrapper APIs. For filesystem assets, use `winzling.loadFile`,
not the legacy Transformers.js `localModelPath` option.

Native Node CPU uses `onnxruntime-node@1.21.0`, matching the retained
Transformers.js dependency so two incompatible native ORT libraries are not
loaded into one process. The native peer is optional; the development checkout
installs it. ORT Web is pinned independently to `1.30.0` and the tokenizer to
`0.2.0`.

The included demo runs tokenization and inference in a dedicated module Worker,
serves all assets from localhost, and uses exact cosine similarity for display.
Do not enable ORT's proxy-worker mode for WebGPU. The provider sets it to false.
WASM paths and thread settings are global ORT configuration: use consistent
settings across instances and configure other users of ORT before initialization.
HTTPS or localhost is needed for browser cryptography, storage, and WebGPU APIs.

WebGPU requests require a usable adapter; absence throws instead of quietly
selecting CPU. When an adapter is available, the session requests WebGPU with
WASM for unsupported operators. Hardware WebGPU inference was **not verified**
in this environment. CPU paths are the validated defaults. GPU token states are
currently read back for pooling in TypeScript; GPU graph pooling is deferred.

8192 is the model's context limit, not a promise of low memory use at that length.
Long inputs can create large attention tensors. For retrieval, chunk upstream
or choose a smaller explicit `maxLength`; automatic chunking is outside this package.

## Benchmark

```sh
make bench   # downloads bench/dataset.json once (make download-bench), then writes bench.json and the tables below
```

The benchmark uses [tiny-embedding-bench-v1](https://github.com/kyr0/tiny-embedding-bench/tree/main/datasets/tiny-embedding-bench-v1):
100 Belebele passages and 50 questions, each in 20 languages, with one gold passage per question.
`download-bench` checks the file against the release's pinned SHA-256.

- **Scope.** Overall R@k and *Rank ±10%* count only queries in the nine target languages: `deu_Latn`, `rus_Cyrl`, `eng_Latn`, `fra_Latn`, `ind_Latn`, `nld_Latn`, `ita_Latn`, `por_Latn`, `spa_Latn` (`TARGET_LANGUAGES` in `scripts/bench/dataset.ts`). That is 450 of the 1,000 queries. The other 11 languages' passages stay in the haystack as distractors. `bench.json` keeps per-language results for all 20 languages, and its `overall` fields average all 20; the README derives the nine-language values from the per-language ones. Timing and memory cover all 2,000 passages and 1,000 queries.
- **Haystack.** All 2,000 localized passages form one index. A query also competes with the 19
  translations of its own gold passage. The target is the gold passage in the query's language,
  so R@100 measures a 5% slice of the haystack.
- **Strategies.** *Bruteforce* is a dot product of the query against every normalized passage vector:
  float32, no quantization, no ANN. *TurboQuant* scores the same vectors from the 4-bit index
  (`buildTurboQuantIndex`) without exact reranking.
- **Metrics.**
  - R@k is the share of queries whose target ranks within the top k.
  - *Rank ±10%* is the share of queries where TurboQuant places the target within ±10% of its bruteforce rank. An exact rank below 10 must be matched exactly.
  - Embedding time is the mean per text, one text per call, on one warm session per model.
  - Search time is the mean per query for the top 100.
  - Passage ms per method is the passage's embedding time plus an equal share of that method's index build: normalization for bruteforce, 4-bit quantization for TurboQuant.
  - Query ms per method is the query's embedding time plus its own search time.
  - Model runtime memory is the growth in resident memory over load and embedding, measured after a forced GC, minus the embedding arrays held at that point. That is process RSS in Node.js and renderer RSS in Chromium.
  - Runtime MiB per method is the model runtime plus the exact index size. Both indexes live in one process, and their difference (0.5 to 4 MiB) is smaller than RSS noise, so it is added rather than measured.
- **Environments.**
  - Node.js runs the built package on native ONNX Runtime (`device: "cpu"`). Winzling uses 1 thread. Harrier uses ONNX Runtime's default thread count, because Transformers.js sets none.
  - Chromium runs the same build on ONNX Runtime Web (`device: "wasm"`, 1 thread) in headless Playwright. It loads the model files the Node run cached in `bench/cache/`.

<!-- bench:start -->
Generated by `make bench` on 2026-10-07 · Apple M4, 10 cores, darwin arm64.
Runtimes: Node.js v24.14.0; Chromium 140.0.7339.16 headless (Playwright).

### Embedding

One text per call, warm session; model runtime = memory growth over load + embedding, without the held vectors:

| Environment | Model | Device | Load ms | Embed passage ms | Embed query ms | Model runtime MiB |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Node.js | Winzling | cpu | 212 | 54.2 (p95 172.1) | 11.1 (p95 29.9) | 233.31 |
| Node.js | Harrier | cpu | 1440 | 37.2 (p95 52.2) | 20.7 (p95 24.9) | 497.61 |
| Chromium | Winzling | wasm | 685 | 123.1 (p95 375.5) | 29.7 (p95 66.8) | 205.87 |
| Chromium | Harrier | wasm | 2478 | 347.8 (p95 480.3) | 162.7 (p95 215.5) | 230.38 |

### Retrieval Quality

The 9 target languages: `deu_Latn`, `rus_Cyrl`, `eng_Latn`, `fra_Latn`, `ind_Latn`, `nld_Latn`, `ita_Latn`, `por_Latn`, `spa_Latn`; their 450 queries against all 2000 passages in 20 languages; R@k = % of queries whose gold passage ranks in the top k:

| Environment | Model | Strategy | R@3 | R@5 | R@25 | R@100 | Rank ±10% |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| Node.js | Winzling | bruteforce | 83.8 | 92.2 | 98.9 | 99.3 | n/a |
| Node.js | Winzling | TurboQuant | 82.9 | 91.6 | 98.9 | 99.3 | 88.9% |
| Node.js | Harrier | bruteforce | 98.9 | 99.3 | 100 | 100 | n/a |
| Node.js | Harrier | TurboQuant | 98.9 | 99.3 | 100 | 100 | 98.7% |
| Chromium | Winzling | bruteforce | 83.8 | 92.2 | 98.9 | 99.3 | n/a |
| Chromium | Winzling | TurboQuant | 82.9 | 91.6 | 98.9 | 99.3 | 88.9% |
| Chromium | Harrier | bruteforce | 98.4 | 99.3 | 100 | 100 | n/a |
| Chromium | Harrier | TurboQuant | 98.9 | 99.1 | 100 | 100 | 97.3% |

### Cost per Method

Passage = embed + share of the index build; query = embed + top-100 search; runtime = model runtime + index:

| Environment | Model | Strategy | Passage ms | Query ms | Search ms mean | Index build ms | Runtime MiB | Index MiB |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Node.js | Winzling | bruteforce | 54.2 (p95 172.1) | 11.5 (p95 30.3) | 0.405 | 5.3 | 236.24 | 2.93 |
| Node.js | Winzling | TurboQuant | 54.2 (p95 172.1) | 11.6 (p95 30.3) | 0.463 | 13.6 | 233.8 | 0.49 |
| Node.js | Harrier | bruteforce | 37.2 (p95 52.2) | 21.3 (p95 25.6) | 0.659 | 4.0 | 502.5 | 4.88 |
| Node.js | Harrier | TurboQuant | 37.3 (p95 52.2) | 21.7 (p95 25.9) | 0.977 | 24.6 | 498.59 | 0.98 |
| Chromium | Winzling | bruteforce | 123.2 (p95 375.5) | 30.1 (p95 67.1) | 0.382 | 1.8 | 208.8 | 2.93 |
| Chromium | Winzling | TurboQuant | 123.2 (p95 375.5) | 30.1 (p95 67.3) | 0.455 | 10.9 | 206.36 | 0.49 |
| Chromium | Harrier | bruteforce | 347.8 (p95 480.3) | 163.3 (p95 216.1) | 0.629 | 4.8 | 235.26 | 4.88 |
| Chromium | Harrier | TurboQuant | 347.8 (p95 480.3) | 163.6 (p95 216.4) | 0.946 | 21.9 | 231.36 | 0.98 |

### Per Language, Node.js

Target languages, best first by Winzling bruteforce; cells: R@3 / R@5 / R@25 / R@100; Chromium and all 20 languages are in `bench.json`:

| Language | Winzling bruteforce | Winzling TurboQuant | Harrier bruteforce | Harrier TurboQuant |
| --- | --- | --- | --- | --- |
| `deu_Latn` | 92 / 96 / 100 / 100 | 92 / 94 / 100 / 100 | 98 / 98 / 100 / 100 | 98 / 98 / 100 / 100 |
| `rus_Cyrl` | 92 / 94 / 98 / 100 | 92 / 94 / 98 / 100 | 98 / 98 / 100 / 100 | 98 / 98 / 100 / 100 |
| `eng_Latn` | 90 / 100 / 100 / 100 | 90 / 100 / 100 / 100 | 100 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| `fra_Latn` | 84 / 94 / 100 / 100 | 84 / 92 / 100 / 100 | 100 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| `ind_Latn` | 84 / 92 / 96 / 96 | 76 / 92 / 96 / 96 | 98 / 100 / 100 / 100 | 98 / 100 / 100 / 100 |
| `nld_Latn` | 82 / 90 / 98 / 98 | 82 / 88 / 98 / 98 | 98 / 100 / 100 / 100 | 98 / 100 / 100 / 100 |
| `ita_Latn` | 80 / 86 / 100 / 100 | 84 / 90 / 100 / 100 | 100 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| `por_Latn` | 76 / 94 / 100 / 100 | 74 / 92 / 100 / 100 | 100 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| `spa_Latn` | 74 / 84 / 98 / 100 | 72 / 82 / 98 / 100 | 98 / 98 / 100 / 100 | 98 / 98 / 100 / 100 |

Node.js vs Chromium vectors for the same passages: Winzling min cosine 1 over 40 passages; Harrier min cosine 0.98881 over 40 passages.
<!-- bench:end -->

## Findings

`make bench` regenerates the tables above. This analysis is written by hand and cites the 2026-10-07 run.

### Index Size

VERIFIED: TurboQuant stores 5 to 6 times less than bruteforce. Bruteforce keeps a float32 vector per passage. TurboQuant keeps 4-bit codes over the dimensions padded to a power of two (384 → 512, 640 → 1024). The index grows with the corpus while the model stays fixed, so the gap matters most in browsers. It decides the IndexedDB footprint, what must be downloaded or synced, and what stays resident.

| Model | Bruteforce per vector | TurboQuant per vector | 2,000 passages (measured) | 100,000 passages (projected) |
|---|---:|---:|---:|---:|
| Winzling (384 dims) | 1,536 B | 256 B | 2.93 → 0.49 MiB | 146.5 → 24.4 MiB |
| Harrier (640 dims) | 2,560 B | 512 B | 4.88 → 0.98 MiB | 244.1 → 48.8 MiB |

At 2,000 passages the model's 200 to 500 MiB runtime still dwarfs either index.

### Download Size

VERIFIED: measured from the cached model files and from the Chromium page's network requests up to the "loaded" event. MB = 10⁶ bytes.

| Model | Model files | Of which ONNX graph | Of which tokenizer | Browser runtime WASM (uncompressed) |
|---|---:|---:|---:|---:|
| Winzling | 39.76 MB (37.92 MiB) | 30.46 MB | 9.29 MB | 26.78 MB, ONNX Runtime Web 1.30 asyncify build, self-hosted from `/ort/` |
| Harrier | 304.68 MB (290.56 MiB) | 270.14 MB | 34.54 MB | 21.60 MB, the ONNX Runtime Web build bundled with Transformers.js 3.8.1, loaded from jsDelivr |

- Hugging Face sends the model files uncompressed: no `Content-Encoding` header, and `Content-Length` equals the file size.
- jsDelivr sends Harrier's runtime WASM brotli-compressed, 4.11 MB on the wire. A self-hosted `/ort/` gets the same saving only if its server compresses `.wasm` files.
- Node.js downloads only the model files. Its ONNX Runtime ships as a native npm binary.
- Winzling's sizes are fixed by its pinned revision. Harrier loads its repository's `main` branch, so its files can change.
- Node.js caches every file on the filesystem, so later loads skip the network. In headless Chromium, Transformers.js could not store Harrier's 270 MB graph in the Cache API ("Unexpected internal error"). Whether a regular browser profile keeps it between visits was not tested.

### Quality, Speed, and Caveats

**Quality.** VERIFIED: over the nine target languages, TurboQuant without reranking stays within 0.9 points of bruteforce at every R@k, for both models in both environments, and is sometimes slightly ahead. The largest gap is Winzling R@3 (82.9 vs 83.8). From R@25 on, both strategies agree for both models. Harrier keeps the gold passage within ±10% of its bruteforce rank for 97 to 99% of queries, Winzling for 89%.

**Speed.** VERIFIED: TurboQuant gives no speed advantage at 2,000 passages. Its search is slightly slower than bruteforce (Winzling 0.46 vs 0.40 ms, Harrier 0.98 vs 0.66 ms in Node.js). Embedding dominates both: a query costs 11 to 164 ms end to end, and the search method changes that by under 0.4 ms.

**Caveats.**

- VERIFIED: the memory saving holds only without exact reranking. `searchTurboQuantIndexRerank` re-scores candidates against the float32 vectors, so it needs them in memory. To keep the small footprint, use `searchTurboQuantIndex`, or store the float32 vectors elsewhere (IndexedDB, a server) and fetch only the top candidates. The benchmark measured `searchTurboQuantIndex` only, with no reranking variant.
- VERIFIED: the evidence base is small. Overall recall rests on 450 target-language queries against 2,000 passages, so a 0.9-point gap is 4 queries, on one dataset.
- VERIFIED: nothing here covers corpora larger than 2,000 passages. [docs/BENCHMARK.md](docs/BENCHMARK.md) lists the open questions for larger corpora and how to test them.

## Verify

```sh
make verify   # lint → test → coverage → e2e; CI runs the same after `make setup`
```

`lint` runs oxlint. `test` runs the Node and Chromium regression suites and real
Winzling CPU/browser inference. `coverage` prints the Node suite's line coverage.
`e2e` builds ESM/CJS/declarations, typechecks the examples and scripts against them,
exercises the built package exports, tests the Worker demo (report in `output/`),
builds the demo, rebuilds the static demo's worker and drives `docs/` in Chromium. Individual commands are listed in `Makefile` and `package.json`.

The checked-in oracle contains **24 multilingual and adversarial cases** made
with Rust tokenizers and Python native ONNX Runtime. Tests require exact token-ID
agreement and compare normalized embeddings within `2e-5` maximum absolute error,
including padded batches against independently generated singleton vectors.
Fixtures cover Unicode, whitespace, special tokens, empty text, and byte fallback.
Other tests cover pooling, normalization, explicit truncation, corruption,
initialization retry, concurrent calls, disposal, and offline browser-cache reuse.

To regenerate the independent oracle:

```sh
python -m pip install -r scripts/reference-requirements.txt
python scripts/generate-reference.py
```

See [source provenance](docs/SOURCE_PROVENANCE.json) and
[model details and licensing](docs/MODEL.md). This verifies runtime behavior,
not retrieval quality on your application's corpus.

## License

MIT
