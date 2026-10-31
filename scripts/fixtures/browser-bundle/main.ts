// The README quick start: dense search, then MoEdernColBERT fused with the dense hits. Optional `?mirror=` and
// `?colbert=` let the e2e test serve both models locally. VERIFIED: scripts/test-browser-bundle.ts builds this file
// with Vite and runs it in Chromium.
import { buildTurboQuantIndex, createColbertReranker, createWinzlingEmbedder, searchTurboQuantIndex } from "defuss-vectorsearch/browser.js";

const params = new URLSearchParams(location.search);
const mirror = params.get("mirror");
const colbert = params.get("colbert");
const embedder = createWinzlingEmbedder(mirror ? { modelBaseUrl: new URL(mirror, location.href).href } : {});
const reranker = createColbertReranker({ model: "1.5m", ...(colbert ? { modelBaseUrl: new URL(colbert, location.href).href } : {}) });
const result = document.querySelector("#result")!;
try {
  const documents = ["The cat sleeps on the sofa.", "Die Börse schloss heute im Plus.", "Кошка спит на диване."];
  const query = "A sleeping cat on a couch.";
  const index = buildTurboQuantIndex(await embedder.embedDocuments(documents));
  const hits = searchTurboQuantIndex(index, await embedder.embedQuery(query), 2);
  const fused = await reranker.rerankHits(query, hits, documents);
  result.textContent = JSON.stringify({ top: hits.map((hit) => documents[hit.index]), reranked: fused.map((hit) => documents[hit.index]) });
} catch (error) {
  result.textContent = `failed: ${error instanceof Error ? error.message : String(error)}`;
}
