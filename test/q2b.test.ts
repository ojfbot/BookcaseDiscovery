// Q-2b's comparison with Q-2: a pure function over two metrics files, checked on synthetic aggregates.
import { describe, expect, it } from "vitest";
import { compare } from "../src/eval/q2b-cli.ts";

type T = [number, number, number];
const PILOT = "pilot-000", YARD = "yardstick-library-b2";
const WHOLE = "floor0.225, whole only (no cut or partial)";

function metrics(auc: T, gain: T, whole: { auc: T; gain: T }, cut: number) {
  const model = { auc, ece: [0.03, 0.02, 0.05] as T, brier: [0.2, 0.19, 0.21] as T };
  return {
    teacher: { tau: 0.71, sets: { [PILOT]: { detected: { n: 100 }, population: { n: 60 }, populationFilled: [0.6, 0.55, 0.65] as T } } },
    student: {
      scores: { [PILOT]: { models: { student: model } }, [YARD]: { models: { student: model } } },
      goRule: { studentAuc: auc, gainOverBaseline: gain, go: auc[0] >= 0.75 && gain[1] > 0, robustness: { [PILOT]: { gainOverOracleWidth: gain, studentInSample: auc, studentVsSpineFound: auc, studentVsTextPresent: auc } } },
      operatingPoint: { fillP: 0.7, targetMet: false, bestPrecision: 0.82, atFillP: { [PILOT]: { precision: [0.78, 0.73, 0.82] as T, filledShare: [0.39, 0.33, 0.45] as T, recall: [0.5, 0.45, 0.55] as T } } },
      sensitivity: { [WHOLE]: { [PILOT]: { n: 30, student: whole.auc, gain: whole.gain } } },
    },
    fragments: { sets: { [PILOT]: { perPhotoMedian: { cutByTile: cut, partialOfUpright: 0.1 }, population: { whole: { n: 30, share: 0.5 }, cut: { n: 20, share: cut }, partial: { n: 10, share: 0.17 } } } } },
  };
}

describe("compare (Q-2 against Q-2b)", () => {
  it("states each run's verdict by Q-2's rule and whether whole-only agrees", () => {
    const q2 = metrics([0.729, 0.69, 0.76], [0.28, 0.21, 0.34], { auc: [0.72, 0.68, 0.77], gain: [0.19, 0.12, 0.25] }, 0.38);
    const q2b = metrics([0.77, 0.74, 0.8], [0.3, 0.2, 0.4], { auc: [0.74, 0.7, 0.78], gain: [0.2, 0.1, 0.3] }, 0.04);
    const { json, md } = compare(q2 as never, q2b as never);
    const v = json.vsQ2 as { q2: { go: boolean }; q2b: { go: boolean; wholeOnly: { go: boolean } }; wholeAndAllAgree: boolean };
    expect(v.q2.go).toBe(false);
    expect(v.q2b.go).toBe(true);
    expect(v.q2b.wholeOnly.go).toBe(false); // 0.74 is under the bar
    expect(v.wholeAndAllAgree).toBe(false);
    expect(md).toContain("| **verdict by Q-2's rule** | NO-GO | GO |");
    expect(md).toContain("| population: cut by a tile edge | 38.0 % | 4.0 % |");
    expect(md).toContain("disagree on the verdict");
  });

  it("does not pass a gain whose interval reaches 0", () => {
    const m = metrics([0.8, 0.77, 0.83], [0.05, -0.01, 0.1], { auc: [0.8, 0.77, 0.83], gain: [0.05, -0.01, 0.1] }, 0.04);
    const v = compare(m as never, m as never).json.vsQ2 as { q2b: { wholeOnly: { go: boolean } } };
    expect(v.q2b.wholeOnly.go).toBe(false);
  });
});
