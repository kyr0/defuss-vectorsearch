/**
 * One model, one environment: embed every passage and query, then search with both strategies.
 * Node and Chromium inject the embedder and probes; search code comes from the built dist/,
 * so the benchmark measures the published artifact, not the source tree.
 */
import { buildTurboQuantIndex, scoreTurboQuantIndex, searchTurboQuantIndex } from "../../dist/turboquant.mjs";
import { dotProduct, normalizeVector, searchTopK } from "../../dist/vector-search.mjs";
import type { BenchTasks } from "./dataset.ts";
import {
  KS,
  rankOf,
  endToEnd,
  rankReproduction,
  recallMatrix,
  round,
  summarize,
  toMiB,
  type RecallMatrix,
  type Reproduction,
  type Summary,
} from "./metrics.ts";

/** One long-lived embedder per model: the ONNX session is created once and reused for every call. */
export interface BenchEmbedder {
  readonly modelId: string;
  readonly device: string;
  load(): Promise<void>;
  embedPassage(text: string): Promise<Float32Array>;
  embedQuery(text: string): Promise<Float32Array>;
  dispose(): Promise<void>;
}

export interface BenchProbes {
  /** Bytes the runtime holds after a forced GC; its definition differs per environment. */
  memoryBytes(): Promise<number>;
  log(message: string): void;
}

export interface StrategyResult {
  /** Building the whole index from embeddings: normalization (bruteforce) or 4-bit quantization (TurboQuant). */
  readonly indexMs: number;
  readonly indexMiB: number;
  readonly searchMs: Summary;
  /** Per passage: embedding + its share of `indexMs`. */
  readonly passageMs: Summary;
  /** Per query: embedding + search, summed per query before summarizing. */
  readonly queryMs: Summary;
  /** `modelRuntimeMiB` + `indexMiB`. */
  readonly runtimeMiB: number;
  readonly recall: RecallMatrix;
}

export interface ModelResult {
  readonly modelId: string;
  readonly device: string;
  readonly dims: number;
  readonly loadMs: number;
  readonly embedMs: { readonly passage: Summary; readonly query: Summary };
  /** Memory growth over load + embedding, minus the embedding arrays held at the probe. */
  readonly modelRuntimeMiB: number;
  readonly strategies: {
    readonly bruteforce: StrategyResult;
    readonly turboquant: StrategyResult & { readonly rankReproduced10pct: Reproduction };
  };
  /** First passages' vectors, compared across environments and then dropped from bench.json. */
  readonly sample: number[][];
}

const MAX_K = KS[KS.length - 1]!;
const WARMUP_QUERIES = 10;
export const SAMPLE_SIZE = 40;

const timed = async <T>(fn: () => Promise<T>): Promise<[T, number]> => {
  const start = performance.now();
  const value = await fn();
  return [value, performance.now() - start];
};

const embedAll = async (
  texts: readonly string[],
  embed: (text: string) => Promise<Float32Array>,
  label: string,
  log: (message: string) => void,
): Promise<[Float32Array[], number[]]> => {
  const vectors: Float32Array[] = [];
  const ms: number[] = [];
  for (const [i, text] of texts.entries()) {
    const [vector, elapsed] = await timed(() => embed(text));
    vectors.push(vector);
    ms.push(elapsed);
    if ((i + 1) % 250 === 0 || i + 1 === texts.length) log(`embedded ${label} ${i + 1}/${texts.length}`);
  }
  return [vectors, ms];
};

/**
 * Times one top-k search per query and ranks the target from the full score vector.
 * VERIFIED: the same scores feed `topKFromScores`, so a target ranked <= MAX_K must sit at that position (checked per query).
 */
const runStrategy = (
  queries: readonly Float32Array[],
  targets: readonly number[],
  search: (query: Float32Array) => readonly { index: number }[],
  score: (query: Float32Array) => ArrayLike<number>,
): { ranks: number[]; ms: number[] } => {
  for (const query of queries.slice(0, WARMUP_QUERIES)) search(query);
  const ranks: number[] = [];
  const ms: number[] = [];
  for (const [i, query] of queries.entries()) {
    const start = performance.now();
    const hits = search(query);
    ms.push(performance.now() - start);
    const rank = rankOf(score(query), targets[i]!);
    if (rank <= MAX_K && hits[rank - 1]?.index !== targets[i]) {
      throw new Error(`rank ${rank} disagrees with the top-${MAX_K} list for query ${i}`);
    }
    ranks.push(rank);
  }
  return { ranks, ms };
};

