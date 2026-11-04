// Q-3 runner: the gap audit (pre-registered in evals/Q3/report.md). CPU only, from caches.
//
//   node src/eval/q3-cli.ts v2                # F-0's decide on catalog-v2 for pilot-000's text-present/text-read boxes
//   node src/eval/q3-cli.ts audit <set>       # one record per book: stop rung, primary cause, splits (private)
//   node src/eval/q3-cli.ts match             # the owner's labelling-gaps example → its photo (helpers/label, ORB)
//   node src/eval/q3-cli.ts analyse           # evals/Q3/{metrics.json,report.md}: aggregates only
//   node src/eval/q3-cli.ts render            # the data root's private/q3/renders/index.html (private still study)
//
// Sets (OC35, never merged): pilot-000 with F-0e's `bands+strips` boxes, the yardstick with F-0's B2 boxes; both after
// the shipped not-a-book filter and F-0i's partition. Everything per book goes under the data root's `private/q3/`.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogPaths, openCatalog } from "../catalog/cli.ts";
import type { Candidate } from "../catalog/retrieve.ts";
import { dataRoot } from "../ledger/images.ts";
import { makeDerivative } from "../report/index.ts";
import { decide, loadReadings, readJsonl, type Detection, type SpineDecision } from "./f0.ts";
import { kinds, type Kinds } from "./f0c.ts";
import { imagesOf, SETS, type SetName } from "./f0c-cli.ts";
import { evidenceFor } from "./f0f-cli.ts";
import { compactJson, yardstickTruth } from "./q1-cli.ts";
import { clusterBootstrap } from "./q1.ts";
import { RUNGS, type Rung } from "./q2.ts";
import {
  boxCauses,
  CAUSES,
  centroid,
  countCI,
  countOf,
  coverCauses,
  darkHit,
  frameCut,
  gapBooks,
  gapCauses,
  gapPolygon,
  growBand,
  inside,
  lost,
  lowerQuantile,
  Q3,
  radialOf,
  rankCauses,
  RESIDUAL,
  rowLabel,
  shareInside,
  ties,
  type Book,
  type BoxFacts,
  type CauseHit,
  type Count,
  type DarkBar,
  type FramePos,
  type RowLine,
} from "./q3.ts";
import { elevationOf, ELEVATIONS } from "./s1.ts";

type Pt = [number, number];
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const ROOT = dataRoot();
const PRIV = join(ROOT, "private", "q3");
/** Each cache names the sets its own way. */
const NAME: Record<SetName, { f0i: string; s: string }> = {
  "pilot-000": { f0i: "pilot-000", s: "pilot-000" },
  yardstick: { f0i: "yardstick-library-b2", s: "yardstick" },
};
const NAMES: SetName[] = ["pilot-000", "yardstick"];
const REPS = 2000;
/** `--first N`: a smoke run on the first N photos in input order (crashes only, never a measure). */
const FIRST = process.argv.includes("--first") ? Number(process.argv[process.argv.indexOf("--first") + 1]) : undefined;
const log = (s: string): void => console.error(`[q3] ${new Date().toISOString().slice(11, 19)} ${s}`);
const isSet = (s: string | undefined): s is SetName => s === "pilot-000" || s === "yardstick";
const setDir = (set: SetName): string => {
  const d = join(PRIV, set, FIRST ? "smoke" : "");
  mkdirSync(d, { recursive: true });
  return d;
};
const priv = (...p: string[]) => join(ROOT, "private", ...p);
const byId = <T extends { id: string }>(rows: T[]): Map<string, T> => new Map(rows.map((r) => [r.id, r]));
const split = (id: string): [string, number] => {
  const k = id.lastIndexOf(":");
  return [id.slice(0, k), Number(id.slice(k + 1))];
};
const detsOf = (set: SetName): Detection[] => readJsonl<Detection>(join(ROOT, "f0c", set, "detect.jsonl")).filter((d) => !d.error);

// --- cache records (the fields read here) -----------------------------------------------------------------

interface TableRow { id: string; imageId: string; rung: Rung }
interface PartitionRow { id: string; state: "kept" | "dropped" }
interface BaseDecision { id: string; imageId: string; boxScore: number; accepted: { workId: string } | null; reason: BoxFacts["reason"] }
interface Features { id: string; outFrac: number | null; radial: number | null; cut: boolean; lying: boolean; band: number | null; mean: number | null; rmsContrast: number | null }
interface Faces { id: string; shares: Record<string, number> | null; elevationDeg: number | null; ownPlane: boolean }
interface Basis { id: string; basis: string | null; workId: string | null }
interface V2Row { id: string; v2Accept: string | null; v2Pass: boolean; v1Accept: string | null; v1Reason: string | null }
interface ShelfPhoto { id: string; rows: { band: number; skip?: string | null; elevationDeg?: number; voids?: { lengthW: number; booksW: [number, number]; line: Pt[]; zone: [number, number] } }[] }
interface Stretch { from: number; to: number; kind: string; dominant: string; boxShare?: number | null; frontNoBox?: boolean }
interface GapRow { imageId: string; band: number; stretches: Stretch[]; headroomFrontNoBox: unknown[] }

