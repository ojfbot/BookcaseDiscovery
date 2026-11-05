// TS-2: the distilled spine reader's harness (src/eval/ts2.ts): the training filter (strong class, train split, OC35,
// OC36), the trained rotation, the steering candidates, the arms' votes, the keep rule and the val agreement.
import { describe, expect, it } from "vitest";
import type { Candidate } from "../src/catalog/retrieve.ts";
import type { LabelRow } from "../src/eval/ts0.ts";
import {
  agreement,
  armAccept,
  armMeasures,
  bestRotation,
  decisionRelevant,
  keeps,
  outcomeOf,
  secondsPerCrop,
  steerCandidates,
  studentConfirms,
  targetText,
  trainRows,
  TS2,
  type ArmRow,
  type BaseBox,
} from "../src/eval/ts2.ts";

const row = (over: Partial<LabelRow> = {}): LabelRow =>
  ({
    set: "pilot-000",
    boxId: "img:1",
    imageSha256: "img",
    workId: "w1",
    title: "A Title",
    authors: ["An Author"],
    basis: "readers-agree",
    readers: ["vision", "ppocr"],
    strong: true,
    split: "train",
    ...over,
  }) as LabelRow;

describe("trainRows", () => {
  it("keeps strong train rows only and counts the rest", () => {
    const { rows, excluded } = trainRows([
      row(),
      row({ split: "val" }),
      row({ strong: false }),
      row({ basis: "confirmed-by-context", readers: ["vision"], strong: false }),
    ]);
    expect(rows).toHaveLength(1);
    expect(excluded).toEqual({ "val-split": 1, "not-strong": 1, "one-reader": 1 });
  });

  it("never trains on the val split, even a strong row", () => {
    expect(trainRows([row({ split: "val", strong: true })]).rows).toEqual([]);
  });

  it("throws on a yardstick, PROXY or audit set (OC35) instead of filtering it", () => {
    expect(() => trainRows([row({ set: "yardstick" })])).toThrow(/OC35/);
    expect(() => trainRows([row({ set: "pilot-000-audit" })])).toThrow(/OC35/);
    expect(() => trainRows([row({ set: "library-proxy" })])).toThrow(/OC35/);
  });

  it("throws on a hand label or any basis that is not a shipped machine basis (OC36)", () => {
    expect(() => trainRows([row({ basis: "owner-correction" as LabelRow["basis"] })])).toThrow(/OC36/);
  });
});

describe("targetText and bestRotation", () => {
  it("writes the work as title, newline, authors", () => {
    expect(targetText({ title: " The  Book ", authors: ["A. One", "B  Two"] })).toBe("The Book\nA. One, B Two");
    expect(targetText({ title: "Solo", authors: [] })).toBe("Solo");
  });

  it("trains at the rotation whose readers' text scores the work higher, none when neither scores", () => {
    expect(bestRotation([{ rotation: 90, score: 0.4 }, { rotation: 270, score: 0.9 }])).toBe(270);
    expect(bestRotation([{ rotation: 90, score: 0.5 }, { rotation: 270, score: 0.5 }])).toBe(90);
    expect(bestRotation([{ rotation: 90, score: 0 }, { rotation: 270, score: 0 }])).toBeNull();
  });
});

const cand = (workId: string, score: number, over: Partial<Candidate> = {}): Candidate =>
  ({ workId, title: workId, authors: [], score, queryCoverage: 1, evidence: [{ field: "title", score: 1 }], ...over }) as Candidate;

describe("steerCandidates", () => {
  it("merges the source readers' lists by best score per work and keeps the top k", () => {
    const got = steerCandidates([[cand("a", 0.5), cand("b", 0.9)], [cand("a", 0.8), cand("c", 0.1)]], 2);
    expect(got.map((c) => [c.workId, c.score])).toEqual([
      ["b", 0.9],
      ["a", 0.8],
    ]);
  });

  it("gives nothing when no reader read text (the student decodes free)", () => {
    expect(steerCandidates([[], []])).toEqual([]);
  });
});

describe("studentConfirms", () => {
  it("holds the student to F-0's bar unchanged", () => {
    expect(studentConfirms(cand("w", 0.9))).toBe("w");
    expect(studentConfirms(cand("w", 0.71))).toBeNull();
    expect(studentConfirms(cand("w", 0.9, { queryCoverage: 0.4 }))).toBeNull();
    expect(studentConfirms(undefined)).toBeNull();
  });
});

const base = (confirmed: BaseBox["confirmed"], accepted: string | null = null): BaseBox => ({
  id: "img:1",
  imageId: "img",
  confirmed,
  readText: Object.fromEntries(Object.keys(confirmed).map((k) => [k, true])),
  accepted,
});

