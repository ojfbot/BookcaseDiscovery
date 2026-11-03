import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCatalog } from "../src/catalog/build.ts";
import {
  drawSample,
  estimateCoverage,
  genreOf,
  isfdbHolds,
  keywordTokens,
  liveQueries,
  LiveCache,
  parseMods,
  parseOpenLibrary,
  qwenFields,
  readerTexts,
  resolveBox,
  resolves,
  stratumOf,
  surnameOf,
  titleInReading,
  type FetchLike,
  type OutsideRecord,
} from "../src/catalog/coverage.ts";
import type { Reading } from "../src/eval/f0.ts";
import { makeMiniStaging } from "./helpers/mini-staging.ts";

const dir = mkdtempSync(join(tmpdir(), "bookcase-c4-"));
let db: DatabaseSync;
beforeAll(() => {
  makeMiniStaging(join(dir, "staging.sqlite"));
  buildCatalog({ staging: join(dir, "staging.sqlite"), out: join(dir, "catalog.sqlite"), now: () => new Date("2026-11-03T00:00:00Z") });
  db = new DatabaseSync(join(dir, "catalog.sqlite"), { readOnly: true });
});
afterAll(() => {
  db?.close();
  rmSync(dir, { recursive: true, force: true });
});

const read = (reader: Reading["reader"], ...texts: string[]): Reading => ({
  id: "x",
  reader,
  variants: texts.map((text, i) => ({ rotation: i % 2 ? 270 : 90, text, confidence: 1 - i / 10 })),
  seconds: 0,
});
const rec = (over: Partial<OutsideRecord>): OutsideRecord => ({ source: "openlibrary", id: "/works/OL1W", title: "", subtitle: null, authors: [], isbns: [], subjects: [], year: null, ...over });
const neuromancer = rec({ title: "Neuromancer", authors: ["William Gibson"], isbns: ["0441569595"], subjects: ["Science fiction", "Cyberpunk"] });

const olBody = (docs: object[]) => JSON.stringify({ numFound: docs.length, docs });
const modsBody = `<?xml version="1.0"?><zs:searchRetrieveResponse xmlns:zs="http://www.loc.gov/zing/srw/"><zs:records><zs:record><zs:recordData>
<mods xmlns="http://www.loc.gov/mods/v3" version="3.8">
  <titleInfo><nonSort xml:space="preserve">The </nonSort><title>difference engine /</title></titleInfo>
  <titleInfo type="alternative"><title>Engine</title></titleInfo>
  <name type="personal"><namePart>Sterling, Bruce.</namePart></name>
  <name type="personal" usage="primary"><namePart>Gibson, William,</namePart><namePart type="date">1948-</namePart></name>
  <genre authority="gsafd">Science fiction.</genre>
  <originInfo><dateIssued>1991</dateIssued></originInfo>
  <subject><topic>Babbage, Charles</topic></subject>
  <identifier type="isbn">0553070282 :</identifier>
  <recordInfo><recordIdentifier>12345</recordIdentifier></recordInfo>
</mods></zs:recordData></zs:record></zs:records></zs:searchRetrieveResponse>`;

describe("sample", () => {
  const decisions = [
    ...Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, accepted: null, reason: "no-catalog-match" as const })),
    ...Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, accepted: null, reason: "single-reader" as const })),
    ...Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, accepted: null, reason: "no-text" as const })),
    ...Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, accepted: { workId: "isfdb:201" } as never, reason: null })),
  ];
  const sizes = { "no-catalog-match": 8, "single-reader": 4, "readers-disagree": 3, confirmed: 5 };

  it("strata leave no-text out", () => {
    expect(stratumOf({ accepted: null, reason: "no-text" })).toBeNull();
    expect(stratumOf({ accepted: { workId: "x" } as never, reason: null })).toBe("confirmed");
  });

  it("draws a seeded, stratified sample with a disjoint confirmed tuning set", () => {
    const a = drawSample(decisions, 7, sizes, 4);
    const b = drawSample([...decisions].reverse(), 7, sizes, 4);
    expect(a.boxes).toEqual(b.boxes); // file order does not matter
    expect(a.population).toEqual({ "no-catalog-match": 30, "single-reader": 10, "readers-disagree": 0, confirmed: 12 });
    const count = (role: string, s: string) => a.boxes.filter((x) => x.role === role && x.stratum === s).length;
    expect([count("sample", "no-catalog-match"), count("sample", "single-reader"), count("tuning", "confirmed"), count("sample", "confirmed")]).toEqual([8, 4, 4, 5]);
    expect(new Set(a.boxes.map((x) => x.id)).size).toBe(a.boxes.length);
    expect(a.boxes.some((x) => x.id.startsWith("t"))).toBe(false);
    expect(drawSample(decisions, 8, sizes, 4).boxes).not.toEqual(a.boxes);
  });
});

