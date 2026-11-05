// SC-1 runner: the shelf-context reader on each set's RB-1 box set (evals/SC1/prereg.md).
//
//   node src/eval/sc1-cli.ts lines <set>    # GPU (Vision, ANE): text lines on the photo with every kept book painted out
//   node src/eval/sc1-cli.ts read <set>     # CPU: PP-OCR reads each line crop; S-1's lip share of each line
//   node src/eval/sc1-cli.ts qwen <set>     # GPU (MLX): Qwen's few-shot sign read, only where the readers leave it open
//   node src/eval/sc1-cli.ts analyse        # both sets: per-row shelf context, measures -> evals/SC1/{metrics.json,report.md}
//
// <set> is pilot-000 or yardstick. Cached stage folders are read, never written. Everything per line, unit or row (text,
// geometry, records) stays under the data root's private/sc1/<set>/; only aggregates reach evals/SC1/. F-0h reads the
// rows through `--row-context sc1` (off by default). No profile input (INV-13).
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { openCatalog } from "../catalog/cli.ts";
import { dataRoot } from "../ledger/images.ts";
import { loadReadings, readJsonl, READERS, type Detection, type Reading, type ReaderName } from "./f0.ts";
import { kinds } from "./f0c.ts";
import { imagesOf, SETS, type SetName, type Slim } from "./f0c-cli.ts";
import type { Tri } from "./f0e.ts";
import { evidenceFor } from "./f0f-cli.ts";
import { loadBooks, loadDets } from "./f0g-cli.ts";
import { buildRows, ordered, type Row, type WorkRef } from "./f0h.ts";
import { clusterBootstrap, rate } from "./q1.ts";
import { loadBoxSet } from "./rb1.ts";
import {
  boundsOf,
  classify,
  combine,
  genrePairs,
  letterPairs,
  needsQwen,
  orderCounts,
  parseQwen,
  permuted,
  regionOf,
  rowContext,
  SC1,
  scopeOf,
  shuffleControl,
  surnameOf,
  workFamilies,
  type Bounds,
  type CueClass,
  type Family,
  type MeasureRow,
  type ReaderText,
  type Region,
  type ScopedCue,
  type ShelfContext,
  type UnitCue,
} from "./sc1.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const ROOT = dataRoot();
const PRIV = join(ROOT, "private", "sc1");
const REPS = 2000;
const SEED = 20261104;
const SET_NAMES: SetName[] = ["pilot-000", "yardstick"];
/** S-1's private folder per set. */
const S1_SET: Record<SetName, string> = { "pilot-000": "pilot-000", yardstick: "yardstick" };
const log = (s: string): void => console.error(`[sc1] ${s}`);
const r4 = (x: number) => Math.round(x * 10000) / 10000;
const triOf = (b: { value: number; lo: number; hi: number } | null): Tri => (b ? [r4(b.value), r4(b.lo), r4(b.hi)] : null);

const stage = (set: string): string => {
  const dir = join(PRIV, set);
  mkdirSync(dir, { recursive: true });
  return dir;
};

function py(helper: "label"): string {
  const p = join(REPO, "helpers", helper, ".venv", "bin", "python");
  if (!existsSync(p)) throw new Error(`helpers/${helper} has no .venv: run \`uv sync\` there first`);
  return p;
}

function visionLines(): string {
  const p = join(REPO, "helpers", "ocr-vision", ".build", "release", "ocr-vision-lines");
  if (!existsSync(p)) throw new Error("build helpers/ocr-vision first (swift build -c release)");
  return p;
}

/** Wait until no other GPU job (mlx, torch or Qwen, the fleet runner's `read-qwen` included) is running. */
function waitForGpu(): void {
  const pat = "mlx|torch|qwen|(read|detect|partition|stage|recover|zone|fields|imprint|faces|ends|outline)\\.py|ocr-vision";
  for (let n = 0; ; n++) {
    // pgrep -f also matches shells whose command text names a helper; count only python, mlx or Vision executables.
    const pids = (spawnSync("pgrep", ["-f", pat], { encoding: "utf8" }).stdout ?? "").split("\n").filter((x) => x.trim() && Number(x) !== process.pid);
    const others = pids.filter((p) => /python|mlx|ocr-vision/i.test(spawnSync("ps", ["-o", "comm=", "-p", p], { encoding: "utf8" }).stdout ?? ""));
    if (!others.length) return;
    if (n % 10 === 0) log(`GPU busy (${others.length} job(s)); waiting`);
    spawnSync("sleep", ["60"]);
  }
}

/** The GPU ledger: one line per GPU step (set, step, seconds), private; the report sums it. */
const gpuLog = (set: string, step: string, seconds: number) => appendFileSync(join(PRIV, "gpu.jsonl"), JSON.stringify({ set, step, seconds: Math.round(seconds), at: new Date().toISOString() }) + "\n");

// --- one set's photos ------------------------------------------------------------------------------------------------

type Poly = [number, number][];
interface Photo {
  id: string;
  image: string;
  det: Detection;
  /** Boxes painted out before text detection: every spine-kind box but NB-3's on-lip ones (kept books and F-0i's dropped pieces). */
  paint: Poly[];
  /** Not-a-book boxes by index, with their sub-reason. */
  notBook: Map<number, string>;
  rows: (Row & { key: string })[];
  books: boolean[];
}

