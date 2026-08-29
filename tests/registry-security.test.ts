import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Registry } from "../src/registry/index.js";
import type { AgentDefinition, SkillDefinition } from "../src/analyzer/types.js";

let sandbox: string;
let rootPath: string;
let outsideFile: string;

function makeSkill(): SkillDefinition {
  return {
    name: "safe-skill",
    description: "A safe skill",
    sourceDir: "src",
    patterns: [],
    triggers: [],
    category: "patterns",
    examples: [],
  };
}

function makeAgent(name: string): AgentDefinition {
  return {
    name,
    description: `${name} agent`,
    skills: [],
    tools: [],
    isSubAgent: false,
    triggers: [],
  };
}

describe("Registry path containment", () => {
  beforeEach(async () => {
    sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "agentsmith-registry-path-"));
    rootPath = path.join(sandbox, "root");
    outsideFile = path.join(sandbox, "outside.jsonl");
    await fs.mkdir(rootPath);
    await fs.writeFile(outsideFile, "sentinel\n", "utf-8");
  });

  afterEach(async () => {
    await fs.rm(sandbox, { recursive: true, force: true });
  });

  it("rejects a registry file symlink that resolves outside the output root", async () => {
    await fs.symlink(outsideFile, path.join(rootPath, "skills-registry.jsonl"), "file");

    await expect(new Registry(rootPath).build([makeSkill()])).rejects.toThrow(
      "symbolic link or reparse point",
    );
    expect(await fs.readFile(outsideFile, "utf-8")).toBe("sentinel\n");
  });

  it("rejects a registry file symlink even when it resolves inside the root", async () => {
    const inside = path.join(rootPath, "inside.jsonl");
    await fs.writeFile(inside, "sentinel\n", "utf-8");
    await fs.symlink(inside, path.join(rootPath, "skills-registry.jsonl"), "file");

    await expect(new Registry(rootPath).build([])).rejects.toThrow(
      "symbolic link or reparse point",
    );
    expect(await fs.readFile(inside, "utf-8")).toBe("sentinel\n");
  });

  it("rejects a hard-linked registry target", async () => {
    const inside = path.join(rootPath, "inside.jsonl");
    await fs.writeFile(inside, "sentinel\n", "utf-8");
    await fs.link(inside, path.join(rootPath, "skills-registry.jsonl"));

    await expect(new Registry(rootPath).build([])).rejects.toThrow("hard-linked");
    expect(await fs.readFile(inside, "utf-8")).toBe("sentinel\n");
  });

  it.each([
    [".github/agents/../copilot/forged.agent.md", "Unsafe agent registry path"],
    ["https://example.com/agent.agent.md", "Unsafe agent registry path"],
    [".github/skills/not-an-agent/SKILL.md", "Wrong asset type"],
    [".github/agents/CON.agent.md", "Unsafe Windows agent registry path"],
    [".github/agents/trailing .agent.md", "Unsafe Windows agent registry path"],
    [".github/agents/carrier:payload.agent.md", "NTFS stream separator"],
    [".github/agents/carrier%3Apayload.agent.md", "NTFS stream separator"],
  ])("rejects noncanonical or wrong-type manifest path %s", async (file, message) => {
    await expect(
      new Registry(rootPath, true).build([], [makeAgent("agent")], {
        skillFiles: [],
        agentFiles: [{ name: "agent", file, isSubAgent: false }],
      }),
    ).rejects.toThrow(message);
  });

  it("rejects case-insensitive duplicate manifest targets", async () => {
    await expect(
      new Registry(rootPath, true).build(
        [],
        [makeAgent("one"), makeAgent("two")],
        {
          skillFiles: [],
          agentFiles: [
            { name: "one", file: ".github/agents/Same.agent.md", isSubAgent: false },
            { name: "two", file: ".github/agents/same.agent.md", isSubAgent: false },
          ],
        },
      ),
    ).rejects.toThrow("Duplicate registry asset path");
  });

  it("rejects manifest entries whose generated file is missing", async () => {
    await expect(
      new Registry(rootPath).build([], [makeAgent("missing")], {
        skillFiles: [],
        agentFiles: [{
          name: "missing",
          file: ".github/agents/missing.agent.md",
          isSubAgent: false,
        }],
      }),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a hard-linked generated asset", async () => {
    const source = path.join(rootPath, "shared.agent.md");
    const asset = path.join(rootPath, ".github", "agents", "shared.agent.md");
    await fs.mkdir(path.dirname(asset), { recursive: true });
    await fs.writeFile(source, "shared\n", "utf-8");
    await fs.link(source, asset);

    await expect(
      new Registry(rootPath).build([], [makeAgent("shared")], {
        skillFiles: [],
        agentFiles: [{
          name: "shared",
          file: ".github/agents/shared.agent.md",
          isSubAgent: false,
        }],
      }),
    ).rejects.toThrow("hard-linked");
  });
});
