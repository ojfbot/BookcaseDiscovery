import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { outcomeOf, parseCsv } from "../src/eval/q1-cli.ts";
import { auc, binOf, clusterBootstrap, curve, fitLogistic, fitTree, heatmap, predictLogistic, predictTree, quantileEdges, rate, spearman } from "../src/eval/q1.ts";
import type { Outcome, Row } from "../src/eval/q1.ts";
import { png } from "./helpers/synth.ts";

const row = (imageId: string, outcome: Outcome, f: Record<string, number | null>, i = 0): Row => ({ id: `${imageId}:${i}`, imageId, outcome, f });

describe("binning", () => {
  it("cuts at quantiles and assigns the maximum to the last bin", () => {
    const edges = quantileEdges([1, 2, 3, 4, 5, 6, 7, 8], 4);
    expect(edges).toEqual([1, 2.75, 4.5, 6.25, 8]);
    expect(binOf(1, edges)).toBe(0);
    expect(binOf(4.5, edges)).toBe(2);
    expect(binOf(8, edges)).toBe(3);
    expect(binOf(9, edges)).toBe(-1);
  });

  it("splits a mostly-constant feature into 'at the minimum' and 'above it'", () => {
    const edges = quantileEdges([...new Array<number>(16).fill(0), 1], 8);
    expect(edges).toEqual([0, 1, 1]);
    expect(binOf(0, edges)).toBe(0);
    expect(binOf(1, edges)).toBe(1);
  });

  it("gives per-bin outcome rates with intervals from the photo bootstrap", () => {
    const rows: Row[] = [];
    for (let p = 0; p < 10; p++)
      for (let i = 0; i < 20; i++) rows.push(row(`p${p}`, i < 10 ? "unknown:no-text" : "confirmed", { x: i }, i));
    const c = curve(rows, "x", 2, 200);
    expect(c.bins.map((b) => b.n)).toEqual([100, 100]);
    expect(c.bins[0]!.noText![0]).toBe(1);
    expect(c.bins[1]!.confirmed![0]).toBe(1);
    expect(c.bins[1]!.counts).toEqual({ confirmed: 100 });
  });
});

describe("statistics", () => {
  it("AUC is 1 for perfect separation, 0.5 for ties, and counts ties half", () => {
    expect(auc([3, 4], [1, 2])).toBe(1);
    expect(auc([1, 2], [3, 4])).toBe(0);
    expect(auc([1, 1], [1, 1])).toBe(0.5);
    expect(auc([2, 1], [1])).toBe(0.75);
    expect(auc([], [1])).toBeNull();
  });

  it("the cluster bootstrap is deterministic and its interval holds the point value", () => {
    const rows = Array.from({ length: 60 }, (_, i) => row(`p${i % 6}`, i % 3 ? "confirmed" : "unknown:no-text", {}, i));
    const stat = rate((r: Row) => r.outcome === "confirmed");
    const a = clusterBootstrap(rows, stat, 300, 3)!, b = clusterBootstrap(rows, stat, 300, 3)!;
    expect(a).toEqual(b);
    expect(a.lo).toBeLessThanOrEqual(a.value);
    expect(a.hi).toBeGreaterThanOrEqual(a.value);
  });

  it("Spearman is rank-based", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 1000])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
  });

  it("heatmap residuals are normalised per photo", () => {
    // Photo a fails everywhere, photo b fails only on the left: the residual blames b's left cell only.
    const rows = [
      row("a", "unknown:no-text", { cx: 0.1, cy: 0.5 }, 0),
      row("a", "unknown:no-text", { cx: 0.9, cy: 0.5 }, 1),
      row("b", "unknown:no-text", { cx: 0.1, cy: 0.5 }, 0),
      row("b", "confirmed", { cx: 0.9, cy: 0.5 }, 1),
    ];
    const h = heatmap(rows, 2, 1);
    expect(h.count).toEqual([[2, 2]]);
    expect(h.rate).toEqual([[1, 0.5]]);
    expect(h.residual).toEqual([[0.25, -0.25]]);
  });
});

describe("descriptive models", () => {
  const xs = Array.from({ length: 400 }, (_, i) => ({ a: i % 100, b: (i * 37) % 11 }));
  const ys = xs.map((x) => (x.a > 60 ? 1 : 0));

  it("a depth-limited tree finds a step on the informative feature", () => {
    const t = fitTree(xs, ys, ["b", "a"], 2, 20);
    expect(t.leaf).toBe(false);
    if (!t.leaf) {
      expect(t.feature).toBe("a");
      expect(t.threshold).toBeGreaterThanOrEqual(59);
      expect(t.threshold).toBeLessThanOrEqual(61);
    }
    expect(predictTree(t, { a: 90, b: 0 })).toBe(1);
    expect(predictTree(t, { a: 10, b: 0 })).toBe(0);
  });

  it("logistic regression puts the weight on the informative feature", () => {
    const m = fitLogistic(xs.map((x) => [x.a, x.b]), ys, ["a", "b"], 15);
    expect(m.weights[1]!).toBeGreaterThan(1);
    expect(Math.abs(m.weights[2]!)).toBeLessThan(0.5);
    expect(predictLogistic(m, [95, 5])).toBeGreaterThan(0.9);
    expect(predictLogistic(m, [5, 5])).toBeLessThan(0.1);
  });
});