describe("queries", () => {
  it("orders readings Qwen first and drops duplicates", () => {
    const t = readerTexts({ vision: read("vision", "NEUROMANCER", "neuromancer", ""), qwen: read("qwen", "Neuromancer\nWilliam Gibson") });
    expect(t.map((x) => x.reader)).toEqual(["qwen", "vision"]);
  });

  it("reads Qwen's answer as title then author", () => {
    expect(qwenFields("Neuromancer\n\nWilliam Gibson")).toEqual({ title: "Neuromancer", author: "William Gibson" });
    expect(qwenFields("Neuromancer")).toEqual({ title: "Neuromancer", author: null });
  });

  it("keeps searchable tokens only", () => {
    expect(keywordTokens("THE NEUR0MANCER ~ by W. GIBSON 1984")).toEqual(["neur0mancer", "gibson"]);
  });

  it("tries fielded, then per line, then OR across the reading, capped per source", () => {
    const texts = readerTexts({ qwen: read("qwen", "Neuromancer\nWilliam Gibson"), vision: read("vision", "NEUROMANCER\nGIBSON XQZV") });
    const ol = liveQueries(texts, "openlibrary");
    expect(ol.map((q) => q.kind)).toEqual(["fielded", "line", "line", "line", "keywords", "keywords"]);
    expect(ol[0]!.url).toContain("title=neuromancer&author=william+gibson");
    expect(ol.at(-1)!.url).toContain("q=neuromancer+OR+gibson+OR+xqzv");
    expect(ol.every((q) => q.url.startsWith("https://openlibrary.org/search.json?"))).toBe(true);
    const loc = liveQueries(texts, "loc");
    expect(loc).toHaveLength(2);
    expect(decodeURIComponent(loc[0]!.url.replace(/\+/g, " "))).toContain('dc.title="neuromancer" and dc.creator="william gibson"');
  });
});

describe("records", () => {
  it("parses Open Library search docs", () => {
    const [r] = parseOpenLibrary(olBody([{ key: "/works/OL27258W", title: "Neuromancer", author_name: ["William Gibson"], isbn: ["0441569595"], subject: ["Cyberpunk"], first_publish_year: 1984 }]));
    expect(r).toEqual({ source: "openlibrary", id: "/works/OL27258W", title: "Neuromancer", subtitle: null, authors: ["William Gibson"], isbns: ["0441569595"], subjects: ["Cyberpunk"], year: 1984 });
  });

  it("parses LoC MODS: non-sort article, primary author first, ISBN, subjects", () => {
    const [r] = parseMods(modsBody);
    expect(r).toMatchObject({ source: "loc", id: "12345", title: "The difference engine", authors: ["Gibson, William", "Sterling, Bruce"], isbns: ["0553070282"], year: 1991 });
    expect(r!.subjects).toEqual(["Babbage, Charles", "Science fiction"]);
  });

  it("finds surnames, not organisations", () => {
    expect(surnameOf("Gibson, William,")).toBe("gibson");
    expect(surnameOf("Kim Stanley Robinson")).toBe("robinson");
    expect(surnameOf("Martin Luther King Jr.")).toBe("king");
    expect(surnameOf("Example Nursery and Seed Trade Catalog Collection")).toBeNull();
    expect(surnameOf("Fundación Example")).toBeNull();
  });

  it("splits SF from non-SF by subject, noisily", () => {
    expect(genreOf(neuromancer)).toBe("sf");
    expect(genreOf(rec({ subjects: ["Computer programming"] }))).toBe("non-sf");
    expect(genreOf(rec({}))).toBe("no-subjects");
  });
});

describe("resolution rule", () => {
  const texts = (...t: string[]) => t.map((text) => ({ reader: "vision" as const, text }));

  it("resolves through OCR damage when title and surname are both read", () => {
    expect(resolves(neuromancer, texts("NEUR0MANCER\nWILLIAM GIBS0N"))).toBe(true);
    expect(resolves(neuromancer, texts("NEUROMANCFR", "GIBSON"))).toBe(true); // title from one reader, author from another
  });

  it("needs the author", () => {
    expect(resolves(neuromancer, texts("NEUROMANCER"))).toBe(false);
  });

  it("does not let one word be both title and surname", () => {
    expect(resolves(rec({ title: "Gibson", authors: ["Gibson"] }), texts("GIBSON"))).toBe(false);
    expect(resolves(rec({ title: "Asimov's Mysteries", authors: ["Isaac Asimov"] }), texts("ASIMOV'S MYSTERIES ISAAC ASIMOV"))).toBe(true);
  });

  it("allows a truncated title (prefix of the record's), not a short or partial one", () => {
    expect(titleInReading(["mona", "lisa", "overdrive"], ["mona", "lisa"])).toBe(true);
    expect(titleInReading(["count", "zero"], ["count"])).toBe(false); // 5 letters, under the prefix minimum
    expect(titleInReading(["neuromancer", "trilogy"], ["trilogy"])).toBe(false); // not a prefix
    expect(titleInReading(["it"], ["it"])).toBe(false); // too short to identify
  });
});

