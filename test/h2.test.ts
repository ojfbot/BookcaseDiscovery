// H-2: face shares, the face3d crop, the user-glow-volume variant and the depth stage's cache. Synthetic data only.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cropFor, cropName, FACE3D_CROP, type Point } from "../src/perceive/crop.ts";
import { CROP } from "../src/eval/f0.ts";
import { dominantExtra, elevationBand, face3dTrim, faceShares, topFace, type FaceRow } from "../src/perceive/faces3d.ts";
import { checkRegistry, MODES, TOOLING_LAYERS, variant, variantHash } from "../src/report/display-modes.ts";
import { area, baseOutline, overlaySvg, toFace, type Pt, type Scene } from "../src/report/display-draw.ts";

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** A box that runs onto its book's top face: 20 % top pixels, a feasible trim stopping at the top edge. */
const overRow = (): FaceRow => ({
  id: "p",
  box: 0,
  pixels: 1000,
  front: 700,
  edge: 80,
  top: 200,
  under: 0,
  cover: 20,
  behind: 0,
  overSelects: true,
  trimFeasible: true,
  trim: { polygon: rect(10, 40, 40, 200), component: 0.97, purity: 0.95, keep: 0.8, areaShare: 0.78 },
  elevationDeg: -25,
  cuboid: { corners: [[10, 200], [40, 200], [40, 40], [10, 40], [12, 190], [38, 190], [38, 20], [12, 20]], depthM: 0.18, depthSource: "seen", topVisible: true },
});

describe("face shares and the trim rule", () => {
  it("gives each class's share of the box, summing to 1, and the dominant extra face", () => {
    const s = faceShares(overRow())!;
    expect(Object.values(s).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(s.top).toBeCloseTo(0.2);
    expect(dominantExtra(overRow())).toBe("top");
    expect(elevationBand(overRow())).toBe("below");
    expect(faceShares({ id: "p", box: 1, skip: "small" })).toBeNull();
  });

  it("trims only boxes that over-select and whose trim is feasible", () => {
    expect(face3dTrim(overRow())).toEqual(rect(10, 40, 40, 200));
    expect(face3dTrim({ ...overRow(), overSelects: false })).toBeNull();
    expect(face3dTrim({ ...overRow(), trimFeasible: false })).toBeNull();
  });

  it("draws a top face only when the camera sees the top and the depth was not a default", () => {
    expect(topFace(overRow())).toEqual([[10, 40], [40, 40], [38, 20], [12, 20]]);
    expect(topFace({ ...overRow(), cuboid: { ...overRow().cuboid!, topVisible: false } })).toBeNull();
    expect(topFace({ ...overRow(), cuboid: { ...overRow().cuboid!, depthSource: "default" } })).toBeNull();
  });
});

describe("the face3d crop", () => {
  const frame = { width: 300, height: 300 };
  const spine = { polygon: rect(10, 0, 40, 200), face3d: rect(10, 40, 40, 200) };

  it("reads the trim, clipped to the frame, at F-0's rotations, and names itself", () => {
    const c = cropFor(spine, frame, FACE3D_CROP)!;
    expect(c.crop).toBe("face3d;rot=fixed;clip=frame");
    expect(Math.min(...c.polygon.map((p) => p[1]))).toBe(40);
    expect(c.rotations).toEqual([90, 270]);
    const out = cropFor({ ...spine, face3d: rect(10, 40, 40, 320) }, frame, FACE3D_CROP)!;
    expect(Math.max(...out.polygon.map((p) => p[1]))).toBeLessThanOrEqual(300);
  });

  it("falls back to the rectangle where no trim is known, and leaves the shipped crop alone", () => {
    expect(cropFor({ polygon: spine.polygon }, frame, FACE3D_CROP)!.polygon).toEqual(cropFor(spine, frame, CROP)!.polygon);
    expect(cropName(CROP)).toBe("rect;rot=fixed;clip=frame");
    expect(cropFor(spine, frame, CROP)!.polygon).toEqual(cropFor({ polygon: spine.polygon }, frame, CROP)!.polygon);
  });
});

describe("the user-glow-volume display variant", () => {
  it("is in the registry, allowed in the user mode, and draws no tooling layer", () => {
    expect(checkRegistry()).toEqual([]);
    const v = variant("user-glow-volume");
    expect(v.mode).toBe("user");
    expect(MODES.user.layers).toContain("top-face");
    expect(TOOLING_LAYERS).not.toContain("top-face");
    expect(variantHash(v)).not.toBe(variantHash(variant("user-glow")));
  });

  it("cuts the glow back to the spine face, and keeps the face when the mask and the face disagree", () => {
    const mask: Pt[] = rect(10, 0, 40, 200) as Pt[];
    const face: Pt[] = rect(10, 40, 40, 200) as Pt[];
    const cut = toFace(mask, face);
    expect(Math.min(...cut.map((p) => p[1]))).toBeGreaterThan(30);
    expect(area(cut)).toBeGreaterThanOrEqual(area(face));
    expect(toFace(rect(100, 0, 120, 30) as Pt[], face)).toEqual(face);
  });

  it("lights the top face of read spines only, under the glow", () => {
    const spine = (i: number, rung: "text-read" | "spine-found") => ({
      index: i, quad: rect(10 + i * 50, 0, 40 + i * 50, 200) as Pt[], pieces: [rect(10 + i * 50, 0, 40 + i * 50, 200) as Pt[]], boxScore: 0.5, cut: false, partial: false, rung, guess: null,
      face: rect(10 + i * 50, 40, 40 + i * 50, 200) as Pt[], topFace: [[10 + i * 50, 40], [40 + i * 50, 40], [38 + i * 50, 20], [12 + i * 50, 20]] as Pt[],
    });
    const scene: Scene = { width: 200, height: 220, spines: [spine(0, "text-read"), spine(1, "spine-found")], bands: [], tiles: [] };
    const svg = overlaySvg(scene, variant("user-glow-volume"), { width: 200, height: 220 });
    const top = svg.split('data-layer="top-face">')[1]!.split("</g>")[0]!;
    const xs = [...top.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[1]));
    expect(xs.length).toBeGreaterThan(0);
    expect(Math.max(...xs)).toBeLessThan(50); // only the read spine's top face
    expect(Math.min(...[...top.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[2])))).toBeGreaterThanOrEqual(20);
    expect(svg.indexOf('data-layer="top-face"')).toBeLessThan(svg.indexOf('data-layer="coverage-fill"'));
    expect(Math.min(...baseOutline(scene.spines[0]!, { source: "mask", hull: true, smoothing: 0, face: true }).map((p) => p[1]))).toBeGreaterThan(30);
    expect(svg).not.toMatch(/<text/);
  });
});

