/** Pure retrieval and timing metrics for the benchmark; no I/O, identical in Node and Chromium. */

export const KS = [3, 5, 25, 100] as const;
export type K = (typeof KS)[number];
export type RecallAtK = Record<`@${K}`, number>;

export interface Summary {
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
}

export const round = (value: number, digits = 3): number => Number(value.toFixed(digits));

/** Nearest-rank percentiles; `values` must be non-empty. */
export const summarize = (values: readonly number[]): Summary => {
  if (values.length === 0) throw new Error("summarize needs at least one value");
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;
  return {
    mean: round(values.reduce((sum, value) => sum + value, 0) / values.length),
    p50: round(at(0.5)),
    p95: round(at(0.95)),
  };
};

/**
 * 1-based rank of `target` over all scores. VERIFIED: ties go to the lower index (bench.test.ts),
 * matching `topKFromScores`, so rank <= k exactly when the library's top-k contains the target.
 */
export const rankOf = (scores: ArrayLike<number>, target: number): number => {
  const score = scores[target]!;
  let rank = 1;
  for (let i = 0; i < scores.length; i++) {
    const other = scores[i]!;
    if (other > score || (other === score && i < target)) rank++;
  }
  return rank;
};

const percent = (hits: number, total: number): number => round((100 * hits) / total, 1);

const recallOf = (ranks: readonly number[]): RecallAtK =>
  Object.fromEntries(KS.map((k) => [`@${k}`, percent(ranks.filter((rank) => rank <= k).length, ranks.length)])) as RecallAtK;

export interface RecallMatrix {
  readonly overall: RecallAtK;
  readonly byLanguage: Record<string, RecallAtK>;
}

/** Share of queries (%) whose target ranks within the top k, overall and per query language. */
export const recallMatrix = (
  ranks: readonly number[],
  queryLanguages: readonly number[],
  languages: readonly string[],
): RecallMatrix => ({
  overall: recallOf(ranks),
  byLanguage: Object.fromEntries(
    languages.map((code, language) => [code, recallOf(ranks.filter((_, i) => queryLanguages[i] === language))]),
  ),
});

export interface Reproduction {
  readonly overall: number;
  readonly byLanguage: Record<string, number>;
}

/**
 * Share of queries (%) whose approximate rank stays within ±tolerance of the exact rank, e.g. exact
 * rank 20 accepts 18..22 at 10%. Rank 1..9 must therefore be reproduced exactly.
 */
export const rankReproduction = (
  exact: readonly number[],
  approximate: readonly number[],
  queryLanguages: readonly number[],
  languages: readonly string[],
  tolerance = 0.1,
): Reproduction => {
  const kept = exact.map((rank, i) => Math.abs(approximate[i]! - rank) <= tolerance * rank);
  const share = (filter: (i: number) => boolean) => {
    const selected = kept.filter((_, i) => filter(i));
    return percent(selected.filter(Boolean).length, selected.length);
  };
  return {
    overall: share(() => true),
    byLanguage: Object.fromEntries(languages.map((code, language) => [code, share((i) => queryLanguages[i] === language)])),
  };
};

/**
 * Per-item cost of one strategy: a passage pays its embedding plus an equal share of the index build;
 * a query pays its own embedding plus its own search, summed before summarizing so p95 stays a real p95.
 */
export const endToEnd = (
  passageEmbedMs: readonly number[],
  queryEmbedMs: readonly number[],
  indexMs: number,
  searchMs: readonly number[],
): { passageMs: Summary; queryMs: Summary } => {
  if (queryEmbedMs.length !== searchMs.length) throw new Error("one search time per embedded query expected");
  const share = indexMs / passageEmbedMs.length;
  return {
    passageMs: summarize(passageEmbedMs.map((ms) => ms + share)),
    queryMs: summarize(queryEmbedMs.map((ms, i) => ms + searchMs[i]!)),
  };
};

export const cosine = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / Math.sqrt(na * nb);
};

export const MIB = 1024 * 1024;
export const toMiB = (bytes: number): number => round(bytes / MIB, 2);
