// F-0j runner: zone each book region (F-0i's partition), read each text line at 48 px, and decide with the lines in
// each OCR reader's one vote (arm A), then with fields (arms B, C). Pre-registered in evals/F0j/report.md; design
// docs/models/per-book-extraction.md §5–§6.
//
//   node src/eval/f0j-cli.ts zone <set>        # helpers/label/zone.py: lines, neighbour shares, mosaics (CPU, niced)
//   node src/eval/f0j-cli.ts lines <set>       # Vision and PP-OCR on every kept line of a read region (line;h=48)
//   node src/eval/f0j-cli.ts run <set> <arm>   # arm: a0 (base) | a (lines) | b (fields) | c (Qwen fields, after `fields`)
//   node src/eval/f0j-cli.ts fields <set>      # helpers/label/fields.py on arm B's selection and F-0d's no-text control (GPU)
//   node src/eval/f0j-cli.ts render <set>      # private review page: zones, fields, decisions per arm
//   node src/eval/f0j-cli.ts analyse           # evals/F0j/{metrics.json,report.md}: aggregates only
//
// Sets (OC35, never merged): pilot-000 and the yardstick, each on F-0i's kept boxes. Everything per box, line or
// photo goes under the data root's `private/f0j/`.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openCatalog } from "../catalog/cli.ts";
import { normalize, surnameFirstToGivenFirst } from "../catalog/normalize.ts";
import type { Candidate } from "../catalog/retrieve.ts";
import { dataRoot } from "../ledger/images.ts";
import { cropFor, cropName, F0_CROP, LINE_CROP } from "../perceive/crop.ts";
import { assignRoles, groupLines, keptLines, multiBook, nonTextZones, ZONE } from "../perceive/zones.ts";
import type { OcrFields } from "../ledger/helper-contracts.ts";
import { confirms, decide, loadReadings, pyReaderStage, rankedFor, readJsonl, READERS, topFor, variantsOf, visionStage, vote, type Detection, type InputImage, type ReaderName, type ReaderVotes, type Reading } from "./f0.ts";
import { SETS as F0B_SETS, cost, delta, geometry, type Geo, type Pair } from "./f0b-cli.ts";
import { authorIndex, fieldMatches, fieldVote, isAuthorText, lineId, linesText, lineVariants, loroSummary, withLines, wonWith, type FieldVote, type Fields, type LoroOutcome, type PageRecord, type ZoneRecord } from "./f0j.ts";
import { compactJson, outcomeOf, parseCsv, yardstickTruth } from "./q1-cli.ts";
import { clusterBootstrap, rng, type Outcome } from "./q1.ts";

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
export const ARMS = ["a0", "a", "b", "c"] as const;
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

