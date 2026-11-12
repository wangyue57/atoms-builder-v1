import assert from "node:assert/strict"
import test from "node:test"
import { LocalWorkspaceAdapter, UnsafePathError, VersionConflictError, toSafePath } from "../src/index.js"

function createWorkspace(): LocalWorkspaceAdapter {
  return new LocalWorkspaceAdapter({
    projectId: "project_1",
    initialFiles: { "app/page.tsx": "export default function Page() { return null }" },
  })
}

test("rejects traversal, absolute and protected paths", () => {
  assert.throws(() => toSafePath("../escape"), UnsafePathError)
  assert.throws(() => toSafePath("/absolute"), UnsafePathError)
  assert.throws(() => toSafePath("C:\\absolute"), UnsafePathError)
  assert.throws(() => toSafePath("app//page.tsx"), UnsafePathError)
})

test("failed patches do not leave a candidate snapshot", async () => {
  const workspace = createWorkspace()
  const ref = { projectId: "project_1", versionId: "version_0" }
  await assert.rejects(
    workspace.applyPatch(ref, {
      baseVersionId: "version_0",
      operations: [
        { path: toSafePath("app/page.tsx"), content: "changed" },
        { path: "../escape" as never, content: "must fail" },
      ],
    }),
    UnsafePathError,
  )
  assert.equal((await workspace.readFile(ref, toSafePath("app/page.tsx"))).content, "export default function Page() { return null }")
})

test("creates immutable snapshots and binds preview to an explicit version", async () => {
  const workspace = createWorkspace()
  const parent = { projectId: "project_1", versionId: "version_0" }
  const candidate = await workspace.applyPatch(parent, {
    baseVersionId: "version_0",
    operations: [{ path: toSafePath("app/page.tsx"), content: "updated" }],
  })
  assert.notEqual(candidate.versionId, parent.versionId)
  assert.equal((await workspace.readFile(parent, toSafePath("app/page.tsx"))).content, "export default function Page() { return null }")
  assert.equal((await workspace.readFile(candidate, toSafePath("app/page.tsx"))).content, "updated")

  const preview = await workspace.startPreview(candidate)
  assert.equal(preview.versionId, candidate.versionId)
  assert.match(preview.url, new RegExp(candidate.versionId))
  await assert.doesNotReject(workspace.inspectPreview(preview, { type: "open" }))
  await assert.doesNotReject(workspace.captureScreenshot(preview))
  await assert.doesNotReject(workspace.export(candidate))
})

test("rejects stale patch bases", async () => {
  const workspace = createWorkspace()
  await assert.rejects(
    workspace.applyPatch({ projectId: "project_1", versionId: "version_0" }, {
      baseVersionId: "version_missing",
      operations: [],
    }),
    VersionConflictError,
  )
})
