// F-0g copy groups on synthetic shelves only (no photo, no reader text from the pilot set).
import { describe, expect, it } from "vitest";
import type { Detection } from "../src/eval/f0.ts";
import {
  consistentReaders,
  contradiction,
  copyGroups,
  neighbours,
  pairGuard,
  propagate,
  sameWork,
  visuallySame,
  type Fit,
  type ReaderTop,
  type SpineEvidence,
  type WorkRef,
} from "../src/eval/f0g.ts";
import type { Polygon4 } from "../src/eval/labels.ts";

const box = (x: number, y: number, w: number, h: number): Polygon4 => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

const det = (polys: Polygon4[], medianWidth = 100): Detection => ({
  id: "synthetic",
  width: 4000,
  height: 3000,
  spines: polys.map((polygon) => ({ polygon, boxScore: 0.5, maskScore: 0.9, aspect: 5, cut: false })),
  bands: [{ polygon: box(0, 900, 4000, 1200), spines: polys.length, span: 4000, gap: 0 }],
  gaps: { bandLength: 0, gapLength: 0, gapCount: 0, medianWidth },
  tiles: 1,
  seconds: 0,
});

// A series in matching jackets: one author, three titles.
const author = ["Ann Example"];
const first: WorkRef = { workId: "w1", title: "The First Tower", authors: author };
const second: WorkRef = { workId: "w2", title: "The Second Tower", authors: author };
const other: WorkRef = { workId: "w9", title: "Unrelated Book", authors: ["Bea Other"] };

const top = (w: WorkRef, score: number, titleEvidence: number, passes: boolean) => ({ ...w, score, titleEvidence, passes });
const reader = (r: ReaderTop["reader"], t: ReaderTop["top"]): ReaderTop => ({ reader: r, top: t });

/** A fit table: (spine, reader, work) -> how well the work explains that reader's text. */
const fitOf = (table: Record<string, { score: number; titleEvidence: number }>): Fit => (s, r, w) => table[`${s}|${r}|${w}`] ?? { score: 0, titleEvidence: 0 };

describe("neighbours", () => {
  it("pairs each upright spine with the next one along its shelf", () => {
    const d = det([box(100, 1000, 100, 1000), box(205, 1000, 100, 1000), box(310, 1010, 100, 990)]);
    expect(neighbours(d).map((n) => [n.a, n.b])).toEqual([[0, 1], [1, 2]]);
  });

  it("skips a gap, a piece in the same column, a lying book and a box on another shelf", () => {
    const d = det([
      box(100, 1000, 100, 1000),
      box(105, 1500, 100, 480), // same column: a piece of the first spine
      box(400, 1000, 100, 1000), // 200 px gap: two median widths
      box(510, 1800, 600, 100), // lying flat
    ]);
    expect(neighbours(d)).toEqual([]);
  });

  it("reports the size ratios a copy must keep", () => {
    const [n] = neighbours(det([box(100, 1000, 100, 1000), box(205, 1100, 120, 900)]));
    expect(n!.longRatio).toBeCloseTo(1000 / 900);
    expect(n!.shortRatio).toBeCloseTo(1.2);
  });
});

describe("visual sameness", () => {
  const model = { features: ["ncc", "hist", "prof", "longLog", "shortLog"], mean: [0, 0, 0, 0, 0], sd: [1, 1, 1, 1, 1], weights: [-10, 10, 0, 0, 0, 0], threshold: 0.5 };
  it("needs a score at the threshold, one size and both strips in frame", () => {
    const same = { ncc: 1.5, hist: 0.9, prof: 0.9, valid: true };
    expect(visuallySame(same, { longRatio: 1.02, shortRatio: 1.1 }, model)).toBe(true);
    expect(visuallySame({ ...same, ncc: 0.5 }, { longRatio: 1.02, shortRatio: 1.1 }, model)).toBe(false);
    expect(visuallySame(same, { longRatio: 1.3, shortRatio: 1.1 }, model)).toBe(false); // a taller book
    expect(visuallySame({ ...same, valid: false }, { longRatio: 1.02, shortRatio: 1.1 }, model)).toBe(false);
  });
});

