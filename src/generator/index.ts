/**
 * Generator - writes skills, agents, handoffs, instructions, hooks, and freshness metadata.
 */

import path from "path";
import yaml from "yaml";
import type { AnalysisResult, HookDefinition } from "../analyzer/index.js";
import {
  buildCopilotInstructions,
  buildDirectoryInstructions,
  mergeWithExisting,
} from "./instructions-writer.js";
import { buildRootAgentMd, buildSubAgentMd } from "./agent-writer.js";
import { buildHandoffGraph, serializeHandoffGraph } from "./handoff-writer.js";
import {
  buildCoordinationSection,
  buildSubAgentCoordination,
  extendHandoffGraph,
} from "./hub-writer.js";
import { buildMainAgentMd, buildSkillMarkdown } from "./legacy-writer.js";
import {
  createGenerationPlan,
  sanitizeAgentStem,
  type PlannedAgentFile,
  type PlannedHookFile,
  type PlannedSkillFile,
} from "./generation-plan.js";
import {
  previousManagedFiles,
  readFreshness,
  serializeFreshness,
  type FreshnessMetadata,
} from "./freshness.js";
import {
  digestManagedContent,
  hasManagedAssetMarker,
  markManagedAsset,
  type ManagedAssetKind,
} from "./managed-assets.js";
import {
  atomicWriteContainedFile,
  assertPortablePathComponents,
  createContainedRoot,
  ensureContainedDirectory,
  readContainedFile,
  removeContainedExistingFile,
  type ContainedRoot,
} from "./path-safety.js";

export interface GeneratorResult {
  files: string[];
  hookFiles: string[];
  agentFiles: Array<{ name: string; file: string; isSubAgent: boolean }>;
  skillFiles: Array<{ name: string; file: string }>;
}

export class Generator {
  private containedRoot?: Promise<ContainedRoot>;
  private generatedDigests = new Map<string, string>();

  constructor(
    private rootPath: string,
    private dryRun = false,
    private verbose = false,
    private noInstructions = false,
    private singleAgent = false,
    private hubUrl?: string,
  ) {}

  async generate(analysis: AnalysisResult): Promise<GeneratorResult> {
    this.generatedDigests.clear();
    const plan = createGenerationPlan(analysis, this.singleAgent);
    const result: GeneratorResult = {
      files: [],
      hookFiles: plan.hookFiles.map((hook) => hook.file),
      agentFiles: plan.agentFiles.map(({ name, file, isSubAgent }) => ({
        name,
        file,
        isSubAgent,
      })),
      skillFiles: plan.skillFiles.map(({ name, file }) => ({ name, file })),
    };
    let previous: FreshnessMetadata | undefined;

    if (!this.dryRun) {
      const root = await this.getContainedRoot();
      previous = await readFreshness(root);
      await Promise.all([
        this.ensureOutputDirectory(".github/skills"),
        this.ensureOutputDirectory(".github/agents"),
        this.ensureOutputDirectory(".github/hooks"),
      ]);
    }

    for (const skill of plan.skillFiles) {
      await this.generateSkill(skill);
      result.files.push(skill.file);
    }
    for (const agent of plan.agentFiles) {
      await this.generateAgent(agent, analysis);
      result.files.push(agent.file);
    }
    if (plan.handoffFile) {
      await this.generateHandoffs(analysis, plan.handoffFile);
      result.files.push(plan.handoffFile);
    }

    if (!this.noInstructions) {
      result.files.push(await this.generateCopilotInstructions(analysis));
      result.files.push(...await this.generateDirectoryInstructions(analysis));
    }

    for (const hook of plan.hookFiles) {
      await this.generateHook(hook);
      result.files.push(hook.file);
    }

    if (!this.dryRun) {
      await this.reconcileStaleManagedFiles(previous, result, plan.handoffFile);
    }
    result.files.push(await this.generateFreshness(analysis, result, plan.handoffFile));

    if (this.verbose) {
      console.log(`Generated ${result.files.length} Agent Smith asset(s).`);
    }
    return result;
  }

