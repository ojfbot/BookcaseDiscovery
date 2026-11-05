// KN-3 evaluation: label-free measures of the shelf signals (src/recommend/shelf-signals.ts). There are no
// recommendation ground truths, so every measure compares the shop's real shelving against a shuffle of the same
// store's confirmed books: do co-shelved neighbours share a KN-1 genre or form term more often (H), and is the
// out-of-place flag rarer in real rows than in shuffled ones (O)? Plus coverage (C) and stability over repeat
// sightings within an F-1 capture group (S). Constants and verdicts are pre-registered in evals/KN3/prereg.md and
// never tuned. Pure functions; the runner is kn3-cli.ts.
import type { FeatureLookup, WorkFeatureTerms } from "../identify/section-prior.ts";
import {
  coShelving,
  isOutOfPlace,
  pairWeight,
  placeChecks,
  rowSection,
  sightingsOf,
  signTermsOf,
  type ConfirmedBox,
  type PlaceCheck,
  type ShelfInput,
  type ShelfScope,
  type Sighting,
} from "../recommend/shelf-signals.ts";
import { clusterBootstrap, quantile, rng } from "./q1.ts";

/** Pre-registered evaluation constants (evals/KN3/prereg.md). */
export const EVAL = {
  reps: 2000,
  seed: 20261105,
  shuffles: 200,
  /** C1: at least this share of confirmed works have a `row` neighbour. */
  rowNeighbourShare: 0.5,
  /** H1's pairs: `readers-agree` only (a context label was confirmed because its neighbours fit). */
  primaryBases: ["readers-agree"] as readonly string[],
} as const;

const r4 = (x: number) => Math.round(x * 10000) / 10000;
const share = (k: number, n: number): number | null => (n ? r4(k / n) : null);
type Tri = [number, number, number] | null;

// --- H · term sharing between co-shelved works -------------------------------------------------------------------

export type Facet = "either" | "genre" | "form";
export const H_FACETS: readonly Facet[] = ["either", "genre", "form"];

export function knownOn(f: Facet, w: WorkFeatureTerms | null): w is WorkFeatureTerms {
  if (!w) return false;
  if (f === "genre") return w.genre.length > 0;
  if (f === "form") return w.form !== null;
  return w.genre.length > 0 || w.form !== null;
}

/** Do two works share a term on the facet: a genre family, the same form, or either. */
export function sharesTerm(f: Facet, a: WorkFeatureTerms, b: WorkFeatureTerms): boolean {
  const genre = a.genre.some((g) => b.genre.includes(g));
  const form = a.form !== null && a.form === b.form;
  return f === "genre" ? genre : f === "form" ? form : genre || form;
}

export interface Pair {
  imageId: string;
  a: Sighting;
  b: Sighting;
  weight: number;
  scope: ShelfScope;
  /** Positions apart (row pairs) or bands apart, at least 1 (case pairs). */
  distance: number;
}

/** Every unordered pair of sightings of two different works in one case, with its co-shelving weight. */
export function pairsOf(sightings: readonly Sighting[]): Pair[] {
  const byCase = new Map<string, Sighting[]>();
  for (const s of sightings) byCase.set(s.caseKey, [...(byCase.get(s.caseKey) ?? []), s]);
  const out: Pair[] = [];
  for (const [caseKey, ss] of byCase)
    for (let i = 0; i < ss.length; i++)
      for (let j = i + 1; j < ss.length; j++) {
        const [a, b] = [ss[i]!, ss[j]!];
        const w = pairWeight(a, b);
        if (!w) continue;
        const distance = w.scope === "row" ? Math.abs(a.position - b.position) : Math.max(1, Math.abs(a.band - b.band));
        out.push({ imageId: caseKey, a, b, weight: w.weight, scope: w.scope, distance });
      }
  return out;
}

/** One side kept, the other replaced by a draw: the kept side's terms and what the replacement may be. */
interface Keep {
  terms: WorkFeatureTerms;
  draws: readonly WorkFeatureTerms[];
}

