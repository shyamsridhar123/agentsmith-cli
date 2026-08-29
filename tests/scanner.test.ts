/**
 * Tests for src/scanner/index.ts
 * File enumeration, language/framework detection.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "path";
import type { Stats } from "fs";

// Mock fs/promises before importing Scanner
vi.mock("fs/promises", () => ({
  default: {
    lstat: vi.fn(),
    stat: vi.fn(),
    realpath: vi.fn(),
    open: vi.fn(),
    readFile: vi.fn(),
  },
}));

// Mock glob
vi.mock("glob", () => ({
  glob: vi.fn(),
}));

import fs from "fs/promises";
import { glob } from "glob";
import { Scanner } from "../src/scanner/index.js";

const mockGlob = vi.mocked(glob);
const mockLstat = vi.mocked(fs.lstat);
const mockStat = vi.mocked(fs.stat);
const mockRealpath = vi.mocked(fs.realpath);
const mockOpen = vi.mocked(fs.open);
const mockReadFile = vi.mocked(fs.readFile);

function makeStat(
  size: number,
  options: {
    file?: boolean;
    symbolicLink?: boolean;
    ino?: number;
    nlink?: number;
  } = {},
): Stats {
  return {
    dev: 1,
    ino: options.ino ?? 2,
    nlink: options.nlink ?? 1,
    size,
    mtimeMs: 1,
    ctimeMs: 1,
    isFile: () => options.file ?? true,
    isSymbolicLink: () => options.symbolicLink ?? false,
  } as Stats;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockRealpath.mockImplementation(async (filePath) => path.resolve(String(filePath)));
  mockStat.mockImplementation(async (filePath) => mockLstat(filePath));
  mockOpen.mockImplementation(async (filePath) => {
    let storedContent: Buffer | undefined;
    let readError: unknown;
    try {
      const content = await mockReadFile(filePath);
      storedContent = typeof content === "string"
        ? Buffer.from(content)
        : Buffer.from(content);
    } catch (error) {
      readError = error;
    }
    return {
      stat: async () => {
        const fileStat = await mockLstat(filePath);
        return storedContent
          ? { ...fileStat, size: storedContent.byteLength }
          : fileStat;
      },
      read: async (
        buffer: Buffer,
        offset: number,
        length: number,
        position: number,
      ) => {
        if (!storedContent) throw readError;
        const bytesRead = Math.min(
          length,
          Math.max(0, storedContent.byteLength - position),
        );
        if (bytesRead > 0) {
          storedContent.copy(
            buffer,
            offset,
            position,
            position + bytesRead,
          );
        }
        return { bytesRead, buffer };
      },
      close: vi.fn().mockResolvedValue(undefined),
    } as never;
  });
});

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

describe("Scanner.scan — language detection", () => {
  it("detects TypeScript when .ts files dominate", async () => {
    const files = [
      "src/index.ts",
      "src/utils.ts",
      "src/main.ts",
    ];
    mockGlob.mockResolvedValue(files as any);
    mockLstat.mockResolvedValue(makeStat(100));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.language).toBe("TypeScript");
  });

  it("detects JavaScript when .js files dominate", async () => {
    const files = ["src/app.js", "src/utils.js", "src/main.js"];
    mockGlob.mockResolvedValue(files as any);
    mockLstat.mockResolvedValue(makeStat(100));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.language).toBe("JavaScript");
  });

  it("overrides JavaScript to TypeScript when tsconfig exists", async () => {
    const files = [
      "src/app.js",
      "src/utils.js",
      "src/main.js",
      "tsconfig.json",
    ];
    mockGlob.mockResolvedValue(files as any);
    mockLstat.mockResolvedValue(makeStat(100));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.language).toBe("TypeScript");
  });

  it("detects Python when .py files dominate", async () => {
    const files = ["app.py", "utils.py", "main.py"];
    mockGlob.mockResolvedValue(files as any);
    mockLstat.mockResolvedValue(makeStat(100));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.language).toBe("Python");
  });

  it("detects Go when .go files dominate", async () => {
    const files = ["main.go", "server.go", "handler.go"];
    mockGlob.mockResolvedValue(files as any);
    mockLstat.mockResolvedValue(makeStat(100));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.language).toBe("Go");
  });

  it("returns Unknown when no recognized extensions exist", async () => {
    const files = ["data.csv", "readme.txt"];
    mockGlob.mockResolvedValue(files as any);
    mockLstat.mockResolvedValue(makeStat(100));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.language).toBe("Unknown");
  });
});

// ---------------------------------------------------------------------------
// Framework detection
// ---------------------------------------------------------------------------

describe("Scanner.scan — framework detection", () => {
  it("detects Next.js from package.json dependencies", async () => {
    const files = ["package.json", "src/app.ts"];
    mockGlob.mockResolvedValue(files as any);
    mockLstat.mockResolvedValue(makeStat(100));
    mockReadFile.mockResolvedValue(
      JSON.stringify({ dependencies: { next: "^14.0.0" } }) as any,
    );

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.framework).toBe("Next.js");
  });

  it("detects React from package.json dependencies", async () => {
    const files = ["package.json", "src/app.tsx"];
    mockGlob.mockResolvedValue(files as any);
    mockLstat.mockResolvedValue(makeStat(100));
    mockReadFile.mockResolvedValue(
      JSON.stringify({ dependencies: { react: "^18.0.0" } }) as any,
    );

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.framework).toBe("React");
  });

  it("detects Express.js from package.json dependencies", async () => {
    const files = ["package.json", "src/server.ts"];
    mockGlob.mockResolvedValue(files as any);
    mockLstat.mockResolvedValue(makeStat(100));
    mockReadFile.mockResolvedValue(
      JSON.stringify({ dependencies: { express: "^4.0.0" } }) as any,
    );

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.framework).toBe("Express.js");
  });

  it("returns null when no framework detected", async () => {
    const files = ["src/main.ts"];
    mockGlob.mockResolvedValue(files as any);
    mockLstat.mockResolvedValue(makeStat(100));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.framework).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isTestFile
// ---------------------------------------------------------------------------

describe("Scanner.scan — test file detection", () => {
  it("identifies *.test.ts as test files", async () => {
    const files = ["src/utils.test.ts"];
    mockGlob.mockResolvedValue(files as any);
    mockLstat.mockResolvedValue(makeStat(100));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.testFiles).toContain("src/utils.test.ts");
    expect(result.files[0].isTest).toBe(true);
  });

  it("identifies *.spec.ts as test files", async () => {
    const files = ["src/utils.spec.ts"];
    mockGlob.mockResolvedValue(files as any);
    mockLstat.mockResolvedValue(makeStat(100));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.testFiles).toContain("src/utils.spec.ts");
  });

  it("identifies files in tests/ as test files", async () => {
    const files = ["tests/integration.ts"];
    mockGlob.mockResolvedValue(files as any);
    mockLstat.mockResolvedValue(makeStat(100));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.testFiles).toContain("tests/integration.ts");
  });

  it("identifies files in __tests__/ as test files", async () => {
    const files = ["__tests__/component.tsx"];
    mockGlob.mockResolvedValue(files as any);
    mockLstat.mockResolvedValue(makeStat(100));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.testFiles).toContain("__tests__/component.tsx");
  });

  it("identifies Python test files (test_*.py)", async () => {
    const files = ["test_utils.py"];
    mockGlob.mockResolvedValue(files as any);
    mockLstat.mockResolvedValue(makeStat(100));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.files[0].isTest).toBe(true);
  });

  it("identifies Go test files (*_test.go)", async () => {
    const files = ["handler_test.go"];
    mockGlob.mockResolvedValue(files as any);
    mockLstat.mockResolvedValue(makeStat(100));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.files[0].isTest).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isConfigFile
// ---------------------------------------------------------------------------

describe("Scanner.scan — config file detection", () => {
  it("identifies package.json as config", async () => {
    const files = ["package.json"];
    mockGlob.mockResolvedValue(files as any);
    mockLstat.mockResolvedValue(makeStat(100));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.configFiles).toContain("package.json");
    expect(result.files[0].isConfig).toBe(true);
  });

  it("identifies tsconfig.json as config", async () => {
    const files = ["tsconfig.json"];
    mockGlob.mockResolvedValue(files as any);
    mockLstat.mockResolvedValue(makeStat(100));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.configFiles).toContain("tsconfig.json");
  });

  it("identifies Dockerfile as config", async () => {
    const files = ["Dockerfile"];
    mockGlob.mockResolvedValue(files as any);
    mockLstat.mockResolvedValue(makeStat(100));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.configFiles).toContain("Dockerfile");
  });
});

// ---------------------------------------------------------------------------
// Source directory detection
// ---------------------------------------------------------------------------

describe("Scanner.scan — source directory detection", () => {
  // detectSourceDirectories splits by path.sep, so we must use native separators
  it("detects src as a source directory", async () => {
    const files = [path.join("src", "index.ts"), path.join("src", "utils.ts")];
    mockGlob.mockResolvedValue(files as any);
    mockLstat.mockResolvedValue(makeStat(100));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.sourceDirectories).toContain("src");
  });

  it("detects lib as a source directory", async () => {
    const files = [path.join("lib", "core.ts"), path.join("lib", "utils.ts")];
    mockGlob.mockResolvedValue(files as any);
    mockLstat.mockResolvedValue(makeStat(100));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.sourceDirectories).toContain("lib");
  });

  it("falls back to most common directories when no standard dirs found", async () => {
    const files = [
      path.join("custom", "a.ts"),
      path.join("custom", "b.ts"),
      path.join("other", "c.ts"),
    ];
    mockGlob.mockResolvedValue(files as any);
    mockLstat.mockResolvedValue(makeStat(100));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.sourceDirectories.length).toBeGreaterThan(0);
    expect(result.sourceDirectories).toContain("custom");
  });
});

// ---------------------------------------------------------------------------
// stat failure handling
// ---------------------------------------------------------------------------

describe("Scanner.scan — error handling", () => {
  it("skips files when stat fails", async () => {
    const okFile = path.join("src", "ok.ts");
    const brokenFile = path.join("src", "broken.ts");
    mockGlob.mockResolvedValue([okFile, brokenFile] as any);
    mockLstat
      .mockResolvedValueOnce(makeStat(100))
      .mockRejectedValueOnce(new Error("ENOENT"));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.files).toHaveLength(1);
    expect(result.files[0].relativePath).toBe(okFile);
  });
});

// ---------------------------------------------------------------------------
// Analysis safety and CLI implementation filtering
// ---------------------------------------------------------------------------

describe("Scanner.scan — analysis safety", () => {
  it("excludes sensitive and generated files even when glob returns them", async () => {
    const files = [
      ".env.local",
      ".envrc",
      ".npmrc",
      ".aws/credentials",
      ".docker/config.json",
      ".kube/config",
      ".ssh/id_ed25519",
      "secrets/prod.json",
      "config/deploy-token.txt",
      "config/service-account-key.json",
      "id_rsa",
      ".github/agents/root.agent.md",
      ".github/copilot/freshness.json",
      "vendor/commands/fake.ts",
      "build/commands/fake.ts",
      "src/index.ts",
      "src/tokenizer.ts",
      "src/tokens.ts",
      "src/design-tokens.ts",
      "src/api-key-utils.ts",
    ];
    mockGlob.mockResolvedValue(files as any);
    mockLstat.mockResolvedValue(makeStat(100));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const result = await new Scanner("/fake/root").scan();
    const scannedPaths = result.files.map((file) => file.relativePath);

    expect(scannedPaths).toEqual([
      "src/index.ts",
      "src/tokenizer.ts",
      "src/tokens.ts",
      "src/design-tokens.ts",
      "src/api-key-utils.ts",
    ]);
  });

  it("does not use test or fixture command files as CLI entrypoints", async () => {
    const files = [
      "package.json",
      "tests/commands/main.ts",
      "spec/commands/main.ts",
      "fixtures/cli.ts",
      "vendor/commands/main.ts",
      "src/main.ts",
      "src/scanner/index.ts",
    ];
    mockGlob.mockResolvedValue(files as any);
    mockLstat.mockResolvedValue(makeStat(100));
    mockReadFile.mockImplementation(async (filePath) => {
      if (String(filePath).endsWith("package.json")) {
        return JSON.stringify({
          dependencies: { commander: "^12.0.0" },
          bin: { app: "./tests/commands/main.ts" },
        });
      }
      throw new Error("not found");
    });

    const result = await new Scanner("/fake/root").scan();

    expect(result.cliFramework).toBe("commander");
    expect(result.cliEntryFiles).toEqual(["src/main.ts"]);
    expect(result.testFiles).toContain("tests/commands/main.ts");
    expect(result.testFiles).toContain("spec/commands/main.ts");
    expect(result.testFiles).toContain("fixtures/cli.ts");
  });

  it("rejects symbolic links and path redirection through a parent junction", async () => {
    const linkedFile = path.join("src", "linked.ts");
    const redirectedFile = path.join("src", "junction", "main.ts");
    const safeFile = path.join("src", "main.ts");
    mockGlob.mockResolvedValue([linkedFile, redirectedFile, safeFile] as any);
    mockLstat.mockImplementation(async (filePath) =>
      String(filePath).endsWith(linkedFile)
        ? makeStat(100, { symbolicLink: true })
        : makeStat(100)
    );
    mockRealpath.mockImplementation(async (filePath) => {
      const resolved = path.resolve(String(filePath));
      if (resolved.endsWith(path.normalize(redirectedFile))) {
        return path.resolve("/outside/main.ts");
      }
      return resolved;
    });
    mockReadFile.mockRejectedValue(new Error("not found"));

    const result = await new Scanner("/fake/root").scan();

    expect(result.files.map((file) => file.relativePath)).toEqual([safeFile]);
  });
});
