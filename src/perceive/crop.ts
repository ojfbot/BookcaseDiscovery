// Reader-crop geometry (card F-0b): how a spine's polygon is cut and turned before it reaches a reader. The
// readers themselves (ocr-vision, helpers/label/read.py) perspective-correct any 4-point polygon to an upright
// rectangle, corners clockwise from the one nearest the image's top-left, then turn it clockwise by each
// requested rotation. This module only chooses that polygon and those rotations. Pure geometry: no pixels.
// Method and measurements: docs/machine-labelling.md, evals/F0b/report.md.

export type Point = [number, number];
export type Quad = [Point, Point, Point, Point];
export type Rotation = 0 | 90 | 180 | 270;

const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const add = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]];
const scale = (a: Point, k: number): Point => [a[0] * k, a[1] * k];
const dot = (a: Point, b: Point): number => a[0] * b[0] + a[1] * b[1];
const cross = (a: Point, b: Point): number => a[0] * b[1] - a[1] * b[0];
const norm = (a: Point): number => Math.hypot(a[0], a[1]);
const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Clockwise (y down) from the corner nearest the image's top-left: the order every reader crops in. */
export function canonical(q: readonly Point[]): Quad {
  const c: Point = [(q[0]![0] + q[1]![0] + q[2]![0] + q[3]![0]) / 4, (q[0]![1] + q[1]![1] + q[2]![1] + q[3]![1]) / 4];
  const cw = [...q].sort((a, b) => Math.atan2(a[1] - c[1], a[0] - c[0]) - Math.atan2(b[1] - c[1], b[0] - c[0]));
  let start = 0;
  for (let i = 1; i < 4; i++) if (cw[i]![0] + cw[i]![1] < cw[start]![0] + cw[start]![1]) start = i;
  return [0, 1, 2, 3].map((k) => cw[(start + k) % 4]!) as Quad;
}

/** The upright crop a reader cuts from a polygon, before rotation (as read.py: the longer of each pair of sides). */
export function cropSize(q: readonly Point[]): { width: number; height: number } {
  const p = canonical(q);
  return {
    width: Math.max(norm(sub(p[1], p[0])), norm(sub(p[2], p[3]))),
    height: Math.max(norm(sub(p[3], p[0])), norm(sub(p[2], p[1]))),
  };
}

/** F-0's rotations: every crop turned 90° and 270°, which assumes the spine stands upright in the photo. */
export const FIXED_ROTATIONS: readonly Rotation[] = [90, 270];

/**
 * Below this long/short ratio the crop's long axis is not trusted to be the text's direction (a thick spine with
 * its title across, a short stack), so all four rotations are read. Set a priori: the detector already drops
 * boxes under 1.5.
 */
export const AMBIGUOUS_ASPECT = 2;

/**
 * Rotations that put the crop's long axis horizontal, both ways round (the catalog decides which reads). A tall crop
 * turns 90° and 270°, a wide one (a spine lying flat) 0° and 180°; an ambiguous one gets all four.
 */
export function longAxisRotations(q: readonly Point[], ambiguousAspect = AMBIGUOUS_ASPECT): Rotation[] {
  const { width, height } = cropSize(q);
  if (Math.max(width, height) < ambiguousAspect * Math.min(width, height)) return [0, 90, 180, 270];
  return height >= width ? [90, 270] : [0, 180];
}

/** A point of the quad's bilinear patch: s runs across p0→p1, t along p0→p3 (both 0..1, may extrapolate). */
export function patchPoint(q: Quad, s: number, t: number): Point {
  return lerp(lerp(q[0], q[1], s), lerp(q[3], q[2], s), t);
}

/** The sub-quad of `q` between s0..s1 across and t0..t1 along (canonical corners). */
export function subQuad(q: Quad, s0: number, s1: number, t0: number, t1: number): Quad {
  return [patchPoint(q, s0, t0), patchPoint(q, s1, t0), patchPoint(q, s1, t1), patchPoint(q, s0, t1)];
}

const inside = (p: Point, w: number, h: number, tol: number): boolean => p[0] >= -tol && p[1] >= -tol && p[0] <= w + tol && p[1] <= h + tol;

/**
 * The largest sub-quad of `q` (trimmed side by side) whose corners lie in a w x h frame, or null when too little is
 * left. A box the detector placed partly outside the photo is otherwise refused by ocr-vision
 * (`polygon-out-of-bounds`). Each step trims the one side that loses the smaller share of the box.
 */
