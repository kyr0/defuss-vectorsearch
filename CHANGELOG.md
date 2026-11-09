# Changelog

## 0.4.0 (2026-11-09)

### Changed

- Model files download as Brotli files: `<file>.br` from the pinned commit, decoded with `defuss-brotli/decompressor/slim` (defuss-brotli 0.3.0, a 185.5 kB WASM decoder). Winzling downloads 28.81 MB instead of 39.76 MB, the reranker 2.28 MB instead of 3.83 MB, and the live demo 31.1 MB instead of 43.6 MB; the website quotes these download sizes. The demo's prebuilt index ships as Brotli files too (`documents.json.br`, `vectors.bin.br`), 730 kB instead of 870 kB gzipped, decoded by the same decoder. Hugging Face sends these files without transport compression. The SHA-256 check and the caches use the decoded files, so a cached model loads without the decoder.
- The pins move to the commits that add the `.br` files: Winzling `dc961ecc2773117fb67114aa7e40adc83730653d`, the reranker `bd312dffe70801e6aa4a53b287f35018aa5dd88e`. Every pinned file is byte-identical, so embeddings and token vectors do not change. Fingerprints name the commit, so `WINZLING_PROFILE.fingerprint` and the reranker's token-vector fingerprint change: caches keyed by fingerprint re-embed once.
- A `modelBaseUrl` mirror must serve each file as `<file>.br`. A missing one fails with the command that creates them, such as `bunx defuss-brotli compress onnx/model_uint4.onnx tokenizer.json tokenizer_config.json`. A server that sends the `.br` files with `Content-Encoding: br`, as Vite's dev server does, works too.
- For Winzling, the client and server `prefetchModel()` downloads the `.br` files and checks each decoded file's SHA-256, as inference does. Before, it fetched the raw files without a hash check.
- Under Vite's dev server, exclude `defuss-brotli` from dependency pre-bundling, as for `onnxruntime-web`. Bundlers that do not carry `defuss-brotli/decompressor.wasm` along, such as `bun build`, pass its location as the new `brotliWasm` option.

### Added

- `make bench` runs the reranker alone over the whole haystack: every passage encoded once into token vectors, each query ranked by MaxSim against all of them (`rankEncoded`), in Node.js and Chromium. `bench.json` moves to schema v3, with `environments.<env>.reranker`. Over the nine target languages in Chromium it reaches R@1 68.0 and R@10 86.9 (Winzling with TurboQuant: 66.2 and 96.2; fused: 78.7 and 97.6), at 1.1 s per query, since each query scores all 180,626 token vectors. Every timing of this run is 8–14% slower than the 0.3.1 run on the same machine, the Node.js runs included; recall is unchanged.
- The live demo has three modes, chosen with icon tabs that show each mode's download and R@10: the reranker alone (the default), Winzling alone or both fused. The reranker alone downloads the passages' token vectors, prebuilt with the index as `docs/data/tokens.bin.br` (int4 with a scale per token, 8.5 MB as Brotli), and ranks all passages by MaxSim. "Re-embed the index" encodes the passages in the browser instead, to show the cost. The page calls the models `kyr0/Winzling-embed` and `kyr0/Winzling-reranker`; the library keeps their Hugging Face repo ids. Notes are re-encoded when the mode changes. WebGPU is pre-selected and falls back to WASM.
- The website's recall card has a tab per mode above the R@k tabs, an average bar over the nine target languages, a download-size line and a "Target languages only" switch (on by default); Fused at R@25 opens first, the figure the hero now states (99% over the target languages). Status changes show as toasts, except the page's first model load, and the search summary shows its steps as badges. The hero shows defuss-shadcn's neuro-noise shader in the page's dark blues; the page moves to defuss-shadcn 0.9.13. "Built with" links defuss-vae, and the cache button reads "Clear stored AI model cache". The hero names Bun next to the browser and Node.js, light mode inverts the "Tokenize, Embed, Retrieve" stage, and the footer links both models and the defuss-shadcn and defuss-vae sites. The site serves `llms.txt` for AI agents: benefits, limits and usage, its figures checked against `bench.json`.

### Removed

- The rerankers `"1.5m-original"` and `"27m"` and their `fp32`, `fp16`, `int8` and `q4` graphs: their repos serve no `.br` files. `"1.5m"` with its `q8` graph remains, and `ColbertPrecision` is `"q8"`.

## 0.3.1 (2026-11-08)

### Changed

