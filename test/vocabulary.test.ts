// R-1: src/recommend/vocabulary.json and its contract (OC13, OC33; taste-model.md §2).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CROSSWALK_SOURCES, FACETS, VOCABULARY_PATH, VocabularySchema, checkVocabulary, dropReason, loadVocabulary } from "../src/recommend/vocabulary.ts";
import type { Vocabulary } from "../src/recommend/vocabulary.ts";
import { vocabularySchemaErrors } from "../src/recommend/schemas.ts";
import { disagreements } from "./support/mutants.ts";

const raw = JSON.parse(readFileSync(VOCABULARY_PATH, "utf8"));
const vocabulary = loadVocabulary();
const schema = JSON.parse(readFileSync(new URL("../contracts/vocabulary.schema.json", import.meta.url), "utf8"));
const edit = (f: (v: Vocabulary) => void): Vocabulary => {
  const v = structuredClone(vocabulary);
  f(v);
  return v;
};

describe("contract: contracts/vocabulary.schema.json and Zod agree (OC13)", () => {
  it("the vocabulary validates against both", () => {
    expect(vocabularySchemaErrors(raw)).toEqual([]);
    expect(VocabularySchema.safeParse(raw).error?.issues ?? []).toEqual([]);
  });

  it("the facet and crosswalk-source enums agree between the schema and code", () => {
    expect([...FACETS]).toEqual(schema.definitions.Facet.enum);
    expect([...CROSSWALK_SOURCES]).toEqual(schema.properties.crosswalk.properties.rules.items.properties.source.enum);
  });

  it("agree on every mutation of the vocabulary", () => {
    const { checked, found } = disagreements([{ name: "vocabulary.json", value: raw }], (v) => vocabularySchemaErrors(v).length === 0, (v) => VocabularySchema.safeParse(v).success);
    expect(checked).toBeGreaterThan(1000);
    expect(found.slice(0, 10)).toEqual([]);
  });

  it.each([
    ["a term id off its facet pattern", (v: any) => (v.terms[0].id = "Theme:Bad")],
    ["an unknown facet", (v: any) => (v.facets[0].id = "mood")],
    ["a rule weight above 1", (v: any) => (v.crosswalk.rules[0].terms[0].weight = 1.5)],
    ["a rule with no terms", (v: any) => (v.crosswalk.rules[0].terms = [])],
    ["an unknown crosswalk source", (v: any) => (v.crosswalk.rules[0].source = "goodreads-shelf")],
  ])("rejects %s", (_name, mutate) => {
    const v = structuredClone(raw);
    mutate(v);
    expect(vocabularySchemaErrors(v).length).toBeGreaterThan(0);
    expect(VocabularySchema.safeParse(v).success).toBe(false);
  });
});

