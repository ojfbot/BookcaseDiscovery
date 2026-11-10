import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ID } from "./auth.ts";
import { FleetHttpError, type FleetClient } from "./client.ts";
import { errorCode } from "./diagnostics.ts";
import type { JobHandler, JobOutput } from "./jobs.js";

export type RemoteWorkerResult = "idle" | "completed" | "failed" | "lease-lost" | "released";

export interface RemoteWorkerOptions {
  caps: readonly string[];
  handlers: Readonly<Record<string, JobHandler>>;
  outDir: string;
  heartbeatMs?: number;
  /** Cancels the handler and releases its attempt; resident workers use a bounded drain. */
  signal?: AbortSignal;
  retryMs?: number;
  /** Injectable only for deterministic clock/fault tests. */
  now?: () => number;
}

type WorkerWaitReason = Exclude<RemoteWorkerResult, "completed"> | "paused" | "policy-error";

export type RemoteWorkerEvent =
  | { type: "completed" }
  | { type: WorkerWaitReason; delayMs: number }
  | { type: "request-error"; delayMs: number; code: string };

export interface ResidentWorkerOptions extends RemoteWorkerOptions {
  /** Stop claiming, drain within shutdownGraceMs, then cancel and release. */
  signal: AbortSignal;
  /** Checked before each claim. A denial or failure leaves the queue untouched. */
  canClaim?: () => boolean | Promise<boolean>;
  pollMs?: number;
  maxBackoffMs?: number;
  shutdownGraceMs?: number;
  /** Adds up to this fraction to polling delays; set zero for deterministic tests. */
  jitterRatio?: number;
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
  const cancellation = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    timer = setTimeout(() => cancellation.abort(), options.shutdownGraceMs ?? 30_000);
  };
  options.signal.addEventListener("abort", stop, { once: true });
  if (options.signal.aborted) stop();
  try {
    return await workOnce(client, { ...options, signal: cancellation.signal });
  } catch (error) {
    return { type: "request-error" as const, code: errorCode(error) };
  } finally {
    if (timer) clearTimeout(timer);
    options.signal.removeEventListener("abort", stop);
  }
}

/** Keep one attempt at a time in flight, with abortable waits between attempts. */
export async function runWorker(
  client: FleetClient,
  options: ResidentWorkerOptions,
): Promise<void> {
  const {
    signal,
    onEvent,
    pollMs = 5_000,
    maxBackoffMs = Math.max(60_000, pollMs),
    shutdownGraceMs = 30_000,
    jitterRatio = 0.1,
  } = options;
  const emit = (event: RemoteWorkerEvent) => {
    try {
      onEvent?.(event);
    } catch {
      /* Observers cannot kill execution. */
    }
  };
  if (
    !Number.isSafeInteger(pollMs) ||
    pollMs < 1 ||
    !Number.isSafeInteger(maxBackoffMs) ||
    maxBackoffMs < pollMs ||
    maxBackoffMs > 2_147_483_647 ||
    !Number.isSafeInteger(shutdownGraceMs) ||
    shutdownGraceMs < 0 ||
    shutdownGraceMs > 2_147_483_647 ||
    !Number.isFinite(jitterRatio) ||
    jitterRatio < 0 ||
    jitterRatio > 1
  )
    throw new RangeError("invalid worker polling interval");

  let backoffMs = pollMs;
  while (!signal.aborted) {
    const result = await pollOnce(client, options);
    if (result === undefined) return;
    if (result === "completed") {
      emit({ type: result });
      backoffMs = pollMs;
      continue;
    }
    const waitingForWork = result === "idle" || result === "paused";
    if (waitingForWork) backoffMs = pollMs;
    const delayMs = Math.min(
      maxBackoffMs,
      Math.floor(backoffMs * (1 + Math.random() * jitterRatio)),
    );
    if (typeof result === "object") emit({ ...result, delayMs });
    else emit({ type: result, delayMs });
    if (signal.aborted) return;
    backoffMs = waitingForWork ? pollMs : Math.min(maxBackoffMs, delayMs * 2);
    await delay(delayMs, undefined, { signal }).catch((error: unknown) => {
      if (!signal.aborted) throw error;
    });
  }
}

