import { describe, expect, it } from "vitest";
import { confusableReadings, decodeEntities, editDistance, normalize, skeleton, splitSubtitle, surnameFirstToGivenFirst, tokensWithInitials } from "../src/catalog/normalize.ts";

describe("normalize", () => {
  it("casefolds, strips diacritics and punctuation, spells out ligatures", () => {
    expect(normalize("Stanisław Lem")).toBe("stanislaw lem");
    expect(normalize("China Miéville")).toBe("china mieville");
    expect(normalize("  The  Hitchhiker's Guide—to the Galaxy! ")).toBe("the hitchhikers guide to the galaxy");
    expect(normalize("Æon Flux / Straße")).toBe("aeon flux strasse");
    expect(normalize("Hammer & Tongs")).toBe("hammer and tongs");
  });

  it("reads initials with and without periods", () => {
    expect(normalize("J.R.R. Tolkien")).toBe("jrr tolkien");
    expect(normalize("J. R. R. Tolkien")).toBe("j r r tolkien");
    expect(tokensWithInitials("j r r tolkien")).toEqual(["j", "r", "r", "tolkien", "jrr"]);
  });

  it("decodes ISFDB's numeric entities, leaving broken ones alone", () => {
    expect(decodeEntities("&#1057;&#1086;&#1083;")).toBe("Сол");
    expect(decodeEntities("F&amp;SF &#x41;")).toBe("F&SF A");
    expect(decodeEntities("&#99999999999;")).toBe("&#99999999999;");
    expect(normalize("&#1057;&#1086;&#1083;&#1103;&#1088;&#1080;&#1089;")).toBe("солярис");
  });

  it("is idempotent", () => {
    for (const s of ["Stanisław Lem", "J.R.R. Tolkien", "Ender's Game", "2312"]) expect(normalize(normalize(s))).toBe(normalize(s));
  });
});

describe("OCR helpers", () => {
  it("reads 0/O and 1/l/I confusions only in mixed tokens", () => {
    expect(confusableReadings("neur0mancer")).toEqual(["neuromancer"]);
    expect(confusableReadings("hyper1on")).toEqual(["hyperlon", "hyperion"]);
    expect(confusableReadings("i984")).toEqual(["1984"]);
    expect(confusableReadings("1984")).toEqual([]);
    expect(confusableReadings("dune")).toEqual([]);
  });

  it("collapses rn/m, vv/w, cl/d", () => {
    expect(skeleton("neurornancer")).toBe(skeleton("neuromancer"));
    expect(skeleton("vvorld")).toBe("world");
  });

  it("edit distance counts a transposition as one and gives up past the bound", () => {
    expect(editDistance("dune", "dnue", 2)).toBe(1);
    expect(editDistance("kitten", "sitting", 2)).toBe(3);
    expect(editDistance("abc", "abc", 1)).toBe(0);
    expect(editDistance("short", "muchlongerword", 1)).toBe(2);
  });
});

describe("name and title shapes", () => {
  it("splits a subtitle at the first ': '", () => {
    expect(splitSubtitle("Necroscope IV: Deadspeak")).toEqual({ main: "Necroscope IV", subtitle: "Deadspeak" });
    expect(splitSubtitle("Neuromancer")).toEqual({ main: "Neuromancer", subtitle: null });
    expect(splitSubtitle("Ratio 3:2")).toEqual({ main: "Ratio 3:2", subtitle: null });
  });

  it("turns 'Surname, Given' round", () => {
    expect(surnameFirstToGivenFirst("Dick, Philip Kindred")).toBe("Philip Kindred Dick");
    expect(surnameFirstToGivenFirst("Philip K. Dick")).toBe("Philip K. Dick");
    expect(surnameFirstToGivenFirst("Miller, Walter M., Jr.")).toBe("Miller, Walter M., Jr.");
  });
});