function runPy(script: string, args: string[], requests: object[], out: string, niced = true): Promise<void> {
  if (requests.length === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cmd = [py(), "-I", join(REPO, "helpers", "label", script), ...args];
    const child = niced ? spawn("nice", ["-n", "10", ...cmd], { stdio: ["pipe", "pipe", "pipe"] }) : spawn(cmd[0]!, cmd.slice(1), { stdio: ["pipe", "pipe", "pipe"] });
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
      for (const l of chunk.split("\n")) if (/^(zone|fields):/.test(l)) log(l);
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
const OCR = ["vision", "ppocr"] as const;

/** A Qwen field read (fields.py) per rotation: its transcript as text, its checked fields. */
interface FieldRead {
  id: string;
  variants: { rotation: number; text?: string; confidence?: number; fields?: OcrFields; rejected?: string[]; error?: string }[];
  tokens?: number;
  seconds: number;
  error?: string;
}

/** Everything an arm decides from, loaded once per set. */
function context(set: SetName, arm: Arm) {
  const cfg = F0B_SETS[set];
  const dets = loadDets(set);
  const regions = regionsOf(set);
  const ids = [...regions.keys()];
  const whole = loadReadings(SETS[set].stage);
  const db = openCatalog(cfg.catalog);
  const lined = arm !== "a0";
  const zones = lined ? loadZones(set) : null;
  if (zones) for (const id of ids) if (!zones.done.has(split(id)[0])) throw new Error(`${set}: photo not zoned; run \`f0j-cli.ts zone ${set}\``);
  const lineReads = lined ? loadReadings(join(PRIV, set, "lines"), LINE_CROP) : new Map<string, Reads>();
  const plans = new Map(ids.map((id) => [id, planRegion(zones?.regions.get(id))]));
  const score = new Map([...dets.values()].flatMap((d) => d.spines.map((s, i): [string, number] => [`${d.id}:${i}`, s.boxScore])));
  const fieldPath = join(PRIV, set, "fields", "qwen.jsonl");
  const fieldReads = new Map(readJsonl<FieldRead>(fieldPath).filter((r) => !r.error).map((r) => [r.id, r]));
  return {
    set, arm, cfg, dets, regions, ids, whole, db, zones, lineReads, plans, score, fieldReads,
    images: inputImages(set, dets),
    cache: new Map<string, Candidate | undefined>(),
    ranked: new Map<string, Candidate[]>(),
    authors: arm === "b" || arm === "c" ? authorIndex(db) : null,
  };
}
type Ctx = ReturnType<typeof context>;

/** A line's reading by one reader. */
const lineRead = (c: Ctx, k: ReaderName) => (lid: string) => c.lineReads.get(lid)?.[k];

/** A region's OCR readings in an arm: whole crop, plus (arms A–C) its line variants in the same vote. */
function ocrReads(c: Ctx, id: string): Reads {
  const w = c.whole.get(id) ?? {};
  const r: Reads = { vision: w.vision, ppocr: w.ppocr };
  const plan = c.plans.get(id)!;
  if (c.arm !== "a0" && plan.read) for (const k of OCR) r[k] = withLines(w[k], lineVariants(plan.order, lineRead(c, k)), k, id);
  return r;
}

/** A Qwen field read as a reading (its transcripts are its variants) and the fields of the rotation that won. */
function qwenFieldReading(f: FieldRead): Reading {
  return { id: f.id, reader: "qwen", variants: f.variants.filter((v) => v.text !== undefined).map((v) => ({ rotation: v.rotation, text: v.text!, confidence: v.confidence ?? 0 })), seconds: f.seconds };
}

interface ReaderInfo { path: FieldVote["path"]; counter: boolean; fields: Fields | null }
interface Decided {
  accepted: string | null;
  agreeing: ReaderName[];
  reason: string | null;
  hard: boolean;
  confirmed: Partial<Record<ReaderName, string | null>>;
  readText: Partial<Record<ReaderName, boolean>>;
  info?: Partial<Record<ReaderName, ReaderInfo>>;
  roles?: { title: boolean; author: boolean };
}

/**
 * Arms B and C (pre-registered): each OCR reader's fields from the zoner's roles (the author role read from the
 * remaining OCR readers' text), each reader's vote by the field rule, then F-0's vote. Qwen votes by its whole string
 * in B, by its own fields in C. `drop` leaves one reader out, with its line reads and fields.
 */
function fieldDecide(c: Ctx, id: string, r: Reads, qwen: Reading | FieldRead | undefined, drop?: ReaderName): Decided {
  const plan = c.plans.get(id)!;
  const z = c.zones?.regions.get(id);
  const ocr = OCR.filter((k) => k !== drop && r[k]);
  const ranked: Partial<Record<ReaderName, Candidate[]>> = {};
  for (const k of ocr) ranked[k] = rankedFor(c.db, r[k], c.ranked);
  const fields: Partial<Record<ReaderName, Fields>> = {};
  let roles: Decided["roles"];
  if (plan.read && z) {
    const byK = new Map(z.lines.map((l) => [l.k, l]));
    const groupIds = plan.groups.map((g) => g.lines.map((k) => lineId(byK.get(k)!)));
    const rot = Object.fromEntries(ocr.map((k) => [k, wonWith(plan.order, lineRead(c, k), variantsOf(r[k])[ranked[k]![0]?.variant ?? -1])]));
    const textOf = (k: ReaderName, g: number) => linesText(groupIds[g]!, lineRead(c, k), rot[k]!);
    const ro = assignRoles(plan.groups, z.frame.W, (g) => ocr.some((k) => isAuthorText(c.authors!, textOf(k, g))));
    roles = { title: ro.title !== null, author: ro.author !== null };
    for (const k of ocr) fields[k] = { title: ro.title !== null ? textOf(k, ro.title) || null : null, author: ro.author !== null ? textOf(k, ro.author) || null : null };
  }
  if (drop !== "qwen" && qwen) {
    if (c.arm === "c") {
      const f = qwen as FieldRead;
      const reading = qwenFieldReading(f);
      ranked.qwen = rankedFor(c.db, reading, c.ranked);
      const winner = variantsOf(reading)[ranked.qwen[0]?.variant ?? -1];
      const v = f.variants.find((x) => winner !== undefined && (x.text ?? "").replace(/\s+/g, " ").trim() === winner) ?? f.variants.find((x) => x.fields?.title.text);
      if (v?.fields) fields.qwen = { title: v.fields.title.text, author: v.fields.author.text };
      r = { ...r, qwen: reading };
    } else ranked.qwen = rankedFor(c.db, qwen as Reading, c.ranked);
  }
  const votes: ReaderVotes = { readText: {}, top: {}, confirmed: {} };
  const info: Partial<Record<ReaderName, ReaderInfo>> = {};
  for (const k of READERS) {
    const rk = ranked[k];
    if (!rk) continue;
    votes.readText[k] = variantsOf(k === "qwen" && r.qwen ? r.qwen : r[k]).length > 0 || rk.length > 0;
    votes.top[k] = rk[0]?.workId ?? null;
    const fv = fieldVote(c.db, rk, fields[k] ?? null);
    votes.confirmed[k] = fv.work;
    info[k] = { path: fv.path, counter: fv.counter, fields: fields[k] ?? null };
  }
  const v = vote(votes);
  return { accepted: v.acceptedId, agreeing: v.agreeing, reason: v.reason, hard: v.hard, confirmed: votes.confirmed, readText: votes.readText, info, ...(roles ? { roles } : {}) };
}

/** One region under one arm; `drop` leaves a reader out (leave one reader out). */
function decideArm(c: Ctx, id: string, qwenOn: boolean, drop?: ReaderName): Decided {
  const r = ocrReads(c, id);
  const qwen = !qwenOn ? undefined : c.arm === "c" ? c.fieldReads.get(id) : qwenSpine(c, id);
  if (c.arm === "a0" || c.arm === "a") {
    const reads: Reads = { ...r, ...(qwen ? { qwen: qwen as Reading } : {}) };
    if (drop) delete reads[drop];
    const d = decide(c.db, id, split(id)[0], c.score.get(id)!, reads, c.cache);
    return { accepted: d.accepted?.workId ?? null, agreeing: d.agreeing, reason: d.reason, hard: d.hard, confirmed: d.confirmed, readText: d.readText };
  }
  return fieldDecide(c, id, r, qwen, drop);
}

let spineCache: Map<string, Reads> | null = null;
/** Qwen's spine-prompt reading of a region: F-0e's cached one, else this card's (`private/f0j/<set>/whole`). */
function qwenSpine(c: Ctx, id: string): Reading | undefined {
  spineCache ??= loadReadings(join(PRIV, c.set, "whole"), F0_CROP);
  return spineCache.get(id)?.qwen ?? c.whole.get(id)?.qwen;
}

/** F-0's Qwen selection per photo on F-0i's kept boxes, under this arm's first pass (Vision and PP-OCR only). */
function selection(c: Ctx): Set<string> {
  const hard = new Map(c.ids.map((id) => {
    const d = decideArm(c, id, false);
    return [id, d.hard && Boolean(d.readText.vision || d.readText.ppocr)];
  }));
  const selected = new Set<string>();
  for (const img of c.images)
    c.ids
      .filter((id) => split(id)[0] === img.id && hard.get(id))
      .sort((a, b) => c.score.get(b)! - c.score.get(a)!)
      .slice(0, c.cfg.qwenCap)
      .forEach((id) => selected.add(id));
  return selected;
}

/** Read Qwen's spine prompt where a selected region has no cached read (GPU). */
async function readSpines(c: Ctx, selected: Set<string>): Promise<void> {
  const needed = new Set([...selected].filter((id) => !qwenSpine(c, id)));
  log(`${c.set} ${c.arm}: qwen selects ${selected.size}; ${needed.size} without a cached spine read`);
  if (!needed.size) return;
  const qdir = join(PRIV, c.set, "whole");
  mkdirSync(qdir, { recursive: true });
  await pyReaderStage("qwen", c.images.filter((x) => [...needed].some((id) => split(id)[0] === x.id)), c.dets, qdir, log, needed, F0_CROP);
  spineCache = null;
}

async function run(set: SetName, arm: Arm): Promise<void> {
  const c = context(set, arm);
  const t0 = Date.now();
  // Arm C reads on arm B's selection (pre-registered); every other arm selects under its own first pass.
  const selected = arm === "c" ? new Set(readJsonl<{ id: string }>(join(PRIV, set, "b", "selection.jsonl")).map((x) => x.id)) : selection(c);
  if (arm === "c" && selected.size === 0) throw new Error(`${set}: run arm b first (its selection)`);
  if (arm !== "c") await readSpines(c, selected);
  if (arm === "c") {
    const missing = [...selected].filter((id) => !c.fieldReads.has(id));
    if (missing.length) throw new Error(`${set}: ${missing.length} selected regions have no field read; run \`f0j-cli.ts fields ${set}\``);
  }
  const dir = join(PRIV, set, arm);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "selection.jsonl"), [...selected].map((id) => JSON.stringify({ id })).join("\n") + "\n");
  const rows: string[] = [];
  for (const id of c.ids) {
    const on = selected.has(id);
    const d = decideArm(c, id, on);
    let viaPass2: ReaderName[] = [];
    let loro: Partial<Record<ReaderName, LoroOutcome>> | undefined;
    let match: Partial<Record<ReaderName, { title: boolean | null; author: boolean | null }>> | undefined;
    if (d.accepted) {
      // Agreement only through pass 2: an agreeing reader whose whole-crop spine reading alone would not confirm the work.
      viaPass2 = d.agreeing.filter((k) => {
        const top = topFor(c.db, k === "qwen" ? qwenSpine(c, id) : c.whole.get(id)?.[k], c.cache);
        return !(confirms(top) && top!.workId === d.accepted);
      });
      loro = {};
      for (const k of READERS) {
        if (!d.readText[k] && !(k in d.confirmed)) continue;
        const x = decideArm(c, id, on, k).accepted;
        loro[k] = x === null ? "none" : x === d.accepted ? "same" : "other";
      }
      if (d.info) match = Object.fromEntries(Object.entries(d.info).filter(([, i]) => i?.fields).map(([k, i]) => [k, fieldMatches(c.db, d.accepted!, i!.fields!)]));
    }
    const info = d.info && Object.fromEntries(Object.entries(d.info).map(([k, i]) => [k, { path: i!.path, counter: i!.counter, title: Boolean(i!.fields?.title), author: Boolean(i!.fields?.author) }]));
    rows.push(JSON.stringify({ id, imageId: split(id)[0], accepted: d.accepted, agreeing: d.agreeing, reason: d.reason, confirmed: d.confirmed, readText: d.readText, qwenSelected: on, viaPass2, ...(loro ? { loro } : {}), ...(info ? { info } : {}), ...(d.roles ? { roles: d.roles } : {}), ...(match ? { match } : {}) }));
  }
  writeFileSync(join(dir, "decisions.jsonl"), rows.join("\n") + "\n");
  log(`${set} ${arm}: ${rows.length} regions decided in ${Math.round((Date.now() - t0) / 1000)} s`);
}

