// C-9 evaluation: imprint data (every Open Library publisher string, ISFDB publisher series, Wikidata parents) and
// rule IMP-1 (src/eval/f0d.ts `imprintContrast`), on F-0d's cached imprint reads and F-0's cached readings, re-decided
// offline on C-9's rebuilt catalogs. No detection, no reading, no GPU. Pre-registration: evals/C9/prereg.md.
//
//   node src/eval/c9-eval.ts wikidata                    the parent export, once (one SPARQL query; private/c9/wikidata/)
//   node src/eval/c9-eval.ts lists --set <name> --catalog <v1|v2>
//                                                           ranked candidates per reader on every box F-0d read, and the
//                                                           reproduction gate against C-6's unguarded decisions
//   node src/eval/c9-eval.ts analyse                     p1 before and after the data fix, IMP-1 per cell, the keep rules:
//                                                           evals/C9/{metrics.json,report.md}
//
// Per-box files (reader text, work ids, imprint reads) stay in the data root's private/c9/; only aggregates reach evals/C9/.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { dataRoot } from "../ledger/images.ts";
import { confirms, loadReadings, READERS, readJsonl, stageDir, variantsOf, vote, type ReaderName, type ReaderVotes, type SpineDecision } from "./f0.ts";
import { boxImprint, type ImprintReading } from "./f0d-cli.ts";
import { IMP1, imprintContrast, workImprintKeys } from "./f0d.ts";
import { clusterBootstrap } from "./q1.ts";
import { compactJson, parseCsv } from "./q1-cli.ts";
import { loadBoxSet } from "./rb1.ts";
import { isAnnotated, yardstickBooks } from "./c5-eval.ts";
import { catalogPaths, openCatalog } from "../catalog/cli.ts";
import { imprintKey, imprintMatches, shelfMark, usableImprint, wikidataParents, type ImprintTable, type ParentLinks, type WikidataRow } from "../catalog/imprint.ts";
import { LOOKALIKE, lookalikeGuard, sameBook } from "../catalog/lookalike.ts";
import { retrieve, type Candidate } from "../catalog/retrieve.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const log = (s: string) => console.error(`[c9] ${new Date().toISOString().slice(11, 19)} ${s}`);
const pts = (x: number) => Math.round(x * 1000) / 10;

/** IMP-1 bootstrap as pre-registered (C-6's): paired photo resampling, 2,000 draws, seed 1. */
const REPS = 2000;
const SEED = 1;
/** p1 as F-0d measured it: its bootstrap seed for precision, and its shuffle seed and count for the chance level. */
const F0D = { reps: 2000, precisionSeed: 200, shuffleSeed: 20261103 + 9, shuffles: 200 } as const;

const SETS = ["pilot-000", "yardstick-library-b2"] as const;
type SetName = (typeof SETS)[number];
type CatalogName = "v1" | "v2";

/** C-9's rebuilt catalogs (schema 3). Today's files (`catalog.sqlite`, `catalog-v2.sqlite`) are not touched. */
export const C9_CATALOGS: Record<CatalogName, string> = { v1: "catalog-c9.sqlite", v2: "catalog-v2-c9.sqlite" };
const catalogFile = (cat: CatalogName) => join(dataRoot(), "catalog", C9_CATALOGS[cat]);

function privateDir(...sub: string[]): string {
  const d = join(dataRoot(), "private", "c9", ...sub);
  mkdirSync(d, { recursive: true });
  return d;
}
const stamp = (path: string) => {
  const st = statSync(path);
  return `${path.split("/").at(-1)}:${st.size}:${Math.round(st.mtimeMs)}`;
};

// ---------------------------------------------------------------------------------------------
// wikidata: one query export, kept private
// ---------------------------------------------------------------------------------------------

