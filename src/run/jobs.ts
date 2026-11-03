// Interim job queue (card N-1, docs/ops/compute-fleet.md §5): cache-keyed compute jobs, claimed by
// workers under a lease and a fencing token. Workload-local and swappable: core's fleet-runner takes
// it over (card N-3), so callers use `JobStore`'s methods and never its tables.
//
// `jobs` holds current state; `job_events` is append-only (UPDATE and DELETE refused by trigger) and
// is what the morning report reads. Neither ever holds reader text or image content: payloads may
// name private paths, so the CLI never prints them, and outputs are recorded by content hash.
//
// The fencing token guards the artifact as well as the row: each attempt writes its own immutable file
// (`<key>.<fence>.<ext>`), and only the guarded completion records which file is accepted. A stale worker
// can still write bytes, but never into the file a consumer reads.
import { createHash, randomUUID } from "node:crypto";
import { linkSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const JOBS_SCHEMA_VERSION = 2;

const SCHEMA = `
CREATE TABLE jobs (
  key           TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  inputs        TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(inputs)),
  params        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(params)),
  code          TEXT,
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
  output_file   TEXT,
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

/**
 * v1 → v2: the key's basis travels with the claim (handlers verify it), and the accepted output file is
 * recorded. v1 rows have neither, so a v1 job can neither run under a v2 handler nor serve as a cache hit
 * with a file to read. Every v1 row is retired: a `retired` event records it, the row leaves `jobs`, and
 * the same work admitted again under v2 starts fresh. Their v1 output files stay on disk, unreferenced.
 */
const MIGRATE_1_TO_2 = `
ALTER TABLE jobs ADD COLUMN inputs TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(inputs));
ALTER TABLE jobs ADD COLUMN params TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(params));
ALTER TABLE jobs ADD COLUMN code TEXT;
ALTER TABLE jobs ADD COLUMN output_file TEXT;
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
  | "lease-expired"
  | "retired";

/** What a client admits. The key is derived from everything that determines the output. */
export interface JobSpec {
  kind: string;
  /** Content hashes of the inputs (working-copy sha256, a commit, a cache file's hash). Order is significant. */
  inputs: string[];
  /** Everything else that changes the output (rotations, polygons, tiling). Keyed, so handlers execute these, not the payload. */
  params?: Record<string, unknown>;
  model?: { id: string; revision: string };
  /** Code commit or pinned helper identity. */
  code?: string;
  /** Where the inputs are on this host, and nothing that changes the output. May name private paths: never printed or committed. */
  payload: unknown;
  /** Worker capabilities the job needs, e.g. `apple-vision`, `mps`, `mlx`. */
  requires?: string[];
  priority?: number;
  maxAttempts?: number;
}

export interface Claim {
  key: string;
  kind: string;
  /** The keyed basis, so a handler can verify what it resolved from the payload before running. */
  inputs: string[];
  params: Record<string, unknown>;
  code: string | null;
  payload: unknown;
  fence: number;
  leaseExpires: number;
}

/** One attempt's output: the file name under the worker's output directory and its content hash. */
export interface JobOutput {
  file: string;
  sha256: string;
}

