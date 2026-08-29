import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const childCommandTimeoutMs = 1_200_000;
const packagingTestTimeoutMs = 1_500_000;
const packageSourceEntries = [
  ".gitignore",
  "LICENSE",
  "README.md",
  "bin",
  "package-lock.json",
  "package.json",
  "src",
  "tsconfig.json",
  "tsup.config.ts",
];

function createEnvironment(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment = { ...process.env };

  for (const key of Object.keys(environment)) {
    if (key.toLowerCase().startsWith("npm_")) {
      delete environment[key];
    }
  }

  const settings: NodeJS.ProcessEnv = {
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_offline: "false",
    npm_config_progress: "false",
    npm_config_update_notifier: "false",
    ...overrides,
  };

  for (const [key, value] of Object.entries(settings)) {
    for (const existingKey of Object.keys(environment)) {
      if (existingKey.toLowerCase() === key.toLowerCase()) {
        delete environment[existingKey];
      }
    }
    if (value !== undefined) {
      environment[key] = value;
    }
  }

  return environment;
}

async function run(
  executable: string,
  args: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv = {},
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(executable, args, {
      cwd,
      encoding: "utf8",
      env: createEnvironment(environment),
      maxBuffer: 10 * 1024 * 1024,
      timeout: childCommandTimeoutMs,
      windowsHide: true,
    });
  } catch (error) {
    const failure = error as Error & {
      killed?: boolean;
      stderr?: string;
      stdout?: string;
    };
    const summary = failure.killed
      ? `Command exceeded ${childCommandTimeoutMs}ms`
      : "Command failed";
    const output = [failure.stdout, failure.stderr]
      .filter((value): value is string => Boolean(value?.trim()))
      .join("\n");
    throw new Error(
      `${summary}: ${executable} ${args.join(" ")}${output ? `\n${output}` : ""}`,
      { cause: error },
    );
  }
}

async function findNpmCli(): Promise<string> {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    path.resolve(
      path.dirname(process.execPath),
      "..",
      "lib",
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    ),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next standard npm CLI location.
    }
  }

  throw new Error("Unable to locate npm-cli.js for the packaging test");
}

async function runNpm(
  args: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv = {},
): Promise<{ stdout: string; stderr: string }> {
  return run(process.execPath, [await findNpmCli(), ...args], cwd, environment);
}

interface NpmSandbox {
  cacheDirectory: string;
  environment: NodeJS.ProcessEnv;
  logsDirectory: string;
}

function npmConfigPath(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

function normalizeRegistry(registry: string): string {
  const parsed = new URL(registry.trim());
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Unsupported npm registry protocol: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error("The packaging registry URL must not contain credentials");
  }
  return parsed.href.endsWith("/") ? parsed.href : `${parsed.href}/`;
}

async function resolveConfiguredRegistry(): Promise<string> {
  const override = process.env.AGENTSMITH_PACKAGING_REGISTRY?.trim();
  if (override) {
    return normalizeRegistry(override);
  }

  const { stdout } = await execFileAsync(
    process.execPath,
    [await findNpmCli(), "config", "get", "registry"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 1024 * 1024,
      timeout: 60_000,
      windowsHide: true,
    },
  );
  return normalizeRegistry(stdout);
}

async function createNpmSandbox(
  temporaryRoot: string,
  registry: string,
): Promise<NpmSandbox> {
  const npmRoot = path.join(temporaryRoot, "npm");
  const cacheDirectory = path.join(npmRoot, "cache");
  const logsDirectory = path.join(npmRoot, "logs");
  const userConfig = path.join(npmRoot, "user.npmrc");
  const globalConfig = path.join(npmRoot, "global.npmrc");

  await fs.mkdir(npmRoot, { recursive: true });
  await fs.writeFile(globalConfig, "", "utf8");
  await fs.writeFile(
    userConfig,
    [
      `registry=${registry}`,
      `cache=${npmConfigPath(cacheDirectory)}`,
      `logs-dir=${npmConfigPath(logsDirectory)}`,
      "audit=false",
      "fund=false",
      "update-notifier=false",
      "progress=false",
      "offline=false",
      "prefer-offline=false",
      "prefer-online=true",
      "replace-registry-host=npmjs",
      "fetch-retries=3",
      "fetch-retry-factor=5",
      "fetch-retry-mintimeout=10000",
      "fetch-retry-maxtimeout=60000",
      "fetch-timeout=300000",
    ].join("\n") + "\n",
    "utf8",
  );

  return {
    cacheDirectory,
    environment: {
      npm_config_cache: cacheDirectory,
      npm_config_globalconfig: globalConfig,
      npm_config_registry: registry,
      npm_config_userconfig: userConfig,
    },
    logsDirectory,
  };
}

