/**
 * Tests for src/hub/client.ts
 * HubClient: HTTP wrapper for AgentHub REST API.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HubClient, HubClientError } from "../../src/hub/client.js";
import type { HubConfig } from "../../src/hub/types.js";

// --- Mocks ---

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

import { readFile } from "node:fs/promises";
const mockReadFile = vi.mocked(readFile);

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// --- Helpers ---

function makeConfig(overrides: Partial<HubConfig> = {}): HubConfig {
  return {
    serverUrl: "http://localhost:8080",
    apiKey: "test-key-123",
    agentId: "smith",
    ...overrides,
  };
}

function mockOk(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function mockText(body: string): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

function mockBytes(body: Uint8Array): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    arrayBuffer: () => Promise.resolve(body.buffer),
  } as unknown as Response;
}

function mock404(): Response {
  return {
    ok: false,
    status: 404,
    statusText: "Not Found",
    text: () => Promise.resolve(""),
  } as unknown as Response;
}

function mock500(): Response {
  return {
    ok: false,
    status: 500,
    statusText: "Internal Server Error",
    text: () => Promise.resolve(""),
  } as unknown as Response;
}

// --- Tests ---

describe("HubClient", () => {
  describe("constructor", () => {
    it("strips trailing slashes from serverUrl", () => {
      const client = new HubClient(makeConfig({ serverUrl: "http://host:8080///" }));
      expect(client.getServerUrl()).toBe("http://host:8080");
    });

    it("exposes agentId", () => {
      const client = new HubClient(makeConfig({ agentId: "neo" }));
      expect(client.getAgentId()).toBe("neo");
    });

    it("rejects server URLs containing credentials", () => {
      expect(
        () => new HubClient(makeConfig({
          serverUrl: "https://agent:secret@hub.example",
        })),
      ).toThrow(/embedded credentials/);
    });

    it("rejects server URLs containing query strings or fragments", () => {
      expect(
        () => new HubClient(makeConfig({
          serverUrl: "https://hub.example?token=secret",
        })),
      ).toThrow(/query string or fragment/);
    });

    it("clamps maxRetries to at least one attempt", async () => {
      const client = new HubClient(makeConfig(), { maxRetries: 0 });
      mockFetch.mockResolvedValueOnce(mockOk({ status: "ok" }));

      await expect(client.health()).resolves.toEqual({ status: "ok" });
      expect(mockFetch).toHaveBeenCalledOnce();
    });
  });

  describe("fromConfigFile", () => {
    it("loads config from ~/.agenthub/config.json", async () => {
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({ server_url: "http://hub:9000", api_key: "key", agent_id: "a1" }),
      );

      const client = await HubClient.fromConfigFile();
      expect(client.getServerUrl()).toBe("http://hub:9000");
      expect(client.getAgentId()).toBe("a1");
    });

    it("accepts a matching provided serverUrl", async () => {
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({ server_url: "http://hub:9000/", api_key: "key", agent_id: "a1" }),
      );

      const client = await HubClient.fromConfigFile("http://hub:9000");
      expect(client.getServerUrl()).toBe("http://hub:9000");
    });

    it("refuses to reuse credentials for a different server", async () => {
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({ server_url: "http://old:9000", api_key: "key", agent_id: "a1" }),
      );

      await expect(
        HubClient.fromConfigFile("http://different:8080"),
      ).rejects.toThrow(/refusing to send them/);
    });

    it("supports legacy camelCase config keys", async () => {
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({ serverUrl: "http://legacy:9000", apiKey: "key", agentId: "a1" }),
      );

      const client = await HubClient.fromConfigFile();
      expect(client.getServerUrl()).toBe("http://legacy:9000");
    });

    it("throws HubClientError when config file missing", async () => {
      mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));

      const request = HubClient.fromConfigFile();
      await expect(request).rejects.toThrow(HubClientError);
      await expect(request).rejects.toThrow(/agentsmith hub register/);
    });
  });

  describe("health", () => {
    it("sends GET /api/health with auth header", async () => {
      const client = new HubClient(makeConfig());
      mockFetch.mockResolvedValueOnce(mockOk({ status: "ok" }));

      const result = await client.health();

      expect(result.status).toBe("ok");
      expect(mockFetch).toHaveBeenCalledOnce();

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("http://localhost:8080/api/health");
      expect(init.method).toBe("GET");
      expect(init.headers.Authorization).toBe("Bearer test-key-123");
    });
  });

  describe("registerAgent", () => {
    it("sends POST /api/register with id in body", async () => {
      const client = new HubClient(makeConfig());
      mockFetch.mockResolvedValueOnce(mockOk({ id: "smith", api_key: "new-key" }));

      const agent = await client.registerAgent("smith");

      expect(agent.id).toBe("smith");
      expect(agent.api_key).toBe("new-key");

      const [, init] = mockFetch.mock.calls[0];
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({ id: "smith" });
    });
  });

  describe("channels", () => {
    it("creates a channel", async () => {
      const client = new HubClient(makeConfig());
      mockFetch.mockResolvedValueOnce(mockOk({ id: 1, name: "test", description: "desc", created_at: "now" }));

      const ch = await client.createChannel("test", "desc");
      expect(ch.name).toBe("test");
    });

    it("lists channels", async () => {
      const client = new HubClient(makeConfig());
      mockFetch.mockResolvedValueOnce(mockOk([{ id: 1, name: "ch1" }]));

      const channels = await client.listChannels();
      expect(channels).toHaveLength(1);
    });
  });

  describe("post", () => {
    it("posts to a channel", async () => {
      const client = new HubClient(makeConfig());
      mockFetch.mockResolvedValueOnce(mockOk({ id: 42, content: "hello" }));

      const post = await client.post("my-channel", "hello");
      expect(post.id).toBe(42);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/channels/my-channel/posts");
    });
  });

  describe("git operations", () => {
    it("pushes a bundle", async () => {
      const client = new HubClient(makeConfig());
      mockFetch.mockResolvedValueOnce(mockOk({ hashes: ["abc123"] }));

      const bundle = new Uint8Array([1, 2, 3]);
      const result = await client.pushBundle(bundle);
      expect(result.hashes).toEqual(["abc123"]);

      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers["Content-Type"]).toBe("application/octet-stream");
      expect(init.body).toBe(bundle);
    });

    it("downloads a raw git bundle", async () => {
      const client = new HubClient(makeConfig());
      mockFetch.mockResolvedValueOnce(mockBytes(new Uint8Array([4, 5, 6])));

      await expect(client.fetchCommit("abc123")).resolves.toEqual(
        new Uint8Array([4, 5, 6]),
      );
    });

    it("lists commits with pagination", async () => {
      const client = new HubClient(makeConfig());
      mockFetch.mockResolvedValueOnce(mockOk([{ hash: "a" }, { hash: "b" }]));

      const commits = await client.listCommits({ limit: 2, offset: 0 });
      expect(commits).toHaveLength(2);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("limit=2");
    });

    it("gets leaves", async () => {
      const client = new HubClient(makeConfig());
      mockFetch.mockResolvedValueOnce(mockOk([{ hash: "leaf1" }]));

      const leaves = await client.getLeaves();
      expect(leaves[0].hash).toBe("leaf1");
    });

    it("gets diff between two commits", async () => {
      const client = new HubClient(makeConfig());
      mockFetch.mockResolvedValueOnce(mockText("---diff---"));

      const result = await client.diff("a", "b");
      expect(result).toBe("---diff---");
    });
  });

  describe("error handling", () => {
    it("throws HubClientError on 4xx (no retry)", async () => {
      const client = new HubClient(makeConfig(), 100);
      mockFetch.mockResolvedValueOnce(mock404());

      await expect(client.health()).rejects.toThrow(HubClientError);
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it("retries on 5xx errors up to MAX_RETRIES", async () => {
      const client = new HubClient(makeConfig(), 100);
      mockFetch
        .mockResolvedValueOnce(mock500())
        .mockResolvedValueOnce(mock500())
        .mockResolvedValueOnce(mockOk({ status: "ok" }));

      // Allow retries to proceed
      vi.useRealTimers();
      const result = await client.health();
      expect(result.status).toBe("ok");
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("does not retry POST requests", async () => {
      const client = new HubClient(makeConfig(), 100);
      mockFetch.mockRejectedValueOnce(new Error("connection reset"));

      await expect(client.registerAgent("smith")).rejects.toThrow("connection reset");
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it("does not retry invalid JSON after a successful response", async () => {
      const client = new HubClient(makeConfig(), 100);
      mockFetch.mockResolvedValueOnce(mockText("not-json"));

      await expect(client.health()).rejects.toThrow(/invalid JSON/);
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it("keeps the timeout active while reading the response body", async () => {
      const client = new HubClient(makeConfig(), 100);
      let resolveBody!: (value: string) => void;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => new Promise<string>((resolve) => {
          resolveBody = resolve;
        }),
      } as unknown as Response);

      const request = client.health();
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(1);

      resolveBody(JSON.stringify({ status: "ok" }));
      await expect(request).resolves.toEqual({ status: "ok" });
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
