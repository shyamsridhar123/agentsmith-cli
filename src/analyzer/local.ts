/**
 * Local Analyzer - The Mind of Agent Smith
 * Uses GitHub Copilot SDK to perform deep semantic analysis of a local repository.
 * "The best thing about being me... there are so many of me."
 */

import { CopilotClient, approveAll } from "@github/copilot-sdk";
import fs from "fs/promises";
import path from "path";
import type { ScanResult } from "../scanner/index.js";
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

export class Analyzer {
  private verbose: boolean;
  private client: CopilotClient | null = null;

  constructor(verbose = false) {
    this.verbose = verbose;
  }

  async analyze(scanResult: ScanResult): Promise<AnalysisResult> {
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

    try {
      await this.client.start();
    } catch (error) {
      console.error("  [SDK] Failed to start client:", (error as Error).message);
      console.error("  [SDK] Make sure Copilot CLI is installed and in PATH");
      console.error("  [SDK] Falling back to heuristic analysis...\n");
      return this.generateFallbackAnalysis(scanResult);
    }

    if (this.verbose) {
      console.log("  [SDK] Client started successfully");
    }

    try {
      if (this.verbose) {
        console.log("  [SDK] Creating session with model: gpt-5...");
      }

      // Detect potential domain boundaries for system prompt
      const domains = detectDomainBoundaries(scanResult.files, path.sep);

      // Create a session with custom tools for analysis
      const session = await this.client.createSession({
        model: "gpt-5",
        streaming: true,
        systemMessage: {
          content: getSystemPrompt(scanResult.language, domains),
        },
        onPermissionRequest: approveAll,
      });

      if (this.verbose) {
        console.log("  [SDK] Session created successfully");
      }

      // Prepare file samples for analysis
      const samples = await this.gatherFileSamples(scanResult);

      if (this.verbose) {
        console.log(`  [SDK] Gathered ${samples.size} file samples`);
      }

      // Build the analysis prompt
      const fileList = scanResult.files.slice(0, 100).map((f) => f.relativePath).join("\n");
      let sampleContent = "";
      for (const [filePath, content] of samples) {
        sampleContent += `\n--- ${filePath} ---\n${content}\n`;
      }

      const analysisPrompt = buildAnalysisPrompt(
        scanResult.language,
        scanResult.framework,
        scanResult.sourceDirectories,
        scanResult.configFiles,
        fileList,
        sampleContent,
      );

      if (this.verbose) {
        console.log(`  [SDK] Sending prompt (${analysisPrompt.length} chars)...`);
      }

      let responseContent = "";
      let eventCount = 0;

      const done = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
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
          } else if (eventType === "assistant.message_delta") {
            process.stdout.write((eventData.deltaContent as string) || "");
          } else if (eventType === "session.idle") {
            clearTimeout(timeout);
            if (this.verbose) {
              console.log(`  [SDK] Session idle. Total events: ${eventCount}`);
            }
            resolve();
          } else if (eventType === "error") {
            clearTimeout(timeout);
            console.error("  [SDK] Error event:", eventData);
            reject(new Error("SDK error event"));
          }
        });
      });

      await session.send({ prompt: analysisPrompt });

      if (this.verbose) {
        console.log("  [SDK] Prompt sent, waiting for response...");
      }

      await done;

      if (this.verbose) {
        console.log("\n");
      }

      // Parse the response
      const result = this.buildResult(responseContent, scanResult);

      await session.destroy();
      return result;
    } catch (error) {
      console.error(`\n  [SDK] Error: ${(error as Error).message}`);
      console.error("  [SDK] Falling back to heuristic analysis...\n");
      return this.generateFallbackAnalysis(scanResult);
    } finally {
      if (this.client) {
        try {
          await this.client.stop();
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  private async gatherFileSamples(scanResult: ScanResult): Promise<Map<string, string>> {
    const samples = new Map<string, string>();
    const maxSamples = 20;
    const maxFileSize = 10000; // 10KB per file

    // Prioritize: config files, main entry points, key directories
    const priorityFiles = scanResult.files
      .filter((f) => !f.isTest)
      .sort((a, b) => {
        // Config files first
        if (a.isConfig && !b.isConfig) return -1;
        if (!a.isConfig && b.isConfig) return 1;

        // Then by directory depth (shallower = more important)
        const depthA = a.relativePath.split(path.sep).length;
        const depthB = b.relativePath.split(path.sep).length;
        return depthA - depthB;
      })
      .slice(0, maxSamples);

    for (const file of priorityFiles) {
      if (file.size > maxFileSize) continue;

      try {
        const content = await fs.readFile(file.path, "utf-8");
        samples.set(file.relativePath, content.slice(0, maxFileSize));
      } catch {
        // Skip unreadable files
      }
    }

    return samples;
  }

  private buildResult(response: string, scanResult: ScanResult): AnalysisResult {
    const parsed = parseAnalysisResponse(response, () => null);

    if (parsed === null) {
      return this.generateFallbackAnalysis(scanResult);
    }

    const flatAgents = flattenAgents(parsed.agents);

    return {
      repoName: path.basename(scanResult.rootPath),
      skills: parsed.skills as SkillDefinition[],
      agents: flatAgents,
      tools: extractAllTools(flatAgents),
      hooks: parsed.hooks.length > 0
        ? (parsed.hooks as AnalysisResult["hooks"])
        : generateDefaultHooks(scanResult.language, scanResult.testFiles.length > 0),
      summary: parsed.summary,
    };
  }

  private generateFallbackAnalysis(scanResult: ScanResult): AnalysisResult {
    // Detect domains for hierarchical agent structure
    const domains = detectDomainBoundaries(scanResult.files, path.sep);

    // Generate basic skills based on detected directories
    const skills: SkillDefinition[] = generateDefaultSkills(scanResult.sourceDirectories);

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
    };
  }
}
