import crypto from "crypto";
import path from "path";
import { z } from "zod";
import type { AnalysisResult } from "../analyzer/types.js";
import type { GeneratorResult } from "./index.js";
import {
  AGENTSMITH_MANAGED_MARKER,
  managedAssetKind,
  type ManagedAssetKind,
} from "./managed-assets.js";
import {
  readContainedFile,
  resolveContainedExistingFile,
  type ContainedRoot,
} from "./path-safety.js";

const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);

const AgentFileSchema = z.object({
  name: z.string().min(1),
  file: z.string().min(1),
  isSubAgent: z.boolean(),
});

const SkillFileSchema = z.object({
  name: z.string().min(1),
  file: z.string().min(1),
});

const FreshnessSchema = z.object({
  schemaVersion: z.literal(3),
  ownership: z.object({
    marker: z.literal(AGENTSMITH_MANAGED_MARKER),
  }).strict(),
  generatedAt: z.string(),
  repoName: z.string().optional(),
  skills: z.record(z.unknown()).optional(),
  generatedAgents: z.array(AgentFileSchema),
  generatedSkills: z.array(SkillFileSchema),
  generatedHooks: z.array(z.string()),
  generatedHandoffFile: z.string().optional(),
  generatedDigests: z.record(DigestSchema),
}).strict().superRefine((metadata, context) => {
  const files = [
    ...metadata.generatedAgents.map((agent) => agent.file),
    ...metadata.generatedSkills.map((skill) => skill.file),
    ...metadata.generatedHooks,
    ...(metadata.generatedHandoffFile ? [metadata.generatedHandoffFile] : []),
  ];
  for (const file of files) {
    if (!metadata.generatedDigests[file]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Missing generated digest for ${file}`,
        path: ["generatedDigests", file],
      });
    }
  }
});

export type FreshnessMetadata = z.infer<typeof FreshnessSchema>;

export interface ManagedFreshnessFile {
  file: string;
  digest: string;
  kind: ManagedAssetKind;
}

export async function readFreshness(
  root: ContainedRoot,
): Promise<FreshnessMetadata | undefined> {
  const freshnessPath = path.join(root.requestedRoot, ".github", "copilot", "freshness.json");
  try {
    await resolveContainedExistingFile(root, freshnessPath);
    const parsed = FreshnessSchema.safeParse(JSON.parse(await readContainedFile(root, freshnessPath)));
    return parsed.success ? parsed.data : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}

export function previousManagedAgentFiles(metadata?: FreshnessMetadata): string[] {
  return metadata?.generatedAgents.map((agent) => agent.file) ?? [];
}

export function previousManagedHandoff(metadata?: FreshnessMetadata): string | undefined {
  return metadata?.generatedHandoffFile;
}

export function previousManagedFiles(
  metadata?: FreshnessMetadata,
): ManagedFreshnessFile[] {
  if (!metadata) return [];
  const files = [
    ...metadata.generatedAgents.map((agent) => agent.file),
    ...metadata.generatedSkills.map((skill) => skill.file),
    ...metadata.generatedHooks,
    ...(metadata.generatedHandoffFile ? [metadata.generatedHandoffFile] : []),
  ];
  return files.flatMap((file) => {
    const kind = managedAssetKind(file);
    const digest = metadata.generatedDigests[file];
    return kind && digest ? [{ file, digest, kind }] : [];
  });
}

export function serializeFreshness(
  analysis: AnalysisResult,
  result: GeneratorResult,
  handoffFile?: string,
  generatedDigests: ReadonlyMap<string, string> | Record<string, string> = {},
): string {
  const skills = Object.fromEntries(analysis.skills.map((skill) => [
    skill.name,
    {
      sourceDir: skill.sourceDir,
      fingerprint: crypto.createHash("sha256")
        .update(JSON.stringify({
          patterns: skill.patterns,
          references: skill.codebaseReferences ?? [],
        }))
        .digest("hex"),
    },
  ]));
  const digests = generatedDigests instanceof Map
    ? Object.fromEntries(generatedDigests)
    : generatedDigests;

  const metadata = FreshnessSchema.parse({
    schemaVersion: 3,
    ownership: {
      marker: AGENTSMITH_MANAGED_MARKER,
    },
    generatedAt: new Date().toISOString(),
    repoName: analysis.repoName,
    skills,
    generatedAgents: result.agentFiles,
    generatedSkills: result.skillFiles,
    generatedHooks: result.hookFiles,
    generatedHandoffFile: handoffFile,
    generatedDigests: digests,
  });
  return `${JSON.stringify(metadata, null, 2)}\n`;
}
