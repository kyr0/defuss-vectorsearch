/**
 * `make bench` step: writes the website's recall card from bench.json into docs/index.html (scripts/docs/bench-card.ts).
 * VERIFIED: as its own step it regenerates the card from an existing bench.json without rerunning the bench (2026-10-31).
 */
import { readFile, writeFile } from "node:fs/promises";
import { replaceMarkedSection, type BenchReport } from "../bench/report.ts";
import { CARD_END, CARD_START, renderRecallCard } from "./bench-card.ts";

const report = JSON.parse(await readFile("bench.json", "utf8")) as BenchReport;
const page = await readFile("docs/index.html", "utf8");
await writeFile("docs/index.html", replaceMarkedSection(page, renderRecallCard(report), CARD_START, CARD_END, "docs/index.html"));
console.log(`${new Date().toISOString()} INFO wrote the recall card into docs/index.html`);
