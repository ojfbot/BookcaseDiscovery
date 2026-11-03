// F-0 machine labelling (OC34 as amended by OC36): open models box and read every spine, the catalog
// confirms identity, and a label is accepted only when two independent readers agree on one catalog work.
// Everything else stays unknown with its reason; there is no human queue. Stage outputs are cached as JSON
// Lines under $BOOKCASE_DATA/f0/<session>/ (private: they hold recognised text). Only aggregates leave
// through `metrics`, which the CLI writes to evals/<run-id>/. Spec: docs/machine-labelling.md.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { retrieve, type Candidate } from "../catalog/retrieve.ts";
import { cropFor, cropName, F0_CROP, type CropMethod } from "../perceive/crop.ts";
import { OcrHelperError, runOcr, type OcrRequest, type OcrResponse } from "../perceive/ocr.ts";
import { assignShelves, type LabelSet, type Photo, type Polygon4 } from "./labels.ts";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const HELPER = join(REPO_ROOT, "helpers", "label");

/**
 * How each spine is cut and turned for the readers (src/perceive/crop.ts; measured in evals/F0b/). Every reading
 * record names it (`crop`); records without one were read with F-0's original method (`F0_CROP`).
 */
export const CROP: CropMethod = { ...F0_CROP, clip: true };

/** Acceptance thresholds (OC36 yardstick 2). Conservative; see docs/machine-labelling.md. */
export const ACCEPT = {
  /**
   * Retrieval evidence score of the agreed work, for each agreeing reader. Set from C-3's golden run, never from
   * the yardstick: no-match top scores reached 0.721, correct top-1 scores went down to 0.71.
   */
  minScore: 0.72,
  /** The title field must be explained, not just the author. */
  minTitleEvidence: 0.8,
  /** Share of the reading's tokens the work explains. */
  minCoverage: 0.5,
  /** Readers that must name the same work. */
  minReaders: 2,
} as const;

export type ReaderName = "vision" | "ppocr" | "qwen";
export const READERS: ReaderName[] = ["vision", "ppocr", "qwen"];

export interface InputImage {
  /** Working-copy hash (or a yardstick file name): the stage key. */
  id: string;
  /** Hash written to Photo.hash (the original's sha256 for fixtures). */
  photoHash: string;
  path: string;
  setting: string;
}

export interface DetectedSpine {
  polygon: Polygon4;
  boxScore: number;
  maskScore: number;
  aspect: number;
  cut: boolean;
  /** The mask's simplified outer contour (working-copy pixels), when the detector kept it: the crop's spine face. */
  outline?: [number, number][];
}

export interface Detection {
  id: string;
  width: number;
  height: number;
  spines: DetectedSpine[];
  bands: { polygon: Polygon4; spines: number; span: number; gap: number }[];
  gaps: { bandLength: number; gapLength: number; gapCount: number; medianWidth: number };
  tiles: number;
  seconds: number;
  /** Box arm (b2, b3, b4) and the detector process's memory peaks so far, in MB. */
  arm?: string;
  /** Tiling and post steps (F-0e; absent before), as `tilingName`. */
  layout?: string;
  device?: string;
  peakRssMb?: number;
  mpsPeakMb?: number;
  error?: string;
}

interface ReadVariant {
  rotation: number;
  text: string;
  confidence: number;
}

export interface Reading {
  id: string;
  reader: ReaderName;
  /** Crop method provenance (`cropName`); absent on F-0's original records. */
  crop?: string;
  variants: ReadVariant[];
  seconds: number;
  error?: string;
}

export type UnknownReason = "no-text" | "no-catalog-match" | "single-reader" | "readers-disagree";

export interface SpineDecision {
  id: string;
  imageId: string;
  boxScore: number;
  /** Top confirmed work per reader (null: the reader's best candidate failed the bar, or it read nothing). */
  confirmed: Partial<Record<ReaderName, string | null>>;
  /** Top candidate per reader, confirmed or not. */
  top: Partial<Record<ReaderName, string | null>>;
  readText: Partial<Record<ReaderName, boolean>>;
  accepted: Candidate | null;
  agreeing: ReaderName[];
  reason: UnknownReason | null;
  hard: boolean;
}

// --- stage plumbing ---------------------------------------------------------------------------

export function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as T);
}

