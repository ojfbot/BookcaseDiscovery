// NS-11 runner: the mono-geometry student, distilled from MoGe-2's cached face shares and normals. Prereg: evals/NS11/prereg.md.
//
//   node src/eval/ns11-cli.ts targets   # CPU: the teacher table, private/ns11/targets-<set>.jsonl (stamped), from H-2's caches
//   node src/eval/ns11-cli.ts crops     # CPU: each box's 128x128 crop and geometry vector, private/ns11/crops-<set>.npz
//   node src/eval/ns11-cli.ts train [geomonly|croponly]  # MPS: the nine pre-registered runs (two-hour cap), weights under models/;
//                                       # the two variants are exploratory ablations, not pre-registered, same cap
//   node src/eval/ns11-cli.ts export    # Core ML (float16) of the frozen-split artifact, size and Mac latency
//   node src/eval/ns11-cli.ts score     # evals/NS11/{metrics.json,report.md}: aggregates only
//   node src/eval/ns11-cli.ts register  # models/registry/ns11-mono-geometry-student.json
//
// Reads, never rewrites: H-2's stage and faces files and its byte cache, F-0's detections, F-1's manifest. No new MoGe-2
// run (a missing cache entry stops the card). Everything per box or per photo stays under the data root's private/ns11/.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dataRoot } from "../ledger/images.ts";
import { checkLineage, makeStamp, writeLineage } from "../ledger/lineage.ts";
import { modelHashes } from "../ledger/models.ts";
import { readDatasetManifest } from "../capture/dataset.ts";
import { readJsonl, type Detection } from "./f0.ts";
import { DEPTH_MODELS, DEPTH_STAGE_SCHEMA, FACES_SCHEMA, MONO_GEOMETRY_MODELS, MONO_GEOMETRY_TARGETS_SCHEMA } from "./lineage-classes.ts";
import { roleOf, assertTrainable } from "./set-roles.ts";
import { quantile } from "./q1.ts";
import { ARMS, NS11, admit, classCounts, compare, keepRule, mean, meanTarget, median, perBox, perCluster, renderReport, scoreArm, unit, type Exclusion, type FaceCounts, type Metrics, type Scored, type Vec3 } from "./ns11.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const ROOT = dataRoot();
const PRIV = join(ROOT, "private", "ns11");
const H2 = join(ROOT, "private", "h2");
const log = (s: string): void => console.error(`[ns11] ${new Date().toISOString().slice(11, 19)} ${s}`);

export type SetName = "pilot-000" | "yardstick-library-b2";
export const SETS: Record<SetName, { detect: string }> = {
  "pilot-000": { detect: join(ROOT, "f0e", "pilot-000", "bands+strips", "detect.jsonl") },
  "yardstick-library-b2": { detect: join(ROOT, "f0", "yardstick-library-b2", "detect.jsonl") },
};
const SET_NAMES = Object.keys(SETS) as SetName[];

/** One row of the teacher table (private). */
export interface TargetRow {
  set: SetName;
  role: string;
  photo: string;
  box: number;
  image: string;
  width: number;
  height: number;
  polygon: [number, number][];
  cut: boolean;
  splitGroup: string;
  split: string;
  counts: FaceCounts;
  shares3: Vec3;
  mass: number;
  meanNormal: Vec3;
  labelSource: string;
  rgbRecoverable: string;
  geometryKey: string;
  facesKey: string;
}

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

function python(script: string, args: string[], extra: Record<string, string> = {}): void {
  const py = join(REPO, "helpers", "geometry-student", ".venv", "bin", "python");
  if (!existsSync(py)) throw new Error("helpers/geometry-student has no .venv: run `uv sync` there first");
  mkdirSync(join(PRIV, "torch-home"), { recursive: true });
  const r = spawnSync(py, ["-I", join(REPO, "helpers", "geometry-student", script), ...args], {
    stdio: ["ignore", "inherit", "inherit"],
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", BOOKCASE_DATA: ROOT, HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", TORCH_HOME: join(PRIV, "torch-home"), ...extra },
  });
  if (r.status !== 0) throw new Error(`${script} ${args[0]} failed (${r.status})`);
}

