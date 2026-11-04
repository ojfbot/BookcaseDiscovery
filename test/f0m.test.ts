// F-0m: row-end residuals, Q-2's seam error, books lost, the keep rules, and helpers/depth/ends.py on a synthetic shelf
// seen from above. Synthetic data only.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Detection } from "../src/eval/f0.ts";
import { changedSet, type EndsOut } from "../src/eval/f0m-cli.ts";
import { endResiduals, lostWorks, meanResidual, seamError, verdictOf, type SetFigures } from "../src/eval/f0m.ts";
import type { Point } from "../src/perceive/crop.ts";

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const det = (polys: Point[][]): Detection =>
  ({ id: "p", width: 1000, height: 800, spines: polys.map((polygon) => ({ polygon, boxScore: 0.5, maskScore: 0.9, aspect: 7, cut: false })), bands: [], gaps: { bandLength: 0, gapLength: 0, gapCount: 0, medianWidth: 30 }, tiles: 1, seconds: 0 }) as unknown as Detection;

describe("row-end residuals against F-0f's fitted lines", () => {
  it("is near 0 for a row whose bottoms sit on one line, and grows with a box that stops short", () => {
    const even = det([0, 1, 2, 3, 4, 5].map((k) => rect(100 + 40 * k, 100 + (k % 2) * 20, 130 + 40 * k, 400)));
    const r = endResiduals(even, () => true);
    expect(r).toHaveLength(6);
    expect(Math.max(...r.map((x) => x.bottom))).toBeLessThan(1e-6);
    const short = det([0, 1, 2, 3, 4, 5].map((k) => rect(100 + 40 * k, 100, 130 + 40 * k, k === 2 ? 340 : 400)));
    const r2 = endResiduals(short, () => true);
    expect(r2.find((x) => x.index === 2)!.bottom).toBeCloseTo(60 / 300, 2);
    expect(meanResidual("bottom")(r2)).toBeCloseTo(60 / 300 / 6, 2);
  });

  it("measures kept boxes only, and caps a residual at half a spine height", () => {
    const polys = [0, 1, 2, 3, 4].map((k) => rect(100 + 40 * k, 100, 130 + 40 * k, 400));
    polys.push(rect(300, 100, 330, 900));
    const r = endResiduals(det(polys), (i) => i !== 5);
    expect(r.map((x) => x.index)).not.toContain(5);
    expect(meanResidual("bottom")([{ imageId: "p", index: 0, top: 0, bottom: 3 }])).toBe(0.5);
  });
});

describe("seam error, books lost, the changed set", () => {
  it("counts upright measured boxes off the seam by more than 0.05, by part", () => {
    const rows = [0.1, -0.1, 0.02, null, 0.3].map((seam, k) => ({ imageId: "p", id: `p:${k}`, seam, upright: k !== 4 }));
    expect(seamError(rows)).toBeCloseTo(2 / 3);
    expect(seamError(rows, "cut")).toBeCloseTo(1 / 3);
    expect(seamError(rows, "overshoot")).toBeCloseTo(1 / 3);
    expect(seamError([])).toBeNull();
  });

  it("counts a (photo, work) pair as lost only when no box confirms it after", () => {
    const rows = [
      { imageId: "a", before: "w1", after: null },
      { imageId: "a", before: null, after: "w1" },
      { imageId: "a", before: "w2", after: "w3" },
      { imageId: "b", before: "w1", after: null },
    ];
    expect(lostWorks(rows)).toBe(2);
  });

  it("counts a box as changed only when its snapped crop moves a corner more than 1 px", () => {
    const d = { ...det([rect(10, 10, 50, 290), rect(60, 10, 100, 290), rect(110, 10, 150, 290)]), width: 400, height: 300 };
    const e = new Map<string, EndsOut>([
      ["p:0", { id: "p:0", index: 0, tilt: 0, length: 280, top: { status: "snapped" }, bottom: { status: "no-row" }, polygon: rect(10, 10.5, 50, 290) }],
      ["p:1", { id: "p:1", index: 1, tilt: 0, length: 280, top: { status: "snapped" }, bottom: { status: "snapped" }, polygon: rect(60, 40, 100, 280) }],
      ["p:2", { id: "p:2", index: 2, tilt: 0, length: 280, top: { status: "no-crease" }, bottom: { status: "no-row" } }],
    ]);
    expect([...changedSet(new Map([["p", d]]), e)]).toEqual(["p:1"]);
  });
});

