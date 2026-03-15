/**
 * Assimilate Command
 * "You hear that, Mr. Anderson? That is the sound of inevitability."
 */

import chalk from "chalk";
import { Scanner } from "../scanner/index.js";
import { Analyzer, RemoteAnalyzer } from "../analyzer/index.js";
import { Generator } from "../generator/index.js";
import { Registry } from "../registry/index.js";
import { HookRunner } from "../hooks/index.js";
import { isGitHubUrl, getRepoName } from "../utils/git.js";
import { isPermissiveLicense } from "../utils/license.js";

interface AssimilateOptions {
  dryRun?: boolean;
  verbose?: boolean;
  output?: string;
  instructions?: boolean;
  singleAgent?: boolean;
}

export async function assimilateCommand(
  target: string,
  options: AssimilateOptions
): Promise<void> {
  const isRemote = isGitHubUrl(target);

  if (isRemote) {
    // Use new remote analyzer - no cloning!
    console.log(chalk.green("\n[ANALYZE]"), `Analyzing ${getRepoName(target)} via GitHub API...`);
    
    const analyzer = new RemoteAnalyzer(target, options.verbose);
    const result = await analyzer.analyze();

    if (options.verbose) {
      console.log(chalk.gray(`  ├── Language: ${result.repo?.language ?? "Unknown"}`));
      console.log(chalk.gray(`  ├── Framework: ${result.repo?.framework || "None"}`));
      console.log(chalk.gray(`  ├── License: ${result.repo?.license || "Unknown"}`));
      console.log(chalk.gray(`  └── Skills: ${result.skills.length}`));
    }

    // License check
    console.log(chalk.green("\n[LICENSE]"), "Checking repository license...");
    const isPermissive = isPermissiveLicense(result.repo?.license);

    if (!isPermissive && !options.dryRun) {
      console.log(chalk.red("\n[BLOCKED]"), "Cannot assimilate repository.");
      if (!result.repo?.license) {
        console.log(chalk.red("  No license detected."));
      } else {
        console.log(chalk.red(`  License "${result.repo.license}" is not permissive.`));
      }
      console.log(chalk.gray("  Use --dry-run to preview without restrictions."));
      process.exitCode = 1;
      return;
    }

    if (isPermissive) {
      console.log(chalk.green(`  ✓ ${result.repo?.license} - permissive license`));
    } else if (options.dryRun) {
      console.log(chalk.yellow("  ⚠ License not permissive - generation blocked without --dry-run"));
    }

    // Output path
    const outputPath = options.output || process.cwd();

    console.log(
      chalk.green("\n[GENERATE]"),
      options.dryRun ? "Preview of assets..." : `Writing assets to ${outputPath}/.github/...`
    );

    // Generate
    const generator = new Generator(
      outputPath, options.dryRun, options.verbose,
      options.instructions === false, options.singleAgent,
    );
    const generated = await generator.generate(result);

    for (const file of generated.files) {
      const icon = options.dryRun ? chalk.yellow("○") : chalk.green("✓");
      console.log(`  ${icon} ${file}`);
    }

    // Registry
    const registry = new Registry(outputPath, options.dryRun);
    await registry.build(result.skills, result.agents);
    const registryIcon = options.dryRun ? chalk.yellow("○") : chalk.green("✓");
    console.log(`  ${registryIcon} skills-registry.jsonl`);

    // Hooks
    if (!options.dryRun) {
      const hookRunner = new HookRunner(outputPath, options.verbose);
      await hookRunner.execute("post-generate");
    }

    // Summary
    const agentCount = generated.files.filter(f => f.endsWith(".agent.md")).length;
    console.log(
      chalk.green("\n[COMPLETE]"),
      `${result.skills.length} skills, ${agentCount} agent(s), ${result.hooks.length} hooks generated.`
    );

    if (options.dryRun) {
      console.log(chalk.yellow("\nDry run - no files were written."));
    } else {
      console.log(chalk.gray("\nYour repository has been assimilated.\n"));
    }

  } else {
    // Local path - use original flow with cloning
    await assimilateLocal(target, options);
  }
}

/**
 * Original local path assimilation
 */
async function assimilateLocal(target: string, options: AssimilateOptions): Promise<void> {
  const { resolveInput } = await import("../utils/git.js");
  const { detectLicense, formatLicenseStatus } = await import("../utils/license.js");

  const resolved = await resolveInput(target);

  try {
    console.log(chalk.green("\n[SCAN]"), "Enumerating repository...");

    const scanner = new Scanner(resolved.path, options.verbose);
    const scanResult = await scanner.scan();

    if (options.verbose) {
      console.log(chalk.gray(`  ├── Language: ${scanResult.language}`));
      console.log(chalk.gray(`  ├── Framework: ${scanResult.framework || "None detected"}`));
      console.log(chalk.gray(`  ├── Files: ${scanResult.files.length}`));
      console.log(chalk.gray(`  └── Config: ${scanResult.configFiles.join(", ") || "None"}`));
    }

    console.log(chalk.green("\n[ANALYZE]"), "Copilot SDK analysis in progress...");

    const analyzer = new Analyzer(options.verbose);
    const analysisResult = await analyzer.analyze(scanResult);

    if (options.verbose) {
      for (const skill of analysisResult.skills) {
        console.log(chalk.gray(`  ├── ${skill.sourceDir} → ${skill.name}`));
      }
    }

    // License check
    console.log(chalk.green("\n[LICENSE]"), "Checking repository license...");
    const license = await detectLicense(resolved.path);
    
    if (options.verbose) {
      console.log(chalk.gray(`  └── ${formatLicenseStatus(license)}`));
    }

    if (!license.permissive && !options.dryRun) {
      console.log(chalk.red("\n[BLOCKED]"), "Cannot assimilate repository.");
      if (!license.detected) {
        console.log(chalk.red("  No license file found."));
      } else {
        console.log(chalk.red(`  License "${license.name}" is not permissive.`));
      }
      process.exitCode = 1;
      return;
    }

    if (license.permissive) {
      console.log(chalk.green(`  ✓ ${license.name} - permissive license`));
    }

    const outputPath = options.output || resolved.path;

    console.log(
      chalk.green("\n[GENERATE]"),
      options.dryRun ? "Preview of assets..." : `Writing assets to .github/...`
    );

    const generator = new Generator(
      outputPath, options.dryRun, options.verbose,
      options.instructions === false, options.singleAgent,
    );
    const generated = await generator.generate(analysisResult);

    for (const file of generated.files) {
      const icon = options.dryRun ? chalk.yellow("○") : chalk.green("✓");
      console.log(`  ${icon} ${file}`);
    }

    const registry = new Registry(outputPath, options.dryRun);
    await registry.build(analysisResult.skills, analysisResult.agents);
    console.log(`  ${options.dryRun ? chalk.yellow("○") : chalk.green("✓")} skills-registry.jsonl`);

    if (!options.dryRun) {
      const hookRunner = new HookRunner(outputPath, options.verbose);
      await hookRunner.execute("post-generate");
    }

    const localAgentCount = generated.files.filter(f => f.endsWith(".agent.md")).length;
    console.log(
      chalk.green("\n[COMPLETE]"),
      `${analysisResult.skills.length} skills, ${localAgentCount} agent(s), ${analysisResult.hooks.length} hooks generated.`
    );

    if (options.dryRun) {
      console.log(chalk.yellow("\nDry run - no files were written."));
    } else {
      console.log(chalk.gray("\nYour repository has been assimilated.\n"));
    }
  } finally {
    if (resolved.isTemporary) {
      await resolved.cleanup();
    }
  }
}
