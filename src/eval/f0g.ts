// F-0g copy groups: bookstores shelve several copies of one book side by side. Neighbouring spines that look the
// same and whose reads do not contradict each other form a copy group; inside a group, a confirmed copy's work is
// evidence for an unconfirmed one (`confirmed-by-copy`), never a bypass of its own reads and never a merge: every
// copy stays its own observation (INV-4). Pure functions over cached detections, decisions and reader tops; the
// runner is f0g-cli.ts. Only aggregates leave $BOOKCASE_DATA (evals/F0g/). Spec: docs/machine-labelling.md.
import { normalize, tokenize } from "../catalog/normalize.ts";
import { ACCEPT, type Detection, type ReaderName } from "./f0.ts";
import { boxRows, median } from "./f0e.ts";
import { predictLogistic, type Logistic } from "./q1.ts";

export const COPY = {
  /** Neighbours: the gap between two boxes along the shelf is at most this many median spine widths. */
  maxGapWidths: 0.6,
  /** Centres closer than this share of the narrower box's width are one spine twice (pieces, duplicates). */
  minCentreWidths: 0.6,
  /** Neighbours stand on one shelf: their vertical extents overlap by this share of the shorter box. */
  minRowOverlap: 0.6,
  /**
   * Copies are one size: long sides within this ratio (perspective changes slowly along a shelf), short sides
   * within the wider one (box edges wobble more across a thin spine than along it).
   */
  maxLongRatio: 1.15,
  maxShortRatio: 1.4,
  /** A reader is consistent with a work when the work's title evidence on its text is at least this. */
  consistentTitle: 0.5,
  /** A reader contradicts a work when its own top candidate, another title, has title evidence this high and outscores it. */
  otherTitle: ACCEPT.minTitleEvidence,
} as const;

/**
 * The visual same-copy score: logistic regression over the appearance similarities (helpers/label/appearance.py)
 * and the size ratios, fitted on pilot-000 neighbours whose identities both readers confirmed (same work against
 * different works), never on the yardstick. `threshold` is the pre-registered operating point: the out-of-fold
 * score at which 2 % of different-work neighbours pass (evals/F0g/report.md, Calibration). Frozen here by
 * `f0g-cli.ts calibrate`.
 */
export const VISUAL: Logistic & { threshold: number } = {
  features: ["ncc", "hist", "prof", "longLog", "shortLog"],
  mean: [0.422971, 0.773144, 0.615106, 0.059397, 0.274923],
  sd: [0.23315, 0.180438, 0.238502, 0.064643, 0.255259],
  weights: [-1.950603, 0.696485, 0.00257, 2.28195, 0.174508, 0.006699],
  threshold: 0.695638,
};

// --- neighbours ------------------------------------------------------------------------------------------

export interface Neighbour {
  /** Box indices in the detection, a left of b. */
  a: number;
  b: number;
  band: number;
  /** Long-side and short-side ratios, larger over smaller. */
  longRatio: number;
  shortRatio: number;
}

function overlap1d(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/**
 * Pairs of neighbouring spines: upright boxes in one shelf band, not nested in a larger box, each paired with the
 * nearest box to its right that stands on the same shelf, is not the same spine twice and leaves a gap of at most
 * `maxGapWidths` median spine widths. Lying books and boxes outside every band are not paired. With `isBook`, boxes
 * it rejects (F-0c's and F-0f's `not-a-book`) are left out before pairing, as if not detected; indices stay the set's.
 */
export function neighbours(det: Detection, isBook?: (i: number) => boolean): Neighbour[] {
  if (isBook) {
    const keep = det.spines.flatMap((_, i) => (isBook(i) ? [i] : []));
    return neighbours({ ...det, spines: keep.map((i) => det.spines[i]!) }).map((n) => ({ ...n, a: keep[n.a]!, b: keep[n.b]! }));
  }
  const rows = boxRows(det);
  const mw = det.gaps.medianWidth || median(rows.map((r) => r.g.short)) || 1;
  const out: Neighbour[] = [];
  const usable = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.band >= 0 && r.upright && !r.inside);
  for (const { r: a, i } of usable) {
    let best: { j: number; dx: number } | null = null;
    for (const { r: b, i: j } of usable) {
      if (j === i || b.band !== a.band) continue;
      const dx = b.g.cx - a.g.cx;
      if (dx < COPY.minCentreWidths * Math.min(a.g.short, b.g.short)) continue;
      if (dx - (a.g.short + b.g.short) / 2 > COPY.maxGapWidths * mw) continue;
      const shared = overlap1d(a.g.top, a.g.bottom, b.g.top, b.g.bottom);
      if (shared < COPY.minRowOverlap * Math.min(a.g.bottom - a.g.top, b.g.bottom - b.g.top)) continue;
      if (!best || dx < best.dx) best = { j, dx };
    }
    if (!best) continue;
    const b = rows[best.j]!.g;
    out.push({
      a: i,
      b: best.j,
      band: a.band,
      longRatio: Math.max(a.g.long, b.long) / Math.max(1e-6, Math.min(a.g.long, b.long)),
      shortRatio: Math.max(a.g.short, b.short) / Math.max(1e-6, Math.min(a.g.short, b.short)),
    });
  }
  return out;
}

