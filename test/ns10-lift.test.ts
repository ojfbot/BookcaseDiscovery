// NS-10: helpers/fusion/lift.py's plane fit and box rasterisation on synthetic points (skipped when the helper's .venv is absent).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(import.meta.dirname, "..", "helpers", "fusion");
const PY = join(DIR, ".venv", "bin", "python");

describe.skipIf(!existsSync(PY))("helpers/fusion/lift.py", () => {
  it("fits the plane through noisy points of a tilted wall and ignores outliers", () => {
    const code = `
import sys, json
import numpy as np
sys.path.insert(0, ${JSON.stringify(DIR)})
import lift
rng = np.random.default_rng(1)
n = np.array([0.0, 0.2, 1.0]); n /= np.linalg.norm(n)
a = np.cross(n, [1, 0, 0]); a /= np.linalg.norm(a); b = np.cross(n, a)
pts = rng.uniform(-1, 1, (4000, 1)) * a + rng.uniform(-1, 1, (4000, 1)) * b + 2.0 * n + rng.normal(0, 0.002, (4000, 3)) * n
pts = np.vstack([pts, rng.uniform(-1, 1, (400, 3)) + [0, 0, 1]])
fit = lift.fit_plane(pts, 0.01, np.random.default_rng(2))
nn, d = fit
print(json.dumps({"cos": abs(float(nn @ n)), "offset": abs(d)}))
m = lift.box_pixels([[10, 10], [30, 10], [30, 50], [10, 50]], (0.5, 0.5), (14, 0), (40, 60))
print(json.dumps({"area": int(m.sum()), "x0": int(np.nonzero(m.any(0))[0][0]), "y1": int(np.nonzero(m.any(1))[0][-1])}))
`;
    const out = execFileSync(PY, ["-I", "-c", code], { encoding: "utf8" }).trim().split("\n").map((l) => JSON.parse(l));
    expect(out[0].cos).toBeGreaterThan(0.999);
    expect(out[0].offset).toBeCloseTo(2, 1);
    // the box (20 x 40 px) at half scale is 10 x 20, moved right by 14: columns 19..29, rows 5..25
    expect(out[1].x0).toBe(19);
    expect(out[1].y1).toBe(25);
    expect(out[1].area).toBeGreaterThan(150);
  });
});
