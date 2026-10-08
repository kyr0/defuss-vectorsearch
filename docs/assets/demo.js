// The demo's glue: worker events → defuss-shadcn State APIs; user input → worker requests. The worker owns the model,
// the runtime and both indexes (examples/search-worker.ts); search-view.js runs a search panel, notes.js the notes
// board, render.js builds the markup.
// Why plain ES modules driving component State APIs instead of a framework app: the page is served as static files
// (docs/, no build step), and every visual state is a documented component state, so the e2e can read it back.
// VERIFIED: scripts/test-docs.ts reads progress/ring states through el.api.getState() and passes.
// The index loads on page load (868 kB gzipped, it carries the 1,000 example queries); the 39.8 MB model only when the user
// searches, writes a note or asks for it, unless it is already in the browser cache.
import { createNotesBoard } from "./notes.js";
import { formatMs, renderExampleButtons, renderHits, renderLogLine, renderNoteHits, renderQueryGroups } from "./render.js";
import { createSearchView } from "./search-view.js";

const MODEL_WEIGHT = 0.78;
const RUNTIME_WEIGHT = 0.1;
const INDEX_WEIGHT = 0.1;
const $ = (id) => document.getElementById(id);
const el = {
  ring: $("ring"), model: $("p-model"), runtime: $("p-runtime"), index: $("p-index"), status: $("boot-status"),
  log: $("log"), backend: $("backend"), examples: $("empty-examples"), cmd: $("cmd"), cmdList: $("cmd-list"),
  notice: $("boot-notice"), error: $("boot-error"), theme: $("theme-toggle"), tabs: $("demo-tabs"),
  query: document.querySelector("#panel-bench .vs-query"),
};
const cmdInput = el.cmd.querySelector(".command-input");
const motion = matchMedia("(prefers-reduced-motion: reduce)");
const worker = new Worker(new URL("./search-worker.js", import.meta.url), { type: "module" });
const manifestUrl = new URL("../data/manifest.json", import.meta.url).href;

const state = {
  phase: "idle", queries: [], languages: [], passages: 0, bench: null,
  progress: { model: [0, 1], index: [0, 1], runtime: 0, warmup: 0 },
};
const isReady = () => state.phase === "ready";
/** One unit style for every size on the page: kB for what crosses the network gzipped, MB with two decimals otherwise. */
const kb = (bytes) => `${Math.round(bytes / 1e3)} kB`;
const mb = (bytes) => `${(bytes / 1e6).toFixed(bytes >= 1e7 ? 1 : 2)} MB`;

