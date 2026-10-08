/**
 * e2e for the static demo in docs/ (part of `make e2e`): serves docs/ as GitHub Pages would and drives it in Chromium.
 * The pinned model (huggingface.co) and ONNX Runtime's WASM (jsDelivr) are answered from the local mirrors that
 * `make setup` fills (public/models/winzling, node_modules/onnxruntime-web/dist), byte-identical to the remote files,
 * so the run is fast and deterministic; defuss-shadcn still comes from its CDN.
 * VERIFIED: the model mirror is hash-checked against the pinned SHA-256s (download-model.ts, then the worker); the ORT
 * files are the installed onnxruntime-web, the same npm version the worker requests from jsDelivr.
 * Alternative rejected: fetching 40 MB from Hugging Face and 27 MB from jsDelivr on every CI run.
 * Covers every section and component: header + sheet + links, the search CTA, boot (bars, ring, stats, log), the Search
 * button, palette (filter, pick by Enter and by click, actions) with a steady scroll position, live search with
 * re-ranking, gold badges, theme swap, backend switch, cached reload, both copy buttons, mobile width, reduced motion. Fails on any page error, console error, failed request or HTTP >= 400.
 * Report: output/docs-demo.json + screenshots.
 */
import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createGzip, gunzipSync } from "node:zlib";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { WINZLING_PROFILE, WINZLING_REVISION } from "../dist/shared.mjs";
import { DATASET_SHA256, TARGET_LANGUAGES } from "./bench/dataset.ts";
import { decodeDemoIndex } from "./docs/index-format.ts";

