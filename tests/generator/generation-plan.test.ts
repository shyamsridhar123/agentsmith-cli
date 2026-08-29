import { describe, expect, it } from "vitest";
import { Generator } from "../../src/generator/index.js";
import type {
  AgentDefinition,
  AnalysisResult,
  HookDefinition,
  SkillDefinition,
} from "../../src/analyzer/types.js";

function skill(name = "test-skill"): SkillDefinition {
  return {
    name,
    description: "Skill",
    sourceDir: "src",
    patterns: [],
    triggers: [],
    category: "patterns",
    examples: [],
  };
}

function agent(name = "root", isSubAgent = false): AgentDefinition {
  return {
    name,
    description: "Agent",
    skills: [],
    tools: [],
    isSubAgent,
    triggers: [],
  };
}

function hook(name = "quality"): HookDefinition {
  return {
    name,
    event: "post-generate",
    description: "Hook",
    commands: ["npm test"],
  };
}

function analysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    repoName: "test-repo",
    skills: [],
    agents: [],
    tools: [],
    hooks: [],
    summary: "Repository",
    ...overrides,
  };
}

describe("Generator generation planning", () => {
  it("returns exactly the generated file manifests", async () => {
    const result = await new Generator("/project", true).generate(analysis({
      skills: [skill()],
      agents: [agent()],
      hooks: [hook()],
    }));

    expect(Object.keys(result).sort()).toEqual([
      "agentFiles",
      "files",
      "hookFiles",
      "skillFiles",
    ]);
    expect(result.skillFiles).toEqual([{
      name: "test-skill",
      file: ".github/skills/test-skill/SKILL.md",
    }]);
    expect(result.agentFiles).toEqual([{
      name: "root",
      file: ".github/agents/test-repo.agent.md",
      isSubAgent: false,
    }]);
    expect(result.hookFiles).toEqual([".github/hooks/quality.yaml"]);
  });

  it("rejects case-insensitive skill and hook collisions", async () => {
    await expect(new Generator("/project", true).generate(analysis({
      skills: [skill("API"), skill("api")],
    }))).rejects.toThrow("Skill filename collision");
    await expect(new Generator("/project", true).generate(analysis({
      hooks: [hook("Quality"), hook("quality")],
    }))).rejects.toThrow("Hook filename collision");
  });

  it("rejects root and sub-agent sanitization collisions", async () => {
    await expect(new Generator("/project", true).generate(analysis({
      repoName: "repo",
      agents: [
        agent("root"),
        { ...agent("repo root", true), parentAgent: "root" },
      ],
    }))).rejects.toThrow("Agent filename collision");
  });

  it("rejects multiple root agents before any output is planned", async () => {
    await expect(new Generator("/project", true).generate(analysis({
      agents: [agent("one"), agent("two")],
    }))).rejects.toThrow("multiple root agents");
  });

  it("synthesizes exactly one root orchestrator when analysis returns only sub-agents", async () => {
    const result = await new Generator("/project", true).generate(analysis({
      agents: [
        { ...agent("API", true), parentAgent: "test-repo" },
        { ...agent("CLI", true), parentAgent: "test-repo" },
      ],
    }));

    expect(result.agentFiles.filter((candidate) => !candidate.isSubAgent)).toEqual([{
      name: "test-repo",
      file: ".github/agents/test-repo-root.agent.md",
      isSubAgent: false,
    }]);
    expect(result.agentFiles.filter((candidate) => candidate.isSubAgent)).toHaveLength(2);
  });

  it.each([
    ["CON", "Unsafe agent filename"],
    ["agent. ", "trailing dot or space"],
  ])("rejects non-portable agent name %s", async (name, message) => {
    await expect(new Generator("/project", true).generate(analysis({
      repoName: name,
      agents: [agent(name)],
    }))).rejects.toThrow(message);
  });
});
