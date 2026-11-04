// F-0j runner: zone each book region (F-0i's partition), read each text line at 48 px, and decide with the lines in
// each OCR reader's one vote (arm A), then with fields (arms B, C). Pre-registered in evals/F0j/report.md; design
// docs/models/per-book-extraction.md §5–§6.
//
//   node src/eval/f0j-cli.ts zone <set>        # helpers/label/zone.py: lines, neighbour shares, mosaics (CPU, niced)
//   node src/eval/f0j-cli.ts lines <set>       # Vision and PP-OCR on every kept line of a read region (line;h=48)
//   node src/eval/f0j-cli.ts run <set> <arm>   # arm: a0 (base) | a (lines); Qwen's selection re-run, missing reads read
//   node src/eval/f0j-cli.ts analyse           # evals/F0j/{metrics.json,report.md}: aggregates only
//
// Sets (OC35, never merged): pilot-000 and the yardstick, each on F-0i's kept boxes. Everything per box, line or
// photo goes under the data root's `private/f0j/`.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openCatalog } from "../catalog/cli.ts";
import type { Candidate } from "../catalog/retrieve.ts";
import { dataRoot } from "../ledger/images.ts";
import { cropFor, cropName, F0_CROP, LINE_CROP } from "../perceive/crop.ts";
import { groupLines, keptLines, multiBook, nonTextZones, ZONE } from "../perceive/zones.ts";
import { confirms, decide, loadReadings, pyReaderStage, readJsonl, READERS, topFor, visionStage, type Detection, type InputImage, type ReaderName, type Reading } from "./f0.ts";
import { SETS as F0B_SETS, cost, delta, firstPassHard, geometry, type Geo, type Pair } from "./f0b-cli.ts";
import { lineId, lineVariants, loroSummary, withLines, type LoroOutcome, type PageRecord, type ZoneRecord } from "./f0j.ts";
import { compactJson, outcomeOf, yardstickTruth } from "./q1-cli.ts";
import { clusterBootstrap, type Outcome } from "./q1.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const ROOT = dataRoot();
const PRIV = join(ROOT, "private", "f0j");
const REPS = 2000;
const log = (s: string): void => console.error(`[f0j] ${s}`);

export type SetName = "pilot-000" | "yardstick-library-b2";
interface SetCfg { stage: string; images: string; partition: string; labels: string }
const SETS: Record<SetName, SetCfg> = {
  "pilot-000": {
    stage: join(ROOT, "f0e", "pilot-000", "bands+strips"),
    images: join(ROOT, "private", "h2", "pilot-000", "images.jsonl"),
    partition: join(ROOT, "private", "f0i", "pilot-000", "partition.jsonl"),
    labels: join(ROOT, "private", "f0i", "pilot-000", "labels"),
  },
  "yardstick-library-b2": {
    stage: join(ROOT, "f0", "yardstick-library-b2"),
    images: join(ROOT, "private", "h2", "yardstick-library-b2", "images.jsonl"),
    partition: join(ROOT, "private", "f0i", "yardstick-library-b2", "partition.jsonl"),
    labels: join(ROOT, "private", "f0i", "yardstick-library-b2", "labels"),
  },
};
const isSet = (s: string | undefined): s is SetName => s === "pilot-000" || s === "yardstick-library-b2";
export const ARMS = ["a0", "a"] as const;
type Arm = (typeof ARMS)[number];

// --- inputs ----------------------------------------------------------------------------------------------

function py(): string {
  const p = join(REPO, "helpers", "label", ".venv", "bin", "python");
  if (!existsSync(p)) throw new Error("helpers/label has no .venv: run `uv sync` there first");
  return p;
}

const split = (id: string): [string, number] => {
  const k = id.lastIndexOf(":");
  return [id.slice(0, k), Number(id.slice(k + 1))];
};

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

interface PartRow { id: string; state: "kept" | "dropped"; role: "member" | "remainder" | "group-child"; changed: boolean; flagged: boolean }

/** F-0i's kept boxes: the regions. */
function regionsOf(set: SetName): Map<string, PartRow> {
  if (!existsSync(SETS[set].partition)) throw new Error(`${set}: no F-0i partition`);
  return new Map(readJsonl<PartRow>(SETS[set].partition).filter((r) => r.state === "kept").map((r) => [r.id, r]));
}

