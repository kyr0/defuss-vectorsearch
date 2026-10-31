# Plan: MoEdernColBERT ONNX: prove 1.5M, add 27M, per-model HF folders, defuss-vectorsearch reranker

Tick a milestone `- [x]` only when its proof passes, then run `verify` on that milestone's scope.
Two repos: the exporter `feat-moederncolbert-onnx/` (FEAT, its own git repo) and defuss-vectorsearch (ROOT).

## Status (2026-10-31)

M0 to M8 are done; ROOT's gate reports `VERIFIED[gate]=true`, and the ROOT commit waits for the human. FEAT commits `bb20b6f` (ZIP baseline) and `85ec87d` (milestones) passed FEAT's
gate (`VERIFIED[gate]=true`). The human uploaded both folders: 1.5M at `f386a021490a5cd9202a049024561420655065ae`,
27M at `b6d6e21126d3910842181cde752a9aafde1c4bed`. VERIFIED: the HF tree API reports the same SHA-256 for every
file as the local upload folders. The human chose `q8` as the recommended precision for both models.
Deviations from the plan:

- The HYPOTHESIS about urllib held: outside the sandbox it downloaded the 27M tokenizer 3 of 3 times
  with the pinned hash, so `source.download` keeps urllib.
- The CLI command is `parity` (it was `verify`); `make parity` matches it.
- `make start` serves the demo on port 4791. Port 4173 was held by defuss-vectorsearch's
  `scripts/serve-docs.mjs`, which made the first readiness probe accept the wrong server.
- Playwright's Chromium 1193 install stalled on this Mac. The browser checks ran on the installed
  Chrome for Testing 153 headless shell through `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` in FEAT's
  gitignored `.env`.
- VERIFIED: the 27M q4 graph passes the gate narrowly (mean token cosine 0.9852, top-5 overlap 0.908).
- M7: the fixture is one file per model, `fixtures/moederncolbert-{1.5m,27m}-reference.json`. The ORT Web guard
  is `src/ort-runtime.ts:loadOrtWeb`, next to `loadOrtNode` and `describeOrt`; the reader is
  `src/pinned-asset.ts:readPinnedAsset`. Real-tokenizer checks live in the live tests, not the unit test.
- M7: VERIFIED defect found by the live test: `rerank` queued query and document encoding as two operations, so a
  `dispose()` between them rejected an accepted call. `rerank` is now one queued operation.
- M7: VERIFIED: one Node.js run of the built `dist/onnx.mjs` with an empty `cacheDir` downloaded both `q8` releases
  from huggingface.co at the pinned commits, passed the SHA-256 checks and ranked the Zugspitze passage first.
- M7: Playwright's installer stalled again while extracting Chromium 1193. Both 1193 builds were fetched with curl
  from `cdn.playwright.dev` and unpacked with `ditto` into the Playwright cache; ROOT's browser suites run on them.

## Human decisions (2026-10-30)

