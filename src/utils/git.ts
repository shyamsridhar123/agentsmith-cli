/**
 * Git utilities for cloning repositories
 */

import { simpleGit } from "simple-git";
import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";

export interface CloneResult {
  path: string;
  isTemporary: boolean;
  cleanup: () => Promise<void>;
}

/**
 * Check if a string is a GitHub URL
 */
export function isGitHubUrl(input: string): boolean {
  return (
    input.startsWith("https://github.com/") ||
    input.startsWith("git@github.com:") ||
    input.startsWith("github.com/")
  );
}

/**
 * Normalize a GitHub URL to https format
 */
export function normalizeGitHubUrl(input: string): string {
  let url = input;
  if (url.startsWith("github.com/")) {
    url = `https://${url}`;
  } else if (url.startsWith("git@github.com:")) {
    url = url.replace("git@github.com:", "https://github.com/");
  }
  // Remove .git suffix if present
  return url.replace(/\.git$/, "");
}

/**
 * Extract repo name from GitHub URL
 */
export function getRepoName(url: string): string {
  const normalized = normalizeGitHubUrl(url);
  const parts = normalized.split("/");
  return parts[parts.length - 1] || "repo";
}

/**
 * Clone a GitHub repository to a temporary directory
 */
export async function cloneRepo(url: string): Promise<CloneResult> {
  const normalizedUrl = normalizeGitHubUrl(url);
  const repoName = getRepoName(url);
  const hash = crypto.randomBytes(4).toString("hex");
  const tempDir = path.join(os.tmpdir(), `agentsmith-${repoName}-${hash}`);

  // Create temp directory
  await fs.mkdir(tempDir, { recursive: true });

  // Clone with shallow depth for speed
  const git = simpleGit();
  await git.clone(normalizedUrl, tempDir, ["--depth", "1"]);

  return {
    path: tempDir,
    isTemporary: true,
    cleanup: async () => {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}

/**
 * Resolve input to a local path, cloning if necessary
 */
export async function resolveInput(input: string): Promise<CloneResult> {
  if (isGitHubUrl(input)) {
    return cloneRepo(input);
  }

  // Local path
  const absolutePath = path.resolve(input);
  return {
    path: absolutePath,
    isTemporary: false,
    cleanup: async () => {
      // Nothing to clean up for local paths
    },
  };
}
