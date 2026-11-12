import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import type {
  BrowserAction,
  CheckResult,
  FileContent,
  ModelGateway,
  ModelRequest,
  ModelResponse,
  PatchSet,
  PreviewHandle,
  SafePath,
  VersionRef,
  Workspace,
  WorkspaceSnapshot,
} from "@atoms-builder/contracts"
import { RealBuilderAgent, RealReviewerAgent } from "../src/index.js"

const budget = { maxSteps: 10, maxInputTokens: 100, maxOutputTokens: 500, maxCostUsd: 1, maxRuntimeSeconds: 60 }

class TestWorkspace implements Workspace {
  writes = 0
  checks = 0
  browserActions: BrowserAction[] = []
  async getSnapshot(ref: VersionRef): Promise<WorkspaceSnapshot> {
    return { ref, manifest: { files: [], hash: "hash", totalBytes: 0 } }
  }
  async readFile(_ref: VersionRef, path: SafePath): Promise<FileContent> {
    return { path, content: "", hash: "hash" }
  }
  async applyPatch(ref: VersionRef, _patch: PatchSet): Promise<VersionRef> {
    this.writes += 1
    return { projectId: ref.projectId, versionId: "candidate_1" }
  }
  async runCheck(_ref: VersionRef, _check: Parameters<Workspace["runCheck"]>[1]): Promise<CheckResult> {
    this.checks += 1
    return { status: "passed", exitCode: 0, outputArtifactId: "artifact_check" }
  }
  async startPreview(ref: VersionRef): Promise<PreviewHandle> {
    return { previewId: "preview_1", versionId: ref.versionId, url: "https://preview.invalid", expiresAt: new Date(Date.now() + 60_000) }
  }
  async inspectPreview(_preview: PreviewHandle, action: BrowserAction) {
    this.browserActions.push(action)
    return { status: "passed" as const, details: "browser passed" }
  }
  async captureScreenshot(_preview: PreviewHandle) { return { artifactId: "artifact_screenshot" } }
  async export(_ref: VersionRef) { return { artifactId: "artifact_export" } }
}

class ScriptedModel implements ModelGateway {
  constructor(private readonly outputs: readonly unknown[]) {}
  private cursor = 0
  readonly prompts: string[] = []
  async generate<T>(request: ModelRequest<T>): Promise<ModelResponse<T>> {
    this.prompts.push(request.prompt)
    const output = request.schema.parse(this.outputs[this.cursor++])
    return {
      output,
      provider: "test-provider",
      model: request.model,
      promptVersion: request.promptVersion,
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0,
      latencyMs: 0,
    }
  }
  async *stream() { yield { delta: "", done: true } }
  async estimateCost() { return { currency: "USD" as const, amount: 0 } }
}

test("local source review marks simulated execution checks as skipped", async () => {
  const workspace = new TestWorkspace()
  const reviewer = new RealReviewerAgent({
    workspace,
    checksAreSimulated: true,
    model: new ScriptedModel([{ action: "finish", message: "source reviewed", checks: [], browserActions: [], report: { ...reviewReport, checks: [{ name: "build", status: "pass", summary: "simulated", evidence: [] }] } }]),
  })
  const report = await reviewer.review({ projectId: "project_1", versionId: "candidate_1", userRequest: "Build a page" })
  assert.equal(report.checks[0].status, "skipped")
  assert.match(report.risks.join(" "), /does not satisfy production Gate 2/)
  assert.equal(workspace.writes, 0)
})

const builderPlan = {
  action: "patch" as const,
  status: "continue" as const,
  message: "apply the first implementation",
  checksRequested: [{ name: "build" as const, timeoutSeconds: 60 }],
  assumptions: [],
  remainingRisks: [],
  patches: [{ path: "app/page.tsx", content: "export default function Page() { return <main>ok</main> }" }],
}

const builderFinish = {
  action: "finish" as const,
  status: "completed" as const,
  message: "implementation and checks are complete",
  checksRequested: [],
  assumptions: [],
  remainingRisks: [],
  patches: [],
}

const reviewReport = {
  status: "pass" as const,
  score: 100,
  checks: [],
  failures: [],
  evidence: [],
  mustFix: [],
  shouldFix: [],
  risks: [],
}

test("real Builder applies model patches and Reviewer remains read-only", async () => {
  const builderWorkspace = new TestWorkspace()
  const builderModel = new ScriptedModel([builderPlan, builderFinish])
  const builder = new RealBuilderAgent({ workspace: builderWorkspace, model: builderModel })
  const result = await builder.build({ projectId: "project_1", inputVersionId: "version_0", userRequest: "Build a page", projectSpec: {}, budget })
  assert.equal(result.versionId, "candidate_1")
  assert.equal(builderWorkspace.writes, 1)
  assert.equal(builderModel.prompts.length, 2)
  assert.match(builderModel.prompts[1]!, /Applied 1 patch\(es\)/)

  const reviewerWorkspace = new TestWorkspace()
  const reviewer = new RealReviewerAgent({ workspace: reviewerWorkspace, model: new ScriptedModel([{ action: "finish", message: "review complete", checks: [], browserActions: [], report: reviewReport }]) })
  const report = await reviewer.review({ projectId: "project_1", versionId: "candidate_1", userRequest: "Build a page" })
  assert.equal(report.status, "pass")
  assert.equal(reviewerWorkspace.writes, 0)
  assert.deepEqual(reviewer.tools, ["reviewer.read", "reviewer.check", "reviewer.browser"])
  assert.equal(reviewerWorkspace.checks, 6)
})

test("Reviewer loop receives the user request and feeds browser observations back", async () => {
  const workspace = new TestWorkspace()
  const reviewerModel = new ScriptedModel([
    { action: "browser", message: "check the primary action", checks: [], browserActions: [{ type: "assert", selector: "button" }] },
    { action: "finish", message: "review complete", checks: [], browserActions: [], report: reviewReport },
  ])
  const reviewer = new RealReviewerAgent({ workspace, checksAreSimulated: true, model: reviewerModel })
  const report = await reviewer.review({ projectId: "project_1", versionId: "candidate_1", userRequest: "Create a page with a primary action" })
  assert.equal(report.status, "pass")
  assert.deepEqual(workspace.browserActions.map((action) => action.type), ["open", "assert"])
  assert.equal(reviewerModel.prompts.length, 2)
  assert.match(reviewerModel.prompts[0]!, /Create a page with a primary action/)
  assert.match(reviewerModel.prompts[1]!, /browser:assert/)
})

test("structured output and versioned prompt boundaries are enforced", async () => {
  const workspace = new TestWorkspace()
  const builder = new RealBuilderAgent({ workspace, model: new ScriptedModel([{ invalid: true }]) })
  await assert.rejects(
    builder.build({ projectId: "project_1", inputVersionId: "version_0", userRequest: "Build", projectSpec: {}, budget }),
  )
  const prompt = readFileSync(new URL("../../../prompts/builder.md", import.meta.url), "utf8")
  assert.match(prompt, /Builder/)
  const goldenTasks = JSON.parse(readFileSync(new URL("../../../evals/fixtures/golden-tasks.json", import.meta.url), "utf8")) as unknown[]
  assert.equal(goldenTasks.length, 30)
})
