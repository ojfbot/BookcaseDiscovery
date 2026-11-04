import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
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

type WorkerWaitReason =
  | Exclude<RemoteWorkerResult, "completed">
  | "paused"
  | "policy-error"
  | "request-error";

export type RemoteWorkerEvent = { type: "completed" } | { type: WorkerWaitReason; delayMs: number };

export interface ResidentWorkerOptions extends RemoteWorkerOptions {
  /** Stop claiming and let any claim already in progress finish under its lease. */
  signal: AbortSignal;
  /** Checked before each claim. A denial or failure leaves the queue untouched. */
  canClaim?: () => boolean | Promise<boolean>;
  pollMs?: number;
  maxBackoffMs?: number;
  /** Status codes and delays only. Job data and request errors stay local. */
  onEvent?: (event: RemoteWorkerEvent) => void;
}

async function checkPolicy(
  canClaim: NonNullable<ResidentWorkerOptions["canClaim"]>,
  signal: AbortSignal,
) {
  let onAbort!: () => void;
  const stopped = new Promise<boolean>((resolve) => {
    onAbort = () => resolve(false);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([stopped, canClaim()]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function pollOnce(client: FleetClient, options: ResidentWorkerOptions) {
  if (options.canClaim) {
    let allowed: boolean;
    try {
      allowed = await checkPolicy(options.canClaim, options.signal);
    } catch {
      return options.signal.aborted ? undefined : ("policy-error" as const);
    }
    if (options.signal.aborted) return;
    if (allowed !== true) return "paused" as const;
  }
  return workOnce(client, options).catch(() => "request-error" as const);
}

/** Keep one attempt at a time in flight, with abortable waits between attempts. */
export async function runWorker(
  client: FleetClient,
  options: ResidentWorkerOptions,
): Promise<void> {
  const { signal, onEvent, pollMs = 5_000, maxBackoffMs = Math.max(60_000, pollMs) } = options;
  if (
    !Number.isSafeInteger(pollMs) ||
    pollMs < 1 ||
    !Number.isSafeInteger(maxBackoffMs) ||
    maxBackoffMs < pollMs ||
    maxBackoffMs > 2_147_483_647
  )
    throw new RangeError("invalid worker polling interval");

  let backoffMs = pollMs;
  while (!signal.aborted) {
    const result = await pollOnce(client, options);
    if (result === undefined) return;
    if (result === "completed") {
      onEvent?.({ type: result });
      backoffMs = pollMs;
      continue;
    }
    const waitingForWork = result === "idle" || result === "paused";
    if (waitingForWork) backoffMs = pollMs;
    const delayMs = backoffMs;
    onEvent?.({ type: result, delayMs });
    if (signal.aborted) return;
    backoffMs = waitingForWork ? pollMs : Math.min(maxBackoffMs, delayMs * 2);
    await delay(delayMs, undefined, { signal }).catch((error: unknown) => {
      if (!signal.aborted) throw error;
    });
  }
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
