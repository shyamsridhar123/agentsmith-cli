import path from "path";
import {
  CLI_METADATA_FILES,
  createRepositorySnapshot,
  detectCLIFrameworkAndEntrypoints,
  isCLIImplementationPath,
  normalizeRepositoryPath,
  selectCLIImplementationFiles,
  type RepositorySnapshot,
  type ScanResult,
} from "../scanner/index.js";
import type {
  CLICommandDefinition,
  CLIStructure,
  SkillDefinition,
} from "./types.js";
import { extractCLICommands } from "./cli-extractors.js";

const MAX_CLI_METADATA_BYTES = 512 * 1024;
const MAX_CLI_SOURCE_BYTES = 256 * 1024;
const MAX_CLI_SNAPSHOT_BYTES = 8 * 1024 * 1024;

function normalized(filePath: string): string {
  return normalizeRepositoryPath(filePath);
}

export function buildCLITextByteLimits(
  scanResult: ScanResult,
): ReadonlyMap<string, number> {
  const files = new Map(
    scanResult.files.map((file) => [
      normalized(file.relativePath),
      file,
    ]),
  );
  const entryFiles = scanResult.cliEntryFiles
    .map(normalized)
    .filter((file) => files.has(file));
  const implementationFiles = selectCLIImplementationFiles(
    files.keys(),
    entryFiles,
  );
  const candidates = Array.from(new Set([
    ...CLI_METADATA_FILES.filter((file) => files.has(file)),
    ...entryFiles,
    ...implementationFiles,
  ]));
  const limits = new Map<string, number>();
  let remaining = MAX_CLI_SNAPSHOT_BYTES;

  for (const filePath of candidates) {
    if (remaining <= 0) break;
    const maximum = (CLI_METADATA_FILES as readonly string[]).includes(filePath)
      ? MAX_CLI_METADATA_BYTES
      : MAX_CLI_SOURCE_BYTES;
    const limit = Math.min(
      maximum,
      Math.max(0, files.get(filePath)?.size ?? maximum),
      remaining,
    );
    limits.set(filePath, limit);
    remaining -= limit;
  }
  return limits;
}

export async function analyzeCLIStructure(
  scanResult: ScanResult,
  repositorySnapshot?: RepositorySnapshot,
): Promise<CLIStructure | undefined> {
  const snapshot = repositorySnapshot ?? await createRepositorySnapshot(
    scanResult.rootPath,
    scanResult.files.map((file) => file.relativePath),
    {
      computeDigests: false,
      textByteLimits: buildCLITextByteLimits(scanResult),
    },
  );
  const availablePaths = scanResult.files
    .map((file) => normalized(file.relativePath))
    .filter((file) => snapshot.files.has(file));
  const allContents = new Map<string, string>();
  for (const [relativePath, file] of snapshot.files) {
    if (file.text !== undefined) {
      allContents.set(relativePath, file.text);
    }
  }
  const detected = detectCLIFrameworkAndEntrypoints(
    availablePaths,
    allContents,
  );
  const framework = detected.framework ?? scanResult.cliFramework ?? undefined;
  if (!framework) return undefined;
  const entryFiles = detected.entryFiles.length > 0
    ? detected.entryFiles
    : scanResult.cliEntryFiles
      .map(normalized)
      .filter((file) => snapshot.files.has(file));

  const likelyPaths = new Set(selectCLIImplementationFiles(
    availablePaths,
    entryFiles,
  ));
  const likelyCommandFiles = scanResult.files.filter((file) =>
    !file.isTest && likelyPaths.has(normalized(file.relativePath))
  );

  const contents = new Map<string, string>();
  for (const file of likelyCommandFiles.slice(0, 100)) {
    const relativePath = normalized(file.relativePath);
    const content = snapshot.files.get(relativePath)?.text;
    if (content !== undefined) contents.set(relativePath, content);
  }

  return analyzeCLIContents(
    framework,
    entryFiles,
    scanResult.testFiles,
    contents,
  );
}

