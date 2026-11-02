// `pnpm catalog:import`: stage the ISFDB dump into $BOOKCASE_DATA/catalog/isfdb-staging.sqlite (C-1).
// `pnpm catalog:check [--db <path>]`: print counts, the content hash and the spot checks of a staged file.
import { existsSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { dataRoot } from "../capture/store.ts";
import { computeContentHash, stageDump, tableCounts } from "./isfdb-staging.ts";
import { runSpotChecks } from "./spot-check.ts";
import type { SpotCheckResult } from "./spot-check.ts";

const importUsage = `usage: pnpm catalog:import [--dump <file>] [--out <staging.sqlite>] [--date YYYY-MM-DD]

  --dump  the ISFDB mysqldump (.zip, .gz or plain). Default: the newest file in $BOOKCASE_DATA/raw/isfdb/
  --out   default: $BOOKCASE_DATA/catalog/isfdb-staging.sqlite
Prints the table counts, the content hash and the spot checks. Exits 1 if a spot check fails.`;

const fmt = (n: number) => n.toLocaleString("en-US");

function newestDump(dir: string): string | undefined {
  if (!existsSync(dir)) return undefined;
  const files = readdirSync(dir).filter((f) => /^backup-MySQL.*(\.zip|\.gz)?$/.test(f) && !f.endsWith(".partial")).sort();
  const last = files.at(-1);
  return last ? join(dir, last) : undefined;
}

export function printReport(db: DatabaseSync, log: (s: string) => void = console.log): boolean {
  const counts = tableCounts(db);
  log("counts:");
  for (const [name, n] of Object.entries(counts)) log(`  ${name.padEnd(18)} ${fmt(n).padStart(11)}`);
  const withIsbn = db.prepare("SELECT COUNT(*) AS n, COUNT(isbn13) AS valid FROM pubs WHERE pub_isbn IS NOT NULL AND pub_isbn <> ''").get() as { n: number; valid: number };
  log(`  pubs with an ISBN  ${fmt(withIsbn.n).padStart(11)}  (valid ISBN-10/13: ${fmt(withIsbn.valid)})`);
  const meta = Object.fromEntries((db.prepare("SELECT key, value FROM meta").all() as Array<{ key: string; value: string }>).map((r) => [r.key, r.value]));
  log(`dump: ${meta.dump_file} (${meta.dump_date}), ${fmt(Number(meta.dump_bytes))} bytes`);
  log(`content hash: ${computeContentHash(db)}`);
  log("spot checks:");
  let ok = true;
  for (const r of runSpotChecks(db)) {
    ok &&= r.ok;
    logSpot(r, log);
  }
  return ok;
}

function logSpot(r: SpotCheckResult, log: (s: string) => void): void {
  log(`  ${r.ok ? "PASS" : "FAIL"} ${r.case.title} -> ${r.authors.join("; ") || "(no work found)"}; works ${r.workIds.join(",") || "-"}; ${r.editions.length} edition(s)`);
  for (const e of r.editions.slice(0, 6)) {
    log(`       pub ${e.pubId} ${e.year ?? "?"} ${e.publisher ?? "?"}  ISBN ${e.isbn ?? "-"}${e.isbn13 && e.isbn13 !== e.isbn ? ` (${e.isbn13})` : ""}`);
  }
  if (r.editions.length > 6) log(`       ... ${r.editions.length - 6} more`);
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const command = argv[0];
  const rest = argv.slice(1);
  const root = dataRoot(env);
  const defaultOut = join(root, "catalog", "isfdb-staging.sqlite");

  if (command === "check") {
    const { values } = parseArgs({ args: rest, options: { db: { type: "string" } } });
    const path = values.db ?? defaultOut;
    if (!existsSync(path)) {
      console.error(`catalog:check: ${path} does not exist; run pnpm catalog:import first`);
      return 1;
    }
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      return printReport(db) ? 0 : 1;
    } finally {
      db.close();
    }
  }

  if (command !== "import") {
    console.error(importUsage);
    return 1;
  }
  const { values } = parseArgs({ args: rest, options: { dump: { type: "string" }, out: { type: "string" }, date: { type: "string" } } });
  const dump = values.dump ?? newestDump(join(root, "raw", "isfdb"));
  if (!dump || !existsSync(dump)) {
    console.error(`catalog:import: no dump found${values.dump ? ` at ${values.dump}` : ` in ${join(root, "raw", "isfdb")}`}.\n${importUsage}`);
    return 1;
  }
  const out = values.out ?? defaultOut;
  const started = Date.now();
  console.log(`staging ${dump}\n     -> ${out}`);
  const result = await stageDump({ dump, out, dumpDate: values.date, progress: (m) => console.error(m) });
  console.log(`staged in ${((Date.now() - started) / 1000).toFixed(0)} s; invalid UTF-8 strings: ${result.invalidUtf8Strings}`);
  const db = new DatabaseSync(out, { readOnly: true });
  try {
    return printReport(db) ? 0 : 1;
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    },
  );
}
