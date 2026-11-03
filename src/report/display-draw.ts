// U-4: draws one display variant (display-modes.ts) over one photo as a self-contained SVG. Pure: a scene and a
// variant in, SVG text out, so tests run on synthetic shelves. The layers drawn and every style number come from
// the variant; nothing here looks at a mode's or variant's name. Coordinates in a scene are working-copy pixels.
import type { Rung } from "../eval/q2.ts";
import { REF_EDGE, coverageState, rungAtLeast } from "./display-modes.ts";
import type { DisplayVariant, LayerStyle, Paint, ShapeSpec } from "./display-modes.ts";

export type Pt = [number, number];

export interface SceneSpine {
  /** Raw box index in the detection cache. */
  index: number;
  /** The detector's oriented box (4 corners). */
  quad: Pt[];
  /** Mask outline pieces that belong to this spine, clipped to its box; empty when none cover enough of it. */
  pieces: Pt[][];
  boxScore: number;
  cut: boolean;
  partial: boolean;
  rung: Rung;
  /** The machine's title guess (labelling only; private renders). */
  guess: string | null;
}

export interface Scene {
  width: number;
  height: number;
  spines: SceneSpine[];
  bands: Pt[][];
  /** [x0, y0, x1, y1] per detector tile. */
  tiles: [number, number, number, number][];
}

// --- polygon geometry ----------------------------------------------------------------------------------------

export function area(p: Pt[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i]!;
    const [x1, y1] = p[(i + 1) % p.length]!;
    s += x0 * y1 - x1 * y0;
  }
  return Math.abs(s) / 2;
}

const cross = (o: Pt, a: Pt, b: Pt): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Sutherland–Hodgman: `subject` (any simple polygon) clipped by a convex polygon. */
export function clipConvex(subject: Pt[], clip: Pt[]): Pt[] {
  let orient = 0;
  for (let i = 0; i < clip.length && orient === 0; i++) orient = Math.sign(cross(clip[i]!, clip[(i + 1) % clip.length]!, clip[(i + 2) % clip.length]!));
  if (orient === 0) return [];
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i]!;
    const b = clip[(i + 1) % clip.length]!;
    const inside = (p: Pt) => orient * cross(a, b, p) >= 0;
    const meet = (p: Pt, q: Pt): Pt => {
      const d1 = cross(a, b, p);
      const d2 = cross(a, b, q);
      const t = d1 / (d1 - d2);
      return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
    };
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j]!;
      const q = input[(j + 1) % input.length]!;
      if (inside(q)) {
        if (!inside(p)) out.push(meet(p, q));
        out.push(q);
      } else if (inside(p)) out.push(meet(p, q));
    }
  }
  return out;
}

/** Chaikin corner cutting on a closed polygon, `n` passes. */
export function chaikin(p: Pt[], n: number): Pt[] {
  let out = p;
  for (let k = 0; k < n; k++) {
    const next: Pt[] = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[i]!;
      const b = out[(i + 1) % out.length]!;
      next.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    out = next;
  }
  return out;
}

export function perimeter(p: Pt[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) s += Math.hypot(p[(i + 1) % p.length]![0] - p[i]![0], p[(i + 1) % p.length]![1] - p[i]![1]);
  return s;
}

export function convexHull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const half = (pts: Pt[]) => {
    const h: Pt[] = [];
    for (const q of pts) {
      while (h.length >= 2 && cross(h[h.length - 2]!, h[h.length - 1]!, q) <= 0) h.pop();
      h.push(q);
    }
    h.pop();
    return h;
  };
  return [...half(p), ...half([...p].reverse())];
}

/** Perimeter over the convex hull's perimeter, minus 1: 0 for a convex outline. */
export const jaggedness = (p: Pt[]): number => (p.length < 3 ? 0 : perimeter(p) / perimeter(convexHull(p)) - 1);

/** Oriented-box geometry: centre, unit long axis, long and short side lengths. */
export function quadAxis(q: Pt[]): { centre: Pt; axis: Pt; long: number; short: number } {
  const c: Pt = [q.reduce((s, p) => s + p[0], 0) / q.length, q.reduce((s, p) => s + p[1], 0) / q.length];
  const e1: Pt = [q[1]![0] - q[0]![0], q[1]![1] - q[0]![1]];
  const e2: Pt = [q[2]![0] - q[1]![0], q[2]![1] - q[1]![1]];
  const l1 = Math.hypot(...e1);
  const l2 = Math.hypot(...e2);
  const [e, long, short] = l1 >= l2 ? [e1, l1, l2] : [e2, l2, l1];
  return { centre: c, axis: [e[0] / (long || 1), e[1] / (long || 1)], long, short };
}