const featuresPath = (set: SetName) => (set === "pilot-000" ? priv("q2b", "features", "pilot-000.jsonl") : priv("q1", "features", "yardstick-library-b2.jsonl"));

// --- v2: F-0's decide on catalog-v2 (pilot-000 only) -------------------------------------------------------

/**
 * F-0's unchanged `decide` on C-5's catalog-v2 for every kept box Q-2b puts at `text-present` or `text-read`, with
 * the default box set's cached readings; v1 again on the same boxes as a reproduction check. Cached under the data root
 * by the catalog files' size and modification time, like C-5's re-decisions.
 */
function v2(): void {
  const set: SetName = "pilot-000";
  const kept = new Set(readJsonl<PartitionRow>(priv("f0i", "pilot-000", "partition.jsonl")).filter((p) => p.state === "kept").map((p) => p.id));
  const rows = readJsonl<TableRow>(priv("q2b", "table", "pilot-000.jsonl")).filter((r) => kept.has(r.id) && (r.rung === "text-present" || r.rung === "text-read"));
  const base = byId(readJsonl<BaseDecision>(priv("h2", "pilot-000", "base-decisions.jsonl")));
  // The default box set's cached readings as F-0c's base decisions read them (F-0e's records name no crop).
  const readings = loadReadings(SETS[set].base);
  const paths = catalogPaths();
  const v1 = openCatalog(SETS[set].catalog), v2db = openCatalog(paths.catalogV2);
  const c1 = new Map<string, Candidate | undefined>(), c2 = new Map<string, Candidate | undefined>();
  const out: string[] = [];
  const t0 = Date.now();
  rows.forEach((r, i) => {
    const b = base.get(r.id)!;
    const reads = readings.get(r.id) ?? {};
    const d1: SpineDecision = decide(v1, r.id, r.imageId, b.boxScore, reads, c1);
    const d2: SpineDecision = decide(v2db, r.id, r.imageId, b.boxScore, reads, c2);
    out.push(JSON.stringify({ id: r.id, v1Accept: d1.accepted?.workId ?? null, v1Reason: d1.reason, v2Accept: d2.accepted?.workId ?? null, v2Pass: Object.values(d2.confirmed).some((w) => !!w) }));
    if ((i + 1) % 250 === 0) log(`v2: ${i + 1}/${rows.length} (${Math.round((Date.now() - t0) / 1000)} s)`);
  });
  v1.close();
  v2db.close();
  writeFileSync(join(setDir(set), "v2.jsonl"), out.join("\n") + "\n");
  log(`v2: ${rows.length} boxes in ${Math.round((Date.now() - t0) / 1000)} s`);
}

// --- audit: one record per book -----------------------------------------------------------------------------

/** A book record with the private detail the render needs (polygon, photo size). Never leaves the data root. */
type BookRec = Book & { polygon: Pt[]; width: number; height: number; reconUnderHalf?: boolean; rowEnd?: boolean };

interface AuditOut {
  books: BookRec[];
  apart: { headroomFrontNoBox: number; coverGaps: number; coverGapBooks: number };
  recon: { n: number; underHalf: number };
  bar: DarkBar;
  v2: { n: number; reproduced: number } | null;
}

const LABEL_FRONT = new Set(["shelf-talker", "blank-card"]);
const SHAPE_WHYS = new Set(["spans-books", "flat-strip", "cover-row", "cover-shape", "cover-group"]);

