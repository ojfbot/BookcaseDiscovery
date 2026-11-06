// C-7 evaluation: the rarity basis (src/catalog/rarity.ts) on F-0's cached readings, re-decided offline on v1
// (`catalog.sqlite`) and v2 (`catalog-v2.sqlite`), against F-0's rule and C-6's arms, plus C-3's golden fragments.
// C-6's harness (`factsOf`, its reading keys and its reproduction gate) is reused. No detection, no reading, no GPU,
// no network. Pre-registration and keep rule: evals/C7/report.md.
//
//   node src/eval/c7-eval.ts readings --set <pilot-000|yardstick-library-b2> --catalog <v1|v2> [--shard k/n]
//                                        one retrieve per distinct reading: C-6's facts and C-7's evidence on its top candidate
//   node src/eval/c7-eval.ts decide   --set <name>     every arm on both catalogs, from the readings above
//   node src/eval/c7-eval.ts golden                    golden fragments on both catalogs: refusals, latency
//   node src/eval/c7-eval.ts publish                   the keep rule, and the parts joined into evals/C7/metrics.json
//
// Per-reading and per-spine files (they hold reader text and work ids) stay in the data root's private folder
// (private/c7/); only aggregates are written to evals/C7/.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { dataRoot } from "../ledger/images.ts";
import { ACCEPT, confirms, loadReadings, READERS, readJsonl, stageDir, variantsOf, vote, type ReaderName, type ReaderVotes, type SpineDecision } from "./f0.ts";
import { clusterBootstrap } from "./q1.ts";
import { c5Cache, factsOf, type ReadingFacts } from "./c6-eval.ts";
import { isAnnotated, yardstickBooks } from "./c5-eval.ts";
import { catalogPaths, openCatalog } from "../catalog/cli.ts";
import { loadGolden, runGolden, targetWorks } from "../catalog/golden.ts";
import { LOOKALIKE, lookalikeGuard, type GuardArm } from "../catalog/lookalike.ts";
import { COUNTER_KINDS, counterEvidence, openStats, RARITY, rarityBasis, rarityEvidence, statsPathFor, type CounterKind, type RarityEvidence } from "../catalog/rarity.ts";
import { retrieve } from "../catalog/retrieve.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const log = (s: string) => console.error(`[c7] ${new Date().toISOString().slice(11, 19)} ${s}`);
const r4 = (x: number) => Math.round(x * 10000) / 10000;

/** Bootstrap as pre-registered (C-6's): paired photo resampling, 2,000 draws, seed 1. */
const REPS = 2000;
const SEED = 1;

/** One withdrawal test: a C-6 arm or a C-7 counter-evidence kind. */
export type Part = `c6:${GuardArm}` | `c7:${CounterKind}`;
const C7_ALL: Part[] = COUNTER_KINDS.map((k) => `c7:${k}` as const);

/** The pre-registered arms. Only `ELIGIBLE` arms can pass the keep rule; the single kinds are attribution. */
export const C7_ARMS: Record<string, readonly Part[]> = {
  none: [],
  "c6:c": ["c6:short"],
  c7: C7_ALL,
  "c7+a": [...C7_ALL, "c6:margin"],
  ...Object.fromEntries(COUNTER_KINDS.map((k) => [`only:${k}`, [`c7:${k}`]])),
};
export const ELIGIBLE = ["c7", "c7+a"] as const;
type CatalogName = "v1" | "v2";
const SETS = ["pilot-000", "yardstick-library-b2"] as const;