/** Spawn a helper, feed it request lines, append each answer line to `out`. Resolves when it exits. */
function runHelper(script: string, args: string[], requests: object[], out: string, log: (s: string) => void, env: NodeJS.ProcessEnv = {}): Promise<void> {
  if (requests.length === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const child = spawn("uv", ["run", "--project", HELPER, "python", join(HELPER, script), ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      if (line.trim()) appendFileSync(out, `${line}\n`);
    });
    let tail = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      tail = (tail + chunk).slice(-2000);
      for (const l of chunk.split("\n")) if (/^(detect|read):/.test(l)) log(l);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(requests.map((r) => `${JSON.stringify(r)}\n`).join(""));
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${script} exited ${code}: ${tail.split("\n").slice(-4).join(" | ")}`)),
    );
  });
}

const spineId = (imageId: string, i: number): string => `${imageId}:${i}`;

/** Box arms (docs/models/open-weights.md): b1 SAM 3 alone; b2 Grounding DINO base, b3 OWLv2, b4 MM Grounding DINO large, each -> SAM 2.1. */
export const ARMS = ["b1", "b2", "b3", "b4"] as const;
export type Arm = (typeof ARMS)[number];

export const ARM_NAMES: Record<Arm, string> = {
  b1: "sam3 (text prompt, masks direct)",
  b2: "grounding-dino-base -> sam2.1-hiera-base-plus",
  b3: "owlv2-base-patch16-ensemble -> sam2.1-hiera-base-plus",
  b4: "mm-grounding-dino-large-all -> sam2.1-hiera-base-plus",
};

const BOX_PRODUCER: Record<Arm, string> = {
  b1: "B1: sam3 (text prompt 'book spine', instance score >= 0.3), masks direct, tiled; min-area rect -> 4-point polygon",
  b2: "B2: grounding-dino-base ('book spine.') -> sam2.1-hiera-base-plus, tiled; min-area rect -> 4-point polygon",
  b3: "B3: owlv2-base-patch16-ensemble ('book spine', box threshold 0.1) -> sam2.1-hiera-base-plus, tiled; min-area rect -> 4-point polygon",
  b4: "B4: mm-grounding-dino-large-all ('book spine.') -> sam2.1-hiera-base-plus, tiled; min-area rect -> 4-point polygon",
};

/** Provenance of one run: the box step it actually used, its readers, and why there is no box agreement. */
export function stackFor(arm: Arm, scope: "pilot" | "yardstick", tiling: Tiling = scope === "pilot" ? CASE_TILING : SHELF_TILING) {
  return {
    boxProducer: `${BOX_PRODUCER[arm]}; tiling ${tilingName(tiling)}`,
    boxProducers: 1,
    boxAgreement:
      scope === "pilot"
        ? "unavailable on pilot-000: SAM 3 (B1) arrived mid-card and ran on the yardstick only; B2 confidence and the gap test stand in"
        : `not computed: one box arm per run (${arm.toUpperCase()}); arms are compared by the end-to-end title score`,
    cropMethod: cropName(CROP),
    readers: ["R1 apple-vision .accurate (helpers/ocr-vision)", "R2 qwen3-vl-4b-instruct-8bit (mlx), hard crops only", "R3 pp-ocrv5 server det+rec + textline classifier"],
    paidVlm: "skipped: no API key or spend ceiling set (checklist #7)",
  };
}

/** Tile size and overlap in working-copy pixels; the detector shrinks each tile to about 800-1333 px. */
export interface Tiling {
  tile: number;
  overlap: number;
  /** F-0e: tiles taller than wide, with their own vertical overlap (default: square, `tile` and `overlap`). */
  tileH?: number;
  overlapY?: number;
  /**
   * F-0e: `bands` finds the shelf bands first (a box-only pass on SHELF_TILING tiles) and lays one row of tiles
   * `tile` wide along each band, as tall as the band plus a margin; the grid above is the fallback when it finds none.
   */
  layout?: "bands";
  /** F-0e post steps after NMS, in detect.py's order (`strips`, `join`, `extend`). */
  post?: string[];
}

/** The tiling as detect.py names it in each detection's `layout` and the runs' provenance: "1600x2600/700x1900 +strips". */
export function tilingName(t: Tiling): string {
  const h = t.tileH ?? t.tile;
  const oy = t.overlapY ?? t.overlap;
  // detect.py's COARSE_TILE and COARSE_OVERLAP are SHELF_TILING's values.
  const grid =
    t.layout === "bands" ? `bands 3100/1300 -> ${t.tile}w` : h === t.tile && oy === t.overlap ? `${t.tile}/${t.overlap}` : `${t.tile}x${h}/${t.overlap}x${oy}`;
  return grid + (t.post ?? []).map((p) => ` +${p}`).join("");
}
/**
 * Whole-case photos (pilot-000): spines are ~2 % of the frame. F-0e: shelf-aligned tiling. A box-only pass on
 * shelf-scale tiles finds the bands; then one row of 1600 px-wide tiles (the detector's input scale as before) runs
 * along each band, as tall as the band plus 12 % above and below, so every spine in a found band is whole in a tile;
 * then `strips` drops flat strips of spine ends that a tile edge cuts. If no band is found, the fallback grid is the
 * tall one (1600 x 2600 px, 700 x 1900 px overlap). F-0 ran a square 1600/700 grid.
 */
export const CASE_TILING: Tiling = { tile: 1600, overlap: 700, tileH: 2600, overlapY: 1900, layout: "bands", post: ["strips"] };
/** Shelf-scale photos (the yardstick's split images, ~7100 x 3100): one spine is ~2400 px tall, so a tile spans the shelf. */
export const SHELF_TILING: Tiling = { tile: 3100, overlap: 1300 };

export async function detectStage(images: InputImage[], dir: string, log: (s: string) => void, arm: Arm = "b2", tiling: Tiling = CASE_TILING): Promise<Map<string, Detection>> {
  const out = join(dir, "detect.jsonl");
  const cached = readJsonl<Detection>(out).filter((d) => !d.error);
  // Spine ids are positions in a detection, so readings cached beside boxes from another tiling would be misread
  // as this one's. Runs before F-0e carry no `layout`: they used the square 1600/700 or 3100/1300 grid.
  const stale = cached.find((d) => (d.layout ?? `${tiling.tile}/${tiling.overlap}`) !== tilingName(tiling));
  if (stale) throw new Error(`${out} holds detections made with tiling ${stale.layout ?? "1600/700"}, not ${tilingName(tiling)}: use a fresh stage folder`);
  const done = new Set(cached.map((d) => d.id));
  await runHelper("detect.py", [], images.filter((i) => !done.has(i.id)).map((i) => ({ id: i.id, image: i.path })), out, log, {
    F0_ARM: arm,
    F0_TILE: String(tiling.tile),
    F0_OVERLAP: String(tiling.overlap),
    F0_TILE_H: String(tiling.tileH ?? tiling.tile),
    F0_OVERLAP_Y: String(tiling.overlapY ?? tiling.overlap),
    F0_POST: (tiling.post ?? []).join(","),
    F0_LAYOUT: tiling.layout ?? "grid",
  });
  return new Map(readJsonl<Detection>(out).filter((d) => !d.error).map((d) => [d.id, d]));
}

/** One reader request per spine, cut by `method`; a spine with nothing inside the frame is not read. */
export function spineRequests(images: InputImage[], dets: Map<string, Detection>, method: CropMethod, only?: Set<string>) {
  return images.flatMap((img) => {
    const det = dets.get(img.id);
    return (det?.spines ?? []).flatMap((s, i) => {
      const id = spineId(img.id, i);
      if (only && !only.has(id)) return [];
      const c = cropFor(s, det!, method);
      return c ? [{ id, image: img.path, polygon: c.polygon, rotations: c.rotations, crop: c.crop }] : [];
    });
  });
}

/** Ids already read with `method` (older records without a crop string count as F-0's method). */
function readWith(path: string, method: CropMethod): Set<string> {
  const name = cropName(method);
  return new Set(readJsonl<{ id: string; crop?: string }>(path).filter((r) => (r.crop ?? cropName(F0_CROP)) === name).map((r) => r.id));
}

type VisionResult = OcrResponse | { id: string; error: { code: string } };

/** One helper call, 6 s a crop (at least 60 s). A call that stalls is halved and retried; a lone crop that stalls is an error. */
async function visionBatch(reqs: OcrRequest[], log: (s: string) => void): Promise<VisionResult[]> {
  try {
    return await runOcr(reqs, { timeoutMs: Math.max(60_000, reqs.length * 6_000) });
  } catch (e) {
    if (!(e instanceof OcrHelperError) || !/within/.test(e.message)) throw e;
    if (reqs.length === 1) return [{ id: reqs[0]!.id, error: { code: "timeout" } }];
    log(`vision: helper stalled on ${reqs.length} crops, splitting`);
    const half = Math.ceil(reqs.length / 2);
    return [...(await visionBatch(reqs.slice(0, half), log)), ...(await visionBatch(reqs.slice(half), log))];
  }
}

export async function visionStage(
  images: InputImage[],
  dets: Map<string, Detection>,
  dir: string,
  log: (s: string) => void,
  method: CropMethod = CROP,
  only?: Set<string>,
): Promise<void> {
  const out = join(dir, "vision.jsonl");
  const done = readWith(out, method);
  const crop = cropName(method);
  for (const img of images) {
    const reqs = spineRequests([img], dets, method, only)
      .filter((r) => !done.has(r.id))
      .map(({ id, image, polygon, rotations }): OcrRequest => ({ id, image, polygon, rotations }));
    if (reqs.length === 0) continue;
    const t0 = Date.now();
    // Batches keep one helper call well inside its timeout when the GPU is shared with detection.
    const res = [];
    for (let i = 0; i < reqs.length; i += 100) res.push(...(await visionBatch(reqs.slice(i, i + 100), log)));
    const per = (Date.now() - t0) / 1000 / reqs.length;
    for (const r of res) {
      const line: Reading =
        "error" in r
          ? { id: r.id, reader: "vision", crop, variants: [], seconds: per, error: r.error.code }
          : { id: r.id, reader: "vision", crop, variants: r.variants.map((v) => ({ rotation: v.rotation, text: v.text, confidence: v.confidence })), seconds: per };
      appendFileSync(out, `${JSON.stringify(line)}\n`);
    }
    log(`vision: ${img.id.slice(0, 12)} ${reqs.length} spines ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
}

export async function pyReaderStage(
  reader: "ppocr" | "qwen",
  images: InputImage[],
  dets: Map<string, Detection>,
  dir: string,
  log: (s: string) => void,
  only?: Set<string>,
  method: CropMethod = CROP,
): Promise<void> {
  const out = join(dir, `${reader}.jsonl`);
  const done = readWith(out, method);
  const reqs = spineRequests(images, dets, method, only).filter((r) => !done.has(r.id));
  // PP-OCR runs on the CPU, about 1 s a crop: split by image across workers (each loads the models once).
  const workers = reader === "ppocr" ? Math.max(1, Number(process.env.F0_PPOCR_WORKERS ?? 3)) : 1;
  const shards: (typeof reqs)[] = Array.from({ length: workers }, () => []);
  const order = [...new Set(reqs.map((r) => r.image))];
  for (const r of reqs) shards[order.indexOf(r.image) % workers]!.push(r);
  await Promise.all(shards.map((s) => runHelper("read.py", ["--reader", reader], s, out, log)));
}

/** Each spine's latest reading per reader; with `method`, only readings cut that way. */
export function loadReadings(dir: string, method?: CropMethod): Map<string, Partial<Record<ReaderName, Reading>>> {
  const byId = new Map<string, Partial<Record<ReaderName, Reading>>>();
  const name = method && cropName(method);
  for (const reader of READERS) {
    for (const r of readJsonl<Reading & { reader: string }>(join(dir, `${reader}.jsonl`))) {
      if (name && (r.crop ?? cropName(F0_CROP)) !== name) continue;
      const entry = byId.get(r.id) ?? {};
      entry[reader] = { ...r, reader };
      byId.set(r.id, entry);
    }
  }
  return byId;
}

// --- deciding ---------------------------------------------------------------------------------

/** One reader's texts as retrieval variants: each rotation (and correction setting) is one whole-spine reading. */
export function variantsOf(r: Reading | undefined): string[] {
  if (!r || r.error) return [];
  const texts = r.variants.map((v) => v.text.replace(/\s+/g, " ").trim()).filter((t) => t.length >= 2);
  return [...new Set(texts)];
}

/** Does the catalog confirm this candidate as the book (OC36 yardstick 2)? */
export function confirms(c: Candidate | undefined): boolean {
  if (!c) return false;
  const title = c.evidence.find((e) => e.field === "title")?.score ?? 0;
  return c.score >= ACCEPT.minScore && title >= ACCEPT.minTitleEvidence && c.queryCoverage >= ACCEPT.minCoverage;
}

export function topFor(db: DatabaseSync, r: Reading | undefined, cache: Map<string, Candidate | undefined>): Candidate | undefined {
  const variants = variantsOf(r);
  if (variants.length === 0) return undefined;
  const key = variants.join("\u0000");
  if (!cache.has(key)) cache.set(key, retrieve(db, variants, 3)[0]);
  return cache.get(key);
}

/** Decide one spine from whatever readers have read it. */
export function decide(
  db: DatabaseSync,
  id: string,
  imageId: string,
  boxScore: number,
  reads: Partial<Record<ReaderName, Reading>>,
  cache: Map<string, Candidate | undefined>,
): SpineDecision {
  const confirmed: SpineDecision["confirmed"] = {};
  const top: SpineDecision["top"] = {};
  const readText: SpineDecision["readText"] = {};
  const cands = new Map<string, Candidate>();
  for (const reader of READERS) {
    if (!reads[reader]) continue;
    readText[reader] = variantsOf(reads[reader]).length > 0;
    const c = topFor(db, reads[reader], cache);
    top[reader] = c?.workId ?? null;
    confirmed[reader] = confirms(c) ? c!.workId : null;
    if (c && confirms(c) && !cands.has(c.workId)) cands.set(c.workId, c);
  }
  const votes = new Map<string, ReaderName[]>();
  for (const [reader, w] of Object.entries(confirmed) as [ReaderName, string | null][]) {
    if (w) votes.set(w, [...(votes.get(w) ?? []), reader]);
  }
  const ranked = [...votes.entries()].sort((a, b) => b[1].length - a[1].length);
  const best = ranked[0];
  const unique = best && (ranked.length === 1 || ranked[1]![1].length < best[1].length);
  let accepted: Candidate | null = null;
  let agreeing: ReaderName[] = [];
  let reason: UnknownReason | null = null;
  if (best && best[1].length >= ACCEPT.minReaders && unique) {
    accepted = cands.get(best[0])!;
    agreeing = best[1];
  } else if (!Object.values(readText).some(Boolean)) reason = "no-text";
  else if (votes.size === 0) reason = "no-catalog-match";
  else if (votes.size > 1) reason = "readers-disagree";
  else reason = "single-reader";
  // Hard crop (OC10 rule, served by the local VLM): the two OCR readers have not settled it.
  const hard = !(confirmed.vision && confirmed.vision === confirmed.ppocr);
  return { id, imageId, boxScore, confirmed, top, readText, accepted, agreeing, reason, hard };
}

// --- labels -----------------------------------------------------------------------------------

export function buildLabelSet(
  session: string,
  images: InputImage[],
  dets: Map<string, Detection>,
  decisions: Map<string, SpineDecision>,
): LabelSet {
  const photos: Photo[] = [];
  for (const img of images) {
    const det = dets.get(img.id);
    if (!det) continue;
    const bands = det.bands.map((b, i) => ({ id: `${img.id.slice(0, 12)}:band:${i}`, polygon: b.polygon }));
    const spines = det.spines.map((s, i) => {
      const d = decisions.get(spineId(img.id, i));
      const a = d?.accepted;
      return {
        id: spineId(img.id.slice(0, 12), i),
        polygon: s.polygon,
        kind: "spine" as const,
        text: { title: a?.title ?? "", author: a?.authors.join("; ") ?? "" },
        unreadable: d?.reason === "no-text",
        catalogId: a?.workId ?? null,
        notes: a ? `machine:accepted readers=${d!.agreeing.join("+")}` : `machine:unknown reason=${d?.reason ?? "not-read"}`,
      };
    });
    const placed = assignShelves(bands, spines);
    photos.push({
      hash: img.photoHash,
      setting: img.setting,
      shelfIndex: null,
      width: det.width,
      height: det.height,
      shelfBands: placed.bands,
      spines: placed.spines,
    });
  }
  return { schemaVersion: 1, session, photos };
}

// --- aggregates (the only thing that reaches the repo) ------------------------------------------

const share = (n: number, d: number): number | null => (d === 0 ? null : Math.round((n / d) * 10000) / 10000);
const quantile = (xs: number[], q: number): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))]! * 1000) / 1000;
};

