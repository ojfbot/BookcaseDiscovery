// F-0c runner: the cover-out arm. The cover pass ("book cover.", detect.py post step `covers`) runs on the cached
// default boxes of each set, `kinds` (f0c.ts) gives every box a kind, F-0's readers read the kept covers with the
// cover crop and Qwen's cover prompt, and F-0's unchanged decision and catalog bar identify them.
//
//   node src/eval/f0c-cli.ts detect <set>     # pilot-000 | yardstick: the cover pass on the set's cached boxes
//   node src/eval/f0c-cli.ts read <set>       # Vision, PP-OCR and Qwen (cover prompt) on the kept covers
//   node src/eval/f0c-cli.ts base <set>       # F-0's decisions on the base's cached readings (cached; analyse needs them)
//   node src/eval/f0c-cli.ts analyse          # evals/F0c/{metrics.json,report.md} tables (aggregates only)
//   node src/eval/f0c-cli.ts render           # private render page for pilot-000
//
// Spine boxes keep their cached readings and decisions, so a spine's own outcome cannot change; the arm only adds
// covers and removes boxes (absorbed into a cover, or not a book). Everything per box or per photo stays under the
// data root's `f0c/` and `private/f0c/`; only aggregates reach evals/F0c/.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Candidate } from "../catalog/retrieve.ts";
import { catalogPaths, openCatalog } from "../catalog/cli.ts";
import { dataRoot, ImageStore } from "../ledger/images.ts";
import { COVER_CROP, cropFor, cropName, cropSize } from "../perceive/crop.ts";
import { decide, loadReadings, pyReaderStage, readJsonl, visionStage, type Detection, type InputImage, type Reading, type ReaderName, type SpineDecision } from "./f0.ts";
import { COVER, coverReading, coverText, kinds, NOT_A_BOOK, type Kinds } from "./f0c.ts";
import { agreementChange, titleDelta, type RungCounts, type Tri } from "./f0e.ts";
import { yardstickTruth } from "./q1-cli.ts";
import { clusterBootstrap, quantile, rate, rng } from "./q1.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const ROOT = dataRoot();
const log = (s: string): void => console.error(`[f0c] ${s}`);

export type SetName = "pilot-000" | "yardstick";
/** Each set's default boxes and their cached readings (the base), its catalog and F-0's per-photo Qwen cap. */
export const SETS: Record<SetName, { scope: string; base: string; f0: string; catalog: string; qwenCap: number }> = {
  "pilot-000": {
    scope: "real use (OC35): machine agreement, never accuracy (INV-17)",
    // F-0e's shipped whole-case default (bands+strips), read by F-0's readers with the shipped crop.
    base: join(ROOT, "f0e", "pilot-000", "bands+strips"),
    f0: join(ROOT, "f0", "pilot-000"),
    catalog: catalogPaths().catalog,
    qwenCap: 40,
  },
  yardstick: {
    scope: "PROXY (library shelves): Library Dataset sample, box arm B2; confirmed = accepted and annotated in the image",
    // Shelf-scale photos keep F-0's 3100/1300 grid (F-0e), so F-0's own run is the default.
    base: join(ROOT, "f0", "yardstick-library-b2"),
    f0: join(ROOT, "f0", "yardstick-library-b2"),
    catalog: join(ROOT, "proxy", "library-dataset", "f0-inventory-catalog.sqlite"),
    qwenCap: 15,
  },
};

const stage = (set: SetName) => {
  const dir = join(ROOT, "f0c", set);
  mkdirSync(join(dir, "covers"), { recursive: true });
  return dir;
};
const loadDets = (path: string): Map<string, Detection> => new Map(readJsonl<Detection>(path).filter((d) => !d.error).map((d) => [d.id, d]));

export function imagesOf(set: SetName): InputImage[] {
  const store = new ImageStore(ROOT);
  return [...loadDets(join(SETS[set].base, "detect.jsonl")).keys()].map((id) => {
    const path = set === "pilot-000" ? store.find(id) : join(ROOT, "proxy", "library-dataset", "images", `${id}.jpg`);
    if (!path || !existsSync(path)) throw new Error(`image missing for a cached detection in ${set}`);
    return { id, photoHash: id, path, setting: set };
  });
}

// --- detect: the cover pass on cached boxes ------------------------------------------------------------------

