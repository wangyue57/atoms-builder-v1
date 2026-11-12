import assert from "node:assert/strict"
import test from "node:test"
import {
  reviewReportSchema,
  type AgentDefinition,
  type ToolGrant,
} from "@atoms-builder/contracts"
import {
  EventDeduplicator,
  TestWorkspace,
  asSafePath,
  reviewerToolGrants,
} from "./test-adapters.js"

test("event cursor deduplicates by run id and sequence", () => {
  const cursor = new EventDeduplicator()
  assert.equal(cursor.accept({ runId: "run_1", sequence: 1 }), true)
  assert.equal(cursor.accept({ runId: "run_1", sequence: 1 }), false)
  assert.equal(cursor.accept({ runId: "run_1", sequence: 2 }), true)
  assert.equal(cursor.accept({ runId: "run_2", sequence: 1 }), true)
})

test("workspace adapter applies patches atomically and binds previews to versions", async () => {
  const workspace = new TestWorkspace("project_1")
  const original = { projectId: "project_1", versionId: "version_0" }
  await assert.rejects(
    workspace.applyPatch(original, {
      baseVersionId: "version_0",
      operations: [
        { path: asSafePath("app/page.tsx"), content: "updated" },
        { path: "../escape" as never, content: "must fail" },
      ],
    }),
  )
  assert.equal((await workspace.readFile(original, asSafePath("app/page.tsx"))).content, "export default function Page() { return null }")

  const candidate = await workspace.applyPatch(original, {
    baseVersionId: "version_0",
    operations: [{ path: asSafePath("app/page.tsx"), content: "updated" }],
  })
  const preview = await workspace.startPreview(candidate)
  assert.equal(preview.versionId, candidate.versionId)
  assert.match(preview.url, new RegExp(candidate.versionId))
})

test("reviewer grants do not include write or deploy capabilities", () => {
  const grants: readonly ToolGrant[] = reviewerToolGrants
  assert.equal(grants.includes("reviewer.read"), true)
  assert.equal(grants.includes("reviewer.check"), true)
  assert.equal(grants.includes("reviewer.browser"), true)
  assert.equal(grants.includes("builder.write"), false)
  assert.equal(grants.includes("publisher.deploy"), false)

  const reviewer: AgentDefinition<unknown, unknown> = {
    name: "reviewer",
    systemPrompt: "review",
    inputSchema: reviewReportSchema,
    outputSchema: reviewReportSchema,
    tools: grants,
    maxSteps: 10,
    maxCost: 1,
  }
  assert.equal(reviewer.tools.includes("builder.write"), false)
})
