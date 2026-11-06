// KN-2 runner: the section prior in shadow mode on each set's cached boxes and readings, re-decided today.
//
//   node src/eval/section-prior-cli.ts ranked <pilot-000|yardstick>   # each book box's readers' ranked candidates and
//                                                                        # F-0's decision on them (private cache)
//   node src/eval/section-prior-cli.ts analyse                       # both sets: evals/KN2/metrics.json (aggregates only),
//                                                                        # the shadow log under the data root's private/kn2/<set>/
//
// Shadow mode: every decision is logged beside what the prior would change; no decision, cache or default changes.
// The box set is RB-1's (`loadBoxSet`, through F-0g's `loadBooks`) and the rows are F-0h's (`buildRows`, keys
// `<photo>|<k>`), so SC-1's records land on the rows they were read for. Each set is retrieved and decided on its own
// catalog with KN-1's `work_features` added (`pilot-000`: `catalog-kn1.sqlite`; the yardstick: its inventory catalog's
// `f0-inventory-catalog-kn1.sqlite`; KN-1's gates: the same accepts at 1.000), and F-0's `readers-agree` decision is
// re-decided from the cached readings. Decisions in force: F-0's `readers-agree`, then F-0g's `confirmed-by-copy`, then
// F-0h's `confirmed-by-context` (TS-0's order). Nothing reads the reader's taste, seeds or lenses (INV-13). CPU only.
// Only aggregates leave $BOOKCASE_DATA (evals/KN2/).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { isAnnotated, yardstickBooks } from "./c5-eval.ts";
import { openCatalog } from "../catalog/cli.ts";
import { KN1_CATALOGS } from "./kn1-eval.ts";
import { retrieve, type Candidate } from "../catalog/retrieve.ts";
import { hasWorkFeatures, SECTION_GENRES, workKnowledge, type SectionFamily, type WorkKnowledge } from "../catalog/work-features.ts";
import { dataRoot } from "../ledger/images.ts";
import { confirms, decide, loadReadings, readJsonl, READERS, variantsOf, vote, type Detection, type ReaderName, type ReaderVotes } from "./f0.ts";
import { meanCI, SETS, type SetName, type Slim } from "./f0c-cli.ts";
import { loadBooks, loadDets } from "./f0g-cli.ts";
import { buildRows } from "./f0h.ts";
import { rng, quantile } from "./q1.ts";
import {
  buildMix,
  majorityForm,
  PRIOR,
  priorVote,
  rerank,
  type FeatureLookup,
  type RankedCandidate,
  type Rerank,
  type RerankWhy,
  type SectionMix,
  type SectionSign,
  type ShadowRecord,
  type WorkFeatureTerms,
} from "../identify/section-prior.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const ROOT = dataRoot();
const PRIV = join(ROOT, "private", "kn2");
/** Each set's catalog with KN-1's `work_features` (KN-1, #68 and #70). */
const CATALOGS: Record<SetName, string> = { "pilot-000": join(ROOT, KN1_CATALOGS["pilot-000"].kn1), yardstick: join(ROOT, KN1_CATALOGS.yardstick.kn1) };
const SET_NAMES: SetName[] = ["pilot-000", "yardstick"];
const log = (s: string): void => console.error(`[kn2] ${new Date().toISOString().slice(11, 19)} ${s}`);
const r4 = (x: number) => Math.round(x * 10000) / 10000;
const share = (k: number, n: number): number | null => (n ? r4(k / n) : null);

/** Pre-registered evaluation constants (evals/KN2/prereg.md). */
export const EVAL = {
  reps: 2000,
  seed: 20261105,
  shuffles: 200,
  /** Gate G1: F-0's vote on the cached ranked tops reproduces F-0's own `decide` on at least this share of book boxes. */
  reproduce: 0.999,
} as const;

const stage = (set: string): string => {
  const dir = join(PRIV, set);
  mkdirSync(dir, { recursive: true });
  return dir;
};

// --- KN-1's work features -------------------------------------------------------------------------------------------

interface Features {
  lookup: FeatureLookup;
  /** SC-1's section family as genre terms of the mix (empty: the family maps to none). */
  signTerms: (family: string) => readonly string[];
}

/**
 * One work's mix terms from KN-1's `workKnowledge`, both sources together: genre = the genre rows' **families** (`sf`,
 * `fantasy`, `crime`, …: canons are too fine for a row of a dozen books), subject = the subject terms, form = KN-1's
 * one form (`pickForm`). Null when it has none.
 */
