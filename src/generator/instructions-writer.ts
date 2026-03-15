/**
 * Instructions Writer - Copilot Instructions Generator
 * Generates .github/copilot-instructions.md from analysis results.
 * "I'd like to share a revelation that I've had..."
 */

import type { AnalysisResult, SkillDefinition, ToolDefinition } from "../analyzer/types.js";

const MANAGED_START = "<!-- agentsmith:managed -->";
const MANAGED_END = "<!-- /agentsmith:managed -->";

/**
 * Build the managed copilot-instructions.md content from analysis results.
 * Kept factual - all data derived from the AnalysisResult, nothing hallucinated.
 */
export function buildCopilotInstructions(analysis: AnalysisResult): string {
  const sections: string[] = [];

  sections.push(MANAGED_START);
  sections.push("# Copilot Instructions");
  sections.push("");

  // 1. Project identity
  if (analysis.summary) {
    sections.push(analysis.summary);
    sections.push("");
  }

  // 2. Language & Framework
  sections.push("## Language & Framework");
  sections.push("");
  const language = analysis.repo?.language || detectLanguageFromSkills(analysis.skills);
  const framework = analysis.repo?.framework || null;
  sections.push(`- **Language:** ${language || "Not detected"}`);
  sections.push(`- **Framework:** ${framework || "None detected"}`);
  sections.push("");

  // 3. Coding Conventions (derived from skill patterns)
  const conventions = collectConventions(analysis.skills);
  if (conventions.length > 0) {
    sections.push("## Coding Conventions");
    sections.push("");
    for (const convention of conventions) {
      sections.push(`- ${convention}`);
    }
    sections.push("");
  }

  // 4. Project Structure (from skills' sourceDirs)
  const structureEntries = collectStructure(analysis.skills);
  if (structureEntries.length > 0) {
    sections.push("## Project Structure");
    sections.push("");
    for (const entry of structureEntries) {
      sections.push(`- \`${entry.dir}/\` -- ${entry.description}`);
    }
    sections.push("");
  }

  // 5. Testing conventions
  const testingInfo = collectTestingInfo(analysis.skills, analysis.tools);
  if (testingInfo.length > 0) {
    sections.push("## Testing");
    sections.push("");
    for (const info of testingInfo) {
      sections.push(`- ${info}`);
    }
    sections.push("");
  }

  // 6. Build & Tools
  const toolEntries = collectToolInfo(analysis.tools);
  if (toolEntries.length > 0) {
    sections.push("## Build & Tools");
    sections.push("");
    for (const tool of toolEntries) {
      sections.push(`- \`${tool.command}\` -- ${tool.description}`);
    }
    sections.push("");
  }

  sections.push(MANAGED_END);

  return sections.join("\n");
}

/**
 * Merge managed content into an existing file, preserving user content
 * outside the agentsmith:managed markers.
 */
export function mergeWithExisting(existingContent: string, managedBlock: string): string {
  const startIdx = existingContent.indexOf(MANAGED_START);
  const endIdx = existingContent.indexOf(MANAGED_END);

  if (startIdx !== -1 && endIdx !== -1) {
    // Replace content between markers (inclusive of markers)
    const before = existingContent.slice(0, startIdx);
    const after = existingContent.slice(endIdx + MANAGED_END.length);
    return before + managedBlock + after;
  }

  // No markers found - prepend managed block, keep existing content after
  return managedBlock + "\n\n" + existingContent;
}

// --- Internal helpers ---

function detectLanguageFromSkills(skills: SkillDefinition[]): string {
  for (const skill of skills) {
    for (const pattern of skill.patterns) {
      const lower = pattern.toLowerCase();
      if (lower.includes("typescript") || lower.includes(".ts")) return "TypeScript";
      if (lower.includes("python") || lower.includes(".py")) return "Python";
      if (lower.includes("javascript") || lower.includes(".js")) return "JavaScript";
      if (lower.includes("golang") || lower.includes(".go")) return "Go";
      if (lower.includes("rust") || lower.includes(".rs")) return "Rust";
    }
  }
  return "Not detected";
}

function collectConventions(skills: SkillDefinition[]): string[] {
  const conventions: string[] = [];
  const seen = new Set<string>();

  for (const skill of skills) {
    for (const pattern of skill.patterns) {
      // Deduplicate and limit total
      if (!seen.has(pattern) && conventions.length < 15) {
        seen.add(pattern);
        conventions.push(pattern);
      }
    }
  }

  return conventions;
}

interface StructureEntry {
  dir: string;
  description: string;
}

function collectStructure(skills: SkillDefinition[]): StructureEntry[] {
  const seen = new Set<string>();
  const entries: StructureEntry[] = [];

  for (const skill of skills) {
    const dir = skill.sourceDir;
    if (dir && !seen.has(dir)) {
      seen.add(dir);
      entries.push({ dir, description: skill.description });
    }
  }

  return entries;
}

function collectTestingInfo(skills: SkillDefinition[], tools: ToolDefinition[]): string[] {
  const info: string[] = [];

  // Check tools for test commands
  for (const tool of tools) {
    const cmd = tool.command.toLowerCase();
    if (cmd.includes("test") || cmd.includes("jest") || cmd.includes("vitest") || cmd.includes("pytest")) {
      info.push(`Run tests: \`${tool.command}\``);
    }
  }

  // Check skills for testing patterns
  for (const skill of skills) {
    if (skill.category === "quality" || skill.name.includes("test")) {
      for (const pattern of skill.patterns) {
        if (info.length < 8) {
          info.push(pattern);
        }
      }
    }
  }

  return info;
}

function collectToolInfo(tools: ToolDefinition[]): ToolDefinition[] {
  // Return all detected tools, deduplicated by command
  const seen = new Set<string>();
  const result: ToolDefinition[] = [];

  for (const tool of tools) {
    if (!seen.has(tool.command)) {
      seen.add(tool.command);
      result.push(tool);
    }
  }

  return result;
}
