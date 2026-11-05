// Q-2 runner: teacher rung per detected box, the first readability student, the owner's top-edge hypothesis.
//
//   node src/eval/q2-cli.ts geometry   # helpers/coverage/geometry.py: top-seam measure per box (private)
//   node src/eval/q2-cli.ts analyse    # evals/Q2/{metrics.json,report.md}; per-box tables and scores stay private
//   node src/eval/q2-cli.ts render     # private renders: measured vs predicted fill, top-edge overlay
//   node src/eval/q2-cli.ts all        # the three in order
//
// Inputs: F-0's stage folders (`f0/<set>/`: detections, readings, decisions) and Q-1's private per-box
// features and table (`private/q1/`; run `node src/eval/q1-cli.ts features analyse` first). Everything per box
// or per photo goes under the data root's `private/q2/`; only aggregates reach the repo.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dataRoot } from "../ledger/images.ts";
import { compactJson } from "./q1-cli.ts";
import { byImage, clusterBootstrap, quantile, rate, rng } from "./q1.ts";
import type { Outcome } from "./q1.ts";
import {
  RUNGS,
  SEAM_OFF,
  MIN_AGREE_CHARS,
  aucOf,
  brier,
  chooseFillP,
  chooseTau,
  derangement,
  ece,
  excludesZero,
  filled,
  fitStudent,
  heightOffBand,
  leaveOneImageOut,
  operatingPoints,
  pairedBootstrap,
  predictStudent,
  r4,
  readerAgreement,
  reliability,
  squash,
  teacherRung,
  topClass,
} from "./q2.ts";
import type { Feature, Interval, Monotone, Readings, Rung, Scored, TeacherInput, TopClass } from "./q2.ts";
import { assertTrainable } from "./set-roles.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HELPER = join(REPO, "helpers", "coverage");
const ROOT = dataRoot();
const Q1 = join(ROOT, "private", "q1");
export const PILOT = "pilot-000";
export const YARD = "yardstick-library-b2";
const SETS = [PILOT, YARD];
const REPS = 1000;

/** One set's inputs: an F-0-shaped stage folder, Q-1-shaped features and table, and which boxes count. */
export interface SetInputs {
  /** `detect.jsonl` and each reader's `<reader>.jsonl`. */
  stage: string;
  /** F-0-shaped decisions (`accepted`, `reason`) per box. */
  decisions: string;
  /** Q-1's features.py rows, the image list they were measured on, and Q-1's per-box table (q1-cli rowsFrom). */
  features: string;
  images: string;
  table: string;
  /** Boxes the run keeps; the rest are dropped before τ, the teacher and the student. Default: every box. */
  keep?: (id: string) => boolean;
}

/** One run of the analysis (Q-2 on F-0's boxes, Q-2b on the current default): inputs, and where outputs go. */
export interface Run {
  id: string;
  card: string;
  /** The runner's file name, for the report's marker line. */
  cli: string;
  /** Private outputs (per box, per photo) under the data root. */
  priv: string;
  /** evals/<id>/: metrics.json and report.md, aggregates only. */
  evalDir: string;
  question: string;
  inputs: string;
  sets: Record<string, SetInputs>;
  /** A fixed τ instead of the null procedure's (diagnostics only; the go rule always derives τ). */
  tau?: number;
  /** Where the top-seam geometry is read from (default: `<priv>/geometry`). */
  geometryDir?: string;
  /** A generated section placed first under the marker, and its aggregates (Q-2b: the comparison with Q-2). */
  prelude?: (metrics: Record<string, unknown>) => { json: Record<string, unknown>; md: string };
}

export const Q2_RUN: Run = {
  id: "Q2",
  card: "Q-2",
  cli: "q2-cli.ts",
  priv: join(ROOT, "private", "q2"),
  evalDir: join(REPO, "evals", "Q2"),
  question: "per detected box, the teacher's coverage rung; can cheap still-tier signals predict rung >= text-read (the fill line); does the owner's top-edge observation hold",
  inputs: "F-0 cached stage outputs (B2 boxes, three readers, decisions) for pilot-000 (31 photos) and yardstick-library B2 (40 Library Dataset images, PROXY); Q-1 private per-box features",
  sets: Object.fromEntries(SETS.map((set) => [set, {
    stage: join(ROOT, "f0", set),
    decisions: join(ROOT, "f0", set, "decisions.jsonl"),
    features: join(Q1, "features", `${set}.jsonl`),
    images: join(Q1, "features", `${set}.images.jsonl`),
    table: join(Q1, "table", `${set}.jsonl`),
  }])),
};

/** Box-score floor (§5 population). Q-1's H3 cut, kept after the sensitivity check in the report. */
export const FLOOR = 0.225;
/** False-agreement rate allowed for τ on the null pairing (pilot-000 only; the yardstick is checked, not used). */
const TAU_FALSE_RATE = 0.01;
/** Precision a predicted fill must reach for FILL_P: at most one fill in ten later measured below text-read. */
const FILL_PRECISION = 0.9;
/** Q-0's starting FILL_P, proposed unchanged when no score reaches FILL_PRECISION. */
const Q0_FILL_P = 0.7;
/** Q-1's H2 cut: radial distance (1 = a corner) beyond which a box counts as at the frame's edge. */
const EDGE_RADIAL = 0.5612;
/** Top end this far below the frame's centre line (0 top, 1 bottom) counts as "camera looks down onto the top". */
const TOP_IN_VIEW_Y = 0.6;
/** An upright box shorter than this share of its shelf band's height is called a partial piece of a spine (conductor, F-0e). */
const PARTIAL_BAND = 0.55;

const log = (s: string) => process.stderr.write(`q2: ${s}\n`);
const readJsonl = <T>(p: string): T[] => readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T);
const python = () => {
  const py = join(HELPER, ".venv", "bin", "python");
  if (!existsSync(py)) throw new Error("helpers/coverage has no .venv: run `uv sync` there first");
  return py;
};

// --- geometry --------------------------------------------------------------------------------------------

export function geometry(run: Run, sets = SETS): void {
  const py = python();
  mkdirSync(join(run.priv, "geometry"), { recursive: true });
  for (const set of sets) {
    const images = run.sets[set]!.images;
    if (!existsSync(images)) throw new Error(`Q-1's image list for ${set} is missing: run \`node src/eval/q1-cli.ts features\``);
    const out = join(run.priv, "geometry", `${set}.jsonl`);
    const fd = openSync(out, "w");
    log(`${set}: top-seam geometry`);
    const r = spawnSync(py, ["-I", join(HELPER, "geometry.py"), "--detect", join(run.sets[set]!.stage, "detect.jsonl"), "--images", images], { stdio: ["ignore", fd, "inherit"] });
    closeSync(fd);
    if (r.status !== 0) throw new Error(`geometry.py failed on ${set}`);
  }
}

// --- the teacher table -----------------------------------------------------------------------------------

interface Decision extends TeacherInput { id: string; imageId: string }
interface Reading { id: string; reader: string; variants: { text: string }[]; error?: string }
interface Q1Row { id: string; imageId: string; outcome: Outcome; f: Record<string, number | null> }
interface Geo { id: string; topSeam: number | null; topSeamStrength: number | null; topY: number }

