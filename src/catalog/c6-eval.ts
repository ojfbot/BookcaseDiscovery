// C-6 evaluation: the lookalike guard (src/catalog/lookalike.ts) on F-0's cached readings, re-decided offline on v1
// (`catalog.sqlite`) and v2 (`catalog-v2.sqlite`) with and without each arm, plus C-3's golden fragments.
// No detection, no reading, no GPU, no network. Pre-registration and keep rule: evals/C6/report.md.
//
//   node src/catalog/c6-eval.ts readings --set <pilot-000|yardstick-library-b2> --catalog <v1|v2> [--shard k/n]
//                                        one retrieve per distinct reading, with the guard's verdicts on its top candidate
//   node src/catalog/c6-eval.ts decide   --set <name>     every arm on both catalogs, from the readings above
//   node src/catalog/c6-eval.ts golden                    golden fragments on both catalogs: rates, refusals, latency
//   node src/catalog/c6-eval.ts publish                   the keep rule, and the parts joined into evals/C6/metrics.json
//
// Per-reading and per-spine files (they hold reader text and work ids) stay in the data root's private folder (private/c6/); only
// aggregates are written to evals/C6/.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { dataRoot } from "../ledger/images.ts";
import { ACCEPT, confirms, loadReadings, READERS, readJsonl, stageDir, variantsOf, vote, type ReaderName, type ReaderVotes, type SpineDecision } from "../eval/f0.ts";
import { clusterBootstrap } from "../eval/q1.ts";
import { isAnnotated, yardstickBooks } from "./c5-eval.ts";
import { catalogPaths, openCatalog } from "./cli.ts";
import { loadGolden, runGolden, targetWorks } from "./golden.ts";
import { GUARD_ARMS, LOOKALIKE, lookalikeGuard, lookalikeWhy, marginOf, titleWords, type GuardArm } from "./lookalike.ts";
import { retrieve, type Candidate } from "./retrieve.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const log = (s: string) => console.error(`[c6] ${new Date().toISOString().slice(11, 19)} ${s}`);
const r4 = (x: number) => Math.round(x * 10000) / 10000;

/** Bootstrap as pre-registered: paired photo resampling, 2,000 draws, seed 1. */
const REPS = 2000;
const SEED = 1;

/** The pre-registered arms: none (F-0's bar alone), each arm alone, and two combinations. */
export const C6_ARMS: Record<string, readonly GuardArm[]> = { none: [], a: ["margin"], b: ["author"], c: ["short"], "a+b+c": GUARD_ARMS, "a+b": ["margin", "author"] };
type CatalogName = "v1" | "v2";
const SETS = ["pilot-000", "yardstick-library-b2"] as const;

