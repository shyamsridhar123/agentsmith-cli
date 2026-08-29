import path from "path";
import {
  resolveContainedExistingFile,
  type ContainedRoot,
} from "../generator/path-safety.js";

export type RegistryAssetType = "skill" | "agent";

const EXTERNAL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const WINDOWS_DEVICE = /^(con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])(?:\.|$)/i;

function assertPortableAssetComponents(
  normalized: string,
  type: RegistryAssetType,
): void {
  const assetName = normalized.split("/")[2];
  const portableName = type === "agent"
    ? assetName?.slice(0, -".agent.md".length)
    : assetName;
  if (!portableName || /[. ]$/.test(portableName) || WINDOWS_DEVICE.test(portableName)) {
    throw new Error(`Unsafe Windows ${type} registry path: ${normalized}`);
  }
}

export function canonicalizeRegistryAssetPath(
  file: string,
  type: RegistryAssetType,
): string {
  if (!file || file !== file.trim() || EXTERNAL_SCHEME.test(file)) {
    throw new Error(`Unsafe ${type} registry path: ${file}`);
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(file);
  } catch {
    throw new Error(`Unsafe ${type} registry path: ${file}`);
  }
  const slashed = decoded.replace(/\\/g, "/");
  if (slashed.split("/").some((component) => component.includes(":"))) {
    throw new Error(`Unsafe ${type} registry path contains an NTFS stream separator: ${file}`);
  }
  const normalized = path.posix.normalize(slashed);
  if (
    normalized !== slashed
    || path.posix.isAbsolute(normalized)
    || normalized === ".."
    || normalized.startsWith("../")
  ) {
    throw new Error(`Unsafe ${type} registry path: ${file}`);
  }

  const matchesType = type === "skill"
    ? /^\.github\/skills\/[^/]+\/SKILL\.md$/.test(normalized)
    : /^\.github\/agents\/[^/]+\.agent\.md$/.test(normalized);
  if (!matchesType) {
    throw new Error(`Wrong asset type for ${type} registry path: ${file}`);
  }
  assertPortableAssetComponents(normalized, type);
  return normalized;
}

export function registryPathKey(file: string): string {
  return file.normalize("NFC").toLowerCase();
}

export async function assertRegistryAssetExists(
  root: ContainedRoot,
  file: string,
  type: RegistryAssetType,
): Promise<string> {
  const canonical = canonicalizeRegistryAssetPath(file, type);
  await resolveContainedExistingFile(
    root,
    path.join(root.requestedRoot, ...canonical.split("/")),
  );
  return canonical;
}
