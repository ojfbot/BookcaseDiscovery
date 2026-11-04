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
import { titleDelta } from "./f0e.ts";
import { compactJson, outcomeOf, yardstickTruth } from "./q1-cli.ts";
import { clusterBootstrap } from "./q1.ts";
import type { Outcome } from "./q1.ts";
import { endResiduals, F0M, lostWorks, meanResidual, seamError, verdictOf, type EndRow, type SeamBox } from "./f0m.ts";

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

function seams(set: SetName): void {
  const dets = loadDets(set);
  const part = partition(set);
  const e = endsOf(set);
  const dir = join(PRIV, set, "seams");
  mkdirSync(dir, { recursive: true });
  const images = join(dir, "images.jsonl");
  writeFileSync(images, inputImages(set, dets).map((x) => JSON.stringify({ id: x.id, image: x.path })).join("\n") + "\n");
  for (const arm of ARMS) {
    const ad = armDets(set, arm, dets, part, e);
    // Only kept upright boxes are measured; geometry.py measures every spine it is given.
    const det = join(dir, `detect-${arm}.jsonl`);
    writeFileSync(det, [...ad.values()].map((d) => JSON.stringify({ ...d, spines: d.spines.map((s) => ({ ...s, polygon: (s as { kept?: boolean }).kept ? s.polygon : null })).map((s) => (s.polygon ? s : { ...s, polygon: [[0, 0], [1, 0], [1, 1], [0, 1]] })) })).join("\n") + "\n");
    const fd = openSync(join(dir, `geometry-${arm}.jsonl`), "w");
    const r = spawnSync(py("coverage"), ["-I", join(REPO, "helpers", "coverage", "geometry.py"), "--detect", det, "--images", images], { stdio: ["ignore", fd, "inherit"] });
    closeSync(fd);
    if (r.status !== 0) throw new Error(`geometry.py failed on ${set} ${arm}`);
    log(`${set} ${arm}: top seams written`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, set, arg] = process.argv.slice(2);
  if (cmd === "ends" && isSet(set)) ends(set);
  else if (cmd === "render" && isSet(set)) render(set);
  else if (cmd === "seams" && isSet(set)) seams(set);
  else {
    console.error("usage: f0m-cli.ts ends|render|seams <set> [--only <photo id>] | run <set> <clip|snap> | analyse   (set: pilot-000 | yardstick-library-b2)");
    process.exit(2);
  }
}
