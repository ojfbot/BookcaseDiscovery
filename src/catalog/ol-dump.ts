// Open Library monthly dumps (C-5): streaming reader, the measuring pass, the two-layer filter and the
// staging file the catalog build merges.
//
// A dump is gzipped text, one record per line: `type \t key \t revision \t last_modified \t JSON`. The dumps are
// untrusted data: they are only ever parsed (JSON.parse per line), never executed, and read as a stream, so a
// 12 GB file is never held whole. Ids are Open Library's own (`/works/OL45804W` -> 45804); per-work facts the
// filter needs (edition count, first year, English, layer) live in typed arrays indexed by that number.
//
// Passes, in order: works (which exist, their own first-publish year, shelf-held title candidates), authors
// (surnames of those candidates' authors), editions (count, earliest year, English, shelf-held ISBNs). That is
// the measurement. Staging then streams editions, works and authors once more and keeps the selected rows.
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { createGunzip } from "node:zlib";
import { toIsbn13 } from "./isbn.ts";
import { normalize, splitSubtitle } from "./normalize.ts";
import { surnameOf } from "./coverage.ts";

/**
 * Bump when a table or column of the Open Library staging file changes.
 * 2 (C-9): `ol_editions.publishers`. Version 1 files have no other difference, so the merge reads both.
 */
export const OL_STAGING_SCHEMA_VERSION = 2;
export const READABLE_OL_STAGING_VERSIONS: readonly number[] = [1, 2];

/** The breadth layer (C-4's proposal): English-language works first published in 1960 or later, with 2+ editions. */
export const BREADTH = { language: "/languages/eng", minYear: 1960, minEditions: 2 } as const;

/** Years outside this range are treated as unknown (typos such as "0198" or "9999"). */
const YEAR_MIN = 1450;
const YEAR_MAX = 2027;
/** A line longer than this is skipped and counted, not parsed. Real records are a few KB. */
const MAX_LINE = 4 * 1024 * 1024;

export type DumpKind = "works" | "editions" | "authors";

export interface DumpFiles {
  works: string;
  editions: string;
  authors: string;
}

/**
 * Each record of a dump file, parsed, with its type and key from the tab-separated prefix. `want`, when given, is
 * asked first with the type and key, and a line it refuses is not parsed at all (most of a dump, on later passes).
 */
export async function* dumpRecords(
  path: string,
  stats: { lines: number; skipped: number; filtered?: number } = { lines: 0, skipped: 0 },
  want?: (type: string, key: string) => boolean,
): AsyncGenerator<{ type: string; key: string; rec: Record<string, unknown> }> {
  const raw = createReadStream(path, { highWaterMark: 1 << 20 });
  const input = path.endsWith(".gz") ? raw.pipe(createGunzip({ chunkSize: 1 << 20 })) : raw;
  const rl = createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    stats.lines++;
    if (line === "") continue;
    if (line.length > MAX_LINE) {
      stats.skipped++;
      continue;
    }
    const t1 = line.indexOf("\t");
    const t2 = line.indexOf("\t", t1 + 1);
    const t3 = line.indexOf("\t", t2 + 1);
    const t4 = line.indexOf("\t", t3 + 1);
    if (t1 < 0 || t2 < 0 || t3 < 0 || t4 < 0) {
      stats.skipped++;
      continue;
    }
    const type = line.slice(0, t1);
    const key = line.slice(t1 + 1, t2);
    if (want && !want(type, key)) {
      stats.filtered = (stats.filtered ?? 0) + 1;
      continue;
    }
    let rec: unknown;
    try {
      rec = JSON.parse(line.slice(t4 + 1));
    } catch {
      stats.skipped++;
      continue;
    }
    if (rec === null || typeof rec !== "object" || Array.isArray(rec)) {
      stats.skipped++;
      continue;
    }
    yield { type, key, rec: rec as Record<string, unknown> };
  }
}

/** `/works/OL45804W` -> 45804 (kind letter W, M or A); null for anything else. */
export function olNum(key: unknown, letter: "W" | "M" | "A"): number | null {
  if (typeof key !== "string") return null;
  const m = /^\/(?:works|books|authors)\/OL(\d{1,10})([WMA])$/.exec(key);
  if (!m || m[2] !== letter) return null;
  const n = Number(m[1]);
  return n > 0 && n < 2 ** 31 ? n : null;
}

