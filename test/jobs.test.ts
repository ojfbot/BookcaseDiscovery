import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readVisionHandler } from "../src/run/job-kinds.ts";
import { JobError, JobStore, canonicalJson, jobKey, runWorker, writeOutput } from "../src/run/jobs.ts";
import type { JobHandler, JobSpec } from "../src/run/jobs.ts";
import { main } from "../src/run/index.ts";

const LEASE = 60_000;
let dir: string;
let clock: number;
let store: JobStore;

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
});

describe("JobStore", () => {
  it("admits a key once", () => {
    expect(store.enqueue(spec(1)).created).toBe(true);
    expect(store.enqueue(spec(1)).created).toBe(false);
    expect(store.report().byKind.noop).toEqual({ ready: 1, claimed: 0, done: 0, failed: 0 });
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
    expect(store.complete(key, first.fence, "sleepy", "old")).toBe(false);
    expect(store.complete(key, second.fence, "awake", "new")).toBe(true);
    expect(store.get(key)).toMatchObject({ status: "done", output: "new", attempts: 2 });
    const r = store.report();
    expect(r.events["lease-expired"]).toBe(1);
    expect(r.byWorker.sleepy?.staleRejected).toBe(1);
    expect(r.byWorker.awake?.completed).toBe(1);
  });

  it("retries a retryable failure until max attempts, then fails it with its code", () => {
    const { key } = store.enqueue(spec(1, { maxAttempts: 2 }));
    let c = store.claim("w", [])!;
    expect(store.fail(key, c.fence, "w", "ocr-helper", true)).toBe(true);
    expect(store.get(key)?.status).toBe("ready");
    c = store.claim("w", [])!;
    store.fail(key, c.fence, "w", "ocr-helper", true);
    expect(store.get(key)).toMatchObject({ status: "failed", error: "ocr-helper" });
    expect(store.report().failures).toEqual([{ kind: "noop", error: "ocr-helper", count: 1 }]);
  });

  it("releases an interrupted job without spending an attempt", () => {
    const { key } = store.enqueue(spec(1, { maxAttempts: 1 }));
    const c = store.claim("w", [])!;
    expect(store.release(key, c.fence, "w")).toBe(true);
    expect(store.get(key)).toMatchObject({ status: "ready", attempts: 0 });
    expect(store.release(key, c.fence, "w")).toBe(false);
  });

  it("keeps job events append-only", () => {
    store.enqueue(spec(1));
    const db = new DatabaseSync(join(dir, "jobs.sqlite"));
    expect(() => db.exec("DELETE FROM job_events")).toThrow(/append-only/);
    db.close();
  });
});

describe("runWorker", () => {
  const out = () => join(dir, "out");
  const echo: JobHandler = async (job, ctx) => writeOutput(ctx.outDir, job.key, JSON.stringify(job.payload));

  it("runs every runnable job and writes outputs atomically", async () => {
    for (const n of [1, 2, 3]) store.enqueue(spec(n));
    const s = await runWorker(store, { worker: "w", caps: [], handlers: { noop: echo }, outDir: out() });
    expect(s).toEqual({ completed: 3, failed: 0, staleRejected: 0, released: 0 });
    const files = readdirSync(out());
    expect(files).toHaveLength(3);
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
  });

  it("records a handler's error code and does not retry a non-retryable one", async () => {
    const { key } = store.enqueue(spec(1));
    const bad: JobHandler = async () => {
      throw new JobError("image-unreadable", false);
    };
    const s = await runWorker(store, { worker: "w", caps: [], handlers: { noop: bad }, outDir: out() });
    expect(s.failed).toBe(1);
    expect(store.get(key)).toMatchObject({ status: "failed", error: "image-unreadable" });
  });

  it("releases the current job when interrupted", async () => {
    const { key } = store.enqueue(spec(1));
    const ac = new AbortController();
    const slow: JobHandler = async (_job, { signal }) => {
      ac.abort();
      if (signal.aborted) throw new JobError("interrupted", true);
      return "never";
    };
    const s = await runWorker(store, { worker: "w", caps: [], handlers: { noop: slow }, outDir: out(), signal: ac.signal });
    expect(s.released).toBe(1);
    expect(store.get(key)).toMatchObject({ status: "ready", attempts: 0 });
  });

  it("does not complete a job whose lease was lost mid-run", async () => {
    const { key } = store.enqueue(spec(1));
    const stalls: JobHandler = async () => {
      clock += LEASE + 1; // the host slept through its lease
      return "late";
    };
    const s = await runWorker(store, { worker: "w", caps: [], handlers: { noop: stalls }, outDir: out(), maxJobs: 1 });
    expect(s.staleRejected).toBe(1);
    expect(store.get(key)?.status).not.toBe("done");
  });
});

describe("read-vision job kind", () => {
  const fake = fileURLToPath(new URL("./support/fake-ocr-helper.mjs", import.meta.url));
  const request = (id: string) => ({
    id,
    image: "/synthetic/working-copy.jpg",
    polygon: [
      [10, 10],
      [50, 10],
      [50, 200],
      [10, 200],
    ] as [number, number][],
    rotations: [0] as (0 | 90 | 180 | 270)[],
  });

  it("writes the helper's responses under the job key", async () => {
    const { key } = store.enqueue({ kind: "read-vision", inputs: ["sha-wc"], payload: { requests: [request("a"), request("b")] }, requires: ["apple-vision"] });
    const handlers = { "read-vision": readVisionHandler({ binary: process.execPath, args: [fake, "echo"] }) };
    expect((await runWorker(store, { worker: "w", caps: [], handlers, outDir: join(dir, "out") })).completed).toBe(0);
    const s = await runWorker(store, { worker: "w", caps: ["apple-vision"], handlers, outDir: join(dir, "out") });
    expect(s.completed).toBe(1);
    const lines = readFileSync(join(dir, "out", `${key}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("fails retryably with an error code when the helper breaks its contract", async () => {
    const { key } = store.enqueue({ kind: "read-vision", inputs: ["sha-wc"], payload: { requests: [request("a")] }, maxAttempts: 1 });
    const handlers = { "read-vision": readVisionHandler({ binary: process.execPath, args: [fake, "garbage"] }) };
    await runWorker(store, { worker: "w", caps: [], handlers, outDir: join(dir, "out") });
    expect(store.get(key)).toMatchObject({ status: "failed", error: "ocr-helper" });
    expect(existsSync(join(dir, "out", `${key}.jsonl`))).toBe(false);
  });
});

describe("bookcase jobs", () => {
  it("is routed and prints usage", async () => {
    expect(await main(["jobs", "--help"])).toBe(0);
  });
});
