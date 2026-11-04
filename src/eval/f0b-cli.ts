// F-0b runner: reader-crop geometry (src/perceive/crop.ts) measured on F-0's cached boxes. Each variant changes
// one step of how a spine is cut or turned, re-reads only the boxes that step touches, re-runs F-0's hard-crop
// selection for Qwen, and re-decides with F-0's unchanged rules. Before is F-0's cached decision for the same box.
//
//   node src/eval/f0b-cli.ts run <set> <variant>   # pilot-000 | yardstick-library-b2; orient | clip | face | pad | remask
//   node src/eval/f0b-cli.ts analyse               # evals/F0b/{metrics.json,report.md} (aggregates only)
//   node src/eval/f0b-cli.ts render                # private before/after renders
//
// Inputs: F-0's stage folders (`f0/<set>/`) and mask outlines from helpers/label/outline.py. Everything per box
// or per photo stays under the data root's `private/f0b/`.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Candidate } from "../catalog/retrieve.ts";
import { catalogPaths, openCatalog } from "../catalog/cli.ts";
import { dataRoot, ImageStore } from "../ledger/images.ts";
import {
  AMBIGUOUS_ASPECT,
  F0_CROP,
  canonical,
  clipToFrame,
  cropFor,
  cropName,
  cropSize,
  longAxisRotations,
  minAreaRect,
  rectQuad,
  spineFace,
  type CropMethod,
  type Point,
  type SpineFace,
} from "../perceive/crop.ts";
import { CROP, decide, loadReadings, pyReaderStage, readJsonl, visionStage, type Detection, type InputImage, type Reading, type ReaderName, type SpineDecision } from "./f0.ts";
import { compactJson, outcomeOf, yardstickTruth } from "./q1-cli.ts";
import { clusterBootstrap } from "./q1.ts";
import type { Outcome } from "./q1.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const ROOT = dataRoot();
const PRIV = join(ROOT, "private", "f0b");
const REPS = 2000;
/** Q-1's position cut (H2, picked on pilot-000): beyond this share of the half-diagonal a box is at the frame's edge. */
const EDGE_RADIAL = 0.56;
/** Padding tested at each end, as a share of the spine's length. Set a priori, not tuned. */
const PAD = 0.04;
const log = (s: string): void => console.error(`[f0b] ${s}`);
const r4 = (x: number) => Math.round(x * 10000) / 10000;

type SetName = "pilot-000" | "yardstick-library-b2";
const SETS: Record<SetName, { scope: string; qwenCap: number; catalog: string }> = {
  "pilot-000": { scope: "real use (OC35): machine agreement, never accuracy (INV-17)", qwenCap: 40, catalog: catalogPaths().catalog },
  "yardstick-library-b2": {
    scope: "PROXY: Library Dataset sample, box arm B2; confirmed = accepted and annotated in the image",
    qwenCap: 15,
    catalog: join(ROOT, "proxy", "library-dataset", "f0-inventory-catalog.sqlite"),
  },
};

// --- inputs ----------------------------------------------------------------------------------------------

function loadSet(set: SetName) {
  const dets = new Map(readJsonl<Detection>(join(ROOT, "f0", set, "detect.jsonl")).filter((d) => !d.error).map((d) => [d.id, d]));
  const outlines = new Map(
    readJsonl<{ id: string; outline?: Point[] }>(join(PRIV, set, "outline.jsonl")).filter((o) => o.outline).map((o) => [o.id, o.outline!]),
  );
  for (const d of dets.values()) d.spines.forEach((s, i) => (s.outline = outlines.get(`${d.id}:${i}`)));
  const store = new ImageStore(ROOT);
  const images: InputImage[] = [...dets.keys()].map((id) => {
    const path = set === "pilot-000" ? store.find(id) : join(ROOT, "proxy", "library-dataset", "images", `${id}.jpg`);
    if (!path || !existsSync(path)) throw new Error(`image missing for a cached detection in ${set}`);
    return { id, photoHash: id, path, setting: set };
  });
  const before = new Map(readJsonl<SpineDecision>(join(ROOT, "f0", set, "decisions.jsonl")).map((d) => [d.id, d]));
  return { dets, images, before, outlines: outlines.size };
}

