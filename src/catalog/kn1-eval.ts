// KN-1 evaluation: the reproduction gate for the catalog that carries `work_features`, and the coverage of shared
// book knowledge on the works F-0 confirms. No detection, no reading, no GPU: F-0's cached readings, re-decided on
// the CPU. Nothing here changes a decision, so there is no keep rule and no pre-registration.
//
//   node src/catalog/kn1-eval.ts gate --set <pilot-000|yardstick>   re-decide every box on today's catalog and on
//                                                                    catalog-kn1.sqlite; fails unless accepts agree at 1.000
//   node src/catalog/kn1-eval.ts analyse                             evals/KN1/{metrics.json,report.md}
//
// The confirmed work ids per set stay in the data root's private/kn1/; only aggregates reach evals/KN1/.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { dataRoot } from "../ledger/images.ts";
import { decide, loadReadings, readJsonl, stageDir, type SpineDecision } from "../eval/f0.ts";
import { loadBoxSet, type RB1Set } from "../eval/rb1.ts";
import { compactJson } from "../eval/q1-cli.ts";
import { openCatalog } from "./cli.ts";
import type { Candidate } from "./retrieve.ts";
import { FEATURE_SOURCES, hasWorkFeatures, type FeatureKind, type FeatureSource } from "./work-features.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const log = (s: string) => console.error(`[kn1] ${new Date().toISOString().slice(11, 19)} ${s}`);

/** Today's default catalog, and KN-1's rebuild of it with `work_features` (a new file; today's is not touched). */
export const KN1_CATALOGS = { today: "catalog.sqlite", kn1: "catalog-kn1.sqlite" } as const;
const catalogFile = (name: keyof typeof KN1_CATALOGS) => join(dataRoot(), "catalog", KN1_CATALOGS[name]);
/** RB-1's sets and the F-0 session each is read from. */
const SESSION: Record<RB1Set, string> = { "pilot-000": "pilot-000", yardstick: "yardstick-library-b2" };
const SETS = Object.keys(SESSION) as RB1Set[];

function privateDir(): string {
  const d = join(dataRoot(), "private", "kn1");
  mkdirSync(d, { recursive: true });
  return d;
}
const stamp = (path: string) => {
  const st = statSync(path);
  return `${path.split("/").at(-1)}:${st.size}:${Math.round(st.mtimeMs)}`;
};

// ---------------------------------------------------------------------------------------------
// gate
// ---------------------------------------------------------------------------------------------

interface GateFile {
  set: RB1Set;
  catalogs: { today: string; kn1: string };
  boxes: number;
  /** Re-decided on catalog-kn1 vs re-decided on today's catalog: must be 1. */
  reproducedVsToday: number;
  /** Re-decided on catalog-kn1 vs C-6's unguarded decisions on today's catalog (private/c6/decisions/). */
  reproducedVsC6: number;
  /** Re-decided on catalog-kn1 vs the session's stored decisions.jsonl, which predate C-3's rebuild (for the record). */
  reproducedVsStored: number;
  accepts: { today: number; kn1: number };
  rb1Boxes: number;
  /** F-0's `readers-agree` accepts on RB-1's box set: box id → work id. Private. */
  confirmed: Record<string, string>;
}

