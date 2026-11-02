// ISFDB staging (C-1): stream a mysqldump into `catalog/isfdb-staging.sqlite`.
//
// "Staging" means ISFDB's own tables, trimmed to the columns retrieval needs, with ISFDB's own
// names (docs/catalog.md has the field map). Nothing is merged, deduplicated or normalised except one
// derived column, `pubs.isbn13`. C-3 builds the retrieval index from this file.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, basename } from "node:path";
import { createGunzip } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import type { StatementSync } from "node:sqlite";
import { toIsbn13 } from "./isbn.ts";
import { MysqlDumpParser } from "./mysqldump.ts";
import type { Value } from "./mysqldump.ts";

/** Bump when a staged table or column changes. `PRAGMA user_version` and `meta.schema_version` hold it. */
export const STAGING_SCHEMA_VERSION = 1;

type SqlType = "INTEGER" | "TEXT";

export interface StagedTable {
  /** ISFDB's table name, and the staged table's. */
  name: string;
  /** Kept columns, in staged order. A column named in `derived` is computed, not read from the dump. */
  columns: ReadonlyArray<readonly [name: string, type: SqlType]>;
  /** The column the content hash orders by. Unique in ISFDB. */
  key: string;
  /** Columns computed from the kept ones. */
  derived?: { columns: ReadonlyArray<readonly [string, SqlType]>; compute(row: Record<string, Value>): Value[] };
  /** `CREATE INDEX` column lists, made after the load. */
  indexes: ReadonlyArray<string>;
}

const int = "INTEGER" as const;
const text = "TEXT" as const;

export const TABLES: ReadonlyArray<StagedTable> = [
  {
    name: "authors",
    columns: [["author_id", int], ["author_canonical", text], ["author_legalname", text], ["author_lastname", text], ["author_language", int]],
    key: "author_id",
    indexes: ["author_canonical"],
  },
  {
    name: "canonical_author",
    columns: [["ca_id", int], ["title_id", int], ["author_id", int], ["ca_status", int]],
    key: "ca_id",
    indexes: ["title_id", "author_id"],
  },
  {
    name: "titles",
    columns: [
      ["title_id", int], ["title_title", text], ["series_id", int], ["title_seriesnum", int], ["title_seriesnum_2", text],
      ["title_copyright", text], ["title_ttype", text], ["title_parent", int], ["title_language", int],
      ["title_non_genre", text], ["title_graphic", text],
    ],
    key: "title_id",
    indexes: ["title_title", "title_parent", "series_id"],
  },
  {
    name: "pubs",
    columns: [
      ["pub_id", int], ["pub_title", text], ["pub_tag", text], ["pub_year", text], ["publisher_id", int], ["pub_pages", text],
      ["pub_ptype", text], ["pub_ctype", text], ["pub_isbn", text], ["pub_series_id", int], ["pub_series_num", text], ["pub_catalog", text],
    ],
    key: "pub_id",
    derived: {
      columns: [["isbn13", text]],
      compute: (row) => [toIsbn13(row.pub_isbn as string | null)],
    },
    indexes: ["isbn13", "pub_isbn", "publisher_id", "pub_series_id"],
  },
  {
    name: "pub_authors",
    columns: [["pa_id", int], ["pub_id", int], ["author_id", int]],
    key: "pa_id",
    indexes: ["pub_id", "author_id"],
  },
  {
    name: "pub_content",
    columns: [["pubc_id", int], ["title_id", int], ["pub_id", int], ["pubc_page", text]],
    key: "pubc_id",
    indexes: ["pub_id", "title_id"],
  },
  { name: "publishers", columns: [["publisher_id", int], ["publisher_name", text]], key: "publisher_id", indexes: [] },
  { name: "pub_series", columns: [["pub_series_id", int], ["pub_series_name", text]], key: "pub_series_id", indexes: [] },
  {
    name: "series",
    columns: [["series_id", int], ["series_title", text], ["series_parent", int], ["series_type", int], ["series_parent_position", int]],
    key: "series_id",
    indexes: ["series_parent"],
  },
  { name: "tags", columns: [["tag_id", int], ["tag_name", text], ["tag_status", int]], key: "tag_id", indexes: [] },
  {
    name: "tag_mapping",
    columns: [["tagmap_id", int], ["tag_id", int], ["title_id", int], ["user_id", int]],
    key: "tagmap_id",
    indexes: ["title_id", "tag_id"],
  },
  { name: "languages", columns: [["lang_id", int], ["lang_name", text], ["lang_code", text]], key: "lang_id", indexes: [] },
];

