# Audited model contract

- Model: https://huggingface.co/kyr0/Winzling-Embed-a8m-64k
- Pinned release: https://huggingface.co/kyr0/Winzling-Embed-a8m-64k/tree/bfa8af8a8fbf3beb12a93a14d6f5b51875a36214
- Upstream package: https://github.com/kyr0/defuss/tree/4ddb290567db95aa97eb1594d99f7b2afa6c2b8a/packages/embeddings
- ORT deployment guidance: https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html
- Tokenizer implementation: https://github.com/huggingface/tokenizers.js

Inspected 2026-10-06. The graph has ONNX IR 8, standard opset 17 and
`com.microsoft` opset 1, including 16 `MatMulNBits` nodes. Both inputs,
`input_ids` and `attention_mask`, are int64 `[batch, sequence]`.
`last_hidden_state` is float32 `[batch, sequence, 384]`.
There is no pooling or normalization tail in the supplied graph.

The provider computes the attention-mask-weighted mean, including BOS/EOS as
specified by the model's Sentence Transformers pooling module, and L2-normalizes
unless disabled. It never adds Harrier instructions. Padding ID is 0, BOS 2,
EOS 1. Vocabulary size is 65536; context is 8192 tokens.

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `onnx/model_uint4.onnx` | 30,464,606 | `68ebb344e88e3d88763d0d5ced34de818128bc704b60b3fc6ef1bbd7c3897115` |
| `tokenizer.json` | 9,292,544 | `1500c16e2ad682e31dceffcff0a62bda448741c1b61120a3a398afdc3851de82` |
| `tokenizer_config.json` | 2,448 | `0ec4307a0de6ad9c6ac3412082ebcae2f6dfa2864e327e756a8b9a67e6d0a6fc` |

Runtime graph size is 29.05 MiB; the three assets total 37.92 MiB. These are file
sizes, not RAM/VRAM or npm installation sizes. All hashes are checked before
creating a session. The fingerprint includes the revision and semantic settings.

The model card declares MIT licensing for this derivative and credits Yuichi
Tateno's `hotchpotch/bekko-embedding-v1-a8m` (also MIT) for the pretrained and
embedding-trained model. Winzling supplies vocabulary reduction and quantization.
The original model card is included beside the model assets in the download.
No new quality or cross-language retrieval benchmark is claimed by this package.
