// The plan step and the batching measurement of catalog lookups (card C-10).
//
//   resolveBox with a plan-mode cache -> planSummary: how many live calls a run would make, per source, by tier
//   planC4: the same boxes under C-4's behaviour (URL-keyed cache, no known or local tier), the "before"
//   attribution: can a record in a combined (batched) response be given back to its own query?
//
// Counts only leave this module; keys, URLs and records stay in the data root.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { liveQueries, parseRecords, resolves, tokenMatch, LIMITS, type BoxResult, type ReaderText, type Shape, type Tier } from "./coverage.ts";
import { LOOKUP, SOURCES, type CacheEntry, type LookupCache, type Source } from "./lookup.ts";
import { normalize, tokenize } from "./normalize.ts";

const r4 = (x: number) => (Number.isFinite(x) ? Math.round(x * 10000) / 10000 : null);

/** Where a box ended in a run or a plan. */
export type Outcome = Tier | "known-skip" | "would-go-live" | "budget-skip" | "unresolved";

export function outcomeOf(r: Pick<BoxResult, "tier" | "skipped" | "queries">): Outcome {
  if (r.tier) return r.tier;
  if (r.skipped === "known") return "known-skip";
  if (r.queries.some((q) => q.from === "planned")) return "would-go-live";
  if (r.skipped === "budget") return "budget-skip";
  return "unresolved";
}

export interface PlanSummary {
  boxes: number;
  /** Boxes by where they ended. */
  outcomes: Record<Outcome, number>;
  /**
   * Live calls the run would make, per source. `lower`: the distinct first key each box would call;
   * `upper`: every distinct key with no fresh entry among those boxes, plus `cleanChecksUpTo` (one Open
   * Library clean-label check per box that could reach LoC).
   */
  live: { lower: Record<Source, number>; upper: Record<Source, number>; cleanChecksUpTo: number };
  /** Distinct keys answered from a fresh entry, and all distinct keys the run asked for; their ratio. */
  keys: { fresh: number; asked: number; cacheHitRate: number | null };
  /** Boxes a `local-*` tier answered, of the boxes that reached the local tier; their ratio. */
  local: { answered: number; reached: number; localHitRate: number | null };
}

/** The plan (or run) summary of a set of box results from one cache. */
export function planSummary(results: BoxResult[], cache: LookupCache): PlanSummary {
  const outcomes = Object.fromEntries((["cache", "stale", "known", "local-isfdb", "local-openlibrary", "live", "known-skip", "would-go-live", "budget-skip", "unresolved"] as Outcome[]).map((o) => [o, 0])) as Record<Outcome, number>;
  const lower: Record<Source, Set<string>> = { openlibrary: new Set(), loc: new Set() };
  let cleanChecksUpTo = 0;
  let localAnswered = 0;
  let reached = 0;
  for (const r of results) {
    const o = outcomeOf(r);
    outcomes[o]++;
    const first = r.queries.find((q) => q.from === "planned");
    if (first) lower[first.source].add(first.key);
    if (r.queries.some((q) => q.from === "planned" && q.source === "loc")) cleanChecksUpTo++;
    if (o === "local-isfdb" || o === "local-openlibrary") localAnswered++;
    if (r.pending > 0 && o !== "known" && o !== "cache") reached++;
  }
  const s = cache.summary();
  const sum = (x: Record<Source, number>) => x.openlibrary + x.loc;
  const asked = sum(s.cache) + sum(s.stale) + sum(s.live) + sum(s.planned) + sum(s.skipped);
  return {
    boxes: results.length,
    outcomes,
    live: { lower: { openlibrary: lower.openlibrary.size, loc: lower.loc.size }, upper: s.planned, cleanChecksUpTo },
    keys: { fresh: sum(s.cache), asked, cacheHitRate: r4(sum(s.cache) / asked) },
    local: { answered: localAnswered, reached, localHitRate: r4(localAnswered / reached) },
  };
}

const v1Path = (root: string, source: Source, url: string) => join(root, source, `${createHash("sha256").update(url).digest("hex")}.json`);

/**
 * The same boxes planned under C-4's behaviour: every query in C-4's order, a version-1 file (keyed on the
 * exact URL) answers it, a cached record that resolves the box stops it, and any other query is a call.
 * Same bounds as `planSummary` (`upper` counts the clean-label checks apart).
 */
