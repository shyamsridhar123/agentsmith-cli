/**
 * Source directory mapping
 * The model sometimes returns a file (e.g. "config.ts") or a folder that does
 * not exist as a sourceDir. The generator treats sourceDir as a folder, so map
 * each value onto a folder that exists in the repository.
 */

import path from "path";
import { normalizeRepositoryPath } from "../scanner/index.js";
import type { AgentDefinition, SkillDefinition } from "./types.js";

function toRepositoryPath(value: string): string {
  return path.posix.normalize(normalizeRepositoryPath(value))
    .replace(/^\/+|\/+$/g, "")
    .replace(/^\.$/, "");
}

/**
 * Build a resolver from the repository's file paths. A file maps to its folder,
 * a missing folder maps to its nearest existing parent, and anything else maps
 * to "" (the repository root).
 */
export function createSourceDirResolver(
  repositoryFiles: Iterable<string>,
): (sourceDir: string) => string {
  const files = new Set<string>();
  const directories = new Set<string>();
  for (const filePath of repositoryFiles) {
    const file = toRepositoryPath(filePath);
    files.add(file);
    let directory = path.posix.dirname(file);
    while (directory !== "." && !directories.has(directory)) {
      directories.add(directory);
      directory = path.posix.dirname(directory);
    }
  }

  return (sourceDir) => {
    let directory = toRepositoryPath(sourceDir);
    if (files.has(directory)) directory = path.posix.dirname(directory);
    while (directory !== "" && directory !== "." && !directories.has(directory)) {
      directory = path.posix.dirname(directory);
    }
    return directory === "." ? "" : directory;
  };
}

/** Map skill and agent sourceDir values onto folders that exist in the repository. */
export function mapSourceDirsToRepository(
  skills: SkillDefinition[],
  agents: AgentDefinition[],
  repositoryFiles: Iterable<string>,
): { skills: SkillDefinition[]; agents: AgentDefinition[] } {
  const resolve = createSourceDirResolver(repositoryFiles);
  return {
    skills: skills.map((skill) => ({ ...skill, sourceDir: resolve(skill.sourceDir) })),
    agents: agents.map((agent) => ({
      ...agent,
      sourceDir: agent.sourceDir ? resolve(agent.sourceDir) || undefined : undefined,
    })),
  };
}