export interface Box {
  id: string;
  imageId: string;
  index: number;
  rung: Rung;
  y: number;
  agreement: number | null;
  /** Yardstick only: accepted, but the work is not among the photo's annotated titles (Q-1's rejected/wrong). */
  truthMismatch: boolean;
  boxScore: number;
  lying: boolean;
  f: Record<string, number | null>;
  band: number | null;
  longPx: number | null;
  topSeam: number | null;
  topY: number;
  heightOff: number | null;
  top: TopClass;
  edge: boolean;
  topInView: boolean;
  /** F-0's flag: the box was cut by a detector tile edge. */
  cut: boolean;
  /** Box long side over its shelf band's height (the band polygon's short side); null outside a band. */
  heightOverBand: number | null;
  /** whole, or a likely fragment of a spine: cut by a tile edge, or under PARTIAL_BAND of the band's height. */
  fragment: Fragment;
}

export type Fragment = "whole" | "cut" | "partial";
export const fragmentOf = (cut: boolean, heightOverBand: number | null): Fragment =>
  cut ? "cut" : heightOverBand !== null && heightOverBand < PARTIAL_BAND ? "partial" : "whole";

/** Short side of a 4-point polygon: a shelf band's height across the shelf. */
export function shortSide(p: number[][]): number {
  const d = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);
  return Math.min((d(p[0]!, p[1]!) + d(p[2]!, p[3]!)) / 2, (d(p[1]!, p[2]!) + d(p[3]!, p[0]!)) / 2);
}

/** Each box's readings, squashed, as F-0 counts them (a variant needs two characters after trimming). */
function loadReadings(stage: string): Map<string, Readings> {
  const out = new Map<string, Readings>();
  for (const reader of ["vision", "ppocr", "qwen"]) {
    const p = join(stage, `${reader}.jsonl`);
    if (!existsSync(p)) continue;
    for (const r of readJsonl<Reading>(p)) {
      if (r.error) continue;
      const v = [...new Set(r.variants.map((x) => x.text.replace(/\s+/g, " ").trim()).filter((t) => t.length >= 2).map(squash).filter(Boolean))];
      const e = out.get(r.id) ?? {};
      e[reader] = v;
      out.set(r.id, e);
    }
  }
  return out;
}

/** Agreement of each box with itself (real) and with a different box in the same photo (the null pairing). */
function agreements(set: string, reads: Map<string, Readings>, decisions: Decision[]) {
  const real = new Map<string, number | null>();
  for (const d of decisions) real.set(d.id, readerAgreement(reads.get(d.id) ?? {}));
  const rand = rng(17);
  const nullSims: number[] = [];
  for (const g of byImage(decisions)) {
    const ids = g.map((d) => d.id).filter((id) => Object.values(reads.get(id) ?? {}).filter((v) => v && v.length).length >= 1);
    const pi = derangement(ids.length, rand);
    ids.forEach((id, i) => {
      const s = readerAgreement(reads.get(id)!, reads.get(ids[pi[i]!]!)!);
      if (s !== null) nullSims.push(s);
    });
  }
  log(`${set}: agreement on ${real.size} boxes, ${nullSims.length} null pairs`);
  return { real, nullSims };
}

function boxesFor(run: Run, set: string, tau: number, real: Map<string, number | null>, decisions: Decision[]): Box[] {
  const inp = run.sets[set]!;
  const q1 = new Map(readJsonl<Q1Row>(inp.table).map((r) => [r.id, r]));
  const feat = new Map(readJsonl<{ id: string; band: number | null; cut: boolean | null }>(inp.features).map((r) => [r.id, r]));
  const band = new Map([...feat].map(([id, r]) => [id, r.band]));
  const bandHeight = new Map(readJsonl<{ id: string; bands: { polygon: number[][] }[] }>(join(inp.stage, "detect.jsonl")).map((d) => [d.id, d.bands.map((b) => shortSide(b.polygon))]));
  const geo = new Map(readJsonl<Geo>(join(run.geometryDir ?? join(run.priv, "geometry"), `${set}.jsonl`)).map((r) => [r.id, r]));
  const boxes = decisions.map((d): Box => {
    const q = q1.get(d.id), g = geo.get(d.id);
    if (!q || !g) throw new Error(`${set}: a decided box has no Q-1 row or geometry; rerun the features and geometry steps (${run.cli})`);
    const rung = teacherRung(d, real.get(d.id) ?? null, tau);
    return {
      id: d.id,
      imageId: d.imageId,
      index: Number(d.id.slice(d.id.lastIndexOf(":") + 1)),
      rung,
      y: filled(rung) ? 1 : 0,
      agreement: real.get(d.id) ?? null,
      truthMismatch: q.outcome === "rejected/wrong",
      boxScore: q.f.boxScore!,
      lying: q.f.lying === 1,
      f: q.f,
      band: band.get(d.id) ?? null,
      longPx: q.f.longPx,
      topSeam: g.topSeam,
      topY: g.topY,
      heightOff: null,
      top: topClass(g.topSeam),
      edge: (q.f.radial ?? 0) > EDGE_RADIAL,
      topInView: g.topY > TOP_IN_VIEW_Y,
      cut: feat.get(d.id)?.cut === true,
      heightOverBand: null,
      fragment: "whole",
    };
  });
  const h = heightOffBand(boxes);
  for (const b of boxes) {
    b.heightOff = h.get(b) ?? null;
    const bh = b.band === null ? undefined : bandHeight.get(b.imageId)?.[b.band];
    b.heightOverBand = bh && b.longPx ? b.longPx / bh : null;
    b.fragment = fragmentOf(b.cut, b.heightOverBand);
  }
  return boxes;
}

// --- the student -----------------------------------------------------------------------------------------

/** §4 S-S2's five, each with the direction the hypothesis gives it. Transforms fixed before fitting. */
const BASE: Feature<Box>[] = [
  { name: "logCropWidthPx", sign: 1, of: (b) => Math.log(b.f.shortPx!) },
  { name: "logDetail", sign: 1, of: (b) => Math.log1p(b.f.lapVarNorm!) },
  { name: "glareShare", sign: -1, of: (b) => b.f.highlightFrac! },
  { name: "lumaOffMid", sign: -1, of: (b) => Math.abs(b.f.mean! - 128) },
  { name: "tiltDeg", sign: -1, of: (b) => b.f.offAxisDeg! },
];
/**
 * Crop width alone, its direction learned in each fold: the strongest crop-width-only model, so the gain test is
 * conservative. (With S-L1's declared sign it degenerates on pilot-000, where wider crops read less often.)
 */
const BASELINE: Feature<Box>[] = [{ ...BASE[0]!, sign: 0 }];
/** The owner's hypothesis, as two cheap geometry features; missing values count as typical (0). */
const GEOM: Feature<Box>[] = [
  { name: "heightOffBand", sign: -1, of: (b) => Math.abs(b.heightOff ?? 0) },
  { name: "topSeamOff", sign: -1, of: (b) => Math.abs(b.topSeam ?? 0) },
];
/** How far below the frame's centre line the box's top end sits: the camera looks down onto lower tops. */
const VIEW: Feature<Box> = { name: "topBelowCentre", sign: -1, of: (b) => b.topY - 0.5 };
/** Detector fragments (conductor's F-0e note): a tile-cut flag, and box height over band height (capped; missing = 1). */
const FRAG: Feature<Box>[] = [
  { name: "cutByTile", sign: -1, of: (b) => (b.cut ? 1 : 0) },
  { name: "heightOverBand", sign: 1, of: (b) => Math.min(1.5, b.heightOverBand ?? 1) },
];
const NEEDED = ["shortPx", "lapVarNorm", "highlightFrac", "mean", "offAxisDeg"];

