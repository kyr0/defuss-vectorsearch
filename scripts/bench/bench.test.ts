import { describe, expect, it } from "vitest";
import { topKFromScores } from "../../src/vector-search.js";
import { buildBenchTasks, DATASET_SHA256, loadDataset, validateDataset, type TinyRetrievalDataset } from "./dataset.ts";
import { endToEnd, rankOf, rankReproduction, recallMatrix, summarize } from "./metrics.ts";
import { byRecallDescending, README_END, README_START, renderReadmeSection, replaceReadmeSection, type BenchReport } from "./report.ts";

const dataset = (): TinyRetrievalDataset => ({
  schema: "tiny-multilingual-retrieval.v1",
  name: "unit",
  languages: ["eng_Latn", "deu_Latn"],
  corpus: [
    { id: "p-a", text: ["cat", "Katze"] },
    { id: "p-b", text: ["dog", "Hund"] },
  ],
  queries: [{ id: "q-1", text: ["which pet barks?", "welches Haustier bellt?"] }],
  qrels: [["q-1", "p-b", 1]],
});

describe("benchmark dataset", () => {
  it("targets the gold passage in the query's own language within the full haystack", () => {
    const tasks = buildBenchTasks(validateDataset(dataset()));
    expect(tasks.passages.map((p) => p.text)).toEqual(["cat", "Katze", "dog", "Hund"]);
    expect(tasks.queries.map((q) => [q.language, tasks.passages[q.target]!.text])).toEqual([[0, "dog"], [1, "Hund"]]);
  });

  it("rejects broken structure instead of misparsing it", () => {
    const wrongLength = { ...dataset(), corpus: [{ id: "p-a", text: ["cat"] }] };
    expect(() => validateDataset(wrongLength)).toThrow(/text must have 2/);
    expect(() => validateDataset({ ...dataset(), qrels: [] })).toThrow(/has no qrel/);
    expect(() => validateDataset({ ...dataset(), qrels: [["q-1", "p-x", 1]] })).toThrow(/unknown passage/);
    expect(() => validateDataset({ ...dataset(), schema: "v2" })).toThrow(/schema/);
  });

  it("refuses bytes that do not match the pinned release hash", async () => {
    await expect(loadDataset(new TextEncoder().encode(JSON.stringify(dataset())))).rejects.toThrow(DATASET_SHA256);
  });
});

describe("benchmark metrics", () => {
  it("ranks exactly like the library's top-k, ties included", () => {
    const scores = Float32Array.from([0.5, 0.9, 0.5, 0.1, 0.9]);
    const order = topKFromScores(scores, scores.length).map((hit) => hit.index);
    for (const target of order.keys()) expect(rankOf(scores, order[target]!)).toBe(target + 1);
  });

  it("computes recall@k per query language", () => {
    const matrix = recallMatrix([1, 4, 30, 200], [0, 0, 1, 1], ["eng_Latn", "deu_Latn"]);
    expect(matrix.overall).toEqual({ "@3": 25, "@5": 50, "@25": 50, "@100": 75 });
    expect(matrix.byLanguage.deu_Latn).toEqual({ "@3": 0, "@5": 0, "@25": 0, "@100": 50 });
  });

  it("accepts approximate ranks within ±10% of the exact rank only", () => {
    const result = rankReproduction([1, 1, 20, 20], [1, 2, 22, 23], [0, 0, 1, 1], ["eng_Latn", "deu_Latn"]);
    expect(result).toEqual({ overall: 50, byLanguage: { eng_Latn: 50, deu_Latn: 50 } });
  });

  it("charges passages a share of the index build and queries their own search", () => {
    const { passageMs, queryMs } = endToEnd([10, 30], [1, 2, 3], 4, [0.5, 0.5, 5]);
    expect(passageMs).toEqual({ mean: 22, p50: 12, p95: 32 });
    expect(queryMs).toEqual({ mean: 4, p50: 2.5, p95: 8 });
    expect(() => endToEnd([1], [1, 2], 0, [1])).toThrow(/one search time/);
  });

  it("summarizes with nearest-rank percentiles and rejects empty input", () => {
    expect(summarize([4, 1, 3, 2])).toEqual({ mean: 2.5, p50: 2, p95: 4 });
    expect(() => summarize([])).toThrow();
  });
});

