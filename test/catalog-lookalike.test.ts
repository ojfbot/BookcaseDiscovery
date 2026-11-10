// C-6: the lookalike guard (src/catalog/lookalike.ts) and its place in F-0's decision (src/eval/f0.ts).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCatalog } from "../src/catalog/build.ts";
import { decideFromFacts, factsOf, keepRule } from "../src/eval/c6-eval.ts";
import { guardCheck, LOOKALIKE, lookalikeGuard, lookalikeWhy, marginOf, runnerUp, sameBook, sameWork, titleHolders, titleWords, wholeAndMainForms, type GuardArm } from "../src/catalog/lookalike.ts";
import { retrieve, type Candidate, type FieldEvidence } from "../src/catalog/retrieve.ts";
import { decide, vote, type Reading } from "../src/eval/f0.ts";
import { sameWork as f0gSameWork } from "../src/eval/f0g.ts";
import { makeMiniStaging } from "./helpers/mini-staging.ts";

const ev = (field: FieldEvidence["field"], score: number, form = ""): FieldEvidence => ({ field, score, form, matches: [] });
const cand = (workId: string, title: string, authors: string[], score: number, evidence: FieldEvidence[] = [ev("title", 1, title.toLowerCase())]): Candidate => ({
  workId, title, subtitle: null, authors, series: null, seriesNum: null, year: null, ttype: "NOVEL", editionCount: 1, score, queryCoverage: 1, variant: 0, evidence,
});
const all = new Set<GuardArm>(["margin", "author", "short"]);
const only = (a: GuardArm) => new Set<GuardArm>([a]);

describe("same book (Open Library duplicates and omnibus forms never trip the margin)", () => {
  it("F-0g's sameWork is the shared one", () => {
    expect(f0gSameWork).toBe(sameWork);
  });

  it("one work id, or one title by a shared surname, is one book; another author's namesake is not", () => {
    const a = cand("isfdb:1", "Gateway", ["Frederik Pohl"], 0.85);
    expect(sameBook(a, cand("ol:OL2W", "Gateway", ["Frederik Pohl"], 0.85))).toBe(true);
    expect(sameBook(a, cand("ol:OL3W", "Gateway: A Novel", ["F. Pohl"], 0.85))).toBe(true); // subtitle folded into the title
    expect(sameBook(a, cand("ol:OL4W", "Gateway", ["Sharon Shinn"], 0.85))).toBe(false);
  });

  it("a shared whole or main title form by a shared surname is one book (an omnibus under one of its titles)", () => {
    const forms = (id: string) => (id === "novel" ? new Set(["dune"]) : id === "omni" ? wholeAndMainForms("T:dune dune messiah|W:dune|S:a novel") : new Set<string>());
    const novel = cand("novel", "Dune", ["Frank Herbert"], 0.963);
    const omni = cand("omni", "Dune / Dune Messiah", ["Frank Herbert"], 0.946);
    expect(sameBook(novel, omni)).toBe(false);
    expect(sameBook(novel, omni, forms)).toBe(true);
    expect(wholeAndMainForms("T:a|M:b|V:c|W:d|S:e|X:f")).toEqual(new Set(["a", "b", "c", "d"]));
  });
});

