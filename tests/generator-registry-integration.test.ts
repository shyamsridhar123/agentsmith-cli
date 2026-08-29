import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Generator } from "../src/generator/index.js";
import { Registry, type RegistryEntry } from "../src/registry/index.js";
import {
  AGENTSMITH_MANAGED_MARKER,
  digestManagedContent,
  hasManagedAssetMarker,
} from "../src/generator/managed-assets.js";
import type {
  AgentDefinition,
  AnalysisResult,
  HookDefinition,
  SkillDefinition,
} from "../src/analyzer/types.js";

let rootPath: string;

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    name: "root",
    description: "Repository agent",
    skills: [],
    tools: [],
    isSubAgent: false,
    triggers: [],
    ...overrides,
  };
}

function makeSkill(name = "repository-patterns"): SkillDefinition {
  return {
    name,
    description: "Repository patterns",
    sourceDir: "src",
    patterns: [],
    triggers: [],
    category: "patterns",
    examples: [],
  };
}

function makeHook(name = "quality"): HookDefinition {
  return {
    name,
    event: "post-generate",
    description: "Quality checks",
    commands: ["npm test"],
  };
}

function makeAnalysis(
  agents: AgentDefinition[],
  overrides: Partial<AnalysisResult> = {},
): AnalysisResult {
  return {
    repoName: "My Repository",
    skills: [],
    agents,
    tools: [],
    hooks: [],
    summary: "Repository",
    ...overrides,
  };
}

async function readRegistry(): Promise<RegistryEntry[]> {
  const content = await fs.readFile(
    path.join(rootPath, "skills-registry.jsonl"),
    "utf-8",
  );
  return content.trim().split("\n").map((line) => JSON.parse(line));
}

async function readGeneratedAgents(): Promise<unknown[]> {
  const content = await fs.readFile(
    path.join(rootPath, ".github", "copilot", "freshness.json"),
    "utf-8",
  );
  return JSON.parse(content).generatedAgents;
}

