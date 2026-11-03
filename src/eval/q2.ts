// Q-2 teacher table and first student: the statistics. Pure functions; the runner is q2-cli.ts. The teacher
// gives each detected box a coverage rung (docs/capture/coverage.md §3) from F-0's readings and decisions; the
// student predicts P(rung ≥ text-read) from cheap still-tier signals (§4 S-S2). Every interval is a photo
// bootstrap, and every student score on pilot-000 comes from a model that never saw that photo.
import { auc, byImage, fitLogistic, predictLogistic, quantile, rng } from "./q1.ts";
import type { Logistic } from "./q1.ts";
import { normalize } from "../catalog/normalize.ts";

// --- the ladder ---------------------------------------------------------------------------------------

export const RUNGS = ["not-seen", "seen", "spine-found", "text-present", "text-read", "matched", "confirmed"] as const;
export type Rung = (typeof RUNGS)[number];
export const rungIndex = (r: Rung): number => RUNGS.indexOf(r);
/** The fill line: a box is filled from this rung up. */
export const FILL_RUNG: Rung = "text-read";
export const filled = (r: Rung): boolean => rungIndex(r) >= rungIndex(FILL_RUNG);

/** The parts of an F-0 decision the teacher reads (src/eval/f0.ts SpineDecision). */
export interface TeacherInput {
  accepted: unknown | null;
  reason: "no-text" | "no-catalog-match" | "single-reader" | "readers-disagree" | null;
}

/**
 * Teacher rung of one detected box (§3). A box always has `spine-found`; F-0's reasons place it higher:
 * - accepted (two readers and the catalog agree on one work) → `confirmed`;
 * - one reader's top candidate passes the catalog bar (`single-reader`, `readers-disagree`) → `matched`;
 * - text but no candidate passes the bar (`no-catalog-match`) → `text-read` when two readers' strings agree
 *   at similarity ≥ τ, else `text-present`;
 * - no reader produced text (`no-text`) → `spine-found`.
 * On the yardstick, an accepted box whose work is not in the photo's annotations is still `confirmed` here: the
 * teacher cannot see the annotations, and its readers did agree. The runner counts those separately.
 */
export function teacherRung(d: TeacherInput, agreement: number | null, tau: number): Rung {
  if (d.accepted) return "confirmed";
  switch (d.reason) {
    case "single-reader":
    case "readers-disagree":
      return "matched";
    case "no-catalog-match":
      return agreement !== null && agreement >= tau ? "text-read" : "text-present";
    case "no-text":
      return "spine-found";
    default:
      throw new Error(`a decision with no acceptance and no reason: ${String(d.reason)}`);
  }
}

// --- string agreement between readers ---------------------------------------------------------------------

/** Shortest reading that can count as agreement: fewer normalised letters and digits are too easy to share. */
export const MIN_AGREE_CHARS = 5;

/** The catalog's normalisation with the spaces dropped, since readers split words differently. */
export const squash = (s: string): string => normalize(s).replace(/ /g, "");

/**
 * Edit distance from `short` to the closest substring of `long` (Sellers' approximate matching): one reader
 * may read the title and the other title and author, and the shorter one should still agree.
 */
export function substringDistance(short: string, long: string): number {
  const n = short.length, m = long.length;
  let prev = new Array<number>(m + 1).fill(0); // a match may start anywhere in `long`
  let cur = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    for (let j = 1; j <= m; j++) {
      const sub = prev[j - 1]! + (short.charCodeAt(i - 1) === long.charCodeAt(j - 1) ? 0 : 1);
      cur[j] = Math.min(sub, prev[j]! + 1, cur[j - 1]! + 1);
    }
    [prev, cur] = [cur, prev];
  }
  return Math.min(...prev); // and end anywhere
}

/** Similarity of two squashed readings in [0, 1]; 0 when the shorter has fewer than MIN_AGREE_CHARS. */
export function stringSimilarity(a: string, b: string): number {
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (s.length < MIN_AGREE_CHARS) return 0;
  return 1 - substringDistance(s, l) / s.length;
}

/** Each reader's squashed readings of one box (every rotation and correction variant). */
export type Readings = Partial<Record<string, string[]>>;

/** Best similarity between any two different readers' readings of a box; null when fewer than two read text. */
export function readerAgreement(reads: Readings, other?: Readings): number | null {
  const a = Object.entries(reads).filter(([, v]) => v && v.length) as [string, string[]][];
  const b = other ? (Object.entries(other).filter(([, v]) => v && v.length) as [string, string[]][]) : a;
  let best: number | null = null;
  for (const [ra, va] of a)
    for (const [rb, vb] of b) {
      if (ra === rb || (!other && ra > rb)) continue;
      for (const x of va) for (const y of vb) best = Math.max(best ?? 0, stringSimilarity(x, y));
    }
  return best;
}

/**
 * τ for string agreement: the smallest grid value at which pairs that cannot agree (one reader's readings of a
 * box against another reader's readings of a *different* box in the same photo) pass at most `falseRate`.
 */
