// F-0b: reader-crop geometry on synthetic polygons only (no photos).
import { describe, expect, it } from "vitest";
import {
  F0_CROP,
  canonical,
  clipToFrame,
  cropFor,
  cropName,
  cropSize,
  longAxisRotations,
  minAreaRect,
  padEnds,
  spineFace,
  type Point,
} from "../src/perceive/crop.ts";
import { CROP, spineRequests } from "../src/eval/f0.ts";

/** A w x h rectangle centred at (cx, cy), turned `deg` degrees clockwise (y down). */
function rect(cx: number, cy: number, w: number, h: number, deg = 0): Point[] {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return ([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]] as Point[]).map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
}
const close = (a: readonly Point[], b: readonly Point[], tol = 0.5) =>
  a.forEach((p, i) => {
    expect(p[0]).toBeCloseTo(b[i]![0], 0);
    expect(Math.abs(p[1] - b[i]![1])).toBeLessThan(tol + 1e-9);
  });

describe("canonical corners", () => {
  it("orders any start and winding clockwise from the corner nearest the top-left", () => {
    const r: Point[] = [[0, 0], [10, 0], [10, 40], [0, 40]];
    expect(canonical([r[2]!, r[1]!, r[0]!, r[3]!])).toEqual(r);
    expect(cropSize([r[3]!, r[2]!, r[1]!, r[0]!])).toEqual({ width: 10, height: 40 });
  });
});

describe("rotations from the long axis", () => {
  it("keeps F-0's 90/270 for an upright spine, also when tilted", () => {
    expect(longAxisRotations(rect(50, 50, 20, 120))).toEqual([90, 270]);
    expect(longAxisRotations(rect(50, 50, 20, 120, 30))).toEqual([90, 270]);
  });
  it("reads a spine lying flat at 0 and 180, so its text runs left to right", () => {
    expect(longAxisRotations(rect(50, 50, 120, 20))).toEqual([0, 180]);
    expect(longAxisRotations(rect(50, 50, 20, 120, 75))).toEqual([0, 180]);
  });
  it("reads all four ways when the box is too square to trust its long axis", () => {
    expect(longAxisRotations(rect(50, 50, 60, 100))).toEqual([0, 90, 180, 270]);
    expect(longAxisRotations(rect(50, 50, 60, 100), 1.5)).toEqual([90, 270]);
  });
});

describe("clip to the frame", () => {
  it("leaves a box inside the frame alone", () => {
    const r = rect(50, 60, 20, 100);
    const c = clipToFrame(r, 200, 200)!;
    expect(c.clipped).toBe(false);
    close(c.quad, canonical(r));
  });
  it("trims a spine running off the top edge along its length, not across", () => {
    const c = clipToFrame(rect(50, 30, 20, 100), 200, 200)!; // y from -20 to 80
    expect(c.clipped).toBe(true);
    expect(cropSize(c.quad).width).toBeCloseTo(20, 1);
    expect(cropSize(c.quad).height).toBeCloseTo(80, 0);
    for (const [x, y] of c.quad) expect(x >= 0 && y >= 0 && x <= 200 && y <= 200).toBe(true);
  });
  it("keeps a tilted box inside every edge it crosses", () => {
    const c = clipToFrame(rect(8, 190, 30, 120, 20), 200, 200)!;
    for (const [x, y] of c.quad) expect(x >= 0 && y >= 0 && x <= 200 && y <= 200).toBe(true);
    expect(cropSize(c.quad).width).toBeGreaterThan(5);
  });
  it("gives up when almost nothing is in the frame", () => {
    expect(clipToFrame(rect(-40, 50, 20, 100), 200, 200)).toBeNull();
  });
});

describe("pad the ends", () => {
  it("lengthens the long axis only", () => {
    const p = padEnds(rect(50, 100, 20, 100), 0.05);
    expect(cropSize(p)).toEqual({ width: 20, height: expect.closeTo(110, 6) });
    const q = padEnds(rect(100, 50, 100, 20), 0.05);
    expect(cropSize(q).width).toBeCloseTo(110, 6);
    expect(cropSize(q).height).toBeCloseTo(20, 6);
  });
});

