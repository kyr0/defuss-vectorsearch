/**
 * e2e for the static demo in docs/ (part of `make e2e`): serves docs/ as GitHub Pages would and drives it in Chromium.
 * The pinned models (huggingface.co) and ONNX Runtime's WASM (jsDelivr) are answered from the local mirrors that
 * `make setup` fills (public/models/winzling, public/models/<reranker repo>, node_modules/onnxruntime-web/dist), byte-identical to the remote files,
 * so the run is fast and deterministic; defuss-shadcn still comes from its CDN.
 * VERIFIED: the model mirror is hash-checked against the pinned SHA-256s (download-model.ts, then the worker); the ORT
 * files are the installed onnxruntime-web, the same npm version the worker requests from jsDelivr.
 * Alternative rejected: fetching 40 MB from Hugging Face and 27 MB from jsDelivr on every CI run.
 * Covers every section and component: header + sheet + links, the search CTA, boot (bars, ring, stats, log), the Search
 * button, palette (filter, pick by Enter and by click, actions) with a steady scroll position, live search with
 * re-ranking, gold badges, theme swap, backend switch, all three model modes (reranker alone by default, embedder
 * alone, both), the recall card's mode and R@k tabs, cached reload, both copy buttons, mobile width, reduced motion.
 * Fails on any page error, console error, failed request or HTTP >= 400.
 * Report: output/docs-demo.json + screenshots.
 */
import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { brotliDecompressSync, createGzip } from "node:zlib";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { MOEDERNCOLBERT_MODELS, WINZLING_PROFILE, WINZLING_REVISION } from "../dist/shared.mjs";
import { DATASET_SHA256, TARGET_LANGUAGES } from "./bench/dataset.ts";
import { decodeDemoIndex } from "./docs/index-format.ts";

