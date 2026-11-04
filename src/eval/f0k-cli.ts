// F-0k runner: missed-book recovery (pre-registered in evals/F0k/prereg.md). Candidate regions from F-0h's
// detection-gap flags, S-2's front stretches with no box and S-2's occupied headroom; the detector re-prompted there
// with F-0e's tiling; F-0i's gate with the existing boxes fixed; F-0's readers and accept rule unchanged.
//
//   node src/eval/f0k-cli.ts regions <set>          # candidate regions, caps, re-prompt tiles (CPU)
//   node src/eval/f0k-cli.ts detect <set>           # helpers/label/recover.py detect: the candidate pool (GPU)
//   node src/eval/f0k-cli.ts gate <set>             # recover.py gate per arm, augmented detections (CPU)
//   node src/eval/f0k-cli.ts read <set> [--no-qwen] # probe, Vision, PP-OCR, Qwen with displacement, decisions
//   node src/eval/f0k-cli.ts analyse                # evals/F0k/{metrics.json,report.md}: aggregates only
//
// Sets (OC35, never merged): pilot-000 with F-0e's `bands+strips` boxes and the yardstick with F-0's B2 boxes, both
// after the shipped not-a-book filter and F-0i's partition. Existing box ids, outlines and readings are never edited;
// a recovered box is `photo:<n + k>` (k: its place in the photo's candidate pool). Everything per box or per photo
// goes under the data root's `private/f0k/`.
import { spawnSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Candidate } from "../catalog/retrieve.ts";
import { openCatalog } from "../catalog/cli.ts";
import { dataRoot } from "../ledger/images.ts";
import { cropFor, cropName } from "../perceive/crop.ts";
import { CASE_TILING, CROP, SHELF_TILING, decide, loadReadings, pyReaderStage, readJsonl, visionStage, type Detection, type InputImage, type Reading, type SpineDecision, type Tiling } from "./f0.ts";
import { SETS as F0B_SETS, cost } from "./f0b-cli.ts";
import { kinds } from "./f0c.ts";
import { titleDelta } from "./f0e.ts";
import { evidenceOf } from "./f0f.ts";
import { ARMS, F0K, SOURCES, boxGapRegion, capRegions, pairCount, qwenPlan, reTiles, type Pt, type Region, type Source } from "./f0k.ts";
import { compactJson, yardstickTruth } from "./q1-cli.ts";
import { clusterBootstrap } from "./q1.ts";
import { centroid, gapPolygon, type RowLine } from "./q3.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const ROOT = dataRoot();
const PRIV = join(ROOT, "private", "f0k");
const log = (s: string): void => console.error(`[f0k] ${s}`);
const priv = (...p: string[]) => join(ROOT, "private", ...p);

export type SetName = "pilot-000" | "yardstick-library-b2";
interface SetCfg { stage: string; tiling: Tiling; f0h: string; s1: string; s2: string; f0i: string; decisions: string; images: string }
const SETS: Record<SetName, SetCfg> = {
  "pilot-000": {
    stage: join(ROOT, "f0e", "pilot-000", "bands+strips"), tiling: CASE_TILING,
    f0h: priv("f0h", "pilot-000"), s1: priv("s1", "pilot-000"), s2: priv("s2", "pilot-000"), f0i: priv("f0i", "pilot-000"),
    decisions: priv("h2", "pilot-000", "base-decisions.jsonl"), images: priv("h2", "pilot-000", "images.jsonl"),
  },
  "yardstick-library-b2": {
    stage: join(ROOT, "f0", "yardstick-library-b2"), tiling: SHELF_TILING,
    f0h: priv("f0h", "yardstick"), s1: priv("s1", "yardstick"), s2: priv("s2", "yardstick"), f0i: priv("f0i", "yardstick-library-b2"),
    decisions: priv("h2", "yardstick-library-b2", "base-decisions.jsonl"), images: priv("h2", "yardstick-library-b2", "images.jsonl"),
  },
};
const isSet = (s: string | undefined): s is SetName => s === "pilot-000" || s === "yardstick-library-b2";
const ARM_NAMES = Object.keys(ARMS);

// --- inputs ----------------------------------------------------------------------------------------------

function py(helper: "label"): string {
  const p = join(REPO, "helpers", helper, ".venv", "bin", "python");
  if (!existsSync(p)) throw new Error(`helpers/${helper} has no .venv: run \`uv sync\` there first`);
  return p;
}

const loadDets = (set: SetName): Map<string, Detection> =>
  new Map(readJsonl<Detection>(join(SETS[set].stage, "detect.jsonl")).filter((d) => !d.error).map((d) => [d.id, d]));

const split = (id: string): [string, number] => {
  const k = id.lastIndexOf(":");
  return [id.slice(0, k), Number(id.slice(k + 1))];
};

/** F-0i's kept boxes (the existing box set). */
const keptExisting = (set: SetName): Set<string> =>
  new Set(readJsonl<{ id: string; state: string }>(join(SETS[set].f0i, "partition.jsonl")).filter((r) => r.state === "kept").map((r) => r.id));

function inputImages(set: SetName, ids: Iterable<string>): InputImage[] {
  const paths = new Map(readJsonl<{ id: string; image: string }>(SETS[set].images).map((x) => [x.id, x.image]));
  return [...ids].map((id) => {
    const path = paths.get(id);
    if (!path || !existsSync(path)) throw new Error(`image missing for a cached detection in ${set}`);
    return { id, photoHash: id, path, setting: set };
  });
}

