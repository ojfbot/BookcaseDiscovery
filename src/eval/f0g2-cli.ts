// F-0g2 runner: pooled reading for copy groups with no confirmed copy, on F-0g's cached groups, reader tops and
// F-0's cached readings (CPU only; no new read).
//
//   node src/eval/f0g2-cli.ts analyse   # both sets: evals/F0g2/{metrics.json,report.md} (aggregates only);
//                                       # per-copy records under the data root's private/f0g2/<set>/
//   node src/eval/f0g2-cli.ts render    # the data root's private/f0g2/renders/<set>/index.html (private)
//
// Catalog lookups of pooled readings are cached under private/f0g2/<set>/lookup.jsonl. Nothing here changes F-0's,
// F-0g's or F-0h's decisions: confirmed-by-pooling is a separate, recorded basis. Keep rule: evals/F0g2/report.md.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openCatalog } from "../catalog/cli.ts";
import { retrieve } from "../catalog/retrieve.ts";
import { dataRoot } from "../ledger/images.ts";
import { confirms, loadReadings, readJsonl, READERS, variantsOf, type ReaderName } from "./f0.ts";
import { imagesOf, meanCI, SETS, type SetName } from "./f0c-cli.ts";
import { boxRows, type Tri } from "./f0e.ts";
import { copyGroups, pairGuard, sameAuthor, sameWork, type WorkRef } from "./f0g.ts";
import { noEvidence, runSet, yardstickCopies, type PairOutcome, type SetRun } from "./f0g-cli.ts";
import { poolGroup, POOL, pooledReading, selfDecides, viewOf, wilsonUpper, type Lookup, type PoolCopy, type PoolResult } from "./f0g2.ts";
import { clusterBootstrap, rate } from "./q1.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const ROOT = dataRoot();
const PRIV = join(ROOT, "private", "f0g2");
const REPS = 2000;
const SEED = 20261104;
const log = (s: string): void => console.error(`[f0g2] ${s}`);
const r4 = (x: number) => Math.round(x * 10000) / 10000;
const triOf = (b: { value: number; lo: number; hi: number } | null): Tri => (b ? [r4(b.value), r4(b.lo), r4(b.hi)] : null);
const SET_NAMES: SetName[] = ["pilot-000", "yardstick"];
/** F-0i's partition folder per set; its consumers ignore the boxes it drops. */
const F0I: Record<SetName, string> = { "pilot-000": "pilot-000", yardstick: "yardstick-library-b2" };
/** The pre-registered bar on wrong outcomes in the leave-one-reader-out and hide-the-confirmed-copy views. */
const MAX_WRONG_SHARE = 0.05;

const stage = (set: SetName): string => {
  const dir = join(PRIV, set);
  mkdirSync(dir, { recursive: true });
  return dir;
};

// --- context: F-0g's groups on F-0i's kept boxes, texts and a cached catalog lookup ------------------------------

interface Group {
  imageId: string;
  band: number;
  /** Spine ids, in shelf order. */
  ids: string[];
}

interface Ctx {
  set: SetName;
  run: SetRun;
  dropped: Set<string>;
  groups: Group[];
  copy: (id: string) => PoolCopy;
  lookup: Lookup;
  stats: { lookups: number; cached: number };
}

function context(set: SetName): Ctx {
  const run = runSet(set);
  const dropped = new Set(readJsonl<{ id: string; state: string }>(join(ROOT, "private", "f0i", F0I[set], "partition.jsonl")).filter((p) => p.state === "dropped").map((p) => p.id));
  if (dropped.size === 0) throw new Error(`no F-0i partition for ${set}`);
  // F-0g's links (visually the same, passing the series guard) less those touching a box F-0i drops, regrouped.
  const groups: Group[] = [];
  const byImage = new Map<string, PairOutcome[]>();
  for (const o of run.outcomes) byImage.set(o.imageId, [...(byImage.get(o.imageId) ?? []), o]);
  for (const [imageId, os] of byImage) {
    const rows = boxRows(run.dets.get(imageId)!);
    const links = os.filter((o) => o.visual && !o.guard && !dropped.has(`${imageId}:${o.n.a}`) && !dropped.has(`${imageId}:${o.n.b}`)).map((o) => o.n);
    for (const g of copyGroups(links, (i) => rows[i]!.g.cx)) groups.push({ imageId, band: rows[g[0]!]!.band, ids: g.map((i) => `${imageId}:${i}`) });
  }
  const readings = loadReadings(SETS[set].base);
  const copy = (id: string): PoolCopy => {
    const reads = readings.get(id) ?? {};
    const texts: PoolCopy["texts"] = {};
    for (const r of READERS) {
      const v = variantsOf(reads[r]);
      if (v.length) texts[r] = v;
    }
    return { ev: run.ev.get(id) ?? noEvidence(id), texts };
  };
  const db = openCatalog(SETS[set].catalog);
  const path = join(stage(set), "lookup.jsonl");
  type Hit = ReturnType<Lookup>;
  const cache = new Map(readJsonl<{ k: string; hit: Hit }>(path).map((r) => [r.k, r.hit]));
  const stats = { lookups: 0, cached: cache.size };
  const lookup: Lookup = (variants) => {
    const k = createHash("sha256").update(variants.join("\u0000")).digest("hex");
    if (!cache.has(k)) {
      const c = retrieve(db, variants, POOL.depth)[0];
      const hit: Hit = c ? { workId: c.workId, title: c.title, authors: c.authors, score: c.score, titleEvidence: c.evidence.find((e) => e.field === "title")?.score ?? 0, coverage: c.queryCoverage, passes: confirms(c), variant: c.variant } : null;
      cache.set(k, hit);
      appendFileSync(path, JSON.stringify({ k, hit }) + "\n");
      stats.lookups++;
    }
    return cache.get(k)!;
  };
  return { set, run, dropped, groups, copy, lookup, stats };
}

