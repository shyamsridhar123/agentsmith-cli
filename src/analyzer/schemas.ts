/**
 * Zod Validation Schemas for LLM Output
 * Validates the unpredictable JSON returned by CopilotClient sessions.
 * "Never send a human to do a machine's job."
 */

import { z } from "zod";

/** Schema for a single skill in LLM output */
export const SkillOutputSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().min(1),
  sourceDir: z.string().default(""),
  patterns: z.array(z.string()).default([]),
  triggers: z.array(z.string()).default([]),
  category: z
    .enum(["architecture", "reliability", "quality", "security", "patterns"])
    .default("patterns"),
  examples: z.array(z.string()).default([]),
});

/** Schema for a tool in LLM output — may be an object or a bare string */
export const ToolOutputSchema = z.union([
  z.object({
    name: z.string().min(1),
    command: z.string().default(""),
    description: z.string().default(""),
  }),
  z.string().min(1),
]);

/** Schema for a hook in LLM output */
export const HookOutputSchema = z.object({
  name: z.string().min(1),
  event: z.string().min(1),
  description: z.string().default(""),
  commands: z.array(z.string()).default([]),
  condition: z.string().optional(),
});

/** Inferred type for a single agent (used by the lazy schema below) */
export type AgentOutput = {
  name: string;
  description: string;
  skills: string[];
  tools: (string | { name: string; command: string; description: string })[];
  isSubAgent: boolean;
  parentAgent?: string;
  subAgents: (AgentOutput | string)[];
  triggers: string[];
  sourceDir?: string;
};

/**
 * Schema for an agent in LLM output.
 * subAgents can be nested agent objects or string references — handled via z.lazy().
 */
export const AgentOutputSchema: z.ZodType<AgentOutput, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.object({
    name: z.string().min(1),
    description: z.string().default(""),
    skills: z.array(z.string()).default([]),
    tools: z.array(ToolOutputSchema).default([]),
    isSubAgent: z.boolean().default(false),
    parentAgent: z.string().optional(),
    subAgents: z
      .array(z.union([AgentOutputSchema, z.string()]))
      .default([]),
    triggers: z.array(z.string()).default([]),
    sourceDir: z.string().optional(),
  }),
);

/** Schema for the complete LLM analysis response */
export const AnalysisOutputSchema = z.object({
  skills: z.array(SkillOutputSchema).default([]),
  agents: z.array(AgentOutputSchema).default([]),
  summary: z.string().default(""),
  hooks: z.array(HookOutputSchema).optional(),
});

/** Inferred type for a validated analysis response */
export type AnalysisOutput = z.infer<typeof AnalysisOutputSchema>;

/**
 * Validate raw parsed JSON against the AnalysisOutputSchema.
 * Returns the validated + defaulted data, or null if validation fails.
 * Errors are logged with field paths for debugging.
 */
export function validateAnalysisOutput(data: unknown): AnalysisOutput | null {
  const result = AnalysisOutputSchema.safeParse(data);
  if (result.success) {
    return result.data;
  }

  // Log structured Zod errors with paths
  for (const issue of result.error.issues) {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    console.warn(`  [Zod] ${path}: ${issue.message}`);
  }

  return null;
}
