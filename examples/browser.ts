const worker = new Worker(new URL("./browser-worker.ts", import.meta.url), { type: "module" });
const run = document.querySelector<HTMLButtonElement>("#run")!;
const status = document.querySelector<HTMLElement>("#status")!;
const results = document.querySelector<HTMLElement>("#results")!;
run.onclick = () => {
  run.disabled = true;
  status.textContent = "Loading assets and embedding locally…";
  worker.postMessage({
    documents: document.querySelector<HTMLTextAreaElement>("#documents")!.value.split("\n").filter(text => text.trim()),
    query: document.querySelector<HTMLInputElement>("#query")!.value,
    device: document.querySelector<HTMLSelectElement>("#device")!.value,
  });
};
worker.onmessage = ({ data }) => {
  run.disabled = false;
  if (data.error) { status.textContent = "Inference failed"; results.textContent = data.error; return; }
  status.textContent = `${data.device} · ${data.milliseconds.toFixed(1)} ms · 384 dimensions`;
  results.textContent = data.hits.map((hit: { score: number; text: string }, i: number) =>
    `${i + 1}. ${hit.score.toFixed(5)}  ${hit.text}`).join("\n");
};
worker.onerror = event => {
  run.disabled = false; status.textContent = "Worker failed"; results.textContent = event.message;
};