const accepted = (ctx: Ctx, id: string): WorkRef | null => ctx.run.ev.get(id)?.accepted ?? null;
const readersIn = (cs: PoolCopy[]): ReaderName[] => READERS.filter((r) => cs.some((c) => (c.texts[r] ?? []).length > 0));

// --- the decision on eligible groups ------------------------------------------------------------------------------

interface Pooled {
  group: Group;
  result: PoolResult;
  noFusion: PoolResult;
}

function poolEligible(ctx: Ctx): Pooled[] {
  return ctx.groups
    .filter((g) => !g.ids.some((id) => accepted(ctx, id)))
    .map((group) => {
      const cs = group.ids.map(ctx.copy);
      return { group, result: poolGroup(cs, ctx.lookup, ctx.run.fit), noFusion: poolGroup(cs, ctx.lookup, ctx.run.fit, false) };
    });
}

// --- evaluation views -----------------------------------------------------------------------------------------------

type Outcome = "right" | "wrong" | "none";

interface View {
  kind: "loro" | "hide" | "hard";
  imageId: string;
  /** The reader model left out (none: all readers). */
  drop: ReaderName | null;
  outcome: Outcome;
  trivial: boolean;
  /** Copies labelled confirmed-by-pooling in the view; hard negatives: copies labelled another book's work. */
  labelled: number;
  harm?: number;
  merged?: boolean;
  gated?: boolean;
  fromFused?: boolean;
}

const outcomeOf = (r: PoolResult, target: WorkRef): Outcome => (!r.work ? "none" : sameWork(r.work, target) ? "right" : "wrong");
const labelledIn = (r: PoolResult) => r.decisions.filter((d) => d.basis === "confirmed-by-pooling").length;
const fusedWin = (r: PoolResult) => r.votes.some((v) => r.supporting.includes(v.reader) && v.fromFused);

/** Leave one reader out: confirmed groups with all confirmations hidden and one model removed from every copy. */
function loroViews(ctx: Ctx): { views: View[]; groups: number; mixed: number } {
  const views: View[] = [];
  let groups = 0;
  let mixed = 0;
  for (const g of ctx.groups) {
    const works = g.ids.flatMap((id) => accepted(ctx, id) ?? []);
    if (works.length === 0) continue;
    if (works.some((w) => !sameWork(w, works[0]!))) {
      mixed++;
      continue;
    }
    groups++;
    const cs = g.ids.map(ctx.copy);
    for (const drop of readersIn(cs)) {
      const view = cs.map((c) => viewOf(c, drop));
      const r = poolGroup(view, ctx.lookup, ctx.run.fit);
      views.push({ kind: "loro", imageId: g.imageId, drop, outcome: outcomeOf(r, works[0]!), trivial: view.some((c) => selfDecides(c.ev)), labelled: labelledIn(r), fromFused: fusedWin(r) });
    }
  }
  return { views, groups, mixed };
}

/** Hide each confirmed copy in turn and pool the copies left (two or more), with all readers and each left out. */
function hideViews(ctx: Ctx): { views: View[]; hidden: number; tooFew: number } {
  const views: View[] = [];
  let hidden = 0;
  let tooFew = 0;
  for (const g of ctx.groups)
    for (const h of g.ids) {
      const target = accepted(ctx, h);
      if (!target) continue;
      const rest = g.ids.filter((id) => id !== h).map(ctx.copy);
      if (rest.length < 2) {
        tooFew++;
        continue;
      }
      hidden++;
      for (const drop of [null, ...readersIn(rest)]) {
        const view = rest.map((c) => viewOf(c, drop ?? undefined));
        const r = poolGroup(view, ctx.lookup, ctx.run.fit);
        views.push({ kind: "hide", imageId: g.imageId, drop, outcome: outcomeOf(r, target), trivial: view.some((c) => selfDecides(c.ev)), labelled: labelledIn(r), fromFused: fusedWin(r) });
      }
    }
  return { views, hidden, tooFew };
}

