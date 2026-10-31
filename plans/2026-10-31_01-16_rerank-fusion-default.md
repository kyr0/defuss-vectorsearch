# Plan: fuse MoEdernColBERT 1.5M with dense hits, measure it in `make bench`, use it in the live demo

Tick a milestone `- [x]` only when its proof passes, then run `verify` on that milestone's scope.
Human decision (2026-10-31): implement the proposal on `main`: fusion API, bench strategy, demo default; the
Winzling embedder never downloads the reranker by itself. Added the same day: cover Bun 1.4.x.

## Evidence (probe 2026-10-31, `tmp/rerank-probe.ts`, `output/rerank-probe.json`)

VERIFIED on tiny-embedding-bench-v1, the 450 target-language queries, Winzling bruteforce, 1.5M q8 on native CPU:

| Strategy | R@1 | R@3 | R@5 | R@10 |
|---|---:|---:|---:|---:|
| Winzling | 66.4 | 83.8 | 92.2 | 96.7 |
| Rerank top 25, ColBERT order | 70.9 | 87.1 | 92.7 | 97.8 |
| Rerank top 100, ColBERT order | 64.7 | 81.1 | 88.7 | 95.1 |
| Top 25, reciprocal rank fusion (k = 60) | 76.2 | 91.1 | 94.9 | 98.2 |

- Fusion holds from 10 to 100 candidates (R@1 75.6 to 77.1); a plain ColBERT order falls below Winzling at 100.
- 27M q8 fused at 25 candidates: 76.9 / 90.2 / 94.2 / 98.0, at 18 times the latency.
- Reranking 25 uncached passages with 1.5M q8: 163 ms p50 in Node.js WASM, 87 ms on native CPU.
- 144 of 1,000 queries exceed the 32-token query width.
- The configuration (k = 60, 25 candidates) was chosen on the same data it was scored on; `make bench` repeats
  it in both environments and for Harrier, which the probe did not cover.

## Status (2026-10-31)

M9 to M13 are done; the human asked to release them as 0.2.0 on `main`. VERIFIED by `make bench` (2026-10-31):

- Winzling with TurboQuant and `rerankHits`: R@1 77.6, R@3 90.2, R@5 94.4, from 65.8, 82.9 and 91.6, in both environments.
- Harrier with `rerankHits` loses accuracy (Node.js R@1 from 96.9 to 87.1), so the docs recommend the reranker for Winzling only.
- Reranking 25 uncached candidates costs 85 ms (Node.js, native CPU) and 161 ms (Chromium) per query, p50.

Deviations:

- The demo loads the reranker during boot, next to Winzling, instead of in the background: every search after "Ready" is
  fused, which keeps the page's states and the e2e deterministic.
- The first bench run was discarded: the stop hook ran `make e2e` during it. The clean rerun is the published one.
- Chromium memory figures rose from 206 to 598 MiB (Winzling) against the 2026-10-07 run. VERIFIED: a probe measured
  643 to 654 MiB with and without the reranker module. The build explanation drawn from it was wrong: the 0.2.1 bench
  run on the same builds measured 296 MiB. UNKNOWN: why the figure swings between runs.
- 0.2.1 (same day): fusion moved a clear dense winner to third in the demo's notes ("Bücher"). `fuseRanks` keeps the
  dense order when the top dense score leads by `denseMargin` (0.1); fused cards show how far the reranker moved them;
  `make bench` adds R@10 and writes the website's tabbed recall card.

## Contracts

- `ColbertRerankerCore.rerankHits(query, hits, documents, options)`: `hits` are dense hits best first
  (`{ index, score }`, as `searchTurboQuantIndex` and `searchTopK` return them), `documents[hit.index]` is the hit's
  text. It reranks the first `candidates` hits (default 25) and returns them as `FusedHit { index, score,
  denseRank, colbertScore }` best first, `score` being the fused reciprocal rank score. Checked by
  `src/colbert-reranker.test.ts` (pure fusion) and the live tests.
- `fuseRanks(colbertScores, k = 60)`: pure; position `i` holds the ColBERT score of the dense hit at rank `i + 1`.
  It returns positions in fused order. Callers with cached token vectors use it with `maxSim`.

## Milestones

- [x] **M9 Fusion API.** `src/colbert-reranker.ts:fuseRanks`, `rerankHits`; re-exported from `onnx.ts` and
  `browser.ts`. *Proof:* unit tests for `fuseRanks` (order, ties, validation); live Node and Chromium tests call
  `rerankHits` on TurboQuant hits; `scripts/test-package.ts` and the browser-bundle fixture use `rerankHits`.
- [x] **M10 Bench strategy.** `scripts/bench`: `KS` gains 1; a third strategy, TurboQuant then `rerankHits` (1.5M q8,
  25 candidates), for both dense models in both environments, timed per query with uncached passages.
  *Proof:* `scripts/bench/bench.test.ts` renders the new rows; `make bench` regenerates `bench.json` and the
  README section.
- [x] **M11 Demo default.** `examples/search-worker.ts` loads the 1.5M reranker next to Winzling and posts fused
  results after the dense ones; `docs/index.html` names the strategy and counts the reranker in the download.
  *Proof:* `scripts/test-docs.ts` serves the reranker from its local mirror and asserts the fused strategy.
- [x] **M12 Bun 1.4.x.** `scripts/test-bun-consumer.ts` packs the package, installs the tarball with `bun add` into a
  clean app under `tmp/` and runs `scripts/fixtures/bun-consumer/consumer.ts` with Bun on `input/rerank-pipeline.json`:
  Winzling, TurboQuant and `rerankHits` on native CPU and WASM, ESM and CJS. `make e2e` runs it with the installed
  Bun; CI pins Bun through `packageManager` and repeats it with 1.4.0 and the newest 1.4 release.
  *Proof:* VERIFIED runs with Bun 1.4.0, 1.4.3 and 1.4.4 (2026-10-31) gave identical CPU, WASM and CJS rankings.
- [x] **M13 Docs and gate.** README pipeline section and numbers from `bench.json`, CHANGELOG, ARCH.md.
  *Proof:* `vae.py gate` reports `VERIFIED[gate]=true`; commit on `main`.
