import path from "path";
import fs from "fs/promises";
import type { ScanResult } from "../scanner/index.js";
import type {
  CLICommandDefinition,
  CLIOptionDefinition,
  CLIStructure,
  SkillDefinition,
} from "./types.js";

const SOURCE_EXTENSIONS = /\.(?:ts|tsx|js|jsx|py|go)$/;

function normalized(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function commandNameFromPath(filePath: string): string {
  const withoutExtension = path.posix.basename(normalized(filePath)).replace(SOURCE_EXTENSIONS, "");
  return withoutExtension === "index" || withoutExtension === "main"
    ? path.posix.basename(path.posix.dirname(normalized(filePath)))
    : withoutExtension;
}

function extractOptions(content: string): CLIOptionDefinition[] {
  const options = new Map<string, CLIOptionDefinition>();
  const patterns = [
    /\.option\(\s*["'`]([^"'`]+)["'`]\s*(?:,\s*["'`]([^"'`]*)["'`])?/g,
    /(?:click|typer)\.option\(\s*["'`]([^"'`]+)["'`]/g,
    /\.(?:String|Bool|Int|StringP|BoolP|IntP)\(\s*["'`]([^"'`]+)["'`]\s*(?:,\s*["'`]([^"'`]*)["'`])?/g,
    /add_argument\(\s*["'`]([^"'`]+)["'`]/g,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const declaration = match[1];
      const names = declaration.split(/[,\s|]+/).filter((part) => part.startsWith("-"));
      const long = names.find((part) => part.startsWith("--"))?.replace(/^--/, "");
      const short = names.find((part) => /^-[^-]/.test(part))?.replace(/^-/, "");
      const fallback = declaration.replace(/^-+/, "").split(/[ <[]/)[0];
      const name = long || fallback;
      if (!name) continue;
      options.set(name, {
        name,
        short,
        description: match[2] || undefined,
        required: /[<{][^}>]+[}>]/.test(declaration),
      });
    }
  }

  return Array.from(options.values());
}

function extractDeclaredCommands(content: string): string[] {
  const names = new Set<string>();
  const patterns = [
    /\.command\(\s*["'`]([^"'`\s<[\]]+)/g,
    /(?:use|Use)\s*:\s*["'`]([^"'`\s]+)/g,
    /@(?:\w+\.)?command\(\s*(?:name\s*=\s*)?["'`]([^"'`]+)["'`]/g,
    /add_parser\(\s*["'`]([^"'`]+)["'`]/g,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) names.add(match[1]);
  }
  return Array.from(names);
}

export async function analyzeCLIStructure(scanResult: ScanResult): Promise<CLIStructure | undefined> {
  if (!scanResult.cliFramework) return undefined;

  const likelyCommandFiles = scanResult.files.filter((file) => {
    const relative = normalized(file.relativePath);
    return SOURCE_EXTENSIONS.test(relative) && (
      scanResult.cliEntryFiles.includes(relative) ||
      /(^|\/)(commands|cmd|cli)\//.test(relative) ||
      /(^|\/)(cli|main|index)\.(ts|tsx|js|jsx|py|go)$/.test(relative)
    );
  });

  const contents = new Map<string, string>();
  for (const file of likelyCommandFiles.slice(0, 100)) {
    try {
      contents.set(normalized(file.relativePath), await fs.readFile(file.path, "utf-8"));
    } catch {
      // Skip unreadable source files.
    }
  }

  return analyzeCLIContents(
    scanResult.cliFramework,
    scanResult.cliEntryFiles,
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
    if (!SOURCE_EXTENSIONS.test(normalized(file))) continue;
    const declared = extractDeclaredCommands(content);
    const names = declared.length > 0 ? declared : [commandNameFromPath(file)];
    for (const name of names) {
      if (!name || name === "." || name === "src") continue;
      commands.push({ name, file: normalized(file), options: extractOptions(content) });
    }
  }
  const uniqueCommands = Array.from(
    new Map(commands.map((command) => [`${command.name}:${command.file}`, command])).values(),
  );
  const extensionPoints = Array.from(new Set(
    Array.from(contents.keys())
      .filter((file) => SOURCE_EXTENSIONS.test(normalized(file)))
      .map((file) => path.posix.dirname(normalized(file))),
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
