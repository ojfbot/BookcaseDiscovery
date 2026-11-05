import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCatalog, CATALOG_SCHEMA_VERSION } from "../src/catalog/build.ts";
import { catalogPaths, openCatalog } from "../src/catalog/cli.ts";
import { dumpRecords, editionIsbns, loadShelfBooks, measure, olNum, stage, titleKey, WorkFacts, yearOf, type MeasureResult } from "../src/catalog/ol-dump.ts";
import { OL_TTYPE } from "../src/catalog/ol-merge.ts";
import { retrieve } from "../src/catalog/retrieve.ts";
import { makeMiniStaging } from "./helpers/mini-staging.ts";
import { writeMiniOlDump, writeMiniShelf } from "./helpers/mini-ol-dump.ts";

describe("Open Library dump fields", () => {
  it("reads keys, years and ISBNs", () => {
    expect(olNum("/works/OL45804W", "W")).toBe(45804);
    expect(olNum("/books/OL7M", "M")).toBe(7);
    expect(olNum("/authors/OL7A", "W")).toBeNull();
    expect(olNum("/works/OL1W; DROP", "W")).toBeNull();
    expect(yearOf("June 1985")).toBe(1985);
    expect(yearOf("c1985")).toBe(1985);
    expect(yearOf("[1985?]")).toBe(1985);
    expect(yearOf("1985-06-01")).toBe(1985);
    expect(yearOf("0198")).toBeNull();
    expect(yearOf("9999")).toBeNull();
    expect(yearOf(1985)).toBeNull();
    expect(editionIsbns({ isbn_13: ["978-0-14-312053-7"], isbn_10: ["0143120530", "bogus"] })).toEqual(["9780143120537"]);
    expect(titleKey("The Hobbit: or There and Back Again")).toBe("hobbit");
    expect(titleKey("Shelf Title Match (a novel)")).toBe("shelf title match");
  });
});

