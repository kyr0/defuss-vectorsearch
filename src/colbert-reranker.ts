/**
 * MoEdernColBERT late-interaction reranker without a cache backend; `onnx.ts` and `browser.ts` bind one, as for
 * Winzling. It encodes a query and candidate passages into per-token vectors and scores them with MaxSim, so it
 * reorders the hits of a dense search instead of replacing it: its 128-dimensional token vectors live in a space
 * unrelated to any dense embedding model.
 *
 * The tokenization contract (prefixes, 32-position queries, punctuation excluded from document scoring) is ported
 * from the exporter's JavaScript core. VERIFIED: tests check this port against Python reference scores for every
 * pinned graph (src/colbert-reranker.live.test.ts).
 */
import { Tokenizer } from "@huggingface/tokenizers";
import type { InferenceSession, Tensor } from "onnxruntime-web";
import { MOEDERNCOLBERT_MODELS } from "./model-profiles.js";
import { describeOrt, loadOrtNode, loadOrtWeb, type Ort } from "./ort-runtime.js";
import { readPinnedAsset, type PinnedAssetCache, type PinnedAssetOptions } from "./pinned-asset.js";
import type { SearchHit } from "./types.js";

/**
 * Token ids for one prefixed text, as the Rust tokenizers library produces them. `@huggingface/tokenizers` 0.2.0
 * splits on JavaScript's `\s`, which also matches U+FEFF (byte-order mark) and misses U+0085 (next line), while Rust
 * splits on Unicode White_Space. So U+0085 becomes a space, where Rust also splits, and U+FEFF becomes U+2060 (word
 * joiner). No pinned vocabulary contains either character, so both stay one `<unk>` inside the word, as in Rust. Each
 * replacement keeps the UTF-16 length. VERIFIED: the live tests compare these ids with Rust tokenizers for both pinned
 * tokenizers. A sweep of every code point (203,152 texts) and 31,178 passages differs only on 96 code points that are
 * newer than Rust's Unicode tables (2026-11-08).
 */
export function tokenIds(tokenizer: Tokenizer, prefix: string, text: string): number[] {
  return tokenizer.encode(prefix + text.replace(/\u0085/g, " ").replace(/\uFEFF/g, "\u2060")).ids;
}

export type ColbertModel = keyof typeof MOEDERNCOLBERT_MODELS;
export type ColbertPrecision = "fp32" | "fp16" | "q8" | "int8" | "q4";

/** One text's token vectors, row-major. Padding (and, for documents, punctuation) is already removed. */
export interface TokenMatrix {
  readonly data: Float32Array;
  readonly tokenCount: number;
  readonly dimensions: number;
  /** Graph and, for runtime-dependent precisions, runtime; MaxSim refuses to mix fingerprints. */
  readonly fingerprint: string;
  readonly truncated: boolean;
}

export interface ColbertEncodeOptions {
  /** Default: the instance's `truncate`. Overlong input fails unless this is true. */
  truncate?: boolean | undefined;
  /** Document position budget in [3, 512], default 512. */
  documentLength?: number | undefined;
}

export interface ColbertRerankerOptions extends PinnedAssetOptions {
  model: ColbertModel;
  /** Default q8: INT8 weights with FP32 math, identical vectors in every runtime. */
  precision?: ColbertPrecision | undefined;
  /** Default: wasm (CPU), in both Node and browsers. cpu requires onnxruntime-node. */
  device?: "wasm" | "cpu" | undefined;
  batchSize?: number | undefined;
  /** Default false: overlong input fails instead of silently losing text. */
  truncate?: boolean | undefined;
  /** Global ORT Web configuration. Set consistently before creating any sessions. */
  wasmPaths?: string | undefined;
  numThreads?: number | undefined;
}

export interface RerankedHit {
  readonly index: number;
  readonly score: number;
}

/** A dense hit after fusion with its ColBERT score; `index` is the dense hit's own `index`. */
export interface FusedHit {
  readonly index: number;
  /** Reciprocal rank fusion score: 1 / (60 + dense rank) + 1 / (60 + ColBERT rank); 2 / (60 + dense rank) when the dense order stands. */
  readonly score: number;
  /** 1-based position in the dense hits passed in. */
  readonly denseRank: number;
  readonly colbertScore: number;
}

export interface FuseOptions extends ColbertEncodeOptions {
  /** How many of the first dense hits to rerank; default 25. */
  candidates?: number | undefined;
  topK?: number | undefined;
  /** The dense order stands when its top score leads the second by at least this much; default 0.1, `Infinity` always fuses. */
  denseMargin?: number | undefined;
}

