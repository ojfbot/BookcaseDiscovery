// NS-1: the per-case union scorer on synthetic label sets (no shoot data exists). Work ids are made up.
import { describe, expect, it } from "vitest";
import { NS1, scoreArm, scoreCase, type NS1Case, type Reading, type Still } from "../src/eval/ns1.ts";

const reads = (...ids: string[]): Reading[] => ids.map((k) => ({ key: k, rung: k.startsWith("c") ? "confirmed" : "text-read" }));
const still = (stillId: string, arm: Still["arm"], ...ids: string[]): Still => ({ stillId, arm, readings: reads(...ids) });
const kase = (caseId: string, stills: Still[], mode: NS1Case["mode"] = "controlled"): NS1Case => ({ caseId, mode, deviceClass: "metric-depth", stills });

describe("scoreCase", () => {
  const c = kase("A", [
    still("w", "whole-case", "c1", "c2", "c3", "t1"),
    still("o1", "overlap", "c1", "c2", "c4", "c5"),
    still("o2", "overlap", "c2", "c5", "c6", "t1", "t2"),
  ]);

  it("merges by work id across stills, so a work read twice counts once", () => {
    const s = scoreCase(c);
    expect(s).toMatchObject({ single: 4, overlap: 7, union: 8, both: 3, overlapOnly: 4, singleOnly: 1 });
    expect(s.overlapOnly + s.both).toBe(s.overlap);
    expect(s.singleOnly + s.both).toBe(s.single);
  });

  it("lift is the overlap union minus the single still, as a share of the case union", () => {
    expect(scoreCase(c).lift).toBeCloseTo((7 - 4) / 8);
  });

  it("is negative when the single still read more, and 0 for an empty case", () => {
    const worse = kase("B", [still("w", "whole-case", "c1", "c2", "c3"), still("o1", "overlap", "c1"), still("o2", "overlap", "c1")]);
    expect(scoreCase(worse).lift).toBeCloseTo(-2 / 3);
    const empty = kase("E", [still("w", "whole-case"), still("o1", "overlap"), still("o2", "overlap")]);
    expect(scoreCase(empty)).toMatchObject({ union: 0, lift: 0 });
  });

  it("reports confirmed apart and the union after each overlap still in shot order", () => {
    const s = scoreCase(c);
    expect(s.confirmed).toEqual({ union: 6, single: 3, overlap: 5 });
    expect(s.cumulative).toEqual([4, 7]);
  });

  it("refuses a case the arm did not run on", () => {
    expect(() => scoreCase(kase("X", [still("o1", "overlap", "c1"), still("o2", "overlap", "c2")]))).toThrow(/exactly one whole-case/);
    expect(() => scoreCase(kase("X", [still("w", "whole-case", "c1"), still("o1", "overlap", "c1")]))).toThrow(/2–3 overlap/);
    expect(() => scoreCase(kase("X", [still("w", "whole-case"), still("w", "overlap"), still("o2", "overlap")]))).toThrow(/repeats a still id/);
    expect(() => scoreCase(kase("X", [still("w", "whole-case", ""), still("o1", "overlap"), still("o2", "overlap")]))).toThrow(/no key/);
  });
});

describe("scoreArm", () => {
  const margin = (id: string, mode: NS1Case["mode"]) =>
    kase(id, [still("w", "whole-case", "c1", "c2", "c3", "c4"), still("o1", "overlap", "c1", "c2", "c3", "c4", "c5", "c6"), still("o2", "overlap", "c3", "c7")], mode);

  it("never pools real use with controlled", () => {
    const r = scoreArm([margin("A", "controlled"), margin("B", "real-use")]);
    expect(r.map((x) => x.stratum)).toEqual(["controlled|metric-depth", "real-use|metric-depth"]);
    expect(r.every((x) => x.cases === 1)).toBe(true);
  });

  it("gives no interval below the minimum case count, and the discordant counts instead", () => {
    const [r] = scoreArm([margin("A", "controlled"), margin("B", "controlled")]);
    expect(r).toMatchObject({ cases: 2, interval: null, overlapOnly: 6, singleOnly: 0 });
    expect(r!.pooledLift).toBeCloseTo(3 / 7);
    expect(r!.supportsMargin).toBe(true);
  });

  it("bootstraps over cases once there are enough, reproducibly", () => {
    const cases = Array.from({ length: NS1.minCasesForInterval }, (_, i) => margin(`K${i}`, "controlled"));
    const [a] = scoreArm(cases, 200, 7);
    const [b] = scoreArm(cases, 200, 7);
    expect(a!.interval).not.toBeNull();
    expect(a!.interval).toEqual(b!.interval);
    expect(a!.interval!.lo).toBeGreaterThan(0);
  });

  it("does not support margin when the lift is under the hypothesis", () => {
    const flat = kase("F", [still("w", "whole-case", "c1", "c2"), still("o1", "overlap", "c1", "c2"), still("o2", "overlap", "c1")]);
    expect(scoreArm([flat])[0]).toMatchObject({ pooledLift: 0, supportsMargin: false });
  });
});
