// The controlled taste vocabulary (card R-1; docs/recommend/taste-model.md §2.2 and §2.4).
// `vocabulary.json` holds the facets, terms and crosswalk; `contracts/vocabulary.schema.json` is its
// source of truth (OC13) and `test/vocabulary.test.ts` proves this validator agrees with it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { FeatureSource, WorkFeature } from "../catalog/work-features.ts";

export const FACETS = ["theme", "topos", "idea", "question", "style", "pattern", "form", "author"] as const;
export const CROSSWALK_SOURCES = ["isfdb-tag", "lcsh", "lcgft", "bisac"] as const;
/** The tree caps a branch at three levels (TREE_DEPTH). */
export const MAX_TERM_DEPTH = 3;

const TERM_ID = /^(theme|topos|idea|question|style|pattern|form|author):[a-z0-9]+(-[a-z0-9]+)*$/;
const TermIdSchema = z.string().regex(TERM_ID);

export const VocabularySchema = z
  .object({
    schemaVersion: z.literal(1),
    facets: z.array(z.object({ id: z.enum(FACETS), description: z.string().min(1) }).strict()).min(1),
    terms: z.array(
      z
        .object({
          id: TermIdSchema,
          label: z.string().min(1),
          parent: TermIdSchema.optional(),
          aliases: z.array(z.string().min(1)).optional(),
        })
        .strict(),
    ),
    crosswalk: z
      .object({
        tagWeightDivisor: z.number().gt(0),
        generic: z.array(z.string().min(1)),
        dropPatterns: z.array(z.string().min(1)),
        rules: z.array(
          z
            .object({
              source: z.enum(CROSSWALK_SOURCES),
              match: z.string().min(1),
              terms: z.array(z.object({ id: TermIdSchema, weight: z.number().gt(0).max(1).optional() }).strict()).min(1),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict();

export type Vocabulary = z.infer<typeof VocabularySchema>;

export const VOCABULARY_PATH = fileURLToPath(new URL("./vocabulary.json", import.meta.url));

export function loadVocabulary(path: string = VOCABULARY_PATH): Vocabulary {
  return VocabularySchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** Compile the drop list. Case-insensitive; run on the case-folded value. */
export function dropMatchers(v: Pick<Vocabulary, "crosswalk">): RegExp[] {
  return v.crosswalk.dropPatterns.map((p) => new RegExp(p, "i"));
}

/** Why a catalog value is dropped before any rule is tried (popularity and canon signals, generic labels), or null to keep it. */
export function dropReason(v: Pick<Vocabulary, "crosswalk">, value: string): "popularity" | "generic" | null {
  const folded = value.trim().toLowerCase();
  if (dropMatchers(v).some((re) => re.test(folded))) return "popularity";
  if (v.crosswalk.generic.includes(folded)) return "generic";
  return null;
}

/** Problems a schema cannot express. Empty when the vocabulary is sound. */
export function checkVocabulary(v: Vocabulary): string[] {
  const problems: string[] = [];
  const byId = new Map<string, Vocabulary["terms"][number]>();
  for (const t of v.terms) {
    if (byId.has(t.id)) problems.push(`duplicate term ${t.id}`);
    byId.set(t.id, t);
  }
  const facets = new Set<string>(v.facets.map((f) => f.id));
  if (facets.size !== v.facets.length) problems.push("duplicate facet");
  for (const t of v.terms) {
    const facet = t.id.split(":")[0]!;
    if (!facets.has(facet)) problems.push(`${t.id}: facet "${facet}" is not declared`);
    if (t.parent !== undefined) {
      const p = byId.get(t.parent);
      if (!p) problems.push(`${t.id}: parent ${t.parent} does not exist`);
      else if (p.id.split(":")[0] !== facet) problems.push(`${t.id}: parent ${t.parent} is on another facet`);
    }
    let depth = 1;
    for (let cur = t, seen = new Set([t.id]); cur.parent !== undefined; depth++) {
      const next = byId.get(cur.parent);
      if (!next || seen.has(next.id)) {
        if (next) problems.push(`${t.id}: parent cycle`);
        break;
      }
      seen.add(next.id);
      cur = next;
    }
    if (depth > MAX_TERM_DEPTH) problems.push(`${t.id}: depth ${depth} exceeds ${MAX_TERM_DEPTH}`);
  }
  const labels = new Set<string>();
  for (const t of v.terms) {
    const keys = [t.label, ...(t.aliases ?? [])].map((s) => `${t.id.split(":")[0]}|${s.toLowerCase()}`);
    for (const k of keys) {
      if (labels.has(k)) problems.push(`${t.id}: label or alias "${k.split("|")[1]}" is used twice on its facet`);
      labels.add(k);
    }
  }

  const { crosswalk } = v;
  const matchers: RegExp[] = [];
  for (const p of crosswalk.dropPatterns) {
    try {
      matchers.push(new RegExp(p, "i"));
    } catch {
      problems.push(`drop pattern /${p}/ does not compile`);
    }
  }
  const seenRules = new Set<string>();
  for (const r of crosswalk.rules) {
    const key = `${r.source}|${r.match}`;
    if (seenRules.has(key)) problems.push(`rule ${key} is listed twice`);
    seenRules.add(key);
    if (r.match !== r.match.toLowerCase().trim()) problems.push(`rule ${key}: match must be case-folded and trimmed`);
    if (matchers.some((re) => re.test(r.match))) problems.push(`rule ${key}: maps a value the drop list drops (popularity or canon signal, OC33)`);
    if (crosswalk.generic.includes(r.match)) problems.push(`rule ${key}: maps a generic value`);
    for (const t of r.terms) if (!byId.has(t.id)) problems.push(`rule ${key}: term ${t.id} is not in the vocabulary`);
  }
  for (const g of crosswalk.generic) if (g !== g.toLowerCase().trim()) problems.push(`generic "${g}" must be case-folded and trimmed`);
  return problems;
}

/** Which crosswalk rules a `work_features` source is matched against. Open Library subjects have none yet (KN-1). */
const RULE_SOURCE: Record<FeatureSource, (typeof CROSSWALK_SOURCES)[number] | null> = { "isfdb-tag": "isfdb-tag", "openlibrary-subject": null };

export interface CrosswalkedTerm {
  id: string;
  weight: number;
  /** The `work_features` row the term came from (its provenance: source, record id, fetched date). */
  from: WorkFeature;
}

export interface Crosswalked {
  terms: CrosswalkedTerm[];
  /** Kept values no rule maps: shown in dev mode as `unmapped`, with no weight (§2.4). */
  unmapped: WorkFeature[];
  dropped: Array<{ from: WorkFeature; reason: "popularity" | "generic" }>;
}

/**
 * The crosswalk (taste-model.md §2.4) over one work's shared book knowledge: the catalog's `work_features` rows
 * (`workFeatures` in src/catalog/work-features.ts), never a copy of them. The drop list and the generic list run
 * first; an ISFDB tag weighs `min(1, count / tagWeightDivisor)` times the rule's weight.
 */
export function crosswalkFeatures(v: Vocabulary, features: WorkFeature[]): Crosswalked {
  const rules = new Map(v.crosswalk.rules.map((r) => [`${r.source}|${r.match}`, r]));
  const out: Crosswalked = { terms: [], unmapped: [], dropped: [] };
  for (const f of features) {
    const reason = dropReason(v, f.term);
    if (reason) {
      out.dropped.push({ from: f, reason });
      continue;
    }
    const source = RULE_SOURCE[f.source];
    const rule = source && rules.get(`${source}|${f.term}`);
    if (!rule) {
      out.unmapped.push(f);
      continue;
    }
    const base = f.source === "isfdb-tag" ? Math.min(1, f.count / v.crosswalk.tagWeightDivisor) : 1;
    for (const t of rule.terms) out.terms.push({ id: t.id, weight: base * (t.weight ?? 1), from: f });
  }
  return out;
}