describe("arm (a): margin over the best different book", () => {
  it("a namesake tie is refused; a duplicate of the same book is skipped, not counted", () => {
    const w = cand("w", "Gateway", ["Frederik Pohl"], 0.85);
    const dup = cand("dup", "Gateway", ["Frederik Pohl"], 0.85);
    const other = cand("o", "Gateway", ["Sharon Shinn"], 0.85);
    expect(runnerUp(w, [w, dup, other])?.workId).toBe("o");
    expect(marginOf(w, [w, dup, other])).toBe(0);
    expect(lookalikeWhy({ candidate: w, ranked: [w, dup, other], holders: 0 }, only("margin"))).toBe("margin");
    expect(lookalikeWhy({ candidate: w, ranked: [w, dup], holders: 0 }, only("margin"))).toBeNull();
  });

  it("passes at exactly the margin and refuses just under it", () => {
    const w = cand("w", "Red Mars", ["Kim Stanley Robinson"], 0.9);
    const at = cand("o", "Red Planet", ["Robert Heinlein"], 0.9 - LOOKALIKE.margin);
    const under = cand("o", "Red Planet", ["Robert Heinlein"], 0.9 - LOOKALIKE.margin + 0.001);
    expect(lookalikeWhy({ candidate: w, ranked: [w, at], holders: 0 }, only("margin"))).toBeNull();
    expect(lookalikeWhy({ candidate: w, ranked: [w, under], holders: 0 }, only("margin"))).toBe("margin");
  });

  it("looks only `depth` candidates deep", () => {
    const w = cand("w", "Red Mars", ["Kim Stanley Robinson"], 0.9);
    const dups = Array.from({ length: LOOKALIKE.depth }, (_, i) => cand(`d${i}`, "Red Mars", ["Kim Stanley Robinson"], 0.9));
    expect(runnerUp(w, [...dups, cand("o", "Red Mars", ["Someone Else"], 0.9)])).toBeNull();
  });
});

describe("arms (b) author evidence and (c) short title", () => {
  const solo = cand("w", "Solaris", ["Stanisław Lem"], 0.85, [ev("title", 1, "solaris")]);
  const withAuthor = cand("w", "Solaris", ["Stanisław Lem"], 0.95, [ev("title", 1, "solaris"), ev("author", 0.7, "stanislaw lem")]);
  const weakAuthor = cand("w", "Solaris", ["Stanisław Lem"], 0.9, [ev("title", 1, "solaris"), ev("author", 0.3, "stanislaw lem")]);
  const twoWords = cand("w", "Red Mars", ["Kim Stanley Robinson"], 0.85, [ev("title", 1, "red mars")]);

  it("counts content words of the matched form (stopwords dropped)", () => {
    expect(titleWords(solo)).toBe(1);
    expect(titleWords(cand("w", "The Stand", ["Stephen King"], 1, [ev("title", 1, "the stand")]))).toBe(1);
    expect(titleWords(twoWords)).toBe(2);
  });

  it("(b) a one-word title, or one many books hold, needs author evidence above 0", () => {
    expect(lookalikeWhy({ candidate: solo, ranked: [solo], holders: 1 }, only("author"))).toBe("author");
    expect(lookalikeWhy({ candidate: weakAuthor, ranked: [weakAuthor], holders: 1 }, only("author"))).toBeNull();
    expect(lookalikeWhy({ candidate: twoWords, ranked: [twoWords], holders: LOOKALIKE.sharedBooks - 1 }, only("author"))).toBeNull();
    expect(lookalikeWhy({ candidate: twoWords, ranked: [twoWords], holders: LOOKALIKE.sharedBooks }, only("author"))).toBe("author");
  });

  it("(c) a one-word title needs a second field confirmed: a surname, or the series", () => {
    expect(lookalikeWhy({ candidate: solo, ranked: [solo], holders: 0 }, only("short"))).toBe("short");
    expect(lookalikeWhy({ candidate: weakAuthor, ranked: [weakAuthor], holders: 0 }, only("short"))).toBe("short");
    expect(lookalikeWhy({ candidate: withAuthor, ranked: [withAuthor], holders: 0 }, only("short"))).toBeNull();
    const series = cand("w", "Solaris", ["Stanisław Lem"], 0.9, [ev("title", 1, "solaris"), ev("series", LOOKALIKE.secondSeries, "x")]);
    expect(lookalikeWhy({ candidate: series, ranked: [series], holders: 0 }, only("short"))).toBeNull();
    expect(lookalikeWhy({ candidate: twoWords, ranked: [twoWords], holders: 0 }, only("short"))).toBeNull();
  });

  it("arms are checked in order a, b, c, and none in force passes everything", () => {
    const tie = cand("o", "Solaris", ["Someone Else"], 0.85, [ev("title", 1, "solaris")]);
    expect(lookalikeWhy({ candidate: solo, ranked: [solo, tie], holders: 2 }, all)).toBe("margin");
    expect(lookalikeWhy({ candidate: solo, ranked: [solo], holders: 2 }, new Set(["author", "short"]))).toBe("author");
    expect(lookalikeWhy({ candidate: solo, ranked: [solo, tie], holders: 2 }, new Set())).toBeNull();
  });
});

