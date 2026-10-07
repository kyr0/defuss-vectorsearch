# Benchmark open questions

The README's benchmark findings rest on one run: 1,000 queries against 2,000 passages from
tiny-embedding-bench-v1. These questions about larger corpora are untested. Each lists the run that would settle it.

- HYPOTHESIS: 4-bit quantization costs more recall as the corpus grows, because scores crowd closer together and small
  errors reorder near-ties. Falsifier: pad the haystack with many distractor passages, rerun `make bench`, and compare
  the TurboQuant-versus-bruteforce R@k gap with the 2,000-passage run.
- HYPOTHESIS: TurboQuant search overtakes bruteforce only on much larger corpora. Each query first builds a lookup table,
  and that fixed cost is paid back only once the haystack is large. Falsifier: the same padded run, comparing
  "Search ms mean" for both strategies.
- UNKNOWN: the cost of reranking TurboQuant candidates against float32 vectors fetched on demand (from IndexedDB or a
  server) instead of held in memory. Settle it by adding that variant to `scripts/bench/runner.ts`.
