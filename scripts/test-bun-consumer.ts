/**
 * e2e for Bun 1.4.x consumers (part of `make e2e`): packs the package as `bun publish` would, installs the tarball with
 * `bun add` into a clean project under tmp/, and runs scripts/fixtures/bun-consumer/consumer.ts there with Bun on
 * input/rerank-pipeline.json. Covers install (Bun blocks the onnxruntime-node postinstall, which only fetches CUDA), the
 * exports map under Bun's resolver, and Winzling + TurboQuant + `rerankHits` on native CPU and WASM.
 * BUN_VERSION=1.4.0 runs the consumer with that release through `bun x bun@<version>` instead of the installed Bun.
 * VERIFIED: passes with Bun 1.4.0, 1.4.3 and 1.4.4 on macOS arm64 (2026-10-31).
 * Report: output/bun-consumer-<version>.json.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const dir = path.resolve("tmp/bun-consumer");
const bun = (args: string[], cwd = root) => {
  const command = process.env.BUN_VERSION ? ["x", `bun@${process.env.BUN_VERSION}`, ...args] : args;
  return execFileSync("bun", command, { cwd, encoding: "utf8", env: { ...process.env, ONNXRUNTIME_NODE_INSTALL_CUDA: "skip" } });
};

const version = bun(["--version"]).trim();
assert.match(version, /^1\.4\.\d+$/, `this e2e covers Bun 1.4.x, got ${version}`);
await rm(dir, { recursive: true, force: true });
await mkdir(dir, { recursive: true });
bun(["pm", "pack", "--destination", dir]);
const tarball = (await readdir(dir)).find((file) => file.endsWith(".tgz"));
assert.ok(tarball, "bun pm pack wrote no tarball");
await writeFile(path.join(dir, "package.json"), `${JSON.stringify({ name: "bun-consumer", private: true, type: "module" })}\n`);
// onnxruntime-node is an optional peer: an app adds it for device "cpu", at the version the package pins.
bun(["add", `./${tarball}`, "onnxruntime-node@1.21.0"], dir);
await copyFile("scripts/fixtures/bun-consumer/consumer.ts", path.join(dir, "consumer.ts"));
const result = JSON.parse(bun(["consumer.ts", path.resolve("public/models"), path.resolve("input/rerank-pipeline.json")], dir).trim().split("\n").at(-1)!) as {
  bun: string; cpu: number[][]; wasm: number[][]; cjsCpu: number[][];
};
await mkdir("output", { recursive: true });
await writeFile(`output/bun-consumer-${version}.json`, `${JSON.stringify(result, null, 2)}\n`);

assert.equal(result.bun, version);
// q8 and Winzling's graph give the same vectors on both devices, so the fused order must match exactly.
assert.deepEqual(result.wasm, result.cpu, "WASM and native CPU rank alike");
assert.deepEqual(result.cjsCpu, result.cpu, "the CJS entry ranks like the ESM entry");
assert.deepEqual(result.cpu.map((order) => order[0]), [0, 1, 2], "each query's own passage ranks first");
console.log(`${new Date().toISOString()} INFO bun consumer passed bun=${version} top=${JSON.stringify(result.cpu.map((order) => order.slice(0, 2)))}`);
