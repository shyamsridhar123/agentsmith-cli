/**
 * Tests for src/generator/hub-writer.ts
 * Coordination markdown generation and handoff graph extension.
 */

import { describe, it, expect } from "vitest";
import {
  buildCoordinationSection,
  buildSubAgentCoordination,
  extendHandoffGraph,
  buildChannelNames,
} from "../../src/generator/hub-writer.js";
import type { HandoffGraph } from "../../src/generator/handoff-writer.js";

// --- Tests ---

describe("buildChannelNames", () => {
  it("sanitizes repo name for channel names", () => {
    const ch = buildChannelNames("My Repo");
    expect(ch.exploration).toBe("my-repo-exploration");
    expect(ch.results).toBe("my-repo-results");
    expect(ch.reviews).toBe("my-repo-reviews");
  });

  it("handles special characters", () => {
    const ch = buildChannelNames("@user/repo-name!");
    expect(ch.exploration).toBe("user-repo-name-exploration");
  });

  it("collapses multiple dashes", () => {
    const ch = buildChannelNames("my---weird---repo");
    expect(ch.exploration).toBe("my-weird-repo-exploration");
  });

  it("keeps every generated channel within AgentHub's 31-char limit", () => {
    const ch = buildChannelNames("a-very-long-repository-name-that-exceeds-limits");
    expect(Object.values(ch).every((name) => name.length <= 31)).toBe(true);
    expect(ch.exploration.replace("-exploration", "").length).toBeLessThanOrEqual(19);
  });

  it("keeps long repository names distinct after truncation", () => {
    const gateway = buildChannelNames("payments-service-api-gateway");
    const worker = buildChannelNames("payments-service-api-worker");

    expect(gateway.results).not.toBe(worker.results);
  });

  it("strips leading and trailing dashes", () => {
    const ch = buildChannelNames("-leading-trailing-");
    expect(ch.exploration).toBe("leading-trailing-exploration");
  });

  it("uses a valid fallback for names without alphanumeric characters", () => {
    const ch = buildChannelNames("@@@");
    expect(ch.exploration).toBe("repo-exploration");
  });
});

describe("buildCoordinationSection", () => {
  it("generates markdown with hub URL and channel names", () => {
    const section = buildCoordinationSection("my-repo", "http://hub:8080");

    expect(section).toContain("## Coordination");
    expect(section).toContain("http://hub:8080");
    expect(section).toContain("#my-repo-exploration");
    expect(section).toContain("#my-repo-results");
    expect(section).toContain("ah leaves");
    expect(section).toContain("ah push");
  });
});

describe("buildSubAgentCoordination", () => {
  it("generates sub-agent coordination with agent name prefix", () => {
    const section = buildSubAgentCoordination("backend-agent", "my-repo", "http://hub:8080");

    expect(section).toContain("## Coordination");
    expect(section).toContain("[backend-agent]");
    expect(section).toContain("http://hub:8080");
    expect(section).toContain("#my-repo-exploration");
    expect(section).toContain("#my-repo-results");
  });
});

describe("extendHandoffGraph", () => {
  it("adds coordination config to an existing handoff graph", () => {
    const graph: HandoffGraph = {
      handoffs: [
        { from: "root", to: "backend", triggers: ["api", "database"] },
      ],
    };

    const extended = extendHandoffGraph(graph, "http://hub:8080", "my-repo");

    // Original handoffs preserved
    expect(extended.handoffs).toHaveLength(1);
    expect(extended.handoffs[0].from).toBe("root");

    // Coordination config added
    expect(extended.coordination).toBeDefined();
    expect(extended.coordination.hub).toBe("http://hub:8080");
    expect(extended.coordination.channels.exploration).toBe("my-repo-exploration");
    expect(extended.coordination.channels.results).toBe("my-repo-results");
    expect(extended.coordination.channels.reviews).toBe("my-repo-reviews");
  });

  it("handles empty handoff graph", () => {
    const graph: HandoffGraph = { handoffs: [] };

    const extended = extendHandoffGraph(graph, "http://hub:9090", "empty-repo");

    expect(extended.handoffs).toHaveLength(0);
    expect(extended.coordination.hub).toBe("http://hub:9090");
  });
});
