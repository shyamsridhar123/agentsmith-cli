import { describe, expect, it } from "vitest";
import { analyzeCLIContents } from "../../src/analyzer/cli.js";

function extractedCommands(
  framework: string,
  content: string,
  file = "cli.py",
) {
  return analyzeCLIContents(
    framework,
    [file],
    [],
    new Map([[file, content]]),
  ).commands;
}

describe("Python CLI command extraction", () => {
  it("extracts Click decorators and defaults command names from functions", () => {
    const cli = analyzeCLIContents(
      "click",
      ["cli.py"],
      [],
      new Map([[
        "cli.py",
        [
          "@click.command()",
          '@click.option("-p", "--port", required=True, help="Port")',
          "def serve_api(port):",
          "    pass",
        ].join("\n"),
      ]]),
    );

    expect(cli.commands).toEqual([{
      name: "serve-api",
      file: "cli.py",
      options: [{
        name: "port",
        short: "p",
        description: "Port",
        required: true,
      }],
    }]);
  });

  it("extracts directly imported Click decorators with or without parentheses", () => {
    const commands = extractedCommands("click", [
      "from click import command, option",
      "@command",
      '@option("--verbose", is_flag=True, help="Verbose output")',
      "def inspect_repo(verbose):",
      "    pass",
      "",
      '@command("sync")',
      '@option("-f", "--force")',
      "def synchronize(force):",
      "    pass",
    ].join("\n"));

    expect(commands).toEqual([
      {
        name: "inspect-repo",
        file: "cli.py",
        options: [{
          name: "verbose",
          description: "Verbose output",
          required: false,
        }],
      },
      {
        name: "sync",
        file: "cli.py",
        options: [{
          name: "force",
          short: "f",
          required: false,
        }],
      },
    ]);
  });

  it("extracts multiline Click option decorators", () => {
    const cli = analyzeCLIContents(
      "click",
      ["cli.py"],
      [],
      new Map([[
        "cli.py",
        [
          "@click.command(name=\"serve\")",
          "@click.option(",
          "    \"-p\",",
          "    \"--port\",",
          "    required=True,",
          "    help=\"Port to bind\",",
          ")",
          "def serve_api(port):",
          "    pass",
        ].join("\n"),
      ]]),
    );

    expect(cli.commands).toEqual([{
      name: "serve",
      file: "cli.py",
      options: [{
        name: "port",
        short: "p",
        description: "Port to bind",
        required: true,
      }],
    }]);
  });

  it("extracts Typer decorators and function-signature options", () => {
    const cli = analyzeCLIContents(
      "typer",
      ["cli.py"],
      [],
      new Map([[
        "cli.py",
        [
          "@app.command()",
          'def greet_user(name: str = typer.Option(..., "--name", "-n", help="User name")):',
          "    pass",
        ].join("\n"),
      ]]),
    );

    expect(cli.commands).toEqual([{
      name: "greet-user",
      file: "cli.py",
      options: [{
        name: "name",
        short: "n",
        description: "User name",
        required: true,
      }],
    }]);
  });

  it("extracts Typer Annotated options", () => {
    const cli = analyzeCLIContents(
      "typer",
      ["cli.py"],
      [],
      new Map([[
        "cli.py",
        [
          "from typing import Annotated",
          "@app.command()",
          "def greet_user(",
          "    name: Annotated[str, typer.Option(\"--name\", \"-n\", help=\"User name\")],",
          "    loud: Annotated[bool, typer.Option(\"--loud\")] = False,",
          "):",
          "    pass",
        ].join("\n"),
      ]]),
    );

    expect(cli.commands).toEqual([{
      name: "greet-user",
      file: "cli.py",
      options: [
        {
          name: "name",
          short: "n",
          description: "User name",
          required: true,
        },
        {
          name: "loud",
          required: false,
        },
      ],
    }]);
  });

  it("extracts direct Typer decorators and imported Option declarations", () => {
    const commands = extractedCommands("typer", [
      "from typing import Annotated",
      "from typer import Option",
      "@app.command",
      "def deploy(",
      '    region: str = Option(..., "--region", "-r", help="Target region"),',
      '    count: Annotated[int, Option("--count", help="Replica count")] = 1,',
      '    verbose: Annotated[bool, typer.Option("--verbose")] = False,',
      "):",
      "    pass",
    ].join("\n"));

    expect(commands).toEqual([{
      name: "deploy",
      file: "cli.py",
      options: [
        {
          name: "region",
          short: "r",
          description: "Target region",
          required: true,
        },
        {
          name: "count",
          description: "Replica count",
          required: false,
        },
        {
          name: "verbose",
          required: false,
        },
      ],
    }]);
  });

  it("extracts root options from single-parser argparse CLIs", () => {
    const commands = extractedCommands("argparse", [
      "from argparse import ArgumentParser",
      'parser = ArgumentParser(prog="agentsmith")',
      'parser.add_argument("-v", "--verbose", action="store_true", help="Verbose output")',
      'parser.add_argument("--config", required=True, help="Config file")',
    ].join("\n"));

    expect(commands).toEqual([{
      name: "agentsmith",
      file: "cli.py",
      options: [
        {
          name: "verbose",
          short: "v",
          description: "Verbose output",
          required: false,
        },
        {
          name: "config",
          description: "Config file",
          required: true,
        },
      ],
    }]);
  });
});
