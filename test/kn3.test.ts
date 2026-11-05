import { describe, expect, it } from "vitest";
import type { WorkFeatureTerms } from "../src/identify/section-prior.ts";
import { coverage, homophily, knownOn, onePerWorkPair, pairsOf, placeRates, placeShuffle, scorePairs, sharesTerm, stability, verdicts } from "../src/eval/kn3.ts";
import { sightingsOf, type ConfirmedBox, type ShelfInput, type ShelfRow } from "../src/recommend/shelf-signals.ts";

const T = (genre: string[], form: string | null): WorkFeatureTerms => ({ genre, subject: [], form });
const row = (key: string, members: string[], band = 0): ShelfRow => ({ key, caseKey: key.split("|")[0]!, band, members });

/** Two photos whose rows are each one genre, and a third with mixed rows. */
function store(): ShelfInput {
  const feats: Record<string, WorkFeatureTerms> = {};
  const rows: ShelfRow[] = [];
  const confirmed = new Map<string, ConfirmedBox>();
  const put = (photo: string, k: number, band: number, works: [string, WorkFeatureTerms][]) => {
    const ids = works.map((_, i) => `${photo}:${k * 10 + i}`);
    rows.push(row(`${photo}|${k}`, ids, band));
    works.forEach(([w, t], i) => {
      feats[w] = t;
      confirmed.set(ids[i]!, { workId: w, basis: "readers-agree" });
    });
  };
  for (const photo of ["a", "b", "c", "d"]) {
    put(photo, 0, 0, [0, 1, 2, 3].map((i) => [`${photo}-sf${i}`, T(["sf"], "novel")]));
    put(photo, 1, 1, [0, 1, 2, 3].map((i) => [`${photo}-cr${i}`, T(["crime"], "story-collection")]));
  }
  put("a", 2, 2, [["a-poem", T(["literary"], "poetry")], ["a-sf9", T(["sf"], "novel")], ["a-sf8", T(["sf"], "novel")]]);
  return { rows, confirmed, features: (w) => feats[w] ?? null, signs: new Map() };
}

describe("term sharing", () => {
  it("knows a facet only when the work carries a term there", () => {
    expect(knownOn("genre", T([], "novel"))).toBe(false);
    expect(knownOn("either", T([], "novel"))).toBe(true);
    expect(knownOn("either", null)).toBe(false);
    expect(sharesTerm("either", T(["sf"], "novel"), T(["crime"], "novel"))).toBe(true);
    expect(sharesTerm("genre", T(["sf"], "novel"), T(["crime"], "novel"))).toBe(false);
    expect(sharesTerm("form", T(["sf"], null), T(["sf"], null))).toBe(false);
  });

  it("finds coherent rows more alike than the store-wide shuffle, with a photo-cluster interval", () => {
    const input = store();
    const ss = sightingsOf(input.rows, input.confirmed);
    const rowPairs = pairsOf(ss).filter((p) => p.scope === "row");
    const scored = scorePairs("either", rowPairs, ss, input.features);
    expect(scored).toHaveLength(rowPairs.length);
    // no pair's control draws from its own photo
    const h = homophily("either", scored);
    expect(h.H!).toBeGreaterThan(h.E!);
    expect(h.D![1]).toBeGreaterThan(0);
    expect(h.lift!).toBeGreaterThan(1);
    expect(h.shuffle.shuffles).toBe(200);
    expect(h.shuffle.p95!).toBeLessThan(h.H!);
  });

  it("finds nothing when rows are a random deal of the store (the control's expectation matches)", () => {
    // every work in every row shares nothing with anything: H = E = 0
    const feats = (w: string) => T([w], null);
    const rows = [row("a|0", ["a:0", "a:1", "a:2"]), row("b|0", ["b:0", "b:1"])];
    const confirmed = new Map<string, ConfirmedBox>([..."a:0 a:1 a:2 b:0 b:1".split(" ")].map((id) => [id, { workId: id.replace(":", "-"), basis: "readers-agree" }]));
    const ss = sightingsOf(rows, confirmed);
    const h = homophily("either", scorePairs("either", pairsOf(ss), ss, feats));
    expect(h.H).toBe(0);
    expect(h.E).toBe(0);
  });

  it("counts each unordered work pair once across photos", () => {
    const rows = [row("a|0", ["a:0", "a:1"]), row("b|0", ["b:0", "b:1"])];
    const confirmed = new Map<string, ConfirmedBox>([
      ["a:0", { workId: "x", basis: "readers-agree" }],
      ["a:1", { workId: "y", basis: "readers-agree" }],
      ["b:0", { workId: "y", basis: "readers-agree" }],
      ["b:1", { workId: "x", basis: "readers-agree" }],
    ]);
    const ps = pairsOf(sightingsOf(rows, confirmed));
    expect(ps).toHaveLength(2);
    expect(onePerWorkPair(ps).map((p) => p.imageId)).toEqual(["a"]);
  });
});