describe("Generator and Registry agent path integration", () => {
  beforeEach(async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentsmith-registry-integration-"));
  });

  afterEach(async () => {
    await fs.rm(rootPath, { recursive: true, force: true });
  });

  it("indexes the exact root and sub-agent files generated for a constellation", async () => {
    const agents = [
      makeAgent(),
      makeAgent({
        name: "API Agent",
        description: "API specialist",
        isSubAgent: true,
        parentAgent: "root",
      }),
    ];

    const generated = await new Generator(rootPath).generate(makeAnalysis(agents));
    await new Registry(rootPath).build([], agents, generated);

    const entries = await readRegistry();
    expect(entries.map((entry) => entry.file)).toEqual([
      ".github/agents/my-repository-root.agent.md",
      ".github/agents/api-agent.agent.md",
    ]);
    expect(await readGeneratedAgents()).toEqual([
      {
        name: "root",
        file: ".github/agents/my-repository-root.agent.md",
        isSubAgent: false,
      },
      {
        name: "API Agent",
        file: ".github/agents/api-agent.agent.md",
        isSubAgent: true,
      },
    ]);
    for (const entry of entries) {
      await expect(fs.stat(path.join(rootPath, entry.file))).resolves.toEqual(
        expect.objectContaining({}),
      );
    }
  });

  it("indexes only the combined file generated in explicit single-agent mode", async () => {
    const agents = [
      makeAgent(),
      makeAgent({
        name: "child",
        description: "Child specialist",
        isSubAgent: true,
        parentAgent: "root",
      }),
    ];

    const generated = await new Generator(rootPath, false, false, false, true).generate(
      makeAnalysis(agents),
    );
    await new Registry(rootPath).build([], agents, generated);

    const entries = await readRegistry();
    expect(entries).toHaveLength(1);
    expect(entries[0].file).toBe(".github/agents/my-repository.agent.md");
    expect(await readGeneratedAgents()).toEqual([
      {
        name: "root",
        file: ".github/agents/my-repository.agent.md",
        isSubAgent: false,
      },
    ]);
    await expect(
      fs.stat(path.join(rootPath, entries[0].file)),
    ).resolves.toEqual(expect.objectContaining({}));
    await expect(
      fs.stat(path.join(rootPath, ".github/agents/child.agent.md")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(entries[0].subAgents).toBeUndefined();
  });

  it("indexes the generated fallback agent when analysis returns no agents", async () => {
    const analysis = makeAnalysis([]);
    const generated = await new Generator(rootPath).generate(analysis);
    await new Registry(rootPath).build([], [], generated);

    const entries = await readRegistry();
    expect(entries).toEqual([
      expect.objectContaining({
        type: "agent",
        name: "My Repository",
        file: ".github/agents/my-repository.agent.md",
        isSubAgent: false,
      }),
    ]);
    await expect(
      fs.stat(path.join(rootPath, ".github/agents/my-repository.agent.md")),
    ).resolves.toEqual(expect.objectContaining({}));
  });

  it("removes only stale agents and handoffs listed by prior freshness metadata", async () => {
    const agents = [
      makeAgent({ subAgents: ["API Agent"] }),
      makeAgent({
        name: "API Agent",
        description: "API specialist",
        isSubAgent: true,
        parentAgent: "root",
      }),
    ];
    await new Generator(rootPath).generate(makeAnalysis(agents));
    const userAgent = path.join(rootPath, ".github", "agents", "user-managed.agent.md");
    await fs.writeFile(userAgent, "user content\n", "utf-8");

    const generated = await new Generator(rootPath, false, false, false, true)
      .generate(makeAnalysis(agents));
    await new Registry(rootPath).build([], agents, generated);

    await expect(
      fs.stat(path.join(rootPath, ".github/agents/my-repository-root.agent.md")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fs.stat(path.join(rootPath, ".github/agents/api-agent.agent.md")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fs.stat(path.join(rootPath, ".github/copilot/handoffs.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(userAgent, "utf-8")).toBe("user content\n");
    const entries = await readRegistry();
    expect(entries).toEqual([
      expect.objectContaining({
        name: "root",
        file: ".github/agents/my-repository.agent.md",
      }),
    ]);
    expect(entries[0].subAgents).toBeUndefined();
  }, 30_000);

  it("reconciles removed AgentSmith-managed skills and hooks", async () => {
    const agents = [
      makeAgent(),
      makeAgent({
        name: "API Agent",
        isSubAgent: true,
        parentAgent: "root",
      }),
    ];
    await new Generator(rootPath).generate(makeAnalysis(agents, {
      skills: [makeSkill()],
      hooks: [makeHook()],
    }));

    await new Generator(rootPath).generate(makeAnalysis([makeAgent()]));

    await expect(
      fs.stat(path.join(rootPath, ".github/skills/repository-patterns/SKILL.md")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fs.stat(path.join(rootPath, ".github/hooks/quality.yaml")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fs.stat(path.join(rootPath, ".github/copilot/handoffs.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("records ownership markers and matching digests for every managed asset", async () => {
    const agents = [
      makeAgent(),
      makeAgent({
        name: "API Agent",
        isSubAgent: true,
        parentAgent: "root",
      }),
    ];
    await new Generator(rootPath).generate(makeAnalysis(agents, {
      skills: [makeSkill()],
      hooks: [makeHook()],
    }));
    const freshness = JSON.parse(
      await fs.readFile(
        path.join(rootPath, ".github/copilot/freshness.json"),
        "utf-8",
      ),
    );
    expect(freshness.ownership).toEqual({
      marker: AGENTSMITH_MANAGED_MARKER,
    });
    const files = [
      ...freshness.generatedAgents.map((asset: { file: string }) => asset.file),
      ...freshness.generatedSkills.map((asset: { file: string }) => asset.file),
      ...freshness.generatedHooks,
      freshness.generatedHandoffFile,
    ];
    for (const file of files) {
      const content = await fs.readFile(path.join(rootPath, file), "utf-8");
      expect(hasManagedAssetMarker(file, content)).toBe(true);
      expect(freshness.generatedDigests[file]).toBe(digestManagedContent(content));
    }
  });

  it("preserves a user-owned file designated by tampered freshness metadata", async () => {
    const userPath = path.join(rootPath, ".github/agents/user-owned.agent.md");
    const userContent = "user-owned content\n";
    await new Generator(rootPath).generate(makeAnalysis([makeAgent()]));
    await fs.writeFile(userPath, userContent, "utf-8");
    const freshnessPath = path.join(rootPath, ".github/copilot/freshness.json");
    const freshness = JSON.parse(await fs.readFile(freshnessPath, "utf-8"));
    freshness.generatedAgents.push({
      name: "user-owned",
      file: ".github/agents/user-owned.agent.md",
      isSubAgent: true,
    });
    freshness.generatedDigests[".github/agents/user-owned.agent.md"] =
      digestManagedContent(userContent);
    await fs.writeFile(freshnessPath, `${JSON.stringify(freshness, null, 2)}\n`, "utf-8");

    await new Generator(rootPath).generate(makeAnalysis([makeAgent()]));

    expect(await fs.readFile(userPath, "utf-8")).toBe(userContent);
  });

  it("preserves modified managed files whose digest no longer matches freshness", async () => {
    const hookPath = path.join(rootPath, ".github/hooks/quality.yaml");
    await new Generator(rootPath).generate(makeAnalysis([makeAgent()], {
      hooks: [makeHook()],
    }));
    await fs.writeFile(hookPath, "# user replaced this hook\n", "utf-8");

    await new Generator(rootPath).generate(makeAnalysis([makeAgent()]));

    expect(await fs.readFile(hookPath, "utf-8")).toBe("# user replaced this hook\n");
  });

  it("ignores freshness metadata without the AgentSmith ownership marker", async () => {
    const stalePath = path.join(rootPath, ".github/agents/api-agent.agent.md");
    const agents = [
      makeAgent(),
      makeAgent({
        name: "API Agent",
        isSubAgent: true,
        parentAgent: "root",
      }),
    ];
    await new Generator(rootPath).generate(makeAnalysis(agents));
    const freshnessPath = path.join(rootPath, ".github/copilot/freshness.json");
    const freshness = JSON.parse(await fs.readFile(freshnessPath, "utf-8"));
    delete freshness.ownership;
    await fs.writeFile(freshnessPath, `${JSON.stringify(freshness, null, 2)}\n`, "utf-8");

    await new Generator(rootPath, false, false, false, true)
      .generate(makeAnalysis([makeAgent()]));

    await expect(fs.stat(stalePath)).resolves.toEqual(expect.objectContaining({}));
  });
});
