import { describe, expect, it } from "vitest";
import { auc } from "../src/eval/q1.ts";
import {
  APPEARANCE_DEFAULT,
  appearanceMode,
  assertOneRecordPerCopy,
  assertSeparated,
  boxSetHash,
  bySim,
  embedDir,
  isEvaluationOnly,
  lookalikeRate,
  MmRecord,
  modelRevision,
  pairBootstrap,
  pairSets,
  recordsVersion,
  shareAbove,
  stripKey,
  weightedAuc,
  weightedMean,
  weightedMedian,
  type Box,
  type Pair,
} from "../src/eval/mm1.ts";

const H = "a".repeat(64);
const poly: [number, number][] = [[0, 0], [10, 0], [10, 100], [0, 100]];
const unit = (n: number) => new Float64Array(n).fill(1);
const pr = (s: number, a = 0, b = a): Pair => ({ s, a, b });

describe("the appearance switch", () => {
  it("is off by default and nothing else", () => {
    expect(APPEARANCE_DEFAULT).toBe("off");
    expect(appearanceMode([])).toBe("off");
    expect(appearanceMode(["node", "x", "--appearance", "shadow"])).toBe("shadow");
  });
  it("refuses an unknown mode rather than defaulting", () => {
    expect(() => appearanceMode(["--appearance", "confirm"])).toThrow(/expected one of/);
    expect(() => appearanceMode(["--appearance"])).toThrow();
  });
});

describe("keys (INV-14)", () => {
  it("a strip key follows the box and its polygon, not the models", () => {
    const k = stripKey("img:3", poly);
    expect(k).toMatch(/^[0-9a-f]{24}$/);
    expect(stripKey("img:3", poly)).toBe(k);
    expect(stripKey("img:4", poly)).not.toBe(k);
    expect(stripKey("img:3", [[0, 0], [11, 0], [11, 100], [0, 100]])).not.toBe(k);
  });
  it("an embedding folder changes with the revision", () => {
    expect(embedDir("dinov2", "1".repeat(40))).toMatch(/^dinov2@[0-9a-f]{12}$/);
    expect(embedDir("dinov2", "1".repeat(40))).not.toBe(embedDir("dinov2", "2".repeat(40)));
  });
  it("the box set ignores order; the version follows box set and revision", () => {
    const a = { id: "x:0", polygon: poly, outline: null }, b = { id: "x:1", polygon: poly, outline: null };
    expect(boxSetHash("pilot-000", [a, b])).toBe(boxSetHash("pilot-000", [b, a]));
    expect(boxSetHash("pilot-000", [a])).not.toBe(boxSetHash("pilot-000", [a, b]));
    const r1 = modelRevision({ dinov2: "1".repeat(40), siglip2: "2".repeat(40) }, "h");
    const r2 = modelRevision({ dinov2: "1".repeat(40), siglip2: "3".repeat(40) }, "h");
    expect(r1).not.toBe(r2);
    expect(recordsVersion(H, r1)).toMatch(/^mm-[0-9a-f]{12}$/);
    expect(recordsVersion(H, r1)).toBe(recordsVersion(H, r1));
    expect(recordsVersion(H, r1)).not.toBe(recordsVersion(H, r2));
  });
});

const record = (boxId: string, set = "pilot-000") => ({
  schemaVersion: "mm1/1",
  version: "mm-0123456789ab",
  key: { boxId, boxSet: H, modelRevision: H },
  set,
  evaluationOnly: isEvaluationOnly(set),
  readings: { vision: { crop: "c", variants: [{ rotation: 0, text: "t", confidence: 1 }] } },
  basis: "readers-agree",
  workId: "w1",
  readers: ["vision", "ppocr"],
  conflict: false,
  copyOf: null,
  rung: "confirmed",
  ledger: null,
  strip: { key: "0".repeat(24), path: "strips/x.png", size: [10, 100], valid: true },
  embeddings: { dinov2: { path: "emb/d/x.f32", dims: 768, revision: "r" }, siglip2: { path: "emb/s/x.f32", dims: 768, revision: "r" } },
});

describe("records", () => {
  it("parse strictly", () => {
    expect(MmRecord.parse(record("x:0")).key.boxId).toBe("x:0");
    expect(() => MmRecord.parse({ ...record("x:0"), title: "no" })).toThrow();
    expect(() => MmRecord.parse({ ...record("x:0"), basis: "confirmed-by-appearance" })).toThrow();
  });
  it("one record per copy (INV-4)", () => {
    expect(() => assertOneRecordPerCopy([record("x:0"), record("x:1")])).not.toThrow();
    expect(() => assertOneRecordPerCopy([record("x:0"), record("x:0")])).toThrow(/INV-4/);
  });
  it("sets are never pooled and the yardstick is evaluation-only (OC35)", () => {
    expect(isEvaluationOnly("yardstick")).toBe(true);
    expect(isEvaluationOnly("pilot-000")).toBe(false);
    expect(() => assertSeparated("pilot-000", [record("x:0"), record("y:0", "yardstick")])).toThrow(/never pooled/);
    expect(() => assertSeparated("yardstick", [{ ...record("y:0", "yardstick"), evaluationOnly: false }])).toThrow(/evaluation-only/);
    expect(() => assertSeparated("yardstick", [record("y:0", "yardstick")])).not.toThrow();
  });
});

