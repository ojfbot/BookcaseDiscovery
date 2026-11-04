// F-0f: perspective-aware spine tops and a shelf-label filter. Pure functions over one Detection (F-0's
// detect.jsonl line) plus per-box inputs computed elsewhere (top seams from helpers/coverage/geometry.py, reader
// text, pixel probes from helpers/label/probe.py): no pixels, no models. Runner: f0f-cli.ts. Measured in
// evals/F0f/report.md.
//
// Part A reads each upright box's *row* from its neighbours, as detect.py's F-0f post steps do (`row_lines`):
// perspective gives every shelf its own view angle, so the row, not the band polygon, says where its spines end
// and how they lean. Part B names the non-book boxes a store adds to its shelves (genre strips, shelf-talker cards,
// blank cards), which become `not-a-book` with a sub-reason in f0c.ts's `kinds`.
import type { Detection } from "./f0.ts";
import { boxRows, geometry, UPRIGHT_DEG, type Geometry } from "./f0e.ts";
import type { Polygon4 } from "./labels.ts";
import { SEAM_OFF } from "./q2.ts";

/** Rows, as detect.py's ROW_* and ANGLE_DEV (kept equal by hand; test/f0f.test.ts pins them). */
export const ROW = {
  /** Upright neighbours within this many median spine widths either side make a box's row ... */
  widths: 6,
  /** ... leaning within this many degrees of it, their vertical extents overlapping by half. */
  lean: 15,
  /** A neighbour this share of the row's spine height (p90) or longer is whole: its ends make the row's lines. */
  whole: 0.8,
  /** A box leaning this many degrees off its row's fitted lean is off-row. */
  angleDev: 6,
} as const;

/** An end this share of the row's spine height short of the row's line stops short (detect.py's TOPS_SHORT). */
export const TOPS_SHORT = 0.12;

/** The keep rules' thresholds, fixed before the full run (evals/F0f/report.md, Pre-registration). */
export const KEEP = {
  /** Top-seam error: the box top is off the seam by more than this share of its long side (Q-2's SEAM_OFF). */
  seamOff: SEAM_OFF,
} as const;

// --- rows --------------------------------------------------------------------------------------------------

/** Signed lean of a box's long axis from vertical, degrees: positive when its bottom end lies right of its top. */
export const lean = (g: Geometry): number => (Math.atan2(g.ux, g.uy) * 180) / Math.PI;

/** Median of pairwise slopes, clipped, then the median intercept (as detect.py's `theil_sen`). */
export function theilSen(x: number[], y: number[], maxSlope: number): [number, number] {
  const sl: number[] = [];
  for (let i = 0; i < x.length; i++) for (let j = i + 1; j < x.length; j++) if (Math.abs(x[j]! - x[i]!) > 1) sl.push((y[j]! - y[i]!) / (x[j]! - x[i]!));
  const m = sl.length ? Math.max(-maxSlope, Math.min(maxSlope, medianOf(sl))) : 0;
  return [m, medianOf(y.map((v, k) => v - m * x[k]!))];
}

function medianOf(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** numpy's default (linear) quantile, as detect.py takes the row's spine height. */
function npQuantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const p = q * (s.length - 1);
  const lo = Math.floor(p);
  return s[lo]! + (s[Math.min(lo + 1, s.length - 1)]! - s[lo]!) * (p - lo);
}

export interface RowFit {
  /** The row's spine height: p90 of its boxes' long sides (the box's own included). */
  h: number;
  /** Lines y = a x + b through the top and bottom ends of the row's whole boxes. */
  top: [number, number];
  bottom: [number, number];
  /** The row's fitted lean at this box's x (signed degrees), or null under four neighbours. */
  lean: number | null;
  neighbours: number[];
}

