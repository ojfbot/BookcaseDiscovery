// S-1 shelf structure: the geometric `on-lip` not-a-book sub-reason (a post step after F-0c's and F-0f's kinds),
// board pitch between a photo's rows, and the elevation strata. Pure functions over helpers/shelf/shelf.py's output:
// no pixels, no readers. Runner: s1-cli.ts. Measured in evals/S1/report.md, against rules fixed before the full run.
import { geometry } from "./f0e.ts";
import type { Kinds, KindWhy } from "./f0c.ts";
import type { Polygon4 } from "./labels.ts";

/** On-lip rule, fixed before the full run (evals/S1/report.md, Pre-registration). Metres are MoGe-2's (unverified). */
export const ON_LIP = {
  /** At least this share of the box's measured pixels lies on the lip's face (its inliers' p5–p95 up, ±1 cm). */
  inZone: 0.6,
  /** The box is not behind the lip's face by more than this (median signed distance, m) ... */
  minDLip: -0.015,
  /** ... nor behind its row's spine plane (median, m): in front of and below the books' faces. */
  minDSpine: 0,
  /** The lip is a board's front edge: at most this tall, and its top within this of the board-top level (m). */
  maxLipHeight: 0.08,
  maxLipBoardGap: 0.03,
  /** The lip's face is horizontal, so a box mostly on it lies along it (long side more than this from vertical) ... */
  flatDeg: 45,
  /** ... and lies inside the frame (this share of the frame's long side from every edge): a box the frame cuts hides its extent. */
  frameMargin: 0.005,
} as const;

/** shelf.py's lip features for one box: the row whose lip face holds most of it. */
export interface LipFeatures {
  band?: number;
  inZone?: number | null;
  belowBoard?: number;
  dLip?: number;
  dSpine?: number;
  pixels?: number;
  lipHeightM?: number;
  lipBoardGapM?: number;
}

export type OnLipWhy = "on-lip";
export type S1Why = KindWhy | OnLipWhy;

/** Whether a box sits on a shelf's lip: a strip, a card or a sign on the board's front edge, not a book. */
export function onLip(polygon: Polygon4, f: LipFeatures | null | undefined, frame: { width: number; height: number }): boolean {
  if (!f || f.inZone == null || f.dLip == null || f.dSpine == null || f.lipHeightM == null || f.lipBoardGapM == null) return false;
  if (f.lipHeightM > ON_LIP.maxLipHeight || Math.abs(f.lipBoardGapM) > ON_LIP.maxLipBoardGap) return false;
  if (f.inZone < ON_LIP.inZone || f.dLip < ON_LIP.minDLip || f.dSpine < ON_LIP.minDSpine) return false;
  if (geometry(polygon).tilt <= ON_LIP.flatDeg) return false;
  const m = ON_LIP.frameMargin * Math.max(frame.width, frame.height);
  return polygon.every(([x, y]) => x >= m && y >= m && x <= frame.width - m && y <= frame.height - m);
}

export interface S1Box {
  ref: string;
  kind: "spine" | "face-out" | "not-a-book";
  why: S1Why;
}

/**
 * The post step: a box F-0c's and F-0f's kinds keep (a `spine`, or a kept `face-out` cover) becomes `not-a-book`
 * with the sub-reason `on-lip` when `onLip` holds. Absorbed boxes and boxes already `not-a-book` are left alone.
 */
export function applyOnLip(
  k: Kinds,
  frame: { width: number; height: number },
  spineFeatures: (LipFeatures | null | undefined)[],
  coverFeatures: (LipFeatures | null | undefined)[] = [],
): { spines: S1Box[]; covers: S1Box[] } {
  const spines = k.spines.map((b, i): S1Box =>
    b.kind === "spine" && onLip(b.polygon, spineFeatures[i], frame) ? { ref: b.ref, kind: "not-a-book", why: "on-lip" } : { ref: b.ref, kind: b.kind, why: b.why },
  );
  const covers = k.covers.map((c): S1Box => {
    const j = Number(c.ref.slice(1));
    return onLip(c.polygon, coverFeatures[j], frame) ? { ref: c.ref, kind: "not-a-book", why: "on-lip" } : { ref: c.ref, kind: c.kind, why: c.why };
  });
  return { spines, covers };
}

