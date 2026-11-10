// The demo's glue: worker events -> defuss-shadcn State APIs; user input -> worker requests. The worker owns the model,
// the runtime and both indexes (examples/search-worker.ts); search-view.js runs a search panel, notes.js the notes
// board, render.js builds the markup.
// Why plain ES modules driving component State APIs instead of a framework app: the page is served as static files
// (docs/, no build step), and every visual state is a documented component state, so the e2e can read it back.
// VERIFIED: scripts/test-docs.ts reads progress/ring states through el.api.getState() and passes.
// The index loads on page load (730 kB as Brotli files, it carries the 1,000 example queries); the chosen mode's models only
// when the user searches, writes a note or asks for them, unless they are cached. Modes (#mode-tabs,
// examples/search-worker.ts): the reranker alone (default, 2.28 MB model + 8.5 MB prebuilt token vectors), the embedder
// alone (28.8 MB) or both (31.1 MB).
// VERIFIED: docs/data/manifest.json gives the figures: 412,159 + 317,838 index bytes; 2,280,426 reranker, 28,806,300
// embedder and 8,504,817 token-vector bytes, all as `.br`.
import { createNotesBoard } from "./notes.js";
import { renderExampleButtons, renderHits, renderLogLine, renderNoteHits, renderQueryGroups } from "./render.js";
import { createSearchView } from "./search-view.js";

/**
 * Each mode's names and its share of the ring per phase. The reranker alone spends most of its loading time on the
 * prebuilt token vectors (VERIFIED: 8,504,817 bytes against a 2,280,426-byte model, docs/data/manifest.json), the
 * others on the model download.
 */
const MODES = {
  reranker: { name: "kyr0/Winzling-reranker", label: "Model · kyr0/Winzling-reranker q8", models: 1, weights: { model: 0.2, runtime: 0.1, index: 0.1, tokens: 0.58 } },
  embedder: { name: "kyr0/Winzling-embed", label: "Model · kyr0/Winzling-embed uint4", models: 1, weights: { model: 0.78, runtime: 0.1, index: 0.1, tokens: 0 } },
  both: { name: "kyr0/Winzling-embed + kyr0/Winzling-reranker", label: "Models · kyr0/Winzling-embed uint4 + kyr0/Winzling-reranker q8", models: 2, weights: { model: 0.78, runtime: 0.1, index: 0.1, tokens: 0 } },
};
const $ = (id) => document.getElementById(id);
const el = {
  ring: $("ring"), model: $("p-model"), runtime: $("p-runtime"), index: $("p-index"), tokens: $("p-tokens"), reembed: $("p-reembed"), status: $("boot-status"),
  log: $("log"), backend: $("backend"), modes: $("mode-tabs"), examples: $("empty-examples"), cmd: $("cmd"), cmdList: $("cmd-list"),
  notice: $("boot-notice"), error: $("boot-error"), tabs: $("demo-tabs"),
  query: document.querySelector("#panel-bench .vs-query"),
};
// The theme switch first: it must work even if the demo below fails to start.
const theme = $("theme-toggle");
const setTheme = (dark) => {
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  theme.checked = dark;
  try { localStorage.setItem("defuss-shadcn-theme", JSON.stringify(dark ? "dark" : "light")); } catch {}
};
theme.checked = document.documentElement.classList.contains("dark");
theme.addEventListener("change", () => setTheme(theme.checked));
// The recall card has a "Target languages only" switch in each mode panel; they act as one.
const targetSwitches = document.querySelectorAll(".vs-recall-filter .switch");
for (const input of targetSwitches) input.addEventListener("change", () => { for (const other of targetSwitches) other.checked = input.checked; });
const cmdInput = el.cmd.querySelector(".command-input");
const motion = matchMedia("(prefers-reduced-motion: reduce)");
const worker = new Worker(new URL("./search-worker.js", import.meta.url), { type: "module" });
const manifestUrl = new URL("../data/manifest.json", import.meta.url).href;

