import assert from "node:assert/strict"
import test from "node:test"
import { PAGE_KINDS, loadGoldenTasks, validateGoldenTasks } from "../src/index.js"

test("loads at least thirty diverse golden tasks", () => {
  const tasks = loadGoldenTasks()
  assert.ok(tasks.length >= 30)
  assert.equal(new Set(tasks.map((task) => task.id)).size, tasks.length)
  for (const kind of PAGE_KINDS) {
    assert.ok(tasks.some((task) => task.expectedPageKind === kind), `missing page kind ${kind}`)
  }
  for (const task of tasks) {
    assert.ok(task.acceptanceChecks.some((check) => check.startsWith("browser:")))
    assert.ok(task.acceptanceChecks.some((check) => check.startsWith("responsive:")))
    assert.ok(task.acceptanceChecks.some((check) => check.startsWith("security:")))
  }
})

test("rejects duplicate IDs and incomplete acceptance criteria", () => {
  assert.throws(() => validateGoldenTasks([
    {
      id: "duplicate",
      userRequest: "A sufficiently detailed request for a fixed task",
      expectedPageKind: "marketing",
      acceptanceChecks: ["browser: works", "responsive: works", "security: works", "build: works"],
    },
    {
      id: "duplicate",
      userRequest: "Another sufficiently detailed request for a fixed task",
      expectedPageKind: "marketing",
      acceptanceChecks: ["browser: works", "responsive: works", "security: works", "build: works"],
    },
  ]), /Duplicate golden task id/)
  assert.throws(() => validateGoldenTasks([{
    id: "missing-security",
    userRequest: "A sufficiently detailed request for a fixed task",
    expectedPageKind: "portfolio",
    acceptanceChecks: ["browser: works", "responsive: works", "build: works", "quality: works"],
  }]), /security check/)
})
