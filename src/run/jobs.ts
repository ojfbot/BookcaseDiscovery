// Interim job queue (card N-1, docs/ops/compute-fleet.md §5): cache-keyed compute jobs, claimed by
// workers under a lease and a fencing token. Workload-local and swappable: core's fleet-runner takes
// it over (card N-3), so callers use `JobStore`'s methods and never its tables.
//
// `jobs` holds current state; `job_events` is append-only (UPDATE and DELETE refused by trigger) and
// is what the morning report reads. Neither ever holds reader text or image content: payloads may
// name private paths, so the CLI never prints them, and outputs are recorded by content hash.
import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const JOBS_SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE jobs (
  key           TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  payload       TEXT NOT NULL CHECK (json_valid(payload)),
  requires      TEXT NOT NULL CHECK (json_valid(requires)),
  priority      INTEGER NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('ready', 'claimed', 'done', 'failed')),
  attempts      INTEGER NOT NULL,
  max_attempts  INTEGER NOT NULL,
  fence         INTEGER NOT NULL,
  worker        TEXT,
  lease_expires INTEGER,
  output        TEXT,
  error         TEXT,
  created       INTEGER NOT NULL,
  updated       INTEGER NOT NULL
);
CREATE INDEX jobs_ready ON jobs (status, priority DESC, created);
CREATE TABLE job_events (
  seq    INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     INTEGER NOT NULL,
  key    TEXT NOT NULL,
  type   TEXT NOT NULL,
  worker TEXT,
  fence  INTEGER,
  detail TEXT
);
CREATE TRIGGER job_events_no_update BEFORE UPDATE ON job_events
BEGIN SELECT RAISE(ABORT, 'job_events is append-only: UPDATE refused'); END;
CREATE TRIGGER job_events_no_delete BEFORE DELETE ON job_events
BEGIN SELECT RAISE(ABORT, 'job_events is append-only: DELETE refused'); END;
`;

export type JobStatus = "ready" | "claimed" | "done" | "failed";
export type JobEventType =
  | "enqueued"
  | "claimed"
  | "completed"
  | "rejected-stale"
  | "failed"
  | "retry"
  | "released"
  | "lease-expired";

/** What a client admits. The key is derived from everything that determines the output. */
export interface JobSpec {
  kind: string;
  /** Content hashes of the inputs (working-copy sha256, a commit, a cache file's hash). Order is significant. */
  inputs: string[];
  params?: Record<string, unknown>;
  model?: { id: string; revision: string };
  /** Code commit or helper version. */
  code?: string;
  /** What the handler needs to run the job. May name private paths: never printed or committed. */
  payload: unknown;
  /** Worker capabilities the job needs, e.g. `apple-vision`, `mps`, `mlx`. */
  requires?: string[];
  priority?: number;
  maxAttempts?: number;
}

export interface Claim {
  key: string;
  kind: string;
  payload: unknown;
  fence: number;
  leaseExpires: number;
}

export interface JobRow {
  key: string;
  kind: string;
  status: JobStatus;
  attempts: number;
  fence: number;
  worker: string | null;
  output: string | null;
  error: string | null;
}

/** Stable JSON: object keys sorted at every level, so equal specs hash equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The job key (CONTEXT.md): the payload is excluded, because it says *where* inputs are, not *what* they are. */
export function jobKey(spec: Pick<JobSpec, "kind" | "inputs"> & Partial<JobSpec>): string {
  const basis = { kind: spec.kind, inputs: spec.inputs, params: spec.params ?? {}, model: spec.model ?? null, code: spec.code ?? null };
  return createHash("sha256").update(canonicalJson(basis)).digest("hex");
}

/** Write `data` to `<dir>/<key>.<ext>` via a temporary file and rename, so a crash leaves no partial output. */
export function writeOutput(dir: string, key: string, data: string, ext = "jsonl"): string {
  mkdirSync(dir, { recursive: true });
  const final = join(dir, `${key}.${ext}`);
  const tmp = `${final}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, final);
  return createHash("sha256").update(data).digest("hex");
}

export interface JobStoreOptions {
  /** Clock in epoch ms; tests pass a fake one. */
  now?: () => number;
  /** Lease length. Default 5 min, the same as core's agent lease: a crashed or sleeping worker frees its job quickly. */
  leaseMs?: number;
}

