import { describe, expect, it } from "vitest";
import { associate, candidateOf, iou, NS10, pooled, tallyCase, tallyCandidates, verdictOf, type BoxFacts, type Footprint } from "../src/eval/ns10.ts";

const fp = (photo: string, i: number, u0: number, u1: number, lifted = true): Footprint => ({ id: `${photo}:${i}`, photo, lifted, u0, u1, v0: 0, v1: 1 });
const row = (photo: string, xs: number[], shift = 0): Footprint[] => xs.map((u, i) => fp(photo, i, u + shift, u + shift + 0.9));

describe("NS-10 association", () => {
  it("computes the intersection over union of two footprints", () => {
    expect(iou(fp("a", 0, 0, 1), fp("b", 0, 0, 1))).toBe(1);
    expect(iou(fp("a", 0, 0, 1), fp("b", 0, 1, 2))).toBe(0);
    expect(iou(fp("a", 0, 0, 2), fp("b", 0, 1, 3))).toBeCloseTo(1 / 3);
  });

  it("joins the same spines seen from two stills and leaves the unmatched ones alone", () => {
    const books = associate([...row("a", [0, 1, 2, 3]), ...row("b", [2.05, 3.05, 4.05])]);
    const joined = books.filter((b) => b.members.length === 2).map((b) => b.members.join("+")).sort();
    expect(joined).toEqual(["a:2+b:0", "a:3+b:1"]);
    expect(books).toHaveLength(5);
    expect(books.every((b) => b.photos.length === b.members.length)).toBe(true);
  });

  it("never puts two boxes of one still into one fused book", () => {
    // Two copies side by side in still a, both overlapping one box in still b, and one more in still c.
    const boxes = [fp("a", 0, 0, 1), fp("a", 1, 0.1, 1.1), fp("b", 0, 0.05, 1.05), fp("c", 0, 0.05, 1.05)];
    for (const b of associate(boxes)) expect(new Set(b.photos).size).toBe(b.photos.length);
  });

  it("keeps two copies in one still as two books across two views", () => {
    const a = [fp("a", 0, 0, 1), fp("a", 1, 1, 2)];
    const b = [fp("b", 0, 0.02, 1.02), fp("b", 1, 1.02, 2.02)];
    const books = associate([...a, ...b]);
    expect(books).toHaveLength(2);
    expect(books.map((x) => x.members.join("+")).sort()).toEqual(["a:0+b:0", "a:1+b:1"]);
  });

  it("drops a tie it cannot resolve, and resolves it by reading agreement when exactly one agrees", () => {
    const boxes = [fp("a", 0, 0, 1), fp("b", 0, 0, 1), fp("b", 1, 0.01, 1.01)];
    expect(associate(boxes).every((x) => x.members.length === 1)).toBe(true);
    const resolved = associate(boxes, (x, y) => x === "a:0" && y === "b:1" || x === "b:1" && y === "a:0");
    expect(resolved.find((x) => x.members.length === 2)!.members).toEqual(["a:0", "b:1"]);
    expect(resolved.find((x) => x.members.length === 2)!.tieBroken).toBe(true);
  });

  it("does not join boxes that are not mutual best matches", () => {
    // a:0 overlaps b:0 at 0.6, but b:0 overlaps a:1 more.
    const boxes = [fp("a", 0, 0, 1), fp("a", 1, 0.6, 1.6), fp("b", 0, 0.7, 1.7)];
    const books = associate(boxes);
    expect(books.find((x) => x.members.includes("b:0"))!.members).toEqual(["a:1", "b:0"]);
  });

  it("ignores boxes the teacher could not lift", () => {
    const books = associate([fp("a", 0, 0, 1), fp("b", 0, 0, 1, false)]);
    expect(books).toHaveLength(2);
  });
});

describe("NS-10 candidates", () => {
  const book = (members: string[]) => ({ members, photos: members.map((m) => m.split(":")[0]!), tieBroken: false });
  it("needs readers from two different stills", () => {
    expect(candidateOf(book(["a:0", "b:0"]), new Map([["a:0", ["w1"]], ["b:0", ["w1"]]]))?.workId).toBe("w1");
    expect(candidateOf(book(["a:0", "b:0"]), new Map([["a:0", ["w1"]]]))).toBeNull();
    expect(candidateOf(book(["a:0", "b:0"]), new Map([["a:0", ["w1"]], ["b:0", ["w2"]]]))).toBeNull();
  });
  it("marks a conflict and refuses an ambiguous tie", () => {
    const c = candidateOf(book(["a:0", "b:0", "c:0"]), new Map([["a:0", ["w1"]], ["b:0", ["w1"]], ["c:0", ["w2"]]]));
    expect(c).toMatchObject({ workId: "w1", views: 2, conflict: true, labelSource: "multiview-fusion", rgbRecoverable: "yes" });
    expect(candidateOf(book(["a:0", "b:0", "c:0", "d:0"]), new Map([["a:0", ["w1"]], ["b:0", ["w1"]], ["c:0", ["w2"]], ["d:0", ["w2"]]]))).toBeNull();
  });
});