const complete = (b: Box) => NEEDED.every((k) => b.f[k] !== null && b.f[k] !== undefined && Number.isFinite(b.f[k]!));
const inPopulation = (floor: number, lying = false) => (b: Box) => b.boxScore >= floor && (lying || !b.lying) && complete(b);

interface Config { name: string; feats: Feature<Box>[] }
const CONFIGS: Config[] = [
  { name: "baseline", feats: BASELINE },
  { name: "student", feats: BASE },
  ...BASE.map((f) => ({ name: `student-${f.name}`, feats: BASE.filter((g) => g !== f) })),
  { name: "student+heightOffBand", feats: [...BASE, GEOM[0]!] },
  { name: "student+topSeamOff", feats: [...BASE, GEOM[1]!] },
  { name: "student+geometry", feats: [...BASE, ...GEOM] },
  // Diagnostics, outside the go rule: every direction learned, and the vertical viewing position of the top.
  { name: "diag:signFree", feats: BASE.map((f) => ({ ...f, sign: 0 as const })) },
  { name: "diag:student+viewElevation", feats: [...BASE, VIEW] },
  // Detector fragments, a separate row too: these measure F-0's boxes, not the capture (F-0e is fixing them).
  { name: "diag:student+fragment", feats: [...BASE, ...FRAG] },
];

interface Fitted { pilot: Scored[]; yard: Scored[]; full: Record<string, Monotone>; folds: Record<string, Monotone[]> }

/** Every config: leave-one-image-out scores on pilot-000; the full pilot fit scores the yardstick unchanged. */
function fitAll(pilot: Box[], yard: Box[], configs: Config[]): Fitted {
  assertTrainable(PILOT, "Q-2");
  const ps: Scored[] = pilot.map((b) => ({ imageId: b.imageId, y: b.y, s: {} }));
  const ys: Scored[] = yard.map((b) => ({ imageId: b.imageId, y: b.y, s: {} }));
  const full: Record<string, Monotone> = {}, folds: Record<string, Monotone[]> = {};
  for (const c of configs) {
    const loio = leaveOneImageOut(pilot, (b) => b.y, c.feats);
    loio.p.forEach((p, i) => (ps[i]!.s[c.name] = p));
    folds[c.name] = loio.folds.map((f) => f.model);
    const m = fitStudent(pilot, (b) => b.y, c.feats);
    full[c.name] = m;
    yard.forEach((b, i) => (ys[i]!.s[c.name] = predictStudent(m, c.feats, b)));
  }
  return { pilot: ps, yard: ys, full, folds };
}

/** AUC per config, ΔAUC against the student and the baseline, ECE and Brier, all on one paired photo bootstrap. */
function scoreSet(rows: Scored[], names: string[], seed: number) {
  const stats: Record<string, (r: Scored[]) => number | null> = {};
  for (const n of names) {
    stats[`auc:${n}`] = (r) => aucOf(r, n);
    stats[`ece:${n}`] = (r) => ece(r, n);
    stats[`brier:${n}`] = (r) => brier(r, n);
    if (n !== "baseline") stats[`dBaseline:${n}`] = (r) => { const a = aucOf(r, n), b = aucOf(r, "baseline"); return a === null || b === null ? null : a - b; };
    if (n !== "student" && n !== "baseline") stats[`dStudent:${n}`] = (r) => { const a = aucOf(r, n), b = aucOf(r, "student"); return a === null || b === null ? null : a - b; };
  }
  stats.filledShare = rate((r: Scored) => r.y === 1);
  const b = pairedBootstrap(rows, stats, REPS, seed);
  const out: Record<string, Record<string, Interval | null>> = {};
  for (const [k, v] of Object.entries(b)) {
    if (!k.includes(":")) continue;
    const m = k.slice(0, k.indexOf(":")), n = k.slice(k.indexOf(":") + 1);
    (out[n] ??= {})[m] = v;
  }
  return { n: rows.length, photos: byImage(rows).length, filledShare: b.filledShare, models: out };
}

const weightsOf = (m: Monotone) =>
  Object.fromEntries(m.features.map((f, j) => {
    const k = m.active.indexOf(j);
    return [f, k < 0 || !m.model ? 0 : r4(m.model.weights[k + 1]!)];
  }));

// --- the owner's hypothesis: breakdowns -------------------------------------------------------------------

const TOPS: TopClass[] = ["clean", "overshoot", "cut", "none"];

function breakdown(boxes: Box[], scored: Scored[], seed: number) {
  const idx = new Map(boxes.map((b, i) => [b, i]));
  const cell = (pred: (b: Box) => boolean, s: number) => {
    const bs = boxes.filter(pred);
    const sc = bs.map((b) => scored[idx.get(b)!]!);
    const t = (x: ReturnType<typeof clusterBootstrap>): Interval | null => (x ? [r4(x.value), r4(x.lo), r4(x.hi)] : null);
    const byTop = Object.fromEntries(TOPS.map((c) => [c, { n: bs.filter((b) => b.top === c).length, share: bs.length ? r4(bs.filter((b) => b.top === c).length / bs.length) : null, filled: t(clusterBootstrap(bs, rate((b: Box) => b.y === 1, (b: Box) => b.top === c), REPS, s + 1)) }]));
    const auc = bs.length && bs.some((b) => b.y) && bs.some((b) => !b.y)
      ? pairedBootstrap(sc, {
          student: (r) => aucOf(r, "student"),
          geometry: (r) => aucOf(r, "student+geometry"),
          delta: (r) => { const a = aucOf(r, "student+geometry"), b = aucOf(r, "student"); return a === null || b === null ? null : a - b; },
        }, REPS, s + 2)
      : null;
    return { n: bs.length, photos: byImage(bs).length, filled: t(clusterBootstrap(bs, rate((b: Box) => b.y === 1), REPS, s)), byTop, aucStudent: auc?.student ?? null, aucGeometry: auc?.geometry ?? null, dAuc: auc?.delta ?? null };
  };
  return {
    all: cell(() => true, seed),
    centre: cell((b) => !b.edge, seed + 10),
    edge: cell((b) => b.edge, seed + 20),
    topNotInView: cell((b) => !b.topInView, seed + 30),
    topInView: cell((b) => b.topInView, seed + 40),
    centreTopNotInView: cell((b) => !b.edge && !b.topInView, seed + 50),
    centreTopInView: cell((b) => !b.edge && b.topInView, seed + 60),
    edgeTopNotInView: cell((b) => b.edge && !b.topInView, seed + 70),
    edgeTopInView: cell((b) => b.edge && b.topInView, seed + 80),
  };
}