describe("the out-of-place flag against shuffled rows", () => {
  it("is rarer in coherent rows than in the same books dealt at random", () => {
    const input = store();
    const o = placeShuffle(input, 50, 7);
    expect(o.real.flagged.either).toBe(1); // the poetry collection among two sf novels... and nothing else
    expect(o.real.share.either!).toBeLessThan(o.shuffled.either.p05!);
  });

  it("counts determinable and flagged members per facet", () => {
    const r = placeRates([
      { boxId: "1", workId: "w", rowKey: "k", genre: true, form: null },
      { boxId: "2", workId: "v", rowKey: "k", genre: false, form: false },
      { boxId: "3", workId: "u", rowKey: "k", genre: null, form: null },
    ]);
    expect(r.determinable).toEqual({ either: 2, genre: 2, form: 1 });
    expect(r.flagged).toEqual({ either: 1, genre: 1, form: 0 });
  });
});

describe("coverage, stability, verdicts", () => {
  it("counts works and rows with each signal", () => {
    const c = coverage(store());
    expect(c.rows).toBe(9);
    expect(c.confirmedWorks).toBe(35);
    expect(c.coShelving.rowNeighbourShare).toBe(1);
    expect(c.sectionTerms.rowsWithMix).toBe(9);
    expect(c.outOfPlace.worksFlagged).toBe(1);
  });

  it("compares repeat sightings of one work only within one capture group", () => {
    const rows = [row("a|0", ["a:0", "a:1", "a:2"]), row("b|0", ["b:0", "b:1", "b:2"]), row("c|0", ["c:0", "c:1"])];
    const w = (id: string, workId: string): [string, ConfirmedBox] => [id, { workId, basis: "readers-agree" }];
    const confirmed = new Map([w("a:0", "x"), w("a:1", "y"), w("a:2", "z"), w("b:0", "x"), w("b:1", "y"), w("b:2", "q"), w("c:0", "x"), w("c:1", "y")]);
    const t = T(["sf"], "novel");
    const input: ShelfInput = { rows, confirmed, features: () => t, signs: new Map() };
    const s = stability(input, (p) => (p === "c" ? "g2" : "g1"));
    // x and y are each in a and b (group g1); c is another group
    expect(s.workPhotoPairs).toBe(2);
    expect(s.mixTopGenreAgreement).toEqual({ pairs: 2, share: 1 });
    // x's row neighbours: {y, z} and {y, q}: 1/3; y's: {x, z} and {x, q}: 1/3
    expect(s.neighbourJaccard.mean).toBe(0.3333);
  });

  it("recommends promotion only when the pre-registered rules hold, and the default stays off", () => {
    const input = store();
    const ss = sightingsOf(input.rows, input.confirmed);
    const primary = homophily("either", scorePairs("either", pairsOf(ss).filter((p) => p.scope === "row"), ss, input.features));
    const v = verdicts({ coverage: coverage(input), primary, place: placeShuffle(input, 50, 7) });
    expect(v.C1.holds && v.H1.holds && v.O1.holds).toBe(true);
    expect(v.coShelving).toMatch(/shadow → on/);
    expect(v.default).toBe("off");
    const none = verdicts({ coverage: coverage(input), primary: { ...primary, D: [0.01, -0.02, 0.04] }, place: placeShuffle(input, 50, 7) });
    expect(none.coShelving).toBe("stay in shadow");
  });
});
