/**
 * `make bench` driver: Node child process per model, then Chromium page per model, then bench.json
 * and the README section. Node runs first because it fills bench/cache, which Chromium loads over HTTP.
 */
import { execFile, spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { chromium } from "playwright";
import { createServer } from "vite";
import { buildBenchTasks, DATASET_SHA256, loadDataset } from "./dataset.ts";
import { cosine, KS, round } from "./metrics.ts";
import { logLine, MODEL_KEYS, type ModelKey } from "./models.ts";
import { BENCH_SCHEMA, renderReadmeSection, replaceReadmeSection, type BenchReport, type PublishedModelResult } from "./report.ts";
import type { ModelResult } from "./runner.ts";

const BROWSER_TIMEOUT_MS = 3 * 60 * 60 * 1000;
const log = (message: string, fields?: Record<string, string>) => console.error(logLine("INFO", message, fields));

const runNode = (key: ModelKey): Promise<ModelResult> =>
  new Promise((resolve, reject) => {
    const out = `bench/node-${key}.json`;
    const child = spawn(process.execPath, ["--expose-gc", "scripts/bench/node.ts", key, out], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) return reject(new Error(`node bench for ${key} exited with ${code}`));
      readFile(out, "utf8").then((json) => resolve(JSON.parse(json) as ModelResult), reject);
    });
  });

/**
 * VERIFIED: CDP heap usage misses the ONNX Runtime WASM memory (backingStorageSize stayed ~6 MB with a
 * 38 MB model loaded), so Chromium reports OS RSS of its renderer processes, like Node's process RSS.
 */
const rendererRss = (pids: number[]): Promise<number> =>
  new Promise((resolve, reject) => {
    execFile("ps", ["-o", "rss=", "-p", pids.join(",")], (error, stdout) => {
      if (error) return reject(error);
      resolve(stdout.trim().split(/\s+/).reduce((sum, kib) => sum + Number(kib) * 1024, 0));
    });
  });

const runChromium = async (origin: string, key: ModelKey): Promise<{ result: ModelResult; version: string }> => {
  // A fresh browser per model keeps the memory probe from seeing the previous model's heap.
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const browserCdp = await browser.newBrowserCDPSession();
    await page.exposeFunction("__benchMemory", async () => {
      await cdp.send("HeapProfiler.collectGarbage");
      const { processInfo } = (await browserCdp.send("SystemInfo.getProcessInfo")) as { processInfo: { type: string; id: number }[] };
      return rendererRss(processInfo.filter((info) => info.type === "renderer").map((info) => info.id));
    });
    await page.exposeFunction("__benchLog", (message: string) => log(message, { env: "chromium", model: key }));
    page.on("pageerror", (error) => console.error(logLine("ERROR", "pageerror", { env: "chromium", model: key, message: JSON.stringify(error.message) })));
    await page.goto(`${origin}/scripts/bench/browser.html?model=${key}`);
    const done = await page.waitForFunction(
      () => (window as unknown as { __benchDone?: unknown }).__benchDone,
      null,
      { timeout: BROWSER_TIMEOUT_MS, polling: 1000 },
    );
    const { result, error } = (await done.jsonValue()) as { result?: ModelResult; error?: string };
    if (!result) throw new Error(`chromium bench for ${key} failed: ${error}`);
    return { result, version: browser.version() };
  } finally {
    await browser.close();
  }
};

const agreement = (a: ModelResult, b: ModelResult) => {
  const cosines = a.sample.map((vector, i) => cosine(vector, b.sample[i]!));
  return {
    samples: cosines.length,
    minCosine: round(Math.min(...cosines), 6),
    meanCosine: round(cosines.reduce((sum, value) => sum + value, 0) / cosines.length, 6),
  };
};

const publish = ({ sample: _sample, ...rest }: ModelResult): PublishedModelResult => rest;

const dataset = await loadDataset(new Uint8Array(await readFile("bench/dataset.json")));
const tasks = buildBenchTasks(dataset);
const nodeResults = {} as Record<ModelKey, ModelResult>;
for (const key of MODEL_KEYS) nodeResults[key] = await runNode(key);

const server = await createServer({ appType: "mpa", server: { host: "127.0.0.1", port: 0 }, logLevel: "warn" });
await server.listen();
const chromiumResults = {} as Record<ModelKey, ModelResult>;
let chromiumVersion = "";
try {
  const origin = server.resolvedUrls!.local[0]!.replace(/\/$/, "");
  for (const key of MODEL_KEYS) {
    const { result, version } = await runChromium(origin, key);
    chromiumResults[key] = result;
    chromiumVersion = version;
  }
} finally {
  await server.close();
}

const map = <T>(fn: (key: ModelKey) => T) => Object.fromEntries(MODEL_KEYS.map((key) => [key, fn(key)])) as Record<ModelKey, T>;
const cpus = os.cpus();
const report: BenchReport = {
  schema: BENCH_SCHEMA,
  generatedAt: new Date().toISOString(),
  host: { cpu: cpus[0]?.model ?? "unknown", cores: cpus.length, platform: `${os.platform()} ${os.arch()}` },
  dataset: {
    name: dataset.name,
    sha256: DATASET_SHA256,
    languages: dataset.languages,
    haystack: tasks.passages.length,
    queries: tasks.queries.length,
  },
  ks: [...KS],
  environments: {
    node: { runtime: process.version, models: map((key) => publish(nodeResults[key])) },
    chromium: { runtime: `${chromiumVersion} headless (Playwright)`, models: map((key) => publish(chromiumResults[key])) },
  },
  crossEnvironment: map((key) => agreement(nodeResults[key], chromiumResults[key])),
};
await writeFile("bench.json", `${JSON.stringify(report, null, 2)}\n`);
await writeFile("README.md", replaceReadmeSection(await readFile("README.md", "utf8"), renderReadmeSection(report)));
log("wrote bench.json and README.md benchmark section");
