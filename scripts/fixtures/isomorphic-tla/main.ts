// The isomorphic client.js path (core.ts → onnx.js → shared cache) awaited at module top level.
import { createEmbeddingClient } from "defuss-vectorsearch/client.js";

const mirror = new URL(new URLSearchParams(location.search).get("mirror") ?? "/models/winzling", location.href).href;
const embedder = createEmbeddingClient({ model: mirror, modelProfile: "winzling" });
const result = document.querySelector("#result")!;
try {
  const [vector] = await embedder.embedDocuments(["The cat sleeps on the sofa."]);
  result.textContent = JSON.stringify({ dims: vector!.length });
} catch (error) {
  result.textContent = `failed: ${error instanceof Error ? error.message : String(error)}`;
}
