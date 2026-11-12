import assert from "node:assert/strict"
import test from "node:test"
import {
  approveRunInputSchema,
  assertReviewerToolGrants,
  builderResultSchema,
  createRunInputSchema,
  reviewReportSchema,
  runEventSchema,
  sseRunEventSchema,
  dedupeRunEvents,
} from "../src/index.js"

test("validates lifecycle events including approval and cancellation", () => {
  const base = {
    id: "evt_1",
    runId: "run_1",
    stepId: null,
    sequence: 1,
    payload: { reason: "user requested" },
    createdAt: "2026-11-11T00:00:00.000Z",
  }
  assert.equal(runEventSchema.safeParse({ ...base, type: "run.cancelled" }).success, true)
  assert.equal(runEventSchema.safeParse({ ...base, type: "approval.requested" }).success, true)
  assert.equal(runEventSchema.safeParse({ ...base, sequence: 0, type: "run.created" }).success, false)
  assert.equal(
    sseRunEventSchema.safeParse({
      id: "evt_1",
      type: "approval.requested",
      runId: "run_1",
      sequence: 2,
      createdAt: "2026-11-11T00:00:00.000Z",
      data: { targetVersionId: "ver_1" },
    }).success,
    true,
  )
  assert.equal(dedupeRunEvents([
    { ...base, type: "run.created" },
    { ...base, id: "evt_duplicate", type: "run.created" },
  ]).length, 1)
})

test("keeps reviewer grants read-only", () => {
  assert.doesNotThrow(() => assertReviewerToolGrants(["reviewer.read", "reviewer.check", "reviewer.browser"]))
  assert.throws(() => assertReviewerToolGrants(["builder.write"]))
})

test("enforces idempotency and explicit version references", () => {
  const result = createRunInputSchema.safeParse({
    projectId: "proj_1",
    inputVersionId: "ver_0",
    kind: "build",
    userRequest: "Create a landing page",
    budget: {
      maxSteps: 20,
      maxInputTokens: 10_000,
      maxOutputTokens: 10_000,
      maxCostUsd: 2,
      maxRuntimeSeconds: 1_200,
    },
    publish: false,
    idempotencyKey: "idem_12345678",
  })
  assert.equal(result.success, true)
  assert.equal(approveRunInputSchema.safeParse({ runId: "run_1", targetVersionId: "ver_1", idempotencyKey: "short" }).success, false)
})

test("validates structured builder and reviewer output", () => {
  assert.equal(
    builderResultSchema.safeParse({
      status: "completed",
      versionId: "ver_1",
      changedFiles: ["app/page.tsx"],
      checksRequested: [{ name: "build", timeoutSeconds: 60 }],
      assumptions: [],
      remainingRisks: [],
    }).success,
    true,
  )
  const report = reviewReportSchema.safeParse({
    status: "fail",
    score: 70,
    checks: [{ name: "lint", status: "pass", summary: "ok", evidence: [] }],
    failures: [{
      check: "browser",
      commandOrUrl: "http://preview",
      expected: "button works",
      actual: "button missing",
      evidence: [],
      suggestedFix: "Add the button",
    }],
    evidence: [],
    mustFix: ["button"],
    shouldFix: [],
    risks: [],
  })
  assert.equal(report.success, true)
})
