# defuss-embeddings · standalone 0.2.0

Local Harrier and **Winzling-Embed-a8m-64k** text embeddings in TypeScript.
Extracted from `kyr0/defuss/packages/embeddings` at commit
`4ddb290567db95aa97eb1594d99f7b2afa6c2b8a` (upstream package 0.1.1).
No monorepo tooling or workspace dependencies are required. No repository has
been created on GitHub and this version has not been published to npm.

## Start from this download

Node **22.18+** (native TypeScript type stripping); tested with Node 24.19.0 on Linux x64.

```sh
# Skip optional CUDA downloads; native CPU binaries are already in the npm package.
ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm ci
npm run build
npm run models:download
node examples/node.ts           # CPU via ONNX Runtime Web/WASM
node examples/node.ts --cpu     # native Node CPU
npm run demo                    # open the printed localhost URL
```

The ZIP includes the exact model graph and tokenizer under
`public/models/winzling/`. `models:download` validates their SHA-256 hashes;
when absent, it downloads the pinned release. It also copies the installed
ORT WASM/JavaScript assets into `public/ort/` for the local browser demo.
The model and runtime assets are ignored by Git and excluded from the npm tarball.
After dependency installation and asset preparation, the examples need no network.

On Windows PowerShell, set `$env:ONNXRUNTIME_NODE_INSTALL_CUDA='skip'` before
`npm ci`. Browser testing additionally needs `npx playwright install chromium`
(or `npx playwright install --with-deps chromium` on a minimal Linux host).

## Supported models

| Model | Runtime | Pooling / queries |
|---|---|---|
| `kyr0/Winzling-Embed-a8m-64k` | Direct ONNX + `@huggingface/tokenizers` | Masked mean; unchanged, unprefixed input |
| `tss-deposium/harrier-oss-v1-270m-onnx-int8` | Existing Transformers.js pipeline | Existing last-token pooling and instruction formatting |
| `onnx-community/harrier-oss-v1-270m-ONNX` | Existing Transformers.js pipeline, `dtype: "q4"` | Existing Harrier behavior |

The no-argument client/server factory still defaults to Harrier. Explicit
OpenAI-compatible endpoints and existing vector-search exports are retained.
See [the preserved upstream README](docs/UPSTREAM_README.md) for those APIs and
historical benchmarks; those benchmark results were not reproduced for this release.

## Narrow Winzling entry point

```ts
import { createWinzlingEmbedder } from "defuss-embeddings/onnx.js";

const embedder = createWinzlingEmbedder({ device: "wasm" });
try {
  const documents = await embedder.embedDocuments([
    "The cat sleeps on the sofa.",
    "Die Katze schläft auf dem Sofa.",
    "Кошка спит на диване.",
  ]);
  const query = await embedder.embedQuery("A sleeping cat on a couch.");
  console.log(documents.length, query.length); // 3, 384
} finally {
  await embedder.dispose();
}
```

`onnx.js` does not import Transformers.js. The retained legacy dependencies
remain in the package's installation footprint. This release does not split
or remove them.

Methods: `load()`, `embed()`, `embedOne()`, `embedDocuments()`, `embedQuery()`,
`embedQueries()`, `dispose()`. `load()` is optional; inference initializes lazily.
Embeddings are `Float32Array`s. Empty batches return `[]`; empty strings are
encoded with the model's special tokens. Query whitespace is preserved.
Nonempty `instruction` or `preset` options are rejected for Winzling.

The provider fingerprint identifies the preset. Include `maxLength`, `truncate`,
and per-call normalization overrides in application embedding-cache keys.

Concurrent calls are serialized per instance. `dispose()` waits for accepted
work, releases the session, is idempotent, and rejects subsequent inference.
Initialization failures can be retried. There is no hosted-inference fallback.

## Existing client/server API

```ts
import { createEmbeddingServer, WINZLING_MODEL_ID } from "defuss-embeddings/server.js";

const embedder = createEmbeddingServer({
  model: WINZLING_MODEL_ID,
  device: "cpu", // use "wasm" for portable CPU execution
  winzling: { batchSize: 8 },
});
try {
  const vector = await embedder.embedQuery("Eine Suchanfrage");
  console.log(vector.length); // 384
} finally {
  await embedder.dispose();
}
```

The browser equivalent is `createEmbeddingClient` from `client.js`.
Known model IDs select their profile automatically. A Winzling mirror can use
`{ model: "https://example.com/models/winzling", modelProfile: "winzling" }`.
The folder must contain the unchanged pinned files at their original paths.
Use `WINZLING_MODEL_ID`, `WINZLING_PROFILE`, and `SUPPORTED_MODELS` for discovery.

Winzling's `dtype: "q4"` is selected automatically; its exact graph filename is
`onnx/model_uint4.onnx`. There is no external `.onnx_data` file. Arbitrary model
revisions, other dtypes, and non-mean pooling are not supported by this preset.

