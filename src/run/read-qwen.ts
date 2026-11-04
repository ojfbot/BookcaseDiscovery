// Job kind `read-qwen` (docs/ops/compute-fleet.md §3, card N-1): Qwen3-VL-4B-Instruct 8-bit (MLX) spine reading
// through `helpers/label/read.py --reader qwen`, the same shape as `read-vision` (src/run/job-kinds.ts).
//
// Three pins are keyed, and each attempt checks all of them before anything is launched:
// - helper (`code`): a tree hash of the `helpers/label/` files read.py's Qwen path depends on (read.py itself,
//   pyproject.toml, uv.lock) plus the venv's Python version. The venv must also hold exactly the locked versions.
// - model (`params.model`): Hugging Face repo id, revision, and a SHA-256 over the weight and config files. The
//   claim does not carry `JobSpec.model`, so the handler verifies the copy in `params`.
// - input (`inputs[0]`): the working copy's SHA-256, resolved in this host's own store (as `fleet stage` puts it).
//
// read.py, the input and the weights run from verified, read-only, content-addressed copies under `staged/`,
// so nothing replaced at the original paths between the check and the launch can run under the old pins. The
// handler runs read.py with fixed arguments and a fixed environment; nothing from the payload reaches it. Its
// output is mapped onto the `ocr-response` contract (contracts/helpers/) without the per-crop timing, so the
// bytes depend only on the keyed basis and the host's numerics.
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { release } from "node:os";
import { extname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ConfidenceSchema, IdSchema, PolygonSchema, RotationSchema, Sha256Schema } from "../ledger/contracts.ts";
import { OcrResponseSchema, type OcrResponse } from "../ledger/helper-contracts.ts";
import { dataRoot } from "../ledger/images.ts";
import { canonicalJson, JobError, writeOutput } from "./jobs.ts";
import type { Claim, JobHandler, JobSpec } from "./jobs.ts";
import { stageVerified } from "./job-kinds.ts";

/** The weights read.py loads (`$BOOKCASE_DATA/models/<dir>`) and where they came from (docs/models/open-weights.md §5). */
export const READ_QWEN_MODEL_REPO = "mlx-community/Qwen3-VL-4B-Instruct-8bit";
export const READ_QWEN_MODEL_DIR = "qwen3-vl-4b-8bit";
/** read.py's `Qwen.name`, which it writes on every record. */
const READER_NAME = "qwen3-vl-4b-instruct-8bit";
/** read.py's fixed generation settings for each prompt. read.py takes none of them as arguments; test/read-qwen.test.ts checks the table against its source. */
export const READ_QWEN_GENERATION = { spine: { temperature: 0, maxTokens: 48 } } as const;
/** The `helpers/label/` files the Qwen path depends on: the script (no local imports) and the environment's lock. */
const HELPER_FILES = ["pyproject.toml", "read.py", "uv.lock"] as const;
/** Distributions read.py's Qwen path imports. The venv must hold them at their locked versions. */
const REQUIRED_DISTS = ["mlx", "mlx-metal", "mlx-vlm", "numpy", "opencv-python", "pillow", "transformers"];
/** One job is one batch for one GPU: bounded so its time budget and lease stay predictable. */
export const READ_QWEN_LIMITS = { maxRequests: 256, maxRotations: 4 } as const;
/** Time budget: model load, then per variant (one crop at one rotation). F-0 measured 1.5–2.5 s per crop. */
const LOAD_BUDGET_MS = 180_000;
const VARIANT_BUDGET_MS = 30_000;
/** read.py answers at most `maxTokens` per variant; anything far beyond is a broken helper, not a reading. */
const STDOUT_BYTES_PER_REQUEST = 64 * 1024;

const SHA = /^[0-9a-f]{64}$/;
const REVISION = /^[0-9a-f]{40}$/;
const CODE = /^read-qwen@sha256:([0-9a-f]{64})$/;
/** `cropName` (src/perceive/crop.ts), e.g. `rect;rot=fixed;clip=frame`. */
const CROP_NAME = /^(rect|face);rot=(fixed|long-axis|cover)(;clip=frame)?(;pad=[0-9]+(\.[0-9]+)?)?$/;