describe("benchmark report", () => {
  const recall = { "@3": 50, "@5": 60, "@25": 80, "@100": 100 };
  const byLanguage = { eng_Latn: recall, deu_Latn: { "@3": 70, "@5": 80, "@25": 90, "@100": 100 }, tha_Thai: { "@3": 0, "@5": 0, "@25": 10, "@100": 50 } };
  const targets = ["eng_Latn", "deu_Latn"];
  const timing = { mean: 2.4, p50: 2.4, p95: 3.5 };
  const strategy = {
    indexMs: 1.25, indexMiB: 1, searchMs: { mean: 0.4, p50: 0.4, p95: 0.5 }, passageMs: timing, queryMs: timing, runtimeMiB: 6,
    recall: { overall: recall, byLanguage },
  };
  const model = {
    modelId: "m", device: "cpu", dims: 2, loadMs: 10, modelRuntimeMiB: 5,
    embedMs: { passage: { mean: 2, p50: 2, p95: 3 }, query: { mean: 1, p50: 1, p95: 1 } },
    strategies: { bruteforce: strategy, turboquant: { ...strategy, rankReproduced10pct: { overall: 53.3, byLanguage: { eng_Latn: 90, deu_Latn: 70, tha_Thai: 0 } } } },
  };
  const env = { runtime: "v24", models: { winzling: model, harrier: model } };
  const report: BenchReport = {
    schema: "defuss-vectorsearch-bench.v1", generatedAt: "2026-10-07T00:00:00.000Z",
    host: { cpu: "cpu", cores: 8, platform: "darwin arm64" },
    dataset: { name: "unit", sha256: "x", languages: ["eng_Latn", "deu_Latn", "tha_Thai"], haystack: 6, queries: 3 },
    ks: [3, 5, 25, 100], environments: { node: env, chromium: env },
    crossEnvironment: { winzling: { samples: 2, minCosine: 1, meanCosine: 1 }, harrier: { samples: 2, minCosine: 1, meanCosine: 1 } },
  };

  it("renders quality and cost rows per environment, model and strategy plus a per-language matrix", () => {
    const section = renderReadmeSection(report, targets);
    expect(section.match(/^\| (Node\.js|Chromium) \| (Winzling|Harrier) \| (bruteforce|TurboQuant) \|/gm)).toHaveLength(16);
    expect(section).toContain("| Node.js | Winzling | TurboQuant | 2.4 (p95 3.5) | 2.4 (p95 3.5) | 0.400 | 1.3 | 6 | 1 |");
    for (const heading of ["Embedding", "Retrieval Quality", "Cost per Method", "Per Language, Node.js"]) {
      expect(section).toContain(`\n### ${heading}\n\n`);
    }
  });

  it("averages overall recall and rank reproduction over the target languages only", () => {
    const section = renderReadmeSection(report, targets);
    expect(section).toContain("| Node.js | Winzling | bruteforce | 60 | 70 | 85 | 100 | n/a |");
    expect(section).toContain("| Node.js | Winzling | TurboQuant | 60 | 70 | 85 | 100 | 80% |");
    expect(section).toContain("their 2 queries against all 6 passages in 3 languages");
    expect(() => renderReadmeSection(report, ["eng_Latn", "jpn_Jpan"])).toThrow(/jpn_Jpan/);
  });

  it("lists only target languages, best first, breaking R@3 ties by R@5", () => {
    const rows = renderReadmeSection(report, targets).split("\n").filter((line) => line.startsWith("| `"));
    expect(rows.map((line) => line.slice(2, 12))).toEqual(["`deu_Latn`", "`eng_Latn`"]);
    const tied = { overall: recall, byLanguage: { a: { "@3": 50, "@5": 60, "@25": 0, "@100": 0 }, b: { "@3": 50, "@5": 70, "@25": 0, "@100": 0 } } };
    expect(["a", "b"].sort(byRecallDescending(tied))).toEqual(["b", "a"]);
  });

  it("replaces only the marked README section and fails without markers", () => {
    const readme = `intro\n${README_START}\nold\n${README_END}\noutro\n`;
    expect(replaceReadmeSection(readme, "new")).toBe(`intro\n${README_START}\nnew\n${README_END}\noutro\n`);
    expect(() => replaceReadmeSection("no markers", "new")).toThrow(/markers/);
  });
});
