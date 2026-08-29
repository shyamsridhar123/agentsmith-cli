/**
 * Remote Analyzer - Analyzes GitHub repos directly without cloning
 * Uses GitHub Copilot SDK with GitHub API for file access
 */

import { CopilotClient } from "@github/copilot-sdk";
import type { GitHubFile, GitHubRepo } from "../github/index.js";
import { GitHubClient } from "../github/index.js";
import {
  detectCLIFrameworkAndEntrypoints,
  isGeneratedRepositoryPath,
  isSensitiveRepositoryPath,
  isTestOrFixturePath,
  selectCLIImplementationFiles,
} from "../scanner/index.js";
import type { AnalysisResult, SkillDefinition, AgentDefinition } from "./types.js";
import {
  flattenAgents,
  extractAllTools,
  generateDefaultHooks,
  getDefaultTools,
  parseAnalysisResponse,
  generateDefaultSkills,
} from "./core.js";
import {
  analyzeCLIContents,
  generateCLISkills,
  mergeCLISkills,
} from "./cli.js";
import {
  buildRemoteAnalysisPrompt,
  detectRemoteFramework,
  detectRemoteLanguage,
  getRemoteSystemPrompt,
  selectRemotePriorityFiles,
} from "./remote-helpers.js";
import { createSecureAnalysisSessionConfig } from "./session-security.js";

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

export class RemoteAnalyzer {
  private verbose: boolean;
  private github: GitHubClient;
  private revision?: string;
  private repoInfo?: GitHubRepo;

  constructor(
    repoUrl: string,
    verbose = false,
    revision?: string,
    repoInfo?: GitHubRepo,
  ) {
    this.verbose = verbose;
    this.revision = revision;
    this.repoInfo = repoInfo;
    this.github = new GitHubClient(repoUrl, verbose);
  }

