/**
 * `make docs` step 2 (also run by `make e2e`): bundles examples/search-worker.ts against the built dist/ into ONE file,
 * docs/assets/search-worker.js, so the static page needs no bundler and the package needs no npm release.
 * ONNX Runtime resolves through its `onnxruntime-web-use-extern-wasm` export condition: that build fetches its WASM
 * from `wasmPaths` (jsDelivr, at the installed version) instead of making Vite emit a 26.8 MB .wasm into docs/.
 * VERIFIED: the default condition makes Vite emit ort-wasm-simd-threaded.asyncify.wasm (26,781,914 bytes, see
 * output/browser-bundle.json); with this condition the build emits only search-worker.js, which the assert below enforces.
 * VERIFIED: two consecutive builds are byte-identical (cmp, 2026-10-08), so `make e2e` rebuilding it leaves no diff.
 */
import assert from "node:assert/strict";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { build, defaultClientConditions, type Rollup } from "vite";

const { version } = JSON.parse(await readFile("node_modules/onnxruntime-web/package.json", "utf8")) as { version: string };
const outDir = path.resolve("tmp/docs-worker");
const output = (await build({
  configFile: false,
  logLevel: "warn",
  resolve: {
    conditions: ["onnxruntime-web-use-extern-wasm", ...defaultClientConditions],
    alias: [{ find: "defuss-vectorsearch/browser.js", replacement: path.resolve("dist/browser.mjs") }],
  },
  define: { __ORT_WASM_PATHS__: JSON.stringify(`https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/`) },
  build: {
    outDir, emptyOutDir: true, target: "es2022", modulePreload: false, copyPublicDir: false,
    rollupOptions: {
      input: path.resolve("examples/search-worker.ts"),
      preserveEntrySignatures: false,
      output: { format: "es", entryFileNames: "search-worker.js", inlineDynamicImports: true },
    },
  },
})) as Rollup.RollupOutput;
const files = output.output.map((item) => item.fileName);
assert.deepEqual(files, ["search-worker.js"], `the worker must be one file without assets, got: ${files.join(", ")}`);
await mkdir("docs/assets", { recursive: true });
await copyFile(path.join(outDir, "search-worker.js"), "docs/assets/search-worker.js");
console.error(`${new Date().toISOString()} INFO built docs worker bytes=${Buffer.byteLength(output.output[0]!.type === "chunk" ? output.output[0]!.code : "")} ort=${version}`);
