import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCatalog } from "../src/catalog/build.ts";
import { buildImprintTable, editionImprintKeys, editionKeys, imprintKey, imprintMatches, publisherKeys, shelfMark, usableImprint, wikidataParents } from "../src/catalog/imprint.ts";
import type { Candidate } from "../src/catalog/retrieve.ts";
import type { SpineDecision } from "../src/eval/f0.ts";
import { boxImprint } from "../src/eval/f0d-cli.ts";
import { applyImprintContrast, carries, IMP1, imprintContrast, reorderable, tieBreak, workImprintKeys, workImprints, type ContrastInput } from "../src/eval/f0d.ts";
import { makeMiniStaging } from "./helpers/mini-staging.ts";

describe("imprint keys (publisher normalisation)", () => {
  it("drops business words and parentheticals, keeps short house names", () => {
    expect(imprintKey("Tor Books")).toBe("tor");
    expect(imprintKey("DAW")).toBe("daw");
    expect(imprintKey("Penguin Books (US)")).toBe("penguin");
    expect(imprintKey("The Penguin Press")).toBe("penguin");
    expect(imprintKey("O'Reilly Media")).toBe("oreilly");
    expect(imprintKey("Ediciones B")).toBe("ediciones b"); // what is left would be one letter
    expect(imprintKey("Tom Doherty Associates")).toBe("tor");
    expect(imprintKey("  ")).toBeNull();
    expect(imprintKey(null)).toBeNull();
  });

  it("splits ISFDB's 'Imprint / Publisher' strings into keys", () => {
    expect(publisherKeys("Del Rey / Ballantine")).toEqual(["del rey", "ballantine"]);
    expect(publisherKeys("Puffin / Penguin Books (UK)")).toEqual(["puffin", "penguin"]);
    expect(publisherKeys("")).toEqual([]);
  });

  it("groups an imprint under the houses ISFDB pairs it with, never under a book club", () => {
    const t = buildImprintTable([
      ["Del Rey / Ballantine", 40],
      ["Del Rey", 100],
      ["Tor / SFBC", 50],
      ["Tor", 500],
      ["Roc / Pinnacle", 2], // too few editions to make Pinnacle Roc's parent
      ["Roc", 300],
    ]);
    expect([...(t.parents.get("del rey") ?? [])]).toEqual(["ballantine"]);
    expect(t.parents.has("tor")).toBe(false);
    expect(t.parents.has("roc")).toBe(false);
    expect(editionKeys(t, "Del Rey")).toEqual(["del rey", "ballantine"]);
  });

  it("matches exactly or as a whole-word prefix of 3+ letters", () => {
    expect(imprintMatches("tor", ["tor teen"])).toBe(true);
    expect(imprintMatches("tor", ["tordotcom"])).toBe(false);
    expect(imprintMatches("del rey", ["del rey", "ballantine"])).toBe(true);
    expect(imprintMatches("pe", ["pe ltd"])).toBe(false);
    expect(imprintMatches(null, ["tor"])).toBe(false);
  });
});

describe("box imprint from its rotations", () => {
  const v = (imprint: string | null, imprintFrom: "text" | "logo" | null = "text") => ({ rotation: 90, title: null, author: null, imprint, imprintFrom, parsed: true, seconds: 1 });
  const r = (...variants: ReturnType<typeof v>[]) => ({ id: "x", reader: "q", variants, seconds: 1 });
  it("takes the one key every naming rotation gives, and drops conflicts", () => {
    expect(boxImprint(r(v("Tor Books"), v(null)))).toMatchObject({ key: "tor", from: "text", conflict: false });
    expect(boxImprint(r(v("Tor", "logo"), v("TOR", "logo")))).toMatchObject({ key: "tor", from: "logo" });
    expect(boxImprint(r(v("Tor", "logo"), v("Tor", "text")))).toMatchObject({ key: "tor", from: "text" });
    expect(boxImprint(r(v("Tor"), v("Ace")))).toMatchObject({ key: null, conflict: true });
    expect(boxImprint(r(v(null), v(null)))).toMatchObject({ key: null, conflict: false });
    expect(boxImprint(undefined).key).toBeNull();
  });
});

// --- tie-break ------------------------------------------------------------------------------------------

const cand = (workId: string, score = 0.9, title = 0.95, cov = 0.8): Candidate => ({
  workId, title: workId, subtitle: null, authors: [], series: null, seriesNum: null, year: null, ttype: "NOVEL", editionCount: 1,
  score, queryCoverage: cov, variant: 0, evidence: [{ field: "title", score: title, form: workId, matches: [] }],
});
const decision = (confirmed: SpineDecision["confirmed"], accepted: Candidate | null = null): SpineDecision => ({
  id: "img:0", imageId: "img", boxScore: 0.3, confirmed, top: { ...confirmed }, readText: { vision: true, ppocr: true },
  accepted, agreeing: accepted ? ["vision", "ppocr"] : [], reason: accepted ? null : "readers-disagree", hard: true,
});