const REPO_HELPERS = fileURLToPath(new URL("../../helpers/label/", import.meta.url));

const sha256 = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");

const ReadQwenItemSchema = z.strictObject({
  id: IdSchema,
  polygon: PolygonSchema,
  rotations: z.array(RotationSchema).min(1).max(READ_QWEN_LIMITS.maxRotations),
});
export type ReadQwenItem = z.infer<typeof ReadQwenItemSchema>;

const ModelPinSchema = z.strictObject({
  repo: z.literal(READ_QWEN_MODEL_REPO),
  revision: z.string().regex(REVISION),
  sha256: Sha256Schema,
});
export type ReadQwenModelPin = z.infer<typeof ModelPinSchema>;

/** Keyed params of a `read-qwen` job, executed in this order. */
export const ReadQwenParamsSchema = z
  .strictObject({
    requests: z.array(ReadQwenItemSchema).min(1).max(READ_QWEN_LIMITS.maxRequests),
    /** The runner's crop method (`cropName`), passed to read.py as provenance. */
    crop: z.string().regex(CROP_NAME),
    /** read.py `--prompt`. Spines only for now; `cover` would be a second entry in {@link READ_QWEN_GENERATION}. */
    prompt: z.literal("spine"),
    generation: z.strictObject({
      temperature: z.literal(READ_QWEN_GENERATION.spine.temperature),
      maxTokens: z.literal(READ_QWEN_GENERATION.spine.maxTokens),
    }),
    model: ModelPinSchema,
  })
  .refine((p) => new Set(p.requests.map((r) => r.id)).size === p.requests.length, "request ids repeat")
  .refine((p) => p.requests.every((r) => new Set(r.rotations).size === r.rotations.length), "rotations repeat");
export type ReadQwenParams = z.infer<typeof ReadQwenParamsSchema>;

/** Payload of a `read-qwen` job run without a store: where this host keeps the working copy. Remote jobs have none. */
export interface ReadQwenPayload {
  image: string;
}

/** The capability a host offers when its helper and weights hash to these pins. Fits fleet-runner's label format. */
export function readQwenCapability(code: string, modelSha256: string): string {
  const helper = CODE.exec(code)?.[1];
  if (!helper || !SHA.test(modelSha256)) throw new Error("invalid read-qwen pins");
  return `read-qwen-${helper.slice(0, 12)}-${modelSha256.slice(0, 12)}`;
}

/** An admission file: exactly what {@link readQwenJob} builds, with the pins in agreement. */
export const ReadQwenJobSchema = z
  .strictObject({
    kind: z.literal("read-qwen"),
    inputs: z.tuple([Sha256Schema]),
    params: ReadQwenParamsSchema,
    model: z.strictObject({ id: z.literal(READ_QWEN_MODEL_REPO), revision: z.string().regex(REVISION) }),
    code: z.string().regex(CODE),
    payload: z.null(),
    requires: z.tuple([z.literal("mlx"), z.string()]),
    priority: z.number().int().optional(),
    maxAttempts: z.number().int().min(1).max(3).optional(),
  })
  .refine((s) => s.model.revision === s.params.model.revision, "model revision differs from params")
  .refine((s) => s.requires[1] === readQwenCapability(s.code, s.params.model.sha256), "capability differs from pins");
export type ReadQwenJob = z.infer<typeof ReadQwenJobSchema>;

/** One host's detected pins. Hashes of public code and weights only. */
export interface ReadQwenPins {
  code: string;
  model: ReadQwenModelPin;
  python: string;
  capability: string;
}

