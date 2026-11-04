// S-1 runner: shelf planes, voids and the geometric `on-lip` label test, from H-2's cached depth stage
// (pre-registered in evals/S1/report.md).
//
//   node src/eval/s1-cli.ts stage <set>             # helpers/depth/stage.py on H-2's cache: keys per photo (all hits)
//   node src/eval/s1-cli.ts shelf <set> [--only N]  # helpers/shelf/shelf.py: planes, voids, lip features per photo
//   node src/eval/s1-cli.ts segment <set>           # prior art: OneFormer (ADE20K) and SAM 3 "shelf" masks (GPU)
//   node src/eval/s1-cli.ts spot                    # the pre-registered blind spot-check sheet (pilot-000, private)
//   node src/eval/s1-cli.ts analyse                 # evals/S1/{metrics.json,report.md}: aggregates only
//   node src/eval/s1-cli.ts render <set>            # the data root's private/s1/renders/ (private still study)
//
// Sets (OC35, never merged): pilot-000 with F-0e's `bands+strips` boxes and Q-2b's SAM 2.1 outlines; the yardstick
// with F-0's B2 boxes (no outlines: boxes stand in). Both after the shipped not-a-book filter (F-0c's shapes, F-0f's
// shelf labels). Everything per photo or box goes under the data root's `private/s1/`.
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { openCatalog } from "../catalog/cli.ts";
import type { Candidate } from "../catalog/retrieve.ts";
import { dataRoot } from "../ledger/images.ts";
import { COVER_CROP } from "../perceive/crop.ts";
import { decide, loadReadings, readJsonl, type Detection, type Reading, type ReaderName } from "./f0.ts";
import { coverReading, kinds } from "./f0c.ts";
import { imagesOf, meanCI, SETS, type SetName, type Slim } from "./f0c-cli.ts";
import { agreementChange, titleDelta, type RungCounts, type Tri } from "./f0e.ts";
import { evidenceFor } from "./f0f-cli.ts";
import { loadBoxSet, pilotOutlines, preRb1 } from "./rb1.ts";
import { compactJson, yardstickTruth } from "./q1-cli.ts";
import { clusterBootstrap, quantile, rate, rng } from "./q1.ts";
import { applyOnLip, ELEVATIONS, spearman, elevationOf, impliedScale, onLip, ON_LIP, PITCH, pitches, STANDARD_SHELF, type Elevation, type LipFeatures, type ShelfRow } from "./s1.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const ROOT = dataRoot();
const PRIV = join(ROOT, "private", "s1");
const H2_CACHE = join(ROOT, "private", "h2", "cache");
const log = (s: string): void => console.error(`[s1] ${s}`);
const NAMES: SetName[] = ["pilot-000", "yardstick"];
const PLANES = ["board", "lip", "back"] as const;
const isSet = (s: string | undefined): s is SetName => s === "pilot-000" || s === "yardstick";
const py = (helper: string) => join(REPO, "helpers", helper, ".venv", "bin", "python");

const loadDets = (path: string): Map<string, Detection> => new Map(readJsonl<Detection>(path).filter((d) => !d.error).map((d) => [d.id, d]));
/** F-0c's detections: the base's spines and bands verbatim, plus the cover pass's boxes. */
const detsOf = (set: SetName) => loadDets(join(ROOT, "f0c", set, "detect.jsonl"));

// --- stage: the depth stage's keys per photo, from H-2's cache --------------------------------------------

function stage(set: SetName): void {
  if (!existsSync(py("depth"))) throw new Error("helpers/depth has no .venv: run `uv sync` there first");
  const dir = join(PRIV, set);
  mkdirSync(dir, { recursive: true });
  const images = join(dir, "images.jsonl");
  writeFileSync(images, imagesOf(set).map((i) => JSON.stringify({ id: i.id, image: i.path })).join("\n") + "\n");
  const out = join(dir, "stage.jsonl");
  const fd = openSync(out, "w");
  // The same detections and options as H-2, so its keys decide what is reused (helpers/depth/README.md).
  const r = spawnSync(py("depth"), ["-I", join(REPO, "helpers", "depth", "stage.py"), "--images", images, "--detect", join(SETS[set].base, "detect.jsonl"), "--cache", H2_CACHE, "--exif-fov"], {
    stdio: ["ignore", fd, "inherit"],
  });
  closeSync(fd);
  if (r.status !== 0) throw new Error(`stage.py failed on ${set}`);
  const photos = readJsonl<{ photo?: boolean; hit?: { geometry: boolean; faces: boolean } }>(out).filter((x) => x.photo);
  const misses = photos.filter((p) => !p.hit?.geometry || !p.hit?.faces).length;
  log(`${set}: ${photos.length} photos, ${misses} cache misses`);
}

interface StagePhoto {
  id: string;
  photo: true;
  geometryKey: string;
  facesKey: string;
}

function stagePhotos(set: SetName): Map<string, StagePhoto> {
  const path = join(PRIV, set, "stage.jsonl");
  if (!existsSync(path)) throw new Error(`${set}: run \`s1-cli.ts stage ${set}\` first`);
  return new Map(readJsonl<StagePhoto & { photo?: boolean }>(path).filter((x) => x.photo).map((x) => [x.id, x]));
}

const geometryDir = () => {
  const g = join(H2_CACHE, "geometry");
  const dirs = readdirSync(g).filter((d) => d.startsWith("moge-2-vitl-normal@"));
  if (dirs.length !== 1) throw new Error("expected one MoGe-2 revision in H-2's cache");
  return join(g, dirs[0]!);
};

// --- shelf: planes, voids and lip features per photo ------------------------------------------------------

/**
 * Each kept pilot-000 box's own outline, by `<photo>:<box>`: F-0i's exclusive outline on RB-1's box set (Q-2b's SAM 2.1
 * outline with `--box-set pre-rb1`); the yardstick has none (boxes stand in).
 */
function outlines(set: SetName): Map<string, [number, number][]> {
  if (set !== "pilot-000") return new Map();
  const rows = pilotOutlines(ROOT);
  return new Map(rows.filter((r) => r.outline && r.outline.length >= 3).map((r) => [r.id, r.outline!]));
}

