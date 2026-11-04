// Job kinds the interim queue can run (docs/ops/compute-fleet.md §3). Each handler wraps an existing
// helper unchanged; card N-1 adds detect and the Python readers the same way, starting with `read-qwen`
// (src/run/read-qwen.ts).
//
// Kind boundary: everything that changes a kind's output is keyed (inputs, params, code), and the handler
// executes the keyed params, never the payload. The payload only says where this host keeps the inputs.
//
// Each attempt reads the helper executable and the input once, checks their hashes against the pins, and
// runs from verified, read-only, content-addressed copies under `<jobs>/staged/`. So a helper rebuilt or a
// photo replaced at the same path between attempts, or between the check and the launch, cannot run
// under the old pin.
import { createHash, randomUUID } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { OcrRequestSchema } from "../ledger/helper-contracts.ts";
import { defaultOcrBinary, ocrBinaryAvailable, OcrHelperError, runOcr } from "../perceive/ocr.ts";
import type { OcrHelperOptions, OcrRequest } from "../perceive/ocr.ts";
import { dataRoot } from "../ledger/images.ts";
import { JobError, writeOutput } from "./jobs.ts";
import type { JobHandler, JobSpec } from "./jobs.ts";
import { detectReadQwen, READ_QWEN_MODEL_DIR, readQwenHandler } from "./read-qwen.ts";
import type { ReadQwenHost } from "./read-qwen.ts";

/** One spine to read: everything in an `OcrRequest` except the image path, which is host-specific. */
export type ReadVisionItem = Omit<OcrRequest, "image">;

/** Keyed params of a `read-vision` job, executed in this order. */
export interface ReadVisionParams {
  requests: ReadVisionItem[];
}

/** Payload of a `read-vision` job: where this host keeps the one working copy the batch is cut from. */
export interface ReadVisionPayload {
  image: string;
}

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const sha256File = (path: string): string => sha256(readFileSync(path));
const helperIdOf = (bytes: Buffer): string => `ocr-vision@sha256:${sha256(bytes)}`;

/** The pinned identity of an OCR helper build: its executable's content hash. */
export function ocrHelperId(binary: string = defaultOcrBinary()): string {
  return helperIdOf(readFileSync(binary));
}

/**
 * Put `bytes` at `<dir>/<name>` as a read-only file and return its path. An existing copy is used only if
 * it still hashes to `bytes`; otherwise it is replaced. Linking never overwrites, so concurrent workers
 * staging the same content converge on one verified file.
 */
export function stageVerified(dir: string, name: string, bytes: Buffer, mode: number): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  const want = sha256(bytes);
  for (let i = 0; i < 3; i++) {
    try {
      if (sha256File(path) === want) return path;
      unlinkSync(path);
    } catch {
      // Not there yet (or already removed): write it below.
    }
    const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(tmp, bytes, { mode });
    try {
      linkSync(tmp, path);
    } catch {
      // Another worker linked first: verified on the next pass.
    } finally {
      unlinkSync(tmp);
    }
  }
  throw new JobError("stage-failed", true);
}

/** Admit-ready spec for one batch of spines from one working copy. Hashes the image; never keys its path. */
export function readVisionJob(image: string, requests: ReadVisionItem[], helperId: string, extra: Partial<JobSpec> = {}): JobSpec {
  const payload: ReadVisionPayload = { image };
  return { kind: "read-vision", inputs: [sha256File(image)], params: { requests }, code: helperId, payload, requires: ["apple-vision"], ...extra };
}

export interface ReadVisionOptions extends OcrHelperOptions {
  /**
   * For test doubles run as `node script.mjs` only: trust this identity for `binary` instead of hashing and
   * staging it each attempt. Production workers leave it unset.
   */
  helperId?: string;
  /** Where verified copies go. Default: `staged/` beside the output directory. */
  stageDir?: string;
  /** Remote workers resolve the keyed input in this host's content-addressed store. */
  resolveImage?: (hash: string) => string | undefined;
}

/**
 * Apple Vision OCR (P-1) on one batch. Output: the helper's responses as JSON Lines, in request order.
 * Refuses (non-retryable) a job whose helper pin or working-copy hash does not match what this attempt read.
 */
export function readVisionHandler(options: ReadVisionOptions = {}): JobHandler {
  const { helperId: trusted, stageDir, resolveImage, ...ocr } = options;
  return async (job, { signal, outDir }) => {
    if (signal.aborted) throw new JobError("interrupted", true);
    const staged = stageDir ?? join(outDir, "..", "staged");
    const { requests } = job.params as unknown as ReadVisionParams;
    if (!Array.isArray(requests) || job.inputs.length !== 1) throw new JobError("bad-spec", false);
    const hash = job.inputs[0]!;
    let image: string;
    if (resolveImage) {
      if (!/^[a-f0-9]{64}$/.test(hash)) throw new JobError("bad-spec", false);
      const local = resolveImage(hash);
      if (!local) throw new JobError("input-missing", true);
      image = local;
    } else {
      const path = (job.payload as ReadVisionPayload | null)?.image;
      if (typeof path !== "string") throw new JobError("bad-spec", false);
      image = path;
    }
    if (!requests.every((r) => OcrRequestSchema.safeParse({ ...r, image }).success)) throw new JobError("bad-spec", false);

    let binary = ocr.binary ?? defaultOcrBinary();
    if (trusted !== undefined) {
      if (job.code !== trusted) throw new JobError("helper-mismatch", false);
    } else {
      let helper: Buffer;
      try {
        helper = readFileSync(binary);
      } catch {
        throw new JobError("helper-missing", true);
      }
      if (job.code !== helperIdOf(helper)) throw new JobError("helper-mismatch", false);
      binary = stageVerified(join(staged, "helpers"), `ocr-vision-${sha256(helper)}`, helper, 0o555);
    }

    let photo: Buffer;
    try {
      photo = readFileSync(image);
    } catch {
      throw new JobError("input-missing", true);
    }
    if (sha256(photo) !== hash) throw new JobError("input-mismatch", false);
    const copy = stageVerified(join(staged, "inputs"), `${hash}${extname(image)}`, photo, 0o444);

    let responses;
    try {
      responses = await runOcr(
        requests.map((r) => ({ ...r, image: copy })),
        { ...ocr, binary, signal },
      );
    } catch (e) {
      if (signal.aborted) throw new JobError("interrupted", true);
      throw new JobError(e instanceof OcrHelperError ? "ocr-helper" : "handler-error", true);
    }
    return writeOutput(outDir, job, responses.map((r) => JSON.stringify(r)).join("\n") + "\n");
  };
}

/**
 * Capabilities this host can offer, detected rather than declared, so a worker never claims what it cannot run.
 * `read-qwen` adds `mlx` and a capability naming its pins, only when the venv matches uv.lock and the helper and
 * weights hash (src/run/read-qwen.ts); so a read-qwen job is claimed only by a host holding the same pins.
 */
export function detectCapabilities(env: NodeJS.ProcessEnv = process.env, qwen: ReadQwenHost = {}): string[] {
  const caps: string[] = [];
  if (process.platform === "darwin" && ocrBinaryAvailable(defaultOcrBinary(env))) caps.push("apple-vision");
  if (process.platform === "darwin" && process.arch === "arm64") {
    const detected = detectReadQwen({ modelDir: join(dataRoot(env), "models", READ_QWEN_MODEL_DIR), ...qwen });
    if (detected.ok) caps.push("mlx", detected.pins.capability);
  }
  return caps;
}

export function builtInHandlers(): Record<string, JobHandler> {
  return { "read-vision": readVisionHandler(), "read-qwen": readQwenHandler() };
}
