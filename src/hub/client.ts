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
  HubAgent,
  HubCommit,
  HubChannel,
  HubPost,
  HubHealthResponse,
  HubDiffResponse,
  HubListOptions,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;
const CONFIG_FILENAME = "config.json";
const CONFIG_DIR = ".agenthub";

export class HubClientError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "HubClientError";
  }
}

export class HubClient {
  private serverUrl: string;
  private apiKey: string;
  private agentId: string;
  private timeoutMs: number;

  constructor(config: HubConfig, timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.serverUrl = config.serverUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.agentId = config.agentId;
    this.timeoutMs = timeoutMs;
  }

  static async fromConfigFile(
    serverUrl?: string,
  ): Promise<HubClient> {
    const configPath = join(homedir(), CONFIG_DIR, CONFIG_FILENAME);
    try {
      const raw = await readFile(configPath, "utf-8");
      const config = JSON.parse(raw) as Partial<HubConfig>;
      return new HubClient({
        serverUrl: serverUrl ?? config.serverUrl ?? "",
        apiKey: config.apiKey ?? "",
        agentId: config.agentId ?? "",
      });
    } catch {
      throw new HubClientError(
        `Could not load AgentHub config from ${configPath}. Run 'agentsmith hub register' first.`,
      );
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.serverUrl}${path}`;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);

        const headers: Record<string, string> = {
          Authorization: `Bearer ${this.apiKey}`,
        };
        if (body) headers["Content-Type"] = "application/json";

        const res = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!res.ok) {
          throw new HubClientError(
            `Hub API error: ${res.status} ${res.statusText}`,
            res.status,
          );
        }

        const text = await res.text();
        return text ? (JSON.parse(text) as T) : ({} as T);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (
          lastError.name === "AbortError" ||
          (lastError instanceof HubClientError && lastError.status && lastError.status < 500)
        ) {
          throw lastError;
        }
        if (attempt < MAX_RETRIES - 1) {
          await new Promise((r) =>
            setTimeout(r, RETRY_BASE_MS * 2 ** attempt),
          );
        }
      }
    }
    throw lastError ?? new HubClientError("Request failed after retries");
  }

  async health(): Promise<HubHealthResponse> {
    return this.request<HubHealthResponse>("GET", "/api/health");
  }

  async registerAgent(id: string): Promise<HubAgent> {
    return this.request<HubAgent>("POST", "/api/register", { id });
  }

  async createChannel(
    name: string,
    description?: string,
  ): Promise<HubChannel> {
    return this.request<HubChannel>("POST", "/api/channels", {
      name,
      description,
    });
  }

  async listChannels(): Promise<HubChannel[]> {
    return this.request<HubChannel[]>("GET", "/api/channels");
  }

  async post(channel: string, content: string): Promise<HubPost> {
    return this.request<HubPost>(
      "POST",
      `/api/channels/${encodeURIComponent(channel)}/posts`,
      { content },
    );
  }

  async pushBundle(bundleBase64: string, message?: string): Promise<HubCommit> {
    return this.request<HubCommit>("POST", "/api/git/push", {
      bundle: bundleBase64,
      message,
    });
  }

  async fetchCommit(hash: string): Promise<{ bundle: string }> {
    return this.request<{ bundle: string }>(
      "GET",
      `/api/git/fetch/${encodeURIComponent(hash)}`,
    );
  }

  async listCommits(options?: HubListOptions): Promise<HubCommit[]> {
    const params = new URLSearchParams();
    if (options?.agent) params.set("agent", options.agent);
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.offset) params.set("offset", String(options.offset));
    const qs = params.toString();
    return this.request<HubCommit[]>(
      "GET",
      `/api/git/commits${qs ? `?${qs}` : ""}`,
    );
  }

  async getCommit(hash: string): Promise<HubCommit> {
    return this.request<HubCommit>(
      "GET",
      `/api/git/commits/${encodeURIComponent(hash)}`,
    );
  }

  async getChildren(hash: string): Promise<HubCommit[]> {
    return this.request<HubCommit[]>(
      "GET",
      `/api/git/commits/${encodeURIComponent(hash)}/children`,
    );
  }

  async getLineage(hash: string): Promise<HubCommit[]> {
    return this.request<HubCommit[]>(
      "GET",
      `/api/git/commits/${encodeURIComponent(hash)}/lineage`,
    );
  }

  async getLeaves(): Promise<HubCommit[]> {
    return this.request<HubCommit[]>("GET", "/api/git/leaves");
  }

  async diff(hashA: string, hashB: string): Promise<HubDiffResponse> {
    return this.request<HubDiffResponse>(
      "GET",
      `/api/git/diff/${encodeURIComponent(hashA)}/${encodeURIComponent(hashB)}`,
    );
  }

  getServerUrl(): string {
    return this.serverUrl;
  }

  getAgentId(): string {
    return this.agentId;
  }
}