/** The mode tab that is selected, and its mode. */
const modeTab = () => el.modes.querySelector('[role="tab"][aria-selected="true"]');
const chosenMode = () => modeTab().dataset.mode;
const state = {
  phase: "idle", queries: [], languages: [], passages: 0, bench: null, mode: chosenMode(),
  /** Finished model loads on this page; the first one gets no toast. */
  loads: 0,
  /** The backend the visitor chose; the reranker alone shows WASM without forgetting it. */
  device: el.backend.value,
  /** Each mode's model download in `.br` bytes, from the worker's `indexed` (the manifest); null until then. */
  downloads: null,
  /** The prebuilt token vectors' `.br` bytes, which the reranker alone also downloads; null until `indexed`. */
  tokenBytes: null,
  progress: { model: [0, 1], index: [0, 1], tokens: [0, 1], runtime: 0, warmup: 0 },
};
const isReady = () => state.phase === "ready";
/** One unit style for every size on the page: kB for the index files that cross the network as Brotli, MB with two decimals otherwise. */
const kb = (bytes) => `${Math.round(bytes / 1e3)} kB`;
const mb = (bytes) => `${(bytes / 1e6).toFixed(bytes >= 1e7 ? 1 : 2)} MB`;
/** A mode's model download, models only (human request, 2026-11-10: a size beside a model name is that model's); before
 *  the manifest arrives, the size its tab names. The reranker's token vectors have their own bar and size. */
const downloadOf = (mode = chosenMode()) => (state.downloads ? mb(state.downloads[mode]) : $(`mode-tab-${mode}`).querySelector(".vs-mode-size").textContent);
/** What a load transfers, for messages about the whole load: the models, plus the token vectors for the reranker alone. */
const transferOf = (mode = chosenMode()) => (mode === "reranker" && state.tokenBytes ? `${downloadOf(mode)} + ${mb(state.tokenBytes)} token vectors` : downloadOf(mode));
/** The mode tabs stay put while a load runs; defuss-shadcn's "active" state enables them again on the chosen tab. */
const lockModes = (locked) => (locked ? el.modes.api.setState("disabled") : el.modes.api.setState("active", { id: modeTab().id }));

// ---- boot: bars, ring and log ------------------------------------------------------------------------------------
let frame = 0;
const paint = () => {
  frame = 0;
  const { model, index, tokens, runtime, warmup } = state.progress;
  // Bars count bytes; the readout names the real total (the manifest's exact size), so it can never drift.
  const bytes = (bar, [loaded, total]) => {
    if (total <= 1) return; // no size reported yet
    document.querySelector(`output[for="${bar.id}"]`).dataset.template = bar === el.index ? `{percent} of ${kb(total)} (Brotli)` : `{percent} of ${mb(total)}`;
    bar.api.setState("default", { value: loaded, max: total });
  };
  bytes(el.model, model);
  bytes(el.index, index);
  if (tokens[1] > 1) el.tokens.api.setState("default", { value: tokens[0], max: tokens[1] });
  const weights = MODES[state.mode].weights;
  const overall = weights.model * model[0] / model[1] + weights.runtime * runtime + weights.index * index[0] / index[1] + weights.tokens * tokens[0] / tokens[1] + 0.02 * warmup;
  el.ring.api.setState("default", { value: Math.min(100, Math.round(overall * 100)) });
  for (const bar of [el.model, el.index, el.tokens, el.reembed]) {
    const done = bar.api.getState().name === "complete";
    bar.toggleAttribute("data-striped", !done && (bar === el.index || state.phase === "loading"));
    if (done) bar.dataset.tone = "success";
  }
};
const schedule = () => { frame ||= requestAnimationFrame(paint); };
const caption = (text) => { el.ring.querySelector(".radial-progress-caption").textContent = text; };

const log = (tone, text) => {
  for (const line of el.log.querySelectorAll("pre[data-cursor]")) line.removeAttribute("data-cursor");
  el.log.insertAdjacentHTML("beforeend", renderLogLine(tone, text));
  while (el.log.children.length > 80) el.log.firstElementChild.remove();
  el.log.scrollTop = el.log.scrollHeight;
};

/**
 * The chosen mode's labels: model bar, load button, RAM hint; the token-vector bar only for the reranker alone, and
 * the backend only where Winzling runs (the reranker always runs on WASM).
 */