/** Single-feature separation of filled from not filled, oriented so > 0.5 means larger values go with filled. */
function separations(boxes: Box[], seed: number) {
  const feats: Record<string, (b: Box) => number | null> = {
    heightOffBand: (b) => (b.heightOff === null ? null : Math.abs(b.heightOff)),
    heightOffBandSigned: (b) => b.heightOff,
    topSeamOff: (b) => (b.topSeam === null ? null : Math.abs(b.topSeam)),
    topSeamSigned: (b) => b.topSeam,
    topY: (b) => b.topY,
  };
  const out: Record<string, { n: number; auc: Interval | null }> = {};
  for (const [k, f] of Object.entries(feats)) {
    const rows = boxes.filter((b) => f(b) !== null).map((b) => ({ imageId: b.imageId, y: b.y, s: { x: f(b)! } }));
    out[k] = { n: rows.length, auc: pairedBootstrap(rows, { a: (r) => aucOf(r, "x") }, REPS, seed).a ?? null };
  }
  return out;
}

// --- analysis --------------------------------------------------------------------------------------------

function rungCounts(boxes: Box[]) {
  return Object.fromEntries(RUNGS.slice(2).map((r) => [r, boxes.filter((b) => b.rung === r).length]));
}

export function analyse(run: Run): void {
  const decisions: Record<string, Decision[]> = {}, real: Record<string, Map<string, number | null>> = {}, nulls: Record<string, number[]> = {};
  for (const set of SETS) {
    const inp = run.sets[set]!;
    decisions[set] = readJsonl<Decision>(inp.decisions).filter((d) => !inp.keep || inp.keep(d.id));
    const a = agreements(set, loadReadings(inp.stage), decisions[set]!);
    real[set] = a.real;
    nulls[set] = a.nullSims;
  }
  // τ from pilot-000's null pairing only; the yardstick's null is reported as a check.
  const tau = run.tau ?? chooseTau(nulls[PILOT]!, TAU_FALSE_RATE);
  const tauStudy = Object.fromEntries(SETS.map((set) => {
    const acc = decisions[set]!.filter((d) => d.accepted).map((d) => real[set]!.get(d.id) ?? 0);
    const nm = decisions[set]!.filter((d) => d.reason === "no-catalog-match").map((d) => real[set]!.get(d.id) ?? 0);
    const share = (xs: number[], t: number) => (xs.length ? r4(xs.filter((x) => x >= t).length / xs.length) : null);
    return [set, {
      nullPairs: nulls[set]!.length,
      sweep: [0.6, 0.7, 0.75, 0.8, 0.85, tau, 0.9, 0.95, 1].filter((t, i, a) => a.indexOf(t) === i).sort((a, b) => a - b).map((t) => ({
        tau: t, nullPass: share(nulls[set]!, t), acceptedPass: share(acc, t), noCatalogMatchPass: share(nm, t),
      })),
    }];
  }));
  const boxes: Record<string, Box[]> = {};
  for (const set of SETS) boxes[set] = boxesFor(run, set, tau, real[set]!, decisions[set]!);

  // Teacher table.
  const teacher = Object.fromEntries(SETS.map((set) => {
    const all = boxes[set]!;
    const pop = all.filter(inPopulation(FLOOR));
    return [set, {
      photos: byImage(all).length,
      detected: { n: all.length, rungs: rungCounts(all) },
      belowFloor: { n: all.filter((b) => b.boxScore < FLOOR).length, rungs: rungCounts(all.filter((b) => b.boxScore < FLOOR)) },
      lyingAtOrAboveFloor: { n: all.filter((b) => b.boxScore >= FLOOR && b.lying).length, rungs: rungCounts(all.filter((b) => b.boxScore >= FLOOR && b.lying)) },
      incompleteFeatures: all.filter((b) => b.boxScore >= FLOOR && !b.lying && !complete(b)).length,
      population: { n: pop.length, rungs: rungCounts(pop) },
      populationFilled: (() => { const x = clusterBootstrap(pop, rate((b: Box) => b.y === 1), REPS, 31); return x ? [r4(x.value), r4(x.lo), r4(x.hi)] : null; })(),
      acceptedNotInAnnotations: set === YARD ? all.filter((b) => b.truthMismatch).length : null,
    }];
  }));

  // Student, ablations and the go rule.
  log("student: leave-one-image-out over pilot-000");
  const pilot = boxes[PILOT]!.filter(inPopulation(FLOOR)), yard = boxes[YARD]!.filter(inPopulation(FLOOR));
  const fit = fitAll(pilot, yard, CONFIGS);
  const names = CONFIGS.map((c) => c.name);
  log("scoring");
  const scores = { [PILOT]: scoreSet(fit.pilot, names, 41), [YARD]: scoreSet(fit.yard, names, 42) };
  const sp = scores[PILOT]!.models;
  const studentAuc = sp.student!.auc!, gain = sp.student!.dBaseline!;
  // Robustness of the go rule: (a) the gain over crop width ranked in whichever direction is best with
  // hindsight (no folds, so no fold-intercept artefact); (b) the student's AUC against each kind of negative;
  // (c) the in-sample AUC of the full pilot fit, an optimistic bound.
  const width = (b: Box) => b.f.shortPx!;
  const robust = Object.fromEntries(SETS.map((set, k) => {
    const bs = set === PILOT ? pilot : yard, sc = set === PILOT ? fit.pilot : fit.yard;
    const rows = bs.map((b, i) => ({ imageId: b.imageId, y: b.y, rung: b.rung, s: { student: sc[i]!.s.student!, width: width(b), inSample: predictStudent(fit.full.student!, BASE, b) } }));
    const oracle = (r: typeof rows) => { const a = aucOf(r, "width"); return a === null ? null : Math.max(a, 1 - a); };
    const vs = (neg: Rung) => (r: typeof rows) => aucOf(r.filter((x) => x.y === 1 || x.rung === neg), "student");
    return [set, pairedBootstrap(rows, {
      oracleWidthAuc: oracle,
      gainOverOracleWidth: (r) => { const a = aucOf(r, "student"), o = oracle(r); return a === null || o === null ? null : a - o; },
      studentVsSpineFound: vs("spine-found"),
      studentVsTextPresent: vs("text-present"),
      studentInSample: (r) => aucOf(r, "inSample"),
    }, REPS, 71 + k)];
  }));
  const go = studentAuc[0] >= 0.75 && excludesZero(gain) && gain[0] > 0;

  // Calibration and the operating point.
  const thresholds = Array.from({ length: 14 }, (_, i) => r4(0.3 + i * 0.05));
  const ops = { [PILOT]: operatingPoints(fit.pilot, "student", thresholds), [YARD]: operatingPoints(fit.yard, "student", thresholds) };
  const fillTarget = chooseFillP(ops[PILOT]!, FILL_PRECISION);
  const fillP = fillTarget ?? Q0_FILL_P;
  const atFill = (rows: Scored[], seed: number) => pairedBootstrap(rows, {
    filledShare: rate((r: Scored) => r.s.student! >= fillP),
    precision: rate((r: Scored) => r.y === 1, (r: Scored) => r.s.student! >= fillP),
    recall: rate((r: Scored) => r.s.student! >= fillP, (r: Scored) => r.y === 1),
  }, REPS, seed);
  const calibration = Object.fromEntries([[PILOT, fit.pilot], [YARD, fit.yard]].map(([set, rows]) => [set as string, {
    student: reliability(rows as Scored[], "student").map((b) => ({ ...b, meanP: b.meanP === null ? null : r4(b.meanP), observed: b.observed === null ? null : r4(b.observed) })),
    baseline: reliability(rows as Scored[], "baseline").map((b) => ({ ...b, meanP: b.meanP === null ? null : r4(b.meanP), observed: b.observed === null ? null : r4(b.observed) })),
  }]));

  // Sensitivity: the floor, and lying boxes let back in.
  log("sensitivity");
  const sens: Record<string, unknown> = {};
  const whole = (b: Box) => b.fragment === "whole";
  for (const [label, floor, lying, only] of [["noFloor", 0, false, null], ["floor0.20", 0.2, false, null], [`floor${FLOOR}`, FLOOR, false, null], ["floor0.25", 0.25, false, null], ["floor0.30", 0.3, false, null], [`floor${FLOOR}+lying`, FLOOR, true, null], [`floor${FLOOR}, whole only (no cut or partial)`, FLOOR, false, whole]] as const) {
    const pick = (b: Box) => inPopulation(floor, lying)(b) && (!only || only(b));
    const p = boxes[PILOT]!.filter(pick), y = boxes[YARD]!.filter(pick);
    const f = label === `floor${FLOOR}` ? fit : fitAll(p, y, CONFIGS.slice(0, 2));
    const s = (rows: Scored[], seed: number) => {
      const b = pairedBootstrap(rows, { student: (r) => aucOf(r, "student"), baseline: (r) => aucOf(r, "baseline"), gain: (r) => { const a = aucOf(r, "student"), c = aucOf(r, "baseline"); return a === null || c === null ? null : a - c; }, filled: rate((r: Scored) => r.y === 1) }, REPS, seed);
      return { n: rows.length, ...b };
    };
    sens[label] = { floor, lying, [PILOT]: s(f.pilot, 51), [YARD]: s(f.yard, 52) };
  }

  // Owner hypothesis.
  log("owner hypothesis: breakdowns");
  const owner = Object.fromEntries(SETS.map((set, k) => [set, {
    breakdown: breakdown(set === PILOT ? pilot : yard, set === PILOT ? fit.pilot : fit.yard, 100 + 100 * k),
    separation: separations(set === PILOT ? pilot : yard, 300 + k),
    topClassShareAllDetected: Object.fromEntries(TOPS.map((c) => [c, r4(boxes[set]!.filter((b) => b.top === c).length / boxes[set]!.length)])),
  }]));

  // Detector fragments (F-0e): how many, how they read, and how the student does on each kind.
  const FRAGS: Fragment[] = ["whole", "cut", "partial"];
  const fragments = Object.fromEntries(SETS.map((set, k) => {
    const all = boxes[set]!, bs = set === PILOT ? pilot : yard, sc = set === PILOT ? fit.pilot : fit.yard;
    const perPhoto = (pred: (b: Box) => boolean, of: (b: Box) => boolean) => {
      const v = byImage(all).map((g) => g.filter(of)).filter((g) => g.length).map((g) => g.filter(pred).length / g.length).sort((a, b) => a - b);
      return v.length ? r4(quantile(v, 0.5)) : null;
    };
    const t = (x: ReturnType<typeof clusterBootstrap>): Interval | null => (x ? [r4(x.value), r4(x.lo), r4(x.hi)] : null);
    return [set, {
      perPhotoMedian: { cutByTile: perPhoto((b) => b.cut, () => true), partialOfUpright: perPhoto((b) => !b.cut && b.fragment === "partial", (b) => !b.lying) },
      population: Object.fromEntries(FRAGS.map((c, j) => {
        const idx = bs.map((b, i) => (b.fragment === c ? i : -1)).filter((i) => i >= 0);
        const rows = idx.map((i) => sc[i]!);
        const a = rows.some((r) => r.y) && rows.some((r) => !r.y)
          ? pairedBootstrap(rows, { student: (r) => aucOf(r, "student"), fragment: (r) => aucOf(r, "diag:student+fragment") }, REPS, 400 + 10 * k + j)
          : null;
        return [c, {
          n: idx.length, share: bs.length ? r4(idx.length / bs.length) : null,
          filled: t(clusterBootstrap(bs, rate((b: Box) => b.y === 1, (b: Box) => b.fragment === c), REPS, 410 + 10 * k + j)),
          aucStudent: a?.student ?? null, aucStudentFragment: a?.fragment ?? null,
        }];
      })),
    }];
  }));

  // Private per-box table for the renders: scores, rungs and geometry, never in the repo.
  mkdirSync(join(run.priv, "table"), { recursive: true });
  for (const set of SETS) {
    const pop = set === PILOT ? pilot : yard, sc = set === PILOT ? fit.pilot : fit.yard;
    const at = new Map(pop.map((b, i) => [b.id, sc[i]!]));
    writeFileSync(join(run.priv, "table", `${set}.jsonl`), boxes[set]!.map((b) => {
      const s = at.get(b.id);
      return JSON.stringify({
        id: b.id, imageId: b.imageId, index: b.index, rung: b.rung, filled: b.y, inPopulation: !!s,
        why: s ? null : b.boxScore < FLOOR ? "below-floor" : b.lying ? "lying" : "incomplete",
        pStudent: s ? r4(s.s.student!) : null, pBaseline: s ? r4(s.s.baseline!) : null, pGeometry: s ? r4(s.s["student+geometry"]!) : null,
        fragment: b.fragment, heightOverBand: b.heightOverBand === null ? null : r4(b.heightOverBand),
        topSeam: b.topSeam, topClass: b.top, topY: b.topY, heightOff: b.heightOff === null ? null : r4(b.heightOff), edge: b.edge, topInView: b.topInView,
      });
    }).join("\n") + "\n");
  }

  const foldDrops = Object.fromEntries(Object.entries(fit.folds).map(([n, ms]) => [n, Object.fromEntries(ms[0]!.features.map((f) => [f, ms.filter((m) => m.dropped.includes(f)).length]))]));
  const metrics = {
    runId: run.id,
    card: run.card,
    date: new Date().toLocaleDateString("en-CA"),
    question: run.question,
    inputs: run.inputs,
    labels: "teacher rungs are machine agreement, not accuracy (INV-17); pilot-000 and the yardstick are reported separately, never pooled (OC35); the student is trained on pilot-000 only and scored on the yardstick unchanged (H-0 §4.3)",
    bootstrap: { unit: "photo (cluster), paired across models", reps: REPS, interval: "95 % percentile" },
    teacher: {
      tau, tauRule: run.tau !== undefined ? `fixed at ${run.tau} (diagnostic; not the null procedure)` : `smallest τ on a 0.01 grid at which at most ${TAU_FALSE_RATE * 100} % of null pairs (reader A on one box, reader B on a different box of the same photo) agree; set on pilot-000 only`,
      similarity: `1 - (edit distance from the shorter squashed reading to its closest substring of the longer) / its length; readings shorter than ${MIN_AGREE_CHARS} normalised characters never agree; best over reader pairs and variants`,
      tauStudy,
      floor: FLOOR,
      floorRule: "Q-1's H3 cut (B2 box score), kept: the go-rule result moves little across 0.20-0.30 (sensitivity)",
      population: "box score >= floor, long axis not horizontal (F-0's reader cannot read lying boxes; Q-1 finding 3), the five student features measurable",
      sets: teacher,
    },
    student: {
      label: "teacher rung >= text-read (1) vs spine-found or text-present (0)",
      folds: "pilot-000: leave one photo out (31 fits per model); yardstick: one fit on all of pilot-000, applied unchanged",
      features: Object.fromEntries([...BASE, ...GEOM, VIEW].map((f) => [f.name, f.sign > 0 ? "+ (more is more readable)" : "- (more is less readable)"])),
      baseline: "crop width alone (log short side), direction learned per fold",
      monotone: "active-set: a feature whose standardised weight comes out against its declared sign is dropped and the model refit",
      fullFitWeights: Object.fromEntries(Object.entries(fit.full).map(([n, m]) => [n, { weights: weightsOf(m), intercept: m.model ? r4(m.model.weights[0]!) : null, dropped: m.dropped }])),
      foldsDropping: foldDrops,
      scores,
      calibration,
      goRule: {
        rule: "student AUC >= 0.75 on pilot-000 (leave-one-image-out), and its gain over the crop-width baseline has a 95 % interval excluding 0",
        studentAuc, gainOverBaseline: gain, go,
        robustness: robust,
        signFree: { auc: sp["diag:signFree"]!.auc, gainOverBaseline: sp["diag:signFree"]!.dBaseline, passes: sp["diag:signFree"]!.auc![0] >= 0.75 && excludesZero(sp["diag:signFree"]!.dBaseline!) },
      },
      operatingPoint: {
        rule: `FILL_P = the lowest score at which at least ${FILL_PRECISION * 100} % of predicted fills are measured >= text-read on pilot-000 (leave-one-image-out); if none does, Q-0's starting value ${Q0_FILL_P}`,
        fillP,
        targetMet: fillTarget !== null,
        bestPrecision: r4(Math.max(...ops[PILOT]!.filter((o) => o.filledShare >= 0.05).map((o) => o.precision ?? 0))),
        atFillP: { [PILOT]: atFill(fit.pilot, 61), [YARD]: atFill(fit.yard, 62) },
        curve: Object.fromEntries(Object.entries(ops).map(([k, v]) => [k, v.map((o) => ({ fillP: o.fillP, filledShare: r4(o.filledShare), precision: o.precision === null ? null : r4(o.precision), recall: o.recall === null ? null : r4(o.recall) }))])),
      },
      sensitivity: sens,
    },
    fragments: {
      why: run.id === "Q2"
        ? "many pilot-000 boxes are pieces of a spine (a detector tile edge cut them, or they are much shorter than their band); F-0e is fixing the detector, so these results may shift once it lands"
        : "the same fragment measures on the current default boxes (F-0e bands+strips on pilot-000), to compare with Q-2's",
      definitions: { cut: "F-0's per-box flag: cut by a detector tile edge", partial: `not cut, box long side < ${PARTIAL_BAND} of its shelf band's height`, whole: "neither" },
      features: "diag:student+fragment adds cutByTile (-) and heightOverBand (+, capped at 1.5, missing = 1) to the student",
      sets: fragments,
    },
    ownerHypothesis: {
      ownerSaid: "top edges are missed at frame edges and in oblique views where a book's top face shows beside its spine",
      features: {
        heightOffBand: "|log(box long side / median long side of the boxes in its shelf band)|; 0 when the band has fewer than 3 boxes",
        topSeamOff: `|offset| of the strongest colour step across the spine near its top (helpers/coverage/geometry.py), as a share of the long side; > ${SEAM_OFF} inside = overshoot, < -${SEAM_OFF} = cut`,
      },
      cells: { edge: `radial > ${EDGE_RADIAL} (Q-1 H2)`, topInView: `top end below ${TOP_IN_VIEW_Y} of the frame height (camera looks down onto the top: a geometric proxy, not a detector)` },
      sets: owner,
    },
  };
  const pre = run.prelude?.(metrics);
  const out = pre ? { ...metrics, ...pre.json } : metrics;
  const dir = run.evalDir;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "metrics.json"), compactJson(out) + "\n");
  const reportPath = join(dir, "report.md");
  const marker = markerOf(run);
  const head = existsSync(reportPath) ? readFileSync(reportPath, "utf8").split(marker)[0]! : `# ${run.id}: teacher table and first student\n\n`;
  writeFileSync(reportPath, head + marker + "\n\n" + (pre ? pre.md + "\n" : "") + tables(metrics as unknown as Metrics));
  log(`aggregates -> ${run.id} metrics.json, report.md (go: ${go}, FILL_P ${fillP})`);
}

