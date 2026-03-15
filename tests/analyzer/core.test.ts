/**
 * Tests for src/analyzer/core.ts
 * Shared analyzer utility functions.
 */

import { describe, it, expect } from "vitest";
import {
  flattenAgents,
  normalizeTools,
  extractAllTools,
  detectDomainBoundaries,
  generateDefaultHooks,
  detectToolsFromConfig,
  parseAnalysisResponse,
} from "../../src/analyzer/core.js";
import type { AgentDefinition } from "../../src/analyzer/types.js";

// ---------------------------------------------------------------------------
// flattenAgents
// ---------------------------------------------------------------------------

describe("flattenAgents", () => {
  it("returns an empty array when given an empty array", () => {
    expect(flattenAgents([])).toEqual([]);
  });

  it("passes through flat agents unchanged", () => {
    const agents = [
      { name: "root", description: "Root agent", skills: ["s1"], tools: [], triggers: ["root"] },
    ];
    const result = flattenAgents(agents);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("root");
    expect(result[0].isSubAgent).toBe(false);
  });

  it("flattens nested sub-agent objects into separate entries", () => {
    const agents = [
      {
        name: "root",
        description: "Root",
        skills: [],
        tools: [],
        triggers: [],
        subAgents: [
          { name: "child", description: "Child agent", skills: [], tools: [], triggers: [] },
        ],
      },
    ];
    const result = flattenAgents(agents);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("root");
    expect(result[0].subAgents).toEqual(["child"]);
    expect(result[1].name).toBe("child");
    expect(result[1].isSubAgent).toBe(true);
    expect(result[1].parentAgent).toBe("root");
  });

  it("handles mixed string and object subAgents", () => {
    const agents = [
      {
        name: "root",
        description: "Root",
        skills: [],
        tools: [],
        triggers: [],
        subAgents: [
          "string-ref",
          { name: "object-child", description: "Child", skills: [], tools: [], triggers: [] },
        ],
      },
    ];
    const result = flattenAgents(agents);
    expect(result).toHaveLength(2);
    expect(result[0].subAgents).toEqual(["string-ref", "object-child"]);
    expect(result[1].name).toBe("object-child");
  });

  it("handles deeply nested sub-agents", () => {
    const agents = [
      {
        name: "root",
        description: "",
        skills: [],
        tools: [],
        triggers: [],
        subAgents: [
          {
            name: "level1",
            description: "",
            skills: [],
            tools: [],
            triggers: [],
            subAgents: [
              { name: "level2", description: "", skills: [], tools: [], triggers: [] },
            ],
          },
        ],
      },
    ];
    const result = flattenAgents(agents);
    expect(result).toHaveLength(3);
    expect(result.map((a) => a.name)).toEqual(["root", "level1", "level2"]);
    expect(result[2].parentAgent).toBe("level1");
  });

  it("skips null and non-object entries", () => {
    const agents = [null, undefined, "not-an-object", 42, { name: "valid", description: "ok" }];
    const result = flattenAgents(agents as unknown[]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("valid");
  });

  it("defaults name to 'unknown' when not provided", () => {
    const agents = [{ description: "No name" }];
    const result = flattenAgents(agents as unknown[]);
    expect(result[0].name).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// normalizeTools
// ---------------------------------------------------------------------------

describe("normalizeTools", () => {
  it("returns empty array for null input", () => {
    expect(normalizeTools(null)).toEqual([]);
  });

  it("returns empty array for undefined input", () => {
    expect(normalizeTools(undefined)).toEqual([]);
  });

  it("returns empty array for empty array", () => {
    expect(normalizeTools([])).toEqual([]);
  });

  it("normalizes string tools", () => {
    const result = normalizeTools(["npm install", "npm test"]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      name: "npm",
      command: "npm install",
      description: "npm install",
    });
  });

  it("normalizes object tools", () => {
    const result = normalizeTools([
      { name: "build", command: "npm run build", description: "Build the project" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "build",
      command: "npm run build",
      description: "Build the project",
    });
  });

  it("normalizes mixed string and object tools", () => {
    const result = normalizeTools([
      "npm test",
      { name: "lint", command: "eslint .", description: "Lint code" },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("npm");
    expect(result[1].name).toBe("lint");
  });

  it("handles object tools with missing fields", () => {
    const result = normalizeTools([{ name: "deploy" }]);
    expect(result[0]).toEqual({
      name: "deploy",
      command: "deploy",
      description: "deploy",
    });
  });

  it("handles non-string, non-object tool entries", () => {
    const result = normalizeTools([42]);
    expect(result[0]).toEqual({
      name: "unknown",
      command: "42",
      description: "42",
    });
  });
});

// ---------------------------------------------------------------------------
// extractAllTools
// ---------------------------------------------------------------------------

describe("extractAllTools", () => {
  it("returns empty array when no agents have tools", () => {
    const agents: AgentDefinition[] = [
      { name: "a", description: "", skills: [], tools: [], isSubAgent: false, triggers: [] },
    ];
    expect(extractAllTools(agents)).toEqual([]);
  });

  it("returns empty array for empty agents array", () => {
    expect(extractAllTools([])).toEqual([]);
  });

  it("extracts tools from multiple agents", () => {
    const agents: AgentDefinition[] = [
      {
        name: "a",
        description: "",
        skills: [],
        tools: [{ name: "build", command: "npm build", description: "Build" }],
        isSubAgent: false,
        triggers: [],
      },
      {
        name: "b",
        description: "",
        skills: [],
        tools: [{ name: "test", command: "npm test", description: "Test" }],
        isSubAgent: false,
        triggers: [],
      },
    ];
    const result = extractAllTools(agents);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("build");
    expect(result[1].name).toBe("test");
  });
});

// ---------------------------------------------------------------------------
// detectDomainBoundaries
// ---------------------------------------------------------------------------

describe("detectDomainBoundaries", () => {
  it("returns empty array for empty file list", () => {
    expect(detectDomainBoundaries([], "/")).toEqual([]);
  });

  it("returns empty array when fewer than 6 files per domain", () => {
    const files = [
      { relativePath: "api/file1.ts", isTest: false, isConfig: false },
      { relativePath: "api/file2.ts", isTest: false, isConfig: false },
    ];
    expect(detectDomainBoundaries(files, "/")).toEqual([]);
  });

  it("detects domains with more than 5 files matching domain patterns", () => {
    const files = Array.from({ length: 10 }, (_, i) => ({
      relativePath: `services/module${i}/index.ts`,
      isTest: false,
      isConfig: false,
    }));
    const result = detectDomainBoundaries(files, "/");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("services");
    expect(result[0].fileCount).toBe(10);
  });

  it("excludes test and config files from domain detection", () => {
    const files = Array.from({ length: 10 }, (_, i) => ({
      relativePath: `api/test${i}.ts`,
      isTest: true,
      isConfig: false,
    }));
    expect(detectDomainBoundaries(files, "/")).toEqual([]);
  });

  it("handles backslash path separators", () => {
    const files = Array.from({ length: 10 }, (_, i) => ({
      relativePath: `utils\\file${i}.ts`,
      isTest: false,
      isConfig: false,
    }));
    const result = detectDomainBoundaries(files, "\\");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("utils");
  });

  it("sorts domains by file count descending", () => {
    const apiFiles = Array.from({ length: 8 }, (_, i) => ({
      relativePath: `api/file${i}.ts`,
      isTest: false,
      isConfig: false,
    }));
    const utilFiles = Array.from({ length: 12 }, (_, i) => ({
      relativePath: `utils/file${i}.ts`,
      isTest: false,
      isConfig: false,
    }));
    const result = detectDomainBoundaries([...apiFiles, ...utilFiles], "/");
    expect(result[0].name).toBe("utils");
    expect(result[1].name).toBe("api");
  });

  it("ignores files at root level (no directory)", () => {
    const files = [
      { relativePath: "README.md", isTest: false, isConfig: false },
    ];
    expect(detectDomainBoundaries(files, "/")).toEqual([]);
  });

  it("only includes directories that match domain patterns", () => {
    const files = Array.from({ length: 10 }, (_, i) => ({
      relativePath: `custom-not-a-pattern/file${i}.ts`,
      isTest: false,
      isConfig: false,
    }));
    expect(detectDomainBoundaries(files, "/")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// generateDefaultHooks
// ---------------------------------------------------------------------------

describe("generateDefaultHooks", () => {
  it("generates TypeScript hooks with tests", () => {
    const hooks = generateDefaultHooks("TypeScript", true);
    expect(hooks).toHaveLength(3); // pre-commit, pre-push, post-generate
    expect(hooks[0].name).toBe("pre-commit-quality");
    expect(hooks[0].commands).toContain("npm run lint");
    expect(hooks[1].name).toBe("pre-push-tests");
    expect(hooks[1].commands).toContain("npm test");
    expect(hooks[2].name).toBe("post-generate-validate");
  });

  it("generates TypeScript hooks without tests", () => {
    const hooks = generateDefaultHooks("TypeScript", false);
    expect(hooks).toHaveLength(2); // pre-commit + post-generate only
    expect(hooks.find((h) => h.name === "pre-push-tests")).toBeUndefined();
  });

  it("generates JavaScript hooks (same as TypeScript)", () => {
    const hooks = generateDefaultHooks("JavaScript", true);
    expect(hooks).toHaveLength(3);
    expect(hooks[0].commands).toContain("npm run lint");
  });

  it("generates Python hooks with tests", () => {
    const hooks = generateDefaultHooks("Python", true);
    expect(hooks).toHaveLength(3);
    expect(hooks[0].commands).toContain("ruff check .");
    expect(hooks[1].commands).toContain("pytest");
  });

  it("generates Python hooks without tests", () => {
    const hooks = generateDefaultHooks("Python", false);
    expect(hooks).toHaveLength(2);
  });

  it("generates Go hooks with tests", () => {
    const hooks = generateDefaultHooks("Go", true);
    expect(hooks).toHaveLength(3);
    expect(hooks[0].commands).toContain("golangci-lint run");
    expect(hooks[1].commands).toContain("go test ./...");
  });

  it("generates Go hooks without tests", () => {
    const hooks = generateDefaultHooks("Go", false);
    expect(hooks).toHaveLength(2);
  });

  it("generates only post-generate hook for unknown language", () => {
    const hooks = generateDefaultHooks("Rust", false);
    expect(hooks).toHaveLength(1);
    expect(hooks[0].name).toBe("post-generate-validate");
  });

  it("always includes post-generate-validate hook", () => {
    for (const lang of ["TypeScript", "Python", "Go", "Unknown"]) {
      const hooks = generateDefaultHooks(lang, false);
      expect(hooks[hooks.length - 1].name).toBe("post-generate-validate");
    }
  });
});

// ---------------------------------------------------------------------------
// detectToolsFromConfig
// ---------------------------------------------------------------------------

describe("detectToolsFromConfig", () => {
  it("detects npm tools for TypeScript with package.json", () => {
    const tools = detectToolsFromConfig("TypeScript", ["package.json"]);
    expect(tools).toHaveLength(4);
    expect(tools.map((t) => t.name)).toEqual(["install", "build", "test", "lint"]);
  });

  it("detects npm tools for JavaScript with package.json", () => {
    const tools = detectToolsFromConfig("JavaScript", ["package.json"]);
    expect(tools).toHaveLength(4);
  });

  it("returns empty for TypeScript without package.json", () => {
    const tools = detectToolsFromConfig("TypeScript", ["tsconfig.json"]);
    expect(tools).toEqual([]);
  });

  it("detects Python tools", () => {
    const tools = detectToolsFromConfig("Python", []);
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name)).toEqual(["install", "test", "lint"]);
    expect(tools[0].command).toBe("pip install -e .");
  });

  it("detects Go tools", () => {
    const tools = detectToolsFromConfig("Go", []);
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name)).toEqual(["build", "test", "lint"]);
    expect(tools[0].command).toBe("go build ./...");
  });

  it("returns empty for unknown language", () => {
    const tools = detectToolsFromConfig("Rust", []);
    expect(tools).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseAnalysisResponse
// ---------------------------------------------------------------------------

describe("parseAnalysisResponse", () => {
  const fallback = () => ({ skills: [], agents: [], hooks: [], summary: "fallback" });

  it("parses valid JSON response", () => {
    const json = JSON.stringify({
      skills: [{ name: "s1", description: "Skill one" }],
      agents: [{ name: "a1" }],
      hooks: [],
      summary: "A repo",
    });
    const result = parseAnalysisResponse(json, fallback);
    expect(result.skills).toHaveLength(1);
    expect(result.agents).toHaveLength(1);
    expect(result.summary).toBe("A repo");
  });

  it("extracts JSON embedded in markdown", () => {
    const response = `Here is the analysis:
\`\`\`json
{
  "skills": [{"name": "embedded", "description": "An embedded skill"}],
  "agents": [],
  "hooks": [],
  "summary": "embedded"
}
\`\`\`
That's the result.`;
    const result = parseAnalysisResponse(response, fallback);
    expect(result.skills).toHaveLength(1);
    expect((result.skills[0] as { name: string }).name).toBe("embedded");
  });

  it("calls fallback when no JSON is found", () => {
    const result = parseAnalysisResponse("No JSON here at all", fallback);
    expect(result.summary).toBe("fallback");
  });

  it("calls fallback for invalid JSON", () => {
    const result = parseAnalysisResponse("{invalid json!!!}", fallback);
    expect(result.summary).toBe("fallback");
  });

  it("defaults missing arrays to empty", () => {
    const result = parseAnalysisResponse('{"summary": "test"}', fallback);
    expect(result.skills).toEqual([]);
    expect(result.agents).toEqual([]);
    expect(result.hooks).toEqual([]);
  });

  it("defaults missing summary to empty string", () => {
    const result = parseAnalysisResponse('{"skills": []}', fallback);
    expect(result.summary).toBe("");
  });
});
