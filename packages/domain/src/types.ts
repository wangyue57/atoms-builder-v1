/** Stable domain vocabulary shared by the control and execution planes. */

export type Id = string

export type User = {
  id: Id
  email: string
  createdAt: Date
}

export type OrganizationPlan = "free" | "pro"

export type Organization = {
  id: Id
  name: string
  plan: OrganizationPlan
  createdAt: Date
}

export type MembershipRole = "owner" | "editor" | "viewer" | "billing"

export type Membership = {
  organizationId: Id
  userId: Id
  role: MembershipRole
}

export type ProjectKind = "web"
export type ProjectVisibility = "private" | "public"
export type ProjectStatus = "active" | "archived" | "deleted"

export type Project = {
  id: Id
  organizationId: Id
  name: string
  kind: ProjectKind
  currentVersionId: Id | null
  visibility: ProjectVisibility
  status: ProjectStatus
}

export type FileManifestEntry = {
  path: string
  hash: string
  sizeBytes: number
  /** Object-store reference for immutable file contents. */
  objectRef: string
}

export type FileManifest = {
  files: readonly FileManifestEntry[]
  hash: string
  totalBytes: number
}

export type ProjectVersionSource =
  | "builder"
  | "manual_edit"
  | "restore"
  | "import"

export type ProjectVersionStatus =
  | "candidate"
  | "current"
  | "superseded"
  | "failed"

export type ProjectVersion = {
  id: Id
  projectId: Id
  parentVersionId: Id | null
  source: ProjectVersionSource
  manifest: FileManifest
  status: ProjectVersionStatus
  createdByRunId: Id | null
  createdAt: Date
}

export type RunKind = "build" | "modify" | "review" | "publish" | "restore"

/**
 * Run statuses are deliberately finite. New states require an explicit
 * contract change so consumers cannot silently guess workflow behavior.
 */
export type RunStatus =
  | "queued"
  | "planning"
  | "awaiting_approval"
  | "building"
  | "reviewing"
  | "awaiting_fix_decision"
  | "publishing"
  | "completed"
  | "cancelling"
  | "cancelled"
  | "failed"
  | "retrying"

export type RunStepKind = "intake" | "build" | "review" | "repair" | "publish"

export type StepStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "retrying"
  | "cancelled"

export type Run = {
  id: Id
  projectId: Id
  inputVersionId: Id
  requestedByUserId: Id
  kind: RunKind
  status: RunStatus
  cancelRequestedAt: Date | null
  budget: UsageBudget
  createdAt: Date
}

export type RunStep = {
  id: Id
  runId: Id
  kind: RunStepKind
  status: StepStatus
  attempt: number
  startedAt: Date | null
  finishedAt: Date | null
}

export type UsageBudget = {
  maxSteps: number
  maxInputTokens: number
  maxOutputTokens: number
  maxCostUsd: number
  maxRuntimeSeconds: number
}

export type EventType =
  | "run.created"
  | "run.started"
  | "step.started"
  | "agent.message.delta"
  | "agent.tool.started"
  | "agent.tool.completed"
  | "workspace.version.created"
  | "preview.created"
  | "review.check.started"
  | "review.check.completed"
  | "approval.requested"
  | "approval.granted"
  | "approval.rejected"
  | "deployment.started"
  | "deployment.completed"
  | "run.paused"
  | "run.completed"
  | "run.cancelled"
  | "run.failed"

export type RunEvent = {
  id: Id
  runId: Id
  stepId: Id | null
  sequence: number
  type: EventType
  payload: unknown
  createdAt: Date
}

export type ArtifactKind =
  | "command_output"
  | "screenshot"
  | "test_report"
  | "build"
  | "deployment"
  | "export"

export type Artifact = {
  id: Id
  runId: Id
  versionId: Id | null
  kind: ArtifactKind
  objectRef: string
  hash: string
  sizeBytes: number
  createdAt: Date
}

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired"

export type Approval = {
  id: Id
  runId: Id
  targetVersionId: Id | null
  status: ApprovalStatus
  reason: string
  riskSummary: readonly string[]
  requestedAt: Date
  resolvedAt: Date | null
  resolvedByUserId: Id | null
}
