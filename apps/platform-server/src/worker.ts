import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type {
  ApplicationRepository,
  ClaimedRun,
  CompletedSnapshot,
} from "@atoms-builder/persistence";
import { createApplicationResources } from "./bootstrap.js";
import { executeApplicationRun } from "./workflow.js";
import { runFailureDetails } from "./run-failure.js";

export async function processClaimedRun(
  repository: ApplicationRepository,
  run: ClaimedRun,
  leaseSeconds = 60,
  execute: (
    run: ClaimedRun,
  ) => Promise<CompletedSnapshot> = executeApplicationRun,
): Promise<void> {
  let lostLease = false;
  const heartbeat = setInterval(
    () => {
      void repository.renewLease(run.id, run.owner, leaseSeconds).then(
        (active) => {
          if (!active) lostLease = true;
        },
        () => {
          lostLease = true;
        },
      );
    },
    Math.max(500, Math.floor((leaseSeconds * 1000) / 3)),
  );
  try {
    const snapshot = await execute(run);
    if (!lostLease) await repository.finishRun(run, snapshot);
  } catch (error) {
    const failure = runFailureDetails(error);
    console.error(
      JSON.stringify({
        event: "application.run.failed",
        runId: run.id,
        code: failure.code,
        attempts: failure.attempts,
      }),
    );
    if (!lostLease) await repository.failRun(run, failure.message);
  } finally {
    clearInterval(heartbeat);
  }
  if (lostLease) throw new Error("Worker lost its database lease");
}

export async function startWorker(): Promise<void> {
  const repository = await createApplicationResources();
  const owner = randomUUID();
  const leaseSeconds = Number(process.env.WORKER_LEASE_SECONDS ?? 60);
  const pollMs = Number(process.env.WORKER_POLL_MS ?? 1000);
  if (
    !Number.isInteger(leaseSeconds) ||
    leaseSeconds < 3 ||
    !Number.isInteger(pollMs) ||
    pollMs < 50
  ) {
    await repository.close();
    throw new Error("Invalid worker timing configuration");
  }
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  console.log("Application worker connected to PostgreSQL queue");
  try {
    while (!stopping) {
      await repository.recoverExpiredLeases();
      const run = await repository.claimRun(owner, leaseSeconds);
      if (run) await processClaimedRun(repository, run, leaseSeconds);
      else await new Promise<void>((complete) => setTimeout(complete, pollMs));
    }
  } finally {
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
    await repository.close();
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    await startWorker();
  } catch {
    console.error(
      "Worker stopped: check database connectivity and lease health",
    );
    process.exitCode = 1;
  }
}