async function detect(set: SetName): Promise<void> {
  const out = join(stage(set), "detect.jsonl");
  const done = new Set(loadDets(out).keys());
  const reqs = imagesOf(set).filter((i) => !done.has(i.id)).map((i) => ({ id: i.id, image: i.path }));
  if (reqs.length === 0) return;
  const helper = join(REPO, "helpers", "label");
  const args = ["run", "--project", helper, "python", join(helper, "detect.py"), "--from", join(SETS[set].base, "detect.jsonl")];
  await new Promise<void>((resolve, reject) => {
    const child = spawn("uv", args, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, F0_ARM: "b2", F0_POST: "covers" } });
    let buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c: string) => {
      buf += c;
      const lines = buf.split("\n");
      buf = lines.pop()!;
      for (const l of lines) if (l.trim()) writeFileSync(out, `${l}\n`, { flag: "a" });
    });
    child.stderr.setEncoding("utf8");
    // Progress lines name the photo by a hash prefix: drop it, as F-0e does.
    child.stderr.on("data", (c: string) => c.split("\n").filter((l) => l.startsWith("detect:")).forEach((l) => log(l.replace(/^detect: [0-9a-f_A-Za-z.-]{6,} /, "detect: ").slice(0, 100))));
    child.stdin.end(reqs.map((r) => `${JSON.stringify(r)}\n`).join(""));
    child.once("error", reject);
    child.once("close", (code) => (code === 0 ? resolve() : reject(new Error(`detect.py exited ${code}`))));
  });
}

// --- read: F-0's readers on the kept covers ------------------------------------------------------------------

/** The cover pass's boxes as a detection whose `spines` are the covers, so F-0's reader stages cut them (id `<image>:<j>`). */
const coverDets = (dets: Map<string, Detection>): Map<string, Detection> => new Map([...dets].map(([id, d]) => [id, { ...d, spines: d.covers ?? [] }]));

/** Kept covers of every photo, as reader ids. */
function keptCovers(dets: Map<string, Detection>): Set<string> {
  const ids = new Set<string>();
  for (const d of dets.values()) for (const c of kinds(d).covers) ids.add(`${d.id}:${c.ref.slice(1)}`);
  return ids;
}

async function read(set: SetName): Promise<void> {
  const dir = stage(set);
  const dets = loadDets(join(dir, "detect.jsonl"));
  const images = imagesOf(set).filter((i) => dets.has(i.id));
  const cd = coverDets(dets);
  const only = keptCovers(dets);
  const covers = join(dir, "covers");
  log(`${set}: ${only.size} kept covers in ${images.length} photos`);
  // Every kept cover goes to all three readers: covers are few, and Qwen is the reader asked for title, author and imprint.
  await visionStage(images, cd, covers, log, COVER_CROP, only);
  log("ppocr: reading covers");
  await pyReaderStage("ppocr", images, cd, covers, log, only, COVER_CROP);
  log("qwen: reading covers (cover prompt)");
  await pyReaderStage("qwen", images, cd, covers, log, only, COVER_CROP, "cover");
}

// --- decisions ------------------------------------------------------------------------------------------------

/** What a decision keeps for the measures (the private cache holds no reader text). */
export interface Slim {
  id: string;
  imageId: string;
  accepted: string | null;
  confirmed: Partial<Record<ReaderName, string | null>>;
  readText: Partial<Record<ReaderName, boolean>>;
  reason: SpineDecision["reason"];
}
const slim = (d: SpineDecision): Slim => ({ id: d.id, imageId: d.imageId, accepted: d.accepted?.workId ?? null, confirmed: d.confirmed, readText: d.readText, reason: d.reason });

/** F-0's decision for every cached spine-path box of the base, from its cached readings (recomputed once, then cached). */
function baseDecisions(set: SetName): Map<string, Slim> {
  const path = join(stage(set), "base-decisions.jsonl");
  if (!existsSync(path)) {
    const db = openCatalog(SETS[set].catalog);
    const readings = loadReadings(SETS[set].base);
    const cache = new Map<string, Candidate | undefined>();
    const out: Slim[] = [];
    for (const d of loadDets(join(SETS[set].base, "detect.jsonl")).values())
      d.spines.forEach((s, i) => out.push(slim(decide(db, `${d.id}:${i}`, d.id, s.boxScore, readings.get(`${d.id}:${i}`) ?? {}, cache))));
    writeFileSync(path, out.map((x) => JSON.stringify(x)).join("\n") + "\n");
    log(`${set}: base decisions recomputed for ${out.length} boxes`);
  }
  return new Map(readJsonl<Slim>(path).map((d) => [d.id, d]));
}