/** zone.py's records of the photos it finished (a photo cut short is zoned again). */
function loadZones(set: SetName): { regions: Map<string, ZoneRecord>; pages: PageRecord[]; done: Set<string> } {
  const dir = join(PRIV, set, "zones");
  const rows = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".jsonl")).flatMap((f) => readJsonl<Record<string, unknown>>(join(dir, f))) : [];
  const done = new Set(rows.filter((r) => r.photoDone).map((r) => r.photoDone as string));
  const regions = new Map<string, ZoneRecord>();
  const pages: PageRecord[] = [];
  for (const r of rows) {
    if (r.page && done.has(r.photo as string)) pages.push(r as unknown as PageRecord);
    else if (r.id && done.has(split(r.id as string)[0])) regions.set(r.id as string, r as unknown as ZoneRecord);
  }
  return { regions, pages, done };
}

/** One region's plan (pre-registered): kept lines, groups in reading order, the multi-book flag, read or not. */
export function planRegion(z: ZoneRecord | undefined) {
  if (!z || z.error) return { kept: [], groups: [], multiBook: false, read: false, order: [] as string[], minLine: null as number | null, column: false };
  const kept = keptLines(z.lines);
  const groups = groupLines(kept);
  const mb = multiBook(groups);
  const byK = new Map(z.lines.map((l) => [l.k, l]));
  return {
    kept,
    groups,
    multiBook: mb,
    read: kept.length > 0 && !mb,
    order: groups.flatMap((g) => g.lines.map((k) => lineId(byK.get(k)!))),
    minLine: kept.length ? Math.min(...kept.map((l) => l.h)) : null,
    column: kept.some((l) => l.column),
  };
}

// --- zone --------------------------------------------------------------------------------------------------

function runPy(script: string, args: string[], requests: object[], out: string): Promise<void> {
  if (requests.length === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const child = spawn("nice", ["-n", "10", py(), "-I", join(REPO, "helpers", "label", script), ...args], { stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop()!;
      const keep = lines.filter((l) => l.trim().startsWith("{"));
      if (keep.length) appendFileSync(out, keep.join("\n") + "\n");
    });
    let tail = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      tail = (tail + chunk).slice(-2000);
      for (const l of chunk.split("\n")) if (/^zone:/.test(l)) log(l);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(requests.map((r) => `${JSON.stringify(r)}\n`).join(""));
    child.once("error", reject);
    child.once("close", (code) => (code === 0 ? resolve() : reject(new Error(`${script} exited ${code}: ${tail.split("\n").slice(-4).join(" | ")}`))));
  });
}

async function zone(set: SetName): Promise<void> {
  const dets = loadDets(set);
  const regions = regionsOf(set);
  const images = new Map(inputImages(set, dets).map((x) => [x.id, x.path]));
  const { done } = loadZones(set);
  const reqs = [...dets.values()]
    .filter((d) => !done.has(d.id))
    .map((d) => {
      const labels = join(SETS[set].labels, `${d.id}.png`);
      return {
        photo: d.id,
        image: images.get(d.id)!,
        labels: existsSync(labels) ? labels : null,
        regions: d.spines.flatMap((s, i) => (regions.has(`${d.id}:${i}`) ? [{ id: `${d.id}:${i}`, index: i, polygon: cropFor(s, d, F0_CROP)!.polygon }] : [])),
      };
    })
    .filter((r) => r.regions.length > 0)
    .slice(0, Number(process.env.F0J_LIMIT ?? Infinity)); // F0J_LIMIT=1: the crash-only smoke run (first photo)
  const dir = join(PRIV, set, "zones");
  mkdirSync(join(PRIV, set, "mosaics"), { recursive: true });
  mkdirSync(dir, { recursive: true });
  const workers = Math.max(1, Number(process.env.F0J_ZONE_WORKERS ?? 3));
  const shards: (typeof reqs)[] = Array.from({ length: workers }, () => []);
  reqs.forEach((r, i) => shards[i % workers]!.push(r));
  log(`${set}: zoning ${reqs.reduce((s, r) => s + r.regions.length, 0)} regions on ${reqs.length} photos, ${workers} workers`);
  const t0 = Date.now();
  await Promise.all(shards.map((s, k) => runPy("zone.py", ["--out", join(PRIV, set, "mosaics")], s, join(dir, `zones-${k}.jsonl`))));
  log(`${set}: zoned in ${Math.round((Date.now() - t0) / 1000)} s`);
}

