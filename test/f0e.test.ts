// F-0e piece measures on synthetic polygons only (no photo, no detection output).
import { describe, expect, it } from "vitest";
import type { Candidate } from "../src/catalog/retrieve.ts";
import { CASE_TILING, SHELF_TILING, stackFor, tilingName, type Detection, type SpineDecision } from "../src/eval/f0.ts";
import {
  agreementChange,
  bandHeight,
  boxRows,
  boxesPerBand,
  diagnose,
  fitsTileRow,
  geometry,
  measure,
  pairedDelta,
  pairedRatio,
  pieceShares,
  rungCounts,
  stacked,
  tileStarts,
  type RungCounts,
} from "../src/eval/f0e.ts";
import type { Polygon4 } from "../src/eval/labels.ts";

/** Axis-aligned box as a clockwise polygon from its top-left corner. */
const box = (x: number, y: number, w: number, h: number): Polygon4 => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

/** The same box turned by `deg` about its centre. */
const turned = (x: number, y: number, w: number, h: number, deg: number): Polygon4 => {
  const cx = x + w / 2, cy = y + h / 2, a = (deg * Math.PI) / 180;
  return box(x, y, w, h).map(([px, py]) => [cx + (px - cx) * Math.cos(a) - (py - cy) * Math.sin(a), cy + (px - cx) * Math.sin(a) + (py - cy) * Math.cos(a)]) as Polygon4;
};

const det = (spines: { polygon: Polygon4; cut?: boolean }[], bands: { polygon: Polygon4; spines: number; span: number; gap: number }[], medianWidth = 100): Detection => ({
  id: "synthetic",
  width: 4000,
  height: 3000,
  spines: spines.map((s) => ({ polygon: s.polygon, boxScore: 0.5, maskScore: 0.9, aspect: 5, cut: s.cut ?? false })),
  bands,
  gaps: { bandLength: 0, gapLength: 0, gapCount: 0, medianWidth },
  tiles: 1,
  seconds: 10,
});

describe("geometry", () => {
  it("measures an upright box", () => {
    const g = geometry(box(100, 200, 80, 1000));
    expect(g.long).toBe(1000);
    expect(g.short).toBe(80);
    expect(g.tilt).toBe(0);
    expect([g.top, g.bottom, g.left, g.right]).toEqual([200, 1200, 100, 180]);
  });

  it("measures the lean of a tilted box and points its axis down the image", () => {
    const g = geometry(turned(0, 0, 80, 1000, 20));
    expect(g.tilt).toBeCloseTo(20, 6);
    expect(g.uy).toBeGreaterThan(0);
    expect(geometry(turned(0, 0, 80, 1000, 80)).tilt).toBeCloseTo(80, 6);
  });

  it("takes a band's height from its side closer to vertical, wide or tall", () => {
    expect(bandHeight(box(0, 0, 3000, 1200))).toBe(1200);
    expect(bandHeight(box(0, 0, 300, 1200))).toBe(1200);
  });
});

describe("stacked: pieces of one spine end to end in one column", () => {
  const top = geometry(box(100, 0, 80, 500));
  it("joins pieces that touch or barely overlap", () => {
    expect(stacked(top, geometry(box(100, 500, 80, 500)), 25)).toBe(true);
    expect(stacked(top, geometry(box(104, 520, 76, 480)), 25)).toBe(true);
    expect(stacked(top, geometry(box(100, 450, 80, 500)), 25)).toBe(true);
  });

  it("follows a tilted spine's own axis", () => {
    const a = turned(0, 0, 80, 1000, 15);
    // the two halves of that spine, cut across its axis
    const v = [Math.sin((15 * Math.PI) / 180), Math.cos((15 * Math.PI) / 180)];
    const half = (s: number): Polygon4 => {
      const g = geometry(a);
      const c = [g.cx - v[0]! * 250 * s, g.cy + v[1]! * 250 * s];
      return turned(c[0]! - 40, c[1]! - 250, 80, 500, 15);
    };
    expect(stacked(geometry(half(-1)), geometry(half(1)), 25)).toBe(true);
  });

  it("keeps neighbours, far pieces, nested boxes and different leans apart", () => {
    expect(stacked(top, geometry(box(180, 0, 80, 500)), 25)).toBe(false); // side by side
    expect(stacked(top, geometry(box(100, 600, 80, 500)), 25)).toBe(false); // 100 px gap: across a shelf board
    expect(stacked(top, geometry(box(105, 100, 70, 200)), 25)).toBe(false); // nested: a label block
    expect(stacked(top, geometry(turned(100, 500, 80, 500, 25)), 25)).toBe(false); // leans another way
  });
});