/** F-0's decision on every kept cover (id `<image>:c<j>`), from its cover readings. */
function coverDecisions(set: SetName, dets: Map<string, Detection>): { slim: Map<string, Slim>; full: Map<string, SpineDecision>; readings: Map<string, Partial<Record<ReaderName, Reading>>> } {
  const db = openCatalog(SETS[set].catalog);
  const readings = loadReadings(join(stage(set), "covers"), COVER_CROP);
  const cache = new Map<string, Candidate | undefined>();
  const full = new Map<string, SpineDecision>();
  for (const d of dets.values())
    for (const c of kinds(d).covers) {
      const j = c.ref.slice(1);
      const r = readings.get(`${d.id}:${j}`) ?? {};
      const reads = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, coverReading(v!)])) as Partial<Record<ReaderName, Reading>>;
      full.set(`${d.id}:c${j}`, decide(db, `${d.id}:c${j}`, d.id, c.boxScore, reads, cache));
    }
  return { slim: new Map([...full].map(([k, v]) => [k, slim(v)])), full, readings };
}

// --- analyse: aggregates only ------------------------------------------------------------------------------------

const REPS = 2000;
const r4 = (x: number) => Math.round(x * 10000) / 10000;
const triOf = (b: { value: number; lo: number; hi: number } | null): Tri => (b ? [r4(b.value), r4(b.lo), r4(b.hi)] : null);

/** Photo bootstrap of a mean over photos (paired when the values are per-photo differences). */
export function meanCI(xs: number[], reps = REPS, seed = 1): Tri {
  if (xs.length === 0) return null;
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const rand = rng(seed);
  const draws: number[] = [];
  for (let r = 0; r < reps; r++) draws.push(mean(Array.from({ length: xs.length }, () => xs[Math.floor(rand() * xs.length)]!)));
  draws.sort((a, b) => a - b);
  return [r4(mean(xs)), r4(quantile(draws, 0.025)), r4(quantile(draws, 0.975))];
}

/** Paired photo bootstrap of mean(arm − base) over photos. */
const pairedMean = (base: number[], arm: number[]): Tri => meanCI(arm.map((a, i) => a - base[i]!));

/** Pooled share over rows clustered by photo, with a photo-cluster bootstrap interval. */
const pooledShare = <T extends { imageId: string }>(rows: T[], pred: (r: T) => boolean): Tri => triOf(clusterBootstrap(rows, rate(pred), REPS, 1));

type ArmName = "base" | "filter" | "covers" | "full";
const ARM_NAMES: ArmName[] = ["base", "filter", "covers", "full"];

interface PhotoRow {
  imageId: string;
  arms: Record<ArmName, Slim[]>;
  kinds: Kinds;
  /** Kinds with the cover pass off (the filter's own arm). */
  kindsNoCovers: Kinds;
  coverDecisions: Slim[];
}

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

function photoRows(set: SetName): { rows: PhotoRow[]; dets: Map<string, Detection>; covers: ReturnType<typeof coverDecisions> } {
  const dets = loadDets(join(stage(set), "detect.jsonl"));
  const base = baseDecisions(set);
  const covers = coverDecisions(set, dets);
  const rows = [...dets.values()].map((d): PhotoRow => {
    const k = kinds(d);
    const k0 = kinds({ ...d, covers: [] });
    const at = (i: number) => base.get(`${d.id}:${i}`)!;
    const all = d.spines.map((_, i) => at(i));
    const cov = k.covers.map((c) => covers.slim.get(`${d.id}:c${c.ref.slice(1)}`)!);
    return {
      imageId: d.id,
      kinds: k,
      kindsNoCovers: k0,
      coverDecisions: cov,
      arms: {
        base: all,
        filter: k0.spines.flatMap((b, i) => (b.kind === "spine" ? [all[i]!] : [])),
        covers: [...k.spines.flatMap((b, i) => (b.why !== "absorbed" ? [all[i]!] : [])), ...cov],
        full: [...k.spines.flatMap((b, i) => (b.kind === "spine" ? [all[i]!] : [])), ...cov],
      },
    };
  });
  return { rows, dets, covers };
}

/** Boxes F-0b called lying (the crop wider than tall): the ones its orient step turned and found mostly not spines. */
const f0bLying = (p: Detection["spines"][number]["polygon"]) => {
  const { width, height } = cropSize(p);
  return width > height;
};