// --- lines -------------------------------------------------------------------------------------------------

/** The mosaic pages as detections whose spines are the line cells (ids `page:cell`), for the unchanged readers. */
function lineInputs(set: SetName, zones: ReturnType<typeof loadZones>) {
  const cells = new Map<string, { polygon: [number, number][]; column: boolean }[]>();
  for (const z of zones.regions.values())
    for (const l of z.lines) {
      const [x, y, w, h] = l.rect;
      const arr = cells.get(l.page) ?? [];
      arr[l.cell] = { polygon: [[x, y], [x + w - 1, y], [x + w - 1, y + h - 1], [x, y + h - 1]], column: l.column };
      cells.set(l.page, arr);
    }
  const dets = new Map<string, Detection>();
  const images: InputImage[] = [];
  for (const p of zones.pages) {
    const spines = (cells.get(p.page) ?? []).map((c) => ({ polygon: c.polygon as Detection["spines"][number]["polygon"], column: c.column, boxScore: 0, maskScore: 0, aspect: 0, cut: false }));
    dets.set(p.page, { id: p.page, width: p.width, height: p.height, spines, bands: [], gaps: { bandLength: 0, gapLength: 0, gapCount: 0, medianWidth: 0 }, tiles: 0, seconds: 0 });
    images.push({ id: p.page, photoHash: p.page, path: p.path, setting: set });
  }
  return { dets, images };
}

async function lines(set: SetName): Promise<void> {
  const zones = loadZones(set);
  const only = new Set<string>();
  for (const z of zones.regions.values()) {
    const plan = planRegion(z);
    if (plan.read) plan.order.forEach((id) => only.add(id));
  }
  const { dets, images } = lineInputs(set, zones);
  const dir = join(PRIV, set, "lines");
  mkdirSync(dir, { recursive: true });
  log(`${set}: ${only.size} lines on ${images.length} pages, crop ${cropName(LINE_CROP)}`);
  const t0 = Date.now();
  await visionStage(images, dets, dir, log, LINE_CROP, only);
  log(`${set}: vision lines done in ${Math.round((Date.now() - t0) / 1000)} s`);
  await pyReaderStage("ppocr", images, dets, dir, log, only, LINE_CROP);
  log(`${set}: lines done in ${Math.round((Date.now() - t0) / 1000)} s`);
}

// --- run: one arm over every region ------------------------------------------------------------------------

type Reads = Partial<Record<ReaderName, Reading>>;

/** Each region's whole-crop readings and, for arm A, its OCR readers' line variants (one vote per reader). */
function armReads(set: SetName, arm: Arm, ids: Iterable<string>): Map<string, Reads> {
  const whole = loadReadings(SETS[set].stage);
  const out = new Map<string, Reads>();
  const zones = arm === "a" ? loadZones(set) : null;
  const lr = arm === "a" ? loadReadings(join(PRIV, set, "lines"), LINE_CROP) : null;
  for (const id of ids) {
    const w = whole.get(id) ?? {};
    const r: Reads = { vision: w.vision, ppocr: w.ppocr };
    if (zones && lr) {
      const z = zones.regions.get(id);
      if (!z && zones.done.has(split(id)[0]) === false) throw new Error(`${set}: region not zoned; run \`f0j-cli.ts zone ${set}\``);
      const plan = planRegion(z);
      if (plan.read)
        for (const reader of ["vision", "ppocr"] as const) r[reader] = withLines(w[reader], lineVariants(plan.order, (lid) => lr.get(lid)?.[reader]), reader, id);
    }
    out.set(id, r);
  }
  return out;
}

const workOf = (d: { accepted: string | { workId: string } | null } | undefined): string | null =>
  !d?.accepted ? null : typeof d.accepted === "string" ? d.accepted : d.accepted.workId;

