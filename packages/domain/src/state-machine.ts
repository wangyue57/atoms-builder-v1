import type { RunStatus, StepStatus } from "./types.js"

export class InvalidStateTransitionError extends Error {
  readonly entity: "run" | "step"
  readonly from: RunStatus | StepStatus
  readonly to: RunStatus | StepStatus

  constructor(
    entity: "run" | "step",
    from: RunStatus | StepStatus,
    to: RunStatus | StepStatus,
  ) {
    super(`Invalid ${entity} state transition: ${from} -> ${to}`)
    this.name = "InvalidStateTransitionError"
    this.entity = entity
    this.from = from
    this.to = to
  }
}

const runTransitions: Record<RunStatus, readonly RunStatus[]> = {
  queued: ["planning", "cancelling", "failed"],
  planning: ["awaiting_approval", "building", "cancelling", "failed", "retrying"],
  awaiting_approval: ["building", "cancelling", "failed", "retrying"],
  building: ["reviewing", "cancelling", "failed", "retrying"],
  reviewing: [
    "awaiting_fix_decision",
    "publishing",
    "cancelling",
    "failed",
    "retrying",
  ],
  awaiting_fix_decision: ["building", "publishing", "cancelling", "failed", "retrying"],
  publishing: ["completed", "cancelling", "failed", "retrying"],
  completed: [],
  cancelling: ["cancelled", "failed"],
  cancelled: [],
  failed: [],
  retrying: [
    "queued",
    "planning",
    "awaiting_approval",
    "building",
    "reviewing",
    "awaiting_fix_decision",
    "publishing",
    "cancelling",
    "failed",
  ],
}

const stepTransitions: Record<StepStatus, readonly StepStatus[]> = {
  pending: ["running", "cancelled", "failed"],
  running: ["succeeded", "failed", "retrying", "cancelled"],
  succeeded: [],
  failed: ["retrying"],
  retrying: ["running", "failed", "cancelled"],
  cancelled: [],
}

export const RUN_TERMINAL_STATUSES: readonly RunStatus[] = ["completed", "cancelled", "failed"]
export const STEP_TERMINAL_STATUSES: readonly StepStatus[] = ["succeeded", "failed", "cancelled"]

export function isValidRunTransition(from: RunStatus, to: RunStatus): boolean {
  return runTransitions[from].includes(to)
}

export function transitionRunStatus(from: RunStatus, to: RunStatus): RunStatus {
  if (!isValidRunTransition(from, to)) {
    throw new InvalidStateTransitionError("run", from, to)
  }
  return to
}

export function isValidStepTransition(from: StepStatus, to: StepStatus): boolean {
  return stepTransitions[from].includes(to)
}

export function transitionStepStatus(from: StepStatus, to: StepStatus): StepStatus {
  if (!isValidStepTransition(from, to)) {
    throw new InvalidStateTransitionError("step", from, to)
  }
  return to
}

/** Mark a recoverable run for retry. The caller must retain its previous state. */
export function retryRun(from: RunStatus): "retrying" {
  if (from === "completed" || from === "cancelled" || from === "failed" || from === "cancelling") {
    throw new InvalidStateTransitionError("run", from, "retrying")
  }
  transitionRunStatus(from, "retrying")
  return "retrying"
}

/** Resume a run from retrying into the state retained by the workflow. */
export function resumeRun(from: "retrying", to: Exclude<RunStatus, "retrying">): RunStatus {
  return transitionRunStatus(from, to)
}

export function retryStep(from: StepStatus): "retrying" {
  transitionStepStatus(from, "retrying")
  return "retrying"
}
