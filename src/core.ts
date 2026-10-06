import { WINZLING_MODEL_ID, WINZLING_PROFILE, WINZLING_REVISION } from "./model-profiles.js";
import { clearModelCache, inspectModelCache } from "./model-cache-management.js";
import { normalizeVector } from "./vector-search.js";
import { prefetchModel } from "./model-prefetch.js";
import { DEFAULT_MODEL_ID, resolveModelSource } from "./model-source.js";
import { fetchOpenAICompatibleEmbeddings } from "./openai-compatible.js";
import { formatInstructionQuery } from "./prompts.js";
import type {
  EmbedOptions,
  Embedder,
  EmbedderInitOptions,
  FeatureExtractorLike,
  ModelCacheClearResult,
  ModelCacheInspectionResult,
  ModelCacheOptions,
  ModelLoadOptions,
  ModelPrefetchOptions,
  ModelPrefetchResult,
  QueryEmbedOptions,
  ResolvedModelSource,
  TensorLike,
  TransformersModuleLike,
} from "./types.js";

const DEFAULT_MODEL = DEFAULT_MODEL_ID;
const DEFAULT_DTYPE = "fp32" as const;
const DEFAULT_POOLING = "last_token" as const;
const DEFAULT_NORMALIZE = true;

const getTransformersModule = async (): Promise<TransformersModuleLike> => {
  return import("@huggingface/transformers") as Promise<TransformersModuleLike>;
};

const configureEnv = (
  mod: TransformersModuleLike,
  options: EmbedderInitOptions,
  defaults: { allowLocalModels: boolean; useBrowserCache?: boolean },
): void => {
  mod.env.allowRemoteModels = options.allowRemoteModels ?? true;
  mod.env.allowLocalModels = options.allowLocalModels ?? defaults.allowLocalModels;

  if (options.localModelPath !== undefined) mod.env.localModelPath = options.localModelPath;
  if (options.cacheDir !== undefined) mod.env.cacheDir = options.cacheDir;
  if (options.useBrowserCache !== undefined) mod.env.useBrowserCache = options.useBrowserCache;
  else if (defaults.useBrowserCache !== undefined) mod.env.useBrowserCache = defaults.useBrowserCache;
  if (options.useFSCache !== undefined) mod.env.useFSCache = options.useFSCache;
  if (options.useFS !== undefined) mod.env.useFS = options.useFS;
  if (options.logLevel !== undefined) mod.env.logLevel = options.logLevel;
};

const splitTensor = (tensor: TensorLike): Float32Array[] => {
  const dims = tensor.dims;
  if (dims.length !== 2) {
    throw new Error(`Expected pooled 2D tensor, got dims=${JSON.stringify(dims)}`);
  }

  const batch = dims[0]!;
  const width = dims[1]!;
  const data = tensor.data instanceof Float32Array ? tensor.data : Float32Array.from(tensor.data);
  const embeddings: Float32Array[] = new Array(batch);

  for (let row = 0; row < batch; row++) {
    const start = row * width;
    embeddings[row] = data.slice(start, start + width);
  }

  return embeddings;
};

export interface RuntimeDefaults {
  readonly allowLocalModels: boolean;
  readonly useBrowserCache?: boolean;
}

export class BaseEmbeddingRuntime implements Embedder {
  public model: string;
  public get dtype(): NonNullable<EmbedderInitOptions["dtype"]> {
    return this.options.dtype ?? (this.isWinzling() ? "q4" : DEFAULT_DTYPE);
  }
  public get device(): EmbedderInitOptions["device"] {
    return this.options.device ?? (this.isWinzling() ? this.options.winzling?.device ?? "wasm" : undefined);
  }

  private readonly options: EmbedderInitOptions;
  private readonly runtimeDefaults: RuntimeDefaults;
  private resolvedModelSource: ResolvedModelSource | null;
  private requiredFiles: readonly string[] | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private closing: Promise<void> | undefined;
  private extractorPromise: Promise<FeatureExtractorLike> | null = null;

  public constructor(options: EmbedderInitOptions = {}, runtimeDefaults: RuntimeDefaults) {
    this.options = options;
    this.runtimeDefaults = runtimeDefaults;
    this.model = options.model ?? options.openAICompatible?.model ?? (options.modelProfile === "winzling" ? WINZLING_MODEL_ID : DEFAULT_MODEL);
    this.resolvedModelSource = options.openAICompatible
      ? null
      : resolveModelSource(this.model, {
          revision: options.revision ?? (options.modelProfile === "winzling" ? WINZLING_REVISION : undefined),
        });
    this.requiredFiles = options.requiredFiles;


  }

