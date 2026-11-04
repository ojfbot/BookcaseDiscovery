// C-5 evaluation: the Open Library breadth catalog (catalog-v2) against the ISFDB-only catalog (v1), offline.
//
//   node src/catalog/c5-eval.ts golden    [--v1 <file>] [--v2 <file>]   C-3's golden fragments on both catalogs
//   node src/catalog/c5-eval.ts coverage  [--v1 <file>] [--v2 <file>]   C-4's sample re-checked against both (no calls)
//   node src/catalog/c5-eval.ts lookalike --set <pilot-000|yardstick-library-b2> [--v1 <file>] [--v2 <file>]
//                                                                         F-0's cached readings re-decided, F-0's bar unchanged
//   node src/catalog/c5-eval.ts publish                                   join the parts into evals/C5/metrics.json
//
// Every part writes aggregates only to $BOOKCASE_DATA/catalog/c5/<part>.json; the per-box and per-spine detail
// never leaves this process. Nothing here makes a network call.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { dataRoot } from "../ledger/images.ts";
import { ACCEPT, confirms, CROP, decide, loadReadings, readJsonl, stageDir, variantsOf, type ReaderName, type Reading, type SpineDecision } from "../eval/f0.ts";
import { clusterBootstrap } from "../eval/q1.ts";
import { catalogPaths, openCatalog } from "./cli.ts";
import { BOOTSTRAP_REPS, drawSample, estimateCoverage, isfdbHolds, LIMITS, SEED, surnameOf, type BoxResult, type OutsideRecord } from "./coverage.ts";
import { loadGolden, runGolden } from "./golden.ts";
import { toIsbn13 } from "./isbn.ts";
import { normalize, splitSubtitle, tokenize } from "./normalize.ts";
import { retrieve, type Candidate } from "./retrieve.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const log = (s: string) => console.error(`[c5] ${new Date().toISOString().slice(11, 19)} ${s}`);
const r4 = (x: number) => Math.round(x * 10000) / 10000;