describe("NS-10 measures", () => {
  const facts = (id: string, o: Partial<BoxFacts> = {}): BoxFacts => ({ id, photo: id.split(":")[0]!, singleReader: false, frameEdge: false, works: [], copyGroup: null, ...o });
  it("counts gains, conflicts, frame-edge reads and copy safety", () => {
    const boxes = [
      facts("a:0", { singleReader: true, works: ["w1"] }), facts("b:0", { works: ["w1"] }),
      facts("a:1", { singleReader: true, works: ["w2"] }), facts("b:1", { works: ["w3"] }),
      facts("a:2", { frameEdge: true }), facts("b:2", { works: ["w4"] }),
      facts("a:3", { copyGroup: "a:0", works: ["w5"] }), facts("a:4", { copyGroup: "a:0", works: ["w5"] }), facts("b:3", { works: ["w5"] }),
    ];
    const books = [
      { members: ["a:0", "b:0"], photos: ["a", "b"], tieBroken: false }, { members: ["a:1", "b:1"], photos: ["a", "b"], tieBroken: false },
      { members: ["a:2", "b:2"], photos: ["a", "b"], tieBroken: false }, { members: ["a:3", "b:3"], photos: ["a", "b"], tieBroken: true },
      { members: ["a:4"], photos: ["a"], tieBroken: false },
    ];
    const t = tallyCase("c1", boxes, books, new Set(boxes.map((b) => b.id)));
    expect(t).toMatchObject({ singleReader: 2, singleReaderJoined: 2, gain: 1, conflict: 1, frameEdge: 1, frameEdgeReadElsewhere: 1, copyBooksSameStill: 0, copyBooksSameGroup: 0, copyExposure: 1, copyExposureTied: 1, pairsRead: 3, pairsSame: 2 });
    tallyCandidates(t, []);
    expect(t.candidates).toBe(0);
  });
  it("reports a merge of two boxes of one copy group as a copy-safety failure", () => {
    const boxes = [facts("a:0", { copyGroup: "a:0" }), facts("a:1", { copyGroup: "a:0" })];
    const t = tallyCase("c", boxes, [{ members: ["a:0", "a:1"], photos: ["a"], tieBroken: false }], new Set(["a:0", "a:1"]));
    expect(t.copyBooksSameStill).toBe(1);
    expect(t.copyBooksSameGroup).toBe(1);
  });
  it("pools ratios over cases with a case-level bootstrap, none under the floor", () => {
    const mk = (n: number, d: number) => ({ singleReader: d, gain: n }) as never;
    const six = [mk(1, 4), mk(2, 5), mk(1, 3), mk(2, 6), mk(1, 2), mk(3, 8)];
    const r = pooled(six, (t) => t.gain, (t) => t.singleReader);
    expect(r.value).toBeCloseTo(10 / 28);
    expect(r.interval!.lo).toBeGreaterThan(0);
    expect(pooled(six, (t) => t.gain, (t) => t.singleReader, 200).interval).not.toBeNull();
    expect(pooled(six.slice(0, 4), (t) => t.gain, (t) => t.singleReader).interval).toBeNull();
    expect(pooled(six, (t) => t.gain, (t) => t.singleReader).interval).toEqual(pooled(six, (t) => t.gain, (t) => t.singleReader).interval); // seeded
  });
  it("applies the verdict in the pre-registered order", () => {
    const g = { value: 0.2, interval: { lo: 0.05, hi: 0.3 } };
    expect(verdictOf({ copyBooks: 1, poseSuccessGroups: 6, gain: g, precision: 0.95 }).verdict).toBe("fails");
    expect(verdictOf({ copyBooks: 0, poseSuccessGroups: 3, gain: g, precision: 0.95 }).verdict).toBe("fails");
    expect(verdictOf({ copyBooks: 0, poseSuccessGroups: 6, gain: { value: 0.1, interval: { lo: 0, hi: 0.3 } }, precision: 0.95 }).verdict).toBe("not-shown");
    expect(verdictOf({ copyBooks: 0, poseSuccessGroups: 6, gain: g, precision: NS10.precisionFloor - 0.01 }).verdict).toBe("not-shown");
    expect(verdictOf({ copyBooks: 0, poseSuccessGroups: 6, gain: g, precision: 0.9 }).verdict).toBe("keep");
  });
});
