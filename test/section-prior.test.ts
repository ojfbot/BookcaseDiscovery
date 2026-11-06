import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ReaderVotes } from "../src/eval/f0.ts";
import {
  affinity,
  assertNotConfirmer,
  buildMix,
  decisionUnder,
  majorityForm,
  parsePriorMode,
  PRIOR,
  PRIOR_DEFAULT,
  priorVote,
  rerank,
  type FeatureLookup,
  type RankedCandidate,
  type Rerank,
  type ShadowRecord,
  type WorkFeatureTerms,
} from "../src/identify/section-prior.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const wf = (genre: string[], form: string | null = "novel", subject: string[] = []): WorkFeatureTerms => ({ genre, subject, form });
const sfNovel = wf(["sf"]);
const fantasyNovel = wf(["fantasy"]);
const lookup = (m: Record<string, WorkFeatureTerms | null>): FeatureLookup => (id) => m[id] ?? null;
const cand = (workId: string, score: number, passes = true): RankedCandidate => ({ workId, score, passes });

describe("the switch", () => {
  it("defaults to off and rejects unknown modes", () => {
    expect(PRIOR_DEFAULT).toBe("off");
    expect(parsePriorMode(undefined)).toBe("off");
    expect(parsePriorMode("shadow")).toBe("shadow");
    expect(() => parsePriorMode("on")).toThrow(/unknown mode/);
  });

  it("refuses vote: the prior is never a confirmer", () => {
    expect(() => assertNotConfirmer("vote")).toThrow(/never/);
    for (const m of ["off", "shadow", "re-rank"] as const) expect(() => assertNotConfirmer(m)).not.toThrow();
  });

  it("changes no decision in off and shadow; re-rank reports the prior's vote", () => {
    const shadow: ShadowRecord = {
      id: "p:1",
      rowKey: "p|0",
      mix: { neighbours: 3, sign: false },
      readers: {},
      base: { accepted: null },
      prior: { accepted: "w2", agreeing: ["vision", "ppocr"], reason: null, change: "new-accept" },
    };
    expect(decisionUnder("off", { accepted: null }, shadow)).toEqual({ accepted: null });
    expect(decisionUnder("shadow", { accepted: null }, shadow)).toEqual({ accepted: null });
    expect(decisionUnder("re-rank", { accepted: null }, shadow)).toEqual({ accepted: "w2" });
    expect(() => decisionUnder("vote", { accepted: null }, shadow)).toThrow();
  });
});

describe("buildMix", () => {
  it("needs at least minNeighbours neighbours with known features", () => {
    expect(PRIOR.minNeighbours).toBe(2);
    expect(buildMix([sfNovel, null, wf([], null)])).toBeNull();
    expect(buildMix([sfNovel, sfNovel])).not.toBeNull();
  });

  it("never builds a mix from a sign alone", () => {
    expect(buildMix([sfNovel], { family: "fantasy", confidence: 1 }, () => ["fantasy"])).toBeNull();
  });

  it("gives each term its share of the facet's contributors", () => {
    const p = buildMix([sfNovel, sfNovel, wf(["sf", "horror"], "collection"), fantasyNovel])!;
    expect(p.neighbours).toBe(4);
    expect(p.shares.genre).toEqual({ sf: 0.75, horror: 0.25, fantasy: 0.25 });
    expect(p.shares.form).toEqual({ novel: 0.75, collection: 0.25 });
    expect(p.weight.subject).toBe(0);
  });

  it("adds a confident sign as a weak genre contributor only", () => {
    const p = buildMix([sfNovel, sfNovel], { family: "fantasy", confidence: 0.9 }, () => ["fantasy"])!;
    expect(p.sign).toBe(true);
    expect(p.weight.genre).toBe(2 + PRIOR.signWeight);
    expect(p.shares.genre.fantasy).toBeCloseTo(PRIOR.signWeight / (2 + PRIOR.signWeight), 4);
    expect(p.shares.form).toEqual({ novel: 1 });
    const low = buildMix([sfNovel, sfNovel], { family: "fantasy", confidence: PRIOR.signMinConfidence - 0.01 }, () => ["fantasy"])!;
    expect(low.sign).toBe(false);
    const unmapped = buildMix([sfNovel, sfNovel], { family: "fantasy", confidence: 1 }, () => [])!;
    expect(unmapped.sign).toBe(false);
  });
});