function shelf(set: SetName, only?: number): void {
  if (!existsSync(py("depth"))) throw new Error("helpers/depth has no .venv: run `uv sync` there first");
  const dets = detsOf(set);
  const keys = stagePhotos(set);
  const ev = evidenceFor(set);
  const outs = outlines(set);
  // RB-1's box set for the books that cover a row: the boxes F-0i's partition drops and NB-3's `on-lip` boxes are not
  // kept. The on-lip test itself (`flags`) still runs on the shipped kinds, as pre-registered.
  const keeps = preRb1() ? () => true : loadBoxSet(set).keeps;
  const gdir = geometryDir();
  const dir = join(PRIV, set);
  const lines: string[] = [];
  for (const d of dets.values()) {
    const k = keys.get(d.id);
    if (!k) continue;
    const kd = kinds({ ...d, covers: [] }, ev.get(d.id));
    const ol: Record<number, [number, number][]> = {};
    d.spines.forEach((_, i) => {
      const o = outs.get(`${d.id}:${i}`);
      if (o) ol[i] = o;
    });
    lines.push(
      JSON.stringify({
        id: d.id,
        width: d.width,
        height: d.height,
        npz: join(gdir, `${k.geometryKey}.npz`),
        faces: join(H2_CACHE, "faces", k.geometryKey, `${k.facesKey}.json`),
        classmap: join(H2_CACHE, "faces", k.geometryKey, `${k.facesKey}.png`),
        spines: d.spines.map((s, i) => ({ polygon: s.polygon, kept: kd.spines[i]!.kind === "spine" && keeps(`${d.id}:${i}`), why: kd.spines[i]!.why })),
        outlines: ol,
        covers: (d.covers ?? []).map((c) => ({ polygon: c.polygon })),
        bands: d.bands.map((b) => ({ polygon: b.polygon })),
        medianWidth: d.gaps.medianWidth,
      }),
    );
    if (only && lines.length >= only) break;
  }
  const inputs = join(dir, "inputs.jsonl");
  writeFileSync(inputs, lines.join("\n") + "\n");
  const out = join(dir, only ? "shelf-dev.jsonl" : "shelf.jsonl");
  const fd = openSync(out, "w");
  log(`${set}: shelf structure over ${lines.length} photos`);
  const r = spawnSync(py("depth"), ["-I", join(REPO, "helpers", "shelf", "shelf.py"), "--inputs", inputs, "--maps", join(dir, "maps")], { stdio: ["ignore", fd, "inherit"] });
  closeSync(fd);
  if (r.status !== 0) throw new Error(`shelf.py failed on ${set}`);
}

// --- flags: the on-lip post step on each set's kinds ----------------------------------------------------

interface ShelfOut {
  id: string;
  rows: (ShelfRow & { planes?: Record<string, { found: boolean; inliers: number; rmsM?: number | null }>; voids?: Voids })[];
  boxes: (LipFeatures | null)[];
  covers: (LipFeatures | null)[];
  seconds: number;
}
interface Stretch {
  from: number;
  to: number;
  kind: "void" | "outline-gap" | "behind-under-outline";
  behind: number | null;
  dominant?: string;
  where?: "end" | "interior";
}
interface Voids {
  lengthW: number;
  uncoveredW: number;
  behindW: number;
  stretches: Stretch[];
  under: Stretch[];
}

const LABEL_WHYS = new Set(["shelf-strip", "shelf-talker", "blank-card"]);

function shelfOut(set: SetName): Map<string, ShelfOut> {
  const path = join(PRIV, set, "shelf.jsonl");
  if (!existsSync(path)) throw new Error(`${set}: run \`s1-cli.ts shelf ${set}\` first`);
  return new Map(readJsonl<ShelfOut>(path).map((x) => [x.id, x]));
}

interface PhotoFlags {
  id: string;
  /** Spine-path boxes the shipped kinds keep that on-lip removes. */
  onLip: number[];
  /** F-0c's kept covers (cover arm, F-0f on) that on-lip removes, by cover index. */
  onLipCovers: number[];
  /** Spine-path boxes F-0f's label rules flag. */
  f0f: number[];
  /** Every spine-path box the shipped kinds drop (F-0c and F-0f). */
  filtered: number[];
  /** on-lip evaluated on every spine-path box and every cover F-0c keeps, for the 2 x 2 against F-0f. */
  onLipAll: number[];
  onLipAllCovers: number[];
  f0fCovers: number[];
  coversF0c: number[];
}

function flagsOf(set: SetName): PhotoFlags[] {
  const dets = detsOf(set);
  const shelfRows = shelfOut(set);
  const ev = evidenceFor(set);
  const out: PhotoFlags[] = [];
  for (const d of dets.values()) {
    const sh = shelfRows.get(d.id);
    if (!sh) continue;
    const k1 = kinds({ ...d, covers: [] }, ev.get(d.id));
    const s = applyOnLip(k1, d, sh.boxes);
    const c0 = kinds(d);
    const c1 = kinds(d, ev.get(d.id));
    const sc = applyOnLip(c1, d, sh.boxes, sh.covers);
    const idx = (ref: string) => Number(ref.slice(1));
    out.push({
      id: d.id,
      onLip: s.spines.flatMap((b, i) => (b.why === "on-lip" ? [i] : [])),
      onLipCovers: sc.covers.flatMap((c) => (c.why === "on-lip" ? [idx(c.ref)] : [])),
      f0f: k1.spines.flatMap((b, i) => (LABEL_WHYS.has(b.why) ? [i] : [])),
      filtered: k1.spines.flatMap((b, i) => (b.kind !== "spine" ? [i] : [])),
      onLipAll: d.spines.flatMap((sp, i) => (onLip(sp.polygon, sh.boxes[i], d) ? [i] : [])),
      onLipAllCovers: c0.covers.flatMap((c) => (onLip(c.polygon, sh.covers[idx(c.ref)], d) ? [idx(c.ref)] : [])),
      f0fCovers: c1.dropped.flatMap((c) => (LABEL_WHYS.has(c.why) && c0.covers.some((x) => x.ref === c.ref) ? [idx(c.ref)] : [])),
      coversF0c: c0.covers.map((c) => idx(c.ref)),
    });
  }
  writeFileSync(join(PRIV, set, "flags.jsonl"), out.map((x) => JSON.stringify(x)).join("\n") + "\n");
  return out;
}

// --- segment and render (private) ---------------------------------------------------------------------------

function segment(set: SetName): void {
  if (!existsSync(py("label"))) throw new Error("helpers/label has no .venv: run `uv sync` there first");
  flagsOf(set);
  const dir = join(PRIV, set);
  const fd = openSync(join(dir, "segment.jsonl"), "w");
  const r = spawnSync(py("label"), ["-I", join(REPO, "helpers", "shelf", "segment.py"), "--inputs", join(dir, "inputs.jsonl"), "--maps", join(dir, "maps"), "--flags", join(dir, "flags.jsonl"), "--images", join(dir, "images.jsonl")], {
    stdio: ["ignore", fd, "inherit"],
  });
  closeSync(fd);
  if (r.status !== 0) throw new Error(`segment.py failed on ${set}`);
}