function audit(set: SetName): AuditOut {
  const n = NAME[set];
  const yard = set === "yardstick";
  let dets = detsOf(set);
  if (FIRST) dets = dets.slice(0, FIRST);
  const ev = evidenceFor(set);
  const kept = new Set(readJsonl<PartitionRow>(priv("f0i", n.f0i, "partition.jsonl")).filter((p) => p.state === "kept").map((p) => p.id));
  const table = byId(readJsonl<TableRow>(priv("q2b", "table", `${n.f0i}.jsonl`)));
  const base = byId(readJsonl<BaseDecision>(priv("h2", n.f0i, "base-decisions.jsonl")));
  const feats = byId(readJsonl<Features>(featuresPath(set)));
  const faces = byId(readJsonl<Faces>(priv("h2", n.f0i, "faces.jsonl")));
  const raised = new Map<string, string>();
  for (const c of readJsonl<Basis>(priv("f0g", n.s, "copies.jsonl"))) if (c.basis === "confirmed-by-copy") raised.set(c.id, c.basis);
  for (const c of readJsonl<Basis>(priv("f0h", n.s, "decisions.jsonl"))) if (c.basis === "confirmed-by-context") raised.set(c.id, c.basis);
  const v2rows = !yard && existsSync(join(PRIV, set, "v2.jsonl")) ? byId(readJsonl<V2Row>(join(PRIV, set, "v2.jsonl"))) : null;
  if (!yard && !v2rows && !FIRST) throw new Error("pilot-000: run `q3-cli.ts v2` first");
  const shelf = byId(readJsonl<ShelfPhoto>(priv("s2", n.s, "shelf.jsonl")));
  const gaps = readJsonl<GapRow>(priv("s2", n.s, "gaps.jsonl"));

  // The dark bar: the 5th percentile of the confirmed (readers-agree) boxes' luma and contrast.
  const conf = [...table.values()].filter((r) => kept.has(r.id) && r.rung === "confirmed").map((r) => feats.get(r.id)).filter((f): f is Features => !!f);
  const bar: DarkBar = {
    luma: lowerQuantile(conf.flatMap((f) => (f.mean === null ? [] : [f.mean])), Q3.darkQuantile) ?? 0,
    contrast: lowerQuantile(conf.flatMap((f) => (f.rmsContrast === null ? [] : [f.rmsContrast])), Q3.darkQuantile) ?? 0,
  };

  const books: BookRec[] = [];
  const recon = { n: 0, underHalf: 0 };
  const apart = { headroomFrontNoBox: 0, coverGaps: 0, coverGapBooks: 0 };
  for (const d of dets) {
    const k: Kinds = kinds(d, ev.get(d.id));
    const W = d.width, H = d.height;
    const keptIdx = d.spines.map((_, i) => i).filter((i) => kept.has(`${d.id}:${i}`));
    const keptPolys = keptIdx.map((i) => d.spines[i]!.polygon as Pt[]);
    const talkers = k.spines.filter((s) => s.kind === "not-a-book" && LABEL_FRONT.has(s.why)).map((s) => s.polygon as Pt[]);
    const covers = k.covers.map((c) => c.polygon as Pt[]);
    const shapeDropped = [...k.spines, ...k.dropped].filter((s) => s.kind === "not-a-book" && SHAPE_WHYS.has(s.why)).map((s) => s.polygon as Pt[]);

    // Rows: S-1's rows with a polyline, placed from the top by the polyline's mean height.
    const sp = shelf.get(d.id);
    const rowsWithLine = (sp?.rows ?? []).filter((r) => !r.skip && r.voids?.line?.length);
    const ordinal = new Map<number, number>();
    [...rowsWithLine].sort((a, b) => meanY(a.voids!.line) - meanY(b.voids!.line)).forEach((r, i) => ordinal.set(r.band, i));
    const rowOf = (band: number | null | undefined) => rowLabel(band == null ? null : (ordinal.get(band) ?? null));

    const boxFacts = new Map<number, { f: Features | undefined; dark: CauseHit | null }>();
    for (const i of keptIdx) {
      const id = `${d.id}:${i}`;
      const t = table.get(id), b = base.get(id), f = feats.get(id), fa = faces.get(id);
      if (!t || !b) throw new Error(`${set}: a kept box with no rung or decision`);
      const poly = d.spines[i]!.polygon as Pt[];
      const basis = raised.get(id);
      const rung: Rung = basis ? "confirmed" : t.rung;
      const absorbed = k.spines[i]!.why === "absorbed";
      const occ: BoxFacts["occludedBy"] = shareInside(poly, talkers) >= Q3.occluded ? "talker" : !absorbed && shareInside(poly, covers) >= Q3.occluded ? "cover" : null;
      const v = v2rows?.get(id);
      const facts: BoxFacts = {
        rung,
        reason: b.reason,
        boxScore: b.boxScore,
        outFrac: f?.outFrac ?? 0,
        radial: f?.radial ?? radialOf(centroid(poly), W, H),
        tileCut: !!f?.cut,
        sideCase: !!fa?.ownPlane,
        lying: !!f?.lying,
        shares: fa?.shares ?? null,
        luma: f?.mean ?? null,
        contrast: f?.rmsContrast ?? null,
        occludedBy: occ,
        faceOutPiece: absorbed,
        v2: v ? { accept: v.v2Accept !== null, pass: v.v2Pass } : null,
      };
      boxFacts.set(i, { f, dark: darkHit(facts.luma, facts.contrast, bar) });
      const all = boxCauses(facts, bar, yard);
      const frame: FramePos = facts.outFrac > 0 ? "cut" : facts.radial > Q3.outerRadial ? "outer" : "centre";
      books.push({
        id, imageId: d.id, kind: "box", books: 1, rung, primary: all[0] ?? null, all,
        elevation: elevationOf(fa?.elevationDeg), case: facts.sideCase ? "side" : "main", frame, row: rowOf(f?.band),
        polygon: poly, width: W, height: H,
      });
    }

    // Undetected books in row gaps.
    const nearest = (p: Pt) => {
      let best: number | null = null, bd = Infinity;
      for (const i of keptIdx) {
        const c = centroid(d.spines[i]!.polygon as Pt[]);
        const dd = Math.hypot(c[0] - p[0], c[1] - p[1]);
        if (dd < bd) (bd = dd), (best = i);
      }
      return best;
    };
    const coverCounted: Pt[][] = [];
    // Face-out covers no kept box stands for.
    k.covers.forEach((c) => {
      if (k.spines.some((s, i) => s.absorbedBy === c.ref && kept.has(`${d.id}:${i}`))) return;
      const poly = c.polygon as Pt[];
      coverCounted.push(poly);
      const cut = frameCut(poly, W, H);
      const all = coverCauses(cut);
      const nb = nearest(centroid(poly));
      const nid = nb === null ? null : `${d.id}:${nb}`;
      books.push({
        id: `${d.id}:${c.ref}`, imageId: d.id, kind: "face-out", books: 1, rung: "seen", primary: all[0]!, all,
        elevation: elevationOf(nid ? faces.get(nid)?.elevationDeg : null), case: nid && faces.get(nid)?.ownPlane ? "side" : "main",
        frame: cut ? "cut" : radialOf(centroid(poly), W, H) > Q3.outerRadial ? "outer" : "centre", row: rowOf(nid ? feats.get(nid)?.band : null),
        polygon: poly, width: W, height: H,
      });
    });

    const bandsGrown = d.bands.map((b) => growBand(b.polygon as Pt[], Q3.bandGrow));
    for (const g of gaps.filter((x) => x.imageId === d.id)) {
      apart.headroomFrontNoBox += g.headroomFrontNoBox.length;
      const row = rowsWithLine.find((r) => r.band === g.band);
      g.stretches.forEach((s, j) => {
        if (s.kind === "outline-gap" && s.dominant === "cover" && (s.boxShare ?? 1) < 0.5) (apart.coverGaps += 1), (apart.coverGapBooks += gapBooks(s.from, s.to));
        if (!s.frontNoBox) return;
        if (!row) throw new Error(`${set}: a gap in a row with no polyline`);
        const rl: RowLine = { line: row.voids!.line, zone: row.voids!.zone, booksW0: row.voids!.booksW[0], mw: d.gaps.medianWidth };
        const poly = gapPolygon(rl, s.from, s.to);
        const c = centroid(poly);
        if (coverCounted.some((cv) => inside(cv, c))) return;
        recon.n += 1;
        const underHalf = shareInside(poly, keptPolys) < 0.5;
        if (underHalf) recon.underHalf += 1;
        // The nearest kept boxes of this band before and after the gap, along the polyline's direction.
        const dir = unit(sub(row.voids!.line.at(-1)!, row.voids!.line[0]!));
        const along = (p: Pt) => p[0] * dir[0] + p[1] * dir[1];
        const g0 = Math.min(along(poly[0]!), along(poly[1]!)), g1 = Math.max(along(poly[0]!), along(poly[1]!));
        let before: number | null = null, after: number | null = null, bBest = -Infinity, aBest = Infinity;
        for (const i of keptIdx) {
          if (boxFacts.get(i)?.f?.band !== g.band) continue;
          const a = along(centroid(d.spines[i]!.polygon as Pt[]));
          if (a <= g0 && a > bBest) (bBest = a), (before = i);
          if (a >= g1 && a < aBest) (aBest = a), (after = i);
        }
        const db = before === null ? null : boxFacts.get(before)!.dark, da = after === null ? null : boxFacts.get(after)!.dark;
        const cut = frameCut(poly, W, H);
        const outer = radialOf(c, W, H) > Q3.outerRadial;
        const all = gapCauses({
          frameCut: cut,
          outer,
          occludedBy: shareInside(poly, talkers) >= Q3.occluded ? "talker" : shareInside(poly, covers) >= Q3.occluded ? "cover" : null,
          droppedShape: shareInside(poly, shapeDropped) >= Q3.droppedShape,
          noBandTile: !bandsGrown.some((b) => inside(b, c)),
          darkNeighbours: db && da ? db : null,
        });
        books.push({
          id: `${d.id}:b${g.band}:g${j}`, imageId: d.id, kind: "gap", books: gapBooks(s.from, s.to), rung: "seen", primary: all[0]!, all,
          elevation: elevationOf(row.elevationDeg), case: "main", frame: cut ? "cut" : outer ? "outer" : "centre", row: rowOf(g.band),
          polygon: poly, width: W, height: H, reconUnderHalf: underHalf,
          // Within a width of the row's end: on the owner's example, the case's upright beside a leaning end book (reported only).
          rowEnd: s.from < 1 || s.to > row.voids!.lengthW - 1,
        });
      });
    }
  }
  const v2Stats = v2rows
    ? { n: v2rows.size, reproduced: [...v2rows.values()].filter((v) => v.v1Accept === (base.get(v.id)?.accepted?.workId ?? null) && v.v1Reason === base.get(v.id)?.reason).length }
    : null;
  const dir = setDir(set);
  writeFileSync(join(dir, "books.jsonl"), books.map((b) => JSON.stringify(b)).join("\n") + "\n");
  writeFileSync(join(dir, "audit.json"), JSON.stringify({ apart, recon, bar, v2: v2Stats }));
  log(`${set}: ${books.length} records, ${countOf(() => true)(books)} books, ${countOf(lost)(books)} lost`);
  return { books, apart, recon, bar, v2: v2Stats };
}