/** Every Wikidata item with an ISFDB publisher ID (P1239), its parent organisation (P749) or owner (P127), dates. */
export const WIKIDATA_QUERY = `SELECT ?item ?itemLabel ?isfdb ?rel ?parent ?parentLabel ?parentIsfdb ?start ?end WHERE {
  ?item wdt:P1239 ?isfdb .
  { ?item p:P749 ?st . ?st ps:P749 ?parent . BIND("P749" AS ?rel) }
  UNION
  { ?item p:P127 ?st . ?st ps:P127 ?parent . BIND("P127" AS ?rel) }
  OPTIONAL { ?st pq:P580 ?start }
  OPTIONAL { ?st pq:P582 ?end }
  OPTIONAL { ?parent wdt:P1239 ?parentIsfdb }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;

interface WikidataExport {
  endpoint: string;
  fetched: string;
  query: string;
  sha256: string;
  rows: WikidataRow[];
}

async function wikidataStage(): Promise<void> {
  const endpoint = "https://query.wikidata.org/sparql";
  const res = await fetch(`${endpoint}?query=${encodeURIComponent(WIKIDATA_QUERY)}`, {
    headers: { accept: "application/sparql-results+json", "user-agent": "BookcaseDiscovery-C9/0.1 (https://github.com/ojfbot/BookcaseDiscovery)" },
  });
  if (!res.ok) throw new Error(`query service answered ${res.status}`);
  const body = await res.text();
  const j = JSON.parse(body) as { results: { bindings: Array<Record<string, { value: string }>> } };
  const rows = j.results.bindings.map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])) as unknown as WikidataRow);
  const out: WikidataExport = { endpoint, fetched: new Date().toISOString(), query: WIKIDATA_QUERY, sha256: createHash("sha256").update(body).digest("hex"), rows };
  const path = join(privateDir("wikidata"), `${out.fetched.slice(0, 10)}.json`);
  writeFileSync(path, `${JSON.stringify(out, null, 1)}\n`);
  log(`${rows.length} statements on ${new Set(rows.map((r) => r.isfdb)).size} ISFDB publishers -> ${path}`);
}

function loadWikidata(): WikidataExport {
  const dir = privateDir("wikidata");
  const f = readdirSync(dir).filter((x) => x.endsWith(".json")).sort().at(-1);
  if (!f) throw new Error("no Wikidata export: run `c9-eval.ts wikidata` first");
  return JSON.parse(readFileSync(join(dir, f), "utf8")) as WikidataExport;
}

function parentLinks(w: WikidataExport): ParentLinks {
  const st = new DatabaseSync(catalogPaths().staging, { readOnly: true });
  const name = st.prepare("SELECT publisher_name FROM publishers WHERE publisher_id = ?");
  const memo = new Map<string, string | undefined>();
  const isfdbName = (id: string) => {
    if (!memo.has(id)) memo.set(id, (name.get(Number(id)) as { publisher_name: string } | undefined)?.publisher_name);
    return memo.get(id);
  };
  const links = wikidataParents(w.rows, isfdbName);
  st.close();
  return links;
}

/** F-0d's imprint table (ISFDB-derived parents), as F-0d saved it. */
function loadF0dTable(): ImprintTable {
  const j = JSON.parse(readFileSync(join(dataRoot(), "catalog", "imprint-table.json"), "utf8")) as { strings: number; keys: number; parents: Record<string, string[]>; editions: Record<string, number> };
  return { strings: j.strings, keys: j.keys, parents: new Map(Object.entries(j.parents).map(([k, v]) => [k, new Set(v)])), editions: new Map(Object.entries(j.editions)) };
}

// ---------------------------------------------------------------------------------------------
// lists: each reader's ranked candidates on every box F-0d read
// ---------------------------------------------------------------------------------------------

/** One candidate cut to what the bar and IMP-1 read, and whether it is the same book as its reader's top. */
type Slim = Pick<Candidate, "workId" | "title" | "authors" | "score" | "queryCoverage" | "evidence"> & { same: boolean };

export interface BoxLists {
  id: string;
  imageId: string;
  accepted: string | null;
  agreeing: ReaderName[];
  /** Per reader: candidates down to the top's score less 0.05 (the margin is 0.01), at most `LOOKALIKE.depth`. */
  lists: Partial<Record<ReaderName, Slim[]>>;
  /** Surnames of every reader's top 3 candidates: the Cutter test's only input besides the read. */
  surnames: string[];
  /** Does the accept equal C-6's unguarded decision on today's catalog (the reproduction gate)? */
  reproduced: boolean;
}

const slim = (c: Candidate, same: boolean): Slim => ({
  workId: c.workId, title: c.title, authors: c.authors, score: c.score, queryCoverage: c.queryCoverage, same,
  evidence: c.evidence.filter((e) => e.field === "title").map((e) => ({ ...e, matches: [] })),
});

function c6None(set: SetName, cat: CatalogName): Map<string, { accepted: string | null; wrong: boolean | null }> {
  const p = join(dataRoot(), "private", "c6", "decisions", `${set}.json`);
  const j = JSON.parse(readFileSync(p, "utf8")) as { none: Record<CatalogName, Array<{ id: string; accepted: string | null; wrong: boolean | null }>> };
  return new Map(j.none[cat].map((r) => [r.id, r]));
}

const readIds = (set: SetName) => readJsonl<ImprintReading>(join(dataRoot(), "private", "f0d", set, "imprint.jsonl")).filter((r) => !r.error);

function listsStage(set: SetName, cat: CatalogName): void {
  const dir = stageDir(dataRoot(), set);
  const decisions = new Map(readJsonl<SpineDecision>(join(dir, "decisions.jsonl")).map((d) => [d.id, d]));
  const readings = loadReadings(dir);
  const c6 = c6None(set, cat);
  const path = catalogFile(cat);
  const db = openCatalog(path);
  const forms = lookalikeGuard(db).forms;
  const memo = new Map<string, Candidate[]>();
  const out: BoxLists[] = [];
  let n = 0;
  const t0 = Date.now();
  for (const r of readIds(set)) {
    const d = decisions.get(r.id);
    if (!d) continue;
    const votes: ReaderVotes = { readText: {}, top: {}, confirmed: {} };
    const lists: Partial<Record<ReaderName, Slim[]>> = {};
    const surnames = new Set<string>();
    for (const reader of READERS) {
      const reading = readings.get(r.id)?.[reader];
      if (!reading) continue;
      const v = variantsOf(reading);
      votes.readText[reader] = v.length > 0;
      if (v.length === 0) continue;
      const k = v.join("\u0000");
      if (!memo.has(k)) memo.set(k, retrieve(db, v, LOOKALIKE.depth));
      const ranked = memo.get(k)!;
      const top = ranked[0];
      votes.top[reader] = top?.workId ?? null;
      votes.confirmed[reader] = top && confirms(top) ? top.workId : null;
      if (!top) continue;
      lists[reader] = ranked.filter((c) => top.score - c.score <= 0.05).map((c) => slim(c, c !== top && sameBook(top, c, forms)));
      for (const c of ranked.slice(0, 3)) for (const a of c.authors) surnames.add(a);
    }
    const v = vote(votes);
    out.push({ id: r.id, imageId: d.imageId, accepted: v.acceptedId, agreeing: v.agreeing, lists, surnames: [...surnames], reproduced: (c6.get(r.id)?.accepted ?? null) === v.acceptedId });
    if (++n % 200 === 0) log(`  ${set} ${cat}: ${n} boxes`);
  }
  db.close();
  const reproduced = out.filter((b) => b.reproduced).length / out.length;
  log(`${set} on ${cat}: ${out.length} boxes in ${Math.round((Date.now() - t0) / 1000)} s; reproduce C-6's unguarded accepts on ${reproduced.toFixed(4)}`);
  if (reproduced < 0.999) throw new Error(`${set} ${cat}: reproduction ${reproduced} under the 0.999 gate`);
  writeFileSync(join(privateDir("lists"), `${set}.${cat}.json`), JSON.stringify({ catalog: stamp(path), boxes: out }));
}

