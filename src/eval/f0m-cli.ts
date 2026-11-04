// F-0m runner: spine end edges. Each kept box's top end snapped to the depth stage's front-to-top normal crease and
// its bottom end to S-1's board top or the lip that hides it (helpers/depth/ends.py), on F-0i's partition; measured
// by row-end consistency against F-0f's fitted lines, Q-2's top-seam error and F-0b's reader rule (pre-registered in
// evals/F0m/report.md). CPU only, except Qwen's hard-crop reads.
//
//   node src/eval/f0m-cli.ts ends <set> [--only <photo id>]   # helpers/depth/ends.py: snapped ends, outlines, boxes (CPU)
//   node src/eval/f0m-cli.ts render <set>                     # private before/after page; the owner's examples first
//   node src/eval/f0m-cli.ts seams <set>                      # Q-2's top seam (helpers/coverage/geometry.py) per arm (CPU)
//   node src/eval/f0m-cli.ts run <set> <arm>                  # arm: clip (before) | snap, on the changed set
//   node src/eval/f0m-cli.ts analyse                          # evals/F0m/{metrics.json,report.md}: aggregates only
//
// Sets (OC35, never merged): pilot-000 (F-0e's `bands+strips` boxes) and the yardstick (F-0's B2), each after the
// shipped not-a-book filter and F-0i's partition; depth from H-2's cache, rows and planes from S-2's run of S-1's
// shelf.py on the partition. Everything per box or per photo goes under the data root's `private/f0m/`.
import { spawnSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Candidate } from "../catalog/retrieve.ts";
import { openCatalog } from "../catalog/cli.ts";
import { dataRoot } from "../ledger/images.ts";
import { CROP, decide, loadReadings, pyReaderStage, readJsonl, visionStage, type Detection, type InputImage, type Reading, type SpineDecision } from "./f0.ts";
import { F0_CROP, cropFor, cropName, type Point } from "../perceive/crop.ts";
import { SETS as F0B_SETS, cost, delta, firstPassHard, geometry, type Geo, type Pair } from "./f0b-cli.ts";
import { geometry as boxGeometry, titleDelta, UPRIGHT_DEG } from "./f0e.ts";
import { compactJson, outcomeOf, yardstickTruth } from "./q1-cli.ts";
import { clusterBootstrap } from "./q1.ts";
import type { Outcome } from "./q1.ts";
import { endResiduals, F0M, lostWorks, meanResidual, seamError, verdictOf, type EndRow, type SeamBox, type SetFigures } from "./f0m.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const ROOT = dataRoot();
const PRIV = join(ROOT, "private", "f0m");
const REPS = 2000;
const log = (s: string): void => console.error(`[f0m] ${s}`);
const ONLY = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : undefined;

export type SetName = "pilot-000" | "yardstick-library-b2";
interface SetCfg { stage: string; decisions: string; images: string; s2: string }
const SETS: Record<SetName, SetCfg> = {
  "pilot-000": {
    stage: join(ROOT, "f0e", "pilot-000", "bands+strips"),
    decisions: join(ROOT, "private", "h2", "pilot-000", "base-decisions.jsonl"),
    images: join(ROOT, "private", "h2", "pilot-000", "images.jsonl"),
    s2: join(ROOT, "private", "s2", "pilot-000"),
  },
  "yardstick-library-b2": {
    stage: join(ROOT, "f0", "yardstick-library-b2"),
    decisions: join(ROOT, "private", "h2", "yardstick-library-b2", "base-decisions.jsonl"),
    images: join(ROOT, "private", "h2", "yardstick-library-b2", "images.jsonl"),
    s2: join(ROOT, "private", "s2", "yardstick"),
  },
};
const NAMES = Object.keys(SETS) as SetName[];
const isSet = (s: string | undefined): s is SetName => s === "pilot-000" || s === "yardstick-library-b2";
const partDir = (set: SetName) => join(ROOT, "private", "f0i", set);

export const ARMS = ["clip", "snap"] as const;
export type ArmName = (typeof ARMS)[number];

// --- inputs ----------------------------------------------------------------------------------------------