// --- fields: Qwen's transcript-first field read (GPU) ---------------------------------------------------------

/** F-0d's no-text control boxes that are regions here (invented-field control). */
function controlIds(set: SetName, regions: Map<string, PartRow>): string[] {
  const p = join(ROOT, "private", "f0d", set, "selection.jsonl");
  return readJsonl<{ id: string; role: string }>(p).filter((r) => r.role === "no-text" && regions.has(r.id)).map((r) => r.id);
}

async function fields(set: SetName): Promise<void> {
  const c = context(set, "b");
  const sel = join(PRIV, set, "b", "selection.jsonl");
  const want = new Set(existsSync(sel) ? readJsonl<{ id: string }>(sel).map((x) => x.id) : selection(c));
  for (const id of controlIds(set, c.regions)) want.add(id);
  const dir = join(PRIV, set, "fields");
  mkdirSync(dir, { recursive: true });
  const out = join(dir, "qwen.jsonl");
  const have = new Set(readJsonl<FieldRead>(out).filter((r) => !r.error).map((r) => r.id));
  const paths = new Map(c.images.map((x) => [x.id, x.path]));
  const reqs = [...want].filter((id) => !have.has(id)).sort().map((id) => {
    const [p, i] = split(id);
    const d = c.dets.get(p)!;
    const cr = cropFor(d.spines[i]!, d, F0_CROP)!;
    return { id, image: paths.get(p)!, polygon: cr.polygon, rotations: cr.rotations, minLine: c.plans.get(id)!.minLine, crop: cr.crop };
  });
  log(`${set}: field reads for ${want.size} regions; ${reqs.length} to read`);
  const t0 = Date.now();
  await runPy("fields.py", [], reqs, out, false);
  log(`${set}: field reads done in ${Math.round((Date.now() - t0) / 1000)} s`);
}

