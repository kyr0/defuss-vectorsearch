import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
const EXPECTED_FILE_COUNT = 5;

describe("prefetchModel in Node.js", () => {
  let cacheDir = "";

  beforeEach(async () => {
    cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "defuss-vectorsearch-prefetch-"));
    requests = 0;
  });

  afterEach(async () => {
    await fs.rm(cacheDir, { recursive: true, force: true });
  });

  it("reuses the filesystem cache instead of downloading files twice", async () => {
    await prefetchModel(MODEL_URL, { dtype: "q4", cacheDir });
    expect(requests).toBe(EXPECTED_FILE_COUNT);

    await prefetchModel(MODEL_URL, { dtype: "q4", cacheDir });
    expect(requests).toBe(EXPECTED_FILE_COUNT);
  });
});
