/**
 * One model, one environment: embed every passage and query, then search with each strategy. `runRerankerBench` runs
 * the reranker alone, once per environment, since it does not depend on the dense model.
 * Node and Chromium inject the embedder and probes; search code comes from the built dist/,
 * so the benchmark measures the published artifact, not the source tree.
 */
import { buildTurboQuantIndex, scoreTurboQuantIndex, searchTurboQuantIndex } from "../../dist/turboquant.mjs";
import type { SearchHit } from "../../dist/shared.mjs";
import type { RerankedHit, TokenMatrix } from "../../dist/browser.mjs";
import { dotProduct, normalizeVector, searchTopK } from "../../dist/vector-search.mjs";
import type { BenchTasks } from "./dataset.ts";
import {
  KS,
  bestRankOf,
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

/** The fused strategy's second stage; each environment binds `rerankHits` of its own reranker build. */
export interface BenchReranker {
  load(): Promise<void>;
  rerankHits(query: string, hits: readonly SearchHit[], documents: readonly string[]): Promise<readonly { index: number }[]>;
}

/**
 * The reranker-only strategy's model: token vectors for every passage, encoded once, and one query at a time.
 * `rank` is the environment's own `rankEncoded`, so the scan runs the published MaxSim.
 */
export interface BenchColbert {
  readonly modelId: string;
  readonly device: string;
  load(): Promise<void>;
  encodeDocument(text: string): Promise<TokenMatrix>;
  encodeQuery(text: string): Promise<TokenMatrix>;
  rank(query: TokenMatrix, documents: readonly TokenMatrix[]): RerankedHit[];
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
  /** Like `recall`, but the gold passage in any language counts, so a translation in the top k is a hit. */
  readonly anyLanguageRecall: RecallMatrix;
}

/** The reranker alone: MaxSim of each query against every passage's token vectors, no dense first stage. */
export interface RerankerResult {
  readonly modelId: string;
  readonly device: string;
  readonly loadMs: number;
  readonly embedMs: { readonly passage: Summary; readonly query: Summary };
  /** Memory growth over load + encoding, minus the token vectors held at the probe. */
  readonly modelRuntimeMiB: number;
  /** Token vectors over all passages; `maxsim.indexMiB` is their size. */
  readonly tokens: number;
  readonly maxsim: StrategyResult;
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
    /** TurboQuant's top 25 fused with MoEdernColBERT 1.5M; runtime adds the reranker's memory growth. */
    readonly fused: StrategyResult;
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

const embedAll = async <T>(
  texts: readonly string[],
  embed: (text: string) => Promise<T>,
  label: string,
  log: (message: string) => void,
): Promise<[T[], number[]]> => {
  const vectors: T[] = [];
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
 * Times one top-k search per query and ranks the target, and the best of its translations, from the full score vector.
 * VERIFIED: the same scores feed `topKFromScores`, so a target ranked <= MAX_K must sit at that position (checked per query).
 */
const runStrategy = (
  queries: readonly Float32Array[],
  targets: readonly number[],
  translations: readonly (readonly number[])[],
  search: (query: Float32Array) => readonly { index: number }[],
  score: (query: Float32Array) => ArrayLike<number>,
): { ranks: number[]; anyRanks: number[]; ms: number[] } => {
  for (const query of queries.slice(0, WARMUP_QUERIES)) search(query);
  const ranks: number[] = [];
  const anyRanks: number[] = [];
  const ms: number[] = [];
  for (const [i, query] of queries.entries()) {
    const start = performance.now();
    const hits = search(query);
    ms.push(performance.now() - start);
    const scores = score(query);
    const rank = rankOf(scores, targets[i]!);
    const anyRank = bestRankOf(scores, translations[i]!);
    if ((rank <= MAX_K && hits[rank - 1]?.index !== targets[i]) || (anyRank <= MAX_K && !translations[i]!.includes(hits[anyRank - 1]?.index ?? -1))) {
      throw new Error(`rank ${rank} or ${anyRank} disagrees with the top-${MAX_K} list for query ${i}`);
    }
    ranks.push(rank);
    anyRanks.push(anyRank);
  }
  return { ranks, anyRanks, ms };
};

const strategyCost = (
  indexMs: number,
  indexBytes: number,
  searchMs: readonly number[],
  passageEmbedMs: readonly number[],
  queryEmbedMs: readonly number[],
  modelRuntimeBytes: number,
): Omit<StrategyResult, "recall" | "anyLanguageRecall"> => ({
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
  reranker: BenchReranker,
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
  // Passage index = group * languages + language (dataset.ts), so the gold passage in every language is its group.
  const size = tasks.languages.length;
  const translations = targets.map((target) => Array.from({ length: size }, (_, language) => target - (target % size) + language));
  const queryLanguages = tasks.queries.map((q) => q.language);
  const queries = queryVectors.map((vector) => normalizeVector(vector));
  const exactStart = performance.now();
  const haystack = passageVectors.map((vector) => normalizeVector(vector));
  const exactIndexMs = performance.now() - exactStart;

  const exact = runStrategy(
    queries,
    targets,
    translations,
    (query) => searchTopK(haystack, query, MAX_K),
    (query) => Float32Array.from(haystack, (vector) => dotProduct(vector, query)),
  );
  const turboStart = performance.now();
  const index = buildTurboQuantIndex(haystack);
  const turboIndexMs = performance.now() - turboStart;
  const turbo = runStrategy(
    queries,
    targets,
    translations,
    (query) => searchTurboQuantIndex(index, query, MAX_K),
    (query) => scoreTurboQuantIndex(index, query),
  );
  log(`searched ${queries.length} queries with bruteforce and turboquant`);

  // Fused: the reranker encodes each query's candidates at query time, as an app without cached token vectors does.
  const rerankerMemoryBefore = await probes.memoryBytes();
  await reranker.load();
  const passageTexts = tasks.passages.map((passage) => passage.text);
  const fuse = (i: number) => reranker.rerankHits(tasks.queries[i]!.text, searchTurboQuantIndex(index, queries[i]!, MAX_K), passageTexts);
  for (let i = 0; i < WARMUP_QUERIES; i++) await fuse(i);
  const fused = { ranks: [] as number[], anyRanks: [] as number[], ms: [] as number[] };
  for (let i = 0; i < queries.length; i++) {
    const start = performance.now();
    const hits = await fuse(i);
    fused.ms.push(performance.now() - start);
    const position = hits.findIndex((hit) => hit.index === targets[i]);
    // Fusion reorders only the candidates, so a target outside them keeps its TurboQuant rank. VERIFIED: the check
    // below never fired in make bench (2026-10-31), 4,000 queries over both models and environments.
    if (position < 0 && turbo.ranks[i]! <= hits.length) throw new Error(`query ${i}: TurboQuant rank ${turbo.ranks[i]} missing from the fused candidates`);
    fused.ranks.push(position < 0 ? turbo.ranks[i]! : position + 1);
    const anyPosition = hits.findIndex((hit) => translations[i]!.includes(hit.index));
    if (anyPosition < 0 && turbo.anyRanks[i]! <= hits.length) throw new Error(`query ${i}: TurboQuant any-language rank ${turbo.anyRanks[i]} missing from the fused candidates`);
    fused.anyRanks.push(anyPosition < 0 ? turbo.anyRanks[i]! : anyPosition + 1);
    if ((i + 1) % 250 === 0 || i + 1 === queries.length) log(`fused ${i + 1}/${queries.length}`);
  }
  const rerankerRuntimeBytes = (await probes.memoryBytes()) - rerankerMemoryBefore;

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
        anyLanguageRecall: recallMatrix(exact.anyRanks, queryLanguages, tasks.languages),
      },
      turboquant: {
        ...strategyCost(turboIndexMs, index.codes.byteLength + index.signs.byteLength + index.codebook.byteLength, turbo.ms, passageMs, queryMs, modelRuntimeBytes),
        recall: recallMatrix(turbo.ranks, queryLanguages, tasks.languages),
        anyLanguageRecall: recallMatrix(turbo.anyRanks, queryLanguages, tasks.languages),
        rankReproduced10pct: rankReproduction(exact.ranks, turbo.ranks, queryLanguages, tasks.languages),
      },
      fused: {
        ...strategyCost(turboIndexMs, index.codes.byteLength + index.signs.byteLength + index.codebook.byteLength, fused.ms, passageMs, queryMs, modelRuntimeBytes + rerankerRuntimeBytes),
        recall: recallMatrix(fused.ranks, queryLanguages, tasks.languages),
        anyLanguageRecall: recallMatrix(fused.anyRanks, queryLanguages, tasks.languages),
      },
    },
    sample: haystack.slice(0, SAMPLE_SIZE).map((vector) => Array.from(vector)),
  };
};

/**
 * The reranker alone over the whole haystack: every passage encoded once into token vectors (the index), each query
 * ranked by MaxSim against all of them. One `rank` call per query yields both the timed top-k and the full scores, so
 * the 2,000 MaxSim products run once per query.
 */
export const runRerankerBench = async (tasks: BenchTasks, colbert: BenchColbert, probes: BenchProbes): Promise<RerankerResult> => {
  const { log } = probes;
  const memoryBefore = await probes.memoryBytes();
  const [, loadMs] = await timed(() => colbert.load());
  log(`loaded ${colbert.modelId} on ${colbert.device} in ${loadMs.toFixed(0)} ms`);
  const [documents, passageMs] = await embedAll(tasks.passages.map((p) => p.text), (t) => colbert.encodeDocument(t), "passages", log);
  const [queries, queryMs] = await embedAll(tasks.queries.map((q) => q.text), (t) => colbert.encodeQuery(t), "queries", log);
  const bytes = (matrices: readonly TokenMatrix[]) => matrices.reduce((sum, matrix) => sum + matrix.data.byteLength, 0);
  const indexBytes = bytes(documents);
  const modelRuntimeBytes = (await probes.memoryBytes()) - memoryBefore - indexBytes - bytes(queries);

  const targets = tasks.queries.map((q) => q.target);
  const size = tasks.languages.length;
  const translations = targets.map((target) => Array.from({ length: size }, (_, language) => target - (target % size) + language));
  const queryLanguages = tasks.queries.map((q) => q.language);
  for (const query of queries.slice(0, WARMUP_QUERIES)) colbert.rank(query, documents);
  const ranks: number[] = [];
  const anyRanks: number[] = [];
  const ms: number[] = [];
  for (const [i, query] of queries.entries()) {
    const start = performance.now();
    const ranked = colbert.rank(query, documents);
    ms.push(performance.now() - start);
    const scores = new Float64Array(documents.length);
    for (const hit of ranked) scores[hit.index] = hit.score;
    const rank = rankOf(scores, targets[i]!);
    const anyRank = bestRankOf(scores, translations[i]!);
    // VERIFIED: rankEncoded breaks ties by lower index, as rankOf does, so its order must agree with the ranks.
    if (ranked[rank - 1]?.index !== targets[i] || !translations[i]!.includes(ranked[anyRank - 1]?.index ?? -1)) {
      throw new Error(`rank ${rank} or ${anyRank} disagrees with the MaxSim order for query ${i}`);
    }
    ranks.push(rank);
    anyRanks.push(anyRank);
    if ((i + 1) % 250 === 0 || i + 1 === queries.length) log(`ranked ${i + 1}/${queries.length} with MaxSim over all passages`);
  }
  return {
    modelId: colbert.modelId,
    device: colbert.device,
    loadMs: Math.round(loadMs),
    embedMs: { passage: summarize(passageMs), query: summarize(queryMs) },
    modelRuntimeMiB: toMiB(modelRuntimeBytes),
    tokens: documents.reduce((sum, matrix) => sum + matrix.tokenCount, 0),
    // Encoding is the index build, so its time sits in passageMs and the separate build step is 0.
    maxsim: {
      ...strategyCost(0, indexBytes, ms, passageMs, queryMs, modelRuntimeBytes),
      recall: recallMatrix(ranks, queryLanguages, tasks.languages),
      anyLanguageRecall: recallMatrix(anyRanks, queryLanguages, tasks.languages),
    },
  };
};
