// F-0c box kinds and cover reading on synthetic polygons and made-up strings only (no photo, no detection output).
import { describe, expect, it } from "vitest";
import { buildLabelSet, type Detection } from "../src/eval/f0.ts";
import { LabelSet } from "../src/eval/labels.ts";
import { area, COVER, coverReading, coverText, intersectionArea, kinds, NOT_A_BOOK, readBoxes } from "../src/eval/f0c.ts";
import { verdicts } from "../src/eval/f0c-cli.ts";
import type { Polygon4 } from "../src/eval/labels.ts";
import { COVER_CROP, coverRotations, cropFor, cropName } from "../src/perceive/crop.ts";

const box = (x: number, y: number, w: number, h: number): Polygon4 => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

/** A shelf of upright 100 x 1000 spines from x = 0, with a band around them and optional extra spine-path boxes and covers. */
function shelf(n: number, extra: Polygon4[] = [], covers: Polygon4[] = []): Detection {
  const spines = [...Array.from({ length: n }, (_, i) => box(i * 100, 0, 100, 1000)), ...extra];
  return {
    id: "synthetic",
    width: 8000,
    height: 3000,
    spines: spines.map((polygon) => ({ polygon, boxScore: 0.5, maskScore: 0.9, aspect: 5, cut: false })),
    covers: covers.map((polygon) => ({ polygon, boxScore: 0.4, maskScore: 0.9, aspect: 1.5, cut: false })),
    bands: [{ polygon: box(0, 0, 7000, 1000), spines: n, span: 7000, gap: 0 }],
    gaps: { bandLength: 7000, gapLength: 0, gapCount: 0, medianWidth: 100 },
    tiles: 1,
    seconds: 1,
  };
}

describe("convex intersection", () => {
  it("measures overlap of two rectangles, either winding", () => {
    expect(area(box(0, 0, 10, 20))).toBe(200);
    expect(intersectionArea(box(0, 0, 10, 10), box(5, 5, 10, 10))).toBeCloseTo(25);
    expect(intersectionArea(box(0, 0, 10, 10), [...box(5, 5, 10, 10)].reverse() as Polygon4)).toBeCloseTo(25);
    expect(intersectionArea(box(0, 0, 10, 10), box(20, 0, 5, 5))).toBe(0);
    expect(intersectionArea(box(0, 0, 10, 10), box(2, 2, 3, 3))).toBeCloseTo(9);
  });
});

describe("box kinds", () => {
  it("keeps a portrait cover beside the shelf and absorbs the slivers on it", () => {
    // A 650 x 1000 cover at x 2000..2650 past a 20-spine shelf, with two spine-path slivers on its edges.
    const cover = box(2000, 0, 650, 1000);
    const k = kinds(shelf(20, [box(2000, 0, 80, 1000), box(2570, 0, 80, 1000)], [cover]));
    expect(k.covers.map((c) => c.kind)).toEqual(["face-out"]);
    expect(k.spines.filter((b) => b.why === "absorbed").map((b) => b.absorbedBy)).toEqual(["c0", "c0"]);
    expect(k.spines.filter((b) => b.kind === "spine")).toHaveLength(20);
    // The readers see the 20 spines and the cover: one book, one box.
    expect(readBoxes(k)).toHaveLength(21);
  });

  it("drops a cover-prompt box that is a group of spines shelved side by side", () => {
    const k = kinds(shelf(20, [], [box(300, 0, 650, 1000)]));
    expect(k.covers).toHaveLength(0);
    expect(k.dropped.map((d) => d.why)).toEqual(["cover-group"]);
    expect(k.spines.every((b) => b.kind === "spine")).toBe(true);
  });

  it("drops boxes that are not cover-shaped or sized", () => {
    const k = kinds(shelf(20, [], [box(3000, 0, 950, 1000), box(3000, 1200, 120, 180), box(4000, 0, 1400, 2400)]));
    expect(k.covers).toHaveLength(0);
    expect(k.dropped.map((d) => d.why)).toEqual(["cover-shape", "cover-shape", "cover-shape"]);
  });

  it("flags a flat box spanning several books (a shelf lip) and a thin flat strip, not a book lying on the shelf", () => {
    const lip = box(0, 1000, 2000, 60); // flat, two spine heights long
    const lying = box(2100, 800, 900, 150); // flat, a book's height long
    const strip = box(3100, 900, 300, 40); // flat, short and thin
    const k = kinds(shelf(20, [lip, lying, strip]));
    expect(k.spines.slice(20).map((b) => [b.kind, b.why])).toEqual([
      ["not-a-book", "spans-books"],
      ["spine", "spine"],
      ["not-a-book", "flat-strip"],
    ]);
  });

  it("flags a box holding a row of face-out covers", () => {
    const covers = [box(3000, 0, 650, 1000), box(3700, 0, 650, 1000)];
    const k = kinds(shelf(20, [box(2950, 50, 1450, 400)], covers));
    expect(k.covers).toHaveLength(2);
    expect(k.spines[20]!.why).toBe("cover-row");
  });

  it("with the cover pass off only the not-a-book rules apply", () => {
    const d = shelf(20, [box(0, 1000, 2000, 60)]);
    delete d.covers;
    const k = kinds(d);
    expect(k.covers).toHaveLength(0);
    expect(k.spines.map((b) => b.kind).filter((x) => x !== "spine")).toEqual(["not-a-book"]);
  });

  it("keeps its thresholds where the pre-registration put them", () => {
    expect(COVER).toMatchObject({ minShortOverLong: 0.5, maxShortOverLong: 0.9, minWidths: 1.5, maxLongOverSpine: 2, groupShare: 0.5, absorb: 0.6 });
    expect(NOT_A_BOOK).toMatchObject({ flatDeg: 60, maxFlatOverSpine: 1.5, minFlatOverSpine: 0.35, thinWidths: 0.6, coverRowShare: 0.3 });
  });
});

