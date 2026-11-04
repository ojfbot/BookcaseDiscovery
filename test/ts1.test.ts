// TS-1: the error-overlap statistics, third-reader outcomes, rarity and the recommendation rule. Synthetic records only.
import { describe, expect, it } from "vitest";
import type { ReaderName } from "../src/eval/f0.ts";
import { clusterBootstrap } from "../src/eval/q1.ts";
import {
  agreeingKey,
  fails,
  isDark,
  lift,
  overlaps,
  ownTitleForm,
  pairMeasures,
  pairTally,
  phi,
  rarityOf,
  shareOf,
  strata,
  tallyBootstrap,
  thirdOf,
  tierOf,
  TS1,
  wrongConf,
  wrongKindOf,
  yuleQ,
  type Box,
} from "../src/eval/ts1.ts";

const box = (o: Partial<Box> & { id: string }): Box => ({
  imageId: "p0",
  top: { vision: null, ppocr: null },
  confirmed: { vision: null, ppocr: null },
  accepted: null,
  agreeing: [],
  elevation: "level",
  dark: false,
  side: false,
  rarity: null,
  truth: new Set(["w1", "w2"]),
  ...o,
});
/** A box where each reader confirms (and tops) the given work; readers left out were not asked. */
const said = (id: string, imageId: string, works: Partial<Record<ReaderName, string | null>>, extra: Partial<Box> = {}): Box =>
  box({ id, imageId, top: { ...works }, confirmed: { ...works }, ...extra });

describe("2x2 statistics", () => {
  it("phi, Yule's Q and lift on a known table", () => {
    const t = { a: 10, b: 20, c: 30, d: 40 };
    expect(phi(t)).toBeCloseTo((10 * 40 - 20 * 30) / Math.sqrt(30 * 70 * 40 * 60), 10);
    expect(yuleQ(t)).toEqual({ q: (400 - 600) / (400 + 600), haldane: false });
    expect(lift(t)).toBeCloseTo(0.1 / (0.3 * 0.4), 10);
  });
  it("independent errors give phi 0 and lift 1", () => {
    const t = { a: 4, b: 16, c: 16, d: 64 };
    expect(phi(t)).toBeCloseTo(0, 10);
    expect(lift(t)).toBeCloseTo(1, 10);
    expect(yuleQ(t).q).toBeCloseTo(0, 10);
  });
  it("adds 0.5 to every cell when one is empty, and says so", () => {
    const q = yuleQ({ a: 0, b: 5, c: 5, d: 90 });
    expect(q.haldane).toBe(true);
    expect(q.q).toBeCloseTo((0.5 * 90.5 - 5.5 * 5.5) / (0.5 * 90.5 + 5.5 * 5.5), 10);
  });
  it("is undefined where a reader is never wrong", () => {
    expect(phi({ a: 0, b: 0, c: 3, d: 7 })).toBeNull();
    expect(lift({ a: 0, b: 0, c: 3, d: 7 })).toBeNull();
  });
});

describe("error events", () => {
  it("E is a confirmation outside the image's truth; F is anything but a right confirmation", () => {
    const b = said("x:0", "p0", { vision: "w1", ppocr: "w9" });
    expect(wrongConf(b, "vision")).toBe(false);
    expect(wrongConf(b, "ppocr")).toBe(true);
    expect(fails(b, "vision")).toBe(false);
    expect(fails(b, "ppocr")).toBe(true);
    const silent = said("x:1", "p0", { vision: null, ppocr: null });
    expect(wrongConf(silent, "vision")).toBe(false);
    expect(fails(silent, "vision")).toBe(true);
  });
});