  private isWinzling(): boolean {
    return !this.options.openAICompatible && (this.model === WINZLING_MODEL_ID || this.options.modelProfile === "winzling");
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Embedder has been disposed"));
    const pending = this.queue.then(operation);
    this.queue = pending.catch(() => {});
    return pending;
  }

  private isOpenAICompatibleMode(): boolean {
    return this.options.openAICompatible !== undefined;
  }

  private getLocalModelSource(operation: string): ResolvedModelSource {
    if (this.resolvedModelSource === null) {
      throw new Error(
        `${operation} is unavailable when using an OpenAI-compatible embedding endpoint.`,
      );
    }

    return this.resolvedModelSource;
  }

  public loadModel(urlOrRepoId: string, options: ModelLoadOptions = {}): Promise<void> {
    return this.enqueue(() => this.loadModelInternal(urlOrRepoId, options));
  }

  private async loadModelInternal(urlOrRepoId: string, options: ModelLoadOptions): Promise<void> {
    const previous = await this.extractorPromise;
    await previous?.dispose?.();
    this.extractorPromise = null;
    this.model = urlOrRepoId;
    if (this.isOpenAICompatibleMode()) {
      this.extractorPromise = null;
      return;
    }

    this.resolvedModelSource = resolveModelSource(urlOrRepoId, {
      revision: options.revision ?? this.options.revision ?? (this.isWinzling() ? WINZLING_REVISION : undefined),
      cacheKey: options.cacheKey,
      remoteHost: options.remoteHost,
      remotePathTemplate: options.remotePathTemplate,
    });
    this.requiredFiles = options.requiredFiles ?? this.options.requiredFiles;
    this.extractorPromise = null;
    await this.getExtractor();
  }

  public async prefetchModel(
    urlOrRepoId = this.model,
    options: ModelPrefetchOptions = {},
  ): Promise<ModelPrefetchResult> {
    const source = this.getLocalModelSource("prefetchModel");
    return prefetchModel(urlOrRepoId, {
      revision: options.revision ?? source.revision,
      dtype: options.dtype ?? this.dtype,
      cacheKey: options.cacheKey,
      remoteHost: options.remoteHost,
      remotePathTemplate: options.remotePathTemplate,
      cacheDir: options.cacheDir ?? this.options.cacheDir,
      requiredFiles: options.requiredFiles ?? this.requiredFiles ?? (this.isWinzling() ? WINZLING_PROFILE.requiredFiles : undefined),
    });
  }

  public async inspectModelCache(
    urlOrRepoId = this.model,
    options: ModelCacheOptions = {},
  ): Promise<ModelCacheInspectionResult> {
    const source = this.getLocalModelSource("inspectModelCache");
    return inspectModelCache(urlOrRepoId, {
      revision: options.revision ?? source.revision,
      dtype: options.dtype ?? this.dtype,
      cacheKey: options.cacheKey,
      remoteHost: options.remoteHost,
      remotePathTemplate: options.remotePathTemplate,
      cacheDir: options.cacheDir ?? this.options.cacheDir,
      requiredFiles: options.requiredFiles ?? this.requiredFiles ?? (this.isWinzling() ? WINZLING_PROFILE.requiredFiles : undefined),
    });
  }

  public async clearModelCache(
    urlOrRepoId = this.model,
    options: ModelCacheOptions = {},
  ): Promise<ModelCacheClearResult> {
    const source = this.getLocalModelSource("clearModelCache");
    return clearModelCache(urlOrRepoId, {
      revision: options.revision ?? source.revision,
      dtype: options.dtype ?? this.dtype,
      cacheKey: options.cacheKey,
      remoteHost: options.remoteHost,
      remotePathTemplate: options.remotePathTemplate,
      cacheDir: options.cacheDir ?? this.options.cacheDir,
      requiredFiles: options.requiredFiles ?? this.requiredFiles ?? (this.isWinzling() ? WINZLING_PROFILE.requiredFiles : undefined),
    });
  }

  public embed(input: string | string[], options: EmbedOptions = {}): Promise<Float32Array[]> {
    const snapshot = Array.isArray(input) ? [...input] : input;
    return this.enqueue(() => this.embedInternal(snapshot, options));
  }

