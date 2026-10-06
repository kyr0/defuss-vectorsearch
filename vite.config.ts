import { defineConfig } from "vite";
export default defineConfig({
  optimizeDeps: { include: ["@huggingface/tokenizers", "defuss-db", "defuss-db/client.js"], exclude: ["onnxruntime-web"] },
  worker: { format: "es" },
  build: { outDir: "demo-dist" },
});
