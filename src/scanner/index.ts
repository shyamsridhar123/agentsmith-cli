/**
 * Scanner - The Eye of Agent Smith
 * Enumerates repository structure, detects language/framework, finds config files.
 */

import path from "path";
import { glob } from "glob";
import {
  CLI_METADATA_FILES,
  detectCLIFrameworkAndEntrypoints,
  selectCLIImplementationFiles,
} from "./cli.js";
import {
  isGeneratedRepositoryPath,
  isSensitiveRepositoryPath,
  isTestOrFixturePath,
  readSafeRepositoryFile,
  resolveSafeRepositoryFile,
} from "./paths.js";

export * from "./cli.js";
export * from "./paths.js";

export interface ScanResult {
  rootPath: string;
  files: FileInfo[];
  language: string;
  framework: string | null;
  configFiles: string[];
  testFiles: string[];
  sourceDirectories: string[];
  cliFramework: string | null;
  cliEntryFiles: string[];
}

export interface FileInfo {
  path: string;
  relativePath: string;
  extension: string;
  size: number;
  isTest: boolean;
  isConfig: boolean;
}

// Files/dirs to always ignore
const IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/coverage/**",
  "**/__pycache__/**",
  "**/.venv/**",
  "**/venv/**",
  "**/vendor/**",
  "**/generated/**",
  "**/__generated__/**",
  "**/.env*",
  "**/.npmrc",
  "**/.pypirc",
  "**/.netrc",
  "**/*.lock",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
];

// Config file patterns
const CONFIG_PATTERNS = [
  "package.json",
  "tsconfig.json",
  "pyproject.toml",
  "setup.py",
  "requirements.txt",
  "go.mod",
  "Cargo.toml",
  ".eslintrc*",
  ".prettierrc*",
  "docker-compose*.yml",
  "Dockerfile",
  ".github/workflows/*.yml",
];

const CLI_METADATA_READ_LIMIT = 512 * 1024;
const CLI_SOURCE_READ_LIMIT = 256 * 1024;
const CLI_TOTAL_READ_LIMIT = 8 * 1024 * 1024;

export class Scanner {
  private rootPath: string;
  private verbose: boolean;

  constructor(rootPath: string, verbose = false) {
    this.rootPath = rootPath;
    this.verbose = verbose;
  }

  async scan(): Promise<ScanResult> {
    // Find all files
    const allFiles = await glob("**/*", {
      cwd: this.rootPath,
      nodir: true,
      ignore: IGNORE_PATTERNS,
      absolute: false,
    });

    // Build file info
    const files: FileInfo[] = [];
    for (const relativePath of allFiles) {
      if (
        isSensitiveRepositoryPath(relativePath) ||
        isGeneratedRepositoryPath(relativePath)
      ) {
        continue;
      }
      const safeFile = await resolveSafeRepositoryFile(this.rootPath, relativePath);
      if (!safeFile) continue;
      files.push({
        path: safeFile.path,
        relativePath,
        extension: path.extname(relativePath),
        size: safeFile.size,
        isTest: this.isTestFile(relativePath),
        isConfig: this.isConfigFile(relativePath),
      });
    }

    // Detect language
    const language = this.detectLanguage(files);

    // Detect framework
    const framework = await this.detectFramework(files);

    // Find config files
    const configFiles = files.filter((f) => f.isConfig).map((f) => f.relativePath);

    // Find test files
    const testFiles = files.filter((f) => f.isTest).map((f) => f.relativePath);

    // Find source directories
    const sourceDirectories = this.detectSourceDirectories(files);
    const cli = await this.detectCLI(files);

    return {
      rootPath: this.rootPath,
      files,
      language,
      framework,
      configFiles,
      testFiles,
      sourceDirectories,
      cliFramework: cli.framework,
      cliEntryFiles: cli.entryFiles,
    };
  }

  private async detectCLI(files: FileInfo[]): Promise<{ framework: string | null; entryFiles: string[] }> {
    const contents = new Map<string, string>();
    const availablePaths = new Set(files.map((file) => file.relativePath.replace(/\\/g, "/")));
    let remainingBytes = CLI_TOTAL_READ_LIMIT;
    for (const metadataPath of CLI_METADATA_FILES) {
      if (!availablePaths.has(metadataPath) || remainingBytes <= 0) continue;
      const content = await readSafeRepositoryFile(
        this.rootPath,
        metadataPath,
        Math.min(CLI_METADATA_READ_LIMIT, remainingBytes),
      );
      if (content !== undefined) {
        contents.set(metadataPath, content);
        remainingBytes -= Buffer.byteLength(content);
      }
    }

    const preliminary = detectCLIFrameworkAndEntrypoints(
      availablePaths,
      contents,
    );
    const implementationPaths = selectCLIImplementationFiles(
      availablePaths,
      preliminary.entryFiles,
    );
    for (const implementationPath of implementationPaths.slice(0, 100)) {
      if (remainingBytes <= 0) break;
      const content = await readSafeRepositoryFile(
        this.rootPath,
        implementationPath,
        Math.min(CLI_SOURCE_READ_LIMIT, remainingBytes),
      );
      if (content !== undefined) {
        contents.set(implementationPath, content);
        remainingBytes -= Buffer.byteLength(content);
      }
    }

    return detectCLIFrameworkAndEntrypoints(availablePaths, contents);
  }

