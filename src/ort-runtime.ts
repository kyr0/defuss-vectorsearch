/**
 * Loads ONNX Runtime for a device. VERIFIED: ORT Web keeps wasmPaths and numThreads in one module-level `env`
 * object, so this module owns that state for every model in the package: a second, different configuration fails
 * instead of silently reconfiguring sessions another model already created. The alternative, one guard per model,
 * cannot see a conflicting setting from the other model.
 */
export type Ort = Pick<typeof import("onnxruntime-web"), "Tensor" | "InferenceSession" | "env">;

export interface OrtWebOptions {
  wasmPaths?: string | undefined;
  numThreads?: number | undefined;
}

let webConfiguration: string | undefined;

/** VERIFIED: Bun 1.4.0 to 1.4.4 report `process.release.name` "node" and load onnxruntime-node (scripts/test-bun-consumer.ts). */
export const loadOrtNode = async (): Promise<Ort> => {
  if (typeof process === "undefined" || process.release?.name !== "node") throw new Error("device: cpu is Node-only; use wasm for browser CPU inference");
  // Runtime-only optional import keeps native .node binaries out of browser bundles.
  const nativeModule = "onnxruntime-node";
  try { return await import(/* @vite-ignore */ /* webpackIgnore: true */ nativeModule); }
  catch (cause) { throw new Error("Native CPU runtime unavailable. Install onnxruntime-node@1.21.0 or select device: wasm.", { cause }); }
};

export const loadOrtWeb = async (options: OrtWebOptions): Promise<Ort> => {
  const web = await import("onnxruntime-web/webgpu");
  const signature = JSON.stringify([options.wasmPaths ?? null, options.numThreads ?? 1]);
  if (webConfiguration !== undefined && webConfiguration !== signature) {
    throw new Error("ORT Web wasmPaths/numThreads are global; use the same configuration for all Winzling and reranker instances");
  }
  webConfiguration = signature;
  web.env.wasm.numThreads = options.numThreads ?? 1;
  web.env.wasm.proxy = false;
  if (options.wasmPaths) web.env.wasm.wasmPaths = typeof location === "undefined"
    ? options.wasmPaths : new URL(options.wasmPaths, location.href).href;
  return web;
};