describe("imprint tie-break (never identity on its own)", () => {
  const w1 = cand("w1", 0.92), w2 = cand("w2", 0.9), weak = cand("w3", 0.5);
  const lists = { vision: [w1, w2], ppocr: [w2] };
  const base = decision({ vision: "w1", ppocr: "w2" });

  it("lets the imprint pick between candidates a reader already passes, so two readers agree", () => {
    const t = tieBreak(base, lists, (w) => w === "w2");
    expect(t.decision.accepted?.workId).toBe("w2");
    expect(t.decision.agreeing.sort()).toEqual(["ppocr", "vision"]);
    expect(t.switched).toEqual(["vision"]);
    expect(t.fired).toBe(true);
  });

  it("never touches a spine two readers already agree on", () => {
    const agreed = decision({ vision: "w1", ppocr: "w1" }, w1);
    expect(tieBreak(agreed, { vision: [w1, w2], ppocr: [w1, w2] }, (w) => w === "w2").decision).toBe(agreed);
  });

  it("does nothing when the imprint matches every passing candidate, or none", () => {
    expect(tieBreak(base, lists, () => true).decision.accepted).toBeNull();
    expect(tieBreak(base, lists, () => false).decision.accepted).toBeNull();
  });

  it("never promotes a candidate that fails the bar, nor a reader's only passing one", () => {
    const l = { vision: [weak, w1], ppocr: [w1] };
    const d = decision({ vision: null, ppocr: "w1" });
    expect(tieBreak(d, l, (w) => w === "w1").decision.accepted).toBeNull();
    expect(tieBreak(d, { vision: [w2, weak], ppocr: [w1] }, (w) => w === "w3").decision.accepted).toBeNull();
  });

  it("an imprint plus one reader is not an accept", () => {
    const d = decision({ vision: "w1", ppocr: null });
    expect(tieBreak(d, { vision: [w1, w2], ppocr: [] }, (w) => w === "w2").decision.accepted).toBeNull();
  });

  it("finds the spines an imprint could change", () => {
    expect(reorderable(base, lists)).toBe(true);
    expect(reorderable(decision({ vision: "w1", ppocr: null }), { vision: [w1, w2], ppocr: [] })).toBe(false);
    expect(reorderable(decision({ vision: "w1", ppocr: "w1" }, w1), lists)).toBe(false);
  });
});

describe("work imprints from the catalog", () => {
  const dir = mkdtempSync(join(tmpdir(), "bookcase-f0d-"));
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

  it("collects every edition's publisher keys for a work", () => {
    const table = buildImprintTable((db.prepare("SELECT publisher, count(*) AS n FROM editions GROUP BY publisher").all() as { publisher: string; n: number }[]).map((r) => [r.publisher, r.n] as const));
    const keysOf = workImprints(db, table);
    expect(keysOf("isfdb:201").sort()).toEqual(["ace", "penguin"]);
    expect(carries(keysOf, "ace")("isfdb:201")).toBe(true);
    expect(carries(keysOf, "tor")("isfdb:201")).toBe(false);
  });

  it("adds the publisher series to a work's strict keys (C-9)", () => {
    const table = buildImprintTable([]);
    const keysOf = workImprintKeys(db, table);
    expect(keysOf("isfdb:201").strict.sort()).toEqual(["ace", "ace science fiction specials", "penguin"]);
    expect(workImprintKeys(db, table, undefined, { series: false })("isfdb:201").strict.sort()).toEqual(["ace", "penguin"]);
  });
});