  private async generateSkill(plan: PlannedSkillFile): Promise<void> {
    const content = buildSkillMarkdown(plan.skill, this.writerHelpers());
    await this.write(plan.file, content, true);
  }

  private async generateAgent(
    plan: PlannedAgentFile,
    analysis: AnalysisResult,
  ): Promise<void> {
    let content: string;
    if (plan.combined) {
      content = buildMainAgentMd(
        analysis,
        sanitizeAgentStem(analysis.repoName),
        this.writerHelpers(),
      );
      if (this.hubUrl) {
        content += `\n${buildCoordinationSection(analysis.repoName, this.hubUrl)}`;
      }
    } else if (plan.agent?.isSubAgent) {
      content = buildSubAgentMd(plan.agent, analysis.skills, this.writerHelpers());
      if (this.hubUrl) {
        content += `\n${buildSubAgentCoordination(
          plan.agent.name,
          analysis.repoName,
          this.hubUrl,
        )}`;
      }
    } else {
      content = buildRootAgentMd(
        analysis,
        `${sanitizeAgentStem(analysis.repoName)}-root`,
        this.writerHelpers(),
      );
      if (this.hubUrl) {
        content += `\n${buildCoordinationSection(analysis.repoName, this.hubUrl)}`;
      }
    }
    await this.write(plan.file, content, true);
  }

  private async generateHandoffs(
    analysis: AnalysisResult,
    relativePath: string,
  ): Promise<void> {
    const graph = buildHandoffGraph(analysis.agents);
    const finalGraph = this.hubUrl
      ? extendHandoffGraph(graph, this.hubUrl, analysis.repoName)
      : graph;
    await this.write(relativePath, serializeHandoffGraph(finalGraph), true);
  }