function partsDir(): string {
  const d = join(dataRoot(), "catalog", "c5");
  mkdirSync(d, { recursive: true });
  return d;
}
const writePart = (name: string, data: unknown) => writeFileSync(join(partsDir(), `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);

function catalogMeta(db: DatabaseSync, path: string) {
  const m = Object.fromEntries((db.prepare("SELECT key, value FROM meta").all() as Array<{ key: string; value: string }>).map((r) => [r.key, r.value]));
  return { file: path.split("/").at(-1), bytes: statSync(path).size, schemaVersion: Number(m.schema_version), sources: m.sources ?? "isfdb", works: Number(m["rows.works"]), editions: Number(m["rows.editions"]), openLibraryDumpDate: m.openlibrary_dump_date ?? null };
}

// ---------------------------------------------------------------------------------------------
// golden
// ---------------------------------------------------------------------------------------------

function golden(paths: Record<"v1" | "v2", string>): void {
  const file = "evals/golden/fragments.jsonl";
  const queries = loadGolden(join(REPO, file));
  const out: Record<string, unknown> = {};
  for (const [name, path] of Object.entries(paths)) {
    log(`golden on ${name}`);
    const db = openCatalog(path);
    const run = runGolden(db, queries, file, 10);
    const missesTop5 = run.results.filter((r) => r.class !== "none" && r.inCatalog && (r.rank === null || r.rank > 5)).map((r) => ({ id: r.id, rank: r.rank }));
    out[name] = { catalog: catalogMeta(db, path), rates: run.rates, latencyMs: run.latencyMs, none: run.none, hitTopScore: run.hitTopScore, gaps: run.gaps, missesTop5, ranks: Object.fromEntries(run.results.map((r) => [r.id, r.rank])) };
    db.close();
  }
  const v1 = out.v1 as { ranks: Record<string, number | null> };
  const v2 = out.v2 as { ranks: Record<string, number | null> };
  const changed = Object.keys(v1.ranks).filter((id) => v1.ranks[id] !== v2.ranks[id]).map((id) => ({ id, v1: v1.ranks[id], v2: v2.ranks[id] }));
  writePart("golden", { ...out, rankChanges: changed, host: { cpu: cpus()[0]?.model ?? "unknown", node: process.version } });
  log(`golden: ${changed.length} queries changed rank`);
}

// ---------------------------------------------------------------------------------------------
// coverage (C-4's sample, offline)
// ---------------------------------------------------------------------------------------------

/**
 * Does the catalog hold the record, counting only works and editions outside the shelf-held-only layer? The same
 * two steps as C-4's `isfdbHolds` (ISBN, then clean title plus surname through `retrieve`), with every Open Library
 * row that came in only because C-4 resolved it on this very sample left out. That is the first-sighting figure.
 */
function holdsWithoutShelfLayer(db: DatabaseSync, rec: OutsideRecord): boolean {
  const shelfOnly = (workId: string): boolean => {
    if (!workId.startsWith("ol:")) return false;
    const s = (db.prepare("SELECT sources FROM works WHERE id = ?").get(workId) as { sources: string } | undefined)?.sources;
    return !!s && (JSON.parse(s) as Array<{ layer?: string }>).every((x) => x.layer === "shelf");
  };
  // ISBN: an ISFDB edition, an edition of a new Open Library breadth work, or an Open Library edition added to an
  // ISFDB work by a breadth (not shelf-only) Open Library work. The last needs the staging file, so it is
  // approximated by its source: an Open Library edition on an ISFDB work counts only when that work carries a
  // breadth-layer Open Library source.
  const isbns = [...new Set(rec.isbns.map(toIsbn13).filter((x): x is string => x !== null))];
  const ed = db.prepare("SELECT e.work_id AS work_id, e.source AS source, w.sources AS sources FROM editions e JOIN works w ON w.id = e.work_id WHERE e.isbn13 = ?");
  for (const i of isbns) {
    for (const r of ed.all(i) as Array<{ work_id: string; source: string; sources: string }>) {
      if (r.source === "isfdb") return true;
      if (r.work_id.startsWith("ol:")) {
        if (!shelfOnly(r.work_id)) return true;
      } else if ((JSON.parse(r.sources) as Array<{ source: string; layer?: string }>).some((s) => s.source === "openlibrary" && s.layer !== "shelf")) return true;
    }
  }
  // Title plus author, as isfdbHolds does it, skipping shelf-only works.
  const main = normalize(splitSubtitle(rec.title).main);
  const surnames = new Set(rec.authors.slice(0, LIMITS.recordAuthors).map(surnameOf).filter((s): s is string => s !== null));
  if (main === "" || surnames.size === 0) return false;
  const noArticle = (t: string) => t.replace(/^(the|a|an) /, "");
  const same = (x: string, y: string) => {
    const [a, b] = [noArticle(x), noArticle(y)];
    return a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `);
  };
  const form = db.prepare("SELECT title_norm, author_norm FROM works WHERE id = ?");
  for (const c of retrieve(db, [`${rec.title} ${rec.authors.slice(0, LIMITS.recordAuthors).join(" ")}`], 10)) {
    if (shelfOnly(c.workId)) continue;
    const w = form.get(c.workId) as { title_norm: string; author_norm: string } | undefined;
    if (!w) continue;
    const titles = w.title_norm.split("|").map((f) => f.slice(2));
    const authors = w.author_norm.split("|").map((x) => tokenize(x).at(-1) ?? "");
    if (titles.some((t) => same(t, main)) && authors.some((x) => surnames.has(x))) return true;
  }
  return false;
}