export function clipToFrame(q: readonly Point[], w: number, h: number, minShare = 0.2, tol = 0.5): { quad: Quad; clipped: boolean } | null {
  const p = canonical(q);
  const b = { s0: 0, s1: 1, t0: 0, t1: 1 };
  const corners = [["s0", "t0"], ["s1", "t0"], ["s1", "t1"], ["s0", "t1"]] as const;
  for (let step = 0; step < 16; step++) {
    const quad = subQuad(p, b.s0, b.s1, b.t0, b.t1);
    const out = quad.findIndex((c) => !inside(c, w, h, tol));
    if (out < 0) return { quad: quad.map(([x, y]) => [Math.min(w, Math.max(0, x)), Math.min(h, Math.max(0, y))]) as Quad, clipped: step > 0 };
    const [sk, tk] = corners[out]!;
    const other = { s0: "s1", s1: "s0", t0: "t1", t1: "t0" } as const;
    // Move one bound of the outside corner toward its opposite until the corner is inside (bisection: the segment
    // meets the convex frame in one interval). Pick the move that keeps more of the box.
    const move = (key: "s0" | "s1" | "t0" | "t1"): number | null => {
      const from = b[key], to = b[other[key]];
      const at = (a: number) => {
        const nb = { ...b, [key]: from + (to - from) * a };
        return patchPoint(p, nb[sk], nb[tk]);
      };
      const limit = 1 - minShare;
      if (!inside(at(limit), w, h, tol)) return null;
      let lo = 0, hi = limit;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (inside(at(mid), w, h, tol)) hi = mid;
        else lo = mid;
      }
      return hi;
    };
    const ms = move(sk), mt = move(tk);
    if (ms === null && mt === null) return null;
    const [key, a] = mt === null || (ms !== null && ms < mt) ? [sk, ms!] : [tk, mt];
    b[key] = b[key] + (b[other[key]] - b[key]) * a;
    if (Math.abs(b.s1 - b.s0) < minShare || Math.abs(b.t1 - b.t0) < minShare) return null;
  }
  return null;
}

/** Lengthen the quad along its long axis by `frac` of its length at each end (a spine whose ends the mask cut short). */
export function padEnds(q: readonly Point[], frac: number): Quad {
  const p = canonical(q);
  const { width, height } = cropSize(p);
  return height >= width ? subQuad(p, 0, 1, -frac, 1 + frac) : subQuad(p, -frac, 1 + frac, 0, 1);
}

// --- mask outline -> spine face ------------------------------------------------------------------------

function hull(points: readonly Point[]): Point[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const half = (src: Point[]): Point[] => {
    const out: Point[] = [];
    for (const p of src) {
      while (out.length >= 2 && cross(sub(out[out.length - 1]!, out[out.length - 2]!), sub(p, out[out.length - 2]!)) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half([...pts].reverse())];
}

export interface RotatedRect {
  centre: Point;
  /** Unit vector along the long side. */
  along: Point;
  /** Unit vector along the short side (along rotated 90° clockwise on screen). */
  across: Point;
  length: number;
  width: number;
}

/** Minimum-area enclosing rectangle (rotating calipers over the hull), as the detector's polygon is. */
export function minAreaRect(points: readonly Point[]): RotatedRect {
  const h = hull(points);
  let best: RotatedRect | null = null;
  let bestArea = Infinity;
  for (let i = 0; i < h.length; i++) {
    const e = sub(h[(i + 1) % h.length]!, h[i]!);
    const n = norm(e);
    if (n === 0) continue;
    const u: Point = scale(e, 1 / n);
    const v: Point = [-u[1], u[0]];
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of h) {
      a0 = Math.min(a0, dot(p, u)), a1 = Math.max(a1, dot(p, u));
      b0 = Math.min(b0, dot(p, v)), b1 = Math.max(b1, dot(p, v));
    }
    const area = (a1 - a0) * (b1 - b0);
    if (area < bestArea) {
      bestArea = area;
      const centre = add(scale(u, (a0 + a1) / 2), scale(v, (b0 + b1) / 2));
      const [along, length, width] = a1 - a0 >= b1 - b0 ? [u, a1 - a0, b1 - b0] : [v, b1 - b0, a1 - a0];
      best = { centre, along, across: [-along[1], along[0]], length, width };
    }
  }
  if (!best) throw new Error("minAreaRect: degenerate outline");
  return best;
}

/** The rectangle's corners. */
export function rectQuad(r: RotatedRect): Quad {
  const a = scale(r.along, r.length / 2), b = scale(r.across, r.width / 2);
  return canonical([sub(sub(r.centre, a), b), add(sub(r.centre, a), b), add(add(r.centre, a), b), sub(add(r.centre, a), b)]);
}

/** Across-axis extent [min, max] of a closed outline at position `t` along the axis (local coordinates), or null. */
function extentAt(local: Point[], t: number): [number, number] | null {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < local.length; i++) {
    const [ta, sa] = local[i]!, [tb, sb] = local[(i + 1) % local.length]!;
    if ((ta - t) * (tb - t) > 0 || ta === tb) continue;
    const s = sa + ((t - ta) / (tb - ta)) * (sb - sa);
    lo = Math.min(lo, s), hi = Math.max(hi, s);
  }
  return lo <= hi ? [lo, hi] : null;
}

