// NB-3 runner: not-a-book v3 on F-0i's partition, from cached stages only, CPU only (pre-registered in
// evals/NB3/report.md).
//
//   node src/eval/nb3-cli.ts stage <set>     # helpers/depth/stage.py on H-2's cache: keys and face split (all hits)
//   node src/eval/nb3-cli.ts shelf <set>     # helpers/shelf/shelf.py on the partition: S-1's lip features per box
//   node src/eval/nb3-cli.ts probe <set>     # helpers/label/probe.py, version 2: R3-C's pixel values per box
//   node src/eval/nb3-cli.ts calibrate       # the pixel thresholds from pilot-000's reference boxes (before the run)
//   node src/eval/nb3-cli.ts flags <set>     # every cause per kept box (private)
//   node src/eval/nb3-cli.ts spot            # the pre-registered blind spot-check sheet (pilot-000, private)
//   node src/eval/nb3-cli.ts analyse         # evals/NB3/{metrics.json,report.md}: aggregates only
//
// Sets (OC35, never merged): pilot-000 with F-0e's `bands+strips` boxes, the yardstick with F-0's B2 boxes; both after
// the shipped not-a-book filter (F-0c's shapes, F-0f's shelf labels) and F-0i's partition of it (the kept box set).
// Everything per photo or box goes under the data root's `private/nb3/`.
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dataRoot } from "../ledger/images.ts";
import { readJsonl, type Detection } from "./f0.ts";
import { kinds } from "./f0c.ts";
import { imagesOf, meanCI, setCfg, SETS, type SetName, type Slim } from "./f0c-cli.ts";
import { acceptSet, needs, setPaths } from "./set-paths.ts";
import { agreementChange, titleDelta, type RungCounts, type Tri } from "./f0e.ts";
import { evidenceFor } from "./f0f-cli.ts";
import { compactJson, yardstickTruth } from "./q1-cli.ts";
import { clusterBootstrap, rng } from "./q1.ts";
import type { LipFeatures } from "./s1.ts";
import { calibrate, faceShares, NB3, NB3_CAUSES, nb3Causes, type FaceCounts, type NB3Evidence, type NB3Why, type ProbeV2 } from "./nb3.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const ROOT = dataRoot();
const PRIV = join(ROOT, "private", "nb3");
const H2_CACHE = join(ROOT, "private", "h2", "cache");
const NAMES: SetName[] = ["pilot-000", "yardstick"];
const REPS = 2000;
/** `--first N`: a smoke run on the first N photos in input order (crashes only, never a measure). */
const FIRST = process.argv.includes("--first") ? Number(process.argv[process.argv.indexOf("--first") + 1]) : undefined;
const setDir = (set: string): string => {
  const d = join(setPaths(set, ROOT).nb3, FIRST ? "smoke" : "");
  mkdirSync(d, { recursive: true });
  return d;
};
const log = (s: string): void => console.error(`[nb3] ${s}`);
const py = (helper: string) => {
  const p = join(REPO, "helpers", helper, ".venv", "bin", "python");
  if (!existsSync(p)) throw new Error(`helpers/${helper} has no .venv: run \`uv sync\` there first`);
  return p;
};
const loadDets = (path: string): Map<string, Detection> => new Map(readJsonl<Detection>(path).filter((d) => !d.error).map((d) => [d.id, d]));
/** F-0c's detections: the base's spines and bands verbatim, plus the cover pass's boxes (as S-1 and S-2 read them). */
const detsOf = (set: string) => loadDets(join(setPaths(set, ROOT).f0c, "detect.jsonl"));

function spawnTo(helper: string, out: string, args: string[], what: string): void {
  const fd = openSync(out, "w");
  const r = spawnSync(py(helper), args, { stdio: ["ignore", fd, "inherit"] });
  closeSync(fd);
  if (r.status !== 0) throw new Error(`${what} failed`);
}

// --- inputs ------------------------------------------------------------------------------------------------

type Point = [number, number];
interface PartRow {
  id: string;
  state: "kept" | "dropped";
  outline?: Point[];
}

