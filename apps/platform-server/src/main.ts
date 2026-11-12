import { createServer } from "./server.js";
import { createApplicationResources } from "./bootstrap.js";

try {
  const repository = await createApplicationResources();
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? "127.0.0.1";
  const server = createServer({ repository });
  server.on("error", () => {
    console.error("API failed to listen");
    void repository.close();
    process.exitCode = 1;
  });
  server.listen(port, host, () =>
    console.log(`Application API listening on http://${host}:${port}`),
  );
  let closing = false;
  const stop = () => {
    if (closing) return;
    closing = true;
    server.closeAllConnections();
    server.close(() => {
      void repository.close();
    });
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
} catch {
  console.error(
    "API startup failed: check DATABASE_URL, database connectivity and migrations",
  );
  process.exitCode = 1;
}