/** Wait until no other GPU job (mlx, torch or Qwen, the fleet runner's `read-qwen` included) is running. */
function waitForGpu(): void {
  const pat = "mlx|torch|(read|detect|partition|stage|recover|zone|fields|imprint|faces|ends)\\.py";
  for (let n = 0; ; n++) {
    // pgrep -f also matches shells whose command text names a helper; count only python or mlx executables.
    const pids = (spawnSync("pgrep", ["-f", pat], { encoding: "utf8" }).stdout ?? "").split("\n").filter((x) => x.trim() && Number(x) !== process.pid);
    const others = pids.filter((p) => /python|mlx/i.test(spawnSync("ps", ["-o", "comm=", "-p", p], { encoding: "utf8" }).stdout ?? ""));
    if (!others.length) return;
    if (n % 10 === 0) log(`GPU busy (${others.length} job(s)); waiting`);
    spawnSync("sleep", ["60"]);
  }
}

// --- regions ---------------------------------------------------------------------------------------------

interface S1Row { band: number; skip?: string | null; elevationDeg?: number; voids?: { booksW: [number, number]; line: Pt[]; zone: [number, number]; stretches: { from: number; to: number; kind: string; dominant: string; frontNoBox?: boolean }[] } }
interface Shelf { id: string; rows: S1Row[] }

function rowLine(row: S1Row, d: Detection): RowLine {
  return { line: row.voids!.line, zone: row.voids!.zone, booksW0: row.voids!.booksW[0], mw: d.gaps.medianWidth };
}

export function buildRegions(set: SetName): { regions: Region[]; skipped: Record<string, number> } {
  const c = SETS[set];
  const dets = loadDets(set);
  const skipped: Record<string, number> = {};
  const skip = (k: string) => void (skipped[k] = (skipped[k] ?? 0) + 1);
  const out: Region[] = [];
  const poly = (d: Detection, i: number) => d.spines[i]!.polygon as unknown as Pt[];
  // 1. row-gaps: F-0h's flags.
  const s1 = new Map(readJsonl<Shelf>(join(c.s1, "shelf.jsonl")).map((x) => [x.id, x.rows]));
  readJsonl<{ kind: string; imageId: string; band: number; between: [number, number]; widths: number }>(join(c.f0h, "detection-gaps.jsonl")).forEach((f, j) => {
    const d = dets.get(f.imageId);
    if (!d) return skip("row-gaps: no detection");
    const id = `${f.imageId}:rg${j}`;
    if (f.kind === "box-gap") {
      const p = boxGapRegion(poly(d, f.between[0]), poly(d, f.between[1]));
      if (!p) return skip("row-gaps: boxes overlap along the row");
      return void out.push({ id, photo: f.imageId, source: "row-gaps", kind: f.kind, band: f.band, polygon: p });
    }
    const row = s1.get(f.imageId)?.find((r) => r.band === f.band && r.voids?.line?.length);
    if (!row) return skip("row-gaps: no S-1 row");
    const rl = rowLine(row, d);
    const dir = (() => {
      const a = rl.line[0]!, b = rl.line.at(-1)!;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [(b[0] - a[0]) / L, (b[1] - a[1]) / L] as Pt;
    })();
    const along = (p: Pt) => p[0] * dir[0] + p[1] * dir[1];
    const lo = Math.min(along(centroid(poly(d, f.between[0]))), along(centroid(poly(d, f.between[1]))));
    const hi = Math.max(along(centroid(poly(d, f.between[0]))), along(centroid(poly(d, f.between[1]))));
    const st = row.voids!.stretches.find((s) => {
      if (s.kind !== "outline-gap" || s.dominant !== "front" || Math.abs(s.to - s.from - f.widths) > 1e-3) return false;
      const m = along(centroid(gapPolygon(rl, s.from, s.to)));
      return m > lo && m < hi;
    });
    if (!st) return skip("row-gaps: S-1 stretch not found");
    out.push({ id, photo: f.imageId, source: "row-gaps", kind: f.kind, band: f.band, polygon: gapPolygon(rl, st.from, st.to) });
  });
  // 2. front-stretches: S-2's frontNoBox stretches, rebuilt as Q-3 did.
  const s2 = new Map(readJsonl<Shelf>(join(c.s2, "shelf.jsonl")).map((x) => [x.id, x.rows]));
  for (const g of readJsonl<{ imageId: string; band: number; stretches: { from: number; to: number; frontNoBox?: boolean }[] }>(join(c.s2, "gaps.jsonl"))) {
    const d = dets.get(g.imageId);
    const row = s2.get(g.imageId)?.find((r) => r.band === g.band && !r.skip && r.voids?.line?.length);
    g.stretches.forEach((s, j) => {
      if (!s.frontNoBox) return;
      if (!d || !row) return skip("front-stretches: no row line");
      out.push({ id: `${g.imageId}:fs${g.band}.${j}`, photo: g.imageId, source: "front-stretches", kind: "front-no-box", band: g.band, polygon: gapPolygon(rowLine(row, d), s.from, s.to) });
    });
  }
  // 3. headroom: S-2's occupied regions no box explains (candidates only).
  for (const r of readJsonl<{ id: string; imageId: string; candidate: boolean; band: number; contour: Pt[] }>(join(c.s2, "regions.jsonl"))) {
    if (!r.candidate) continue;
    if (!dets.has(r.imageId)) { skip("headroom: no detection"); continue; }
    out.push({ id: `${r.imageId}:hr${r.id}`, photo: r.imageId, source: "headroom", kind: "headroom-occupied", band: r.band ?? null, polygon: r.contour });
  }
  return { regions: out, skipped };
}

