/**
 * Unified Analyzer Types
 * Shared type definitions for both local and remote analyzers.
 * "I'm going to be as forthcoming as I can be, Mr. Anderson."
 */

export interface SkillDefinition {
  name: string;
  description: string;
  sourceDir: string;
  patterns: string[];
  triggers: string[];
  category: string;
  examples: string[];
  antiPatterns?: string[];
  codebaseReferences?: string[];
  cliFocused?: boolean;
}

export interface CLIOptionDefinition {
  name: string;
  short?: string;
  description?: string;
  required: boolean;
}

export interface CLICommandDefinition {
  name: string;
  description?: string;
  file: string;
  parent?: string;
  options: CLIOptionDefinition[];
}

export interface CLIStructure {
  framework: string;
  entryFiles: string[];
  commands: CLICommandDefinition[];
  extensionPoints: string[];
  testFiles: string[];
}

export interface AgentDefinition {
  name: string;
  description: string;
  skills: string[];
  tools: ToolDefinition[];
  isSubAgent: boolean;
  parentAgent?: string; // For nested agent hierarchies
  subAgents?: string[]; // Child agents
  triggers: string[];
  sourceDir?: string; // Directory this agent represents
}

export interface ToolDefinition {
  name: string;
  command: string;
  description: string;
}

export interface HookDefinition {
  name: string;
  event: "pre-commit" | "post-commit" | "pre-push" | "pre-analyze" | "post-generate";
  description: string;
  commands: string[];
  condition?: string;
}

export interface AnalysisResult {
  repoName: string;
  skills: SkillDefinition[];
  agents: AgentDefinition[];
  tools: ToolDefinition[];
  hooks: HookDefinition[];
  summary: string;
  cli?: CLIStructure;
  repo?: {
    owner: string;
    repo: string;
    license?: string;
    language: string;
    framework?: string;
  };
}