// --- report tables ---------------------------------------------------------------------------------------

const markerOf = (run: Run) => `<!-- Tables below are generated by \`node src/eval/${run.cli} analyse\`; edit above this line only. -->`;
type Tri = Interval | null;
interface Cell { n: number; photos: number; filled: Tri; byTop: Record<string, { n: number; share: number | null; filled: Tri }>; aucStudent: Tri; aucGeometry: Tri; dAuc: Tri }
interface Metrics {
  runId: string;
  teacher: { tau: number; floor: number; tauStudy: Record<string, { nullPairs: number; sweep: { tau: number; nullPass: number | null; acceptedPass: number | null; noCatalogMatchPass: number | null }[] }>; sets: Record<string, { photos: number; detected: { n: number; rungs: Record<string, number> }; belowFloor: { n: number; rungs: Record<string, number> }; lyingAtOrAboveFloor: { n: number; rungs: Record<string, number> }; incompleteFeatures: number; population: { n: number; rungs: Record<string, number> }; populationFilled: Tri; acceptedNotInAnnotations: number | null }> };
  student: {
    fullFitWeights: Record<string, { weights: Record<string, number>; intercept: number | null; dropped: string[] }>;
    foldsDropping: Record<string, Record<string, number>>;
    scores: Record<string, { n: number; photos: number; filledShare: Tri; models: Record<string, Record<string, Tri>> }>;
    calibration: Record<string, Record<string, { lo: number; hi: number; n: number; meanP: number | null; observed: number | null }[]>>;
    goRule: { studentAuc: Interval; gainOverBaseline: Interval; go: boolean; robustness: Record<string, Record<string, Tri>>; signFree: { auc: Tri; gainOverBaseline: Tri; passes: boolean } };
    operatingPoint: { fillP: number; targetMet: boolean; bestPrecision: number; atFillP: Record<string, Record<string, Tri> | null>; curve: Record<string, { fillP: number; filledShare: number; precision: number | null; recall: number | null }[]> };
    sensitivity: Record<string, Record<string, unknown>>;
  };
  fragments: { sets: Record<string, { perPhotoMedian: { cutByTile: number | null; partialOfUpright: number | null }; population: Record<string, { n: number; share: number | null; filled: Tri; aucStudent: Tri; aucStudentFragment: Tri }> }> };
  ownerHypothesis: { sets: Record<string, { breakdown: Record<string, Cell>; separation: Record<string, { n: number; auc: Tri }>; topClassShareAllDetected: Record<string, number> }> };
}

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "–" : `${(x * 100).toFixed(0)} %`);
const triPct = (t: Tri) => (t ? `${pct(t[0])} (${(t[1] * 100).toFixed(0)}–${(t[2] * 100).toFixed(0)})` : "–");
const triNum = (t: Tri, d = 2) => (t ? `${t[0].toFixed(d)} (${t[1].toFixed(d)}–${t[2].toFixed(d)})` : "–");
const triSigned = (t: Tri, d = 3) => (t ? `${t[0] >= 0 ? "+" : ""}${t[0].toFixed(d)} (${t[1].toFixed(d)} to ${t[2].toFixed(d)})` : "–");
const short = (s: string) => (s === PILOT ? "pilot-000" : "yardstick B2");