const showMode = () => {
  const mode = MODES[chosenMode()];
  $("p-model-name").textContent = mode.label;
  if (state.downloads) for (const tab of el.modes.querySelectorAll('[role="tab"]')) tab.querySelector(".vs-mode-size").textContent = downloadOf(tab.dataset.mode);
  document.querySelector('output[for="p-model"]').dataset.template = `{percent} of ${downloadOf()}`;
  $("p-tokens-field").hidden = chosenMode() !== "reranker";
  // The reranker runs on WASM only (createColbertReranker has no WebGPU device): the select says so and keeps the
  // visitor's choice for the other modes.
  if (chosenMode() === "reranker") {
    if (!el.backend.disabled) state.device = el.backend.value;
    el.backend.value = "wasm";
    el.backend.disabled = true;
  } else if (el.backend.disabled) {
    el.backend.disabled = false;
    el.backend.value = state.device;
  }
  const ram = modeTab().dataset.ram;
  $("p-runtime-hint").textContent = `~${ram} MB RAM reserved for ${mode.models === 1 ? "the model" : "models"}, runtime and index (measured in Chromium)`;
  if (state.phase !== "ready") $("boot-start").textContent = `Load the ${mode.models === 1 ? "model" : "models"} · ${downloadOf()}`;
};

/**
 * Outcomes the visitor should notice go to defuss-shadcn success toasts at the top right (human request, 2026-11-09);
 * #boot-status keeps the latest status as text, unrendered, for the e2e. Progress itself stays in the bars.
 */
const toast = (kind, title, description) => globalThis.df$?.shadcn?.toast?.[kind]?.({ title, description });
globalThis.df$?.shadcn?.toast?.configure({ position: "top-right" });

/** Model, token vectors and runtime start over; a loaded index stays loaded. */
const resetBoot = () => {
  state.progress = { ...state.progress, model: [0, 1], tokens: [0, 1], runtime: 0, warmup: 0 };
  for (const bar of [el.model, el.runtime, el.tokens]) { bar.removeAttribute("data-tone"); bar.api.setState("default", { value: 0 }); }
  el.ring.removeAttribute("data-tone");
  el.notice.hidden = true;
  el.error.hidden = true;
  caption("model");
  schedule();
};

const boot = (device = el.backend.value) => {
  if (state.phase === "loading") return;
  state.phase = "loading";
  state.mode = chosenMode();
  el.backend.value = device;
  const wasm = state.mode === "reranker" || device !== "webgpu";
  el.status.textContent = `Loading ${MODES[state.mode].name} for ${wasm ? "WASM" : "WebGPU"}...`;
  $("reembed").disabled = true;
  for (const button of document.querySelectorAll("button[data-boot]")) button.disabled = true;
  lockModes(true);
  resetBoot();
  log("info", `load · mode=${state.mode} · device=${wasm ? "wasm" : device}`);
  worker.postMessage({ type: "load", device, mode: state.mode, manifestUrl });
};
const needModel = () => { if (state.phase !== "ready") boot(); };

// ---- the two search panels and the notes board ------------------------------------------------------------------------
const setStat = (name, text) => { document.querySelector(`[data-stat="${name}"]`).textContent = text; };

const goldNote = (hits) => {
  const rank = hits.findIndex((hit) => hit.row === state.bench.row) + 1;
  const translations = hits.filter((hit) => hit.group === state.bench.group && hit.row !== state.bench.row).length;
  return `${rank ? `Gold answer at #${rank}` : `Gold answer not in the top ${hits.length}`} · ${translations} of its translations in the top ${hits.length}`;
};
const benchGold = (data) => (state.bench && state.bench.text === data.query ? state.bench : null);