  async analyze(): Promise<AnalysisResult> {
    // Get repo info and file tree from GitHub API
    if (this.verbose) {
      console.log(`  [GH] Fetching repo info for ${this.github.fullName}...`);
    }

    const mutableRepoInfo = this.repoInfo ?? await this.github.getRepoInfo();
    const revision = this.revision ??
      await this.github.resolveRevision(mutableRepoInfo.defaultBranch);
    const repoInfo: GitHubRepo = {
      ...mutableRepoInfo,
      license: await this.github.getLicense(revision),
    };
    const tree = await this.github.getTree(revision);

    if (this.verbose) {
      console.log(`  [GH] Found ${tree.length} files/dirs`);
    }

    // Filter files
    const repositoryFiles = tree.filter(f =>
      f.type === "file" &&
      !IGNORE_PATTERNS.some(p => p.test(f.path)) &&
      !isSensitiveRepositoryPath(f.path) &&
      !isGeneratedRepositoryPath(f.path),
    );
    const testFiles = repositoryFiles
      .filter((file) => isTestOrFixturePath(file.path))
      .map((file) => file.path);
    const files = repositoryFiles.filter(
      (file) => !isTestOrFixturePath(file.path),
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

    const fileContents = await this.github.getFiles(priorityPaths, revision);
    const preliminaryCLI = this.detectCLI(files, fileContents);
    const missingCLIPaths = selectCLIImplementationFiles(
      files.map((file) => file.path),
      preliminaryCLI.entryFiles,
    ).filter((filePath) => !fileContents.has(filePath));
    if (missingCLIPaths.length > 0) {
      const cliContents = await this.github.getFiles(
        missingCLIPaths.slice(0, 100),
        revision,
      );
      for (const [filePath, content] of cliContents) {
        fileContents.set(filePath, content);
      }
    }
    const cliMetadata = this.detectCLI(files, fileContents);
    const cli = cliMetadata.framework
      ? analyzeCLIContents(
        cliMetadata.framework,
        cliMetadata.entryFiles,
        testFiles,
        fileContents,
      )
      : undefined;

    // Build prompt for Copilot SDK
    const prompt = this.buildPrompt(files, fileContents, language, framework);

    if (this.verbose) {
      console.log(`  [SDK] Prompt size: ${prompt.length} chars`);
    }

    // Analyze with Copilot SDK
    const client = new CopilotClient({
      logLevel: this.verbose ? "debug" : "error",
    });

    let sessionId: string | undefined;
    let analysisTimeout: ReturnType<typeof setTimeout> | undefined;
    const clearAnalysisTimeout = (): void => {
      if (analysisTimeout !== undefined) {
        clearTimeout(analysisTimeout);
        analysisTimeout = undefined;
      }
    };

    try {
      if (this.verbose) {
        console.log("  [SDK] Starting client...");
      }
      await client.start();
      if (this.verbose) {
        console.log("  [SDK] Client started, status:", client.getStatus());
        console.log("  [SDK] Creating session...");
      }

      const session = await client.createSession({
        model: "gpt-5",
        streaming: true,
        ...createSecureAnalysisSessionConfig(this.getSystemPrompt()),
      });
      sessionId = session.sessionId;

      if (this.verbose) {
        console.log(`  [SDK] Session created: ${session.sessionId}`);
      }

      let responseContent = "";
      let streamedContent = "";

      let waitSettled = false;
      let resolveDone: () => void = () => {};
      const done = new Promise<void>((resolve) => {
        resolveDone = resolve;
      });
      const settleWait = (): void => {
        if (waitSettled) return;
        waitSettled = true;
        clearAnalysisTimeout();
        resolveDone();
      };
      const armAnalysisTimeout = (): void => {
        clearAnalysisTimeout();
        analysisTimeout = setTimeout(() => {
          analysisTimeout = undefined;
          if (this.verbose) {
            console.log(`\n  [SDK] Session timeout - using streamed content (${streamedContent.length} chars)`);
          }
          settleWait();
        }, 120000);
      };

      session.on((event) => {
        const eventType = event.type as string;
        const eventData = event.data as Record<string, unknown>;

        if (eventType === "assistant.message_delta") {
          const delta = (eventData.deltaContent as string) || "";
          streamedContent += delta;
          process.stdout.write(delta);
        } else if (eventType === "assistant.message") {
          responseContent = (eventData.content as string) || "";
          settleWait();
        } else if (eventType === "session.idle") {
          settleWait();
        } else if (eventType === "error") {
          console.error("  [SDK] Error event:", eventData);
          settleWait();
        }
      });

      if (this.verbose) {
        console.log("  [SDK] Sending prompt...");
      }
      armAnalysisTimeout();
      try {
        await session.send({ prompt });
      } finally {
        clearAnalysisTimeout();
      }
      if (!waitSettled) {
        armAnalysisTimeout();
      }
      if (this.verbose) {
        console.log("  [SDK] Prompt sent, waiting...");
      }
      await done;

      console.log("\n");

      await session.disconnect();
      await client.deleteSession(session.sessionId);
      sessionId = undefined;
      await client.stop();

      // Use streamed content if no complete message received
      const finalContent = responseContent || streamedContent;

      // Parse response
      return this.buildResult(finalContent, repoInfo, language, framework, cli);

    } catch (error) {
      console.error(`  [SDK] Error: ${(error as Error).message}`);
      if (sessionId) await client.deleteSession(sessionId).catch(() => {});
      await client.stop().catch(() => {});
      return this.generateFallback(repoInfo, language, framework, files, cli);
    } finally {
      clearAnalysisTimeout();
    }
  }

  private detectLanguage(files: GitHubFile[]): string {
    return detectRemoteLanguage(files);
  }

  private detectFramework(files: GitHubFile[]): string | undefined {
    return detectRemoteFramework(files);
  }

  private detectCLI(
    files: GitHubFile[],
    contents: ReadonlyMap<string, string>,
  ): { framework?: string; entryFiles: string[] } {
    const detected = detectCLIFrameworkAndEntrypoints(
      files.map((file) => file.path),
      contents,
    );
    return {
      framework: detected.framework ?? undefined,
      entryFiles: detected.entryFiles,
    };
  }

  private selectPriorityFiles(files: GitHubFile[]): string[] {
    return selectRemotePriorityFiles(files);
  }

  private getSystemPrompt(): string {
    return getRemoteSystemPrompt();
  }

  private buildPrompt(
    files: GitHubFile[],
    contents: Map<string, string>,
    language: string,
    framework?: string,
  ): string {
    return buildRemoteAnalysisPrompt(files, contents, language, framework);
  }

  private buildResult(
    response: string,
    repo: { owner: string; repo: string; license?: string },
    language: string,
    framework: string | undefined,
    cli?: AnalysisResult["cli"],
  ): AnalysisResult {
    const parsed = parseAnalysisResponse(response, () => null);

    if (parsed === null) {
      // Will not happen in the fallback path, but this handles parse failure
      return {
        repoName: repo.repo,
        skills: cli ? generateCLISkills(cli) : [],
        agents: [],
        tools: [],
        hooks: generateDefaultHooks(language, false),
        summary: "",
        cli,
        repo: { ...repo, language, framework },
      };
    }

    const flatAgents = flattenAgents(parsed.agents);

    return {
      repoName: repo.repo,
      skills: mergeCLISkills(
        parsed.skills as SkillDefinition[],
        cli ? generateCLISkills(cli) : [],
      ),
      agents: flatAgents,
      tools: extractAllTools(flatAgents),
      hooks: generateDefaultHooks(language, false),
      summary: parsed.summary,
      cli,
      repo: { ...repo, language, framework },
    };
  }

  private generateFallback(
    repo: { owner: string; repo: string; license?: string },
    language: string,
    framework: string | undefined,
    files: GitHubFile[],
    cli?: AnalysisResult["cli"],
  ): AnalysisResult {
    // Detect source directories
    const srcDirs = new Set<string>();
    for (const f of files) {
      const parts = f.path.split("/");
      if (parts.length > 1 && ["src", "lib", "app", "pkg", "cmd"].includes(parts[0])) {
        srcDirs.add(parts[0]);
      }
    }

    const skills: SkillDefinition[] = mergeCLISkills(
      generateDefaultSkills(Array.from(srcDirs)),
      cli ? generateCLISkills(cli) : [],
    );
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
      cli,
      repo: { ...repo, language, framework },
    };
  }
}
