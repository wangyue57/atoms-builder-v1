import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApplicationRepository,
  createApplicationPool,
  migrateApplicationPool,
} from "@atoms-builder/persistence";
import type {
  ApplicationTask,
  ApplicationUser,
} from "@atoms-builder/contracts";
import { createServer } from "../src/server.js";
import { createStaticFrontend } from "../src/frontend.js";
import { executeApplicationRun } from "../src/workflow.js";
import { snapshotExecutor } from "./snapshot-executor.js";
import { processClaimedRun } from "../src/worker.js";
import { ModelGatewayError } from "@atoms-builder/model-gateway";

const databaseUrl = process.env.TEST_DATABASE_URL;
const pgTest = (name: string, run: () => Promise<void>) =>
  test(name, { skip: !databaseUrl }, run);
let repository: ApplicationRepository;
before(async () => {
  if (!databaseUrl) return;
  assert.match(
    new URL(databaseUrl).pathname,
    /test/i,
    "PG integration tests require an explicitly named test database",
  );
  const pool = createApplicationPool(databaseUrl);
  await migrateApplicationPool(pool);
  repository = new ApplicationRepository(pool);
});
after(async () => {
  await repository?.close();
});
const username = () => `u_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
async function newUser(): Promise<ApplicationUser> {
  return (await repository.register(username(), "password-123")).user;
}
async function withServer(run: (base: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "atoms-durable-test-"));
  await mkdir(join(directory, "assets"));
  await writeFile(
    join(directory, "index.html"),
    '<title>Atoms Builder</title><div id="root"></div>',
  );
  await writeFile(
    join(directory, "assets", "app-Abcd1234.js"),
    'console.log("asset")',
  );
  const server = createServer({
    repository,
    frontend: createStaticFrontend(directory),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}
async function api(
  base: string,
  path: string,
  method = "GET",
  body?: unknown,
  cookie?: string,
) {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function login(base: string, name: string) {
  const registered = await api(base, "/api/auth/register", "POST", {
    username: name,
    password: "password-123",
  });
  assert.equal(registered.status, 201);
  const response = await api(base, "/api/auth/login", "POST", {
    username: name.toUpperCase(),
    password: "password-123",
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

pgTest(
  "real PG registration/session hashing, duplicate race, throttling and logout",
  async () => {
    await withServer(async (base) => {
      const name = username();
      const attempts = await Promise.all([
        api(base, "/api/auth/register", "POST", {
          username: name,
          password: "password-123",
        }),
        api(base, "/api/auth/register", "POST", {
          username: name.toUpperCase(),
          password: "password-123",
        }),
      ]);
      assert.deepEqual(attempts.map((x) => x.status).sort(), [201, 409]);
      const registeredCookie = attempts
        .find((response) => response.status === 201)!
        .headers.get("set-cookie");
      assert.ok(registeredCookie);
      const registeredSession = await (
        await api(base, "/api/auth/me", "GET", undefined, registeredCookie)
      ).json();
      assert.equal(registeredSession.user.username, name);
      const stored = (
        await repository.pool.query(
          "select * from users where username_normalized=$1",
          [name],
        )
      ).rows[0];
      assert.notEqual(stored.password_hash, "password-123");
      assert.ok(stored.password_salt.length >= 32);
      const response = await api(base, "/api/auth/login", "POST", {
        username: name.toUpperCase(),
        password: "password-123",
      });
      assert.equal(response.status, 200);
      const raw = await response.text();
      assert.ok(!raw.includes("password_hash"));
      const cookie = response.headers.get("set-cookie")!;
      assert.match(cookie, /HttpOnly/);
      assert.match(cookie, /SameSite=Lax/);
      const token = cookie.split(";")[0]!.split("=")[1]!;
      const sessions = (
        await repository.pool.query(
          "select token_hash from sessions where user_id=$1",
          [stored.id],
        )
      ).rows;
      assert.equal(sessions.length, 2);
      assert.ok(sessions.every((session) => session.token_hash !== token));
      assert.equal(
        (await api(base, "/api/auth/me", "GET", undefined, cookie)).status,
        200,
      );
      assert.equal(
        (await api(base, "/api/auth/logout", "POST", undefined, cookie)).status,
        204,
      );
      assert.equal(
        (
          await (
            await api(base, "/api/auth/me", "GET", undefined, cookie)
          ).json()
        ).user,
        null,
      );
      assert.equal(
        (
          await api(base, "/api/auth/login", "POST", {
            username: name,
            password: "incorrect-pass",
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await repository.pool.query(
            "select failures from auth_attempts where failures>0",
          )
        ).rowCount! > 0,
        true,
      );
      for (let i = 0; i < 9; i++)
        assert.equal(
          (
            await api(base, "/api/auth/login", "POST", {
              username: name,
              password: "incorrect-pass",
            })
          ).status,
          401,
        );
      assert.equal(
        (
          await api(base, "/api/auth/login", "POST", {
            username: name,
            password: "incorrect-pass",
          })
        ).status,
        429,
      );
    });
  },
);

pgTest(
  "authenticated HTTP task creation is queued and strongly user-isolated",
  async () => {
    await withServer(async (base) => {
      const a = await login(base, username()),
        b = await login(base, username());
      assert.equal((await api(base, "/api/tasks")).status, 401);
      assert.equal(
        (await api(base, "/api/runs", "POST", { request: "anonymous" })).status,
        410,
      );
      const cross = await fetch(`${base}/api/tasks`, {
        method: "POST",
        headers: {
          cookie: a,
          origin: "https://untrusted.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          request: "blocked",
          idempotencyKey: randomUUID(),
        }),
      });
      assert.equal(cross.status, 403);
      const created = await api(
        base,
        "/api/tasks",
        "POST",
        { request: "A private page", idempotencyKey: randomUUID() },
        a,
      );
      assert.equal(created.status, 202);
      const task = (await created.json()) as ApplicationTask;
      assert.equal(task.phase, "queued");
      assert.equal(
        (await api(base, `/api/tasks/${task.id}`, "GET", undefined, b)).status,
        404,
      );
      assert.equal(
        (
          await api(
            base,
            `/api/tasks/${task.id}/runs`,
            "POST",
            { request: "steal", idempotencyKey: randomUUID() },
            b,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await (
            await api(base, "/api/tasks?page=1&pageSize=1", "GET", undefined, a)
          ).json()
        ).tasks[0].id,
        task.id,
      );
      assert.equal(
        (await (await api(base, "/api/tasks", "GET", undefined, b)).json())
          .total,
        0,
      );
    });
  },
);

pgTest(
  "PG idempotency and concurrent runs enforce one active run per project",
  async () => {
    const user = await newUser(),
      key = randomUUID();
    const created = await Promise.all([
      repository.createTask(user.id, { request: "Build", idempotencyKey: key }),
      repository.createTask(user.id, { request: "Build", idempotencyKey: key }),
    ]);
    assert.equal(created[0]!.id, created[1]!.id);
    await assert.rejects(
      repository.createTask(user.id, {
        request: "Different",
        idempotencyKey: key,
      }),
      { status: 409 },
    );
    const task = created[0]!;
    await assert.rejects(
      repository.modifyTask(user.id, task.id, {
        request: "modify busy",
        idempotencyKey: randomUUID(),
      }),
      { status: 409 },
    );
    await repository.pool.query(
      "update runs set status='failed',error='test',finished_at=now() where project_id=$1",
      [task.id],
    );
    const modifications = await Promise.allSettled([
      repository.modifyTask(user.id, task.id, {
        request: "Change one",
        idempotencyKey: randomUUID(),
      }),
      repository.modifyTask(user.id, task.id, {
        request: "Change two",
        idempotencyKey: randomUUID(),
      }),
    ]);
    assert.equal(
      modifications.filter((x) => x.status === "fulfilled").length,
      1,
    );
    const active = await repository.pool.query(
      "select count(*)::integer as count from runs where project_id=$1 and status in('queued','running')",
      [task.id],
    );
    assert.equal(active.rows[0].count, 1);
  },
);

pgTest(
  "worker persists complete snapshots and a fresh repository resumes source/history",
  async () => {
    const priorKey = process.env.DSKEY;
    delete process.env.DSKEY;
    try {
      const user = await newUser(),
        task = await repository.createTask(user.id, {
          request: "Full source restart",
          idempotencyKey: randomUUID(),
        });
      // Claim this test task explicitly while exercising the real SKIP LOCKED implementation.
      const queued = await repository.pool.query<{ id: string }>(
        "select id from runs where project_id=$1",
        [task.id],
      );
      const expectedId = queued.rows[0]!.id;
      let run = await repository.claimRun("worker-snapshot", 60);
      const unrelated = [];
      while (run && run.id !== expectedId) {
        unrelated.push(run);
        run = await repository.claimRun("worker-snapshot", 60);
      }
      assert.ok(run);
      await processClaimedRun(repository, run, 60, snapshotExecutor);
      for (const other of unrelated)
        await repository.failRun(other, "test cleanup");
      const saved = await repository.getTask(user.id, task.id);
      assert.equal(saved.phase, "succeeded");
      assert.ok(saved.currentVersionId);
      assert.equal(saved.result?.versionId, saved.currentVersionId);
      const version = (
        await repository.pool.query(
          "select * from project_versions where id=$1",
          [saved.currentVersionId],
        )
      ).rows[0];
      assert.ok(version.source_files["app/page.tsx"]);
      assert.ok(version.source_files["public/preview.html"]);
      assert.ok(version.manifest.files.length >= 2);
      const fresh = new ApplicationRepository(
        createApplicationPool(databaseUrl),
      );
      try {
        const reloaded = await fresh.getTask(user.id, task.id);
        assert.equal(reloaded.previewHtml, saved.previewHtml);
        await fresh.modifyTask(user.id, task.id, {
          request: "Continue after restart",
          idempotencyKey: randomUUID(),
        });
        const next = await fresh.claimRun("worker-resume", 60);
        assert.ok(next);
        assert.equal(next.projectId, task.id);
        assert.deepEqual(next.sourceFiles, version.source_files);
        await processClaimedRun(fresh, next, 60, snapshotExecutor);
        const successful = await fresh.getTask(user.id, task.id);
        assert.equal(successful.runs.length, 2);
        await fresh.modifyTask(user.id, task.id, {
          request: "Review must fail",
          idempotencyKey: randomUUID(),
        });
        const rejectedRun = await fresh.claimRun("review-failure", 60);
        assert.ok(rejectedRun);
        const rejectedSnapshot = await snapshotExecutor(rejectedRun);
        rejectedSnapshot.result.status = "awaiting_fix_decision";
        rejectedSnapshot.result.review = {
          ...rejectedSnapshot.result.review,
          status: "fail",
          score: 20,
          mustFix: ["Fix before accepting"],
        };
        assert.equal(
          await fresh.finishRun(rejectedRun, rejectedSnapshot),
          true,
        );
        const rejected = await fresh.getTask(user.id, task.id);
        assert.equal(rejected.phase, "failed");
        assert.equal(rejected.currentVersionId, successful.currentVersionId);
        assert.equal(rejected.previewHtml, successful.previewHtml);
        assert.equal(rejected.result?.versionId, successful.result?.versionId);
        assert.equal(rejected.runs[0]?.status, "failed");
        assert.notEqual(rejected.runs[0]?.versionId, rejected.currentVersionId);
        assert.match(rejected.error!, /审查未通过/);
      } finally {
        await fresh.close();
      }
    } finally {
      if (priorKey === undefined) delete process.env.DSKEY;
      else process.env.DSKEY = priorKey;
    }
  },
);

pgTest(
  "missing key is persisted by the real worker and returned to the task owner",
  async () => {
    const previous = process.env.DSKEY;
    delete process.env.DSKEY;
    try {
      const user = await newUser();
      const task = await repository.createTask(user.id, {
        request: "Missing configuration",
        idempotencyKey: randomUUID(),
      });
      let run = await repository.claimRun("missing-key-test", 60);
      while (run && run.projectId !== task.id) {
        await repository.failRun(run, "test cleanup");
        run = await repository.claimRun("missing-key-test", 60);
      }
      assert.ok(run);
      await processClaimedRun(repository, run, 60, executeApplicationRun);
      const failed = await repository.getTask(user.id, task.id);
      assert.equal(failed.phase, "failed");
      assert.equal(failed.currentVersionId, null);
      assert.equal(failed.previewHtml, "");
      assert.match(failed.error!, /MISSING_API_KEY/);
      assert.match(failed.runs[0]!.error!, /DSKEY/);
    } finally {
      if (previous === undefined) delete process.env.DSKEY;
      else process.env.DSKEY = previous;
    }
  },
);

pgTest(
  "leases prevent double claim and expired work fails without automatic paid retry",
  async () => {
    const user = await newUser(),
      task = await repository.createTask(user.id, {
        request: "Lease test",
        idempotencyKey: randomUUID(),
      });
    const claims = await Promise.all([
      repository.claimRun("lease-a", 60),
      repository.claimRun("lease-b", 60),
    ]);
    const matching = claims.filter((x) => x?.projectId === task.id);
    assert.equal(matching.length, 1);
    const claim = matching[0]!;
    assert.ok(await repository.renewLease(claim.id, claim.owner, 60));
    assert.equal(await repository.renewLease(claim.id, "intruder", 60), false);
    await repository.recoverExpiredLeases();
    assert.equal((await repository.getTask(user.id, task.id)).phase, "running");
    await repository.pool.query(
      "update runs set lease_until=now()-interval '1 second' where id=$1",
      [claim.id],
    );
    await repository.recoverExpiredLeases();
    const interrupted = await repository.getTask(user.id, task.id);
    assert.equal(interrupted.phase, "failed");
    assert.match(interrupted.error!, /中断/);
    assert.equal(await repository.renewLease(claim.id, claim.owner, 60), false);
    await repository.modifyTask(user.id, task.id, {
      request: "Explicit retry",
      idempotencyKey: randomUUID(),
    });
    assert.equal((await repository.getTask(user.id, task.id)).phase, "queued");
  },
);

pgTest(
  "static SPA fallback, assets and HEAD still use the real repository server",
  async () => {
    await withServer(async (base) => {
      const page = await fetch(`${base}/tasks/example`);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /id="root"/);
      const asset = await fetch(`${base}/assets/app-Abcd1234.js`);
      assert.equal(asset.status, 200);
      assert.match(asset.headers.get("cache-control")!, /immutable/);
      const head = await fetch(`${base}/assets/app-Abcd1234.js`, {
        method: "HEAD",
      });
      assert.equal(await head.text(), "");
      assert.equal((await fetch(`${base}/assets/missing.js`)).status, 404);
      assert.equal((await fetch(`${base}/api/missing`)).status, 404);
    });
  },
);

pgTest(
  "missing preview cannot become a successful version and model failures remain actionable",
  async () => {
    const user = await newUser();
    const task = await repository.createTask(user.id, {
      request: "Guard missing preview",
      idempotencyKey: randomUUID(),
    });
    async function claim(owner: string) {
      let run = await repository.claimRun(owner, 60);
      while (run && run.projectId !== task.id) {
        await repository.failRun(run, "test cleanup");
        run = await repository.claimRun(owner, 60);
      }
      assert.ok(run);
      return run;
    }
    const run = await claim("preview-guard");
    const snapshot = await snapshotExecutor(run);
    snapshot.files["public/preview.html"] = "";
    snapshot.result.previewHtml = "";
    await assert.rejects(repository.finishRun(run, snapshot), /预览产物缺失/);
    assert.equal(
      (await repository.getTask(user.id, task.id)).currentVersionId,
      null,
    );
    await processClaimedRun(repository, run, 60, async () => snapshot);
    const rejected = await repository.getTask(user.id, task.id);
    assert.equal(rejected.phase, "failed");
    assert.equal(rejected.currentVersionId, null);
    assert.equal(rejected.previewHtml, "");
    assert.match(rejected.error!, /预览产物缺失/);
    await repository.modifyTask(user.id, task.id, {
      request: "Retry model failure",
      idempotencyKey: randomUUID(),
    });
    const retry = await claim("model-failure");
    await processClaimedRun(repository, retry, 60, async () => {
      throw new ModelGatewayError(
        "private model source and credentials",
        "TIMEOUT",
        true,
        2,
      );
    });
    const failed = await repository.getTask(user.id, task.id);
    assert.equal(failed.phase, "failed");
    assert.match(failed.error!, /TIMEOUT/);
    assert.ok(!failed.error!.includes("private model"));
  },
);