async function run(set: SetName, arm: Arm): Promise<void> {
  const cfg = F0B_SETS[set];
  const dets = loadDets(set);
  const images = inputImages(set, dets);
  const regions = regionsOf(set);
  const ids = [...regions.keys()];
  const reads = armReads(set, arm, ids);
  const whole = loadReadings(SETS[set].stage);
  const db = openCatalog(cfg.catalog);
  const cache = new Map<string, Candidate | undefined>();
  const score = new Map([...dets.values()].flatMap((d) => d.spines.map((s, i): [string, number] => [`${d.id}:${i}`, s.boxScore])));
  const t0 = Date.now();
  const first = new Map(ids.map((id) => [id, decide(db, id, split(id)[0], score.get(id)!, { vision: reads.get(id)!.vision, ppocr: reads.get(id)!.ppocr }, cache)]));
  // F-0's Qwen selection per photo on F-0i's kept boxes, re-run under this arm's first pass.
  const selected = new Set<string>();
  for (const img of images)
    ids
      .filter((id) => split(id)[0] === img.id && firstPassHard(first.get(id)!))
      .sort((a, b) => score.get(b)! - score.get(a)!)
      .slice(0, cfg.qwenCap)
      .forEach((id) => selected.add(id));
  const qdir = join(PRIV, set, "whole");
  mkdirSync(qdir, { recursive: true });
  const have = new Set([...whole.entries()].filter(([, r]) => r.qwen).map(([id]) => id));
  for (const [id, r] of loadReadings(qdir, F0_CROP)) if (r.qwen) have.add(id);
  const needed = new Set([...selected].filter((id) => !have.has(id)));
  log(`${set} ${arm}: qwen selects ${selected.size}; ${needed.size} without a cached spine read`);
  if (needed.size) await pyReaderStage("qwen", images.filter((x) => [...needed].some((id) => split(id)[0] === x.id)), dets, qdir, log, needed, F0_CROP);
  const extra = loadReadings(qdir, F0_CROP);
  const qwenOf = (id: string) => extra.get(id)?.qwen ?? whole.get(id)?.qwen;
  const dir = join(PRIV, set, arm);
  mkdirSync(dir, { recursive: true });
  const rows: string[] = [];
  for (const id of ids) {
    const r: Reads = { ...reads.get(id)! };
    if (selected.has(id)) r.qwen = qwenOf(id);
    const d = decide(db, id, split(id)[0], score.get(id)!, r, cache);
    const w = workOf(d);
    let viaPass2: ReaderName[] = [];
    let loro: Partial<Record<ReaderName, LoroOutcome>> | undefined;
    if (w) {
      // Agreement only through pass 2: an agreeing reader whose whole-crop reading alone would not confirm the work.
      viaPass2 = d.agreeing.filter((k) => {
        const c = topFor(db, k === "qwen" ? r.qwen : whole.get(id)?.[k], cache);
        return !(confirms(c) && c!.workId === w);
      });
      loro = {};
      for (const k of READERS) {
        if (!r[k]) continue;
        const rest = { ...r };
        delete rest[k];
        const x = workOf(decide(db, id, split(id)[0], score.get(id)!, rest, cache));
        loro[k] = x === null ? "none" : x === w ? "same" : "other";
      }
    }
    rows.push(JSON.stringify({ id, imageId: split(id)[0], accepted: w, agreeing: d.agreeing, reason: d.reason, confirmed: d.confirmed, readText: d.readText, qwenSelected: selected.has(id), viaPass2, ...(loro ? { loro } : {}) }));
  }
  writeFileSync(join(dir, "decisions.jsonl"), rows.join("\n") + "\n");
  log(`${set} ${arm}: ${rows.length} regions decided in ${Math.round((Date.now() - t0) / 1000)} s`);
}

// --- analysis ------------------------------------------------------------------------------------------------

const textRead = (o: Outcome) => o !== "unknown:no-text";
const confirmed = (o: Outcome) => o === "confirmed";
const wrong = (o: Outcome) => o === "rejected/wrong";

interface Dec { id: string; imageId: string; accepted: string | null; agreeing: ReaderName[]; reason: string | null; qwenSelected: boolean; viaPass2: ReaderName[]; loro?: Partial<Record<ReaderName, LoroOutcome>> }

