import type { ExactSearchMulticoreOptions, SearchHit, SearchResult, Vectors } from "./types.js";
import { searchTopK } from "./vector-math.js";

export * from "./vector-math.js";

const DEFAULT_MULTICORE_THRESHOLD = 8_192;

type MulticoreModule = typeof import("defuss-multicore");

type MulticoreChunkSearcher = (
  haystackChunk: ArrayLike<number>[],
  needlePayload: { values: ArrayLike<number> },
  k: number,
  callOptions?: {
    cores?: number;
    transfer?: boolean;
  },
) => PromiseLike<SearchHit[][]>;

const multicoreChunkSearcherCache = new Map<string, Promise<MulticoreChunkSearcher>>();
let multicoreModulePromise: Promise<MulticoreModule> | null = null;

const loadMulticoreModule = (): Promise<MulticoreModule> => {
  if (!multicoreModulePromise) {
    multicoreModulePromise = import("defuss-multicore");
  }

  return multicoreModulePromise;
};

const mergeTopKHits = (hits: readonly SearchHit[], k: number): SearchHit[] => {
  return [...hits]
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.index - right.index;
    })
    .slice(0, Math.min(k, hits.length));
};

const buildChunkOffsets = (length: number, cores: number): Int32Array => {
  const offsets = new Int32Array(cores);
  const base = Math.floor(length / cores);
  const remainder = length % cores;

  let offset = 0;

  for (let workerIndex = 0; workerIndex < cores; workerIndex++) {
    offsets[workerIndex] = offset;
    offset += base + (workerIndex < remainder ? 1 : 0);
  }

  return offsets;
};

const searchChunkTopK = (
  haystackChunk: ArrayLike<number>[],
  needlePayload: { values: ArrayLike<number> },
  k: number,
): SearchHit[] => {
  const needle = needlePayload.values;
  const kk = Math.min(k, haystackChunk.length);
  if (kk === 0) {
    return [];
  }

  const values = new Float32Array(kk);
  const indices = new Int32Array(kk);

  for (let i = 0; i < kk; i++) {
    values[i] = -Infinity;
    indices[i] = -1;
  }

  for (let vectorIndex = 0; vectorIndex < haystackChunk.length; vectorIndex++) {
    const vector = haystackChunk[vectorIndex]!;

    if (vector.length !== needle.length) {
      throw new Error(`Vector length mismatch: ${vector.length} !== ${needle.length}`);
    }

    let score = 0.0;
    let dimIndex = 0;
    const unrollFactor = 8;
    const limit = Math.floor(vector.length / unrollFactor) * unrollFactor;

    for (; dimIndex < limit; dimIndex += unrollFactor) {
      score +=
        vector[dimIndex]! * needle[dimIndex]! +
        vector[dimIndex + 1]! * needle[dimIndex + 1]! +
        vector[dimIndex + 2]! * needle[dimIndex + 2]! +
        vector[dimIndex + 3]! * needle[dimIndex + 3]! +
        vector[dimIndex + 4]! * needle[dimIndex + 4]! +
        vector[dimIndex + 5]! * needle[dimIndex + 5]! +
        vector[dimIndex + 6]! * needle[dimIndex + 6]! +
        vector[dimIndex + 7]! * needle[dimIndex + 7]!;
    }

    for (; dimIndex < vector.length; dimIndex++) {
      score += vector[dimIndex]! * needle[dimIndex]!;
    }

    if (score <= values[kk - 1]!) {
      continue;
    }

    let insertAt = kk - 1;
    while (insertAt > 0 && score > values[insertAt - 1]!) {
      values[insertAt] = values[insertAt - 1]!;
      indices[insertAt] = indices[insertAt - 1]!;
      insertAt--;
    }

    values[insertAt] = score;
    indices[insertAt] = vectorIndex;
  }

  const hits: SearchHit[] = [];
  for (let i = 0; i < kk; i++) {
    if (indices[i]! >= 0) {
      hits.push({ index: indices[i]!, score: values[i]! });
    }
  }

  return hits;
};

const getMulticoreChunkSearcher = async (
  options: ExactSearchMulticoreOptions,
): Promise<MulticoreChunkSearcher> => {
  const threshold = options.threshold ?? DEFAULT_MULTICORE_THRESHOLD;
  const eager = options.eager ?? false;
  const cacheKey = `${threshold}:${eager}`;
  const existing = multicoreChunkSearcherCache.get(cacheKey);

  if (existing) {
    return await existing;
  }

  const pendingSearcher = loadMulticoreModule().then(
    ({ multicore }) =>
      multicore(searchChunkTopK, { threshold, eager }) as MulticoreChunkSearcher,
  );
  multicoreChunkSearcherCache.set(cacheKey, pendingSearcher);

  return await pendingSearcher;
};

export const searchTopKMulticore = async (
  haystack: Vectors,
  needle: ArrayLike<number>,
  k: number,
  options: ExactSearchMulticoreOptions = {},
): Promise<SearchHit[]> => {
  const kk = Math.min(k, haystack.length);
  if (kk <= 0 || haystack.length === 0) {
    return [];
  }

  const threshold = options.threshold ?? DEFAULT_MULTICORE_THRESHOLD;
  const { getPoolSize } = await loadMulticoreModule();
  const cores = Math.max(1, Math.floor(options.cores ?? getPoolSize()));

  if (cores === 1 || haystack.length < threshold) {
    return searchTopK(haystack, needle, kk);
  }

  const searcher = await getMulticoreChunkSearcher(options);
  const offsets = buildChunkOffsets(haystack.length, cores);
  const partialHits = await searcher(Array.from(haystack), { values: needle }, kk, {
    cores,
    transfer: options.transfer ?? false,
  });

  const mergedHits = partialHits.flatMap((hits, workerIndex) => {
    const chunkOffset = offsets[workerIndex] ?? 0;

    return hits.map((hit) => ({
      index: hit.index + chunkOffset,
      score: hit.score,
    }));
  });

  return mergeTopKHits(mergedHits, kk);
};

export const attachRecords = <TRecord>(
  hits: readonly SearchHit[],
  records: readonly TRecord[],
): SearchResult<TRecord>[] => {
  return hits.map((hit) => ({
    ...hit,
    record: records[hit.index],
  }));
};

