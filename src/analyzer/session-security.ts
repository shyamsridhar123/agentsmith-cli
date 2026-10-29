import type { PermissionHandler } from "@github/copilot-sdk";

/**
 * Model for analysis sessions. Returns undefined when AGENTSMITH_MODEL is unset
 * so Copilot picks its own default instead of a model the account may not have.
 */
export function resolveAnalysisModel(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env.AGENTSMITH_MODEL?.trim() || undefined;
}

export const denyAllAnalysisPermissions: PermissionHandler = () => ({
  kind: "reject",
  feedback: "Repository analysis sessions do not permit tool execution.",
});

export function createSecureAnalysisSessionConfig(systemMessage: string) {
  return {
    systemMessage: {
      content: systemMessage,
    },
    tools: [],
    availableTools: [] as string[],
    onPermissionRequest: denyAllAnalysisPermissions,
  };
}