function privateDir(...sub: string[]): string {
  const d = join(dataRoot(), "private", "c6", ...sub);
  mkdirSync(d, { recursive: true });
  return d;
}
const writePart = (name: string, data: unknown) => writeFileSync(join(privateDir("parts"), `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);
const stamp = (path: string) => {
  const st = statSync(path);
  return `${path.split("/").at(-1)}:${st.size}:${Math.round(st.mtimeMs)}`;
};

// ---------------------------------------------------------------------------------------------
// readings: one retrieve per distinct reading, and the guard's verdict per arm on its top candidate
// ---------------------------------------------------------------------------------------------

/** What one reader's text gives on one catalog: its top candidate, F-0's bar, and each arm's verdict on it. */
export interface ReadingFacts {
  top: string | null;
  conf: boolean;
  /** The arm would withdraw this confirmation (only set when `conf`). */
  block: Record<GuardArm, boolean>;
  margin: number | null;
  author: number;
  words: number;
  holders: number | null;
  ms: number;
}

const evidenceOf = (c: Candidate, f: "title" | "author" | "series") => c.evidence.find((e) => e.field === f)?.score ?? 0;

/** Facts for one ranked candidate list (`retrieve` to the guard's depth). */
export function factsOf(ranked: Candidate[], guard: ReturnType<typeof lookalikeGuard>, ms = 0): ReadingFacts {
  const c = ranked[0];
  const none = { margin: false, author: false, short: false };
  if (!c) return { top: null, conf: false, block: none, margin: null, author: 0, words: 0, holders: null, ms };
  const conf = confirms(c);
  const author = evidenceOf(c, "author");
  const words = titleWords(c);
  const needsHolders = words > 1 && author <= 0;
  const holders = conf && needsHolders ? guard.holders(c.evidence.find((e) => e.field === "title")?.form ?? "") : null;
  const input = { candidate: c, ranked, holders: holders ?? 0, forms: guard.forms };
  const block = conf ? (Object.fromEntries(GUARD_ARMS.map((a) => [a, lookalikeWhy(input, new Set([a])) !== null])) as Record<GuardArm, boolean>) : none;
  return { top: c.workId, conf, block, margin: conf ? marginOf(c, ranked, guard.forms) : null, author, words, holders, ms };
}

const keyOf = (variants: string[]) => variants.join("\u0000");

function readingKeys(set: string): string[][] {
  const readings = loadReadings(stageDir(dataRoot(), set));
  const keys = new Map<string, string[]>();
  for (const reads of readings.values()) for (const r of Object.values(reads)) {
    const v = variantsOf(r);
    if (v.length) keys.set(keyOf(v), v);
  }
  return [...keys.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([, v]) => v);
}

function readingsStage(set: string, cat: CatalogName, path: string, shard: [number, number]): void {
  const all = readingKeys(set);
  const mine = all.filter((_, i) => i % shard[1] === shard[0]);
  log(`${set} on ${cat}: ${mine.length} of ${all.length} readings (shard ${shard[0] + 1}/${shard[1]})`);
  const db = openCatalog(path);
  const guard = lookalikeGuard(db);
  const out: Record<string, ReadingFacts> = {};
  let n = 0;
  for (const v of mine) {
    const t0 = performance.now();
    const ranked = retrieve(db, v, LOOKALIKE.depth);
    const ms = performance.now() - t0;
    out[keyOf(v)] = factsOf(ranked, guard, Math.round(ms * 10) / 10);
    if (++n % 500 === 0) log(`  ${n}/${mine.length}`);
  }
  db.close();
  writeFileSync(join(privateDir("readings"), `${set}.${cat}.${shard[0] + 1}of${shard[1]}.json`), JSON.stringify({ catalog: stamp(path), facts: out }));
}

function loadFacts(set: string, cat: CatalogName, path: string): Map<string, ReadingFacts> {
  const dir = privateDir("readings");
  const out = new Map<string, ReadingFacts>();
  for (const f of readdirSync(dir).filter((f) => f.startsWith(`${set}.${cat}.`))) {
    const j = JSON.parse(readFileSync(join(dir, f), "utf8")) as { catalog: string; facts: Record<string, ReadingFacts> };
    if (j.catalog !== stamp(path)) throw new Error(`${f} was made on ${j.catalog}, not ${stamp(path)}`);
    for (const [k, v] of Object.entries(j.facts)) out.set(k, v);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// decide: every arm on both catalogs
// ---------------------------------------------------------------------------------------------

export interface ArmDecision {
  id: string;
  imageId: string;
  accepted: string | null;
  reason: SpineDecision["reason"];
  wrong: boolean | null;
  /** Readers whose confirmation the arm withdrew. */
  withdrawn: number;
}

/** Re-decide one spine from cached reading facts, with the arms in force (F-0's `vote`, unchanged). */
export function decideFromFacts(reads: Partial<Record<ReaderName, { variants: string[] }>>, facts: Map<string, ReadingFacts>, arms: readonly GuardArm[]): { votes: ReaderVotes; withdrawn: number } {
  const votes: ReaderVotes = { readText: {}, top: {}, confirmed: {} };
  let withdrawn = 0;
  for (const reader of READERS) {
    const r = reads[reader];
    if (!r) continue;
    votes.readText[reader] = r.variants.length > 0;
    const f = r.variants.length ? facts.get(keyOf(r.variants)) : undefined;
    if (r.variants.length && !f) throw new Error("a reading has no cached facts: run `readings` first");
    votes.top[reader] = f?.top ?? null;
    const blocked = !!f?.conf && arms.some((a) => f.block[a]);
    if (blocked) withdrawn++;
    votes.confirmed[reader] = f?.conf && !blocked ? f.top : null;
  }
  return { votes, withdrawn };
}

/** C-5's cached unguarded re-decisions (private), for the reproduction gate. */
function c5Cache(set: string, cat: CatalogName): Map<string, { accepted: string | null; reason: string | null }> | null {
  const dir = join(dataRoot(), "catalog", "c5", "private");
  if (!existsSync(dir)) return null;
  const file = cat === "v2" ? `${set}.all-crops.catalog-v2.sqlite.` : set.startsWith("yardstick") ? `${set}.all-crops.catalog.sqlite.` : `${set}.all-crops.base.catalog.sqlite.`;
  const f = readdirSync(dir).find((x) => x.startsWith(file));
  if (!f) return null;
  const rows = JSON.parse(readFileSync(join(dir, f), "utf8")) as Array<{ id: string; accepted: string | null; reason: string | null }>;
  return new Map(rows.map((r) => [r.id, r]));
}

type Ci = { value: number; lo: number; hi: number } | null;
const ci = <T extends { imageId: string }>(rows: T[], stat: (x: T[]) => number | null): Ci => {
  const c = clusterBootstrap(rows, stat, REPS, SEED);
  return c && { value: r4(c.value), lo: r4(c.lo), hi: r4(c.hi) };
};
const shareOf = <T>(x: T[], f: (r: T) => boolean) => (x.length ? x.filter(f).length / x.length : null);

/** Distinct accepted works per photo (one row per photo, so the bootstrap draws photos). */
function worksPerPhoto(rows: ArmDecision[]): Array<{ imageId: string; n: number }> {
  const m = new Map<string, Set<string>>();
  for (const r of rows) {
    const s = m.get(r.imageId) ?? new Set<string>();
    if (r.accepted) s.add(r.accepted);
    m.set(r.imageId, s);
  }
  return [...m.entries()].map(([imageId, s]) => ({ imageId, n: s.size }));
}

function decideStage(set: string, paths: Record<CatalogName, string>): void {
  const dir = stageDir(dataRoot(), set);
  const decisions = readJsonl<SpineDecision>(join(dir, "decisions.jsonl"));
  const readings = loadReadings(dir);
  const proxy = set.startsWith("yardstick");
  const truth = proxy ? yardstickBooks() : null;
  const reads = new Map(decisions.map((d) => [d.id, Object.fromEntries(Object.entries(readings.get(d.id) ?? {}).map(([k, r]) => [k, { variants: variantsOf(r) }])) as Partial<Record<ReaderName, { variants: string[] }>>]));

  const byArm: Record<string, Record<CatalogName, ArmDecision[]>> = {};
  const reproduced: Record<string, number | null> = {};
  const readingLatency: Record<string, unknown> = {};
  for (const cat of ["v1", "v2"] as const) {
    const facts = loadFacts(set, cat, paths[cat]);
    const db = openCatalog(paths[cat]);
    const judged = new Map<string, boolean>();
    const judge = (workId: string, imageId: string) => {
      const k = `${imageId}\u0000${workId}`;
      if (!judged.has(k)) judged.set(k, !isAnnotated(db, workId, truth!.get(imageId) ?? []));
      return judged.get(k)!;
    };
    const ms = [...facts.values()].map((f) => f.ms).sort((a, b) => a - b);
    const q = (p: number) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))] ?? null;
    readingLatency[cat] = { readings: ms.length, p50: q(0.5), p95: q(0.95), max: ms.at(-1) ?? null };
    for (const [arm, arms] of Object.entries(C6_ARMS)) {
      const rows = decisions.map((d): ArmDecision => {
        const { votes, withdrawn } = decideFromFacts(reads.get(d.id)!, facts, arms);
        const v = vote(votes);
        return { id: d.id, imageId: d.imageId, accepted: v.acceptedId, reason: v.reason, wrong: v.acceptedId && truth ? judge(v.acceptedId, d.imageId) : null, withdrawn };
      });
      (byArm[arm] ??= {} as Record<CatalogName, ArmDecision[]>)[cat] = rows;
    }
    db.close();
    const c5 = c5Cache(set, cat);
    reproduced[cat] = c5 ? r4(byArm.none![cat].filter((r) => { const x = c5.get(r.id); return x && x.accepted === r.accepted && x.reason === r.reason; }).length / decisions.length) : null;
    log(`${set} ${cat}: reproduces C-5's unguarded re-decisions on ${reproduced[cat]}`);
    if (reproduced[cat] !== null && reproduced[cat]! < 0.999) throw new Error(`${set} ${cat}: reproduction ${reproduced[cat]} under the 0.999 gate`);
  }
  // Per-spine decisions stay private.
  writeFileSync(join(privateDir("decisions"), `${set}.json`), JSON.stringify(byArm));

  const base = byArm.none!.v1;
  const summary = (rows: ArmDecision[]) => {
    const acc = rows.filter((r) => r.accepted);
    const reasons: Record<string, number> = {};
    for (const r of rows) if (r.reason) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
    const paired = rows.map((r, i) => ({ imageId: r.imageId, a: base[i]!, b: r }));
    const wpp = worksPerPhoto(rows);
    const wppBase = new Map(worksPerPhoto(base).map((x) => [x.imageId, x.n]));
    return {
      confirmed: acc.length,
      confirmedShare: ci(rows, (x) => shareOf(x, (r) => r.accepted !== null)),
      confirmedOpenLibraryWorks: acc.filter((r) => r.accepted!.startsWith("ol:")).length,
      readersWithdrawn: rows.reduce((s, r) => s + r.withdrawn, 0),
      unknownByReason: reasons,
      ...(proxy
        ? {
            wrongAccepts: acc.filter((r) => r.wrong).length,
            wrongAcceptShareOfAccepted: ci(rows, (x) => { const a = x.filter((r) => r.accepted); return a.length ? a.filter((r) => r.wrong).length / a.length : null; }),
            wrongAcceptShareOfSpines: ci(rows, (x) => shareOf(x, (r) => r.wrong === true)),
          }
        : { distinctWorksPerPhoto: ci(wpp, (x) => (x.length ? x.reduce((s, r) => s + r.n, 0) / x.length : null)) }),
      deltaVsV1: {
        confirmedShare: ci(paired, (x) => (x.length ? (x.filter((p) => p.b.accepted).length - x.filter((p) => p.a.accepted).length) / x.length : null)),
        ...(proxy
          ? { wrongAcceptShareOfSpines: ci(paired, (x) => (x.length ? (x.filter((p) => p.b.wrong).length - x.filter((p) => p.a.wrong).length) / x.length : null)) }
          : { distinctWorksPerPhoto: ci(wpp, (x) => (x.length ? x.reduce((s, r) => s + r.n - wppBase.get(r.imageId)!, 0) / x.length : null)) }),
      },
    };
  };

  const out: Record<string, unknown> = {};
  for (const [arm, cats] of Object.entries(byArm)) {
    out[arm] = Object.fromEntries((["v1", "v2"] as const).map((cat) => {
      const rows = cats[cat];
      const unguarded = byArm.none![cat];
      const withdrawnAccepts = rows.filter((r, i) => unguarded[i]!.accepted && !r.accepted);
      const changed = rows.filter((r, i) => r.accepted && r.accepted !== unguarded[i]!.accepted).length;
      return [cat, { ...summary(rows), acceptsWithdrawn: withdrawnAccepts.length, acceptsChangedToAnotherWork: changed, ...(proxy ? { wrongAmongWithdrawn: unguarded.filter((r, i) => r.accepted && !rows[i]!.accepted && r.wrong).length } : {}) }];
    }));
  }
  // C-5's switched confirmations: v1 accepted one work, v2 (unguarded) another. How many each arm withdraws on v2.
  const v1 = byArm.none!.v1;
  const v2 = byArm.none!.v2;
  const switched = v1.map((r, i) => i).filter((i) => v1[i]!.accepted && v2[i]!.accepted && v1[i]!.accepted !== v2[i]!.accepted);
  const switchedWithdrawn = Object.fromEntries(Object.entries(byArm).map(([arm, cats]) => [arm, switched.filter((i) => !cats.v2[i]!.accepted).length]));
  const backToV1 = Object.fromEntries(Object.entries(byArm).map(([arm, cats]) => [arm, switched.filter((i) => cats.v2[i]!.accepted === v1[i]!.accepted).length]));
  writePart(`decide-${set}`, {
    set, scope: proxy ? "yardstick (PROXY): wrong accepts against the annotated books of each image (C-5's judge)" : "real use (OC35): machine agreement only, never accuracy (INV-17)",
    spineCount: decisions.length, images: new Set(decisions.map((d) => d.imageId)).size, readingSet: "all-crops", accept: ACCEPT, lookalike: LOOKALIKE,
    bootstrap: { reps: REPS, seed: SEED, unit: "photo" }, reproducedC5: reproduced, readingRetrieveMs: readingLatency,
    arms: out, switchedV1toV2: { n: switched.length, withdrawnByArm: switchedWithdrawn, backToV1Work: backToV1 },
  });
  log(`${set}: written`);
}

