import { z } from "zod"
import type { EventType, RunEvent } from "@atoms-builder/domain"
import { idSchema, isoDateSchema } from "./common.js"

export const eventTypeSchema = z.enum([
  "run.created",
  "run.started",
  "step.started",
  "agent.message.delta",
  "agent.tool.started",
  "agent.tool.completed",
  "workspace.version.created",
  "preview.created",
  "review.check.started",
  "review.check.completed",
  "approval.requested",
  "approval.granted",
  "approval.rejected",
  "deployment.started",
  "deployment.completed",
  "run.paused",
  "run.completed",
  "run.cancelled",
  "run.failed",
] satisfies readonly [EventType, ...EventType[]])

export const runEventSchema = z.object({
  id: idSchema,
  runId: idSchema,
  stepId: idSchema.nullable(),
  sequence: z.number().int().positive(),
  type: eventTypeSchema,
  payload: z.unknown(),
  createdAt: isoDateSchema,
})

export type RunEventInput = z.input<typeof runEventSchema>
export type RunEventOutput = z.output<typeof runEventSchema>

export function parseRunEvent(input: unknown): RunEvent {
  return runEventSchema.parse(input) as RunEvent
}

export const sseRunEventSchema = z.object({
  id: idSchema,
  type: eventTypeSchema,
  runId: idSchema,
  sequence: z.number().int().positive(),
  createdAt: isoDateSchema,
  data: z.record(z.unknown()),
})

export type SseRunEvent = z.infer<typeof sseRunEventSchema>

/** Keeps the first event for each durable run cursor. */
export function dedupeRunEvents(events: readonly RunEventInput[]): RunEventInput[] {
  const seen = new Set<string>()
  const result: RunEventInput[] = []
  for (const event of events) {
    const key = `${event.runId}:${event.sequence}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(event)
  }
  return result
}
