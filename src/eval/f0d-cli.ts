// F-0d runner: the imprint read and the imprint tie-break, measured on F-0's cached boxes and readings.
//
//   node src/eval/f0d-cli.ts table            # imprint table from the ISFDB catalog's edition publishers (data root)
//   node src/eval/f0d-cli.ts select <set>     # which boxes get an imprint read, and why (private)
//   node src/eval/f0d-cli.ts read <set>       # Qwen imprint reads on the selection (helpers/label/imprint.py)
//   node src/eval/f0d-cli.ts analyse          # evals/F0d/{metrics.json,report.md} (aggregates only)
//   node src/eval/f0d-cli.ts render           # private review page
//
// <set> is pilot-000 or yardstick-library-b2. F-0's stage folders (`f0/<set>/`) are read, never written; everything
// per box stays under the data root's `private/f0d/`. The yardstick's inventory catalog records no publisher, so
// its editions take the publisher ISFDB records for the same ISBN registrant (`yardstickPublishers`).
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { openCatalog } from "../catalog/cli.ts";
import { buildImprintTable, imprintKey, imprintMatches, publisherKeys, type ImprintTable } from "../catalog/imprint.ts";
import type { Candidate } from "../catalog/retrieve.ts";
import { dataRoot } from "../ledger/images.ts";
import { cropFor } from "../perceive/crop.ts";
import { confirms, CROP, decide, loadReadings, readJsonl, READERS, variantsOf, type ReaderName, type SpineDecision } from "./f0.ts";
import { geometry, loadSet, SETS, type Geo, type SetName } from "./f0b-cli.ts";
import { candidatesFor, carries, reorderable, tieBreak, workImprints } from "./f0d.ts";
import { compactJson, outcomeOf, parseCsv, yardstickTruth } from "./q1-cli.ts";
import { clusterBootstrap, type Outcome } from "./q1.ts";
import { F0_CROP } from "../perceive/crop.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const ROOT = dataRoot();
const PRIV = join(ROOT, "private", "f0d");
const REPS = 2000;
const SEED = 20261103;
const log = (s: string): void => console.error(`[f0d] ${s}`);

/**
 * Pre-registered selection (evals/F0d/report.md, Method): every box the tie-break could change, F-0's two
 * ambiguous outcomes, a seeded confirmed sample for precision, a no-text control for invented imprints, and C-4's
 * not-in-ISFDB books. `cap` bounds the Qwen calls per set (boxes x rotations).
 */
export const SELECT = {
  "pilot-000": { singleReader: 400, readersDisagree: 80, confirmed: 200, noText: 60, cap: 3000 },
  "yardstick-library-b2": { singleReader: 160, readersDisagree: 20, confirmed: 200, noText: 40, cap: 1400 },
} as const satisfies Record<SetName, Record<string, number>>;

type Role = "reorderable" | "single-reader" | "readers-disagree" | "confirmed" | "no-text" | "c4-not-in-isfdb";

// --- helpers ---------------------------------------------------------------------------------------------

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

