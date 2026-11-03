// R-1: "read all of Gibson" becomes a `read` entry per Gibson novel in the catalog, marked expanded.
// The catalog here is a hand-built stand-in with only the tables `worksOfAuthor` reads; ids are invented.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { EXPANDED_TTYPES, expandProfile, worksOfAuthor } from "../src/recommend/expand.ts";
import { ProfileFileSchema, SEEDS_PATH, centreSeeds, checkProfileFile, mergeOverlay, publishProblems, readProfileFile } from "../src/recommend/profile.ts";
import { renderReviewSheet, REVIEW_QUESTIONS } from "../src/recommend/review.ts";

function catalog(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE works (id TEXT PRIMARY KEY, title TEXT NOT NULL, year INTEGER, authors TEXT NOT NULL, ttype TEXT NOT NULL);
    CREATE TABLE work_authors (work_id TEXT NOT NULL, author_id INTEGER NOT NULL, alias INTEGER NOT NULL);
    CREATE TABLE editions (edition_id TEXT, work_id TEXT NOT NULL, format TEXT);
  `);
  db.exec(`INSERT INTO authors VALUES (1, 'William Gibson'), (2, 'Kim Stanley Robinson'), (3, 'Neal Stephenson'), (4, 'Dup Name'), (5, 'Dup Name')`);
  const work = (id: number, title: string, year: number | null, ttype: string, authors: [string, number, number][], formats: (string | null)[]) => {
    db.prepare("INSERT INTO works VALUES (?, ?, ?, ?, ?)").run(`isfdb:${id}`, title, year, JSON.stringify(authors.map((a) => a[0])), ttype);
    for (const [, aid, alias] of authors) db.prepare("INSERT INTO work_authors VALUES (?, ?, ?)").run(`isfdb:${id}`, aid, alias);
    formats.forEach((f, i) => db.prepare("INSERT INTO editions VALUES (?, ?, ?)").run(`isfdb-pub:${id}${i}`, `isfdb:${id}`, f));
  };
  const G: [string, number, number] = ["William Gibson", 1, 0];
  work(10, "Later Novel", 2010, "NOVEL", [G], ["hc"]);
  work(11, "First Novel", 1984, "NOVEL", [G], ["pb", "digital audio download"]);
  work(12, "Co-written Novel", 1990, "NOVEL", [G, ["Bruce Sterling", 6, 0]], [null]);
  work(13, "Audio Only Novel", 2019, "NOVEL", [G], ["digital audio download", "audio CD"]);
  work(14, "A Collection", 1986, "COLLECTION", [G], ["pb"]);
  work(15, "An Omnibus", null, "OMNIBUS", [G], ["tp"]);
  work(16, "A Nonfiction Book", 2012, "NONFICTION", [G], ["hc"]);
  work(17, "Pseudonymous Variant Credit", 1999, "NOVEL", [["William Gibson", 1, 1], ["Someone Else", 7, 0]], ["pb"]);
  work(20, "Red Mars", 1992, "NOVEL", [["Kim Stanley Robinson", 2, 0]], ["pb"]);
  work(30, "Snow Crash", 1992, "NOVEL", [["Neal Stephenson", 3, 0]], ["pb"]);
  return db;
}

const seeds = () => mergeOverlay(readProfileFile(SEEDS_PATH), null);

describe("worksOfAuthor: what a novel is", () => {
  const db = catalog();

  it("is a NOVEL work credited to the author, with at least one edition that is not audio-only; newest last", () => {
    expect([...EXPANDED_TTYPES]).toEqual(["NOVEL"]);
    const r = worksOfAuthor(db, "William Gibson");
    expect(r.found).toBe(true);
    expect(r.novels.map((w) => w.title)).toEqual(["First Novel", "Co-written Novel", "Later Novel"]);
    expect(r.novels.find((w) => w.title === "Co-written Novel")?.authors).toEqual(["William Gibson", "Bruce Sterling"]);
  });

  it("reports what it left out, and why: collections, omnibuses and non-fiction are not novels; audio-only is not a book to have read", () => {
    const r = worksOfAuthor(db, "William Gibson");
    expect(r.excluded.map((x) => [x.title, x.ttype, x.reason])).toEqual([
      ["A Collection", "COLLECTION", "not-a-novel"],
      ["A Nonfiction Book", "NONFICTION", "not-a-novel"],
      ["Audio Only Novel", "NOVEL", "audio-only"],
      ["An Omnibus", "OMNIBUS", "not-a-novel"], // no year sorts last
    ]);
  });

  it("does not take a variant's alias credit for the author's own work", () => {
    expect(worksOfAuthor(db, "William Gibson").novels.some((w) => w.title === "Pseudonymous Variant Credit")).toBe(false);
  });

  it("an author the catalog lacks is not found; two authors by one name is a catalog fault", () => {
    expect(worksOfAuthor(db, "Nobody At All")).toEqual({ found: false, novels: [], excluded: [] });
    expect(() => worksOfAuthor(db, "Dup Name")).toThrow(/2 authors/);
  });
});

describe("expandProfile", () => {
  const db = catalog();

  it("makes one `read` entry per novel for the read-all seed, marked expanded and tied to the seed", () => {
    const { profile, reports } = expandProfile(seeds(), db);
    const expanded = profile.entries.filter((e) => e.expanded);
    expect(expanded.map((e) => e.subject.name)).toEqual(["First Novel", "Co-written Novel", "Later Novel"]);
    for (const e of expanded) {
      expect(e).toMatchObject({ relation: "read", scope: "one-work", expanded: true, expandedFrom: "seed-gibson-read", origin: "seeds" });
      expect(e.subject.kind).toBe("work");
      expect(e.subject.id).toMatch(/^isfdb:\d+$/);
      expect(e.provenance).toEqual(seeds().entries[0]!.provenance);
    }
    expect(reports.map((r) => [r.author, r.novels.length])).toEqual([["William Gibson", 3]]);
  });

  it("expands `read` only: a liked or cooler author stays at author level (no verdict on titles never rated)", () => {
    const { profile } = expandProfile(seeds(), db);
    const names = profile.entries.filter((e) => e.expanded).map((e) => e.subject.name);
    expect(names).not.toContain("Red Mars");
    expect(names).not.toContain("Snow Crash");
    expect(profile.entries.filter((e) => !e.expanded)).toHaveLength(seeds().entries.length);
  });

  it("is idempotent, and does not change what the centre sees", () => {
    const once = expandProfile(seeds(), db).profile;
    const twice = expandProfile(once, db).profile;
    expect(twice).toEqual(once);
    expect(centreSeeds(once)).toEqual(centreSeeds(seeds()));
  });

  it("drops stale expanded entries before generating, so a changed catalog is not additive", () => {
    const first = expandProfile(seeds(), db).profile;
    const smaller = new DatabaseSync(":memory:");
    smaller.exec(`CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT); CREATE TABLE works (id TEXT, title TEXT, year INTEGER, authors TEXT, ttype TEXT);
      CREATE TABLE work_authors (work_id TEXT, author_id INTEGER, alias INTEGER); CREATE TABLE editions (edition_id TEXT, work_id TEXT, format TEXT);`);
    expect(expandProfile(first, smaller).profile.entries.filter((e) => e.expanded)).toEqual([]);
  });

  it("an expanded profile is sound, but is never publishable: only the compact seed is public", () => {
    const { profile } = expandProfile(seeds(), db);
    const asFile = ProfileFileSchema.parse({ schemaVersion: 1, entries: profile.entries.map(({ origin, ...e }) => e), nodes: [] });
    expect(checkProfileFile(asFile)).toEqual([]);
    expect(publishProblems(asFile).join("\n")).toMatch(/generated at build time/);
    expect(publishProblems(readProfileFile(SEEDS_PATH))).toEqual([]);
  });

  it("a series seed is reported as not expanded rather than silently skipped", () => {
    const p = mergeOverlay({ schemaVersion: 1, nodes: [], entries: [{ id: "s", subject: { kind: "series", name: "Sprawl" }, relation: "read", scope: "all-works", provenance: { source: "owner-statement", ref: "t", date: "2026-01-01" } }] }, null);
    expect(expandProfile(p, db).reports[0]!.skipped).toMatch(/not supported/);
  });
});

describe("the O-4 review sheet", () => {
  const { profile, reports } = expandProfile(seeds(), catalog());
  const html = renderReviewSheet(profile, reports, new Date("2026-11-02T12:00:00Z"));
  const text = html.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  it("asks R-0's two questions as plain yes/no items, and no others", () => {
    expect(REVIEW_QUESTIONS).toHaveLength(2);
    expect(text).toContain("Does reading all of William Gibson also mean you liked him?");
    expect(text).toContain("Should a book by an author you like show up at the default setting");
    expect(html.match(/type="radio"/g)).toHaveLength(4);
    expect(html.match(/value="yes"/g)).toHaveLength(2);
    expect(html.match(/value="no"/g)).toHaveLength(2);
  });

  it("is short and calm: a few minutes, nothing to type", () => {
    expect(text.split(" ").length).toBeLessThan(450);
    expect(html).toContain("About two minutes");
    expect(html).not.toMatch(/<input[^>]*type="(text|password|email)"/);
  });

  it("says what the public seeds say, and counts the novels it expanded", () => {
    expect(text).toContain("Read all of William Gibson. I count 3 novels in the catalog.");
    expect(text).toContain("Liked Kim Stanley Robinson.");
    expect(text).toContain("Cooler on Neal Stephenson.");
    expect(text).toContain("Audio Only Novel (audio only)");
  });

  it("is one self-contained file: no network, no remote assets", () => {
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<(link|img|iframe)\b/);
    expect(html).not.toMatch(/src=/);
  });

  it("escapes catalog text", () => {
    const evil = { ...profile, entries: profile.entries.map((e) => (e.subject.name === "First Novel" ? { ...e, subject: { ...e.subject, name: "<script>alert(1)</script>" } } : e)) };
    const r = reports.map((x) => ({ ...x, novels: x.novels.map((w) => (w.title === "First Novel" ? { ...w, title: "<script>alert(1)</script>" } : w)) }));
    expect(renderReviewSheet(evil, r)).not.toContain("<script>alert(1)");
  });
});