describe("affinity", () => {
  const p = buildMix([sfNovel, sfNovel, wf(["sf"], "collection", ["space"])])!;

  it("is null for an unknown work, so it is neither helped nor hurt", () => {
    expect(affinity(null, p)).toBeNull();
    expect(affinity(wf([], null), p)).toBeNull();
  });

  it("takes the best share per known facet, weighted", () => {
    // genre sf 1.0 (w 1), form novel 2/3 (w 1), subject unknown on the work: (1 + 0.6667) / 2.
    expect(affinity(sfNovel, p)).toBeCloseTo(0.8333, 3);
    // subject space 1.0 (w 0.5): (1 + 1/3 + 0.5) / 2.5.
    expect(affinity(wf(["sf"], "collection", ["space"]), p)).toBeCloseTo((1 + 1 / 3 + 0.5) / 2.5, 3);
    expect(affinity(wf(["romance"], "nonfiction"), p)).toBe(0);
  });
});

describe("rerank", () => {
  const p = buildMix([sfNovel, sfNovel, sfNovel])!;
  const feats = lookup({ top: wf(["romance"], "nonfiction"), fit: sfNovel, far: sfNovel, weak: wf(["romance"], "novel"), rare: null });

  it("does nothing without a mix or candidates", () => {
    expect(rerank([cand("top", 0.8)], null, feats).why).toBe("no-mix");
    expect(rerank([], p, feats).why).toBe("no-candidates");
  });

  it("moves a passing challenger in the band that fits the section", () => {
    const r = rerank([cand("top", 0.8), cand("fit", 0.78)], p, feats);
    expect(r).toMatchObject({ top: "top", prior: "fit", why: "moved", inBand: 1, separated: 1, topAffinity: 0, priorAffinity: 1 });
  });

  it("never moves a challenger below the band, or one that fails F-0's bar on its own text", () => {
    expect(rerank([cand("top", 0.8), cand("far", 0.8 - PRIOR.band - 0.01)], p, feats).why).toBe("no-challenger");
    expect(rerank([cand("top", 0.8), cand("fit", 0.79, false)], p, feats).why).toBe("no-challenger");
  });

  it("never displaces a top whose features are unknown (a thinly catalogued, rare book)", () => {
    const r = rerank([cand("rare", 0.8), cand("fit", 0.8)], p, feats);
    expect(r).toMatchObject({ top: "rare", prior: "rare", why: "top-unknown" });
  });

  it("keeps the top when the affinity gap is below minGap", () => {
    // Genres a third each, form all novel: both works fit at (1/3 + 1) / 2, so the mix does not separate them.
    const p2 = buildMix([sfNovel, wf(["romance"], "novel"), wf(["fantasy"], "novel")])!;
    const f2 = lookup({ a: wf(["sf"], "novel"), b: wf(["romance"], "novel") });
    const r = rerank([cand("a", 0.8), cand("b", 0.8)], p2, f2);
    expect(r.why).toBe("gap");
    expect(r.inBand).toBe(1);
    expect(r.separated).toBe(0);
  });

  it("needs the affinity to outweigh the score gap at lambda", () => {
    // Δa = 1, so the challenger may trail by less than lambda.
    expect(rerank([cand("top", 0.8), cand("fit", 0.8 - PRIOR.lambda + 0.01)], p, feats).why).toBe("moved");
    expect(rerank([cand("top", 0.8), cand("fit", 0.8 - PRIOR.lambda)], p, feats).why).toBe("gap");
  });

  it("breaks ties among challengers by retrieval's order", () => {
    const f = lookup({ top: wf(["romance"], "nonfiction"), c1: sfNovel, c2: sfNovel });
    expect(rerank([cand("top", 0.8), cand("c1", 0.79), cand("c2", 0.79)], p, f).prior).toBe("c1");
  });

  it("looks only `depth` candidates deep", () => {
    const fill = Array.from({ length: PRIOR.depth - 1 }, (_, i) => cand(`x${i}`, 0.8, false));
    const r = rerank([cand("top", 0.8), ...fill, cand("fit", 0.8)], p, feats);
    expect(r.why).toBe("no-challenger");
  });
});