// --- render: the private review page ------------------------------------------------------------------------

async function render(set: SetName): Promise<void> {
  const decs = Object.fromEntries(ARMS.map((a) => [a, decisions(set, a)] as const).filter(([, d]) => d)) as Record<string, Map<string, Dec>>;
  if (!decs.a0) throw new Error(`${set}: run arm a0 first`);
  const c = context(set, decs.c ? "c" : "b");
  const rand = rng(20261104);
  const changed = c.ids.filter((id) => Object.values(decs).some((d) => d.get(id)?.accepted !== decs.a0!.get(id)?.accepted));
  const mb = c.ids.filter((id) => c.plans.get(id)!.multiBook).slice(0, 60);
  const none = c.ids.filter((id) => c.zones!.regions.get(id) && c.plans.get(id)!.kept.length === 0).slice(0, 40);
  const read = c.ids.filter((id) => c.plans.get(id)!.read && !changed.includes(id));
  const sample = read.map((id) => [rand(), id] as const).sort((a, b) => a[0] - b[0]).slice(0, 80).map(([, id]) => id);
  const pick = [...new Map([...changed.slice(0, 300).map((id) => [id, "outcome changed"]), ...mb.map((id) => [id, "multi-book"]), ...none.map((id) => [id, "no line"]), ...sample.map((id) => [id, "sample"])] as [string, string][]).entries()];
  const work = c.db.prepare("SELECT title, authors FROM works WHERE id = ?");
  const label = (d: Dec | undefined) => {
    if (!d) return "—";
    if (!d.accepted) return `unknown: ${d.reason}`;
    const w = work.get(d.accepted) as { title: string; authors: string } | undefined;
    return w ? `${w.title} — ${(JSON.parse(w.authors) as string[]).join("; ")} (${d.agreeing.join("+")})` : d.accepted;
  };
  const paths = new Map(c.images.map((x) => [x.id, x.path]));
  const items = pick.map(([id, why]) => {
    const [p, i] = split(id);
    const d = c.dets.get(p)!;
    const z = c.zones!.regions.get(id);
    const plan = c.plans.get(id)!;
    const roleOf = new Map<number, string>();
    let fields: Record<string, Fields | null> = {};
    if (z && plan.groups.length) {
      const byK = new Map(z.lines.map((l) => [l.k, l]));
      const groupIds = plan.groups.map((g) => g.lines.map((k) => lineId(byK.get(k)!)));
      const ro = assignRoles(plan.groups, z.frame.W, (g) => OCR.some((k) => isAuthorText(c.authors!, linesText(groupIds[g]!, lineRead(c, k), "best"))));
      plan.groups.forEach((g, gi) => g.lines.forEach((k) => roleOf.set(k, gi === ro.title ? "title" : gi === ro.author ? "author" : ro.imprint.includes(gi) ? "imprint" : "unassigned")));
      const sel = decs.c?.get(id)?.qwenSelected ?? decs.b?.get(id)?.qwenSelected;
      const info = fieldDecide(c, id, ocrReads(c, id), sel ? (c.arm === "c" ? c.fieldReads.get(id) : qwenSpine(c, id)) : undefined).info ?? {};
      fields = Object.fromEntries(Object.entries(info).map(([k, x]) => [k, x?.fields ?? null]));
    }
    const lines = (z?.lines ?? []).map((l) => ({ quad: l.quad, role: l.neighbour > ZONE.neighbourMax ? "neighbour" : roleOf.get(l.k) ?? "unassigned" }));
    const flags = [plan.multiBook ? "multi-book" : "", z && plan.kept.length === 0 ? "no line" : "", plan.column ? "column line" : "", z && nonTextZones(z.profile, z.frame.W).art ? "art" : ""].filter(Boolean);
    return { id, image: paths.get(p)!, polygon: cropFor(d.spines[i]!, d, F0_CROP)!.polygon, lines, flags, fields, decisions: Object.fromEntries(Object.entries(decs).map(([a, m]) => [a, label(m.get(id))])), why };
  });
  const dir = join(PRIV, "renders", set);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "items.jsonl"), items.map((x) => JSON.stringify(x)).join("\n") + "\n");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(py(), ["-I", join(REPO, "helpers", "label", "render_f0j.py"), "--items", join(dir, "items.jsonl"), "--out", dir, "--label", set], { stdio: ["ignore", "inherit", "inherit"] });
    child.once("close", (code) => (code === 0 ? resolve() : reject(new Error(`render_f0j.py exited ${code}`))));
  });
  log(`render under the data root's private/f0j/renders/${set}/index.html (${items.length} regions)`);
}

