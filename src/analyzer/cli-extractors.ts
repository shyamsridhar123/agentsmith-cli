import type { CLICommandDefinition } from "./types.js";
import { commandNameFromPath } from "./cli-extractor-helpers.js";
import {
  extractCommanderCommands,
  extractOclifCommand,
  extractYargsCommands,
} from "./cli-extractors-js.js";
import {
  extractArgparseCommands,
  extractDecoratedPythonCommands,
} from "./cli-extractors-python.js";
import { extractCobraCommands } from "./cli-extractors-cobra.js";

export function extractCLICommands(
  framework: string,
  file: string,
  content: string,
): CLICommandDefinition[] {
  switch (framework) {
    case "commander":
      return extractCommanderCommands(file, content);
    case "yargs":
      return extractYargsCommands(file, content);
    case "oclif":
      return extractOclifCommand(file, content);
    case "cobra":
      return extractCobraCommands(file, content);
    case "click":
    case "typer":
      return extractDecoratedPythonCommands(file, content, framework);
    case "argparse":
      return extractArgparseCommands(file, content);
    case "convention-based": {
      const name = commandNameFromPath(file);
      return name ? [{ name, file, options: [] }] : [];
    }
    default:
      return [];
  }
}
