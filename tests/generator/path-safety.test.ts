import fs from "fs/promises";
import type { FileHandle } from "fs/promises";
import { constants } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Generator } from "../../src/generator/index.js";
import {
  atomicWriteContainedFile,
  createContainedRoot,
  readContainedFile,
  removeContainedExistingFile,
} from "../../src/generator/path-safety.js";
import { digestManagedContent } from "../../src/generator/managed-assets.js";
import type { AnalysisResult, SkillDefinition } from "../../src/analyzer/types.js";

let sandbox: string;
let rootPath: string;
let outsidePath: string;

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

function makeAnalysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    repoName: "safe-repo",
    skills: [],
    agents: [],
    tools: [],
    hooks: [],
    summary: "Safe repository",
    ...overrides,
  };
}

async function createDirectoryLink(target: string, link: string): Promise<void> {
  await fs.symlink(target, link, process.platform === "win32" ? "junction" : "dir");
}

async function supportsFileSymlinks(): Promise<boolean> {
  const probe = await fs.mkdtemp(path.join(os.tmpdir(), "agentsmith-symlink-probe-"));
  try {
    const target = path.join(probe, "target");
    const link = path.join(probe, "link");
    await fs.writeFile(target, "probe", "utf-8");
    await fs.symlink(target, link, "file");
    return true;
  } catch {
    return false;
  } finally {
    await fs.rm(probe, { recursive: true, force: true });
  }
}

const fileSymlinksAvailable = await supportsFileSymlinks();

function interceptTargetWrite(
  targetPath: string,
  beforeWrite: () => Promise<void>,
): ReturnType<typeof vi.spyOn> {
  const originalOpen = fs.open.bind(fs);
  let intercepted = false;

  return vi.spyOn(fs, "open").mockImplementation(async (filePath, flags, mode) => {
    const handle = mode === undefined
      ? await originalOpen(filePath, flags)
      : await originalOpen(filePath, flags, mode);
    const openedName = path.basename(filePath.toString());
    const targetName = path.basename(targetPath);
    const numericFlags = typeof flags === "number" ? flags : 0;
    const writable = (numericFlags & constants.O_WRONLY) !== 0
      || (numericFlags & constants.O_RDWR) !== 0;
    const matchesTarget = path.resolve(filePath.toString()) === path.resolve(targetPath)
      || openedName.startsWith(`.agentsmith-${targetName}-`);
    if (intercepted || !matchesTarget || !writable) {
      return handle;
    }

    intercepted = true;
    let firstWrite = true;
    return new Proxy(handle, {
      get(inner, property) {
        if (property === "write") {
          return async (...args: unknown[]) => {
            if (firstWrite) {
              firstWrite = false;
              await beforeWrite();
            }
            return Reflect.apply(inner.write, inner, args);
          };
        }
        const value = Reflect.get(inner, property, inner);
        return typeof value === "function" ? value.bind(inner) : value;
      },
    }) as FileHandle;
  });
}