describe("C-9 imprint data", () => {
  const table = buildImprintTable([["Del Rey / Ballantine", 40], ["Del Rey", 100]]);
  const links = wikidataParents(
    [
      { isfdb: "1", parentIsfdb: "2", parentLabel: "Random House", start: "1998-01-01T00:00:00Z" },
      { isfdb: "3", itemLabel: "Gollancz", parentLabel: "Orion Publishing Group" },
      { isfdb: "3", itemLabel: "Gollancz", parentLabel: "Orion Publishing Group" }, // the same statement twice
      { isfdb: "4", itemLabel: "Q123", parentLabel: "Q456" }, // no labels
      { isfdb: "5", itemLabel: "SFBC", parentLabel: "Bookspan" }, // a club is never a child
    ],
    (id) => ({ "1": "Ballantine Books", "2": "Random House" })[id],
  );

  it("joins Wikidata links to ISFDB names, keeps dates, drops clubs, Q-ids and repeats", () => {
    expect([...links.keys()].sort()).toEqual(["ballantine", "gollancz"]);
    expect(links.get("ballantine")).toEqual([{ child: "ballantine", parent: "random house", start: 1998, end: null }]);
    expect(links.get("gollancz")).toHaveLength(1);
  });

  it("keeps every publisher string; dated parents are strict only inside their dates", () => {
    const ed = (year: number | null) => editionImprintKeys(table, { publisher: "Del Rey", publishers: '["Del Rey","Ballantine Books"]', pubSeries: "Del Rey Impact", year }, links);
    expect([...ed(2001).strict].sort()).toEqual(["ballantine", "del rey", "del rey impact", "random house"]);
    expect([...ed(1990).strict]).not.toContain("random house");
    expect([...ed(1990).any]).not.toContain("random house"); // a dated link outside its dates is no link
    expect([...ed(null).strict]).not.toContain("random house");
    expect([...ed(null).any]).toContain("random house"); // no year: the dated link counts as undated
  });

  it("counts ISFDB-derived and undated parents for `any` only", () => {
    const k = editionImprintKeys(table, { publisher: "Del Rey", year: 2001 }, links);
    expect([...k.strict]).toEqual(["del rey"]);
    expect([...k.any].sort()).toEqual(["ballantine", "del rey"]);
    const g = editionImprintKeys(table, { publisher: "Gollancz", year: 2001 }, links);
    expect([...g.strict]).toEqual(["gollancz"]);
    expect([...g.any]).toContain("orion");
  });

  it("finds shelf marks without labels: digits, or Cutter letters of a candidate's surname", () => {
    expect(shelfMark("821.134 GAR", [])).toBe("digit");
    expect(shelfMark("001 Bel", [])).toBe("digit");
    expect(shelfMark("N BEL", ["Saul Bellow"])).toBe("cutter");
    expect(shelfMark("BEL", ["Juan García"])).toBeNull();
    expect(shelfMark("DAW", ["Ursula K. Le Guin"])).toBeNull();
    expect(shelfMark("Tol", ["J. R. R. Tolkien"])).toBe("cutter");
    expect(shelfMark("Penguin", ["Pen Name"])).toBeNull();
    expect(usableImprint("tor", "Tor", [])).toBe(true);
    expect(usableImprint("tor", "Tor", ["Ana Torres"])).toBe(false); // the cost: a real house that begins a surname
    expect(usableImprint("sfbc", "SFBC", [])).toBe(false);
    expect(usableImprint("ab", "AB", [])).toBe(false);
  });
});

describe("IMP-1: the imprint contrast (never a confirmer)", () => {
  const a = cand("a", 0.9), rival = cand("r", 0.895), far = cand("f", 0.85), weak = cand("w", 0.895, 0.5);
  const base = decision({ vision: "a", ppocr: "a" }, a);
  const input = (over: Partial<ContrastInput> = {}): ContrastInput => ({
    accepted: a, agreeing: ["vision", "ppocr"], lists: { vision: [a, rival, far], ppocr: [a, weak] }, imprint: "tor",
    carriesStrict: (w) => w === "r", carriesAny: (w) => w === "r", same: () => false, ...over,
  });

  it("is off by default", () => {
    expect(IMP1.enabled).toBe(false);
    const c = imprintContrast(input());
    expect(c).toMatchObject({ withhold: true, close: true });
    expect(applyImprintContrast(base, c)).toBe(base);
  });

  it("withholds, never switches, when only a close passing runner-up carries the house", () => {
    const d = applyImprintContrast(base, imprintContrast(input()), true);
    expect(d.accepted).toBeNull();
    expect(d.imprintContrast).toEqual({ accepted: "a", rival: "r" });
  });

  it("does nothing when the accepted work carries the house, even through an undated parent", () => {
    expect(imprintContrast(input({ carriesAny: () => true })).withhold).toBe(false);
  });

  it("needs the runner-up to carry it strictly, pass the bar, sit within the margin and be another book", () => {
    expect(imprintContrast(input({ carriesStrict: () => false })).withhold).toBe(false);
    expect(imprintContrast(input({ carriesStrict: (w) => w === "f", carriesAny: (w) => w === "f" })).withhold).toBe(false);
    expect(imprintContrast(input({ carriesStrict: (w) => w === "w", carriesAny: (w) => w === "w" })).withhold).toBe(false);
    expect(imprintContrast(input({ same: () => true }))).toEqual({ withhold: false, rival: null, close: false });
  });

  it("no usable read, no withhold", () => {
    expect(imprintContrast(input({ imprint: null }))).toMatchObject({ withhold: false, close: true });
  });
});
