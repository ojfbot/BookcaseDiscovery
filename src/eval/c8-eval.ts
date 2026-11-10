// C-8 evaluation: candidate generation in src/catalog/retrieve.ts (`generation: "c8"`: exact titles first, then
// per-token trigram queries rarest first) against today's (C-3's, `retrieve`'s default; for the gates, the file as it
// stood at `BASE`, materialised from git), on C-3's golden fragments and on F-0's cached readings, re-decided
// offline on v1 (`catalog.sqlite`) and v2 (`catalog-v2.sqlite`). No detection, no reading, no GPU, no network.
// Pre-registration and keep rule: evals/C8/report.md.
//
//   node src/eval/c8-eval.ts readings --set <pilot-000|yardstick-library-b2> --catalog <v1|v2> --arm <base|c8|c8u> [--shard k/n]
//                                        one retrieve per reading: its top work, F-0's bar, its ranked works
//   node src/eval/c8-eval.ts golden   golden fragments on both catalogs, both generations: rates, losses, latency
//   node src/eval/c8-eval.ts decide   --set <name>   F-0's vote per arm on both catalogs, candidate recall
//   node src/eval/c8-eval.ts publish  the keep rule, and the parts joined into evals/C8/metrics.json
//
// Per-reading and per-spine files (they hold reader text and work ids) stay in the data root's private folder
// (private/c8/); only aggregates are written to evals/C8/.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dataRoot } from "../ledger/images.ts";
import { ACCEPT, confirms, loadReadings, READERS, readJsonl, stageDir, variantsOf, vote, type ReaderName, type ReaderVotes, type SpineDecision } from "./f0.ts";
import { clusterBootstrap } from "./q1.ts";
import { c5Cache } from "./c6-eval.ts";
import { isAnnotated, yardstickBooks } from "./c5-eval.ts";
import { catalogPaths, openCatalog } from "../catalog/cli.ts";
import { loadGolden, runGolden, targetWorks, type RetrieveFn } from "../catalog/golden.ts";
import { LOOKALIKE } from "../catalog/lookalike.ts";
import { statsPathFor } from "../catalog/rarity.ts";
import { catalogDf, GENERATION, retrieve } from "../catalog/retrieve.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const log = (s: string) => console.error(`[c8] ${new Date().toISOString().slice(11, 19)} ${s}`);
const r4 = (x: number) => Math.round(x * 10000) / 10000;

/** Today's generation: `retrieve.ts` on main before C-8 (C-3's, as C-5, C-6 and C-7 ran it). */
export const BASE = "3778d46";
/** How deep a reader's candidate list is read: the deepest any F-0 rule looks (C-6's guard). */
export const DEPTH = LOOKALIKE.depth;
/** Bootstrap as C-6 and C-7: paired photo resampling, 2,000 draws, seed 1. */
const REPS = 2000;
const SEED = 1;
/** Golden latency: C-3's harness (one warm-up pass, one timed pass), repeated; the gate reads the median p95. */
const GOLDEN_REPEATS = 3;

export type Arm = "base" | "c8" | "c8u";
export const ARMS: readonly Arm[] = ["base", "c8", "c8u"];
type CatalogName = "v1" | "v2";
const SETS = ["pilot-000", "yardstick-library-b2"] as const;

