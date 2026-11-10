// NB-3: the depth and pixel causes, the post step's order and ship flags, the calibration, and the version-2 pixel
// probe on a synthetic image. Synthetic data only.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Kinds, KindedBox } from "../src/eval/f0c.ts";
import type { Polygon4 } from "../src/eval/labels.ts";
import { applyNb3, calibrate, depthOff, faceShares, NB3, NB3_SHIP, nb3Causes, npQuantile, pixelOff, type NB3Evidence } from "../src/eval/nb3.ts";
import type { LipFeatures } from "../src/eval/s1.ts";

const rect = (x0: number, y0: number, x1: number, y1: number): Polygon4 => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const frame = { width: 1000, height: 800 };
const strip: LipFeatures = { band: 0, inZone: 0.95, belowBoard: 0.9, dLip: 0.002, dSpine: 0.03, pixels: 400, lipHeightM: 0.04, lipBoardGapM: 0.005 };
/** A box that is mostly a gap and the back wall: little spine face. */
const gapFaces = { front: 10, edge: 5, top: 0, under: 20, cover: 5, behind: 60, pixels: 100 };
const bookFaces = { front: 85, edge: 5, top: 5, under: 0, cover: 5, behind: 0, pixels: 100 };
/** Smooth and warm (shelf wood), and printed (a spine) against the thresholds. */
const wood = { version: 2, edgeDensity: NB3.pixel.maxEdgeDensity, bandpass: NB3.pixel.maxBandpass, warm: NB3.pixel.minWarm, luma: 0.3 };
const printed = { version: 2, edgeDensity: NB3.pixel.maxEdgeDensity + 0.05, bandpass: NB3.pixel.maxBandpass + 0.01, warm: NB3.pixel.minWarm, luma: 0.3 };
const ev = (e: Partial<NB3Evidence>): NB3Evidence => ({ textFound: false, ...e });

describe("the depth cause", () => {
  it("removes a box with no reader text whose surface is mostly a gap, the back wall or an underside", () => {
    expect(depthOff(ev({ faces: gapFaces }))).toBe(true);
    expect(depthOff(ev({ faces: { ...gapFaces, behind: 0, under: 80 } }))).toBe(true);
  });

  it("keeps a box with reader text, a spine face, a receding cover or top, and an unmeasured box", () => {
    expect(depthOff(ev({ faces: gapFaces, textFound: true }))).toBe(false);
    expect(depthOff(ev({ faces: bookFaces }))).toBe(false);
    expect(depthOff(ev({ faces: { front: 5, edge: 5, top: 50, under: 0, cover: 40, behind: 0, pixels: 100 } }))).toBe(false);
    expect(depthOff(ev({ faces: { ...gapFaces, pixels: NB3.depth.minPx - 1 } }))).toBe(false);
    expect(depthOff(ev({ faces: { ...gapFaces, skip: "no-band" } }))).toBe(false);
    expect(depthOff(ev({ faces: null }))).toBe(false);
  });

  it("takes shares over every measured pixel, edge pixels included", () => {
    expect(faceShares(gapFaces)).toEqual({ front: 0.1, off: 0.8 });
  });
});

describe("the pixel cause", () => {
  it("removes a smooth, warm box with no reader text", () => {
    expect(pixelOff(ev({ probe: wood }))).toBe(true);
  });

  it("keeps a textured box, a cool box, a box with reader text and a version-1 probe", () => {
    expect(pixelOff(ev({ probe: printed }))).toBe(false);
    expect(pixelOff(ev({ probe: { ...wood, bandpass: NB3.pixel.maxBandpass + 0.001 } }))).toBe(false);
    expect(pixelOff(ev({ probe: { ...wood, warm: NB3.pixel.minWarm - 0.01 } }))).toBe(false);
    expect(pixelOff(ev({ probe: wood, textFound: true }))).toBe(false);
    expect(pixelOff(ev({ probe: { ...wood, version: undefined } }))).toBe(false);
    expect(pixelOff(ev({ probe: null }))).toBe(false);
  });
});

