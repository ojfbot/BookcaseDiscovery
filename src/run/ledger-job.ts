import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, openSync, closeSync, fsyncSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { parseEvent } from "../ledger/contracts.ts";
import { SqliteLedger } from "../ledger/sqlite.ts";
import { replay } from "../ledger/replay.ts";
import type { JobOutput } from "./vendor/fleet-runner/jobs.js";

export const LEDGER_JOB_KIND = "bookcase-ledger-replay";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const proofId = z.uuid();
const path = z.string().refine((s) => isAbsolute(s) && !s.includes("\0"));

export const ledgerGrantSchema = z.strictObject({
  schemaVersion: z.literal(1),
  proofId,
  key: hash,
  code: z.string().regex(/^[a-f0-9]{40}$/),
  fixtureSha256: hash,
  outDir: path,
  expiresAtMs: integer,
});
export type LedgerJobGrant = z.infer<typeof ledgerGrantSchema>;

const envelopeSchema = z.strictObject({
  job: z.strictObject({
    key: hash,
    kind: z.literal(LEDGER_JOB_KIND),
    inputs: z.tuple([]),
    params: z.strictObject({ fixtureVersion: z.literal(1), fixtureSha256: hash, proofId }),
    code: z.string().regex(/^[a-f0-9]{40}$/),
    payload: z.null(),
    fence: integer.min(1),
    leaseExpires: integer,
  }),
  outDir: path,
});

export const ledgerFixtureSchema = z.strictObject({
  version: z.literal(1),
  events: z.array(z.unknown()).length(21),
  eventsSha256: hash,
  viewsSha256: hash,
});
export type LedgerFixture = z.infer<typeof ledgerFixtureSchema>;

/** Matches the canonical JSON used by the job protocol, with no dependence on property order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  const result = JSON.stringify(value);
  if (result === undefined) throw Error("non-json-value");
  return result;
}

export const sha256 = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");

function outputDirectory(value: string): string {
  const absolute = resolve(value);
  const stat = lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(absolute) !== absolute ||
      stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) throw Error("unsafe-ledger-output");
  return absolute;
}

/** One installed synthetic fixture, one exact admitted job, and a new database for each attempt. */
export function runLedgerJob(input: unknown, grantInput: unknown, fixtureInput: unknown, now = Date.now): JobOutput {
  const grant = ledgerGrantSchema.parse(grantInput);
  const { job, outDir } = envelopeSchema.parse(input);
  const fixture = ledgerFixtureSchema.parse(fixtureInput);
  if (now() >= grant.expiresAtMs || now() >= job.leaseExpires) throw Error("ledger-grant-expired");
  if (job.key !== grant.key || job.code !== grant.code || outDir !== grant.outDir ||
      job.params.proofId !== grant.proofId || job.params.fixtureSha256 !== grant.fixtureSha256 ||
      sha256(canonicalJson(fixture)) !== grant.fixtureSha256) throw Error("ledger-job-mismatch");
  const root = outputDirectory(outDir);
  const scratch = mkdtempSync(join(root, `ledger-${job.key.slice(0, 12)}-${job.fence}-`));
  const sourceFile = join(scratch, "source.sqlite");
  const targetFile = join(scratch, "replayed.sqlite");
  const source = new SqliteLedger(sourceFile, { crossCheck: true });
  try {
    for (const value of fixture.events) {
      const event = parseEvent(value);
      if ("seq" in event) throw Error("fixture-sequence-refused");
      source.append(event);
    }
    if (sha256(canonicalJson([...source.events()])) !== fixture.eventsSha256 ||
        sha256(canonicalJson(source.viewDump())) !== fixture.viewsSha256) throw Error("ledger-oracle-mismatch");
  } finally {
    source.close();
  }
  const result = replay(sourceFile, targetFile);
  if (result.events !== 21 || !result.identical || result.differences.length !== 0) throw Error("ledger-replay-mismatch");
  if (now() >= grant.expiresAtMs || now() >= job.leaseExpires) throw Error("ledger-grant-expired");
  const bytes = `${JSON.stringify(result)}\n`;
  const file = `${job.key}.${job.fence}.jsonl`;
  const fd = openSync(join(root, file), "wx", 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  return { file, sha256: sha256(bytes) };
}

/** Build-time fixture boundary: the existing app scenario supplies events, never job input. */
export function buildLedgerFixture(events: readonly unknown[], directory: string): LedgerFixture {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const source = new SqliteLedger(join(directory, "fixture.sqlite"), { crossCheck: true });
  try {
    for (const value of events) {
      const event = parseEvent(value);
      if ("seq" in event) throw Error("fixture-sequence-refused");
      source.append(event);
    }
    return ledgerFixtureSchema.parse({ version: 1, events, eventsSha256: sha256(canonicalJson([...source.events()])), viewsSha256: sha256(canonicalJson(source.viewDump())) });
  } finally { source.close(); }
}