describe("ISFDB check", () => {
  it("matches by ISBN first", () => {
    expect(isfdbHolds(db, neuromancer)).toEqual({ workId: "isfdb:201", how: "isbn" });
  });

  it("falls back to clean title plus author, ignoring a leading article", () => {
    expect(isfdbHolds(db, rec({ title: "The Neuromancer", authors: ["Gibson, William"] }))).toEqual({ workId: "isfdb:201", how: "title-author" });
  });

  it("needs the author to match too", () => {
    expect(isfdbHolds(db, rec({ title: "Neuromancer", authors: ["Another Writer"] }))).toBeNull();
    expect(isfdbHolds(db, rec({ title: "A Book Not In The Mini Catalog", authors: ["William Gibson"] }))).toBeNull();
  });
});

function mockFetch(routes: (url: string) => { status: number; body: string }) {
  const calls: { url: string; ua: string }[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, ua: init.headers["User-Agent"]! });
    const r = routes(url);
    return { status: r.status, text: async () => r.body };
  };
  return { f, calls };
}

describe("live cache", () => {
  it("rate-limits, caches, identifies the app without an email, and refuses calls offline", async () => {
    const cdir = mkdtempSync(join(dir, "cache-"));
    let clock = 0;
    const waits: number[] = [];
    const { f, calls } = mockFetch(() => ({ status: 200, body: olBody([]) }));
    const live = new LiveCache(cdir, { fetch: f, now: () => clock, sleep: async (ms) => { waits.push(ms); clock += ms; } });
    await live.get("openlibrary", "https://openlibrary.org/search.json?q=a");
    await live.get("openlibrary", "https://openlibrary.org/search.json?q=b");
    expect(waits).toEqual([1100]);
    expect(await live.get("openlibrary", "https://openlibrary.org/search.json?q=a")).toBe(olBody([]));
    expect(calls).toHaveLength(2);
    expect(calls[0]!.ua).toMatch(/^BookcaseDiscovery\//);
    expect(calls[0]!.ua).not.toMatch(/@/);
    expect(existsSync(live.path("openlibrary", "https://openlibrary.org/search.json?q=a"))).toBe(true);
    const offline = new LiveCache(cdir, { offline: true, fetch: f });
    expect(await offline.get("openlibrary", "https://openlibrary.org/search.json?q=a")).toBe(olBody([]));
    await expect(offline.get("openlibrary", "https://openlibrary.org/search.json?q=new")).rejects.toThrow(/offline/);
  });

  it("retries a 429 and gives up after three tries without caching", async () => {
    const cdir = mkdtempSync(join(dir, "cache-"));
    const { f, calls } = mockFetch(() => ({ status: 429, body: "" }));
    const live = new LiveCache(cdir, { fetch: f, sleep: async () => {} });
    expect(await live.get("loc", "http://lx2.loc.gov:210/LCDB?q")).toBeNull();
    expect(calls).toHaveLength(3);
    expect(live.errors.loc).toBe(1);
    expect(existsSync(live.path("loc", "http://lx2.loc.gov:210/LCDB?q"))).toBe(false);
  });
});

describe("one box", () => {
  const box = { id: "img:1", stratum: "no-catalog-match" as const, role: "sample" as const };

  it("resolves through Open Library and finds the book in ISFDB", async () => {
    const { f } = mockFetch((url) => ({ status: 200, body: url.includes("openlibrary") ? olBody([{ key: "/works/OL27258W", title: "Neuromancer", author_name: ["William Gibson"], isbn: ["9780441569595"] }]) : modsBody }));
    const live = new LiveCache(mkdtempSync(join(dir, "cache-")), { fetch: f, sleep: async () => {} });
    const r = await resolveBox(db, live, box, { vision: read("vision", "NEUROMANCER\nGIBSON") }, null);
    expect(r).toMatchObject({ cls: "in-isfdb", resolvedBy: "openlibrary", inOpenLibrary: true, isfdb: { workId: "isfdb:201", how: "isbn" }, genre: null });
  });

  it("falls back to LoC, then checks Open Library with the clean label", async () => {
    const { f, calls } = mockFetch((url) => ({ status: 200, body: url.includes("openlibrary") ? olBody([]) : modsBody }));
    const live = new LiveCache(mkdtempSync(join(dir, "cache-")), { fetch: f, sleep: async () => {} });
    const r = await resolveBox(db, live, box, { ppocr: read("ppocr", "DIFFERENCE ENGINE\nGIBSON STERLING") }, null);
    expect(r).toMatchObject({ cls: "not-in-isfdb", resolvedBy: "loc", inOpenLibrary: false, genre: "sf" });
    expect(calls.at(-1)!.url).toContain("title=difference+engine&author=gibson+william");
  });

  it("stays unresolved when nothing matches", async () => {
    const { f } = mockFetch((url) => ({ status: 200, body: url.includes("openlibrary") ? olBody([{ key: "/works/OL2W", title: "Count Zero", author_name: ["William Gibson"] }]) : modsBody }));
    const live = new LiveCache(mkdtempSync(join(dir, "cache-")), { fetch: f, sleep: async () => {} });
    const r = await resolveBox(db, live, box, { vision: read("vision", "XQZV WPLM") }, null);
    expect(r.cls).toBe("unresolved");
    expect(r.record).toBeNull();
  });
});

describe("estimates", () => {
  const row = (stratum: "no-catalog-match" | "single-reader" | "readers-disagree" | "confirmed", cls: "in-isfdb" | "not-in-isfdb" | "unresolved", inOpenLibrary = true) =>
    ({ stratum, cls, inOpenLibrary, genre: cls === "not-in-isfdb" ? ("non-sf" as const) : null });
  // no-catalog-match: 100 boxes, sampled 4 (weight 25); single-reader: 20, sampled 2 (10);
  // readers-disagree: 10, sampled 1 (10); confirmed: 40, sampled 2 (20).
  const rows = [
    row("no-catalog-match", "in-isfdb"), row("no-catalog-match", "not-in-isfdb"), row("no-catalog-match", "not-in-isfdb", false), row("no-catalog-match", "unresolved"),
    row("single-reader", "in-isfdb"), row("single-reader", "unresolved"),
    row("readers-disagree", "in-isfdb"),
    row("confirmed", "in-isfdb"), row("confirmed", "not-in-isfdb"),
  ];
  const population = { "no-catalog-match": 100, "single-reader": 20, "readers-disagree": 10, confirmed: 40 };

  it("weights every stratum back to its population", () => {
    const e = estimateCoverage(rows, population, 200, 1);
    // in ISFDB: 25 + 10 + 10 + 20 = 65; not: 50 + 20 = 70; unresolved: 25 + 10 = 35.
    expect(e.weighted).toEqual({ readableInIsfdb: 65, matchMiss: 45, readableNotInIsfdb: 70, notInIsfdbInOpenLibrary: 45, unresolved: 35 });
    expect(e.shares["isfdb.unresolvedExcluded"]!.value).toBeCloseTo(65 / 135, 4);
    expect(e.shares["isfdb.unresolvedAsNotInIsfdb"]!.value).toBeCloseTo(65 / 170, 4);
    expect(e.shares["isfdbOrOpenLibrary.unresolvedExcluded"]!.value).toBeCloseTo(110 / 135, 4);
    expect(e.shares["isfdbOrOpenLibraryOrLoc.unresolvedAsNotInIsfdb"]!.value).toBeCloseTo(135 / 170, 4);
    expect(e.shares["matchMiss.ofReadable"]!.value).toBeCloseTo(45 / 135, 4);
    expect(e.shares["no-catalog-match.notInIsfdb"]!.value).toBe(0.5);
    expect(e.shares["notInIsfdb.nonSf"]!.value).toBe(1);
    // Counting every confirmed box as in ISFDB: (45 + 40) / (85 + 50).
    expect(e.shares["confirmedWhole.isfdb.unresolvedExcluded"]!.value).toBeCloseTo(85 / 135, 4);
    expect(e.sample["no-catalog-match"]).toEqual({ population: 100, sampled: 4, counts: { "in-isfdb": 1, "not-in-isfdb": 2, unresolved: 1 } });
  });

  it("gives bootstrap intervals around the point estimate", () => {
    const i = estimateCoverage(rows, population, 500, 1).shares["isfdb.unresolvedExcluded"]!;
    expect(i.lo).toBeLessThanOrEqual(i.value);
    expect(i.hi).toBeGreaterThanOrEqual(i.value);
    expect(i.hi - i.lo).toBeGreaterThan(0);
  });
});