function privateDir(...sub: string[]): string {
  const d = join(dataRoot(), "private", "c7", ...sub);
  mkdirSync(d, { recursive: true });
  return d;
}
const writePart = (name: string, data: unknown) => writeFileSync(join(privateDir("parts"), `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);
const stamp = (path: string) => {
  const st = statSync(path);
  return `${path.split("/").at(-1)}:${st.size}:${Math.round(st.mtimeMs)}`;
};

// ---------------------------------------------------------------------------------------------
// readings: C-6's facts and C-7's evidence per distinct reading
// ---------------------------------------------------------------------------------------------

/** C-6's facts for one reading, plus C-7's evidence on its top candidate (only when F-0's bar confirms it). */
export interface C7Facts extends ReadingFacts {
  rarity: RarityEvidence | null;
}

/** Is this reading's confirmation withdrawn by `part`? (Never when F-0's bar did not confirm it.) */
export function blocks(f: C7Facts, part: Part): boolean {
  if (!f.conf) return false;
  const [kind, name] = part.split(":") as ["c6" | "c7", string];
  if (kind === "c6") return f.block[name as GuardArm];
  return f.rarity !== null && counterEvidence(f.rarity)[name as CounterKind];
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
  const stats = openStats(statsPathFor(path), path);
  const basis = rarityBasis(db, stats);
  const out: Record<string, C7Facts & { rarityMs: number }> = {};
  let n = 0;
  for (const v of mine) {
    const t0 = performance.now();
    const ranked = retrieve(db, v, LOOKALIKE.depth);
    const ms = performance.now() - t0;
    const f = factsOf(ranked, guard, Math.round(ms * 10) / 10);
    const t1 = performance.now();
    const rarity = f.conf ? rarityEvidence(basis, ranked[0]!, ranked, v) : null;
    out[keyOf(v)] = { ...f, rarity, rarityMs: Math.round((performance.now() - t1) * 100) / 100 };
    if (++n % 500 === 0) log(`  ${n}/${mine.length}`);
  }
  stats.close();
  db.close();
  writeFileSync(join(privateDir("readings"), `${set}.${cat}.${shard[0] + 1}of${shard[1]}.json`), JSON.stringify({ catalog: stamp(path), stats: stamp(statsPathFor(path)), facts: out }));
}

function loadFacts(set: string, cat: CatalogName, path: string): Map<string, C7Facts & { rarityMs: number }> {
  const dir = privateDir("readings");
  const out = new Map<string, C7Facts & { rarityMs: number }>();
  for (const f of readdirSync(dir).filter((f) => f.startsWith(`${set}.${cat}.`))) {
    const j = JSON.parse(readFileSync(join(dir, f), "utf8")) as { catalog: string; stats: string; facts: Record<string, C7Facts & { rarityMs: number }> };
    if (j.catalog !== stamp(path)) throw new Error(`${f} was made on ${j.catalog}, not ${stamp(path)}`);
    if (j.stats !== stamp(statsPathFor(path))) throw new Error(`${f} was made with stats ${j.stats}, not ${stamp(statsPathFor(path))}`);
    for (const [k, v] of Object.entries(j.facts)) out.set(k, v);
  }
  return out;
}

/** C-6's cached facts for the same readings (private/c6/readings), for the second reproduction gate. */
function c6Facts(set: string, cat: CatalogName): Map<string, ReadingFacts> | null {
  const dir = join(dataRoot(), "private", "c6", "readings");
  if (!existsSync(dir)) return null;
  const out = new Map<string, ReadingFacts>();
  for (const f of readdirSync(dir).filter((f) => f.startsWith(`${set}.${cat}.`))) {
    for (const [k, v] of Object.entries((JSON.parse(readFileSync(join(dir, f), "utf8")) as { facts: Record<string, ReadingFacts> }).facts)) out.set(k, v);
  }
  return out.size ? out : null;
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
  withdrawn: number;
}

type Reads = Partial<Record<ReaderName, { variants: string[] }>>;

/** Re-decide one spine from cached facts with the parts in force (F-0's `vote`, unchanged). */
export function decideFromC7Facts(reads: Reads, facts: Map<string, C7Facts>, parts: readonly Part[]): { votes: ReaderVotes; withdrawn: number } {
  const votes: ReaderVotes = { readText: {}, top: {}, confirmed: {} };
  let withdrawn = 0;
  for (const reader of READERS) {
    const r = reads[reader];
    if (!r) continue;
    votes.readText[reader] = r.variants.length > 0;
    const f = r.variants.length ? facts.get(keyOf(r.variants)) : undefined;
    if (r.variants.length && !f) throw new Error("a reading has no cached facts: run `readings` first");
    votes.top[reader] = f?.top ?? null;
    const blocked = !!f?.conf && parts.some((p) => blocks(f, p));
    if (blocked) withdrawn++;
    votes.confirmed[reader] = f?.conf && !blocked ? f.top : null;
  }
  return { votes, withdrawn };
}

/**
 * Leave one reader out (C-R2 §5), label-free: on spines F-0 accepts with two or more agreeing readers, each agreeing
 * reader's confirmation alone is *corroborated* by the others; a reader that confirms one work while the two other
 * readers agree on another is *contradicted*. A basis should keep the first and withdraw the second.
 */
export function leaveOneReaderOut(spines: Reads[], facts: Map<string, C7Facts>, parts: readonly Part[]) {
  let corroborated = 0;
  let kept = 0;
  let contradicted = 0;
  let withdrawn = 0;
  for (const reads of spines) {
    const conf: Partial<Record<ReaderName, C7Facts>> = {};
    for (const reader of READERS) {
      const v = reads[reader]?.variants ?? [];
      const f = v.length ? facts.get(keyOf(v)) : undefined;
      if (f?.conf && f.top) conf[reader] = f;
    }
    for (const reader of READERS) {
      const f = conf[reader];
      if (!f) continue;
      const others = READERS.filter((o) => o !== reader && conf[o]).map((o) => conf[o]!.top);
      const blocked = parts.some((p) => blocks(f, p));
      if (others.some((w) => w === f.top)) {
        corroborated++;
        if (!blocked) kept++;
      } else if (others.length === 2 && others[0] === others[1]) {
        contradicted++;
        if (blocked) withdrawn++;
      }
    }
  }
  return { corroborated, keptCorroborated: kept, keepRate: corroborated ? r4(kept / corroborated) : null, contradicted, withdrawnContradicted: withdrawn, withdrawRate: contradicted ? r4(withdrawn / contradicted) : null };
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

function worksPerPhoto(rows: ArmDecision[]): Array<{ imageId: string; n: number }> {
  const m = new Map<string, Set<string>>();
  for (const r of rows) {
    const s = m.get(r.imageId) ?? new Set<string>();
    if (r.accepted) s.add(r.accepted);
    m.set(r.imageId, s);
  }
  return [...m.entries()].map(([imageId, s]) => ({ imageId, n: s.size }));
}

const quant = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))]! : null;
};

/** Aggregates of the evidence on confirming readings (no text, no ids). */
function evidenceSummary(facts: Iterable<C7Facts>) {
  const e = [...facts].filter((f) => f.conf && f.rarity).map((f) => f.rarity!);
  const of = (k: CounterKind) => e.filter((x) => counterEvidence(x)[k]).length;
  return {
    confirmingReadings: e.length,
    titleBooks: { p50: quant(e.map((x) => x.titleBooks), 0.5), p90: quant(e.map((x) => x.titleBooks), 0.9), max: quant(e.map((x) => x.titleBooks), 1) },
    share: { p10: quant(e.map((x) => x.share), 0.1), p25: quant(e.map((x) => x.share), 0.25), p50: quant(e.map((x) => x.share), 0.5) },
    titleBits: { p10: quant(e.map((x) => x.titleBits), 0.1), p50: quant(e.map((x) => x.titleBits), 0.5) },
    authorPinned: e.filter((x) => x.author >= RARITY.secondAuthor).length,
    withUnexplainedWords: e.filter((x) => x.unexplainedWords > 0).length,
    readingLanguage: Object.fromEntries([...new Set(e.map((x) => x.readingLanguage ?? "none"))].map((l) => [l, e.filter((x) => (x.readingLanguage ?? "none") === l).length])),
    counterEvidence: Object.fromEntries(COUNTER_KINDS.map((k) => [k, of(k)])),
  };
}

function decideStage(set: string, paths: Record<CatalogName, string>): void {
  const dir = stageDir(dataRoot(), set);
  const decisions = readJsonl<SpineDecision>(join(dir, "decisions.jsonl"));
  const readings = loadReadings(dir);
  const proxy = set.startsWith("yardstick");
  const truth = proxy ? yardstickBooks() : null;
  const reads = new Map(decisions.map((d) => [d.id, Object.fromEntries(Object.entries(readings.get(d.id) ?? {}).map(([k, r]) => [k, { variants: variantsOf(r) }])) as Reads]));

  const byArm: Record<string, Record<CatalogName, ArmDecision[]>> = {};
  const gate: Record<string, unknown> = {};
  const extra: Record<string, unknown> = {};
  for (const cat of ["v1", "v2"] as const) {
    const facts = loadFacts(set, cat, paths[cat]);
    // Gate 2: C-6's cached facts on the same readings (top, F-0's bar and every arm's verdict) are reproduced.
    const c6 = c6Facts(set, cat);
    const same = c6 ? [...facts].filter(([k, f]) => { const x = c6.get(k); return x && x.top === f.top && x.conf === f.conf && (["margin", "author", "short"] as const).every((a) => x.block[a] === f.block[a]); }).length : null;
    const c6Gate = c6 && same !== null ? r4(same / facts.size) : null;
    const db = openCatalog(paths[cat]);
    const judged = new Map<string, boolean>();
    const judge = (workId: string, imageId: string) => {
      const k = `${imageId}\u0000${workId}`;
      if (!judged.has(k)) judged.set(k, !isAnnotated(db, workId, truth!.get(imageId) ?? []));
      return judged.get(k)!;
    };
    for (const [arm, parts] of Object.entries(C7_ARMS)) {
      const rows = decisions.map((d): ArmDecision => {
        const { votes, withdrawn } = decideFromC7Facts(reads.get(d.id)!, facts, parts);
        const v = vote(votes);
        return { id: d.id, imageId: d.imageId, accepted: v.acceptedId, reason: v.reason, wrong: v.acceptedId && truth ? judge(v.acceptedId, d.imageId) : null, withdrawn };
      });
      (byArm[arm] ??= {} as Record<CatalogName, ArmDecision[]>)[cat] = rows;
    }
    db.close();
    // Gate 1 (C-6's): unguarded re-decisions match C-5's cached ones.
    const c5 = c5Cache(set, cat);
    const c5Gate = c5 ? r4(byArm.none![cat].filter((r) => { const x = c5.get(r.id); return x && x.accepted === r.accepted && x.reason === r.reason; }).length / decisions.length) : null;
    gate[cat] = { reproducesC5: c5Gate, reproducesC6Facts: c6Gate, readings: facts.size };
    log(`${set} ${cat}: reproduces C-5 on ${c5Gate}, C-6's facts on ${c6Gate}`);
    for (const [name, g] of [["C-5", c5Gate], ["C-6", c6Gate]] as const) if (g !== null && g < 0.999) throw new Error(`${set} ${cat}: reproduction of ${name} ${g} under the 0.999 gate`);
    const ms = [...facts.values()].filter((f) => f.conf).map((f) => f.rarityMs).sort((a, b) => a - b);
    const spines = [...reads.values()];
    extra[cat] = {
      evidence: evidenceSummary(facts.values()),
      rarityMsOnConfirmingReadings: { n: ms.length, p50: quant(ms, 0.5), p95: quant(ms, 0.95), max: ms.at(-1) ?? null },
      leaveOneReaderOut: Object.fromEntries(Object.entries(C7_ARMS).filter(([a]) => a !== "none").map(([arm, parts]) => [arm, leaveOneReaderOut(spines, facts, parts)])),
    };
  }
  writeFileSync(join(privateDir("decisions"), `${set}.json`), JSON.stringify(byArm));

  const v1 = byArm.none!.v1;
  const v2 = byArm.none!.v2;
  const summary = (rows: ArmDecision[], cat: CatalogName) => {
    const acc = rows.filter((r) => r.accepted);
    const reasons: Record<string, number> = {};
    for (const r of rows) if (r.reason) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
    const pairedV1 = rows.map((r, i) => ({ imageId: r.imageId, a: v1[i]!, b: r }));
    const base = byArm.none![cat];
    const pairedSame = rows.map((r, i) => ({ imageId: r.imageId, a: base[i]!, b: r }));
    const wpp = worksPerPhoto(rows);
    const wppV1 = new Map(worksPerPhoto(v1).map((x) => [x.imageId, x.n]));
    return {
      confirmed: acc.length,
      confirmedShare: ci(rows, (x) => shareOf(x, (r) => r.accepted !== null)),
      confirmedOpenLibraryWorks: acc.filter((r) => r.accepted!.startsWith("ol:")).length,
      readersWithdrawn: rows.reduce((s, r) => s + r.withdrawn, 0),
      acceptsWithdrawn: rows.filter((r, i) => base[i]!.accepted && !r.accepted).length,
      acceptsChangedToAnotherWork: rows.filter((r, i) => r.accepted && r.accepted !== base[i]!.accepted).length,
      unknownByReason: reasons,
      ...(proxy
        ? {
            wrongAccepts: acc.filter((r) => r.wrong).length,
            correctAccepts: acc.filter((r) => !r.wrong).length,
            wrongAmongWithdrawn: rows.filter((r, i) => base[i]!.accepted && !r.accepted && base[i]!.wrong).length,
            wrongAcceptShareOfAccepted: ci(rows, wrongShare),
            wrongAcceptShareOfSpines: ci(rows, (x) => shareOf(x, (r) => r.wrong === true)),
            // Against F-0's rule on the same catalog: the wrong share of accepts, paired by photo.
            deltaVsSameCatalog: {
              wrongAcceptShareOfAccepted: ci(pairedSame, (x) => {
                const a = wrongShare(x.map((p) => p.a));
                const b = wrongShare(x.map((p) => p.b));
                return a === null || b === null ? null : b - a;
              }),
            },
          }
        : { distinctWorksPerPhoto: ci(wpp, (x) => (x.length ? x.reduce((s, r) => s + r.n, 0) / x.length : null)) }),
      deltaVsV1: {
        confirmedShare: ci(pairedV1, (x) => (x.length ? (x.filter((p) => p.b.accepted).length - x.filter((p) => p.a.accepted).length) / x.length : null)),
        ...(proxy
          ? { wrongAcceptShareOfSpines: ci(pairedV1, (x) => (x.length ? (x.filter((p) => p.b.wrong).length - x.filter((p) => p.a.wrong).length) / x.length : null)) }
          : { distinctWorksPerPhoto: ci(wpp, (x) => (x.length ? x.reduce((s, r) => s + r.n - wppV1.get(r.imageId)!, 0) / x.length : null)) }),
      },
    };
  };

  const arms = Object.fromEntries(Object.entries(byArm).map(([arm, cats]) => [arm, Object.fromEntries((["v1", "v2"] as const).map((cat) => [cat, summary(cats[cat], cat)]))]));
  const switched = v1.map((_, i) => i).filter((i) => v1[i]!.accepted && v2[i]!.accepted && v1[i]!.accepted !== v2[i]!.accepted);
  writePart(`decide-${set}`, {
    set, scope: proxy ? "yardstick (PROXY): wrong accepts against the annotated books of each image (C-5's judge)" : "real use (OC35): machine agreement only, never accuracy (INV-17)",
    spineCount: decisions.length, images: new Set(decisions.map((d) => d.imageId)).size, readingSet: "all-crops", accept: ACCEPT, rarity: RARITY, lookalike: LOOKALIKE,
    bootstrap: { reps: REPS, seed: SEED, unit: "photo" }, gate, ...extra, arms,
    switchedV1toV2: { n: switched.length, withdrawnByArm: Object.fromEntries(Object.entries(byArm).map(([arm, cats]) => [arm, switched.filter((i) => !cats.v2[i]!.accepted).length])) },
  });
  log(`${set}: written`);
}