function gate(set: RB1Set): void {
  const dir = stageDir(dataRoot(), SESSION[set]);
  const c6 = c6Unguarded(set);
  const stored = readJsonl<SpineDecision & { accepted: { workId: string } | null }>(join(dir, "decisions.jsonl"));
  const readings = loadReadings(dir);
  const box = loadBoxSet(set);
  const today = openCatalog(catalogFile("today"));
  const kn1 = openCatalog(catalogFile("kn1"));
  if (!hasWorkFeatures(kn1)) throw new Error(`${KN1_CATALOGS.kn1} has no work_features table`);
  const caches = { today: new Map<string, Candidate | undefined>(), kn1: new Map<string, Candidate | undefined>() };
  const t0 = Date.now();
  let same = 0;
  let sameStored = 0;
  let sameC6 = 0;
  const accepts = { today: 0, kn1: 0 };
  const confirmed: Record<string, string> = {};
  let rb1Boxes = 0;
  for (const [i, d] of stored.entries()) {
    const reads = readings.get(d.id) ?? {};
    const a = decide(today, d.id, d.imageId, d.boxScore, reads, caches.today).accepted?.workId ?? null;
    const b = decide(kn1, d.id, d.imageId, d.boxScore, reads, caches.kn1).accepted?.workId ?? null;
    if (a === b) same++;
    if (b === (d.accepted?.workId ?? null)) sameStored++;
    if (b === (c6.get(d.id) ?? null)) sameC6++;
    if (a) accepts.today++;
    if (b) accepts.kn1++;
    const inSet = box.rows.get(d.id)?.state === "kept" && box.keeps(d.id);
    if (inSet) rb1Boxes++;
    if (inSet && b) confirmed[d.id] = b;
    if ((i + 1) % 1000 === 0) log(`  ${set}: ${i + 1} boxes`);
  }
  today.close();
  kn1.close();
  const out: GateFile = {
    set, catalogs: { today: stamp(catalogFile("today")), kn1: stamp(catalogFile("kn1")) }, boxes: stored.length,
    reproducedVsToday: same / stored.length, reproducedVsC6: sameC6 / stored.length, reproducedVsStored: sameStored / stored.length, accepts, rb1Boxes, confirmed,
  };
  log(`${set}: ${stored.length} boxes in ${Math.round((Date.now() - t0) / 1000)} s; accepts agree with today's catalog on ${out.reproducedVsToday.toFixed(4)}, with C-6's on ${out.reproducedVsC6.toFixed(4)}, with the stored decisions on ${out.reproducedVsStored.toFixed(4)}`);
  if (same !== stored.length) throw new Error(`${set}: ${stored.length - same} accepts differ between today's catalog and catalog-kn1 (the gate is 1.000)`);
  writeFileSync(join(privateDir(), `${set}.gate.json`), JSON.stringify(out));
}

/** C-6's unguarded (`none`) decisions on the v1 catalog: box id → accepted work id. */
function c6Unguarded(set: RB1Set): Map<string, string | null> {
  const j = JSON.parse(readFileSync(join(dataRoot(), "private", "c6", "decisions", `${SESSION[set]}.json`), "utf8")) as { none: { v1: Array<{ id: string; accepted: string | null }> } };
  return new Map(j.none.v1.map((r) => [r.id, r.accepted]));
}

function loadGate(set: RB1Set): GateFile {
  const p = join(privateDir(), `${set}.gate.json`);
  if (!existsSync(p)) throw new Error(`no gate for ${set}: run \`node src/catalog/kn1-eval.ts gate --set ${set}\``);
  const g = JSON.parse(readFileSync(p, "utf8")) as GateFile;
  if (g.catalogs.kn1 !== stamp(catalogFile("kn1"))) throw new Error(`the ${set} gate ran on ${g.catalogs.kn1}, not ${stamp(catalogFile("kn1"))}`);
  return g;
}

// ---------------------------------------------------------------------------------------------
// analyse: coverage, terms per work, agreement
// ---------------------------------------------------------------------------------------------

interface WorkView {
  nonGenre: boolean;
  rows: Record<FeatureSource, Record<FeatureKind, number>>;
  canons: Record<FeatureSource, { genre: Set<string>; form: Set<string>; family: Set<string> }>;
}

const emptyView = (nonGenre: boolean): WorkView => ({
  nonGenre,
  rows: { "isfdb-tag": { genre: 0, form: 0, subject: 0 }, "openlibrary-subject": { genre: 0, form: 0, subject: 0 } },
  canons: { "isfdb-tag": { genre: new Set(), form: new Set(), family: new Set() }, "openlibrary-subject": { genre: new Set(), form: new Set(), family: new Set() } },
});

