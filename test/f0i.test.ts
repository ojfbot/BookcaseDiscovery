// F-0i: the instance partition's gate, resolve step and seam, the `mask=own` crop name, the changed set, book loss
// and the keep rules. Synthetic data only.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cropName, OWN_CROP, type Point } from "../src/perceive/crop.ts";
import { CROP, type Detection } from "../src/eval/f0.ts";
import { bookLoss, changedSet, verdictOf, type PartRow } from "../src/eval/f0i-cli.ts";

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

describe("crop names and the changed set", () => {
  it("names the masked crop so its readings never mix with the shipped crop's", () => {
    expect(cropName(OWN_CROP)).toBe("rect;rot=fixed;clip=frame;mask=own");
    expect(cropName(CROP)).toBe("rect;rot=fixed;clip=frame");
  });

  it("counts a box as changed only when its refit crop moves a corner more than 1 px", () => {
    const det = { id: "p", width: 400, height: 300, spines: [rect(10, 10, 50, 290), rect(60, 10, 100, 290), rect(110, 10, 150, 290)].map((polygon) => ({ polygon, boxScore: 0.5, maskScore: 0.9, aspect: 7, cut: false })) } as unknown as Detection;
    const part = new Map<string, PartRow>([
      ["p:0", { id: "p:0", state: "kept", reason: null, role: "member", changed: true, flagged: false, refit: rect(10.5, 10, 50.5, 290) }],
      ["p:1", { id: "p:1", state: "kept", reason: null, role: "member", changed: true, flagged: false, refit: rect(60, 10, 90, 290) }],
      ["p:2", { id: "p:2", state: "dropped", reason: "duplicate", role: "member", changed: false, flagged: false, refit: rect(110, 10, 140, 290) }],
    ]);
    expect([...changedSet(new Map([["p", det]]), part)]).toEqual(["p:1"]);
  });
});

describe("book loss by geometry", () => {
  it("counts a work only when every box accepting it in that photo was dropped", () => {
    const part = new Map<string, PartRow>(
      ["a:0", "a:1", "a:2", "b:0"].map((id, k) => [id, { id, state: k === 0 || k === 3 ? "dropped" : "kept", reason: null, role: "member", changed: false, flagged: false }]),
    );
    const work: Record<string, string> = { "a:0": "w1", "a:1": "w1", "a:2": "w2", "b:0": "w1" };
    const r = bookLoss(part, new Set(Object.keys(work)), (id) => work[id] ?? null);
    expect(r).toEqual({ lost: 1, droppedAccepting: 2 }); // a's w1 survives on a:1; b's w1 is lost
  });
});

describe("keep rules", () => {
  const tri = (share: number) => ({ share, lo: share, hi: share });
  const d = (delta: number, lo: number, hi: number) => ({ before: 10, after: 10 + delta, delta, lo, hi });
  const set = (over: Record<string, unknown> = {}) => ({
    geometry: { overlapRate_after: tri(0.001), cropsNeighbour10pct: { delta: [-0.05, -0.07, -0.03] } },
    bookLoss: { lost: 0 },
    arms: { refit: { all: { confirmed: d(1, 0.2, 2), wrong: d(0, -0.5, 0.5) }, distinctConfirmedWorks: { delta: { value: 2 } }, titles: { delta: { recall: [0.01, -0.01, 0.03] } } } },
    ...over,
  });
  it("ships the partition on the overlap target and no book lost, and a crop only on every reader guard", () => {
    const v = verdictOf({ "pilot-000": set(), "yardstick-library-b2": set() })!;
    expect(v.partition.ships).toBe(true);
    expect(v.refit!.keep).toBe(true);
    expect(v.readerCropShips).toBe("refit");
    const lost = verdictOf({ "pilot-000": set({ bookLoss: { lost: 1 } }), "yardstick-library-b2": set() })!;
    expect(lost.partition.ships).toBe(false);
    expect(lost.refit!.keep).toBe(false);
    const flat = set();
    (flat.arms.refit.all as any).confirmed = d(1, -0.1, 2);
    expect(verdictOf({ "pilot-000": flat, "yardstick-library-b2": set() })!.readerCropShips).toBeNull();
  });
});

const HELPER = join(import.meta.dirname, "..", "helpers", "coverage");
const PY = join(HELPER, ".venv", "bin", "python");

const SYNTH = `
import sys, cv2, numpy as np
rng = np.random.default_rng(0)
img = (rng.random((300, 400, 3)) * 60 + 100).astype(np.uint8)
for x0 in range(50, 400, 50):
    img[:, x0:x0 + 2] = 20
cv2.imwrite(sys.argv[1], img)
`;

/** Boxes (x0, x1 across a 300 px tall band) and outlines that conflict in each of the gate's ways. */
const BOXES: { box: [number, number, number, number]; outline: [number, number, number, number]; score: number }[] = [
  { box: [50, 20, 90, 280], outline: [50, 20, 90, 280], score: 0.9 }, // 0 a spine
  { box: [52, 20, 92, 280], outline: [52, 20, 92, 280], score: 0.5 }, // 1 its duplicate: dropped
  { box: [100, 20, 140, 280], outline: [85, 20, 140, 280], score: 0.8 }, // 2 bleeds into 0
  { box: [105, 100, 135, 160], outline: [105, 100, 135, 160], score: 0.7 }, // 3 a piece inside 2: dropped
  { box: [200, 20, 300, 280], outline: [200, 20, 300, 280], score: 0.6 }, // 4 a two-book parent with one child: remainder
  { box: [200, 20, 240, 280], outline: [200, 20, 240, 280], score: 0.7 }, // 5 that child
  { box: [320, 20, 360, 280], outline: [320, 20, 360, 280], score: 0.9 }, // 6 a spine
  { box: [321, 20, 361, 280], outline: [321, 20, 361, 280], score: 0.4 }, // 7 its duplicate, the only box accepting w1: guarded
];

