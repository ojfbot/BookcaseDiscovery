import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dataRoot } from "../ledger/images.ts";
import { defaultOcrBinary, ocrBinaryAvailable } from "../perceive/ocr.ts";
import { ocrHelperId } from "./job-kinds.ts";
import { fleetClient, type FleetClient } from "./vendor/fleet-runner/client.ts";
import { currentSnapshot, type ServiceSnapshot } from "./vendor/fleet-runner/status.ts";
import { workOnce, type RemoteWorkerResult } from "./vendor/fleet-runner/worker.ts";
import { jobKey, writeOutput } from "./jobs.ts";
import type { Claim, JobHandler, JobSpec } from "./vendor/fleet-runner/jobs.d.ts";
import { nasEligibility } from "./fleet-eligibility.ts";

export const G6_TRIAL_IDS = ["lid-1", "lid-2", "lid-3", "wifi-1", "wifi-2", "wifi-3"] as const;
export const APP_MAIN_PIN = "ed3f01e5e7d5369beda01b5a2c1c567cec691d66";
export const APP_VENDOR_CORE_PIN = "dad1d204bb2e01c691aa69de3ce3f0b218f7de21";
export const NAS_CORE_PIN = "78c71e9a7f085c092425fdbe99193a06c06e9e3f";
export const NAS_BUILD_LABEL = "78c71e9";
export const NAS_IMAGE_ID = "sha256:704a311810e999f7cfc24f26a8c22a6cd8090cc63017fc66dc13706fa9865066";
export const HISTORICAL_READ_VISION_DONE = 4;
export const HISTORICAL_PROOF_FIXTURE_DONE = 10;
export const FIXTURE_TEXT = "fleet-runner packaging fixture v1\n";
export const FIXTURE_SHA256 = "f04565eea01f62eeb7149c8609c8a901ca0af5ffb74c37a181ca0955479e7890";
export const FIXTURE_BYTES = Buffer.from(FIXTURE_TEXT, "utf8");
export const HOLD_MS = 720_000;
export const RECLAIM_WAIT_MS = 320_000;
export const POLL_MS = 5_000;
export const OWNER_EXCEPTION_MAX_MS = 15 * 60_000;
const PROTOCOL = "FR-20261110-interruption/g6-physical-proof-fixture/1";
const SHA256 = /^[a-f0-9]{64}$/;
const CAPABILITY = /^g6-(?:lid|wifi)-[1-3]-[a-f0-9]{32}$/;

export interface TrialPacket {
  protocol: typeof PROTOCOL;
  trialId: (typeof G6_TRIAL_IDS)[number];
  state: "admitted" | "armed" | "reclaimed" | "passed" | "invalid";
  appSourceCommit: string;
  appMainPin: typeof APP_MAIN_PIN;
  appVendorCorePin: typeof APP_VENDOR_CORE_PIN;
  nasCorePin: typeof NAS_CORE_PIN;
  nasBuildLabel: typeof NAS_BUILD_LABEL;
  nasImageId: typeof NAS_IMAGE_ID;
  fixtureSha256: typeof FIXTURE_SHA256;
  capability: string;
  jobKey: string;
  startCursor: number;
  eventCursor: number;
  priorPassedTrialCount: number;
  claims: { seq: number; at: number; worker: "yuri" | "yojimbo"; fence: number }[];
  receipt?: { result: RemoteWorkerResult; staleCompletionAccepted?: boolean; verified?: boolean; acceptedOutputSha256?: string };
}

export function isTrialId(value: string): value is (typeof G6_TRIAL_IDS)[number] {
  return (G6_TRIAL_IDS as readonly string[]).includes(value);
}

export function capabilityFor(trialId: string, nonce: string): string {
  if (!isTrialId(trialId) || !/^[a-f0-9]{32}$/.test(nonce)) throw new Error("invalid-trial-capability");
  return `g6-${trialId}-${nonce}`;
}