/** Seeded draw of `n` ids, independent of file order. */
function draw(ids: string[], n: number, seed: number): string[] {
  const r = rng(seed);
  const s = [...ids].sort();
  for (let i = s.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  return s.slice(0, n);
}

// --- imprint table ---------------------------------------------------------------------------------------

const TABLE_PATH = join(ROOT, "catalog", "imprint-table.json");

function buildTable(): ImprintTable {
  const db = openCatalog(join(ROOT, "catalog", "catalog.sqlite"));
  const rows = db.prepare("SELECT publisher, count(*) AS n FROM editions WHERE publisher IS NOT NULL AND publisher != '' GROUP BY publisher").all() as { publisher: string; n: number }[];
  db.close();
  return buildImprintTable(rows.map((r) => [r.publisher, r.n] as const));
}

function saveTable(t: ImprintTable): void {
  const json = {
    strings: t.strings,
    keys: t.keys,
    parents: Object.fromEntries([...t.parents].sort().map(([k, v]) => [k, [...v].sort()])),
    editions: Object.fromEntries([...t.editions].sort((a, b) => b[1] - a[1])),
  };
  writeFileSync(TABLE_PATH, JSON.stringify(json));
  log(`imprint table: ${t.strings} publisher strings -> ${t.keys} keys, ${t.parents.size} with a parent house -> ${TABLE_PATH}`);
}

function loadTable(): ImprintTable {
  if (!existsSync(TABLE_PATH)) saveTable(buildTable());
  const j = JSON.parse(readFileSync(TABLE_PATH, "utf8")) as { strings: number; keys: number; parents: Record<string, string[]>; editions: Record<string, number> };
  return { strings: j.strings, keys: j.keys, parents: new Map(Object.entries(j.parents).map(([k, v]) => [k, new Set(v)])), editions: new Map(Object.entries(j.editions)) };
}

// --- yardstick publishers ---------------------------------------------------------------------------------

/**
 * The yardstick inventory has ISBNs but no publisher. An ISBN's registrant is its publisher, so each inventory book
 * takes the publisher ISFDB records on its longest ISBN-13 prefix (7 to 10 digits) shared by at least 3 ISFDB
 * editions, 90 % of them under one first segment. A book whose prefix ISFDB does not hold has no publisher.
 */
export const REGISTRANT = { minLen: 7, maxLen: 10, minEditions: 3, minShare: 0.9 } as const;

function yardstickPublishers(): Map<string, string> {
  const db = openCatalog(join(ROOT, "catalog", "catalog.sqlite"));
  const lib = join(ROOT, "proxy", "library-dataset");
  const inv = parseCsv(readFileSync(join(lib, "data", "target_lists", "library_books.csv"), "utf8"));
  const groups = new Set(inv.map((b) => (b.isbn ?? "").replace(/\D/g, "").slice(0, 5)).filter((g) => g.length === 5));
  const byPrefix = new Map<string, Map<string, number>>();
  for (const g of groups) {
    for (const r of db.prepare("SELECT isbn13, publisher FROM editions WHERE isbn13 LIKE ? AND publisher IS NOT NULL AND publisher != ''").all(`${g}%`) as { isbn13: string; publisher: string }[]) {
      const first = r.publisher.split(" / ")[0]!;
      for (let L = REGISTRANT.minLen; L <= REGISTRANT.maxLen; L++) {
        const m = byPrefix.get(r.isbn13.slice(0, L)) ?? new Map<string, number>();
        m.set(first, (m.get(first) ?? 0) + 1);
        byPrefix.set(r.isbn13.slice(0, L), m);
      }
    }
  }
  db.close();
  const out = new Map<string, string>();
  inv.forEach((b, i) => {
    const isbn = (b.isbn ?? "").replace(/\D/g, "");
    if (isbn.length !== 13) return;
    for (let L = REGISTRANT.maxLen; L >= REGISTRANT.minLen; L--) {
      const m = byPrefix.get(isbn.slice(0, L));
      if (!m) continue;
      const total = [...m.values()].reduce((a, b) => a + b, 0);
      const [top, n] = [...m].sort((a, b) => b[1] - a[1])[0]!;
      if (total >= REGISTRANT.minEditions && n >= REGISTRANT.minShare * total) {
        out.set(`isfdb:${i + 1}`, top);
        break;
      }
    }
  });
  return out;
}

// --- per-set state ---------------------------------------------------------------------------------------

interface SetState {
  set: SetName;
  geo: Geo[];
  byGeo: Map<string, Geo>;
  base: Map<string, SpineDecision>;
  lists: Map<string, Partial<Record<ReaderName, Candidate[]>>>;
  keysOf: (workId: string) => string[];
  images: ReturnType<typeof loadSet>["images"];
  dets: ReturnType<typeof loadSet>["dets"];
  truth?: Map<string, Set<string>>;
  /** Boxes whose recomputed F-0 decision differs from the cached one (should be 0). */
  drift: number;
}

/** A candidate cut to what the bar and the tie-break read, for the private state cache. */
const slim = (c: Candidate): Candidate => ({ ...c, subtitle: null, series: null, seriesNum: null, evidence: c.evidence.filter((e) => e.field === "title").map((e) => ({ ...e, matches: [] })) });

function loadState(set: SetName, table: ImprintTable): SetState {
  const { dets, images, before } = loadSet(set);
  const geo = geometry(dets);
  const byGeo = new Map(geo.map((g) => [g.id, g]));
  const db = openCatalog(SETS[set].catalog);
  const base = new Map<string, SpineDecision>();
  const lists = new Map<string, Partial<Record<ReaderName, Candidate[]>>>();
  let drift = 0;
  const statePath = join(PRIV, set, "state.jsonl");
  if (existsSync(statePath)) {
    for (const r of readJsonl<{ base: SpineDecision; lists: Partial<Record<ReaderName, Candidate[]>>; drift: boolean }>(statePath)) {
      base.set(r.base.id, r.base);
      lists.set(r.base.id, r.lists);
      if (r.drift) drift++;
    }
  } else computeState(set, geo, before, db, base, lists, (n) => (drift = n));
  let keysOf: (workId: string) => string[];
  if (set === "pilot-000") keysOf = workImprints(db, table);
  else {
    const pubs = yardstickPublishers();
    keysOf = (w) => publisherKeys(pubs.get(w)).flatMap((k) => [k, ...(table.parents.get(k) ?? [])]);
  }
  return { set, geo, byGeo, base, lists, keysOf, images, dets, truth: set === "pilot-000" ? undefined : yardstickTruth(), drift };
}

/** F-0's decision recomputed from its cached readings, and each reader's top-3 list; written to `state.jsonl`. */
function computeState(
  set: SetName,
  geo: Geo[],
  before: Map<string, SpineDecision>,
  db: ReturnType<typeof openCatalog>,
  base: Map<string, SpineDecision>,
  lists: Map<string, Partial<Record<ReaderName, Candidate[]>>>,
  setDrift: (n: number) => void,
): void {
  const readings = loadReadings(join(ROOT, "f0", set), F0_CROP);
  const topCache = new Map<string, Candidate | undefined>();
  const listCache = new Map<string, Candidate[]>();
  const rows: string[] = [];
  let drift = 0;
  const t0 = Date.now();
  for (const g of geo) {
    const reads = { ...(readings.get(g.id) ?? {}) };
    const cached = before.get(g.id);
    if (cached && !("qwen" in cached.top)) delete reads.qwen; // F-0's decision did not use a Qwen read here
    // One retrieval per reading: F-0's top candidate is the head of the same top-3 list.
    const l: Partial<Record<ReaderName, Candidate[]>> = {};
    for (const r of READERS) {
      if (!reads[r]) continue;
      l[r] = candidatesFor(db, reads[r], listCache);
      const v = variantsOf(reads[r]);
      if (v.length) topCache.set(v.join("\u0000"), l[r]![0]);
    }
    const d = decide(db, g.id, g.imageId, g.boxScore, reads, topCache);
    const drifted = Boolean(cached && (cached.accepted?.workId ?? null) !== (d.accepted?.workId ?? null));
    if (drifted) drift++;
    const b = { ...d, accepted: d.accepted && slim(d.accepted) };
    const sl = Object.fromEntries(Object.entries(l).map(([r, cs]) => [r, cs.map(slim)]));
    base.set(g.id, b);
    lists.set(g.id, sl);
    rows.push(JSON.stringify({ base: b, lists: sl, drift: drifted }));
  }
  mkdirSync(join(PRIV, set), { recursive: true });
  writeFileSync(join(PRIV, set, "state.jsonl"), rows.join("\n") + "\n");
  setDrift(drift);
  log(`${set}: ${geo.length} boxes decided in ${Math.round((Date.now() - t0) / 1000)} s, drift ${drift}`);
}

// --- select ----------------------------------------------------------------------------------------------

function c4NotInIsfdb(): Set<string> {
  const p = join(ROOT, "private", "c4", "pilot-000.sample.jsonl");
  return new Set(readJsonl<{ id: string; role: string; cls: string }>(p).filter((r) => r.role === "sample" && r.cls === "not-in-isfdb").map((r) => r.id));
}

function select(set: SetName): void {
  const s = loadState(set, loadTable());
  const cfg = SELECT[set];
  const outcome = (id: string) => outcomeOf(s.base.get(id)!, s.truth?.get(s.byGeo.get(id)!.imageId));
  const ids = s.geo.map((g) => g.id);
  const of = (o: Outcome) => ids.filter((id) => outcome(id) === o);
  const roles = new Map<string, Role>();
  const add = (role: Role, xs: string[]) => xs.forEach((id) => roles.has(id) || roles.set(id, role));
  // Read order is priority order: the cap, if it binds, cuts the single-reader sample first.
  add("reorderable", ids.filter((id) => reorderable(s.base.get(id)!, s.lists.get(id)!)));
  add("confirmed", draw(ids.filter((id) => s.base.get(id)!.accepted), cfg.confirmed, SEED + 3));
  add("no-text", draw(of("unknown:no-text"), cfg.noText, SEED + 4));
  if (set === "pilot-000") add("c4-not-in-isfdb", [...c4NotInIsfdb()].filter((id) => s.byGeo.has(id)));
  add("readers-disagree", draw(of("unknown:readers-disagree"), cfg.readersDisagree, SEED + 1));
  add("single-reader", draw(of("unknown:single-reader").filter((id) => !roles.has(id)), cfg.singleReader, SEED + 2));
  const counts: Record<string, number> = {};
  for (const r of roles.values()) counts[r] = (counts[r] ?? 0) + 1;
  const dir = join(PRIV, set);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "selection.jsonl"), [...roles].map(([id, role]) => JSON.stringify({ id, role })).join("\n") + "\n");
  log(`${set}: selection ${roles.size} boxes ${JSON.stringify(counts)}; drift ${s.drift}`);
}

