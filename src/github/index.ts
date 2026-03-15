/**
 * GitHub API Client - Direct repo access without cloning
 * Uses GitHub CLI (gh) for authentication via execFile (no shell spawned)
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

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
    const args = ["api", `repos/${this.owner}/${this.repo}${endpoint}`];

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

        // Authentication failure — no point retrying
        if (
          combined.includes("auth login") ||
          combined.includes("401") ||
          combined.includes("403") ||
          combined.includes("Not logged in")
        ) {
          throw new AuthenticationError();
        }

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

        // Any other error — wrap and throw immediately
        throw new GitHubApiError(
          `GitHub API call failed: ${message || stderr}`,
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
    const data = JSON.parse(await this.api(""));
    return {
      owner: this.owner,
      repo: this.repo,
      defaultBranch: data.default_branch,
      license: data.license?.spdx_id,
    };
  }

  /**
   * Get the file tree (recursive)
   */
  async getTree(branch?: string): Promise<GitHubFile[]> {
    const ref = branch || (await this.getRepoInfo()).defaultBranch;
    const data = JSON.parse(await this.api(`/git/trees/${ref}?recursive=1`));

    return data.tree
      .filter((item: any) => item.type === "blob" || item.type === "tree")
      .map((item: any) => ({
        path: item.path,
        type: item.type === "blob" ? "file" : "dir",
        size: item.size,
        sha: item.sha,
      }));
  }

  /**
   * Get file content by path
   */
  async getFileContent(path: string): Promise<string> {
    try {
      const data = JSON.parse(await this.api(`/contents/${path}`));
      if (data.encoding === "base64") {
        return Buffer.from(data.content, "base64").toString("utf-8");
      }
      return data.content || "";
    } catch (error) {
      if (this.verbose) {
        console.log(
          `  [GH] Failed to fetch ${path}: ${(error as Error).message}`,
        );
      }
      return "";
    }
  }

  /**
   * Get multiple files in parallel
   */
  async getFiles(paths: string[]): Promise<Map<string, string>> {
    const results = new Map<string, string>();

    // Fetch in batches of 10 to avoid rate limits
    const batchSize = 10;
    for (let i = 0; i < paths.length; i += batchSize) {
      const batch = paths.slice(i, i + batchSize);
      const contents = await Promise.all(
        batch.map((p) => this.getFileContent(p)),
      );
      batch.forEach((p, idx) => results.set(p, contents[idx]));
    }

    return results;
  }

  get fullName(): string {
    return `${this.owner}/${this.repo}`;
  }
}
