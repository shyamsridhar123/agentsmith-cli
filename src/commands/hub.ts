/**
 * Hub Command - AgentHub Management
 * CLI subcommands for interacting with AgentHub.
 * "Welcome to the real world."
 */

import chalk from "chalk";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  HubClient,
  HubClientError,
  normalizeHubServerUrl,
} from "../hub/client.js";
import type { HubConfigFile } from "../hub/types.js";

export interface HubCommandOptions {
  verbose?: boolean;
  force?: boolean;
}

export async function hubCommand(
  subcommand: string,
  args: string[],
  options: HubCommandOptions,
): Promise<void> {
  switch (subcommand) {
    case "status":
      return hubStatus(options);
    case "register":
      return hubRegister(args[0], args[1], options);
    case "diff":
      return hubDiff(args[0], args[1]);
    case "log":
      return hubLog(options);
    case "channels":
      return hubChannels();
    default:
      console.log(chalk.red(`Unknown hub subcommand: ${subcommand}`));
      console.log("Available: status, register, diff, log, channels");
      process.exitCode = 1;
  }
}

async function hubStatus(options: { verbose?: boolean }): Promise<void> {
  try {
    const client = await HubClient.fromConfigFile();
    const health = await client.health();
    console.log(chalk.green("✓"), `Hub is ${health.status}`);
    console.log(chalk.gray(`  Server: ${client.getServerUrl()}`));
    console.log(chalk.gray(`  Agent: ${client.getAgentId()}`));

    if (options.verbose) {
      const commits = await client.listCommits({ limit: 1 });
      const channels = await client.listChannels();
      console.log(chalk.gray(`  Commits: ${commits.length > 0 ? "available" : "none"}`));
      console.log(chalk.gray(`  Channels: ${channels.length}`));
    }
  } catch (err) {
    handleHubError(err);
  }
}

async function hubRegister(
  serverUrl?: string,
  agentId?: string,
  options: HubCommandOptions = {},
): Promise<void> {
  if (!serverUrl?.trim() || !agentId?.trim()) {
    console.log(chalk.red("Usage: agentsmith hub register <server-url> <agent-id>"));
    process.exitCode = 1;
    return;
  }

  if (!/^https?:\/\//.test(serverUrl)) {
    console.log(chalk.red("Invalid server URL: must start with http:// or https://"));
    process.exitCode = 1;
    return;
  }

  try {
    const normalizedServerUrl = normalizeHubServerUrl(serverUrl);
    const alreadyConfigured = await assertConfigReplacementAllowed(
      normalizedServerUrl,
      agentId,
      options.force === true,
    );
    if (alreadyConfigured) {
      const existingClient = await HubClient.fromConfigFile(
        normalizedServerUrl,
        { timeoutMs: 5_000, maxRetries: 1 },
      );
      await existingClient.health();
      console.log(
        chalk.green("✓"),
        `Stored credentials for agent "${agentId}" are valid`,
      );
      return;
    }
    const tempClient = new HubClient({
      serverUrl: normalizedServerUrl,
      apiKey: "",
      agentId,
    });

    await tempClient.health();
    const configDir = await prepareHubConfigDirectory();

    const result = await tempClient.registerAgent(agentId);
    if (!result.id?.trim() || !result.api_key?.trim()) {
      throw new HubClientError(
        "AgentHub returned an invalid registration response.",
      );
    }

    let configPath: string;
    try {
      configPath = await saveHubConfig({
        server_url: normalizedServerUrl,
        api_key: result.api_key,
        agent_id: result.id,
      }, configDir);
    } catch (error) {
      throw new HubClientError(
        `Agent "${result.id}" was registered, but its credentials could not be saved securely: ${
          error instanceof Error ? error.message : String(error)
        }. Ask the hub administrator to remove the orphaned agent before retrying, or register with a new agent id.`,
      );
    }

    console.log(chalk.green("✓"), `Agent "${result.id}" registered`);
    console.log(chalk.gray(`  Config saved to ${configPath}`));
  } catch (err) {
    handleHubError(err);
  }
}

async function hubDiff(
  hashA?: string,
  hashB?: string,
): Promise<void> {
  if (!hashA?.trim() || !hashB?.trim()) {
    console.log(chalk.red("Usage: agentsmith hub diff <hash-a> <hash-b>"));
    process.exitCode = 1;
    return;
  }

  try {
    const client = await HubClient.fromConfigFile();
    console.log(await client.diff(hashA, hashB));
  } catch (err) {
    handleHubError(err);
  }
}

