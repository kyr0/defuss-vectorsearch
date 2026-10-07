/**
 * tiny-embedding-bench-v1 loader: hash pin, structural validation, task layout.
 * Runs unchanged in Node and Chromium, so it uses Web Crypto and no Node APIs.
 */

export const DATASET_URL =
  "https://github.com/kyr0/tiny-embedding-bench/raw/refs/heads/main/datasets/tiny-embedding-bench-v1/dataset.json";
// VERIFIED: MANIFEST.json of tiny-embedding-bench-v1 lists this hash; the benchmark is frozen, so a drift is an error.
export const DATASET_SHA256 = "3d09d3653b72cf19c5226cd134bdd7d92ac31f2822cf45bc60879e7a95a75e6d";
export const DATASET_SCHEMA = "tiny-multilingual-retrieval.v1";

/**
 * VERIFIED: maintainer decision of 2026-10-07: these are the languages the benchmarked models are built for. Overall
 * recall in the README covers only queries in these languages, rather than shrinking the haystack, so every
 * language's passages stay as distractors and one run still yields per-language results for all of them.
 */
export const TARGET_LANGUAGES = [
  "deu_Latn", "rus_Cyrl", "eng_Latn", "fra_Latn", "ind_Latn", "nld_Latn", "ita_Latn", "por_Latn", "spa_Latn",
] as const;

/** The subset of the upstream `TinyRetrievalDataset` (src/types.ts) that the benchmark reads. */
export interface TinyRetrievalDataset {
  schema: string;
  name: string;
  languages: string[];
  corpus: { id: string; text: string[] }[];
  queries: { id: string; text: string[] }[];
  qrels: [queryId: string, passageId: string, score: number][];
}

export interface BenchTasks {
  readonly languages: readonly string[];
  /** Every localized passage; index = group * languages.length + language. */
  readonly passages: readonly { readonly text: string; readonly language: number }[];
  /** Every localized query with its gold passage in the SAME language. */
  readonly queries: readonly { readonly text: string; readonly language: number; readonly target: number }[];
}

export const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const fail = (message: string): never => {
  throw new Error(`Invalid tiny-embedding-bench dataset: ${message}`);
};

const isStringArray = (value: unknown, length: number): value is string[] =>
  Array.isArray(value) && value.length === length && value.every((entry) => typeof entry === "string");

/** Checks the invariants the benchmark depends on; the upstream validator covers the full contract. */
export const validateDataset = (raw: unknown): TinyRetrievalDataset => {
  const data = raw as Partial<TinyRetrievalDataset> | null;
  if (data === null || typeof data !== "object") return fail("not an object");
  if (data.schema !== DATASET_SCHEMA) fail(`schema ${String(data.schema)} !== ${DATASET_SCHEMA}`);
  if (typeof data.name !== "string") fail("name missing");
  const languages = data.languages;
  if (!Array.isArray(languages) || languages.length === 0 || !languages.every((code) => typeof code === "string")) {
    return fail("languages must be a non-empty string array");
  }
  if (new Set(languages).size !== languages.length) fail("duplicate language codes");
  const size = languages.length;
  for (const key of ["corpus", "queries"] as const) {
    const records = data[key];
    if (!Array.isArray(records) || records.length === 0) return fail(`${key} must be a non-empty array`);
    const ids = new Set<string>();
    for (const record of records) {
      if (typeof record?.id !== "string" || ids.has(record.id)) fail(`${key} ids must be unique strings`);
      if (!isStringArray(record.text, size)) fail(`${key} ${record.id}: text must have ${size} strings`);
      ids.add(record.id);
    }
  }
  const passageIds = new Set(data.corpus!.map((passage) => passage.id));
  const qrels = data.qrels;
  if (!Array.isArray(qrels)) return fail("qrels must be an array");
  const judged = new Set<string>();
  for (const qrel of qrels) {
    const [queryId, passageId] = Array.isArray(qrel) ? qrel : [];
    if (typeof queryId !== "string" || typeof passageId !== "string") return fail("qrels must be [queryId, passageId, score]");
    if (!passageIds.has(passageId)) fail(`qrel ${queryId} cites unknown passage ${passageId}`);
    if (judged.has(queryId)) fail(`query ${queryId} has more than one qrel`);
    judged.add(queryId);
  }
  for (const query of data.queries!) if (!judged.has(query.id)) fail(`query ${query.id} has no qrel`);
  return data as TinyRetrievalDataset;
};

/** Verifies the pinned hash, then validates; `bytes` is the exact downloaded file. */
export const loadDataset = async (bytes: Uint8Array): Promise<TinyRetrievalDataset> => {
  const actual = await sha256Hex(bytes);
  if (actual !== DATASET_SHA256) {
    throw new Error(`bench/dataset.json SHA-256 ${actual} !== pinned ${DATASET_SHA256}; run \`make download-bench\``);
  }
  return validateDataset(JSON.parse(new TextDecoder().decode(bytes)));
};

/**
 * One haystack holds every localized passage (groups × languages), so a query competes with the
 * translations of its own gold passage. The target is the gold passage in the query's language.
 */
export const buildBenchTasks = (dataset: TinyRetrievalDataset): BenchTasks => {
  const size = dataset.languages.length;
  const groupIndex = new Map(dataset.corpus.map((passage, index) => [passage.id, index]));
  const gold = new Map(dataset.qrels.map(([queryId, passageId]) => [queryId, groupIndex.get(passageId)!]));
  const passages = dataset.corpus.flatMap((passage) =>
    passage.text.map((text, language) => ({ text, language })),
  );
  const queries = dataset.queries.flatMap((query) =>
    query.text.map((text, language) => ({ text, language, target: gold.get(query.id)! * size + language })),
  );
  return { languages: dataset.languages, passages, queries };
};
