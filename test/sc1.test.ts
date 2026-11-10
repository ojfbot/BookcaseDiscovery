import { describe, expect, it } from "vitest";
import {
  asRowContext,
  classify,
  combine,
  dividerSide,
  familyAgrees,
  genrePairs,
  inRange,
  letterPairs,
  needsQwen,
  orderCounts,
  parseQwen,
  permuted,
  regionOf,
  rowContext,
  scopeOf,
  shuffleControl,
  workFamilies,
  type MeasureRow,
  type ReaderText,
  type ScopedCue,
  type ScopeRow,
} from "../src/eval/sc1.ts";
import { rng } from "../src/eval/q1.ts";

const v = (text: string, confidence = 1): ReaderText => ({ reader: "vision", text, confidence });
const p = (text: string, confidence = 1): ReaderText => ({ reader: "ppocr", text, confidence });

describe("classify", () => {
  it("reads sections, families first-match", () => {
    expect(classify("Science Fiction & Fantasy")).toMatchObject({ cls: "section", family: "sf-fantasy" });
    expect(classify("SCIENCE FICTION")).toMatchObject({ cls: "section", family: "sf" });
    expect(classify("Mystery & Thrillers")).toMatchObject({ cls: "section", family: "mystery" });
    expect(classify("Biography")).toMatchObject({ cls: "section", family: "nonfiction", section: "biograph" });
    expect(classify("Fiction")).toMatchObject({ cls: "section", family: "literature" });
  });
  it("reads an ordering rule, keeping the section", () => {
    const c = classify("Science Fiction/Fantasy (Alphabetical by Author)");
    expect(c).toMatchObject({ cls: "ordering", ordering: "author-alphabetical", family: "sf-fantasy" });
  });
  it("reads letter ranges and dividers", () => {
    expect(classify("A - C")).toMatchObject({ cls: "letter", range: ["a", "c"], divider: null });
    expect(classify("Ma to Mc")).toMatchObject({ cls: "letter", range: ["ma", "mc"] });
    expect(classify("Fiction A–F")).toMatchObject({ cls: "letter", range: ["a", "f"], family: "literature" });
    expect(classify("M")).toMatchObject({ cls: "letter", divider: "m", range: null });
    expect(classify("Mc")).toMatchObject({ cls: "letter", divider: "mc" });
  });
  it("does not read a range in ordinary words", () => {
    expect(classify("X-Men").range).toBeNull();
    expect(classify("Sci-Fi").range).toBeNull();
    expect(classify("The").divider).toBeNull();
    expect(classify("C - A").range).toBeNull(); // reversed is not a range
  });
  it("puts promotions and prices first, with no fields", () => {
    expect(classify("Staff Picks: Fantasy")).toEqual({ cls: "promotion", family: null, section: null, ordering: null, range: null, divider: null });
    expect(classify("If you liked this, now try")).toMatchObject({ cls: "promotion" });
    expect(classify("Bestsellers")).toMatchObject({ cls: "promotion" });
    expect(classify("$12.99")).toMatchObject({ cls: "price" });
    expect(classify("Information")).toMatchObject({ cls: "other" });
  });
});

describe("combine", () => {
  it("agreeing readers give full confidence", () => {
    const u = combine([v("Horror", 0.8), p("HORROR", 1)]);
    expect(u).toMatchObject({ cls: "section", family: "horror", dropped: null, confidence: 0.9 });
    expect(u.agreeing.sort()).toEqual(["ppocr", "vision"]);
  });
  it("one reader gives half", () => {
    expect(combine([v("Horror", 1), p("xq", 1)])).toMatchObject({ cls: "section", confidence: 0.5, dropped: null });
  });
  it("any promotion or price vetoes the unit", () => {
    expect(combine([v("Fantasy"), p("Staff pick fantasy")]).dropped).toBe("promotion");
    expect(combine([v("Fantasy"), p("$4.99")]).dropped).toBe("price");
  });
  it("two local readers naming different classes drop the unit, unless Qwen breaks the tie", () => {
    expect(combine([v("Fantasy"), p("A - C")]).dropped).toBe("disagree");
    const q: ReaderText = { reader: "qwen", text: "Fantasy", confidence: 1, kind: "section" };
    expect(combine([v("Fantasy"), p("A - C"), q])).toMatchObject({ cls: "section", dropped: null, confidence: 1 });
  });
  it("a divider needs two readers on the same letter", () => {
    expect(combine([v("M"), p("M")])).toMatchObject({ cls: "letter", divider: "m", dropped: null });
    expect(combine([v("M"), p("")]).dropped).toBe("lone-divider");
    expect(combine([v("M"), p("N")]).dropped).toBe("lone-divider");
  });
  it("drops under the confidence floor", () => {
    expect(combine([v("Horror", 0.5), p("zz", 0.5)]).dropped).toBe("low-confidence");
  });
  it("keeps Qwen's wording for a section the lexicon cannot map", () => {
    const u = combine([v("Wyrd Tales"), { reader: "qwen", text: "Wyrd Tales", confidence: 1, kind: "section" }]);
    expect(u).toMatchObject({ cls: "section", section: "wyrd tales", family: null, confidence: 0.5 });
  });
});

