import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ReaderVotes } from "../src/eval/f0.ts";
import { APPEARANCE_DEFAULT, appearanceMode } from "../src/eval/mm1.ts";
import {
  APPEARANCE,
  freeArm,
  galleryArm,
  marginThreshold,
  nearestEntries,
  quantile,
  shadowOnly,
  simulateCandidate,
  textThreshold,
  titleText,
  visualThreshold,
  type GalleryEntry,
} from "../src/identify/appearance.ts";

const v = (...xs: number[]): Float32Array => {
  const n = Math.hypot(...xs);
  return new Float32Array(xs.map((x) => x / n));
};
const entry = (id: string, group: string, workId: string, vec: Float32Array): GalleryEntry => ({ id, group, workId, vec });

describe("the appearance switch in MM-2", () => {
  it("stays off by default, and off means the runner does nothing", () => {
    expect(APPEARANCE_DEFAULT).toBe("off");
    expect(shadowOnly(appearanceMode([]))).toBe(false);
    expect(shadowOnly("shadow")).toBe(true);
  });
  it("refuses candidate and vote (owner gated, MM-3)", () => {
    expect(() => shadowOnly("candidate")).toThrow(/owner gated/);
    expect(() => shadowOnly("vote")).toThrow(/owner gated/);
  });
});

describe("titleText", () => {
  it("lowercases and collapses whitespace, as SigLIP 2 was trained", () => {
    expect(titleText("title", "  The LEFT Hand\nof Darkness ", ["Ursula K. Le Guin"])).toBe("the left hand of darkness");
    expect(titleText("title+author", "Dune", ["Frank Herbert", "x"])).toBe("dune frank herbert");
    expect(titleText("title+author", "Dune", [])).toBe("dune");
  });
});

describe("the gallery arm", () => {
  const g = [entry("a", "g1", "w1", v(1, 0, 0)), entry("b", "g2", "w2", v(0.9, 0.1, 0)), entry("c", "g2", "w3", v(0, 1, 0)), entry("d", "g1", "w4", v(1, 0.01, 0))];
  it("never matches an entry in the query's own split group", () => {
    const near = nearestEntries(v(1, 0, 0), "g1", g);
    expect(near.map((n) => g[n.entry]!.id)).toEqual(["b", "c"]);
  });
  it("nearness alone never qualifies: a near work with no text agreement is near-only", () => {
    const r = galleryArm(nearestEntries(v(1, 0, 0), "g9", g), g, () => 0, 0.8, 0.5);
    expect(r.proposal).toBeNull();
    expect(r.near).toBe(3);
    expect(r.nearOnly).toEqual(["w1", "w2", "w4"]);
  });
  it("text alone never qualifies: a work the text explains but that is not near is not proposed", () => {
    const r = galleryArm(nearestEntries(v(1, 0, 0), "g9", g), g, (w) => (w === "w3" ? 1 : 0), 0.8, 0.5);
    expect(r.proposal).toBeNull();
    expect(r.matches).toEqual([]);
  });
  it("proposes the best fused match when both sides pass", () => {
    const r = galleryArm(nearestEntries(v(1, 0, 0), "g9", g), g, (w) => ({ w1: 0.6, w2: 0.9, w4: 0.4 })[w] ?? 0, 0.8, 0.5);
    expect(r.matches.map((m) => m.workId)).toEqual(["w2", "w1"]);
    expect(r.proposal).toBe("w2");
    expect(r.nearOnly).toEqual(["w4"]);
    expect(r.nearest?.workId).toBe("w1");
  });
  it("looks only at the depth nearest entries", () => {
    const r = galleryArm(nearestEntries(v(1, 0, 0), "g9", g), g, () => 1, 0.8, 0.5, 1);
    expect(r.matches.map((m) => m.workId)).toEqual(["w1"]);
  });
});

describe("the gallery-free arm", () => {
  const pool = [{ workId: "a", vec: v(1, 0) }, { workId: "b", vec: v(0.8, 0.6) }];
  it("only ever proposes one of the text path's own candidates, above the margin", () => {
    const r = freeArm(v(1, 0.05), pool, 0.1);
    expect(r.top?.workId).toBe("a");
    expect(r.margin).toBeGreaterThan(0.1);
    expect(r.proposal).toBe("a");
    expect(freeArm(v(1, 0.05), pool, 0.5).proposal).toBeNull();
  });
  it("makes no proposal from a pool of one or none", () => {
    expect(freeArm(v(1, 0), pool.slice(0, 1), 0).proposal).toBeNull();
    expect(freeArm(v(1, 0), [], 0)).toEqual({ pool: 0, top: null, margin: null, proposal: null });
  });
});

