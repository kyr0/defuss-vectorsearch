/**
 * e2e for the browser bundles, built with Vite against dist/ like a consumer app:
 * 1. `browser.js` (fixtures/browser-bundle): fails if the bundle contains Node, Transformers.js or multicore code,
 *    runs it in Chromium twice and checks that the second load serves the model from the browser cache.
 * 2. `client.js` under top-level await (fixtures/isomorphic-tla): must finish. VERIFIED: restoring a
 *    lazy import of a browser-path module makes this fixture time out (mutation run).
 * Report: output/browser-bundle.json.
 */
import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { build, createLogger, type Rollup } from "vite";

const FORBIDDEN = [/@huggingface\/transformers/, /defuss-multicore/, /onnxruntime-node/, /model-cache\.node/, /^node:/, /__vite-browser-external/];
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".json": "application/json" };
const modelDir = path.resolve("public/models/winzling");

const buildFixture = async (fixture: string, entry: string) => {
  const warnings: string[] = [];
  const logger = createLogger("warn");
  logger.warn = (message) => { warnings.push(message); };
  const outDir = path.resolve(`tmp/${fixture}`);
  const output = (await build({
    root: path.resolve(`scripts/fixtures/${fixture}`),
    configFile: false,
    logLevel: "warn",
    customLogger: logger,
    resolve: { alias: [{ find: `defuss-vectorsearch/${entry}.js`, replacement: path.resolve(`dist/${entry}.mjs`) }] },
    build: { outDir, emptyOutDir: true, target: "es2022" },
  })) as Rollup.RollupOutput;
  const chunks = output.output.filter((item): item is Rollup.OutputChunk => item.type === "chunk");
  const assets = output.output.filter((item): item is Rollup.OutputAsset => item.type === "asset");
  return { outDir, warnings, chunks, assets, modules: chunks.flatMap((chunk) => Object.keys(chunk.modules)) };
};

/** Serves one built app at / and the local Winzling mirror at /models/winzling/. */
const serve = async (outDir: string) => {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const file = url.pathname.startsWith("/models/winzling/")
      ? path.join(modelDir, url.pathname.slice("/models/winzling/".length))
      : path.join(outDir, url.pathname === "/" ? "index.html" : url.pathname);
    const insideRoot = file.startsWith(modelDir + path.sep) || file.startsWith(outDir + path.sep);
    if (!insideRoot || !(await stat(file).then((s) => s.isFile(), () => false))) return void response.writeHead(404).end();
    response.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
};

const watch = (page: Page) => {
  const problems: string[] = [];
  const modelRequests: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") problems.push(`console: ${message.text()}`); });
  page.on("requestfailed", (request) => problems.push(`requestfailed: ${request.url()}`));
  page.on("response", (response) => { if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.url()}`); });
  page.on("request", (request) => { if (request.url().includes("/models/winzling/")) modelRequests.push(request.url()); });
  return { problems, modelRequests };
};

const readResult = async <T>(page: Page, url: string, problems: string[]): Promise<T> => {
  await page.goto(url);
  await page
    .waitForFunction(() => document.querySelector("#result")?.textContent !== "loading", null, { timeout: 60_000 })
    .catch((error: unknown) => { throw new Error(`page never finished; observed: ${JSON.stringify(problems)}`, { cause: error }); });
  const text = (await page.locator("#result").textContent()) ?? "";
  assert.ok(!text.startsWith("failed"), text);
  return JSON.parse(text) as T;
};

const bundle = await buildFixture("browser-bundle", "browser");
const offending = bundle.modules.filter((id) => FORBIDDEN.some((pattern) => pattern.test(id.replace(/\\/g, "/"))));
assert.deepEqual(offending, [], `browser bundle must not contain: ${offending.join(", ")}`);
assert.deepEqual(bundle.warnings.filter((w) => /externalized for browser compatibility/.test(w)), [], "no Node built-in may be externalized");
const wasm = bundle.assets.filter((asset) => asset.fileName.endsWith(".wasm"));
assert.ok(wasm.length > 0, "Vite must emit the ONNX Runtime Web WASM next to the bundle");
const jsBytes = bundle.chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk.code), 0);
const isomorphic = await buildFixture("isomorphic-tla", "client");

const browser = await chromium.launch({ headless: true });
const servers: { close(): void }[] = [];
try {
  const bundleServer = await serve(bundle.outDir);
  servers.push(bundleServer);
  const page = await (await browser.newContext()).newPage();
  const { problems, modelRequests } = watch(page);
  const url = `${bundleServer.origin}/?mirror=/models/winzling`;
  const first = await readResult<{ top: string[] }>(page, url, problems);
  const firstLoadRequests = modelRequests.length;
  const second = await readResult<{ top: string[] }>(page, url, problems);
  const secondLoadRequests = modelRequests.length - firstLoadRequests;

  const isoServer = await serve(isomorphic.outDir);
  servers.push(isoServer);
  const isoPage = await (await browser.newContext()).newPage();
  const iso = watch(isoPage);
  const isoResult = await readResult<{ dims: number }>(isoPage, `${isoServer.origin}/?mirror=/models/winzling`, iso.problems);

  const report = {
    browserEntry: {
      jsBytes,
      wasm: wasm.map((asset) => ({ file: asset.fileName, bytes: (asset.source as Uint8Array).byteLength })),
      moduleCount: bundle.modules.length,
      firstLoadModelRequests: firstLoadRequests,
      secondLoadModelRequests: secondLoadRequests,
      top: first.top,
      problems,
    },
    isomorphicTopLevelAwait: { dims: isoResult.dims, problems: iso.problems },
  };
  await mkdir("output", { recursive: true });
  await writeFile("output/browser-bundle.json", `${JSON.stringify(report, null, 2)}\n`);
  assert.deepEqual(problems, []);
  assert.deepEqual(iso.problems, []);
  assert.deepEqual(first.top.slice().sort(), ["The cat sleeps on the sofa.", "Кошка спит на диване."].sort());
  assert.deepEqual(second.top, first.top);
  assert.equal(firstLoadRequests, 3, "first load fetches tokenizer.json, tokenizer_config.json and the ONNX graph");
  assert.equal(secondLoadRequests, 0, "second load must come from the Cache API / IndexedDB");
  assert.equal(isoResult.dims, 384);
  console.log(`${new Date().toISOString()} INFO browser bundles passed js_bytes=${jsBytes} model_requests=${firstLoadRequests}/${secondLoadRequests} isomorphic_tla=ok`);
} finally {
  await browser.close();
  for (const server of servers) server.close();
}