describe("spine face from a mask outline", () => {
  it("finds the rectangle of a plain spine", () => {
    const r = minAreaRect(rect(40, 80, 20, 140, 10));
    expect(r.length).toBeCloseTo(140, 6);
    expect(r.width).toBeCloseTo(20, 6);
    const f = spineFace(rect(40, 80, 20, 140))!;
    expect(f.trim).toEqual([0, 0]);
    expect(f.oblique).toBe(false);
    close(f.quad, canonical(rect(40, 80, 20, 140)), 1);
  });

  it("trims a top face seen from above, sheared to one side of the spine", () => {
    // Spine face x 0..20, y 30..150; the top face is a parallelogram above it leaning 12 px right (y 0..30).
    const outline: Point[] = [[12, 0], [32, 0], [20, 30], [20, 150], [0, 150], [0, 30]];
    const f = spineFace(outline)!;
    expect(f.oblique).toBe(true);
    expect(f.trim[0]).toBeGreaterThan(0.1);
    expect(f.trim[1]).toBe(0);
    const ys = f.quad.map((p) => p[1]);
    expect(Math.min(...ys)).toBeGreaterThan(18); // the face starts near y = 30, not at the top face
    expect(Math.max(...ys)).toBeGreaterThan(145);
  });

  it("keeps a perspective trapezoid's converging sides, so the readers' warp rectifies it", () => {
    const trapezoid: Point[] = [[0, 0], [30, 0], [24, 200], [6, 200]];
    const f = spineFace(trapezoid)!;
    expect(f.convergenceDeg).toBeGreaterThan(2);
    expect(f.oblique).toBe(true);
    const top = f.quad.filter((p) => p[1] < 100).map((p) => p[0]).sort((a, b) => a - b);
    const bottom = f.quad.filter((p) => p[1] >= 100).map((p) => p[0]).sort((a, b) => a - b);
    expect(top[1]! - top[0]!).toBeGreaterThan(bottom[1]! - bottom[0]! + 6);
  });

  it("returns null for a degenerate outline", () => {
    expect(spineFace([[0, 0], [1, 1]])).toBeNull();
  });
});

describe("crop methods", () => {
  const frame = { width: 300, height: 300 };
  it("F-0's method reproduces #23: the polygon as given, 90 and 270", () => {
    const lying = rect(100, 100, 120, 20);
    const c = cropFor({ polygon: lying }, frame, F0_CROP)!;
    expect(c.rotations).toEqual([90, 270]);
    close(c.polygon, canonical(lying));
    expect(c.crop).toBe("rect;rot=fixed");
  });
  it("names every step in the provenance string", () => {
    expect(cropName({ orient: "long-axis", clip: true, face: true, pad: 0.04 })).toBe("face;rot=long-axis;clip=frame;pad=0.04");
  });
  it("orients and clips a lying spine off the left edge", () => {
    const c = cropFor({ polygon: rect(30, 100, 120, 20) }, frame, { orient: "long-axis", clip: true, face: false, pad: 0 })!;
    expect(c.rotations).toEqual([0, 180]);
    for (const [x] of c.polygon) expect(x).toBeGreaterThanOrEqual(0);
  });
  it("uses the outline's face only when the method asks and an outline exists", () => {
    const outline: Point[] = [[112, 0], [132, 0], [120, 30], [120, 150], [100, 150], [100, 30]];
    const polygon = minAreaRect(outline);
    const withFace = cropFor({ polygon: rect(polygon.centre[0], polygon.centre[1], polygon.width, polygon.length), outline }, frame, { orient: "long-axis", clip: true, face: true, pad: 0 })!;
    expect(Math.min(...withFace.polygon.map((p) => p[1]))).toBeGreaterThan(18);
    const noOutline = cropFor({ polygon: rect(116, 75, 32, 150) }, frame, { orient: "long-axis", clip: true, face: true, pad: 0 })!;
    expect(Math.min(...noOutline.polygon.map((p) => p[1]))).toBeCloseTo(0, 6);
  });
});

describe("F-0's reader request", () => {
  const det = {
    id: "img",
    width: 300,
    height: 300,
    spines: [
      { polygon: canonical(rect(100, 100, 20, 120)) as never, boxScore: 0.4, maskScore: 0.9, aspect: 6, cut: false },
      { polygon: canonical(rect(100, 20, 20, 120)) as never, boxScore: 0.4, maskScore: 0.9, aspect: 6, cut: false },
      { polygon: canonical(rect(100, -200, 20, 120)) as never, boxScore: 0.4, maskScore: 0.9, aspect: 6, cut: false },
    ],
    bands: [],
    gaps: { bandLength: 0, gapLength: 0, gapCount: 0, medianWidth: 0 },
    tiles: 1,
    seconds: 0,
  };
  const images = [{ id: "img", photoHash: "h", path: "/nowhere.jpg", setting: "test" }];

  it("ships the clip: a box off the top edge is trimmed into the frame, and every request names its crop", () => {
    expect(cropName(CROP)).toBe("rect;rot=fixed;clip=frame");
    const reqs = spineRequests(images, new Map([["img", det]]), CROP);
    expect(reqs.map((r) => r.id)).toEqual(["img:0", "img:1"]); // the third is wholly outside: not read
    expect(reqs.every((r) => r.crop === cropName(CROP) && r.rotations.join() === "90,270")).toBe(true);
    close(reqs[0]!.polygon, canonical(rect(100, 100, 20, 120)));
    for (const [, y] of reqs[1]!.polygon) expect(y).toBeGreaterThanOrEqual(0);
  });

  it("F-0's original method still reproduces #23's request", () => {
    const reqs = spineRequests(images, new Map([["img", det]]), F0_CROP);
    expect(reqs).toHaveLength(3);
    expect(reqs[1]!.polygon.some(([, y]) => y < 0)).toBe(true);
  });
});
