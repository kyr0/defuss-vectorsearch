"""Independent Rust-tokenizer oracle for the MoEdernColBERT reranker's token ids. No JavaScript involved.

python -m pip install -r scripts/reference-requirements.txt
python scripts/generate-colbert-tokenizer-reference.py
"""
import hashlib
import json
from pathlib import Path

import tokenizers
from tokenizers import Tokenizer

ROOT = Path(__file__).resolve().parent.parent
REPOS = {
    "1.5m": "winzling-embed-SauerkrautLM-MoEdernColBERT-1.5M-weight-space-programming",
    "1.5m-original": "SauerkrautLM-MoEdernColBERT-1.5M-ONNX",
    "27m": "SauerkrautLM-MoEdernColBERT-27M-ONNX",
}
# VERIFIED: @huggingface/tokenizers 0.2.0 drops U+FEFF (byte-order mark), which Rust keeps, and does not split at
# U+0085 (next line), where Rust does; src/colbert-reranker.live.test.ts checks the reranker against this fixture.
# The last two texts contain neither character.
texts = [
    "﻿Простое число – натуральное число больше 1.",
    "﻿The cat sleeps on the sofa.",
    "Straße﻿netz und Bahn﻿",
    "a ﻿ b",
    "first line\u0085second line",
    "\u0085Kopf\u0085 und Fuß\u0085",
    "Die Katze schläft auf dem Sofa.",
    "Кошка спит на диване.",
]
by_hash = {}
for model, repo in REPOS.items():
    path = ROOT / "public/models" / repo / "tokenizer.json"
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest not in by_hash:
        tok = Tokenizer.from_file(str(path))
        tok.no_truncation()
        tok.no_padding()
        by_hash[digest] = {
            "models": [],
            "query": [tok.encode("[Q] " + t).ids for t in texts],
            "document": [tok.encode("[D] " + t).ids for t in texts],
        }
    by_hash[digest]["models"].append(model)

out = ROOT / "fixtures/moederncolbert-tokenizer-reference.json"
out.write_text(json.dumps({
    "generator": {"tokenizers": tokenizers.__version__},
    "texts": texts,
    "tokenizers": by_hash,
}, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"wrote {out.relative_to(ROOT)}: {len(texts)} texts, {len(by_hash)} tokenizers")
