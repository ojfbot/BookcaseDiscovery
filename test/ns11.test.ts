// NS-11: the teacher table's admission rule, the measures, the group bootstrap and the development keep rule, and the
// student's input geometry. Synthetic data only; the student's Python part runs when helpers/geometry-student/.venv exists.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MONO_GEOMETRY_TARGETS_SCHEMA } from "../src/eval/lineage-classes.ts";
import { assertTrainable, roleOf } from "../src/eval/set-roles.ts";
import { NS11, admit, angleDeg, argmax, classCounts, clusterInterval, compare, keepRule, meanTarget, perBox, scoreArm, shareError, threeWay, unit, type Scored, type Vec3 } from "../src/eval/ns11.ts";

const counts = (front: number, top: number, cover: number, rest = 0) => ({ front, edge: rest, top, under: 0, cover, behind: 0, pixels: front + top + cover + rest });

describe("NS-11 targets", () => {
  it("takes the three-way shares over front + top + cover and leaves the other classes out", () => {
    const t = threeWay({ front: 60, edge: 10, top: 20, under: 0, cover: 20, behind: 10, pixels: 120 })!;
    expect(t.shares).toEqual([0.6, 0.2, 0.2]);
    expect(t.mass).toBeCloseTo(100 / 120);
    expect(threeWay({ ...counts(0, 0, 0), pixels: 0 })).toBeNull();
  });

  it("admits a box only with a face row, a mean normal and at least half its pixels in the three classes", () => {
    const n: Vec3 = [0, 0, -1];
    expect(admit(counts(80, 10, 10), n)).toMatchObject({ ok: true, shares: [0.8, 0.1, 0.1] });
    expect(admit(counts(10, 0, 0, 90), n)).toEqual({ ok: false, why: "low-mass" });
    expect(admit(counts(80, 10, 10), null)).toEqual({ ok: false, why: "no-normal" });
    expect(admit(null, n)).toEqual({ ok: false, why: "no-face-row" });
    expect(admit(counts(50, 0, 0, 50), n).ok).toBe(true); // exactly at the bar
  });

  it("registers the class and refuses to train on the yardstick", () => {
    expect(MONO_GEOMETRY_TARGETS_SCHEMA.name).toBe("ns11/mono-geometry-targets");
    expect(NS11.labelSource).toBe("mono-geometry");
    expect(NS11.rgbRecoverable).toBe("yes");
    expect(() => assertTrainable("pilot-000", "NS-11")).not.toThrow();
    expect(() => assertTrainable("yardstick-library-b2", "NS-11")).toThrow();
    expect(roleOf("yardstick-library-b2")).toBe("yardstick");
  });
});

describe("NS-11 measures", () => {
  it("measures the angle between unit normals and the mean absolute share error", () => {
    expect(angleDeg([0, 0, -1], [0, 0, -1])).toBeCloseTo(0);
    expect(angleDeg([1, 0, 0], [0, 1, 0])).toBeCloseTo(90);
    expect(angleDeg(unit([1, 1, 0]), [1, 0, 0])).toBeCloseTo(45);
    expect(shareError([1, 0, 0], [0.5, 0.25, 0.25])).toBeCloseTo((0.5 + 0.25 + 0.25) / 3);
    expect(argmax([0.2, 0.5, 0.3])).toBe(1);
    expect(argmax([0.4, 0.4, 0.2])).toBe(0);
  });

  it("takes the mean target as a mean distribution and a unit mean normal", () => {
    const m = meanTarget([{ y: [1, 0, 0], n: [1, 0, 0] }, { y: [0, 1, 0], n: [0, 1, 0] }]);
    expect(m.y).toEqual([0.5, 0.5, 0]);
    expect(m.n[0]).toBeCloseTo(Math.SQRT1_2);
    expect(classCounts([[0.9, 0.1, 0], [0.1, 0.8, 0.1], [0.2, 0.2, 0.6]])).toEqual({ spineFace: 1, topFace: 1, coverFace: 1 });
  });

  it("gives the same bootstrap interval for the same seed, and none for one cluster", () => {
    const xs = new Map([["a", [1, 2]], ["b", [3, 4]], ["c", [5, 6]]]);
    const stat = (d: readonly string[]) => d.flatMap((u) => xs.get(u)!).reduce((p, q) => p + q, 0) / d.flatMap((u) => xs.get(u)!).length;
    const one = clusterInterval(["a", "b", "c"], stat, 200, 7);
    expect(clusterInterval(["a", "b", "c"], stat, 200, 7)).toEqual(one);
    expect(one.lo).toBeLessThanOrEqual(one.value);
    expect(one.hi).toBeGreaterThanOrEqual(one.value);
    expect(Number.isNaN(clusterInterval(["a"], stat, 200, 7).lo)).toBe(true);
  });
});

