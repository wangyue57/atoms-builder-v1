import assert from "node:assert/strict"
import test from "node:test"
import { accountInputSchema, applicationCreateTaskSchema, applicationTaskSchema } from "@atoms-builder/contracts"

test("account v1 normalizes account identity without normalizing the password", () => {
  const input = accountInputSchema.parse({ username: " Alice_01 ", password: "  password  " })
  assert.equal(input.username, "alice_01")
  assert.equal(input.password, "  password  ")
  assert.equal(accountInputSchema.safeParse({ username: "alice", password: "short" }).success, false)
  assert.equal(accountInputSchema.safeParse({ username: "alice@example.com", password: "password123" }).success, false)
})

test("task writes require an idempotency key and reject client-supplied source context", () => {
  assert.equal(applicationCreateTaskSchema.safeParse({ request: "Build" }).success, false)
  assert.equal(applicationCreateTaskSchema.safeParse({ request: "Build", idempotencyKey: "request_123", previousHtml: "untrusted" }).success, false)
  assert.equal(applicationCreateTaskSchema.parse({ request: " Build ", idempotencyKey: "request_123" }).request, "Build")
})

test("queued tasks are recoverable without a result and still have durable identity", () => {
  const now = new Date().toISOString()
  const task = applicationTaskSchema.parse({ id: "project_1", title: "Build", phase: "queued", lastRequest: "Build", error: null, currentVersionId: null, createdAt: now, updatedAt: now, result: null, previewHtml: "", runs: [] })
  assert.equal(task.phase, "queued")
  assert.equal(task.result, null)
  assert.equal(applicationTaskSchema.safeParse({ ...task, id: undefined }).success, false)
})
