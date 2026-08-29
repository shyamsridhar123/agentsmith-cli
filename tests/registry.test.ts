/**
 * Tests for src/registry/index.ts
 * JSONL registry read/write/search.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const pathSafetyMocks = vi.hoisted(() => ({
  atomicWriteContainedFile: vi.fn(),
  createContainedRoot: vi.fn(),
  readContainedFile: vi.fn(),
  resolveContainedExistingFile: vi.fn(),
}));
const freshnessMocks = vi.hoisted(() => ({
  readFreshness: vi.fn(),
}));

vi.mock("fs/promises", () => ({
  default: {
    lstat: vi.fn(),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    realpath: vi.fn(),
    stat: vi.fn(),
    writeFile: vi.fn(),
  },
}));

vi.mock("../src/generator/path-safety.js", () => pathSafetyMocks);
vi.mock("../src/generator/freshness.js", () => freshnessMocks);

import fs from "fs/promises";
import { Registry } from "../src/registry/index.js";
import type { SkillDefinition, AgentDefinition } from "../src/analyzer/types.js";

const mockReadFile = vi.mocked(fs.readFile);
const mockLstat = vi.mocked(fs.lstat);
const mockMkdir = vi.mocked(fs.mkdir);
const mockRealpath = vi.mocked(fs.realpath);
const mockStat = vi.mocked(fs.stat);
const mockWriteFile = vi.mocked(fs.writeFile);

beforeEach(() => {
  vi.resetAllMocks();
  mockLstat.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
  mockMkdir.mockResolvedValue(undefined);
  mockReadFile.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
  mockRealpath.mockImplementation(async (target) => target as string);
  mockStat.mockResolvedValue({ isDirectory: () => true, isFile: () => true } as any);
  mockWriteFile.mockResolvedValue(undefined);
  pathSafetyMocks.createContainedRoot.mockImplementation(async (target: string) => ({
    requestedRoot: target,
    realRoot: target,
  }));
  pathSafetyMocks.readContainedFile.mockImplementation(async (_root, target: string) =>
    mockReadFile(target, "utf-8") as Promise<string>
  );
  pathSafetyMocks.resolveContainedExistingFile.mockImplementation(
    async (_root, target: string) => target,
  );
  pathSafetyMocks.atomicWriteContainedFile.mockImplementation(
    async (_root, target: string, content: string) => {
      await fs.writeFile(target, content, "utf-8");
      return target;
    },
  );
  freshnessMocks.readFreshness.mockResolvedValue(undefined);
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
    await registry.build([makeSkill()], [makeAgent()], {
      skillFiles: [{ name: "test-skill", file: ".github/skills/test-skill/SKILL.md" }],
      agentFiles: [{
        name: "test-agent",
        file: ".github/agents/test-agent.agent.md",
        isSubAgent: false,
      }],
    });

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
    await registry.build([makeSkill({ name: "only-skill" })], [], {
      skillFiles: [{ name: "only-skill", file: ".github/skills/only-skill/SKILL.md" }],
      agentFiles: [],
    });

    const writtenContent = mockWriteFile.mock.calls[0][1] as string;
    const lines = writtenContent.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).name).toBe("only-skill");
  });

  it("does not infer entries from analysis when no generated assets exist", async () => {
    const registry = new Registry("/project");
    await registry.build([makeSkill()], [makeAgent()]);

    expect(mockWriteFile).toHaveBeenCalledOnce();
    expect(mockWriteFile.mock.calls[0][1]).toBe("");
  });

  it("does not write files in dry-run mode", async () => {
    const registry = new Registry("/project", true);
    await registry.build([makeSkill()], [], {
      skillFiles: [{ name: "test-skill", file: ".github/skills/test-skill/SKILL.md" }],
      agentFiles: [],
    });
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
    const root = makeAgent({ name: "root" });
    const grandchild = makeAgent({
      name: "grandchild",
      isSubAgent: true,
      parentAgent: "child",
    });
    const registry = new Registry("/project");
    await registry.build([], [root, agent, grandchild], {
      skillFiles: [],
      agentFiles: [
        { name: "root", file: ".github/agents/root.agent.md", isSubAgent: false },
        { name: "child", file: ".github/agents/child.agent.md", isSubAgent: true },
        {
          name: "grandchild",
          file: ".github/agents/grandchild.agent.md",
          isSubAgent: true,
        },
      ],
    });

    const writtenContent = mockWriteFile.mock.calls[0][1] as string;
    const entry = writtenContent.trim().split("\n")
      .map((line) => JSON.parse(line))
      .find((candidate) => candidate.name === "child");
    expect(entry.isSubAgent).toBe(true);
    expect(entry.parentAgent).toBe("root");
    expect(entry.subAgents).toEqual(["grandchild"]);
  });

  it("uses exact constellation agent filenames from freshness metadata", async () => {
    freshnessMocks.readFreshness.mockResolvedValue({
      generatedAgents: [
        {
          name: "root",
          file: ".github/agents/my-repo-root.agent.md",
          isSubAgent: false,
        },
        {
          name: "API Agent",
          file: ".github/agents/api-agent.agent.md",
          isSubAgent: true,
        },
      ],
    });

    const registry = new Registry("/project");
    await registry.build([], [
      makeAgent({ name: "root" }),
      makeAgent({ name: "API Agent", isSubAgent: true, parentAgent: "root" }),
    ]);

    const entries = (mockWriteFile.mock.calls[0][1] as string)
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(entries.map((entry) => entry.file)).toEqual([
      ".github/agents/my-repo-root.agent.md",
      ".github/agents/api-agent.agent.md",
    ]);
  });

  it("indexes only the generated combined agent in single-agent mode", async () => {
    freshnessMocks.readFreshness.mockResolvedValue({
      generatedAgents: [
        {
          name: "root",
          file: ".github/agents/my-repo.agent.md",
          isSubAgent: false,
        },
      ],
    });

    const registry = new Registry("/project");
    await registry.build([], [
      makeAgent({ name: "root" }),
      makeAgent({ name: "child", isSubAgent: true, parentAgent: "root" }),
    ]);

    const entries = (mockWriteFile.mock.calls[0][1] as string)
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(entries).toHaveLength(1);
    expect(entries[0].file).toBe(".github/agents/my-repo.agent.md");
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
    mockReadFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
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
    mockReadFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
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
    mockReadFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    const registry = new Registry("/project");
    expect(await registry.get("anything")).toBeNull();
  });
});