// --- targets ---------------------------------------------------------------------------------------------

interface StageRow extends FaceCounts {
  id: string;
  box: number | string;
  cut?: boolean;
  photo?: boolean;
  geometryKey?: string;
  facesKey?: string;
}

function targets(): void {
  mkdirSync(PRIV, { recursive: true });
  const latest = JSON.parse(readFileSync(join(ROOT, "datasets", "label-ledger", "latest.json"), "utf8")).version as string;
  const manifest = readDatasetManifest(JSON.parse(readFileSync(join(ROOT, "datasets", "label-ledger", latest, "manifest.json"), "utf8")));
  const byPhoto = new Map(manifest.photos.map((p) => [p.sha256, p]));
  const summary: Record<string, unknown> = { ledgerVersion: latest };
  for (const set of SET_NAMES) {
    const role = roleOf(set);
    if (set === "pilot-000") assertTrainable(set, "NS-11");
    else if (role === null || role === "training-source") throw new Error(`NS-11: ${set} must be an evaluation-only set (role ${role})`);
    const dir = join(H2, set);
    const stagePath = join(dir, "stage-latest.jsonl");
    checkLineage(stagePath, { schema: DEPTH_STAGE_SCHEMA, models: modelHashes(DEPTH_MODELS) });
    checkLineage(join(dir, "faces.jsonl"), { schema: FACES_SCHEMA, models: modelHashes(DEPTH_MODELS) });
    const stage = readJsonl<StageRow>(stagePath);
    const photos = new Map(stage.filter((r) => r.photo).map((r) => [r.id, r]));
    const rows = new Map(stage.filter((r) => !r.photo).map((r) => [`${r.id}:${r.box}`, r]));
    const kept = readJsonl<{ id: string; skip: unknown }>(join(dir, "faces.jsonl")).filter((r) => r.skip === null);
    const dets = new Map(readJsonl<Detection>(SETS[set].detect).filter((d) => !d.error).map((d) => [d.id, d]));
    const images = new Map(readJsonl<{ id: string; image: string }>(join(dir, "images.jsonl")).map((x) => [x.id, x.image]));
    const gdir = join(H2, "cache", "geometry", `moge-2-vitl-normal@${NS11.teacher.revision.slice(0, 7)}`);

    // The inputs of the normals step: one line per photo, its kept boxes' outlines.
    const keptByPhoto = new Map<string, number[]>();
    for (const k of kept) {
      const [photo, box] = [k.id.slice(0, k.id.lastIndexOf(":")), Number(k.id.slice(k.id.lastIndexOf(":") + 1))];
      (keptByPhoto.get(photo) ?? keptByPhoto.set(photo, []).get(photo)!).push(box);
    }
    const missing: string[] = [];
    const lines: string[] = [];
    for (const [photo, boxes] of keptByPhoto) {
      const p = photos.get(photo);
      const geometry = p?.geometryKey ? join(gdir, `${p.geometryKey}.npz`) : null;
      if (!p || !geometry || !existsSync(geometry) || !images.get(photo)) {
        missing.push(photo);
        continue;
      }
      lines.push(JSON.stringify({ photo, image: images.get(photo), geometry, boxes: boxes.map((box) => ({ box, polygon: dets.get(photo)!.spines[box]!.polygon })) }));
    }
    if (missing.length) throw new Error(`${set}: ${missing.length} photos have no cached geometry; NS-11 runs no new MoGe-2 (stage.py would be run unchanged, and the report must say so)`);
    const inputs = join(PRIV, `normal-inputs-${set}.jsonl`);
    writeFileSync(inputs, lines.join("\n") + "\n");
    const normalsPath = join(PRIV, `normals-${set}.jsonl`);
    python("student.py", ["normals", "--inputs", inputs, "--out", normalsPath]);

    const sizes = new Map<string, { width: number; height: number }>();
    const normals = new Map<string, { normal: Vec3 | null; pixels: number }>();
    for (const r of readJsonl<{ photo: string; box?: number; width?: number; height?: number; normal?: Vec3 | null; pixels?: number }>(normalsPath)) {
      if (r.box === undefined) sizes.set(r.photo, { width: r.width!, height: r.height! });
      else normals.set(`${r.photo}:${r.box}`, { normal: r.normal ?? null, pixels: r.pixels ?? 0 });
    }

    const excluded: Record<Exclusion, number> = { "no-face-row": 0, "no-normal": 0, "low-mass": 0 };
    const out: TargetRow[] = [];
    let pixelMismatch = 0;
    for (const k of kept) {
      const sep = k.id.lastIndexOf(":");
      const [photo, box] = [k.id.slice(0, sep), Number(k.id.slice(sep + 1))];
      const s = rows.get(k.id) ?? null;
      const n = normals.get(k.id);
      if (s && n && n.pixels !== s.pixels) pixelMismatch++;
      const a = admit(s, n?.normal ?? null);
      if (!a.ok) {
        excluded[a.why]++;
        continue;
      }
      const m = set === "pilot-000" ? byPhoto.get(photo) : null;
      if (set === "pilot-000" && !m) throw new Error("a pilot-000 photo is missing from the F-1 manifest");
      const g = photos.get(photo)!;
      out.push({
        set, role: role!, photo, box, image: images.get(photo)!, ...sizes.get(photo)!, polygon: dets.get(photo)!.spines[box]!.polygon as [number, number][], cut: !!s!.cut,
        splitGroup: m ? m.splitGroup : `photo:${photo}`, split: m ? m.split : "yardstick",
        counts: { front: s!.front, edge: s!.edge, top: s!.top, under: s!.under, cover: s!.cover, behind: s!.behind, pixels: s!.pixels },
        shares3: a.shares, mass: a.mass, meanNormal: n!.normal!, labelSource: NS11.labelSource, rgbRecoverable: NS11.rgbRecoverable,
        geometryKey: g.geometryKey!, facesKey: g.facesKey!,
      });
    }
    if (pixelMismatch) throw new Error(`${set}: ${pixelMismatch} boxes' normal pixels differ from H-2's pixel counts (the mask is not faces.py's)`);
    const path = join(PRIV, `targets-${set}.jsonl`);
    writeFileSync(path, out.map((r) => JSON.stringify(r)).join("\n") + "\n");
    writeLineage(path, makeStamp({ schema: MONO_GEOMETRY_TARGETS_SCHEMA, boxSet: sha256(kept.map((k) => k.id).sort().join("\n")), models: modelHashes(MONO_GEOMETRY_MODELS) }));
    const byGroup: Record<string, { photos: Set<string>; boxes: number; split: string }> = {};
    for (const r of out) {
      const e = (byGroup[r.splitGroup] ??= { photos: new Set(), boxes: 0, split: r.split });
      e.photos.add(r.photo);
      e.boxes++;
    }
    summary[set] = {
      photos: photos.size, keptBoxes: kept.length, admitted: out.length, excluded, labelSourceByRecoverable: { [`${NS11.labelSource} x ${NS11.rgbRecoverable}`]: out.length },
      groups: Object.values(byGroup).map((g) => ({ split: g.split, photos: g.photos.size, boxCount: g.boxes })).sort((a, b) => b.photos - a.photos),
    };
    log(`${set}: ${out.length} of ${kept.length} kept boxes admitted; excluded ${JSON.stringify(excluded)}`);
  }
  writeFileSync(join(PRIV, "targets-summary.json"), JSON.stringify(summary, null, 1) + "\n");
}

