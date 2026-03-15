/**
 * Tests for src/github/index.ts
 * GitHub API client, URL parsing, error handling.
 *
 * NOTE: This test file mocks child_process.execFile (the safe,
 * non-shell variant) to test the GitHubClient without network calls.
 * No actual child processes are spawned.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// We mock the promisified execFile used by the GitHub client.
// vi.hoisted ensures the mock fn is created before vi.mock hoisting.
const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock("util", () => ({
  promisify: vi.fn(() => execFileMock),
}));

vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

import {
  parseGitHubUrl,
  GitHubClient,
  GitHubApiError,
  AuthenticationError,
  RateLimitError,
} from "../../src/github/index.js";

beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// parseGitHubUrl
// ---------------------------------------------------------------------------

describe("parseGitHubUrl", () => {
  it("parses https://github.com/owner/repo", () => {
    const result = parseGitHubUrl("https://github.com/owner/repo");
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });

  it("parses https://github.com/owner/repo.git", () => {
    const result = parseGitHubUrl("https://github.com/owner/repo.git");
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });

  it("parses git@github.com:owner/repo.git", () => {
    const result = parseGitHubUrl("git@github.com:owner/repo.git");
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });

  it("parses owner/repo shorthand", () => {
    const result = parseGitHubUrl("owner/repo");
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });

  it("throws on invalid URL without slash", () => {
    expect(() => parseGitHubUrl("invalid")).toThrow("Invalid GitHub URL");
  });

  it("handles repos with dots in the name", () => {
    const result = parseGitHubUrl("https://github.com/owner/my.repo.name");
    expect(result).toEqual({ owner: "owner", repo: "my.repo.name" });
  });

  it("handles repos with hyphens in the name", () => {
    const result = parseGitHubUrl("https://github.com/my-org/my-repo");
    expect(result).toEqual({ owner: "my-org", repo: "my-repo" });
  });
});

// ---------------------------------------------------------------------------
// GitHubClient — getRepoInfo
// ---------------------------------------------------------------------------

describe("GitHubClient.getRepoInfo", () => {
  it("parses repository metadata from API response", async () => {
    execFileMock.mockResolvedValue({
      stdout: JSON.stringify({
        default_branch: "main",
        license: { spdx_id: "MIT" },
      }),
    });

    const client = new GitHubClient("https://github.com/test/repo");
    const info = await client.getRepoInfo();

    expect(info.owner).toBe("test");
    expect(info.repo).toBe("repo");
    expect(info.defaultBranch).toBe("main");
    expect(info.license).toBe("MIT");
  });

  it("handles missing license", async () => {
    execFileMock.mockResolvedValue({
      stdout: JSON.stringify({
        default_branch: "main",
        license: null,
      }),
    });

    const client = new GitHubClient("test/repo");
    const info = await client.getRepoInfo();
    expect(info.license).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// GitHubClient — getTree
// ---------------------------------------------------------------------------

describe("GitHubClient.getTree", () => {
  it("filters and maps tree entries", async () => {
    // First call returns repo info (for defaultBranch), second returns tree
    execFileMock
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ default_branch: "main" }),
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          tree: [
            { path: "src/index.ts", type: "blob", size: 100, sha: "abc" },
            { path: "src", type: "tree", sha: "def" },
            { path: ".github", type: "commit", sha: "ghi" }, // Should be filtered
          ],
        }),
      });

    const client = new GitHubClient("test/repo");
    const tree = await client.getTree();

    expect(tree).toHaveLength(2);
    expect(tree[0]).toEqual({
      path: "src/index.ts",
      type: "file",
      size: 100,
      sha: "abc",
    });
    expect(tree[1]).toEqual({
      path: "src",
      type: "dir",
      size: undefined,
      sha: "def",
    });
  });

  it("uses provided branch name instead of fetching default", async () => {
    execFileMock.mockResolvedValue({
      stdout: JSON.stringify({ tree: [] }),
    });

    const client = new GitHubClient("test/repo");
    await client.getTree("develop");

    // Should only call once (for tree), not twice (no getRepoInfo)
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// GitHubClient — getFileContent
// ---------------------------------------------------------------------------

describe("GitHubClient.getFileContent", () => {
  it("decodes base64 file content", async () => {
    const encoded = Buffer.from("Hello World").toString("base64");
    execFileMock.mockResolvedValue({
      stdout: JSON.stringify({ content: encoded, encoding: "base64" }),
    });

    const client = new GitHubClient("test/repo");
    const content = await client.getFileContent("README.md");
    expect(content).toBe("Hello World");
  });

  it("returns raw content when not base64", async () => {
    execFileMock.mockResolvedValue({
      stdout: JSON.stringify({ content: "raw text", encoding: "utf-8" }),
    });

    const client = new GitHubClient("test/repo");
    const content = await client.getFileContent("file.txt");
    expect(content).toBe("raw text");
  });

  it("returns empty string on error", async () => {
    execFileMock.mockRejectedValue(new Error("Not found"));

    const client = new GitHubClient("test/repo");
    const content = await client.getFileContent("missing.txt");
    expect(content).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("GitHubClient — error handling", () => {
  it("throws AuthenticationError on 401", async () => {
    execFileMock.mockRejectedValue({
      message: "401 Unauthorized",
      stderr: "gh: auth login required",
    });

    const client = new GitHubClient("test/repo");
    await expect(client.getRepoInfo()).rejects.toThrow(AuthenticationError);
  });

  it("throws AuthenticationError on 403", async () => {
    execFileMock.mockRejectedValue({
      message: "403 Forbidden",
      stderr: "",
    });

    const client = new GitHubClient("test/repo");
    await expect(client.getRepoInfo()).rejects.toThrow(AuthenticationError);
  });

  it("throws RateLimitError after max retries on 429", async () => {
    // All attempts fail with rate limit
    execFileMock.mockRejectedValue({
      message: "429 Too Many Requests",
      stderr: "rate limit exceeded",
    });

    const client = new GitHubClient("test/repo");
    await expect(client.getRepoInfo()).rejects.toThrow(RateLimitError);
  });

  it("throws GitHubApiError on other errors", async () => {
    execFileMock.mockRejectedValue({
      message: "500 Internal Server Error",
      stderr: "server error",
    });

    const client = new GitHubClient("test/repo");
    await expect(client.getRepoInfo()).rejects.toThrow(GitHubApiError);
  });
});

// ---------------------------------------------------------------------------
// Error class hierarchy
// ---------------------------------------------------------------------------

describe("Error classes", () => {
  it("AuthenticationError is a GitHubApiError", () => {
    const err = new AuthenticationError();
    expect(err).toBeInstanceOf(GitHubApiError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AuthenticationError");
  });

  it("RateLimitError is a GitHubApiError", () => {
    const err = new RateLimitError(60);
    expect(err).toBeInstanceOf(GitHubApiError);
    expect(err.retryAfter).toBe(60);
    expect(err.name).toBe("RateLimitError");
  });

  it("GitHubApiError carries statusCode", () => {
    const err = new GitHubApiError("test", 404);
    expect(err.statusCode).toBe(404);
    expect(err.name).toBe("GitHubApiError");
  });
});

// ---------------------------------------------------------------------------
// fullName getter
// ---------------------------------------------------------------------------

describe("GitHubClient.fullName", () => {
  it("returns owner/repo format", () => {
    const client = new GitHubClient("https://github.com/myorg/myrepo");
    expect(client.fullName).toBe("myorg/myrepo");
  });
});
