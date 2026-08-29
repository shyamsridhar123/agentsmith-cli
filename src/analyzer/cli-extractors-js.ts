import type {
  CLICommandDefinition,
  CLIOptionDefinition,
} from "./types.js";
import {
  callBody,
  commandNameFromPath,
  escapeRegExp,
  expressionEnd,
  matchingDelimiter,
  optionFromDeclaration,
  splitTopLevel,
  stringLiterals,
  type PositionedCommand,
} from "./cli-extractor-helpers.js";

function extractJSOptions(content: string): CLIOptionDefinition[] {
  const options = new Map<string, CLIOptionDefinition>();
  const pattern = /\.(requiredOption|option)\s*\(\s*/g;
  for (const match of content.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const openParen = content.indexOf("(", match.index);
    const body = callBody(content, openParen);
    if (body.trimStart().startsWith("{")) continue;
    const literals = stringLiterals(body);
    if (literals.length === 0) continue;

    const declaration = literals[0];
    const objectDescription =
      body.match(/\b(?:describe|description)\s*:\s*["'`]([^"'`]+)["'`]/)?.[1];
    const objectAlias =
      body.match(/\balias\s*:\s*["'`]([^"'`]+)["'`]/)?.[1];
    const positionalDescription = body.match(
      /^\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)\s*,\s*["'`]([^"'`]*)["'`]/s,
    )?.[1];
    const option = optionFromDeclaration(
      declaration,
      objectDescription ?? positionalDescription,
      match[1] === "requiredOption" ||
        /\b(?:demandOption|required)\s*:\s*true\b/.test(body) ||
        undefined,
      objectAlias,
    );
    if (option) options.set(option.name, option);
  }
  return Array.from(options.values());
}

function extractReceiverJSOptions(
  content: string,
  receiver: string,
): CLIOptionDefinition[] {
  const options: CLIOptionDefinition[] = [];
  const pattern = new RegExp(
    `\\b${escapeRegExp(receiver)}\\s*\\.\\s*(?:requiredOption|option)\\s*\\(`,
    "g",
  );
  for (const match of content.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const end = expressionEnd(content, match.index, content.length);
    options.push(...extractJSOptions(content.slice(match.index, end)));
  }
  return Array.from(
    new Map(options.map((option) => [option.name, option])).values(),
  );
}

function assignedReceiver(
  content: string,
  commandStart: number,
): string | undefined {
  const lineStart = content.lastIndexOf("\n", commandStart) + 1;
  if (/^\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*$/.test(
    content.slice(lineStart, commandStart),
  )) {
    return undefined;
  }
  const prefix = content.slice(0, commandStart);
  const statementStart =
    Math.max(prefix.lastIndexOf(";"), prefix.lastIndexOf("\n\n")) + 1;
  const assignments = Array.from(
    prefix.slice(statementStart).matchAll(
      /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*/g,
    ),
  );
  return assignments.at(-1)?.[1];
}

export function extractCommanderCommands(
  file: string,
  content: string,
): CLICommandDefinition[] {
  const positioned: PositionedCommand[] = [];
  const commandPatterns = [
    /\.command\s*\(\s*["'`]([^"'`\s<[\]]+)/g,
    /new\s+Command\s*\(\s*["'`]([^"'`\s<[\]]+)/g,
  ];

  for (const pattern of commandPatterns) {
    for (const match of content.matchAll(pattern)) {
      if (match.index === undefined) continue;
      positioned.push({
        name: match[1],
        start: match.index,
        receiver: assignedReceiver(content, match.index),
      });
    }
  }

  positioned.sort((left, right) => left.start - right.start);
  return positioned.map((command, index) => {
    const nextStart = positioned[index + 1]?.start ?? content.length;
    const commandContent = content.slice(
      command.start,
      expressionEnd(content, command.start, nextStart),
    );
    const options = [
      ...extractJSOptions(commandContent),
      ...(command.receiver
        ? extractReceiverJSOptions(content, command.receiver)
        : []),
    ];
    return {
      name: command.name,
      file,
      options: Array.from(
        new Map(options.map((option) => [option.name, option])).values(),
      ),
    };
  });
}

function extractOptionObject(content: string): CLIOptionDefinition[] {
  const options: CLIOptionDefinition[] = [];
  for (const entry of splitTopLevel(content)) {
    const match = entry.match(
      /^\s*(?:["'`]([^"'`]+)["'`]|([A-Za-z_$][\w$-]*))\s*:\s*([\s\S]+)$/,
    );
    if (!match) continue;
    const config = match[3];
    const alias = config.match(
      /\balias\s*:\s*(?:["'`]([^"'`]+)["'`]|\[\s*["'`]([^"'`]+)["'`])/,
    );
    const option = optionFromDeclaration(
      match[1] ?? match[2],
      config.match(
        /\b(?:describe|description)\s*:\s*["'`]([^"'`]+)["'`]/,
      )?.[1],
      /\b(?:demand|demandOption|required)\s*:\s*true\b/.test(config) ||
        undefined,
      alias?.[1] ?? alias?.[2],
    );
    if (option) options.push(option);
  }
  return options;
}

function propertyObjectBodies(content: string, property: string): string[] {
  const bodies: string[] = [];
  const pattern = new RegExp(
    `\\b${property}\\s*(?::\\s*\\{|(?::\\s*[^=;\\n]+)?=\\s*\\{)`,
    "g",
  );
  for (const match of content.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const openBrace = content.indexOf("{", match.index);
    bodies.push(content.slice(
      openBrace + 1,
      matchingDelimiter(content, openBrace, "{", "}"),
    ));
  }
  return bodies;
}

function extractYargsOptions(body: string): CLIOptionDefinition[] {
  const options = [...extractJSOptions(body)];
  for (const builder of propertyObjectBodies(body, "builder")) {
    options.push(...extractOptionObject(builder));
  }
  for (const match of body.matchAll(/\.options?\s*\(\s*\{/g)) {
    if (match.index === undefined) continue;
    const openBrace = body.indexOf("{", match.index);
    options.push(...extractOptionObject(body.slice(
      openBrace + 1,
      matchingDelimiter(body, openBrace, "{", "}"),
    )));
  }
  const positionalBuilder = splitTopLevel(body)[2]?.trim();
  if (positionalBuilder?.startsWith("{")) {
    options.push(...extractOptionObject(positionalBuilder.slice(
      1,
      matchingDelimiter(positionalBuilder, 0, "{", "}"),
    )));
  }
  return Array.from(
    new Map(options.map((option) => [option.name, option])).values(),
  );
}

export function extractYargsCommands(
  file: string,
  content: string,
): CLICommandDefinition[] {
  const commands: CLICommandDefinition[] = [];
  for (const match of content.matchAll(/\.command\s*\(\s*/g)) {
    if (match.index === undefined) continue;
    const openParen = content.indexOf("(", match.index);
    const body = callBody(content, openParen);
    const name =
      body.match(/\bcommand\s*:\s*["'`]([^"'`\s<[\]]+)/)?.[1] ??
      stringLiterals(body)[0]?.split(/[\s<[]/)[0];
    if (name) {
      commands.push({ name, file, options: extractYargsOptions(body) });
    }
  }
  if (commands.length > 0) return commands;

  const moduleName = content.match(
    /(?:\b(?:export\s+)?(?:const|let|var)\s+command(?:\s*:\s*[^=;\n]+)?|\bexports\.command)\s*=\s*["'`]([^"'`\s<[\]]+)/,
  )?.[1] ?? content.match(
    /\bcommand\s*:\s*["'`]([^"'`\s<[\]]+)/,
  )?.[1];
  return moduleName
    ? [{ name: moduleName, file, options: extractYargsOptions(content) }]
    : [];
}

function extractOclifOptions(content: string): CLIOptionDefinition[] {
  const options: CLIOptionDefinition[] = [];
  for (const match of content.matchAll(
    /(?:["'`]([^"'`]+)["'`]|([A-Za-z_$][\w$-]*))\s*:\s*(?:Flags|flags)\.\w+\s*\(/g,
  )) {
    if (match.index === undefined) continue;
    const openParen = content.indexOf("(", match.index);
    const body = callBody(content, openParen);
    const option: CLIOptionDefinition = {
      name: match[1] ?? match[2],
      required: /\brequired\s*:\s*true\b/.test(body),
    };
    const short =
      body.match(/\bchar\s*:\s*["'`]([^"'`]+)["'`]/)?.[1];
    const description =
      body.match(/\bdescription\s*:\s*["'`]([^"'`]+)["'`]/)?.[1];
    if (short) option.short = short;
    if (description) option.description = description;
    options.push(option);
  }
  return options;
}

export function extractOclifCommand(
  file: string,
  content: string,
): CLICommandDefinition[] {
  const name = commandNameFromPath(file, true);
  return name ? [{ name, file, options: extractOclifOptions(content) }] : [];
}
