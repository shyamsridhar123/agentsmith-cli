/**
 * Registry - builds and searches the JSONL skills and agents index.
 */

import path from "path";
import { z } from "zod";
import type { SkillDefinition, AgentDefinition } from "../analyzer/index.js";
import type { GeneratorResult } from "../generator/index.js";
import { readFreshness } from "../generator/freshness.js";
import {
  atomicWriteContainedFile,
  createContainedRoot,
  readContainedFile,
  type ContainedRoot,
} from "../generator/path-safety.js";
import {
  assertRegistryAssetExists,
  canonicalizeRegistryAssetPath,
  registryPathKey,
  type RegistryAssetType,
} from "./asset-path.js";

export interface RegistryEntry {
  type: "skill" | "agent";
  name: string;
  file: string;
  vsCodeAgent?: string;
  description: string;
  category?: string;
  triggers: string[];
  parentAgent?: string;
  subAgents?: string[];
  isSubAgent?: boolean;
}

export const RegistryEntrySchema = z.object({
  type: z.enum(["skill", "agent"]),
  name: z.string().min(1),
  file: z.string().min(1),
  vsCodeAgent: z.string().optional(),
  description: z.string(),
  category: z.string().optional(),
  triggers: z.array(z.string()).default([]),
  parentAgent: z.string().optional(),
  subAgents: z.array(z.string()).optional(),
  isSubAgent: z.boolean().optional(),
});

type RegistryBuildAssets = Pick<GeneratorResult, "agentFiles" | "skillFiles">;

function parseEntries(content: string): RegistryEntry[] {
  const entries: RegistryEntry[] = [];
  for (const line of content.trim().split("\n").filter(Boolean)) {
    try {
      const parsed = RegistryEntrySchema.safeParse(JSON.parse(line));
      if (parsed.success) entries.push(parsed.data);
    } catch {
      // Search ignores malformed lines; validate reports them explicitly.
    }
  }
  return entries;
}

function assertUniqueEntry(
  seenNames: Set<string>,
  seenPaths: Set<string>,
  type: RegistryAssetType,
  name: string,
  file: string,
): void {
  const nameKey = `${type}:${name.normalize("NFC").toLowerCase()}`;
  const pathKey = registryPathKey(file);
  if (seenNames.has(nameKey)) {
    throw new Error(`Duplicate ${type} registry name: ${name}`);
  }
  if (seenPaths.has(pathKey)) {
    throw new Error(`Duplicate registry asset path: ${file}`);
  }
  seenNames.add(nameKey);
  seenPaths.add(pathKey);
}

export class Registry {
  private registryPath: string;
  private containedRoot?: Promise<ContainedRoot>;

  constructor(
    private rootPath: string,
    private dryRun = false,
  ) {
    this.registryPath = path.join(rootPath, "skills-registry.jsonl");
  }

  async build(
    skills: SkillDefinition[],
    agents: AgentDefinition[] = [],
    generated?: RegistryBuildAssets,
  ): Promise<void> {
    const assets = generated ?? await this.readGeneratedAssets();
    const entries: RegistryEntry[] = [];
    const seenNames = new Set<string>();
    const seenPaths = new Set<string>();
    const generatedAgentNames = new Set(
      assets.agentFiles.map((agent) => agent.name),
    );

    for (const generatedSkill of assets.skillFiles) {
      const skill = skills.find((candidate) => candidate.name === generatedSkill.name);
      if (!skill) {
        throw new Error(`Generated skill is missing analysis metadata: ${generatedSkill.name}`);
      }
      const file = await this.validateAsset(generatedSkill.file, "skill");
      assertUniqueEntry(seenNames, seenPaths, "skill", skill.name, file);
      entries.push({
        type: "skill",
        name: skill.name,
        file,
        description: skill.description,
        category: skill.category,
        triggers: skill.triggers,
      });
    }

    for (const generatedAgent of assets.agentFiles) {
      const agent = agents.find((candidate) => candidate.name === generatedAgent.name);
      const file = await this.validateAsset(generatedAgent.file, "agent");
      assertUniqueEntry(seenNames, seenPaths, "agent", generatedAgent.name, file);
      const subAgents = agent?.subAgents?.filter((name) => generatedAgentNames.has(name));
      const parentAgent = agent?.parentAgent && generatedAgentNames.has(agent.parentAgent)
        ? agent.parentAgent
        : undefined;
      entries.push({
        type: "agent",
        name: generatedAgent.name,
        file,
        vsCodeAgent: file,
        description: agent?.description ?? "Generated repository agent",
        triggers: agent?.triggers ?? [],
        isSubAgent: generatedAgent.isSubAgent,
        parentAgent,
        subAgents: subAgents && subAgents.length > 0 ? subAgents : undefined,
      });
    }

    const content = entries.length > 0
      ? `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`
      : "";
    if (!this.dryRun) {
      await atomicWriteContainedFile(
        await this.getContainedRoot(),
        this.registryPath,
        content,
      );
    }
  }