describe("Open Library import (synthetic dumps)", () => {
  let dir: string;
  let catalog: string;
  let m: MeasureResult;
  let db: DatabaseSync;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "bcd-ol-"));
    const files = writeMiniOlDump(dir);
    const shelf = loadShelfBooks([writeMiniShelf(dir)]);
    m = await measure(files, shelf);
    m.facts.save(join(dir, "measure"));
    await stage(files, WorkFacts.load(join(dir, "measure")), join(dir, "ol-staging.sqlite"), { dump_date: "2026-10-31" });
    makeMiniStaging(join(dir, "isfdb-staging.sqlite"));
    catalog = join(dir, "catalog-v2.sqlite");
    buildCatalog({ staging: join(dir, "isfdb-staging.sqlite"), openLibrary: join(dir, "ol-staging.sqlite"), out: catalog });
    db = openCatalog(catalog);
  });
  afterAll(() => {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("skips non-work lines, repeated keys and malformed JSON", async () => {
    const stats = { lines: 0, skipped: 0 };
    let n = 0;
    for await (const r of dumpRecords(join(dir, "ol_dump_works_2026-10-31.txt.gz"), stats)) if (r.type === "/type/work") n++;
    expect(stats.skipped).toBe(1);
    expect(n).toBe(9); // one key twice; measure counts it once
  });

  it("measures the subsets", () => {
    const c = m.counts;
    expect(c.works).toBe(8);
    expect(c.english).toBe(7);
    expect(c.since1960).toBe(6);
    expect(c.twoPlusEditions).toBe(6);
    expect(c.breadth).toBe(4);
    expect(c.shelfHeld).toBe(2);
    expect(c.shelfHeldOutsideBreadth).toBe(2);
    expect(c.shelfBy).toEqual({ key: 0, isbn: 1, titleSurname: 1 });
    expect(c.kept).toBe(6);
    expect(c.editions).toBe(16);
    expect(c.editionsOfKept).toBe(10);
    expect(c.editionsWithoutWork).toBe(1);
    expect(c.editionsOfUnknownWork).toBe(1);
    expect(c.authors).toBe(8);
  });

  it("saves and loads the per-work facts", () => {
    const f = WorkFacts.load(join(dir, "measure"));
    for (let n = 1; n <= 8; n++) expect(f.kept(n)).toBe(m.facts.kept(n));
    expect(f.year[3]).toBe(1931);
  });

  it("crosswalks by ISBN, then by title and surname, without duplicating works", () => {
    const neuro = db.prepare("SELECT sources, edition_count FROM works WHERE id = 'isfdb:201'").get() as { sources: string; edition_count: number };
    expect(JSON.parse(neuro.sources)).toEqual([
      { source: "isfdb", id: 201, dump: "2026-10-31" },
      { source: "openlibrary", id: "OL1W", dump: "2026-10-31", layer: "breadth" },
    ]);
    expect(neuro.edition_count).toBe(3); // two ISFDB editions plus the Open Library one whose ISBN ISFDB lacks
    const red = db.prepare("SELECT sources FROM works WHERE id = 'isfdb:202'").get() as { sources: string };
    expect(JSON.parse(red.sources).map((s: { source: string }) => s.source)).toEqual(["isfdb", "openlibrary"]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM works WHERE id IN ('ol:OL1W', 'ol:OL2W')").get()).toEqual({ n: 0 });
    const meta = Object.fromEntries((db.prepare("SELECT key, value FROM meta").all() as Array<{ key: string; value: string }>).map((r) => [r.key, r.value]));
    expect(meta["openlibrary.crosswalkIsbn"]).toBe("1");
    expect(meta["openlibrary.crosswalkTitleAuthor"]).toBe("1");
    expect(meta["openlibrary.newWorks"]).toBe("4");
    expect(meta["openlibrary.newWorksShelf"]).toBe("2");
    expect(meta.sources).toBe("isfdb,openlibrary");
  });

  it("keeps Work and Edition apart, with provenance on every row", () => {
    const w = db.prepare("SELECT title, subtitle, authors, year, ttype, language, sources, edition_count FROM works WHERE id = 'ol:OL4W'").get() as Record<string, unknown>;
    expect(w).toMatchObject({ title: "Moonwalking with Einstein", subtitle: "The Art and Science of Remembering Everything", year: 2011, ttype: OL_TTYPE, language: "English", edition_count: 2 });
    expect(JSON.parse(w.authors as string)).toEqual(["Joshua Foer"]);
    const eds = db.prepare("SELECT edition_id, isbn13, source FROM editions WHERE work_id = 'ol:OL4W' ORDER BY edition_id").all();
    expect(eds).toEqual([
      { edition_id: "ol:OL401M", isbn13: "9781594202292", source: "openlibrary" },
      { edition_id: "ol:OL402M", isbn13: "9780143120537", source: "openlibrary" },
    ]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM editions WHERE source = 'isfdb' AND edition_id NOT LIKE 'isfdb-pub:%'").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM editions WHERE source = 'openlibrary' AND edition_id NOT LIKE 'ol:OL%M'").get()).toEqual({ n: 0 });
    // the French-only and pre-1960 works are not kept
    expect(db.prepare("SELECT COUNT(*) AS n FROM works WHERE id IN ('ol:OL3W', 'ol:OL5W')").get()).toEqual({ n: 0 });
  });

  it("retrieves Open Library works from OCR-like fragments, and ISFDB works as before", () => {
    expect(retrieve(db, ["MOONWALKING EINSTEIN FOER"], 3)[0]?.workId).toBe("ol:OL4W");
    expect(retrieve(db, ["GODEL ESCHER BACH HOFSTADTER"], 3)[0]?.workId).toBe("ol:OL8W");
    expect(retrieve(db, ["GIBS NEUROM"], 3)[0]?.workId).toBe("isfdb:201");
    expect(retrieve(db, ["IRMA ROMBAUER"], 3).map((c) => c.workId)).not.toContain("ol:OL3W");
  });

  it("keeps every Open Library publisher string and ISFDB's publisher series on editions (C-9)", () => {
    expect(db.prepare("SELECT publisher, publishers FROM editions WHERE edition_id = 'ol:OL401M'").get()).toEqual({ publisher: "Penguin Press", publishers: '["Penguin Press","Penguin Group"]' });
    expect(db.prepare("SELECT publisher, publishers FROM editions WHERE edition_id = 'ol:OL402M'").get()).toMatchObject({ publishers: null });
    expect(db.prepare("SELECT pub_series FROM editions WHERE edition_id = 'isfdb-pub:401'").get()).toEqual({ pub_series: "Ace Science Fiction Specials" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM editions WHERE pub_series IS NOT NULL").get()).toEqual({ n: 1 });
  });

  it("still merges a version 1 staging file (first publisher only)", () => {
    const old = join(dir, "ol-staging-v1.sqlite");
    const raw = new DatabaseSync(join(dir, "ol-staging.sqlite"));
    raw.exec(`VACUUM INTO '${old}'`);
    raw.close();
    const v1 = new DatabaseSync(old);
    v1.exec("ALTER TABLE ol_editions DROP COLUMN publishers; UPDATE meta SET value = '1' WHERE key = 'schema_version'; PRAGMA user_version = 1");
    v1.close();
    const out = join(dir, "catalog-v2-from-v1.sqlite");
    buildCatalog({ staging: join(dir, "isfdb-staging.sqlite"), openLibrary: old, out });
    const c = openCatalog(out);
    expect(c.prepare("SELECT publisher, publishers FROM editions WHERE edition_id = 'ol:OL401M'").get()).toEqual({ publisher: "Penguin Press", publishers: null });
    c.close();
  });

  it("writes schema version 3 and still opens version 1 files", () => {
    expect(CATALOG_SCHEMA_VERSION).toBe(3);
    const v1 = join(dir, "v1.sqlite");
    buildCatalog({ staging: join(dir, "isfdb-staging.sqlite"), out: v1 });
    const raw = new DatabaseSync(v1);
    raw.exec("PRAGMA user_version = 1");
    raw.close();
    expect(() => openCatalog(v1).close()).not.toThrow();
    const raw3 = new DatabaseSync(v1);
    raw3.exec("PRAGMA user_version = 4");
    raw3.close();
    expect(() => openCatalog(v1)).toThrow(/schema version 4/);
  });

  it("selects the catalog file from BOOKCASE_CATALOG, defaulting to catalog.sqlite", () => {
    const env = { BOOKCASE_DATA: "/data" };
    expect(catalogPaths(env).catalog).toBe("/data/catalog/catalog.sqlite");
    expect(catalogPaths({ ...env, BOOKCASE_CATALOG: "catalog-v2.sqlite" }).catalog).toBe("/data/catalog/catalog-v2.sqlite");
    expect(catalogPaths({ ...env, BOOKCASE_CATALOG: "/elsewhere/c.sqlite" }).catalog).toBe("/elsewhere/c.sqlite");
  });
});
