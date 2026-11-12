import assert from "node:assert/strict"
import test from "node:test"
import type { SandboxCommand, SandboxCommandResult, SandboxLimits } from "@atoms-builder/contracts"
import {
  SandboxNotFoundError,
  SandboxValidationError,
  SelfHostedContainerAdapter,
  type ContainerExecutor,
  type ContainerSpec,
} from "../src/self-hosted.js"

const limits: SandboxLimits = {
  cpuMillis: 1_000,
  memoryBytes: 512 * 1024 * 1024,
  diskBytes: 1024 * 1024 * 1024,
  maxLifetimeSeconds: 300,
  maxProcesses: 64,
}

class RecordingExecutor implements ContainerExecutor {
  readonly specs: ContainerSpec[] = []
  readonly commands: Array<{ containerId: string; command: SandboxCommand }> = []
  readonly destroyed: string[] = []

  async create(spec: ContainerSpec): Promise<{ containerId: string }> {
    this.specs.push(spec)
    return { containerId: "container_1" }
  }

  async exec(containerId: string, command: SandboxCommand): Promise<SandboxCommandResult> {
    this.commands.push({ containerId, command })
    return { exitCode: 0, stdout: "ok", stderr: "", durationMs: 1 }
  }

  async destroy(containerId: string): Promise<void> {
    this.destroyed.push(containerId)
  }
}

test("creates a restricted rootless container profile", async () => {
  const executor = new RecordingExecutor()
  const adapter = new SelfHostedContainerAdapter({ executor })
  const result = await adapter.create({ projectId: "project_1", versionId: "version_1", limits })
  assert.equal(result.sandboxId, "container_1")
  const spec = executor.specs[0]
  assert.equal(spec?.network, "none")
  assert.equal(spec?.readOnlyRootFs, true)
  assert.equal(spec?.noNewPrivileges, true)
  assert.deepEqual(spec?.capDrop, ["ALL"])
  assert.equal(spec?.user, "1000:1000")
  assert.deepEqual(spec?.mounts, [{ source: "volume:atoms_project_1_version_1", target: "/workspace", readOnly: false }])
})

test("allows bounded package checks and rejects arbitrary host commands", async () => {
  const executor = new RecordingExecutor()
  const adapter = new SelfHostedContainerAdapter({ executor })
  const { sandboxId } = await adapter.create({ projectId: "project_1", versionId: "version_1", limits })
  await adapter.exec(sandboxId, { argv: ["npm", "run", "build"], cwd: "/workspace", timeoutSeconds: 60 })
  assert.equal(executor.commands.length, 1)
  await assert.rejects(adapter.exec(sandboxId, { argv: ["sh", "-c", "npm run build"], timeoutSeconds: 1 }), SandboxValidationError)
  await assert.rejects(adapter.exec(sandboxId, { argv: ["node", "-e", "fetch('http://169.254.169.254')"], timeoutSeconds: 1 }), SandboxValidationError)
  await assert.rejects(adapter.exec(sandboxId, { argv: ["npm"], env: { DOCKER_HOST: "unix:///var/run/docker.sock" }, timeoutSeconds: 1 }), SandboxValidationError)
})

test("rejects excessive resources, protects the host socket and makes destroy idempotent", async () => {
  const executor = new RecordingExecutor()
  const adapter = new SelfHostedContainerAdapter({ executor })
  await assert.rejects(adapter.create({ projectId: "project_1", versionId: "version_1", limits: { ...limits, memoryBytes: 8 * 1024 ** 3 } }), SandboxValidationError)
  await assert.rejects(adapter.create({ projectId: "project_1", versionId: "version_1", limits: { ...limits, maxLifetimeSeconds: 3_600 } }), SandboxValidationError)
  const { sandboxId } = await adapter.create({ projectId: "project_1", versionId: "version_1", limits })
  await adapter.destroy(sandboxId)
  await adapter.destroy(sandboxId)
  assert.deepEqual(executor.destroyed, ["container_1"])
  await assert.rejects(adapter.exec(sandboxId, { argv: ["npm", "--version"], timeoutSeconds: 1 }), SandboxNotFoundError)
})