function privateDir(...sub: string[]): string {
  const d = join(dataRoot(), "private", "c8", ...sub);
  mkdirSync(d, { recursive: true });
  return d;
}
const writePart = (name: string, data: unknown) => writeFileSync(join(privateDir("parts"), `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);
const stamp = (path: string) => {
  const st = statSync(path);
  return `${path.split("/").at(-1)}:${st.size}:${Math.round(st.mtimeMs)}`;
};

/** `retrieve` as it stood at `BASE`, written from git into the private folder and imported from there. */
async function baseRetrieve(): Promise<RetrieveFn> {
  const dir = privateDir(`baseline-${BASE}`);
  for (const f of ["retrieve.ts", "normalize.ts"]) {
    writeFileSync(join(dir, f), execFileSync("git", ["show", `${BASE}:src/catalog/${f}`], { cwd: REPO, encoding: "utf8" }));
  }
  const mod = (await import(pathToFileURL(join(dir, "retrieve.ts")).href)) as { retrieve: RetrieveFn };
  return mod.retrieve;
}

/** C-8's generation, opt-in in `retrieve`. */
export const retrieveC8: RetrieveFn = (db, variants, k) => retrieve(db, variants, k, { generation: "c8" });

async function retrieverFor(arm: Arm): Promise<RetrieveFn> {
  return arm === "base" ? baseRetrieve() : retrieveC8;
}

// ---------------------------------------------------------------------------------------------
// readings: one retrieve per reading
// ---------------------------------------------------------------------------------------------

/** What one reader's text gives: its top work, whether F-0's bar confirms it, and its ranked works to `DEPTH`. */
export interface Facts {
  top: string | null;
  conf: boolean;
  ranked: string[];
  ms: number;
}

const keyOf = (variants: string[]) => variants.join("\u0000");
type Reads = Partial<Record<ReaderName, string[]>>;

/** One reading's key for an arm. Under `c8u` the other readers' text generates too, so the key carries it. */
export function readingKey(arm: Arm, reads: Reads, reader: ReaderName): string | null {
  const own = reads[reader] ?? [];
  if (own.length === 0) return null;
  if (arm !== "c8u") return keyOf(own);
  return `${keyOf(own)}\u0001${READERS.filter((r) => r !== reader).map((r) => keyOf(reads[r] ?? [])).join("\u0002")}`;
}

/** Other readers' text on the spine: what `c8u` passes as `generateFrom`. */
export function othersOf(reads: Reads, reader: ReaderName): string[] {
  return READERS.filter((r) => r !== reader).flatMap((r) => reads[r] ?? []);
}

function spineReads(set: string): Map<string, Reads> {
  const readings = loadReadings(stageDir(dataRoot(), set));
  const out = new Map<string, Reads>();
  for (const [id, reads] of readings) out.set(id, Object.fromEntries(Object.entries(reads).map(([k, r]) => [k, variantsOf(r)]).filter(([, v]) => v!.length > 0)) as Reads);
  return out;
}

/** Every distinct (key, own text, other text) an arm retrieves for, in a stable order. */
function jobs(set: string, arm: Arm): Array<{ key: string; own: string[]; others: string[] }> {
  const out = new Map<string, { key: string; own: string[]; others: string[] }>();
  for (const reads of spineReads(set).values()) {
    for (const reader of READERS) {
      const key = readingKey(arm, reads, reader);
      if (key && !out.has(key)) out.set(key, { key, own: reads[reader]!, others: arm === "c8u" ? othersOf(reads, reader) : [] });
    }
  }
  return [...out.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

async function readingsStage(set: string, cat: CatalogName, path: string, arm: Arm, shard: [number, number]): Promise<void> {
  const all = jobs(set, arm);
  const mine = all.filter((_, i) => i % shard[1] === shard[0]);
  log(`${set} on ${cat}, ${arm}: ${mine.length} of ${all.length} readings (shard ${shard[0] + 1}/${shard[1]})`);
  const db = openCatalog(path);
  if (arm !== "base" && !catalogDf(db)) throw new Error(`${path}: no statistics sidecar in force; run \`bookcase catalog stats\``);
  const run = await retrieverFor(arm);
  const out: Record<string, Facts> = {};
  let n = 0;
  for (const j of mine) {
    const t0 = performance.now();
    const ranked = arm === "c8u" ? retrieve(db, j.own, DEPTH, { generation: "c8", generateFrom: j.others }) : run(db, j.own, DEPTH);
    const ms = performance.now() - t0;
    out[j.key] = { top: ranked[0]?.workId ?? null, conf: confirms(ranked[0]), ranked: ranked.map((c) => c.workId), ms: Math.round(ms * 10) / 10 };
    if (++n % 500 === 0) log(`  ${n}/${mine.length}`);
  }
  db.close();
  writeFileSync(join(privateDir("readings"), `${set}.${cat}.${arm}.${shard[0] + 1}of${shard[1]}.json`), JSON.stringify({ catalog: stamp(path), stats: arm === "base" ? null : stamp(statsPathFor(path)), facts: out }));
}