export interface ScoredPair {
  imageId: string;
  weight: number;
  /** 1 when the pair shares a term, else 0. */
  s: number;
  /** The shuffle control's exact expectation of `s`. */
  e: number;
  keepA: Keep;
  keepB: Keep;
}

/**
 * Score each pair known on the facet against the shuffle control: one side replaced by a confirmed sighting from
 * another photo, known on the facet, whose work is not the kept side's; `e` averages replacing either side.
 * `pool` is every confirmed sighting the control may draw from (the set's own, all bases).
 */
export function scorePairs(f: Facet, pairs: readonly Pair[], pool: readonly Sighting[], features: FeatureLookup): ScoredPair[] {
  const known = pool.map((x) => ({ x, t: features(x.workId) })).filter((y): y is { x: Sighting; t: WorkFeatureTerms } => knownOn(f, y.t));
  const memo = new Map<string, { draws: WorkFeatureTerms[]; e: number }>();
  const keep = (k: Sighting, terms: WorkFeatureTerms, photo: string) => {
    const key = `${k.workId}|${photo}`;
    if (!memo.has(key)) {
      const draws = known.filter((y) => y.x.caseKey !== photo && y.x.workId !== k.workId).map((y) => y.t);
      memo.set(key, { draws, e: draws.length ? draws.filter((t) => sharesTerm(f, terms, t)).length / draws.length : 0 });
    }
    return memo.get(key)!;
  };
  const out: ScoredPair[] = [];
  for (const p of pairs) {
    const ta = features(p.a.workId);
    const tb = features(p.b.workId);
    if (!knownOn(f, ta) || !knownOn(f, tb)) continue;
    const ka = keep(p.a, ta, p.imageId);
    const kb = keep(p.b, tb, p.imageId);
    out.push({ imageId: p.imageId, weight: p.weight, s: sharesTerm(f, ta, tb) ? 1 : 0, e: (ka.e + kb.e) / 2, keepA: { terms: ta, draws: ka.draws }, keepB: { terms: tb, draws: kb.draws } });
  }
  return out;
}

const weighted = <T extends { weight: number }>(xs: readonly T[], v: (p: T) => number): number | null => {
  const w = xs.reduce((a, p) => a + p.weight, 0);
  return w ? xs.reduce((a, p) => a + p.weight * v(p), 0) / w : null;
};

export interface Homophily {
  pairs: number;
  photos: number;
  H: number | null;
  E: number | null;
  /** H − E, with its 95 % photo-cluster bootstrap. */
  D: Tri;
  lift: number | null;
  /** Random shuffles: each pair's one side, at random, replaced by a random draw. Their H's mean and p95. */
  shuffle: { mean: number | null; p95: number | null; shuffles: number };
}

export function homophily(f: Facet, xs: readonly ScoredPair[], seed: number = EVAL.seed): Homophily {
  const H = weighted(xs, (p) => p.s);
  const E = weighted(xs, (p) => p.e);
  const boot = clusterBootstrap(
    [...xs],
    (ys) => {
      const h = weighted(ys, (p) => p.s);
      const e = weighted(ys, (p) => p.e);
      return h === null || e === null ? null : h - e;
    },
    EVAL.reps,
    seed,
  );
  const rand = rng(seed);
  const hs: number[] = [];
  for (let k = 0; k < EVAL.shuffles && xs.length; k++) {
    const h = weighted(xs, (p) => {
      const kept = rand() < 0.5 ? p.keepA : p.keepB;
      if (!kept.draws.length) return 0;
      return sharesTerm(f, kept.terms, kept.draws[Math.floor(rand() * kept.draws.length)]!) ? 1 : 0;
    });
    if (h !== null) hs.push(h);
  }
  hs.sort((a, b) => a - b);
  return {
    pairs: xs.length,
    photos: new Set(xs.map((p) => p.imageId)).size,
    H: H === null ? null : r4(H),
    E: E === null ? null : r4(E),
    D: boot ? [r4(boot.value), r4(boot.lo), r4(boot.hi)] : null,
    lift: H !== null && E ? r4(H / E) : null,
    shuffle: { mean: hs.length ? r4(hs.reduce((a, b) => a + b, 0) / hs.length) : null, p95: hs.length ? r4(quantile(hs, 0.95)) : null, shuffles: hs.length },
  };
}

