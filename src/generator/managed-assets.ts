import crypto from "crypto";

export const AGENTSMITH_MANAGED_MARKER = "agentsmith:generated:v1";

export type ManagedAssetKind = "agent" | "skill" | "hook" | "handoff";

export function managedAssetKind(file: string): ManagedAssetKind | undefined {
  const normalized = file.replace(/\\/g, "/");
  if (/^\.github\/agents\/[^/]+\.agent\.md$/.test(normalized)) return "agent";
  if (/^\.github\/skills\/[^/]+\/SKILL\.md$/.test(normalized)) return "skill";
  if (/^\.github\/hooks\/[^/]+\.ya?ml$/.test(normalized)) return "hook";
  if (normalized === ".github/copilot/handoffs.json") return "handoff";
  return undefined;
}

export function markManagedAsset(file: string, content: string): string {
  const kind = managedAssetKind(file);
  if (kind === "agent" || kind === "skill") {
    return `${content.trimEnd()}\n\n<!-- ${AGENTSMITH_MANAGED_MARKER} -->\n`;
  }
  if (kind === "hook") {
    return content.includes(`# ${AGENTSMITH_MANAGED_MARKER}`)
      ? content
      : `# ${AGENTSMITH_MANAGED_MARKER}\n${content}`;
  }
  if (kind === "handoff") {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return `${JSON.stringify({
      ...parsed,
      _agentsmith: {
        marker: AGENTSMITH_MANAGED_MARKER,
      },
    }, null, 2)}\n`;
  }
  throw new Error(`Unsupported AgentSmith managed asset path: ${file}`);
}

export function hasManagedAssetMarker(file: string, content: string): boolean {
  const kind = managedAssetKind(file);
  if (kind === "agent" || kind === "skill") {
    return content.includes(`<!-- ${AGENTSMITH_MANAGED_MARKER} -->`);
  }
  if (kind === "hook") {
    return content.includes(`# ${AGENTSMITH_MANAGED_MARKER}`);
  }
  if (kind === "handoff") {
    try {
      const parsed = JSON.parse(content) as {
        _agentsmith?: { marker?: unknown };
      };
      return parsed._agentsmith?.marker === AGENTSMITH_MANAGED_MARKER;
    } catch {
      return false;
    }
  }
  return false;
}

export function digestManagedContent(content: string | Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}