describe("the keep rules", () => {
  const good: SetFigures = {
    bottomResidualDelta: [-0.02, -0.03, -0.01],
    topResidualDelta: [0, -0.01, 0.01],
    seamErrorDelta: [0.01, -0.01, 0.03],
    overlapAfter: 0.001,
    lostOutlines: 0,
    readers: { confirmed: { delta: 1, lo: 0.2, hi: 2 }, wrong: { delta: 0, lo: -1, hi: 1 }, works: { delta: { value: 2, lo: -1, hi: 5 }, lost: 3 }, recallDelta: [0, -0.01, 0.01] },
  };
  it("ships the geometry and the reader crop when every rule holds", () => {
    const v = verdictOf(good, good)!;
    expect(v.geometry.ships).toBe(true);
    expect(v.readerCrop?.ships).toBe(true);
  });

  it("holds the geometry back on a seam error that rises beyond its interval, or a lost outline", () => {
    expect(verdictOf({ ...good, seamErrorDelta: [0.05, 0.02, 0.08] }, good)!.geometry.ships).toBe(false);
    expect(verdictOf(good, { ...good, lostOutlines: 1 })!.geometry.ships).toBe(false);
    expect(verdictOf({ ...good, bottomResidualDelta: [-0.01, -0.02, 0.001] }, good)!.geometry.ships).toBe(false);
  });

  it("holds the reader crop back when the pilot interval touches 0 or works fall", () => {
    expect(verdictOf({ ...good, readers: { ...good.readers!, confirmed: { delta: 1, lo: -0.1, hi: 2 } } }, good)!.readerCrop?.ships).toBe(false);
    expect(verdictOf({ ...good, readers: { ...good.readers!, works: { delta: { value: -1, lo: -3, hi: 1 }, lost: 4 } } }, good)!.readerCrop?.ships).toBe(false);
    expect(verdictOf({ ...good, readers: undefined }, good)!.readerCrop).toBeNull();
  });
});

// --- ends.py on a synthetic shelf --------------------------------------------------------------------------

const PY = join(import.meta.dirname, "..", "helpers", "depth", ".venv", "bin", "python");
const ENDS = join(import.meta.dirname, "..", "helpers", "depth", "ends.py");

/**
 * A 300 x 300 map (working copy = map, scale 1; normalised intrinsics f = 1, centre 0.5). Four books' spine faces at
 * depth 1 m, from Y 0.1 m down to 0.35 m (camera axes, y down): image rows 180 to 255. Their top faces (Y = 0.1, up
 * to 1.4 m deep) show from above as rows 171 to 180; the board top (Y = 0.35) shows in front of them down to the lip
 * (depth 0.9 m), rows 255 to 267; the lip's face below it to row 283; a back wall at 1.6 m above the books.
 */