// --- crops, train ----------------------------------------------------------------------------------------

function crops(): void {
  for (const set of SET_NAMES) {
    checkLineage(join(PRIV, `targets-${set}.jsonl`), { schema: MONO_GEOMETRY_TARGETS_SCHEMA, models: modelHashes(MONO_GEOMETRY_MODELS) });
    python("student.py", ["crops", "--table", join(PRIV, `targets-${set}.jsonl`), "--out", join(PRIV, `crops-${set}.npz`)]);
  }
}

function train(): void {
  for (const set of SET_NAMES) checkLineage(join(PRIV, `targets-${set}.jsonl`), { schema: MONO_GEOMETRY_TARGETS_SCHEMA, models: modelHashes(MONO_GEOMETRY_MODELS) });
  const weights = join(ROOT, "models", "ns11-mono-geometry-student");
  python("student.py", [
    "runall", "--pilot-table", join(PRIV, "targets-pilot-000.jsonl"), "--pilot-crops", join(PRIV, "crops-pilot-000.npz"),
    "--yardstick-table", join(PRIV, "targets-yardstick-library-b2.jsonl"), "--yardstick-crops", join(PRIV, "crops-yardstick-library-b2.npz"),
    "--out", PRIV, "--weights", weights, "--variant", process.argv[3] ?? "full",
  ]);
}

