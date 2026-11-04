// F-0i runner: the instance partition (every visible pixel belongs to at most one book), and the readers on the boxes
// it changes, measured by F-0b's procedure and keep rule plus H-2's works guard and F-0e's yardstick guard
// (pre-registered in evals/F0i/report.md; design docs/models/instance-boundaries.md §5).
//
//   node src/eval/f0i-cli.ts plan <set>       # helpers/coverage/resolve.py plan: the gate, conflict groups, windows (CPU)
//   node src/eval/f0i-cli.ts tiles <set>      # helpers/label/partition.py: SAM 2.1 logits per group, cached (GPU)
//   node src/eval/f0i-cli.ts resolve <set>    # resolve.py resolve: the exclusive partition, provenance, measures (CPU)
//   node src/eval/f0i-cli.ts render <set>     # private before/after page, per-book coloured mask fills
//   node src/eval/f0i-cli.ts run <set> <arm>  # arm: clip (before) | refit | own (refit+own), on the changed set
//   node src/eval/f0i-cli.ts analyse          # evals/F0i/{metrics.json,report.md}: aggregates only
//
// Sets (OC35, never merged): pilot-000 with F-0e's `bands+strips` boxes, Q-2b's outlines and the readers F-0e cached;
// the yardstick with F-0's B2 boxes, F-0b's outlines and F-0's readers. Both after the shipped not-a-book filter
// (Q-2b's kept ids). Everything per box or per photo goes under the data root's `private/f0i/`.
import { spawnSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Candidate } from "../catalog/retrieve.ts";
import { openCatalog } from "../catalog/cli.ts";
import { dataRoot } from "../ledger/images.ts";
import { CROP, decide, loadReadings, pyReaderStage, readJsonl, visionStage, type Detection, type InputImage, type Reading, type SpineDecision } from "./f0.ts";
import { F0_CROP, OWN_CROP, cropFor, cropName, type CropMethod, type Point } from "../perceive/crop.ts";
import { SETS as F0B_SETS, cost, delta, firstPassHard, geometry, type Geo, type Pair } from "./f0b-cli.ts";
import { titleDelta } from "./f0e.ts";
import { compactJson, outcomeOf, yardstickTruth } from "./q1-cli.ts";
import { clusterBootstrap } from "./q1.ts";
import type { Outcome } from "./q1.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const ROOT = dataRoot();
const PRIV = join(ROOT, "private", "f0i");
const REPS = 2000;
const log = (s: string): void => console.error(`[f0i] ${s}`);

export type SetName = "pilot-000" | "yardstick-library-b2";
interface SetCfg { stage: string; outlines: string; table: string; decisions: string; images: string }
const SETS: Record<SetName, SetCfg> = {
  "pilot-000": {
    stage: join(ROOT, "f0e", "pilot-000", "bands+strips"),
    outlines: join(ROOT, "private", "q2b", "outlines", "pilot-000.jsonl"),
    table: join(ROOT, "private", "q2b", "table", "pilot-000.jsonl"),
    decisions: join(ROOT, "private", "h2", "pilot-000", "base-decisions.jsonl"),
    images: join(ROOT, "private", "h2", "pilot-000", "images.jsonl"),
  },
  "yardstick-library-b2": {
    stage: join(ROOT, "f0", "yardstick-library-b2"),
    outlines: join(ROOT, "private", "f0b", "yardstick-library-b2", "outline.jsonl"),
    table: join(ROOT, "private", "q2b", "table", "yardstick-library-b2.jsonl"),
    decisions: join(ROOT, "private", "h2", "yardstick-library-b2", "base-decisions.jsonl"),
    images: join(ROOT, "private", "h2", "yardstick-library-b2", "images.jsonl"),
  },
};
const isSet = (s: string | undefined): s is SetName => s === "pilot-000" || s === "yardstick-library-b2";

export const ARMS: Record<string, CropMethod> = { clip: CROP, refit: CROP, own: OWN_CROP };

/** One box's row in the partition (resolve.py `partition.jsonl`). */
export interface PartRow {
  id: string;
  state: "kept" | "dropped";
  reason: string | null;
  role: "member" | "remainder" | "group-child";
  changed: boolean;
  flagged: boolean;
  refit?: Point[];
}

// --- inputs ----------------------------------------------------------------------------------------------

function py(helper: "coverage" | "label"): string {
  const p = join(REPO, "helpers", helper, ".venv", "bin", "python");
  if (!existsSync(p)) throw new Error(`helpers/${helper} has no .venv: run \`uv sync\` there first`);
  return p;
}

