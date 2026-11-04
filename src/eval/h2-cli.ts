// H-2 runner: the depth stage on the default boxes, per-box face shares, and the `face3d` reader crop measured
// against the shipped `clip=frame` crop by F-0b's procedure and keep rule (pre-registered in evals/H2/report.md).
//
//   node src/eval/h2-cli.ts stage <set> [--tag T]   # helpers/depth/stage.py: geometry + faces per photo, cached
//   node src/eval/h2-cli.ts base <set>              # F-0's decision per box from the cached readings (once)
//   node src/eval/h2-cli.ts run <set> <arm>         # arm: clip (before) | face3d (after), on the face3d subset
//   node src/eval/h2-cli.ts analyse                 # evals/H2/{metrics.json,report.md}: aggregates only
//   node src/eval/h2-cli.ts render                  # U-4's still study with spine faces and top faces (private)
//
// Sets (OC35, never merged): pilot-000 with F-0e's `bands+strips` boxes and the readers F-0e cached; the yardstick
// with F-0's B2 boxes and readers. Both after the shipped not-a-book filter. Everything per box or per photo goes
// under the data root's `private/h2/`; the stage's cache is `private/h2/cache/` (helpers/depth/README.md).
import { spawnSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Candidate } from "../catalog/retrieve.ts";
import { openCatalog } from "../catalog/cli.ts";
import { dataRoot } from "../ledger/images.ts";
import { CROP, decide, loadReadings, pyReaderStage, readJsonl, visionStage, type Detection, type InputImage, type Reading, type SpineDecision } from "./f0.ts";
import { F0_CROP, FACE3D_CROP, cropFor, cropName, type CropMethod, type Point } from "../perceive/crop.ts";
import { dominantExtra, elevationBand, faceShares, face3dTrim, topFace, FACE_CLASSES, type FaceRow } from "../perceive/faces3d.ts";
import { SETS as F0B_SETS, cost, delta, firstPassHard, geometry, type Geo, type Pair } from "./f0b-cli.ts";
import { spineIds } from "./q2b-cli.ts";
import { compactJson, outcomeOf, yardstickTruth } from "./q1-cli.ts";
import { clusterBootstrap, quantile } from "./q1.ts";
import type { Outcome } from "./q1.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const ROOT = dataRoot();
const PRIV = join(ROOT, "private", "h2");
const CACHE = join(PRIV, "cache");
const REPS = 2000;
const log = (s: string): void => console.error(`[h2] ${s}`);
const r4 = (x: number) => Math.round(x * 10000) / 10000;

export type SetName = "pilot-000" | "yardstick-library-b2";
const SETS: Record<SetName, { stage: string; filter: "pilot-000" | "yardstick"; images: (ids: string[]) => { id: string; image: string }[] }> = {
  "pilot-000": {
    stage: join(ROOT, "f0e", "pilot-000", "bands+strips"),
    filter: "pilot-000",
    images: () => readJsonl<{ id: string; image: string }>(join(ROOT, "private", "f0e", "images-pilot-000.jsonl")),
  },
  "yardstick-library-b2": {
    stage: join(ROOT, "f0", "yardstick-library-b2"),
    filter: "yardstick",
    images: (ids) => ids.map((id) => ({ id, image: join(ROOT, "proxy", "library-dataset", "images", `${id}.jpg`) })),
  },
};
const isSet = (s: string | undefined): s is SetName => s === "pilot-000" || s === "yardstick-library-b2";

export const ARMS: Record<string, CropMethod> = { clip: CROP, face3d: FACE3D_CROP };

// --- inputs ----------------------------------------------------------------------------------------------

function loadDets(set: SetName): Map<string, Detection> {
  return new Map(readJsonl<Detection>(join(SETS[set].stage, "detect.jsonl")).filter((d) => !d.error).map((d) => [d.id, d]));
}

function inputImages(set: SetName, dets: Map<string, Detection>): InputImage[] {
  const paths = new Map(SETS[set].images([...dets.keys()]).map((x) => [x.id, x.image]));
  return [...dets.keys()].map((id) => {
    const path = paths.get(id);
    if (!path || !existsSync(path)) throw new Error(`image missing for a cached detection in ${set}`);
    return { id, photoHash: id, path, setting: set };
  });
}

