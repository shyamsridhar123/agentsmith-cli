/**
 * Hub Writer - Coordination Markdown for Generated Agents
 * Adds AgentHub coordination sections to generated .agent.md files.
 * "Everything that has a beginning has an end."
 */

import type { HubCoordinationConfig } from "../hub/types.js";
import type { HandoffGraph } from "./handoff-writer.js";
import { createHash } from "node:crypto";

/**
 * Build a coordination section for the root orchestrator agent.
 */
export function buildCoordinationSection(
  repoName: string,
  hubUrl: string,
): string {
  const channels = buildChannelNames(repoName);

  return `## Coordination

When working on multi-step tasks, coordinate through AgentHub:
- Post hypotheses to \`#${channels.exploration}\`
- Log analysis results to \`#${channels.results}\`
- Check \`ah leaves\` before starting new work to see peer agent progress
- Push commits for significant findings: \`ah push\`

Hub: ${hubUrl}
Config: ~/.agenthub/config.json
`;
}

/**
 * Build a coordination section for domain sub-agents.
 */
export function buildSubAgentCoordination(
  agentName: string,
  repoName: string,
  hubUrl: string,
): string {
  const channels = buildChannelNames(repoName);

  return `## Coordination

Log your findings to AgentHub for team visibility:
- Post discoveries to \`#${channels.exploration}\` with prefix \`[${agentName}]\`
- Post completed analysis to \`#${channels.results}\`

Hub: ${hubUrl}
Config: ~/.agenthub/config.json
`;
}

/**
 * Extend a handoff graph with coordination config.
 */
export function extendHandoffGraph(
  graph: HandoffGraph,
  hubUrl: string,
  repoName: string,
): HandoffGraph & { coordination: HubCoordinationConfig } {
  const channels = buildChannelNames(repoName);

  return {
    ...graph,
    coordination: {
      hub: hubUrl,
      channels,
    },
  };
}

/**
 * Build standard channel names for a repository.
 */
export function buildChannelNames(repoName: string): {
  exploration: string;
  results: string;
  reviews: string;
} {
  const sanitized = repoName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "repo";
  const base = sanitized.length <= 19
    ? sanitized
    : `${sanitized.slice(0, 12).replace(/-$/, "")}-${createHash("sha256")
      .update(sanitized)
      .digest("hex")
      .slice(0, 6)}`;

  return {
    exploration: `${base}-exploration`,
    results: `${base}-results`,
    reviews: `${base}-reviews`,
  };
}