// ---- boot: bars, ring and log ------------------------------------------------------------------------------------
let frame = 0;
const paint = () => {
  frame = 0;
  const { model, index, runtime, warmup } = state.progress;
  // Bars count bytes; the readout names the real total (the manifest's exact size), so it can never drift.
  const bytes = (bar, [loaded, total]) => {
    if (total <= 1) return; // no size reported yet
    document.querySelector(`output[for="${bar.id}"]`).dataset.template = bar === el.index ? `{percent} of ${kb(total)} (gzip)` : `{percent} of ${mb(total)}`;
    bar.api.setState("default", { value: loaded, max: total });
  };
  bytes(el.model, model);
  bytes(el.index, index);
  const overall = MODEL_WEIGHT * model[0] / model[1] + RUNTIME_WEIGHT * runtime + INDEX_WEIGHT * index[0] / index[1] + 0.02 * warmup;
  el.ring.api.setState("default", { value: Math.min(100, Math.round(overall * 100)) });
  for (const bar of [el.model, el.index]) {
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

/** Model and runtime start over; a loaded index stays loaded. */
const resetBoot = () => {
  state.progress = { ...state.progress, model: [0, 1], runtime: 0, warmup: 0 };
  for (const bar of [el.model, el.runtime]) { bar.removeAttribute("data-tone"); bar.api.setState("default", { value: 0 }); }
  el.ring.removeAttribute("data-tone");
  el.notice.hidden = true;
  el.error.hidden = true;
  caption("model");
  schedule();
};

const boot = (device = el.backend.value) => {
  if (state.phase === "loading") return;
  state.phase = "loading";
  el.backend.value = device;
  el.status.textContent = `Loading the model for ${device === "webgpu" ? "WebGPU" : "WASM"}…`;
  for (const button of document.querySelectorAll("button[data-boot]")) button.disabled = true;
  resetBoot();
  log("info", `load · device=${device}`);
  worker.postMessage({ type: "load", device, manifestUrl });
};
const needModel = () => { if (state.phase !== "ready") boot(); };

// ---- the two search panels and the notes board ------------------------------------------------------------------------
const setStat = (name, text) => { document.querySelector(`[data-stat="${name}"]`).textContent = text; };
const showTiming = (data) => {
  setStat("query", formatMs(data.embedMs + data.scanMs));
  setStat("scan", `embed ${formatMs(data.embedMs)} + scan ${formatMs(data.scanMs)}`);
};

const goldNote = (hits) => {
  const rank = hits.findIndex((hit) => hit.row === state.bench.row) + 1;
  const translations = hits.filter((hit) => hit.group === state.bench.group && hit.row !== state.bench.row).length;
  return `${rank ? `Gold answer at #${rank}` : `Gold answer not in the top ${hits.length}`} · ${translations} of its translations in the top ${hits.length}`;
};
const benchGold = (data) => (state.bench && state.bench.text === data.query ? state.bench : null);

const views = {
  bench: createSearchView({
    index: "bench", root: $("panel-bench"), worker, isReady, needModel, onShown: showTiming,
    onInput: (text) => { if (state.bench && state.bench.text !== text) state.bench = null; }, // edited: no longer the example
    render: (data) => renderHits(data.hits, state.languages, benchGold(data)),
    count: (data) => `Top ${data.hits.length} of ${data.size.toLocaleString("en")} passages`,
    note: (data) => (benchGold(data) ? goldNote(data.hits) : ""),
  }),
  notes: createSearchView({
    index: "notes", root: $("notes-search"), worker, isReady, needModel, onShown: showTiming,
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
    if (cached) { log("success", "model found in the browser cache · loading it"); boot(); }
    else log("info", "model not cached yet · it downloads (39.8 MB) with the first search");
  },
  progress: ({ phase, loaded, total }) => { state.progress[phase] = [loaded, total]; schedule(); },
  phase: ({ phase, done }) => {
    if (phase === "runtime" && !done) {
      el.runtime.api.setState("indeterminate");
      el.status.textContent = "Compiling ONNX Runtime Web and creating the session…";
      caption("runtime");
    } else if (phase === "runtime") {
      state.progress.runtime = 1;
      el.runtime.api.setState("complete");
      el.runtime.dataset.tone = "success";
      el.status.textContent = "Warming up…";
    } else if (!done) caption("warm-up");
    else state.progress.warmup = 1;
    schedule();
  },
  log: ({ tone, text }) => log(tone, text),
  indexed: (data) => {
    Object.assign(state, { queries: data.queries, languages: data.languages, passages: data.passages });
    const total = data.vectors.bytes + data.documents.bytes;
    state.progress.index = [total, total];
    paint();
    if (state.phase !== "loading") { caption("model"); el.status.textContent = "Index loaded. The model loads with your first search."; }
    setStat("passages", data.passages.toLocaleString("en"));
    setStat("languages", `documents · ${data.languages.length} languages`);
    // The same figures as the hero and the benchmark: the vector index is the 431 kB in transfer, the text comes on top.
    $("p-index-hint").textContent = `vector index ${mb(data.vectors.rawBytes)} → ${kb(data.vectors.bytes)} gzip · passage text ${mb(data.documents.rawBytes)} → ${kb(data.documents.bytes)} gzip`;
    const order = languageOrder(data.languages);
    $("cmd-placeholder").outerHTML = renderQueryGroups(data.queries, data.languages, order);
    const firstOf = (language) => data.queries.findIndex((query) => query.language === language);
    const picks = [...new Set([firstOf(order[0]), firstOf(order[1]), firstOf(data.languages.indexOf("jpn_Jpan"))])].filter((i) => i >= 0);
    el.examples.innerHTML = renderExampleButtons(picks, data.queries);
  },
  ready: (data) => {
    state.phase = "ready";
    state.progress.warmup = 1;
    paint();
    el.ring.api.setState("complete");
    el.ring.dataset.tone = "success";
    caption("ready");
    el.backend.value = data.device;
    const seconds = (data.ms / 1000).toFixed(1);
    el.status.textContent = `Ready in ${seconds} s · ${data.device === "webgpu" ? "WebGPU" : "WASM"} · ${data.cached ? "model from the browser cache" : "model downloaded once, now cached"}.`;
    setStat("device", data.device === "webgpu" ? "WebGPU" : "WASM");
    setStat("ready", `${seconds} s`);
    setStat("source", data.cached ? "model from cache" : `${(data.downloadedBytes / 1e6).toFixed(1)} MB downloaded`);
    if (data.fallback) { $("boot-notice-text").textContent = `WebGPU is unavailable here (${data.fallback}), so the model runs on the CPU.`; el.notice.hidden = false; }
    for (const button of document.querySelectorAll("button[data-boot]")) {
      button.disabled = false;
      button.innerHTML = '<svg class="vs-icon" aria-hidden="true"><use href="#i-reload"/></svg>Reload the model';
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
    }
    log("destructive", message);
  },
  cleared: () => log("success", "model cache cleared · the next load downloads 39.8 MB"),
};
worker.onmessage = ({ data }) => handlers[data.type]?.(data);
worker.onerror = (event) => handlers.error({ message: event.message || "The worker failed to start" });

// ---- palette, buttons, theme, copy -------------------------------------------------------------------------------------
const setTheme = (dark) => {
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  el.theme.checked = dark;
  try { localStorage.setItem("defuss-shadcn-theme", JSON.stringify(dark ? "dark" : "light")); } catch {}
};
el.theme.checked = document.documentElement.classList.contains("dark");
el.theme.addEventListener("change", () => setTheme(el.theme.checked));

// The palette holds only the example queries; loading, the backend, the theme and the cache have their own controls.
el.cmdList.addEventListener("click", (event) => {
  const item = event.target.closest(".command-item[data-query]");
  if (item) { askBench(Number(item.dataset.query)); reveal(); }
});
$("clear-cache").addEventListener("click", () => worker.postMessage({ type: "clear-cache" }));
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
el.backend.addEventListener("change", () => { if (state.phase === "ready") boot(el.backend.value); });
// Retry repeats what failed: a failed index alone must not start the 39.8 MB model download.
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

worker.postMessage({ type: "index", manifestUrl });
worker.postMessage({ type: "probe" });