- The pinned Winzling release is Hub revision `8f37defd53558efb7f2cc7febf5a9c19a8033bea`. Its `onnx/model_uint4.onnx` (sha256 `b07e0e6f…`) keeps the graph, size and tokenizer of the previous pin, but its 4-bit weights were re-quantized with GPTQ and its block scales distilled from a ColBERT teacher (see the [model card](https://huggingface.co/kyr0/Winzling-Embed-a8m-64k)). Every embedding changes: on the 24 reference texts the new vectors have a cosine of 0.852 to 0.985 with the old ones (median 0.976). Re-embed stored vectors and rebuild TurboQuant indexes made with 0.3.0 or earlier; the browser cache downloads the new release on first use.
- On the bench's nine target languages (Node.js, bruteforce), Winzling's R@1 is 66.7 (0.3.0: 66.4) and R@5 90.7 (92.2). German, English and Russian hold or gain (R@1 76.0 against 75.3, R@5 96.7 in both); the six target languages the model does not support lose (R@5 87.7 against 90.0, Spanish 74 against 84). With the edited 1.5M reranker of 0.3.0, the demo's pipeline, TurboQuant + MoEdernColBERT, reaches R@1 78.7 (0.3.0: 78.0) and R@5 94.9 (94.4).
- The reference fixtures, the benchmark tables and the demo's precomputed passage embeddings come from the new release; the demo's vector index is 436 kB gzipped (431 kB).

## 0.3.0 (2026-11-08)

### Changed

- `createColbertReranker({ model: "1.5m" })` loads a weight edit of SauerkrautLM-MoEdernColBERT-1.5M with 11,998 added Cyrillic tokens, pinned from `kyr0/winzling-embed-SauerkrautLM-MoEdernColBERT-1.5M-weight-space-programming`. It ships `q8` only and is 3.83 MB instead of 3.97 MB. Its model card measures, with exhaustive MaxSim:
  - Upstream card benchmarks: macro nDCG@10 +0.0015 against the original, not significant. GermanDPR (+0.008) and GermanQuAD (+0.003) improve significantly, and nothing gets significantly worse.
  - Russian: the original tokenizer maps Russian to `<unk>`. nDCG@10 on six tasks rises from 0.01–0.16 to 0.35–0.86.
  - `make bench`: Winzling with `rerankHits` reaches R@1 78.0 over the nine target languages, against 77.8 with the original. Russian R@1 falls from 94 to 88. In each of the 3 Russian queries the edit lost, a translation of the gold passage took rank 1.
- Vectors cached from `"1.5m"` with 0.2.x carry the old fingerprint, which `maxSim` refuses to mix with new vectors. Re-encode cached passages.

### Added

- `model: "1.5m-original"` keeps the unedited 1.5M export with `fp32`, `fp16`, `q8` and `int8`.
- `rerankHits` and `fuseRanks` accept `colbertWeight`, the reranker's share of rank fusion from 0 to 1. The default 0.5 keeps today's scores.
- `make bench` also reports any-language recall, which counts a translation of the gold passage as a hit, and records the reranker it ran. `bench.json` moves to schema v2.

### Fixed

- The MoEdernColBERT reranker now tokenizes U+FEFF (byte-order mark) and U+0085 (next line) like the Rust tokenizers library. `@huggingface/tokenizers` 0.2.0 dropped a byte-order mark, which Rust keeps as `<unk>`, and joined the words on either side of U+0085, where Rust splits. The reranker now replaces U+0085 with a space and U+FEFF with U+2060 (word joiner) before tokenizing. Over all code points and 31,178 passages, its token IDs now differ from Rust's only on 96 code points that are newer than Rust's Unicode tables. Cached vectors of texts with either character can still be compared; re-encode them to get the corrected tokens.

## 0.2.1 (2026-10-31)

### Fixed

- `rerankHits` and `fuseRanks` no longer let near-equal ColBERT scores outvote a clear dense winner. When the top dense hit's score leads the second's by `denseMargin` or more (default 0.1), the dense order stands; `denseMargin: Infinity` restores 0.2.0's behavior. In the demo's notes, "Bücher" had put the library note third behind unrelated Russian notes, although Winzling scored it 0.287 against 0.101. On the bench, fusion had never lifted a gold passage to rank 1 among the 87 queries above that margin, and had dropped one from rank 1. `fuseRanks` takes the dense scores as `{ denseScores }`.
- Reranked demo results now explain their order. Cards keep Winzling's similarity, which no longer matches the order after fusion, so a badge with an arrow and a count shows how many places the reranker moved a card up or down, and the summary says "reranked order, Winzling scores".

### Added

- `make bench` reports R@10, and writes the website's recall card from `bench.json`: per-language R@1, R@5, R@10 and R@25 for the demo's default pipeline (Chromium, TurboQuant + MoEdernColBERT) in tabs.

## 0.2.0 (2026-10-31)

### Added

- `rerankHits(query, hits, documents)` on the MoEdernColBERT reranker reranks the first 25 hits of a dense search and fuses the ColBERT order with the dense order (reciprocal rank fusion, k = 60). `fuseRanks` does the same for callers with cached token vectors. On Winzling's top 25 in the bench's nine target languages, this lifted R@1 from 66.4 to 76.2 and R@3 from 83.8 to 91.1. The ColBERT order alone fell below Winzling's own order at 100 candidates.
- `make bench` reports R@1 and a third strategy, TurboQuant + MoEdernColBERT (`rerankHits` over TurboQuant's top 25 with the 1.5M q8 reranker), for both dense models in Node.js and Chromium.
- The live demo loads MoEdernColBERT 1.5M next to Winzling (43.7 MB together) and shows every search's TurboQuant hits at once, then their fused order.
- Bun 1.4 runs the package: `make e2e` installs the packed tarball with `bun add` into a clean app and runs it under Bun on native CPU and WASM; CI repeats this with Bun 1.4.0 and the newest 1.4 release. `package.json` declares `engines.bun >= 1.4.0`.
- `createColbertReranker` in `browser.js` and `onnx.js` reranks the hits of a dense search with SauerkrautLM-MoEdernColBERT (`"1.5m"` or `"27m"`, `q8` by default). It downloads the pinned `kyr0/SauerkrautLM-MoEdernColBERT-*-ONNX` commit, checks every file's SHA-256 and caches the files like the Winzling assets. `maxSim` and `rankEncoded` score token vectors that callers cached themselves. `make test` checks every pinned 1.5M graph and the 27M `q8` graph against the exporter's Python scores in Node.js and Chromium.
- `docs/index.html`: a static demo page built with defuss-shadcn. It loads a prebuilt TurboQuant index of the 2,000 benchmark passages on page load and the model, with byte progress, on the first search; then it searches as you type. The 1,000 benchmark questions sit in a ⌘K palette with gold-passage marks; a second tab embeds notes you write into an in-browser TurboQuant index and searches them; a coding-agent prompt links this repository. `make docs` rebuilds its index and worker bundle; `make e2e` drives it in Chromium.
- `defuss-vectorsearch/browser.js`: a browser-only ESM entry with the Winzling embedder and TurboQuant search. It downloads the pinned model on first use and caches it in the Cache API and IndexedDB. Its Vite bundle contains no Transformers.js, `defuss-multicore` or Node code; `make e2e` checks this.
- `make bench` measures Winzling and Harrier on the 20-language tiny-embedding-bench-v1 dataset. Each model runs in Node.js (native ONNX Runtime) and headless Chromium (WASM), with bruteforce and TurboQuant search. Results go to `bench.json` and the README. The README's overall recall counts the nine languages the models target (`TARGET_LANGUAGES`). `make download-bench` fetches the dataset and checks its pinned SHA-256.

### Fixed

- Browser apps that await embeddings at module top level no longer hang in a Vite production build. The IndexedDB cache lazily imported `defuss-db/client.js`, and Vite's lazy chunk imported back from the still-evaluating entry chunk, which deadlocked. The provider is now imported statically.
- `modelProfile: "winzling"` no longer runs the pinned Winzling graph under another repo ID. Before, `loadModel()` with the Harrier ID or a fork kept the profile and returned Winzling embeddings while `model` reported the other ID. Repo sources other than `kyr0/Winzling-Embed-a8m-64k` now throw. HTTP(S) mirrors work as before.
- A mirror URL with a trailing slash now uses the same cache keys in `prefetchModel()`, `inspectModelCache()` and `clearModelCache()` as in inference. Such URLs re-download their files once.
- `package.json` credits Aron Homberg as author, matching `LICENSE`.

### Changed

- Renamed the package to `defuss-vectorsearch` 0.1.0. The Node cache directory and the browser IndexedDB name follow the new name, so files cached under `defuss-embeddings` are downloaded again.
- Development uses Bun (`bun.lock`) and `make` verbs (`setup`, `lint`, `test`, `coverage`, `e2e`, `verify`) instead of npm. Node 22.18+ still runs the package. CI runs `make setup` and `make verify`.
