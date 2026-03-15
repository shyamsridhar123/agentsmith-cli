/**
 * Tests for src/registry/index.ts
 * JSONL registry read/write/search.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

import fs from "fs/promises";
import { Registry } from "../src/registry/index.js";
import type { SkillDefinition, AgentDefinition } from "../src/analyzer/types.js";

const mockReadFile = vi.mocked(fs.readFile);
const mockWriteFile = vi.mocked(fs.writeFile);

beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    name: "test-skill",
    description: "A test skill",
    sourceDir: "src",
    patterns: [],
    triggers: ["test"],
    category: "patterns",
    examples: [],
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    name: "test-agent",
    description: "A test agent",
    skills: [],
    tools: [],
    isSubAgent: false,
    triggers: ["agent"],
    ...overrides,
  };
}

function jsonlContent(entries: Record<string, unknown>[]): string {
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

describe("Registry.build", () => {
  it("creates JSONL from skills and agents", async () => {
    mockWriteFile.mockResolvedValue(undefined);

    const registry = new Registry("/project");
    await registry.build([makeSkill()], [makeAgent()]);

    expect(mockWriteFile).toHaveBeenCalledOnce();
    const writtenContent = mockWriteFile.mock.calls[0][1] as string;
    const lines = writtenContent.trim().split("\n");
    expect(lines).toHaveLength(2);

    const skillEntry = JSON.parse(lines[0]);
    expect(skillEntry.type).toBe("skill");
    expect(skillEntry.name).toBe("test-skill");
    expect(skillEntry.file).toBe(".github/skills/test-skill/SKILL.md");

    const agentEntry = JSON.parse(lines[1]);
    expect(agentEntry.type).toBe("agent");
    expect(agentEntry.name).toBe("test-agent");
    expect(agentEntry.file).toBe(".github/agents/test-agent.agent.md");
  });

  it("builds skills-only when no agents provided", async () => {
    mockWriteFile.mockResolvedValue(undefined);

    const registry = new Registry("/project");
    await registry.build([makeSkill({ name: "only-skill" })]);

    const writtenContent = mockWriteFile.mock.calls[0][1] as string;
    const lines = writtenContent.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).name).toBe("only-skill");
  });

  it("does not write files in dry-run mode", async () => {
    const registry = new Registry("/project", true);
    await registry.build([makeSkill()]);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("includes agent hierarchy info", async () => {
    mockWriteFile.mockResolvedValue(undefined);

    const agent = makeAgent({
      name: "child",
      isSubAgent: true,
      parentAgent: "root",
      subAgents: ["grandchild"],
    });
    const registry = new Registry("/project");
    await registry.build([], [agent]);

    const writtenContent = mockWriteFile.mock.calls[0][1] as string;
    const entry = JSON.parse(writtenContent.trim());
    expect(entry.isSubAgent).toBe(true);
    expect(entry.parentAgent).toBe("root");
    expect(entry.subAgents).toEqual(["grandchild"]);
  });
});

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

describe("Registry.search", () => {
  const skillEntry = {
    type: "skill",
    name: "auth-patterns",
    file: ".github/skills/auth-patterns/SKILL.md",
    description: "Authentication patterns for the project",
    category: "security",
    triggers: ["auth", "login"],
  };

  const agentEntry = {
    type: "agent",
    name: "backend",
    file: ".github/agents/backend.agent.md",
    description: "Backend domain agent for API services",
    triggers: ["backend", "api"],
    isSubAgent: false,
  };

  const subAgentEntry = {
    type: "agent",
    name: "auth",
    file: ".github/agents/auth.agent.md",
    description: "Auth sub-agent",
    triggers: ["auth"],
    isSubAgent: true,
    parentAgent: "backend",
  };

  function setupEntries(entries: Record<string, unknown>[]) {
    mockReadFile.mockResolvedValue(jsonlContent(entries) as any);
  }

  it("returns exact name match with highest score", async () => {
    setupEntries([skillEntry, agentEntry]);
    const registry = new Registry("/project");
    const results = await registry.search("auth-patterns");
    expect(results[0].name).toBe("auth-patterns");
  });

  it("matches on description content", async () => {
    setupEntries([skillEntry, agentEntry]);
    const registry = new Registry("/project");
    const results = await registry.search("API services");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe("backend");
  });

  it("matches on trigger keywords", async () => {
    setupEntries([skillEntry, agentEntry]);
    const registry = new Registry("/project");
    const results = await registry.search("login");
    expect(results[0].name).toBe("auth-patterns");
  });

  it("filters by type when specified", async () => {
    setupEntries([skillEntry, agentEntry]);
    const registry = new Registry("/project");
    const results = await registry.search("auth", { type: "skill" });
    expect(results.every((r) => r.type === "skill")).toBe(true);
  });

  it("respects limit option", async () => {
    setupEntries([skillEntry, agentEntry, subAgentEntry]);
    const registry = new Registry("/project");
    const results = await registry.search("auth", { limit: 1 });
    expect(results).toHaveLength(1);
  });

  it("returns empty array when no matches", async () => {
    setupEntries([skillEntry]);
    const registry = new Registry("/project");
    const results = await registry.search("nonexistent-xyz");
    expect(results).toEqual([]);
  });

  it("returns empty array when registry file is missing", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    const registry = new Registry("/project");
    const results = await registry.search("anything");
    expect(results).toEqual([]);
  });

  it("boosts root agents over sub-agents", async () => {
    setupEntries([subAgentEntry, agentEntry]);
    const registry = new Registry("/project");
    const results = await registry.search("backend");
    expect(results[0].name).toBe("backend");
    expect(results[0].isSubAgent).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe("Registry.list", () => {
  it("parses JSONL and returns all entries", async () => {
    const entries = [
      { type: "skill", name: "a", file: "f", description: "d", triggers: [] },
      { type: "agent", name: "b", file: "f", description: "d", triggers: [] },
    ];
    mockReadFile.mockResolvedValue(jsonlContent(entries) as any);

    const registry = new Registry("/project");
    const result = await registry.list();
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("a");
    expect(result[1].name).toBe("b");
  });

  it("returns empty array when registry file is missing", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    const registry = new Registry("/project");
    expect(await registry.list()).toEqual([]);
  });

  it("handles empty file gracefully", async () => {
    mockReadFile.mockResolvedValue("\n" as any);
    const registry = new Registry("/project");
    expect(await registry.list()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

describe("Registry.get", () => {
  it("finds entry by name", async () => {
    const entries = [
      { type: "skill", name: "target", file: "f", description: "d", triggers: [] },
      { type: "skill", name: "other", file: "f", description: "d", triggers: [] },
    ];
    mockReadFile.mockResolvedValue(jsonlContent(entries) as any);

    const registry = new Registry("/project");
    const result = await registry.get("target");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("target");
  });

  it("returns null for non-existent name", async () => {
    const entries = [
      { type: "skill", name: "exists", file: "f", description: "d", triggers: [] },
    ];
    mockReadFile.mockResolvedValue(jsonlContent(entries) as any);

    const registry = new Registry("/project");
    expect(await registry.get("missing")).toBeNull();
  });

  it("returns null when registry is empty", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    const registry = new Registry("/project");
    expect(await registry.get("anything")).toBeNull();
  });
});
