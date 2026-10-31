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
