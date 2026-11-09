/**
 * The audited Winzling release. 64k is vocabulary size; context is 8192.
 * VERIFIED: scripts/download-model.ts fetched each file's `.br` from the pinned commit and it decoded to its hash (2026-11-09);
 * docs/MODEL.md records the audit of the ONNX graph.
 */
export const WINZLING_MODEL_ID = "kyr0/Winzling-Embed-a8m-64k";
export const WINZLING_REVISION = "dc961ecc2773117fb67114aa7e40adc83730653d";
export const WINZLING_FILES = Object.freeze({
  "tokenizer.json": "1500c16e2ad682e31dceffcff0a62bda448741c1b61120a3a398afdc3851de82",
  "tokenizer_config.json": "0ec4307a0de6ad9c6ac3412082ebcae2f6dfa2864e327e756a8b9a67e6d0a6fc",
  "onnx/model_uint4.onnx": "b07e0e6f5ba1b65a8f7c988c967572d55d166b32ab8d9c1508b5b550511b8218",
});

export const WINZLING_PROFILE = Object.freeze({
  id: WINZLING_MODEL_ID,
  revision: WINZLING_REVISION,
  dtype: "q4" as const,
  pooling: "mean" as const,
  dimensions: 384,
  maxTokens: 8192,
  queryPrefix: "",
  normalize: true,
  requiredFiles: Object.freeze(Object.keys(WINZLING_FILES)),
  // Include the semantic contract, not just the output dimension.
  fingerprint: `winzling:${WINZLING_REVISION}:uint4:mean-mask:l2:384:no-prefix`,
});

export const SUPPORTED_MODELS = Object.freeze({
  winzling: WINZLING_PROFILE,
  harrier: Object.freeze({
    id: "tss-deposium/harrier-oss-v1-270m-onnx-int8",
    dtype: "fp32" as const, // Transformers.js filename selector; graph weights are int8.
    pooling: "last_token" as const,
    normalize: true,
  }),
  harrierLegacy: Object.freeze({
    id: "onnx-community/harrier-oss-v1-270m-ONNX",
    dtype: "q4" as const,
    pooling: "last_token" as const,
    normalize: true,
  }),
});

/**
 * The MoEdernColBERT late-interaction reranker: the round-4 weight edit of the 1.5M model, which adds 11,998 Cyrillic
 * tokens and ships q8 only. 0.4.0 dropped the unedited 1.5M and 27M exports, whose repos serve no `.br` files.
 * VERIFIED: every pinned hash equals the decoded `.br` file at the pinned Hugging Face commit (2026-11-09).
 * parity "exact": identical vectors in every ONNX Runtime.
 */
export const MOEDERNCOLBERT_MODELS = Object.freeze({
  "1.5m": Object.freeze({
    id: "kyr0/winzling-embed-SauerkrautLM-MoEdernColBERT-1.5M-weight-space-programming",
    revision: "bd312dffe70801e6aa4a53b287f35018aa5dd88e",
    files: Object.freeze({
      // Its tokenizer emits ids up to 41,999, which only this graph accepts.
      "tokenizer.json": "d7b2ba6bf68fd03cdb4f728196da966ba169572c4c8c1f06deda4ff5ee058598",
      "tokenizer_config.json": "02db1534a52b9af97be6a6a066af67ad2d3ff1eb10cc0af928bed5ae70a04ecd",
      "runtime.json": "aea3c634e5efad4f5aa31b85884582ca0106cb96c42482aa5ae7143fb5ab7822",
      "model_q8.onnx": "162a2b7cf814940cc79cfc154ae33309063fc9d0dde8d5f067373a6ba35be09b",
    }),
    precisions: Object.freeze({ q8: "exact" } as const),
  }),
});