describe("series guard", () => {
  it("treats one title by a shared author as one work even under two ids", () => {
    expect(sameWork(first, { ...first, workId: "w1-dup" })).toBe(true);
    expect(sameWork(first, second)).toBe(false);
  });

  it("rejects the next book of a series read well but below the bar", () => {
    const y: SpineEvidence = { id: "y", accepted: null, readers: [reader("vision", top(second, 0.66, 1, false))] };
    const fit = fitOf({ "y|vision|w1": { score: 0.55, titleEvidence: 0.67 } });
    expect(contradiction(y, first, fit)).toBe("reads-other-title");
  });

  it("rejects a copy one of whose readers confirms another work", () => {
    const y: SpineEvidence = { id: "y", accepted: null, readers: [reader("ppocr", top(second, 0.8, 1, true))] };
    expect(contradiction(y, first, fitOf({}))).toBe("reader-confirms-other");
  });

  it("does not let a weak read of another title veto, but does not count it as support either", () => {
    const y: SpineEvidence = { id: "y", accepted: null, readers: [reader("vision", top(other, 0.4, 0.5, false))] };
    const fit = fitOf({ "y|vision|w1": { score: 0.3, titleEvidence: 0.3 } });
    expect(contradiction(y, first, fit)).toBeNull();
    expect(consistentReaders(y, first, fit)).toEqual([]);
  });

  it("links two confirmed copies of one work and refuses two confirmed works", () => {
    const x: SpineEvidence = { id: "x", accepted: first, readers: [] };
    expect(pairGuard(x, { id: "y", accepted: first, readers: [] }, fitOf({}))).toBeNull();
    expect(pairGuard(x, { id: "y", accepted: second, readers: [] }, fitOf({}))).toBe("accepted-differ");
  });

  it("refuses two unconfirmed spines whose strong reads name different works, and a differing imprint", () => {
    const x: SpineEvidence = { id: "x", accepted: null, readers: [reader("vision", top(first, 0.6, 0.9, false))] };
    const y: SpineEvidence = { id: "y", accepted: null, readers: [reader("vision", top(second, 0.6, 0.9, false))] };
    expect(pairGuard(x, y, fitOf({}))).toBe("reads-differ");
    expect(pairGuard({ ...x, imprint: "tor" }, { ...x, id: "y", imprint: "ace" }, fitOf({}))).toBe("imprint-differs");
    expect(pairGuard({ ...x, imprint: "tor" }, { ...x, id: "y", imprint: null }, fitOf({}))).toBeNull();
  });
});

describe("copy groups and propagation", () => {
  it("joins linked neighbours into runs in shelf order", () => {
    const x = [50, 10, 30, 70, 90];
    expect(copyGroups([{ a: 1, b: 2 }, { a: 2, b: 0 }, { a: 3, b: 4 }], (i) => x[i]!)).toEqual([[1, 2, 0], [3, 4]]);
  });

  it("propagates a confirmed copy's work to a twin whose own reader supports it, keeping both observations", () => {
    const x: SpineEvidence = { id: "x", accepted: first, readers: [] };
    const y: SpineEvidence = { id: "y", accepted: null, readers: [reader("vision", top(first, 0.6, 0.7, false))] };
    const z: SpineEvidence = { id: "z", accepted: null, readers: [] }; // unreadable: no reader to support it
    const out = propagate([x, y, z], fitOf({ "y|vision|w1": { score: 0.6, titleEvidence: 0.7 } }));
    expect(out).toHaveLength(3); // INV-4: three copies, three decisions
    expect(out[0]).toMatchObject({ id: "x", basis: "readers-agree", workId: "w1" });
    expect(out[1]).toMatchObject({ id: "y", basis: "confirmed-by-copy", workId: "w1", from: "x", consistent: ["vision"] });
    expect(out[2]).toMatchObject({ id: "z", basis: null, blocked: "no-consistent-reader" });
  });

  it("never propagates across a series-guard failure or inside a group whose copies disagree", () => {
    const x: SpineEvidence = { id: "x", accepted: first, readers: [] };
    const y: SpineEvidence = { id: "y", accepted: null, readers: [reader("vision", top(second, 0.7, 1, false))] };
    const fit = fitOf({ "y|vision|w1": { score: 0.5, titleEvidence: 0.67 } });
    expect(propagate([x, y], fit)[1]).toMatchObject({ basis: null, blocked: "reads-other-title" });
    const w: SpineEvidence = { id: "w", accepted: second, readers: [] };
    const u: SpineEvidence = { id: "u", accepted: null, readers: [reader("vision", top(first, 0.6, 0.7, false))] };
    expect(propagate([x, u, w], fit)[1]).toMatchObject({ basis: null, blocked: "mixed-group" });
  });
});
