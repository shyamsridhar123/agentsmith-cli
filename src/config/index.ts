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

export type OutputSource =
  | "default"
  | "user"
  | "project"
  | "environment"
  | "override";

export interface LoadedAgentSmithConfig extends AgentSmithConfig {
  outputSource: OutputSource;
}

const PROJECT_OUTPUT_BOUNDARY_ERROR =
  "Project config output must stay within the repository and cannot use symbolic links or junctions";

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

function isPathWithin(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative === "" ||
    (
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    )
  );
}

function isNotFound(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

async function assertNoLinkedComponents(candidatePath: string): Promise<void> {
  const absoluteCandidate = path.resolve(candidatePath);
  const root = path.parse(absoluteCandidate).root;
  const relative = path.relative(root, absoluteCandidate);
  const segments = relative === ""
    ? []
    : relative.split(path.sep).filter(Boolean);
  let current = root;

  const inspect = async (componentPath: string, isLeaf: boolean): Promise<boolean> => {
    try {
      const stat = await fs.lstat(componentPath);
      if (stat.isSymbolicLink()) {
        throw new Error(
          `Output path cannot use symbolic links or junctions: ${componentPath}`,
        );
      }
      if (!isLeaf && !stat.isDirectory()) {
        throw new Error(`Output path component is not a directory: ${componentPath}`);
      }
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  };

  if (!await inspect(current, segments.length === 0)) return;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    const exists = await inspect(current, index === segments.length - 1);
    if (!exists) break;
  }
}

export async function validateOutputPath(
  projectRoot: string,
  outputPath: string,
  mustStayWithinProject = false,
): Promise<string> {
  const absoluteRoot = path.resolve(projectRoot);
  const candidatePath = path.resolve(absoluteRoot, outputPath);
  if (mustStayWithinProject && !isPathWithin(absoluteRoot, candidatePath)) {
    throw new Error(PROJECT_OUTPUT_BOUNDARY_ERROR);
  }

  try {
    await assertNoLinkedComponents(candidatePath);
  } catch (error) {
    if (mustStayWithinProject) {
      throw new Error(
        `${PROJECT_OUTPUT_BOUNDARY_ERROR}: ${(error as Error).message}`,
      );
    }
    throw error;
  }

  return candidatePath;
}

async function resolveProjectOutput(
  projectRoot: string,
  configuredOutput: string,
): Promise<string> {
  const pathSegments = configuredOutput.replace(/\\/g, "/").split("/");
  if (pathSegments.includes("..")) {
    throw new Error(PROJECT_OUTPUT_BOUNDARY_ERROR);
  }
  return validateOutputPath(projectRoot, configuredOutput, true);
}

export async function loadConfig(
  projectRoot: string,
  overrides: Partial<AgentSmithConfig> = {},
): Promise<LoadedAgentSmithConfig> {
  const userConfig = process.platform === "win32"
    ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "agentsmith", "config.json")
    : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "agentsmith", "config.json");
  const projectConfig = path.join(projectRoot, ".agentsmithrc.json");
  const userValues = await readConfig(userConfig);
  const projectValues = await readConfig(projectConfig);
  const environmentValues = envConfig(process.env);
  const explicitOverrides = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined),
  ) as Partial<AgentSmithConfig>;

  let outputSource: OutputSource = userValues.output === undefined
    ? "default"
    : "user";
  if (projectValues.output !== undefined) outputSource = "project";
  if (environmentValues.output !== undefined) outputSource = "environment";
  if (explicitOverrides.output !== undefined) outputSource = "override";

  if (
    outputSource === "project" &&
    projectValues.output !== undefined
  ) {
    projectValues.output = await resolveProjectOutput(
      projectRoot,
      projectValues.output,
    );
  }

  const config = ConfigSchema.parse({
    ...DEFAULT_CONFIG,
    ...userValues,
    ...projectValues,
    ...environmentValues,
    ...explicitOverrides,
  });
  return {
    ...config,
    outputSource,
  };
}