// --- analysis ------------------------------------------------------------------------------------------------

const textRead = (o: Outcome) => o !== "unknown:no-text";
const confirmed = (o: Outcome) => o === "confirmed";
const wrong = (o: Outcome) => o === "rejected/wrong";

interface Dec {
  id: string;
  imageId: string;
  accepted: string | null;
  agreeing: ReaderName[];
  reason: string | null;
  qwenSelected: boolean;
  confirmed?: Partial<Record<ReaderName, string | null>>;
  viaPass2: ReaderName[];
  loro?: Partial<Record<ReaderName, LoroOutcome>>;
  info?: Partial<Record<ReaderName, { path: FieldVote["path"]; counter: boolean; title: boolean; author: boolean }>>;
  roles?: { title: boolean; author: boolean };
  match?: Partial<Record<ReaderName, { title: boolean | null; author: boolean | null }>>;
}

/** Annotated author surnames per yardstick image, as F-0's author accuracy reads them (src/eval/f0-cli.ts). */
function yardstickSurnames(): Map<string, Set<string>> {
  const lib = join(ROOT, "proxy", "library-dataset");
  const cleanAuthor = (a: string) => surnameFirstToGivenFirst(a.replace(/,\s*(\d{4}-?(\d{4})?|\(.*\))\s*$/, "").replace(/\s+/g, " ").trim()); // as F-0
  const out = new Map<string, Set<string>>();
  for (const a of parseCsv(readFileSync(join(lib, "data", "annotations", "library_books_annotations.csv"), "utf8"))) {
    if (a.not_book === "True") continue;
    const id = a.image_name!.replace(/\.jpg$/i, "");
    const g = out.get(id) ?? new Set<string>();
    for (const raw of (a.author ?? "").split(";")) if (raw.trim()) g.add(normalize(cleanAuthor(raw)).split(" ").pop()!);
    out.set(id, g);
  }
  return out;
}

