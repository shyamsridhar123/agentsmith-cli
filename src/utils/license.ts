/**
 * License Detection - The Gatekeeper
 * Ensures only repos with permissive licenses are assimilated.
 * "We're not here because we're free. We're here because we're not free."
 */

import { constants as fsConstants, type Stats } from "node:fs";
import fs, { type FileHandle } from "node:fs/promises";
import path from "node:path";

export interface LicenseInfo {
  detected: boolean;
  name: string | null;
  spdxId: string | null;
  permissive: boolean;
  file: string | null;
}

// Permissive licenses that allow derivative works and redistribution
const PERMISSIVE_LICENSES: Record<string, string[]> = {
  // MIT family
  "MIT": ["mit license", "the mit license", "mit-license"],
  
  // Apache
  "Apache-2.0": ["apache license", "apache-2.0", "apache 2.0", "licensed under the apache license"],
  
  // BSD family
  "BSD-2-Clause": ["bsd 2-clause", "bsd-2-clause", "simplified bsd", "freebsd license"],
  "BSD-3-Clause": ["bsd 3-clause", "bsd-3-clause", "new bsd", "modified bsd"],
  "0BSD": ["zero-clause bsd", "0bsd"],
  
  // GPL family (copyleft but permissive for our purposes)
  "GPL-2.0": ["gnu general public license v2", "gpl-2.0", "gplv2", "gnu gpl v2"],
  "GPL-3.0": ["gnu general public license v3", "gpl-3.0", "gplv3", "gnu gpl v3"],
  "LGPL-2.1": ["gnu lesser general public license v2.1", "lgpl-2.1", "lgplv2.1"],
  "LGPL-3.0": ["gnu lesser general public license v3", "lgpl-3.0", "lgplv3"],
  "AGPL-3.0": ["gnu affero general public license", "agpl-3.0", "agplv3"],
  
  // Other permissive
  "ISC": ["isc license"],
  "MPL-2.0": ["mozilla public license", "mpl-2.0", "mpl 2.0"],
  "Unlicense": ["unlicense", "this is free and unencumbered software"],
  "CC0-1.0": ["cc0", "creative commons zero", "cc0-1.0"],
  "WTFPL": ["wtfpl", "do what the fuck you want"],
  "Zlib": ["zlib license"],
  "BlueOak-1.0.0": ["blue oak model license"],
};

// License files to check (in order of priority)
const LICENSE_FILES = [
  "LICENSE",
  "LICENSE.md",
  "LICENSE.txt",
  "LICENCE",
  "LICENCE.md",
  "LICENCE.txt",
  "license",
  "license.md",
  "license.txt",
  "COPYING",
  "COPYING.md",
  "COPYING.txt",
];

interface SecureRepository {
  rootPath: string;
  realRootPath: string;
  rootIdentity: Stats;
}

function comparisonPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function samePath(left: string, right: string): boolean {
  return comparisonPath(left) === comparisonPath(right);
}

function sameFileIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function isContainedPath(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath))
  );
}

function isSafeFileStat(fileStat: Stats): boolean {
  return fileStat.isFile() && fileStat.nlink === 1;
}

async function hasLinkedPathComponent(filePath: string): Promise<boolean> {
  const resolvedPath = path.resolve(filePath);
  const root = path.parse(resolvedPath).root;
  const segments = path.relative(root, resolvedPath)
    .split(path.sep)
    .filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = path.join(current, segment);
    if ((await fs.lstat(current)).isSymbolicLink()) {
      return true;
    }
  }
  return false;
}

function unchangedDuringRead(before: Stats, after: Stats): boolean {
  return (
    sameFileIdentity(before, after) &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs &&
    isSafeFileStat(after)
  );
}

async function repositoryRootIsStable(
  repository: SecureRepository,
): Promise<boolean> {
  try {
    const [pathStat, resolvedPath, resolvedStat] = await Promise.all([
      fs.lstat(repository.rootPath),
      fs.realpath(repository.rootPath),
      fs.stat(repository.realRootPath),
    ]);

    return (
      pathStat.isDirectory() &&
      resolvedStat.isDirectory() &&
      !pathStat.isSymbolicLink() &&
      !await hasLinkedPathComponent(repository.rootPath) &&
      sameFileIdentity(repository.rootIdentity, pathStat) &&
      sameFileIdentity(repository.rootIdentity, resolvedStat) &&
      samePath(repository.realRootPath, resolvedPath)
    );
  } catch {
    return false;
  }
}

async function openSecureRepository(
  repoPath: string,
): Promise<SecureRepository | undefined> {
  const rootPath = path.resolve(repoPath);

  try {
    const pathStat = await fs.lstat(rootPath);
    if (!pathStat.isDirectory() || pathStat.isSymbolicLink()) {
      return undefined;
    }

    const realRootPath = await fs.realpath(rootPath);
    const rootIdentity = await fs.stat(realRootPath);
    if (
      !rootIdentity.isDirectory() ||
      await hasLinkedPathComponent(rootPath) ||
      !sameFileIdentity(rootIdentity, pathStat)
    ) {
      return undefined;
    }

    const repository: SecureRepository = {
      rootPath,
      realRootPath,
      rootIdentity,
    };
    if (!await repositoryRootIsStable(repository)) {
      return undefined;
    }

    return repository;
  } catch {
    return undefined;
  }
}

