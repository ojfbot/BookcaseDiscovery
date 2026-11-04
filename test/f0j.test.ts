// F-0j: the line crop's name and rotations, the zoner's pre-registered rules (groups, multi-book, roles, non-text
// zones), a reader's line variants as one vote, the author name test, leave one reader out and the keep rule.
// Synthetic data only.
import { describe, expect, it } from "vitest";
import { cropFor, cropName, LINE_CROP } from "../src/perceive/crop.ts";
import { assignRoles, groupLines, keptLines, multiBook, nonTextZones, type ZoneLine } from "../src/perceive/zones.ts";
import { variantsOf, type Reading } from "../src/eval/f0.ts";
import { isAuthorText, lineText, lineVariants, loroSummary, wilsonUpper, withLines, type AuthorIndex } from "../src/eval/f0j.ts";
import { planRegion, verdictOf } from "../src/eval/f0j-cli.ts";

/** A line in the reading frame: x along the spine, y across it. */
const L = (k: number, x0: number, x1: number, y0: number, y1: number, extra: Partial<ZoneLine> = {}): ZoneLine => ({
  k, x0, x1, y0, y1, h: y1 - y0, len: x1 - x0, column: false, neighbour: 0, ...extra,
});

describe("the line crop", () => {
  it("names line readings apart from every whole-crop reading", () => {
    expect(cropName(LINE_CROP)).toBe("line;h=48;clip=frame");
  });

  it("reads a line both ways round, and a column line also a quarter turned", () => {
    const cell = { polygon: [[0, 0], [199, 0], [199, 63], [0, 63]] as [number, number][] };
    expect(cropFor(cell, { width: 200, height: 64 }, LINE_CROP)!.rotations).toEqual([0, 180]);
    expect(cropFor({ ...cell, column: true }, { width: 200, height: 64 }, LINE_CROP)!.rotations).toEqual([0, 90, 180, 270]);
  });
});

describe("zoning rules", () => {
  it("drops a line another book owns more than half of", () => {
    expect(keptLines([L(0, 0, 10, 0, 5, { neighbour: 0.5 }), L(1, 0, 10, 0, 5, { neighbour: 0.51 })]).map((l) => l.k)).toEqual([0]);
  });

  it("joins words of one line of print and keeps separate lines apart", () => {
    // Two words of a title side by side, an author further along, and a second line across the spine.
    const g = groupLines([L(0, 0, 100, 10, 50), L(1, 120, 220, 12, 50), L(2, 400, 480, 15, 40), L(3, 0, 90, 70, 100)]);
    expect(g.map((x) => x.lines)).toEqual([[0, 1], [2], [3]]);
    expect(g[0]!.size).toBe(40 * 100 + 38 * 100);
  });

  it("does not join a column line to a line along the spine, or lines of very different heights", () => {
    expect(groupLines([L(0, 0, 100, 0, 40), L(1, 110, 140, 0, 40, { column: true })]).length).toBe(2);
    expect(groupLines([L(0, 0, 100, 0, 40), L(1, 110, 140, 10, 30)]).length).toBe(2);
  });

  it("flags a second title-sized group well apart across the spine as multi-book, but not a stacked two-line title", () => {
    const twoBooks = groupLines([L(0, 0, 300, 0, 40), L(1, 0, 280, 90, 130)]);
    expect(multiBook(twoBooks)).toBe(true);
    const stacked = groupLines([L(0, 0, 300, 0, 40), L(1, 0, 280, 50, 90)]);
    expect(multiBook(stacked)).toBe(false);
    const small = groupLines([L(0, 0, 300, 0, 40), L(1, 0, 100, 90, 130)]);
    expect(multiBook(small)).toBe(false);
  });

  it("assigns title, author and imprint in the pre-registered order", () => {
    // Length 1,000: title in the middle, a name-like group, a small group at the far end.
    const g = groupLines([L(0, 300, 700, 10, 60), L(1, 720, 840, 15, 45), L(2, 900, 990, 20, 40)]);
    const author = g.findIndex((x) => x.lines.includes(1));
    const r = assignRoles(g, 1000, (i) => i === author);
    expect(g[r.title!]!.lines).toEqual([0]);
    expect(g[r.author!]!.lines).toEqual([1]);
    expect(r.imprint.map((i) => g[i]!.lines)).toEqual([[2]]);
    expect(r.unassigned).toEqual([]);
    // Without a name-like group the end group is still the imprint and the middle one unassigned.
    const r2 = assignRoles(g, 1000, () => false);
    expect(r2.author).toBeNull();
    expect(r2.unassigned.map((i) => g[i]!.lines)).toEqual([[1]]);
  });

  it("marks an imprint mark and cover art from edges outside the text, reported only", () => {
    const p = { ends: [0.09, 0.02] as [number, number], windows: [[0.2, 0], [0.2, 0.05], [0.01, 0.5], [0.3, 0.5]] as [number, number][], window: 100, step: 50 };
    const z = nonTextZones(p, 400);
    expect(z.imprintLogo).toEqual([true, false]);
    expect(z.artShare).toBeCloseTo(150 / 400);
    expect(z.art).toBe(true);
  });

  it("plans a region: lines in reading order, not read when multi-book or empty", () => {
    const line = (k: number, x0: number, x1: number, y0: number, y1: number) => ({ ...L(k, x0, x1, y0, y1), quad: [], angle: 0, scale: 1, page: "p~p0", cell: k, rect: [0, 0, 1, 1] as [number, number, number, number] });
    const z = { id: "p:0", frame: { W: 1000, H: 140, rot: 90 }, lines: [line(0, 500, 700, 10, 60), line(1, 100, 400, 10, 60)], noise: 0, contrast: 100, profile: { ends: [null, null] as [null, null], windows: [], window: 140, step: 70 }, seconds: 0 };
    const plan = planRegion(z);
    expect(plan.read).toBe(true);
    expect(plan.order).toEqual(["p~p0:1", "p~p0:0"]);
    expect(planRegion({ ...z, lines: [] }).read).toBe(false);
    expect(planRegion({ ...z, lines: [line(0, 0, 300, 0, 40), line(1, 0, 280, 90, 130)] }).read).toBe(false);
  });
});