/** The share of accepted labels whose author's surname is among the image's annotated authors (F-0's author accuracy). */
function authorAccuracy(db: ReturnType<typeof openCatalog>, decs: Iterable<Dec>, surnames: Map<string, Set<string>>) {
  let ok = 0, n = 0;
  const q = db.prepare("SELECT authors FROM works WHERE id = ?");
  for (const d of decs) {
    if (!d.accepted) continue;
    n++;
    const row = q.get(d.accepted) as { authors: string } | undefined;
    const g = surnames.get(d.imageId) ?? new Set<string>();
    if (row && (JSON.parse(row.authors) as string[]).some((a) => g.has(normalize(a).split(" ").pop()!))) ok++;
  }
  return { accepted: n, withAuthorInImage: ok, share: n ? ok / n : null };
}

/** Field coverage and field metrics for arms B and C (reported, not in the rule). */
function fieldSummary(set: SetName, aft: Map<string, Dec>, plans: Map<string, ReturnType<typeof planRegion>>, arm: string) {
  const read = [...aft.values()].filter((d) => plans.get(d.id)!.read);
  const per: Record<string, unknown> = {};
  for (const k of READERS) {
    const withInfo = [...aft.values()].filter((d) => d.info?.[k]);
    if (!withInfo.length) continue;
    const acc = withInfo.filter((d) => d.accepted && d.match?.[k]);
    const tf = acc.filter((d) => d.match![k]!.title !== null), af = acc.filter((d) => d.match![k]!.author !== null);
    per[k] = {
      regions: withInfo.length,
      titleField: withInfo.filter((d) => d.info![k]!.title).length,
      authorField: withInfo.filter((d) => d.info![k]!.author).length,
      fieldPathConfirmations: withInfo.filter((d) => d.info![k]!.path === "field" && d.confirmed?.[k]).length,
      authorCounterWithdrawals: withInfo.filter((d) => d.info![k]!.counter).length,
      onAccepts: { titleField: tf.length, titleMatches: tf.filter((d) => d.match![k]!.title).length, authorField: af.length, authorMatches: af.filter((d) => d.match![k]!.author).length },
    };
  }
  const out: Record<string, unknown> = {
    readRegions: read.length,
    withAuthorGroup: read.filter((d) => d.roles?.author).length,
    withTitleGroup: read.filter((d) => d.roles?.title).length,
    perReader: per,
  };
  if (arm === "c") {
    const fr = new Map(readJsonl<FieldRead>(join(PRIV, set, "fields", "qwen.jsonl")).map((r) => [r.id, r]));
    const used = [...aft.values()].filter((d) => d.qwenSelected);
    const variants = used.flatMap((d) => fr.get(d.id)?.variants ?? []);
    const control = controlIds(set, regionsOf(set)).map((id) => fr.get(id)).filter((x): x is FieldRead => !!x);
    const anyField = (v: FieldRead["variants"][number]) => Boolean(v.fields && (v.fields.title.text || v.fields.author.text || v.fields.imprint.text));
    out.qwen = {
      regionsRead: used.length,
      rotations: variants.length,
      truncated: variants.filter((v) => v.error).length,
      rejected: { title: variants.filter((v) => v.rejected?.includes("title")).length, author: variants.filter((v) => v.rejected?.includes("author")).length, imprint: variants.filter((v) => v.rejected?.includes("imprint")).length },
      authorFieldWithoutZonerAuthor: used.filter((d) => d.info?.qwen?.author && !d.roles?.author).length,
      authorFieldRegions: used.filter((d) => d.info?.qwen?.author).length,
      imprintFromLogo: variants.filter((v) => v.fields?.imprint.from === "logo").length,
      control: { regions: control.length, withAnyField: control.filter((r) => r.variants.some(anyField)).length },
      seconds: Math.round(used.reduce((s, d) => s + (fr.get(d.id)?.seconds ?? 0), 0)),
      tokensP50: (() => {
        const t = used.map((d) => fr.get(d.id)?.tokens ?? 0).sort((a, b) => a - b);
        return t.length ? t[Math.floor(t.length / 2)] : null;
      })(),
    };
  }
  return out;
}

