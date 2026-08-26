/**
 * Hub Recorder - Run Provenance Recording
 * Pushes assimilation results to AgentHub as git commits.
 * "The purpose of life is to end."
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { join, dirname, resolve, relative, isAbsolute, sep } from "node:path";
import { tmpdir } from "node:os";
import { HubClientError, type HubClient } from "./client.js";
import type { AnalysisResult } from "../analyzer/types.js";
import { buildChannelNames } from "../generator/hub-writer.js";

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
  if (generatedFiles.size === 0) {
    return { success: false, error: "No generated files were available to record." };
  }

  let tempDir: string | undefined;

  try {
    tempDir = await mkdtemp(join(tmpdir(), "agentsmith-record-"));
    const gitEnvironment: NodeJS.ProcessEnv = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
      ),
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    };
    const runGit = (args: string[]) =>
      execFileAsync("git", args, { env: gitEnvironment });

    await runGit(["-c", "init.defaultBranch=main", "init", tempDir]);
    await runGit(["-C", tempDir, "config", "user.email", "agentsmith@generated"]);
    await runGit(["-C", tempDir, "config", "user.name", "AgentSmith"]);

    for (const [filePath, content] of generatedFiles) {
      const fullPath = resolve(tempDir, filePath);
      const relativePath = relative(tempDir, fullPath);
      if (
        relativePath === ".." ||
        relativePath.startsWith(`..${sep}`) ||
        isAbsolute(relativePath)
      ) {
        throw new Error(`Refusing to record file outside the run directory: ${filePath}`);
      }
      const dir = dirname(fullPath);
      await mkdir(dir, { recursive: true });
      await writeFile(fullPath, content, "utf-8");
    }

    await runGit(["-C", tempDir, "add", "."]);

    const message = buildCommitMessage(analysis);
    await runGit(["-C", tempDir, "commit", "-m", message]);

    const bundlePath = join(tempDir, "run.bundle");
    await runGit(["-C", tempDir, "bundle", "create", bundlePath, "HEAD"]);

    const bundleBuffer = await readFile(bundlePath);
    const pushResult = await hubClient.pushBundle(bundleBuffer);
    const commitHash = pushResult.hashes[0];
    if (!commitHash) {
      throw new Error("AgentHub accepted the bundle but returned no commit hash.");
    }

    return { success: true, commitHash };
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

export async function ensureCoordinationChannels(
  repoName: string,
  hubClient: HubClient,
): Promise<string[]> {
  const channels = buildChannelNames(repoName);
  const descriptions: Record<string, string> = {
    [channels.exploration]: `Exploration notes for ${repoName}`,
    [channels.results]: `AgentSmith run results for ${repoName}`,
    [channels.reviews]: `Review findings for ${repoName}`,
  };
  const existing = new Set((await hubClient.listChannels()).map((channel) => channel.name));
  const created = await Promise.all(
    Object.keys(descriptions).map(async (name) => {
      if (existing.has(name)) return undefined;
      try {
        await hubClient.createChannel(name, descriptions[name]);
        return name;
      } catch (error) {
        if (error instanceof HubClientError && error.status === 409) {
          return undefined;
        }
        const refreshed = await hubClient.listChannels();
        if (refreshed.some((channel) => channel.name === name)) {
          return undefined;
        }
        throw error;
      }
    }),
  );

  return created.filter((name): name is string => name !== undefined);
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

function escapeMarkdown(str: string): string {
  return str.replace(/[\\`*_{}[\]()#+.!|>~]/g, "\\$&");
}

function buildRunSummary(analysis: AnalysisResult, commitHash?: string): string {
  const repoName = escapeMarkdown(analysis.repoName);
  const lines = [
    `## AgentSmith Run: ${repoName}`,
    `**Timestamp:** ${new Date().toISOString()}`,
    `**Skills:** ${analysis.skills.length}`,
    `**Agents:** ${analysis.agents.length}`,
    `**Hooks:** ${analysis.hooks.length}`,
  ];

  if (analysis.repo) {
    lines.push(`**Language:** ${escapeMarkdown(analysis.repo.language)}`);
    if (analysis.repo.framework) lines.push(`**Framework:** ${escapeMarkdown(analysis.repo.framework)}`);
    if (analysis.repo.license) lines.push(`**License:** ${escapeMarkdown(analysis.repo.license)}`);
  }

  if (commitHash) {
    lines.push(`**Commit:** \`${commitHash}\``);
  }

  lines.push("", `**Summary:** ${escapeMarkdown(analysis.summary)}`);

  return lines.join("\n");
}