function loadLists(set: SetName, cat: CatalogName): BoxLists[] {
  const j = JSON.parse(readFileSync(join(privateDir("lists"), `${set}.${cat}.json`), "utf8")) as { catalog: string; boxes: BoxLists[] };
  if (j.catalog !== stamp(catalogFile(cat))) throw new Error(`lists for ${set} ${cat} were made on ${j.catalog}, not ${stamp(catalogFile(cat))}`);
  return j.boxes;
}

// ---------------------------------------------------------------------------------------------
// analyse
// ---------------------------------------------------------------------------------------------

/** The data versions, cumulative. `today` is what the catalogs hold before C-9; `c9` is the data fix. */
export const DATA = {
  today: { publishers: false, series: false, wikidata: false },
  "+publishers": { publishers: true, series: false, wikidata: false },
  "+series": { publishers: true, series: true, wikidata: false },
  c9: { publishers: true, series: true, wikidata: true },
} as const;
type DataName = keyof typeof DATA;

type Ci = { value: number; lo: number; hi: number } | null;
const ciPts = (c: Ci) => c && { value: pts(c.value), lo: pts(c.lo), hi: pts(c.hi) };

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** F-0d's chance level: the match rate with each box's imprint moved to another box (seeded shuffles), in %. */
function chance(rows: Array<{ key: string; work: string }>, matches: (key: string, work: string) => boolean): number | null {
  if (rows.length < 2) return null;
  const r = rng(F0D.shuffleSeed);
  let hit = 0, n = 0;
  for (let k = 0; k < F0D.shuffles; k++) {
    const keys = rows.map((x) => x.key);
    for (let i = keys.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [keys[i], keys[j]] = [keys[j]!, keys[i]!];
    }
    rows.forEach((x, i) => {
      n++;
      if (matches(keys[i]!, x.work)) hit++;
    });
  }
  return pts(hit / n);
}