export const TABLE_NAMES: ReadonlySet<string> = new Set(TABLES.map((t) => t.name));

const allColumns = (t: StagedTable) => [...t.columns, ...(t.derived?.columns ?? [])];

export function createSchema(db: DatabaseSync): void {
  db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;`);
  for (const t of TABLES) {
    const cols = allColumns(t).map(([n, ty]) => `${n} ${ty}${n === t.key ? " PRIMARY KEY" : ""}`);
    db.exec(`CREATE TABLE ${t.name} (${cols.join(", ")});`);
  }
  db.exec(`PRAGMA user_version = ${STAGING_SCHEMA_VERSION};`);
}

function createIndexes(db: DatabaseSync): void {
  for (const t of TABLES) {
    for (const col of t.indexes) db.exec(`CREATE INDEX ${t.name}_${col} ON ${t.name} (${col});`);
  }
}

// ---------------------------------------------------------------------------------------------
// Dump source
// ---------------------------------------------------------------------------------------------

export interface DumpSource {
  stream: AsyncIterable<Uint8Array>;
  /** Resolves when the producer finished cleanly; rejects if it failed (e.g. `unzip` exited non-zero). */
  done: Promise<void>;
}

/** Open a dump as a byte stream: a `.zip` (one entry, through `unzip -p`), a `.gz`, or a plain `.sql`/dump file. */
export async function openDump(path: string): Promise<DumpSource> {
  if (path.endsWith(".zip")) {
    const entries = await capture("unzip", ["-Z1", path]);
    const names = entries.split("\n").filter(Boolean);
    if (names.length !== 1) throw new Error(`${path}: expected exactly one entry, found ${names.length}`);
    const child = spawn("unzip", ["-p", path, names[0]!], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    const done = new Promise<void>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`unzip -p failed (${code}): ${stderr.trim()}`))));
    });
    done.catch(() => {}); // surfaced when the caller awaits it
    return { stream: child.stdout, done };
  }
  if (path.endsWith(".gz")) {
    const stream = createReadStream(path).pipe(createGunzip());
    return { stream, done: Promise.resolve() };
  }
  return { stream: createReadStream(path), done: Promise.resolve() };
}

function capture(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} ${args[0]} failed (${code}): ${err.trim()}`))));
  });
}

/** `backup-MySQL-55-2026-10-31...` -> `2026-10-31`. ISFDB names its backups by date. */
export function dumpDateFromName(path: string): string | null {
  return /(\d{4}-\d{2}-\d{2})/.exec(basename(path))?.[1] ?? null;
}

// ---------------------------------------------------------------------------------------------
// Staging
// ---------------------------------------------------------------------------------------------

export interface StageOptions {
  /** The dump (`.zip`, `.gz`, or plain). */
  dump: string;
  /** The staging database to write. It is built beside this path and renamed into place. */
  out: string;
  /** Overrides the date taken from the dump's file name. */
  dumpDate?: string;
  now?: () => Date;
  progress?: (message: string) => void;
}

export interface StageResult {
  out: string;
  counts: Record<string, number>;
  contentHash: string;
  dumpDate: string | null;
  invalidUtf8Strings: number;
}

