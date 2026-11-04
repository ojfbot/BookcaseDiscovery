// F-0g2 pooled reading on synthetic copy groups only (no photo, no reader text from the pilot set).
import { describe, expect, it } from "vitest";
import type { ReaderName } from "../src/eval/f0.ts";
import type { Fit, ReaderTop, SpineEvidence, WorkRef } from "../src/eval/f0g.ts";
import { fuse, overlapAlign, poolGroup, pooledReading, selfDecides, viewOf, wilsonUpper, type Lookup, type PoolCopy } from "../src/eval/f0g2.ts";

const author = ["Ann Example"];
const first: WorkRef = { workId: "w1", title: "The First Tower", authors: author };
const second: WorkRef = { workId: "w2", title: "The Second Tower", authors: author };

const top = (w: WorkRef, passes: boolean, titleEvidence = passes ? 1 : 0.6) => ({ ...w, score: passes ? 0.9 : 0.5, titleEvidence, passes });
const reader = (r: ReaderName, t: ReaderTop["top"]): ReaderTop => ({ reader: r, top: t });
const copy = (id: string, readers: ReaderTop[], texts: Partial<Record<ReaderName, string[]>>): PoolCopy => ({ ev: { id, accepted: null, readers }, texts });
const fitOf = (table: Record<string, { score: number; titleEvidence: number }>): Fit => (s, r, w) => table[`${s}|${r}|${w}`] ?? { score: 0, titleEvidence: 0 };

/** A toy catalog lookup: a reading confirms a work when one variant holds all of its title's words. */
const catalog = (works: WorkRef[]): Lookup => (variants) => {
  let best: ReturnType<Lookup> = null;
  variants.forEach((v, variant) => {
    for (const w of works) {
      const words = w.title.toLowerCase().split(" ");
      const have = words.filter((t) => v.toLowerCase().split(" ").includes(t)).length / words.length;
      if (have > 0 && (!best || have > best.titleEvidence)) best = { ...w, score: have, titleEvidence: have, coverage: 1, passes: have === 1, variant };
    }
  });
  return best;
};

describe("overlap alignment", () => {
  it("aligns a fragment inside a longer text with free end gaps", () => {
    const al = overlapAlign("the first tower ann example", "first tow");
    expect(al.score).toBe(9);
    expect(al.a).toEqual([4, 13]);
    expect(al.b).toEqual([0, 9]);
  });

  it("finds the overlap of a prefix fragment and a suffix fragment", () => {
    const al = overlapAlign("the first tow", "first tower");
    expect(al.a).toEqual([4, 13]);
    expect(al.b).toEqual([0, 9]);
  });
});

describe("fusion", () => {
  it("joins two fragments that overlap into one longer reading", () => {
    const f = fuse([
      { copy: "x", variants: ["THE FIRST TOW"] },
      { copy: "y", variants: ["first tower, Ann"] },
    ])!;
    expect(f.fusedAligned).toBe("the first tower ann");
    expect(f.alignedCopies).toEqual(["x", "y"]);
  });

  it("corrects a character by majority with three copies, and keeps the centre on a tie with two", () => {
    const three = fuse([
      { copy: "a", variants: ["the flrst tower"] },
      { copy: "b", variants: ["the first tower"] },
      { copy: "c", variants: ["the first towor"] },
    ])!;
    expect(three.fusedAligned).toBe("the first tower");
    const two = fuse([
      { copy: "a", variants: ["the first tower"] },
      { copy: "b", variants: ["the first towor"] },
    ])!;
    expect(two.fusedAligned).toBe(two.centre.text);
  });

  it("picks the rotation that lines up with the other copies", () => {
    const f = fuse([
      { copy: "a", variants: ["ɹǝʍoʇ", "first tower"] },
      { copy: "b", variants: ["xq zzv", "the first tower"] },
    ])!;
    expect(f.chosen.map((c) => c.text).sort()).toEqual(["first tower", "the first tower"]);
    expect(f.fusedAligned).toBe("the first tower");
  });

  it("keeps a text that does not overlap the centre only in the union", () => {
    const f = fuse([
      { copy: "a", variants: ["the first tower"] },
      { copy: "b", variants: ["the first tow"] },
      { copy: "c", variants: ["ann example"] },
    ])!;
    expect(f.fusedAligned).toBe("the first tower");
    expect(f.fusedAll).toBe("the first tower ann example");
    expect(f.allCopies).toEqual(["a", "b", "c"]);
  });

  it("needs text on two copies", () => {
    expect(fuse([{ copy: "a", variants: ["the first tower"] }, { copy: "b", variants: [] }])).toBeNull();
  });
});