export function chooseTau(nullSims: number[], falseRate = 0.01, grid = Array.from({ length: 51 }, (_, i) => 0.5 + i / 100)): number {
  for (const t of grid) if (nullSims.filter((s) => s >= t).length <= falseRate * nullSims.length) return Math.round(t * 100) / 100;
  return 1;
}

/** A derangement of 0..n-1 (no index maps to itself), seeded: the null pairing of boxes within a photo. */
export function derangement(n: number, rand: () => number): number[] {
  if (n < 2) return [];
  const off = 1 + Math.floor(rand() * (n - 1));
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  // Shift by a non-zero offset along a random cycle: every element moves.
  const out = new Array<number>(n);
  for (let k = 0; k < n; k++) out[order[k]!] = order[(k + off) % n]!;
  return out;
}

// --- the student ---------------------------------------------------------------------------------------

/** A student feature: its name, the direction it must push readability (+1, -1, or 0 = free), and how to read it off a row. */
export interface Feature<R> {
  name: string;
  sign: Sign;
  of: (r: R) => number;
}

export type Sign = 1 | -1 | 0;

export interface Monotone {
  features: string[];
  /** Features whose fitted weight came out against their declared sign and were removed, in order. */
  dropped: string[];
  model: Logistic | null;
  /** Indices into `features` of the model's inputs. */
  active: number[];
  /** Base rate, used when every feature was dropped. */
  prior: number;
}

/**
 * Logistic regression constrained to be monotone in each feature in its declared direction: fit; if any
 * standardised weight points the wrong way, drop the worst offender and refit, until none does. An active-set
 * fit, so the result reads as "these signals, each pushing the way the hypothesis says". Sign 0 is never dropped.
 */
export function fitMonotone(x: number[][], y: number[], features: string[], signs: Sign[]): Monotone {
  let active = features.map((_, j) => j);
  const dropped: string[] = [];
  const prior = y.reduce((a, b) => a + b, 0) / Math.max(1, y.length);
  for (;;) {
    if (active.length === 0) return { features, dropped, model: null, active, prior };
    const m = fitLogistic(x.map((r) => active.map((j) => r[j]!)), y, active.map((j) => features[j]!));
    let worst = -1, worstV = 0;
    active.forEach((j, k) => {
      const v = m.weights[k + 1]! * signs[j]!;
      if (v < worstV) { worstV = v; worst = j; }
    });
    if (worst < 0) return { features, dropped, model: m, active, prior };
    dropped.push(features[worst]!);
    active = active.filter((j) => j !== worst);
  }
}

export function predictMonotone(m: Monotone, x: number[]): number {
  return m.model ? predictLogistic(m.model, m.active.map((j) => x[j]!)) : m.prior;
}

/** Fit on rows, with the features evaluated per row. */
export function fitStudent<R>(rows: R[], y: (r: R) => number, feats: Feature<R>[]): Monotone {
  return fitMonotone(rows.map((r) => feats.map((f) => f.of(r))), rows.map(y), feats.map((f) => f.name), feats.map((f) => f.sign));
}

export const predictStudent = <R>(m: Monotone, feats: Feature<R>[], r: R): number => predictMonotone(m, feats.map((f) => f.of(r)));

/**
 * Leave-one-image-out: for each photo, fit on every other photo and score that photo's rows. Returns the
 * out-of-fold scores in `rows` order and the fitted models (one per photo).
 */
export function leaveOneImageOut<R extends { imageId: string }>(rows: R[], y: (r: R) => number, feats: Feature<R>[]): { p: number[]; folds: { imageId: string; model: Monotone }[] } {
  const p = new Array<number>(rows.length).fill(NaN);
  const folds: { imageId: string; model: Monotone }[] = [];
  const ids = [...new Set(rows.map((r) => r.imageId))].sort();
  for (const id of ids) {
    const model = fitStudent(rows.filter((r) => r.imageId !== id), y, feats);
    folds.push({ imageId: id, model });
    rows.forEach((r, i) => { if (r.imageId === id) p[i] = predictStudent(model, feats, r); });
  }
  return { p, folds };
}

// --- scoring ---------------------------------------------------------------------------------------------

/** A scored row: its photo, its teacher label (1 = filled) and one score per named model. */
export interface Scored {
  imageId: string;
  y: number;
  s: Record<string, number>;
}

export const aucOf = (rows: Scored[], model: string): number | null =>
  auc(rows.filter((r) => r.y === 1).map((r) => r.s[model]!), rows.filter((r) => r.y === 0).map((r) => r.s[model]!));

export function brier(rows: Scored[], model: string): number | null {
  if (!rows.length) return null;
  return rows.reduce((a, r) => a + (r.s[model]! - r.y) ** 2, 0) / rows.length;
}

export interface ReliabilityBin {
  lo: number;
  hi: number;
  n: number;
  meanP: number | null;
  observed: number | null;
}

