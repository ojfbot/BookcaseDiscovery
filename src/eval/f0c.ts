// F-0c cover-out arm: which detected box is a spine, a face-out book or not a book. Detection now has two box lists,
// the spine path's `spines` (unchanged) and the cover pass's `covers` (helpers/label/detect.py, post step "covers");
// `kinds` reads both and gives every box one `Spine.kind` (src/eval/labels.ts), so one book gets one box. Pure
// functions over one Detection: no pixels, no readers. Runner: f0c-cli.ts. Measured in evals/F0c/report.md.
import type { DetectedSpine, Detection } from "./f0.ts";
import { contains, geometry, SPINE_HEIGHT_Q, UPRIGHT_DEG, type Geometry } from "./f0e.ts";
import { labelWhy, type BoxEvidence, type LabelWhy } from "./f0f.ts";
import type { Polygon4 } from "./labels.ts";

/** Cover rules, fixed before the full run (evals/F0c/report.md, Pre-registration). */
export const COVER = {
  /** Short side over long side of a cover box: a portrait cover is 0.6–0.8, widened for perspective and mask slack. */
  minShortOverLong: 0.5,
  maxShortOverLong: 0.9,
  /**
   * A cover's short side is at least this many median spine widths: a piece of one spine is about one wide. Not
   * 2.5 (the spine path's group cut), because a face-out display across the aisle shows covers under two widths.
   */
  minWidths: 1.5,
  /** ... and its long side at most this many times the photo's spine height: taller is a block of shelves. */
  maxLongOverSpine: 2,
  /** A cover box this much covered by spine-path boxes is a group of spines shelved side by side, not one cover. */
  groupShare: 0.5,
  /** A spine-path box with this share of its area inside a kept cover is part of that book: the cover stands for it. */
  absorb: 0.6,
} as const;

/** Not-a-book rules for spine-path boxes, fixed before the full run. */
export const NOT_A_BOOK = {
  /** Long side more than this many degrees from vertical: lying flat (as detect.py's FLAT_DEG). */
  flatDeg: 60,
  /** A flat box longer than this many of its band's spine heights spans several books: a shelf lip or a row of book ends. */
  maxFlatOverSpine: 1.5,
  /** A flat box shorter than this share of the band's spine height and thinner than a spine is a strip, not a book lying down. */
  minFlatOverSpine: 0.35,
  thinWidths: 0.6,
  /** A box holding this share of each of two or more kept covers is a row of face-out books, not one book. */
  coverRowShare: 0.3,
} as const;

export type BoxKind = "spine" | "face-out" | "not-a-book";

/** Why a box got its kind; `spine` and `cover` are the plain cases. */
export type KindWhy =
  | "spine"
  | "cover"
  | "absorbed" // a spine-path box that is part of a kept cover's book
  | "spans-books" // flat and longer than any book on its shelf
  | "flat-strip" // flat, short and thin
  | "cover-row" // holds two or more kept covers
  | "cover-shape" // a cover-pass box that is not cover-shaped or sized
  | "cover-group" // a cover-pass box that is a group of spines
  | LabelWhy; // F-0f: a shelf label or card (genre strip, shelf-talker, blank card), from its text or pixels

export interface KindedBox {
  /** `s<i>`: index into `spines`; `c<j>`: index into `covers`. Spine ids stay their F-0 positions. */
  ref: string;
  kind: BoxKind;
  why: KindWhy;
  polygon: Polygon4;
  boxScore: number;
  /** For an absorbed spine-path box: the cover that stands for its book. */
  absorbedBy?: string;
}

export interface Kinds {
  /** One per spine-path box, in order; absorbed boxes are `face-out` and not read on their own. */
  spines: KindedBox[];
  /** Kept covers only (`face-out`). Dropped cover-pass boxes are in `dropped`. */
  covers: KindedBox[];
  dropped: KindedBox[];
  /** The photo's spine height (p90 of upright spine-path boxes) and median spine width the rules used, px. */
  spineHeight: number | null;
  medianWidth: number;
}

