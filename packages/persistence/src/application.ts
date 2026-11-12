import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type pg from "pg";
import type { PoolClient } from "pg";
import {
  applicationTaskSchema,
  applicationTaskListSchema,
  applicationUserSchema,
  applicationRunResultSchema,
} from "@atoms-builder/contracts";
import type {
  ApplicationCreateTask,
  ApplicationTask,
  ApplicationTaskList,
  ApplicationUser,
  ApplicationRunResult,
} from "@atoms-builder/contracts";
import { transaction } from "./postgres.js";

const scrypt = promisify(scryptCallback);
export class ApplicationError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApplicationError";
  }
}
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const iso = (value: Date | string) => new Date(value).toISOString();
type Executor = pg.Pool | PoolClient;
function sourceManifest(files: Record<string, string>, versionId: string) {
  const entries = Object.entries(files)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, content]) => ({
      path,
      hash: `sha256:${digest(content)}`,
      sizeBytes: Buffer.byteLength(content),
      objectRef: `postgres-version://${versionId}/${encodeURIComponent(path)}`,
    }));
  return {
    hash: `sha256:${digest(entries.map((entry) => `${entry.path}:${entry.hash}`).join("\n"))}`,
    files: entries,
    totalBytes: entries.reduce((sum, file) => sum + file.sizeBytes, 0),
  };
}
interface UserRow {
  id: string;
  username: string;
  created_at: Date;
  password_hash: string;
  password_salt: string;
}
interface RunRow {
  id: string;
  request: string;
  status: string;
  error: string | null;
  result: ApplicationRunResult | null;
  created_at: Date;
  finished_at: Date | null;
}
interface ProjectRow {
  id: string;
  name: string;
  current_version_id: string | null;
  last_successful_version_id: string | null;
  created_at: Date;
  updated_at: Date;
}
export interface ClaimedRun {
  id: string;
  projectId: string;
  request: string;
  inputVersionId: string;
  sourceFiles: Record<string, string>;
  owner: string;
}
export interface CompletedSnapshot {
  result: ApplicationRunResult;
  files: Record<string, string>;
  manifestHash: string;
}

function userDto(row: UserRow): ApplicationUser {
  return applicationUserSchema.parse({
    id: row.id,
    username: row.username,
    createdAt: iso(row.created_at),
  });
}

/** PostgreSQL is the sole application persistence implementation. */
export class ApplicationRepository {
  constructor(readonly pool: pg.Pool) {}
  async ready(): Promise<void> {
    await this.pool.query("select 1");
  }
  async close(): Promise<void> {
    await this.pool.end();
  }