/** Theil-Sen line through (x, y): robust to the ends of a profile that belong to another plane. */
function theilSen(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const slopes: number[] = [];
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) if (xs[j] !== xs[i]) slopes.push((ys[j]! - ys[i]!) / (xs[j]! - xs[i]!));
  const med = (a: number[]) => {
    const s = [...a].sort((x, y) => x - y);
    return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
  };
  const slope = slopes.length ? med(slopes) : 0;
  return { slope, intercept: med(ys.map((y, i) => y - slope * xs[i]!)) };
}

export const FACE = {
  /** Profile samples along the spine. */
  samples: 48,
  /** The side lines are fitted on the middle of the spine, this share of its length. */
  core: 0.5,
  /** At an end, the mask sticking out past a fitted side by more than this share of the spine's width is another plane. */
  bulge: 0.15,
  /** Trims shorter than this share of the length are noise; longer than `maxTrim` are not a top face. */
  minTrim: 0.02,
  maxTrim: 0.35,
  /** Side lines converging by more than this many degrees mark a perspective (oblique) view. */
  obliqueDeg: 2,
} as const;

export interface SpineFace {
  /** The spine face: the mask's side lines between the trimmed ends, canonical corners. */
  quad: Quad;
  /** The mask's minimum-area rectangle (what F-0's polygon is). */
  rect: Quad;
  /** Share of the length trimmed at the start and end of the long axis (a second plane: a top face, a neighbour). */
  trim: [number, number];
  /** Angle between the two fitted side lines, degrees (perspective). */
  convergenceDeg: number;
  /** A second plane was trimmed or the sides converge: the view is oblique. */
  oblique: boolean;
}

/**
 * The spine face from a mask outline: fit the two long sides on the middle of the spine, trim an end where the mask
 * bulges past them (the top face of a book seen from above, or a neighbour), and return the quad between the side
 * lines at the trimmed ends. The readers' perspective warp of that quad is the rectification.
 */
export function spineFace(outline: readonly Point[], opts: Partial<typeof FACE> = {}): SpineFace | null {
  const o = { ...FACE, ...opts };
  if (outline.length < 3) return null;
  const r = minAreaRect(outline);
  if (r.length <= 0 || r.width <= 0) return null;
  const local = outline.map((p): Point => [dot(sub(p, r.centre), r.along), dot(sub(p, r.centre), r.across)]);
  const ts: number[] = [], lo: number[] = [], hi: number[] = [];
  for (let i = 0; i < o.samples; i++) {
    const t = -r.length / 2 + ((i + 0.5) / o.samples) * r.length;
    const e = extentAt(local, t);
    ts.push(t), lo.push(e ? e[0] : NaN), hi.push(e ? e[1] : NaN);
  }
  const coreIdx = ts.map((_, i) => i).filter((i) => Math.abs(ts[i]!) <= (o.core * r.length) / 2 && Number.isFinite(lo[i]!));
  if (coreIdx.length < 4) return null;
  const fl = theilSen(coreIdx.map((i) => ts[i]!), coreIdx.map((i) => lo[i]!));
  const fh = theilSen(coreIdx.map((i) => ts[i]!), coreIdx.map((i) => hi[i]!));
  const at = (f: { slope: number; intercept: number }, t: number) => f.slope * t + f.intercept;
  const bulge = (i: number): boolean => {
    if (!Number.isFinite(lo[i]!)) return false;
    const w = Math.max(1e-6, at(fh, ts[i]!) - at(fl, ts[i]!));
    return Math.max(at(fl, ts[i]!) - lo[i]!, hi[i]! - at(fh, ts[i]!)) > o.bulge * w;
  };
  // From each end, the trim runs to the last bulging sample before three clean ones in a row.
  const trimFrom = (order: number[]): number => {
    let last = -1, clean = 0;
    for (let k = 0; k < order.length && clean < 3; k++) {
      if (bulge(order[k]!)) (last = k), (clean = 0);
      else clean++;
    }
    const share = (last + 1) / o.samples;
    return share < o.minTrim || share > o.maxTrim ? 0 : share;
  };
  const idx = ts.map((_, i) => i);
  const trim: [number, number] = [trimFrom(idx), trimFrom([...idx].reverse())];
  const t0 = -r.length / 2 + trim[0] * r.length, t1 = r.length / 2 - trim[1] * r.length;
  const toImage = (t: number, s: number): Point => add(r.centre, add(scale(r.along, t), scale(r.across, s)));
  const quad = canonical([toImage(t0, at(fl, t0)), toImage(t0, at(fh, t0)), toImage(t1, at(fh, t1)), toImage(t1, at(fl, t1))]);
  const convergenceDeg = Math.abs(Math.atan(fh.slope) - Math.atan(fl.slope)) * (180 / Math.PI);
  return { quad, rect: rectQuad(r), trim, convergenceDeg, oblique: trim[0] > 0 || trim[1] > 0 || convergenceDeg > o.obliqueDeg };
}