function render(set: SetName): void {
  flagsOf(set);
  const dir = join(PRIV, set);
  const r = spawnSync(py("depth"), ["-I", join(REPO, "helpers", "shelf", "render.py"), "--inputs", join(dir, "inputs.jsonl"), "--shelf", join(dir, "shelf.jsonl"), "--maps", join(dir, "maps"), "--flags", join(dir, "flags.jsonl"), "--images", join(dir, "images.jsonl"), "--out", join(PRIV, "renders", set)], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (r.status !== 0) throw new Error(`render.py failed on ${set}`);
  log(`${set}: still study under the data root's private/s1/renders/${set}/`);
}

// --- spot check (pre-registered): a blind sheet of on-lip's new catches and controls ------------------------

const SPOT_MAX = 40, SPOT_CONTROLS = 20;

function spot(): void {
  const set: SetName = "pilot-000";
  const flags = flagsOf(set);
  const dets = detsOf(set);
  const sh = shelfOut(set);
  const rand = rng(3);
  const pick = <T,>(xs: T[], n: number): T[] => {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a.slice(0, n);
  };
  const catches = flags.flatMap((f) => [...f.onLip.map((i) => ({ id: f.id, ref: `s${i}` })), ...f.onLipCovers.map((j) => ({ id: f.id, ref: `c${j}` }))]);
  const pool = flags.flatMap((f) => {
    const d = dets.get(f.id)!;
    const k = kinds({ ...d, covers: [] }, evidenceFor(set).get(f.id));
    return k.spines.flatMap((b, i) => (b.kind === "spine" && !f.onLip.includes(i) && (sh.get(f.id)!.boxes[i]?.inZone ?? 0) > 0 ? [{ id: f.id, ref: `s${i}` }] : []));
  });
  const sample = pick([...pick(catches, SPOT_MAX).map((x) => ({ ...x, group: "catch" })), ...pick(pool, SPOT_CONTROLS).map((x) => ({ ...x, group: "control" }))], 1e9);
  const rows = sample.map((x, n) => {
    const d = dets.get(x.id)!;
    const poly = x.ref.startsWith("s") ? d.spines[Number(x.ref.slice(1))]!.polygon : d.covers![Number(x.ref.slice(1))]!.polygon;
    return { n, ...x, polygon: poly };
  });
  const dir = join(PRIV, set, "spot");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "key.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const r = spawnSync(py("depth"), ["-I", join(REPO, "helpers", "shelf", "spot.py"), "--key", join(dir, "key.jsonl"), "--images", join(PRIV, set, "images.jsonl"), "--out", dir], { stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) throw new Error("spot.py failed");
  log(`spot: ${rows.length} boxes (${catches.length} catches available, ${pool.length} controls) under the data root's private/s1/${set}/spot/; judge into judged.jsonl {n, judgement: yes|no|unclear}`);
}

// --- analyse: aggregates only --------------------------------------------------------------------------------

const REPS = 2000;
const r4 = (x: number) => Math.round(x * 10000) / 10000;
const triOf = (b: { value: number; lo: number; hi: number } | null): Tri => (b ? [r4(b.value), r4(b.lo), r4(b.hi)] : null);
const share = <T extends { imageId: string }>(rows: T[], pred: (r: T) => boolean): Tri => triOf(clusterBootstrap(rows, rate(pred), REPS, 1));
const ratioCI = <T extends { imageId: string }>(rows: T[], num: (r: T) => number, den: (r: T) => number): Tri =>
  triOf(clusterBootstrap(rows, (rs) => {
    const d = rs.reduce((s, r) => s + den(r), 0);
    return d ? rs.reduce((s, r) => s + num(r), 0) / d : null;
  }, REPS, 1));
const sorted = (xs: number[]) => [...xs].filter(Number.isFinite).sort((a, b) => a - b);
const q = (xs: number[], p: number): number | null => (xs.length ? r4(quantile(sorted(xs), p)) : null);
const quart = (xs: number[]) => ({ n: xs.length, p25: q(xs, 0.25), p50: q(xs, 0.5), p75: q(xs, 0.75) });

/** Theil-Sen slope (median of pairwise slopes). */
const slopeOf = (x: number[], y: number[]): number | null => {
  const sl: number[] = [];
  for (let i = 0; i < x.length; i++) for (let j = i + 1; j < x.length; j++) if (x[j] !== x[i]) sl.push((y[j]! - y[i]!) / (x[j]! - x[i]!));
  return sl.length ? quantile(sorted(sl), 0.5) : null;
};

interface FaceRowLite {
  id: string;
  box: number;
  band: number;
  frame: string;
  heightM?: number;
  widthM?: number;
  cuboid?: { depthM: number; depthSource: string };
  skip?: string;
}
const H2_SET: Record<SetName, string> = { "pilot-000": "pilot-000", yardstick: "yardstick-library-b2" };
const faceRows = (set: SetName) =>
  new Map(readJsonl<FaceRowLite & { photo?: boolean }>(join(ROOT, "private", "h2", H2_SET[set], "stage-latest.jsonl")).filter((r) => !r.photo).map((r) => [`${r.id}:${r.box}`, r]));

const works = (ds: Slim[]): Set<string> => new Set(ds.filter((d) => d.accepted).map((d) => d.accepted!));
const isTextRead = (d: Slim) => Object.values(d.confirmed).some(Boolean);
const rungs = (imageId: string, ds: Slim[]): RungCounts => ({
  imageId,
  boxCount: ds.length,
  textPresent: ds.filter((d) => d.reason !== "no-text").length,
  textRead: ds.filter(isTextRead).length,
  confirmed: ds.filter((d) => d.accepted).length,
  works: works(ds).size,
});

/** F-0's decision on F-0c's kept covers (as f0f-cli's), keyed `<image>:c<j>`. */
function coverDecisions(set: SetName, dets: Map<string, Detection>): Map<string, Slim> {
  const db = openCatalog(SETS[set].catalog);
  const readings = loadReadings(join(ROOT, "f0c", set, "covers"), COVER_CROP);
  const cache = new Map<string, Candidate | undefined>();
  const out = new Map<string, Slim>();
  for (const d of dets.values())
    for (const c of kinds(d).covers) {
      const j = c.ref.slice(1);
      const r = readings.get(`${d.id}:${j}`) ?? {};
      const reads = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, coverReading(v!)])) as Partial<Record<ReaderName, Reading>>;
      const x = decide(db, `${d.id}:c${j}`, d.id, c.boxScore, reads, cache);
      out.set(`${d.id}:c${j}`, { id: x.id, imageId: x.imageId, accepted: x.accepted?.workId ?? null, confirmed: x.confirmed, readText: x.readText, reason: x.reason });
    }
  return out;
}

