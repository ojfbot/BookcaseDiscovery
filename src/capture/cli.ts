// `bookcase ingest <folder> --session <name> [--settings <map.json>] [--ledger <db>] [--min-pixels <n>]`
// `bookcase manifest <session> [--ledger <db>] [--out <path>]`
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { SqliteLedger, dataRoot } from "../ledger/index.ts";
import { formatTable, ingest, loadSettingsMap, DEFAULT_MIN_PIXELS } from "./ingest.ts";
import { privateManifest, publicManifest, writePrivateManifest, writePublicManifest } from "./manifest.ts";

/** The session's ledger: `$BOOKCASE_DATA/ledger/<session>.sqlite`. */
export const sessionLedgerPath = (dataDir: string, session: string): string => join(dataDir, "ledger", `${session}.sqlite`);

export const ingestUsage = `usage: bookcase ingest <folder> --session <name> [--settings <map.json>] [--ledger <db>] [--min-pixels <n>]

  <folder>       an exported folder of originals (read only; it is never written to)
  --session      scan session name, e.g. sf-store-001
  --settings     JSON map: file name -> "whole-12" | "whole-48" | "shelf-48" | "overview" | "real-use"
                 or {"setting": "...", "shelfIndex": n}
  --ledger       the SQLite ledger to append to (default: $BOOKCASE_DATA/ledger/<session>.sqlite);
                 refused if it already holds this session
  --min-pixels   session minimum in pixels (default ${DEFAULT_MIN_PIXELS})

Data goes under $BOOKCASE_DATA (default ~/data/bookcase-discovery/): the image store, the ledger and the
private manifest (<data root>/private/fixtures/<session>.json). The public manifest is written by
\`bookcase manifest\`.`;

export function ingestCommand(argv: string[], env: NodeJS.ProcessEnv = process.env): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { session: { type: "string" }, settings: { type: "string" }, ledger: { type: "string" }, "min-pixels": { type: "string" }, help: { type: "boolean", short: "h" } },
    });
  } catch (e) {
    console.error(`bookcase ingest: ${e instanceof Error ? e.message : e}\n\n${ingestUsage}`);
    return 1;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    console.log(ingestUsage);
    return 0;
  }
  if (positionals.length !== 1 || !values.session) {
    console.error(ingestUsage);
    return 1;
  }
  const minPixels = values["min-pixels"] === undefined ? undefined : Number(values["min-pixels"]);
  if (minPixels !== undefined && !(Number.isInteger(minPixels) && minPixels > 0)) {
    console.error("bookcase ingest: --min-pixels must be a positive integer");
    return 1;
  }

  const dataDir = dataRoot(env);
  const dbPath = values.ledger ?? sessionLedgerPath(dataDir, values.session);
  let ledger: SqliteLedger | undefined;
  try {
    const settings = values.settings ? loadSettingsMap(values.settings) : undefined;
    ledger = new SqliteLedger(dbPath);
    if (ledger.images(values.session).length || ledger.rejections(values.session).length)
      throw new Error(`the ledger already holds session ${values.session}; ingesting again would duplicate it (pass another --session or --ledger)`);
    const result = ingest({ folder: positionals[0]!, session: values.session, ledger, dataDir, settings, minPixels });
    writePrivateManifest(dataDir, privateManifest(result));
    console.log(formatTable(result));
    return 0;
  } catch (e) {
    console.error(`bookcase ingest: ${e instanceof Error ? e.message : e}`);
    return 1;
  } finally {
    ledger?.close();
  }
}

export const manifestUsage = `usage: bookcase manifest <session> [--ledger <db>] [--out <path>]

Writes the public fixture manifest of <session> from its ledger: hashes, dimensions, setting, shelf index
and the derivative flag. No capture time, GPS, store, file names or images.

  --ledger   the SQLite ledger (default: $BOOKCASE_DATA/ledger/<session>.sqlite), opened read-only
  --out      where to write it (default: fixtures/<session>/manifest.json, relative to the working directory)`;

export function manifestCommand(argv: string[], env: NodeJS.ProcessEnv = process.env): number {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { ledger: { type: "string" }, out: { type: "string" }, help: { type: "boolean", short: "h" } } });
  } catch (e) {
    console.error(`bookcase manifest: ${e instanceof Error ? e.message : e}\n\n${manifestUsage}`);
    return 1;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    console.log(manifestUsage);
    return 0;
  }
  if (positionals.length !== 1) {
    console.error(manifestUsage);
    return 1;
  }
  const session = positionals[0]!;
  const dbPath = values.ledger ?? sessionLedgerPath(dataRoot(env), session);
  if (!existsSync(dbPath)) {
    console.error(`bookcase manifest: no ledger at ${dbPath} (pass --ledger <db>)`);
    return 1;
  }
  let ledger: SqliteLedger | undefined;
  try {
    ledger = new SqliteLedger(dbPath, { readOnly: true });
    const manifest = publicManifest(ledger, session);
    const out = values.out ?? join("fixtures", session, "manifest.json");
    writePublicManifest(manifest, out);
    console.log(`${manifest.photos.length} accepted, ${manifest.rejected.length} rejected: wrote ${out}`);
    return 0;
  } catch (e) {
    console.error(`bookcase manifest: ${e instanceof Error ? e.message : e}`);
    return 1;
  } finally {
    ledger?.close();
  }
}
