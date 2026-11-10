// F-0k: candidate regions, per-photo caps, re-prompt tiles, Qwen's selection with displacement, and
// helpers/label/recover.py's gate on a synthetic label map. Synthetic data only.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CASE_TILING, SHELF_TILING } from "../src/eval/f0.ts";
import { boxGapRegion, capRegions, pairCount, qwenPlan, reTiles, type Pt, type Region } from "../src/eval/f0k.ts";

const box = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

describe("boxGapRegion", () => {
  it("is the rectangle between two side-by-side boxes, as tall as both", () => {
    const r = boxGapRegion(box(0, 10, 100, 490), box(300, 0, 400, 500))!;
    const xs = r.map((p) => p[0]), ys = r.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(100);
    expect(Math.max(...xs)).toBeCloseTo(300);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(500);
  });
  it("is null when the boxes overlap along the row", () => {
    expect(boxGapRegion(box(0, 0, 100, 500), box(80, 0, 180, 500))).toBeNull();
  });
});

describe("capRegions", () => {
  const reg = (photo: string, source: Region["source"], w: number, i: number): Region => ({ id: `${photo}:${i}`, photo, source, kind: "k", band: 0, polygon: box(0, 0, w, 10) });
  it("keeps the largest per photo and source, in input order", () => {
    const rs = [reg("a", "headroom", 5, 0), reg("a", "headroom", 50, 1), reg("a", "headroom", 20, 2), reg("a", "front-stretches", 1, 3), reg("b", "headroom", 1, 4)];
    expect(capRegions(rs, 2).map((r) => r.id)).toEqual(["a:1", "a:2", "a:3", "b:4"]);
  });
  it("breaks ties by input order", () => {
    const rs = [reg("a", "headroom", 5, 0), reg("a", "headroom", 5, 1), reg("a", "headroom", 5, 2)];
    expect(capRegions(rs, 2).map((r) => r.id)).toEqual(["a:0", "a:1"]);
  });
});

describe("reTiles", () => {
  it("band layout: one 1600-wide tile centred on the region, band height plus 12 % above and below", () => {
    const t = reTiles(box(2000, 1100, 2100, 1300), box(0, 1000, 8000, 2000), 8000, 6000, CASE_TILING);
    expect(t).toEqual([[1250, 880, 2850, 2120]]);
  });
  it("band layout: clamped at the image edge, and wider regions step tile minus overlap", () => {
    expect(reTiles(box(10, 1100, 50, 1300), null, 8000, 6000, CASE_TILING)[0]![0]).toBe(0);
    const wide = reTiles(box(0, 1100, 4000, 1300), null, 8000, 6000, CASE_TILING);
    expect(wide.map((x) => x[0])).toEqual([0, 900, 1800, 2700]);
    expect(Math.max(...wide.map((x) => x[2]))).toBeGreaterThanOrEqual(4000);
  });
  it("grid layout: a 3100 square centred on the region, clamped", () => {
    expect(reTiles(box(3900, 2900, 4100, 3100), null, 5000, 4000, SHELF_TILING)).toEqual([[1900, 900, 5000, 4000]]);
  });
});

describe("qwenPlan", () => {
  it("gives recovered boxes a slot only by box score, and displaces the existing boxes they push out", () => {
    const existing = [{ id: "p:0", score: 0.9 }, { id: "p:1", score: 0.5 }, { id: "p:2", score: 0.3 }];
    const recovered = [{ id: "p:10", score: 0.6 }, { id: "p:11", score: 0.1 }];
    const plan = qwenPlan(existing, recovered, 3);
    expect([...plan.selected]).toEqual(["p:10"]);
    expect([...plan.displaced]).toEqual(["p:2"]);
  });
  it("displaces nothing while the cap has room", () => {
    const plan = qwenPlan([{ id: "p:0", score: 0.9 }], [{ id: "p:5", score: 0.2 }], 40);
    expect([...plan.selected]).toEqual(["p:5"]);
    expect(plan.displaced.size).toBe(0);
  });
});

describe("pairCount", () => {
  it("counts distinct (photo, work) pairs", () => {
    expect(pairCount([{ imageId: "a", work: "w" }, { imageId: "a", work: "w" }, { imageId: "b", work: "w" }, { imageId: "b", work: null }])).toBe(2);
  });
});

// The gate needs helpers/label's environment (numpy, OpenCV, and detect.py's imports); skipped where it is absent.
const PY = join(import.meta.dirname, "..", "helpers", "label", ".venv", "bin", "python");
describe.skipIf(!existsSync(PY))("recover.py gate", () => {
  it("drops duplicates and pieces of kept boxes, cuts the rest to unclaimed pixels", { timeout: 60_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "f0k-"));
    try {
      // A label map with one kept box (index 0 → value 1) at x 100–199.
      const W = 600, H = 400;
      execFileSync(PY, ["-I", "-c", `import numpy as np, cv2; m=np.zeros((${H},${W}),np.uint16); m[50:350,100:200]=1; cv2.imwrite(${JSON.stringify(join(dir, "p.png"))}, m)`]);
      const cand = (k: number, x0: number, x1: number, score: number) => ({
        photo: "p", poolIndex: k, region: "r", source: "headroom", tile: 0, tileBox: [0, 0, W, H],
        rect: [[(x0 + x1) / 2, 200], [x1 - x0, 300], 0], polygon: [[x0, 50], [x1, 50], [x1, 350], [x0, 350]],
        boxScore: score, maskScore: 1, aspect: 300 / (x1 - x0), cut: false, contour: [[x0, 50], [x1 - 1, 50], [x1 - 1, 349], [x0, 349]],
      });
      const pool = [cand(0, 100, 200, 0.9), cand(1, 120, 180, 0.8), cand(2, 300, 380, 0.7), cand(3, 170, 260, 0.6)];
      writeFileSync(join(dir, "pool.jsonl"), pool.map((x) => JSON.stringify(x)).join("\n") + "\n");
      const out = execFileSync(PY, ["-I", join(import.meta.dirname, "..", "helpers", "label", "recover.py"), "gate", "--pool", join(dir, "pool.jsonl"), "--labels", dir, "--arm", "headroom", "--sources", "headroom"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const lines = out.trim().split("\n").map((l) => JSON.parse(l));
      const boxes = lines.filter((l) => !l.totals);
      const totals = lines.find((l) => l.totals).totals;
      expect(boxes.map((b) => b.pool).sort()).toEqual([2, 3]);
      expect(totals.duplicate).toBe(1);
      // Pool 1 lies inside pool 0 (detect.py's nms keeps the higher score).
      expect(totals.nms).toBe(1);
      const b3 = boxes.find((b) => b.pool === 3);
      expect(b3.keptShare).toBeCloseTo(60 / 90, 1);
      expect(Math.min(...b3.polygon.map((p: number[]) => p[0]))).toBeGreaterThanOrEqual(199);
      expect(b3.recoveredBy).toBe("f0k");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
