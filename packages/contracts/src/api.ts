import { z } from "zod"
import {
  fileManifestSchema,
  idempotencyKeySchema,
  idSchema,
  isoDateSchema,
  projectKindSchema,
  projectVisibilitySchema,
  runKindSchema,
  usageBudgetSchema,
} from "./common.js"

export const createProjectInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: projectKindSchema.default("web"),
  visibility: projectVisibilitySchema.default("private"),
})

export const createRunInputSchema = z.object({
  projectId: idSchema,
  inputVersionId: idSchema,
  kind: runKindSchema,
  userRequest: z.string().trim().min(1).max(100_000),
  budget: usageBudgetSchema,
  publish: z.boolean().default(false),
  idempotencyKey: idempotencyKeySchema,
})

export const approveRunInputSchema = z.object({
  runId: idSchema,
  targetVersionId: idSchema,
  idempotencyKey: idempotencyKeySchema,
  note: z.string().max(2_000).optional(),
})

export const rejectRunInputSchema = z.object({
  runId: idSchema,
  idempotencyKey: idempotencyKeySchema,
  reason: z.string().trim().min(1).max(2_000),
})

export const projectVersionResponseSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  parentVersionId: idSchema.nullable(),
  source: z.enum(["builder", "manual_edit", "restore", "import"]),
  manifest: fileManifestSchema,
  status: z.enum(["candidate", "current", "superseded", "failed"]),
  createdByRunId: idSchema.nullable(),
  createdAt: isoDateSchema,
})

export const createProjectResponseSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  name: z.string().min(1),
  kind: projectKindSchema,
  currentVersionId: idSchema.nullable(),
  visibility: projectVisibilitySchema,
  status: z.enum(["active", "archived", "deleted"]),
})

export const createRunResponseSchema = z.object({
  runId: idSchema,
  projectId: idSchema,
  status: z.enum([
    "queued",
    "planning",
    "awaiting_approval",
    "building",
    "reviewing",
    "awaiting_fix_decision",
    "publishing",
    "completed",
    "cancelling",
    "cancelled",
    "failed",
    "retrying",
  ]),
  createdAt: isoDateSchema,
})

export const runEventQuerySchema = z.object({
  runId: idSchema,
  lastEventId: idSchema.optional(),
  afterSequence: z.number().int().nonnegative().optional(),
})

export const deploymentRequestSchema = z.object({
  projectId: idSchema,
  versionId: idSchema,
  idempotencyKey: idempotencyKeySchema,
  approvalId: idSchema,
})

export type CreateProjectInput = z.infer<typeof createProjectInputSchema>
export type CreateRunInput = z.infer<typeof createRunInputSchema>
export type ApproveRunInput = z.infer<typeof approveRunInputSchema>
export type RejectRunInput = z.infer<typeof rejectRunInputSchema>
export type DeploymentRequest = z.infer<typeof deploymentRequestSchema>