/** F-0i's partition by photo, then by box index. */
function partitionOf(set: string): Map<string, Map<number, PartRow>> {
  // F-0i names the yardstick by its B2 run (set-paths).
  const p = join(setPaths(set, ROOT).f0i, "partition.jsonl");
  if (!existsSync(p)) throw new Error(`${set}: no F-0i partition at the data root's private/f0i/`);
  const out = new Map<string, Map<number, PartRow>>();
  for (const r of readJsonl<PartRow>(p)) {
    const k = r.id.lastIndexOf(":");
    const photo = r.id.slice(0, k);
    if (!out.has(photo)) out.set(photo, new Map());
    out.get(photo)!.set(Number(r.id.slice(k + 1)), r);
  }
  return out;
}

interface StagePhoto {
  id: string;
  geometryKey: string;
  facesKey: string;
}

function stage(set: string): void {
  needs("NB-3", set, "default boxes", join(setCfg(set).base, "detect.jsonl"), `f0e-cli.ts detect --set ${set} --label bands+strips`);
  const dir = setDir(set);
  const images = join(dir, "images.jsonl");
  writeFileSync(images, imagesOf(set).slice(0, FIRST ?? Infinity).map((i) => JSON.stringify({ id: i.id, image: i.path })).join("\n") + "\n");
  const out = join(dir, "stage.jsonl");
  // The same detections and options as H-2 (and S-1, S-2), so its keys decide what is reused.
  const args = ["-I", join(REPO, "helpers", "depth", "stage.py"), "--images", images, "--detect", join(setCfg(set).base, "detect.jsonl"), "--cache", H2_CACHE, "--exif-fov"];
  // CPU lane: a geometry miss would load MoGe-2 on the GPU, so every photo's geometry must already be cached.
  spawnTo("depth", out, [...args, "--keys"], `stage.py --keys on ${set}`);
  const missing = readJsonl<{ path: string }>(out).filter((k) => !existsSync(k.path)).length;
  if (missing) throw new Error(`${set}: ${missing} photos have no cached geometry; NB-3 runs on the CPU only`);
  spawnTo("depth", out, args, `stage.py on ${set}`);
  const photos = readJsonl<{ photo?: boolean; hit?: { geometry: boolean; faces: boolean } }>(out).filter((x) => x.photo);
  log(`${set}: ${photos.length} photos, ${photos.filter((p) => !p.hit?.geometry || !p.hit?.faces).length} cache misses`);
}

function stageRows(set: string): { photos: Map<string, StagePhoto>; faces: Map<string, FaceCounts> } {
  const path = join(setDir(set), "stage.jsonl");
  if (!existsSync(path)) throw new Error(`${set}: run \`nb3-cli.ts stage ${set}\` first`);
  const rows = readJsonl<(StagePhoto & { photo: true }) | (FaceCounts & { id: string; box: number; photo?: undefined })>(path);
  const photos = new Map<string, StagePhoto>();
  const faces = new Map<string, FaceCounts>();
  for (const r of rows) {
    if (r.photo) photos.set(r.id, r);
    else if ("box" in r) faces.set(`${r.id}:${r.box}`, r);
  }
  return { photos, faces };
}

const geometryPath = (key: string) => join(H2_CACHE, "geometry", "moge-2-vitl-normal@cb0e8bb", `${key}.npz`);

// --- shelf: S-1's lip features on the partition (as S-2 runs it) -----------------------------------------