// ---------------------------------------------------------------------------------------------
// golden: refusals of golden-correct confirmations per arm, latency
// ---------------------------------------------------------------------------------------------

function goldenStage(paths: Record<CatalogName, string>): void {
  const file = "evals/golden/fragments.jsonl";
  const queries = loadGolden(join(REPO, file));
  const out: Record<string, unknown> = {};
  for (const cat of ["v1", "v2"] as const) {
    log(`golden on ${cat}`);
    const db = openCatalog(paths[cat]);
    const run = runGolden(db, queries, file, 10);
    const guard = lookalikeGuard(db);
    const stats = openStats(statsPathFor(paths[cat]), paths[cat]);
    const basis = rarityBasis(db, stats);
    const rows = queries.map((q) => {
      const ranked = retrieve(db, q.variants, LOOKALIKE.depth);
      const f6 = factsOf(ranked, guard);
      const f: C7Facts = { ...f6, rarity: f6.conf ? rarityEvidence(basis, ranked[0]!, ranked, q.variants) : null };
      const targets = q.expect ? targetWorks(db, q.expect) : new Set<string>();
      return { id: q.id, f, correct: f.top !== null && targets.has(f.top) };
    });
    const refusals = Object.fromEntries(Object.entries(C7_ARMS).filter(([a]) => a !== "none").map(([arm, parts]) => {
      const refused = (r: (typeof rows)[number]) => parts.some((p) => blocks(r.f, p));
      const correct = rows.filter((r) => r.f.conf && r.correct);
      return [arm, {
        goldenCorrectConfirmations: correct.length,
        refused: correct.filter(refused).map((r) => r.id),
        goldenWrongConfirmations: rows.filter((r) => r.f.conf && !r.correct).map((r) => r.id),
        goldenWrongRefused: rows.filter((r) => r.f.conf && !r.correct && refused(r)).map((r) => r.id),
      }];
    }));
    // Latency of retrieve plus the basis's evidence on a confirming top-1, warm, with fresh memos.
    const timed = (withBasis: boolean) => {
      const b = rarityBasis(db, openStats(statsPathFor(paths[cat]), paths[cat]));
      const ms = queries.map((q) => {
        const t0 = performance.now();
        const ranked = retrieve(db, q.variants, LOOKALIKE.depth);
        if (withBasis && ranked[0] && confirms(ranked[0])) rarityEvidence(b, ranked[0], ranked, q.variants);
        return performance.now() - t0;
      }).sort((a, b2) => a - b2);
      b.stats.close();
      const q = (p: number) => Math.round(ms[Math.min(ms.length - 1, Math.ceil(p * ms.length) - 1)]! * 10) / 10;
      return { n: ms.length, p50: q(0.5), p95: q(0.95), max: Math.round(ms.at(-1)! * 10) / 10 };
    };
    out[cat] = { catalog: stamp(paths[cat]), stats: stamp(statsPathFor(paths[cat])), rates: run.rates, latency: { retrieveOnly: timed(false), retrievePlusBasis: timed(true) }, evidence: evidenceSummary(rows.map((r) => r.f)), refusals };
    stats.close();
    db.close();
  }
  writePart("golden", { goldenFile: file, ...out, host: { cpu: cpus()[0]?.model ?? "unknown", node: process.version } });
}