/** Admit-ready spec for one batch of spines from one working copy, keyed by its hash. Remote workers resolve it. */
export function readQwenJob(input: string, requests: ReadQwenItem[], crop: string, pins: Pick<ReadQwenPins, "code" | "model">, extra: Partial<JobSpec> = {}): JobSpec {
  const params: ReadQwenParams = { requests, crop, prompt: "spine", generation: { ...READ_QWEN_GENERATION.spine }, model: pins.model };
  return {
    kind: "read-qwen",
    inputs: [input],
    params: params as unknown as Record<string, unknown>,
    model: { id: pins.model.repo, revision: pins.model.revision },
    code: pins.code,
    payload: null,
    requires: ["mlx", readQwenCapability(pins.code, pins.model.sha256)],
    maxAttempts: 2,
    ...extra,
  };
}

// --- pins -------------------------------------------------------------------------------------------------

/** Where this host keeps the helper, its venv and the weights. Defaults: this checkout and `$BOOKCASE_DATA/models/`. */
export interface ReadQwenHost {
  helperDir?: string;
  venv?: string;
  modelDir?: string;
}

function hostPaths(host: ReadQwenHost) {
  const helperDir = host.helperDir ?? REPO_HELPERS;
  const venv = host.venv ?? join(helperDir, ".venv");
  return {
    helperDir,
    venv,
    python: join(venv, "bin", "python"),
    modelDir: host.modelDir ?? join(dataRoot(), "models", READ_QWEN_MODEL_DIR),
  };
}

const normalizeDist = (name: string): string => name.toLowerCase().replace(/[-_.]+/g, "-");

/** `name==version` for every package in a uv lockfile. */
function lockedDists(lock: string): Set<string> {
  const out = new Set<string>();
  for (const block of lock.split(/^\[\[package\]\]$/m).slice(1)) {
    const name = /^name = "([^"]+)"$/m.exec(block)?.[1];
    const version = /^version = "([^"]+)"$/m.exec(block)?.[1];
    if (name && version) out.add(`${normalizeDist(name)}==${version}`);
  }
  return out;
}

/** True when every distribution installed in the venv is a locked version and read.py's imports are all there. */
function venvMatchesLock(venv: string, python: string, lock: string): boolean {
  const minor = /^(3\.[0-9]+)\./.exec(python)?.[1];
  if (!minor) return false;
  let names: string[];
  try {
    names = readdirSync(join(venv, "lib", `python${minor}`, "site-packages"));
  } catch {
    return false;
  }
  const locked = lockedDists(lock);
  const installed = new Map<string, string>();
  for (const n of names) {
    const m = /^(.+)-([^-]+)\.dist-info$/.exec(n);
    if (m) installed.set(normalizeDist(m[1]!), m[2]!);
  }
  return (
    installed.size > 0 &&
    [...installed].every(([name, version]) => locked.has(`${name}==${version}`)) &&
    REQUIRED_DISTS.every((d) => installed.has(d))
  );
}

function pythonVersion(python: string): string {
  try {
    const out = execFileSync(python, ["-I", "-V"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    });
    const version = /^Python (3\.[0-9]+\.[0-9]+)\s*$/.exec(out)?.[1];
    if (version) return version;
  } catch {
    // Reported below: no interpreter is a missing helper, not a mismatch.
  }
  throw new JobError("helper-missing", true);
}

/**
 * The helper pin as this host has it: read.py's bytes (to stage), the tree hash and the Python version. Throws
 * `helper-missing` (retryable) when a file or the interpreter is absent and `helper-env` when the venv drifted
 * from uv.lock.
 */
function helperIdentity(host: ReturnType<typeof hostPaths>): { code: string; readPy: Buffer; python: string } {
  const files: Record<string, Buffer> = {};
  try {
    for (const f of HELPER_FILES) files[f] = readFileSync(join(host.helperDir, f));
  } catch {
    throw new JobError("helper-missing", true);
  }
  const python = pythonVersion(host.python);
  if (!venvMatchesLock(host.venv, python, files["uv.lock"]!.toString("utf8"))) throw new JobError("helper-env", false);
  const tree = { files: Object.fromEntries(HELPER_FILES.map((f) => [f, sha256(files[f]!)])), python };
  return { code: `read-qwen@sha256:${sha256(canonicalJson(tree))}`, readPy: files["read.py"]!, python };
}

