/**
 * Instructions Writer - Copilot Instructions Generator
 * Generates .github/copilot-instructions.md and path-specific
 * .github/instructions/*.instructions.md files from analysis results.
 * "I'd like to share a revelation that I've had..."
 */

import crypto from "crypto";
import type { AnalysisResult, SkillDefinition, ToolDefinition } from "../analyzer/types.js";

export interface DirectoryInstruction {
  directory: string;
  /** Repository-relative path of the path-specific instructions file. */
  file: string;
  /** Glob for the file's `applyTo` frontmatter. */
  applyTo: string;
  /** Managed block, without frontmatter. */
  content: string;
}

const MAX_INSTRUCTIONS_SLUG_LENGTH = 80;
const FRONTMATTER_PATTERN = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

export function buildDirectoryInstructions(analysis: AnalysisResult): DirectoryInstruction[] {
  const grouped = new Map<string, SkillDefinition[]>();
  for (const skill of analysis.skills) {
    const directory = skill.sourceDir.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+$/, "");
    if (!directory || directory === "." || directory.includes("..")) continue;
    const list = grouped.get(directory) ?? [];
    list.push(skill);
    grouped.set(directory, list);
  }

  return Array.from(grouped.entries()).flatMap(([directory, skills]) => {
    const applyTo = toApplyToGlob(directory);
    if (applyTo === undefined) return [];
    const patterns = Array.from(new Set(skills.flatMap((skill) => skill.patterns)));
    const antiPatterns = Array.from(new Set(skills.flatMap((skill) => skill.antiPatterns ?? [])));
    const references = Array.from(new Set(skills.flatMap((skill) => skill.codebaseReferences ?? [])));
    const sections = [
      "<!-- agentsmith:managed -->",
      `# Copilot Instructions for \`${directory}/\``,
      "",
      "## Conventions",
      "",
      ...(patterns.length > 0 ? patterns.map((item) => `- ${item}`) : ["- Follow nearby implementation patterns."]),
    ];
    if (antiPatterns.length > 0) {
      sections.push("", "## Anti-Patterns", "", ...antiPatterns.map((item) => `- ${item}`));
    }
    if (references.length > 0) {
      sections.push(
        "",
        "## Codebase References",
        "",
        "Use `#codebase` to inspect:",
        ...references.map((item) => `- \`${item}\``),
      );
    }
    sections.push("", "<!-- /agentsmith:managed -->");
    return [{
      directory,
      file: instructionsFile(directory),
      applyTo,
      content: sections.join("\n"),
    }];
  });
}

/**
 * Render a path-specific instructions file. Copilot reads `applyTo` only from
 * frontmatter at the top of the file, so existing frontmatter (including user
 * edits) stays first and only the managed block in the body is replaced.
 */
export function renderDirectoryInstructionsFile(
  instruction: DirectoryInstruction,
  existingContent = "",
): string {
  const existingFrontmatter = FRONTMATTER_PATTERN.exec(existingContent)?.[0];
  const body = existingContent.slice(existingFrontmatter?.length ?? 0);
  if (!body.trim()) {
    let frontmatter = existingFrontmatter ?? applyToFrontmatter(instruction.applyTo);
    // Frontmatter that ends the file can lack a newline after its closing `---`.
    if (!frontmatter.endsWith("\n")) frontmatter += "\n";
    return `${frontmatter}\n${instruction.content}\n`;
  }
  return (existingFrontmatter ?? `${applyToFrontmatter(instruction.applyTo)}\n`)
    + mergeWithExisting(body, instruction.content);
}

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

/**
 * Content to keep in a path-specific instructions file that is no longer
 * generated: the file without its managed block, so user notes and frontmatter
 * edits, including a changed `applyTo`, stay. Returns "" when nothing would be
 * left but the frontmatter generated with `applyTo`, meaning the file can be
 * deleted, and undefined when the file has no managed block.
 */
export function removeManagedInstructions(content: string, applyTo: string): string | undefined {
  const frontmatter = FRONTMATTER_PATTERN.exec(content)?.[0] ?? "";
  const body = content.slice(frontmatter.length);
  const startIdx = body.indexOf(MANAGED_START);
  const endIdx = body.indexOf(MANAGED_END, startIdx);
  if (startIdx === -1 || endIdx === -1) return undefined;

  const notes = [body.slice(0, startIdx), body.slice(endIdx + MANAGED_END.length)]
    .map((text) => text.replace(/^(?:[ \t]*\r?\n)+/, "").trimEnd())
    .filter(Boolean)
    .join("\n\n");
  if (!notes && (!frontmatter || isGeneratedFrontmatter(frontmatter, applyTo))) return "";
  return `${[frontmatter.trimEnd(), notes].filter(Boolean).join("\n\n")}\n`;
}

// --- Internal helpers ---

function applyToFrontmatter(applyTo: string): string {
  return `---\napplyTo: "${applyTo}"\n---\n`;
}

/** Whether frontmatter is exactly what Agent Smith wrote for `applyTo`, line endings aside. */
function isGeneratedFrontmatter(frontmatter: string, applyTo: string): boolean {
  return frontmatter.replace(/\r\n/g, "\n").trimEnd() === applyToFrontmatter(applyTo).trimEnd();
}

/**
 * Glob for a directory's `applyTo` frontmatter that matches only that folder.
 * Each glob metacharacter becomes a one-character class such as `[(]`, which
 * VS Code, minimatch, picomatch and globset all read literally, so `app/(auth)`
 * and `app/[auth]` get different globs. Returns undefined for the rare names no
 * such glob can express; those folders get no file rather than a wrong scope.
 */
function toApplyToGlob(directory: string): string | undefined {
  if (
    directory.startsWith("!") // negates the whole pattern, and `[!]` opens a negated class
    || /["\p{Cc}]/u.test(directory) // cannot go inside the double-quoted YAML value
    || /\{.*,.*\}/.test(directory) // minimatch expands braces before it reads classes
  ) {
    return undefined;
  }
  // VS Code trims each pattern, so a leading space is escaped as well.
  return `${directory.replace(/^\s|[[\]*?{}(),|#]/g, (char) => `[${char}]`)}/**`;
}

/**
 * File name from the folder path alone: a readable slug plus a hash of the
 * exact path. Folders whose slugs match, such as `app/(auth)` and `app/[auth]`,
 * still get different files, and a file never moves to another folder when
 * folders are added, removed or listed in a different order.
 */
function instructionsFile(directory: string): string {
  const slug = directory
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, MAX_INSTRUCTIONS_SLUG_LENGTH)
    .replace(/^-+|-+$/g, "") || "folder";
  const hash = crypto.createHash("sha256").update(directory).digest("hex").slice(0, 12);
  return `.github/instructions/agentsmith-${slug}-${hash}.instructions.md`;
}

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
  // Several agents often list the same test command, so keep each line once.
  const info = new Set<string>();

  // Check tools for test commands
  for (const tool of tools) {
    const cmd = tool.command.toLowerCase();
    if (cmd.includes("test") || cmd.includes("jest") || cmd.includes("vitest") || cmd.includes("pytest")) {
      info.add(`Run tests: \`${tool.command}\``);
    }
  }

  // Check skills for testing patterns
  for (const skill of skills) {
    if (skill.category === "quality" || skill.name.includes("test")) {
      for (const pattern of skill.patterns) {
        if (info.size < 8) {
          info.add(pattern);
        }
      }
    }
  }

  return Array.from(info);
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
