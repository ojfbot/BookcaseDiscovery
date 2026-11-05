// KN-2 section prior (shadow mode): what the confirmed books standing in a row are, as shared book knowledge (genre,
// subject and form from KN-1's work features), plus SC-1's shelf-context sign where one exists, makes the row's
// **section mix**. The mix may re-rank a reader's catalog candidates for an unconfirmed box in that row:
// within a small score band, a candidate that fits the section better may replace the reader's top, but only one that
// passes F-0's bar on its own reader text. The prior is never a confirmer: F-0's two-reader vote is unchanged, and each
// reader model still casts one vote (INV-6). It reads genre, subject and form only, never popularity (edition counts,
// ratings), so a rare book is not pushed down for being rare; a top whose features are unknown is never displaced.
// The reader's taste and the lenses never reach it (INV-13): this is what stands on this shelf, not what the reader likes.
// The switch defaults to `off`; this card runs it in `shadow` (log what would change, change nothing). Constants are
// pre-registered in evals/KN2/prereg.md and never tuned. Pure functions; the runner is section-prior-cli.ts.
import { vote, type ReaderName, type ReaderVotes, type SpineDecision } from "../eval/f0.ts";

// --- the switch ----------------------------------------------------------------------------------------------

/**
 * `off`: no mix is built and identify is untouched. `shadow`: mixes are built and every decision is logged
 * beside what the prior would change; no decision changes. `re-rank`: the re-ranked tops replace the readers' tops
 * before F-0's vote (an owner ruling, after the keep rule). `vote`: the prior as a vote of its own, refused.
 */
export const PRIOR_MODES = ["off", "shadow", "re-rank", "vote"] as const;
export type PriorMode = (typeof PRIOR_MODES)[number];
export const PRIOR_DEFAULT: PriorMode = "off";

export function parsePriorMode(s: string | undefined): PriorMode {
  if (s === undefined) return PRIOR_DEFAULT;
  if (!(PRIOR_MODES as readonly string[]).includes(s)) throw new Error(`section prior: unknown mode "${s}" (${PRIOR_MODES.join(" | ")})`);
  return s as PriorMode;
}

/** The prior is never a confirmer: a mode that would let it vote is refused, whatever asks for it. */
export function assertNotConfirmer(mode: PriorMode): void {
  if (mode === "vote") throw new Error("section prior: `vote` would make the prior a confirmer; it never is (KN-2, INV-6). Use shadow or re-rank.");
}

// --- constants (pre-registered) ------------------------------------------------------------------------------

export const PRIOR = {
  /** A row has a mix only with at least this many confirmed neighbours whose features are known. */
  minNeighbours: 2,
  /** SC-1's sign counts as this many neighbours, in the genre facet only, and only on top of a neighbour mix. */
  signWeight: 0.5,
  /** ... when its record's confidence is at least this (SC-1's own unit floor). */
  signMinConfidence: 0.3,
  /** Facet weights in the affinity. */
  facetWeight: { genre: 1, subject: 0.5, form: 1 },
  /** A challenger is at most this far below the reader's top on retrieval's own score. */
  band: 0.05,
  /** The affinity's weight on the score scale: a full affinity point is worth this much score. */
  lambda: 0.05,
  /** A challenger's affinity must beat the top's by at least this. */
  minGap: 0.25,
  /** Candidates per reader looked at (the top and its challengers). */
  depth: 20,
  /** A row's form majority: the form held by more than this share of its known neighbours (stress test). */
  majority: 0.5,
} as const;

// --- work features (KN-1) ---------------------------------------------------------------------------------------

/** One work's shared book knowledge: genre, subject and form terms (KN-1's `work_features`). Never popularity. */
export interface WorkFeatureTerms {
  genre: readonly string[];
  subject: readonly string[];
  form: string | null;
}

/** A work's features, or null when nothing is known of it. */
export type FeatureLookup = (workId: string) => WorkFeatureTerms | null;

export type Facet = "genre" | "subject" | "form";
export const FACETS: readonly Facet[] = ["genre", "subject", "form"];

const termsOf = (w: WorkFeatureTerms, f: Facet): readonly string[] => (f === "form" ? (w.form ? [w.form] : []) : w[f]);
const known = (w: WorkFeatureTerms | null): w is WorkFeatureTerms => w !== null && FACETS.some((f) => termsOf(w, f).length > 0);

// --- the section mix ------------------------------------------------------------------------------------------