function coverage(paths: Record<"v1" | "v2", string>, session = "pilot-000"): void {
  const root = dataRoot();
  const decisions = readJsonl<SpineDecision>(join(stageDir(root, session), "decisions.jsonl"));
  const { population } = drawSample(decisions);
  const results = readJsonl<BoxResult>(join(root, "private", "c4", `${session}.sample.jsonl`));
  if (results.length === 0) throw new Error(`no C-4 sample table for ${session}`);
  const v1 = openCatalog(paths.v1);
  const v2 = openCatalog(paths.v2);
  const reclass = (holds: (r: OutsideRecord) => boolean) => results.map((r) => ({ ...r, cls: !r.record ? ("unresolved" as const) : holds(r.record) ? ("in-isfdb" as const) : ("not-in-isfdb" as const) }));
  log("coverage: v1");
  const rowsV1 = reclass((rec) => isfdbHolds(v1, rec) !== null);
  log("coverage: v2");
  const rowsV2 = reclass((rec) => isfdbHolds(v2, rec) !== null);
  log("coverage: v2 without the shelf-held layer");
  const rowsV2b = reclass((rec) => holdsWithoutShelfLayer(v2, rec));
  const pick = (e: ReturnType<typeof estimateCoverage>) => ({
    unresolvedExcluded: e.shares["isfdb.unresolvedExcluded"],
    unresolvedAsNotInCatalog: e.shares["isfdb.unresolvedAsNotInIsfdb"],
    matchMissOfReadable: e.shares["matchMiss.ofReadable"],
    weighted: e.weighted,
    sample: Object.fromEntries(Object.entries(e.sample).map(([s, v]) => [s, v.counts])),
  });
  const est = { v1: pick(estimateCoverage(rowsV1, population)), v2: pick(estimateCoverage(rowsV2, population)), v2WithoutShelfLayer: pick(estimateCoverage(rowsV2b, population)) };
  const changed = rowsV1.filter((r, i) => r.cls !== rowsV2[i]!.cls).length;
  writePart("coverage", {
    session, method: "C-4 sample rows (private/c4), each resolved record re-checked against the catalog with C-4's isfdbHolds; C-4's stratified bootstrap", bootstrapReps: BOOTSTRAP_REPS, seed: SEED,
    sampled: results.length, resolved: results.filter((r) => r.record).length, classChangedV1toV2: changed,
    reproducesC4: est.v1.unresolvedExcluded, ...est,
  });
  v1.close();
  v2.close();
}

// ---------------------------------------------------------------------------------------------
// lookalike: F-0's cached readings re-decided on v1 and v2
// ---------------------------------------------------------------------------------------------

interface CsvRow { [k: string]: string }
function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(field), (field = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field), rows.push(row), (row = []), (field = "");
    } else field += ch;
  }
  if (field !== "" || row.length) row.push(field), rows.push(row);
  const [head, ...body] = rows.filter((r) => r.length > 1);
  return body.map((r) => Object.fromEntries(head!.map((h, i) => [h, r[i] ?? ""])));
}

export interface TruthBook { isbn13: string | null; title: string; surnames: Set<string> }

/**
 * Leading articles dropped before comparing titles. The yardstick is a Barcelona library, so Spanish and Catalan
 * articles are in the list (added after the first run showed "El Baile de la Victoria" judged wrong; post hoc).
 */
const ARTICLE = /^(the|a|an|el|la|los|las|lo|un|una|l|els|les|uns|unes) /;
/** "Rojas, Fernando de, 1470?-1541" -> "Rojas, Fernando de": a trailing part with digits (dates) or in brackets. */
const stripDates = (a: string) => a.replace(/(,\s*[^,]*\d[^,]*|\s*\(.*\))\s*$/, "").trim();

/** The yardstick's annotated books per image (PROXY): ISBN, main title, author surnames. */
export function yardstickBooks(): Map<string, TruthBook[]> {
  const lib = join(dataRoot(), "proxy", "library-dataset");
  const out = new Map<string, TruthBook[]>();
  for (const a of parseCsv(readFileSync(join(lib, "data", "annotations", "library_books_annotations.csv"), "utf8"))) {
    if (a.not_book === "True") continue;
    const id = a.image_name!.replace(/\.jpg$/i, "");
    const list = out.get(id) ?? [];
    const surnames = new Set((a.author ?? "").split(";").map((s) => surnameOf(stripDates(s.trim()))).filter((s): s is string => s !== null));
    list.push({ isbn13: toIsbn13((a.isbn ?? "").replace(/\D/g, "")), title: normalize(splitSubtitle((a.title ?? "").trim()).main).replace(ARTICLE, ""), surnames });
    out.set(id, list);
  }
  return out;
}