export function planC4(boxes: ReaderText[][], root: string): { boxes: number; needCalls: number; lower: Record<Source, number>; upper: Record<Source, number>; cleanChecksUpTo: number } {
  const lower: Record<Source, Set<string>> = { openlibrary: new Set(), loc: new Set() };
  const upper: Record<Source, Set<string>> = { openlibrary: new Set(), loc: new Set() };
  let needCalls = 0;
  let cleanChecksUpTo = 0;
  for (const texts of boxes) {
    const calls: { source: Source; url: string }[] = [];
    for (const q of [...liveQueries(texts, "openlibrary"), ...liveQueries(texts, "loc")]) {
      const p = v1Path(root, q.source, q.url);
      if (!existsSync(p)) {
        calls.push(q);
        continue;
      }
      const body = (JSON.parse(readFileSync(p, "utf8")) as { body: string | null }).body;
      if (body !== null && parseRecords(q.source, body).slice(0, LIMITS.records).some((r) => resolves(r, texts))) break;
    }
    if (calls.length === 0) continue;
    needCalls++;
    lower[calls[0]!.source].add(calls[0]!.url);
    for (const c of calls) upper[c.source].add(c.url);
    if (calls.some((c) => c.source === "loc")) cleanChecksUpTo++;
  }
  return {
    boxes: boxes.length,
    needCalls,
    lower: { openlibrary: lower.openlibrary.size, loc: lower.loc.size },
    upper: { openlibrary: upper.openlibrary.size, loc: upper.loc.size },
    cleanChecksUpTo,
  };
}

// ---------------------------------------------------------------------------------------------
// Batching: attribution on cached responses
// ---------------------------------------------------------------------------------------------

/** The version-2 entries of one source, oldest first (C-4's run order). */
export function cachedEntries(cache: Pick<LookupCache, "dir">, source: Source): CacheEntry[] {
  const dir = join(cache.dir, source);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as CacheEntry)
    .sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt) || a.key.localeCompare(b.key));
}

const keyShape = (key: string) => key.split("|")[1] as Shape;
const keyTokens = (key: string) => {
  const [, , title, author] = key.split("|");
  return [...(title ? title.split(" ") : []), ...(author ? author.split(" ") : [])];
};

/** Is a record given back to a query: every query token matches a token of the record's returned fields? */
export function attributable(rec: { title: string; subtitle: string | null; authors: string[]; subjects: string[] }, tokens: string[]): boolean {
  const fields = tokenize(normalize([rec.title, rec.subtitle ?? "", ...rec.authors, ...rec.subjects].join(" ")));
  return tokens.length > 0 && tokens.every((t) => fields.some((f) => tokenMatch(f, t) || tokenMatch(t, f)));
}

export interface AttributionCell {
  /** Cached positive responses measured, and their top-10 records. */
  queries: number;
  records: number;
  /** Records given back to their own query; records also given to the next distinct query of the same source and shape. */
  attributed: number;
  cross: number;
  recall: number | null;
  crossRate: number | null;
  /** Does this cell pass the pre-registered gate? */
  passes: boolean;
}

/**
 * Attribution of cached positive `and` and `fielded` responses (evals/C10/prereg.md § Batching). `or` queries
 * are not measured: any one token suffices, so a record cannot be given back to one of several.
 */
export function attribution(entries: Record<Source, CacheEntry[]>): Record<Source, Record<"and" | "fielded", AttributionCell>> {
  const out = {} as Record<Source, Record<"and" | "fielded", AttributionCell>>;
  for (const source of SOURCES) {
    out[source] = {} as Record<"and" | "fielded", AttributionCell>;
    for (const shape of ["and", "fielded"] as const) {
      const es = entries[source].filter((e) => e.outcome === "match" && keyShape(e.key) === shape);
      const c = { queries: es.length, records: 0, attributed: 0, cross: 0 };
      es.forEach((e, i) => {
        const own = keyTokens(e.key);
        const next = es.slice(i + 1).find((n) => n.key !== e.key) ?? es.slice(0, i).find((n) => n.key !== e.key);
        const other = next ? keyTokens(next.key) : [];
        for (const rec of parseRecords(source, e.body!).slice(0, LIMITS.records)) {
          c.records++;
          if (attributable(rec, own)) c.attributed++;
          if (other.length && attributable(rec, other)) c.cross++;
        }
      });
      const recall = r4(c.attributed / c.records);
      const crossRate = r4(c.cross / c.records);
      out[source][shape] = { ...c, recall, crossRate, passes: recall !== null && crossRate !== null && recall >= LOOKUP.attribution.minRecall && crossRate <= LOOKUP.attribution.maxCross };
    }
  }
  return out;
}
