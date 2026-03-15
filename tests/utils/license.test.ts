/**
 * Tests for src/utils/license.ts
 * License detection and identification.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs/promises", () => ({
  default: {
    readFile: vi.fn(),
  },
}));

import fs from "fs/promises";
import { detectLicense, isPermissiveLicense, formatLicenseStatus } from "../../src/utils/license.js";
import type { LicenseInfo } from "../../src/utils/license.js";

const mockReadFile = vi.mocked(fs.readFile);

beforeEach(() => {
  vi.resetAllMocks();
  // By default, all file reads fail (file not found)
  mockReadFile.mockRejectedValue(new Error("ENOENT"));
});

// ---------------------------------------------------------------------------
// Helper: mock a file at a specific path
// ---------------------------------------------------------------------------

function mockFileContent(pathFragment: string, content: string) {
  mockReadFile.mockImplementation(((filePath: string) => {
    if (filePath.includes(pathFragment)) {
      return Promise.resolve(content);
    }
    return Promise.reject(new Error("ENOENT"));
  }) as any);
}

// ---------------------------------------------------------------------------
// detectLicense — LICENSE file content
// ---------------------------------------------------------------------------

describe("detectLicense", () => {
  it("detects MIT license from LICENSE file", async () => {
    mockFileContent("LICENSE", "MIT License\n\nCopyright (c) 2024 Test Author");
    const result = await detectLicense("/repo");
    expect(result.detected).toBe(true);
    expect(result.name).toBe("MIT");
    expect(result.spdxId).toBe("MIT");
    expect(result.permissive).toBe(true);
    expect(result.file).toBe("LICENSE");
  });

  it("detects Apache-2.0 license", async () => {
    mockFileContent("LICENSE", "Apache License\nVersion 2.0, January 2004");
    const result = await detectLicense("/repo");
    expect(result.detected).toBe(true);
    expect(result.name).toBe("Apache-2.0");
    expect(result.permissive).toBe(true);
  });

  it("detects BSD-2-Clause license", async () => {
    mockFileContent("LICENSE", "BSD 2-Clause License\nRedistribution and use...");
    const result = await detectLicense("/repo");
    expect(result.detected).toBe(true);
    expect(result.name).toBe("BSD-2-Clause");
    expect(result.permissive).toBe(true);
  });

  it("detects BSD-3-Clause license", async () => {
    mockFileContent("LICENSE", "BSD 3-Clause License\nRedistribution and use...");
    const result = await detectLicense("/repo");
    expect(result.detected).toBe(true);
    expect(result.name).toBe("BSD-3-Clause");
    expect(result.permissive).toBe(true);
  });

  it("detects GPL-3.0 license", async () => {
    mockFileContent("LICENSE", "GNU General Public License v3\nVersion 3, 29 June 2007");
    const result = await detectLicense("/repo");
    expect(result.detected).toBe(true);
    expect(result.name).toBe("GPL-3.0");
    expect(result.permissive).toBe(true);
  });

  it("detects ISC license", async () => {
    mockFileContent("LICENSE", "ISC License\nCopyright (c) 2024");
    const result = await detectLicense("/repo");
    expect(result.detected).toBe(true);
    expect(result.name).toBe("ISC");
    expect(result.permissive).toBe(true);
  });

  it("detects proprietary license (all rights reserved)", async () => {
    mockFileContent("LICENSE", "Copyright 2024 Company. All rights reserved.");
    const result = await detectLicense("/repo");
    expect(result.detected).toBe(true);
    expect(result.name).toBe("Proprietary");
    expect(result.permissive).toBe(false);
  });

  it("returns Unknown when license file exists but is unrecognized", async () => {
    mockFileContent("LICENSE", "Some custom license terms that don't match any pattern.");
    const result = await detectLicense("/repo");
    expect(result.detected).toBe(true);
    expect(result.name).toBe("Unknown");
    expect(result.permissive).toBe(false);
  });

  it("returns not detected when no license files exist", async () => {
    // All reads fail by default (ENOENT)
    const result = await detectLicense("/repo");
    expect(result.detected).toBe(false);
    expect(result.name).toBeNull();
    expect(result.file).toBeNull();
  });

  it("falls back to package.json license field", async () => {
    // Only package.json exists, no LICENSE file
    mockReadFile.mockImplementation(((filePath: string) => {
      if (filePath.endsWith("package.json")) {
        return Promise.resolve(JSON.stringify({ license: "MIT" }));
      }
      return Promise.reject(new Error("ENOENT"));
    }) as any);

    const result = await detectLicense("/repo");
    expect(result.detected).toBe(true);
    expect(result.name).toBe("MIT");
    expect(result.spdxId).toBe("MIT");
    expect(result.permissive).toBe(true);
    expect(result.file).toBe("package.json");
  });

  it("falls back to pyproject.toml license field", async () => {
    mockReadFile.mockImplementation(((filePath: string) => {
      if (filePath.endsWith("pyproject.toml")) {
        return Promise.resolve('license = "Apache-2.0"');
      }
      return Promise.reject(new Error("ENOENT"));
    }) as any);

    const result = await detectLicense("/repo");
    expect(result.detected).toBe(true);
    expect(result.name).toBe("Apache-2.0");
    expect(result.permissive).toBe(true);
    expect(result.file).toBe("pyproject.toml");
  });

  it("reports non-permissive when package.json has unknown license", async () => {
    mockReadFile.mockImplementation(((filePath: string) => {
      if (filePath.endsWith("package.json")) {
        return Promise.resolve(JSON.stringify({ license: "SSPL-1.0" }));
      }
      return Promise.reject(new Error("ENOENT"));
    }) as any);

    const result = await detectLicense("/repo");
    expect(result.detected).toBe(true);
    expect(result.permissive).toBe(false);
  });

  it("detects Unlicense", async () => {
    mockFileContent(
      "LICENSE",
      "This is free and unencumbered software released into the public domain.",
    );
    const result = await detectLicense("/repo");
    expect(result.detected).toBe(true);
    expect(result.name).toBe("Unlicense");
    expect(result.permissive).toBe(true);
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