describe("needsQwen and parseQwen", () => {
  it("asks only where the local readers leave the class open", () => {
    expect(needsQwen([v("Fantasy"), p("Fantasy")])).toBe(false);
    expect(needsQwen([v("Fantasy"), p("A - C")])).toBe(true);
    expect(needsQwen([v("Fantasy"), p("")])).toBe(true);
    expect(needsQwen([v("Wyrd Tales"), p("Wyrd Tales")])).toBe(true);
    expect(needsQwen([v("ab"), p("ab")])).toBe(false);
    expect(needsQwen([v("Sale"), p("Fantasy")])).toBe(false);
  });
  it("parses KIND | TEXT", () => {
    expect(parseQwen("section | Horror")).toEqual({ kind: "section", text: "Horror" });
    expect(parseQwen("Letters | A - C\n")).toEqual({ kind: "letter", text: "A - C" });
    expect(parseQwen("unreadable")).toEqual({ kind: null, text: "" });
  });
});

const row = (key: string, left: number, right: number, bottom: number, height = 100): ScopeRow => ({ key, left, right, bottom, height });

describe("regions and scope", () => {
  const rows = [row("r0", 0, 1000, 200), row("r1", 0, 1000, 500)];
  it("names the region", () => {
    expect(regionOf({ left: 10, right: 50, top: 150, bottom: 170 }, { inNotABook: true, lipShare: 0 }, rows)).toBe("not-a-book");
    expect(regionOf({ left: 10, right: 50, top: 205, bottom: 220 }, { inNotABook: false, lipShare: 0.7 }, rows)).toBe("lip");
    expect(regionOf({ left: 10, right: 50, top: 150, bottom: 170 }, { inNotABook: false, lipShare: 0.1 }, rows)).toBe("gap");
    expect(regionOf({ left: 10, right: 50, top: 10, bottom: 30 }, { inNotABook: false, lipShare: null }, rows)).toBe("free");
  });
  it("a strip on a lip covers the row above it", () => {
    expect(scopeOf({ left: 100, right: 600, top: 210, bottom: 230 }, "lip", null, { divider: null }, rows)).toEqual({ level: "row", rows: ["r0"] });
  });
  it("a divider marks the row it stands in or sits just above or below", () => {
    expect(scopeOf({ left: 300, right: 320, top: 140, bottom: 160 }, "gap", null, { divider: "m" }, rows)).toEqual({ level: "divider", rows: ["r0"], x: 310 });
    expect(scopeOf({ left: 300, right: 320, top: 205, bottom: 215 }, "lip", null, { divider: "m" }, rows)).toEqual({ level: "divider", rows: ["r0"], x: 310 });
    expect(scopeOf({ left: 1300, right: 1320, top: 140, bottom: 160 }, "free", null, { divider: "m" }, rows)).toBeNull();
  });
  it("an end-cap sign covers the rows below it in its case", () => {
    expect(scopeOf({ left: 300, right: 700, top: 0, bottom: 40 }, "free", null, { divider: null }, rows)).toEqual({ level: "case", rows: ["r0", "r1"] });
    expect(scopeOf({ left: 2300, right: 2400, top: 0, bottom: 40 }, "free", null, { divider: null }, rows)).toBeNull();
  });
});

const unit = (text: string[]): ReturnType<typeof combine> => combine(text.map((t, i) => (i ? p(t) : v(t))));
const sc = (c: ReturnType<typeof combine>, level: ScopedCue["level"], x?: number): ScopedCue => ({ unit: "u", region: "lip", level, cue: c, x });

