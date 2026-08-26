/**
 * Registry - Skills & Agents Database
 * Builds and searches the JSONL index.
 */

import fs from "fs/promises";
import path from "path";
import type { SkillDefinition, AgentDefinition } from "../analyzer/index.js";
import { z } from "zod";

export interface RegistryEntry {
  type: "skill" | "agent";
  name: string;
  file: string;
  vsCodeAgent?: string; // VS Code .agent.md file path
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

function parseEntries(content: string): RegistryEntry[] {
  const entries: RegistryEntry[] = [];
  for (const line of content.trim().split("\n").filter(Boolean)) {
    try {
      const parsed = RegistryEntrySchema.safeParse(JSON.parse(line));
      if (parsed.success) entries.push(parsed.data);
    } catch {
      // Ignore malformed registry lines rather than trusting partial data.
    }
  }
  return entries;
}

export class Registry {
  private rootPath: string;
  private dryRun: boolean;
  private registryPath: string;

  constructor(rootPath: string, dryRun = false) {
    this.rootPath = rootPath;
    this.dryRun = dryRun;
    this.registryPath = path.join(rootPath, "skills-registry.jsonl");
  }

  async build(skills: SkillDefinition[], agents?: AgentDefinition[]): Promise<void> {
    const entries: RegistryEntry[] = [];
    
    // Add skill entries
    for (const skill of skills) {
      entries.push({
        type: "skill",
        name: skill.name,
        file: `.github/skills/${skill.name}/SKILL.md`,
        description: skill.description,
        category: skill.category,
        triggers: skill.triggers,
      });
    }

    // Add agent entries
    if (agents) {
      for (const agent of agents) {
        entries.push({
          type: "agent",
          name: agent.name,
          file: `.github/agents/${agent.name}.agent.md`,
          vsCodeAgent: `.github/agents/${agent.name}.agent.md`,
          description: agent.description,
          triggers: agent.triggers,
          isSubAgent: agent.isSubAgent,
          parentAgent: agent.parentAgent,
          subAgents: agent.subAgents,
        });
      }
    }

    const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";

    if (!this.dryRun) {
      await fs.writeFile(this.registryPath, content, "utf-8");
    }
  }

  async search(query: string, options?: { type?: "skill" | "agent"; limit?: number }): Promise<RegistryEntry[]> {
    const limit = options?.limit ?? 10;
    const typeFilter = options?.type;
    
    try {
      const content = await fs.readFile(this.registryPath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);

      let entries: RegistryEntry[] = parseEntries(lines.join("\n"));
      
      // Filter by type if specified
      if (typeFilter) {
        entries = entries.filter((e) => e.type === typeFilter);
      }
      
      const queryLower = query.toLowerCase();

      // Score each entry by relevance
      const scored = entries.map((entry) => {
        let score = 0;

        // Exact name match
        if (entry.name.toLowerCase() === queryLower) score += 100;

        // Name contains query
        if (entry.name.toLowerCase().includes(queryLower)) score += 50;

        // Description contains query
        if (entry.description.toLowerCase().includes(queryLower)) score += 30;

        // Triggers contain query
        for (const trigger of entry.triggers) {
          if (trigger.toLowerCase().includes(queryLower)) score += 20;
          if (trigger.toLowerCase() === queryLower) score += 40;
        }

        // Category matches (skills only)
        if (entry.category?.toLowerCase().includes(queryLower)) score += 10;

        // Boost root agents
        if (entry.type === "agent" && !entry.isSubAgent) score += 5;

        return { entry, score };
      });

      // Filter and sort by score
      return scored
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((s) => s.entry);
    } catch (error) {
      // Registry doesn't exist or is empty
      return [];
    }
  }

  async list(): Promise<RegistryEntry[]> {
    try {
      const content = await fs.readFile(this.registryPath, "utf-8");
      return parseEntries(content);
    } catch {
      return [];
    }
  }

  async get(name: string): Promise<RegistryEntry | null> {
    const entries = await this.list();
    return entries.find((e) => e.name === name) || null;
  }

  async upsert(entries: RegistryEntry[]): Promise<void> {
    const existing = await this.list();
    const merged = new Map(existing.map((entry) => [`${entry.type}:${entry.name}`, entry]));
    for (const entry of entries) {
      const validated = RegistryEntrySchema.parse(entry);
      merged.set(`${validated.type}:${validated.name}`, validated);
    }
    if (!this.dryRun) {
      const content = Array.from(merged.values()).map((entry) => JSON.stringify(entry)).join("\n");
      await fs.writeFile(this.registryPath, content ? `${content}\n` : "", "utf-8");
    }
  }
}
