import { z } from "zod"
import { fileManifestSchema, idSchema, isoDateSchema, usageBudgetSchema } from "./common.js"

export const checkSpecSchema = z.object({
  name: z.enum(["install", "lint", "typecheck", "test", "build", "preview_health", "browser"]),
  command: z.string().min(1).optional(),
  timeoutSeconds: z.number().int().positive().max(3_600),
})

export const builderInputSchema = z.object({
  projectId: idSchema,
  inputVersionId: idSchema,
  userRequest: z.string().min(1),
  projectSpec: z.record(z.unknown()),
  reviewReport: z.unknown().optional(),
  budget: usageBudgetSchema,
})

export const builderResultSchema = z.object({
  status: z.enum(["completed", "blocked", "failed"]),
  versionId: idSchema,
  changedFiles: z.array(z.string().min(1)),
  checksRequested: z.array(checkSpecSchema),
  assumptions: z.array(z.string()),
  remainingRisks: z.array(z.string()),
})

export const evidenceRefSchema = z.object({
  artifactId: idSchema,
  kind: z.enum(["command_output", "screenshot", "test_report", "build", "deployment", "export"]),
  label: z.string().min(1),
  uri: z.string().min(1),
})

export const reviewCheckSchema = z.object({
  name: z.string().min(1),
  status: z.enum(["pass", "fail", "blocked", "skipped"]),
  summary: z.string(),
  evidence: z.array(evidenceRefSchema),
})

export const reviewFailureSchema = z.object({
  check: z.string().min(1),
  commandOrUrl: z.string().min(1),
  expected: z.string().min(1),
  actual: z.string().min(1),
  evidence: z.array(evidenceRefSchema),
  suggestedFix: z.string().min(1),
})

export const reviewReportSchema = z.object({
  status: z.enum(["pass", "fail", "blocked"]),
  score: z.number().min(0).max(100),
  checks: z.array(reviewCheckSchema),
  failures: z.array(reviewFailureSchema),
  evidence: z.array(evidenceRefSchema),
  mustFix: z.array(z.string()),
  shouldFix: z.array(z.string()),
  risks: z.array(z.string()),
})

export type BuilderInput = z.infer<typeof builderInputSchema>
export type BuilderResult = z.infer<typeof builderResultSchema>
export type ReviewReport = z.infer<typeof reviewReportSchema>

export type ToolGrant =
  | "builder.read"
  | "builder.write"
  | "builder.check"
  | "reviewer.read"
  | "reviewer.check"
  | "reviewer.browser"
  | "publisher.deploy"
  | "integration.github"

export type AgentDefinition<I, O> = {
  name: string
  systemPrompt: string
  inputSchema: z.ZodType<I>
  outputSchema: z.ZodType<O>
  tools: readonly ToolGrant[]
  maxSteps: number
  maxCost: number
}

export interface AgentRuntime {
  run<I, O>(definition: AgentDefinition<I, O>, input: I): Promise<O>
}

export interface ModelRequest<T> {
  schema: z.ZodType<T>
  prompt: string
  model: string
  promptVersion: string
  /** Optional provider cap. Omit to use the provider default. */
  maxOutputTokens?: number
  /** Stable instruction layer sent as a system message when supported. */
  systemPrompt?: string
}

export type ModelResponse<T> = {
  output: T
  provider: string
  model: string
  promptVersion: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  latencyMs: number
}

export interface ModelGateway {
  generate<T>(request: ModelRequest<T>): Promise<ModelResponse<T>>
  stream<T>(request: ModelRequest<T>): AsyncIterable<{ delta: string; done: boolean }>
  estimateCost(request: ModelRequest<unknown>): Promise<{ currency: "USD"; amount: number }>
}

export type SafePath = string & { readonly __brand: "SafePath" }
export type VersionRef = { projectId: string; versionId: string }
export type FileContent = { path: SafePath; content: string; hash: string }
export type PatchSet = { baseVersionId: string; operations: readonly { path: SafePath; content: string }[] }
export type WorkspaceSnapshot = { ref: VersionRef; manifest: z.infer<typeof fileManifestSchema> }
export type CheckResult = { status: "passed" | "failed" | "blocked"; exitCode: number | null; outputArtifactId: string }
export type PreviewHandle = { previewId: string; versionId: string; url: string; expiresAt: Date }
export type BrowserAction = { type: "open" | "click" | "fill" | "assert"; selector?: string; value?: string }
export type BrowserResult = { status: "passed" | "failed"; details: string; artifactId?: string }

export interface Workspace {
  getSnapshot(ref: VersionRef): Promise<WorkspaceSnapshot>
  readFile(ref: VersionRef, path: SafePath): Promise<FileContent>
  applyPatch(ref: VersionRef, patch: PatchSet): Promise<VersionRef>
  runCheck(ref: VersionRef, check: z.infer<typeof checkSpecSchema>): Promise<CheckResult>
  startPreview(ref: VersionRef): Promise<PreviewHandle>
  inspectPreview(preview: PreviewHandle, action: BrowserAction): Promise<BrowserResult>
  captureScreenshot(preview: PreviewHandle): Promise<{ artifactId: string }>
  export(ref: VersionRef): Promise<{ artifactId: string }>
}
