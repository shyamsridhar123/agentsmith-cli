import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { GitHubClient } from "../github/index.js";
import { isGitHubUrl } from "../utils/git.js";
import { Registry, type RegistryEntry } from "../registry/index.js";

const SkillPackSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/i),
  version: z.string().min(1),
  description: z.string().default(""),
  skills: z.array(z.object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    path: z.string().min(1),
    description: z.string().default(""),
    triggers: z.array(z.string()).default([]),
  })).min(1),
});

export type SkillPack = z.infer<typeof SkillPackSchema>;

interface PackLock {
  schemaVersion: 1;
  packs: Record<string, {
    source: string;
    version: string;
    checksum: string;
    installedAt: string;
  }>;
}

async function readLocalFile(root: string, relativePath: string): Promise<string> {
  const realRoot = await fs.realpath(root);
  const requested = path.resolve(realRoot, relativePath);
  const realFile = await fs.realpath(requested);
  const relative = path.relative(realRoot, realFile);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Skill pack path escapes its root: ${relativePath}`);
  }
  return fs.readFile(realFile, "utf-8");
}

async function readPackSource(source: string): Promise<{
  manifest: SkillPack;
  readFile: (file: string) => Promise<string>;
}> {
  if (isGitHubUrl(source)) {
    const client = new GitHubClient(source);
    const manifest = SkillPackSchema.parse(JSON.parse(await client.getFileContent("skill-pack.json")));
    return { manifest, readFile: (file) => client.getFileContent(file) };
  }
  const root = path.resolve(source);
  const manifest = SkillPackSchema.parse(JSON.parse(await readLocalFile(root, "skill-pack.json")));
  return { manifest, readFile: (file) => readLocalFile(root, file) };
}

async function readLock(root: string): Promise<PackLock> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(root, ".github", "copilot", "packs-lock.json"), "utf-8"));
    if (raw?.schemaVersion === 1 && raw.packs && typeof raw.packs === "object") return raw as PackLock;
  } catch {
    // Missing or invalid lock files start empty.
  }
  return { schemaVersion: 1, packs: {} };
}

export async function installSkillPack(source: string, root: string): Promise<SkillPack> {
  const targetRoot = path.resolve(root);
  const { manifest, readFile } = await readPackSource(source);
  const registryEntries: RegistryEntry[] = [];
  const checksums: string[] = [];

  for (const skill of manifest.skills) {
    const content = await readFile(skill.path);
    if (!content.startsWith("---") || !content.includes("\n---", 3)) {
      throw new Error(`Skill ${skill.name} does not contain valid frontmatter`);
    }
    checksums.push(crypto.createHash("sha256").update(content).digest("hex"));
    const destination = path.join(targetRoot, ".github", "skills", skill.name);
    await fs.mkdir(destination, { recursive: true });
    await fs.writeFile(path.join(destination, "SKILL.md"), content, "utf-8");
    registryEntries.push({
      type: "skill",
      name: skill.name,
      file: `.github/skills/${skill.name}/SKILL.md`,
      description: skill.description || manifest.description,
      triggers: skill.triggers,
      category: "pack",
    });
  }

  await new Registry(targetRoot).upsert(registryEntries);
  const lock = await readLock(targetRoot);
  lock.packs[manifest.name] = {
    source,
    version: manifest.version,
    checksum: crypto.createHash("sha256").update(checksums.sort().join(":")).digest("hex"),
    installedAt: new Date().toISOString(),
  };
  const lockDir = path.join(targetRoot, ".github", "copilot");
  await fs.mkdir(lockDir, { recursive: true });
  await fs.writeFile(path.join(lockDir, "packs-lock.json"), `${JSON.stringify(lock, null, 2)}\n`, "utf-8");
  return manifest;
}

export async function updateSkillPacks(root: string, name?: string): Promise<SkillPack[]> {
  const lock = await readLock(path.resolve(root));
  const selected = Object.entries(lock.packs).filter(([packName]) => !name || name === packName);
  if (name && selected.length === 0) throw new Error(`Skill pack is not installed: ${name}`);
  const updated: SkillPack[] = [];
  for (const [, entry] of selected) updated.push(await installSkillPack(entry.source, root));
  return updated;
}