async function readLatestNpmLog(logsDirectory: string): Promise<string> {
  try {
    const entries = await fs.readdir(logsDirectory, { withFileTypes: true });
    const logs = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".log"))
      .map((entry) => entry.name)
      .sort();
    const latest = logs.at(-1);
    if (!latest) {
      return "No npm debug log was created.";
    }
    const contents = await fs.readFile(path.join(logsDirectory, latest), "utf8");
    return contents.slice(-20_000);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT"
      ? "No npm debug log directory was created."
      : `Unable to read npm debug logs: ${(error as Error).message}`;
  }
}

async function copyPackageSources(destination: string): Promise<void> {
  await fs.mkdir(destination, { recursive: true });

  for (const entry of packageSourceEntries) {
    await fs.cp(
      path.join(repositoryRoot, entry),
      path.join(destination, entry),
      { recursive: true },
    );
  }

  await fs.rm(path.join(destination, "dist"), {
    recursive: true,
    force: true,
  });

  const [sourcePackageJson, copiedPackageJson, sourceLockfile, copiedLockfile] =
    await Promise.all([
      fs.readFile(path.join(repositoryRoot, "package.json"), "utf8"),
      fs.readFile(path.join(destination, "package.json"), "utf8"),
      fs.readFile(path.join(repositoryRoot, "package-lock.json"), "utf8"),
      fs.readFile(path.join(destination, "package-lock.json"), "utf8"),
    ]);
  expect(copiedPackageJson).toBe(sourcePackageJson);
  expect(copiedLockfile).toBe(sourceLockfile);

  const packageJson = JSON.parse(copiedPackageJson) as {
    devDependencies?: Record<string, string>;
    scripts: Record<string, string>;
  };
  const lockfile = JSON.parse(copiedLockfile) as {
    packages: Record<string, { version?: string }>;
  };
  expect(packageJson.scripts.prepare).toBe("npm run build");
  expect(packageJson.scripts.build).toBe("tsup");
  expect(packageJson.devDependencies?.rollup).toBe("4.62.5");
  expect(packageJson.devDependencies?.rolldown).toBe("1.2.5");
  expect(packageJson.devDependencies?.picomatch).toBe("4.0.5");
  expect(lockfile.packages["node_modules/rollup"]?.version).toBe(
    packageJson.devDependencies?.rollup,
  );
  expect(lockfile.packages["node_modules/rolldown"]?.version).toBe(
    packageJson.devDependencies?.rolldown,
  );
  expect(lockfile.packages["node_modules/picomatch"]?.version).toBe(
    packageJson.devDependencies?.picomatch,
  );
}

async function initializeGitRepository(repository: string): Promise<void> {
  await run("git", ["init", "--quiet"], repository);
  await run(
    "git",
    ["config", "user.email", "packaging-test@example.invalid"],
    repository,
  );
  await run(
    "git",
    ["config", "user.name", "AgentSmith Packaging Test"],
    repository,
  );
  await run("git", ["add", "--all"], repository);
  await run("git", ["commit", "--quiet", "-m", "Packaging fixture"], repository);
}

async function removeTree(directory: string): Promise<void> {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      await fs.rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 200,
      });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        attempt === 14 ||
        !["EBUSY", "ENOTEMPTY", "EPERM"].includes(code ?? "")
      ) {
        throw new Error(`Unable to clean packaging fixture at ${directory}`, {
          cause: error,
        });
      }
      await delay(250 * (attempt + 1));
    }
  }
}

async function withTemporaryRoot(
  callback: (temporaryRoot: string) => Promise<void>,
): Promise<void> {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "as-pkg-"));
  let failure: unknown;

  try {
    await callback(temporaryRoot);
  } catch (error) {
    failure = error;
  }

  try {
    await removeTree(temporaryRoot);
  } catch (cleanupError) {
    failure =
      failure === undefined
        ? cleanupError
        : new AggregateError(
            [failure, cleanupError],
            `Packaging verification and cleanup both failed for ${temporaryRoot}`,
          );
  }

  if (failure !== undefined) {
    throw failure;
  }
}

function parsePackResult(stdout: string): {
  filename: string;
  files: Array<{ path: string }>;
} {
  const jsonStart = stdout.indexOf("[");
  const jsonEnd = stdout.lastIndexOf("]");
  expect(jsonStart).toBeGreaterThanOrEqual(0);
  expect(jsonEnd).toBeGreaterThan(jsonStart);

  const [packResult] = JSON.parse(
    stdout.slice(jsonStart, jsonEnd + 1),
  ) as Array<{
    filename: string;
    files: Array<{ path: string }>;
  }>;
  expect(packResult).toBeDefined();
  return packResult;
}