const SCENE = `
import json, sys, numpy as np, cv2
out = sys.argv[1]
H = W = 300
yy, xx = np.mgrid[0:H, 0:W].astype(np.float64)
ry, rx = (yy + 0.5) / H - 0.5, (xx + 0.5) / W - 0.5
P = np.zeros((H, W, 3)); N = np.zeros((H, W, 3)); M = np.zeros((H, W), bool)
def put(sel, z, n):
    P[sel] = np.stack([rx[sel] * z[sel], ry[sel] * z[sel], z[sel]], -1); N[sel] = n; M[sel] = True
ones = np.ones((H, W))
books = (xx >= 50) & (xx < 250)
put(books & (ry >= 0.1) & (ry < 0.35), ones, [0, 0, -1])
with np.errstate(divide="ignore"):
    zt = 0.1 / ry
put(books & (ry > 0) & (zt > 1) & (zt <= 1.4), zt, [0, -1, 0])
put((ry < 0.1) & ~M, 1.6 * ones, [0, 0, -1])
with np.errstate(divide="ignore"):
    zb = 0.35 / ry
put((ry > 0) & (zb >= 0.9) & (zb < 1.0) & ~M, zb, [0, -1, 0])
put((ry >= 0.35 / 0.9) & (ry < 0.4 / 0.9) & ~M, 0.9 * ones, [0, 0, -1])
K = np.array([[1, 0, 0.5], [0, 1, 0.5], [0, 0, 1.0]])
np.savez(out + "/g.npz", points=P.astype(np.float16), normal=N.astype(np.float16), mask=M, intrinsics=K, scale=np.float32(1.0))
boxes, labels = [], np.zeros((H, W), np.uint16)
for i in range(4):
    x0, x1 = 53 + 50 * i, 97 + 50 * i
    poly = [[x0, 165], [x1, 165], [x1, 262], [x0, 262]]
    cv2.fillPoly(labels, [np.int32(poly)], i + 1)
    boxes.append({"index": i, "polygon": poly, "outline": poly})
cv2.imwrite(out + "/labels.png", labels)
faces = {"rows": [{"box": i, "band": 0, "frame": "0", "ownPlane": False, "elevationDeg": -20} for i in range(4)],
         "frames": {"0": {"front": [0, 0, -1], "up": [0, -1, 0]}}}
json.dump(faces, open(out + "/faces.json", "w"))
row = {"band": 0, "level": -0.35, "levelSource": "board", "frame": {"front": [0, 0, -1], "up": [0, -1, 0]},
       "planes": {"board": {"found": True}, "lip": {"found": True, "normal": [0, 0, -1], "d": -0.9, "up": [-0.4, -0.35]}}}
rec = {"id": "s", "width": W, "height": H, "npz": out + "/g.npz", "faces": out + "/faces.json", "labels": out + "/labels.png",
       "rows": [row], "boxes": boxes}
open(out + "/inputs.jsonl", "w").write(json.dumps(rec) + "\\n")
`;

describe.skipIf(!existsSync(PY))("ends.py on a synthetic shelf seen from above", () => {
  it("snaps tops to the front-to-top crease and bottoms to the board, keeping the partition", () => {
    const dir = mkdtempSync(join(tmpdir(), "f0m-"));
    try {
      writeFileSync(join(dir, "scene.py"), SCENE);
      execFileSync(PY, ["-I", join(dir, "scene.py"), dir]);
      const out = execFileSync(PY, ["-I", ENDS, "--inputs", join(dir, "inputs.jsonl"), "--out", dir], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const rows = out.trim().split("\n").map((l) => JSON.parse(l));
      const boxes = rows.filter((r) => !r.photo);
      const photo = rows.find((r) => r.photo);
      expect(boxes).toHaveLength(4);
      for (const b of boxes) {
        expect(b.top.status).toBe("snapped");
        expect(b.bottom).toMatchObject({ status: "snapped", source: "board" });
        const ys = (b.polygon as Point[]).map((p) => p[1]);
        expect(Math.min(...ys)).toBeGreaterThan(176);
        expect(Math.min(...ys)).toBeLessThan(184);
        expect(Math.max(...ys)).toBeGreaterThan(252);
        expect(Math.max(...ys)).toBeLessThan(258);
        const oy = (b.outline as Point[]).map((p) => p[1]);
        expect(Math.min(...oy)).toBeGreaterThanOrEqual(176);
        expect(Math.max(...oy)).toBeLessThanOrEqual(258);
      }
      expect(photo.overlapAfter[0]).toBe(0);
      expect(existsSync(join(dir, "labels", "s.png"))).toBe(true);
      expect(readFileSync(join(dir, "labels", "s.png")).length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
