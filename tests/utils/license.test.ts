/**
 * Tests for src/utils/license.ts
 * License detection and identification.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectLicense, isPermissiveLicense, formatLicenseStatus } from "../../src/utils/license.js";
import type { LicenseInfo } from "../../src/utils/license.js";

let tempPath: string;
let repoPath: string;

beforeEach(async () => {
  tempPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentsmith-license-"));
  repoPath = path.join(tempPath, "repo");
  await fs.mkdir(repoPath);
});

afterEach(async () => {
  await fs.rm(tempPath, { recursive: true, force: true });
});

async function writeRepoFile(filename: string, content: string): Promise<void> {
  await fs.writeFile(path.join(repoPath, filename), content, "utf8");
}

function isUnsupportedLinkError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) {
    return false;
  }

  return new Set([
    "EACCES",
    "EINVAL",
    "ENOSYS",
    "ENOTSUP",
    "EPERM",
    "EXDEV",
  ]).has(String(error.code));
}

async function tryCreateSymbolicLink(
  target: string,
  linkPath: string,
  type: "file" | "dir" | "junction",
): Promise<boolean> {
  try {
    await fs.symlink(target, linkPath, type);
    return true;
  } catch (error) {
    if (isUnsupportedLinkError(error)) {
      return false;
    }
    throw error;
  }
}

async function tryCreateHardLink(
  target: string,
  linkPath: string,
): Promise<boolean> {
  try {
    await fs.link(target, linkPath);
    return true;
  } catch (error) {
    if (isUnsupportedLinkError(error)) {
      return false;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// detectLicense — LICENSE file content
// ---------------------------------------------------------------------------

describe("detectLicense", () => {
  it("detects MIT license from LICENSE file", async () => {
    await writeRepoFile("LICENSE", "MIT License\n\nCopyright (c) 2024 Test Author");
    const result = await detectLicense(repoPath);
    expect(result.detected).toBe(true);
    expect(result.name).toBe("MIT");
    expect(result.spdxId).toBe("MIT");
    expect(result.permissive).toBe(true);
    expect(result.file).toBe("LICENSE");
  });

  it("detects Apache-2.0 license", async () => {
    await writeRepoFile("LICENSE", "Apache License\nVersion 2.0, January 2004");
    const result = await detectLicense(repoPath);
    expect(result.detected).toBe(true);
    expect(result.name).toBe("Apache-2.0");
    expect(result.permissive).toBe(true);
  });

  it("detects BSD-2-Clause license", async () => {
    await writeRepoFile("LICENSE", "BSD 2-Clause License\nRedistribution and use...");
    const result = await detectLicense(repoPath);
    expect(result.detected).toBe(true);
    expect(result.name).toBe("BSD-2-Clause");
    expect(result.permissive).toBe(true);
  });

  it("detects BSD-3-Clause license", async () => {
    await writeRepoFile("LICENSE", "BSD 3-Clause License\nRedistribution and use...");
    const result = await detectLicense(repoPath);
    expect(result.detected).toBe(true);
    expect(result.name).toBe("BSD-3-Clause");
    expect(result.permissive).toBe(true);
  });

  it("detects GPL-3.0 license", async () => {
    await writeRepoFile("LICENSE", "GNU General Public License v3\nVersion 3, 29 June 2007");
    const result = await detectLicense(repoPath);
    expect(result.detected).toBe(true);
    expect(result.name).toBe("GPL-3.0");
    expect(result.permissive).toBe(true);
  });

  it("detects ISC license", async () => {
    await writeRepoFile("LICENSE", "ISC License\nCopyright (c) 2024");
    const result = await detectLicense(repoPath);
    expect(result.detected).toBe(true);
    expect(result.name).toBe("ISC");
    expect(result.permissive).toBe(true);
  });

  it("detects proprietary license (all rights reserved)", async () => {
    await writeRepoFile("LICENSE", "Copyright 2024 Company. All rights reserved.");
    const result = await detectLicense(repoPath);
    expect(result.detected).toBe(true);
    expect(result.name).toBe("Proprietary");
    expect(result.permissive).toBe(false);
  });

  it("returns Unknown when license file exists but is unrecognized", async () => {
    await writeRepoFile("LICENSE", "Some custom license terms that don't match any pattern.");
    const result = await detectLicense(repoPath);
    expect(result.detected).toBe(true);
    expect(result.name).toBe("Unknown");
    expect(result.permissive).toBe(false);
  });

  it("returns not detected when no license files exist", async () => {
    const result = await detectLicense(repoPath);
    expect(result.detected).toBe(false);
    expect(result.name).toBeNull();
    expect(result.file).toBeNull();
  });

  it("falls back to package.json license field", async () => {
    await writeRepoFile("package.json", JSON.stringify({ license: "MIT" }));
    const result = await detectLicense(repoPath);
    expect(result.detected).toBe(true);
    expect(result.name).toBe("MIT");
    expect(result.spdxId).toBe("MIT");
    expect(result.permissive).toBe(true);
    expect(result.file).toBe("package.json");
  });

  it("falls back to pyproject.toml license field", async () => {
    await writeRepoFile("pyproject.toml", 'license = "Apache-2.0"');
    const result = await detectLicense(repoPath);
    expect(result.detected).toBe(true);
    expect(result.name).toBe("Apache-2.0");
    expect(result.permissive).toBe(true);
    expect(result.file).toBe("pyproject.toml");
  });

  it("reports non-permissive when package.json has unknown license", async () => {
    await writeRepoFile("package.json", JSON.stringify({ license: "SSPL-1.0" }));
    const result = await detectLicense(repoPath);
    expect(result.detected).toBe(true);
    expect(result.permissive).toBe(false);
  });

  it("detects Unlicense", async () => {
    await writeRepoFile(
      "LICENSE",
      "This is free and unencumbered software released into the public domain.",
    );
    const result = await detectLicense(repoPath);
    expect(result.detected).toBe(true);
    expect(result.name).toBe("Unlicense");
    expect(result.permissive).toBe(true);
  });

  it("rejects a license file symlink that escapes the repository", async () => {
    const externalLicense = path.join(tempPath, "external-license");
    await fs.writeFile(externalLicense, "MIT License", "utf8");
    if (!await tryCreateSymbolicLink(
      externalLicense,
      path.join(repoPath, "LICENSE"),
      "file",
    )) {
      return;
    }

    const result = await detectLicense(repoPath);
    expect(result.detected).toBe(false);
    expect(result.permissive).toBe(false);
    expect(result.file).toBeNull();
  });

  it("rejects a repository root reached through a junction or symlink", async () => {
    const externalRepo = path.join(tempPath, "external-repo");
    const linkedRepo = path.join(tempPath, "linked-repo");
    await fs.mkdir(externalRepo);
    await fs.writeFile(path.join(externalRepo, "LICENSE"), "MIT License", "utf8");
    if (!await tryCreateSymbolicLink(
      externalRepo,
      linkedRepo,
      process.platform === "win32" ? "junction" : "dir",
    )) {
      return;
    }

    const result = await detectLicense(linkedRepo);
    expect(result.detected).toBe(false);
    expect(result.permissive).toBe(false);
    expect(result.file).toBeNull();
  });

  it("rejects a repository reached through a linked parent directory", async () => {
    const externalParent = path.join(tempPath, "external-parent");
    const externalRepo = path.join(externalParent, "nested-repo");
    const linkedParent = path.join(tempPath, "linked-parent");
    await fs.mkdir(externalRepo, { recursive: true });
    await fs.writeFile(path.join(externalRepo, "LICENSE"), "MIT License", "utf8");
    if (!await tryCreateSymbolicLink(
      externalParent,
      linkedParent,
      process.platform === "win32" ? "junction" : "dir",
    )) {
      return;
    }

    const result = await detectLicense(path.join(linkedParent, "nested-repo"));
    expect(result.detected).toBe(false);
    expect(result.permissive).toBe(false);
    expect(result.file).toBeNull();
  });

  it("rejects hard-linked license metadata", async () => {
    const externalLicense = path.join(tempPath, "external-license");
    await fs.writeFile(externalLicense, "MIT License", "utf8");
    if (!await tryCreateHardLink(
      externalLicense,
      path.join(repoPath, "LICENSE"),
    )) {
      return;
    }

    const result = await detectLicense(repoPath);
    expect(result.detected).toBe(false);
    expect(result.permissive).toBe(false);
    expect(result.file).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isPermissiveLicense
// ---------------------------------------------------------------------------

describe("isPermissiveLicense", () => {
  it("returns true for MIT", () => {
    expect(isPermissiveLicense("MIT")).toBe(true);
  });

  it("returns true for Apache-2.0", () => {
    expect(isPermissiveLicense("Apache-2.0")).toBe(true);
  });

  it("returns true for BSD-3-Clause", () => {
    expect(isPermissiveLicense("BSD-3-Clause")).toBe(true);
  });

  it("returns true for ISC", () => {
    expect(isPermissiveLicense("ISC")).toBe(true);
  });

  it("returns true for GPL-3.0 (case insensitive)", () => {
    expect(isPermissiveLicense("gpl-3.0")).toBe(true);
  });

  it("returns false for unknown license", () => {
    expect(isPermissiveLicense("SSPL-1.0")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isPermissiveLicense(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isPermissiveLicense(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isPermissiveLicense("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatLicenseStatus
// ---------------------------------------------------------------------------

describe("formatLicenseStatus", () => {
  it("formats undetected license", () => {
    const info: LicenseInfo = {
      detected: false,
      name: null,
      spdxId: null,
      permissive: false,
      file: null,
    };
    expect(formatLicenseStatus(info)).toBe("No license detected");
  });

  it("formats permissive license", () => {
    const info: LicenseInfo = {
      detected: true,
      name: "MIT",
      spdxId: "MIT",
      permissive: true,
      file: "LICENSE",
    };
    expect(formatLicenseStatus(info)).toBe("MIT (permissive)");
  });

  it("formats non-permissive license", () => {
    const info: LicenseInfo = {
      detected: true,
      name: "Proprietary",
      spdxId: null,
      permissive: false,
      file: "LICENSE",
    };
    expect(formatLicenseStatus(info)).toBe("Proprietary (not permissive)");
  });

  it("formats unknown license", () => {
    const info: LicenseInfo = {
      detected: true,
      name: "Unknown",
      spdxId: null,
      permissive: false,
      file: "LICENSE",
    };
    expect(formatLicenseStatus(info)).toBe("Unknown (not permissive)");
  });
});
