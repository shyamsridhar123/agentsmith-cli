import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AnalysisResult } from "../../src/analyzer/types.js";
import {
  createRepositorySnapshot,
  type ScanResult,
} from "../../src/scanner/index.js";

const mocks = vi.hoisted(() => ({
  scan: vi.fn(),
  localAnalyze: vi.fn(),
  remoteAnalyze: vi.fn(),
  remoteConstructor: vi.fn(),
  createLocalSnapshot: vi.fn(),
  generate: vi.fn(),
  buildRegistry: vi.fn(),
  executeHooks: vi.fn(),
  loadConfig: vi.fn(),
  validateOutputPath: vi.fn(),
  getRepoInfo: vi.fn(),
  resolveRevision: vi.fn(),
  getLicense: vi.fn(),
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
}));

vi.mock("../../src/scanner/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/scanner/index.js")>();
  return {
    ...actual,
    Scanner: class {
      scan = mocks.scan;
    },
  };
});

vi.mock("../../src/analyzer/index.js", () => ({
  Analyzer: class {
    analyze = mocks.localAnalyze;
  },
  createLocalAnalysisSnapshot: mocks.createLocalSnapshot,
  RemoteAnalyzer: class {
    constructor(...args: unknown[]) {
      mocks.remoteConstructor(...args);
    }
    analyze = mocks.remoteAnalyze;
  },
}));

vi.mock("../../src/generator/index.js", () => ({
  Generator: class {
    generate = mocks.generate;
  },
}));

vi.mock("../../src/registry/index.js", () => ({
  Registry: class {
    build = mocks.buildRegistry;
  },
}));

vi.mock("../../src/hooks/index.js", () => ({
  HookRunner: class {
    execute = mocks.executeHooks;
    executeDefinitions = mocks.executeHooks;
  },
}));

vi.mock("../../src/config/index.js", () => ({
  loadConfig: mocks.loadConfig,
  validateOutputPath: mocks.validateOutputPath,
}));

vi.mock("../../src/github/index.js", () => ({
  GitHubClient: class {
    getRepoInfo = mocks.getRepoInfo;
    resolveRevision = mocks.resolveRevision;
    getLicense = mocks.getLicense;
  },
}));

vi.mock("../../src/cache/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/cache/index.js")>();
  return {
    ...actual,
    FileCache: class {
      get = mocks.cacheGet;
      set = mocks.cacheSet;
    },
  };
});

import { assimilateCommand } from "../../src/commands/assimilate.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentsmith-boundary-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function makeAnalysis(): AnalysisResult {
  return {
    repoName: "test-repo",
    summary: "Test repository",
    skills: [],
    agents: [],
    tools: [],
    hooks: [],
  };
}

function makeScan(rootPath: string): ScanResult {
  return {
    rootPath,
    files: [],
    language: "TypeScript",
    framework: null,
    configFiles: [],
    testFiles: [],
    sourceDirectories: [],
    cliFramework: null,
    cliEntryFiles: [],
  };
}

