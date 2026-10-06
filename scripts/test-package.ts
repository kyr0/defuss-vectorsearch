import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
// Check compatibility with the retained Harrier dependency in the SAME process.
await import('@huggingface/transformers');
const esm = await import('defuss-embeddings/onnx.js');
const cjs = createRequire(import.meta.url)('defuss-embeddings/onnx.js') as typeof esm;
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
for (const entry of ['client.js', 'server.js', 'vector-search.js', 'turboquant.js']) {
  assert.ok(Object.keys(await import(`defuss-embeddings/${entry}`)).length);
  assert.ok(Object.keys(createRequire(import.meta.url)(`defuss-embeddings/${entry}`)).length);
}
console.log('Built ESM/CJS exports: passed. Native inference coexists with Transformers.js.');
