import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ocrHelperId, readVisionHandler, readVisionJob } from "../src/run/job-kinds.ts";
import { JobError, JobStore, canonicalJson, jobKey, runWorker, writeOutput } from "../src/run/jobs.ts";
import type { JobHandler, JobOutput, JobSpec } from "../src/run/jobs.ts";
import type { ReadVisionItem } from "../src/run/job-kinds.ts";
import { main } from "../src/run/index.ts";

const LEASE = 60_000;
let dir: string;
let clock: number;
let store: JobStore;

const out = (sha256: string): JobOutput => ({ file: `${sha256}.jsonl`, sha256 });
const sha = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");

const spec = (n: number, extra: Partial<JobSpec> = {}): JobSpec => ({
  kind: "noop",
  inputs: [`sha-${n}`],
  model: { id: "m", revision: "1" },
  code: "c1",
  payload: { n },
  ...extra,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bcd-jobs-"));
  clock = 1_000_000;
  store = new JobStore(join(dir, "jobs.sqlite"), { now: () => clock, leaseMs: LEASE });
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("job key", () => {
  it("ignores object key order and the payload, but not the model revision or code", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    const a = spec(1);
    expect(jobKey(a)).toBe(jobKey({ ...a, payload: { somewhere: "else" } }));
    expect(jobKey(a)).not.toBe(jobKey({ ...a, model: { id: "m", revision: "2" } }));
    expect(jobKey(a)).not.toBe(jobKey({ ...a, code: "c2" }));
    expect(jobKey(a)).not.toBe(jobKey({ ...a, params: { tile: 3100 } }));
  });

  it("keys what a read-vision job executes, and not where this host keeps the image", () => {
    const img = join(dir, "wc.jpg");
    writeFileSync(img, "synthetic working copy");
    const items: ReadVisionItem[] = [{ id: "a", polygon: [[0, 0], [9, 0], [9, 9], [0, 9]], rotations: [0] }];
    const base = readVisionJob(img, items, "helper@1");
    const moved = readVisionJob(img, items, "helper@1", { payload: { image: "/elsewhere/wc.jpg" } });
    expect(jobKey(moved)).toBe(jobKey(base));
    expect(base.inputs).toEqual([sha("synthetic working copy")]);
    expect(jobKey(readVisionJob(img, [{ ...items[0]!, rotations: [90] }], "helper@1"))).not.toBe(jobKey(base));
    expect(jobKey(readVisionJob(img, items, "helper@2"))).not.toBe(jobKey(base));
  });
});

describe("JobStore", () => {
  it("admits a key once", () => {
    expect(store.enqueue(spec(1)).created).toBe(true);
    expect(store.enqueue(spec(1)).created).toBe(false);
    expect(store.report().now.byKind.noop).toEqual({ ready: 1, claimed: 0, done: 0, failed: 0 });
  });

  it("claims by priority, and only jobs whose capabilities and kind the worker has", () => {
    const low = store.enqueue(spec(1)).key;
    const high = store.enqueue(spec(2, { priority: 5 })).key;
    const gpu = store.enqueue(spec(3, { priority: 9, requires: ["mps"] })).key;
    const other = store.enqueue(spec(4, { kind: "render", priority: 10 })).key;
    expect(store.claim("w1", [], ["noop"])?.key).toBe(high);
    expect(store.claim("w1", [], ["noop"])?.key).toBe(low);
    expect(store.claim("w1", [], ["noop"])).toBeUndefined();
    expect(store.claim("w2", ["mps"], ["noop"])?.key).toBe(gpu);
    expect(store.claim("w3", [])?.key).toBe(other);
  });

  it("fences a worker that wakes after its lease expired", () => {
    const { key } = store.enqueue(spec(1));
    const first = store.claim("sleepy", [])!;
    expect(store.heartbeat(key, first.fence, "sleepy")).toBe(true);
    clock += LEASE + 1;
    expect(store.heartbeat(key, first.fence, "sleepy")).toBe(false);
    const second = store.claim("awake", [])!;
    expect(second.key).toBe(key);
    expect(second.fence).toBe(first.fence + 1);
    expect(store.complete(key, first.fence, "sleepy", out("old"))).toBe(false);
    expect(store.complete(key, second.fence, "awake", out("new"))).toBe(true);
    expect(store.get(key)).toMatchObject({ status: "done", output: "new", outputFile: "new.jsonl", attempts: 2 });
    const { period } = store.report();
    expect(period.events["lease-expired"]).toBe(1);
    expect(period.byWorker.sleepy).toMatchObject({ leaseExpired: 1, staleRejected: 1 });
    expect(period.byWorker.awake?.completed).toBe(1);
  });

  it("keeps the accepted artifact when a stale worker writes after losing its lease (two connections)", () => {
    const { key } = store.enqueue(spec(1));
    const other = new JobStore(join(dir, "jobs.sqlite"), { now: () => clock, leaseMs: LEASE });
    try {
      const a = store.claim("a", [])!;
      clock += LEASE + 1; // A sleeps through its lease
      const b = other.claim("b", [])!;
      const bOut = writeOutput(join(dir, "out"), b, "bytes from B\n");
      expect(other.complete(key, b.fence, "b", bOut)).toBe(true);
      // A wakes, writes its bytes and tries to complete.
      const aOut = writeOutput(join(dir, "out"), a, "bytes from A\n");
      expect(aOut.file).not.toBe(bOut.file);
      expect(store.complete(key, a.fence, "a", aOut)).toBe(false);
      const row = other.get(key)!;
      const accepted = readFileSync(join(dir, "out", row.outputFile!));
      expect(sha(accepted)).toBe(row.output);
      expect(accepted.toString()).toBe("bytes from B\n");
    } finally {
      other.close();
    }
  });

  it("never overwrites an attempt's output file", () => {
    const job = { key: "k", fence: 1 };
    writeOutput(join(dir, "out"), job, "first");
    expect(() => writeOutput(join(dir, "out"), job, "second")).toThrow(/EEXIST/);
    expect(readFileSync(join(dir, "out", "k.1.jsonl"), "utf8")).toBe("first");
    expect(readdirSync(join(dir, "out"))).toEqual(["k.1.jsonl"]);
  });

  it("reads the clock for a heartbeat after taking the write lock", async () => {
    store.close();
    store = new JobStore(join(dir, "jobs.sqlite"), { leaseMs: 1000 }); // real clock
    const { key } = store.enqueue(spec(1));
    const c = store.claim("w", [])!;
    // Another process holds the write lock for 1.2 s, past this 1 s lease.
    const holder = spawn(
      process.execPath,
      [
        "-e",
        `const { DatabaseSync } = require("node:sqlite");
         const db = new DatabaseSync(process.argv[1]);
         db.exec("BEGIN IMMEDIATE");
         process.stdout.write("locked\\n");
         Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200);
         db.exec("COMMIT");`,
        join(dir, "jobs.sqlite"),
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    await new Promise<void>((resolve) => holder.stdout.once("data", () => resolve()));
    expect(store.heartbeat(key, c.fence, "w")).toBe(false); // blocks on the lock, then sees the lease expired
    await new Promise((resolve) => holder.once("close", resolve));
  });

  it("upgrades a v1 table in place", () => {
    store.close();
    const path = join(dir, "v1.sqlite");
    const db = new DatabaseSync(path);
    db.exec(`CREATE TABLE jobs (key TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, requires TEXT NOT NULL, priority INTEGER NOT NULL,
      status TEXT NOT NULL, attempts INTEGER NOT NULL, max_attempts INTEGER NOT NULL, fence INTEGER NOT NULL, worker TEXT, lease_expires INTEGER,
      output TEXT, error TEXT, created INTEGER NOT NULL, updated INTEGER NOT NULL);
      CREATE TABLE job_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, key TEXT NOT NULL, type TEXT NOT NULL, worker TEXT, fence INTEGER, detail TEXT);
      INSERT INTO jobs VALUES ('old', 'noop', '{}', '[]', 0, 'done', 1, 3, 1, NULL, NULL, 'h', NULL, 1, 1);
      INSERT INTO jobs VALUES ('waiting', 'noop', '{}', '[]', 0, 'ready', 0, 3, 0, NULL, NULL, NULL, NULL, 1, 1);
      PRAGMA user_version = 1;`);
    db.close();
    store = new JobStore(path, { now: () => clock, leaseMs: LEASE });
    // v1 rows cannot run (no keyed basis) or serve as cache hits (no accepted file): all are retired.
    expect(store.get("old")).toBeUndefined();
    expect(store.get("waiting")).toBeUndefined();
    const retired = new DatabaseSync(path);
    expect(retired.prepare("SELECT key, detail FROM job_events WHERE type = 'retired' ORDER BY key").all()).toEqual([
      { key: "old", detail: "schema-v1:done" },
      { key: "waiting", detail: "schema-v1:ready" },
    ]);
    expect(retired.prepare("PRAGMA user_version").get()).toEqual({ user_version: 2 });
    retired.close();
    expect(store.enqueue(spec(1)).created).toBe(true);
  });

  it("retries a retryable failure until max attempts, then fails it with its code", () => {
    const { key } = store.enqueue(spec(1, { maxAttempts: 2 }));
    let c = store.claim("w", [])!;
    expect(store.fail(key, c.fence, "w", "ocr-helper", true)).toBe(true);
    expect(store.get(key)?.status).toBe("ready");
    c = store.claim("w", [])!;
    store.fail(key, c.fence, "w", "ocr-helper", true);
    expect(store.get(key)).toMatchObject({ status: "failed", error: "ocr-helper" });
    expect(store.report().now.failures).toEqual([{ kind: "noop", error: "ocr-helper", count: 1 }]);
  });

  it("releases an interrupted job without spending an attempt", () => {
    const { key } = store.enqueue(spec(1, { maxAttempts: 1 }));
    const c = store.claim("w", [])!;
    expect(store.release(key, c.fence, "w")).toBe(true);
    expect(store.get(key)).toMatchObject({ status: "ready", attempts: 0 });
    expect(store.release(key, c.fence, "w")).toBe(false);
  });

  it("keeps a v1 worker that is mid-claim at the upgrade fenced out, and closes its attempt in the report", () => {
    store.close();
    const path = join(dir, "v1-live.sqlite");
    const key = jobKey(spec(1));
    const v1 = new DatabaseSync(path); // stays open: the v1 worker's own connection
    v1.exec(`CREATE TABLE jobs (key TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, requires TEXT NOT NULL, priority INTEGER NOT NULL,
      status TEXT NOT NULL, attempts INTEGER NOT NULL, max_attempts INTEGER NOT NULL, fence INTEGER NOT NULL, worker TEXT, lease_expires INTEGER,
      output TEXT, error TEXT, created INTEGER NOT NULL, updated INTEGER NOT NULL);
      CREATE TABLE job_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, key TEXT NOT NULL, type TEXT NOT NULL, worker TEXT, fence INTEGER, detail TEXT);
      PRAGMA user_version = 1;`);
    const claimedAt = clock;
    v1.prepare("INSERT INTO jobs VALUES (?, 'noop', '{}', '[]', 0, 'claimed', 1, 3, 1, 'w', ?, NULL, NULL, ?, ?)").run(key, claimedAt + LEASE, claimedAt, claimedAt);
    v1.prepare("INSERT INTO job_events (ts, key, type, worker, fence) VALUES (?, ?, 'claimed', 'w', 1)").run(claimedAt, key);
    try {
      clock += 2_000;
      store = new JobStore(path, { now: () => clock, leaseMs: LEASE }); // upgrade while the v1 claim is live
      expect(store.enqueue(spec(1)).created).toBe(true); // readmitted
      const c = store.claim("w", [])!; // same worker id as the v1 holder
      expect(c.fence).toBe(2);
      // The v1 worker finishes and runs v1's completion statement with its old token.
      const v1Complete = v1
        .prepare("UPDATE jobs SET status = 'done', output = ?, error = NULL, lease_expires = NULL, updated = ? WHERE key = ? AND status = 'claimed' AND fence = ? AND worker = ? AND lease_expires > ?")
        .run("v1-bytes", clock, key, 1, "w", clock);
      expect(Number(v1Complete.changes)).toBe(0);
      expect(store.get(key)).toMatchObject({ status: "claimed", fence: 2 });
      // The retired v1 attempt counts its 2 s up to retirement, and stops there.
      clock += 10_000;
      const w = store.report(claimedAt).period.byWorker.w!;
      expect(w.retired).toBe(1);
      expect(w.machineSeconds).toBe(2 + 10); // 2 s retired v1 attempt + 10 s of the running v2 claim
      clock += 10_000;
      expect(store.report(claimedAt).period.byWorker.w!.machineSeconds).toBe(2 + 20);
    } finally {
      v1.close();
    }
  });

  it("separates the table's state now from what happened in the period, and clips attempts to it", () => {
    const a = store.enqueue(spec(1)).key;
    const b = store.enqueue(spec(2)).key;
    const ca = store.claim("w", [])!; // starts before the period
    clock += 10_000;
    const since = clock;
    clock += 5_000;
    expect(store.complete(a, ca.fence, "w", out("x"))).toBe(true); // 5 s inside the period
    const cb = store.claim("w", [])!;
    clock += 3_000;
    expect(store.release(b, cb.fence, "w")).toBe(true); // released: 3 s
    store.claim("w", []);
    clock += 2_000; // still running at report time: 2 s
    const r = store.report(since);
    expect(r.now.byKind.noop).toEqual({ ready: 0, claimed: 1, done: 1, failed: 0 });
    expect(r.period.events).toEqual({ completed: 1, claimed: 2, released: 1 });
    expect(r.period.byWorker.w).toEqual({ completed: 1, failed: 0, released: 1, leaseExpired: 0, retired: 0, staleRejected: 0, machineSeconds: 10 });
  });

  it("counts leased time only until the lease actually ran out, and nothing for a future window", () => {
    const a = store.enqueue(spec(1)).key;
    const c = store.claim("sleepy", [])!;
    const start = clock;
    clock += LEASE + 30_000; // slept well past the lease; nobody has swept yet
    expect(store.report(start).period.byWorker.sleepy?.machineSeconds).toBe(LEASE / 1000);
    store.sweep(); // noticed 30 s late
    const after = store.report(start).period;
    expect(after.byWorker.sleepy).toMatchObject({ leaseExpired: 1, machineSeconds: LEASE / 1000 });
    expect(store.report(clock + 60_000).period.byWorker).toEqual({});
    expect(store.complete(a, c.fence, "sleepy", out("late"))).toBe(false);
  });

  it("keeps job events append-only", () => {
    store.enqueue(spec(1));
    const db = new DatabaseSync(join(dir, "jobs.sqlite"));
    expect(() => db.exec("DELETE FROM job_events")).toThrow(/append-only/);
    db.close();
  });
});

describe("runWorker", () => {
  const outDir = () => join(dir, "out");
  const echo: JobHandler = async (job, ctx) => writeOutput(ctx.outDir, job, JSON.stringify(job.payload));

  it("runs every runnable job and writes outputs atomically", async () => {
    for (const n of [1, 2, 3]) store.enqueue(spec(n));
    const s = await runWorker(store, { worker: "w", caps: [], handlers: { noop: echo }, outDir: outDir() });
    expect(s).toEqual({ completed: 3, failed: 0, staleRejected: 0, released: 0 });
    const files = readdirSync(outDir());
    expect(files).toHaveLength(3);
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
  });

  it("records a handler's error code and does not retry a non-retryable one", async () => {
    const { key } = store.enqueue(spec(1));
    const bad: JobHandler = async () => {
      throw new JobError("image-unreadable", false);
    };
    const s = await runWorker(store, { worker: "w", caps: [], handlers: { noop: bad }, outDir: outDir() });
    expect(s.failed).toBe(1);
    expect(store.get(key)).toMatchObject({ status: "failed", error: "image-unreadable" });
  });

  it("releases the current job when interrupted", async () => {
    const { key } = store.enqueue(spec(1));
    const ac = new AbortController();
    const slow: JobHandler = async (_job, { signal }) => {
      ac.abort();
      if (signal.aborted) throw new JobError("interrupted", true);
      return out("never");
    };
    const s = await runWorker(store, { worker: "w", caps: [], handlers: { noop: slow }, outDir: outDir(), signal: ac.signal });
    expect(s.released).toBe(1);
    expect(store.get(key)).toMatchObject({ status: "ready", attempts: 0 });
  });

  it("does not complete a job whose lease was lost mid-run", async () => {
    const { key } = store.enqueue(spec(1));
    const stalls: JobHandler = async () => {
      clock += LEASE + 1; // the host slept through its lease
      return out("late");
    };
    const s = await runWorker(store, { worker: "w", caps: [], handlers: { noop: stalls }, outDir: outDir(), maxJobs: 1 });
    expect(s.staleRejected).toBe(1);
    expect(store.get(key)?.status).not.toBe("done");
  });
});

describe("read-vision job kind", () => {
  const fake = fileURLToPath(new URL("./support/fake-ocr-helper.mjs", import.meta.url));
  const item = (id: string): ReadVisionItem => ({
    id,
    polygon: [
      [10, 10],
      [50, 10],
      [50, 200],
      [10, 200],
    ],
    rotations: [0],
  });
  const helper = (mode: string, helperId = "fake@1") => ({ "read-vision": readVisionHandler({ binary: process.execPath, args: [fake, mode], helperId }) });
  let image: string;
  beforeEach(() => {
    image = join(dir, "working-copy.jpg");
    writeFileSync(image, "synthetic working copy");
  });

  it("writes the helper's responses as this attempt's file, and only on a host with the capability", async () => {
    const { key } = store.enqueue(readVisionJob(image, [item("a"), item("b")], "fake@1"));
    expect((await runWorker(store, { worker: "w", caps: [], handlers: helper("echo"), outDir: join(dir, "out") })).completed).toBe(0);
    const s = await runWorker(store, { worker: "w", caps: ["apple-vision"], handlers: helper("echo"), outDir: join(dir, "out") });
    expect(s.completed).toBe(1);
    const row = store.get(key)!;
    expect(row.outputFile).toBe(`${key}.1.jsonl`);
    const bytes = readFileSync(join(dir, "out", row.outputFile!));
    expect(sha(bytes)).toBe(row.output);
    expect(bytes.toString().trim().split("\n").map((l) => JSON.parse(l).id)).toEqual(["a", "b"]);
  });

  it("refuses a job pinned to another helper build, or whose working copy changed", async () => {
    const pinned = store.enqueue(readVisionJob(image, [item("a")], "fake@0")).key;
    await runWorker(store, { worker: "w", caps: ["apple-vision"], handlers: helper("echo"), outDir: join(dir, "out") });
    expect(store.get(pinned)).toMatchObject({ status: "failed", error: "helper-mismatch" });
    const changed = store.enqueue(readVisionJob(image, [item("b")], "fake@1")).key;
    writeFileSync(image, "a different photo at the same path");
    await runWorker(store, { worker: "w", caps: ["apple-vision"], handlers: helper("echo"), outDir: join(dir, "out") });
    expect(store.get(changed)).toMatchObject({ status: "failed", error: "input-mismatch" });
  });

  it("hashes the helper on every attempt and runs a verified copy, so a rebuild at the same path cannot run under the old pin", async () => {
    const script = join(dir, "ocr-vision");
    const writeHelper = (mode: string): void => {
      writeFileSync(script, `#!/bin/sh\nexec "${process.execPath}" "${fake}" ${mode}\n`);
      chmodSync(script, 0o755);
    };
    writeHelper("echo");
    const pin = ocrHelperId(script);
    const handlers = { "read-vision": readVisionHandler({ binary: script }) };
    const first = store.enqueue(readVisionJob(image, [item("a")], pin)).key;
    expect((await runWorker(store, { worker: "w", caps: ["apple-vision"], handlers, outDir: join(dir, "out") })).completed).toBe(1);
    expect(store.get(first)?.status).toBe("done");
    expect(readdirSync(join(dir, "staged", "helpers"))).toEqual([`ocr-vision-${pin.split(":").pop()}`]);
    writeHelper("garbage"); // rebuilt in place
    const second = store.enqueue(readVisionJob(image, [item("b")], pin)).key;
    await runWorker(store, { worker: "w", caps: ["apple-vision"], handlers, outDir: join(dir, "out") });
    expect(store.get(second)).toMatchObject({ status: "failed", error: "helper-mismatch" });
  });

  it("fails retryably with an error code when the helper breaks its contract", async () => {
    const { key } = store.enqueue(readVisionJob(image, [item("a")], "fake@1", { maxAttempts: 1 }));
    await runWorker(store, { worker: "w", caps: ["apple-vision"], handlers: helper("garbage"), outDir: join(dir, "out") });
    expect(store.get(key)).toMatchObject({ status: "failed", error: "ocr-helper" });
    expect(existsSync(join(dir, "out"))).toBe(false);
  });
});

describe("bookcase jobs", () => {
  it("is routed and prints usage", async () => {
    expect(await main(["jobs", "--help"])).toBe(0);
  });

  it("rejects a malformed spec by line number and code, without echoing its text", async () => {
    const specs = join(dir, "specs.jsonl");
    writeFileSync(specs, `${JSON.stringify(spec(1))}\n{"kind": "noop", "payload": "MARKER-PRIVATE-PATH"\n`);
    const errors: string[] = [];
    const original = console.error;
    console.error = (...a: unknown[]) => void errors.push(a.join(" "));
    try {
      expect(await main(["jobs", "enqueue", specs, "--db", join(dir, "cli.sqlite")])).toBe(1);
    } finally {
      console.error = original;
    }
    expect(errors.join("\n")).toMatch(/line 2: bad-json/);
    expect(errors.join("\n")).not.toMatch(/MARKER/);
    const cli = new JobStore(join(dir, "cli.sqlite"));
    expect(cli.report().now.byKind).toEqual({}); // nothing admitted from a file with a bad line
    cli.close();
  });
});
