import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WINZLING_FILES, WINZLING_MODEL_ID, WINZLING_REVISION } from '../dist/onnx.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.resolve(root, process.argv[2] ?? 'public/models/winzling');
for (const [file, expected] of Object.entries(WINZLING_FILES)) {
  const destination = path.join(directory, file);
  let bytes: Buffer | undefined;
  try {
    bytes = await readFile(destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== expected) {
    const response = await fetch(`https://huggingface.co/${WINZLING_MODEL_ID}/resolve/${WINZLING_REVISION}/${file}`);
    if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error(`${file}: SHA-256 mismatch`);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(`${destination}.partial`, bytes);
    await rename(`${destination}.partial`, destination);
  }
  console.log(`Verified ${file}: ${bytes.length} bytes`);
}

// Self-host ORT runtime assets too: the demo and browser tests make no CDN requests.
const ort = path.dirname(fileURLToPath(import.meta.resolve('onnxruntime-web')));
const assets = path.join(root, 'public/ort');
await mkdir(assets, { recursive: true });
for (const file of await readdir(ort)) {
  if (/^ort-wasm.*\.(wasm|mjs)$/.test(file)) await copyFile(path.join(ort, file), path.join(assets, file));
}
await mkdir(path.join(root, 'public/fixtures'), { recursive: true });
await copyFile(path.join(root, 'fixtures/winzling-reference.json'), path.join(root, 'public/fixtures/winzling-reference.json'));
console.log(`Ready: ${directory}; ORT assets: ${assets}`);