const strategyCost = (
  indexMs: number,
  indexBytes: number,
  searchMs: readonly number[],
  passageEmbedMs: readonly number[],
  queryEmbedMs: readonly number[],
  modelRuntimeBytes: number,
): Omit<StrategyResult, "recall"> => ({
  indexMs: round(indexMs),
  indexMiB: toMiB(indexBytes),
  searchMs: summarize(searchMs),
  ...endToEnd(passageEmbedMs, queryEmbedMs, indexMs, searchMs),
  runtimeMiB: toMiB(modelRuntimeBytes + indexBytes),
});

export const runModelBench = async (
  tasks: BenchTasks,
  embedder: BenchEmbedder,
  probes: BenchProbes,
): Promise<ModelResult> => {
  const { log } = probes;
  const memoryBefore = await probes.memoryBytes();
  const [, loadMs] = await timed(() => embedder.load());
  log(`loaded ${embedder.modelId} on ${embedder.device} in ${loadMs.toFixed(0)} ms`);

  const [passageVectors, passageMs] = await embedAll(tasks.passages.map((p) => p.text), (t) => embedder.embedPassage(t), "passages", log);
  const [queryVectors, queryMs] = await embedAll(tasks.queries.map((q) => q.text), (t) => embedder.embedQuery(t), "queries", log);
  const dims = passageVectors[0]!.length;
  // VERIFIED: both strategies in one process differ by 0.5-4 MiB of index, inside RSS noise, so per-strategy
  // runtime = measured model growth (without the embeddings held here) + the exact index size.
  const heldBytes = (passageVectors.length + queryVectors.length) * dims * Float32Array.BYTES_PER_ELEMENT;
  const modelRuntimeBytes = (await probes.memoryBytes()) - memoryBefore - heldBytes;

  const targets = tasks.queries.map((q) => q.target);
  const queryLanguages = tasks.queries.map((q) => q.language);
  const queries = queryVectors.map((vector) => normalizeVector(vector));
  const exactStart = performance.now();
  const haystack = passageVectors.map((vector) => normalizeVector(vector));
  const exactIndexMs = performance.now() - exactStart;

  const exact = runStrategy(
    queries,
    targets,
    (query) => searchTopK(haystack, query, MAX_K),
    (query) => Float32Array.from(haystack, (vector) => dotProduct(vector, query)),
  );
  const turboStart = performance.now();
  const index = buildTurboQuantIndex(haystack);
  const turboIndexMs = performance.now() - turboStart;
  const turbo = runStrategy(
    queries,
    targets,
    (query) => searchTurboQuantIndex(index, query, MAX_K),
    (query) => scoreTurboQuantIndex(index, query),
  );
  log(`searched ${queries.length} queries with bruteforce and turboquant`);

  return {
    modelId: embedder.modelId,
    device: embedder.device,
    dims,
    loadMs: Math.round(loadMs),
    embedMs: { passage: summarize(passageMs), query: summarize(queryMs) },
    modelRuntimeMiB: toMiB(modelRuntimeBytes),
    strategies: {
      bruteforce: {
        ...strategyCost(exactIndexMs, haystack.length * dims * Float32Array.BYTES_PER_ELEMENT, exact.ms, passageMs, queryMs, modelRuntimeBytes),
        recall: recallMatrix(exact.ranks, queryLanguages, tasks.languages),
      },
      turboquant: {
        ...strategyCost(turboIndexMs, index.codes.byteLength + index.signs.byteLength + index.codebook.byteLength, turbo.ms, passageMs, queryMs, modelRuntimeBytes),
        recall: recallMatrix(turbo.ranks, queryLanguages, tasks.languages),
        rankReproduced10pct: rankReproduction(exact.ranks, turbo.ranks, queryLanguages, tasks.languages),
      },
    },
    sample: haystack.slice(0, SAMPLE_SIZE).map((vector) => Array.from(vector)),
  };
};