  private async generateDirectoryInstructions(
    analysis: AnalysisResult,
  ): Promise<string[]> {
    const generated: string[] = [];
    for (const instruction of buildDirectoryInstructions(analysis)) {
      const directoryPath = path.resolve(this.rootPath, instruction.directory);
      const relative = path.relative(this.rootPath, directoryPath);
      if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
      const relativePath = path.posix.join(
        instruction.directory.replace(/\\/g, "/"),
        ".copilot-instructions.md",
      );
      let content = instruction.content;
      if (!this.dryRun) {
        try {
          content = mergeWithExisting(
            await readContainedFile(await this.getContainedRoot(), this.absolute(relativePath)),
            instruction.content,
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      await this.write(relativePath, content);
      generated.push(relativePath);
    }
    return generated;
  }

  private async generateCopilotInstructions(
    analysis: AnalysisResult,
  ): Promise<string> {
    const relativePath = ".github/copilot-instructions.md";
    const managedBlock = buildCopilotInstructions(analysis);
    let content = managedBlock;
    if (!this.dryRun) {
      try {
        content = mergeWithExisting(
          await readContainedFile(await this.getContainedRoot(), this.absolute(relativePath)),
          managedBlock,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    await this.write(relativePath, content);
    return relativePath;
  }

  private async generateHook(plan: PlannedHookFile): Promise<void> {
    await this.write(plan.file, this.buildHookYaml(plan.hook), true);
  }

  private async generateFreshness(
    analysis: AnalysisResult,
    result: GeneratorResult,
    handoffFile?: string,
  ): Promise<string> {
    const relativePath = ".github/copilot/freshness.json";
    await this.write(
      relativePath,
      serializeFreshness(analysis, result, handoffFile, this.generatedDigests),
    );
    return relativePath;
  }

  private async reconcileStaleManagedFiles(
    previous: FreshnessMetadata | undefined,
    result: GeneratorResult,
    currentHandoff?: string,
  ): Promise<void> {
    const currentFiles = new Set([
      ...result.agentFiles.map((agent) => agent.file),
      ...result.skillFiles.map((skill) => skill.file),
      ...result.hookFiles,
      ...(currentHandoff ? [currentHandoff] : []),
    ].map((file) => this.pathKey(file)));

    for (const stale of previousManagedFiles(previous)) {
      let canonical: string;
      try {
        canonical = this.assertManagedPath(stale.file, stale.kind);
      } catch {
        continue;
      }
      if (!currentFiles.has(this.pathKey(canonical))) {
        await this.removeIfOwnedAndUnchanged(canonical, stale.digest);
      }
    }
  }

  private assertManagedPath(file: string, kind: ManagedAssetKind): string {
    const normalized = file.replace(/\\/g, "/");
    assertPortablePathComponents(normalized, `managed ${kind} path`);
    const safe = normalized === path.posix.normalize(normalized) && (
      (kind === "agent" && /^\.github\/agents\/[^/]+\.agent\.md$/.test(normalized))
      || (kind === "skill" && /^\.github\/skills\/[^/]+\/SKILL\.md$/.test(normalized))
      || (kind === "hook" && /^\.github\/hooks\/[^/]+\.ya?ml$/.test(normalized))
      || (kind === "handoff" && normalized === ".github/copilot/handoffs.json")
    );
    if (!safe) {
      throw new Error(`Unsafe managed ${kind} path in freshness metadata: ${file}`);
    }
    return normalized;
  }

  private async removeIfOwnedAndUnchanged(
    relativePath: string,
    expectedDigest: string,
  ): Promise<void> {
    const root = await this.getContainedRoot();
    const absolutePath = this.absolute(relativePath);
    try {
      const content = await readContainedFile(root, absolutePath);
      if (
        digestManagedContent(content) !== expectedDigest
        || !hasManagedAssetMarker(relativePath, content)
      ) {
        return;
      }
      await removeContainedExistingFile(root, absolutePath, expectedDigest);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private buildHookYaml(hook: HookDefinition): string {
    const document = {
      name: hook.name,
      event: hook.event,
      description: hook.description,
      commands: hook.commands,
      ...(hook.condition ? { condition: hook.condition } : {}),
    };
    return `# Hook Configuration
# Generated by Agent Smith

${yaml.stringify(document, { lineWidth: 0 })}`;
  }

  private writerHelpers(): {
    toTitleCase: (value: string | unknown) => string;
    quoteYamlValue: (value: string) => string;
  } {
    return {
      toTitleCase: this.toTitleCase.bind(this),
      quoteYamlValue: this.quoteYamlValue.bind(this),
    };
  }

  private absolute(relativePath: string): string {
    return path.join(this.rootPath, ...relativePath.split("/"));
  }

  private pathKey(file: string): string {
    return path.posix.normalize(file).normalize("NFC").toLowerCase();
  }

  private getContainedRoot(): Promise<ContainedRoot> {
    this.containedRoot ??= createContainedRoot(this.rootPath);
    return this.containedRoot;
  }

  private async ensureOutputDirectory(relativePath: string): Promise<string> {
    return ensureContainedDirectory(
      await this.getContainedRoot(),
      this.absolute(relativePath),
    );
  }

  private async write(
    relativePath: string,
    content: string,
    managed = false,
  ): Promise<void> {
    const finalContent = managed ? markManagedAsset(relativePath, content) : content;
    if (managed) {
      this.generatedDigests.set(relativePath, digestManagedContent(finalContent));
    }
    if (this.dryRun) return;
    await atomicWriteContainedFile(
      await this.getContainedRoot(),
      this.absolute(relativePath),
      finalContent,
    );
  }

  private quoteYamlValue(value: string): string {
    if (/[:#{}[\]&*?|>!%@`]/.test(value) || value.startsWith("'") || value.startsWith('"')) {
      return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    }
    return value;
  }

  private toTitleCase(value: string | unknown): string {
    let text = value;
    if (typeof text !== "string") {
      text = text && typeof text === "object" && "name" in text
        ? (text as { name: string }).name
        : String(text ?? "unknown");
    }
    return (text as string)
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }
}
