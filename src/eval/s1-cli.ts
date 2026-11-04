// S-1 runner: shelf planes, voids and the geometric `on-lip` label test, from H-2's cached depth stage
// (pre-registered in evals/S1/report.md).
//
//   node src/eval/s1-cli.ts stage <set>             # helpers/depth/stage.py on H-2's cache: keys per photo (all hits)
//   node src/eval/s1-cli.ts shelf <set> [--only N]  # helpers/shelf/shelf.py: planes, voids, lip features per photo
//   node src/eval/s1-cli.ts segment <set>           # prior art: ADE20K Mask2Former and SAM 3 "shelf" masks
//   node src/eval/s1-cli.ts analyse                 # evals/S1/{metrics.json,report.md}: aggregates only
//   node src/eval/s1-cli.ts render                  # the data root's private/s1/renders/ (private still study)
//
// Sets (OC35, never merged): pilot-000 with F-0e's `bands+strips` boxes and Q-2b's SAM 2.1 outlines; the yardstick
// with F-0's B2 boxes (no outlines: boxes stand in). Both after the shipped not-a-book filter (F-0c's shapes, F-0f's
// shelf labels). Everything per photo or box goes under the data root's `private/s1/`.
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dataRoot } from "../ledger/images.ts";
import { readJsonl, type Detection } from "./f0.ts";
import { kinds } from "./f0c.ts";
import { imagesOf, SETS, type SetName } from "./f0c-cli.ts";
import { evidenceFor } from "./f0f-cli.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const ROOT = dataRoot();
const PRIV = join(ROOT, "private", "s1");
const H2_CACHE = join(ROOT, "private", "h2", "cache");
const log = (s: string): void => console.error(`[s1] ${s}`);
const NAMES: SetName[] = ["pilot-000", "yardstick"];
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

/** Q-2b's SAM 2.1 outline per kept pilot-000 box, by `<photo>:<box>`; the yardstick has none (boxes stand in). */
function outlines(set: SetName): Map<string, [number, number][]> {
  if (set !== "pilot-000") return new Map();
  const rows = readJsonl<{ id: string; outline?: [number, number][] }>(join(ROOT, "private", "q2b", "outlines", "pilot-000.jsonl"));
  return new Map(rows.filter((r) => r.outline && r.outline.length >= 3).map((r) => [r.id, r.outline!]));
}

function shelf(set: SetName, only?: number): void {
  if (!existsSync(py("depth"))) throw new Error("helpers/depth has no .venv: run `uv sync` there first");
  const dets = detsOf(set);
  const keys = stagePhotos(set);
  const ev = evidenceFor(set);
  const outs = outlines(set);
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
        spines: d.spines.map((s, i) => ({ polygon: s.polygon, kept: kd.spines[i]!.kind === "spine", why: kd.spines[i]!.why })),
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
  else {
    console.error("usage: s1-cli.ts stage|shelf|segment|analyse|render [set]");
    process.exit(2);
  }
}
