# Audited model contract

- Model: https://huggingface.co/kyr0/Winzling-Embed-a8m-64k
- Pinned release: https://huggingface.co/kyr0/Winzling-Embed-a8m-64k/tree/dc961ecc2773117fb67114aa7e40adc83730653d
- Upstream package: https://github.com/kyr0/defuss/tree/4ddb290567db95aa97eb1594d99f7b2afa6c2b8a/packages/embeddings
- ORT deployment guidance: https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html
- Tokenizer implementation: https://github.com/huggingface/tokenizers.js

Inspected 2026-10-06 and, for the pinned release, 2026-11-08 at commit `8f37def`. Commit `dc961ec` only adds `.br`
files, and its graph is byte-identical (same SHA-256, 2026-11-09). The graph has ONNX IR 8, standard opset 17 and
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
| `onnx/model_uint4.onnx` | 30,464,606 | `b07e0e6f5ba1b65a8f7c988c967572d55d166b32ab8d9c1508b5b550511b8218` |
| `tokenizer.json` | 9,292,544 | `1500c16e2ad682e31dceffcff0a62bda448741c1b61120a3a398afdc3851de82` |
| `tokenizer_config.json` | 2,448 | `0ec4307a0de6ad9c6ac3412082ebcae2f6dfa2864e327e756a8b9a67e6d0a6fc` |

Runtime graph size is 29.05 MiB; the three assets total 37.92 MiB. These are file
sizes, not RAM/VRAM or npm installation sizes. All hashes are checked before
creating a session. The fingerprint includes the revision and semantic settings.

The model card declares MIT licensing for this derivative and credits Yuichi
Tateno's `hotchpotch/bekko-embedding-v1-a8m` (also MIT) for the pretrained and
embedding-trained model. Winzling supplies vocabulary reduction and quantization.
In the pinned release, the 4-bit codes and block scales of `onnx/model_uint4.onnx`
were re-quantized with GPTQ and distilled from a ColBERT teacher. VERIFIED: the
model repository's audit (`onnx/model_uint4.json`) reports the same node list,
output contract and byte size as the original export, with 48 initializers changed.
The original model card is included beside the model assets in the download.
No new quality or cross-language retrieval benchmark is claimed by this package.
