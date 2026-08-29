/**
 * HookRunner - The Enforcer
 * Executes lifecycle hooks at the right moments.
 */
import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import type { Stats } from "node:fs";
import { promisify } from "util";
import yaml from "yaml";
import chalk from "chalk";
import type { HookDefinition } from "../analyzer/index.js";
import { HookOutputSchema } from "../analyzer/index.js";
const execFileAsync = promisify(execFile);
export interface HookInvocation { executable: string; args: string[]; windowsVerbatimArguments?: boolean; }
export function parseHookCommand(command: string): { executable: string; args: string[] } {
  if (/[;&|`$><\n\r]/.test(command)) {
    throw new Error("Shell operators are not supported in hook commands");
  }
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | undefined;
  let tokenStarted = false;
  for (let index = 0; index < command.length; index++) {
    const character = command[index];
    const nextCharacter = command[index + 1];
    if (
      character === "\\"
      && nextCharacter !== undefined
      && (/\s/.test(nextCharacter) || nextCharacter === "'" || nextCharacter === '"')
    ) {
      token += nextCharacter;
      tokenStarted = true;
      index++;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      else {
        token += character;
        tokenStarted = true;
      }
    } else if (character === "'" || character === '"') {
      quote = character;
      tokenStarted = true;
    } else if (/\s/.test(character)) {
      if (tokenStarted) {
        tokens.push(token);
        token = "";
        tokenStarted = false;
      }
    } else {
      token += character;
      tokenStarted = true;
    }
  }
  if (quote) throw new Error("Hook command contains an unterminated quote");
  if (tokenStarted) tokens.push(token);
  const executable = tokens[0];
  if (!executable) throw new Error("Hook command is empty");
  return { executable, args: tokens.slice(1) };
}
async function existingFile(candidates: string[], baseDirectory = process.cwd()): Promise<string | undefined> {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const absolute = path.isAbsolute(candidate)
      ? candidate
      : path.resolve(baseDirectory, candidate);
    const key = process.platform === "win32" ? absolute.toLowerCase() : absolute;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      if ((await fs.stat(absolute)).isFile()) return absolute;
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}
async function resolveNpmCliScript(executable: string, environment: NodeJS.ProcessEnv, workingDirectory: string): Promise<string | undefined> {
  const commandName = path.basename(executable)
    .toLowerCase()
    .replace(/\.(?:cmd|bat|exe)$/i, "");
  if (commandName !== "npm" && commandName !== "npx") return undefined;
  const scriptName = commandName === "npm" ? "npm-cli.js" : "npx-cli.js";
  const candidates: string[] = [];
  const npmExecPath = environment.npm_execpath;
  if (npmExecPath) {
    if (
      commandName === "npm" &&
      path.basename(npmExecPath).toLowerCase() === "npm-cli.js"
    ) {
      candidates.push(npmExecPath);
    }
    candidates.push(path.join(path.dirname(npmExecPath), scriptName));
  }
  if (path.dirname(executable) !== ".") {
    candidates.push(
      path.join(path.dirname(executable), "node_modules", "npm", "bin", scriptName),
    );
  }
  candidates.push(
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", scriptName),
  );
  for (const searchDirectory of (environment.PATH ?? "").split(path.delimiter)) {
    if (!searchDirectory) continue;
    candidates.push(
      path.join(searchDirectory, "node_modules", "npm", "bin", scriptName),
    );
  }
  return existingFile(candidates, workingDirectory);
}
function readEnvironmentValue(environment: NodeJS.ProcessEnv, name: string): string | undefined {
  const exact = environment[name];
  if (exact !== undefined) return exact;
  const matchingKey = Object.keys(environment).find(
    (key) => key.toLowerCase() === name.toLowerCase(),
  );
  return matchingKey ? environment[matchingKey] : undefined;
}
function windowsExecutableExtensions(environment: NodeJS.ProcessEnv): string[] {
  const pathExt = readEnvironmentValue(environment, "PATHEXT")
    ?? ".COM;.EXE;.BAT;.CMD";
  return pathExt
    .split(";")
    .map((extension) => extension.trim())
    .filter(Boolean)
    .map((extension) => extension.startsWith(".") ? extension : `.${extension}`);
}
async function resolveWindowsExecutable(executable: string, environment: NodeJS.ProcessEnv, workingDirectory: string): Promise<string | undefined> {
  const extensions = windowsExecutableExtensions(environment);
  const hasExtension = path.extname(executable) !== "";
  const names = hasExtension
    ? [executable]
    : [executable, ...extensions.map((extension) => `${executable}${extension}`)];
  const hasExplicitPath = path.isAbsolute(executable)
    || executable.includes("/") || executable.includes("\\");
  if (hasExplicitPath) return existingFile(names, workingDirectory);
  const candidates: string[] = [];
  for (const searchDirectory of (
    readEnvironmentValue(environment, "PATH") ?? ""
  ).split(path.delimiter)) {
    const directory = searchDirectory.trim().replace(/^"(.*)"$/, "$1");
    if (!directory) continue;
    for (const name of names) {
      candidates.push(path.join(directory, name));
    }
  }
  return existingFile(candidates, workingDirectory);
}
function quoteBatchArgument(value: string): string {
  if (/[\0\r\n"%!^]/.test(value)) {
    throw new Error(
      "Windows batch hook arguments cannot contain quotes, expansion markers, or control characters",
    );
  }
  return `"${value}"`;
}
function createBatchInvocation(batchPath: string, args: string[], environment: NodeJS.ProcessEnv): HookInvocation {
  const commandLine = [
    batchPath,
    ...args,
  ].map(quoteBatchArgument).join(" ");
  return {
    executable: readEnvironmentValue(environment, "ComSpec") ?? "cmd.exe",
    args: ["/d", "/s", "/v:off", "/c", `call ${commandLine}`],
    windowsVerbatimArguments: true,
  };
}
export async function resolveHookInvocation(executable: string, args: string[], environment: NodeJS.ProcessEnv = process.env, workingDirectory = process.cwd()): Promise<HookInvocation> {
  const npmCliScript = await resolveNpmCliScript(
    executable,
    environment,
    workingDirectory,
  );
  if (npmCliScript) {
    return {
      executable: process.execPath,
      args: [npmCliScript, ...args],
    };
  }
  if (process.platform === "win32") {
    const resolvedExecutable = await resolveWindowsExecutable(
      executable,
      environment,
      workingDirectory,
    );
    if (resolvedExecutable) {
      const extension = path.extname(resolvedExecutable).toLowerCase();
      if (extension === ".cmd" || extension === ".bat") {
        return createBatchInvocation(resolvedExecutable, args, environment);
      }
      return { executable: resolvedExecutable, args };
    }
  }
  const commandName = path.basename(executable)
    .toLowerCase()
    .replace(/\.(?:cmd|bat|exe)$/i, "");
  if (
    process.platform === "win32" &&
    (commandName === "npm" || commandName === "npx")
  ) {
    throw new Error(`Unable to resolve the ${commandName} CLI script`);
  }
  return { executable, args };
}
export type HookEvent = "pre-commit" | "post-commit" | "pre-push" | "pre-analyze" | "post-generate";
export interface HookResult { hook: string; success: boolean; output?: string; error?: string; }
export interface HookRunnerOptions { verbose?: boolean; allowExecution?: boolean; }
const hookEvents = new Set<HookEvent>(["pre-commit", "post-commit", "pre-push", "pre-analyze", "post-generate"]);
function snapshotHookDefinition(hook: HookDefinition): HookDefinition {
  const parsed = HookOutputSchema.safeParse(hook);
  if (!parsed.success || !hookEvents.has(parsed.data.event as HookEvent)) {
    throw new Error(`Invalid hook definition: ${hook.name}`);
  }
  return {
    ...parsed.data,
    event: parsed.data.event as HookEvent,
    commands: [...parsed.data.commands],
  };
}
export class HookRunner {
  private rootPath: string;
  private verbose: boolean;
  private allowExecution: boolean;
  constructor(rootPath: string, options: HookRunnerOptions | boolean = {}) {
    const legacyMode = typeof options === "boolean";
    this.rootPath = path.resolve(rootPath);
    this.verbose = typeof options === "boolean"
      ? options
      : options.verbose ?? false;
    this.allowExecution = legacyMode
      ? true
      : options.allowExecution ?? false;
  }
  async execute(event: HookEvent, hookFiles?: readonly string[]): Promise<HookResult[]> {
    this.assertExecutionAllowed();
    const hooks = hookFiles === undefined
      ? await this.loadRepositoryHooks(event)
      : await this.loadHookFiles(event, hookFiles);
    return this.executeHooks(event, hooks);
  }
  async executeDefinitions(event: HookEvent, hookDefinitions: readonly HookDefinition[]): Promise<HookResult[]> {
    this.assertExecutionAllowed();
    const hooks = hookDefinitions
      .map(snapshotHookDefinition)
      .filter((hook) => hook.event === event);
    return this.executeHooks(event, hooks);
  }
  private assertExecutionAllowed(): void {
    if (!this.allowExecution) {
      throw new Error("Hook execution is disabled; explicit user opt-in is required");
    }
  }
  private async executeHooks(event: HookEvent, hooks: readonly HookDefinition[]): Promise<HookResult[]> {
    const results: HookResult[] = [];
    if (hooks.length === 0) {
      if (this.verbose) {
        console.log(chalk.gray(`  No ${event} hooks found.`));
      }
      return results;
    }
    console.log(chalk.green(`\n[HOOKS]`), `Running ${event} hooks...`);
    for (const hook of hooks) {
      const result = await this.runHook(hook);
      results.push(result);
      if (!result.success) {
        console.log(chalk.red(`  ✗ ${hook.name}: ${result.error}`));
        // Stop on first failure
        break;
      } else {
        console.log(chalk.green(`  ✓ ${hook.name}`));
        if (this.verbose && result.output) {
          console.log(chalk.gray(`    ${result.output.split("\n").join("\n    ")}`));
        }
      }
    }
    return results;
  }
  private async loadRepositoryHooks(event: HookEvent): Promise<HookDefinition[]> {
    const hooksDir = path.resolve(this.rootPath, ".github", "hooks");
    let entries: string[];
    try {
      entries = await fs.readdir(hooksDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return this.loadHookFiles(
      event,
      entries
        .filter((entry) => /\.ya?ml$/i.test(entry))
        .sort()
        .map((entry) => path.join(".github", "hooks", entry)),
    );
  }
  private async loadHookFiles(event: HookEvent, hookFiles: readonly string[]): Promise<HookDefinition[]> {
    const hooksDir = path.resolve(this.rootPath, ".github", "hooks");
    const hooks: HookDefinition[] = [];
    for (const hookFile of new Set(hookFiles)) {
      const normalized = hookFile.replace(/\\/g, "/");
      if (!normalized.endsWith(".yaml") && !normalized.endsWith(".yml")) {
        throw new Error(`Generated hook file must be YAML: ${hookFile}`);
      }
      const hookPath = path.resolve(this.rootPath, normalized);
      if (!isPathWithin(hooksDir, hookPath)) {
        throw new Error(
          `Generated hook file must stay within .github/hooks: ${hookFile}`,
        );
      }
      const content = await readOpenedFile(
        hookPath,
        hooksDir,
        path.resolve(this.rootPath),
      );
      const parsed = HookOutputSchema.safeParse(yaml.parse(content));
      if (!parsed.success) {
        if (this.verbose) {
          console.log(chalk.yellow(`  Skipping invalid hook: ${hookFile}`));
        }
        continue;
      }
      const hookDef = parsed.data as HookDefinition;
      if (hookDef.event === event) {
        hooks.push(hookDef);
      }
    }
    return hooks;
  }
  private async runHook(hook: HookDefinition): Promise<HookResult> {
    const outputs: string[] = [];
    for (const command of hook.commands) {
      try {
        // Check condition if present
        if (hook.condition) {
          const conditionMet = await this.evaluateCondition(hook.condition);
          if (!conditionMet) {
            return {
              hook: hook.name,
              success: true,
              output: "Skipped: condition not met",
            };
          }
        }
        if (this.verbose) {
          console.log(chalk.gray(`    Running: ${command}`));
        }
        const { executable, args } = parseHookCommand(command);
        const invocation = await resolveHookInvocation(
          executable,
          args,
          process.env,
          this.rootPath,
        );
        const { stdout, stderr } = await execFileAsync(
          invocation.executable,
          invocation.args,
          {
            cwd: this.rootPath,
            encoding: "utf-8",
            timeout: 120000,
            maxBuffer: 10 * 1024 * 1024,
            windowsVerbatimArguments: invocation.windowsVerbatimArguments,
          },
        );
        outputs.push(`${stdout}${stderr}`.trim());
      } catch (error) {
        const err = error as { message?: string; stderr?: string };
        return {
          hook: hook.name,
          success: false,
          error: err.stderr || err.message || "Command failed",
        };
      }
    }
    return {
      hook: hook.name,
      success: true,
      output: outputs.join("\n"),
    };
  }
  private async evaluateCondition(condition: string): Promise<boolean> {
    // Support simple conditions like "file:package.json" or "command:npm --version"
    if (condition.startsWith("file:")) {
      const filePath = path.resolve(this.rootPath, condition.slice(5));
      const relative = path.relative(this.rootPath, filePath);
      if (relative.startsWith("..") || path.isAbsolute(relative)) return false;
      try {
        await fs.access(filePath);
        return true;
      } catch {
        return false;
      }
    }
    if (condition.startsWith("command:")) {
      try {
        const { executable, args } = parseHookCommand(condition.slice(8));
        const invocation = await resolveHookInvocation(
          executable,
          args,
          process.env,
          this.rootPath,
        );
        await execFileAsync(invocation.executable, invocation.args, {
          cwd: this.rootPath,
          encoding: "utf-8",
          timeout: 30000,
          windowsVerbatimArguments: invocation.windowsVerbatimArguments,
        });
        return true;
      } catch {
        return false;
      }
    }
    // Default: treat as truthy
    return true;
  }
}
function isPathWithin(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === ""
    || (
      relative !== ".."
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative)
    );
}
function hasSameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}
async function readOpenedFile(filePath: string, hooksRoot: string, outputRoot: string): Promise<string> {
  await assertNoLinkedPathComponents(outputRoot, filePath);
  const handle = await fs.open(filePath, "r");
  try {
    const openedStat = await handle.stat();
    if (!openedStat.isFile()) {
      throw new Error(`Generated hook path is not a file: ${filePath}`);
    }
    if (openedStat.nlink > 1) {
      throw new Error(`Generated hook path is a hard link: ${filePath}`);
    }
    const pathLinkStat = await fs.lstat(filePath);
    if (
      pathLinkStat.isSymbolicLink()
      || !hasSameIdentity(openedStat, pathLinkStat)
    ) {
      throw new Error(`Generated hook path is a symbolic link: ${filePath}`);
    }
    const realPath = await fs.realpath(filePath);
    const realHooksRoot = await fs.realpath(hooksRoot);
    if (!isPathWithin(realHooksRoot, realPath)) {
      throw new Error(`Generated hook path escapes .github/hooks: ${filePath}`);
    }
    const pathStat = await fs.stat(realPath);
    if (!hasSameIdentity(openedStat, pathStat)) {
      throw new Error(`Generated hook changed while it was being opened: ${filePath}`);
    }
    return await handle.readFile("utf-8");
  } finally {
    await handle.close();
  }
}
async function assertNoLinkedPathComponents(rootPath: string, filePath: string): Promise<void> {
  const relative = path.relative(rootPath, filePath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Generated hook path escapes .github/hooks: ${filePath}`);
  }
  let current = rootPath;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if ((await fs.lstat(current)).isSymbolicLink()) {
      throw new Error(`Generated hook path is a symbolic link: ${filePath}`);
    }
  }
}