/** What the geometry says about one cached box; decides which variant touches it. */
interface Geo {
  id: string;
  imageId: string;
  boxScore: number;
  lying: boolean;
  squat: boolean;
  orientTouched: boolean;
  inFrame: boolean;
  radial: number;
  edge: boolean;
  face: SpineFace | null;
  oblique: boolean;
  /** Cut by a tile edge (the detector's flag), or its long side under `PARTIAL_BAND` of its shelf band's height. */
  piece: boolean;
}

/** The conductor's cut for a broken piece of a spine (F-0e): long side under this share of the band's height. */
const PARTIAL_BAND = 0.55;

/** Is `p` inside the convex quad `q` (canonical, clockwise on screen)? */
function inQuad(p: Point, q: readonly Point[]): boolean {
  const c = canonical(q);
  return c.every((a, k) => {
    const b = c[(k + 1) % 4]!;
    return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
  });
}

function geometry(dets: Map<string, Detection>): Geo[] {
  return [...dets.values()].flatMap((d) =>
    d.spines.map((s, i) => {
      const { width, height } = cropSize(s.polygon);
      const cx = s.polygon.reduce((a, p) => a + p[0], 0) / 4 / d.width, cy = s.polygon.reduce((a, p) => a + p[1], 0) / 4 / d.height;
      const radial = Math.hypot(cx - 0.5, cy - 0.5) / Math.hypot(0.5, 0.5);
      const rot = longAxisRotations(s.polygon);
      const c = clipToFrame(s.polygon, d.width, d.height);
      const face = s.outline ? spineFace(s.outline) : null;
      const centre: Point = [cx * d.width, cy * d.height];
      const band = d.bands.find((b) => inQuad(centre, b.polygon));
      const bandHeight = band ? Math.min(cropSize(band.polygon).width, cropSize(band.polygon).height) : null;
      return {
        id: `${d.id}:${i}`,
        imageId: d.id,
        boxScore: s.boxScore,
        lying: width > height,
        squat: Math.max(width, height) < AMBIGUOUS_ASPECT * Math.min(width, height),
        orientTouched: !(rot.length === 2 && rot[0] === 90),
        inFrame: c !== null && !c.clipped,
        radial,
        edge: radial > EDGE_RADIAL,
        face,
        oblique: face?.oblique ?? false,
        piece: s.cut || (bandHeight !== null && Math.max(width, height) < PARTIAL_BAND * bandHeight),
      };
    }),
  );
}

// --- variants --------------------------------------------------------------------------------------------

const method = (m: Partial<CropMethod>): CropMethod => ({ ...F0_CROP, ...m });
type Stratum = Record<string, (g: Geo) => boolean>;
const flagged = (g: Geo) => !g.orientTouched && (g.edge || g.oblique || !g.inFrame);
interface Variant {
  what: string;
  method: CropMethod;
  subset: (g: Geo) => boolean;
  strata: Stratum;
  /** Attribution control, never a ship candidate: the polygon is the re-derived mask's minimum-area rectangle. */
  remask?: boolean;
}
const VARIANTS: Record<string, Variant> = {
  orient: {
    what: "rotations from the polygon's long axis (lying: 0/180; long/short < 2: all four)",
    method: method({ orient: "long-axis" }),
    subset: (g) => g.orientTouched,
    strata: { lying: (g) => g.lying, "squat upright": (g) => !g.lying },
  },
  clip: {
    what: "polygon trimmed to the part inside the photo",
    method: method({ clip: true }),
    subset: (g) => !g.orientTouched && !g.inFrame,
    strata: { "partly out of frame": () => true },
  },
  face: {
    what: "spine face from the mask outline (sides fitted, second plane trimmed), perspective-warped by the readers",
    method: method({ clip: true, face: true }),
    subset: flagged,
    strata: { "in frame": (g) => g.inFrame, "partly out of frame": (g) => !g.inFrame },
  },
  pad: {
    what: `each end lengthened by ${PAD * 100} % of the spine along its long axis`,
    method: method({ clip: true, pad: PAD }),
    subset: flagged,
    strata: { "in frame": (g) => g.inFrame, "partly out of frame": (g) => !g.inFrame },
  },
  remask: {
    what: "control for face: the re-derived mask's minimum-area rectangle, no side fit or trim (not a ship candidate)",
    method: method({ clip: true }),
    subset: flagged,
    strata: { "in frame": (g) => g.inFrame, "partly out of frame": (g) => !g.inFrame },
    remask: true,
  },
};

