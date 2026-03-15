/**
 * Tests for src/utils/git.ts
 * URL parsing, normalization, and repo name extraction.
 */

import { describe, it, expect } from "vitest";
import {
  isGitHubUrl,
  normalizeGitHubUrl,
  getRepoName,
} from "../../src/utils/git.js";

// ---------------------------------------------------------------------------
// isGitHubUrl
// ---------------------------------------------------------------------------

describe("isGitHubUrl", () => {
  it("returns true for https://github.com/owner/repo", () => {
    expect(isGitHubUrl("https://github.com/owner/repo")).toBe(true);
  });

  it("returns true for https://github.com/owner/repo.git", () => {
    expect(isGitHubUrl("https://github.com/owner/repo.git")).toBe(true);
  });

  it("returns true for git@github.com:owner/repo.git", () => {
    expect(isGitHubUrl("git@github.com:owner/repo.git")).toBe(true);
  });

  it("returns true for github.com/owner/repo", () => {
    expect(isGitHubUrl("github.com/owner/repo")).toBe(true);
  });

  it("returns false for local path", () => {
    expect(isGitHubUrl("/home/user/project")).toBe(false);
  });

  it("returns false for non-GitHub URL", () => {
    expect(isGitHubUrl("https://gitlab.com/owner/repo")).toBe(false);
  });

  it("returns false for relative path", () => {
    expect(isGitHubUrl("./my-project")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isGitHubUrl("")).toBe(false);
  });

  it("returns false for a bare name", () => {
    expect(isGitHubUrl("my-project")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// normalizeGitHubUrl
// ---------------------------------------------------------------------------

describe("normalizeGitHubUrl", () => {
  it("prepends https:// to github.com/ URLs", () => {
    expect(normalizeGitHubUrl("github.com/owner/repo")).toBe(
      "https://github.com/owner/repo",
    );
  });

  it("converts git@github.com: to https://github.com/", () => {
    expect(normalizeGitHubUrl("git@github.com:owner/repo.git")).toBe(
      "https://github.com/owner/repo",
    );
  });

  it("strips .git suffix from https URLs", () => {
    expect(normalizeGitHubUrl("https://github.com/owner/repo.git")).toBe(
      "https://github.com/owner/repo",
    );
  });

  it("leaves clean https URLs unchanged", () => {
    expect(normalizeGitHubUrl("https://github.com/owner/repo")).toBe(
      "https://github.com/owner/repo",
    );
  });
});

// ---------------------------------------------------------------------------
// getRepoName
// ---------------------------------------------------------------------------

describe("getRepoName", () => {
  it("extracts repo name from https URL", () => {
    expect(getRepoName("https://github.com/owner/my-repo")).toBe("my-repo");
  });

  it("extracts repo name from git@ URL", () => {
    expect(getRepoName("git@github.com:owner/my-repo.git")).toBe("my-repo");
  });

  it("extracts repo name from github.com/ URL", () => {
    expect(getRepoName("github.com/owner/my-repo")).toBe("my-repo");
  });

  it("strips .git suffix", () => {
    expect(getRepoName("https://github.com/owner/my-repo.git")).toBe("my-repo");
  });

  it("returns 'repo' as fallback for edge case", () => {
    // A URL ending in / would produce an empty last segment
    expect(getRepoName("https://github.com/owner/")).toBe("repo");
  });
});