function loadPhotos(set: SetName): Photo[] {
  const dets = loadDets(set);
  const books = loadBooks(set, dets);
  const ev = evidenceFor(set);
  const box = loadBoxSet(set);
  const paths = new Map(imagesOf(set).map((i) => [i.id, i.path]));
  return [...dets.values()]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((d) => {
      const k = kinds({ ...d, covers: [] }, ev.get(d.id));
      const paint: Poly[] = [];
      const notBook = new Map<number, string>();
      d.spines.forEach((s, i) => {
        const drop = box.drops.get(`${d.id}:${i}`);
        const spine = k.spines[i]!.kind === "spine";
        if (spine && drop !== "on-lip") paint.push(s.polygon as Poly);
        else notBook.set(i, spine ? "on-lip" : k.spines[i]!.why);
      });
      const bk = books.get(d.id)!;
      return { id: d.id, image: paths.get(d.id)!, det: d, paint, notBook, rows: buildRows(d, (i) => bk[i]!).map((r, j) => ({ ...r, key: `${d.id}|${j}` })), books: bk };
    });
}

// --- step: lines (GPU) ---------------------------------------------------------------------------------------------

interface LinesRow {
  id: string;
  lines?: { quad: Poly; text: string; confidence: number }[];
  tiles?: number;
  seconds?: number;
  error?: string;
}

function lines(set: SetName): void {
  const out = join(stage(set), "lines.jsonl");
  const done = new Set(readJsonl<LinesRow>(out).filter((r) => !r.error).map((r) => r.id));
  const todo = loadPhotos(set).filter((p) => !done.has(p.id));
  if (!todo.length) return log(`${set}: lines cached`);
  const input = todo.map((p) => JSON.stringify({ id: p.id, image: p.image, books: p.paint, tile: SC1.tile, overlap: SC1.tileOverlap })).join("\n") + "\n";
  waitForGpu();
  const t0 = Date.now();
  const fd = openSync(out, "a");
  const r = spawnSync(visionLines(), [], { input, stdio: ["pipe", fd, "inherit"], maxBuffer: 1 << 30 });
  closeSync(fd);
  gpuLog(set, "vision-lines", (Date.now() - t0) / 1000);
  if (r.status !== 0) throw new Error(`ocr-vision-lines exited ${r.status}`);
  log(`${set}: ${todo.length} photos, ${Math.round((Date.now() - t0) / 1000)} s (GPU released)`);
}

// --- step: read (CPU) ------------------------------------------------------------------------------------------------

/** A line quad (TL, TR, BR, BL) padded by `cropPad` of its height on every side, clamped to the frame. */
export function padQuad(q: Poly, w: number, h: number): Poly {
  const [tl, tr, br, bl] = q;
  const len = (a: [number, number], b: [number, number]) => Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const u: [number, number] = [(tr![0] - tl![0]) / len(tl!, tr!), (tr![1] - tl![1]) / len(tl!, tr!)];
  const n: [number, number] = [(bl![0] - tl![0]) / len(tl!, bl!), (bl![1] - tl![1]) / len(tl!, bl!)];
  const pad = SC1.cropPad * len(tl!, bl!);
  const mv = (p: [number, number], su: number, sn: number): [number, number] => [
    Math.round(Math.min(w - 1, Math.max(0, p[0] + pad * (su * u[0] + sn * n[0]))) * 10) / 10,
    Math.round(Math.min(h - 1, Math.max(0, p[1] + pad * (su * u[1] + sn * n[1]))) * 10) / 10,
  ];
  return [mv(tl!, -1, -1), mv(tr!, 1, -1), mv(br!, 1, 1), mv(bl!, -1, 1)];
}

const hasLetter = (s: string) => /\p{L}/u.test(s);