/** Reliability curve on `bins` equal-width bins of the score; the last bin is closed. */
export function reliability(rows: Scored[], model: string, bins = 10): ReliabilityBin[] {
  const out = Array.from({ length: bins }, (_, b) => ({ lo: b / bins, hi: (b + 1) / bins, n: 0, sp: 0, sy: 0 }));
  for (const r of rows) {
    const p = r.s[model]!;
    const b = Math.min(bins - 1, Math.max(0, Math.floor(p * bins)));
    out[b]!.n++;
    out[b]!.sp += p;
    out[b]!.sy += r.y;
  }
  return out.map((b) => ({ lo: b.lo, hi: b.hi, n: b.n, meanP: b.n ? b.sp / b.n : null, observed: b.n ? b.sy / b.n : null }));
}

/** Expected calibration error: the n-weighted mean gap between mean score and observed rate over the bins. */
export function ece(rows: Scored[], model: string, bins = 10): number | null {
  if (!rows.length) return null;
  return reliability(rows, model, bins).reduce((a, b) => a + (b.n ? (b.n / rows.length) * Math.abs(b.meanP! - b.observed!) : 0), 0);
}

export type Interval = [number, number, number];

/**
 * Paired cluster bootstrap: photos are drawn with replacement once per replicate and every statistic is
 * recomputed on that same draw, so differences between statistics (ΔAUC) get honest intervals.
 */
export function pairedBootstrap<T extends { imageId: string }>(
  rows: T[],
  stats: Record<string, (rows: T[]) => number | null>,
  reps = 1000,
  seed = 1,
): Record<string, Interval | null> {
  const groups = byImage(rows);
  const rand = rng(seed);
  const draws: Record<string, number[]> = Object.fromEntries(Object.keys(stats).map((k) => [k, []]));
  for (let r = 0; r < reps; r++) {
    const sample: T[] = [];
    for (let i = 0; i < groups.length; i++) sample.push(...groups[Math.floor(rand() * groups.length)]!);
    for (const [k, f] of Object.entries(stats)) {
      const v = f(sample);
      if (v !== null && Number.isFinite(v)) draws[k]!.push(v);
    }
  }
  const out: Record<string, Interval | null> = {};
  for (const [k, f] of Object.entries(stats)) {
    const v = f(rows);
    const d = draws[k]!.sort((a, b) => a - b);
    out[k] = v === null || !Number.isFinite(v) || d.length === 0 ? null : [r4(v), r4(quantile(d, 0.025)), r4(quantile(d, 0.975))];
  }
  return out;
}

export const r4 = (x: number): number => Math.round(x * 10000) / 10000;

/** Does an interval exclude 0 (lower bound above it, or upper bound below)? */
export const excludesZero = (t: Interval | null): boolean => !!t && (t[1] > 0 || t[2] < 0);

// --- operating point -------------------------------------------------------------------------------------

export interface OperatingPoint {
  fillP: number;
  /** Share of boxes the student would fill. */
  filledShare: number;
  /** Of those, the share the teacher measures at text-read or above (1 - the closer-look rate). */
  precision: number | null;
  /** Of the boxes the teacher measures filled, the share the student fills. */
  recall: number | null;
}

export function operatingPoints(rows: Scored[], model: string, thresholds: number[]): OperatingPoint[] {
  const pos = rows.filter((r) => r.y === 1).length;
  return thresholds.map((t) => {
    const f = rows.filter((r) => r.s[model]! >= t);
    const tp = f.filter((r) => r.y === 1).length;
    return { fillP: t, filledShare: rows.length ? f.length / rows.length : 0, precision: f.length ? tp / f.length : null, recall: pos ? tp / pos : null };
  });
}

/** The lowest threshold whose precision reaches `target`: fill as much as possible while wrong fills stay rare. */
export function chooseFillP(points: OperatingPoint[], target: number): number | null {
  const ok = points.filter((p) => p.precision !== null && p.precision >= target).sort((a, b) => a.fillP - b.fillP);
  return ok[0]?.fillP ?? null;
}

// --- top-edge geometry (the owner's hypothesis) -------------------------------------------------------------

export type TopClass = "overshoot" | "cut" | "clean" | "none";
/** Seam offset (share of the long side) beyond which a box top is called off the spine top: the detector window, its resolution. */
export const SEAM_OFF = 0.05;

/** Where the spine's measured top edge sits against the box's top end (helpers/coverage/geometry.py). */
export function topClass(seam: number | null): TopClass {
  if (seam === null) return "none";
  if (seam > SEAM_OFF) return "overshoot";
  if (seam < -SEAM_OFF) return "cut";
  return "clean";
}

/** Box height against the median height of the boxes in its shelf band, as a log ratio (0 = typical). */
export function heightOffBand<T extends { imageId: string; band: number | null; longPx: number | null }>(rows: T[]): Map<T, number | null> {
  const med = new Map<string, number>();
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    if (r.band === null || r.longPx === null) continue;
    const k = `${r.imageId}\u0000${r.band}`;
    groups.set(k, [...(groups.get(k) ?? []), r.longPx]);
  }
  for (const [k, v] of groups) if (v.length >= 3) med.set(k, quantile(v.sort((a, b) => a - b), 0.5));
  const out = new Map<T, number | null>();
  for (const r of rows) {
    const m = r.band === null ? undefined : med.get(`${r.imageId}\u0000${r.band}`);
    out.set(r, m && r.longPx ? Math.log(r.longPx / m) : null);
  }
  return out;
}