/** Hard negatives: confirmed neighbours of one author, different works, pooled as a two-copy group in each view. */
function hardViews(ctx: Ctx): { views: View[]; pairs: number } {
  const views: View[] = [];
  let pairs = 0;
  for (const o of ctx.run.outcomes) {
    const ia = `${o.imageId}:${o.n.a}`;
    const ib = `${o.imageId}:${o.n.b}`;
    const wa = accepted(ctx, ia);
    const wb = accepted(ctx, ib);
    if (!wa || !wb || sameWork(wa, wb) || !sameAuthor(wa, wb) || ctx.dropped.has(ia) || ctx.dropped.has(ib)) continue;
    pairs++;
    const cs = [ctx.copy(ia), ctx.copy(ib)];
    const own = new Map([[ia, wa], [ib, wb]]);
    for (const drop of [null, ...readersIn(cs)]) {
      const [va, vb] = cs.map((c) => viewOf(c, drop ?? undefined)) as [PoolCopy, PoolCopy];
      const gated = o.visual && pairGuard(va.ev, vb.ev, ctx.run.fit) === null;
      const r = poolGroup([va, vb], ctx.lookup, ctx.run.fit);
      const labels = r.decisions.filter((d) => d.basis === "confirmed-by-pooling");
      const harm = labels.filter((d) => !sameWork(own.get(d.id)!, r.work!)).length;
      views.push({ kind: "hard", imageId: o.imageId, drop, outcome: r.work ? (harm ? "wrong" : "right") : "none", trivial: false, labelled: labels.length, harm, merged: labels.length === 2, gated });
    }
  }
  return { views, pairs };
}

// --- analyse ----------------------------------------------------------------------------------------------------

const share = (rows: View[], pred: (v: View) => boolean): Tri => triOf(clusterBootstrap(rows, rate(pred), REPS, SEED));
const kv = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
const count = (xs: string[]): Record<string, number> => {
  const o: Record<string, number> = {};
  for (const x of xs) o[x] = (o[x] ?? 0) + 1;
  return o;
};

/** Of the views pooling confirms, how many name the wrong work; the bar is on the point estimate. */
function precision(vs: View[]) {
  const conf = vs.filter((v) => v.outcome !== "none");
  const wrong = conf.filter((v) => v.outcome === "wrong").length;
  return {
    views: vs.length,
    confirmed: conf.length,
    right: conf.length - wrong,
    wrong,
    wrongShare: conf.length ? r4(wrong / conf.length) : null,
    wrongWilsonUpper: conf.length ? r4(wilsonUpper(wrong, conf.length)!) : null,
    recovered: share(vs, (v) => v.outcome === "right"),
    labelledCopies: vs.reduce((s, v) => s + v.labelled, 0),
    fusedWins: conf.filter((v) => v.fromFused).length,
  };
}

interface PhotoCount {
  imageId: string;
  boxes: number;
  base: number;
  pooled: number;
  noFusion: number;
  wrongBase?: number;
  wrongWith?: number;
  overBase?: number;
  overWith?: number;
}