function shelf(set: string): void {
  const dir = setDir(set);
  const dets = detsOf(set);
  const part = partitionOf(set);
  const { photos } = stageRows(set);
  const lines = [...dets.values()].slice(0, FIRST ?? Infinity).flatMap((d) => {
    const k = photos.get(d.id);
    const p = part.get(d.id);
    if (!k || !p) return [];
    const outlines: Record<number, Point[]> = {};
    for (const [i, r] of p) if (r.state === "kept" && r.outline && r.outline.length >= 3) outlines[i] = r.outline;
    return [JSON.stringify({
      id: d.id,
      width: d.width,
      height: d.height,
      npz: geometryPath(k.geometryKey),
      faces: join(H2_CACHE, "faces", k.geometryKey, `${k.facesKey}.json`),
      classmap: join(H2_CACHE, "faces", k.geometryKey, `${k.facesKey}.png`),
      spines: d.spines.map((s, i) => ({ polygon: s.polygon, kept: p.get(i)?.state === "kept" })),
      outlines,
      covers: [],
      bands: d.bands.map((b) => ({ polygon: b.polygon })),
      medianWidth: d.gaps.medianWidth,
    })];
  });
  const inputs = join(dir, "shelf-inputs.jsonl");
  writeFileSync(inputs, lines.join("\n") + "\n");
  log(`${set}: lip features on the partition over ${lines.length} photos`);
  spawnTo("depth", join(dir, "shelf.jsonl"), ["-I", join(REPO, "helpers", "shelf", "shelf.py"), "--inputs", inputs, "--maps", join(dir, "shelf-maps")], `shelf.py on ${set}`);
}

function lipOf(set: string): Map<string, (LipFeatures | null)[]> {
  const path = join(setDir(set), "shelf.jsonl");
  if (!existsSync(path)) throw new Error(`${set}: run \`nb3-cli.ts shelf ${set}\` first`);
  return new Map(readJsonl<{ id: string; boxes: (LipFeatures | null)[] }>(path).map((x) => [x.id, x.boxes]));
}

// --- probe: version 2 ------------------------------------------------------------------------------------

function probe(set: string): void {
  const dir = setDir(set);
  const images = join(dir, "images.jsonl");
  if (!existsSync(images)) throw new Error(`${set}: run \`nb3-cli.ts stage ${set}\` first (it writes the image list)`);
  spawnTo("label", join(dir, "probe.jsonl"), ["-I", join(REPO, "helpers", "label", "probe.py"), "--detect", join(setPaths(set, ROOT).f0c, "detect.jsonl"), "--images", images], `probe.py on ${set}`);
}

function probesOf(set: string): Map<string, ProbeV2> {
  const path = join(setDir(set), "probe.jsonl");
  if (!existsSync(path)) throw new Error(`${set}: run \`nb3-cli.ts probe ${set}\` first`);
  return new Map(readJsonl<ProbeV2 & { id: string }>(path).map((p) => [p.id, p]));
}

// --- per box evidence on the partition -------------------------------------------------------------------

interface BoxRec {
  imageId: string;
  index: number;
  causes: NB3Why[];
  textFound: boolean;
  front: number | null;
  probe: ProbeV2 | null;
}

/** Every kept box of the partition (spine path, after the shipped kinds) with NB-3's causes. */
function boxesOf(set: string): BoxRec[] {
  const dets = detsOf(set);
  const part = partitionOf(set);
  const ev = evidenceFor(set);
  const lip = lipOf(set);
  const { faces } = stageRows(set);
  const probes = probesOf(set);
  const out: BoxRec[] = [];
  for (const d of [...dets.values()].slice(0, FIRST ?? Infinity)) {
    const p = part.get(d.id);
    const lp = lip.get(d.id);
    if (!p || !lp) continue;
    const k = kinds({ ...d, covers: [] }, ev.get(d.id));
    k.spines.forEach((b, i) => {
      if (b.kind !== "spine" || p.get(i)?.state !== "kept") return;
      // A box with no readings at all counts as text found: the rule never discards on missing evidence.
      const e = ev.get(d.id)?.(`s${i}`);
      const f = faces.get(`${d.id}:${i}`) ?? null;
      const pr = probes.get(`${d.id}:s${i}`) ?? null;
      const evidence: NB3Evidence = { lip: lp[i] ?? null, faces: f, probe: pr, textFound: e ? e.textFound : true };
      out.push({ imageId: d.id, index: i, causes: nb3Causes(b.polygon, evidence, d), textFound: evidence.textFound, front: faceShares(f)?.front ?? null, probe: pr });
    });
  }
  return out;
}

function flags(set: string): BoxRec[] {
  const rows = boxesOf(set);
  writeFileSync(join(setDir(set), "flags.jsonl"), rows.filter((r) => r.causes.length).map((r) => JSON.stringify({ id: `${r.imageId}:${r.index}`, causes: r.causes })).join("\n") + "\n");
  log(`${set}: ${rows.length} kept boxes, ${rows.filter((r) => r.causes.length).length} with a cause`);
  return rows;
}

