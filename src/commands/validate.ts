/**
 * Validate generated Agent Smith assets and their references.
 */

import path from "path";
import chalk from "chalk";
import yaml from "yaml";
import {
  assertPortablePathComponents,
  openContainedRoot,
  readContainedDirectory,
  readContainedFile,
  resolveContainedExistingDirectory,
  resolveContainedExistingFile,
  type ContainedRoot,
} from "../generator/path-safety.js";
import {
  canonicalizeRegistryAssetPath,
  registryPathKey,
  type RegistryAssetType,
} from "../registry/asset-path.js";

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface ValidateOptions {
  verbose?: boolean;
}

function addError(result: ValidationResult, message: string): void {
  result.errors.push(message);
  result.valid = false;
}

function isContained(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === ""
    || (!relative.startsWith(`..${path.sep}`)
      && relative !== ".."
      && !path.isAbsolute(relative));
}

async function openManagedDirectory(
  root: ContainedRoot,
  relativePath: string,
  result: ValidationResult,
  missingMessage: string,
  required: boolean,
): Promise<string | undefined> {
  try {
    return await resolveContainedExistingDirectory(
      root,
      path.join(root.requestedRoot, ...relativePath.split("/")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      if (required) addError(result, missingMessage);
      else result.warnings.push(missingMessage);
    } else {
      addError(result, `${relativePath}: ${(error as Error).message}`);
    }
    return undefined;
  }
}

async function validateReferencedFile(
  root: ContainedRoot,
  reference: string,
  result: ValidationResult,
  label: string,
  baseDirectory = root.requestedRoot,
): Promise<void> {
  const cleanReference = reference.trim().replace(/^<|>$/g, "").split(/[?#]/, 1)[0];
  let decodedReference: string;
  try {
    decodedReference = decodeURIComponent(cleanReference);
  } catch {
    addError(result, `${label}: Invalid referenced path '${reference}'`);
    return;
  }
  if (!decodedReference) return;
  if (/^[a-z][a-z0-9+.-]*:/i.test(decodedReference)) {
    addError(result, `${label}: External referenced paths are not allowed: ${reference}`);
    return;
  }
  try {
    assertPortablePathComponents(decodedReference, "referenced path");
  } catch (error) {
    addError(result, `${label}: ${(error as Error).message}`);
    return;
  }

  const absoluteTarget = path.resolve(baseDirectory, decodedReference);
  if (!isContained(root.requestedRoot, absoluteTarget)) {
    addError(result, `${label}: Referenced path escapes repository: ${reference}`);
    return;
  }
  try {
    await resolveContainedExistingFile(root, absoluteTarget);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      addError(result, `${label}: Missing referenced path: ${reference}`);
    } else {
      addError(
        result,
        `${label}: Unable to validate referenced path '${reference}': ${(error as Error).message}`,
      );
    }
  }
}

async function validateMarkdownLinks(
  root: ContainedRoot,
  filePath: string,
  content: string,
  result: ValidationResult,
): Promise<void> {
  for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
    const reference = match[1].trim().split(/\s+/, 1)[0];
    const cleanReference = reference.replace(/^<|>$/g, "");
    if (/^[a-z][a-z0-9+.-]*:/i.test(cleanReference)) {
      addError(
        result,
        `${path.relative(root.requestedRoot, filePath)}: External referenced paths are not allowed: ${reference}`,
      );
      continue;
    }
    const pathOnly = cleanReference.split(/[?#]/, 1)[0].toLowerCase();
    if (!pathOnly.endsWith("/skill.md") && !pathOnly.endsWith(".agent.md")) continue;
    await validateReferencedFile(
      root,
      reference,
      result,
      path.relative(root.requestedRoot, filePath),
      path.dirname(filePath),
    );
  }
}

function parseFrontmatter(
  content: string,
  label: string,
  result: ValidationResult,
): Record<string, unknown> | undefined {
  if (!content.startsWith("---")) {
    addError(result, `${label}: Missing YAML frontmatter`);
    return undefined;
  }
  const frontmatterEnd = content.indexOf("---", 3);
  if (frontmatterEnd === -1) {
    addError(result, `${label}: Malformed YAML frontmatter`);
    return undefined;
  }
  try {
    const parsed = yaml.parse(content.slice(4, frontmatterEnd).trim());
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch (error) {
    addError(result, `${label}: Invalid YAML - ${(error as Error).message}`);
    return undefined;
  }
}

export async function validateCommand(
  targetPath = ".",
  options: ValidateOptions = {},
): Promise<void> {
  const result: ValidationResult = { valid: true, errors: [], warnings: [] };
  const root = await openContainedRoot(path.resolve(targetPath));
  console.log(chalk.green("\n[VALIDATE]"), "Checking agent assets...\n");

  await validateSkills(root, result, options.verbose);
  await validateAgents(root, result, options.verbose);
  await validateHooks(root, result, options.verbose);
  await validateRegistry(root, result, options.verbose);

  console.log("");
  if (result.errors.length > 0) {
    console.log(chalk.red(`\n✗ Validation failed with ${result.errors.length} error(s):`));
    for (const error of result.errors) console.log(chalk.red(`  • ${error}`));
  }
  if (result.warnings.length > 0) {
    console.log(chalk.yellow(`\n⚠ ${result.warnings.length} warning(s):`));
    for (const warning of result.warnings) console.log(chalk.yellow(`  • ${warning}`));
  }
  if (result.valid) {
    console.log(chalk.green("\n✓ All agent assets are valid."));
  } else {
    process.exitCode = 1;
  }
}

async function validateSkills(
  root: ContainedRoot,
  result: ValidationResult,
  verbose?: boolean,
): Promise<void> {
  const skillsDir = await openManagedDirectory(
    root,
    ".github/skills",
    result,
    "No .github/skills/ directory found",
    false,
  );
  if (!skillsDir) return;

  const entries = await readContainedDirectory(root, skillsDir);
  const skillDirs = entries.filter((entry) => entry.isDirectory() || entry.isSymbolicLink());
  if (skillDirs.length === 0) {
    result.warnings.push("No skills found in .github/skills/");
    return;
  }

  let validated = 0;
  for (const entry of skillDirs) {
    const label = `${entry.name}/SKILL.md`;
    try {
      assertPortablePathComponents(entry.name, "skill path");
      const skillDir = await resolveContainedExistingDirectory(root, path.join(skillsDir, entry.name));
      const skillFile = await resolveContainedExistingFile(root, path.join(skillDir, "SKILL.md"));
      const content = await readContainedFile(root, skillFile);
      const meta = parseFrontmatter(content, label, result);
      if (!meta) continue;
      if (!meta.name) addError(result, `${label}: Missing 'name' in frontmatter`);
      if (!meta.description) result.warnings.push(`${label}: Missing 'description' in frontmatter`);
      validated++;
      if (verbose) console.log(chalk.green(`  ✓ skills/${entry.name}/SKILL.md`));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      addError(result, `${entry.name}: ${code === "ENOENT" ? "Missing SKILL.md file" : (error as Error).message}`);
    }
  }
  if (!verbose) console.log(chalk.gray(`  Validated ${validated} skill(s)`));
}

async function validateAgents(
  root: ContainedRoot,
  result: ValidationResult,
  verbose?: boolean,
): Promise<void> {
  const agentsDir = await openManagedDirectory(
    root,
    ".github/agents",
    result,
    "No .github/agents/ directory found",
    true,
  );
  if (!agentsDir) return;

  const entries = await readContainedDirectory(root, agentsDir);
  const agentFiles = entries.filter(
    (entry) => (entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".agent.md"),
  );
  let validated = 0;
  for (const entry of agentFiles) {
    try {
      assertPortablePathComponents(entry.name, "agent path");
      const agentFile = await resolveContainedExistingFile(root, path.join(agentsDir, entry.name));
      const content = await readContainedFile(root, agentFile);
      const meta = parseFrontmatter(content, entry.name, result);
      if (!meta) continue;
      if (!meta.name) addError(result, `${entry.name}: Missing 'name' in frontmatter`);
      if (!meta.description) result.warnings.push(`${entry.name}: Missing 'description' in frontmatter`);
      if (meta.tools && !Array.isArray(meta.tools)) {
        addError(result, `${entry.name}: 'tools' must be an array`);
      }
      await validateMarkdownLinks(root, agentFile, content, result);
      validated++;
      if (verbose) console.log(chalk.green(`  ✓ agents/${entry.name}`));
    } catch (error) {
      addError(result, `${entry.name}: ${(error as Error).message}`);
    }
  }
  if (validated === 0) addError(result, "No .agent.md files found in .github/agents/");
  if (!verbose) console.log(chalk.gray(`  Validated ${validated} agent(s)`));
}

async function validateHooks(
  root: ContainedRoot,
  result: ValidationResult,
  verbose?: boolean,
): Promise<void> {
  const hooksDir = await openManagedDirectory(
    root,
    ".github/hooks",
    result,
    "No hooks directory",
    false,
  );
  if (!hooksDir) return;
  const validEvents = ["pre-commit", "post-commit", "pre-push", "pre-analyze", "post-generate"];
  const entries = await readContainedDirectory(root, hooksDir);
  const hookFiles = entries.filter(
    (entry) => (entry.isFile() || entry.isSymbolicLink())
      && (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml")),
  );
  for (const entry of hookFiles) {
    const label = `hooks/${entry.name}`;
    try {
      assertPortablePathComponents(entry.name, "hook path");
      const hookPath = await resolveContainedExistingFile(root, path.join(hooksDir, entry.name));
      const hook = yaml.parse(await readContainedFile(root, hookPath));
      if (!hook?.name) addError(result, `${label}: Missing 'name' field`);
      if (!hook?.event) {
        addError(result, `${label}: Missing 'event' field`);
      } else if (!validEvents.includes(hook.event)) {
        addError(result, `${label}: Invalid event '${hook.event}'. Must be one of: ${validEvents.join(", ")}`);
      }
      if (!Array.isArray(hook?.commands) || hook.commands.length === 0) {
        addError(result, `${label}: Missing or empty 'commands' array`);
      }
      if (verbose) console.log(chalk.green(`  ✓ ${label}`));
    } catch (error) {
      addError(result, `${label}: ${(error as Error).message}`);
    }
  }
  if (!verbose) console.log(chalk.gray(`  Validated ${hookFiles.length} hook(s)`));
}

async function validateRegistry(
  root: ContainedRoot,
  result: ValidationResult,
  verbose?: boolean,
): Promise<void> {
  const registryPath = path.join(root.requestedRoot, "skills-registry.jsonl");
  let content: string;
  try {
    content = await readContainedFile(root, registryPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      result.warnings.push("No skills-registry.jsonl found");
    } else {
      addError(result, `skills-registry.jsonl: ${(error as Error).message}`);
    }
    return;
  }

  const lines = content.trim().split("\n").filter((line) => line.trim());
  if (lines.length === 0) {
    result.warnings.push("skills-registry.jsonl is empty");
    return;
  }
  const seenNames = new Set<string>();
  const seenPaths = new Set<string>();

  for (let index = 0; index < lines.length; index++) {
    const lineLabel = `skills-registry.jsonl line ${index + 1}`;
    try {
      const entry = JSON.parse(lines[index]) as Record<string, unknown>;
      if (
        typeof entry.name !== "string"
        || (entry.type !== "skill" && entry.type !== "agent")
        || typeof entry.file !== "string"
        || !entry.name
        || !entry.file
      ) {
        addError(result, `${lineLabel}: Missing or invalid 'name', 'type', or 'file'`);
        continue;
      }
      const type = entry.type as RegistryAssetType;
      let canonical: string;
      try {
        canonical = canonicalizeRegistryAssetPath(entry.file, type);
      } catch (error) {
        addError(result, `${lineLabel} (${type} '${entry.name}'): ${(error as Error).message}`);
        continue;
      }
      const nameKey = `${type}:${entry.name.normalize("NFC").toLowerCase()}`;
      const pathKey = registryPathKey(canonical);
      if (seenNames.has(nameKey)) addError(result, `${lineLabel}: Duplicate registry name: ${entry.name}`);
      if (seenPaths.has(pathKey)) addError(result, `${lineLabel}: Duplicate registry path: ${canonical}`);
      seenNames.add(nameKey);
      seenPaths.add(pathKey);
      await validateReferencedFile(
        root,
        canonical,
        result,
        `${lineLabel} (${type} '${entry.name}')`,
      );

      if (entry.vsCodeAgent !== undefined) {
        if (type !== "agent" || typeof entry.vsCodeAgent !== "string") {
          addError(result, `${lineLabel}: Only agent entries may define a string 'vsCodeAgent'`);
        } else {
          try {
            const agentPath = canonicalizeRegistryAssetPath(entry.vsCodeAgent, "agent");
            if (agentPath !== canonical) {
              addError(result, `${lineLabel}: 'vsCodeAgent' must match the agent file path`);
            }
          } catch (error) {
            addError(result, `${lineLabel}: ${(error as Error).message}`);
          }
        }
      }
    } catch {
      addError(result, `${lineLabel}: Invalid JSON`);
    }
  }

  const message = `skills-registry.jsonl (${lines.length} entries)`;
  console.log(verbose ? chalk.green(`  ✓ ${message}`) : chalk.gray(`  Validated registry (${lines.length} entries)`));
}