function analyseSet(ctx: Ctx) {
  const t0 = Date.now();
  const { set, run, dropped } = ctx;
  const pooled = poolEligible(ctx);
  const byCopy = new Map<string, string>();
  for (const d of run.decisions.values()) if (d.basis === "confirmed-by-copy" && !dropped.has(d.id)) byCopy.set(d.id, d.workId!);
  const poolLabel = new Map<string, string>();
  const noFusionLabel = new Map<string, string>();
  for (const p of pooled) {
    for (const d of p.result.decisions) if (d.basis === "confirmed-by-pooling") poolLabel.set(d.id, d.workId!);
    for (const d of p.noFusion.decisions) if (d.basis === "confirmed-by-pooling") noFusionLabel.set(d.id, d.workId!);
  }
  const truth = set === "yardstick" ? yardstickCopies() : null;
  const photos: PhotoCount[] = [...run.dets.values()].map((d) => {
    const ids = d.spines.flatMap((_, i) => (run.books.get(d.id)![i] && !dropped.has(`${d.id}:${i}`) ? [`${d.id}:${i}`] : []));
    const base = ids.map((id) => run.base.get(id)?.accepted ?? byCopy.get(id) ?? null);
    const row: PhotoCount = { imageId: d.id, boxes: ids.length, base: base.filter(Boolean).length, pooled: ids.filter((id) => poolLabel.has(id)).length, noFusion: ids.filter((id) => noFusionLabel.has(id)).length };
    if (truth) {
      const t = truth.get(d.id) ?? new Map<string, number>();
      const withPool = ids.map((id, k) => base[k] ?? poolLabel.get(id) ?? null);
      const wrong = (ws: (string | null)[]) => ws.filter((w) => w && !t.has(w)).length;
      const over = (ws: (string | null)[]) => {
        const c = count(ws.filter((w): w is string => Boolean(w)));
        return Object.entries(c).reduce((s, [w, n]) => s + (t.has(w) ? Math.max(0, n - t.get(w)!) : 0), 0);
      };
      Object.assign(row, { wrongBase: wrong(base), wrongWith: wrong(withPool), overBase: over(base), overWith: over(withPool) });
    }
    return row;
  });
  const by = (k: keyof PhotoCount) => photos.map((p) => Number(p[k] ?? 0));
  const sum = (k: keyof PhotoCount) => by(k).reduce((a, b) => a + b, 0);
  const boxShare = (k: "pooled" | "noFusion"): Tri => triOf(clusterBootstrap(photos, (ps) => ps.reduce((s, p) => s + p[k], 0) / Math.max(1, ps.reduce((s, p) => s + p.boxes, 0)), REPS, SEED));
  const wrongShare = (side: "base" | "with"): Tri =>
    triOf(clusterBootstrap(photos, (ps) => {
      const acc = ps.reduce((s, p) => s + p.base + (side === "with" ? p.pooled : 0), 0);
      return acc ? ps.reduce((s, p) => s + Number(side === "with" ? p.wrongWith : p.wrongBase), 0) / acc : null;
    }, REPS, SEED));

  // What pooling did on the eligible groups.
  const res = pooled.map((p) => p.result);
  const supportingVotes = res.flatMap((r) => r.votes.filter((v) => r.supporting.includes(v.reader)));
  const blocked = count(res.filter((r) => r.work).flatMap((r) => r.decisions.flatMap((d) => (d.blocked ? [d.blocked] : []))));
  const fusedReaders = res.flatMap((r) => r.votes).filter((v) => v.copiesFused >= 2);

  // F-0h's confirmed-by-context on the same boxes (pilot-000 only: its records hold that set's decisions).
  const ctxPath = join(ROOT, "private", "f0h", set, "decisions.jsonl");
  const byContext = new Map(readJsonl<{ id: string; basis: string | null; workId: string | null }>(ctxPath).filter((d) => d.basis === "confirmed-by-context").map((d) => [d.id, d.workId!]));
  const f0h = set === "pilot-000"
    ? {
        pooledAlsoByContext: [...poolLabel.keys()].filter((id) => byContext.has(id)).length,
        sameWork: [...poolLabel].filter(([id, w]) => byContext.get(id) === w).length,
        differentWork: [...poolLabel].filter(([id, w]) => byContext.has(id) && byContext.get(id) !== w).length,
        pooledNotByContext: [...poolLabel.keys()].filter((id) => !byContext.has(id)).length,
      }
    : null;

  const loro = loroViews(ctx);
  const hide = hideViews(ctx);
  const hard = hardViews(ctx);
  const nonTrivialLoro = loro.views.filter((v) => !v.trivial);
  const gated = hard.views.filter((v) => v.gated);
  writeRecords(ctx, pooled, [...loro.views, ...hide.views, ...hard.views]);

  return {
    scope: SETS[set].scope,
    photos: photos.length,
    boxCount: sum("boxes"),
    droppedByF0i: dropped.size,
    groups: { total: ctx.groups.length, eligible: pooled.length, eligibleCopies: pooled.reduce((s, p) => s + p.group.ids.length, 0), sizes: count(pooled.map((p) => (p.group.ids.length >= 4 ? "4+" : String(p.group.ids.length)))) },
    pooling: {
      groupsPooled: res.filter((r) => r.work).length,
      groupReasons: count(res.flatMap((r) => (r.reason ? [r.reason] : []))),
      boxesLabelled: poolLabel.size,
      perPhoto: meanCI(by("pooled"), REPS, SEED),
      sharePts: boxShare("pooled"),
      blocked,
      supportingReaders: count(supportingVotes.map((v) => v.reader)),
      supportingFromFused: supportingVotes.filter((v) => v.fromFused).length,
      supportingVotes: supportingVotes.length,
      readerVotesWithFusion: fusedReaders.length,
      readerVotesFusedConfirm: fusedReaders.filter((v) => v.top?.passes && v.fromFused).length,
      confirmedBase: sum("base"),
      noFusion: { groupsPooled: pooled.filter((p) => p.noFusion.work).length, boxesLabelled: noFusionLabel.size, perPhoto: meanCI(by("noFusion"), REPS, SEED), sharePts: boxShare("noFusion") },
    },
    f0h,
    loro: { groups: loro.groups, mixedGroups: loro.mixed, all: precision(loro.views), nonTrivial: precision(nonTrivialLoro), trivialViews: loro.views.length - nonTrivialLoro.length },
    hide: { hidden: hide.hidden, tooFew: hide.tooFew, all: precision(hide.views), nonTrivial: precision(hide.views.filter((v) => !v.trivial)) },
    hard: {
      pairs: hard.pairs,
      views: hard.views.length,
      gatedViews: gated.length,
      gatedHarm: gated.filter((v) => (v.harm ?? 0) > 0).length,
      gatedMerged: gated.filter((v) => v.merged).length,
      ungatedHarm: hard.views.filter((v) => (v.harm ?? 0) > 0).length,
      ungatedMerged: hard.views.filter((v) => v.merged).length,
      ungatedHarmShare: share(hard.views, (v) => (v.harm ?? 0) > 0),
      ungatedPooledToAWork: hard.views.filter((v) => v.outcome !== "none").length,
    },
    yardstick: truth
      ? {
          wrongBase: sum("wrongBase"),
          wrongWith: sum("wrongWith"),
          wrongPerImageDelta: meanCI(photos.map((p) => Number(p.wrongWith) - Number(p.wrongBase)), REPS, SEED),
          wrongShareBase: wrongShare("base"),
          wrongShareWith: wrongShare("with"),
          overBase: sum("overBase"),
          overWith: sum("overWith"),
          pooledBoxes: poolLabel.size,
        }
      : null,
    runtime: { seconds: Math.round((Date.now() - t0) / 1000), newLookups: ctx.stats.lookups, cachedLookups: ctx.stats.cached },
  };
}