describe("outcomes and inputs", () => {
  it("maps F-0 decisions to Q-1 outcome classes", () => {
    const acc = { id: "i:0", imageId: "i", accepted: { workId: "isfdb:1" }, reason: null };
    expect(outcomeOf(acc)).toBe("confirmed");
    expect(outcomeOf(acc, new Set(["isfdb:1"]))).toBe("confirmed");
    expect(outcomeOf(acc, new Set(["isfdb:2"]))).toBe("rejected/wrong");
    expect(outcomeOf({ ...acc, accepted: null, reason: "no-text" })).toBe("unknown:no-text");
    expect(() => outcomeOf({ ...acc, accepted: null, reason: "mystery" })).toThrow();
  });

  it("reads quoted CSV fields", () => {
    expect(parseCsv('a,b\n"x, ""y""",2\r\n"multi\nline",3\n')).toEqual([
      { a: 'x, "y"', b: "2" },
      { a: "multi\nline", b: "3" },
    ]);
  });
});

const PY = join(import.meta.dirname, "..", "helpers", "coverage", ".venv", "bin", "python");

describe.skipIf(!existsSync(PY))("helpers/coverage features on a synthetic image", () => {
  it("measures geometry, sharpness, glare and position inside each polygon", () => {
    const dir = mkdtempSync(join(tmpdir(), "q1-"));
    try {
      // 400 x 300: sharp black/white stripes (x 40-80), a soft sinusoid (x 120-160), pure white (x 200-240),
      // all over y 50-250, on mid grey.
      const img = png(400, 300, (x, y) => {
        if (y < 50 || y >= 250) return [128, 128, 128];
        if (x >= 40 && x < 80) return (Math.floor(y / 4) % 2 ? [255, 255, 255] : [0, 0, 0]);
        if (x >= 120 && x < 160) { const v = Math.round(128 + 100 * Math.sin(y / 12)); return [v, v, v]; }
        if (x >= 200 && x < 240) return [255, 255, 255];
        return [128, 128, 128];
      });
      writeFileSync(join(dir, "s.png"), img);
      const box = (x0: number, x1: number, y0 = 50, y1 = 250) => ({ polygon: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], boxScore: 0.5 });
      const det = {
        id: "s", width: 400, height: 300,
        spines: [box(40, 80), box(120, 160), box(200, 239, 50, 249), box(150, 250, 130, 170), box(380, 420, 100, 200)],
        bands: [{ polygon: [[0, 40], [400, 40], [400, 260], [0, 260]], spines: 5 }],
      };
      writeFileSync(join(dir, "d.jsonl"), JSON.stringify(det) + "\n");
      writeFileSync(join(dir, "i.jsonl"), JSON.stringify({ id: "s", image: join(dir, "s.png") }) + "\n");
      const out = execFileSync(PY, ["-I", join(import.meta.dirname, "..", "helpers", "coverage", "features.py"), "--detect", join(dir, "d.jsonl"), "--images", join(dir, "i.jsonl")], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      const [sharp, soft, white, lying, edge] = out.trim().split("\n").map((l) => JSON.parse(l));
      expect(sharp.id).toBe("s:0");
      expect(sharp.shortPx).toBe(40);
      expect(sharp.longPx).toBe(200);
      expect(sharp.aspect).toBe(5);
      expect(Math.abs(sharp.longAxisDeg)).toBeLessThan(1);
      expect(sharp.lapVar).toBeGreaterThan(50 * soft.lapVar);
      expect(sharp.rmsContrast).toBeGreaterThan(100);
      expect(white.highlightFrac).toBe(1);
      expect(white.rmsContrast).toBe(0);
      expect(Math.abs(lying.longAxisDeg)).toBeCloseTo(90, 0);
      expect(lying.lying).toBe(true);
      expect(lying.radial).toBeLessThan(0.05);
      expect(sharp.band).toBe(0);
      expect(sharp.bandAlong).toBeCloseTo(0.15, 2);
      expect(edge.outFrac).toBeCloseTo(0.5, 1);
      expect(edge.edgeDist).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
