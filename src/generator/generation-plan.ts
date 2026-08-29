import path from "path";
import type {
  AgentDefinition,
  AnalysisResult,
  HookDefinition,
  SkillDefinition,
} from "../analyzer/types.js";

export interface PlannedAgentFile {
  name: string;
  file: string;
  isSubAgent: boolean;
  agent?: AgentDefinition;
  combined: boolean;
}

export interface PlannedSkillFile {
  name: string;
  file: string;
  skill: SkillDefinition;
}

export interface PlannedHookFile {
  name: string;
  file: string;
  hook: HookDefinition;
}

export interface GenerationPlan {
  agentFiles: PlannedAgentFile[];
  skillFiles: PlannedSkillFile[];
  hookFiles: PlannedHookFile[];
  handoffFile?: string;
}

const WINDOWS_DEVICE = /^(con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])(?:\.|$)/i;

function rejectUnsafeEnding(name: string, label: string): void {
  if (/[. ]$/.test(name)) {
    throw new Error(`Unsafe ${label} name has a trailing dot or space: ${name}`);
  }
}

function assertPortableStem(stem: string, label: string): void {
  if (!stem || WINDOWS_DEVICE.test(stem) || /[. ]$/.test(stem)) {
    throw new Error(`Unsafe ${label} filename: ${stem}`);
  }
}

export function sanitizeAgentStem(name: string): string {
  rejectUnsafeEnding(name, "agent");
  const stem = name.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "repo";
  assertPortableStem(stem, "agent");
  return stem;
}

function assertPortableNamedAsset(
  name: string,
  label: "skill" | "hook",
): void {
  const safeName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
  rejectUnsafeEnding(name, label);
  if (!safeName.test(name) || WINDOWS_DEVICE.test(name)) {
    throw new Error(`Unsafe ${label} name: ${name}`);
  }
}

function assertUniquePaths(paths: Array<{ name: string; file: string }>, label: string): void {
  const seen = new Map<string, string>();
  for (const item of paths) {
    const key = path.posix.normalize(item.file).normalize("NFC").toLowerCase();
    const previous = seen.get(key);
    if (previous) {
      throw new Error(
        `${label} filename collision: '${previous}' and '${item.name}' both map to ${item.file}`,
      );
    }
    seen.set(key, item.name);
  }
}

export function createGenerationPlan(
  analysis: AnalysisResult,
  singleAgent: boolean,
): GenerationPlan {
  const rootAgents = analysis.agents.filter((agent) => !agent.isSubAgent);
  if (rootAgents.length > 1) {
    throw new Error("Agent filename collision: multiple root agents map to one orchestrator file");
  }

  const skillFiles = analysis.skills.map((skill) => {
    assertPortableNamedAsset(skill.name, "skill");
    return {
      name: skill.name,
      file: `.github/skills/${skill.name}/SKILL.md`,
      skill,
    };
  });

  const hookFiles = analysis.hooks.map((hook) => {
    assertPortableNamedAsset(hook.name, "hook");
    return {
      name: hook.name,
      file: `.github/hooks/${hook.name}.yaml`,
      hook,
    };
  });

  const hasSubAgents = !singleAgent && analysis.agents.some((agent) => agent.isSubAgent);
  let agentFiles: PlannedAgentFile[];
  if (!hasSubAgents) {
    const rootAgent = analysis.agents.find((agent) => !agent.isSubAgent);
    const stem = sanitizeAgentStem(analysis.repoName);
    agentFiles = [{
      name: rootAgent?.name ?? analysis.repoName,
      file: `.github/agents/${stem}.agent.md`,
      isSubAgent: false,
      agent: rootAgent,
      combined: true,
    }];
  } else {
    const repoStem = sanitizeAgentStem(analysis.repoName);
    const rootAgent = rootAgents[0];
    agentFiles = [{
      name: rootAgent?.name ?? analysis.repoName,
      file: `.github/agents/${repoStem}-root.agent.md`,
      isSubAgent: false,
      agent: rootAgent,
      combined: false,
    }, ...analysis.agents
      .filter((agent) => agent.isSubAgent)
      .map((agent) => ({
        name: agent.name,
        file: `.github/agents/${sanitizeAgentStem(agent.name)}.agent.md`,
        isSubAgent: true,
        agent,
        combined: false,
      }))];
  }

  assertUniquePaths(skillFiles, "Skill");
  assertUniquePaths(hookFiles, "Hook");
  assertUniquePaths(agentFiles, "Agent");

  return {
    agentFiles,
    skillFiles,
    hookFiles,
    handoffFile: hasSubAgents ? ".github/copilot/handoffs.json" : undefined,
  };
}
