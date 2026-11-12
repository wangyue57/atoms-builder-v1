import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export type FrontendHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<boolean>;

export const webRoot = fileURLToPath(new URL("../../web/", import.meta.url));
const defaultOutput = fileURLToPath(
  new URL("../../web/dist/", import.meta.url),
);
const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/** Serves only the compiled SPA. API paths never fall back to its HTML shell. */
export function createStaticFrontend(
  outputDirectory = defaultOutput,
): FrontendHandler {
  const root = resolve(outputDirectory);
  return async (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") return false;
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/api" || url.pathname.startsWith("/api/"))
      return false;
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      response.writeHead(400).end();
      return true;
    }
    if (pathname === "/api" || pathname.startsWith("/api/")) return false;
    if (
      pathname.includes("\0") ||
      pathname.includes("\\") ||
      pathname.split("/").some((segment) => segment.startsWith("."))
    ) {
      response.writeHead(403).end();
      return true;
    }
    const target = resolve(root, `.${pathname}`);
    if (!isWithinRoot(root, target)) {
      response.writeHead(403).end();
      return true;
    }
    const extension = extname(pathname);
    if (extension && !(extension in contentTypes)) return false;
    try {
      if ((await stat(target)).isFile()) {
        await sendFile(
          root,
          target,
          request,
          response,
          /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[^.]+$/.test(pathname),
        );
        return true;
      }
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
    // Missing asset URLs must be a 404, never an HTML document with a 200 status.
    if (extname(pathname) || pathname.startsWith("/assets/")) return false;
    try {
      await sendFile(
        root,
        resolve(root, "index.html"),
        request,
        response,
        false,
      );
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      response.writeHead(503, {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(
        "Web assets are not built. Run npm run build:web before starting the production server.",
      );
    }
    return true;
  };
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

function isWithinRoot(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${sep}`);
}

async function sendFile(
  root: string,
  path: string,
  request: IncomingMessage,
  response: ServerResponse,
  immutable: boolean,
): Promise<void> {
  const [canonicalRoot, canonicalPath] = await Promise.all([
    realpath(root),
    realpath(path),
  ]);
  if (!isWithinRoot(canonicalRoot, canonicalPath)) {
    response.writeHead(403).end();
    return;
  }
  const body = await readFile(canonicalPath);
  response.writeHead(200, {
    "content-type": contentTypes[extname(path)] ?? "application/octet-stream",
    "content-length": body.byteLength,
    "cache-control": immutable
      ? "public, max-age=31536000, immutable"
      : "no-cache",
    "x-content-type-options": "nosniff",
  });
  response.end(request.method === "HEAD" ? undefined : body);
}
