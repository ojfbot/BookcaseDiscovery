// F-0h neighbour context on synthetic shelves and invented titles only (no photo, no reader text from the pilot set).
import { describe, expect, it } from "vitest";
import type { Detection } from "../src/eval/f0.ts";
import {
  buildRows,
  CONTEXT,
  contexts,
  decideContext,
  drawAnchor,
  halves,
  misfiles,
  ordered,
  orderPairs,
  rankHypothesis,
  readerTrial,
  sameWork,
  stripContext,
  stripCue,
  stripLabels,
  titleFit,
  tokenCost,
  tokensOf,
  usableText,
  wilson,
  worksBucket,
  type ProposalFit,
  type ReaderTrial,
  type TitleFit,
  type TrialSide,
  type WorkRef,
} from "../src/eval/f0h.ts";
import type { Polygon4 } from "../src/eval/labels.ts";

const box = (x: number, y: number, w: number, h: number): Polygon4 => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

const det = (polys: Polygon4[], medianWidth = 100): Detection => ({
  id: "synthetic",
  width: 6000,
  height: 3000,
  spines: polys.map((polygon) => ({ polygon, boxScore: 0.5, maskScore: 0.9, aspect: 5, cut: false })),
  bands: [{ polygon: box(0, 900, 6000, 1200), spines: polys.length, span: 6000, gap: 0 }],
  gaps: { bandLength: 0, gapLength: 0, gapCount: 0, medianWidth },
  tiles: 1,
  seconds: 0,
});

// Invented catalog: one author with a run of titles, another author, a common word.
const AUTHOR = ["Ann Example"];
const w = (workId: string, title: string, authors = AUTHOR): WorkRef => ({ workId, title, authors });
const marrowgate = w("w1", "The Marrowgate Lantern");
const ashfield = w("w2", "Ashfield");
const ashfold = w("w3", "Ashfold");
const quillon = w("w4", "Quillon Station");
const other = w("w9", "Tidewater Mosaic", ["Bea Other"]);
const COMMON = new Set(["lantern", "station", "night", "house"]);
const distinctive = (t: string) => !COMMON.has(t);

describe("rows", () => {
  it("orders upright boxes along the shelf and splits on a wide gap", () => {
    const polys = [box(100, 1000, 80, 600), box(190, 1000, 80, 600), box(290, 1000, 80, 600), box(1000, 1000, 80, 600)];
    const rows = buildRows(det(polys));
    expect(rows.map((r) => r.members)).toEqual([[0, 1, 2], [3]]);
    expect(rows[0]!.gaps).toEqual([0.1, 0.2]);
  });

  it("leaves out lying boxes, non-books and boxes on another shelf height", () => {
    const polys = [box(100, 1000, 80, 600), box(190, 1000, 600, 80), box(290, 1000, 80, 600), box(380, 1700, 80, 300)];
    const rows = buildRows(det(polys), (i) => i !== 2);
    expect(rows.map((r) => r.members)).toEqual([[0], [3]]);
  });
});

describe("contexts", () => {
  const works: (WorkRef | null)[] = [marrowgate, null, null, ashfield, null, other];
  const ctx = contexts(works.length, (p) => works[p] ?? null, (p) => !works[p]);

  it("finds anchors within two places, nearest first", () => {
    expect(ctx.get(1)!.anchors).toEqual([0, 3]);
    expect(ctx.get(2)!.anchors).toEqual([3, 0]);
    expect(ctx.get(4)!.anchors).toEqual([3, 5]);
  });

  it("brackets the gap between two same-author anchors and not between different authors", () => {
    expect(ctx.get(1)!.brackets).toEqual([[0, 3]]);
    expect(ctx.get(2)!.brackets).toEqual([[0, 3]]);
    expect(ctx.get(4)!.brackets).toEqual([]);
  });

  it("reaches a bracketed spine beyond the anchor reach, up to the gap limit", () => {
    const long: (WorkRef | null)[] = [ashfield, null, null, null, null, null, marrowgate];
    const c = contexts(long.length, (p) => long[p] ?? null, (p) => !long[p]);
    expect(c.get(3)!.anchors).toEqual([]);
    expect(c.get(3)!.brackets).toEqual([[0, 6]]);
    const tooLong: (WorkRef | null)[] = [ashfield, null, null, null, null, null, null, marrowgate];
    expect(contexts(tooLong.length, (p) => tooLong[p] ?? null, (p) => !tooLong[p]).get(3)).toBeUndefined();
  });
});