describe("assimilation trust boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = 0;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.loadConfig.mockResolvedValue({
      verbose: false,
      instructions: true,
      singleAgent: false,
      cache: false,
      cacheTtlSeconds: 86400,
      outputSource: "default",
    });
    mocks.validateOutputPath.mockImplementation(
      async (root: string, output: string) => path.resolve(root, output),
    );
    mocks.localAnalyze.mockResolvedValue(makeAnalysis());
    mocks.remoteAnalyze.mockResolvedValue(makeAnalysis());
    mocks.generate.mockResolvedValue({
      files: [],
      hookFiles: [],
      agentFiles: [],
      skillFiles: [],
    });
    mocks.buildRegistry.mockResolvedValue(undefined);
    mocks.executeHooks.mockResolvedValue([]);
    mocks.cacheGet.mockResolvedValue(undefined);
    mocks.cacheSet.mockResolvedValue(undefined);
    mocks.createLocalSnapshot.mockImplementation(
      async (scanResult: ScanResult, computeDigests: boolean) =>
        createRepositorySnapshot(
          scanResult.rootPath,
          scanResult.files.map((file) => file.relativePath),
          {
            computeDigests,
            textByteLimits: new Map(
              scanResult.files.map((file) => [file.relativePath, 10_000]),
            ),
          },
        ),
    );
    mocks.resolveRevision.mockResolvedValue("a".repeat(40));
    mocks.getLicense.mockResolvedValue("MIT");
  });

  afterEach(async () => {
    process.exitCode = 0;
    vi.restoreAllMocks();
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        fs.rm(directory, { recursive: true, force: true })),
    );
  });

  it("blocks an unlicensed local repository before scanning or Copilot analysis even in dry-run", async () => {
    const root = await temporaryDirectory();

    await assimilateCommand(root, { dryRun: true });

    expect(process.exitCode).toBe(1);
    expect(mocks.scan).not.toHaveBeenCalled();
    expect(mocks.localAnalyze).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("blocks a non-permissive remote repository before Copilot analysis even in dry-run", async () => {
    mocks.getRepoInfo.mockResolvedValue({
      owner: "example",
      repo: "private-repo",
      defaultBranch: "main",
      license: "MIT",
    });
    mocks.getLicense.mockResolvedValue("Proprietary");

    await assimilateCommand(
      "https://github.com/example/private-repo",
      { dryRun: true },
    );

    expect(process.exitCode).toBe(1);
    expect(mocks.getRepoInfo).toHaveBeenCalledOnce();
    expect(mocks.resolveRevision).toHaveBeenCalledWith("main");
    expect(mocks.getLicense).toHaveBeenCalledWith("a".repeat(40));
    expect(mocks.remoteAnalyze).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("binds remote license approval and analysis to the same revision", async () => {
    const repoInfo = {
      owner: "example",
      repo: "public-repo",
      defaultBranch: "release/v1",
      license: "Proprietary",
    };
    const revision = "b".repeat(40);
    mocks.getRepoInfo.mockResolvedValue(repoInfo);
    mocks.resolveRevision.mockResolvedValue(revision);
    mocks.getLicense.mockResolvedValue("MIT");

    await assimilateCommand("https://github.com/example/public-repo", {});

    expect(mocks.resolveRevision).toHaveBeenCalledWith("release/v1");
    expect(mocks.getLicense).toHaveBeenCalledWith(revision);
    expect(mocks.remoteConstructor).toHaveBeenCalledWith(
      "https://github.com/example/public-repo",
      undefined,
      revision,
      { ...repoInfo, license: "MIT" },
    );
    expect(mocks.buildRegistry).toHaveBeenCalledWith(
      [],
      [],
      expect.objectContaining({ hookFiles: [], agentFiles: [], skillFiles: [] }),
    );
  });

  it("does not execute post-generate hooks without explicit opt-in", async () => {
    const root = await temporaryDirectory();
    await fs.writeFile(path.join(root, "LICENSE"), "MIT License", "utf-8");
    mocks.scan.mockResolvedValue(makeScan(root));

    await assimilateCommand(root, {});

    expect(process.exitCode).toBe(0);
    expect(mocks.localAnalyze).toHaveBeenCalledOnce();
    expect(mocks.executeHooks).not.toHaveBeenCalled();
  });

  it("executes post-generate hooks when --run-hooks is opted into", async () => {
    const root = await temporaryDirectory();
    const currentHook = {
      name: "current",
      event: "post-generate" as const,
      description: "Current-run hook",
      commands: ["node --version"],
    };
    await fs.writeFile(path.join(root, "LICENSE"), "MIT License", "utf-8");
    mocks.scan.mockResolvedValue(makeScan(root));
    mocks.localAnalyze.mockResolvedValue({
      ...makeAnalysis(),
      hooks: [currentHook],
    });
    mocks.generate.mockResolvedValue({
      files: [".github/hooks/current.yaml"],
      hookFiles: [".github/hooks/current.yaml"],
      agentFiles: [],
      skillFiles: [],
    });

    await assimilateCommand(root, { runHooks: true });

    expect(process.exitCode).toBe(0);
    expect(mocks.executeHooks).toHaveBeenCalledOnce();
    expect(mocks.executeHooks).toHaveBeenCalledWith(
      "post-generate",
      [currentHook],
    );
  });

  it("does not hash scanned files when the cache is disabled", async () => {
    const root = await temporaryDirectory();
    await fs.writeFile(path.join(root, "LICENSE"), "MIT License", "utf-8");
    const scan = makeScan(root);
    scan.files.push({
      path: path.join(root, "missing.ts"),
      relativePath: "missing.ts",
      extension: ".ts",
      size: 10,
      isTest: false,
      isConfig: false,
    });
    mocks.scan.mockResolvedValue(scan);

    await expect(assimilateCommand(root, { cache: false })).resolves.toBeUndefined();

    expect(mocks.createLocalSnapshot).toHaveBeenCalledWith(scan, false);
    expect(mocks.localAnalyze).toHaveBeenCalledOnce();
    expect(mocks.cacheGet).not.toHaveBeenCalled();
    expect(mocks.cacheSet).not.toHaveBeenCalled();
  });

  it("caches the exact immutable bytes analyzed even if the repository changes", async () => {
    const root = await temporaryDirectory();
    const sourcePath = path.join(root, "source.ts");
    await fs.writeFile(path.join(root, "LICENSE"), "MIT License", "utf-8");
    await fs.writeFile(sourcePath, "alpha", "utf-8");
    const scan = makeScan(root);
    scan.files.push({
      path: sourcePath,
      relativePath: "source.ts",
      extension: ".ts",
      size: 5,
      isTest: false,
      isConfig: false,
    });
    mocks.scan.mockResolvedValue(scan);
    mocks.loadConfig.mockResolvedValue({
      verbose: false,
      instructions: true,
      singleAgent: false,
      cache: true,
      cacheTtlSeconds: 86400,
      outputSource: "default",
    });
    mocks.localAnalyze.mockImplementationOnce(async (
      _scan: ScanResult,
      snapshot: {
        files: ReadonlyMap<string, { text?: string; digest?: string }>;
      },
    ) => {
      expect(snapshot.files.get("source.ts")?.text).toBe("alpha");
      expect(snapshot.files.get("source.ts")?.digest)
        .toMatch(/^[a-f0-9]{64}$/);
      await fs.writeFile(sourcePath, "bravo", "utf-8");
      expect(snapshot.files.get("source.ts")?.text).toBe("alpha");
      return makeAnalysis();
    });

    await assimilateCommand(root, {});

    expect(mocks.createLocalSnapshot).toHaveBeenCalledWith(scan, true);
    expect(mocks.localAnalyze).toHaveBeenCalledOnce();
    expect(mocks.cacheSet).toHaveBeenCalledOnce();
  });

  it("revalidates project-config output immediately before generation", async () => {
    const root = await temporaryDirectory();
    await fs.writeFile(path.join(root, "LICENSE"), "MIT License", "utf-8");
    mocks.scan.mockResolvedValue(makeScan(root));
    mocks.loadConfig.mockResolvedValue({
      verbose: false,
      instructions: true,
      singleAgent: false,
      cache: false,
      cacheTtlSeconds: 86400,
      output: "generated",
      outputSource: "project",
    });
    mocks.validateOutputPath.mockRejectedValueOnce(
      new Error("Output path cannot use symbolic links or junctions"),
    );

    await expect(assimilateCommand(root, {})).rejects.toThrow(
      "symbolic links or junctions",
    );

    expect(mocks.validateOutputPath).toHaveBeenCalledWith(
      root,
      "generated",
      true,
    );
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});
