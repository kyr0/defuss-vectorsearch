/**
 * The website's recall card (docs/index.html, `#bench`), rendered from bench.json. Pure: `write-bench.ts` writes it
 * between the bench-card markers, so `make bench` regenerates it with the README section.
 * Why generated markup over a script that fetches bench.json: the page stays plain files whose figures read without
 * JavaScript. VERIFIED: scripts/test-docs.ts compares every bar of every tab with bench.json.
 * A switch right of each panel's k tabs, on by default, shows only the target languages (human request,
 * 2026-11-09); CSS `:has()` applies it per panel, and docs/assets/demo.js keeps the three switches in step. Two tab bars: the outer one picks the demo mode (the reranker alone, the embedder alone, both fused), each mode's
 * panel holds its own R@k tabs. Why nested tabs over one bar that switches a grid by script: defuss-shadcn tabs switch
 * panels by `aria-controls` id (0.9.13), so the card stays static markup.
 */
import { TARGET_LANGUAGES } from "../bench/dataset.ts";
import { targetRecall, type BenchReport } from "../bench/report.ts";

export const CARD_START = "<!-- bench-card:start -->";
export const CARD_END = "<!-- bench-card:end -->";
/**
 * One tab per k, from R@25 down to R@1 (human request, 2026-11-09); R@25 opens first, so the card's Fused average
 * matches the hero's "99% recall R@25" (human request, 2026-11-09). VERIFIED: defuss-shadcn 0.9.13 tabs open the tab marked
 * aria-selected (scripts/test-docs.ts).
 */
export const CARD_KS = [25, 10, 5, 1] as const;
export const CARD_DEFAULT_K = 25;
/** A language other than the targets below this R@5 fused wears the "Pruned" badge. VERIFIED: the card's description states the same rule. */
export const PRUNED_BELOW = 70;
const PRUNED_K = 5;

/**
 * The demo's modes (examples/search-worker.ts `Mode`), ordered Fused, Embedder, Reranker with their model downloads
 * (human request, 2026-11-09); Fused opens first, with R@25, to match the hero (human request, 2026-11-09). All
 * Chromium, like the demo.
 */
export const CARD_MODES = [
  { key: "both", label: "Fused", recall: (report: BenchReport) => report.environments.chromium.models.winzling.strategies.fused.recall },
  { key: "embedder", label: "Embedder", recall: (report: BenchReport) => report.environments.chromium.models.winzling.strategies.turboquant.recall },
  { key: "reranker", label: "Reranker", recall: (report: BenchReport) => report.environments.chromium.reranker.maxsim.recall },
] as const;
/** Each mode's model download in bytes (docs/data/manifest.json, `.br` files), shown under the mode tabs. */
export type CardDownloads = Record<(typeof CARD_MODES)[number]["key"], number>;
export const CARD_DEFAULT_MODE = "both";

const NAMES: Record<string, string> = {
  eng_Latn: "English", deu_Latn: "German", rus_Cyrl: "Russian", fra_Latn: "French", ind_Latn: "Indonesian",
  por_Latn: "Portuguese", ita_Latn: "Italian", nld_Latn: "Dutch", spa_Latn: "Spanish", pol_Latn: "Polish",
  tur_Latn: "Turkish", vie_Latn: "Vietnamese", kor_Hang: "Korean", jpn_Jpan: "Japanese", zho_Hans: "Chinese",
  tha_Thai: "Thai", urd_Arab: "Urdu", hin_Deva: "Hindi", ben_Beng: "Bangla", arb_Arab: "Arabic",
};

const name = (code: string): string => {
  const value = NAMES[code];
  if (value === undefined) throw new Error(`bench-card has no name for language ${code}`);
  return value;
};

type Mode = (typeof CARD_MODES)[number];

const megabytes = (bytes: number) => `${(bytes / 1e6).toFixed(bytes >= 1e7 ? 1 : 2)} MB`;

