// The notes board of the second tab: yellow notes the user writes. Each note is embedded into the worker's "notes"
// index 500 ms after the last keystroke, or when it loses focus. The worker owns the vectors; the board only numbers
// the requests, so an answer for an older text never marks a newer one as embedded.
// Why a pause (500 ms) or blur instead of every keystroke: one embedding per thought, not per letter, while the note
// still feels live. VERIFIED: scripts/test-docs.ts sees a note embedded after the pause and another on Tab (blur).
import { formatMs, renderNote, renderNoteStatus } from "./render.js";
import { SAMPLE_NOTES } from "./sample-notes.js";

const DEBOUNCE_MS = 500;
const motion = matchMedia("(prefers-reduced-motion: reduce)");

/**
 * @param {object} options
 * @param {HTMLElement} options.list       where notes go
 * @param {HTMLElement} options.empty      shown while there is no note
 * @param {HTMLElement} options.count      "2 notes · 2 embedded"
 * @param {Worker} options.worker
 * @param {() => boolean} options.isReady  the model is loaded
 * @param {() => void} options.needModel   start loading the model (a note is waiting)
 * @param {() => void} options.onChange    the index changed
 */
export const createNotesBoard = ({ list, empty, count, worker, isReady, needModel, onChange }) => {
  const notes = new Map(); // id → { n, version, sent, timer }
  const labels = new Map(); // id → "Note n", for result cards
  let next = 1;
  let embedded = 0;

  const element = (id) => document.getElementById(id);
  const setStatus = (id, state, detail) => { element(id).querySelector(".vs-note-status").innerHTML = renderNoteStatus(state, detail); };
  const updateCount = () => {
    count.textContent = `${notes.size} ${notes.size === 1 ? "note" : "notes"} · ${embedded} embedded`;
    empty.hidden = notes.size > 0;
  };

  /** Sends the note's text when it changed since the last request. Empty text takes the note out of the index. */
  const embed = (id) => {
    const note = notes.get(id);
    clearTimeout(note.timer);
    const text = element(id).querySelector("textarea").value;
    if (text === note.sent) return;
    note.version += 1;
    note.sent = text;
    element(id).setAttribute("aria-busy", "true");
    if (isReady()) setStatus(id, "embedding");
    else { setStatus(id, "waiting"); needModel(); }
    worker.postMessage({ type: "note", id, version: note.version, text });
  };

  /** A new note; with `text` it is embedded right away, without it the user types and the pause or blur embeds it. */
  const add = ({ text = "", lang = "", focus = true } = {}) => {
    const id = `note-${next}`;
    const n = next++;
    notes.set(id, { n, version: 0, sent: "", timer: 0 });
    labels.set(id, `Note ${n}`);
    list.insertAdjacentHTML("beforeend", renderNote(id, n, lang));
    const textarea = element(id).querySelector("textarea");
    textarea.value = text;
    textarea.addEventListener("input", () => {
      const note = notes.get(id);
      clearTimeout(note.timer);
      note.timer = setTimeout(() => embed(id), DEBOUNCE_MS);
    });
    textarea.addEventListener("blur", () => embed(id));
    updateCount();
    if (focus) textarea.focus();
    if (text) embed(id);
    return id;
  };

  // A shuffled deck over the sample notes: repeated clicks draw new notes until all 100 have been used once.
  let deck = [];
  const draw = () => {
    if (!deck.length) {
      deck = SAMPLE_NOTES.map((_, i) => i);
      for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    }
    return SAMPLE_NOTES[deck.pop()];
  };
  /** Adds `count` sample notes and embeds them; only the notes list scrolls to them, never the page. */
  const addRandom = (count) => {
    for (let i = 0; i < count; i++) add({ ...draw(), focus: false });
    const scroller = list.closest(".vs-notes-scroll");
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: motion.matches ? "auto" : "smooth" });
  };

  return {
    add,
    addRandom,
    labels,
    /** The model is ready: notes that waited for it are being embedded now (the worker queued their requests). */
    resume: () => { for (const id of notes.keys()) if (element(id).getAttribute("aria-busy") === "true") setStatus(id, "embedding"); },
    onNote: (data) => {
      const note = notes.get(data.id);
      if (!note || data.version !== note.version) return; // a newer text is on its way
      const node = element(data.id);
      node.removeAttribute("aria-busy");
      embedded = data.count;
      if (data.removed) setStatus(data.id, "removed");
      else {
        setStatus(data.id, "embedded", `384-d in ${formatMs(data.embedMs)} · index ${formatMs(data.indexMs)}`);
        node.dataset.embedded = "";
        if (!motion.matches) node.animate([{ boxShadow: "0 0 0 0 var(--vs-note-pulse)" }, { boxShadow: "0 0 0 14px transparent" }], { duration: 900, easing: "ease-out" });
      }
      updateCount();
      onChange();
    },
    onError: (id, message) => {
      if (!notes.has(id)) return;
      element(id).removeAttribute("aria-busy");
      notes.get(id).sent = null; // let the next edit or blur try again
      setStatus(id, "failed", message);
    },
  };
};
