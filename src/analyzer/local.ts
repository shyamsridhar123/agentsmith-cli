/**
 * Local Analyzer - The Mind of Agent Smith
 * Uses GitHub Copilot SDK to perform deep semantic analysis of a local repository.
 * "The best thing about being me... there are so many of me."
 */

import { CopilotClient } from "@github/copilot-sdk";
import path from "path";
import {
  createRepositorySnapshot,
  isGeneratedRepositoryPath,
  isSensitiveRepositoryPath,
  normalizeRepositoryPath,
  type RepositorySnapshot,
  type ScanResult,
} from "../scanner/index.js";
import type { AnalysisResult, SkillDefinition, ToolDefinition, AgentDefinition } from "./types.js";
import {
  flattenAgents,
  extractAllTools,
  detectDomainBoundaries,
  generateDefaultHooks,
  detectToolsFromConfig,
  getSystemPrompt,
  buildAnalysisPrompt,
  parseAnalysisResponse,
  generateDefaultSkills,
} from "./core.js";
import {
  analyzeCLIStructure,
  buildCLITextByteLimits,
  generateCLISkills,
  mergeCLISkills,
} from "./cli.js";
import { createSecureAnalysisSessionConfig } from "./session-security.js";

const MAX_FILE_SAMPLES = 20;
const MAX_SAMPLE_BYTES = 10_000;

export function selectLocalAnalysisSamplePaths(
  scanResult: ScanResult,
): string[] {
  return scanResult.files
    .filter((file) =>
      !file.isTest &&
      !isSensitiveRepositoryPath(file.relativePath) &&
      !isGeneratedRepositoryPath(file.relativePath)
    )
    .sort((left, right) => {
      if (left.isConfig && !right.isConfig) return -1;
      if (!left.isConfig && right.isConfig) return 1;
      const leftDepth = normalizeRepositoryPath(left.relativePath).split("/").length;
      const rightDepth = normalizeRepositoryPath(right.relativePath).split("/").length;
      return leftDepth - rightDepth ||
        left.relativePath.localeCompare(right.relativePath);
    })
    .slice(0, MAX_FILE_SAMPLES)
    .map((file) => normalizeRepositoryPath(file.relativePath));
}

export async function createLocalAnalysisSnapshot(
  scanResult: ScanResult,
  computeDigests = true,
): Promise<RepositorySnapshot> {
  const textByteLimits = new Map(buildCLITextByteLimits(scanResult));
  for (const relativePath of selectLocalAnalysisSamplePaths(scanResult)) {
    textByteLimits.set(
      relativePath,
      Math.max(textByteLimits.get(relativePath) ?? 0, MAX_SAMPLE_BYTES),
    );
  }

  return createRepositorySnapshot(
    scanResult.rootPath,
    scanResult.files.map((file) => file.relativePath),
    {
      computeDigests,
      textByteLimits,
    },
  );
}

export class Analyzer {
  private verbose: boolean;
  private client: CopilotClient | null = null;

  constructor(verbose = false) {
    this.verbose = verbose;
  }

