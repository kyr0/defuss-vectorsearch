# Agent memory

<!-- One tagged line per durable fact NOT derivable from code, git or docs:
- VERIFIED[scope] fact BC evidence
- HYPOTHESIS[scope] claim; falsifier=`cmd`
- UNKNOWN[scope] gap BC missing evidence
[scope] = the narrowest path|module|command|condition the evidence covers, not a topic: the entry decides nothing
outside it, and recurrence inside one subsystem never widens it.
Replace stale lines instead of appending. Mechanizable lessons belong in tests or .agents/VERIFY.py.
Budget 4 KiB (`vae.py doctor --repo .`); entries are injected at session start. -->
- VERIFIED[bun install] blocked postinstalls of onnxruntime-node (CUDA-only download) and protobufjs are harmless BC `make test` native CPU Winzling suite passes without `bun pm trust`
- VERIFIED[tsc --noEmit] REQUIRES built dist/ BC examples/ and scripts/ import ../dist and the package self-reference; so typecheck lives in `make e2e` after build
- VERIFIED[make bench Chromium runtimeMiB] swings between runs on identical builds (Winzling 598 then 296 MiB, 2026-10-31) BC two runs, same Chromium 140.0.7339.186 + Node 26.11; never attribute a change in it to code or builds from one run
- VERIFIED[src/colbert-reranker.live*.test.ts] where plain fusion ranks a fixed example depends on both pinned models: the "Bücher" library note left rank 1 with the 0.2.x pair and ties at rank 1 with Winzling 0.3.0 + edited 1.5M BC tmp/notes-probe.ts 2026-11-08; assert fusion contracts, not example outcomes