function notABookOn(dets: Map<string, Detection>, covers: Map<string, Detection>, decided: Map<string, { accepted: string | null; textRead: boolean }>) {
  const byWhy: Record<string, number> = {};
  let boxes = 0, lying = 0, lyingFlagged = 0, flagged = 0, flaggedConfirmed = 0, flaggedTextRead = 0, lyingConfirmed = 0;
  const lyingByWhy: Record<string, number> = {};
  for (const d of dets.values()) {
    const k = kinds({ ...d, covers: covers.get(d.id)?.covers ?? [] });
    k.spines.forEach((b, i) => {
      boxes++;
      const dec = decided.get(`${d.id}:${i}`);
      const ly = f0bLying(d.spines[i]!.polygon);
      if (ly) lying++;
      if (ly && dec?.accepted) lyingConfirmed++;
      if (b.kind === "spine") return;
      byWhy[b.why] = (byWhy[b.why] ?? 0) + 1;
      flagged++;
      if (dec?.accepted) flaggedConfirmed++;
      if (dec?.textRead) flaggedTextRead++;
      if (ly) {
        lyingFlagged++;
        lyingByWhy[b.why] = (lyingByWhy[b.why] ?? 0) + 1;
      }
    });
  }
  return { boxCount: boxes, removed: flagged, removedByWhy: byWhy, removedConfirmed: flaggedConfirmed, removedTextRead: flaggedTextRead, lying, lyingConfirmed, lyingRemoved: lyingFlagged, lyingRemovedByWhy: lyingByWhy };
}

function secondsOf(dir: string, method?: Parameters<typeof loadReadings>[1]) {
  const r = loadReadings(dir, method);
  const by = (reader: ReaderName) => [...r.values()].map((x) => x[reader]?.seconds).filter((x): x is number => typeof x === "number");
  return Object.fromEntries((["vision", "ppocr", "qwen"] as ReaderName[]).map((k) => {
    const xs = by(k);
    return [k, { reads: xs.length, total: Math.round(xs.reduce((a, b) => a + b, 0)), p50: xs.length ? r4(quantile([...xs].sort((a, b) => a - b), 0.5)) : null }];
  })) as Record<ReaderName, { reads: number; total: number; p50: number | null }>;
}