Legacy `prefetchModel()`, `inspectModelCache()`, and `clearModelCache()` know the
Winzling asset manifest. Actual inference verifies all three asset hashes,
including cache hits. `loadFile` bypasses this cache, so cache-management methods
do not inspect an application's custom loader/storage.

## Options and deployment

| `createWinzlingEmbedder` option | Default / behavior |
|---|---|
| `device` | `"wasm"`; `"cpu"` is Node-only; `"webgpu"` is experimental |
| `batchSize` | 8; bounded microbatches with right padding |
| `maxLength` | 8192 tokens including BOS/EOS; valid range 2–8192 |
| `truncate` | `false`; excess length throws. `true` preserves terminal EOS |
| `normalize` | `true`; per-call `normalize: false` returns the mean vector |
| `modelBaseUrl` | Optional HTTP(S) mirror of the pinned release |
| `loadFile` | Optional `(relativePath) => Promise<Uint8Array>` overriding all asset I/O |
| `cache` | `true`; filesystem in Node; Cache API + IndexedDB in browsers |
| `cacheDir` | Node OS temporary directory / `defuss-embeddings` |
| `allowRemoteModels` | `true`; `false` requires cached files unless `loadFile` is supplied |
| `wasmPaths` | ORT default; self-hosting example: `"/ort/"` |
| `numThreads` | 1; avoids a cross-origin-isolation requirement for WASM |

The wrapper APIs take these provider settings inside `winzling: { ... }`;
their existing top-level `device`, `normalize`, `cacheDir`, and
`allowRemoteModels` settings are also supported. Prefer the top-level settings
when using the wrapper APIs. For filesystem assets, use `winzling.loadFile`,
not the legacy Transformers.js `localModelPath` option.

Native Node CPU uses `onnxruntime-node@1.21.0`, matching the retained
Transformers.js dependency so two incompatible native ORT libraries are not
loaded into one process. The native peer is optional; the development checkout
installs it. ORT Web is pinned independently to `1.30.0` and the tokenizer to
`0.2.0`.

The included demo runs tokenization and inference in a dedicated module Worker,
serves all assets from localhost, and uses exact cosine similarity for display.
Do not enable ORT's proxy-worker mode for WebGPU. The provider sets it to false.
WASM paths and thread settings are global ORT configuration: use consistent
settings across instances and configure other users of ORT before initialization.
HTTPS or localhost is needed for browser cryptography, storage, and WebGPU APIs.

WebGPU requests require a usable adapter; absence throws instead of quietly
selecting CPU. When an adapter is available, the session requests WebGPU with
WASM for unsupported operators. Hardware WebGPU inference was **not verified**
in this environment. CPU paths are the validated defaults. GPU token states are
currently read back for pooling in TypeScript; GPU graph pooling is deferred.

8192 is the model's context limit, not a promise of low memory use at that length.
Long inputs can create large attention tensors. For retrieval, chunk upstream
or choose a smaller explicit `maxLength`; automatic chunking is outside this package.

## Verify

```sh
npx playwright install chromium
npm run verify
```

This runs strict TypeScript checks, builds ESM/CJS/declarations, checks assets,
runs the original regression suites and real Winzling CPU/browser inference,
tests the Worker demo, builds the demo, and exercises the built package exports.
Individual commands are listed in `package.json`.

The checked-in oracle contains **24 multilingual and adversarial cases** made
with Rust tokenizers and Python native ONNX Runtime. Tests require exact token-ID
agreement and compare normalized embeddings within `2e-5` maximum absolute error,
including padded batches against independently generated singleton vectors.
Fixtures cover Unicode, whitespace, special tokens, empty text, and byte fallback.
Other tests cover pooling, normalization, explicit truncation, corruption,
initialization retry, concurrent calls, disposal, and offline browser-cache reuse.

To regenerate the independent oracle:

```sh
python -m pip install -r scripts/reference-requirements.txt
python scripts/generate-reference.py
```

See [source provenance](docs/SOURCE_PROVENANCE.json) and
[model details and licensing](docs/MODEL.md). This verifies runtime behavior,
not retrieval quality on your application's corpus.

## Start a dedicated repository

The download has no Git remote or inherited monorepo history. Inside the extracted
folder, run `git init -b main`, then add and commit the source. Large local model
and runtime assets are excluded by `.gitignore`. CI downloads the pinned assets.
Set the package repository URL when the new repository exists.

## Standalone changes beyond the provider

- npm lockfile and self-contained build/test configuration; no Bun requirement.
- Strict typing repairs in the extracted package (without disabling strictness).
- `defuss-multicore` updated from 0.0.2 to **0.1.0**: the older published ESM entry
  imported Node's `createRequire` on browsers; the new release passes both
  existing Node and browser retrieval tests.
- Prefetch no longer imports Transformers.js merely to read global `env.cacheDir`.
  Set `cacheDir` explicitly; the OS temporary default is unchanged.
- Session disposal and serialized inference/model changes in the wrapper runtime.

MIT; original package copyright retained.
