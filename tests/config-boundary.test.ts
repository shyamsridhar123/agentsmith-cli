import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  loadConfig,
  validateOutputPath,
} from "../src/config/index.js";

const temporaryDirectories: string[] = [];
const originalEnvironment = { ...process.env };

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentsmith-config-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

beforeEach(async () => {
  const configHome = await temporaryDirectory();
  process.env.APPDATA = configHome;
  process.env.XDG_CONFIG_HOME = configHome;
  delete process.env.AGENTSMITH_OUTPUT;
  delete process.env.AGENTSMITH_VERBOSE;
  delete process.env.AGENTSMITH_CACHE;
  delete process.env.AGENTSMITH_CACHE_TTL;
});

afterEach(async () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("project configuration output boundary", () => {
  it("rejects a project output path that lexically escapes the repository", async () => {
    const root = await temporaryDirectory();
    await fs.writeFile(
      path.join(root, ".agentsmithrc.json"),
      JSON.stringify({ output: "../escaped" }),
      "utf-8",
    );

    await expect(loadConfig(root)).rejects.toThrow(
      "Project config output must stay within the repository",
    );
  });

  it("rejects a project output path that escapes through a symlink or junction", async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const linkedDirectory = path.join(root, "linked");
    await fs.symlink(
      outside,
      linkedDirectory,
      process.platform === "win32" ? "junction" : "dir",
    );
    await fs.writeFile(
      path.join(root, ".agentsmithrc.json"),
      JSON.stringify({ output: "linked/generated" }),
      "utf-8",
    );

    await expect(loadConfig(root)).rejects.toThrow(
      "Project config output must stay within the repository",
    );
  });

  it("rejects a contained output symlink or junction instead of following it", async () => {
    const root = await temporaryDirectory();
    const realDirectory = path.join(root, "real-output");
    const linkedDirectory = path.join(root, "linked-output");
    await fs.mkdir(realDirectory);
    await fs.symlink(
      realDirectory,
      linkedDirectory,
      process.platform === "win32" ? "junction" : "dir",
    );
    await fs.writeFile(
      path.join(root, ".agentsmithrc.json"),
      JSON.stringify({ output: "linked-output/generated" }),
      "utf-8",
    );

    await expect(loadConfig(root)).rejects.toThrow(
      "cannot use symbolic links or junctions",
    );
  });

  it("rejects traversal segments even when they resolve inside the repository", async () => {
    const root = await temporaryDirectory();
    await fs.writeFile(
      path.join(root, ".agentsmithrc.json"),
      JSON.stringify({ output: "nested/../generated" }),
      "utf-8",
    );

    await expect(loadConfig(root)).rejects.toThrow(
      "Project config output must stay within the repository",
    );
  });

  it("detects a junction introduced after an earlier output validation", async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const output = path.join(root, "generated");
    await fs.mkdir(output);
    await expect(validateOutputPath(root, output, true)).resolves.toBe(output);

    await fs.rm(output, { recursive: true });
    await fs.symlink(
      outside,
      output,
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(validateOutputPath(root, output, true)).rejects.toThrow(
      "cannot use symbolic links or junctions",
    );
  });

  it("allows an explicit output override outside the repository", async () => {
    const root = await temporaryDirectory();
    const explicitOutput = await temporaryDirectory();
    await fs.writeFile(
      path.join(root, ".agentsmithrc.json"),
      JSON.stringify({ output: "../ignored-project-output" }),
      "utf-8",
    );

    const config = await loadConfig(root, { output: explicitOutput });

    expect(config.output).toBe(explicitOutput);
    expect(config.outputSource).toBe("override");
  });
});