export function proofFixtureSpec(trialId: string, capability: string, appSourceCommit: string): JobSpec {
  if (!isTrialId(trialId) || !CAPABILITY.test(capability) || !capability.startsWith(`g6-${trialId}-`) || !/^[a-f0-9]{40}$/.test(appSourceCommit))
    throw new Error("invalid-proof-fixture-spec");
  return {
    kind: "proof-fixture",
    inputs: [],
    params: { protocol: PROTOCOL, trialId, fixtureSha256: FIXTURE_SHA256, appSourceCommit },
    code: `${PROTOCOL}@${appSourceCommit}`,
    payload: null,
    requires: [capability],
    maxAttempts: 3,
  };
}

function chicagoHour(now: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", hourCycle: "h23" }).formatToParts(now).find((part) => part.type === "hour")?.value);
}

export function yuriWindowAllowed(now: Date, powerText: string, exceptionUntil?: string): "night-ac" | "bounded-owner-exception" | false {
  const sources = powerText.split(/\r?\n/).filter((line) => line.startsWith("Now drawing from "));
  if (sources.length !== 1 || sources[0] !== "Now drawing from 'AC Power'") return false;
  const hour = chicagoHour(now);
  if (hour >= 20 || hour < 7) return "night-ac";
  if (!exceptionUntil) return false;
  const until = Date.parse(exceptionUntil);
  const elapsed = until - now.getTime();
  const chicagoDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });
  if (!Number.isFinite(until) || elapsed <= 0 || elapsed > OWNER_EXCEPTION_MAX_MS || chicagoDay.format(new Date(until - 1)) !== chicagoDay.format(now)) return false;
  return "bounded-owner-exception";
}

export function validateTlsEnvironment(env: NodeJS.ProcessEnv): void {
  const endpoint = env.FLEET_ENDPOINT;
  if (!endpoint) throw new Error("missing-endpoint");
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("https-endpoint-required");
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0" || /NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*0/.test(env.NODE_OPTIONS ?? "")) throw new Error("tls-verification-must-remain-enabled");
  const ca = env.NODE_EXTRA_CA_CERTS;
  if (!ca || !isAbsolute(ca)) throw new Error("existing-public-ca-certificate-required");
  if (!statSync(resolve(ca), { throwIfNoEntry: false })?.isFile()) throw new Error("existing-public-ca-certificate-required");
  const token = env.FLEET_TOKEN_FILE;
  if (!token) throw new Error("existing-local-token-required");
  const tokenStat = statSync(resolve(token), { throwIfNoEntry: false });
  if (!tokenStat?.isFile() || (tokenStat.mode & 0o077) !== 0) throw new Error("existing-local-token-permissions-invalid");
}

export function assertCandidateSnapshot(snapshot: unknown, priorPassedTrialCount: number): asserts snapshot is ServiceSnapshot {
  if (!currentSnapshot(snapshot)) throw new Error("candidate-status-stale-or-incompatible");
  if (snapshot.service.build !== NAS_BUILD_LABEL || !snapshot.service.ready) throw new Error("candidate-build-or-readiness-mismatch");
  if (!Number.isSafeInteger(priorPassedTrialCount) || priorPassedTrialCount < 0 || priorPassedTrialCount > 5) throw new Error("invalid-prior-trial-count");
  const counts = new Map(snapshot.kinds.map((item) => [item.kind, item]));
  const vision = counts.get("read-vision");
  const fixture = counts.get("proof-fixture");
  const expectedProofFixtures = HISTORICAL_PROOF_FIXTURE_DONE + priorPassedTrialCount;
  if (!vision || vision.done !== HISTORICAL_READ_VISION_DONE || vision.ready !== 0 || vision.claimed !== 0 || vision.failed !== 0) throw new Error("historical-four-read-vision-outputs-not-preserved");
  if ((fixture?.done ?? 0) !== expectedProofFixtures || (fixture?.ready ?? 0) !== 0 || (fixture?.claimed ?? 0) !== 0 || (fixture?.failed ?? 0) !== 0) throw new Error("proof-fixture-count-does-not-match-ten-plus-passed-trials");
  if (snapshot.queue.ready !== 0 || snapshot.queue.claimed !== 0 || snapshot.queue.failed !== 0 || snapshot.queue.done !== HISTORICAL_READ_VISION_DONE + expectedProofFixtures) throw new Error("candidate-queue-is-not-isolated-and-idle");
  for (const item of snapshot.kinds) if (!new Set(["read-vision", "proof-fixture"]).has(item.kind) && Object.values(item).slice(1).some((count) => count !== 0)) throw new Error("unexpected-job-kind-in-candidate-queue");
}