/** Median ISFDB page count per confirmed work, from the staging dump (pub_content to pubs), where one is recorded. */
function pagesOf(workIds: string[]): Map<string, number> {
  const path = join(ROOT, "catalog", "isfdb-staging.sqlite");
  const out = new Map<string, number>();
  if (!existsSync(path)) return out;
  const db = new DatabaseSync(path, { readOnly: true });
  const stmt = db.prepare(
    "SELECT p.pub_pages AS pages FROM pub_content pc JOIN pubs p ON p.pub_id = pc.pub_id WHERE pc.title_id IN (SELECT title_id FROM titles WHERE title_id = ? OR title_parent = ?)",
  );
  for (const w of new Set(workIds)) {
    const m = w.match(/^isfdb:(\d+)$/);
    if (!m) continue;
    const ps = (stmt.all(Number(m[1]), Number(m[1])) as { pages: string | null }[])
      .map((r) => Math.max(0, ...((r.pages ?? "").match(/\d+/g) ?? []).map(Number)))
      .filter((n) => n >= 32 && n <= 2000);
    if (ps.length) out.set(w, quantile(sorted(ps), 0.5));
  }
  db.close();
  return out;
}

function analyseSet(set: SetName) {
  const dets = detsOf(set);
  const sh = shelfOut(set);
  const flags = new Map(flagsOf(set).map((f) => [f.id, f]));
  const faces = faceRows(set);
  const base = new Map(readJsonl<Slim>(join(ROOT, "f0c", set, "base-decisions.jsonl")).map((d) => [d.id, d]));
  const covers = coverDecisions(set, dets);
  const ev = evidenceFor(set);

  // Part 1: planes.
  type RowRec = { imageId: string; band: number; elev: Elevation | null; board: boolean; lip: boolean; back: boolean; rms: Record<string, number | null> };
  const rows: RowRec[] = [];
  const skipped: Record<string, number> = {};
  for (const [id, o] of sh)
    for (const r of o.rows) {
      if (r.skip || !r.planes) {
        skipped[r.skip ?? "none"] = (skipped[r.skip ?? "none"] ?? 0) + 1;
        continue;
      }
      rows.push({ imageId: id, band: r.band, elev: elevationOf(r.elevationDeg), board: r.planes.board!.found, lip: r.planes.lip!.found, back: r.planes.back!.found, rms: Object.fromEntries(PLANES.map((p) => [p, r.planes![p]!.found ? (r.planes![p]!.rmsM ?? null) : null])) });
    }
  const strata = [["all", rows] as const, ...ELEVATIONS.map((e) => [e, rows.filter((r) => r.elev === e)] as const)];
  const planes = {
    rows: rows.length,
    photos: new Set(rows.map((r) => r.imageId)).size,
    skipped,
    found: Object.fromEntries(strata.map(([k, rs]) => [k, { rows: rs.length, board: share(rs, (r) => r.board), lip: share(rs, (r) => r.lip), back: share(rs, (r) => r.back), all3: share(rs, (r) => r.board && r.lip && r.back) }])),
    rmsP50: Object.fromEntries(PLANES.map((p) => [p, q(rows.map((r) => r.rms[p]).filter((x): x is number => x != null), 0.5)])),
  };

  // Part 2: voids.
  type VoidRec = { imageId: string; length: number; void: number; voidEnd: number; gap: number; unc: number; under: number; behind: number; f0Gap: number | null; dom: Record<string, number> };
  const vrows: VoidRec[] = [];
  for (const [id, o] of sh) {
    const d = dets.get(id)!;
    for (const r of o.rows) {
      const v = r.voids;
      if (!v || v.lengthW <= 0) continue;
      const len = (x: Stretch) => x.to - x.from;
      const st = v.stretches;
      const dom: Record<string, number> = {};
      for (const x of st.filter((x) => x.kind === "outline-gap")) dom[x.dominant ?? "invalid"] = (dom[x.dominant ?? "invalid"] ?? 0) + len(x);
      const b = d.bands[r.band];
      vrows.push({
        imageId: id,
        length: v.lengthW,
        void: st.filter((x) => x.kind === "void").reduce((s, x) => s + len(x), 0),
        voidEnd: st.filter((x) => x.kind === "void" && x.where === "end").reduce((s, x) => s + len(x), 0),
        gap: st.filter((x) => x.kind === "outline-gap").reduce((s, x) => s + len(x), 0),
        unc: st.reduce((s, x) => s + len(x), 0),
        under: v.under.reduce((s, x) => s + len(x), 0),
        behind: v.behindW,
        f0Gap: b && b.span > 0 ? b.gap / b.span : null,
        dom,
      });
    }
  }
  const domTotals: Record<string, number> = {};
  for (const r of vrows) for (const [k, v] of Object.entries(r.dom)) domTotals[k] = (domTotals[k] ?? 0) + v;
  const gapTotal = Object.values(domTotals).reduce((a, b) => a + b, 0);
  const pairs = vrows.filter((r) => r.f0Gap !== null);
  const voids = {
    rows: vrows.length,
    rowLengthW: quart(vrows.map((r) => r.length)),
    voidShare: ratioCI(vrows, (r) => r.void, (r) => r.length),
    voidShareRowP50: q(vrows.map((r) => r.void / r.length), 0.5),
    voidShareRowP90: q(vrows.map((r) => r.void / r.length), 0.9),
    rowsWithVoid: share(vrows, (r) => r.void > 0),
    endShareOfVoid: vrows.reduce((s, r) => s + r.void, 0) ? r4(vrows.reduce((s, r) => s + r.voidEnd, 0) / vrows.reduce((s, r) => s + r.void, 0)) : null,
    candidateShare: ratioCI(vrows, (r) => r.unc, (r) => r.length),
    outlineGapShareOfCandidates: ratioCI(vrows, (r) => r.gap, (r) => r.unc),
    outlineGapByClass: Object.fromEntries(Object.entries(domTotals).map(([k, v]) => [k, gapTotal ? r4(v / gapTotal) : null])),
    behindUnderOutlinePerRowW: r4(vrows.reduce((s, r) => s + r.under, 0) / Math.max(vrows.length, 1)),
    behindUnderOutlineShare: ratioCI(vrows, (r) => r.under, (r) => r.length),
    voidOverBehind: ratioCI(vrows, (r) => r.void, (r) => r.behind),
    spearmanWithF0Gap: spearman(pairs.map((r) => r.void / r.length), pairs.map((r) => r.f0Gap!)),
    candidateSpearmanWithF0Gap: spearman(pairs.map((r) => r.unc / r.length), pairs.map((r) => r.f0Gap!)),
  };

  // Part 3: bounds and scale.
  const keptIds = new Set<string>();
  for (const d of dets.values()) {
    const f = flags.get(d.id);
    if (!f) continue;
    d.spines.forEach((_, i) => !f.filtered.includes(i) && keptIds.add(`${d.id}:${i}`));
  }
  const facesById = new Map<string, FaceRowLite[]>();
  for (const r of faces.values()) if (keptIds.has(`${r.id}:${r.box}`)) facesById.set(r.id, [...(facesById.get(r.id) ?? []), r]);
  type PitchRec = { imageId: string; pitch: number; source: string; over: number; n: number; ratios: number[] };
  const prs: PitchRec[] = [];
  type DepthRec = { imageId: string; depth: number; over: number; n: number };
  const drs: DepthRec[] = [];
  for (const [id, o] of sh) {
    const fr = facesById.get(id) ?? [];
    const inRow = (band: number) => fr.filter((r) => r.band === band && r.frame === String(band) && !r.skip);
    for (const p of pitches(o.rows)) {
      const hs = inRow(p.lower).map((r) => r.heightM).filter((x): x is number => x != null);
      prs.push({ imageId: id, pitch: p.pitchM, source: p.source, over: hs.filter((h) => h > p.pitchM).length, n: hs.length, ratios: hs.map((h) => h / p.pitchM) });
    }
    for (const r of o.rows)
      if (r.boardDepthM != null) {
        const ds = inRow(r.band).filter((x) => x.cuboid?.depthSource === "seen").map((x) => x.cuboid!.depthM);
        drs.push({ imageId: id, depth: r.boardDepthM, over: ds.filter((x) => x > r.boardDepthM!).length, n: ds.length });
      }
  }
  const keptFaces = [...faces.values()].filter((r) => keptIds.has(`${r.id}:${r.box}`) && !r.skip);
  const heights = keptFaces.map((r) => r.heightM).filter((x): x is number => x != null);
  const seen = keptFaces.filter((r) => r.cuboid?.depthSource === "seen").map((r) => r.cuboid!.depthM);
  const pitchP50 = q(prs.map((r) => r.pitch), 0.5);
  const depthP50 = q(drs.map((r) => r.depth), 0.5);
  const kDepth = impliedScale(STANDARD_SHELF.depth, depthP50);
  const kPitch = impliedScale(STANDARD_SHELF.pitch, pitchP50);
  const hP50 = q(heights, 0.5), sP50 = q(seen, 0.5);
  const scaled = (x: number | null, k: number | null) => (x == null || k == null ? null : r4(x * k));
  // Page counts (pilot-000: ISFDB works only).
  let pages: Record<string, unknown> | null = null;
  if (set === "pilot-000") {
    const conf = [...base.values()].filter((d) => d.accepted && keptIds.has(d.id));
    const pg = pagesOf(conf.map((d) => d.accepted!));
    const xy = conf.flatMap((d) => {
      const w = faces.get(d.id)?.widthM;
      const n = pg.get(d.accepted!);
      return w != null && n != null ? [[n, w] as const] : [];
    });
    const sl = slopeOf(xy.map((p) => p[0]), xy.map((p) => p[1]));
    pages = { confirmedBoxes: xy.length, works: new Set(conf.filter((d) => pg.has(d.accepted!)).map((d) => d.accepted)).size, pagesP50: q(xy.map((p) => p[0]), 0.5), widthP50: q(xy.map((p) => p[1]), 0.5), mmPerPage: sl == null ? null : r4(sl * 1000), spearman: spearman(xy.map((p) => p[0]), xy.map((p) => p[1])) };
  }
  const bySource = Object.fromEntries(["board", "lip", "base"].map((s) => [s, quart(prs.filter((r) => r.source === s).map((r) => r.pitch))]));
  const bounds = {
    pitch: { pairs: prs.length, photos: new Set(prs.map((r) => r.imageId)).size, ...quart(prs.map((r) => r.pitch)), bySource, booksOverCeiling: ratioCI(prs, (r) => r.over, (r) => r.n), heightOverCeilingP50: q(prs.flatMap((r) => r.ratios), 0.5), heightOverCeilingP90: q(prs.flatMap((r) => r.ratios), 0.9) },
    depth: { rows: drs.length, photos: new Set(drs.map((r) => r.imageId)).size, ...quart(drs.map((r) => r.depth)), seenOverCeiling: ratioCI(drs, (r) => r.over, (r) => r.n) },
    scale: {
      standard: STANDARD_SHELF,
      impliedFromDepth: kDepth,
      impliedFromPitch: kPitch,
      agreement: kDepth != null && kPitch != null ? r4(kDepth / kPitch) : null,
      spineHeightP50: hP50,
      spineHeightP50Scaled: { depth: scaled(hP50, kDepth), pitch: scaled(hP50, kPitch) },
      seenDepthP50: sP50,
      seenDepthP50Scaled: { depth: scaled(sP50, kDepth), pitch: scaled(sP50, kPitch) },
      pages,
    },
  };

  // Part 4: on-lip.
  const tally = (xs: (Slim | undefined)[]) => ({ removed: xs.length, removedConfirmed: xs.filter((d) => d?.accepted).length, removedTextRead: xs.filter((d) => d && isTextRead(d)).length });
  const spineRemoved: (Slim | undefined)[] = [], coverRemoved: (Slim | undefined)[] = [];
  const spinePer: { imageId: string; before: Slim[]; after: Slim[] }[] = [];
  const coverPer: { imageId: string; before: Slim[]; after: Slim[]; cb: number; ca: number }[] = [];
  let f0fBoth = 0, f0fOnly = 0, lipOnly = 0, neither = 0, boxesAll = 0;
  for (const d of dets.values()) {
    const f = flags.get(d.id);
    if (!f) continue;
    const kept = d.spines.flatMap((_, i) => (f.filtered.includes(i) ? [] : [i]));
    const before = kept.map((i) => base.get(`${d.id}:${i}`)!).filter(Boolean);
    const after = kept.filter((i) => !f.onLip.includes(i)).map((i) => base.get(`${d.id}:${i}`)!).filter(Boolean);
    f.onLip.forEach((i) => spineRemoved.push(base.get(`${d.id}:${i}`)));
    spinePer.push({ imageId: d.id, before, after });
    const c1 = kinds(d, ev.get(d.id)).covers.map((c) => Number(c.ref.slice(1)));
    f.onLipCovers.forEach((j) => coverRemoved.push(covers.get(`${d.id}:c${j}`)));
    const cv = (js: number[]) => js.map((j) => covers.get(`${d.id}:c${j}`)!).filter(Boolean);
    const k1c = kinds(d, ev.get(d.id)).spines.flatMap((b, i) => (b.kind === "spine" ? [base.get(`${d.id}:${i}`)!] : [])).filter(Boolean);
    coverPer.push({ imageId: d.id, before: [...k1c, ...cv(c1)], after: [...k1c, ...cv(c1.filter((j) => !f.onLipCovers.includes(j)))], cb: c1.length, ca: c1.length - f.onLipCovers.length });
    // 2 x 2 against F-0f over every spine-path box and every cover F-0c keeps.
    const all = [...d.spines.map((_, i) => [f.f0f.includes(i), f.onLipAll.includes(i)] as const), ...f.coversF0c.map((j) => [f.f0fCovers.includes(j), f.onLipAllCovers.includes(j)] as const)];
    for (const [a, b] of all) {
      boxesAll++;
      if (a && b) f0fBoth++;
      else if (a) f0fOnly++;
      else if (b) lipOnly++;
      else neither++;
    }
  }
  const onlip: Record<string, unknown> = {
    spinePath: { boxCount: spinePer.reduce((s, p) => s + p.before.length, 0), ...tally(spineRemoved), reads: agreementChange(spinePer.map((p) => rungs(p.imageId, p.before)), spinePer.map((p) => rungs(p.imageId, p.after))) },
    coverArm: {
      coversKept: coverPer.reduce((s, p) => s + p.cb, 0),
      ...tally(coverRemoved),
      coversPerPhoto: { before: meanCI(coverPer.map((p) => p.cb)), after: meanCI(coverPer.map((p) => p.ca)) },
      reads: agreementChange(coverPer.map((p) => rungs(p.imageId, p.before)), coverPer.map((p) => rungs(p.imageId, p.after))),
    },
    versusF0f: { boxCount: boxesAll, both: f0fBoth, f0fOnly, onLipOnly: lipOnly, neither },
  };
  if (set === "yardstick") {
    const truth = yardstickTruth();
    const counts = (pick: "before" | "after"): [number, number, number][] =>
      spinePer.map((p) => {
        const t = truth.get(p.imageId) ?? new Set<string>();
        const w = works(p[pick]);
        return [t.size, [...w].filter((x) => t.has(x)).length, w.size];
      });
    const b = counts("before"), a = counts("after");
    onlip.titles = { delta: titleDelta(b, a), wrongPerImage: meanCI(a.map((x, i) => x[2] - x[1] - (b[i]![2] - b[i]![1]))), worksPerImage: meanCI(a.map((x, i) => x[2] - b[i]![2])) };
  }

  // Part 5: prior art, when segment has run.
  let prior: Record<string, unknown> | null = null;
  const segPath = join(PRIV, set, "segment.jsonl");
  if (existsSync(segPath)) {
    type Seg = { id: string; model: string; seconds: number; classes: Record<string, Record<string, number | number[]>> };
    const seg = readJsonl<Seg>(segPath).map((r) => ({ ...r, imageId: r.id }));
    prior = {};
    for (const model of [...new Set(seg.map((r) => r.model))]) {
      const rs = seg.filter((r) => r.model === model);
      const classes = Object.keys(rs[0]!.classes);
      prior[model] = {
        photos: rs.length,
        secondsP50: q(rs.map((r) => r.seconds), 0.5),
        classes: Object.fromEntries(
          classes.map((c) => {
            const g = (r: Seg, k: string) => r.classes[c]![k] as number;
            const pair = (k: string) => rs.reduce((s, r) => [s[0]! + (r.classes[c]![k] as number[])[0]!, s[1]! + (r.classes[c]![k] as number[])[1]!], [0, 0]);
            return [c, { lipRecall: ratioCI(rs, (r) => g(r, "lipInMask"), (r) => g(r, "lipPx")), boardRecall: ratioCI(rs, (r) => g(r, "boardInMask"), (r) => g(r, "boardPx")), bookLeakage: ratioCI(rs, (r) => g(r, "bookInMask"), (r) => g(r, "bookPx")), onLipInside: pair("onLip"), f0fInside: pair("f0f"), onLipCoversInside: pair("onLipCovers") }];
          }),
        ),
      };
    }
  }
  const seconds = [...sh.values()].map((o) => o.seconds);
  return { scope: SETS[set].scope, photos: sh.size, secondsPerPhoto: quart(seconds), planes, voids, bounds, onLip: onlip, priorArt: prior };
}

