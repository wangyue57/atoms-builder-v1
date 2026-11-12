import assert from "node:assert/strict";
import test from "node:test";
import {
  previewArtifactIssues,
  previewFailureReview,
} from "../src/preview-artifact.js";
import { runFailureDetails } from "../src/run-failure.js";
import { ModelGatewayError } from "@atoms-builder/model-gateway";

const document = (body: string, head = "") =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

test("preview delivery rejects missing HTML, JSX and empty mount-only documents", () => {
  assert.ok(previewArtifactIssues("").length);
  assert.ok(
    previewArtifactIssues("export default () => <main>Hello</main>").length,
  );
  assert.ok(
    previewArtifactIssues(
      document('<div id="root"></div><script>renderApp()</script>'),
    ).length,
  );
  assert.ok(
    previewArtifactIssues(document("<main hidden>Hello</main>")).length,
  );
});

test("preview delivery rejects resources blocked by the real CSP without blocking navigation links", () => {
  assert.ok(
    previewArtifactIssues(
      document(
        '<h1>Hello</h1><script src="https://cdn.example/react.js"></script>',
      ),
    ).length,
  );
  assert.ok(
    previewArtifactIssues(
      document("<h1>Hello</h1>", '<link rel="stylesheet" href="/styles.css">'),
    ).length,
  );
  assert.ok(
    previewArtifactIssues(
      document(
        "<h1>Hello</h1>",
        '<style>@import "https://fonts.example/font.css";</style>',
      ),
    ).length,
  );
  assert.ok(
    previewArtifactIssues(
      document(
        '<h1>Hello</h1><script type="text/babel">const App=()=> <main/>;</script>',
      ),
    ).length,
  );
  assert.deepEqual(
    previewArtifactIssues(
      document(
        '<h1>Hello</h1><a href="https://example.com">Website</a><img src="data:image/png;base64,AA==">',
        "<style>body{color:purple}</style>",
      ),
    ),
    [],
  );
});

test("static checks accept inline interactive HTML and do not execute its code", () => {
  const html = document(
    "<h1>待办</h1><button>添加</button><script>globalThis.__preview_must_not_run = true;</script>",
  );
  assert.deepEqual(previewArtifactIssues(html), []);
  assert.equal("__preview_must_not_run" in globalThis, false);
  const review = previewFailureReview(previewArtifactIssues(""));
  assert.equal(review.status, "fail");
  assert.equal(review.checks[0]?.name, "preview-artifact");
  assert.deepEqual(review.evidence, []);
});

test("worker failure diagnostics preserve useful codes without exposing raw provider messages", () => {
  const failure = runFailureDetails(
    new ModelGatewayError(
      "private prompt and sk-do-not-log-this",
      "INVALID_OUTPUT",
      false,
      2,
    ),
  );
  assert.equal(failure.code, "INVALID_OUTPUT");
  assert.equal(failure.attempts, 2);
  assert.ok(!JSON.stringify(failure).includes("do-not-log"));
  assert.match(
    runFailureDetails(new ModelGatewayError("private", "TIMEOUT", true))
      .message,
    /超时/,
  );
  assert.equal(
    runFailureDetails(
      Object.assign(new Error("database password"), { code: "23505" }),
    ).code,
    "DATABASE_23505",
  );
});