interface P1Row { id: string; imageId: string; key: string; work: string }

/** p1 on F-0d's confirmed sample: does the read imprint name a house of the accepted work's editions? */
function p1Analysis(f0dTable: ImprintTable, links: ParentLinks) {
  const set = "pilot-000";
  const sel = readJsonl<{ id: string; role: string }>(join(dataRoot(), "private", "f0d", set, "selection.jsonl"));
  const reads = new Map(readIds(set).map((r) => [r.id, r]));
  const base = new Map(readJsonl<{ base: SpineDecision }>(join(dataRoot(), "private", "f0d", set, "state.jsonl")).map((r) => [r.base.id, r.base]));
  const boxSet = loadBoxSet("pilot-000");
  const all: P1Row[] = [];
  for (const { id, role } of sel) {
    const r = reads.get(id), b = base.get(id);
    if (role !== "confirmed" || !r || !b?.accepted) continue;
    const key = boxImprint(r).key;
    if (key) all.push({ id, imageId: b.imageId, key, work: b.accepted.workId });
  }
  const dbs = { v1: openCatalog(catalogFile("v1")), v2: openCatalog(catalogFile("v2")) };
  const keysFor = (cat: CatalogName, data: DataName) => {
    const o = DATA[data];
    const f = workImprintKeys(dbs[cat], f0dTable, o.wikidata ? links : undefined, { publishers: o.publishers, series: o.series });
    return (w: string) => f(w).any;
  };
  const measure = (rows: P1Row[], keysOf: (w: string) => string[]) => {
    const m = (key: string, work: string) => imprintMatches(key, keysOf(work));
    const c = clusterBootstrap(rows, (rs) => (rs.length ? rs.filter((r) => m(r.key, r.work)).length / rs.length : null), F0D.reps, F0D.precisionSeed);
    return { n: rows.length, k: rows.filter((r) => m(r.key, r.work)).length, p1: ciPts(c), chance: chance(rows, m) };
  };

  // Gate: F-0d's own figure (v1 publishers and its table; 15 of 38, chance 7.8 %) on its own sample.
  const f0dKeys = keysFor("v1", "today");
  const gateRows = all.filter((r) => f0dKeys(r.work).length > 0);
  const gate = measure(gateRows, f0dKeys);

  const cells: Record<string, unknown> = {};
  const primary: Record<string, unknown> = {};
  for (const cat of ["v1", "v2"] as const) {
    const before = keysFor(cat, "today");
    // The sample is fixed by the data before the fix: same boxes, same works, on both sides (paired).
    const rows = all.filter((r) => boxSet.keeps(r.id) && before(r.work).length > 0);
    const byData = Object.fromEntries((Object.keys(DATA) as DataName[]).map((d) => [d, measure(rows, keysFor(cat, d))]));
    const after = keysFor(cat, "c9");
    const delta = clusterBootstrap(rows, (rs) => (rs.length ? (rs.filter((r) => imprintMatches(r.key, after(r.work))).length - rs.filter((r) => imprintMatches(r.key, before(r.work))).length) / rs.length : null), REPS, SEED);
    const t = byData.today!, c = byData.c9!;
    const cell = {
      sample: rows.length,
      photos: new Set(rows.map((r) => r.imageId)).size,
      outsideBoxSet: all.filter((r) => !boxSet.keeps(r.id)).length,
      byData,
      deltaP1: ciPts(delta),
      deltaChance: t.chance !== null && c.chance !== null ? Math.round((c.chance - t.chance) * 10) / 10 : null,
      knownAfterOnly: all.filter((r) => boxSet.keeps(r.id) && before(r.work).length === 0 && after(r.work).length > 0).length,
    };
    cells[cat] = cell;
    if (cat === "v2") Object.assign(primary, cell);
  }
  dbs.v1.close();
  dbs.v2.close();
  const p = primary as { deltaP1: { value: number } | null; deltaChance: number | null };
  const rise = p.deltaP1?.value ?? 0;
  const keep = rise >= 10 && p.deltaChance !== null && p.deltaChance <= 2;
  return { gate: { ...gate, f0d: { k: 15, n: 38, p1: 39.5, chance: 7.8 }, reproduced: gate.k === 15 && gate.n === 38 && gate.chance === 7.8 }, cells, verdict: { keep, p1RiseVsTen: rise, chanceRiseVsTwo: p.deltaChance } };
}

