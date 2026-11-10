import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SECTION_FAMILIES } from "../src/catalog/work-features.ts";
import type { WorkFeatureTerms } from "../src/identify/section-prior.ts";
import {
  coShelving,
  featuresUnder,
  isOutOfPlace,
  pairWeight,
  parseShelfSignalMode,
  placeChecks,
  rowSection,
  SHELF,
  SHELF_SIGNAL_DEFAULT,
  shelfSignals,
  sightingsOf,
  signTermsOf,
  workShelfFeatures,
  type ConfirmedBox,
  type ShelfInput,
  type ShelfRow,
} from "../src/recommend/shelf-signals.ts";

const REPO = resolve(new URL("..", import.meta.url).pathname);

const T = (genre: string[], form: string | null, subject: string[] = []): WorkFeatureTerms => ({ genre, subject, form });
const FEATURES: Record<string, WorkFeatureTerms | null> = {
  sf1: T(["sf"], "novel"),
  sf2: T(["sf"], "novel"),
  sf3: T(["sf", "fantasy"], "novel"),
  sf4: T(["sf"], "novel"),
  poems: T(["literary"], "poetry"),
  crime: T(["crime"], "novel"),
  blank: null,
};
const features = (w: string) => FEATURES[w] ?? null;
const row = (key: string, members: string[], band = 0, caseKey = key.split("|")[0]!): ShelfRow => ({ key, caseKey, band, members });
const confirmed = (pairs: [string, string, string?][]) => new Map<string, ConfirmedBox>(pairs.map(([box, workId, basis]) => [box, { workId, basis: basis ?? "readers-agree" }]));

describe("the switch", () => {
  it("defaults to off, and off builds nothing", () => {
    expect(SHELF_SIGNAL_DEFAULT).toBe("off");
    expect(parseShelfSignalMode(undefined)).toBe("off");
    expect(() => parseShelfSignalMode("rank")).toThrow(/unknown mode/);
    const input: ShelfInput = { rows: [row("p|0", ["p:0", "p:1"])], confirmed: confirmed([["p:0", "sf1"], ["p:1", "sf2"]]), features, signs: new Map() };
    expect(shelfSignals("off", input)).toBeNull();
    const s = shelfSignals("shadow", input)!;
    expect(s.sightings).toHaveLength(2);
    expect(featuresUnder("shadow", s, "sf1")).toBeNull();
    expect(featuresUnder("off", s, "sf1")).toBeNull();
    expect(featuresUnder("on", s, "sf1")?.neighbours).toEqual([{ workId: "sf2", weight: 1, scope: "row" }]);
  });
});

describe("co-shelving", () => {
  const rows = [row("p|0", ["p:0", "p:1", "p:2", "p:3"], 0), row("p|1", ["p:4", "p:5"], 2), row("q|0", ["q:0", "q:1"], 0)];
  const conf = confirmed([
    ["p:0", "sf1"],
    ["p:2", "sf2"],
    ["p:3", "sf1"],
    ["p:5", "crime"],
    ["q:0", "sf2"],
    ["q:1", "poems"],
  ]);
  const ss = sightingsOf(rows, conf);

  it("counts position over every book box, confirmed or not", () => {
    expect(ss.map((s) => [s.boxId, s.position])).toEqual([["p:0", 0], ["p:2", 2], ["p:3", 3], ["p:5", 1], ["q:0", 0], ["q:1", 1]]);
  });

  it("weighs 1 / d in a row, caseWeight / bands apart in a case, nothing across cases or within one work", () => {
    const [p0, p2, p3, p5, q0] = ss;
    expect(pairWeight(p0!, p2!)).toEqual({ weight: 0.5, scope: "row" });
    expect(pairWeight(p0!, p5!)).toEqual({ weight: SHELF.caseWeight / 2, scope: "case" });
    expect(pairWeight(p2!, q0!)).toBeNull();
    expect(pairWeight(p0!, p3!)).toBeNull();
  });

  it("keeps each neighbour's maximum weight over sightings, never a sum (no popularity)", () => {
    const co = coShelving(ss);
    // sf1 is seen twice (p:0 and p:3): sf2 is 2 from one and 1 from the other; the nearer wins, not 1.5.
    expect(co.get("sf1")).toEqual([
      { workId: "sf2", weight: 1, scope: "row" },
      { workId: "crime", weight: 0.125, scope: "case" },
    ]);
    expect(co.get("poems")).toEqual([{ workId: "sf2", weight: 1, scope: "row" }]);
    // a work seen in two photos is not raised over one seen once: sf2's weights are each from its best sighting
    expect(co.get("sf2")!.map((n) => n.weight)).toEqual([1, 1, 0.125]);
  });
});