async function hubLog(options: { verbose?: boolean }): Promise<void> {
  try {
    const client = await HubClient.fromConfigFile();
    const commits = await client.listCommits({ limit: 10 });

    if (commits.length === 0) {
      console.log(chalk.gray("No recorded runs found."));
      return;
    }

    console.log(chalk.green("Recent runs:\n"));
    for (const c of commits) {
      const hash = c.hash.slice(0, 8);
      const date = new Date(c.created_at).toLocaleDateString();
      console.log(`  ${chalk.yellow(hash)} ${c.message} ${chalk.gray(`(${date})`)}`);
      if (options.verbose) {
        console.log(chalk.gray(`         agent: ${c.agent_id}, parent: ${c.parent_hash?.slice(0, 8) ?? "none"}`));
      }
    }
  } catch (err) {
    handleHubError(err);
  }
}

async function hubChannels(): Promise<void> {
  try {
    const client = await HubClient.fromConfigFile();
    const channels = await client.listChannels();

    if (channels.length === 0) {
      console.log(chalk.gray("No channels found."));
      return;
    }

    console.log(chalk.green("Channels:\n"));
    for (const ch of channels) {
      console.log(`  #${chalk.cyan(ch.name)}${ch.description ? ` — ${ch.description}` : ""}`);
    }
  } catch (err) {
    handleHubError(err);
  }
}

function handleHubError(err: unknown): void {
  if (err instanceof HubClientError) {
    console.log(chalk.red("✗"), err.message);
  } else {
    console.log(chalk.red("✗"), `Hub error: ${err instanceof Error ? err.message : String(err)}`);
  }
  process.exitCode = 1;
}

async function prepareHubConfigDirectory(): Promise<string> {
  const configDir = join(homedir(), ".agenthub");
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  await chmod(configDir, 0o700);
  if (process.platform === "win32") {
    await restrictWindowsAcl(configDir, true);
  }
  return configDir;
}

export async function saveHubConfig(
  config: HubConfigFile,
  preparedConfigDir?: string,
): Promise<string> {
  const configDir = preparedConfigDir ?? await prepareHubConfigDirectory();
  const configPath = join(configDir, "config.json");
  const tempPath = join(
    configDir,
    `.config-${process.pid}-${Date.now()}.tmp`,
  );

  try {
    await writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf-8",
      mode: 0o600,
      flag: "wx",
    });
    await chmod(tempPath, 0o600);
    await rename(tempPath, configPath);
    await chmod(configPath, 0o600);
    return configPath;
  } finally {
    await rm(tempPath, { force: true }).catch(() => {});
  }
}

async function assertConfigReplacementAllowed(
  serverUrl: string,
  agentId: string,
  force: boolean,
): Promise<boolean> {
  if (force) return false;

  const configPath = join(homedir(), ".agenthub", "config.json");
  let raw: string;
  try {
    raw = await readFile(configPath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }

  let current: Partial<HubConfigFile> & {
    serverUrl?: string;
    agentId?: string;
  };
  try {
    current = JSON.parse(raw) as typeof current;
  } catch {
    throw new HubClientError(
      `Existing AgentHub config at ${configPath} is invalid. Use --force to replace it.`,
    );
  }

  const currentServer = current.server_url ?? current.serverUrl;
  const currentAgent = current.agent_id ?? current.agentId;
  if (currentServer && currentAgent) {
    try {
      if (
        normalizeHubServerUrl(currentServer) === serverUrl &&
        currentAgent === agentId
      ) {
        return true;
      }
    } catch {
      // Fall through to the recoverable --force error below.
    }
  }

  throw new HubClientError(
    `Refusing to overwrite existing AgentHub credentials at ${configPath}. Use --force to replace them.`,
  );
}

async function restrictWindowsAcl(
  filePath: string,
  isDirectory: boolean,
): Promise<void> {
  const whoami = await execFileText("whoami", ["/user", "/fo", "csv", "/nh"]);
  const sid = whoami.match(/"(S-\d+(?:-\d+)+)"/)?.[1];
  if (!sid) {
    throw new HubClientError(
      "Failed to determine the current Windows user SID for AgentHub config security.",
    );
  }
  const permission = isDirectory ? "(OI)(CI)F" : "F";
  await execFileText(
    "icacls",
    [
      filePath,
      "/inheritance:r",
      "/grant:r",
      `*${sid}:${permission}`,
    ],
  );
}

function execFileText(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      (error, stdout) => {
        if (error) {
          reject(new HubClientError(
            `Failed to run ${file} while securing AgentHub config: ${error.message}`,
          ));
          return;
        }
        resolve(stdout);
      },
    );
  });
}