function py(helper: "coverage" | "depth"): string {
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

/** One box's row in F-0i's partition (resolve.py `partition.jsonl`). */
interface PartRow {
  id: string;
  state: "kept" | "dropped";
  role: string;
  outline?: Point[];
  ends?: { top: string; bottom: string };
}

function partition(set: SetName): Map<string, PartRow> {
  const p = join(partDir(set), "partition.jsonl");
  if (!existsSync(p)) throw new Error(`${set}: no F-0i partition at the data root's private/f0i/`);
  return new Map(readJsonl<PartRow>(p).map((r) => [r.id, r]));
}

const split = (id: string): [string, number] => {
  const k = id.lastIndexOf(":");
  return [id.slice(0, k), Number(id.slice(k + 1))];
};

/** One kept box's line from ends.py. */
export interface EndsOut extends EndRow {
  polygon?: Point[];
  outline?: Point[];
  lost?: boolean;
}

function endsOf(set: SetName): Map<string, EndsOut> {
  const p = join(PRIV, set, "ends.jsonl");
  if (!existsSync(p)) throw new Error(`${set}: run \`f0m-cli.ts ends ${set}\` first`);
  return new Map(readJsonl<EndsOut & { photo?: boolean }>(p).filter((r) => !r.photo).map((r) => [r.id, r]));
}

// --- ends ------------------------------------------------------------------------------------------------

function ends(set: SetName): void {
  const dir = join(PRIV, set, ONLY ? "smoke" : "");
  mkdirSync(dir, { recursive: true });
  const dets = loadDets(set);
  const part = partition(set);
  const shelfIn = new Map(readJsonl<{ id: string; width: number; height: number; npz: string; faces: string }>(join(SETS[set].s2, "shelf-inputs.jsonl")).map((x) => [x.id, x]));
  const shelfOut = new Map(readJsonl<{ id: string; rows: unknown[] }>(join(SETS[set].s2, "shelf.jsonl")).map((x) => [x.id, x]));
  const lines: string[] = [];
  for (const d of dets.values()) {
    if (ONLY && !d.id.startsWith(ONLY)) continue;
    const si = shelfIn.get(d.id), so = shelfOut.get(d.id);
    if (!si || !so) {
      log(`${set}: a photo has no depth or shelf rows; its boxes keep their ends`);
      continue;
    }
    const boxes = d.spines.flatMap((s, i) => {
      const r = part.get(`${d.id}:${i}`);
      return r?.state === "kept" ? [{ index: i, polygon: s.polygon, outline: r.outline ?? null }] : [];
    });
    lines.push(JSON.stringify({ id: d.id, width: d.width, height: d.height, npz: si.npz, faces: si.faces, labels: join(partDir(set), "labels", `${d.id}.png`), rows: so.rows, boxes }));
  }
  const inputs = join(dir, "ends-inputs.jsonl");
  writeFileSync(inputs, lines.join("\n") + "\n");
  log(`${set}: ends over ${lines.length} photos`);
  const fd = openSync(join(dir, "ends.jsonl"), "w");
  const r = spawnSync(py("depth"), ["-I", join(REPO, "helpers", "depth", "ends.py"), "--inputs", inputs, "--out", dir], { stdio: ["ignore", fd, "inherit"] });
  closeSync(fd);
  if (r.status !== 0) throw new Error(`ends.py failed on ${set}`);
}

/** The arm's kept boxes as F-0's detections: `clip` the partition's detection rectangles, `snap` the snapped boxes. */
function armDets(set: SetName, arm: ArmName, dets: Map<string, Detection>, part: Map<string, PartRow>, e?: Map<string, EndsOut>): Map<string, Detection> {
  const out = new Map<string, Detection>();
  for (const [id, d] of dets)
    out.set(id, {
      ...d,
      spines: d.spines.map((s, i) => {
        const p = e?.get(`${id}:${i}`)?.polygon;
        return arm === "snap" && p ? { ...s, polygon: p as typeof s.polygon } : s;
      }),
    });
  for (const d of out.values()) d.spines = d.spines.map((s, i) => ({ ...s, kept: part.get(`${d.id}:${i}`)?.state === "kept" }) as typeof s);
  return out;
}

const sameCrop = (a: ReturnType<typeof cropFor>, b: ReturnType<typeof cropFor>): boolean =>
  !!a && !!b && JSON.stringify(a.rotations) === JSON.stringify(b.rotations) && a.polygon.every((p, k) => Math.hypot(p[0] - b.polygon[k]![0], p[1] - b.polygon[k]![1]) <= 1);

/** The changed set (pre-registered): kept boxes whose snapped crop differs from the detection rectangle's crop. */
export function changedSet(dets: Map<string, Detection>, e: Map<string, EndsOut>): Set<string> {
  const out = new Set<string>();
  for (const [id, r] of e) {
    if (!r.polygon) continue;
    const [p, i] = split(id);
    const d = dets.get(p), s = d?.spines[i];
    if (!d || !s) continue;
    if (!sameCrop(cropFor({ polygon: r.polygon as typeof s.polygon }, d, CROP), cropFor(s, d, CROP))) out.add(id);
  }
  return out;
}

// --- render ----------------------------------------------------------------------------------------------

function render(set: SetName): void {
  const out = join(PRIV, "renders", set);
  // The owner's two examples lead the page. Both are glow-overlay screenshots, so ORB matches them weakly; the photo
  // was confirmed by eye (logged in implementation-notes.md) and is named in the private matches file.
  const mPath = join(PRIV, "examples", "matches.json");
  const first = existsSync(mPath) ? (JSON.parse(readFileSync(mPath, "utf8")).first as { example: string; id: string }[]).filter((x) => x.id.startsWith(`${set}|`)) : [];
  const dets = loadDets(set);
  const images = inputImages(set, dets);
  const dir = join(PRIV, set, ONLY ? "smoke" : "");
  const r = spawnSync(
    py("depth"),
    ["-I", join(REPO, "helpers", "depth", "render_f0m.py"), "--inputs", join(dir, "ends-inputs.jsonl"), "--ends", join(dir, "ends.jsonl"), "--images", JSON.stringify(Object.fromEntries(images.map((x) => [x.id, x.path]))), "--examples", JSON.stringify(first.map((x) => ({ id: x.id.slice(set.length + 1), example: join(ROOT, "private", "examples", x.example) }))), "--out", out, "--label", set],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  if (r.status !== 0) throw new Error(`render_f0m.py failed on ${set}`);
  log(`render under the data root's private/f0m/renders/${set}/index.html`);
}

// --- seams: Q-2's top seam per arm -----------------------------------------------------------------------

/** One arm's kept boxes as a detect.jsonl geometry.py can read: kept spines only, with the ids they stand for. */
function seamInput(ad: Map<string, Detection>, pick: (id: string) => boolean): { lines: string[]; ids: Map<string, string> } {
  const lines: string[] = [];
  const ids = new Map<string, string>();
  for (const d of ad.values()) {
    const keep = d.spines.flatMap((s, i) => (pick(`${d.id}:${i}`) ? [[s, i] as const] : []));
    if (!keep.length) continue;
    keep.forEach(([, i], k) => ids.set(`${d.id}:${k}`, `${d.id}:${i}`));
    lines.push(JSON.stringify({ id: d.id, width: d.width, height: d.height, spines: keep.map(([s]) => ({ polygon: s.polygon })) }));
  }
  return { lines, ids };
}

function seams(set: SetName): void {
  const dets = loadDets(set);
  const part = partition(set);
  const e = endsOf(set);
  const dir = join(PRIV, set, "seams");
  mkdirSync(dir, { recursive: true });
  const images = join(dir, "images.jsonl");
  writeFileSync(images, inputImages(set, dets).map((x) => JSON.stringify({ id: x.id, image: x.path })).join("\n") + "\n");
  const kept = (id: string) => part.get(id)?.state === "kept";
  // Before: every kept box; after: only boxes whose polygon the snap moved (the rest keep their before seam).
  const picks: Record<ArmName, (id: string) => boolean> = { clip: kept, snap: (id) => kept(id) && !!e.get(id)?.polygon };
  for (const arm of ARMS) {
    const { lines, ids } = seamInput(armDets(set, arm, dets, part, e), picks[arm]);
    const det = join(dir, `detect-${arm}.jsonl`);
    writeFileSync(det, lines.join("\n") + "\n");
    const tmp = join(dir, `geometry-${arm}.raw.jsonl`);
    const fd = openSync(tmp, "w");
    const r = spawnSync(py("coverage"), ["-I", join(REPO, "helpers", "coverage", "geometry.py"), "--detect", det, "--images", images], { stdio: ["ignore", fd, "inherit"] });
    closeSync(fd);
    if (r.status !== 0) throw new Error(`geometry.py failed on ${set} ${arm}`);
    const rows = readJsonl<{ id: string; topSeam: number | null; topY: number }>(tmp).map((x) => JSON.stringify({ ...x, id: ids.get(x.id) }));
    writeFileSync(join(dir, `geometry-${arm}.jsonl`), rows.join("\n") + "\n");
    log(`${set} ${arm}: ${rows.length} top seams`);
  }
}

// --- run: one reader arm on the changed set (F-0b's procedure, as H-2 and F-0i ran it) -------------------

/** Seed the clip arm with readings already taken of the same crop: F-0i's clip arm, then F-0e's in-frame reads. */
function seedClip(set: SetName, dets: Map<string, Detection>, subset: Set<string>, dir: string): number {
  const name = cropName(CROP);
  const have = new Set<string>();
  for (const r of ["vision", "ppocr", "qwen"]) {
    const p = join(dir, `${r}.jsonl`);
    if (existsSync(p)) for (const x of readJsonl<{ id: string; crop?: string }>(p)) if (x.crop === name) have.add(`${r}:${x.id}`);
  }
  let seeded = 0;
  for (const r of ["vision", "ppocr", "qwen"]) {
    const lines: string[] = [];
    const f0i = join(partDir(set), "clip", `${r}.jsonl`);
    if (existsSync(f0i))
      for (const x of readJsonl<Reading & { crop?: string }>(f0i))
        if (subset.has(x.id) && x.crop === name && !have.has(`${r}:${x.id}`)) {
          lines.push(JSON.stringify({ ...x, reusedFrom: "f0i-clip" }));
          have.add(`${r}:${x.id}`);
        }
    for (const x of readJsonl<Reading & { crop?: string }>(join(SETS[set].stage, `${r}.jsonl`))) {
      if (!subset.has(x.id) || have.has(`${r}:${x.id}`) || (x.crop ?? cropName(F0_CROP)) !== cropName(F0_CROP)) continue;
      const [p, i] = split(x.id);
      const d = dets.get(p)!, s = d.spines[i]!;
      if (!sameCrop(cropFor(s, d, CROP), cropFor(s, d, F0_CROP))) continue;
      lines.push(JSON.stringify({ ...x, crop: name, reusedFrom: cropName(F0_CROP) }));
      have.add(`${r}:${x.id}`);
    }
    if (lines.length) appendFileSync(join(dir, `${r}.jsonl`), lines.join("\n") + "\n");
    seeded += lines.length;
  }
  return seeded;
}

/** Pre-registered fallback: without the conductor's GPU slot both arms are decided without Qwen. */
const NO_QWEN = process.argv.includes("--no-qwen");
/** Qwen runs on the GPU: only with `--gpu-ok`, given once the conductor confirms the GPU is free. */
const GPU_OK = process.argv.includes("--gpu-ok");

async function run(set: SetName, arm: ArmName): Promise<void> {
  if (!ARMS.includes(arm)) throw new Error(`arm must be one of ${ARMS.join(", ")}`);
  const cfg = F0B_SETS[set];
  const dets0 = loadDets(set);
  const part = partition(set);
  const e = endsOf(set);
  const subset = changedSet(dets0, e);
  const kept = new Set([...part.values()].filter((r) => r.state === "kept").map((r) => r.id));
  const dets = armDets(set, arm, dets0, part, e);
  const images = inputImages(set, dets0);
  const before = new Map(readJsonl<SpineDecision>(SETS[set].decisions).map((d) => [d.id, d]));
  const dir = join(PRIV, set, arm);
  mkdirSync(dir, { recursive: true });
  if (arm === "clip") log(`${set} clip: ${seedClip(set, dets0, subset, dir)} cached readings reused`);
  log(`${set} ${arm}: ${subset.size} changed boxes, crop ${cropName(CROP)}`);
  const t0 = Date.now();
  const imgs = images.filter((x) => [...subset].some((id) => id.startsWith(`${x.id}:`)));
  await visionStage(imgs, dets, dir, log, CROP, subset);
  await pyReaderStage("ppocr", imgs, dets, dir, log, subset, CROP);
  const db = openCatalog(cfg.catalog);
  const cache = new Map<string, Candidate | undefined>();
  const score = new Map([...dets0.values()].flatMap((d) => d.spines.map((s, i): [string, number] => [`${d.id}:${i}`, s.boxScore])));
  const imageOf = (id: string) => split(id)[0];
  const readings0 = loadReadings(dir, CROP);
  const first = new Map([...subset].map((id) => [id, decide(db, id, imageOf(id), score.get(id)!, { vision: readings0.get(id)?.vision, ppocr: readings0.get(id)?.ppocr }, cache)]));
  const selected = new Set<string>();
  if (!NO_QWEN) {
    for (const img of images) {
      [...kept]
        .filter((id) => imageOf(id) === img.id)
        .filter((id) => (subset.has(id) ? firstPassHard(first.get(id)!) : before.has(id) && firstPassHard(before.get(id)!)))
        .sort((a, b) => score.get(b)! - score.get(a)!)
        .slice(0, cfg.qwenCap)
        .filter((id) => subset.has(id))
        .forEach((id) => selected.add(id));
    }
    const missing = [...selected].filter((id) => !readings0.get(id)?.qwen).length;
    log(`${set} ${arm}: qwen on ${selected.size} hard crops, ${missing} not yet read`);
    if (missing && !GPU_OK) throw new Error(`${missing} Qwen reads need the GPU: re-run with --gpu-ok once the conductor confirms it is free (or --no-qwen)`);
    await pyReaderStage("qwen", imgs, dets, dir, log, selected, CROP);
  }
  const readings = loadReadings(dir, CROP);
  const after = [...subset].map((id) => {
    const r = { ...(readings.get(id) ?? {}) };
    if (!selected.has(id)) delete r.qwen;
    return decide(db, id, imageOf(id), score.get(id)!, r, cache);
  });
  writeFileSync(
    join(dir, `decisions${NO_QWEN ? "-noqwen" : ""}.jsonl`),
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
const r4 = (x: number) => Math.round(x * 10000) / 10000;
const tri = (b: { value: number; lo: number; hi: number } | null): [number, number, number] | null => (b ? [r4(b.value), r4(b.lo), r4(b.hi)] : null);
const qs = (xs: number[], ps: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return ps.map((p) => (s.length ? r4(s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]!) : null));
};
/** H-1's elevation classes (degrees from the horizon). */
const elevation = (deg: number | null | undefined) => (deg === null || deg === undefined ? "unknown" : deg < -10 ? "below" : deg > 10 ? "above" : "level");

function analyseSet(set: SetName, truth?: Map<string, Set<string>>) {
  const dets = loadDets(set);
  const part = partition(set);
  const e = endsOf(set);
  const photoLines = readJsonl<{ photo?: boolean; id: string; overlapBefore: [number, number]; overlapAfter: [number, number]; seconds: number }>(join(PRIV, set, "ends.jsonl")).filter((x) => x.photo);
  const kept = (id: string) => part.get(id)?.state === "kept";
  const rows = [...e.values()];
  const count = (k: "top" | "bottom") => rows.reduce<Record<string, number>>((o, r) => ((o[r[k].status] = (o[r[k].status] ?? 0) + 1), o), {});
  const moves = (k: "top" | "bottom") => qs(rows.filter((r) => r[k].status === "snapped").map((r) => r[k].moveOutline! / r.length), [0.1, 0.5, 0.9]);
  const src = rows.filter((r) => r.bottom.status === "snapped").reduce<Record<string, number>>((o, r) => ((o[r.bottom.source!] = (o[r.bottom.source!] ?? 0) + 1), o), {});
  const ov = (k: "overlapBefore" | "overlapAfter") => tri(clusterBootstrap(photoLines.map((p) => ({ imageId: p.id, x: p[k] })), (rs) => rs.reduce((s, r) => s + r.x[0], 0) / Math.max(1, rs.reduce((s, r) => s + r.x[1], 0)), REPS, 3));
  const claimed = (k: "overlapBefore" | "overlapAfter") => photoLines.reduce((s, p) => s + p[k][1], 0);
  const elevOf = new Map(rows.map((r) => [r.id, elevation(r.elevationDeg)]));
  const f0iMoved = (id: string, k: "top" | "bottom") => (part.get(id)?.ends?.[k] ?? "outline") !== "outline";

  // M1: row-end residuals, before on the detection rectangles, after on the snapped boxes.
  const res: { imageId: string; arm: ArmName; id: string; top: number; bottom: number }[] = [];
  for (const arm of ARMS) {
    for (const d of armDets(set, arm, dets, part, e).values())
      for (const r of endResiduals(d, (i) => kept(`${d.id}:${i}`))) res.push({ imageId: d.id, arm, id: `${d.id}:${r.index}`, top: r.top, bottom: r.bottom });
  }
  const resDelta = (end: "top" | "bottom", sel: (id: string) => boolean = () => true, seed = 5) => {
    const m = meanResidual(end);
    const f = (rs: typeof res, arm: ArmName) => m(rs.filter((r) => r.arm === arm && sel(r.id)).map((r) => ({ imageId: r.imageId, index: 0, top: r.top, bottom: r.bottom })));
    const d = clusterBootstrap(res, (rs) => {
      const a = f(rs, "snap"), b = f(rs, "clip");
      return a === null || b === null ? null : a - b;
    }, REPS, seed);
    return { before: f(res, "clip") === null ? null : r4(f(res, "clip")!), after: f(res, "snap") === null ? null : r4(f(res, "snap")!), delta: tri(d), boxCount: res.filter((r) => r.arm === "snap" && sel(r.id)).length };
  };

  // M2: Q-2's top seam, after = the snapped box's seam where its polygon moved.
  const sd = join(PRIV, set, "seams");
  let seamFig: Record<string, unknown> | null = null;
  if (existsSync(join(sd, "geometry-snap.jsonl"))) {
    const g = (arm: ArmName) => new Map(readJsonl<{ id: string; topSeam: number | null }>(join(sd, `geometry-${arm}.jsonl`)).map((x) => [x.id, x.topSeam]));
    const gb = g("clip"), ga = g("snap");
    const sb: (SeamBox & { third: string; elev: string; arm: ArmName })[] = [];
    for (const arm of ARMS)
      for (const d of armDets(set, arm, dets, part, e).values())
        d.spines.forEach((s, i) => {
          const id = `${d.id}:${i}`;
          if (!kept(id)) return;
          const geo = boxGeometry(s.polygon);
          const cy = s.polygon.reduce((a, p) => a + p[1], 0) / 4 / d.height;
          const seam = arm === "snap" && ga.has(id) ? ga.get(id)! : gb.get(id) ?? null;
          sb.push({ imageId: d.id, id, seam, upright: geo.tilt <= UPRIGHT_DEG, third: cy < 1 / 3 ? "top" : cy < 2 / 3 ? "middle" : "bottom", elev: elevOf.get(id) ?? "unknown", arm });
        });
    const dSeam = (part2: "any" | "cut" | "overshoot", sel: (r: (typeof sb)[number]) => boolean = () => true, seed = 7) => {
      const f = (rs: typeof sb, arm: ArmName) => seamError(rs.filter((r) => r.arm === arm && sel(r)), part2);
      const d = clusterBootstrap(sb, (rs) => {
        const a = f(rs, "snap"), b = f(rs, "clip");
        return a === null || b === null ? null : a - b;
      }, REPS, seed);
      return { before: f(sb, "clip") === null ? null : r4(f(sb, "clip")!), after: f(sb, "snap") === null ? null : r4(f(sb, "snap")!), delta: tri(d) };
    };
    seamFig = {
      any: dSeam("any"),
      cut: dSeam("cut", undefined, 8),
      overshoot: dSeam("overshoot", undefined, 9),
      byThird: Object.fromEntries(["top", "middle", "bottom"].map((t, k) => [t, dSeam("any", (r) => r.third === t, 10 + k)])),
      byElevation: Object.fromEntries(["below", "level", "above"].map((t, k) => [t, dSeam("any", (r) => r.elev === t, 20 + k)])),
    };
  }

  const out: Record<string, any> = {
    scope: F0B_SETS[set].scope,
    photos: photoLines.length,
    keptBoxes: rows.length,
    snap: {
      top: count("top"),
      bottom: count("bottom"),
      bottomSource: src,
      moveOutlineShareOfLength: { top: moves("top"), bottom: moves("bottom"), quantiles: [0.1, 0.5, 0.9] },
      boxesChangedPolygon: rows.filter((r) => r.polygon).length,
      lostOutlines: rows.filter((r) => r.lost).length,
      claimedPixels: { before: claimed("overlapBefore"), after: claimed("overlapAfter") },
      cpuSecondsPerPhoto: r4(photoLines.reduce((s, p) => s + p.seconds, 0) / Math.max(1, photoLines.length)),
      byElevation: Object.fromEntries(["below", "level", "above", "unknown"].map((k) => {
        const rs = rows.filter((r) => elevOf.get(r.id) === k);
        return [k, { boxCount: rs.length, topSnapped: rs.filter((r) => r.top.status === "snapped").length, bottomSnapped: rs.filter((r) => r.bottom.status === "snapped").length }];
      })),
      f0iMovedEnds: {
        top: { ends: rows.filter((r) => f0iMoved(r.id, "top")).length, snapped: rows.filter((r) => f0iMoved(r.id, "top") && r.top.status === "snapped").length },
        bottom: { ends: rows.filter((r) => f0iMoved(r.id, "bottom")).length, snapped: rows.filter((r) => f0iMoved(r.id, "bottom") && r.bottom.status === "snapped").length },
      },
    },
    overlapRate: { before: ov("overlapBefore"), after: ov("overlapAfter") },
    residuals: {
      bottom: resDelta("bottom"),
      top: resDelta("top", undefined, 6),
      byElevation: Object.fromEntries(["below", "level", "above"].map((k, j) => [k, { bottom: resDelta("bottom", (id) => elevOf.get(id) === k, 30 + j), top: resDelta("top", (id) => elevOf.get(id) === k, 40 + j) }])),
      f0iMovedBottoms: resDelta("bottom", (id) => f0iMoved(id, "bottom"), 50),
      f0iMovedTops: resDelta("top", (id) => f0iMoved(id, "top"), 51),
    },
    seamError: seamFig,
  };

  // Readers on the changed set.
  const subset = changedSet(dets, e);
  out.changedSet = subset.size;
  const suffix = NO_QWEN ? "-noqwen" : "";
  const dec = (arm: ArmName) => {
    const p = join(PRIV, set, arm, `decisions${suffix}.jsonl`);
    return existsSync(p) ? new Map(readJsonl<SpineDecision & { qwenSelected?: boolean }>(p).map((d) => [d.id, d])) : null;
  };
  const bef = dec("clip"), aft = dec("snap");
  if (bef && aft) {
    for (const id of subset) if (!bef.has(id) || !aft.has(id)) throw new Error(`${set}: decisions do not cover the changed set; re-run both arms`);
    const base = new Map(readJsonl<SpineDecision>(SETS[set].decisions).map((d) => [d.id, d]));
    const g = new Map(geometry(dets).map((x): [string, Geo] => [x.id, x]));
    const pairs = (sel: (id: string) => boolean): Pair[] =>
      [...subset].filter(sel).map((id) => ({ id, imageId: split(id)[0], before: outcomeOf(bef.get(id)!, truth?.get(split(id)[0])), after: outcomeOf(aft.get(id)!, truth?.get(split(id)[0])) }));
    const summary = (rs: Pair[], seed: number) => ({
      boxCount: rs.length,
      photos: new Set(rs.map((r) => r.imageId)).size,
      textRead: delta(rs, textRead, seed),
      confirmed: delta(rs, confirmed, seed + 1),
      ...(truth ? { wrong: delta(rs, wrong, seed + 2) } : {}),
    });
    const strata: Record<string, (id: string) => boolean> = {
      "top snapped": (id) => e.get(id)!.top.status === "snapped",
      "bottom only": (id) => e.get(id)!.top.status !== "snapped",
      "below eye level": (id) => elevOf.get(id) === "below",
      "level or above": (id) => elevOf.get(id) === "level" || elevOf.get(id) === "above",
      "whole boxes": (id) => !g.get(id)?.piece,
      "cut or partial boxes": (id) => !!g.get(id)?.piece,
    };
    // Whole set: kept boxes; changed boxes take the arm's decision (before: the clip arm's), the rest their cached one.
    const keptIds = [...part.values()].filter((r) => r.state === "kept").map((r) => r.id);
    const wrows = keptIds.map((id) => ({ imageId: split(id)[0], b: subset.has(id) ? workOf(bef.get(id)) : workOf(base.get(id)), a: subset.has(id) ? workOf(aft.get(id)) : workOf(base.get(id)) }));
    const readers: Record<string, any> = {
      cropMethod: `${cropName(CROP)} on the snapped box`,
      against: `${cropName(CROP)} on the detection rectangle`,
      qwen: NO_QWEN ? "not used (pre-registered fallback)" : "F-0's hard-crop selection",
      all: summary(pairs(() => true), 11),
      strata: Object.fromEntries(Object.entries(strata).map(([k, f], i) => [k, summary(pairs(f), 21 + 3 * i)])),
      cost: {
        before: cost(loadReadings(join(PRIV, set, "clip"), CROP), subset, (id) => Boolean(bef.get(id)?.qwenSelected)),
        after: cost(loadReadings(join(PRIV, set, "snap"), CROP), subset, (id) => Boolean(aft.get(id)?.qwenSelected)),
      },
    };
    if (!truth) {
      const cnt = (rs: typeof wrows, k: "a" | "b") => new Set(rs.flatMap((r) => (r[k] ? [`${r.imageId}\u0000${r[k]}`] : []))).size;
      const d = clusterBootstrap(wrows, (rs) => cnt(rs, "a") - cnt(rs, "b"), REPS, 61);
      readers.distinctConfirmedWorks = { before: cnt(wrows, "b"), after: cnt(wrows, "a"), delta: d && { value: d.value, lo: d.lo, hi: d.hi }, lost: lostWorks(wrows.map((r) => ({ imageId: r.imageId, before: r.b, after: r.a }))), gained: lostWorks(wrows.map((r) => ({ imageId: r.imageId, before: r.a, after: r.b }))) };
    } else {
      const photos = [...new Set(wrows.map((r) => r.imageId))].sort();
      const per = (k: "a" | "b") =>
        photos.map((p): [number, number, number] => {
          const gt = truth.get(p) ?? new Set<string>();
          const acc = new Set(wrows.filter((r) => r.imageId === p && r[k]).map((r) => r[k]!));
          return [gt.size, [...acc].filter((w) => gt.has(w)).length, acc.size];
        });
      const pb = per("b"), pa = per("a");
      const rate = (xs: [number, number, number][], den: 0 | 2) => xs.reduce((s, x) => s + x[1], 0) / Math.max(1, xs.reduce((s, x) => s + x[den], 0));
      readers.titles = { before: { recall: r4(rate(pb, 0)), precision: r4(rate(pb, 2)) }, after: { recall: r4(rate(pa, 0)), precision: r4(rate(pa, 2)) }, delta: titleDelta(pb, pa) };
    }
    out.readers = readers;
  }
  return out;
}

function figures(s: any): SetFigures {
  const r = s.readers;
  return {
    bottomResidualDelta: s.residuals.bottom.delta,
    topResidualDelta: s.residuals.top.delta,
    seamErrorDelta: s.seamError?.any?.delta ?? null,
    overlapAfter: s.overlapRate.after?.[0] ?? 1,
    lostOutlines: s.snap.lostOutlines,
    ...(r
      ? {
          readers: {
            confirmed: r.all.confirmed,
            wrong: r.all.wrong ?? null,
            ...(r.distinctConfirmedWorks ? { works: { delta: r.distinctConfirmedWorks.delta, lost: r.distinctConfirmedWorks.lost } } : {}),
            ...(r.titles ? { recallDelta: r.titles.delta?.recall ?? null } : {}),
          },
        }
      : {}),
  };
}

function analyse(): void {
  const truth = yardstickTruth();
  const sets: Record<string, any> = {};
  for (const set of NAMES) sets[set] = analyseSet(set, set === "pilot-000" ? undefined : truth);
  const verdict = verdictOf(figures(sets["pilot-000"]), figures(sets["yardstick-library-b2"]));
  const m = {
    runId: "F0m",
    card: "F-0m",
    date: new Date().toLocaleDateString("en-CA"),
    depth: "moge-2-vitl-normal@cb0e8bb (H-2's cache); S-1 rows on F-0i's partition (S-2's run)",
    shippedCrop: cropName(CROP),
    bootstrap: { unit: "photo (cluster), paired: the same boxes before and after", reps: REPS, interval: "95 % percentile", units: "residuals in row spine heights; seam error and reader shares as shares or percentage points" },
    constants: F0M,
    keepRule:
      "geometry: pilot bottom residual falls (interval below 0), pilot seam error not up beyond its interval, overlap <= 0.5 % and no outline lost on both sets, yardstick bottom residual and seam error not up beyond their intervals; reader crop: that, plus pilot confirmed interval excludes 0 upward, pilot distinct works not down, yardstick confirmed not down and wrong not up beyond their intervals, yardstick title recall not down beyond its interval",
    verdict,
    sets,
  };
  const dir = join(REPO, "evals", "F0m");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "metrics.json"), compactJson(m) + "\n");
  const reportPath = join(dir, "report.md");
  const head = existsSync(reportPath) ? readFileSync(reportPath, "utf8").split(MARKER)[0]! : "# F0m: spine end edges (F-0m)\n\n";
  writeFileSync(reportPath, head.trimEnd() + "\n\n" + MARKER + "\n\n" + tables(m) + "\n");
  log("aggregates -> evals/F0m/{metrics.json,report.md}");
}

const MARKER = "<!-- generated by src/eval/f0m-cli.ts analyse: edit above this line -->";

function tables(m: { verdict: any; sets: Record<string, any> }): string {
  const names = Object.keys(m.sets);
  const head = (n: string) => (n === "pilot-000" ? "`pilot-000`" : "yardstick (PROXY)");
  const col = (f: (s: any) => string) => names.map((n) => f(m.sets[n])).join(" | ");
  const t3 = (t: number[] | null | undefined, k = 3) => (t ? `${t[0]!.toFixed(k)} (${t[1]!.toFixed(k)} to ${t[2]!.toFixed(k)})` : "—");
  const pc = (x: number | null | undefined, k = 1) => (x === null || x === undefined ? "—" : `${(x * 100).toFixed(k)} %`);
  const pct3 = (t: number[] | null | undefined, k = 1) => (t ? `${(t[0]! * 100).toFixed(k)} (${(t[1]! * 100).toFixed(k)} to ${(t[2]! * 100).toFixed(k)})` : "—");
  const kv = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ");
  const out: string[] = [];
  out.push("## The snap, both sets", "", `| figure | ${names.map(head).join(" | ")} |`, `|---|${names.map(() => "---").join("|")}|`);
  out.push(
    `| photos / kept boxes | ${col((s) => `${s.photos} / ${s.keptBoxes}`)} |`,
    `| top ends by status | ${col((s) => kv(s.snap.top))} |`,
    `| bottom ends by status | ${col((s) => kv(s.snap.bottom))} |`,
    `| snapped bottoms by source | ${col((s) => kv(s.snap.bottomSource))} |`,
    `| top move, share of length (p10 / median / p90; + trims) | ${col((s) => s.snap.moveOutlineShareOfLength.top.join(" / "))} |`,
    `| bottom move, share of length (p10 / median / p90; − trims) | ${col((s) => s.snap.moveOutlineShareOfLength.bottom.join(" / "))} |`,
    `| boxes with a moved polygon / outlines lost | ${col((s) => `${s.snap.boxesChangedPolygon} / ${s.snap.lostOutlines}`)} |`,
    `| pixels claimed, before → after | ${col((s) => `${s.snap.claimedPixels.before.toLocaleString("en-US")} → ${s.snap.claimedPixels.after.toLocaleString("en-US")}`)} |`,
    `| **overlap rate before → after (target ≤ 0.5 %)** | ${col((s) => `${pct3(s.overlapRate.before, 2)} → ${pct3(s.overlapRate.after, 2)}`)} |`,
    `| F-0i-moved ends snapped (top; bottom) | ${col((s) => `${s.snap.f0iMovedEnds.top.snapped} of ${s.snap.f0iMovedEnds.top.ends}; ${s.snap.f0iMovedEnds.bottom.snapped} of ${s.snap.f0iMovedEnds.bottom.ends}`)} |`,
    `| CPU seconds per photo | ${col((s) => String(s.snap.cpuSecondsPerPhoto))} |`,
    "",
    "Snapped ends by H-1 elevation (boxes / tops snapped / bottoms snapped):",
    "",
    `| elevation | ${names.join(" | ")} |`,
    `|---|${names.map(() => "---").join("|")}|`,
    ...["below", "level", "above", "unknown"].map((k) => `| ${k} | ${col((s) => { const x = s.snap.byElevation[k]; return `${x.boxCount} / ${x.topSnapped} / ${x.bottomSnapped}`; })} |`),
    "",
    "## M1: row-end residuals (row spine heights, capped at 0.5; after − before, 95 % paired interval)",
    "",
    `| ends | ${names.map((n) => `${n} before → after | change`).join(" | ")} |`,
    `|---|${names.map(() => "---|---").join("|")}|`,
  );
  const rrow = (label: string, f: (s: any) => any) => `| ${label} | ${names.map((n) => { const x = f(m.sets[n]); return x ? `${x.before?.toFixed(4) ?? "—"} → ${x.after?.toFixed(4) ?? "—"} (n ${x.boxCount}) | ${t3(x.delta, 4)}` : "— | —"; }).join(" | ")} |`;
  out.push(
    rrow("**bottom**", (s) => s.residuals.bottom),
    rrow("top", (s) => s.residuals.top),
    ...["below", "level", "above"].flatMap((k) => [rrow(`  bottom, ${k} eye level`, (s) => s.residuals.byElevation[k].bottom), rrow(`  top, ${k} eye level`, (s) => s.residuals.byElevation[k].top)]),
    rrow("  bottoms F-0i moved", (s) => s.residuals.f0iMovedBottoms),
    rrow("  tops F-0i moved", (s) => s.residuals.f0iMovedTops),
    "",
  );
  if (names.every((n) => m.sets[n].seamError)) {
    out.push("## M2: Q-2's top-seam error (share of upright kept boxes off the seam by > 0.05 of the long side)", "", `| part | ${names.map((n) => `${n} before → after | change (points)`).join(" | ")} |`, `|---|${names.map(() => "---|---").join("|")}|`);
    const srow = (label: string, f: (s: any) => any) => `| ${label} | ${names.map((n) => { const x = f(m.sets[n].seamError); return x ? `${pc(x.before)} → ${pc(x.after)} | ${pct3(x.delta)}` : "— | —"; }).join(" | ")} |`;
    out.push(
      srow("**any**", (s) => s.any),
      srow("cut", (s) => s.cut),
      srow("overshoot", (s) => s.overshoot),
      ...["top", "middle", "bottom"].map((k) => srow(`  ${k} third of the frame`, (s) => s.byThird[k])),
      ...["below", "level", "above"].map((k) => srow(`  ${k} eye level`, (s) => s.byElevation[k])),
      "",
    );
  }
  type D = { before: number; after: number; delta: number; lo: number; hi: number } | null | undefined;
  const fmt = (d: D) => (d ? `${d.before} → ${d.after} (${d.delta >= 0 ? "+" : ""}${d.delta}; ${d.lo} to ${d.hi})` : "—");
  for (const [set, s] of Object.entries(m.sets)) {
    const x = s.readers;
    if (!x) continue;
    const yard = set !== "pilot-000";
    out.push(`## ${set}: readers, \`snap\` against \`clip\` (${s.scope})`, "", `${x.all.boxCount} changed boxes; Qwen: ${x.qwen}. Shares in % of them, before → after (Δ points; 95 % paired photo-bootstrap interval).`, "",
      `| boxes | n | photos | text read | confirmed |${yard ? " wrong |" : ""}`, `|---|---:|---:|---|---|${yard ? "---|" : ""}`);
    const row = (label: string, r: any) => `| ${label} | ${r.boxCount} | ${r.photos} | ${fmt(r.textRead)} | ${fmt(r.confirmed)} |${yard ? ` ${fmt(r.wrong)} |` : ""}`;
    out.push(row("**all**", x.all), ...Object.entries<any>(x.strata).map(([k, r]) => row(`  ${k}`, r)), "");
    if (x.distinctConfirmedWorks) {
      const d = x.distinctConfirmedWorks;
      out.push(`Distinct confirmed works over the whole set (per photo, summed): ${d.before} → ${d.after} (${d.delta ? `${d.delta.value >= 0 ? "+" : ""}${d.delta.value}; ${d.delta.lo} to ${d.delta.hi}` : "—"}); (photo, work) pairs lost ${d.lost}, gained ${d.gained}.`, "");
    }
    if (x.titles) {
      const t = x.titles;
      const pp = (v: number[]) => `${(v[0]! * 100).toFixed(1)} (${(v[1]! * 100).toFixed(1)} to ${(v[2]! * 100).toFixed(1)})`;
      out.push(`Titles over the whole set: recall ${pc(t.before.recall)} → ${pc(t.after.recall)} (${t.delta ? pp(t.delta.recall) : "—"} points), precision ${pc(t.before.precision)} → ${pc(t.after.precision)} (${t.delta ? pp(t.delta.precision) : "—"}).`, "");
    }
    const c = (k: string, w: string) => `${x.cost.before[k][w]} → ${x.cost.after[k][w]}`;
    out.push("| reader | calls | seconds |", "|---|---:|---:|", ...["vision", "ppocr", "qwen"].map((k) => `| ${k} | ${c(k, "calls")} | ${c(k, "seconds")} |`), "");
  }
  if (m.verdict) {
    const v = m.verdict, yn = (b: boolean | undefined) => (b ? "yes" : "no");
    const g = v.geometry;
    out.push("## Verdict (generated)", "", "| geometry rule | met |", "|---|---|",
      `| G1 pilot bottom residual falls (interval below 0) | ${yn(g.pilotBottomsMoreConsistent)} |`,
      `| G2 pilot seam error not up beyond its interval | ${yn(g.pilotSeamErrorNotUp)} |`,
      `| G3 overlap ≤ 0.5 % and no outline lost, both sets | ${yn(g.partitionHolds)} |`,
      `| G4 yardstick bottom residual not up beyond its interval | ${yn(g.yardstickBottomsNotWorse)} |`,
      `| G4 yardstick seam error not up beyond its interval | ${yn(g.yardstickSeamErrorNotUp)} |`,
      "", `Geometry cache (snapped outlines and box ends): **${g.ships ? "ships" : "does not ship"}**.`, "");
    const r = v.readerCrop;
    if (r) {
      out.push("| reader rule | met |", "|---|---|",
        `| 1 geometry ships | ${yn(r.geometryShips)} |`,
        `| 2 pilot confirmed interval excludes 0 upward | ${yn(r.pilotConfirmedExcludesZero)} |`,
        `| 3 pilot distinct works not down | ${yn(r.pilotNoConfirmedBookLost)} |`,
        `| 4 yardstick confirmed not down | ${yn(r.yardstickConfirmedNotDown)} |`,
        `| 4 yardstick wrong not up | ${yn(r.yardstickWrongNotUp)} |`,
        `| 5 yardstick title recall not down | ${yn(r.yardstickRecallNotDown)} |`,
        "", `Reader crop on the snapped box: **${r.ships ? "ships" : "off; the crop stays `rect;rot=fixed;clip=frame` on the detection rectangle"}**.`);
    } else out.push("Reader crop: not yet read.");
  }
  return out.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, set, arg] = process.argv.slice(2);
  if (cmd === "ends" && isSet(set)) ends(set);
  else if (cmd === "render" && isSet(set)) render(set);
  else if (cmd === "seams" && isSet(set)) seams(set);
  else if (cmd === "run" && isSet(set) && (arg === "clip" || arg === "snap")) await run(set, arg);
  else if (cmd === "analyse") analyse();
  else {
    console.error("usage: f0m-cli.ts ends|render|seams <set> [--only <photo id>] | run <set> <clip|snap> [--gpu-ok | --no-qwen] | analyse [--no-qwen]   (set: pilot-000 | yardstick-library-b2)");
    process.exit(2);
  }
}
