/** `node scripts/bench/verify-dataset.ts <file>`. VERIFIED: exits non-zero unless the file is the pinned, valid dataset. (make download-bench) */
import { readFile } from "node:fs/promises";
import { loadDataset } from "./dataset.ts";

const file = process.argv[2];
if (!file) throw new Error("usage: node scripts/bench/verify-dataset.ts <dataset.json>");
const dataset = await loadDataset(new Uint8Array(await readFile(file)));
console.error(`${new Date().toISOString()} INFO verified dataset name=${dataset.name} languages=${dataset.languages.length}`);