/** The yardstick's library shelf marks per image (the annotation's `tag`), as imprint keys: evaluation only. */
function annotatedShelfMarks(): Map<string, string[]> {
  const lib = join(dataRoot(), "proxy", "library-dataset");
  const out = new Map<string, string[]>();
  for (const a of parseCsv(readFileSync(join(lib, "data", "annotations", "library_books_annotations.csv"), "utf8"))) {
    const id = a.image_name!.replace(/\.jpg$/i, ""), k = imprintKey(a.tag);
    if (k) out.set(id, [...(out.get(id) ?? []), k]);
  }
  return out;
}

interface ImpRow {
  id: string;
  imageId: string;
  eligible: boolean;
  wrong: boolean;
  withheld: boolean;
  close: boolean;
  rival: string | null;
}

function imp1Cell(set: SetName, cat: CatalogName, data: DataName, filter: boolean, ctx: { boxes: BoxLists[]; reads: Map<string, ImprintReading>; wrong: Map<string, { wrong: boolean | null }>; db: DatabaseSync; table: ImprintTable; links: ParentLinks; keep: (id: string) => boolean }) {
  const o = DATA[data];
  const keys = workImprintKeys(ctx.db, ctx.table, o.wikidata ? ctx.links : undefined, { publishers: o.publishers, series: o.series });
  const rows: ImpRow[] = [];
  for (const b of ctx.boxes) {
    if (!b.accepted || !ctx.keep(b.id)) continue;
    const bi = boxImprint(ctx.reads.get(b.id));
    const usable = usableImprint(bi.key, filter ? bi.name : null, filter ? b.surnames : []);
    const imprint = usable ? bi.key : null;
    const own = Object.values(b.lists).flatMap((l) => l ?? []).find((c) => c.workId === b.accepted)!;
    const c = imprintContrast({
      accepted: own as unknown as Candidate, agreeing: b.agreeing, lists: b.lists as Partial<Record<ReaderName, Candidate[]>>, imprint,
      carriesStrict: (w) => imprintMatches(imprint, keys(w).strict), carriesAny: (w) => imprintMatches(imprint, keys(w).any),
      same: (_a, x) => (x as unknown as Slim).same,
    });
    rows.push({ id: b.id, imageId: b.imageId, eligible: usable, wrong: ctx.wrong.get(b.id)?.wrong === true, withheld: usable && c.withhold, close: c.close, rival: c.rival?.workId ?? null });
  }
  const el = rows.filter((r) => r.eligible);
  const share = (rs: ImpRow[], f: (r: ImpRow) => boolean) => (rs.length ? rs.filter(f).length / rs.length : null);
  const out = {
    accepts: rows.length,
    eligible: el.length,
    eligiblePhotos: new Set(el.map((r) => r.imageId)).size,
    withCloseRunnerUp: el.filter((r) => r.close).length,
    withheld: el.filter((r) => r.withheld).length,
    withheldShare: ciPts(clusterBootstrap(el, (rs) => share(rs, (r) => r.withheld), REPS, SEED)),
  };
  if (set === "pilot-000") return { ...out, rows: el };
  const yb = yardstickBooks();
  return {
    ...out,
    wrongBefore: el.filter((r) => r.wrong).length,
    wrongAfter: el.filter((r) => r.wrong && !r.withheld).length,
    withheldWrong: el.filter((r) => r.withheld && r.wrong).length,
    withheldCorrect: el.filter((r) => r.withheld && !r.wrong).length,
    withheldRivalAnnotated: el.filter((r) => r.withheld && r.rival && isAnnotated(ctx.db, r.rival, yb.get(r.imageId) ?? [])).length,
    wrongShareBefore: ciPts(clusterBootstrap(el, (rs) => share(rs, (r) => r.wrong), REPS, SEED)),
    wrongShareAfter: ciPts(clusterBootstrap(el, (rs) => share(rs, (r) => r.wrong && !r.withheld), REPS, SEED)),
    deltaWrongShare: ciPts(clusterBootstrap(el, (rs) => (rs.length ? -rs.filter((r) => r.wrong && r.withheld).length / rs.length : null), REPS, SEED)),
    rows: el,
  };
}