// --- export ----------------------------------------------------------------------------------------------

const WEIGHTS = join(ROOT, "models", "ns11-mono-geometry-student");

function exportCoreMl(): void {
  const pkg = join(WEIGHTS, "student.mlpackage");
  if (existsSync(pkg)) throw new Error(`${pkg} exists; this card deletes nothing under the data root: move it aside first`);
  python("export_coreml.py", ["--weights", join(WEIGHTS, "student.pt"), "--table", join(PRIV, "targets-pilot-000.jsonl"), "--crops", join(PRIV, "crops-pilot-000.npz"), "--out", pkg, "--report", join(PRIV, "coreml.json")]);
}

// --- score -----------------------------------------------------------------------------------------------

interface Pred {
  set: string;
  i: number;
  shares: Vec3;
  normal: Vec3;
}
const readTable = (set: SetName): TargetRow[] => readJsonl<TargetRow>(join(PRIV, `targets-${set}.jsonl`));
const readPreds = (run: string): Pred[] => readJsonl<Pred>(join(PRIV, "runs", run, "preds.jsonl"));
const readRun = (run: string): Record<string, any> | null => (existsSync(join(PRIV, "runs", run, "run.json")) ? JSON.parse(readFileSync(join(PRIV, "runs", run, "run.json"), "utf8")) : null);
const readJson = (path: string): any => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null);

const target = (r: TargetRow): { y: Vec3; n: Vec3 } => ({ y: r.shares3, n: unit(r.meanNormal) });

/** Scored rows for `eval` rows predicted by `preds`; the oracle is each unit's own mean, the train mean is given. */
function scored(rows: TargetRow[], preds: Map<number, Pred>, evalIdx: number[], unitOf: (r: TargetRow) => string, trainMean: { y: Vec3; n: Vec3 }): Scored[] {
  const mean = new Map<string, { y: Vec3; n: Vec3 }>();
  const units = new Map<string, TargetRow[]>();
  for (const i of evalIdx) (units.get(unitOf(rows[i]!)) ?? units.set(unitOf(rows[i]!), []).get(unitOf(rows[i]!))!).push(rows[i]!);
  for (const [u, rs] of units) mean.set(u, meanTarget(rs.map(target)));
  return evalIdx.map((i) => {
    const r = rows[i]!;
    const p = preds.get(i);
    if (!p) throw new Error(`a prediction is missing for box ${i}`);
    const t = target(r);
    return { unit: unitOf(r), y: t.y, n: t.n, student: { y: p.shares, n: unit(p.normal) }, oracle: mean.get(unitOf(r))!, trainMean };
  });
}

const cap = (xs: number[]): { min: number; max: number } => ({ min: Math.min(...xs), max: Math.max(...xs) });