/** Box ids the shipped not-a-book rules keep as spines (F-0c shapes, F-0f shelf labels; cover pass off). */
const keptIds = (set: SetName): Set<string> => spineIds(join(SETS[set].stage, "detect.jsonl"), SETS[set].filter);

/** The depth stage's row per box id (`<photo>:<box>`), from the latest stage run. */
function faceRows(set: SetName): Map<string, FaceRow> {
  const path = join(PRIV, set, "stage-latest.jsonl");
  if (!existsSync(path)) throw new Error(`${set}: no depth stage output; run \`h2-cli.ts stage ${set}\` first`);
  return new Map(readJsonl<FaceRow & { photo?: boolean }>(path).filter((r) => !r.photo).map((r) => [`${r.id}:${r.box}`, r]));
}

/** Detections with each box's spine-face trim attached where `face3dTrim` gives one. */
function withTrims(dets: Map<string, Detection>, rows: Map<string, FaceRow>): Map<string, Detection> {
  for (const d of dets.values())
    d.spines.forEach((s, i) => {
      const t = rows.get(`${d.id}:${i}`);
      const q = t ? face3dTrim(t) : null;
      if (q) s.face3d = q as [number, number][];
    });
  return dets;
}

const sameCrop = (a: ReturnType<typeof cropFor>, b: ReturnType<typeof cropFor>): boolean =>
  !!a && !!b && JSON.stringify(a.rotations) === JSON.stringify(b.rotations) && a.polygon.every((p, k) => Math.hypot(p[0] - b.polygon[k]![0], p[1] - b.polygon[k]![1]) <= 1);

/** The face3d subset (pre-registered): kept boxes that over-select, with a feasible trim, whose crop changes. */
function subsetOf(set: SetName, dets: Map<string, Detection>, kept: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const d of dets.values())
    d.spines.forEach((s, i) => {
      const id = `${d.id}:${i}`;
      if (!kept.has(id) || !s.face3d) return;
      if (!sameCrop(cropFor(s, d, FACE3D_CROP), cropFor(s, d, CROP))) out.add(id);
    });
  log(`${set}: face3d subset ${out.size} of ${kept.size} kept boxes`);
  return out;
}

// --- stage: geometry and faces per photo -----------------------------------------------------------------

function stage(set: SetName, tag: string): void {
  const py = join(REPO, "helpers", "depth", ".venv", "bin", "python");
  if (!existsSync(py)) throw new Error("helpers/depth has no .venv: run `uv sync` there first");
  const dets = loadDets(set);
  const dir = join(PRIV, set);
  mkdirSync(dir, { recursive: true });
  const images = join(dir, "images.jsonl");
  writeFileSync(images, inputImages(set, dets).map((x) => JSON.stringify({ id: x.id, image: x.path })).join("\n") + "\n");
  const out = join(dir, `stage-${tag}.jsonl`);
  const fd = openSync(out, "w");
  log(`${set}: depth stage over ${dets.size} photos (${tag})`);
  const r = spawnSync(py, ["-I", join(REPO, "helpers", "depth", "stage.py"), "--images", images, "--detect", join(SETS[set].stage, "detect.jsonl"), "--cache", CACHE, "--exif-fov"], {
    stdio: ["ignore", fd, "inherit"],
  });
  closeSync(fd);
  if (r.status !== 0) throw new Error(`stage.py failed on ${set}`);
  writeFileSync(join(dir, "stage-latest.jsonl"), readFileSync(out));
  // The private per-box file: face shares and the trim per kept box.
  const kept = keptIds(set);
  const rows = [...faceRows(set)].filter(([id]) => kept.has(id));
  writeFileSync(
    join(dir, "faces.jsonl"),
    rows
      .map(([id, r]) =>
        JSON.stringify({
          id,
          shares: faceShares(r),
          overSelects: r.overSelects ?? null,
          trimFeasible: r.trimFeasible ?? null,
          face3d: face3dTrim(r),
          topFace: topFace(r),
          elevationDeg: r.elevationDeg ?? null,
          ownPlane: r.ownPlane ?? null,
          skip: r.skip ?? null,
        }),
      )
      .join("\n") + "\n",
  );
  log(`${set}: face shares for ${rows.length} kept boxes under the data root's private/h2/${set}/faces.jsonl`);
}

