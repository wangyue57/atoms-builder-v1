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

const initialFiles = new Map<string, string>([["app/page.tsx", "export default function Page() { return null }"]])

export function asSafePath(path: string): SafePath {
  if (!path || path.startsWith("/") || path.split("/").includes("..")) {
    throw new Error(`unsafe path: ${path}`)
  }
  return path as SafePath
}

function hash(content: string): string {
  return `sha256:${content.length}:${content.slice(0, 16)}`
}

export class TestWorkspace implements Workspace {
  private readonly snapshots = new Map<string, Map<string, string>>()
  private nextVersion = 1

  constructor(readonly projectId: string, initialVersionId = "version_0") {
    this.snapshots.set(initialVersionId, new Map(initialFiles))
  }

  private files(ref: VersionRef): Map<string, string> {
    if (ref.projectId !== this.projectId) throw new Error("project mismatch")
    const files = this.snapshots.get(ref.versionId)
    if (!files) throw new Error(`unknown version: ${ref.versionId}`)
    return files
  }

  async getSnapshot(ref: VersionRef): Promise<WorkspaceSnapshot> {
    const files = this.files(ref)
    const entries = [...files.entries()].map(([path, content]) => ({
      path,
      hash: hash(content),
      sizeBytes: Buffer.byteLength(content),
      objectRef: `memory://${this.projectId}/${ref.versionId}/${path}`,
    }))
    return {
      ref,
      manifest: {
        files: entries,
        hash: hash(entries.map((entry) => entry.hash).join("|")),
        totalBytes: entries.reduce((total, entry) => total + entry.sizeBytes, 0),
      },
    }
  }

  async readFile(ref: VersionRef, path: SafePath): Promise<FileContent> {
    const safePath = asSafePath(path)
    const content = this.files(ref).get(safePath)
    if (content === undefined) throw new Error(`file not found: ${safePath}`)
    return { path: safePath, content, hash: hash(content) }
  }

  async applyPatch(ref: VersionRef, patch: PatchSet): Promise<VersionRef> {
    const source = this.files(ref)
    if (patch.baseVersionId !== ref.versionId) throw new Error("base version mismatch")

    // Validate every operation before mutating or creating the candidate snapshot.
    const next = new Map(source)
    for (const operation of patch.operations) {
      const safePath = asSafePath(operation.path)
      if (safePath.startsWith(".env") || safePath === "package-lock.json") {
        throw new Error(`protected path: ${safePath}`)
      }
      next.set(safePath, operation.content)
    }

    const versionId = `version_${this.nextVersion++}`
    this.snapshots.set(versionId, next)
    return { projectId: this.projectId, versionId }
  }

  async runCheck(ref: VersionRef, _check: Parameters<Workspace["runCheck"]>[1]): Promise<CheckResult> {
    this.files(ref)
    return { status: "passed", exitCode: 0, outputArtifactId: `artifact://${ref.versionId}/check` }
  }

  async startPreview(ref: VersionRef): Promise<PreviewHandle> {
    this.files(ref)
    return {
      previewId: `preview_${ref.versionId}`,
      versionId: ref.versionId,
      url: `https://preview.invalid/${ref.versionId}`,
      expiresAt: new Date(Date.now() + 60_000),
    }
  }

  async inspectPreview(preview: PreviewHandle, _action: BrowserAction): Promise<BrowserResult> {
    this.files({ projectId: this.projectId, versionId: preview.versionId })
    return { status: "passed", details: "test browser assertion passed" }
  }

  async captureScreenshot(preview: PreviewHandle): Promise<{ artifactId: string }> {
    this.files({ projectId: this.projectId, versionId: preview.versionId })
    return { artifactId: `artifact://${preview.versionId}/screenshot` }
  }

  async export(ref: VersionRef): Promise<{ artifactId: string }> {
    this.files(ref)
    return { artifactId: `artifact://${ref.versionId}/export` }
  }
}

export class EventDeduplicator {
  private readonly seen = new Set<string>()

  accept(event: { runId: string; sequence: number }): boolean {
    const key = `${event.runId}:${event.sequence}`
    if (this.seen.has(key)) return false
    this.seen.add(key)
    return true
  }
}

export const reviewerToolGrants = ["reviewer.read", "reviewer.check", "reviewer.browser"] as const