/** The spine as a variant cuts it: the remask control swaps in the re-derived mask's rectangle. */
function asVariant<S extends Detection["spines"][number]>(v: Variant, s: S): S {
  return v.remask && s.outline ? { ...s, polygon: rectQuad(minAreaRect(s.outline)) as S["polygon"] } : s;
}

const firstPassHard = (d: SpineDecision) => d.hard && Boolean(d.readText.vision || d.readText.ppocr);

async function run(set: SetName, variant: string): Promise<void> {
  const v = VARIANTS[variant];
  if (!v) throw new Error(`variant must be one of ${Object.keys(VARIANTS).join(", ")}`);
  const cfg = SETS[set];
  const { dets, images, before } = loadSet(set);
  const geo = geometry(dets);
  for (const d of dets.values()) d.spines = d.spines.map((s) => asVariant(v, s));
  const subset = new Set(geo.filter(v.subset).map((g) => g.id));
  const dir = join(PRIV, set, variant);
  mkdirSync(dir, { recursive: true });
  log(`${set} ${variant}: ${subset.size} boxes, crop ${cropName(v.method)}`);
  const t0 = Date.now();
  await visionStage(images, dets, dir, log, v.method, subset);
  await pyReaderStage("ppocr", images, dets, dir, log, subset, v.method);
  const db = openCatalog(cfg.catalog);
  const cache = new Map<string, Candidate | undefined>();
  const byGeo = new Map(geo.map((g) => [g.id, g]));
  const decideAll = () => {
    const readings = loadReadings(dir, v.method);
    return new Map([...subset].map((id) => [id, decide(db, id, byGeo.get(id)!.imageId, byGeo.get(id)!.boxScore, readings.get(id) ?? {}, cache)]));
  };
  // F-0's Qwen selection, per photo: hard crops with text, highest box score first, up to the cap. Boxes outside
  // the subset keep their cached first-pass state.
  const first = decideAll();
  const selected = new Set<string>();
  for (const img of images) {
    const ids = geo.filter((g) => g.imageId === img.id).map((g) => g.id);
    ids
      .filter((id) => (subset.has(id) ? firstPassHard(first.get(id)!) : before.has(id) && firstPassHard(before.get(id)!)))
      .sort((a, b) => byGeo.get(b)!.boxScore - byGeo.get(a)!.boxScore)
      .slice(0, cfg.qwenCap)
      .filter((id) => subset.has(id))
      .forEach((id) => selected.add(id));
  }
  log(`${set} ${variant}: qwen on ${selected.size} hard crops`);
  await pyReaderStage("qwen", images, dets, dir, log, selected, v.method);
  // The cached Qwen reading of a box no longer selected must not leak into the decision.
  const readings = loadReadings(dir, v.method);
  const after = [...subset].map((id) => {
    const r = { ...(readings.get(id) ?? {}) };
    if (!selected.has(id)) delete r.qwen;
    return decide(db, id, byGeo.get(id)!.imageId, byGeo.get(id)!.boxScore, r, cache);
  });
  writeFileSync(
    join(dir, "decisions.jsonl"),
    after.map((d) => JSON.stringify({ ...d, accepted: d.accepted && { workId: d.accepted.workId, score: d.accepted.score, queryCoverage: d.accepted.queryCoverage }, qwenSelected: selected.has(d.id) })).join("\n") + "\n",
  );
  log(`${set} ${variant}: done in ${Math.round((Date.now() - t0) / 1000)} s`);
}

