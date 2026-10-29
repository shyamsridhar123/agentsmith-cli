import { describe, expect, it } from "vitest";
import { mapSourceDirsToRepository } from "../../src/analyzer/source-dirs.js";
import type { AgentDefinition, SkillDefinition } from "../../src/analyzer/types.js";

const repositoryFiles = ["config.ts", "src/lib/db.ts", "src\\app\\page.tsx"];

function skill(sourceDir: string): SkillDefinition {
  return {
    name: sourceDir,
    description: "",
    sourceDir,
    patterns: [],
    triggers: [],
    category: "patterns",
    examples: [],
  };
}

function agent(sourceDir?: string): AgentDefinition {
  return {
    name: "agent",
    description: "",
    skills: [],
    tools: [],
    isSubAgent: false,
    triggers: [],
    sourceDir,
  };
}

function mapSkills(...sourceDirs: string[]): string[] {
  return mapSourceDirsToRepository(sourceDirs.map(skill), [], repositoryFiles)
    .skills.map((mapped) => mapped.sourceDir);
}

describe("mapSourceDirsToRepository", () => {
  it("keeps folders that exist and normalizes their form", () => {
    expect(mapSkills("src/lib", "./src/app/", "src\\lib", "src")).toEqual([
      "src/lib",
      "src/app",
      "src/lib",
      "src",
    ]);
  });

  it("maps files to their folder", () => {
    expect(mapSkills("config.ts", "src/lib/db.ts")).toEqual(["", "src/lib"]);
  });

  it("maps missing folders to the nearest existing parent", () => {
    expect(mapSkills("src/lib/auth", "docs/guides", "../outside", "/etc")).toEqual([
      "src/lib",
      "",
      "",
      "",
    ]);
  });

  it("maps agent folders and drops ones that resolve to the root", () => {
    const { agents } = mapSourceDirsToRepository(
      [],
      [agent("src/lib/db.ts"), agent("config.ts"), agent()],
      repositoryFiles,
    );

    expect(agents.map((mapped) => mapped.sourceDir)).toEqual([
      "src/lib",
      undefined,
      undefined,
    ]);
  });
});
