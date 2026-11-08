import { expect, it } from "vitest";
import { createColbertReranker, buildTurboQuantIndex, createWinzlingEmbedder, maxSim, MOEDERNCOLBERT_MODELS, searchTurboQuantIndex, type ColbertModel, type ColbertPrecision, type TokenMatrix } from "./browser.js";

// Vite serves public/, which `make setup` (scripts/download-model.ts) fills with the pinned test graphs.
const base = (model: ColbertModel) => new URL(`/models/${MOEDERNCOLBERT_MODELS[model].id.split("/")[1]}/`, location.href).href;
const top1 = (row: number[]) => row.indexOf(Math.max(...row));
const meanTokenCosine = (a: TokenMatrix[], b: TokenMatrix[]) => {
  let sum = 0, count = 0;
  a.forEach((m, i) => {
    for (let t = 0; t < m.tokenCount; t++) {
      let dot = 0, x = 0, y = 0;
      for (let k = 0; k < m.dimensions; k++) {
        const p = m.data[t * m.dimensions + k]!, q = b[i]!.data[t * m.dimensions + k]!;
        dot += p * q; x += p * p; y += q * q;
      }
      sum += dot / Math.sqrt(x * y); count++;
    }
  });
  return sum / count;
};

const encodeAll = async (model: ColbertModel, precision: ColbertPrecision, fixture: { queries: string[]; documents: string[] }) => {
  const reranker = createColbertReranker({ model, precision, modelBaseUrl: base(model), wasmPaths: "/ort/" });
  try {
    const queries = await reranker.encodeQueries(fixture.queries);
    const documents = await reranker.encodeDocuments(fixture.documents);
    return { queries, documents, scores: queries.map(q => documents.map(d => maxSim(q, d))), fingerprint: await reranker.fingerprint() };
  } finally { await reranker.dispose(); }
};

const PLAN: [ColbertModel, ColbertPrecision[]][] = [["1.5m", ["q8"]], ["1.5m-original", ["fp32", "fp16", "q8", "int8"]], ["27m", ["q8"]]];

for (const [model, precisions] of PLAN) it(`${model} in Chromium WASM matches the Python reference: ${precisions.join(", ")}`, async () => {
  const fixture = await (await fetch(`/fixtures/moederncolbert-${model}-reference.json`)).json();
  const fp32 = precisions.includes("fp32") ? await encodeAll(model, "fp32", fixture) : undefined;
  for (const precision of precisions) {
    const expected = fixture.precisions[precision];
    const run = precision === "fp32" ? fp32! : await encodeAll(model, precision, fixture);
    expect(run.documents.map(d => d.tokenCount), precision).toEqual(expected.document_token_counts);
    if (expected.contract.parity === "exact") {
      const error = Math.max(...run.scores.flatMap((row, q) => row.map((s, d) => Math.abs(s - expected.scores[q][d]))));
      expect(error, `${precision} max score error`).toBeLessThanOrEqual(fixture.exact_tolerance.score);
      expect(run.scores.map(top1), precision).toEqual(expected.scores.map(top1));
      expect(run.fingerprint).not.toMatch(/onnxruntime/);
    } else {
      const cosine = meanTokenCosine([...fp32!.queries, ...fp32!.documents], [...run.queries, ...run.documents]);
      expect(cosine, `${precision} mean token cosine`).toBeGreaterThanOrEqual(expected.contract.mean_token_cosine);
      expect(run.scores.map(top1), precision).toEqual(fp32!.scores.map(top1));
      expect(run.fingerprint).toMatch(/:onnxruntime-web@\d+\.\d+\.\d+\/wasm$/);
    }
  }
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
    // The demo's notes for "Bücher": the library note leads Winzling's order by 0.186, so the dense order stands.
    // VERIFIED: without the denseMargin check, fusion moved it to third (tmp/notes-probe.ts, 2026-10-31).
    const notes = ["Die neue Bibliothek in der Innenstadt hat bis 22 Uhr geöffnet.", "Договор аренды заканчивается в марте.",
      "The tax return is due at the end of July.", "Для похода в горы взять крепкие ботинки и дождевик."];
    const noteHits = searchTurboQuantIndex(buildTurboQuantIndex(await embedder.embedDocuments(notes)), await embedder.embedQuery("Bücher"), 25);
    const kept = await reranker.rerankHits("Bücher", noteHits, notes, { truncate: true });
    expect(kept.map(hit => hit.index)).toEqual(noteHits.map(hit => hit.index));
    expect(kept[0]!.index).toBe(0);
    const fusedNotes = await reranker.rerankHits("Bücher", noteHits, notes, { truncate: true, denseMargin: Infinity });
    expect(fusedNotes[0]!.index).not.toBe(0);
  } finally { await embedder.dispose(); await reranker.dispose(); }
}, 120_000);