// --- convex polygon area and intersection ------------------------------------------------------------------

type Pt = [number, number];

export function area(p: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!, b = p[(i + 1) % p.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

/** Orient a convex polygon counter-clockwise in the maths sense (y up), i.e. positive signed area. */
function ccw(p: readonly Pt[]): Pt[] {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!, b = p[(i + 1) % p.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s >= 0 ? [...p] : [...p].reverse();
}

/** Area of the intersection of two convex polygons (Sutherland–Hodgman). */
export function intersectionArea(a: readonly Pt[], b: readonly Pt[]): number {
  let out = ccw(a);
  const clip = ccw(b);
  for (let i = 0; i < clip.length && out.length > 0; i++) {
    const c0 = clip[i]!, c1 = clip[(i + 1) % clip.length]!;
    const side = (p: Pt) => (c1[0] - c0[0]) * (p[1] - c0[1]) - (c1[1] - c0[1]) * (p[0] - c0[0]);
    const input = out;
    out = [];
    for (let k = 0; k < input.length; k++) {
      const p = input[k]!, q = input[(k + 1) % input.length]!;
      const sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
  }
  return out.length >= 3 ? area(out) : 0;
}

// --- kinds -------------------------------------------------------------------------------------------------

const quantileOf = (xs: number[], q: number): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};

/** Spine height of a band: SPINE_HEIGHT_Q of the long sides of its upright boxes (at least three), as F-0e. */
function bandSpineHeights(det: Detection, geo: Geometry[]): (number | null)[] {
  return det.bands.map((b) => quantileOf(geo.filter((g) => g.tilt <= UPRIGHT_DEG && contains(b.polygon, g.cx, g.cy)).map((g) => g.long), SPINE_HEIGHT_Q));
}

/**
 * Every box's kind. With no `covers` (cover pass off) only the not-a-book rules apply. With `evidence` (F-0f: a
 * box's reader text and pixel probe, by ref) a shelf label or card is `not-a-book` whatever its shape; without it
 * the kinds are F-0c's.
 */
export function kinds(det: Detection, evidence?: (ref: string) => BoxEvidence | undefined): Kinds {
  const spines = det.spines;
  const geo = spines.map((s) => geometry(s.polygon));
  const upright = geo.filter((g) => g.tilt <= UPRIGHT_DEG).map((g) => g.long);
  const spineHeight = quantileOf(upright, SPINE_HEIGHT_Q);
  const medianWidth = det.gaps.medianWidth || (quantileOf(geo.map((g) => g.short), 0.5) ?? 0);
  const areas = spines.map((s) => area(s.polygon));

  // Covers: cover-shaped, cover-sized, and not mostly made of spine-path boxes.
  const covers: KindedBox[] = [];
  const dropped: KindedBox[] = [];
  (det.covers ?? []).forEach((c, j) => {
    const g = geometry(c.polygon);
    const box = { ref: `c${j}`, polygon: c.polygon, boxScore: c.boxScore };
    const ratio = g.short / Math.max(g.long, 1e-6);
    const shaped =
      ratio >= COVER.minShortOverLong &&
      ratio <= COVER.maxShortOverLong &&
      g.short >= COVER.minWidths * medianWidth &&
      (spineHeight === null || g.long <= COVER.maxLongOverSpine * spineHeight);
    if (!shaped) return void dropped.push({ ...box, kind: "not-a-book", why: "cover-shape" });
    const a = area(c.polygon);
    const covered = spines.reduce((s, sp, i) => s + (intersectionArea(sp.polygon, c.polygon) > 0 && geo[i]!.tilt <= UPRIGHT_DEG ? intersectionArea(sp.polygon, c.polygon) : 0), 0);
    if (covered >= COVER.groupShare * a) return void dropped.push({ ...box, kind: "not-a-book", why: "cover-group" });
    const label = evidence && labelWhy(c.polygon, evidence(box.ref));
    if (label) return void dropped.push({ ...box, kind: "not-a-book", why: label });
    covers.push({ ...box, kind: "face-out", why: "cover" });
  });

  const bandH = bandSpineHeights(det, geo);
  const out: KindedBox[] = spines.map((s, i) => {
    const box = { ref: `s${i}`, polygon: s.polygon, boxScore: s.boxScore };
    const label = evidence && labelWhy(s.polygon, evidence(box.ref));
    if (label) return { ...box, kind: "not-a-book", why: label };
    // Part of a kept cover's book: the cover box stands for it.
    let best: { ref: string; share: number } | null = null;
    for (const c of covers) {
      const share = intersectionArea(s.polygon, c.polygon) / Math.max(areas[i]!, 1e-6);
      if (share >= COVER.absorb && (!best || share > best.share)) best = { ref: c.ref, share };
    }
    if (best) return { ...box, kind: "face-out", why: "absorbed", absorbedBy: best.ref };
    const rowOf = covers.filter((c) => intersectionArea(s.polygon, c.polygon) >= NOT_A_BOOK.coverRowShare * area(c.polygon));
    if (rowOf.length >= 2) return { ...box, kind: "not-a-book", why: "cover-row" };
    const g = geo[i]!;
    if (g.tilt > NOT_A_BOOK.flatDeg) {
      const band = det.bands.findIndex((b) => contains(b.polygon, g.cx, g.cy));
      const h = (band >= 0 ? bandH[band] : null) ?? spineHeight;
      if (h !== null && g.long > NOT_A_BOOK.maxFlatOverSpine * h) return { ...box, kind: "not-a-book", why: "spans-books" };
      if (h !== null && g.long < NOT_A_BOOK.minFlatOverSpine * h && g.short < NOT_A_BOOK.thinWidths * medianWidth)
        return { ...box, kind: "not-a-book", why: "flat-strip" };
    }
    return { ...box, kind: "spine", why: "spine" };
  });
  return { spines: out, covers, dropped, spineHeight, medianWidth };
}

/** The boxes F-0's readers see under the cover arm: spine-path boxes still `spine`, then the kept covers. */
export function readBoxes(k: Kinds, filter = true): KindedBox[] {
  return [...k.spines.filter((b) => b.kind === "spine" || (!filter && b.kind === "not-a-book")), ...k.covers];
}

// --- cover reading ----------------------------------------------------------------------------------------

export interface CoverText {
  title: string;
  author: string;
  imprint: string;
  /** What the catalog sees: title and author, never the imprint (publisher names are not in the index). */
  text: string;
}

const NONE = /^(none|n\/?a|unknown|not (printed|visible|legible)|unreadable|-+)\.?$/i;

/**
 * Qwen's cover answer ("Title: …", "Author: …", "Imprint: …", see read.py) as fields. An answer that ignored the
 * labels is taken whole as the title, as a spine read would be.
 */
export function coverText(raw: string): CoverText {
  const field = (k: string) => {
    const m = raw.match(new RegExp(`^\\s*\\**${k}\\**\\s*:\\s*(.*)$`, "im"));
    const v = (m?.[1] ?? "").replace(/\*+/g, "").trim();
    return NONE.test(v) ? "" : v;
  };
  const labelled = /^\s*\**(title|author|imprint)\**\s*:/im.test(raw);
  const title = labelled ? field("title") : raw.replace(/\bunreadable\b\.?/gi, "").replace(/\s+/g, " ").trim();
  const author = labelled ? field("author") : "";
  const imprint = labelled ? field("imprint") : "";
  return { title, author, imprint, text: [title, author].filter(Boolean).join(" ") };
}

/** A cover reading as the decision sees it: Qwen's answer cut to title and author; OCR readers unchanged. */
export function coverReading<R extends { reader: string; variants: { text: string }[] }>(r: R): R {
  if (r.reader !== "qwen") return r;
  return { ...r, variants: r.variants.map((v) => ({ ...v, text: coverText(v.text).text })) };
}

export type { DetectedSpine };
