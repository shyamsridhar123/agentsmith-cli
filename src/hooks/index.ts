/**
 * HookRunner - The Enforcer
 * Executes lifecycle hooks at the right moments.
 * "Never send a human to do a machine's job."
 */

import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import yaml from "yaml";
import chalk from "chalk";
import type { HookDefinition } from "../analyzer/index.js";
import { HookOutputSchema } from "../analyzer/index.js";

const execFileAsync = promisify(execFile);

export function parseHookCommand(command: string): { executable: string; args: string[] } {
  if (/[;&|`$><\n\r]/.test(command)) {
    throw new Error("Shell operators are not supported in hook commands");
  }
  const tokens = command.match(/(?:[^\s"'\\]+|\\.|"(?:\\.|[^"])*"|'[^']*')+/g) ?? [];
  if (tokens.length === 0) throw new Error("Hook command is empty");
  const unquote = (token: string) => {
    if (
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'"))
    ) {
      return token.slice(1, -1);
    }
    return token.replace(/\\(.)/g, "$1");
  };
  const executable = tokens[0];
  if (!executable) throw new Error("Hook command is empty");
  return { executable: unquote(executable), args: tokens.slice(1).map(unquote) };
}

export type HookEvent = "pre-commit" | "post-commit" | "pre-push" | "pre-analyze" | "post-generate";

export interface HookResult {
  hook: string;
  success: boolean;
  output?: string;
  error?: string;
}

export class HookRunner {
  private rootPath: string;
  private verbose: boolean;

  constructor(rootPath: string, verbose = false) {
    this.rootPath = rootPath;
    this.verbose = verbose;
  }

  /**
   * Execute all hooks for a given event
   */
  async execute(event: HookEvent): Promise<HookResult[]> {
    const hooks = await this.loadHooks(event);
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

  /**
   * Load hooks from .github/hooks/ directory for a specific event
   */
  private async loadHooks(event: HookEvent): Promise<HookDefinition[]> {
    const hooksDir = path.join(this.rootPath, ".github", "hooks");
    const hooks: HookDefinition[] = [];

    try {
      const files = await fs.readdir(hooksDir);

      for (const file of files) {
        if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;

        const hookPath = path.join(hooksDir, file);
        const content = await fs.readFile(hookPath, "utf-8");
        const parsed = HookOutputSchema.safeParse(yaml.parse(content));
        if (!parsed.success) {
          if (this.verbose) console.log(chalk.yellow(`  Skipping invalid hook: ${file}`));
          continue;
        }
        const hookDef = parsed.data as HookDefinition;

        if (hookDef.event === event) {
          hooks.push(hookDef);
        }
      }
    } catch (error) {
      // No hooks directory or can't read - that's fine
      if (this.verbose) {
        console.log(chalk.gray(`  No hooks directory found at ${hooksDir}`));
      }
    }

    return hooks;
  }

  /**
   * Run a single hook and return the result
   */
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
        const { stdout, stderr } = await execFileAsync(executable, args, {
          cwd: this.rootPath,
          encoding: "utf-8",
          timeout: 120000,
          maxBuffer: 10 * 1024 * 1024,
        });

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

  /**
   * Evaluate a condition string (simple file/command checks)
   */
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
        await execFileAsync(executable, args, {
          cwd: this.rootPath,
          encoding: "utf-8",
          timeout: 30000,
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
