// F-0k: missed-book recovery, the pure parts (pre-registered in evals/F0k/prereg.md). Candidate regions from F-0h,
// S-1/S-2 and S-2's headroom, their per-photo caps, the re-prompt tiles, and the Qwen selection with displacement.
// The runner is f0k-cli.ts; the GPU re-prompt and the gate are helpers/label/recover.py. Only aggregates leave the
// data root (evals/F0k/).
import { area } from "./f0c.ts";
import type { Tiling } from "./f0.ts";

export type Pt = [number, number];

export const F0K = {
  /** At most this many regions per source per photo, largest polygon area first. */
  capPerSource: 12,
  /** F-0e's band margin: share of a tile's height added above and below. */
  bandMargin: 0.12,
  seed: 61,
  reps: 2000,
} as const;

/** The arms' sources, in pool order. */
export const SOURCES = ["row-gaps", "front-stretches", "headroom"] as const;
export type Source = (typeof SOURCES)[number];
export const ARMS: Record<string, Source[]> = {
  "row-gaps": ["row-gaps"],
  "front-stretches": ["front-stretches"],
  headroom: ["headroom"],
  all: [...SOURCES],
};

export interface Region {
  id: string;
  photo: string;
  source: Source;
  /** F-0h flag kind, `front-no-box` or `headroom-occupied`. */
  kind: string;
  /** The detection band it sits in (an index into the stage's `bands`), when known. */
  band: number | null;
  polygon: Pt[];
}

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const dot = (a: Pt, b: Pt): number => a[0] * b[0] + a[1] * b[1];
const centre = (p: readonly Pt[]): Pt => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];

/**
 * F-0h's `box-gap`: the rectangle between two boxes. Along the unit axis from the first box's centre to the
 * second's, from the first box's greatest projection to the second's least; across, the least to the greatest
 * projection of both boxes' corners. Null when the along-range is empty (the boxes overlap along the row).
 */
export function boxGapRegion(a: readonly Pt[], b: readonly Pt[]): Pt[] | null {
  const ca = centre(a), cb = centre(b);
  const d = sub(cb, ca);
  const L = Math.hypot(d[0], d[1]);
  if (L === 0) return null;
  const u: Pt = [d[0] / L, d[1] / L], n: Pt = [-u[1], u[0]];
  const lo = Math.max(...a.map((p) => dot(sub(p, ca), u)));
  const hi = Math.min(...b.map((p) => dot(sub(p, ca), u)));
  if (hi <= lo) return null;
  const across = [...a, ...b].map((p) => dot(sub(p, ca), n));
  const n0 = Math.min(...across), n1 = Math.max(...across);
  const at = (s: number, t: number): Pt => [ca[0] + u[0] * s + n[0] * t, ca[1] + u[1] * s + n[1] * t];
  return [at(lo, n0), at(hi, n0), at(hi, n1), at(lo, n1)];
}

/** Per photo and source, the `cap` largest regions (ties: input order); the order of sources and files is kept. */
export function capRegions(regions: Region[], cap: number = F0K.capPerSource): Region[] {
  const groups = new Map<string, { r: Region; i: number; a: number }[]>();
  regions.forEach((r, i) => {
    const k = `${r.photo}\u0000${r.source}`;
    const g = groups.get(k) ?? [];
    g.push({ r, i, a: area(r.polygon) });
    groups.set(k, g);
  });
  const keep = new Set<number>();
  for (const g of groups.values())
    [...g].sort((x, y) => y.a - x.a || x.i - y.i).slice(0, cap).forEach((x) => keep.add(x.i));
  return regions.filter((_, i) => keep.has(i));
}


/** Start offsets of tiles of size `tile` stepping `step` to cover [lo, hi] inside [0, n], each clamped to the image. */
function cover(lo: number, hi: number, n: number, tile: number, step: number): number[] {
  const clamp = (x: number) => Math.max(0, Math.min(Math.max(0, n - tile), x));
  if (hi - lo <= tile) return [Math.round(clamp((lo + hi) / 2 - tile / 2))];
  const out: number[] = [];
  for (let x = lo; ; x += step) {
    out.push(Math.round(clamp(x)));
    if (x + tile >= hi) break;
  }
  return [...new Set(out)];
}

/**
 * The re-prompt tiles for one region (F-0e's settings, pre-registered). Band layout (`pilot-000`): tiles `tile` px
 * wide centred on the region (stepping tile − overlap across a wider one); vertically the band's extent ∪ the
 * region's, grown by the band margin. Grid layout (yardstick): `tile`-px squares centred on the region, stepping
 * tile − overlap.
 */
export function reTiles(polygon: readonly Pt[], band: readonly Pt[] | null, W: number, H: number, t: Tiling): [number, number, number, number][] {
  const xs = polygon.map((p) => p[0]), ys = polygon.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  const step = t.tile - t.overlap;
  if (t.layout === "bands") {
    if (band) (y0 = Math.min(y0, ...band.map((p) => p[1]))), (y1 = Math.max(y1, ...band.map((p) => p[1])));
    const m = F0K.bandMargin * (y1 - y0);
    const ty0 = Math.max(0, Math.floor(y0 - m)), ty1 = Math.min(H, Math.ceil(y1 + m));
    return cover(x0, x1, W, t.tile, step).map((tx) => [tx, ty0, Math.min(W, tx + t.tile), ty1]);
  }
  const out: [number, number, number, number][] = [];
  for (const ty of cover(y0, y1, H, t.tile, step))
    for (const tx of cover(x0, x1, W, t.tile, step)) out.push([tx, ty, Math.min(W, tx + t.tile), Math.min(H, ty + t.tile)]);
  return out;
}

/**
 * Qwen's per-photo selection with displacement (pre-registered): existing kept boxes holding a cached Qwen reading
 * compete with the recovered boxes that qualify, by box score (ties: id); the top `cap` get Qwen. Returns the
 * recovered boxes selected and the existing boxes pushed out.
 */
export function qwenPlan(existing: { id: string; score: number }[], recovered: { id: string; score: number }[], cap: number): { selected: Set<string>; displaced: Set<string> } {
  const all = [...existing.map((x) => ({ ...x, isNew: false })), ...recovered.map((x) => ({ ...x, isNew: true }))];
  all.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const top = all.slice(0, cap);
  const selected = new Set(top.filter((x) => x.isNew).map((x) => x.id));
  const inTop = new Set(top.map((x) => x.id));
  const displaced = new Set(existing.filter((x) => !inTop.has(x.id)).map((x) => x.id));
  return { selected, displaced };
}

/** Distinct (photo, work) pairs among accepted works. */
export const pairCount = (rows: { imageId: string; work: string | null }[]): number =>
  new Set(rows.flatMap((r) => (r.work ? [`${r.imageId}\u0000${r.work}`] : []))).size;