// --- rows, elevation and pitch ----------------------------------------------------------------------------

export type Elevation = "below" | "level" | "above";
export const ELEVATIONS: Elevation[] = ["below", "level", "above"];
/** H-1's strata: a row more than 10° below the horizon is seen from above. */
export const elevationOf = (deg: number | null | undefined): Elevation | null =>
  deg == null ? null : deg < -10 ? "below" : deg > 10 ? "above" : "level";

/** One row of shelf.py's output (the fields this module reads). */
export interface ShelfRow {
  band: number;
  skip?: string;
  books?: number;
  elevationDeg?: number | null;
  base?: number;
  top?: number;
  side?: [number, number];
  level?: number;
  levelSource?: "board" | "lip" | "base";
  frame?: { front: number[]; up: number[] };
  boardDepthM?: number;
}

/** Pitch rule (fixed before the run): rows of one case are near-parallel and overlap along the shelf. */
export const PITCH = {
  /** Spine-plane normals within this many degrees. */
  parallelDeg: 10,
  /** Side extents overlapping by at least this share of the narrower. */
  overlap: 0.5,
  /** Adjacent levels further apart than this (m) are not one board pitch (a missed row between them). */
  maxPitch: 0.6,
  minPitch: 0.1,
} as const;

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);
const angleDeg = (a: number[], b: number[]) => (Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180) / Math.PI;

export interface Pitch {
  lower: number;
  upper: number;
  pitchM: number;
  /** The weaker of the two levels' sources: board < lip < base. */
  source: "board" | "lip" | "base";
}

/**
 * Board pitch per pair of vertically adjacent rows in one photo: rows on near-parallel planes overlapping along the
 * shelf, sorted by level; each row's nearest row above it. The pitch is the difference of their levels (the board
 * top, else the lip's top, else the books' base), so it bounds the lower row's book height from above.
 */
export function pitches(rows: ShelfRow[]): Pitch[] {
  const ok = rows.filter((r) => !r.skip && r.level != null && r.frame && r.side);
  const rank = { board: 0, lip: 1, base: 2 } as const;
  const out: Pitch[] = [];
  for (const lo of ok) {
    let best: ShelfRow | null = null;
    for (const hi of ok) {
      if (hi === lo || hi.level! <= lo.level!) continue;
      if (angleDeg(hi.frame!.front, lo.frame!.front) > PITCH.parallelDeg) continue;
      const ov = Math.min(hi.side![1], lo.side![1]) - Math.max(hi.side![0], lo.side![0]);
      if (ov < PITCH.overlap * Math.min(hi.side![1] - hi.side![0], lo.side![1] - lo.side![0])) continue;
      if (!best || hi.level! < best.level!) best = hi;
    }
    if (!best) continue;
    const p = best.level! - lo.level!;
    if (p < PITCH.minPitch || p > PITCH.maxPitch) continue;
    const source = [lo.levelSource!, best.levelSource!].sort((a, b) => rank[b] - rank[a])[0]!;
    out.push({ lower: lo.band, upper: best.band, pitchM: Math.round(p * 10000) / 10000, source });
  }
  return out;
}

/** The standard-shelf assumption (snippet-level, not verified): clear depth and pitch of store and library shelving, m. */
export const STANDARD_SHELF = { depth: [0.23, 0.31], pitch: [0.28, 0.36] } as const;

/** Implied metric scale: the standard range's midpoint over a measured median (1 means MoGe's metres are right). */
export const impliedScale = (range: readonly [number, number], measured: number | null): number | null =>
  measured == null || measured <= 0 ? null : Math.round(((range[0] + range[1]) / 2 / measured) * 1000) / 1000;