describe("pairSets", () => {
  const box = (id: string, photo: number, workId: string | null, basis: Box["basis"] = workId ? "readers-agree" : null, copyOf: string | null = null, valid = true): Box => ({ id, photo, basis, workId, copyOf, valid });
  const boxes = [
    box("p:0", 0, "w1"),
    box("p:1", 0, "w1", "confirmed-by-copy", "p:0"),
    box("p:2", 0, "w2"),
    box("p:3", 0, null),
    box("q:0", 1, "w1"),
    box("q:1", 1, "w3", "readers-agree", null, false),
  ];
  const ps = pairSets(boxes, (i, j) => i * 10 + j);
  it("copy pairs come from F-0g's `from`", () => expect(ps.copy).toEqual([{ s: 10, a: 0, b: 0 }]));
  it("the same-photo control leaves same-work pairs out", () => expect(ps.samePhoto.map((p) => p.s).sort((a, b) => a - b)).toEqual([2, 3, 12, 13, 23]));
  it("same-work pairs by basis, different-work pairs, invalid strips dropped", () => {
    expect(ps.sameWork.map((p) => p.s).sort((a, b) => a - b)).toEqual([1, 4, 14]);
    expect(ps.sameWorkText.map((p) => p.s).sort((a, b) => a - b)).toEqual([4]);
    expect(ps.differentWork.map((p) => p.s).sort((a, b) => a - b)).toEqual([2, 12, 24]);
    expect(ps.sameWork.find((p) => p.s === 4)).toEqual({ s: 4, a: 0, b: 1 });
  });
});

describe("weighted statistics", () => {
  const pos = bySim([pr(0.9), pr(0.7), pr(0.5, 0, 1), pr(0.5)]);
  const neg = bySim([pr(0.1), pr(0.5, 1), pr(0.6, 0, 1), pr(0.2, 1), pr(0.95)]);
  it("unit weights give the plain Mann-Whitney AUC", () => {
    expect(weightedAuc(pos, neg, unit(2))).toBeCloseTo(auc(pos.map((p) => p.s), neg.map((p) => p.s))!, 12);
  });
  it("a photo drawn twice counts its pairs as if duplicated", () => {
    // photo 1 twice: pairs in photo 1 weigh 2, pairs across photos 0 and 1 weigh 2.
    const dup = (xs: Pair[]) => xs.flatMap((p) => (p.a === 1 || p.b === 1 ? [p, p] : [p]));
    expect(weightedAuc(pos, neg, [1, 2])).toBeCloseTo(auc(dup(pos).map((p) => p.s), dup(neg).map((p) => p.s))!, 12);
    expect(weightedMean(neg, [1, 2])).toBeCloseTo(dup(neg).reduce((s, p) => s + p.s, 0) / dup(neg).length, 12);
  });
  it("a photo drawn zero times drops its pairs", () => {
    expect(weightedMean(neg, [1, 0])).toBeCloseTo((0.1 + 0.95) / 2, 12);
    expect(weightedAuc(pos, [pr(0.6, 0, 1)], [1, 0])).toBeNull();
  });
  it("median, share above and the lookalike rate", () => {
    expect(weightedMedian(bySim([pr(0.1), pr(0.3), pr(0.8)]), unit(1))).toBe(0.3);
    expect(weightedMedian(bySim([pr(0.1), pr(0.3, 1), pr(0.8)]), [1, 3])).toBe(0.3);
    expect(weightedMedian([], unit(1))).toBeNull();
    expect(shareAbove(neg, 0.5, unit(2))).toBeCloseTo(2 / 5, 12);
    // median same-work 0.5 (sorted 0.5, 0.5, 0.7, 0.9: half the weight is reached at the second 0.5)
    expect(lookalikeRate(pos, neg, unit(2))).toBeCloseTo(2 / 5, 12);
    expect(lookalikeRate([], neg, unit(2))).toBeNull();
  });
});

describe("pairBootstrap", () => {
  const pairs = bySim(Array.from({ length: 60 }, (_, k) => pr((k * 37) % 100 / 100, k % 6, (k * 5) % 6)));
  it("is deterministic and brackets its point value", () => {
    const a = pairBootstrap(6, (w) => weightedMean(pairs, w), 300, 7)!;
    const b = pairBootstrap(6, (w) => weightedMean(pairs, w), 300, 7)!;
    expect(a).toEqual(b);
    expect(a.lo).toBeLessThanOrEqual(a.value);
    expect(a.hi).toBeGreaterThanOrEqual(a.value);
    expect(a.value).toBeCloseTo(weightedMean(pairs, unit(6))!, 12);
  });
  it("is null when the statistic is undefined", () => expect(pairBootstrap(3, () => null, 10)).toBeNull());
});