function loadDets(set: SetName): Map<string, Detection> {
  return new Map(readJsonl<Detection>(join(SETS[set].stage, "detect.jsonl")).filter((d) => !d.error).map((d) => [d.id, d]));
}

function inputImages(set: SetName, dets: Map<string, Detection>): InputImage[] {
  const paths = new Map(readJsonl<{ id: string; image: string }>(SETS[set].images).map((x) => [x.id, x.image]));
  return [...dets.keys()].map((id) => {
    const path = paths.get(id);
    if (!path || !existsSync(path)) throw new Error(`image missing for a cached detection in ${set}`);
    return { id, photoHash: id, path, setting: set };
  });
}

/** Box ids the shipped not-a-book rules keep (Q-2b's table, as F-R1 and resolve.py read it). */
const keptIds = (set: SetName): Set<string> => new Set(readJsonl<{ id: string }>(SETS[set].table).map((r) => r.id));

function partition(set: SetName): Map<string, PartRow> {
  const p = join(PRIV, set, "partition.jsonl");
  if (!existsSync(p)) throw new Error(`${set}: no partition; run \`f0i-cli.ts resolve ${set}\` first`);
  return new Map(readJsonl<PartRow>(p).map((r) => [r.id, r]));
}

const split = (id: string): [string, number] => {
  const k = id.lastIndexOf(":");
  return [id.slice(0, k), Number(id.slice(k + 1))];
};

const sameCrop = (a: ReturnType<typeof cropFor>, b: ReturnType<typeof cropFor>): boolean =>
  !!a && !!b && JSON.stringify(a.rotations) === JSON.stringify(b.rotations) && a.polygon.every((p, k) => Math.hypot(p[0] - b.polygon[k]![0], p[1] - b.polygon[k]![1]) <= 1);

/** Detections with each changed box's polygon replaced by its refit box. */
function refitDets(dets: Map<string, Detection>, part: Map<string, PartRow>): Map<string, Detection> {
  const out = new Map<string, Detection>();
  for (const [id, d] of dets)
    out.set(id, { ...d, spines: d.spines.map((s, i) => {
      const r = part.get(`${id}:${i}`);
      return r?.state === "kept" && r.refit ? { ...s, polygon: r.refit as typeof s.polygon } : s;
    }) });
  return out;
}

/** The changed set (pre-registered): kept boxes whose `refit` crop differs from the detection rectangle's crop. */
export function changedSet(dets: Map<string, Detection>, part: Map<string, PartRow>): Set<string> {
  const out = new Set<string>();
  for (const [id, r] of part) {
    if (r.state !== "kept" || !r.refit) continue;
    const [p, i] = split(id);
    const d = dets.get(p), s = d?.spines[i];
    if (!d || !s) continue;
    if (!sameCrop(cropFor({ polygon: r.refit }, d, CROP), cropFor(s, d, CROP))) out.add(id);
  }
  return out;
}

const resolveArgs = (set: SetName): string[] => {
  const c = SETS[set];
  return ["--set", set, "--detect", join(c.stage, "detect.jsonl"), "--outlines", c.outlines, "--table", c.table, "--decisions", c.decisions, "--images", c.images, "--out", join(PRIV, set)];
};

// --- plan, tiles, resolve, render ------------------------------------------------------------------------