// --- calibrate: the pixel thresholds (pilot-000 reference boxes, before the full run) ----------------------

function calibrateStep(): void {
  const set: SetName = "pilot-000";
  const rows = boxesOf(set);
  const ref = rows.filter((r) => r.textFound && r.front !== null && r.front >= NB3.reference.minFront && r.probe);
  const c = calibrate(ref.map((r) => r.probe!));
  writeFileSync(join(PRIV, "calibration.json"), JSON.stringify({ set, keptBoxCount: rows.length, ...c }, null, 2) + "\n");
  log(`calibration over ${c.n} reference boxes of ${rows.length}: maxEdgeDensity ${c.maxEdgeDensity}, maxBandpass ${c.maxBandpass}, minWarm ${c.minWarm}; copy into NB3.pixel`);
}

// --- spot check (pre-registered): a blind sheet of each cause's catches and controls -----------------------

const SPOT_PER_CAUSE = 20, SPOT_CONTROLS = 20;

function spot(): void {
  const set: SetName = "pilot-000";
  const rows = boxesOf(set);
  const dets = detsOf(set);
  const rand = rng(3);
  const pick = <T,>(xs: T[], n: number): T[] => {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a.slice(0, n);
  };
  const groups = [
    ...NB3_CAUSES.flatMap((c) => pick(rows.filter((r) => r.causes[0] === c), SPOT_PER_CAUSE).map((r) => ({ ...r, group: c }))),
    ...pick(rows.filter((r) => r.causes.length === 0 && !r.textFound), SPOT_CONTROLS).map((r) => ({ ...r, group: "control" })),
  ];
  const key = pick(groups, Infinity).map((r, n) => ({ n, id: r.imageId, ref: `s${r.index}`, group: r.group, polygon: dets.get(r.imageId)!.spines[r.index]!.polygon }));
  const dir = join(PRIV, set, "spot");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "key.jsonl"), key.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const r = spawnSync(py("depth"), ["-I", join(REPO, "helpers", "shelf", "spot.py"), "--key", join(dir, "key.jsonl"), "--images", join(PRIV, set, "images.jsonl"), "--out", dir], { stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) throw new Error("spot.py failed");
  log(`spot: ${key.length} boxes under the data root's private/nb3/${set}/spot/; judge into judged.jsonl {n, judgement: yes|no|unclear}`);
}

function spotResult(): Record<string, unknown> | null {
  const dir = join(PRIV, "pilot-000", "spot");
  if (!existsSync(join(dir, "judged.jsonl"))) return null;
  const key = new Map(readJsonl<{ n: number; group: string }>(join(dir, "key.jsonl")).map((r) => [r.n, r.group]));
  const judged = readJsonl<{ n: number; judgement: "yes" | "no" | "unclear" }>(join(dir, "judged.jsonl"));
  const g = (group: string) => {
    const js = judged.filter((j) => key.get(j.n) === group);
    const clear = js.filter((j) => j.judgement !== "unclear");
    const yes = clear.filter((j) => j.judgement === "yes").length;
    return { shown: js.length, unclear: js.length - clear.length, notABook: yes, judged: clear.length, share: clear.length ? r4(yes / clear.length) : null };
  };
  return Object.fromEntries([...NB3_CAUSES, "control"].map((c) => [c, g(c)]));
}

// --- analyse: aggregates only --------------------------------------------------------------------------------

const r4 = (x: number) => Math.round(x * 10000) / 10000;
const triOf = (b: { value: number; lo: number; hi: number } | null): Tri => (b ? [r4(b.value), r4(b.lo), r4(b.hi)] : null);
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

/** Removed boxes per set (a photo bootstrap of the count) for one predicate. */
const countCI = (rows: BoxRec[], pred: (r: BoxRec) => boolean): Tri => triOf(clusterBootstrap(rows, (rs) => rs.filter(pred).length, REPS, 1));

