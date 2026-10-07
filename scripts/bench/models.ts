/** The benchmarked models, keyed for CLI args and bench.json. Paths are relative to the repo root. */
import { WINZLING_MODEL_ID, WINZLING_REVISION } from "../../dist/shared.mjs";

export const MODELS = {
  winzling: { modelId: WINZLING_MODEL_ID, cachePath: `${WINZLING_MODEL_ID}/${WINZLING_REVISION}` },
  harrier: { modelId: "tss-deposium/harrier-oss-v1-270m-onnx-int8", cachePath: "tss-deposium/harrier-oss-v1-270m-onnx-int8" },
} as const;

export type ModelKey = keyof typeof MODELS;
export const MODEL_KEYS = Object.keys(MODELS) as ModelKey[];

/** VERIFIED: Node downloads into this cache, hash-checking Winzling; Chromium then loads the same bytes over HTTP. (make bench) */
export const BENCH_CACHE_DIR = "bench/cache";

export const isModelKey = (value: unknown): value is ModelKey => typeof value === "string" && value in MODELS;

/** One line per event: ISO-8601 UTC timestamp, level, message, key=value. */
export const logLine = (level: "INFO" | "ERROR", message: string, fields: Record<string, string> = {}): string =>
  [new Date().toISOString(), level, message, ...Object.entries(fields).map(([k, v]) => `${k}=${v}`)].join(" ");