function spotResult(): Record<string, unknown> | null {
  const dir = join(PRIV, "pilot-000", "spot");
  if (!existsSync(join(dir, "judged.jsonl"))) return null;
  const key = new Map(readJsonl<{ n: number; group: string }>(join(dir, "key.jsonl")).map((r) => [r.n, r.group]));
  const judged = readJsonl<{ n: number; judgement: "yes" | "no" | "unclear" }>(join(dir, "judged.jsonl"));
  const g = (group: string) => {
    const js = judged.filter((j) => key.get(j.n) === group);
    const clear = js.filter((j) => j.judgement !== "unclear");
    return { shown: js.length, unclear: js.length - clear.length, notABook: clear.filter((j) => j.judgement === "yes").length, judged: clear.length, share: clear.length ? r4(clear.filter((j) => j.judgement === "yes").length / clear.length) : null };
  };
  return { catches: g("catch"), controls: g("control") };
}

function verdict(m: any) {
  const lp = m.sets["pilot-000"].onLip, ly = m.sets.yardstick.onLip;
  const confirmedRemoved = lp.spinePath.removedConfirmed + lp.coverArm.removedConfirmed + ly.spinePath.removedConfirmed + ly.coverArm.removedConfirmed;
  const newCatches = lp.versusF0f.onLipOnly;
  const s = m.spotCheck;
  const catches = newCatches >= 3 && s !== null && s.catches.share !== null && s.catches.share >= 0.8;
  const t = ly.titles;
  const below = (x: Tri) => x !== null && x[2] < 0;
  const above = (x: Tri) => x !== null && x[1] > 0;
  const yard = !below(t.delta?.recall ?? null) && !above(t.wrongPerImage) && !below(t.worksPerImage);
  return { noConfirmedRemoved: confirmedRemoved === 0, confirmedRemoved, catchesWhatF0fMisses: catches, newCatches, yardstickUnhurt: yard, ships: confirmedRemoved === 0 && catches && yard };
}