function decisions(set: SetName, arm: string): Map<string, Dec> | null {
  const p = join(PRIV, set, arm, "decisions.jsonl");
  return existsSync(p) ? new Map(readJsonl<Dec>(p).map((d) => [d.id, d])) : null;
}

const asDecision = (d: Dec) => ({ id: d.id, imageId: d.imageId, accepted: d.accepted ? { workId: d.accepted } : null, reason: d.reason });

function analyse(): void {
  const truth = yardstickTruth();
  const surnames = yardstickSurnames();
  const ydb = openCatalog(F0B_SETS["yardstick-library-b2"].catalog);
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
        // Distinct works per photo, summed; the bootstrap resamples photos' changes, so a photo drawn twice counts twice.
        const perPhoto = [...new Set(ids.map((id) => split(id)[0]))].map((imageId) => {
          const mine = ids.filter((id) => split(id)[0] === imageId);
          const n = (m: Map<string, Dec>) => new Set(mine.map((id) => m.get(id)!.accepted).filter(Boolean)).size;
          return { imageId, b: n(base), a: n(aft) };
        });
        const sum = (rs: typeof perPhoto, k: "a" | "b") => rs.reduce((t, r) => t + r[k], 0);
        const d = clusterBootstrap(perPhoto, (rs) => sum(rs, "a") - sum(rs, "b"), REPS, 61);
        works = { before: sum(perPhoto, "b"), after: sum(perPhoto, "a"), delta: d && { value: d.value, lo: d.lo, hi: d.hi } };
      }
      const accepts = [...aft.values()].filter((d) => d.accepted);
      const loro = loroSummary(accepts.flatMap((d) => Object.values(d.loro ?? {})));
      const lines = loadReadings(join(PRIV, set, "lines"), LINE_CROP);
      const lineIds = ids.flatMap((id) => (p(id).read ? p(id).order : []));
      const fieldsOut = arm === "b" || arm === "c" ? fieldSummary(set, aft, plans, arm) : null;
      const authorAcc = tr ? { before: authorAccuracy(ydb!, base.values(), surnames!), after: authorAccuracy(ydb!, aft.values(), surnames!) } : null;
      out.arms[arm] = {
        all: summary(pairs(() => true), 11),
        ...(fieldsOut ? { fields: fieldsOut } : {}),
        ...(authorAcc ? { authorAccuracy: authorAcc } : {}),
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
      if (x.authorAccuracy) {
        const a = x.authorAccuracy;
        out.push(`Author accuracy (F-0's: accepted labels whose author's surname is annotated in the image): ${pc(a.before.share)} (${a.before.withAuthorInImage}/${a.before.accepted}) → ${pc(a.after.share)} (${a.after.withAuthorInImage}/${a.after.accepted}).`, "");
      }
      if (x.fields) {
        const f = x.fields;
        out.push(`**Author-field coverage.** Of ${f.readRegions} regions read by pass 2, the zoner found an author group on **${f.withAuthorGroup} (${pc(f.withAuthorGroup / Math.max(1, f.readRegions))})** and a title group on ${f.withTitleGroup}.`, "",
          "| reader | regions | title field | author field | field-path confirmations | author counter-evidence withdrawals | accepts: title field matches the work | accepts: author field matches the work |",
          "|---|---:|---:|---:|---:|---:|---|---|");
        for (const [k, r] of Object.entries<any>(f.perReader)) {
          const o = r.onAccepts;
          out.push(`| ${k} | ${r.regions} | ${r.titleField} | ${r.authorField} | ${r.fieldPathConfirmations} | ${r.authorCounterWithdrawals} | ${o.titleMatches}/${o.titleField} (${pc(o.titleMatches / Math.max(1, o.titleField))}) | ${o.authorMatches}/${o.authorField} (${pc(o.authorMatches / Math.max(1, o.authorField))}) |`);
        }
        out.push("");
        if (f.qwen) {
          const q = f.qwen;
          out.push(`Qwen field read: ${q.regionsRead} regions, ${q.rotations} rotations, ${q.truncated} not valid JSON; rejected (not in its own lines) title ${q.rejected.title}, author ${q.rejected.author}, imprint ${q.rejected.imprint}; imprint from a logo ${q.imprintFromLogo}. **Invented-field checks:** an author field where the zoner found no author line on ${q.authorFieldWithoutZonerAuthor} of ${q.authorFieldRegions} regions with a Qwen author field; any field on F-0d's no-text control ${q.control.withAnyField} of ${q.control.regions}. ${q.seconds} s, median ${q.tokensP50} visual tokens.`, "");
        }
      }
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
  else if (cmd === "fields" && isSet(set)) await fields(set);
  else if (cmd === "render" && isSet(set)) await render(set);
  else if (cmd === "analyse") analyse();
  else {
    console.error("usage: f0j-cli.ts zone|lines|fields|render <set> | run <set> <a0|a|b|c> | analyse   (set: pilot-000 | yardstick-library-b2)");
    process.exit(2);
  }
}