/** Is the accepted work one of the image's annotated books? ISBN on any edition, else title form plus surname. */
export function isAnnotated(db: DatabaseSync, workId: string, books: TruthBook[]): boolean {
  const isbns = new Set((db.prepare("SELECT isbn13 FROM editions WHERE work_id = ? AND isbn13 IS NOT NULL").all(workId) as Array<{ isbn13: string }>).map((r) => r.isbn13));
  if (books.some((b) => b.isbn13 && isbns.has(b.isbn13))) return true;
  const w = db.prepare("SELECT title_norm, author_norm FROM works WHERE id = ?").get(workId) as { title_norm: string; author_norm: string } | undefined;
  if (!w) return false;
  const titles = w.title_norm.split("|").map((f) => f.slice(2).replace(ARTICLE, ""));
  const surnames = new Set(w.author_norm.split("|").map((a) => tokenize(a).at(-1) ?? ""));
  return books.some((b) => b.title !== "" && titles.some((t) => t === b.title || t.startsWith(`${b.title} `) || b.title.startsWith(`${t} `)) && [...b.surnames].some((s) => surnames.has(s)));
}

interface Redecided { id: string; imageId: string; accepted: string | null; reason: string | null; wrong: boolean | null; margins: Array<{ margin: number; confirmed: boolean }> }

function redecide(db: DatabaseSync, decisions: SpineDecision[], readings: Map<string, Partial<Record<ReaderName, Reading>>>, truth: Map<string, TruthBook[]> | null): Redecided[] {
  const cache = new Map<string, Candidate | undefined>();
  const marginOf = new Map<string, number>();
  const out: Redecided[] = [];
  let done = 0;
  for (const d of decisions) {
    const reads = readings.get(d.id) ?? {};
    const margins: Redecided["margins"] = [];
    for (const r of Object.values(reads)) {
      const v = variantsOf(r);
      if (v.length === 0) continue;
      const key = v.join("\u0000");
      if (!cache.has(key)) {
        const top = retrieve(db, v, 3);
        cache.set(key, top[0]);
        if (top[0]) marginOf.set(key, top[0].score - (top[1]?.score ?? 0));
      }
      const top = cache.get(key);
      if (top) margins.push({ margin: marginOf.get(key)!, confirmed: confirms(top) });
    }
    const nd = decide(db, d.id, d.imageId, d.boxScore, reads, cache);
    const accepted = nd.accepted?.workId ?? null;
    out.push({ id: d.id, imageId: d.imageId, accepted, reason: nd.reason, wrong: accepted && truth ? !isAnnotated(db, accepted, truth.get(d.imageId) ?? []) : null, margins });
    if (++done % 1000 === 0) log(`  ${done}/${decisions.length}`);
  }
  return out;
}

/**
 * Re-decisions are slow (a full retrieve per reading), so each (set, catalog file) result is cached privately under
 * the data root, keyed by the file's size and mtime. The cache holds spine ids and work ids: never copied to the repo.
 */
function cachedRedecide(set: string, catalogPath: string, run: () => Redecided[]): Redecided[] {
  const st = statSync(catalogPath);
  const dir = join(partsDir(), "private");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${set}.${catalogPath.split("/").at(-1)}.${st.size}.${Math.round(st.mtimeMs)}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as Redecided[];
  const out = run();
  writeFileSync(file, JSON.stringify(out));
  return out;
}

function quantiles(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => (s.length ? r4(s[Math.min(s.length - 1, Math.floor(p * s.length))]!) : null);
  return { n: s.length, p10: q(0.1), p25: q(0.25), p50: q(0.5), p75: q(0.75), under002: s.length ? r4(s.filter((x) => x < 0.02).length / s.length) : null, under005: s.length ? r4(s.filter((x) => x < 0.05).length / s.length) : null };
}

