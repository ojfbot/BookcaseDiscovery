// NB-3's depth stage in the default path (f0-cli.ts): H-2's depth stage (helpers/depth/stage.py: MoGe-2 geometry and
// the face split, cached and keyed, INV-14) and S-1's lip features (helpers/shelf/shelf.py) per box, so the shipped
// NB-3 causes (nb3.ts) can run after F-0c's and F-0f's kinds. Runs only when a cause that needs depth ships.
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonl, type Detection, type InputImage } from "./f0.ts";
import type { FaceCounts } from "./nb3.ts";
import type { LipFeatures } from "./s1.ts";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DEPTH = join(REPO_ROOT, "helpers", "depth");

/** Per box `<image>:<i>`: its face split counts and lip features (either null when unmeasured). */
export type DepthEvidence = Map<string, { faces: FaceCounts | null; lip: LipFeatures | null }>;

function run(script: string, args: string[], out: string): void {
  const fd = openSync(out, "w");
  const r = spawnSync("uv", ["run", "--project", DEPTH, "python", "-I", script, ...args], { stdio: ["ignore", fd, "inherit"] });
  closeSync(fd);
  if (r.status !== 0) throw new Error(`${script} exited ${r.status}`);
}

/**
 * The depth stage for one run's detections, writing `depth.jsonl` and `shelf.jsonl` beside the other stages. The
 * cache is H-2's (the data root's `private/h2/cache/`), so a photo another card measured is a geometry hit; a miss
 * runs MoGe-2 (helpers/depth/README.md). `kept(imageId, i)`: the boxes F-0c's kinds keep, the books S-1's rows stand on.
 */
export function depthStage(images: InputImage[], dets: Map<string, Detection>, dir: string, root: string, kept: (imageId: string, i: number) => boolean, log: (s: string) => void): DepthEvidence {
  const cache = join(root, "private", "h2", "cache");
  const list = join(dir, "depth-images.jsonl");
  writeFileSync(list, images.filter((i) => dets.has(i.id)).map((i) => JSON.stringify({ id: i.id, image: i.path })).join("\n") + "\n");
  log("depth: geometry and face split");
  run(join(DEPTH, "stage.py"), ["--images", list, "--detect", join(dir, "detect.jsonl"), "--cache", cache, "--exif-fov"], join(dir, "depth.jsonl"));
  const rows = readJsonl<{ id: string; photo?: boolean; box?: number; geometryKey?: string; facesKey?: string } & FaceCounts>(join(dir, "depth.jsonl"));
  const geo = join(cache, "geometry");
  const revs = existsSync(geo) ? readdirSync(geo).filter((d) => d.startsWith("moge-2-vitl-normal@")) : [];
  if (revs.length !== 1) throw new Error("expected one MoGe-2 revision in the depth cache");
  const inputs = rows.filter((r) => r.photo && dets.has(r.id)).map((p) => {
    const d = dets.get(p.id)!;
    return JSON.stringify({
      id: d.id,
      width: d.width,
      height: d.height,
      npz: join(geo, revs[0]!, `${p.geometryKey}.npz`),
      faces: join(cache, "faces", p.geometryKey!, `${p.facesKey}.json`),
      classmap: join(cache, "faces", p.geometryKey!, `${p.facesKey}.png`),
      spines: d.spines.map((s, i) => ({ polygon: s.polygon, kept: kept(d.id, i) })),
      outlines: {},
      covers: [],
      bands: d.bands.map((b) => ({ polygon: b.polygon })),
      medianWidth: d.gaps.medianWidth,
    });
  });
  const shelfIn = join(dir, "shelf-inputs.jsonl");
  writeFileSync(shelfIn, inputs.join("\n") + "\n");
  log("depth: shelf rows and lip features");
  run(join(REPO_ROOT, "helpers", "shelf", "shelf.py"), ["--inputs", shelfIn, "--maps", join(dir, "shelf-maps")], join(dir, "shelf.jsonl"));
  const out: DepthEvidence = new Map();
  for (const r of rows) if (!r.photo && r.box != null) out.set(`${r.id}:${r.box}`, { faces: r, lip: null });
  for (const s of readJsonl<{ id: string; boxes: (LipFeatures | null)[] }>(join(dir, "shelf.jsonl")))
    s.boxes.forEach((lip, i) => {
      const k = `${s.id}:${i}`;
      out.set(k, { faces: out.get(k)?.faces ?? null, lip });
    });
  return out;
}
