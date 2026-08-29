import type {
  CLICommandDefinition,
  CLIOptionDefinition,
} from "./types.js";
import {
  callBody,
  matchingDelimiter,
  stringLiterals,
} from "./cli-extractor-helpers.js";

function extractCobraOptions(
  content: string,
  receiver: string,
): CLIOptionDefinition[] {
  const options: CLIOptionDefinition[] = [];
  const pattern = new RegExp(
    `\\b${receiver}\\.(?:PersistentFlags|Flags)\\(\\)\\.([A-Za-z]+)\\(\\s*`,
    "g",
  );
  for (const match of content.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const body = callBody(
      content,
      content.indexOf("(", match.index + match[0].length - 1),
    );
    const literals = stringLiterals(body);
    if (literals.length === 0) continue;
    const hasShort = match[1].endsWith("P");
    const option: CLIOptionDefinition = {
      name: literals[0],
      required: new RegExp(
        `\\b${receiver}\\.MarkFlagRequired\\(\\s*["'\`]${literals[0]}["'\`]`,
      ).test(content),
    };
    if (hasShort && literals[1]) option.short = literals[1];
    const description = literals.at(-1);
    if (
      description &&
      description !== option.short &&
      description !== option.name
    ) {
      option.description = description;
    }
    options.push(option);
  }
  return options;
}

export function extractCobraCommands(
  file: string,
  content: string,
): CLICommandDefinition[] {
  const commands: CLICommandDefinition[] = [];
  for (const match of content.matchAll(
    /(?:^|\n)\s*(?:var\s+)?([A-Za-z_]\w*)\s*(?::=|=)\s*&cobra\.Command\s*\{/g,
  )) {
    if (match.index === undefined) continue;
    const openBrace = content.indexOf("{", match.index);
    const closeBrace = matchingDelimiter(content, openBrace, "{", "}");
    const block = content.slice(openBrace + 1, closeBrace);
    const name = block.match(/\bUse\s*:\s*["'`]([^"'`\s]+)/)?.[1];
    if (!name) continue;
    commands.push({
      name,
      file,
      options: extractCobraOptions(content, match[1]),
    });
  }
  return commands;
}