// ---------------------------------------------------------------------------------------------
// publish: the keep rule per eligible arm, and the parts joined into evals/C7/metrics.json
// ---------------------------------------------------------------------------------------------

type PartJson = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The pre-registered keep rule (evals/C7/report.md § Keep rule). */
export function keepRule(yard: PartJson, pilot: PartJson, golden: PartJson) {
  const v1Yard = yard.arms.none.v1;
  const v2Yard = yard.arms.none.v2;
  const verdicts: Record<string, Record<string, boolean>> = {};
  for (const arm of Object.keys(yard.arms).filter((a) => a !== "none")) {
    const y = yard.arms[arm].v2;
    const p = pilot.arms[arm].v2;
    const k1a = y.deltaVsSameCatalog.wrongAcceptShareOfAccepted !== null && y.deltaVsSameCatalog.wrongAcceptShareOfAccepted.hi < 0;
    const k1b = y.wrongAcceptShareOfSpines.value <= v1Yard.wrongAcceptShareOfSpines.hi;
    const k2 = y.correctAccepts >= 0.85 * v2Yard.correctAccepts;
    const k3 = p.deltaVsV1.confirmedShare.lo > 0;
    const k4 = golden.v2.rates.clean.top5 >= 0.9;
    const k5v1 = golden.v1.refusals[arm].refused.length === 0;
    // On v2, only golden queries that are golden-correct confirmations on v1 count (C-5's retrieval losses are not the basis's).
    const k5v2 = (golden.v2.refusals[arm].refused as string[]).every((id) => !golden.v1Correct.includes(id));
    verdicts[arm] = { yardstickShareFalls: k1a, yardstickPerSpineBound: k1b, yardstick: k1a || k1b, yardstickCorrectKept: k2, pilot: k3, goldenTop5: k4, goldenV1: k5v1, goldenV2: k5v2, pass: (k1a || k1b) && k2 && k3 && k4 && k5v1 && k5v2 };
  }
  const pass = ELIGIBLE.filter((a) => verdicts[a]?.pass);
  pass.sort((a, b) => pilot.arms[b].v2.confirmed - pilot.arms[a].v2.confirmed || yard.arms[a].v2.wrongAccepts - yard.arms[b].v2.wrongAccepts);
  return { verdicts, eligible: ELIGIBLE, chosen: pass[0] ?? null, switchDefault: pass.length > 0 };
}

