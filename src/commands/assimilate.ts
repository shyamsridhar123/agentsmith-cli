/**
 * Assimilate Command
 * "You hear that, Mr. Anderson? That is the sound of inevitability."
 */

import chalk from "chalk";
import {
  createRepositorySnapshot,
  normalizeRepositoryPath,
  Scanner,
} from "../scanner/index.js";
import type {
  RepositorySnapshot,
  ScanResult,
} from "../scanner/index.js";
import {
  Analyzer,
  createLocalAnalysisSnapshot,
  RemoteAnalyzer,
} from "../analyzer/index.js";
import { Generator } from "../generator/index.js";
import { Registry } from "../registry/index.js";
import { HookRunner } from "../hooks/index.js";
import { isGitHubUrl, getRepoName } from "../utils/git.js";
import { isPermissiveLicense } from "../utils/license.js";
import { GitHubClient } from "../github/index.js";
import type { AnalysisResult } from "../analyzer/index.js";
import { FileCache, stableCacheKey } from "../cache/index.js";
import { loadConfig, validateOutputPath } from "../config/index.js";
import {
  HubClient,
  normalizeHubServerUrl,
} from "../hub/client.js";
import {
  ensureCoordinationChannels,
  postRunSummary,
  recordRun,
  snapshotRunFiles,
} from "../hub/recorder.js";
import { buildChannelNames } from "../generator/hub-writer.js";

export interface AssimilateOptions {
  dryRun?: boolean;
  verbose?: boolean;
  output?: string;
  instructions?: boolean;
  singleAgent?: boolean;
  hub?: string;
  record?: boolean;
  cache?: boolean;
  runHooks?: boolean;
}

