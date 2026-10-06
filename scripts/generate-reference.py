"""Independent Rust-tokenizer / native Python ORT oracle. No Transformers.js involved.

python -m pip install -r scripts/reference-requirements.txt
python scripts/generate-reference.py
"""
import hashlib
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
import tokenizers
from tokenizers import Tokenizer

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "public/models/winzling"
texts = [
    "The cat sleeps on the sofa.",
    "Die Katze schläft auf dem Sofa.",
    "Кошка спит на диване.",
    "Build a web application.",
    "", "hello", "a", "  hello\nworld 😀 Straße é é  ",
    "Grüße aus München: groß, größer, am größten!",
    "Привет, мир! Ёжик идёт домой.",
    "\tHello\r\nworld\n\n\nnext", " \u00a0\u2009 ",
    "<bos>hello<eos><pad><mask>", "C++ TypeScript foo_bar HTTP/2 🦔👩🏽‍💻",
    "你好 世界 日本語 العربية", "1234567890 3.14159 -42 10⁻³",
    "Straße STRASSE café cafe\u0301", "first\u0000second", "The " * 80,
    "Paris is the capital of France.", "Berlin ist die Hauptstadt Deutschlands.",
    "Der Compiler übersetzt den Quelltext in Maschinencode.",
    "The compiler translates source code into machine code.",
    "Компилятор переводит исходный код в машинный код.",
]
tok = Tokenizer.from_file(str(ASSETS / "tokenizer.json"))
tok.no_truncation()
tok.no_padding()
options = ort.SessionOptions()
options.intra_op_num_threads = 1
session = ort.InferenceSession(str(ASSETS / "onnx/model_uint4.onnx"), sess_options=options,
                               providers=["CPUExecutionProvider"])
cases = []
for text in texts:
    encoded = tok.encode(text)
    ids = np.array([encoded.ids], dtype=np.int64)
    mask = np.ones_like(ids)
    hidden = session.run(["last_hidden_state"], {"input_ids": ids, "attention_mask": mask})[0]
    raw = hidden.astype(np.float64).mean(axis=1)[0]
    vector = (raw / np.linalg.norm(raw)).astype(np.float32)
    cases.append({"text": text, "ids": encoded.ids, "embedding": vector.tolist(),
                  "raw": raw.astype(np.float32).tolist()})
fixture = {
    "model_revision": "bfa8af8a8fbf3beb12a93a14d6f5b51875a36214",
    "onnxruntime": ort.__version__, "tokenizers": tokenizers.__version__,
    "sha256": {name: hashlib.sha256((ASSETS / name).read_bytes()).hexdigest()
               for name in ["tokenizer.json", "tokenizer_config.json", "onnx/model_uint4.onnx"]},
    "cases": cases,
}
out = ROOT / "fixtures/winzling-reference.json"
out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps(fixture, ensure_ascii=False, indent=2) + "\n")
print(f"Wrote {len(cases)} independent reference cases to {out}")
