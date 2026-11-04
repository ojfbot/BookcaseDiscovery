// F-0j zoning, the rules half (evals/F0j/report.md, pre-registration; docs/models/per-book-extraction.md §5): which
// detected text lines belong to a book region, how they group into lines of print, and which group is the title,
// the author or the imprint, plus the multi-book flag that hands a region back to pass 1. helpers/label/zone.py
// measures the lines; this module only applies the pre-registered thresholds. Pure: no pixels, no catalog.

/** The pre-registered thresholds (frozen with evals/F0j/report.md's pre-registration). */
export const ZONE = {
  /** A line with more than this share of its pixels owned by another kept box (F-0i's label map) is a neighbour's. */
  neighbourMax: 0.5,
  /** Grouping: y overlap as a share of the smaller height, height ratio, and gap along x in larger heights. */
  groupOverlap: 0.5,
  groupHeightRatio: 1.5,
  groupGap: 1.5,
  /** Multi-book: a second group at least this share of the title's size, this many heights apart across the spine. */
  multiBookSize: 0.6,
  multiBookGap: 1.0,
  /** Imprint: wholly in this outer share of the spine's length at either end, at most this share of the title. */
  endShare: 0.15,
  imprintSize: 0.5,
  /** Non-text zones (reported only): edge densities outside the text. */
  logoEdges: 0.08,
  artEdges: 0.12,
  artMasked: 0.1,
  artLength: 0.15,
  /** The small-line stratum: a region whose smallest kept line is under this many px. */
  smallLine: 32,
} as const;

/** One detected line in its region's reading frame (x along the spine, y across), as zone.py measures it. */
export interface ZoneLine {
  k: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Height and length in working-copy pixels (minimum-area rectangle). */
  h: number;
  len: number;
  column: boolean;
  /** Share of its pixels another kept box owns. */
  neighbour: number;
}

export interface LineGroup {
  /** Line indices (`k`), in reading order along the spine. */
  lines: number[];
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** The tallest line's height. */
  h: number;
  /** Σ height × length. */
  size: number;
  column: boolean;
}

export type Role = "title" | "author" | "imprint" | "unassigned";

export interface Roles {
  /** Group index per role; `imprint` may hold several groups. */
  title: number | null;
  author: number | null;
  imprint: number[];
  unassigned: number[];
  multiBook: boolean;
}

/** The lines a region keeps: not a neighbour's. */
export const keptLines = <L extends Pick<ZoneLine, "neighbour">>(lines: readonly L[]): L[] => lines.filter((l) => l.neighbour <= ZONE.neighbourMax);

const overlap = (a0: number, a1: number, b0: number, b1: number): number => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

function joins(a: ZoneLine, b: ZoneLine): boolean {
  if (a.column !== b.column) return false;
  const ha = a.y1 - a.y0, hb = b.y1 - b.y0;
  if (overlap(a.y0, a.y1, b.y0, b.y1) < ZONE.groupOverlap * Math.min(ha, hb)) return false;
  if (Math.max(a.h, b.h) > ZONE.groupHeightRatio * Math.max(1e-9, Math.min(a.h, b.h))) return false;
  const gap = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1));
  return gap <= ZONE.groupGap * Math.max(a.h, b.h);
}

/** Groups of lines that are one line of print, in reading order: top to bottom across the spine, then along it. */
export function groupLines(lines: readonly ZoneLine[]): LineGroup[] {
  const parent = lines.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) if (joins(lines[i]!, lines[j]!)) parent[find(i)] = find(j);
  const byRoot = new Map<number, ZoneLine[]>();
  lines.forEach((l, i) => byRoot.set(find(i), [...(byRoot.get(find(i)) ?? []), l]));
  const groups = [...byRoot.values()].map((ls): LineGroup => {
    ls.sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0);
    return {
      lines: ls.map((l) => l.k),
      x0: Math.min(...ls.map((l) => l.x0)),
      x1: Math.max(...ls.map((l) => l.x1)),
      y0: Math.min(...ls.map((l) => l.y0)),
      y1: Math.max(...ls.map((l) => l.y1)),
      h: Math.max(...ls.map((l) => l.h)),
      size: ls.reduce((s, l) => s + l.h * l.len, 0),
      column: ls[0]!.column,
    };
  });
  // Reading order: bands across the spine top to bottom (a group overlapping a band by half its height is in it),
  // then left to right within a band.
  groups.sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2 || a.x0 - b.x0);
  const bands: { y0: number; y1: number; gs: LineGroup[] }[] = [];
  for (const g of groups) {
    const band = bands.find((b) => overlap(b.y0, b.y1, g.y0, g.y1) >= ZONE.groupOverlap * (g.y1 - g.y0));
    if (band) (band.gs.push(g), (band.y0 = Math.min(band.y0, g.y0)), (band.y1 = Math.max(band.y1, g.y1)));
    else bands.push({ y0: g.y0, y1: g.y1, gs: [g] });
  }
  return bands.flatMap((b) => b.gs.sort((x, y) => x.x0 - y.x0));
}

