import { constants, closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import { ledgerGrantSchema, runLedgerJob } from "./ledger-job.ts";

declare const __LEDGER_JOB_RELEASE__: string;
declare const __LEDGER_JOB_FIXTURE__: string;

const release: unknown = JSON.parse(__LEDGER_JOB_RELEASE__);
const fixture: unknown = JSON.parse(__LEDGER_JOB_FIXTURE__);

function main(args: string[]): void {
  if (args.length === 1 && args[0] === "version") {
    process.stdout.write(`${JSON.stringify(release)}\n`);
    return;
  }
  if (args.length !== 2 || args[0] !== "--grant") throw Error("invalid-ledger-arguments");
  const fd = openSync(args[1]!, constants.O_RDONLY | constants.O_NOFOLLOW);
  let grant;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || stat.size > 8192)
      throw Error("unsafe-ledger-grant");
    grant = ledgerGrantSchema.parse(JSON.parse(readFileSync(fd, "utf8")));
  } finally { closeSync(fd); }
  if (typeof release !== "object" || release === null || !("commit" in release) || !("clean" in release) || release.clean !== true || grant.code !== release.commit)
    throw Error("ledger-code-mismatch");
  const input = readFileSync(0);
  if (input.byteLength > 8192) throw Error("ledger-envelope-too-large");
  process.umask(0o077);
  const result = runLedgerJob(JSON.parse(input.toString("utf8")), grant, fixture);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

try { main(process.argv.slice(2)); } catch {
  // Job data, paths and SQLite diagnostics remain private; the worker gets one fixed code.
  process.stderr.write("ledger-job-refused\n");
  process.exitCode = 1;
}
