import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCatalog, WORK_TTYPES } from "../src/catalog/build.ts";
import { catalogCommand } from "../src/catalog/cli.ts";
import { retrieve, scoreWorks } from "../src/catalog/retrieve.ts";
import { targetWorks } from "../src/catalog/golden.ts";
import { makeMiniStaging } from "./helpers/mini-staging.ts";

const dir = mkdtempSync(join(tmpdir(), "bookcase-catalog-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const staging = join(dir, "staging.sqlite");
const out = join(dir, "catalog.sqlite");
let db: DatabaseSync;
let built: ReturnType<typeof buildCatalog>;

beforeAll(() => {
  makeMiniStaging(staging);
  built = buildCatalog({ staging, out, now: () => new Date("2026-11-02T00:00:00Z") });
  db = new DatabaseSync(out, { readOnly: true });
});
afterAll(() => db?.close());

const top = (variants: string[], k = 5) => retrieve(db, variants, k);

describe("buildCatalog", () => {
  it("keeps book-level root titles that have an edition, and nothing else", () => {
    expect(built.counts.works).toBe(8);
    const ids = (db.prepare("SELECT id FROM works ORDER BY id").all() as Array<{ id: string }>).map((r) => r.id);
    // Out: 204/210/211 are variants of kept roots, 207 is SHORTFICTION, 208 COVERART, 212 has no edition.
    expect(ids).toEqual(["isfdb:201", "isfdb:202", "isfdb:203", "isfdb:205", "isfdb:206", "isfdb:209", "isfdb:213", "isfdb:214"]);
    expect(db.prepare("SELECT year FROM works WHERE id = 'isfdb:214'").get()).toEqual({ year: null }); // 0000-00-00 is unknown
    expect(WORK_TTYPES).not.toContain("SHORTFICTION");
  });

  it("records the work, its editions, series chain, tags and sources", () => {
    const w = db.prepare("SELECT * FROM works WHERE id = 'isfdb:201'").get() as Record<string, unknown>;
    expect(w).toMatchObject({ title: "Neuromancer", subtitle: null, authors: '["William Gibson"]', series: "Sprawl", series_num: "1", year: 1984, ttype: "NOVEL", language: "English", edition_count: 2 });
    expect(JSON.parse(w.tags as string)).toEqual(["cyberpunk"]);
    expect(JSON.parse(w.sources as string)).toEqual([{ source: "isfdb", id: 201, dump: "2026-10-31" }]);
    const eds = db.prepare("SELECT edition_id, isbn13, isbn, publisher, year, format FROM editions WHERE work_id = 'isfdb:201' ORDER BY edition_id").all();
    expect(eds).toEqual([
      { edition_id: "isfdb-pub:401", isbn13: "9780441569595", isbn: "0441569595", publisher: "Ace", year: 1984, format: "pb" },
      { edition_id: "isfdb-pub:402", isbn13: "9780441569594", isbn: "978-0-441-56959-4", publisher: "Penguin", year: 2000, format: "tp" },
    ]);
    const chain = db.prepare("SELECT series_id, depth FROM work_series WHERE work_id = 'isfdb:201' ORDER BY depth").all();
    expect(chain).toEqual([{ series_id: 301, depth: 0 }, { series_id: 303, depth: 1 }]);
  });

  it("splits a subtitle off the title and keeps the whole as a form", () => {
    const w = db.prepare("SELECT title, subtitle FROM works WHERE id = 'isfdb:205'").get();
    expect(w).toEqual({ title: "The Fellowship of the Ring", subtitle: "Being the First Part of The Lord of the Rings" });
  });

  it("folds variants in as alias titles and alias authors, decoding entities", () => {
    const w = db.prepare("SELECT title_norm, author_norm FROM works WHERE id = 'isfdb:203'").get() as { title_norm: string; author_norm: string };
    expect(w.title_norm.split("|")).toEqual(expect.arrayContaining(["T:solaris", "V:солярис"]));
    expect(w.author_norm.split("|")).toEqual(expect.arrayContaining(["stanislaw lem", "станислав лем"]));
    // a pseudonym's variant: Philip K. Dick's alternate title is searchable on his own work
    const d = db.prepare("SELECT title_norm FROM works WHERE id = 'isfdb:209'").get() as { title_norm: string };
    expect(d.title_norm).toContain("V:blade runner");
  });

  it("uses only ca_status 1 for authors", () => {
    expect(db.prepare("SELECT authors FROM works WHERE id = 'isfdb:206'").get()).toEqual({ authors: '["Richard Bachman"]' });
  });

  it("records provenance in meta and refuses a missing staging file", () => {
    const meta = Object.fromEntries((db.prepare("SELECT key, value FROM meta").all() as Array<{ key: string; value: string }>).map((r) => [r.key, r.value]));
    expect(meta).toMatchObject({ schema_version: "2", staging_content_hash: "test-hash", staging_dump_date: "2026-10-31", "rows.works": "8" });
    expect(() => buildCatalog({ staging: join(dir, "nope.sqlite"), out: join(dir, "x.sqlite") })).toThrow(/not found/);
  });
});

describe("retrieve", () => {
  it("finds a title and author from truncated fragments: GIBS NEUROM", () => {
    const r = top(["GIBS NEUROM"]);
    expect(r[0]!.workId).toBe("isfdb:201");
    const byField = Object.fromEntries(r[0]!.evidence.map((e) => [e.field, e]));
    expect(byField.title!.matches[0]).toMatchObject({ query: "neurom", how: "prefix" });
    expect(byField.author!.matches[0]).toMatchObject({ query: "gibs", field: "gibson", how: "prefix" });
  });

  it("reads 0 as O, split words, and rn as m", () => {
    expect(top(["NEUR0MANCER GIBSON"])[0]!.workId).toBe("isfdb:201");
    expect(top(["NEURO MANCER"])[0]!.workId).toBe("isfdb:201");
    expect(top(["NEUROrnANCER"])[0]!.workId).toBe("isfdb:201");
  });

  it("matches author names whatever the order, the punctuation and the initials", () => {
    expect(top(["TOLKIEN, J.R.R. FELLOWSHIP OF THE RING"])[0]!.workId).toBe("isfdb:205");
    expect(top(["JRR TOLKIEN FELLOWSHIP"])[0]!.workId).toBe("isfdb:205");
    expect(top(["J. R. R. TOLKIEN"])[0]!.workId).toBe("isfdb:205");
  });

  it("matches without diacritics, and by legal name or pseudonym on the same work", () => {
    expect(top(["STANISLAW LEM"])[0]!.workId).toBe("isfdb:203");
    expect(top(["Gibson, William Ford GIBSON NEUROMANCER"])[0]!.workId).toBe("isfdb:201");
    expect(top(["RICHARD BACHMAN THE RUNNING MAN"])[0]!.workId).toBe("isfdb:206");
  });

  it("finds a work by a variant title, with the evidence naming the form", () => {
    const r = top(["BLADE RUNNER PHILIP K DICK"]);
    expect(r[0]!.workId).toBe("isfdb:209");
    expect(r[0]!.evidence.find((e) => e.field === "title")!.formKind).toBe("variant");
    expect(top(["СОЛЯРИС"])[0]!.workId).toBe("isfdb:203");
  });

  it("finds a work by its subtitle alone, scoring it below the whole title", () => {
    const sub = top(["BEING THE FIRST PART OF THE LORD OF THE RINGS"])[0]!;
    expect(sub.workId).toBe("isfdb:205");
    expect(sub.evidence.find((e) => e.field === "title")!.formKind).toBe("subtitle");
  });

  it("finds works by series when the series is larger than the title", () => {
    const r = top(["SPRAWL TRILOGY COUNT ZERO"]);
    expect(r[0]!.workId).toBe("isfdb:213");
    expect(r.map((c) => c.workId)).toContain("isfdb:201");
    expect(r[0]!.evidence.map((e) => e.field)).toContain("series");
    // the parent series is searchable too
    expect(top(["CYBERPUNK COLLECTION"]).map((c) => c.workId)).toEqual(expect.arrayContaining(["isfdb:201", "isfdb:213"]));
  });

  it("takes several variants and returns each work once, with the best variant's index", () => {
    const r = top(["GARBAGE TEXT QQQ", "NEUROMANCER GIBSON", "NEUROMANCER"], 10);
    expect(r.filter((c) => c.workId === "isfdb:201")).toHaveLength(1);
    expect(r[0]!.workId).toBe("isfdb:201");
    expect(r[0]!.variant).toBe(1);
  });

  it("returns nothing for text the catalog cannot read, empty input, and one-letter noise", () => {
    expect(top(["QQQQQ ZZZZZ"])).toEqual([]);
    expect(top([""])).toEqual([]);
    expect(top([])).toEqual([]);
    expect(top(["!!! ---"])).toEqual([]);
  });

  it("never invents a perfect match: a half-matching title scores under the exact one", () => {
    const r = top(["RED MARS KIM STANLEY ROBINSON"]);
    expect(r[0]!.score).toBeGreaterThan(0.9);
    const partial = top(["RED PLANET"]);
    expect(partial[0]!.score).toBeLessThan(r[0]!.score);
  });

  it("is deterministic and respects k", () => {
    expect(JSON.stringify(top(["NEUROMANCER"], 3))).toBe(JSON.stringify(top(["NEUROMANCER"], 3)));
    expect(top(["GIBSON"], 2)).toHaveLength(2);
  });

  it("looks up golden targets by exact normalised title and author, not by retrieval", () => {
    expect([...targetWorks(db, { title: "Neuromancer", author: "William Gibson" })]).toEqual(["isfdb:201"]);
    expect(targetWorks(db, { title: "Neuromancer", author: "Kim Stanley Robinson" }).size).toBe(0);
  });
});

describe("bookcase catalog", () => {
  it("query prints candidates with evidence; a missing catalog is an error", () => {
    const logs: string[] = [];
    const orig = console.log;
    console.log = (s: unknown) => void logs.push(String(s));
    try {
      expect(catalogCommand(["query", "GIBS NEUROM", "--db", out])).toBe(0);
      expect(catalogCommand(["query", "GIBS NEUROM", "--json", "--db", out])).toBe(0);
    } finally {
      console.log = orig;
    }
    expect(logs[0]).toContain("Neuromancer — William Gibson");
    expect(logs[0]).toContain("author");
    expect(JSON.parse(logs[1]!)[0].workId).toBe("isfdb:201");
    const err = console.error;
    console.error = () => {};
    try {
      expect(catalogCommand(["query", "x", "--db", join(dir, "missing.sqlite")])).toBe(1);
    } finally {
      console.error = err;
    }
  });
});

describe("scoreWorks", () => {
  it("scores a named work as retrieval would, and a work the text does not explain at 0", () => {
    const variants = ["NEUROMANCER WILLIAM GIBSON"];
    const [best] = retrieve(db, variants, 1);
    const scored = scoreWorks(db, variants, [best!.workId, "isfdb:214", "isfdb:missing"]);
    expect(scored.get(best!.workId)).toMatchObject({ score: best!.score, queryCoverage: best!.queryCoverage });
    expect(scored.get("isfdb:214")!.score).toBeLessThan(best!.score);
    expect(scored.has("isfdb:missing")).toBe(false);
    expect(scoreWorks(db, [], ["isfdb:201"]).get("isfdb:201")).toMatchObject({ score: 0, evidence: [] });
  });
});
