import type {
  SandboxAdapter,
  SandboxCommand,
  SandboxCommandResult,
  SandboxLimits,
} from "@atoms-builder/contracts"

const DEFAULT_IMAGE = "atoms-builder/next-web-sandbox:latest"
const MAX_CPU_MILLIS = 2_000
const MAX_MEMORY_BYTES = 4 * 1024 ** 3
const MAX_DISK_BYTES = 5 * 1024 ** 3
const MAX_LIFETIME_SECONDS = 20 * 60
const MAX_PROCESSES = 256

const ALLOWED_BINARIES = new Set([
  "eslint",
  "next",
  "node",
  "npm",
  "npx",
  "playwright",
  "pnpm",
  "tsc",
  "vitest",
  "yarn",
])

const ALLOWED_ENV_KEYS = new Set([
  "CI",
  "NODE_ENV",
  "NEXT_TELEMETRY_DISABLED",
  "PORT",
  "npm_config_cache",
  "npm_config_registry",
])

const FORBIDDEN_ENV_NAMES = /(?:TOKEN|SECRET|PASSWORD|PRIVATE|CREDENTIAL|DOCKER_HOST|DATABASE_URL|REDIS_URL|TEMPORAL)/i

export type ContainerMount = {
  source: string
  target: string
  readOnly: boolean
}

export type ContainerSpec = {
  image: string
  projectId: string
  versionId: string
  workspaceVolume: string
  mounts: readonly ContainerMount[]
  network: "none"
  readOnlyRootFs: true
  noNewPrivileges: true
  capDrop: readonly ["ALL"]
  user: "1000:1000"
  workdir: "/workspace"
  limits: SandboxLimits
}

export interface ContainerExecutor {
  create(spec: ContainerSpec): Promise<{ containerId: string }>
  exec(containerId: string, command: SandboxCommand): Promise<SandboxCommandResult>
  destroy(containerId: string): Promise<void>
}

export class SandboxValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SandboxValidationError"
  }
}

export class SandboxNotFoundError extends Error {
  constructor(readonly sandboxId: string) {
    super(`Sandbox not found: ${sandboxId}`)
    this.name = "SandboxNotFoundError"
  }
}

type Session = {
  containerId: string
  limits: SandboxLimits
}

function validateLimits(limits: SandboxLimits): SandboxLimits {
  const fields: Array<[keyof SandboxLimits, number, number]> = [
    ["cpuMillis", limits.cpuMillis, MAX_CPU_MILLIS],
    ["memoryBytes", limits.memoryBytes, MAX_MEMORY_BYTES],
    ["diskBytes", limits.diskBytes, MAX_DISK_BYTES],
    ["maxLifetimeSeconds", limits.maxLifetimeSeconds, MAX_LIFETIME_SECONDS],
    ["maxProcesses", limits.maxProcesses, MAX_PROCESSES],
  ]
  for (const [name, value, max] of fields) {
    if (!Number.isInteger(value) || value <= 0 || value > max) {
      throw new SandboxValidationError(`${name} must be a positive integer no greater than ${max}`)
    }
  }
  return { ...limits }
}

function validateIdentifier(name: string, field: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/.test(name)) {
    throw new SandboxValidationError(`${field} contains an invalid identifier`)
  }
}

