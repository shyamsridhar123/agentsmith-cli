/**
 * Analyzer Module - Barrel Export
 * Re-exports all types and analyzers for backward compatibility.
 */

// Re-export all types
export type {
  SkillDefinition,
  AgentDefinition,
  ToolDefinition,
  HookDefinition,
  AnalysisResult,
} from "./types.js";

// Re-export core utilities
export {
  flattenAgents,
  normalizeTools,
  extractAllTools,
  detectDomainBoundaries,
  generateDefaultHooks,
  detectToolsFromConfig,
  getDefaultTools,
  getSystemPrompt,
  buildAnalysisPrompt,
  parseAnalysisResponse,
  generateDefaultSkills,
} from "./core.js";

// Re-export Zod schemas and validation
export {
  SkillOutputSchema,
  ToolOutputSchema,
  HookOutputSchema,
  AgentOutputSchema,
  AnalysisOutputSchema,
  validateAnalysisOutput,
} from "./schemas.js";
export type { AnalysisOutput, AgentOutput } from "./schemas.js";

// Re-export analyzers
export { Analyzer } from "./local.js";
export { RemoteAnalyzer } from "./remote.js";

// Import classes for factory function
import { Analyzer } from "./local.js";
import { RemoteAnalyzer } from "./remote.js";

// Factory function
export function createAnalyzer(
  mode: "local",
  options?: { verbose?: boolean },
): Analyzer;
export function createAnalyzer(
  mode: "remote",
  options: { repoUrl: string; verbose?: boolean },
): RemoteAnalyzer;
export function createAnalyzer(
  mode: "local" | "remote",
  options?: { repoUrl?: string; verbose?: boolean },
): Analyzer | RemoteAnalyzer {
  if (mode === "remote") {
    if (!options?.repoUrl) {
      throw new Error("repoUrl is required for remote analyzer");
    }
    return new RemoteAnalyzer(options.repoUrl, options?.verbose);
  }
  return new Analyzer(options?.verbose);
}
