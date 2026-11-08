/** The audited Winzling release. 64k is vocabulary size; context is 8192. */
export const WINZLING_MODEL_ID = "kyr0/Winzling-Embed-a8m-64k";
export const WINZLING_REVISION = "bfa8af8a8fbf3beb12a93a14d6f5b51875a36214";
export const WINZLING_FILES = Object.freeze({
  "tokenizer.json": "1500c16e2ad682e31dceffcff0a62bda448741c1b61120a3a398afdc3851de82",
  "tokenizer_config.json": "0ec4307a0de6ad9c6ac3412082ebcae2f6dfa2864e327e756a8b9a67e6d0a6fc",
  "onnx/model_uint4.onnx": "68ebb344e88e3d88763d0d5ced34de818128bc704b60b3fc6ef1bbd7c3897115",
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
 * MoEdernColBERT late-interaction rerankers. "1.5m" is the round-4 weight edit of the 1.5M model, which adds 11,998
 * Cyrillic tokens and ships q8 only. "1.5m-original" and "27m" are the unedited feat-moederncolbert-onnx exports.
 * VERIFIED: every pinned hash equals the file at the pinned Hugging Face commit (tree API, 2026-10-31; "1.5m": a download of its commit, 2026-11-08).
 * parity "exact": identical vectors in every ONNX Runtime; "quality": runtime-specific vectors that pass a
 * quality gate against the same runtime's FP32 output, so their fingerprints name the runtime.
 */
const MOEDERNCOLBERT_SHARED_FILES = {
  "tokenizer.json": "8f71b9c566af030a896c8c4e21fd49dd734915707a3f1d4cffdf6c2adaa9fd06",
  "tokenizer_config.json": "02db1534a52b9af97be6a6a066af67ad2d3ff1eb10cc0af928bed5ae70a04ecd",
};

export const MOEDERNCOLBERT_MODELS = Object.freeze({
  "1.5m": Object.freeze({
    id: "kyr0/winzling-embed-SauerkrautLM-MoEdernColBERT-1.5M-weight-space-programming",
    revision: "9d3b299bd0d4a327bfa18d8b5db695f3fec2b8e4",
    files: Object.freeze({
      // Its tokenizer emits ids up to 41,999, which only this graph accepts.
      "tokenizer.json": "d7b2ba6bf68fd03cdb4f728196da966ba169572c4c8c1f06deda4ff5ee058598",
      "tokenizer_config.json": MOEDERNCOLBERT_SHARED_FILES["tokenizer_config.json"],
      "runtime.json": "aea3c634e5efad4f5aa31b85884582ca0106cb96c42482aa5ae7143fb5ab7822",
      "model_q8.onnx": "162a2b7cf814940cc79cfc154ae33309063fc9d0dde8d5f067373a6ba35be09b",
    }),
    precisions: Object.freeze({ q8: "exact" } as const),
  }),
  "1.5m-original": Object.freeze({
    id: "kyr0/SauerkrautLM-MoEdernColBERT-1.5M-ONNX",
    revision: "f386a021490a5cd9202a049024561420655065ae",
    files: Object.freeze({
      ...MOEDERNCOLBERT_SHARED_FILES,
      "runtime.json": "aea3c634e5efad4f5aa31b85884582ca0106cb96c42482aa5ae7143fb5ab7822",
      "model_fp32.onnx": "0180f74acd68411260f9dd28c6f518bb8b1c9176caa3dbbd965abffa6b69c883",
      "model_fp16.onnx": "f82e7a372695b82fe5de4c4a7033c538084128a2e787540f6515075ffba49d47",
      "model_q8.onnx": "7d709c97fd59c8eaea361faeb20f55c7a61a9c718587f2f4d3023dcce77e8d11",
      "model_int8.onnx": "f72b690d68e4783991fa879e21a73143b98ffe93c3e2250084a1e870e5982f9d",
    }),
    precisions: Object.freeze({ fp32: "exact", fp16: "quality", q8: "exact", int8: "quality" } as const),
  }),
  "27m": Object.freeze({
    id: "kyr0/SauerkrautLM-MoEdernColBERT-27M-ONNX",
    revision: "b6d6e21126d3910842181cde752a9aafde1c4bed",
    files: Object.freeze({
      ...MOEDERNCOLBERT_SHARED_FILES,
      "runtime.json": "4eff0c5e8b42fa8712966ea13cde269b5b1c528f06de4d2046003bc421cb932c",
      "model_fp32.onnx": "820a8e3bcce63071e55b3a9d830223a26512242f745617ebe0fbc0aa65ae14b1",
      "model_fp16.onnx": "c6be07070e12a07abb830b714c406b7918d23a79e1bd82b2045e041e6f185a28",
      "model_q8.onnx": "72b5ab5e2967d159f827cbdc9467daaf43d1ae3fffa3cca89dd7a82e8f0a7dff",
      "model_int8.onnx": "b1dba1f901981bd3c04e32315294c98c04acd6031f99eeee8d1c3eb7bbd19ffb",
      "model_q4.onnx": "a1f21a6c704adc691d4dada604d6b63331952b3b12ff46f40ea8243cfd15b940",
    }),
    precisions: Object.freeze({ fp32: "exact", fp16: "quality", q8: "exact", int8: "quality", q4: "exact" } as const),
  }),
});