export async function assimilateCommand(
  target: string,
  options: AssimilateOptions
): Promise<void> {
  // Validate --record requires --hub
  if (options.record && !options.hub) {
    console.error(chalk.red("Error: --record requires --hub <url> to be set."));
    process.exitCode = 1;
    return;
  }
  if (options.hub) {
    try {
      options = {
        ...options,
        hub: normalizeHubServerUrl(options.hub),
      };
    } catch (error) {
      console.error(
        chalk.red("Error:"),
        error instanceof Error ? error.message : String(error),
      );
      process.exitCode = 1;
      return;
    }
  }

  const isRemote = isGitHubUrl(target);

  if (isRemote) {
    console.log(chalk.green("\n[LICENSE]"), "Checking repository license...");
    const github = new GitHubClient(target, options.verbose);
    const mutableRepoInfo = await github.getRepoInfo();
    const revision = await github.resolveRevision(mutableRepoInfo.defaultBranch);
    const license = await github.getLicense(revision);
    const repoInfo = { ...mutableRepoInfo, license };
    const isPermissive = isPermissiveLicense(license);

    if (!isPermissive) {
      console.log(chalk.red("\n[BLOCKED]"), "Cannot assimilate repository.");
      if (!license) {
        console.log(chalk.red("  No license detected."));
      } else {
        console.log(chalk.red(`  License "${license}" is not permissive.`));
      }
      process.exitCode = 1;
      return;
    }

    console.log(chalk.green(`  ✓ ${license} - permissive license`));

    // Use the remote analyzer only after the license boundary has been checked.
    console.log(chalk.green("\n[ANALYZE]"), `Analyzing ${getRepoName(target)} via GitHub API...`);

    const analyzer = new RemoteAnalyzer(
      target,
      options.verbose,
      revision,
      repoInfo,
    );
    const result = await analyzer.analyze();

    if (options.verbose) {
      console.log(chalk.gray(`  ├── Language: ${result.repo?.language ?? "Unknown"}`));
      console.log(chalk.gray(`  ├── Framework: ${result.repo?.framework || "None"}`));
      console.log(chalk.gray(`  ├── License: ${result.repo?.license || "Unknown"}`));
      console.log(chalk.gray(`  └── Skills: ${result.skills.length}`));
    }

    const hubClient = await prepareHub(result.repoName, options);
    const activeHubUrl = options.dryRun ? options.hub : hubClient?.getServerUrl();
    const outputPath = await validateOutputPath(
      process.cwd(),
      options.output ?? process.cwd(),
    );

    console.log(
      chalk.green("\n[GENERATE]"),
      options.dryRun ? "Preview of assets..." : `Writing assets to ${outputPath}/.github/...`
    );

    // Generate
    const generator = new Generator(
      outputPath, options.dryRun, options.verbose,
      options.instructions === false, options.singleAgent,
      activeHubUrl,
    );
    const generated = await generator.generate(result);

    for (const file of generated.files) {
      const icon = options.dryRun ? chalk.yellow("○") : chalk.green("✓");
      console.log(`  ${icon} ${file}`);
    }

    // Registry
    const registry = new Registry(outputPath, options.dryRun);
    await registry.build(result.skills, result.agents, generated);
    const registryIcon = options.dryRun ? chalk.yellow("○") : chalk.green("✓");
    console.log(`  ${registryIcon} skills-registry.jsonl`);

    // Hooks
    if (!options.dryRun && options.runHooks) {
      const hookRunner = new HookRunner(outputPath, {
        verbose: options.verbose,
        allowExecution: true,
      });
      await hookRunner.executeDefinitions("post-generate", result.hooks);
    }

    // Hub recording (opt-in)
    if (hubClient && options.record && !options.dryRun) {
      await recordToHub(hubClient, result, generated.files, outputPath, options.verbose);
    }

    // Summary
    const agentCount = generated.agentFiles.length;
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
    console.log(chalk.green("\n[LICENSE]"), "Checking repository license...");
    const license = await detectLicense(resolved.path);

    if (options.verbose) {
      console.log(chalk.gray(`  └── ${formatLicenseStatus(license)}`));
    }

    if (!license.permissive) {
      console.log(chalk.red("\n[BLOCKED]"), "Cannot assimilate repository.");
      if (!license.detected) {
        console.log(chalk.red("  No license file found."));
      } else {
        console.log(chalk.red(`  License "${license.name}" is not permissive.`));
      }
      process.exitCode = 1;
      return;
    }

    console.log(chalk.green(`  ✓ ${license.name} - permissive license`));

    console.log(chalk.green("\n[SCAN]"), "Enumerating repository...");

    const scanner = new Scanner(resolved.path, options.verbose);
    const scanResult = await scanner.scan();
    const config = await loadConfig(resolved.path, {
      output: options.output,
      verbose: options.verbose,
      instructions: options.instructions,
      singleAgent: options.singleAgent,
      cache: options.cache,
    });

    if (options.verbose) {
      console.log(chalk.gray(`  ├── Language: ${scanResult.language}`));
      console.log(chalk.gray(`  ├── Framework: ${scanResult.framework || "None detected"}`));
      console.log(chalk.gray(`  ├── Files: ${scanResult.files.length}`));
      console.log(chalk.gray(`  └── Config: ${scanResult.configFiles.join(", ") || "None"}`));
    }

    console.log(chalk.green("\n[ANALYZE]"), "Copilot SDK analysis in progress...");
    const repositorySnapshot = await createLocalAnalysisSnapshot(
      scanResult,
      config.cache,
    );

    let analysisResult: AnalysisResult | undefined;
    if (config.cache) {
      const cache = new FileCache();
      const snapshotKey = await buildAnalysisCacheKey(
        scanResult,
        repositorySnapshot,
      );
      analysisResult = await cache.get<AnalysisResult>(
        snapshotKey,
        config.cacheTtlSeconds,
      );
      if (analysisResult) {
        if (config.verbose) {
          console.log(chalk.gray("  └── Using cached analysis"));
        }
      }
      if (!analysisResult) {
        const analyzer = new Analyzer(config.verbose);
        analysisResult = await analyzer.analyze(
          scanResult,
          repositorySnapshot,
        );
        await cache.set(snapshotKey, analysisResult);
      }
    }
    if (!analysisResult) {
      const analyzer = new Analyzer(config.verbose);
      analysisResult = await analyzer.analyze(
        scanResult,
        repositorySnapshot,
      );
    }

    if (options.verbose) {
      for (const skill of analysisResult.skills) {
        console.log(chalk.gray(`  ├── ${skill.sourceDir} → ${skill.name}`));
      }
    }

    const hubClient = await prepareHub(analysisResult.repoName, options);
    const activeHubUrl = options.dryRun ? options.hub : hubClient?.getServerUrl();
    const outputPath = await validateOutputPath(
      resolved.path,
      config.output ?? resolved.path,
      config.outputSource === "project",
    );

    console.log(
      chalk.green("\n[GENERATE]"),
      options.dryRun ? "Preview of assets..." : `Writing assets to .github/...`
    );

    const generator = new Generator(
      outputPath, options.dryRun, config.verbose,
      config.instructions === false, config.singleAgent,
      activeHubUrl,
    );
    const generated = await generator.generate(analysisResult);

    for (const file of generated.files) {
      const icon = options.dryRun ? chalk.yellow("○") : chalk.green("✓");
      console.log(`  ${icon} ${file}`);
    }

    const registry = new Registry(outputPath, options.dryRun);
    await registry.build(analysisResult.skills, analysisResult.agents, generated);
    console.log(`  ${options.dryRun ? chalk.yellow("○") : chalk.green("✓")} skills-registry.jsonl`);

    if (!options.dryRun && options.runHooks) {
      const hookRunner = new HookRunner(outputPath, {
        verbose: options.verbose,
        allowExecution: true,
      });
      await hookRunner.executeDefinitions(
        "post-generate",
        analysisResult.hooks,
      );
    }

    // Hub recording (opt-in)
    if (hubClient && options.record && !options.dryRun) {
      await recordToHub(
        hubClient,
        analysisResult,
        generated.files,
        outputPath,
        options.verbose,
      );
    }

    const localAgentCount = generated.agentFiles.length;
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

export async function prepareHub(
  repoName: string,
  options: AssimilateOptions,
): Promise<HubClient | undefined> {
  if (!options.hub || options.dryRun) return undefined;

  try {
    console.log(chalk.green("\n[HUB]"), "Preparing AgentHub coordination...");
    const client = await HubClient.fromConfigFile(options.hub, {
      timeoutMs: 5_000,
      maxRetries: 1,
    });
    await client.health();
    try {
      const created = await ensureCoordinationChannels(repoName, client);
      if (options.verbose) {
        if (created.length > 0) {
          console.log(chalk.gray(`  └── Created channels: ${created.join(", ")}`));
        } else {
          console.log(chalk.gray("  └── Coordination channels already exist"));
        }
      }
    } catch (error) {
      console.log(
        chalk.yellow("  ⚠"),
        `Channel setup failed; recording remains available: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return client;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(
      chalk.yellow("  ⚠"),
      `AgentHub setup failed; continuing without coordination: ${message}`,
    );
    return undefined;
  }
}

export async function buildAnalysisCacheKey(
  scanResult: ScanResult,
  repositorySnapshot?: RepositorySnapshot,
): Promise<string> {
  const snapshot = repositorySnapshot ?? await createRepositorySnapshot(
    scanResult.rootPath,
    scanResult.files.map((file) => file.relativePath),
    { computeDigests: true },
  );
  const files: Array<[string, string]> = [];
  for (const [relativePath, file] of snapshot.files) {
    if (!file.digest) {
      throw new Error(
        `Cannot build analysis cache key without a digest for ${relativePath}`,
      );
    }
    files.push([
      relativePath,
      file.digest,
    ]);
  }
  files.sort(([left], [right]) => left.localeCompare(right));
  const snapshotPaths = new Set(files.map(([relativePath]) => relativePath));
  const analyzedFiles = scanResult.files
    .map((file) => ({
      relativePath: normalizeRepositoryPath(file.relativePath),
      extension: file.extension,
      isTest: file.isTest,
      isConfig: file.isConfig,
    }))
    .filter((file) => snapshotPaths.has(file.relativePath));

  return stableCacheKey({
    schema: 4,
    root: snapshot.rootPath,
    files,
    analyzedFiles,
    language: scanResult.language,
    framework: scanResult.framework,
    configFiles: scanResult.configFiles
      .map(normalizeRepositoryPath)
      .filter((file) => snapshotPaths.has(file)),
    testFiles: scanResult.testFiles
      .map(normalizeRepositoryPath)
      .filter((file) => snapshotPaths.has(file)),
    sourceDirectories: scanResult.sourceDirectories,
    cliFramework: scanResult.cliFramework,
    cliEntryFiles: scanResult.cliEntryFiles
      .map(normalizeRepositoryPath)
      .filter((file) => snapshotPaths.has(file)),
  });
}

/**
 * Record an assimilation run to AgentHub (opt-in via --hub --record).
 * Failures are logged and never block the pipeline.
 */
export async function recordToHub(
  client: HubClient,
  analysis: AnalysisResult,
  generatedFilePaths: string[],
  outputPath: string,
  verbose?: boolean,
): Promise<void> {
  try {
    console.log(chalk.green("\n[HUB]"), "Recording run to AgentHub...");

    const snapshot = await snapshotRunFiles(outputPath, generatedFilePaths);
    if (snapshot.registryMissing) {
      console.log(
        chalk.yellow("  ⚠"),
        "skills-registry.jsonl was not found; recording generated assets without it",
      );
    }

    const result = await recordRun(analysis, snapshot.files, client);

    if (result.success) {
      console.log(chalk.green("  ✓"), `Run recorded (commit: ${result.commitHash?.slice(0, 8)})`);

      const channels = buildChannelNames(analysis.repoName);
      const posted = await postRunSummary(analysis, channels.results, client, result.commitHash);
      if (posted) {
        if (verbose) {
          console.log(chalk.gray(`  └── Summary posted to #${channels.results}`));
        }
      } else {
        console.log(chalk.yellow("  ⚠"), `Run recorded, but posting to #${channels.results} failed`);
      }
    } else {
      console.log(chalk.yellow("  ⚠"), `Hub recording skipped: ${result.error}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(chalk.yellow("  ⚠"), `Hub recording failed: ${msg}`);
  }
}
