# Changelog

## 0.3.0 (2026-11-08)

### Changed

- `createColbertReranker({ model: "1.5m" })` loads a weight edit of SauerkrautLM-MoEdernColBERT-1.5M with 11,998 added Cyrillic tokens, pinned from `kyr0/winzling-embed-SauerkrautLM-MoEdernColBERT-1.5M-weight-space-programming`. It ships `q8` only and is 3.83 MB instead of 3.97 MB. Its model card measures, with exhaustive MaxSim:
  - Upstream card benchmarks: macro nDCG@10 +0.0015 against the original, not significant. GermanDPR (+0.008) and GermanQuAD (+0.003) improve significantly, and nothing gets significantly worse.
  - Russian: the original tokenizer maps Russian to `<unk>`. nDCG@10 on six tasks rises from 0.01–0.16 to 0.35–0.86.
  - `make bench`: Winzling with `rerankHits` reaches R@1 78.0 over the nine target languages, against 77.8 with the original. Russian R@1 falls from 94 to 88. In each of the 3 Russian queries the edit lost, a translation of the gold passage took rank 1.
- Vectors cached from `"1.5m"` with 0.2.x carry the old fingerprint, which `maxSim` refuses to mix with new vectors. Re-encode cached passages.

### Added

- `model: "1.5m-original"` keeps the unedited 1.5M export with `fp32`, `fp16`, `q8` and `int8`.
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
