import { describe, expect, it } from "vitest";
import { analyzeCLIContents } from "../../src/analyzer/cli.js";

function extractedCommands(
  framework: string,
  content: string,
  file = framework === "cobra" ? "cmd/root.go" : framework === "commander" ||
    framework === "yargs" ? "src/cli.ts" : "cli.py",
) {
  return analyzeCLIContents(
    framework,
    [file],
    [],
    new Map([[file, content]]),
  ).commands;
}

describe("CLI command extraction", () => {
  it("ignores test, fixture, and generated command implementations", () => {
    const cli = analyzeCLIContents(
      "commander",
      ["src/main.ts"],
      ["tests/commands/fake.ts"],
      new Map([
        ["src/main.ts", 'program.command("serve").option("--port <number>");'],
        ["src/commands/serve.ts", "export async function serveCommand() {}"],
        ["tests/commands/fake.ts", 'program.command("fake").option("--dangerous");'],
        ["fixtures/commands/example.ts", 'program.command("fixture");'],
        [".github/agents/generated.ts", 'program.command("generated");'],
      ]),
    );

    expect(cli.commands.map((command) => command.name)).toEqual(["serve"]);
    expect(cli.extensionPoints).toEqual(["src"]);
  });

  it("associates options with the command that declares them", () => {
    const cli = analyzeCLIContents(
      "commander",
      ["src/main.ts"],
      [],
      new Map([
        ["src/main.ts", [
          'program.command("serve").option("-p, --port <number>", "Port");',
          'program.command("build").option("--minify", "Minify output");',
        ].join("\n")],
      ]),
    );

    expect(cli.commands).toEqual([
      {
        name: "serve",
        file: "src/main.ts",
        options: [{
          name: "port",
          short: "p",
          description: "Port",
          required: true,
        }],
      },
      {
        name: "build",
        file: "src/main.ts",
        options: [{
          name: "minify",
          short: undefined,
          description: "Minify output",
          required: false,
        }],
      },
    ]);
  });

  it("extracts assigned Commander commands with multiline required options", () => {
    const commands = extractedCommands("commander", [
      "const serve: Command = program",
      '  .command("serve <directory>")',
      "  .requiredOption(",
      '    "-p, --port <number>",',
      '    "Port to bind",',
      "  );",
      "serve",
      '  .option("--host <hostname>", "Host name")',
      '  .requiredOption("--token <value>", "Access token");',
    ].join("\n"));

    expect(commands).toEqual([{
      name: "serve",
      file: "src/cli.ts",
      options: [
        {
          name: "port",
          short: "p",
          description: "Port to bind",
          required: true,
        },
        {
          name: "host",
          description: "Host name",
          required: true,
        },
        {
          name: "token",
          description: "Access token",
          required: true,
        },
      ],
    }]);
  });

  it("associates options added through command-specific parser variables", () => {
    const cli = analyzeCLIContents(
      "argparse",
      ["cli.py"],
      [],
      new Map([
        ["cli.py", [
          'serve_parser = subparsers.add_parser("serve")',
          'build_parser = subparsers.add_parser("build")',
          'serve_parser.add_argument("--port")',
          'build_parser.add_argument("--minify")',
        ].join("\n")],
      ]),
    );

    expect(cli.commands.find((command) => command.name === "serve")?.options)
      .toEqual([{ name: "port", required: false }]);
    expect(cli.commands.find((command) => command.name === "build")?.options)
      .toEqual([{ name: "minify", required: false }]);
  });

  it("extracts Yargs commands and builder-owned options", () => {
    const cli = analyzeCLIContents(
      "yargs",
      ["src/cli.ts"],
      [],
      new Map([[
        "src/cli.ts",
        [
          'yargs.command("serve", "Run server", y => y.option("port", {',
          '  alias: "p", describe: "Port", demandOption: true',
          "}));",
          'yargs.command("build", "Build", y => y.option("minify", { type: "boolean" }));',
        ].join("\n"),
      ]]),
    );

    expect(cli.commands).toEqual([
      {
        name: "serve",
        file: "src/cli.ts",
        options: [{
          name: "port",
          short: "p",
          description: "Port",
          required: true,
        }],
      },
      {
        name: "build",
        file: "src/cli.ts",
        options: [{ name: "minify", required: false }],
      },
    ]);
  });

  it("extracts Yargs object and command-module builder layouts", () => {
    const objectCommand = extractedCommands("yargs", [
      "yargs.command({",
      '  command: "serve <directory>",',
      '  describe: "Run server",',
      "  builder: {",
      '    port: { alias: "p", describe: "Port", demandOption: true },',
      '    "dry-run": { type: "boolean", description: "Preview changes" },',
      "  },",
      "  handler() {},",
      "});",
    ].join("\n"));
    const moduleCommand = extractedCommands("yargs", [
      'export const command: string = "build [input]";',
      "export const builder: Record<string, unknown> = {",
      '  minify: { type: "boolean", describe: "Minify output", alias: ["m"] },',
      "};",
    ].join("\n"));

    expect(objectCommand[0]).toMatchObject({
      name: "serve",
      options: [
        {
          name: "port",
          short: "p",
          description: "Port",
          required: true,
        },
        {
          name: "dry-run",
          description: "Preview changes",
          required: false,
        },
      ],
    });
    expect(moduleCommand[0]).toMatchObject({
      name: "build",
      options: [{
        name: "minify",
        short: "m",
        description: "Minify output",
        required: false,
      }],
    });
  });

  it("extracts oclif command paths and static flags", () => {
    const cli = analyzeCLIContents(
      "oclif",
      ["bin/run.js"],
      [],
      new Map([[
        "src/commands/auth/login.ts",
        [
          'import {Command, Flags} from "@oclif/core";',
          "export default class Login extends Command {",
          "  static flags = {",
          '    name: Flags.string({ char: "n", description: "User name", required: true }),',
          '    verbose: Flags.boolean({ description: "Verbose output" }),',
          "  };",
          "}",
        ].join("\n"),
      ]]),
    );

    expect(cli.commands).toEqual([{
      name: "auth:login",
      file: "src/commands/auth/login.ts",
      options: [
        {
          name: "name",
          short: "n",
          description: "User name",
          required: true,
        },
        {
          name: "verbose",
          description: "Verbose output",
          required: false,
        },
      ],
    }]);
  });

  it("associates Cobra flags with their owning command receiver", () => {
    const cli = analyzeCLIContents(
      "cobra",
      ["cmd/root.go"],
      [],
      new Map([[
        "cmd/root.go",
        [
          'var serveCmd = &cobra.Command{Use: "serve"}',
          'var buildCmd = &cobra.Command{Use: "build"}',
          'serveCmd.Flags().StringP("port", "p", "8080", "Port")',
          'buildCmd.Flags().Bool("minify", false, "Minify output")',
          'serveCmd.MarkFlagRequired("port")',
        ].join("\n"),
      ]]),
    );

    expect(cli.commands).toEqual([
      {
        name: "serve",
        file: "cmd/root.go",
        options: [{
          name: "port",
          short: "p",
          description: "Port",
          required: true,
        }],
      },
      {
        name: "build",
        file: "cmd/root.go",
        options: [{
          name: "minify",
          description: "Minify output",
          required: false,
        }],
      },
    ]);
  });
});