  async search(
    query: string,
    options?: { type?: "skill" | "agent"; limit?: number },
  ): Promise<RegistryEntry[]> {
    let entries = await this.list();
    if (options?.type) {
      entries = entries.filter((entry) => entry.type === options.type);
    }
    const queryLower = query.toLowerCase();
    return entries
      .map((entry) => {
        let score = 0;
        if (entry.name.toLowerCase() === queryLower) score += 100;
        if (entry.name.toLowerCase().includes(queryLower)) score += 50;
        if (entry.description.toLowerCase().includes(queryLower)) score += 30;
        for (const trigger of entry.triggers) {
          if (trigger.toLowerCase().includes(queryLower)) score += 20;
          if (trigger.toLowerCase() === queryLower) score += 40;
        }
        if (entry.category?.toLowerCase().includes(queryLower)) score += 10;
        if (entry.type === "agent" && !entry.isSubAgent) score += 5;
        return { entry, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, options?.limit ?? 10)
      .map(({ entry }) => entry);
  }

  async list(): Promise<RegistryEntry[]> {
    try {
      return parseEntries(
        await readContainedFile(await this.getContainedRoot(), this.registryPath),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async get(name: string): Promise<RegistryEntry | null> {
    return (await this.list()).find((entry) => entry.name === name) ?? null;
  }

  async upsert(entries: RegistryEntry[]): Promise<void> {
    const existing = await this.list();
    const merged = new Map(
      existing.map((entry) => [`${entry.type}:${entry.name}`, entry]),
    );
    for (const entry of entries) {
      const validated = RegistryEntrySchema.parse(entry);
      validated.file = await this.validateAsset(validated.file, validated.type);
      if (validated.vsCodeAgent) {
        validated.vsCodeAgent = await this.validateAsset(
          validated.vsCodeAgent,
          "agent",
        );
      }
      merged.set(`${validated.type}:${validated.name}`, validated);
    }
    if (!this.dryRun) {
      const content = Array.from(merged.values())
        .map((entry) => JSON.stringify(entry))
        .join("\n");
      await atomicWriteContainedFile(
        await this.getContainedRoot(),
        this.registryPath,
        content ? `${content}\n` : "",
      );
    }
  }

  private getContainedRoot(): Promise<ContainedRoot> {
    this.containedRoot ??= createContainedRoot(this.rootPath);
    return this.containedRoot;
  }

  private async validateAsset(
    file: string,
    type: RegistryAssetType,
  ): Promise<string> {
    const canonical = canonicalizeRegistryAssetPath(file, type);
    if (!this.dryRun) {
      return assertRegistryAssetExists(await this.getContainedRoot(), canonical, type);
    }
    return canonical;
  }

  private async readGeneratedAssets(): Promise<RegistryBuildAssets> {
    if (this.dryRun) return { agentFiles: [], skillFiles: [] };
    const metadata = await readFreshness(await this.getContainedRoot());
    if (!metadata) return { agentFiles: [], skillFiles: [] };
    const skillFiles = metadata.generatedSkills
      ?? Object.keys(metadata.skills ?? {}).map((name) => ({
        name,
        file: `.github/skills/${name}/SKILL.md`,
      }));
    return {
      agentFiles: metadata.generatedAgents ?? [],
      skillFiles,
    };
  }
}
