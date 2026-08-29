import path from "path";
import type { CLIOptionDefinition } from "./types.js";

const SOURCE_EXTENSIONS = /\.(?:ts|tsx|js|jsx|py|go)$/i;

export interface PositionedCommand {
  name: string;
  start: number;
  receiver?: string;
}

export function stringLiterals(value: string): string[] {
  const values: string[] = [];
  for (const match of value.matchAll(
    /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|`((?:\\.|[^`\\])*)`/g,
  )) {
    values.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return values;
}

export function matchingDelimiter(
  content: string,
  start: number,
  open: string,
  close: string,
): number {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const character = content[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
    } else if (character === open) {
      depth += 1;
    } else if (character === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return content.length - 1;
}

export function callBody(content: string, openParen: number): string {
  const closeParen = matchingDelimiter(content, openParen, "(", ")");
  return content.slice(openParen + 1, closeParen);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let quote = "";
  let escaped = false;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
    } else if (character === "'" || character === '"' || character === "`") {
      quote = character;
    } else if ("([{".includes(character)) {
      depth += 1;
    } else if (")]}".includes(character)) {
      depth = Math.max(0, depth - 1);
    } else if (character === "," && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

export function expressionEnd(
  content: string,
  start: number,
  limit: number,
): number {
  let quote = "";
  let escaped = false;
  let depth = 0;
  for (let index = start; index < limit; index += 1) {
    const character = content[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
    } else if (character === "'" || character === '"' || character === "`") {
      quote = character;
    } else if ("([{".includes(character)) {
      depth += 1;
    } else if (")]}".includes(character)) {
      depth = Math.max(0, depth - 1);
    } else if (character === ";" && depth === 0) {
      return index + 1;
    }
  }
  return limit;
}

export function optionFromDeclaration(
  declaration: string,
  description?: string,
  required?: boolean,
  alias?: string,
): CLIOptionDefinition | undefined {
  const names = declaration
    .split(/[,\s|]+/)
    .filter((part) => part.startsWith("-"));
  const long = names.find((part) => part.startsWith("--"))?.replace(/^--/, "");
  const short = alias ??
    names.find((part) => /^-[^-]/.test(part))?.replace(/^-/, "");
  const fallback = declaration.replace(/^-+/, "").split(/[ <[]/)[0];
  const name = long || fallback;
  if (!name) return undefined;

  const option: CLIOptionDefinition = {
    name,
    required: required ?? /[<{][^}>]+[}>]/.test(declaration),
  };
  if (short) option.short = short;
  if (description) option.description = description;
  return option;
}

export function commandNameFromPath(file: string, oclif = false): string {
  const normalized = file.replace(/\\/g, "/");
  if (oclif) {
    const segments = normalized.split("/");
    const commandsIndex = segments.lastIndexOf("commands");
    if (commandsIndex >= 0) {
      const commandSegments = segments.slice(commandsIndex + 1);
      commandSegments[commandSegments.length - 1] =
        commandSegments.at(-1)?.replace(SOURCE_EXTENSIONS, "") ?? "";
      if (commandSegments.at(-1) === "index") commandSegments.pop();
      return commandSegments.filter(Boolean).join(":");
    }
  }

  const withoutExtension = path.posix
    .basename(normalized)
    .replace(SOURCE_EXTENSIONS, "");
  return withoutExtension === "index" || withoutExtension === "main"
    ? path.posix.basename(path.posix.dirname(normalized))
    : withoutExtension;
}
