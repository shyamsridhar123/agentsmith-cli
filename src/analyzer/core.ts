/**
 * Shared Analyzer Core
 * Common logic extracted from both local and remote analyzers.
 * "I'd like to share a revelation that I've had..."
 */

import type {
  AgentDefinition,
  ToolDefinition,
  HookDefinition,
  SkillDefinition,
} from "./types.js";
import { validateAnalysisOutput } from "./schemas.js";

/**
 * Flatten nested sub-agents into a flat array.
 * The SDK may return sub-agents as objects inside parent.subAgents[].
 * We need them as separate entries in the agents array.
 */
export function flattenAgents(agents: unknown[]): AgentDefinition[] {
  const result: AgentDefinition[] = [];

  for (const rawAgent of agents) {
    if (!rawAgent || typeof rawAgent !== "object") continue;

    const agent = rawAgent as Record<string, unknown>;

    // Extract nested sub-agent objects
    const nestedSubAgents: unknown[] = [];
    const subAgentNames: string[] = [];

    const subAgentsArray = agent.subAgents as unknown[];
    if (Array.isArray(subAgentsArray) && subAgentsArray.length > 0) {
      for (const subAgent of subAgentsArray) {
        if (typeof subAgent === "object" && subAgent !== null && "name" in subAgent) {
          // It's a nested agent object - extract it
          const nestedAgent = subAgent as Record<string, unknown>;
          nestedAgent.isSubAgent = true;
          nestedAgent.parentAgent = agent.name as string;
          nestedSubAgents.push(nestedAgent);
          subAgentNames.push(nestedAgent.name as string);
        } else if (typeof subAgent === "string") {
          // It's just a name reference
          subAgentNames.push(subAgent);
        }
      }
    }

    // Build normalized agent
    const normalizedAgent: AgentDefinition = {
      name: String(agent.name || "unknown"),
      description: String(agent.description || ""),
      skills: Array.isArray(agent.skills) ? agent.skills.map((s: unknown) => String(s)) : [],
      tools: normalizeTools(agent.tools),
      isSubAgent: Boolean(agent.isSubAgent),
      parentAgent: agent.parentAgent ? String(agent.parentAgent) : undefined,
      subAgents: subAgentNames.length > 0 ? subAgentNames : undefined,
      triggers: Array.isArray(agent.triggers) ? agent.triggers.map((t: unknown) => String(t)) : [],
      sourceDir: agent.sourceDir ? String(agent.sourceDir) : undefined,
    };

    result.push(normalizedAgent);

    // Recursively flatten any nested sub-agents
    if (nestedSubAgents.length > 0) {
      result.push(...flattenAgents(nestedSubAgents));
    }
  }

  return result;
}

/**
 * Normalize tools to ToolDefinition format.
 * SDK may return tools as strings or objects.
 */
export function normalizeTools(tools: unknown): ToolDefinition[] {
  if (!tools || !Array.isArray(tools)) {
    return [];
  }

  return tools.map((tool: unknown) => {
    if (typeof tool === "string") {
      return {
        name: tool.split(" ")[0],
        command: tool,
        description: tool,
      };
    }
    if (typeof tool === "object" && tool !== null) {
      const t = tool as Record<string, unknown>;
      return {
        name: String(t.name || "unknown"),
        command: String(t.command || t.name || ""),
        description: String(t.description || t.name || ""),
      };
    }
    return {
      name: "unknown",
      command: String(tool),
      description: String(tool),
    };
  });
}

/**
 * Extract all tools from a list of agents.
 */
export function extractAllTools(agents: AgentDefinition[]): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  for (const agent of agents) {
    if (agent.tools) {
      tools.push(...agent.tools);
    }
  }
  return tools;
}

/**
 * Detect domain boundaries from a file list.
 * @param files - Array of objects with relativePath, isTest, isConfig properties
 * @param pathSep - Path separator to use (e.g., path.sep for local, "/" for remote)
 */
export function detectDomainBoundaries(
  files: ReadonlyArray<{ relativePath: string; isTest: boolean; isConfig: boolean }>,
  pathSep: string,
): Array<{ name: string; path: string; fileCount: number }> {
  const domains: Map<string, { path: string; fileCount: number; subDirs: Set<string> }> = new Map();

  // Common domain patterns
  const domainPatterns = [
    "api", "auth", "backend", "frontend", "core", "common", "shared",
    "services", "handlers", "controllers", "models", "views", "routes",
    "components", "hooks", "utils", "lib", "pkg", "internal", "cmd",
    "client", "server", "admin", "public", "private", "modules",
  ];

  for (const file of files) {
    if (file.isTest || file.isConfig) continue;

    const parts = file.relativePath.split(pathSep);
    if (parts.length < 2) continue;

    const topDir = parts[0];
    const secondDir = parts.length > 2 ? parts[1] : null;

    // Track top-level domains
    if (!domains.has(topDir)) {
      domains.set(topDir, { path: topDir, fileCount: 0, subDirs: new Set() });
    }
    const domain = domains.get(topDir)!;
    domain.fileCount++;

    // Track sub-domains
    if (secondDir && domainPatterns.includes(secondDir.toLowerCase())) {
      domain.subDirs.add(secondDir);
    }
  }

  // Filter to significant domains (>5 files) and sort by file count
  return Array.from(domains.entries())
    .filter(([name, info]) => info.fileCount > 5 && domainPatterns.includes(name.toLowerCase()))
    .map(([name, info]) => ({ name, path: info.path, fileCount: info.fileCount }))
    .sort((a, b) => b.fileCount - a.fileCount);
}

