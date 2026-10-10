// Pure markup builders for the demo: data in, defuss-shadcn markup out. No DOM, no state.
// Why HTML strings + df$.morph instead of building nodes: morph matches the cards by id and moves them, so a re-rank
// keeps each card's node and its view-transition name (VERIFIED: defuss-shadcn DOM Querying guide, keyed morph moves
// matched nodes). Every interpolated text goes through escape(); passages and queries are third-party dataset text.
const names = new Intl.DisplayNames(["en"], { type: "language" });

const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** "deu_Latn" → "German"; the bench codes are ISO 639-3 + script, which BCP 47 accepts as "deu-Latn". */
export const languageName = (code) => names.of(code.split("_")[0]) ?? code;
export const languageTag = (code) => code.replace("_", "-");

export const formatMs = (ms) => (ms < 10 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`);

/**
 * One result card per item, best first. The first card wears an aura (a light running around it); a gold mark shows
 * as a badge in a gold aura ring, at the end of the header: filled for the gold passage, secondary for a translation
 * of it. `key` is the card's identity across re-ranks.
 */
const renderCards = (items) => items.map((item, i) => {
  const score = Math.max(0, Math.min(1, item.score));
  const badge = item.mark
    ? `<span class="aura aura-gold aura-sm vs-gold" style="--shape-round:999px"><span class="badge"${item.mark === "translation" ? ` data-variant="secondary"` : ""} data-size="sm">${item.mark === "exact" ? "Gold" : "Gold · translation"}</span></span>`
    : "";
  const card = `<article class="card">
    <div class="card-header">
      <span class="vs-rank" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span>
      <div><h3 class="card-title">${escape(item.title)}</h3><p class="card-description">${escape(item.description)}</p></div>
      ${badge}
    </div>
    <div class="card-content"><p class="vs-hit-text"${item.lang ? ` lang="${item.lang}"` : ""}>${escape(item.text)}</p></div>
    <div class="card-footer">
      <progress class="progress" data-size="xs" value="${(score * 100).toFixed(1)}" max="100" aria-label="Similarity ${item.score.toFixed(3)}"></progress>
      <span class="vs-score">${item.score.toFixed(3)}</span>
    </div>
  </article>`;
  return `<li class="vs-hit" id="${item.key}" style="view-transition-name:${item.key}"${item.mark ? ` data-gold="${item.mark}"` : ""} data-df-entrance="up">
  ${i === 0 ? `<div class="aura vs-top" style="--shape-ink:var(--chart-2)">${card}</div>` : card}
</li>`;
}).join("");

/**
 * Bench hits as cards. `gold` marks the bench answer when the query came from the bench: "exact" for the gold passage
 * in the query's language, "translation" for the same passage in another language.
 */
export const renderHits = (hits, languages, gold) => renderCards(hits.map((hit) => {
  const code = languages[hit.language];
  return {
    key: `hit-${hit.row}`, score: hit.score, text: hit.text, lang: languageTag(code),
    title: languageName(code), description: `passage ${hit.group + 1} · ${code}`,
    mark: gold && hit.group === gold.group ? (hit.row === gold.row ? "exact" : "translation") : "",
  };
}));

/** Note hits as cards; `labels` maps a note id to its visible name ("Note 2"). */
export const renderNoteHits = (hits, labels) => renderCards(hits.map((hit) => ({
  key: `note-hit-${hit.id}`, score: hit.score, text: hit.text, title: labels.get(hit.id) ?? "Note", description: "your note", mark: "",
})));

/** A yellow note: a native textarea and a status line the board fills in. */
export const renderNote = (id, n, lang = "") => `<article class="vs-note" id="${id}" data-df-entrance="pop">
  <label class="vs-note-label" for="${id}-text">Note ${n}</label>
  <textarea class="textarea vs-note-text" id="${id}-text" rows="4" placeholder="Write anything, in any language…"${lang ? ` lang="${lang}"` : ""}></textarea>
  <p class="vs-note-status" role="status" aria-live="polite"><span class="vs-note-hint">Not embedded yet</span></p>
</article>`;

/** The status of one note; a fresh element each time, so its entrance animation plays on every change. */
export const renderNoteStatus = (state, detail = "") => ({
  waiting: `<span class="vs-note-hint">Waiting for the model…</span>`,
  embedding: `<svg class="spinner" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg><span class="vs-note-hint">Embedding…</span>`,
  embedded: `<span class="badge" data-variant="secondary" data-size="sm" data-df-entrance="pop">Embedded</span><span class="vs-note-time">${escape(detail)}</span>`,
  removed: `<span class="vs-note-hint">Empty: removed from the index</span>`,
  failed: `<span class="badge" data-variant="outline" data-size="sm">Failed</span><span class="vs-note-time">${escape(detail)}</span>`,
})[state];

/** The bench questions as palette groups, one per language, in the given language order. */
export const renderQueryGroups = (queries, languages, order) => order.map((language) => {
  const code = languages[language];
  const items = queries.map((query, i) => [query, i]).filter(([query]) => query.language === language)
    .map(([query, i]) => `<button class="command-item" data-query="${i}" lang="${languageTag(code)}">${escape(query.text)}</button>`).join("");
  return `<div class="command-group"><p class="command-group-heading">${escape(languageName(code))} · ${escape(code)}</p>${items}</div>`;
}).join("");

export const renderExampleButtons = (picks, queries) => picks.map((i) =>
  `<button type="button" class="btn" data-variant="outline" data-size="sm" data-query="${i}">${escape(queries[i].text)}</button>`).join("");

/** A worker log line as a terminal line; the newest one carries the cursor. */
export const renderLogLine = (tone, text) =>
  `<pre data-prefix="${tone === "success" ? "✓" : tone === "warning" ? "!" : tone === "destructive" ? "✗" : ">"}" data-tone="${tone}" data-cursor><code>${escape(text)}</code></pre>`;

/** Placeholder cards while the model loads for a query that is already waiting. */
export const renderSkeletons = (count) => Array.from({ length: count }, (_, i) => `<li class="vs-hit" id="skeleton-${i}"><div class="card vs-skeleton">
  <div class="skeleton" style="height:1rem;width:${35 + (i * 7) % 15}%"></div><div class="skeleton" style="height:.75rem;width:96%"></div>
  <div class="skeleton" style="height:.75rem;width:${82 + (i * 5) % 14}%"></div><div class="skeleton" style="height:.75rem;width:${55 + (i * 11) % 25}%"></div>
</div></li>`).join("");