function lookalike(paths: Record<"v1" | "v2", string>, set: string, only?: string): void {
  const root = dataRoot();
  const dir = stageDir(root, set);
  const decisions = readJsonl<SpineDecision>(join(dir, "decisions.jsonl"));
  if (decisions.length === 0) throw new Error(`no F-0 decisions for ${set}`);
  const proxy = set.startsWith("yardstick");
  const truth = proxy ? yardstickBooks() : null;
  // F-0 decided with the crop its run used; take the reading set that reproduces the cached decisions on the catalog they were made against.
  const cachedCatalog = proxy ? join(root, "proxy", "library-dataset", "f0-inventory-catalog.sqlite") : paths.v1;
  const sanityDb = openCatalog(cachedCatalog);
  let readings = loadReadings(dir, CROP);
  let readingSet = "crop-clip";
  const agree = (rs: Redecided[]) => rs.filter((r, i) => r.accepted === (decisions[i]!.accepted?.workId ?? null) && r.reason === decisions[i]!.reason).length / rs.length;
  log(`${set}: reproducing the cached decisions on ${proxy ? "the inventory catalog" : "v1"}`);
  let base = cachedRedecide(`${set}.crop-clip.base`, cachedCatalog, () => redecide(sanityDb, decisions, readings, null));
  if (agree(base) < 0.99) {
    const all = loadReadings(dir);
    const alt = cachedRedecide(`${set}.all-crops.base`, cachedCatalog, () => redecide(sanityDb, decisions, all, null));
    if (agree(alt) > agree(base)) (readings = all), (base = alt), (readingSet = "all-crops");
  }
  const reproduced = r4(agree(base));
  sanityDb.close();

  const byCatalog: Record<string, Redecided[]> = {};
  for (const [name, path] of Object.entries(paths)) {
    if (!proxy && name === "v1") {
      byCatalog.v1 = base; // the same catalog: re-decided above
      continue;
    }
    if (only && only !== name) continue;
    log(`${set}: re-deciding on ${name}`);
    const db = openCatalog(path);
    byCatalog[name] = cachedRedecide(`${set}.${readingSet}`, path, () => redecide(db, decisions, readings, truth));
    db.close();
  }
  if (only) return;
  if (proxy && truth) {
    // Judge every accept now (the cache may hold an older judgement); F-0's own inventory run is judged too, for reference.
    for (const [rows, path] of [[base, cachedCatalog], [byCatalog.v1!, paths.v1], [byCatalog.v2!, paths.v2]] as const) {
      const db = openCatalog(path);
      for (const r of rows) r.wrong = r.accepted ? !isAnnotated(db, r.accepted, truth.get(r.imageId) ?? []) : null;
      db.close();
    }
  }

  const n = decisions.length;
  const summary = (rs: Redecided[]) => {
    const reasons: Record<string, number> = {};
    for (const r of rs) if (r.reason) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
    const acc = rs.filter((r) => r.accepted);
    return {
      confirmed: acc.length,
      confirmedShare: clusterBootstrap(rs, (x) => (x.length ? x.filter((r) => r.accepted).length / x.length : null), 2000, SEED),
      confirmedOpenLibraryWorks: acc.filter((r) => r.accepted!.startsWith("ol:")).length,
      ...(proxy ? { wrongAccepts: acc.filter((r) => r.wrong).length, wrongAcceptShareOfAccepted: clusterBootstrap(rs, (x) => { const a = x.filter((r) => r.accepted); return a.length ? a.filter((r) => r.wrong).length / a.length : null; }, 2000, SEED), wrongAcceptShareOfSpines: clusterBootstrap(rs, (x) => (x.length ? x.filter((r) => r.wrong).length / x.length : null), 2000, SEED) } : {}),
      unknownByReason: reasons,
      topMargin: { all: quantiles(rs.flatMap((r) => r.margins.map((m) => m.margin))), topConfirms: quantiles(rs.flatMap((r) => r.margins.filter((m) => m.confirmed).map((m) => m.margin))) },
    };
  };
  const paired = byCatalog.v1!.map((r, i) => ({ imageId: r.imageId, a: r, b: byCatalog.v2![i]! }));
  const delta = (f: (r: Redecided) => boolean) => clusterBootstrap(paired, (x) => (x.length ? (x.filter((p) => f(p.b)).length - x.filter((p) => f(p.a)).length) / x.length : null), 2000, SEED);
  const transitions = { gained: 0, lost: 0, switched: 0, switchedToOpenLibrary: 0, same: 0 };
  for (const p of paired) {
    if (!p.a.accepted && p.b.accepted) transitions.gained++;
    else if (p.a.accepted && !p.b.accepted) transitions.lost++;
    else if (p.a.accepted && p.b.accepted && p.a.accepted !== p.b.accepted) {
      transitions.switched++;
      if (p.b.accepted.startsWith("ol:")) transitions.switchedToOpenLibrary++;
    } else if (p.a.accepted) transitions.same++;
  }
  const lostTo: Record<string, number> = {};
  for (const p of paired) if (p.a.accepted && !p.b.accepted) lostTo[p.b.reason ?? "?"] = (lostTo[p.b.reason ?? "?"] ?? 0) + 1;
  writePart(`lookalike-${set}`, {
    set, scope: proxy ? "yardstick (PROXY): wrong accepts against the annotated books of each image" : "real use (OC35): machine agreement only, never accuracy (INV-17)",
    spineCount: n, images: new Set(decisions.map((d) => d.imageId)).size, accept: ACCEPT, readingSet, reproducedCachedDecisions: reproduced,
    ...(proxy ? { f0InventoryCatalog: summary(base) } : {}),
    v1: summary(byCatalog.v1!), v2: summary(byCatalog.v2!),
    delta: { confirmedShare: delta((r) => r.accepted !== null), ...(proxy ? { wrongAcceptShareOfSpines: delta((r) => r.wrong === true) } : {}) },
    transitions, lostToReason: lostTo,
    ...(proxy ? { wrongAmongSwitched: paired.filter((p) => p.a.accepted && p.b.accepted && p.a.accepted !== p.b.accepted && p.b.wrong).length, wrongAmongGained: paired.filter((p) => !p.a.accepted && p.b.wrong).length } : {}),
  });
}

