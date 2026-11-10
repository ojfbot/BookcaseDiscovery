// NS-1 · overlap-and-margin arm: the per-case union scorer. For one bookcase, what do 2–3 overlapping unedited stills
// with margin read, against the single whole-case still? Pure functions over work ids: a work is merged across stills
// by its id (or, for a reading no catalog work matched, by the caller's normalised reading key), NEVER by box, because
// book-level registration across stills is unplanned (docs/capture/coverage.md §5). Every figure is machine agreement,
// never accuracy (INV-17). Constants and verdicts are pre-registered in evals/NS1/prereg.md and never tuned.
// No runner yet: no shoot data exists. The runner that reads the pipeline's per-still outputs is added after the shoot.
import { quantile, rng } from "./q1.ts";

/** Pre-registered constants (evals/NS1/prereg.md). `liftHypothesis` is a hypothesis, not a measurement. */
export const NS1 = {
  reps: 2000,
  seed: 20261105,
  /** Fewer cases than this in a stratum: no interval is reported, only the per-case values and the paired counts. */
  minCasesForInterval: 5,
  /** The pooled lift (share points of the case union) at which the owner is told margin is worth the shooting time. */
  liftHypothesis: 0.05,
} as const;

export type Rung = "text-read" | "matched" | "confirmed";
/** A reading `key` is a catalog work id when the box matched or confirmed one, else a `reading:` key. */
export interface Reading { key: string; rung: Rung }
export interface Still { stillId: string; arm: "whole-case" | "overlap"; readings: readonly Reading[] }
export interface NS1Case {
  caseId: string;
  /** Real use (shopper stills) and controlled (protocol stills) are never pooled (OC35). */
  mode: "real-use" | "controlled";
  deviceClass: "metric-depth" | "relative-stereo" | "none";
  /** Overlap stills in the order they were shot. */
  stills: readonly Still[];
}

/** Every rung here is at least `text-read`, so "confirmed plus readable" is every reading; `confirmed` narrows it. */
const keysOf = (ss: readonly Still[], only: (r: Reading) => boolean = () => true): Set<string> =>
  new Set(ss.flatMap((s) => s.readings.filter(only).map((r) => r.key)));
const isConfirmed = (r: Reading) => r.rung === "confirmed";

export interface CaseScore {
  caseId: string;
  stratum: string;
  /** Works any still of the case read at `text-read` or above: the denominator, machine agreement (INV-17). */
  union: number;
  single: number;
  overlap: number;
  /** Works only the overlap union read, only the whole-case still read, and both. */
  overlapOnly: number;
  singleOnly: number;
  both: number;
  /** Share of `union`: overlap minus single. Positive when margin recovers works. */
  lift: number;
  confirmed: { union: number; single: number; overlap: number };
  /** Size of the overlap union after 1, 2, … stills in shot order: is the third still worth shooting? */
  cumulative: number[];
}

/** Throws on a case the arm did not run on: no single whole-case still, fewer than two overlap stills, a repeat id. */
export function scoreCase(c: NS1Case): CaseScore {
  const whole = c.stills.filter((s) => s.arm === "whole-case");
  const over = c.stills.filter((s) => s.arm === "overlap");
  if (whole.length !== 1) throw new Error(`NS-1: case ${c.caseId} needs exactly one whole-case still, has ${whole.length}`);
  if (over.length < 2 || over.length > 3) throw new Error(`NS-1: case ${c.caseId} needs 2–3 overlap stills, has ${over.length}`);
  if (new Set(c.stills.map((s) => s.stillId)).size !== c.stills.length) throw new Error(`NS-1: case ${c.caseId} repeats a still id`);
  for (const r of c.stills.flatMap((s) => s.readings)) if (!r.key) throw new Error(`NS-1: case ${c.caseId} has a reading with no key`);

  const single = keysOf(whole);
  const overlap = keysOf(over);
  const union = new Set([...single, ...overlap]);
  const both = [...single].filter((k) => overlap.has(k)).length;
  return {
    caseId: c.caseId,
    stratum: `${c.mode}|${c.deviceClass}`,
    union: union.size,
    single: single.size,
    overlap: overlap.size,
    overlapOnly: overlap.size - both,
    singleOnly: single.size - both,
    both,
    lift: union.size === 0 ? 0 : (overlap.size - single.size) / union.size,
    confirmed: { union: keysOf(c.stills, isConfirmed).size, single: keysOf(whole, isConfirmed).size, overlap: keysOf(over, isConfirmed).size },
    cumulative: over.map((_, i) => keysOf(over.slice(0, i + 1)).size),
  };
}

const pooledLift = (xs: readonly CaseScore[]): number | null => {
  const u = xs.reduce((a, x) => a + x.union, 0);
  return u === 0 ? null : xs.reduce((a, x) => a + (x.overlap - x.single), 0) / u;
};

/** Cases, not works, are the cluster: works in one case share its light, shelf and camera. */
export function scoreArm(cases: readonly NS1Case[], reps: number = NS1.reps, seed: number = NS1.seed) {
  const scores = cases.map(scoreCase);
  const strata = new Map<string, CaseScore[]>();
  for (const s of scores) strata.set(s.stratum, [...(strata.get(s.stratum) ?? []), s]);
  return [...strata].sort(([a], [b]) => a.localeCompare(b)).map(([stratum, xs]) => {
    const lift = pooledLift(xs);
    let interval: { lo: number; hi: number } | null = null;
    if (xs.length >= NS1.minCasesForInterval) {
      const rand = rng(seed);
      const draws: number[] = [];
      for (let r = 0; r < reps; r++) {
        const v = pooledLift(Array.from({ length: xs.length }, () => xs[Math.floor(rand() * xs.length)]!));
        if (v !== null) draws.push(v);
      }
      draws.sort((a, b) => a - b);
      interval = { lo: quantile(draws, 0.025), hi: quantile(draws, 0.975) };
    }
    return {
      stratum,
      cases: xs.length,
      pooledLift: lift,
      interval,
      /** Discordant works, summed. Works within a case are not independent, so no p-value is derived from them. */
      overlapOnly: xs.reduce((a, x) => a + x.overlapOnly, 0),
      singleOnly: xs.reduce((a, x) => a + x.singleOnly, 0),
      perCase: xs,
      /** The hypothesis check: the pooled lift reaches `liftHypothesis`, and with an interval, its lower bound is above 0. */
      supportsMargin: lift !== null && lift >= NS1.liftHypothesis && (interval === null || interval.lo > 0),
    };
  });
}
