// S-1: the on-lip rule and post step, board pitch, implied scale, and helpers/shelf on a synthetic shelf. Synthetic data only.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Kinds } from "../src/eval/f0c.ts";
import type { Polygon4 } from "../src/eval/labels.ts";
import { applyOnLip, elevationOf, impliedScale, onLip, pitches, spearman, STANDARD_SHELF, type LipFeatures, type ShelfRow } from "../src/eval/s1.ts";

const rect = (x0: number, y0: number, x1: number, y1: number): Polygon4 => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const frame = { width: 1000, height: 800 };
/** A strip on a lip's face: all its pixels there, on the lip plane, in front of the books' faces. */
const strip: LipFeatures = { band: 0, inZone: 0.95, belowBoard: 0.9, dLip: 0.002, dSpine: 0.03, pixels: 400, lipHeightM: 0.04, lipBoardGapM: 0.005 };

describe("the on-lip rule", () => {
  it("flags a flat box on a lip's face, in front of the books", () => {
    expect(onLip(rect(100, 500, 300, 520), strip, frame)).toBe(true);
  });

  it("keeps an upright box (a spine end), a box the frame cuts, and a box mostly off the lip", () => {
    expect(onLip(rect(100, 400, 130, 520), strip, frame)).toBe(false);
    expect(onLip(rect(0, 500, 200, 520), strip, frame)).toBe(false);
    expect(onLip(rect(100, 780, 300, 800), strip, frame)).toBe(false);
    expect(onLip(rect(100, 500, 300, 520), { ...strip, inZone: 0.4 }, frame)).toBe(false);
  });

  it("keeps a box behind the lip or behind the books' faces, and needs a lip that meets its board", () => {
    expect(onLip(rect(100, 500, 300, 520), { ...strip, dLip: -0.03 }, frame)).toBe(false);
    expect(onLip(rect(100, 500, 300, 520), { ...strip, dSpine: -0.01 }, frame)).toBe(false);
    expect(onLip(rect(100, 500, 300, 520), { ...strip, lipBoardGapM: 0.06 }, frame)).toBe(false);
    expect(onLip(rect(100, 500, 300, 520), { ...strip, lipHeightM: 0.12 }, frame)).toBe(false);
    expect(onLip(rect(100, 500, 300, 520), null, frame)).toBe(false);
    expect(onLip(rect(100, 500, 300, 520), { pixels: 5 }, frame)).toBe(false);
  });

  it("as a post step, re-kinds kept spines and kept covers only", () => {
    const k: Kinds = {
      spines: [
        { ref: "s0", kind: "spine", why: "spine", polygon: rect(100, 500, 300, 520), boxScore: 0.5 },
        { ref: "s1", kind: "not-a-book", why: "shelf-strip", polygon: rect(100, 500, 300, 520), boxScore: 0.5 },
        { ref: "s2", kind: "spine", why: "spine", polygon: rect(400, 300, 430, 500), boxScore: 0.5 },
      ],
      covers: [{ ref: "c3", kind: "face-out", why: "cover", polygon: rect(500, 495, 640, 525), boxScore: 0.5 }],
      dropped: [],
      spineHeight: 200,
      medianWidth: 30,
    };
    const out = applyOnLip(k, frame, [strip, strip, strip], [null, null, null, strip]);
    expect(out.spines.map((b) => b.why)).toEqual(["on-lip", "shelf-strip", "spine"]);
    expect(out.covers[0]).toMatchObject({ ref: "c3", kind: "not-a-book", why: "on-lip" });
  });
});

describe("board pitch and scale", () => {
  const row = (band: number, level: number, levelSource: ShelfRow["levelSource"], front = [0, 0, -1], side: [number, number] = [-0.5, 0.5]): ShelfRow => ({
    band,
    level,
    levelSource,
    side,
    frame: { front, up: [0, -1, 0] },
  });

  it("pairs each row with the nearest parallel, overlapping row above it", () => {
    const ps = pitches([row(0, 0.66, "lip"), row(1, 0.33, "board"), row(2, 0, "board"), row(3, 0.2, "board", [0.7071, 0, -0.7071]), row(4, 0.1, "board", [0, 0, -1], [2, 3])]);
    expect(ps).toEqual([
      { lower: 1, upper: 0, pitchM: 0.33, source: "lip" },
      { lower: 2, upper: 1, pitchM: 0.33, source: "board" },
    ]);
  });

  it("drops pairs too close or too far apart to be one pitch, and skips rows without a level", () => {
    expect(pitches([row(0, 0.05, "board"), row(1, 0, "board")])).toEqual([]);
    expect(pitches([row(0, 0.9, "board"), row(1, 0, "board")])).toEqual([]);
    expect(pitches([{ band: 0, skip: "few-books" }, row(1, 0, "board")])).toEqual([]);
  });

  it("gives the implied scale against the standard shelf, and H-1's elevation strata", () => {
    expect(impliedScale(STANDARD_SHELF.depth, 0.27)).toBe(1);
    expect(impliedScale(STANDARD_SHELF.depth, 0.54)).toBe(0.5);
    expect(impliedScale(STANDARD_SHELF.pitch, null)).toBeNull();
    expect([elevationOf(-20), elevationOf(0), elevationOf(15), elevationOf(null)]).toEqual(["below", "level", "above", null]);
  });

  it("ranks for Spearman with ties", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBe(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBe(-1);
    expect(spearman([1, 1, 2], [1, 2, 3])).toBeCloseTo(0.866, 3);
    expect(spearman([1, 2], [1, 2])).toBeNull();
  });
});