/**
 * Generate default hooks based on language and whether test files exist.
 */
export function generateDefaultHooks(language: string, testFilesExist: boolean): HookDefinition[] {
  const hooks: HookDefinition[] = [];

  if (language === "TypeScript" || language === "JavaScript") {
    hooks.push({
      name: "pre-commit-quality",
      event: "pre-commit",
      description: "Run linting and type checking before commit",
      commands: ["npm run lint", "npm run build"],
    });

    if (testFilesExist) {
      hooks.push({
        name: "pre-push-tests",
        event: "pre-push",
        description: "Run tests before pushing",
        commands: ["npm test"],
      });
    }
  } else if (language === "Python") {
    hooks.push({
      name: "pre-commit-quality",
      event: "pre-commit",
      description: "Run linting and formatting before commit",
      commands: ["ruff check .", "ruff format --check ."],
    });

    if (testFilesExist) {
      hooks.push({
        name: "pre-push-tests",
        event: "pre-push",
        description: "Run tests before pushing",
        commands: ["pytest"],
      });
    }
  } else if (language === "Go") {
    hooks.push({
      name: "pre-commit-quality",
      event: "pre-commit",
      description: "Run linting and formatting before commit",
      commands: ["go fmt ./...", "golangci-lint run"],
    });

    if (testFilesExist) {
      hooks.push({
        name: "pre-push-tests",
        event: "pre-push",
        description: "Run tests before pushing",
        commands: ["go test ./..."],
      });
    }
  }

  // Post-generate hook for Agent Smith specific workflow
  hooks.push({
    name: "post-generate-validate",
    event: "post-generate",
    description: "Validate generated agent assets after generation",
    commands: ["npx agentsmith validate"],
  });

  return hooks;
}

/**
 * Detect tools from config based on language and config files.
 */
export function detectToolsFromConfig(language: string, configFiles: string[]): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  if (language === "TypeScript" || language === "JavaScript") {
    if (configFiles.includes("package.json")) {
      tools.push(
        { name: "install", command: "npm install", description: "Install dependencies" },
        { name: "build", command: "npm run build", description: "Build the project" },
        { name: "test", command: "npm test", description: "Run tests" },
        { name: "lint", command: "npm run lint", description: "Run linter" },
      );
    }
  } else if (language === "Python") {
    tools.push(
      { name: "install", command: "pip install -e .", description: "Install dependencies" },
      { name: "test", command: "pytest", description: "Run tests" },
      { name: "lint", command: "ruff check .", description: "Run linter" },
    );
  } else if (language === "Go") {
    tools.push(
      { name: "build", command: "go build ./...", description: "Build the project" },
      { name: "test", command: "go test ./...", description: "Run tests" },
      { name: "lint", command: "golangci-lint run", description: "Run linter" },
    );
  }

  return tools;
}

/**
 * Build a system prompt for Copilot SDK analysis.
 * @param language - Detected language
 * @param domains - Optional detected domain boundaries
 */
export function getSystemPrompt(
  language: string,
  domains?: Array<{ name: string }>,
): string {
  const domainHints = domains && domains.length > 0
    ? `\nPotential domains detected: ${domains.map(d => d.name).join(", ")}`
    : "";

  return `You are Agent Smith, an AI designed to assimilate repositories into agent hierarchies.

Your task: Analyze this ${language} repository and extract:
1. SKILLS - Reusable patterns, conventions, and capabilities specific to parts of this codebase
2. AGENTS - Domain-specific agents with clear responsibilities
3. SUB-AGENTS - Child agents for complex domains (e.g., auth/oauth, auth/rbac under auth)
4. NESTED AGENTS - Multi-level hierarchies for large codebases
5. TOOLS - Commands that can be run (build, test, lint, deploy, etc.)

## Agent Hierarchy Guidelines
- Create a ROOT agent for the overall repository
- Create SUB-AGENTS for major domains (backend, frontend, api, auth, data)
- Create NESTED agents when a domain has sub-domains (api/v1, api/v2, api/graphql)
- Each agent should have 2-5 skills max; split if more are needed
${domainHints}

For each SKILL, identify:
- A kebab-case name (max 64 chars)
- A clear description of when to use it
- The source directory it relates to
- The patterns and conventions it embodies
- Keywords that trigger its relevance
- Category: architecture, reliability, quality, security, or patterns

For AGENTS, determine:
- Natural domain boundaries based on directory structure
- Parent-child relationships (isSubAgent: true for children)
- Which skills each agent owns (skills should not overlap between agents)
- Tools specific to that agent's domain

Respond in valid JSON format only. No markdown, no explanation.`;
}

