import {
  isCLIImplementationPath,
  normalizeRepositoryPath,
} from "./paths.js";

export type CLIFramework =
  | "commander"
  | "yargs"
  | "oclif"
  | "cobra"
  | "click"
  | "typer"
  | "argparse"
  | "convention-based";

export interface CLIDetectionResult {
  framework: CLIFramework | null;
  entryFiles: string[];
}

export const CLI_METADATA_FILES = [
  "package.json",
  "go.mod",
  "pyproject.toml",
  "requirements.txt",
  "setup.py",
] as const;

function normalizedContents(
  contents: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  return new Map(
    Array.from(contents, ([filePath, content]) => [
      normalizeRepositoryPath(filePath),
      content,
    ]),
  );
}

function detectFrameworkFromMetadata(
  contents: ReadonlyMap<string, string>,
): CLIFramework | null {
  const packageJson = contents.get("package.json");
  if (packageJson) {
    try {
      const pkg = JSON.parse(packageJson) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
      if ("commander" in dependencies) return "commander";
      if ("yargs" in dependencies) return "yargs";
      if ("@oclif/core" in dependencies || "oclif" in dependencies) return "oclif";
    } catch {
      // Source inspection below provides the fallback.
    }
  }

  const goMod = contents.get("go.mod") ?? "";
  if (goMod.includes("github.com/spf13/cobra")) return "cobra";

  const pythonMetadata = [
    contents.get("pyproject.toml") ?? "",
    contents.get("requirements.txt") ?? "",
    contents.get("setup.py") ?? "",
  ].join("\n").toLowerCase();
  if (/\btyper\b/.test(pythonMetadata)) return "typer";
  if (/\bclick\b/.test(pythonMetadata)) return "click";

  return null;
}

function detectFrameworkFromSource(
  contents: ReadonlyMap<string, string>,
): CLIFramework | null {
  const source = Array.from(contents)
    .filter(([filePath]) => isCLIImplementationPath(filePath))
    .map(([, content]) => content)
    .join("\n");

  if (/(?:from\s+["']commander["']|require\(\s*["']commander["'])/.test(source)) {
    return "commander";
  }
  if (/(?:from\s+["']yargs|require\(\s*["']yargs)/.test(source)) return "yargs";
  if (/@oclif\/core|extends\s+Command\b/.test(source)) return "oclif";
  if (/github\.com\/spf13\/cobra|cobra\.Command/.test(source)) return "cobra";
  if (/(?:import\s+typer|from\s+typer\s+import)/.test(source)) return "typer";
  if (/(?:import\s+click|from\s+click\s+import)/.test(source)) return "click";
  if (/(?:import\s+argparse|from\s+argparse\s+import)/.test(source)) return "argparse";
  return null;
}

function packageBinEntries(contents: ReadonlyMap<string, string>): string[] {
  const packageJson = contents.get("package.json");
  if (!packageJson) return [];

  try {
    const pkg = JSON.parse(packageJson) as {
      bin?: string | Record<string, string>;
    };
    if (typeof pkg.bin === "string") return [pkg.bin];
    if (pkg.bin && typeof pkg.bin === "object") return Object.values(pkg.bin);
  } catch {
    // Invalid package metadata does not prevent source-based detection.
  }
  return [];
}

export function isLikelyCLIEntrypointPath(filePath: string): boolean {
  const normalized = normalizeRepositoryPath(filePath);
  if (!isCLIImplementationPath(normalized)) return false;

  return (
    /^(?:(?:src|lib|app|bin|scripts)\/)?(?:cli|main|index)\.(?:ts|tsx|js|jsx|py|go)$/i.test(normalized) ||
    /(^|\/)cmd\/[^/]+\/main\.go$/i.test(normalized) ||
    /(^|\/)cmd\/root\.go$/i.test(normalized) ||
    /(^|\/)__main__\.py$/i.test(normalized)
  );
}

export function selectCLIImplementationFiles(
  filePaths: Iterable<string>,
  entryFiles: Iterable<string> = [],
): string[] {
  const entries = new Set(Array.from(entryFiles, normalizeRepositoryPath));
  return Array.from(new Set(Array.from(filePaths, normalizeRepositoryPath)))
    .filter((filePath) =>
      isCLIImplementationPath(filePath) &&
      (
        entries.has(filePath) ||
        isLikelyCLIEntrypointPath(filePath) ||
        /(^|\/)(?:commands|cmd|cli)(?:\/|$)/i.test(filePath)
      )
    )
    .sort();
}

export function detectCLIFrameworkAndEntrypoints(
  filePaths: Iterable<string>,
  contents: ReadonlyMap<string, string> = new Map(),
): CLIDetectionResult {
  const normalizedPaths = Array.from(new Set(Array.from(filePaths, normalizeRepositoryPath)));
  const implementationPaths = normalizedPaths.filter(isCLIImplementationPath);
  const implementationSet = new Set(implementationPaths);
  const metadata = normalizedContents(contents);
  const entryFiles = new Set<string>();

  const addEntry = (candidate: string): void => {
    const normalized = normalizeRepositoryPath(candidate);
    if (implementationSet.has(normalized)) entryFiles.add(normalized);
  };

  packageBinEntries(metadata).forEach(addEntry);
  implementationPaths.filter(isLikelyCLIEntrypointPath).forEach(addEntry);

  let framework =
    detectFrameworkFromMetadata(metadata) ??
    detectFrameworkFromSource(metadata);

  if (
    !framework &&
    implementationPaths.some((filePath) =>
      filePath === "cli.py" ||
      filePath === "__main__.py" ||
      filePath.endsWith("/cli.py") ||
      filePath.endsWith("/__main__.py")
    )
  ) {
    framework = "argparse";
  }

  if (
    !framework &&
    implementationPaths.some((filePath) => /(^|\/)(?:commands|cmd)(?:\/|$)/i.test(filePath))
  ) {
    framework = "convention-based";
  }

  return {
    framework,
    entryFiles: Array.from(entryFiles).sort(),
  };
}