/** The revision `hf download --local-dir` recorded for every file (`.cache/huggingface/download/*.metadata`, line 1). */
function modelRevision(modelDir: string): string {
  const dir = join(modelDir, ".cache", "huggingface", "download");
  let revisions: Set<string>;
  try {
    const metadata = readdirSync(dir).filter((f) => f.endsWith(".metadata"));
    revisions = new Set(metadata.map((f) => readFileSync(join(dir, f), "utf8").split("\n", 1)[0]!.trim()));
  } catch {
    throw new JobError("model-missing", true);
  }
  const [revision] = revisions;
  if (revisions.size !== 1 || !REVISION.test(revision!)) throw new JobError("model-missing", true);
  return revision!;
}

function sha256File(path: string): string {
  const hash = createHash("sha256");
  const buf = Buffer.allocUnsafe(8 * 1024 * 1024);
  const fd = openSync(path, "r");
  try {
    for (let n; (n = readSync(fd, buf, 0, buf.length, null)) > 0; ) hash.update(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

/** Every non-hidden file under `dir`, as `/`-joined relative paths in byte order. Symlinks are followed. */
function modelFiles(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(dir, rel))) {
    if (name.startsWith(".")) continue;
    const path = rel ? `${rel}/${name}` : name;
    const st = statSync(join(dir, path));
    if (st.isDirectory()) out.push(...modelFiles(dir, path));
    else if (st.isFile()) out.push(path);
    else throw new JobError("model-mismatch", false);
  }
  return rel ? out : out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The model pin's hash: SHA-256 of the manifest `<sha256>  <path>\n` over every non-hidden file (weights, config,
 * tokenizer, templates), in byte order of path. The same bytes `LC_ALL=C sort` and `shasum -a 256` print, so the
 * recipe in docs/fleet-worker-service.md reproduces it without this code.
 */
export function modelDigest(dir: string): string {
  const files = modelFiles(dir);
  if (files.length === 0) throw new JobError("model-missing", true);
  return sha256(files.map((f) => `${sha256File(join(dir, f))}  ${f}\n`).join(""));
}

/** Detect this host's pins. Hashes the weights (about 5 GB): call once per worker start, not per poll. */
export function detectReadQwen(host: ReadQwenHost = {}): { ok: true; pins: ReadQwenPins } | { ok: false; reason: string } {
  const paths = hostPaths(host);
  try {
    const { code, python } = helperIdentity(paths);
    if (!existsSync(paths.modelDir)) throw new JobError("model-missing", true);
    const model: ReadQwenModelPin = { repo: READ_QWEN_MODEL_REPO, revision: modelRevision(paths.modelDir), sha256: modelDigest(paths.modelDir) };
    return { ok: true, pins: { code, model, python, capability: readQwenCapability(code, model.sha256) } };
  } catch (e) {
    return { ok: false, reason: e instanceof JobError ? e.code : "detect-failed" };
  }
}

// --- staging ----------------------------------------------------------------------------------------------

function cloneTree(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const f of modelFiles(from)) {
    const dst = join(to, f);
    mkdirSync(join(dst, ".."), { recursive: true });
    // A copy-on-write clone on APFS (no extra space); a full copy elsewhere. Either way independent of `from`.
    copyFileSync(join(from, f), dst, constants.COPYFILE_FICLONE);
    chmodSync(dst, 0o444);
  }
}

/**
 * A read-only copy of the weights whose digest is `want`, laid out as read.py expects (`<root>/models/<dir>/`).
 * Returns `<root>`, the data root the helper is pointed at. An existing copy is used only if it still hashes to
 * `want`. Throws `model-mismatch` when this host's weights are not the pinned ones.
 */
