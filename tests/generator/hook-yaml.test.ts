import fs from "fs/promises";
import os from "os";
import path from "path";
import yaml from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Generator } from "../../src/generator/index.js";
import type { AnalysisResult } from "../../src/analyzer/types.js";

let rootPath: string;

function analysisWithCommand(command: string): AnalysisResult {
  return {
    repoName: "hook-yaml",
    skills: [],
    agents: [],
    tools: [],
    hooks: [{
      name: "windows-command",
      event: "post-generate",
      description: "Run a quoted Windows command: safely",
      commands: [command],
      condition: String.raw`branch == "feature\windows"`,
    }],
    summary: "Hook YAML fixture",
  };
}

describe("generated hook YAML", () => {
  beforeEach(async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentsmith-hook-yaml-"));
  });

  afterEach(async () => {
    await fs.rm(rootPath, { recursive: true, force: true });
  });

  it("round-trips quoted Windows commands through the YAML serializer", async () => {
    const command = String.raw`"C:\Program Files\nodejs\node.exe" "C:\repo\scripts\check.js" --label "a:b"`;
    await new Generator(rootPath).generate(analysisWithCommand(command));

    const content = await fs.readFile(
      path.join(rootPath, ".github", "hooks", "windows-command.yaml"),
      "utf-8",
    );
    expect(yaml.parse(content)).toEqual({
      name: "windows-command",
      event: "post-generate",
      description: "Run a quoted Windows command: safely",
      commands: [command],
      condition: String.raw`branch == "feature\windows"`,
    });
  });
});