describe("pair tally", () => {
  it("counts the cells, the same wrong work and the agreements over boxes both readers read", () => {
    const rows = [
      said("a:0", "p0", { vision: "w9", ppocr: "w9" }), // both wrong, same work
      said("a:1", "p0", { vision: "w8", ppocr: "w9" }), // both wrong, different works
      said("a:2", "p0", { vision: "w1", ppocr: "w9" }), // B only
      said("a:3", "p0", { vision: "w1", ppocr: "w1" }), // agree, right
      said("a:4", "p0", { vision: "w1" }), // PP-OCR not asked: left out
    ];
    const t = rows.map(pairTally("vision", "ppocr", "E")).reduce((s, x) => s.map((v, i) => v + x[i]!));
    expect(t).toEqual([4, 2, 0, 1, 1, 1, 2, 1]);
  });
  it("leaves out boxes Qwen was not sent", () => {
    const rows = [said("q:0", "p0", { vision: "w9", ppocr: "w9" }), said("q:1", "p0", { vision: "w9", ppocr: null, qwen: "w9" })];
    const t = rows.map(pairTally("vision", "qwen", "E")).reduce((s, x) => s.map((v, i) => v + x[i]!));
    expect(t[0]).toBe(1);
    expect(t[5]).toBe(1);
  });
});

describe("tallyBootstrap", () => {
  it("equals Q-1's clusterBootstrap on the pooled rows", () => {
    const rows: Box[] = [];
    for (let p = 0; p < 12; p++)
      for (let i = 0; i < 20; i++) rows.push(said(`p${p}:${i}`, `p${p}`, { vision: (i + p) % 4 === 0 ? "w9" : "w1", ppocr: (i * p) % 5 === 0 ? "w9" : "w1" }));
    const stat = (rs: Box[]) => {
      const t = rs.map(pairTally("vision", "ppocr", "E")).reduce((s, x) => s.map((v, i) => v + x[i]!));
      return phi({ a: t[1]!, b: t[2]!, c: t[3]!, d: t[4]! });
    };
    const ref = clusterBootstrap(rows, stat, 300, 7)!;
    const got = tallyBootstrap(rows, pairTally("vision", "ppocr", "E"), { phi: (t) => phi({ a: t[1]!, b: t[2]!, c: t[3]!, d: t[4]! }) }, 300, 7).phi!;
    expect(got.value).toBeCloseTo(ref.value, 12);
    expect(got.lo).toBeCloseTo(ref.lo, 12);
    expect(got.hi).toBeCloseTo(ref.hi, 12);
  });
  it("gives counts only under the cell minimum", () => {
    const rows = Array.from({ length: TS1.minCell - 1 }, (_, i) => said(`s:${i}`, `p${i % 3}`, { vision: "w9", ppocr: "w9" }));
    expect(pairMeasures(rows, "vision", "ppocr", "E").stats).toBeNull();
    expect(shareOf(rows, () => true, () => true)).toEqual({ n: TS1.minCell - 1, k: TS1.minCell - 1, share: null });
  });
});

describe("third reader", () => {
  const label = (o: Partial<Box>) => box({ id: "t:0", accepted: "w1", agreeing: ["vision", "qwen"], ...o });
  it("classifies the reader outside a two-reader agreement", () => {
    expect(thirdOf(label({ top: { vision: "w1", ppocr: "w7", qwen: "w1" }, confirmed: { vision: "w1", ppocr: "w7", qwen: "w1" } }))).toEqual({ reader: "ppocr", outcome: "dissents" });
    expect(thirdOf(label({ top: { vision: "w1", ppocr: "w7", qwen: "w1" }, confirmed: { vision: "w1", ppocr: null, qwen: "w1" } }))!.outcome).toBe("contradicts");
    expect(thirdOf(label({ top: { vision: "w1", ppocr: "w1", qwen: "w1" }, confirmed: { vision: "w1", ppocr: null, qwen: "w1" } }))!.outcome).toBe("supports");
    expect(thirdOf(label({ top: { vision: "w1", ppocr: null, qwen: "w1" }, confirmed: { vision: "w1", ppocr: null, qwen: "w1" } }))!.outcome).toBe("read-nothing");
    expect(thirdOf(box({ id: "t:1", accepted: "w1", agreeing: ["vision", "ppocr"], top: { vision: "w1", ppocr: "w1" } }))).toEqual({ reader: "qwen", outcome: "not-read" });
  });
  it("is null for unlabelled and three-reader boxes", () => {
    expect(thirdOf(box({ id: "t:2" }))).toBeNull();
    expect(thirdOf(box({ id: "t:3", accepted: "w1", agreeing: ["vision", "ppocr", "qwen"] }))).toBeNull();
  });
});

