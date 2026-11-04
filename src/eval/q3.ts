// Q-3 gap audit: the pure part. For every book a person can see on a still (a kept box, a row gap with a spine-like
// face and no box, a face-out cover the default does not box), the coverage rung where the machine stopped and the
// one primary cause, by the rules pre-registered in evals/Q3/report.md. The runner is q3-cli.ts.
import { area, intersectionArea } from "./f0c.ts";
import { clusterBootstrap } from "./q1.ts";
import { rungIndex, type Rung } from "./q2.ts";
import type { Elevation } from "./s1.ts";

type Pt = [number, number];

// --- constants (pre-registered) -------------------------------------------------------------------------

export const Q3 = {
  /** Q-2's box-score floor: a box under it with no text is probably not a book (Q-1). */
  floor: 0.225,
  /** Q-1's H2 cut (Q-2's EDGE_RADIAL): radial distance beyond which a box sits in the lens's outer ring. */
  outerRadial: 0.5612,
  /** H-1's over-select bar, applied to the top share alone. */
  topShare: 0.15,
  /** Share of a book's area inside a talker, card or cover standing in front of it. */
  occluded: 0.25,
  /** F-0c's absorbed rule: share of a box inside a kept face-out cover. */
  absorbed: 0.6,
  /** Share of a gap inside a box the shape filter dropped. */
  droppedShape: 0.25,
  /** Margin, as a share of the frame's long side, inside which a gap or a cover counts as cut by the frame. */
  frameMargin: 0.01,
  /** F-0e's fine tiles reach this share of a band's height above and below it. */
  bandGrow: 0.12,
  /** Quantile of the confirmed boxes' luma and contrast under which a box is dark or flat. */
  darkQuantile: 0.05,
  /** S-1's bin, in median spine widths. */
  binW: 0.25,
} as const;

export const CAUSES = [
  "frame-edge",
  "tiling-or-side-case",
  "shape-filter",
  "top-face",
  "dark-or-low-contrast",
  "occlusion",
  "catalog-gap",
  "misread",
  "single-reader",
  "lying-flat",
  "doubtful-box",
  "unattributed",
] as const;
export type Cause = (typeof CAUSES)[number];
/** Codes that are residuals of the audit, not causes a card can work on. */
export const RESIDUAL: ReadonlySet<Cause> = new Set(["doubtful-box", "unattributed"]);

export interface CauseHit {
  cause: Cause;
  sub: string | null;
}

export type BookKind = "box" | "gap" | "face-out";
export type FramePos = "cut" | "outer" | "centre";

/** The splits every count is also given by. */
export interface Splits {
  elevation: Elevation | null;
  case: "main" | "side";
  frame: FramePos;
  /** Place among the photo's S-1 rows from the top ("6+" past six), or "none". */
  row: string;
}

export interface Book extends Splits {
  id: string;
  imageId: string;
  kind: BookKind;
  /** How many books this record stands for (a gap of several median widths holds several). */
  books: number;
  rung: Rung;
  primary: CauseHit | null;
  all: CauseHit[];
}

// --- the per-box facts the rules read ---------------------------------------------------------------------

export interface BoxFacts {
  rung: Rung;
  /** F-0's unknown reason (null when accepted). */
  reason: "no-text" | "no-catalog-match" | "single-reader" | "readers-disagree" | null;
  boxScore: number;
  /** Q-1: share of the polygon outside the frame. */
  outFrac: number;
  radial: number;
  /** F-0's flag: cut by a detector tile edge. */
  tileCut: boolean;
  /** H-2: the box stands in a side case with a plane of its own. */
  sideCase: boolean;
  lying: boolean;
  /** H-2 face shares (null when not measured). */
  shares: Record<string, number> | null;
  luma: number | null;
  contrast: number | null;
  /** In front of the box: a shelf-talker or card, or a face-out cover (null: nothing). */
  occludedBy: "talker" | "cover" | null;
  /** The box is mostly inside a kept face-out cover (F-0c's absorbed). */
  faceOutPiece: boolean;
  /** catalog-v2 re-decision: two readers agree on a work, or at least one reader passes the bar (null: not run). */
  v2: { accept: boolean; pass: boolean } | null;
}

export interface DarkBar {
  luma: number;
  contrast: number;
}

export function darkHit(luma: number | null, contrast: number | null, bar: DarkBar): CauseHit | null {
  if (luma !== null && luma < bar.luma) return { cause: "dark-or-low-contrast", sub: "dark" };
  if (contrast !== null && contrast < bar.contrast) return { cause: "dark-or-low-contrast", sub: "low-contrast" };
  return null;
}

/** H-2's top share is at least the bar and the largest share other than `front`. */
export function topFaceOver(shares: Record<string, number> | null): boolean {
  if (!shares) return false;
  const top = shares.top ?? 0;
  if (top < Q3.topShare) return false;
  return Object.entries(shares).every(([k, v]) => k === "front" || k === "top" || v <= top);
}

