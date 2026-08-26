import fs from "fs/promises";
import os from "os";
import path from "path";
import { z } from "zod";

const ConfigSchema = z.object({
  output: z.string().optional(),
  verbose: z.boolean().default(false),
  instructions: z.boolean().default(true),
  singleAgent: z.boolean().default(false),
  cache: z.boolean().default(true),
  cacheTtlSeconds: z.number().int().positive().max(604800).default(86400),
}).strict();

export type AgentSmithConfig = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG: AgentSmithConfig = ConfigSchema.parse({});

async function readConfig(filePath: string): Promise<Partial<AgentSmithConfig>> {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(filePath, "utf-8"));
    return ConfigSchema.partial().parse(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Invalid AgentSmith config at ${filePath}: ${(error as Error).message}`);
  }
}

function envConfig(env: NodeJS.ProcessEnv): Partial<AgentSmithConfig> {
  const result: Partial<AgentSmithConfig> = {};
  if (env.AGENTSMITH_OUTPUT) result.output = env.AGENTSMITH_OUTPUT;
  if (env.AGENTSMITH_VERBOSE) result.verbose = env.AGENTSMITH_VERBOSE === "1";
  if (env.AGENTSMITH_CACHE) result.cache = env.AGENTSMITH_CACHE !== "0";
  if (env.AGENTSMITH_CACHE_TTL) {
    const parsed = Number(env.AGENTSMITH_CACHE_TTL);
    if (Number.isInteger(parsed) && parsed > 0) result.cacheTtlSeconds = parsed;
  }
  return result;
}

export async function loadConfig(
  projectRoot: string,
  overrides: Partial<AgentSmithConfig> = {},
): Promise<AgentSmithConfig> {
  const userConfig = process.platform === "win32"
    ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "agentsmith", "config.json")
    : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "agentsmith", "config.json");
  const projectConfig = path.join(projectRoot, ".agentsmithrc.json");
  return ConfigSchema.parse({
    ...DEFAULT_CONFIG,
    ...await readConfig(userConfig),
    ...await readConfig(projectConfig),
    ...envConfig(process.env),
    ...Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined)),
  });
}
