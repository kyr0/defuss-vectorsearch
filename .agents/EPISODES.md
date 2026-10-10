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
2026-10-07T16:18:01Z s=93cfeaa7 DONE fp=7484b0ccd875 cov=66.7% paths=CHANGELOG.md,README.md,scripts/bench/bench.test.ts,scripts/bench/dataset.ts(+1)
2026-10-07T16:18:01Z s=93cfeaa7 FINDING scripts/bench/report.ts:renderReadmeSection learn=test: bench.test.ts asserts the four ### headings render
2026-10-08T10:04:31Z s=542d48d6 FAIL tests.e2e.1
2026-10-08T10:16:18Z s=542d48d6 DONE fp=225aa76adb63 cov=66.7% paths=.oxlintrc.json,CHANGELOG.md,Makefile,README.md(+13)
2026-10-08T10:16:18Z s=542d48d6 FINDING docs/index.html:<head> CDN links learn=test: test-docs.ts fails on any blocked resource/console error, so a wrong or removed hash is caught
2026-10-08T10:16:18Z s=542d48d6 FINDING docs/assets/demo.js:showResults/showEmpty learn=none: timing-dependent (needs a transition in flight at the moment of clearing); not deterministically reproducible in e2e
2026-10-08T10:16:18Z s=542d48d6 FINDING docs/assets/demo.js:[data-boot] listeners learn=test: test-docs.ts asserts no second 'load · device=' log line after clicking the hero link once ready
2026-10-08T10:16:18Z s=542d48d6 FINDING docs/assets/demo.js:handlers.error learn=none: a search error needs a worker failure after a successful load; no deterministic trigger without altering the worker
2026-10-08T10:16:18Z s=542d48d6 FINDING docs/assets/render.js:renderHits rank learn=none: ARIA semantics; no accessibility tree assertion in the suite
2026-10-08T10:16:18Z s=542d48d6 FINDING docs/assets/demo.js:state.device learn=none: dead state; lint does not flag object properties
2026-10-08T10:16:18Z s=542d48d6 FINDING README.md:Static demo page (P precision) learn=none: prose precision; not mechanically checkable
2026-10-08T10:16:18Z s=542d48d6 FINDING scripts/test-docs.ts coverage learn=test: test-docs.ts now covers both
2026-10-08T10:16:18Z s=542d48d6 FINDING scripts/test-docs.ts:375 px check learn=test: test-docs.ts overflowing() assertion
2026-10-08T10:16:18Z s=542d48d6 FINDING scripts/test-docs.ts:#vs-menu wait learn=test: the e2e itself
2026-10-08T10:16:18Z s=542d48d6 FINDING docs/index.html:#cmd State API (upstream defuss-shadcn 0.9.7) learn=none: defect lives in defuss-shadcn command.ts (bindGlobalKeys handler); reported to the user, not fixable in this repo
2026-10-08T10:16:18Z s=542d48d6 FINDING scripts/docs/build-index.ts:batchSize learn=none: performance on one host; pinning timings in a test would be flaky
2026-10-08T10:16:18Z s=542d48d6 FINDING .oxlintrc.json learn=none: lint itself enforces it
2026-10-08T10:16:18Z s=542d48d6 FINDING docs/index.html:hero copy (B evidence) learn=test: test-docs.ts compares every figure and the 20 recall bars with bench.json
2026-10-08T12:49:35Z s=542d48d6 DONE fp=5d3979cec624 cov=66.7% paths=.oxlintrc.json,CHANGELOG.md,Makefile,README.md(+13)
2026-10-08T12:49:35Z s=542d48d6 FINDING docs/assets/demo.js:palette click + Enter handlers (reported scroll jump) learn=test: test-docs.ts asserts |scrollY delta| < 2 for Enter and click picks
2026-10-08T12:49:35Z s=542d48d6 FINDING docs/assets/demo.js:boot-retry learn=test: test-docs.ts index-failure context
2026-10-08T12:49:35Z s=542d48d6 FINDING docs/index.html:<header> wrapper learn=test: test-docs.ts asserts the header top stays within 0..40 px at #use
2026-10-08T12:49:35Z s=542d48d6 FINDING docs/assets/demo.css:.vs-cta example buttons learn=test: test-docs.ts overflowing() after the examples render
2026-10-08T12:49:35Z s=542d48d6 FINDING docs/assets/demo.css:.vs-query .mk-search-box learn=none: visual layout; no width assertion beyond overflow
2026-10-08T12:49:35Z s=542d48d6 FINDING docs/assets/demo.css:.vs-way code spans learn=none: visual layout
2026-10-08T12:49:35Z s=542d48d6 FINDING docs/index.html:Use it 'NPM package' heading learn=none: registry state changes outside the repo
2026-10-08T12:56:13Z s=542d48d6 DONE fp=dfe0b6e79bd4 cov=66.7% paths=.oxlintrc.json,CHANGELOG.md,Makefile,README.md(+13)
2026-10-08T12:56:13Z s=542d48d6 FINDING docs/index.html:.mk-hero-desc + #intro learn=test: test-docs.ts recomputes the R@5 mean, the index ratio and the p95 bound from bench.json
2026-10-08T12:56:13Z s=542d48d6 FINDING docs/index.html:#intro claims without evidence learn=none: needs measurements on such hardware / a reproduction; outside this change
2026-10-08T13:38:01Z s=542d48d6 DONE fp=a4eb598d6279 cov=66.7% paths=.oxlintrc.json,CHANGELOG.md,Makefile,README.md(+15)
2026-10-08T13:38:01Z s=542d48d6 FINDING docs/index.html:#notes-region pane width learn=test: test-docs.ts clicks the FAB and checks the divider moves the board by 10 px
2026-10-08T13:38:01Z s=542d48d6 FINDING scripts/test-docs.ts:scroll stability check learn=test: the round-2 mutation run still applies: the old scrollIntoView call fails the check
2026-10-08T13:38:01Z s=542d48d6 FINDING docs/assets/render.js:renderNoteStatus learn=none: no markup-vocabulary checker runs in this repo's gate
2026-10-08T13:38:01Z s=542d48d6 FINDING docs/index.html:phone split learn=test: test-docs.ts asserts border-layout-north and no overflow on 375 px
2026-10-08T13:38:01Z s=542d48d6 FINDING docs/assets/search-view.js + notes.js (structure) learn=test: test-docs.ts drives both tabs through the same view code
2026-10-08T13:38:01Z s=542d48d6 FINDING docs/index.html:footer ad portrait learn=none: content decision for the user
2026-10-08T13:38:01Z s=542d48d6 FINDING docs/index.html:closing CTA copy learn=none: no cross-browser runs in this repo
2026-10-08T13:43:03Z s=542d48d6 FAIL tests.e2e.1
2026-10-08T13:44:32Z s=542d48d6 DONE fp=184237afc329 cov=66.7% paths=.oxlintrc.json,CHANGELOG.md,Makefile,README.md(+15)
2026-10-08T13:44:32Z s=542d48d6 FINDING scripts/test-docs.ts:pruned filter (tsc TS2532) learn=verifier: make e2e already typechecks scripts; run it, not node alone, before the gate
2026-10-08T13:52:26Z s=542d48d6 DONE fp=1ddc78950483 cov=66.7% paths=.oxlintrc.json,CHANGELOG.md,Makefile,README.md(+15)
2026-10-08T13:52:26Z s=542d48d6 FINDING docs/index.html:[data-bench=index-gzip] (requested '522 kB') learn=test: test-docs.ts recomputes the gzip size from docs/data/index.json
2026-10-08T13:52:26Z s=542d48d6 FINDING docs/index.html:external links learn=test: test-docs.ts checks every a[href^=http] against the rule
2026-10-08T13:52:26Z s=542d48d6 FINDING docs/index.html:.vs-flip text-rotate learn=test: test-docs.ts compares the six items with the data
2026-10-08T13:52:26Z s=542d48d6 FINDING docs/index.html:#intro rewrite learn=test: test-docs.ts checks 256 bytes and 8,192 tokens against the data
2026-10-08T13:52:26Z s=542d48d6 FINDING docs/index.html:.mk-hero-desc (user edit) learn=none: author's copy decision
2026-10-08T14:08:26Z s=542d48d6 DONE fp=b79951a2c5ff cov=66.7% paths=.oxlintrc.json,CHANGELOG.md,Makefile,README.md(+15)
2026-10-08T14:08:26Z s=542d48d6 FINDING docs/index.html:#try-live learn=test: test-docs.ts clicks it before and after loading and sees no model request / no second load
2026-10-08T14:08:26Z s=542d48d6 FINDING docs/assets/demo.css:.vs-consult learn=test: test-docs.ts checks portrait/heading on one row and the text in its own column
2026-10-08T14:08:26Z s=542d48d6 FINDING docs/index.html:#intro-5 privacy block learn=test: test-docs.ts records zero network requests during a search
2026-10-08T14:08:26Z s=542d48d6 FINDING docs/index.html:#intro-6 quality block learn=test: test-docs.ts recomputes the R@25 mean from bench.json
2026-10-08T14:08:26Z s=542d48d6 FINDING docs/index.html:#add-note learn=test: test-docs.ts asserts it sits above the notes list
2026-10-08T14:14:33Z s=542d48d6 FAIL tests.e2e.1
2026-10-08T14:17:13Z s=542d48d6 DONE fp=d4c93af53bf9 cov=66.7% paths=.oxlintrc.json,CHANGELOG.md,Makefile,README.md(+15)
2026-10-08T14:17:13Z s=542d48d6 FINDING docs/data + scripts/docs/index-format.ts (v2) learn=test: index-format.test.ts round-trips the v2 format; test-docs.ts asserts the hint, readout and stat against manifest.json
2026-10-08T14:17:13Z s=542d48d6 FINDING docs/index.html:size figures learn=test: test-docs.ts fails on any visible '40 MB' or 'MiB' and recomputes each figure from data
2026-10-08T14:39:23Z s=542d48d6 DONE fp=a7bc4bc37c31 cov=66.7% paths=.oxlintrc.json,CHANGELOG.md,Makefile,README.md(+16)
2026-10-08T14:39:23Z s=542d48d6 FINDING docs/assets/notes.js:addRandom + docs/assets/sample-notes.js learn=test: test-docs.ts checks pool size/mix, 5 distinct pool notes with lang tags, all embedded, count, and a steady page
2026-10-08T14:39:23Z s=542d48d6 FINDING scripts/test-docs.ts:random-notes scroll check learn=none: test mechanics, documented inline
2026-10-08T14:39:23Z s=542d48d6 FINDING scripts/test-docs.ts:flip figures learn=test: figures derive from bench.json and manifest.json
2026-10-08T14:39:23Z s=542d48d6 FINDING docs/index.html:flip '~21,5 kB' learn=none: copy decision
2026-10-08T14:46:53Z s=542d48d6 DONE fp=180757def024 cov=66.7% paths=.oxlintrc.json,CHANGELOG.md,Makefile,README.md(+16)
2026-10-08T14:46:53Z s=542d48d6 FINDING docs/index.html:#bench .mk-stats-desc learn=test: test-docs.ts checks the sentence and the link
2026-10-08T14:46:53Z s=542d48d6 FINDING docs/index.html:#pipeline diagram learn=test: test-docs.ts waits for the autoplay to pause on step 8 and counts nodes, edges and drawn wires; the phone overflow check includes #pipeline
2026-10-08T15:42:43Z s=542d48d6 FAIL tests.e2e.1
2026-10-08T15:44:55Z s=542d48d6 DONE fp=c3beb4edba03 cov=66.7% paths=.oxlintrc.json,CHANGELOG.md,Makefile,README.md(+16)
2026-10-08T15:44:55Z s=542d48d6 FINDING docs/index.html:#pipeline lanes + intro + agent prompt learn=none: copy precision
2026-10-08T15:44:55Z s=542d48d6 FINDING docs/index.html:#intro-6 recall scope learn=test: test-docs.ts recomputes all three from bench.json
2026-10-08T15:44:55Z s=542d48d6 FINDING examples/search-worker.ts:STRATEGY learn=test: test-docs.ts checks the summary in both tabs
2026-10-08T15:44:55Z s=542d48d6 FINDING docs/index.html:.vs-flythrough position learn=none: visual spacing; screenshots checked, no layout assertion
2026-10-08T15:44:55Z s=542d48d6 FINDING scripts/test-docs.ts:copy assertions learn=test: copy belongs to the author; numbers stay verified
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
