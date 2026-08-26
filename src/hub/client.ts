/**
 * AgentHub HTTP Client
 * Wraps the AgentHub REST API with timeout, retry, and config loading.
 * Zero external dependencies — uses native fetch.
 * "I know why you're here, Neo."
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
  HubConfig,
  HubConfigFile,
  HubAgent,
  HubPushResponse,
  HubCommit,
  HubChannel,
  HubPost,
  HubHealthResponse,
  HubListOptions,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;
const CONFIG_FILENAME = "config.json";
const CONFIG_DIR = ".agenthub";

type LegacyHubConfigFile = Partial<HubConfigFile> & Partial<HubConfig>;

export interface HubClientOptions {
  timeoutMs?: number;
  maxRetries?: number;
}

export class HubClientError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "HubClientError";
  }
}

export function normalizeHubServerUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new HubClientError(`Invalid AgentHub server URL: ${value || "(empty)"}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HubClientError("AgentHub server URL must use http:// or https://");
  }
  if (parsed.username || parsed.password) {
    throw new HubClientError(
      "AgentHub server URL must not contain embedded credentials.",
    );
  }
  if (parsed.search || parsed.hash) {
    throw new HubClientError(
      "AgentHub server URL must not contain a query string or fragment.",
    );
  }
  return parsed.toString().replace(/\/+$/, "");
}

function readConfigValue(
  config: LegacyHubConfigFile,
  snakeCase: keyof HubConfigFile,
  camelCase: keyof HubConfig,
): string {
  const value = config[snakeCase] ?? config[camelCase];
  return typeof value === "string" ? value : "";
}

export class HubClient {
  private serverUrl: string;
  private apiKey: string;
  private agentId: string;
  private timeoutMs: number;
  private maxRetries: number;

  constructor(
    config: HubConfig,
    options: number | HubClientOptions = {},
  ) {
    const resolvedOptions =
      typeof options === "number" ? { timeoutMs: options } : options;
    this.serverUrl = normalizeHubServerUrl(config.serverUrl);
    this.apiKey = config.apiKey;
    this.agentId = config.agentId;
    this.timeoutMs = resolvedOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = Math.max(
      1,
      resolvedOptions.maxRetries ?? MAX_RETRIES,
    );
  }

  static async fromConfigFile(
    serverUrl?: string,
    options?: HubClientOptions,
  ): Promise<HubClient> {
    const configPath = join(homedir(), CONFIG_DIR, CONFIG_FILENAME);
    let raw: string;
    try {
      raw = await readFile(configPath, "utf-8");
    } catch {
      throw new HubClientError(
        `Could not load AgentHub config from ${configPath}. Run 'agentsmith hub register' first.`,
      );
    }

    let parsed: LegacyHubConfigFile;
    try {
      parsed = JSON.parse(raw) as LegacyHubConfigFile;
    } catch {
      throw new HubClientError(`Invalid AgentHub config JSON at ${configPath}.`);
    }

    const configuredUrl = readConfigValue(parsed, "server_url", "serverUrl");
    const apiKey = readConfigValue(parsed, "api_key", "apiKey");
    const agentId = readConfigValue(parsed, "agent_id", "agentId");
    if (!configuredUrl || !apiKey || !agentId) {
      throw new HubClientError(
        `AgentHub config at ${configPath} must define server_url, api_key, and agent_id.`,
      );
    }

    const normalizedConfiguredUrl = normalizeHubServerUrl(configuredUrl);
    if (serverUrl) {
      const normalizedOverride = normalizeHubServerUrl(serverUrl);
      if (normalizedOverride !== normalizedConfiguredUrl) {
        throw new HubClientError(
          `Configured AgentHub credentials belong to ${normalizedConfiguredUrl}; refusing to send them to ${normalizedOverride}. Run 'agentsmith hub register' for that server first.`,
        );
      }
    }

    return new HubClient({
      serverUrl: normalizedConfiguredUrl,
      apiKey,
      agentId,
    }, options);
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body: RequestInit["body"],
    contentType: string | undefined,
    readResponse: (response: Response) => Promise<T>,
  ): Promise<T> {
    const url = `${this.serverUrl}${path}`;
    const canRetry = method === "GET";
    const attempts = canRetry ? this.maxRetries : 1;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < attempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let responseReceived = false;

      try {
        const headers: Record<string, string> = {};
        if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
        if (contentType) headers["Content-Type"] = contentType;

        const response = await fetch(url, {
          method,
          headers,
          body,
          signal: controller.signal,
        });
        responseReceived = true;

        if (!response.ok) {
          const responseBody = await response.text();
          const detail = responseBody.trim() ? `: ${responseBody.trim()}` : "";
          throw new HubClientError(
            `Hub API error: ${response.status} ${response.statusText}${detail}`,
            response.status,
          );
        }

        return await readResponse(response);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const retryableStatus =
          lastError instanceof HubClientError &&
          lastError.status !== undefined &&
          lastError.status >= 500;
        const retryableNetworkError =
          !responseReceived || lastError.name === "AbortError";
        const shouldRetry =
          canRetry &&
          attempt < attempts - 1 &&
          (retryableStatus || retryableNetworkError);

        if (!shouldRetry) throw lastError;
        clearTimeout(timer);
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_BASE_MS * 2 ** attempt),
        );
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError ?? new HubClientError("Request failed after retries");
  }

  private requestJson<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    return this.request(
      method,
      path,
      body === undefined ? undefined : JSON.stringify(body),
      body === undefined ? undefined : "application/json",
      async (response) => {
        const text = await response.text();
        if (!text) return {} as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new HubClientError(
            `Hub returned invalid JSON for ${method} ${path}.`,
          );
        }
      },
    );
  }

  async health(): Promise<HubHealthResponse> {
    return this.requestJson<HubHealthResponse>("GET", "/api/health");
  }

  async registerAgent(id: string): Promise<HubAgent> {
    return this.requestJson<HubAgent>("POST", "/api/register", { id });
  }

  async createChannel(
    name: string,
    description?: string,
  ): Promise<HubChannel> {
    return this.requestJson<HubChannel>("POST", "/api/channels", {
      name,
      description,
    });
  }

  async listChannels(): Promise<HubChannel[]> {
    return this.requestJson<HubChannel[]>("GET", "/api/channels");
  }

  async post(channel: string, content: string): Promise<HubPost> {
    return this.requestJson<HubPost>(
      "POST",
      `/api/channels/${encodeURIComponent(channel)}/posts`,
      { content },
    );
  }

  async pushBundle(bundle: Uint8Array): Promise<HubPushResponse> {
    return this.request(
      "POST",
      "/api/git/push",
      bundle as RequestInit["body"],
      "application/octet-stream",
      async (response) => {
        const text = await response.text();
        try {
          const parsed = JSON.parse(text) as Partial<HubPushResponse>;
          if (!Array.isArray(parsed.hashes)) throw new Error("missing hashes");
          return { hashes: parsed.hashes };
        } catch {
          throw new HubClientError("Hub returned an invalid git push response.");
        }
      },
    );
  }

  async fetchCommit(hash: string): Promise<Uint8Array> {
    return this.request(
      "GET",
      `/api/git/fetch/${encodeURIComponent(hash)}`,
      undefined,
      undefined,
      async (response) => new Uint8Array(await response.arrayBuffer()),
    );
  }

  async listCommits(options?: HubListOptions): Promise<HubCommit[]> {
    const params = new URLSearchParams();
    if (options?.agent) params.set("agent", options.agent);
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.offset) params.set("offset", String(options.offset));
    const query = params.toString();
    return this.requestJson<HubCommit[]>(
      "GET",
      `/api/git/commits${query ? `?${query}` : ""}`,
    );
  }

  async getCommit(hash: string): Promise<HubCommit> {
    return this.requestJson<HubCommit>(
      "GET",
      `/api/git/commits/${encodeURIComponent(hash)}`,
    );
  }

  async getChildren(hash: string): Promise<HubCommit[]> {
    return this.requestJson<HubCommit[]>(
      "GET",
      `/api/git/commits/${encodeURIComponent(hash)}/children`,
    );
  }

  async getLineage(hash: string): Promise<HubCommit[]> {
    return this.requestJson<HubCommit[]>(
      "GET",
      `/api/git/commits/${encodeURIComponent(hash)}/lineage`,
    );
  }

  async getLeaves(): Promise<HubCommit[]> {
    return this.requestJson<HubCommit[]>("GET", "/api/git/leaves");
  }

  async diff(hashA: string, hashB: string): Promise<string> {
    return this.request(
      "GET",
      `/api/git/diff/${encodeURIComponent(hashA)}/${encodeURIComponent(hashB)}`,
      undefined,
      undefined,
      (response) => response.text(),
    );
  }

  getServerUrl(): string {
    return this.serverUrl;
  }

  getAgentId(): string {
    return this.agentId;
  }
}