const views = {
  bench: createSearchView({
    index: "bench", root: $("panel-bench"), worker, isReady, needModel,
    onInput: (text) => { if (state.bench && state.bench.text !== text) state.bench = null; }, // edited: no longer the example
    render: (data) => renderHits(data.hits, state.languages, benchGold(data)),
    count: (data) => `Top ${data.hits.length} of ${data.size.toLocaleString("en")} passages`,
    note: (data) => (benchGold(data) ? goldNote(data.hits) : ""),
  }),
  notes: createSearchView({
    index: "notes", root: $("notes-search"), worker, isReady, needModel,
    render: (data) => renderNoteHits(data.hits, board.labels),
    count: (data) => `${data.hits.length} of ${data.size} ${data.size === 1 ? "note" : "notes"}`,
  }),
};
const board = createNotesBoard({
  list: $("notes"), empty: $("notes-empty"), count: $("notes-count"), worker, isReady, needModel,
  onChange: () => views.notes.refresh(),
});
$("add-note").addEventListener("click", () => board.add());
$("add-random-notes").addEventListener("click", () => board.addRandom(5));
// "My data (custom)" links in the copy open that tab and bring the tab bar into view.
for (const link of document.querySelectorAll("[data-tab]")) {
  link.addEventListener("click", () => {
    el.tabs.api.setState("active", { index: Number(link.dataset.tab) });
    el.tabs.scrollIntoView({ block: "start", behavior: motion.matches ? "auto" : "smooth" });
  });
}

/** Bench queries always run in the first tab; a pick made from the second tab switches back. */
const showBenchTab = () => { if (el.tabs.api.getState().config.index !== 0) el.tabs.api.setState("active", { index: 0 }); };
const askBench = (i) => {
  const query = state.queries[i];
  showBenchTab();
  state.bench = { text: query.text, row: query.gold, group: query.goldGroup };
  views.bench.ask(query.text);
};

/** Keeps the scroll position: only a query row that is out of view is brought back, so the results stay in sight. */
const reveal = () => {
  const { top, bottom } = el.query.getBoundingClientRect();
  if (top < 0 || bottom > innerHeight) el.query.scrollIntoView({ block: "start", behavior: motion.matches ? "auto" : "smooth" });
};

// ---- worker events ---------------------------------------------------------------------------------------------------
const languageOrder = (languages) => {
  const own = new Intl.Locale(navigator.language || "en").language;
  const rank = (code) => {
    const tag = Intl.getCanonicalLocales(code.split("_")[0])[0];
    return tag === own ? 0 : tag === "en" ? 1 : 2;
  };
  return languages.map((code, i) => i).sort((a, b) => rank(languages[a]) - rank(languages[b]) || a - b);
};