function decisions(set: SetName, arm: string): Map<string, Dec> | null {
  const p = join(PRIV, set, arm, "decisions.jsonl");
  return existsSync(p) ? new Map(readJsonl<Dec>(p).map((d) => [d.id, d])) : null;
}

const asDecision = (d: Dec) => ({ id: d.id, imageId: d.imageId, accepted: d.accepted ? { workId: d.accepted } : null, reason: d.reason });

function analyse(): void {
  const truth = yardstickTruth();
  const sets: Record<string, any> = {};
  for (const set of Object.keys(SETS) as SetName[]) {
    const tr = set === "pilot-000" ? undefined : truth;
    const dets = loadDets(set);
    const regions = regionsOf(set);
    const ids = [...regions.keys()];
    const zones = loadZones(set);
    const plans = new Map(ids.map((id) => [id, planRegion(zones.regions.get(id))]));
    const geo = new Map(geometry(dets).map((g): [string, Geo] => [g.id, g]));
    const base = decisions(set, "a0");
    const zoneStats = zoneSummary(ids, zones, plans, regions);
    const out: Record<string, any> = { scope: F0B_SETS[set].scope, regions: ids.length, zones: zoneStats, arms: {} as Record<string, unknown> };
    for (const arm of ARMS.filter((a) => a !== "a0")) {
      const aft = decisions(set, arm);
      if (!base || !aft) continue;
      const pairs = (sel: (id: string) => boolean): Pair[] =>
        ids.filter(sel).map((id) => ({ id, imageId: split(id)[0], before: outcomeOf(asDecision(base.get(id)!), tr?.get(split(id)[0])), after: outcomeOf(asDecision(aft.get(id)!), tr?.get(split(id)[0])) }));
      const summary = (rs: Pair[], seed: number) => ({
        boxCount: rs.length,
        photos: new Set(rs.map((r) => r.imageId)).size,
        textRead: delta(rs, textRead, seed),
        confirmed: delta(rs, confirmed, seed + 1),
        ...(tr ? { wrong: delta(rs, wrong, seed + 2) } : {}),
      });
      const p = (id: string) => plans.get(id)!;
      const strata: Record<string, (id: string) => boolean> = {
        "read by pass 2": (id) => p(id).read,
        "not read (no line or multi-book)": (id) => !p(id).read,
        "smallest line < 32 px": (id) => p(id).read && p(id).minLine! < ZONE.smallLine,
        "smallest line ≥ 32 px": (id) => p(id).read && p(id).minLine! >= ZONE.smallLine,
        "with a column line": (id) => p(id).read && p(id).column,
        "no column line": (id) => p(id).read && !p(id).column,
        "contrast < 60": (id) => p(id).read && (zones.regions.get(id)?.contrast ?? 0) < 60,
        "contrast ≥ 60": (id) => p(id).read && (zones.regions.get(id)?.contrast ?? 0) >= 60,
        "whole boxes": (id) => !geo.get(id)!.piece,
        "cut or partial boxes": (id) => geo.get(id)!.piece,
      };
      let works: unknown = null;
      if (!tr) {
        const rows = ids.map((id) => ({ imageId: split(id)[0], b: base.get(id)!.accepted, a: aft.get(id)!.accepted }));
        const count = (rs: typeof rows, k: "a" | "b") => new Set(rs.flatMap((r) => (r[k] ? [`${r.imageId}\u0000${r[k]}`] : []))).size;
        const d = clusterBootstrap(rows, (rs) => count(rs, "a") - count(rs, "b"), REPS, 61);
        works = { before: count(rows, "b"), after: count(rows, "a"), delta: d && { value: d.value, lo: d.lo, hi: d.hi } };
      }
      const accepts = [...aft.values()].filter((d) => d.accepted);
      const loro = loroSummary(accepts.flatMap((d) => Object.values(d.loro ?? {})));
      const lines = loadReadings(join(PRIV, set, "lines"), LINE_CROP);
      const lineIds = ids.flatMap((id) => (p(id).read ? p(id).order : []));
      out.arms[arm] = {
        all: summary(pairs(() => true), 11),
        strata: Object.fromEntries(Object.entries(strata).map(([k, f], i) => [k, summary(pairs(f), 21 + 3 * i)])),
        ...(works ? { distinctConfirmedWorks: works } : {}),
        accepts: accepts.length,
        acceptsOnlyThroughPass2: accepts.filter((d) => d.viaPass2.length > 0).length,
        loro,
        cost: {
          lines: cost(lines, lineIds, () => false),
          qwenSelected: { before: [...base.values()].filter((d) => d.qwenSelected).length, after: [...aft.values()].filter((d) => d.qwenSelected).length },
        },
      };
    }
    sets[set] = out;
  }
  const verdict = Object.fromEntries(ARMS.filter((a) => a !== "a0").map((a) => [a, verdictOf(sets, a)]));
  const m = {
    runId: "F0j",
    card: "F-0j",
    date: new Date().toLocaleDateString("en-CA"),
    regions: "F-0i's kept boxes (partition geometry cache), detection rectangles",
    wholeCrop: cropName(F0_CROP),
    lineCrop: cropName(LINE_CROP),
    zoner: "PP-OCRv5_server_det (CPU, PaddleX defaults), native resolution; roles src/perceive/zones.ts",
    bootstrap: { unit: "photo (cluster), paired: the same regions in A0 and the arm", reps: REPS, interval: "95 % percentile", units: "percentage points (works: count)" },
    keepRule: "pilot-000 confirmed interval excludes 0 upward; pilot-000 distinct works not down; yardstick confirmed not down and wrong not up beyond their intervals; leave one reader out switches at most 5 % of (accept, reader) cases to another work on each set",
    verdict,
    sets,
  };
  const dir = join(REPO, "evals", "F0j");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "metrics.json"), compactJson(m) + "\n");
  const reportPath = join(dir, "report.md");
  const head = readFileSync(reportPath, "utf8").split(MARKER)[0]!;
  writeFileSync(reportPath, head.trimEnd() + "\n\n" + MARKER + "\n\n" + tables(m) + "\n");
  log("aggregates -> evals/F0j/{metrics.json,report.md}");
}

