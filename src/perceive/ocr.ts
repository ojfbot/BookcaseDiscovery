// TypeScript wrapper for the `ocr-vision` Swift helper (card P-1). One call spawns the helper, sends one
// JSON Lines request per spine, and returns the validated responses in request order. The record shapes
// are `contracts/helpers/ocr-*.schema.json`; the validators are in `src/ledger/helper-contracts.ts`.
import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  OcrRequestSchema,
  OcrResponseSchema,
  type OcrRequest,
  type OcrResponse,
} from "../ledger/helper-contracts.ts";

export type { OcrRequest, OcrResponse };

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DEFAULT_TIMEOUT_MS = 120_000;

/** The built helper: `$BOOKCASE_OCR_VISION` if set, else the SwiftPM release build in this checkout. */
export function defaultOcrBinary(env: NodeJS.ProcessEnv = process.env): string {
  return env.BOOKCASE_OCR_VISION || `${REPO_ROOT}helpers/ocr-vision/.build/release/ocr-vision`;
}

/** True when `binary` exists and is executable (false on Linux, where it is never built). */
export function ocrBinaryAvailable(binary: string = defaultOcrBinary()): boolean {
  try {
    accessSync(binary, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export interface OcrHelperOptions {
  /** Executable to run. Default: {@link defaultOcrBinary}. */
  binary?: string;
  /** Arguments before the helper's own (a test double run as `node fake.mjs` uses this). */
  args?: string[];
  /** Kill the helper and reject after this long. Default 120 s: the first Vision call after boot is slow. */
  timeoutMs?: number;
  /** Kill the helper and reject when this aborts (a job queue worker that lost its lease or was interrupted). */
  signal?: AbortSignal;
}

/** The helper could not be run, or broke the JSON Lines contract. Never carries recognised text. */
export class OcrHelperError extends Error {
  override readonly name = "OcrHelperError";
}

/**
 * Run OCR for `requests` and return one response per request, in request order. A response is either the
 * success shape or `{id, error}` for that spine; a failed spine does not fail the call. The call itself
 * rejects (`OcrHelperError`) when the helper cannot start, times out, exits non-zero, answers an id it was
 * not asked, answers one twice or not at all, or writes a line that is not a valid response.
 */
export async function runOcr(requests: readonly OcrRequest[], options: OcrHelperOptions = {}): Promise<OcrResponse[]> {
  const parsed = requests.map((r) => OcrRequestSchema.parse(r));
  const ids = new Set(parsed.map((r) => r.id));
  if (ids.size !== parsed.length) throw new OcrHelperError("request ids must be unique within one call");
  if (parsed.length === 0) return [];
  if (options.signal?.aborted) throw new OcrHelperError("aborted before the helper started");

  const binary = options.binary ?? defaultOcrBinary();
  const child = spawn(binary, options.args ?? [], { stdio: ["pipe", "pipe", "pipe"] });

  const byId = new Map<string, OcrResponse>();
  let failure: OcrHelperError | undefined;
  const fail = (message: string): void => {
    failure ??= new OcrHelperError(message);
    child.kill();
  };

  let stderrTail = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-2000);
  });

  let lineNo = 0;
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on("line", (line) => {
    lineNo += 1;
    if (line.trim() === "") return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return fail(`helper stdout line ${lineNo} is not JSON`);
    }
    const result = OcrResponseSchema.safeParse(value);
    if (!result.success) {
      // Paths only: an issue message may quote the value, and the value may be recognised text.
      const where = result.error.issues.map((i) => i.path.join(".") || "(root)").join(", ");
      return fail(`helper stdout line ${lineNo} breaks the ocr-response contract at ${where}`);
    }
    const response = result.data;
    if (!ids.has(response.id)) return fail(`helper answered an id that was not requested (line ${lineNo})`);
    if (byId.has(response.id)) return fail(`helper answered an id twice (line ${lineNo})`);
    byId.set(response.id, response);
  });

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => fail(`helper did not finish within ${timeoutMs} ms`), timeoutMs);
  const onAbort = (): void => fail("helper aborted");
  options.signal?.addEventListener("abort", onAbort, { once: true });

  const finished = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", (e: NodeJS.ErrnoException) =>
      reject(new OcrHelperError(`cannot run helper (${e.code ?? "error"}): ${binary}`)),
    );
    child.once("close", (code, signal) => resolve({ code, signal }));
  });

  // The helper may exit early (bad usage, crash); a broken pipe then is reported by the exit status.
  child.stdin.on("error", () => {});
  child.stdin.end(parsed.map((r) => `${JSON.stringify(r)}\n`).join(""));

  try {
    const { code, signal } = await finished;
    if (failure) throw failure;
    if (code !== 0) {
      const tail = stderrTail.trim().split("\n").slice(-3).join(" | ");
      throw new OcrHelperError(`helper exited with ${signal ?? `code ${code}`}${tail ? `: ${tail}` : ""}`);
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    lines.close();
  }

  return parsed.map((r) => {
    const response = byId.get(r.id);
    if (!response) throw new OcrHelperError("helper exited without answering every request");
    return response;
  });
}
