// A Bun app that installed the packed tarball: dense search, then MoEdernColBERT fused with the hits, on native CPU and
// WASM, through the ESM and the CJS entry. Prints one JSON line for scripts/test-bun-consumer.ts.
// VERIFIED: identical rankings on CPU, WASM and CJS with Bun 1.4.0, 1.4.3 and 1.4.4 (2026-10-31).
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createColbertReranker, createWinzlingEmbedder } from "defuss-vectorsearch/onnx.js";
import { buildTurboQuantIndex, searchTurboQuantIndex } from "defuss-vectorsearch/turboquant.js";

const [modelsDir, inputFile] = process.argv.slice(2);
const input = JSON.parse(await readFile(inputFile!, "utf8")) as { documents: string[]; queries: string[] };
const cjs = createRequire(import.meta.url)("defuss-vectorsearch/onnx.js") as typeof import("defuss-vectorsearch/onnx.js");
const fromDir = (dir: string) => async (file: string) => new Uint8Array(await readFile(`${modelsDir}/${dir}/${file}`));

const run = async (entry: typeof cjs, device: "cpu" | "wasm") => {
  const embedder = entry.createWinzlingEmbedder({ device, loadFile: fromDir("winzling") });
  const reranker = entry.createColbertReranker({ model: "1.5m", device, loadFile: fromDir("SauerkrautLM-MoEdernColBERT-1.5M-ONNX") });
  try {
    const index = buildTurboQuantIndex(await embedder.embedDocuments(input.documents));
    const ranked: number[][] = [];
    for (const query of input.queries) {
      const hits = searchTurboQuantIndex(index, await embedder.embedQuery(query), input.documents.length);
      ranked.push((await reranker.rerankHits(query, hits, input.documents)).map((hit) => hit.index));
    }
    return ranked;
  } finally {
    await embedder.dispose();
    await reranker.dispose();
  }
};

const esm = { createWinzlingEmbedder, createColbertReranker } as typeof cjs;
console.log(JSON.stringify({
  bun: process.versions.bun,
  cpu: await run(esm, "cpu"),
  wasm: await run(esm, "wasm"),
  cjsCpu: await run(cjs, "cpu"),
}));
