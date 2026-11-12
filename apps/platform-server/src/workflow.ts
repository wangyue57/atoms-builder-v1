import { ModelConfigurationError } from "./run-failure.js";
import {
  RealBuilderAgent,
  RealReviewerAgent,
} from "@atoms-builder/agent-runtime";
import {
  DeepSeekModelTransport,
  StructuredModelGateway,
} from "@atoms-builder/model-gateway";
import { LocalWorkspaceAdapter, toSafePath } from "@atoms-builder/workspace";
import type { ReviewReport } from "@atoms-builder/contracts";
import type { ClaimedRun, CompletedSnapshot } from "@atoms-builder/persistence";
import {
  previewArtifactIssues,
  previewFailureReview,
  PreviewArtifactError,
} from "./preview-artifact.js";

const budget = {
  maxSteps: 30,
  maxInputTokens: 10_000,
  maxOutputTokens: 1_000_000,
  maxCostUsd: 2,
  maxRuntimeSeconds: 1_200,
};
/** Model work happens only in the worker; generated files remain data in LocalWorkspace. */
export async function executeApplicationRun(
  run: ClaimedRun,
): Promise<CompletedSnapshot> {
  const initialVersionId = run.inputVersionId;
  if (!initialVersionId) throw new Error("An input version is required");
  const initialFiles = run.sourceFiles;
  if (!Object.keys(initialFiles).length)
    throw new Error("An immutable source snapshot is required");
  const workspace = new LocalWorkspaceAdapter({
    projectId: run.projectId,
    initialVersionId,
    initialFiles,
  });
  let versionId = initialVersionId;
  let review: ReviewReport;
  let repairAttempts = 0;
  let status: "completed" | "awaiting_fix_decision" | "failed";
  let modelRecords: readonly unknown[] = [];
  const mode = "deepseek";
  const apiKey = process.env.DSKEY?.trim();
  if (!apiKey) throw new ModelConfigurationError("MISSING_API_KEY");
  const timeoutMs = Number(process.env.MODEL_TIMEOUT_MS ?? 120_000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300_000)
    throw new ModelConfigurationError("INVALID_TIMEOUT");
  const previewRequirements =
    "\nAlso update public/preview.html in every build or repair. It must be a complete self-contained HTML document with visible body content, inline CSS/JavaScript, no CDN, imports, JSX/Babel or external resources. Preview runs in sandbox=allow-scripts with an opaque origin: do not access localStorage, sessionStorage, cookies or IndexedDB. Use in-memory state for preview interactions. Keep the standalone preview concise (under 1500 tokens).";
  const model = new StructuredModelGateway({
    provider: "deepseek",
    timeoutMs,
    maxRetries: 1,
    retryDelayMs: 500,
    retryInvalidOutput: true,
    onRecord: (record) =>
      console.info(
        JSON.stringify({ event: "model.call", runId: run.id, ...record }),
      ),
    transport: new DeepSeekModelTransport({
      apiKey,
      endpoint: process.env.DEEPSEEK_ENDPOINT,
    }),
    defaultPricing: { inputPer1kUsd: 0.0003, outputPer1kUsd: 0.0012 },
  });
  const options = {
    model,
    workspace,
    modelName: process.env.DEEPSEEK_MODEL ?? "deepseek-flash",
    maxLoopSteps: 12,
    checksAreSimulated: true,
  };
  const builder = new RealBuilderAgent(options);
  const reviewer = new RealReviewerAgent(options);
  const built = await builder.build({
    projectId: run.projectId,
    inputVersionId: versionId,
    userRequest: run.request + previewRequirements,
    projectSpec: { template: "next-web", sourceFiles: initialFiles },
    budget,
  });
  const reviewCandidate = async (
    candidateId: string,
    changedFiles: readonly string[],
    buildStatus: string,
  ): Promise<ReviewReport> => {
    const ref = { projectId: run.projectId, versionId: candidateId };
    const current = await workspace.getSnapshot(ref);
    const htmlFile = current.manifest.files.find(
      (file) => file.path === "public/preview.html",
    );
    const html = htmlFile
      ? (await workspace.readFile(ref, toSafePath("public/preview.html")))
          .content
      : "";
    const issues = previewArtifactIssues(html);
    if (!changedFiles.includes("public/preview.html"))
      issues.push(
        "本次构建必须同步更新 public/preview.html，不能仅修改 Next.js 源码而继续显示旧预览。",
      );
    if (buildStatus !== "completed")
      issues.push("生成器尚未完成本轮构建，请完成修复并交付预览。");
    if (issues.length) return previewFailureReview(issues);
    const report = await reviewer.review({
      projectId: run.projectId,
      versionId: candidateId,
      userRequest: run.request,
    });
    return {
      ...report,
      checks: [
        ...report.checks,
        {
          name: "preview-artifact",
          status: "pass",
          summary: "静态 HTML 交付检查通过；并非浏览器执行验收。",
          evidence: [],
        },
      ],
    };
  };
  versionId = built.versionId;
  review = await reviewCandidate(versionId, built.changedFiles, built.status);
  while (review.status === "fail" && repairAttempts < 3) {
    repairAttempts++;
    const current = await workspace.getSnapshot({
      projectId: run.projectId,
      versionId,
    });
    const sourceFiles: Record<string, string> = {};
    for (const file of current.manifest.files)
      sourceFiles[file.path] = (
        await workspace.readFile(
          { projectId: run.projectId, versionId },
          toSafePath(file.path),
        )
      ).content;
    const repaired = await builder.repair({
      projectId: run.projectId,
      inputVersionId: versionId,
      userRequest: run.request + previewRequirements,
      projectSpec: { template: "next-web", sourceFiles },
      budget,
      reviewReport: review,
    });
    versionId = repaired.versionId;
    review = await reviewCandidate(
      versionId,
      repaired.changedFiles,
      repaired.status,
    );
  }
  status =
    review.status === "pass"
      ? "completed"
      : repairAttempts >= 3
        ? "awaiting_fix_decision"
        : "failed";
  modelRecords = model.callRecords;
  const ref = { projectId: run.projectId, versionId };
  const snapshot = await workspace.getSnapshot(ref);
  const files: Record<string, string> = {};
  for (const file of snapshot.manifest.files)
    files[file.path] = (
      await workspace.readFile(ref, toSafePath(file.path))
    ).content;
  const previewHtml = files["public/preview.html"] ?? "";
  if (status === "completed") {
    const issues = previewArtifactIssues(previewHtml);
    if (issues.length) throw new PreviewArtifactError(issues);
  }
  return {
    result: {
      runId: run.id,
      mode,
      status,
      versionId,
      repairAttempts,
      review,
      previewHtml,
      modelRecords,
    },
    files,
    manifestHash: snapshot.manifest.hash,
  };
}