/** The box grown about its centre: `along` and `across` as shares of its long and short sides. */
export function growQuad(q: Pt[], along: number, across: number): Pt[] {
  const { centre, axis } = quadAxis(q);
  const n: Pt = [-axis[1], axis[0]];
  return q.map((p) => {
    const d: Pt = [p[0] - centre[0], p[1] - centre[1]];
    const a = d[0] * axis[0] + d[1] * axis[1];
    const b = d[0] * n[0] + d[1] * n[1];
    return [centre[0] + a * (1 + along) * axis[0] + b * (1 + across) * n[0], centre[1] + a * (1 + along) * axis[1] + b * (1 + across) * n[1]];
  });
}

export function pointInPolygon(pt: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// --- mask pieces onto whole-spine boxes ------------------------------------------------------------------------

/** One mask outline from another detection of the same photo, with what was measured on it. */
export interface Piece {
  outline: Pt[];
  rung: Rung;
  guess: string | null;
}

/** Share of a piece's area that must sit inside a spine's box for the piece to belong to that spine. */
export const PIECE_INSIDE = 0.5;
/** Share of a box the clipped pieces must cover for the highlight to follow them; below it, the box is drawn. */
export const MASK_COVER = 0.6;

/**
 * Attach mask-outline pieces to whole-spine boxes. A piece belongs to the box holding the largest share of it, if
 * that share is at least PIECE_INSIDE; the box's rung is the highest of its pieces' rungs (one well-read piece reads
 * the spine) and its guess comes from that piece. A box no piece belongs to stays `spine-found`, the rung every
 * detected box has. Pieces are clipped to the box grown slightly, so a mask edge is not shaved by a tight box.
 */
export function attachPieces(quads: Pt[][], pieces: Piece[]): { pieces: Pt[][]; rung: Rung; guess: string | null; maskShare: number }[] {
  const grown = quads.map((q) => growQuad(q, 0.03, 0.08));
  const boxes = grown.map(bbox);
  const owned: number[][] = quads.map(() => []);
  pieces.forEach((pc, pi) => {
    const a = area(pc.outline);
    if (a <= 0) return;
    const b = bbox(pc.outline);
    let best = -1;
    let bestShare = 0;
    grown.forEach((g, qi) => {
      if (!overlaps(b, boxes[qi]!)) return;
      const share = area(clipConvex(pc.outline, g)) / a;
      if (share > bestShare) [best, bestShare] = [qi, share];
    });
    if (best >= 0 && bestShare >= PIECE_INSIDE) owned[best]!.push(pi);
  });
  return quads.map((q, qi) => {
    const mine = owned[qi]!.map((i) => pieces[i]!);
    const clipped = mine.map((pc) => clipConvex(pc.outline, grown[qi]!)).filter((p) => p.length >= 3);
    const qa = area(q) || 1;
    const maskShare = Math.min(1, clipped.reduce((s, p) => s + area(p), 0) / qa);
    const top = mine.reduce<Piece | null>((b, pc) => (!b || rungAtLeast(pc.rung, b.rung) ? pc : b), null);
    return { pieces: maskShare >= MASK_COVER ? clipped : [], rung: top?.rung ?? "spine-found", guess: top?.guess ?? null, maskShare };
  });
}

type Box = [number, number, number, number];
const bbox = (p: Pt[]): Box => [Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1]))];
const overlaps = (a: Box, b: Box): boolean => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

/** A box is partial when its long side is under `share` of the 90th percentile of long sides in its band (F-0e). */
export function partialFlags(quads: Pt[][], bands: Pt[][], share = 0.55): boolean[] {
  const bandOf = quads.map((q) => bands.findIndex((b) => pointInPolygon(quadAxis(q).centre, b)));
  const p90 = new Map<number, number>();
  for (let b = 0; b < bands.length; b++) {
    const longs = quads.filter((_, i) => bandOf[i] === b).map((q) => quadAxis(q).long).sort((x, y) => x - y);
    if (longs.length) p90.set(b, longs[Math.min(longs.length - 1, Math.floor(0.9 * longs.length))]!);
  }
  return quads.map((q, i) => bandOf[i]! >= 0 && quadAxis(q).long < share * p90.get(bandOf[i]!)!);
}

// --- the shape a variant draws -------------------------------------------------------------------------------

/** The outlines one spine is drawn with under a shape spec, in working-copy pixels. */
export function spineShape(s: SceneSpine, spec: ShapeSpec): Pt[][] {
  return [chaikin(baseOutline(s, spec), spec.smoothing)].concat(spec.source === "mask" && !spec.hull ? s.pieces.slice(1).map((p) => chaikin(p, spec.smoothing)) : []);
}