describe("cover crop", () => {
  it("reads a portrait cover as it stands and a landscape one at 90 and 270, clipped to the frame", () => {
    expect(coverRotations(box(0, 0, 600, 1000))).toEqual([0]);
    expect(coverRotations(box(0, 0, 1000, 600))).toEqual([90, 270]);
    const c = cropFor({ polygon: box(-100, 0, 700, 1000) }, { width: 4000, height: 3000 }, COVER_CROP)!;
    expect(c.crop).toBe("rect;rot=cover;clip=frame");
    expect(cropName(COVER_CROP)).toBe(c.crop);
    expect(Math.min(...c.polygon.map((p) => p[0]))).toBeGreaterThanOrEqual(0);
    expect(c.rotations).toEqual([0]);
  });
});

describe("cover text", () => {
  it("parses Qwen's labelled answer and sends only title and author to the catalog", () => {
    expect(coverText("Title: The Glass Orchard\nAuthor: Ana Example\nImprint: Sample Books")).toEqual({
      title: "The Glass Orchard",
      author: "Ana Example",
      imprint: "Sample Books",
      text: "The Glass Orchard Ana Example",
    });
    expect(coverText("**Title:** Lantern\n**Author:** none\n**Imprint:** N/A")).toMatchObject({ title: "Lantern", author: "", imprint: "", text: "Lantern" });
    expect(coverText("unreadable").text).toBe("");
    expect(coverText("LANTERN A NOVEL").text).toBe("LANTERN A NOVEL");
  });

  it("rewrites Qwen readings only", () => {
    const qwen = { reader: "qwen", variants: [{ text: "Title: Lantern\nAuthor: Ana Example\nImprint: none" }] };
    const vision = { reader: "vision", variants: [{ text: "LANTERN\nA NOVEL" }] };
    expect(coverReading(qwen).variants[0]!.text).toBe("Lantern Ana Example");
    expect(coverReading(vision)).toBe(vision);
  });
});

describe("keep rules", () => {
  const set = (works: [number, number, number], filterWorks: [number, number, number]) => ({
    arms: { covers: { delta: { worksPerPhoto: works } }, filter: { delta: { worksPerPhoto: filterWorks } } },
  });
  const yard = (hits: [number, number, number], wrong: [number, number, number], precision: [number, number, number]) => {
    const arm = { hitsPerImage: hits, wrongPerImage: wrong, delta: { recall: [0, 0, 0], precision } };
    return { yardstickTitles: { arms: { covers: arm, filter: arm, full: arm } } };
  };
  it("ships the cover pass only on a pilot lift with an unhurt yardstick", () => {
    expect(verdicts(set([0.5, 0.2, 0.8], [0, -0.1, 0.1]), yard([0, -0.1, 0.1], [0, -0.1, 0.1], [0, -0.01, 0.01])).coverPass.ship).toBe(true);
    expect(verdicts(set([0.5, -0.1, 0.8], [0, -0.1, 0.1]), yard([0, -0.1, 0.1], [0, -0.1, 0.1], [0, -0.01, 0.01])).coverPass.ship).toBe(false);
    expect(verdicts(set([0.5, 0.2, 0.8], [0, -0.1, 0.1]), yard([0, -0.1, 0.1], [0.2, 0.1, 0.3], [0, -0.01, 0.01])).coverPass.ship).toBe(false);
  });
  it("holds the filter to no harm", () => {
    expect(verdicts(set([0, 0, 0], [-0.1, -0.3, 0.1]), yard([0, -0.1, 0.1], [0, -0.1, 0.1], [0, -0.01, 0.01])).notABookFilter.ship).toBe(true);
    expect(verdicts(set([0, 0, 0], [-0.2, -0.3, -0.1]), yard([0, -0.1, 0.1], [0, -0.1, 0.1], [0, -0.01, 0.01])).notABookFilter.ship).toBe(false);
  });
});

describe("labels", () => {
  it("labels a flagged box not-a-book with its rule, and leaves every box a spine without kinds", () => {
    const d = shelf(3, [box(0, 1000, 2000, 60)]);
    const images = [{ id: "synthetic", photoHash: "0".repeat(64), path: "", setting: "real-use" }];
    const k = kinds(d);
    const withKinds = LabelSet.parse(buildLabelSet("s", images, new Map([["synthetic", d]]), new Map(), (_, i) => k.spines[i]!));
    expect(withKinds.photos[0]!.spines.map((s) => s.kind)).toEqual(["spine", "spine", "spine", "not-a-book"]);
    expect(withKinds.photos[0]!.spines[3]!.notes).toBe("machine:not-a-book rule=spans-books");
    const plain = buildLabelSet("s", images, new Map([["synthetic", d]]), new Map());
    expect(plain.photos[0]!.spines.every((s) => s.kind === "spine")).toBe(true);
  });
});