// --- base: F-0's decision per kept box from the cached readings ------------------------------------------

function base(set: SetName): void {
  const dets = loadDets(set);
  const kept = keptIds(set);
  const db = openCatalog(F0B_SETS[set].catalog);
  const readings = loadReadings(SETS[set].stage);
  const cache = new Map<string, Candidate | undefined>();
  const out = join(PRIV, set, "base-decisions.jsonl");
  mkdirSync(join(PRIV, set), { recursive: true });
  writeFileSync(out, "");
  let n = 0;
  for (const d of dets.values())
    d.spines.forEach((s, i) => {
      const id = `${d.id}:${i}`;
      if (!kept.has(id)) return;
      const x = decide(db, id, d.id, s.boxScore, readings.get(id) ?? {}, cache);
      appendFileSync(out, JSON.stringify({ ...x, accepted: x.accepted && { workId: x.accepted.workId, score: x.accepted.score } }) + "\n");
      if (++n % 500 === 0) log(`${set}: base ${n}`);
    });
  // Sanity against the decisions other cards cached on the same readings.
  const cached = set === "pilot-000" ? join(ROOT, "f0c", set, "base-decisions.jsonl") : join(SETS[set].stage, "decisions.jsonl");
  const ref = new Map(readJsonl<{ id: string; accepted: string | { workId: string } | null }>(cached).map((x) => [x.id, workOf(x)]));
  const mine = readJsonl<{ id: string; accepted: { workId: string } | null }>(out);
  const same = mine.filter((x) => ref.get(x.id) === workOf(x)).length;
  log(`${set}: ${n} base decisions; accepted work equal to the cached decisions on ${same} of ${mine.length}`);
}

const workOf = (d: { accepted: string | { workId: string } | null } | undefined): string | null =>
  !d?.accepted ? null : typeof d.accepted === "string" ? d.accepted : d.accepted.workId;

// --- run: one arm on the face3d subset (F-0b's procedure) ------------------------------------------------

/** Copy a box's cached readings into the arm's files when its crop there is the cached crop: only changed crops are read. */
function seedUnchanged(set: SetName, dets: Map<string, Detection>, subset: Set<string>, method: CropMethod, dir: string): number {
  const name = cropName(method);
  const have = new Set<string>();
  for (const r of ["vision", "ppocr", "qwen"]) {
    const p = join(dir, `${r}.jsonl`);
    if (existsSync(p)) for (const x of readJsonl<{ id: string; crop?: string }>(p)) if (x.crop === name) have.add(`${r}:${x.id}`);
  }
  const unchanged = new Set<string>();
  for (const id of subset) {
    const k = id.lastIndexOf(":");
    const d = dets.get(id.slice(0, k))!, s = d.spines[Number(id.slice(k + 1))]!;
    if (sameCrop(cropFor(s, d, method), cropFor(s, d, F0_CROP))) unchanged.add(id);
  }
  for (const r of ["vision", "ppocr", "qwen"]) {
    const lines = readJsonl<Reading & { crop?: string }>(join(SETS[set].stage, `${r}.jsonl`))
      .filter((x) => unchanged.has(x.id) && (x.crop ?? cropName(F0_CROP)) === cropName(F0_CROP) && !have.has(`${r}:${x.id}`))
      .map((x) => JSON.stringify({ ...x, crop: name, reusedFrom: cropName(F0_CROP) }));
    if (lines.length) appendFileSync(join(dir, `${r}.jsonl`), lines.join("\n") + "\n");
  }
  return unchanged.size;
}