/** For each upright box with at least three row neighbours (two of them whole), its row (detect.py `row_lines`). */
export function rowFits(det: Detection): Map<number, RowFit> {
  const geo = det.spines.map((s) => geometry(s.polygon));
  const out = new Map<number, RowFit>();
  if (geo.length === 0) return out;
  const med = medianOf(geo.map((g) => g.short));
  const up = geo.flatMap((g, i) => (g.tilt <= UPRIGHT_DEG ? [i] : []));
  const ext = (g: Geometry): [number, number] => [g.cy - (g.uy * g.long) / 2, g.cy + (g.uy * g.long) / 2];
  for (const i of up) {
    const gi = geo[i]!;
    const [a0, a1] = ext(gi);
    const nb = up.filter((j) => {
      if (j === i) return false;
      const gj = geo[j]!;
      if (Math.abs(gj.cx - gi.cx) > ROW.widths * med || Math.abs(lean(gj) - lean(gi)) > ROW.lean) return false;
      const [b0, b1] = ext(gj);
      return Math.min(a1, b1) - Math.max(a0, b0) >= 0.5 * Math.min(a1 - a0, b1 - b0);
    });
    if (nb.length < 3) continue;
    const h = npQuantile([...nb, i].map((j) => geo[j]!.long), 0.9);
    const whole = nb.filter((j) => geo[j]!.long >= ROW.whole * h);
    if (whole.length < 2) continue;
    const end = (sgn: 1 | -1): [number, number] =>
      theilSen(
        whole.map((j) => geo[j]!.cx + (sgn * geo[j]!.ux * geo[j]!.long) / 2),
        whole.map((j) => geo[j]!.cy + (sgn * geo[j]!.uy * geo[j]!.long) / 2),
        0.3,
      );
    let rowLean: number | null = null;
    if (nb.length >= 4) {
      const [a, b] = theilSen(nb.map((j) => geo[j]!.cx), nb.map((j) => lean(geo[j]!)), 0.05);
      rowLean = a * gi.cx + b;
    }
    out.set(i, { h, top: end(-1), bottom: end(1), lean: rowLean, neighbours: nb });
  }
  return out;
}

/** Distance from (px, py) along the unit direction (dx, dy) to the line y = a x + b; negative when it lies behind. */
export function alongToLine(px: number, py: number, dx: number, dy: number, [a, b]: [number, number]): number | null {
  const den = dy - a * dx;
  if (Math.abs(den) < 1e-6) return null;
  return (a * px + b - py) / den;
}

// --- Part A measures ---------------------------------------------------------------------------------------

export type Third = "top" | "middle" | "bottom";
export const THIRDS: Third[] = ["top", "middle", "bottom"];

/** Per upright box: where its row sits in the frame and how its box fits the row. */
export interface PerspectiveBox {
  imageId: string;
  index: number;
  /** The box centre's height in the frame, 0 top to 1 bottom; its third. Low rows are seen from above. */
  elevation: number;
  third: Third;
  /** F-0e's partial height (under 0.55 of its band's spine height); null when its band has no spine height. */
  partial: boolean | null;
  /** Q-2's top seam (share of the long side; < 0 the box cuts the spine's top, > 0 it overshoots); null when unmeasured. */
  seam: number | null;
  /** How far its top end is short of its row's top line, in row spine heights (< 0: past it); null with no row. */
  shortOfTop: number | null;
  /** |its lean − its row's fitted lean|, degrees; null with no row lean. */
  leanOff: number | null;
}

export function perspectiveBoxes(det: Detection, seams: Map<string, number | null> = new Map()): PerspectiveBox[] {
  const rows = boxRows(det);
  const fits = rowFits(det);
  return rows.flatMap((r, i) => {
    if (!r.upright) return [];
    const g = r.g;
    const fit = fits.get(i);
    const elevation = g.cy / det.height;
    const shortOfTop = fit ? alongToLine(g.cx - (g.ux * g.long) / 2, g.cy - (g.uy * g.long) / 2, -g.ux, -g.uy, fit.top) : null;
    return [{
      imageId: det.id,
      index: i,
      elevation,
      third: elevation < 1 / 3 ? "top" : elevation < 2 / 3 ? "middle" : "bottom",
      partial: r.spineHeight === null ? null : r.partialSpine,
      seam: seams.get(`${det.id}:${i}`) ?? null,
      shortOfTop: fit && shortOfTop !== null ? shortOfTop / fit.h : null,
      leanOff: fit && fit.lean !== null ? Math.abs(lean(g) - fit.lean) : null,
    }];
  });
}

/** Around one upright box, its row: how the spines converge (degrees of lean per 1000 px across) and its top line's slope. */
export interface RowPerspective {
  imageId: string;
  third: Third;
  /** Change of lean across the row, degrees per 1000 px: < 0 spines converge downward (seen from above). */
  convergence: number;
  /** Slope of the row's top line, dy/dx. */
  topSlope: number;
}

/** One entry per upright box whose row (its neighbours and itself) holds at least five boxes. */
export function rowPerspective(det: Detection): RowPerspective[] {
  const fits = rowFits(det);
  const geo = det.spines.map((s) => geometry(s.polygon));
  const out: RowPerspective[] = [];
  for (const [i, f] of fits) {
    const members = [...f.neighbours, i];
    if (members.length < 5) continue;
    const [slope] = theilSen(members.map((j) => geo[j]!.cx), members.map((j) => lean(geo[j]!)), 1);
    const cy = medianOf(members.map((j) => geo[j]!.cy)) / det.height;
    out.push({ imageId: det.id, third: cy < 1 / 3 ? "top" : cy < 2 / 3 ? "middle" : "bottom", convergence: slope * 1000, topSlope: f.top[0] });
  }
  return out;
}

