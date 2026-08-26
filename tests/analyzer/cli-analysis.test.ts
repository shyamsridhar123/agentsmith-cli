import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { Scanner } from "../../src/scanner/index.js";
import {
  analyzeCLIStructure,
  generateCLISkills,
  mergeCLISkills,
} from "../../src/analyzer/cli.js";
import { buildDirectoryInstructions } from "../../src/generator/instructions-writer.js";

const temporaryDirectories: string[] = [];

async function tempRepo(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentsmith-cli-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true }),
  ));
});

describe("CLI repository analysis", () => {
  it("detects Commander entry points, commands, and options", async () => {
    const root = await tempRepo();
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
      bin: { widget: "./src/main.ts" },
      dependencies: { commander: "^12.0.0" },
    }));
    await fs.writeFile(
      path.join(root, "src", "main.ts"),
      'program.command("serve").option("-p, --port <number>", "Port").action(run);',
    );

    const scan = await new Scanner(root).scan();
    const cli = await analyzeCLIStructure(scan);

    expect(scan.cliFramework).toBe("commander");
    expect(scan.cliEntryFiles).toContain("src/main.ts");
    expect(cli?.commands[0]).toMatchObject({
      name: "serve",
      file: "src/main.ts",
      options: [{ name: "port", short: "p", description: "Port", required: true }],
    });
  });

  it("detects Python Typer projects", async () => {
    const root = await tempRepo();
    await fs.writeFile(path.join(root, "pyproject.toml"), '[project]\ndependencies = ["typer"]');
    await fs.writeFile(path.join(root, "cli.py"), "import typer\napp = typer.Typer()");

    const scan = await new Scanner(root).scan();
    expect(scan.cliFramework).toBe("typer");
    expect(scan.cliEntryFiles).toContain("cli.py");
  });

  it("generates structure, option, and testing skills without replacing LLM skills", () => {
    const generated = generateCLISkills({
      framework: "commander",
      entryFiles: ["src/main.ts"],
      commands: [{ name: "serve", file: "src/main.ts", options: [], }],
      extensionPoints: ["src"],
      testFiles: ["tests/cli.test.ts"],
    });
    const merged = mergeCLISkills([{
      name: "domain-patterns",
      description: "Domain patterns",
      sourceDir: "src",
      patterns: [],
      triggers: [],
      category: "patterns",
      examples: [],
    }], generated);

    expect(merged.map((skill) => skill.name)).toEqual([
      "domain-patterns",
      "cli-structure",
      "cli-options",
      "cli-testing",
    ]);
    expect(generated.every((skill) => skill.cliFocused)).toBe(true);
  });

  it("builds managed per-directory instructions with anti-patterns and references", () => {
    const instructions = buildDirectoryInstructions({
      repoName: "demo",
      agents: [],
      tools: [],
      hooks: [],
      summary: "",
      skills: [{
        name: "cli-options",
        description: "Options",
        sourceDir: "src/commands",
        patterns: ["Validate inputs"],
        triggers: [],
        category: "patterns",
        examples: [],
        antiPatterns: ["Do not expose secrets"],
        codebaseReferences: ["src/commands/root.ts"],
      }],
    });

    expect(instructions).toHaveLength(1);
    expect(instructions[0].content).toContain("<!-- agentsmith:managed -->");
    expect(instructions[0].content).toContain("Validate inputs");
    expect(instructions[0].content).toContain("Do not expose secrets");
    expect(instructions[0].content).toContain("src/commands/root.ts");
  });
});