function analyse(): void {
  const sets = Object.fromEntries(NAMES.map((s) => [s, analyseSet(s)]));
  const m: any = {
    card: "S-1",
    question: "shelf planes, voids, book-size bounds and scale, and a geometric on-lip label test, from H-2's cached depth stage",
    model: { depth: "Ruicheng/moge-2-vitl-normal@cb0e8bb (H-2 cache)", priorArt: ["shi-labs/oneformer_ade20k_swin_large@4a5bac8", "facebook/sam3 (local)"] },
    onLipRule: ON_LIP,
    pitchRule: PITCH,
    sets,
    spotCheck: spotResult(),
  };
  m.verdict = verdict(m);
  const dir = join(REPO, "evals", "S1");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "metrics.json"), compactJson(m) + "\n");
  const rp = join(dir, "report.md");
  const MARK = "<!-- generated by src/eval/s1-cli.ts analyse: edit above this line -->";
  const old = existsSync(rp) ? readFileSync(rp, "utf8") : "";
  const head = old.includes(MARK) ? old.slice(0, old.indexOf(MARK)) : old.trimEnd() + "\n\n";
  writeFileSync(rp, head + MARK + "\n\n" + tablesMd(m));
  log("evals/S1/{metrics.json,report.md} written");
}

// --- tables -------------------------------------------------------------------------------------------------