/** Zoning counts per set, and the quality signal for F-0i (no-line and multi-book regions by F-0i role). */
function zoneSummary(ids: string[], zones: ReturnType<typeof loadZones>, plans: Map<string, ReturnType<typeof planRegion>>, regions: Map<string, PartRow>) {
  const z = (id: string) => zones.regions.get(id);
  const zoned = ids.filter((id) => z(id) && !z(id)!.error);
  const all = zoned.flatMap((id) => z(id)!.lines);
  const kept = zoned.flatMap((id) => plans.get(id)!.kept);
  const noLine = zoned.filter((id) => plans.get(id)!.kept.length === 0);
  const mb = zoned.filter((id) => plans.get(id)!.multiBook);
  const byRole = (xs: string[]) => {
    const o: Record<string, number> = {};
    for (const id of xs) {
      const r = regions.get(id)!;
      const k = `${r.role}${r.changed ? ", changed" : ""}${r.flagged ? ", flagged" : ""}`;
      o[k] = (o[k] ?? 0) + 1;
    }
    return o;
  };
  const nonText = zoned.map((id) => nonTextZones(z(id)!.profile, z(id)!.frame.W));
  const secs = zoned.map((id) => z(id)!.seconds).sort((a, b) => a - b);
  return {
    zoned: zoned.length,
    errors: ids.filter((id) => z(id)?.error).length,
    notZoned: ids.filter((id) => !z(id)).length,
    linesDetected: all.length,
    linesNeighbour: all.filter((l) => l.neighbour > ZONE.neighbourMax).length,
    linesKept: kept.length,
    noiseDropped: zoned.reduce((s, id) => s + z(id)!.noise, 0),
    linesPerRegion: zoned.length ? kept.length / zoned.length : null,
    linesUnder32: kept.filter((l) => l.h < 32).length,
    columnLines: kept.filter((l) => l.column).length,
    noLine: noLine.length,
    multiBook: mb.length,
    read: zoned.filter((id) => plans.get(id)!.read).length,
    groupsPerReadRegion: (() => {
      const r = zoned.filter((id) => plans.get(id)!.read);
      return r.length ? r.reduce((s, id) => s + plans.get(id)!.groups.length, 0) / r.length : null;
    })(),
    noLineByF0iRole: byRole(noLine),
    multiBookByF0iRole: byRole(mb),
    art: nonText.filter((n) => n.art).length,
    imprintLogoEnds: nonText.reduce((s, n) => s + n.imprintLogo.filter(Boolean).length, 0),
    cost: { regionSecondsP50: secs.length ? secs[Math.floor(secs.length / 2)] : null, regionSecondsTotal: Math.round(secs.reduce((a, b) => a + b, 0)) },
  };
}