function loadFacts(set: string, cat: CatalogName, arm: Arm, path: string): Map<string, Facts> {
  const dir = privateDir("readings");
  const out = new Map<string, Facts>();
  for (const f of readdirSync(dir).filter((f) => f.startsWith(`${set}.${cat}.${arm}.`))) {
    const j = JSON.parse(readFileSync(join(dir, f), "utf8")) as { catalog: string; stats: string | null; facts: Record<string, Facts> };
    if (j.catalog !== stamp(path)) throw new Error(`${f} was made on ${j.catalog}, not ${stamp(path)}`);
    if (arm !== "base" && j.stats !== stamp(statsPathFor(path))) throw new Error(`${f} was made with stats ${j.stats}, not ${stamp(statsPathFor(path))}`);
    for (const [k, v] of Object.entries(j.facts)) out.set(k, v);
  }
  return out;
}

/** C-7's cached facts on the same readings (private/c7/readings): today's top work and F-0's bar, for the gate. */
function c7Facts(set: string, cat: CatalogName): Map<string, { top: string | null; conf: boolean }> | null {
  const dir = join(dataRoot(), "private", "c7", "readings");
  if (!existsSync(dir)) return null;
  const out = new Map<string, { top: string | null; conf: boolean }>();
  for (const f of readdirSync(dir).filter((f) => f.startsWith(`${set}.${cat}.`))) {
    for (const [k, v] of Object.entries((JSON.parse(readFileSync(join(dir, f), "utf8")) as { facts: Record<string, { top: string | null; conf: boolean }> }).facts)) out.set(k, v);
  }
  return out.size ? out : null;
}

// ---------------------------------------------------------------------------------------------
// decide: F-0's vote per arm, candidate recall
// ---------------------------------------------------------------------------------------------

export interface ArmDecision {
  id: string;
  imageId: string;
  accepted: string | null;
  reason: SpineDecision["reason"];
  wrong: boolean | null;
}

/** F-0's vote on one spine from cached facts (F-0's `vote` and bar, unchanged): each reader votes on its own text. */
export function decideFromFacts(arm: Arm, reads: Reads, facts: Map<string, Facts>): ReaderVotes {
  const votes: ReaderVotes = { readText: {}, top: {}, confirmed: {} };
  for (const reader of READERS) {
    const key = readingKey(arm, reads, reader);
    if (reads[reader] === undefined) continue;
    votes.readText[reader] = key !== null;
    const f = key ? facts.get(key) : undefined;
    if (key && !f) throw new Error("a reading has no cached facts: run `readings` first");
    votes.top[reader] = f?.top ?? null;
    votes.confirmed[reader] = f?.conf ? f.top : null;
  }
  return votes;
}

type Ci = { value: number; lo: number; hi: number } | null;
const ci = <T extends { imageId: string }>(rows: T[], stat: (x: T[]) => number | null): Ci => {
  const c = clusterBootstrap(rows, stat, REPS, SEED);
  return c && { value: r4(c.value), lo: r4(c.lo), hi: r4(c.hi) };
};
const shareOf = <T>(x: T[], f: (r: T) => boolean) => (x.length ? x.filter(f).length / x.length : null);
const wrongShare = (x: ArmDecision[]) => {
  const a = x.filter((r) => r.accepted);
  return a.length ? a.filter((r) => r.wrong).length / a.length : null;
};
const quant = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]! : null;
};

/** Candidate recall on one spine: the first depth at which some reader's list holds a right work (null: none). */
export interface RecallRow {
  imageId: string;
  /** Best rank of a right work over the spine's readers (1-based), or null. */
  spineRank: number | null;
  /** Per reading: best rank of a right work in that reader's own list, or null. */
  readerRanks: Array<number | null>;
}

function recallRows(arm: Arm, spines: Array<{ id: string; imageId: string; reads: Reads }>, facts: Map<string, Facts>, right: (workId: string, imageId: string) => boolean): RecallRow[] {
  return spines.flatMap((s) => {
    const ranks: Array<number | null> = [];
    for (const reader of READERS) {
      const key = readingKey(arm, s.reads, reader);
      if (!key) continue;
      const i = facts.get(key)!.ranked.findIndex((w) => right(w, s.imageId));
      ranks.push(i >= 0 ? i + 1 : null);
    }
    if (ranks.length === 0) return [];
    const best = ranks.filter((r): r is number => r !== null);
    return [{ imageId: s.imageId, spineRank: best.length ? Math.min(...best) : null, readerRanks: ranks }];
  });
}

