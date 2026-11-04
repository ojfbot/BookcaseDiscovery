import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const HELPER = join(import.meta.dirname, "..", "helpers", "depth");
const PY = join(HELPER, ".venv", "bin", "python");

// A synthetic geometry map (no model run): a spine plane 1 m from the camera facing it, with a receding top face
// (normals up, 0–20 cm behind the plane) across rows 0–39. Box 0 takes in the top face, box 1 is spine only, and
// box 2 stands on a side plane turned 60° about the vertical, as a side case on a whole-case photo does.
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
side = (xs >= 120) & (xs < 150) & ~top
a = np.radians(60); n[side] = (np.sin(a), 0, -np.cos(a))
K = np.array([[2.5, 0, 0.5], [0, 2.0, 0.5], [0, 0, 1]], np.float32)
np.savez(sys.argv[1], points=p, normal=n, mask=np.ones((H, W), bool), intrinsics=K, scale=np.float32(1.0))
`;

describe.skipIf(!existsSync(PY))("helpers/depth faces on a synthetic geometry map", () => {
  it("splits the spine face from a top face, trims to it, sizes the cuboid and gives a side plane its own frame", () => {
    const dir = mkdtempSync(join(tmpdir(), "h1-"));
    try {
      execFileSync(PY, ["-I", "-c", SYNTH, join(dir, "g1.npz")]);
      const box = (x0: number, x1: number, y0: number, y1: number) => ({ polygon: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
      const detect = {
        id: "g1",
        width: 160,
        height: 200,
        spines: [box(20, 50, 8, 192), box(70, 100, 50, 192), box(120, 150, 50, 192)],
        bands: [{ polygon: [[0, 0], [160, 0], [160, 200], [0, 200]] }],
      };
      writeFileSync(join(dir, "d.jsonl"), JSON.stringify(detect) + "\n");
      const out = execFileSync(PY, ["-I", join(HELPER, "faces.py"), "--detect", join(dir, "d.jsonl"), "--geometry", dir], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      const rows = out.trim().split("\n").map((l) => JSON.parse(l));
      const boxes = rows.filter((r) => "box" in r);
      expect(boxes).toHaveLength(3);
      const [b0, b1, b2] = boxes;

      expect(b0.overSelects).toBe(true);
      expect(b0.top / b0.pixels).toBeGreaterThan(0.12);
      expect(b0.top / b0.pixels).toBeLessThan(0.22);
      expect(b0.trimFeasible).toBe(true);
      const trimTop = Math.min(...b0.trim.polygon.map((q: number[]) => q[1]));
      expect(trimTop).toBeGreaterThan(36);
      expect(trimTop).toBeLessThan(44);
      expect(b0.cuboid.depthSource).toBe("seen");
      expect(b0.cuboid.depthM).toBeGreaterThan(0.15);
      expect(b0.cuboid.depthM).toBeLessThan(0.21);
      expect(b0.cuboid.corners).toHaveLength(8);

      expect(b1.overSelects).toBe(false);
      expect(b1.front / b1.pixels).toBeGreaterThan(0.95);
      expect(b1.ownPlane).toBe(false);

      expect(b2.ownPlane).toBe(true);
      expect(b2.overSelects).toBe(false);

      const photo = rows.find((r) => r.photo);
      expect(Object.values(photo.frames).every((f: any) => f.upSource === "surfaces")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