export function machineAgreement(dets: Map<string, Detection>, decisions: SpineDecision[], readings: Map<string, Partial<Record<ReaderName, Reading>>>) {
  const n = decisions.length;
  const pair = (a: ReaderName, b: ReaderName) => {
    const both = decisions.filter((d) => d.confirmed[a] && d.confirmed[b]);
    const read = decisions.filter((d) => a in d.top && b in d.top);
    return {
      spinesReadByBoth: read.length,
      bothConfirmedSomething: both.length,
      sameWork: both.filter((d) => d.confirmed[a] === d.confirmed[b]).length,
      sameWorkShare: share(both.filter((d) => d.confirmed[a] === d.confirmed[b]).length, both.length),
    };
  };
  const reasons: Record<string, number> = {};
  for (const d of decisions) if (d.reason) reasons[d.reason] = (reasons[d.reason] ?? 0) + 1;
  const det = [...dets.values()];
  const bandLength = det.reduce((s, d) => s + d.gaps.bandLength, 0);
  const gapLength = det.reduce((s, d) => s + d.gaps.gapLength, 0);
  const seconds = (r: ReaderName) => {
    const xs = [...readings.values()].map((x) => x[r]?.seconds).filter((x): x is number => typeof x === "number");
    return { cropCount: xs.length, total: Math.round(xs.reduce((a, b) => a + b, 0)), perCropP50: quantile(xs, 0.5) };
  };
  const perReaderConfirmed = Object.fromEntries(
    READERS.map((r) => [r, { read: decisions.filter((d) => r in d.top).length, confirmed: decisions.filter((d) => d.confirmed[r]).length }]),
  );
  const hard = decisions.filter((d) => d.hard);
  return {
    images: det.length,
    spineCount: n,
    spinesPerImage: { p50: quantile(det.map((d) => d.spines.length), 0.5), min: Math.min(...det.map((d) => d.spines.length)), max: Math.max(...det.map((d) => d.spines.length)) },
    boxScore: { p10: quantile(decisions.map((d) => d.boxScore), 0.1), p50: quantile(decisions.map((d) => d.boxScore), 0.5), p90: quantile(decisions.map((d) => d.boxScore), 0.9) },
    catalogConfirmed: { count: decisions.filter((d) => d.accepted).length, share: share(decisions.filter((d) => d.accepted).length, n) },
    agreeingReaders: {
      two: decisions.filter((d) => d.agreeing.length === 2).length,
      three: decisions.filter((d) => d.agreeing.length === 3).length,
    },
    unknownByReason: reasons,
    perReaderConfirmed,
    readerAgreement: { visionPpocr: pair("vision", "ppocr"), visionQwen: pair("vision", "qwen"), ppocrQwen: pair("ppocr", "qwen") },
    hardCrops: { count: hard.length, readByQwen: hard.filter((d) => "qwen" in d.top).length, acceptedAfterQwen: hard.filter((d) => d.agreeing.includes("qwen")).length },
    gaps: { bandLengthPx: Math.round(bandLength), gapLengthPx: Math.round(gapLength), gapShare: share(gapLength, bandLength), gapCount: det.reduce((s, d) => s + d.gaps.gapCount, 0) },
    runtimeSeconds: {
      detectPerImage: { p50: quantile(det.map((d) => d.seconds), 0.5), max: quantile(det.map((d) => d.seconds), 1), total: Math.round(det.reduce((s, d) => s + d.seconds, 0)) },
      vision: seconds("vision"),
      ppocr: seconds("ppocr"),
      qwen: seconds("qwen"),
    },
    memoryMb: {
      detectorPeakRss: Math.max(0, ...det.map((d) => d.peakRssMb ?? 0)) || null,
      detectorPeakMps: Math.max(0, ...det.map((d) => d.mpsPeakMb ?? 0)) || null,
      detectorDevice: [...new Set(det.map((d) => d.device ?? "mps"))].join("+"),
    },
    spendPerSpineUsd: 0,
  };
}

export function stageDir(dataRoot: string, session: string): string {
  const dir = join(dataRoot, "f0", session);
  mkdirSync(dir, { recursive: true });
  return dir;
}