// ---------------------------------------------------------------------------------------------
// golden: rates, refusals of golden-correct confirmations per arm, latency
// ---------------------------------------------------------------------------------------------

function goldenStage(paths: Record<CatalogName, string>): void {
  const file = "evals/golden/fragments.jsonl";
  const queries = loadGolden(join(REPO, file));
  const out: Record<string, unknown> = {};
  for (const cat of ["v1", "v2"] as const) {
    log(`golden on ${cat}`);
    const db = openCatalog(paths[cat]);
    const run = runGolden(db, queries, file, 10);
    // Each query as one reader: is its top-1 a confirmation, is it the expected work, and which arms refuse it.
    let guard = lookalikeGuard(db);
    const rows = queries.map((q) => {
      const ranked = retrieve(db, q.variants, LOOKALIKE.depth);
      const f = factsOf(ranked, guard);
      const targets = q.expect ? targetWorks(db, q.expect) : new Set<string>();
      return { id: q.id, cls: q.class, f, correct: f.top !== null && targets.has(f.top) };
    });
    const refusals = Object.fromEntries(Object.entries(C6_ARMS).filter(([a]) => a !== "none").map(([arm, arms]) => {
      const refused = (r: (typeof rows)[number]) => r.f.conf && arms.some((a) => r.f.block[a]);
      const correct = rows.filter((r) => r.f.conf && r.correct);
      return [arm, {
        goldenCorrectConfirmations: correct.length,
        refused: correct.filter(refused).map((r) => r.id),
        refusedWithAuthorEvidence: correct.filter((r) => refused(r) && r.f.author > 0).map((r) => r.id),
        goldenWrongConfirmations: rows.filter((r) => r.f.conf && !r.correct).map((r) => r.id),
        goldenWrongRefused: rows.filter((r) => r.f.conf && !r.correct && refused(r)).map((r) => r.id),
      }];
    }));
    // Latency of retrieve plus the guard (all arms, on a confirming top-1), warm, with a fresh guard memo.
    const timed = (withGuard: boolean) => {
      guard = lookalikeGuard(db);
      const ms = queries.map((q) => {
        const t0 = performance.now();
        const ranked = retrieve(db, q.variants, LOOKALIKE.depth);
        if (withGuard && ranked[0] && confirms(ranked[0])) {
          const c = ranked[0];
          const words = titleWords(c);
          const author = evidenceOf(c, "author");
          lookalikeWhy({ candidate: c, ranked, holders: words > 1 && author <= 0 ? guard.holders(c.evidence.find((e) => e.field === "title")?.form ?? "") : 0, forms: guard.forms }, new Set(GUARD_ARMS));
        }
        return performance.now() - t0;
      }).sort((a, b) => a - b);
      const q = (p: number) => Math.round(ms[Math.min(ms.length - 1, Math.ceil(p * ms.length) - 1)]! * 10) / 10;
      return { n: ms.length, p50: q(0.5), p95: q(0.95), max: Math.round(ms.at(-1)! * 10) / 10 };
    };
    const latency = { retrieveOnly: timed(false), retrievePlusGuard: timed(true) };
    // Diagnostic for the latency proposal (not adopted): a smaller per-author expansion.
    const diag = cat === "v2" ? (() => {
      const k = 100;
      const ms: number[] = [];
      const ranks = queries.filter((q) => q.expect && q.class !== "none").map((q) => {
        const t0 = performance.now();
        const c = retrieve(db, q.variants, 10, { expandLimit: k });
        ms.push(performance.now() - t0);
        const t = targetWorks(db, q.expect!);
        const i = c.findIndex((x) => t.has(x.workId));
        return { cls: q.class, rank: i < 0 ? null : i + 1 };
      });
      ms.sort((a, b) => a - b);
      const at = (cls: string, n: number) => r4(ranks.filter((r) => r.cls === cls && r.rank !== null && r.rank <= n).length / ranks.filter((r) => r.cls === cls).length);
      return { expandLimit: k, p95: Math.round(ms[Math.ceil(0.95 * ms.length) - 1]! * 10) / 10, cleanTop5: at("clean", 5), noisyTop5: at("noisy", 5), cleanTop1: at("clean", 1) };
    })() : null;
    out[cat] = { catalog: stamp(paths[cat]), rates: run.rates, latencyMs: run.latencyMs, latency, refusals, ...(diag ? { expandLimitDiagnostic: diag } : {}) };
    db.close();
  }
  writePart("golden", { goldenFile: file, ...out, host: { cpu: cpus()[0]?.model ?? "unknown", node: process.version } });
}