describe("the candidate simulation (INV-6: one vote per reader model; pixels never confirm alone)", () => {
  const base = (confirmed: ReaderVotes["confirmed"], read: ReaderVotes["readText"] = { vision: true, ppocr: true, qwen: true }): ReaderVotes => ({ readText: read, top: {}, confirmed });
  it("with no proposal reproduces F-0's vote", () => {
    expect(simulateCandidate(base({ vision: "x", ppocr: "x" }), null, () => true).acceptedId).toBe("x");
    expect(simulateCandidate(base({ vision: "x" }), null, () => true).acceptedId).toBeNull();
  });
  it("a proposal one reader confirms does not accept on its own", () => {
    const r = simulateCandidate(base({}), "w", (reader) => reader === "vision");
    expect(r.acceptedId).toBeNull();
    expect(r.takers).toEqual(["vision"]);
  });
  it("a proposal no reader confirms goes nowhere", () => {
    const r = simulateCandidate(base({ vision: "x" }), "w", () => false);
    expect(r).toMatchObject({ acceptedId: null, takers: [], reason: "single-reader" });
  });
  it("a reader that confirms its own work keeps it; it never switches to the proposal", () => {
    const r = simulateCandidate(base({ vision: "x", ppocr: "y" }), "w", () => true);
    expect(r.takers).toEqual(["qwen"]);
    expect(r.acceptedId).toBeNull();
  });
  it("a reader that read no text cannot take a proposal", () => {
    const r = simulateCandidate(base({ vision: "w" }, { vision: true, ppocr: false, qwen: false }), "w", () => true);
    expect(r.takers).toEqual([]);
    expect(r.acceptedId).toBeNull();
  });
  it("two reader models confirming the proposal accept it, as F-0's vote would", () => {
    const r = simulateCandidate(base({ vision: "w" }), "w", (reader) => reader === "ppocr");
    expect(r).toMatchObject({ acceptedId: "w", agreeing: ["vision", "ppocr"], takers: ["ppocr"] });
  });
});

describe("thresholds", () => {
  it("quantile is nearest-rank", () => {
    expect(quantile([5, 1, 3, 2, 4], 0.1)).toBe(1);
    expect(quantile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(quantile([], 0.5)).toBeNull();
  });
  it("τv takes the lower of the two kinds of same-work pairs, or the only kind with enough pairs", () => {
    const hi = Array.from({ length: 20 }, (_, i) => 0.8 + i / 100);
    const lo = Array.from({ length: 20 }, (_, i) => 0.6 + i / 100);
    expect(visualThreshold(hi, lo)).toMatchObject({ tau: 0.61, used: "lower" });
    expect(visualThreshold(hi, lo.slice(0, 3))).toMatchObject({ tau: 0.81, used: "acrossGroups", withinPhoto: null });
    expect(() => visualThreshold([1], [1])).toThrow(/too few/);
  });
  it("τt is the smallest grid value every train lookalike stays under, else F-0's title bar", () => {
    expect(textThreshold([0.1, 0.45])).toEqual({ tau: 0.5, calibrated: true });
    expect(textThreshold([0.65])).toEqual({ tau: 0.7, calibrated: true });
    expect(textThreshold([0.9])).toEqual({ tau: APPEARANCE.text.fallback, calibrated: false });
    expect(textThreshold([])).toEqual({ tau: 0.5, calibrated: true });
  });
  it("δ is the smallest margin at which proposals agree with F-0 at least 95 %", () => {
    const rows = [...Array.from({ length: 19 }, () => ({ margin: 0.04, agrees: true })), { margin: 0.005, agrees: false }, { margin: 0.02, agrees: false }];
    expect(marginThreshold(rows)).toMatchObject({ delta: 0.01, calibrated: true, proposals: 20 });
    expect(marginThreshold([{ margin: 0.2, agrees: false }])).toMatchObject({ delta: APPEARANCE.free.fallback, calibrated: false });
  });
});

describe("the wall (INV-13): appearance never reaches taste", () => {
  it("nothing src/identify/appearance.ts imports, transitively, is under src/recommend or reads the owner's taste", () => {
    const seen = new Set<string>();
    const walk = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)[^"'\n]*?from\s+["'](\.[^"']+)["']/g)) walk(resolve(dirname(file), m[1]!));
    };
    walk(fileURLToPath(new URL("../src/identify/appearance.ts", import.meta.url)));
    const bad = [...seen].filter((f) => /[/\\]recommend[/\\]|profile/i.test(f));
    expect(bad).toEqual([]);
    expect(seen.size).toBeGreaterThan(1);
  });
});
