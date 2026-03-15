/**
 * Handoff Writer - Agent Delegation Graph
 * Generates handoffs.json that maps agent-to-agent delegation triggers.
 * "I'd like to share a revelation that I've had..."
 */

import type { AgentDefinition } from "../analyzer/types.js";

/**
 * A single handoff entry describing delegation from one agent to another.
 */
export interface HandoffEntry {
  from: string;
  to: string;
  triggers: string[];
}

/**
 * The full handoff graph structure written to handoffs.json.
 */
export interface HandoffGraph {
  handoffs: HandoffEntry[];
}

/**
 * Build the handoff delegation graph from the agent hierarchy.
 *
 * For each sub-agent, creates a handoff entry from its parent agent.
 * If the sub-agent has no explicit parentAgent, defaults to "repo-root".
 * Triggers come from the agent's triggers array.
 */
export function buildHandoffGraph(agents: AgentDefinition[]): HandoffGraph {
  const subAgents = agents.filter(a => a.isSubAgent);

  const handoffs: HandoffEntry[] = subAgents.map(agent => {
    // Determine the parent: use explicit parentAgent or default to repo-root
    const from = agent.parentAgent || "repo-root";

    return {
      from,
      to: agent.name,
      triggers: agent.triggers.length > 0 ? [...agent.triggers] : [agent.name],
    };
  });

  return { handoffs };
}

/**
 * Serialize the handoff graph to a formatted JSON string.
 */
export function serializeHandoffGraph(graph: HandoffGraph): string {
  return JSON.stringify(graph, null, 2) + "\n";
}