const recallAt = (rows: RecallRow[], k: number) => shareOf(rows, (r) => r.spineRank !== null && r.spineRank <= k);

function decideStage(set: string, paths: Record<CatalogName, string>): void {
  const dir = stageDir(dataRoot(), set);
  const decisions = readJsonl<SpineDecision>(join(dir, "decisions.jsonl"));
  const all = spineReads(set);
  const proxy = set.startsWith("yardstick");
  const truth = proxy ? yardstickBooks() : null;
  const spines = decisions.map((d) => ({ id: d.id, imageId: d.imageId, reads: all.get(d.id) ?? {} }));

  const byArm: Record<string, Record<CatalogName, ArmDecision[]>> = {};
  const gate: Record<string, unknown> = {};
  const extra: Record<string, Record<string, unknown>> = {};
  for (const cat of ["v1", "v2"] as const) {
    const db = openCatalog(paths[cat]);
    const judged = new Map<string, boolean>();
    const right = (workId: string, imageId: string) => {
      const k = `${imageId}\u0000${workId}`;
      if (!judged.has(k)) judged.set(k, isAnnotated(db, workId, truth!.get(imageId) ?? []));
      return judged.get(k)!;
    };
    const facts = Object.fromEntries(ARMS.map((a) => [a, loadFacts(set, cat, a, paths[cat])])) as Record<Arm, Map<string, Facts>>;
    for (const arm of ARMS) {
      byArm[arm] ??= {} as Record<CatalogName, ArmDecision[]>;
      byArm[arm][cat] = spines.map((s) => {
        const v = vote(decideFromFacts(arm, s.reads, facts[arm]));
        return { id: s.id, imageId: s.imageId, accepted: v.acceptedId, reason: v.reason, wrong: v.acceptedId && truth ? !right(v.acceptedId, s.imageId) : null };
      });
    }
    // Gate 1: today's generation reproduces C-7's cached top work and bar on every reading.
    const c7 = c7Facts(set, cat);
    const same = c7 ? [...facts.base].filter(([k, f]) => { const x = c7.get(k); return x && x.top === f.top && x.conf === f.conf; }).length / facts.base.size : null;
    // Gate 2: its re-decisions match C-5's cached ones (accepted work and reason).
    const c5 = c5Cache(set, cat);
    const c5Same = c5 ? byArm.base![cat].filter((r) => { const x = c5.get(r.id); return x && x.accepted === r.accepted && x.reason === r.reason; }).length / decisions.length : null;
    gate[cat] = { reproducesC7Facts: same === null ? null : r4(same), reproducesC5: c5Same === null ? null : r4(c5Same), readings: Object.fromEntries(ARMS.map((a) => [a, facts[a].size])) };
    log(`${set} ${cat}: base reproduces C-7's facts on ${gate[cat] && (gate[cat] as { reproducesC7Facts: number }).reproducesC7Facts}, C-5 on ${c5Same === null ? null : r4(c5Same)}`);
    for (const [name, g] of [["C-7", same], ["C-5", c5Same]] as const) if (g !== null && g < 0.999) throw new Error(`${set} ${cat}: reproduction of ${name} ${r4(g)} under the 0.999 gate`);

    const ms = (a: Arm) => [...facts[a].values()].map((f) => f.ms);
    extra[cat] = {
      latencyPerReadingMs: Object.fromEntries(ARMS.map((a) => [a, { n: ms(a).length, p50: quant(ms(a), 0.5), p95: quant(ms(a), 0.95), max: quant(ms(a), 1) }])),
      listLength: Object.fromEntries(ARMS.map((a) => [a, { p50: quant([...facts[a].values()].map((f) => f.ranked.length), 0.5), full: [...facts[a].values()].filter((f) => f.ranked.length === DEPTH).length }])),
    };
    if (proxy) {
      const rows = Object.fromEntries(ARMS.map((a) => [a, recallRows(a, spines, facts[a], right)])) as Record<Arm, RecallRow[]>;
      const recall: Record<string, unknown> = {};
      for (const a of ARMS) {
        const readers = rows[a].flatMap((r) => r.readerRanks);
        const paired = rows[a].map((r, i) => ({ imageId: r.imageId, a: rows.base[i]!, b: r }));
        recall[a] = {
          spineCount: rows[a].length,
          at1: ci(rows[a], (x) => recallAt(x, 1)),
          at5: ci(rows[a], (x) => recallAt(x, 5)),
          anywhere: ci(rows[a], (x) => recallAt(x, DEPTH)),
          perReadingAnywhere: shareOf(readers, (r) => r !== null) === null ? null : r4(shareOf(readers, (r) => r !== null)!),
          deltaVsBase: a === "base" ? null : {
            anywhere: ci(paired, (x) => (x.length ? (x.filter((p) => p.b.spineRank !== null).length - x.filter((p) => p.a.spineRank !== null).length) / x.length : null)),
            at5: ci(paired, (x) => (x.length ? (x.filter((p) => p.b.spineRank !== null && p.b.spineRank <= 5).length - x.filter((p) => p.a.spineRank !== null && p.a.spineRank <= 5).length) / x.length : null)),
            gainedAnywhere: paired.filter((p) => p.b.spineRank !== null && p.a.spineRank === null).length,
            lostAnywhere: paired.filter((p) => p.b.spineRank === null && p.a.spineRank !== null).length,
          },
        };
      }
      extra[cat]!.candidateRecall = recall;
    }
    db.close();
  }
  writeFileSync(join(privateDir("decisions"), `${set}.json`), JSON.stringify(byArm));

  const summary = (rows: ArmDecision[], cat: CatalogName) => {
    const base = byArm.base![cat];
    const acc = rows.filter((r) => r.accepted);
    const reasons: Record<string, number> = {};
    for (const r of rows) if (r.reason) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
    const paired = rows.map((r, i) => ({ imageId: r.imageId, a: base[i]!, b: r }));
    const pairedDelta = (f: (r: ArmDecision) => boolean) => ci(paired, (x) => (x.length ? (x.filter((p) => f(p.b)).length - x.filter((p) => f(p.a)).length) / x.length : null));
    return {
      confirmed: acc.length,
      confirmedShare: ci(rows, (x) => shareOf(x, (r) => r.accepted !== null)),
      confirmedOpenLibraryWorks: acc.filter((r) => r.accepted!.startsWith("ol:")).length,
      unknownByReason: reasons,
      vsBase: {
        gained: rows.filter((r, i) => r.accepted && !base[i]!.accepted).length,
        lost: rows.filter((r, i) => !r.accepted && base[i]!.accepted).length,
        switched: rows.filter((r, i) => r.accepted && base[i]!.accepted && r.accepted !== base[i]!.accepted).length,
        same: rows.filter((r, i) => r.accepted && r.accepted === base[i]!.accepted).length,
        confirmedShare: pairedDelta((r) => r.accepted !== null),
        ...(proxy ? { wrongPerSpine: pairedDelta((r) => r.wrong === true), wrongAmongGained: rows.filter((r, i) => r.accepted && r.accepted !== base[i]!.accepted && r.wrong).length, wrongAmongLost: rows.filter((r, i) => !r.accepted && base[i]!.accepted && base[i]!.wrong).length } : {}),
      },
      ...(proxy
        ? {
            wrongAccepts: acc.filter((r) => r.wrong).length,
            correctAccepts: acc.filter((r) => !r.wrong).length,
            wrongAcceptShareOfAccepted: ci(rows, wrongShare),
            wrongAcceptShareOfSpines: ci(rows, (x) => shareOf(x, (r) => r.wrong === true)),
          }
        : {}),
    };
  };
  const arms = Object.fromEntries(ARMS.map((a) => [a, Object.fromEntries((["v1", "v2"] as const).map((cat) => [cat, summary(byArm[a]![cat], cat)]))]));
  // Under c8u, accepts the shared generation alone makes: the reader's own generation (c8) does not accept that work.
  const sharedOnly = Object.fromEntries((["v1", "v2"] as const).map((cat) => [cat, byArm.c8u![cat].filter((r, i) => r.accepted && r.accepted !== byArm.c8![cat][i]!.accepted).length]));
  writePart(`decide-${set}`, {
    set, scope: proxy ? "yardstick (PROXY): wrong accepts and candidate recall against the annotated books of each image (C-5's judge)" : "real use (OC35): machine agreement only, never accuracy (INV-17)",
    spineCount: decisions.length, images: new Set(decisions.map((d) => d.imageId)).size, readingSet: "all-crops", accept: ACCEPT, depth: DEPTH,
    bootstrap: { reps: REPS, seed: SEED, unit: "photo" }, gate, ...extra, arms, acceptsFromSharedGenerationOnly: sharedOnly,
  });
  log(`${set}: written`);
}