async function run(set: SetName, arm: string): Promise<void> {
  const method = ARMS[arm];
  if (!method) throw new Error(`arm must be one of ${Object.keys(ARMS).join(", ")}`);
  const cfg = F0B_SETS[set];
  const dets = withTrims(loadDets(set), faceRows(set));
  const images = inputImages(set, dets);
  const kept = keptIds(set);
  const subset = subsetOf(set, dets, kept);
  const basePath = join(PRIV, set, "base-decisions.jsonl");
  if (!existsSync(basePath)) throw new Error(`${set}: run \`h2-cli.ts base ${set}\` first`);
  const before = new Map(readJsonl<SpineDecision>(basePath).map((d) => [d.id, d]));
  const dir = join(PRIV, set, arm);
  mkdirSync(dir, { recursive: true });
  const reused = seedUnchanged(set, dets, subset, method, dir);
  log(`${set} ${arm}: ${subset.size} boxes, crop ${cropName(method)}; ${reused} keep their cached readings`);
  const t0 = Date.now();
  await visionStage(images, dets, dir, log, method, subset);
  await pyReaderStage("ppocr", images, dets, dir, log, subset, method);
  const db = openCatalog(cfg.catalog);
  const cache = new Map<string, Candidate | undefined>();
  const score = new Map([...dets.values()].flatMap((d) => d.spines.map((s, i): [string, number] => [`${d.id}:${i}`, s.boxScore])));
  const imageOf = (id: string) => id.slice(0, id.lastIndexOf(":"));
  const readings0 = loadReadings(dir, method);
  const first = new Map([...subset].map((id) => [id, decide(db, id, imageOf(id), score.get(id)!, { vision: readings0.get(id)?.vision, ppocr: readings0.get(id)?.ppocr }, cache)]));
  // F-0's Qwen selection per photo: hard crops with text, highest box score first, up to the cap. Kept boxes outside
  // the subset keep their cached first-pass state.
  const selected = new Set<string>();
  for (const img of images) {
    [...kept]
      .filter((id) => imageOf(id) === img.id)
      .filter((id) => (subset.has(id) ? firstPassHard(first.get(id)!) : before.has(id) && firstPassHard(before.get(id)!)))
      .sort((a, b) => score.get(b)! - score.get(a)!)
      .slice(0, cfg.qwenCap)
      .filter((id) => subset.has(id))
      .forEach((id) => selected.add(id));
  }
  log(`${set} ${arm}: qwen on ${selected.size} hard crops`);
  await pyReaderStage("qwen", images, dets, dir, log, selected, method);
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
const pctOf = (k: number, n: number) => (n ? Math.round((1000 * k) / n) / 10 : null);

interface Box extends FaceRow {
  key: string;
  imageId: string;
}

/** Face-share aggregates over the kept boxes of one set, with H-1's strata. */
function faceSummary(boxes: Box[]) {
  const measured = boxes.filter((b) => faceShares(b));
  const over = measured.filter((b) => b.overSelects);
  const feasible = over.filter((b) => face3dTrim(b));
  const boot = (pred: (b: Box) => boolean, of: Box[], seed: number) => {
    const r = clusterBootstrap(of, (rs) => (rs.length ? rs.filter(pred).length / rs.length : null), REPS, seed);
    return r && [r4(r.value), r4(r.lo), r4(r.hi)];
  };
  const pixelShares = (bs: Box[]) => {
    const tot = bs.reduce((s, b) => s + (b.pixels ?? 0), 0);
    return Object.fromEntries(FACE_CLASSES.map((k) => [k, tot ? r4(bs.reduce((s, b) => s + (b[k] ?? 0), 0) / tot) : null]));
  };
  const byElev = Object.fromEntries(
    (["below", "level", "above"] as const).map((e, i) => {
      const bs = measured.filter((b) => elevationBand(b) === e);
      return [e, { boxCount: bs.length, overSelects: boot((b) => !!b.overSelects, bs, 31 + i), pixelShares: pixelShares(bs) }];
    }),
  );
  const dom: Record<string, number> = {};
  for (const b of over) dom[dominantExtra(b) ?? "none"] = (dom[dominantExtra(b) ?? "none"] ?? 0) + 1;
  const keep = feasible.map((b) => b.trim!.areaShare).sort((a, b) => a - b);
  return {
    boxCount: boxes.length,
    measured: measured.length,
    skipped: boxes.length - measured.length,
    photos: new Set(boxes.map((b) => b.imageId)).size,
    overSelects: boot((b) => !!b.overSelects, measured, 11),
    trimFeasibleOfOverSelecting: boot((b) => !!face3dTrim(b), over, 12),
    face3dCandidates: feasible.length,
    trimAreaShareQuartiles: keep.length ? [quantile(keep, 0.25), quantile(keep, 0.5), quantile(keep, 0.75)].map(r4) : null,
    pixelShares: pixelShares(measured),
    byElevation: byElev,
    dominantExtraOfOverSelecting: Object.fromEntries(Object.entries(dom).map(([k, n]) => [k, pctOf(n, over.length)])),
    ownPlane: pctOf(measured.filter((b) => b.ownPlane).length, measured.length),
    topFaceShown: pctOf(measured.filter((b) => topFace(b)).length, measured.length),
  };
}

function timing(set: SetName) {
  const lines = (tag: string) => {
    const p = join(PRIV, set, `stage-${tag}.jsonl`);
    return existsSync(p) ? readJsonl<{ photo?: boolean; hit: { geometry: boolean; faces: boolean }; seconds: Record<string, number>; modelLoadSeconds: number; device: string; fovGiven: boolean }>(p).filter((x) => x.photo) : [];
  };
  const cold = lines("cold"), warm = lines("warm");
  if (!cold.length) return null;
  const q = (k: string) => {
    const xs = cold.map((x) => x.seconds[k]!).sort((a, b) => a - b);
    return { p50: r4(quantile(xs, 0.5)), p90: r4(quantile(xs, 0.9)), max: r4(xs[xs.length - 1]!) };
  };
  return {
    photos: cold.length,
    device: cold[0]!.device,
    coldAllMisses: cold.every((x) => !x.hit.geometry && !x.hit.faces),
    secondsPerPhoto: { total: q("total"), decode: q("decode"), infer: q("infer"), save: q("save"), faces: q("faces") },
    modelLoadSeconds: Math.max(...cold.map((x) => x.modelLoadSeconds)),
    fovFromExif: cold.filter((x) => x.fovGiven).length,
    warm: warm.length ? { photos: warm.length, allHits: warm.every((x) => x.hit.geometry && x.hit.faces), totalP50: r4(quantile(warm.map((x) => x.seconds.total!).sort((a, b) => a - b), 0.5)) } : null,
  };
}

function analyse(): void {
  const truth = yardstickTruth();
  const sets: Record<string, unknown> = {};
  const verdictParts: Record<string, any> = {};
  for (const set of Object.keys(SETS) as SetName[]) {
    const tr = set === "pilot-000" ? undefined : truth;
    const dets = withTrims(loadDets(set), faceRows(set));
    const kept = keptIds(set);
    const rows = faceRows(set);
    const boxes: Box[] = [...kept].flatMap((id) => (rows.has(id) ? [{ ...rows.get(id)!, key: id, imageId: id.slice(0, id.lastIndexOf(":")) }] : []));
    const out: Record<string, any> = { scope: F0B_SETS[set].scope, faces: faceSummary(boxes), timing: timing(set) };
    const subset = subsetOf(set, dets, kept);
    const paths = { clip: join(PRIV, set, "clip", "decisions.jsonl"), face3d: join(PRIV, set, "face3d", "decisions.jsonl") };
    if (existsSync(paths.clip) && existsSync(paths.face3d)) {
      const dec = (p: string) => new Map(readJsonl<SpineDecision & { qwenSelected?: boolean }>(p).map((d) => [d.id, d]));
      const bef = dec(paths.clip), aft = dec(paths.face3d);
      const base = new Map(readJsonl<SpineDecision>(join(PRIV, set, "base-decisions.jsonl")).map((d) => [d.id, d]));
      for (const id of subset) if (!bef.has(id) || !aft.has(id)) throw new Error(`${set}: arm decisions do not cover the subset; re-run them`);
      const geo = new Map(geometry(dets).map((g): [string, Geo] => [g.id, g]));
      const byId = new Map(boxes.map((b) => [b.key, b]));
      const pairs = (sel: (id: string) => boolean): Pair[] =>
        [...subset].filter(sel).map((id) => ({ id, imageId: geo.get(id)!.imageId, before: outcomeOf(bef.get(id)!, tr?.get(geo.get(id)!.imageId)), after: outcomeOf(aft.get(id)!, tr?.get(geo.get(id)!.imageId)) }));
      const summary = (rs: Pair[], seed: number) => ({
        boxCount: rs.length,
        photos: new Set(rs.map((r) => r.imageId)).size,
        textRead: delta(rs, textRead, seed),
        confirmed: delta(rs, confirmed, seed + 1),
        ...(tr ? { wrong: delta(rs, wrong, seed + 2) } : {}),
      });
      const strata: Record<string, (id: string) => boolean> = {
        "below eye level": (id) => elevationBand(byId.get(id)!) === "below",
        "level": (id) => elevationBand(byId.get(id)!) === "level",
        "above eye level": (id) => elevationBand(byId.get(id)!) === "above",
        "mostly a top face": (id) => dominantExtra(byId.get(id)!) === "top",
        "mostly a cover": (id) => dominantExtra(byId.get(id)!) === "cover",
        "mostly behind": (id) => dominantExtra(byId.get(id)!) === "behind",
        "whole boxes": (id) => !geo.get(id)!.piece,
        "cut or partial boxes": (id) => geo.get(id)!.piece,
        "in frame": (id) => geo.get(id)!.inFrame,
        "partly out of frame": (id) => !geo.get(id)!.inFrame,
      };
      // Distinct confirmed works over the whole set: subset boxes take each arm's decision, the rest their cached one.
      let distinct: unknown = null;
      if (!tr) {
        const all = [...kept].map((id) => ({ imageId: id.slice(0, id.lastIndexOf(":")), b: subset.has(id) ? workOf(bef.get(id)) : workOf(base.get(id)), a: subset.has(id) ? workOf(aft.get(id)) : workOf(base.get(id)) }));
        const count = (rs: typeof all, k: "a" | "b") => new Set(rs.flatMap((r) => (r[k] ? [r[k]] : []))).size;
        const d = clusterBootstrap(all, (rs) => count(rs, "a") - count(rs, "b"), REPS, 61);
        distinct = { before: count(all, "b"), after: count(all, "a"), delta: d && { value: d.value, lo: d.lo, hi: d.hi } };
      }
      // Sanity: in frame the clip arm reads the cached crop, so its decisions should match the cached ones.
      const inFrame = [...subset].filter((id) => geo.get(id)!.inFrame);
      const clipMatchesBase = pctOf(inFrame.filter((id) => workOf(bef.get(id)) === workOf(base.get(id)) && bef.get(id)!.reason === base.get(id)!.reason).length, inFrame.length);
      const changed = [...subset].length;
      out.face3d = {
        cropMethod: cropName(FACE3D_CROP),
        against: cropName(CROP),
        subset: changed,
        all: summary(pairs(() => true), 11),
        strata: Object.fromEntries(Object.entries(strata).map(([k, f], i) => [k, summary(pairs(f), 21 + 3 * i)])),
        ...(distinct ? { distinctConfirmedWorks: distinct } : {}),
        clipArmMatchesCachedInFrame: clipMatchesBase,
        cost: {
          before: cost(loadReadings(join(PRIV, set, "clip"), CROP), subset, (id) => Boolean(bef.get(id)?.qwenSelected)),
          after: cost(loadReadings(join(PRIV, set, "face3d"), FACE3D_CROP), subset, (id) => Boolean(aft.get(id)?.qwenSelected)),
        },
      };
      verdictParts[set] = out.face3d;
    }
    sets[set] = out;
  }
  // Keep rule (pre-registered, evals/H2/report.md): F-0b's rule plus the distinct-works guard on pilot-000.
  const p = verdictParts["pilot-000"], y = verdictParts["yardstick-library-b2"];
  const verdict = p && y
    ? (() => {
        const pilotUp = !!p.all.confirmed && p.all.confirmed.lo > 0;
        const works = !!p.distinctConfirmedWorks?.delta && p.distinctConfirmedWorks.delta.value >= 0;
        const yardConf = !y.all.confirmed || y.all.confirmed.hi >= 0;
        const yardWrong = !y.all.wrong || y.all.wrong.lo <= 0;
        return { keep: pilotUp && works && yardConf && yardWrong, pilotConfirmedExcludesZero: pilotUp, pilotDistinctWorksNotDown: works, yardstickConfirmedNotDown: yardConf, yardstickWrongNotUp: yardWrong };
      })()
    : null;
  const m = {
    runId: "H2",
    card: "H-2",
    date: new Date().toLocaleDateString("en-CA"),
    model: { id: "Ruicheng/moge-2-vitl-normal", revision: "cb0e8bbd6b1e243589717c78e750b1ba4c093acf", licence: "MIT", longSide: 2048 },
    shippedCrop: cropName(CROP),
    candidateCrop: cropName(FACE3D_CROP),
    bootstrap: { unit: "photo (cluster), paired: the same boxes before and after", reps: REPS, interval: "95 % percentile", units: "percentage points (distinct works: count)" },
    keepRule: "keep when the pilot-000 confirmed-share interval excludes 0 upward, pilot-000 distinct confirmed works do not fall, and on the yardstick the confirmed share does not fall, nor the wrong-accept share rise, beyond its interval",
    verdict,
    sets,
  };
  const dir = join(REPO, "evals", "H2");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "metrics.json"), compactJson(m) + "\n");
  const reportPath = join(dir, "report.md");
  const head = existsSync(reportPath) ? readFileSync(reportPath, "utf8").split(MARKER)[0]! : "# H2: spine-face trim and face labels (H-2)\n\n";
  writeFileSync(reportPath, head + MARKER + "\n\n" + tables(m) + "\n");
  log("aggregates -> evals/H2/{metrics.json,report.md}");
}