/** The pre-registered keep rule for one arm (evals/F0j/report.md). */
export function verdictOf(sets: Record<string, any>, arm: string) {
  const p = sets["pilot-000"]?.arms[arm], y = sets["yardstick-library-b2"]?.arms[arm];
  if (!p || !y) return null;
  const rule = {
    pilotConfirmedExcludesZero: !!p.all.confirmed && p.all.confirmed.lo > 0,
    pilotDistinctWorksNotDown: !!p.distinctConfirmedWorks?.delta && p.distinctConfirmedWorks.delta.value >= 0,
    yardstickConfirmedNotDown: !!y.all.confirmed && y.all.confirmed.hi >= 0,
    yardstickWrongNotUp: !!y.all.wrong && y.all.wrong.lo <= 0,
    leaveOneReaderOut: [p, y].every((s) => s.loro.otherShare === null || s.loro.otherShare <= 0.05),
  };
  return { keep: Object.values(rule).every(Boolean), ...rule };
}

const MARKER = "<!-- generated by src/eval/f0j-cli.ts analyse: edit above this line -->";

function tables(m: { verdict: Record<string, any>; sets: Record<string, any> }): string {
  type D = { before: number; after: number; delta: number; lo: number; hi: number } | null | undefined;
  const fmt = (d: D) => (d ? `${d.before} → ${d.after} (${d.delta >= 0 ? "+" : ""}${d.delta}; ${d.lo} to ${d.hi})` : "—");
  const pc = (x: number | null | undefined, k = 1) => (x === null || x === undefined ? "—" : `${(x * 100).toFixed(k)} %`);
  const out: string[] = [];
  const names = Object.keys(m.sets);
  const col = (f: (s: any) => string) => names.map((n) => f(m.sets[n])).join(" | ");
  out.push("## Zoning, both sets", "", `| figure | ${names.map((n) => (n === "pilot-000" ? "`pilot-000`" : "yardstick (PROXY)")).join(" | ")} |`, `|---|${names.map(() => "---:").join("|")}|`);
  const z = (s: any) => s.zones;
  out.push(
    `| regions (F-0i kept boxes) / zoned / errors | ${col((s) => `${s.regions} / ${z(s).zoned} / ${z(s).errors}`)} |`,
    `| lines detected / a neighbour's (dropped) / noise (dropped) | ${col((s) => `${z(s).linesDetected} / ${z(s).linesNeighbour} / ${z(s).noiseDropped}`)} |`,
    `| lines kept / per region | ${col((s) => `${z(s).linesKept} / ${z(s).linesPerRegion?.toFixed(2) ?? "—"}`)} |`,
    `| kept lines under 32 px / column lines | ${col((s) => `${z(s).linesUnder32} / ${z(s).columnLines}`)} |`,
    `| **no-line regions** (not read) | ${col((s) => `${z(s).noLine} (${pc(z(s).noLine / Math.max(1, z(s).zoned))})`)} |`,
    `| **multi-book regions** (handed back, not read) | ${col((s) => `${z(s).multiBook} (${pc(z(s).multiBook / Math.max(1, z(s).zoned))})`)} |`,
    `| regions read by pass 2 / groups per read region | ${col((s) => `${z(s).read} / ${z(s).groupsPerReadRegion?.toFixed(2) ?? "—"}`)} |`,
    `| art zones / imprint-logo ends (reported only) | ${col((s) => `${z(s).art} / ${z(s).imprintLogoEnds}`)} |`,
    `| zone-det seconds per region (p50) / total | ${col((s) => `${z(s).cost.regionSecondsP50} / ${z(s).cost.regionSecondsTotal}`)} |`,
    "",
    "Quality signal for F-0i (regions by F-0i role):",
    "",
  );
  for (const n of names) {
    const f = (o: Record<string, number>) => Object.entries(o).sort().map(([k, v]) => `${k} ${v}`).join("; ") || "none";
    out.push(`- ${n}: no-line ${f(m.sets[n].zones.noLineByF0iRole)}. Multi-book ${f(m.sets[n].zones.multiBookByF0iRole)}.`);
  }
  out.push("");
  for (const [set, s] of Object.entries(m.sets)) {
    const yard = set !== "pilot-000";
    for (const [arm, x] of Object.entries<any>(s.arms)) {
      out.push(`## ${set}: arm \`${arm}\` against A0 (${s.scope})`, "",
        `${x.all.boxCount} regions. Shares in % of them, A0 → arm (Δ points; 95 % paired photo-bootstrap interval).`, "",
        `| regions | n | photos | text read | confirmed |${yard ? " wrong |" : ""}`, `|---|---:|---:|---|---|${yard ? "---|" : ""}`);
      const row = (label: string, r: any) => `| ${label} | ${r.boxCount} | ${r.photos} | ${fmt(r.textRead)} | ${fmt(r.confirmed)} |${yard ? ` ${fmt(r.wrong)} |` : ""}`;
      out.push(row("**all**", x.all), ...Object.entries<any>(x.strata).map(([k, r]) => row(`  ${k}`, r)), "");
      if (x.distinctConfirmedWorks) {
        const d = x.distinctConfirmedWorks;
        out.push(`Distinct confirmed works (per photo, summed): ${d.before} → ${d.after} (${d.delta ? `${d.delta.value >= 0 ? "+" : ""}${d.delta.value}; ${d.delta.lo} to ${d.delta.hi}` : "—"}).`, "");
      }
      const l = x.loro;
      out.push(
        `Accepts: ${x.accepts}; through pass 2 only (an agreeing reader's whole-crop reading alone would not confirm the work): ${x.acceptsOnlyThroughPass2}.`,
        `Leave one reader out: ${l.cases} (accept, reader) cases; same work ${l.same}, **another work ${l.other} (${pc(l.otherShare)}; Wilson upper ${pc(l.otherWilsonUpper)})**, abstains ${l.none}.`,
        `Line reads: Vision ${x.cost.lines.vision.calls} calls, ${x.cost.lines.vision.seconds} s; PP-OCR ${x.cost.lines.ppocr.calls} calls, ${x.cost.lines.ppocr.seconds} s. Qwen-selected regions: ${x.cost.qwenSelected.before} → ${x.cost.qwenSelected.after}.`,
        "",
      );
    }
  }
  const yn = (b: boolean | undefined) => (b ? "yes" : "no");
  out.push("## Verdict", "", "| arm | pilot confirmed up | pilot works not down | yardstick confirmed not down | yardstick wrong not up | leave one reader out ≤ 5 % | keep |", "|---|---|---|---|---|---|---|");
  for (const [arm, v] of Object.entries<any>(m.verdict)) {
    if (!v) out.push(`| ${arm} | — | — | — | — | — | not run |`);
    else out.push(`| ${arm} | ${yn(v.pilotConfirmedExcludesZero)} | ${yn(v.pilotDistinctWorksNotDown)} | ${yn(v.yardstickConfirmedNotDown)} | ${yn(v.yardstickWrongNotUp)} | ${yn(v.leaveOneReaderOut)} | **${v.keep ? "keep" : "off"}** |`);
  }
  return out.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, set, arg] = process.argv.slice(2);
  if (cmd === "zone" && isSet(set)) await zone(set);
  else if (cmd === "lines" && isSet(set)) await lines(set);
  else if (cmd === "run" && isSet(set) && (ARMS as readonly string[]).includes(arg ?? "")) await run(set, arg as Arm);
  else if (cmd === "analyse") analyse();
  else {
    console.error("usage: f0j-cli.ts zone|lines <set> | run <set> <a0|a> | analyse   (set: pilot-000 | yardstick-library-b2)");
    process.exit(2);
  }
}
