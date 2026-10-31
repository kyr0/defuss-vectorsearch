/**
 * The website's recall card (docs/index.html, `#bench`), rendered from bench.json. Pure: `write-bench.ts` writes it
 * between the bench-card markers, so `make bench` regenerates it with the README section.
 * Why generated markup over a script that fetches bench.json: the page stays plain files whose figures read without
 * JavaScript. VERIFIED: scripts/test-docs.ts compares every bar of every tab with bench.json.
 */
import { TARGET_LANGUAGES } from "../bench/dataset.ts";
import type { BenchReport } from "../bench/report.ts";

export const CARD_START = "<!-- bench-card:start -->";
export const CARD_END = "<!-- bench-card:end -->";
/** One tab per k; R@5 opens first because the page's other recall figures are R@5. VERIFIED: defuss-shadcn 0.9.7 tabs open the tab marked aria-selected (scripts/test-docs.ts). */
export const CARD_KS = [1, 5, 10, 25] as const;
export const CARD_DEFAULT_K = 5;
/** A language other than the nine targets below this R@5 wears the "Pruned" badge. VERIFIED: the card's description states the same rule. */
export const PRUNED_BELOW = 70;

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

export const renderRecallCard = (report: BenchReport): string => {
  const recall = report.environments.chromium.models.winzling.strategies.fused.recall.byLanguage;
  const targets = new Set<string>(TARGET_LANGUAGES);
  const at = (code: string, k: number) => {
    const value = recall[code]?.[`@${k}` as `@${1 | 3 | 5 | 10 | 25 | 100}`];
    if (typeof value !== "number") throw new Error(`bench.json lacks fused R@${k} for ${code}`);
    return value;
  };
  // Targets first, then the rest, each best first by R@5; ties keep bench.json's language order. One order for all
  // tabs, so a bar keeps its place when the tab changes.
  const codes = report.dataset.languages
    .map((code, position) => ({ code, position }))
    .sort((a, b) => Number(targets.has(b.code)) - Number(targets.has(a.code)) || at(b.code, CARD_DEFAULT_K) - at(a.code, CARD_DEFAULT_K) || a.position - b.position)
    .map(({ code }) => code);
  const badge = (code: string) => targets.has(code)
    ? ` <span class="badge" data-variant="outline" data-size="xs">target</span>`
    : at(code, CARD_DEFAULT_K) < PRUNED_BELOW ? ` <span class="badge" data-variant="secondary" data-size="xs">Pruned</span>` : "";
  const perLanguage = report.dataset.queries / report.dataset.languages.length;
  const tab = (k: number) => {
    const selected = k === CARD_DEFAULT_K;
    return `            <button class="tab-trigger" role="tab" aria-selected="${selected}" aria-controls="recall-panel-${k}" id="recall-tab-${k}"${selected ? "" : ` tabindex="-1"`}>R@${k}</button>`;
  };
  const row = (k: number, code: string) => `              <div class="progress-field" data-recall="${code}">
                <div class="progress-header"><span class="progress-label" id="r${k}-${code}">${name(code)}${badge(code)}</span><output class="progress-value" for="r${k}-bar-${code}" data-template="{value}%"></output></div>
                <progress class="progress" id="r${k}-bar-${code}" data-size="xs" data-tone="auto" value="${at(code, k)}" max="100" aria-labelledby="r${k}-${code}"></progress>
              </div>`;
  const panel = (k: number) => `            <div class="tab-content vs-recall-list" role="tabpanel" id="recall-panel-${k}" aria-labelledby="recall-tab-${k}" tabindex="0"${k === CARD_DEFAULT_K ? "" : " hidden"}>
${codes.map((code) => row(k, code)).join("\n")}
            </div>`;
  return `        <figure class="mk-stats-media card vs-recall">
          <figcaption class="card-header"><h3 class="card-title">Recall by query language</h3><p class="card-description">R@k: share of a language's ${perLanguage} questions whose gold passage ranks in the top k of ${report.dataset.haystack.toLocaleString("en")}. Chromium, TurboQuant + MoEdernColBERT, the demo's default; reranking reorders the top 25, so R@25 is TurboQuant's own. Target: the nine languages Winzling is built for. Pruned: below ${PRUNED_BELOW}% R@5.</p></figcaption>
          <div class="card-content tabs vs-recall-tabs">
            <div class="tab-list" role="tablist" aria-label="Recall at k" id="recall-tabs">
${CARD_KS.map(tab).join("\n")}
            </div>
${CARD_KS.map(panel).join("\n")}
          </div>
        </figure>`;
};
