import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const HELPER = join(import.meta.dirname, "..", "helpers", "representations");
const PY = join(HELPER, ".venv", "bin", "python");

// Two synthetic shelf photos (no model, no real photo): coloured book strips 30 px wide separated by 4 px dark gaps
// that sit 5 cm behind the spine plane, a wood-coloured shelf band below, and a soft illumination ramp from left to
// right. Geometry, class maps, boxes, outlines, the kept table and the stage rows are written as the real caches are.
const SYNTH = `
import json, sys, cv2, numpy as np
root = sys.argv[1]
H, W, BW, GAP = 240, 320, 30, 4
rng = np.random.default_rng(0)
geo = f"{root}/cache/geometry/moge-2-vitl-normal@cb0e8bb"; import os; os.makedirs(geo, exist_ok=True)
imgs, dets, outl, table, stage = [], [], [], [], []
for k in range(2):
    pid = f"p{k}"
    img = np.zeros((H, W, 3), np.float32); img[...] = (0.55, 0.38, 0.22)  # wood
    z = np.full((H, W), 1.5, np.float32); cls = np.full((H, W), 255, np.uint8)
    spines, x = [], 6
    while x + BW < W - 6:
        img[20:180, x:x + BW] = rng.uniform(0.2, 0.9, 3)
        z[20:180, x:x + BW] = 1.0; z[20:180, x + BW:x + BW + GAP] = 1.05
        img[20:180, x + BW:x + BW + GAP] *= 0.15
        cls[20:180, x:x + BW] = 0; cls[20:180, x + BW:x + BW + GAP] = 5
        spines.append({"polygon": [[x, 20], [x + BW, 20], [x + BW, 180], [x, 180]]})
        x += BW + GAP
    img *= np.linspace(0.6, 1.0, W)[None, :, None]
    cls[20:180, x:] = 255
    spines.append({"polygon": [[60, 190], [260, 190], [260, 200], [60, 200]]})  # a flagged strip on the shelf edge
    cv2.imwrite(f"{root}/{pid}.png", (np.clip(img, 0, 1)[..., ::-1] * 255).astype(np.uint8))
    ys, xs = np.mgrid[0:H, 0:W]
    pts = np.stack([(xs - W / 2) / 300 * z, (ys - H / 2) / 300 * z, z], -1).astype(np.float16)
    nrm = np.zeros((H, W, 3), np.float16); nrm[...] = (0, 0, -1)
    np.savez(f"{geo}/g{k}.npz", points=pts, normal=nrm, mask=np.ones((H, W), bool), intrinsics=np.eye(3, dtype=np.float32), scale=np.float32(1.0))
    os.makedirs(f"{root}/cache/faces/g{k}", exist_ok=True); cv2.imwrite(f"{root}/cache/faces/g{k}/f{k}.png", cls)
    n = len(spines)
    dets.append({"id": pid, "width": W, "height": H, "spines": spines, "bands": [{"polygon": [[0, 15], [W, 15], [W, 185], [0, 185]], "spines": n - 1}]})
    for i, s in enumerate(spines):
        outl.append({"id": f"{pid}:{i}", "outline": s["polygon"]})
        if i < n - 1: table.append({"id": f"{pid}:{i}"})
    imgs.append({"id": pid, "image": f"{root}/{pid}.png"})
    stage.append({"id": pid, "photo": True, "geometryKey": f"g{k}", "facesKey": f"f{k}"})
for name, rows in (("images", imgs), ("detect", dets), ("outlines", outl), ("table", table), ("stage", stage)):
    with open(f"{root}/{name}.jsonl", "w") as f: f.write("".join(json.dumps(r) + "\\n" for r in rows))
`;

const AUC = `
import sys; sys.path.insert(0, sys.argv[1])
import numpy as np, spike
assert spike.auc(np.array([1.0, 1.0]), np.array([0.0, 0.0])) == 1.0
assert spike.auc(np.array([0.5, 0.5]), np.array([0.5, 0.5])) == 0.5
ids = [f"x{i}" for i in range(40)]
assert spike.sample_ids(ids) == spike.sample_ids(list(reversed(ids))) and len(spike.sample_ids(ids)) == 10
print("ok")
`;

describe.skipIf(!existsSync(PY))("helpers/representations spike on synthetic shelves", () => {
  it("scores ties at one half and draws the same sample whatever the input order", () => {
    expect(execFileSync(PY, ["-I", "-c", AUC, HELPER]).toString().trim()).toBe("ok");
  });

  it("finds seams, depth edges and not-a-book classes, and prints aggregates only", () => {
    const dir = mkdtempSync(join(tmpdir(), "fr3-"));
    try {
      execFileSync(PY, ["-I", "-c", SYNTH, dir]);
      const out = join(dir, "priv");
      mkdirSync(out);
      const stdout = execFileSync(PY, [
        "-I", join(HELPER, "spike.py"),
        "--images", join(dir, "images.jsonl"), "--detect", join(dir, "detect.jsonl"),
        "--outlines", join(dir, "outlines.jsonl"), "--table", join(dir, "table.jsonl"),
        "--stage", join(dir, "stage.jsonl"), "--cache", join(dir, "cache"), "--out", out, "--no-render",
      ], { stdio: ["ignore", "pipe", "ignore"] }).toString();
      writeFileSync(join(dir, "metrics.json"), stdout);
      const m = JSON.parse(stdout);
      expect(m.sample.photos).toBe(2);
      expect(m.counts.seamPairs).toBeGreaterThan(10);
      // Gaps are dark and recessed: RGB and depth edges both sit on the seam far above chance.
      expect(m.representations.rgb.m3.mean).toBeGreaterThan(0.8);
      expect(m.representations.depth.m3.mean).toBeGreaterThan(0.8);
      expect(m.m3Chance.mean).toBeLessThan(0.5);
      expect(m.representations.rgb.m1.mean).toBeGreaterThan(0.7);
      // The gaps are behind the spine plane, so relative depth separates them perfectly; the flagged strip is found.
      expect(m.m4.behind["rel-depth"].separation.mean).toBeGreaterThan(0.95);
      expect(m.m4.flagged).toBeDefined();
      expect(stdout).not.toContain(dir);
      expect(existsSync(join(out, "per-photo.jsonl"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