const DOCS = path.resolve("docs");
const TYPES: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm",
};
const MIRRORS = [
  { prefix: `https://huggingface.co/kyr0/Winzling-Embed-a8m-64k/resolve/${WINZLING_REVISION}/`, dir: path.resolve("public/models/winzling") },
  { prefix: "https://cdn.jsdelivr.net/npm/onnxruntime-web@", dir: path.resolve("node_modules/onnxruntime-web/dist"), strip: /^[^/]+\/dist\// },
];

const server = createServer(async (request, response) => {
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
const problems: string[] = [];
const prepare = async (context: BrowserContext) => {
  for (const mirror of MIRRORS) {
    await context.route(`${mirror.prefix}**`, async (route) => {
      const rest = route.request().url().slice(mirror.prefix.length).replace(mirror.strip ?? /^/, "");
      if (mirror.dir.endsWith("winzling")) modelRequests.push(rest);
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
  page.waitForFunction((q) => document.querySelector("#summary-query")?.textContent === q && !document.querySelector("#results")!.hasAttribute("aria-busy"), query, { timeout: 30_000 });
const hits = (page: Page) => page.$$eval("#results .vs-hit", (items) => items.map((item) => ({
  id: item.id, gold: item.getAttribute("data-gold"), score: Number(item.querySelector(".vs-score")?.textContent),
  group: Number(/passage (\d+)/.exec(item.querySelector(".card-description")?.textContent ?? "")?.[1]),
})));
/** VERIFIED: ⌘K opens the palette natively but its State API keeps reporting "default" (defuss-shadcn 0.9.7), so read `open`. */
const paletteOpen = (page: Page) => page.$eval("#cmd", (dialog) => (dialog as HTMLDialogElement).open);
const stateOf = (page: Page, selector: string) => page.$eval(selector, (node) => (node as HTMLElement & { api: { getState(): { name: string } } }).api.getState().name);

const manifest = JSON.parse(await readFile("docs/data/manifest.json", "utf8"));
const unpack = async (file: string) => new Uint8Array(gunzipSync(await readFile(`docs/data/${file}`)));
const demo = decodeDemoIndex(JSON.parse(new TextDecoder().decode(await unpack(manifest.documents.file))), await unpack(manifest.vectors.file));
const firstQuery = (code: string) => demo.queries.find((query) => demo.languages[query.language] === code)!.text;
const bench = JSON.parse(await readFile("bench.json", "utf8")).environments.chromium.models.winzling;
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
  assert.equal(await stateOf(page, "#p-index"), "complete", "progress counts the gzipped bytes against the manifest sizes");
  // One set of figures everywhere: the index hint shows the manifest's raw and gzipped sizes (431 kB = the vector index).
  const kb = (bytes: number) => `${Math.round(bytes / 1e3)} kB`;
  const mb = (bytes: number) => `${(bytes / 1e6).toFixed(2)} MB`;
  assert.equal(await page.textContent("#p-index-hint"),
    `vector index ${mb(manifest.vectors.rawBytes)} → ${kb(manifest.vectors.bytes)} gzip · passage text ${mb(manifest.documents.rawBytes)} → ${kb(manifest.documents.bytes)} gzip`);
  assert.equal(await page.textContent('output[for="p-index"]'), `100% of ${kb(manifest.vectors.bytes + manifest.documents.bytes)} (gzip)`);
  const chromiumMiB = JSON.parse(await readFile("bench.json", "utf8")).environments.chromium.models.winzling.strategies.turboquant.runtimeMiB;
  const ramMb = Math.round(chromiumMiB * 1.048576); // MiB → MB: the page uses decimal units only
  assert.match(await page.textContent("#p-runtime-hint") ?? "", new RegExp(`~${ramMb} MB RAM reserved`));
  // No stray figure: every model size reads 39.8 MB, no MiB anywhere visible.
  const bodyText = (await page.evaluate(() => document.body.innerText)).replace(/\u00a0/g, " ");
  assert.doesNotMatch(bodyText, /(?<![\d.])40 MB|MiB/, "a 40 MB or MiB figure is left");
  assert.equal(await page.textContent('[data-stat="languages"]'), "documents · 20 languages");
  assert.equal(await page.textContent(".statistic:has([data-stat=passages]) .statistic-title"), "Vector Database Index");
  assert.equal(modelRequests.length, 0, "the model must not download before the user asks");
  assert.ok(await page.locator("#empty").isVisible(), "the search CTA shows first");
  assert.equal(await page.locator("#results .vs-hit").count(), 0, "no skeletons before a search");
  assert.equal(await page.locator("#empty-examples [data-query]").count(), 3);
  // The hero's "Try it now! (Live)" only jumps to the demo: it never starts the download.
  assert.deepEqual(await page.$$eval(".mk-hero-actions .btn", (nodes) => nodes.map((node) => node.textContent?.trim())), ["Try it now! (Live)", "Benchmark results"]);
  await page.click("#try-live");
  await page.waitForTimeout(300);
  assert.equal(modelRequests.length, 0, "Try it now does not download the model");
  assert.deepEqual(await page.$$eval("#demo-tabs .vs-tab-title", (nodes) => nodes.map((node) => node.textContent)), ["Benchmark data", "My data (custom)"]);
  await page.click("#empty [data-command-trigger]");
  assert.ok(await paletteOpen(page), "the CTA opens the palette");
  await page.keyboard.press("Escape");

  // Headline copy is the author's to change; the page keeps one h1 that names the topic.
  assert.equal(await page.locator("h1").count(), 1);
  assert.match(await page.textContent("h1") ?? "", /^Semantic search\b/);
  // Links: the model page opens in a new tab; the hero and footer credit the author and the dataset.
  assert.equal(await page.getAttribute('.mk-header a[href="https://huggingface.co/kyr0/Winzling-Embed-a8m-64k"]', "target"), "_blank");
  assert.match(await visibleText(page, ".mk-hero-note"), /brought to you by Aron Homberg \(kyr0\) – Open Source \(MIT\)/);
  assert.equal(await page.locator('.mk-hero-note a[href="https://www.linkedin.com/in/aronhomberg/"]').count(), 1);
  assert.equal(await page.locator('.mk-footer-copy a[href="https://www.linkedin.com/in/aronhomberg/"]').count(), 1);
  assert.equal(await page.locator('.mk-footer-copy a[href$="/datasets/tiny-embedding-bench-v1"]').count(), 1);
  assert.equal(await page.locator('.mk-footer-nav a[href="https://huggingface.co/hotchpotch/bekko-embedding-v1-a8m"]').count(), 1);
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
  const top3 = ["deu_Latn", "eng_Latn", "rus_Cyrl"].map((code) => node.bruteforce.recall.byLanguage[code]["@5"] as number);
  const intro = `${await visibleText(page, ".mk-hero-desc")} ${await visibleText(page, "#intro")}`.replace(/\u00a0/g, " ");
  assert.ok(intro.includes(`~${Math.round(top3.reduce((a, b) => a + b) / 3)}% recall`), `R@5 of ${top3} in: ${intro.slice(0, 200)}`);
  assert.ok(intro.includes(`${demo.index.codeBytes} bytes`), "bytes per document = TurboQuant code bytes");
  assert.ok(intro.includes(`${WINZLING_PROFILE.maxTokens.toLocaleString("en")} tokens`), "context = the profile's maxTokens");
  assert.equal(await page.locator("#intro .vs-intro-icon svg").count(), 6);
  // Six titled blocks; their wording is the author's, their figures are checked below.
  assert.equal((await page.$$eval("#intro h3", (nodes) => nodes.map((node) => node.textContent?.trim()).filter(Boolean))).length, 6);
  // R@25 in the nine target languages, Node.js bruteforce (the README's figure), recomputed from bench.json.
  const r25 = TARGET_LANGUAGES.reduce((sum, code) => sum + node.bruteforce.recall.byLanguage[code]["@25"], 0) / TARGET_LANGUAGES.length;
  const r5nine = TARGET_LANGUAGES.reduce((sum, code) => sum + node.bruteforce.recall.byLanguage[code]["@5"], 0) / TARGET_LANGUAGES.length;
  // Each recall figure carries its scope: ~97% top 5 is German/English/Russian only; the nine-language figures follow.
  assert.ok(intro.includes(`top 5 for ~${Math.round(top3.reduce((a, b) => a + b) / 3)}% of German, English and Russian queries`), "R@5, three languages");
  assert.ok(intro.includes(`(${r5nine.toFixed(1)}% across all nine target languages)`), `R@5 nine languages ${r5nine}`);
  assert.ok(intro.includes(`top 25 for ${r25.toFixed(1)}%`), `R@25 ${r25}`);
  assert.ok(intro.includes(`< ${100} ms`) && bench.strategies.turboquant.queryMs.p95 < 100, "end-to-end p95 under 100 ms");
  assert.equal(await page.locator('#intro a[href="https://www.linkedin.com/in/aronhomberg/"]').count(), 1);
  // The flip line's figures come from the data: model files (manifest), index bytes, bench R@5 and p95 latency.
  const flips = (await page.$$eval(".vs-flip .text-rotate > span > span", (nodes) => nodes.map((node) => node.textContent))).map((text) => text?.replace(/\u00a0/g, " "));
  const modelMb = (Object.values(manifest.modelFiles) as number[]).reduce((a, b) => a + b, 0) / 1e6;
  // The wording is the author's; its figures must match the data (decimal comma or point alike).
  const flipText = flips.join(" | ").replace(/(\d),(\d)/g, "$1.$2");
  const per100 = (manifest.vectors.bytes / demo.passages.length * 100 / 1000).toFixed(1);
  assert.equal(flips.length, 6);
  for (const figure of ["< 100 ms", `~${Math.round(top3.reduce((a, b) => a + b) / 3)}% recall`, `${modelMb.toFixed(1)} MB model`, `~${per100} kB index for 100 docs`]) {
    assert.ok(flipText.includes(figure), `flip line lacks "${figure}": ${flipText}`);
  }

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
  // The index figure is the gzipped vector file the page itself downloads (docs/data/manifest.json).
  assert.deepEqual(figures, [`${bench.embedMs.query.p50} ms`, `${bench.strategies.turboquant.searchMs.p50} ms`,
    `${Math.round(manifest.vectors.bytes / 1000)} kB gzip`, `${bench.strategies.turboquant.recall.byLanguage.eng_Latn["@5"]}%`]);
  assert.match(await page.textContent('[data-bench="index-gzip"] .mk-stat-label') ?? "", new RegExp(`${(manifest.vectors.rawBytes / 1e6).toFixed(2)} MB raw`));
  assert.equal(await page.textContent("#bench .vs-footnote"), "* measured on an Apple MacBook Air M4 in a Chromium-based browser.");
  // Low recall outside the target languages is framed as the design it is, with the model page linked.
  assert.match(await visibleText(page, "#bench .mk-stats-desc"), /Winzling-Embed-a8m-64k is a pruned model .* low performance in non-target languages is by design\./);
  assert.equal(await page.locator('#bench .mk-stats-desc a[href="https://huggingface.co/kyr0/Winzling-Embed-a8m-64k"]').count(), 1);
  const recall = await page.$$eval("[data-recall] progress", (bars) => bars.map((bar) => [bar.id.replace("r5-bar-", ""), Number(bar.getAttribute("value"))]));
  // "Pruned" marks exactly the languages below 70% R@5.
  const pruned = await page.$$eval("[data-recall]", (rows) => rows.filter((row) => /Pruned/.test(row.querySelector(".progress-label")!.textContent ?? "")).map((row) => row.getAttribute("data-recall")));
  assert.deepEqual(pruned.sort(), Object.entries(bench.strategies.turboquant.recall.byLanguage)
    .filter(([, value]) => (value as Record<string, number>)["@5"]! < 70).map(([code]) => code).sort());
  assert.deepEqual(Object.fromEntries(recall), Object.fromEntries(Object.entries(bench.strategies.turboquant.recall.byLanguage)
    .map(([code, value]) => [code, (value as Record<string, number>)["@5"]])));

  // Typing alone never starts the 39.8 MB download; the Search button does, and the query waits for the model.
  const giza = "How tall are the pyramids of Giza?";
  await page.fill("#q", giza);
  await page.waitForTimeout(300);
  assert.equal(modelRequests.length, 0, "typing must not start the download");
  const started = Date.now();
  await page.click("#search-submit");
  await page.waitForSelector("#results .vs-skeleton");
  await ready(page);
  report.bootMs = Date.now() - started;
  for (const bar of ["#p-model", "#p-runtime", "#p-index", "#ring"]) assert.equal(await stateOf(page, bar), "complete", bar);
  assert.match(await page.textContent("#boot-status") ?? "", /^Ready in .* WASM/);
  assert.equal(await page.textContent('[data-stat="passages"]'), "2,000");
  assert.equal(await page.locator('#boot-start use[href="#i-reload"]').count(), 1, "Reload the model carries a reload icon");
  assert.deepEqual(modelRequests.sort(), ["onnx/model_uint4.onnx", "tokenizer.json", "tokenizer_config.json"]);
  await summaryFor(page, giza);
  let top = await hits(page);
  assert.equal(top.length, 12);
  assert.deepEqual(top.map((hit) => hit.score), top.map((hit) => hit.score).sort((a, b) => b - a), "results are ordered by score");
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
  // VERIFIED (bench.json): English R@5 is 100% for Winzling + TurboQuant in Chromium, so the gold passage is in the top 5.
  const exact = top.findIndex((hit) => hit.gold === "exact");
  assert.ok(exact >= 0 && exact < 5, `gold passage rank ${exact + 1}`);
  assert.match(await page.textContent("#summary-gold") ?? "", /Gold answer at #\d/);
  assert.match(await page.textContent("#summary-time") ?? "", /^embed [\d.]+ ms · scan [\d.]+ ms \| strategy: TurboQuant$/);
  // The gold badge sits in a gold aura at the end of its card header; the first card alone wears an aura frame.
  const gold = await page.$eval('#results .vs-hit[data-gold="exact"]', (hit) => {
    const badge = hit.querySelector(".aura-gold .badge")!.getBoundingClientRect();
    return { text: hit.querySelector(".aura-gold .badge")!.textContent, gap: hit.querySelector(".card-header")!.getBoundingClientRect().right - badge.right };
  });
  assert.equal(gold.text, "Gold");
  assert.ok(gold.gap < 40, `gold badge ${gold.gap}px from the header's end`);
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
  await page.click('#demo .mk-section-header [data-tab="1"]'); // the "My data (custom)" link in the intro opens the tab
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
  await page.waitForFunction(() => document.querySelector(".vs-notes-search .vs-summary-query")?.textContent === "A sleeping cat on a couch"
    && !document.querySelector("#notes-results")!.hasAttribute("aria-busy"));
  const noteTitles = () => page.$$eval("#notes-results .card-title", (nodes) => nodes.map((node) => node.textContent));
  assert.deepEqual((await noteTitles()).slice(0, 2).sort(), ["Note 1", "Note 3"], "both cat notes, across languages, rank first");
  assert.equal(await page.locator("#notes-results .vs-hit:first-child > .aura").count(), 1);
  assert.match(await page.textContent("#notes-summary .mk-search-summary-time") ?? "", /\| strategy: TurboQuant$/);
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
  assert.ok(Math.abs(afterY - pageY) < 2, `adding notes does not move the page: ${pageY} → ${afterY}`);
  // The border layout's divider resizes the notes board from the keyboard.
  const boardWidth = () => page.$eval(".vs-board", (node) => node.getBoundingClientRect().width);
  const widthBefore = await boardWidth();
  await page.focus("#notes-layout > .resizer > .resizer-handle");
  await page.keyboard.press("ArrowRight");
  assert.ok(Math.abs((await boardWidth()) - widthBefore - 10) < 2, `board ${widthBefore} → ${await boardWidth()}`);
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

  // Once ready, the hero's "Try it now! (Live)" link still only scrolls to the demo: no second load.
  const loads = await page.locator("#log pre", { hasText: "load · device=" }).count();
  await page.click("#try-live");
  assert.equal(await page.locator("#log pre", { hasText: "load · device=" }).count(), loads);
  assert.equal(await page.inputValue("#q"), "Sternwarte zqx");

  // The worker log (a collapsible) holds the boot transcript.
  await page.click("#log-panel summary");
  assert.ok(await page.$eval("#log-panel", (details) => (details as HTMLDetailsElement).open));
  await page.locator("#log").waitFor({ state: "visible" }); // the panel animates open
  assert.ok(await page.locator("#log pre", { hasText: "SHA-256 verified" }).count() >= 1);

  // Clear → the CTA with example queries; an example runs a search again.
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
  await page.click(".mk-header .swap");
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), !dark);

  // The palette lists example queries only, no actions.
  await page.keyboard.press("ControlOrMeta+k");
  assert.equal(await page.locator("#cmd .command-item:not([data-query])").count(), 0);
  await page.keyboard.press("Escape");

  // Backend switch: WebGPU, or WASM with a notice where no adapter exists. The model comes from cache.
  await page.selectOption("#backend", "webgpu");
  await page.waitForFunction(() => (document.querySelector("#boot-status")?.textContent ?? "").startsWith("Ready in"), null, { timeout: 120_000 });
  report.webgpu = { device: await page.textContent('[data-stat="device"]'), notice: await page.locator("#boot-notice").isVisible() };
  assert.ok(report.webgpu && ((report.webgpu as { device: string }).device === "WebGPU" || (report.webgpu as { notice: boolean }).notice));
  assert.equal(modelRequests.length, 3, "a backend switch reads the model from the Cache API");

  // Reload: the cached model loads by itself.
  await page.reload();
  await ready(page);
  assert.equal(modelRequests.length, 3, "a reload reads the model from the Cache API");
  assert.match(await page.textContent('[data-stat="source"]') ?? "", /cache/);

  // Clearing the cache: the next load would download again.
  await page.click("#clear-cache");
  await page.waitForFunction(() => /model cache cleared/.test(document.querySelector("#log")!.textContent ?? ""));
  await context.close();

  // A failed index (the page-load download) shows the error; Retry fetches the index again and nothing else.
  const noIndex = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await prepare(noIndex);
  let indexDown = true;
  await noIndex.route(`${origin}/data/vectors.bin.gz`, (route) => (indexDown ? route.fulfill({ status: 500, body: "down" }) : route.fallback()));
  const indexPage = await noIndex.newPage();
  const indexErrors: string[] = [];
  indexPage.on("pageerror", (error) => indexErrors.push(error.message));
  const modelBefore = modelRequests.length;
  await indexPage.goto(`${origin}/`);
  await indexPage.waitForSelector("#boot-error:not([hidden])");
  assert.equal(await indexPage.textContent("#boot-error-title"), "Loading failed");
  assert.match(await indexPage.textContent("#boot-error-text") ?? "", /vectors\.bin\.gz: HTTP 500/);
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
  await flaky.route("https://huggingface.co/**/tokenizer.json", (route) => (failing ? route.fulfill({ status: 500, body: "down" }) : route.fallback()));
  const broken = await flaky.newPage();
  const brokenErrors: string[] = [];
  broken.on("pageerror", (error) => brokenErrors.push(error.message));
  await broken.goto(`${origin}/`);
  await broken.waitForFunction(() => /not cached yet/.test(document.querySelector("#log")!.textContent ?? ""));
  await broken.click("#boot-start");
  await broken.waitForSelector("#boot-error:not([hidden])");
  assert.match(await broken.textContent("#boot-error-text") ?? "", /tokenizer\.json: HTTP 500/);
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

  Object.assign(report, { modelRequests, problems });
  assert.deepEqual(problems, []);
  console.log(`${new Date().toISOString()} INFO docs demo passed boot_ms=${report.bootMs} webgpu=${JSON.stringify(report.webgpu)}`);
} finally {
  await mkdir("output", { recursive: true });
  await writeFile("output/docs-demo.json", `${JSON.stringify({ ...report, problems }, null, 2)}\n`);
  await browser.close();
  server.close();
}
