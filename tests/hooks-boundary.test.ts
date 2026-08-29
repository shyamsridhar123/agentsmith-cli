import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HookRunner, parseHookCommand } from "../src/hooks/index.js";
import type { HookDefinition } from "../src/analyzer/types.js";
const temporaryDirectories: string[] = [];
async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentsmith-hook-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true })),
  );
});
describe("hook execution boundary", () => {
  it("preserves backslashes and quoted Windows executable paths", () => {
    expect(
      parseHookCommand(
        String.raw`"C:\Program Files\nodejs\node.exe" "C:\repo with spaces\script.cjs" --flag C:\plain\value`,
      ),
    ).toEqual({
      executable: String.raw`C:\Program Files\nodejs\node.exe`,
      args: [
        String.raw`C:\repo with spaces\script.cjs`,
        "--flag",
        String.raw`C:\plain\value`,
      ],
    });
    expect(
      parseHookCommand(
        String.raw`C:\Tools\node.exe C:\repo\script.cjs`,
      ),
    ).toEqual({
      executable: String.raw`C:\Tools\node.exe`,
      args: [String.raw`C:\repo\script.cjs`],
    });
    expect(
      parseHookCommand(
        String.raw`tool plain\ value "quoted \"value\"" 'single \'value\'' C:\repo\script`,
      ),
    ).toEqual({
      executable: "tool",
      args: [
        "plain value",
        'quoted "value"',
        "single 'value'",
        String.raw`C:\repo\script`,
      ],
    });
  });
  it("refuses to execute hooks unless execution was explicitly enabled", async () => {
    const root = await temporaryDirectory();
    await expect(new HookRunner(root).execute("post-generate")).rejects.toThrow(
      "Hook execution is disabled",
    );
  });
  it("executes hooks when explicitly enabled", async () => {
    const root = await temporaryDirectory();
    const hooksDirectory = path.join(root, ".github", "hooks");
    const scriptPath = path.join(root, "write-marker.cjs");
    const staleScriptPath = path.join(root, "write-stale-marker.cjs");
    await fs.mkdir(hooksDirectory, { recursive: true });
    await fs.writeFile(
      scriptPath,
      "require('node:fs').writeFileSync('hook-ran.txt', 'yes')\n",
      "utf-8",
    );
    await fs.writeFile(
      staleScriptPath,
      "require('node:fs').writeFileSync('stale-hook-ran.txt', 'yes')\n",
      "utf-8",
    );
    await fs.writeFile(
      path.join(hooksDirectory, "post-generate.yaml"),
      JSON.stringify({
        name: "write-marker",
        event: "post-generate",
        description: "Test hook",
        commands: [`'${process.execPath}' '${scriptPath}'`],
      }),
      "utf-8",
    );
    await fs.writeFile(
      path.join(hooksDirectory, "stale.yaml"),
      JSON.stringify({
        name: "stale-hook",
        event: "post-generate",
        description: "Pre-existing hook",
        commands: [`'${process.execPath}' '${staleScriptPath}'`],
      }),
      "utf-8",
    );
    const results = await new HookRunner(root, {
      allowExecution: true,
    }).execute("post-generate", [".github/hooks/post-generate.yaml"]);
    expect(results).toEqual([expect.objectContaining({
      hook: "write-marker",
      success: true,
    })]);
    await expect(fs.readFile(path.join(root, "hook-ran.txt"), "utf-8"))
      .resolves.toBe("yes");
    await expect(fs.access(path.join(root, "stale-hook-ran.txt")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });
  it("executes immutable current-run definitions without rereading hook files", async () => {
    const root = await temporaryDirectory();
    const hooksDirectory = path.join(root, ".github", "hooks");
    const delayScript = path.join(root, "delay.cjs");
    const safeScript = path.join(root, "write-safe.cjs");
    const replacementScript = path.join(root, "write-replacement.cjs");
    const safeMarker = path.join(root, "safe-hook-ran.txt");
    const replacementMarker = path.join(root, "replacement-hook-ran.txt");
    await fs.mkdir(hooksDirectory, { recursive: true });
    await fs.writeFile(delayScript, "setTimeout(() => {}, 200)\n", "utf-8");
    await fs.writeFile(
      safeScript,
      `require('node:fs').writeFileSync(${JSON.stringify(safeMarker)}, 'yes')\n`,
      "utf-8",
    );
    await fs.writeFile(
      replacementScript,
      `require('node:fs').writeFileSync(${JSON.stringify(replacementMarker)}, 'yes')\n`,
      "utf-8",
    );
    await fs.writeFile(
      path.join(hooksDirectory, "post-generate.yaml"),
      JSON.stringify({
        name: "replacement-hook",
        event: "post-generate",
        description: "Untrusted replacement on disk",
        commands: [`"${process.execPath}" "${replacementScript}"`],
      }),
      "utf-8",
    );
    const currentRunHook: HookDefinition = {
      name: "current-run-hook",
      event: "post-generate",
      description: "Immutable current-run definition",
      commands: [
        `"${process.execPath}" "${delayScript}"`,
        `"${process.execPath}" "${safeScript}"`,
      ],
    };
    const run = new HookRunner(root, {
      allowExecution: true,
    }).executeDefinitions("post-generate", [currentRunHook]);
    currentRunHook.commands[1] = `"${process.execPath}" "${replacementScript}"`;
    await expect(run).resolves.toEqual([expect.objectContaining({
      hook: "current-run-hook",
      success: true,
    })]);
    await expect(fs.readFile(safeMarker, "utf-8")).resolves.toBe("yes");
    await expect(fs.access(replacementMarker))
      .rejects.toMatchObject({ code: "ENOENT" });
  });
  it("requires options-based callers to opt in for definition execution", async () => {
    const root = await temporaryDirectory();
    const hook: HookDefinition = {
      name: "disabled",
      event: "post-generate",
      description: "Must not run",
      commands: [`"${process.execPath}" --version`],
    };
    await expect(
      new HookRunner(root, { verbose: true })
        .executeDefinitions("post-generate", [hook]),
    ).rejects.toThrow("Hook execution is disabled");
  });
  it("runs npm hooks through the npm CLI script instead of a Windows cmd shim", async () => {
    const root = await temporaryDirectory();
    const hooksDirectory = path.join(root, ".github", "hooks");
    const npmDirectory = path.join(root, "fake-npm");
    const npmCliPath = path.join(npmDirectory, "npm-cli.js");
    const markerPath = path.join(root, "npm-hook-ran.txt");
    const previousNpmExecPath = process.env.npm_execpath;
    await fs.mkdir(hooksDirectory, { recursive: true });
    await fs.mkdir(npmDirectory, { recursive: true });
    await fs.writeFile(
      npmCliPath,
      "require('node:fs').writeFileSync(process.argv[2], process.argv[3])\n",
      "utf-8",
    );
    await fs.writeFile(
      path.join(hooksDirectory, "npm.yaml"),
      JSON.stringify({
        name: "npm-hook",
        event: "post-generate",
        description: "npm shim test",
        commands: [`npm '${markerPath}' success`],
      }),
      "utf-8",
    );
    process.env.npm_execpath = npmCliPath;
    try {
      const results = await new HookRunner(root, {
        allowExecution: true,
      }).execute("post-generate", [".github/hooks/npm.yaml"]);
      expect(results).toEqual([expect.objectContaining({
        hook: "npm-hook",
        success: true,
      })]);
      await expect(fs.readFile(markerPath, "utf-8")).resolves.toBe("success");
    } finally {
      if (previousNpmExecPath === undefined) {
        delete process.env.npm_execpath;
      } else {
        process.env.npm_execpath = previousNpmExecPath;
      }
    }
  });
  it("safely executes PATH cmd and bat shims on Windows", async (context) => {
    if (process.platform !== "win32") {
      context.skip();
      return;
    }
    const root = await temporaryDirectory();
    const hooksDirectory = path.join(root, ".github", "hooks");
    const shimDirectory = path.join(root, "fake shims");
    const scriptPath = path.join(root, "capture-arguments.cjs");
    const previousPath = process.env.PATH;
    const previousPathExt = process.env.PATHEXT;
    await fs.mkdir(hooksDirectory, { recursive: true });
    await fs.mkdir(shimDirectory, { recursive: true });
    await fs.writeFile(
      scriptPath,
      [
        "const fs = require('node:fs');",
        "fs.writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)));",
        "",
      ].join("\n"),
      "utf-8",
    );
    process.env.PATH = [
      shimDirectory,
      previousPath,
    ].filter((value): value is string => Boolean(value)).join(path.delimiter);
    process.env.PATHEXT = [".CMD", ".BAT", previousPathExt]
      .filter((value): value is string => Boolean(value))
      .join(";");
    try {
      for (const extension of ["cmd", "bat"] as const) {
        const shimName = `fake-hook-${extension}`;
        const markerPath = path.join(root, `${extension}-hook-ran.json`);
        const hookFile = `.github/hooks/${extension}.yaml`;
        await fs.writeFile(
          path.join(shimDirectory, `${shimName}.${extension}`),
          [
            "@echo off",
            `"${process.execPath}" "${scriptPath}" %*`,
            "",
          ].join("\r\n"),
          "utf-8",
        );
        await fs.writeFile(
          path.join(root, hookFile),
          JSON.stringify({
            name: `${extension}-shim-hook`,
            event: "post-generate",
            description: `${extension} PATH shim test`,
            commands: [
              `${shimName} "${markerPath}" "argument with spaces" plain`,
            ],
          }),
          "utf-8",
        );
        const results = await new HookRunner(root, {
          allowExecution: true,
        }).execute("post-generate", [hookFile]);
        expect(results).toEqual([expect.objectContaining({
          hook: `${extension}-shim-hook`,
          success: true,
        })]);
        await expect(fs.readFile(markerPath, "utf-8"))
          .resolves.toBe(JSON.stringify(["argument with spaces", "plain"]));
      }
    } finally {
      if (previousPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = previousPath;
      }
      if (previousPathExt === undefined) {
        delete process.env.PATHEXT;
      } else {
        process.env.PATHEXT = previousPathExt;
      }
    }
  });
  it("resolves relative cmd and bat paths against the target repository", async (context) => {
    if (process.platform !== "win32") {
      context.skip();
      return;
    }
    const root = await temporaryDirectory();
    const toolsDirectory = path.join(root, "tools");
    const scriptPath = path.join(root, "capture-relative-arguments.cjs");
    await fs.mkdir(toolsDirectory, { recursive: true });
    await fs.writeFile(
      scriptPath,
      [
        "const fs = require('node:fs');",
        "fs.writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)));",
        "",
      ].join("\n"),
      "utf-8",
    );
    for (const extension of ["cmd", "bat"] as const) {
      const relativeShim = path.join("tools", `relative-hook.${extension}`);
      const markerPath = path.join(root, `relative-${extension}-hook-ran.json`);
      await fs.writeFile(
        path.join(root, relativeShim),
        [
          "@echo off",
          `"${process.execPath}" "${scriptPath}" %*`,
          "",
        ].join("\r\n"),
        "utf-8",
      );
      const hook: HookDefinition = {
        name: `relative-${extension}`,
        event: "post-generate",
        description: "Repository-relative Windows shim",
        commands: [`${relativeShim} "${markerPath}" "argument with spaces"`],
      };
      const results = await new HookRunner(root, {
        allowExecution: true,
      }).executeDefinitions("post-generate", [hook]);
      expect(results).toEqual([expect.objectContaining({
        hook: `relative-${extension}`,
        success: true,
      })]);
      await expect(fs.readFile(markerPath, "utf-8"))
        .resolves.toBe(JSON.stringify(["argument with spaces"]));
    }
  });
  it("rejects hard-linked current-run hook files", async (context) => {
    const root = await temporaryDirectory();
    const hooksDirectory = path.join(root, ".github", "hooks");
    const hookPath = path.join(hooksDirectory, "hard-linked.yaml");
    const linkedPath = path.join(hooksDirectory, "hard-linked-copy.yaml");
    const markerPath = path.join(root, "hard-linked-hook-ran.txt");
    const scriptPath = path.join(root, "write-hard-link-marker.cjs");
    await fs.mkdir(hooksDirectory, { recursive: true });
    await fs.writeFile(
      scriptPath,
      `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'yes')\n`,
      "utf-8",
    );
    await fs.writeFile(
      hookPath,
      JSON.stringify({
        name: "hard-linked-hook",
        event: "post-generate",
        description: "Hard-linked hook test",
        commands: [`"${process.execPath}" "${scriptPath}"`],
      }),
      "utf-8",
    );
    try {
      await fs.link(hookPath, linkedPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (["EPERM", "EACCES", "ENOSYS", "EOPNOTSUPP"].includes(code ?? "")) {
        context.skip();
        return;
      }
      throw error;
    }
    expect((await fs.stat(hookPath)).nlink).toBeGreaterThan(1);
    await expect(new HookRunner(root, {
      allowExecution: true,
    }).execute("post-generate", [".github/hooks/hard-linked.yaml"]))
      .rejects.toThrow(/hard link|multiple links/i);
    await expect(fs.access(markerPath))
      .rejects.toMatchObject({ code: "ENOENT" });
  });
  it("rejects shell operators without executing either command", async () => {
    const root = await temporaryDirectory();
    const hooksDirectory = path.join(root, ".github", "hooks");
    const markerPath = path.join(root, "shell-operator-ran.txt");
    const scriptPath = path.join(root, "write-shell-marker.cjs");
    await fs.mkdir(hooksDirectory, { recursive: true });
    await fs.writeFile(
      scriptPath,
      `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'yes')\n`,
      "utf-8",
    );
    await fs.writeFile(
      path.join(hooksDirectory, "shell-operator.yaml"),
      JSON.stringify({
        name: "shell-operator-hook",
        event: "post-generate",
        description: "Shell operator rejection test",
        commands: [
          `"${process.execPath}" --version && "${process.execPath}" "${scriptPath}"`,
        ],
      }),
      "utf-8",
    );
    const results = await new HookRunner(root, {
      allowExecution: true,
    }).execute("post-generate", [".github/hooks/shell-operator.yaml"]);
    expect(results).toEqual([expect.objectContaining({
      hook: "shell-operator-hook",
      success: false,
      error: expect.stringMatching(/shell operators/i),
    })]);
    await expect(fs.access(markerPath))
      .rejects.toMatchObject({ code: "ENOENT" });
  });
  it("treats the legacy boolean as verbosity and loads repository hooks", async () => {
    const root = await temporaryDirectory();
    const hooksDirectory = path.join(root, ".github", "hooks");
    const markerPath = path.join(root, "legacy-hook-ran.txt");
    const scriptPath = path.join(root, "write-legacy-marker.cjs");
    await fs.mkdir(hooksDirectory, { recursive: true });
    await fs.writeFile(
      scriptPath,
      `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'yes')\n`,
      "utf-8",
    );
    await fs.writeFile(
      path.join(hooksDirectory, "legacy.yaml"),
      JSON.stringify({
        name: "legacy-hook",
        event: "post-generate",
        description: "Legacy constructor test",
        commands: [`"${process.execPath}" "${scriptPath}"`],
      }),
      "utf-8",
    );
    const results = await new HookRunner(root, false).execute("post-generate");
    expect(results).toEqual([expect.objectContaining({
      hook: "legacy-hook",
      success: true,
    })]);
    await expect(fs.readFile(markerPath, "utf-8")).resolves.toBe("yes");
  });
  it("rejects a generated hook path redirected through a junction", async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const githubDirectory = path.join(root, ".github");
    await fs.mkdir(githubDirectory);
    await fs.writeFile(
      path.join(outside, "redirected.yaml"),
      JSON.stringify({
        name: "redirected",
        event: "post-generate",
        description: "redirected hook",
        commands: [`'${process.execPath}' --version`],
      }),
      "utf-8",
    );
    await fs.symlink(
      outside,
      path.join(githubDirectory, "hooks"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(new HookRunner(root, {
      allowExecution: true,
    }).execute("post-generate", [".github/hooks/redirected.yaml"]))
      .rejects.toThrow("symbolic link");
  });
});
