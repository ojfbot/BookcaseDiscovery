// C-7: the statistics sidecar, rarity-weighted evidence and counter-evidence (src/catalog/rarity.ts), its place in
// F-0's decision, and the evaluation's cached path (src/catalog/c7-eval.ts). Every title and name here is invented.
import { mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCatalog } from "../src/catalog/build.ts";
import { blocks, C7_ARMS, decideFromC7Facts, leaveOneReaderOut, type C7Facts } from "../src/catalog/c7-eval.ts";
import { createSchema } from "../src/catalog/isfdb-staging.ts";
import { lookalikeGuard, LOOKALIKE } from "../src/catalog/lookalike.ts";
import {
  buildStats, counterEvidence, counterWhy, countsAgainst, exclusiveWords, openStats, primarySurname, RARITY, rarityBasis, rarityEvidence, readingLanguage, statsPathFor,
  type CatalogStats, type RarityBasis, type RarityEvidence,
} from "../src/catalog/rarity.ts";
import { retrieve, type Candidate, type FieldEvidence, type TokenMatch } from "../src/catalog/retrieve.ts";
import { decide, vote, type Reading } from "../src/eval/f0.ts";

/** A tiny invented ISFDB staging file: a rare title, a title three books share equally, one a single book dominates. */
function makeStaging(path: string): void {
  const db = new DatabaseSync(path);
  createSchema(db);
  const ins = (table: string, rows: Array<Array<string | number | null>>) => {
    const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
    const st = db.prepare(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`);
    for (const r of rows) st.run(...r);
  };
  for (const [k, v] of [["schema_version", "1"], ["content_hash", "c7-test"], ["dump_date", "2026-10-31"]]) db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(k, v);
  ins("languages", [[17, "English", "eng"], [22, "Spanish", "spa"]]);
  ins("publishers", [[501, "Corvid Press"], [502, "Quaymark Books"]]);
  ins("authors", [
    [101, "Odile Varnek", null, "Varnek", 17],
    [102, "Tamsin Okoro", null, "Okoro", 17],
    [103, "Ivo Brannick", null, "Brannick", 17],
    [104, "Pell Dunmore", null, "Dunmore", 17],
    [105, "Brisk Taller", null, "Taller", 17],
  ]);
  ins("titles", [
    [201, "Quillmarsh", 0, 0, null, "1990-00-00", "NOVEL", 0, 17, "No", "No"],
    [202, "Harbor", 0, 0, null, "1991-00-00", "NOVEL", 0, 17, "No", "No"],
    [203, "Harbor", 0, 0, null, "1992-00-00", "NOVEL", 0, 17, "No", "No"],
    [204, "Harbor", 0, 0, null, "1993-00-00", "NONFICTION", 0, 17, "No", "No"],
    [205, "Lanternfall", 0, 0, null, "1994-00-00", "NOVEL", 0, 17, "No", "No"],
    [206, "Lanternfall", 0, 0, null, "1995-00-00", "NOVEL", 0, 17, "No", "No"],
    [207, "Brannick Varnek Okoro Dunmore", 0, 0, null, "1996-00-00", "ANTHOLOGY", 0, 17, "No", "No"],
  ]);
  ins("canonical_author", [[1, 201, 101, 1], [2, 202, 102, 1], [3, 203, 103, 1], [4, 204, 104, 1], [5, 205, 101, 1], [6, 206, 105, 1], [7, 207, 105, 1]]);
  const pubs: Array<Array<string | number | null>> = [];
  const content: Array<Array<string | number | null>> = [];
  let pid = 400;
  // Editions per title: the dominant "Lanternfall" has five, its namesake one; "Harbor"'s three books one each.
  for (const [title, n] of [[201, 2], [202, 1], [203, 1], [204, 1], [205, 5], [206, 1], [207, 1]] as const) {
    for (let i = 0; i < n; i++) {
      pid++;
      pubs.push([pid, "x", `T${pid}`, "2000-00-00", 501, "200", "pb", "NOVEL", null, 0, null, null, null]);
      content.push([pid, title, pid, "1"]);
    }
  }
  ins("pubs", pubs);
  ins("pub_content", content);
  db.close();
}

const ev = (field: FieldEvidence["field"], score: number, form: string, queries: string[], formKind?: string): FieldEvidence => ({
  field, score, form, ...(formKind ? { formKind } : {}), matches: queries.map((q): TokenMatch => ({ query: q, field: q, how: "exact", score: 1 })),
});
const cand = (workId: string, authors: string[], evidence: FieldEvidence[], editionCount = 1): Candidate => ({
  workId, title: "x", subtitle: null, authors, series: null, seriesNum: null, year: null, ttype: "NOVEL", editionCount, score: 0.9, queryCoverage: 1, variant: 0, evidence,
});

/** A stub sidecar: title form -> books (surname -> editions); word -> [works, publisher works]. */
function stubBasis(titles: Record<string, Record<string, number>>, words: Record<string, [number, number]> = {}, languages: Record<string, string> = {}): RarityBasis {
  const stats: CatalogStats = {
    works: 1000,
    books: 1000,
    title: (n) => {
      const b = titles[n] ?? {};
      return { works: Object.keys(b).length, books: Object.keys(b).length, editions: Object.values(b).reduce((s, x) => s + x, 0) };
    },
    bookEditions: (n, s) => titles[n]?.[s] ?? 0,
    word: (t) => ({ works: words[t]?.[0] ?? 0, pubWorks: words[t]?.[1] ?? 0 }),
    authorWorks: () => 1,
    close: () => {},
  };
  return { stats, language: (id) => languages[id] ?? null, forms: () => new Set() };
}

describe("statistics sidecar", () => {
  const dir = mkdtempSync(join(tmpdir(), "bookcase-c7-"));
  const catalog = join(dir, "catalog.sqlite");
  let stats: CatalogStats;
  beforeAll(() => {
    makeStaging(join(dir, "staging.sqlite"));
    buildCatalog({ staging: join(dir, "staging.sqlite"), out: catalog, now: () => new Date("2026-11-03T00:00:00Z") });
    buildStats(catalog);
    stats = openStats(statsPathFor(catalog), catalog);
  });
  afterAll(() => {
    stats?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("sits beside the catalog under its own name", () => {
    expect(statsPathFor("/x/catalog-v2.sqlite")).toBe("/x/catalog-v2.stats.sqlite");
    expect(statsPathFor("/x/catalog.sqlite")).toBe("/x/catalog.stats.sqlite");
  });

  it("counts works, books and editions per title form, duplicates of one book together", () => {
    expect(stats.works).toBe(7);
    expect(stats.title("harbor")).toEqual({ works: 3, books: 3, editions: 3 });
    expect(stats.title("lanternfall")).toEqual({ works: 2, books: 2, editions: 6 });
    expect(stats.bookEditions("lanternfall", "varnek")).toBe(5);
    expect(stats.bookEditions("lanternfall", "okoro")).toBe(0);
    expect(stats.title("nothing")).toEqual({ works: 0, books: 0, editions: 0 });
  });

  it("counts a word's works in titles, authors and series, and its works in publisher strings", () => {
    expect(stats.word("varnek")).toEqual({ works: 3, pubWorks: 0 }); // two by the author, one anthology title
    expect(stats.word("corvid")).toEqual({ works: 0, pubWorks: 7 });
    expect(stats.authorWorks("odile varnek")).toBe(2);
  });

  it("refuses a sidecar built from another state of the catalog, but not from a touched one (DL-1)", () => {
    const later = new Date(Date.now() + 60_000);
    utimesSync(catalog, later, later);
    expect(() => openStats(statsPathFor(catalog), catalog).close()).not.toThrow();
    const db = new DatabaseSync(catalog);
    const was = (db.prepare("SELECT value FROM meta WHERE key = 'content_sha256'").get() as { value: string }).value;
    db.prepare("UPDATE meta SET value = ? WHERE key = 'content_sha256'").run("0".repeat(64));
    db.close();
    expect(() => openStats(statsPathFor(catalog), catalog)).toThrow(/another state/);
    const back = new DatabaseSync(catalog);
    back.prepare("UPDATE meta SET value = ? WHERE key = 'content_sha256'").run(was);
    back.close();
  });

  it("decide with the basis withdraws a shared bare title and keeps a rare one; the cached path agrees", () => {
    buildStats(catalog);
    const db = new DatabaseSync(catalog, { readOnly: true });
    const basis = rarityBasis(db, openStats(statsPathFor(catalog), catalog));
    const read = (reader: Reading["reader"], text: string): Reading => ({ id: "x", reader, variants: [{ rotation: 90, text, confidence: 0.9 }], seconds: 0 });
    const run = (texts: Record<string, string>, on: boolean) =>
      decide(db, "img:0", "img", 0.4, Object.fromEntries(Object.entries(texts).map(([r, t]) => [r, read(r as Reading["reader"], t)])), new Map(),
        on ? { guard: lookalikeGuard(db, []), ranked: new Map(), rarity: { basis, kinds: new Set(["namesake", "unexplained", "author", "language"]) } } : undefined);
    const cases: Array<Record<string, string>> = [
      { vision: "QUILLMARSH", ppocr: "Quillmarsh" },
      { vision: "HARBOR", ppocr: "Harbor" },
      { vision: "HARBOR TAMSIN OKORO", ppocr: "Harbor Okoro" },
      { vision: "LANTERNFALL", ppocr: "LANTERNFALL" },
    ];
    expect(run(cases[0]!, true).accepted?.workId).toBe(run(cases[0]!, false).accepted?.workId);
    const shared = run(cases[1]!, true);
    expect(run(cases[1]!, false).accepted).not.toBeNull();
    expect(shared.accepted).toBeNull();
    expect(shared.counter).toEqual({ vision: "namesake", ppocr: "namesake" });
    expect(run(cases[2]!, true).accepted).not.toBeNull(); // a surname read pins the book
    expect(run(cases[3]!, true).accepted).not.toBeNull(); // the dominant book of its title
    expect(run(cases[0]!, false).counter).toBeUndefined();
    // The evaluation's cached re-decision gives the same accept and reason.
    for (const texts of cases) {
      const facts = new Map<string, C7Facts>(Object.values(texts).map((t) => {
        const ranked = retrieve(db, [t], LOOKALIKE.depth);
        const top = ranked[0]!;
        const conf = top.score >= 0.72 && (top.evidence.find((e) => e.field === "title")?.score ?? 0) >= 0.8 && top.queryCoverage >= 0.5;
        return [t, { top: top.workId, conf, block: { margin: false, author: false, short: false }, margin: null, author: 0, words: 0, holders: null, ms: 0, rarity: conf ? rarityEvidence(basis, top, ranked, [t]) : null }];
      }));
      const cached = vote(decideFromC7Facts(Object.fromEntries(Object.entries(texts).map(([r, t]) => [r, { variants: [t] }])), facts, C7_ARMS.c7!).votes);
      const live = run(texts, true);
      expect(cached.acceptedId).toBe(live.accepted?.workId ?? null);
      expect(cached.reason).toBe(live.reason);
    }
    basis.stats.close();
    db.close();
  });
});

describe("namesake share", () => {
  const harbor = { harbor: { okoro: 1, brannick: 1, dunmore: 1 } };
  it("a title three books share equally does not pick one; a read surname or series does", () => {
    const b = stubBasis(harbor);
    const bare = rarityEvidence(b, cand("w", ["Tamsin Okoro"], [ev("title", 1, "harbor", ["harbor"])]), [], ["HARBOR"]);
    expect(bare.share).toBeCloseTo(1 / 3, 3);
    expect(counterEvidence(bare).namesake).toBe(true);
    const named = rarityEvidence(b, cand("w", ["Tamsin Okoro"], [ev("title", 1, "harbor", ["harbor"]), ev("author", RARITY.secondAuthor, "tamsin okoro", ["okoro"])]), [], ["HARBOR OKORO"]);
    expect(counterEvidence(named).namesake).toBe(false);
    const series = rarityEvidence(b, cand("w", ["Tamsin Okoro"], [ev("title", 1, "harbor", ["harbor"]), ev("series", RARITY.secondSeries, "tides", ["tides"])]), [], ["HARBOR TIDES"]);
    expect(counterEvidence(series).namesake).toBe(false);
  });

  it("passes only strictly above the share: a dominant book passes, two equal books do not", () => {
    const dominant = rarityEvidence(stubBasis({ lanternfall: { varnek: 5, taller: 1 } }), cand("w", ["Odile Varnek"], [ev("title", 1, "lanternfall", ["lanternfall"])]), [], ["LANTERNFALL"]);
    expect(dominant.share).toBeCloseTo(5 / 6, 3);
    expect(counterEvidence(dominant).namesake).toBe(false);
    const tie = rarityEvidence(stubBasis({ lanternfall: { varnek: 2, taller: 2 } }), cand("w", ["Odile Varnek"], [ev("title", 1, "lanternfall", ["lanternfall"])]), [], ["LANTERNFALL"]);
    expect(tie.share).toBe(RARITY.shareMin);
    expect(counterEvidence(tie).namesake).toBe(true);
  });

  it("a rare title alone passes, with its rarity in bits", () => {
    const e = rarityEvidence(stubBasis({ quillmarsh: { varnek: 2 } }), cand("w", ["Odile Varnek"], [ev("title", 1, "quillmarsh", ["quillmarsh"])], 2), [], ["QUILLMARSH"]);
    expect(e.share).toBe(1);
    expect(e.titleBits).toBeCloseTo(Math.log2(1000), 3);
    expect(counterWhy(e)).toBeNull();
  });

  it("a match on a subtitle-only form pins nothing", () => {
    const e = rarityEvidence(stubBasis({ "a novel of tides": { other: 3 } }), cand("w", ["Odile Varnek"], [ev("title", 0.85, "a novel of tides", ["novel", "tides"], "subtitle")], 4), [], ["A NOVEL OF TIDES"]);
    expect(e.bookEditions).toBe(0);
    expect(counterEvidence(e).namesake).toBe(true);
  });

  it("keys a book by its primary author's surname", () => {
    expect(primarySurname(["Odile Varnek", "Brisk Taller"])).toBe("varnek");
    expect(primarySurname([])).toBe("");
  });
});

describe("unexplained read words", () => {
  const titles = { harbor: { okoro: 5, brannick: 1, dunmore: 1, a: 1, b: 1 } };
  const c = cand("w", ["Tamsin Okoro"], [ev("title", 1, "harbor", ["harbor"]), ev("author", 1, "tamsin okoro", ["tamsin", "okoro"])]);
  it("a real word rarer than the matched title, left unexplained, counts against it", () => {
    const e = rarityEvidence(stubBasis(titles, { zephyrine: [3, 0] }), c, [], ["HARBOR TAMSIN OKORO ZEPHYRINE"]);
    expect(e.rarestUnexplained).toBe(3);
    expect(counterEvidence(e).unexplained).toBe(true); // 3 works carry it, 5 carry the title form
  });

  it("a word as common as the title, an imprint word, a short, numeric, once-seen or explained word does not", () => {
    const words: Record<string, [number, number]> = { lighthouse: [5, 0], corvid: [3, 40], zephyrine: [1, 0], okoro: [2, 0] };
    const b = stubBasis(titles, words);
    for (const text of ["HARBOR LIGHTHOUSE", "HARBOR CORVID", "HARBOR ZEPHYRINE", "HARBOR 1999", "HARBOR ABC", "HARBOR OKORO"]) {
      expect(counterEvidence(rarityEvidence(b, c, [], [text])).unexplained, text).toBe(false);
    }
    expect(countsAgainst("corvid", b.stats)).toBe(false);
    expect(countsAgainst("lighthouse", b.stats)).toBe(true);
  });

  it("never fires against a title only one work holds", () => {
    const e = rarityEvidence(stubBasis({ quillmarsh: { varnek: 1 } }, { zephyrine: [2, 0] }), cand("w", ["Odile Varnek"], [ev("title", 1, "quillmarsh", ["quillmarsh"])]), [], ["QUILLMARSH ZEPHYRINE"]);
    expect(counterEvidence(e).unexplained).toBe(false);
  });
});

describe("rival author", () => {
  const titles = { lanternfall: { varnek: 5, taller: 1 } };
  const c = cand("w", ["Odile Varnek"], [ev("title", 1, "lanternfall", ["lanternfall"])], 5);
  const rival = (name: string, queries: string[], score = 0.7) => cand("r", [name], [ev("author", score, name.toLowerCase(), queries)]);
  it("a surname read for another book's author, from words the candidate leaves unexplained, counts against it", () => {
    const e = rarityEvidence(stubBasis(titles, { brannick: [4, 0] }), c, [c, rival("Ivo Brannick", ["brannick"])], ["LANTERNFALL BRANNICK"]);
    expect(e.rivalAuthor).toBe(true);
    expect(counterWhy(e)).toBe("author");
  });

  it("not when the candidate's own author was read, the rival's name is only an imprint word, it is weak, or it is the same book", () => {
    const b = stubBasis(titles, { brannick: [4, 0], corvid: [1, 50] });
    const named = cand("w", ["Odile Varnek"], [ev("title", 1, "lanternfall", ["lanternfall"]), ev("author", 0.7, "odile varnek", ["varnek"])], 5);
    expect(rarityEvidence(b, named, [named, rival("Ivo Brannick", ["brannick"])], ["LANTERNFALL VARNEK BRANNICK"]).rivalAuthor).toBe(false);
    expect(rarityEvidence(b, c, [c, rival("Corvid", ["corvid"], 1)], ["LANTERNFALL CORVID"]).rivalAuthor).toBe(false);
    expect(rarityEvidence(b, c, [c, rival("Ivo Brannick", ["brannick"], 0.3)], ["LANTERNFALL BRANNICK"]).rivalAuthor).toBe(false);
    const dup = { ...cand("d", ["Odile Varnek"], [ev("author", 0.7, "odile varnek", ["brannick"])]), title: "x" };
    expect(rarityEvidence(b, { ...c, title: "x" }, [c, dup], ["LANTERNFALL BRANNICK"]).rivalAuthor).toBe(false);
  });
});

describe("reading language", () => {
  it("uses only function words exclusive to one language", () => {
    const ex = exclusiveWords();
    expect(ex.get("los")).toBe("Spanish");
    expect(ex.has("del")).toBe(false); // Spanish, Catalan and Italian
    expect(readingLanguage(["harbor", "los", "mares"])).toBe("Spanish");
    expect(readingLanguage(["the", "harbor", "los"])).toBeNull(); // mixed
    expect(readingLanguage(["los", "harbor"], new Set(["los"]))).toBeNull(); // the title explains it
  });

  it("a reading in another language counts against an English work's own title, not a variant title", () => {
    const b = stubBasis({ harbor: { okoro: 5 } }, {}, { w: "English", s: "Spanish" });
    const own = cand("w", ["Tamsin Okoro"], [ev("title", 1, "harbor", ["harbor"])], 5);
    expect(counterWhy(rarityEvidence(b, own, [], ["HARBOR DE LOS MARES"]))).toBe("language");
    const variant = cand("w", ["Tamsin Okoro"], [ev("title", 1, "harbor", ["harbor"], "variant")], 5);
    expect(counterEvidence(rarityEvidence(b, variant, [], ["HARBOR DE LOS MARES"])).language).toBe(false);
    const spanishWork = cand("s", ["Tamsin Okoro"], [ev("title", 1, "harbor", ["harbor"])], 5);
    expect(counterEvidence(rarityEvidence(b, spanishWork, [], ["HARBOR DE LOS MARES"])).language).toBe(false);
    expect(counterEvidence(rarityEvidence(b, own, [], ["THE HARBOR"])).language).toBe(false);
  });
});

describe("C-7 evaluation helpers", () => {
  const e = (over: Partial<RarityEvidence>): RarityEvidence => ({
    form: "x", formKind: "title", titleWorks: 1, titleBooks: 1, titleEditions: 1, bookEditions: 1, share: 1, titleBits: 10, author: 0, series: 0, authorWorks: null,
    unexplainedWords: 0, rarestUnexplained: null, rivalAuthor: false, readingLanguage: null, candidateLanguage: null, ...over,
  });
  const f = (top: string, rarity: RarityEvidence | null, conf = true, short = false): C7Facts => ({ top, conf, block: { margin: false, author: false, short }, margin: null, author: 0, words: 1, holders: null, ms: 0, rarity });

  it("blocks reads C-6's arms and C-7's kinds, and never an unconfirmed reading", () => {
    expect(blocks(f("w", e({ share: 0.2 })), "c7:namesake")).toBe(true);
    expect(blocks(f("w", e({ share: 0.2 }), false), "c7:namesake")).toBe(false);
    expect(blocks(f("w", null, true, true), "c6:short")).toBe(true);
    expect(blocks(f("w", e({})), "c7:namesake")).toBe(false);
  });

  it("the basis withdraws votes and never adds or switches an accept", () => {
    const facts = new Map([["A", f("w", e({}))], ["B", f("w", e({ share: 0.2 }))], ["C", f("v", e({}))]]);
    const base = vote(decideFromC7Facts({ vision: { variants: ["A"] }, ppocr: { variants: ["B"] }, qwen: { variants: ["C"] } }, facts, []).votes);
    const after = decideFromC7Facts({ vision: { variants: ["A"] }, ppocr: { variants: ["B"] }, qwen: { variants: ["C"] } }, facts, C7_ARMS.c7!);
    expect(base.acceptedId).toBe("w");
    expect(after.withdrawn).toBe(1);
    expect(vote(after.votes).acceptedId).toBeNull();
    expect(vote(after.votes).reason).toBe("readers-disagree");
  });

  it("leave one reader out counts corroborated confirmations kept and contradicted ones withdrawn", () => {
    const facts = new Map([["A", f("w", e({}))], ["B", f("w", e({ share: 0.2 }))], ["C", f("v", e({ share: 0.2 }))], ["D", f("w", e({}))]]);
    const spines = [
      { vision: { variants: ["A"] }, ppocr: { variants: ["B"] } }, // two agree on w: both corroborated, B withdrawn
      { vision: { variants: ["A"] }, ppocr: { variants: ["D"] }, qwen: { variants: ["C"] } }, // C contradicted by two
    ];
    const r = leaveOneReaderOut(spines, facts, C7_ARMS.c7!);
    expect(r).toMatchObject({ corroborated: 4, keptCorroborated: 3, contradicted: 1, withdrawnContradicted: 1 });
  });
});
