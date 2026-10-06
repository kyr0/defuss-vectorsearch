import type { WinzlingOptions } from "./onnx.js";
export type Vector = Float32Array;
export type Vectors = ReadonlyArray<Float32Array>;
export type EmbeddingDType = "q4" | "q4f16" | "q8" | "fp16" | "fp32";
export type EmbeddingDevice = "wasm" | "webgpu" | "cpu" | string;
export type PoolingStrategy = "mean" | "none" | "last_token";
export type QueryInstructionPreset = "web_search_query" | "sts_query" | "bitext_query";
export type ModelSourceKind = "repo" | "url";
export type ModelCacheLocation = "filesystem" | "browser-cache" | "browser-db";

export interface OpenAICompatibleEmbeddingEndpointOptions {
  endpoint?: string | undefined;
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  headers?: Record<string, string> | undefined;
  dimensions?: number | undefined;
  encodingFormat?: string | undefined;
  user?: string | undefined;
  extraBody?: Record<string, unknown> | undefined;
  model?: string | undefined;
  fetch?: typeof fetch | undefined;
}

export interface TensorLike {
  readonly data: ArrayLike<number>;
  readonly dims: readonly number[];
  readonly type?: string | undefined;
}

export interface FeatureExtractorLike {
  dispose?: () => Promise<void>;
  (input: string | string[], options?: Record<string, unknown>): Promise<TensorLike>;
}

export interface TransformersEnvLike {
  allowRemoteModels?: boolean | undefined;
  allowLocalModels?: boolean | undefined;
  localModelPath?: string | undefined;
  cacheDir?: string | null | undefined;
  remoteHost?: string | undefined;
  remotePathTemplate?: string | undefined;
  useBrowserCache?: boolean | undefined;
  useFSCache?: boolean | undefined;
  useFS?: boolean | undefined;
  logLevel?: number | undefined;
}

export interface ModelLoadOptions {
  revision?: string | undefined;
  cacheKey?: string | undefined;
  remoteHost?: string | undefined;
  remotePathTemplate?: string | undefined;
  requiredFiles?: readonly string[] | undefined;
}

export interface ResolvedModelSource {
  readonly kind: ModelSourceKind;
  readonly input: string;
  readonly modelId: string;
  readonly revision: string;
  readonly remoteHost: string;
  readonly remotePathTemplate: string;
}

export interface ModelPrefetchOptions extends ModelLoadOptions {
  dtype?: EmbeddingDType | undefined;
  cacheDir?: string | null | undefined;
}

export interface ModelCacheOptions extends ModelPrefetchOptions {}

export interface ModelPrefetchFile {
  readonly fileName: string;
  readonly remoteUrl: string;
  readonly cacheKey: string;
}

export interface ModelPrefetchResult {
  readonly source: ResolvedModelSource;
  readonly files: readonly ModelPrefetchFile[];
}

export interface ModelCacheFileStatus {
  readonly fileName: string;
  readonly remoteUrl: string;
  readonly cacheKey: string;
  readonly locations: readonly ModelCacheLocation[];
}

export interface ModelCacheInspectionResult {
  readonly source: ResolvedModelSource;
  readonly files: readonly ModelCacheFileStatus[];
}

export interface ModelCacheClearFileResult extends ModelCacheFileStatus {
  readonly removedFrom: readonly ModelCacheLocation[];
}

export interface ModelCacheClearResult {
  readonly source: ResolvedModelSource;
  readonly files: readonly ModelCacheClearFileResult[];
}

export interface TransformersModuleLike {
  pipeline: (
    task: "feature-extraction",
    model: string,
    options?: Record<string, unknown>,
  ) => Promise<FeatureExtractorLike>;
  env: TransformersEnvLike;
}

export interface EmbedderInitOptions {
  /** Explicit profile for a self-hosted mirror. Known model IDs select it automatically. */
  modelProfile?: "winzling" | undefined;
  winzling?: WinzlingOptions | undefined;
  model?: string | undefined;
  dtype?: EmbeddingDType | undefined;
  device?: EmbeddingDevice | undefined;
  pooling?: PoolingStrategy | undefined;
  normalize?: boolean | undefined;
  warmCacheOnLoad?: boolean | undefined;
  requiredFiles?: readonly string[] | undefined;
  revision?: string | undefined;
  cacheDir?: string | null | undefined;
  allowLocalModels?: boolean | undefined;
  allowRemoteModels?: boolean | undefined;
  localModelPath?: string | undefined;
  useBrowserCache?: boolean | undefined;
  useFSCache?: boolean | undefined;
  useFS?: boolean | undefined;
  logLevel?: number | undefined;
  pipelineFactory?: TransformersModuleLike["pipeline"] | undefined;
  moduleFactory?: () => Promise<TransformersModuleLike>;
  openAICompatible?: OpenAICompatibleEmbeddingEndpointOptions | undefined;
}

export interface EmbedOptions {
  pooling?: PoolingStrategy | undefined;
  normalize?: boolean | undefined;
}

export interface QueryEmbedOptions extends EmbedOptions {
  instruction?: string | undefined;
  preset?: QueryInstructionPreset | undefined;
}

export interface Embedder {
  dispose(): Promise<void>;
  model: string;
  readonly dtype: EmbeddingDType;
  readonly device?: EmbeddingDevice | undefined;
  embed(input: string | string[], options?: EmbedOptions): Promise<Float32Array[]>;
  embedDocuments(input: string | string[], options?: EmbedOptions): Promise<Float32Array[]>;
  embedOne(input: string, options?: EmbedOptions): Promise<Float32Array>;
  embedQuery(input: string, options?: QueryEmbedOptions): Promise<Float32Array>;
  embedQueries(input: readonly string[], options?: QueryEmbedOptions): Promise<Float32Array[]>;
  loadModel(urlOrRepoId: string, options?: ModelLoadOptions): Promise<void>;
  prefetchModel(urlOrRepoId?: string, options?: ModelPrefetchOptions): Promise<ModelPrefetchResult>;
  inspectModelCache(
    urlOrRepoId?: string,
    options?: ModelCacheOptions,
  ): Promise<ModelCacheInspectionResult>;
  clearModelCache(
    urlOrRepoId?: string,
    options?: ModelCacheOptions,
  ): Promise<ModelCacheClearResult>;
}

export interface ExactSearchMulticoreOptions {
  cores?: number | undefined;
  threshold?: number | undefined;
  eager?: boolean | undefined;
  transfer?: boolean | undefined;
}

export interface SearchHit {
  readonly index: number;
  readonly score: number;
}

export interface SearchResult<TRecord = unknown> extends SearchHit {
  readonly record?: TRecord | undefined;
}

export interface TurboQuantSearchIndex {
  readonly size: number;
  readonly dims: number;
  readonly rotatedDims: number;
  readonly codeBytes: number;
  readonly clip: number;
  readonly codebook: Float32Array;
  readonly signs: Int8Array;
  readonly codes: Uint8Array;
}

export interface TurboQuantRerankedSearchHit extends SearchHit {
  readonly approximateScore: number;
}

export interface TurboQuantRerankResult {
  readonly approximateTopK: readonly SearchHit[];
  readonly rerankedTopK: readonly TurboQuantRerankedSearchHit[];
}

export interface BuildTurboQuantIndexOptions {
  clip?: number | undefined;
  seed?: number | undefined;
}