const HELPER = join(import.meta.dirname, "..", "helpers", "depth");
const PY = join(HELPER, ".venv", "bin", "python");

// The H-1 synthetic map: a spine plane 1 m away with a receding top face across rows 0–39 (test/h1.test.ts).
const SYNTH = `
import sys, numpy as np
H, W = 200, 160
n = np.zeros((H, W, 3), np.float32); n[...] = (0, 0, -1)
p = np.zeros((H, W, 3), np.float32)
ys, xs = np.mgrid[0:H, 0:W]
p[..., 0] = (xs - W / 2) / 400; p[..., 1] = (ys - H / 2) / 400; p[..., 2] = 1.0
top = ys < 40
n[top] = (0, -1, 0)
p[..., 2][top] = 1.0 + (40 - ys[top]) / 40 * 0.2
K = np.array([[2.5, 0, 0.5], [0, 2.0, 0.5], [0, 0, 1]], np.float32)
np.savez(sys.argv[1], points=p.astype(np.float16), normal=n.astype(np.float16), mask=np.ones((H, W), bool), intrinsics=K, scale=np.float32(1.0))
`;

describe.skipIf(!existsSync(PY))("helpers/depth stage cache", () => {
  it("keys geometry by model revision and photo, hits on a re-run, and re-runs faces only when the boxes change", () => {
    const dir = mkdtempSync(join(tmpdir(), "h2-"));
    try {
      const env = { ...process.env, BOOKCASE_DATA: dir };
      writeFileSync(join(dir, "photo.bin"), "not a real photo: the stage only hashes it on a cache hit");
      writeFileSync(join(dir, "images.jsonl"), JSON.stringify({ id: "g1", image: join(dir, "photo.bin") }) + "\n");
      const box = (x0: number, x1: number, y0: number, y1: number) => ({ polygon: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
      const det = (spines: object[]) => JSON.stringify({ id: "g1", width: 160, height: 200, spines, bands: [{ polygon: [[0, 0], [160, 0], [160, 200], [0, 200]] }] }) + "\n";
      writeFileSync(join(dir, "d.jsonl"), det([box(20, 50, 8, 192), box(70, 100, 50, 192)]));
      const stage = (...extra: string[]) =>
        execFileSync(PY, ["-I", join(HELPER, "stage.py"), "--images", join(dir, "images.jsonl"), "--detect", join(dir, "d.jsonl"), "--cache", join(dir, "cache"), ...extra], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] })
          .trim().split("\n").map((l) => JSON.parse(l));
      const [key] = stage("--keys");
      expect(key.path).toMatch(/geometry\/moge-2-vitl-normal@[^/]+\/[0-9a-f]{16}\.npz$/);
      execFileSync(PY, ["-I", "-c", SYNTH, key.path]); // stands in for the MoGe-2 run a miss would do

      const first = stage();
      const photo = first.find((r) => r.photo);
      expect(photo.hit).toEqual({ geometry: true, faces: false });
      expect(first.filter((r) => "box" in r)).toHaveLength(2);
      expect(first.find((r) => r.box === 0).overSelects).toBe(true);
      // The synthetic top face lies above the camera's height, so the camera cannot see it.
      expect(first.find((r) => r.box === 0).cuboid.topVisible).toBe(false);

      const again = stage();
      expect(again.find((r) => r.photo).hit).toEqual({ geometry: true, faces: true });
      expect(again.filter((r) => "box" in r)).toEqual(first.filter((r) => "box" in r));

      writeFileSync(join(dir, "d.jsonl"), det([box(20, 50, 8, 192)]));
      const changed = stage();
      expect(changed.find((r) => r.photo).hit).toEqual({ geometry: true, faces: false });
      const facesDir = join(dir, "cache", "faces", photo.geometryKey);
      expect(readdirSync(facesDir).filter((f) => f.endsWith(".json"))).toHaveLength(2);
      expect(readdirSync(facesDir).filter((f) => f.endsWith(".png"))).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000); // three Python processes; slower than the default 5 s when the whole suite runs in parallel
});
