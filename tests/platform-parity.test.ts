import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { FileCache, stableCacheKey } from "../src/cache/index.js";
import { loadConfig } from "../src/config/index.js";
import { parseHookCommand } from "../src/hooks/index.js";
import { installSkillPack, updateSkillPacks } from "../src/packs/index.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentsmith-platform-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true }),
  ));
});

describe("configuration and cache", () => {
  it("loads project configuration and applies explicit overrides", async () => {
    const root = await temporaryDirectory();
    await fs.writeFile(path.join(root, ".agentsmithrc.json"), JSON.stringify({
      verbose: true,
      cacheTtlSeconds: 60,
    }));

    const config = await loadConfig(root, { verbose: false, output: "generated" });
    expect(config).toMatchObject({
      verbose: false,
      output: "generated",
      cacheTtlSeconds: 60,
    });
  });

  it("round-trips cached values and rejects malformed keys", async () => {
    const directory = await temporaryDirectory();
    const cache = new FileCache(directory);
    const key = stableCacheKey({ repository: "demo" });
    await cache.set(key, { skills: 3 });

    expect(await cache.get(key, 60)).toEqual({ skills: 3 });
    await expect(cache.get("../escape", 60)).resolves.toBeUndefined();
  });
});

describe("validated skill packs", () => {
  it("installs and updates local packs with a lock and registry entry", async () => {
    const packRoot = await temporaryDirectory();
    const targetRoot = await temporaryDirectory();
    await fs.mkdir(path.join(packRoot, "skills", "demo"), { recursive: true });
    await fs.writeFile(path.join(packRoot, "skill-pack.json"), JSON.stringify({
      schemaVersion: 1,
      name: "demo-pack",
      version: "1.0.0",
      description: "Demo",
      skills: [{
        name: "demo",
        path: "skills/demo/SKILL.md",
        description: "Demo skill",
        triggers: ["demo"],
      }],
    }));
    await fs.writeFile(
      path.join(packRoot, "skills", "demo", "SKILL.md"),
      "---\nname: demo\ndescription: Demo\n---\n\n# Demo\n",
    );

    const installed = await installSkillPack(packRoot, targetRoot);
    expect(installed.name).toBe("demo-pack");
    expect(await fs.readFile(
      path.join(targetRoot, ".github", "skills", "demo", "SKILL.md"),
      "utf-8",
    )).toContain("# Demo");
    expect(await fs.readFile(path.join(targetRoot, "skills-registry.jsonl"), "utf-8"))
      .toContain('"name":"demo"');
    expect(await updateSkillPacks(targetRoot, "demo-pack")).toHaveLength(1);
  });
});

describe("hook command safety", () => {
  it("parses quoted arguments without a shell", () => {
    expect(parseHookCommand('npm test -- "tests/unit test.ts"')).toEqual({
      executable: "npm",
      args: ["test", "--", "tests/unit test.ts"],
    });
  });

  it("rejects shell operators", () => {
    expect(() => parseHookCommand("npm test && echo unsafe"))
      .toThrow("Shell operators are not supported");
  });
});