function score(): void {
  const pilot = readTable("pilot-000");
  const yard = readTable("yardstick-library-b2");
  const groups = [...new Set(pilot.map((r) => r.splitGroup))].sort();
  const groupOf = (r: TargetRow): string => r.splitGroup;
  const idxOf = (pred: (r: TargetRow) => boolean): number[] => pilot.flatMap((r, i) => (pred(r) ? [i] : []));

  // LOGO: each group predicted by the model that never saw it.
  const logoRuns = groups.map((g, k) => ({ g, name: `logo-${k + 1}` }));
  const logoRows: Scored[] = [];
  const missing: string[] = [];
  for (const { g, name } of logoRuns) {
    if (!readRun(name)) {
      missing.push(name);
      continue;
    }
    const preds = new Map(readPreds(name).filter((p) => p.set === "pilot-000").map((p) => [p.i, p]));
    const tm = meanTarget(pilot.filter((r) => r.splitGroup !== g).map(target));
    logoRows.push(...scored(pilot, preds, idxOf((r) => r.splitGroup === g), groupOf, tm));
  }
  const complete = missing.length === 0;
  const armsOf = (rows: Scored[]) => Object.fromEntries(ARMS.map((a) => [a, scoreArm(rows, a)]));
  const logo = complete
    ? { groups: groups.length, boxCount: logoRows.length, arms: armsOf(logoRows), vsOracle: compare(logoRows, "oracle"), vsTrainMean: compare(logoRows, "trainMean"), perGroup: perCluster(logoRows) }
    : null;
  const rule = logo ? keepRule(logo.vsOracle) : null;

  // Frozen split: the artifact (seed 20261105) and its two sibling seeds.
  const seeds = [NS11.seed, ...[20261106, 20261107]];
  const frozenTrain = pilot.filter((r) => r.split === "train").map(target);
  const frozenTrainMean = meanTarget(frozenTrain);
  const valIdx = idxOf((r) => r.split === "val");
  const perSeed = seeds.flatMap((s) => {
    const name = `frozen-${s}`;
    if (!readRun(name)) return [];
    const ps = readPreds(name);
    const val = scored(pilot, new Map(ps.filter((p) => p.set === "pilot-000").map((p) => [p.i, p])), valIdx, groupOf, frozenTrainMean);
    const yardRows = scored(yard, new Map(ps.filter((p) => p.set === "yardstick").map((p) => [p.i, p])), yard.map((_, i) => i), (r) => r.photo, frozenTrainMean);
    return [{ seed: s, name, val, yardRows }];
  });
  const art = perSeed.find((x) => x.seed === NS11.seed);
  const point = (rows: Scored[]) => {
    const st = rows.map((r) => perBox(r, "student"));
    const or = rows.map((r) => perBox(r, "oracle"));
    return { boxCount: rows.length, shareError: r4(mean(st.map((b) => b.shareErr))), medianAngle: r4(median(st.map((b) => b.angle))), top1: r4(st.filter((b) => b.top1).length / st.length), oracleShareError: r4(mean(or.map((b) => b.shareErr))), oracleMedianAngle: r4(median(or.map((b) => b.angle))) };
  };
  const frozen = art
    ? {
        valGroups: new Set(art.val.map((r) => r.unit)).size,
        note: "two validation groups: point values only, no interval (a bootstrap over two groups has three distinct resamples)",
        student: pointArms(art.val),
        perGroup: perCluster(art.val),
        seeds: perSeed.map((x) => ({ seed: x.seed, val: point(x.val), yardstick: point(x.yardRows) })),
        seedSpread: { shareError: cap(perSeed.map((x) => point(x.val).shareError)), medianAngle: cap(perSeed.map((x) => point(x.val).medianAngle)), top1: cap(perSeed.map((x) => point(x.val).top1)) },
      }
    : null;
  const yardstick = art
    ? { role: "yardstick (PROXY)", unit: "photo", photos: new Set(yard.map((r) => r.photo)).size, boxCount: art.yardRows.length, arms: armsOf(art.yardRows), vsOracle: compare(art.yardRows, "oracle"), vsTrainMean: compare(art.yardRows, "trainMean") }
    : null;

  // Exploratory ablations (not pre-registered, no keep rule): the student with no image, and with no geometry vector.
  const exploratory: Record<string, unknown> = {};
  for (const variant of ["geomonly", "croponly"] as const) {
    const names = logoRuns.map((x) => `${variant}-${x.name}`);
    if (!names.every((n) => readRun(n))) continue;
    const rows: Scored[] = [];
    const vsFull: Scored[] = [];
    logoRuns.forEach(({ g, name }, k) => {
      const preds = new Map(readPreds(names[k]!).filter((p) => p.set === "pilot-000").map((p) => [p.i, p]));
      const tm = meanTarget(pilot.filter((r) => r.splitGroup !== g).map(target));
      const mine = scored(pilot, preds, idxOf((r) => r.splitGroup === g), groupOf, tm);
      rows.push(...mine);
      const full = logoRows.filter((r) => r.unit === g);
      vsFull.push(...mine.map((r, i) => ({ ...r, oracle: full[i]!.student })));
    });
    const frozenName = `${variant}-frozen-${NS11.seed}`;
    const ps = readRun(frozenName) ? readPreds(frozenName) : [];
    const yardRows = ps.length ? scored(yard, new Map(ps.filter((p) => p.set === "yardstick").map((p) => [p.i, p])), yard.map((_, i) => i), (r) => r.photo, frozenTrainMean) : null;
    exploratory[variant] = {
      logo: { arm: scoreArm(rows, "student"), vsOracle: compare(rows, "oracle"), vsFullStudent: compare(vsFull, "oracle") },
      yardstick: yardRows ? { arm: scoreArm(yardRows, "student"), vsOracle: compare(yardRows, "oracle"), vsTrainMean: compare(yardRows, "trainMean") } : null,
      trainSeconds: names.reduce((a, n) => a + (readRun(n)!.wallSeconds as number), 0),
    };
  }

  const runs = [...logoRuns.map((x) => x.name), ...seeds.map((s) => `frozen-${s}`)].map((n) => readRun(n)).filter((x): x is Record<string, any> => !!x);
  const runall = readJson(join(PRIV, "runall.json"));
  const registeredSeconds = runs.reduce((a, r) => a + (r.wallSeconds as number), 0);
  const ablationSeconds = Object.values(exploratory).reduce((a: number, x: any) => a + x.trainSeconds, 0);
  const totalSeconds = registeredSeconds + ablationSeconds;
  const coreml = readJson(join(PRIV, "coreml.json"));
  const h2 = JSON.parse(readFileSync(join(REPO, "evals", "H2", "metrics.json"), "utf8"));
  const summary = readJson(join(PRIV, "targets-summary.json"));
  const boxesPerPhoto = pilot.length / new Set(pilot.map((r) => r.photo)).size;
  const sec = h2.sets["pilot-000"].timing.secondsPerPhoto;
  const cost = {
    teacher: { source: "evals/H2/metrics.json, pilot-000, 31 cold photos on MPS", inferenceP50Seconds: sec.infer.p50, wholeStageP50Seconds: sec.total.p50, modelLoadSeconds: h2.sets["pilot-000"].timing.modelLoadSeconds },
    student: {
      admittedBoxesPerPhoto: r4(boxesPerPhoto),
      mpsBatch64BoxesPerSecond: coreml?.mpsBatch64?.boxesPerSecond ?? null,
      mpsSecondsPerPhoto: coreml?.mpsBatch64 ? r4(boxesPerPhoto / coreml.mpsBatch64.boxesPerSecond) : null,
      coreMlSecondsPerPhotoOneByOne: Object.fromEntries(Object.entries(coreml?.latencyMs ?? {}).filter(([, v]: [string, any]) => v.median).map(([k, v]: [string, any]) => [k, r4((boxesPerPhoto * v.median) / 1000)])),
      note: "the student's time covers its forward passes only: cutting the crops from the photo is not measured",
    },
  };

  const metrics = {
    runId: "NS11", card: "NS-11", date: new Date().toISOString().slice(0, 10), prereg: "evals/NS11/prereg.md",
    scope: "agreement with MoGe-2 (a machine output), never accuracy on real use (OC36); development run",
    teacher: NS11.teacher, labelSource: NS11.labelSource, rgbRecoverable: NS11.rgbRecoverable, ledgerVersion: summary?.ledgerVersion,
    population: { pilot: summary?.["pilot-000"] && { ...summary["pilot-000"], groups: summary["pilot-000"].groups.map((g: any) => ({ split: g.split, photos: g.photos, boxCount: g.boxCount ?? g.boxes })) }, yardstick: { ...summary?.["yardstick-library-b2"], groups: undefined }, teacherClasses: { pilot: classCounts(pilot.map((r) => r.shares3)), yardstick: classCounts(yard.map((r) => r.shares3)) } },
    bootstrap: { reps: NS11.reps, seed: NS11.seed, interval: "95 % percentile", unit: "split group on pilot-000, photo on the yardstick" },
    logo, keepRule: rule, missingRuns: missing, frozen, yardstick, exploratory,
    training: { runs: runs.map((r) => ({ name: r.name, seed: r.seed, kind: r.kind, params: r.params, epochs: r.epochs, trainRows: r.trainRows, evalRows: r.evalRows, trainGroups: r.trainGroups.length, evalGroups: r.evalGroups.length, trainSeconds: r.trainSeconds, wallSeconds: r.wallSeconds, finalLoss: r.epochLoss[r.epochLoss.length - 1], firstLoss: r.epochLoss[0] })),
      registeredWallSeconds: r4(registeredSeconds), ablationWallSeconds: r4(ablationSeconds), totalWallSeconds: r4(totalSeconds), capSeconds: 7200, peakRssBytes: Math.max(0, ...runs.map((r) => r.peakRssBytes)), peakMpsAllocatedBytes: Math.max(0, ...runs.map((r) => r.mpsAllocatedBytes)), device: runs[0]?.device },
    coreml: coreml ? { ...coreml, traceback: undefined, latencyMs: Object.fromEntries(Object.entries(coreml.latencyMs ?? {}).map(([k, v]: [string, any]) => [k, v.error ? { error: v.error } : { median: v.median, p90: v.p90, loadSeconds: v.loadSeconds, timedCalls: v.timedCalls ?? v.predictions }])), agreement: Object.fromEntries(Object.entries(coreml.agreement ?? {}).map(([k, v]: [string, any]) => [k, { boxCount: v.boxCount ?? v.boxes, maxAbsShareDiff: v.maxAbsShareDiff, maxNormalDiffDeg: v.maxNormalDiffDeg, top1Same: v.top1Same }])) } : null, cost,
    ns5: { realColumnCases: 0, minimumCases: 14, confidenceOneSided: 0.9375, marginPoints: 2.5, downWeight: 0.3, verdict: "insufficient data", reason: "No degraded-tier session exists; every pilot-000 still is metric-depth, shopper-still, caseId null." },
    verdicts: {
      developmentKeepRule: rule ? (rule.kept ? "kept" : "not kept") : "not scored (runs missing)",
      ns5: "insufficient data",
    },
  };
  mkdirSync(join(REPO, "evals", "NS11"), { recursive: true });
  writeFileSync(join(REPO, "evals", "NS11", "metrics.json"), JSON.stringify(metrics, null, 1) + "\n");
  writeFileSync(join(REPO, "evals", "NS11", "report.md"), renderReport(metrics as unknown as Metrics));
  log(`wrote evals/NS11/{metrics.json,report.md}; development keep rule: ${metrics.verdicts.developmentKeepRule}`);
}