function analyseSet(set: SetName) {
  const rows = flags(set);
  const base = new Map(readJsonl<Slim>(join(ROOT, "f0c", set, "base-decisions.jsonl")).map((d) => [d.id, d]));
  const truth = set === "yardstick" ? yardstickTruth() : null;
  const dec = (r: BoxRec) => base.get(`${r.imageId}:${r.index}`);
  const annotated = (r: BoxRec) => {
    const a = dec(r)?.accepted;
    return !!a && !!truth?.get(r.imageId)?.has(a);
  };
  // A box's first cause decides its row; `rule` is the union (what NB-3 removes with every cause on).
  const byCause = (c: NB3Why | "rule") => {
    const hit = (r: BoxRec) => (c === "rule" ? r.causes.length > 0 : r.causes[0] === c);
    const removed = rows.filter(hit);
    return {
      removed: countCI(rows, hit),
      any: rows.filter((r) => (c === "rule" ? r.causes.length > 0 : r.causes.includes(c))).length,
      removedConfirmed: removed.filter((r) => dec(r)?.accepted).length,
      removedAnnotated: truth ? removed.filter(annotated).length : null,
      removedTextRead: removed.filter((r) => { const d = dec(r); return !!d && isTextRead(d); }).length,
      removedTextPresent: removed.filter((r) => { const d = dec(r); return !!d && d.reason !== "no-text"; }).length,
      removedNoDecision: removed.filter((r) => !dec(r)).length,
    };
  };
  const causes = Object.fromEntries([...NB3_CAUSES, "rule" as const].map((c) => [c, byCause(c)]));
  // Overlap of causes on one box.
  const combos: Record<string, number> = {};
  for (const r of rows) if (r.causes.length > 1) combos[r.causes.join("+")] = (combos[r.causes.join("+")] ?? 0) + 1;
  // The pixel values of removed boxes against the kept rest (medians), so the report can say what the pixel cause sees.
  const med = (xs: number[]) => (xs.length ? r4([...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!) : null);
  const pv = (rs: BoxRec[]) => Object.fromEntries((["edgeDensity", "bandpass", "warm", "luma"] as const).map((k) => [k, med(rs.flatMap((r) => (r.probe?.[k] != null ? [r.probe[k]!] : [])))]));
  const pixelValues = { kept: pv(rows.filter((r) => r.causes.length === 0)), ...Object.fromEntries(NB3_CAUSES.map((c) => [c, pv(rows.filter((r) => r.causes[0] === c))])) };
  // Readers and titles with the whole rule on, against the partition's kept set.
  const per = new Map<string, { before: Slim[]; after: Slim[] }>();
  for (const r of rows) {
    const d = dec(r);
    if (!d) continue;
    if (!per.has(r.imageId)) per.set(r.imageId, { before: [], after: [] });
    per.get(r.imageId)!.before.push(d);
    if (r.causes.length === 0) per.get(r.imageId)!.after.push(d);
  }
  const ps = [...per.entries()];
  const reads = agreementChange(ps.map(([id, p]) => rungs(id, p.before)), ps.map(([id, p]) => rungs(id, p.after)));
  let titles: Record<string, unknown> | null = null;
  if (truth) {
    const counts = (pick: "before" | "after"): [number, number, number][] =>
      ps.map(([id, p]) => {
        const t = truth.get(id) ?? new Set<string>();
        const w = works(p[pick]);
        return [t.size, [...w].filter((x) => t.has(x)).length, w.size];
      });
    const b = counts("before"), a = counts("after");
    titles = { delta: titleDelta(b, a), wrongPerImage: meanCI(a.map((x, i) => x[2] - x[1] - (b[i]![2] - b[i]![1]))), worksPerImage: meanCI(a.map((x, i) => x[2] - b[i]![2])) };
  }
  const evidence = {
    faces: rows.filter((r) => r.front !== null).length,
    lip: rows.length, // shelf.py writes a row per box (null when no row's lip holds it)
    probe: rows.filter((r) => r.probe?.version === 2).length,
    noText: rows.filter((r) => !r.textFound).length,
  };
  return { scope: SETS[set].scope, photos: new Set(rows.map((r) => r.imageId)).size, keptBoxCount: rows.length, evidence, causes, combos, pixelValues, reads, titles };
}

type SetResult = ReturnType<typeof analyseSet>;

/** The pre-registered verdict per cause (evals/NB3/report.md, Keep rule). */
function verdict(sets: Record<SetName, SetResult>, spotR: Record<string, { judged: number; share: number | null }> | null) {
  const out: Record<string, unknown> = {};
  for (const c of NB3_CAUSES) {
    const k1 = NAMES.every((s) => sets[s].causes[c]!.removedConfirmed === 0 && (sets[s].causes[c]!.removedAnnotated ?? 0) === 0);
    const sp = spotR?.[c];
    // Under three judged catches the check cannot decide: on-lip then keeps S-1's met check (evals/S1), and a
    // pre-registered cause with that few catches is not shipped.
    const k2 = sp && sp.judged >= 3 ? (sp.share ?? 0) >= 0.8 : null;
    out[c] = { noConfirmedRemoved: k1, spotCheck: k2, ships: k1 && (k2 ?? c === "on-lip") };
  }
  const k1All = NAMES.every((s) => sets[s].causes.rule!.removedConfirmed === 0);
  return { causes: out, noConfirmedRemovedRule: k1All };
}

function analyse(): void {
  const sets = Object.fromEntries(NAMES.map((s) => [s, analyseSet(s)])) as Record<SetName, SetResult>;
  const spotR = spotResult() as Record<string, { shown: number; unclear: number; notABook: number; judged: number; share: number | null }> | null;
  const calib = existsSync(join(PRIV, "calibration.json")) ? JSON.parse(readFileSync(join(PRIV, "calibration.json"), "utf8")) as { n: number } : null;
  const v = verdict(sets, spotR);
  const metrics = {
    card: "NB-3",
    model: "moge-2-vitl-normal@cb0e8bb (H-2 cache); F-0i partition (#51); S-1 lip features on it; probe version 2",
    thresholds: NB3,
    calibrationReferenceCount: calib?.n ?? null,
    sets,
    spot: spotR,
    verdict: v,
  };
  const outDir = join(REPO, "evals", "NB3");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "metrics.json"), compactJson(metrics) + "\n");
  const reportPath = join(outDir, "report.md");
  const MARK = "<!-- generated by src/eval/nb3-cli.ts analyse: edit above this line -->";
  const head = existsSync(reportPath) ? readFileSync(reportPath, "utf8").split(MARK)[0]!.trimEnd() : "# NB3";
  writeFileSync(reportPath, `${head}\n\n${MARK}\n\n${render(sets, spotR, v)}`);
  log("wrote evals/NB3/{metrics.json,report.md}");
}

