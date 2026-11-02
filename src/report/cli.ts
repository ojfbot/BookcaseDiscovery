// `bookcase report <session> [--run <id>] [--ledger <db>]`
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { SqliteLedger, dataRoot } from "../ledger/index.ts";
import { writeReport } from "./index.ts";

export const reportUsage = `usage: bookcase report <session> [--run <id>] [--ledger <db>]

  <session>   scan session name, e.g. sf-store-001
  --run       the run to report (default: the most recently started)
  --ledger    the SQLite ledger (default: $BOOKCASE_DATA/ledger/<session>.sqlite, else $BOOKCASE_DATA/ledger.sqlite), opened read-only

Writes a static site to $BOOKCASE_DATA/reports/<session>/<run>/index.html (default data root
~/data/bookcase-discovery/). The folder holds photos: it is private and never committed.`;

export function reportCommand(argv: string[], env: NodeJS.ProcessEnv = process.env): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { run: { type: "string" }, ledger: { type: "string" }, help: { type: "boolean", short: "h" } },
    });
  } catch (e) {
    console.error(`bookcase report: ${e instanceof Error ? e.message : e}\n\n${reportUsage}`);
    return 1;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    console.log(reportUsage);
    return 0;
  }
  if (positionals.length !== 1) {
    console.error(reportUsage);
    return 1;
  }
  const dataDir = dataRoot(env);
  const sessionDb = join(dataDir, "ledger", `${positionals[0]}.sqlite`);
  const dbPath = values.ledger ?? (existsSync(sessionDb) ? sessionDb : join(dataDir, "ledger.sqlite"));
  if (!existsSync(dbPath)) {
    console.error(`bookcase report: no ledger at ${dbPath} (pass --ledger <db>)`);
    return 1;
  }
  let ledger: SqliteLedger | undefined;
  try {
    ledger = new SqliteLedger(dbPath, { readOnly: true });
    const out = writeReport({ ledger, session: positionals[0]!, runId: values.run, dataDir });
    for (const w of out.warnings) console.error(`bookcase report: warning: ${w}`);
    const { counts } = out.model;
    console.log(`${counts.total} spines (${counts.status.resolved} resolved) on ${out.model.images.length} photo${out.model.images.length === 1 ? "" : "s"}, run ${out.model.run.runId}`);
    console.log(out.index);
    return 0;
  } catch (e) {
    console.error(`bookcase report: ${e instanceof Error ? e.message : e}`);
    return 1;
  } finally {
    ledger?.close();
  }
}
