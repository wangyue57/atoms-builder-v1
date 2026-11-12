import { z } from "zod"

export type SandboxId = string
export type SandboxLimits = {
  cpuMillis: number
  memoryBytes: number
  diskBytes: number
  maxLifetimeSeconds: number
  maxProcesses: number
}

export type SandboxCommand = {
  argv: readonly string[]
  cwd?: string
  timeoutSeconds: number
  env?: Readonly<Record<string, string>>
}

export type SandboxCommandResult = {
  exitCode: number | null
  stdout: string
  stderr: string
  durationMs: number
  artifactId?: string
}

export interface SandboxAdapter {
  create(input: { projectId: string; versionId: string; limits: SandboxLimits }): Promise<{ sandboxId: SandboxId }>
  exec(sandboxId: SandboxId, command: SandboxCommand): Promise<SandboxCommandResult>
  destroy(sandboxId: SandboxId): Promise<void>
}

export type Preview = {
  previewId: string
  projectId: string
  versionId: string
  url: string
  expiresAt: Date
}

export type HealthResult = { status: "healthy" | "unhealthy"; checkedAt: Date; details?: string }

export interface PreviewService {
  create(versionId: string): Promise<Preview>
  getHealth(previewId: string): Promise<HealthResult>
  stop(previewId: string): Promise<void>
}

export type UsageReservation = {
  idempotencyKey: string
  runId: string
  maxCostUsd: number
  maxRuntimeSeconds: number
}

export type Reservation = { reservationId: string; reservedCostUsd: number }
export type UsageActual = { costUsd: number; runtimeSeconds: number; browserChecks: number; storageBytes: number }

export interface UsageLedger {
  reserve(input: UsageReservation): Promise<Reservation>
  commit(reservationId: string, actual: UsageActual): Promise<void>
  release(reservationId: string): Promise<void>
}

export const toolGrantSchema = z.enum([
  "builder.read",
  "builder.write",
  "builder.check",
  "reviewer.read",
  "reviewer.check",
  "reviewer.browser",
  "publisher.deploy",
  "integration.github",
])

export const reviewerToolGrantSchema = z.enum(["reviewer.read", "reviewer.check", "reviewer.browser"])
export const reviewerToolGrants = ["reviewer.read", "reviewer.check", "reviewer.browser"] as const

export function assertReviewerToolGrants(grants: readonly string[]): void {
  for (const grant of grants) {
    if (!reviewerToolGrantSchema.safeParse(grant).success) {
      throw new Error(`Reviewer cannot receive tool grant: ${grant}`)
    }
  }
}