describe("section terms", () => {
  it("maps SC-1's sign through SECTION_GENRES: families to genre terms, canons to form terms", () => {
    expect(signTermsOf({ family: "sf-fantasy", confidence: 0.9 })).toEqual({ family: "sf-fantasy", confidence: 0.9, genre: ["sf", "fantasy"], form: [] });
    expect(signTermsOf({ family: "poetry-drama", confidence: 0.9 })?.form).toEqual(["poetry", "drama"]);
    expect(signTermsOf({ family: "classics", confidence: 0.9 })).toBeNull();
    expect(signTermsOf({ family: "sf", confidence: SHELF.signMinConfidence - 0.01 })).toBeNull();
    expect(signTermsOf(null)).toBeNull();
  });

  it("gives the mix the same sign terms KN-2's adapter does", async () => {
    const { signTerms } = await import("../src/eval/section-prior-cli.ts");
    for (const f of SECTION_FAMILIES) {
      const s = signTermsOf({ family: f, confidence: 1 });
      expect(s?.genre ?? [], f).toEqual(signTerms(f));
    }
  });

  it("builds the row's mix from confirmed members with KN-2's buildMix (two known, sign half a book)", () => {
    const r = row("p|0", ["p:0", "p:1", "p:2", "p:3"]);
    const conf = confirmed([["p:0", "sf1"], ["p:1", "crime"], ["p:3", "blank"]]);
    const signs = new Map([["p|0", { family: "sf", confidence: 0.8 }]]);
    const s = rowSection(r, { confirmed: conf, features, signs });
    expect(s.sign?.genre).toEqual(["sf"]);
    expect(s.mix?.neighbours).toBe(2);
    expect(s.mix?.sign).toBe(true);
    expect(s.mix?.shares.genre).toEqual({ sf: 0.6, crime: 0.4 });
    const one = rowSection(r, { confirmed: confirmed([["p:0", "sf1"]]), features, signs });
    expect(one.mix).toBeNull();
    expect(one.sign).not.toBeNull();
  });
});