function stageModel(source: string, stageRoot: string, want: string): string {
  const final = join(stageRoot, "models", want);
  const inner = (root: string) => join(root, "models", READ_QWEN_MODEL_DIR);
  try {
    if (modelDigest(inner(final)) === want) return final;
  } catch {
    // Not staged yet (or damaged): stage below.
  }
  const tmp = `${final}.${process.pid}.${randomUUID()}.tmp`;
  try {
    try {
      cloneTree(source, inner(tmp));
    } catch {
      throw new JobError("model-missing", true);
    }
    if (modelDigest(inner(tmp)) !== want) throw new JobError("model-mismatch", false);
    rmSync(final, { recursive: true, force: true });
    try {
      renameSync(tmp, final);
    } catch {
      // Another worker staged it first: verified below.
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  try {
    if (modelDigest(inner(final)) === want) return final;
  } catch {
    // Fall through.
  }
  throw new JobError("stage-failed", true);
}

// --- running read.py --------------------------------------------------------------------------------------

const RawVariantSchema = z.strictObject({ rotation: RotationSchema, text: z.string(), confidence: ConfidenceSchema });
const RawReadingSchema = z.union([
  z.strictObject({ id: IdSchema, reader: z.literal(READER_NAME), crop: z.string().optional(), variants: z.array(RawVariantSchema), seconds: z.number().min(0) }),
  z.strictObject({ id: IdSchema, reader: z.literal(READER_NAME), crop: z.string().optional(), error: z.string() }),
]);

type HelperRequest = ReadQwenItem & { image: string; crop: string };

/** Run read.py once over `requests`; resolves to its stdout lines. Rejects with a JobError code, never helper text. */
function runReadPy(
  python: string,
  script: string,
  requests: HelperRequest[],
  dataRootForHelper: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    // Fixed arguments and a fixed environment: isolated mode ignores PYTHON* variables and the user site, and the
    // Hugging Face libraries may not reach the network. stderr (progress only) is discarded.
    const env: Record<string, string> = { PATH: process.env.PATH ?? "/usr/bin:/bin", BOOKCASE_DATA: dataRootForHelper, HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" };
    if (process.env.HOME) env.HOME = process.env.HOME;
    const child = spawn(python, ["-I", script, "--reader", "qwen", "--prompt", "spine"], { env, stdio: ["pipe", "pipe", "ignore"] });
    let failure: JobError | undefined;
    const fail = (code: string, retryable: boolean): void => {
      failure ??= new JobError(code, retryable);
      child.kill("SIGKILL");
    };
    const lines: string[] = [];
    let bytes = 0;
    const limit = STDOUT_BYTES_PER_REQUEST * requests.length;
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > limit) fail("helper-contract", false);
    });
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => {
      if (line.trim()) lines.push(line);
    });
    const timer = setTimeout(() => fail("helper-timeout", true), timeoutMs);
    const onAbort = (): void => fail("interrupted", true);
    signal.addEventListener("abort", onAbort, { once: true });
    let settled = false;
    const settle = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      rl.close();
      if (failure) reject(failure);
      else if (code !== 0) reject(new JobError("read-helper", true));
      else resolve(lines);
    };
    child.once("error", () => {
      failure ??= new JobError("read-helper", true);
      settle(null);
    });
    child.once("close", (code) => settle(code));
    // The helper may exit early; a broken pipe is then reported by the exit status.
    child.stdin.on("error", () => {});
    child.stdin.end(requests.map((r) => `${JSON.stringify(r)}\n`).join(""));
  });
}

/** An exception type name is safe to keep; anything else read.py might put in `error` is dropped. */
const safeErrorName = (s: string): string => (/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(s) ? s : "");

/**
 * read.py's records, in request order, as `ocr-response` records: no timing, `langCorrection: false` (a
 * generative reader has none), the helper pin as `version.helper`. Throws `helper-contract` (not retryable) when
 * an id is missing, repeated or unasked, a record is malformed, or its crop or rotations differ from the request.
 */