export interface JobRow {
  key: string;
  kind: string;
  status: JobStatus;
  attempts: number;
  fence: number;
  worker: string | null;
  /** The accepted output's content hash. */
  output: string | null;
  /** The accepted output's file name: the one consumers read. Other attempts' files are orphans. */
  outputFile: string | null;
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

/**
 * Write one attempt's output to `<dir>/<key>.<fence>.<ext>`. The file is complete before it appears (written
 * to a temporary file, then hard-linked into place) and is never overwritten: linking fails if the name
 * exists. So a worker that wakes after losing its lease cannot touch the accepted attempt's bytes.
 */
export function writeOutput(dir: string, job: Pick<Claim, "key" | "fence">, data: string, ext = "jsonl"): JobOutput {
  mkdirSync(dir, { recursive: true });
  const file = `${job.key}.${job.fence}.${ext}`;
  const tmp = join(dir, `${file}.${process.pid}.${randomUUID()}.tmp`);
  writeFileSync(tmp, data);
  try {
    linkSync(tmp, join(dir, file));
  } finally {
    unlinkSync(tmp);
  }
  return { file, sha256: createHash("sha256").update(data).digest("hex") };
}

export interface JobStoreOptions {
  /** Clock in epoch ms; tests pass a fake one. */
  now?: () => number;
  /** Lease length. Default 5 min, the same as core's agent lease: a crashed or sleeping worker frees its job quickly. */
  leaseMs?: number;
}

/**
 * The morning report. Two scopes, never mixed: `now` is the table's state when the report runs; `period`
 * counts what happened between `since` and `until`.
 */
export interface JobReport {
  now: {
    at: number;
    byKind: Record<string, Record<JobStatus, number>>;
    /** Jobs that are failed now (any time), by kind and error code. */
    failures: { kind: string; error: string; count: number }[];
    oldestReadyAgeSeconds: number | null;
  };
  period: {
    since: number;
    until: number;
    events: Partial<Record<JobEventType, number>>;
    /**
     * Per worker, attempts that ended in the period by how they ended, plus `machineSeconds`: the time its
     * attempts held a valid lease inside the period. Each attempt counts from its claim to its end or to its
     * lease's actual expiry, whichever is first, clipped to the period at both ends; running attempts included.
     */
    byWorker: Record<string, WorkerPeriod>;
  };
}

export interface WorkerPeriod {
  completed: number;
  failed: number;
  released: number;
  leaseExpired: number;
  staleRejected: number;
  machineSeconds: number;
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
    // Read the version and write the new one in the same write transaction as the schema change, so two
    // processes opening a new or old table at once cannot both create or migrate it, and an interrupted
    // upgrade rolls back whole and is retried on the next open.
    this.#tx(() => {
      const version = (this.#db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
      if (version === JOBS_SCHEMA_VERSION) return;
      if (version === 0) {
        this.#db.exec(SCHEMA);
      } else if (version === 1) {
        this.#db.exec(MIGRATE_1_TO_2);
        const rows = this.#db.prepare("SELECT key, status FROM jobs").all() as { key: string; status: JobStatus }[];
        for (const r of rows) this.#event(r.key, "retired", null, 0, `schema-v1:${r.status}`);
        this.#db.exec("DELETE FROM jobs");
      } else {
        throw new Error(`job table schema ${version}, expected ${JOBS_SCHEMA_VERSION}`);
      }
      this.#db.exec(`PRAGMA user_version = ${JOBS_SCHEMA_VERSION}`);
    });
  }

  close(): void {
    this.#db.close();
  }

  /** Admit a job. Idempotent: an existing key (in any state) is left alone and reported as not created. */
  enqueue(spec: JobSpec): { key: string; created: boolean } {
    const key = jobKey(spec);
    return this.#tx(() => {
      const now = this.#now();
      const res = this.#db
        .prepare(
          `INSERT OR IGNORE INTO jobs (key, kind, inputs, params, code, payload, requires, priority, status, attempts, max_attempts, fence, created, updated)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', 0, ?, 0, ?, ?)`,
        )
        .run(
          key,
          spec.kind,
          JSON.stringify(spec.inputs),
          canonicalJson(spec.params ?? {}),
          spec.code ?? null,
          JSON.stringify(spec.payload ?? null),
          JSON.stringify(spec.requires ?? []),
          spec.priority ?? 0,
          spec.maxAttempts ?? 3,
          now,
          now,
        );
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
        .prepare("SELECT key, kind, inputs, params, code, payload, requires, fence FROM jobs WHERE status = 'ready' ORDER BY priority DESC, created, key")
        .all() as { key: string; kind: string; inputs: string; params: string; code: string | null; payload: string; requires: string; fence: number }[];
      const row = rows.find((r) => (!handled || handled.has(r.kind)) && (JSON.parse(r.requires) as string[]).every((c) => have.has(c)));
      if (!row) return undefined;
      const now = this.#now();
      const fence = row.fence + 1;
      const leaseExpires = now + this.#leaseMs;
      this.#db
        .prepare("UPDATE jobs SET status = 'claimed', fence = ?, worker = ?, lease_expires = ?, attempts = attempts + 1, updated = ? WHERE key = ?")
        .run(fence, worker, leaseExpires, now, row.key);
      this.#event(row.key, "claimed", worker, fence);
      return {
        key: row.key,
        kind: row.kind,
        inputs: JSON.parse(row.inputs) as string[],
        params: JSON.parse(row.params) as Record<string, unknown>,
        code: row.code,
        payload: JSON.parse(row.payload),
        fence,
        leaseExpires,
      };
    });
  }

  /**
   * Extend the lease. False means the worker no longer holds the job and must stop. The clock is read after
   * the write lock is taken: time spent waiting for the lock counts against the lease, never for it.
   */
  heartbeat(key: string, fence: number, worker: string): boolean {
    return this.#tx(() => {
      const now = this.#now();
      const res = this.#db
        .prepare("UPDATE jobs SET lease_expires = ?, updated = ? WHERE key = ? AND status = 'claimed' AND fence = ? AND worker = ? AND lease_expires > ?")
        .run(now + this.#leaseMs, now, key, fence, worker, now);
      return Number(res.changes) === 1;
    });
  }

  /**
   * Record success and make this attempt's file the accepted output. Rejected (and recorded) unless the
   * worker still holds the job under the same fencing token.
   */
  complete(key: string, fence: number, worker: string, output: JobOutput): boolean {
    return this.#tx(() => {
      const now = this.#now();
      const res = this.#db
        .prepare(
          "UPDATE jobs SET status = 'done', output = ?, output_file = ?, error = NULL, lease_expires = NULL, updated = ? WHERE key = ? AND status = 'claimed' AND fence = ? AND worker = ? AND lease_expires > ?",
        )
        .run(output.sha256, output.file, now, key, fence, worker, now);
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
    return this.#db
      .prepare("SELECT key, kind, status, attempts, fence, worker, output, output_file AS outputFile, error FROM jobs WHERE key = ?")
      .get(key) as JobRow | undefined;
  }

  /** The morning report: aggregates only (kinds, workers, counts, error codes). */
  report(since = 0): JobReport {
    const until = this.#now();
    const byKind: JobReport["now"]["byKind"] = {};
    for (const r of this.#db.prepare("SELECT kind, status, COUNT(*) AS n FROM jobs GROUP BY kind, status").all() as { kind: string; status: JobStatus; n: number }[]) {
      byKind[r.kind] ??= { ready: 0, claimed: 0, done: 0, failed: 0 };
      byKind[r.kind]![r.status] = r.n;
    }
    const failures = this.#db
      .prepare("SELECT kind, error, COUNT(*) AS count FROM jobs WHERE status = 'failed' GROUP BY kind, error ORDER BY count DESC")
      .all() as { kind: string; error: string; count: number }[];
    const oldest = this.#db.prepare("SELECT MIN(created) AS t FROM jobs WHERE status = 'ready'").get() as { t: number | null };

    const events: JobReport["period"]["events"] = {};
    const byWorker: JobReport["period"]["byWorker"] = {};
    const forWorker = (w: string): WorkerPeriod =>
      (byWorker[w] ??= { completed: 0, failed: 0, released: 0, leaseExpired: 0, staleRejected: 0, machineSeconds: 0 });
    // Leased time inside the window [since, until], never negative (a future `since` gives zero).
    const leased = (start: number, end: number): number => Math.max(0, Math.min(end, until) - Math.max(start, since)) / 1000;
    // Open attempts (`key#fence` → worker and lease start), seeded from claims before the period whose end,
    // if any, falls inside it: an attempt that crosses `since` counts from `since`.
    const open = new Map<string, { worker: string; start: number }>();
    const rows = this.#db.prepare("SELECT ts, key, type, worker, fence, detail FROM job_events WHERE worker IS NOT NULL ORDER BY seq").all() as {
      ts: number;
      key: string;
      type: JobEventType;
      worker: string;
      fence: number;
      detail: string | null;
    }[];
    const ends: Partial<Record<JobEventType, keyof WorkerPeriod>> = {
      completed: "completed",
      failed: "failed",
      retry: "failed",
      released: "released",
      "lease-expired": "leaseExpired",
    };
    for (const e of rows) {
      const attempt = `${e.key}#${e.fence}`;
      if (e.type === "claimed") {
        open.set(attempt, { worker: e.worker, start: e.ts });
        if (e.ts >= since) events.claimed = (events.claimed ?? 0) + 1;
        continue;
      }
      if (e.ts < since) {
        if (ends[e.type]) open.delete(attempt);
        continue;
      }
      events[e.type] = (events[e.type] ?? 0) + 1;
      if (e.type === "rejected-stale") forWorker(e.worker).staleRejected += 1;
      const counter = ends[e.type];
      const held = open.get(attempt);
      if (!counter || !held) continue;
      const w = forWorker(held.worker);
      w[counter] += 1;
      // An expired lease ended when it ran out (recorded by the sweep), not when the sweep noticed.
      const end = e.type === "lease-expired" && e.detail !== null && Number.isFinite(Number(e.detail)) ? Math.min(e.ts, Number(e.detail)) : e.ts;
      w.machineSeconds += leased(held.start, end);
      open.delete(attempt);
    }
    // Attempts still claimed count up to now or their current lease expiry, whichever is first: an expired
    // lease that no sweep has noticed yet stops counting when it ran out.
    const leases = new Map(
      (this.#db.prepare("SELECT key, fence, lease_expires FROM jobs WHERE status = 'claimed'").all() as { key: string; fence: number; lease_expires: number }[]).map(
        (r) => [`${r.key}#${r.fence}`, r.lease_expires],
      ),
    );
    for (const [attempt, held] of open) forWorker(held.worker).machineSeconds += leased(held.start, leases.get(attempt) ?? until);
    const enqueued = this.#db.prepare("SELECT COUNT(*) AS n FROM job_events WHERE type = 'enqueued' AND ts >= ?").get(since) as { n: number };
    if (enqueued.n) events.enqueued = enqueued.n;

    return {
      now: { at: until, byKind, failures, oldestReadyAgeSeconds: oldest.t === null ? null : Math.round((until - oldest.t) / 1000) },
      period: { since, until, events, byWorker },
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
      .prepare("SELECT key, worker, fence, attempts, max_attempts, lease_expires FROM jobs WHERE status = 'claimed' AND lease_expires <= ?")
      .all(now) as { key: string; worker: string; fence: number; attempts: number; max_attempts: number; lease_expires: number }[];
    for (const r of expired) {
      const again = r.attempts < r.max_attempts;
      this.#db
        .prepare("UPDATE jobs SET status = ?, error = ?, worker = NULL, lease_expires = NULL, updated = ? WHERE key = ?")
        .run(again ? "ready" : "failed", again ? null : "lease-expired", now, r.key);
      // The detail is when the lease actually ran out, which the report uses, not when the sweep noticed.
      this.#event(r.key, "lease-expired", r.worker, r.fence, String(r.lease_expires));
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

/** Runs one job; resolves to the attempt's output (see {@link writeOutput}). Must stop promptly when `signal` aborts. */
export type JobHandler = (job: Claim, ctx: { signal: AbortSignal; outDir: string }) => Promise<JobOutput>;

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