describe("labels, rarity and strata", () => {
  it("names the agreeing set in reader order", () => {
    expect(agreeingKey(["qwen", "vision"])).toBe("vision+qwen");
    expect(agreeingKey(["ppocr", "qwen", "vision"])).toBe("vision+ppocr+qwen");
    expect(agreeingKey(["vision"])).toBeNull();
  });
  it("takes the own title form and calls a shared or one-word title shared", () => {
    expect(ownTitleForm("V:other|T:the long road|W:x")).toBe("the long road");
    expect(ownTitleForm("V:other")).toBeNull();
    expect(rarityOf("the long road", 1)).toBe("distinctive");
    expect(rarityOf("the long road", 2)).toBe("shared");
    expect(rarityOf("dune", 1)).toBe("shared");
    expect(rarityOf(null, 0)).toBeNull();
  });
  it("says how a wrong label relates to the annotated books", () => {
    const annotated = [{ title: "the long road", surname: "smith" }, { title: "glass", surname: "jones" }];
    expect(wrongKindOf({ title: "the long road", surname: "smith" }, annotated)).toBe("same-book-other-record");
    expect(wrongKindOf({ title: "glass", surname: "brown" }, annotated)).toBe("namesake");
    expect(wrongKindOf({ title: "other", surname: "jones" }, annotated)).toBe("same-author");
    expect(wrongKindOf({ title: "other", surname: "brown" }, annotated)).toBe("unrelated");
    expect(wrongKindOf({ title: null, surname: "" }, [{ title: null, surname: "" }])).toBe("unrelated");
  });
  it("applies the dark bar on luma or contrast", () => {
    const bar = { luma: 50, contrast: 30 };
    expect(isDark(40, 80, bar)).toBe(true);
    expect(isDark(80, 20, bar)).toBe(true);
    expect(isDark(80, 80, bar)).toBe(false);
    expect(isDark(null, null, bar)).toBe(false);
  });
  it("splits boxes by every stratum", () => {
    const rows = [box({ id: "s:0", elevation: "below", dark: true }), box({ id: "s:1", side: true })];
    const s = strata(rows).map((x) => `${x.stratum}=${x.value}:${x.boxes.length}`);
    expect(s).toEqual(["elevation=below:1", "elevation=level:1", "dark or low contrast=dark/low:1", "dark or low contrast=not:1", "case=main:1", "case=side:1"]);
  });
});

describe("recommendation rule", () => {
  const iv = (value: number, lo: number, hi: number) => ({ value, lo, hi, draws: 2000 });
  it("tiers by wrong share, error overlap and dissent", () => {
    expect(tierOf(iv(0.03, 0.01, 0.08), 0.5, 0.06)).toBe("strong");
    expect(tierOf(iv(0.03, 0.01, 0.12), 0.5, null)).toBe("weak");
    expect(tierOf(iv(0.03, 0.01, 0.08), 1.4, null)).toBe("weak");
    expect(tierOf(iv(0.03, 0.01, 0.08), null, 0.2)).toBe("weak");
    expect(tierOf(iv(0.25, 0.1, 0.4), null, null)).toBe("exclude");
    expect(tierOf(null, null, null)).toBe("unmeasured");
  });
  it("calls overlapping intervals not separable", () => {
    expect(overlaps(iv(0.05, 0.01, 0.1), iv(0.12, 0.08, 0.2))).toBe(true);
    expect(overlaps(iv(0.05, 0.01, 0.07), iv(0.12, 0.08, 0.2))).toBe(false);
    expect(overlaps(null, iv(0.1, 0, 0.2))).toBe(false);
  });
});
