// Scores `retrieve` on the golden fragment set (evals/golden/fragments.jsonl, card C-3).
//
// The set is written by hand from public knowledge of science-fiction books (docs/catalog.md says how
// corpus-generated inflation was avoided). A query counts as a hit when one of the top-k candidates is a
// *target work*: a catalog work that has a title form equal to the expected title and an author form equal
// to the expected author. The target set is looked up by exact normalised match, never from retrieval
// output. A query with no target work in the catalog is a catalog gap: it is reported and left out of the
// rates, so a missing book is never counted as a retrieval miss.
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { normalize } from "./normalize.ts";
import { retrieve, type Candidate } from "./retrieve.ts";

export interface GoldenQuery {
  id: string;
  class: "clean" | "noisy" | "none";
  noise: string[];
  split: "dev" | "test" | "none";
  base?: string;
  variants: string[];
  expect: { title: string; author: string } | null;
}

export function loadGolden(path: string): GoldenQuery[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l, i) => {
      const q = JSON.parse(l) as GoldenQuery;
      if (!q.id || !Array.isArray(q.variants) || q.variants.length === 0) throw new Error(`${path}:${i + 1}: a golden query needs an id and variants`);
      return q;
    });
}

/** Work ids whose title forms include `title` and whose author forms include `author` (both normalised, exact). */
export function targetWorks(db: DatabaseSync, expect: { title: string; author: string }): Set<string> {
  const t = normalize(expect.title);
  const a = normalize(expect.author);
  const ids = db.prepare("SELECT DISTINCT work_id FROM title_forms WHERE norm = ?").all(t) as Array<{ work_id: string }>;
  const out = new Set<string>();
  const get = db.prepare("SELECT author_norm FROM works WHERE id = ?");
  for (const { work_id } of ids) {
    const row = get.get(work_id) as { author_norm: string } | undefined;
    if (row && row.author_norm.split("|").includes(a)) out.add(work_id);
  }
  return out;
}

export interface QueryResult {
  id: string;
  class: GoldenQuery["class"];
  noise: string[];
  split: GoldenQuery["split"];
  /** The expected work is in the catalog. False = catalog gap (not scored). */
  inCatalog: boolean;
  /** 1-based rank of the first target work among the candidates, or null. */
  rank: number | null;
  topScore: number;
  ms: number;
}

export interface Rate {
  n: number;
  top1: number;
  top5: number;
  top10: number;
  mrr: number;
}

export interface GoldenRun {
  goldenFile: string;
  k: number;
  queries: number;
  gaps: string[];
  results: QueryResult[];
  rates: Record<string, Rate>;
  latencyMs: { n: number; p50: number; p95: number; max: number; mean: number };
  none: { n: number; topScoreMax: number; topScoreMedian: number } | null;
  hitTopScore: { n: number; min: number; p10: number; median: number } | null;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)]!;
}

const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

function rate(rs: QueryResult[]): Rate {
  const n = rs.length;
  const at = (k: number) => (n === 0 ? 0 : rs.filter((r) => r.rank !== null && r.rank <= k).length / n);
  return { n, top1: round(at(1)), top5: round(at(5)), top10: round(at(10)), mrr: round(n === 0 ? 0 : rs.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / n) };
}

/** A retrieval to score: `retrieve` by default; C-8 passes the generation it compares against. */
export type RetrieveFn = (db: DatabaseSync, variants: string[], k: number) => Candidate[];

/** Runs every golden query (a warm-up pass first, so latency is warm-cache) and aggregates. */
export function runGolden(db: DatabaseSync, queries: GoldenQuery[], goldenFile: string, k = 10, run: RetrieveFn = retrieve): GoldenRun {
  const targets = new Map<string, Set<string>>();
  for (const q of queries) if (q.expect) targets.set(q.id, targetWorks(db, q.expect));

  for (const q of queries) run(db, q.variants, k); // warm-up, not timed

  const results: QueryResult[] = [];
  for (const q of queries) {
    const t0 = performance.now();
    const cands = run(db, q.variants, k);
    const ms = performance.now() - t0;
    const target = targets.get(q.id);
    const idx = target ? cands.findIndex((c) => target.has(c.workId)) : -1;
    results.push({
      id: q.id, class: q.class, noise: q.noise, split: q.split,
      inCatalog: q.expect === null ? true : (target?.size ?? 0) > 0,
      rank: idx >= 0 ? idx + 1 : null,
      topScore: cands[0]?.score ?? 0,
      ms: round(ms, 1),
    });
  }

  const scored = results.filter((r) => r.class !== "none" && r.inCatalog);
  const rates: Record<string, Rate> = {
    clean: rate(scored.filter((r) => r.class === "clean")),
    noisy: rate(scored.filter((r) => r.class === "noisy")),
    "clean.dev": rate(scored.filter((r) => r.class === "clean" && r.split === "dev")),
    "clean.test": rate(scored.filter((r) => r.class === "clean" && r.split === "test")),
    "noisy.dev": rate(scored.filter((r) => r.class === "noisy" && r.split === "dev")),
    "noisy.test": rate(scored.filter((r) => r.class === "noisy" && r.split === "test")),
  };
  const tags = new Set(scored.flatMap((r) => r.noise));
  for (const tag of [...tags].sort()) rates[`noise.${tag}`] = rate(scored.filter((r) => r.class === "noisy" && r.noise.includes(tag)));

  const times = results.map((r) => r.ms).sort((a, b) => a - b);
  const none = results.filter((r) => r.class === "none").map((r) => r.topScore).sort((a, b) => a - b);
  const hits = scored.filter((r) => r.rank === 1).map((r) => r.topScore).sort((a, b) => a - b);
  return {
    goldenFile, k, queries: queries.length,
    gaps: results.filter((r) => !r.inCatalog).map((r) => r.id),
    results, rates,
    latencyMs: { n: times.length, p50: round(percentile(times, 50), 1), p95: round(percentile(times, 95), 1), max: round(times.at(-1) ?? 0, 1), mean: round(times.reduce((s, x) => s + x, 0) / (times.length || 1), 1) },
    none: none.length ? { n: none.length, topScoreMax: none.at(-1)!, topScoreMedian: percentile(none, 50) } : null,
    hitTopScore: hits.length ? { n: hits.length, min: hits[0]!, p10: percentile(hits, 10), median: percentile(hits, 50) } : null,
  };
}
