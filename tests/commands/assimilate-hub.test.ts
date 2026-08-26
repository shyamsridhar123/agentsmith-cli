import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AnalysisResult } from "../../src/analyzer/types.js";

const mocks = vi.hoisted(() => ({
  fromConfigFile: vi.fn(),
  ensureCoordinationChannels: vi.fn(),
  recordRun: vi.fn(),
  postRunSummary: vi.fn(),
}));

vi.mock("../../src/hub/client.js", () => ({
  HubClient: class {
    static fromConfigFile = mocks.fromConfigFile;
  },
  normalizeHubServerUrl: (value: string) => value.replace(/\/+$/, ""),
}));

vi.mock("../../src/hub/recorder.js", () => ({
  ensureCoordinationChannels: mocks.ensureCoordinationChannels,
  recordRun: mocks.recordRun,
  postRunSummary: mocks.postRunSummary,
}));

import {
  prepareHub,
  recordToHub,
} from "../../src/commands/assimilate.js";

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

describe("assimilate AgentHub integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = 0;
  });

  afterEach(() => {
    process.exitCode = 0;
    vi.restoreAllMocks();
  });

  it("degrades gracefully when AgentHub setup fails", async () => {
    mocks.fromConfigFile.mockRejectedValueOnce(new Error("offline"));
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      prepareHub("test-repo", { hub: "http://hub:8080" }),
    ).resolves.toBeUndefined();

    expect(process.exitCode).toBe(0);
    expect(mocks.ensureCoordinationChannels).not.toHaveBeenCalled();
  });

  it("uses a bounded setup client and provisions channels", async () => {
    const client = {
      health: vi.fn().mockResolvedValue({ status: "ok" }),
    };
    mocks.fromConfigFile.mockResolvedValueOnce(client);
    mocks.ensureCoordinationChannels.mockResolvedValueOnce([
      "test-repo-results",
    ]);

    await expect(
      prepareHub("test-repo", {
        hub: "http://hub:8080",
        verbose: true,
      }),
    ).resolves.toBe(client);

    expect(mocks.fromConfigFile).toHaveBeenCalledWith(
      "http://hub:8080",
      { timeoutMs: 5_000, maxRetries: 1 },
    );
    expect(mocks.ensureCoordinationChannels).toHaveBeenCalledWith(
      "test-repo",
      client,
    );
  });

  it("keeps recording available when channel setup fails", async () => {
    const client = {
      health: vi.fn().mockResolvedValue({ status: "ok" }),
    };
    mocks.fromConfigFile.mockResolvedValueOnce(client);
    mocks.ensureCoordinationChannels.mockRejectedValueOnce(
      new Error("channel unavailable"),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      prepareHub("test-repo", { hub: "http://hub:8080" }),
    ).resolves.toBe(client);
  });

  it("records generated files when the optional registry is absent", async () => {
    const outputPath = await mkdtemp(join(tmpdir(), "agentsmith-record-test-"));
    try {
      await writeFile(join(outputPath, "artifact.txt"), "generated", "utf-8");
      mocks.recordRun.mockResolvedValueOnce({
        success: true,
        commitHash: "abc123",
      });
      mocks.postRunSummary.mockResolvedValueOnce(true);
      vi.spyOn(console, "log").mockImplementation(() => {});

      await recordToHub(
        {} as never,
        makeAnalysis(),
        ["artifact.txt"],
        outputPath,
      );

      const recordedFiles = mocks.recordRun.mock.calls[0][1] as Map<string, string>;
      expect(recordedFiles.get("artifact.txt")).toBe("generated");
      expect(recordedFiles.has("skills-registry.jsonl")).toBe(false);
    } finally {
      await rm(outputPath, { recursive: true, force: true });
    }
  });
});