/** The outline a spec starts from before smoothing: the box, the hull of the mask pieces, or the first piece. */
export function baseOutline(s: SceneSpine, spec: ShapeSpec): Pt[] {
  if (spec.source === "quad" || !s.pieces.length) return s.quad;
  return spec.hull ? convexHull(s.pieces.flat()) : s.pieces[0]!;
}

// --- SVG -----------------------------------------------------------------------------------------------------

const f1 = (x: number): string => (Math.round(x * 10) / 10).toString();
const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const RUNG_WORD: Record<Rung, string> = {
  "not-seen": "not seen",
  seen: "seen",
  "spine-found": "found",
  "text-present": "text",
  "text-read": "read",
  matched: "matched",
  confirmed: "confirmed",
};

interface Ctx {
  k: number; // working-copy px → display px
  u: number; // style px → display px
  defs: string[];
  ids: Set<string>;
}

const pathOf = (polys: Pt[][], k: number): string => polys.map((p) => `M${p.map(([x, y]) => `${f1(x * k)} ${f1(y * k)}`).join("L")}Z`).join("");

/**
 * A soft edge without SVG filters: `steps` strokes along the outline, each narrower than the last, so alpha builds
 * toward the line and fades out over `widthPx` either side. Browsers drop filters on images with hundreds of
 * complex paths, and a stroke stack is also what a phone overlay can afford every frame.
 */
function softStroke(c: Ctx, d: string, colour: string, opacity: number, widthPx: number, steps = 4): string {
  return Array.from({ length: steps }, (_, i) => {
    const w = (2 * widthPx * c.u * (steps - i)) / steps;
    return `<path d="${d}" fill="none" stroke="${colour}" stroke-opacity="${(opacity / steps).toFixed(3)}" stroke-width="${f1(w)}" stroke-linejoin="round"/>`;
  }).join("");
}

/** Ridge, hatch or stipple pattern; angles are quantised to 2° so spines at one tilt share a pattern. */
function pattern(c: Ctx, kind: "ridge" | "hatch" | "stipple", paint: Paint, angleDeg: number): string {
  const s = (paint.spacingPx ?? 6) * c.u;
  const m = (paint.markPx ?? 1) * c.u;
  const a = kind === "stipple" ? 0 : kind === "hatch" ? 45 : Math.round(angleDeg / 2) * 2;
  const id = `${kind}${f1(s).replace(".", "_")}m${f1(m).replace(".", "_")}a${a}`.replace(/-/g, "n");
  if (!c.ids.has(id)) {
    c.ids.add(id);
    const mark = kind === "stipple" ? `<circle cx="${f1(s / 2)}" cy="${f1(s / 2)}" r="${f1(m)}" fill="${paint.colour}"/>` : `<rect x="0" y="0" width="${f1(s)}" height="${f1(m)}" fill="${paint.colour}"/>`;
    c.defs.push(`<pattern id="${id}" patternUnits="userSpaceOnUse" width="${f1(s)}" height="${f1(s)}"${a ? ` patternTransform="rotate(${a})"` : ""}>${mark}</pattern>`);
  }
  return id;
}

/** One spine's outlines and its long-axis angle (ridges run across it). */
interface Painted {
  polys: Pt[][];
  angleDeg: number;
}

/**
 * One paint over many spines. Each filtered part is one group with one path for all spines: browsers drop
 * filters when an image holds hundreds of filtered groups, and one group also composites overlaps as a union.
 */