function pointArms(rows: Scored[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const a of ARMS) {
    const bs = rows.map((r) => perBox(r, a));
    const sorted = (xs: number[]) => [...xs].sort((p, q) => p - q);
    out[a] = {
      boxCount: bs.length, shareError: { mean: r4(mean(bs.map((b) => b.shareErr))), p50: r4(quantile(sorted(bs.map((b) => b.shareErr)), 0.5)), p90: r4(quantile(sorted(bs.map((b) => b.shareErr)), 0.9)) },
      angleDeg: { mean: r4(mean(bs.map((b) => b.angle))), p50: r4(quantile(sorted(bs.map((b) => b.angle)), 0.5)), p90: r4(quantile(sorted(bs.map((b) => b.angle)), 0.9)) },
      top1: r4(bs.filter((b) => b.top1).length / bs.length),
    };
  }
  return out;
}
const r4 = (x: number): number => (Number.isFinite(x) ? Math.round(x * 10000) / 10000 : x);

// --- register --------------------------------------------------------------------------------------------

const fileSha = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

/** A package's hash: SHA-256 over its files' relative paths and hashes, sorted (a `.mlpackage` is a folder). */
function folderSha(dir: string): string {
  const h = createHash("sha256");
  const walk = (d: string, rel: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory()) walk(join(d, e.name), `${rel}${e.name}/`);
      else h.update(`${rel}${e.name}\0${fileSha(join(d, e.name))}\n`);
    }
  };
  walk(dir, "");
  return h.digest("hex");
}

