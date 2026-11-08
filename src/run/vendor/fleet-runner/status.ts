/** Versioned public operations contract. No job payload, input IDs, paths or reader content. */
export const PHASES = [
  "starting",
  "idle",
  "running",
  "uploading",
  "draining",
  "paused",
  "request-error",
  "failed",
] as const;
export const ELIGIBILITY = [
  "eligible",
  "daytime-exception",
  "paused",
  "resource-busy",
  "outside-window",
  "battery",
  "power-unknown",
  "helper-unavailable",
  "helper-changed",
  "unsupported-worker",
  "policy-error",
  "operator-paused",
] as const;
export const HANDLERS = ["read-vision", "read-qwen", "proof-fixture"] as const;
const errors = new Set([
  "EACCES",
  "EPERM",
  "EROFS",
  "ENOENT",
  "ENOSPC",
  "EIO",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_HAS_EXPIRED",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "UND_ERR_CONNECT_TIMEOUT",
  "timeout",
  "unexpected-error",
]);
export function safeStatusError(value: unknown): value is string {
  return typeof value === "string" && (errors.has(value) || /^http-[1-5][0-9]{2}$/.test(value));
}
export interface WorkerObservation {
  schemaVersion: 1;
  phase: (typeof PHASES)[number];
  eligibility: (typeof ELIGIBILITY)[number];
  handlers: (typeof HANDLERS)[number][];
  busy: boolean;
  errorCode?: string;
}
export function validObservation(value: unknown): value is WorkerObservation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const b = value as Record<string, unknown>;
  return (
    Object.keys(b).every((k) =>
      ["schemaVersion", "phase", "eligibility", "handlers", "busy", "errorCode"].includes(k),
    ) &&
    b.schemaVersion === 1 &&
    PHASES.includes(b.phase as WorkerObservation["phase"]) &&
    ELIGIBILITY.includes(b.eligibility as WorkerObservation["eligibility"]) &&
    Array.isArray(b.handlers) &&
    b.handlers.length <= 3 &&
    new Set(b.handlers).size === b.handlers.length &&
    b.handlers.every((h) => HANDLERS.includes(h)) &&
    typeof b.busy === "boolean" &&
    (b.errorCode === undefined || safeStatusError(b.errorCode))
  );
}
export interface WorkerControl {
  paused: boolean;
  revision: number;
  intent: "pause" | "drain" | "resume";
}
export interface ServiceInstance {
  id: string;
  startedAt: number;
  starts: number;
  trackedSince: number;
}
export interface PublicEvent {
  seq: number;
  at: number;
  trace: string;
  type: string;
  worker: string | null;
  fence: number | null;
}
export interface ServiceSnapshot {
  schemaVersion: 1;
  revision: string;
  generatedAt: number;
  cursor: number;
  service: ServiceInstance & {
    version: string;
    build: string;
    ready: boolean;
    reasons: string[];
    uptimeSeconds: number;
  };
  queue: Record<"ready" | "claimed" | "done" | "failed", number>;
  leases: { active: number; expired: number };
  kinds: { kind: string; ready: number; claimed: number; done: number; failed: number }[];
  workers: {
    id: string;
    seenAt: number | null;
    freshness: "fresh" | "stale" | "unknown";
    phase: string;
    eligibility: string;
    handlers: string[];
    busy: boolean | null;
    heldSlots: number;
    control: WorkerControl;
    errorCode?: string;
  }[];
  events: PublicEvent[];
  backup: { state: "unqualified"; lastVerifiedAt: null };
}
export function validSnapshot(value: unknown): value is ServiceSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as ServiceSnapshot;
  return (
    v.schemaVersion === 1 &&
    typeof v.revision === "string" &&
    v.revision.length < 200 &&
    Number.isSafeInteger(v.generatedAt) &&
    Number.isSafeInteger(v.cursor) &&
    !!v.service &&
    typeof v.service.ready === "boolean" &&
    Array.isArray(v.workers) &&
    v.workers.length <= 32 &&
    Array.isArray(v.events) &&
    v.events.length <= 100 &&
    !!v.queue &&
    !!v.leases &&
    !!v.backup
  );
}
export function currentSnapshot(value: unknown, now = Date.now()): value is ServiceSnapshot {
  return validSnapshot(value) && now-value.generatedAt <= 5000 && value.generatedAt-now <= 5000;
}
export type StatusView = "status" | "workers" | "events" | "logs" | "doctor";
export function statusView(snapshot: ServiceSnapshot, view: StatusView): object {
  const base = { schemaVersion: 1, revision: snapshot.revision, generatedAt: snapshot.generatedAt };
  if (view === "status") return snapshot;
  if (view === "workers") return { ...base, workers: snapshot.workers };
  if (view === "events") return { ...base, cursor: snapshot.cursor, events: snapshot.events };
  if (view === "logs")
    return {
      ...base,
      logs: snapshot.workers
        .filter((w) => w.errorCode)
        .map((w) => ({ worker: w.id, code: w.errorCode, seenAt: w.seenAt })),
    };
  return {
    ...base,
    healthy: snapshot.service.ready && snapshot.workers.every((w) => w.freshness === "fresh"),
    serviceReady: snapshot.service.ready,
    workers: snapshot.workers.map((w) => ({
      id: w.id,
      freshness: w.freshness,
      eligibility: w.eligibility,
    })),
    backup: snapshot.backup,
  };
}