/**
 * Build the analysis prompt with file list and samples.
 */
export function buildAnalysisPrompt(
  language: string,
  framework: string | null | undefined,
  sourceDirectories: string[],
  configFiles: string[],
  fileList: string,
  sampleContent: string,
): string {
  return `Analyze this ${language} repository.

## Repository Structure
Language: ${language}
Framework: ${framework || "None"}
Source directories: ${sourceDirectories.join(", ")}
Config files: ${configFiles.join(", ")}

## File List (first 100)
${fileList}

## File Samples
${sampleContent}

## Instructions
Extract skills, agents (with hierarchy), and tools from this codebase. Return JSON:

{
  "skills": [
    {
      "name": "skill-name",
      "description": "When and how to use this pattern",
      "sourceDir": "src/auth",
      "patterns": ["pattern 1", "pattern 2"],
      "triggers": ["keyword1", "keyword2"],
      "category": "architecture|reliability|quality|security|patterns",
      "examples": ["example code snippet or reference"]
    }
  ],
  "agents": [
    {
      "name": "root",
      "description": "Main agent for the repository",
      "skills": ["overview-skill"],
      "tools": [{"name": "build", "command": "npm run build", "description": "Build the project"}],
      "isSubAgent": false,
      "subAgents": ["backend", "frontend"],
      "sourceDir": "",
      "triggers": ["main", "primary"]
    },
    {
      "name": "backend",
      "description": "Backend domain agent",
      "skills": ["api-patterns", "db-access"],
      "tools": [],
      "isSubAgent": true,
      "parentAgent": "root",
      "subAgents": ["auth"],
      "sourceDir": "src/backend",
      "triggers": ["backend", "server", "api"]
    },
    {
      "name": "auth",
      "description": "Authentication sub-agent",
      "skills": ["oauth-flow"],
      "tools": [],
      "isSubAgent": true,
      "parentAgent": "backend",
      "sourceDir": "src/backend/auth",
      "triggers": ["auth", "login", "oauth"]
    }
  ],
  "summary": "One paragraph describing the repository's architecture and purpose"
}`;
}

/**
 * Parse a JSON analysis response from the SDK.
 * Extracts JSON from potentially mixed content and validates with Zod.
 * @param response - Raw response string
 * @param fallbackFn - Function to call if parsing or validation fails
 */
export function parseAnalysisResponse<T>(
  response: string,
  fallbackFn: () => T,
): { skills: unknown[]; agents: unknown[]; hooks: unknown[]; summary: string } | T {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in response");
    }

    const raw = JSON.parse(jsonMatch[0]) as unknown;

    // Validate through Zod schema — applies defaults and type checks
    const validated = validateAnalysisOutput(raw);
    if (!validated) {
      console.warn("  [Zod] Validation failed, falling back");
      return fallbackFn();
    }

    return {
      skills: validated.skills as unknown[],
      agents: validated.agents as unknown[],
      hooks: (validated.hooks ?? []) as unknown[],
      summary: validated.summary,
    };
  } catch {
    return fallbackFn();
  }
}

/**
 * Generate default skills based on detected source directories.
 */
export function generateDefaultSkills(sourceDirectories: string[]): SkillDefinition[] {
  return sourceDirectories.map((dir) => ({
    name: `${dir}-patterns`,
    description: `Patterns and conventions from the ${dir} directory`,
    sourceDir: dir,
    patterns: [],
    triggers: [dir],
    category: "patterns",
    examples: [],
  }));
}

/**
 * Get default tools for a language without checking config files.
 * Used by the remote analyzer fallback where we don't have filesystem access.
 */
export function getDefaultTools(language: string): ToolDefinition[] {
  if (language === "TypeScript" || language === "JavaScript") {
    return [
      { name: "install", command: "npm install", description: "Install dependencies" },
      { name: "build", command: "npm run build", description: "Build" },
      { name: "test", command: "npm test", description: "Run tests" },
    ];
  } else if (language === "Python") {
    return [
      { name: "install", command: "pip install -e .", description: "Install" },
      { name: "test", command: "pytest", description: "Run tests" },
    ];
  } else if (language === "Go") {
    return [
      { name: "build", command: "go build ./...", description: "Build" },
      { name: "test", command: "go test ./...", description: "Run tests" },
    ];
  }
  return [];
}
