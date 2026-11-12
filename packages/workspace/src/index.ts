import { createHash } from "node:crypto"
import type {
  BrowserAction,
  BrowserResult,
  CheckResult,
  FileContent,
  PatchSet,
  PreviewHandle,
  SafePath,
  VersionRef,
  Workspace,
  WorkspaceSnapshot,
} from "@atoms-builder/contracts"

export class UnsafePathError extends Error {
  constructor(readonly path: string) {
    super(`Unsafe workspace path: ${path}`)
    this.name = "UnsafePathError"
  }
}

export class UnknownVersionError extends Error {
  constructor(readonly versionId: string) {
    super(`Unknown workspace version: ${versionId}`)
    this.name = "UnknownVersionError"
  }
}

export class VersionConflictError extends Error {
  constructor(readonly expected: string, readonly actual: string) {
    super(`Workspace version conflict: expected ${expected}, received ${actual}`)
    this.name = "VersionConflictError"
  }
}

const PROTECTED_PATHS = new Set([
  ".env",
  ".env.local",
  ".env.production",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
])

export function toSafePath(path: string): SafePath {
  if (
    path.length === 0 ||
    path.includes("\0") ||
    path.startsWith("/") ||
    path.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    path.split(/[\\/]/).some((segment) => segment === "..")
  ) {
    throw new UnsafePathError(path)
  }

  const normalized = path.replaceAll("\\", "/")
  if (normalized.split("/").some((segment) => segment === "" || segment === ".")) {
    throw new UnsafePathError(path)
  }
  return normalized as SafePath
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function cloneFiles(files: ReadonlyMap<string, string>): Map<string, string> {
  return new Map(files)
}

export type LocalWorkspaceOptions = {
  projectId: string
  initialVersionId?: string
  initialFiles?: Readonly<Record<string, string>>
}

/**
 * Deterministic local adapter for local execution and tests. It stores immutable
 * snapshots in memory and never executes a caller supplied command.
 */
export class LocalWorkspaceAdapter implements Workspace {
  private readonly snapshots = new Map<string, Map<string, string>>()
  private readonly previews = new Map<string, PreviewHandle>()
  private nextVersion = 1

  readonly projectId: string
  readonly initialVersionId: string

  constructor(options: LocalWorkspaceOptions) {
    if (!options.projectId) throw new Error("projectId is required")
    this.projectId = options.projectId
    this.initialVersionId = options.initialVersionId ?? "version_0"
    const files = new Map<string, string>()
    for (const [path, content] of Object.entries(options.initialFiles ?? {})) {
      files.set(toSafePath(path), content)
    }
    this.snapshots.set(this.initialVersionId, files)
  }

  private getFiles(ref: VersionRef): ReadonlyMap<string, string> {
    if (ref.projectId !== this.projectId) {
      throw new Error(`Workspace project mismatch: ${ref.projectId}`)
    }
    const files = this.snapshots.get(ref.versionId)
    if (!files) throw new UnknownVersionError(ref.versionId)
    return files
  }

  private manifest(ref: VersionRef, files: ReadonlyMap<string, string>): WorkspaceSnapshot {
    const entries = [...files.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, content]) => ({
        path,
        hash: `sha256:${digest(content)}`,
        sizeBytes: Buffer.byteLength(content),
        objectRef: `memory://${this.projectId}/${ref.versionId}/${encodeURIComponent(path)}`,
      }))
    const manifestHash = digest(entries.map((entry) => `${entry.path}:${entry.hash}`).join("\n"))
    return {
      ref,
      manifest: {
        files: entries,
        hash: `sha256:${manifestHash}`,
        totalBytes: entries.reduce((sum, entry) => sum + entry.sizeBytes, 0),
      },
    }
  }

  async getSnapshot(ref: VersionRef): Promise<WorkspaceSnapshot> {
    return this.manifest(ref, this.getFiles(ref))
  }

  async readFile(ref: VersionRef, path: SafePath): Promise<FileContent> {
    const safePath = toSafePath(path)
    const content = this.getFiles(ref).get(safePath)
    if (content === undefined) throw new Error(`File not found: ${safePath}`)
    return { path: safePath, content, hash: `sha256:${digest(content)}` }
  }

  async applyPatch(ref: VersionRef, patch: PatchSet): Promise<VersionRef> {
    const source = this.getFiles(ref)
    if (patch.baseVersionId !== ref.versionId) {
      throw new VersionConflictError(patch.baseVersionId, ref.versionId)
    }

    // Validate the whole patch before allocating a new immutable snapshot.
    const operations = patch.operations.map((operation) => {
      const path = toSafePath(operation.path)
      if (PROTECTED_PATHS.has(path) || path.startsWith(".env/")) {
        throw new UnsafePathError(path)
      }
      if (typeof operation.content !== "string") {
        throw new TypeError(`Patch content must be a string for ${path}`)
      }
      return { path, content: operation.content }
    })

    const next = cloneFiles(source)
    for (const operation of operations) next.set(operation.path, operation.content)

    const versionId = `version_${this.nextVersion++}`
    this.snapshots.set(versionId, next)
    return { projectId: this.projectId, versionId }
  }

  async runCheck(ref: VersionRef, _check: Parameters<Workspace["runCheck"]>[1]): Promise<CheckResult> {
    this.getFiles(ref)
    return {
      status: "passed",
      exitCode: 0,
      outputArtifactId: `memory://${this.projectId}/${ref.versionId}/check`,
    }
  }

  async startPreview(ref: VersionRef): Promise<PreviewHandle> {
    this.getFiles(ref)
    const previewId = `preview_${this.projectId}_${ref.versionId}`
    const preview: PreviewHandle = {
      previewId,
      versionId: ref.versionId,
      url: `https://preview.invalid/${encodeURIComponent(this.projectId)}/${encodeURIComponent(ref.versionId)}`,
      expiresAt: new Date(Date.now() + 20 * 60_000),
    }
    this.previews.set(previewId, preview)
    return preview
  }

  private getPreview(preview: PreviewHandle): PreviewHandle {
    const stored = this.previews.get(preview.previewId)
    if (!stored || stored.versionId !== preview.versionId) {
      throw new Error(`Unknown or mismatched preview: ${preview.previewId}`)
    }
    if (stored.expiresAt.getTime() <= Date.now()) throw new Error(`Preview expired: ${preview.previewId}`)
    return stored
  }

  async inspectPreview(preview: PreviewHandle, _action: BrowserAction): Promise<BrowserResult> {
    this.getPreview(preview)
    return { status: "passed", details: `Local preview ${preview.versionId} is available` }
  }

  async captureScreenshot(preview: PreviewHandle): Promise<{ artifactId: string }> {
    this.getPreview(preview)
    return { artifactId: `memory://${this.projectId}/${preview.versionId}/screenshot` }
  }

  async export(ref: VersionRef): Promise<{ artifactId: string }> {
    this.getFiles(ref)
    return { artifactId: `memory://${this.projectId}/${ref.versionId}/export` }
  }
}

export * from "./self-hosted.js"