describe("title holders: distinct books holding a title form", () => {
  it("counts Open Library duplicates once and an authorless record as its own book", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE works (id TEXT PRIMARY KEY, authors TEXT, title_norm TEXT); CREATE TABLE title_forms (id INTEGER PRIMARY KEY, work_id TEXT, kind TEXT, norm TEXT);");
    const w = db.prepare("INSERT INTO works VALUES (?, ?, ?)");
    const f = db.prepare("INSERT INTO title_forms (work_id, kind, norm) VALUES (?, 'title', ?)");
    for (const [id, authors] of [["a", ["Frederik Pohl"]], ["b", ["Frederik Pohl"]], ["c", ["Sharon Shinn"]], ["d", []]] as const) {
      w.run(id, JSON.stringify(authors), "T:gateway");
      f.run(id, "gateway");
    }
    expect(titleHolders(db, "gateway")).toBe(3);
    expect(titleHolders(db, "nothing")).toBe(0);
    db.close();
  });
});

describe("F-0's decision with the guard", () => {
  const dir = mkdtempSync(join(tmpdir(), "bookcase-c6-"));
  let db: DatabaseSync;
  beforeAll(() => {
    makeMiniStaging(join(dir, "staging.sqlite"));
    buildCatalog({ staging: join(dir, "staging.sqlite"), out: join(dir, "catalog.sqlite"), now: () => new Date("2026-11-02T00:00:00Z") });
    db = new DatabaseSync(join(dir, "catalog.sqlite"), { readOnly: true });
  });
  afterAll(() => {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const read = (reader: Reading["reader"], text: string): Reading => ({ id: "x", reader, variants: [{ rotation: 90, text, confidence: 0.9 }], seconds: 0 });
  const run = (reads: Partial<Record<Reading["reader"], Reading>>, arms?: GuardArm[]) =>
    decide(db, "img:0", "img", 0.4, reads, new Map(), arms ? { guard: lookalikeGuard(db, arms), ranked: new Map() } : undefined);

  it("without a guard, decide is unchanged (and records no lookalike field)", () => {
    const d = run({ vision: read("vision", "SOLARIS"), ppocr: read("ppocr", "SOLARIS") });
    expect(d.accepted?.title).toBe("Solaris");
    expect(d.lookalike).toBeUndefined();
  });

  it("withdraws both readers' bare one-word title and says which arm did", () => {
    const d = run({ vision: read("vision", "SOLARIS"), ppocr: read("ppocr", "SOLARIS") }, ["author", "short"]);
    expect(d.accepted).toBeNull();
    expect(d.reason).toBe("no-catalog-match");
    expect(d.lookalike).toEqual({ vision: "author", ppocr: "author" });
    expect(d.top.vision).not.toBeNull();
  });

  it("keeps a title read with its author", () => {
    const d = run({ vision: read("vision", "SOLARIS STANISLAW LEM"), ppocr: read("ppocr", "Solaris Lem") }, ["margin", "author", "short"]);
    expect(d.accepted?.title).toBe("Solaris");
    expect(d.lookalike).toEqual({});
  });

  it("guardCheck with no arms passes, and the guard never adds or switches an accept", () => {
    const g = lookalikeGuard(db, []);
    const c = cand("w", "Solaris", ["Stanisław Lem"], 0.85, [ev("title", 1, "solaris")]);
    expect(guardCheck(g, c, [c])).toBeNull();
    // Three readers, every pattern of withdrawn votes: the guarded accept is the unguarded one or none.
    const works = ["x", "y", null] as const;
    for (const a of works) for (const b of works) for (const c3 of works) {
      const confirmed = { vision: a, ppocr: b, qwen: c3 };
      const base = vote({ readText: { vision: true, ppocr: true, qwen: true }, top: confirmed, confirmed }).acceptedId;
      for (let mask = 0; mask < 8; mask++) {
        const g2 = { vision: mask & 1 ? null : a, ppocr: mask & 2 ? null : b, qwen: mask & 4 ? null : c3 };
        const after = vote({ readText: { vision: true, ppocr: true, qwen: true }, top: confirmed, confirmed: g2 }).acceptedId;
        expect(after === null || after === base).toBe(true);
      }
    }
  });

  it("the evaluation's cached re-decision matches decide with the same guard", () => {
    const cases = [
      { vision: "SOLARIS", ppocr: "Solaris" },
      { vision: "SOLARIS", ppocr: "Solaris", qwen: "SOLARIS STANISLAW LEM" },
      { vision: "NEUROMANCER WILLIAM GIBSON", ppocr: "Neuromancer Gibson" },
      { vision: "RED MARS", ppocr: "COUNT ZERO GIBSON" },
    ];
    for (const arms of [[], ["margin"], ["author"], ["short"], ["margin", "author", "short"]] as GuardArm[][]) {
      for (const texts of cases) {
        const reads = Object.fromEntries(Object.entries(texts).map(([r, t]) => [r, read(r as Reading["reader"], t)]));
        const guard = lookalikeGuard(db);
        const facts = new Map(Object.values(texts).map((t) => [t, factsOf(retrieve(db, [t], LOOKALIKE.depth), guard)]));
        const cached = vote(decideFromFacts(Object.fromEntries(Object.entries(texts).map(([r, t]) => [r, { variants: [t] }])), facts, arms).votes);
        const live = run(reads, arms);
        expect(cached.acceptedId).toBe(live.accepted?.workId ?? null);
        expect(cached.reason).toBe(live.reason);
      }
    }
  });
});

// The cached-facts path (`decideFromFacts`) and the keep rule.
describe("C-6 evaluation helpers", () => {
  it("decideFromFacts withdraws only blocked confirmations and leaves unread readers out", () => {
    const facts = new Map([
      ["A", { top: "w", conf: true, block: { margin: false, author: true, short: true }, margin: 0.1, author: 0, words: 1, holders: null, ms: 0 }],
      ["B", { top: "w", conf: true, block: { margin: false, author: false, short: false }, margin: 0.1, author: 0.7, words: 1, holders: null, ms: 0 }],
    ]);
    const reads = { vision: { variants: ["A"] }, ppocr: { variants: ["B"] }, qwen: { variants: [] } };
    const none = decideFromFacts(reads, facts, []);
    expect(vote(none.votes).acceptedId).toBe("w");
    expect(none.votes.readText.qwen).toBe(false);
    const b = decideFromFacts(reads, facts, ["author"]);
    expect(b.withdrawn).toBe(1);
    expect(vote(b.votes)).toMatchObject({ acceptedId: null, reason: "single-reader" });
    expect(vote(decideFromFacts(reads, facts, ["margin"]).votes).acceptedId).toBe("w");
    expect(() => decideFromFacts({ vision: { variants: ["C"] } }, facts, [])).toThrow(/no cached facts/);
  });

  it("the keep rule needs all four conditions; 4′ ignores title-only refusals", () => {
    const iv = (value: number, lo: number, hi: number) => ({ value, lo, hi });
    const yard = { arms: { none: { v1: { wrongAcceptShareOfSpines: iv(0.005, 0.001, 0.011) } }, a: { v2: { wrongAcceptShareOfSpines: iv(0.009, 0.003, 0.016), deltaVsV1: { wrongAcceptShareOfSpines: iv(0.004, -0.002, 0.01) }, wrongAccepts: 9 } } } };
    const pilot = { arms: { a: { v2: { confirmed: 900, deltaVsV1: { confirmedShare: iv(0.02, 0.005, 0.04) } } } } };
    const golden = { v1: { refusals: { a: { refused: ["c074"], refusedWithAuthorEvidence: [] } } }, v2: { rates: { clean: { top5: 1 } } } };
    const k = keepRule(yard, pilot, golden);
    expect(k.verdicts.a).toMatchObject({ yardstick: true, pilot: true, goldenTop5: true, goldenStrict: false, goldenAuthorBearing: true, passStrict: false, passAlternative: true });
    expect(k).toMatchObject({ chosenStrict: null, chosenAlternative: "a", switchDefault: false });
  });
});
