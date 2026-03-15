/**
 * Agent Writer - Multi-Agent Constellation Builder
 * Builds .agent.md content for root orchestrator and domain-specific sub-agents.
 * "More of me..."
 */

import type { AgentDefinition, SkillDefinition, AnalysisResult } from "../analyzer/types.js";

/**
 * VS Code built-in tools available to agents.
 * Root agents additionally get `runSubagent` for delegation.
 */
const BASE_TOOLS = [
  "codebase",
  "textSearch",
  "fileSearch",
  "readFile",
  "listDirectory",
  "usages",
  "problems",
  "fetch",
  "githubRepo",
  "editFiles",
  "createFile",
  "createDirectory",
  "runInTerminal",
  "terminalLastCommand",
  "changes",
];

/**
 * Build the .agent.md content for a root orchestrator agent.
 * Includes `runSubagent` in tools and delegation instructions for each sub-agent.
 */
export function buildRootAgentMd(
  analysis: AnalysisResult,
  agentName: string,
  helpers: { toTitleCase: (s: string | unknown) => string; quoteYamlValue: (s: string) => string },
): string {
  const rootAgent = analysis.agents.find(a => !a.isSubAgent);
  const description = rootAgent?.description || analysis.summary || "Primary orchestrator for this repository";

  const subAgents = analysis.agents.filter(a => a.isSubAgent);

  // Root agent gets runSubagent for delegation
  const tools = [...BASE_TOOLS, "runSubagent"];
  const toolsList = `tools: [${tools.map(t => `'${t}'`).join(", ")}]`;

  // Build skills section
  const skillsSection = analysis.skills.length > 0
    ? analysis.skills.map(s =>
        `- [${helpers.toTitleCase(s.name)}](../skills/${s.name}/SKILL.md): ${s.description}`
      ).join("\n")
    : "No specific skills documented yet.";

  // Build delegation section
  let delegationSection = "";
  if (subAgents.length > 0) {
    const delegationEntries = subAgents.map(sa => {
      const triggerList = sa.triggers.length > 0 ? sa.triggers.join(", ") : "general";
      return `- **@${sa.name}** — ${sa.description}. Triggers: ${triggerList}`;
    }).join("\n");

    delegationSection = `## Agent Delegation

This agent coordinates work across specialized sub-agents:

${delegationEntries}

When asked about these domains, use \`runSubagent\` to delegate to the appropriate specialist.

`;
  }

  // Collect commands from all agents
  const allTools = new Set<string>();
  for (const agent of analysis.agents) {
    for (const tool of agent.tools) {
      allTools.add(tool.command);
    }
  }

  const commandsSection = allTools.size > 0
    ? Array.from(allTools).map(cmd => `- \`${cmd}\``).join("\n")
    : "- `npm install` / `pip install` / `go build` (as appropriate)";

  return `---
name: ${helpers.toTitleCase(agentName)}
description: ${helpers.quoteYamlValue(description)}
${toolsList}
---

# ${helpers.toTitleCase(agentName)} Agent

${description}

${delegationSection}## Skills

This agent has knowledge of the following patterns and conventions:

${skillsSection}

## Commands

Common commands for this repository:

${commandsSection}

## Instructions

You are the primary orchestrator for this codebase. When working on tasks:

1. Use \`#codebase\` to search for relevant code patterns
2. Reference the skills above to follow established conventions
3. Use \`#textSearch\` to find specific implementations
4. Use \`#editFiles\` to make changes that follow detected patterns
5. Use \`#runInTerminal\` to execute build, test, and lint commands
6. Check \`#problems\` to ensure changes don't introduce errors
${subAgents.length > 0 ? "7. Use `runSubagent` to delegate domain-specific work to specialist agents\n" : ""}
Always follow the patterns documented in the linked skills when making changes.
`;
}

/**
 * Build the .agent.md content for a domain-specific sub-agent.
 * Sub-agents do NOT get `runSubagent` — they are leaf specialists.
 */
export function buildSubAgentMd(
  agent: AgentDefinition,
  skills: SkillDefinition[],
  helpers: { toTitleCase: (s: string | unknown) => string; quoteYamlValue: (s: string) => string },
): string {
  const toolsList = `tools: [${BASE_TOOLS.map(t => `'${t}'`).join(", ")}]`;

  // Filter skills relevant to this agent
  const relevantSkills = skills.filter(s => agent.skills.includes(s.name));

  const skillsSection = relevantSkills.length > 0
    ? relevantSkills.map(s =>
        `- [${helpers.toTitleCase(s.name)}](../skills/${s.name}/SKILL.md): ${s.description}`
      ).join("\n")
    : "No specific skills documented yet.";

  // Collect commands from this agent's tools
  const commandsSection = agent.tools.length > 0
    ? agent.tools.map(t => `- \`${t.command}\``).join("\n")
    : "- See root agent for repository commands";

  const sourceHint = agent.sourceDir
    ? `Focus on files in \`${agent.sourceDir}/\`.`
    : "";

  return `---
name: ${helpers.toTitleCase(agent.name)}
description: ${helpers.quoteYamlValue(agent.description)}
${toolsList}
---

# ${helpers.toTitleCase(agent.name)} Agent

Specialist agent for the ${agent.name} domain.

${agent.description}

## Skills

${skillsSection}

## Commands

${commandsSection}

## Instructions

You are a specialist in the ${agent.name} domain of this codebase.
${sourceHint}

When working on tasks:

1. Use \`#codebase\` to search for relevant code patterns in your domain
2. Reference the skills above to follow established conventions
3. Use \`#textSearch\` to find specific implementations
4. Use \`#editFiles\` to make changes that follow detected patterns
5. Use \`#runInTerminal\` to execute build, test, and lint commands
6. Check \`#problems\` to ensure changes don't introduce errors

Always follow the patterns documented in the linked skills when making changes.
`;
}
