/**
 * GitHub API Client - Direct repo access without cloning
 * Uses GitHub CLI (gh) for authentication via execFile (no shell spawned)
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

function encodePathComponent(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodeContentPath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodePathComponent(segment))
    .join("/");
}

function withRef(endpoint: string, ref?: string): string {
  return ref === undefined
    ? endpoint
    : `${endpoint}?ref=${encodePathComponent(ref)}`;
}

function parseHttpStatus(message: string): number | undefined {
  const explicitHttpStatus = message.match(/\bHTTP\s+(\d{3})\b/i);
  if (explicitHttpStatus) return Number(explicitHttpStatus[1]);

  const status = message.match(/\b([1-5]\d{2})\b/);
  return status ? Number(status[1]) : undefined;
}

function parseJson<T>(raw: string, context: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new GitHubApiError(
      `GitHub returned invalid JSON for ${context}: ${(error as Error).message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class GitHubApiError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = "GitHubApiError";
  }
}

export class AuthenticationError extends GitHubApiError {
  constructor() {
    super('GitHub authentication required. Run "gh auth login" first.');
    this.name = "AuthenticationError";
  }
}

export class RateLimitError extends GitHubApiError {
  constructor(public retryAfter?: number) {
    super(
      `GitHub API rate limit exceeded${retryAfter ? `. Retry after ${retryAfter}s` : ""}`,
    );
    this.name = "RateLimitError";
  }
}

// ---------------------------------------------------------------------------
// Shared interfaces
// ---------------------------------------------------------------------------

export interface GitHubFile {
  path: string;
  type: "file" | "dir";
  size?: number;
  sha: string;
}

export interface GitHubRepo {
  owner: string;
  repo: string;
  defaultBranch: string;
  license?: string;
}

export interface GitHubContent {
  path: string;
  content: string;
  size: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse GitHub URL into owner/repo
 */