// ---------------------------------------------------------------------------------------------
// golden: both generations, both catalogs
// ---------------------------------------------------------------------------------------------

async function goldenStage(paths: Record<CatalogName, string>): Promise<void> {
  const file = "evals/golden/fragments.jsonl";
  const queries = loadGolden(join(REPO, file));
  const runs: Record<string, Record<string, unknown>> = {};
  const fns: Record<"base" | "c8", RetrieveFn> = { base: await baseRetrieve(), c8: retrieveC8 };
  for (const cat of ["v1", "v2"] as const) {
    const db = openCatalog(paths[cat]);
    if (!catalogDf(db)) throw new Error(`${paths[cat]}: no statistics sidecar in force`);
    const latency: Record<string, Array<{ p50: number; p95: number; max: number; mean: number }>> = { base: [], c8: [] };
    let last: Record<string, ReturnType<typeof runGolden>> = {};
    for (let rep = 0; rep < GOLDEN_REPEATS; rep++) {
      for (const g of ["base", "c8"] as const) {
        log(`golden ${cat} ${g} run ${rep + 1}/${GOLDEN_REPEATS}`);
        const run = runGolden(db, queries, file, 10, fns[g]);
        latency[g]!.push({ p50: run.latencyMs.p50, p95: run.latencyMs.p95, max: run.latencyMs.max, mean: run.latencyMs.mean });
        last = { ...last, [g]: run };
      }
    }
    // Where each query's target sits at the full depth, for the losses (is it generated at all?).
    const deepRank = (g: "base" | "c8", id: string) => {
      const q = queries.find((x) => x.id === id)!;
      const t = targetWorks(db, q.expect!);
      const i = fns[g](db, q.variants, DEPTH).findIndex((c) => t.has(c.workId));
      return i >= 0 ? i + 1 : null;
    };
    const rank = (g: "base" | "c8") => new Map(last[g]!.results.map((r) => [r.id, r]));
    const b = rank("base");
    const c = rank("c8");
    const scored = last.c8!.results.filter((r) => r.class !== "none" && r.inCatalog);
    const outOfTop5 = (g: "base" | "c8") => scored.filter((r) => { const x = (g === "base" ? b : c).get(r.id)!; return x.rank === null || x.rank > 5; }).map((r) => r.id);
    const changed = scored.filter((r) => b.get(r.id)!.rank !== c.get(r.id)!.rank).map((r) => ({ id: r.id, class: r.class, noise: r.noise, base: b.get(r.id)!.rank, c8: c.get(r.id)!.rank }));
    const med = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)]!;
    runs[cat] = {
      catalog: stamp(paths[cat]), stats: stamp(statsPathFor(paths[cat])),
      gaps: last.c8!.gaps,
      rates: { base: last.base!.rates, c8: last.c8!.rates },
      none: { base: last.base!.none, c8: last.c8!.none },
      outOfTop5: Object.fromEntries((["base", "c8"] as const).map((g) => [g, outOfTop5(g).map((id) => ({ id, top10Rank: (g === "base" ? b : c).get(id)!.rank, rankAtDepth: deepRank(g, id) }))])),
      rankChanged: changed,
      latencyMs: { runs: latency, medianP95: { base: med(latency.base!.map((x) => x.p95)), c8: med(latency.c8!.map((x) => x.p95)) } },
    };
    db.close();
  }
  writePart("golden", { goldenFile: file, repeats: GOLDEN_REPEATS, generation: GENERATION, ...runs, host: { cpu: cpus()[0]?.model ?? "unknown", cores: cpus().length, node: process.version } });
}

