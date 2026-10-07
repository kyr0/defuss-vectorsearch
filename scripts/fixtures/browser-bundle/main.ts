// The README quick start, plus an optional `?mirror=` so the e2e test can serve the model locally.
import { buildTurboQuantIndex, createWinzlingEmbedder, searchTurboQuantIndex } from "defuss-vectorsearch/browser.js";

const mirror = new URLSearchParams(location.search).get("mirror");
const embedder = createWinzlingEmbedder(mirror ? { modelBaseUrl: new URL(mirror, location.href).href } : {});
const result = document.querySelector("#result")!;
try {
  const documents = ["The cat sleeps on the sofa.", "Die Börse schloss heute im Plus.", "Кошка спит на диване."];
  const index = buildTurboQuantIndex(await embedder.embedDocuments(documents));
  const hits = searchTurboQuantIndex(index, await embedder.embedQuery("A sleeping cat on a couch."), 2);
  result.textContent = JSON.stringify({ top: hits.map((hit) => documents[hit.index]) });
} catch (error) {
  result.textContent = `failed: ${error instanceof Error ? error.message : String(error)}`;
}
