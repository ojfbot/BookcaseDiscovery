// Q-3: the gap audit's cause rules, the gap polygon and the ranking. Synthetic records only.
import { describe, expect, it } from "vitest";
import {
  boxCauses,
  countOf,
  coverCauses,
  darkHit,
  frameCut,
  gapBooks,
  gapCauses,
  gapPolygon,
  growBand,
  inside,
  lost,
  lowerQuantile,
  radialOf,
  rankCauses,
  rowLabel,
  shareInside,
  ties,
  topFaceOver,
  type Book,
  type BoxFacts,
  type GapFacts,
} from "../src/eval/q3.ts";

type Pt = [number, number];
const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const bar = { luma: 40, contrast: 20 };
const box = (o: Partial<BoxFacts>): BoxFacts => ({
  rung: "spine-found",
  reason: "no-text",
  boxScore: 0.5,
  outFrac: 0,
  radial: 0.2,
  tileCut: false,
  sideCase: false,
  lying: false,
  shares: { front: 1, edge: 0, top: 0, under: 0, cover: 0, behind: 0 },
  luma: 100,
  contrast: 50,
  occludedBy: null,
  faceOutPiece: false,
  v2: null,
  ...o,
});
const primary = (b: BoxFacts, yard = false) => boxCauses(b, bar, yard)[0];

describe("cause rules for a kept box", () => {
  it("a confirmed box has no cause", () => {
    expect(boxCauses(box({ rung: "confirmed", reason: null }), bar)).toEqual([]);
  });

  it("matched: single reader, or two readers naming different works", () => {
    expect(primary(box({ rung: "matched", reason: "single-reader" }))).toEqual({ cause: "single-reader", sub: null });
    expect(primary(box({ rung: "matched", reason: "readers-disagree" }))).toEqual({ cause: "misread", sub: "disagree" });
  });

  it("text-read is a catalog gap, split by what catalog-v2 says, and an inventory miss on the yardstick", () => {
    expect(primary(box({ rung: "text-read", reason: "no-catalog-match", v2: { accept: false, pass: true } }))).toEqual({ cause: "catalog-gap", sub: "open-catalog" });
    expect(primary(box({ rung: "text-read", reason: "no-catalog-match", v2: { accept: false, pass: false } }))).toEqual({ cause: "catalog-gap", sub: "no-local-catalog" });
    expect(primary(box({ rung: "text-read", reason: "no-catalog-match" }), true)).toEqual({ cause: "catalog-gap", sub: "inventory" });
  });

  it("text-present: catalog-v2 agreement first, then capture causes, then a misread", () => {
    const t = { rung: "text-present", reason: "no-catalog-match" } as const;
    expect(primary(box({ ...t, outFrac: 0.2, v2: { accept: true, pass: true } }))).toEqual({ cause: "catalog-gap", sub: "open-catalog" });
    expect(primary(box({ ...t, outFrac: 0.2, v2: { accept: false, pass: true } }))).toEqual({ cause: "frame-edge", sub: "cut" });
    expect(primary(box({ ...t, v2: { accept: true, pass: true } }), true)).toEqual({ cause: "misread", sub: "garbled" });
    expect(primary(box({ ...t }))).toEqual({ cause: "misread", sub: "garbled" });
  });

  it("spine-found follows the pre-registered order", () => {
    const all = boxCauses(box({ outFrac: 0.1, tileCut: true, sideCase: true, occludedBy: "talker", faceOutPiece: true, lying: true, luma: 10, radial: 0.9, boxScore: 0.1 }), bar).map((h) => `${h.cause}:${h.sub}`);
    expect(all).toEqual([
      "frame-edge:cut",
      "tiling-or-side-case:tile-cut",
      "tiling-or-side-case:side-case",
      "occlusion:talker",
      "shape-filter:face-out-piece",
      "lying-flat:null",
      "dark-or-low-contrast:dark",
      "frame-edge:outer",
      "doubtful-box:null",
      "unattributed:null",
    ]);
    expect(primary(box({ boxScore: 0.1 }))).toEqual({ cause: "doubtful-box", sub: null });
    expect(primary(box({}))).toEqual({ cause: "unattributed", sub: null });
  });

  it("top face only when the top share passes the bar and leads the extra faces", () => {
    expect(topFaceOver({ front: 0.7, top: 0.2, cover: 0.1 })).toBe(true);
    expect(topFaceOver({ front: 0.6, top: 0.2, cover: 0.2 })).toBe(true);
    expect(topFaceOver({ front: 0.5, top: 0.2, cover: 0.3 })).toBe(false);
    expect(topFaceOver({ front: 0.9, top: 0.1 })).toBe(false);
    expect(topFaceOver(null)).toBe(false);
  });

  it("dark before low contrast; missing features never fire", () => {
    expect(darkHit(10, 10, bar)).toEqual({ cause: "dark-or-low-contrast", sub: "dark" });
    expect(darkHit(100, 10, bar)).toEqual({ cause: "dark-or-low-contrast", sub: "low-contrast" });
    expect(darkHit(null, null, bar)).toBeNull();
  });
});