export function analyzeCLIContents(
  framework: string,
  entryFiles: string[],
  testFiles: string[],
  contents: ReadonlyMap<string, string>,
): CLIStructure {
  const commands: CLICommandDefinition[] = [];
  for (const [file, content] of contents) {
    const normalizedFile = normalized(file);
    if (!isCLIImplementationPath(normalizedFile)) continue;
    commands.push(...extractCLICommands(framework, normalizedFile, content));
  }
  const uniqueCommands = Array.from(
    new Map(commands.map((command) => [`${command.name}:${command.file}`, command])).values(),
  );
  const extensionPoints = Array.from(new Set(
    uniqueCommands.map((command) => path.posix.dirname(command.file)),
  )).filter((dir) => dir !== ".");

  return {
    framework,
    entryFiles,
    commands: uniqueCommands,
    extensionPoints,
    testFiles: testFiles.filter((file) => /cli|command|cmd/i.test(file)),
  };
}

export function generateCLISkills(cli: CLIStructure): SkillDefinition[] {
  const commandSummary = cli.commands.length > 0
    ? cli.commands.map((command) => {
      const optionNames = command.options.map((option) => `--${option.name}`).join(", ");
      return `${command.name} (${command.file})${optionNames ? ` options: ${optionNames}` : ""}`;
    })
    : ["Inspect the entry files to discover the command tree"];
  const sourceDir = cli.extensionPoints[0] || path.posix.dirname(cli.entryFiles[0] || ".");
  const references = Array.from(new Set([
    ...cli.entryFiles,
    ...cli.commands.map((command) => command.file),
  ])).slice(0, 20);

  return [
    {
      name: "cli-structure",
      description: `Command hierarchy and conventions for this ${cli.framework} CLI`,
      sourceDir,
      patterns: commandSummary,
      triggers: ["cli", "command", "subcommand", "help"],
      category: "architecture",
      examples: [],
      antiPatterns: [
        "Do not add a command without registering it in the existing command tree",
        "Do not introduce flags that conflict with existing global options",
      ],
      codebaseReferences: references,
      cliFocused: true,
    },
    {
      name: "cli-options",
      description: "Option naming, validation, help, and exit-code conventions",
      sourceDir,
      patterns: [
        "Follow the existing long and short option naming conventions",
        "Validate command input before side effects",
        "Keep help text and examples synchronized with behavior",
      ],
      triggers: ["flag", "option", "argument", "validation", "exit code"],
      category: "patterns",
      examples: [],
      antiPatterns: [
        "Do not read secrets from command-line flags",
        "Do not emit machine-readable data mixed with progress output",
      ],
      codebaseReferences: references,
      cliFocused: true,
    },
    {
      name: "cli-testing",
      description: "How commands, options, output, and failures are verified",
      sourceDir: cli.testFiles.length > 0
        ? path.posix.dirname(normalized(cli.testFiles[0]))
        : sourceDir,
      patterns: cli.testFiles.length > 0
        ? cli.testFiles.map((file) => `Use ${normalized(file)} as a command-test reference`)
        : ["Test successful output, invalid input, help output, and non-zero failure exits"],
      triggers: ["cli test", "command test", "smoke test", "integration test"],
      category: "quality",
      examples: [],
      antiPatterns: [
        "Do not run destructive commands against real user data in tests",
        "Do not assert ANSI styling when plain output is the contract",
      ],
      codebaseReferences: cli.testFiles,
      cliFocused: true,
    },
  ];
}

export function mergeCLISkills(
  existing: SkillDefinition[],
  generated: SkillDefinition[],
): SkillDefinition[] {
  const merged = new Map(existing.map((skill) => [skill.name, skill]));
  for (const skill of generated) {
    if (!merged.has(skill.name)) merged.set(skill.name, skill);
  }
  return Array.from(merged.values());
}
