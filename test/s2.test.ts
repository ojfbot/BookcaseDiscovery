// S-2: the top line on the partition, the check kinds, the measures, and helpers/shelf/headroom.py on a synthetic
// shelf. Synthetic data only.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Detection } from "../src/eval/f0.ts";
import type { Polygon4 } from "../src/eval/labels.ts";
import { adequacy, checkKinds, classShare, explainedByKnown, frontNoBox, headroomShare, inHeadroom, partitionTops, recalled, S2, type HeadroomRow } from "../src/eval/s2.ts";

const rect = (x0: number, y0: number, x1: number, y1: number): Polygon4 => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const det = (spines: Polygon4[], covers: Polygon4[] = []): Detection =>
  ({
    id: "p",
    width: 1000,
    height: 800,
    spines: spines.map((polygon) => ({ polygon, boxScore: 0.5 })),
    covers: covers.map((polygon) => ({ polygon, boxScore: 0.5 })),
    bands: [],
    gaps: { medianWidth: 20 },
  }) as unknown as Detection;

describe("the top line on the partition", () => {
  // Eight upright books 20 px wide, rectangles from y 100 to 300; their exclusive outlines stop at y 120.
  const spines = Array.from({ length: 8 }, (_, i) => rect(100 + 22 * i, 100, 120 + 22 * i, 300));
  const outline = (i: number): [number, number][] => [[100 + 22 * i, 120], [120 + 22 * i, 120], [120 + 22 * i, 300], [100 + 22 * i, 300]];

  it("takes each whole neighbour's top end from its exclusive outline", () => {
    const kept = spines.map((_, i) => i);
    const tops = partitionTops(det(spines), kept, new Map(kept.map((i) => [i, outline(i)])));
    expect(tops.size).toBe(8);
    const t = tops.get(3)!;
    expect(t.a).toBeCloseTo(0, 6);
    expect(t.b).toBeCloseTo(120, 6);
    expect(t.h).toBeCloseTo(200, 6);
    expect([t.x0, t.x1]).toEqual([166, 186]);
  });

  it("falls back to the rectangle's end without an outline, and leaves dropped boxes out of the rows", () => {
    const tops = partitionTops(det(spines), [0, 1, 2, 3, 4, 5, 6, 7], new Map());
    expect(tops.get(0)!.b).toBeCloseTo(100, 6);
    // Only boxes 0-2 kept: each has two neighbours, too few for a row.
    expect(partitionTops(det(spines), [0, 1, 2], new Map()).size).toBe(0);
  });
});

describe("check kinds", () => {
  it("names stacked, not-a-book, on-lip, dropped, standing and cover-pass boxes", () => {
    const d = det([rect(0, 0, 20, 200), rect(30, 0, 230, 20), rect(30, 30, 230, 50), rect(240, 0, 260, 200), rect(300, 0, 320, 200), rect(330, 0, 530, 20)], [rect(600, 0, 700, 150)]);
    const shipped = [
      { kind: "spine", why: "spine" },
      { kind: "spine", why: "spine" },
      { kind: "not-a-book", why: "shelf-strip" },
      { kind: "spine", why: "spine" },
      { kind: "spine", why: "spine" },
      { kind: "spine", why: "spine" },
    ] as const;
    const outline: [number, number][] = [[31, 1], [229, 1], [229, 19], [31, 19]];
    const part = new Map([
      [0, { state: "kept" as const, reason: null }],
      [1, { state: "kept" as const, reason: null, outline }],
      [3, { state: "dropped" as const, reason: "duplicate" }],
      [4, { state: "kept" as const, reason: null }],
      [5, { state: "kept" as const, reason: null }],
    ]);
    const k = checkKinds(d, [...shipped], part, new Set([5]));
    expect(k.map((c) => c.kind)).toEqual(["standing", "stacked", "not-a-book", "dropped", "standing", "on-lip", "cover-pass"]);
    expect(k[1]!.polygon).toBe(outline);
    expect(k[2]!.why).toBe("shelf-strip");
    expect(k[3]!.why).toBe("duplicate");
    expect(k[6]!.box).toBe("c0");
  });
});

describe("measures", () => {
  const row = (headroomPx: number, standingPx: number, occupied: number, unknown = 0): HeadroomRow => ({
    band: 0,
    headroomPx,
    standingPx,
    classes: { empty: headroomPx - occupied - unknown, occluded: 0, occupied, "unknown-invalid": unknown, "unknown-foreground": 0, "unknown-speckle": 0 },
  });

  it("pools headroom and class shares over rows", () => {
    const rows = [row(100, 300, 10), row(300, 300, 30, 60)];
    expect(headroomShare(rows)).toBeCloseTo(400 / 1000, 6);
    expect(classShare(["occupied"])(rows)).toBeCloseTo(40 / 400, 6);
    expect(classShare(["unknown-invalid", "unknown-foreground", "unknown-speckle"])(rows)).toBeCloseTo(60 / 400, 6);
    expect(headroomShare([])).toBeNull();
  });

  it("counts a known box as recalled only when it is in the headroom and mostly occupied", () => {
    const k = (validPx: number, headroomPx: number, occupiedPx: number) => ({ box: "s0", kind: "stacked" as const, validPx, headroomPx, occupiedPx });
    expect([inHeadroom(k(100, 60, 0)), recalled(k(100, 60, 30)), recalled(k(100, 60, 29)), recalled(k(100, 40, 40)), inHeadroom(k(0, 0, 0))]).toEqual([true, true, false, false, false]);
  });

  it("explains a region by stacked and not-a-book boxes only, flags box-less front gaps, and checks adequacy", () => {
    const r = (explainedBy: "stacked" | "not-a-book" | "on-lip" | null) => ({ band: 0, px: 1, dominant: "front", overlaps: [], explainedBy });
    expect([r("stacked"), r("not-a-book"), r("on-lip"), r(null)].map(explainedByKnown)).toEqual([true, true, false, false]);
    expect(frontNoBox({ kind: "outline-gap", dominant: "front", boxShare: 0.2 })).toBe(true);
    expect(frontNoBox({ kind: "outline-gap", dominant: "front", boxShare: 0.8 })).toBe(false);
    expect(frontNoBox({ kind: "outline-gap", dominant: "cover", boxShare: 0 })).toBe(false);
    expect(frontNoBox({ kind: "void", dominant: "front", boxShare: 0 })).toBe(false);
    expect(adequacy(0.1, 0.7)).toEqual({ unknown: true, recall: true, adequate: true });
    expect(adequacy(S2.maxUnknown + 0.01, 0.7).adequate).toBe(false);
    expect(adequacy(0.1, null).adequate).toBeNull();
  });
});