- FEAT becomes its own git repo in place (`git init`). ROOT keeps ignoring it (`.gitignore:30`, the user's uncommitted line).
- Variants per model: fp32, fp16, q8 (INT8 weights, FP32 math), int8 (dynamic INT8), q4 (4-bit MatMulNBits).
- ROOT gets a reranker API; the human chose this over a compatibility proof alone.
- HF repos: `kyr0/SauerkrautLM-MoEdernColBERT-1.5M-ONNX` and `kyr0/SauerkrautLM-MoEdernColBERT-27M-ONNX`.

## Evidence (probes 2026-10-30)

Probe environment: macOS 26.7.1 arm64, uv Python 3.11.17, torch 2.6.0, onnx 1.23.2, Python onnxruntime 1.31.1,
transformers 5.22.0, sentence-transformers 6.2.0, Node v26.11.1. The JS runtimes were FEAT's onnxruntime-node 1.30.0 and
ROOT's pinned onnxruntime-node 1.21.0 and onnxruntime-web 1.30.0 (WASM, run in Node). The probe scripts live outside
both repos (session scratchpad) and are not part of any deliverable.

- VERIFIED[1.5M, FEAT unchanged] `moedern-onnx export|quantize|verify` pass on this Mac. FP32 vs upstream max abs error 6.3e-7.
  Q8 vs FP32: mean token cosine 0.9971, top-1 agreement 24/24, top-5 overlap 0.975.
- VERIFIED[1.5M] FEAT's Node runtime reproduces the Mac-built fixture exactly (error 0) for fp32 and q8. ROOT ORT node 1.21.0 stays within 7.5e-7 and ROOT ORT
  web 1.30.0 WASM within 9.7e-7; top-1 is 24/24 in every runtime.
- VERIFIED[1.5M export determinism] Mac and the shipped Linux graphs have identical nodes and initializer names. Only the RoPE
  cos/sin tables differ, by 6e-8 (1 ulp). Graph SHA-256 therefore differs per build platform, so each published folder's
  graphs, manifest, fixture and model card must come from one build.
- VERIFIED[27M] Upstream `modeling_modernbert_hash_moe_v10.py`, `moe_triton.py`, `tokenizer*.json` and `LICENSE` are
  byte-identical to 1.5M. Only the config differs: hidden 640, hash_projections 80, heads 10/5 (kv), expert_dim 640,
  a Dense head from 640 to 128 dimensions. Revision `d2b7b1feaaac1bf87510ca9525208c3daeabcc5a`; model.safetensors has SHA-256 `a258ed25…0a59`,
  which equals HF `x-linked-etag`.
- VERIFIED[27M, scratch dimension-generic copy of `portable.PortableEncoder`] FP32 vs upstream max error 6.3e-7. Q8 mean
  token cosine 0.9991, top-1 24/24, top-5 0.992. FEAT's Node runtime and ROOT's Node and WASM runtimes match the Python fixture within 1.03e-6.
- VERIFIED[27M grouped MoE path] Upstream switches to `_inferenz_gruppiert` above 1,220 tokens per batch. Its batches of
  3×512 and 4×512 tokens match the ONNX graph within 6.3e-7. The current `validation.verify` never reaches that path (its
  largest batch is 2×512).
- VERIFIED[variants, Python ORT, retrieval fixture, vs FP32; the int8 and q4 probes left the token table in FP32]

  | model | variant | bytes | mean cos | top-1 | top-5 |
  |---|---|---:|---:|---:|---:|
  | 1.5M | fp16 | 3,239,914 | 0.99986 | 1.0 | 1.0 |
  | 1.5M | int8 dyn | 3,432,689 | 0.99625 | 1.0 | 0.983 |
  | 1.5M | q4 b32 | 2,925,188 | 0.95594 | 1.0 | 0.875 |
  | 27M | fp16 | 54,519,032 | 0.99993 | 1.0 | 1.0 |
  | 27M | int8 dyn | 35,024,173 | 0.99779 | 1.0 | 0.975 |
  | 27M | q4 b32 | 25,475,478 | 0.98508 | 1.0 | 0.908 |

- VERIFIED[1.5M q4] The 0.98 mean-cosine gate fails for every probed setting: b16 sym 0.961, b32 asym 0.954, b32 with
  the projection head kept in FP32 0.959.
- VERIFIED[cross-runtime] q4 token outputs match across Python, Node 1.21 and WASM 1.30 within 7.7e-7. fp16 and int8 do NOT match
  Python exactly: fp16 token error up to 0.066 (score 0.106), int8 token error up to 0.152 (score 0.668). Measured against
  the same runtime's FP32, both still pass: in Node and WASM, fp16 mean cosine is at least 0.9999 and int8 at least 0.991, top-1 24/24,
  top-5 at least 0.942.
- VERIFIED[FEAT `source.download`] Python urllib failed in 3 of 3 attempts on 27M `tokenizer.json` with IncompleteRead in this sandbox,
  while curl succeeded on the same URL.
- VERIFIED[pins] The 1.5M `upstream/source-manifest.json` hashes of the LFS files equal HF `x-linked-etag`. For non-LFS
  files the etag is a git SHA-1, so those pins come from the downloaded bytes.
- UNKNOWN[real Chromium on macOS] BC the sandbox blocks local port binding and Playwright's Chromium 1193 is not
  installed; probe=`make browser-test` (FEAT) with local binding allowed.
- HYPOTHESIS[urllib IncompleteRead] is caused by the sandbox proxy; falsifier=`uv run --frozen moedern-onnx download --model 27m`
  outside the sandbox.

## Contracts

- **Artifact folder** (owner: FEAT `exporting.py`). `manifest.json` (schema_version 1, nothing published yet), `runtime.json`,
  tokenizer files, and flat `model_<precision>.onnx` names. The JS loader rejects `/` in names, so there is no `onnx/`
  subfolder. Each `models.<p>` gains `parity: "exact"|"quality"` and `quantization`. Checks: the FEAT folder test (M4),
  the parity fixture (M3), and ROOT live tests (M7).
- **Precision contract** (owner: FEAT `validation.CONTRACTS`, also written into the parity fixture, so JS reads the
  thresholds and never re-declares them):
  - exact (fp32, q8, q4): cross-runtime token error at most 1e-4, score error at most 1e-3, identical top-1.
  - quality (fp16, int8): compared with the same runtime's FP32. Mean token cosine at least 0.98 (fp16 at least 0.999), top-1 at least 0.95,
    top-5 at least 0.90.
  - fp32 additionally: max error vs upstream PyTorch below 1e-4.
- **Fingerprint** for exact precisions is `revision:graphSha256`. For quality precisions it also appends the runtime
  (`:cpu|:wasm`), because cached token matrices from different runtimes differ by up to 0.668 in score. Check: unit test
  in both JS implementations.
- **Shipped set** is `ModelSpec.precisions`. 1.5M ships fp32, fp16, q8, int8. q4 is excluded because it fails the gate
  (mean cosine 0.956, below 0.98); shipping it needs an explicit, documented lower gate. 27M ships all five.

## Milestones (FEAT)

- [x] **M0 Repo bootstrap.** Run `git init` in `feat-moederncolbert-onnx/`. The first commit is the imported ZIP state,
  with `upstream/**/*.safetensors`, `artifacts/*.onnx` and `parity-fixture.json` ignored. Then run
  `python3 …/defuss-vae/0.9.0/scripts/vae.py init --repo feat-moederncolbert-onnx`.
  `Makefile`: rename `verify` to `parity` and `benchmark` to `bench`; add `start|stop|status|log` (serve `web-dist` with
  `vite preview`, pid in `tmp/`, logs in `var/log/`), `lint`, `coverage` and `e2e`; `verify: lint test coverage e2e`.
  Add `pytest-cov` and `oxlint` as dev dependencies. *Proof:* the gate's layout checks pass, and the existing
  `uv run pytest` and `node --test tests-js` still pass.
- [x] **M1 Two models, generic graph.**
  - `src/moederncolbert_onnx/source.py:ModelSpec,MODELS` holds slug, model_id, revision, repo_name,
    `files{name: sha256}` pinned in code, and precisions. `download(spec, dest)` and `verify_source(spec, path)` check
    the code pins instead of the trust-on-first-use manifest.
  - IF the HYPOTHESIS falsifier still shows IncompleteRead outside the sandbox THEN replace urllib with
    `huggingface_hub.hf_hub_download` (an installed dependency).
  - `cli.py:main` gets a required `--model {1.5m,27m}`. Defaults become `upstream/<slug>`,
    `output/hf/<repo_name>` (the upload folder), `output/parity/<slug>.json` and `reports/<slug>/`. Move the existing
    `upstream/*` to `upstream/1.5m/`.
  - `portable.py:PortableEncoder,Block` read dimensions, layer count and top_k from config, and size the Dense head from
    its weight shape. Guard: every layer is `attn_moe`, `conv_dilations` is empty, there is one shared expert, positions
    at most 512, and the tokenizer maps `[Q]` to 30000 and `[D]` to 30001.
  - `exporting.py:export_fp32` reads model_id, revision and `dimensions` from the spec and the Dense config.
  - `validation.py:verify` adds raw shape (3, 512) to cover the grouped MoE path.
  - *Proof:* `make parity MODEL=1.5m` and `MODEL=27m` pass. New `tests/test_models.py` uses real files: `verify_source`
    rejects a 1-byte-modified copy, and `PortableEncoder` rejects a config with a conv layer.
  - *Why-doc:* ARCH.md explains why one generic tensor-only graph beats exporting upstream custom code (Triton,
    data-dependent paths, `trust_remote_code` at runtime).
- [x] **M2 Variants.** `exporting.py:quantize_q8(mode)` becomes `build_variants(artifacts, spec)`, with
  `_quantize_table` shared (the existing row-wise INT8 table).
  - fp16: `onnxruntime.transformers.float16.convert_float_to_float16(keep_io_types=True)`.
  - q8: the existing weight-only branch.
  - int8: the existing dynamic branch, written to `model_int8.onnx`.
  - q4: `MatMulNBitsQuantizer(block_size=32, is_symmetric=True, nodes_to_exclude=routers)` after `_quantize_table`
    (run `uv add onnx-ir`).
  - The `--q8-mode` flag goes away.
  - *Proof:* covered by M3's gates. HYPOTHESIS: quantizing the table keeps int8 and q4 above their gates; the M3 gates
    are the falsifier.
- [x] **M3 Per-precision contracts.**
  - `validation.py:CONTRACTS` gates every precision in `spec.precisions`. The fixture stores the outputs, scores and
    `thresholds` of every precision.
  - `scripts/parity-check.mjs:verifyEncoders` iterates the fixture's precisions: exact tolerances, or quality vs the
    same runtime's FP32 using `fixture.thresholds`.
  - `src/index.ts:Precision,createEncoder,ColBERTEncoder.fingerprint` and `runtime.py:Encoder` accept the precisions
    listed in the manifest, using the fingerprint rule above.
  - `verify-node.mjs`, `verify-browser.mjs` and `prepare-demo.mjs` take `MODEL`. The demo gets a model selector.
  - *Proof:* `make parity` and `node scripts/verify-node.mjs` for both models, plus `make browser-test` for every
    shipped precision of both models, which also resolves the browser UNKNOWN. JS tests cover the fingerprint rule.
- [x] **M4 Upload folders.** `exporting.py:write_model_card(spec, folder, report)` generates `README.md`, the HF model
  card.
  - Front matter: license apache-2.0, `base_model: VAGOsolutions/…`, `base_model_relation: quantized`, languages, tags.
  - Body: a files table (precision, bytes, sha256, contract), quality numbers copied from the report, upstream
    revision, the conversion steps (Apache-2.0 §4b notice of changes), limits (512 positions, all experts evaluated,
    the fixture is a smoke test and not a benchmark), and Python and JS usage.
  - `MODEL-LICENSE.txt` becomes `LICENSE`, and `parity-report.json` is copied in. The folder contains exactly these
    files plus manifest, runtime, tokenizer and the shipped graphs.
  - *Proof:* `tests/test_upload_folder.py` builds both folders and asserts the exact file set, each manifest hash
    against its bytes, card numbers equal to the report, and the front-matter keys.
- [x] **M5 FEAT gate, docs, CI.**
  - `make e2e` does three things:
    1. Run `uv build`, then `uv run --isolated --no-project --with dist/*.whl moedern-onnx …` in a clean dir. Every CLI
       command runs once (download against the pinned cache, export, quantize, parity, demo, bench) for both models.
    2. Run `bun pm pack`; a clean consumer installs the tgz, loads every precision in every `output/hf/*` folder through
       the Node entry, reranks `input/queries.json`, and writes `output/e2e-node-<slug>.json`.
    3. Run Playwright against `make start`, covering every shipped precision of both models in the demo and `validation.html`. It
       fails on console errors or failed requests and writes its report to `output/`.
  - CI: `.github/workflows/verify.yml` runs `make setup && make verify` and caches `upstream/` keyed by the pinned
    hashes.
  - Docs: rewrite `README.md` (both models, variant table from `reports/<slug>/`, Mac and CI environments, VERIFIED
    only). New `ARCH.md`: why weight-only q8 is the exact default, exact vs quality contracts, operations, security
    (code-pinned SHA-256, `trust_remote_code` only on pinned local files at export, no network at inference) and
    privacy (on-device).
  - *Proof:* `vae.py gate --repo feat-moederncolbert-onnx` reports VERIFIED[gate]=true.
- [x] **M6 Human: upload.** `hf upload kyr0/SauerkrautLM-MoEdernColBERT-1.5M-ONNX output/hf/SauerkrautLM-MoEdernColBERT-1.5M-ONNX .`,
  then the same for 27M. Report both HF commit SHAs; M7 pins them.

## Milestones (ROOT, branch `feat/colbert-reranker`)

- [x] **M7 Reranker API.**
  - Step 0: `python3 …/vae.py update migrate --repo .` (moves `.agents/` to `.vae/`).
  - `src/model-profiles.ts:MOEDERNCOLBERT_MODELS`: for `"1.5m"` and `"27m"`: id, M6 revision, `files{name: sha256}` from
    the published manifests, precisions.
  - Extract `winzling-embedder.ts:readAsset` into one pinned-asset reader (fetch, cache, SHA-256) shared by Winzling
    and the reranker. Extract the module-level `webConfiguration` guard into one `configureOrtWeb()` that owns the
    global ORT Web state.
  - New `src/colbert-reranker.ts:ColbertRerankerCore` ports FEAT `src/index.ts`: Preprocessor, `maxSim`,
    `rankEncoded`, serial queue, integrity check before session creation. It takes devices `wasm|cpu`, model and
    precision; offers `encodeQueries`, `encodeDocuments`, `rerank(query, documents, {topK})`, `dispose` and
    `fingerprint`; and accepts the options `truncate|batchSize|documentLength|modelBaseUrl|loadFile|cache|wasmPaths`.
  - `src/onnx.ts` and `src/browser.ts` bind their caches in `createColbertReranker`, the same way as Winzling.
  - `scripts/download-model.ts` fetches 1.5M in all shipped precisions plus 27M q8 into `public/models/<repo_name>/`.
  - `fixtures/moederncolbert-reference.json` is a small fixture (6 queries and 8 documents, scores per precision, token
    counts) generated by a new FEAT command `moedern-onnx reference`.
  - *Proof:*
    - `src/colbert-reranker.test.ts`: real tokenizer, validation errors, negative and tied MaxSim, checksum failure
      before session, fingerprint rule.
    - `src/colbert-reranker.live.test.ts`: Node cpu and wasm against the fixture for every 1.5M precision plus 27M q8.
    - A Chromium vitest browser test with 1.5M q8.
    - `scripts/test-package.ts` and `scripts/test-browser-bundle.ts` call `createColbertReranker` through the exports
      map; the browser bundle stays free of Node code.
    - The existing Winzling suites still pass, which checks the extracted reader and the ORT Web guard.
- [x] **M8 ROOT docs + gate.** Add a `README.md` section "Rerank dense hits with MoEdernColBERT": Winzling finds the top-k,
  `rerank` reorders them, and the caller maps indices back. Add an entry-table row and a `CHANGELOG.md` entry. Commit `.gitignore:30`.
  *Proof:* `vae.py gate --repo .` reports VERIFIED[gate]=true.

## Risks

- HYPOTHESIS[27M fp32 in browser WASM] a 109 MB graph loads within Chromium's WASM memory; falsifier: M3 `make browser-test MODEL=27m`.
  IF it fails THEN the demo and docs restrict browser use of 27M to fp16, q8, int8 and q4.
- M7 blocks on M6 (HF revisions). Rollback: FEAT is a new repo; ROOT changes stay on their branch.
