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

const mocks = vi.hoisted(() => ({
  recordRun: vi.fn(),
  postRunSummary: vi.fn(),
}));

vi.mock("../../src/hub/recorder.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/hub/recorder.js")>();
  return {
    ...actual,
    ensureCoordinationChannels: vi.fn(),
    recordRun: mocks.recordRun,
    postRunSummary: mocks.postRunSummary,
  };
});

import { recordToHub } from "../../src/commands/assimilate.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
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

describe("AgentHub recording path boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        fs.rm(directory, { recursive: true, force: true })),
    );
  });

  it("rejects recording reads that escape through a symlink or junction", async () => {
    const outputPath = await temporaryDirectory("agentsmith-record-root-");
    const outsidePath = await temporaryDirectory("agentsmith-record-outside-");
    await fs.writeFile(path.join(outsidePath, "artifact.txt"), "outside", "utf-8");
    await fs.symlink(
      outsidePath,
      path.join(outputPath, "escaped"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await recordToHub(
      {} as never,
      makeAnalysis(),
      ["escaped/artifact.txt"],
      outputPath,
    );

    expect(mocks.recordRun).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("Refusing to record"),
    );
  });

  it("rejects recording a generated path hard-linked to an external file", async (context) => {
    const outputPath = await temporaryDirectory("agentsmith-record-root-");
    const outsidePath = await temporaryDirectory("agentsmith-record-outside-");
    const outsideFile = path.join(outsidePath, "external.txt");
    const generatedFile = path.join(outputPath, "artifact.txt");
    await fs.writeFile(outsideFile, "outside", "utf-8");
    try {
      await fs.link(outsideFile, generatedFile);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (["EACCES", "EPERM", "ENOTSUP", "EXDEV"].includes(code ?? "")) {
        context.skip();
        return;
      }
      throw error;
    }

    await recordToHub(
      {} as never,
      makeAnalysis(),
      ["artifact.txt"],
      outputPath,
    );

    expect(mocks.recordRun).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("Refusing to record hard-linked file"),
    );
  });
});
