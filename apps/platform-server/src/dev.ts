import { createServer as createViteServer, type ViteDevServer } from "vite";
import { extname, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "./server.js";
import { createApplicationResources } from "./bootstrap.js";
import { webRoot } from "./frontend.js";

/** Vite and the API share one origin and HTTP server, including HMR websockets. */
export async function startDevelopmentServer(
  port = Number(process.env.PORT ?? 8787),
) {
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("PORT must be an integer between 0 and 65535");
  const repository = await createApplicationResources();
  let vite: ViteDevServer | undefined;
  const server = createServer({
    repository,
    frontend: (request, response) =>
      new Promise((complete, reject) => {
        if (!vite) {
          reject(new Error("Vite has not initialized"));
          return;
        }
        const cleanup = () => {
          response.off("finish", onComplete);
          response.off("close", onComplete);
        };
        const onComplete = () => {
          cleanup();
          complete(true);
        };
        response.once("finish", onComplete);
        response.once("close", onComplete);
        vite.middlewares(request, response, (error?: unknown) => {
          cleanup();
          if (error) {
            reject(error);
            return;
          }
          const pathname = new URL(request.url ?? "/", "http://localhost")
            .pathname;
          if (
            (request.method !== "GET" && request.method !== "HEAD") ||
            pathname.startsWith("/assets/") ||
            pathname.startsWith("/src/") ||
            (extname(pathname) && pathname !== "/index.html")
          ) {
            complete(false);
            return;
          }
          // Custom fallback prevents Vite from turning missing assets into a 200 HTML response.
          void (async () => {
            const source = await readFile(
              resolve(webRoot, "index.html"),
              "utf8",
            );
            const html = await vite!.transformIndexHtml(
              request.url ?? "/",
              source,
            );
            response.writeHead(200, {
              "content-type": "text/html; charset=utf-8",
              "cache-control": "no-cache",
              "content-length": Buffer.byteLength(html),
            });
            response.end(request.method === "HEAD" ? undefined : html);
            complete(true);
          })().catch(reject);
        });
      }),
  });
  try {
    vite = await createViteServer({
      root: webRoot,
      configFile: resolve(webRoot, "vite.config.ts"),
      server: { middlewareMode: true, hmr: { server } },
      appType: "custom",
    });
    await new Promise<void>((complete, reject) => {
      server.once("error", reject);
      server.listen(port, process.env.HOST ?? "127.0.0.1", () => {
        server.off("error", reject);
        complete();
      });
    });
  } catch (error) {
    await vite?.close();
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((complete) => server.close(() => complete()));
    await repository.close();
    throw error;
  }
  const close = async () => {
    await vite?.close();
    server.closeAllConnections();
    await new Promise<void>((complete, reject) =>
      server.close((error) => (error ? reject(error) : complete())),
    );
    await repository.close();
  };
  return { server, close };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    const development = await startDevelopmentServer();
    const address = development.server.address();
    console.log(
      `platform-server development listening on http://127.0.0.1:${address && typeof address !== "string" ? address.port : "unknown"}`,
    );
    let closing = false;
    const stop = async () => {
      if (closing) return;
      closing = true;
      try {
        await development.close();
      } catch {
        console.error("Failed to close platform-server development resources");
        process.exitCode = 1;
      }
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  } catch {
    console.error(
      "Development startup failed: check DATABASE_URL, connectivity and Vite configuration",
    );
    process.exitCode = 1;
  }
}