function validateCommand(command: SandboxCommand, maxLifetimeSeconds: number): SandboxCommand {
  if (command.argv.length === 0) throw new SandboxValidationError("Sandbox command cannot be empty")
  if (command.argv.some((arg) => typeof arg !== "string" || arg.length === 0)) {
    throw new SandboxValidationError("Sandbox command arguments must be non-empty strings")
  }
  const [binary, ...args] = command.argv
  if (binary.includes("/") || !ALLOWED_BINARIES.has(binary)) {
    throw new SandboxValidationError(`Command is not allowed in the sandbox: ${binary}`)
  }
  const joined = command.argv.join(" ")
  if (/[;&|`$()<>\n\r]/.test(joined)) {
    throw new SandboxValidationError("Shell metacharacters are not allowed in sandbox commands")
  }
  if (command.cwd !== undefined && (command.cwd !== "/workspace" && !command.cwd.startsWith("/workspace/"))) {
    throw new SandboxValidationError("Sandbox cwd must be within /workspace")
  }
  if (!Number.isInteger(command.timeoutSeconds) || command.timeoutSeconds <= 0 || command.timeoutSeconds > maxLifetimeSeconds) {
    throw new SandboxValidationError(`Command timeout must be between 1 and ${maxLifetimeSeconds} seconds`)
  }
  if (command.env) {
    for (const [key, value] of Object.entries(command.env)) {
      if (!ALLOWED_ENV_KEYS.has(key) || FORBIDDEN_ENV_NAMES.test(key) || /[\0\r\n]/.test(value)) {
        throw new SandboxValidationError(`Environment variable is not allowed: ${key}`)
      }
    }
  }
  // Do not allow an argv value to smuggle a host path or a second command.
  if (args.some((arg) => arg === "/var/run/docker.sock" || arg.includes("docker.sock"))) {
    throw new SandboxValidationError("Docker socket access is forbidden")
  }
  return {
    ...command,
    argv: [...command.argv],
    env: command.env ? { ...command.env } : undefined,
  }
}

function assertSafeSpec(spec: ContainerSpec): void {
  if (spec.network !== "none" || spec.readOnlyRootFs !== true || spec.noNewPrivileges !== true || spec.user !== "1000:1000") {
    throw new SandboxValidationError("Container must use the restricted rootless profile")
  }
  if (spec.capDrop.length !== 1 || spec.capDrop[0] !== "ALL") {
    throw new SandboxValidationError("Container must drop all Linux capabilities")
  }
  validateIdentifier(spec.projectId, "projectId")
  validateIdentifier(spec.versionId, "versionId")
  validateIdentifier(spec.workspaceVolume, "workspaceVolume")
  if (spec.mounts.length !== 1 || spec.mounts[0]?.source !== `volume:${spec.workspaceVolume}` || spec.mounts[0]?.target !== "/workspace") {
    throw new SandboxValidationError("Sandbox may only mount its private workspace volume")
  }
  validateLimits(spec.limits)
}

export type SelfHostedContainerOptions = {
  executor: ContainerExecutor
  image?: string
}

/**
 * Rootless-container adapter. The executor is injected so the policy can be
 * tested without starting Docker; a production executor must map this profile
 * to a rootless Docker/Podman invocation and never expose its socket.
 */
export class SelfHostedContainerAdapter implements SandboxAdapter {
  private readonly sessions = new Map<string, Session>()
  private readonly executor: ContainerExecutor
  private readonly image: string

  constructor(options: SelfHostedContainerOptions) {
    this.executor = options.executor
    this.image = options.image ?? DEFAULT_IMAGE
    if (!this.image || /[\s\r\n]/.test(this.image) || this.image.includes("docker.sock")) {
      throw new SandboxValidationError("Sandbox image is invalid")
    }
  }

  async create(input: { projectId: string; versionId: string; limits: SandboxLimits }): Promise<{ sandboxId: string }> {
    validateIdentifier(input.projectId, "projectId")
    validateIdentifier(input.versionId, "versionId")
    const limits = validateLimits(input.limits)
    const workspaceVolume = `atoms_${input.projectId}_${input.versionId}`
    const spec: ContainerSpec = {
      image: this.image,
      projectId: input.projectId,
      versionId: input.versionId,
      workspaceVolume,
      mounts: [{ source: `volume:${workspaceVolume}`, target: "/workspace", readOnly: false }],
      network: "none",
      readOnlyRootFs: true,
      noNewPrivileges: true,
      capDrop: ["ALL"],
      user: "1000:1000",
      workdir: "/workspace",
      limits,
    }
    assertSafeSpec(spec)
    const created = await this.executor.create(spec)
    if (!created.containerId) throw new SandboxValidationError("Container executor returned an empty id")
    this.sessions.set(created.containerId, { containerId: created.containerId, limits })
    return { sandboxId: created.containerId }
  }

  async exec(sandboxId: string, command: SandboxCommand): Promise<SandboxCommandResult> {
    const session = this.sessions.get(sandboxId)
    if (!session) throw new SandboxNotFoundError(sandboxId)
    return this.executor.exec(session.containerId, validateCommand(command, session.limits.maxLifetimeSeconds))
  }

  async destroy(sandboxId: string): Promise<void> {
    const session = this.sessions.get(sandboxId)
    if (!session) return
    this.sessions.delete(sandboxId)
    await this.executor.destroy(session.containerId)
  }
}