/** The capture rules shared by `spine-found` and `text-present`, in order, through the outer ring. */
function captureHits(b: BoxFacts, bar: DarkBar): CauseHit[] {
  const hits: (CauseHit | null)[] = [
    b.outFrac > 0 ? { cause: "frame-edge", sub: "cut" } : null,
    b.tileCut ? { cause: "tiling-or-side-case", sub: "tile-cut" } : null,
    b.sideCase ? { cause: "tiling-or-side-case", sub: "side-case" } : null,
    b.occludedBy ? { cause: "occlusion", sub: b.occludedBy } : null,
    b.faceOutPiece ? { cause: "shape-filter", sub: "face-out-piece" } : null,
    topFaceOver(b.shares) ? { cause: "top-face", sub: null } : null,
    b.lying ? { cause: "lying-flat", sub: null } : null,
    darkHit(b.luma, b.contrast, bar),
    b.radial > Q3.outerRadial ? { cause: "frame-edge", sub: "outer" } : null,
  ];
  return hits.filter((h): h is CauseHit => h !== null);
}

/** Every cause that holds for a kept box, primary first (pre-registered order per stop rung). Empty when confirmed. */
export function boxCauses(b: BoxFacts, bar: DarkBar, yardstick = false): CauseHit[] {
  switch (b.rung) {
    case "confirmed":
      return [];
    case "matched":
      if (b.reason === "single-reader") return [{ cause: "single-reader", sub: null }];
      if (b.reason === "readers-disagree") return [{ cause: "misread", sub: "disagree" }];
      return [{ cause: "unattributed", sub: null }];
    case "text-read":
      return [{ cause: "catalog-gap", sub: yardstick ? "inventory" : b.v2?.pass ? "open-catalog" : "no-local-catalog" }];
    case "text-present": {
      const first: CauseHit[] = !yardstick && b.v2?.accept ? [{ cause: "catalog-gap", sub: "open-catalog" }] : [];
      return [...first, ...captureHits(b, bar), { cause: "misread", sub: "garbled" }];
    }
    case "spine-found": {
      const out = captureHits(b, bar);
      if (b.boxScore < Q3.floor) out.push({ cause: "doubtful-box", sub: null });
      out.push({ cause: "unattributed", sub: null });
      return out;
    }
    default:
      throw new Error(`a kept box at rung ${b.rung}`);
  }
}

export interface GapFacts {
  frameCut: boolean;
  outer: boolean;
  occludedBy: "talker" | "cover" | null;
  droppedShape: boolean;
  noBandTile: boolean;
  /** Both nearest kept boxes along the row are dark or flat (null: a side has no box). */
  darkNeighbours: CauseHit | null;
}

export function gapCauses(g: GapFacts): CauseHit[] {
  const hits: (CauseHit | null)[] = [
    g.frameCut ? { cause: "frame-edge", sub: "cut" } : null,
    g.occludedBy ? { cause: "occlusion", sub: g.occludedBy } : null,
    g.droppedShape ? { cause: "shape-filter", sub: "dropped-shape" } : null,
    g.noBandTile ? { cause: "tiling-or-side-case", sub: "no-band-tile" } : null,
    g.darkNeighbours,
    g.outer ? { cause: "frame-edge", sub: "outer" } : null,
    { cause: "unattributed", sub: null },
  ];
  return hits.filter((h): h is CauseHit => h !== null);
}

export function coverCauses(frameCut: boolean): CauseHit[] {
  return [...(frameCut ? [{ cause: "frame-edge", sub: "cut" } as CauseHit] : []), { cause: "shape-filter", sub: "face-out" }];
}

// --- geometry -----------------------------------------------------------------------------------------------

/** Books a `frontNoBox` stretch holds: its length in median spine widths, rounded, at least one. */
export const gapBooks = (fromW: number, toW: number): number => Math.max(1, Math.round(toW - fromW));

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const len = (a: Pt): number => Math.hypot(a[0], a[1]);

/** The point at arc length `t` along a polyline, and the unit normal to the right of travel (image y down). */
export function alongPolyline(line: Pt[], t: number): { p: Pt; n: Pt } {
  let s = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!, b = line[i + 1]!;
    const d = sub(b, a);
    const L = len(d);
    if (L === 0) continue;
    const last = i === line.length - 2;
    if (t <= s + L || last) {
      const f = (t - s) / L; // past either end, extended straight
      return { p: [a[0] + d[0] * f, a[1] + d[1] * f], n: [-d[1] / L, d[0] / L] };
    }
    s += L;
  }
  const a = line[0]!;
  return { p: a, n: [0, 1] };
}

export interface RowLine {
  /** S-1's polyline through the row's book centres, extended at both ends (working-copy pixels). */
  line: Pt[];
  /** The middle half of the books' height, as offsets from the polyline (working-copy pixels). */
  zone: [number, number];
  /** Where the books start, in widths from the row's start. */
  booksW0: number;
  /** The photo's median spine width (working-copy pixels). */
  mw: number;
}

/**
 * The working-copy quad of a stretch `from`–`to` (median widths from the row's start), reconstructed as
 * pre-registered: the row starts at S-1's first bin (the first book centre less half a width, floored to a bin) less
 * `booksW0`; across, the zone grown to the books' full height.
 */
