// `bookcase ingest <folder> --session <name> [--settings <map.json>] [--min-pixels <n>]`
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { MemoryLedger } from "../ledger/index.ts";
import { formatTable, ingest, loadSettingsMap, DEFAULT_MIN_PIXELS } from "./ingest.ts";
import { dataRoot } from "./store.ts";

export const ingestUsage = `usage: bookcase ingest <folder> --session <name> [--settings <map.json>] [--min-pixels <n>]

  <folder>       an exported folder of originals (read only; it is never written to)
  --session      scan session name, e.g. sf-store-001
  --settings     JSON map: file name -> "whole-12" | "whole-48" | "shelf-48" | "overview"
                 or {"setting": "...", "shelfIndex": n}
  --min-pixels   session minimum in pixels (default ${DEFAULT_MIN_PIXELS})

Data goes under $BOOKCASE_DATA (default ~/data/bookcase-discovery/).`;

export function ingestCommand(argv: string[], env: NodeJS.ProcessEnv = process.env): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { session: { type: "string" }, settings: { type: "string" }, "min-pixels": { type: "string" }, help: { type: "boolean", short: "h" } },
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
  const ledger = new MemoryLedger();
  try {
    const settings = values.settings ? loadSettingsMap(values.settings) : undefined;
    const result = ingest({ folder: positionals[0]!, session: values.session, ledger, dataDir, settings, minPixels });
    // L-2's SQLite ledger replaces this: until then the events are kept as JSON Lines, private under the data root.
    const dir = join(dataDir, "events");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${values.session}.ingest.jsonl`), [...ledger.events()].map((e) => JSON.stringify(e)).join("\n") + "\n");
    console.log(formatTable(result));
    return 0;
  } catch (e) {
    console.error(`bookcase ingest: ${e instanceof Error ? e.message : e}`);
    return 1;
  }
}
