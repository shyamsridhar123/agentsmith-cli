/**
 * License Detection - The Gatekeeper
 * Ensures only repos with permissive licenses are assimilated.
 * "We're not here because we're free. We're here because we're not free."
 */

import fs from "fs/promises";
import path from "path";

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

export async function detectLicense(repoPath: string): Promise<LicenseInfo> {
  // Try to find and read a license file
  for (const filename of LICENSE_FILES) {
    const licensePath = path.join(repoPath, filename);
    try {
      const content = await fs.readFile(licensePath, "utf-8");
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
    } catch {
      // File doesn't exist, continue
    }
  }

  // Check package.json for license field
  try {
    const packageJsonPath = path.join(repoPath, "package.json");
    const content = await fs.readFile(packageJsonPath, "utf-8");
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
  } catch {
    // No package.json or invalid
  }

  // Check pyproject.toml for license
  try {
    const pyprojectPath = path.join(repoPath, "pyproject.toml");
    const content = await fs.readFile(pyprojectPath, "utf-8");
    
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
  } catch {
    // No pyproject.toml or invalid
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
