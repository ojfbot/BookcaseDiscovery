// S-2 headroom map: F-0f's top line recomputed on F-0i's partition, the kind of every box a headroom region can be
// checked against, and the measures over helpers/shelf/headroom.py's output. Pure functions: no pixels, no readers.
// Runner: s2-cli.ts. Measured in evals/S2/report.md, against rules fixed before the full run.
import type { Detection } from "./f0.ts";
import type { BoxKind, KindWhy } from "./f0c.ts";
import { geometry } from "./f0e.ts";
import { ROW, rowFits, theilSen } from "./f0f.ts";
import { NOT_A_BOOK } from "./f0c.ts";
import type { Elevation } from "./s1.ts";

type Point = [number, number];

/** Fixed before the full run (evals/S2/report.md, Pre-registration); headroom.py holds the pixel thresholds. */
export const S2 = {
  /** A box lying flat: long side more than this from vertical (F-0c's NOT_A_BOOK.flatDeg). */
  flatDeg: NOT_A_BOOK.flatDeg,
  /** A box covering at least this share of a region's pixels explains it (headroom.py's EXPLAIN). */
  explain: 0.3,
  /** A known box is in the headroom when at least this share of its valid pixels is, and recalled when ... */
  inHeadroom: 0.5,
  /** ... at least this share of those is occupied. */
  recalled: 0.5,
  /** A stretch with under this share of its uncovered pixels in any box, an outline gap facing front, has no box. */
  noBox: 0.5,
  /** Adequacy as F-0k's input (pilot-000): unknown share at most, and recall of known content at least. */
  maxUnknown: 0.25,
  minRecall: 0.6,
} as const;

// --- the top line on the partition ---------------------------------------------------------------------------

/** One fitted box's top line, y = a x + b in working-copy pixels, its row's spine height and its own x-extent. */
export interface TopLine {
  a: number;
  b: number;
  h: number;
  x0: number;
  x1: number;
}

/**
 * F-0f's `rowFits` on the partition's kept boxes (detection rectangles), with each whole neighbour's top end taken from
 * its exclusive outline: the point on the box's long axis level with the outline's furthest extent up that axis. A box
 * with no outline keeps its rectangle's end. Keys are the detection's own box indices.
 */
export function partitionTops(det: Detection, kept: number[], outlines: Map<number, Point[]>): Map<number, TopLine> {
  const sub: Detection = { ...det, spines: kept.map((i) => det.spines[i]!) };
  const fits = rowFits(sub);
  const geo = sub.spines.map((s) => geometry(s.polygon));
  const topEnd = (k: number): Point => {
    const g = geo[k]!;
    const o = outlines.get(kept[k]!);
    const t = o && o.length >= 3 ? Math.min(...o.map(([x, y]) => (x - g.cx) * g.ux + (y - g.cy) * g.uy)) : -g.long / 2;
    return [g.cx + t * g.ux, g.cy + t * g.uy];
  };
  const out = new Map<number, TopLine>();
  for (const [k, f] of fits) {
    const whole = f.neighbours.filter((j) => geo[j]!.long >= ROW.whole * f.h);
    if (whole.length < 2) continue;
    const ends = whole.map(topEnd);
    const [a, b] = theilSen(ends.map((p) => p[0]), ends.map((p) => p[1]), 0.3);
    const xs = sub.spines[k]!.polygon.map((p) => p[0]);
    out.set(kept[k]!, { a, b, h: f.h, x0: Math.min(...xs), x1: Math.max(...xs) });
  }
  return out;
}

// --- what a region is checked against ------------------------------------------------------------------------

export type CheckKind = "stacked" | "not-a-book" | "on-lip" | "dropped" | "standing" | "cover-pass";

export interface CheckBox {
  box: string;
  kind: CheckKind;
  why?: string | null;
  polygon: Point[];
}

/**
 * Each detection box's kind for the headroom checks. The shipped filter's `not-a-book` boxes keep their sub-reason; a
 * box the partition keeps is `on-lip` when S-1's flag holds, `stacked` when it lies flat (then its exclusive outline
 * stands for it), else `standing`; a box the partition drops is `dropped`, with its reason.
 */