function paintAll(c: Ctx, paint: Paint, shapes: Painted[]): string {
  if (paint.kind === "none" || !shapes.length) return "";
  const d = pathOf(shapes.flatMap((s) => s.polys), c.k);
  const out: string[] = [];
  if (paint.haloOpacity)
    out.push(softStroke(c, d, "#100e08", paint.haloOpacity, 2, 3));
  switch (paint.kind) {
    case "glow": {
      const b = paint.blurPx ?? 4;
      out.push(`<path d="${d}" fill="${paint.colour}" fill-opacity="${(paint.opacity * 0.15).toFixed(3)}"/>${softStroke(c, d, paint.colour, paint.opacity, b, 5)}`);
      break;
    }
    case "veil":
      // The fill stops short of the edge by the feather, and a soft stroke carries it out past the outline.
      out.push(`<path d="${d}" fill="${paint.colour}" fill-opacity="${paint.opacity}"/>${paint.blurPx ? softStroke(c, d, paint.colour, paint.opacity / 2, paint.blurPx, 3) : ""}`);
      break;
    case "ridge":
    case "hatch":
    case "stipple": {
      // Ridges run across the spine: the pattern's horizontal lines turned to the short axis. One path per pattern.
      const byPattern = new Map<string, Pt[][]>();
      for (const s of shapes) {
        const id = pattern(c, paint.kind, paint, s.angleDeg + 90);
        byPattern.set(id, [...(byPattern.get(id) ?? []), ...s.polys]);
      }
      out.push(`<g opacity="${paint.opacity}">${[...byPattern].map(([id, polys]) => `<path d="${pathOf(polys, c.k)}" fill="url(#${id})"/>`).join("")}</g>`);
      break;
    }
    case "rim":
      break;
  }
  if (paint.rimPx && paint.rimOpacity)
    out.push(`<path d="${d}" fill="none" stroke="${paint.colour}" stroke-opacity="${paint.rimOpacity}" stroke-width="${f1(paint.rimPx * c.u)}" stroke-linejoin="round"/>`);
  return out.join("");
}

const angleOf = (s: SceneSpine): number => {
  const { axis } = quadAxis(s.quad);
  return (Math.atan2(axis[1], axis[0]) * 180) / Math.PI;
};

/** Text rotation along a spine, kept upright enough to read (vertical spines read bottom to top). */
function textAngle(s: SceneSpine): number {
  let a = angleOf(s);
  if (a > 90) a -= 180;
  if (a <= -90) a += 180;
  return a > 45 ? a - 180 : a;
}

function label(c: Ctx, s: SceneSpine, text: string, colour: string, sizePx: number, along: number, maxShare = 0.9): string {
  const { centre, axis, long, short } = quadAxis(s.quad);
  const a = textAngle(s);
  const dir = Math.cos(((a - angleOf(s)) * Math.PI) / 180) >= 0 ? 1 : -1; // +along runs in the text's reading direction
  const fs = Math.max(3, Math.min(sizePx * c.u, 0.6 * short * c.k));
  const room = Math.floor((long * c.k * maxShare) / (0.6 * fs));
  if (room < 2) return "";
  const t = text.length > room ? `${text.slice(0, room - 1)}…` : text;
  const x = (centre[0] + dir * along * long * axis[0]) * c.k;
  const y = (centre[1] + dir * along * long * axis[1]) * c.k;
  return `<text x="${f1(x)}" y="${f1(y)}" transform="rotate(${f1(a)} ${f1(x)} ${f1(y)})" font-size="${f1(fs)}" fill="${colour}" text-anchor="middle" dominant-baseline="central" font-family="JetBrains Mono, Menlo, monospace" stroke="#100e08" stroke-width="${f1(fs / 4)}" stroke-opacity="0.8" paint-order="stroke">${esc(t)}</text>`;
}

function strokeQuads(c: Ctx, quads: Pt[][], l: { colour: string; opacity: number; widthPx: number; dash?: string }): string {
  if (!quads.length) return "";
  return `<path d="${pathOf(quads, c.k)}" fill="none" stroke="${l.colour}" stroke-opacity="${l.opacity}" stroke-width="${f1(l.widthPx * c.u)}"${l.dash ? ` stroke-dasharray="${l.dash.split(" ").map((x) => f1(Number(x) * c.u)).join(" ")}"` : ""}/>`;
}