/** The largest group, or null; ties go to the first in reading order. */
function largest(groups: readonly LineGroup[], among: readonly number[]): number | null {
  let best: number | null = null;
  for (const i of among) if (best === null || groups[i]!.size > groups[best]!.size) best = i;
  return best;
}

/**
 * Multi-book (pre-registered): a second group of at least 0.6 × the title's size, not overlapping it across the
 * spine, at least 1.0 × the larger height away from it. Geometry only, so it is known before any line is read.
 */
export function multiBook(groups: readonly LineGroup[]): boolean {
  const t = largest(groups, groups.map((_, i) => i));
  if (t === null) return false;
  const T = groups[t]!;
  return groups.some((g, i) => {
    if (i === t || g.size < ZONE.multiBookSize * T.size) return false;
    if (overlap(g.y0, g.y1, T.y0, T.y1) > 0) return false;
    const gap = Math.max(g.y0, T.y0) - Math.min(g.y1, T.y1);
    return gap >= ZONE.multiBookGap * Math.max(g.h, T.h);
  });
}

/**
 * Roles in the pre-registered order: title (largest group), multi-book, author (the largest group `isAuthor` accepts;
 * it reads the OCR readers' text of the group against the catalog's name forms), imprint (in the outer 15 % of the
 * spine's length, at most half the title's size), the rest unassigned. `length` is the region's length along x.
 */
export function assignRoles(groups: readonly LineGroup[], length: number, isAuthor: (g: number) => boolean): Roles {
  const all = groups.map((_, i) => i);
  const title = largest(groups, all);
  const rest = all.filter((i) => i !== title);
  const author = largest(groups, rest.filter(isAuthor));
  const end = ZONE.endShare * length;
  const imprint = rest.filter(
    (i) => i !== author && (groups[i]!.x1 <= end || groups[i]!.x0 >= length - end) && title !== null && groups[i]!.size <= ZONE.imprintSize * groups[title]!.size,
  );
  return { title, author, imprint, unassigned: rest.filter((i) => i !== author && !imprint.includes(i)), multiBook: multiBook(groups) };
}

/** zone.py's edge profile of a region: densities outside the text at each end and in windows along the spine. */
export interface EdgeProfile {
  ends: [number | null, number | null];
  /** Per window: [edge density outside the text (null when under 10 % is free), masked share]. */
  windows: [number | null, number][];
  window: number;
  step: number;
}

/** Non-text zones (reported only, never read for identity): an imprint mark at either end, and cover or jacket art. */
export function nonTextZones(p: EdgeProfile, length: number): { imprintLogo: [boolean, boolean]; art: boolean; artShare: number } {
  const imprintLogo = p.ends.map((d) => d !== null && d >= ZONE.logoEdges) as [boolean, boolean];
  // Art: windows dense in edges and nearly free of text, merged into runs; their union along the spine.
  const hot = p.windows.map(([d, m]) => d !== null && d >= ZONE.artEdges && m < ZONE.artMasked);
  let covered = 0, runEnd = -1;
  hot.forEach((h, i) => {
    if (!h) return;
    const x0 = i * p.step, x1 = Math.min(length, x0 + p.window);
    covered += Math.max(0, x1 - Math.max(x0, runEnd));
    runEnd = x1;
  });
  const artShare = length > 0 ? covered / length : 0;
  return { imprintLogo, art: artShare >= ZONE.artLength, artShare };
}
