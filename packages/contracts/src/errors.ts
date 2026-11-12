import { z } from "zod"

export const errorCodeSchema = z.enum([
  "INVALID_INPUT",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "INVALID_STATE_TRANSITION",
  "VERSION_CONFLICT",
  "PATH_FORBIDDEN",
  "CHECK_FAILED",
  "SANDBOX_LIMIT",
  "MODEL_ERROR",
  "DEPLOYMENT_ERROR",
  "INTERNAL_ERROR",
])

export const errorSchema = z.object({
  code: errorCodeSchema,
  message: z.string().min(1),
  retryable: z.boolean(),
  evidence: z.array(z.string()).optional(),
  traceId: z.string().min(1).optional(),
})

export type ErrorCode = z.infer<typeof errorCodeSchema>
export type ContractError = z.infer<typeof errorSchema>