export async function preflightThenLock(
  owner: Pick<FleetClient, "status">,
  priorPassedTrialCount: number,
  createLock: () => void,
): Promise<ServiceSnapshot> {
  const snapshot = await owner.status();
  assertCandidateSnapshot(snapshot, priorPassedTrialCount);
  createLock();
  return snapshot;
}

export function validatePhysicalEvents(events: readonly { seq: number; ts: number; key: string; type: string; worker: string | null; fence: number | null }[], key: string) {
  const own = events.filter((event) => event.key === key);
  const claims = own.filter((event) => event.type === "claimed");
  const completed = own.filter((event) => event.type === "completed");
  const stale = own.filter((event) => event.type === "rejected-stale");
  const expired = own.filter((event) => event.type === "lease-expired");
  if (claims.length !== 2 || claims[0]?.worker !== "yuri" || claims[1]?.worker !== "yojimbo" || claims[1]!.fence! <= claims[0]!.fence!) throw new Error("physical-claim-sequence-invalid");
  if (expired.length !== 1 || expired[0]!.worker !== "yuri" || expired[0]!.fence !== claims[0]!.fence || expired[0]!.seq >= claims[1]!.seq) throw new Error("physical-expiry-before-reclaim-missing");
  if (completed.length !== 1 || completed[0]!.worker !== "yojimbo" || completed[0]!.fence !== claims[1]!.fence) throw new Error("physical-completion-sequence-invalid");
  if (stale.length !== 1 || stale[0]!.worker !== "yuri" || stale[0]!.fence !== claims[0]!.fence) throw new Error("physical-stale-upload-rejection-missing");
  if (!(claims[0]!.seq < expired[0]!.seq && expired[0]!.seq < claims[1]!.seq && claims[1]!.seq < completed[0]!.seq && completed[0]!.seq < stale[0]!.seq)) throw new Error("physical-event-order-invalid");
  return { claims, expired: expired[0], completed: completed[0], stale: stale[0] };
}

export function validatePhysicalSchedule(claimAt: number, heartbeats: readonly { requestStartedAt: number; acceptedAt: number; accepted: boolean }[], leaseMs = 300_000, pollMs = POLL_MS) {
  const last = [...heartbeats].filter((item) => item.accepted).sort((a, b) => a.requestStartedAt - b.requestStartedAt).at(-1);
  if (!last || !Number.isSafeInteger(claimAt) || claimAt <= 0 || !Number.isSafeInteger(leaseMs) || leaseMs !== 300_000 || pollMs !== 5_000) throw new Error("last-valid-heartbeat-or-gate-schedule-missing");
  const requestDuration = last.acceptedAt - last.requestStartedAt;
  const elapsedUpperBound = claimAt - last.requestStartedAt;
  if (!Number.isSafeInteger(requestDuration) || requestDuration < 0 || elapsedUpperBound < leaseMs || elapsedUpperBound > leaseMs + 2 * pollMs + requestDuration) throw new Error("physical-reclaim-exceeds-observed-L-plus-2P-bound");
  return {
    last_valid_renewal_request_started_at_ms: last.requestStartedAt,
    renewal_response_at_ms: last.acceptedAt,
    lease_expiry_estimate_at_ms: last.requestStartedAt + leaseMs,
    reclaim_claim_at_ms: claimAt,
    elapsed_upper_bound_ms: elapsedUpperBound,
    lease_ms: leaseMs,
    poll_interval_ms: pollMs,
    request_duration_uncertainty_ms: requestDuration,
    claim_delay_after_estimated_expiry_ms: claimAt - (last.requestStartedAt + leaseMs),
  };
}