  async register(
    username: string,
    password: string,
  ): Promise<{ user: ApplicationUser; token: string }> {
    const normalized = username.toLowerCase();
    const salt = randomBytes(16).toString("hex");
    const hash = ((await scrypt(password, salt, 64)) as Buffer).toString("hex");
    try {
      return await transaction(this.pool, async (client) => {
        const created = await client.query<UserRow>(
          "insert into users(id,username,username_normalized,password_hash,password_salt) values($1,$2,$2,$3,$4) returning *",
          [randomUUID(), normalized, hash, salt],
        );
        const user = created.rows[0]!;
        const organizationId = randomUUID();
        await client.query(
          "insert into organizations(id,name,plan,owner_user_id) values($1,$2,'free',$3)",
          [organizationId, `${normalized}'s workspace`, user.id],
        );
        await client.query(
          "insert into memberships(organization_id,user_id,role) values($1,$2,'owner')",
          [organizationId, user.id],
        );
        const token = randomBytes(32).toString("base64url");
        await client.query(
          "insert into sessions(user_id,token_hash,expires_at) values($1,$2,now()+interval '30 days')",
          [user.id, digest(token)],
        );
        return { user: userDto(user), token };
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        error.code === "23505"
      )
        throw new ApplicationError(409, "用户名已存在");
      throw error;
    }
  }

  async login(
    username: string,
    password: string,
    remoteAddress: string,
  ): Promise<{ user: ApplicationUser; token: string }> {
    const normalized = username.toLowerCase();
    const attemptKey = digest(`${normalized}:${remoteAddress}`);
    return transaction(this.pool, async (client) => {
      await client.query(
        "insert into auth_attempts(key_hash) values($1) on conflict do nothing",
        [attemptKey],
      );
      const attempt = await client.query<{
        failures: number;
        window_started_at: Date;
      }>("select * from auth_attempts where key_hash=$1 for update", [
        attemptKey,
      ]);
      let failures = attempt.rows[0]!.failures;
      if (
        Date.now() - attempt.rows[0]!.window_started_at.getTime() >
        15 * 60_000
      ) {
        failures = 0;
        await client.query(
          "update auth_attempts set failures=0,window_started_at=now() where key_hash=$1",
          [attemptKey],
        );
      }
      if (failures >= 10)
        throw new ApplicationError(429, "尝试次数过多，请稍后重试");
      const users = await client.query<UserRow>(
        "select * from users where username_normalized=$1",
        [normalized],
      );
      const row = users.rows[0];
      const actual = (await scrypt(
        password,
        row?.password_salt ?? "invalid-credential-dummy-salt",
        64,
      )) as Buffer;
      const expected = row
        ? Buffer.from(row.password_hash, "hex")
        : Buffer.alloc(64);
      if (!row || !timingSafeEqual(actual, expected)) {
        await client.query(
          "update auth_attempts set failures=failures+1 where key_hash=$1",
          [attemptKey],
        );
        // Commit failed attempts; throwing here would roll back the throttle counter.
        return { user: null, token: "" };
      }
      await client.query("delete from auth_attempts where key_hash=$1", [
        attemptKey,
      ]);
      const token = randomBytes(32).toString("base64url");
      await client.query(
        "insert into sessions(user_id,token_hash,expires_at) values($1,$2,now()+interval '30 days')",
        [row.id, digest(token)],
      );
      return { user: userDto(row), token };
    }).then((result) => {
      if (!result.user) throw new ApplicationError(401, "无效的用户名或密码");
      return { user: result.user, token: result.token };
    });
  }

  async sessionUser(token?: string): Promise<ApplicationUser | null> {
    if (!token || token.length > 256) return null;
    const result = await this.pool.query<UserRow>(
      "select u.* from sessions s join users u on u.id=s.user_id where s.token_hash=$1 and s.expires_at>now()",
      [digest(token)],
    );
    return result.rows[0] ? userDto(result.rows[0]) : null;
  }
  async logout(token?: string): Promise<void> {
    if (token)
      await this.pool.query("delete from sessions where token_hash=$1", [
        digest(token),
      ]);
  }

  private async task(
    client: Executor,
    userId: string,
    projectId: string,
  ): Promise<ApplicationTask> {
    const projects = await client.query<ProjectRow>(
      "select * from projects where id=$1 and owner_user_id=$2 and status='active'",
      [projectId, userId],
    );
    const project = projects.rows[0];
    if (!project) throw new ApplicationError(404, "任务不存在");
    const runs = await client.query<RunRow>(
      "select * from runs where project_id=$1 order by created_at desc,id desc",
      [projectId],
    );
    const latest = runs.rows[0];
    if (!latest) throw new Error("Project has no run");
    let result: ApplicationRunResult | null = latest.result;
    let previewHtml = "";
    if (project.last_successful_version_id) {
      const saved = await client.query<{
        preview_html: string;
        result: ApplicationRunResult;
      }>(
        "select v.preview_html,r.result from project_versions v join runs r on r.id=v.created_by_run_id where v.id=$1 and v.project_id=$2",
        [project.last_successful_version_id, projectId],
      );
      if (saved.rows[0]) {
        previewHtml = saved.rows[0].preview_html;
        result = saved.rows[0].result;
      }
    }
    return applicationTaskSchema.parse({
      id: project.id,
      title: project.name,
      phase:
        latest.status === "queued"
          ? "queued"
          : latest.status === "running"
            ? "running"
            : latest.status === "completed"
              ? "succeeded"
              : "failed",
      lastRequest: latest.request,
      error: latest.error,
      currentVersionId: project.last_successful_version_id,
      createdAt: iso(project.created_at),
      updatedAt: iso(project.updated_at),
      result,
      previewHtml,
      runs: runs.rows.map((run) => ({
        id: run.id,
        request: run.request,
        status: run.status,
        error: run.error,
        versionId: run.result?.versionId ?? null,
        createdAt: iso(run.created_at),
        finishedAt: run.finished_at ? iso(run.finished_at) : null,
      })),
    });
  }
  async getTask(userId: string, projectId: string): Promise<ApplicationTask> {
    return this.task(this.pool, userId, projectId);
  }

  async listTasks(
    userId: string,
    page = 1,
    pageSize = 20,
  ): Promise<ApplicationTaskList> {
    type SummaryRow = {
      id: string;
      name: string;
      last_successful_version_id: string | null;
      created_at: Date;
      updated_at: Date;
      request: string;
      run_status: string;
      error: string | null;
      total: string;
    };
    const found = await this.pool.query<SummaryRow>(
      "select p.id,p.name,p.last_successful_version_id,p.created_at,p.updated_at,r.request,r.status as run_status,r.error,count(*) over()::text as total from projects p join lateral (select request,status,error from runs where project_id=p.id order by created_at desc,id desc limit 1) r on true where p.owner_user_id=$1 and p.status='active' order by p.updated_at desc,p.id desc limit $2 offset $3",
      [userId, pageSize, (page - 1) * pageSize],
    );
    const total =
      found.rows[0]?.total ??
      (
        await this.pool.query<{ total: string }>(
          "select count(*)::text as total from projects where owner_user_id=$1 and status='active'",
          [userId],
        )
      ).rows[0]!.total;
    const tasks = found.rows.map((row) => ({
      id: row.id,
      title: row.name,
      phase:
        row.run_status === "queued"
          ? "queued"
          : row.run_status === "running"
            ? "running"
            : row.run_status === "completed"
              ? "succeeded"
              : "failed",
      lastRequest: row.request,
      error: row.error,
      currentVersionId: row.last_successful_version_id,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    }));
    return applicationTaskListSchema.parse({
      tasks,
      total: Number(total),
      page,
      pageSize,
    });
  }

  async createTask(
    userId: string,
    input: ApplicationCreateTask,
  ): Promise<ApplicationTask> {
    return transaction(this.pool, async (client) => {
      await client.query(
        "select pg_advisory_xact_lock(hashtextextended($1,0))",
        [`${userId}:${input.idempotencyKey}`],
      );
      const prior = await client.query<{ project_id: string; request: string }>(
        "select project_id,request from runs where requested_by_user_id=$1 and kind='build' and idempotency_key=$2",
        [userId, input.idempotencyKey],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].request !== input.request)
          throw new ApplicationError(409, "幂等键已用于不同请求");
        return this.task(client, userId, prior.rows[0].project_id);
      }
      const organization = await client.query<{ id: string }>(
        "select id from organizations where owner_user_id=$1 order by created_at limit 1",
        [userId],
      );
      if (!organization.rows[0]) throw new ApplicationError(401, "请先登录");
      const projectId = randomUUID();
      await client.query(
        "insert into projects(id,organization_id,name,kind,visibility,status,owner_user_id) values($1,$2,$3,'web','private','active',$4)",
        [projectId, organization.rows[0].id, input.request, userId],
      );
      const templateVersionId = randomUUID();
      const templateFiles = {
        "app/page.tsx": "export default function Page() { return null }",
        "public/preview.html": "",
      };
      const manifest = sourceManifest(templateFiles, templateVersionId);
      await client.query(
        "insert into project_versions(id,project_id,source,manifest_hash,status,source_files,manifest) values($1,$2,'import',$3,'candidate',$4,$5)",
        [
          templateVersionId,
          projectId,
          manifest.hash,
          JSON.stringify(templateFiles),
          JSON.stringify(manifest),
        ],
      );
      await client.query(
        "update projects set current_version_id=$2 where id=$1",
        [projectId, templateVersionId],
      );
      await client.query(
        "insert into runs(id,project_id,input_version_id,requested_by_user_id,kind,status,idempotency_key,request) values($1,$2,$3,$4,'build','queued',$5,$6)",
        [
          randomUUID(),
          projectId,
          templateVersionId,
          userId,
          input.idempotencyKey,
          input.request,
        ],
      );
      return this.task(client, userId, projectId);
    });
  }

  async modifyTask(
    userId: string,
    projectId: string,
    input: ApplicationCreateTask,
  ): Promise<ApplicationTask> {
    return transaction(this.pool, async (client) => {
      const owned = await client.query<ProjectRow>(
        "select * from projects where id=$1 and owner_user_id=$2 and status='active' for update",
        [projectId, userId],
      );
      const project = owned.rows[0];
      if (!project) throw new ApplicationError(404, "任务不存在");
      const prior = await client.query<{ request: string; kind: string }>(
        "select request,kind from runs where project_id=$1 and requested_by_user_id=$2 and idempotency_key=$3",
        [projectId, userId, input.idempotencyKey],
      );
      if (prior.rows[0]) {
        if (
          prior.rows[0].request !== input.request ||
          prior.rows[0].kind !== "modify"
        )
          throw new ApplicationError(409, "幂等键已用于不同请求");
        return this.task(client, userId, projectId);
      }
      const active = await client.query(
        "select id from runs where project_id=$1 and status in ('queued','running')",
        [projectId],
      );
      if (active.rowCount)
        throw new ApplicationError(409, "任务仍在运行，请等待完成");
      await client.query(
        "insert into runs(id,project_id,input_version_id,requested_by_user_id,kind,status,idempotency_key,request) values($1,$2,$3,$4,'modify','queued',$5,$6)",
        [
          randomUUID(),
          projectId,
          project.last_successful_version_id ?? project.current_version_id,
          userId,
          input.idempotencyKey,
          input.request,
        ],
      );
      await client.query("update projects set updated_at=now() where id=$1", [
        projectId,
      ]);
      return this.task(client, userId, projectId);
    });
  }

  /** Expired paid work is failed, never automatically requeued. Live leases are untouched. */
  async recoverExpiredLeases(): Promise<number> {
    return transaction(this.pool, async (client) => {
      const expired = await client.query<{ project_id: string }>(
        "update runs set status='failed',error='执行进程中断，请重新提交修改要求',finished_at=now(),lease_owner=null,lease_until=null,updated_at=now() where status='running' and lease_until<now() returning project_id",
      );
      for (const row of expired.rows)
        await client.query("update projects set updated_at=now() where id=$1", [
          row.project_id,
        ]);
      return expired.rowCount ?? 0;
    });
  }
  async claimRun(owner: string, leaseSeconds = 60): Promise<ClaimedRun | null> {
    return transaction(this.pool, async (client) => {
      const selected = await client.query<{
        id: string;
        project_id: string;
        request: string;
        input_version_id: string;
      }>(
        "select id,project_id,request,input_version_id from runs where status='queued' order by created_at,id for update skip locked limit 1",
      );
      const row = selected.rows[0];
      if (!row) return null;
      await client.query(
        "update runs set status='running',lease_owner=$2,lease_until=now()+($3*interval '1 second'),updated_at=now() where id=$1",
        [row.id, owner, leaseSeconds],
      );
      await client.query("update projects set updated_at=now() where id=$1", [
        row.project_id,
      ]);
      const snapshot = await client.query<{
        source_files: Record<string, string>;
      }>(
        "select source_files from project_versions where id=$1 and project_id=$2",
        [row.input_version_id, row.project_id],
      );
      const files = snapshot.rows[0]?.source_files;
      if (
        !files ||
        Object.keys(files).length === 0 ||
        Object.values(files).some((value) => typeof value !== "string")
      )
        throw new Error("Input source snapshot is unavailable");
      return {
        id: row.id,
        projectId: row.project_id,
        request: row.request,
        inputVersionId: row.input_version_id,
        sourceFiles: files,
        owner,
      };
    });
  }
  async renewLease(
    runId: string,
    owner: string,
    leaseSeconds = 60,
  ): Promise<boolean> {
    const result = await this.pool.query(
      "update runs set lease_until=now()+($3*interval '1 second'),updated_at=now() where id=$1 and lease_owner=$2 and status='running' and lease_until>now()",
      [runId, owner, leaseSeconds],
    );
    return Boolean(result.rowCount);
  }
  async finishRun(
    run: ClaimedRun,
    snapshot: CompletedSnapshot,
  ): Promise<boolean> {
    return transaction(this.pool, async (client) => {
      const active = await client.query(
        "select id from runs where id=$1 and lease_owner=$2 and status='running' and lease_until>now() for update",
        [run.id, run.owner],
      );
      if (!active.rowCount) return false;
      const versionId = randomUUID();
      const passed =
        snapshot.result.status === "completed" &&
        snapshot.result.review.status === "pass";
      const deliveredHtml = snapshot.files["public/preview.html"];
      if (
        passed &&
        (!deliveredHtml?.trim() ||
          deliveredHtml !== snapshot.result.previewHtml)
      ) {
        throw new ApplicationError(
          422,
          "预览产物缺失或与保存的源码快照不一致，不能发布为成功版本",
        );
      }
      const result = applicationRunResultSchema.parse({
        ...snapshot.result,
        runId: run.id,
        versionId,
        preview: { versionId, url: `isolated:${versionId}` },
      });
      const manifest = sourceManifest(snapshot.files, versionId);
      await client.query(
        "insert into project_versions(id,project_id,parent_version_id,source,manifest_hash,status,created_by_run_id,source_files,preview_html,review,manifest) values($1,$2,$3,'builder',$4,$5,$6,$7,$8,$9,$10)",
        [
          versionId,
          run.projectId,
          run.inputVersionId,
          snapshot.manifestHash,
          passed ? "current" : "failed",
          run.id,
          JSON.stringify(snapshot.files),
          snapshot.result.previewHtml ?? "",
          JSON.stringify(snapshot.result.review),
          JSON.stringify(manifest),
        ],
      );
      await client.query(
        "update runs set status=$3,result=$4,error=$5,finished_at=now(),lease_owner=null,lease_until=null,updated_at=now() where id=$1 and lease_owner=$2",
        [
          run.id,
          run.owner,
          passed ? "completed" : "failed",
          JSON.stringify(result),
          passed
            ? null
            : `本轮审查未通过：${snapshot.result.review.mustFix.slice(0, 3).join("；").slice(0, 500) || "请查看审核结果后重试"}`,
        ],
      );
      if (passed) {
        await client.query(
          "update project_versions set status='superseded' where project_id=$1 and status='current' and id<>$2",
          [run.projectId, versionId],
        );
        await client.query(
          "update projects set current_version_id=$2,last_successful_version_id=$2,updated_at=now() where id=$1",
          [run.projectId, versionId],
        );
      } else
        await client.query("update projects set updated_at=now() where id=$1", [
          run.projectId,
        ]);
      return true;
    });
  }
  async failRun(run: ClaimedRun, message: string): Promise<boolean> {
    return transaction(this.pool, async (client) => {
      const result = await client.query(
        "update runs set status='failed',error=$3,finished_at=now(),lease_owner=null,lease_until=null,updated_at=now() where id=$1 and lease_owner=$2 and status='running' and lease_until>now() returning project_id",
        [run.id, run.owner, message],
      );
      if (result.rowCount)
        await client.query("update projects set updated_at=now() where id=$1", [
          run.projectId,
        ]);
      return Boolean(result.rowCount);
    });
  }
}
