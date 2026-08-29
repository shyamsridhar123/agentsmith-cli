import { CopilotClient } from "@github/copilot-sdk";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeCLIStructure } from "../../src/analyzer/cli.js";
import {
  Analyzer,
  createLocalAnalysisSnapshot,
} from "../../src/analyzer/local.js";
import {
  createRepositorySnapshot,
  type RepositorySnapshot,
  type ScanResult,
} from "../../src/scanner/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true }),
  ));
});

describe("Analyzer file sampling", () => {
  it("defensively excludes sensitive and generated paths from prompts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentsmith-local-security-"));
    temporaryDirectories.push(root);
    const paths = [
      ".env.production",
      ".npmrc",
      "config/deploy-token.txt",
      ".github/agents/root.agent.md",
      "src/index.ts",
    ];
    await Promise.all(paths.map(async (relativePath) => {
      const fullPath = path.join(root, relativePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, `content:${relativePath}`);
    }));

    const scanResult: ScanResult = {
      rootPath: root,
      files: await Promise.all(paths.map(async (relativePath) => {
        const fullPath = path.join(root, relativePath);
        const stat = await fs.stat(fullPath);
        return {
          path: fullPath,
          relativePath,
          extension: path.extname(relativePath),
          size: stat.size,
          isTest: false,
          isConfig: relativePath.startsWith("."),
        };
      })),
      language: "TypeScript",
      framework: null,
      configFiles: [".env.production", ".npmrc"],
      testFiles: [],
      sourceDirectories: ["src"],
      cliFramework: null,
      cliEntryFiles: [],
    };
    const analyzer = new Analyzer() as unknown as {
      gatherFileSamples(result: ScanResult): Promise<Map<string, string>>;
    };

    const samples = await analyzer.gatherFileSamples(scanResult);

    expect(Array.from(samples.keys())).toEqual(["src/index.ts"]);
  });

  it("does not follow repository symlinks or junctions during sampling", async ({ skip }) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentsmith-local-root-"));
    const external = await fs.mkdtemp(path.join(os.tmpdir(), "agentsmith-local-external-"));
    temporaryDirectories.push(root, external);
    const externalFile = path.join(external, "credentials.ts");
    await fs.writeFile(externalFile, "export const secret = 'do-not-read';");

    const linkedDirectory = path.join(root, "src");
    try {
      await fs.symlink(
        external,
        linkedDirectory,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        skip();
        return;
      }
      throw error;
    }

    const linkedFile = path.join(linkedDirectory, "credentials.ts");
    const stat = await fs.stat(linkedFile);
    const scanResult: ScanResult = {
      rootPath: root,
      files: [{
        path: linkedFile,
        relativePath: path.join("src", "credentials.ts"),
        extension: ".ts",
        size: stat.size,
        isTest: false,
        isConfig: false,
      }],
      language: "TypeScript",
      framework: null,
      configFiles: [],
      testFiles: [],
      sourceDirectories: ["src"],
      cliFramework: null,
      cliEntryFiles: [],
    };
    const analyzer = new Analyzer() as unknown as {
      gatherFileSamples(result: ScanResult): Promise<Map<string, string>>;
    };

    const samples = await analyzer.gatherFileSamples(scanResult);

    expect(samples.size).toBe(0);
  });

  it("uses immutable snapshot bytes after the repository file changes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentsmith-local-snapshot-"));
    temporaryDirectories.push(root);
    const sourcePath = path.join(root, "source.ts");
    await fs.writeFile(sourcePath, "alpha", "utf-8");
    const scanResult: ScanResult = {
      rootPath: root,
      files: [{
        path: sourcePath,
        relativePath: "source.ts",
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
    const snapshot = await createLocalAnalysisSnapshot(scanResult, false);
    await fs.writeFile(sourcePath, "bravo", "utf-8");
    const analyzer = new Analyzer() as unknown as {
      gatherFileSamples(
        result: ScanResult,
        repositorySnapshot: RepositorySnapshot,
      ): Promise<Map<string, string>>;
    };

    const samples = await analyzer.gatherFileSamples(scanResult, snapshot);

    expect(samples.get("source.ts")).toBe("alpha");
  });

  it("extracts CLI commands from the supplied immutable snapshot", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentsmith-local-cli-"));
    temporaryDirectories.push(root);
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    const packagePath = path.join(root, "package.json");
    const entryPath = path.join(root, "src", "main.ts");
    await fs.writeFile(packagePath, JSON.stringify({
      bin: { widget: "./src/main.ts" },
      dependencies: { commander: "^12.0.0" },
    }));
    await fs.writeFile(
      entryPath,
      'program.command("before").option("--safe").action(run);',
    );
    const scanResult: ScanResult = {
      rootPath: root,
      files: await Promise.all([
        ["package.json", packagePath, ".json", true] as const,
        ["src/main.ts", entryPath, ".ts", false] as const,
      ].map(async ([relativePath, filePath, extension, isConfig]) => ({
        path: filePath,
        relativePath,
        extension,
        size: (await fs.stat(filePath)).size,
        isTest: false,
        isConfig,
      }))),
      language: "TypeScript",
      framework: null,
      configFiles: ["package.json"],
      testFiles: [],
      sourceDirectories: ["src"],
      cliFramework: "commander",
      cliEntryFiles: ["src/main.ts"],
    };
    const snapshot = await createLocalAnalysisSnapshot(scanResult, false);
    await fs.writeFile(
      entryPath,
      'program.command("after").option("--changed").action(run);',
    );

    const cli = await analyzeCLIStructure(scanResult, snapshot);

    expect(cli?.commands.map((command) => command.name)).toContain("before");
    expect(cli?.commands.map((command) => command.name)).not.toContain("after");
  });

  it("uses snapshot size rather than stale scan metadata for sampling", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentsmith-local-size-"));
    temporaryDirectories.push(root);
    const sourcePath = path.join(root, "source.ts");
    await fs.writeFile(sourcePath, "alpha", "utf-8");
    const scanResult: ScanResult = {
      rootPath: root,
      files: [{
        path: sourcePath,
        relativePath: "source.ts",
        extension: ".ts",
        size: 20_000,
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
    const snapshot = await createLocalAnalysisSnapshot(scanResult, false);
    const analyzer = new Analyzer() as unknown as {
      gatherFileSamples(
        result: ScanResult,
        repositorySnapshot: RepositorySnapshot,
      ): Promise<Map<string, string>>;
    };

    const samples = await analyzer.gatherFileSamples(scanResult, snapshot);

    expect(samples.get("source.ts")).toBe("alpha");
  });

  it("retains only a bounded text prefix for large analyzed files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentsmith-local-bounded-"));
    temporaryDirectories.push(root);
    const sourcePath = path.join(root, "source.ts");
    await fs.writeFile(sourcePath, "x".repeat(2 * 1024 * 1024), "utf-8");
    const scanResult: ScanResult = {
      rootPath: root,
      files: [{
        path: sourcePath,
        relativePath: "source.ts",
        extension: ".ts",
        size: 2 * 1024 * 1024,
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

    const snapshot = await createLocalAnalysisSnapshot(scanResult, false);
    const snapshotFile = snapshot.files.get("source.ts");

    expect(snapshotFile?.digest).toBeUndefined();
    expect(snapshotFile?.text).toHaveLength(10_000);
    expect(snapshotFile?.textTruncated).toBe(true);
  });

  it("rejects repository files with multiple hard links", async ({ skip }) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentsmith-local-hardlink-"));
    temporaryDirectories.push(root);
    const sourcePath = path.join(root, "source.ts");
    const linkedPath = path.join(root, "linked.ts");
    await fs.writeFile(sourcePath, "export const value = 1;", "utf-8");
    try {
      await fs.link(sourcePath, linkedPath);
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      )) {
        skip();
        return;
      }
      throw error;
    }

    const snapshot = await createRepositorySnapshot(root, [
      "source.ts",
      "linked.ts",
    ]);

    expect(snapshot.files.size).toBe(0);
  });

  it("clears the response timeout when session.send rejects", async () => {
    vi.useFakeTimers();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentsmith-local-timer-"));
    temporaryDirectories.push(root);
    const session = {
      sessionId: "session-1",
      on: vi.fn(),
      send: vi.fn().mockRejectedValue(new Error("send failed")),
      disconnect: vi.fn(),
    };
    vi.spyOn(CopilotClient.prototype, "start").mockResolvedValue();
    vi.spyOn(CopilotClient.prototype, "createSession")
      .mockResolvedValue(session as never);
    vi.spyOn(CopilotClient.prototype, "deleteSession").mockResolvedValue();
    vi.spyOn(CopilotClient.prototype, "stop").mockResolvedValue();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const scanResult: ScanResult = {
      rootPath: root,
      files: [],
      language: "TypeScript",
      framework: null,
      configFiles: [],
      testFiles: [],
      sourceDirectories: [],
      cliFramework: null,
      cliEntryFiles: [],
    };

    await new Analyzer().analyze(scanResult);

    expect(session.send).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles and clears the timeout on a final message without idle", async () => {
    vi.useFakeTimers();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentsmith-local-final-"));
    temporaryDirectories.push(root);
    let listener: ((event: {
      type: string;
      data: Record<string, unknown>;
    }) => void) | undefined;
    const session = {
      sessionId: "session-1",
      on: vi.fn((callback) => {
        listener = callback;
      }),
      send: vi.fn(async () => {
        listener?.({
          type: "assistant.message",
          data: {
            content: JSON.stringify({
              skills: [],
              agents: [],
              hooks: [],
              summary: "done",
            }),
          },
        });
      }),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(CopilotClient.prototype, "start").mockResolvedValue();
    vi.spyOn(CopilotClient.prototype, "createSession")
      .mockResolvedValue(session as never);
    vi.spyOn(CopilotClient.prototype, "deleteSession").mockResolvedValue();
    vi.spyOn(CopilotClient.prototype, "stop").mockResolvedValue();
    const scanResult: ScanResult = {
      rootPath: root,
      files: [],
      language: "TypeScript",
      framework: null,
      configFiles: [],
      testFiles: [],
      sourceDirectories: [],
      cliFramework: null,
      cliEntryFiles: [],
    };

    await new Analyzer().analyze(scanResult);

    expect(session.disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