// --- read ------------------------------------------------------------------------------------------------

export interface ImprintVariant {
  rotation: number;
  title: string | null;
  author: string | null;
  imprint: string | null;
  imprintFrom: "text" | "logo" | null;
  parsed: boolean;
  seconds: number;
}
export interface ImprintReading {
  id: string;
  reader: string;
  crop?: string;
  variants: ImprintVariant[];
  seconds: number;
  error?: string;
}

/**
 * One box's imprint from its rotations (pre-registered): no rotation names one -> null; every naming rotation gives
 * the same key -> that key; two different keys -> null, counted as a conflict. Logo when every naming rotation said
 * logo, else text.
 */
export function boxImprint(r: ImprintReading | undefined): { key: string | null; name: string | null; from: "text" | "logo" | null; conflict: boolean } {
  const named = (r?.variants ?? []).map((v) => ({ v, key: imprintKey(v.imprint) })).filter((x) => x.key);
  const keys = [...new Set(named.map((x) => x.key!))];
  if (keys.length !== 1) return { key: null, name: null, from: null, conflict: keys.length > 1 };
  return { key: keys[0]!, name: named[0]!.v.imprint, from: named.every((x) => x.v.imprintFrom === "logo") ? "logo" : "text", conflict: false };
}

export function runImprintHelper(requests: object[], out: string): Promise<void> {
  if (requests.length === 0) return Promise.resolve();
  const helper = join(REPO, "helpers", "label");
  return new Promise((resolve, reject) => {
    const child = spawn("uv", ["run", "--project", helper, "python", join(helper, "imprint.py")], { stdio: ["pipe", "pipe", "pipe"] });
    createInterface({ input: child.stdout, crlfDelay: Infinity }).on("line", (l) => l.trim() && appendFileSync(out, `${l}\n`));
    let tail = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c: string) => {
      tail = (tail + c).slice(-2000);
      for (const l of c.split("\n")) if (/^read:/.test(l)) log(l);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(requests.map((r) => `${JSON.stringify(r)}\n`).join(""));
    child.once("error", reject);
    child.once("close", (code) => (code === 0 ? resolve() : reject(new Error(`imprint.py exited ${code}: ${tail.split("\n").slice(-4).join(" | ")}`))));
  });
}

