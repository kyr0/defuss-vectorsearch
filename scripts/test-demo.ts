import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.resolvedUrls!.local[0]!);
  const webgpu = await page.evaluate(async () => {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return { api: !!gpu, adapter: !!(await gpu?.requestAdapter()) };
  });
  await page.waitForFunction(() => document.querySelector<HTMLElement>('#run')!.onclick !== null);
  await page.getByRole('button', { name: 'Embed and compare' }).click();
  await page.waitForFunction(() => /384 dimensions|failed/i.test(document.querySelector('#status')?.textContent ?? ''), {}, { timeout: 120000 });
  const result = {
    status: await page.locator('#status').textContent(),
    results: await page.locator('#results').textContent(),
    errors, webgpu,
  };
  await mkdir('output', { recursive: true });
  await writeFile('output/browser-worker.json', JSON.stringify(result, null, 2) + '\n');
  await page.screenshot({ path: 'output/browser-worker.png', fullPage: true });
  console.log(result);
  assert.equal(errors.length, 0);
  assert.match(result.status ?? '', /wasm.*384 dimensions/);
  assert.match(result.results ?? '', /Die Katze/);
} finally {
  await browser.close();
  await server.close();
}
