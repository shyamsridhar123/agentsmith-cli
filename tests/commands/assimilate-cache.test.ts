import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildAnalysisCacheKey } from "../../src/commands/assimilate.js";
import {
  createRepositorySnapshot,
  type ScanResult,
} from "../../src/scanner/index.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentsmith-cache-key-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("analysis cache freshness", () => {
  it("changes the cache key when AGENTSMITH_MODEL selects another model", async () => {
    const scanResult: ScanResult = {
      rootPath: await temporaryDirectory(),
      files: [],
      language: "TypeScript",
      framework: null,
      configFiles: [],
      testFiles: [],
      sourceDirectories: [],
      cliFramework: null,
      cliEntryFiles: [],
    };

    vi.stubEnv("AGENTSMITH_MODEL", "");
    const copilotDefault = await buildAnalysisCacheKey(scanResult);
    vi.stubEnv("AGENTSMITH_MODEL", "model-a");
    const modelA = await buildAnalysisCacheKey(scanResult);
    vi.stubEnv("AGENTSMITH_MODEL", "model-b");
    const modelB = await buildAnalysisCacheKey(scanResult);

    expect(new Set([copilotDefault, modelA, modelB]).size).toBe(3);
  });

  it("keeps the cache key when the scanner lists files in another order", async () => {
    const root = await temporaryDirectory();
    const names = ["a.test.ts", "b.test.ts", "a.config.ts", "b.config.ts"];
    for (const name of names) {
      await fs.writeFile(path.join(root, name), name, "utf-8");
    }
    const scanResultInOrder = (order: (list: string[]) => string[]): ScanResult => ({
      rootPath: root,
      files: order(names).map((name) => ({
        path: path.join(root, name),
        relativePath: name,
        extension: ".ts",
        size: name.length,
        isTest: name.includes(".test."),
        isConfig: name.includes(".config."),
      })),
      language: "TypeScript",
      framework: null,
      configFiles: order(["a.config.ts", "b.config.ts"]),
      testFiles: order(["a.test.ts", "b.test.ts"]),
      sourceDirectories: order(["lib", "src"]),
      cliFramework: null,
      cliEntryFiles: [],
    });

    const forward = await buildAnalysisCacheKey(scanResultInOrder((list) => list));
    const reversed = await buildAnalysisCacheKey(
      scanResultInOrder((list) => [...list].reverse()),
    );

    expect(reversed).toBe(forward);
  });

  it("changes the cache key for a same-size content edit", async () => {
    const root = await temporaryDirectory();
    const filePath = path.join(root, "src.ts");
    await fs.writeFile(filePath, "alpha", "utf-8");
    const scanResult: ScanResult = {
      rootPath: root,
      files: [{
        path: filePath,
        relativePath: "src.ts",
        extension: ".ts",
        size: 5,
        isTest: false,
        isConfig: false,
      }],
      language: "TypeScript",
      framework: null,
      configFiles: [],
      testFiles: [],
      sourceDirectories: [],
      cliFramework: null,
      cliEntryFiles: [],
    };

    const before = await buildAnalysisCacheKey(scanResult);
    await fs.writeFile(filePath, "bravo", "utf-8");
    const after = await buildAnalysisCacheKey(scanResult);

    expect(after).not.toBe(before);
  });

  it("keys the immutable snapshot rather than later A-B-A path mutations", async () => {
    const root = await temporaryDirectory();
    const filePath = path.join(root, "src.ts");
    await fs.writeFile(filePath, "alpha", "utf-8");
    const scanResult: ScanResult = {
      rootPath: root,
      files: [{
        path: filePath,
        relativePath: "src.ts",
        extension: ".ts",
        size: 5,
        isTest: false,
        isConfig: false,
      }],
      language: "TypeScript",
      framework: null,
      configFiles: [],
      testFiles: [],
      sourceDirectories: [],
      cliFramework: null,
      cliEntryFiles: [],
    };
    const snapshot = await createRepositorySnapshot(root, ["src.ts"], {
      computeDigests: true,
      textByteLimits: new Map([["src.ts", 100]]),
    });
    const before = await buildAnalysisCacheKey(scanResult, snapshot);

    await fs.writeFile(filePath, "bravo", "utf-8");
    await fs.writeFile(filePath, "alpha", "utf-8");
    const after = await buildAnalysisCacheKey(scanResult, snapshot);

    expect(after).toBe(before);
    expect(snapshot.files.get("src.ts")?.text).toBe("alpha");
  });

  it("stores immutable digests and does not expose full-file bytes", async () => {
    const root = await temporaryDirectory();
    const filePath = path.join(root, "src.ts");
    await fs.writeFile(filePath, "alpha", "utf-8");
    const scanResult: ScanResult = {
      rootPath: root,
      files: [{
        path: filePath,
        relativePath: "src.ts",
        extension: ".ts",
        size: 5,
        isTest: false,
        isConfig: false,
      }],
      language: "TypeScript",
      framework: null,
      configFiles: [],
      testFiles: [],
      sourceDirectories: [],
      cliFramework: null,
      cliEntryFiles: [],
    };
    const snapshot = await createRepositorySnapshot(root, ["src.ts"], {
      computeDigests: true,
      textByteLimits: new Map([["src.ts", 100]]),
    });
    const before = await buildAnalysisCacheKey(scanResult, snapshot);
    const file = snapshot.files.get("src.ts")!;

    expect(file.text).toBe("alpha");
    expect(file.digest).toMatch(/^[a-f0-9]{64}$/);
    expect("bytes" in file).toBe(false);
    await expect(buildAnalysisCacheKey(scanResult, snapshot))
      .resolves.toBe(before);
    expect(() => (
      snapshot.files as Map<string, unknown>
    ).set("other.ts", {})).toThrow();
  });
});