const meanY = (line: Pt[]) => line.reduce((s, p) => s + p[1], 0) / line.length;
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const unit = (a: Pt): Pt => {
  const l = Math.hypot(a[0], a[1]) || 1;
  return [a[0] / l, a[1] / l];
};

// --- match: the owner's labelling-gaps example → its photo ------------------------------------------------

const EXAMPLE = "owner-2026-11-03-labelling-gaps.webp";

function match(): void {
  const dir = join(PRIV, "examples");
  mkdirSync(dir, { recursive: true });
  const photos = join(dir, "photos.jsonl");
  writeFileSync(photos, imagesOf("pilot-000").map((i) => JSON.stringify({ id: `pilot-000|${i.id}`, path: i.path })).join("\n") + "\n");
  const py = join(REPO, "helpers", "label", ".venv", "bin", "python");
  if (!existsSync(py)) throw new Error("helpers/label has no .venv: run `uv sync` there first");
  const r = spawnSync(py, ["-I", join(REPO, "helpers", "label", "match_examples.py"), "--photos", photos, "--examples", priv("examples", EXAMPLE)], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (r.status !== 0) throw new Error("match_examples.py failed");
  writeFileSync(join(dir, "matches.json"), r.stdout);
  const m = (JSON.parse(r.stdout) as { first: { inliers: number; runnerUp: number }[] }).first[0]!;
  log(`match: ${m.inliers} inliers against the runner-up's ${m.runnerUp}`);
}

// --- analyse: aggregates only -------------------------------------------------------------------------------

const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const cnt = (c: Count) => ({ n: r1(c.n), lo: r1(c.lo), hi: r1(c.hi) });
const SPLITS = {
  elevation: [...ELEVATIONS, null] as (string | null)[],
  case: ["main", "side"],
  frame: ["centre", "outer", "cut"],
  row: ["0", "1", "2", "3", "4", "5", "6+", "none"],
} as const;
type SplitKey = keyof typeof SPLITS;

function analyseSet(set: SetName) {
  const dir = join(PRIV, set);
  const books = readJsonl<BookRec>(join(dir, "books.jsonl"));
  const extra = JSON.parse(readFileSync(join(dir, "audit.json"), "utf8")) as Omit<AuditOut, "books">;
  const photos = new Set(books.map((b) => b.imageId)).size;
  const total = countCI(books, () => true, REPS, 1);
  const lostAll = countCI(books, lost, REPS, 2);
  const byKind = Object.fromEntries((["box", "gap", "face-out"] as const).map((k) => [k, countOf((b) => b.kind === k)(books)]));
  const rungs = Object.fromEntries(RUNGS.map((r, i) => [r, cnt(countCI(books, (b) => b.rung === r, REPS, 10 + i))]));
  const ranked = rankCauses(books, REPS, 100).map((r) => ({ cause: r.cause, residual: RESIDUAL.has(r.cause), lost: cnt(r.lost), share: r3(r.share), any: r.any }));
  // Rung × primary cause.
  const cells: Record<string, Record<string, number>> = {};
  for (const r of RUNGS.slice(1, -1)) cells[r] = Object.fromEntries(CAUSES.map((c) => [c, countOf((b) => b.rung === r && b.primary?.cause === c)(books)]).filter(([, v]) => (v as number) > 0));
  // Sub-reasons per cause.
  const subs: Record<string, Record<string, number>> = {};
  for (const b of books.filter(lost)) {
    const c = b.primary!.cause, s = b.primary!.sub ?? "—";
    (subs[c] ??= {})[s] = (subs[c]![s] ?? 0) + b.books;
  }
  // Splits: books, lost, and lost by primary cause per value.
  const splits: Record<string, Record<string, { books: number; lost: number; causes: Record<string, number> }>> = {};
  for (const key of Object.keys(SPLITS) as SplitKey[]) {
    splits[key] = {};
    for (const v of SPLITS[key]) {
      const rows = books.filter((b) => (b[key] ?? null) === v);
      if (rows.length === 0) continue;
      splits[key]![String(v ?? "unknown")] = {
        books: countOf(() => true)(rows),
        lost: countOf(lost)(rows),
        causes: Object.fromEntries(CAUSES.map((c) => [c, countOf((b) => lost(b) && b.primary?.cause === c)(rows)]).filter(([, n]) => (n as number) > 0)),
      };
    }
  }
  return {
    set,
    scope: SETS[set].scope,
    photos,
    books: cnt(total),
    perPhoto: r1(total.n / photos),
    lost: cnt(lostAll),
    lostShare: r3(lostAll.n / total.n),
    byKind,
    rungs,
    ranked,
    cells,
    subs,
    splits,
    darkBar: { luma: r1(extra.bar.luma), contrast: r1(extra.bar.contrast) },
    reconstruction: { gaps: extra.recon.n, underHalfInKeptBoxes: extra.recon.underHalf, share: extra.recon.n ? r3(extra.recon.underHalf / extra.recon.n) : null },
    apart: { ...extra.apart, rowEndGapBooks: countOf((b) => b.kind === "gap" && !!(b as BookRec).rowEnd)(books) },
    v2: extra.v2 ? { reDecided: extra.v2.n, v1Reproduced: r3(extra.v2.reproduced / extra.v2.n) } : null,
  };
}

/** The yardstick's reference: annotated books (in its inventory) against distinct annotated works accepted. */
function yardstickReference() {
  const truth = yardstickTruth();
  const n = NAME.yardstick;
  const kept = new Set(readJsonl<PartitionRow>(priv("f0i", n.f0i, "partition.jsonl")).filter((p) => p.state === "kept").map((p) => p.id));
  const accepted = new Map<string, Set<string>>();
  const add = (id: string, w: string | null | undefined) => {
    if (!w || !kept.has(id)) return;
    const img = split(id)[0];
    (accepted.get(img) ?? accepted.set(img, new Set()).get(img)!).add(w);
  };
  for (const b of readJsonl<BaseDecision>(priv("h2", n.f0i, "base-decisions.jsonl"))) add(b.id, b.accepted?.workId);
  for (const c of readJsonl<Basis>(priv("f0g", n.s, "copies.jsonl"))) if (c.basis === "confirmed-by-copy") add(c.id, c.workId);
  for (const c of readJsonl<Basis>(priv("f0h", n.s, "decisions.jsonl"))) if (c.basis === "confirmed-by-context") add(c.id, c.workId);
  // The sample's images only: the annotation file covers the whole dataset.
  const sample = new Set(detsOf("yardstick").map((d) => d.id));
  const rows = [...truth.entries()].filter(([img]) => sample.has(img)).map(([img, works]) => ({ imageId: img, annotated: works.size, found: [...(accepted.get(img) ?? [])].filter((w) => works.has(w)).length }));
  const sum = (k: "annotated" | "found") => (rs: typeof rows) => rs.reduce((s, r) => s + r[k], 0);
  const ann = clusterBootstrap(rows, sum("annotated"), REPS, 7)!, found = clusterBootstrap(rows, sum("found"), REPS, 8)!;
  const lostR = clusterBootstrap(rows, (rs) => sum("annotated")(rs) - sum("found")(rs), REPS, 9)!;
  return { images: rows.length, annotated: ann.value, found: found.value, lost: { n: lostR.value, lo: lostR.lo, hi: lostR.hi }, foundShare: r3(found.value / ann.value) };
}

function analyse(): void {
  const sets = Object.fromEntries(NAMES.map((s) => [s, analyseSet(s)]));
  const m = {
    card: "Q-3",
    question: "for every book a person can see, the coverage rung where the machine stopped and the primary cause; causes ranked by books lost",
    baseline: "F-0i's partition (#51); re-run after F-0m, F-0k and NB-3 change the box set",
    constants: Q3,
    sets,
    yardstickReference: yardstickReference(),
  };
  const out = join(REPO, "evals", "Q3");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "metrics.json"), compactJson(m) + "\n");
  const rp = join(out, "report.md");
  const MARK = "<!-- generated by src/eval/q3-cli.ts analyse: edit above this line -->";
  const text = readFileSync(rp, "utf8");
  const head = text.includes(MARK) ? text.slice(0, text.indexOf(MARK)) : text.trimEnd() + "\n\n";
  writeFileSync(rp, head + MARK + "\n\n" + tablesMd(m));
  log("analyse: evals/Q3/{metrics.json,report.md}");
}