export async function stageDump(options: StageOptions): Promise<StageResult> {
  const { dump, out } = options;
  const progress = options.progress ?? (() => {});
  const partial = `${out}.partial`;
  mkdirSync(dirname(out), { recursive: true });
  for (const f of [partial, `${partial}-journal`]) rmSync(f, { force: true });

  const db = new DatabaseSync(partial);
  let committed = false;
  try {
    db.exec("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;");
    createSchema(db);

    const inserts = new Map<string, StatementSync>();
    for (const t of TABLES) {
      const cols = allColumns(t);
      inserts.set(t.name, db.prepare(`INSERT INTO ${t.name} VALUES (${cols.map(() => "?").join(",")})`));
    }
    // dump column name -> position, from each table's CREATE TABLE
    const positions = new Map<string, number[]>();
    const arity = new Map<string, number>();
    const rowCounts = new Map<string, number>();
    let lastReport = Date.now();

    const parser = new MysqlDumpParser({
      tables: TABLE_NAMES,
      onTable(table, dumpColumns) {
        const spec = TABLES.find((t) => t.name === table)!;
        positions.set(
          table,
          spec.columns.map(([name]) => {
            const at = dumpColumns.indexOf(name);
            if (at === -1) throw new Error(`dump table \`${table}\` has no column \`${name}\` (has: ${dumpColumns.join(", ")})`);
            return at;
          }),
        );
        arity.set(table, dumpColumns.length);
      },
      onRow(table, row) {
        const spec = TABLES.find((t) => t.name === table)!;
        const pos = positions.get(table);
        if (!pos) throw new Error(`INSERT INTO \`${table}\` before its CREATE TABLE`);
        if (row.length !== arity.get(table)) {
          throw new Error(`\`${table}\` row has ${row.length} values; its CREATE TABLE has ${arity.get(table)}`);
        }
        const kept = pos.map((p) => row[p]!);
        let values: Value[] = kept;
        if (spec.derived) {
          const named: Record<string, Value> = {};
          spec.columns.forEach(([name], k) => (named[name] = kept[k]!));
          values = [...kept, ...spec.derived.compute(named)];
        }
        inserts.get(table)!.run(...values);
        rowCounts.set(table, (rowCounts.get(table) ?? 0) + 1);
        if (Date.now() - lastReport > 10_000) {
          lastReport = Date.now();
          progress(`  ${(parser.stats.bytes / 1e6).toFixed(0)} MB read, ${parser.stats.rows.toLocaleString("en-US")} rows`);
        }
      },
    });
    db.exec("BEGIN");
    const source = await openDump(dump);
    for await (const chunk of source.stream) parser.push(chunk);
    await source.done;
    parser.finish();
    db.exec("COMMIT");

    for (const t of TABLES) {
      if (!positions.has(t.name)) throw new Error(`the dump has no table \`${t.name}\``);
    }
    progress("building indexes");
    createIndexes(db);

    const counts = tableCounts(db);
    const contentHash = computeContentHash(db);
    const dumpDate = options.dumpDate ?? dumpDateFromName(dump);
    const meta = db.prepare("INSERT INTO meta VALUES (?, ?)");
    const set = (k: string, v: string) => meta.run(k, v);
    set("schema_version", String(STAGING_SCHEMA_VERSION));
    set("source", "ISFDB mysqldump (CC BY 4.0), https://www.isfdb.org/");
    set("dump_file", basename(dump));
    set("dump_bytes", String(statSync(dump).size));
    set("dump_date", dumpDate ?? "unknown");
    set("dump_stream_bytes", String(parser.stats.bytes));
    set("invalid_utf8_strings", String(parser.stats.invalidUtf8));
    set("imported_at", (options.now ?? (() => new Date()))().toISOString());
    set("content_hash", contentHash);
    for (const [name, n] of Object.entries(counts)) set(`rows.${name}`, String(n));

    db.exec("PRAGMA optimize");
    db.close();
    committed = true;
    renameSync(partial, out);
    return { out, counts, contentHash, dumpDate, invalidUtf8Strings: parser.stats.invalidUtf8 };
  } finally {
    if (!committed) {
      try { db.close(); } catch { /* already closed */ }
      rmSync(partial, { force: true });
    }
  }
}

export function tableCounts(db: DatabaseSync): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of TABLES) {
    counts[t.name] = Number((db.prepare(`SELECT COUNT(*) AS n FROM ${t.name}`).get() as { n: number | bigint }).n);
  }
  return counts;
}

/**
 * sha256 over every staged row, tables in a fixed order and rows ordered by key, each row as a JSON
 * array. It covers content only: `meta` (import time, file size) is outside it, so two parses of the
 * same dump give the same hash, and so does a parse of a different file with the same data.
 */
export function computeContentHash(db: DatabaseSync): string {
  const hash = createHash("sha256");
  for (const t of TABLES) {
    const names = allColumns(t).map(([n]) => n);
    hash.update(`#${t.name} ${names.join(",")}\n`);
    const select = db.prepare(`SELECT ${names.join(", ")} FROM ${t.name} ORDER BY ${t.key}`);
    select.setReturnArrays(true);
    for (const row of select.iterate()) hash.update(JSON.stringify(row) + "\n");
  }
  return hash.digest("hex");
}
