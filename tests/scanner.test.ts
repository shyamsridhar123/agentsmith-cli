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
    stat: vi.fn(),
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
const mockStat = vi.mocked(fs.stat);
const mockReadFile = vi.mocked(fs.readFile);

function makeStat(size: number): Stats {
  return { size } as Stats;
}

beforeEach(() => {
  vi.resetAllMocks();
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
    mockStat.mockResolvedValue(makeStat(100));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.language).toBe("TypeScript");
  });

  it("detects JavaScript when .js files dominate", async () => {
    const files = ["src/app.js", "src/utils.js", "src/main.js"];
    mockGlob.mockResolvedValue(files as any);
    mockStat.mockResolvedValue(makeStat(100));
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
    mockStat.mockResolvedValue(makeStat(100));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.language).toBe("TypeScript");
  });

  it("detects Python when .py files dominate", async () => {
    const files = ["app.py", "utils.py", "main.py"];
    mockGlob.mockResolvedValue(files as any);
    mockStat.mockResolvedValue(makeStat(100));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.language).toBe("Python");
  });

  it("detects Go when .go files dominate", async () => {
    const files = ["main.go", "server.go", "handler.go"];
    mockGlob.mockResolvedValue(files as any);
    mockStat.mockResolvedValue(makeStat(100));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.language).toBe("Go");
  });

  it("returns Unknown when no recognized extensions exist", async () => {
    const files = ["data.csv", "readme.txt"];
    mockGlob.mockResolvedValue(files as any);
    mockStat.mockResolvedValue(makeStat(100));
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
    mockStat.mockResolvedValue(makeStat(100));
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
    mockStat.mockResolvedValue(makeStat(100));
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
    mockStat.mockResolvedValue(makeStat(100));
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
    mockStat.mockResolvedValue(makeStat(100));
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
    mockStat.mockResolvedValue(makeStat(100));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.testFiles).toContain("src/utils.test.ts");
    expect(result.files[0].isTest).toBe(true);
  });

  it("identifies *.spec.ts as test files", async () => {
    const files = ["src/utils.spec.ts"];
    mockGlob.mockResolvedValue(files as any);
    mockStat.mockResolvedValue(makeStat(100));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.testFiles).toContain("src/utils.spec.ts");
  });

  it("identifies files in tests/ as test files", async () => {
    const files = ["tests/integration.ts"];
    mockGlob.mockResolvedValue(files as any);
    mockStat.mockResolvedValue(makeStat(100));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.testFiles).toContain("tests/integration.ts");
  });

  it("identifies files in __tests__/ as test files", async () => {
    const files = ["__tests__/component.tsx"];
    mockGlob.mockResolvedValue(files as any);
    mockStat.mockResolvedValue(makeStat(100));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.testFiles).toContain("__tests__/component.tsx");
  });

  it("identifies Python test files (test_*.py)", async () => {
    const files = ["test_utils.py"];
    mockGlob.mockResolvedValue(files as any);
    mockStat.mockResolvedValue(makeStat(100));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.files[0].isTest).toBe(true);
  });

  it("identifies Go test files (*_test.go)", async () => {
    const files = ["handler_test.go"];
    mockGlob.mockResolvedValue(files as any);
    mockStat.mockResolvedValue(makeStat(100));
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
    mockStat.mockResolvedValue(makeStat(100));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.configFiles).toContain("package.json");
    expect(result.files[0].isConfig).toBe(true);
  });

  it("identifies tsconfig.json as config", async () => {
    const files = ["tsconfig.json"];
    mockGlob.mockResolvedValue(files as any);
    mockStat.mockResolvedValue(makeStat(100));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.configFiles).toContain("tsconfig.json");
  });

  it("identifies Dockerfile as config", async () => {
    const files = ["Dockerfile"];
    mockGlob.mockResolvedValue(files as any);
    mockStat.mockResolvedValue(makeStat(100));
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
    mockStat.mockResolvedValue(makeStat(100));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.sourceDirectories).toContain("src");
  });

  it("detects lib as a source directory", async () => {
    const files = [path.join("lib", "core.ts"), path.join("lib", "utils.ts")];
    mockGlob.mockResolvedValue(files as any);
    mockStat.mockResolvedValue(makeStat(100));
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
    mockStat.mockResolvedValue(makeStat(100));
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
    mockStat
      .mockResolvedValueOnce(makeStat(100))
      .mockRejectedValueOnce(new Error("ENOENT"));
    mockReadFile.mockRejectedValue(new Error("not found"));

    const scanner = new Scanner("/fake/root");
    const result = await scanner.scan();
    expect(result.files).toHaveLength(1);
    expect(result.files[0].relativePath).toBe(okFile);
  });
});
