// NB-3, not-a-book v3: three evidence sources under one rule, a post step after F-0c's and F-0f's kinds (and, in
// the evals, on F-0i's partition). Pure functions over cached per-box inputs: S-1's lip features
// (helpers/shelf/shelf.py), H-2's face split (helpers/depth/stage.py) and the version-2 pixel probe
// (helpers/label/probe.py), plus whether any reader found text. No pixels, no models. Runner: nb3-cli.ts. Measured in
// evals/NB3/report.md, against rules fixed before the full run.
import type { Kinds, KindWhy } from "./f0c.ts";
import type { Polygon4 } from "./labels.ts";
import { onLip, type LipFeatures } from "./s1.ts";

/** The NB-3 rule's thresholds, fixed before the full run (evals/NB3/report.md, Pre-registration). */
export const NB3 = {
  depth: {
    /** H-2's face split measured on at least this many map pixels (its over-selection floor) ... */
    minPx: 15,
    /** ... at most this share `front` (the spine face) ... */
    maxFront: 0.2,
    /** ... and at least this share `behind` (a gap, the back wall) plus `under` (a shelf's underside). */
    minOff: 0.6,
  },
  /**
   * Pixel thresholds: the 5th percentile of edge density and band-pass energy and the 95th of warm chromaticity over
   * the reference boxes (pilot-000 kept boxes whose readers found text and whose face split is at least 80 % front),
   * computed once by `nb3-cli.ts calibrate` before the full run and written here. Applied unchanged to every set.
   */
  pixel: {
    maxEdgeDensity: 0,
    maxBandpass: 0,
    minWarm: 1,
  },
  /** The reference population the pixel thresholds come from. */
  reference: { minFront: 0.8, lowQ: 0.05, highQ: 0.95 },
} as const;

/**
 * Which causes the default path applies, set by evals/NB3's verdict. A cause that failed its keep rule stays
 * available as a reported flag and is off here.
 */
export const NB3_SHIP: Record<NB3Why, boolean> = { "on-lip": false, depth: false, pixel: false };

export type NB3Why = "on-lip" | "depth" | "pixel";
export const NB3_CAUSES: NB3Why[] = ["on-lip", "depth", "pixel"];

/** H-2's face split counts for one box (a faces.py row), map pixels. */
export interface FaceCounts {
  front?: number;
  edge?: number;
  top?: number;
  under?: number;
  cover?: number;
  behind?: number;
  pixels?: number;
  skip?: string | null;
}

/** The version-2 pixel probe's NB-3 fields. */
export interface ProbeV2 {
  version?: number;
  edgeDensity?: number;
  bandpass?: number;
  warm?: number;
  luma?: number;
}

/** What NB-3 sees of one box. `textFound`: any of Vision's and PP-OCR's readings holds text (F-0f's `hasText`). */
export interface NB3Evidence {
  lip?: LipFeatures | null;
  faces?: FaceCounts | null;
  probe?: ProbeV2 | null;
  textFound: boolean;
}

/** The face split's shares of measured pixels, or null when the box was not measured (or too small). */
export function faceShares(f: FaceCounts | null | undefined): { front: number; off: number } | null {
  if (!f || f.skip || !f.pixels || f.pixels < NB3.depth.minPx) return null;
  return { front: (f.front ?? 0) / f.pixels, off: ((f.behind ?? 0) + (f.under ?? 0)) / f.pixels };
}

/** Depth: no reader text, and the box's surface is mostly a gap, the back wall or a shelf's underside. */
export function depthOff(ev: NB3Evidence): boolean {
  if (ev.textFound) return false;
  const s = faceShares(ev.faces);
  return s !== null && s.front <= NB3.depth.maxFront && s.off >= NB3.depth.minOff;
}

/** Pixel: no reader text, smooth (both texture measures low) and warm: shelf wood, not a printed spine. */
export function pixelOff(ev: NB3Evidence): boolean {
  const p = ev.probe;
  if (ev.textFound || !p || p.version !== 2 || p.edgeDensity == null || p.bandpass == null || p.warm == null) return false;
  return p.edgeDensity <= NB3.pixel.maxEdgeDensity && p.bandpass <= NB3.pixel.maxBandpass && p.warm >= NB3.pixel.minWarm;
}

/** Every cause that holds for a box, in rule order (on-lip, depth, pixel); the first is its sub-reason. */
export function nb3Causes(polygon: Polygon4, ev: NB3Evidence | undefined, frame: { width: number; height: number }): NB3Why[] {
  if (!ev) return [];
  const out: NB3Why[] = [];
  if (onLip(polygon, ev.lip, frame)) out.push("on-lip");
  if (depthOff(ev)) out.push("depth");
  if (pixelOff(ev)) out.push("pixel");
  return out;
}

export interface NB3Box {
  ref: string;
  kind: "spine" | "face-out" | "not-a-book";
  why: KindWhy | NB3Why;
  /** Every cause that held (also the ones `ship` left off), for reporting. */
  causes: NB3Why[];
}

/**
 * The post step: a spine-path box the shipped kinds keep (`spine`) becomes `not-a-book` with its first shipped
 * cause as the sub-reason. Absorbed boxes, covers and boxes already `not-a-book` are left alone; `keep` restricts the
 * step to a box set (F-0i's partition in the evals).
 */
export function applyNb3(
  k: Kinds,
  frame: { width: number; height: number },
  evidence: (i: number) => NB3Evidence | undefined,
  ship: Record<NB3Why, boolean> = NB3_SHIP,
  keep?: (i: number) => boolean,
): NB3Box[] {
  return k.spines.map((b, i): NB3Box => {
    if (b.kind !== "spine" || (keep && !keep(i))) return { ref: b.ref, kind: b.kind, why: b.why, causes: [] };
    const causes = nb3Causes(b.polygon, evidence(i), frame);
    const why = causes.find((c) => ship[c]);
    return why ? { ref: b.ref, kind: "not-a-book", why, causes } : { ref: b.ref, kind: b.kind, why: b.why, causes };
  });
}

/** numpy's default (linear) quantile, as the calibration takes its percentiles. */
export function npQuantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const p = q * (s.length - 1);
  const lo = Math.floor(p);
  return s[lo]! + (s[Math.min(lo + 1, s.length - 1)]! - s[lo]!) * (p - lo);
}

/** The pixel thresholds from the reference boxes' probes (see `NB3.pixel`), rounded to 4 places. */
export function calibrate(reference: ProbeV2[]): { maxEdgeDensity: number; maxBandpass: number; minWarm: number; n: number } {
  const r = (x: number) => Math.round(x * 10000) / 10000;
  const ok = reference.filter((p) => p.version === 2 && p.edgeDensity != null && p.bandpass != null && p.warm != null);
  if (ok.length === 0) throw new Error("no reference probes");
  return {
    maxEdgeDensity: r(npQuantile(ok.map((p) => p.edgeDensity!), NB3.reference.lowQ)),
    maxBandpass: r(npQuantile(ok.map((p) => p.bandpass!), NB3.reference.lowQ)),
    minWarm: r(npQuantile(ok.map((p) => p.warm!), NB3.reference.highQ)),
    n: ok.length,
  };
}