/** Six clusters of boxes. The oracle (the cluster's own mean) has a fixed error; the student's error is `studentScale` of it. */
function synthetic(studentScale: number, normalNoiseDeg: number, oracleNoiseDeg = 6): Scored[] {
  const rows: Scored[] = [];
  for (let g = 0; g < 6; g++)
    for (let i = 0; i < 40; i++) {
      const top = 0.1 + 0.4 * ((i * 7 + g) % 10) / 10;
      const y: Vec3 = [1 - top, top, 0];
      const oracleY: Vec3 = [0.8, 0.2, 0];
      const studentY: Vec3 = [y[0]! + (oracleY[0] - y[0]!) * studentScale, y[1]! + (oracleY[1] - y[1]!) * studentScale, 0];
      const rot = (deg: number): Vec3 => [Math.sin((deg * Math.PI) / 180), 0, -Math.cos((deg * Math.PI) / 180)];
      rows.push({ unit: `g${g}`, y, n: rot(0), student: { y: studentY, n: rot(normalNoiseDeg) }, oracle: { y: oracleY, n: rot(oracleNoiseDeg) }, trainMean: { y: [0.7, 0.3, 0], n: rot(10) } });
    }
  return rows;
}

describe("NS-11 development keep rule", () => {
  it("keeps a student whose share error is far below the oracle constant and whose normals are 3 degrees closer", () => {
    const rule = keepRule(compare(synthetic(0.2, 3), "oracle"));
    expect(rule.k1.passes).toBe(true);
    expect(rule.k2.passes).toBe(true);
    expect(rule.kept).toBe(true);
  });

  it("does not keep a student that matches the oracle constant", () => {
    const rule = keepRule(compare(synthetic(1, 6), "oracle"));
    expect(rule.k1.passes).toBe(false);
    expect(rule.k2.passes).toBe(false);
    expect(rule.kept).toBe(false);
  });

  it("needs both K1 and K2: good shares with normals as bad as the oracle's are not kept", () => {
    const rule = keepRule(compare(synthetic(0.2, 6), "oracle"));
    expect(rule.k1.passes).toBe(true);
    expect(rule.k2.passes).toBe(false);
    expect(rule.kept).toBe(false);
  });

  it("scores top-1 agreement and per-class recall", () => {
    const rows = synthetic(0.2, 3);
    const s = scoreArm(rows, "student");
    expect(s.recall.spineFace.boxCount + s.recall.topFace.boxCount + s.recall.coverFace.boxCount).toBe(rows.length);
    expect(perBox(rows[0]!, "student").teacherClass).toBe(argmax(rows[0]!.y));
  });
});

const py = join(import.meta.dirname, "..", "helpers", "geometry-student", ".venv", "bin", "python");
describe.skipIf(!existsSync(py))("NS-11 student input (helpers/geometry-student)", () => {
  it("builds a 12-number geometry vector, a letterboxed 128x128 crop and a network under 10 million parameters", () => {
    const code = `
import sys, json
sys.argv = ["x"]
sys.path.insert(0, ${JSON.stringify(join(import.meta.dirname, "..", "helpers", "geometry-student"))})
import numpy as np, torch, student as S
poly = np.float64([[100, 50], [140, 50], [140, 350], [100, 350]])
g, (x0, y0, x1, y1) = S.geometry_vector(poly, 1000, 800, False)
box = S.letterbox(np.zeros((y1 - y0, x1 - x0, 3), np.uint8))
net = S.GeometryStudentNet().eval()
f, n = net(torch.zeros(2, 3, 128, 128), torch.zeros(2, 12))
print(json.dumps({"g": len(g), "box": [x0, y0, x1, y1], "crop": list(box.shape), "pad": int(box[0, 0, 0]), "params": S.n_params(net), "f": list(f.shape), "unit": float(n.norm(dim=1).mean().detach())}))`;
    const out = JSON.parse(execFileSync(py, ["-I", "-c", code], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" } }).trim().split("\n").pop()!);
    expect(out.g).toBe(12);
    expect(out.box).toEqual([92, 0, 148, 410]); // grown by 20 % of each side, clamped to the photo
    expect(out.crop).toEqual([128, 128, 3]);
    expect(out.pad).toBe(128); // the letterbox's grey, outside the thin crop
    expect(out.params).toBeLessThan(10_000_000);
    expect(out.f).toEqual([2, 3]);
    expect(out.unit).toBeCloseTo(1, 3);
  }, 60_000);
});