describe("piece measures on one synthetic photo", () => {
  // One shelf band 1000 px tall: three whole spines, one spine found as two stacked pieces (one cut by a tile
  // edge), a label block inside a whole spine, and one book lying flat.
  const band = { polygon: box(0, 1000, 1000, 1000), spines: 7, span: 1000, gap: 0 };
  const d = det(
    [
      { polygon: box(0, 1000, 100, 950) },
      { polygon: box(100, 1000, 100, 980) },
      { polygon: box(200, 1000, 100, 960) },
      { polygon: box(300, 1000, 100, 450), cut: true },
      { polygon: box(300, 1450, 100, 520) },
      { polygon: box(120, 1300, 60, 200) },
      { polygon: box(500, 1850, 400, 100) },
    ],
    [band],
  );

  it("flags each box", () => {
    const rows = boxRows(d);
    expect(rows.map((r) => r.upright)).toEqual([true, true, true, true, true, true, false]);
    expect(rows.map((r) => r.partial)).toEqual([false, false, false, true, true, true, false]);
    expect(rows.map((r) => r.touching)).toEqual([false, false, false, true, true, false, false]);
    expect(rows.map((r) => r.inside)).toEqual([false, false, false, false, false, true, false]);
  });

  it("judges partial height against the band's spine height too, which a stretched band polygon does not inflate", () => {
    const stretched = { ...d, bands: [{ ...band, polygon: box(0, 600, 1000, 1800) }] };
    expect(boxRows(stretched).filter((r) => r.partial).length).toBe(6); // every upright box looks partial
    expect(boxRows(stretched).map((r) => r.partialSpine)).toEqual([false, false, false, true, true, true, false]);
  });

  it("gives per-photo shares", () => {
    const p = pieceShares(d);
    expect(p.boxes).toBe(7);
    expect(p.cut).toBeCloseTo(1 / 7);
    expect(p.partial).toBeCloseTo(3 / 6); // upright boxes in a band
    expect(p.touching).toBeCloseTo(2 / 6);
    expect(p.inside).toBeCloseTo(1 / 7);
  });

  it("counts boxes per band against the median spine width", () => {
    expect(boxesPerBand(d)).toEqual([0.7]); // 7 boxes where 1000 px at 100 px a spine holds 10
    expect(boxesPerBand(det([], [{ ...band, spines: 20 }]))).toEqual([2]); // stacked pieces push it above 1
  });
});

describe("tiling: does a band fit one tile row?", () => {
  it("lays tiles out as detect.py does", () => {
    expect(tileStarts(1500, 1600, 700)).toEqual([0]);
    expect(tileStarts(3000, 1600, 700)).toEqual([0, 900, 1400]);
    expect(tileStarts(7362, 2600, 1900)).toEqual([0, 700, 1400, 2100, 2800, 3500, 4200, 4762]);
  });

  it("fits a band no taller than the overlap anywhere, and a taller one only where a row happens to hold it", () => {
    for (let top = 0; top < 6000; top += 37) expect(fitsTileRow(top, top + 700, 7362, 1600, 700)).toBe(true);
    expect(fitsTileRow(950, 2450, 7362, 1600, 700)).toBe(true); // inside the row from 900 to 2500
    expect(fitsTileRow(500, 2000, 7362, 1600, 700)).toBe(false); // cut by every row
    for (let top = 0; top < 5000; top += 37) expect(fitsTileRow(top, top + 1900, 7362, 1600, 700)).toBe(false);
    for (let top = 0; top < 5400; top += 37) expect(fitsTileRow(top, top + 1900, 7362, 2600, 1900)).toBe(true);
  });
});