type SetMetrics = ReturnType<typeof analyseSet>;

/** The point estimate `a` sits inside interval `b`. */
const within = (a: Tri, b: Tri): boolean => a !== null && b !== null && a[0] >= b[1] && a[0] <= b[2];

function keepRule(p: SetMetrics, y: SetMetrics) {
  const lift = p.pooling.perPhoto;
  const k2 = p.loro.nonTrivial;
  const k3 = p.hide.all;
  const yd = y.yardstick!;
  return {
    K1: lift !== null && lift[1] > 0,
    K2: k2.confirmed > 0 && k2.wrong <= MAX_WRONG_SHARE * k2.confirmed,
    K3: k3.confirmed === 0 || k3.wrong <= MAX_WRONG_SHARE * k3.confirmed,
    K3unmeasured: k3.confirmed === 0,
    K4: p.hard.gatedHarm === 0 && y.hard.gatedHarm === 0,
    K5: yd.wrongPerImageDelta !== null && yd.wrongPerImageDelta[1] <= 0 && within(yd.wrongShareWith, yd.wrongShareBase),
    K5vacuous: yd.pooledBoxes === 0,
  };
}

function analyse(): void {
  const t0 = Date.now();
  const sets = Object.fromEntries(SET_NAMES.map((s) => [s, analyseSet(context(s))])) as Record<SetName, SetMetrics>;
  const keep = keepRule(sets["pilot-000"], sets.yardstick);
  const metrics = {
    card: "F-0g2",
    run: "2026-11-04",
    note: "Aggregates only. pilot-000 is machine agreement, never accuracy (INV-17); the yardstick is PROXY (library shelves). Never pooled (OC35).",
    boxSet: "F-0g's shipped copy groups (main fccd1a2) with links touching a box F-0i's partition drops removed; F-0's cached readings; catalog default, C-3 generation",
    pool: POOL,
    maxWrongShare: MAX_WRONG_SHARE,
    sets,
    keep: { ...keep, ship: keep.K1 && keep.K2 && keep.K3 && keep.K4 && keep.K5 },
    seconds: Math.round((Date.now() - t0) / 1000),
  };
  const dir = join(REPO, "evals", "F0g2");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "metrics.json"), JSON.stringify(metrics, null, 2) + "\n");
  const reportPath = join(dir, "report.md");
  const report = readFileSync(reportPath, "utf8");
  const marker = "<!-- results -->";
  writeFileSync(reportPath, report.slice(0, report.indexOf(marker) + marker.length) + "\n" + tables(metrics));
  log(`analyse: ${metrics.seconds} s -> evals/F0g2/`);
}

