/**
 * `make bench` step: writes the website's recall card from bench.json into docs/index.html (scripts/docs/bench-card.ts)
 * and the README's benchmark section (scripts/bench/report.ts). VERIFIED: as its own step it regenerates both from an
 * existing bench.json without rerunning the bench (2026-10-31; the README since 2026-11-09), so a change of
 * TARGET_LANGUAGES needs no new run: bench.json keeps per-language results for all 20 languages.
 */
import { readFile, writeFile } from "node:fs/promises";
import { renderReadmeSection, replaceMarkedSection, replaceReadmeSection, type BenchReport } from "../bench/report.ts";
import { CARD_END, CARD_START, renderRecallCard } from "./bench-card.ts";
import type { DemoManifest } from "./write-index.ts";

const report = JSON.parse(await readFile("bench.json", "utf8")) as BenchReport;
// The recall card states each mode's model download under its tabs, from the manifest the page's worker reads (scripts/docs/write-index.ts).
const manifest = JSON.parse(await readFile("docs/data/manifest.json", "utf8")) as DemoManifest;
const sum = (files: Record<string, { bytes: number }>) => Object.values(files).reduce((total, file) => total + file.bytes, 0);
const downloads = { reranker: sum(manifest.rerankerFiles), embedder: sum(manifest.modelFiles), both: sum(manifest.rerankerFiles) + sum(manifest.modelFiles) };
const page = await readFile("docs/index.html", "utf8");
await writeFile("docs/index.html", replaceMarkedSection(page, renderRecallCard(report, downloads), CARD_START, CARD_END, "docs/index.html"));
await writeFile("README.md", replaceReadmeSection(await readFile("README.md", "utf8"), renderReadmeSection(report)));
console.log(`${new Date().toISOString()} INFO wrote the recall card into docs/index.html and the README benchmark section`);