export interface JobReport {
  since: number;
  byKind: Record<string, Record<JobStatus, number>>;
  events: Partial<Record<JobEventType, number>>;
  byWorker: Record<string, { completed: number; failed: number; staleRejected: number; machineSeconds: number }>;
  failures: { kind: string; error: string; count: number }[];
  oldestReadyAgeSeconds: number | null;
}

export class JobStore {
  readonly #db: DatabaseSync;
  readonly #now: () => number;
  readonly #leaseMs: number;

  constructor(path: string, options: JobStoreOptions = {}) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#now = options.now ?? Date.now;
    this.#leaseMs = options.leaseMs ?? 5 * 60_000;
    this.#db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    const version = (this.#db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (version === 0) {
      this.#db.exec(SCHEMA);
      this.#db.exec(`PRAGMA user_version = ${JOBS_SCHEMA_VERSION}`);
    } else if (version !== JOBS_SCHEMA_VERSION) {
      throw new Error(`job table schema ${version}, expected ${JOBS_SCHEMA_VERSION}`);
    }
  }

  close(): void {
    this.#db.close();
  }

  /** Admit a job. Idempotent: an existing key (in any state) is left alone and reported as not created. */
  enqueue(spec: JobSpec): { key: string; created: boolean } {
    const key = jobKey(spec);
    const now = this.#now();
    return this.#tx(() => {
      const res = this.#db
        .prepare(
          `INSERT OR IGNORE INTO jobs (key, kind, payload, requires, priority, status, attempts, max_attempts, fence, created, updated)
           VALUES (?, ?, ?, ?, ?, 'ready', 0, ?, 0, ?, ?)`,
        )
        .run(key, spec.kind, JSON.stringify(spec.payload ?? null), JSON.stringify(spec.requires ?? []), spec.priority ?? 0, spec.maxAttempts ?? 3, now, now);
      const created = Number(res.changes) === 1;
      if (created) this.#event(key, "enqueued", null, 0);
      return { key, created };
    });
  }

  /**
   * Claim the highest-priority ready job this worker can run, after sweeping expired leases. A job is
   * runnable when the worker has every capability it requires and, if `kinds` is given, a handler for its kind.
   */
  claim(worker: string, caps: readonly string[], kinds?: readonly string[]): Claim | undefined {
    const have = new Set(caps);
    const handled = kinds ? new Set(kinds) : undefined;
    return this.#tx(() => {
      this.#sweep();
      const rows = this.#db
        .prepare("SELECT key, kind, payload, requires, fence FROM jobs WHERE status = 'ready' ORDER BY priority DESC, created, key")
        .all() as { key: string; kind: string; payload: string; requires: string; fence: number }[];
      const row = rows.find((r) => (!handled || handled.has(r.kind)) && (JSON.parse(r.requires) as string[]).every((c) => have.has(c)));
      if (!row) return undefined;
      const now = this.#now();
      const fence = row.fence + 1;
      const leaseExpires = now + this.#leaseMs;
      this.#db
        .prepare("UPDATE jobs SET status = 'claimed', fence = ?, worker = ?, lease_expires = ?, attempts = attempts + 1, updated = ? WHERE key = ?")
        .run(fence, worker, leaseExpires, now, row.key);
      this.#event(row.key, "claimed", worker, fence);
      return { key: row.key, kind: row.kind, payload: JSON.parse(row.payload), fence, leaseExpires };
    });
  }

  /** Extend the lease. False means the worker no longer holds the job and must stop. */
  heartbeat(key: string, fence: number, worker: string): boolean {
    const now = this.#now();
    const res = this.#db
      .prepare("UPDATE jobs SET lease_expires = ?, updated = ? WHERE key = ? AND status = 'claimed' AND fence = ? AND worker = ? AND lease_expires > ?")
      .run(now + this.#leaseMs, now, key, fence, worker, now);
    return Number(res.changes) === 1;
  }

  /** Record success. Rejected (and recorded) unless the worker still holds the job under the same fencing token. */
  complete(key: string, fence: number, worker: string, output: string): boolean {
    return this.#tx(() => {
      const now = this.#now();
      const res = this.#db
        .prepare("UPDATE jobs SET status = 'done', output = ?, error = NULL, lease_expires = NULL, updated = ? WHERE key = ? AND status = 'claimed' AND fence = ? AND worker = ? AND lease_expires > ?")
        .run(output, now, key, fence, worker, now);
      const ok = Number(res.changes) === 1;
      this.#event(key, ok ? "completed" : "rejected-stale", worker, fence);
      return ok;
    });
  }

  /** Record a failure by error code. Retryable failures go back to ready until `max_attempts`. */
  fail(key: string, fence: number, worker: string, code: string, retryable: boolean): boolean {
    return this.#tx(() => {
      const row = this.#held(key, fence, worker);
      if (!row) {
        this.#event(key, "rejected-stale", worker, fence, code);
        return false;
      }
      const again = retryable && row.attempts < row.max_attempts;
      this.#db
        .prepare("UPDATE jobs SET status = ?, error = ?, worker = NULL, lease_expires = NULL, updated = ? WHERE key = ?")
        .run(again ? "ready" : "failed", code, this.#now(), key);
      this.#event(key, again ? "retry" : "failed", worker, fence, code);
      return true;
    });
  }

  /** Give a job back without spending an attempt: an interruption (user activity, shutdown) is not a failure. */
  release(key: string, fence: number, worker: string): boolean {
    return this.#tx(() => {
      if (!this.#held(key, fence, worker)) return false;
      this.#db
        .prepare("UPDATE jobs SET status = 'ready', attempts = attempts - 1, worker = NULL, lease_expires = NULL, updated = ? WHERE key = ?")
        .run(this.#now(), key);
      this.#event(key, "released", worker, fence);
      return true;
    });
  }

  /** Return expired leases to the queue (or fail them when out of attempts). Returns how many. */
  sweep(): number {
    return this.#tx(() => this.#sweep());
  }

  get(key: string): JobRow | undefined {
    return this.#db.prepare("SELECT key, kind, status, attempts, fence, worker, output, error FROM jobs WHERE key = ?").get(key) as JobRow | undefined;
  }

  /** The morning report: aggregates only (kinds, hosts, counts, error codes). */
  report(since = 0): JobReport {
    const byKind: JobReport["byKind"] = {};
    for (const r of this.#db.prepare("SELECT kind, status, COUNT(*) AS n FROM jobs GROUP BY kind, status").all() as { kind: string; status: JobStatus; n: number }[]) {
      byKind[r.kind] ??= { ready: 0, claimed: 0, done: 0, failed: 0 };
      byKind[r.kind]![r.status] = r.n;
    }
    const events: JobReport["events"] = {};
    const byWorker: JobReport["byWorker"] = {};
    const claimedAt = new Map<string, number>();
    const rows = this.#db.prepare("SELECT ts, key, type, worker, fence FROM job_events WHERE ts >= ? ORDER BY seq").all(since) as {
      ts: number;
      key: string;
      type: JobEventType;
      worker: string | null;
      fence: number | null;
    }[];
    for (const e of rows) {
      events[e.type] = (events[e.type] ?? 0) + 1;
      if (!e.worker) continue;
      const w = (byWorker[e.worker] ??= { completed: 0, failed: 0, staleRejected: 0, machineSeconds: 0 });
      const attempt = `${e.key}#${e.fence}`;
      if (e.type === "claimed") claimedAt.set(attempt, e.ts);
      if (e.type === "completed" || e.type === "failed" || e.type === "retry") {
        if (e.type === "completed") w.completed += 1;
        else w.failed += 1;
        const start = claimedAt.get(attempt);
        if (start !== undefined) w.machineSeconds += (e.ts - start) / 1000;
      }
      if (e.type === "rejected-stale") w.staleRejected += 1;
    }
    const failures = this.#db
      .prepare("SELECT kind, error, COUNT(*) AS count FROM jobs WHERE status = 'failed' GROUP BY kind, error ORDER BY count DESC")
      .all() as { kind: string; error: string; count: number }[];
    const oldest = this.#db.prepare("SELECT MIN(created) AS t FROM jobs WHERE status = 'ready'").get() as { t: number | null };
    return {
      since,
      byKind,
      events,
      byWorker,
      failures,
      oldestReadyAgeSeconds: oldest.t === null ? null : Math.round((this.#now() - oldest.t) / 1000),
    };
  }

  #held(key: string, fence: number, worker: string): { attempts: number; max_attempts: number } | undefined {
    return this.#db
      .prepare("SELECT attempts, max_attempts FROM jobs WHERE key = ? AND status = 'claimed' AND fence = ? AND worker = ? AND lease_expires > ?")
      .get(key, fence, worker, this.#now()) as { attempts: number; max_attempts: number } | undefined;
  }

  #sweep(): number {
    const now = this.#now();
    const expired = this.#db
      .prepare("SELECT key, worker, fence, attempts, max_attempts FROM jobs WHERE status = 'claimed' AND lease_expires <= ?")
      .all(now) as { key: string; worker: string; fence: number; attempts: number; max_attempts: number }[];
    for (const r of expired) {
      const again = r.attempts < r.max_attempts;
      this.#db
        .prepare("UPDATE jobs SET status = ?, error = ?, worker = NULL, lease_expires = NULL, updated = ? WHERE key = ?")
        .run(again ? "ready" : "failed", again ? null : "lease-expired", now, r.key);
      this.#event(r.key, "lease-expired", r.worker, r.fence);
    }
    return expired.length;
  }

  #event(key: string, type: JobEventType, worker: string | null, fence: number, detail?: string): void {
    this.#db.prepare("INSERT INTO job_events (ts, key, type, worker, fence, detail) VALUES (?, ?, ?, ?, ?, ?)").run(this.#now(), key, type, worker, fence, detail ?? null);
  }

  #tx<T>(fn: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.#db.exec("COMMIT");
      return out;
    } catch (e) {
      this.#db.exec("ROLLBACK");
      throw e;
    }
  }
}

