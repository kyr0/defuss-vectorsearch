// One search panel - a search box with a Search button, a summary, a CTA and an ordered results grid - bound to one
// index in the worker ("bench" or "notes"). Both tabs use it, so both search the same way and animate the same way.
// Why a factory over two copies: the stale-result checks, the transition queue and the before-the-model path are the
// subtle parts; one implementation keeps them identical (VERIFIED: scripts/test-docs.ts drives both tabs).
import { formatMs, renderSkeletons } from "./render.js";

const motion = matchMedia("(prefers-reduced-motion: reduce)");

/**
 * @param {object} options
 * @param {"bench" | "notes"} options.index  the worker index this panel asks
 * @param {HTMLElement} options.root        holds .search-box, form[role=search], .mk-search-summary, .mk-empty-state, .vs-results
 * @param {Worker} options.worker
 * @param {() => boolean} options.isReady    the model is loaded
 * @param {() => void} options.needModel     start loading the model (a query is waiting)
 * @param {(data) => string} options.render  results markup
 * @param {(data) => string} options.count   "Top 12 of 2,000 passages"
 * @param {(data) => string} [options.note]  an extra summary badge, "" for none
 * @param {(text: string) => void} [options.onInput]
 * @param {(data) => void} [options.onShown] after results render
 */
export const createSearchView = ({ index, root, worker, isReady, needModel, render, count, note = () => "", onInput = () => {}, onShown = () => {} }) => {
  const box = root.querySelector(".search-box");
  const q = box.querySelector('input[type="search"]');
  const form = root.querySelector('form[role="search"]');
  const results = root.querySelector(".vs-results");
  const summary = root.querySelector(".mk-search-summary");
  const empty = root.querySelector(".mk-empty-state");
  const badge = summary.querySelector(".vs-summary-note");
  let searchId = 0;
  let debounce = 0;
  let pendingText = null;
  let transition = null;
  let queued = null;

  const search = (text) => {
    clearTimeout(debounce);
    searchId += 1;
    results.setAttribute("aria-busy", "true");
    box.api.setState("searching");
    worker.postMessage({ type: "search", index, id: searchId, query: text, k: 12 });
  };

  const showEmpty = () => {
    searchId += 1; // drop results still in flight, and a re-rank still waiting for its transition
    queued = null;
    results.removeAttribute("aria-busy");
    summary.hidden = true;
    globalThis.df$(results).morph("");
    empty.hidden = false;
  };

  q.addEventListener("input", () => {
    clearTimeout(debounce);
    const text = q.value.trim();
    onInput(text);
    if (!text) { showEmpty(); return; }
    if (!isReady()) return; // typing alone never starts the 39.8 MB download; Search does
    empty.hidden = true;
    results.setAttribute("aria-busy", "true");
    box.api.setState("searching");
    debounce = setTimeout(() => search(text), 90);
  });

  /** Runs a query now: into the box (which fires `input`), then straight to the worker; before the model, it waits. */
  const ask = (text) => {
    if (q.value !== text) box.api.setState("filled", { value: text });
    if (isReady()) { search(text); return; }
    pendingText = text;
    empty.hidden = true;
    summary.hidden = true;
    globalThis.df$(results).morph(renderSkeletons(6));
    needModel();
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = q.value.trim();
    if (text) ask(text);
    else q.focus();
  });
  summary.querySelector(".mk-search-summary-clear").addEventListener("click", (event) => {
    event.preventDefault();
    box.api.setState("default");
    q.focus();
  });

  const show = () => {
    const data = queued;
    queued = null;
    const update = () => {
      if (data.id !== searchId) return; // cleared, or a newer query was sent while this one waited
      globalThis.df$(results).morph(render(data));
      results.removeAttribute("aria-busy");
      summary.querySelector(".vs-summary-count").textContent = count(data);
      summary.querySelector(".vs-summary-query").textContent = data.query;
      const extra = note(data);
      badge.hidden = !extra;
      badge.textContent = extra;
      summary.querySelector(".mk-search-summary-time").textContent = `embed ${formatMs(data.embedMs)} · scan ${formatMs(data.scanMs)} | strategy: ${data.strategy}`;
      summary.hidden = false;
      empty.hidden = true;
      onShown(data);
    };
    if (!document.startViewTransition || motion.matches) { update(); return; }
    // One re-rank animates at a time; results that arrive meanwhile wait and the newest one wins.
    transition = document.startViewTransition(update);
    transition.finished.finally(() => { transition = null; if (queued) show(); });
  };

  return {
    ask,
    /** The model is ready: run the query that waited for it, or the one in the box. */
    resume: () => {
      const text = pendingText ?? q.value.trim();
      pendingText = null;
      if (text) ask(text);
    },
    /** Re-run the current query (the index changed under it); quiet when the box is empty. */
    refresh: () => { const text = q.value.trim(); if (text && isReady()) search(text); },
    onResults: (data) => {
      if (data.id !== searchId) return; // a newer query is on its way
      box.api.setState("filled");
      queued = data;
      if (!transition) show();
    },
    onError: () => {
      pendingText = null;
      results.removeAttribute("aria-busy");
      if (results.querySelector(".vs-skeleton")) showEmpty();
      if (box.api.getState().name === "searching") box.api.setState("filled");
    },
  };
};