function verifyFixturePin(): void {
  if (createHash("sha256").update(FIXTURE_BYTES).digest("hex") !== FIXTURE_SHA256) throw new Error("proof-fixture-digest-mismatch");
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: resolve(new URL("../..", import.meta.url).pathname), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function assertSourcePin(): string {
  const head = git(["rev-parse", "HEAD"]);
  if (git(["rev-parse", "HEAD^1"]) !== APP_MAIN_PIN) throw new Error("drill-commit-must-be-a-single-child-of-reviewed-app-main");
  if (git(["status", "--porcelain=v1", "--untracked-files=all"])) throw new Error("app-source-must-be-clean-and-committed");
  const vendorRevision = readFileSync(new URL("./vendor/fleet-runner/core-revision.txt", import.meta.url), "utf8").trim();
  if (vendorRevision !== APP_VENDOR_CORE_PIN) throw new Error("vendored-core-revision-mismatch");
  return head;
}

function clientFor(env: NodeJS.ProcessEnv, id: string): FleetClient {
  validateTlsEnvironment(env);
  if (env.FLEET_ID !== id) throw new Error(`run-with-local-${id}-identity`);
  if (env.FLEET_GENERATION !== undefined) throw new Error("generation-binding-not-supported-by-schema-4-candidate");
  return fleetClient(env.FLEET_ENDPOINT!, id, env.FLEET_TOKEN_FILE!);
}

export function privateEvidenceDirectory(env: NodeJS.ProcessEnv): string {
  const dir = env.G6_EVIDENCE_DIR;
  if (!dir || !isAbsolute(dir)) throw new Error("absolute-private-G6_EVIDENCE_DIR-required");
  const absolute = resolve(dir);
  mkdirSync(absolute, { recursive: true, mode: 0o700 });
  const info = lstatSync(absolute);
  if (!info.isDirectory() || (info.mode & 0o777) !== 0o700) throw new Error("G6_EVIDENCE_DIR-must-be-private-directory-mode-0700");
  return absolute;
}

const packetDir = privateEvidenceDirectory;

function packetPath(dir: string, trialId: string): string {
  if (!isTrialId(trialId)) throw new Error("invalid-trial-id");
  return join(dir, `${trialId}.packet.json`);
}

function writeJsonAtomic(path: string, value: unknown, exclusive = false): void {
  const temp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  const fd = openSync(temp, "wx", 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value, null, 2) + "\n");
    fsyncSync(fd);
  } finally { closeSync(fd); }
  try {
    if (exclusive && existsSync(path)) throw new Error("trial-packet-already-exists");
    renameSync(temp, path);
  } finally { rmSync(temp, { force: true }); }
}

function loadPacket(dir: string, trialId: string): TrialPacket {
  const packet = JSON.parse(readFileSync(packetPath(dir, trialId), "utf8")) as TrialPacket;
  if (packet.protocol !== PROTOCOL || packet.trialId !== trialId || packet.appMainPin !== APP_MAIN_PIN || packet.appVendorCorePin !== APP_VENDOR_CORE_PIN || packet.nasCorePin !== NAS_CORE_PIN || packet.nasBuildLabel !== NAS_BUILD_LABEL || packet.nasImageId !== NAS_IMAGE_ID || packet.fixtureSha256 !== FIXTURE_SHA256 || !CAPABILITY.test(packet.capability) || !SHA256.test(packet.jobKey)) throw new Error("trial-packet-pin-or-integrity-failure");
  if (packet.appSourceCommit !== assertSourcePin()) throw new Error("trial-packet-source-commit-mismatch");
  return packet;
}

function localEligibility(worker: "yuri" | "yojimbo", env: NodeJS.ProcessEnv): void {
  const root = dataRoot(env);
  const fleetDir = join(root, "fleet");
  const binary = defaultOcrBinary(env);
  const helper = ocrHelperId(binary);
  if (!ocrBinaryAvailable(binary)) throw new Error("existing-OCR-helper-unavailable-no-G6-claim");
  let powerText = "";
  if (worker === "yuri") {
    powerText = execFileSync("/usr/bin/pmset", ["-g", "batt"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2_000 });
    let exceptionUntil: string | undefined;
    try { exceptionUntil = (JSON.parse(readFileSync(join(fleetDir, "daytime-exception.json"), "utf8")) as { until?: string }).until; } catch { /* no owner exception */ }
    if (!yuriWindowAllowed(new Date(), powerText, exceptionUntil)) throw new Error("yuri-requires-AC-night-or-existing-bounded-owner-exception");
  }
  const eligibility = nasEligibility(worker, fleetDir, binary, helper, { now: () => new Date(), power: () => powerText });
  if (!eligibility.eligible) throw new Error(`worker-ineligible-${eligibility.reason}`);
}

