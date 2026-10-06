import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
export default defineConfig({
  optimizeDeps: { exclude: ["onnxruntime-web", "onnxruntime-node"] },
  test: {
    include: ["src/winzling.live.browser.test.ts"], testTimeout: 120_000, hookTimeout: 120_000,
    browser: { enabled: true, provider: playwright(), headless: true, instances: [{ browser: "chromium" }] },
  },
});
