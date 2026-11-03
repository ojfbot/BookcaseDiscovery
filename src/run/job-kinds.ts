// Job kinds the interim queue can run (docs/ops/compute-fleet.md §3). Each handler wraps an existing
// helper unchanged; card N-1 adds detect and the Python readers the same way.
import { defaultOcrBinary, ocrBinaryAvailable, OcrHelperError, runOcr } from "../perceive/ocr.ts";
import type { OcrHelperOptions, OcrRequest } from "../perceive/ocr.ts";
import { JobError, writeOutput } from "./jobs.ts";
import type { JobHandler } from "./jobs.ts";

/** Payload of a `read-vision` job: one batch of spine crops (the helper cuts them from the working copy). */
export interface ReadVisionPayload {
  requests: OcrRequest[];
}

/** Apple Vision OCR (P-1) on one batch. Output: the helper's responses as JSON Lines, in request order. */
export function readVisionHandler(options: OcrHelperOptions = {}): JobHandler {
  return async (job, { signal, outDir }) => {
    const { requests } = job.payload as ReadVisionPayload;
    if (signal.aborted) throw new JobError("interrupted", true);
    let responses;
    try {
      responses = await runOcr(requests, options);
    } catch (e) {
      throw new JobError(e instanceof OcrHelperError ? "ocr-helper" : "handler-error", true);
    }
    return writeOutput(outDir, job.key, responses.map((r) => JSON.stringify(r)).join("\n") + "\n");
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