describe("rowContext", () => {
  it("row-level cues beat case-level, and promotions never reach the record", () => {
    const ctx = rowContext([sc(unit(["Horror", "Horror"]), "case"), sc(unit(["Fantasy", "Fantasy"]), "row"), sc(unit(["Staff picks", "Staff picks"]), "row")])!;
    expect(ctx).toMatchObject({ genre: "fantasy", family: "fantasy", ordering: null, levels: { genre: "row" }, genreRegion: "lip" });
    expect(ctx.source).toBe("sc1:lip:row");
    expect(asRowContext(ctx)).toEqual({ ordering: null, genre: "fantasy", letterRange: null, source: "sc1:lip:row" });
  });
  it("collects ordering, ranges and dividers", () => {
    const ctx = rowContext([sc(unit(["Alphabetical by author", "Alphabetical by author"]), "case"), sc(unit(["A - C", "A-C"]), "row"), sc(unit(["M", "M"]), "divider", 400)])!;
    expect(ctx).toMatchObject({ ordering: "author-alphabetical", letterRange: ["a", "c"], dividers: [{ x: 400, letter: "m" }] });
  });
  it("is null with only dropped cues", () => {
    expect(rowContext([sc(unit(["Sale", "Sale"]), "row")])).toBeNull();
  });
});

describe("measures", () => {
  it("letter bounds compare by prefix", () => {
    expect(inRange("adams", ["a", "c"])).toBe(true);
    expect(inRange("davis", ["a", "c"])).toBe(false);
    expect(inRange("mcdonald", ["ma", "mc"])).toBe(true);
    expect(dividerSide("lewis", "m", false)).toBe(true);
    expect(dividerSide("moore", "m", true)).toBe(true);
    expect(dividerSide("moore", "m", false)).toBe(false);
  });
  it("work families from facets, and agreement", () => {
    const f = workFamilies({ tags: ["space opera", "military sf"], ttype: "NOVEL", nonGenre: false, graphic: false });
    expect([...f]).toEqual(["sf"]);
    expect(familyAgrees("sf-fantasy", f)).toBe(true);
    expect(familyAgrees("horror", f)).toBe(false);
    expect(workFamilies({ tags: [], ttype: "NOVEL", nonGenre: false, graphic: false }).size).toBe(0);
    expect(familyAgrees("literature", workFamilies({ tags: [], ttype: "NOVEL", nonGenre: true, graphic: false }))).toBe(true);
  });
  it("pairs and order counts", () => {
    const ctx = rowContext([sc(unit(["A - F", "A - F"]), "row"), sc(unit(["C", "C"]), "divider", 150)])!;
    const r: MeasureRow = {
      imageId: "i",
      key: "i|0",
      context: ctx,
      books: [
        { x: 100, surname: "brown", families: new Set(["sf"]) },
        { x: 200, surname: "doyle", families: new Set() },
        { x: 300, surname: "smith", families: new Set(["horror"]) },
      ],
    };
    const lp = letterPairs([r]);
    expect(lp.filter((x) => x.kind === "range").map((x) => x.agree)).toEqual([true, true, false]);
    expect(lp.filter((x) => x.kind === "divider").map((x) => x.agree)).toEqual([true, true, true]);
    expect(genrePairs([r], () => "sf")).toEqual([{ imageId: "i", agree: true }, { imageId: "i", agree: false }]);
    expect(orderCounts([r])).toEqual({ pairs: 2, inOrder: 2 });
  });
  it("shuffle control is deterministic and one-sided", () => {
    const xs = [1, 2, 3, 4, 5];
    const s = shuffleControl(() => ({ value: 1, n: 5 }), (rand) => permuted(xs, rand), (perm: number[]) => (perm[0] === 1 ? 1 : 0), 200, 7);
    expect(s.real).toBe(1);
    expect(s.mean).toBeGreaterThan(0);
    expect(s.mean).toBeLessThan(0.5);
    expect(s).toEqual(shuffleControl(() => ({ value: 1, n: 5 }), (rand) => permuted(xs, rand), (perm: number[]) => (perm[0] === 1 ? 1 : 0), 200, 7));
    expect(permuted(xs, rng(1)).sort()).toEqual(xs);
  });
});
