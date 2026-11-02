// Label schema (V-1a). Human-readable spec: docs/labels.md.
// A label file is one session: its photos, and for each photo the shelf bands and spines a person
// (or, later, F-0's machines) marked. Labels are private data: files live under $BOOKCASE_DATA/labels/.
import { z } from "zod";

export const SCHEMA_VERSION = 1;

/** A point in original-image pixels. Origin top-left, y down. */
export const Point = z.tuple([z.number().finite(), z.number().finite()]);
export type Point = z.infer<typeof Point>;

/**
 * Four corners of a rotated rectangle, in this order: top-left, top-right, bottom-right, bottom-left,
 * where "top-left" is the corner the box was drawn from and top-right lies along the box's rotation.
 * That is the frame Label Studio stores, so the order survives a round trip.
 */
export const Polygon4 = z.tuple([Point, Point, Point, Point]);
export type Polygon4 = z.infer<typeof Polygon4>;

export const spineKinds = ["spine", "face-out", "stacked", "not-a-book"] as const;
export const SpineKind = z.enum(spineKinds);
export type SpineKind = z.infer<typeof SpineKind>;

export const SpineText = z.object({
  title: z.string(),
  author: z.string(),
  series: z.string().optional(),
});
export type SpineText = z.infer<typeof SpineText>;

export const Spine = z.object({
  /** Stable across exports. For Label Studio imports this is the region id. */
  id: z.string().min(1),
  polygon: Polygon4,
  /** Index into the photo's `shelfBands` (0 = topmost band). Null when the photo has no bands. */
  shelf: z.number().int().nonnegative().nullable(),
  /** Position along the shelf band, 0 = first from the left. Null when `shelf` is null. */
  ordinal: z.number().int().nonnegative().nullable(),
  kind: SpineKind,
  text: SpineText,
  /** True when a person looked and could not read the spine. `text` may then be empty or partial. */
  unreadable: z.boolean(),
  /** Always null at labelling time; V-3 resolves it to a catalog ID or the string "not-in-catalog". */
  catalogId: z.string().nullable(),
  notes: z.string(),
});
export type Spine = z.infer<typeof Spine>;

export const ShelfBand = z.object({
  id: z.string().min(1),
  polygon: Polygon4,
});
export type ShelfBand = z.infer<typeof ShelfBand>;

export const Photo = z.object({
  /** sha256 of the original file, lowercase hex. */
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  /** Capture setting: `whole-12`, `whole-48`, `shelf-48`, `overview` (REQUIREMENTS OC6), or `real-use` kinds later. */
  setting: z.string().min(1),
  /** Which shelf of the case a per-shelf photo shows; null for whole-case photos. */
  shelfIndex: z.number().int().nonnegative().nullable(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Whole-case photos carry bands; per-shelf photos may carry one. Ordered top to bottom by centre y. */
  shelfBands: z.array(ShelfBand),
  spines: z.array(Spine),
});
export type Photo = z.infer<typeof Photo>;

export const LabelSet = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    /** Session id, e.g. `sf-store-001`; also the file name `<session>.json`. */
    session: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
    photos: z.array(Photo),
  })
  .superRefine((set, ctx) => {
    const seen = new Set<string>();
    set.photos.forEach((photo, i) => {
      if (seen.has(photo.hash)) ctx.addIssue({ code: "custom", path: ["photos", i, "hash"], message: "duplicate photo hash" });
      seen.add(photo.hash);
      const ids = new Set<string>();
      for (const [j, item] of [...photo.shelfBands, ...photo.spines].entries()) {
        if (ids.has(item.id)) ctx.addIssue({ code: "custom", path: ["photos", i], message: `duplicate region id ${item.id} (${j})` });
        ids.add(item.id);
      }
      photo.spines.forEach((spine, k) => {
        if (spine.shelf !== null && spine.shelf >= photo.shelfBands.length)
          ctx.addIssue({ code: "custom", path: ["photos", i, "spines", k, "shelf"], message: "shelf index beyond shelfBands" });
      });
    });
  });
export type LabelSet = z.infer<typeof LabelSet>;

// --- geometry -------------------------------------------------------------------------------

const centre = (p: Polygon4): Point => [
  (p[0][0] + p[1][0] + p[2][0] + p[3][0]) / 4,
  (p[0][1] + p[1][1] + p[2][1] + p[3][1]) / 4,
];

/** Unit vector along the box's drawn top edge (top-left to top-right). */
const axis = (p: Polygon4): Point => {
  const dx = p[1][0] - p[0][0];
  const dy = p[1][1] - p[0][1];
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
};

function contains(p: Polygon4, [x, y]: Point): boolean {
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const [xi, yi] = p[i]!;
    const [xj, yj] = p[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Fill `shelf` and `ordinal` on every spine from geometry, and order the bands top to bottom.
 * A spine belongs to the band that contains its centre, else the band with the nearest centre.
 * Ordinal is the rank of the centre along the band's top edge, so tilted bands still read left to right.
 * Returns the number of spines that fell outside every band (the caller may warn about them).
 */
export function assignShelves(
  bands: ShelfBand[],
  spines: Omit<Spine, "shelf" | "ordinal">[],
): { bands: ShelfBand[]; spines: Spine[]; outsideBands: number } {
  const sorted = [...bands].sort((a, b) => centre(a.polygon)[1] - centre(b.polygon)[1] || a.id.localeCompare(b.id));
  let outsideBands = 0;
  const placed = spines.map((s) => {
    if (sorted.length === 0) return { ...s, shelf: null as number | null, ordinal: null as number | null, pos: 0 };
    const c = centre(s.polygon);
    let shelf = sorted.findIndex((b) => contains(b.polygon, c));
    if (shelf < 0) {
      outsideBands++;
      let best = Infinity;
      sorted.forEach((b, i) => {
        const bc = centre(b.polygon);
        const d = Math.hypot(bc[0] - c[0], bc[1] - c[1]);
        if (d < best) [best, shelf] = [d, i];
      });
    }
    const band = sorted[shelf]!.polygon;
    const a = axis(band);
    return { ...s, shelf: shelf as number | null, ordinal: null as number | null, pos: (c[0] - band[0][0]) * a[0] + (c[1] - band[0][1]) * a[1] };
  });
  const ordered: Spine[] = [];
  const byShelf = new Map<number | null, typeof placed>();
  for (const s of placed) byShelf.set(s.shelf, [...(byShelf.get(s.shelf) ?? []), s]);
  for (const group of byShelf.values()) {
    group.sort((a, b) => a.pos - b.pos || a.id.localeCompare(b.id));
    group.forEach((g, i) => {
      const { pos: _pos, ...rest } = g;
      ordered.push({ ...rest, ordinal: g.shelf === null ? null : i });
    });
  }
  // Keep the input order so diffs of label files stay stable.
  const index = new Map(spines.map((s, i) => [s.id, i]));
  ordered.sort((a, b) => index.get(a.id)! - index.get(b.id)!);
  return { bands: sorted, spines: ordered, outsideBands };
}

/** Where label files live: `$BOOKCASE_DATA/labels/` (default `~/data/bookcase-discovery/labels/`). */
export function labelsDir(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.BOOKCASE_DATA ?? `${env.HOME}/data/bookcase-discovery`;
  return `${root}/labels`;
}
