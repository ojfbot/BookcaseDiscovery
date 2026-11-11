// F-0g runner: copy groups on each set's cached default boxes, readings and decisions (F-0c's base).
//
//   node src/eval/f0g-cli.ts pairs <set>      # neighbours and their appearance similarities (helpers/label/appearance.py)
//   node src/eval/f0g-cli.ts evidence <set>   # each paired spine's reader tops (F-0's topFor), cached
//   node src/eval/f0g-cli.ts copies <set>     # NS-K2: one set's copy record (copies.jsonl) alone, as analyse writes it
//   node src/eval/f0g-cli.ts calibrate        # fit the visual score on pilot-000's confirmed neighbours; prints VISUAL
//   node src/eval/f0g-cli.ts imprint <set>    # F-0d's imprint read on members of groups that could propagate (--dry-run: count only)
//   node src/eval/f0g-cli.ts analyse          # evals/F0g/{metrics.json,report.md} tables (aggregates only)
//   node src/eval/f0g-cli.ts render           # the data root's private/f0g/renders/pilot-000/index.html (private)
//
// <set> is pilot-000 or yardstick. Cached stage folders are read, never written; everything per box stays under the
// data root's private/f0g/. Nothing here changes F-0's decision: confirmed-by-copy is a separate, recorded basis.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { openCatalog } from "../catalog/cli.ts";
import { normalize } from "../catalog/normalize.ts";
import { scoreWorks, type Candidate } from "../catalog/retrieve.ts";
import { dataRoot } from "../ledger/images.ts";
import { cropFor, cropName } from "../perceive/crop.ts";
import { confirms, CROP, loadReadings, readJsonl, topFor, variantsOf, type Detection, type Reading, type ReaderName } from "./f0.ts";
import { kinds } from "./f0c.ts";
import { imagesOf, meanCI, setCfg, type SetName, type Slim } from "./f0c-cli.ts";
import { acceptSet, needs, setPaths, YARDSTICK } from "./set-paths.ts";
import { boxImprint, runImprintHelper, type ImprintReading } from "./f0d-cli.ts";
import { boxRows, type Tri } from "./f0e.ts";
import { evidenceFor } from "./f0f-cli.ts";
import { loadBoxSet, preRb1 } from "./rb1.ts";
import {
  copyGroups,
  COPY,
  neighbours,
  pairGuard,
  propagate,
  sameAuthor,
  sameWork,
  VISUAL,
  visualFeatures,
  visuallySame,
  visualScore,
  type Appearance,
  type CopyDecision,
  type Fit,
  type GuardReason,
  type Neighbour,
  type SpineEvidence,
  type WorkRef,
} from "./f0g.ts";
import { parseCsv } from "./q1-cli.ts";
import { clusterBootstrap, fitLogistic, predictLogistic, quantile, rate, type Logistic } from "./q1.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const ROOT = dataRoot();
const PRIV = join(ROOT, "private", "f0g");
const REPS = 2000;
const SEED = 20261103;
const log = (s: string): void => console.error(`[f0g] ${s}`);
const r4 = (x: number) => Math.round(x * 10000) / 10000;
const triOf = (b: { value: number; lo: number; hi: number } | null): Tri => (b ? [r4(b.value), r4(b.lo), r4(b.hi)] : null);
const SET_NAMES: SetName[] = ["pilot-000", "yardstick"];

/** The pre-registered operating point: the share of different-work neighbours allowed past the visual test. */
export const CALIBRATION = { falsePassRate: 0.02, folds: 3 } as const;

const stage = (set: string): string => {
  const dir = setPaths(set, ROOT).f0g;
  mkdirSync(dir, { recursive: true });
  return dir;
};
export const loadDets = (set: string): Map<string, Detection> =>
  new Map(readJsonl<Detection>(join(setCfg(set).base, "detect.jsonl")).filter((d) => !d.error).map((d) => [d.id, d]));

/**
 * The shipped box set's kinds: per photo, whether each box is a book. F-0c's not-a-book flags and F-0f's shelf
 * labels and cards (from the base's Vision and PP-OCR text and F-0f's cached pixel probe); the cover pass is off.
 * Then RB-1's box set: boxes F-0i's partition drops and NB-3's `on-lip` boxes are not books either
 * (`--box-set pre-rb1` for the figures as first published).
 */
export const loadBooks = (set: string, dets: Map<string, Detection>): Map<string, boolean[]> => {
  const ev = evidenceFor(set);
  const keeps = preRb1() ? () => true : loadBoxSet(set).keeps;
  return new Map([...dets].map(([id, d]) => [id, kinds({ ...d, covers: [] }, ev.get(id)).spines.map((b, i) => b.kind === "spine" && keeps(`${id}:${i}`))]));
};

// --- pairs: neighbours and appearance ----------------------------------------------------------------------

export interface PairRow extends Neighbour, Appearance {}
interface PhotoPairs {
  id: string;
  pairs: PairRow[];
  seconds: number;
  error?: string;
}

