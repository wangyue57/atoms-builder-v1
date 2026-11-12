import assert from "node:assert/strict"
import test from "node:test"
import {
  InvalidStateTransitionError,
  isValidRunTransition,
  isValidStepTransition,
  retryRun,
  resumeRun,
  transitionRunStatus,
  transitionStepStatus,
} from "../src/index.js"

test("allows the normal run lifecycle", () => {
  let status = transitionRunStatus("queued", "planning")
  status = transitionRunStatus(status, "building")
  status = transitionRunStatus(status, "reviewing")
  status = transitionRunStatus(status, "publishing")
  status = transitionRunStatus(status, "completed")

  assert.equal(status, "completed")
  assert.equal(isValidRunTransition("reviewing", "publishing"), true)
})

test("rejects illegal run transitions and terminal mutation", () => {
  assert.equal(isValidRunTransition("planning", "completed"), false)
  assert.throws(
    () => transitionRunStatus("planning", "completed"),
    (error: unknown) =>
      error instanceof InvalidStateTransitionError &&
      error.entity === "run" &&
      error.from === "planning" &&
      error.to === "completed",
  )
  assert.throws(() => transitionRunStatus("completed", "planning"), InvalidStateTransitionError)
})

test("requires an explicit retry resume state", () => {
  assert.equal(retryRun("building"), "retrying")
  assert.equal(resumeRun("retrying", "building"), "building")
  assert.throws(() => retryRun("completed"), InvalidStateTransitionError)
  assert.throws(() => resumeRun("retrying", "completed"), InvalidStateTransitionError)
})

test("enforces step lifecycle and retry rules", () => {
  assert.equal(isValidStepTransition("pending", "running"), true)
  assert.equal(transitionStepStatus("pending", "running"), "running")
  assert.equal(transitionStepStatus("running", "succeeded"), "succeeded")
  assert.equal(isValidStepTransition("succeeded", "running"), false)
  assert.throws(() => transitionStepStatus("succeeded", "running"), InvalidStateTransitionError)
  assert.equal(transitionStepStatus("failed", "retrying"), "retrying")
})