export const renderRecallCard = (report: BenchReport, downloads: CardDownloads): string => {
  const targets = new Set<string>(TARGET_LANGUAGES);
  const at = (mode: Mode, code: string, k: number) => {
    const value = mode.recall(report).byLanguage[code]?.[`@${k}` as `@${1 | 3 | 5 | 10 | 25 | 100}`];
    if (typeof value !== "number") throw new Error(`bench.json lacks ${mode.key} R@${k} for ${code}`);
    return value;
  };
  const opened = CARD_MODES.find((mode) => mode.key === CARD_DEFAULT_MODE)!;
  const both = CARD_MODES.find((mode) => mode.key === "both")!;
  // Each list best first by its own figure (human request, 2026-11-09); ties keep bench.json's language order.
  const codesBy = (mode: Mode, k: number) => report.dataset.languages
    .map((code, position) => ({ code, position }))
    .sort((a, b) => at(mode, b.code, k) - at(mode, a.code, k) || a.position - b.position)
    .map(({ code }) => code);
  const badge = (code: string) => targets.has(code)
    ? ` <span class="badge" data-variant="outline" data-size="xs">target</span>`
    : at(both, code, PRUNED_K) < PRUNED_BELOW ? ` <span class="badge" data-variant="secondary" data-size="xs">Pruned</span>` : "";
  const perLanguage = report.dataset.queries / report.dataset.languages.length;
  const tab = (id: string, controls: string, label: string, selected: boolean) =>
    `<button class="tab-trigger" role="tab" aria-selected="${selected}" aria-controls="${controls}" id="${id}"${selected ? "" : ` tabindex="-1"`}>${label}</button>`;
  const row = (mode: Mode, k: number, code: string) => `                <div class="progress-field" data-recall="${code}"${targets.has(code) ? " data-target" : ""}>
                  <div class="progress-header"><span class="progress-label" id="r${k}-${mode.key}-${code}">${name(code)}${badge(code)}</span><output class="progress-value" for="r${k}-${mode.key}-bar-${code}" data-template="{value}%"></output></div>
                  <progress class="progress" id="r${k}-${mode.key}-bar-${code}" data-size="xs" data-tone="auto" value="${at(mode, code, k)}" max="100" aria-labelledby="r${k}-${mode.key}-${code}"></progress>
                </div>`;
  // The target languages' mean, the figure the page's mode tabs show as "Quality" (R@10).
  const average = (mode: Mode, k: number) => `                <div class="progress-field vs-recall-average" data-recall-average>
                  <div class="progress-header"><span class="progress-label" id="r${k}-${mode.key}-average">Average <span class="badge" data-variant="outline" data-size="xs">${TARGET_LANGUAGES.length} target languages</span></span><output class="progress-value" for="r${k}-${mode.key}-bar-average" data-template="{value}%"></output></div>
                  <progress class="progress" id="r${k}-${mode.key}-bar-average" data-size="sm" data-tone="auto" value="${targetRecall(mode.recall(report), TARGET_LANGUAGES)[`@${k}` as `@${1 | 3 | 5 | 10 | 25 | 100}`]}" max="100" aria-labelledby="r${k}-${mode.key}-average"></progress>
                </div>
                <hr class="separator vs-recall-divider">`;
  const kPanel = (mode: Mode, k: number) => `              <div class="tab-content vs-recall-list" role="tabpanel" id="recall-panel-${mode.key}-${k}" aria-labelledby="recall-tab-${mode.key}-${k}" tabindex="0"${k === CARD_DEFAULT_K ? "" : " hidden"}>
${average(mode, k)}
${codesBy(mode, k).map((code) => row(mode, k, code)).join("\n")}
              </div>`;
  const modePanel = (mode: Mode) => `            <div class="tab-content tabs vs-recall-tabs" role="tabpanel" id="recall-mode-panel-${mode.key}" aria-labelledby="recall-mode-tab-${mode.key}"${mode === opened ? "" : " hidden"}>
              <p class="vs-recall-download">Download size: <strong>${megabytes(downloads[mode.key])}</strong></p>
              <div class="vs-recall-bar">
                <div class="tab-list" role="tablist" aria-label="Recall at k, ${mode.label}" id="recall-tabs-${mode.key}">
${CARD_KS.map((k) => `                  ${tab(`recall-tab-${mode.key}-${k}`, `recall-panel-${mode.key}-${k}`, `R@${k}`, k === CARD_DEFAULT_K)}`).join("\n")}
                </div>
                <div class="switch-item vs-recall-filter"><input class="switch" type="checkbox" role="switch" id="recall-targets-${mode.key}" data-size="sm" checked><label for="recall-targets-${mode.key}">Target languages only</label></div>
              </div>
${CARD_KS.map((k) => kPanel(mode, k)).join("\n")}
            </div>`;
  return `        <figure class="mk-stats-media card vs-recall">
          <figcaption class="card-header"><h3 class="card-title">Recall by query language</h3><p class="card-description">Share of each language's ${perLanguage} questions whose gold passage ranks in the top k of ${report.dataset.haystack.toLocaleString("en")}, in Chromium. Pruned: below ${PRUNED_BELOW}% R@5, fused.</p></figcaption>
          <div class="card-content tabs vs-recall-modes">
            <div class="tab-list" role="tablist" aria-label="Models" id="recall-modes">
${CARD_MODES.map((mode) => `              ${tab(`recall-mode-tab-${mode.key}`, `recall-mode-panel-${mode.key}`, mode.label, mode === opened)}`).join("\n")}
            </div>
${CARD_MODES.map(modePanel).join("\n")}
          </div>
        </figure>`;
};