// --- crop methods (provenance) ---------------------------------------------------------------------------

export interface CropMethod {
  /**
   * "fixed": F-0's 90°/270° for every crop; "long-axis": from the polygon's long axis (`longAxisRotations`);
   * "cover": a face-out cover's whole face, read as it stands (`coverRotations`).
   */
  orient: "fixed" | "long-axis" | "cover";
  /** Trim a polygon that runs past the photo's edge to the part inside it. */
  clip: boolean;
  /** Read the spine face from the mask outline (`spineFace`) instead of the minimum-area rectangle, when one is known. */
  face: boolean;
  /** Lengthen each end along the long axis by this share (0: off). */
  pad: number;
  /**
   * Read the spine-face trim from monocular normals (H-2, `face3dTrim` in faces3d.ts) instead of the rectangle,
   * where one is known: only boxes that over-select and whose trim is feasible carry one.
   */
  face3d?: boolean;
}

/**
 * A face-out cover (F-0c) is read the way it stands: a portrait crop at 0°, with no spine rotations. A landscape crop
 * is a cover lying on its side (a book lying flat, seen from above), read at 90° and 270°.
 */
export function coverRotations(q: readonly Point[]): Rotation[] {
  const { width, height } = cropSize(q);
  return height >= width ? [0] : [90, 270];
}

/** F-0c's cover crop: the mask rectangle's whole face, clipped to the frame as F-0b ships for spines. */
export const COVER_CROP: CropMethod = { orient: "cover", clip: true, face: false, pad: 0 };

/** H-2's crop: the spine-face trim, clipped to the frame, at F-0's rotations. Off by default (evals/H2). */
export const FACE3D_CROP: CropMethod = { orient: "fixed", clip: true, face: false, pad: 0, face3d: true };

/** F-0 as shipped in #23. Records without a crop string were read this way. */
export const F0_CROP: CropMethod = { orient: "fixed", clip: false, face: false, pad: 0 };

/** The provenance string each reading record carries, e.g. `rect;rot=long-axis;clip=frame`. */
export function cropName(m: CropMethod): string {
  return [m.face3d ? "face3d" : m.face ? "face" : "rect", `rot=${m.orient}`, ...(m.clip ? ["clip=frame"] : []), ...(m.pad ? [`pad=${m.pad}`] : [])].join(";");
}

export interface SpineCrop {
  polygon: Quad;
  rotations: Rotation[];
  crop: string;
}

/** The polygon and rotations one spine is read with under `method`, or null when nothing of it is in the frame. */
export function cropFor(
  spine: { polygon: readonly Point[]; outline?: readonly Point[]; face3d?: readonly Point[] },
  frame: { width: number; height: number },
  method: CropMethod,
): SpineCrop | null {
  let q = canonical(spine.polygon);
  if (method.face3d && spine.face3d) q = canonical(spine.face3d);
  else if (method.face && spine.outline) {
    const f = spineFace(spine.outline);
    if (f) q = f.quad;
  }
  if (method.pad > 0) q = padEnds(q, method.pad);
  if (method.clip) {
    const c = clipToFrame(q, frame.width, frame.height);
    if (!c) return null;
    q = c.quad;
  }
  const rotations = method.orient === "long-axis" ? longAxisRotations(q) : method.orient === "cover" ? coverRotations(q) : [...FIXED_ROTATIONS];
  return { polygon: q, rotations, crop: cropName(method) };
}
