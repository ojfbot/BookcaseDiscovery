// F-0f runner: per-row perspective (Part A) and shelf labels and cards (Part B), on each set's cached default boxes.
//
//   node src/eval/f0f-cli.ts detect <set> <arm>     # detect.py post step `angles` | `tops` | `ends` on the cached default
//   node src/eval/f0f-cli.ts geometry <set> <arm>   # Q-2's top seam per box (helpers/coverage/geometry.py); arm `base` too
//   node src/eval/f0f-cli.ts read <set> <arm>       # F-0's readers on the boxes the arm changed; the rest keep their readings
//   node src/eval/f0f-cli.ts probe <set>            # pixel probe per spine-path and cover box (helpers/label/probe.py)
//   node src/eval/f0f-cli.ts analyse                # evals/F0f/{metrics.json,report.md} tables (aggregates only)
//   node src/eval/f0f-cli.ts render                 # the data root's private/f0f/renders/pilot-000/index.html (private)
//
// <set> is pilot-000 or yardstick. Arms are post steps on the base's cached boxes (`detect.py --from`), so a box an arm
// leaves alone keeps its polygon and its cached readings, copied under its new position; only changed boxes are read.
// Everything per box or per photo stays under the data root's `f0f/` and `private/f0f/`; only aggregates reach evals/F0f/.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Candidate } from "../catalog/retrieve.ts";
import { openCatalog } from "../catalog/cli.ts";
import { dataRoot } from "../ledger/images.ts";
import { COVER_CROP, F0_CROP } from "../perceive/crop.ts";
import { decide, loadReadings, pyReaderStage, readJsonl, visionStage, type Detection, type InputImage, type Reading, type ReaderName, type SpineDecision } from "./f0.ts";
import { coverReading, kinds, type KindedBox } from "./f0c.ts";
import { imagesOf, SETS, type SetName, type Slim } from "./f0c-cli.ts";
import { agreementChange, titleDelta, type RungCounts, type Tri } from "./f0e.ts";
import { evidenceOf, KEEP, LABEL, offRow, perspectiveBoxes, ROW, rowPerspective, seamCut, seamError, seamOvershoot, shortTop, THIRDS, TOPS_SHORT, type BoxEvidence, type PerspectiveBox } from "./f0f.ts";
import { yardstickTruth } from "./q1-cli.ts";
import { clusterBootstrap, quantile, rate, rng } from "./q1.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const ROOT = dataRoot();
const PRIV = join(ROOT, "private", "f0f");
const log = (s: string): void => console.error(`[f0f] ${s}`);

export const ARMS = ["angles", "tops", "ends"] as const;
export type ArmName = (typeof ARMS)[number];
const SETS_F0F: SetName[] = ["pilot-000", "yardstick"];

/** Where each set's base boxes and readings are (F-0e's default on pilot-000, F-0's B2 run on the yardstick). */
const baseDir = (set: SetName) => SETS[set].base;
const armDir = (set: SetName, arm: ArmName | "base") => (arm === "base" ? baseDir(set) : join(ROOT, "f0f", set, arm));
const loadDets = (path: string): Map<string, Detection> => new Map(readJsonl<Detection>(path).filter((d) => !d.error).map((d) => [d.id, d]));
const imagesList = (set: SetName) => {
  mkdirSync(PRIV, { recursive: true });
  const path = join(PRIV, `images-${set}.jsonl`);
  writeFileSync(path, imagesOf(set).map((i) => `${JSON.stringify({ id: i.id, image: i.path })}\n`).join(""));
  return path;
};
/** Both bases were read with F-0's original crop (their records carry no `crop`), so changed boxes are read the same way. */
const METHOD = F0_CROP;