function appendReceipt(path: string, value: unknown): void {
  mkdirSync(resolve(path, ".."), { recursive: true, mode: 0o700 });
  const fd = openSync(path, "a", 0o600);
  try { writeFileSync(fd, JSON.stringify(value) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
}

function readReceipt(path: string): Record<string, unknown>[] {
  return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

function instrument(client: FleetClient, receipt: string): FleetClient {
  return {
    ...client,
    heartbeat: async (claim) => {
      const requestStartedAt = Date.now();
      const accepted = await client.heartbeat(claim);
      appendReceipt(receipt, { type: "heartbeat", requestStartedAt, acceptedAt: Date.now(), accepted });
      return accepted;
    },
    complete: async (claim, bytes, sha256) => {
      const requestStartedAt = Date.now();
      const accepted = await client.complete(claim, bytes, sha256);
      appendReceipt(receipt, { type: "complete-response", requestStartedAt, accepted });
      return accepted;
    },
  };
}

async function prepare(trialId: string, priorPassedTrialCount: number, env: NodeJS.ProcessEnv): Promise<void> {
  if (env.FLEET_ID !== "owner") throw new Error("owner-identity-required");
  if (!isTrialId(trialId)) throw new Error("invalid-trial-id");
  const sourceCommit = assertSourcePin();
  verifyFixturePin();
  const owner = clientFor(env, "owner");
  const dir = packetDir(env);
  const target = packetPath(dir, trialId);
  const lock = join(dir, ".g6-physical-active.json");
  const snapshot = await preflightThenLock(owner, priorPassedTrialCount, () => {
    if (existsSync(target)) throw new Error("trial-id-already-used-resume-or-reconcile-existing-packet");
    const fd = openSync(lock, "wx", 0o600);
    try { writeFileSync(fd, JSON.stringify({ trialId, appSourceCommit: sourceCommit }) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
  });
  const capability = capabilityFor(trialId, randomBytes(16).toString("hex"));
  const packet: TrialPacket = {
    protocol: PROTOCOL, trialId, state: "admitted", appSourceCommit: sourceCommit, appMainPin: APP_MAIN_PIN,
    appVendorCorePin: APP_VENDOR_CORE_PIN, nasCorePin: NAS_CORE_PIN, nasBuildLabel: NAS_BUILD_LABEL, nasImageId: NAS_IMAGE_ID,
    fixtureSha256: FIXTURE_SHA256, capability, jobKey: "0".repeat(64), startCursor: snapshot.cursor, eventCursor: snapshot.cursor,
    priorPassedTrialCount, claims: [],
  };
  const spec = proofFixtureSpec(trialId, capability, sourceCommit);
  packet.jobKey = jobKey(spec);
  writeJsonAtomic(target, packet, true);
  const admitted = await owner.enqueue(spec);
  if (!admitted.created || admitted.key !== packet.jobKey) throw new Error("trial-admission-not-new-or-key-mismatch-reconcile-before-retry");
  writeJsonAtomic(target, packet);
  console.log(JSON.stringify({ trialId, state: packet.state, jobKey: packet.jobKey, capability: packet.capability, eventCursor: packet.eventCursor, fixtureSha256: FIXTURE_SHA256, appSourceCommit: sourceCommit, appVendorCorePin: APP_VENDOR_CORE_PIN, nasCorePin: NAS_CORE_PIN, nasBuildLabel: NAS_BUILD_LABEL, nasImageId: NAS_IMAGE_ID }));
}

async function observe(trialId: string, expectedWorkerText: string, timeoutMs: number, env: NodeJS.ProcessEnv): Promise<void> {
  if (env.FLEET_ID !== "owner") throw new Error("owner-identity-required");
  const expectedWorker = expectedWorkerText as "yuri" | "yojimbo";
  if (!new Set(["yuri", "yojimbo"]).has(expectedWorker) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > RECLAIM_WAIT_MS) throw new Error("invalid-observe-bound");
  const dir = packetDir(env);
  const packet = loadPacket(dir, trialId);
  const claimIndex = packet.claims.length;
  const desiredWorker = claimIndex === 0 ? "yuri" : "yojimbo";
  if (expectedWorker !== desiredWorker || claimIndex > 1 || (claimIndex === 0 ? packet.state !== "admitted" : packet.state !== "armed")) throw new Error("unexpected-claim-observation-order");
  const owner = clientFor(env, "owner");
  const deadline = Date.now() + timeoutMs;
  let cursor = packet.eventCursor;
  while (Date.now() < deadline) {
    const rows = await owner.events(cursor);
    for (const event of rows) {
      cursor = Math.max(cursor, event.seq);
      if (event.key !== packet.jobKey) continue;
      if (event.type === "enqueued" || (claimIndex === 1 && event.type === "lease-expired")) continue;
      if (event.type !== "claimed") throw new Error(`unexpected-job-event-${event.type}-before-expected-claim`);
      if (event.worker !== desiredWorker || !Number.isSafeInteger(event.fence)) throw new Error("wrong-worker-or-malformed-claim-event");
      const next = { seq: event.seq, at: event.ts, worker: event.worker as "yuri" | "yojimbo", fence: event.fence! };
      if (claimIndex > 0 && next.fence <= packet.claims[0]!.fence) throw new Error("reclaim-fence-did-not-increase");
      packet.claims.push(next);
      packet.eventCursor = cursor;
      packet.state = claimIndex === 0 ? "armed" : "reclaimed";
      writeJsonAtomic(packetPath(dir, trialId), packet);
      console.log(JSON.stringify({ trialId, state: packet.state, claim: next }));
      return;
    }
    packet.eventCursor = cursor;
    writeJsonAtomic(packetPath(dir, trialId), packet);
    await delay(Math.min(POLL_MS, Math.max(1, deadline - Date.now())));
  }
  throw new Error("claim-event-timeout-packet-and-lock-retained-for-reconciliation");
}

async function workerRun(mode: "hold" | "reclaim", trialId: string, jobKey: string, capability: string, env: NodeJS.ProcessEnv): Promise<void> {
  const rawWorkerId = env.FLEET_ID;
  if (rawWorkerId !== "yuri" && rawWorkerId !== "yojimbo") throw new Error("unsupported-worker-identity");
  const workerId: "yuri" | "yojimbo" = rawWorkerId;
  if ((mode === "hold" && workerId !== "yuri") || (mode === "reclaim" && workerId !== "yojimbo")) throw new Error("wrong-worker-identity-for-trial-role");
  if (!isTrialId(trialId) || !SHA256.test(jobKey) || !CAPABILITY.test(capability) || !capability.startsWith(`g6-${trialId}-`)) throw new Error("invalid-worker-trial-capability");
  verifyFixturePin();
  const sourceCommit = assertSourcePin();
  localEligibility(workerId, env);
  const dir = packetDir(env);
  const receiptPath = join(dir, `${trialId}.${workerId}.worker.jsonl`);
  const baseClient = clientFor(env, workerId);
  const client = instrument(baseClient, receiptPath);
  const outDir = join(dir, `${trialId}.${workerId}.attempt-output`);
  let observedClaim: Claim | undefined;
  let heldOnce = false;
  const handler: JobHandler = async (job, context) => {
    if (heldOnce || job.key !== jobKey || job.kind !== "proof-fixture" || job.params.protocol !== PROTOCOL || job.params.trialId !== trialId || job.params.fixtureSha256 !== FIXTURE_SHA256 || job.params.appSourceCommit !== sourceCommit || job.code !== `${PROTOCOL}@${sourceCommit}` || job.payload !== null) throw new Error("claim-does-not-match-this-synthetic-trial");
    heldOnce = true;
    observedClaim = job;
    appendReceipt(receiptPath, { type: "claim", worker: workerId, key: job.key, fence: job.fence, observedAt: Date.now(), leaseExpires: job.leaseExpires, mode });
    if (mode === "hold") await delay(HOLD_MS); // Intentionally holds the synthetic result across the physical interruption.
    const result = writeOutput(context.outDir, job, FIXTURE_TEXT);
    if (result.sha256 !== FIXTURE_SHA256) throw new Error("synthetic-output-digest-mismatch");
    appendReceipt(receiptPath, { type: "fixture-created", worker: workerId, key: job.key, fence: job.fence, sha256: result.sha256, createdAt: Date.now() });
    return result;
  };
  const wrapped = instrument(baseClient, receiptPath);
  let result: RemoteWorkerResult = "idle";
  if (mode === "hold") {
    const control = await baseClient.workerControl();
    if (control.paused) throw new Error("worker-is-remotely-paused");
    result = await workOnce(wrapped, { caps: [capability], handlers: { "proof-fixture": handler }, outDir, heartbeatMs: 60_000 });
  } else {
    const deadline = Date.now() + RECLAIM_WAIT_MS;
    while (Date.now() < deadline) {
      localEligibility("yojimbo", env);
      const control = await baseClient.workerControl();
      if (control.paused) throw new Error("worker-is-remotely-paused");
      result = await workOnce(wrapped, { caps: [capability], handlers: { "proof-fixture": handler }, outDir, heartbeatMs: 60_000 });
      if (result !== "idle") break;
      await delay(Math.min(POLL_MS, Math.max(1, deadline - Date.now())));
    }
  }
  if (mode === "reclaim" && result === "idle") throw new Error("eligible-other-host-claim-timeout");
  let staleCompletionAccepted: boolean | undefined;
  if (mode === "hold" && result === "lease-lost" && observedClaim) {
    staleCompletionAccepted = await baseClient.complete(observedClaim, FIXTURE_BYTES, FIXTURE_SHA256);
    appendReceipt(receiptPath, { type: "stale-completion-response", worker: workerId, key: observedClaim.key, fence: observedClaim.fence, accepted: staleCompletionAccepted, at: Date.now() });
    if (staleCompletionAccepted !== false) throw new Error("old-fence-completion-was-not-rejected");
  }
  appendReceipt(receiptPath, { type: "worker-result", worker: workerId, result, completedAt: Date.now(), ...(staleCompletionAccepted === undefined ? {} : { staleCompletionAccepted }) });
  if (mode === "hold" && result !== "lease-lost") throw new Error("physical-interruption-not-observed-or-old-worker-completed");
  if (mode === "reclaim" && result !== "completed") throw new Error("other-host-did-not-complete-fixture");
  console.log(JSON.stringify({ trialId, worker: workerId, result, claim: observedClaim ? { key: observedClaim.key, fence: observedClaim.fence, leaseExpires: observedClaim.leaseExpires } : null, staleCompletionAccepted, fixtureSha256: FIXTURE_SHA256, receipt: receiptPath }));
}

async function verify(trialId: string, env: NodeJS.ProcessEnv): Promise<void> {
  if (env.FLEET_ID !== "owner") throw new Error("owner-identity-required");
  const dir = packetDir(env);
  const packet = loadPacket(dir, trialId);
  if (packet.state !== "reclaimed" || packet.claims.length !== 2) throw new Error("both-claims-must-be-observed-before-readback");
  const owner = clientFor(env, "owner");
  const [verification, snapshot] = await Promise.all([owner.verify(packet.jobKey), owner.status()]);
  const events: Awaited<ReturnType<FleetClient["events"]>> = [];
  let cursor = packet.startCursor;
  while (true) {
    const page = await owner.events(cursor);
    events.push(...page);
    if (page.length < 1_000) break;
    cursor = page[page.length - 1]!.seq;
  }
  const checked = validatePhysicalEvents(events, packet.jobKey);
  if (!verification.verified || verification.now.byKind["proof-fixture"]?.done !== HISTORICAL_PROOF_FIXTURE_DONE + packet.priorPassedTrialCount + 1) throw new Error("accepted-fixture-readback-failed");
  const yuriReceipt = readReceipt(join(dir, `${trialId}.yuri.worker.jsonl`));
  const yojimboReceipt = readReceipt(join(dir, `${trialId}.yojimbo.worker.jsonl`));
  const yuriClaim = yuriReceipt.find((item) => item.type === "claim" && item.key === packet.jobKey && item.worker === "yuri" && item.fence === checked.claims[0]!.fence);
  const yuriResult = yuriReceipt.find((item) => item.type === "worker-result" && item.worker === "yuri");
  const staleResult = yuriReceipt.find((item) => item.type === "stale-completion-response" && item.key === packet.jobKey && item.fence === checked.claims[0]!.fence && item.accepted === false);
  const yojimboClaim = yojimboReceipt.find((item) => item.type === "claim" && item.key === packet.jobKey && item.worker === "yojimbo" && item.fence === checked.claims[1]!.fence);
  const fixture = yojimboReceipt.find((item) => item.type === "fixture-created" && item.key === packet.jobKey && item.fence === checked.claims[1]!.fence && item.sha256 === FIXTURE_SHA256);
  const acceptedResponse = yojimboReceipt.find((item) => item.type === "complete-response" && item.accepted === true);
  if (!yuriClaim || yuriResult?.result !== "lease-lost" || !staleResult || !yojimboClaim || !fixture || !acceptedResponse) throw new Error("portable-worker-receipts-contradict-or-miss-required-attempts");
  const timing = validatePhysicalSchedule(checked.claims[1]!.ts, yuriReceipt.filter((item) => item.type === "heartbeat").map((item) => ({ requestStartedAt: Number(item.requestStartedAt), acceptedAt: Number(item.acceptedAt), accepted: item.accepted === true })));
  assertCandidateSnapshot(snapshot, packet.priorPassedTrialCount + 1);
  const completed = checked.completed;
  packet.receipt = { result: "completed", staleCompletionAccepted: false, verified: true, acceptedOutputSha256: FIXTURE_SHA256, ...(timing as unknown as Record<string, unknown>) };
  packet.state = "passed";
  writeJsonAtomic(packetPath(dir, trialId), packet);
  rmSync(join(dir, ".g6-physical-active.json"), { force: false });
  console.log(JSON.stringify({ trialId, state: packet.state, claims: checked.claims.map(({ worker, fence, ts }) => ({ worker, fence, ts })), completedBy: completed.worker, completedFence: completed.fence, staleRejectedBy: checked.stale.worker, acceptedOutputSha256: FIXTURE_SHA256, originalReadVisionCompleted: snapshot.kinds.find((item) => item.kind === "read-vision")?.done, reclaimSchedule: timing }));
}

export async function g6PhysicalDrill(argv = process.argv.slice(2), env = process.env): Promise<void> {
  const [action, ...args] = argv;
  if (action === "prepare" && args.length === 2) return prepare(args[0]!, Number(args[1]), env);
  if (action === "observe" && args.length === 3) return observe(args[0]!, args[1]!, Number(args[2]), env);
  if (action === "hold" && args.length === 3) return workerRun("hold", args[0]!, args[1]!, args[2]!, env);
  if (action === "reclaim" && args.length === 3) return workerRun("reclaim", args[0]!, args[1]!, args[2]!, env);
  if (action === "verify" && args.length === 1) return verify(args[0]!, env);
  if (action === "finish-invalid" && args.length === 2) {
    if (env.FLEET_ID !== "owner" || !/^(lid-not-slept|wifi-not-disconnected|reclaim-timeout|unexpected-sequence|operator-stop)$/.test(args[1]!)) throw new Error("owner-reviewed-invalid-receipt-required");
    const dir = packetDir(env); const packet = loadPacket(dir, args[0]!);
    packet.state = "invalid"; packet.receipt = { result: "lease-lost", verified: false };
    writeJsonAtomic(packetPath(dir, args[0]!), packet);
    rmSync(join(dir, ".g6-physical-active.json"), { force: false });
    console.log(JSON.stringify({ trialId: args[0], state: "invalid", reason: args[1] }));
    return;
  }
  throw new Error("usage: prepare <trial-id> <prior-passed-trial-count> | observe <trial-id> <yuri|yojimbo> <timeout-ms> | hold <trial-id> <job-key> <capability> | reclaim <trial-id> <job-key> <capability> | verify <trial-id> | finish-invalid <trial-id> <reviewed-reason>");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  g6PhysicalDrill().catch((error: unknown) => {
    const code = error instanceof Error ? error.message.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80) : "unexpected-error";
    console.error(JSON.stringify({ phase: "g6-physical-drill", code }));
    process.exitCode = 1;
  });
}
