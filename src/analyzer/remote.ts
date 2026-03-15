/**
 * Remote Analyzer - Analyzes GitHub repos directly without cloning
 * Uses GitHub Copilot SDK with GitHub API for file access
 */

import { CopilotClient, approveAll } from "@github/copilot-sdk";
import type { GitHubFile } from "../github/index.js";
import { GitHubClient } from "../github/index.js";
import type { AnalysisResult, SkillDefinition, AgentDefinition } from "./types.js";
import {
  flattenAgents,
  extractAllTools,
  generateDefaultHooks,
  getDefaultTools,
  parseAnalysisResponse,
  generateDefaultSkills,
} from "./core.js";

// Files/dirs to ignore
const IGNORE_PATTERNS = [
  /^node_modules\//,
  /^\.git\//,
  /^dist\//,
  /^build\//,
  /^\.next\//,
  /^coverage\//,
  /^__pycache__\//,
  /^\.venv\//,
  /^venv\//,
  /\.lock$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
];

// Config files to prioritize
const CONFIG_FILES = [
  "package.json",
  "tsconfig.json",
  "pyproject.toml",
  "setup.py",
  "go.mod",
  "Cargo.toml",
  "README.md",
];

export class RemoteAnalyzer {
  private verbose: boolean;
  private github: GitHubClient;

  constructor(repoUrl: string, verbose = false) {
    this.verbose = verbose;
    this.github = new GitHubClient(repoUrl, verbose);
  }

  async analyze(): Promise<AnalysisResult> {
    // Get repo info and file tree from GitHub API
    if (this.verbose) {
      console.log(`  [GH] Fetching repo info for ${this.github.fullName}...`);
    }

    const repoInfo = await this.github.getRepoInfo();
    const tree = await this.github.getTree();

    if (this.verbose) {
      console.log(`  [GH] Found ${tree.length} files/dirs`);
    }

    // Filter files
    const files = tree.filter(f =>
      f.type === "file" &&
      !IGNORE_PATTERNS.some(p => p.test(f.path)),
    );

    // Detect language from file extensions
    const language = this.detectLanguage(files);
    const framework = this.detectFramework(files);

    if (this.verbose) {
      console.log(`  [GH] Language: ${language}, Framework: ${framework || "none"}`);
    }

    // Get priority files for analysis
    const priorityPaths = this.selectPriorityFiles(files);

    if (this.verbose) {
      console.log(`  [GH] Fetching ${priorityPaths.length} priority files...`);
    }

    const fileContents = await this.github.getFiles(priorityPaths);

    // Build prompt for Copilot SDK
    const prompt = this.buildPrompt(files, fileContents, language, framework);

    if (this.verbose) {
      console.log(`  [SDK] Prompt size: ${prompt.length} chars`);
    }

    // Analyze with Copilot SDK
    const client = new CopilotClient({
      logLevel: this.verbose ? "debug" : "error",
    });

    try {
      if (this.verbose) {
        console.log("  [SDK] Starting client...");
      }
      await client.start();
      if (this.verbose) {
        console.log("  [SDK] Client started, state:", client.getState());
        console.log("  [SDK] Creating session...");
      }

      const session = await client.createSession({
        model: "gpt-5",
        streaming: true,
        systemMessage: {
          content: this.getSystemPrompt(),
        },
        onPermissionRequest: approveAll,
      });

      if (this.verbose) {
        console.log(`  [SDK] Session created: ${session.sessionId}`);
      }

      let responseContent = "";
      let streamedContent = "";
      let eventCount = 0;

      const done = new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (this.verbose) {
            console.log(`\n  [SDK] Session timeout - using streamed content (${streamedContent.length} chars)`);
          }
          resolve();
        }, 120000);

