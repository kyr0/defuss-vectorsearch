import { describe, expect, it } from "vitest";
import { decodeTokenVectors, encodeTokenVectors } from "./token-format.ts";

const passage = (tokens: number[][], truncated = false) => ({ data: Float32Array.from(tokens.flat()), tokenCount: tokens.length, dimensions: tokens[0]!.length, truncated });

describe("demo token vectors", () => {
  const passages = [
    passage([[0.4, -0.2, 0.1, 0], [0.05, 0.05, -0.3, 0.3]]),
    passage([[-0.1, 0.25, 0.25, -0.05]], true),
  ];

  for (const bits of [8, 4] as const) {
    it(`round-trips int${bits} codes within one quantization step per component`, () => {
      const { bytes, meta } = encodeTokenVectors(passages, bits, "fp");
      expect(meta).toMatchObject({ bits, dims: 4, passages: 2, tokens: 3, fingerprint: "fp" });
      expect(bytes.length).toBe(2 * 3 + 3 * 4 + 3 * (4 * bits) / 8);
      const decoded = decodeTokenVectors(bytes, meta);
      expect(decoded.map((p) => [p.tokenCount, p.truncated])).toEqual([[2, false], [1, true]]);
      decoded.forEach((p, i) => p.data.forEach((value, k) => {
        const original = passages[i]!.data[k]!;
        const scale = Math.max(...Array.from(passages[i]!.data.subarray(Math.floor(k / 4) * 4, Math.floor(k / 4) * 4 + 4), Math.abs));
        expect(Math.abs(value - original)).toBeLessThanOrEqual(scale / (bits === 8 ? 127 : 7) / 2 + 1e-6);
      }));
      // The largest component of each token is exact.
      expect(decoded[0]!.data[0]).toBeCloseTo(0.4, 6);
    });
  }

  it("rejects a file whose length disagrees with its header", () => {
    const { bytes, meta } = encodeTokenVectors(passages, 8, "fp");
    expect(() => decodeTokenVectors(bytes.slice(1), meta)).toThrow(/bytes, expected/);
    expect(() => decodeTokenVectors(bytes, { ...meta, format: "other" as never })).toThrow(/format/);
  });
});
