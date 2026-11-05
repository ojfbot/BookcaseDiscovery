// DL-5: eval hygiene counts (src/eval/dl5.ts): work-level split leakage, copy groups across the split, yardstick reuse
// by card, and F-0's yardstick sample.
import { describe, expect, it } from "vitest";
import { blocks, leakage, ruleOfThree, yardstickParts, yardstickUse, type LeakRow } from "../src/eval/dl5.ts";

const row = (workId: string, split: string, img: string, over: Partial<LeakRow> = {}): LeakRow => ({ workId, split, imageSha256: img, strong: true, readers: ["vision", "ppocr"], ...over });

describe("work-level leakage", () => {
  const rows = [row("w1", "train", "a"), row("w1", "val", "c"), row("w2", "train", "a"), row("w3", "val", "c"), row("w4", "val", "d"), row("w4", "train", "b", { strong: false })];
  const split = (img: string) => ({ a: "train", b: "train", c: "val", d: "val" })[img];

  it("counts works on each side and in both", () => {
    const l = leakage(rows, [], split);
    expect(l.works).toEqual({ all: 4, trainOnly: 1, valOnly: 1, heldOutOnly: 0, inBoth: 2 });
    expect(l.labelsOnWorksInBoth).toEqual({ train: 2, val: 2 });
    expect(l.photos).toEqual({ train: 2, val: 2 });
  });

  it("counts only TS-2's own training targets for TS-2's leakage", () => {
    const l = leakage(rows, [], split);
    // w4's train label is not strong, so TS-2 never trains on it.
    expect(l.ts2).toEqual({ trainWorks: 2, valLabels: 3, valLabelsOnTrainWorks: 1, valWorksInTrain: 1 });
  });

  it("bounds copies in both by works in both, and finds a copy group straddling the split", () => {
    const groups = [
      { group: "g1", imageId: "a" },
      { group: "g1", imageId: "a" },
      { group: "g2", imageId: "a" },
      { group: "g2", imageId: "b" },
      { group: "g3", imageId: "b" },
      { group: "g3", imageId: "c" },
    ];
    expect(leakage(rows, groups, split).copies).toEqual({ groups: 3, groupsSpanningPhotos: 2, groupsStraddlingSplit: 1, copiesInBothAtMost: 2 });
  });
});

describe("yardstick reuse by card", () => {
  it("does not count a card whose scope says the yardstick is not used", () => {
    expect(yardstickUse({ card: "X", metrics: { scope: "real use; the yardstick is not used" }, text: "" }).use).toBe("not read");
  });

  it("reads a yardstick key or a PROXY scope as read", () => {
    expect(yardstickUse({ card: "X", metrics: { yardstick: { n: 1 } }, text: "" }).use).toBe("read");
    expect(yardstickUse({ card: "X", metrics: { sets: { y: { scope: "PROXY (library shelves): Library Dataset sample" } } }, text: "" }).use).toBe("read");
  });

  it("calls a boolean yardstick metric a gate", () => {
    expect(yardstickUse({ card: "X", metrics: { keep: { yardstickWrongNotUp: true } }, text: "" })).toEqual({ use: "gated", via: "boolean metric" });
  });

  it("calls a list item naming a keep condition on the yardstick a gate, but not a table row", () => {
    const m = { yardstick: { n: 1 } };
    expect(yardstickUse({ card: "X", metrics: m, text: "## Keep rule\n\n- **K2:** on the yardstick, wrong accepts do not\n  rise.\n" }).via).toBe("keep paragraph");
    expect(yardstickUse({ card: "X", metrics: m, text: "| K2 | yardstick | 22 |\n" }).use).toBe("read");
    expect(yardstickUse({ card: "X", metrics: m, text: "## Verdict\n\n- The invariant is broken: yardstick 9.3 %.\n" }).use).toBe("read");
  });

  it("splits text into paragraphs and list items", () => {
    expect(blocks("a\nb\n\n- c\n  d\n- e\n| t |\n# h\nf")).toEqual(["a b", "- c d", "- e", "f"]);
  });
});

describe("F-0's yardstick sample", () => {
  it("takes every step-th image from the middle of each stride, and leaves the stride starts as the smoke set", () => {
    const p = yardstickParts(388);
    expect(p.step).toBe(9);
    expect(p.sample).toHaveLength(40);
    expect(p.sample[0]).toBe(4);
    expect(p.smoke).toHaveLength(44);
    expect(p.sample.some((i) => p.smoke.includes(i))).toBe(false);
  });

  it("rule of three", () => {
    expect(ruleOfThree(300)).toBe(0.01);
    expect(ruleOfThree(0)).toBeNull();
  });
});