describe("a reader's line variants", () => {
  const read = (texts: Record<number, [string, number]>): Reading => ({ id: "x", reader: "vision", variants: Object.entries(texts).map(([rot, [text, confidence]]) => ({ rotation: Number(rot), text, confidence })), seconds: 0 });

  it("builds every line at 0°, every line at 180° in reverse, and each at its best rotation", () => {
    const reads: Record<string, Reading> = { a: read({ 0: ["THE SILENT", 0.9], 180: ["1N3TIS", 0.2] }), b: read({ 0: ["ZRATS", 0.1], 180: ["STARS", 0.8] }) };
    expect(lineVariants(["a", "b"], (id) => reads[id])).toEqual(["THE SILENT ZRATS", "STARS 1N3TIS", "THE SILENT STARS"]);
    expect(lineText(reads.a, 180)).toEqual({ text: "1N3TIS", confidence: 0.2 });
  });

  it("adds them to the whole-crop reading: one reading, one retrieval, one vote", () => {
    const whole: Reading = { id: "x", reader: "ppocr", variants: [{ rotation: 90, text: "the silent", confidence: 0.7 }], seconds: 1 };
    const r = withLines(whole, ["the silent stars"], "ppocr", "x")!;
    expect(variantsOf(r)).toEqual(["the silent", "the silent stars"]);
    expect(withLines(undefined, ["stars"], "vision", "x")!.reader).toBe("vision");
    expect(withLines(whole, [], "ppocr", "x")).toBe(whole);
  });
});

describe("the author name test", () => {
  const ix: AuthorIndex = {
    forms: new Set(["ursula k le guin", "guin ursula k le", "gregory benford", "benford gregory"]),
    surname: new Map([["benford", 30], ["guin", 80], ["green", 40]]),
    titleWord: new Map([["green", 900], ["benford", 0], ["stars", 400]]),
  };

  it("accepts a catalog name form, given-first or surname-first, inside the text", () => {
    expect(isAuthorText(ix, "by Gregory Benford")).toBe(true);
    expect(isAuthorText(ix, "BENFORD, GREGORY")).toBe(true);
  });

  it("accepts a short group ending in a surname, unless the word is mostly a title word", () => {
    expect(isAuthorText(ix, "G. Benford")).toBe(true);
    expect(isAuthorText(ix, "Green")).toBe(false);
    expect(isAuthorText(ix, "the silent stars")).toBe(false);
  });
});

describe("leave one reader out and the keep rule", () => {
  it("bounds the share of accepts that switch to another work", () => {
    const s = loroSummary(["same", "same", "none", "other"]);
    expect(s).toMatchObject({ cases: 4, same: 2, other: 1, none: 1, otherShare: 0.25 });
    expect(wilsonUpper(0, 100)!).toBeCloseTo(0.037, 3);
    expect(wilsonUpper(0, 0)).toBeNull();
  });

  it("ships an arm only when every pre-registered condition holds", () => {
    const loro = { otherShare: 0.02 };
    const pilot = { arms: { a: { all: { confirmed: { lo: 0.1 } }, distinctConfirmedWorks: { delta: { value: 3 } }, loro } } };
    const yard = { arms: { a: { all: { confirmed: { hi: 0.5 }, wrong: { lo: -0.2 } }, loro } } };
    expect(verdictOf({ "pilot-000": pilot, "yardstick-library-b2": yard }, "a")!.keep).toBe(true);
    const flat = { arms: { a: { ...pilot.arms.a, all: { confirmed: { lo: 0 } } } } };
    expect(verdictOf({ "pilot-000": flat, "yardstick-library-b2": yard }, "a")!.keep).toBe(false);
    const switches = { arms: { a: { ...yard.arms.a, loro: { otherShare: 0.06 } } } };
    expect(verdictOf({ "pilot-000": pilot, "yardstick-library-b2": switches }, "a")!.leaveOneReaderOut).toBe(false);
    expect(verdictOf({ "pilot-000": pilot }, "a")).toBeNull();
  });
});