function toResponses(lines: string[], requests: HelperRequest[], version: { helper: string; os: string; requestRevision: number }): OcrResponse[] {
  const byId = new Map<string, z.infer<typeof RawReadingSchema>>();
  const asked = new Map(requests.map((r) => [r.id, r]));
  for (const line of lines) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new JobError("helper-contract", false);
    }
    const parsed = RawReadingSchema.safeParse(value);
    if (!parsed.success) throw new JobError("helper-contract", false);
    const raw = parsed.data;
    const req = asked.get(raw.id);
    if (!req || byId.has(raw.id) || raw.crop !== req.crop) throw new JobError("helper-contract", false);
    if ("variants" in raw && raw.variants.map((v) => v.rotation).join() !== req.rotations.join()) throw new JobError("helper-contract", false);
    byId.set(raw.id, raw);
  }
  return requests.map((req) => {
    const raw = byId.get(req.id);
    if (!raw) throw new JobError("helper-contract", false);
    const response: OcrResponse =
      "variants" in raw
        ? { id: raw.id, variants: raw.variants.map((v) => ({ rotation: v.rotation, langCorrection: false, text: v.text, confidence: v.confidence })), version }
        : { id: raw.id, error: { code: "reader-error", message: safeErrorName(raw.error) } };
    if (!OcrResponseSchema.safeParse(response).success) throw new JobError("helper-contract", false);
    return response;
  });
}

let macosVersion: string | undefined;
/** `macOS x.y.z`, as ocr-vision reports it. */
function osVersion(): string {
  if (macosVersion) return macosVersion;
  try {
    const plist = readFileSync("/System/Library/CoreServices/SystemVersion.plist", "utf8");
    const v = /<key>ProductVersion<\/key>\s*<string>([0-9.]+)<\/string>/.exec(plist)?.[1];
    if (v) return (macosVersion = `macOS ${v}`);
  } catch {
    // Not macOS.
  }
  return (macosVersion = `${process.platform} ${release()}`);
}

export interface ReadQwenOptions extends ReadQwenHost {
  /** Where verified copies go. Default: `staged/` beside the output directory. */
  stageDir?: string;
  /** Remote workers resolve the keyed input in this host's content-addressed store. */
  resolveImage?: (hash: string) => string | undefined;
  /** Kill read.py and fail (retryably) after this long. Default: a load budget plus a budget per variant. */
  timeoutMs?: number;
  /** For tests: the `version.os` to report instead of this host's. */
  os?: string;
}

/**
 * Qwen3-VL-4B spine reading on one batch. Output: one `ocr-response` record per request, as JSON Lines, in
 * request order. Refuses (not retryable) a job whose helper, model or input pin does not match what this
 * attempt read, before read.py is launched.
 */
export function readQwenHandler(options: ReadQwenOptions = {}): JobHandler {
  const { stageDir, resolveImage, timeoutMs, os, ...host } = options;
  return async (job: Claim, { signal, outDir }) => {
    if (signal.aborted) throw new JobError("interrupted", true);
    const staged = stageDir ?? join(outDir, "..", "staged");
    const parsed = ReadQwenParamsSchema.safeParse(job.params);
    if (!parsed.success || job.inputs.length !== 1 || !SHA.test(job.inputs[0]!) || typeof job.code !== "string") throw new JobError("bad-spec", false);
    const params = parsed.data;
    const hash = job.inputs[0]!;
    let image: string;
    if (resolveImage) {
      const local = resolveImage(hash);
      if (!local) throw new JobError("input-missing", true);
      image = local;
    } else {
      const path = (job.payload as ReadQwenPayload | null)?.image;
      if (typeof path !== "string") throw new JobError("bad-spec", false);
      image = path;
    }

    // Helper pin: tree hash and Python version, from the bytes this attempt stages.
    const paths = hostPaths(host);
    const helper = helperIdentity(paths);
    if (job.code !== helper.code) throw new JobError("helper-mismatch", false);
    const script = stageVerified(join(staged, "helpers"), `read-qwen-${sha256(helper.readPy)}.py`, helper.readPy, 0o444);

    // Input pin: the working copy's hash.
    let photo: Buffer;
    try {
      photo = readFileSync(image);
    } catch {
      throw new JobError("input-missing", true);
    }
    if (sha256(photo) !== hash) throw new JobError("input-mismatch", false);
    const copy = stageVerified(join(staged, "inputs"), `${hash}${extname(image)}`, photo, 0o444);

    // Model pin: the recorded revision, then the digest of the staged copy read.py will load.
    if (!existsSync(paths.modelDir)) throw new JobError("model-missing", true);
    if (modelRevision(paths.modelDir) !== params.model.revision) throw new JobError("model-mismatch", false);
    const helperData = stageModel(paths.modelDir, staged, params.model.sha256);

    const requests = params.requests.map((r) => ({ ...r, image: copy, crop: params.crop }));
    const variants = params.requests.reduce((n, r) => n + r.rotations.length, 0);
    let lines: string[];
    try {
      lines = await runReadPy(paths.python, script, requests, helperData, timeoutMs ?? LOAD_BUDGET_MS + VARIANT_BUDGET_MS * variants, signal);
    } catch (e) {
      if (signal.aborted) throw new JobError("interrupted", true);
      throw e instanceof JobError ? e : new JobError("handler-error", true);
    }
    const responses = toResponses(lines, requests, { helper: helper.code, os: os ?? osVersion(), requestRevision: 0 });
    return writeOutput(outDir, job, responses.map((r) => JSON.stringify(r)).join("\n") + "\n");
  };
}

