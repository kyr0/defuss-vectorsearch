import { createWinzlingEmbedder, type WinzlingEmbedder } from "../src/onnx.js";
let embedder: WinzlingEmbedder | undefined;
let activeDevice: string | undefined;
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      if (activeDevice !== data.device) {
        await embedder?.dispose();
        embedder = createWinzlingEmbedder({
          modelBaseUrl: new URL("/models/winzling", self.location.href).href,
          wasmPaths: new URL("/ort/", self.location.href).href,
          device: data.device,
        });
        activeDevice = data.device;
      }
      const start = performance.now();
      const vectors = await embedder!.embedDocuments(data.documents);
      const query = await embedder!.embedQuery(data.query);
      const hits = vectors.map((vector, index) => ({
        text: data.documents[index], score: vector.reduce((sum, value, dim) => sum + value * query[dim]!, 0),
      })).sort((a, b) => b.score - a.score);
      self.postMessage({ hits, milliseconds: performance.now() - start, device: activeDevice });
    } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
  });
};