function analyseSet(set: SetName) {
  const { rows, dets, covers } = photoRows(set);
  const n = rows.length;
  const coverRows = rows.flatMap((r) => r.coverDecisions);
  const perPhoto = (f: (r: PhotoRow) => number) => rows.map(f);
  const rungsOf = (arm: ArmName) => rows.map((r) => rungs(r.imageId, r.arms[arm]));
  const baseWorks = rows.map((r) => works(r.arms.base));
  const coverWorks = rows.map((r) => works(r.coverDecisions));
  const newWorks = rows.map((r, i) => [...coverWorks[i]!].filter((w) => !baseWorks[i]!.has(w)).length);
  // F-0's own run on its own boxes (pilot-000: before F-0e re-tiled), for "missed entirely".
  const f0Works = new Map<string, Set<string>>();
  for (const d of readJsonl<{ imageId: string; accepted: { workId: string } | null }>(join(SETS[set].f0, "decisions.jsonl")))
    if (d.accepted) f0Works.set(d.imageId, (f0Works.get(d.imageId) ?? new Set()).add(d.accepted.workId));
  const newVsF0 = rows.map((r, i) => [...coverWorks[i]!].filter((w) => !baseWorks[i]!.has(w) && !f0Works.get(r.imageId)?.has(w)).length);
  const absorbed = rows.flatMap((r) => r.kinds.spines.flatMap((b, i) => (b.why === "absorbed" ? [r.arms.base[i]!] : [])));
  const dropped: Record<string, number> = {};
  for (const r of rows) for (const b of r.kinds.dropped) dropped[b.why] = (dropped[b.why] ?? 0) + 1;
  const det = [...dets.values()];
  const arms = Object.fromEntries(
    (["filter", "covers", "full"] as const).map((a) => [a, { ...agreementChange(rungsOf("base"), rungsOf(a)), worksLostPerPhoto: meanCI(rows.map((r) => [...works(r.arms.base)].filter((w) => !works(r.arms[a]).has(w)).length)) }]),
  );
  // Not-a-book on the default boxes (the filter arm's flags) and on F-0's original boxes, where F-0b counted its lying boxes.
  const baseDec = new Map([...baseDecisions(set).values()].map((d) => [d.id, { accepted: d.accepted, textRead: isTextRead(d) }]));
  const f0Dets = loadDets(join(SETS[set].f0, "detect.jsonl"));
  const f0Dec = new Map(
    readJsonl<{ id: string; accepted: { workId: string } | null; confirmed: Record<string, string | null> }>(join(SETS[set].f0, "decisions.jsonl")).map((d) => [
      d.id,
      { accepted: d.accepted?.workId ?? null, textRead: Object.values(d.confirmed).some(Boolean) },
    ]),
  );
  const noCovers = new Map<string, Detection>();
  const out: Record<string, unknown> = {
    set,
    scope: SETS[set].scope,
    photos: n,
    spinePathBoxes: rows.reduce((s, r) => s + r.arms.base.length, 0),
    coverPass: {
      prompt: "book cover.",
      tiles: "3100/1300 (shelf scale), every photo",
      candidates: det.reduce((s, d) => s + (d.covers?.length ?? 0), 0),
      dropped,
      kept: coverRows.length,
      keptPerPhoto: meanCI(perPhoto((r) => r.coverDecisions.length)),
      photosWithCover: rows.filter((r) => r.coverDecisions.length > 0).length,
      absorbedSpineBoxes: absorbed.length,
      absorbedConfirmed: absorbed.filter((d) => d.accepted).length,
      absorbedTextRead: absorbed.filter(isTextRead).length,
    },
    covers: {
      count: coverRows.length,
      textPresentShare: pooledShare(coverRows, (d) => d.reason !== "no-text"),
      textReadShare: pooledShare(coverRows, isTextRead),
      confirmedShare: pooledShare(coverRows, (d) => d.accepted !== null),
      confirmed: coverRows.filter((d) => d.accepted).length,
      byReader: Object.fromEntries((["vision", "ppocr", "qwen"] as ReaderName[]).map((k) => [k, { read: coverRows.filter((d) => k in d.readText).length, text: coverRows.filter((d) => d.readText[k]).length, passes: coverRows.filter((d) => d.confirmed[k]).length }])),
      unknownByReason: coverRows.reduce<Record<string, number>>((m, d) => (d.reason ? { ...m, [d.reason]: (m[d.reason] ?? 0) + 1 } : m), {}),
      imprintRead: [...covers.readings.values()].filter((r) => r.qwen?.variants.some((v) => coverText(v.text).imprint)).length,
    },
    newWorks: {
      coverWorksPerPhoto: meanCI(coverWorks.map((w) => w.size)),
      newWorksPerPhoto: meanCI(newWorks),
      newWorksTotal: newWorks.reduce((a, b) => a + b, 0),
      photosWithNewWork: newWorks.filter((x) => x > 0).length,
      newVsF0Original: meanCI(newVsF0),
    },
    arms,
    notABook: {
      defaultBoxes: notABookOn(loadDets(join(SETS[set].base, "detect.jsonl")), noCovers, baseDec),
      defaultBoxesWithCovers: notABookOn(loadDets(join(SETS[set].base, "detect.jsonl")), dets, baseDec),
      f0Boxes: notABookOn(f0Dets, dets, f0Dec),
    },
    runtime: {
      coverPassSecondsPerPhoto: { p50: r4(quantile(det.map((d) => d.coverSeconds ?? 0).sort((a, b) => a - b), 0.5)), mean: meanCI(det.map((d) => d.coverSeconds ?? 0)), total: Math.round(det.reduce((s, d) => s + (d.coverSeconds ?? 0), 0)) },
      coverTilesPerPhoto: r4(det.reduce((s, d) => s + (d.coverTiles ?? 0), 0) / Math.max(1, n)),
      coverReaders: secondsOf(join(stage(set), "covers"), COVER_CROP),
      baseDetectSecondsPerPhoto: r4(quantile(det.map((d) => d.seconds - (d.coverSeconds ?? 0)).sort((a, b) => a - b), 0.5)),
      baseReaders: secondsOf(SETS[set].base),
    },
  };
  if (set === "yardstick") {
    const truth = yardstickTruth();
    const counts = (arm: ArmName | "coverOnly"): [number, number, number][] =>
      rows.map((r) => {
        const t = truth.get(r.imageId) ?? new Set<string>();
        const w = works(arm === "coverOnly" ? r.coverDecisions : r.arms[arm]);
        return [t.size, [...w].filter((x) => t.has(x)).length, w.size];
      });
    const base = counts("base");
    const side = (c: [number, number, number][]) => ({ annotated: c.reduce((s, x) => s + x[0], 0), hits: c.reduce((s, x) => s + x[1], 0), accepted: c.reduce((s, x) => s + x[2], 0) });
    const cov = counts("coverOnly");
    out.yardstickTitles = {
      base: side(base),
      coverOnly: { ...side(cov), wrong: cov.reduce((s, x) => s + x[2] - x[1], 0), newHits: rows.reduce((s, r, i) => s + [...works(r.coverDecisions)].filter((w) => truth.get(r.imageId)?.has(w) && !baseWorks[i]!.has(w)).length, 0) },
      arms: Object.fromEntries(
        (["filter", "covers", "full"] as const).map((a) => {
          const c = counts(a);
          return [a, { ...side(c), delta: titleDelta(base, c), hitsPerImage: pairedMean(base.map((x) => x[1]), c.map((x) => x[1])), wrongPerImage: pairedMean(base.map((x) => x[2] - x[1]), c.map((x) => x[2] - x[1])) }];
        }),
      ),
    };
  }
  return out;
}

