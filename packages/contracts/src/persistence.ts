import type {
  Approval,
  Membership,
  Project,
  ProjectVersion,
  Run,
  RunEvent,
  RunStep,
} from "@atoms-builder/domain"

export interface ProjectRepository {
  getForMember(projectId: string, member: Membership): Promise<Project>
  create(input: { organizationId: string; name: string; kind: "web"; visibility: "private" | "public" }): Promise<Project>
  setCurrentVersion(projectId: string, versionId: string): Promise<void>
  listVersions(projectId: string): Promise<ProjectVersion[]>
}

export interface RunRepository {
  create(input: Run & { idempotencyKey: string }): Promise<Run>
  getForMember(runId: string, member: Membership): Promise<Run>
  transition(runId: string, status: Run["status"]): Promise<Run>
}

export interface VersionRepository {
  get(versionId: string): Promise<ProjectVersion>
  create(version: ProjectVersion): Promise<ProjectVersion>
  markCurrent(projectId: string, versionId: string): Promise<void>
}

export interface EventStore {
  append(event: RunEvent): Promise<RunEvent>
  list(runId: string, afterSequence?: number): Promise<RunEvent[]>
}

export interface ApprovalRepository {
  create(approval: Approval): Promise<Approval>
  resolve(approvalId: string, status: "approved" | "rejected", resolvedByUserId: string): Promise<Approval>
}