/** Imprint reads on the selection, one Qwen process (the GPU is shared), capped at `SELECT[set].cap` calls. */
async function read(set: SetName, only?: number): Promise<void> {
  const { dets, images } = loadSet(set);
  const dir = join(PRIV, set);
  const sel = readJsonl<{ id: string; role: Role }>(join(dir, "selection.jsonl"));
  if (sel.length === 0) throw new Error(`run \`select ${set}\` first`);
  const out = join(dir, "imprint.jsonl");
  const done = new Set(readJsonl<ImprintReading>(out).filter((r) => !r.error).map((r) => r.id));
  const path = new Map(images.map((i) => [i.id, i.path]));
  let calls = 0;
  const reqs: object[] = [];
  for (const { id } of sel) {
    const imageId = id.slice(0, id.lastIndexOf(":"));
    const det = dets.get(imageId)!;
    const c = cropFor(det.spines[Number(id.slice(id.lastIndexOf(":") + 1))]!, det, CROP);
    if (!c) continue;
    calls += c.rotations.length;
    if (calls > SELECT[set].cap) break;
    if (!done.has(id)) reqs.push({ id, image: path.get(imageId)!, polygon: c.polygon, rotations: c.rotations, crop: c.crop });
  }
  const todo = only ? reqs.slice(0, only) : reqs;
  todo.sort((a, b) => ((a as { image: string }).image < (b as { image: string }).image ? -1 : 1));
  log(`${set}: ${todo.length} boxes to read (${done.size} cached, ${Math.min(calls, SELECT[set].cap)} calls in the capped selection)`);
  const t0 = Date.now();
  await runImprintHelper(todo, out);
  log(`${set}: imprint reads done in ${Math.round((Date.now() - t0) / 1000)} s`);
}

// --- analysis --------------------------------------------------------------------------------------------

interface Row {
  id: string;
  imageId: string;
  role: Role;
  piece: boolean;
  /** At the frame's edge (F-0b's radial cut) or partly out of it: the owner's Tor-at-the-edge case. */
  edge: boolean;
  key: string | null;
  from: "text" | "logo" | null;
  conflict: boolean;
  parsed: boolean;
  calls: number;
  seconds: number;
  /** Accepted work before the tie-break, and its outcome. */
  work: string | null;
  before: Outcome;
  after: Outcome;
  fired: boolean;
  switched: number;
}

const pts = (x: number) => Math.round(x * 1000) / 10;
const ci = (b: { value: number; lo: number; hi: number } | null) => (b ? { value: pts(b.value), lo: pts(b.lo), hi: pts(b.hi) } : null);

/** A share with its 95 % photo-cluster bootstrap interval, in %. */
function shareCi<T extends { imageId: string }>(rows: T[], pred: (r: T) => boolean, seed: number) {
  return { n: rows.length, k: rows.filter(pred).length, ...(ci(clusterBootstrap(rows, (rs) => (rs.length ? rs.filter(pred).length / rs.length : null), REPS, seed)) ?? {}) };
}

/** Paired change in a share over the same boxes, as F-0b: before → after, Δ points, 95 % photo-cluster interval. */
function delta(rows: Row[], pred: (o: Outcome) => boolean, seed: number) {
  const share = (rs: Row[], k: "before" | "after") => (rs.length ? rs.filter((r) => pred(r[k])).length / rs.length : null);
  const b = clusterBootstrap(rows, (rs) => share(rs, "before"), REPS, seed);
  const a = clusterBootstrap(rows, (rs) => share(rs, "after"), REPS, seed);
  const d = clusterBootstrap(rows, (rs) => (rs.length ? share(rs, "after")! - share(rs, "before")! : null), REPS, seed);
  return d && a && b ? { before: pts(b.value), after: pts(a.value), delta: pts(d.value), lo: pts(d.lo), hi: pts(d.hi) } : null;
}