/** Runs one job; resolves to the output's content hash. Must stop promptly when `signal` aborts. */
export type JobHandler = (job: Claim, ctx: { signal: AbortSignal; outDir: string }) => Promise<string>;

/** A handler failure with an error code (never message text that could carry reader output). */
export class JobError extends Error {
  override readonly name = "JobError";
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, retryable: boolean) {
    super(code);
    this.code = code;
    this.retryable = retryable;
  }
}

export interface WorkerOptions {
  worker: string;
  caps: readonly string[];
  handlers: Readonly<Record<string, JobHandler>>;
  outDir: string;
  /** Default: a third of the store's lease. */
  heartbeatMs?: number;
  /** Stop after this many jobs. Default: until the queue has nothing this worker can run. */
  maxJobs?: number;
  /** Aborting releases the current job (an interruption, not a failure) and stops the loop. */
  signal?: AbortSignal;
  log?: (line: string) => void;
}

export interface WorkerSummary {
  completed: number;
  failed: number;
  staleRejected: number;
  released: number;
}

/** Claim and run jobs one at a time until the queue is empty for this worker, `maxJobs` is reached, or `signal` aborts. */
export async function runWorker(store: JobStore, options: WorkerOptions): Promise<WorkerSummary> {
  const summary: WorkerSummary = { completed: 0, failed: 0, staleRejected: 0, released: 0 };
  const log = options.log ?? (() => {});
  const kinds = Object.keys(options.handlers);
  while (!options.signal?.aborted && (options.maxJobs === undefined || summary.completed + summary.failed + summary.staleRejected < options.maxJobs)) {
    const job = store.claim(options.worker, options.caps, kinds);
    if (!job) break;
    const handler = options.handlers[job.kind]!;
    const lost = new AbortController();
    const signal = options.signal ? AbortSignal.any([lost.signal, options.signal]) : lost.signal;
    const beat = setInterval(() => {
      if (!store.heartbeat(job.key, job.fence, options.worker)) lost.abort();
    }, options.heartbeatMs ?? 60_000);
    const t0 = Date.now();
    try {
      const output = await handler(job, { signal, outDir: options.outDir });
      if (options.signal?.aborted && !lost.signal.aborted) {
        store.release(job.key, job.fence, options.worker);
        summary.released += 1;
      } else if (store.complete(job.key, job.fence, options.worker, output)) {
        summary.completed += 1;
        log(`jobs: ${job.kind} ${job.key.slice(0, 12)} done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      } else {
        summary.staleRejected += 1;
        log(`jobs: ${job.kind} ${job.key.slice(0, 12)} completion rejected: lease lost`);
      }
    } catch (e) {
      if (options.signal?.aborted && !lost.signal.aborted) {
        store.release(job.key, job.fence, options.worker);
        summary.released += 1;
      } else {
        const code = e instanceof JobError ? e.code : "handler-error";
        const retryable = e instanceof JobError ? e.retryable : true;
        if (store.fail(job.key, job.fence, options.worker, code, retryable)) summary.failed += 1;
        else summary.staleRejected += 1;
        log(`jobs: ${job.kind} ${job.key.slice(0, 12)} failed: ${code}`);
      }
    } finally {
      clearInterval(beat);
    }
  }
  return summary;
}
