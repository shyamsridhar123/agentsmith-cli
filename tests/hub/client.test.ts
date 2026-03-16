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
  });

  describe("fromConfigFile", () => {
    it("loads config from ~/.agenthub/config.json", async () => {
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({ serverUrl: "http://hub:9000", apiKey: "key", agentId: "a1" }),
      );

      const client = await HubClient.fromConfigFile();
      expect(client.getServerUrl()).toBe("http://hub:9000");
      expect(client.getAgentId()).toBe("a1");
    });

    it("uses provided serverUrl over config file", async () => {
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({ serverUrl: "http://old:9000", apiKey: "key", agentId: "a1" }),
      );

      const client = await HubClient.fromConfigFile("http://override:8080");
      expect(client.getServerUrl()).toBe("http://override:8080");
    });

    it("throws HubClientError when config file missing", async () => {
      mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));

      await expect(HubClient.fromConfigFile()).rejects.toThrow(HubClientError);
      await expect(HubClient.fromConfigFile()).rejects.toThrow(/agentsmith hub register/);
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
      mockFetch.mockResolvedValueOnce(mockOk({ hash: "abc123" }));

      const commit = await client.pushBundle("base64data", "test msg");
      expect(commit.hash).toBe("abc123");
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
      mockFetch.mockResolvedValueOnce(mockOk({ diff: "---diff---", hash_a: "a", hash_b: "b" }));

      const result = await client.diff("a", "b");
      expect(result.diff).toBe("---diff---");
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
  });
});