// helpers/shelf/headroom.py on a synthetic shelf, camera square-on (no model run). Books 1 m away (spine plane
// z = 1) from y 150 to 250; above them the back panel 25 cm behind, a book lying flat on top (x 100-160, y 130-150,
// at the spine plane), the board's underside (y 100-106, facing down) and the board above's lip (y 90-100, 5 cm in
// front). A not-a-book box sits on the empty back panel.
const HELPER = join(import.meta.dirname, "..", "helpers", "shelf");
const PY = join(import.meta.dirname, "..", "helpers", "depth", ".venv", "bin", "python");
const SYNTH = `
import sys, json, numpy as np
H, W, f = 300, 400, 400.0
ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
z = np.full((H, W), 1.25, np.float32)
n = np.zeros((H, W, 3), np.float32); n[...] = (0, 0, -1)
z[(ys >= 150) & (ys < 250)] = 1.0
z[(ys >= 130) & (ys < 150) & (xs >= 100) & (xs < 160)] = 1.0
under = (ys >= 100) & (ys < 106)
z[under] = 1.1
n[under] = (0, 1, 0)
z[(ys >= 90) & (ys < 100)] = 0.95
p = np.stack([(xs - W / 2) / f * z, (ys - H / 2) / f * z, z], -1)
np.savez(sys.argv[1] + "/g.npz", points=p, normal=n, mask=np.ones((H, W), bool), scale=np.float32(1.0))
xs0 = list(range(20, 380, 20))
json.dump({"rows": [{"box": i, "band": 0, "frame": "0"} for i in range(len(xs0))]}, open(sys.argv[1] + "/f.json", "w"))
frame = {"front": [0, 0, -1], "up": [0, -1, 0]}
lip = {"normal": [0, 0, -1], "d": -0.95, "up": [0.1188, 0.1425], "side": [-0.5, 0.5]}
rec = {"id": "s", "width": W, "height": H, "npz": sys.argv[1] + "/g.npz", "faces": sys.argv[1] + "/f.json", "medianWidth": 20,
       "standing": [{"box": i, "outline": [[x, 150], [x + 20, 150], [x + 20, 250], [x, 250]]} for i, x in enumerate(xs0)],
       "tops": {str(i): {"a": 0, "b": 150, "h": 100, "x0": x, "x1": x + 20} for i, x in enumerate(xs0)},
       "rows": [{"band": 0, "frame": frame, "c": -1.0, "b0": -0.25, "bt": 0.0, "level": -0.25, "elevationDeg": 0,
                 "above": {"band": 1, "frame": frame, "lip": lip}}],
       "boxes": [{"box": "s90", "kind": "stacked", "polygon": [[100, 130], [159, 130], [159, 149], [100, 149]]},
                 {"box": "s91", "kind": "not-a-book", "why": "blank-card", "polygon": [[250, 110], [290, 110], [290, 125], [250, 125]]}]}
open(sys.argv[1] + "/in.jsonl", "w").write(json.dumps(rec) + "\\n")
`;

describe.skipIf(!existsSync(PY))("helpers/shelf/headroom.py on a synthetic shelf", () => {
  it("bounds the region by the top curve and the board line, and classes empty, occluded and occupied", () => {
    const dir = mkdtempSync(join(tmpdir(), "s2-"));
    try {
      execFileSync(PY, ["-I", "-c", SYNTH, dir]);
      const out = JSON.parse(execFileSync(PY, ["-I", join(HELPER, "headroom.py"), "--inputs", join(dir, "in.jsonl")], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
      const row = out.rows[0];
      expect(row.source).toBe("lip");
      expect(row.boardLine[0][1]).toBeCloseTo(99, 0);
      expect(row.topLine[0][1]).toBeCloseTo(150, 0);
      // Columns 20-380, rows 100-149: no book pixels inside (the outlines start at y 150).
      expect(row.regionPx).toBe(361 * 50);
      expect(row.bookPx).toBe(0);
      const c = row.classes;
      expect(c.occupied).toBe(60 * 20);
      expect(c.occluded).toBe(361 * 6);
      expect(c.empty).toBe(361 * 50 - 60 * 20 - 361 * 6);
      expect(row.gapM).toBeCloseTo(0.119, 2);
      expect(out.regions).toHaveLength(1);
      expect(out.regions[0]).toMatchObject({ band: 0, px: 1200, dominant: "front", explainedBy: "stacked" });
      expect(out.regions[0].aboveTopM).toBeGreaterThan(0);
      const [stacked, card] = out.known;
      expect(stacked).toMatchObject({ kind: "stacked", validPx: 1200, headroomPx: 1200, occupiedPx: 1200 });
      expect(card).toMatchObject({ kind: "not-a-book", why: "blank-card", occupiedPx: 0 });
      expect(card.headroomPx).toBe(card.validPx);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