export function parseGitHubUrl(url: string): { owner: string; repo: string } {
  // Handle various formats:
  // https://github.com/owner/repo
  // https://github.com/owner/repo.git
  // git@github.com:owner/repo.git
  // owner/repo

  let owner: string;
  let repo: string;

  if (url.includes("github.com")) {
    const match = url.match(/github\.com[/:]([\w-]+)\/([\w.-]+)/);
    if (!match) throw new Error(`Invalid GitHub URL: ${url}`);
    owner = match[1];
    repo = match[2].replace(/\.git$/, "");
  } else if (url.includes("/")) {
    [owner, repo] = url.split("/");
  } else {
    throw new Error(`Invalid GitHub URL: ${url}`);
  }

  return { owner, repo };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/** Maximum number of retries for rate-limited requests */
const MAX_RETRIES = 3;

/** Base delay in ms for exponential backoff */
const BASE_DELAY_MS = 1000;

/**
 * GitHub API client using gh CLI for auth.
 *
 * All I/O is non-blocking — uses `execFile` (promisified) instead of
 * `execSync`, and `execFile` does not spawn a shell (mitigating shell
 * injection).
 */
export class GitHubClient {
  private owner: string;
  private repo: string;
  private verbose: boolean;

  constructor(url: string, verbose = false) {
    const { owner, repo } = parseGitHubUrl(url);
    this.owner = owner;
    this.repo = repo;
    this.verbose = verbose;
  }

  /**
   * Execute a gh api command (non-blocking, no shell).
   *
   * Automatically retries on 429 (rate-limit) responses with exponential
   * backoff up to MAX_RETRIES times.
   */
  private async api(endpoint: string): Promise<string> {
    const encodedOwner = encodePathComponent(this.owner);
    const encodedRepo = encodePathComponent(this.repo);
    const args = ["api", `repos/${encodedOwner}/${encodedRepo}${endpoint}`];

    if (this.verbose) {
      console.log(`  [GH] gh ${args.join(" ")}`);
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const { stdout } = await execFileAsync("gh", args, {
          maxBuffer: 10 * 1024 * 1024,
          timeout: 30_000,
        });
        return stdout;
      } catch (error: unknown) {
        lastError = error as Error;
        const stderr = (error as { stderr?: string }).stderr ?? "";
        const message = (error as Error).message ?? "";
        const combined = `${stderr} ${message}`;
        const statusCode = parseHttpStatus(combined);

        // Rate limit — retry with backoff
        if (combined.includes("429") || combined.includes("rate limit")) {
          const retryMatch = combined.match(/retry.after[:\s]+(\d+)/i);
          const retryAfter = retryMatch ? parseInt(retryMatch[1], 10) : undefined;

          if (attempt < MAX_RETRIES) {
            const delay = retryAfter
              ? retryAfter * 1000
              : BASE_DELAY_MS * Math.pow(2, attempt);
            if (this.verbose) {
              console.log(
                `  [GH] Rate limited — retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
              );
            }
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
          throw new RateLimitError(retryAfter);
        }

        // Authentication failure — no point retrying. Check this after rate
        // limiting because GitHub can report exhausted quotas with HTTP 403.
        if (
          combined.includes("auth login") ||
          combined.includes("401") ||
          combined.includes("403") ||
          combined.includes("Not logged in")
        ) {
          throw new AuthenticationError();
        }

        // Any other error — wrap and throw immediately
        throw new GitHubApiError(
          `GitHub API call failed: ${message || stderr}`,
          statusCode,
        );
      }
    }

    // Should be unreachable, but satisfies the compiler
    throw lastError ?? new GitHubApiError("GitHub API call failed");
  }

  // -----------------------------------------------------------------------
  // Public API (unchanged signatures)
  // -----------------------------------------------------------------------

  /**
   * Get repository metadata
   */
  async getRepoInfo(): Promise<GitHubRepo> {
    const data = parseJson<{
      default_branch: string;
      license?: { spdx_id?: string } | null;
    }>(await this.api(""), this.fullName);
    return {
      owner: this.owner,
      repo: this.repo,
      defaultBranch: data.default_branch,
      license: data.license?.spdx_id,
    };
  }

  /**
   * Resolve a branch, tag, abbreviated SHA, or default branch to an immutable
   * commit SHA.
   */
  async resolveRevision(ref?: string): Promise<string> {
    const requestedRef = ref ?? (await this.getRepoInfo()).defaultBranch;
    const data = parseJson<{ sha?: string }>(
      await this.api(`/commits/${encodePathComponent(requestedRef)}`),
      `${this.fullName}@${requestedRef}`,
    );

    if (typeof data.sha !== "string" || data.sha.length === 0) {
      throw new GitHubApiError(
        `GitHub returned no commit SHA for ${this.fullName}@${requestedRef}.`,
      );
    }

    return data.sha;
  }

  /**
   * Get the repository license for the supplied revision.
   */
  async getLicense(ref?: string): Promise<string | undefined> {
    try {
      const data = parseJson<{
        license?: { spdx_id?: string } | null;
      }>(
        await this.api(withRef("/license", ref)),
        `${this.fullName} license${ref ? `@${ref}` : ""}`,
      );
      return data.license?.spdx_id;
    } catch (error) {
      if (error instanceof GitHubApiError && error.statusCode === 404) {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * Get the file tree (recursive)
   */
  async getTree(ref?: string): Promise<GitHubFile[]> {
    const requestedRef = ref ?? (await this.getRepoInfo()).defaultBranch;
    const data = parseJson<{
      truncated?: boolean;
      tree: Array<{
        path: string;
        type: "blob" | "tree";
        size?: number;
        sha: string;
      }>;
    }>(
      await this.api(
        `/git/trees/${encodePathComponent(requestedRef)}?recursive=1`,
      ),
      `${this.fullName} tree@${requestedRef}`,
    );

    if (data.truncated) {
      throw new GitHubApiError(
        `GitHub returned a truncated recursive tree for ${this.fullName}@${requestedRef}; ` +
        "the repository cannot be analyzed completely.",
      );
    }
    if (!Array.isArray(data.tree)) {
      throw new GitHubApiError(
        `GitHub returned an invalid tree response for ${this.fullName}@${requestedRef}.`,
      );
    }

    return data.tree
      .filter((item) => item.type === "blob" || item.type === "tree")
      .map((item) => ({
        path: item.path,
        type: item.type === "blob" ? "file" : "dir",
        size: item.size,
        sha: item.sha,
      }));
  }

  /**
   * Get file content by path
   */
  async getFileContent(path: string, ref?: string): Promise<string> {
    try {
      const data = parseJson<{
        content?: string;
        encoding?: string;
      }>(
        await this.api(
          withRef(`/contents/${encodeContentPath(path)}`, ref),
        ),
        `${this.fullName}/${path}${ref ? `@${ref}` : ""}`,
      );
      if (data.encoding === "base64") {
        if (typeof data.content !== "string") {
          throw new GitHubApiError(`GitHub returned no base64 content for ${path}.`);
        }
        return Buffer.from(data.content, "base64").toString("utf-8");
      }
      if (typeof data.content === "string") return data.content;
      throw new GitHubApiError(`GitHub returned no file content for ${path}.`);
    } catch (error) {
      if (this.verbose) {
        console.log(
          `  [GH] Failed to fetch ${path}: ${(error as Error).message}`,
        );
      }
      if (error instanceof AuthenticationError || error instanceof RateLimitError) {
        throw error;
      }
      if (error instanceof GitHubApiError) {
        throw new GitHubApiError(
          `Failed to fetch ${path}: ${error.message}`,
          error.statusCode,
        );
      }
      throw new GitHubApiError(
        `Failed to fetch ${path}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Get multiple files in parallel
   */
  async getFiles(
    paths: string[],
    ref?: string,
  ): Promise<Map<string, string>> {
    const results = new Map<string, string>();

    // Fetch in batches of 10 to avoid rate limits
    const batchSize = 10;
    for (let i = 0; i < paths.length; i += batchSize) {
      const batch = paths.slice(i, i + batchSize);
      const contents = await Promise.all(
        batch.map((p) => this.getFileContent(p, ref)),
      );
      batch.forEach((p, idx) => results.set(p, contents[idx]));
    }

    return results;
  }

  get fullName(): string {
    return `${this.owner}/${this.repo}`;
  }
}