function register(): void {
  const metrics = JSON.parse(readFileSync(join(REPO, "evals", "NS11", "metrics.json"), "utf8"));
  const run = readRun(`frozen-${NS11.seed}`);
  if (!run) throw new Error("the artifact's run (frozen split, seed 20261105) is missing");
  const weights = join(WEIGHTS, "student.pt");
  const pkg = join(WEIGHTS, "student.mlpackage");
  const tables = SET_NAMES.map((s) => fileSha(join(PRIV, `targets-${s}.jsonl`)));
  const record = {
    name: "ns11-mono-geometry-student",
    card: "NS-11",
    kind: "from-scratch-cnn",
    base: null,
    architecture: { name: "GeometryStudentNet", parameters: run.params, family: "ResNet-style CNN, trained from scratch", input: "128x128 letterboxed RGB crop of a detected box + a 12-number geometry vector of its outline", outputs: "three face shares (spine, top, cover) + a unit mean normal in the camera frame" },
    teacher: { ...NS11.teacher, role: "label generator (MIT licence); never a model input", labelSource: NS11.labelSource, rgbRecoverable: NS11.rgbRecoverable },
    trainer: { library: "torch", version: "2.15.0", device: run.device, exporter: `coremltools ${metrics.coreml?.coremltools ?? "n/a"}` },
    targets: { class: "mono-geometry-targets", schema: MONO_GEOMETRY_TARGETS_SCHEMA, ledgerVersion: metrics.ledgerVersion, tablesSha256: { pilot: tables[0], yardstick: tables[1] }, admittedBoxes: { pilot: metrics.population.pilot.admitted, yardstick: metrics.population.yardstick.admitted }, scheme: "drop-unrecoverable (removes none: every row is mono-geometry x yes)" },
    splits: { artifact: { trainSplitGroups: run.trainGroups.length, valSplitGroups: run.evalGroups.length, trainRows: run.trainRows, valRows: run.evalRows }, keepRuleRuns: "leave-one-split-group-out over the 6 split groups of pilot-000", yardstick: "evaluation only (PROXY), never trained on" },
    hyperparameters: { optimiser: "AdamW", learningRate: run.lr, weightDecay: 0.0001, batchSize: run.batch, epochs: run.epochs, warmupEpochs: 2, schedule: "cosine to zero", seed: NS11.seed, augmentation: "brightness/contrast +-20 %, random resized crop 90-100 %, no flips" },
    weightsSha256: fileSha(weights),
    coreMl: metrics.coreml?.exported ? { packageSha256: folderSha(pkg), bytes: metrics.coreml.packageBytes, precision: "float16", format: "mlprogram" } : null,
    metrics: { evals: "evals/NS11/metrics.json", developmentKeepRule: metrics.verdicts.developmentKeepRule, ns5: metrics.verdicts.ns5 },
    licenceChain: "Student weights: trained from scratch, no base model. Teacher: MoGe-2 (MIT), used as a label generator. Training photos: pilot-000 (private real-use stills). No third-party weight in the student.",
    release: { status: "private-only", gates: { "G-W": "not eligible", "G-PUB": "not eligible" }, why: "Trained on the private pilot-000 stills; nothing is uploaded anywhere. A development run: NS-5 verdict is insufficient data." },
    evals: "evals/NS11/report.md",
  };
  writeFileSync(join(REPO, "models", "registry", "ns11-mono-geometry-student.json"), JSON.stringify(record, null, 2) + "\n");
  log("wrote models/registry/ns11-mono-geometry-student.json; now run `node bin/bookcase models manifest`");
}

const [cmd] = process.argv.slice(2);
const COMMANDS: Record<string, () => void | Promise<void>> = { targets, crops, train, export: exportCoreMl, score, register };
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const run = cmd ? COMMANDS[cmd] : undefined;
  if (!run) {
    console.error(`usage: ns11-cli.ts ${Object.keys(COMMANDS).join("|")}`);
    process.exit(2);
  }
  await run();
}