describe("decisionRelevant", () => {
  it("is the set of boxes where some cached reader confirmed a work", () => {
    expect(decisionRelevant(base({ vision: "w", ppocr: null }))).toBe(true);
    expect(decisionRelevant(base({ vision: null, ppocr: null, qwen: null }))).toBe(false);
  });
});

describe("armAccept", () => {
  const s = (confirmed: string | null) => ({ confirmed, readText: true });

  it("base is F-0's own vote", () => {
    expect(armAccept("base", base({ vision: "w", ppocr: "w" }, "w"), undefined, false)).toBe("w");
  });

  it("fourth: the student turns a single-reader box into an accept when it confirms the same work", () => {
    expect(armAccept("fourth", base({ vision: "w", ppocr: null }), s("w"), false)).toBe("w");
    expect(armAccept("fourth", base({ vision: "w", ppocr: null }), s("x"), false)).toBeNull();
  });

  it("fourth: a student vote can tie an accepted box into unknown", () => {
    expect(armAccept("fourth", base({ vision: "w", ppocr: "w", qwen: "x" }, "w"), s("x"), true)).toBeNull();
  });

  it("replace: Qwen's votes are dropped, and the student votes only where Qwen read", () => {
    const b = base({ vision: "w", ppocr: null, qwen: "w" }, "w");
    expect(armAccept("replace", b, undefined, true)).toBeNull();
    expect(armAccept("replace", b, s("w"), true)).toBe("w");
    expect(armAccept("replace", base({ vision: "w", ppocr: null }), s("w"), false)).toBeNull();
    expect(TS2.replaces).toBe("qwen");
  });
});

describe("measures and the keep rule", () => {
  const ar = (imageId: string, b: string | null, f: string | null, r: string | null, truth: string[]): ArmRow => ({
    id: `${imageId}:${Math.random()}`,
    imageId,
    accepted: { base: b, fourth: f, replace: r },
    truth: new Set(truth),
  });

  it("scores an accept as confirmed when the work is annotated in the photo, else wrong", () => {
    expect(outcomeOf("w", new Set(["w"]))).toBe("confirmed");
    expect(outcomeOf("w", new Set(["x"]))).toBe("wrong");
    expect(outcomeOf(null, new Set(["w"]))).toBe("none");
    expect(outcomeOf("w", undefined)).toBe("confirmed");
  });

  it("keeps an arm only when confirmed rises with its interval above 0 and wrong does not rise", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ar(`p${i}`, null, "w", null, ["w"]));
    const m = armMeasures(rows, 200, 1);
    expect(m.fourth.confirmed).toBe(10);
    expect(m.fourth.deltaConfirmed!.lo).toBeGreaterThan(0);
    expect(keeps(m, "fourth").keep).toBe(true);
    expect(keeps(m, "replace").keep).toBe(false);
    const withWrong = armMeasures([...rows, ar("p0", null, "x", null, ["w"])], 200, 1);
    expect(keeps(withWrong, "fourth")).toMatchObject({ confirmedUp: true, wrongNotUp: false, keep: false });
  });

  it("does not keep a gain whose interval reaches 0", () => {
    const rows = [ar("p0", null, "w", null, ["w"]), ...Array.from({ length: 9 }, (_, i) => ar(`q${i}`, null, null, null, []))];
    expect(keeps(armMeasures(rows, 500, 1), "fourth").keep).toBe(false);
  });
});

describe("agreement (pilot-000 val, machine agreement)", () => {
  it("counts the labels whose work the student confirms, all and strong apart", () => {
    const a = agreement(
      [
        { imageId: "a", workId: "w1", strong: true, student: "w1", read: true },
        { imageId: "a", workId: "w2", strong: false, student: "x", read: true },
        { imageId: "b", workId: "w3", strong: true, student: null, read: true },
      ],
      100,
      1,
    );
    expect(a.all).toMatchObject({ labels: 3, photos: 2, agree: 1, otherWork: 1, noConfirm: 1 });
    expect(a.strong).toMatchObject({ labels: 2, agree: 1 });
    expect(a.strong.share!.value).toBe(0.5);
  });
});

describe("secondsPerCrop", () => {
  it("is the mean with an interval around it", () => {
    const t = secondsPerCrop([1, 2, 3], 200, 1)!;
    expect(t.value).toBe(2);
    expect(t.lo).toBeLessThanOrEqual(2);
    expect(t.hi).toBeGreaterThanOrEqual(2);
    expect(secondsPerCrop([])).toBeNull();
  });
});