// --- analysis --------------------------------------------------------------------------------------------

interface Pair {
  id: string;
  imageId: string;
  before: Outcome;
  after: Outcome;
}

const textRead = (o: Outcome) => o !== "unknown:no-text";
const confirmed = (o: Outcome) => o === "confirmed";
const wrong = (o: Outcome) => o === "rejected/wrong";

/** Paired change in a share over the same boxes, with a 95 % photo-cluster bootstrap interval, in points. */
function delta(rows: Pair[], pred: (o: Outcome) => boolean, seed: number) {
  const share = (rs: Pair[], k: "before" | "after") => (rs.length ? rs.filter((r) => pred(r[k])).length / rs.length : null);
  const b = clusterBootstrap(rows, (rs) => share(rs, "before"), REPS, seed);
  const a = clusterBootstrap(rows, (rs) => share(rs, "after"), REPS, seed);
  const d = clusterBootstrap(rows, (rs) => (rs.length ? share(rs, "after")! - share(rs, "before")! : null), REPS, seed);
  const pts = (x: number) => Math.round(x * 1000) / 10;
  return d && a && b ? { before: pts(b.value), after: pts(a.value), delta: pts(d.value), lo: pts(d.lo), hi: pts(d.hi) } : null;
}

/** Reader calls (one crop at one rotation) and summed reader seconds over a set of boxes. */
function cost(readings: Map<string, Partial<Record<ReaderName, Reading>>>, ids: Iterable<string>, qwenUsed: (id: string) => boolean) {
  const out: Record<string, { calls: number; seconds: number }> = {};
  for (const reader of ["vision", "ppocr", "qwen"] as ReaderName[]) {
    let calls = 0, seconds = 0;
    for (const id of ids) {
      const r = readings.get(id)?.[reader];
      if (!r || (reader === "qwen" && !qwenUsed(id))) continue;
      calls += new Set(r.variants.map((x) => x.rotation)).size || (r.error ? 0 : 1);
      seconds += r.seconds;
    }
    out[reader] = { calls, seconds: Math.round(seconds) };
  }
  return out;
}