describe("machine agreement before and after (INV-17: agreement, never accuracy)", () => {
  const dec = (imageId: string, i: number, o: { text?: boolean; bar?: string | null; accepted?: string | null }): SpineDecision => ({
    id: `${imageId}:${i}`,
    imageId,
    boxScore: 0.5,
    confirmed: { vision: o.bar ?? null, ppocr: o.accepted ?? null },
    top: { vision: o.bar ?? null, ppocr: o.accepted ?? null },
    readText: { vision: o.text ?? false },
    accepted: o.accepted ? ({ workId: o.accepted } as Candidate) : null,
    agreeing: o.accepted ? ["vision", "ppocr"] : [],
    reason: o.accepted ? null : o.text ? "single-reader" : "no-text",
    hard: !o.accepted,
  });

  it("counts boxes at each rung and distinct confirmed works per photo", () => {
    const rows = rungCounts([
      dec("a", 0, { text: true, bar: "w1", accepted: "w1" }),
      dec("a", 1, { text: true, bar: "w1", accepted: "w1" }), // two pieces of one book: one work
      dec("a", 2, { text: true, bar: "w2" }),
      dec("a", 3, { text: true }),
      dec("a", 4, {}),
    ]);
    expect(rows).toEqual([{ imageId: "a", boxes: 5, textPresent: 4, textRead: 3, confirmed: 2, works: 1 }]);
  });

  it("reports the arm minus base with a paired photo interval", () => {
    const base: RungCounts[] = ["a", "b", "c"].map((imageId) => ({ imageId, boxes: 10, textPresent: 6, textRead: 4, confirmed: 2, works: 2 }));
    const arm: RungCounts[] = base.map((r) => ({ ...r, boxes: 8, confirmed: 3, works: 3 }));
    const c = agreementChange(base, arm);
    expect(c.delta.worksPerPhoto).toEqual([1, 1, 1]);
    expect(c.delta.boxesPerPhoto).toEqual([-2, -2, -2]);
    expect(c.base.confirmedShare).toBe(0.2);
    expect(c.arm.confirmedShare).toBe(0.375);
    expect(pairedDelta(base, [], (rs) => rs.length)).toBeNull();
  });
});

describe("measure and diagnose: aggregates only", () => {
  const band = { polygon: box(0, 0, 1000, 1000), spines: 3, span: 1000, gap: 700 };
  const photo = (id: string, cut: boolean): Detection => ({
    ...det([{ polygon: box(0, 0, 100, 950) }, { polygon: box(100, 0, 100, 400), cut }, { polygon: box(100, 400, 100, 540) }], [band]),
    id,
  });

  it("pools shares over photos with intervals and keeps no per-box data", () => {
    const m = measure([photo("a", true), photo("b", false)]);
    expect(m.photos).toBe(2);
    expect(m.pooled.cut![0]).toBeCloseTo(1 / 6, 4);
    expect(m.pooled.partial![0]).toBeCloseTo(4 / 6, 4);
    expect(m.pooled.touching![0]).toBeCloseTo(4 / 6, 4);
    expect(JSON.stringify(m)).not.toMatch(/"a"|"b"|polygon/);
  });

  it("compares the same photos under two arms by a paired ratio", () => {
    const longer = (p: Detection): Detection => ({ ...p, spines: p.spines.map((s) => ({ ...s, polygon: box(geometry(s.polygon).left, 0, 100, 2 * geometry(s.polygon).long) })) });
    const base = [photo("a", true), photo("b", false)];
    const m = measure(base.map(longer), base);
    expect(m.vsBase!.uprightLong).toEqual([2, 2, 2]);
    expect(m.vsBase!.boxes).toEqual([1, 1, 1]);
    expect(pairedRatio([], [], () => 1)).toBeNull();
  });

  it("splits cut and partial shares by whether the band fits one tile row", () => {
    const d = diagnose([{ ...photo("a", true), height: 3000 }], 1600, 700);
    expect(d.byFit.find((f) => f.bandFitsOneTileRow)!.boxes).toBe(3);
    expect(d.byFit.find((f) => !f.bandFitsOneTileRow)!.boxes).toBe(0);
    expect(d.partialCauses.map((c) => c.cause)).toEqual(["cut", "inside", "stacked", "alone"]);
  });
});

describe("the shipped whole-case tiling names itself in the provenance", () => {
  it("names tall tiles and post steps as detect.py does, and square grids as before", () => {
    expect(tilingName(CASE_TILING)).toBe("1600x2600/700x1900 +strips");
    expect(tilingName(SHELF_TILING)).toBe("3100/1300");
    expect(tilingName({ ...SHELF_TILING, post: ["strips", "extend"] })).toBe("3100/1300 +strips +extend");
  });

  it("holds every pilot-000 band up to 1900 px whole in one tile row", () => {
    const t = CASE_TILING;
    for (const height of [5984, 7362, 7882, 8064]) {
      for (let top = 0; top + 1900 <= height; top += 53) expect(fitsTileRow(top, top + 1900, height, t.tileH!, t.overlapY!)).toBe(true);
    }
  });

  it("puts the tiling in the box producer's provenance for each scope", () => {
    expect(stackFor("b2", "pilot").boxProducer).toMatch(/; tiling 1600x2600\/700x1900 \+strips$/);
    expect(stackFor("b2", "yardstick").boxProducer).toMatch(/; tiling 3100\/1300$/);
  });
});