describe("the vocabulary is sound", () => {
  it("passes every cross-check", () => {
    expect(checkVocabulary(vocabulary)).toEqual([]);
  });

  it("has the eight facets of taste-model.md §2.1, terms on seven of them (authors come from the catalog)", () => {
    expect(vocabulary.facets.map((f) => f.id)).toEqual(["theme", "topos", "idea", "question", "style", "pattern", "form", "author"]);
    const used = new Set(vocabulary.terms.map((t) => t.id.split(":")[0]));
    expect([...used].sort()).toEqual(["form", "idea", "pattern", "question", "style", "theme", "topos"]);
  });

  it("has the hierarchy the taste tree uses: theme -> sub-theme, at most three levels", () => {
    const ids = new Map(vocabulary.terms.map((t) => [t.id, t]));
    expect(ids.get("theme:climate-institutions")?.parent).toBe("theme:near-futures-real-systems");
    expect(ids.get("theme:near-futures-real-systems")?.parent).toBeUndefined();
  });

  it.each([
    ["a duplicate term", (v: Vocabulary) => v.terms.push(v.terms[0]!), /duplicate term/],
    ["a missing parent", (v: Vocabulary) => (v.terms[1]!.parent = "theme:nowhere"), /does not exist/],
    ["a parent on another facet", (v: Vocabulary) => (v.terms[1]!.parent = "idea:terraforming"), /another facet/],
    ["a cycle", (v: Vocabulary) => (v.terms[0]!.parent = "theme:climate-institutions"), /cycle/],
    ["a branch deeper than three", (v: Vocabulary) => v.terms.push({ id: "theme:a", label: "A", parent: "theme:climate-institutions" }, { id: "theme:b", label: "B", parent: "theme:a" }), /depth 4/],
    ["a rule for a missing term", (v: Vocabulary) => (v.crosswalk.rules[0]!.terms[0]!.id = "form:nothing"), /not in the vocabulary/],
    ["the same rule twice", (v: Vocabulary) => v.crosswalk.rules.push(v.crosswalk.rules[0]!), /listed twice/],
    ["a match that is not case-folded", (v: Vocabulary) => (v.crosswalk.rules[0]!.match = "Climate Change"), /case-folded/],
    ["a drop pattern that does not compile", (v: Vocabulary) => v.crosswalk.dropPatterns.push("(unclosed"), /does not compile/],
    ["a rule that maps a generic value", (v: Vocabulary) => v.crosswalk.rules.push({ source: "isfdb-tag", match: "fiction", terms: [{ id: "form:thriller" }] }), /generic/],
    ["a rule that maps an award tag", (v: Vocabulary) => v.crosswalk.rules.push({ source: "isfdb-tag", match: "2-award-winner", terms: [{ id: "form:thriller" }] }), /drop list/],
  ])("catches %s", (_name, mutate, why) => {
    expect(checkVocabulary(edit(mutate)).join("\n")).toMatch(why);
  });
});

describe("no popularity or canon signal reaches the vocabulary (OC33)", () => {
  // Values seen on ISFDB pages on 2026-11-02 (taste-model.md §1.1, "Excluded on purpose").
  it.each([
    "2-award-winner",
    "1001 Books You Must Read Before You Die",
    "SF: The 100 Best Novels 1949-1984",
    "into-movie",
    "AbeBooks Top 100",
    "User Rating: 8.19 (54 votes)",
    "12 votes",
  ])("drops %s as popularity", (value) => {
    expect(dropReason(vocabulary, value)).toBe("popularity");
  });

  it.each(["Science Fiction", "Fiction", "Novels"])("drops %s as generic", (value) => {
    expect(dropReason(vocabulary, value)).toBe("generic");
  });

  it.each(["cyberpunk", "climate change", "terraforming", "Mars", "satire"])("keeps %s", (value) => {
    expect(dropReason(vocabulary, value)).toBeNull();
  });

  it("no crosswalk source is a rating, vote, award or list source, and no rule matches one", () => {
    expect([...CROSSWALK_SOURCES].filter((s) => /rating|vote|award|list|best|popular/i.test(s))).toEqual([]);
    for (const r of vocabulary.crosswalk.rules) expect(dropReason(vocabulary, r.match), `${r.source}:${r.match}`).toBeNull();
    for (const t of vocabulary.terms) expect(`${t.id} ${t.label}`).not.toMatch(/award|bestseller|best of|rating|votes/i);
  });

  it("maps the examples taste-model.md §2.4 gives", () => {
    const rule = (source: string, match: string) => vocabulary.crosswalk.rules.find((r) => r.source === source && r.match === match);
    for (const [source, match] of [["isfdb-tag", "climate change"], ["isfdb-tag", "cli-fi"], ["isfdb-tag", "climate fiction"], ["lcgft", "climate fiction"]] as const) {
      expect(rule(source, match)?.terms).toEqual([{ id: "form:climate-fiction" }, { id: "theme:climate-institutions", weight: 0.5 }]);
    }
    expect(rule("isfdb-tag", "terraforming")?.terms).toEqual([{ id: "idea:terraforming" }]);
    expect(rule("lcsh", "space colonies")?.terms).toEqual([{ id: "topos:frontier-political-project", weight: 0.5 }]);
    expect(vocabulary.crosswalk.tagWeightDivisor).toBe(3);
  });
});
