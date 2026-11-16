// F-0 on 4K, every 10th frame. Two things are tested here:
// - the check of #100's time projection against the actual run (prereg §3);
// - OC35 for the two held-out sessions. sf-store-004's and sf-store-005's every-10 parts may run through every stage,
//   which only measures them. They are never exported, trained on, manifested as a training source, or put in a
//   gallery.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DATASET } from "../src/capture/dataset.ts";
import { projectionCheck } from "../src/eval/f0-frames-cli.ts";
import { acceptSet, samplePart, STAGES, type Stage } from "../src/eval/set-paths.ts";
import { assertManifestable, assertTrainable, heldOutSessions, isTrainable, roleOf } from "../src/eval/set-roles.ts";
import { APPEARANCE } from "../src/identify/appearance.ts";

const REPO = fileURLToPath(new URL("../", import.meta.url));

describe("F0-4k-every-10: the projection check", () => {
  // #100's committed aggregates. The frames part ran each step once, so its steps are its timing rows.
  const f04k = JSON.parse(readFileSync(join(REPO, "evals", "F0-4k", "metrics.json"), "utf8"));
  const from = f04k.projection.from as string;
  const steps = f04k.time[from].steps as { name: string; seconds: number }[];

  it("reproduces #100's projected seconds for each session's every-10 run from its committed time", () => {
    const projected = (frames: number) => projectionCheck(steps, f04k.projection.sampleFrames, [{ part: "p", frames, steps: [] }]).parts[0]!.projected;
    const every10 = (session: string) => f04k.projection.runs.find((r: { session: string; every: number }) => r.session === session && r.every === 10);
    for (const session of ["sf-store-003", "sf-store-004", "sf-store-005"]) expect(projected(every10(session).frames)).toBe(every10(session).seconds);
    expect(f04k.projection.totals.find((t: { every: number }) => t.every === 10).seconds).toBe(62481);
  });

  it("on the reference itself, projects exactly what it measured", () => {
    const c = projectionCheck(steps, 20, [{ part: from, frames: 20, steps }]);
    expect(c.parts[0]!.projected).toBe(c.parts[0]!.actual);
    expect(c.parts[0]!.ratio).toBe(1);
    expect(c.parts[0]!.perStep.every((s) => s.ratio === null || s.ratio === 1)).toBe(true);
  });

  it("gives per-step and total ratios as actual ÷ projected, with a null where one side is missing", () => {
    const reference = [{ name: "a", seconds: 100 }, { name: "b", seconds: 10 }];
    const c = projectionCheck(reference, 20, [
      { part: "x", frames: 40, steps: [{ name: "a", seconds: 300 }, { name: "c", seconds: 5 }] },
      { part: "y", frames: 10, steps: [{ name: "a", seconds: 50 }, { name: "b", seconds: 5 }] },
    ]);
    const x = c.parts[0]!;
    expect(x.perStep).toEqual([
      { name: "a", projected: 200, actual: 300, ratio: 1.5 },
      { name: "b", projected: 20, actual: null, ratio: null },
      { name: "c", projected: null, actual: 5, ratio: null },
    ]);
    expect([x.projected, x.actual, x.ratio]).toEqual([220, 305, 1.39]);
    expect([c.parts[1]!.projected, c.parts[1]!.actual, c.parts[1]!.ratio]).toEqual([55, 55, 1]);
    expect(c.total).toEqual({ frames: 50, projected: 275, actual: 360, projectedHours: 0.08, actualHours: 0.1, ratio: 1.31 });
  });
});

describe("F0-4k-every-10: held-out sessions are measured, never trained on (OC35)", () => {
  const HELD = ["sf-store-004", "sf-store-005"];

  it("declares both sessions held out, and sf-store-003 a training source", () => {
    for (const s of HELD) {
      expect(roleOf(s)).toBe("held-out");
      expect(isTrainable(s)).toBe(false);
    }
    expect(roleOf("sf-store-003")).toBe("training-source");
  });

  it("lets every stage measure a held-out session's every-10 part", () => {
    for (const s of HELD) {
      expect(samplePart(`${s}.frames.every-10`)).toEqual({ session: s, every: 10, kind: "frames" });
      for (const stage of Object.keys(STAGES) as Stage[]) expect(acceptSet(stage, `${s}.frames.every-10`)).toBe(`${s}.frames.every-10`);
    }
  });

  it("never exports, trains on or manifests a part, the held-out sessions' or sf-store-003's", () => {
    for (const s of [...HELD, "sf-store-003"]) {
      const part = `${s}.frames.every-10`;
      expect(() => assertTrainable(part)).toThrow(/no declared set role/);
      expect(() => assertManifestable(part)).toThrow(/no declared set role/);
    }
  });

  it("never exports or trains on the held-out sessions themselves", () => {
    for (const s of HELD) expect(() => assertTrainable(s)).toThrow(/held-out set and is never exported for training/);
  });

  it("freezes them held-out in TS-0's split even though F-1's constant names only sf-store-002", () => {
    // TS-0's build (src/eval/ts0-cli.ts) unions F-1's constant with the registry's held-out sessions.
    expect(DATASET.heldOutSessions).toEqual(["sf-store-002"]);
    const frozen = [...new Set([...DATASET.heldOutSessions, ...heldOutSessions()])].sort();
    expect(frozen).toEqual(expect.arrayContaining(["sf-store-002", ...HELD]));
  });

  it("keeps the appearance gallery to the train split only", () => {
    expect(APPEARANCE.gallery.splits).toEqual(["train"]);
  });
});