/**
 * The private record: one line per copy of every eligible group, with its group, the group's size, its decision
 * basis, the source copies and supporting reader models, and per model how many copies were fused. Never a merge.
 * The pooled readings and every view's outcome go beside it.
 */
function writeRecords(ctx: Ctx, pooled: Pooled[], views: View[]): void {
  const dir = stage(ctx.set);
  const copies = pooled.flatMap((p, k) =>
    p.result.decisions.map((d) =>
      JSON.stringify({
        ...d,
        group: k,
        groupSize: p.group.ids.length,
        band: p.group.band,
        groupReason: p.result.reason,
        votes: p.result.votes.map((v) => ({ reader: v.reader, copiesRead: v.copiesRead, copiesFused: v.copiesFused, fromFused: v.fromFused, workId: v.top?.workId ?? null, passes: v.top?.passes ?? false })),
      }),
    ),
  );
  writeFileSync(join(dir, "copies.jsonl"), copies.join("\n") + "\n");
  const readings = pooled.map((p, k) =>
    JSON.stringify({
      group: k,
      ids: p.group.ids,
      work: p.result.work,
      readers: READERS.flatMap((r) => {
        const pr = pooledReading(p.group.ids.map(ctx.copy), r);
        const v = p.result.votes.find((x) => x.reader === r);
        return v ? [{ reader: r, fusedAligned: pr.fusion?.fusedAligned ?? null, fusedAll: pr.fusion?.fusedAll ?? null, centre: pr.fusion?.centre.copy ?? null, top: v.top, fromFused: v.fromFused }] : [];
      }),
    }),
  );
  writeFileSync(join(dir, "pooled.jsonl"), readings.join("\n") + "\n");
  writeFileSync(join(dir, "views.jsonl"), views.map((v) => JSON.stringify(v)).join("\n") + "\n");
}

// --- report tables ------------------------------------------------------------------------------------------------

