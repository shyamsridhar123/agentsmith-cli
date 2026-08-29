import type { Stats } from "fs";
import path from "path";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("fs/promises", () => ({
  default: {
    lstat: vi.fn(),
    stat: vi.fn(),
    realpath: vi.fn(),
    open: vi.fn(),
  },
}));

import fs from "fs/promises";
import {
  detectCLIFrameworkAndEntrypoints,
  isCLIImplementationPath,
  isSensitiveRepositoryPath,
  selectCLIImplementationFiles,
  snapshotRepositoryFile,
} from "../../src/scanner/index.js";

const mockLstat = vi.mocked(fs.lstat);
const mockStat = vi.mocked(fs.stat);
const mockRealpath = vi.mocked(fs.realpath);
const mockOpen = vi.mocked(fs.open);

function makeStat(
  size: number,
  options: { ino?: number; nlink?: number } = {},
): Stats {
  return {
    dev: 1,
    ino: options.ino ?? 2,
    nlink: options.nlink ?? 1,
    size,
    mtimeMs: 1,
    ctimeMs: 1,
    isFile: () => true,
    isSymbolicLink: () => false,
  } as Stats;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockRealpath.mockImplementation(async (filePath) =>
    path.resolve(String(filePath)));
  mockStat.mockImplementation(async (filePath) => mockLstat(filePath));
});

describe("shared repository path helpers", () => {
  it("filters non-production command sources consistently", () => {
    const files = [
      "src/main.ts",
      "src/commands/serve.ts",
      "tests/commands/fake.ts",
      "spec/commands/fake.ts",
      "fixtures/commands/fake.ts",
      "generated/commands/fake.ts",
      "dist/commands/fake.js",
      "build/commands/fake.js",
      "vendor/commands/fake.go",
    ];

    expect(selectCLIImplementationFiles(files, ["src/main.ts"])).toEqual([
      "src/commands/serve.ts",
      "src/main.ts",
    ]);
    expect(isCLIImplementationPath("src/tokens.ts")).toBe(true);
    expect(isCLIImplementationPath("src/design-tokens.ts")).toBe(true);
    expect(isCLIImplementationPath("src/api-key-utils.ts")).toBe(true);
  });

  it("detects frameworks and entrypoints from metadata and source", () => {
    expect(detectCLIFrameworkAndEntrypoints(
      ["package.json", "src/main.ts"],
      new Map([
        ["package.json", JSON.stringify({
          dependencies: { "@oclif/core": "^4.0.0" },
          bin: { app: "./src/main.ts" },
        })],
      ]),
    )).toEqual({
      framework: "oclif",
      entryFiles: ["src/main.ts"],
    });

    expect(detectCLIFrameworkAndEntrypoints(
      ["cli.py"],
      new Map([["cli.py", "import click\n@click.group()\ndef cli(): pass"]]),
    ).framework).toBe("click");
  });

  it("uses sensitive directory segments without excluding source helpers", () => {
    expect(isSensitiveRepositoryPath("secrets/prod.json")).toBe(true);
    expect(isSensitiveRepositoryPath(".kube/config")).toBe(true);
    expect(isSensitiveRepositoryPath(".docker/config.json")).toBe(true);
    expect(isSensitiveRepositoryPath(".config/gcloud/credentials.db")).toBe(true);
    expect(isSensitiveRepositoryPath("src/design-tokens.ts")).toBe(false);
    expect(isSensitiveRepositoryPath("src/tokens.ts")).toBe(false);
    expect(isSensitiveRepositoryPath("src/api-key-utils.ts")).toBe(false);
  });
});

describe("secure repository file snapshots", () => {
  it("does not read when the opened handle and path identity differ", async () => {
    const openedStat = makeStat(5, { ino: 2 });
    const replacedStat = makeStat(5, { ino: 3 });
    const read = vi.fn();
    mockOpen.mockResolvedValue({
      stat: vi.fn().mockResolvedValue(openedStat),
      read,
      close: vi.fn().mockResolvedValue(undefined),
    } as never);
    mockLstat.mockResolvedValue(replacedStat);
    mockStat.mockResolvedValue(replacedStat);

    const file = await snapshotRepositoryFile("/fake/root", "src/main.ts");

    expect(file).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  it("does not read a hard-linked repository file", async () => {
    const hardLinkedStat = makeStat(5, { nlink: 2 });
    const read = vi.fn();
    mockOpen.mockResolvedValue({
      stat: vi.fn().mockResolvedValue(hardLinkedStat),
      read,
      close: vi.fn().mockResolvedValue(undefined),
    } as never);

    const file = await snapshotRepositoryFile("/fake/root", "src/main.ts");

    expect(file).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  it("streams full-file digests while retaining only the requested text prefix", async () => {
    const content = Buffer.from("x".repeat(200_000));
    const fileStat = makeStat(content.byteLength);
    const read = vi.fn(async (
      buffer: Buffer,
      offset: number,
      length: number,
      position: number,
    ) => {
      const bytesRead = Math.min(length, content.byteLength - position);
      if (bytesRead > 0) {
        content.copy(buffer, offset, position, position + bytesRead);
      }
      return { bytesRead, buffer };
    });
    mockOpen.mockResolvedValue({
      stat: vi.fn().mockResolvedValue(fileStat),
      read,
      close: vi.fn().mockResolvedValue(undefined),
    } as never);
    mockLstat.mockResolvedValue(fileStat);
    mockStat.mockResolvedValue(fileStat);

    const file = await snapshotRepositoryFile(
      "/fake/root",
      "src/main.ts",
      { computeDigest: true, textByteLimit: 16 },
    );

    expect(file).toMatchObject({
      text: "x".repeat(16),
      textTruncated: true,
      digest: createHash("sha256").update(content).digest("hex"),
    });
    expect(read).toHaveBeenCalledTimes(5);
    expect(Math.max(...read.mock.calls.map((call) => call[2]))).toBeLessThanOrEqual(
      64 * 1024,
    );
    expect("bytes" in file!).toBe(false);
  });

  it("stops reading after the bounded text sample when hashing is disabled", async () => {
    const fileStat = makeStat(10_000_000);
    const read = vi.fn(async (
      buffer: Buffer,
      offset: number,
      length: number,
    ) => {
      buffer.fill("a", offset, offset + length);
      return { bytesRead: length, buffer };
    });
    mockOpen.mockResolvedValue({
      stat: vi.fn().mockResolvedValue(fileStat),
      read,
      close: vi.fn().mockResolvedValue(undefined),
    } as never);
    mockLstat.mockResolvedValue(fileStat);
    mockStat.mockResolvedValue(fileStat);

    const file = await snapshotRepositoryFile(
      "/fake/root",
      "src/main.ts",
      { computeDigest: false, textByteLimit: 1024 },
    );

    expect(file?.text).toHaveLength(1024);
    expect(file?.digest).toBeUndefined();
    expect(file?.textTruncated).toBe(true);
    expect(read).toHaveBeenCalledOnce();
    expect(read.mock.calls[0][2]).toBe(1024);
  });
});