const MARKER = "<!-- generated by src/eval/h2-cli.ts analyse: edit above this line -->";

function tables(m: { verdict: any; sets: Record<string, any> }): string {
  type D = { before: number; after: number; delta: number; lo: number; hi: number } | null | undefined;
  const fmt = (d: D) => (d ? `${d.before} → ${d.after} (${d.delta >= 0 ? "+" : ""}${d.delta}; ${d.lo} to ${d.hi})` : "—");
  const tri = (t: number[] | null) => (t ? `${(t[0]! * 100).toFixed(1)} % (${(t[1]! * 100).toFixed(1)}–${(t[2]! * 100).toFixed(1)})` : "—");
  const pc = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(1)} %`);
  const out: string[] = [];
  for (const [set, s] of Object.entries(m.sets)) {
    const yard = set !== "pilot-000";
    const f = s.faces;
    out.push(`## ${set} (${s.scope})`, "", "### Face shares", "");
    out.push(
      `${f.boxCount} kept boxes in ${f.photos} photos; ${f.measured} measured, ${f.skipped} skipped (no pixels, no frame or under 20 map pixels). Over-selecting: **${tri(f.overSelects)}**. Of those, trim feasible: ${tri(f.trimFeasibleOfOverSelecting)}, so ${f.face3dCandidates} \`face3d\` candidates; a feasible trim keeps ${f.trimAreaShareQuartiles ? f.trimAreaShareQuartiles.map((x: number) => `${Math.round(x * 100)} %`).join(" / ") : "—"} of the box (quartiles). Own spine plane: ${f.ownPlane} %. Top face drawn (top face visible, depth not default): ${f.topFaceShown} %.`,
      "",
      "| boxes | n | over-select | front px | edge px | top px | under px | cover px | behind px |",
      "|---|---:|---|---:|---:|---:|---:|---:|---:|",
      `| all | ${f.measured} | ${tri(f.overSelects)} | ${FACE_CLASSES.map((k) => pc(f.pixelShares[k])).join(" | ")} |`,
      ...Object.entries<any>(f.byElevation).map(([k, e]) => `| ${k} eye level | ${e.boxCount} | ${tri(e.overSelects)} | ${FACE_CLASSES.map((c) => pc(e.pixelShares[c])).join(" | ")} |`),
      "",
      `Mostly which extra face, over-selecting boxes: ${Object.entries<number | null>(f.dominantExtraOfOverSelecting).map(([k, v]) => `${k} ${v} %`).join(", ")}.`,
      "",
    );
    if (s.timing) {
      const t = s.timing, sp = t.secondsPerPhoto;
      out.push(
        "### Cost (exit c)",
        "",
        `Cold cache, ${t.photos} photos on ${t.device}; seconds per photo, p50 / p90 / max. Model load ${t.modelLoadSeconds} s once per process, not counted. EXIF field of view on ${t.fovFromExif} photos.`,
        "",
        "| step | p50 | p90 | max |",
        "|---|---:|---:|---:|",
        ...(["decode", "infer", "save", "faces", "total"] as const).map((k) => `| ${k} | ${sp[k].p50} | ${sp[k].p90} | ${sp[k].max} |`),
        "",
        t.warm ? `Second run: ${t.warm.photos} photos, ${t.warm.allHits ? "all cache hits" : "**not all cache hits**"}, ${t.warm.totalP50} s a photo (p50).` : "No second run.",
        "",
      );
    }
    const x = s.face3d;
    if (x) {
      out.push(
        "### `face3d` against `clip=frame`",
        "",
        `${x.subset} boxes in the subset. Shares in % of them, before → after (Δ points; 95 % paired photo-bootstrap interval). ${yard ? "Confirmed = accepted and annotated in the image; wrong = accepted, not annotated." : "Machine agreement, never accuracy (INV-17)."} In frame, the before arm reproduces the cached decision on ${x.clipArmMatchesCachedInFrame} % of boxes.`,
        "",
        `| boxes | n | photos | text read | confirmed |${yard ? " wrong |" : ""}`,
        `|---|---:|---:|---|---|${yard ? "---|" : ""}`,
      );
      const row = (label: string, r: any) => `| ${label} | ${r.boxCount} | ${r.photos} | ${fmt(r.textRead)} | ${fmt(r.confirmed)} |${yard ? ` ${fmt(r.wrong)} |` : ""}`;
      out.push(row("**all**", x.all), ...Object.entries<any>(x.strata).map(([k, r]) => row(`  ${k}`, r)), "");
      if (x.distinctConfirmedWorks) {
        const d = x.distinctConfirmedWorks;
        out.push(`Distinct confirmed works over the whole set: ${d.before} → ${d.after} (${d.delta ? `${d.delta.value >= 0 ? "+" : ""}${d.delta.value}; ${d.delta.lo} to ${d.delta.hi}` : "—"}).`, "");
      }
      const c = (k: string, w: string) => `${x.cost.before[k][w]} → ${x.cost.after[k][w]}`;
      out.push("| reader | calls | seconds |", "|---|---:|---:|", ...["vision", "ppocr", "qwen"].map((k) => `| ${k} | ${c(k, "calls")} | ${c(k, "seconds")} |`), "");
    }
  }
  if (m.verdict) {
    const v = m.verdict;
    const yn = (b: boolean) => (b ? "yes" : "no");
    out.push(
      "## Verdict",
      "",
      "| pilot-000 confirmed interval excludes 0 upward | pilot-000 distinct works not down | yardstick confirmed not down | yardstick wrong not up | keep |",
      "|---|---|---|---|---|",
      `| ${yn(v.pilotConfirmedExcludesZero)} | ${yn(v.pilotDistinctWorksNotDown)} | ${yn(v.yardstickConfirmedNotDown)} | ${yn(v.yardstickWrongNotUp)} | **${v.keep ? "keep" : "off"}** |`,
    );
  }
  return out.join("\n");
}

