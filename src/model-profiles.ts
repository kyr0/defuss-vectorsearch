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
