import { describe, expect, it } from "vitest";
import { buildRootAgentMd, buildSubAgentMd } from "../../src/generator/agent-writer.js";
import { buildMainAgentMd } from "../../src/generator/legacy-writer.js";
import type { AgentDefinition, AnalysisResult } from "../../src/analyzer/types.js";

const helpers = {
  toTitleCase: (value: unknown) =>
    String(value).split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" "),
  quoteYamlValue: (value: string) => value,
};

const apiAgent: AgentDefinition = {
  name: "api-agent",
  description: "API routes",
  skills: [],
  tools: [],
  isSubAgent: true,
  parentAgent: "root",
  triggers: [],
};

const analysis: AnalysisResult = {
  repoName: "demo",
  skills: [],
  agents: [apiAgent],
  tools: [],
  hooks: [],
  summary: "",
};

function heading(content: string): string | undefined {
  return content.match(/^# .+$/m)?.[0];
}

describe("agent headings", () => {
  it("add Agent only when the name does not already end in it", () => {
    expect(heading(buildSubAgentMd(apiAgent, [], helpers))).toBe("# Api Agent");
    expect(heading(buildMainAgentMd(analysis, "support-agent", helpers))).toBe("# Support Agent");
    expect(heading(buildRootAgentMd(analysis, "demo-root", helpers))).toBe("# Demo Root Agent");
  });
});

describe("root agent delegation", () => {
  it("puts one period between a sub-agent description and its triggers", () => {
    const agents = [
      { ...apiAgent, description: "Owns the API routes.", triggers: ["api"] },
      { ...apiAgent, name: "ui-agent", description: "Owns the UI" },
    ];
    const content = buildRootAgentMd({ ...analysis, agents }, "demo-root", helpers);

    expect(content).toContain("- **@api-agent** — Owns the API routes. Triggers: api");
    expect(content).toContain("- **@ui-agent** — Owns the UI. Triggers: general");
  });
});
