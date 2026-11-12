import { z } from "zod"
import { reviewReportSchema } from "./agents.js"

/** Application HTTP v1. Additive to the frozen execution/control contracts. */
export const accountInputSchema = z.object({
  username: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_]+$/).transform(value => value.toLowerCase()),
  password: z.string().min(8).max(128),
}).strict()

export const applicationUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  createdAt: z.string().datetime(),
})
export const applicationRunResultSchema = z.object({
  runId: z.string(),
  mode: z.literal("deepseek"),
  status: z.enum(["completed", "awaiting_fix_decision", "failed", "blocked"]),
  versionId: z.string(),
  repairAttempts: z.number().int().nonnegative(),
  review: reviewReportSchema.pick({ status: true, score: true, mustFix: true, risks: true }).passthrough(),
  previewHtml: z.string().optional(),
}).passthrough()
export const applicationRunSummarySchema = z.object({
  id: z.string(),
  request: z.string(),
  status: z.enum(["queued", "running", "completed", "failed"]),
  error: z.string().nullable(),
  versionId: z.string().nullable(),
  createdAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
})
export const applicationTaskSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  phase: z.enum(["queued", "running", "succeeded", "failed"]),
  lastRequest: z.string(),
  error: z.string().nullable(),
  currentVersionId: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export const applicationTaskSchema = applicationTaskSummarySchema.extend({
  result: applicationRunResultSchema.nullable(),
  previewHtml: z.string(),
  runs: z.array(applicationRunSummarySchema),
})
export const applicationTaskListSchema = z.object({
  tasks: z.array(applicationTaskSummarySchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
})
export const applicationCreateTaskSchema = z.object({
  request: z.string().trim().min(1).max(10_000),
  idempotencyKey: z.string().min(8).max(128),
}).strict()
export type ApplicationUser = z.infer<typeof applicationUserSchema>
export type ApplicationRunResult = z.infer<typeof applicationRunResultSchema>
export type ApplicationTask = z.infer<typeof applicationTaskSchema>
export type ApplicationTaskSummary = z.infer<typeof applicationTaskSummarySchema>
export type ApplicationTaskList = z.infer<typeof applicationTaskListSchema>
export type ApplicationCreateTask = z.infer<typeof applicationCreateTaskSchema>
