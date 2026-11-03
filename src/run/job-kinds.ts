// Job kinds the interim queue can run (docs/ops/compute-fleet.md §3). Each handler wraps an existing
// helper unchanged; card N-1 adds detect and the Python readers the same way.
//
// Kind boundary: everything that changes a kind's output is keyed (inputs, params, code), and the handler
// executes the keyed params, never the payload. The payload only says where this host keeps the inputs,
// and the handler checks that what it found there hashes to the keyed input before running.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { OcrRequestSchema } from "../ledger/helper-contracts.ts";
import { defaultOcrBinary, ocrBinaryAvailable, OcrHelperError, runOcr } from "../perceive/ocr.ts";
import type { OcrHelperOptions, OcrRequest } from "../perceive/ocr.ts";
import { JobError, writeOutput } from "./jobs.ts";
import type { JobHandler, JobSpec } from "./jobs.ts";

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

const sha256File = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

/** The pinned identity of an OCR helper build: its executable's content hash. */
export function ocrHelperId(binary: string = defaultOcrBinary()): string {
  return `ocr-vision@sha256:${sha256File(binary)}`;
}

/** Admit-ready spec for one batch of spines from one working copy. Hashes the image; never keys its path. */
export function readVisionJob(image: string, requests: ReadVisionItem[], helperId: string, extra: Partial<JobSpec> = {}): JobSpec {
  const payload: ReadVisionPayload = { image };
  return { kind: "read-vision", inputs: [sha256File(image)], params: { requests }, code: helperId, payload, requires: ["apple-vision"], ...extra };
}

/**
 * Apple Vision OCR (P-1) on one batch. Output: the helper's responses as JSON Lines, in request order.
 * Refuses (non-retryable) a job whose helper pin or working-copy hash does not match this host.
 */
export function readVisionHandler(options: OcrHelperOptions & { helperId?: string } = {}): JobHandler {
  const { helperId: pinned, ...ocr } = options;
  let helperId = pinned;
  return async (job, { signal, outDir }) => {
    if (signal.aborted) throw new JobError("interrupted", true);
    helperId ??= ocrHelperId(ocr.binary);
    if (job.code !== helperId) throw new JobError("helper-mismatch", false);
    const { image } = job.payload as ReadVisionPayload;
    const { requests } = job.params as unknown as ReadVisionParams;
    if (typeof image !== "string" || !Array.isArray(requests) || job.inputs.length !== 1) throw new JobError("bad-spec", false);
    const resolved = requests.map((r) => ({ ...r, image }));
    if (!resolved.every((r) => OcrRequestSchema.safeParse(r).success)) throw new JobError("bad-spec", false);
    let actual: string;
    try {
      actual = sha256File(image);
    } catch {
      throw new JobError("input-missing", true);
    }
    if (actual !== job.inputs[0]) throw new JobError("input-mismatch", false);
    let responses;
    try {
      responses = await runOcr(resolved, { ...ocr, signal });
    } catch (e) {
      if (signal.aborted) throw new JobError("interrupted", true);
      throw new JobError(e instanceof OcrHelperError ? "ocr-helper" : "handler-error", true);
    }
    return writeOutput(outDir, job, responses.map((r) => JSON.stringify(r)).join("\n") + "\n");
  };
}

/** Capabilities this host can offer, detected rather than declared, so a worker never claims what it cannot run. */
export function detectCapabilities(env: NodeJS.ProcessEnv = process.env): string[] {
  const caps: string[] = [];
  if (process.platform === "darwin" && ocrBinaryAvailable(defaultOcrBinary(env))) caps.push("apple-vision");
  return caps;
}

export function builtInHandlers(): Record<string, JobHandler> {
  return { "read-vision": readVisionHandler() };
}
