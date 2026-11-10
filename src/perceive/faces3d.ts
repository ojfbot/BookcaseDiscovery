// Face shares and the spine-face trim per detected box (card H-2), from the depth stage's rows
// (helpers/depth/stage.py, which runs H-1's faces.py on MoGe-2 geometry). Pure: rows in, shares and quads out.
// Method: docs/models/3d-volumes.md §4 and §8; measurements: evals/H1, evals/H2.
import type { Point } from "./crop.ts";

/** The face split's classes (faces.py CLASSES), in its order. */
export const FACE_CLASSES = ["front", "edge", "top", "under", "cover", "behind"] as const;
export type FaceClass = (typeof FACE_CLASSES)[number];
/** The classes that are not the spine face: a box over-selects on these. */
export const EXTRA_CLASSES = ["top", "under", "cover", "behind"] as const;

/** One box's row from the depth stage (faces.py), as far as H-2 reads it. */
export interface FaceRow {
  id: string;
  box: number;
  skip?: string;
  pixels?: number;
  front?: number;
  edge?: number;
  top?: number;
  under?: number;
  cover?: number;
  behind?: number;
  overSelects?: boolean;
  trimFeasible?: boolean;
  trim?: { polygon: Point[]; component: number; purity: number; keep: number; areaShare: number };
  elevationDeg?: number;
  ownPlane?: boolean;
  cuboid?: { corners?: Point[]; depthM: number; depthSource: "seen" | "band" | "default"; topVisible?: boolean };
}

/** Face shares: each class's share of the box's measured pixels (they sum to 1), or null when it was skipped. */
export type FaceShares = Record<FaceClass, number>;

export function faceShares(r: FaceRow): FaceShares | null {
  if (r.skip || !r.pixels) return null;
  return Object.fromEntries(FACE_CLASSES.map((k) => [k, (r[k] ?? 0) / r.pixels!])) as FaceShares;
}

/** The extra face with the most pixels (top, under, cover or behind), or null when the box has none. */
export function dominantExtra(r: FaceRow): (typeof EXTRA_CLASSES)[number] | null {
  let best: (typeof EXTRA_CLASSES)[number] | null = null;
  for (const k of EXTRA_CLASSES) if ((r[k] ?? 0) > 0 && (best === null || (r[k] ?? 0) > (r[best] ?? 0))) best = k;
  return best;
}

/** H-1's elevation strata: more than 10° below eye level (seen from above), within ±10°, or above. */
export function elevationBand(r: FaceRow): "below" | "level" | "above" | null {
  if (r.elevationDeg === undefined) return null;
  return r.elevationDeg < -10 ? "below" : r.elevationDeg > 10 ? "above" : "level";
}

/**
 * The quad a `face3d` crop reads: the box's spine-face trim, only where the box over-selects and the trim is
 * feasible (H-1's rules, docs/models/3d-volumes.md §4). Elsewhere null, and the box is read as its rectangle.
 */
export function face3dTrim(r: FaceRow): Point[] | null {
  return r.overSelects && r.trimFeasible && r.trim && r.trim.polygon.length === 4 ? r.trim.polygon : null;
}

/** The cuboid's top face (corners 3, 2, 6, 7: front top edge, then back) when the camera sees it, else null. */
export function topFace(r: FaceRow): Point[] | null {
  const c = r.cuboid;
  if (!c?.corners || c.corners.length !== 8 || !c.topVisible || c.depthSource === "default") return null;
  return [c.corners[3]!, c.corners[2]!, c.corners[6]!, c.corners[7]!];
}