const pct = (t: Tri) => (t ? `${(t[0] * 100).toFixed(1)} % (${(t[1] * 100).toFixed(1)}–${(t[2] * 100).toFixed(1)})` : "—");
const pts = (t: Tri) => (t ? `${t[0] >= 0 ? "+" : ""}${(t[0] * 100).toFixed(1)} pts (${(t[1] * 100).toFixed(1)} to ${(t[2] * 100).toFixed(1)})` : "—");
const num = (t: Tri, d = 2) => (t ? `${t[0] >= 0 ? "+" : ""}${t[0].toFixed(d)} (${t[1].toFixed(d)} to ${t[2].toFixed(d)})` : "—");
const plain = (t: Tri, d = 2) => (t ? `${t[0].toFixed(d)} (${t[1].toFixed(d)} to ${t[2].toFixed(d)})` : "—");
const cm = (x: number | null) => (x == null ? "—" : `${(x * 100).toFixed(1)} cm`);
const yn = (b: boolean) => (b ? "yes" : "no");

export function tablesMd(m: any): string {
  const out: string[] = [];
  for (const name of NAMES) {
    const s = m.sets[name];
    out.push(`## ${name} (${s.scope})\n`);
    out.push(`${s.photos} photos; shelf step ${s.secondsPerPhoto.p50} s a photo (p50, CPU, after the cached depth stage).\n`);
    out.push("### Shelf planes\n");
    out.push(`${s.planes.rows} rows in ${s.planes.photos} photos (skipped: ${Object.entries(s.planes.skipped).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}). Share of rows with each plane found; 95 % photo bootstrap.\n`);
    out.push("| rows | n | board top | lip | back panel | all three |\n|---|---:|---|---|---|---|");
    for (const k of ["all", ...ELEVATIONS]) {
      const f = s.planes.found[k];
      out.push(`| ${k === "all" ? "all" : `${k} eye level`} | ${f.rows} | ${pct(f.board)} | ${pct(f.lip)} | ${pct(f.back)} | ${pct(f.all3)} |`);
    }
    out.push(`\nInlier RMS, p50: board top ${cm(s.planes.rmsP50.board)}, lip ${cm(s.planes.rmsP50.lip)}, back panel ${cm(s.planes.rmsP50.back)}.\n`);
    const v = s.voids;
    out.push("### Voids (median spine widths; a coverage segment is two)\n");
    out.push(`${v.rows} rows; row length p25 / p50 / p75 ${v.rowLengthW.p25} / ${v.rowLengthW.p50} / ${v.rowLengthW.p75} widths.\n`);
    out.push("| measure | value |\n|---|---|");
    out.push(`| **void share** (void length / row length, pooled) | **${pct(v.voidShare)}** |`);
    out.push(`| void share per row, p50 / p90 | ${v.voidShareRowP50 == null ? "—" : (v.voidShareRowP50 * 100).toFixed(1)} % / ${v.voidShareRowP90 == null ? "—" : (v.voidShareRowP90 * 100).toFixed(1)} % |`);
    out.push(`| rows with a void | ${pct(v.rowsWithVoid)} |`);
    out.push(`| of void length, at a row's end | ${v.endShareOfVoid == null ? "—" : `${(v.endShareOfVoid * 100).toFixed(1)} %`} |`);
    out.push(`| candidate share (uncovered runs ≥ ½ width / row length) | ${pct(v.candidateShare)} |`);
    out.push(`| of candidates, \`outline-gap\` (not behind) | ${pct(v.outlineGapShareOfCandidates)} |`);
    out.push(`| \`outline-gap\` by dominant class (length) | ${Object.entries(v.outlineGapByClass).sort((a: any, b: any) => b[1] - a[1]).map(([k, x]: any) => `${k} ${(x * 100).toFixed(0)} %`).join(", ") || "—"} |`);
    out.push(`| \`behind-under-outline\` (length / row length) | ${pct(v.behindUnderOutlineShare)} |`);
    out.push(`| voids over behind length | ${pct(v.voidOverBehind)} |`);
    out.push(`| Spearman, void share against F-0's gap share (rows) | ${v.spearmanWithF0Gap ?? "—"} (candidates: ${v.candidateSpearmanWithF0Gap ?? "—"}) |\n`);
    const b = s.bounds;
    out.push("### Book-size bounds and scale (MoGe-2 metres, unverified)\n");
    out.push("| measure | value |\n|---|---|");
    out.push(`| board pitch: pairs (photos) | ${b.pitch.pairs} (${b.pitch.photos}) |`);
    out.push(`| pitch p25 / p50 / p75 | ${cm(b.pitch.p25)} / ${cm(b.pitch.p50)} / ${cm(b.pitch.p75)} |`);
    out.push(`| pitch p50 by source: board / lip / base | ${cm(b.pitch.bySource.board.p50)} (${b.pitch.bySource.board.n}) / ${cm(b.pitch.bySource.lip.p50)} (${b.pitch.bySource.lip.n}) / ${cm(b.pitch.bySource.base.p50)} (${b.pitch.bySource.base.n}) |`);
    out.push(`| books taller than their ceiling (pitch) | ${pct(b.pitch.booksOverCeiling)} |`);
    out.push(`| book height / ceiling, p50 / p90 | ${b.pitch.heightOverCeilingP50 ?? "—"} / ${b.pitch.heightOverCeilingP90 ?? "—"} |`);
    out.push(`| board depth: rows (photos) | ${b.depth.rows} (${b.depth.photos}) |`);
    out.push(`| board depth p25 / p50 / p75 | ${cm(b.depth.p25)} / ${cm(b.depth.p50)} / ${cm(b.depth.p75)} |`);
    out.push(`| seen book depths deeper than the board | ${pct(b.depth.seenOverCeiling)} |`);
    out.push(`| implied scale from depth / from pitch (standard shelf) | ${b.scale.impliedFromDepth ?? "—"} / ${b.scale.impliedFromPitch ?? "—"} (ratio ${b.scale.agreement ?? "—"}) |`);
    out.push(`| spine height p50, raw → × depth scale / × pitch scale | ${cm(b.scale.spineHeightP50)} → ${cm(b.scale.spineHeightP50Scaled.depth)} / ${cm(b.scale.spineHeightP50Scaled.pitch)} |`);
    out.push(`| seen book depth p50, raw → × depth scale / × pitch scale | ${cm(b.scale.seenDepthP50)} → ${cm(b.scale.seenDepthP50Scaled.depth)} / ${cm(b.scale.seenDepthP50Scaled.pitch)} |`);
    if (b.scale.pages) {
      const p = b.scale.pages;
      out.push(`| page counts: confirmed boxes (works) with an ISFDB count | ${p.confirmedBoxes} (${p.works}) |`);
      out.push(`| width on pages: Theil-Sen slope, Spearman | ${p.mmPerPage ?? "—"} mm a page, ${p.spearman ?? "—"} (pages p50 ${p.pagesP50}, width p50 ${cm(p.widthP50)}) |`);
    }
    out.push("");
    const o = s.onLip;
    out.push("### `on-lip`\n");
    out.push("*Removed confirmed* is a lower bound on real books removed; *at `text-read`* an upper hint.\n");
    out.push("| boxes | boxes | removed by `on-lip` | removed confirmed | removed at `text-read` |\n|---|---:|---:|---:|---:|");
    out.push(`| default spine path (cover pass off), after F-0c's and F-0f's flags | ${o.spinePath.boxCount} | ${o.spinePath.removed} | ${o.spinePath.removedConfirmed} | ${o.spinePath.removedTextRead} |`);
    out.push(`| F-0c's kept covers (F-0f on) | ${o.coverArm.coversKept} | ${o.coverArm.removed} | ${o.coverArm.removedConfirmed} | ${o.coverArm.removedTextRead} |`);
    out.push(`\nAgainst F-0f over every spine-path box and every cover F-0c keeps (${o.versusF0f.boxCount}): both ${o.versusF0f.both}, F-0f only ${o.versusF0f.f0fOnly}, **\`on-lip\` only ${o.versusF0f.onLipOnly}**, neither ${o.versusF0f.neither}.\n`);
    out.push(`Spine path with \`on-lip\` against the default: works per photo ${num(o.spinePath.reads.delta.worksPerPhoto)}, confirmed share ${pts(o.spinePath.reads.delta.confirmedShare)}. Cover arm: face-out boxes per photo ${plain(o.coverArm.coversPerPhoto.before)} → ${plain(o.coverArm.coversPerPhoto.after)}; works per photo ${num(o.coverArm.reads.delta.worksPerPhoto)}.${o.titles ? ` Yardstick titles: recall ${pts(o.titles.delta?.recall)}, precision ${pts(o.titles.delta?.precision)}, wrong accepts per image ${num(o.titles.wrongPerImage)}, distinct confirmed works per image ${num(o.titles.worksPerImage)}.` : ""}\n`);
    if (s.priorArt) {
      out.push("### Prior art: off-the-shelf shelf masks\n");
      out.push("| model | mask | lip inliers inside | board-top inliers inside | book pixels inside (leakage) | `on-lip` boxes inside | F-0f boxes inside | s / photo |\n|---|---|---|---|---|---:|---:|---:|");
      for (const [model, x] of Object.entries<any>(s.priorArt))
        for (const [c, y] of Object.entries<any>(x.classes)) out.push(`| ${model} | ${c} | ${pct(y.lipRecall)} | ${pct(y.boardRecall)} | ${pct(y.bookLeakage)} | ${y.onLipInside[0]}/${y.onLipInside[1]} | ${y.f0fInside[0]}/${y.f0fInside[1]} | ${x.secondsP50} |`);
      out.push("");
    }
  }
  const sc = m.spotCheck;
  out.push("## Spot check and verdict\n");
  out.push(sc ? `Blind agent spot check (\`pilot-000\`): \`on-lip\`'s new catches judged *not a book* ${sc.catches.notABook} of ${sc.catches.judged} (${sc.catches.unclear} unclear); controls ${sc.controls.notABook} of ${sc.controls.judged} (${sc.controls.unclear} unclear). One agent's judgement, never labels.\n` : "Spot check not run.\n");
  const v = m.verdict;
  out.push("| no confirmed book removed (both sets) | catches labels F-0f misses | yardstick not hurt | \`on-lip\` keep rule |\n|---|---|---|---|");
  out.push(`| ${yn(v.noConfirmedRemoved)} (${v.confirmedRemoved}) | ${yn(v.catchesWhatF0fMisses)} (${v.newCatches} new) | ${yn(v.yardstickUnhurt)} | **${v.ships ? "met: a ready post step, not yet wired into the default pipeline (finding 4)" : "not met: off"}** |`);
  return out.join("\n") + "\n";
}

// --- main ---------------------------------------------------------------------------------------------------

const [cmd, arg, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};
if (import.meta.url === `file://${process.argv[1]}`) {
  const sets = isSet(arg) ? [arg] : NAMES;
  if (cmd === "stage") sets.forEach(stage);
  else if (cmd === "shelf") sets.forEach((s) => shelf(s, flag("--only") ? Number(flag("--only")) : undefined));
  else if (cmd === "segment") sets.forEach(segment);
  else if (cmd === "render") sets.forEach(render);
  else if (cmd === "spot") spot();
  else if (cmd === "analyse") analyse();
  else {
    console.error("usage: s1-cli.ts stage|shelf|segment|render|spot|analyse [set]");
    process.exit(2);
  }
}