/** One view per work id, read from catalog-kn1 (every work when `ids` is null). */
function views(db: DatabaseSync, ids: string[] | null): Map<string, WorkView> {
  const out = new Map<string, WorkView>();
  if (ids) {
    const work = db.prepare("SELECT non_genre FROM works WHERE id = ?");
    const feats = db.prepare("SELECT kind, canon, family, source FROM work_features WHERE work_id = ?");
    for (const id of ids) {
      const w = work.get(id) as { non_genre: number } | undefined;
      if (!w) throw new Error("a confirmed work is not in catalog-kn1");
      const v = emptyView(w.non_genre === 1);
      for (const f of feats.all(id) as Array<{ kind: FeatureKind; canon: string | null; family: string | null; source: FeatureSource }>) add(v, f);
      out.set(id, v);
    }
    return out;
  }
  for (const w of db.prepare("SELECT id, non_genre FROM works").iterate() as Iterable<{ id: string; non_genre: number }>) out.set(w.id, emptyView(w.non_genre === 1));
  for (const f of db.prepare("SELECT work_id, kind, canon, family, source FROM work_features").iterate() as Iterable<{ work_id: string; kind: FeatureKind; canon: string | null; family: string | null; source: FeatureSource }>) {
    add(out.get(f.work_id)!, f);
  }
  return out;
}

function add(v: WorkView, f: { kind: FeatureKind; canon: string | null; family: string | null; source: FeatureSource }) {
  v.rows[f.source][f.kind]++;
  if (f.canon && f.kind !== "subject") v.canons[f.source][f.kind].add(f.canon);
  if (f.family && f.kind === "genre") v.canons[f.source].family.add(f.family);
}

/** Wilson 95 % interval, in percent to one decimal. */
function share(k: number, n: number) {
  if (n === 0) return { k, n, pct: null, lo: null, hi: null };
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  const r = (x: number) => Math.round(x * 1000) / 10;
  return { k, n, pct: r(p), lo: r(Math.max(0, c - h)), hi: r(Math.min(1, c + h)) };
}

const total = (r: Record<FeatureKind, number>) => r.genre + r.form + r.subject;
const has = (v: WorkView, s: FeatureSource, kinds: FeatureKind[]) => kinds.some((k) => v.rows[s][k] > 0);
const median = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const mean = (xs: number[]) => (xs.length === 0 ? null : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100);
const jaccard = (a: Set<string>, b: Set<string>) => {
  const inter = [...a].filter((x) => b.has(x)).length;
  return inter / (a.size + b.size - inter);
};

function coverage(ws: WorkView[]) {
  const by = (kinds: FeatureKind[]) => ({
    isfdb: share(ws.filter((v) => has(v, "isfdb-tag", kinds)).length, ws.length),
    openlibrary: share(ws.filter((v) => has(v, "openlibrary-subject", kinds)).length, ws.length),
    either: share(ws.filter((v) => FEATURE_SOURCES.some((s) => has(v, s, kinds))).length, ws.length),
    both: share(ws.filter((v) => FEATURE_SOURCES.every((s) => has(v, s, kinds))).length, ws.length),
  });
  return { genreOrForm: by(["genre", "form"]), genre: by(["genre"]), form: by(["form"]), subject: by(["subject"]), any: by(["genre", "form", "subject"]) };
}

function termsPerWork(ws: WorkView[]) {
  const per = (s: FeatureSource) => {
    const all = ws.map((v) => total(v.rows[s]));
    const withAny = all.filter((x) => x > 0);
    return {
      meanAllWorks: mean(all),
      medianAllWorks: median(all),
      meanWorksWithAny: mean(withAny),
      medianWorksWithAny: median(withAny),
      meanByKind: { genre: mean(ws.map((v) => v.rows[s].genre)), form: mean(ws.map((v) => v.rows[s].form)), subject: mean(ws.map((v) => v.rows[s].subject)) },
    };
  };
  return { isfdb: per("isfdb-tag"), openlibrary: per("openlibrary-subject") };
}

function agreement(ws: WorkView[]) {
  const on = (key: "genre" | "form" | "family") => {
    const both = ws.filter((v) => v.canons["isfdb-tag"][key].size > 0 && v.canons["openlibrary-subject"][key].size > 0);
    const shared = both.filter((v) => [...v.canons["isfdb-tag"][key]].some((c) => v.canons["openlibrary-subject"][key].has(c)));
    return { worksWithBoth: both.length, shareWithOneInCommon: share(shared.length, both.length), meanJaccard: mean(both.map((v) => jaccard(v.canons["isfdb-tag"][key], v.canons["openlibrary-subject"][key]))) };
  };
  return { genre: on("genre"), genreFamily: on("family"), form: on("form") };
}

