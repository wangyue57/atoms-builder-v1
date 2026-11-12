import { z } from "zod"

export const idSchema = z.string().min(1)
export const isoDateSchema = z.coerce.date()
export const idempotencyKeySchema = z.string().min(8).max(255)

export const projectKindSchema = z.literal("web")
export const projectVisibilitySchema = z.enum(["private", "public"])
export const runKindSchema = z.enum(["build", "modify", "review", "publish", "restore"])

export const usageBudgetSchema = z.object({
  maxSteps: z.number().int().positive(),
  maxInputTokens: z.number().int().nonnegative(),
  maxOutputTokens: z.number().int().nonnegative(),
  maxCostUsd: z.number().nonnegative(),
  maxRuntimeSeconds: z.number().int().positive(),
})

export const fileManifestEntrySchema = z.object({
  path: z.string().min(1),
  hash: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  objectRef: z.string().min(1),
})

export const fileManifestSchema = z.object({
  files: z.array(fileManifestEntrySchema),
  hash: z.string().min(1),
  totalBytes: z.number().int().nonnegative(),
})