/** The pre-registered keep rules (evals/F0c/report.md), applied to the measures. */
export function verdicts(pilot: any, yard: any) {
  const excludes0Up = (t: Tri) => t !== null && t[1] > 0;
  const notDown = (t: Tri) => t === null || t[2] >= 0;
  const notUp = (t: Tri) => t === null || t[1] <= 0;
  const yardOk = (a: string) => notDown(yard.yardstickTitles.arms[a].hitsPerImage) && notUp(yard.yardstickTitles.arms[a].wrongPerImage) && notDown(yard.yardstickTitles.arms[a].delta?.precision ?? null);
  const coverPass = {
    pilotNewWorks: excludes0Up(pilot.arms.covers.delta.worksPerPhoto),
    yardstickUnhurt: yardOk("covers"),
  };
  const filter = {
    pilotWorksNotDown: notDown(pilot.arms.filter.delta.worksPerPhoto),
    yardstickUnhurt: yardOk("filter"),
  };
  return {
    coverPass: { ...coverPass, ship: coverPass.pilotNewWorks && coverPass.yardstickUnhurt },
    notABookFilter: { ...filter, ship: filter.pilotWorksNotDown && filter.yardstickUnhurt },
  };
}

function analyse(): void {
  const pilot = analyseSet("pilot-000");
  const yard = analyseSet("yardstick");
  const metrics = { runId: "F0c", card: "F-0c", date: new Date().toLocaleDateString("en-CA"), rules: { COVER, NOT_A_BOOK }, coverCrop: cropName(COVER_CROP), "pilot-000": pilot, yardstick: yard, verdicts: verdicts(pilot, yard) };
  const out = join(REPO, "evals", "F0c");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
  const report = join(out, "report.md");
  const marker = /<!-- tables -->[\s\S]*<!-- \/tables -->/;
  const prev = existsSync(report) ? readFileSync(report, "utf8") : "# F0c: cover-out arm (F-0c)\n\n<!-- tables --><!-- /tables -->\n";
  writeFileSync(report, prev.replace(marker, `<!-- tables -->\n${tablesMd(metrics)}<!-- /tables -->`));
  log("evals/F0c/ written (aggregates only)");
}

const pc = (t: Tri | undefined): string => (t ? `${(t[0] * 100).toFixed(1)} % (${(t[1] * 100).toFixed(1)}–${(t[2] * 100).toFixed(1)})` : "n/a");
const num = (t: Tri | undefined, d = 2): string => (t ? `${t[0].toFixed(d)} (${t[1].toFixed(d)} to ${t[2].toFixed(d)})` : "n/a");
const sgn = (t: Tri | undefined, k = 1, d = 2, u = ""): string => (t ? `${t[0] >= 0 ? "+" : ""}${(t[0] * k).toFixed(d)}${u} (${(t[1] * k).toFixed(d)} to ${(t[2] * k).toFixed(d)})` : "n/a");