export const seamError = (b: PerspectiveBox): boolean | null => (b.seam === null ? null : Math.abs(b.seam) > KEEP.seamOff);
export const seamCut = (b: PerspectiveBox): boolean | null => (b.seam === null ? null : b.seam < -KEEP.seamOff);
export const seamOvershoot = (b: PerspectiveBox): boolean | null => (b.seam === null ? null : b.seam > KEEP.seamOff);
export const shortTop = (b: PerspectiveBox): boolean | null => (b.shortOfTop === null ? null : b.shortOfTop > TOPS_SHORT);
export const offRow = (b: PerspectiveBox): boolean | null => (b.leanOff === null ? null : b.leanOff > ROW.angleDev);

// --- Part B: shelf labels and cards ------------------------------------------------------------------------

/**
 * Shelf-label rules (evals/F0f/report.md). The patterns allow the OCR slips seen on the catalogue of these objects
 * (a slash read as I or l, a dropped letter); genre words alone never match, since imprints print "fantasy" and
 * "science fiction" on spines. Shapes were added after viewing every box the first draft removed (disclosed there):
 * a face-out cover whose box reaches down over the strip on its shelf edge reads the strip's words too, and a book's
 * white side or page block can be as blank as a card, so strips must be strip-shaped and blank cards must lie flat.
 */
export const LABEL = {
  /** A store-section strip on a shelf edge: "Science Fiction/Fantasy (Alphabetical by Author)" ... */
  strip: [/fiction\s*[/|Il1]\s*[fp]an/i, /ph?abe?\w*\s*by\s*au/i],
  /** ... strip-shaped (short side at most this share of the long) and lying along the shelf (degrees from vertical). */
  stripRatio: 0.35,
  stripDeg: 45,
  /** A shelf-talker or sign: "Like ⟨author⟩? Now try…", "If you liked…", "Staff pick", "Educators save 10%". */
  talker: [/\bli[kc][ea]\s+[^?|\n]{2,40}\?/i, /\bnow\s+try\b/i, /\bif\s+you\s+(liked?|enjoy(ed)?)\b/i, /\bstaff\s+picks?\b/i, /\beducators?\s+save\b/i, /\bread[- ]?alikes?\b/i],
  /** A blank card: no reader text, mostly white card stock (low saturation, bright) ... */
  white: 0.75,
  /** ... with few edges (no lettering or art) ... */
  edges: 0.18,
  /** ... lying flat in its holder (long side more than this many degrees from vertical). */
  cardDeg: 40,
} as const;

export type LabelWhy = "shelf-strip" | "shelf-talker" | "blank-card";

/** What the label rules see of one box: every reader's texts (one per variant), whether any found text, its pixel probe. */
export interface BoxEvidence {
  texts: string[];
  textFound: boolean;
  probe?: { white: number; edges: number };
}

/** A reader answer that holds no text: empty, punctuation only, or a model saying none or unreadable. */
export function hasText(s: string): boolean {
  const t = s.replace(/\b(title|author|imprint)\s*:/gi, " ").replace(/\b(none|unreadable|unknown|n\/a)\b/gi, " ");
  return (t.match(/[\p{L}\p{N}]/gu) ?? []).length >= 2;
}

/** Evidence from one box's readings (F-0's Reading records, any crop). */
export function evidenceOf(readings: Partial<Record<string, { variants: { text: string }[] }>>, probe?: { white: number; edges: number }): BoxEvidence {
  const texts = Object.values(readings).flatMap((r) => r?.variants.map((v) => v.text) ?? []);
  return { texts, textFound: texts.some(hasText), probe };
}

/** Why a box is a shelf label or card, or null when it may be a book. */
export function labelWhy(polygon: Polygon4, ev: BoxEvidence | undefined): LabelWhy | null {
  if (!ev) return null;
  // Each variant on its own: one pattern never spans two readings.
  const g = geometry(polygon);
  if (g.short <= LABEL.stripRatio * g.long && g.tilt > LABEL.stripDeg && ev.texts.some((t) => LABEL.strip.some((p) => p.test(t)))) return "shelf-strip";
  if (ev.texts.some((t) => LABEL.talker.some((p) => p.test(t)))) return "shelf-talker";
  if (!ev.textFound && ev.probe && ev.probe.white >= LABEL.white && ev.probe.edges <= LABEL.edges && g.tilt > LABEL.cardDeg) return "blank-card";
  return null;
}
