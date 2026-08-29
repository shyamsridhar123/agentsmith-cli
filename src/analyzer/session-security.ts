import type { PermissionHandler } from "@github/copilot-sdk";

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