export interface FuseRanksOptions {
  /** Dense scores in the same positions as the ColBERT scores, best first; they enable the `denseMargin` check. */
  denseScores?: readonly number[] | undefined;
  denseMargin?: number | undefined;
}

interface RuntimeConfig {
  dimensions: number;
  query_length: number;
  max_document_length: number;
  prefixes: { query: string; document: string };
  pad_token_id: number;
  sep_token_id: number;
  skip_token_ids: number[];
}
type Kind = "query" | "document";
type Loaded = { ort: Ort; session: InferenceSession; tokenizer: Tokenizer; config: RuntimeConfig; skip: Set<number>; fingerprint: string };

const positiveInteger = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  return value;
};

const validateMatrix = (matrix: TokenMatrix): void => {
  if (!Number.isInteger(matrix.tokenCount) || matrix.tokenCount < 1 || !Number.isInteger(matrix.dimensions) ||
      matrix.dimensions < 1 || matrix.data.length !== matrix.tokenCount * matrix.dimensions ||
      matrix.data.some(value => !Number.isFinite(value))) throw new Error("Invalid token matrix");
};

/** Sum over query tokens of the best dot product with any document token. Scores are not probabilities. */
export const maxSim = (query: TokenMatrix, document: TokenMatrix): number => {
  validateMatrix(query); validateMatrix(document);
  if (query.dimensions !== document.dimensions) throw new Error("Token dimensions differ");
  if (query.fingerprint !== document.fingerprint) throw new Error("Cannot mix token matrices with different fingerprints");
  const width = query.dimensions;
  let score = 0;
  for (let q = 0; q < query.tokenCount; q++) {
    let best = -Infinity;
    for (let d = 0; d < document.tokenCount; d++) {
      let dot = 0;
      for (let k = 0; k < width; k++) dot += query.data[q * width + k]! * document.data[d * width + k]!;
      best = Math.max(best, dot);
    }
    score += best;
  }
  return score;
};

/**
 * Reciprocal rank fusion constant of Cormack, Clarke and Buettcher (SIGIR 2009). VERIFIED: with 25 candidates it
 * lifted Winzling's R@1 from 66.4 to 76.2 on the bench's target languages, where the ColBERT order alone reached 70.9.
 */
const RRF_K = 60;
/** VERIFIED: fusion held R@1 between 75.6 and 77.1 for 10 to 100 candidates; 25 keeps a query's rerank near 160 ms in WASM. */
const DEFAULT_CANDIDATES = 25;
/**
 * Winzling cosine margin above which fusion keeps the dense order. VERIFIED (tmp/fusion-gate-probe.ts, 450 target
 * queries): over the 87 queries whose top hit led by 0.1 or more, fusion never lifted the gold passage to rank 1 and
 * dropped it from rank 1 once; R@1 stayed at 77.1 for margins from 0.06 to 0.13. VERIFIED: it keeps the demo's
 * "Bücher" note on top, which fusion moved to third.
 */
const DEFAULT_DENSE_MARGIN = 0.1;

const denseMarginOf = (value: number | undefined): number => {
  const margin = value ?? DEFAULT_DENSE_MARGIN;
  if (typeof margin !== "number" || Number.isNaN(margin) || margin < 0) throw new RangeError("denseMargin must be a non-negative number");
  return margin;
};

/**
 * Fuses a dense order with ColBERT scores of the same candidates: `colbertScores[i]` scores the dense hit at rank
 * `i + 1`. Returns those positions best first with their fused score; ties keep the dense order. Fusion, not the
 * ColBERT order alone, keeps what the dense model knows better. VERIFIED: over 25 Winzling candidates, the ColBERT
 * order alone halved R@3 in Japanese (38 to 20) and Chinese (24 to 12); fused, they reached 28 and 20.
 * With `denseScores`, a dense top hit that leads by `denseMargin` keeps the dense order. VERIFIED: rank fusion ignores
 * score gaps, and near-equal ColBERT scores outvoted a clear dense winner in the demo's notes (DEFAULT_DENSE_MARGIN).
 * Use it with `maxSim` when passage vectors are cached; `rerankHits` does both steps.
 */
