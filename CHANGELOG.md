# Changelog

## Unreleased

### Added

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
