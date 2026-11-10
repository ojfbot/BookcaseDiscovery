import type { ServiceInstance, ServiceSnapshot, WorkerControl, WorkerObservation } from "./status.js";
import type { RequestNonce } from "./auth.js";
export declare const JOBS_SCHEMA_VERSION = 5;
export type JobStatus = "ready" | "claimed" | "done" | "failed";
export type JobEventType = "enqueued" | "claimed" | "completed" | "rejected-stale" | "failed" | "retry" | "released" | "lease-expired" | "retired";
/** What a client admits. The key is derived from everything that determines the output. */
export interface JobSpec {
    kind: string;
    /** Content hashes of the inputs (working-copy sha256, a commit, a cache file's hash). Order is significant. */
    inputs: string[];
    /** Everything else that changes the output (rotations, polygons, tiling). Keyed, so handlers execute these, not the payload. */
    params?: Record<string, unknown>;
    model?: {
        id: string;
        revision: string;
    };
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
export declare function canonicalJson(value: unknown): string;
/** The job key (CONTEXT.md): the payload is excluded, because it says *where* inputs are, not *what* they are. */
export declare function jobKey(spec: Pick<JobSpec, "kind" | "inputs"> & Partial<JobSpec>): string;
/**
 * Write one attempt's output to `<dir>/<key>.<fence>.<ext>`. The file is complete before it appears (written
 * to a temporary file, then hard-linked into place) and is never overwritten: linking fails if the name
 * exists. So a worker that wakes after losing its lease cannot touch the accepted attempt's bytes.
 */
export declare function writeOutput(dir: string, job: Pick<Claim, "key" | "fence">, data: string | Uint8Array, ext?: string): JobOutput;
/** A retry may find an orphan from an interrupted completion; make it durable before commit. */
export declare function syncOutput(dir: string, file: string): void;
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
export interface JobEvent {
    seq: number;
    ts: number;
    key: string;
    type: JobEventType;
    worker: string | null;
    fence: number | null;
}
/** The morning report. Its current state and time window are separate. */
export interface JobReport {
    now: {
        at: number;
        byKind: Record<string, Record<JobStatus, number>>;
        /** Jobs that are failed now (any time), by kind and error code. */
        failures: {
            kind: string;
            error: string;
            count: number;
        }[];
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
    /** Attempts ended because a schema upgrade retired their job. */
    retired: number;
    staleRejected: number;
    machineSeconds: number;
}
export declare class JobStore {
    #private;
    constructor(path: string, options?: JobStoreOptions);
    close(): void;
    /** Atomically remember a verified request nonce across every process using this database. */
    consumeNonce(candidate: RequestNonce): boolean;
    /**
     * Admit a job. Idempotent: an existing key (in any state) is left alone and reported as not created. A key
     * readmitted after retirement continues its fence from the event history, so tokens never repeat per key.
     */
    enqueue(spec: JobSpec): {
        key: string;
        created: boolean;
    };
    /**
     * Claim the highest-priority ready job this worker can run, after sweeping expired leases. A job is
     * runnable when the worker has every capability it requires and, if `kinds` is given, a handler for its kind.
     */
    claim(worker: string, caps: readonly string[], kinds?: readonly string[]): Claim | undefined;
    /**
     * Extend the lease. False means the worker no longer holds the job and must stop. The clock is read after
     * the write lock is taken: time spent waiting for the lock counts against the lease, never for it.
     */
    heartbeat(key: string, fence: number, worker: string): boolean;
    /**
     * Record success and make this attempt's file the accepted output. Rejected (and recorded) unless the
     * worker still holds the job under the same fencing token.
     */
    complete(key: string, fence: number, worker: string, output: JobOutput | (() => JobOutput)): boolean;
    /** Record a failure by error code. Retryable failures go back to ready until `max_attempts`. */
    fail(key: string, fence: number, worker: string, code: string, retryable: boolean): boolean;
    /** Give a job back without spending an attempt: an interruption (user activity, shutdown) is not a failure. */
    release(key: string, fence: number, worker: string): boolean;
    /** Return expired leases to the queue (or fail them when out of attempts). Returns how many. */
    sweep(): number;
    get(key: string): JobRow | undefined;
    /** Input access is scoped to the requesting worker's current, unexpired attempt. */
    holdsInput(key: string, fence: number, worker: string, hash: string): boolean;
    events(after: number): JobEvent[];
    startStatusInstance(): ServiceInstance;
    recordPresence(worker: string, observation: WorkerObservation): void;
    workerControl(worker: string): WorkerControl;
    recoveryState(): {
        generation: string;
        hold: boolean;
        recoveryPoint: string;
    };
    isRecoveryHeld(): boolean;
    /** A restored service starts paused. No worker control route can clear this hold. */
    establishRecoveryHold(generation: string, recoveryPoint: string): void;
    releaseRecoveryHold(generation: string, recoveryPoint: string): boolean;
    controlWorker(worker: string, intent: WorkerControl["intent"]): WorkerControl;
    /** One bounded operations projection; never serializes a job, input, path, output or error message. */
    statusSnapshot(instance: ServiceInstance, workers: readonly string[], reasons: string[], build: string): ServiceSnapshot;
    publicEvents(after: number, workers: readonly string[]): {
        schemaVersion: number;
        cursor: number;
        events: ServiceSnapshot["events"];
        hasMore: boolean;
    };
    /** The morning report: aggregates only (kinds, workers, counts, error codes). */
    report(since?: number): JobReport;
}
/** Runs one job; resolves to the attempt's output (see {@link writeOutput}). Must stop promptly when `signal` aborts. */
export type JobHandler = (job: Claim, ctx: {
    signal: AbortSignal;
    outDir: string;
}) => Promise<JobOutput>;
/** A handler failure with an error code (never message text that could carry reader output). */
export declare class JobError extends Error {
    readonly name = "JobError";
    readonly code: string;
    readonly retryable: boolean;
    constructor(code: string, retryable: boolean);
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
export declare function runWorker(store: JobStore, options: WorkerOptions): Promise<WorkerSummary>;