function shelfMarkEval(set: SetName, boxes: BoxLists[], reads: Map<string, ImprintReading>) {
  const marks = set === "pilot-000" ? null : annotatedShelfMarks();
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const rows = [...reads.values()].map((r) => ({ r, bi: boxImprint(r), b: byId.get(r.id) })).filter((x) => x.bi.key && x.b);
  const why = (x: (typeof rows)[number]) => shelfMark(x.bi.name, x.b!.surnames);
  const isSticker = (x: (typeof rows)[number]) => Boolean(marks && (marks.get(x.b!.imageId) ?? []).some((m) => m === x.bi.key || m.startsWith(x.bi.key!) || x.bi.key!.startsWith(m)));
  const dropped = rows.filter((x) => why(x) !== null);
  return {
    reads: rows.length,
    dropped: dropped.length,
    byRule: { digit: dropped.filter((x) => why(x) === "digit").length, cutter: dropped.filter((x) => why(x) === "cutter").length },
    ...(marks
      ? {
          stickers: rows.filter(isSticker).length,
          stickersDropped: dropped.filter(isSticker).length,
          nonStickers: rows.filter((x) => !isSticker(x)).length,
          nonStickersDropped: dropped.filter((x) => !isSticker(x)).length,
        }
      : {}),
  };
}

