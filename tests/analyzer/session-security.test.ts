import { CopilotClient } from "@github/copilot-sdk";
import { describe, expect, it } from "vitest";
import {
  createSecureAnalysisSessionConfig,
  denyAllAnalysisPermissions,
} from "../../src/analyzer/session-security.js";

describe("analysis session security", () => {
  it("rejects every permission request", async () => {
    const result = await denyAllAnalysisPermissions(
      { kind: "shell", command: "echo unsafe" },
      { sessionId: "session-1" },
    );

    expect(result).toEqual({
      kind: "reject",
      feedback: "Repository analysis sessions do not permit tool execution.",
    });
  });

  it("exposes no custom, built-in, or discovered tools", () => {
    const config = createSecureAnalysisSessionConfig("analyze only");

    expect(config.tools).toEqual([]);
    expect(config.availableTools).toEqual([]);
    expect(config.onPermissionRequest).toBe(denyAllAnalysisPermissions);
  });

  it("uses a tool filter accepted by the installed Copilot SDK", () => {
    const client = new CopilotClient() as unknown as {
      resolveToolFilterOptions(config: {
        availableTools?: string[];
      }): { availableTools?: string[] };
    };
    const config = createSecureAnalysisSessionConfig("analyze only");

    expect(() => client.resolveToolFilterOptions(config)).not.toThrow();
    expect(client.resolveToolFilterOptions(config).availableTools).toEqual([]);
  });
});
