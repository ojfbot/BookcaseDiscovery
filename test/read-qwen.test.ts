// Card N-1 `read-qwen`: synthetic only. A stub `python` stands in for read.py (no model, no GPU, no private data);
// the venv, lockfile and weights are a few synthetic files laid out the way the real ones are.
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OcrResponseSchema } from "../src/ledger/helper-contracts.ts";
import { JobError, JobStore, jobKey, runWorker } from "../src/run/jobs.ts";
import type { Claim, JobSpec } from "../src/run/jobs.ts";
import {
  checkReadQwenOutput,
  compareWithCached,
  detectReadQwen,
  modelDigest,
  READ_QWEN_GENERATION,
  READ_QWEN_MODEL_DIR,
  READ_QWEN_MODEL_REPO,
  readQwenCapability,
  readQwenHandler,
  readQwenJob,
  ReadQwenJobSchema,
} from "../src/run/read-qwen.ts";
import type { ReadQwenItem, ReadQwenOptions, ReadQwenPins } from "../src/run/read-qwen.ts";

const REVISION = "0123456789abcdef0123456789abcdef01234567";
const CROP = "rect;rot=fixed;clip=frame";
const LOCK: [string, string][] = [
  ["bookcase-label", "0.1.0"],
  ["mlx", "0.1.0"],
  ["mlx-metal", "0.1.0"],
  ["mlx-vlm", "0.1.0"],
  ["numpy", "2.0.0"],
  ["opencv-python", "4.10.0.84"],
  ["pillow", "11.0.0"],
  ["transformers", "4.57.0"],
];
const DISTS = ["mlx-0.1.0", "mlx_metal-0.1.0", "mlx_vlm-0.1.0", "numpy-2.0.0", "opencv_python-4.10.0.84", "pillow-11.0.0", "transformers-4.57.0"];
const SECRET_TEXT = "SYNTHETIC SPINE TEXT";