// --- visual sameness -------------------------------------------------------------------------------------

/** appearance.py's similarities for one pair. */
export interface Appearance {
  ncc: number;
  hist: number;
  prof: number;
  valid: boolean;
}

export const visualFeatures = (ap: Appearance, n: Pick<Neighbour, "longRatio" | "shortRatio">): number[] => [
  ap.ncc,
  ap.hist,
  ap.prof,
  Math.log(n.longRatio),
  Math.log(n.shortRatio),
];

export function visualScore(ap: Appearance, n: Pick<Neighbour, "longRatio" | "shortRatio">, model: Logistic = VISUAL): number {
  return predictLogistic(model, visualFeatures(ap, n));
}

/** Visually the same copy: both strips in frame, the same size, and a score at the calibrated threshold. */
export function visuallySame(ap: Appearance, n: Pick<Neighbour, "longRatio" | "shortRatio">, model: Logistic & { threshold: number } = VISUAL): boolean {
  return ap.valid && n.longRatio <= COPY.maxLongRatio && n.shortRatio <= COPY.maxShortRatio && visualScore(ap, n, model) >= model.threshold;
}

// --- the series guard ------------------------------------------------------------------------------------

export interface WorkRef {
  workId: string;
  title: string;
  authors: string[];
}

/** One reader's best catalog candidate for a spine (F-0's `topFor`), and whether it passes F-0's bar. */
export interface ReaderTop {
  reader: ReaderName;
  top: (WorkRef & { score: number; titleEvidence: number; passes: boolean }) | null;
}

/** What a spine's own reads say: F-0's accepted work, and each reader that read text. */
export interface SpineEvidence {
  id: string;
  accepted: WorkRef | null;
  readers: ReaderTop[];
  /** Imprint key read on the spine (F-0d), when there is one. */
  imprint?: string | null;
}

/** A work scored against one reader's text of one spine (`scoreWorks`); null when that reader read nothing. */
export type Fit = (spineId: string, reader: ReaderName, workId: string) => { score: number; titleEvidence: number } | null;

export type GuardReason = "accepted-differ" | "reader-confirms-other" | "reads-other-title" | "reads-differ" | "imprint-differs";

const titleKey = (t: string): string => tokenize(normalize(t)).join(" ");
const surnames = (authors: string[]): Set<string> => new Set(authors.map((a) => tokenize(normalize(a)).at(-1) ?? "").filter(Boolean));

/** The same work: one id, or the same normalised title by a shared surname (the catalog holds some works twice). */
export function sameWork(a: WorkRef, b: WorkRef): boolean {
  if (a.workId === b.workId) return true;
  if (titleKey(a.title) !== titleKey(b.title)) return false;
  const sb = surnames(b.authors);
  return [...surnames(a.authors)].some((s) => sb.has(s));
}

/** Two works by a shared author (surname): a series run in matching jackets is the case the guard is for. */
export function sameAuthor(a: WorkRef, b: WorkRef): boolean {
  const sb = surnames(b.authors);
  return [...surnames(a.authors)].some((s) => sb.has(s));
}

/**
 * Does spine `y`'s own evidence contradict work `w`? It does when F-0 accepted another work for it; when one of its
 * readers confirms another work (passes F-0's bar); or when a reader's top candidate is another title with strong
 * title evidence (`otherTitle`) that outscores `w` on that reader's text: the next book of a series, read well
 * enough to tell, but not well enough to pass the bar.
 */
export function contradiction(y: SpineEvidence, w: WorkRef, fit: Fit): GuardReason | null {
  if (y.accepted) return sameWork(y.accepted, w) ? null : "accepted-differ";
  for (const r of y.readers) {
    if (!r.top || sameWork(r.top, w)) continue;
    if (r.top.passes) return "reader-confirms-other";
    const f = fit(y.id, r.reader, w.workId);
    if (r.top.titleEvidence >= COPY.otherTitle && r.top.score > (f?.score ?? 0)) return "reads-other-title";
  }
  return null;
}

