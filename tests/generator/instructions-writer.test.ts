import fs from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { Generator } from "../../src/generator/index.js";
import {
  buildCopilotInstructions,
  buildDirectoryInstructions,
  removeManagedInstructions,
  renderDirectoryInstructionsFile,
} from "../../src/generator/instructions-writer.js";
import type { AnalysisResult, SkillDefinition } from "../../src/analyzer/types.js";

function skill(name: string, sourceDir: string): SkillDefinition {
  return {
    name,
    description: `${name} skill`,
    sourceDir,
    patterns: [`Follow ${name} conventions`],
    triggers: [],
    category: "patterns",
    examples: [],
  };
}

function analysis(skills: SkillDefinition[]): AnalysisResult {
  return { repoName: "demo", skills, agents: [], tools: [], hooks: [], summary: "" };
}

async function inTempRoot(test: (root: string) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentsmith-instructions-"));
  try {
    await test(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function trackedInstructions(root: string): Promise<unknown> {
  const freshness = await fs.readFile(path.join(root, ".github/copilot/freshness.json"), "utf-8");
  return JSON.parse(freshness).generatedInstructions;
}

describe("path-specific instructions", () => {
  it("writes each file to .github/instructions instead of the folder itself", () => inTempRoot(async (root) => {
    const file = ".github/instructions/agentsmith-src-api-ad4d739d3c08.instructions.md";
    const result = await new Generator(root).generate(analysis([skill("api", "src/api")]));

    expect(result.files).toContain(file);
    expect(await fs.readFile(path.join(root, file), "utf-8")).toContain('applyTo: "src/api/**"');
    await expect(fs.access(path.join(root, "src/api/.copilot-instructions.md")))
      .rejects.toMatchObject({ code: "ENOENT" });
  }));

  it("gives each folder an applyTo glob that matches only its literal name", () => {
    const instructions = buildDirectoryInstructions(analysis([
      skill("auth-group", "app/(auth)"),
      skill("auth-route", "app/[auth]"),
      skill("modal", "app/@modal"),
      skill("drafts", "!drafts"),
    ]));

    // `!drafts` gets no file: a leading `!` negates the whole glob.
    expect(instructions.map(({ directory, applyTo }) => [directory, applyTo])).toEqual([
      ["app/(auth)", "app/[(]auth[)]/**"],
      ["app/[auth]", "app/[[]auth[]]/**"],
      ["app/@modal", "app/@modal/**"],
    ]);
  });

  it("names each file from its folder path alone", () => {
    const files = (directories: string[]) => Object.fromEntries(
      buildDirectoryInstructions(analysis(directories.map((directory) => skill(directory, directory))))
        .map(({ directory, file }) => [directory, file]),
    );

    // Each pair has the same slug, but every folder still gets its own file.
    const all = files(["app/(auth)", "app/[auth]", "src/a-b", "src/a/b"]);
    expect(new Set(Object.values(all)).size).toBe(4);
    // A folder keeps its file whatever other folders exist and in any order.
    expect(files(["src/a/b", "app/[auth]"])).toEqual({
      "src/a/b": all["src/a/b"],
      "app/[auth]": all["app/[auth]"],
    });
  });

  it("keeps frontmatter first and preserves user edits when the managed block is refreshed", () => {
    const [instruction] = buildDirectoryInstructions(analysis([skill("api", "src/api")]));
    const fresh = renderDirectoryInstructionsFile(instruction);
    expect(fresh.startsWith('---\napplyTo: "src/api/**"\n---\n\n<!-- agentsmith:managed -->')).toBe(true);

    const edited = `${fresh.replace(
      'applyTo: "src/api/**"\n',
      'applyTo: "src/api/**"\nexcludeAgent: "code-review"\n',
    )}User notes\n`;
    const stale = edited.replace("- Follow api conventions", "- Old managed advice");
    expect(renderDirectoryInstructionsFile(instruction, stale)).toBe(edited);

    const withoutFrontmatter = "<!-- agentsmith:managed -->\nold\n<!-- /agentsmith:managed -->\n";
    expect(renderDirectoryInstructionsFile(instruction, withoutFrontmatter)).toBe(fresh);

    // Frontmatter alone, as stale cleanup leaves it or with no newline after the closing `---`.
    const rescoped = fresh.replace('applyTo: "src/api/**"', 'applyTo: "src/**"');
    for (const frontmatterOnly of ['---\napplyTo: "src/**"\n---\n', '---\napplyTo: "src/**"\n---']) {
      expect(renderDirectoryInstructionsFile(instruction, frontmatterOnly)).toBe(rescoped);
    }
  });

  it("removes only the managed block from a file that is no longer generated", () => {
    const [instruction] = buildDirectoryInstructions(analysis([skill("api", "src/api")]));
    const generated = renderDirectoryInstructionsFile(instruction);
    const frontmatter = '---\napplyTo: "src/api/**"\n---\n';
    const remove = (content: string) => removeManagedInstructions(content, instruction.applyTo);

    // Only the generated frontmatter would be left, so the file can be deleted.
    expect(remove(generated)).toBe("");
    expect(remove(generated.replace(/\n/g, "\r\n"))).toBe("");
    expect(remove(`${generated}\n## Team notes\n- Keep handlers thin\n`))
      .toBe(`${frontmatter}\n## Team notes\n- Keep handlers thin\n`);
    expect(remove(generated.replace("<!--", "Read the API guide first.\n\n<!--")))
      .toBe(`${frontmatter}\nRead the API guide first.\n`);
    expect(remove(generated.replace("---\n\n", 'excludeAgent: "code-review"\n---\n\n')))
      .toBe('---\napplyTo: "src/api/**"\nexcludeAgent: "code-review"\n---\n');
    // An edited applyTo is a user change, so the file stays.
    expect(remove(generated.replace("src/api/**", "src/**"))).toBe('---\napplyTo: "src/**"\n---\n');
    expect(remove(`${frontmatter}\n## Team notes\n`)).toBeUndefined();
  });

  it("cleans up files a later run no longer generates and keeps user edits", () => inTempRoot(async (root) => {
    const skills = [
      skill("api", "src/api"),
      skill("web", "src/web"),
      skill("db", "src/db"),
      skill("jobs", "src/jobs"),
    ];
    const [api, web, db, jobs] = buildDirectoryInstructions(analysis(skills)).map(({ file }) => file);
    await new Generator(root).generate(analysis(skills));
    await fs.appendFile(path.join(root, web), "\n## Team notes\n- Keep handlers thin\n", "utf-8");
    const jobsContent = await fs.readFile(path.join(root, jobs), "utf-8");
    await fs.writeFile(path.join(root, jobs), jobsContent.replace("src/jobs/**", "src/**"), "utf-8");

    await new Generator(root).generate(analysis([skills[0]]));

    await expect(fs.access(path.join(root, db))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(path.join(root, web), "utf-8"))
      .toBe('---\napplyTo: "src/web/**"\n---\n\n## Team notes\n- Keep handlers thin\n');
    expect(await fs.readFile(path.join(root, jobs), "utf-8")).toBe('---\napplyTo: "src/**"\n---\n');
    expect(await trackedInstructions(root)).toEqual([{ file: api, applyTo: "src/api/**" }]);
  }));

  it("keeps tracking files through a --no-instructions run", () => inTempRoot(async (root) => {
    const skills = [skill("api", "src/api"), skill("db", "src/db")];
    const tracked = buildDirectoryInstructions(analysis(skills))
      .map(({ file, applyTo }) => ({ file, applyTo }));
    await new Generator(root).generate(analysis(skills));

    await new Generator(root, false, false, true).generate(analysis([]));
    for (const { file } of tracked) {
      await expect(fs.access(path.join(root, file))).resolves.toBeUndefined();
    }
    expect(await trackedInstructions(root)).toEqual(tracked);

    await new Generator(root).generate(analysis([skills[0]]));
    await expect(fs.access(path.join(root, tracked[1].file))).rejects.toMatchObject({ code: "ENOENT" });
  }));
});

describe("copilot-instructions.md", () => {
  it("lists each test command and testing pattern once", () => {
    const unitTests = { ...skill("unit-tests", "tests"), category: "quality" as const };
    const testTool = { name: "test", command: "npm test", description: "Run the test suite" };
    const content = buildCopilotInstructions({
      ...analysis([unitTests, { ...unitTests, name: "e2e-tests" }]),
      tools: [testTool, testTool, testTool],
    });

    const testing = content.split("## Testing\n")[1].split("\n## ")[0];
    expect(testing.trim().split("\n")).toEqual([
      "- Run tests: `npm test`",
      "- Follow unit-tests conventions",
    ]);
  });
});
