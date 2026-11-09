import { expect, it } from "vitest";
import { createColbertReranker, buildTurboQuantIndex, createWinzlingEmbedder, fuseRanks, maxSim, MOEDERNCOLBERT_MODELS, searchTurboQuantIndex, type ColbertModel } from "./browser.js";

// Vite serves public/, which `make setup` (scripts/download-model.ts) fills with the pinned test graphs.
const base = (model: ColbertModel) => new URL(`/models/${MOEDERNCOLBERT_MODELS[model].id.split("/")[1]}/`, location.href).href;
const top1 = (row: number[]) => row.indexOf(Math.max(...row));

it("1.5m q8 in Chromium WASM, downloaded as .br from a mirror, matches the Python reference", async () => {
  const fixture = await (await fetch("/fixtures/moederncolbert-1.5m-reference.json")).json();
  const expected = fixture.precisions.q8;
  const reranker = createColbertReranker({ model: "1.5m", modelBaseUrl: base("1.5m"), wasmPaths: "/ort/" });
  try {
    const queries = await reranker.encodeQueries(fixture.queries);
    const documents = await reranker.encodeDocuments(fixture.documents);
    const scores = queries.map(q => documents.map(d => maxSim(q, d)));
    expect(documents.map(d => d.tokenCount)).toEqual(expected.document_token_counts);
    const error = Math.max(...scores.flatMap((row, q) => row.map((s, d) => Math.abs(s - expected.scores[q][d]))));
    expect(error, "max score error").toBeLessThanOrEqual(fixture.exact_tolerance.score);
    expect(scores.map(top1)).toEqual(expected.scores.map(top1));
    expect(await reranker.fingerprint()).not.toMatch(/onnxruntime/);
  } finally { await reranker.dispose(); }
}, 120_000);

it("reranks from the browser cache with remote loading disabled", async () => {
  const passages = ["Die Zugspitze ist 2962 Meter hoch.", "Paris is the capital of France."];
  const online = createColbertReranker({ model: "1.5m", modelBaseUrl: base("1.5m"), wasmPaths: "/ort/" });
  const expected = await online.rerank("Wie hoch ist die Zugspitze?", passages);
  await online.dispose();
  expect(expected[0]!.index).toBe(0);
  const offline = createColbertReranker({ model: "1.5m", modelBaseUrl: base("1.5m"), wasmPaths: "/ort/", allowRemoteModels: false });
  try { expect(await offline.rerank("Wie hoch ist die Zugspitze?", passages)).toEqual(expected); }
  finally { await offline.dispose(); }
});

it("fuses Winzling's TurboQuant hits with the reranker in Chromium", async () => {
  const fixture = await (await fetch("/fixtures/moederncolbert-1.5m-reference.json")).json();
  const embedder = createWinzlingEmbedder({ modelBaseUrl: new URL("/models/winzling", location.href).href, wasmPaths: "/ort/" });
  const reranker = createColbertReranker({ model: "1.5m", modelBaseUrl: base("1.5m"), wasmPaths: "/ort/" });
  try {
    const index = buildTurboQuantIndex(await embedder.embedDocuments(fixture.documents));
    for (const [q, query] of (fixture.queries as string[]).entries()) {
      const hits = searchTurboQuantIndex(index, await embedder.embedQuery(query), 5);
      const fused = await reranker.rerankHits(query, hits, fixture.documents, { truncate: true });
      expect(fused.map(hit => hit.index).sort()).toEqual(hits.map(hit => hit.index).sort());
      expect(fused.map(hit => hit.denseRank).sort()).toEqual([1, 2, 3, 4, 5]);
      expect(fixture.relevant[q], `query ${q}`).toContain(fused[0]!.index);
      const weighted = await reranker.rerankHits(query, hits, fixture.documents, { truncate: true, colbertWeight: 1, denseMargin: Infinity });
      expect(weighted.map(hit => hit.index)).toEqual([...fused].sort((a, b) => b.colbertScore - a.colbertScore || a.denseRank - b.denseRank).map(hit => hit.index));
    }
    // The demo's notes for "Bücher": the library note leads Winzling's order by 0.190, so the dense order stands.
    // VERIFIED (tmp/notes-probe.ts, 2026-11-08): with the 0.3.1 models, plain fusion ties it with an unrelated note and
    // keeps it first only by the dense tie-break; with the 0.2.x models it moved it to third. Where plain fusion puts it
    // depends on the models, so the test checks the contract instead: `denseMargin: Infinity` orders by rank fusion alone.
    const notes = ["Die neue Bibliothek in der Innenstadt hat bis 22 Uhr geöffnet.", "Договор аренды заканчивается в марте.",
      "The tax return is due at the end of July.", "Для похода в горы взять крепкие ботинки и дождевик."];
    const noteHits = searchTurboQuantIndex(buildTurboQuantIndex(await embedder.embedDocuments(notes)), await embedder.embedQuery("Bücher"), 25);
    const kept = await reranker.rerankHits("Bücher", noteHits, notes, { truncate: true });
    expect(kept.map(hit => hit.index)).toEqual(noteHits.map(hit => hit.index));
    expect(kept[0]!.index).toBe(0);
    const fusedNotes = await reranker.rerankHits("Bücher", noteHits, notes, { truncate: true, denseMargin: Infinity });
    const byDense = [...fusedNotes].sort((a, b) => a.denseRank - b.denseRank);
    expect(fusedNotes.map(hit => hit.index)).toEqual(fuseRanks(byDense.map(hit => hit.colbertScore)).map(({ position }) => byDense[position]!.index));
  } finally { await embedder.dispose(); await reranker.dispose(); }
}, 120_000);