export function tables(m: Metrics): string {
  const out: string[] = [];
  const t = m.teacher, s = m.student;
  out.push("## Teacher table: coverage rung per detected box (B2)\n");
  out.push(`τ = ${t.tau} (string agreement), box-score floor = ${t.floor}. Counts are machine agreement, not accuracy.\n`);
  const rs = RUNGS.slice(2);
  out.push(`| set | group | n | ${rs.join(" | ")} |`, `|---|---|---:|${rs.map(() => "---:").join("|")}|`);
  for (const [set, v] of Object.entries(t.sets)) {
    for (const [g, x] of [["all detected", v.detected], ["below floor", v.belowFloor], ["lying, at/above floor", v.lyingAtOrAboveFloor], ["**student population**", v.population]] as const) {
      out.push(`| ${short(set)} | ${g} | ${x.n} | ${rs.map((r) => `${x.rungs[r]} (${pct(x.n ? x.rungs[r]! / x.n : null)})`).join(" | ")} |`);
    }
  }
  out.push("");
  for (const [set, v] of Object.entries(t.sets)) {
    out.push(`- ${short(set)}: ${v.photos} photos; filled share of the population ${triPct(v.populationFilled)}; ${v.incompleteFeatures} boxes left out for an unmeasurable feature${v.acceptedNotInAnnotations !== null ? `; ${v.acceptedNotInAnnotations} accepted boxes name a work not in the photo's annotations (kept at \`confirmed\`: the teacher cannot see annotations)` : ""}.`);
  }
  out.push("\n### Setting τ: null pairing versus real agreement\n");
  out.push("Null pass: share of null pairs (one reader on a box, another reader on a different box of the same photo) at or above τ. Accepted pass: share of catalog-confirmed boxes whose readers' strings agree at τ. No-match pass: share of `no-catalog-match` boxes promoted to `text-read`.\n");
  out.push("| τ | " + Object.keys(t.tauStudy).map((k) => `${short(k)} null | accepted | no-match`).join(" | ") + " |", "|---:|" + Object.keys(t.tauStudy).map(() => "---:|---:|---:").join("|") + "|");
  const sweepRows = t.tauStudy[PILOT]!.sweep;
  for (let i = 0; i < sweepRows.length; i++) {
    const tau = sweepRows[i]!.tau;
    out.push(`| ${tau === t.tau ? `**${tau}**` : tau} | ` + Object.values(t.tauStudy).map((x) => { const r = x.sweep.find((y) => y.tau === tau)!; return `${pct(r.nullPass)} | ${pct(r.acceptedPass)} | ${pct(r.noCatalogMatchPass)}`; }).join(" | ") + " |");
  }
  out.push("\n## Student: AUC, gain over the crop-width baseline, calibration\n");
  out.push("pilot-000 scores are leave-one-image-out; the yardstick is scored by one fit on all of pilot-000, unchanged. Intervals: paired photo bootstrap.\n");
  out.push("| model | " + Object.keys(s.scores).map((k) => `${short(k)} AUC | Δ vs baseline | Δ vs student | ECE | Brier`).join(" | ") + " |", "|---|" + Object.keys(s.scores).map(() => "---:|---:|---:|---:|---:").join("|") + "|");
  for (const n of Object.keys(s.scores[PILOT]!.models)) {
    out.push(`| ${n} | ` + Object.values(s.scores).map((x) => { const v = x.models[n]!; return `${triNum(v.auc ?? null)} | ${triSigned(v.dBaseline ?? null)} | ${triSigned(v.dStudent ?? null)} | ${triNum(v.ece ?? null, 3)} | ${triNum(v.brier ?? null, 3)}`; }).join(" | ") + " |");
  }
  out.push("");
  for (const [set, v] of Object.entries(s.scores)) out.push(`- ${short(set)}: n = ${v.n} boxes in ${v.photos} photos, filled share ${triPct(v.filledShare)}.`);
  out.push("\nWeights of the full pilot-000 fit, on standardised features (0 = dropped by the monotone rule). Folds dropping: of 31 leave-one-out fits, how many dropped the feature.\n");
  const feats = [...new Set(Object.values(s.fullFitWeights).flatMap((w) => Object.keys(w.weights)))];
  out.push(`| model | ${feats.join(" | ")} | dropped (full fit) |`, `|---|${feats.map(() => "---:").join("|")}|---|`);
  for (const [n, w] of Object.entries(s.fullFitWeights)) {
    out.push(`| ${n} | ${feats.map((f) => (f in w.weights ? `${w.weights[f]!.toFixed(2)}${s.foldsDropping[n]?.[f] ? ` (${s.foldsDropping[n]![f]}/31)` : ""}` : "")).join(" | ")} | ${w.dropped.join(", ") || "–"} |`);
  }
  out.push("\n### Reliability (student; 10 equal-width bins of the predicted score)\n");
  out.push("| bin | " + Object.keys(s.calibration).map((k) => `${short(k)} n | mean score | measured filled`).join(" | ") + " |", "|---|" + Object.keys(s.calibration).map(() => "---:|---:|---:").join("|") + "|");
  for (let b = 0; b < 10; b++) {
    const c = Object.values(s.calibration).map((x) => x.student![b]!);
    out.push(`| ${c[0]!.lo.toFixed(1)}–${c[0]!.hi.toFixed(1)} | ` + c.map((x) => `${x.n} | ${x.meanP === null ? "–" : x.meanP.toFixed(2)} | ${x.observed === null ? "–" : x.observed.toFixed(2)}`).join(" | ") + " |");
  }
  const g = s.goRule;
  out.push("\n## Go rule\n");
  out.push(`Student AUC on pilot-000 ${triNum(g.studentAuc)} (rule: ≥ 0.75); gain over crop width ${triSigned(g.gainOverBaseline)} (rule: interval excludes 0). **${g.go ? "GO" : "NO-GO"}** on the predicted fill.\n`);
  out.push(`Unrounded: student ${g.studentAuc[0].toFixed(3)}; sign-free diagnostic ${g.signFree.auc ? g.signFree.auc[0].toFixed(3) : "–"}.\n`);
  out.push("Robustness (paired photo bootstrap). Oracle width: crop width ranked in the better direction with hindsight, no folds. Against each negative: filled boxes versus `spine-found` only, and versus `text-present` only. In-sample: the full pilot-000 fit scored on its own training rows (optimistic).\n");
  out.push(`| set | oracle width AUC | student − oracle width | student vs spine-found | student vs text-present | student in-sample |`, "|---|---:|---:|---:|---:|---:|");
  for (const [set, r] of Object.entries(g.robustness)) out.push(`| ${short(set)} | ${triNum(r.oracleWidthAuc ?? null)} | ${triSigned(r.gainOverOracleWidth ?? null)} | ${triNum(r.studentVsSpineFound ?? null)} | ${triNum(r.studentVsTextPresent ?? null)} | ${triNum(r.studentInSample ?? null)} |`);
  out.push("");
  out.push(`Diagnostic, not the go rule: the same five features with every direction learned give ${triNum(g.signFree.auc)}, gain ${triSigned(g.signFree.gainOverBaseline)} (${g.signFree.passes ? "would pass" : "would not pass"}).\n`);
  const op = s.operatingPoint;
  out.push("## Operating point (FILL_P)\n");
  out.push(op.targetMet ? `FILL_P = **${op.fillP}** (reaches the precision target).\n` : `No score reaches the precision target on pilot-000 (best ${pct(op.bestPrecision)} where at least 5 % are filled). FILL_P = **${op.fillP}**, Q-0's starting value, proposed unchanged.\n`);
  out.push("| set | filled share | precision (measured ≥ text-read) | recall |", "|---|---:|---:|---:|");
  for (const [set, v] of Object.entries(op.atFillP)) if (v) out.push(`| ${short(set)} | ${triPct(v.filledShare ?? null)} | ${triPct(v.precision ?? null)} | ${triPct(v.recall ?? null)} |`);
  out.push("\n| score ≥ | " + Object.keys(op.curve).map((k) => `${short(k)} filled | precision | recall`).join(" | ") + " |", "|---:|" + Object.keys(op.curve).map(() => "---:|---:|---:").join("|") + "|");
  for (let i = 0; i < op.curve[PILOT]!.length; i++) {
    const c = Object.values(op.curve).map((x) => x[i]!);
    out.push(`| ${c[0]!.fillP.toFixed(2)} | ` + c.map((x) => `${pct(x.filledShare)} | ${pct(x.precision)} | ${pct(x.recall)}`).join(" | ") + " |");
  }
  out.push("\n## Sensitivity: box-score floor, lying boxes, detector fragments\n");
  out.push("| population | " + SETS.map((k) => `${short(k)} n | student AUC | baseline AUC | gain | filled`).join(" | ") + " |", "|---|" + SETS.map(() => "---:|---:|---:|---:|---:").join("|") + "|");
  for (const [label, v] of Object.entries(s.sensitivity)) {
    out.push(`| ${label} | ` + SETS.map((k) => { const x = v[k] as { n: number; student: Tri; baseline: Tri; gain: Tri; filled: Tri }; return `${x.n} | ${triNum(x.student)} | ${triNum(x.baseline)} | ${triSigned(x.gain)} | ${triPct(x.filled)}`; }).join(" | ") + " |");
  }
  const pending = m.runId === "Q2";
  out.push(`\n## Detector fragments${pending ? " (F-0e pending)" : ""}\n`);
  out.push(`Cut: ${pending ? "F-0" : "the detector"} flagged the box as cut by a detector tile edge. Partial: not cut, but shorter than ${PARTIAL_BAND} of its shelf band's height. Per-photo medians over all detected boxes (partial: over upright boxes). The student columns score the go-rule student on each kind; +fragment adds the cut flag and height over band (a separate row, outside the go rule).${pending ? " These results may shift once F-0e lands." : ""}\n`);
  out.push("| set | kind | n | share of population | filled | student AUC | student+fragment AUC |", "|---|---|---:|---:|---:|---:|---:|");
  for (const [set, v] of Object.entries(m.fragments.sets)) {
    for (const [c, x] of Object.entries(v.population)) out.push(`| ${short(set)} | ${c} | ${x.n} | ${pct(x.share)} | ${triPct(x.filled)} | ${triNum(x.aucStudent)} | ${triNum(x.aucStudentFragment)} |`);
  }
  out.push("");
  for (const [set, v] of Object.entries(m.fragments.sets)) out.push(`- ${short(set)}: per photo, median ${pct(v.perPhotoMedian.cutByTile)} of boxes cut by a tile edge and ${pct(v.perPhotoMedian.partialOfUpright)} of upright boxes partial.`);
  out.push("\n## Owner hypothesis: top edges at frame edges and in oblique views\n");
  out.push("Single-feature separation of filled from not filled (AUC > 0.5: larger values go with filled).\n");
  const sep = (k: string) => Object.values(m.ownerHypothesis.sets).map((x) => triNum(x.separation[k]?.auc ?? null)).join(" | ");
  out.push(`| feature | ${SETS.map(short).join(" | ")} |`, "|---|---:|---:|");
  for (const k of Object.keys(m.ownerHypothesis.sets[PILOT]!.separation)) out.push(`| ${k} | ${sep(k)} |`);
  out.push("\nTop-seam class over all detected boxes: " + SETS.map((k) => `${short(k)} ${Object.entries(m.ownerHypothesis.sets[k]!.topClassShareAllDetected).map(([c, v]) => `${c} ${pct(v)}`).join(", ")}`).join("; ") + ".\n");
  out.push("Breakdown by frame position and by whether the camera looks down onto the top (student population). Filled: teacher share ≥ text-read. Top classes: share of boxes and their filled share. ΔAUC: student+geometry minus student, within the cell.\n");
  for (const set of SETS) {
    out.push(`**${short(set)}**\n`);
    out.push("| cell | n | photos | filled | clean: share, filled | overshoot: share, filled | cut: share, filled | student AUC | +geometry AUC | ΔAUC |", "|---|---:|---:|---:|---|---|---|---:|---:|---:|");
    for (const [k, c] of Object.entries(m.ownerHypothesis.sets[set]!.breakdown)) {
      const tc = (x: string) => `${pct(c.byTop[x]!.share)}, ${triPct(c.byTop[x]!.filled)}`;
      out.push(`| ${k} | ${c.n} | ${c.photos} | ${triPct(c.filled)} | ${tc("clean")} | ${tc("overshoot")} | ${tc("cut")} | ${triNum(c.aucStudent)} | ${triNum(c.aucGeometry)} | ${triSigned(c.dAuc)} |`);
    }
    out.push("");
  }
  return out.join("\n") + "\n";
}

// --- renders ---------------------------------------------------------------------------------------------

export function render(run: Run, sets = SETS): void {
  const py = python();
  const m = JSON.parse(readFileSync(join(run.evalDir, "metrics.json"), "utf8")) as { student: { operatingPoint: { fillP: number | null } } };
  const fillP = m.student.operatingPoint.fillP ?? 0.7;
  for (const set of sets) {
    const out = join(run.priv, "renders", set);
    mkdirSync(out, { recursive: true });
    const r = spawnSync(py, ["-I", join(HELPER, "render_q2.py"), "--detect", join(run.sets[set]!.stage, "detect.jsonl"), "--images", run.sets[set]!.images, "--table", join(run.priv, "table", `${set}.jsonl`), "--fill-p", String(fillP), "--seam-off", String(SEAM_OFF), "--out", out, "--label", set], { stdio: ["ignore", "inherit", "inherit"] });
    if (r.status !== 0) throw new Error(`render_q2.py failed on ${set}`);
  }
  log(`renders written under the data root's private/${run.id.toLowerCase()}/renders/`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  if (cmd === "geometry") geometry(Q2_RUN);
  else if (cmd === "analyse") analyse(Q2_RUN);
  else if (cmd === "render") render(Q2_RUN);
  else if (cmd === "all") { geometry(Q2_RUN); analyse(Q2_RUN); render(Q2_RUN); }
  else {
    process.stderr.write("usage: q2-cli.ts geometry | analyse | render | all\n");
    process.exit(2);
  }
}