function regions(set: SetName): void {
  const dets = loadDets(set);
  const { regions: all, skipped } = buildRegions(set);
  const capped = capRegions(all);
  const order = new Map(SOURCES.map((s, i) => [s, i]));
  capped.sort((a, b) => (a.photo < b.photo ? -1 : a.photo > b.photo ? 1 : order.get(a.source)! - order.get(b.source)!));
  const t = SETS[set].tiling;
  const rows = capped.map((r) => {
    const d = dets.get(r.photo)!;
    const band = r.band !== null && r.band >= 0 ? (d.bands[r.band]?.polygon as unknown as Pt[] | undefined) ?? null : null;
    return { ...r, tiles: reTiles(r.polygon, band, d.width, d.height, t) };
  });
  mkdirSync(join(PRIV, set), { recursive: true });
  writeFileSync(join(PRIV, set, "regions.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
  const by = (xs: Region[]) => Object.fromEntries(SOURCES.map((s) => [s, xs.filter((x) => x.source === s).length]));
  const summary = { all: by(all), capped: by(capped), tiles: Object.fromEntries(SOURCES.map((s) => [s, rows.filter((x) => x.source === s).reduce((n, x) => n + x.tiles.length, 0)])), skipped };
  writeFileSync(join(PRIV, set, "regions-summary.json"), JSON.stringify(summary, null, 2) + "\n");
  log(`${set}: regions ${JSON.stringify(summary)}`);
}

// --- detect (GPU) ----------------------------------------------------------------------------------------

function detect(set: SetName): void {
  const dir = join(PRIV, set);
  const rows = readJsonl<Region & { tiles: number[][] }>(join(dir, "regions.jsonl"));
  const raw = join(dir, "pool-raw.jsonl");
  const done = new Set(readJsonl<{ photo: string; done?: boolean }>(raw).filter((x) => x.done).map((x) => x.photo));
  const dets = loadDets(set);
  const photos = [...new Set(rows.map((r) => r.photo))].filter((p) => !done.has(p));
  const imgs = new Map(inputImages(set, photos).map((x) => [x.id, x.path]));
  // A photo interrupted mid-way is re-run whole: drop its partial pool rows first.
  if (existsSync(raw)) writeFileSync(raw, readJsonl<{ photo: string }>(raw).filter((x) => done.has(x.photo)).map((x) => JSON.stringify(x)).join("\n") + (done.size ? "\n" : ""));
  const reqs = photos.map((p) => ({ id: p, image: imgs.get(p), medianWidth: dets.get(p)!.gaps.medianWidth, regions: rows.filter((r) => r.photo === p).map((r) => ({ id: r.id, source: r.source, polygon: r.polygon, tiles: r.tiles })) }));
  if (!reqs.length) return log(`${set}: pool complete`);
  writeFileSync(join(dir, "detect-requests.jsonl"), reqs.map((r) => JSON.stringify(r)).join("\n") + "\n");
  waitForGpu();
  const t0 = Date.now();
  const fd = openSync(raw, "a");
  const r = spawnSync(py("label"), ["-I", join(REPO, "helpers", "label", "recover.py"), "detect", "--requests", join(dir, "detect-requests.jsonl")], { stdio: ["ignore", fd, "inherit"] });
  closeSync(fd);
  appendFileSync(join(dir, "gpu.log"), `detect ${set} ${photos.length} photos ${Math.round((Date.now() - t0) / 1000)} s\n`);
  if (r.status !== 0) throw new Error(`recover.py detect failed on ${set}`);
  pool(set);
}

/** pool.jsonl: the raw pool with each candidate's place in its photo's pool (`poolIndex`), in region order. */
function pool(set: SetName): void {
  const dir = join(PRIV, set);
  const order = new Map(readJsonl<{ id: string }>(join(dir, "regions.jsonl")).map((r, i) => [r.id, i]));
  const rows = readJsonl<{ photo: string; region: string; tile: number; done?: boolean }>(join(dir, "pool-raw.jsonl")).filter((x) => !x.done);
  // Stable sort by region order (the raw file is in region order per photo already; resumed runs may interleave).
  const sorted = rows.map((x, i) => ({ x, i })).sort((a, b) => (a.x.photo < b.x.photo ? -1 : a.x.photo > b.x.photo ? 1 : order.get(a.x.region)! - order.get(b.x.region)! || a.i - b.i));
  const k = new Map<string, number>();
  const out = sorted.map(({ x }) => {
    const n = k.get(x.photo) ?? 0;
    k.set(x.photo, n + 1);
    return { ...x, poolIndex: n };
  });
  writeFileSync(join(dir, "pool.jsonl"), out.map((x) => JSON.stringify(x)).join("\n") + (out.length ? "\n" : ""));
  log(`${set}: pool ${out.length} candidates over ${k.size} photos`);
}

// --- gate (CPU) ------------------------------------------------------------------------------------------

interface Recovered { photo: string; pool: number; region: string; source: Source; polygon: Pt[]; boxScore: number; maskScore: number; aspect: number; cut: boolean; keptShare: number; area: number; outline: Pt[]; recoveredBy: "f0k"; arm: string }
interface PoolRow { photo: string; poolIndex: number; polygon: Pt[]; boxScore: number; maskScore: number; aspect: number; cut: boolean }

const recId = (d: Detection, k: number) => `${d.id}:${d.spines.length + k}`;

function gate(set: SetName): void {
  const dir = join(PRIV, set);
  const dets = loadDets(set);
  const poolRows = readJsonl<PoolRow>(join(dir, "pool.jsonl"));
  for (const arm of ARM_NAMES) {
    const ad = join(dir, arm);
    mkdirSync(ad, { recursive: true });
    const fd = openSync(join(ad, "gate-out.jsonl"), "w");
    const r = spawnSync(py("label"), ["-I", join(REPO, "helpers", "label", "recover.py"), "gate", "--pool", join(dir, "pool.jsonl"), "--labels", join(SETS[set].f0i, "labels"), "--arm", arm, "--sources", ARMS[arm]!.join(",")], { stdio: ["ignore", fd, "inherit"] });
    closeSync(fd);
    if (r.status !== 0) throw new Error(`recover.py gate failed on ${set} ${arm}`);
    const lines = readJsonl<Recovered & { totals?: Record<string, number> }>(join(ad, "gate-out.jsonl"));
    const boxes = lines.filter((x) => !x.totals);
    writeFileSync(join(ad, "boxes.jsonl"), boxes.map((b) => JSON.stringify({ id: recId(dets.get(b.photo)!, b.pool), ...b })).join("\n") + (boxes.length ? "\n" : ""));
    writeFileSync(join(ad, "gate.json"), JSON.stringify(lines.find((x) => x.totals)?.totals ?? {}, null, 2) + "\n");
    // The augmented detection: existing spines unchanged, then the photo's whole pool (index n + k); pool members this
    // arm did not recover keep their pool rectangle and are never read (`placeholder`).
    const rec = new Map(boxes.map((b) => [`${b.photo}:${b.pool}`, b]));
    const out = [...dets.values()].map((d) => {
      const mine = poolRows.filter((p) => p.photo === d.id);
      const extra = mine.map((p) => {
        const b = rec.get(`${d.id}:${p.poolIndex}`);
        return b
          ? { polygon: b.polygon, boxScore: b.boxScore, maskScore: b.maskScore, aspect: b.aspect, cut: b.cut, outline: b.outline, recoveredBy: "f0k", source: b.source, region: b.region }
          : { polygon: p.polygon, boxScore: p.boxScore, maskScore: p.maskScore, aspect: p.aspect, cut: p.cut, placeholder: true };
      });
      return { ...d, spines: [...d.spines, ...extra], f0k: { arm, existing: d.spines.length } };
    });
    writeFileSync(join(ad, "detect.jsonl"), out.map((d) => JSON.stringify(d)).join("\n") + "\n");
    log(`${set} ${arm}: ${boxes.length} recovered boxes`);
  }
}

// --- read: probe, readers, Qwen with displacement, decisions -----------------------------------------------

type Aug = Omit<Detection, "spines"> & { spines: (Detection["spines"][number] & { recoveredBy?: string; placeholder?: boolean; source?: Source; region?: string })[] };
const loadAug = (set: SetName, arm: string): Map<string, Aug> => new Map(readJsonl<Aug>(join(PRIV, set, arm, "detect.jsonl")).map((d) => [d.id, d]));

/** Each recovered box's kind under the shipped rules, on the detection with only this arm's recovered boxes appended. */
function recoveredKinds(aug: Map<string, Aug>, evidence?: (photo: string, i: number) => ReturnType<typeof evidenceOf> | undefined): Map<string, { kind: string; why: string }> {
  const out = new Map<string, { kind: string; why: string }>();
  for (const d of aug.values()) {
    const n = (d as unknown as { f0k: { existing: number } }).f0k.existing;
    const recIdx = d.spines.flatMap((s, i) => (i >= n && s.recoveredBy ? [i] : []));
    if (!recIdx.length) continue;
    const compact = { ...d, covers: [], spines: [...d.spines.slice(0, n), ...recIdx.map((i) => d.spines[i]!)] };
    const k = kinds(compact, evidence && ((ref) => evidence(d.id, recIdx[Number(ref.slice(1)) - n] ?? Number(ref.slice(1)))));
    recIdx.forEach((i, j) => out.set(`${d.id}:${i}`, { kind: k.spines[n + j]!.kind, why: k.spines[n + j]!.why }));
  }
  return out;
}

/** Copy readings of the same id and the same crop from arms read before, so a shared box is read once. */
function seedFromArms(set: SetName, arm: string, aug: Map<string, Aug>, ids: Set<string>): number {
  const dir = join(PRIV, set, arm);
  const crop = (a: Map<string, Aug>, id: string) => {
    const [p, i] = split(id);
    const d = a.get(p), s = d?.spines[i];
    return s && !s.placeholder ? JSON.stringify(cropFor(s, d!, CROP)?.polygon.map((q) => q.map(Math.round))) : null;
  };
  let n = 0;
  for (const other of ARM_NAMES) {
    if (other === arm || !existsSync(join(PRIV, set, other, "vision.jsonl"))) continue;
    const oa = loadAug(set, other);
    const same = new Set([...ids].filter((id) => crop(aug, id) !== null && crop(aug, id) === crop(oa, id)));
    for (const r of ["vision", "ppocr", "qwen", "probe"]) {
      const have = new Set(readJsonl<{ id: string }>(join(dir, `${r}.jsonl`)).map((x) => x.id));
      const key = (x: { id: string }) => (r === "probe" ? x.id.replace(/:s(\d+)$/, ":$1") : x.id);
      const lines = readJsonl<{ id: string }>(join(PRIV, set, other, `${r}.jsonl`)).filter((x) => same.has(key(x)) && !have.has(x.id));
      if (lines.length) appendFileSync(join(dir, `${r}.jsonl`), lines.map((x) => JSON.stringify(x)).join("\n") + "\n"), (n += lines.length);
    }
  }
  return n;
}

async function read(set: SetName, noQwen: boolean): Promise<void> {
  const cfg = F0B_SETS[set];
  const existingKept = keptExisting(set);
  const base = new Map(readJsonl<SpineDecision>(SETS[set].decisions).map((d) => [d.id, d]));
  const stageReads = loadReadings(SETS[set].stage);
  const db = openCatalog(cfg.catalog);
  const cache = new Map<string, Candidate | undefined>();
  const dets0 = loadDets(set);
  const score = new Map([...dets0.values()].flatMap((d) => d.spines.map((s, i): [string, number] => [`${d.id}:${i}`, s.boxScore])));
  // Reproduction check: the cached decisions from the cached readings used for displacement.
  let same = 0;
  for (const id of existingKept) {
    const x = decide(db, id, split(id)[0], score.get(id)!, stageReads.get(id) ?? {}, cache);
    if ((x.accepted?.workId ?? null) === workOf(base.get(id))) same++;
  }
  writeFileSync(join(PRIV, set, "reproduction.json"), JSON.stringify({ existingKept: existingKept.size, reproduced: same }) + "\n");
  log(`${set}: cached decisions reproduced on ${same} of ${existingKept.size} kept boxes`);
  for (const arm of ARM_NAMES) {
    const dir = join(PRIV, set, arm);
    const aug = loadAug(set, arm);
    const images = inputImages(set, aug.keys());
    const all = new Set([...aug.values()].flatMap((d) => d.spines.flatMap((s, i) => (s.recoveredBy ? [`${d.id}:${i}`] : []))));
    const geoKind = recoveredKinds(aug);
    const readable = new Set([...all].filter((id) => geoKind.get(id)?.kind === "spine"));
    log(`${set} ${arm}: ${all.size} recovered, ${readable.size} readable; seeded ${seedFromArms(set, arm, aug, readable)} reading lines`);
    const imgs = images.filter((x) => [...readable].some((id) => id.startsWith(`${x.id}:`)));
    // F-0f's pixel probe on the augmented detection (all boxes; only recovered ones are used).
    const probePath = join(dir, "probe.jsonl");
    const probed = new Set(readJsonl<{ id: string }>(probePath).map((r) => r.id.replace(/:s(\d+)$/, ":$1")));
    const toProbe = imgs.filter((x) => [...readable].some((id) => id.startsWith(`${x.id}:`) && !probed.has(id)));
    if (toProbe.length) {
      const fd = openSync(probePath, "a");
      const p = spawnSync(py("label"), ["-I", join(REPO, "helpers", "label", "probe.py"), "--detect", join(dir, "detect.jsonl")], { input: toProbe.map((x) => JSON.stringify({ id: x.id, image: x.path })).join("\n") + "\n", stdio: ["pipe", fd, "inherit"] });
      closeSync(fd);
      if (p.status !== 0) throw new Error(`probe.py failed on ${set} ${arm}`);
    }
    const probes = new Map(readJsonl<{ id: string; white: number; edges: number }>(probePath).map((r) => [r.id, r]));
    const t0 = Date.now();
    await visionStage(imgs, aug, dir, log, CROP, readable);
    await pyReaderStage("ppocr", imgs, aug, dir, log, readable, CROP);
    const ocr = loadReadings(dir, CROP);
    const kind = recoveredKinds(aug, (photo, i) => {
      const r = ocr.get(`${photo}:${i}`);
      return r ? evidenceOf(r, probes.get(`${photo}:s${i}`)) : undefined;
    });
    const spineKind = new Set([...readable].filter((id) => kind.get(id)?.kind === "spine"));
    const first = new Map([...spineKind].map((id) => [id, decide(db, id, split(id)[0], aug.get(split(id)[0])!.spines[split(id)[1]]!.boxScore, { vision: ocr.get(id)?.vision, ppocr: ocr.get(id)?.ppocr }, cache)]));
    // Qwen with displacement, per photo.
    const selected = new Set<string>(), displaced = new Set<string>();
    if (!noQwen)
      for (const d of aug.values()) {
        const existing = [...existingKept].filter((id) => id.startsWith(`${d.id}:`) && stageReads.get(id)?.qwen).map((id) => ({ id, score: score.get(id)! }));
        const recovered = [...spineKind].filter((id) => id.startsWith(`${d.id}:`) && first.get(id)!.hard && Object.values(first.get(id)!.readText).some(Boolean)).map((id) => ({ id, score: d.spines[split(id)[1]]!.boxScore }));
        if (!recovered.length) continue;
        const plan = qwenPlan(existing, recovered, cfg.qwenCap);
        plan.selected.forEach((x) => selected.add(x));
        plan.displaced.forEach((x) => displaced.add(x));
      }
    log(`${set} ${arm}: qwen on ${selected.size} recovered boxes, ${displaced.size} existing displaced`);
    if (selected.size) {
      waitForGpu();
      const q0 = Date.now();
      await pyReaderStage("qwen", imgs, aug, dir, log, selected, CROP);
      appendFileSync(join(PRIV, set, "gpu.log"), `qwen ${set} ${arm} ${selected.size} boxes ${Math.round((Date.now() - q0) / 1000)} s\n`);
    }
    const readings = loadReadings(dir, CROP);
    const dec = [...all].map((id) => {
      const [p, i] = split(id);
      const s = aug.get(p)!.spines[i]!;
      const k = kind.get(id) ?? geoKind.get(id)!;
      const r = { ...(readings.get(id) ?? {}) };
      if (!selected.has(id)) delete r.qwen;
      const x = k.kind === "spine" ? decide(db, id, p, s.boxScore, r, cache) : null;
      return { id, imageId: p, source: s.source, region: s.region, kind: k.kind, why: k.why, qwenSelected: selected.has(id), accepted: x?.accepted ? { workId: x.accepted.workId, score: x.accepted.score } : null, reason: x?.reason ?? "not-a-book", readText: x?.readText ?? {}, agreeing: x?.agreeing ?? [] };
    });
    const disp = [...displaced].map((id) => {
      const r = { ...(stageReads.get(id) ?? {}) };
      delete r.qwen;
      const x = decide(db, id, split(id)[0], score.get(id)!, r, cache);
      return { id, imageId: split(id)[0], displaced: true, accepted: x.accepted ? { workId: x.accepted.workId, score: x.accepted.score } : null, reason: x.reason };
    });
    writeFileSync(join(dir, "decisions.jsonl"), [...dec, ...disp].map((x) => JSON.stringify(x)).join("\n") + (dec.length + disp.length ? "\n" : ""));
    writeFileSync(join(dir, "read.json"), JSON.stringify({ noQwen, seconds: Math.round((Date.now() - t0) / 1000), cost: cost(readings, all, (id) => selected.has(id)) }) + "\n");
    log(`${set} ${arm}: ${dec.filter((x) => x.accepted).length} recovered accepts`);
  }
}

// --- analysis --------------------------------------------------------------------------------------------

const workOf = (d: { accepted: string | { workId: string } | null } | undefined): string | null =>
  !d?.accepted ? null : typeof d.accepted === "string" ? d.accepted : d.accepted.workId;

interface Dec { id: string; imageId: string; source?: Source; kind?: string; why?: string; qwenSelected?: boolean; displaced?: boolean; accepted: { workId: string } | null; reason: string; readText?: Record<string, boolean> }

const interval = (rows: { imageId: string; b: number; a: number }[]) => {
  const d = clusterBootstrap(rows, (rs) => rs.reduce((s, r) => s + r.a - r.b, 0), F0K.reps, F0K.seed);
  return d && { value: d.value, lo: d.lo, hi: d.hi };
};

export function armFigures(set: SetName, arm: string, truth?: Map<string, Set<string>>) {
  const dir = join(PRIV, set, arm);
  const existing = keptExisting(set);
  const base = new Map(readJsonl<SpineDecision>(SETS[set].decisions).map((d) => [d.id, d]));
  const decs = readJsonl<Dec>(join(dir, "decisions.jsonl"));
  const rec = decs.filter((d) => !d.displaced);
  const disp = new Map(decs.filter((d) => d.displaced).map((d) => [d.id, d]));
  const photos = [...new Set([...existing].map((id) => split(id)[0]))].sort();
  const before = [...existing].map((id) => ({ imageId: split(id)[0], work: workOf(base.get(id)) }));
  const after = [...[...existing].map((id) => ({ imageId: split(id)[0], work: disp.has(id) ? workOf(disp.get(id)) : workOf(base.get(id)) })), ...rec.map((d) => ({ imageId: d.imageId, work: workOf(d) }))];
  const per = (rows: { imageId: string; work: string | null }[], p: string) => rows.filter((r) => r.imageId === p);
  const pairsBefore = new Set(before.flatMap((r) => (r.work ? [`${r.imageId}\u0000${r.work}`] : [])));
  const pairsAfter = new Set(after.flatMap((r) => (r.work ? [`${r.imageId}\u0000${r.work}`] : [])));
  const echo = rec.filter((d) => d.accepted && pairsBefore.has(`${d.imageId}\u0000${d.accepted.workId}`)).length;
  const gateTotals = JSON.parse(readFileSync(join(dir, "gate.json"), "utf8")) as Record<string, number>;
  const readMeta = JSON.parse(readFileSync(join(dir, "read.json"), "utf8"));
  const bySource = Object.fromEntries(ARMS[arm]!.map((s) => [s, {
    recovered: rec.filter((d) => d.source === s).length,
    accepted: rec.filter((d) => d.source === s && d.accepted).length,
    ...(truth ? { wrong: rec.filter((d) => d.source === s && d.accepted && !(truth.get(d.imageId)?.has(d.accepted.workId))).length } : {}),
  }]));
  const out: Record<string, unknown> = {
    gate: gateTotals,
    recovered: rec.length,
    notABook: Object.fromEntries([...new Set(rec.filter((d) => d.kind !== "spine").map((d) => d.why!))].map((w) => [w, rec.filter((d) => d.why === w && d.kind !== "spine").length])),
    read: rec.filter((d) => d.kind === "spine").length,
    textRead: rec.filter((d) => d.readText && Object.values(d.readText).some(Boolean)).length,
    qwenSelected: rec.filter((d) => d.qwenSelected).length,
    displaced: disp.size,
    acceptedRecovered: rec.filter((d) => d.accepted).length,
    echoAccepts: echo,
    pairsLostToDisplacement: [...pairsBefore].filter((k) => !pairsAfter.has(k)).length,
    bySource,
    noQwen: readMeta.noQwen,
    cost: readMeta.cost,
  };
  if (!truth) {
    const rows = photos.map((p) => ({ imageId: p, b: pairCount(per(before, p)), a: pairCount(per(after, p)) }));
    out.confirmedWorks = { before: pairCount(before), after: pairCount(after), delta: interval(rows) };
  } else {
    const wrongN = (rows: { imageId: string; work: string | null }[]) => rows.filter((r) => r.work && !truth.get(r.imageId)?.has(r.work)).length;
    const rightN = (rows: { imageId: string; work: string | null }[]) => rows.filter((r) => r.work && truth.get(r.imageId)?.has(r.work)).length;
    const wrongRows = photos.map((p) => ({ imageId: p, b: wrongN(per(before, p)), a: wrongN(per(after, p)) }));
    const rightRows = photos.map((p) => ({ imageId: p, b: rightN(per(before, p)), a: rightN(per(after, p)) }));
    out.wrongAccepts = { before: wrongN(before), after: wrongN(after), delta: interval(wrongRows) };
    out.rightAccepts = { before: rightN(before), after: rightN(after), delta: interval(rightRows) };
    out.wrongShare = { before: wrongN(before) / Math.max(1, before.length), after: wrongN(after) / Math.max(1, before.length + rec.filter((d) => d.kind === "spine").length) };
    const tri = (rows: { imageId: string; work: string | null }[]) => photos.map((p): [number, number, number] => {
      const gt = truth.get(p) ?? new Set<string>();
      const acc = new Set(per(rows, p).flatMap((r) => (r.work ? [r.work] : [])));
      return [gt.size, [...acc].filter((w) => gt.has(w)).length, acc.size];
    });
    const tb = tri(before), ta = tri(after);
    const rate = (xs: [number, number, number][], den: 0 | 2) => xs.reduce((s, x) => s + x[1], 0) / Math.max(1, xs.reduce((s, x) => s + x[den], 0));
    out.titles = { before: { recall: rate(tb, 0), precision: rate(tb, 2) }, after: { recall: rate(ta, 0), precision: rate(ta, 2) }, delta: titleDelta(tb, ta) };
  }
  return out;
}

function analyse(): void {
  const truth = yardstickTruth();
  const metrics: Record<string, any> = { card: "F-0k", preregistration: "evals/F0k/prereg.md", sets: {} };
  for (const set of Object.keys(SETS) as SetName[]) {
    const tr = set === "pilot-000" ? undefined : truth;
    const summary = JSON.parse(readFileSync(join(PRIV, set, "regions-summary.json"), "utf8"));
    const pool = readJsonl<{ source: string }>(join(PRIV, set, "pool.jsonl"));
    const raw = readJsonl<{ done?: boolean; tiles?: number; inRegions?: number; seconds?: number }>(join(PRIV, set, "pool-raw.jsonl")).filter((x) => x.done);
    metrics.sets[set] = {
      regions: summary,
      reprompt: {
        photos: raw.length, tiles: raw.reduce((s, x) => s + x.tiles!, 0), candidatesInRegions: raw.reduce((s, x) => s + x.inRegions!, 0),
        pool: Object.fromEntries(SOURCES.map((s) => [s, pool.filter((x) => x.source === s).length])), gpuSeconds: Math.round(raw.reduce((s, x) => s + x.seconds!, 0)),
      },
      reproduction: JSON.parse(readFileSync(join(PRIV, set, "reproduction.json"), "utf8")),
      arms: Object.fromEntries(ARM_NAMES.map((arm) => [arm, armFigures(set, arm, tr)])),
    };
  }
  // The keep rule (pre-registered): K1 pilot works interval above 0; K2 yardstick wrong not up beyond its interval.
  metrics.verdict = Object.fromEntries(ARM_NAMES.map((arm) => {
    const p = metrics.sets["pilot-000"].arms[arm], y = metrics.sets["yardstick-library-b2"].arms[arm];
    const k1 = !!p.confirmedWorks.delta && p.confirmedWorks.delta.lo > 0;
    const k2 = !y.wrongAccepts.delta || y.wrongAccepts.delta.lo <= 0;
    return [arm, { K0: true, K1: k1, K2: k2, keep: k1 && k2 }];
  }));
  mkdirSync(join(REPO, "evals", "F0k"), { recursive: true });
  writeFileSync(join(REPO, "evals", "F0k", "metrics.json"), compactJson(metrics) + "\n");
  const rp = join(REPO, "evals", "F0k", "report.md");
  const marker = "<!-- generated by src/eval/f0k-cli.ts analyse: edit above this line -->";
  const head = existsSync(rp) ? readFileSync(rp, "utf8").split(marker)[0]! : "# F0k: missed-book recovery (F-0k)\n\n";
  writeFileSync(rp, head + marker + "\n\n" + tables(metrics) + "\n");
  log("evals/F0k/{metrics.json,report.md} written");
}

function tables(m: Record<string, any>): string {
  const out: string[] = [];
  const fmt = (d: { before: number; after: number; delta: { value: number; lo: number; hi: number } | null }) =>
    `${d.before} → ${d.after} (${d.delta ? `${d.delta.value >= 0 ? "+" : ""}${d.delta.value}; ${d.delta.lo} to ${d.delta.hi}` : "no change possible"})`;
  const pc = (x: number) => `${(x * 100).toFixed(1)} %`;
  for (const set of Object.keys(m.sets)) {
    const s = m.sets[set];
    const label = set === "pilot-000" ? "`pilot-000` (real use: machine agreement, never accuracy (INV-17))" : "yardstick (PROXY; confirmed = accepted and annotated in the image)";
    out.push(`## ${label}`, "");
    out.push(`Regions found / after the per-photo cap / re-prompt tiles: ${SOURCES.map((x) => `${x} ${s.regions.all[x]} / ${s.regions.capped[x]} / ${s.regions.tiles[x]}`).join("; ")}.`);
    if (Object.keys(s.regions.skipped).length) out.push(`Regions skipped: ${Object.entries(s.regions.skipped).map(([k, v]) => `${k} ${v}`).join("; ")}.`);
    out.push(`Re-prompt: ${s.reprompt.photos} photos, ${s.reprompt.tiles} tiles, ${s.reprompt.candidatesInRegions} candidates in their regions, pool ${SOURCES.map((x) => `${x} ${s.reprompt.pool[x]}`).join(", ")}; ${s.reprompt.gpuSeconds} GPU seconds.`);
    out.push(`Cached decisions reproduced from the cached readings on ${s.reproduction.reproduced} of ${s.reproduction.existingKept} kept boxes.`, "");
    const arms = Object.keys(s.arms);
    out.push(`| figure | ${arms.map((a) => `\`${a}\``).join(" | ")} |`, `|---|${arms.map(() => "---").join("|")}|`);
    const row = (name: string, f: (a: any) => string) => out.push(`| ${name} | ${arms.map((a) => f(s.arms[a])).join(" | ")} |`);
    row("pool candidates (gate in)", (a) => String(a.gate.candidates ?? 0));
    row("gate: nms / duplicate / piece-of / absorbed / thin", (a) => ["nms", "duplicate", "piece-of", "absorbed", "thin"].map((k) => a.gate[k] ?? 0).join(" / "));
    row("recovered boxes", (a) => String(a.recovered));
    row("not-a-book (never read or no Qwen)", (a) => Object.entries(a.notABook).map(([k, v]) => `${k} ${v}`).join(", ") || "0");
    row("read / text read / Qwen selected", (a) => `${a.read} / ${a.textRead} / ${a.qwenSelected}`);
    row("existing boxes displaced from Qwen", (a) => String(a.displaced));
    row("recovered accepts (echo accepts)", (a) => `${a.acceptedRecovered} (${a.echoAccepts})`);
    row("(photo, work) pairs lost to displacement", (a) => String(a.pairsLostToDisplacement));
    if (set === "pilot-000") row("**M1 distinct confirmed works (95 % interval)**", (a) => fmt(a.confirmedWorks));
    else {
      row("**M2 wrong accepts (95 % interval)**", (a) => fmt(a.wrongAccepts));
      row("right accepts", (a) => fmt(a.rightAccepts));
      row("wrong share of read boxes", (a) => `${pc(a.wrongShare.before)} → ${pc(a.wrongShare.after)}`);
      row("title recall / precision", (a) => `${pc(a.titles.before.recall)} → ${pc(a.titles.after.recall)} / ${pc(a.titles.before.precision)} → ${pc(a.titles.after.precision)}`);
    }
    row("by source: recovered / accepts" + (set === "pilot-000" ? "" : " / wrong"), (a) => Object.entries(a.bySource).map(([k, v]: [string, any]) => `${k} ${v.recovered} / ${v.accepted}${v.wrong === undefined ? "" : ` / ${v.wrong}`}`).join("; "));
    row("reader calls (vision, ppocr, qwen)", (a) => `${a.cost.vision.calls}, ${a.cost.ppocr.calls}, ${a.cost.qwen.calls}`);
    out.push("");
  }
  out.push("## Verdict (generated)", "", "| arm | K0 ran | K1 pilot works interval above 0 | K2 yardstick wrong not up | verdict |", "|---|---|---|---|---|");
  for (const [arm, v] of Object.entries(m.verdict) as [string, any][]) out.push(`| \`${arm}\` | ${v.K0 ? "yes" : "no"} | ${v.K1 ? "yes" : "no"} | ${v.K2 ? "yes" : "no"} | **${v.keep ? "keep" : "off"}** |`);
  return out.join("\n");
}

// --- main ------------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const [cmd, set] = process.argv.slice(2);
  if (cmd === "analyse") return analyse();
  if (!isSet(set)) throw new Error("usage: f0k-cli.ts regions|detect|gate|read <pilot-000|yardstick-library-b2> | analyse");
  if (cmd === "regions") return regions(set);
  if (cmd === "detect") return detect(set);
  if (cmd === "pool") return pool(set);
  if (cmd === "gate") return gate(set);
  if (cmd === "read") return read(set, process.argv.includes("--no-qwen"));
  throw new Error(`unknown command ${cmd}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
