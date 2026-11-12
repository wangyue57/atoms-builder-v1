import type { ClaimedRun, CompletedSnapshot } from "@atoms-builder/persistence";
import { LocalWorkspaceAdapter, toSafePath } from "@atoms-builder/workspace";

/** Explicit test executor; never imported by the application worker. */
export async function snapshotExecutor(
  run: ClaimedRun,
): Promise<CompletedSnapshot> {
  const workspace = new LocalWorkspaceAdapter({
    projectId: run.projectId,
    initialVersionId: run.inputVersionId,
    initialFiles: run.sourceFiles,
  });
  const html =
    "<!doctype html><html><body><h1>Deterministic test preview</h1></body></html>";
  const snapshot = await workspace.applyPatch(
    { projectId: run.projectId, versionId: run.inputVersionId },
    {
      baseVersionId: run.inputVersionId,
      operations: [
        {
          path: toSafePath("app/page.tsx"),
          content:
            "export default function Page() { return <main>Test</main> }",
        },
        { path: toSafePath("public/preview.html"), content: html },
      ],
    },
  );
  const manifest = await workspace.getSnapshot({
    projectId: run.projectId,
    versionId: snapshot.versionId,
  });
  return {
    files: {
      ...run.sourceFiles,
      "app/page.tsx":
        "export default function Page() { return <main>Test</main> }",
      "public/preview.html": html,
    },
    manifestHash: manifest.manifest.hash,
    result: {
      runId: run.id,
      mode: "deepseek",
      status: "completed",
      versionId: snapshot.versionId,
      repairAttempts: 0,
      previewHtml: html,
      review: {
        status: "pass",
        score: 100,
        mustFix: [],
        risks: ["Deterministic test executor"],
      },
    },
  };
}