/** Each unordered work pair once across photos (overlapping shots repeat pairs): its first photo's, by photo id. */
export function onePerWorkPair(pairs: readonly Pair[]): Pair[] {
  const seen = new Set<string>();
  const out: Pair[] = [];
  for (const p of [...pairs].sort((x, y) => (x.imageId < y.imageId ? -1 : x.imageId > y.imageId ? 1 : 0))) {
    const k = [p.a.workId, p.b.workId].sort().join("|");
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

// --- O · the out-of-place flag against shuffled rows ---------------------------------------------------------------

export interface PlaceRates {
  /** Determinable members and flagged ones, per facet (`either`: either facet determinable / flagged). */
  determinable: Record<Facet, number>;
  flagged: Record<Facet, number>;
  share: Record<Facet, number | null>;
}

export function placeRates(checks: readonly PlaceCheck[]): PlaceRates {
  const det = { either: 0, genre: 0, form: 0 };
  const fl = { either: 0, genre: 0, form: 0 };
  for (const c of checks) {
    if (c.genre !== null) det.genre++;
    if (c.form !== null) det.form++;
    if (c.genre !== null || c.form !== null) det.either++;
    if (c.genre === true) fl.genre++;
    if (c.form === true) fl.form++;
    if (isOutOfPlace(c)) fl.either++;
  }
  return { determinable: det, flagged: fl, share: { either: share(fl.either, det.either), genre: share(fl.genre, det.genre), form: share(fl.form, det.form) } };
}

const allChecks = (input: ShelfInput): PlaceCheck[] => input.rows.flatMap((r) => placeChecks(r, input));

export interface PlaceShuffle {
  real: PlaceRates;
  /** Per facet, the shuffled flagged shares' mean and 5th percentile. */
  shuffled: Record<Facet, { mean: number | null; p05: number | null }>;
  shuffles: number;
}

/**
 * The real rows' out-of-place rate against `shuffles` deals of the same confirmed books (work and basis together) into
 * the same row slots at random, store-wide; row sizes and signs stay.
 */
export function placeShuffle(input: ShelfInput, shuffles: number = EVAL.shuffles, seed: number = EVAL.seed): PlaceShuffle {
  const real = placeRates(allChecks(input));
  const slots = input.rows.flatMap((r) => r.members.filter((id) => input.confirmed.has(id)));
  const values = slots.map((id) => input.confirmed.get(id)!);
  const rand = rng(seed);
  const draws: Record<Facet, number[]> = { either: [], genre: [], form: [] };
  for (let k = 0; k < shuffles; k++) {
    const v = [...values];
    for (let i = v.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [v[i], v[j]] = [v[j]!, v[i]!];
    }
    const confirmed = new Map<string, ConfirmedBox>(slots.map((id, i) => [id, v[i]!]));
    const r = placeRates(allChecks({ ...input, confirmed }));
    for (const f of H_FACETS) if (r.share[f] !== null) draws[f].push(r.share[f]!);
  }
  const summary = (xs: number[]) => {
    xs.sort((a, b) => a - b);
    return { mean: xs.length ? r4(xs.reduce((a, b) => a + b, 0) / xs.length) : null, p05: xs.length ? r4(quantile(xs, 0.05)) : null };
  };
  return { real, shuffled: { either: summary(draws.either), genre: summary(draws.genre), form: summary(draws.form) }, shuffles };
}

// --- C · coverage --------------------------------------------------------------------------------------------------

export function coverage(input: ShelfInput) {
  const sightings = sightingsOf(input.rows, input.confirmed);
  const works = [...new Set([...input.confirmed.values()].map((c) => c.workId))];
  const co = coShelving(sightings);
  const sections = input.rows.map((r) => rowSection(r, input));
  const termed = new Set(sections.filter((s) => s.sign || s.mix).map((s) => s.rowKey));
  const checks = allChecks(input);
  const det = checks.filter((c) => c.genre !== null || c.form !== null);
  const flagged = (pred: (c: PlaceCheck) => boolean) => new Set(checks.filter(pred).map((c) => c.workId)).size;
  const confirmedPerRow = input.rows.map((r) => r.members.filter((id) => input.confirmed.has(id)).length);
  const n = works.length;
  return {
    rows: input.rows.length,
    confirmedWorks: n,
    confirmedBoxes: input.confirmed.size,
    confirmedInNoRow: input.confirmed.size - sightings.length,
    rowsWithTwoConfirmed: confirmedPerRow.filter((k) => k >= 2).length,
    coShelving: {
      worksWithRowNeighbour: works.filter((w) => co.get(w)?.some((x) => x.scope === "row")).length,
      worksWithAnyNeighbour: works.filter((w) => (co.get(w)?.length ?? 0) > 0).length,
      rowNeighbourShare: share(works.filter((w) => co.get(w)?.some((x) => x.scope === "row")).length, n),
    },
    sectionTerms: {
      rowsWithSignTerms: sections.filter((s) => s.sign).length,
      rowsWithMix: sections.filter((s) => s.mix).length,
      rowsWithMixAndSign: sections.filter((s) => s.mix?.sign).length,
      worksOnTermedRow: new Set(sightings.filter((s) => termed.has(s.rowKey)).map((s) => s.workId)).size,
      worksOnTermedRowShare: share(new Set(sightings.filter((s) => termed.has(s.rowKey)).map((s) => s.workId)).size, n),
    },
    outOfPlace: {
      rowsDeterminable: new Set(det.map((c) => c.rowKey)).size,
      worksDeterminable: new Set(det.map((c) => c.workId)).size,
      worksFlaggedGenre: flagged((c) => c.genre === true),
      worksFlaggedForm: flagged((c) => c.form === true),
      worksFlagged: flagged(isOutOfPlace),
    },
  };
}

// --- S · stability over repeat sightings in one capture group ---------------------------------------------------------

const topGenre = (shares: Record<string, number>): string | null => {
  const e = Object.entries(shares).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return e[0]?.[0] ?? null;
};

/**
 * Per (work, photo pair) within one capture group (each photo's first sighting of the work, by band then position):
 * whether the two sightings' rows agree on the out-of-place flag, the mix's top genre family and the sign family, and
 * the Jaccard of their rows' other confirmed works.
 */
export function stability(input: ShelfInput, groupOf: (photo: string) => string | null) {
  const sightings = sightingsOf(input.rows, input.confirmed);
  const rows = new Map(input.rows.map((r) => [r.key, r]));
  const checks = new Map(allChecks(input).map((c) => [c.boxId, c]));
  const sections = new Map(input.rows.map((r) => [r.key, rowSection(r, input)]));
  const first = new Map<string, Sighting>();
  for (const s of [...sightings].sort((a, b) => a.band - b.band || a.position - b.position)) {
    const k = `${s.workId}|${s.caseKey}`;
    if (!first.has(k)) first.set(k, s);
  }
  const byWork = new Map<string, Sighting[]>();
  for (const s of first.values()) byWork.set(s.workId, [...(byWork.get(s.workId) ?? []), s]);
  const neighboursOf = (s: Sighting) =>
    new Set(rows.get(s.rowKey)!.members.filter((id) => id !== s.boxId && input.confirmed.has(id)).map((id) => input.confirmed.get(id)!.workId).filter((w) => w !== s.workId));
  let pairs = 0;
  const place = { n: 0, same: 0 };
  const genre = { n: 0, same: 0 };
  const sign = { n: 0, same: 0 };
  const jac: number[] = [];
  for (const ss of byWork.values()) {
    for (let i = 0; i < ss.length; i++)
      for (let j = i + 1; j < ss.length; j++) {
        const [a, b] = [ss[i]!, ss[j]!];
        const g = groupOf(a.caseKey);
        if (g === null || g !== groupOf(b.caseKey)) continue;
        pairs++;
        const [ca, cb] = [checks.get(a.boxId)!, checks.get(b.boxId)!];
        const det = (c: PlaceCheck) => c.genre !== null || c.form !== null;
        if (det(ca) && det(cb)) {
          place.n++;
          if (isOutOfPlace(ca) === isOutOfPlace(cb)) place.same++;
        }
        const [ma, mb] = [sections.get(a.rowKey)!.mix, sections.get(b.rowKey)!.mix];
        if (ma && mb && ma.weight.genre > 0 && mb.weight.genre > 0) {
          genre.n++;
          if (topGenre(ma.shares.genre) === topGenre(mb.shares.genre)) genre.same++;
        }
        const [sa, sb] = [input.signs.get(a.rowKey), input.signs.get(b.rowKey)];
        if (sa && sb) {
          sign.n++;
          if (sa.family === sb.family) sign.same++;
        }
        const [na, nb] = [neighboursOf(a), neighboursOf(b)];
        const union = new Set([...na, ...nb]);
        if (union.size) jac.push([...na].filter((w) => nb.has(w)).length / union.size);
      }
  }
  return {
    workPhotoPairs: pairs,
    works: [...byWork.values()].filter((ss) => ss.length > 1).length,
    outOfPlaceAgreement: { pairs: place.n, share: share(place.same, place.n) },
    mixTopGenreAgreement: { pairs: genre.n, share: share(genre.same, genre.n) },
    signFamilyAgreement: { pairs: sign.n, share: share(sign.same, sign.n) },
    neighbourJaccard: { pairs: jac.length, mean: jac.length ? r4(jac.reduce((a, b) => a + b, 0) / jac.length) : null },
  };
}

// --- L · the catalog's limits --------------------------------------------------------------------------------------

export function limits(input: ShelfInput) {
  const works = [...new Set([...input.confirmed.values()].map((c) => c.workId))];
  const ts = works.map((w) => input.features(w));
  const genreKnown = ts.filter((t) => knownOn("genre", t));
  const formKnown = ts.filter((t) => knownOn("form", t));
  const families = new Set(genreKnown.flatMap((t) => t.genre));
  const signFamilies = [...new Set([...input.signs.values()].map((s) => s.family))].sort();
  return {
    worksKnownEither: share(ts.filter((t) => knownOn("either", t)).length, works.length),
    worksKnownGenre: share(genreKnown.length, works.length),
    worksKnownForm: share(formKnown.length, works.length),
    genreKnownSfOrFantasy: share(genreKnown.filter((t) => t.genre.includes("sf") || t.genre.includes("fantasy")).length, genreKnown.length),
    distinctGenreFamilies: families.size,
    formKnownNovel: share(formKnown.filter((t) => t.form === "novel").length, formKnown.length),
    rowsWithSign: input.signs.size,
    rowsWithSignTerms: input.rows.filter((r) => signTermsOf(input.signs.get(r.key)) !== null).length,
    signFamilies,
  };
}

// --- verdicts (pre-registered) -----------------------------------------------------------------------------------------

export function verdicts(m: { coverage: ReturnType<typeof coverage>; primary: Homophily; place: PlaceShuffle }) {
  const c1 = (m.coverage.coShelving.rowNeighbourShare ?? 0) >= EVAL.rowNeighbourShare;
  const h1 = m.primary.D !== null && m.primary.D[1] > 0;
  const realO = m.place.real.share.either;
  const p05 = m.place.shuffled.either.p05;
  const o1 = realO !== null && p05 !== null && realO < p05;
  return {
    C1: { holds: c1, rowNeighbourShare: m.coverage.coShelving.rowNeighbourShare },
    H1: { holds: h1, D: m.primary.D },
    O1: { holds: o1, real: realO, shuffledP05: p05 },
    coShelving: c1 && h1 ? "recommend shadow → on (owner's ruling)" : "stay in shadow",
    outOfPlace: o1 && m.coverage.outOfPlace.worksFlagged > 0 ? "recommend surfacing (owner's ruling)" : "stay in shadow",
    signTerms: "stay off until SC-1's K2 holds",
    default: "off",
  };
}