function summarise(ws: WorkView[]) {
  const genreFlag = ws.filter((v) => !v.nonGenre);
  const nonGenre = ws.filter((v) => v.nonGenre);
  return {
    works: ws.length,
    coverage: coverage(ws),
    termsPerWork: termsPerWork(ws),
    agreement: agreement(ws),
    /** ISFDB's own non-genre flag: works it lists outside speculative fiction. Form coverage there is expected thin. */
    byIsfdbGenreFlag: {
      genre: { works: genreFlag.length, genreOrForm: coverage(genreFlag).genreOrForm, form: coverage(genreFlag).form },
      nonGenre: { works: nonGenre.length, genreOrForm: coverage(nonGenre).genreOrForm, form: coverage(nonGenre).form },
    },
  };
}

function analyse(): void {
  const db = openCatalog(catalogFile("kn1"));
  const meta = Object.fromEntries((db.prepare("SELECT key, value FROM meta").all() as Array<{ key: string; value: string }>).map((r) => [r.key, r.value]));
  const sets: Record<string, unknown> = {};
  const gates: Record<string, unknown> = {};
  for (const set of SETS) {
    const g = loadGate(set);
    const ids = [...new Set(Object.values(g.confirmed))].sort();
    log(`${set}: ${Object.keys(g.confirmed).length} confirmed boxes, ${ids.length} works`);
    sets[set] = { confirmedBoxes: Object.keys(g.confirmed).length, ...summarise([...views(db, ids).values()]) };
    gates[set] = { boxes: g.boxes, rb1Boxes: g.rb1Boxes, accepts: g.accepts, reproducedVsToday: g.reproducedVsToday, reproducedVsC6: g.reproducedVsC6, reproducedVsStored: Math.round(g.reproducedVsStored * 10000) / 10000 };
  }
  log("catalog-wide");
  const all = summarise([...views(db, null).values()]);
  const families = Object.fromEntries((db.prepare("SELECT source, family, COUNT(DISTINCT work_id) AS n FROM work_features WHERE kind = 'genre' GROUP BY source, family ORDER BY source, n DESC").all() as Array<{ source: string; family: string; n: number }>).map((r) => [`${r.source}|${r.family}`, r.n]));
  db.close();

  const metrics = {
    runId: "KN1",
    card: "KN-1",
    date: new Date().toISOString().slice(0, 10),
    note: "Aggregates only: no titles, no ids. pilot-000 is machine agreement, never accuracy (INV-17); the yardstick is PROXY (library shelves) and its accepts include wrong ones. Never pooled (OC35). Nothing here reads the profile (INV-13) or changes a decision, so there is no keep rule.",
    catalog: { file: KN1_CATALOGS.kn1, schemaVersion: Number(meta.schema_version), workFeatures: meta.work_features, isfdbDumpDate: meta.staging_dump_date, openLibrarySubjectsDumpDate: meta["work_features.openlibrary_subjects_dump_date"] ?? null, openLibraryLinkedWorks: Number(meta["work_features.openlibrary_crosswalk_only"] ?? 0), rows: Number(meta["work_features.rows"]), rowsByKind: { genre: Number(meta["work_features.kind.genre"]), form: Number(meta["work_features.kind.form"]), subject: Number(meta["work_features.kind.subject"]) }, isfdbPrivateTagLinksSkipped: Number(meta["work_features.isfdbPrivateSkipped"]), notABookFactDropped: Number(meta["work_features.notABookFact"]) },
    confirmed: "F-0's readers-agree accepts, re-decided on catalog-kn1, on RB-1's box set; distinct works per set",
    gate: { rule: "every box's accept on catalog-kn1 equals its accept on today's catalog.sqlite (1.000)", ...gates },
    sets,
    catalogWide: { ...all, worksWithGenreByFamily: families },
  };
  const out = join(REPO, "evals", "KN1");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "metrics.json"), `${compactJson(metrics)}\n`);
  log(`wrote ${join(out, "metrics.json")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({ args: rest, options: { set: { type: "string" } } });
  if (cmd === "gate" && (values.set === "pilot-000" || values.set === "yardstick")) gate(values.set);
  else if (cmd === "analyse") analyse();
  else {
    console.error("usage: node src/catalog/kn1-eval.ts gate --set <pilot-000|yardstick> | analyse");
    process.exitCode = 1;
  }
}