function analyse(): void {
  const truth = yardstickTruth();
  const metrics: Record<string, unknown> = {};
  const results: Record<string, Record<string, any>> = {};
  for (const set of Object.keys(SETS) as SetName[]) {
    const { dets, before, outlines } = loadSet(set);
    const geo = geometry(dets);
    const byGeo = new Map(geo.map((g) => [g.id, g]));
    const tr = set === "pilot-000" ? undefined : truth;
    const beforeReads = loadReadings(join(ROOT, "f0", set));
    const out: Record<string, any> = {
      scope: SETS[set].scope,
      boxCount: geo.length,
      photos: dets.size,
      outlines,
      geometry: {
        lying: geo.filter((g) => g.lying).length,
        squatUpright: geo.filter((g) => g.squat && !g.lying).length,
        partlyOutOfFrame: geo.filter((g) => !g.inFrame).length,
        edge: geo.filter((g) => g.edge).length,
        oblique: geo.filter((g) => g.oblique).length,
        topFaceTrimmed: geo.filter((g) => g.face && (g.face.trim[0] > 0 || g.face.trim[1] > 0)).length,
        flagged: geo.filter(flagged).length,
        cutOrPartial: geo.filter((g) => g.piece).length,
      },
      variants: {} as Record<string, unknown>,
    };
    const after: Record<string, Map<string, SpineDecision & { qwenSelected?: boolean }>> = {};
    for (const [name, v] of Object.entries(VARIANTS)) {
      const path = join(PRIV, set, name, "decisions.jsonl");
      if (!existsSync(path)) continue;
      const dec = new Map(readJsonl<SpineDecision & { qwenSelected?: boolean }>(path).map((d) => [d.id, d]));
      after[name] = dec;
      const ids = geo.filter(v.subset).map((g) => g.id);
      if (ids.some((id) => !dec.has(id))) throw new Error(`${set} ${name}: decisions do not cover the subset; re-run it`);
      const pairs = (sel: (g: Geo) => boolean, base?: Map<string, SpineDecision>): Pair[] =>
        ids
          .filter((id) => sel(byGeo.get(id)!))
          .map((id) => ({ id, imageId: byGeo.get(id)!.imageId, before: outcomeOf((base ?? before).get(id)!, tr?.get(byGeo.get(id)!.imageId)), after: outcomeOf(dec.get(id)!, tr?.get(byGeo.get(id)!.imageId)) }));
      const summary = (rows: Pair[], seed: number) => ({
        boxCount: rows.length,
        photos: new Set(rows.map((r) => r.imageId)).size,
        textRead: delta(rows, textRead, seed),
        confirmed: delta(rows, confirmed, seed + 1),
        ...(tr ? { wrong: delta(rows, wrong, seed + 2) } : {}),
      });
      const afterReads = loadReadings(join(PRIV, set, name), v.method);
      const changed = ids.filter((id) => {
        const s = dets.get(byGeo.get(id)!.imageId)!.spines[Number(id.slice(id.lastIndexOf(":") + 1))]!;
        const a = cropFor(asVariant(v, s), dets.get(byGeo.get(id)!.imageId)!, v.method), b = cropFor(s, dets.get(byGeo.get(id)!.imageId)!, F0_CROP)!;
        return !a || JSON.stringify(a.rotations) !== JSON.stringify(b.rotations) || a.polygon.some((p, k) => Math.hypot(p[0] - b.polygon[k]![0], p[1] - b.polygon[k]![1]) > 1);
      }).length;
      results[set] ??= {};
      results[set]![name] = {
        what: v.what,
        cropMethod: v.remask ? `rect(re-derived mask);${cropName(v.method).split(";").slice(1).join(";")}` : cropName(v.method),
        ...(v.remask ? { control: true } : {}),
        cropChanged: changed,
        all: summary(pairs(() => true), 11),
        strata: Object.fromEntries(Object.entries(v.strata).map(([k, f], i) => [k, summary(pairs(f), 21 + 3 * i)])),
        // Split for F-0e, which re-tiles detection so fewer boxes are pieces: lifts on whole boxes are the ones that carry over.
        byBox: { whole: summary(pairs((g) => !g.piece), 51), cutOrPartial: summary(pairs((g) => g.piece), 54) },
        ...(name === "face" || name === "pad" || name === "remask"
          ? after.clip ? { outOfFrameVsClip: summary(pairs((g) => !g.inFrame, after.clip), 41) } : {}
          : {}),
        cost: {
          before: cost(beforeReads, ids, (id) => "qwen" in (before.get(id)?.top ?? {})),
          after: cost(afterReads, ids, (id) => Boolean(dec.get(id)?.qwenSelected)),
        },
      };
    }
    out.variants = results[set] ?? {};
    metrics[set] = out;
  }
  // Keep rule (card F-0b): the pilot-000 interval for the confirmed share excludes 0 upward, and on the yardstick
  // neither the confirmed share falls nor the wrong-accept share rises beyond its interval.
  const verdicts: Record<string, unknown> = {};
  for (const name of Object.keys(VARIANTS).filter((n) => !VARIANTS[n]!.remask)) {
    const p = results["pilot-000"]?.[name]?.all, y = results["yardstick-library-b2"]?.[name]?.all;
    if (!p || !y) continue;
    const pilotUp = p.confirmed && p.confirmed.lo > 0;
    const yardOk = (!y.confirmed || y.confirmed.hi >= 0) && (!y.wrong || y.wrong.lo <= 0);
    verdicts[name] = { keep: Boolean(pilotUp && yardOk), pilotConfirmedExcludesZero: Boolean(pilotUp), yardstickNotHurt: yardOk };
  }
  const m = {
    runId: "F0b",
    card: "F-0b",
    date: new Date().toLocaleDateString("en-CA"),
    shippedCrop: cropName(CROP),
    previousCrop: cropName(F0_CROP),
    bootstrap: { unit: "photo (cluster), paired: the same boxes before and after", reps: REPS, interval: "95 % percentile", units: "percentage points" },
    thresholds: { ambiguousAspect: AMBIGUOUS_ASPECT, edgeRadial: EDGE_RADIAL, pad: PAD, faceDefaults: "src/perceive/crop.ts FACE" },
    keepRule: "keep when the pilot-000 confirmed-share interval excludes 0 upward and the yardstick's confirmed share does not fall, nor its wrong-accept share rise, beyond its interval",
    verdicts,
    sets: metrics,
  };
  const dir = join(REPO, "evals", "F0b");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "metrics.json"), compactJson(m) + "\n");
  // report.md: the hand-written findings above the marker are kept; the tables below it are regenerated.
  const reportPath = join(dir, "report.md");
  const head = existsSync(reportPath) ? readFileSync(reportPath, "utf8").split(MARKER)[0]! : "# F0b: reader-crop geometry (F-0b)\n\n";
  writeFileSync(reportPath, head + MARKER + "\n\n" + tables(m) + "\n");
  log("aggregates -> evals/F0b/{metrics.json,report.md}");
}

