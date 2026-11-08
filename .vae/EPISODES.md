# Episodes

<!-- Newest last. The gate appends FAIL|DONE|FINDING and keeps the last 100 entries (git keeps older ones).
Agents append `<UTC ISO> s=<session> LESSON <VAE-DIALECT>` only for a falsified HYPOTHESIS, a dead end, or a root cause.
Session start injects the 3 newest open entries: LESSON, FINDING learn=none, FAIL without a later DONE.
A lesson recurring ≥2 → test | .agents/VERIFY.py rule | MEMORY line, then delete its lines. -->

2026-10-06T17:54:26Z s=93cfeaa7 FINDING package.json:author learn=none: one-off metadata fix
2026-10-07T10:53:53Z s=93cfeaa7 FINDING README.md:1 learn=none: one-off rename slip; no mechanical check for README/package version parity
2026-10-07T10:53:53Z s=93cfeaa7 FINDING README.md:186 learn=none: documentation precision; not mechanically checkable
2026-10-07T11:20:27Z s=93cfeaa7 FINDING scripts/bench/run.ts:runChromium learn=none: covered by every make bench run (Harrier load fails otherwise); no unit-level check without a browser
2026-10-07T11:20:27Z s=93cfeaa7 FINDING README.md:1 learn=none: one-off rename slip
2026-10-07T11:20:27Z s=93cfeaa7 FINDING README.md:186 learn=none: documentation precision
2026-10-07T15:03:12Z s=93cfeaa7 FINDING README.md:Findings caveats learn=none: documentation precision; not mechanically checkable
2026-10-07T15:03:12Z s=93cfeaa7 FINDING README.md:Findings caveats learn=none: documentation precision
2026-10-07T15:03:12Z s=93cfeaa7 FINDING README.md:Benchmark environments learn=none: documentation precision
2026-10-07T15:06:18Z s=93cfeaa7 FINDING README.md:Download size learn=none: documentation precision; persistence in a regular browser profile is untested
2026-10-07T15:32:53Z s=93cfeaa7 FINDING README.md:Download size learn=none: documentation precision
2026-10-07T15:32:53Z s=93cfeaa7 FINDING scripts/bench/run.ts:runChromium learn=none: covered by every make bench run
2026-10-07T15:43:06Z s=93cfeaa7 FINDING README.md:Benchmark scope (P precision) learn=none: documentation precision; not mechanically checkable
2026-10-07T15:43:06Z s=93cfeaa7 FINDING README.md:28,295,302 learn=none: hand-written analysis outside the generated block; it cites the 2026-10-07 run by date
2026-10-08T10:16:18Z s=542d48d6 FINDING docs/assets/demo.js:showResults/showEmpty learn=none: timing-dependent (needs a transition in flight at the moment of clearing); not deterministically reproducible in e2e
2026-10-08T10:16:18Z s=542d48d6 FINDING docs/assets/demo.js:handlers.error learn=none: a search error needs a worker failure after a successful load; no deterministic trigger without altering the worker
2026-10-08T10:16:18Z s=542d48d6 FINDING docs/assets/render.js:renderHits rank learn=none: ARIA semantics; no accessibility tree assertion in the suite
2026-10-08T10:16:18Z s=542d48d6 FINDING docs/assets/demo.js:state.device learn=none: dead state; lint does not flag object properties
2026-10-08T10:16:18Z s=542d48d6 FINDING README.md:Static demo page (P precision) learn=none: prose precision; not mechanically checkable
2026-10-08T10:16:18Z s=542d48d6 FINDING docs/index.html:#cmd State API (upstream defuss-shadcn 0.9.7) learn=none: defect lives in defuss-shadcn command.ts (bindGlobalKeys handler); reported to the user, not fixable in this repo
2026-10-08T10:16:18Z s=542d48d6 FINDING scripts/docs/build-index.ts:batchSize learn=none: performance on one host; pinning timings in a test would be flaky
2026-10-08T10:16:18Z s=542d48d6 FINDING .oxlintrc.json learn=none: lint itself enforces it
2026-10-08T12:49:35Z s=542d48d6 FINDING docs/assets/demo.css:.vs-query .mk-search-box learn=none: visual layout; no width assertion beyond overflow
2026-10-08T12:49:35Z s=542d48d6 FINDING docs/assets/demo.css:.vs-way code spans learn=none: visual layout
2026-10-08T12:49:35Z s=542d48d6 FINDING docs/index.html:Use it 'NPM package' heading learn=none: registry state changes outside the repo
2026-10-08T12:56:13Z s=542d48d6 FINDING docs/index.html:#intro claims without evidence learn=none: needs measurements on such hardware / a reproduction; outside this change
2026-10-08T13:38:01Z s=542d48d6 FINDING docs/assets/render.js:renderNoteStatus learn=none: no markup-vocabulary checker runs in this repo's gate
2026-10-08T13:38:01Z s=542d48d6 FINDING docs/index.html:footer ad portrait learn=none: content decision for the user
2026-10-08T13:38:01Z s=542d48d6 FINDING docs/index.html:closing CTA copy learn=none: no cross-browser runs in this repo
2026-10-08T13:52:26Z s=542d48d6 FINDING docs/index.html:.mk-hero-desc (user edit) learn=none: author's copy decision
2026-10-08T14:39:23Z s=542d48d6 FINDING scripts/test-docs.ts:random-notes scroll check learn=none: test mechanics, documented inline
2026-10-08T14:39:23Z s=542d48d6 FINDING docs/index.html:flip '~21,5 kB' learn=none: copy decision
2026-10-08T15:44:55Z s=542d48d6 FINDING docs/index.html:#pipeline lanes + intro + agent prompt learn=none: copy precision
2026-10-08T15:44:55Z s=542d48d6 FINDING docs/index.html:.vs-flythrough position learn=none: visual spacing; screenshots checked, no layout assertion
2026-10-08T15:58:37Z s=542d48d6 DONE fp=0107b9143104 cov=66.7% paths=.oxlintrc.json,CHANGELOG.md,Makefile,README.md(+16)
2026-10-10T12:42:05Z s=48639839 DONE fp=b67282cf12c4 cov=66.7% paths=docs/assets/render.js,scripts/test-docs.ts
2026-10-10T16:23:33Z s=53696323 DONE fp=eb7f08ce7fc4 cov=? paths=README.md
2026-10-10T16:23:33Z s=53696323 FINDING README.md:14-23 B03 (old README.md:8-11) learn=none: hand-picked TL;DR copy; a README-vs-bench.json check would be new test scope, offered to the user instead
2026-10-10T16:23:33Z s=53696323 FINDING README.md:352 B01 (old README.md:6) learn=none: one-off measurement of fixed pinned files; no recurring mechanism
2026-10-10T16:23:33Z s=53696323 FINDING README.md:58 B01 learn=none: publication state, not code
2026-10-10T16:23:33Z s=53696323 FINDING README.md:410 T04 learn=none: single wrong reference, fixed
2026-10-10T16:23:33Z s=53696323 FINDING README.md:376 P07 learn=none: copy precision
2026-10-10T16:23:33Z s=53696323 FINDING README.md:392-394 B01 learn=none: copy precision
2026-10-10T16:23:33Z s=53696323 FINDING README.md:426 A01 learn=none: structure
2026-10-10T16:23:33Z s=53696323 FINDING README.md:27,403 T07 learn=none: checker is line-based; <br/> is the working form
2026-10-10T16:23:33Z s=53696323 FINDING README.md:379 B01 learn=none: needs the author's answer, not a mechanism
2026-10-10T16:29:58Z s=53696323 DONE fp=a5ecb4c37f27 cov=66.7% paths=bun.lock,package.json
2026-10-10T16:29:58Z s=53696323 FINDING package.json:135 devDependencies.playwright learn=none: Dependabot already watches the manifest; a repo rule would duplicate it
2026-10-10T17:14:50Z s=53696323 DONE fp=8c28876fae9b cov=66.7% paths=README.md,bun.lock,package.json
2026-10-30T22:39:51Z s=8e62adc6 FAIL prose
2026-10-30T22:41:04Z s=8e62adc6 DONE fp=b44d0dd9f6bb cov=? paths=plans/2026-10-30_22-37_moederncolbert-onnx-two-models.md
2026-10-30T22:41:04Z s=8e62adc6 FINDING plans/2026-10-30_22-37_moederncolbert-onnx-two-models.md:73 T06 learn=none: rewritten as 'below 1e-4'; one-off wording, static T06 does not cover '<'
2026-10-30T22:41:04Z s=8e62adc6 FINDING plans/2026-10-30_22-37_moederncolbert-onnx-two-models.md:74,77 T06 learn=none: rewritten with 'is'; one-off wording
2026-10-30T22:41:04Z s=8e62adc6 FINDING plans/2026-10-30_22-37_moederncolbert-onnx-two-models.md:78 T06 learn=none: rewritten as '0.956, below 0.98'; one-off wording
2026-10-30T22:41:04Z s=8e62adc6 FINDING plans/2026-10-30_22-37_moederncolbert-onnx-two-models.md:125,141,143,170 T06 learn=none: rewritten in words; 3x512 batch-shape notation kept as content
2026-10-30T22:41:04Z s=8e62adc6 FINDING plans/2026-10-30_22-37_moederncolbert-onnx-two-models.md:32 P08 learn=none: named FEAT Node and ROOT Node/WASM runtimes and the Python fixture
2026-10-30T22:41:04Z s=8e62adc6 FINDING plans/2026-10-30_22-37_moederncolbert-onnx-two-models.md:22 P08 learn=none: named FEAT's Node runtime
2026-10-30T22:41:04Z s=8e62adc6 FINDING plans/2026-10-30_22-37_moederncolbert-onnx-two-models.md:49 P08 learn=none: named token outputs
2026-10-30T22:41:04Z s=8e62adc6 FINDING plans/2026-10-30_22-37_moederncolbert-onnx-two-models.md:24-26 L01 learn=none: stated that graphs, manifest, fixture and card must come from one build
2026-10-30T22:41:04Z s=8e62adc6 FINDING plans/2026-10-30_22-37_moederncolbert-onnx-two-models.md:111 B01 learn=none: claim removed; file name stays as a plan choice
2026-10-30T23:49:22Z s=8e62adc6 DONE fp=0b7ccc7bf34e cov=? paths=plans/2026-10-30_22-37_moederncolbert-onnx-two-models.md
2026-10-30T23:49:22Z s=8e62adc6 FINDING .gitignore:30 learn=none: split back onto its own line; git check-ignore confirms the folder is ignored again
2026-10-31T00:22:31Z s=8e62adc6 FAIL prose
2026-10-31T00:34:03Z s=8e62adc6 DONE fp=335ecdd14b2e cov=67.4% paths=AGENTS.md,ARCH.md,CHANGELOG.md,Makefile(+23)
2026-10-31T00:34:03Z s=8e62adc6 FINDING src/colbert-reranker.ts:rerank learn=test: src/colbert-reranker.live.test.ts asserts two pending reranks complete across dispose()
2026-10-31T00:34:03Z s=8e62adc6 FINDING README.md:109 B01 learn=verifier: prose gate B01 already rejects it
2026-10-31T00:34:03Z s=8e62adc6 FINDING README.md:240,393-398 T06 learn=verifier: prose gate T06 already rejects it
2026-10-31T00:34:03Z s=8e62adc6 FINDING ARCH.md:How it works learn=none: a wiring claim in prose is not mechanically checkable; caught by reading imports
2026-10-31T00:34:03Z s=8e62adc6 FINDING README.md:Auto-download and cache learn=none: network-dependent; the gate must not depend on huggingface.co
2026-10-31T00:34:03Z s=8e62adc6 FINDING CHANGELOG.md:Fixed learn=none: evidence judgement, not mechanically checkable
2026-10-31T00:34:03Z s=8e62adc6 FINDING src/colbert-reranker.live.test.ts:1-3 learn=none: style; oxlint does not flag duplicate module imports in this config
2026-10-31T00:34:25Z s=8e62adc6 DONE fp=64bc2aedaf2a cov=67.4% paths=AGENTS.md,ARCH.md,CHANGELOG.md,Makefile(+23)
2026-10-31T01:30:06Z s=8e62adc6 FAIL env.example,tests.e2e.1
2026-10-31T02:10:31Z s=8e62adc6 DONE fp=142a1d6a7a7b cov=67.6% paths=.github/workflows/verify.yml,AGENTS.md,ARCH.md,CHANGELOG.md(+45)
2026-10-31T02:10:31Z s=8e62adc6 FINDING src/colbert-reranker.ts:rerank vs rerankHits learn=test: make bench now reports the fused strategy; colbert-reranker tests pin fuseRanks' order and ties
2026-10-31T02:10:31Z s=8e62adc6 FINDING README.md:Rerank dense hits (Harrier) learn=none: a product recommendation backed by bench.json, which make bench regenerates
2026-10-31T02:10:31Z s=8e62adc6 FINDING examples/search-worker.ts:modelLoader learn=test: scripts/test-docs.ts asserts the model bar's total equals both manifests' sums
2026-10-31T02:10:31Z s=8e62adc6 FINDING examples/search-worker.ts:modelLoader log learn=none: log wording, not mechanically checked
2026-10-31T02:10:31Z s=8e62adc6 FINDING scripts/test-package.ts:rerankHits assertion learn=test: the assertion itself encodes the tie rule
2026-10-31T02:10:31Z s=8e62adc6 FINDING src/colbert-reranker.ts:rerankHits signature learn=test: scripts/test-package.ts passes literal SearchHit objects and runs under tsc in make e2e
2026-10-31T02:10:31Z s=8e62adc6 FINDING src/onnx.ts, src/browser.ts: Core types learn=none: a build warning, not a gate rule; worth a verifier rule only if it recurs
2026-10-31T02:10:31Z s=8e62adc6 FINDING bench.json run 1 learn=memory: agent memory stop-hook-runs-gate: keep the turn open while make bench runs
2026-10-31T02:10:31Z s=8e62adc6 FINDING README.md:Findings memory learn=none: environment-dependent measurement; documented, not pinned
2026-10-31T02:10:31Z s=8e62adc6 FINDING .github/workflows/verify.yml:setup-bun learn=none: falsifier: the CI run's setup-bun step log names the installed Bun version
2026-10-31T15:11:42Z s=8e62adc6 FAIL prose
2026-10-31T15:18:51Z s=8e62adc6 DONE fp=a8d32d3adc02 cov=67.9% paths=.github/workflows/verify.yml,AGENTS.md,ARCH.md,CHANGELOG.md(+49)
2026-10-31T15:18:51Z s=8e62adc6 FINDING scripts/test-package.ts:28 rerankHits learn=none: Fixed in place; the same pattern in src/colbert-reranker.live.test.ts (0.9/0.8) was already changed to a 0.05 lead, and git grep finds no other literal hit scor
2026-10-31T15:18:51Z s=8e62adc6 FINDING README.md:463 B01 / plans/2026-10-31_01-16_rerank-fusion-default.md learn=memory: .vae/MEMORY.md line: Chromium runtimeMiB swings between runs on identical builds; never attribute a change to code or builds from one run.
2026-11-08T17:05:30Z s=6664d85b DONE fp=d18538ee50cf cov=67.9% paths=ARCH.md,CHANGELOG.md,README.md,bench.json(+18)
2026-11-08T17:05:30Z s=6664d85b FINDING README.md:453 B04 learn=none: Hand-written README/MODEL.md figures are re-derived from bench.json or the model audit per release; a per-sentence checker is not justified for one release (YAG
2026-11-08T17:05:30Z s=6664d85b FINDING README.md:86 P08 learn=none: Hand-written README/MODEL.md figures are re-derived from bench.json or the model audit per release; a per-sentence checker is not justified for one release (YAG
2026-11-08T17:05:30Z s=6664d85b FINDING docs/MODEL.md:35 B01 learn=none: Hand-written README/MODEL.md figures are re-derived from bench.json or the model audit per release; a per-sentence checker is not justified for one release (YAG
2026-11-08T17:05:30Z s=6664d85b FINDING scripts/docs/index-format.ts:7 B01 learn=none: Hand-written README/MODEL.md figures are re-derived from bench.json or the model audit per release; a per-sentence checker is not justified for one release (YAG
2026-11-08T19:51:45Z s=6664d85b DONE fp=ab69b5a8a814 cov=68.1% paths=ARCH.md,CHANGELOG.md,README.md,bench.json(+35)
2026-11-08T19:51:45Z s=6664d85b FINDING src/colbert-reranker.live.browser.test.ts:89 learn=memory: Added a .vae/MEMORY.md line: example outcomes of plain fusion depend on both pinned models; tests assert fusion contracts.
2026-11-08T19:51:45Z s=6664d85b FINDING CHANGELOG.md:11 B09 learn=none: Figures and evidence scopes in hand-written docs follow each bench and probe run; no rule kind checks that prose cites the current run, and the docs test alread
2026-11-08T19:51:45Z s=6664d85b FINDING src/colbert-reranker.ts:152 B02 learn=none: Figures and evidence scopes in hand-written docs follow each bench and probe run; no rule kind checks that prose cites the current run, and the docs test alread
2026-11-08T19:51:45Z s=6664d85b FINDING README.md:487 B01 learn=none: Figures and evidence scopes in hand-written docs follow each bench and probe run; no rule kind checks that prose cites the current run, and the docs test alread
2026-11-08T20:14:28Z s=6664d85b DONE fp=b8588d7b6251 cov=68.1% paths=ARCH.md,CHANGELOG.md,README.md,bench.json(+35)
2026-11-08T20:14:28Z s=6664d85b FINDING package.json:3 learn=memory: Added a .vae/MEMORY.md line: check `npm view <pkg>@<version> gitHead` before labelling a change with a version. A gate rule would need a registry query, so it s
