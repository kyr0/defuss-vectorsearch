import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DefussEmbeddingClient } from "./client.js";

// A real local HTTP endpoint exercises the actual fetch, header and JSON path end to end.
interface ObservedRequest { url: string; headers: IncomingHttpHeaders; body: { model: string; input: string[] | string } }
const requests: ObservedRequest[] = [];
const server = createServer((request, response) => {
  let raw = "";
  request.on("data", chunk => { raw += chunk; });
  request.on("end", () => {
    const body = JSON.parse(raw) as ObservedRequest["body"];
    requests.push({ url: request.url ?? "", headers: request.headers, body });
    const inputs = Array.isArray(body.input) ? body.input : [body.input];
    // Out-of-order indices check that the client reorders by `index`.
    const data = inputs.length === 2
      ? [{ index: 1, embedding: [0, 3, 4] }, { index: 0, embedding: [3, 0, 4] }]
      : [{ index: 0, embedding: [1, 0, 0] }];
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ data }));
  });
});
let origin = "";

beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

describe("OpenAI-compatible embedding endpoints", () => {
  it("embeds batches through an OpenAI-compatible endpoint", async () => {
    requests.length = 0;
    const client = new DefussEmbeddingClient({
      model: "text-embedding-3-small",
      openAICompatible: {
        baseUrl: `${origin}/v1`,
        apiKey: "secret-token",
        headers: { "X-Test": "1" },
      },
    });

    const embeddings = await client.embed(["alpha", "beta"]);

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request!.url).toBe("/v1/embeddings");
    expect(request!.headers.authorization).toBe("Bearer secret-token");
    expect(request!.headers["x-test"]).toBe("1");
    expect(request!.body).toMatchObject({
      model: "text-embedding-3-small",
      input: ["alpha", "beta"],
    });

    expect(embeddings).toHaveLength(2);
    expect(embeddings[0]![0]).toBeCloseTo(0.6, 6);
    expect(embeddings[0]![1]).toBeCloseTo(0, 6);
    expect(embeddings[0]![2]).toBeCloseTo(0.8, 6);
    expect(embeddings[1]![0]).toBeCloseTo(0, 6);
    expect(embeddings[1]![1]).toBeCloseTo(0.6, 6);
    expect(embeddings[1]![2]).toBeCloseTo(0.8, 6);
  });

  it("allows raw query mode for non-Harrier endpoints", async () => {
    requests.length = 0;
    const client = new DefussEmbeddingClient({
      model: "text-embedding-3-small",
      openAICompatible: { endpoint: `${origin}/custom/embeddings` },
    });

    await client.embedQuery("How do I create a Python virtual environment?", {
      instruction: "",
    });

    expect(requests[0]!.url).toBe("/custom/embeddings");
    expect(String(requests[0]!.body.input)).toBe("How do I create a Python virtual environment?");
  });

  it("disables local model cache operations for OpenAI-compatible endpoints", async () => {
    const client = new DefussEmbeddingClient({
      model: "text-embedding-3-small",
      openAICompatible: { endpoint: `${origin}/custom/embeddings` },
    });

    await expect(client.prefetchModel()).rejects.toThrow(
      "prefetchModel is unavailable when using an OpenAI-compatible embedding endpoint.",
    );
    await expect(client.inspectModelCache()).rejects.toThrow(
      "inspectModelCache is unavailable when using an OpenAI-compatible embedding endpoint.",
    );
    await expect(client.clearModelCache()).rejects.toThrow(
      "clearModelCache is unavailable when using an OpenAI-compatible embedding endpoint.",
    );
  });
});