describe("package installation", () => {
  it("builds and runs the CLI when installed from a Git dependency", async () => {
    await withTemporaryRoot(async (temporaryRoot) => {
      const registry = await resolveConfiguredRegistry();
      const gitRepository = path.join(temporaryRoot, "repo");
      await copyPackageSources(gitRepository);
      await initializeGitRepository(gitRepository);

      await expect(
        fs.access(path.join(gitRepository, "dist", "main.js")),
      ).rejects.toMatchObject({ code: "ENOENT" });

      const installDirectory = path.join(temporaryRoot, "app");
      const npmSandbox = await createNpmSandbox(temporaryRoot, registry);
      await expect(
        fs.access(npmSandbox.cacheDirectory),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await fs.mkdir(installDirectory);
      await fs.writeFile(
        path.join(installDirectory, "package.json"),
        JSON.stringify({
          private: true,
          dependencies: {
            "agentsmith-cli": `git+${pathToFileURL(gitRepository).href}`,
          },
        }),
      );
      let install: { stdout: string; stderr: string };
      try {
        install = await runNpm(
          [
            "install",
            "--no-audit",
            "--no-fund",
            "--no-package-lock",
            "--foreground-scripts",
            "--loglevel",
            "notice",
          ],
          installDirectory,
          npmSandbox.environment,
        );
      } catch (error) {
        const npmLog = await readLatestNpmLog(npmSandbox.logsDirectory);
        throw new Error(
          `Cold Git-dependency installation failed using ${registry}\n${npmLog}`,
          { cause: error },
        );
      }

      await expect(
        fs.access(path.join(gitRepository, "dist", "main.js")),
      ).rejects.toMatchObject({ code: "ENOENT" });

      const installedPackage = path.join(
        installDirectory,
        "node_modules",
        "agentsmith-cli",
      );
      const builtMain = path.join(installedPackage, "dist", "main.js");
      await expect(fs.access(builtMain)).resolves.toBeUndefined();
      expect((await fs.stat(builtMain)).size).toBeGreaterThan(100_000);
      await expect(
        fs.access(path.join(installedPackage, "src")),
      ).rejects.toMatchObject({ code: "ENOENT" });

      const packageJson = JSON.parse(
        await fs.readFile(path.join(installedPackage, "package.json"), "utf8"),
      ) as {
        bin: { agentsmith: string };
        version: string;
      };
      const lifecycleOutput = `${install.stdout}\n${install.stderr}`;
      expect(lifecycleOutput).toContain(
        `> agentsmith-cli@${packageJson.version} prepare`,
      );
      expect(lifecycleOutput).toContain("> npm run build");
      expect(lifecycleOutput).toContain("> tsup");
      expect(lifecycleOutput).toContain("Build success");
      const installedCli = path.resolve(
        installedPackage,
        packageJson.bin.agentsmith,
      );
      const installedLauncher = await fs.readFile(installedCli, "utf8");
      expect(installedLauncher).toContain("../dist/main.js");
      expect(installedLauncher).not.toMatch(
        /\bnpx\b|\btsx\b|\bspawn\b|shell\s*:|\bsrc\b/,
      );

      const help = await run(
        process.execPath,
        [installedCli, "--help"],
        installDirectory,
      );
      expect(help.stdout).toContain("Usage: agentsmith");
      expect(help.stdout).toContain("assimilate");
      expect(help.stdout).toContain("refine");

      const version = await run(
        process.execPath,
        [installedCli, "--version"],
        installDirectory,
      );
      expect(version.stdout.trim()).toBe(packageJson.version);

      const tarballDirectory = path.join(temporaryRoot, "tarball");
      await fs.mkdir(tarballDirectory);
      const packed = await runNpm(
        [
          "pack",
          "--json",
          "--ignore-scripts",
          "--pack-destination",
          tarballDirectory,
        ],
        installedPackage,
        npmSandbox.environment,
      );
      const packResult = parsePackResult(packed.stdout);
      const packedPaths = packResult.files.map(({ path: packedPath }) =>
        packedPath.replaceAll("\\", "/"),
      );
      expect(packedPaths).toContain("bin/agentsmith.js");
      expect(packedPaths).toContain("dist/main.js");
      expect(packedPaths).toContain("dist/main.js.map");
      expect(
        packedPaths.some((packedPath) =>
          packedPath === "src" || packedPath.startsWith("src/"),
        ),
      ).toBe(false);
      await expect(
        fs.access(path.join(tarballDirectory, packResult.filename)),
      ).resolves.toBeUndefined();
    });
  }, packagingTestTimeoutMs);
});