const MARKER = "<!-- generated by src/eval/f0b-cli.ts analyse: edit above this line -->";

function tables(m: { verdicts: Record<string, any>; sets: Record<string, any> }): string {
  type D = { before: number; after: number; delta: number; lo: number; hi: number } | null | undefined;
  const fmt = (d: D) => (d ? `${d.before} → ${d.after} (${d.delta >= 0 ? "+" : ""}${d.delta}; ${d.lo} to ${d.hi})` : "—");
  const out: string[] = [];
  for (const [set, s] of Object.entries(m.sets)) {
    const yard = set !== "pilot-000";
    out.push(`## ${set} (${s.scope})`, "");
    const g = s.geometry;
    out.push(
      `${s.boxCount} boxes in ${s.photos} photos; mask outlines for ${s.outlines}. Lying ${g.lying}, squat upright ${g.squatUpright}, partly out of frame ${g.partlyOutOfFrame}, at the frame's edge ${g.edge}, oblique by the mask ${g.oblique} (a second plane trimmed: ${g.topFaceTrimmed}); flagged for the face and pad tests ${g.flagged}; cut by a tile edge or under ${Math.round(PARTIAL_BAND * 100)} % of their band\'s height ${g.cutOrPartial}.`,
      "",
      `Shares in % of the boxes in each row, before → after (Δ points; 95 % paired photo-bootstrap interval). ${yard ? "Confirmed = accepted and annotated in the image; wrong = accepted, not annotated." : "Machine agreement, never accuracy (INV-17)."}`,
      "",
      `| variant | boxes | photos | crop changed | text-read | confirmed |${yard ? " wrong |" : ""}`,
      `|---|---:|---:|---:|---|---|${yard ? "---|" : ""}`,
    );
    for (const [name, v] of Object.entries<any>(s.variants)) {
      const row = (label: string, x: any, changed = "") => `| ${label} | ${x.boxCount} | ${x.photos} | ${changed} | ${fmt(x.textRead)} | ${fmt(x.confirmed)} |${yard ? ` ${fmt(x.wrong)} |` : ""}`;
      out.push(row(`**${name}**`, v.all, String(v.cropChanged)));
      for (const [k, x] of Object.entries<any>(v.strata)) if (Object.keys(v.strata).length > 1) out.push(row(`  ${name}: ${k}`, x));
      out.push(row(`  ${name}: whole boxes`, v.byBox.whole), row(`  ${name}: cut or partial boxes`, v.byBox.cutOrPartial));
      if (v.outOfFrameVsClip) out.push(row(`  ${name}: out of frame, vs clip`, v.outOfFrameVsClip));
    }
    out.push("", "Cost on the same boxes, before → after: reader calls (one crop at one rotation) and summed reader seconds.", "", "| variant | Vision calls | Vision s | PP-OCR calls | PP-OCR s | Qwen calls | Qwen s |", "|---|---:|---:|---:|---:|---:|---:|");
    for (const [name, v] of Object.entries<any>(s.variants)) {
      const c = (r: string, k: "calls" | "seconds") => `${v.cost.before[r][k]} → ${v.cost.after[r][k]}`;
      out.push(`| ${name} | ${c("vision", "calls")} | ${c("vision", "seconds")} | ${c("ppocr", "calls")} | ${c("ppocr", "seconds")} | ${c("qwen", "calls")} | ${c("qwen", "seconds")} |`);
    }
    out.push("");
  }
  out.push("## Verdicts", "", "| variant | pilot-000 confirmed interval excludes 0 upward | yardstick not hurt | keep |", "|---|---|---|---|");
  for (const [name, v] of Object.entries<any>(m.verdicts)) out.push(`| ${name} | ${v.pilotConfirmedExcludesZero ? "yes" : "no"} | ${v.yardstickNotHurt ? "yes" : "no"} | **${v.keep ? "keep" : "off"}** |`);
  return out.join("\n");
}

