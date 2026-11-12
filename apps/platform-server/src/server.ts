import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import {
  accountInputSchema,
  applicationCreateTaskSchema,
} from "@atoms-builder/contracts";
import { ApplicationError } from "@atoms-builder/persistence";
import type { ApplicationRepository } from "@atoms-builder/persistence";
import { createStaticFrontend } from "./frontend.js";
import type { FrontendHandler } from "./frontend.js";

export interface ServerOptions {
  repository: ApplicationRepository;
  frontend?: FrontendHandler;
  cookieSecure?: boolean;
}
const COOKIE = "atoms_session";
function sessionToken(request: IncomingMessage): string | undefined {
  const raw = request.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  return raw && /^[A-Za-z0-9_-]{20,256}$/.test(raw) ? raw : undefined;
}
async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 100_000) throw new ApplicationError(413, "请求过大");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApplicationError(400, "请求必须为有效 JSON");
  }
}
function json(response: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  response.end(payload);
}
function cookie(token: string, secure: boolean, clear = false) {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${clear ? 0 : 30 * 24 * 60 * 60}${secure ? "; Secure" : ""}`;
}
function sameOrigin(request: IncomingMessage, secure: boolean) {
  const origin = request.headers.origin;
  if (!origin) return;
  const current = `${secure ? "https" : "http"}://${request.headers.host}`;
  if (origin !== current && origin !== process.env.APP_ORIGIN)
    throw new ApplicationError(403, "不允许跨站请求");
}

/** API requests validate/authorize and enqueue only. Model execution belongs to worker.ts. */
export function createServer({
  repository,
  frontend = createStaticFrontend(),
  cookieSecure = process.env.COOKIE_SECURE === "true",
}: ServerOptions): Server {
  return createHttpServer(async (request, response) => {
    try {
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", "http://localhost");
      if (method === "GET" && url.pathname === "/favicon.ico") {
        response.writeHead(204).end();
        return;
      }
      if (method === "GET" && url.pathname === "/healthz") {
        await repository.ready();
        json(response, 200, {
          status: "ok",
          mode: "deepseek",
          modelConfigured: Boolean(process.env.DSKEY?.trim()),
        });
        return;
      }
      if (!["GET", "HEAD", "OPTIONS"].includes(method))
        sameOrigin(request, cookieSecure);
      if (method === "POST" && url.pathname === "/api/runs") {
        json(response, 410, { error: "匿名运行接口已移除，请使用 /api/tasks" });
        return;
      }
      if (
        method === "POST" &&
        (url.pathname === "/api/auth/register" ||
          url.pathname === "/api/auth/login")
      ) {
        const parsed = accountInputSchema.safeParse(await readBody(request));
        if (!parsed.success)
          throw new ApplicationError(
            400,
            "账号需为3至32位字母、数字或下划线，密码需为8至128位",
          );
        if (url.pathname.endsWith("/register")) {
          const registered = await repository.register(
            parsed.data.username,
            parsed.data.password,
          );
          response.setHeader(
            "set-cookie",
            cookie(registered.token, cookieSecure),
          );
          json(response, 201, { user: registered.user });
          return;
        }
        const login = await repository.login(
          parsed.data.username,
          parsed.data.password,
          request.socket.remoteAddress ?? "unknown",
        );
        response.setHeader("set-cookie", cookie(login.token, cookieSecure));
        json(response, 200, { user: login.user });
        return;
      }
      if (method === "GET" && url.pathname === "/api/auth/me") {
        json(response, 200, {
          user: await repository.sessionUser(sessionToken(request)),
        });
        return;
      }
      if (method === "POST" && url.pathname === "/api/auth/logout") {
        await repository.logout(sessionToken(request));
        response
          .writeHead(204, {
            "set-cookie": cookie("", cookieSecure, true),
            "cache-control": "no-store",
          })
          .end();
        return;
      }
      if (
        url.pathname === "/api/tasks" ||
        url.pathname.startsWith("/api/tasks/")
      ) {
        const user = await repository.sessionUser(sessionToken(request));
        if (!user) throw new ApplicationError(401, "请先登录");
        if (url.pathname === "/api/tasks") {
          if (method === "GET") {
            const page = Number(url.searchParams.get("page") ?? 1),
              pageSize = Number(url.searchParams.get("pageSize") ?? 20);
            if (
              !Number.isSafeInteger(page) ||
              page < 1 ||
              !Number.isSafeInteger(pageSize) ||
              pageSize < 1 ||
              pageSize > 100
            )
              throw new ApplicationError(400, "分页参数无效");
            json(
              response,
              200,
              await repository.listTasks(user.id, page, pageSize),
            );
            return;
          }
          if (method === "POST") {
            const input = applicationCreateTaskSchema.safeParse(
              await readBody(request),
            );
            if (!input.success)
              throw new ApplicationError(400, "请求或幂等键无效");
            json(
              response,
              202,
              await repository.createTask(user.id, input.data),
            );
            return;
          }
        }
        const match = /^\/api\/tasks\/([^/]+)(\/runs)?$/.exec(url.pathname);
        if (match) {
          const id = decodeURIComponent(match[1]!);
          if (method === "GET" && !match[2]) {
            json(response, 200, await repository.getTask(user.id, id));
            return;
          }
          if (method === "POST" && match[2]) {
            const input = applicationCreateTaskSchema.safeParse(
              await readBody(request),
            );
            if (!input.success)
              throw new ApplicationError(400, "请求或幂等键无效");
            json(
              response,
              202,
              await repository.modifyTask(user.id, id, input.data),
            );
            return;
          }
        }
      }
      if (
        url.pathname !== "/api" &&
        !url.pathname.startsWith("/api/") &&
        (await frontend(request, response))
      )
        return;
      json(response, 404, { error: "接口不存在" });
    } catch (error) {
      if (error instanceof ApplicationError) {
        json(response, error.status, { error: error.message });
        return;
      }
      // Database/model exception details can contain credentials or generated source.
      json(response, 503, { error: "服务暂时不可用，请稍后重试" });
    }
  });
}
