import assert from "node:assert/strict";
import test from "node:test";
import {
  DeepSeekHttpError,
  ModelGatewayError,
} from "@atoms-builder/model-gateway";
import { runFailureDetails } from "../src/run-failure.js";
import { executeApplicationRun } from "../src/workflow.js";
import type { ClaimedRun } from "@atoms-builder/persistence";

test("missing DSKEY rejects the product workflow instead of producing an unverified success", async () => {
  const previous = process.env.DSKEY;
  delete process.env.DSKEY;
  try {
    await assert.rejects(
      executeApplicationRun({
        id: "missing-key",
        projectId: "test",
        inputVersionId: "initial",
        sourceFiles: {
          "app/page.tsx": "export default function Page() { return null }",
        },
      } as ClaimedRun),
      (error: unknown) => {
        const failure = runFailureDetails(error);
        assert.equal(failure.code, "MISSING_API_KEY");
        assert.match(failure.message, /DSKEY/);
        assert.equal(failure.attempts, 0);
        return true;
      },
    );
  } finally {
    if (previous === undefined) delete process.env.DSKEY;
    else process.env.DSKEY = previous;
  }
});

test("format failures distinguish source review and truncation without disclosing source", () => {
  const error = new ModelGatewayError(
    "private generated source",
    "INVALID_OUTPUT",
    false,
    2,
  );
  error.promptVersion = "reviewer";
  error.outputFailure = "SCHEMA_MISMATCH";
  const review = runFailureDetails(error);
  assert.match(review.message, /源码审核失败/);
  assert.match(review.message, /字段或检查项结构/);
  assert.ok(!review.message.includes("private"));
  error.promptVersion = "builder";
  error.outputFailure = "OUTPUT_TRUNCATED";
  const build = runFailureDetails(error);
  assert.match(build.message, /页面生成失败/);
  assert.match(build.message, /截断/);
});

for (const [status, reason] of [
  [401, "密钥"],
  [402, "余额"],
  [429, "频繁"],
  [503, "不可用"],
] as const) {
  test(`DeepSeek HTTP ${status} has an actionable and sanitized message`, () => {
    const error = new ModelGatewayError(
      "private provider details",
      "PROVIDER",
      false,
      2,
      { cause: new DeepSeekHttpError(status, "private provider details") },
    );
    const failure = runFailureDetails(error);
    assert.equal(failure.code, `DEEPSEEK_HTTP_${status}`);
    assert.match(failure.message, new RegExp(reason));
    assert.match(failure.message, new RegExp(`HTTP ${status}`));
    assert.ok(!failure.message.includes("private"));
  });
}
