/**
 * Tests for src/generator/index.ts
 * SKILL.md, agent.md, and hook YAML generation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs/promises", () => ({
  default: {
    mkdir: vi.fn(),
    writeFile: vi.fn(),
  },
}));

import fs from "fs/promises";
import { Generator } from "../src/generator/index.js";
import type { AnalysisResult, SkillDefinition, AgentDefinition, HookDefinition } from "../src/analyzer/types.js";

const mockMkdir = vi.mocked(fs.mkdir);
const mockWriteFile = vi.mocked(fs.writeFile);

beforeEach(() => {
  vi.resetAllMocks();
  mockMkdir.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAnalysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    repoName: "test-repo",
    skills: [],
    agents: [],
    tools: [],
    hooks: [],
    summary: "A test repository",
    ...overrides,
  };
}

function makeSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    name: "test-skill",
    description: "A test skill",
    sourceDir: "src",
    patterns: ["Pattern one"],
    triggers: ["test"],
    category: "patterns",
    examples: ["const x = 1;"],
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    name: "test-agent",
    description: "A test agent",
    skills: ["test-skill"],
    tools: [{ name: "build", command: "npm run build", description: "Build" }],
    isSubAgent: false,
    triggers: ["test"],
    ...overrides,
  };
}

function makeHook(overrides: Partial<HookDefinition> = {}): HookDefinition {
  return {
    name: "pre-commit-quality",
    event: "pre-commit",
    description: "Run quality checks",
    commands: ["npm run lint", "npm run build"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SKILL.md generation
// ---------------------------------------------------------------------------

describe("Generator — SKILL.md generation", () => {
  it("generates a SKILL.md file with frontmatter", async () => {
    const skill = makeSkill();
    const analysis = makeAnalysis({ skills: [skill] });

    const gen = new Generator("/project");
    const result = await gen.generate(analysis);

    expect(result.files).toContain(".github/skills/test-skill/SKILL.md");

    // Verify writeFile was called with correct content
    const writeCall = mockWriteFile.mock.calls.find(
      (c) => (c[0] as string).includes("test-skill"),
    );
    expect(writeCall).toBeDefined();
    const content = writeCall![1] as string;

    // Check frontmatter
    expect(content).toContain("---");
    expect(content).toContain("name: test-skill");
    expect(content).toContain("description: A test skill");

    // Check content structure
    expect(content).toContain("# Test Skill");
    expect(content).toContain("## When to Use");
    expect(content).toContain("## Patterns");
    expect(content).toContain("Pattern one");
    expect(content).toContain("## Examples");
    expect(content).toContain("const x = 1;");
    expect(content).toContain("## Category");
  });

  it("generates default patterns text when no patterns provided", async () => {
    const skill = makeSkill({ patterns: [] });
    const analysis = makeAnalysis({ skills: [skill] });

    const gen = new Generator("/project");
    await gen.generate(analysis);

    const writeCall = mockWriteFile.mock.calls.find(
      (c) => (c[0] as string).includes("test-skill"),
    );
    const content = writeCall![1] as string;
    expect(content).toContain("Patterns extracted from codebase analysis");
  });

  it("generates default examples text when no examples provided", async () => {
    const skill = makeSkill({ examples: [] });
    const analysis = makeAnalysis({ skills: [skill] });

    const gen = new Generator("/project");
    await gen.generate(analysis);

    const writeCall = mockWriteFile.mock.calls.find(
      (c) => (c[0] as string).includes("test-skill"),
    );
    const content = writeCall![1] as string;
    expect(content).toContain("See source files in the repository for examples.");
  });
});

// ---------------------------------------------------------------------------
// agent.md generation
// ---------------------------------------------------------------------------

describe("Generator — agent.md generation", () => {
  it("generates a main agent.md file", async () => {
    const analysis = makeAnalysis({
      agents: [makeAgent()],
      skills: [makeSkill()],
    });

    const gen = new Generator("/project");
    const result = await gen.generate(analysis);

    expect(result.files).toContain(".github/agents/test-repo.agent.md");

    const writeCall = mockWriteFile.mock.calls.find(
      (c) => (c[0] as string).includes("test-repo.agent.md"),
    );
    expect(writeCall).toBeDefined();
    const content = writeCall![1] as string;

    // Check frontmatter
    expect(content).toContain("---");
    expect(content).toContain("name: Test Repo");
    expect(content).toContain("tools:");

    // Check content sections
    expect(content).toContain("# Test Repo Agent");
    expect(content).toContain("## Skills");
    expect(content).toContain("## Commands");
    expect(content).toContain("## Instructions");
  });

  it("includes VS Code built-in tools in the tools list", async () => {
    const analysis = makeAnalysis({ agents: [makeAgent()] });

    const gen = new Generator("/project");
    await gen.generate(analysis);

    const writeCall = mockWriteFile.mock.calls.find(
      (c) => (c[0] as string).includes(".agent.md"),
    );
    const content = writeCall![1] as string;
    expect(content).toContain("codebase");
    expect(content).toContain("editFiles");
    expect(content).toContain("runInTerminal");
  });

  it("links to all skills in the skills section", async () => {
    const skills = [
      makeSkill({ name: "auth-patterns", description: "Auth patterns" }),
      makeSkill({ name: "api-conventions", description: "API conventions" }),
    ];
    const analysis = makeAnalysis({ skills });

    const gen = new Generator("/project");
    await gen.generate(analysis);

    const writeCall = mockWriteFile.mock.calls.find(
      (c) => (c[0] as string).includes(".agent.md"),
    );
    const content = writeCall![1] as string;
    expect(content).toContain("Auth Patterns");
    expect(content).toContain("../skills/auth-patterns/SKILL.md");
    expect(content).toContain("Api Conventions");
  });

  it("lists detected commands from agent tools", async () => {
    const agents = [
      makeAgent({
        tools: [
          { name: "build", command: "npm run build", description: "Build" },
          { name: "test", command: "npm test", description: "Test" },
        ],
      }),
    ];
    const analysis = makeAnalysis({ agents });

    const gen = new Generator("/project");
    await gen.generate(analysis);

    const writeCall = mockWriteFile.mock.calls.find(
      (c) => (c[0] as string).includes(".agent.md"),
    );
    const content = writeCall![1] as string;
    expect(content).toContain("`npm run build`");
    expect(content).toContain("`npm test`");
  });

  it("sanitizes repo name for agent filename", async () => {
    const analysis = makeAnalysis({ repoName: "My Cool Project!" });

    const gen = new Generator("/project");
    const result = await gen.generate(analysis);

    expect(result.files.some((f) => f.includes("my-cool-project-.agent.md"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Hook YAML generation
// ---------------------------------------------------------------------------

describe("Generator — hook YAML generation", () => {
  it("generates hook YAML with commands", async () => {
    const hook = makeHook();
    const analysis = makeAnalysis({ hooks: [hook] });

    const gen = new Generator("/project");
    const result = await gen.generate(analysis);

    expect(result.files).toContain(".github/hooks/pre-commit-quality.yaml");

    const writeCall = mockWriteFile.mock.calls.find(
      (c) => (c[0] as string).includes("pre-commit-quality.yaml"),
    );
    const content = writeCall![1] as string;
    expect(content).toContain("name: pre-commit-quality");
    expect(content).toContain("event: pre-commit");
    expect(content).toContain('"npm run lint"');
    expect(content).toContain('"npm run build"');
  });

  it("includes condition when provided", async () => {
    const hook = makeHook({ condition: "branch != main" });
    const analysis = makeAnalysis({ hooks: [hook] });

    const gen = new Generator("/project");
    await gen.generate(analysis);

    const writeCall = mockWriteFile.mock.calls.find(
      (c) => (c[0] as string).includes("pre-commit-quality.yaml"),
    );
    const content = writeCall![1] as string;
    expect(content).toContain("condition:");
    expect(content).toContain("branch != main");
  });
});

// ---------------------------------------------------------------------------
// Dry-run mode
// ---------------------------------------------------------------------------

describe("Generator — dry-run mode", () => {
  it("does not write any files in dry-run mode", async () => {
    const analysis = makeAnalysis({
      skills: [makeSkill()],
      hooks: [makeHook()],
      agents: [makeAgent()],
    });

    const gen = new Generator("/project", true);
    const result = await gen.generate(analysis);

    expect(mockMkdir).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
    // But still returns the file paths
    expect(result.files.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// quoteYamlValue (tested indirectly through generation)
// ---------------------------------------------------------------------------

describe("Generator — YAML escaping", () => {
  it("quotes description with special YAML characters", async () => {
    const skill = makeSkill({
      description: "Handles auth: login & signup #flows",
    });
    const analysis = makeAnalysis({ skills: [skill] });

    const gen = new Generator("/project");
    await gen.generate(analysis);

    const writeCall = mockWriteFile.mock.calls.find(
      (c) => (c[0] as string).includes("test-skill"),
    );
    const content = writeCall![1] as string;
    // Should be quoted
    expect(content).toMatch(/description: ".*auth.*login.*signup.*flows.*"/);
  });

  it("does not quote clean values", async () => {
    const skill = makeSkill({ name: "simple-name", description: "Clean description" });
    const analysis = makeAnalysis({ skills: [skill] });

    const gen = new Generator("/project");
    await gen.generate(analysis);

    const writeCall = mockWriteFile.mock.calls.find(
      (c) => (c[0] as string).includes("simple-name"),
    );
    const content = writeCall![1] as string;
    expect(content).toContain("name: simple-name");
    expect(content).toContain("description: Clean description");
  });
});

// ---------------------------------------------------------------------------
// toTitleCase (tested indirectly through generation)
// ---------------------------------------------------------------------------

describe("Generator — toTitleCase", () => {
  it("converts kebab-case to Title Case in skill heading", async () => {
    const skill = makeSkill({ name: "auth-login-flow" });
    const analysis = makeAnalysis({ skills: [skill] });

    const gen = new Generator("/project");
    await gen.generate(analysis);

    const writeCall = mockWriteFile.mock.calls.find(
      (c) => (c[0] as string).includes("auth-login-flow"),
    );
    const content = writeCall![1] as string;
    expect(content).toContain("# Auth Login Flow");
  });

  it("handles single-word names", async () => {
    const skill = makeSkill({ name: "patterns" });
    const analysis = makeAnalysis({ skills: [skill] });

    const gen = new Generator("/project");
    await gen.generate(analysis);

    const writeCall = mockWriteFile.mock.calls.find(
      (c) => (c[0] as string).includes("patterns"),
    );
    const content = writeCall![1] as string;
    expect(content).toContain("# Patterns");
  });
});