/** Readers of `y` whose text supports `w`: its title evidence there is at least `consistentTitle`. */
export function consistentReaders(y: SpineEvidence, w: WorkRef, fit: Fit): ReaderName[] {
  return y.readers.filter((r) => (r.top && sameWork(r.top, w)) || (fit(y.id, r.reader, w.workId)?.titleEvidence ?? 0) >= COPY.consistentTitle).map((r) => r.reader);
}

/** The works a spine's reads claim strongly: confirmed by a reader, or read with strong title evidence. */
function claims(x: SpineEvidence): WorkRef[] {
  return x.readers.flatMap((r) => (r.top && (r.top.passes || r.top.titleEvidence >= COPY.otherTitle) ? [r.top] : []));
}

/**
 * The series guard for two visually alike neighbours. Copies need the same work wherever both are identified, no
 * read on one that contradicts the other's work, agreeing title reads where neither is identified, and the same
 * imprint where both have one read.
 */
export function pairGuard(x: SpineEvidence, y: SpineEvidence, fit: Fit): GuardReason | null {
  if (x.imprint && y.imprint && x.imprint !== y.imprint) return "imprint-differs";
  if (x.accepted && y.accepted) return sameWork(x.accepted, y.accepted) ? null : "accepted-differ";
  if (x.accepted) return contradiction(y, x.accepted, fit);
  if (y.accepted) return contradiction(x, y.accepted, fit);
  const cx = claims(x);
  const cy = claims(y);
  if (cx.length > 0 && cy.length > 0 && !cx.some((a) => cy.some((b) => sameWork(a, b)))) return "reads-differ";
  return null;
}

// --- copy groups and propagation -------------------------------------------------------------------------

/** Runs of linked neighbours (box indices, in shelf order); singletons are not groups. */
export function copyGroups(links: { a: number; b: number }[], order: (i: number) => number): number[][] {
  const parent = new Map<number, number>();
  const find = (i: number): number => {
    let p = parent.get(i) ?? i;
    while (p !== (parent.get(p) ?? p)) p = parent.get(p)!;
    parent.set(i, p);
    return p;
  };
  for (const { a, b } of links) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const groups = new Map<number, number[]>();
  for (const i of new Set(links.flatMap((l) => [l.a, l.b]))) {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  }
  return [...groups.values()].map((g) => g.sort((p, q) => order(p) - order(q)));
}

/** What a confirmed label rests on: F-0's two agreeing readers, or a confirmed copy beside it plus its own consistent reads. */
export type DecisionBasis = "readers-agree" | "confirmed-by-copy";

export interface CopyDecision {
  id: string;
  basis: DecisionBasis | null;
  workId: string | null;
  /** confirmed-by-copy: the group member whose work it takes, and this spine's readers consistent with it. */
  from?: string;
  consistent?: ReaderName[];
  /** Why an unconfirmed member did not take the group's work. */
  blocked?: GuardReason | "no-consistent-reader" | "mixed-group";
}

/**
 * Propagation inside one copy group (members in shelf order). The group's work is the one its confirmed members
 * share; a group whose confirmed members name different works propagates nothing. Each unconfirmed member takes
 * the work as `confirmed-by-copy` only if its own reads do not contradict it and at least one of its readers is
 * consistent with it. Every member keeps its own decision: nothing is merged (INV-4).
 */
export function propagate(group: SpineEvidence[], fit: Fit): CopyDecision[] {
  const confirmed = group.filter((s) => s.accepted);
  const works: WorkRef[] = [];
  for (const s of confirmed) if (!works.some((w) => sameWork(w, s.accepted!))) works.push(s.accepted!);
  return group.map((s, k) => {
    if (s.accepted) return { id: s.id, basis: "readers-agree", workId: s.accepted.workId };
    if (works.length === 0) return { id: s.id, basis: null, workId: null };
    if (works.length > 1) return { id: s.id, basis: null, workId: null, blocked: "mixed-group" };
    const w = works[0]!;
    const reason = contradiction(s, w, fit);
    if (reason) return { id: s.id, basis: null, workId: null, blocked: reason };
    const consistent = consistentReaders(s, w, fit);
    if (consistent.length === 0) return { id: s.id, basis: null, workId: null, blocked: "no-consistent-reader" };
    // The nearest confirmed member in shelf order is the one recorded as the source.
    const near = group
      .map((m, j) => ({ m, d: Math.abs(j - k) }))
      .filter(({ m }) => m.accepted)
      .sort((a, b) => a.d - b.d)[0]!.m;
    return { id: s.id, basis: "confirmed-by-copy", workId: w.workId, from: near.id, consistent };
  });
}