const pc = (t: Tri, d = 1) => (t ? `${(t[0] * 100).toFixed(d)} % (${(t[1] * 100).toFixed(d)}–${(t[2] * 100).toFixed(d)})` : "–");
const num = (t: Tri, d = 2) => (t ? `${t[0].toFixed(d)} (${t[1].toFixed(d)} to ${t[2].toFixed(d)})` : "–");
const frac = (k: number, n: number, up: number | null) => (n ? `${k} of ${n} (${((100 * k) / n).toFixed(1)} %; Wilson upper ${((up ?? 0) * 100).toFixed(1)} %)` : "– (none confirmed)");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tables(m: any): string {
  const out: string[] = [];
  for (const set of SET_NAMES) {
    const s = m.sets[set];
    out.push(`### ${set === "pilot-000" ? "pilot-000 (real use): machine agreement, never accuracy" : "yardstick (PROXY, library shelves)"}\n`);
    out.push(`${s.photos} photos, ${s.boxCount} book boxes kept (${s.droppedByF0i} dropped by F-0i). Intervals: 95 % photo bootstrap.\n`);
    out.push("| measure | value |\n|---|---|");
    out.push(`| copy groups (F-0g, F-0i drops removed); eligible (no confirmed copy) | ${s.groups.total}; ${s.groups.eligible} with ${s.groups.eligibleCopies} copies (sizes ${Object.entries(s.groups.sizes).sort().map(([k, v]) => `${k}: ${v}`).join(", ")}) |`);
    const p = s.pooling;
    out.push(`| eligible groups pooled to a work (two models agree) | ${p.groupsPooled} of ${s.groups.eligible}; not pooled: ${kv(p.groupReasons)} |`);
    out.push(`| **boxes confirmed-by-pooling per photo** | **${num(p.perPhoto)}** (${p.boxesLabelled} boxes; +${pc(p.sharePts, 2).replace(" %", " pts")} of boxes; base ${p.confirmedBase} confirmed by F-0 and F-0g) |`);
    out.push(`| copies in pooled groups left unknown | ${kv(p.blocked)} |`);
    out.push(`| supporting models | ${kv(p.supportingReaders)}; ${p.supportingFromFused} of ${p.supportingVotes} supporting votes won by a fused text |`);
    out.push(`| model votes with two or more copies fused; of them confirming on a fused text | ${p.readerVotesWithFusion}; ${p.readerVotesFusedConfirm} |`);
    out.push(`| no-fusion arm (cross-copy agreement only) | ${p.noFusion.groupsPooled} groups, ${p.noFusion.boxesLabelled} boxes; per photo ${num(p.noFusion.perPhoto)} |`);
    if (s.f0h) out.push(`| against F-0h's confirmed-by-context | ${s.f0h.pooledAlsoByContext} pooled boxes also context-confirmed (${s.f0h.sameWork} same work, ${s.f0h.differentWork} different); ${s.f0h.pooledNotByContext} not context-confirmed |`);
    const l = s.loro;
    out.push(`| leave one reader out: confirmed groups (mixed left out) | ${l.groups} (${l.mixedGroups}); ${l.all.views} views, ${l.trivialViews} trivial |`);
    out.push(`| **LORO non-trivial: wrong of pooled confirmations** | **${frac(l.nonTrivial.wrong, l.nonTrivial.confirmed, l.nonTrivial.wrongWilsonUpper)}**; recovered ${pc(l.nonTrivial.recovered)} of ${l.nonTrivial.views} views; ${l.nonTrivial.fusedWins} won by a fused text |`);
    out.push(`| LORO all views: wrong of pooled confirmations | ${frac(l.all.wrong, l.all.confirmed, l.all.wrongWilsonUpper)}; recovered ${pc(l.all.recovered)} |`);
    const h = s.hide;
    out.push(`| hide the confirmed copy: copies hidden (skipped, fewer than two left) | ${h.hidden} (${h.tooFew}); ${h.all.views} views |`);
    out.push(`| **hide: wrong of pooled confirmations** | **${frac(h.all.wrong, h.all.confirmed, h.all.wrongWilsonUpper)}**; recovered ${pc(h.all.recovered)}; non-trivial views ${h.nonTrivial.views}, confirmed ${h.nonTrivial.confirmed}, wrong ${h.nonTrivial.wrong} |`);
    const k = s.hard;
    out.push(`| hard negatives (shared author, different work, both confirmed) | ${k.pairs} pairs, ${k.views} views, ${k.gatedViews} past F-0g's gates |`);
    out.push(`| **hard negatives past the gates: views doing harm (pooled into one)** | **${k.gatedHarm}** (${k.gatedMerged}) of ${k.gatedViews} |`);
    out.push(`| hard negatives forced to pool (no gates): harm (pooled into one) | ${k.ungatedHarm} (${k.ungatedMerged}) of ${k.views}; ${pc(k.ungatedHarmShare)}; pooled to some work ${k.ungatedPooledToAWork} |`);
    if (s.yardstick) {
      const y = s.yardstick;
      out.push(`| **yardstick wrong accepts** (accepted work not annotated in the image) | ${y.wrongBase} → ${y.wrongWith}; per image Δ ${num(y.wrongPerImageDelta)}; share of accepted ${pc(y.wrongShareBase)} → ${pc(y.wrongShareWith)} |`);
      out.push(`| boxes labelled a work beyond its annotated copies | ${y.overBase} → ${y.overWith} |`);
    }
    out.push(`| runtime | ${s.runtime.seconds} s (${s.runtime.newLookups} new catalog lookups, ${s.runtime.cachedLookups} cached) |`);
    out.push("");
  }
  const k = m.keep;
  const yes = (b: boolean) => (b ? "yes" : "no");
  out.push(`### Keep rule\n\n| part | met |\n|---|---|`);
  out.push(`| K1 pilot-000 boxes confirmed-by-pooling, interval excluding 0 | ${yes(k.K1)} |`);
  out.push(`| K2 leave one reader out, non-trivial: wrong ≤ 5 % of pooled confirmations | ${yes(k.K2)} |`);
  out.push(`| K3 hide the confirmed copy: wrong ≤ 5 % of pooled confirmations | ${yes(k.K3)}${k.K3unmeasured ? " (unmeasured: no view confirmed)" : ""} |`);
  out.push(`| K4 hard negatives: no gated view does harm | ${yes(k.K4)} |`);
  out.push(`| K5 yardstick wrong accepts do not rise beyond their interval | ${yes(k.K5)}${k.K5vacuous ? " (vacuous: nothing pooled)" : ""} |`);
  out.push(`| **ship confirmed-by-pooling** | **${yes(k.ship)}** |\n`);
  return out.join("\n") + "\n";
}

// --- render: the private review page ----------------------------------------------------------------------------------

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * One card per eligible group, pooled groups first, the owner's example photos first within each: the group cut from
 * the working copy (an SVG view of the photo file, nothing copied), each copy's decision, and each model's fused
 * reading and vote. Written under the data root only.
 */