// ---------------------------------------------------------------------------------------------
// publish
// ---------------------------------------------------------------------------------------------

function publish(): void {
  const dir = partsDir();
  const parts = Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(join(dir, f), "utf8"))]));
  // Golden ranks per query id are public (the golden set is), but keep the file small: drop the rank maps.
  if (parts.golden) for (const k of ["v1", "v2"]) delete (parts.golden[k] as Record<string, unknown>).ranks;
  let code: string | null = null;
  try {
    code = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    /* not a checkout */
  }
  const out = join(REPO, "evals", "C5");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "metrics.json"), `${JSON.stringify({ runId: "C5", card: "C-5", date: new Date().toLocaleDateString("en-CA"), code, recordLimits: LIMITS, ...parts }, null, 2)}\n`);
  log(`published ${Object.keys(parts).join(", ")} -> evals/C5/metrics.json`);
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const { values } = parseArgs({ args: rest, options: { v1: { type: "string" }, v2: { type: "string" }, set: { type: "string" }, only: { type: "string" } } });
  const p = catalogPaths({ ...process.env, BOOKCASE_CATALOG: "" });
  const paths = { v1: values.v1 ?? p.catalog, v2: values.v2 ?? p.catalogV2 };
  if (cmd !== "publish") for (const [k, f] of Object.entries(paths)) if ((!values.only || values.only === k) && !existsSync(f)) throw new Error(`catalog missing: ${f}`);
  if (cmd === "golden") golden(paths);
  else if (cmd === "coverage") coverage(paths);
  else if (cmd === "lookalike") lookalike(paths, values.set ?? "pilot-000", values.only);
  else if (cmd === "publish") publish();
  else {
    console.error("usage: node src/catalog/c5-eval.ts <golden|coverage|lookalike|publish> [--v1 <file>] [--v2 <file>] [--set <name>]");
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
