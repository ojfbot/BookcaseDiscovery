import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JobStore } from "../src/run/jobs.ts";
import type { ServiceSnapshot } from "../src/run/vendor/fleet-runner/status.ts";
import {
  APP_MAIN_PIN,
  APP_VENDOR_CORE_PIN,
  FIXTURE_BYTES,
  FIXTURE_SHA256,
  HISTORICAL_PROOF_FIXTURE_DONE,
  HISTORICAL_READ_VISION_DONE,
  NAS_BUILD_LABEL,
  NAS_IMAGE_ID,
  assertCandidateSnapshot,
  assertPriorPassedTrialCount,
  capabilityFor,
  preflightThenLock,
  proofFixtureSpec,
  privateEvidenceDirectory,
  validatePhysicalEvents,
  validatePhysicalSchedule,
  validateTlsEnvironment,
  yuriWindowAllowed,
} from "../src/run/g6-physical-drill.ts";

const temporaryDirectories: string[] = [];
function temporaryDirectory() {
  const dir = mkdtempSync(join(tmpdir(), "g6-physical-check-"));
  temporaryDirectories.push(dir);
  return dir;
}
afterEach(() => { for (const dir of temporaryDirectories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function snapshot(passedTrials = 0): ServiceSnapshot {
  const now = Date.now();
  const proofDone = HISTORICAL_PROOF_FIXTURE_DONE + passedTrials;
  return {
    schemaVersion: 1,
    revision: "fixture",
    generatedAt: now,
    cursor: 28,
    service: { id: "instance", startedAt: now - 1000, starts: 1, trackedSince: now - 10_000, version: "0.1.0", build: NAS_BUILD_LABEL, ready: true, reasons: [], uptimeSeconds: 1 },
    queue: { ready: 0, claimed: 0, done: HISTORICAL_READ_VISION_DONE + proofDone, failed: 0 },
    leases: { active: 0, expired: 0 },
    kinds: [
      { kind: "read-vision", ready: 0, claimed: 0, done: HISTORICAL_READ_VISION_DONE, failed: 0 },
      { kind: "proof-fixture", ready: 0, claimed: 0, done: proofDone, failed: 0 },
    ],
    workers: [], events: [], backup: { state: "unqualified", lastVerifiedAt: null },
  };
}

describe("bounded current-runtime G6 physical adapter", () => {
  it("pins the fixed synthetic fixture and makes each job claimable only with its per-trial capability", () => {
    const cap = capabilityFor("lid-1", "a".repeat(32));
    const spec = proofFixtureSpec("lid-1", cap, APP_MAIN_PIN);
    const digest = createHash("sha256").update(FIXTURE_BYTES).digest("hex");
    expect(digest).toBe(FIXTURE_SHA256);
    expect(spec).toMatchObject({ kind: "proof-fixture", inputs: [], payload: null, requires: [cap], params: { trialId: "lid-1", fixtureSha256: FIXTURE_SHA256 } });
    expect(() => proofFixtureSpec("lid-1", capabilityFor("lid-1", "b".repeat(32)), APP_VENDOR_CORE_PIN)).not.toThrow();

    const dir = temporaryDirectory();
    const store = new JobStore(join(dir, "jobs.sqlite"));
    try {
      store.enqueue(spec);
      expect(store.claim("resident-read-vision", ["apple-vision", "host-yuri"], ["read-vision"])).toBeUndefined();
      expect(store.claim("dedicated-g6", [cap], ["proof-fixture"])).toMatchObject({ kind: "proof-fixture", params: { trialId: "lid-1" } });
    } finally { store.close(); }
  });

  it("preserves the ten historical fixtures and four real read-vision outputs", () => {
    expect(() => assertCandidateSnapshot(snapshot(), 0)).not.toThrow();
    expect(() => assertCandidateSnapshot(snapshot(1), 1)).not.toThrow();
    expect(() => assertCandidateSnapshot(snapshot(6), 6)).not.toThrow();
    const wrongFixtureCount = snapshot(); wrongFixtureCount.kinds[1]!.done = 9; wrongFixtureCount.queue.done = 13;
    expect(() => assertCandidateSnapshot(wrongFixtureCount, 0)).toThrow(/ten-plus-passed-trials/);
    const changedVision = snapshot(); changedVision.kinds[0]!.done = 5;
    expect(() => assertCandidateSnapshot(changedVision, 0)).toThrow(/historical-four-read-vision/);
  });

  it("creates the active lock only after signed status passes the exact historical baseline", async () => {
    let lockCreated = false;
    const createLock = () => { lockCreated = true; };
    const invalid = snapshot(); invalid.kinds[0]!.done = 14;
    await expect(preflightThenLock({ status: async () => invalid }, 0, createLock)).rejects.toThrow(/historical-four-read-vision/);
    expect(lockCreated).toBe(false);
    const valid = await preflightThenLock({ status: async () => snapshot() }, 0, createLock);
    expect(valid.queue.done).toBe(14);
    expect(lockCreated).toBe(true);
  });

  it("allows verification of trial six but rejects a seventh admission before status or lock", async () => {
    expect(() => assertCandidateSnapshot(snapshot(6), 6)).not.toThrow();
    expect(() => assertPriorPassedTrialCount(6)).toThrow(/invalid-prior-trial-count/);
    let statusRead = false;
    let lockCreated = false;
    await expect(preflightThenLock({ status: async () => { statusRead = true; return snapshot(6); } }, 6, () => { lockCreated = true; }))
      .rejects.toThrow(/invalid-prior-trial-count/);
    expect(statusRead).toBe(false);
    expect(lockCreated).toBe(false);
  });

  it("requires an absolute evidence path and verifies the directory is private", () => {
    const dir = temporaryDirectory();
    expect(privateEvidenceDirectory({ G6_EVIDENCE_DIR: dir } as NodeJS.ProcessEnv)).toBe(dir);
    expect(() => privateEvidenceDirectory({ G6_EVIDENCE_DIR: "relative-evidence" } as NodeJS.ProcessEnv)).toThrow(/absolute-private/);
    const symlink = join(dir, "evidence-link"); symlinkSync(dir, symlink, "dir");
    expect(() => privateEvidenceDirectory({ G6_EVIDENCE_DIR: symlink } as NodeJS.ProcessEnv)).toThrow(/mode-0700/);
    chmodSync(dir, 0o755);
    expect(() => privateEvidenceDirectory({ G6_EVIDENCE_DIR: dir } as NodeJS.ProcessEnv)).toThrow(/mode-0700/);
  });

  it("enforces Yuri AC/night policy and accepts only a short existing owner exception", () => {
    expect(yuriWindowAllowed(new Date("2026-11-10T02:30:00Z"), "Now drawing from 'AC Power'\n")).toBe("night-ac");
    expect(yuriWindowAllowed(new Date("2026-11-10T02:30:00Z"), "Now drawing from 'Battery Power'\n")).toBe(false);
    const noon = new Date("2026-11-10T18:00:00Z");
    expect(yuriWindowAllowed(noon, "Now drawing from 'AC Power'\n", "2026-11-10T18:10:00Z")).toBe("bounded-owner-exception");
    expect(yuriWindowAllowed(noon, "Now drawing from 'AC Power'\n", "2026-11-10T18:16:00Z")).toBe(false);
    expect(yuriWindowAllowed(noon, "Now drawing from 'Battery Power'\n", "2026-11-10T18:10:00Z")).toBe(false);
  });

  it("requires a signed claim-expiry-reclaim-completion-stale-rejection sequence", () => {
    const key = "a".repeat(64);
    const events = [
      { seq: 1, ts: 100, key, type: "claimed", worker: "yuri", fence: 1 },
      { seq: 2, ts: 310_100, key, type: "lease-expired", worker: "yuri", fence: 1 },
      { seq: 3, ts: 315_100, key, type: "claimed", worker: "yojimbo", fence: 2 },
      { seq: 4, ts: 315_200, key, type: "completed", worker: "yojimbo", fence: 2 },
      { seq: 5, ts: 315_300, key, type: "rejected-stale", worker: "yuri", fence: 1 },
    ];
    expect(validatePhysicalEvents(events, key).completed.worker).toBe("yojimbo");
    expect(() => validatePhysicalEvents(events.map((event) => event.type === "completed" ? { ...event, worker: "yuri" } : event), key)).toThrow(/completion-sequence/);
    const timing = validatePhysicalSchedule(315_100, [{ requestStartedAt: 10_000, acceptedAt: 10_100, accepted: true }]);
    expect(timing.elapsed_upper_bound_ms).toBe(305_100);
    expect(() => validatePhysicalSchedule(320_101, [{ requestStartedAt: 10_000, acceptedAt: 10_100, accepted: true }])).toThrow(/L-plus-2P/);
  });

  it("requires HTTPS, the existing public CA, and a private local signing token", () => {
    const dir = temporaryDirectory();
    const ca = join(dir, "ca.pem"); const token = join(dir, "worker.pem");
    writeFileSync(ca, "synthetic public CA fixture\n"); writeFileSync(token, "synthetic signing key fixture\n"); chmodSync(token, 0o600);
    const env = { FLEET_ENDPOINT: "https://nas.example.invalid/", NODE_EXTRA_CA_CERTS: ca, FLEET_TOKEN_FILE: token } as NodeJS.ProcessEnv;
    expect(() => validateTlsEnvironment(env)).not.toThrow();
    expect(() => validateTlsEnvironment({ ...env, FLEET_ENDPOINT: "http://nas.example.invalid/" })).toThrow(/https-endpoint/);
    expect(() => validateTlsEnvironment({ ...env, NODE_TLS_REJECT_UNAUTHORIZED: "0" })).toThrow(/tls-verification/);
  });
});
