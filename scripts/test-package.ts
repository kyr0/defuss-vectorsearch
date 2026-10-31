import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
// Check compatibility with the retained Harrier dependency in the SAME process.
await import('@huggingface/transformers');
const esm = await import('defuss-vectorsearch/onnx.js');
const cjs = createRequire(import.meta.url)('defuss-vectorsearch/onnx.js') as typeof esm;
const loadFile = async (file: string) => new Uint8Array(await readFile(new URL(`../public/models/winzling/${file}`, import.meta.url)));
const outputs: Float32Array[] = [];
for (const module of [esm, cjs]) {
  const embedder = module.createWinzlingEmbedder({ device: 'cpu', loadFile });
  try {
    outputs.push(await embedder.embedQuery('hello'));
  } finally {
    await embedder.dispose();
  }
}
assert.equal(outputs[0]!.length, 384);
assert.deepEqual(outputs[0], outputs[1]);
const colbertDir = new URL(`../public/models/${esm.MOEDERNCOLBERT_MODELS['1.5m'].id.split('/')[1]}/`, import.meta.url);
const ranked: { index: number; score: number }[][] = [];
for (const module of [esm, cjs]) {
  const reranker = module.createColbertReranker({ model: '1.5m', device: 'cpu',
    loadFile: async file => new Uint8Array(await readFile(new URL(file, colbertDir))) });
  try {
    const passages = ['Paris is the capital of France.', 'Die Zugspitze ist 2962 Meter hoch.'];
    ranked.push(await reranker.rerank('Wie hoch ist die Zugspitze?', passages));
    // VERIFIED: a 0.05 lead stays below the default denseMargin (0.1), so the two hits are fused (0.5 and 0.4 passed only by float rounding).
    const fused = await reranker.rerankHits('Wie hoch ist die Zugspitze?', [{ index: 0, score: 0.5 }, { index: 1, score: 0.45 }], passages);
    // VERIFIED: two candidates in opposite orders tie under rank fusion, and ties keep the dense order (fuseRanks unit test).
    assert.deepEqual(fused.map(hit => [hit.index, hit.denseRank]), [[0, 1], [1, 2]]);
    assert.ok(fused[1]!.colbertScore > fused[0]!.colbertScore);
  } finally {
    await reranker.dispose();
  }
}
assert.equal(ranked[0]![0]!.index, 1);
assert.deepEqual(ranked[0], ranked[1]);
for (const entry of ['client.js', 'server.js', 'vector-search.js', 'turboquant.js']) {
  assert.ok(Object.keys(await import(`defuss-vectorsearch/${entry}`)).length);
  assert.ok(Object.keys(createRequire(import.meta.url)(`defuss-vectorsearch/${entry}`)).length);
}
console.log('Built ESM/CJS exports: passed. Native Winzling and MoEdernColBERT inference coexist with Transformers.js.');
