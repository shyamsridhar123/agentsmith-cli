import type { AnalysisResult, SkillDefinition } from "../analyzer/types.js";

interface WriterHelpers {
  toTitleCase: (value: string | unknown) => string;
  quoteYamlValue: (value: string) => string;
}

export function buildSkillMarkdown(
  skill: SkillDefinition,
  helpers: WriterHelpers,
): string {
  const patterns = skill.patterns.length > 0
    ? skill.patterns.map((pattern) => `- ${pattern}`).join("\n")
    : "- Patterns extracted from codebase analysis";

  const examples = skill.examples.length > 0
    ? skill.examples.map((example) => `\`\`\`\n${example}\n\`\`\``).join("\n\n")
    : "See source files in the repository for examples.";

  const antiPatterns = skill.antiPatterns && skill.antiPatterns.length > 0
    ? `\n## Anti-Patterns\n\n${skill.antiPatterns.map((item) => `- ${item}`).join("\n")}\n`
    : "";
  const references = skill.codebaseReferences && skill.codebaseReferences.length > 0
    ? `\n## Codebase References\n\nUse \`#codebase\` to inspect:\n\n${skill.codebaseReferences.map((item) => `- \`${item}\``).join("\n")}\n`
    : "";

  const categoryDescriptions: Record<string, string> = {
    architecture: "Structural patterns and system design",
    reliability: "Error handling, recovery, and fault tolerance",
    quality: "Testing, validation, and code quality",
    security: "Authentication, authorization, and data protection",
    patterns: "Common code patterns and conventions",
  };
  const categoryDescription = categoryDescriptions[skill.category] || "General patterns";

  return `---
name: ${helpers.quoteYamlValue(skill.name)}
description: ${helpers.quoteYamlValue(skill.description)}
---

# ${helpers.toTitleCase(skill.name)}

${skill.description}

## When to Use

Use this skill when:

- Working with code in \`${skill.sourceDir}/\`
${skill.triggers.map((trigger) => `- User mentions "${trigger}"`).join("\n")}

## Patterns

${patterns}
${antiPatterns}
${references}

## Examples

${examples}

## Category

**${skill.category}** - ${categoryDescription}
`;
}

export function buildMainAgentMd(
  analysis: AnalysisResult,
  agentName: string,
  helpers: WriterHelpers,
): string {
  const rootAgent = analysis.agents.find((agent) => !agent.isSubAgent);
  const description = rootAgent?.description || analysis.summary || "AI assistant for this repository";

  const allTools = new Set<string>();
  for (const agent of analysis.agents) {
    for (const tool of agent.tools) {
      allTools.add(tool.command);
    }
  }

  const vsCodeTools = [
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

  const toolsList = `tools: [${vsCodeTools.map((tool) => `'${tool}'`).join(", ")}]`;
  const skillsSection = analysis.skills.length > 0
    ? analysis.skills.map((skill) =>
      `- [${helpers.toTitleCase(skill.name)}](../skills/${skill.name}/SKILL.md): ${skill.description}`
    ).join("\n")
    : "No specific skills documented yet.";
  const commandsSection = allTools.size > 0
    ? Array.from(allTools).map((command) => `- \`${command}\``).join("\n")
    : "- `npm install` / `pip install` / `go build` (as appropriate)";

  return `---
name: ${helpers.toTitleCase(agentName)}
description: ${helpers.quoteYamlValue(description)}
${toolsList}
---

# ${helpers.toTitleCase(agentName)} Agent

${description}

## Skills

This agent has knowledge of the following patterns and conventions:

${skillsSection}

## Commands

Common commands for this repository:

${commandsSection}

## Instructions

You are an AI assistant specialized in this codebase. When working on tasks:

1. Use \`#codebase\` to search for relevant code patterns
2. Reference the skills above to follow established conventions
3. Use \`#textSearch\` to find specific implementations
4. Use \`#editFiles\` to make changes that follow detected patterns
5. Use \`#runInTerminal\` to execute build, test, and lint commands
6. Check \`#problems\` to ensure changes don't introduce errors

Always follow the patterns documented in the linked skills when making changes.
`;
}
