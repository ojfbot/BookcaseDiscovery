import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rng } from "../src/eval/q1.ts";
import {
  aucOf,
  brier,
  chooseFillP,
  chooseTau,
  derangement,
  ece,
  excludesZero,
  filled,
  fitMonotone,
  heightOffBand,
  leaveOneImageOut,
  operatingPoints,
  pairedBootstrap,
  predictMonotone,
  readerAgreement,
  reliability,
  squash,
  stringSimilarity,
  substringDistance,
  teacherRung,
  topClass,
} from "../src/eval/q2.ts";
import type { Feature, Scored } from "../src/eval/q2.ts";
import { fragmentOf, shortSide } from "../src/eval/q2-cli.ts";
import { png } from "./helpers/synth.ts";

describe("teacher rung", () => {
  const d = (reason: "no-text" | "no-catalog-match" | "single-reader" | "readers-disagree" | null, accepted: unknown = null) => ({ accepted, reason });

  it("maps F-0 decisions onto the ladder, with τ deciding text-read inside no-catalog-match", () => {
    expect(teacherRung(d(null, { workId: "isfdb:1" }), null, 0.7)).toBe("confirmed");
    expect(teacherRung(d("single-reader"), null, 0.7)).toBe("matched");
    expect(teacherRung(d("readers-disagree"), 0.1, 0.7)).toBe("matched");
    expect(teacherRung(d("no-catalog-match"), 0.7, 0.7)).toBe("text-read");
    expect(teacherRung(d("no-catalog-match"), 0.69, 0.7)).toBe("text-present");
    expect(teacherRung(d("no-catalog-match"), null, 0.7)).toBe("text-present");
    expect(teacherRung(d("no-text"), null, 0.7)).toBe("spine-found");
    expect(() => teacherRung(d(null), null, 0.7)).toThrow();
  });

  it("fills from text-read up", () => {
    expect(["spine-found", "text-present", "text-read", "matched", "confirmed"].map((r) => filled(r as never))).toEqual([false, false, true, true, true]);
  });
});