const q = (xs: number[], p: number) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]! * 1000) / 1000;
};

/** Match rate if each box's imprint belonged to another box (seeded shuffles): the chance level of `precision`. */
function nullMatch(rows: Row[], matches: (key: string, work: string) => boolean, reps = 200): number | null {
  if (rows.length < 2) return null;
  const r = rng(SEED + 9);
  let hit = 0, n = 0;
  for (let k = 0; k < reps; k++) {
    const keys = rows.map((x) => x.key!);
    for (let i = keys.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [keys[i], keys[j]] = [keys[j]!, keys[i]!];
    }
    rows.forEach((x, i) => {
      n++;
      if (matches(keys[i]!, x.work!)) hit++;
    });
  }
  return pts(hit / n);
}

function analyseSet(set: SetName, table: ImprintTable) {
  const s = loadState(set, table);
  const sel = readJsonl<{ id: string; role: Role }>(join(PRIV, set, "selection.jsonl"));
  const reads = new Map(readJsonl<ImprintReading>(join(PRIV, set, "imprint.jsonl")).filter((r) => !r.error).map((r) => [r.id, r]));
  const outcome = (d: SpineDecision, imageId: string) => outcomeOf(d, s.truth?.get(imageId));
  const rows: Row[] = [];
  for (const { id, role } of sel) {
    const r = reads.get(id);
    if (!r) continue;
    const g = s.byGeo.get(id)!;
    const b = s.base.get(id)!;
    const bi = boxImprint(r);
    const t = tieBreak(b, s.lists.get(id)!, carries(s.keysOf, bi.key));
    rows.push({
      id, imageId: g.imageId, role, piece: g.piece, edge: g.edge || !g.inFrame, key: bi.key, from: bi.from, conflict: bi.conflict,
      parsed: r.variants.every((v) => v.parsed), calls: r.variants.length, seconds: r.seconds,
      work: b.accepted?.workId ?? null, before: outcome(b, g.imageId), after: outcome(t.decision, g.imageId), fired: t.fired, switched: t.switched.length,
    });
  }
  const yard = set !== "pilot-000";
  const keyed = (r: Row) => r.key !== null;
  const byRole = Object.fromEntries(
    [...new Set(rows.map((r) => r.role))].map((role, i) => {
      const rs = rows.filter((r) => r.role === role);
      return [role, { read: rs.length, imprint: shareCi(rs, keyed, 100 + i), logoOfImprint: rs.filter(keyed).length ? pts(rs.filter((r) => r.from === "logo").length / rs.filter(keyed).length) : null, conflicts: rs.filter((r) => r.conflict).length }];
    }),
  );
  const all = shareCi(rows, keyed, 90);
  // Post hoc (not pre-registered): on the yardstick, a read "imprint" that is the library's own shelf-mark sticker.
  const marks = yard ? shelfMarks() : null;
  const isMark = (r: Row) => Boolean(marks && r.key && (marks.get(r.imageId) ?? []).some((m) => m === r.key || m.startsWith(r.key!) || r.key!.startsWith(m)));
  const imprinted = rows.filter(keyed);
  // Precision: on accepted boxes (yardstick: confirmed, i.e. annotated), does the read imprint name a house of the work's editions?
  const matches = (key: string, work: string) => imprintMatches(key, s.keysOf(work));
  const known = (r: Row) => s.keysOf(r.work!).length > 0;
  const prec = (pred: (r: Row) => boolean, seed: number) => {
    const rs = imprinted.filter((r) => r.role === "confirmed" && r.before === "confirmed" && known(r) && pred(r));
    return { ...shareCi(rs, (r) => matches(r.key!, r.work!), seed), nullMatch: nullMatch(rs, matches) };
  };
  const precision = { all: prec(() => true, 200), text: prec((r) => r.from === "text", 201), logo: prec((r) => r.from === "logo", 202) };
  const confirmedRows = rows.filter((r) => r.role === "confirmed" && r.before === "confirmed");
  // On pilot-000 a matched imprint narrows the work's editions to those from that house.
  const narrowing = yard
    ? null
    : (() => {
        const db = openCatalog(SETS[set].catalog);
        const stmt = db.prepare("SELECT publisher FROM editions WHERE work_id = ?");
        const kept: number[] = [];
        for (const r of imprinted.filter((x) => x.role === "confirmed" && matches(x.key!, x.work!))) {
          const eds = stmt.all(r.work!) as { publisher: string | null }[];
          if (eds.length) kept.push(eds.filter((e) => imprintMatches(r.key, editionKeysOf(table, e.publisher))).length / eds.length);
        }
        db.close();
        return { boxCount: kept.length, editionsKeptP50: q(kept, 0.5), editionsKeptP90: q(kept, 0.9) };
      })();
  const reorder = rows.filter((r) => r.role === "reorderable");
  const tb = (rs: Row[], seed: number) => ({
    boxCount: rs.length,
    photos: new Set(rs.map((r) => r.imageId)).size,
    withImprint: rs.filter(keyed).length,
    fired: rs.filter((r) => r.fired).length,
    switched: rs.filter((r) => r.switched > 0).length,
    newlyAccepted: rs.filter((r) => r.before !== r.after).length,
    confirmed: delta(rs, (o) => o === "confirmed", seed),
    ...(yard ? { wrong: delta(rs, (o) => o === "rejected/wrong", seed + 1) } : {}),
  });
  const reorderableAll = s.geo.filter((g) => reorderable(s.base.get(g.id)!, s.lists.get(g.id)!)).length;
  const secs = rows.flatMap((r) => reads.get(r.id)!.variants.map((v) => v.seconds));
  return {
    scope: SETS[set].scope,
    boxCount: s.geo.length,
    recomputeDrift: s.drift,
    yardstickPublisherKnown: yard ? confirmedRows.filter(known).length : undefined,
    selection: Object.fromEntries([...new Set(sel.map((x) => x.role))].map((role) => [role, { selected: sel.filter((x) => x.role === role).length, read: rows.filter((r) => r.role === role).length }])),
    imprintRead: { all, byRole, byPosition: { edge: shareCi(rows.filter((r) => r.edge), keyed, 95), inner: shareCi(rows.filter((r) => !r.edge), keyed, 96) }, shelfMark: marks ? rows.filter(isMark).length : undefined, conflicts: rows.filter((r) => r.conflict).length, unparsed: rows.filter((r) => !r.parsed).length, logoShare: imprinted.length ? pts(imprinted.filter((r) => r.from === "logo").length / imprinted.length) : null },
    precision,
    narrowing,
    tieBreak: {
      reorderableBoxes: reorderableAll,
      all: tb(reorder, 300),
      byBox: { whole: tb(reorder.filter((r) => !r.piece), 310), cutOrPartial: tb(reorder.filter((r) => r.piece), 320) },
      wholeSet: { boxCount: s.geo.length, confirmedAdded: reorder.filter((r) => r.after === "confirmed" && r.before !== "confirmed").length, wrongAdded: reorder.filter((r) => r.after === "rejected/wrong" && r.before !== "rejected/wrong").length },
    },
    c4NotInIsfdb: yard ? undefined : byRole["c4-not-in-isfdb"] ?? null,
    noTextControl: byRole["no-text"] ?? null,
    runtime: { calls: secs.length, perCallP50: q(secs, 0.5), perCallP90: q(secs, 0.9), totalSeconds: Math.round(secs.reduce((a, b) => a + b, 0)) },
  };
}