describe("title test", () => {
  it("costs exact 0, skeleton 1, and edits within the length bound", () => {
    expect(tokenCost("lantern", "lantern")).toBe(0);
    expect(tokenCost("marrowgate", "marrovvgate")).toBe(1);
    expect(tokenCost("ashfield", "ashfeld")).toBe(1);
    expect(tokenCost("quillon", "quiion")).toBe(2);
    expect(tokenCost("amber", "ambxyr")).toBeNull();
    expect(tokenCost("amber", "amer")).toBe(1);
  });

  it("passes a title read a letter off, with a joined split word", () => {
    const fit = titleFit(tokensOf(marrowgate.title), tokensOf("MARROW GATE LANTERM"), distinctive);
    expect(fit).toMatchObject({ pass: true, cost: 1, distinctive: 1, distinctiveMatched: 1 });
  });

  it("requires every distinctive token", () => {
    expect(titleFit(tokensOf(quillon.title), tokensOf("STATION"), distinctive)).toMatchObject({ pass: false, failed: "token" });
  });

  it("blocks a lone short distinctive word", () => {
    const short = titleFit(tokensOf("Amon"), tokensOf("AMON"), distinctive);
    expect(short).toMatchObject({ pass: false, failed: "one-word" });
    expect(titleFit(tokensOf(ashfield.title), tokensOf("ASHFIELD"), distinctive).pass).toBe(true);
  });

  it("needs a title made only of common words to fail", () => {
    expect(titleFit(tokensOf("The Night House"), tokensOf("THE NIGHT HOUSE"), distinctive)).toMatchObject({ pass: false, failed: "token" });
  });

  it("knows usable text", () => {
    expect(usableText(["  "])).toBe(false);
    expect(usableText(["of a"])).toBe(false);
    expect(usableText(["ab 12"])).toBe(false);
    expect(usableText(["xq ashfeld"])).toBe(true);
  });
});

describe("reader trial", () => {
  const fit = (pass: boolean, cost: number): TitleFit => ({ pass, cost, cover: 1, distinctive: 1, distinctiveMatched: pass ? 1 : 0, failed: pass ? null : "token" });
  const pf = (work: WorkRef, f: TitleFit, titleEvidence = 0.7, coverage = 0.8, score = 0.6): ProposalFit => ({ work, fit: f, score, titleEvidence, coverage });
  const side = (over: Partial<TrialSide> = {}): TrialSide => ({ sameBook: (a, b) => a.workId === b.workId, openTop: null, counter: () => null, ...over });

  it("picks the only passing proposal", () => {
    expect(readerTrial("qwen", [pf(ashfield, fit(true, 1)), pf(quillon, fit(false, 9))], side())).toMatchObject({ workId: "w2", why: null });
  });

  it("refuses when another book of the same author is within the margin", () => {
    const t = readerTrial("qwen", [pf(ashfield, fit(true, 1)), pf(ashfold, fit(true, 2))], side());
    expect(t).toMatchObject({ workId: null, why: "margin", cost: 1, runnerCost: 2 });
    expect(readerTrial("qwen", [pf(ashfield, fit(true, 0)), pf(ashfold, fit(true, 2))], side()).workId).toBe("w2");
  });

  it("collapses one book's records before the margin", () => {
    const dup = w("w2b", "Ashfield");
    expect(readerTrial("qwen", [pf(ashfield, fit(true, 1)), pf(dup, fit(true, 1))], side({ sameBook: (a, b) => sameWork(a, b) })).workId).toBe("w2");
  });

  it("holds the lowered bar", () => {
    expect(readerTrial("qwen", [pf(ashfield, fit(true, 1), 0.5)], side()).why).toBe("bar");
    expect(readerTrial("qwen", [pf(ashfield, fit(true, 1), 0.7, 0.4)], side()).why).toBe("bar");
  });

  it("yields to a clearly better open-catalog reading, and to counter-evidence", () => {
    const openTop = { ...other, score: 0.9, passes: true };
    expect(readerTrial("qwen", [pf(ashfield, fit(true, 1))], side({ openTop })).why).toBe("open-catalog-winner");
    expect(readerTrial("qwen", [pf(ashfield, fit(true, 1), 0.7, 0.8, 0.88)], side({ openTop })).workId).toBe("w2");
    expect(readerTrial("qwen", [pf(ashfield, fit(true, 1))], side({ counter: () => "namesake" })).why).toBe("counter:namesake");
  });
});

describe("spine decision", () => {
  const works = new Map([ashfield, ashfold, other].map((x) => [x.workId, x]));
  const workOf = (id: string) => works.get(id)!;
  const ok = (reader: ReaderTrial["reader"], workId: string): ReaderTrial => ({ reader, workId, why: null });
  const no = (reader: ReaderTrial["reader"], why: ReaderTrial["why"]): ReaderTrial => ({ reader, workId: null, why });

  it("lets one reader stand with context as the second", () => {
    const d = decideContext("s", [ok("qwen", "w2"), no("vision", "no-proposal-passes")], { qwen: null, vision: null }, sameWork, workOf);
    expect(d).toMatchObject({ basis: "confirmed-by-context", workId: "w2", readers: ["qwen"] });
  });

  it("refuses when a reader confirms another work under F-0's bar, or readers disagree", () => {
    expect(decideContext("s", [ok("qwen", "w2")], { vision: other }, sameWork, workOf).why).toBe("conflicting-reader");
    expect(decideContext("s", [ok("qwen", "w2"), ok("ppocr", "w3")], {}, sameWork, workOf).why).toBe("readers-disagree");
  });

  it("reports the furthest rule reached when no reader passes", () => {
    expect(decideContext("s", [no("qwen", "bar"), no("vision", "margin")], {}, sameWork, workOf).why).toBe("margin");
    expect(decideContext("s", [], {}, sameWork, workOf).why).toBe("no-reader-text");
  });
});