async function openedFileMatchesPath(
  repository: SecureRepository,
  filePath: string,
  openedStat: Stats,
): Promise<boolean> {
  try {
    const pathStat = await fs.lstat(filePath);
    if (
      pathStat.isSymbolicLink() ||
      !isSafeFileStat(pathStat) ||
      !sameFileIdentity(openedStat, pathStat)
    ) {
      return false;
    }

    const resolvedPath = await fs.realpath(filePath);
    if (
      !samePath(filePath, resolvedPath) ||
      !isContainedPath(repository.realRootPath, resolvedPath)
    ) {
      return false;
    }

    const resolvedStat = await fs.stat(resolvedPath);
    return (
      isSafeFileStat(resolvedStat) &&
      sameFileIdentity(openedStat, resolvedStat)
    );
  } catch {
    return false;
  }
}

async function readSecureRepositoryFile(
  repository: SecureRepository,
  filename: string,
): Promise<string | undefined> {
  if (
    path.basename(filename) !== filename ||
    filename === "." ||
    filename === ".."
  ) {
    return undefined;
  }

  const filePath = path.resolve(repository.realRootPath, filename);
  if (!isContainedPath(repository.realRootPath, filePath)) {
    return undefined;
  }

  let fileHandle: FileHandle | undefined;
  try {
    if (!await repositoryRootIsStable(repository)) {
      return undefined;
    }

    const noFollowFlag = fsConstants.O_NOFOLLOW ?? 0;
    fileHandle = await fs.open(
      filePath,
      fsConstants.O_RDONLY | noFollowFlag,
    );
    const openedStat = await fileHandle.stat();
    if (
      !isSafeFileStat(openedStat) ||
      !await repositoryRootIsStable(repository) ||
      !await openedFileMatchesPath(repository, filePath, openedStat)
    ) {
      return undefined;
    }

    const content = await fileHandle.readFile({ encoding: "utf8" });
    const afterReadStat = await fileHandle.stat();
    if (
      !unchangedDuringRead(openedStat, afterReadStat) ||
      !await repositoryRootIsStable(repository) ||
      !await openedFileMatchesPath(repository, filePath, afterReadStat)
    ) {
      return undefined;
    }

    return content;
  } catch {
    return undefined;
  } finally {
    if (fileHandle) {
      await fileHandle.close().catch(() => undefined);
    }
  }
}

export async function detectLicense(repoPath: string): Promise<LicenseInfo> {
  const repository = await openSecureRepository(repoPath);
  if (!repository) {
    return {
      detected: false,
      name: null,
      spdxId: null,
      permissive: false,
      file: null,
    };
  }

  // Try to find and read a license file
  for (const filename of LICENSE_FILES) {
    const content = await readSecureRepositoryFile(repository, filename);
    if (content !== undefined) {
      const result = identifyLicense(content);

      if (result.detected) {
        return {
          ...result,
          file: filename,
        };
      }

      // File exists but license not recognized
      return {
        detected: true,
        name: "Unknown",
        spdxId: null,
        permissive: false,
        file: filename,
      };
    }
  }

  // Check package.json for license field
  try {
    const content = await readSecureRepositoryFile(
      repository,
      "package.json",
    );
    if (content !== undefined) {
      const pkg = JSON.parse(content);

      if (pkg.license) {
        const spdxId = pkg.license;
        const isPermissive = Object.keys(PERMISSIVE_LICENSES).some(
          (key) => key.toLowerCase() === spdxId.toLowerCase()
        );

        return {
          detected: true,
          name: spdxId,
          spdxId: spdxId,
          permissive: isPermissive,
          file: "package.json",
        };
      }
    }
  } catch {
    // No package.json or invalid
  }

  // Check pyproject.toml for license
  const content = await readSecureRepositoryFile(repository, "pyproject.toml");
  if (content !== undefined) {
    const licenseMatch = content.match(/license\s*=\s*["{]([^"}]+)["}]/i);
    if (licenseMatch) {
      const licenseName = licenseMatch[1].trim();
      const isPermissive = Object.keys(PERMISSIVE_LICENSES).some(
        (key) => key.toLowerCase() === licenseName.toLowerCase()
      );

      return {
        detected: true,
        name: licenseName,
        spdxId: licenseName,
        permissive: isPermissive,
        file: "pyproject.toml",
      };
    }
  }

  // No license found
  return {
    detected: false,
    name: null,
    spdxId: null,
    permissive: false,
    file: null,
  };
}

function identifyLicense(content: string): Omit<LicenseInfo, "file"> {
  const lowerContent = content.toLowerCase();

  for (const [spdxId, patterns] of Object.entries(PERMISSIVE_LICENSES)) {
    for (const pattern of patterns) {
      if (lowerContent.includes(pattern)) {
        return {
          detected: true,
          name: spdxId,
          spdxId: spdxId,
          permissive: true,
        };
      }
    }
  }

  // Check for common proprietary indicators
  const proprietaryPatterns = [
    "all rights reserved",
    "proprietary",
    "confidential",
    "not for redistribution",
    "may not be copied",
  ];

  for (const pattern of proprietaryPatterns) {
    if (lowerContent.includes(pattern) && !lowerContent.includes("mit")) {
      return {
        detected: true,
        name: "Proprietary",
        spdxId: null,
        permissive: false,
      };
    }
  }

  return {
    detected: false,
    name: null,
    spdxId: null,
    permissive: false,
  };
}

/**
 * Check if a given SPDX license ID is considered permissive.
 * Useful for remote analysis where the SPDX ID comes from the GitHub API.
 */
export function isPermissiveLicense(spdxId: string | undefined | null): boolean {
  if (!spdxId) return false;
  return Object.keys(PERMISSIVE_LICENSES).some(
    (key) => key.toLowerCase() === spdxId.toLowerCase(),
  );
}

export function formatLicenseStatus(license: LicenseInfo): string {
  if (!license.detected) {
    return "No license detected";
  }
  
  if (license.permissive) {
    return `${license.name} (permissive)`;
  }
  
  return `${license.name} (not permissive)`;
}