describe("string agreement", () => {
  it("measures the shorter reading against its closest substring of the longer", () => {
    expect(substringDistance("dune", "frankherbertdune")).toBe(0);
    expect(substringDistance("dvne", "frankherbertdune")).toBe(1);
    expect(substringDistance("abc", "")).toBe(3);
    expect(stringSimilarity("foundation", "isaacasimovfoundation")).toBe(1);
    expect(stringSimilarity("foundatlon", "foundation")).toBeCloseTo(0.9);
  });

  it("never lets very short readings agree", () => {
    expect(stringSimilarity("dune", "dune")).toBe(0);
    expect(stringSimilarity("dunes", "dunes")).toBe(1);
  });

  it("squashes with the catalog's normalisation, spaces dropped", () => {
    expect(squash("Ender's  GAME")).toBe("endersgame");
    expect(squash("J. R. R. Tolkien")).toBe("jrrtolkien");
  });

  it("takes the best pair of different readers, and compares across boxes for the null", () => {
    const a = { vision: ["foundation", "noitadnuof"], ppocr: ["foundatlon"], qwen: [] };
    expect(readerAgreement(a)).toBeCloseTo(0.9);
    expect(readerAgreement({ vision: ["foundation"] })).toBeNull();
    // Same reader on two boxes is not a pair; different readers are.
    expect(readerAgreement({ vision: ["foundation"] }, { vision: ["foundation"] })).toBeNull();
    expect(readerAgreement({ vision: ["foundation"] }, { ppocr: ["neuromancer"] })).toBeLessThan(0.5);
  });

  it("sets τ where the null pairing passes at most the allowed share", () => {
    const nullSims = [...new Array<number>(95).fill(0.3), 0.6, 0.65, 0.7, 0.8, 0.95];
    expect(chooseTau(nullSims, 0.02)).toBe(0.71);
    expect(chooseTau(nullSims, 0.05)).toBe(0.5);
    expect(chooseTau([1, 1, 1], 0.01)).toBe(1);
  });

  it("derangements move every index and are permutations", () => {
    const rand = rng(3);
    for (const n of [2, 3, 7, 50]) {
      const p = derangement(n, rand);
      expect([...p].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
      p.forEach((j, i) => expect(j).not.toBe(i));
    }
    expect(derangement(1, rand)).toEqual([]);
  });
});

describe("monotone student", () => {
  // y rises with a and falls with b; c is noise.
  const r = rng(9);
  const xs = Array.from({ length: 600 }, () => [Math.floor(r() * 100), Math.floor(r() * 100), Math.floor(r() * 7)]);
  const ys = xs.map(([a, b]) => (a! - b! > 0 ? 1 : 0));

  it("keeps features whose weights point the declared way", () => {
    const m = fitMonotone(xs, ys, ["a", "b", "c"], [1, -1, 0]);
    expect(m.dropped).toEqual([]);
    expect(predictMonotone(m, [90, 10, 3])).toBeGreaterThan(0.9);
  });

  it("drops a feature whose weight comes out against its declared sign, and refits", () => {
    const m = fitMonotone(xs.map((x) => [x[0]!, x[1]!]), ys, ["a", "b"], [1, 1]);
    expect(m.dropped).toEqual(["b"]);
    expect(m.active).toEqual([0]);
    expect(predictMonotone(m, [90, 10])).toBeGreaterThan(predictMonotone(m, [10, 10]));
  });

  it("falls back to the base rate when every feature is dropped", () => {
    const m = fitMonotone(xs.map((x) => [x[1]!]), ys, ["b"], [1]);
    expect(m.model).toBeNull();
    expect(predictMonotone(m, [0])).toBeCloseTo(ys.filter(Boolean).length / ys.length);
  });

  it("scores each photo with a model fitted without it", () => {
    const rows = xs.map((x, i) => ({ imageId: `p${i % 6}`, x, y: ys[i]! }));
    const feats: Feature<(typeof rows)[number]>[] = [{ name: "a", sign: 1, of: (r) => r.x[0]! }];
    const { p, folds } = leaveOneImageOut(rows, (r) => r.y, feats);
    expect(folds.map((f) => f.imageId)).toEqual(["p0", "p1", "p2", "p3", "p4", "p5"]);
    expect(p.every(Number.isFinite)).toBe(true);
    expect(p[rows.findIndex((r) => r.x[0] === 95)]!).toBeGreaterThan(0.5);
  });
});

describe("scoring", () => {
  const rows: Scored[] = [];
  for (let k = 0; k < 8; k++)
    for (let i = 0; i < 40; i++) {
      const p = (i + 0.5) / 40;
      rows.push({ imageId: `p${k}`, y: i % 40 < p * 40 && (i * 7 + k) % 10 < p * 10 ? 1 : 0, s: { good: p, flat: 0.5, perfect: 0 } });
    }
  for (const r of rows) r.s.perfect = r.y;

  it("AUC, Brier, reliability and ECE", () => {
    expect(aucOf(rows, "perfect")).toBe(1);
    expect(aucOf(rows, "flat")).toBe(0.5);
    expect(brier(rows, "perfect")).toBe(0);
    const rel = reliability(rows, "good");
    expect(rel).toHaveLength(10);
    expect(rel.reduce((a, b) => a + b.n, 0)).toBe(rows.length);
    expect(rel[0]!.lo).toBe(0);
    expect(rel[9]!.hi).toBe(1);
    expect(ece(rows, "perfect")).toBe(0);
    expect(ece([{ imageId: "a", y: 0, s: { m: 0.8 } }, { imageId: "a", y: 1, s: { m: 0.8 } }], "m")).toBeCloseTo(0.3);
  });

  it("the paired bootstrap is deterministic and its ΔAUC interval excludes 0 for a real gain", () => {
    const stats = { d: (r: Scored[]) => aucOf(r, "good")! - aucOf(r, "flat")!, a: (r: Scored[]) => aucOf(r, "good") };
    const a = pairedBootstrap(rows, stats, 200, 5), b = pairedBootstrap(rows, stats, 200, 5);
    expect(a).toEqual(b);
    expect(excludesZero(a.d!)).toBe(true);
    expect(excludesZero([0.01, -0.01, 0.03])).toBe(false);
    expect(excludesZero([-0.02, -0.03, -0.01])).toBe(true);
    expect(a.a![1]).toBeLessThanOrEqual(a.a![0]);
  });

  it("operating points and FILL_P take the lowest threshold that reaches the precision target", () => {
    const ops = operatingPoints(rows, "good", [0.2, 0.5, 0.8]);
    expect(ops.map((o) => o.fillP)).toEqual([0.2, 0.5, 0.8]);
    expect(ops[0]!.filledShare).toBeGreaterThan(ops[2]!.filledShare);
    expect(ops[2]!.precision!).toBeGreaterThan(ops[0]!.precision!);
    expect(ops[0]!.recall!).toBeGreaterThanOrEqual(ops[2]!.recall!);
    expect(chooseFillP(ops, ops[1]!.precision!)).toBe(0.5);
    expect(chooseFillP(ops, 1.01)).toBeNull();
  });
});

describe("top-edge geometry", () => {
  it("classes the seam offset with a margin of one detector window", () => {
    expect(topClass(null)).toBe("none");
    expect(topClass(0.04)).toBe("clean");
    expect(topClass(0.06)).toBe("overshoot");
    expect(topClass(-0.06)).toBe("cut");
  });

  it("measures box height against its band's median, needing three boxes in the band", () => {
    const rows = [
      { imageId: "a", band: 0, longPx: 100 }, { imageId: "a", band: 0, longPx: 100 }, { imageId: "a", band: 0, longPx: 200 },
      { imageId: "a", band: 1, longPx: 100 }, { imageId: "a", band: null, longPx: 100 },
    ];
    const h = heightOffBand(rows);
    expect(h.get(rows[0]!)).toBe(0);
    expect(h.get(rows[2]!)).toBeCloseTo(Math.log(2));
    expect(h.get(rows[3]!)).toBeNull();
    expect(h.get(rows[4]!)).toBeNull();
  });
});

describe("detector fragments", () => {
  it("calls a box cut first, then partial under 0.55 of its band's height, else whole", () => {
    expect(fragmentOf(true, 1)).toBe("cut");
    expect(fragmentOf(false, 0.5)).toBe("partial");
    expect(fragmentOf(false, 0.55)).toBe("whole");
    expect(fragmentOf(false, null)).toBe("whole");
  });

  it("takes a band's height as its polygon's short side, whatever the corner order", () => {
    expect(shortSide([[0, 0], [100, 0], [100, 20], [0, 20]])).toBe(20);
    expect(shortSide([[0, 0], [0, 20], [100, 20], [100, 0]])).toBe(20);
  });
});

const PY = join(import.meta.dirname, "..", "helpers", "coverage", ".venv", "bin", "python");

describe.skipIf(!existsSync(PY))("helpers/coverage geometry on a synthetic image", () => {
  it("finds the spine's top edge against the box: clean, overshoot, and a top beyond the frame", () => {
    const dir = mkdtempSync(join(tmpdir(), "q2-"));
    try {
      // 200 x 300: a red spine over x 40-80, y 60-280, with vertical lettering, on dark grey.
      const img = png(200, 300, (x, y) => {
        if (x >= 40 && x < 80 && y >= 60 && y < 280) return x >= 50 && x < 70 && y >= 100 && y < 200 && x % 4 < 2 ? [240, 240, 240] : [200, 40, 40];
        return [60, 60, 60];
      });
      writeFileSync(join(dir, "g.png"), img);
      const box = (y0: number, y1: number) => ({ polygon: [[40, y0], [80, y0], [80, y1], [40, y1]] });
      writeFileSync(join(dir, "d.jsonl"), JSON.stringify({ id: "g", width: 200, height: 300, spines: [box(60, 270), box(40, 270), box(2, 240), box(70, 270)] }) + "\n");
      writeFileSync(join(dir, "i.jsonl"), JSON.stringify({ id: "g", image: join(dir, "g.png") }) + "\n");
      const out = execFileSync(PY, ["-I", join(import.meta.dirname, "..", "helpers", "coverage", "geometry.py"), "--detect", join(dir, "d.jsonl"), "--images", join(dir, "i.jsonl")], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      const [exact, over, high, cut] = out.trim().split("\n").map((l) => JSON.parse(l));
      expect(exact.id).toBe("g:0");
      expect(Math.abs(exact.topSeam)).toBeLessThan(0.02);
      expect(topClass(exact.topSeam)).toBe("clean");
      expect(over.topSeam).toBeCloseTo(20 / 230, 1);
      expect(topClass(over.topSeam)).toBe("overshoot");
      expect(high.topSeam).toBeCloseTo(58 / 238, 1);
      expect(cut.topSeam).toBeCloseTo(-10 / 200, 1);
      expect(exact.topY).toBeCloseTo(0.2, 3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