describe.skipIf(!existsSync(PY))("helpers/coverage resolve.py (synthetic photo)", () => {
  it("gates, resolves every contested pixel to one owner and keeps the only box accepting a work", () => {
    const dir = mkdtempSync(join(tmpdir(), "f0i-"));
    try {
      const image = join(dir, "p.png");
      execFileSync(PY, ["-I", "-c", SYNTH, image]);
      const r = (b: number[]) => rect(b[0]!, b[1]!, b[2]!, b[3]!);
      writeFileSync(join(dir, "detect.jsonl"), JSON.stringify({ id: "p", width: 400, height: 300, bands: [{ polygon: rect(0, 0, 400, 300), spines: 8, span: 400, gap: 0 }], spines: BOXES.map((b) => ({ polygon: r(b.box), boxScore: b.score, maskScore: 1, aspect: 6, cut: false })) }) + "\n");
      writeFileSync(join(dir, "outlines.jsonl"), BOXES.map((b, i) => JSON.stringify({ id: `p:${i}`, outline: r(b.outline) })).join("\n") + "\n");
      writeFileSync(join(dir, "table.jsonl"), BOXES.map((_, i) => JSON.stringify({ id: `p:${i}` })).join("\n") + "\n");
      writeFileSync(join(dir, "decisions.jsonl"), BOXES.map((_, i) => JSON.stringify({ id: `p:${i}`, accepted: i === 7 ? { workId: "w1" } : null })).join("\n") + "\n");
      writeFileSync(join(dir, "images.jsonl"), JSON.stringify({ id: "p", image }) + "\n");
      const args = ["--set", "synthetic", "--detect", join(dir, "detect.jsonl"), "--outlines", join(dir, "outlines.jsonl"), "--table", join(dir, "table.jsonl"), "--decisions", join(dir, "decisions.jsonl"), "--images", join(dir, "images.jsonl"), "--out", join(dir, "out")];
      const env = { ...process.env, BOOKCASE_DATA: dir }; // no depth cache here: the seam and depth steps stand down
      execFileSync(PY, ["-I", join(HELPER, "resolve.py"), "plan", ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
      const gate = new Map(readFileSync(join(dir, "out", "gate.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).map((x) => [x.id, x]));
      expect(gate.get("p:1")).toMatchObject({ state: "dropped", reason: "duplicate", of: "p:0" });
      expect(gate.get("p:3")).toMatchObject({ state: "dropped", reason: "piece-of", of: "p:2" });
      expect(gate.get("p:4")).toMatchObject({ state: "kept", role: "remainder", children: ["p:5"] });
      expect(gate.get("p:5")).toMatchObject({ state: "kept", role: "group-child" });
      expect(gate.get("p:6")).toMatchObject({ state: "dropped", reason: "duplicate", of: "p:7" }); // the guard moved the drop
      expect(gate.get("p:7")!.state).toBe("kept");
      const groups = readFileSync(join(dir, "out", "groups.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
      expect(groups.map((g) => g.members)).toEqual([["p:0", "p:2"]]);
      const w = groups[0].windows[0];
      expect(w.side).toBeGreaterThanOrEqual(301);
      expect(w.side).toBeLessThanOrEqual(602);
      expect(w.labels.map((l: number[]) => l.filter((x) => x === 0).length)).toEqual([1, 1]); // one negative on the neighbour each
      const m = JSON.parse(execFileSync(PY, ["-I", join(HELPER, "resolve.py"), "resolve", ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
      expect(m.overlapRate_before.share).toBeGreaterThan(0.05);
      expect(m.overlapRate_after.share).toBe(0);
      expect(m.groupsWithoutLogits).toBe(1); // no GPU here: the fallback decides
      expect(m.provenancePixelShare).toEqual({ fallback: 1 });
      const part = new Map(readFileSync(join(dir, "out", "partition.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).map((x) => [x.id, x]));
      expect(part.get("p:4")).toMatchObject({ state: "kept", changed: true });
      expect(part.get("p:4").refit).toHaveLength(4);
      expect(part.get("p:0").ends).toEqual({ top: "outline", bottom: "outline" }); // a side strip moved, not an end
      const b = readFileSync(join(dir, "out", "boundaries.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
      expect(b).toHaveLength(1);
      expect(b[0]).toMatchObject({ a: "p:0", b: "p:2", contested: 6 * 261, after: 0 }); // x 85..90 by y 20..280, edges included as fillPoly draws them
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("puts the seam on the strongest edge when the logits are undecided", () => {
    const code = `
import sys, json, numpy as np
sys.path.insert(0, sys.argv[1])
import resolve
ys, xs = np.mgrid[0:40, 0:12]
q = np.stack([xs.ravel() + 0.0, ys.ravel() + 0.0], 1)
p = np.full(len(q), 0.5)
runs = resolve.seam_runs(q, p, p, lambda t: (np.abs(t[:, 0] - 7.5) < 0.1).astype(float))
r = runs[0]
print(json.dumps({"rows": r["rows"], "toA": int(r["toA"].sum()), "edge": r["seamEdge"]}))
`;
    const out = JSON.parse(execFileSync(PY, ["-I", "-c", code, HELPER], { encoding: "utf8" }));
    expect(out).toEqual({ rows: 40, toA: 40 * 8, edge: 1 }); // columns 0..7 to a, the seam between 7 and 8
  });
});
