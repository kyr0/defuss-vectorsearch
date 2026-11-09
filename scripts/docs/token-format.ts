/**
 * The reranker's passage token vectors for the docs demo, prebuilt by scripts/docs/build-index.ts so the browser
 * downloads them instead of encoding 2,000 passages itself (human decision, 2026-11-09; the page's "Re-embed the
 * index" button still encodes them in the browser, to show what that costs). Pure: Node writes it, the worker reads it.
 * Layout, little-endian: one Uint8 truncated flag and one Uint16 token count per passage, one Float32 scale per token,
 * then every token's codes, `bits` each (int4 packs two per byte, high nibble first). A component is
 * `code / levels * scale`, `scale` being the token's largest absolute component.
 * Why a scale per token: the vectors are L2-normalized, but their largest component varies per token, so one scale
 * for all would waste most of the levels.
 * Why int4 over int8 or float16: VERIFIED: tmp/token-store-probe.ts (2026-11-09, 180,626 token vectors, 450
 * target-language queries) measured Brotli sizes of 85.6 MB float32, 42.1 MB float16, 21.4 MB int8 and 8.2 MB int4;
 * int4 keeps float32's R@5 (83.8) and loses 0.7 points of R@1 (68.0 to 67.3).
 */

export const TOKEN_FORMAT = "defuss-vectorsearch-demo-tokens.v1";

export interface TokenFileMeta {
  readonly format: typeof TOKEN_FORMAT;
  readonly bits: 4 | 8;
  readonly dims: number;
  readonly passages: number;
  readonly tokens: number;
  /** The reranker fingerprint the vectors were encoded with; MaxSim refuses to mix fingerprints. */
  readonly fingerprint: string;
}

export interface EncodedPassage { readonly data: Float32Array; readonly tokenCount: number; readonly truncated: boolean }

const levelsOf = (bits: 4 | 8) => (bits === 8 ? 127 : 7);

export const encodeTokenVectors = (passages: readonly (EncodedPassage & { dimensions: number })[], bits: 4 | 8, fingerprint: string):
  { bytes: Uint8Array; meta: TokenFileMeta } => {
  const dims = passages[0]?.dimensions ?? 0;
  if (!passages.every((passage) => passage.dimensions === dims && passage.tokenCount < 65_536)) throw new Error("token vectors differ in dimensions or exceed 65,535 tokens");
  if (bits === 4 && dims % 2 !== 0) throw new Error("int4 needs an even dimension count");
  const tokens = passages.reduce((sum, passage) => sum + passage.tokenCount, 0);
  const head = passages.length * 3;
  const codeBytes = (dims * bits) / 8;
  const bytes = new Uint8Array(head + tokens * 4 + tokens * codeBytes);
  const view = new DataView(bytes.buffer);
  const levels = levelsOf(bits);
  let scaleAt = head;
  let codeAt = head + tokens * 4;
  passages.forEach((passage, i) => {
    bytes[i] = passage.truncated ? 1 : 0;
    view.setUint16(passages.length + i * 2, passage.tokenCount, true);
    for (let t = 0; t < passage.tokenCount; t++) {
      const row = passage.data.subarray(t * dims, (t + 1) * dims);
      const scale = row.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
      view.setFloat32(scaleAt, scale, true);
      scaleAt += 4;
      const code = (value: number) => (scale === 0 ? 0 : Math.round((value / scale) * levels));
      if (bits === 8) for (let k = 0; k < dims; k++) view.setInt8(codeAt + k, code(row[k]!));
      else for (let k = 0; k < dims; k += 2) bytes[codeAt + k / 2] = ((code(row[k]!) + 8) << 4) | (code(row[k + 1]!) + 8);
      codeAt += codeBytes;
    }
  });
  return { bytes, meta: { format: TOKEN_FORMAT, bits, dims, passages: passages.length, tokens, fingerprint } };
};

/** Validates the length against `meta`, then expands every passage back to float32 token vectors. */
export const decodeTokenVectors = (bytes: Uint8Array, meta: TokenFileMeta): EncodedPassage[] => {
  if (meta.format !== TOKEN_FORMAT || (meta.bits !== 4 && meta.bits !== 8)) throw new Error(`Invalid token vectors: format ${String(meta.format)}, ${String(meta.bits)} bits`);
  const { dims, passages, tokens, bits } = meta;
  const codeBytes = (dims * bits) / 8;
  const head = passages * 3;
  if (bytes.length !== head + tokens * (4 + codeBytes)) throw new Error(`Invalid token vectors: ${bytes.length} bytes, expected ${head + tokens * (4 + codeBytes)}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const levels = levelsOf(bits);
  let scaleAt = head;
  let codeAt = head + tokens * 4;
  const out: EncodedPassage[] = [];
  for (let i = 0; i < passages; i++) {
    const tokenCount = view.getUint16(passages + i * 2, true);
    const data = new Float32Array(tokenCount * dims);
    for (let t = 0; t < tokenCount; t++) {
      const step = view.getFloat32(scaleAt, true) / levels;
      scaleAt += 4;
      if (bits === 8) for (let k = 0; k < dims; k++) data[t * dims + k] = view.getInt8(codeAt + k) * step;
      else for (let k = 0; k < dims; k += 2) {
        const byte = bytes[codeAt + k / 2]!;
        data[t * dims + k] = ((byte >> 4) - 8) * step;
        data[t * dims + k + 1] = ((byte & 15) - 8) * step;
      }
      codeAt += codeBytes;
    }
    out.push({ data, tokenCount, truncated: bytes[i] === 1 });
  }
  if (scaleAt !== head + tokens * 4) throw new Error("Invalid token vectors: token counts disagree with the header");
  return out;
};