// read.py's contract as the handler drives it. It records each launch beside itself, refuses anything but the
// fixed arguments and staged paths, and answers by request id: `hang`, `crash`, `garbled` and `unreadable` misbehave.
const STUB = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const args = process.argv.slice(2);
if (args.join(" ") === "-I -V") { console.log("Python 3.12.99"); process.exit(0); }
fs.appendFileSync(path.join(path.dirname(process.argv[1]), "launched"), "1\\n");
if (args[0] !== "-I" || !/read-qwen-[0-9a-f]{64}\\.py$/.test(args[1]) || args.slice(2).join(" ") !== "--reader qwen --prompt spine") process.exit(7);
if (!fs.existsSync(path.join(process.env.BOOKCASE_DATA, "models", "${READ_QWEN_MODEL_DIR}", "config.json"))) process.exit(8);
if (process.env.HF_HUB_OFFLINE !== "1" || process.env.TRANSFORMERS_OFFLINE !== "1") process.exit(9);
let stuck = false;
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (stuck || !line.trim()) return;
  const req = JSON.parse(line);
  if (!req.image.includes(path.join("staged", "inputs"))) process.exit(10);
  const base = { id: req.id, reader: "qwen3-vl-4b-instruct-8bit", crop: req.crop };
  if (req.id === "hang") { stuck = true; setInterval(() => {}, 1000); return; }
  if (req.id === "crash") process.exit(3);
  if (req.id === "garbled") { console.log("{not json"); return; }
  if (req.id === "unreadable") { console.log(JSON.stringify({ ...base, error: "ValueError" })); return; }
  const variants = req.rotations.map((r) => ({ rotation: r, text: "${SECRET_TEXT} " + req.id + " " + r, confidence: 1 }));
  console.log(JSON.stringify({ ...base, variants, seconds: Math.random() }));
});
`;

let dir: string;
let helperDir: string;
let venv: string;
let modelDir: string;
let photo: string;
let input: string;
let pins: ReadQwenPins;

const sha = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const square = (n: number): ReadQwenItem["polygon"] => [[0, 0], [n, 0], [n, n], [0, n]];
const items = (...ids: string[]): ReadQwenItem[] => ids.map((id, i) => ({ id, polygon: square(10 + i), rotations: [90, 270] }));
const launches = (): number => (existsSync(join(venv, "bin", "launched")) ? readFileSync(join(venv, "bin", "launched"), "utf8").split("\n").length - 1 : 0);

function options(extra: ReadQwenOptions = {}): ReadQwenOptions {
  return { helperDir, venv, modelDir, stageDir: join(dir, "staged"), os: "macOS 0.0.0", resolveImage: (h) => (h === input ? photo : undefined), ...extra };
}

function claim(spec: JobSpec, fence = 1): Claim {
  return { key: jobKey(spec), kind: spec.kind, inputs: spec.inputs, params: spec.params ?? {}, code: spec.code ?? null, payload: spec.payload, fence, leaseExpires: Date.now() + 60_000 };
}

async function run(spec: JobSpec, extra: ReadQwenOptions = {}, fence = 1) {
  return readQwenHandler(options(extra))(claim(spec, fence), { signal: new AbortController().signal, outDir: join(dir, "out") });
}

async function failure(spec: JobSpec, extra: ReadQwenOptions = {}): Promise<{ code: string; retryable: boolean }> {
  try {
    await run(spec, extra);
  } catch (e) {
    expect(e).toBeInstanceOf(JobError);
    const { code, retryable } = e as JobError;
    return { code, retryable };
  }
  throw new Error("the handler accepted the job");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bcd-read-qwen-"));
  helperDir = join(dir, "helpers", "label");
  mkdirSync(helperDir, { recursive: true });
  writeFileSync(join(helperDir, "read.py"), "# synthetic stand-in for read.py\n");
  writeFileSync(join(helperDir, "pyproject.toml"), '[project]\nname = "bookcase-label"\n');
  writeFileSync(join(helperDir, "uv.lock"), "version = 1\n\n" + LOCK.map(([n, v]) => `[[package]]\nname = "${n}"\nversion = "${v}"\n`).join("\n"));

  venv = join(helperDir, ".venv");
  mkdirSync(join(venv, "bin"), { recursive: true });
  writeFileSync(join(venv, "pyvenv.cfg"), "version_info = 3.12\n");
  writeFileSync(join(venv, "bin", "python"), STUB);
  chmodSync(join(venv, "bin", "python"), 0o755);
  for (const d of DISTS) mkdirSync(join(venv, "lib", "python3.12", "site-packages", `${d}.dist-info`), { recursive: true });

  modelDir = join(dir, "data", "models", READ_QWEN_MODEL_DIR);
  const meta = join(modelDir, ".cache", "huggingface", "download");
  mkdirSync(meta, { recursive: true });
  writeFileSync(join(modelDir, "config.json"), '{"model_type": "synthetic"}\n');
  writeFileSync(join(modelDir, "model.safetensors"), randomBytes(4096));
  for (const f of ["config.json", "model.safetensors"]) writeFileSync(join(meta, `${f}.metadata`), `${REVISION}\nsynthetic-etag\n0\n`);

  photo = join(dir, "working-copy.jpg");
  writeFileSync(photo, randomBytes(2048));
  input = sha(readFileSync(photo));

  const detected = detectReadQwen({ helperDir, venv, modelDir });
  if (!detected.ok) throw new Error(`fixture not detected: ${detected.reason}`);
  pins = detected.pins;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("read-qwen pins", () => {
  it("detects the helper tree, Python version and weights, and names them in the capability", () => {
    expect(pins.code).toMatch(/^read-qwen@sha256:[0-9a-f]{64}$/);
    expect(pins.python).toBe("3.12.99");
    expect(pins.model).toEqual({ repo: READ_QWEN_MODEL_REPO, revision: REVISION, sha256: pins.model.sha256 });
    // The manifest `shasum -a 256` prints over the non-hidden files in byte order, hashed again.
    const manifest = ["config.json", "model.safetensors"].map((f) => `${sha(readFileSync(join(modelDir, f)))}  ${f}\n`).join("");
    expect(pins.model.sha256).toBe(sha(manifest));
    expect(pins.capability).toBe(`read-qwen-${pins.code.slice(-64, -52)}-${pins.model.sha256.slice(0, 12)}`);
    expect(pins.capability).toMatch(/^[a-z][a-z0-9-]{0,62}$/);
  });

  it("changes the helper pin with read.py or uv.lock, and the model pin with any weight or config byte", () => {
    writeFileSync(join(helperDir, "read.py"), "# changed\n");
    const changed = detectReadQwen({ helperDir, venv, modelDir });
    expect(changed.ok && changed.pins.code).not.toBe(pins.code);
    appendFileSync(join(modelDir, "config.json"), " ");
    expect(modelDigest(modelDir)).not.toBe(pins.model.sha256);
  });

  it("is not offered when the venv drifts from uv.lock, a needed package is missing, or the revision is unrecorded", () => {
    const site = join(venv, "lib", "python3.12", "site-packages");
    mkdirSync(join(site, "unlocked_extra-1.0.dist-info"));
    expect(detectReadQwen({ helperDir, venv, modelDir })).toEqual({ ok: false, reason: "helper-env" });
    rmSync(join(site, "unlocked_extra-1.0.dist-info"), { recursive: true });
    rmSync(join(site, "mlx_vlm-0.1.0.dist-info"), { recursive: true });
    expect(detectReadQwen({ helperDir, venv, modelDir })).toEqual({ ok: false, reason: "helper-env" });
    mkdirSync(join(site, "mlx_vlm-0.1.0.dist-info"));
    rmSync(join(modelDir, ".cache"), { recursive: true });
    expect(detectReadQwen({ helperDir, venv, modelDir })).toEqual({ ok: false, reason: "model-missing" });
    expect(detectReadQwen({ helperDir, venv: join(dir, "no-venv"), modelDir })).toEqual({ ok: false, reason: "helper-missing" });
  });

  it("keys every pin and the generation settings, and admits only a spec whose pins agree", () => {
    const spec = readQwenJob(input, items("s0"), CROP, pins);
    expect(spec.requires).toEqual(["mlx", pins.capability]);
    expect(spec.params?.generation).toEqual({ temperature: 0, maxTokens: 48 });
    expect(ReadQwenJobSchema.safeParse(spec).success).toBe(true);
    const other = { ...pins.model, sha256: "f".repeat(64) };
    expect(jobKey(readQwenJob(input, items("s0"), CROP, { ...pins, model: other }))).not.toBe(jobKey(spec));
    expect(jobKey(readQwenJob(input, items("s0"), CROP, { ...pins, code: `read-qwen@sha256:${"e".repeat(64)}` }))).not.toBe(jobKey(spec));
    expect(jobKey({ ...spec, payload: { image: "/elsewhere.jpg" } })).toBe(jobKey(spec));
    expect(ReadQwenJobSchema.safeParse({ ...spec, requires: ["mlx", readQwenCapability(pins.code, other.sha256)] }).success).toBe(false);
    expect(ReadQwenJobSchema.safeParse({ ...spec, model: { ...spec.model, revision: "1".repeat(40) } }).success).toBe(false);
    expect(ReadQwenJobSchema.safeParse({ ...spec, payload: { image: "/x.jpg" } }).success).toBe(false);
  });
});

describe("read-qwen handler", () => {
  it("reads a batch through the stub into ocr-response records, in request order, with deterministic bytes", async () => {
    const spec = readQwenJob(input, [...items("s2", "s0"), { id: "unreadable", polygon: square(5), rotations: [0] }], CROP, pins);
    const first = await run(spec, {}, 1);
    const second = await run(spec, {}, 2);
    expect(second.sha256).toBe(first.sha256);
    expect(launches()).toBe(2);
    const output = readFileSync(join(dir, "out", first.file), "utf8");
    const records = output.trimEnd().split("\n").map((l) => OcrResponseSchema.parse(JSON.parse(l)));
    expect(records.map((r) => r.id)).toEqual(["s2", "s0", "unreadable"]);
    expect(records[0]).toEqual({
      id: "s2",
      variants: [90, 270].map((rotation) => ({ rotation, langCorrection: false, text: `${SECRET_TEXT} s2 ${rotation}`, confidence: 1 })),
      version: { helper: pins.code, os: "macOS 0.0.0", requestRevision: 0 },
    });
    expect(records[2]).toEqual({ id: "unreadable", error: { code: "reader-error", message: "ValueError" } });
    expect(output).not.toContain("seconds");
    const job = ReadQwenJobSchema.parse(spec);
    expect(checkReadQwenOutput(job, output)).toEqual({ requests: 3, readings: 3, readerErrors: 1, problems: [] });
    // Verified copies are read-only and content-addressed.
    const staged = join(dir, "staged", "models", pins.model.sha256, "models", READ_QWEN_MODEL_DIR, "model.safetensors");
    expect(statSync(staged).mode & 0o222).toBe(0);
    expect(existsSync(join(dir, "staged", "inputs", `${input}.jpg`))).toBe(true);
  });

  it("rejects a helper pin mismatch before launch, without retrying", async () => {
    const spec = readQwenJob(input, items("s0"), CROP, { ...pins, code: `read-qwen@sha256:${"0".repeat(64)}` });
    expect(await failure(spec)).toEqual({ code: "helper-mismatch", retryable: false });
    writeFileSync(join(helperDir, "read.py"), "# rebuilt after admission\n");
    expect(await failure(readQwenJob(input, items("s0"), CROP, pins))).toEqual({ code: "helper-mismatch", retryable: false });
    writeFileSync(join(helperDir, "read.py"), "# synthetic stand-in for read.py\n");
    mkdirSync(join(venv, "lib", "python3.12", "site-packages", "unlocked_extra-1.0.dist-info"));
    expect(await failure(readQwenJob(input, items("s0"), CROP, pins))).toEqual({ code: "helper-env", retryable: false });
    expect(launches()).toBe(0);
  });

  it("rejects a model pin mismatch before launch, without retrying", async () => {
    const wrongHash = readQwenJob(input, items("s0"), CROP, { ...pins, model: { ...pins.model, sha256: "a".repeat(64) } });
    expect(await failure(wrongHash)).toEqual({ code: "model-mismatch", retryable: false });
    const wrongRevision = readQwenJob(input, items("s0"), CROP, { ...pins, model: { ...pins.model, revision: "b".repeat(40) } });
    expect(await failure(wrongRevision)).toEqual({ code: "model-mismatch", retryable: false });
    // Weights replaced at the same path after the pins were taken.
    writeFileSync(join(modelDir, "model.safetensors"), randomBytes(4096));
    expect(await failure(readQwenJob(input, items("s0"), CROP, pins))).toEqual({ code: "model-mismatch", retryable: false });
    expect(launches()).toBe(0);
    expect(await failure(readQwenJob(input, items("s0"), CROP, pins), { modelDir: join(dir, "absent") })).toEqual({ code: "model-missing", retryable: true });
  });

  it("rejects an input hash mismatch before launch, without retrying", async () => {
    const other = join(dir, "replaced.jpg");
    writeFileSync(other, randomBytes(2048));
    const spec = readQwenJob(input, items("s0"), CROP, pins);
    expect(await failure(spec, { resolveImage: () => other })).toEqual({ code: "input-mismatch", retryable: false });
    expect(await failure(spec, { resolveImage: () => undefined })).toEqual({ code: "input-missing", retryable: true });
    expect(launches()).toBe(0);
  });

  it("refuses generation settings, prompts or batches read.py does not run", async () => {
    const spec = readQwenJob(input, items("s0"), CROP, pins);
    const params = spec.params as Record<string, unknown>;
    for (const bad of [
      { ...params, generation: { temperature: 0.7, maxTokens: 48 } },
      { ...params, generation: { temperature: 0, maxTokens: 96 } },
      { ...params, prompt: "cover" },
      { ...params, crop: "anything" },
      { ...params, requests: items("s0", "s0") },
      { ...params, requests: items(...Array.from({ length: 257 }, (_, i) => `s${i}`)) },
    ])
      expect(await failure({ ...spec, params: bad })).toEqual({ code: "bad-spec", retryable: false });
    expect(launches()).toBe(0);
  });

  it("times out a stuck helper and fails the job after a bounded number of attempts", async () => {
    const store = new JobStore(join(dir, "jobs.sqlite"));
    try {
      const { key } = store.enqueue(readQwenJob(input, items("s0", "hang"), CROP, pins));
      const summary = await runWorker(store, { worker: "w", caps: ["mlx", pins.capability], handlers: { "read-qwen": readQwenHandler(options({ timeoutMs: 400 })) }, outDir: join(dir, "out") });
      expect(summary).toMatchObject({ completed: 0, failed: 2 });
      expect(store.get(key)).toMatchObject({ status: "failed", attempts: 2, error: "helper-timeout" });
    } finally {
      store.close();
    }
    expect(await failure(readQwenJob(input, items("crash"), CROP, pins))).toEqual({ code: "read-helper", retryable: true });
  });

  it("refuses helper output that breaks the contract, and the pass check flags a damaged output", async () => {
    expect(await failure(readQwenJob(input, items("garbled"), CROP, pins))).toEqual({ code: "helper-contract", retryable: false });
    const spec = readQwenJob(input, items("s0", "s1"), CROP, pins);
    const job = ReadQwenJobSchema.parse(spec);
    const output = readFileSync(join(dir, "out", (await run(spec)).file), "utf8");
    const [a, b] = output.trimEnd().split("\n");
    expect(checkReadQwenOutput(job, `${a}\n`).problems).toEqual(["count"]);
    expect(checkReadQwenOutput(job, `${b}\n${a}\n`).problems).toEqual(["order"]);
    expect(checkReadQwenOutput(job, `${a}\n${b}`).problems).toEqual(["unterminated"]);
    expect(checkReadQwenOutput(job, `${a}\n${b!.replace('"langCorrection":false,', "")}\n`).problems).toEqual(["count", "schema"]);
    expect(checkReadQwenOutput(job, output.replaceAll(pins.code, `read-qwen@sha256:${"9".repeat(64)}`)).problems).toEqual(["helper"]);
  });

  it("compares with F-0's cached Qwen readings by id and crop, ignoring timing", async () => {
    const spec = readQwenJob(input, items("s0", "s1", "s2"), CROP, pins);
    const job = ReadQwenJobSchema.parse(spec);
    const output = readFileSync(join(dir, "out", (await run(spec)).file), "utf8");
    const cached = (id: string, text: string, crop = CROP) =>
      JSON.stringify({ id, reader: "qwen3-vl-4b-instruct-8bit", crop, variants: [90, 270].map((rotation) => ({ rotation, text: `${text} ${rotation}`, confidence: 1 })), seconds: 2.5 });
    const cache = [cached("s0", `${SECRET_TEXT} s0`), cached("s1", "other"), cached("s2", `${SECRET_TEXT} s2`, "rect;rot=fixed")].join("\n");
    expect(compareWithCached(job, output, cache)).toEqual({ equal: 1, differ: 1, missing: 1 });
  });

  it("records nothing private in events, errors or logs", async () => {
    const store = new JobStore(join(dir, "jobs.sqlite"));
    const logs: string[] = [];
    const ids = ["s0", "hang", "garbled"];
    try {
      store.enqueue(readQwenJob(input, items("s0"), CROP, pins));
      store.enqueue(readQwenJob(input, items("hang"), CROP, pins, { maxAttempts: 1 }));
      store.enqueue(readQwenJob(input, items("garbled"), CROP, pins));
      store.enqueue(readQwenJob(input, items("s0"), CROP, { ...pins, model: { ...pins.model, sha256: "c".repeat(64) } }));
      const handler = readQwenHandler(options({ timeoutMs: 400 }));
      await runWorker(store, { worker: "w", caps: ["mlx", pins.capability, readQwenCapability(pins.code, "c".repeat(64))], handlers: { "read-qwen": handler }, outDir: join(dir, "out"), log: (l) => logs.push(l) });
    } finally {
      store.close();
    }
    const db = new DatabaseSync(join(dir, "jobs.sqlite"));
    const events = db.prepare("SELECT type, worker, detail FROM job_events").all() as { type: string; worker: string | null; detail: string | null }[];
    const errors = (db.prepare("SELECT error FROM jobs WHERE error IS NOT NULL").all() as { error: string }[]).map((r) => r.error);
    db.close();
    expect(errors.sort()).toEqual(["helper-contract", "helper-timeout", "model-mismatch"]);
    for (const e of events) expect(e.detail === null || /^[a-z-]+$/.test(e.detail)).toBe(true);
    for (const line of logs) expect(line).toMatch(/^jobs: read-qwen [0-9a-f]{12} (done in [0-9.]+ s|failed: [a-z-]+)$/);
    const recorded = JSON.stringify({ events, errors, logs });
    for (const secret of [dir, photo, input, SECRET_TEXT, ...ids.map((id) => `"${id}"`)]) expect(recorded).not.toContain(secret);
  });
});

describe("read.py, as the handler assumes it", () => {
  const source = readFileSync(new URL("../helpers/label/read.py", import.meta.url), "utf8");
  it("takes its generation settings, weight directory and reader name from code, not arguments", () => {
    expect(source).toContain(`self.max_tokens = 96 if prompt == "cover" else ${READ_QWEN_GENERATION.spine.maxTokens}`);
    expect(source).toContain("temperature=0.0");
    expect(source).toContain(`MODELS / "${READ_QWEN_MODEL_DIR}"`);
    expect(source).toContain('name = "qwen3-vl-4b-instruct-8bit"');
    expect(source).toContain('ap.add_argument("--reader", choices=["ppocr", "qwen"], required=True)');
    expect(source).not.toMatch(/^from \.|^import (appearance|imprint|probe|detect|outline)\b/m);
  });
});
