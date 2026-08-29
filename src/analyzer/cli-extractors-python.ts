import type {
  CLICommandDefinition,
  CLIOptionDefinition,
} from "./types.js";
import {
  callBody,
  commandNameFromPath,
  escapeRegExp,
  matchingDelimiter,
  optionFromDeclaration,
  splitTopLevel,
  stringLiterals,
  type PositionedCommand,
} from "./cli-extractor-helpers.js";

function extractPythonOption(
  body: string,
  fallbackName?: string,
): CLIOptionDefinition | undefined {
  const literals = stringLiterals(body);
  const declaration =
    literals.filter((value) => value.startsWith("-")).join(", ") ||
    fallbackName ||
    literals[0];
  if (!declaration) return undefined;
  const description =
    body.match(/\bhelp\s*=\s*["'`]([^"'`]+)["'`]/)?.[1];
  return optionFromDeclaration(
    declaration,
    description,
    /\brequired\s*=\s*True\b/.test(body) ||
      /^\s*\.\.\./.test(body) ||
      undefined,
  );
}

function decoratorBlockBefore(content: string, functionStart: number): string {
  const prefix = content.slice(0, functionStart).replace(/\r\n/g, "\n");
  const lines = prefix.endsWith("\n")
    ? prefix.slice(0, -1).split("\n")
    : prefix.split("\n");
  const decorators: string[] = [];
  let delimiterBalance = 0;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const closing = (line.match(/[)\]}]/g) ?? []).length;
    const opening = (line.match(/[([{]/g) ?? []).length;
    const nextBalance = delimiterBalance + closing - opening;
    if (
      !trimmed.startsWith("@") &&
      delimiterBalance <= 0 &&
      nextBalance <= 0
    ) {
      break;
    }
    decorators.unshift(line);
    delimiterBalance = Math.max(0, nextBalance);
  }

  return decorators.join("\n");
}

function commandNameFromDecorator(decorators: string): string | undefined {
  const match =
    /@(?:(?:[A-Za-z_]\w*)\.)*(?:command|group)\b/g.exec(decorators);
  if (!match || match.index === undefined) return undefined;
  const suffix = decorators.slice(match.index + match[0].length);
  if (!/^\s*\(/.test(suffix)) return undefined;
  const openParen = decorators.indexOf(
    "(",
    match.index + match[0].length,
  );
  const body = callBody(decorators, openParen);
  return (
    body.match(/\bname\s*=\s*["'`]([^"'`]+)["'`]/)?.[1] ??
    body.match(/^\s*["'`]([^"'`]+)["'`]/)?.[1]
  );
}

function extractDecoratorOptions(
  decorators: string,
): CLIOptionDefinition[] {
  const options: CLIOptionDefinition[] = [];
  for (const match of decorators.matchAll(
    /@(?:(?:[A-Za-z_]\w*)\.)*option\s*\(/g,
  )) {
    if (match.index === undefined) continue;
    const openParen = decorators.indexOf("(", match.index);
    const option = extractPythonOption(callBody(decorators, openParen));
    if (option) options.push(option);
  }
  return options;
}

function hasTopLevelAssignment(parameter: string): boolean {
  let quote = "";
  let escaped = false;
  let depth = 0;

  for (const character of parameter) {
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
    } else if ("([{".includes(character)) {
      depth += 1;
    } else if (")]}".includes(character)) {
      depth = Math.max(0, depth - 1);
    } else if (character === "=" && depth === 0) {
      return true;
    }
  }
  return false;
}

function extractTyperParameterOptions(
  parameters: string,
): CLIOptionDefinition[] {
  const options: CLIOptionDefinition[] = [];
  for (const parameter of splitTopLevel(parameters)) {
    const parameterName =
      parameter.match(/^\s*([A-Za-z_]\w*)\s*(?::|=)/)?.[1];
    if (!parameterName) continue;

    for (const match of parameter.matchAll(/\b(?:typer\.)?Option\s*\(/g)) {
      if (match.index === undefined) continue;
      const openParen = parameter.indexOf("(", match.index);
      const option = extractPythonOption(
        callBody(parameter, openParen),
        parameterName.replace(/_/g, "-"),
      );
      if (option) {
        option.required =
          option.required || !hasTopLevelAssignment(parameter);
        options.push(option);
      }
    }
  }
  return options;
}

export function extractDecoratedPythonCommands(
  file: string,
  content: string,
  framework: "click" | "typer",
): CLICommandDefinition[] {
  const commands: CLICommandDefinition[] = [];
  const functions = /^[ \t]*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gm;

  for (const match of content.matchAll(functions)) {
    if (match.index === undefined) continue;
    const decorators = decoratorBlockBefore(content, match.index);
    if (!/@(?:(?:[A-Za-z_]\w*)\.)*(?:command|group)\b/.test(decorators)) {
      continue;
    }
    const openParen = content.indexOf("(", match.index);
    const closeParen = matchingDelimiter(content, openParen, "(", ")");
    const parameters = content.slice(openParen + 1, closeParen);
    const options = extractDecoratorOptions(decorators);
    if (framework === "typer") {
      options.push(...extractTyperParameterOptions(parameters));
    }
    const uniqueOptions = Array.from(
      new Map(options.map((option) => [option.name, option])).values(),
    );

    commands.push({
      name:
        commandNameFromDecorator(decorators) ||
        match[1].replace(/_/g, "-"),
      file,
      options: uniqueOptions,
    });
  }
  return commands;
}

export function extractArgparseCommands(
  file: string,
  content: string,
): CLICommandDefinition[] {
  const commands: CLICommandDefinition[] = [];
  const parsers: PositionedCommand[] = [];
  for (const match of content.matchAll(
    /(?:^|\n)\s*([A-Za-z_]\w*)\s*=\s*[A-Za-z_]\w*\.add_parser\(\s*["'`]([^"'`]+)["'`]/g,
  )) {
    if (match.index === undefined) continue;
    parsers.push({
      receiver: match[1],
      name: match[2],
      start: match.index,
    });
  }

  for (const parser of parsers) {
    const options: CLIOptionDefinition[] = [];
    const receiver = parser.receiver ?? "";
    const pattern = new RegExp(
      `\\b${receiver}\\.add_argument\\(\\s*`,
      "g",
    );
    for (const match of content.matchAll(pattern)) {
      if (match.index === undefined) continue;
      const body = callBody(
        content,
        content.indexOf("(", match.index),
      );
      const option = extractPythonOption(body);
      if (option) options.push(option);
    }
    commands.push({ name: parser.name, file, options });
  }
  if (commands.length > 0) return commands;

  for (const match of content.matchAll(
    /(?:^|\n)\s*([A-Za-z_]\w*)\s*=\s*(?:[A-Za-z_]\w*\.)?ArgumentParser\s*\(/g,
  )) {
    if (match.index === undefined) continue;
    const openParen = content.indexOf("(", match.index);
    const body = callBody(content, openParen);
    const name =
      body.match(/\bprog\s*=\s*["'`]([^"'`]+)["'`]/)?.[1] ??
      commandNameFromPath(file);
    const options: CLIOptionDefinition[] = [];
    const pattern = new RegExp(
      `\\b${escapeRegExp(match[1])}\\.add_argument\\(\\s*`,
      "g",
    );
    for (const argument of content.matchAll(pattern)) {
      if (argument.index === undefined) continue;
      const argumentBody = callBody(
        content,
        content.indexOf("(", argument.index),
      );
      const option = extractPythonOption(argumentBody);
      if (option) options.push(option);
    }
    commands.push({
      name,
      file,
      options: Array.from(
        new Map(options.map((option) => [option.name, option])).values(),
      ),
    });
  }
  return commands;
}