function publish(): void {
  const dir = privateDir("parts");
  const parts = Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(join(dir, f), "utf8")) as PartJson]));
  for (const need of ["golden", ...SETS.map((s) => `decide-${s}`)]) if (!parts[need]) throw new Error(`missing part ${need}`);
  const golden = parts.golden!;
  // Golden-correct v1 confirmations (ids only; the golden file is public).
  golden.v1Correct = (() => {
    const db = openCatalog(join(dataRoot(), "catalog", "catalog.sqlite"));
    const guard = lookalikeGuard(db, []);
    const ids = loadGolden(join(REPO, golden.goldenFile)).filter((q) => {
      const ranked = retrieve(db, q.variants, LOOKALIKE.depth);
      const f = factsOf(ranked, guard);
      return f.conf && q.expect && targetWorks(db, q.expect).has(f.top!);
    }).map((q) => q.id);
    db.close();
    return ids;
  })();
  const keep = keepRule(parts["decide-yardstick-library-b2"]!, parts["decide-pilot-000"]!, golden);
  let code: string | null = null;
  try {
    code = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    /* not a checkout */
  }
  const out = join(REPO, "evals", "C7");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "metrics.json"), `${JSON.stringify({ runId: "C7", card: "C-7", date: new Date().toLocaleDateString("en-CA"), code, arms: C7_ARMS, keep, ...parts }, null, 2)}\n`);
  log(`published -> evals/C7/metrics.json (switch: ${keep.switchDefault}; chosen ${keep.chosen})`);
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
    console.error("usage: node src/eval/c7-eval.ts <readings|decide|golden|publish> [--set <name>] [--catalog v1|v2] [--shard k/n]");
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
