/**
 * Tests for src/hub/recorder.ts
 * Run provenance recording to AgentHub.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  ensureCoordinationChannels,
  recordRun,
  postRunSummary,
} from "../../src/hub/recorder.js";
import type { AnalysisResult } from "../../src/analyzer/types.js";

// Mock child_process
const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
  mkdtemp: vi.fn().mockResolvedValue("/tmp/agentsmith-record-abc123"),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(Buffer.from("fake-bundle-data")),
}));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GIT_DIR = "caller-repository";
  execFileMock.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      _options: object,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      callback(null, "", "");
    },
  );
});

afterEach(() => {
  delete process.env.GIT_DIR;
});

// --- Helpers ---

function makeAnalysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    repoName: "test-repo",
    summary: "A test repository",
    skills: [
      {
        name: "test-skill",
        description: "A test skill",
        triggers: ["test"],
        patterns: [],
        examples: [],
        category: "patterns",
        sourceDir: "src",
      },
    ],
    agents: [
      {
        name: "test-agent",
        description: "A test agent",
        skills: ["test-skill"],
        triggers: ["test"],
        tools: [],
        isSubAgent: false,
      },
    ],
    hooks: [],
    ...overrides,
  };
}

function makeMockClient() {
  return {
    pushBundle: vi.fn().mockResolvedValue({ hashes: ["abc123def456"] }),
    post: vi.fn().mockResolvedValue({ id: 1 }),
    createChannel: vi.fn().mockResolvedValue({ id: 1, name: "test" }),
    listChannels: vi.fn().mockResolvedValue([]),
    health: vi.fn().mockResolvedValue({ status: "ok" }),
  } as any;
}

// --- Tests ---

describe("recordRun", () => {
  it("records files and returns success with commit hash", async () => {
    const analysis = makeAnalysis();
    const files = new Map([
      [".github/agents/test.agent.md", "# Test Agent"],
      [".github/skills/test/SKILL.md", "# Test Skill"],
    ]);
    const client = makeMockClient();

    const result = await recordRun(analysis, files, client);

    expect(result.success).toBe(true);
    expect(result.commitHash).toBe("abc123def456");
    expect(client.pushBundle).toHaveBeenCalledOnce();

    const [bundle] = client.pushBundle.mock.calls[0];
    expect(bundle).toEqual(Buffer.from("fake-bundle-data"));
    expect(execFileMock).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["init"]),
      expect.objectContaining({
        env: expect.objectContaining({
          GIT_CONFIG_NOSYSTEM: "1",
        }),
      }),
      expect.any(Function),
    );
    const gitEnvironment = execFileMock.mock.calls[0][2].env;
    expect(gitEnvironment.GIT_DIR).toBeUndefined();
  });

  it("returns error result when pushBundle fails", async () => {
    const client = makeMockClient();
    client.pushBundle.mockRejectedValueOnce(new Error("Network error"));

    const result = await recordRun(
      makeAnalysis(),
      new Map([[".github/agents/test.agent.md", "# Test"]]),
      client,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Network error");
  });

  it("rejects an empty file map", async () => {
    const client = makeMockClient();

    const result = await recordRun(makeAnalysis(), new Map(), client);

    expect(result.success).toBe(false);
    expect(result.error).toContain("No generated files");
    expect(client.pushBundle).not.toHaveBeenCalled();
  });

  it("rejects paths outside the temporary run directory", async () => {
    const client = makeMockClient();

    const result = await recordRun(
      makeAnalysis(),
      new Map([["../escaped.txt", "nope"]]),
      client,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("outside the run directory");
    expect(client.pushBundle).not.toHaveBeenCalled();
  });
});

describe("ensureCoordinationChannels", () => {
  it("creates only missing coordination channels", async () => {
    const client = makeMockClient();
    client.listChannels.mockResolvedValueOnce([
      { id: 1, name: "test-repo-results" },
    ]);

    const created = await ensureCoordinationChannels("test-repo", client);

    expect(created).toEqual([
      "test-repo-exploration",
      "test-repo-reviews",
    ]);
    expect(client.createChannel).toHaveBeenCalledTimes(2);
  });
});

describe("postRunSummary", () => {
  it("posts a structured summary to the channel", async () => {
    const client = makeMockClient();
    const analysis = makeAnalysis();

    const posted = await postRunSummary(analysis, "test-results", client, "abc123");

    expect(posted).toBe(true);
    expect(client.post).toHaveBeenCalledOnce();

    const [channel, content] = client.post.mock.calls[0];
    expect(channel).toBe("test-results");
    expect(content).toContain("test-repo");
    expect(content).toContain("abc123");
    expect(content).toContain("Skills:");
  });

  it("returns false when post fails", async () => {
    const client = makeMockClient();
    client.post.mockRejectedValueOnce(new Error("Channel not found"));

    const posted = await postRunSummary(makeAnalysis(), "bad-channel", client);

    expect(posted).toBe(false);
  });

  it("includes repo metadata in summary when available", async () => {
    const client = makeMockClient();
    const analysis = makeAnalysis({
      repo: {
        language: "TypeScript",
        framework: "Express",
        license: "MIT",
        topics: [],
        description: "",
      },
    });

    await postRunSummary(analysis, "results", client, "hash");

    const content = client.post.mock.calls[0][1];
    expect(content).toContain("TypeScript");
    expect(content).toContain("Express");
    expect(content).toContain("MIT");
  });

  it("escapes markdown special characters in summary", async () => {
    const client = makeMockClient();
    const analysis = makeAnalysis({
      repoName: "repo*with_special`chars",
      summary: "Has [links](url) and *bold*",
    });

    await postRunSummary(analysis, "results", client, "hash");

    const content = client.post.mock.calls[0][1] as string;
    // Dangerous markdown chars should be escaped
    expect(content).toContain("\\*");
    expect(content).toContain("\\`");
    expect(content).toContain("\\_");
  });
});
