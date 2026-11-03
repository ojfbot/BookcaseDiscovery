// F-0e whole-spine boxCount: geometry measures of how whole the detector's spine boxes are. Pure functions over
// one Detection (F-0's detect.jsonl line), so they run on cached detections of any arm; the runner is
// f0e-cli.ts. Only aggregates of these leave $BOOKCASE_DATA (evals/F0e/). Spec: docs/machine-labelling.md.
import { CASE_TILING, type Detection, type SpineDecision } from "./f0.ts";
import type { Polygon4 } from "./labels.ts";
import { clusterBootstrap, quantile, rate, rng } from "./q1.ts";

const r4 = (x: number) => Math.round(x * 10000) / 10000;
export type Tri = [number, number, number] | null;
const tri = (b: { value: number; lo: number; hi: number } | null): Tri => (b ? [r4(b.value), r4(b.lo), r4(b.hi)] : null);

/** A box whose long axis is within this many degrees of vertical stands upright on its shelf. */
export const UPRIGHT_DEG = 30;
/** An upright box shorter than this share of its band's spine height holds part of a spine (or a short book). */
export const PARTIAL_HEIGHT = 0.55;
/**
 * A band's spine height: this quantile of its upright boxes' long sides. Not the band polygon's height, which a
 * row tilted by perspective inflates; a band where most boxes are pieces still has a few whole spines on top.
 */
export const SPINE_HEIGHT_Q = 0.9;
/** Two upright boxes in one column touch when the vertical gap between them is at most this many median spine widths. */
export const TOUCH_WIDTHS = 0.25;

export interface Geometry {
  cx: number;
  cy: number;
  /** Long and short side of the rectangle. */
  long: number;
  short: number;
  /** Angle of the long side from vertical, 0..90 degrees. */
  tilt: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  /** Unit vector along the long side, pointing down the image. */
  ux: number;
  uy: number;
}

export function geometry(p: Polygon4): Geometry {
  const e1: [number, number] = [p[1][0] - p[0][0], p[1][1] - p[0][1]];
  const e2: [number, number] = [p[2][0] - p[1][0], p[2][1] - p[1][1]];
  const l1 = Math.hypot(...e1);
  const l2 = Math.hypot(...e2);
  const v = l1 >= l2 ? e1 : e2;
  const lv = Math.hypot(...v) || 1;
  const sign = v[1] < 0 || (v[1] === 0 && v[0] < 0) ? -1 : 1;
  const xs = p.map((q) => q[0]);
  const ys = p.map((q) => q[1]);
  return {
    cx: xs.reduce((a, b) => a + b, 0) / 4,
    cy: ys.reduce((a, b) => a + b, 0) / 4,
    long: Math.max(l1, l2),
    short: Math.min(l1, l2),
    tilt: (Math.atan2(Math.abs(v[0]), Math.abs(v[1])) * 180) / Math.PI,
    top: Math.min(...ys),
    bottom: Math.max(...ys),
    left: Math.min(...xs),
    right: Math.max(...xs),
    ux: (sign * v[0]) / lv,
    uy: (sign * v[1]) / lv,
  };
}

/** Height of a shelf band: the length of its side closer to vertical (a band of three tall spines is taller than wide). */
export function bandHeight(p: Polygon4): number {
  const e1: [number, number] = [p[1][0] - p[0][0], p[1][1] - p[0][1]];
  const e2: [number, number] = [p[2][0] - p[1][0], p[2][1] - p[1][1]];
  return Math.abs(e1[1]) / (Math.hypot(...e1) || 1) >= Math.abs(e2[1]) / (Math.hypot(...e2) || 1) ? Math.hypot(...e1) : Math.hypot(...e2);
}

