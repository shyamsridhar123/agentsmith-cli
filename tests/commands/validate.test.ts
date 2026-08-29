import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateCommand } from "../../src/commands/validate.js";

let rootPath: string;
let originalExitCode: number | string | null | undefined;
const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

async function supportsDirectoryLinks(): Promise<boolean> {
  const probe = await fs.mkdtemp(path.join(os.tmpdir(), "agentsmith-dirlink-probe-"));
  try {
    const target = path.join(probe, "target");
    const link = path.join(probe, "link");
    await fs.mkdir(target);
    await fs.symlink(target, link, process.platform === "win32" ? "junction" : "dir");
    return true;
  } catch {
    return false;
  } finally {
    await fs.rm(probe, { recursive: true, force: true });
  }
}

const directoryLinksAvailable = await supportsDirectoryLinks();

async function writeFile(relativePath: string, content: string): Promise<void> {
  const filePath = path.join(rootPath, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

async function writeSkill(name: string): Promise<void> {
  await writeFile(
    `.github/skills/${name}/SKILL.md`,
    `---
name: ${name}
description: Test skill
---

# ${name}
`,
  );
}

async function writeAgent(
  name: string,
  skillReference = "../skills/present/SKILL.md",
): Promise<void> {
  await writeFile(
    `.github/agents/${name}.agent.md`,
    `---
name: ${name}
description: Test agent
tools: []
---

## Skills

- [Present](${skillReference})
`,
  );
}

function output(): string {
  return logSpy.mock.calls.flat().map(String).join("\n").replace(/\\/g, "/");
}

describe("validateCommand referenced paths", () => {
  beforeEach(async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentsmith-validate-"));
    originalExitCode = process.exitCode;
    process.exitCode = 0;
    logSpy.mockClear();
  });

  afterEach(async () => {
    process.exitCode = originalExitCode;
    await fs.rm(rootPath, { recursive: true, force: true });
  });

  it("does not create a missing validation target", async () => {
    const missing = path.join(rootPath, "does-not-exist");

    await expect(validateCommand(missing)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(missing)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports a skill path referenced by an agent when it is missing", async () => {
    await writeSkill("present");
    await writeAgent("root", "../skills/missing/SKILL.md");
    await writeFile(
      "skills-registry.jsonl",
      `${JSON.stringify({
        type: "agent",
        name: "root",
        file: ".github/agents/root.agent.md",
        description: "Root",
        triggers: [],
      })}\n`,
    );

    await validateCommand(rootPath);

    expect(process.exitCode).toBe(1);
    expect(output()).toContain(
      ".github/agents/root.agent.md: Missing referenced path: ../skills/missing/SKILL.md",
    );
  });

  it("reports missing skill and agent files referenced by registry entries", async () => {
    await writeSkill("present");
    await writeAgent("root");
    await writeFile(
      "skills-registry.jsonl",
      [
        {
          type: "skill",
          name: "missing-skill",
          file: ".github/skills/missing-skill/SKILL.md",
          description: "Missing",
          triggers: [],
        },
        {
          type: "agent",
          name: "missing-agent",
          file: ".github/agents/missing-agent.agent.md",
          description: "Missing",
          triggers: [],
        },
      ].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    );

    await validateCommand(rootPath);

    expect(process.exitCode).toBe(1);
    expect(output()).toContain(
      "skills-registry.jsonl line 1 (skill 'missing-skill'): Missing referenced path: .github/skills/missing-skill/SKILL.md",
    );
    expect(output()).toContain(
      "skills-registry.jsonl line 2 (agent 'missing-agent'): Missing referenced path: .github/agents/missing-agent.agent.md",
    );
  });

  it("accepts existing agent and skill registry paths", async () => {
    await writeSkill("present");
    await writeAgent("root");
    await writeFile(
      "skills-registry.jsonl",
      [
        {
          type: "skill",
          name: "present",
          file: ".github/skills/present/SKILL.md",
          description: "Present",
          triggers: [],
        },
        {
          type: "agent",
          name: "root",
          file: ".github/agents/root.agent.md",
          vsCodeAgent: ".github/agents/root.agent.md",
          description: "Root",
          triggers: [],
        },
      ].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    );

    await validateCommand(rootPath);

    expect(process.exitCode).toBe(0);
    expect(output()).toContain("All agent assets are valid");
  });

  it("rejects external URI references in agent markdown", async () => {
    await writeSkill("present");
    await writeAgent("root", "https://example.com/external/SKILL.md");
    await writeFile(
      "skills-registry.jsonl",
      `${JSON.stringify({
        type: "agent",
        name: "root",
        file: ".github/agents/root.agent.md",
        description: "Root",
        triggers: [],
      })}\n`,
    );

    await validateCommand(rootPath);

    expect(process.exitCode).toBe(1);
    expect(output()).toContain(
      ".github/agents/root.agent.md: External referenced paths are not allowed",
    );
  });

  it.runIf(directoryLinksAvailable)(
    "rejects an asset directory redirected outside the repository",
    async () => {
      const outside = await fs.mkdtemp(path.join(os.tmpdir(), "agentsmith-validate-outside-"));
      try {
        await fs.mkdir(path.join(rootPath, ".github"), { recursive: true });
        await fs.symlink(
          outside,
          path.join(rootPath, ".github", "agents"),
          process.platform === "win32" ? "junction" : "dir",
        );
        await validateCommand(rootPath);
        expect(process.exitCode).toBe(1);
        expect(output()).toContain(".github/agents: Unsafe generated path contains a symbolic link or junction");
      } finally {
        await fs.rm(outside, { recursive: true, force: true });
      }
    },
  );

  it("rejects traversal, wrong-type, external, and duplicate registry targets", async () => {
    await writeSkill("present");
    await writeAgent("root");
    await writeFile(
      "skills-registry.jsonl",
      [
        {
          type: "agent",
          name: "root",
          file: ".github/agents/root.agent.md",
          description: "Root",
          triggers: [],
        },
        {
          type: "agent",
          name: "ROOT",
          file: ".github/agents/../copilot/forged.agent.md",
          description: "Duplicate traversal",
          triggers: [],
        },
        {
          type: "skill",
          name: "wrong",
          file: ".github/agents/root.agent.md",
          description: "Wrong type",
          triggers: [],
        },
        {
          type: "skill",
          name: "external",
          file: "https://example.com/SKILL.md",
          description: "External",
          triggers: [],
        },
      ].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    );

    await validateCommand(rootPath);

    expect(process.exitCode).toBe(1);
    expect(output()).toContain("Unsafe agent registry path");
    expect(output()).toContain("Wrong asset type for skill registry path");
    expect(output()).toContain("Unsafe skill registry path");
  });

  it("rejects a mismatched or mistyped vsCodeAgent target", async () => {
    await writeSkill("present");
    await writeAgent("root");
    await writeFile(
      "skills-registry.jsonl",
      `${JSON.stringify({
        type: "agent",
        name: "root",
        file: ".github/agents/root.agent.md",
        vsCodeAgent: ".github/agents/other.agent.md",
        description: "Root",
        triggers: [],
      })}\n`,
    );

    await validateCommand(rootPath);
    expect(process.exitCode).toBe(1);
    expect(output()).toContain("'vsCodeAgent' must match the agent file path");
  });

  it("rejects duplicate canonical registry names and paths", async () => {
    await writeSkill("present");
    await writeAgent("root");
    const base = {
      type: "agent",
      file: ".github/agents/root.agent.md",
      description: "Root",
      triggers: [],
    };
    await writeFile(
      "skills-registry.jsonl",
      [
        { ...base, name: "root" },
        { ...base, name: "ROOT" },
      ].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    );

    await validateCommand(rootPath);
    expect(process.exitCode).toBe(1);
    expect(output()).toContain("Duplicate registry name: ROOT");
    expect(output()).toContain("Duplicate registry path: .github/agents/root.agent.md");
  });

  it("rejects NTFS alternate-data-stream and reserved registry paths", async () => {
    await writeSkill("present");
    await writeAgent("root");
    await writeFile(
      "skills-registry.jsonl",
      [
        {
          type: "agent",
          name: "stream",
          file: ".github/agents/carrier:payload.agent.md",
          description: "Stream",
          triggers: [],
        },
        {
          type: "agent",
          name: "reserved",
          file: ".github/agents/CON.agent.md",
          description: "Reserved",
          triggers: [],
        },
      ].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    );

    await validateCommand(rootPath);
    expect(process.exitCode).toBe(1);
    expect(output()).toContain("NTFS stream separator");
    expect(output()).toContain("Unsafe Windows agent registry path");
  });

  it("rejects hard-linked agent assets", async () => {
    await writeSkill("present");
    const source = path.join(rootPath, "shared.agent.md");
    const target = path.join(rootPath, ".github", "agents", "root.agent.md");
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(
      source,
      `---
name: root
description: Test agent
tools: []
---
`,
      "utf-8",
    );
    await fs.link(source, target);
    await writeFile(
      "skills-registry.jsonl",
      `${JSON.stringify({
        type: "agent",
        name: "root",
        file: ".github/agents/root.agent.md",
        description: "Root",
        triggers: [],
      })}\n`,
    );

    await validateCommand(rootPath);
    expect(process.exitCode).toBe(1);
    expect(output()).toContain("hard-linked");
  });
});