describe("the NB-3 post step", () => {
  const box = (ref: string, polygon: Polygon4, kind: KindedBox["kind"] = "spine", why: KindedBox["why"] = "spine"): KindedBox => ({ ref, kind, why, polygon, boxScore: 0.5 });
  const k: Kinds = {
    spines: [box("s0", rect(100, 500, 300, 520)), box("s1", rect(400, 300, 430, 500)), box("s2", rect(500, 300, 530, 500)), box("s3", rect(600, 300, 630, 500), "not-a-book", "flat-strip")],
    covers: [],
    dropped: [],
    spineHeight: 200,
    medianWidth: 30,
  };
  const evidence = [ev({ lip: strip, faces: gapFaces, probe: wood }), ev({ faces: gapFaces }), ev({ faces: bookFaces, probe: printed }), ev({ faces: gapFaces })];
  const all = { "on-lip": true, depth: true, pixel: true };

  it("lists every cause in rule order and names the first shipped one", () => {
    expect(nb3Causes(k.spines[0]!.polygon, evidence[0], frame)).toEqual(["on-lip", "depth", "pixel"]);
    const out = applyNb3(k, frame, (i) => evidence[i], all);
    expect(out.map((b) => [b.kind, b.why])).toEqual([["not-a-book", "on-lip"], ["not-a-book", "depth"], ["spine", "spine"], ["not-a-book", "flat-strip"]]);
    expect(applyNb3(k, frame, (i) => evidence[i], { ...all, "on-lip": false })[0]!.why).toBe("depth");
  });

  it("leaves boxes alone when no cause ships, records the causes anyway, and honours the box set", () => {
    const off = applyNb3(k, frame, (i) => evidence[i], { "on-lip": false, depth: false, pixel: false });
    expect(off.map((b) => b.kind)).toEqual(["spine", "spine", "spine", "not-a-book"]);
    expect(off[1]!.causes).toEqual(["depth"]);
    expect(off[3]!.causes).toEqual([]);
    expect(applyNb3(k, frame, (i) => evidence[i], all, (i) => i !== 1)[1]!.kind).toBe("spine");
    expect(applyNb3(k, frame, () => undefined, all).map((b) => b.kind)).toEqual(["spine", "spine", "spine", "not-a-book"]);
  });

  it("ships only what evals/NB3 decided", () => {
    expect(Object.keys(NB3_SHIP).sort()).toEqual(["depth", "on-lip", "pixel"]);
  });
});

describe("the pixel calibration", () => {
  it("takes numpy's linear quantiles of the reference boxes", () => {
    expect(npQuantile([1, 2, 3, 4, 5], 0.05)).toBeCloseTo(1.2);
    const ref = Array.from({ length: 101 }, (_, i) => ({ version: 2, edgeDensity: i / 100, bandpass: i / 1000, warm: 0.3 + i / 1000 }));
    expect(calibrate(ref)).toEqual({ maxEdgeDensity: 0.05, maxBandpass: 0.005, minWarm: 0.395, n: 101 });
    expect(() => calibrate([{ version: 1 }])).toThrow();
  });
});

const PY = join(import.meta.dirname, "..", "helpers", "label", ".venv", "bin", "python");
describe.skipIf(!existsSync(PY))("helpers/label/probe.py, version 2", () => {
  it("keeps version 1's values and tells smooth warm wood from a printed spine", () => {
    const dir = mkdtempSync(join(tmpdir(), "nb3-"));
    try {
      const img = join(dir, "synthetic.png");
      execFileSync(PY, ["-I", "-c", `
import sys, numpy as np, cv2
im = np.zeros((300, 400, 3), np.uint8)
im[:, :200] = (40, 90, 150)  # BGR: a smooth brown board
rng = np.random.default_rng(0)
im[:, 200:] = (200, 200, 200)
for y in range(20, 280, 14):
    im[y:y + 6, 220:380] = rng.integers(0, 80, (6, 160, 3))  # rows of dark lettering
cv2.imwrite(sys.argv[1], im)
`, img]);
      writeFileSync(join(dir, "detect.jsonl"), JSON.stringify({ id: "p", spines: [{ polygon: [[20, 10], [180, 10], [180, 290], [20, 290]] }, { polygon: [[210, 10], [390, 10], [390, 290], [210, 290]] }] }) + "\n");
      writeFileSync(join(dir, "images.jsonl"), JSON.stringify({ id: "p", image: img }) + "\n");
      const out = execFileSync(PY, ["-I", join(import.meta.dirname, "..", "helpers", "label", "probe.py"), "--detect", join(dir, "detect.jsonl"), "--images", join(dir, "images.jsonl")], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      expect(out.map((r) => r.id)).toEqual(["p:s0", "p:s1"]);
      const [board, spine] = out;
      expect(board.version).toBe(2);
      for (const k of ["white", "edges", "value", "edgeDensity", "bandpass", "warm", "luma"]) expect(typeof board[k]).toBe("number");
      expect(board.edgeDensity).toBeLessThan(0.01);
      expect(board.bandpass).toBeLessThan(0.002);
      expect(board.warm).toBeGreaterThan(0.45);
      expect(spine.edgeDensity).toBeGreaterThan(board.edgeDensity + 0.05);
      expect(spine.warm).toBeLessThan(board.warm);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