describe("cause rules for books with no box", () => {
  const gap = (o: Partial<GapFacts>): GapFacts => ({ frameCut: false, outer: false, occludedBy: null, droppedShape: false, noBandTile: false, darkNeighbours: null, ...o });
  it("gaps follow the pre-registered order", () => {
    const all = gapCauses(gap({ frameCut: true, outer: true, occludedBy: "cover", droppedShape: true, noBandTile: true, darkNeighbours: { cause: "dark-or-low-contrast", sub: "dark" } }));
    expect(all.map((h) => h.cause)).toEqual(["frame-edge", "occlusion", "shape-filter", "tiling-or-side-case", "dark-or-low-contrast", "frame-edge", "unattributed"]);
    expect(gapCauses(gap({}))[0]).toEqual({ cause: "unattributed", sub: null });
  });
  it("a face-out cover is lost to the shape filter unless the frame cuts it", () => {
    expect(coverCauses(false)[0]).toEqual({ cause: "shape-filter", sub: "face-out" });
    expect(coverCauses(true)[0]).toEqual({ cause: "frame-edge", sub: "cut" });
  });
  it("a gap holds its length in median widths, rounded, at least one book", () => {
    expect(gapBooks(3, 3.5)).toBe(1);
    expect(gapBooks(3, 5.75)).toBe(3);
    expect(gapBooks(0, 0.25)).toBe(1);
  });
});

describe("geometry", () => {
  it("rebuilds a stretch's quad from the row's polyline and zone", () => {
    // A straight row along y = 100: the polyline starts one px before the books' extent, the first book centre
    // 100 px in, median width 100. The row starts at floor((100 − 50) / 100 / 0.25) × 0.25 = 0.5 widths.
    const line: Pt[] = [[-50, 100], [50, 100], [150, 100], [1050, 100]];
    const q = gapPolygon({ line, zone: [-20, 20], booksW0: 0, mw: 100 }, 2, 3);
    const r = q.map(([x, y]) => [Math.round(x), Math.round(y)]);
    expect(r).toEqual([[200, 60], [300, 60], [300, 140], [200, 140]]);
    // booksW0 shifts the row's start back.
    const q2 = gapPolygon({ line, zone: [-20, 20], booksW0: 0.5, mw: 100 }, 2, 3);
    expect(Math.round(q2[0]![0])).toBe(150);
  });

  it("measures share inside, frame cuts, radial distance, grown bands", () => {
    expect(shareInside(rect(0, 0, 10, 10), [rect(0, 0, 5, 10)])).toBeCloseTo(0.5);
    expect(shareInside(rect(0, 0, 10, 10), [rect(0, 0, 10, 10), rect(0, 0, 10, 10)])).toBe(1);
    expect(frameCut(rect(5, 100, 50, 200), 1000, 800)).toBe(true);
    expect(frameCut(rect(100, 100, 150, 200), 1000, 800)).toBe(false);
    expect(radialOf([500, 400], 1000, 800)).toBe(0);
    expect(radialOf([1000, 800], 1000, 800)).toBeCloseTo(1);
    const band = growBand(rect(0, 100, 1000, 200), 0.12);
    expect(inside(band, [500, 90])).toBe(true);
    expect(inside(band, [500, 80])).toBe(false);
    expect(inside(rect(0, 100, 1000, 200), [500, 90])).toBe(false);
  });

  it("labels rows from the top", () => {
    expect(rowLabel(0)).toBe("0");
    expect(rowLabel(7)).toBe("6+");
    expect(rowLabel(null)).toBe("none");
    expect(lowerQuantile([5, 1, 3, 2, 4], 0.05)).toBe(1);
    expect(lowerQuantile([], 0.5)).toBeNull();
  });
});

describe("ranking", () => {
  const book = (imageId: string, rung: Book["rung"], cause: Book["all"][number]["cause"] | null, books = 1): Book => ({
    id: `${imageId}:${Math.random()}`,
    imageId,
    kind: "box",
    books,
    rung,
    primary: cause ? { cause, sub: null } : null,
    all: cause ? [{ cause, sub: null }] : [],
    elevation: null,
    case: "main",
    frame: "centre",
    row: "none",
  });
  const rows = [
    book("a", "confirmed", null),
    book("a", "matched", "single-reader"),
    book("a", "seen", "unattributed", 3),
    book("b", "text-read", "catalog-gap"),
    book("b", "text-read", "catalog-gap"),
    book("b", "spine-found", "single-reader"),
  ];
  it("counts books, weighting gaps by the books they hold", () => {
    expect(countOf(() => true)(rows)).toBe(8);
    expect(countOf(lost)(rows)).toBe(7);
  });
  it("ranks causes by books lost, largest first", () => {
    const r = rankCauses(rows, 200, 1);
    expect(r.map((x) => [x.cause, x.lost.n])).toEqual([["unattributed", 3], ["catalog-gap", 2], ["single-reader", 2]]);
    expect(r[0]!.share).toBeCloseTo(3 / 7);
    expect(ties({ n: 3, lo: 0, hi: 3 }, { n: 2, lo: 0, hi: 2 })).toBe(true);
    expect(ties({ n: 9, lo: 8, hi: 10 }, { n: 2, lo: 0, hi: 3 })).toBe(false);
  });
});