const handlers = {
  probe: ({ cached }) => {
    if (state.phase === "loading" || state.phase === "ready") return; // the user started a load meanwhile
    if (cached) { log("success", `${MODES[chosenMode()].name} found in the browser cache · loading it`); boot(); }
    else log("info", `${MODES[chosenMode()].name} not cached yet · it downloads (${transferOf()}) with the first search`);
  },
  progress: ({ phase, loaded, total, cached }) => {
    state.progress[phase] = [loaded, total];
    if (phase === "tokens") {
      caption("vectors");
      // A download shows its size; vectors already in the browser have nothing to count.
      document.querySelector('output[for="p-tokens"]').dataset.template = cached ? "cached" : `{percent} of ${mb(total)}`;
    }
    if (phase === "reembed") {
      $("p-reembed-field").hidden = false;
      el.reembed.api.setState("default", { value: loaded, max: total });
    }
    schedule();
  },
  phase: ({ phase, done }) => {
    if (phase === "runtime" && !done) {
      el.runtime.api.setState("indeterminate");
      el.status.textContent = "Compiling ONNX Runtime Web and creating the session...";
      caption("runtime");
    } else if (phase === "runtime") {
      state.progress.runtime = 1;
      el.runtime.api.setState("complete");
      el.runtime.dataset.tone = "success";
      el.status.textContent = "Warming up...";
    } else if (!done) { caption("warm-up"); el.status.textContent = "Warming up..."; }
    else state.progress.warmup = 1;
    schedule();
  },
  log: ({ tone, text }) => log(tone, text),
  indexed: (data) => {
    Object.assign(state, { queries: data.queries, languages: data.languages, passages: data.passages, downloads: data.downloads, tokenBytes: data.tokenBytes });
    showMode();
    const total = data.vectors.bytes + data.documents.bytes;
    state.progress.index = [total, total];
    paint();
    if (state.phase !== "loading") { caption("model"); el.status.textContent = "Index loaded. The model loads with your first search."; }
    setStat("passages", data.passages.toLocaleString("en"));
    setStat("languages", `documents · ${data.languages.length} languages`);
    // The same figures as the hero and the benchmark: the vector index is the 412 kB in transfer, the text comes on top.
    $("p-index-hint").textContent = `vector index ${mb(data.vectors.rawBytes)} -> ${kb(data.vectors.bytes)} Brotli · passage text ${mb(data.documents.rawBytes)} -> ${kb(data.documents.bytes)} Brotli`;
    const order = languageOrder(data.languages);
    $("cmd-placeholder").outerHTML = renderQueryGroups(data.queries, data.languages, order);
    const firstOf = (language) => data.queries.findIndex((query) => query.language === language);
    const picks = [...new Set([firstOf(order[0]), firstOf(order[1]), firstOf(data.languages.indexOf("jpn_Jpan"))])].filter((i) => i >= 0);
    el.examples.innerHTML = renderExampleButtons(picks, data.queries);
  },
  ready: (data) => {
    state.phase = "ready";
    state.progress.warmup = 1;
    lockModes(false);
    paint();
    el.ring.api.setState("complete");
    el.ring.dataset.tone = "success";
    caption("ready");
    el.backend.value = data.device;
    const seconds = (data.ms / 1000).toFixed(1);
    el.status.textContent = `Ready in ${seconds} s · ${MODES[data.mode].name} · ${data.device === "webgpu" ? "WebGPU" : "WASM"} · ${data.cached ? "model from the browser cache" : "model downloaded once, now cached"}.`;
    // The page's first load shows its state in the ring and the bars; a toast on top irritates (human request,
    // 2026-11-09). Later loads, after a mode or backend change, toast.
    if (state.loads++ > 0) toast("success", `Ready in ${seconds} s`, `${MODES[data.mode].name} · ${data.device === "webgpu" ? "WebGPU" : "WASM"} · ${data.cached ? "from the browser cache" : "downloaded once, now cached"}`);
    $("reembed").disabled = false;
    setStat("device", data.device === "webgpu" ? "WebGPU" : "WASM");
    setStat("ready", `${seconds} s`);
    setStat("source", data.cached ? "model from cache" : `${(data.downloadedBytes / 1e6).toFixed(1)} MB downloaded`);
    if (data.fallback) { $("boot-notice-text").textContent = `WebGPU is unavailable here (${data.fallback}), so the model runs on the CPU.`; el.notice.hidden = false; }
    for (const button of document.querySelectorAll("button[data-boot]")) {
      button.disabled = false;
      button.innerHTML = `<svg class="vs-icon" aria-hidden="true"><use href="#i-reload"/></svg>Reload the ${MODES[data.mode].models === 1 ? "model" : "models"}`;
    }
    log("success", `ready · ${seconds} s`);
    board.resume();
    views.bench.resume();
    views.notes.resume();
  },
  results: (data) => views[data.index].onResults(data),
  note: (data) => board.onNote(data),
  error: ({ message, index, note }) => {
    const loading = state.phase === "loading" || !state.queries.length;
    if (state.phase === "loading") state.phase = "error";
    for (const view of Object.values(views)) if (loading || view === views[index]) view.onError();
    if (note) board.onError(note, message);
    $("boot-error-title").textContent = loading ? "Loading failed" : note ? "Embedding failed" : "Search failed";
    $("boot-error-text").textContent = message;
    el.error.hidden = false;
    if (loading) {
      el.status.textContent = "Loading failed.";
      el.runtime.api.setState("default", { value: 0 });
      for (const button of document.querySelectorAll("button[data-boot]")) button.disabled = false;
      lockModes(false);
    }
    log("destructive", message);
  },
  cleared: () => {
    log("success", `model cache cleared · the next load downloads ${transferOf()}`);
    toast("success", "AI model cache cleared", `The next load downloads ${transferOf()}.`);
  },
  reembedded: (data) => {
    const seconds = (data.ms / 1000).toFixed(1);
    $("p-reembed-hint").textContent = `${data.passages.toLocaleString("en")} passages with ${MODES[data.mode].name} in ${seconds} s, in this browser; the prebuilt index skips this.`;
    toast("success", `Re-embedded the index in ${seconds} s`, `${data.passages.toLocaleString("en")} passages · ${MODES[data.mode].name} · in this browser`);
    $("reembed").disabled = false;
    views.bench.refresh();
  },
};
worker.onmessage = ({ data }) => handlers[data.type]?.(data);
worker.onerror = (event) => handlers.error({ message: event.message || "The worker failed to start" });