  private async embedInternal(input: string | string[], options: EmbedOptions): Promise<Float32Array[]> {
    if (Array.isArray(input) && input.length === 0) return [];
    const shouldNormalize = options.normalize ?? this.options.normalize ?? (this.isWinzling() ? this.options.winzling?.normalize : undefined) ?? DEFAULT_NORMALIZE;
    if (this.options.openAICompatible) {
      const embeddings = await fetchOpenAICompatibleEmbeddings(
        input,
        this.model,
        this.options.openAICompatible,
      );

      return shouldNormalize
        ? embeddings.map((embedding) => normalizeVector(embedding))
        : embeddings;
    }

    const extractor = await this.getExtractor();
    const output = await extractor(input, {
      pooling: options.pooling ?? this.options.pooling ?? (this.isWinzling() ? "mean" : DEFAULT_POOLING),
      normalize: false,
    });

    const embeddings = splitTensor(output);
    return shouldNormalize ? embeddings.map((embedding) => normalizeVector(embedding)) : embeddings;
  }

  public async embedDocuments(
    input: string | string[],
    options: EmbedOptions = {},
  ): Promise<Float32Array[]> {
    return this.embed(input, options);
  }

  public async embedOne(input: string, options: EmbedOptions = {}): Promise<Float32Array> {
    const [embedding] = await this.embed(input, options);
    if (!embedding) {
      throw new Error("No embedding returned");
    }
    return embedding;
  }

  public async embedQuery(
    input: string,
    options: QueryEmbedOptions = {},
  ): Promise<Float32Array> {
    return (await this.embedQueries([input], options))[0]!;
  }

  public async embedQueries(
    input: readonly string[],
    options: QueryEmbedOptions = {},
  ): Promise<Float32Array[]> {
    const snapshot = [...input];
    return this.enqueue(() => {
      if (this.isWinzling() && (options.instruction || options.preset)) {
        throw new Error("Winzling uses unprefixed queries; instructions/presets are not supported");
      }
      return this.embedInternal(this.isWinzling() ? snapshot : snapshot.map(query => formatInstructionQuery(query, options)), options);
    });
  }

  public dispose(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = this.queue.then(async () => {
      const extractor = await this.extractorPromise;
      await extractor?.dispose?.();
      this.extractorPromise = null;
    });
    return this.closing;
  }

  private async getExtractor(): Promise<FeatureExtractorLike> {
    if (this.isOpenAICompatibleMode()) {
      throw new Error(
        "Local extractor access is unavailable when using an OpenAI-compatible embedding endpoint.",
      );
    }

    if (this.extractorPromise !== null) {
      return this.extractorPromise;
    }

    this.extractorPromise = (async () => {
      const source = this.getLocalModelSource("getExtractor");
      if (this.isWinzling()) {
        if (this.dtype !== "q4") throw new Error("Winzling requires dtype: q4 (the model_uint4.onnx artifact)");
        // VERIFIED: modelProfile outlives loadModel(); without this a different repo ID would silently run Winzling.
        if (source.kind === "repo" && source.input !== WINZLING_MODEL_ID) throw new Error(`modelProfile "winzling" accepts only ${WINZLING_MODEL_ID} or an HTTP(S) mirror, not ${source.input}`);
        if (source.kind === "repo" && source.revision !== WINZLING_REVISION) throw new Error("Winzling support is pinned to the audited WINZLING_REVISION");
        const { createWinzlingExtractor } = await import("./onnx.js");
        return createWinzlingExtractor({
          ...this.options.winzling,
          device: (this.options.device ?? this.options.winzling?.device ?? "wasm") as "wasm" | "cpu" | "webgpu",
          cacheDir: this.options.winzling?.cacheDir ?? this.options.cacheDir,
          allowRemoteModels: this.options.winzling?.allowRemoteModels ?? this.options.allowRemoteModels,
          ...(source.kind === "url" ? { modelBaseUrl: source.input } : {}),
        });
      }
      const shouldWarmCacheOnLoad =
        this.options.warmCacheOnLoad ?? (!this.options.moduleFactory && !this.options.pipelineFactory);

      if (shouldWarmCacheOnLoad) {
        await this.prefetchModel(this.model, {
          revision: source.revision,
          cacheDir: this.options.cacheDir,
        });
      }

      const mod = this.options.moduleFactory
        ? await this.options.moduleFactory()
        : await getTransformersModule();

      configureEnv(mod, this.options, this.runtimeDefaults);
      mod.env.remoteHost = source.remoteHost;
      mod.env.remotePathTemplate = source.remotePathTemplate;

      const pipelineFactory = this.options.pipelineFactory ?? mod.pipeline;
      return pipelineFactory("feature-extraction", source.modelId, {
        dtype: this.dtype,
        ...(this.options.device ? { device: this.options.device } : {}),
        ...(source.revision
          ? { revision: source.revision }
          : {}),
      });
    })().catch(error => { this.extractorPromise = null; throw error; });

    return this.extractorPromise;
  }
}
