import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MOEDERNCOLBERT_MODELS, WINZLING_FILES, WINZLING_MODEL_ID, WINZLING_REVISION } from '../dist/onnx.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

/** Downloads missing or mismatching files of a pinned release; a file is written only after its SHA-256 matches. */
const fetchPinned = async (modelId: string, revision: string, files: Record<string, string>, directory: string) => {
  for (const [file, expected] of Object.entries(files)) {
    const destination = path.join(directory, file);
    let bytes: Buffer | undefined;
    try {
      bytes = await readFile(destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (!bytes || createHash('sha256').update(bytes).digest('hex') !== expected) {
      const response = await fetch(`https://huggingface.co/${modelId}/resolve/${revision}/${file}`);
      if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
      if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error(`${file}: SHA-256 mismatch`);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(`${destination}.partial`, bytes);
      await rename(`${destination}.partial`, destination);
    }
    console.log(`Verified ${modelId}/${file}: ${bytes.length} bytes`);
  }
};

const directory = path.resolve(root, process.argv[2] ?? 'public/models/winzling');
await fetchPinned(WINZLING_MODEL_ID, WINZLING_REVISION, WINZLING_FILES, directory);

// Reranker test assets: the edited 1.5M q8 graph, every original 1.5M precision and the recommended 27M q8 graph.
// VERIFIED: 2.26 MB, 13.66 MB and 27.82 MB of graphs; the live tests and scripts/test-package.ts read them from
// public/models/<repo name>/.
const RERANKER_TEST_GRAPHS = { '1.5m': ['q8'], '1.5m-original': ['fp32', 'fp16', 'q8', 'int8'], '27m': ['q8'] } as const;
for (const [model, precisions] of Object.entries(RERANKER_TEST_GRAPHS)) {
  const profile = MOEDERNCOLBERT_MODELS[model as keyof typeof MOEDERNCOLBERT_MODELS];
  const files = Object.fromEntries(Object.entries(profile.files)
    .filter(([name]) => !name.startsWith('model_') || precisions.some(p => name === `model_${p}.onnx`)));
  await fetchPinned(profile.id, profile.revision, files, path.join(root, 'public/models', profile.id.split('/')[1]!));
}

// Self-host ORT runtime assets too: the demo and browser tests make no CDN requests.
const ort = path.dirname(fileURLToPath(import.meta.resolve('onnxruntime-web')));
const assets = path.join(root, 'public/ort');
await mkdir(assets, { recursive: true });
for (const file of await readdir(ort)) {
  if (/^ort-wasm.*\.(wasm|mjs)$/.test(file)) await copyFile(path.join(ort, file), path.join(assets, file));
}
await mkdir(path.join(root, 'public/fixtures'), { recursive: true });
for (const fixture of ['winzling-reference.json', 'moederncolbert-1.5m-reference.json', 'moederncolbert-1.5m-original-reference.json', 'moederncolbert-27m-reference.json'])
  await copyFile(path.join(root, 'fixtures', fixture), path.join(root, 'public/fixtures', fixture));
console.log(`Ready: ${directory}; ORT assets: ${assets}`);
