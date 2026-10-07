# Episodes

<!-- Newest last. The gate appends FAIL|DONE|FINDING and keeps the last 100 entries (git keeps older ones).
Agents append `<UTC ISO> s=<session> LESSON <VAE-DIALECT>` only for a falsified HYPOTHESIS, a dead end, or a root cause.
Session start injects the 3 newest open entries: LESSON, FINDING learn=none, FAIL without a later DONE.
A lesson recurring ≥2 → test | .agents/VERIFY.py rule | MEMORY line, then delete its lines. -->

2026-10-06T17:40:49Z s=93cfeaa7 FAIL layout,lint=?,tests.unit=?,tests.e2e=?,coverage=?
2026-10-06T17:42:42Z s=93cfeaa7 FAIL toolchain,tests.no-mocks
2026-10-06T17:43:32Z s=93cfeaa7 FAIL toolchain
2026-10-06T17:54:26Z s=93cfeaa7 DONE fp=db2a98fc209b cov=65.0% paths=.github/workflows/verify.yml,AGENTS.md,Makefile,README.md(+9)
2026-10-06T17:54:26Z s=93cfeaa7 FINDING src/core.ts:getExtractor learn=test: src/winzling.test.ts 'never runs Winzling under another repo ID' fails without fix
2026-10-06T17:54:26Z s=93cfeaa7 FINDING src/model-source.ts:resolveModelSource learn=test: src/winzling.test.ts 'same cache keys with or without a trailing slash' fails without fix
2026-10-06T17:54:26Z s=93cfeaa7 FINDING package.json:author learn=none: one-off metadata fix
2026-10-06T17:54:26Z s=93cfeaa7 FINDING src/openai-compatible.test.ts:6 learn=verifier: gate tests.no-mocks rule enforces it; now uses a node:http local server
2026-10-06T18:04:10Z s=93cfeaa7 DONE fp=fcb27ee84532 cov=65.0% paths=.github/workflows/verify.yml,AGENTS.md,Makefile,README.md(+7)
2026-10-06T18:04:49Z s=93cfeaa7 DONE fp=9c48f001f1fc cov=65.0% paths=AGENTS.md,CHANGELOG.md
2026-10-07T10:52:05Z s=93cfeaa7 FAIL env.example,tests.no-mocks
2026-10-07T10:53:53Z s=93cfeaa7 DONE fp=3869848fa2fd cov=65.0% paths=CHANGELOG.md,Makefile,README.md,bun.lock(+15)
2026-10-07T10:53:53Z s=93cfeaa7 FINDING README.md:1 learn=none: one-off rename slip; no mechanical check for README/package version parity
2026-10-07T10:53:53Z s=93cfeaa7 FINDING src/model-prefetch.test.ts:25 learn=verifier: gate tests.no-mocks rule enforces it
2026-10-07T10:53:53Z s=93cfeaa7 FINDING src/model-cache-management.test.ts:17 learn=verifier: gate tests.no-mocks rule enforces it
2026-10-07T10:53:53Z s=93cfeaa7 FINDING src/model-prefetch.ts:buildFetchHeaders learn=verifier: gate env.example rule enforces it
2026-10-07T10:53:53Z s=93cfeaa7 FINDING README.md:186 learn=none: documentation precision; not mechanically checkable
2026-10-07T11:16:27Z s=93cfeaa7 FAIL prose
2026-10-07T11:20:27Z s=93cfeaa7 DONE fp=6425447ca747 cov=65.0% paths=CHANGELOG.md,Makefile,README.md,bench.json(+27)
2026-10-07T11:20:27Z s=93cfeaa7 FINDING .gitignore:29 learn=verifier: .agents/VERIFY.py gitignore.bench-sources-tracked fails with the old pattern, passes with the fix
2026-10-07T11:20:27Z s=93cfeaa7 FINDING scripts/bench/run.ts:runChromium learn=none: covered by every make bench run (Harrier load fails otherwise); no unit-level check without a browser
2026-10-07T11:20:27Z s=93cfeaa7 FINDING scripts/bench/run.ts:rendererRss learn=memory: inline VERIFIED comment at rendererRss records why heap usage is not used
2026-10-07T11:20:27Z s=93cfeaa7 FINDING scripts/bench/report.ts:renderReadmeSection learn=verifier: gate prose check enforces it on every regenerated README
2026-10-07T11:20:27Z s=93cfeaa7 FINDING README.md:1 learn=none: one-off rename slip
2026-10-07T11:20:27Z s=93cfeaa7 FINDING README.md:186 learn=none: documentation precision
2026-10-07T11:39:01Z s=93cfeaa7 DONE fp=a4b0921a4f87 cov=65.0% paths=CHANGELOG.md,Makefile,README.md,bench.json(+27)
2026-10-07T12:03:12Z s=93cfeaa7 DONE fp=21c0e5e73e4b cov=65.0% paths=CHANGELOG.md,Makefile,README.md,bench.json(+27)
2026-10-07T15:03:12Z s=93cfeaa7 DONE fp=a5727c81a418 cov=65.0% paths=CHANGELOG.md,Makefile,README.md,bench.json(+28)
2026-10-07T15:03:12Z s=93cfeaa7 FINDING README.md:Findings caveats learn=none: documentation precision; not mechanically checkable
2026-10-07T15:03:12Z s=93cfeaa7 FINDING README.md:Findings caveats learn=none: documentation precision
2026-10-07T15:03:12Z s=93cfeaa7 FINDING README.md:Findings caveats learn=verifier: gate prose B01 enforces it
2026-10-07T15:03:12Z s=93cfeaa7 FINDING README.md:Benchmark environments learn=none: documentation precision
2026-10-07T15:06:18Z s=93cfeaa7 DONE fp=011af169e013 cov=65.0% paths=CHANGELOG.md,Makefile,README.md,bench.json(+28)
2026-10-07T15:06:18Z s=93cfeaa7 FINDING README.md:Download size learn=none: documentation precision; persistence in a regular browser profile is untested
2026-10-07T15:32:53Z s=93cfeaa7 DONE fp=82c1fd6f3143 cov=66.7% paths=CHANGELOG.md,Makefile,README.md,bench.json(+42)
2026-10-07T15:32:53Z s=93cfeaa7 FINDING src/model-cache.browser.ts:getProvider learn=test: scripts/test-browser-bundle.ts browser-bundle fixture times out when the lazy import is restored (mutation run)
2026-10-07T15:32:53Z s=93cfeaa7 FINDING src/model-cache.ts:loadCachedModelFile|src/core.ts:getExtractor|src/model-cache-management.ts learn=test: isomorphic-tla fixture times out when core.ts's lazy import('./onnx.js') is restored (mutation run)
2026-10-07T15:32:53Z s=93cfeaa7 FINDING package.json:exports learn=test: scripts/test-browser-bundle.ts asserts no forbidden module ids and no externalization warnings
2026-10-07T15:32:53Z s=93cfeaa7 FINDING README.md:Download size learn=none: documentation precision
2026-10-07T15:32:53Z s=93cfeaa7 FINDING .gitignore:29 learn=verifier: .agents/VERIFY.py gitignore.bench-sources-tracked
2026-10-07T15:32:53Z s=93cfeaa7 FINDING scripts/bench/run.ts:runChromium learn=none: covered by every make bench run
2026-10-07T15:32:53Z s=93cfeaa7 FINDING scripts/bench/run.ts:rendererRss learn=memory: inline VERIFIED comment at rendererRss
2026-10-07T15:32:53Z s=93cfeaa7 FINDING src/model-prefetch.test.ts:25 learn=verifier: gate tests.no-mocks rule
2026-10-07T15:32:53Z s=93cfeaa7 FINDING src/model-cache-management.test.ts:17 learn=verifier: gate tests.no-mocks rule
2026-10-07T15:32:53Z s=93cfeaa7 FINDING src/model-prefetch.ts:buildFetchHeaders learn=verifier: gate env.example rule
2026-10-07T15:43:06Z s=93cfeaa7 DONE fp=8f471973a819 cov=66.7% paths=CHANGELOG.md,README.md,scripts/bench/bench.test.ts,scripts/bench/dataset.ts(+1)
2026-10-07T15:43:06Z s=93cfeaa7 FINDING README.md:Benchmark scope (P precision) learn=none: documentation precision; not mechanically checkable
2026-10-07T15:43:06Z s=93cfeaa7 FINDING README.md:28,295,302 learn=none: hand-written analysis outside the generated block; it cites the 2026-10-07 run by date
2026-10-07T16:18:01Z s=93cfeaa7 DONE fp=7484b0ccd875 cov=66.7% paths=CHANGELOG.md,README.md,scripts/bench/bench.test.ts,scripts/bench/dataset.ts(+1)
2026-10-07T16:18:01Z s=93cfeaa7 FINDING scripts/bench/report.ts:renderReadmeSection learn=test: bench.test.ts asserts the four ### headings render