// helpers/shelf/shelf.py on a synthetic shelf, camera square-on and a little above (no model run). A row of books 1 m
// away (spine plane z = 1), 25 cm tall, 5 cm wide, with a 10 cm gap; the board's top just in front of them, its lip
// 5.5 cm in front, the back panel 25 cm behind (seen above the books and in the gap); a flat strip on the lip.
const HELPER = join(import.meta.dirname, "..", "helpers", "shelf");
const PY = join(import.meta.dirname, "..", "helpers", "depth", ".venv", "bin", "python");
const SYNTH = `
import sys, json, numpy as np, cv2
H, W, f = 300, 400, 400.0
ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
z = np.full((H, W), np.nan, np.float32)
n = np.zeros((H, W, 3), np.float32); n[...] = (0, 0, -1)
books = (ys >= 100) & (ys < 200)
gap = books & (xs >= 250) & (xs < 290)
z[books & ~gap] = 1.0
back = (ys >= 70) & (ys < 100) | gap
z[back] = 1.25
board = (ys >= 200) & (ys < 203)
z[board] = 50.0 / (ys[board] - 150)          # the plane Y = 0.125 m, seen from above
n[board] = (0, -1, 0)
lip = (ys >= 203) & (ys < 215)
z[lip] = 50.0 / 53.0
p = np.stack([(xs - W / 2) / f * z, (ys - H / 2) / f * z, z], -1)
mask = np.isfinite(z)
p[~mask] = 0
K = np.array([[f / W, 0, 0.5], [0, f / H, 0.5], [0, 0, 1]], np.float32)
np.savez(sys.argv[1] + "/g.npz", points=p, normal=n, mask=mask, intrinsics=K, scale=np.float32(1.0))
spines, rows = [], []
cm = np.full((H, W), 255, np.uint8)
for i, x in enumerate(range(20, 380, 20)):
    if 250 <= x < 290:
        continue
    spines.append({"polygon": [[x, 100], [x + 20, 100], [x + 20, 200], [x, 200]], "kept": True})
    rows.append({"box": len(rows), "band": 0, "frame": "0", "elevationDeg": -2.0})
    cm[100:200, x + 1:x + 19] = 0
spines.append({"polygon": [[100, 205], [160, 205], [160, 213], [100, 213]], "kept": True})
rows.append({"box": len(rows), "band": 1, "frame": "1", "skip": "small"})
json.dump({"rows": rows, "frames": {"0": {"front": [0, 0, -1], "up": [0, -1, 0]}}}, open(sys.argv[1] + "/f.json", "w"))
cv2.imwrite(sys.argv[1] + "/f.png", cm)
rec = {"id": "s", "width": W, "height": H, "npz": sys.argv[1] + "/g.npz", "faces": sys.argv[1] + "/f.json",
       "classmap": sys.argv[1] + "/f.png", "spines": spines, "outlines": {}, "covers": [],
       "bands": [{"polygon": [[15, 95], [385, 95], [385, 205], [15, 205]]}], "medianWidth": 20}
open(sys.argv[1] + "/in.jsonl", "w").write(json.dumps(rec) + "\\n")
`;

describe.skipIf(!existsSync(PY))("helpers/shelf on a synthetic shelf", () => {
  it("fits the board top, lip and back panel, finds the gap as a void, and flags the strip on the lip", () => {
    const dir = mkdtempSync(join(tmpdir(), "s1-"));
    try {
      execFileSync(PY, ["-I", "-c", SYNTH, dir]);
      const out = JSON.parse(execFileSync(PY, ["-I", join(HELPER, "shelf.py"), "--inputs", join(dir, "in.jsonl")], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
      const row = out.rows[0];
      expect(row.planes.board.found).toBe(true);
      expect(row.planes.lip.found).toBe(true);
      expect(row.planes.back.found).toBe(true);
      expect(row.levelSource).toBe("board");
      expect(row.level).toBeCloseTo(-0.125, 2);
      expect(row.boardDepthM).toBeCloseTo(0.25 + (1 - 50 / 53), 2);
      const voids = row.voids.stretches.filter((s: { kind: string }) => s.kind === "void");
      expect(voids).toHaveLength(1);
      expect(voids[0].to - voids[0].from).toBeGreaterThanOrEqual(1.5);
      expect(voids[0].to - voids[0].from).toBeLessThanOrEqual(2.5);
      expect(voids[0].where).toBe("interior");
      const stripF = out.boxes[out.boxes.length - 1];
      expect(stripF.inZone).toBeGreaterThan(0.9);
      expect(onLip(rect(100, 205, 160, 213), stripF, { width: 400, height: 300 })).toBe(true);
      expect(onLip(rect(20, 100, 40, 200), out.boxes[0], { width: 400, height: 300 })).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