  private detectLanguage(files: FileInfo[]): string {
    const extCounts: Record<string, number> = {};

    for (const file of files) {
      if (file.extension) {
        extCounts[file.extension] = (extCounts[file.extension] || 0) + 1;
      }
    }

    // Priority mapping
    const languageMap: Record<string, string> = {
      ".ts": "TypeScript",
      ".tsx": "TypeScript",
      ".js": "JavaScript",
      ".jsx": "JavaScript",
      ".py": "Python",
      ".go": "Go",
      ".rs": "Rust",
      ".java": "Java",
      ".cs": "C#",
      ".rb": "Ruby",
      ".php": "PHP",
    };

    // Find most common language
    let maxCount = 0;
    let detectedLang = "Unknown";

    for (const [ext, lang] of Object.entries(languageMap)) {
      if (extCounts[ext] && extCounts[ext] > maxCount) {
        maxCount = extCounts[ext];
        detectedLang = lang;
      }
    }

    // Check for TypeScript config to override JS detection
    if (detectedLang === "JavaScript" && files.some((f) => f.relativePath.includes("tsconfig"))) {
      detectedLang = "TypeScript";
    }

    return detectedLang;
  }

  private async detectFramework(files: FileInfo[]): Promise<string | null> {
    const fileSet = new Set(files.map((f) => f.relativePath));
    const hasFile = (name: string) => fileSet.has(name);

    // Check package.json for dependencies
    if (hasFile("package.json")) {
      try {
        const content = await readSafeRepositoryFile(this.rootPath, "package.json");
        if (content === undefined) return null;
        const pkg = JSON.parse(content);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };

        if (deps["next"]) return "Next.js";
        if (deps["react"]) return "React";
        if (deps["vue"]) return "Vue";
        if (deps["@angular/core"]) return "Angular";
        if (deps["express"]) return "Express.js";
        if (deps["fastify"]) return "Fastify";
        if (deps["nestjs"]) return "NestJS";
      } catch {
        // Ignore parse errors
      }
    }

    // Python frameworks
    if (hasFile("pyproject.toml") || hasFile("requirements.txt")) {
      const reqPath = hasFile("requirements.txt")
        ? path.join(this.rootPath, "requirements.txt")
        : null;
      if (reqPath) {
        try {
          const content = await readSafeRepositoryFile(
            this.rootPath,
            path.relative(this.rootPath, reqPath),
          );
          if (content === undefined) return null;
          if (content.includes("django")) return "Django";
          if (content.includes("flask")) return "Flask";
          if (content.includes("fastapi")) return "FastAPI";
        } catch {
          // Ignore
        }
      }
    }

    // Go frameworks
    if (hasFile("go.mod")) {
      try {
        const content = await readSafeRepositoryFile(this.rootPath, "go.mod");
        if (content === undefined) return null;
        if (content.includes("gin-gonic")) return "Gin";
        if (content.includes("echo")) return "Echo";
        if (content.includes("fiber")) return "Fiber";
      } catch {
        // Ignore
      }
    }

    return null;
  }

  private isTestFile(relativePath: string): boolean {
    return isTestOrFixturePath(relativePath);
  }

  private isConfigFile(relativePath: string): boolean {
    const basename = path.basename(relativePath);
    return CONFIG_PATTERNS.some((pattern) => {
      if (pattern.includes("*")) {
        const regex = new RegExp(pattern.replace("*", ".*"));
        return regex.test(basename);
      }
      return basename === pattern || relativePath.includes(pattern.replace("*", ""));
    });
  }

  private detectSourceDirectories(files: FileInfo[]): string[] {
    const dirs = new Set<string>();
    const commonSrcDirs = ["src", "lib", "app", "pkg", "internal", "cmd"];

    for (const file of files) {
      if (file.isTest || file.isConfig) continue;

      const parts = file.relativePath.split(path.sep);
      if (parts.length > 1) {
        const firstDir = parts[0];
        if (commonSrcDirs.includes(firstDir)) {
          dirs.add(firstDir);
        }
      }
    }

    // If no common src dirs, find directories with most code files
    if (dirs.size === 0) {
      const dirCounts: Record<string, number> = {};
      for (const file of files) {
        const parts = file.relativePath.split(path.sep);
        if (parts.length > 1 && !file.isTest && !file.isConfig) {
          dirCounts[parts[0]] = (dirCounts[parts[0]] || 0) + 1;
        }
      }

      const sorted = Object.entries(dirCounts).sort((a, b) => b[1] - a[1]);
      for (const [dir] of sorted.slice(0, 3)) {
        dirs.add(dir);
      }
    }

    return Array.from(dirs);
  }
}