type Metrics = ReturnType<typeof analyseSet>;
const ci = (c: { n: number; lo: number; hi: number }) => `${c.n} (${c.lo}–${c.hi})`;
const pct = (x: number) => `${r1(x * 100)} %`;

function tablesMd(m: { sets: Record<string, Metrics>; yardstickReference: ReturnType<typeof yardstickReference> }): string {
  const out: string[] = [];
  for (const s of Object.values(m.sets)) {
    out.push(`## ${s.set} (${s.scope})\n`);
    out.push(`${s.photos} photos. **${ci(s.books)} books** a person can see by the pre-registered count (${s.perPhoto} a photo): ${s.byKind.box} kept boxes, ${s.byKind.gap} in row gaps with no box, ${s.byKind["face-out"]} face-out covers the default does not box. **Lost (below \`confirmed\`): ${ci(s.lost)}, ${pct(s.lostShare)}.** Counts with 95 % photo-cluster bootstrap intervals (${REPS} draws).\n`);
    out.push("### Books by stop rung\n");
    out.push("| rung | books |\n|---|---:|");
    for (const r of RUNGS) out.push(`| \`${r}\` | ${ci(s.rungs[r]!)} |`);
    out.push("\n### Causes ranked by books lost (primary cause)\n");
    out.push("| rank | cause | books lost | share of lost | any cause (held at all) | tie with the next? |\n|---:|---|---:|---:|---:|---|");
    s.ranked.forEach((r, i) => {
      const next = s.ranked[i + 1];
      out.push(`| ${i + 1} | \`${r.cause}\`${r.residual ? " †" : ""} | ${ci(r.lost)} | ${pct(r.share)} | ${r.any} | ${next ? (ties(r.lost, next.lost) ? "yes" : "no") : "—"} |`);
    });
    out.push("\n† a residual of the audit, not a cause a card works on.\n");
    out.push("### Rung × primary cause (books)\n");
    const used = CAUSES.filter((c) => Object.values(s.cells).some((row) => (row[c] ?? 0) > 0));
    out.push(`| rung | ${used.map((c) => `\`${c}\``).join(" | ")} |\n|---|${used.map(() => "---:").join("|")}|`);
    for (const [r, row] of Object.entries(s.cells)) out.push(`| \`${r}\` | ${used.map((c) => row[c] ?? 0).join(" | ")} |`);
    out.push("\n### Sub-reasons of the primary cause (books)\n");
    out.push("| cause | sub-reasons |\n|---|---|");
    for (const c of CAUSES) if (s.subs[c]) out.push(`| \`${c}\` | ${Object.entries(s.subs[c]!).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")} |`);
    for (const key of Object.keys(SPLITS) as SplitKey[]) {
      const sp = s.splits[key]!;
      const vals = Object.keys(sp);
      const top = s.ranked.filter((r) => !r.residual).slice(0, 6).map((r) => r.cause);
      out.push(`\n### Split by ${key === "row" ? "S-1 row (from the top)" : key === "frame" ? "frame position" : key}\n`);
      out.push(`| ${key} | books | lost | lost share | ${top.map((c) => `\`${c}\``).join(" | ")} |\n|---|---:|---:|---:|${top.map(() => "---:").join("|")}|`);
      for (const v of vals) {
        const x = sp[v]!;
        out.push(`| ${v} | ${x.books} | ${x.lost} | ${x.books ? pct(x.lost / x.books) : "—"} | ${top.map((c) => x.causes[c] ?? 0).join(" | ")} |`);
      }
    }
    out.push("\n### Reported, not in a rule\n");
    out.push("| measure | value |\n|---|---|");
    out.push(`| dark bar (p5 of confirmed boxes): luma / RMS contrast | ${s.darkBar.luma} / ${s.darkBar.contrast} |`);
    out.push(`| gap reconstruction: \`frontNoBox\` stretches whose rebuilt polygon is under half inside kept boxes | ${s.reconstruction.underHalfInKeptBoxes} of ${s.reconstruction.gaps}${s.reconstruction.share === null ? "" : ` (${pct(s.reconstruction.share)})`} |`);
    out.push(`| gap books within one width of their row's end (in the headline; on the owner's example these were the case's uprights) | ${s.apart.rowEndGapBooks} of ${s.byKind.gap} |`);
    out.push(`| apart: S-2 \`headroomFrontNoBox\` regions | ${s.apart.headroomFrontNoBox} |`);
    out.push(`| apart: \`cover\`-dominant outline gaps under half in any box (books by the gap rule) | ${s.apart.coverGaps} (${s.apart.coverGapBooks}) |`);
    if (s.v2) out.push(`| catalog-v2 re-decision: boxes / v1 decisions reproduced | ${s.v2.reDecided} / ${pct(s.v2.v1Reproduced)} |`);
    out.push("");
  }
  const y = m.yardstickReference;
  out.push("## Yardstick reference (annotated books; PROXY)\n");
  out.push(`${y.images} images, ${y.annotated} annotated books in the inventory, ${y.found} distinct annotated works accepted (${pct(y.foundShare)}); **${ci({ n: y.lost.n, lo: r1(y.lost.lo), hi: r1(y.lost.hi) })} annotated books not found**. Annotations carry no positions, so these books get no rung.\n`);
  return out.join("\n");
}