const tri = (t: Tri, d = 0) => (t ? `${t[0].toFixed(d)} (${t[1].toFixed(d)} to ${t[2].toFixed(d)})` : "n/a");
const signed = (t: Tri, scale = 1, d = 2) => (t ? `${t[0] * scale >= 0 ? "+" : ""}${(t[0] * scale).toFixed(d)} (${(t[1] * scale).toFixed(d)} to ${(t[2] * scale).toFixed(d)})` : "n/a");
const yn = (b: boolean | null | undefined) => (b === null || b === undefined ? "not judged" : b ? "yes" : "**no**");

function render(sets: Record<SetName, SetResult>, spotR: Record<string, { shown: number; unclear: number; notABook: number; judged: number; share: number | null }> | null, v: ReturnType<typeof verdict>): string {
  const out: string[] = [];
  for (const s of NAMES) {
    const m = sets[s];
    out.push(`## ${s} (${m.scope})\n`);
    out.push(`${m.photos} photos, ${m.keptBoxCount} kept boxes on F-0i's partition. Evidence: face split on ${m.evidence.faces}, version-2 probe on ${m.evidence.probe}; ${m.evidence.noText} with no reader text.\n`);
    out.push("Extra discards (a box counts under its first cause: on-lip, depth, pixel). *Removed confirmed* is a lower bound on real books removed; *at `text-read`* an upper hint. Counts with a 95 % photo bootstrap interval.\n");
    out.push(`| cause | removed | held at all | removed confirmed | ${s === "yardstick" ? "removed confirmed and annotated | " : ""}removed at \`text-read\` | removed at \`text-present\` |`);
    out.push(`|---|---:|---:|---:|${s === "yardstick" ? "---:|" : ""}---:|---:|`);
    for (const c of [...NB3_CAUSES, "rule"] as const) {
      const x = m.causes[c]!;
      out.push(`| ${c === "rule" ? "**NB-3 (all causes)**" : `\`${c}\``} | ${tri(x.removed)} | ${x.any} | ${x.removedConfirmed} | ${s === "yardstick" ? `${x.removedAnnotated} | ` : ""}${x.removedTextRead} | ${x.removedTextPresent} |`);
    }
    out.push("");
    const combos = Object.entries(m.combos);
    out.push(`Boxes held by more than one cause: ${combos.length ? combos.map(([k, n]) => `${k} ${n}`).join(", ") : "none"}.\n`);
    out.push("Median pixel values (version-2 probe) of each cause's removals against the kept rest:\n");
    out.push("| boxes | edge density | band-pass | warm (r) | luma |");
    out.push("|---|---:|---:|---:|---:|");
    for (const [k, pv] of Object.entries(m.pixelValues)) out.push(`| ${k} | ${pv.edgeDensity ?? "n/a"} | ${pv.bandpass ?? "n/a"} | ${pv.warm ?? "n/a"} | ${pv.luma ?? "n/a"} |`);
    out.push("");
    const d = m.reads.delta;
    out.push(`Readers with every cause on, against the partition's kept set: works per photo ${signed(d.worksPerPhoto)}, confirmed per photo ${signed(d.confirmedPerPhoto)}, confirmed share ${signed(d.confirmedShare, 100, 1)} pts, boxes per photo ${signed(d.boxesPerPhoto)}.${m.titles ? ` Yardstick titles: recall ${signed((m.titles.delta as { recall: Tri } | null)?.recall ?? null, 100, 1)} pts, precision ${signed((m.titles.delta as { precision: Tri } | null)?.precision ?? null, 100, 1)} pts, wrong accepts per image ${signed(m.titles.wrongPerImage as Tri)}, distinct confirmed works per image ${signed(m.titles.worksPerImage as Tri)}.` : ""}\n`);
  }
  out.push("## Spot check and verdict\n");
  if (spotR) {
    out.push("Blind agent spot check (`pilot-000`), judged *not a book*: " + [...NB3_CAUSES, "control"].map((c) => `${c} ${spotR[c]!.notABook} of ${spotR[c]!.judged} (${spotR[c]!.unclear} unclear)`).join("; ") + ". One agent's judgement, never labels.\n");
  } else out.push("Spot check not yet judged.\n");
  out.push("| cause | no confirmed book removed (both sets) | spot check ≥ 80 % not a book | ships by default |");
  out.push("|---|---|---|---|");
  for (const c of NB3_CAUSES) {
    const x = v.causes[c] as { noConfirmedRemoved: boolean; spotCheck: boolean | null; ships: boolean };
    out.push(`| \`${c}\` | ${yn(x.noConfirmedRemoved)} | ${yn(x.spotCheck)} | ${x.ships ? "**yes**" : "**no**"} |`);
  }
  out.push("");
  return out.join("\n");
}

// --- main ------------------------------------------------------------------------------------------------------

const [step, arg] = process.argv.slice(2);
// stage, shelf, probe and flags take any declared session (NS-K2) or the yardstick; anything else is refused.
if (step === "stage") stage(acceptSet("NB-3", arg));
else if (step === "shelf") shelf(acceptSet("NB-3", arg));
else if (step === "probe") probe(acceptSet("NB-3", arg));
else if (step === "calibrate") calibrateStep();
else if (step === "flags") flags(acceptSet("NB-3", arg));
else if (step === "spot") spot();
else if (step === "analyse") analyse();
else {
  console.error("usage: node src/eval/nb3-cli.ts stage|shelf|probe|flags <session|yardstick> [--first N] | calibrate | spot | analyse");
  process.exit(2);
}