describe("Generator path containment", () => {
  beforeEach(async () => {
    sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "agentsmith-generator-path-"));
    rootPath = path.join(sandbox, "root");
    outsidePath = path.join(sandbox, "outside");
    await fs.mkdir(path.join(rootPath, ".github"), { recursive: true });
    await fs.mkdir(outsidePath, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(sandbox, { recursive: true, force: true });
  });

  it("rejects a pre-existing skills symlink or junction that escapes the output root", async () => {
    await createDirectoryLink(outsidePath, path.join(rootPath, ".github", "skills"));

    await expect(
      new Generator(rootPath, false, false, true).generate(
        makeAnalysis({ skills: [makeSkill()] }),
      ),
    ).rejects.toThrow("symbolic link or junction");

    expect(await fs.readdir(outsidePath)).toEqual([]);
  });

  it("rejects a managed directory junction even when it resolves inside the root", async () => {
    const redirected = path.join(rootPath, "src");
    await fs.mkdir(redirected);
    await createDirectoryLink(redirected, path.join(rootPath, ".github", "agents"));

    await expect(
      new Generator(rootPath, false, false, true).generate(makeAnalysis()),
    ).rejects.toThrow("symbolic link or junction");
    expect(await fs.readdir(redirected)).toEqual([]);
  });

  it.runIf(fileSymlinksAvailable)(
    "rejects a pre-existing generated file symlink even when its target is inside the root",
    async () => {
      const target = path.join(rootPath, "package.json");
      const agentsDir = path.join(rootPath, ".github", "agents");
      await fs.mkdir(agentsDir);
      await fs.writeFile(target, "sentinel\n", "utf-8");
      await fs.symlink(target, path.join(agentsDir, "safe-repo.agent.md"), "file");

      await expect(
        new Generator(rootPath, false, false, true).generate(makeAnalysis()),
      ).rejects.toThrow("symbolic link or reparse point");
      expect(await fs.readFile(target, "utf-8")).toBe("sentinel\n");
    },
  );

  it("rejects an existing hard-linked generated target", async () => {
    const target = path.join(rootPath, "package.json");
    const agentsDir = path.join(rootPath, ".github", "agents");
    await fs.mkdir(agentsDir);
    await fs.writeFile(target, "sentinel\n", "utf-8");
    await fs.link(target, path.join(agentsDir, "safe-repo.agent.md"));

    await expect(
      new Generator(rootPath, false, false, true).generate(makeAnalysis()),
    ).rejects.toThrow("hard-linked");
    expect(await fs.readFile(target, "utf-8")).toBe("sentinel\n");
  });

  it("atomically replaces an existing regular file with a new inode", async () => {
    const agentsDir = path.join(rootPath, ".github", "agents");
    const target = path.join(agentsDir, "safe-repo.agent.md");
    await fs.mkdir(agentsDir);
    await fs.writeFile(target, "old content\n", "utf-8");
    const before = await fs.stat(target, { bigint: true });

    await atomicWriteContainedFile(
      await createContainedRoot(rootPath),
      target,
      "updated content\n",
    );

    const after = await fs.stat(target, { bigint: true });
    expect({ dev: after.dev, ino: after.ino }).not.toEqual({
      dev: before.dev,
      ino: before.ino,
    });
    expect(await fs.readFile(target, "utf-8")).toBe("updated content\n");
  });

  it("creates a new final file without staging files", async () => {
    const agentsDir = path.join(rootPath, ".github", "agents");
    const target = path.join(agentsDir, "safe-repo.agent.md");
    await fs.mkdir(agentsDir);

    await atomicWriteContainedFile(
      await createContainedRoot(rootPath),
      target,
      "new content\n",
    );

    expect(await fs.readFile(target, "utf-8")).toBe("new content\n");
    expect(await fs.readdir(agentsDir)).toEqual(["safe-repo.agent.md"]);
  });

  it("cleans up an exclusively created file after an interrupted write", async () => {
    const agentsDir = path.join(rootPath, ".github", "agents");
    const target = path.join(agentsDir, "safe-repo.agent.md");
    await fs.mkdir(agentsDir);
    const openSpy = interceptTargetWrite(target, async () => {
      throw new Error("simulated write failure");
    });

    try {
      await expect(
        atomicWriteContainedFile(
          await createContainedRoot(rootPath),
          target,
          "new content\n",
        ),
      ).rejects.toThrow("simulated write failure");
      await expect(fs.stat(target)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await fs.readdir(agentsDir)).toEqual([]);
    } finally {
      openSpy.mockRestore();
    }
  });

  it("leaves the complete old file visible when replacement fails before commit", async () => {
    const agentsDir = path.join(rootPath, ".github", "agents");
    const target = path.join(agentsDir, "safe-repo.agent.md");
    await fs.mkdir(agentsDir);
    await fs.writeFile(target, "complete old content\n", "utf-8");
    const originalRename = fs.rename.bind(fs);
    const renameSpy = vi.spyOn(fs, "rename").mockImplementation(async (source, destination) => {
      if (path.resolve(destination.toString()) === path.resolve(target)) {
        expect(await fs.readFile(target, "utf-8")).toBe("complete old content\n");
        throw new Error("simulated commit failure");
      }
      return originalRename(source, destination);
    });

    try {
      await expect(
        atomicWriteContainedFile(
          await createContainedRoot(rootPath),
          target,
          "complete new content\n",
        ),
      ).rejects.toThrow("simulated commit failure");
      expect(await fs.readFile(target, "utf-8")).toBe("complete old content\n");
      expect((await fs.readdir(agentsDir)).filter((name) => name.includes(".tmp"))).toEqual([]);
    } finally {
      renameSpy.mockRestore();
    }
  });

  it("preserves an external sentinel when the parent is swapped during replacement", async () => {
    const agentsDir = path.join(rootPath, ".github", "agents");
    await fs.mkdir(agentsDir);
    const target = path.join(agentsDir, "safe-repo.agent.md");
    const movedParent = path.join(rootPath, ".github", "agents-original");
    const externalTarget = path.join(outsidePath, path.basename(target));
    const originalContent = Buffer.from("original managed content\n");
    const sentinel = Buffer.from([0, 255, 19, 88, 42, 10, 77]);
    await fs.writeFile(target, originalContent);
    await fs.writeFile(externalTarget, sentinel);
    const originalRename = fs.rename.bind(fs);
    let parentSwapped = false;
    const openSpy = interceptTargetWrite(
      target,
      async () => {
        try {
          await originalRename(agentsDir, movedParent);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EPERM") {
            throw new Error("parent swap blocked while validated handles are open");
          }
          throw error;
        }
        parentSwapped = true;
        await createDirectoryLink(outsidePath, agentsDir);
      },
    );

    try {
      await expect(
        atomicWriteContainedFile(
          await createContainedRoot(rootPath),
          target,
          "generated content\n",
        ),
      ).rejects.toThrow(/changed identity|parent swap blocked/);
      expect(await fs.readFile(externalTarget)).toEqual(sentinel);
      const originalTarget = parentSwapped
        ? path.join(movedParent, path.basename(target))
        : target;
      expect(await fs.readFile(originalTarget)).toEqual(
        originalContent,
      );
    } finally {
      openSpy.mockRestore();
    }
  });

  it("binds writes to the output-root identity captured at open time", async () => {
    const contained = await createContainedRoot(rootPath);
    const originalRoot = path.join(sandbox, "original-root");
    await fs.rename(rootPath, originalRoot);
    await fs.mkdir(rootPath);

    await expect(
      atomicWriteContainedFile(
        contained,
        path.join(rootPath, "generated.txt"),
        "generated\n",
      ),
    ).rejects.toThrow("output root changed identity");
    expect(await fs.readdir(rootPath)).toEqual([]);
    expect(await fs.readdir(originalRoot)).toEqual([".github"]);
  });

  it("never returns external bytes during an A-B-A parent swap", async () => {
    const agentsDir = path.join(rootPath, ".github", "agents");
    const target = path.join(agentsDir, "safe-repo.agent.md");
    const movedParent = path.join(rootPath, ".github", "agents-original");
    const externalTarget = path.join(outsidePath, path.basename(target));
    await fs.mkdir(agentsDir);
    await fs.writeFile(target, "managed bytes\n", "utf-8");
    await fs.writeFile(externalTarget, "external bytes\n", "utf-8");
    const contained = await createContainedRoot(rootPath);
    const originalOpen = fs.open.bind(fs);
    const originalRename = fs.rename.bind(fs);
    let injected = false;
    let swapBlocked = false;
    const openSpy = vi.spyOn(fs, "open").mockImplementation(async (filePath, flags, mode) => {
      const isTarget = path.basename(filePath.toString()) === path.basename(target);
      if (injected || !isTarget) {
        return mode === undefined
          ? originalOpen(filePath, flags)
          : originalOpen(filePath, flags, mode);
      }
      injected = true;
      try {
        await originalRename(agentsDir, movedParent);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM") {
          swapBlocked = true;
          return mode === undefined
            ? originalOpen(filePath, flags)
            : originalOpen(filePath, flags, mode);
        }
        throw error;
      }
      await createDirectoryLink(outsidePath, agentsDir);
      try {
        return mode === undefined
          ? await originalOpen(filePath, flags)
          : await originalOpen(filePath, flags, mode);
      } finally {
        await fs.unlink(agentsDir);
        await originalRename(movedParent, agentsDir);
      }
    });

    try {
      try {
        const result = await readContainedFile(contained, target);
        expect(result).toBe("managed bytes\n");
        expect(result).not.toBe("external bytes\n");
      } catch (error) {
        expect((error as Error).message).toMatch(/changed identity|parent swap blocked/);
      }
      expect(swapBlocked || injected).toBe(true);
      expect(await fs.readFile(externalTarget, "utf-8")).toBe("external bytes\n");
    } finally {
      openSpy.mockRestore();
    }
  });

  it("never deletes an external file during an A-B-A parent swap", async () => {
    const agentsDir = path.join(rootPath, ".github", "agents");
    const target = path.join(agentsDir, "safe-repo.agent.md");
    const movedParent = path.join(rootPath, ".github", "agents-original");
    const externalTarget = path.join(outsidePath, path.basename(target));
    const content = "managed bytes\n";
    await fs.mkdir(agentsDir);
    await fs.writeFile(target, content, "utf-8");
    await fs.writeFile(externalTarget, "external bytes\n", "utf-8");
    const contained = await createContainedRoot(rootPath);
    const originalRename = fs.rename.bind(fs);
    let intercepted = false;
    const renameSpy = vi.spyOn(fs, "rename").mockImplementation(async (source, destination) => {
      const isTarget = path.basename(source.toString()) === path.basename(target);
      if (intercepted || !isTarget) return originalRename(source, destination);
      intercepted = true;
      try {
        await originalRename(agentsDir, movedParent);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM") {
          return originalRename(source, destination);
        }
        throw error;
      }
      await createDirectoryLink(outsidePath, agentsDir);
      try {
        await originalRename(source, destination);
      } finally {
        await fs.unlink(agentsDir);
        await originalRename(movedParent, agentsDir);
      }
    });

    try {
      try {
        await removeContainedExistingFile(
          contained,
          target,
          digestManagedContent(content),
        );
      } catch (error) {
        expect((error as NodeJS.ErrnoException).code ?? (error as Error).message)
          .toMatch(/ENOENT|changed identity|parent swap blocked/);
      }
      expect(await fs.readFile(externalTarget, "utf-8")).toBe("external bytes\n");
    } finally {
      renameSpy.mockRestore();
    }
  });

  it("preserves user-managed content when safely replacing managed instructions", async () => {
    const instructionsPath = path.join(rootPath, ".github", "copilot-instructions.md");
    await fs.writeFile(
      instructionsPath,
      `User preface
<!-- agentsmith:managed -->
old managed content
<!-- /agentsmith:managed -->
User suffix
`,
      "utf-8",
    );

    await new Generator(rootPath).generate(makeAnalysis());

    const content = await fs.readFile(instructionsPath, "utf-8");
    expect(content).toContain("User preface");
    expect(content).toContain("User suffix");
    expect(content).toContain("# Copilot Instructions");
    expect(content).not.toContain("old managed content");
  });
});