const DOCS = path.resolve("docs");
const TYPES: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm",
};
const RERANKER = MOEDERNCOLBERT_MODELS["1.5m"];
const RERANKER_DIR = path.resolve(`public/models/${RERANKER.id.split("/")[1]}`);
const MIRRORS = [
  { prefix: `https://huggingface.co/kyr0/Winzling-Embed-a8m-64k/resolve/${WINZLING_REVISION}/`, dir: path.resolve("public/models/winzling") },
  { prefix: `https://huggingface.co/${RERANKER.id}/resolve/${RERANKER.revision}/`, dir: RERANKER_DIR },
  { prefix: "https://cdn.jsdelivr.net/npm/onnxruntime-web@", dir: path.resolve("node_modules/onnxruntime-web/dist"), strip: /^[^/]+\/dist\// },
];

/** Paths the docs server answered, to see which static files the page and its worker fetch. */
const served: string[] = [];
const server = createServer(async (request, response) => {
  served.push(new URL(request.url ?? "/", "http://x").pathname);
  const file = path.join(DOCS, decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname).replace(/\/$/, "/index.html"));
  if (!file.startsWith(DOCS + path.sep) || !(await stat(file).then((s) => s.isFile(), () => false))) return void response.writeHead(404).end();
  // Like GitHub Pages: JSON goes out gzipped when the browser accepts it, so progress and transfer sizes face compression.
  if (path.extname(file) === ".json" && /gzip/.test(String(request.headers["accept-encoding"]))) {
    response.writeHead(200, { "Content-Type": TYPES[".json"]!, "Content-Encoding": "gzip" });
    return void createReadStream(file).pipe(createGzip()).pipe(response);
  }
  response.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(response);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const modelRequests: string[] = [];
const rerankerRequests: string[] = [];
const problems: string[] = [];
const prepare = async (context: BrowserContext) => {
  for (const mirror of MIRRORS) {
    await context.route(`${mirror.prefix}**`, async (route) => {
      const rest = route.request().url().slice(mirror.prefix.length).replace(mirror.strip ?? /^/, "");
      if (mirror.dir.endsWith("winzling")) modelRequests.push(rest);
      if (mirror.dir === RERANKER_DIR) rerankerRequests.push(rest);
      await route.fulfill({ path: path.join(mirror.dir, rest), contentType: TYPES[path.extname(rest)] ?? "application/octet-stream" });
    });
  }
};
const watch = (page: Page, label: string) => {
  page.on("pageerror", (error) => problems.push(`${label} pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") problems.push(`${label} console: ${message.text()}`); });
  page.on("requestfailed", (request) => problems.push(`${label} requestfailed: ${request.url()} ${request.failure()?.errorText}`));
  page.on("response", (response) => { if (response.status() >= 400) problems.push(`${label} HTTP ${response.status()}: ${response.url()}`); });
  return page;
};
const ready = (page: Page) => page.waitForFunction(() => (document.querySelector("#boot-status")?.textContent ?? "").startsWith("Ready in"), null, { timeout: 120_000 });
const scrollY = (page: Page) => page.evaluate(() => window.scrollY);
/** What sighted readers see: the text without screen-reader-only parts like "(opens in a new tab)". */
const visibleText = (page: Page, selector: string) => page.$eval(selector, (node) => {
  const copy = node.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll(".sr-only")) hidden.remove();
  return copy.textContent ?? "";
});
const summaryFor = (page: Page, query: string) =>
  page.waitForFunction((q) => document.querySelector<HTMLElement>("#summary")?.dataset.query === q && !document.querySelector("#results")!.hasAttribute("aria-busy"), query, { timeout: 30_000 });
const hits = (page: Page) => page.$$eval("#results .vs-hit", (items) => items.map((item) => ({
  id: item.id, gold: item.getAttribute("data-gold"), score: Number(item.querySelector(".vs-score")?.textContent),
  group: Number(/passage (\d+)/.exec(item.querySelector(".card-description")?.textContent ?? "")?.[1]),
})));
/**
 * Fused cards keep their dense score and carry a move badge when fusion moved them: "↑2" on card 1 means TurboQuant had
 * it at #3. VERIFIED: reading the dense position back from every card shows the badges describe distinct dense positions.
 */
const assertMoves = async (page: Page, list: string) => {
  const cards = await page.$$eval(`${list} .vs-hit`, (items) => items.map((item) => ({
    badge: item.querySelector(".vs-moved [aria-hidden]")?.textContent ?? "", title: item.querySelector(".vs-moved")?.getAttribute("title") ?? "",
  })));
  const denseRanks = cards.map(({ badge, title }, i) => {
    if (!badge) { assert.equal(title, ""); return i + 1; }
    const match = /^([↑↓])(\d+)$/.exec(badge);
    assert.ok(match, `badge ${badge}`);
    const dense = i + 1 + (match[1] === "↑" ? 1 : -1) * Number(match[2]);
    assert.equal(title, `Reranked from #${dense}`);
    return dense;
  });
  assert.equal(new Set(denseRanks).size, denseRanks.length, `dense positions ${denseRanks}`);
};
/** VERIFIED: ⌘K opens the palette natively but its State API keeps reporting "default" (defuss-shadcn 0.9.7), so read `open`. */
const paletteOpen = (page: Page) => page.$eval("#cmd", (dialog) => (dialog as HTMLDialogElement).open);
const stateOf = (page: Page, selector: string) => page.$eval(selector, (node) => (node as HTMLElement & { api: { getState(): { name: string } } }).api.getState().name);

const manifest = JSON.parse(await readFile("docs/data/manifest.json", "utf8"));
const unpack = async (file: string) => new Uint8Array(brotliDecompressSync(await readFile(`docs/data/${file}`)));
const demo = decodeDemoIndex(JSON.parse(new TextDecoder().decode(await unpack(manifest.documents.file))), await unpack(manifest.vectors.file));
const firstQuery = (code: string) => demo.queries.find((query) => demo.languages[query.language] === code)!.text;
const benchReport = JSON.parse(await readFile("bench.json", "utf8"));
const bench = benchReport.environments.chromium.models.winzling;
/** The reranker alone over all passages in Chromium (scripts/bench/runner.ts runRerankerBench). */
const benchReranker = benchReport.environments.chromium.reranker;
const report: Record<string, unknown> = {};
const browser = await chromium.launch({ headless: true });
try {
  // Freshness: the committed index must match the pinned dataset and model.
  assert.equal(demo.dataset.sha256, DATASET_SHA256, "docs/data is stale: run `make docs`");
  assert.equal(demo.model.revision, WINZLING_REVISION, "docs/data is stale: run `make docs`");

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  await prepare(context);
  const page = watch(await context.newPage(), "desktop");
  await page.goto(`${origin}/`);

  // On load: the index and its 1,000 example queries arrive by themselves, the model does not; a CTA invites a search.
  await page.waitForFunction(() => document.querySelectorAll("#cmd .command-item[data-query]").length === 1000);
  await page.waitForFunction(() => /not cached yet/.test(document.querySelector("#log")!.textContent ?? ""));
  assert.equal(await stateOf(page, "#p-index"), "complete", "progress counts the Brotli bytes against the manifest sizes");
  // One set of figures everywhere: the index hint shows the manifest's raw and Brotli sizes (412 kB = the vector index).
  const kb = (bytes: number) => `${Math.round(bytes / 1e3)} kB`;
  const mb = (bytes: number) => `${(bytes / 1e6).toFixed(2)} MB`;
  assert.equal(await page.textContent("#p-index-hint"),
    `vector index ${mb(manifest.vectors.rawBytes)} -> ${kb(manifest.vectors.bytes)} Brotli · passage text ${mb(manifest.documents.rawBytes)} -> ${kb(manifest.documents.bytes)} Brotli`);
  assert.equal(await page.textContent('output[for="p-index"]'), `100% of ${kb(manifest.vectors.bytes + manifest.documents.bytes)} (Brotli)`);
  // The RAM hint follows the mode: the reranker alone (model + token vectors), the embedder with TurboQuant, or both fused.
  const ramMb = (mib: number) => Math.round(mib * 1.048576); // MiB -> MB: the page uses decimal units only
  const ram = { reranker: ramMb(benchReranker.maxsim.runtimeMiB), embedder: ramMb(bench.strategies.turboquant.runtimeMiB), both: ramMb(bench.strategies.fused.runtimeMiB) };
  assert.match(await page.textContent("#p-runtime-hint") ?? "", new RegExp(`^~${ram.reranker} MB RAM reserved for the model`));
  // The default mode is the reranker alone (human decision, 2026-11-09): one 2.28 MB model that encodes the passages itself.
  const sizes = (files: object) => (Object.values(files) as { bytes: number }[]).reduce((a, b) => a + b.bytes, 0);
  // The reranker alone also downloads the passages' prebuilt token vectors (docs/data/tokens.bin.br).
  const downloads = { reranker: sizes(manifest.rerankerFiles) + manifest.tokens.bytes, embedder: sizes(manifest.modelFiles), both: sizes(manifest.rerankerFiles) + sizes(manifest.modelFiles) };
  const label = (bytes: number) => `${(bytes / 1e6).toFixed(bytes >= 1e7 ? 1 : 2)} MB`;
  // The modes are icon tabs (human decision, 2026-11-09), each naming its models and download.
  const modeTabs = () => page.$$eval("#mode-tabs [role=tab]", (tabs) => tabs.map((tab) => [tab.textContent, tab.getAttribute("aria-selected"), !!tab.querySelector(".vs-tab-icon")]));
  // Each tab's "Quality" bar is its R@10 over the target languages in Chromium (bench.json), as the recall card's average.
  const targetR10 = (byLanguage: Record<string, Record<string, number>>) => Number((TARGET_LANGUAGES.reduce((sum, code) => sum + byLanguage[code]!["@10"]!, 0) / TARGET_LANGUAGES.length).toFixed(1));
  const quality = { reranker: targetR10(benchReranker.maxsim.recall.byLanguage), embedder: targetR10(bench.strategies.turboquant.recall.byLanguage), both: targetR10(bench.strategies.fused.recall.byLanguage) };
  assert.deepEqual(await modeTabs(), [
    [`kyr0/Winzling-rerankerReranker only · ${label(downloads.reranker)}Quality${quality.reranker}%`, "true", true],
    [`kyr0/Winzling-embedEmbedder only · ${label(downloads.embedder)}Quality${quality.embedder}%`, "false", true],
    [`FusedEmbedder + reranker · ${label(downloads.both)}Quality${quality.both}%`, "false", true],
  ]);
  assert.deepEqual(await page.$$eval("#mode-tabs .vs-mode-quality progress", (bars) => bars.map((bar) => Number(bar.getAttribute("value")))), [quality.reranker, quality.embedder, quality.both]);
  assert.match(await page.textContent("#mode-panel-reranker") ?? "", /token vectors, prebuilt with the index/);
  // Each mode names its models with their Hugging Face pages (human request, 2026-11-09).
  for (const [panel, count] of [["reranker", 1], ["embedder", 1], ["both", 2]] as const) {
    assert.equal(await page.locator(`#mode-panel-${panel} a[href^="https://huggingface.co/kyr0/"]`).count(), count, `${panel} model links`);
  }
  assert.equal(await page.textContent("#boot-start"), `Load the model · ${label(downloads.reranker)}`);
  // Statuses are toasts (human request, 2026-11-09): nothing renders above the mode tabs.
  assert.ok(await page.locator("#boot-status").isHidden());
  assert.equal(await page.textContent("#p-model-name"), "Model · kyr0/Winzling-reranker q8");
  assert.ok(await page.locator("#p-tokens-field").isVisible(), "the reranker alone shows its token-vector bar");
  assert.ok(await page.locator("#backend").isDisabled(), "the reranker always runs on WASM");
  // No stray figure: no 40 MB rounding and no MiB anywhere visible; the download figures are checked below.
  const bodyText = (await page.evaluate(() => document.body.innerText)).replace(/\u00a0/g, " ");
  assert.doesNotMatch(bodyText, /(?<![\d.])40 MB|MiB/, "a 40 MB or MiB figure is left");
  assert.equal(await page.textContent('[data-stat="languages"]'), "documents · 20 languages");
  // Section labels are badges (human decision, 2026-11-09), not plain-text eyebrows.
  assert.equal(await page.locator(".mk-section-header-eyebrow, .mk-features-eyebrow").count(), 0, "plain-text section eyebrow left");
  assert.deepEqual(await page.$$eval(".mk-section-header-copy > .badge, .mk-features-head > .badge", (nodes) => nodes.map((node) => node.textContent)), ["Live demo", "How it works", "Use it"]);
  assert.equal(await page.textContent(".statistic:has([data-stat=passages]) .statistic-title"), "Vector Database Index");
  assert.equal(modelRequests.length + rerankerRequests.length, 0, "the models must not download before the user asks");
  assert.ok(await page.locator("#empty").isVisible(), "the search CTA shows first");
  assert.equal(await page.locator("#results .vs-hit").count(), 0, "no skeletons before a search");
  assert.equal(await page.locator("#empty-examples [data-query]").count(), 3);
  // The hero's "Try it now!" only jumps to the demo: it never starts the download.
  assert.deepEqual(await page.$$eval(".mk-hero-actions .btn", (nodes) => nodes.map((node) => node.textContent?.trim())), ["Try it now!", "Benchmark results"]);
  await page.click("#try-live");
  await page.waitForTimeout(300);
  assert.equal(modelRequests.length + rerankerRequests.length, 0, "Try it now does not download the models");
  assert.deepEqual(await page.$$eval("#demo-tabs .vs-tab-title", (nodes) => nodes.map((node) => node.textContent)), ["Benchmark data", "My data (custom)"]);
  await page.click("#empty [data-command-trigger]");
  assert.ok(await paletteOpen(page), "the CTA opens the palette");
  await page.keyboard.press("Escape");

  // The hero's neural shader (human request, 2026-11-09): defuss-shadcn's neuro-noise in the page's dark blues over a
  // near-transparent background (2% alpha: the shader reads colours from one canvas pixel, so 0% would lose the page
  // colour and mix toward black), bottom left, without a poster; it draws a frame, or stays empty without WebGL2.
  await page.waitForFunction(() => { const node = document.querySelector(".vs-hero-shader"); return !!node && (node.hasAttribute("data-ready") || node.hasAttribute("data-fallback")); });
  assert.deepEqual(await page.$eval(".vs-hero-shader", (node) => [node.getAttribute("data-effect"), node.getAttribute("data-colors"), node.getAttribute("data-background")]),
    ["neuro-noise", "var(--chart-5) var(--chart-4) var(--chart-2)", "rgb(from var(--background) r g b / .02)"]);
  const shaderBox = await page.$eval(".vs-hero-shader", (node) => { const box = node.getBoundingClientRect(); const hero = node.closest(".mk-hero")!.getBoundingClientRect(); return { left: box.left - hero.left, bottom: box.bottom - hero.bottom, center: box.left + box.width / 2 - (hero.left + hero.width / 2) }; });
  assert.ok(shaderBox.center < 0 && shaderBox.bottom >= 0, `shader at the hero's bottom left: ${JSON.stringify(shaderBox)}`);
  // Headline copy is the author's to change; the page keeps one h1 that names the topic.
  assert.equal(await page.locator("h1").count(), 1);
  assert.match(await page.textContent("h1") ?? "", /^Semantic search\b/);
  // Links: the model page opens in a new tab; the hero and footer credit the author and the dataset.
  assert.equal(await page.getAttribute('.mk-header a[href="https://huggingface.co/kyr0/Winzling-Embed-a8m-64k"]', "target"), "_blank");
  assert.match(await visibleText(page, ".mk-hero-note"), /implemented by Aron Homberg \(kyr0\) - Open Source \(MIT\)Models: kyr0\/Winzling-embed · kyr0\/Winzling-reranker$/);
  assert.equal(await page.locator(`.mk-hero-note a[href="https://huggingface.co/${RERANKER.id}"]`).count(), 1, "the hero links both models");
  assert.equal(await page.locator('.mk-hero-note a[href="https://www.linkedin.com/in/aronhomberg/"]').count(), 1);
  assert.equal(await page.locator('.mk-footer-copy a[href="https://www.linkedin.com/in/aronhomberg/"]').count(), 1);
  assert.equal(await page.locator('.mk-footer-copy a[href$="/datasets/tiny-embedding-bench-v1"]').count(), 1);
  assert.equal(await page.locator('.mk-footer-nav a[href="https://huggingface.co/hotchpotch/bekko-embedding-v1-a8m"]').count(), 1);
  // Footer links (human requests, 2026-11-09): the defuss projects' own sites, and both models under their page names.
  const footerLink = (href: string) => visibleText(page, `.mk-footer-nav a[href="${href}"]`);
  assert.equal(await footerLink("https://vae.defuss.org"), "defuss-vae");
  assert.equal(await footerLink("https://shadcn.defuss.org"), "defuss-shadcn");
  assert.equal(await footerLink("https://huggingface.co/kyr0/Winzling-Embed-a8m-64k"), "Winzling-embed");
  assert.equal(await footerLink("https://huggingface.co/kyr0/winzling-embed-SauerkrautLM-MoEdernColBERT-1.5M-weight-space-programming"), "Winzling-reranker");
  assert.equal(await page.locator('.vs-ad a[href="https://www.linkedin.com/in/aronhomberg/"]').count(), 1);
  assert.equal(await page.locator('#consulting a[href="https://www.linkedin.com/in/aronhomberg/"]').count(), 1);
  // Consulting CTA: portrait and heading share one row; the text sits to their right, in its own column.
  await page.locator("#consulting").scrollIntoViewIfNeeded();
  const cta = await page.$eval("#consulting", (node) => {
    const box = (q: string) => node.querySelector(q)!.getBoundingClientRect();
    return { portrait: box(".vs-cta-portrait"), title: box(".mk-cta-title"), desc: box(".mk-cta-desc") };
  });
  assert.ok(cta.title.left > cta.portrait.right && cta.title.top < cta.portrait.bottom, "portrait beside the heading");
  assert.ok(cta.desc.left >= cta.title.right - 1, "text in its own column right of the heading");
  for (const photo of [".vs-ad img", "#consulting img"]) {
    await page.locator(photo).scrollIntoViewIfNeeded();
    await page.waitForFunction((selector) => document.querySelector<HTMLImageElement>(selector)!.naturalWidth === 400, photo);
  }
  assert.equal(await page.locator(".vs-ad p").count(), 2, "the ad keeps name and role, without the extra line");

  // The hero intro's figures follow bench.json: R@5 of the three best languages (bruteforce) and the index size ratio.
  const node = JSON.parse(await readFile("bench.json", "utf8")).environments.node.models.winzling.strategies;
  const intro = `${await visibleText(page, ".mk-hero-desc")} ${await visibleText(page, "#intro")}`.replace(/\u00a0/g, " ");
  // The hero's R@25 figures are the recall card's: Fused (its default tab) and the reranker alone, the target
  // languages' mean (human request, 2026-11-09); the flip line below carries them.
  const targetR25 = (byLanguage: Record<string, Record<string, number>>) => TARGET_LANGUAGES.reduce((sum, code) => sum + byLanguage[code]!["@25"]!, 0) / TARGET_LANGUAGES.length;
  const [fusedR25, rerankerR25] = [targetR25(bench.strategies.fused.recall.byLanguage), targetR25(benchReranker.maxsim.recall.byLanguage)];
  assert.equal(Number(await page.getAttribute("#recall-panel-both-25 [data-recall-average] progress", "value")), Number(fusedR25.toFixed(1)));
  assert.ok(intro.includes(`${demo.index.codeBytes} bytes`), "bytes per document = TurboQuant code bytes");
  assert.ok(intro.includes(`${WINZLING_PROFILE.maxTokens.toLocaleString("en")} tokens`), "context = the profile's maxTokens");
  assert.equal(await page.locator("#intro .vs-intro-icon svg").count(), 6);
  // Six titled blocks; their wording is the author's, their figures are checked below.
  assert.equal((await page.$$eval("#intro h3", (nodes) => nodes.map((node) => node.textContent?.trim()).filter(Boolean))).length, 6);
  assert.ok(intro.includes(`< ${100} ms to the first results`) && bench.strategies.turboquant.queryMs.p95 < 100, "first results: p95 under 100 ms");
  assert.ok(intro.includes(`about ${Math.round(node.turboquant.runtimeMiB * 1.048576)} MB RAM in Node.js`), `Node.js RAM ${node.turboquant.runtimeMiB} MiB`);
  assert.ok(intro.includes(`adds ~${Math.round(bench.strategies.fused.searchMs.p50)} ms in the browser`), `rerank p50 ${bench.strategies.fused.searchMs.p50}`);
  assert.equal(await page.locator('#intro a[href="https://www.linkedin.com/in/aronhomberg/"]').count(), 1);
  // The flip line's figures come from the data: model files (manifest), index bytes, bench R@5 and p95 latency.
  const flips = (await page.$$eval(".vs-flip .text-rotate > span > span", (nodes) => nodes.map((node) => node.textContent))).map((text) => text?.replace(/\u00a0/g, " "));
  // Download figures: the `.br` bytes the worker fetches (manifest `bytes`), unpacked sizes only where the page says so.
  const sum = (files: object, key: "bytes" | "rawBytes") => (Object.values(files) as Record<typeof key, number>[]).reduce((a, b) => a + b[key], 0) / 1e6;
  const [downloadMb, rerankerMb] = [sum(manifest.modelFiles, "bytes"), sum(manifest.rerankerFiles, "bytes")];
  // The hero's title and text are the author's (human request, 2026-11-09); the figures sit in the flip line.
  assert.equal(await page.textContent(".mk-hero-title"), "Semantic search is now tiny, fast, and open source");
  // Bun is a tested runtime (scripts/test-bun-consumer.ts in make e2e), so the hero names it (human request, 2026-11-09).
  assert.ok(flips.includes("in your browser, Node.js and Bun"), flips.join(" | "));
  assert.ok((await page.textContent(".mk-hero-desc") ?? "").startsWith("The Winzling embedding model family"));
  assert.equal(await page.locator('.mk-hero-actions a[href="#bench"] use[href="#i-chart"]').count(), 1, "the benchmark button has its chart icon");
  assert.ok(!/\d(\.\d+)?\s*(MB|ms|%)/.test(await page.textContent(".mk-hero-desc") ?? ""), "the hero text carries no figures to keep in sync");
  // "Pareto-optimal quality": the recall card's Chromium figures over the target languages, short, without the
  // downloads the hero already names (human request, 2026-11-09).
  const targetAt = (byLanguage: Record<string, Record<string, number>>, k: number) => (TARGET_LANGUAGES.reduce((sum, code) => sum + byLanguage[code]![`@${k}`]!, 0) / TARGET_LANGUAGES.length).toFixed(1);
  for (const claim of [
    `the right passage is in the top 25 for ${targetAt(bench.strategies.turboquant.recall.byLanguage, 25)}% of queries, and in the top 5 for ${targetAt(bench.strategies.fused.recall.byLanguage, 5)}% with the reranker`,
  ]) assert.ok(intro.includes(claim), `intro lacks "${claim}"`);
  const promptText = await page.textContent("#agent-prompt") ?? "";
  assert.ok(promptText.includes(`as Brotli files (${downloadMb.toFixed(1)} MB)`) && promptText.includes(`adds a ${rerankerMb.toFixed(2)} MB download`), promptText);
  // The wording is the author's; its figures must match the data (decimal comma or point alike).
  const flipText = flips.join(" | ").replace(/(\d),(\d)/g, "$1.$2");
  assert.equal(flips.length, 6);
  for (const figure of ["< 100 ms", `for ${Math.round(fusedR25)}% recall R@25`, `with only ${rerankerMb.toFixed(2)} MB still ${Math.round(rerankerR25)}% R@25`, "TurboQuant index, Brotli compressed"]) {
    assert.ok(flipText.includes(figure), `flip line lacks "${figure}": ${flipText}`);
  }
  // llms.txt (human request, 2026-11-09) is served from the site root; its quality table and downloads are bench.json's
  // target-language Chromium figures and the manifest's `.br` bytes.
  const llms = await (await fetch(`${origin}/llms.txt`)).text();
  assert.ok(llms.startsWith("# defuss-vectorsearch\n\n> "), "llms.txt: H1, then the summary blockquote");
  const row = (byLanguage: Record<string, Record<string, number>>) => [1, 5, 10, 25].map((k) => targetAt(byLanguage, k)).join(" | ");
  for (const claim of [
    `| ${downloadMb.toFixed(1)} MB | ${row(bench.strategies.turboquant.recall.byLanguage)} |`,
    `| ${(downloadMb + rerankerMb).toFixed(1)} MB | ${row(bench.strategies.fused.recall.byLanguage)} |`,
    `| ${rerankerMb.toFixed(2)} MB + token vectors (${(manifest.tokens.bytes / 1e6).toFixed(1)} MB as int4 for the demo's 2,000 passages) | ${row(benchReranker.maxsim.recall.byLanguage)} |`,
    `${bench.embedMs.query.p50} ms embedding, ${bench.strategies.turboquant.searchMs.p50} ms search`,
    `adds ${Math.round(bench.strategies.fused.searchMs.p50)} ms`,
    `about ${Math.round(node.turboquant.runtimeMiB * 1.048576)} MB of RAM`,
  ]) assert.ok(llms.includes(claim), `llms.txt lacks "${claim}"`);

  // External links outside the header bar open in a new tab and carry the arrow; the header's own links do not.
  const external = await page.$$eval('a[href^="http"]', (links) => links.map((link) => ({
    href: link.getAttribute("href"), header: !!link.closest(".mk-header"), target: link.getAttribute("target"),
    rel: link.getAttribute("rel") ?? "", arrow: !!link.querySelector('use[href="#i-external"]'),
  })));
  const wrong = external.filter((link) => (link.header ? link.arrow : !(link.arrow && link.target === "_blank" && /noopener/.test(link.rel))));
  assert.deepEqual(wrong, [], "external link rule");
  assert.ok(external.filter((link) => !link.header).length >= 20);

  // "How it works": the pipeline diagram plays its 8 steps by itself once it scrolls into view, wires drawn.
  await page.evaluate(() => document.querySelector("#pipeline")!.scrollIntoView({ block: "center", behavior: "instant" }));
  await page.waitForFunction(() => {
    const state = (document.querySelector("#pipeline") as HTMLElement & { api: { getState(): { name: string; config: { step?: number } } } }).api.getState();
    return state.name === "paused" && state.config.step === 8;
  }, null, { timeout: 40_000 });
  assert.equal(await page.locator("#pipeline .diagram-node").count(), 8);
  assert.equal(await page.locator("#pipeline .diagram-edge").count(), 7);
  assert.ok(await page.locator("#pipeline svg path").count() >= 7, "wires drawn");
  assert.match(await page.textContent("#pipeline") ?? "", /Step 8 of 8/);

  // Benchmark figures on the page are the ones in bench.json.
  const figures = await page.$$eval("[data-bench] .mk-stat-value", (nodes) => nodes.map((node) => node.textContent));
  // The index figure is the Brotli vector file the page itself downloads (docs/data/manifest.json).
  // VERIFIED: R@1 over the eight target languages, fused; the "without" figure was dropped (human request, 2026-11-09).
  const targetR1 = (strategy: string) => Math.round(TARGET_LANGUAGES.reduce((sum, code) => sum + bench.strategies[strategy].recall.byLanguage[code]["@1"], 0) / TARGET_LANGUAGES.length);
  // The R@10 card names the languages where the fused pipeline finds every gold passage in the top 10.
  const perfect = ["eng_Latn", "deu_Latn", "por_Latn", "ita_Latn"];
  for (const code of perfect) assert.equal(bench.strategies.fused.recall.byLanguage[code]["@10"], 100, `${code} fused R@10`);
  assert.deepEqual(figures, [`${bench.embedMs.query.p50} ms`, `${bench.strategies.turboquant.searchMs.p50} ms`, `${bench.strategies.fused.searchMs.p50} ms`,
    `${Math.round(manifest.vectors.bytes / 1000)} kB Brotli`, `${targetR1("fused")}%`, "100%"]);
  assert.equal(await page.textContent('[data-bench="recall-r1"] .mk-stat-label'), "R@1 over the eight target languages, reranked");
  assert.equal(await page.textContent('[data-bench="recall-r10"] .mk-stat-label'), "R@10 for English, German, Portuguese and Italian");
  assert.match(await page.textContent('[data-bench="index-br"] .mk-stat-label') ?? "", new RegExp(`${(manifest.vectors.rawBytes / 1e6).toFixed(2)} MB raw`));
  assert.equal(await page.textContent("#bench .vs-footnote"), "* measured on an Apple MacBook Air M4 in a Chromium-based browser.");
  // VERIFIED: the recall card has one tab per demo mode, Fused open first, and in each one tab per k, R@25 open first,
  // to match the hero (human request, 2026-11-09); every bar is the figure in bench.json
  // (Chromium); switching tabs shows exactly one list.
  const modeRecall: Record<string, Record<string, Record<string, number>>> = {
    reranker: benchReranker.maxsim.recall.byLanguage, embedder: bench.strategies.turboquant.recall.byLanguage, both: bench.strategies.fused.recall.byLanguage,
  };
  const tabsOf = (list: string) => page.$$eval(`${list} > [role=tab]`, (tabs) => tabs.map((tab) => [tab.textContent, tab.getAttribute("aria-selected")]));
  // Each mode panel opens with its model download size, not the tab label (human request, 2026-11-09).
  assert.deepEqual(await tabsOf("#recall-modes"), [["Fused", "true"], ["Embedder", "false"], ["Reranker", "false"]]);
  const modeDownload: Record<string, number> = { both: downloads.both, embedder: downloads.embedder, reranker: sizes(manifest.rerankerFiles) };
  await page.locator("#recall-modes").scrollIntoViewIfNeeded();
  for (const mode of ["reranker", "embedder", "both"]) {
    await page.click(`#recall-mode-tab-${mode}`);
    await page.locator(`#recall-mode-panel-${mode}`).waitFor({ state: "visible" });
    assert.equal(await page.locator("#bench .vs-recall-tabs:visible").count(), 1, `one visible mode panel for ${mode}`);
    assert.equal(await page.textContent(`#recall-mode-panel-${mode} .vs-recall-download`), `Download size: ${label(modeDownload[mode]!)}`);
    assert.deepEqual(await tabsOf(`#recall-tabs-${mode}`), [["R@25", "true"], ["R@10", "false"], ["R@5", "false"], ["R@1", "false"]]);
    for (const k of [10, 1, 5, 25]) {
      await page.click(`#recall-tab-${mode}-${k}`);
      await page.locator(`#recall-panel-${mode}-${k}`).waitFor({ state: "visible" });
      assert.equal(await page.locator("#bench .vs-recall-list:visible").count(), 1, `one visible list for ${mode} R@${k}`);
      const bars = await page.$$eval(`#recall-panel-${mode}-${k} [data-recall] progress`, (nodes) => nodes.map((bar) => [bar.closest("[data-recall]")!.getAttribute("data-recall"), Number(bar.getAttribute("value"))]));
      assert.deepEqual(Object.fromEntries(bars), Object.fromEntries(Object.entries(modeRecall[mode]!).map(([code, value]) => [code, value[`@${k}`]])), `${mode} R@${k} bars`);
      const values = bars.map(([, value]) => value as number);
      assert.deepEqual(values, [...values].sort((a, b) => b - a), `${mode} R@${k} best first`);
    }
  }
  await page.click("#recall-mode-tab-reranker");
  // "Target languages only", right of each panel's k tabs, is on by default (human request, 2026-11-09): the
  // target languages show; switched off in one panel, every panel shows all 20.
  const switches = () => page.$$eval(".vs-recall-filter .switch", (inputs) => inputs.map((input) => (input as HTMLInputElement).checked));
  const visibleRows = (mode: string) => page.locator(`#recall-mode-panel-${mode} .vs-recall-list:visible [data-recall]:visible`).count();
  assert.deepEqual(await switches(), [true, true, true]);
  assert.equal(await visibleRows("reranker"), TARGET_LANGUAGES.length);
  await page.click("#recall-targets-reranker");
  assert.deepEqual(await switches(), [false, false, false]);
  assert.equal(await visibleRows("reranker"), demo.languages.length);
  await page.click("#recall-mode-tab-embedder");
  assert.equal(await visibleRows("embedder"), demo.languages.length);
  await page.click("#recall-targets-embedder");
  assert.equal(await visibleRows("embedder"), TARGET_LANGUAGES.length);
  await page.click("#recall-mode-tab-reranker");
  // "Pruned" marks exactly the non-target languages below 70% R@5 with both models, in every tab.
  const pruned = await page.$$eval("#recall-panel-reranker-10 [data-recall]", (rows) => rows.filter((row) => /Pruned/.test(row.querySelector(".progress-label")!.textContent ?? "")).map((row) => row.getAttribute("data-recall")));
  assert.deepEqual(pruned.sort(), Object.entries(modeRecall.both!)
    .filter(([code, value]) => !(TARGET_LANGUAGES as readonly string[]).includes(code) && value["@5"]! < 70).map(([code]) => code).sort());

  // Choosing "Fused" before any load only relabels the page: no download until the first search.
  await page.click("#mode-tab-both");
  assert.ok(await page.locator("#mode-panel-both").isVisible() && await page.locator("#mode-panel-reranker").isHidden());
  await page.waitForFunction(() => /kyr0\/Winzling-embed \+ kyr0\/Winzling-reranker not cached yet/.test(document.querySelector("#log")!.textContent ?? ""));
  assert.equal(await page.textContent("#boot-start"), `Load the models · ${label(downloads.both)}`);
  assert.equal(await page.textContent("#p-model-name"), "Models · kyr0/Winzling-embed uint4 + kyr0/Winzling-reranker q8");
  assert.ok(await page.locator("#p-tokens-field").isHidden(), "no token-vector bar without the reranker alone");
  assert.ok(await page.locator("#backend").isEnabled());
  assert.equal(await page.inputValue("#backend"), "webgpu", "WebGPU is pre-selected");
  assert.match(await page.textContent("#p-runtime-hint") ?? "", new RegExp(`^~${ram.both} MB RAM reserved for models`));
  assert.equal(modelRequests.length + rerankerRequests.length, 0, "a mode change alone downloads nothing");

  // Typing alone never starts the model download; the Search button does, and the query waits for the model.
  const giza = "How tall are the pyramids of Giza?";
  await page.fill("#q", giza);
  await page.waitForTimeout(300);
  assert.equal(modelRequests.length + rerankerRequests.length, 0, "typing must not start the download");
  const started = Date.now();
  await page.click("#search-submit");
  await page.waitForSelector("#results .vs-skeleton");
  await ready(page);
  report.bootMs = Date.now() - started;
  for (const bar of ["#p-model", "#p-runtime", "#p-index", "#ring"]) assert.equal(await stateOf(page, bar), "complete", bar);
  // The page's first load shows no toast (human request, 2026-11-09); later loads do (the "Embedder" step below).
  assert.equal(await page.locator(".toast", { hasText: "Ready in" }).count(), 0, "no toast for the page's first load");
  // WebGPU is pre-selected (human decision, 2026-11-09): it runs, or the load falls back to WASM with a notice, and the
  // select then shows the device that ran.
  report.webgpu = { device: await page.textContent('[data-stat="device"]'), notice: await page.locator("#boot-notice").isVisible() };
  assert.ok((report.webgpu as { device: string }).device === "WebGPU" || (report.webgpu as { notice: boolean }).notice, JSON.stringify(report.webgpu));
  assert.match(await page.textContent("#boot-status") ?? "", /^Ready in .* (WASM|WebGPU)/);
  assert.equal(await page.textContent('[data-stat="passages"]'), "2,000");
  assert.equal(await page.locator('#boot-start use[href="#i-reload"]').count(), 1, "Reload the model carries a reload icon");
  // Every model file crosses the network as its `.br`, decoded in the worker by defuss-brotli's slim decoder, whose
  // WASM comes from docs/assets as its own file.
  assert.ok(served.includes("/assets/decompressor.wasm"), "the worker loads defuss-brotli's decompressor.wasm");
  assert.deepEqual(modelRequests.sort(), ["onnx/model_uint4.onnx.br", "tokenizer.json.br", "tokenizer_config.json.br"]);
  assert.deepEqual(rerankerRequests.sort(), ["model_q8.onnx.br", "runtime.json.br", "tokenizer.json.br", "tokenizer_config.json.br"]);
  // The model bar counts both models' `.br` bytes against the manifest, which names every file the worker loads.
  const modelBytes = [...Object.values(manifest.modelFiles), ...Object.values(manifest.rerankerFiles)].reduce((a: number, b) => a + (b as { bytes: number }).bytes, 0);
  assert.equal(await page.textContent('output[for="p-model"]'), `100% of ${(modelBytes / 1e6).toFixed(1)} MB`);
  await summaryFor(page, giza);
  let top = await hits(page);
  assert.equal(top.length, 12);
  assert.equal(new Set(top.map((hit) => hit.id)).size, 12, "twelve different passages");
  // Busy ends with the fused order, which replaces the TurboQuant hits; cards keep their dense similarity.
  assert.match(await page.textContent("#summary-time") ?? "", / strategy: TurboQuant \+ MoEdernColBERT \(reranked order, Winzling scores\)$/);
  await assertMoves(page, "#results");
  assert.ok(top.slice(0, 3).some((hit) => hit.group === 1), `the Giza passage (1) in the top 3: ${JSON.stringify(top.slice(0, 3))}`);

  // Palette picks keep the scroll position, so the re-ranked results stay in sight. Enter runs the highlighted query.
  // "instant": the page scrolls smoothly, and a still-running scroll would be misread as a jump.
  await page.evaluate(() => scrollTo({ top: document.querySelector(".vs-query")!.getBoundingClientRect().top + window.scrollY - 120, behavior: "instant" }));
  const before = await scrollY(page);
  const english = firstQuery("eng_Latn");
  const searchRequests: string[] = [];
  const onRequest = (request: { url(): string }) => searchRequests.push(request.url());
  page.on("request", onRequest);
  await page.keyboard.press("ControlOrMeta+k");
  assert.ok(await paletteOpen(page));
  await page.keyboard.type(english.slice(0, 24));
  await page.screenshot({ path: "output/docs-demo-palette.png" });
  await page.keyboard.press("Enter");
  await summaryFor(page, english);
  page.off("request", onRequest);
  assert.deepEqual(searchRequests, [], "a search sends nothing over the network (the privacy claim)");
  assert.equal(await paletteOpen(page), false);
  assert.ok(Math.abs((await scrollY(page)) - before) < 2, `scroll moved from ${before} to ${await scrollY(page)}`);
  top = await hits(page);
  // bench.json: English R@5 is 100% for Winzling + TurboQuant + MoEdernColBERT in Chromium, so the gold passage is in the top 5.
  assert.equal(bench.strategies.fused.recall.byLanguage.eng_Latn["@5"], 100, "bench.json precondition");
  const exact = top.findIndex((hit) => hit.gold === "exact");
  assert.ok(exact >= 0 && exact < 5, `gold passage rank ${exact + 1}`);
  assert.match(await page.textContent("#summary-gold") ?? "", /Gold answer at #\d/);
  assert.match(await page.textContent("#summary-time") ?? "", /^embed [\d.]+ ms scan [\d.]+ ms rerank [\d.]+ ms strategy: TurboQuant \+ MoEdernColBERT \(reranked order, Winzling scores\)$/);
  // The summary (human request, 2026-11-09): steps as badges with bold durations, no second copy of the query, and
  // "Clear search" as a button with an icon.
  assert.equal(await page.locator("#summary-time .badge strong").count(), 3, "embed, scan and rerank badges");
  assert.equal(await page.locator("#summary q, #summary .vs-summary-query").count(), 0, "the query shows only in the search box");
  assert.equal(await page.locator('button#summary-clear use[href="#i-x"]').count(), 1);
  // The gold badge sits in a gold aura at the end of its card header; the first card alone wears an aura frame.
  const gold = await page.$eval('#results .vs-hit[data-gold="exact"]', (hit) => {
    const badge = hit.querySelector(".aura-gold .badge")!.getBoundingClientRect();
    return { text: hit.querySelector(".aura-gold .badge")!.textContent, gap: hit.querySelector(".card-header")!.getBoundingClientRect().right - badge.right };
  });
  assert.equal(gold.text, "Gold");
  assert.ok(gold.gap < 40, `gold badge ${gold.gap}px from the header's end`);
  // A translation's badge keeps its secondary fill; only the ring around it is gold.
  const translations = await page.$$eval('#results .vs-hit[data-gold="translation"]', (list) => list.map((hit) => {
    const badge = hit.querySelector(".aura-gold > .badge");
    return { text: badge?.textContent, variant: badge?.getAttribute("data-variant") };
  }));
  assert.ok(translations.length > 0, "an English bench query ranks a translation of its gold passage");
  for (const badge of translations) assert.deepEqual(badge, { text: "Gold · translation", variant: "secondary" });
  assert.equal(await page.locator("#results .vs-hit > .aura").count(), 1);
  assert.equal(await page.locator("#results .vs-hit:first-child > .aura .card").count(), 1);
  await page.screenshot({ path: "output/docs-demo.png", fullPage: true });

  // A click on a palette item: same query path, same scroll position.
  const german = firstQuery("deu_Latn");
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type(german.slice(0, 24));
  await page.locator("#cmd .command-item[data-query]:visible").first().click();
  await summaryFor(page, german);
  assert.equal(await paletteOpen(page), false);
  assert.ok(Math.abs((await scrollY(page)) - before) < 2, `scroll moved from ${before} to ${await scrollY(page)}`);
  assert.equal(await page.inputValue("#q"), german);
  assert.ok((await hits(page)).some((hit) => hit.gold === "exact" || hit.gold === "translation"));

  // Tab 2: your own vector database. Notes are embedded 500 ms after typing stops or on blur, then searchable.
  // The "My data (custom)" link in the intro opens the tab. It sits just below the floating header, so a default
  // scroll-into-view can leave it under the header (make e2e, 2026-11-09): centre it first.
  const myData = page.locator('#demo .mk-section-header [data-tab="1"]');
  await myData.evaluate((node) => node.scrollIntoView({ block: "center", behavior: "instant" }));
  await myData.click();
  assert.ok(await page.locator("#panel-notes").isVisible());
  assert.ok(await page.locator("#notes-empty").isVisible());
  // "Add note" sits above the notes, so it is in view without scrolling the board.
  const addNoteTop = await page.$eval("#add-note", (node) => node.getBoundingClientRect().top - document.querySelector(".vs-notes-scroll")!.getBoundingClientRect().top);
  assert.ok(addNoteTop < 0, "Add note above the notes list");
  const noteStatus = (n: number) => page.textContent(`#note-${n} .vs-note-status`);
  const addNote = async (n: number, text: string) => {
    await page.click("#add-note");
    assert.equal(await page.evaluate(() => document.activeElement?.id), `note-${n}-text`, "a new note takes the focus");
    await page.keyboard.type(text);
  };
  await addNote(1, "Die Katze schläft auf dem Sofa.");
  await page.waitForFunction(() => /Embedded/.test(document.querySelector("#note-1 .vs-note-status")?.textContent ?? "")); // the 500 ms pause
  assert.match(await noteStatus(1) ?? "", /Embedded384-d in [\d.]+ ms · index [\d.]+ ms/);
  await addNote(2, "Build a web application with a fast backend.");
  await page.keyboard.press("Tab"); // blur embeds at once
  await page.waitForFunction(() => /Embedded/.test(document.querySelector("#note-2 .vs-note-status")?.textContent ?? ""));
  await addNote(3, "Кошка спит на диване.");
  await page.waitForFunction(() => /Embedded/.test(document.querySelector("#note-3 .vs-note-status")?.textContent ?? ""));
  assert.equal(await page.textContent("#notes-count"), "3 notes · 3 embedded");
  await page.fill("#notes-q", "A sleeping cat on a couch");
  await page.click("#notes-submit");
  await page.waitForFunction(() => document.querySelector<HTMLElement>("#notes-summary")?.dataset.query === "A sleeping cat on a couch"
    && !document.querySelector("#notes-results")!.hasAttribute("aria-busy"));
  const noteTitles = () => page.$$eval("#notes-results .card-title", (nodes) => nodes.map((node) => node.textContent));
  assert.deepEqual((await noteTitles()).slice(0, 2).sort(), ["Note 1", "Note 3"], "both cat notes, across languages, rank first");
  assert.equal(await page.locator("#notes-results .vs-hit:first-child > .aura").count(), 1);
  assert.match(await page.textContent("#notes-summary .mk-search-summary-time") ?? "", / strategy: TurboQuant \+ MoEdernColBERT \(reranked order, Winzling scores\)$/);
  await assertMoves(page, "#notes-results");
  // Emptying a note takes it out of the index; the open search refreshes by itself.
  await page.fill("#note-2-text", "");
  await page.locator("#note-2-text").blur();
  await page.waitForFunction(() => /removed from the index/.test(document.querySelector("#note-2 .vs-note-status")?.textContent ?? ""));
  assert.equal(await page.textContent("#notes-count"), "3 notes · 2 embedded");
  await page.waitForFunction(() => document.querySelectorAll("#notes-results .vs-hit").length === 2);
  // "Add random notes" adds five different sample notes from a pool of 100 (mostly German, English, Russian), embedded at once.
  const pool = await page.evaluate(async (url) => (await import(url)).SAMPLE_NOTES as { lang: string; text: string }[], "./assets/sample-notes.js");
  assert.equal(pool.length, 100);
  assert.ok(pool.filter((note) => ["de", "en", "ru"].includes(note.lang)).length >= 80, "mostly German, English and Russian");
  // A DOM click: Playwright's own click re-scrolls the button out from under the floating header (probe 2026-10-08),
  // which would hide whether the page itself scrolls.
  const pageY = await scrollY(page);
  await page.$eval("#add-random-notes", (button) => (button as HTMLButtonElement).click());
  await page.waitForFunction(() => [4, 5, 6, 7, 8].every((n) => /Embedded/.test(document.querySelector(`#note-${n} .vs-note-status`)?.textContent ?? "")), null, { timeout: 30_000 });
  const added = await page.$$eval(".vs-note textarea", (nodes) => nodes.slice(3).map((node) => ({ text: (node as HTMLTextAreaElement).value, lang: node.getAttribute("lang") })));
  assert.equal(added.length, 5);
  assert.equal(new Set(added.map((note) => note.text)).size, 5, "five different notes");
  for (const note of added) assert.ok(pool.some((sample) => sample.text === note.text && sample.lang === note.lang), JSON.stringify(note));
  assert.equal(await page.textContent("#notes-count"), "8 notes · 7 embedded");
  const afterY = await scrollY(page);
  assert.ok(Math.abs(afterY - pageY) < 2, `adding notes does not move the page: ${pageY} -> ${afterY}`);
  // The border layout's divider resizes the notes board from the keyboard.
  const boardWidth = () => page.$eval(".vs-board", (node) => node.getBoundingClientRect().width);
  const widthBefore = await boardWidth();
  await page.focus("#notes-layout > .resizer > .resizer-handle");
  await page.keyboard.press("ArrowRight");
  assert.ok(Math.abs((await boardWidth()) - widthBefore - 10) < 2, `board ${widthBefore} -> ${await boardWidth()}`);
  // A bench query picked while tab 2 shows switches back to tab 1.
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type(english.slice(0, 24));
  await page.keyboard.press("Enter");
  await summaryFor(page, english);
  assert.ok(await page.locator("#panel-bench").isVisible());
  assert.ok(await page.locator("#panel-notes").isHidden());

  // Live typing re-ranks the same grid: the Giza passage (passage 1) answers a pyramid question in another wording.
  await page.fill("#q", "");
  await page.locator("#q").pressSequentially("Wie groß sind die Pyramiden von Gizeh?", { delay: 25 });
  await summaryFor(page, "Wie groß sind die Pyramiden von Gizeh?");
  top = await hits(page);
  assert.ok(top.slice(0, 3).some((hit) => hit.group === 1), `passage 1 in the top 3: ${JSON.stringify(top.slice(0, 3))}`);
  assert.equal(await page.locator("#summary-gold").isHidden(), true, "typed text has no bench gold");

  // Free text through the palette: no question matches, so Enter searches the text itself.
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("Sternwarte zqx");
  assert.equal(await page.locator("#cmd .command-item:visible").count(), 0);
  await page.keyboard.press("Enter");
  await summaryFor(page, "Sternwarte zqx");
  assert.equal(await paletteOpen(page), false, "Enter on free text closes the palette");

  // Once ready, the hero's "Try it now!" link still only scrolls to the demo: no second load.
  const loads = await page.locator("#log pre", { hasText: "load · device=" }).count();
  await page.click("#try-live");
  assert.equal(await page.locator("#log pre", { hasText: "load · device=" }).count(), loads);
  assert.equal(await page.inputValue("#q"), "Sternwarte zqx");

  // The worker log (a collapsible) holds the boot transcript.
  await page.click("#log-panel summary");
  assert.ok(await page.$eval("#log-panel", (details) => (details as HTMLDetailsElement).open));
  await page.locator("#log").waitFor({ state: "visible" }); // the panel animates open
  assert.ok(await page.locator("#log pre", { hasText: "SHA-256 verified" }).count() >= 1);

  // Clear -> the CTA with example queries; an example runs a search again.
  await page.click("#summary-clear");
  await page.waitForSelector("#empty:not([hidden])");
  assert.equal(await page.locator("#results .vs-hit").count(), 0);
  assert.ok(await page.locator("#summary").isHidden());
  const example = page.locator("#empty-examples [data-query]").first();
  const exampleText = (await example.textContent()) ?? "";
  await example.click();
  await summaryFor(page, exampleText);

  // The floating header stays on screen below the hero (it must be sticky relative to the whole page).
  await page.evaluate(() => document.getElementById("use")!.scrollIntoView({ block: "start" }));
  const header = await page.$eval(".mk-header", (node) => node.getBoundingClientRect().top);
  assert.ok(header >= 0 && header < 40, `header top ${header}`);

  // The back-to-top button (shown once the page has scrolled) returns to the start.
  await page.evaluate(() => scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
  await page.click(".fab[data-scroll-top] a");
  await page.waitForFunction(() => window.scrollY < 5, null, { timeout: 10_000 });

  // Copy button, theme swap.
  await page.click(".mk-code-block-copy");
  await page.waitForFunction(() => document.querySelector(".mk-code-block-status")?.textContent === "Copied");
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /createWinzlingEmbedder/);
  await page.click("#copy-prompt");
  await page.waitForFunction(() => document.querySelector("#copy-prompt-status")?.textContent === "Copied");
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(prompt, /^Integrate defuss-vectorsearch into this app: https:\/\/github\.com\/kyr0\/defuss-vectorsearch\n/);
  assert.doesNotMatch(prompt, /⏎/);
  assert.equal(await page.textContent("#copy-prompt span"), "Copied");
  const dark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  // The "Tokenize, Embed, Retrieve" stage inverts with the theme (human request, 2026-11-09): white on dark, dark on light.
  const stageColor = () => page.$eval(".vs-flythrough .parallax-stage", (stage) => getComputedStyle(stage).color);
  const stageFor = (isDark: boolean) => (isDark ? "rgb(255, 255, 255)" : "rgb(5, 6, 15)");
  assert.equal(await stageColor(), stageFor(dark));
  await page.click(".mk-header .swap");
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), !dark);
  assert.equal(await stageColor(), stageFor(!dark));

  // The palette lists example queries only, no actions.
  await page.keyboard.press("ControlOrMeta+k");
  assert.equal(await page.locator("#cmd .command-item:not([data-query])").count(), 0);
  await page.keyboard.press("Escape");

  // Backend switch to WASM: the models come from the cache.
  await page.selectOption("#backend", "wasm");
  await page.waitForFunction(() => (document.querySelector("#boot-status")?.textContent ?? "").startsWith("Ready in"), null, { timeout: 120_000 });
  assert.equal(await page.textContent('[data-stat="device"]'), "WASM");
  assert.equal(modelRequests.length, 3, "a backend switch reads the model from the Cache API");
  assert.equal(rerankerRequests.length, 4, "and the reranker too");

  // "Embedder" mode: Winzling alone, read from the cache; the TurboQuant hits are final, nothing is reranked.
  await page.click("#mode-tab-embedder");
  await ready(page);
  await page.locator(".toast", { hasText: /kyr0\/Winzling-embed · / }).waitFor();
  assert.match(await page.textContent("#boot-status") ?? "", /^Ready in .* · kyr0\/Winzling-embed · /);
  assert.equal(await page.textContent("#p-model-name"), "Model · kyr0/Winzling-embed uint4");
  await page.fill("#q", giza);
  await summaryFor(page, giza);
  assert.match(await page.textContent("#summary-time") ?? "", /^embed [\d.]+ ms scan [\d.]+ ms strategy: TurboQuant$/);
  assert.equal(await page.locator("#results .vs-moved").count(), 0, "no rerank badges without the reranker");
  assert.equal((await hits(page)).length, 12);

  // "Reranker" mode: the reranker alone downloads the passages' prebuilt token vectors, then ranks each query against
  // all of them. VERIFIED (tmp/colbert-demo-probe.ts, 2026-11-09): the English example's gold passage ranks first and
  // the Giza passage tops the pyramid question; the cat notes outrank the web-app note.
  await page.click("#mode-tab-reranker");
  await ready(page);
  assert.equal(await stateOf(page, "#p-tokens"), "complete", "token vectors for every passage");
  assert.equal(served.filter((file) => file === "/data/tokens.bin.br").length, 1, "the prebuilt token vectors, downloaded once");
  assert.ok(await page.locator("#p-tokens-field").isVisible());
  assert.equal(modelRequests.length, 3, "the mode switches read both models from the Cache API");
  assert.equal(rerankerRequests.length, 4);
  // The open query re-runs by itself once the mode is ready.
  await page.waitForFunction(() => /MaxSim/.test(document.querySelector("#summary-time")?.textContent ?? "") && !document.querySelector("#results")!.hasAttribute("aria-busy"));
  assert.match(await page.textContent("#summary-time") ?? "", /^embed [\d.]+ ms scan [\d.]+ ms strategy: MoEdernColBERT MaxSim, all passages$/);
  assert.equal((await hits(page))[0]!.group, 1, "the Giza passage first");
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type(english.slice(0, 24));
  await page.keyboard.press("Enter");
  await summaryFor(page, english);
  assert.equal((await hits(page)).findIndex((hit) => hit.gold === "exact"), 0, "the English example's gold passage first");
  // The notes were re-encoded into token vectors by the switch; their cards say so.
  await page.click("#tab-notes");
  await page.waitForFunction(() => /\d+ x 128-d in/.test(document.querySelector("#note-1 .vs-note-status")?.textContent ?? ""));
  await page.fill("#notes-q", "A sleeping cat on a couch");
  await page.click("#notes-submit");
  await page.waitForFunction(() => /MaxSim/.test(document.querySelector("#notes-summary .mk-search-summary-time")?.textContent ?? "")
    && !document.querySelector("#notes-results")!.hasAttribute("aria-busy"));
  assert.equal((await noteTitles()).length, 7, "every embedded note is ranked");
  await page.click("#tab-bench");

  // "Re-embed the index": the reranker encodes all 2,000 passages again, in the browser, and the page shows how long
  // that took; searches keep working on the new vectors.
  await page.click("#reembed");
  await page.waitForFunction(() => /in [\d.]+ s, in this browser/.test(document.querySelector("#p-reembed-hint")?.textContent ?? ""), null, { timeout: 120_000 });
  assert.match(await page.textContent("#p-reembed-hint") ?? "", /^2,000 passages with kyr0\/Winzling-reranker in [\d.]+ s, in this browser/);
  assert.equal(await stateOf(page, "#p-reembed"), "complete");
  assert.ok(await page.locator(".toast", { hasText: "Re-embedded the index" }).count() >= 1);
  await page.fill("#q", "");
  await page.fill("#q", giza);
  await summaryFor(page, giza);
  assert.equal((await hits(page))[0]!.group, 1, "the Giza passage first, on the re-encoded vectors");

  // Reload: the default mode's cached model and token vectors load by themselves.
  await page.reload();
  await ready(page);
  assert.equal(await page.getAttribute("#mode-tab-reranker", "aria-selected"), "true");
  assert.equal(modelRequests.length + rerankerRequests.length, 7, "a reload reads the model from the Cache API");
  assert.equal(served.filter((file) => file === "/data/tokens.bin.br").length, 1, "and the token vectors");
  assert.match(await page.textContent('[data-stat="source"]') ?? "", /cache/);

  // Clearing the cache: the next load would download again.
  assert.equal(await page.textContent("#clear-cache"), "Clear stored AI model cache"); // the human's wording (2026-11-09)
  await page.click("#clear-cache");
  await page.waitForFunction(() => /model cache cleared/.test(document.querySelector("#log")!.textContent ?? ""));
  await context.close();

  // A failed index (the page-load download) shows the error; Retry fetches the index again and nothing else.
  const noIndex = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await prepare(noIndex);
  let indexDown = true;
  await noIndex.route(`${origin}/data/vectors.bin.br`, (route) => (indexDown ? route.fulfill({ status: 500, body: "down" }) : route.fallback()));
  const indexPage = await noIndex.newPage();
  const indexErrors: string[] = [];
  indexPage.on("pageerror", (error) => indexErrors.push(error.message));
  const modelBefore = modelRequests.length;
  await indexPage.goto(`${origin}/`);
  await indexPage.waitForSelector("#boot-error:not([hidden])");
  assert.equal(await indexPage.textContent("#boot-error-title"), "Loading failed");
  assert.match(await indexPage.textContent("#boot-error-text") ?? "", /vectors\.bin\.br: HTTP 500/);
  indexDown = false;
  await indexPage.click("#boot-retry");
  await indexPage.waitForFunction(() => document.querySelectorAll("#cmd .command-item[data-query]").length === 1000);
  assert.ok(await indexPage.locator("#boot-error").isHidden());
  assert.equal(modelRequests.length, modelBefore, "retrying the index must not download the model");
  assert.deepEqual(indexErrors, []);
  await noIndex.close();

  // Main error path: a failed model download shows the error with Retry, and Retry recovers once the host answers.
  const flaky = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await prepare(flaky);
  let failing = true;
  await flaky.route("https://huggingface.co/**/tokenizer.json.br", (route) => (failing ? route.fulfill({ status: 500, body: "down" }) : route.fallback()));
  const broken = await flaky.newPage();
  const brokenErrors: string[] = [];
  broken.on("pageerror", (error) => brokenErrors.push(error.message));
  await broken.goto(`${origin}/`);
  await broken.waitForFunction(() => /not cached yet/.test(document.querySelector("#log")!.textContent ?? ""));
  await broken.click("#boot-start");
  await broken.waitForSelector("#boot-error:not([hidden])");
  assert.match(await broken.textContent("#boot-error-text") ?? "", /tokenizer\.json\.br: HTTP 500/);
  failing = false;
  await broken.click("#boot-retry");
  await ready(broken);
  assert.ok(await broken.locator("#boot-error").isHidden());
  assert.deepEqual(brokenErrors, []);
  await flaky.close();

  // Phone width with reduced motion: no sideways scroll, the sheet menu opens and closes, search still works.
  const phone = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: "reduce", locale: "de-DE" });
  await prepare(phone);
  const mobile = watch(await phone.newPage(), "mobile");
  await mobile.goto(`${origin}/`);
  // The page clips sideways overflow, so scrollWidth alone cannot see it: every block must end inside the viewport.
  const overflowing = () => mobile.$$eval(".mk-header, .mk-hero-copy, .mk-hero-actions .btn, .vs-intro, #pipeline, .vs-window, .vs-notes-layout, .vs-note, .vs-ad, #consulting, .mk-empty-state, .mk-empty-state-actions .btn, .vs-search, .vs-hit, .mk-stats, .mk-code-block, .vs-prompt, .mk-cta, .mk-footer-inner",
    (nodes) => nodes.filter((node) => node.getBoundingClientRect().right > innerWidth + 0.5).map((node) => node.className));
  await mobile.waitForFunction(() => document.querySelectorAll("#empty-examples [data-query]").length === 3);
  assert.deepEqual(await overflowing(), [], "blocks wider than 375 px");
  await mobile.click(".mk-header-menu");
  await mobile.waitForSelector("#vs-menu[open]");
  await mobile.click('#vs-menu a[href="#demo"]');
  await mobile.waitForFunction(() => !document.querySelector<HTMLDialogElement>("#vs-menu")!.open); // a closed dialog is never "visible"
  // A note written before the model exists waits for it, and writing it is what starts the download.
  await mobile.click("#tab-notes");
  await mobile.click("#add-note");
  await mobile.keyboard.type("Hallo Welt");
  await mobile.waitForFunction(() => /Waiting for the model|Embedding|Embedded/.test(document.querySelector("#note-1 .vs-note-status")?.textContent ?? ""));
  await ready(mobile);
  await mobile.waitForFunction(() => /Embedded/.test(document.querySelector("#note-1 .vs-note-status")?.textContent ?? ""));
  assert.equal(await mobile.$eval("#notes-region", (node) => node.classList.contains("border-layout-north")), true, "phones stack the split");
  assert.deepEqual(await overflowing(), [], "tab 2 wider than 375 px");
  await mobile.click("#tab-bench");

  // An example query picked before the model exists loads the model, then runs.
  const firstExample = mobile.locator("#empty-examples [data-query]").first();
  const firstExampleText = (await firstExample.textContent()) ?? "";
  assert.equal(firstExampleText, german, "a German browser sees a German example first");
  await firstExample.click();
  await ready(mobile);
  await summaryFor(mobile, german);
  assert.equal((await hits(mobile)).length, 12);
  assert.deepEqual(await overflowing(), [], "blocks wider than 375 px after results render");
  await mobile.screenshot({ path: "output/docs-demo-mobile.png", fullPage: true });
  await phone.close();

  Object.assign(report, { modelRequests, rerankerRequests, problems });
  assert.deepEqual(problems, []);
  console.log(`${new Date().toISOString()} INFO docs demo passed boot_ms=${report.bootMs} webgpu=${JSON.stringify(report.webgpu)}`);
} finally {
  await mkdir("output", { recursive: true });
  await writeFile("output/docs-demo.json", `${JSON.stringify({ ...report, problems }, null, 2)}\n`);
  await browser.close();
  server.close();
}