export function checkKinds(
  det: Detection,
  shipped: { kind: BoxKind; why: KindWhy }[],
  part: Map<number, { state: "kept" | "dropped"; reason: string | null; outline?: Point[] }>,
  onLip: Set<number>,
): CheckBox[] {
  const out: CheckBox[] = det.spines.map((s, i) => {
    const box = `s${i}`;
    if (shipped[i]!.kind !== "spine") return { box, kind: "not-a-book", why: shipped[i]!.why, polygon: s.polygon };
    const p = part.get(i);
    if (!p || p.state === "dropped") return { box, kind: "dropped", why: p?.reason ?? null, polygon: s.polygon };
    if (onLip.has(i)) return { box, kind: "on-lip", why: "on-lip", polygon: s.polygon };
    if (geometry(s.polygon).tilt > S2.flatDeg) return { box, kind: "stacked", polygon: p.outline && p.outline.length >= 3 ? p.outline : s.polygon };
    return { box, kind: "standing", polygon: s.polygon };
  });
  (det.covers ?? []).forEach((c, j) => out.push({ box: `c${j}`, kind: "cover-pass", polygon: c.polygon }));
  return out;
}

// --- headroom.py's output ------------------------------------------------------------------------------------

export const CLASS_KEYS = ["empty", "occluded", "occupied", "unknown-invalid", "unknown-foreground", "unknown-speckle"] as const;
export type ClassKey = (typeof CLASS_KEYS)[number];

export interface HeadroomRow {
  band: number;
  elevationDeg?: number | null;
  skip?: string;
  source?: "lip" | "open";
  cols?: number;
  regionPx?: number;
  bookPx?: number;
  headroomPx?: number;
  standingPx?: number;
  classes?: Record<ClassKey, number>;
  gapM?: number;
  pitchUpM?: number;
}

export interface Region {
  band: number;
  source?: "lip" | "open";
  px: number;
  dominant: string;
  overlaps: { box: string; kind: CheckKind; why?: string | null; share: number }[];
  explainedBy: CheckKind | null;
}

export interface KnownBox {
  box: string;
  kind: "stacked" | "not-a-book" | "on-lip";
  why?: string | null;
  validPx: number;
  /** In rows with a board line; open rows' counts are apart. */
  headroomPx: number;
  occupiedPx: number;
  openHeadroomPx?: number;
  openOccupiedPx?: number;
}

/** A row with its photo, for the photo-cluster bootstrap. */
export type RowRec = HeadroomRow & { imageId: string; elevation: Elevation | null };
export type RegionRec = Region & { imageId: string; elevation: Elevation | null };
export type KnownRec = KnownBox & { imageId: string };

export const unknownPx = (c: Record<ClassKey, number>): number => c["unknown-invalid"] + c["unknown-foreground"] + c["unknown-speckle"];

/** M1: headroom pixels over headroom plus the row's standing books' pixels, pooled over rows. */
export const headroomShare = (rows: HeadroomRow[]): number | null => {
  const h = rows.reduce((s, r) => s + (r.headroomPx ?? 0), 0);
  const d = h + rows.reduce((s, r) => s + (r.standingPx ?? 0), 0);
  return d ? h / d : null;
};

/** M2 and M3: one class's (or a set of classes') share of headroom pixels, pooled over rows. */
export const classShare = (keys: readonly ClassKey[]) => (rows: HeadroomRow[]): number | null => {
  const h = rows.reduce((s, r) => s + (r.headroomPx ?? 0), 0);
  return h ? rows.reduce((s, r) => s + keys.reduce((t, k) => t + (r.classes?.[k] ?? 0), 0), 0) / h : null;
};

/** M4: a region explained by a stacked or not-a-book box (the shipped default's own boxes). */
export const explainedByKnown = (r: Region): boolean => r.explainedBy === "stacked" || r.explainedBy === "not-a-book";

/** M4: a known box that lies in the headroom, and whether the map finds it occupied. */
export const inHeadroom = (k: KnownBox): boolean => k.validPx > 0 && k.headroomPx >= S2.inHeadroom * k.validPx;
export const recalled = (k: KnownBox): boolean => inHeadroom(k) && k.occupiedPx >= S2.recalled * k.headroomPx;

/** Q-3: an outline gap facing front that no detection box holds. */
export const frontNoBox = (s: { kind: string; dominant?: string; boxShare?: number | null }): boolean =>
  s.kind === "outline-gap" && s.dominant === "front" && s.boxShare != null && s.boxShare < S2.noBox;

/** The adequacy check (pilot-000): verdicts on point estimates; null where the measure has no value. */
export function adequacy(unknownShare: number | null, recall: number | null): { unknown: boolean | null; recall: boolean | null; adequate: boolean | null } {
  const u = unknownShare === null ? null : unknownShare <= S2.maxUnknown;
  const r = recall === null ? null : recall >= S2.minRecall;
  return { unknown: u, recall: r, adequate: u === null || r === null ? null : u && r };
}