/** The yardstick's library shelf marks per image (the annotation's `tag`, e.g. "001 Bel"), as imprint keys. */
function shelfMarks(): Map<string, string[]> {
  const lib = join(ROOT, "proxy", "library-dataset");
  const out = new Map<string, string[]>();
  for (const a of parseCsv(readFileSync(join(lib, "data", "annotations", "library_books_annotations.csv"), "utf8"))) {
    const id = a.image_name!.replace(/\.jpg$/i, ""), k = imprintKey(a.tag);
    if (k) out.set(id, [...(out.get(id) ?? []), k]);
  }
  return out;
}

const editionKeysOf = (table: ImprintTable, publisher: string | null) => publisherKeys(publisher).flatMap((k) => [k, ...(table.parents.get(k) ?? [])]);

const MARKER = "<!-- generated by src/eval/f0d-cli.ts analyse: edit above this line -->";

function analyse(): void {
  const table = loadTable();
  const sets = Object.fromEntries((Object.keys(SETS) as SetName[]).map((set) => [set, analyseSet(set, table)]));
  const p = sets["pilot-000"]!.tieBreak.all, y = sets["yardstick-library-b2"]!.tieBreak.all as ReturnType<typeof analyseSet>["tieBreak"]["all"] & { wrong?: ReturnType<typeof delta> };
  const pilotUp = Boolean(p.confirmed && p.confirmed.lo > 0);
  const yardOk = !y.wrong || y.wrong.lo <= 0;
  const m = {
    runId: "F0d",
    card: "F-0d",
    date: new Date().toLocaleDateString("en-CA"),
    bootstrap: { unit: "photo (cluster); paired where before and after are the same boxes", reps: REPS, interval: "95 % percentile", units: "% or percentage points" },
    preregistered: { select: SELECT, tieK: 3, parent: { minEditions: 10, minShare: 0.05 }, registrant: REGISTRANT, match: "exact key or whole-word prefix of 3+ letters" },
    imprintTable: { publisherStrings: table.strings, keys: table.keys, withParent: table.parents.size },
    keepRule: "keep when the pilot-000 confirmed-share interval on the boxes the tie-break can change excludes 0 upward, and the yardstick's wrong-accept share does not rise beyond its interval",
    verdict: { keep: pilotUp && yardOk, pilotConfirmedExcludesZero: pilotUp, yardstickWrongNotUp: yardOk },
    sets,
  };
  const dir = join(REPO, "evals", "F0d");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "metrics.json"), compactJson(m) + "\n");
  const reportPath = join(dir, "report.md");
  const head = existsSync(reportPath) ? readFileSync(reportPath, "utf8").split(MARKER)[0]! : "# F0d: imprint read (F-0d)\n\n";
  writeFileSync(reportPath, head + MARKER + "\n\n" + tables(m) + "\n");
  log("aggregates -> evals/F0d/{metrics.json,report.md}");
}