function plan(set: SetName): void {
  mkdirSync(join(PRIV, set), { recursive: true });
  const r = spawnSync(py("coverage"), ["-I", join(REPO, "helpers", "coverage", "resolve.py"), "plan", ...resolveArgs(set)], { stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) throw new Error(`resolve.py plan failed on ${set}`);
}

function tiles(set: SetName): void {
  const fd = openSync(join(PRIV, set, "tiles.jsonl"), "w");
  const r = spawnSync(py("label"), ["-I", join(REPO, "helpers", "label", "partition.py"), "--groups", join(PRIV, set, "groups.jsonl"), "--cache", join(PRIV, set, "logits")], {
    stdio: ["ignore", fd, "inherit"],
  });
  closeSync(fd);
  if (r.status !== 0) throw new Error(`partition.py failed on ${set}`);
}

function resolve(set: SetName): void {
  const fd = openSync(join(PRIV, set, "metrics.json"), "w");
  const r = spawnSync(py("coverage"), ["-I", join(REPO, "helpers", "coverage", "resolve.py"), "resolve", "--classical", ...resolveArgs(set)], { stdio: ["ignore", fd, "inherit"] });
  closeSync(fd);
  if (r.status !== 0) throw new Error(`resolve.py resolve failed on ${set}`);
}

function render(set: SetName): void {
  const c = SETS[set];
  const out = join(PRIV, "renders", set);
  const r = spawnSync(py("coverage"), ["-I", join(REPO, "helpers", "coverage", "render_f0i.py"), "--detect", join(c.stage, "detect.jsonl"), "--outlines", c.outlines, "--table", c.table, "--images", c.images, "--part", join(PRIV, set), "--out", out, "--label", set], { stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) throw new Error(`render_f0i.py failed on ${set}`);
  log(`render under the data root's private/f0i/renders/${set}/index.html`);
}

// --- run: one reader arm on the changed set (F-0b's procedure, as H-2 ran it) ----------------------------

/** Copy a box's cached readings into the clip arm when its crop there is the cached crop: only changed crops are read. */
function seedUnchanged(set: SetName, dets: Map<string, Detection>, subset: Set<string>, dir: string): number {
  const name = cropName(CROP);
  const have = new Set<string>();
  for (const r of ["vision", "ppocr", "qwen"]) {
    const p = join(dir, `${r}.jsonl`);
    if (existsSync(p)) for (const x of readJsonl<{ id: string; crop?: string }>(p)) if (x.crop === name) have.add(`${r}:${x.id}`);
  }
  const unchanged = new Set<string>();
  for (const id of subset) {
    const [p, i] = split(id);
    const d = dets.get(p)!, s = d.spines[i]!;
    if (sameCrop(cropFor(s, d, CROP), cropFor(s, d, F0_CROP))) unchanged.add(id);
  }
  for (const r of ["vision", "ppocr", "qwen"]) {
    const lines = readJsonl<Reading & { crop?: string }>(join(SETS[set].stage, `${r}.jsonl`))
      .filter((x) => unchanged.has(x.id) && (x.crop ?? cropName(F0_CROP)) === cropName(F0_CROP) && !have.has(`${r}:${x.id}`))
      .map((x) => JSON.stringify({ ...x, crop: name, reusedFrom: cropName(F0_CROP) }));
    if (lines.length) appendFileSync(join(dir, `${r}.jsonl`), lines.join("\n") + "\n");
  }
  return unchanged.size;
}

/**
 * The `mask=own` arm's inputs: per photo one lossless mosaic of the changed boxes' refit crops, neighbour-owned
 * pixels filled (resolve.py `own`), and detections whose changed polygons point into it. Reading ids stay `photo:index`.
 */
function ownInputs(set: SetName, dets: Map<string, Detection>, images: InputImage[], subset: Set<string>): { dets: Map<string, Detection>; images: InputImage[] } {
  const dir = join(PRIV, set, "own");
  mkdirSync(dir, { recursive: true });
  const path = new Map(images.map((x) => [x.id, x.path]));
  const reqs = [...subset].map((id) => {
    const [p, i] = split(id);
    const d = dets.get(p)!;
    const c = cropFor(d.spines[i]!, d, CROP)!;
    return { id, photo: p, image: path.get(p), labels: join(PRIV, set, "labels", `${p}.png`), polygon: c.polygon, own: i + 1 };
  });
  writeFileSync(join(dir, "requests.jsonl"), reqs.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const fd = openSync(join(dir, "crops.jsonl"), "w");
  const r = spawnSync(py("coverage"), ["-I", join(REPO, "helpers", "coverage", "resolve.py"), "own", "--requests", join(dir, "requests.jsonl"), "--out", join(dir, "mosaics")], { stdio: ["ignore", fd, "inherit"] });
  closeSync(fd);
  if (r.status !== 0) throw new Error(`resolve.py own failed on ${set}`);
  const rows = readJsonl<{ id?: string; photo?: string; mosaic: string; dx?: number; dy?: number; width?: number; height?: number }>(join(dir, "crops.jsonl"));
  const shift = new Map(rows.filter((x) => x.id).map((x) => [x.id!, [x.dx!, x.dy!] as const]));
  const size = new Map(rows.filter((x) => x.photo).map((x) => [x.photo!, x]));
  const outDets = new Map<string, Detection>();
  const outImages: InputImage[] = [];
  for (const [p, m] of size) {
    const d = dets.get(p)!;
    outDets.set(p, { ...d, width: m.width!, height: m.height!, spines: d.spines.map((s, i) => {
      const sh = shift.get(`${p}:${i}`);
      if (!sh) return s;
      const c = cropFor(s, d, CROP)!;
      return { ...s, polygon: c.polygon.map(([x, y]) => [x + sh[0], y + sh[1]]) as typeof s.polygon };
    }) });
    outImages.push({ id: p, photoHash: p, path: m.mosaic, setting: set });
  }
  return { dets: outDets, images: outImages };
}

async function run(set: SetName, arm: string): Promise<void> {
  const method = ARMS[arm];
  if (!method) throw new Error(`arm must be one of ${Object.keys(ARMS).join(", ")}`);
  const cfg = F0B_SETS[set];
  const dets0 = loadDets(set);
  const part = partition(set);
  const subset = changedSet(dets0, part);
  const kept = keptIds(set);
  // The boxes competing for Qwen's per-photo cap: before the partition every kept box, after it the partition's.
  const compete = arm === "clip" ? kept : new Set([...part.values()].filter((r) => r.state === "kept").map((r) => r.id));
  let dets = arm === "clip" ? dets0 : refitDets(dets0, part);
  let images = inputImages(set, dets0);
  const before = new Map(readJsonl<SpineDecision>(SETS[set].decisions).map((d) => [d.id, d]));
  const dir = join(PRIV, set, arm);
  mkdirSync(dir, { recursive: true });
  if (arm === "clip") log(`${set} clip: ${seedUnchanged(set, dets, subset, dir)} of ${subset.size} keep their cached readings`);
  if (arm === "own") ({ dets, images } = ownInputs(set, dets, images, subset));
  log(`${set} ${arm}: ${subset.size} changed boxes, crop ${cropName(method)}`);
  const t0 = Date.now();
  const imgs = images.filter((x) => [...subset].some((id) => id.startsWith(`${x.id}:`)));
  await visionStage(imgs, dets, dir, log, method, subset);
  await pyReaderStage("ppocr", imgs, dets, dir, log, subset, method);
  const db = openCatalog(cfg.catalog);
  const cache = new Map<string, Candidate | undefined>();
  const score = new Map([...dets0.values()].flatMap((d) => d.spines.map((s, i): [string, number] => [`${d.id}:${i}`, s.boxScore])));
  const imageOf = (id: string) => split(id)[0];
  const readings0 = loadReadings(dir, method);
  const first = new Map([...subset].map((id) => [id, decide(db, id, imageOf(id), score.get(id)!, { vision: readings0.get(id)?.vision, ppocr: readings0.get(id)?.ppocr }, cache)]));
  const selected = new Set<string>();
  for (const img of images) {
    [...compete]
      .filter((id) => imageOf(id) === img.id)
      .filter((id) => (subset.has(id) ? firstPassHard(first.get(id)!) : before.has(id) && firstPassHard(before.get(id)!)))
      .sort((a, b) => score.get(b)! - score.get(a)!)
      .slice(0, cfg.qwenCap)
      .filter((id) => subset.has(id))
      .forEach((id) => selected.add(id));
  }
  log(`${set} ${arm}: qwen on ${selected.size} hard crops`);
  await pyReaderStage("qwen", imgs, dets, dir, log, selected, method);
  const readings = loadReadings(dir, method);
  const after = [...subset].map((id) => {
    const r = { ...(readings.get(id) ?? {}) };
    if (!selected.has(id)) delete r.qwen;
    return decide(db, id, imageOf(id), score.get(id)!, r, cache);
  });
  writeFileSync(
    join(dir, "decisions.jsonl"),
    after.map((d) => JSON.stringify({ ...d, accepted: d.accepted && { workId: d.accepted.workId, score: d.accepted.score, queryCoverage: d.accepted.queryCoverage }, qwenSelected: selected.has(d.id) })).join("\n") + "\n",
  );
  log(`${set} ${arm}: done in ${Math.round((Date.now() - t0) / 1000)} s`);
}

// --- analysis --------------------------------------------------------------------------------------------

const textRead = (o: Outcome) => o !== "unknown:no-text";
const confirmed = (o: Outcome) => o === "confirmed";
const wrong = (o: Outcome) => o === "rejected/wrong";
const workOf = (d: { accepted: string | { workId: string } | null } | undefined): string | null =>
  !d?.accepted ? null : typeof d.accepted === "string" ? d.accepted : d.accepted.workId;

/** M6: (photo, work) pairs accepted before by a box the partition drops and by no surviving box (cached decisions). */
export function bookLoss(part: Map<string, PartRow>, kept: Set<string>, work: (id: string) => string | null): { lost: number; droppedAccepting: number } {
  const surviving = new Set<string>(), droppedWorks: string[] = [];
  for (const id of kept) {
    const w = work(id);
    if (!w) continue;
    const key = `${split(id)[0]}\u0000${w}`;
    if (part.get(id)?.state === "dropped") droppedWorks.push(key);
    else surviving.add(key);
  }
  return { lost: new Set(droppedWorks.filter((k) => !surviving.has(k))).size, droppedAccepting: droppedWorks.length };
}

function analyse(): void {
  const truth = yardstickTruth();
  const sets: Record<string, any> = {};
  for (const set of Object.keys(SETS) as SetName[]) {
    const tr = set === "pilot-000" ? undefined : truth;
    const mPath = join(PRIV, set, "metrics.json");
    if (!existsSync(mPath)) throw new Error(`${set}: run \`f0i-cli.ts resolve ${set}\` first`);
    const geo = JSON.parse(readFileSync(mPath, "utf8"));
    const dets = loadDets(set);
    const part = partition(set);
    const kept = keptIds(set);
    const base = new Map(readJsonl<SpineDecision>(SETS[set].decisions).map((d) => [d.id, d]));
    const subset = changedSet(dets, part);
    const tiles = existsSync(join(PRIV, set, "tiles.jsonl")) ? readJsonl<{ hit?: boolean; seconds?: number; mpsPeakMb?: number; windows: number; error?: string }>(join(PRIV, set, "tiles.jsonl")) : [];
    const loss = bookLoss(part, kept, (id) => workOf(base.get(id)));
    const out: Record<string, any> = {
      scope: F0B_SETS[set].scope,
      geometry: geo,
      bookLoss: loss,
      changedSet: subset.size,
      cost: {
        groups: tiles.length,
        encodes: tiles.reduce((s, t) => s + t.windows, 0),
        groupsRun: tiles.filter((t) => !t.hit).length,
        errors: tiles.filter((t) => t.error).length,
        gpuSeconds: Math.round(tiles.reduce((s, t) => s + (t.seconds ?? 0), 0)),
        gpuSecondsPerPhoto: Math.round((10 * tiles.reduce((s, t) => s + (t.seconds ?? 0), 0)) / Math.max(geo.photos, 1)) / 10,
        peakMpsMb: Math.max(0, ...tiles.map((t) => t.mpsPeakMb ?? 0)),
      },
      arms: {} as Record<string, unknown>,
    };
    const dec = (arm: string) => {
      const p = join(PRIV, set, arm, "decisions.jsonl");
      return existsSync(p) ? new Map(readJsonl<SpineDecision & { qwenSelected?: boolean }>(p).map((d) => [d.id, d])) : null;
    };
    const bef = dec("clip");
    const g = new Map(geometry(dets).map((x): [string, Geo] => [x.id, x]));
    for (const arm of ["refit", "own"]) {
      const aft = dec(arm);
      if (!bef || !aft) continue;
      for (const id of subset) if (!bef.has(id) || !aft.has(id)) throw new Error(`${set} ${arm}: decisions do not cover the changed set; re-run`);
      const pairs = (sel: (id: string) => boolean): Pair[] =>
        [...subset].filter(sel).map((id) => ({ id, imageId: split(id)[0], before: outcomeOf(bef.get(id)!, tr?.get(split(id)[0])), after: outcomeOf(aft.get(id)!, tr?.get(split(id)[0])) }));
      const summary = (rs: Pair[], seed: number) => ({
        boxCount: rs.length,
        photos: new Set(rs.map((r) => r.imageId)).size,
        textRead: delta(rs, textRead, seed),
        confirmed: delta(rs, confirmed, seed + 1),
        ...(tr ? { wrong: delta(rs, wrong, seed + 2) } : {}),
      });
      const strata: Record<string, (id: string) => boolean> = {
        remainders: (id) => part.get(id)!.role === "remainder",
        "other changed boxes": (id) => part.get(id)!.role !== "remainder",
        flagged: (id) => part.get(id)!.flagged,
        "whole boxes": (id) => !g.get(id)!.piece,
        "cut or partial boxes": (id) => g.get(id)!.piece,
      };
      // Whole-set before and after: every kept box's cached decision; after, the partition's kept boxes, changed boxes
      // taking the arm's decision. Dropped boxes count for nothing after.
      const afterWork = (id: string) => (part.get(id)?.state === "dropped" ? null : subset.has(id) ? workOf(aft.get(id)) : workOf(base.get(id)));
      const rows = [...kept].map((id) => ({ imageId: split(id)[0], b: workOf(base.get(id)), a: afterWork(id) }));
      let works: unknown = null, titles: unknown = null;
      if (!tr) {
        const count = (rs: typeof rows, k: "a" | "b") => new Set(rs.flatMap((r) => (r[k] ? [`${r.imageId}\u0000${r[k]}`] : []))).size;
        const d = clusterBootstrap(rows, (rs) => count(rs, "a") - count(rs, "b"), REPS, 61);
        works = { before: count(rows, "b"), after: count(rows, "a"), delta: d && { value: d.value, lo: d.lo, hi: d.hi } };
      } else {
        const photos = [...new Set(rows.map((r) => r.imageId))].sort();
        const per = (k: "a" | "b") =>
          photos.map((p): [number, number, number] => {
            const gt = tr.get(p) ?? new Set<string>();
            const acc = new Set(rows.filter((r) => r.imageId === p && r[k]).map((r) => r[k]!));
            return [gt.size, [...acc].filter((w) => gt.has(w)).length, acc.size];
          });
        const pb = per("b"), pa = per("a");
        const rate = (xs: [number, number, number][], den: 0 | 2) => xs.reduce((s, x) => s + x[1], 0) / Math.max(1, xs.reduce((s, x) => s + x[den], 0));
        titles = { before: { recall: rate(pb, 0), precision: rate(pb, 2) }, after: { recall: rate(pa, 0), precision: rate(pa, 2) }, delta: titleDelta(pb, pa) };
      }
      out.arms[arm] = {
        cropMethod: cropName(ARMS[arm]!),
        against: cropName(CROP),
        all: summary(pairs(() => true), 11),
        strata: Object.fromEntries(Object.entries(strata).map(([k, f], i) => [k, summary(pairs(f), 21 + 3 * i)])),
        ...(works ? { distinctConfirmedWorks: works } : {}),
        ...(titles ? { titles } : {}),
        cost: {
          before: cost(loadReadings(join(PRIV, set, "clip"), CROP), subset, (id) => Boolean(bef.get(id)?.qwenSelected)),
          after: cost(loadReadings(join(PRIV, set, arm), ARMS[arm]!), subset, (id) => Boolean(aft.get(id)?.qwenSelected)),
        },
      };
    }
    sets[set] = out;
  }
  const verdict = verdictOf(sets);
  const m = {
    runId: "F0i",
    card: "F-0i",
    date: new Date().toLocaleDateString("en-CA"),
    model: { id: "facebook/sam2.1-hiera-base-plus", licence: "Apache-2.0" },
    shippedCrop: cropName(CROP),
    candidateCrops: { refit: `${cropName(CROP)} on the refit box`, own: cropName(OWN_CROP) },
    bootstrap: { unit: "photo (cluster), paired: the same boxes before and after", reps: REPS, interval: "95 % percentile", units: "percentage points (works: count)" },
    keepRule: "partition: overlap rate <= 0.5 % and no book lost by geometry, both sets; reader crop: that, plus neighbour-crop share falls (interval below 0) on both sets, pilot-000 confirmed interval excludes 0 upward, pilot-000 distinct works not down, yardstick confirmed not down and wrong not up beyond their intervals, yardstick title recall not down beyond its interval",
    verdict,
    sets,
  };
  const dir = join(REPO, "evals", "F0i");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "metrics.json"), compactJson(m) + "\n");
  const reportPath = join(dir, "report.md");
  const head = existsSync(reportPath) ? readFileSync(reportPath, "utf8").split(MARKER)[0]! : "# F0i: instance partition (F-0i)\n\n";
  writeFileSync(reportPath, head + MARKER + "\n\n" + tables(m) + "\n");
  log("aggregates -> evals/F0i/{metrics.json,report.md}");
}

/** The pre-registered keep rules (evals/F0i/report.md). */
export function verdictOf(sets: Record<string, any>) {
  const p = sets["pilot-000"], y = sets["yardstick-library-b2"];
  if (!p || !y) return null;
  const g1 = [p, y].every((s) => s.geometry.overlapRate_after.share <= 0.005);
  const g2 = [p, y].every((s) => s.bookLoss.lost === 0);
  const m2 = [p, y].every((s) => s.geometry.cropsNeighbour10pct.delta[2] < 0);
  const arm = (k: string) => {
    const pa = p.arms[k], ya = y.arms[k];
    if (!pa || !ya) return null;
    const rule = {
      geometryAndNeighbourCrops: g1 && g2 && m2,
      pilotConfirmedExcludesZero: !!pa.all.confirmed && pa.all.confirmed.lo > 0,
      pilotDistinctWorksNotDown: !!pa.distinctConfirmedWorks?.delta && pa.distinctConfirmedWorks.delta.value >= 0,
      yardstickConfirmedNotDown: !ya.all.confirmed || ya.all.confirmed.hi >= 0,
      yardstickWrongNotUp: !ya.all.wrong || ya.all.wrong.lo <= 0,
      yardstickRecallNotDown: !ya.titles?.delta || ya.titles.delta.recall[2] >= 0,
    };
    return { keep: Object.values(rule).every(Boolean), ...rule };
  };
  const refit = arm("refit"), own = arm("own");
  const passing = (["refit", "own"] as const).filter((k) => ({ refit, own })[k]?.keep);
  const ships = passing.length ? passing.sort((a, b) => p.arms[b].all.confirmed.delta - p.arms[a].all.confirmed.delta)[0] : null;
  return { partition: { ships: g1 && g2, overlapTargetMet: g1, noBookLost: g2 }, neighbourCropsFall: m2, refit, own, readerCropShips: ships };
}

const MARKER = "<!-- generated by src/eval/f0i-cli.ts analyse: edit above this line -->";

function tables(m: { verdict: any; sets: Record<string, any> }): string {
  type D = { before: number; after: number; delta: number; lo: number; hi: number } | null | undefined;
  const fmt = (d: D) => (d ? `${d.before} → ${d.after} (${d.delta >= 0 ? "+" : ""}${d.delta}; ${d.lo} to ${d.hi})` : "—");
  const pc = (x: number | null | undefined, k = 1) => (x === null || x === undefined ? "—" : `${(x * 100).toFixed(k)} %`);
  const tri = (t: { share: number; lo: number; hi: number }, k = 1) => `${pc(t.share, k)} (${pc(t.lo, k)}–${pc(t.hi, k)})`;
  const pp = (t: number[]) => `${(t[0]! * 100).toFixed(1)} (${(t[1]! * 100).toFixed(1)} to ${(t[2]! * 100).toFixed(1)})`;
  const out: string[] = [];
  const names = Object.keys(m.sets);
  const col = (f: (s: any) => string) => names.map((n) => f(m.sets[n])).join(" | ");
  out.push("## Geometry, both sets", "", `| figure | ${names.map((n) => (n === "pilot-000" ? "`pilot-000`" : "yardstick (PROXY)")).join(" | ")} |`, `|---|${names.map(() => "---:").join("|")}|`);
  const g = (s: any) => s.geometry;
  out.push(
    `| photos / kept boxes before / after | ${col((s) => `${g(s).photos} / ${g(s).boxCount} / ${g(s).kept}`)} |`,
    `| **overlap rate before** | ${col((s) => tri(g(s).overlapRate_before))} |`,
    `| **overlap rate after (target ≤ 0.5 %)** | ${col((s) => tri(g(s).overlapRate_after, 2))} |`,
    `| crops with ≥ 10 % neighbour pixels, before → after | ${col((s) => `${pc(g(s).cropsNeighbour10pct.before)} → ${pc(g(s).cropsNeighbour10pct.after)}`)} |`,
    `| ... change, points (95 % paired interval) | ${col((s) => pp(g(s).cropsNeighbour10pct.delta))} |`,
    `| book loss by geometry (M6) | ${col((s) => `${s.bookLoss.lost} (dropped boxes that accepted a work: ${s.bookLoss.droppedAccepting})`)} |`,
    `| changed boxes / refit / changed crops (the reader set) | ${col((s) => `${g(s).changed} / ${g(s).refit} / ${s.changedSet}`)} |`,
    `| flagged (kept under 60 % of the clipped mask) | ${col((s) => String(g(s).flagged))} |`,
    `| conflict groups / windows (encodes) | ${col((s) => `${g(s).groups} / ${g(s).windows}`)} |`,
    `| groups without logits | ${col((s) => String(g(s).groupsWithoutLogits))} |`,
    `| GPU seconds per photo / peak MPS | ${col((s) => `${s.cost.gpuSecondsPerPhoto} s / ${(s.cost.peakMpsMb / 1024).toFixed(1)} GB`)} |`,
    `| contested pixels resolved | ${col((s) => g(s).contestedPixels.toLocaleString("en-US"))} |`,
    "",
    "### Gate",
    "",
    `| rule | ${names.join(" | ")} |`,
    `|---|${names.map(() => "---:").join("|")}|`,
  );
  const rules = [...new Set(names.flatMap((n) => Object.keys(m.sets[n].geometry.gate)))].sort();
  for (const r of rules) out.push(`| ${r} | ${col((s) => String(g(s).gate[r] ?? 0))} |`);
  out.push("", "### Provenance", "", `| source | ${names.map((n) => `${n} contested pixels | ${n} boundary length`).join(" | ")} |`, `|---|${names.map(() => "---:|---:").join("|")}|`);
  for (const src of ["outline", "gate", "tile-argmax", "seam", "depth", "fallback"])
    out.push(`| ${src} | ${names.map((n) => `${pc(m.sets[n].geometry.provenancePixelShare[src] ?? 0)} | ${pc(m.sets[n].geometry.boundaryLengthShare[src] ?? 0)}`).join(" | ")} |`);
  out.push("", `Seams: ${names.map((n) => {
    const s = m.sets[n].geometry.seam;
    return `${n} ${s.strong} strong of ${s.runs} runs (classical arm: ${s.classicalStrong} strong; it would give ${pc(s.classicalDiffer / Math.max(s.classicalCompared, 1))} of the compared pixels to the other book)`;
  }).join("; ")}.`, "");
  for (const [set, s] of Object.entries(m.sets)) {
    const yard = set !== "pilot-000";
    for (const [arm, x] of Object.entries<any>(s.arms)) {
      out.push(`## ${set}: \`${arm}\` against \`clip\` (${s.scope})`, "",
        `${x.all.boxCount} changed boxes. Shares in % of them, before → after (Δ points; 95 % paired photo-bootstrap interval).`, "",
        `| boxes | n | photos | text read | confirmed |${yard ? " wrong |" : ""}`, `|---|---:|---:|---|---|${yard ? "---|" : ""}`);
      const row = (label: string, r: any) => `| ${label} | ${r.boxCount} | ${r.photos} | ${fmt(r.textRead)} | ${fmt(r.confirmed)} |${yard ? ` ${fmt(r.wrong)} |` : ""}`;
      out.push(row("**all**", x.all), ...Object.entries<any>(x.strata).map(([k, r]) => row(`  ${k}`, r)), "");
      if (x.distinctConfirmedWorks) {
        const d = x.distinctConfirmedWorks;
        out.push(`Distinct confirmed works over the whole set (per photo, summed): ${d.before} → ${d.after} (${d.delta ? `${d.delta.value >= 0 ? "+" : ""}${d.delta.value}; ${d.delta.lo} to ${d.delta.hi}` : "—"}).`, "");
      }
      if (x.titles) {
        const t = x.titles;
        out.push(`Titles over the whole set: recall ${pc(t.before.recall)} → ${pc(t.after.recall)} (${t.delta ? pp(t.delta.recall) : "—"} points), precision ${pc(t.before.precision)} → ${pc(t.after.precision)} (${t.delta ? pp(t.delta.precision) : "—"}).`, "");
      }
      const c = (k: string, w: string) => `${x.cost.before[k][w]} → ${x.cost.after[k][w]}`;
      out.push("| reader | calls | seconds |", "|---|---:|---:|", ...["vision", "ppocr", "qwen"].map((k) => `| ${k} | ${c(k, "calls")} | ${c(k, "seconds")} |`), "");
    }
  }
  if (m.verdict) {
    const v = m.verdict, yn = (b: boolean | undefined) => (b ? "yes" : "no");
    out.push("## Verdict", "", `Partition (geometry cache): overlap target met ${yn(v.partition.overlapTargetMet)}, no book lost ${yn(v.partition.noBookLost)}: **${v.partition.ships ? "ships" : "does not ship"}**. Neighbour-crop share falls on both sets: ${yn(v.neighbourCropsFall)}.`, "");
    out.push("| arm | geometry and neighbour crops | pilot confirmed up | pilot works not down | yardstick confirmed not down | yardstick wrong not up | yardstick recall not down | keep |", "|---|---|---|---|---|---|---|---|");
    for (const k of ["refit", "own"]) {
      const a = v[k];
      if (a) out.push(`| ${k} | ${yn(a.geometryAndNeighbourCrops)} | ${yn(a.pilotConfirmedExcludesZero)} | ${yn(a.pilotDistinctWorksNotDown)} | ${yn(a.yardstickConfirmedNotDown)} | ${yn(a.yardstickWrongNotUp)} | ${yn(a.yardstickRecallNotDown)} | **${a.keep ? "keep" : "off"}** |`);
    }
    out.push("", `Reader crop: **${v.readerCropShips ?? "stays `rect;rot=fixed;clip=frame`"}**.`);
  }
  return out.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, set, arg] = process.argv.slice(2);
  if (cmd === "plan" && isSet(set)) plan(set);
  else if (cmd === "tiles" && isSet(set)) tiles(set);
  else if (cmd === "resolve" && isSet(set)) resolve(set);
  else if (cmd === "render" && isSet(set)) render(set);
  else if (cmd === "run" && isSet(set) && arg) await run(set, arg);
  else if (cmd === "analyse") analyse();
  else {
    console.error("usage: f0i-cli.ts plan|tiles|resolve|render <set> | run <set> <clip|refit|own> | analyse   (set: pilot-000 | yardstick-library-b2)");
    process.exit(2);
  }
}
