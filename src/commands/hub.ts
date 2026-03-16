/**
 * Hub Command - AgentHub Management
 * CLI subcommands for interacting with AgentHub.
 * "Welcome to the real world."
 */

import chalk from "chalk";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { HubClient, HubClientError } from "../hub/client.js";

export async function hubCommand(
  subcommand: string,
  args: string[],
  options: { verbose?: boolean },
): Promise<void> {
  switch (subcommand) {
    case "status":
      return hubStatus(options);
    case "register":
      return hubRegister(args[0], args[1], options);
    case "diff":
      return hubDiff(args[0], args[1], options);
    case "log":
      return hubLog(options);
    case "channels":
      return hubChannels(options);
    default:
      console.log(chalk.red(`Unknown hub subcommand: ${subcommand}`));
      console.log("Available: status, register, diff, log, channels");
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
  _options?: { verbose?: boolean },
): Promise<void> {
  if (!serverUrl?.trim() || !agentId?.trim()) {
    console.log(chalk.red("Usage: agentsmith hub register <server-url> <agent-id>"));
    return;
  }

  if (!/^https?:\/\//.test(serverUrl)) {
    console.log(chalk.red("Invalid server URL: must start with http:// or https://"));
    return;
  }

  try {
    const tempClient = new HubClient({
      serverUrl,
      apiKey: "",
      agentId,
    });

    await tempClient.health();

    const result = await tempClient.registerAgent(agentId);

    const configDir = join(homedir(), ".agenthub");
    await mkdir(configDir, { recursive: true });
    const configPath = join(configDir, "config.json");
    const config = {
      serverUrl,
      apiKey: result.api_key,
      agentId: result.id,
    };
    await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");

    console.log(chalk.green("✓"), `Agent "${result.id}" registered`);
    console.log(chalk.gray(`  Config saved to ${configPath}`));
  } catch (err) {
    handleHubError(err);
  }
}

async function hubDiff(
  hashA?: string,
  hashB?: string,
  _options?: { verbose?: boolean },
): Promise<void> {
  if (!hashA?.trim() || !hashB?.trim()) {
    console.log(chalk.red("Usage: agentsmith hub diff <hash-a> <hash-b>"));
    return;
  }

  try {
    const client = await HubClient.fromConfigFile();
    const result = await client.diff(hashA, hashB);
    console.log(result.diff);
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

async function hubChannels(_options?: { verbose?: boolean }): Promise<void> {
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
}