// ---------------------------------------------------------------------------------------------
// publish: the keep rule per arm, and the parts joined into evals/C6/metrics.json
// ---------------------------------------------------------------------------------------------

type Part = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function keepRule(yard: Part, pilot: Part, golden: Part) {
  const v1Yard = yard.arms.none.v1;
  const verdicts: Record<string, unknown> = {};
  for (const arm of Object.keys(yard.arms).filter((a) => a !== "none")) {
    const y = yard.arms[arm].v2;
    const p = pilot.arms[arm].v2;
    const g = golden.v1.refusals[arm];
    const k1 = y.wrongAcceptShareOfSpines.value <= v1Yard.wrongAcceptShareOfSpines.hi && y.deltaVsV1.wrongAcceptShareOfSpines.lo <= 0;
    const k2 = p.deltaVsV1.confirmedShare.lo > 0;
    const k3 = golden.v2.rates.clean.top5 >= 0.9;
    const k4 = g.refused.length === 0;
    const k4p = g.refusedWithAuthorEvidence.length === 0;
    verdicts[arm] = { yardstick: k1, pilot: k2, goldenTop5: k3, goldenStrict: k4, goldenAuthorBearing: k4p, passStrict: k1 && k2 && k3 && k4, passAlternative: k1 && k2 && k3 && k4p };
  }
  const choose = (key: "passStrict" | "passAlternative") => {
    const pass = Object.entries(verdicts).filter(([, v]) => (v as Record<string, boolean>)[key]).map(([a]) => a);
    pass.sort((a, b) => pilot.arms[b].v2.confirmed - pilot.arms[a].v2.confirmed || yard.arms[a].v2.wrongAccepts - yard.arms[b].v2.wrongAccepts);
    return pass[0] ?? null;
  };
  return { verdicts, chosenStrict: choose("passStrict"), chosenAlternative: choose("passAlternative"), switchDefault: choose("passStrict") !== null };
}