/** The first plausible four-digit year in a free-text date ("June 1985", "c1985", "1985-06-01", "[1985?]"). */
export function yearOf(date: unknown): number | null {
  if (typeof date !== "string") return null;
  for (const m of date.matchAll(/(?<!\d)(\d{4})(?!\d)/g)) {
    const y = Number(m[1]);
    if (y >= YEAR_MIN && y <= YEAR_MAX) return y;
  }
  return null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter((s): s is string => s !== null) : []);

/** Every distinct publisher string of an edition, in order (Open Library's `publishers` is a free-text array). */
export function editionPublishers(rec: Record<string, unknown>): string[] {
  return [...new Set(strList(rec.publishers))];
}

/** Valid ISBN-13s of an edition, ISBN-13 fields first, then converted ISBN-10s; distinct, in order. */
export function editionIsbns(rec: Record<string, unknown>): string[] {
  const out = new Set<string>();
  for (const raw of [...strList(rec.isbn_13), ...strList(rec.isbn_10)]) {
    const i = toIsbn13(raw);
    if (i) out.add(i);
  }
  return [...out];
}

/** The work an edition belongs to (its first `works` entry). */
export function editionWork(rec: Record<string, unknown>): number | null {
  const works = rec.works;
  if (!Array.isArray(works) || works.length === 0) return null;
  const w = works[0] as { key?: unknown } | null;
  return w && typeof w === "object" ? olNum(w.key, "W") : null;
}

export function editionLanguages(rec: Record<string, unknown>): string[] {
  const langs = rec.languages;
  if (!Array.isArray(langs)) return [];
  return langs.map((l) => (l && typeof l === "object" ? str((l as { key?: unknown }).key) : null)).filter((s): s is string => s !== null);
}

/** Author numbers of a work, in order: `authors: [{author: {key}}]` (older records: `{key}`). */
export function workAuthors(rec: Record<string, unknown>): number[] {
  const list = rec.authors;
  if (!Array.isArray(list)) return [];
  const out: number[] = [];
  for (const a of list) {
    if (!a || typeof a !== "object") continue;
    const inner = (a as { author?: unknown }).author;
    const key = inner && typeof inner === "object" ? (inner as { key?: unknown }).key : (a as { key?: unknown }).key;
    const n = olNum(key, "A");
    if (n !== null && !out.includes(n)) out.push(n);
  }
  return out;
}

/** The comparison key for a title: main title (no subtitle, no trailing parenthetical), normalised, leading article dropped. */
export function titleKey(title: string): string {
  return normalize(splitSubtitle(title.replace(/\s*\([^)]*\)\s*$/, "")).main).replace(/^(the|a|an) /, "");
}

// ---------------------------------------------------------------------------------------------
// Layer 1 (shelf-held): the books C-4's resolver resolved on scanned sessions
// ---------------------------------------------------------------------------------------------

export interface ShelfBook {
  /** Open Library work number when the resolving record was an Open Library work. */
  olWork: number | null;
  isbns: string[];
  titleKey: string;
  surnames: string[];
}