/** SC-1's shelf-context sign for a row: its genre family and its record's confidence. Weak (K2 failed in SC-1). */
export interface SectionSign {
  family: string;
  confidence: number;
}

export interface SectionMix {
  /** Confirmed neighbours with known features that built it. */
  neighbours: number;
  /** Whether SC-1's sign took part. */
  sign: boolean;
  /** Per facet, each term's share of the facet's contributors (a contributor with two genres counts for both). */
  shares: Record<Facet, Record<string, number>>;
  /** Per facet, the contributors' total weight (0: the facet is unknown for the row). */
  weight: Record<Facet, number>;
}

/**
 * A row's section mix from its confirmed neighbours' features and, where SC-1 read one, its sign (mapped to
 * genre terms by `signTerms`). Null when fewer than `minNeighbours` neighbours have known features: a sign alone never
 * makes a mix.
 */
export function buildMix(neighbours: readonly (WorkFeatureTerms | null)[], sign: SectionSign | null = null, signTerms: (family: string) => readonly string[] = () => []): SectionMix | null {
  const ns = neighbours.filter(known);
  if (ns.length < PRIOR.minNeighbours) return null;
  const shares = { genre: {}, subject: {}, form: {} } as Record<Facet, Record<string, number>>;
  const weight = { genre: 0, subject: 0, form: 0 } as Record<Facet, number>;
  const add = (f: Facet, terms: readonly string[], w: number) => {
    const ts = [...new Set(terms)];
    if (!ts.length) return;
    weight[f] += w;
    for (const t of ts) shares[f][t] = (shares[f][t] ?? 0) + w;
  };
  for (const n of ns) for (const f of FACETS) add(f, termsOf(n, f), 1);
  const signed = sign !== null && sign.confidence >= PRIOR.signMinConfidence && weight.genre > 0 && signTerms(sign.family).length > 0;
  if (signed) add("genre", signTerms(sign.family), PRIOR.signWeight);
  for (const f of FACETS) for (const t of Object.keys(shares[f])) shares[f][t] = Math.round((shares[f][t]! / weight[f]) * 10000) / 10000;
  return { neighbours: ns.length, sign: signed, shares, weight };
}

/**
 * How well a work fits a mix, 0..1: per facet both sides know, the best share among the work's terms; the
 * facets' weighted mean. Null when no facet is known on both sides (an unknown work is neither helped nor hurt).
 */
export function affinity(w: WorkFeatureTerms | null, p: SectionMix): number | null {
  if (!w) return null;
  let sum = 0;
  let wt = 0;
  for (const f of FACETS) {
    const ts = termsOf(w, f);
    if (!ts.length || p.weight[f] === 0) continue;
    sum += PRIOR.facetWeight[f] * Math.max(...ts.map((t) => p.shares[f][t] ?? 0));
    wt += PRIOR.facetWeight[f];
  }
  return wt ? Math.round((sum / wt) * 10000) / 10000 : null;
}

/** The form most of a row's known neighbours share (more than `majority`), or null. */
export function majorityForm(neighbours: readonly (WorkFeatureTerms | null)[]): string | null {
  const forms = neighbours.filter(known).map((n) => n.form).filter((f): f is string => f !== null);
  if (forms.length < PRIOR.minNeighbours) return null;
  const counts = new Map<string, number>();
  for (const f of forms) counts.set(f, (counts.get(f) ?? 0) + 1);
  const [form, n] = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]!;
  return n / forms.length > PRIOR.majority ? form : null;
}

// --- one reader's re-rank ---------------------------------------------------------------------------------------

/** One reader's ranked catalog candidate, as much as the prior may see: no title, author or popularity. */
export interface RankedCandidate {
  workId: string;
  /** Retrieval's own evidence score on this reader's text. */
  score: number;
  /** Whether it passes F-0's bar (`confirms`) on this reader's text alone. */
  passes: boolean;
}

export type RerankWhy = "no-mix" | "no-candidates" | "top-unknown" | "no-challenger" | "gap" | "moved";

export interface Rerank {
  /** The reader's top, and the prior's top (the same when nothing moved). */
  top: string | null;
  prior: string | null;
  why: RerankWhy;
  /** Passing challengers in the band whose affinity is known (the prior could have looked at them). */
  inBand: number;
  /** ... and of those, how many the mix separates from the top by at least `minGap` either way. */
  separated: number;
  topAffinity: number | null;
  priorAffinity: number | null;
}