  async analyze(
    scanResult: ScanResult,
    repositorySnapshot?: RepositorySnapshot,
  ): Promise<AnalysisResult> {
    const snapshot = repositorySnapshot ??
      await createLocalAnalysisSnapshot(scanResult);
    const analyzedScanResult = restrictScanResultToSnapshot(
      scanResult,
      snapshot,
    );
    const cli = await analyzeCLIStructure(analyzedScanResult, snapshot);
    // Initialize Copilot SDK
    if (this.verbose) {
      console.log("  [SDK] Initializing CopilotClient...");
    }

    this.client = new CopilotClient({
      logLevel: this.verbose ? "debug" : "error",
    });

    if (this.verbose) {
      console.log("  [SDK] Starting client...");
    }

    let sessionId: string | undefined;
    try {
      await this.client.start();
    } catch (error) {
      console.error("  [SDK] Failed to start client:", (error as Error).message);
      console.error("  [SDK] Make sure Copilot CLI is installed and in PATH");
      console.error("  [SDK] Falling back to heuristic analysis...\n");
      return this.generateFallbackAnalysis(analyzedScanResult, cli);
    }

    if (this.verbose) {
      console.log("  [SDK] Client started successfully");
    }

    try {
      if (this.verbose) {
        console.log("  [SDK] Creating session with model: gpt-5...");
      }

      // Detect potential domain boundaries for system prompt
      const domains = detectDomainBoundaries(analyzedScanResult.files, path.sep);

      // Create a session with custom tools for analysis
      const session = await this.client.createSession({
        model: "gpt-5",
        streaming: true,
        ...createSecureAnalysisSessionConfig(
          getSystemPrompt(analyzedScanResult.language, domains),
        ),
      });
      sessionId = session.sessionId;

      if (this.verbose) {
        console.log("  [SDK] Session created successfully");
      }

      // Prepare file samples for analysis
      const samples = await this.gatherFileSamples(
        analyzedScanResult,
        snapshot,
      );

      if (this.verbose) {
        console.log(`  [SDK] Gathered ${samples.size} file samples`);
      }

      // Build the analysis prompt
      const fileList = analyzedScanResult.files
        .filter((file) =>
          !file.isTest &&
          !isSensitiveRepositoryPath(file.relativePath) &&
          !isGeneratedRepositoryPath(file.relativePath)
        )
        .slice(0, 100)
        .map((file) => file.relativePath)
        .join("\n");
      let sampleContent = "";
      for (const [filePath, content] of samples) {
        sampleContent += `\n--- ${filePath} ---\n${content}\n`;
      }

      const analysisPrompt = buildAnalysisPrompt(
        analyzedScanResult.language,
        analyzedScanResult.framework,
        analyzedScanResult.sourceDirectories,
        analyzedScanResult.configFiles.filter((file) =>
          !isSensitiveRepositoryPath(file) &&
          !isGeneratedRepositoryPath(file)
        ),
        fileList,
        sampleContent,
      );

      if (this.verbose) {
        console.log(`  [SDK] Sending prompt (${analysisPrompt.length} chars)...`);
      }

      let responseContent = "";
      let eventCount = 0;
      let responseTimeout: ReturnType<typeof setTimeout> | undefined;
      const clearResponseTimeout = () => {
        if (responseTimeout !== undefined) {
          clearTimeout(responseTimeout);
          responseTimeout = undefined;
        }
      };

      const done = new Promise<void>((resolve, reject) => {
        responseTimeout = setTimeout(() => {
          responseTimeout = undefined;
          console.error(`\n  [SDK] Timeout after 120s. Events received: ${eventCount}`);
          reject(new Error("SDK timeout"));
        }, 120000);

        session.on((event) => {
          eventCount++;
          const eventType = event.type as string;
          const eventData = event.data as Record<string, unknown>;

          if (this.verbose && eventType !== "assistant.message_delta") {
            console.log(`  [SDK] Event: ${eventType}`);
          }

          if (eventType === "assistant.message") {
            responseContent = (eventData.content as string) || "";
            if (this.verbose) {
              console.log(`  [SDK] Got final message (${responseContent.length} chars)`);
            }
            clearResponseTimeout();
            resolve();
          } else if (eventType === "assistant.message_delta") {
            process.stdout.write((eventData.deltaContent as string) || "");
          } else if (eventType === "session.idle") {
            clearResponseTimeout();
            if (this.verbose) {
              console.log(`  [SDK] Session idle. Total events: ${eventCount}`);
            }
            resolve();
          } else if (eventType === "error") {
            clearResponseTimeout();
            console.error("  [SDK] Error event:", eventData);
            reject(new Error("SDK error event"));
          }
        });
      });

      try {
        await session.send({ prompt: analysisPrompt });

        if (this.verbose) {
          console.log("  [SDK] Prompt sent, waiting for response...");
        }

        await done;
      } finally {
        clearResponseTimeout();
      }
      if (this.verbose) {
        console.log("\n");
      }

      // Parse the response
      const result = this.buildResult(
        responseContent,
        analyzedScanResult,
        cli,
      );

      await session.disconnect();
      return result;
    } catch (error) {
      console.error(`\n  [SDK] Error: ${(error as Error).message}`);
      console.error("  [SDK] Falling back to heuristic analysis...\n");
      return this.generateFallbackAnalysis(analyzedScanResult, cli);
    } finally {
      if (this.client) {
        try {
          if (sessionId) await this.client.deleteSession(sessionId);
          await this.client.stop();
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  private async gatherFileSamples(
    scanResult: ScanResult,
    repositorySnapshot?: RepositorySnapshot,
  ): Promise<Map<string, string>> {
    const snapshot = repositorySnapshot ??
      await createLocalAnalysisSnapshot(scanResult, false);
    const samples = new Map<string, string>();
    for (const relativePath of selectLocalAnalysisSamplePaths(scanResult)) {
      const snapshotFile = snapshot.files.get(
        relativePath,
      );
      if (snapshotFile?.text !== undefined) {
        samples.set(relativePath, snapshotFile.text);
      }
    }

    return samples;
  }

  private buildResult(
    response: string,
    scanResult: ScanResult,
    cli?: AnalysisResult["cli"],
  ): AnalysisResult {
    const parsed = parseAnalysisResponse(response, () => null);

    if (parsed === null) {
      return this.generateFallbackAnalysis(scanResult, cli);
    }

    const flatAgents = flattenAgents(parsed.agents);

    return {
      repoName: path.basename(scanResult.rootPath),
      skills: mergeCLISkills(
        parsed.skills as SkillDefinition[],
        cli ? generateCLISkills(cli) : [],
      ),
      agents: flatAgents,
      tools: extractAllTools(flatAgents),
      hooks: parsed.hooks.length > 0
        ? (parsed.hooks as AnalysisResult["hooks"])
        : generateDefaultHooks(scanResult.language, scanResult.testFiles.length > 0),
      summary: parsed.summary,
      cli,
    };
  }

  private generateFallbackAnalysis(
    scanResult: ScanResult,
    cli?: AnalysisResult["cli"],
  ): AnalysisResult {
    // Detect domains for hierarchical agent structure
    const domains = detectDomainBoundaries(scanResult.files, path.sep);

    // Generate basic skills based on detected directories
    const skills: SkillDefinition[] = mergeCLISkills(
      generateDefaultSkills(scanResult.sourceDirectories),
      cli ? generateCLISkills(cli) : [],
    );

    // Generate tools from config
    const tools: ToolDefinition[] = detectToolsFromConfig(scanResult.language, scanResult.configFiles);

    // Build hierarchical agents
    const agents: AgentDefinition[] = [];
    const subAgentNames: string[] = [];

    // Create sub-agents for each detected domain
    for (const domain of domains) {
      const domainSkills = skills.filter(
        (s) => s.sourceDir === domain.path || s.sourceDir.startsWith(domain.path + path.sep),
      );
      subAgentNames.push(domain.name);

      agents.push({
        name: domain.name,
        description: `Agent for the ${domain.name} domain (${domain.fileCount} files)`,
        skills: domainSkills.map((s) => s.name),
        tools: [],
        isSubAgent: true,
        parentAgent: "root",
        sourceDir: domain.path,
        triggers: [domain.name.toLowerCase()],
      });
    }

    // Create root agent
    const rootSkills = skills.filter(
      (s) => !domains.some((d) => s.sourceDir.startsWith(d.path)),
    );
    agents.unshift({
      name: "root",
      description: `Root agent for this ${scanResult.language} repository`,
      skills: rootSkills.map((s) => s.name),
      tools,
      isSubAgent: false,
      subAgents: subAgentNames,
      triggers: [scanResult.language.toLowerCase(), "main", "primary"],
    });

    // Generate hooks
    const hooks = generateDefaultHooks(scanResult.language, scanResult.testFiles.length > 0);

    return {
      repoName: path.basename(scanResult.rootPath),
      skills,
      agents,
      tools,
      hooks,
      summary: `A ${scanResult.language} repository${scanResult.framework ? ` using ${scanResult.framework}` : ""} with ${domains.length} detected domains.`,
      cli,
    };
  }
}

function restrictScanResultToSnapshot(
  scanResult: ScanResult,
  snapshot: RepositorySnapshot,
): ScanResult {
  const hasFile = (filePath: string) =>
    snapshot.files.has(normalizeRepositoryPath(filePath));
  const files = scanResult.files.filter((file) => hasFile(file.relativePath));

  return {
    ...scanResult,
    rootPath: snapshot.rootPath,
    files,
    configFiles: scanResult.configFiles.filter(hasFile),
    testFiles: scanResult.testFiles.filter(hasFile),
    cliEntryFiles: scanResult.cliEntryFiles.filter(hasFile),
  };
}
