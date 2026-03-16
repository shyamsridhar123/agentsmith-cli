/**
 * Hub Recorder - Run Provenance Recording
 * Pushes assimilation results to AgentHub as git commits.
 * "The purpose of life is to end."
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import type { HubClient } from "./client.js";
import type { AnalysisResult } from "../analyzer/types.js";

const execFileAsync = promisify(execFile);

export interface RecordResult {
  success: boolean;
  commitHash?: string;
  summaryPosted?: boolean;
  error?: string;
}

/**
 * Record an assimilation run to AgentHub.
 * Creates a temp git repo, commits generated files, bundles, and pushes.
 */
export async function recordRun(
  analysis: AnalysisResult,
  generatedFiles: Map<string, string>,
  hubClient: HubClient,
): Promise<RecordResult> {
  let tempDir: string | undefined;

  try {
    tempDir = await mkdtemp(join(tmpdir(), "agentsmith-record-"));

    await execFileAsync("git", ["init", tempDir]);
    await execFileAsync("git", ["-C", tempDir, "config", "user.email", "agentsmith@generated"]);
    await execFileAsync("git", ["-C", tempDir, "config", "user.name", "AgentSmith"]);

    for (const [filePath, content] of generatedFiles) {
      const fullPath = join(tempDir, filePath);
      const dir = dirname(fullPath);
      await mkdir(dir, { recursive: true });
      await writeFile(fullPath, content, "utf-8");
    }

    await execFileAsync("git", ["-C", tempDir, "add", "."]);

    const message = buildCommitMessage(analysis);
    await execFileAsync("git", ["-C", tempDir, "commit", "-m", message]);

    const bundlePath = join(tempDir, "run.bundle");
    await execFileAsync("git", ["-C", tempDir, "bundle", "create", bundlePath, "HEAD"]);

    const { readFile } = await import("node:fs/promises");
    const bundleBuffer = await readFile(bundlePath);
    const bundleBase64 = bundleBuffer.toString("base64");

    const commit = await hubClient.pushBundle(bundleBase64, message);

    return { success: true, commitHash: commit.hash };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/**
 * Post a structured run summary to the hub's runs channel.
 */
export async function postRunSummary(
  analysis: AnalysisResult,
  channel: string,
  hubClient: HubClient,
  commitHash?: string,
): Promise<boolean> {
  try {
    const summary = buildRunSummary(analysis, commitHash);
    await hubClient.post(channel, summary);
    return true;
  } catch {
    return false;
  }
}

function buildCommitMessage(analysis: AnalysisResult): string {
  const skills = analysis.skills.length;
  const agents = analysis.agents.length;
  const repo = analysis.repoName;
  return `agentsmith: assimilate ${repo} (${skills} skills, ${agents} agents)`;
}

function buildRunSummary(analysis: AnalysisResult, commitHash?: string): string {
  const lines = [
    `## AgentSmith Run: ${analysis.repoName}`,
    `**Timestamp:** ${new Date().toISOString()}`,
    `**Skills:** ${analysis.skills.length}`,
    `**Agents:** ${analysis.agents.length}`,
    `**Hooks:** ${analysis.hooks.length}`,
  ];

  if (analysis.repo) {
    lines.push(`**Language:** ${analysis.repo.language}`);
    if (analysis.repo.framework) lines.push(`**Framework:** ${analysis.repo.framework}`);
    if (analysis.repo.license) lines.push(`**License:** ${analysis.repo.license}`);
  }

  if (commitHash) {
    lines.push(`**Commit:** \`${commitHash}\``);
  }

  lines.push("", `**Summary:** ${analysis.summary}`);

  return lines.join("\n");
}