// --- render: the private still study ------------------------------------------------------------------------

const RUNG_COLOUR: Record<Rung, string> = {
  "not-seen": "#888",
  seen: "#ff2bd6",
  "spine-found": "#ff3b30",
  "text-present": "#ff9500",
  "text-read": "#ffd60a",
  matched: "#5ac8fa",
  confirmed: "#34c759",
};

function render(): void {
  const set: SetName = "pilot-000";
  const books = readJsonl<BookRec>(join(PRIV, set, "books.jsonl"));
  const out = join(PRIV, "renders");
  mkdirSync(join(out, "img"), { recursive: true });
  const imgs = new Map(imagesOf(set).map((i) => [i.id, i.path]));
  const derived = new Map<string, { file: string; width: number; height: number }>();
  const derivative = (id: string, W: number, H: number) => {
    if (!derived.has(id)) {
      const file = `img/p${derived.size}.jpg`;
      const size = existsSync(join(out, file)) ? null : makeDerivative(imgs.get(id)!, join(out, file), { width: W, height: H }, 2400);
      derived.set(id, { file, ...(size ?? { width: Math.round((W * 2400) / Math.max(W, H)), height: Math.round((H * 2400) / Math.max(W, H)) }) });
    }
    return derived.get(id)!;
  };
  const figure = (id: string, only: ((b: BookRec) => boolean) | null, title: string) => {
    const bs = books.filter((b) => b.imageId === id);
    if (bs.length === 0) return "";
    const W = bs[0]!.width, H = bs[0]!.height;
    const d = derivative(id, W, H);
    const s = d.width / W;
    const shapes = bs
      .filter((b) => !only || only(b))
      .map((b) => {
        const pts = b.polygon.map(([x, y]) => `${r1(x * s)},${r1(y * s)}`).join(" ");
        const c = centroid(b.polygon);
        const lab = b.primary ? `${b.primary.cause}${b.primary.sub ? `:${b.primary.sub}` : ""}` : "";
        const dash = b.kind === "box" ? "" : ' stroke-dasharray="6 4"';
        return `<polygon points="${pts}" fill="${RUNG_COLOUR[b.rung]}" fill-opacity="${b.rung === "confirmed" ? 0.08 : 0.22}" stroke="${RUNG_COLOUR[b.rung]}" stroke-width="2"${dash}><title>${b.rung} ${lab}</title></polygon>` +
          (b.rung === "confirmed" ? "" : `<text x="${r1(c[0] * s)}" y="${r1(c[1] * s)}" font-size="11" fill="#fff" stroke="#000" stroke-width="0.6" text-anchor="middle">${lab}</text>`);
      })
      .join("");
    return `<figure><figcaption>${title}</figcaption><svg viewBox="0 0 ${d.width} ${d.height}" width="100%"><image href="${d.file}" width="${d.width}" height="${d.height}"/>${shapes}</svg></figure>`;
  };
  const sections: string[] = [];
  // 1. The owner's labelling-gaps example, beside its matched photo.
  const mPath = join(PRIV, "examples", "matches.json");
  if (existsSync(mPath)) {
    const m = (JSON.parse(readFileSync(mPath, "utf8")) as { first: { id: string; inliers: number; runnerUp: number }[] }).first[0]!;
    copyFileSync(priv("examples", EXAMPLE), join(out, "img", "example.webp"));
    const id = m.id.replace(/^pilot-000\|/, "");
    const bs = books.filter((b) => b.imageId === id);
    const tally = RUNGS.map((r) => `${r} ${countOf((b) => b.rung === r)(bs)}`).join(" · ");
    const causes = CAUSES.map((c) => [c, countOf((b) => lost(b) && b.primary?.cause === c)(bs)] as const).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(" · ");
    sections.push(`<section><h2>1. The owner's labelling-gaps example</h2><p>Matched by ORB: ${m.inliers} inliers against ${m.runnerUp}. Books here by stop rung: ${tally}. Lost by primary cause: ${causes}.</p><figure><figcaption>The owner's example</figcaption><img src="img/example.webp" width="100%"></figure>${figure(id, null, "Every book on the matched photo: fill by stop rung, label = primary cause (dashed = no box: a gap or a face-out cover)")}</section>`);
  }
  // 2. The worst causes: for each of the five largest (residuals aside), the three photos where it loses most books.
  const ranked = rankCauses(books, 200, 1).filter((r) => !RESIDUAL.has(r.cause)).slice(0, 5);
  ranked.forEach((r, i) => {
    const per = new Map<string, number>();
    for (const b of books) if (lost(b) && b.primary?.cause === r.cause) per.set(b.imageId, (per.get(b.imageId) ?? 0) + b.books);
    const top = [...per.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    sections.push(`<section><h2>${i + 2}. ${r.cause}: ${r1(r.lost.n)} books lost</h2>${top.map(([id, n]) => figure(id, (b) => lost(b) && b.primary?.cause === r.cause, `${n} books lost to ${r.cause} on this photo`)).join("")}</section>`);
  });
  const legend = RUNGS.slice(1).map((r) => `<span style="background:${RUNG_COLOUR[r]};padding:2px 6px;margin-right:4px;color:#000">${r}</span>`).join("");
  writeFileSync(join(out, "index.html"), `<!doctype html><meta charset="utf-8"><title>Q-3 gap audit (private)</title><style>body{font:14px system-ui;margin:16px;background:#111;color:#eee}figure{margin:12px 0}figcaption{margin:4px 0}</style><h1>Q-3 gap audit, pilot-000 (private: photos and ids)</h1><p>${legend}</p>${sections.join("\n")}`);
  log("render under the data root's private/q3/renders/index.html");
}

// --- main -----------------------------------------------------------------------------------------------------

async function main(argv: string[]): Promise<number> {
  const [cmd, a] = argv;
  if (cmd === "v2") return v2(), 0;
  if (cmd === "audit" && isSet(a)) return audit(a), 0;
  if (cmd === "match") return match(), 0;
  if (cmd === "analyse") return analyse(), 0;
  if (cmd === "render") return render(), 0;
  console.error("usage: node src/eval/q3-cli.ts <v2 | audit <pilot-000|yardstick> | match | analyse | render> [--first N]");
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e: unknown) => {
    console.error(`[q3] ${(e as Error).message}`);
    process.exit(1);
  });
}
