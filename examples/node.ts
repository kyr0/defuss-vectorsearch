import { readFile } from 'node:fs/promises';
import { createWinzlingEmbedder } from '../dist/onnx.mjs';

const embedder = createWinzlingEmbedder({
  device: process.argv.includes('--cpu') ? 'cpu' : 'wasm',
  loadFile: async (file: string) => new Uint8Array(await readFile(new URL(`../public/models/winzling/${file}`, import.meta.url))),
});
try {
  const documents = ['The cat sleeps on the sofa.', 'Die Katze schläft auf dem Sofa.', 'Build a web application.'];
  const vectors = await embedder.embedDocuments(documents);
  const query = await embedder.embedQuery('A sleeping cat on a couch.');
  console.log(vectors.map((v, i) => ({ text: documents[i], cosine: v.reduce((sum, x, j) => sum + x * query[j]!, 0) }))
    .sort((a, b) => b.cosine - a.cosine));
} finally {
  await embedder.dispose();
}