function analyse(): void {
  const f0dTable = loadF0dTable();
  const wd = loadWikidata();
  const links = parentLinks(wd);
  log(`Wikidata: ${wd.rows.length} statements -> ${[...links.values()].reduce((s, l) => s + l.length, 0)} links on ${links.size} houses`);
  const p1 = p1Analysis(f0dTable, links);
  log(`p1 gate reproduced: ${p1.gate.reproduced} (${p1.gate.k}/${p1.gate.n}, chance ${p1.gate.chance} %); data fix keep ${p1.verdict.keep}`);

  const imp: Record<string, Record<string, Record<string, unknown>>> = {};
  const marks: Record<string, unknown> = {};
  const rowsOf: Record<string, ImpRow[]> = {};
  const reach: Record<string, Record<string, unknown>> = {};
  for (const set of SETS) {
    const reads = new Map(readIds(set).map((r) => [r.id, r]));
    const bs = loadBoxSet(set === "pilot-000" ? "pilot-000" : "yardstick");
    for (const cat of ["v1", "v2"] as const) {
      const boxes = loadLists(set, cat);
      const db = openCatalog(catalogFile(cat));
      const ctx = { boxes, reads, wrong: c6None(set, cat), db, table: f0dTable, links, keep: bs.keeps };
      // Descriptive (added after the pre-registration, decides nothing): how much of the catalog's accepts F-0d read.
      const acc = [...ctx.wrong.entries()].filter(([id, d]) => d.accepted && bs.keeps(id));
      const withRead = acc.filter(([id]) => reads.has(id));
      const keyed = withRead.filter(([id]) => boxImprint(reads.get(id)).key);
      ((reach[set] ??= {})[cat] = {
        accepts: acc.length, acceptsRead: withRead.length, acceptsWithImprint: keyed.length,
        ...(set === "pilot-000" ? {} : { wrongAccepts: acc.filter(([, d]) => d.wrong).length, wrongRead: withRead.filter(([, d]) => d.wrong).length, wrongWithImprint: keyed.filter(([, d]) => d.wrong).length }),
      });
      if (cat === "v2") marks[set] = shelfMarkEval(set, boxes, reads);
      for (const data of ["today", "c9"] as const) {
        for (const filter of [true, false]) {
          const name = `${cat}.${data}.${filter ? "filtered" : "unfiltered"}`;
          const { rows, ...cell } = imp1Cell(set, cat, data, filter, ctx);
          ((imp[set] ??= {})[name] = cell);
          rowsOf[`${set}.${name}`] = rows;
        }
      }
      db.close();
    }
  }
  // Per-box IMP-1 rows stay private.
  writeFileSync(join(privateDir("parts"), "imp1-rows.json"), JSON.stringify(rowsOf));

  // Keep rule on the primary cell: v2, the data the data-fix verdict keeps, shelf-mark filter on.
  const primaryName = `v2.${p1.verdict.keep ? "c9" : "today"}.filtered`;
  const y = imp["yardstick-library-b2"]![primaryName] as { withheld: number; wrongBefore: number; deltaWrongShare: { hi: number } | null };
  const p = imp["pilot-000"]![primaryName] as { eligible: number; withheld: number };
  const yardFalls = Boolean(y.deltaWrongShare && y.deltaWrongShare.hi < 0);
  const pilotShare = p.eligible ? p.withheld / p.eligible : 0;
  const uninformative = y.withheld === 0 || y.wrongBefore === 0;
  const imp1 = { primaryCell: primaryName, yardstickWrongFalls: yardFalls, pilotWithheldShare: pts(pilotShare), pilotWithinFive: pilotShare <= 0.05, uninformative, keep: yardFalls && pilotShare <= 0.05 };

  const m = {
    runId: "C9",
    card: "C-9",
    date: new Date().toLocaleDateString("en-CA"),
    scope: { "pilot-000": "real use (OC35): machine agreement only, never accuracy (INV-17)", "yardstick-library-b2": "PROXY (OC35): wrong accepts against the annotated books of each image (C-5's judge)" },
    preregistered: "evals/C9/prereg.md",
    bootstrap: { unit: "photo (cluster), paired where before and after are the same boxes", reps: REPS, seed: SEED, interval: "95 % percentile", p1: F0D },
    imp1: { margin: IMP1.margin, depth: LOOKALIKE.depth, enabledByDefault: IMP1.enabled },
    catalogs: Object.fromEntries((["v1", "v2"] as const).map((c) => [c, C9_CATALOGS[c]])),
    wikidata: { fetched: wd.fetched.slice(0, 10), statements: wd.rows.length, isfdbPublishers: new Set(wd.rows.map((r) => r.isfdb)).size, datedStatements: wd.rows.filter((r) => r.start || r.end).length, links: [...links.values()].reduce((s, l) => s + l.length, 0), houses: links.size, datedLinks: [...links.values()].flat().filter((l) => l.start !== null || l.end !== null).length, sha256: wd.sha256 },
    dataFix: p1,
    shelfMarkFilter: marks,
    imp1Cells: imp,
    reach,
    verdict: { dataFix: p1.verdict.keep ? "keep" : "off", imp1: imp1.keep ? "keep" : imp1.uninformative ? "uninformative (off)" : "off", detail: imp1 },
  };
  const dir = join(REPO, "evals", "C9");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "metrics.json"), `${compactJson(m)}\n`);
  log(`verdict: data fix ${m.verdict.dataFix}, IMP-1 ${m.verdict.imp1} -> evals/C9/metrics.json`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({ args: rest, options: { set: { type: "string" }, catalog: { type: "string" } } });
  if (cmd === "wikidata") await wikidataStage();
  else if (cmd === "lists" && SETS.includes(values.set as SetName) && (values.catalog === "v1" || values.catalog === "v2")) listsStage(values.set as SetName, values.catalog);
  else if (cmd === "analyse") analyse();
  else {
    console.error("usage: c9-eval.ts wikidata | lists --set <pilot-000|yardstick-library-b2> --catalog <v1|v2> | analyse");
    process.exit(2);
  }
}