describe("the pooled vote", () => {
  const lookup = catalog([first, second]);

  it("confirms a work two models read only in fragments, and labels every consistent copy", () => {
    // Each copy's reads are fragments no reader passes the bar on; pooled, two models do.
    const x = copy("x", [reader("vision", top(first, false)), reader("ppocr", top(first, false))], { vision: ["the first"], ppocr: ["the firs"] });
    const y = copy("y", [reader("vision", top(first, false)), reader("ppocr", top(first, false))], { vision: ["first tower"], ppocr: ["first tower"] });
    const fit = fitOf({ "x|vision|w1": { score: 0.6, titleEvidence: 0.67 }, "y|vision|w1": { score: 0.6, titleEvidence: 0.67 } });
    const r = poolGroup([x, y], lookup, fit);
    expect(r.work?.workId).toBe("w1");
    expect(r.supporting.sort()).toEqual(["ppocr", "vision"]);
    expect(r.votes.every((v) => v.fromFused)).toBe(true);
    // Never a merge: one decision per copy, each with its own basis.
    expect(r.decisions.map((d) => [d.id, d.basis])).toEqual([["x", "confirmed-by-pooling"], ["y", "confirmed-by-pooling"]]);
    expect(r.decisions[0]!.sources!.sort()).toEqual(["x", "y"]);
    // Without fusion neither model passes: the copies' own reads are fragments.
    expect(poolGroup([x, y], lookup, fit, false).work).toBeNull();
  });

  it("counts one model once however many copies it read (INV-6)", () => {
    const cs = ["a", "b", "c"].map((id) => copy(id, [reader("vision", top(first, true))], { vision: ["the first tower"] }));
    const r = poolGroup(cs, lookup, fitOf({}));
    expect(r.votes).toHaveLength(1);
    expect(r.work).toBeNull();
    expect(r.reason).toBe("single-reader");
  });

  it("needs two models to name one work", () => {
    const x = copy("x", [reader("vision", top(first, true))], { vision: ["the first tower"] });
    const y = copy("y", [reader("qwen", top(second, true))], { qwen: ["the second tower"] });
    expect(poolGroup([x, y], lookup, fitOf({})).reason).toBe("readers-disagree");
  });

  it("leaves a copy unknown when its own reads contradict the work or none supports it", () => {
    const x = copy("x", [reader("vision", top(first, true)), reader("ppocr", top(first, true))], { vision: ["the first tower"], ppocr: ["the first tower"] });
    // y: a reader reads the second book strongly (series guard); z: no reader consistent with the work.
    const y = copy("y", [reader("vision", top(second, false, 0.9))], { vision: ["second"] });
    const z = copy("z", [reader("ppocr", { ...first, workId: "w7", title: "Other", score: 0.2, titleEvidence: 0.2, passes: false })], { ppocr: ["zz"] });
    const fit = fitOf({ "y|vision|w1": { score: 0.3, titleEvidence: 0.3 } });
    const r = poolGroup([viewOf(x), y, z], lookup, fit);
    expect(r.work?.workId).toBe("w1");
    expect(r.decisions.map((d) => d.blocked ?? d.basis)).toEqual(["confirmed-by-pooling", "reads-other-title", "no-consistent-reader"]);
  });

  it("does not pool a series pair into one work", () => {
    // Shared author, different works, confirmations hidden: each copy's own readers confirm its own book.
    const a = copy("a", [reader("vision", top(first, true)), reader("ppocr", top(first, true))], { vision: ["the first tower"], ppocr: ["first tower"] });
    const b = copy("b", [reader("vision", top(second, true)), reader("ppocr", top(second, true))], { vision: ["the second tower"], ppocr: ["second tower"] });
    const r = poolGroup([viewOf(a), viewOf(b)], lookup, fitOf({}));
    expect(r.decisions.filter((d) => d.basis === "confirmed-by-pooling").map((d) => d.workId)).not.toEqual(["w1", "w1"]);
    expect(r.decisions.filter((d) => d.basis && d.workId !== (d.id === "a" ? "w1" : "w2"))).toEqual([]);
  });
});

describe("views and bounds", () => {
  it("hides the confirmation and drops one reader model", () => {
    const c: PoolCopy = { ev: { id: "x", accepted: first, readers: [reader("vision", top(first, true)), reader("qwen", top(first, true))] }, texts: { vision: ["a"], qwen: ["b"] } };
    const v = viewOf(c, "qwen");
    expect(v.ev.accepted).toBeNull();
    expect(v.ev.readers.map((r) => r.reader)).toEqual(["vision"]);
    expect(Object.keys(v.texts)).toEqual(["vision"]);
    expect(selfDecides(c.ev)).toBe(true);
    expect(selfDecides(v.ev)).toBe(false);
  });

  it("orders a pooled reading: fused texts first, then each copy's own", () => {
    const pr = pooledReading([copy("x", [], { ppocr: ["the first"] }), copy("y", [], { ppocr: ["first tower"] })], "ppocr");
    expect(pr.fused).toBe(1);
    expect(pr.variants).toEqual(["the first tower", "the first", "first tower"]);
    expect(pr.sources).toEqual([["x", "y"], ["x"], ["y"]]);
  });

  it("gives Wilson upper bounds", () => {
    expect(wilsonUpper(0, 0)).toBeNull();
    expect(wilsonUpper(0, 20)!).toBeCloseTo(0.161, 2);
    expect(wilsonUpper(1, 100)!).toBeCloseTo(0.0545, 3);
  });
});