// ---------------------------------------------------------------------------------------------
// publish: the keep rule, and the parts joined into evals/C8/metrics.json
// ---------------------------------------------------------------------------------------------

type PartJson = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The pre-registered keep rule (evals/C8/report.md § Keep rule). */
export function keepRule(golden: PartJson, yard: PartJson) {
  const cats = ["v1", "v2"] as const;
  const g1 = cats.every((c) => golden[c].rates.c8.clean.top5 >= 0.9);
  const noisyFull = Object.fromEntries(cats.map((c) => [c, golden[c].rates.c8.noisy.top5 === 1]));
  const l1 = golden.v2.latencyMs.medianP95.c8 <= 300;
  const recall = (arm: "c8" | "c8u", c: "v1" | "v2") => yard[c].candidateRecall[arm].deltaVsBase.anywhere.value;
  const r1 = cats.every((c) => recall("c8", c) >= -0.01);
  const c8 = { goldenClean: g1, goldenNoisyFull: noisyFull, latencyV2: l1, recall: r1, pass: g1 && l1 && r1 };
  // c8u is recommended for F-0's decision layer only on top of c8's pass, with more recall and no more wrong accepts.
  const u = cats.map((c) => ({
    c,
    moreRecall: recall("c8u", c) > recall("c8", c),
    noMoreWrong: yard.arms.c8u[c].wrongAccepts <= yard.arms.c8[c].wrongAccepts,
  }));
  return { c8, c8u: { perCatalog: u, recommend: c8.pass && u.every((x) => x.moreRecall && x.noMoreWrong) } };
}