// --- renders (private) -----------------------------------------------------------------------------------

function render(): void {
  const py = join(REPO, "helpers", "label", ".venv", "bin", "python");
  for (const set of Object.keys(SETS) as SetName[]) {
    const { dets, images, before } = loadSet(set);
    const geo = geometry(dets);
    const tr = set === "pilot-000" ? undefined : yardstickTruth();
    const boxes: unknown[] = [];
    for (const [name, v] of Object.entries(VARIANTS)) {
      const path = join(PRIV, set, name, "decisions.jsonl");
      if (!existsSync(path)) continue;
      const dec = new Map(readJsonl<SpineDecision>(path).map((d) => [d.id, d]));
      for (const g of geo.filter(v.subset)) {
        const d = dets.get(g.imageId)!, i = Number(g.id.slice(g.id.lastIndexOf(":") + 1));
        const a = cropFor(asVariant(v, d.spines[i]!), d, v.method), b = cropFor(d.spines[i]!, d, F0_CROP)!;
        boxes.push({
          variant: name, id: g.id, imageId: g.imageId, image: images.find((x) => x.id === g.imageId)!.path,
          before: { polygon: b.polygon, rotations: b.rotations, outcome: outcomeOf(before.get(g.id)!, tr?.get(g.imageId)) },
          after: a && { polygon: a.polygon, rotations: a.rotations, outcome: outcomeOf(dec.get(g.id)!, tr?.get(g.imageId)) },
          outline: d.spines[i]!.outline ?? null, trim: g.face?.trim ?? null, edge: g.edge, oblique: g.oblique, inFrame: g.inFrame,
        });
      }
    }
    const out = join(PRIV, "renders", set);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "boxes.jsonl"), boxes.map((b) => JSON.stringify(b)).join("\n") + "\n");
    // Not isolated (-I): the script imports read.py's crop from its own folder.
    const r = spawnSync(py, [join(REPO, "helpers", "label", "render_f0b.py"), "--boxes", join(out, "boxes.jsonl"), "--out", out, "--label", set], { stdio: ["ignore", "inherit", "inherit"] });
    if (r.status !== 0) throw new Error(`render_f0b.py failed on ${set}`);
  }
  log("renders written under the data root's private/f0b/renders/");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, set, variant] = process.argv.slice(2);
  if (cmd === "run" && set && set in SETS && variant) await run(set as SetName, variant);
  else if (cmd === "analyse") analyse();
  else if (cmd === "render") render();
  else {
    console.error("usage: f0b-cli.ts run <pilot-000|yardstick-library-b2> <orient|clip|face|pad|remask> | analyse | render");
    process.exit(2);
  }
}
