import fs from "fs/promises";
import path from "path";
import chalk from "chalk";
import { Scanner } from "../scanner/index.js";
import { analyzeCLIStructure } from "../analyzer/cli.js";
import { assimilateCommand } from "./assimilate.js";

interface RefineOptions {
  json?: boolean;
  writeReport?: boolean;
  apply?: boolean;
}

interface RefinementReport {
  schemaVersion: 1;
  generatedAt: string;
  framework?: string;
  commandCount: number;
  gaps: string[];
  recommendations: string[];
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function refineCommand(target = ".", options: RefineOptions = {}): Promise<void> {
  const root = path.resolve(target);
  const scan = await new Scanner(root).scan();
  const cli = await analyzeCLIStructure(scan);
  const gaps: string[] = [];
  const recommendations: string[] = [];

  if (!cli) {
    gaps.push("No supported CLI framework or command-directory convention was detected.");
    recommendations.push("Declare the CLI framework and executable entry point in project metadata.");
  } else {
    for (const name of ["cli-structure", "cli-options", "cli-testing"]) {
      if (!await exists(path.join(root, ".github", "skills", name, "SKILL.md"))) {
        gaps.push(`Missing generated ${name} skill.`);
      }
    }
    if (cli.commands.length === 0) {
      gaps.push("CLI framework detected, but no registered commands were extracted.");
      recommendations.push("Keep command registration close to entry points or in commands/cmd directories.");
    }
    if (cli.testFiles.length === 0) {
      gaps.push("No CLI-focused command tests were detected.");
      recommendations.push("Cover help, invalid input, success output, and failure exit codes.");
    }
    if (cli.commands.some((command) => command.options.length === 0)) {
      recommendations.push("Review commands without detected options to ensure their arguments are documented.");
    }
  }

  const report: RefinementReport = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    framework: cli?.framework,
    commandCount: cli?.commands.length ?? 0,
    gaps,
    recommendations,
  };

  if (options.writeReport) {
    const outputDir = path.join(root, ".github", "copilot");
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(
      path.join(outputDir, "refinement.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf-8",
    );
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(chalk.green("\n[REFINE]"), `${report.commandCount} command(s) analyzed`);
    for (const gap of gaps) console.log(chalk.yellow("  •"), gap);
    if (gaps.length === 0) console.log(chalk.green("  ✓"), "No CLI knowledge gaps detected.");
    for (const recommendation of recommendations) console.log(chalk.gray(`  → ${recommendation}`));
  }

  if (options.apply) {
    await assimilateCommand(root, { cache: false });
  }
}