export function tablesMd(m: any): string {
  const out: string[] = [];
  for (const set of ["pilot-000", "yardstick"] as const) {
    const s = m[set];
    const title = set === "pilot-000" ? "`pilot-000` (real use; machine agreement, never accuracy, INV-17)" : "Yardstick (PROXY, library shelves; evaluation only)";
    out.push(`### ${title}\n`);
    out.push(`${s.photos} photos, ${s.spinePathBoxes} spine-path boxes (the default's cached boxes and readings).\n`);
    const cp = s.coverPass;
    out.push("| cover pass | value |\n|---|---:|");
    out.push(`| cover-prompt boxes (cover-shaped, after NMS) | ${cp.candidates} |`);
    out.push(`| dropped: not cover-shaped or sized / a group of spines | ${cp.dropped["cover-shape"] ?? 0} / ${cp.dropped["cover-group"] ?? 0} |`);
    out.push(`| **face-out boxes kept, per photo** | **${num(cp.keptPerPhoto)}** (${cp.kept} in ${cp.photosWithCover} photos) |`);
    out.push(`| spine-path boxes absorbed into a cover (of them confirmed / at \`text-read\`) | ${cp.absorbedSpineBoxes} (${cp.absorbedConfirmed} / ${cp.absorbedTextRead}) |`);
    const c = s.covers;
    out.push(`| covers with text (\`text-present\`) | ${pc(c.textPresentShare)} |`);
    out.push(`| **covers at \`text-read\`** (a reader's top candidate passes the bar) | **${pc(c.textReadShare)}** |`);
    out.push(`| **covers confirmed** (two readers, one work, the bar) | **${pc(c.confirmedShare)}** (${c.confirmed}) |`);
    out.push(`| per reader: read / with text / top candidate passes | ${Object.entries(c.byReader).map(([k, v]: [string, any]) => `${k} ${v.read}/${v.text}/${v.passes}`).join(", ")} |`);
    out.push(`| covers left unknown, by reason | ${Object.entries(c.unknownByReason).map(([k, v]) => `${k} ${v}`).join(", ") || "none"} |`);
    out.push(`| covers with an imprint read by Qwen | ${c.imprintRead} |`);
    out.push(`| confirmed works from covers, per photo | ${num(s.newWorks.coverWorksPerPhoto)} |`);
    out.push(`| **new works per photo** (confirmed from a cover, by no spine box of the default) | **${num(s.newWorks.newWorksPerPhoto)}** (${s.newWorks.newWorksTotal} in ${s.newWorks.photosWithNewWork} photos) |`);
    out.push(`| new works per photo, also missed by F-0's original run | ${num(s.newWorks.newVsF0Original)} |`);
    out.push("");
    out.push("Arms against the default, paired photo bootstrap (95 %). *filter*: not-a-book boxes removed (cover pass off); *covers*: covers added and the spine-path boxes they absorb removed; *full*: both.\n");
    out.push("| arm | boxes per photo | `text-read` share | confirmed share | confirmed boxes per photo | **distinct confirmed works per photo** | works lost per photo |\n|---|---:|---:|---:|---:|---:|---:|");
    for (const a of ["filter", "covers", "full"]) {
      const d = s.arms[a].delta;
      out.push(`| ${a} | ${sgn(d.boxesPerPhoto)} | ${sgn(d.textReadShare, 100, 1, " pts")} | ${sgn(d.confirmedShare, 100, 1, " pts")} | ${sgn(d.confirmedPerPhoto)} | **${sgn(d.worksPerPhoto)}** | ${num(s.arms[a].worksLostPerPhoto)} |`);
    }
    out.push("");
    if (s.yardstickTitles) {
      const y = s.yardstickTitles;
      out.push(`Yardstick titles (image level, against the annotation): base ${y.base.hits} of ${y.base.annotated} annotated works found, ${y.base.accepted} accepted. Covers alone: ${y.coverOnly.accepted} accepted, ${y.coverOnly.hits} annotated (${y.coverOnly.newHits} not found by a spine box), ${y.coverOnly.wrong} wrong.\n`);
      out.push("| arm | hits / accepted | Δ title recall | Δ title precision | Δ confirmed works per image | Δ wrong accepts per image |\n|---|---:|---:|---:|---:|---:|");
      for (const a of ["filter", "covers", "full"]) {
        const t = y.arms[a];
        out.push(`| ${a} | ${t.hits} / ${t.accepted} | ${sgn(t.delta?.recall, 100, 1, " pts")} | ${sgn(t.delta?.precision, 100, 1, " pts")} | ${sgn(t.hitsPerImage)} | ${sgn(t.wrongPerImage)} |`);
      }
      out.push("");
    }
    out.push("Not-a-book flags (counts; *removed confirmed* is a lower bound on real books wrongly removed, *at `text-read`* an upper hint):\n");
    out.push("| boxes | boxes | removed | by rule | removed confirmed | removed at `text-read` | F-0b lying boxes | lying removed | lying removed by rule | lying confirmed |\n|---|---:|---:|---|---:|---:|---:|---:|---|---:|");
    for (const [k, label] of [["defaultBoxes", "default, cover pass off"], ["defaultBoxesWithCovers", "default, with covers"], ["f0Boxes", "F-0's original boxes, with covers"]] as const) {
      const x = s.notABook[k];
      const why = (o: Record<string, number>) => Object.entries(o).map(([a, b]) => `${a} ${b}`).join(", ") || "none";
      out.push(`| ${label} | ${x.boxCount} | ${x.removed} | ${why(x.removedByWhy)} | ${x.removedConfirmed} | ${x.removedTextRead} | ${x.lying} | ${x.lyingRemoved} | ${why(x.lyingRemovedByWhy)} | ${x.lyingConfirmed} |`);
    }
    out.push("");
    const rt = s.runtime;
    const rd = (o: any) => Object.entries(o).map(([k, v]: [string, any]) => `${k} ${v.total} s / ${v.reads} crops (p50 ${v.p50} s)`).join("; ");
    out.push(`Runtime: cover pass p50 ${rt.coverPassSecondsPerPhoto.p50} s a photo (mean ${num(rt.coverPassSecondsPerPhoto.mean, 1)}; ${rt.coverTilesPerPhoto} tiles a photo), against the default's detection p50 ${rt.baseDetectSecondsPerPhoto} s. Cover readers: ${rd(rt.coverReaders)}. The default's readers: ${rd(rt.baseReaders)}.\n`);
  }
  const v = m.verdicts;
  out.push(`### Keep rules\n\n| rule | pilot-000 | yardstick | ships |\n|---|---|---|---|`);
  out.push(`| cover pass | new works per photo excludes 0 upward: ${v.coverPass.pilotNewWorks ? "yes" : "no"} | not hurt: ${v.coverPass.yardstickUnhurt ? "yes" : "no"} | **${v.coverPass.ship ? "yes" : "no"}** |`);
  out.push(`| not-a-book filter | works per photo not down: ${v.notABookFilter.pilotWorksNotDown ? "yes" : "no"} | not hurt: ${v.notABookFilter.yardstickUnhurt ? "yes" : "no"} | **${v.notABookFilter.ship ? "yes" : "no"}** |\n`);
  return out.join("\n") + "\n";
}