// ---- palette, buttons, copy -------------------------------------------------------------------------------------------

// The palette holds only the example queries; loading, the backend, the theme and the cache have their own controls.
el.cmdList.addEventListener("click", (event) => {
  const item = event.target.closest(".command-item[data-query]");
  if (item) { askBench(Number(item.dataset.query)); reveal(); }
});
$("clear-cache").addEventListener("click", () => worker.postMessage({ type: "clear-cache" }));
// Shows what the prebuilt files save: the mode's model encodes all passages again, here, with a progress bar and a timing.
$("reembed").addEventListener("click", () => {
  if (state.phase !== "ready") return;
  $("reembed").disabled = true;
  $("p-reembed-field").hidden = false;
  el.reembed.removeAttribute("data-tone");
  el.reembed.api.setState("default", { value: 0, max: state.passages || 1 });
  $("p-reembed-hint").textContent = `encoding ${state.passages.toLocaleString("en")} passages with ${MODES[state.mode].name}...`;
  log("info", `re-embed · mode=${state.mode}`);
  worker.postMessage({ type: "reembed" });
});
// The palette activates its highlighted item on Enter; with no item left, Enter searches the typed text.
cmdInput.addEventListener("keydown", (event) => {
  const text = cmdInput.value.trim();
  if (event.key !== "Enter" || !text || el.cmdList.querySelector(".command-item:not([hidden]):not([aria-disabled='true'])")) return;
  el.cmd.api.setState("default");
  state.bench = null;
  showBenchTab();
  views.bench.ask(text);
  reveal();
});

for (const trigger of document.querySelectorAll("[data-boot]")) {
  trigger.addEventListener("click", () => { if (trigger.tagName === "BUTTON" || state.phase !== "ready") boot(); });
}
el.backend.addEventListener("change", () => { state.device = el.backend.value; if (state.phase === "ready") boot(el.backend.value); });
// A new mode tab reloads a ready demo; before that, it relabels the page and starts loading only if its models are
// cached. defuss-shadcn tabs fire no change event (0.9.13), so the tabs' aria-selected is watched instead.
let shownMode = chosenMode();
new MutationObserver(() => {
  const mode = modeTab()?.dataset.mode;
  if (!mode || mode === shownMode) return;
  shownMode = mode;
  showMode();
  if (state.phase === "ready") boot();
  else worker.postMessage({ type: "probe", mode, manifestUrl });
}).observe(el.modes, { subtree: true, attributes: true, attributeFilter: ["aria-selected"] });
// Retry repeats what failed: a failed index alone must not start the model download.
$("boot-retry").addEventListener("click", () => {
  el.error.hidden = true;
  if (!state.queries.length) worker.postMessage({ type: "index", manifestUrl });
  if (state.phase === "error") boot();
});
el.examples.addEventListener("click", (event) => {
  const button = event.target.closest("[data-query]");
  if (button) askBench(Number(button.dataset.query));
});

const copyText = async (text, status, label) => {
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = "Copied";
  } catch {
    status.textContent = "Copy failed";
  }
  if (!label) return;
  label.textContent = status.textContent;
  setTimeout(() => { label.textContent = "Copy prompt"; }, 2000);
};
document.querySelector(".mk-code-block-copy").addEventListener("click", () =>
  copyText(document.querySelector(".mk-code-block code").innerText, document.querySelector(".mk-code-block-status")));
$("copy-prompt").addEventListener("click", () => copyText(
  [...document.querySelectorAll("#agent-prompt pre:not([data-tone]) code")].map((code) => code.textContent).join("\n"),
  $("copy-prompt-status"), $("copy-prompt").querySelector("span")));

showMode();
worker.postMessage({ type: "index", manifestUrl });
worker.postMessage({ type: "probe", mode: chosenMode(), manifestUrl });
