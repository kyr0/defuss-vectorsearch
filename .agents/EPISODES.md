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
