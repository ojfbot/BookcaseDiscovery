// F-0m: spine end edges. Pure functions over F-0's detections and the per-box rows helpers/depth/ends.py writes: the
// row-end residuals against F-0f's fitted top and bottom lines, Q-2's top-seam error, books lost, and the
// pre-registered keep rules (evals/F0m/report.md). No pixels, no models. Runner: f0m-cli.ts.
import type { Detection } from "./f0.ts";
import { UPRIGHT_DEG } from "./f0e.ts";
import { alongToLine, rowFits } from "./f0f.ts";
import { geometry } from "./f0e.ts";
import { SEAM_OFF } from "./q2.ts";

/** Measures' constants, fixed before the first full run (evals/F0m/report.md, Pre-registration). */
export const F0M = {
  /** A row-end residual counts at most this share of the row's spine height (one wild box cannot carry a photo). */
  residualCap: 0.5,
  /** Top-seam error: the box top is off Q-2's seam by more than this share of its long side (F-0f's measure). */
  seamOff: SEAM_OFF,
  /** An end moved by more than this many working-copy pixels counts as moved (F-0i's `ends` rule). */
  movedPx: 2,
} as const;

/** One kept box's row from ends.py (the fields the measures read). */
export interface EndRow {
  id: string;
  index: number;
  tilt: number;
  length: number;
  elevationDeg?: number | null;
  top: { status: string; t?: number; moveOutline?: number; moveBox?: number; topShare?: number; frontShare?: number };
  bottom: { status: string; source?: string; t?: number; moveOutline?: number; moveBox?: number };
  outlineEnds?: [number, number];
}

/** Per upright kept box with a row (F-0f's `rowFits` on the kept boxes only): |end − row line| in row spine heights. */
export interface Residual {
  imageId: string;
  index: number;
  top: number;
  bottom: number;
}

/** Row-end residuals of one photo's kept boxes, against the lines F-0f fits through the same boxes' ends. */
export function endResiduals(det: Detection, kept: (i: number) => boolean): Residual[] {
  const idx = det.spines.flatMap((_, i) => (kept(i) ? [i] : []));
  const sub: Detection = { ...det, spines: idx.map((i) => det.spines[i]!) };
  const fits = rowFits(sub);
  const out: Residual[] = [];
  for (const [k, fit] of fits) {
    const g = geometry(sub.spines[k]!.polygon);
    if (g.tilt > UPRIGHT_DEG || fit.h <= 0) continue;
    // Each end measured along the box's own axis to its row's line, from the end's midpoint.
    const tx = g.cx - (g.ux * g.long) / 2, ty = g.cy - (g.uy * g.long) / 2;
    const bx = g.cx + (g.ux * g.long) / 2, by = g.cy + (g.uy * g.long) / 2;
    const dt = alongToLine(tx, ty, g.ux, g.uy, fit.top);
    const db = alongToLine(bx, by, g.ux, g.uy, fit.bottom);
    if (dt === null || db === null) continue;
    out.push({ imageId: det.id, index: idx[k]!, top: Math.abs(dt) / fit.h, bottom: Math.abs(db) / fit.h });
  }
  return out;
}

/** Mean capped residual of one end over rows of residuals (null when empty). */
export const meanResidual = (end: "top" | "bottom") => (rows: Residual[]): number | null =>
  rows.length ? rows.reduce((s, r) => s + Math.min(r[end], F0M.residualCap), 0) / rows.length : null;

/** One box's top seam in one arm (helpers/coverage/geometry.py) and whether the box is upright. */
export interface SeamBox {
  imageId: string;
  id: string;
  seam: number | null;
  upright: boolean;
}

/** Q-2's top-seam error: the share of measured upright boxes whose top is off the seam by more than F0M.seamOff. */
export function seamError(rows: SeamBox[], part: "any" | "cut" | "overshoot" = "any"): number | null {
  const m = rows.filter((r) => r.upright && r.seam !== null);
  if (!m.length) return null;
  const off = (s: number) => (part === "cut" ? s < -F0M.seamOff : part === "overshoot" ? s > F0M.seamOff : Math.abs(s) > F0M.seamOff);
  return m.filter((r) => off(r.seam!)).length / m.length;
}

/** Books lost: (photo, work) pairs some box confirmed before that no box confirms after. */
export function lostWorks(rows: { imageId: string; before: string | null; after: string | null }[]): number {
  const after = new Set(rows.flatMap((r) => (r.after ? [`${r.imageId}\u0000${r.after}`] : [])));
  return new Set(rows.flatMap((r) => (r.before ? [`${r.imageId}\u0000${r.before}`] : [])).filter((k) => !after.has(k))).size;
}

/** An interval triple as the analysis writes it: [value, lo, hi]. */
export type Tri3 = [number, number, number];

export interface SetFigures {
  /** Change in mean capped bottom and top residual, after − before (row spine heights), paired photo bootstrap. */
  bottomResidualDelta: Tri3 | null;
  topResidualDelta: Tri3 | null;
  /** Change in Q-2's top-seam error, after − before (share), paired photo bootstrap. */
  seamErrorDelta: Tri3 | null;
  overlapAfter: number;
  lostOutlines: number;
  /** Reader arm (changed set) and works; absent until both arms are read. */
  readers?: {
    confirmed: { delta: number; lo: number; hi: number } | null;
    wrong?: { delta: number; lo: number; hi: number } | null;
    works?: { delta: { value: number; lo: number; hi: number } | null; lost: number };
    recallDelta?: Tri3 | null;
  };
}

/** The pre-registered keep rules (evals/F0m/report.md). */
export function verdictOf(p: SetFigures | undefined, y: SetFigures | undefined) {
  if (!p || !y) return null;
  const geometryRule = {
    pilotBottomsMoreConsistent: !!p.bottomResidualDelta && p.bottomResidualDelta[2] < 0,
    pilotSeamErrorNotUp: !!p.seamErrorDelta && p.seamErrorDelta[1] <= 0,
    partitionHolds: [p, y].every((s) => s.overlapAfter <= 0.005 && s.lostOutlines === 0),
    yardstickBottomsNotWorse: !y.bottomResidualDelta || y.bottomResidualDelta[1] <= 0,
    yardstickSeamErrorNotUp: !y.seamErrorDelta || y.seamErrorDelta[1] <= 0,
  };
  const geometryShips = Object.values(geometryRule).every(Boolean);
  let reader: Record<string, boolean> | null = null;
  if (p.readers && y.readers) {
    reader = {
      geometryShips,
      pilotConfirmedExcludesZero: !!p.readers.confirmed && p.readers.confirmed.lo > 0,
      pilotNoConfirmedBookLost: !!p.readers.works?.delta && p.readers.works.delta.value >= 0,
      yardstickConfirmedNotDown: !y.readers.confirmed || y.readers.confirmed.hi >= 0,
      yardstickWrongNotUp: !y.readers.wrong || y.readers.wrong.lo <= 0,
      yardstickRecallNotDown: !y.readers.recallDelta || y.readers.recallDelta[2] >= 0,
    };
  }
  return {
    geometry: { ships: geometryShips, ...geometryRule },
    readerCrop: reader && { ships: Object.values(reader).every(Boolean), ...reader },
  };
}