export function contains(p: Polygon4, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const [xi, yi] = p[i]!;
    const [xj, yj] = p[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Per box: its geometry, its band (index into det.bands, or -1 when its centre is in none) and its flags. */
export interface BoxRow {
  imageId: string;
  g: Geometry;
  cut: boolean;
  upright: boolean;
  band: number;
  /** Height of its band polygon, when it has one. */
  bandHeight: number | null;
  /** Its band's spine height (SPINE_HEIGHT_Q), when the band has at least three upright boxes. */
  spineHeight: number | null;
  /** Upright, in a band, and shorter than PARTIAL_HEIGHT of the band polygon's height (the card's measure). */
  partial: boolean;
  /** The same against the band's spine height, which perspective and rows chained across shelves do not inflate. */
  partialSpine: boolean;
  /** Upright and touching another upright box in the same column. */
  touching: boolean;
  /** Mostly inside another box (intersection over its own area >= 0.8): a part-of-spine detection. */
  inside: boolean;
}

function overlap1d(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/** Axis-aligned intersection over a's own area: a cheap stand-in for the rotated one. */
function insideShare(a: Geometry, b: Geometry): number {
  const i = overlap1d(a.left, a.right, b.left, b.right) * overlap1d(a.top, a.bottom, b.top, b.bottom);
  return i / Math.max(1e-6, (a.right - a.left) * (a.bottom - a.top));
}

/**
 * Is b stacked on a, end to end in a's column? Measured in a's own frame, so tilted spines work: b's centre is
 * within half the narrower width of a's axis, the two lean alike (within 10 degrees), and along the axis the gap
 * between them is at most `tol` and their overlap at most a fifth of the shorter one (more is nesting, not stacking).
 */
export function stacked(a: Geometry, b: Geometry, tol: number): boolean {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const lateral = Math.abs(dx * -a.uy + dy * a.ux);
  if (lateral > 0.5 * Math.min(a.short, b.short)) return false;
  if (Math.abs(a.tilt - b.tilt) > 10 || Math.abs(a.ux * b.uy - a.uy * b.ux) > Math.sin((10 * Math.PI) / 180)) return false;
  const along = dx * a.ux + dy * a.uy;
  const gap = Math.abs(along) - (a.long + b.long) / 2; // negative: they overlap along the axis
  return gap <= tol && -gap <= 0.2 * Math.min(a.long, b.long);
}

export function boxRows(det: Detection): BoxRow[] {
  const gs = det.spines.map((s) => geometry(s.polygon));
  const medianWidth = det.gaps.medianWidth || median(gs.map((g) => g.short)) || 1;
  const heights = det.bands.map((b) => bandHeight(b.polygon));
  const bandOf = gs.map((g) => det.bands.findIndex((b) => contains(b.polygon, g.cx, g.cy)));
  const spineHeights = det.bands.map((_, k) => {
    const longs = gs.filter((g, i) => bandOf[i] === k && g.tilt <= UPRIGHT_DEG).map((g) => g.long).sort((a, b) => a - b);
    return longs.length >= 3 ? quantile(longs, SPINE_HEIGHT_Q) : null;
  });
  return det.spines.map((s, i) => {
    const g = gs[i]!;
    const upright = g.tilt <= UPRIGHT_DEG;
    const band = bandOf[i]!;
    const bh = band >= 0 ? heights[band]! : null;
    const sh = band >= 0 ? spineHeights[band]! : null;
    let touching = false;
    let inside = false;
    gs.forEach((o, j) => {
      if (j === i) return;
      if (insideShare(g, o) >= 0.8 && (o.right - o.left) * (o.bottom - o.top) > (g.right - g.left) * (g.bottom - g.top)) inside = true;
      if (upright && o.tilt <= UPRIGHT_DEG && stacked(g, o, TOUCH_WIDTHS * medianWidth)) touching = true;
    });
    return {
      imageId: det.id,
      g,
      cut: s.cut,
      upright,
      band,
      bandHeight: bh,
      spineHeight: sh,
      partial: upright && bh !== null && g.long < PARTIAL_HEIGHT * bh,
      partialSpine: upright && sh !== null && g.long < PARTIAL_HEIGHT * sh,
      touching,
      inside,
    };
  });
}

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Boxes in a band over the boxes its covered length would hold at the median spine width: above 1, boxes stack. */
export function boxesPerBand(det: Detection): number[] {
  const w = det.gaps.medianWidth;
  if (!w) return [];
  return det.bands.filter((b) => b.span - b.gap > 0).map((b) => b.spines / ((b.span - b.gap) / w));
}

/** Per-photo shares of the three piece measures. */
export interface PieceShares {
  imageId: string;
  boxCount: number;
  cut: number | null;
  partial: number | null;
  partialSpine: number | null;
  /** Median long side of the upright boxCount: longer when boxes hold whole spines. */
  uprightLong: number | null;
  touching: number | null;
  inside: number | null;
  boxesPerBand: number | null;
  seconds: number;
}

const shareOf = (rows: BoxRow[], pred: (r: BoxRow) => boolean): number | null => (rows.length ? rows.filter(pred).length / rows.length : null);

export function pieceShares(det: Detection): PieceShares {
  const rows = boxRows(det);
  const up = rows.filter((r) => r.upright);
  const inBand = up.filter((r) => r.spineHeight !== null);
  const bpb = boxesPerBand(det);
  return {
    imageId: det.id,
    boxCount: rows.length,
    cut: shareOf(rows, (r) => r.cut),
    partial: shareOf(up.filter((r) => r.band >= 0), (r) => r.partial),
    partialSpine: shareOf(inBand, (r) => r.partialSpine),
    uprightLong: up.length ? median(up.map((r) => r.g.long)) : null,
    touching: shareOf(up, (r) => r.touching),
    inside: shareOf(rows, (r) => r.inside),
    boxesPerBand: bpb.length ? median(bpb) : null,
    seconds: det.seconds,
  };
}

// --- diagnosis: does a band fit inside one tile row? -----------------------------------------------

/** Tile starts along one axis, exactly as helpers/label/detect.py lays them out. */
export function tileStarts(n: number, tile: number, overlap: number): number[] {
  if (n <= tile) return [0];
  const out: number[] = [];
  for (let s = 0; s < n - tile; s += tile - overlap) out.push(s);
  out.push(n - tile);
  return out;
}

/** True when some tile row holds the whole y-range [top, bottom], so a spine spanning it can be found whole. */
export function fitsTileRow(top: number, bottom: number, height: number, tile: number, overlap: number): boolean {
  return tileStarts(height, tile, overlap).some((s) => s <= top && bottom <= s + tile);
}

// --- diagnose ------------------------------------------------------------------------------------

interface DiagRow extends BoxRow {
  /** The band's spine height over the tile overlap. */
  ratio: number | null;
  /** The band's whole y-range fits in one tile row. */
  fits: boolean | null;
}

export function diagnose(dets: Detection[], tile = CASE_TILING.tile, overlap = CASE_TILING.overlap) {
  const rows: DiagRow[] = dets.flatMap((d) => {
    const fit = d.bands.map((b) => {
      const g = geometry(b.polygon);
      return fitsTileRow(g.top, g.bottom, d.height, tile, overlap);
    });
    return boxRows(d).map((r) => ({ ...r, ratio: r.spineHeight === null ? null : r.spineHeight / overlap, fits: r.band >= 0 ? fit[r.band]! : null }));
  });
  const up = rows.filter((r) => r.upright && r.spineHeight !== null);
  const bins: [number, number][] = [[0, 1], [1, 1.5], [1.5, 2], [2, 2.5], [2.5, Infinity]];
  const byRatio = bins.map(([lo, hi]) => {
    const rs = up.filter((r) => r.ratio! >= lo && r.ratio! < hi);
    return {
      spineHeightOverOverlap: [lo, hi === Infinity ? null : hi],
      boxCount: rs.length,
      photos: new Set(rs.map((r) => r.imageId)).size,
      cut: tri(clusterBootstrap(rs, rate((r) => r.cut))),
      partial: tri(clusterBootstrap(rs, rate((r) => r.partial))),
      partialSpine: tri(clusterBootstrap(rs, rate((r) => r.partialSpine))),
      touching: tri(clusterBootstrap(rs, rate((r) => r.touching))),
    };
  });
  const byFit = [true, false].map((fits) => {
    const rs = up.filter((r) => r.fits === fits);
    return { bandFitsOneTileRow: fits, boxCount: rs.length, cut: tri(clusterBootstrap(rs, rate((r) => r.cut))), partial: tri(clusterBootstrap(rs, rate((r) => r.partial))), partialSpine: tri(clusterBootstrap(rs, rate((r) => r.partialSpine))) };
  });
  // Where partial-height boxes come from: cut by a tile edge, inside a larger box, stacked on a column
  // neighbour, or alone (a short book, or a piece whose rest was not found).
  const partial = up.filter((r) => r.partial);
  const cause = (r: BoxRow) => (r.cut ? "cut" : r.inside ? "inside" : r.touching ? "stacked" : "alone");
  const causes = ["cut", "inside", "stacked", "alone"].map((c) => ({ cause: c, share: tri(clusterBootstrap(partial, rate((r) => cause(r) === c))) }));
  const touchingCut = tri(clusterBootstrap(up.filter((r) => r.touching), rate((r) => r.cut)));
  return {
    photos: dets.length,
    boxCount: rows.length,
    uprightInBand: up.length,
    tiling: { tile, overlap },
    bandHeightPx: quantiles(dets.flatMap((d) => d.bands.map((b) => bandHeight(b.polygon)))),
    spineHeightPx: quantiles(dets.flatMap((d) => [...new Set(boxRows(d).map((r) => r.spineHeight))].filter((x): x is number => x !== null))),
    byRatio,
    byFit,
    partialCauses: causes,
    touchingThatAreCut: touchingCut,
  };
}

function quantiles(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => (s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]!) : null);
  return { p10: q(0.1), p50: q(0.5), p90: q(0.9), max: q(1) };
}

// --- measure -------------------------------------------------------------------------------------

/**
 * Median over photos of arm / base for one per-photo value, with a photo-bootstrap 95 % interval: the same
 * photos under two arms, so the ratio needs no shelf reference (e.g. upright box length: whole spines are longer).
 */
export function pairedRatio(base: PieceShares[], arm: PieceShares[], f: (p: PieceShares) => number | null, reps = 2000, seed = 1): Tri {
  const b = new Map(base.map((p) => [p.imageId, f(p)]));
  const ratios = arm.map((p) => {
    const x = b.get(p.imageId), y = f(p);
    return x && y !== null ? y / x : null;
  }).filter((x): x is number => x !== null);
  if (ratios.length === 0) return null;
  const rand = rng(seed);
  const draws: number[] = [];
  for (let r = 0; r < reps; r++) draws.push(median(Array.from({ length: ratios.length }, () => ratios[Math.floor(rand() * ratios.length)]!)));
  draws.sort((x, y) => x - y);
  return [r4(median(ratios)), r4(quantile(draws, 0.025)), r4(quantile(draws, 0.975))];
}

/** Photo-level medians and photo-bootstrap 95 % intervals of the pooled shares; with `base`, paired ratios to it. */
export function measure(dets: Detection[], base?: Detection[]) {
  const per = dets.map(pieceShares);
  const rows = dets.flatMap((d) => boxRows(d));
  const up = rows.filter((r) => r.upright);
  const perPhoto = (f: (p: PieceShares) => number | null) => {
    const xs = per.map(f).filter((x): x is number => x !== null).sort((a, b) => a - b);
    return xs.length ? r4(xs[Math.floor(xs.length / 2)]!) : null;
  };
  const medStat = (f: (p: PieceShares) => number | null) => (rs: { imageId: string; v: number | null }[]) => {
    const xs = rs.map((r) => r.v).filter((x): x is number => x !== null).sort((a, b) => a - b);
    return xs.length ? xs[Math.floor(xs.length / 2)]! : null;
  };
  const photoRows = (f: (p: PieceShares) => number | null) => per.map((p) => ({ imageId: p.imageId, v: f(p) }));
  // Tiles are the load-free cost (seconds moved with the shared GPU). A shelf-aligned run also has its box-only pass.
  const coarse = (d: Detection) => (d.layout?.startsWith("bands") ? tileStarts(d.width, 3100, 1300).length * tileStarts(d.height, 3100, 1300).length : 0);
  const tiles = dets.map((d) => d.tiles).sort((a, b) => a - b);
  return {
    photos: dets.length,
    boxCount: rows.length,
    tiles: { total: tiles.reduce((a, b) => a + b, 0), p50: median(tiles), boxOnlyTotal: dets.reduce((a, d) => a + coarse(d), 0) },
    boxesPerPhotoP50: perPhoto((p) => p.boxCount),
    pooled: {
      cut: tri(clusterBootstrap(rows, rate((r) => r.cut))),
      partial: tri(clusterBootstrap(up.filter((r) => r.band >= 0), rate((r) => r.partial))),
      partialSpine: tri(clusterBootstrap(up.filter((r) => r.spineHeight !== null), rate((r) => r.partialSpine))),
      touching: tri(clusterBootstrap(up, rate((r) => r.touching))),
      inside: tri(clusterBootstrap(rows, rate((r) => r.inside))),
    },
    photoMedian: {
      cut: perPhoto((p) => p.cut),
      partial: perPhoto((p) => p.partial),
      partialSpine: perPhoto((p) => p.partialSpine),
      touching: perPhoto((p) => p.touching),
      boxesPerBand: tri(clusterBootstrap(photoRows((p) => p.boxesPerBand), medStat((p) => p.boxesPerBand))),
      detectSeconds: tri(clusterBootstrap(photoRows((p) => p.seconds), medStat((p) => p.seconds))),
    },
    vsBase: base && {
      uprightLong: pairedRatio(base.map(pieceShares), per, (p) => p.uprightLong),
      boxCount: pairedRatio(base.map(pieceShares), per, (p) => p.boxCount),
      detectSeconds: pairedRatio(base.map(pieceShares), per, (p) => p.seconds),
    },
  };
}

// --- machine agreement before and after (never accuracy, INV-17) ----------------------------------

/** Per photo: boxes, and boxes at each coverage rung F-0's readers can fill, plus distinct confirmed works. */
export interface RungCounts {
  imageId: string;
  boxCount: number;
  textPresent: number;
  textRead: number;
  confirmed: number;
  works: number;
}

export function rungCounts(decisions: SpineDecision[]): RungCounts[] {
  const by = new Map<string, SpineDecision[]>();
  for (const d of decisions) by.set(d.imageId, [...(by.get(d.imageId) ?? []), d]);
  return [...by.entries()].map(([imageId, ds]) => ({
    imageId,
    boxCount: ds.length,
    // `text-present`: some reader produced text. `text-read`: some reader's top candidate passes the catalog bar
    // (the computable half of docs/capture/coverage.md's definition; Q-2 sets the string-agreement half).
    textPresent: ds.filter((d) => d.reason !== "no-text").length,
    textRead: ds.filter((d) => Object.values(d.confirmed).some(Boolean)).length,
    confirmed: ds.filter((d) => d.accepted).length,
    works: new Set(ds.filter((d) => d.accepted).map((d) => d.accepted!.workId)).size,
  }));
}

/** Paired photo bootstrap: arm minus base for a statistic of pooled per-photo counts; 95 % interval. */
export function pairedDelta(base: RungCounts[], arm: RungCounts[], stat: (rs: RungCounts[]) => number, reps = 2000, seed = 1): Tri {
  const a = new Map(arm.map((r) => [r.imageId, r]));
  const pairs = base.filter((b) => a.has(b.imageId)).map((b) => [b, a.get(b.imageId)!] as const);
  if (pairs.length === 0) return null;
  const value = stat(pairs.map((p) => p[1])) - stat(pairs.map((p) => p[0]));
  const rand = rng(seed);
  const draws: number[] = [];
  for (let r = 0; r < reps; r++) {
    const s = Array.from({ length: pairs.length }, () => pairs[Math.floor(rand() * pairs.length)]!);
    draws.push(stat(s.map((p) => p[1])) - stat(s.map((p) => p[0])));
  }
  draws.sort((x, y) => x - y);
  return [r4(value), r4(quantile(draws, 0.025)), r4(quantile(draws, 0.975))];
}

const pooled = (k: keyof Omit<RungCounts, "imageId" | "boxCount">) => (rs: RungCounts[]) => rs.reduce((s, r) => s + r[k], 0) / Math.max(1, rs.reduce((s, r) => s + r.boxCount, 0));
const perPhoto = (k: keyof Omit<RungCounts, "imageId">) => (rs: RungCounts[]) => rs.reduce((s, r) => s + r[k], 0) / Math.max(1, rs.length);

export function agreementChange(base: RungCounts[], arm: RungCounts[]) {
  const side = (rs: RungCounts[]) => ({
    boxCount: rs.reduce((s, r) => s + r.boxCount, 0),
    textPresentShare: r4(pooled("textPresent")(rs)),
    textReadShare: r4(pooled("textRead")(rs)),
    confirmedShare: r4(pooled("confirmed")(rs)),
    confirmedPerPhoto: r4(perPhoto("confirmed")(rs)),
    worksPerPhoto: r4(perPhoto("works")(rs)),
  });
  return {
    base: side(base),
    arm: side(arm),
    delta: {
      textReadShare: pairedDelta(base, arm, pooled("textRead")),
      confirmedShare: pairedDelta(base, arm, pooled("confirmed")),
      textReadPerPhoto: pairedDelta(base, arm, perPhoto("textRead")),
      confirmedPerPhoto: pairedDelta(base, arm, perPhoto("confirmed")),
      worksPerPhoto: pairedDelta(base, arm, perPhoto("works")),
      boxesPerPhoto: pairedDelta(base, arm, perPhoto("boxCount")),
    },
  };
}

/**
 * Yardstick titles (PROXY): arm minus base for pooled recall and precision, from F-0's per-image
 * [annotated, hits, accepted] counts (same images, same order), with a paired image-bootstrap 95 % interval.
 */
export function titleDelta(base: [number, number, number][], arm: [number, number, number][], reps = 2000, seed = 1): { recall: Tri; precision: Tri } | null {
  if (base.length !== arm.length || base.length === 0) return null;
  const pooledRate = (rows: [number, number, number][], num: 1, den: 0 | 2) => {
    const d = rows.reduce((s, r) => s + r[den], 0);
    return d ? rows.reduce((s, r) => s + r[num], 0) / d : 0;
  };
  const stat = (idx: number[], den: 0 | 2) => pooledRate(idx.map((i) => arm[i]!), 1, den) - pooledRate(idx.map((i) => base[i]!), 1, den);
  const all = base.map((_, i) => i);
  const rand = rng(seed);
  const draws: [number[], number[]] = [[], []];
  for (let r = 0; r < reps; r++) {
    const idx = all.map(() => Math.floor(rand() * all.length));
    draws[0].push(stat(idx, 0));
    draws[1].push(stat(idx, 2));
  }
  const ci = (v: number, d: number[]): Tri => {
    d.sort((a, b) => a - b);
    return [r4(v), r4(quantile(d, 0.025)), r4(quantile(d, 0.975))];
  };
  return { recall: ci(stat(all, 0), draws[0]), precision: ci(stat(all, 2), draws[1]) };
}
