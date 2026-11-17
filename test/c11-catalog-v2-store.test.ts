// C-11: c5-eval's `--run`, `--min-reproduced` and outcome flow, used to re-decide the store samples on v2 without
// touching C-5's record. Synthetic rows only.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cardOf, checkReproduced, checkRun, outcomeFlow, outcomeOf, partsDir, publish } from "../src/eval/c5-eval.ts";

type Row = { accepted: string | null; reason: string | null };
const box = (accepted: string | null, reason: string | null = accepted ? null : "no-catalog-match"): Row => ({ accepted, reason });

describe("run ids", () => {
  it("accepts card ids and names the card", () => {
    expect(checkRun("C11")).toBe("C11");
    expect(cardOf("C11")).toBe("C-11");
    expect(cardOf("C5")).toBe("C-5");
  });
  it("refuses anything that could be a path", () => {
    for (const bad of ["../C5", "c11", "C11/x", "", "C"]) expect(() => checkRun(bad)).toThrow(/--run/);
  });
  it("keeps each run's parts in its own folder", () => {
    const root = mkdtempSync(join(tmpdir(), "c11-parts-"));
    try {
      expect(partsDir("C5", root)).toBe(join(root, "catalog", "c5"));
      expect(partsDir("C11", root)).toBe(join(root, "catalog", "c11"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("reproduction gate", () => {
  it("passes at or above the bar and when no bar is set", () => {
    expect(() => checkReproduced("s", 0.99, 0.99)).not.toThrow();
    expect(() => checkReproduced("s", 1, 0.99)).not.toThrow();
    expect(() => checkReproduced("s", 0.5, undefined)).not.toThrow();
  });
  it("stops before v2 below the bar", () => {
    expect(() => checkReproduced("s", 0.9899, 0.99)).toThrow(/stopped before v2/);
  });
});

describe("outcome flow", () => {
  it("names a box by its acceptance or its reason", () => {
    expect(outcomeOf(box("w1"))).toBe("accepted");
    expect(outcomeOf(box(null, "no-text"))).toBe("no-text");
  });
  it("counts where v1's outcomes went on v2, and the no-catalog-match headline", () => {
    const paired = [
      { imageId: "p1", a: box(null), b: box("w1") }, // no-catalog-match -> accepted
      { imageId: "p1", a: box(null), b: box(null, "single-reader") }, // no-catalog-match -> single-reader
      { imageId: "p2", a: box(null), b: box(null) }, // stays
      { imageId: "p2", a: box(null), b: box(null) }, // stays
      { imageId: "p2", a: box("w2"), b: box(null, "readers-disagree") }, // lost
      { imageId: "p3", a: box(null, "no-text"), b: box(null, "no-text") },
    ];
    const f = outcomeFlow(paired, 200);
    expect(f.outcomes.v1).toEqual({ "no-catalog-match": 4, accepted: 1, "no-text": 1 });
    expect(f.outcomes.v2).toEqual({ accepted: 1, "single-reader": 1, "no-catalog-match": 2, "readers-disagree": 1, "no-text": 1 });
    expect(f.flow["no-catalog-match"]).toEqual({ accepted: 1, "single-reader": 1, "no-catalog-match": 2 });
    expect(f.flow.accepted).toEqual({ "readers-disagree": 1 });
    expect(f.noCatalogMatch.v1).toBe(4);
    expect(f.noCatalogMatch.toAccepted).toBe(1);
    expect(f.noCatalogMatch.leftNoCatalogMatch).toBe(2);
    expect(f.noCatalogMatch.toAcceptedShare!.value).toBeCloseTo(0.25);
    expect(f.noCatalogMatch.leftNoCatalogMatchShare!.value).toBeCloseTo(0.5);
    // Every v1 box is in the flow exactly once.
    const total = Object.values(f.flow).reduce((n, to) => n + Object.values(to).reduce((a, b) => a + b, 0), 0);
    expect(total).toBe(paired.length);
  });
});

describe("publish --run", () => {
  let root: string;
  let saved: string | undefined;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "c11-publish-"));
    saved = process.env.BOOKCASE_DATA;
    process.env.BOOKCASE_DATA = root;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.BOOKCASE_DATA;
    else process.env.BOOKCASE_DATA = saved;
    rmSync(root, { recursive: true, force: true });
  });

  it("joins only that run's parts into evals/<run>/metrics.json and leaves C-5's alone", () => {
    const c5 = join(root, "catalog", "c5");
    mkdirSync(c5, { recursive: true });
    writeFileSync(join(c5, "lookalike-pilot-000.json"), JSON.stringify({ set: "pilot-000" }));
    const c11 = partsDir("C11");
    writeFileSync(join(c11, "lookalike-a.json"), JSON.stringify({ set: "a" }));
    mkdirSync(join(c11, "private"), { recursive: true });
    writeFileSync(join(c11, "private", "a.json"), "[]");
    const evals = join(root, "evals");
    const file = publish("C11", evals);
    expect(file).toBe(join(evals, "C11", "metrics.json"));
    const m = JSON.parse(readFileSync(file, "utf8"));
    expect(m.runId).toBe("C11");
    expect(m.card).toBe("C-11");
    expect(Object.keys(m).filter((k) => k.startsWith("lookalike-"))).toEqual(["lookalike-a"]);
    expect(existsSync(join(evals, "C5"))).toBe(false);
  });
});
