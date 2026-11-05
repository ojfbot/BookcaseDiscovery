// `pnpm catalog:ol measure | stage | subjects` (C-5, KN-1): the Open Library dumps into $BOOKCASE_DATA/catalog/.
//
//   measure  stream the three dumps once; print the subset counts and the projected index size; save the per-work
//            facts under catalog/ol-measure/<date>/ (counts.json beside them)
//   stage    reuse a saved measurement and write the kept works, their editions and authors to the staging file
//   subjects read the works dump's subjects for the staged breadth works into ol-subjects-<date>.sqlite (KN-1's
//            work features; `bookcase catalog build --ol-subjects`)
//
// The shelf-held layer reads C-4's private per-box tables (private/c4/*.{sample,tuning}.jsonl). Only counts are
// printed: no title from those tables reaches the terminal.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { dataRoot } from "../ledger/images.ts";
import { dumpFiles, fileBytes, loadShelfBooks, measure, stage, WorkFacts, type MeasureCounts } from "./ol-dump.ts";
import { extractOlSubjects } from "./work-features.ts";

const usage = `usage: pnpm catalog:ol <measure|stage|subjects> [--dumps <dir>] [--date YYYY-MM-DD] [--out <file>] [--staging <file>]

  --dumps    default: $BOOKCASE_DATA/catalog/ol-dumps/<date>/
  --date     the dump date; default: the newest folder under catalog/ol-dumps/
  --out      stage: default $BOOKCASE_DATA/catalog/ol-staging.sqlite; subjects: default catalog/ol-subjects-<date>.sqlite
  --staging  subjects only: the staging file whose breadth works are read (default catalog/ol-staging.sqlite)`;

const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * Projected catalog size from C-3's own build (dbstat on the 2026-10-31 catalog.sqlite): about 600 bytes per work
 * (row, title forms, their FTS, author links) and 200 per edition (row and its two indexes), on top of ISFDB's 426 MB.
 */
export function projectBytes(c: Pick<MeasureCounts, "kept" | "editionsOfKept">, isfdbBytes = 426_409_984): number {
  return isfdbBytes + c.kept * 600 + c.editionsOfKept * 200;
}

function shelfTables(root: string): string[] {
  const dir = join(root, "private", "c4");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /\.(sample|tuning)\.jsonl$/.test(f)).sort().map((f) => join(dir, f));
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const [cmd, ...rest] = argv;
  const { values } = parseArgs({ args: rest, options: { dumps: { type: "string" }, date: { type: "string" }, out: { type: "string" }, staging: { type: "string" } } });
  const root = dataRoot(env);
  const base = join(root, "catalog", "ol-dumps");
  const date = values.date ?? (existsSync(base) ? readdirSync(base).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().at(-1) : undefined);
  if ((cmd !== "measure" && cmd !== "stage" && cmd !== "subjects") || !date) {
    console.error(usage);
    return cmd === undefined || cmd === "--help" ? 0 : 1;
  }
  const files = dumpFiles(values.dumps ?? join(base, date), date);
  const measureDir = join(root, "catalog", "ol-measure", date);
  const log = (s: string) => console.error(`[ol] ${new Date().toISOString().slice(11, 19)} ${s}`);

  if (cmd === "subjects") {
    const out = values.out ?? join(root, "catalog", `ol-subjects-${date}.sqlite`);
    const r = await extractOlSubjects({ works: files.works, staging: values.staging ?? join(root, "catalog", "ol-staging.sqlite"), out, dumpDate: date, log });
    console.log(`wrote ${r.out} in ${Math.round(r.seconds)} s: ${fmt(r.withSubjects)} of ${fmt(r.works)} breadth works carry subjects (${fmt(r.lines)} dump lines)`);
    return 0;
  }

  if (cmd === "measure") {
    const tables = shelfTables(root);
    const shelf = loadShelfBooks(tables);
    log(`shelf-held layer: ${shelf.length} resolved books from ${tables.length} private table(s)`);
    const r = await measure(files, shelf, log);
    r.facts.save(measureDir);
    const out = { dumpDate: date, dumpBytes: fileBytes(files), shelfBooks: shelf.length, counts: r.counts, seconds: Math.round(r.seconds), projectedCatalogBytes: projectBytes(r.counts) };
    writeFileSync(join(measureDir, "counts.json"), `${JSON.stringify(out, null, 2)}\n`);
    const c = r.counts;
    console.log(`Open Library dump ${date}, measured in ${Math.round(r.seconds)} s`);
    for (const [k, v] of Object.entries({ works: c.works, english: c.english, since1960: c.since1960, twoPlusEditions: c.twoPlusEditions, breadth: c.breadth, shelfHeld: c.shelfHeld, shelfHeldOutsideBreadth: c.shelfHeldOutsideBreadth, kept: c.kept, noKnownYear: c.noKnownYear, editions: c.editions, editionsOfKept: c.editionsOfKept, authors: c.authors })) {
      console.log(`  ${k.padEnd(24)} ${fmt(v).padStart(12)}`);
    }
    console.log(`  shelf-held by key / ISBN / title+surname: ${c.shelfBy.key} / ${c.shelfBy.isbn} / ${c.shelfBy.titleSurname}`);
    console.log(`  projected catalog-v2 size ${(out.projectedCatalogBytes / 1e9).toFixed(2)} GB`);
    console.log(`  saved ${measureDir}`);
    return 0;
  }

  const counts = JSON.parse(readFileSync(join(measureDir, "counts.json"), "utf8")) as { counts: MeasureCounts };
  const facts = WorkFacts.load(measureDir);
  const out = values.out ?? join(root, "catalog", "ol-staging.sqlite");
  const r = await stage(files, facts, out, { dump_date: date, "measure.kept": String(counts.counts.kept), "measure.breadth": String(counts.counts.breadth), "measure.shelf_held": String(counts.counts.shelfHeld) }, log);
  console.log(`staged ${r.out} in ${Math.round(r.seconds)} s: works ${fmt(r.rows.works)}, editions ${fmt(r.rows.editions)}, authors ${fmt(r.rows.authors)}`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main(process.argv.slice(2));
}