function tables(m: { verdict: Record<string, boolean>; sets: Record<string, ReturnType<typeof analyseSet>> }): string {
  type S = { n: number; k: number; value?: number; lo?: number; hi?: number };
  const sh = (x: S | null | undefined) => (x && x.n ? `${x.value} % (${x.lo}–${x.hi}); ${x.k}/${x.n}` : "—");
  type D = { before: number; after: number; delta: number; lo: number; hi: number } | null | undefined;
  const fmt = (d: D) => (d ? `${d.before} → ${d.after} (${d.delta >= 0 ? "+" : ""}${d.delta}; ${d.lo} to ${d.hi})` : "—");
  const out: string[] = [];
  for (const [set, s] of Object.entries(m.sets)) {
    const yard = set !== "pilot-000";
    out.push(`## ${set} (${s.scope})`, "");
    out.push(`${s.boxCount} boxes; F-0's decision recomputed from its cached readings differs on ${s.recomputeDrift}. Qwen imprint calls ${s.runtime.calls}, p50 ${s.runtime.perCallP50} s, p90 ${s.runtime.perCallP90} s per call (one crop at one rotation), ${s.runtime.totalSeconds} s in all.`, "");
    out.push("**Imprint read rate** (box has one imprint across its rotations; 95 % photo-bootstrap interval):", "", "| boxes | selected | read | imprint read | logo share of reads | conflicting rotations |", "|---|---:|---:|---|---:|---:|");
    for (const [role, r] of Object.entries(s.imprintRead.byRole)) out.push(`| ${role} | ${s.selection[role]?.selected ?? "—"} | ${r.read} | ${sh(r.imprint)} | ${r.logoOfImprint ?? "—"} % | ${r.conflicts} |`);
    out.push(`| *at the frame's edge or partly out of it* (descriptive) | | ${s.imprintRead.byPosition.edge.n} | ${sh(s.imprintRead.byPosition.edge)} | | |`, `| *further in* (descriptive) | | ${s.imprintRead.byPosition.inner.n} | ${sh(s.imprintRead.byPosition.inner)} | | |`);
    out.push(`| **all read** | ${Object.values(s.selection).reduce((a, x) => a + x.selected, 0)} | ${s.imprintRead.all.n} | ${sh(s.imprintRead.all)} | ${s.imprintRead.logoShare ?? "—"} % | ${s.imprintRead.conflicts} |`, "");
    if (s.imprintRead.shelfMark !== undefined) out.push(`*Post hoc:* ${s.imprintRead.shelfMark} of the ${s.imprintRead.all.k} imprint reads are the library's own shelf-mark sticker (the annotation's \`tag\` for a book in the same image), not a publisher.`, "");
    out.push(
      `**Precision** on ${yard ? "confirmed (accepted and annotated) boxes whose ISBN registrant names a publisher" : "accepted boxes"}: the read imprint names a house of ${yard ? "the book's ISBN registrant" : "one of the work's editions"}. Chance level: the same boxes with their imprints shuffled.`,
      "",
      "| imprint from | precision | chance level |",
      "|---|---|---:|",
      `| text or logo | ${sh(s.precision.all)} | ${s.precision.all.nullMatch ?? "—"} % |`,
      `| text | ${sh(s.precision.text)} | ${s.precision.text.nullMatch ?? "—"} % |`,
      `| logo | ${sh(s.precision.logo)} | ${s.precision.logo.nullMatch ?? "—"} % |`,
      "",
    );
    if (s.narrowing) out.push(`Where the imprint matches, it keeps a median ${s.narrowing.editionsKeptP50 === null ? "—" : pts(s.narrowing.editionsKeptP50)} % of the work's editions (p90 ${s.narrowing.editionsKeptP90 === null ? "—" : pts(s.narrowing.editionsKeptP90)} %; ${s.narrowing.boxCount} boxes).`, "");
    const t = s.tieBreak;
    out.push(
      `**Tie-break** on the ${t.reorderableBoxes} boxes it could change (F-0 left them unknown, and some passing candidate would be accepted if it alone carried the imprint). Shares in % before → after (Δ points; 95 % paired photo-bootstrap interval).`,
      "",
      `| boxes | read | with imprint | fired | reader switched | outcome changed | confirmed |${yard ? " wrong |" : ""}`,
      `|---|---:|---:|---:|---:|---:|---|${yard ? "---|" : ""}`,
    );
    const row = (label: string, x: any) => `| ${label} | ${x.boxCount} | ${x.withImprint} | ${x.fired} | ${x.switched} | ${x.newlyAccepted} | ${fmt(x.confirmed)} |${yard ? ` ${fmt(x.wrong)} |` : ""}`;
    out.push(row("all", t.all), row("whole boxes", t.byBox.whole), row("cut or partial boxes", t.byBox.cutOrPartial), "");
    out.push(`Over the whole set: ${t.wholeSet.confirmedAdded} confirmed${yard ? ` and ${t.wholeSet.wrongAdded} wrong accepts` : ""} added among ${t.wholeSet.boxCount} boxes.`, "");
    if (s.c4NotInIsfdb) out.push(`**C-4's not-in-ISFDB books:** ${s.c4NotInIsfdb.imprint.k} of ${s.c4NotInIsfdb.read} carry a readable imprint.`, "");
    if (s.noTextControl) out.push(`**No-text control** (no reader read any text): an imprint was reported on ${s.noTextControl.imprint.k} of ${s.noTextControl.read}.`, "");
  }
  out.push("## Verdict", "", "| pilot-000 confirmed interval excludes 0 upward | yardstick wrong accepts not up | keep |", "|---|---|---|");
  out.push(`| ${m.verdict.pilotConfirmedExcludesZero ? "yes" : "no"} | ${m.verdict.yardstickWrongNotUp ? "yes" : "no"} | **${m.verdict.keep ? "keep" : "off"}** |`);
  return out.join("\n");
}