        session.on((event) => {
          eventCount++;
          const eventType = event.type as string;
          const eventData = event.data as Record<string, unknown>;

          if (eventType === "assistant.message_delta") {
            const delta = (eventData.deltaContent as string) || "";
            streamedContent += delta;
            process.stdout.write(delta);
          } else if (eventType === "assistant.message") {
            responseContent = (eventData.content as string) || "";
            clearTimeout(timeout);
            resolve();
          } else if (eventType === "session.idle") {
            clearTimeout(timeout);
            resolve();
          } else if (eventType === "error") {
            clearTimeout(timeout);
            console.error("  [SDK] Error event:", eventData);
            resolve();
          }
        });
      });

      if (this.verbose) {
        console.log("  [SDK] Sending prompt...");
      }
      await session.send({ prompt });
      if (this.verbose) {
        console.log("  [SDK] Prompt sent, waiting...");
      }
      await done;

      console.log("\n");

      await session.destroy();
      await client.stop();

      // Use streamed content if no complete message received
      const finalContent = responseContent || streamedContent;

      // Parse response
      return this.buildResult(finalContent, repoInfo, language, framework);

    } catch (error) {
      console.error(`  [SDK] Error: ${(error as Error).message}`);
      await client.stop().catch(() => {});
      return this.generateFallback(repoInfo, language, framework, files);
    }
  }

  private detectLanguage(files: GitHubFile[]): string {
    const extCounts: Record<string, number> = {};
    const extMap: Record<string, string> = {
      ".ts": "TypeScript",
      ".tsx": "TypeScript",
      ".js": "JavaScript",
      ".jsx": "JavaScript",
      ".py": "Python",
      ".go": "Go",
      ".rs": "Rust",
      ".java": "Java",
      ".cs": "C#",
      ".rb": "Ruby",
    };

    for (const file of files) {
      const ext = "." + file.path.split(".").pop();
      if (extMap[ext]) {
        extCounts[ext] = (extCounts[ext] || 0) + 1;
      }
    }

    let maxCount = 0;
    let lang = "Unknown";
    for (const [ext, count] of Object.entries(extCounts)) {
      if (count > maxCount) {
        maxCount = count;
        lang = extMap[ext];
      }
    }

    // Check for tsconfig to override JS detection
    if (lang === "JavaScript" && files.some(f => f.path.includes("tsconfig"))) {
      lang = "TypeScript";
    }

    return lang;
  }

  private detectFramework(files: GitHubFile[]): string | undefined {
    const paths = new Set(files.map(f => f.path));

    if (paths.has("next.config.js") || paths.has("next.config.mjs")) return "Next.js";
    if (paths.has("angular.json")) return "Angular";
    if (paths.has("vue.config.js")) return "Vue";
    if (paths.has("nuxt.config.ts") || paths.has("nuxt.config.js")) return "Nuxt";

    return undefined;
  }

  private selectPriorityFiles(files: GitHubFile[]): string[] {
    const maxFiles = 15;
    const maxSize = 50000; // 50KB max per file

    const priority: string[] = [];

    // Config files first
    for (const cfg of CONFIG_FILES) {
      const match = files.find(f => f.path === cfg || f.path.endsWith("/" + cfg));
      if (match && (match.size || 0) < maxSize) {
        priority.push(match.path);
      }
    }

    // Then source files by depth (shallower = more important)
    const sourceFiles = files
      .filter(f => !priority.includes(f.path) && (f.size || 0) < maxSize)
      .filter(f => /\.(ts|js|py|go|rs|java)$/.test(f.path))
      .sort((a, b) => a.path.split("/").length - b.path.split("/").length);

    for (const f of sourceFiles) {
      if (priority.length >= maxFiles) break;
      priority.push(f.path);
    }

    return priority;
  }

  private getSystemPrompt(): string {
    return `You are Agent Smith, an AI designed to assimilate repositories into agent hierarchies.

Analyze the repository and extract:
1. SKILLS - Reusable patterns and capabilities (aim for 5-15 skills per repo)
2. AGENTS - A root agent plus NESTED SUB-AGENTS for each major domain/directory
3. SUB-AGENTS - Always extract 2-7 sub-agents based on directory structure or domain boundaries
4. TOOLS - Commands that can be run (build, test, lint)

CRITICAL: Sub-agents must be nested objects inside the parent's subAgents array, not just names.
Each sub-agent needs: name, description, skills, tools, isSubAgent=true, triggers.

Respond in valid JSON only. No markdown, no explanation.`;
  }

  private buildPrompt(
    files: GitHubFile[],
    contents: Map<string, string>,
    language: string,
    framework?: string,
  ): string {
    const fileList = files.slice(0, 100).map(f => f.path).join("\n");

    let samples = "";
    for (const [filePath, content] of contents) {
      if (content) {
        samples += `\n--- ${filePath} ---\n${content.slice(0, 5000)}\n`;
      }
    }

    return `Analyze this ${language} repository${framework ? ` using ${framework}` : ""}.

## Files (first 100)
${fileList}

## File Contents
${samples}

## Instructions
Extract 5-15 skills and create a hierarchical agent structure with nested sub-agents.
Look at directory structure and create sub-agents for major domains (cmd, api, internal, lib, etc.)

## Return JSON (sub-agents as NESTED OBJECTS, not strings):
{
  "skills": [
    {"name": "skill-name", "description": "...", "sourceDir": "src/x", "patterns": ["pattern 1"], "triggers": ["keyword"], "category": "patterns", "examples": ["code example"]}
  ],
  "agents": [
    {
      "name": "root",
      "description": "Main orchestrator for this repo",
      "skills": ["skill-1", "skill-2"],
      "tools": ["go build ./...", "npm test"],
      "isSubAgent": false,
      "subAgents": [
        {
          "name": "cli-agent",
          "description": "Handles CLI commands",
          "skills": ["cli-patterns"],
          "tools": ["./cmd/app help"],
          "isSubAgent": true,
          "triggers": ["cmd", "cli", "commands"]
        },
        {
          "name": "api-agent",
          "description": "Handles API endpoints",
          "skills": ["api-patterns"],
          "tools": ["curl localhost:8080/health"],
          "isSubAgent": true,
          "triggers": ["api", "http", "endpoints"]
        }
      ],
      "triggers": ["main", "root", "${language.toLowerCase()}"]
    }
  ],
  "summary": "One paragraph about this repo"
}`;
  }

  private buildResult(
    response: string,
    repo: { owner: string; repo: string; license?: string },
    language: string,
    framework: string | undefined,
  ): AnalysisResult {
    const parsed = parseAnalysisResponse(response, () => null);

    if (parsed === null) {
      // Will not happen in the fallback path, but this handles parse failure
      return {
        repoName: repo.repo,
        skills: [],
        agents: [],
        tools: [],
        hooks: generateDefaultHooks(language, false),
        summary: "",
        repo: { ...repo, language, framework },
      };
    }

    const flatAgents = flattenAgents(parsed.agents);

    return {
      repoName: repo.repo,
      skills: parsed.skills as SkillDefinition[],
      agents: flatAgents,
      tools: extractAllTools(flatAgents),
      hooks: generateDefaultHooks(language, false),
      summary: parsed.summary,
      repo: { ...repo, language, framework },
    };
  }

  private generateFallback(
    repo: { owner: string; repo: string; license?: string },
    language: string,
    framework: string | undefined,
    files: GitHubFile[],
  ): AnalysisResult {
    // Detect source directories
    const srcDirs = new Set<string>();
    for (const f of files) {
      const parts = f.path.split("/");
      if (parts.length > 1 && ["src", "lib", "app", "pkg", "cmd"].includes(parts[0])) {
        srcDirs.add(parts[0]);
      }
    }

    const skills: SkillDefinition[] = generateDefaultSkills(Array.from(srcDirs));
    const tools = getDefaultTools(language);

    const agents: AgentDefinition[] = [{
      name: "root",
      description: `Root agent for ${repo.owner}/${repo.repo}`,
      skills: skills.map(s => s.name),
      tools,
      isSubAgent: false,
      subAgents: [],
      triggers: [language.toLowerCase()],
    }];

    return {
      repoName: repo.repo,
      skills,
      agents,
      tools,
      hooks: generateDefaultHooks(language, false),
      summary: `A ${language} repository${framework ? ` using ${framework}` : ""}.`,
      repo: { ...repo, language, framework },
    };
  }
}
