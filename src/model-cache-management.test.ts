import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clearModelCache, inspectModelCache } from "./model-cache-management.js";
import { prefetchModel } from "./model-prefetch.js";

// A real local HTTP server stands in for the model host and counts the downloads.
let requests = 0;
const server = createServer((_request, response) => {
  requests++;
  response.writeHead(200, { "Content-Type": "application/octet-stream" }).end(Buffer.from([1, 2, 3, 4]));
});
let MODEL_URL = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  MODEL_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/models/harrier`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("model cache management in Node.js", () => {
  let cacheDir = "";

  beforeEach(async () => {
    cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "defuss-vectorsearch-cache-mgmt-"));
  });

  afterEach(async () => {
    await fs.rm(cacheDir, { recursive: true, force: true });
  });

  it("inspects and clears filesystem cached model files", async () => {
    await prefetchModel(MODEL_URL, { dtype: "q4", cacheDir });
    expect(requests).toBe(5);

    const inspection = await inspectModelCache(MODEL_URL, { dtype: "q4", cacheDir });
    expect(inspection.files.every((file) => file.locations.includes("filesystem"))).toBe(true);

    const cleared = await clearModelCache(MODEL_URL, { dtype: "q4", cacheDir });
    expect(cleared.files.every((file) => file.removedFrom.includes("filesystem"))).toBe(true);

    const reinspection = await inspectModelCache(MODEL_URL, { dtype: "q4", cacheDir });
    expect(reinspection.files.every((file) => file.locations.length === 0)).toBe(true);
  });
});