export const fuseRanks = (colbertScores: readonly number[], options: FuseRanksOptions = {}): { position: number; score: number }[] => {
  if (!colbertScores.every(Number.isFinite)) throw new Error("ColBERT scores must be finite numbers");
  const margin = denseMarginOf(options.denseMargin);
  const dense = options.denseScores;
  if (dense !== undefined && (dense.length !== colbertScores.length || !dense.every(Number.isFinite))) {
    throw new Error("denseScores must hold one finite score per ColBERT score");
  }
  if (dense !== undefined && dense.length > 1 && dense[0]! - dense[1]! >= margin) {
    return colbertScores.map((_, position) => ({ position, score: 2 / (RRF_K + position + 1) }));
  }
  const colbertRank: number[] = [];
  colbertScores.map((score, position) => ({ score, position }))
    .sort((a, b) => b.score - a.score || a.position - b.position)
    .forEach((entry, rank) => { colbertRank[entry.position] = rank + 1; });
  return colbertScores.map((_, position) => ({ position, score: 1 / (RRF_K + position + 1) + 1 / (RRF_K + colbertRank[position]!) }))
    .sort((a, b) => b.score - a.score || a.position - b.position);
};

/** Highest score first; ties keep candidate order. */
export const rankEncoded = (query: TokenMatrix, documents: readonly TokenMatrix[]): RerankedHit[] =>
  documents.map((document, index) => ({ index, score: maxSim(query, document) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

export class ColbertRerankerCore {
  readonly model: ColbertModel;
  readonly precision: ColbertPrecision;
  readonly device: "wasm" | "cpu";
  private readonly options: ColbertRerankerOptions;
  private readonly batchSize: number;
  private readonly graph: string;
  private loaded: Promise<Loaded> | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private closing: Promise<void> | undefined;
  private readonly cache: PinnedAssetCache;

  constructor(options: ColbertRerankerOptions, cache: PinnedAssetCache) {
    this.cache = cache;
    this.options = { ...options };
    const profile = MOEDERNCOLBERT_MODELS[options.model as ColbertModel] as (typeof MOEDERNCOLBERT_MODELS)[ColbertModel] | undefined;
    if (!profile) throw new Error(`Unknown MoEdernColBERT model: ${String(options.model)}; use ${Object.keys(MOEDERNCOLBERT_MODELS).join(" or ")}`);
    this.model = options.model;
    this.precision = options.precision ?? "q8";
    if (!(this.precision in profile.precisions)) {
      throw new Error(`MoEdernColBERT ${this.model} ships no ${this.precision} graph; available: ${Object.keys(profile.precisions).join(", ")}`);
    }
    this.graph = `model_${this.precision}.onnx`;
    this.device = options.device ?? "wasm";
    if (!["wasm", "cpu"].includes(this.device)) throw new Error(`Unsupported reranker device: ${this.device}`);
    this.batchSize = positiveInteger(options.batchSize ?? 4, "batchSize");
    positiveInteger(options.numThreads ?? 1, "numThreads");
    if (options.modelBaseUrl && !/^https?:\/\//.test(options.modelBaseUrl)) throw new Error("modelBaseUrl must be an HTTP(S) base URL; use loadFile for filesystem assets");
  }

  private get profile() { return MOEDERNCOLBERT_MODELS[this.model]; }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error("MoEdernColBERT reranker has been disposed"));
    const pending = this.queue.then(operation);
    this.queue = pending.catch(() => {});
    return pending;
  }

  private initialize(): Promise<Loaded> {
    if (!this.loaded) {
      this.loaded = this.createSession().catch(error => {
        this.loaded = undefined; // A failed fetch/session can be retried.
        throw error;
      });
    }
    return this.loaded;
  }

  private async createSession(): Promise<Loaded> {
    const release = { label: "MoEdernColBERT", modelId: this.profile.id, revision: this.profile.revision, files: this.profile.files };
    // Every asset is hash-checked before the session exists, so a corrupt graph never reaches ONNX Runtime.
    const [tokenizerBytes, configBytes, runtimeBytes, model] = await Promise.all(
      ["tokenizer.json", "tokenizer_config.json", "runtime.json", this.graph]
        .map(name => readPinnedAsset(release, name, this.options, this.cache)));
    const ort = this.device === "cpu" ? await loadOrtNode() : await loadOrtWeb(this.options);
    const decode = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes));
    const tokenizer = new Tokenizer(decode(tokenizerBytes!), decode(configBytes!));
    const config = decode(runtimeBytes!) as RuntimeConfig;
    const session = await ort.InferenceSession.create(model!, {
      executionProviders: [this.device],
      ...(this.device === "cpu" ? { intraOpNumThreads: this.options.numThreads ?? 1 } : {}),
    });
    if (session.inputNames.length !== 2 || !session.inputNames.includes("input_ids") ||
        !session.inputNames.includes("attention_mask") || !session.outputNames.includes("token_embeddings")) {
      await session.release();
      throw new Error("Unexpected MoEdernColBERT ONNX input/output contract");
    }
    const parity = (this.profile.precisions as Record<string, string>)[this.precision];
    const fingerprint = `${this.profile.id}@${this.profile.revision}:${this.profile.files[this.graph as keyof typeof this.profile.files]}` +
      (parity === "quality" ? `:${describeOrt(ort, this.device)}` : "");
    return { ort, session, tokenizer, config, skip: new Set(config.skip_token_ids), fingerprint };
  }

  /** Eagerly load and validate assets and create the ONNX session. */
  async load(): Promise<void> { return this.enqueue(async () => { await this.initialize(); }); }

  /** Cache key component for document vectors: pinned graph, plus the runtime for fp16 and int8. */
  fingerprint(): Promise<string> { return this.enqueue(async () => (await this.initialize()).fingerprint); }

  private prepare(loaded: Loaded, texts: readonly string[], kind: Kind, options: ColbertEncodeOptions) {
    const { config, tokenizer, skip } = loaded;
    const documentLength = options.documentLength ?? config.max_document_length;
    if (!Number.isInteger(documentLength) || documentLength < 3 || documentLength > config.max_document_length) {
      throw new RangeError(`documentLength must be an integer in [3, ${config.max_document_length}]`);
    }
    const truncate = options.truncate ?? this.options.truncate ?? false;
    const limit = kind === "query" ? config.query_length : documentLength;
    const truncated: boolean[] = [];
    const rows = texts.map((text, offset) => {
      let ids = tokenIds(tokenizer, config.prefixes[kind], text);
      truncated.push(ids.length > limit);
      if (ids.length > limit) {
        if (!truncate) throw new RangeError(`${kind} ${offset} has ${ids.length} tokens; limit is ${limit}. Chunk it or enable truncate explicitly.`);
        ids = [...ids.slice(0, limit - 1), config.sep_token_id]; // Preserve the final [SEP].
      }
      return ids;
    });
    // Queries always fill the expansion width; the graph attends to their padding by design.
    const width = kind === "query" ? limit : Math.max(...rows.map(row => row.length));
    const ids = new BigInt64Array(rows.length * width).fill(BigInt(config.pad_token_id));
    const mask = new BigInt64Array(ids.length);
    const keep = rows.map(() => Array.from({ length: width }, () => kind === "query"));
    rows.forEach((row, b) => row.forEach((id, t) => {
      ids[b * width + t] = BigInt(id);
      mask[b * width + t] = 1n;
      if (kind === "document") keep[b]![t] = !skip.has(id);
    }));
    return { ids, mask, keep, width, truncated };
  }

  /** Runs inside a queued operation; callers snapshot `input` before queueing. */
  private async encodeQueued(input: readonly string[] | null, kind: Kind, options: ColbertEncodeOptions): Promise<TokenMatrix[]> {
    if (!input || !input.every(text => typeof text === "string")) throw new TypeError("Expected an array of strings");
    if (input.length === 0) return [];
    const loaded = await this.initialize();
    const { ort, session, config } = loaded;
    const dimensions = config.dimensions;
    const matrices: TokenMatrix[] = [];
    for (let start = 0; start < input.length; start += this.batchSize) {
      const batch = this.prepare(loaded, input.slice(start, start + this.batchSize), kind, options);
      const rows = batch.keep.length;
      const feeds = {
        input_ids: new ort.Tensor("int64", batch.ids, [rows, batch.width]),
        attention_mask: new ort.Tensor("int64", batch.mask, [rows, batch.width]),
      };
      let output: InferenceSession.OnnxValueMapType | undefined;
      try {
        output = await session.run(feeds);
        const tensor = output.token_embeddings as Tensor;
        const data = tensor.data as Float32Array;
        if (tensor.type !== "float32" || data.length !== rows * batch.width * dimensions || data.some(x => !Number.isFinite(x))) {
          throw new Error(`Unexpected MoEdernColBERT output: ${tensor.type} ${JSON.stringify(tensor.dims)}`);
        }
        for (let b = 0; b < rows; b++) {
          const tokenCount = batch.keep[b]!.filter(Boolean).length;
          const vectors = new Float32Array(tokenCount * dimensions);
          let target = 0;
          for (let t = 0; t < batch.width; t++) if (batch.keep[b]![t]) {
            const source = (b * batch.width + t) * dimensions;
            vectors.set(data.subarray(source, source + dimensions), target);
            target += dimensions;
          }
          matrices.push({ data: vectors, tokenCount, dimensions, fingerprint: loaded.fingerprint, truncated: batch.truncated[b]! });
        }
      } finally {
        Object.values(feeds).forEach(tensor => tensor.dispose());
        if (output) Object.values(output).forEach(tensor => tensor.dispose());
      }
    }
    return matrices;
  }

  private encode(texts: readonly string[], kind: Kind, options: ColbertEncodeOptions): Promise<TokenMatrix[]> {
    const input = Array.isArray(texts) ? [...texts] : null;
    return this.enqueue(() => this.encodeQueued(input, kind, options));
  }

  /** Always 32 positions per query, including [MASK] expansion. */
  encodeQueries(texts: readonly string[], options: ColbertEncodeOptions = {}): Promise<TokenMatrix[]> {
    return this.encode(texts, "query", options);
  }

  /** Cache these per passage, keyed by `matrix.fingerprint`, content and chunking policy. */
  encodeDocuments(texts: readonly string[], options: ColbertEncodeOptions = {}): Promise<TokenMatrix[]> {
    return this.encode(texts, "document", options);
  }

  /**
   * Encodes and scores in one call; `index` refers to `documents`. The ColBERT order replaces the input order, so use
   * `rerankHits` for the hits of a dense search: VERIFIED, this order alone fell below Winzling's at 100 candidates.
   */
  async rerank(query: string, documents: readonly string[], options: ColbertEncodeOptions & { topK?: number | undefined } = {}): Promise<RerankedHit[]> {
    if (options.topK !== undefined && (!Number.isInteger(options.topK) || options.topK < 0)) throw new RangeError("topK must be a non-negative integer");
    if (typeof query !== "string") throw new TypeError("query must be a string");
    const input = Array.isArray(documents) ? [...documents] : null;
    if (input?.length === 0) return [];
    // One queued operation, so dispose() cannot land between query and document encoding. VERIFIED: with two
    // operations, the live test's dispose-after-rerank case rejected an accepted call.
    return this.enqueue(async () => {
      const [encodedQuery] = await this.encodeQueued([query], "query", options);
      const ranked = rankEncoded(encodedQuery!, await this.encodeQueued(input, "document", options));
      return options.topK === undefined ? ranked : ranked.slice(0, options.topK);
    });
  }

  /**
   * Reranks the first `candidates` hits of a dense search (best first, e.g. from `searchTurboQuantIndex`) and fuses
   * the ColBERT order with the dense order, unless the top dense hit leads by `denseMargin` (see `fuseRanks`).
   * `documents[hit.index]` must hold each hit's text. Returns at most `candidates` hits; the dense hits after them keep
   * their order and are not returned.
   */
  async rerankHits(query: string, hits: readonly SearchHit[], documents: readonly string[],
    options: FuseOptions = {}): Promise<FusedHit[]> {
    const candidates = positiveInteger(options.candidates ?? DEFAULT_CANDIDATES, "candidates");
    if (options.topK !== undefined && (!Number.isInteger(options.topK) || options.topK < 0)) throw new RangeError("topK must be a non-negative integer");
    if (typeof query !== "string") throw new TypeError("query must be a string");
    if (!Array.isArray(hits) || !Array.isArray(documents)) throw new TypeError("hits and documents must be arrays");
    const fuseOptions = { denseScores: hits.slice(0, candidates).map(hit => hit.score), denseMargin: denseMarginOf(options.denseMargin) };
    if (!fuseOptions.denseScores.every(Number.isFinite)) throw new RangeError("Hit scores must be finite numbers");
    const pool = hits.slice(0, candidates).map(hit => hit.index);
    const texts = pool.map(index => {
      const text = Number.isInteger(index) ? documents[index] : undefined;
      if (typeof text !== "string") throw new RangeError(`Hit index ${String(index)} has no document text`);
      return text;
    });
    if (pool.length === 0) return [];
    return this.enqueue(async () => {
      const [encodedQuery] = await this.encodeQueued([query], "query", options);
      const colbert = (await this.encodeQueued(texts, "document", options)).map(document => maxSim(encodedQuery!, document));
      const fused = fuseRanks(colbert, fuseOptions).map(({ position, score }) =>
        ({ index: pool[position]!, score, denseRank: position + 1, colbertScore: colbert[position]! }));
      return options.topK === undefined ? fused : fused.slice(0, options.topK);
    });
  }

  dispose(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = this.queue.then(async () => {
      const loaded = await this.loaded?.catch(() => undefined);
      if (loaded) await loaded.session.release();
      this.loaded = undefined;
    });
    return this.closing;
  }
}