function helper(dir: string, script: string, args: string[], env: Record<string, string>, stdin: string | null, out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("uv", ["run", "--project", join(REPO, "helpers", dir), "python", "-I", join(REPO, "helpers", dir, script), ...args], {
      stdio: [stdin === null ? "ignore" : "pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    let buf = "";
    writeFileSync(out, "");
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (c: string) => {
      buf += c;
      const lines = buf.split("\n");
      buf = lines.pop()!;
      for (const l of lines) if (l.trim()) appendFileSync(out, `${l}\n`);
    });
    child.stderr!.setEncoding("utf8");
    // Progress lines may name a photo by a hash prefix: drop it, as F-0e does.
    child.stderr!.on("data", (c: string) => c.split("\n").filter((l) => /^(detect|tops|probe|geometry):/.test(l)).forEach((l) => log(l.replace(/ [0-9a-f]{12} /, " ").slice(0, 120))));
    if (stdin !== null) child.stdin!.end(stdin);
    child.once("error", reject);
    child.once("close", (code) => (code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`))));
  });
}

// --- detect, geometry, probe --------------------------------------------------------------------------------

async function detect(set: SetName, arm: ArmName): Promise<void> {
  const dir = armDir(set, arm);
  mkdirSync(dir, { recursive: true });
  // pilot-000's base is F-0e's bands+strips (strips again is a no-op on it); the yardstick keeps F-0's grid.
  const env: Record<string, string> =
    set === "pilot-000" ? { F0_ARM: "b2", F0_LAYOUT: "bands", F0_POST: `strips,${arm}` } : { F0_ARM: "b2", F0_TILE: "3100", F0_OVERLAP: "1300", F0_POST: arm };
  const reqs = readFileSync(imagesList(set), "utf8");
  await helper("label", "detect.py", ["--from", join(baseDir(set), "detect.jsonl")], env, reqs, join(dir, "detect.jsonl"));
}

const geometryPath = (set: SetName, arm: ArmName | "base") => join(PRIV, `geometry-${set}-${arm}.jsonl`);

async function geometryOf(set: SetName, arm: ArmName | "base"): Promise<void> {
  await helper("coverage", "geometry.py", ["--detect", join(armDir(set, arm), "detect.jsonl"), "--images", imagesList(set)], {}, null, geometryPath(set, arm));
}

const probePath = (set: SetName) => join(PRIV, `probe-${set}.jsonl`);

async function probe(set: SetName): Promise<void> {
  // F-0c's detections: the base's spines verbatim plus the cover pass's boxes.
  await helper("label", "probe.py", ["--detect", join(ROOT, "f0c", set, "detect.jsonl"), "--images", imagesList(set)], {}, null, probePath(set));
}

// --- read: only the boxes an arm changed -------------------------------------------------------------------

type Quad = Detection["spines"][number]["polygon"];
/** Corners this close (px) are the same corner: `detect.py --from` re-derives each rectangle, which can move a
 * cached corner by a rounding step or start the corner list elsewhere. */
const SAME_PX = 1;
const sameQuad = (a: Quad, b: Quad) => a.every((p) => b.some((q) => Math.abs(p[0] - q[0]) <= SAME_PX && Math.abs(p[1] - q[1]) <= SAME_PX));

/** Arm box index -> base box index, for boxes the arm left as they were (every corner within SAME_PX). */
export function unchanged(base: Detection, arm: Detection): Map<number, number> {
  const byX = base.spines.map((s, i) => ({ i, x: Math.min(...s.polygon.map((p) => p[0])) })).sort((a, b) => a.x - b.x);
  const used = new Set<number>();
  const out = new Map<number, number>();
  arm.spines.forEach((s, j) => {
    const x = Math.min(...s.polygon.map((p) => p[0]));
    let lo = 0;
    while (lo < byX.length && byX[lo]!.x < x - SAME_PX) lo++;
    for (let k = lo; k < byX.length && byX[k]!.x <= x + SAME_PX; k++) {
      const i = byX[k]!.i;
      if (!used.has(i) && sameQuad(s.polygon, base.spines[i]!.polygon)) {
        out.set(j, i);
        used.add(i);
        break;
      }
    }
  });
  return out;
}

/** Copy each unchanged box's cached readings under its position in the arm (once; an existing stage file is kept). */
function seed(set: SetName, arm: ArmName): void {
  const dir = armDir(set, arm);
  const base = loadDets(join(baseDir(set), "detect.jsonl"));
  const dets = loadDets(join(dir, "detect.jsonl"));
  for (const reader of ["vision", "ppocr", "qwen"] as ReaderName[]) {
    const out = join(dir, `${reader}.jsonl`);
    if (existsSync(out)) continue;
    const cached = new Map(readJsonl<Reading & { id: string }>(join(baseDir(set), `${reader}.jsonl`)).map((r) => [r.id, r]));
    const lines: string[] = [];
    for (const [id, d] of dets) {
      const b = base.get(id);
      if (!b) continue;
      for (const [j, i] of unchanged(b, d)) {
        const r = cached.get(`${id}:${i}`);
        if (r) lines.push(JSON.stringify({ ...r, id: `${id}:${j}` }));
      }
    }
    writeFileSync(out, lines.length ? lines.join("\n") + "\n" : "");
  }
}

const slim = (d: SpineDecision): Slim => ({ id: d.id, imageId: d.imageId, accepted: d.accepted?.workId ?? null, confirmed: d.confirmed, readText: d.readText, reason: d.reason });

/** F-0's decision on every box of one arm (or the base) from that folder's readings; cached as decisions-f0f.jsonl. */
function decisions(set: SetName, arm: ArmName | "base", fresh = false): Map<string, Slim> {
  const dir = armDir(set, arm);
  const path = arm === "base" ? join(ROOT, "f0c", set, "base-decisions.jsonl") : join(dir, "decisions-f0f.jsonl");
  if (fresh || !existsSync(path)) {
    const db = openCatalog(SETS[set].catalog);
    const readings = loadReadings(dir);
    const cache = new Map<string, Candidate | undefined>();
    const out: Slim[] = [];
    for (const d of loadDets(join(dir, "detect.jsonl")).values()) d.spines.forEach((s, i) => out.push(slim(decide(db, `${d.id}:${i}`, d.id, s.boxScore, readings.get(`${d.id}:${i}`) ?? {}, cache))));
    writeFileSync(path, out.map((x) => JSON.stringify(x)).join("\n") + "\n");
  }
  return new Map(readJsonl<Slim>(path).map((d) => [d.id, d]));
}

async function read(set: SetName, arm: ArmName): Promise<void> {
  const dir = armDir(set, arm);
  seed(set, arm);
  const dets = loadDets(join(dir, "detect.jsonl"));
  const images: InputImage[] = imagesOf(set).filter((i) => dets.has(i.id));
  await visionStage(images, dets, dir, log, METHOD);
  log("ppocr: reading changed boxes");
  await pyReaderStage("ppocr", images, dets, dir, log, undefined, METHOD);
  // Hard crops to Qwen as F-0 picks them (per photo, highest box score first, capped); cached ones are not re-read.
  const db = openCatalog(SETS[set].catalog);
  const cache = new Map<string, Candidate | undefined>();
  const readings = loadReadings(dir);
  const hard = new Set<string>();
  for (const img of images) {
    (dets.get(img.id)?.spines ?? [])
      .map((s, i) => decide(db, `${img.id}:${i}`, img.id, s.boxScore, readings.get(`${img.id}:${i}`) ?? {}, cache))
      .filter((d) => d.hard && Object.values(d.readText).some(Boolean))
      .sort((a, b) => b.boxScore - a.boxScore)
      .slice(0, SETS[set].qwenCap)
      .forEach((d) => hard.add(d.id));
  }
  log(`qwen: ${hard.size} hard crops`);
  await pyReaderStage("qwen", images, dets, dir, log, hard, METHOD);
  decisions(set, arm, true);
}

// --- analyse: aggregates only ------------------------------------------------------------------------------

const REPS = 2000;
const r4 = (x: number) => Math.round(x * 10000) / 10000;
const triOf = (b: { value: number; lo: number; hi: number } | null): Tri => (b ? [r4(b.value), r4(b.lo), r4(b.hi)] : null);

/** Pooled share of rows where `pred` is true, among rows where it is defined, with a photo-cluster bootstrap. */
const share = <T extends { imageId: string }>(rows: T[], pred: (r: T) => boolean | null): Tri => triOf(clusterBootstrap(rows, rate((r: T) => pred(r) === true, (r: T) => pred(r) !== null), REPS, 1));

/** Paired photo bootstrap of a pooled share, arm minus base, over the photos both have. */
export function pairedShare<T extends { imageId: string }>(base: T[], arm: T[], pred: (r: T) => boolean | null, reps = REPS, seed = 1): Tri {
  const ids = [...new Set(base.map((r) => r.imageId))];
  const count = (rows: T[]) => {
    const m = new Map<string, [number, number]>();
    for (const r of rows) {
      const p = pred(r);
      if (p === null) continue;
      const c = m.get(r.imageId) ?? [0, 0];
      m.set(r.imageId, [c[0] + (p ? 1 : 0), c[1] + 1]);
    }
    return m;
  };
  const b = count(base), a = count(arm);
  const stat = (sample: string[]) => {
    let bk = 0, bn = 0, ak = 0, an = 0;
    for (const id of sample) {
      bk += b.get(id)?.[0] ?? 0;
      bn += b.get(id)?.[1] ?? 0;
      ak += a.get(id)?.[0] ?? 0;
      an += a.get(id)?.[1] ?? 0;
    }
    return bn && an ? ak / an - bk / bn : null;
  };
  const value = stat(ids);
  if (value === null) return null;
  const rand = rng(seed);
  const draws: number[] = [];
  for (let r = 0; r < reps; r++) {
    const v = stat(ids.map(() => ids[Math.floor(rand() * ids.length)]!));
    if (v !== null) draws.push(v);
  }
  draws.sort((x, y) => x - y);
  return [r4(value), r4(quantile(draws, 0.025)), r4(quantile(draws, 0.975))];
}

/** Photo bootstrap of a mean over photos (paired when the values are per-photo differences). */
function meanCI(xs: number[], reps = REPS, seed = 1): Tri {
  if (xs.length === 0) return null;
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const rand = rng(seed);
  const draws: number[] = [];
  for (let r = 0; r < reps; r++) draws.push(mean(Array.from({ length: xs.length }, () => xs[Math.floor(rand() * xs.length)]!)));
  draws.sort((a, b) => a - b);
  return [r4(mean(xs)), r4(quantile(draws, 0.025)), r4(quantile(draws, 0.975))];
}

const seamsOf = (set: SetName, arm: ArmName | "base"): Map<string, number | null> =>
  existsSync(geometryPath(set, arm)) ? new Map(readJsonl<{ id: string; topSeam: number | null }>(geometryPath(set, arm)).map((r) => [r.id, r.topSeam])) : new Map();

function boxesOf(set: SetName, arm: ArmName | "base"): PerspectiveBox[] {
  const seams = seamsOf(set, arm);
  return [...loadDets(join(armDir(set, arm), "detect.jsonl")).values()].flatMap((d) => perspectiveBoxes(d, seams));
}

const MEASURES: Record<string, (b: PerspectiveBox) => boolean | null> = {
  partial: (b) => b.partial,
  seamError,
  seamCut,
  seamOvershoot,
  shortTop,
  offRow,
};

/** Part A's diagnosis on the base: every measure by the row's third of the frame, plus the rows' perspective. */
function diagnose(set: SetName) {
  const boxes = boxesOf(set, "base");
  const rows = [...loadDets(join(baseDir(set), "detect.jsonl")).values()].flatMap(rowPerspective);
  const med = (xs: number[]) => (xs.length ? r4(quantile([...xs].sort((a, b) => a - b), 0.5)) : null);
  const by = (pick: (b: PerspectiveBox) => boolean) => {
    const bs = boxes.filter(pick);
    return { boxCount: bs.length, photos: new Set(bs.map((b) => b.imageId)).size, ...Object.fromEntries(Object.entries(MEASURES).map(([k, f]) => [k, share(bs, f)])) };
  };
  return {
    uprightBoxes: boxes.length,
    withRow: boxes.filter((b) => b.shortOfTop !== null).length,
    withSeam: boxes.filter((b) => b.seam !== null).length,
    all: by(() => true),
    byThird: Object.fromEntries(THIRDS.map((t) => [t, by((b) => b.third === t)])),
    rows: Object.fromEntries(
      THIRDS.map((t) => {
        const rs = rows.filter((r) => r.third === t);
        return [t, { rows: rs.length, convergenceP50: med(rs.map((r) => r.convergence)), convergingDown: rs.length ? r4(rs.filter((r) => r.convergence < 0).length / rs.length) : null, topSlopeAbsP50: med(rs.map((r) => Math.abs(r.topSlope))) }];
      }),
    ),
  };
}

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

/** One arm against the base: box changes and measures (paired), and, once read, reads and yardstick titles. */
function compare(set: SetName, arm: ArmName) {
  const baseDets = loadDets(join(baseDir(set), "detect.jsonl"));
  const dets = loadDets(join(armDir(set, arm), "detect.jsonl"));
  if (dets.size === 0) return null;
  let changed = 0, removed = 0, boxes = 0;
  for (const [id, d] of dets) {
    const keep = unchanged(baseDets.get(id)!, d);
    boxes += d.spines.length;
    changed += d.spines.length - keep.size;
    removed += baseDets.get(id)!.spines.length - keep.size;
  }
  const base = boxesOf(set, "base");
  const armBoxes = boxesOf(set, arm);
  const out: Record<string, unknown> = {
    arm,
    photos: dets.size,
    boxCount: boxes,
    baseBoxes: [...baseDets.values()].reduce((s, d) => s + d.spines.length, 0),
    newBoxes: changed,
    replacedBoxes: removed,
    measures: Object.fromEntries(Object.entries(MEASURES).map(([k, f]) => [k, { base: share(base, f), arm: share(armBoxes, f), delta: pairedShare(base, armBoxes, f) }])),
    measuresBottomThird: Object.fromEntries(Object.entries(MEASURES).map(([k, f]) => [k, pairedShare(base.filter((b) => b.third === "bottom"), armBoxes.filter((b) => b.third === "bottom"), f)])),
    detectSecondsPerPhoto: meanCI([...dets.values()].map((d) => d.seconds - (baseDets.get(d.id)?.seconds ?? 0))),
  };
  if (!existsSync(join(armDir(set, arm), "decisions-f0f.jsonl"))) return out;
  const bd = decisions(set, "base");
  const ad = decisions(set, arm);
  const ids = [...dets.keys()];
  const sideOf = (dec: Map<string, Slim>, ds: Map<string, Detection>, id: string) => (ds.get(id)?.spines ?? []).map((_, i) => dec.get(`${id}:${i}`)!).filter(Boolean);
  const br = ids.map((id) => rungs(id, sideOf(bd, baseDets, id)));
  const ar = ids.map((id) => rungs(id, sideOf(ad, dets, id)));
  out.reads = { ...agreementChange(br, ar), worksLostPerPhoto: meanCI(ids.map((id) => [...works(sideOf(bd, baseDets, id))].filter((w) => !works(sideOf(ad, dets, id)).has(w)).length)) };
  // The boxes the arm changed, before and after: did their reads improve? (`angles`' keep rule.)
  const changedRows = (dec: Map<string, Slim>, ds: Map<string, Detection>, other: Map<string, Detection>, flip: boolean) =>
    ids.flatMap((id) => {
      const d = ds.get(id)!;
      const keep = flip ? new Set(unchanged(d, other.get(id)!).keys()) : new Set(unchanged(other.get(id)!, d).keys());
      return d.spines.flatMap((_, i) => (keep.has(i) ? [] : [{ imageId: id, d: dec.get(`${id}:${i}`)! }])).filter((r) => r.d);
    });
  const before = changedRows(bd, baseDets, dets, true);
  const after = changedRows(ad, dets, baseDets, false);
  out.changedBoxReads = {
    before: { boxCount: before.length, textRead: before.filter((r) => isTextRead(r.d)).length, confirmed: before.filter((r) => r.d.accepted).length },
    after: { boxCount: after.length, textRead: after.filter((r) => isTextRead(r.d)).length, confirmed: after.filter((r) => r.d.accepted).length },
    confirmedShareDelta: pairedShare(before, after, (r) => r.d.accepted !== null),
    textReadShareDelta: pairedShare(before, after, (r) => isTextRead(r.d)),
  };
  if (set === "yardstick") {
    const truth = yardstickTruth();
    const counts = (dec: Map<string, Slim>, ds: Map<string, Detection>): [number, number, number][] =>
      ids.map((id) => {
        const t = truth.get(id) ?? new Set<string>();
        const w = works(sideOf(dec, ds, id));
        return [t.size, [...w].filter((x) => t.has(x)).length, w.size];
      });
    const b = counts(bd, baseDets), a = counts(ad, dets);
    const sum = (c: [number, number, number][], k: 0 | 1 | 2) => c.reduce((s, x) => s + x[k], 0);
    out.titles = {
      base: { annotated: sum(b, 0), hits: sum(b, 1), accepted: sum(b, 2) },
      arm: { annotated: sum(a, 0), hits: sum(a, 1), accepted: sum(a, 2) },
      delta: titleDelta(b, a),
      wrongPerImage: meanCI(a.map((x, i) => x[2] - x[1] - (b[i]![2] - b[i]![1]))),
    };
  }
  return out;
}

// --- Part B: shelf labels and cards ------------------------------------------------------------------------

/**
 * Each box's label evidence on one set: spine-path boxes `s<i>` from the base's Vision and PP-OCR readings (what the
 * pipeline has when it applies the rules, before Qwen), covers `c<j>` from all three of F-0c's cover readings.
 */
export function evidenceFor(set: SetName): Map<string, (ref: string) => BoxEvidence | undefined> {
  const spine = loadReadings(baseDir(set));
  const cover = loadReadings(join(ROOT, "f0c", set, "covers"), COVER_CROP);
  const probes = new Map(readJsonl<{ id: string; white: number; edges: number }>(probePath(set)).map((p) => [p.id, p]));
  const out = new Map<string, (ref: string) => BoxEvidence | undefined>();
  for (const id of loadDets(join(ROOT, "f0c", set, "detect.jsonl")).keys())
    out.set(id, (ref) => {
      const r = (ref.startsWith("s") ? spine : cover).get(`${id}:${ref.slice(1)}`);
      if (!r) return undefined;
      return evidenceOf(ref.startsWith("s") ? { vision: r.vision, ppocr: r.ppocr } : r, probes.get(`${id}:${ref}`));
    });
  return out;
}

/** F-0's decision on F-0c's kept covers (as f0c-cli's coverDecisions), keyed `<image>:c<j>`. */
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
      out.set(`${d.id}:c${j}`, slim(decide(db, `${d.id}:c${j}`, d.id, c.boxScore, reads, cache)));
    }
  return out;
}

function labels(set: SetName) {
  const dets = loadDets(join(ROOT, "f0c", set, "detect.jsonl"));
  const ev = evidenceFor(set);
  const base = decisions(set, "base");
  const covers = coverDecisions(set, dets);
  const tally = (bs: { b: KindedBox; d: Slim | undefined }[]) => {
    const byWhy: Record<string, number> = {};
    for (const x of bs) byWhy[x.b.why] = (byWhy[x.b.why] ?? 0) + 1;
    return { removed: bs.length, byWhy, removedConfirmed: bs.filter((x) => x.d?.accepted).length, removedTextRead: bs.filter((x) => x.d && isTextRead(x.d)).length };
  };
  const spineRemoved: { b: KindedBox; d: Slim | undefined }[] = [];
  const coverRemoved: { b: KindedBox; d: Slim | undefined }[] = [];
  let spineBoxes = 0, coversKept = 0;
  const perPhoto: { imageId: string; before: Slim[]; after: Slim[]; coversBefore: number; coversAfter: number }[] = [];
  for (const d of dets.values()) {
    const e = ev.get(d.id)!;
    // The spine path with the cover pass off (the shipped default): F-0c's flags, then the label rules on top.
    const k0 = kinds({ ...d, covers: [] });
    const k1 = kinds({ ...d, covers: [] }, e);
    spineBoxes += d.spines.length;
    k1.spines.forEach((b, i) => {
      if (k0.spines[i]!.kind === "spine" && b.kind === "not-a-book") spineRemoved.push({ b, d: base.get(`${d.id}:${i}`) });
    });
    // F-0c's cover arm with the filter: kept covers the label rules drop.
    const c0 = kinds(d);
    const c1 = kinds(d, e);
    coversKept += c0.covers.length;
    for (const c of c0.covers) if (!c1.covers.some((x) => x.ref === c.ref)) coverRemoved.push({ b: c1.dropped.find((x) => x.ref === c.ref)!, d: covers.get(`${d.id}:${c.ref}`) });
    const spinesOf = (k: typeof c0) => k.spines.flatMap((b, i) => (b.kind === "spine" ? [base.get(`${d.id}:${i}`)!] : []));
    const coversOf = (k: typeof c0) => k.covers.map((c) => covers.get(`${d.id}:${c.ref}`)!).filter(Boolean);
    perPhoto.push({ imageId: d.id, before: [...spinesOf(c0), ...coversOf(c0)], after: [...spinesOf(c1), ...coversOf(c1)], coversBefore: c0.covers.length, coversAfter: c1.covers.length });
  }
  const spineOnly = [...dets.values()].map((d) => {
    const before = kinds({ ...d, covers: [] }).spines.flatMap((b, i) => (b.kind === "spine" ? [base.get(`${d.id}:${i}`)!] : []));
    const after = kinds({ ...d, covers: [] }, ev.get(d.id)!).spines.flatMap((b, i) => (b.kind === "spine" ? [base.get(`${d.id}:${i}`)!] : []));
    return { imageId: d.id, before, after };
  });
  const out: Record<string, unknown> = {
    spinePath: { boxCount: spineBoxes, ...tally(spineRemoved), reads: agreementChange(spineOnly.map((p) => rungs(p.imageId, p.before)), spineOnly.map((p) => rungs(p.imageId, p.after))) },
    coverArm: {
      coversKept,
      ...tally(coverRemoved),
      coversPerPhoto: { before: meanCI(perPhoto.map((p) => p.coversBefore)), after: meanCI(perPhoto.map((p) => p.coversAfter)) },
      reads: agreementChange(perPhoto.map((p) => rungs(p.imageId, p.before)), perPhoto.map((p) => rungs(p.imageId, p.after))),
    },
  };
  if (set === "yardstick") {
    const truth = yardstickTruth();
    const counts = (pick: "before" | "after"): [number, number, number][] =>
      spineOnly.map((p) => {
        const t = truth.get(p.imageId) ?? new Set<string>();
        const w = works(p[pick]);
        return [t.size, [...w].filter((x) => t.has(x)).length, w.size];
      });
    const b = counts("before"), a = counts("after");
    out.titles = { delta: titleDelta(b, a), wrongPerImage: meanCI(a.map((x, i) => x[2] - x[1] - (b[i]![2] - b[i]![1]))) };
  }
  return out;
}

/** The owner's private regression examples: whether each false cover and label is gone (never written to the repo). */
function examples(): Record<string, unknown>[] {
  const path = join(PRIV, "examples.json");
  if (!existsSync(path)) return [];
  const list = JSON.parse(readFileSync(path, "utf8")).examples as { name: string; imageId: string }[];
  const dets = loadDets(join(ROOT, "f0c", "pilot-000", "detect.jsonl"));
  const ev = evidenceFor("pilot-000");
  return list.map((x) => {
    const d = dets.get(x.imageId)!;
    const k = kinds(d, ev.get(d.id)!);
    return { name: x.name, coversBefore: kinds(d).covers.length, coversAfter: k.covers.length, labelled: [...k.dropped, ...k.spines].filter((b) => ["shelf-strip", "shelf-talker", "blank-card"].includes(b.why)).map((b) => `${b.ref} ${b.why}`) };
  });
}

// --- verdicts ----------------------------------------------------------------------------------------------

/** The pre-registered keep rules (evals/F0f/report.md), applied to the measures. */
export function verdicts(m: any) {
  const below0 = (t: Tri) => t !== null && t[2] < 0;
  const above0 = (t: Tri) => t !== null && t[1] > 0;
  const notDown = (t: Tri) => t === null || t[2] >= 0;
  const notUp = (t: Tri) => t === null || t[1] <= 0;
  const out: Record<string, unknown> = {};
  for (const arm of ARMS) {
    const p = m["pilot-000"].arms[arm];
    const y = m.yardstick.arms[arm];
    if (!p) continue;
    const geometry = arm === "angles" ? null : below0(p.measures.partial.delta) && (p.measures.seamError.delta?.[0] ?? 0) < 0;
    const read = p.reads !== undefined;
    const pilotWorks = read ? notDown(p.reads.delta.worksPerPhoto) : null;
    const changedBetter = arm === "angles" && read ? above0(p.changedBoxReads.confirmedShareDelta) : null;
    const yard = y?.titles ? notDown(y.titles.delta?.recall ?? null) && notUp(y.titles.wrongPerImage) : null;
    const ship = (arm === "angles" ? changedBetter : geometry) === true && pilotWorks === true && yard === true;
    out[arm] = { geometry, changedBetter, pilotWorksNotDown: pilotWorks, yardstickUnhurt: yard, ship };
  }
  const lp = m["pilot-000"].labels, ly = m.yardstick.labels;
  out.labelFilter = {
    pilotConfirmedRemoved: lp.spinePath.removedConfirmed + lp.coverArm.removedConfirmed,
    yardstickConfirmedRemoved: ly.spinePath.removedConfirmed + ly.coverArm.removedConfirmed,
    ship: lp.spinePath.removedConfirmed + lp.coverArm.removedConfirmed + ly.spinePath.removedConfirmed + ly.coverArm.removedConfirmed === 0,
  };
  return out;
}

function analyse(): void {
  const metrics: Record<string, any> = { runId: "F0f", card: "F-0f", date: new Date().toLocaleDateString("en-CA"), rules: { ROW, TOPS_SHORT, KEEP, LABEL: { ...LABEL, strip: LABEL.strip.map(String), talker: LABEL.talker.map(String) } } };
  for (const set of SETS_F0F) {
    metrics[set] = {
      scope: SETS[set].scope,
      diagnosis: diagnose(set),
      arms: Object.fromEntries(ARMS.map((a) => [a, compare(set, a)]).filter(([, v]) => v)),
      labels: labels(set),
    };
  }
  metrics.verdicts = verdicts(metrics);
  const out = join(REPO, "evals", "F0f");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
  const report = join(out, "report.md");
  const marker = /<!-- tables -->[\s\S]*<!-- \/tables -->/;
  const prev = readFileSync(report, "utf8");
  const tables = `<!-- tables -->\n${tablesMd(metrics)}<!-- /tables -->`;
  writeFileSync(report, marker.test(prev) ? prev.replace(marker, tables) : `${prev.trimEnd()}\n\n${tables}\n`);
  writeFileSync(join(PRIV, "examples-result.json"), `${JSON.stringify(examples(), null, 2)}\n`);
  log("evals/F0f/ written (aggregates only); owner examples -> the data root's private/f0f/examples-result.json");
}

// --- tables ------------------------------------------------------------------------------------------------

const pc = (t: Tri | undefined): string => (t ? `${(t[0] * 100).toFixed(1)} % (${(t[1] * 100).toFixed(1)}–${(t[2] * 100).toFixed(1)})` : "n/a");
const pts = (t: Tri | undefined): string => (t ? `${t[0] >= 0 ? "+" : ""}${(t[0] * 100).toFixed(1)} pts (${(t[1] * 100).toFixed(1)} to ${(t[2] * 100).toFixed(1)})` : "n/a");
const num = (t: Tri | undefined, d = 2): string => (t ? `${t[0] >= 0 ? "+" : ""}${t[0].toFixed(d)} (${t[1].toFixed(d)} to ${t[2].toFixed(d)})` : "n/a");
const plain = (t: Tri | undefined, d = 2): string => (t ? `${t[0].toFixed(d)} (${t[1].toFixed(d)} to ${t[2].toFixed(d)})` : "n/a");
const MEASURE_NAMES: Record<string, string> = {
  partial: "partial height (band spine height)",
  seamError: "top-seam error (top off the seam by > 0.05)",
  seamCut: "… of it, top cut (seam beyond the box)",
  seamOvershoot: "… of it, overshoot (seam inside the box)",
  shortTop: `top short of the row's top line (> ${TOPS_SHORT} row heights)`,
  offRow: `leaning off the row (> ${ROW.angleDev}°)`,
};

export function tablesMd(m: any): string {
  const out: string[] = [];
  for (const set of SETS_F0F) {
    const s = m[set];
    if (!s) continue;
    const title = set === "pilot-000" ? "`pilot-000` (real use; reads are machine agreement, never accuracy, INV-17)" : "Yardstick (PROXY, library shelves; evaluation only)";
    const dg = s.diagnosis;
    out.push(`### Diagnosis by row elevation: ${title}\n`);
    out.push(`Default boxes: ${dg.uprightBoxes} upright boxes, ${dg.withRow} with a row (three neighbours, two whole), ${dg.withSeam} with a measured top seam. Pooled shares, 95 % photo-cluster bootstrap. A row's third is where its box centre sits in the frame: the top third is seen from below, the bottom third from above.\n`);
    out.push(`| measure | all | top third | middle third | bottom third |\n|---|---:|---:|---:|---:|`);
    out.push(`| upright boxes (photos) | ${dg.all.boxCount} (${dg.all.photos}) | ${THIRDS.map((t) => `${dg.byThird[t].boxCount} (${dg.byThird[t].photos})`).join(" | ")} |`);
    for (const [k, name] of Object.entries(MEASURE_NAMES)) out.push(`| ${name} | ${pc(dg.all[k])} | ${THIRDS.map((t) => pc(dg.byThird[t][k])).join(" | ")} |`);
    out.push(`| boxes whose row holds five or more | | ${THIRDS.map((t) => dg.rows[t].rows).join(" | ")} |`);
    out.push(`| their row's convergence, p50 (degrees of lean per 1000 px; < 0 spines converge downward) | | ${THIRDS.map((t) => dg.rows[t].convergenceP50 ?? "n/a").join(" | ")} |`);
    out.push(`| … converging downward | | ${THIRDS.map((t) => (dg.rows[t].convergingDown === null ? "n/a" : `${(dg.rows[t].convergingDown * 100).toFixed(0)} %`)).join(" | ")} |`);
    out.push(`| … top line, abs slope p50 | | ${THIRDS.map((t) => dg.rows[t].topSlopeAbsP50 ?? "n/a").join(" | ")} |`);
    out.push("");
    const arms = Object.values(s.arms) as any[];
    if (arms.length) {
      out.push(`### Arms against the default boxes: ${title}\n`);
      out.push("Each arm is a post step on the default's cached boxes; changes are arm minus default, paired photo bootstrap (95 %).\n");
      out.push(`| arm | boxes (default ${arms[0].baseBoxes}) | boxes changed | ${Object.values(MEASURE_NAMES).join(" | ")} | post-step s/photo |`);
      out.push(`|---|---:|---:|${Object.keys(MEASURE_NAMES).map(() => "---:").join("|")}|---:|`);
      for (const a of arms) out.push(`| ${a.arm} | ${a.boxCount} | ${a.newBoxes} | ${Object.keys(MEASURE_NAMES).map((k) => pts(a.measures[k].delta)).join(" | ")} | ${plain(a.detectSecondsPerPhoto, 1)} |`);
      out.push(`\nBottom third only: ${arms.map((a) => `${a.arm} partial ${pts(a.measuresBottomThird.partial)}, seam error ${pts(a.measuresBottomThird.seamError)}`).join("; ")}.\n`);
      const read = arms.filter((a) => a.reads);
      if (read.length) {
        out.push("| arm (read) | `text-read` share | confirmed share | confirmed boxes per photo | **distinct confirmed works per photo** | works lost per photo | changed boxes confirmed, before → after | change in their confirmed share |\n|---|---:|---:|---:|---:|---:|---:|---:|");
        for (const a of read) {
          const d = a.reads.delta, c = a.changedBoxReads;
          out.push(`| ${a.arm} | ${pts(d.textReadShare)} | ${pts(d.confirmedShare)} | ${num(d.confirmedPerPhoto)} | **${num(d.worksPerPhoto)}** | ${plain(a.reads.worksLostPerPhoto)} | ${c.before.confirmed}/${c.before.boxCount} → ${c.after.confirmed}/${c.after.boxCount} | ${pts(c.confirmedShareDelta)} |`);
        }
        out.push("");
      }
      const titled = arms.filter((a) => a.titles);
      if (titled.length) {
        out.push("| arm (yardstick titles) | hits / accepted | Δ title recall | Δ title precision | Δ wrong accepts per image |\n|---|---:|---:|---:|---:|");
        out.push(`| default | ${titled[0].titles.base.hits} / ${titled[0].titles.base.accepted} | | | |`);
        for (const a of titled) out.push(`| ${a.arm} | ${a.titles.arm.hits} / ${a.titles.arm.accepted} | ${pts(a.titles.delta?.recall)} | ${pts(a.titles.delta?.precision)} | ${num(a.titles.wrongPerImage)} |`);
        out.push("");
      }
    }
    const l = s.labels;
    out.push(`### Shelf labels and cards: ${title}\n`);
    out.push("*Removed confirmed* is a lower bound on real books removed (two readers agreed on one catalog work); *at `text-read`* an upper hint.\n");
    out.push("| boxes | boxes | removed | by rule | removed confirmed | removed at `text-read` |\n|---|---:|---:|---|---:|---:|");
    out.push(`| default spine path (cover pass off), on top of F-0c's flags | ${l.spinePath.boxCount} | ${l.spinePath.removed} | ${Object.entries(l.spinePath.byWhy).map(([k, v]) => `${k} ${v}`).join(", ") || "none"} | ${l.spinePath.removedConfirmed} | ${l.spinePath.removedTextRead} |`);
    out.push(`| F-0c's kept covers | ${l.coverArm.coversKept} | ${l.coverArm.removed} | ${Object.entries(l.coverArm.byWhy).map(([k, v]) => `${k} ${v}`).join(", ") || "none"} | ${l.coverArm.removedConfirmed} | ${l.coverArm.removedTextRead} |`);
    out.push(`\nF-0c's cover arm with the filter: face-out boxes per photo ${plain(l.coverArm.coversPerPhoto.before)} → ${plain(l.coverArm.coversPerPhoto.after)}; against it without the filter, distinct confirmed works per photo ${num(l.coverArm.reads.delta.worksPerPhoto)}, confirmed share ${pts(l.coverArm.reads.delta.confirmedShare)}. Spine path with the filter against the default: works per photo ${num(l.spinePath.reads.delta.worksPerPhoto)}, confirmed share ${pts(l.spinePath.reads.delta.confirmedShare)}.${l.titles ? ` Yardstick titles: recall ${pts(l.titles.delta?.recall)}, precision ${pts(l.titles.delta?.precision)}, wrong accepts per image ${num(l.titles.wrongPerImage)}.` : ""}\n`);
  }
  const v = m.verdicts;
  out.push("### Keep rules\n");
  out.push("| step | geometry (partial falls, seam error falls) | changed boxes read better | `pilot-000` works not down | yardstick unhurt | ships |\n|---|---|---|---|---|---|");
  const yn = (x: boolean | null | undefined) => (x === null || x === undefined ? "n/a" : x ? "yes" : "no");
  for (const a of ARMS) if (v[a]) out.push(`| ${a} | ${yn(v[a].geometry)} | ${yn(v[a].changedBetter)} | ${yn(v[a].pilotWorksNotDown)} | ${yn(v[a].yardstickUnhurt)} | **${v[a].ship ? "yes" : "no"}** |`);
  out.push(`\nShelf-label filter: confirmed books removed, \`pilot-000\` ${v.labelFilter.pilotConfirmedRemoved}, yardstick ${v.labelFilter.yardstickConfirmedRemoved}: **${v.labelFilter.ship ? "ships" : "does not ship"}**.\n`);
  return out.join("\n") + "\n";
}

// --- render: private before/after page --------------------------------------------------------------------

async function render(): Promise<void> {
  const set: SetName = "pilot-000";
  const examples = existsSync(join(PRIV, "examples.json")) ? (JSON.parse(readFileSync(join(PRIV, "examples.json"), "utf8")).examples as { name: string; imageId: string }[]) : [];
  const base = loadDets(join(baseDir(set), "detect.jsonl"));
  const f0c = loadDets(join(ROOT, "f0c", set, "detect.jsonl"));
  const ev = evidenceFor(set);
  const armName = (process.argv[3] as ArmName | undefined) ?? "tops";
  const arm = loadDets(join(armDir(set, armName), "detect.jsonl"));
  const imgs = imagesOf(set);
  const order = [...examples.map((e) => e.imageId), ...imgs.map((i) => i.id).filter((id) => !examples.some((e) => e.imageId === id))];
  const lines = order.map((id, n) => {
    const d = f0c.get(id)!;
    const k0 = kinds(d);
    const k1 = kinds(d, ev.get(id)!);
    const a = arm.get(id);
    const keep = a ? unchanged(base.get(id)!, a) : new Map<number, number>();
    const kept = new Set(keep.values());
    return JSON.stringify({
      n: n + 1,
      example: examples.find((e) => e.imageId === id)?.name ?? null,
      image: imgs.find((i) => i.id === id)!.path,
      width: d.width,
      height: d.height,
      before: k0.spines.map((b) => ({ polygon: b.polygon, kind: b.kind, why: b.why })).concat(k0.covers.map((c) => ({ polygon: c.polygon, kind: c.kind, why: c.why }))),
      labels: [...k1.spines, ...k1.dropped].filter((b) => ["shelf-strip", "shelf-talker", "blank-card"].includes(b.why)).map((b) => ({ polygon: b.polygon, why: b.why })),
      replaced: base.get(id)!.spines.flatMap((s, i) => (kept.has(i) ? [] : [s.polygon])),
      grown: (a?.spines ?? []).flatMap((s, j) => (keep.has(j) ? [] : [s.polygon])),
    });
  });
  const spec = join(PRIV, "render-pilot-000.jsonl");
  writeFileSync(spec, lines.join("\n") + "\n");
  await helper("label", "render_f0f.py", ["--spec", spec, "--out", join(PRIV, "renders", set), "--arm", armName], {}, null, join(PRIV, "render.log"));
  log(`render written under the data root's private/f0f/renders/${set}/`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, set, arm] = process.argv.slice(2) as [string, SetName, ArmName | "base"];
  if (cmd === "detect") await detect(set, arm as ArmName);
  else if (cmd === "geometry") await geometryOf(set, arm);
  else if (cmd === "read") await read(set, arm as ArmName);
  else if (cmd === "probe") await probe(set);
  else if (cmd === "analyse") analyse();
  else if (cmd === "render") await render();
  else {
    console.error("usage: node src/eval/f0f-cli.ts detect|geometry|read <pilot-000|yardstick> <arm> | probe <set> | analyse | render [arm]");
    process.exit(2);
  }
}
