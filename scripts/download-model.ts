import { createHash } from 'node:crypto';
import { decompress, init } from 'defuss-brotli/decompressor/slim';
import { mkdir, readFile, writeFile, rename, readdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MOEDERNCOLBERT_MODELS, WINZLING_FILES, WINZLING_MODEL_ID, WINZLING_REVISION } from '../dist/onnx.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const readOptional = async (file: string) => {
  try {
    return await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return undefined;
  }
};
const writeAtomic = async (file: string, bytes: Uint8Array) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.partial`, bytes);
  await rename(`${file}.partial`, file);
};

/**
 * Keeps each file of a pinned release twice, as the package downloads it (`<file>.br`) and decoded: mirror tests
 * serve the `.br` files, `loadFile` tests read the decoded ones. Both are rewritten unless the `.br` decodes to the pin.
 * VERIFIED: `bun run models:download` (2026-11-09) wrote and checked all seven files of both models.
 */
const fetchPinned = async (modelId: string, revision: string, files: Record<string, string>, directory: string) => {
  await init();
  for (const [file, expected] of Object.entries(files)) {
    const destination = path.join(directory, file);
    let compressed = await readOptional(`${destination}.br`);
    let bytes = compressed && decompress(compressed);
    if (!compressed || !bytes || sha256(bytes) !== expected) {
      const response = await fetch(`https://huggingface.co/${modelId}/resolve/${revision}/${file}.br`);
      if (!response.ok) throw new Error(`${file}.br: HTTP ${response.status}`);
      compressed = Buffer.from(await response.arrayBuffer());
      bytes = decompress(compressed);
      if (sha256(bytes) !== expected) throw new Error(`${file}.br: decoded SHA-256 mismatch`);
      await writeAtomic(`${destination}.br`, compressed);
    }
    if (sha256(await readOptional(destination) ?? new Uint8Array()) !== expected) await writeAtomic(destination, bytes);
    console.log(`Verified ${modelId}/${file}: ${compressed.length} bytes as .br, ${bytes.length} decoded`);
  }
};

const directory = path.resolve(root, process.argv[2] ?? 'public/models/winzling');
await fetchPinned(WINZLING_MODEL_ID, WINZLING_REVISION, WINZLING_FILES, directory);

// The reranker; the live tests and scripts/test-package.ts read it from public/models/<repo name>/.
for (const profile of Object.values(MOEDERNCOLBERT_MODELS)) {
  await fetchPinned(profile.id, profile.revision, profile.files, path.join(root, 'public/models', profile.id.split('/')[1]!));
}

// Self-host ORT runtime assets too: the demo and browser tests make no CDN requests.
const ort = path.dirname(fileURLToPath(import.meta.resolve('onnxruntime-web')));
const assets = path.join(root, 'public/ort');
await mkdir(assets, { recursive: true });
for (const file of await readdir(ort)) {
  if (/^ort-wasm.*\.(wasm|mjs)$/.test(file)) await copyFile(path.join(ort, file), path.join(assets, file));
}
await mkdir(path.join(root, 'public/fixtures'), { recursive: true });
for (const fixture of ['winzling-reference.json', 'moederncolbert-1.5m-reference.json'])
  await copyFile(path.join(root, 'fixtures', fixture), path.join(root, 'public/fixtures', fixture));
console.log(`Ready: ${directory}; ORT assets: ${assets}`);