// --- render (private) ------------------------------------------------------------------------------------

function render(): void {
  const table = loadTable();
  const py = join(REPO, "helpers", "label", ".venv", "bin", "python");
  for (const set of Object.keys(SETS) as SetName[]) {
    const s = loadState(set, table);
    const path = new Map(s.images.map((i) => [i.id, i.path]));
    const sel = readJsonl<{ id: string; role: Role }>(join(PRIV, set, "selection.jsonl"));
    const reads = new Map(readJsonl<ImprintReading>(join(PRIV, set, "imprint.jsonl")).filter((r) => !r.error).map((r) => [r.id, r]));
    const boxes: unknown[] = [];
    for (const { id, role } of sel) {
      const r = reads.get(id);
      if (!r) continue;
      const g = s.byGeo.get(id)!, det = s.dets.get(g.imageId)!;
      const c = cropFor(det.spines[Number(id.slice(id.lastIndexOf(":") + 1))]!, det, CROP)!;
      const bi = boxImprint(r);
      const has = carries(s.keysOf, bi.key);
      const b = s.base.get(id)!, t = tieBreak(b, s.lists.get(id)!, has);
      boxes.push({
        id, role, image: path.get(g.imageId), polygon: c.polygon, rotations: c.rotations, variants: r.variants, imprint: bi,
        candidates: Object.fromEntries(Object.entries(s.lists.get(id)!).map(([reader, cs]) => [reader, cs.map((x) => ({ title: x.title, authors: x.authors, score: x.score, passes: confirms(x), carries: has(x.workId) }))])),
        before: outcomeOf(b, s.truth?.get(g.imageId)), after: outcomeOf(t.decision, s.truth?.get(g.imageId)), fired: t.fired,
        accepted: t.decision.accepted ? `${t.decision.accepted.title} — ${t.decision.accepted.authors.join(", ")}` : null,
      });
    }
    const out = join(PRIV, "renders", set);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "boxes.jsonl"), boxes.map((b) => JSON.stringify(b)).join("\n") + "\n");
    // Not isolated (-I): the script imports read.py's crop from its own folder.
    const r = spawnSync(py, [join(REPO, "helpers", "label", "render_f0d.py"), "--boxes", join(out, "boxes.jsonl"), "--out", out, "--label", set], { stdio: ["ignore", "inherit", "inherit"] });
    if (r.status !== 0) throw new Error(`render_f0d.py failed on ${set}`);
  }
  log("review pages written under the data root's private/f0d/renders/");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, set, n] = process.argv.slice(2);
  if (cmd === "analyse") analyse();
  else if (cmd === "render") render();
  else
  if (cmd === "table") saveTable(buildTable());
  else if (cmd === "select" && set && set in SETS) select(set as SetName);
  else if (cmd === "read" && set && set in SETS) await read(set as SetName, n ? Number(n) : undefined);
  else {
    console.error("usage: f0d-cli.ts table | select <set> | read <set> | analyse | render");
    process.exit(2);
  }
}