// --- render: the private review page -------------------------------------------------------------------------------

/** Private: per photo, every box with its kind, and each kept cover's crop, reads and decision (pilot-000 only). */
async function render(set: SetName = "pilot-000"): Promise<void> {
  const { rows, dets, covers } = photoRows(set);
  const images = new Map(imagesOf(set).map((i) => [i.id, i.path]));
  const priv = join(ROOT, "private", "f0c");
  mkdirSync(priv, { recursive: true });
  const spec = join(priv, `render-${set}.jsonl`);
  const lines = rows.map((r, n) => {
    const d = dets.get(r.imageId)!;
    const baseWorks = works(r.arms.base);
    return JSON.stringify({
      n: n + 1,
      image: images.get(r.imageId),
      width: d.width,
      height: d.height,
      spines: r.kinds.spines.map((b, i) => ({ polygon: b.polygon, kind: b.kind, why: b.why, confirmed: r.arms.base[i]!.accepted !== null })),
      dropped: r.kinds.dropped.map((b) => ({ polygon: b.polygon, why: b.why })),
      covers: r.kinds.covers.map((c) => {
        const j = c.ref.slice(1);
        const dec = covers.full.get(`${r.imageId}:c${j}`)!;
        const reads = covers.readings.get(`${r.imageId}:${j}`) ?? {};
        const crop = cropFor(d.covers![Number(j)]!, d, COVER_CROP);
        return {
          ref: c.ref,
          polygon: c.polygon,
          boxScore: c.boxScore,
          crop: crop && { polygon: crop.polygon, rotations: crop.rotations },
          absorbed: r.kinds.spines.filter((b) => b.absorbedBy === c.ref).length,
          reads: Object.fromEntries(
            Object.entries(reads).map(([k, v]) => [k, v!.error ? `error: ${v!.error}` : v!.variants.map((x) => `${x.rotation}°: ${x.text.replace(/\s+/g, " ").trim()}`).join(" | ")]),
          ),
          qwen: reads.qwen ? coverText(reads.qwen.variants[0]?.text ?? "") : null,
          top: dec.top,
          confirmed: dec.confirmed,
          accepted: dec.accepted && { title: dec.accepted.title, authors: dec.accepted.authors, score: dec.accepted.score, agreeing: dec.agreeing },
          reason: dec.reason,
          newWork: dec.accepted !== null && !baseWorks.has(dec.accepted.workId),
        };
      }),
    });
  });
  writeFileSync(spec, lines.join("\n") + "\n");
  const helper = join(REPO, "helpers", "label");
  const out = join(priv, "renders", set);
  const args = ["run", "--project", helper, "python", "-I", join(helper, "render_f0c.py"), "--spec", spec, "--out", out, "--label", set];
  await new Promise<void>((resolve, reject) => spawn("uv", args, { stdio: ["ignore", "ignore", "inherit"] }).once("close", (c) => (c === 0 ? resolve() : reject(new Error(`render exited ${c}`)))));
  log(`render written under the data root's private/f0c/renders/${set}/`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, set] = process.argv.slice(2) as [string, SetName];
  if (cmd === "detect") await detect(set);
  else if (cmd === "read") await read(set);
  else if (cmd === "base") baseDecisions(set);
  else if (cmd === "analyse") analyse();
  else if (cmd === "render") await render(set ?? "pilot-000");
  else {
    console.error("usage: node src/eval/f0c-cli.ts detect|read <pilot-000|yardstick> | analyse | render");
    process.exit(2);
  }
}
