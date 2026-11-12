export type BuildArtifact = {
  artifactId: string
  versionId: string
  hash: string
}

export type DeployInput = {
  projectId: string
  versionId: string
  artifactId: string
  idempotencyKey: string
}

export type DeploymentResult = {
  deploymentId: string
  versionId: string
  status: "deployed" | "failed"
  stableUrl?: string
  previousDeploymentId?: string
}

export interface DeploymentAdapter {
  build(versionId: string): Promise<BuildArtifact>
  deploy(input: DeployInput): Promise<DeploymentResult>
  rollback(deploymentId: string): Promise<void>
}

export type OAuthInput = { provider: "github"; authorizationCode: string; redirectUri: string }
export type AuthorizationResult = { connectionId: string; accountLabel: string }
export type Resource = { id: string; name: string; kind: string }
export type IntegrationAction = { resourceId: string; operation: string; input: Record<string, unknown> }
export type IntegrationResult = { status: "success" | "failed"; output: Record<string, unknown> }

export interface IntegrationAdapter {
  authorize(input: OAuthInput): Promise<AuthorizationResult>
  listResources(connectionId: string): Promise<Resource[]>
  execute(action: IntegrationAction): Promise<IntegrationResult>
  revoke(connectionId: string): Promise<void>
}
