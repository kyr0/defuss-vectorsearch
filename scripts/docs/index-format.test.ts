import { describe, expect, it } from "vitest";
import { buildTurboQuantIndex, searchTurboQuantIndex } from "../../src/turboquant.ts";
import { normalizeVector } from "../../src/vector-math.ts";
import { decodeDemoIndex, DEMO_INDEX_SCHEMA, encodeDemoIndex, type DemoIndex } from "./index-format.ts";

/** Deterministic unit vectors: a real TurboQuant build needs real-shaped input, not an embedding model. */
const vectors = Array.from({ length: 24 }, (_, row) =>
  normalizeVector(Float32Array.from({ length: 384 }, (_, dim) => Math.sin(row * 7.3 + dim * 0.37) + (dim % (row + 2)) / 9)),
);

const demo: DemoIndex = {
  schema: DEMO_INDEX_SCHEMA,
  dataset: { name: "fixture", sha256: "ab".repeat(32), license: "CC-BY-SA-4.0", licenseUrl: "https://example.org/l", attribution: "a", citation: "c" },
  model: { id: "kyr0/Winzling-Embed-a8m-64k", revision: "r1", fingerprint: "f1" },
  languages: ["eng_Latn", "deu_Latn"],
  passages: vectors.map((_, i) => ({ text: `passage ${i} – Größe`, language: i % 2, group: Math.floor(i / 2) })),
  queries: [{ text: "Wo?", language: 1, gold: 3 }],
  index: buildTurboQuantIndex(vectors),
};

describe("demo index format", () => {
  it("round-trips a real TurboQuant index so search results stay identical", () => {
    const { documents, vectors: bytes } = encodeDemoIndex(demo);
    // The binary part is the index itself: one sign per rotated dimension, then every code byte. No encoding overhead.
    expect(bytes.length).toBe(demo.index.rotatedDims + demo.index.size * demo.index.codeBytes);
    const decoded = decodeDemoIndex(JSON.parse(documents), bytes);
    expect(decoded.index.codes).toEqual(demo.index.codes);
    expect(decoded.index.signs).toEqual(demo.index.signs);
    expect(decoded.index.codebook).toEqual(demo.index.codebook);
    expect({ ...decoded, index: undefined }).toEqual({ ...demo, index: undefined });
    for (const query of vectors.slice(0, 5)) {
      expect(searchTurboQuantIndex(decoded.index, query, 5)).toEqual(searchTurboQuantIndex(demo.index, query, 5));
    }
  });

  it("rejects another schema, a truncated vector file and passages that do not match the index size", () => {
    const { documents, vectors: bytes } = encodeDemoIndex(demo);
    const raw = JSON.parse(documents);
    expect(() => decodeDemoIndex({ ...raw, schema: "other" }, bytes)).toThrow(/schema/);
    expect(() => decodeDemoIndex(raw, bytes.subarray(1))).toThrow(/vector file/);
    const { text, language, group } = raw.passages;
    const oneShort = { text: text.slice(1), language: language.slice(1), group: group.slice(1) };
    expect(() => decodeDemoIndex({ ...raw, passages: oneShort }, bytes)).toThrow(/23 passages for 24 vectors/);
    expect(() => decodeDemoIndex({ ...raw, passages: { ...raw.passages, group: group.slice(1) } }, bytes)).toThrow(/columns differ/);
  });
});