/**
 * One reader's re-rank. The top stays unless its affinity is known and a challenger (another work at most `band`
 * below on score, passing F-0's bar on its own text, affinity known and at least `minGap` higher) beats it on score
 * plus `lambda` times affinity. The best such challenger moves up; ties keep retrieval's order.
 */
export function rerank(ranked: readonly RankedCandidate[], mix: SectionMix | null, features: FeatureLookup): Rerank {
  const top = ranked[0];
  const none = { inBand: 0, separated: 0, topAffinity: null, priorAffinity: null };
  if (!top) return { top: null, prior: null, why: "no-candidates", ...none };
  if (!mix) return { top: top.workId, prior: top.workId, why: "no-mix", ...none };
  const aT = affinity(features(top.workId), mix);
  if (aT === null) return { top: top.workId, prior: top.workId, why: "top-unknown", ...none };
  const band = ranked
    .slice(1, PRIOR.depth)
    .filter((c) => c.workId !== top.workId && c.passes && top.score - c.score <= PRIOR.band + 1e-9)
    .map((c, k) => ({ c, k, a: affinity(features(c.workId), mix) }))
    .filter((x): x is { c: RankedCandidate; k: number; a: number } => x.a !== null);
  const separated = band.filter((x) => Math.abs(x.a - aT) >= PRIOR.minGap - 1e-9).length;
  const adj = (score: number, a: number) => score + PRIOR.lambda * a;
  const winners = band.filter((x) => x.a - aT >= PRIOR.minGap - 1e-9 && adj(x.c.score, x.a) > adj(top.score, aT) + 1e-9).sort((x, y) => adj(y.c.score, y.a) - adj(x.c.score, x.a) || x.k - y.k);
  const base = { top: top.workId, inBand: band.length, separated, topAffinity: aT };
  if (!band.length) return { ...base, prior: top.workId, why: "no-challenger", priorAffinity: aT };
  if (!winners.length) return { ...base, prior: top.workId, why: "gap", priorAffinity: aT };
  return { ...base, prior: winners[0]!.c.workId, why: "moved", priorAffinity: winners[0]!.a };
}

// --- the would-be vote ------------------------------------------------------------------------------------------

export type ShadowChange = "none" | "new-accept" | "lost-accept" | "changed-accept";

export interface PriorVote {
  accepted: string | null;
  agreeing: ReaderName[];
  reason: SpineDecision["reason"];
  change: ShadowChange;
}

/**
 * F-0's vote with each moved reader confirming the prior's top (which passes F-0's bar on that reader's own text) and
 * every other reader as it was. The vote itself is F-0's: two readers on one work, uniquely.
 */
export function priorVote(base: ReaderVotes, baseAccepted: string | null, reranks: Partial<Record<ReaderName, Rerank>>): PriorVote {
  const confirmed = { ...base.confirmed };
  for (const [r, rr] of Object.entries(reranks) as [ReaderName, Rerank][]) if (rr.why === "moved") confirmed[r] = rr.prior;
  const v = vote({ ...base, confirmed });
  const change: ShadowChange =
    v.acceptedId === baseAccepted ? "none" : baseAccepted === null ? "new-accept" : v.acceptedId === null ? "lost-accept" : "changed-accept";
  return { accepted: v.acceptedId, agreeing: v.agreeing, reason: v.reason, change };
}

// --- the shadow record and the switch ------------------------------------------------------------------------------

/** What the prior would do to one box's decision, logged beside it in shadow mode. Private (it names works). */
export interface ShadowRecord {
  id: string;
  /** F-0h's row key; null for a book box in no row (lying, face-out), which never gets a mix. */
  rowKey: string | null;
  mix: { neighbours: number; sign: boolean } | null;
  readers: Partial<Record<ReaderName, { top: string | null; prior: string | null; why: RerankWhy }>>;
  base: { accepted: string | null };
  prior: PriorVote;
}

/**
 * The decision identify reports under a mode: the base for `off` and `shadow`, the prior's vote for `re-rank`.
 * `vote` is refused (`assertNotConfirmer`).
 */
export function decisionUnder(mode: PriorMode, base: { accepted: string | null }, shadow: ShadowRecord | null): { accepted: string | null } {
  assertNotConfirmer(mode);
  if (mode !== "re-rank" || !shadow) return base;
  return { accepted: shadow.prior.accepted };
}