describe("out of place (discovery, never a penalty)", () => {
  const r = row("p|0", ["p:0", "p:1", "p:2", "p:3", "p:4"]);
  const conf = confirmed([["p:0", "sf1"], ["p:1", "sf2"], ["p:2", "poems"], ["p:3", "sf4"], ["p:4", "blank"]]);
  const input: ShelfInput = { rows: [r], confirmed: conf, features, signs: new Map() };

  it("flags a work whose form differs from the others' majority, or whose genres are none of theirs", () => {
    const checks = placeChecks(r, input);
    const by = new Map(checks.map((c) => [c.workId, c]));
    expect(by.get("poems")).toMatchObject({ genre: true, form: true });
    expect(by.get("sf1")).toMatchObject({ genre: false, form: false });
    expect(isOutOfPlace(by.get("poems")!)).toBe(true);
  });

  it("is not determinable when either side is unknown: a missing term is never evidence", () => {
    const by = new Map(placeChecks(r, input).map((c) => [c.workId, c]));
    expect(by.get("blank")).toMatchObject({ genre: null, form: null });
    const two = row("q|0", ["q:0", "q:1"]);
    const c2 = placeChecks(two, { confirmed: confirmed([["q:0", "sf1"], ["q:1", "poems"]]), features, signs: new Map() });
    expect(c2.every((c) => c.genre === null && c.form === null)).toBe(true);
  });

  it("matches KN-2's stress-test rule on a row (others' mix with the sign, majorityForm)", () => {
    // A crime sign joins the others' mix as half a book; it does not put the poetry collection in place.
    const signs = new Map([["p|0", { family: "crime", confidence: 0.9 }]]);
    const by = new Map(placeChecks(r, { ...input, signs }).map((c) => [c.workId, c]));
    expect(by.get("poems")!.genre).toBe(true);
    expect(by.get("sf1")!.genre).toBe(false);
  });

  it("surfaces the flag as discovery; every weight and share is non-negative", () => {
    const s = shelfSignals("shadow", input)!;
    const f = workShelfFeatures(s, "poems");
    expect(f.discovery).toBe(true);
    expect(f.outOfPlace).toEqual([{ rowKey: "p|0", facets: ["genre", "form"] }]);
    const nums = JSON.stringify(workShelfFeatures(s, "poems")).match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(nums.every((n) => n >= 0)).toBe(true);
    expect(workShelfFeatures(s, "sf1").discovery).toBe(false);
  });
});

// --- I-4's structural test, extended (INV-13): one way, and never taste ----------------------------------------------

/** Every src file a module reaches by static relative import or re-export, transitively. */
function closure(entry: string): string[] {
  const seen = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+"(\.{1,2}\/[^"]+)"/gms)) walk(resolve(dirname(file), m[1]!));
    for (const m of text.matchAll(/import\(\s*"(\.{1,2}\/[^"]+)"\s*\)/g)) walk(resolve(dirname(file), m[1]!));
  };
  walk(entry);
  return [...seen];
}

const tsFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith(".ts") ? [p] : [];
  });

describe("the wall (INV-13), extended by KN-3: shelf signals flow one way, into recommend", () => {
  const NEW = /\/src\/recommend\/shelf-signals[^/]*\.ts$|\/src\/eval\/kn3[^/]*\.ts$/;

  it("nothing under src/identify, src/perceive or src/catalog reaches the shelf signals or KN-3's eval", () => {
    const roots = ["identify", "perceive", "catalog"].flatMap((d) => tsFiles(join(REPO, "src", d)));
    expect(roots.length).toBeGreaterThan(10);
    for (const f of roots) for (const r of closure(f)) expect(r, `${relative(REPO, f)} reaches ${relative(REPO, r)}`).not.toMatch(NEW);
  });

  it("nothing under src/identify imports recommend or the profile (I-4, unchanged)", () => {
    for (const f of tsFiles(join(REPO, "src", "identify"))) expect(readFileSync(f, "utf8"), f).not.toMatch(/from\s+"[^"]*(recommend|profile)[^"]*"/i);
  });

  it("the signals never read taste: no profile, seeds, overlay, vocabulary or lens in their import closure", () => {
    for (const entry of ["src/recommend/shelf-signals.ts", "src/eval/kn3.ts", "src/eval/kn3-cli.ts"]) {
      const files = closure(join(REPO, entry));
      expect(files.length).toBeGreaterThan(2);
      for (const f of files) expect(relative(REPO, f), `${entry} reaches ${relative(REPO, f)}`).not.toMatch(/profile|vocabulary|seeds|overlay|lens|taste|expand\.ts|review\.ts/i);
    }
  });

  it("reads no popularity: no edition count, year, rating, vote count, award or feature count", () => {
    const src = readFileSync(join(REPO, "src/recommend/shelf-signals.ts"), "utf8").replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, "");
    expect(src).not.toMatch(/edition|year|rating|popular|votes?Count|awards?|\.count\b/i);
  });
});