/** Pull and execute one job. Keep uncertain output locally until a terminal acknowledgement. */
export async function workOnce(
  client: FleetClient,
  options: RemoteWorkerOptions,
): Promise<RemoteWorkerResult> {
  const now = options.now ?? Date.now;
  const retryMs = options.retryMs ?? 1_000;
  if (
    !Number.isSafeInteger(retryMs) ||
    retryMs < 1 ||
    retryMs > 2_147_483_647 ||
    (options.heartbeatMs !== undefined &&
      (!Number.isSafeInteger(options.heartbeatMs) ||
        options.heartbeatMs < 1 ||
        options.heartbeatMs > 2_147_483_647))
  ) {
    throw new RangeError("invalid worker retry interval");
  }
  if (options.signal?.aborted) return "released";
  const claimStarted = now();
  const job = await client.claim(options.caps, Object.keys(options.handlers));
  if (!job) return "idle";
  const lost = new AbortController();
  const signal = options.signal ? AbortSignal.any([lost.signal, options.signal]) : lost.signal;
  const leaseMs = Math.max(1, job.leaseExpires - claimStarted);
  const marginMs = Math.min(1_000, Math.max(1, Math.floor(leaseMs / 10)));
  const heartbeatMs = Math.min(options.heartbeatMs ?? 60_000, Math.max(1, Math.floor(leaseMs / 3)));
  let validUntil = job.leaseExpires;
  let pending: Promise<void> | undefined;
  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const armExpiry = () => {
    if (stopped) return;
    if (expiryTimer) clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => lost.abort(), Math.max(1, validUntil - now() - marginMs));
  };
  const scheduleHeartbeat = (ms: number) => {
    if (stopped || signal.aborted) return;
    heartbeatTimer = setTimeout(() => {
      const started = now();
      pending = client
        .heartbeat(job)
        .then(
          (held) => {
            if (!held) {
              lost.abort();
              return;
            }
            // Use request start, not response arrival: network delay must not extend local authority.
            validUntil = started + leaseMs;
            armExpiry();
            scheduleHeartbeat(heartbeatMs);
          },
          (error: unknown) => {
            if (error instanceof FleetHttpError && !error.retryable) lost.abort();
            else if (now() >= validUntil - marginMs) lost.abort();
            else scheduleHeartbeat(Math.min(retryMs, Math.max(1, validUntil - now() - marginMs)));
          },
        )
        .finally(() => {
          pending = undefined;
        });
    }, ms);
  };
  armExpiry();
  scheduleHeartbeat(heartbeatMs);
  let file: string | undefined;
  let terminal = false;
  const release = async (): Promise<RemoteWorkerResult> => {
    if (lost.signal.aborted) return "lease-lost";
    terminal = await client.release(job);
    return terminal ? "released" : "lease-lost";
  };
  try {
    if (options.signal?.aborted) return await release();
    let output: JobOutput;
    let bytes: Buffer;
    try {
      output = await options.handlers[job.kind]!(job, { signal, outDir: options.outDir });
      if (output.file !== `${job.key}.${job.fence}.jsonl`)
        throw new Error("unexpected output file");
      file = join(options.outDir, output.file);
      bytes = await readFile(file);
    } catch (error) {
      if (options.signal?.aborted) return await release();
      if (lost.signal.aborted) return "lease-lost";
      const known =
        error instanceof Error &&
        error.name === "JobError" &&
        "code" in error &&
        typeof error.code === "string" &&
        ID.test(error.code);
      const code = known ? (error.code as string) : "handler-error";
      const retryable = !known || !("retryable" in error) || error.retryable !== false;
      terminal = await client.fail(job, code, retryable);
      return terminal ? "failed" : "lease-lost";
    }
    let failures = 0;
    for (;;) {
      if (options.signal?.aborted) return await release();
      if (lost.signal.aborted || now() >= validUntil - marginMs) return "lease-lost";
      try {
        // A lost response may follow a committed result. Retry identical bytes under the same fence.
        const completed = await client.complete(job, bytes, output.sha256);
        terminal = true; // A false result explicitly rejects this attempt.
        return completed ? "completed" : "lease-lost";
      } catch (error) {
        if (error instanceof FleetHttpError && !error.retryable) {
          terminal = await client.fail(job, "output-rejected", false);
          return terminal ? "failed" : "lease-lost";
        }
        if (failures++ === 0) continue;
        await delay(Math.min(retryMs, Math.max(1, validUntil - now() - marginMs)), undefined, {
          signal,
        }).catch((error: unknown) => {
          if (!signal.aborted) throw error;
        });
      }
    }
  } finally {
    stopped = true;
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    if (expiryTimer) clearTimeout(expiryTimer);
    await pending;
    // Retain ambiguous uploads for diagnosis/reconciliation. Never discard them on transport failure.
    if (file && terminal) await unlink(file).catch(() => {});
  }
}