function publish(): void {
  const dir = privateDir("parts");
  const parts = Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(join(dir, f), "utf8")) as PartJson]));
  for (const need of ["golden", ...SETS.map((s) => `decide-${s}`)]) if (!parts[need]) throw new Error(`missing part ${need}`);
  const keep = keepRule(parts.golden!, parts["decide-yardstick-library-b2"]!);
  let code: string | null = null;
  try {
    code = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    /* not a checkout */
  }
  const out = join(REPO, "evals", "C8");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "metrics.json"), `${JSON.stringify({ runId: "C8", card: "C-8", date: new Date().toLocaleDateString("en-CA"), code, base: BASE, arms: ARMS, keep, ...parts }, null, 2)}\n`);
  log(`published -> evals/C8/metrics.json (c8 passes: ${keep.c8.pass}; c8u recommended: ${keep.c8u.recommend})`);
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const { values } = parseArgs({ args: rest, options: { set: { type: "string" }, catalog: { type: "string" }, arm: { type: "string" }, shard: { type: "string" }, v1: { type: "string" }, v2: { type: "string" } } });
  const p = catalogPaths({ ...process.env, BOOKCASE_CATALOG: "" });
  const paths: Record<CatalogName, string> = { v1: values.v1 ?? join(dataRoot(), "catalog", "catalog.sqlite"), v2: values.v2 ?? p.catalogV2 };
  if (cmd !== "publish") for (const f of Object.values(paths)) if (!existsSync(f)) throw new Error(`catalog missing: ${f}`);
  const set = values.set ?? "pilot-000";
  if (cmd === "readings") {
    const cat = (values.catalog ?? "v1") as CatalogName;
    const arm = (values.arm ?? "c8") as Arm;
    if (!ARMS.includes(arm)) throw new Error(`--arm must be one of ${ARMS.join(", ")}`);
    const [k, n] = (values.shard ?? "1/1").split("/").map(Number);
    await readingsStage(set, cat, paths[cat], arm, [k! - 1, n!]);
  } else if (cmd === "decide") decideStage(set, paths);
  else if (cmd === "golden") await goldenStage(paths);
  else if (cmd === "publish") publish();
  else {
    console.error("usage: node src/eval/c8-eval.ts <readings|golden|decide|publish> [--set <name>] [--catalog v1|v2] [--arm base|c8|c8u] [--shard k/n]");
    return 1;
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    },
  );
}