function layer(c: Ctx, scene: Scene, v: DisplayVariant, l: LayerStyle, display: { width: number; height: number }): string {
  const sp = scene.spines;
  switch (l.kind) {
    case "scrim": {
      if (!l.opacity) return "";
      if (!l.liftFilled) return `<rect width="${display.width}" height="${display.height}" fill="${l.colour}" opacity="${l.opacity}"/>`;
      const fill = v.layers.find((x) => x.kind === "coverage-fill");
      const spec: ShapeSpec = fill && fill.kind === "coverage-fill" ? fill.shape : { source: "quad", hull: false, smoothing: 0 };
      const lifted = sp.filter((s) => coverageState(s.rung) === "filled").flatMap((s) => spineShape(s, spec));
      c.defs.push(
        `<mask id="lift"><rect width="${display.width}" height="${display.height}" fill="#fff"/><path d="${pathOf(lifted, c.k)}" fill="#000"/>${l.liftFeatherPx ? softStroke(c, pathOf(lifted, c.k), "#000", 1, l.liftFeatherPx, 4) : ""}</mask>`,
      );
      return `<rect width="${display.width}" height="${display.height}" fill="${l.colour}" opacity="${l.opacity}" mask="url(#lift)"/>`;
    }
    case "tile-edge":
      return strokeQuads(c, scene.tiles.map(([x0, y0, x1, y1]) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as Pt[]), l);
    case "band-line":
      return strokeQuads(c, scene.bands, l);
    case "box":
      return strokeQuads(c, sp.map((s) => s.quad), l);
    case "cut-flag":
      return strokeQuads(c, sp.filter((s) => s.cut).map((s) => s.quad), l);
    case "partial-flag":
      return strokeQuads(c, sp.filter((s) => s.partial).map((s) => s.quad), l);
    case "box-id":
      return sp.map((s) => label(c, s, String(s.index), l.colour, l.sizePx, 0.12)).join("");
    case "box-score":
      return sp.map((s) => label(c, s, s.boxScore.toFixed(2), l.colour, l.sizePx, -0.12)).join("");
    case "machine-guess":
      return sp.map((s) => (s.guess ? label(c, s, s.guess, l.colour, l.sizePx, 0.08, l.maxShare * 0.75) : "")).join("");
    case "rung-tag":
      return sp
        .map((s) => label(c, s, RUNG_WORD[s.rung], coverageState(s.rung) === "filled" ? l.filledColour : l.patchyColour, l.sizePx, -0.4, 0.2))
        .join("");
    case "coverage-fill": {
      const of = (state: string): Painted[] => sp.filter((s) => coverageState(s.rung) === state).map((s) => ({ polys: spineShape(s, l.shape), angleDeg: angleOf(s) }));
      return paintAll(c, l.patchy, of("patchy")) + paintAll(c, l.filled, of("filled"));
    }
    case "highlight":
      return paintAll(
        c,
        l.paint,
        sp.filter((s) => rungAtLeast(s.rung, l.minRung)).map((s) => ({ polys: spineShape(s, l.shape), angleDeg: angleOf(s) })),
      );
  }
}

/**
 * One variant's overlay for one photo: an SVG the size of the shown image (`display`, the derivative's pixels),
 * transparent where nothing is drawn, with no external references, so it works as an <img> over the photo.
 */
export function overlaySvg(scene: Scene, v: DisplayVariant, display: { width: number; height: number }): string {
  const c: Ctx = { k: display.width / scene.width, u: Math.max(display.width, display.height) / REF_EDGE, defs: [], ids: new Set() };
  const body = v.layers.map((l) => `<g data-layer="${l.kind}">${layer(c, scene, v, l, display)}</g>`).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${display.width}" height="${display.height}" viewBox="0 0 ${display.width} ${display.height}" data-variant="${esc(v.id)}"><defs>${c.defs.join("")}</defs>\n${body}\n</svg>\n`;
}

// --- still proxies for the feel metrics ----------------------------------------------------------------------

/** Gaussian noise from a seeded uniform source (Box–Muller). */
const gauss = (rand: () => number): number => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

/**
 * Still proxies for one outline under one shape spec: jaggedness of the drawn outline; perturbation wobble (RMS
 * displacement of the drawn outline per unit of RMS vertex noise, σ = `sigmaShare` of the spine's width, vertex for
 * vertex since smoothing keeps the correspondence); and the coefficient of variation of drawn area over `copies`.
 */
export function stillProxies(outline: Pt[], short: number, spec: ShapeSpec, rand: () => number, sigmaShare = 0.02, copies = 8): { jaggedness: number; wobble: number; areaCv: number } {
  const drawn = chaikin(outline, spec.smoothing);
  const sigma = sigmaShare * short;
  const areas: number[] = [];
  let num = 0;
  let den = 0;
  for (let i = 0; i < copies; i++) {
    const noise = outline.map((): Pt => [sigma * gauss(rand), sigma * gauss(rand)]);
    const noisy = chaikin(outline.map((p, j): Pt => [p[0] + noise[j]![0], p[1] + noise[j]![1]]), spec.smoothing);
    areas.push(area(noisy));
    for (let j = 0; j < drawn.length; j++) num += (noisy[j]![0] - drawn[j]![0]) ** 2 + (noisy[j]![1] - drawn[j]![1]) ** 2;
    den += noise.reduce((s, [x, y]) => s + x * x + y * y, 0) * (drawn.length / outline.length);
  }
  const mean = areas.reduce((s, x) => s + x, 0) / areas.length;
  const sd = Math.sqrt(areas.reduce((s, x) => s + (x - mean) ** 2, 0) / areas.length);
  return { jaggedness: jaggedness(drawn), wobble: den ? Math.sqrt(num / den) : 0, areaCv: mean ? sd / mean : 0 };
}