function read(set: SetName): void {
  const dir = stage(set);
  const photos = new Map(loadPhotos(set).map((p) => [p.id, p]));
  const ls = readJsonl<LinesRow>(join(dir, "lines.jsonl")).filter((r) => !r.error && photos.has(r.id));
  // PP-OCR on every line whose Vision text has a letter.
  const out = join(dir, "ppocr.jsonl");
  const done = new Set(readJsonl<{ id: string; error?: string }>(out).filter((r) => !r.error).map((r) => r.id));
  const reqs: string[] = [];
  for (const r of ls) {
    const p = photos.get(r.id)!;
    r.lines!.forEach((l, k) => {
      const id = `${r.id}#${k}`;
      if (!done.has(id) && hasLetter(l.text)) reqs.push(JSON.stringify({ id, image: p.image, polygon: padQuad(l.quad, p.det.width, p.det.height), rotations: [0] }));
    });
  }
  if (reqs.length) {
    const t0 = Date.now();
    const fd = openSync(out, "a");
    const r = spawnSync(py("label"), ["-I", join(REPO, "helpers", "label", "read.py"), "--reader", "ppocr"], { input: reqs.join("\n") + "\n", stdio: ["pipe", fd, "inherit"], maxBuffer: 1 << 30 });
    closeSync(fd);
    if (r.status !== 0) throw new Error(`read.py exited ${r.status}`);
    log(`${set}: PP-OCR read ${reqs.length} line crops (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
  // S-1's lip share of every line.
  const shelf = new Map(readJsonl<{ id: string; scale: number }>(join(ROOT, "private", "s1", S1_SET[set], "shelf.jsonl")).map((s) => [s.id, s.scale]));
  const lipReqs = ls.filter((r) => shelf.has(r.id)).map((r) => JSON.stringify({ id: r.id, map: join(ROOT, "private", "s1", S1_SET[set], "maps", `${r.id}.png`), scale: shelf.get(r.id), quads: r.lines!.map((l) => l.quad) }));
  const fd = openSync(join(dir, "lip.jsonl"), "w");
  const r = spawnSync(py("label"), ["-I", join(REPO, "helpers", "shelf", "lip_share.py")], { input: lipReqs.join("\n") + "\n", stdio: ["pipe", fd, "inherit"], maxBuffer: 1 << 30 });
  closeSync(fd);
  if (r.status !== 0) throw new Error(`lip_share.py exited ${r.status}`);
  log(`${set}: lip shares for ${lipReqs.length} photos`);
}

// --- step: qwen (GPU) ------------------------------------------------------------------------------------------------

/** One reader's best text of a reading: Vision's correction-off variant first, else the first non-empty one. */
const textOf = (r: Reading | undefined): { text: string; confidence: number } | null => {
  if (!r || r.error) return null;
  const v = r.variants.find((x) => x.text.trim()) ?? null;
  return v ? { text: v.text.replace(/\s+/g, " ").trim(), confidence: (v as { confidence?: number }).confidence ?? 1 } : null;
};

function localTexts(line: { text: string; confidence: number }, pp: Reading | undefined): ReaderText[] {
  const out: ReaderText[] = [{ reader: "vision", text: line.text, confidence: line.confidence }];
  const p = textOf(pp);
  if (p) out.push({ reader: "ppocr", text: p.text, confidence: p.confidence });
  return out;
}

function qwenSelection(set: SetName): { id: string; image: string; polygon: Poly }[] {
  const dir = stage(set);
  const photos = new Map(loadPhotos(set).map((p) => [p.id, p]));
  const pp = new Map(readJsonl<Reading>(join(dir, "ppocr.jsonl")).map((r) => [r.id, r]));
  const sel: { id: string; image: string; polygon: Poly }[] = [];
  for (const r of readJsonl<LinesRow>(join(dir, "lines.jsonl")).filter((x) => !x.error && photos.has(x.id))) {
    const p = photos.get(r.id)!;
    const cand = r.lines!.map((l, k) => ({ l, k, area: (boundsOf(l.quad).right - boundsOf(l.quad).left) * (boundsOf(l.quad).bottom - boundsOf(l.quad).top) })).filter((x) => needsQwen(localTexts(x.l, pp.get(`${r.id}#${x.k}`))));
    cand.sort((a, b) => b.area - a.area || a.k - b.k);
    for (const c of cand.slice(0, SC1.qwenPerPhoto[set]!)) sel.push({ id: `${r.id}#${c.k}`, image: p.image, polygon: padQuad(c.l.quad, p.det.width, p.det.height) });
  }
  return sel;
}

function qwen(set: SetName): void {
  const out = join(stage(set), "qwen.jsonl");
  const done = new Set(readJsonl<{ id: string; error?: string }>(out).filter((r) => !r.error).map((r) => r.id));
  const todo = qwenSelection(set).filter((s) => !done.has(s.id));
  if (!todo.length) return log(`${set}: qwen cached`);
  waitForGpu();
  const t0 = Date.now();
  const fd = openSync(out, "a");
  const r = spawnSync(py("label"), ["-I", join(REPO, "helpers", "label", "read.py"), "--reader", "qwen", "--prompt", "sign"], {
    input: todo.map((s) => JSON.stringify({ ...s, rotations: [0] })).join("\n") + "\n",
    stdio: ["pipe", fd, "inherit"],
    maxBuffer: 1 << 30,
  });
  closeSync(fd);
  gpuLog(set, "qwen-sign", (Date.now() - t0) / 1000);
  if (r.status !== 0) throw new Error(`read.py exited ${r.status}`);
  log(`${set}: Qwen read ${todo.length} lines (${Math.round((Date.now() - t0) / 1000)} s, GPU released)`);
}

// --- analyse ---------------------------------------------------------------------------------------------------------

/** Point in polygon (ray casting). */
function inside([x, y]: [number, number], poly: readonly (readonly number[])[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if (yi! > y !== yj! > y && x < ((xj! - xi!) * (y - yi!)) / (yj! - yi!) + xi!) c = !c;
  }
  return c;
}

interface Unit {
  id: string;
  imageId: string;
  kind: "line" | "box";
  bounds: Bounds;
  region: Region;
  boxWhy: string | null;
  cue: UnitCue;
  /** What the lexicon alone made of the local readers (for the class table). */
  qwenAsked: boolean;
}

/** A not-a-book box's reader text: per reader, the variant whose class ranks first (a promotion or price veto first). */
function boxTexts(rs: Partial<Record<ReaderName, Reading>> | undefined): ReaderText[] {
  const rank: CueClass[] = ["promotion", "price", "ordering", "letter", "section", "other"];
  const out: ReaderText[] = [];
  for (const reader of READERS) {
    const r = rs?.[reader];
    if (!r || r.error) continue;
    const vs = r.variants.map((v) => ({ text: v.text.replace(/\s+/g, " ").trim(), confidence: (v as { confidence?: number }).confidence ?? 1 })).filter((v) => v.text);
    if (!vs.length) continue;
    vs.sort((a, b) => rank.indexOf(classify(a.text).cls) - rank.indexOf(classify(b.text).cls) || b.confidence - a.confidence);
    out.push({ reader, text: vs[0]!.text, confidence: vs[0]!.confidence });
  }
  return out;
}

class Facets {
  private q;
  private memo = new Map<string, { work: WorkRef; families: Set<Family> }>();
  constructor(db: DatabaseSync) {
    this.q = db.prepare("SELECT id, title, authors, tags, ttype, non_genre, graphic FROM works WHERE id = ?");
  }
  get(id: string) {
    if (!this.memo.has(id)) {
      const r = this.q.get(id) as { id: string; title: string; authors: string; tags: string; ttype: string | null; non_genre: number; graphic: number } | undefined;
      if (!r) throw new Error("a cached decision names a work the catalog does not hold");
      const work: WorkRef = { workId: r.id, title: r.title, authors: JSON.parse(r.authors) as string[] };
      this.memo.set(id, { work, families: workFamilies({ tags: JSON.parse(r.tags || "[]") as string[], ttype: r.ttype, nonGenre: Boolean(r.non_genre), graphic: Boolean(r.graphic) }) });
    }
    return this.memo.get(id)!;
  }
}

interface ArmOut {
  rows: Map<string, ShelfContext>;
  units: Unit[];
  scoped: number;
  unscoped: number;
}

/** One arm on one set: units, regions, cues, scope and the per-row records. */
function runArm(set: SetName, photos: Photo[], withQwen: boolean): ArmOut {
  const dir = stage(set);
  const lns = new Map(readJsonl<LinesRow>(join(dir, "lines.jsonl")).filter((r) => !r.error).map((r) => [r.id, r]));
  const pp = new Map(readJsonl<Reading>(join(dir, "ppocr.jsonl")).map((r) => [r.id, r]));
  const lip = new Map(readJsonl<{ id: string; lip: (number | null)[] }>(join(dir, "lip.jsonl")).map((r) => [r.id, r.lip]));
  const qw = withQwen ? new Map(readJsonl<Reading>(join(dir, "qwen.jsonl")).map((r) => [r.id, r])) : new Map<string, Reading>();
  const boxReads = loadReadings(SETS[set].base);
  const units: Unit[] = [];
  const cues = new Map<string, ScopedCue[]>();
  let scoped = 0, unscoped = 0;
  for (const p of photos) {
    const nb = [...p.notBook].map(([i, why]) => ({ i, why, poly: p.det.spines[i]!.polygon }));
    const add = (u: Unit) => {
      units.push(u);
      if (u.cue.dropped) return;
      const s = scopeOf(u.bounds, u.region, u.boxWhy, u.cue, p.rows);
      if (!s) return void unscoped++;
      scoped++;
      for (const key of s.rows) cues.set(key, [...(cues.get(key) ?? []), { unit: u.id, region: u.region, level: s.level, cue: u.cue, x: s.x }]);
    };
    (lns.get(p.id)?.lines ?? []).forEach((l, k) => {
      const id = `${p.id}#${k}`;
      const b = boundsOf(l.quad);
      const c: [number, number] = [(b.left + b.right) / 2, (b.top + b.bottom) / 2];
      const hit = nb.find((x) => inside(c, x.poly));
      const texts = localTexts(l, pp.get(id));
      const q = qw.get(id);
      if (q && !q.error) {
        const parsed = parseQwen(q.variants[0]?.text ?? "");
        if (parsed.text) texts.push({ reader: "qwen", text: parsed.text, confidence: 1, kind: parsed.kind });
      }
      const region = regionOf(b, { inNotABook: Boolean(hit), lipShare: lip.get(p.id)?.[k] ?? null }, p.rows);
      add({ id, imageId: p.id, kind: "line", bounds: b, region, boxWhy: hit?.why ?? null, cue: combine(texts), qwenAsked: qw.has(id) });
    });
    for (const x of nb) {
      const texts = boxTexts(boxReads.get(`${p.id}:${x.i}`));
      if (!texts.length) continue;
      add({ id: `${p.id}:${x.i}`, imageId: p.id, kind: "box", bounds: boundsOf(x.poly), region: "not-a-book", boxWhy: x.why, cue: combine(texts), qwenAsked: false });
    }
  }
  const rows = new Map<string, ShelfContext>();
  for (const [key, cs] of cues) {
    const ctx = rowContext(cs);
    if (ctx) rows.set(key, ctx);
  }
  return { rows, units, scoped, unscoped };
}

const count = (xs: string[]): Record<string, number> => {
  const o: Record<string, number> = {};
  for (const x of xs) o[x] = (o[x] ?? 0) + 1;
  return o;
};

/** Measures for one arm on one set. */
function measures(set: SetName, photos: Photo[], arm: ArmOut, facets: Facets, base: Map<string, Slim>) {
  const mrows: MeasureRow[] = [];
  for (const p of photos)
    for (const r of p.rows) {
      const books = r.members.flatMap((i) => {
        const acc = base.get(`${p.id}:${i}`)?.accepted;
        if (!acc) return [];
        const f = facets.get(acc);
        const g = p.det.spines[i]!.polygon;
        return [{ x: g.reduce((s, q) => s + q[0], 0) / g.length, surname: surnameOf(f.work), families: f.families }];
      });
      mrows.push({ imageId: p.id, key: r.key, context: arm.rows.get(r.key) ?? null, books });
    }
  const withCtx = mrows.filter((r) => r.context);
  const share = (k: number, n: number) => (n ? r4(k / n) : null);
  const ci = <T extends { imageId: string }>(xs: T[], f: (x: T) => boolean): Tri => triOf(clusterBootstrap(xs, rate(f), REPS, SEED));

  // Letters: range and divider pairs; the control permutes ranges among the rows that hold one and divider letters among all dividers.
  const lp = letterPairs(mrows);
  const rangeRows = mrows.filter((r) => r.context?.letterRange);
  const divs = mrows.flatMap((r) => r.context?.dividers.map((d) => d.letter) ?? []);
  const letters = shuffleControl(
    () => ({ value: lp.length ? lp.filter((x) => x.agree).length / lp.length : null, n: lp.length }),
    (rand) => {
      const ranges = new Map(rangeRows.map((r, i, a) => [r.key, a[i]!.context!.letterRange!] as const));
      const keys = permuted(rangeRows.map((r) => r.key), rand);
      const pr = new Map(rangeRows.map((r, i) => [r.key, ranges.get(keys[i]!)!]));
      const pd = permuted(divs, rand);
      let j = 0;
      const m = new Map<string, ShelfContext>();
      for (const r of mrows) if (r.context) m.set(r.key, { ...r.context, letterRange: pr.get(r.key) ?? null, dividers: r.context.dividers.map((d) => ({ ...d, letter: pd[j++]! })) });
      return m;
    },
    (m) => {
      const xs = letterPairs(mrows, (r) => m.get(r.key) ?? null);
      return xs.length ? xs.filter((x) => x.agree).length / xs.length : null;
    },
  );

  // Genre: families permuted among the rows that hold one.
  const gp = genrePairs(mrows);
  const famRows = mrows.filter((r) => r.context?.family);
  const genre = shuffleControl(
    () => ({ value: gp.length ? gp.filter((x) => x.agree).length / gp.length : null, n: gp.length }),
    (rand) => {
      const fs = permuted(famRows.map((r) => r.context!.family!), rand);
      return new Map(famRows.map((r, i) => [r.key, fs[i]!]));
    },
    (m) => {
      const xs = genrePairs(mrows, (r) => m.get(r.key) ?? null);
      return xs.length ? xs.filter((x) => x.agree).length / xs.length : null;
    },
  );

  // Order: in-order share of consecutive confirmed pairs in rows SC-1 marks ordered; the control permutes the mark among rows with a pair.
  const paired = mrows.filter((r) => orderCounts([r]).pairs > 0);
  const marked = paired.filter((r) => r.context?.ordering);
  const oc = orderCounts(marked);
  const order = shuffleControl(
    () => ({ value: oc.pairs ? oc.inOrder / oc.pairs : null, n: oc.pairs }),
    (rand) => new Set(permuted(paired.map((r) => r.key), rand).slice(0, marked.length)),
    (s) => {
      const c = orderCounts(paired.filter((r) => s.has(r.key)));
      return c.pairs ? c.inOrder / c.pairs : null;
    },
  );
  const unmarked = orderCounts(paired.filter((r) => !r.context?.ordering));
  const orderedRowsMarked = marked.filter((r) => ordered(r.books.map((b) => b.surname))).length;

  const lines = arm.units.filter((u) => u.kind === "line");
  return {
    photos: photos.length,
    rows: mrows.length,
    rowsWithContext: withCtx.length,
    rowsWithContextShare: share(withCtx.length, mrows.length),
    rowsWithContextShareCI: ci(mrows, (r) => Boolean(r.context)),
    photosWithContext: new Set(withCtx.map((r) => r.imageId)).size,
    rowsWith: {
      genre: withCtx.filter((r) => r.context!.genre).length,
      genreFamily: withCtx.filter((r) => r.context!.family).length,
      ordering: withCtx.filter((r) => r.context!.ordering).length,
      letterRange: withCtx.filter((r) => r.context!.letterRange).length,
      dividers: withCtx.filter((r) => r.context!.dividers.length).length,
    },
    rowsBySource: count(withCtx.map((r) => r.context!.source.replace(/^sc1:/, ""))),
    rowsByGenreLevel: count(withCtx.filter((r) => r.context!.levels.genre).map((r) => r.context!.levels.genre!)),
    familiesOfRows: count(withCtx.filter((r) => r.context!.family).map((r) => r.context!.family!)),
    confidenceP50: withCtx.length ? r4([...withCtx.map((r) => r.context!.confidence)].sort((a, b) => a - b)[Math.floor(withCtx.length / 2)]!) : null,
    units: {
      lines: lines.length,
      linesPerPhoto: share(lines.length, photos.length),
      boxes: arm.units.filter((u) => u.kind === "box").length,
      byRegion: count(arm.units.map((u) => `${u.kind}:${u.region}`)),
      byClass: count(arm.units.map((u) => u.cue.cls)),
      dropped: count(arm.units.map((u) => u.cue.dropped ?? "kept")),
      keptByClass: count(arm.units.filter((u) => !u.cue.dropped).map((u) => u.cue.cls)),
      keptByAgreement: count(arm.units.filter((u) => !u.cue.dropped).map((u) => [...u.cue.agreeing].sort().join("+"))),
      qwenAsked: arm.units.filter((u) => u.qwenAsked).length,
      scopedCues: arm.scoped,
      unscopedCues: arm.unscoped,
      // INV: promotions and prices never reach a record.
      promotionOrPriceInRecords: arm.units.filter((u) => (u.cue.cls === "promotion" || u.cue.cls === "price") && !u.cue.dropped).length,
    },
    letters: { ...letters, byKind: count(lp.map((x) => `${x.kind}:${x.agree ? "agree" : "disagree"}`)), realCI: ci(lp, (x) => x.agree) },
    genre: { ...genre, realCI: ci(gp, (x) => x.agree), booksWithKnownFacets: gp.length },
    order: { ...order, rowsMarked: marked.length, rowsMarkedOrderedByF0h: orderedRowsMarked, unmarkedInOrderShare: unmarked.pairs ? r4(unmarked.inOrder / unmarked.pairs) : null, unmarkedPairs: unmarked.pairs },
  };
}

type Measures = ReturnType<typeof measures>;

/** F-0h v2 check: decisions and hypotheses with `--row-context sc1` against the default, if that run exists. */
function f0hCheck(): object | null {
  const v2 = join(PRIV, "f0h-v2", "metrics.json");
  if (!existsSync(v2)) return null;
  const on = JSON.parse(readFileSync(v2, "utf8"));
  const off = JSON.parse(readFileSync(join(REPO, "evals", "F0h", "metrics.json"), "utf8"));
  const sets: Record<string, object> = {};
  let same = true;
  for (const set of SET_NAMES) {
    const a = readJsonl<{ id: string; basis: string | null; workId: string | null }>(join(ROOT, "private", "f0h", set, "decisions.jsonl"));
    const b = new Map(readJsonl<{ id: string; basis: string | null; workId: string | null }>(join(PRIV, "f0h-v2", set, "decisions.jsonl")).map((d) => [d.id, d]));
    const changed = a.filter((d) => b.get(d.id)?.basis !== d.basis || b.get(d.id)?.workId !== d.workId).length + Math.abs(a.length - b.size);
    if (changed) same = false;
    const s0 = off.sets[set], s1 = on.sets[set];
    sets[set] = {
      decisionsCompared: a.length,
      decisionsChanged: changed,
      confirmedByContext: [s0.eval.confirmedByContext, s1.eval.confirmedByContext],
      rowsSetOrderedByContext: [s0.strips.rowsSetOrdered, s1.strips.rowsSetOrdered],
      rowsLabelled: [s0.strips.rowsLabelled, s1.strips.rowsLabelled],
      hiddenTop1: [s0.hypotheses.hiddenCheck.all.top1, s1.hypotheses.hiddenCheck.all.top1],
      hiddenTop5: [s0.hypotheses.hiddenCheck.all.top5, s1.hypotheses.hiddenCheck.all.top5],
      hiddenBracketTop1: [s0.hypotheses.hiddenCheck.bracket.top1, s1.hypotheses.hiddenCheck.bracket.top1],
    };
  }
  return { note: "[default, --row-context sc1]", decisionsUnchanged: same, sets };
}

/** The keep rule for wiring SC-1 into F-0h v2 (report only), pre-registered in evals/SC1/prereg.md. */
export const KEEP = { coverageGain: 10, minPairs: 20 } as const;

function analyse(): void {
  const t0 = Date.now();
  const f0h = JSON.parse(readFileSync(join(REPO, "evals", "F0h", "metrics.json"), "utf8"));
  const out: Record<string, { main: string; arms: Record<string, Measures>; baseline: object; qwenSelected: number; qwenRead: number }> = {};
  for (const set of SET_NAMES) {
    const photos = loadPhotos(set);
    const facets = new Facets(openCatalog(SETS[set].catalog));
    const base = new Map(readJsonl<Slim>(join(ROOT, "f0c", set, "base-decisions.jsonl")).map((d) => [d.id, d]));
    const qSel = qwenSelection(set).length;
    const qRead = readJsonl<{ id: string; error?: string }>(join(stage(set), "qwen.jsonl")).filter((r) => !r.error).length;
    const main = qSel > 0 && qRead >= qSel ? "sc1" : "sc1-no-qwen";
    const arms: Record<string, Measures> = {};
    for (const [name, withQwen] of [["sc1", true], ["sc1-no-qwen", false]] as const) {
      const arm = runArm(set, photos, withQwen);
      arms[name] = measures(set, photos, arm, facets, base);
      // Private per-row records (F-0h's `--row-context sc1` reads the main arm's).
      writeFileSync(join(stage(set), name === "sc1" ? "rows.jsonl" : "rows-no-qwen.jsonl"), [...arm.rows].map(([key, c]) => JSON.stringify({ key, ...c })).join("\n") + (arm.rows.size ? "\n" : ""));
      writeFileSync(join(stage(set), name === "sc1" ? "units.jsonl" : "units-no-qwen.jsonl"), arm.units.map((u) => JSON.stringify(u)).join("\n") + "\n");
    }
    if (main === "sc1-no-qwen") writeFileSync(join(stage(set), "rows.jsonl"), readFileSync(join(stage(set), "rows-no-qwen.jsonl")));
    const s = f0h.sets[set].strips;
    out[set] = { main, arms, baseline: { source: s.source, rows: s.rows, rowsWithContext: s.rowsLabelled, rowsWithContextShare: s.rows ? r4(s.rowsLabelled / s.rows) : null, ordering: s.rowsSetOrdered, genre: s.rowsWithGenre }, qwenSelected: qSel, qwenRead: qRead };
    log(`${set}: analysed (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
  const gpu = readJsonl<{ set: string; step: string; seconds: number }>(join(PRIV, "gpu.jsonl"));
  const check = f0hCheck() as { decisionsUnchanged: boolean } | null;
  const p = out["pilot-000"]!, y = out.yardstick!;
  const pm = p.arms[p.main]!, ym = y.arms[y.main]!;
  const measured = (s: { n: number; real: number | null }) => s.n >= KEEP.minPairs && s.real !== null;
  const above = (s: { n: number; real: number | null; p95: number | null }) => measured(s) && s.p95 !== null && s.real! > s.p95;
  const noWorse = (s: { n: number; real: number | null; mean: number | null }) => !measured(s) || s.mean === null || s.real! >= s.mean;
  const keep = {
    k1Coverage: pm.rowsWithContext >= (p.baseline as { rowsWithContext: number }).rowsWithContext + KEEP.coverageGain,
    k2Evidence: above(pm.letters) || above(pm.genre),
    k3NoContradiction: [pm, ym].every((m) => noWorse(m.letters) && noWorse(m.genre) && noWorse(m.order)),
    k4NeverConfirms: check ? check.decisionsUnchanged && pm.units.promotionOrPriceInRecords === 0 && ym.units.promotionOrPriceInRecords === 0 : null,
  };
  const metrics = {
    card: "SC-1",
    run: "2026-11-04",
    note: "Aggregates only. pilot-000 is machine agreement, never accuracy (INV-17); the yardstick is PROXY (library shelves). Never pooled (OC35). No profile input (INV-13). No hand labels; nothing trained.",
    boxSet: "RB-1's box set (F-0i's partition less NB-3's on-lip boxes)",
    constants: SC1,
    keepConstants: KEEP,
    gpuSeconds: { total: gpu.reduce((s, g) => s + g.seconds, 0), bySetStep: gpu.reduce<Record<string, number>>((o, g) => ({ ...o, [`${g.set}:${g.step}`]: (o[`${g.set}:${g.step}`] ?? 0) + g.seconds }), {}) },
    sets: out,
    f0hV2: check,
    keep: { ...keep, recommend: keep.k1Coverage && keep.k2Evidence && keep.k3NoContradiction && keep.k4NeverConfirms === true },
    seconds: Math.round((Date.now() - t0) / 1000),
  };
  const dir = join(REPO, "evals", "SC1");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "metrics.json"), JSON.stringify(metrics, null, 2) + "\n");
  const reportPath = join(dir, "report.md");
  const report = existsSync(reportPath) ? readFileSync(reportPath, "utf8") : "# SC-1: shelf-context reader — report\n\n<!-- tables -->\n";
  const marker = "<!-- tables -->";
  const at = report.indexOf(marker);
  if (at < 0) throw new Error("report.md has no tables marker");
  writeFileSync(reportPath, report.slice(0, at + marker.length) + "\n" + tables(metrics));
  log(`analyse: ${metrics.seconds} s -> evals/SC1/`);
}

// --- report tables -------------------------------------------------------------------------------------------------------

const pc = (t: Tri | number | null, d = 1) => (t === null || t === undefined ? "–" : typeof t === "number" ? `${(t * 100).toFixed(d)} %` : `${(t[0] * 100).toFixed(d)} % (${(t[1] * 100).toFixed(d)}–${(t[2] * 100).toFixed(d)})`);
const kv = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ") || "none";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tables(m: any): string {
  const out: string[] = [];
  const ctl = (s: { real: number | null; n: number; mean: number | null; p95: number | null; p: number | null; realCI?: Tri }) =>
    s.real === null ? `– (n ${s.n})` : `${pc(s.realCI ?? s.real)}; n ${s.n}; shuffle mean ${pc(s.mean)}, p95 ${pc(s.p95)}, p ${s.p ?? "–"}`;
  for (const set of SET_NAMES) {
    const s = m.sets[set];
    out.push(`### ${set === "pilot-000" ? "pilot-000 (real use): machine agreement, never accuracy" : "yardstick (PROXY, library shelves)"}\n`);
    out.push(`Main arm: \`${s.main}\` (Qwen selected ${s.qwenSelected} lines, read ${s.qwenRead}). Intervals: 95 % photo bootstrap.\n`);
    out.push(`| measure | F-0h strip adapter (baseline) | ${Object.keys(s.arms).map((a) => `\`${a}\``).join(" | ")} |`);
    out.push(`|---|---|${Object.keys(s.arms).map(() => "---").join("|")}|`);
    const arms = Object.values(s.arms) as Measures[];
    const row = (label: string, b: string, f: (a: Measures) => string) => out.push(`| ${label} | ${b} | ${arms.map(f).join(" | ")} |`);
    row("rows with context", `${s.baseline.rowsWithContext} of ${s.baseline.rows} (${pc(s.baseline.rowsWithContextShare)})`, (a) => `${a.rowsWithContext} of ${a.rows} (${pc(a.rowsWithContextShareCI)})`);
    row("photos with any row context", "–", (a) => `${a.photosWithContext} of ${a.photos}`);
    row("rows with genre (mapped to a family)", `${s.baseline.genre}`, (a) => `${a.rowsWith.genre} (${a.rowsWith.genreFamily})`);
    row("rows with an ordering rule", `${s.baseline.ordering}`, (a) => `${a.rowsWith.ordering}`);
    row("rows with a letter range / with dividers", "0 / 0", (a) => `${a.rowsWith.letterRange} / ${a.rowsWith.dividers}`);
    row("rows by cue source (region:scope)", "f0f-shelf-strip", (a) => kv(a.rowsBySource));
    row("genre families of rows", "–", (a) => kv(a.familiesOfRows));
    row("record confidence, median", "–", (a) => (a.confidenceP50 === null ? "–" : a.confidenceP50.toFixed(2)));
    row("**letter agreement** (book surname vs range or divider side)", "–", (a) => ctl(a.letters));
    row("letter pairs by kind", "–", (a) => kv(a.letters.byKind));
    row("**genre agreement** (book facets vs row section)", "–", (a) => ctl(a.genre));
    row("**order agreement** (in-order consecutive pairs, rows with an ordering rule)", "–", (a) => ctl(a.order));
    row("rows with an ordering rule / of them ordered by F-0h's rule", "–", (a) => `${a.order.rowsMarked} / ${a.order.rowsMarkedOrderedByF0h}`);
    row("in-order share, rows without an ordering rule", "–", (a) => `${pc(a.order.unmarkedInOrderShare)} (n ${a.order.unmarkedPairs})`);
    row("text units: lines (per photo) / not-a-book boxes with text", "–", (a) => `${a.units.lines} (${a.units.linesPerPhoto?.toFixed(1)}) / ${a.units.boxes}`);
    row("units by region", "–", (a) => kv(a.units.byRegion));
    row("units by class", "–", (a) => kv(a.units.byClass));
    row("units kept / dropped (why)", "–", (a) => kv(a.units.dropped));
    row("kept units by class", "–", (a) => kv(a.units.keptByClass));
    row("kept units by agreeing readers", "–", (a) => kv(a.units.keptByAgreement));
    row("cues scoped / unscoped", "–", (a) => `${a.units.scopedCues} / ${a.units.unscopedCues}`);
    row("promotion or price units reaching a record (must be 0)", "–", (a) => `${a.units.promotionOrPriceInRecords}`);
    out.push("");
  }
  const c = m.f0hV2;
  out.push("### F-0h v2 with `--row-context sc1` (report only)\n");
  if (!c) out.push("Not run.\n");
  else {
    out.push(`Decisions unchanged on both sets: **${c.decisionsUnchanged ? "yes" : "NO"}**. Pairs are [default, sc1].\n`);
    out.push("| set | decisions compared / changed | confirmed-by-context | rows labelled | rows set ordered | hidden-reader top-1 | top-5 | bracket top-1 |\n|---|---|---|---|---|---|---|---|");
    for (const [set, v] of Object.entries(c.sets) as [string, any][]) out.push(`| ${set} | ${v.decisionsCompared} / ${v.decisionsChanged} | ${v.confirmedByContext.join(" → ")} | ${v.rowsLabelled.join(" → ")} | ${v.rowsSetOrderedByContext.join(" → ")} | ${v.hiddenTop1.map((t: Tri) => pc(t)).join(" → ")} | ${v.hiddenTop5.map((t: Tri) => pc(t)).join(" → ")} | ${v.hiddenBracketTop1.map((t: Tri) => pc(t)).join(" → ")} |`);
    out.push("");
  }
  out.push("### Keep rule for F-0h v2 (report only; promotion is a later card)\n");
  out.push(`| rule | holds |\n|---|---|\n| K1 coverage (pilot rows with context ≥ baseline + ${m.keepConstants.coverageGain}) | ${m.keep.k1Coverage} |\n| K2 evidence (pilot letter or genre agreement above its shuffle p95, n ≥ ${m.keepConstants.minPairs}) | ${m.keep.k2Evidence} |\n| K3 no contradiction (every measured agreement ≥ its shuffle mean, both sets) | ${m.keep.k3NoContradiction} |\n| K4 never a confirmer (F-0h decisions unchanged; no promotion or price in a record) | ${m.keep.k4NeverConfirms ?? "not run"} |\n| **recommend wiring into F-0h v2** | **${m.keep.recommend}** |\n`);
  out.push(`GPU: ${Math.round(m.gpuSeconds.total / 60)} min in all (${kv(Object.fromEntries(Object.entries(m.gpuSeconds.bySetStep as Record<string, number>).map(([k, v]) => [k, Math.round(v / 60)])))} min).\n`);
  return out.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, set] = process.argv.slice(2);
  const isSet = (s: string | undefined): s is SetName => s === "pilot-000" || s === "yardstick";
  if (cmd === "analyse") analyse();
  else if ((cmd === "lines" || cmd === "read" || cmd === "qwen") && isSet(set)) ({ lines, read, qwen })[cmd](set);
  else {
    console.error("usage: sc1-cli.ts lines|read|qwen <pilot-000|yardstick> | analyse");
    process.exit(2);
  }
}