// --- checking an accepted output --------------------------------------------------------------------------

export interface ReadQwenOutputCheck {
  requests: number;
  readings: number;
  readerErrors: number;
  /** Problem codes; empty when the output passes. Never quotes the output. */
  problems: string[];
}

/** The recipe's pass check on an accepted output: `ocr-response` records, one per request, in request order. */
export function checkReadQwenOutput(job: ReadQwenJob, output: string): ReadQwenOutputCheck {
  const requests = job.params.requests;
  const problems = new Set<string>();
  if (!output.endsWith("\n")) problems.add("unterminated");
  const lines = output.replace(/\n$/, "").split("\n");
  let readings = 0;
  let readerErrors = 0;
  lines.forEach((line, i) => {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      problems.add("not-json");
      return;
    }
    const parsed = OcrResponseSchema.safeParse(value);
    if (!parsed.success) {
      problems.add("schema");
      return;
    }
    readings += 1;
    const r = parsed.data;
    const req = requests[i];
    if (!req || r.id !== req.id) problems.add("order");
    if ("error" in r) {
      readerErrors += 1;
      return;
    }
    if (req && r.variants.map((v) => v.rotation).join() !== req.rotations.join()) problems.add("rotations");
    if (r.version.helper !== job.code) problems.add("helper");
  });
  if (readings !== requests.length || lines.length !== requests.length) problems.add("count");
  return { requests: requests.length, readings, readerErrors, problems: [...problems].sort() };
}

/**
 * Yojimbo's optional extra check: how many readings equal F-0's cached Qwen reading of the same spine (same id
 * and crop method), comparing rotation, text and confidence. F-0's records carry timing; that is not compared.
 */
export function compareWithCached(job: ReadQwenJob, output: string, cached: string): { equal: number; differ: number; missing: number } {
  const latest = new Map<string, unknown>();
  for (const line of cached.split("\n")) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = RawReadingSchema.safeParse(value);
    if (!parsed.success || (parsed.data.crop ?? "rect;rot=fixed") !== job.params.crop) continue;
    const raw = parsed.data;
    latest.set(raw.id, "variants" in raw ? raw.variants.map((v) => [v.rotation, v.text, v.confidence]) : "error");
  }
  const counts = { equal: 0, differ: 0, missing: 0 };
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const r = OcrResponseSchema.parse(JSON.parse(line));
    if (!latest.has(r.id)) {
      counts.missing += 1;
      continue;
    }
    const mine = "error" in r ? "error" : r.variants.map((v) => [v.rotation, v.text, v.confidence]);
    if (JSON.stringify(mine) === JSON.stringify(latest.get(r.id))) counts.equal += 1;
    else counts.differ += 1;
  }
  return counts;
}
