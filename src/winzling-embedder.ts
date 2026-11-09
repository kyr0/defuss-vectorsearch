/**
 * Winzling ONNX embedder without a cache backend. Entry points bind the cache: `onnx.ts` the isomorphic
 * filesystem/browser one, `browser.ts` the browser-only one. VERIFIED: per scripts/test-browser-bundle.ts, the
 * browser.js bundle then contains no Node code.
 */
import { Tokenizer } from "@huggingface/tokenizers";
import type { InferenceSession, Tensor } from "onnxruntime-web";
import { WINZLING_FILES, WINZLING_MODEL_ID, WINZLING_PROFILE, WINZLING_REVISION } from "./model-profiles.js";
import { loadOrtNode, loadOrtWeb, type Ort } from "./ort-runtime.js";
import { readPinnedAsset, type PinnedAssetCache, type PinnedAssetLocation, type PinnedAssetOptions } from "./pinned-asset.js";
import type { EmbedOptions, QueryEmbedOptions } from "./types.js";

export { WINZLING_FILES, WINZLING_MODEL_ID, WINZLING_PROFILE, WINZLING_REVISION } from "./model-profiles.js";

/** Names kept for the public API; the pinned-asset reader owns these shapes. VERIFIED: the fields are unchanged. */
export type WinzlingAssetLocation = PinnedAssetLocation;
export type WinzlingAssetCache = PinnedAssetCache;

/** Asset options (`modelBaseUrl`, `brotliWasm`, `loadFile`, cache) come from the reader both models share. */
export interface WinzlingOptions extends PinnedAssetOptions {
  /** Default: wasm (CPU), in both Node and browsers. cpu requires onnxruntime-node. */
  device?: "wasm" | "webgpu" | "cpu" | undefined;
  /** Per-instance output normalization; defaults to true. */
  normalize?: boolean | undefined;
  batchSize?: number | undefined;
  maxLength?: number | undefined;
  /** Default false: overlong input fails instead of silently losing text. */
  truncate?: boolean | undefined;
  /** Global ORT Web configuration. Set consistently before creating any sessions. */
  wasmPaths?: string | undefined;
  numThreads?: number | undefined;
}

type Loaded = { ort: Ort; session: InferenceSession; tokenizer: Tokenizer };
const RELEASE = { label: "Winzling", modelId: WINZLING_MODEL_ID, revision: WINZLING_REVISION, files: WINZLING_FILES };