function render(): void {
  for (const set of SET_NAMES) {
    const ctx = context(set);
    const pooled = poolEligible(ctx);
    const paths = new Map(imagesOf(set).map((i) => [i.id, i.path]));
    const firstPath = join(ROOT, "private", "f0g", "examples-order.json");
    const first: string[] = existsSync(firstPath) ? (JSON.parse(readFileSync(firstPath, "utf8")) as { first: string[] }).first : [];
    const photoNo = new Map([...ctx.run.dets.keys()].map((id, n) => [id, n + 1]));
    const order = (p: Pooled) => (p.result.work ? 0 : 2) + (first.includes(p.group.imageId) ? 0 : 1);
    const cards = [...pooled].sort((a, b) => order(a) - order(b)).map((p) => {
      const det = ctx.run.dets.get(p.group.imageId)!;
      const polys = p.group.ids.map((id) => det.spines[Number(id.split(":").at(-1))]!.polygon);
      const xs = polys.flat().map((q) => q[0]);
      const ys = polys.flat().map((q) => q[1]);
      const pad = 40;
      const [x0, y0] = [Math.max(0, Math.min(...xs) - pad), Math.max(0, Math.min(...ys) - pad)];
      const [w, h] = [Math.min(det.width, Math.max(...xs) + pad) - x0, Math.min(det.height, Math.max(...ys) + pad) - y0];
      const dec = new Map(p.result.decisions.map((d) => [d.id, d]));
      const shapes = polys
        .map((q, k) => {
          const d = dec.get(p.group.ids[k]!)!;
          const colour = d.basis ? "#1a9850" : p.result.work ? "#d73027" : "#999";
          return `<polygon points="${q.map((pt) => pt.join(",")).join(" ")}" fill="none" stroke="${colour}" stroke-width="${Math.max(3, w / 120)}"/><text x="${q[0][0]}" y="${q[0][1] - 6}" font-size="${Math.max(18, w / 14)}" fill="${colour}">${k + 1}</text>`;
        })
        .join("");
      const svg = `<svg viewBox="${x0} ${y0} ${w} ${h}" width="${Math.round(Math.min(360, (360 * w) / h))}" height="360"><image href="file://${esc(paths.get(p.group.imageId) ?? "")}" x="0" y="0" width="${det.width}" height="${det.height}"/>${shapes}</svg>`;
      const work = p.result.work ? `<b>${esc(p.result.work.title)}</b> — ${esc(p.result.work.authors.join(", "))}` : `<i>no pooled work (${esc(p.result.reason ?? "")})</i>`;
      const readers = READERS.flatMap((r) => {
        const v = p.result.votes.find((x) => x.reader === r);
        if (!v) return [];
        const pr = pooledReading(p.group.ids.map(ctx.copy), r);
        const t = v.top ? `${esc(v.top.title)} (score ${v.top.score}, title ${r4(v.top.titleEvidence)}, cov ${v.top.coverage}${v.top.passes ? ", passes" : ""})` : "—";
        return [`<tr><td>${r}${p.result.supporting.includes(r) ? " ✓" : ""}</td><td>${v.copiesRead} read, ${v.copiesFused} fused</td><td><code>${esc(pr.fusion?.fusedAll ?? "")}</code></td><td>${t}${v.fromFused ? " [fused]" : ""}</td></tr>`];
      }).join("");
      const copies = p.group.ids.map((id, k) => {
        const d = dec.get(id)!;
        return `<li>${k + 1}: ${d.basis ?? "unknown"}${d.blocked ? ` (${d.blocked})` : ""}${d.consistent ? `; own readers ${d.consistent.join(", ")}` : ""}</li>`;
      }).join("");
      return `<section><h3>photo ${photoNo.get(p.group.imageId)}${first.includes(p.group.imageId) ? " (owner example)" : ""} · band ${p.group.band} · ${p.group.ids.length} copies</h3><div class="row">${svg}<div><p>${work}</p><ul>${copies}</ul><table><tr><th>model</th><th>copies</th><th>fused reading</th><th>vote</th></tr>${readers}</table></div></div></section>`;
    });
    const html = `<!doctype html><meta charset="utf-8"><title>F-0g2 pooled reading · ${set}</title><style>body{font:14px system-ui;margin:16px}section{border-top:1px solid #ccc;padding:8px 0}.row{display:flex;gap:16px;align-items:flex-start}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:2px 6px;vertical-align:top}code{white-space:pre-wrap}</style><h1>F-0g2 pooled reading · ${set} (private)</h1><p>${pooled.filter((p) => p.result.work).length} of ${pooled.length} eligible groups pooled to a work. Green: confirmed-by-pooling; red: left unknown in a pooled group; grey: no pooled work.</p>${cards.join("")}`;
    const out = join(PRIV, "renders", set);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "index.html"), html);
    log(`render written under the data root's private/f0g2/renders/${set}/`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd] = process.argv.slice(2);
  if (cmd === "analyse") analyse();
  else if (cmd === "render") render();
  else {
    console.error("usage: node src/eval/f0g2-cli.ts analyse | render");
    process.exit(2);
  }
}