/** The resolved records of C-4's private per-box tables (`private/c4/<session>.<role>.jsonl`). */
export function loadShelfBooks(paths: string[]): ShelfBook[] {
  const out: ShelfBook[] = [];
  const seen = new Set<string>();
  for (const p of paths) {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      if (line.trim() === "") continue;
      const r = JSON.parse(line) as { record?: { source: string; id: string; title: string; authors: string[]; isbns: string[] } | null };
      const rec = r.record;
      if (!rec) continue;
      const book: ShelfBook = {
        olWork: rec.source === "openlibrary" ? olNum(rec.id, "W") : null,
        isbns: [...new Set(rec.isbns.map(toIsbn13).filter((x): x is string => x !== null))],
        titleKey: titleKey(rec.title),
        surnames: rec.authors.slice(0, 3).map(surnameOf).filter((s): s is string => s !== null),
      };
      const id = JSON.stringify([book.olWork, book.titleKey, book.surnames]);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(book);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Measuring pass
// ---------------------------------------------------------------------------------------------

/** Per-work flags (bit set in `WorkFacts.flags`). */
export const FLAG = { exists: 1, english: 2, shelf: 4 } as const;

/** Per-number facts for works, grown as larger numbers appear. */
export class WorkFacts {
  flags = new Uint8Array(1 << 20);
  editions = new Uint32Array(1 << 20);
  /** Earliest year seen (work's own first_publish_date or any edition's), 0 = unknown. */
  year = new Uint16Array(1 << 20);
  max = 0;

  ensure(n: number): void {
    if (n < this.flags.length) return;
    let size = this.flags.length;
    while (size <= n) size *= 2;
    const grow = <T extends Uint8Array | Uint16Array | Uint32Array>(a: T, make: (s: number) => T): T => {
      const b = make(size);
      b.set(a);
      return b;
    };
    this.flags = grow(this.flags, (s) => new Uint8Array(s));
    this.editions = grow(this.editions, (s) => new Uint32Array(s));
    this.year = grow(this.year, (s) => new Uint16Array(s));
  }

  noteYear(n: number, y: number | null): void {
    if (y !== null && (this.year[n] === 0 || y < this.year[n]!)) this.year[n] = y;
  }

  breadth(n: number): boolean {
    return (this.flags[n]! & FLAG.english) !== 0 && this.year[n]! >= BREADTH.minYear && this.editions[n]! >= BREADTH.minEditions;
  }

  /** Is the work kept: shelf-held or breadth? */
  kept(n: number): boolean {
    return (this.flags[n]! & FLAG.exists) !== 0 && ((this.flags[n]! & FLAG.shelf) !== 0 || this.breadth(n));
  }

  /** Writes the arrays (up to `max`) to `dir`, so staging can reuse a measurement without re-reading the dumps. */
  save(dir: string): void {
    mkdirSync(dir, { recursive: true });
    const n = this.max + 1;
    writeFileSync(`${dir}/flags.bin`, this.flags.subarray(0, n));
    writeFileSync(`${dir}/editions.bin`, new Uint8Array(this.editions.buffer, 0, n * 4));
    writeFileSync(`${dir}/year.bin`, new Uint8Array(this.year.buffer, 0, n * 2));
  }

  static load(dir: string): WorkFacts {
    const f = new WorkFacts();
    const flags = readFileSync(`${dir}/flags.bin`);
    const n = flags.length;
    f.ensure(n);
    f.flags.set(flags);
    const copy = (path: string, bytes: number) => {
      const b = readFileSync(path);
      if (b.length !== bytes) throw new Error(`${path}: ${b.length} bytes, expected ${bytes}`);
      return b;
    };
    new Uint8Array(f.editions.buffer).set(copy(`${dir}/editions.bin`, n * 4));
    new Uint8Array(f.year.buffer).set(copy(`${dir}/year.bin`, n * 2));
    f.max = n - 1;
    return f;
  }
}

export interface MeasureCounts {
  works: number;
  english: number;
  since1960: number;
  twoPlusEditions: number;
  breadth: number;
  shelfHeld: number;
  shelfHeldOutsideBreadth: number;
  kept: number;
  noKnownYear: number;
  editions: number;
  editionsOfKept: number;
  editionsWithoutWork: number;
  editionsOfUnknownWork: number;
  authors: number;
  skippedLines: Record<DumpKind, number>;
  /** Shelf-held matches by how: Open Library work key, ISBN, title plus surname. */
  shelfBy: { key: number; isbn: number; titleSurname: number };
}

export interface MeasureResult {
  facts: WorkFacts;
  counts: MeasureCounts;
  seconds: number;
}

/** Streams the three dumps once and returns per-work facts and the subset counts (C-5 §2). */
export async function measure(files: DumpFiles, shelf: ShelfBook[], log: (s: string) => void = () => {}): Promise<MeasureResult> {
  const t0 = Date.now();
  const facts = new WorkFacts();
  const shelfKeys = new Set(shelf.map((b) => b.olWork).filter((n): n is number => n !== null));
  const shelfIsbns = new Set(shelf.flatMap((b) => b.isbns));
  const shelfTitles = new Map<string, Set<string>>(); // title key -> surnames
  for (const b of shelf) {
    if (b.titleKey.length < 2 || b.surnames.length === 0) continue;
    const s = shelfTitles.get(b.titleKey) ?? new Set<string>();
    for (const x of b.surnames) s.add(x);
    shelfTitles.set(b.titleKey, s);
  }
  const shelfBy = { key: 0, isbn: 0, titleSurname: 0 };
  const markShelf = (n: number, how: keyof typeof shelfBy) => {
    if ((facts.flags[n]! & FLAG.shelf) === 0) {
      facts.flags[n]! |= FLAG.shelf;
      shelfBy[how]++;
    }
  };

  // 1. works
  const wStats = { lines: 0, skipped: 0 };
  let works = 0;
  const titleCandidates: Array<{ work: number; titleKey: string; authors: number[] }> = [];
  for await (const { type, key, rec } of dumpRecords(files.works, wStats)) {
    if (type !== "/type/work") continue;
    const n = olNum(key, "W");
    if (n === null) continue;
    facts.ensure(n);
    if ((facts.flags[n]! & FLAG.exists) !== 0) continue;
    facts.flags[n]! |= FLAG.exists;
    if (n > facts.max) facts.max = n;
    works++;
    facts.noteYear(n, yearOf(rec.first_publish_date));
    if (shelfKeys.has(n)) markShelf(n, "key");
    const title = str(rec.title);
    if (title && shelfTitles.size > 0) {
      const k = titleKey(title);
      if (shelfTitles.has(k)) titleCandidates.push({ work: n, titleKey: k, authors: workAuthors(rec) });
    }
    if (works % 2_000_000 === 0) log(`works: ${works.toLocaleString("en-US")}`);
  }
  log(`works: ${works.toLocaleString("en-US")} (${wStats.skipped} lines skipped)`);

  // 2. authors: count, and surnames of the shelf-held title candidates' authors
  const want = new Set(titleCandidates.flatMap((c) => c.authors));
  const surnameOfAuthor = new Map<number, string | null>();
  const aStats = { lines: 0, skipped: 0 };
  let authors = 0;
  const wantAuthor = (type: string, key: string) => {
    if (type !== "/type/author") return false;
    authors++;
    const n = olNum(key, "A");
    return n !== null && want.has(n);
  };
  for await (const { key, rec } of dumpRecords(files.authors, aStats, wantAuthor)) {
    const n = olNum(key, "A");
    if (n !== null) {
      const name = str(rec.name);
      surnameOfAuthor.set(n, name ? surnameOf(name) : null);
    }
  }
  log(`authors: ${authors.toLocaleString("en-US")} (${aStats.skipped} lines skipped)`);
  for (const c of titleCandidates) {
    const surnames = shelfTitles.get(c.titleKey)!;
    if (c.authors.some((a) => {
      const s = surnameOfAuthor.get(a);
      return s !== null && s !== undefined && surnames.has(s);
    })) markShelf(c.work, "titleSurname");
  }

  // 3. editions
  const eStats = { lines: 0, skipped: 0 };
  let editions = 0;
  let withoutWork = 0;
  let unknownWork = 0;
  for await (const { rec } of dumpRecords(files.editions, eStats, (type) => type === "/type/edition")) {
    editions++;
    const w = editionWork(rec);
    if (w === null) {
      withoutWork++;
      continue;
    }
    if (w >= facts.flags.length || (facts.flags[w]! & FLAG.exists) === 0) {
      unknownWork++;
      continue;
    }
    facts.editions[w]!++;
    facts.noteYear(w, yearOf(rec.publish_date));
    if (editionLanguages(rec).includes(BREADTH.language)) facts.flags[w]! |= FLAG.english;
    if (shelfIsbns.size > 0 && editionIsbns(rec).some((i) => shelfIsbns.has(i))) markShelf(w, "isbn");
    if (editions % 5_000_000 === 0) log(`editions: ${editions.toLocaleString("en-US")}`);
  }
  log(`editions: ${editions.toLocaleString("en-US")} (${eStats.skipped} lines skipped)`);

  const counts: MeasureCounts = {
    works, english: 0, since1960: 0, twoPlusEditions: 0, breadth: 0, shelfHeld: 0, shelfHeldOutsideBreadth: 0, kept: 0, noKnownYear: 0,
    editions, editionsOfKept: 0, editionsWithoutWork: withoutWork, editionsOfUnknownWork: unknownWork, authors,
    skippedLines: { works: wStats.skipped, editions: eStats.skipped, authors: aStats.skipped },
    shelfBy,
  };
  for (let n = 0; n <= facts.max; n++) {
    const f = facts.flags[n]!;
    if ((f & FLAG.exists) === 0) continue;
    if (f & FLAG.english) counts.english++;
    if (facts.year[n]! >= BREADTH.minYear) counts.since1960++;
    if (facts.year[n] === 0) counts.noKnownYear++;
    if (facts.editions[n]! >= BREADTH.minEditions) counts.twoPlusEditions++;
    const b = facts.breadth(n);
    if (b) counts.breadth++;
    if (f & FLAG.shelf) {
      counts.shelfHeld++;
      if (!b) counts.shelfHeldOutsideBreadth++;
    }
    if (facts.kept(n)) {
      counts.kept++;
      counts.editionsOfKept += facts.editions[n]!;
    }
  }
  return { facts, counts, seconds: (Date.now() - t0) / 1000 };
}

// ---------------------------------------------------------------------------------------------
// Staging
// ---------------------------------------------------------------------------------------------

const STAGING_SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE ol_works (
  id            INTEGER PRIMARY KEY, -- Open Library work number (OL<id>W)
  title         TEXT NOT NULL,
  subtitle      TEXT,
  authors       TEXT NOT NULL,       -- JSON array of author numbers, in Open Library order
  year          INTEGER,             -- earliest year: the work's first_publish_date or any edition's publish_date
  edition_count INTEGER NOT NULL,
  english       INTEGER NOT NULL,    -- at least one edition in English
  layer         TEXT NOT NULL        -- 'shelf', 'breadth' or 'shelf+breadth'; 'isbn' in a stageByIsbn file (KN-1)
);
CREATE TABLE ol_editions (
  id        INTEGER PRIMARY KEY,     -- Open Library edition number (OL<id>M)
  work_id   INTEGER NOT NULL,
  isbn13    TEXT,                    -- first valid ISBN-13 (ISBN-13 fields first, then converted ISBN-10s)
  isbns     TEXT NOT NULL,           -- JSON array of every valid ISBN-13
  isbn      TEXT,                    -- the first ISBN as the record has it
  publisher TEXT,                    -- the first publisher string
  publishers TEXT,                   -- JSON array of every distinct publisher string, in order, when there are 2+ (C-9)
  year      INTEGER,
  title     TEXT,
  format    TEXT                     -- physical_format as recorded
);
CREATE TABLE ol_authors (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
`;

export interface StageResult {
  out: string;
  rows: { works: number; editions: number; authors: number };
  seconds: number;
}

/** Streams editions, works and authors again and writes the kept rows to `out` (renamed into place when done). */
export async function stage(files: DumpFiles, facts: WorkFacts, out: string, meta: Record<string, string>, log: (s: string) => void = () => {}): Promise<StageResult> {
  const t0 = Date.now();
  mkdirSync(dirname(out), { recursive: true });
  const partial = `${out}.partial`;
  rmSync(partial, { force: true });
  const db = new DatabaseSync(partial);
  try {
    db.exec("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;");
    db.exec(STAGING_SCHEMA);
    db.exec("BEGIN");

    // editions of kept works
    const insEd = db.prepare("INSERT OR IGNORE INTO ol_editions (id, work_id, isbn13, isbns, isbn, publisher, publishers, year, title, format) VALUES (?,?,?,?,?,?,?,?,?,?)");
    let editions = 0;
    for await (const { key, rec } of dumpRecords(files.editions, undefined, (type) => type === "/type/edition")) {
      const w = editionWork(rec);
      if (w === null || w >= facts.flags.length || !facts.kept(w)) continue;
      const id = olNum(key, "M");
      if (id === null) continue;
      const isbns = editionIsbns(rec);
      const title = str(rec.title);
      const sub = str(rec.subtitle);
      const pubs = editionPublishers(rec);
      insEd.run(
        id, w, isbns[0] ?? null, JSON.stringify(isbns), [...strList(rec.isbn_13), ...strList(rec.isbn_10)][0] ?? null,
        pubs[0] ?? null, pubs.length > 1 ? JSON.stringify(pubs) : null, yearOf(rec.publish_date), title ? (sub ? `${title}: ${sub}` : title) : null, str(rec.physical_format),
      );
      editions++;
      if (editions % 2_000_000 === 0) log(`staged editions: ${editions.toLocaleString("en-US")}`);
    }
    log(`staged editions: ${editions.toLocaleString("en-US")}`);

    // kept works, and which authors they need
    const insWork = db.prepare("INSERT OR IGNORE INTO ol_works (id, title, subtitle, authors, year, edition_count, english, layer) VALUES (?,?,?,?,?,?,?,?)");
    const neededAuthors = new Set<number>();
    let works = 0;
    const keptWork = (type: string, key: string) => {
      const n = type === "/type/work" ? olNum(key, "W") : null;
      return n !== null && n < facts.flags.length && facts.kept(n);
    };
    for await (const { key, rec } of dumpRecords(files.works, undefined, keptWork)) {
      const n = olNum(key, "W")!;
      const title = str(rec.title);
      if (!title) continue;
      const authors = workAuthors(rec);
      for (const a of authors) neededAuthors.add(a);
      const shelf = (facts.flags[n]! & FLAG.shelf) !== 0;
      const breadth = facts.breadth(n);
      insWork.run(
        n, title, str(rec.subtitle), JSON.stringify(authors), facts.year[n] || null, facts.editions[n]!,
        (facts.flags[n]! & FLAG.english) !== 0 ? 1 : 0, shelf && breadth ? "shelf+breadth" : shelf ? "shelf" : "breadth",
      );
      works++;
    }
    log(`staged works: ${works.toLocaleString("en-US")}`);

    const insAuthor = db.prepare("INSERT OR IGNORE INTO ol_authors (id, name) VALUES (?, ?)");
    let authors = 0;
    const needed = (type: string, key: string) => {
      const n = type === "/type/author" ? olNum(key, "A") : null;
      return n !== null && neededAuthors.has(n);
    };
    for await (const { key, rec } of dumpRecords(files.authors, undefined, needed)) {
      const n = olNum(key, "A")!;
      const name = str(rec.name);
      if (!name) continue;
      insAuthor.run(n, name);
      authors++;
    }
    log(`staged authors: ${authors.toLocaleString("en-US")}`);

    const insMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
    insMeta.run("schema_version", String(OL_STAGING_SCHEMA_VERSION));
    for (const [k, v] of Object.entries(meta)) insMeta.run(k, v);
    insMeta.run("rows.ol_works", String(works));
    insMeta.run("rows.ol_editions", String(editions));
    insMeta.run("rows.ol_authors", String(authors));
    db.exec("COMMIT");
    log("indexing");
    db.exec("CREATE INDEX ol_editions_work ON ol_editions(work_id); CREATE INDEX ol_editions_isbn13 ON ol_editions(isbn13);");
    db.exec(`PRAGMA user_version = ${OL_STAGING_SCHEMA_VERSION}`);
    db.close();
    rmSync(out, { force: true });
    renameSync(partial, out);
    return { out, rows: { works, editions, authors }, seconds: (Date.now() - t0) / 1000 };
  } catch (e) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    rmSync(partial, { force: true });
    throw e;
  }
}

/**
 * A staging file of the Open Library works whose editions share an ISBN-13 with `isbns` (KN-1: a closed-set catalog
 * such as the yardstick's inventory, whose books the breadth layer mostly misses). Every edition of a matched work
 * that carries one of the ISBNs is kept; works get layer `isbn`, no authors and no year, so C-5's crosswalk can only
 * link them by ISBN. Two passes, editions then works; nothing is fetched.
 */
export async function stageByIsbn(files: Pick<DumpFiles, "works" | "editions">, isbns: ReadonlySet<string>, out: string, meta: Record<string, string>, log: (s: string) => void = () => {}): Promise<StageResult> {
  const t0 = Date.now();
  mkdirSync(dirname(out), { recursive: true });
  const partial = `${out}.partial`;
  rmSync(partial, { force: true });
  const db = new DatabaseSync(partial);
  try {
    db.exec("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;");
    db.exec(STAGING_SCHEMA);
    db.exec("BEGIN");
    const insEd = db.prepare("INSERT OR IGNORE INTO ol_editions (id, work_id, isbn13, isbns, isbn, publisher, publishers, year, title, format) VALUES (?,?,?,?,?,?,?,?,?,?)");
    const editionsOf = new Map<number, number>();
    let n = 0;
    for await (const { key, rec } of dumpRecords(files.editions, { lines: 0, skipped: 0 }, (type) => type === "/type/edition")) {
      if (++n % 5_000_000 === 0) log(`isbn stage: ${n.toLocaleString("en-US")} editions read`);
      const all = editionIsbns(rec);
      if (!all.some((i) => isbns.has(i))) continue;
      const id = olNum(key, "M");
      const work = editionWork(rec);
      if (id === null || work === null) continue;
      const pubs = editionPublishers(rec);
      insEd.run(id, work, all[0] ?? null, JSON.stringify(all), str(strList(rec.isbn_13)[0]) ?? str(strList(rec.isbn_10)[0]), pubs[0] ?? null, pubs.length > 1 ? JSON.stringify(pubs) : null, yearOf(rec.publish_date), str(rec.title), str(rec.physical_format));
      editionsOf.set(work, (editionsOf.get(work) ?? 0) + 1);
    }
    log(`isbn stage: ${editionsOf.size.toLocaleString("en-US")} works matched`);
    const insWork = db.prepare("INSERT OR IGNORE INTO ol_works (id, title, subtitle, authors, year, edition_count, english, layer) VALUES (?, ?, ?, '[]', NULL, ?, 0, 'isbn')");
    for await (const { key, rec } of dumpRecords(files.works, { lines: 0, skipped: 0 }, (type, k) => type === "/type/work" && editionsOf.has(olNum(k, "W") ?? -1))) {
      const id = olNum(key, "W")!;
      insWork.run(id, str(rec.title) ?? "", str(rec.subtitle), editionsOf.get(id)!);
    }
    // editions whose work is not in the works dump (a redirect, say) cannot be crosswalked
    db.exec("DELETE FROM ol_editions WHERE work_id NOT IN (SELECT id FROM ol_works)");
    const count = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    const rows = { works: count("ol_works"), editions: count("ol_editions"), authors: 0 };
    const insMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
    insMeta.run("schema_version", String(OL_STAGING_SCHEMA_VERSION));
    insMeta.run("layer", "isbn");
    for (const [k, v] of Object.entries(meta)) insMeta.run(k, v);
    for (const [k, v] of Object.entries(rows)) insMeta.run(`rows.ol_${k}`, String(v));
    db.exec("COMMIT");
    db.exec(`PRAGMA user_version = ${OL_STAGING_SCHEMA_VERSION}`);
    db.close();
    rmSync(out, { force: true });
    renameSync(partial, out);
    return { out, rows, seconds: (Date.now() - t0) / 1000 };
  } catch (e) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    rmSync(partial, { force: true });
    throw e;
  }
}

/** The three dump files of one dump date in `dir` (`ol_dump_<kind>_<date>.txt.gz`). */
export function dumpFiles(dir: string, date: string): DumpFiles {
  const f = (k: DumpKind) => `${dir}/ol_dump_${k}_${date}.txt.gz`;
  const files = { works: f("works"), editions: f("editions"), authors: f("authors") };
  for (const p of Object.values(files)) if (!existsSync(p)) throw new Error(`dump file missing: ${p}`);
  return files;
}

export function fileBytes(files: DumpFiles): Record<DumpKind, number> {
  return { works: statSync(files.works).size, editions: statSync(files.editions).size, authors: statSync(files.authors).size };
}