// --- render: U-4's still study with spine faces and top faces -------------------------------------------

function render(): void {
  const faces = join(PRIV, "pilot-000", "faces.jsonl");
  if (!existsSync(faces)) throw new Error("run `h2-cli.ts stage pilot-000` first");
  const out = join(PRIV, "renders", "pilot-000");
  const r = spawnSync(process.execPath, [join(REPO, "src", "eval", "u4-cli.ts"), "render", "--faces", faces, "--out", out], { stdio: ["ignore", "ignore", "inherit"] });
  if (r.status !== 0) throw new Error("u4-cli render failed");
  log("still study under the data root's private/h2/renders/pilot-000/index.html");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, set, arg] = process.argv.slice(2);
  const tag = process.argv.includes("--tag") ? process.argv[process.argv.indexOf("--tag") + 1]! : "latest";
  if (cmd === "stage" && isSet(set)) stage(set, tag);
  else if (cmd === "base" && isSet(set)) base(set);
  else if (cmd === "run" && isSet(set) && arg) await run(set, arg);
  else if (cmd === "analyse") analyse();
  else if (cmd === "render") render();
  else {
    console.error("usage: h2-cli.ts stage <set> [--tag T] | base <set> | run <set> <clip|face3d> | analyse | render   (set: pilot-000 | yardstick-library-b2)");
    process.exit(2);
  }
}