export function gapPolygon(row: RowLine, fromW: number, toW: number): Pt[] {
  const { line, zone, booksW0, mw } = row;
  const firstCentre = line.length > 1 ? len(sub(line[1]!, line[0]!)) : 0;
  const bstartW = Math.floor((firstCentre - 0.5 * mw) / mw / Q3.binW) * Q3.binW;
  const loW = bstartW - booksW0;
  const mid = (zone[0] + zone[1]) / 2, half = zone[1] - zone[0];
  const at = (w: number, off: number): Pt => {
    const { p, n } = alongPolyline(line, (w + loW) * mw);
    return [p[0] + n[0] * off, p[1] + n[1] * off];
  };
  return [at(fromW, mid - half), at(toW, mid - half), at(toW, mid + half), at(fromW, mid + half)];
}

export const centroid = (p: readonly Pt[]): Pt => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];

/** Share of `p`'s area inside the union of `others` (summed, capped at 1: kept boxes barely overlap after F-0i). */
export function shareInside(p: readonly Pt[], others: readonly (readonly Pt[])[]): number {
  const a = area(p);
  if (a <= 0) return 0;
  let s = 0;
  for (const o of others) s += intersectionArea(p, o);
  return Math.min(1, s / a);
}

/** Any corner outside the frame, or within the margin of its edge. */
export function frameCut(p: readonly Pt[], width: number, height: number): boolean {
  const m = Q3.frameMargin * Math.max(width, height);
  return p.some(([x, y]) => x < m || y < m || x > width - m || y > height - m);
}

/** Q-1's radial distance of a point: 0 at the frame's centre, 1 at a corner. */
export const radialOf = ([x, y]: Pt, width: number, height: number): number => Math.hypot(x / width - 0.5, y / height - 0.5) / Math.hypot(0.5, 0.5);

/** A band polygon (4 points) grown along its short axis by `grow` of its height at each side. */
export function growBand(p: readonly Pt[], grow: number): Pt[] {
  const c = centroid(p);
  const e1 = sub(p[1]!, p[0]!), e2 = sub(p[2]!, p[1]!);
  const across = len(e1) <= len(e2) ? e1 : e2;
  const ua: Pt = [across[0] / (len(across) || 1), across[1] / (len(across) || 1)];
  return p.map((q) => {
    const r = sub(q, c);
    const k = (r[0] * ua[0] + r[1] * ua[1]) * 2 * grow;
    return [q[0] + ua[0] * k, q[1] + ua[1] * k];
  });
}

/** Point in a convex or simple polygon (ray casting). */
export function inside(p: readonly Pt[], [x, y]: Pt): boolean {
  let hit = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i]!, [xj, yj] = p[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** "0".."5", "6+", or "none": a row's place among the photo's rows from the top. */
export const rowLabel = (ordinal: number | null): string => (ordinal === null ? "none" : ordinal >= 6 ? "6+" : String(ordinal));

/** The q-quantile (lower, as F-0c's quantileOf) of a list; null when empty. */
export function lowerQuantile(xs: number[], q: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
}

// --- aggregates ---------------------------------------------------------------------------------------------

export const lost = (b: Book): boolean => b.rung !== "confirmed";

/** Books (weighted by `books`) matching `pred`, summed. */
export const countOf = (pred: (b: Book) => boolean) => (rows: Book[]): number => rows.reduce((s, b) => s + (pred(b) ? b.books : 0), 0);

export interface Count {
  n: number;
  lo: number;
  hi: number;
}

/** A count with its 95 % photo-cluster bootstrap interval. */
export function countCI(rows: Book[], pred: (b: Book) => boolean, reps: number, seed: number): Count {
  const r = clusterBootstrap(rows, countOf(pred), reps, seed);
  return r ? { n: r.value, lo: r.lo, hi: r.hi } : { n: 0, lo: 0, hi: 0 };
}

export interface RankedCause {
  cause: Cause;
  lost: Count;
  share: number;
  /** Books for which the cause held at all (primary or not). */
  any: number;
}

/** Causes by books lost (primary), largest first; residuals included and flagged by the caller. */
export function rankCauses(rows: Book[], reps: number, seed: number): RankedCause[] {
  const total = countOf(lost)(rows);
  return CAUSES.map((c, i) => {
    const l = countCI(rows, (b) => lost(b) && b.primary?.cause === c, reps, seed + i);
    return { cause: c, lost: l, share: total ? l.n / total : 0, any: countOf((b) => lost(b) && b.all.some((h) => h.cause === c))(rows) };
  })
    .filter((r) => r.lost.n > 0 || r.any > 0)
    .sort((a, b) => b.lost.n - a.lost.n || CAUSES.indexOf(a.cause) - CAUSES.indexOf(b.cause));
}

/** Two ranked causes tie when their intervals overlap. */
export const ties = (a: Count, b: Count): boolean => a.lo <= b.hi && b.lo <= a.hi;

export const rungOrder = (a: Rung, b: Rung): number => rungIndex(a) - rungIndex(b);