async function pairs(set: string): Promise<void> {
  needs("F-0g", set, "default boxes", join(setCfg(set).base, "detect.jsonl"), `f0e-cli.ts detect --set ${set} --label bands+strips`);
  const out = join(stage(set), "pairs.jsonl");
  const done = new Set(readJsonl<PhotoPairs>(out).filter((p) => !p.error).map((p) => p.id));
  const dets = loadDets(set);
  const paths = new Map(imagesOf(set).map((i) => [i.id, i.path]));
  const todo = [...dets.values()].filter((d) => !done.has(d.id));
  if (todo.length === 0) return;
  const books = loadBooks(set, dets);
  const nb = new Map(todo.map((d) => [d.id, neighbours(d, (i) => books.get(d.id)![i]!)]));
  const reqs = todo.map((d) => ({
    id: d.id,
    image: paths.get(d.id),
    spines: d.spines.map((s, i) => ({ i, polygon: s.polygon })),
    pairs: nb.get(d.id)!.map((n) => [n.a, n.b]),
  }));
  log(`${set}: ${reqs.reduce((s, r) => s + r.pairs.length, 0)} neighbour pairs in ${reqs.length} photos`);
  const helper = join(REPO, "helpers", "label");
  const lines: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const child = spawn("uv", ["run", "--project", helper, "python", "-I", join(helper, "appearance.py")], { stdio: ["pipe", "pipe", "inherit"] });
    let buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c: string) => {
      buf += c;
      const parts = buf.split("\n");
      buf = parts.pop()!;
      lines.push(...parts.filter((l) => l.trim()));
    });
    child.stdin.end(reqs.map((r) => `${JSON.stringify(r)}\n`).join(""));
    child.once("error", reject);
    child.once("close", (code) => (code === 0 ? resolve() : reject(new Error(`appearance.py exited ${code}`))));
  });
  const rows = lines.map((l) => {
    const r = JSON.parse(l) as { id: string; pairs?: (Appearance & { a: number; b: number })[]; seconds?: number; error?: string };
    if (r.error) return { id: r.id, pairs: [], seconds: 0, error: r.error };
    const byPair = new Map(nb.get(r.id)!.map((n) => [`${n.a}:${n.b}`, n]));
    return { id: r.id, seconds: r.seconds ?? 0, pairs: r.pairs!.map((p) => ({ ...byPair.get(`${p.a}:${p.b}`)!, ncc: p.ncc, hist: p.hist, prof: p.prof, valid: p.valid })) };
  });
  writeFileSync(out, (existsSync(out) ? readFileSync(out, "utf8") : "") + rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

const loadPairs = (set: string): Map<string, PhotoPairs> => new Map(readJsonl<PhotoPairs>(join(stage(set), "pairs.jsonl")).filter((p) => !p.error).map((p) => [p.id, p]));

// --- evidence: each paired spine's reader tops -------------------------------------------------------------

const ref = (c: Candidate): WorkRef => ({ workId: c.workId, title: c.title, authors: c.authors });

function evidence(set: string): void {
  needs("F-0g", set, "neighbour pairs", join(setPaths(set, ROOT).f0g, "pairs.jsonl"), `f0g-cli.ts pairs ${set}`);
  // Incremental: a spine's evidence depends on its readings and F-0's decision, not on its neighbours, so rows
  // cached before a box-set change are reused and only spines newly paired are scored.
  const out = join(stage(set), "evidence.jsonl");
  const have = new Set(readJsonl<SpineEvidence>(out).map((e) => e.id));
  const t0 = Date.now();
  const db = openCatalog(setCfg(set).catalog);
  const readings = loadReadings(setCfg(set).base);
  const base = loadBase(set);
  const ids = new Set<string>();
  for (const p of loadPairs(set).values()) for (const n of p.pairs) ids.add(`${p.id}:${n.a}`).add(`${p.id}:${n.b}`);
  const cache = new Map<string, Candidate | undefined>();
  const rows: SpineEvidence[] = [];
  for (const id of [...ids].sort()) {
    if (have.has(id)) continue;
    const reads = readings.get(id) ?? {};
    const readers = (Object.keys(reads) as ReaderName[])
      .filter((r) => variantsOf(reads[r]).length > 0)
      .map((r) => {
        const c = topFor(db, reads[r], cache);
        return { reader: r, top: c ? { ...ref(c), score: c.score, titleEvidence: c.evidence.find((e) => e.field === "title")?.score ?? 0, passes: confirms(c) } : null };
      });
    const acc = base.get(id)?.accepted ?? null;
    const top = acc ? readers.find((r) => r.top?.workId === acc)?.top : undefined;
    if (acc && !top) throw new Error(`accepted work not among its readers' tops in ${set}`);
    rows.push({ id, accepted: top ? { workId: top.workId, title: top.title, authors: top.authors } : null, readers });
  }
  if (rows.length) writeFileSync(out, (existsSync(out) ? readFileSync(out, "utf8") : "") + rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  log(`${set}: evidence for ${rows.length} new spines (${have.size} cached) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

const loadBase = (set: string): Map<string, Slim> => {
  const path = join(setPaths(set, ROOT).f0c, "base-decisions.jsonl");
  if (!existsSync(path)) throw new Error(`run node src/eval/f0c-cli.ts base ${set} first`);
  return new Map(readJsonl<Slim>(path).map((d) => [d.id, d]));
};

/** `scoreWorks` per (spine, reader, work), memoised: how well a work explains one reader's text of one spine. */
function fitFor(db: DatabaseSync, readings: Map<string, Partial<Record<ReaderName, Reading>>>): Fit {
  const memo = new Map<string, { score: number; titleEvidence: number } | null>();
  return (spineId, reader, workId) => {
    const key = `${spineId}\u0000${reader}\u0000${workId}`;
    if (!memo.has(key)) {
      const v = variantsOf(readings.get(spineId)?.[reader]);
      const c = v.length ? scoreWorks(db, v, [workId]).get(workId) : undefined;
      memo.set(key, c ? { score: c.score, titleEvidence: c.evidence.find((e) => e.field === "title")?.score ?? 0 } : null);
    }
    return memo.get(key)!;
  };
}

// --- calibrate --------------------------------------------------------------------------------------------

interface CalRow {
  imageId: string;
  x: number[];
  same: boolean;
}

/** pilot-000 neighbours whose identities F-0 confirmed on both sides: same work (1) against different works (0). */
function calibrationRows(): CalRow[] {
  const ev = new Map(readJsonl<SpineEvidence>(join(stage("pilot-000"), "evidence.jsonl")).map((e) => [e.id, e]));
  const rows: CalRow[] = [];
  for (const p of loadPairs("pilot-000").values())
    for (const n of p.pairs) {
      const a = ev.get(`${p.id}:${n.a}`)?.accepted;
      const b = ev.get(`${p.id}:${n.b}`)?.accepted;
      if (!a || !b || !n.valid) continue;
      rows.push({ imageId: p.id, x: visualFeatures(n, n), same: sameWork(a, b) });
    }
  return rows;
}

/** Fit, and the threshold at which `falsePassRate` of the negatives (different works) pass. */
function fitVisual(rows: CalRow[]): Logistic & { threshold: number } {
  const m = fitLogistic(rows.map((r) => r.x), rows.map((r) => (r.same ? 1 : 0)), [...VISUAL.features]);
  const neg = rows.filter((r) => !r.same).map((r) => predictLogistic(m, r.x)).sort((a, b) => a - b);
  return { ...m, threshold: quantile(neg, 1 - CALIBRATION.falsePassRate) };
}

function calibrate(): void {
  const rows = calibrationRows();
  const photos = [...new Set(rows.map((r) => r.imageId))].sort();
  // Out-of-fold check: photos split into folds; each fold is scored by a model and threshold fitted on the others.
  const oof: { same: boolean; pass: boolean }[] = [];
  for (let k = 0; k < CALIBRATION.folds; k++) {
    const held = new Set(photos.filter((_, i) => i % CALIBRATION.folds === k));
    const m = fitVisual(rows.filter((r) => !held.has(r.imageId)));
    for (const r of rows.filter((r) => held.has(r.imageId))) oof.push({ same: r.same, pass: predictLogistic(m, r.x) >= m.threshold });
  }
  const m = fitVisual(rows);
  const round = (xs: number[]) => xs.map((x) => Math.round(x * 1e6) / 1e6);
  const frozen = { features: m.features, mean: round(m.mean), sd: round(m.sd), weights: round(m.weights), threshold: Math.round(m.threshold * 1e6) / 1e6 };
  const pos = oof.filter((o) => o.same);
  const neg = oof.filter((o) => !o.same);
  const summary = {
    pairs: rows.length,
    sameWork: rows.filter((r) => r.same).length,
    differentWork: rows.filter((r) => !r.same).length,
    photos: photos.length,
    outOfFold: { samePassShare: r4(pos.filter((o) => o.pass).length / Math.max(1, pos.length)), differentPassShare: r4(neg.filter((o) => o.pass).length / Math.max(1, neg.length)) },
    model: frozen,
  };
  writeFileSync(join(PRIV, "calibration.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

// --- imprint: the edition clue where it can change a decision ---------------------------------------------

/** F-0d's cached imprint reads on the same boxes (the yardstick's default is F-0's run, which F-0d read). */
const F0D_IMPRINTS: Partial<Record<string, string>> = { [YARDSTICK]: join(ROOT, "private", "f0d", "yardstick-library-b2", "imprint.jsonl") };

const loadImprints = (set: string): Map<string, ImprintReading> =>
  new Map(
    [...readJsonl<ImprintReading>(F0D_IMPRINTS[set] ?? ""), ...readJsonl<ImprintReading>(join(stage(set), "imprint.jsonl"))]
      .filter((r) => !r.error && (r.crop ?? "") === cropName(CROP))
      .map((r) => [r.id, r]),
  );

/**
 * Imprint reads (helpers/label/imprint.py, Qwen) on every member of a copy group that holds a confirmed copy and an
 * unconfirmed one, the only groups where the imprint guard can change a decision; boxes F-0d already read are reused.
 */
async function imprint(set: string, dryRun = false): Promise<void> {
  const run = runSet(set);
  const done = loadImprints(set);
  const paths = new Map(imagesOf(set).map((i) => [i.id, i.path]));
  const reqs: object[] = [];
  for (const g of run.groups) {
    const ids = g.members.map((i) => `${g.imageId}:${i}`);
    if (!ids.some((id) => run.base.get(id)?.accepted) || ids.every((id) => run.base.get(id)?.accepted)) continue;
    const det = run.dets.get(g.imageId)!;
    for (const i of g.members) {
      const id = `${g.imageId}:${i}`;
      const c = cropFor(det.spines[i]!, det, CROP);
      if (c && !done.has(id)) reqs.push({ id, image: paths.get(g.imageId)!, polygon: c.polygon, rotations: c.rotations, crop: c.crop });
    }
  }
  log(`${set}: ${reqs.length} boxes to read for their imprint (${done.size} cached)`);
  if (dryRun || reqs.length === 0) return;
  const t0 = Date.now();
  await runImprintHelper(reqs, join(stage(set), "imprint.jsonl"));
  log(`${set}: imprint reads done in ${Math.round((Date.now() - t0) / 1000)} s`);
}

// --- analyse ------------------------------------------------------------------------------------------------

/** Annotated copies per work per yardstick image (the annotation lists every book, so a work twice is two copies). */
export function yardstickCopies(): Map<string, Map<string, number>> {
  const lib = join(ROOT, "proxy", "library-dataset");
  const cleanTitle = (t: string) => t.replace(/\s+:\s+/g, ": ").replace(/\s+/g, " ").trim(); // as in F-0 and Q-1
  const inv = parseCsv(readFileSync(join(lib, "data", "target_lists", "library_books.csv"), "utf8"));
  const byIsbn = new Map<string, string>();
  const byTitle = new Map<string, string>();
  inv.forEach((b, i) => {
    const isbn = (b.isbn ?? "").replace(/\D/g, "");
    if (isbn) byIsbn.set(isbn, `isfdb:${i + 1}`);
    byTitle.set(normalize(cleanTitle(b.title ?? "")), `isfdb:${i + 1}`);
  });
  const out = new Map<string, Map<string, number>>();
  for (const a of parseCsv(readFileSync(join(lib, "data", "annotations", "library_books_annotations.csv"), "utf8"))) {
    if (a.not_book === "True") continue;
    const id = a.image_name!.replace(/\.jpg$/i, "");
    const m = out.get(id) ?? new Map<string, number>();
    const w = byIsbn.get((a.isbn ?? "").replace(/\D/g, "")) ?? byTitle.get(normalize(cleanTitle(a.title ?? "")));
    if (w) m.set(w, (m.get(w) ?? 0) + 1);
    out.set(id, m);
  }
  return out;
}

export interface PairOutcome {
  imageId: string;
  n: PairRow;
  score: number;
  visual: boolean;
  guard: GuardReason | null;
  a: SpineEvidence | undefined;
  b: SpineEvidence | undefined;
}

export interface SetRun {
  set: string;
  dets: Map<string, Detection>;
  books: Map<string, boolean[]>;
  base: Map<string, Slim>;
  ev: Map<string, SpineEvidence>;
  fit: Fit;
  outcomes: PairOutcome[];
  groups: { imageId: string; band: number; members: number[] }[];
  decisions: Map<string, CopyDecision>;
  seconds: { pairsPerPhoto: number[]; analyse: number };
}

export const noEvidence = (id: string): SpineEvidence => ({ id, accepted: null, readers: [] });

export function runSet(set: string, useImprint = true): SetRun {
  const t0 = Date.now();
  const dets = loadDets(set);
  const books = loadBooks(set, dets);
  const base = loadBase(set);
  const imprints = useImprint ? loadImprints(set) : new Map<string, ImprintReading>();
  const ev = new Map(readJsonl<SpineEvidence>(join(stage(set), "evidence.jsonl")).map((e) => [e.id, { ...e, imprint: boxImprint(imprints.get(e.id)).key }]));
  const db = openCatalog(setCfg(set).catalog);
  const fit = fitFor(db, loadReadings(setCfg(set).base));
  const pp = loadPairs(set);
  const outcomes: PairOutcome[] = [];
  const groups: SetRun["groups"] = [];
  const decisions = new Map<string, CopyDecision>();
  for (const [imageId, p] of pp) {
    const det = dets.get(imageId)!;
    const rows = boxRows(det);
    const links: { a: number; b: number }[] = [];
    for (const n of p.pairs) {
      const a = ev.get(`${imageId}:${n.a}`);
      const b = ev.get(`${imageId}:${n.b}`);
      const visual = visuallySame(n, n);
      const guard = visual ? pairGuard(a ?? noEvidence(`${imageId}:${n.a}`), b ?? noEvidence(`${imageId}:${n.b}`), fit) : null;
      outcomes.push({ imageId, n, score: visualScore(n, n), visual, guard, a, b });
      if (visual && !guard) links.push(n);
    }
    for (const g of copyGroups(links, (i) => rows[i]!.g.cx)) {
      groups.push({ imageId, band: rows[g[0]!]!.band, members: g });
      for (const d of propagate(g.map((i) => ev.get(`${imageId}:${i}`) ?? noEvidence(`${imageId}:${i}`)), fit)) decisions.set(d.id, d);
    }
  }
  return { set, dets, books, base, ev, fit, outcomes, groups, decisions, seconds: { pairsPerPhoto: [...pp.values()].map((p) => p.seconds), analyse: (Date.now() - t0) / 1000 } };
}

/**
 * Hide the confirmed side `y` of a confirmed pair and keep one of its readers: would the guard and the consistency
 * rule propagate `x`'s work to it? The commonest unconfirmed spine is one reader's text (`single-reader`), so this
 * view is what propagation meets in use; `weak` keeps only views whose reader does not pass F-0's bar on its own.
 */
function singleReaderViews(o: PairOutcome, fit: Fit): { propagated: boolean; weak: boolean; reason: string | null }[] {
  const out: { propagated: boolean; weak: boolean; reason: string | null }[] = [];
  for (const [x, y] of [[o.a!, o.b!], [o.b!, o.a!]] as const)
    for (const r of y.readers) {
      const view: SpineEvidence = { id: y.id, accepted: null, readers: [r] };
      const [d] = propagate([x, view], fit).slice(1);
      out.push({ propagated: d!.basis === "confirmed-by-copy", weak: !r.top?.passes, reason: d!.blocked ?? null });
    }
  return out;
}

interface PhotoCount {
  imageId: string;
  boxes: number;
  confirmed: number;
  byCopy: number;
  groups: number;
  identifiedGroups: number;
  /** yardstick only: accepted boxes whose work is not annotated in the image, before and with propagation. */
  wrongBase?: number;
  wrongWith?: number;
  overCountBase?: number;
  overCountWith?: number;
}

function analyseSet(run: SetRun) {
  const { set, dets, books, base, outcomes, groups, decisions, fit } = run;
  const truth = set === "yardstick" ? yardstickCopies() : null;
  const photos: PhotoCount[] = [...dets.values()].map((d) => {
    const ids = d.spines.flatMap((_, i) => (books.get(d.id)![i] ? [`${d.id}:${i}`] : []));
    const acc = ids.map((id) => base.get(id)?.accepted ?? null);
    const prop = ids.map((id) => (decisions.get(id)?.basis === "confirmed-by-copy" ? decisions.get(id)!.workId : null));
    const gs = groups.filter((g) => g.imageId === d.id);
    const row: PhotoCount = {
      imageId: d.id,
      boxes: ids.length,
      confirmed: acc.filter(Boolean).length,
      byCopy: prop.filter(Boolean).length,
      groups: gs.length,
      identifiedGroups: gs.filter((g) => g.members.some((i) => base.get(`${d.id}:${i}`)?.accepted)).length,
    };
    if (truth) {
      const t = truth.get(d.id) ?? new Map<string, number>();
      const labelled = (ws: (string | null)[]) => {
        const c = new Map<string, number>();
        for (const w of ws) if (w) c.set(w, (c.get(w) ?? 0) + 1);
        return c;
      };
      const wrong = (ws: (string | null)[]) => ws.filter((w) => w && !t.has(w)).length;
      const over = (ws: (string | null)[]) => [...labelled(ws)].reduce((s, [w, n]) => s + (t.has(w) ? Math.max(0, n - t.get(w)!) : 0), 0);
      const withProp = acc.map((w, i) => w ?? prop[i]!);
      Object.assign(row, { wrongBase: wrong(acc), wrongWith: wrong(withProp), overCountBase: over(acc), overCountWith: over(withProp) });
    }
    return row;
  });
  const sizes: Record<string, number> = {};
  for (const g of groups) {
    const k = g.members.length >= 4 ? "4+" : String(g.members.length);
    sizes[k] = (sizes[k] ?? 0) + 1;
  }
  const by = (k: keyof PhotoCount) => photos.map((p) => Number(p[k] ?? 0));
  const paired = (a: number[], b: number[]) => meanCI(b.map((x, i) => x - a[i]!));
  const shareCI = <T extends { imageId: string }>(rows: T[], pred: (r: T) => boolean): Tri => triOf(clusterBootstrap(rows, rate(pred), REPS, SEED));

  // Wrong groupings: visually same neighbours whose works F-0 confirmed on both sides and that differ.
  const both = outcomes.filter((o) => o.a?.accepted && o.b?.accepted);
  const bothVisual = both.filter((o) => o.visual);
  const differ = (o: PairOutcome) => !sameWork(o.a!.accepted!, o.b!.accepted!);
  // Hard negatives: different works by a shared author (a series run), both confirmed.
  const hard = both.filter((o) => differ(o) && sameAuthor(o.a!.accepted!, o.b!.accepted!));
  const views = (os: PairOutcome[]) => os.flatMap((o) => singleReaderViews(o, fit).map((v) => ({ ...v, imageId: o.imageId })));
  const sameViews = views(bothVisual.filter((o) => !differ(o)));
  const diffViews = views(bothVisual.filter(differ));
  const hardViews = views(hard.filter((o) => o.visual));
  const hardAll = views(hard);
  const guardReasons: Record<string, number> = {};
  for (const o of outcomes) if (o.guard) guardReasons[o.guard] = (guardReasons[o.guard] ?? 0) + 1;
  const blocked: Record<string, number> = {};
  for (const d of decisions.values()) if (d.blocked) blocked[d.blocked] = (blocked[d.blocked] ?? 0) + 1;

  // Work-level counting (hardback and softback together): copies of a work on one shelf band, whatever they look like.
  const perWork = new Map<string, { n: number; groups: Set<string> }>();
  for (const d of dets.values())
    d.spines.forEach((_, i) => {
      if (!books.get(d.id)![i]) return;
      const id = `${d.id}:${i}`;
      const w = base.get(id)?.accepted ?? (decisions.get(id)?.basis === "confirmed-by-copy" ? decisions.get(id)!.workId : null);
      if (!w) return;
      const band = boxRows(d)[i]!.band;
      const key = `${d.id}|${band}|${w}`;
      const g = groups.findIndex((x) => x.imageId === d.id && x.members.includes(i));
      const e = perWork.get(key) ?? { n: 0, groups: new Set<string>() };
      e.n++;
      e.groups.add(g >= 0 ? `g${g}` : `s${i}`);
      perWork.set(key, e);
    });
  const copiesPerWork: Record<string, number> = {};
  for (const e of perWork.values()) {
    const k = e.n >= 4 ? "4+" : String(e.n);
    copiesPerWork[k] = (copiesPerWork[k] ?? 0) + 1;
  }
  const multi = [...perWork.values()].filter((e) => e.n >= 2);

  const yard = truth
    ? {
        wrongAcceptsBase: by("wrongBase").reduce((a, b) => a + b, 0),
        wrongAcceptsWith: by("wrongWith").reduce((a, b) => a + b, 0),
        wrongPerImageDelta: paired(by("wrongBase"), by("wrongWith")),
        wrongPerImageBase: meanCI(by("wrongBase")),
        wrongShareOfAcceptedBase: wrongShare(photos, "base"),
        wrongShareOfAcceptedWith: wrongShare(photos, "with"),
        overCountBase: by("overCountBase").reduce((a, b) => a + b, 0),
        overCountWith: by("overCountWith").reduce((a, b) => a + b, 0),
        propagatedAnnotated: photos.reduce((s, p) => s + p.byCopy, 0) - (by("wrongWith").reduce((a, b) => a + b, 0) - by("wrongBase").reduce((a, b) => a + b, 0)),
      }
    : null;

  const propagatedBoxes = [...decisions.values()].filter((d) => d.basis === "confirmed-by-copy");
  return {
    scope: setCfg(set).scope,
    photos: photos.length,
    boxCount: photos.reduce((s, p) => s + p.boxes, 0),
    notABookCount: [...books.values()].reduce((s, b) => s + b.filter((x) => !x).length, 0),
    neighbourPairs: outcomes.length,
    neighbourPairsInFrame: outcomes.filter((o) => o.n.valid).length,
    visuallySame: outcomes.filter((o) => o.visual).length,
    guardRejected: outcomes.filter((o) => o.guard).length,
    guardReasons,
    links: outcomes.filter((o) => o.visual && !o.guard).length,
    groups: {
      total: groups.length,
      perPhoto: meanCI(by("groups")),
      identified: groups.filter((g) => g.members.some((i) => base.get(`${g.imageId}:${i}`)?.accepted)).length,
      identifiedPerPhoto: meanCI(by("identifiedGroups")),
      sizes,
      photosWithGroup: photos.filter((p) => p.groups > 0).length,
    },
    propagation: {
      confirmedBase: photos.reduce((s, p) => s + p.confirmed, 0),
      confirmedByCopy: propagatedBoxes.length,
      confirmedPerPhotoBase: meanCI(by("confirmed")),
      extraConfirmedPerPhoto: paired(by("confirmed"), photos.map((p) => p.confirmed + p.byCopy)),
      confirmedShareBase: triOf(clusterBootstrap(photos, (ps) => ps.reduce((s, p) => s + p.confirmed, 0) / Math.max(1, ps.reduce((s, p) => s + p.boxes, 0)), REPS, SEED)),
      extraConfirmedSharePts: triOf(clusterBootstrap(photos, (ps) => ps.reduce((s, p) => s + p.byCopy, 0) / Math.max(1, ps.reduce((s, p) => s + p.boxes, 0)), REPS, SEED)),
      blocked,
      consistentReaders: count(propagatedBoxes.flatMap((d) => d.consistent ?? [])),
    },
    wrongGroupings: {
      bothConfirmedPairs: both.length,
      bothConfirmedVisual: bothVisual.length,
      visualDifferentWorkShare: shareCI(bothVisual, differ),
      differentWorkBeforeVisual: shareCI(both, differ),
      afterGuard: bothVisual.filter((o) => differ(o) && !o.guard).length,
      singleReaderViews: {
        sameWork: { views: sameViews.length, propagated: shareCI(sameViews, (v) => v.propagated), weakViews: sameViews.filter((v) => v.weak).length, weakPropagated: shareCI(sameViews.filter((v) => v.weak), (v) => v.propagated) },
        differentWork: { views: diffViews.length, propagated: shareCI(diffViews, (v) => v.propagated), weakViews: diffViews.filter((v) => v.weak).length, weakPropagated: shareCI(diffViews.filter((v) => v.weak), (v) => v.propagated) },
        precision: precisionOf(sameViews, diffViews),
      },
    },
    seriesGuard: {
      hardNegatives: hard.length,
      hardNegativesVisual: hard.filter((o) => o.visual).length,
      visualPassShare: shareCI(hard, (o) => o.visual),
      otherNegativesVisualPassShare: shareCI(both.filter((o) => differ(o) && !sameAuthor(o.a!.accepted!, o.b!.accepted!)), (o) => o.visual),
      fullReadsRejected: hard.filter((o) => o.visual && o.guard).length,
      viewsVisual: hardViews.length,
      viewsVisualBlocked: shareCI(hardViews, (v) => !v.propagated),
      viewsAll: hardAll.length,
      viewsAllBlocked: shareCI(hardAll, (v) => !v.propagated),
      weakViewsAll: hardAll.filter((v) => v.weak).length,
      weakViewsAllBlocked: shareCI(hardAll.filter((v) => v.weak), (v) => !v.propagated),
      blockedBy: count(hardAll.filter((v) => !v.propagated).map((v) => v.reason ?? "none")),
    },
    workCounting: {
      workShelfEntries: perWork.size,
      copiesPerWorkOnShelf: copiesPerWork,
      worksWithCopies: multi.length,
      worksWithCopiesInSeveralGroups: multi.filter((e) => e.groups.size > 1).length,
    },
    yardstick: yard,
    runtime: {
      appearanceSecondsPerPhoto: { p50: r4(quantile([...run.seconds.pairsPerPhoto].sort((a, b) => a - b), 0.5)), total: Math.round(run.seconds.pairsPerPhoto.reduce((a, b) => a + b, 0)) },
      analyseSeconds: Math.round(run.seconds.analyse),
    },
  };
}

function count(xs: string[]): Record<string, number> {
  const o: Record<string, number> = {};
  for (const x of xs) o[x] = (o[x] ?? 0) + 1;
  return o;
}

function wrongShare(photos: PhotoCount[], side: "base" | "with"): Tri {
  return triOf(
    clusterBootstrap(
      photos,
      (ps) => {
        const acc = ps.reduce((s, p) => s + p.confirmed + (side === "with" ? p.byCopy : 0), 0);
        return acc ? ps.reduce((s, p) => s + Number(side === "with" ? p.wrongWith : p.wrongBase), 0) / acc : null;
      },
      REPS,
      SEED,
    ),
  );
}

/** Of single-reader views that propagate, the share that propagate the right work (same-work views), photo bootstrap. */
function precisionOf(same: { imageId: string; propagated: boolean }[], diff: { imageId: string; propagated: boolean }[]): Tri {
  const rows = [...same.map((v) => ({ ...v, ok: true })), ...diff.map((v) => ({ ...v, ok: false }))].filter((v) => v.propagated);
  return triOf(clusterBootstrap(rows, rate((v) => v.ok), REPS, SEED));
}

function analyse(): void {
  const t0 = Date.now();
  const cal = JSON.parse(readFileSync(join(PRIV, "calibration.json"), "utf8"));
  const sets = Object.fromEntries(
    SET_NAMES.map((s) => {
      const run = runSet(s);
      writeCopies(run);
      return [s, analyseSet(run)];
    }),
  );
  const p = sets["pilot-000"] as ReturnType<typeof analyseSet>;
  const y = sets.yardstick as ReturnType<typeof analyseSet>;
  // Keep rule, pre-registered in evals/F0g/report.md before this ran.
  const lift = p.propagation.extraConfirmedPerPhoto;
  const yd = y.yardstick!;
  const keep = {
    pilotConfirmedRises: lift !== null && lift[1] > 0,
    yardstickWrongNotUp: yd.wrongPerImageDelta !== null && yd.wrongPerImageDelta[1] <= 0 && within(yd.wrongShareOfAcceptedWith, yd.wrongShareOfAcceptedBase),
  };
  const metrics = {
    card: "F-0g",
    run: "2026-11-03",
    note: "Aggregates only. pilot-000 is machine agreement, never accuracy (INV-17); the yardstick is PROXY (library shelves). Never pooled (OC35).",
    boxSet: "each set's default boxes (pilot-000: F-0e bands+strips; yardstick: F-0's B2 run) less F-0c's and F-0f's not-a-book boxes, as shipped on main 9653345",
    calibration: { rule: `logistic score over ${VISUAL.features.join(", ")}; threshold where ${CALIBRATION.falsePassRate * 100} % of different-work confirmed neighbours pass; pilot-000 only`, ...cal, model: undefined },
    copy: COPY,
    sets,
    keep: { ...keep, ship: keep.pilotConfirmedRises && keep.yardstickWrongNotUp },
    seconds: Math.round((Date.now() - t0) / 1000),
  };
  const dir = join(REPO, "evals", "F0g");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "metrics.json"), JSON.stringify(metrics, null, 2) + "\n");
  const reportPath = join(dir, "report.md");
  const report = readFileSync(reportPath, "utf8");
  const marker = "<!-- tables -->";
  writeFileSync(reportPath, report.slice(0, report.indexOf(marker) + marker.length) + "\n" + tables(metrics));
  log(`analyse: ${metrics.seconds} s -> evals/F0g/`);
}

/**
 * The record (private): every member of every copy group with its group, the group's size and its decision basis,
 * so `confirmed-by-copy` labels can be counted, audited or dropped on their own. Never a merge: one line per copy.
 */
function writeCopies(run: SetRun): void {
  const lines = run.groups.flatMap((g, k) =>
    g.members.map((i) => {
      const d = run.decisions.get(`${g.imageId}:${i}`)!;
      return JSON.stringify({ ...d, group: k, groupSize: g.members.length, band: g.band });
    }),
  );
  writeFileSync(join(stage(run.set), "copies.jsonl"), lines.join("\n") + "\n");
}

/**
 * One set's copy record alone (NS-K2): what `analyse` writes per set, with the calibration pilot-000 fixed
 * (`VISUAL`), so a session `analyse` never saw gets its `confirmed-by-copy` labels. No aggregate is written.
 */
function copies(set: string): void {
  needs("F-0g", set, "spine evidence", join(setPaths(set, ROOT).f0g, "evidence.jsonl"), `f0g-cli.ts evidence ${set}`);
  const run = runSet(set);
  writeCopies(run);
  log(`${set}: ${run.groups.length} copy groups, ${run.decisions.size} decisions under the data root's private/f0g/${set}/copies.jsonl`);
}

/** The point estimate `a` sits inside interval `b`. */
const within = (a: Tri, b: Tri): boolean => a !== null && b !== null && a[0] >= b[1] && a[0] <= b[2];

// --- report tables -------------------------------------------------------------------------------------------

const pc = (t: Tri, d = 1) => (t ? `${(t[0] * 100).toFixed(d)} % (${(t[1] * 100).toFixed(d)}–${(t[2] * 100).toFixed(d)})` : "–");
const num = (t: Tri, d = 2) => (t ? `${t[0].toFixed(d)} (${t[1].toFixed(d)} to ${t[2].toFixed(d)})` : "–");
const kv = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ") || "none";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tables(m: any): string {
  const out: string[] = [];
  const c = m.calibration;
  out.push(`### Calibration (pilot-000, confirmed neighbours)\n`);
  out.push(`${c.pairs} neighbour pairs in frame with both identities confirmed in ${c.photos} photos: ${c.sameWork} same work, ${c.differentWork} different works. Out of fold (${CALIBRATION.folds} photo folds): ${pc([c.outOfFold.samePassShare, c.outOfFold.samePassShare, c.outOfFold.samePassShare]).replace(/ \(.*\)/, "")} of same-work pairs and ${pc([c.outOfFold.differentPassShare, c.outOfFold.differentPassShare, c.outOfFold.differentPassShare]).replace(/ \(.*\)/, "")} of different-work pairs pass the visual test.\n`);
  for (const set of SET_NAMES) {
    const s = m.sets[set];
    out.push(`### ${set === "pilot-000" ? "pilot-000 (real use): machine agreement, never accuracy" : "yardstick (PROXY, library shelves)"}\n`);
    out.push(`${s.photos} photos, ${s.boxCount} boxes, ${s.neighbourPairs} neighbour pairs (${s.neighbourPairsInFrame} in frame). Intervals: 95 % photo bootstrap.\n`);
    out.push("| measure | value |\n|---|---|");
    out.push(`| visually the same | ${s.visuallySame} pairs |`);
    out.push(`| rejected by the series guard | ${s.guardRejected} (${kv(s.guardReasons)}) |`);
    out.push(`| **copy groups per photo** | **${num(s.groups.perPhoto)}** (${s.groups.total} groups in ${s.groups.photosWithGroup} photos) |`);
    out.push(`| groups with a confirmed copy, per photo | ${num(s.groups.identifiedPerPhoto)} (${s.groups.identified}) |`);
    out.push(`| group sizes | ${Object.entries(s.groups.sizes).sort().map(([k, v]) => `${k} copies: ${v}`).join(", ")} |`);
    out.push(`| confirmed boxes (F-0, two readers) | ${s.propagation.confirmedBase}; per photo ${num(s.propagation.confirmedPerPhotoBase)} |`);
    out.push(`| **extra confirmed boxes per photo (confirmed-by-copy)** | **${num(s.propagation.extraConfirmedPerPhoto)}** (${s.propagation.confirmedByCopy} boxes; +${pc(s.propagation.extraConfirmedSharePts, 2).replace(" %", " pts")} of boxes) |`);
    out.push(`| unconfirmed copies not propagated | ${kv(s.propagation.blocked)} |`);
    out.push(`| readers consistent with the work, on propagated copies | ${kv(s.propagation.consistentReaders)} |`);
    const w = s.wrongGroupings;
    out.push(`| neighbours both confirmed: different works | ${pc(w.differentWorkBeforeVisual)} of ${w.bothConfirmedPairs} |`);
    out.push(`| **visually-same neighbours both confirmed: different works** (the visual test's wrong groupings) | **${pc(w.visualDifferentWorkShare)}** of ${w.bothConfirmedVisual}; left after the guard: ${w.afterGuard} |`);
    const v = w.singleReaderViews;
    out.push(`| one-reader views of a confirmed copy: propagated, same work | ${pc(v.sameWork.propagated)} of ${v.sameWork.views} (reader below the bar: ${pc(v.sameWork.weakPropagated)} of ${v.sameWork.weakViews}) |`);
    out.push(`| one-reader views: propagated, different work (wrong) | ${pc(v.differentWork.propagated)} of ${v.differentWork.views} (reader below the bar: ${pc(v.differentWork.weakPropagated)} of ${v.differentWork.weakViews}) |`);
    out.push(`| propagation precision on one-reader views | ${pc(v.precision)} |`);
    const g = s.seriesGuard;
    out.push(`| **hard negatives** (both confirmed, different works, shared author) | ${g.hardNegatives} pairs; visually the same: ${pc(g.visualPassShare)} (other different-work pairs: ${pc(g.otherNegativesVisualPassShare)}) |`);
    out.push(`| hard negatives, full reads: rejected by the guard | ${g.fullReadsRejected} of ${g.hardNegativesVisual} visually same |`);
    out.push(`| **series guard: hard-negative one-reader views blocked** | **${pc(g.viewsAllBlocked)}** of ${g.viewsAll} (visually same only: ${pc(g.viewsVisualBlocked)} of ${g.viewsVisual}; reader below the bar: ${pc(g.weakViewsAllBlocked)} of ${g.weakViewsAll}) |`);
    out.push(`| blocked by | ${kv(g.blockedBy)} |`);
    const k = s.workCounting;
    out.push(`| copies per work on one shelf band (work level, any edition) | ${Object.entries(k.copiesPerWorkOnShelf).sort().map(([a, b]) => `${a}: ${b}`).join(", ")} |`);
    out.push(`| works with two or more copies on a band; of them in more than one copy group or alone (another edition or look) | ${k.worksWithCopies}; ${k.worksWithCopiesInSeveralGroups} |`);
    if (s.yardstick) {
      const y = s.yardstick;
      out.push(`| **yardstick wrong accepts** (accepted work not annotated in the image) | ${y.wrongAcceptsBase} → ${y.wrongAcceptsWith}; per image Δ ${num(y.wrongPerImageDelta)}; share of accepted ${pc(y.wrongShareOfAcceptedBase)} → ${pc(y.wrongShareOfAcceptedWith)} |`);
      out.push(`| boxes labelled a work beyond its annotated copies | ${y.overCountBase} → ${y.overCountWith} |`);
    }
    out.push(`| runtime | appearance p50 ${s.runtime.appearanceSecondsPerPhoto.p50} s a photo (${s.runtime.appearanceSecondsPerPhoto.total} s in all); guard, groups and propagation ${s.runtime.analyseSeconds} s for the set |`);
    out.push("");
  }
  const k = m.keep;
  out.push(`### Keep rule\n\n| part | met |\n|---|---|`);
  out.push(`| pilot-000 confirmed boxes rise, interval excluding 0 | ${k.pilotConfirmedRises ? "yes" : "no"} |`);
  out.push(`| yardstick wrong accepts do not rise beyond their interval | ${k.yardstickWrongNotUp ? "yes" : "no"} |`);
  out.push(`| **ship propagation** | **${k.ship ? "yes" : "no"}** |\n`);
  return out.join("\n") + "\n";
}

// --- render: the private review page -------------------------------------------------------------------------

/** pilot-000 photos, the owner's example photos first (their ids are in the private examples-order.json). */
async function render(): Promise<void> {
  const run = runSet("pilot-000");
  const paths = new Map(imagesOf("pilot-000").map((i) => [i.id, i.path]));
  const firstPath = join(PRIV, "examples-order.json");
  const first: string[] = existsSync(firstPath) ? (JSON.parse(readFileSync(firstPath, "utf8")) as { first: string[] }).first : [];
  const ids = [...run.dets.keys()].sort((a, b) => (first.indexOf(a) + 1 || 999) - (first.indexOf(b) + 1 || 999));
  const lines = ids.map((id, n) => {
    const d = run.dets.get(id)!;
    const groups = run.groups.filter((g) => g.imageId === id);
    const groupOf = new Map<number, number>();
    groups.forEach((g, k) => g.members.forEach((i) => groupOf.set(i, k)));
    const rejected = run.outcomes.filter((o) => o.imageId === id && o.visual && o.guard);
    const title = (w: WorkRef | null | undefined) => (w ? `${w.title} — ${w.authors.join(", ")}` : null);
    return JSON.stringify({
      n: n + 1,
      example: first.includes(id),
      image: paths.get(id),
      spines: d.spines.map((s, i) => {
        const dec = run.decisions.get(`${id}:${i}`);
        const e = run.ev.get(`${id}:${i}`);
        return {
          polygon: s.polygon,
          group: groupOf.get(i) ?? null,
          confirmed: Boolean(run.base.get(`${id}:${i}`)?.accepted),
          byCopy: dec?.basis === "confirmed-by-copy",
          blocked: dec?.blocked ?? null,
          work: title(e?.accepted) ?? (dec?.basis === "confirmed-by-copy" ? title(run.ev.get(dec.from!)?.accepted) : null),
          consistent: dec?.consistent ?? [],
        };
      }),
      groups: groups.map((g) => ({ members: g.members, size: g.members.length })),
      rejected: rejected.map((o) => ({ a: o.n.a, b: o.n.b, reason: o.guard, score: r4(o.score) })),
    });
  });
  const spec = join(stage("pilot-000"), "render.jsonl");
  writeFileSync(spec, lines.join("\n") + "\n");
  const helper = join(REPO, "helpers", "label");
  const out = join(PRIV, "renders", "pilot-000");
  const examples = join(ROOT, "private", "examples");
  const args = ["run", "--project", helper, "python", "-I", join(helper, "render_f0g.py"), "--spec", spec, "--out", out, "--examples", examples];
  await new Promise<void>((resolve, reject) => spawn("uv", args, { stdio: ["ignore", "ignore", "inherit"] }).once("close", (c) => (c === 0 ? resolve() : reject(new Error(`render exited ${c}`)))));
  log("render written under the data root's private/f0g/renders/pilot-000/");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, set, flag] = process.argv.slice(2) as [string, SetName, string?];
  // pairs, evidence, imprint and copies take any declared session (NS-K2) or the yardstick; anything else is refused.
  if (cmd === "pairs") await pairs(acceptSet("F-0g", set));
  else if (cmd === "evidence") evidence(acceptSet("F-0g", set));
  else if (cmd === "copies") copies(acceptSet("F-0g", set));
  else if (cmd === "calibrate") calibrate();
  else if (cmd === "imprint") await imprint(acceptSet("F-0g", set), flag === "--dry-run");
  else if (cmd === "analyse") analyse();
  else if (cmd === "render") await render();
  else {
    console.error("usage: node src/eval/f0g-cli.ts pairs|evidence|copies <session|yardstick> | imprint <set> [--dry-run] | calibrate | analyse | render");
    process.exit(2);
  }
}