const positiveInteger = (value: number, name: string, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${name} must be an integer in [1, ${maximum}]`);
  }
  return value;
};

/** Mean over attended tokens (including BOS/EOS); padding contributes nothing. */
export const poolWinzling = (
  tensor: { data: ArrayLike<number>; dims: readonly number[] },
  mask: ArrayLike<number | bigint>,
  normalize = true,
): Float32Array[] => {
  const [batch, sequence, width] = tensor.dims;
  if (tensor.dims.length !== 3 || !batch || !sequence || width !== 384 ||
      tensor.data.length !== batch * sequence * width || mask.length !== batch * sequence) {
    throw new Error(`Unexpected Winzling output shape: ${JSON.stringify(tensor.dims)}`);
  }
  const result: Float32Array[] = [];
  for (let b = 0; b < batch; b++) {
    const sums = new Float64Array(width);
    let count = 0;
    for (let s = 0; s < sequence; s++) {
      if (Number(mask[b * sequence + s]) === 0) continue;
      count++;
      const offset = (b * sequence + s) * width;
      for (let d = 0; d < width; d++) {
        const value = tensor.data[offset + d]!;
        if (!Number.isFinite(value)) throw new Error("Non-finite Winzling token state");
        sums[d] = sums[d]! + value;
      }
    }
    if (count === 0) throw new Error("Cannot pool an entirely masked sequence");
    let normSquared = 0;
    for (let d = 0; d < width; d++) {
      sums[d] = sums[d]! / count;
      normSquared += sums[d]! * sums[d]!;
    }
    if (normalize && normSquared === 0) throw new Error("Cannot normalize a zero embedding");
    const divisor = normalize ? Math.sqrt(normSquared) : 1;
    result.push(Float32Array.from(sums, x => x / divisor));
  }
  return result;
};

const readAsset = (name: keyof typeof WINZLING_FILES, options: WinzlingOptions, cache: WinzlingAssetCache): Promise<Uint8Array> =>
  readPinnedAsset(RELEASE, name, options, cache);

/** Reads every pinned file into the cache (download as `.br`, decode, hash check) without creating a session. */
export const prefetchWinzlingAssets = async (options: WinzlingOptions, cache: WinzlingAssetCache): Promise<void> => {
  await Promise.all((Object.keys(WINZLING_FILES) as (keyof typeof WINZLING_FILES)[]).map(name => readAsset(name, options, cache)));
};

/** Standalone ONNX provider; it never imports Transformers.js. */
export class WinzlingEmbedderCore {
  readonly model = WINZLING_MODEL_ID;
  readonly dtype = "q4";
  readonly fingerprint = WINZLING_PROFILE.fingerprint;
  readonly device: "wasm" | "webgpu" | "cpu";
  private readonly options: WinzlingOptions;
  private readonly batchSize: number;
  private readonly maxLength: number;
  private loaded: Promise<Loaded> | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private closing: Promise<void> | undefined;
  private readonly cache: WinzlingAssetCache;

  constructor(options: WinzlingOptions, cache: WinzlingAssetCache) {
    this.cache = cache;
    this.options = { ...options };
    this.device = options.device ?? "wasm";
    if (!["wasm", "webgpu", "cpu"].includes(this.device)) throw new Error(`Unsupported Winzling device: ${this.device}`);
    this.batchSize = positiveInteger(options.batchSize ?? 8, "batchSize");
    this.maxLength = positiveInteger(options.maxLength ?? 8192, "maxLength", 8192);
    if (this.maxLength < 2) throw new RangeError("maxLength must leave room for BOS and EOS (at least 2)");
    positiveInteger(options.numThreads ?? 1, "numThreads");
    if (options.modelBaseUrl && !/^https?:\/\//.test(options.modelBaseUrl)) throw new Error("modelBaseUrl must be an HTTP(S) base URL; use loadFile for filesystem assets");
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Winzling embedder has been disposed"));
    const pending = this.queue.then(operation);
    this.queue = pending.catch(() => {});
    return pending;
  }

  private async initialize(): Promise<Loaded> {
    if (!this.loaded) {
      this.loaded = this.createSession().catch(error => {
        this.loaded = undefined; // A failed fetch/session can be retried.
        throw error;
      });
    }
    return this.loaded;
  }

  private async createSession(): Promise<Loaded> {
    if (this.device === "webgpu") {
      const gpu = typeof navigator === "undefined" ? undefined
        : (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
      if (!gpu || !await gpu.requestAdapter()) {
        throw new Error("WebGPU adapter is unavailable; select device: wasm for CPU inference");
      }
    }
    const ort = this.device === "cpu" ? await loadOrtNode() : await loadOrtWeb(this.options);
    const [tokenizerBytes, configBytes, model] = await Promise.all([
      readAsset("tokenizer.json", this.options, this.cache), readAsset("tokenizer_config.json", this.options, this.cache),
      readAsset("onnx/model_uint4.onnx", this.options, this.cache),
    ]);
    const decoder = new TextDecoder();
    const tokenizer = new Tokenizer(JSON.parse(decoder.decode(tokenizerBytes)), JSON.parse(decoder.decode(configBytes)));
    const session = await ort.InferenceSession.create(model, {
      executionProviders: this.device === "webgpu" ? ["webgpu", "wasm"] : [this.device],
      ...(this.device === "cpu" ? { intraOpNumThreads: this.options.numThreads ?? 1 } : {}),
    });
    if (session.inputNames.length !== 2 || !session.inputNames.includes("input_ids") ||
        !session.inputNames.includes("attention_mask") || !session.outputNames.includes("last_hidden_state")) {
      await session.release();
      throw new Error("Unexpected Winzling ONNX input/output contract");
    }
    return { ort, session, tokenizer };
  }

  /** Eagerly load and validate assets and create the ONNX session. */
  async load(): Promise<void> { return this.enqueue(async () => { await this.initialize(); }); }

  embed(input: string | string[], options: EmbedOptions = {}): Promise<Float32Array[]> {
    const texts = typeof input === "string" ? [input] : Array.isArray(input) ? [...input] : null;
    const normalize = options.normalize ?? this.options.normalize ?? true;
    return this.enqueue(async () => {
      if (!texts || !texts.every(text => typeof text === "string")) throw new TypeError("Expected a string or an array of strings");
      if (options.pooling !== undefined && options.pooling !== "mean") throw new Error("Winzling requires masked mean pooling");
      if (texts.length === 0) return [];
      const { tokenizer, session, ort } = await this.initialize();
      const vectors: Float32Array[] = [];
      for (let start = 0; start < texts.length; start += this.batchSize) {
        const rows = texts.slice(start, start + this.batchSize).map((text, offset) => {
          const ids = tokenizer.encode(text, { add_special_tokens: true }).ids;
          if (ids.length <= this.maxLength) return ids;
          if (!this.options.truncate) throw new RangeError(`Input ${start + offset} has ${ids.length} tokens; maxLength=${this.maxLength}. Chunk it or enable truncate explicitly.`);
          return [...ids.slice(0, this.maxLength - 1), 1]; // Preserve final EOS.
        });
        const length = Math.max(...rows.map(row => row.length));
        const ids = new BigInt64Array(rows.length * length); // pad ID = 0
        const mask = new BigInt64Array(ids.length);
        rows.forEach((row, batch) => row.forEach((id, token) => {
          ids[batch * length + token] = BigInt(id);
          mask[batch * length + token] = 1n;
        }));
        const feeds = {
          input_ids: new ort.Tensor("int64", ids, [rows.length, length]),
          attention_mask: new ort.Tensor("int64", mask, [rows.length, length]),
        };
        let output: InferenceSession.OnnxValueMapType | undefined;
        try {
          output = await session.run(feeds);
          const hidden = output.last_hidden_state as Tensor;
          if (hidden.type !== "float32") throw new Error(`Unexpected Winzling output type: ${hidden.type}`);
          vectors.push(...poolWinzling({ data: hidden.data as Float32Array, dims: hidden.dims }, mask, normalize));
        } finally {
          Object.values(feeds).forEach(tensor => tensor.dispose());
          if (output) Object.values(output).forEach(tensor => tensor.dispose());
        }
      }
      return vectors;
    });
  }

  embedDocuments(input: string | string[], options?: EmbedOptions): Promise<Float32Array[]> { return this.embed(input, options); }
  async embedOne(input: string, options?: EmbedOptions): Promise<Float32Array> { return (await this.embed(input, options))[0]!; }
  embedQuery(input: string, options: QueryEmbedOptions = {}): Promise<Float32Array> {
    if (options.instruction || options.preset) return Promise.reject(new Error("Winzling uses unprefixed queries; instructions/presets are not supported"));
    return this.embedOne(input, options);
  }
  embedQueries(input: readonly string[], options: QueryEmbedOptions = {}): Promise<Float32Array[]> {
    if (options.instruction || options.preset) return Promise.reject(new Error("Winzling uses unprefixed queries; instructions/presets are not supported"));
    return this.embed([...input], options);
  }
  dispose(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = this.queue.then(async () => {
      const loaded = await this.loaded;
      if (loaded) await loaded.session.release();
      this.loaded = undefined;
    });
    return this.closing;
  }
}