function publish(): void {
  const dir = privateDir("parts");
  const parts = Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(join(dir, f), "utf8")) as Part]));
  for (const need of ["golden", ...SETS.map((s) => `decide-${s}`)]) if (!parts[need]) throw new Error(`missing part ${need}`);
  const keep = keepRule(parts["decide-yardstick-library-b2"]!, parts["decide-pilot-000"]!, parts.golden!);
  let code: string | null = null;
  try {
    code = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    /* not a checkout */
  }
  const out = join(REPO, "evals", "C6");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "metrics.json"), `${JSON.stringify({ runId: "C6", card: "C-6", date: new Date().toLocaleDateString("en-CA"), code, arms: C6_ARMS, keep, ...parts }, null, 2)}\n`);
  log(`published -> evals/C6/metrics.json (switch: ${keep.switchDefault}; strict ${keep.chosenStrict}, alternative ${keep.chosenAlternative})`);
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const { values } = parseArgs({ args: rest, options: { set: { type: "string" }, catalog: { type: "string" }, shard: { type: "string" }, v1: { type: "string" }, v2: { type: "string" } } });
  const p = catalogPaths({ ...process.env, BOOKCASE_CATALOG: "" });
  const paths: Record<CatalogName, string> = { v1: values.v1 ?? join(dataRoot(), "catalog", "catalog.sqlite"), v2: values.v2 ?? p.catalogV2 };
  if (cmd !== "publish") for (const f of Object.values(paths)) if (!existsSync(f)) throw new Error(`catalog missing: ${f}`);
  const set = values.set ?? "pilot-000";
  if (cmd === "readings") {
    const cat = (values.catalog ?? "v1") as CatalogName;
    const [k, n] = (values.shard ?? "1/1").split("/").map(Number);
    readingsStage(set, cat, paths[cat], [k! - 1, n!]);
  } else if (cmd === "decide") decideStage(set, paths);
  else if (cmd === "golden") goldenStage(paths);
  else if (cmd === "publish") publish();
  else {
    console.error("usage: node src/catalog/c6-eval.ts <readings|decide|golden|publish> [--set <name>] [--catalog v1|v2] [--shard k/n]");
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
