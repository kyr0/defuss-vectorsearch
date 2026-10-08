/**
 * The docs demo's prebuilt index, in two parts: `documents` (JSON: provenance, passages, queries and the TurboQuant
 * header) and `vectors` (binary: the TurboQuant signs, then every code byte). Written by scripts/docs/build-index.ts in
 * Node (gzipped), read by examples/search-worker.ts in the browser (gunzipped with DecompressionStream), so it uses only
 * APIs both have. Columns instead of objects keep 2,000 rows small.
 * Why binary vectors instead of base64 inside the JSON: base64 adds a third and gzip cannot take it back.
 * VERIFIED: the vector index is 512,576 bytes raw and 431 kB gzipped; as base64 in JSON it was 475 kB gzipped.
 */
import type { TurboQuantSearchIndex } from "../../src/types.ts";

export const DEMO_INDEX_SCHEMA = "defuss-vectorsearch-demo-index.v2";

export interface DemoIndex {
  readonly schema: typeof DEMO_INDEX_SCHEMA;
  /** Provenance and license of the passages and queries (CC-BY-SA-4.0 requires attribution). */
  readonly dataset: { name: string; sha256: string; license: string; licenseUrl: string; attribution: string; citation: string };
  /** The model the passages were embedded with; queries must use the same one. */
  readonly model: { id: string; revision: string; fingerprint: string };
  readonly languages: readonly string[];
  /** Row i is vector i of `index`; `group` is the source passage shared by all its translations. */
  readonly passages: readonly { text: string; language: number; group: number }[];
  /** `gold`: the passage row answering the query in the query's own language. */
  readonly queries: readonly { text: string; language: number; gold: number }[];
  readonly index: TurboQuantSearchIndex;
}

const columns = <T extends object>(rows: readonly T[], keys: readonly (keyof T)[]) =>
  Object.fromEntries(keys.map((key) => [key, rows.map((row) => row[key])]));

const rows = <T>(table: Record<string, unknown[]>, keys: readonly string[], name: string): T[] => {
  const length = table[keys[0]!]?.length ?? 0;
  if (!keys.every((key) => Array.isArray(table[key]) && table[key].length === length)) throw new Error(`Invalid demo index: ${name} columns differ in length`);
  return Array.from({ length }, (_, i) => Object.fromEntries(keys.map((key) => [key, table[key]![i]])) as T);
};

export const encodeDemoIndex = (demo: DemoIndex): { documents: string; vectors: Uint8Array } => {
  const { index } = demo;
  const vectors = new Uint8Array(index.signs.length + index.codes.length);
  vectors.set(new Uint8Array(index.signs.buffer, index.signs.byteOffset, index.signs.byteLength));
  vectors.set(index.codes, index.signs.length);
  const documents = JSON.stringify({
    ...demo,
    passages: columns(demo.passages, ["text", "language", "group"]),
    queries: columns(demo.queries, ["text", "language", "gold"]),
    index: { size: index.size, dims: index.dims, rotatedDims: index.rotatedDims, codeBytes: index.codeBytes, clip: index.clip, codebook: Array.from(index.codebook) },
  });
  return { documents, vectors };
};

/** Validates what the worker relies on: the schema, the vector file's length, and one passage per indexed vector. */
export const decodeDemoIndex = (raw: unknown, vectors: Uint8Array): DemoIndex => {
  const data = raw as Record<string, any>;
  if (data?.schema !== DEMO_INDEX_SCHEMA) throw new Error(`Invalid demo index: schema ${String(data?.schema)} !== ${DEMO_INDEX_SCHEMA}`);
  const { size, dims, rotatedDims, codeBytes, clip, codebook } = data.index;
  if (vectors.length !== rotatedDims + size * codeBytes) throw new Error(`Invalid demo index: vector file has ${vectors.length} bytes, expected ${rotatedDims + size * codeBytes}`);
  const index: TurboQuantSearchIndex = {
    size, dims, rotatedDims, codeBytes, clip,
    codebook: Float32Array.from(codebook),
    signs: new Int8Array(vectors.slice(0, rotatedDims).buffer),
    codes: vectors.slice(rotatedDims),
  };
  const passages = rows<DemoIndex["passages"][number]>(data.passages, ["text", "language", "group"], "passages");
  if (passages.length !== size) throw new Error(`Invalid demo index: ${passages.length} passages for ${size} vectors`);
  const { schema, dataset, model, languages } = data;
  return { schema, dataset, model, languages, passages, queries: rows(data.queries, ["text", "language", "gold"], "queries"), index };
};