export function termsOf(k: Pick<WorkKnowledge, "genres" | "subjects" | "form">): WorkFeatureTerms | null {
  const genre = [...new Set(k.genres.filter((f) => f.family).map((f) => f.family!))].sort();
  const subject = [...new Set(k.subjects.map((f) => f.term))].sort();
  const form = k.form?.canon ?? null;
  return genre.length || subject.length || form ? { genre, subject, form } : null;
}

/** SC-1's section family as genre families of the mix (KN-1's `SECTION_GENRES`); its form canons are not used. */
export const signTerms = (family: string): readonly string[] => SECTION_GENRES[family as SectionFamily]?.families ?? [];

function openFeatures(db: DatabaseSync): Features {
  if (!hasWorkFeatures(db)) throw new Error("the catalog has no work_features table (KN-1)");
  const memo = new Map<string, WorkFeatureTerms | null>();
  const lookup = (id: string) => {
    if (!memo.has(id)) memo.set(id, termsOf(workKnowledge(db, id)));
    return memo.get(id)!;
  };
  return { lookup, signTerms };
}

// --- one set's data ------------------------------------------------------------------------------------------------

type Basis = "readers-agree" | "confirmed-by-copy" | "confirmed-by-context";

interface Member {
  id: string;
  imageId: string;
  rowKey: string | null;
  inForce: { workId: string; basis: Basis } | null;
}

interface SetData {
  set: SetName;
  dets: Map<string, Detection>;
  /** Book boxes by id; rows in order. */
  members: Map<string, Member>;
  rows: Map<string, string[]>;
  signs: Map<string, SectionSign>;
  photos: string[];
}

/** A set's book boxes and rows; `accepted` (F-0's re-decided accepts) sets what is in force, when given. */
function loadSet(set: SetName, accepted: Map<string, string | null> | null): SetData {
  const dets = loadDets(set);
  const books = loadBooks(set, dets);
  const byBasis = (path: string, basis: string) =>
    new Map(readJsonl<{ id: string; basis: string | null; workId: string | null }>(path).filter((c) => c.basis === basis && c.workId).map((c) => [c.id, c.workId!]));
  const copies = byBasis(join(ROOT, "private", "f0g", set, "copies.jsonl"), "confirmed-by-copy");
  const context = byBasis(join(ROOT, "private", "f0h", set, "decisions.jsonl"), "confirmed-by-context");
  const inForce = (id: string): Member["inForce"] => {
    const a = accepted?.get(id);
    if (a) return { workId: a, basis: "readers-agree" };
    if (copies.has(id)) return { workId: copies.get(id)!, basis: "confirmed-by-copy" };
    if (context.has(id)) return { workId: context.get(id)!, basis: "confirmed-by-context" };
    return null;
  };
  const members = new Map<string, Member>();
  const rows = new Map<string, string[]>();
  for (const d of dets.values()) {
    const isBook = (i: number) => books.get(d.id)![i]!;
    buildRows(d, isBook).forEach((r, k) => rows.set(`${d.id}|${k}`, r.members.map((i) => `${d.id}:${i}`)));
    d.spines.forEach((_, i) => {
      if (isBook(i)) members.set(`${d.id}:${i}`, { id: `${d.id}:${i}`, imageId: d.id, rowKey: null, inForce: accepted ? inForce(`${d.id}:${i}`) : null });
    });
  }
  for (const [key, ids] of rows) for (const id of ids) members.get(id)!.rowKey = key;
  const signPath = join(ROOT, "private", "sc1", set, "rows.jsonl");
  if (!existsSync(signPath)) throw new Error(`run node src/eval/sc1-cli.ts analyse first (${set})`);
  const signs = new Map(
    readJsonl<{ key: string; family: string | null; confidence: number }>(signPath)
      .filter((r) => r.family && rows.has(r.key))
      .map((r) => [r.key, { family: r.family!, confidence: r.confidence }]),
  );
  return { set, dets, members, rows, signs, photos: [...dets.keys()].sort() };
}

// --- ranked candidates and F-0's decision (cached) ---------------------------------------------------------------------

type Ranked = Partial<Record<ReaderName, RankedCandidate[]>>;
interface RankedLine {
  id: string;
  /** Which readers read any text (F-0's `readText`). */
  read: Partial<Record<ReaderName, boolean>>;
  readers: Ranked;
  /** F-0's own `decide` on catalog-kn1, for gate G1. */
  decided: string | null;
}

