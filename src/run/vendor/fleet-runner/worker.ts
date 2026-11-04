import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { ID } from "./auth.ts";
import type { FleetClient } from "./client.ts";
import type { JobHandler, JobOutput } from "./jobs.js";

export type RemoteWorkerResult = "idle" | "completed" | "failed" | "lease-lost";

export interface RemoteWorkerOptions {
  caps: readonly string[];
  handlers: Readonly<Record<string, JobHandler>>;
  outDir: string;
  heartbeatMs?: number;
}

/** Pull and execute one job. The operator can invoke this again when there is more work. */
export async function workOnce(
  client: FleetClient,
  options: RemoteWorkerOptions,
): Promise<RemoteWorkerResult> {
  const job = await client.claim(options.caps, Object.keys(options.handlers));
  if (!job) return "idle";
  const lost = new AbortController();
  let pending: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (pending || lost.signal.aborted) return;
    pending = client
      .heartbeat(job)
      .then(
        (held) => {
          if (!held) lost.abort();
        },
        () => lost.abort(),
      )
      .finally(() => {
        pending = undefined;
      });
  }, options.heartbeatMs ?? 60_000);

  let file: string | undefined;
  try {
    let output: JobOutput;
    let bytes: Buffer;
    try {
      output = await options.handlers[job.kind]!(job, {
        signal: lost.signal,
        outDir: options.outDir,
      });
      if (output.file !== `${job.key}.${job.fence}.jsonl`)
        throw new Error("unexpected output file");
      file = join(options.outDir, output.file);
      bytes = await readFile(file);
    } catch (error) {
      if (lost.signal.aborted) return "lease-lost";
      const known =
        error instanceof Error &&
        error.name === "JobError" &&
        "code" in error &&
        typeof error.code === "string" &&
        ID.test(error.code);
      const code = known ? (error.code as string) : "handler-error";
      const retryable = !known || !("retryable" in error) || error.retryable !== false;
      return (await client.fail(job, code, retryable)) ? "failed" : "lease-lost";
    }
    if (lost.signal.aborted) return "lease-lost";
    // Completing the same attempt with the same bytes is idempotent if the response is lost.
    const completed = await client
      .complete(job, bytes, output.sha256)
      .catch(() => client.complete(job, bytes, output.sha256));
    return completed ? "completed" : "lease-lost";
  } finally {
    clearInterval(timer);
    await pending;
    if (file) await unlink(file).catch(() => {});
  }
}