describe("order statistics", () => {
  it("counts consecutive pairs in surname order, skipping equal keys", () => {
    expect(orderPairs(["adams", "adams", "baker", "carter", "brown"])).toEqual({ pairs: 3, inOrder: 2 });
    expect(ordered(["adams", "baker", "carter", "dunn"])).toBe(true);
    expect(ordered(["adams", "carter", "baker", "dunn"])).toBe(false);
    expect(ordered(["adams", "baker"])).toBe(false);
  });

  it("flags a spine out of order with both neighbours", () => {
    expect(misfiles(["adams", "baker", "zeller", "carter", "dunn"])).toEqual([2]);
    expect(misfiles(["adams", "baker", "carter"])).toEqual([]);
  });
});

describe("shelf strips", () => {
  it("reads a section and an ordering from strip wording", () => {
    expect(stripCue(["SCIENCE FICTION/FANTASY (Alphabetical by Author)"])).toEqual({ strip: true, ordering: true });
    expect(stripCue(["Fiction/Fantasy"])).toEqual({ strip: true, ordering: false });
    expect(stripCue(["Like this author? Now try"])).toEqual({ strip: false, ordering: false });
  });

  it("gives a row context with its source, for a later shelf-context layer to replace", () => {
    expect(stripContext(["SCIENCE FICTION/FANTASY (Alphabetical by Author)"])).toEqual({ ordering: "author-alphabetical", genre: "SCIENCE FICTION/FANTASY", letterRange: null, source: "f0f-shelf-strip" });
    expect(stripContext(["Fiction/Fantasy"]).ordering).toBeNull();
  });

  it("labels the row just above it", () => {
    const row = { bottom: 1600, left: 100, right: 900, height: 600 };
    expect(stripLabels({ top: 1620, left: 200, right: 700 }, row)).toBe(true);
    expect(stripLabels({ top: 2600, left: 200, right: 700 }, row)).toBe(false);
    expect(stripLabels({ top: 1620, left: 1000, right: 1500 }, row)).toBe(false);
  });
});

describe("hypotheses", () => {
  const ws = [
    { workId: "a", title: "Amber Coast", editions: 10 },
    { workId: "b", title: "The Brass Weir", editions: 4 },
    { workId: "c", title: "Cinder Hollow", editions: 6 },
    { workId: "z", title: "Zinc Harbour", editions: 30 },
  ];

  it("ranks works by edition count", () => {
    expect(rankHypothesis(ws).map((x) => x.workId)).toEqual(["z", "a", "c", "b"]);
  });

  it("weighs titles between an ordered bracket's two titles", () => {
    const r = rankHypothesis(ws, { left: "Amber Coast", right: "Cinder Hollow", ordered: true });
    expect(r.map((x) => x.workId)).toEqual(["z", "a", "c", "b"]);
    expect(r[1]!.share).toBeCloseTo(20 / (20 + 8 + 12 + 30), 3);
    expect(rankHypothesis(ws, { left: "Amber Coast", right: "Cinder Hollow", ordered: false })[1]!.share).toBeCloseTo(10 / 50, 3);
  });

  it("keeps the top few", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ workId: `w${i}`, title: `Title ${i}`, editions: i + 1 }));
    expect(rankHypothesis(many)).toHaveLength(CONTEXT.hypothesisTop);
  });
});

describe("shuffle and helpers", () => {
  it("buckets authors by catalog works", () => {
    expect([1, 2, 5, 6, 20, 21, 60, 61, 500].map(worksBucket)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it("draws only from other rows in the same bucket, reproducibly", () => {
    const pool = [
      { rowKey: "p|0", bucket: 1, id: 1 },
      { rowKey: "p|1", bucket: 1, id: 2 },
      { rowKey: "q|0", bucket: 2, id: 3 },
    ];
    expect(drawAnchor(pool, "p|0", 1, () => 0.99)!.id).toBe(2);
    expect(drawAnchor(pool, "p|1", 1, () => 0)!.id).toBe(1);
    expect(drawAnchor(pool, "q|0", 2, () => 0.5)).toBeNull();
  });

  it("splits photos into halves by hash, deterministically", () => {
    const ids = Array.from({ length: 31 }, (_, i) => `photo-${i}`);
    const h = halves(ids);
    expect(h.a.size).toBe(15);
    expect(h.b.size).toBe(16);
    expect(halves([...ids].reverse()).a).toEqual(h.a);
  });

  it("gives a Wilson interval", () => {
    const [lo, hi] = wilson(0, 20)!;
    expect(lo).toBe(0);
    expect(hi).toBeCloseTo(0.161, 3);
    expect(wilson(0, 0)).toBeNull();
  });
});