/**
 * Each book box's readers' ranked candidates, `PRIOR.depth` deep, as the prior may see them (no title, author or
 * popularity), and F-0's own decision on the same readings and catalog.
 */
function ranked(set: SetName): void {
  const sd = loadSet(set, null);
  const readings = loadReadings(SETS[set].base);
  const db = openCatalog(CATALOGS[set]);
  const cache = new Map<string, Candidate | undefined>();
  const lines: string[] = [];
  let n = 0;
  const t0 = Date.now();
  for (const m of sd.members.values()) {
    const reads = readings.get(m.id) ?? {};
    const read: RankedLine["read"] = {};
    const readers: Ranked = {};
    for (const r of READERS) {
      if (!reads[r]) continue;
      const v = variantsOf(reads[r]);
      read[r] = v.length > 0;
      if (v.length) readers[r] = retrieve(db, v, PRIOR.depth).map((c) => ({ workId: c.workId, score: c.score, passes: confirms(c) }));
    }
    const decided = decide(db, m.id, m.imageId, 0, reads, cache).accepted?.workId ?? null;
    lines.push(JSON.stringify({ id: m.id, read, readers, decided } satisfies RankedLine));
    if (++n % 500 === 0) log(`${set}: ${n} of ${sd.members.size} boxes (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
  writeFileSync(join(stage(set), "ranked.jsonl"), lines.join("\n") + "\n");
  log(`${set}: ranked candidates for ${n} boxes under the data root's private/kn2/${set}/ (${Math.round((Date.now() - t0) / 1000)} s)`);
}

const loadRanked = (set: SetName): Map<string, RankedLine> => {
  const path = join(stage(set), "ranked.jsonl");
  if (!existsSync(path)) throw new Error(`run node src/eval/section-prior-cli.ts ranked ${set} first`);
  return new Map(readJsonl<RankedLine>(path).map((r) => [r.id, r]));
};

/** F-0's vote on a box's cached ranked tops, with no prior: the re-decided base. */
function baseOf(line: RankedLine | undefined): Slim & { votes: ReaderVotes } {
  const confirmed: ReaderVotes["confirmed"] = {};
  for (const r of READERS) {
    if (line?.read[r] === undefined) continue;
    const top = line.readers[r]?.[0];
    confirmed[r] = top && top.passes ? top.workId : null;
  }
  const votes: ReaderVotes = { readText: { ...(line?.read ?? {}) }, top: {}, confirmed };
  const v = vote(votes);
  return { id: line?.id ?? "", imageId: "", accepted: v.acceptedId, confirmed, readText: votes.readText, reason: v.reason, votes };
}

// --- the shadow run -------------------------------------------------------------------------------------------------

type Base = ReturnType<typeof baseOf>;

/** One box under the prior: each reader's re-rank and F-0's vote on the result. */
function shadowOf(id: string, rowKey: string | null, mix: SectionMix | null, line: RankedLine | undefined, base: Base, features: FeatureLookup): { record: ShadowRecord; reranks: Partial<Record<ReaderName, Rerank>> } {
  const reranks: Partial<Record<ReaderName, Rerank>> = {};
  const rk = line?.readers ?? {};
  for (const r of READERS) if (rk[r]) reranks[r] = rerank(rk[r]!, mix, features);
  const prior = priorVote(base.votes, base.accepted, reranks);
  const readers: ShadowRecord["readers"] = {};
  for (const [r, x] of Object.entries(reranks) as [ReaderName, Rerank][]) readers[r] = { top: x.top, prior: x.prior, why: x.why };
  return { record: { id, rowKey, mix: mix ? { neighbours: mix.neighbours, sign: mix.sign } : null, readers, base: { accepted: base.accepted }, prior }, reranks };
}

interface TargetOutcome {
  imageId: string;
  id: string;
  rowKey: string | null;
  change: ShadowRecord["prior"]["change"];
  accepted: string | null;
  /** The reader outside a new accept's agreement confirms another work under F-0's bar (TS-1's label-free proxy). */
  dissent: boolean;
  /** Yardstick only: the new accept's work is not annotated in the image. */
  wrong: boolean | null;
}

interface LooOutcome {
  imageId: string;
  id: string;
  change: ShadowRecord["prior"]["change"];
  /** Its form differs from the row's majority form (both known; the box itself left out). */
  formOut: boolean;
  /** None of its genre terms appears in the row's mix (both known). */
  genreOut: boolean;
}

function analyseSet(set: SetName) {
  const t0 = Date.now();
  const rk = loadRanked(set);
  const base = new Map([...rk].map(([id, l]) => [id, baseOf(l)]));
  const sd = loadSet(set, new Map([...base].map(([id, b]) => [id, b.accepted])));
  for (const id of sd.members.keys()) if (!rk.has(id)) throw new Error(`${set}: the ranked cache misses book boxes; re-run \`ranked ${set}\``);
  const db = openCatalog(CATALOGS[set]);
  const feats = openFeatures(db);
  const truth = set === "yardstick" ? yardstickBooks() : null;
  const wrongFor = (workId: string, imageId: string) => !isAnnotated(db, workId, truth!.get(imageId) ?? []);
  const fOf = (workId: string | null): WorkFeatureTerms | null => (workId ? feats.lookup(workId) : null);
  const baseFor = (id: string) => base.get(id)!;

  // Gate G1: F-0's vote on the cached ranked tops, no prior, reproduces F-0's own `decide` on the same readings.
  const ids = [...sd.members.keys()];
  const g1same = ids.filter((id) => baseFor(id).accepted === rk.get(id)!.decided).length;
  const gate = { bookBoxes: ids.length, reproduced: share(g1same, ids.length), holds: ids.length > 0 && g1same / ids.length >= EVAL.reproduce };
  if (!gate.holds) log(`${set}: gate G1 fails (${g1same} of ${ids.length}); figures below are not read`);
  // For the record: agreement with the stored base F-0h and SC-1 read (it may predate later retrieval changes).
  const storedPath = join(ROOT, "f0c", set, "base-decisions.jsonl");
  const stored = existsSync(storedPath) ? new Map(readJsonl<Slim>(storedPath).map((d) => [d.id, d.accepted])) : null;
  const storedAgreement = stored ? share(ids.filter((id) => (stored.get(id) ?? null) === baseFor(id).accepted).length, ids.length) : null;

  // Mixes: each row from its confirmed members (all bases in force), with SC-1's sign where one exists.
  const workAt = (id: string) => sd.members.get(id)?.inForce?.workId ?? null;
  const mixOf = (rowKey: string, leaveOut: string | null): SectionMix | null => {
    const ns = sd.rows.get(rowKey)!.filter((id) => id !== leaveOut && workAt(id)).map((id) => fOf(workAt(id)));
    return buildMix(ns, sd.signs.get(rowKey) ?? null, feats.signTerms);
  };
  const mixes = new Map<string, SectionMix | null>();
  for (const key of sd.rows.keys()) mixes.set(key, mixOf(key, null));

  // Shadow log beside every decision; outcomes for the targets (book boxes with no basis in force).
  const shadow: string[] = [];
  const targets: TargetOutcome[] = [];
  const why = new Map<RerankWhy, number>();
  let opportunities = 0, separated = 0;
  for (const m of sd.members.values()) {
    const mix = m.rowKey ? mixes.get(m.rowKey)! : null;
    const s = baseFor(m.id);
    const target = m.inForce === null;
    const { record, reranks } = shadowOf(m.id, m.rowKey, target ? mix : null, rk.get(m.id), s, feats.lookup);
    shadow.push(JSON.stringify({ ...record, target, inForce: m.inForce }));
    if (!target) continue;
    for (const x of Object.values(reranks)) {
      why.set(x.why, (why.get(x.why) ?? 0) + 1);
      if (x.inBand > 0) opportunities++;
      if (x.separated > 0) separated++;
    }
    const p = record.prior;
    const others = p.accepted ? READERS.filter((r) => !p.agreeing.includes(r)) : [];
    const dissent = others.some((r) => {
      const c = reranks[r]?.why === "moved" ? reranks[r]!.prior : (s.confirmed[r] ?? null);
      return c !== null && c !== p.accepted;
    });
    const wrong = truth && p.change !== "none" && p.accepted ? wrongFor(p.accepted, m.imageId) : null;
    targets.push({ imageId: m.imageId, id: m.id, rowKey: m.rowKey, change: p.change, accepted: p.accepted, dissent, wrong });
  }
  writeFileSync(join(stage(set), "shadow.jsonl"), shadow.join("\n") + "\n");

  // Stress test: each `readers-agree` box in a row, left out of its own row's mix, under the prior.
  const loo: LooOutcome[] = [];
  const looLog: string[] = [];
  for (const [key, ids] of sd.rows) {
    for (const id of ids) {
      const m = sd.members.get(id)!;
      if (m.inForce?.basis !== "readers-agree") continue;
      const mix = mixOf(key, id);
      const { record } = shadowOf(id, key, mix, rk.get(id), baseFor(id), feats.lookup);
      const own = fOf(m.inForce.workId);
      const others = ids.filter((x) => x !== id && workAt(x)).map((x) => fOf(workAt(x)));
      const maj = majorityForm(others);
      const formOut = own?.form != null && maj !== null && own.form !== maj;
      const genreOut = mix !== null && mix.weight.genre > 0 && own !== null && own.genre.length > 0 && own.genre.every((g) => !mix.shares.genre[g]);
      loo.push({ imageId: m.imageId, id, change: record.prior.change, formOut, genreOut });
      looLog.push(JSON.stringify({ ...record, formOut, genreOut }));
    }
  }
  writeFileSync(join(stage(set), "loo.jsonl"), looLog.join("\n") + "\n");

  // Shuffle control: each target's mix replaced by a random other row's (same set), seeded.
  const withMix = [...mixes].filter(([, p]) => p !== null).map(([k]) => k);
  const realNew = targets.filter((t) => t.change === "new-accept").length;
  const shuffled: number[] = [];
  const rand = rng(EVAL.seed);
  const targetIds = targets.filter((t) => t.rowKey);
  for (let s = 0; s < EVAL.shuffles && withMix.length > 1; s++) {
    let k = 0;
    for (const t of targetIds) {
      let other = t.rowKey!;
      while (other === t.rowKey) other = withMix[Math.floor(rand() * withMix.length)]!;
      const { record } = shadowOf(t.id, t.rowKey, mixes.get(other)!, rk.get(t.id), baseFor(t.id), feats.lookup);
      if (record.prior.change === "new-accept") k++;
    }
    shuffled.push(k);
  }
  shuffled.sort((a, b) => a - b);

  // What the single-genre catalog leaves the prior: coverage, concentration, separation.
  const rowsN = sd.rows.size;
  const built = [...mixes.values()].filter((p): p is SectionMix => p !== null);
  const topShare = (p: SectionMix, f: "genre" | "form") => Math.max(0, ...Object.values(p.shares[f]));
  const confirmedWorks = [...sd.members.values()].filter((m) => m.inForce).map((m) => m.inForce!.workId);
  const topsKnown = targets.flatMap((t) => READERS.map((r) => rk.get(t.id)?.readers[r]?.[0]?.workId).filter((w): w is string => Boolean(w)));
  const genreTerms = new Map<string, number>();
  for (const p of built) for (const g of Object.keys(p.shares.genre)) genreTerms.set(g, (genreTerms.get(g) ?? 0) + 1);

  const perPhoto = (pred: (t: TargetOutcome) => boolean) => sd.photos.map((ph) => targets.filter((t) => t.imageId === ph && pred(t)).length);
  const changes = (xs: { change: string }[]) => Object.fromEntries(["none", "new-accept", "lost-accept", "changed-accept"].map((c) => [c, xs.filter((x) => x.change === c).length]));
  const lost = (xs: LooOutcome[]) => xs.filter((x) => x.change === "lost-accept" || x.change === "changed-accept").length;
  const baseAccepts = [...sd.members.values()].filter((m) => m.inForce?.basis === "readers-agree");
  const baseWrong = truth ? baseAccepts.filter((m) => wrongFor(m.inForce!.workId, m.imageId)).length : null;

  log(`${set}: analysed (${Math.round((Date.now() - t0) / 1000)} s)`);
  return {
    set,
    scope: SETS[set].scope,
    catalog: CATALOGS[set].split("/").at(-1),
    gate,
    storedAgreement,
    bookBoxes: sd.members.size,
    rows: rowsN,
    targets: targets.length,
    inForce: {
      "readers-agree": baseAccepts.length,
      "confirmed-by-copy": [...sd.members.values()].filter((m) => m.inForce?.basis === "confirmed-by-copy").length,
      "confirmed-by-context": [...sd.members.values()].filter((m) => m.inForce?.basis === "confirmed-by-context").length,
    },
    coverage: {
      rowsWithMix: built.length,
      rowsWithMixShare: share(built.length, rowsN),
      rowsWithSign: sd.signs.size,
      mixesWithSign: built.filter((p) => p.sign).length,
      confirmedWithFeatures: share(confirmedWorks.filter((w) => fOf(w) !== null).length, confirmedWorks.length),
      targetTopsWithFeatures: share(topsKnown.filter((w) => fOf(w) !== null).length, topsKnown.length),
    },
    concentration: {
      meanTopGenreShare: built.length ? r4(built.reduce((a, p) => a + topShare(p, "genre"), 0) / built.length) : null,
      mixesTopGenreAtLeast80: share(built.filter((p) => topShare(p, "genre") >= 0.8).length, built.length),
      meanTopFormShare: built.length ? r4(built.reduce((a, p) => a + topShare(p, "form"), 0) / built.length) : null,
      meanGenreTerms: built.length ? r4(built.reduce((a, p) => a + Object.keys(p.shares.genre).length, 0) / built.length) : null,
      distinctGenreTermsAcrossMixes: genreTerms.size,
    },
    reranks: { byWhy: Object.fromEntries([...why].sort()), opportunities, separated, separatedShare: share(separated, opportunities) },
    shadow: {
      changes: changes(targets),
      newAcceptsPerPhoto: meanCI(perPhoto((t) => t.change === "new-accept"), EVAL.reps, EVAL.seed),
      newAcceptsWithDissent: targets.filter((t) => t.change === "new-accept" && t.dissent).length,
      newWrongAccepts: truth ? targets.filter((t) => t.change === "new-accept" && t.wrong).length : null,
      baseAccepts: baseAccepts.length,
      baseWrongAccepts: baseWrong,
    },
    shuffle: { real: realNew, mean: shuffled.length ? r4(shuffled.reduce((a, b) => a + b, 0) / shuffled.length) : null, p95: shuffled.length ? quantile(shuffled, 0.95) : null, shuffles: shuffled.length },
    stress: {
      looBoxes: loo.length,
      looChanges: changes(loo),
      formOut: loo.filter((x) => x.formOut).length,
      formOutLost: lost(loo.filter((x) => x.formOut)),
      genreOut: loo.filter((x) => x.genreOut).length,
      genreOutLost: lost(loo.filter((x) => x.genreOut)),
      allLost: lost(loo),
    },
  };
}

type SetMetrics = ReturnType<typeof analyseSet>;

/** The pre-registered keep rule (evals/KN2/prereg.md): for shadow → re-rank, which is the owner's ruling. */
export function keepRule(p: SetMetrics, y: SetMetrics) {
  const ci = p.shadow.newAcceptsPerPhoto;
  const k1a = p.gate.holds && ci !== null && ci[1] > 0;
  const yMoved = y.shadow.changes["new-accept"]! + y.shadow.changes["lost-accept"]! + y.shadow.changes["changed-accept"]!;
  const k1b = y.gate.holds && (y.shadow.newWrongAccepts ?? 0) === 0;
  const k2 = p.gate.holds && p.stress.formOutLost === 0;
  return {
    K1a: { holds: k1a, newAcceptsPerPhoto: ci },
    K1b: { holds: k1b, newWrongAccepts: y.shadow.newWrongAccepts, informative: yMoved > 0 },
    K2: { holds: k2, formOut: p.stress.formOut, formOutLost: p.stress.formOutLost, informative: p.stress.formOut > 0 },
    met: k1a && k1b && k2,
  };
}

function analyse(): void {
  const sets = Object.fromEntries(SET_NAMES.map((s) => [s, analyseSet(s)])) as Record<SetName, SetMetrics>;
  const metrics = { card: "KN-2", mode: "shadow", prior: PRIOR, eval: EVAL, sets, keep: keepRule(sets["pilot-000"], sets.yardstick) };
  const dir = join(REPO, "evals", "KN2");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "metrics.json"), JSON.stringify(metrics, null, 2) + "\n");
  log(`evals/KN2/metrics.json written; keep rule ${metrics.keep.met ? "met" : "not met"}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, set] = process.argv.slice(2) as [string, SetName?];
  if (cmd === "ranked" && set && SET_NAMES.includes(set)) ranked(set);
  else if (cmd === "analyse") analyse();
  else {
    console.error("usage: node src/eval/section-prior-cli.ts ranked <pilot-000|yardstick> | analyse");
    process.exit(2);
  }
}