describe("priorVote", () => {
  const base = (confirmed: ReaderVotes["confirmed"]): ReaderVotes => ({ readText: { vision: true, ppocr: true, qwen: true }, top: {}, confirmed });
  const moved = (prior: string): Rerank => ({ top: "x", prior, why: "moved", inBand: 1, separated: 1, topAffinity: 0, priorAffinity: 1 });
  const kept = (w: string): Rerank => ({ top: w, prior: w, why: "gap", inBand: 1, separated: 0, topAffinity: 0.5, priorAffinity: 0.5 });

  it("accepts only through F-0's two-reader vote", () => {
    const v = priorVote(base({ vision: "w1", ppocr: null, qwen: null }), null, { ppocr: moved("w1") });
    expect(v).toMatchObject({ accepted: "w1", change: "new-accept" });
    expect(v.agreeing.sort()).toEqual(["ppocr", "vision"]);
  });

  it("one reader moved alone never accepts (INV-6: one vote per reader model)", () => {
    const v = priorVote(base({ vision: null, ppocr: null, qwen: null }), null, { vision: moved("w1") });
    expect(v).toMatchObject({ accepted: null, change: "none", reason: "single-reader" });
  });

  it("reports a lost or changed accept", () => {
    expect(priorVote(base({ vision: "w1", ppocr: "w1", qwen: null }), "w1", { ppocr: moved("w2") }).change).toBe("lost-accept");
    expect(priorVote(base({ vision: "w1", ppocr: "w1", qwen: "w2" }), "w1", { vision: moved("w2"), ppocr: moved("w2") }).change).toBe("changed-accept");
    expect(priorVote(base({ vision: "w1", ppocr: "w1", qwen: null }), "w1", { vision: kept("w1") }).change).toBe("none");
  });
});

describe("majorityForm", () => {
  it("is the form more than half the known neighbours hold", () => {
    expect(majorityForm([sfNovel, sfNovel, wf(["sf"], "collection")])).toBe("novel");
    expect(majorityForm([sfNovel, wf(["sf"], "collection")])).toBeNull();
    expect(majorityForm([sfNovel, null])).toBeNull();
  });
});

describe("the wall and popularity (structural)", () => {
  const files = ["src/identify/section-prior.ts", "src/eval/section-prior-cli.ts"];

  /** Every repo module a file reaches through relative imports. */
  function reach(start: string): Set<string> {
    const seen = new Set<string>();
    const walk = (rel: string) => {
      if (seen.has(rel)) return;
      seen.add(rel);
      const src = readFileSync(join(REPO, rel), "utf8");
      for (const m of src.matchAll(/^\s*import\s+(?:type\s+)?[^;]*?from\s+"(\.{1,2}\/[^"]+)"/gms)) walk(join(dirname(rel), m[1]!));
    };
    walk(start);
    return seen;
  }

  it("never reaches the taste profile, lenses or recommend (INV-13)", () => {
    for (const f of files) {
      for (const r of reach(f)) expect(r, `${f} reaches ${r}`).not.toMatch(/(^|\/)(recommend|profile)(\/|\.ts$)|taste|lens/);
    }
  });

  it("reads no popularity: no edition count, year, rating or vote count in the prior", () => {
    const src = readFileSync(join(REPO, "src/identify/section-prior.ts"), "utf8").replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, "");
    expect(src).not.toMatch(/edition|year|rating|popular|votes?Count|awards?/i);
  });
});

describe("KN-1 adapter (termsOf, signTerms)", async () => {
  const { termsOf, signTerms } = await import("../src/eval/section-prior-cli.ts");
  const { pickForm } = await import("../src/catalog/work-features.ts");
  const feat = (kind: "genre" | "form" | "subject", term: string, canon: string | null, family: string | null) => ({ workId: "w", kind, term, canon, family, count: 1, source: "isfdb-tag" as const, recordId: "r", fetched: "2026-10-31" });
  const g = (family: string) => feat("genre", family, `${family}-canon`, family);
  const f = (canon: string) => feat("form", canon, canon, "form");
  const s = (term: string) => feat("subject", term, null, null);

  it("takes genre families, subject terms and KN-1's one form", () => {
    const forms = [f("fiction"), f("novel")];
    expect(termsOf({ genres: [g("sf"), g("sf"), g("fantasy")], subjects: [s("mars")], form: pickForm(forms) })).toEqual({ genre: ["fantasy", "sf"], subject: ["mars"], form: "novel" });
  });

  it("is null for a work with no features (unknown, not evidence against)", () => {
    expect(termsOf({ genres: [], subjects: [], form: null })).toBeNull();
  });

  it("maps SC-1's sections to genre families only (KN-1's SECTION_GENRES)", () => {
    expect(signTerms("sf-fantasy")).toEqual(["sf", "fantasy"]);
    expect(signTerms("mystery")).toEqual(["crime", "thriller"]);
    expect(signTerms("graphic")).toEqual([]);
    expect(signTerms("not-a-family")).toEqual([]);
  });
});
