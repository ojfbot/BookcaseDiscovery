// Q-1 runner: per-spine capture-quality features joined to F-0's outcomes, then aggregate curves, AUCs,
// descriptive models, heatmaps and candidate thresholds.
//
//   node src/eval/q1-cli.ts features   # helpers/coverage over F-0's cached detections (pilot-000, yardstick arms)
//   node src/eval/q1-cli.ts analyse    # evals/Q1/{metrics.json,report.md}; per-spine table and scores stay private
//   node src/eval/q1-cli.ts render     # private overlay renders of photos by outcome and by modelled readability
//
// Inputs are F-0's stage folders under the data root (`f0/<set>/`). Everything per spine or per photo is
// written under the data root's `private/q1/`; only aggregates reach the repo.
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { normalize } from "../catalog/normalize.ts";
import { dataRoot, ImageStore } from "../ledger/images.ts";
import {
  OUTCOMES,
  byImage,
  clusterBootstrap,
  curve,
  fitLogistic,
  fitTree,
  heatmap,
  predictLogistic,
  predictTree,
  quantile,
  rate,
  separation,
  spearman,
  splitByImage,
  treeLines,
  auc,
} from "./q1.ts";
import type { Outcome, Row } from "./q1.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HELPER = join(REPO, "helpers", "coverage");
const ROOT = dataRoot();
const PRIV = join(ROOT, "private", "q1");
const PILOT = "pilot-000";
const ARMS = ["b1", "b2", "b3", "b4"] as const;
const YARD = (arm: string) => `yardstick-library-${arm}`;
const SETS = [PILOT, ...ARMS.map(YARD)];
const REPS = 1000;

const log = (s: string) => process.stderr.write(`q1: ${s}\n`);
const r4 = (x: number) => Math.round(x * 10000) / 10000;
const readJsonl = <T>(p: string): T[] => readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T);

interface Detection { id: string; width: number; height: number; spines: unknown[] }
export interface Decision { id: string; imageId: string; accepted: { workId: string } | null; reason: string | null }
export interface Reading { id: string; variants: { text: string; confidence: number }[] }

// --- features ------------------------------------------------------------------------------------------

function imageList(set: string, dets: Detection[]): { id: string; image: string }[] {
  if (set === PILOT) {
    const store = new ImageStore(ROOT);
    return dets.map((d) => {
      const p = store.find(d.id); // pilot detect ids are working-copy hashes
      if (!p) throw new Error(`working copy missing from the image store: ${d.id.slice(0, 12)}`);
      return { id: d.id, image: p };
    });
  }
  const dir = join(ROOT, "proxy", "library-dataset", "images");
  return dets.map((d) => ({ id: d.id, image: join(dir, `${d.id}.jpg`) }));
}

function features(): void {
  const py = join(HELPER, ".venv", "bin", "python");
  if (!existsSync(py)) throw new Error("helpers/coverage has no .venv: run `uv sync` there first");
  mkdirSync(join(PRIV, "features"), { recursive: true });
  for (const set of SETS) {
    const detPath = join(ROOT, "f0", set, "detect.jsonl");
    const dets = readJsonl<Detection>(detPath);
    const list = join(PRIV, "features", `${set}.images.jsonl`);
    writeFileSync(list, imageList(set, dets).map((r) => JSON.stringify(r)).join("\n") + "\n");
    const out = join(PRIV, "features", `${set}.jsonl`);
    const fd = openSync(out, "w");
    log(`${set}: ${dets.length} photos`);
    const r = spawnSync(py, ["-I", join(HELPER, "features.py"), "--detect", detPath, "--images", list], { stdio: ["ignore", fd, "inherit"] });
    closeSync(fd);
    if (r.status !== 0) throw new Error(`features.py failed on ${set}`);
  }
}

// --- outcomes ------------------------------------------------------------------------------------------

/** Minimal RFC 4180 reader: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head!.map((h, j) => [h, r[j] ?? ""])));
}

/** Annotated works per yardstick image, mapped to inventory work ids the way F-0's yardstick does. */
export function yardstickTruth(): Map<string, Set<string>> {
  const lib = join(ROOT, "proxy", "library-dataset");
  const cleanTitle = (t: string) => t.replace(/\s+:\s+/g, ": ").replace(/\s+/g, " ").trim(); // as in F-0
  const inv = parseCsv(readFileSync(join(lib, "data", "target_lists", "library_books.csv"), "utf8"));
  const byIsbn = new Map<string, string>(), byTitle = new Map<string, string>();
  inv.forEach((b, i) => {
    const isbn = (b.isbn ?? "").replace(/\D/g, "");
    if (isbn) byIsbn.set(isbn, String(i + 1));
    byTitle.set(normalize(cleanTitle(b.title ?? "")), String(i + 1));
  });
  const db = new DatabaseSync(join(lib, "f0-inventory-catalog.sqlite"), { readOnly: true });
  const works = new Set((db.prepare("SELECT id FROM works").all() as { id: string }[]).map((r) => r.id));
  db.close();
  const gt = new Map<string, Set<string>>();
  for (const a of parseCsv(readFileSync(join(lib, "data", "annotations", "library_books_annotations.csv"), "utf8"))) {
    if (a.not_book === "True") continue;
    const id = a.image_name!.replace(/\.jpg$/i, "");
    const g = gt.get(id) ?? new Set<string>();
    const t = byIsbn.get((a.isbn ?? "").replace(/\D/g, "")) ?? byTitle.get(normalize(cleanTitle(a.title ?? "")));
    if (t && works.has(`isfdb:${t}`)) g.add(`isfdb:${t}`);
    gt.set(id, g);
  }
  return gt;
}

export function outcomeOf(d: Decision, truth?: Set<string>): Outcome {
  if (d.accepted) return !truth || truth.has(d.accepted.workId) ? "confirmed" : "rejected/wrong";
  const o = `unknown:${d.reason}` as Outcome;
  if (!OUTCOMES.includes(o)) throw new Error(`unknown decision reason: ${d.reason}`);
  return o;
}

/** The numeric features analysed, by family. Reader-side ones are outcome-adjacent and kept out of models. */
const FAMILIES: Record<string, string[]> = {
  resolution: ["shortPx", "longPx", "aspect", "megapixels"],
  rotation: ["absLongAxisDeg", "offAxisDeg", "lying"],
  sharpness: ["lapVar", "lapVarNorm", "lapVarRel", "blurRatio", "edgeDensity", "imgLapVar"],
  exposure: ["mean", "rmsContrast", "p95p5", "highlightFrac", "shadowFrac"],
  colour: ["saturation", "value"],
  position: ["radial", "edgeDist", "cx", "cy", "outFrac"],
  shelfBand: ["inBand", "bandEnd", "bandAcross", "bandSpineCount"],
  detector: ["boxScore", "maskScore"],
  readerSide: ["ppocrAny", "ppocrConf"],
};
const FEATURES = Object.values(FAMILIES).flat();
/** Chosen before looking at results: one per brief axis (resolution, sharpness, contrast, glare, position). */
const MODEL = ["shortPx", "lapVar", "rmsContrast", "highlightFrac", "radial"];
const LOGGED = new Set(["shortPx", "lapVar"]);

export type Raw = Record<string, unknown> & { id: string; imageId: string; image: Record<string, number> };

function rowsFor(set: string, truth: Map<string, Set<string>> | null): Row[] {
  return rowsFrom(
    readJsonl<Raw>(join(PRIV, "features", `${set}.jsonl`)),
    new Map(readJsonl<Decision>(join(ROOT, "f0", set, "decisions.jsonl")).map((d) => [d.id, d])),
    new Map(readJsonl<Reading>(join(ROOT, "f0", set, "ppocr.jsonl")).map((r) => [r.id, r])),
    truth,
  );
}

/** Q-1's per-box rows from features.py output, F-0-shaped decisions and PP-OCR readings (Q-2b reuses it on other boxes). */
export function rowsFrom(feats: Raw[], dec: Map<string, Decision>, pp: Map<string, Reading>, truth: Map<string, Set<string>> | null): Row[] {
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "boolean" ? Number(v) : null);
  // Each photo's median spine lapVar, so lapVarRel says "crisper or softer than the rest of this photo".
  const medLap = new Map<string, number>();
  for (const g of byImage(feats)) {
    medLap.set(g[0]!.imageId, quantile(g.map((x) => num(x.lapVar)).filter((v): v is number => v !== null).sort((a, b) => a - b), 0.5));
  }
  return feats.map((x) => {
    const d = dec.get(x.id);
    if (!d) throw new Error("no decision for a detected spine");
    const p = pp.get(x.id);
    const conf = p ? Math.max(0, ...p.variants.filter((v) => v.text.trim()).map((v) => v.confidence)) : null;
    const f: Record<string, number | null> = {};
    for (const k of FEATURES) f[k] = num(x[k]);
    f.megapixels = num(x.image.megapixels);
    f.imgLapVar = num(x.image.imgLapVar);
    f.absLongAxisDeg = num(x.longAxisDeg) === null ? null : Math.abs(num(x.longAxisDeg)!);
    f.lapVarRel = f.lapVar === null ? null : f.lapVar / (medLap.get(x.imageId) || 1);
    f.inBand = x.band === null ? 0 : 1;
    f.bandSpineCount = num(x.bandSpines);
    f.ppocrAny = p ? Number(p.variants.some((v) => v.text.trim() !== "")) : null;
    f.ppocrConf = conf;
    return { id: x.id, imageId: x.imageId, outcome: outcomeOf(d, truth?.get(d.imageId)), f };
  });
}

// --- analysis --------------------------------------------------------------------------------------------

const isConf = (o: Outcome) => o === "confirmed";
const isNoText = (o: Outcome) => o === "unknown:no-text";
const isNoMatch = (o: Outcome) => o === "unknown:no-catalog-match";
const notConf = (o: Outcome) => o !== "confirmed";
const CONTRASTS = {
  confirmedVsNoText: [isConf, isNoText],
  confirmedVsNoCatalogMatch: [isConf, isNoMatch],
  confirmedVsRest: [isConf, notConf],
} as const;

function outcomeCounts(rows: Row[]) {
  const c: Record<string, number> = {};
  for (const o of OUTCOMES) c[o] = 0;
  for (const r of rows) c[r.outcome]!++;
  return c;
}

function aucTable(rows: Row[], contrasts: (keyof typeof CONTRASTS)[] = ["confirmedVsNoText", "confirmedVsNoCatalogMatch", "confirmedVsRest"]) {
  const out: Record<string, Record<string, ReturnType<typeof separation>>> = {};
  for (const c of contrasts) {
    const [pos, neg] = CONTRASTS[c];
    out[c] = Object.fromEntries(FEATURES.map((f) => [f, separation(rows, f, pos, neg, REPS)]));
  }
  return out;
}

const modelX = (r: Row) => MODEL.map((f) => (LOGGED.has(f) ? Math.log1p(r.f[f]!) : r.f[f]!));
const complete = (r: Row) => MODEL.every((f) => r.f[f] !== null && Number.isFinite(r.f[f]!));

/** Logistic regression and depth-3 tree, confirmed (1) vs no-text (0), fit on two thirds of pilot-000's photos. */
function models(pilot: Row[], others: Record<string, Row[]>) {
  const use = pilot.filter((r) => (isConf(r.outcome) || isNoText(r.outcome)) && complete(r));
  const { train, test } = splitByImage(use, 3);
  const y = (rs: Row[]) => rs.map((r) => (isConf(r.outcome) ? 1 : 0));
  const lr = fitLogistic(train.map(modelX), y(train), MODEL);
  const tree = fitTree(train.map((r) => r.f), y(train), MODEL, 3, 40);
  const score = (rs: Row[], pred: (r: Row) => number) =>
    clusterBootstrap(rs, (s) => auc(s.filter((r) => isConf(r.outcome)).map(pred), s.filter((r) => isNoText(r.outcome)).map(pred)), REPS, 5);
  const t3 = (b: ReturnType<typeof score>) => (b ? [r4(b.value), r4(b.lo), r4(b.hi)] : null);
  const transfer: Record<string, unknown> = {};
  for (const [set, rs] of Object.entries(others)) {
    const u = rs.filter((r) => (isConf(r.outcome) || isNoText(r.outcome)) && complete(r));
    transfer[set] = { n: u.length, logisticAuc: t3(score(u, (r) => predictLogistic(lr, modelX(r)))), treeAuc: t3(score(u, (r) => predictTree(tree, r.f))) };
  }
  return {
    target: "confirmed (1) vs unknown:no-text (0)",
    features: MODEL.map((f) => (LOGGED.has(f) ? `log1p(${f})` : f)),
    split: "pilot-000 photos in sorted id order, every third held out",
    train: { photos: new Set(train.map((r) => r.imageId)).size, n: train.length, positives: y(train).reduce((a: number, b) => a + b, 0) },
    test: { photos: new Set(test.map((r) => r.imageId)).size, n: test.length, positives: y(test).reduce((a: number, b) => a + b, 0) },
    logistic: {
      // Weights on standardised features (z-scores of the train split): sign and size are comparable.
      intercept: r4(lr.weights[0]!),
      weights: Object.fromEntries(lr.features.map((f, j) => [LOGGED.has(f) ? `log1p(${f})` : f, r4(lr.weights[j + 1]!)])),
      heldOutAuc: t3(score(test, (r) => predictLogistic(lr, modelX(r)))),
      trainAuc: t3(score(train, (r) => predictLogistic(lr, modelX(r)))),
    },
    tree: { rules: treeLines(tree), heldOutAuc: t3(score(test, (r) => predictTree(tree, r.f))), trainAuc: t3(score(train, (r) => predictTree(tree, r.f))) },
    transferToYardstick: transfer,
    lr,
    treeModel: tree,
  };
}

/**
 * Candidate threshold for one feature on the pilot: the decile cut that best splits the text-read rate
 * (outcome other than no-text), by the size-weighted difference. A hypothesis to re-test, not a fitted value.
 */
function threshold(rows: Row[], feature: string, check: Row[] | null) {
  const has = rows.filter((r) => r.f[feature] !== null && Number.isFinite(r.f[feature]!));
  const vals = has.map((r) => r.f[feature]!).sort((a, b) => a - b);
  const textRead = (o: Outcome) => !isNoText(o);
  let best: { cut: number; score: number } | null = null;
  for (let q = 1; q < 10; q++) {
    const cut = quantile(vals, q / 10);
    const lo = has.filter((r) => r.f[feature]! < cut), hi = has.filter((r) => r.f[feature]! >= cut);
    if (lo.length < 50 || hi.length < 50) continue;
    const a = lo.filter((r) => textRead(r.outcome)).length / lo.length, b = hi.filter((r) => textRead(r.outcome)).length / hi.length;
    const score = Math.abs(b - a) * Math.sqrt((lo.length * hi.length) / has.length);
    if (!best || score > best.score) best = { cut, score };
  }
  if (!best) return null;
  const cut = best.cut;
  const side = (rs: Row[]) => {
    const below = (r: Row) => r.f[feature] !== null && r.f[feature]! < cut;
    const above = (r: Row) => r.f[feature] !== null && r.f[feature]! >= cut;
    const t = (b: { value: number; lo: number; hi: number } | null): [number, number, number] | null => (b ? [r4(b.value), r4(b.lo), r4(b.hi)] : null);
    return {
      below: { n: rs.filter(below).length, textRead: t(clusterBootstrap(rs, rate((r) => textRead(r.outcome), below), REPS, 3)), confirmed: t(clusterBootstrap(rs, rate((r) => isConf(r.outcome), below), REPS, 4)) },
      atOrAbove: { n: rs.filter(above).length, textRead: t(clusterBootstrap(rs, rate((r) => textRead(r.outcome), above), REPS, 5)), confirmed: t(clusterBootstrap(rs, rate((r) => isConf(r.outcome), above), REPS, 6)) },
    };
  };
  return { feature, cut: r4(cut), pilot: side(has), yardstickB2: check ? side(check.filter((r) => r.f[feature] !== null)) : null };
}

/** (b) per-image title recall (yardstick) or confirmed share (pilot) against image-level features. */
function imageLevel(rows: Row[], truth: Map<string, Set<string>> | null, decisions: Decision[]) {
  const per = byImage(rows).map((g) => {
    const id = g[0]!.imageId;
    const med = (f: string) => quantile(g.map((r) => r.f[f]).filter((v): v is number => v !== null).sort((a, b) => a - b), 0.5);
    let y: number | null;
    if (truth) {
      const works = truth.get(id) ?? new Set();
      const pred = new Set(decisions.filter((d) => d.imageId === id && d.accepted).map((d) => d.accepted!.workId));
      y = works.size ? [...pred].filter((w) => works.has(w)).length / works.size : null;
    } else y = g.filter((r) => isConf(r.outcome)).length / g.length;
    const books = truth ? (truth.get(id)?.size ?? 0) : null;
    return {
      imageId: id,
      y,
      x: {
        megapixels: g[0]!.f.megapixels!,
        imgLapVar: g[0]!.f.imgLapVar!,
        detected: g.length,
        medianShortPx: med("shortPx"),
        medianLapVar: med("lapVar"),
        medianRmsContrast: med("rmsContrast"),
        medianMean: med("mean"),
        medianHighlightFrac: med("highlightFrac"),
        ...(truth ? { annotatedBooks: books!, detectedPerBook: books ? g.length / books : NaN } : {}),
      } as Record<string, number>,
    };
  }).filter((p) => p.y !== null);
  const keys = Object.keys(per[0]?.x ?? {});
  const out: Record<string, unknown> = { photos: per.length, outcome: truth ? "per-image title recall" : "per-photo confirmed share (machine agreement)" };
  for (const k of keys) {
    const pts = per.filter((p) => Number.isFinite(p.x[k]!));
    const b = clusterBootstrap(pts, (s) => spearman(s.map((p) => p.x[k]!), s.map((p) => p.y!)), REPS, 9);
    out[k] = b ? { spearman: [r4(b.value), r4(b.lo), r4(b.hi)] } : null;
  }
  return out;
}

function hueSectors(rows: Row[], set: string) {
  // Hue is circular, so it is binned into six sectors plus "grey" rather than by quantile.
  const feats = new Map(readJsonl<Raw>(join(PRIV, "features", `${set}.jsonl`)).map((x) => [x.id, x.hueDeg as number | null]));
  const names = ["red", "yellow", "green", "cyan", "blue", "magenta"];
  const out: Record<string, { n: number; confirmed: number | null; noText: number | null }> = {};
  for (const name of [...names, "grey"]) out[name] = { n: 0, confirmed: null, noText: null };
  const k: Record<string, [number, number]> = {};
  for (const r of rows) {
    const h = feats.get(r.id);
    const name = h === null || h === undefined ? "grey" : names[Math.floor(((h + 30) % 360) / 60)]!;
    out[name]!.n++;
    k[name] ??= [0, 0];
    if (isConf(r.outcome)) k[name]![0]++;
    if (isNoText(r.outcome)) k[name]![1]++;
  }
  for (const [name, v] of Object.entries(out)) if (v.n) { v.confirmed = r4(k[name]![0] / v.n); v.noText = r4(k[name]![1] / v.n); }
  return out;
}

function analyse(): void {
  const truth = yardstickTruth();
  const rows: Record<string, Row[]> = {};
  for (const set of SETS) rows[set] = rowsFor(set, set === PILOT ? null : truth);
  mkdirSync(join(PRIV, "table"), { recursive: true });
  for (const [set, rs] of Object.entries(rows)) writeFileSync(join(PRIV, "table", `${set}.jsonl`), rs.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const pilot = rows[PILOT]!, b2 = rows[YARD("b2")]!;
  log("curves");
  const curves = (rs: Row[]) => Object.fromEntries(FEATURES.map((f) => [f, curve(rs, f, 8, REPS)]));
  const sets: Record<string, unknown> = {};
  for (const set of SETS) {
    const rs = rows[set]!;
    const full = set === PILOT || set === YARD("b2");
    log(`${set}: AUCs${full ? ", curves, heatmaps" : ""}`);
    const decisions = readJsonl<Decision>(join(ROOT, "f0", set, "decisions.jsonl"));
    sets[set] = {
      role: set === PILOT ? "real-use, machine agreement only (INV-17, OC35)" : `yardstick PROXY, box arm ${set.slice(-2)}, truth = annotated titles per image`,
      photos: byImage(rs).length,
      detected: rs.length,
      outcomes: outcomeCounts(rs),
      auc: aucTable(rs, full ? undefined : ["confirmedVsNoText"]),
      ...(full
        ? {
            curves: curves(rs),
            hue: hueSectors(rs, set),
            heatmap: set === PILOT ? heatmap(rs, 6, 8) : heatmap(rs, 8, 6),
            heatmapNoText: set === PILOT ? heatmap(rs, 6, 8, isNoText) : heatmap(rs, 8, 6, isNoText),
            imageLevel: imageLevel(rs, set === PILOT ? null : truth, decisions),
          }
        : {}),
    };
  }
  // Controls: is the position effect only cut-off and lying spines? Is the detail effect only "no text there"?
  const upright = (r: Row) => r.f.outFrac === 0 && r.f.lying === 0;
  const controls: Record<string, unknown> = {};
  for (const set of [PILOT, YARD("b2")]) {
    const rs = rows[set]!;
    const up = rs.filter(upright);
    const read = rs.filter((r) => r.f.ppocrAny === 1);
    controls[set] = {
      inFrameUpright: { n: up.length, outcomes: outcomeCounts(up), confirmedVsNoText: Object.fromEntries(["radial", "edgeDist", "lapVar", "lapVarRel", "boxScore", "shortPx"].map((f) => [f, separation(up, f, isConf, isNoText, REPS)])) },
      ppocrReadText: { n: read.length, confirmedVsNoCatalogMatch: Object.fromEntries(["lapVar", "lapVarRel", "blurRatio", "shortPx", "rmsContrast", "radial"].map((f) => [f, separation(read, f, isConf, isNoMatch, REPS)])) },
      bySubset: Object.fromEntries(
        ([["lying", (r: Row) => r.f.lying === 1], ["partlyOutOfFrame", (r: Row) => (r.f.outFrac ?? 0) > 0], ["inFrameUpright", upright]] as const).map(([k, p]) => {
          const sub = rs.filter(p);
          const t = (b: ReturnType<typeof clusterBootstrap>) => (b ? [r4(b.value), r4(b.lo), r4(b.hi)] : null);
          return [k, { n: sub.length, confirmed: t(clusterBootstrap(rs, rate((r) => isConf(r.outcome), p), REPS, 21)), noText: t(clusterBootstrap(rs, rate((r) => isNoText(r.outcome), p), REPS, 22)) }];
        }),
      ),
    };
  }
  log("models");
  const m = models(pilot, { [YARD("b2")]: b2 });
  log("thresholds");
  const thresholds = ["shortPx", "lapVar", "lapVarNorm", "rmsContrast", "highlightFrac", "radial", "boxScore", "offAxisDeg"].map((f) => threshold(pilot, f, b2));
  // Private: per-spine modelled readability, for the renders.
  mkdirSync(join(PRIV, "scores"), { recursive: true });
  for (const set of [PILOT, YARD("b2")]) {
    writeFileSync(
      join(PRIV, "scores", `${set}.jsonl`),
      rows[set]!.map((r) => JSON.stringify({ id: r.id, outcome: r.outcome, p: complete(r) ? r4(predictLogistic(m.lr, modelX(r))) : null })).join("\n") + "\n",
    );
  }
  const { lr: _lr, treeModel: _t, ...model } = m;
  const metrics = {
    runId: "Q1",
    card: "Q-1",
    date: new Date().toLocaleDateString("en-CA"),
    question: "what in the image separates detected-and-confirmed from detected-but-unread or unmatched, and where failures cluster",
    inputs: "F-0 cached stage outputs: B2 detections for pilot-000 (31 photos); B1-B4 detections for 40 Library Dataset images (PROXY)",
    scope: "detected only: a book never detected cannot be located (the Library Dataset releases no book geometry)",
    bootstrap: { unit: "photo (cluster)", reps: REPS, interval: "95 % percentile" },
    outcomeClasses: OUTCOMES,
    families: FAMILIES,
    sets,
    controls,
    model,
    thresholds: thresholds.filter(Boolean),
  };
  const dir = join(REPO, "evals", "Q1");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "metrics.json"), compactJson(metrics) + "\n");
  // report.md: the hand-written part above the marker is kept; the tables below it are regenerated.
  const reportPath = join(dir, "report.md");
  const head = existsSync(reportPath) ? readFileSync(reportPath, "utf8").split(MARKER)[0]! : "# Q1: first failure-pattern pass\n\n";
  writeFileSync(reportPath, head + MARKER + "\n\n" + tables(metrics as unknown as Metrics));
  log(`aggregates -> evals/Q1/metrics.json, report.md`);
}

/** JSON with arrays of numbers (and nulls) kept on one line, so curves and grids stay readable and small. */
export function compactJson(v: unknown, indent = ""): string {
  if (Array.isArray(v)) {
    if (v.every((x) => x === null || typeof x !== "object")) return JSON.stringify(v);
    if (v.every((x) => Array.isArray(x) && x.every((y) => y === null || typeof y !== "object"))) {
      return `[\n${v.map((x) => `${indent} ${JSON.stringify(x)}`).join(",\n")}\n${indent}]`;
    }
    return `[\n${v.map((x) => `${indent} ${compactJson(x, indent + " ")}`).join(",\n")}\n${indent}]`;
  }
  if (v && typeof v === "object") {
    const e = Object.entries(v).filter(([, x]) => x !== undefined);
    if (e.length === 0) return "{}";
    return `{\n${e.map(([k, x]) => `${indent} ${JSON.stringify(k)}: ${compactJson(x, indent + " ")}`).join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(v);
}

// --- report tables -----------------------------------------------------------------------------------------

const MARKER = "<!-- Tables below are generated by `node src/eval/q1-cli.ts analyse`; edit above this line only. -->";
type Tri = [number, number, number] | null;
type Sep = { n: number; auc: Tri; separation: number; higherIsPos: boolean } | null;
type Grid = { cols: number; rows: number; count: number[][]; rate: (number | null)[][]; residual: (number | null)[][] };
interface SetM {
  role: string;
  photos: number;
  detected: number;
  outcomes: Record<string, number>;
  auc: Record<string, Record<string, Sep>>;
  curves?: Record<string, { bins: { lo: number; hi: number; n: number; confirmed: Tri; noText: Tri }[] }>;
  heatmap?: Grid;
  heatmapNoText?: Grid;
  imageLevel?: Record<string, unknown>;
}
interface Control {
  inFrameUpright: { n: number; confirmedVsNoText: Record<string, Sep> };
  ppocrReadText: { n: number; confirmedVsNoCatalogMatch: Record<string, Sep> };
  bySubset: Record<string, { n: number; confirmed: Tri; noText: Tri }>;
}
interface Metrics {
  sets: Record<string, SetM>;
  controls: Record<string, Control>;
  model: ReturnType<typeof models>;
  thresholds: NonNullable<ReturnType<typeof threshold>>[];
}

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "–" : `${(x * 100).toFixed(0)} %`);
const triPct = (t: Tri) => (t ? `${pct(t[0])} (${(t[1] * 100).toFixed(0)}–${(t[2] * 100).toFixed(0)})` : "–");
const triNum = (t: Tri, d = 2) => (t ? `${t[0].toFixed(d)} (${t[1].toFixed(d)}–${t[2].toFixed(d)})` : "–");
const short = (s: string) => (s === PILOT ? "pilot-000" : s.replace("yardstick-library-", "yard "));

function tables(m: Metrics): string {
  const out: string[] = [];
  const setNames = Object.keys(m.sets);
  out.push("## Outcomes per detected spine\n");
  out.push(`| set | photos | detected | ${OUTCOMES.join(" | ")} |`, `|---|---:|---:|${OUTCOMES.map(() => "---:").join("|")}|`);
  for (const s of setNames) {
    const v = m.sets[s]!;
    out.push(`| ${short(s)} | ${v.photos} | ${v.detected} | ${OUTCOMES.map((o) => `${v.outcomes[o]} (${pct(v.outcomes[o]! / v.detected)})`).join(" | ")} |`);
  }
  out.push("\n## Single-feature separation: confirmed vs no-text (AUC, 95 % photo-bootstrap interval)\n");
  out.push("AUC > 0.5: larger values go with confirmed. Sorted by pilot-000 separation |AUC − 0.5|. Reader-side features (PP-OCR) are part of the outcome and shown only for scale.\n");
  out.push(`| family | feature | ${setNames.map(short).join(" | ")} |`, `|---|---|${setNames.map(() => "---:").join("|")}|`);
  const fam = (f: string) => Object.entries(FAMILIES).find(([, fs]) => fs.includes(f))?.[0] ?? "";
  const pilotSep = (f: string) => m.sets[PILOT]!.auc.confirmedVsNoText![f]?.separation ?? 0;
  for (const f of [...FEATURES].sort((a, b) => pilotSep(b) - pilotSep(a))) {
    out.push(`| ${fam(f)} | ${f} | ${setNames.map((s) => triNum(m.sets[s]!.auc.confirmedVsNoText![f]?.auc ?? null)).join(" | ")} |`);
  }
  out.push("\n## Single-feature separation: confirmed vs no-catalog-match, and confirmed vs everything else\n");
  const two = [PILOT, YARD("b2")];
  out.push(`| feature | ${two.map((s) => `${short(s)} vs no-match`).join(" | ")} | ${two.map((s) => `${short(s)} vs rest`).join(" | ")} |`, "|---|---:|---:|---:|---:|");
  const sepM = (f: string) => m.sets[PILOT]!.auc.confirmedVsNoCatalogMatch![f]?.separation ?? 0;
  for (const f of [...FEATURES].sort((a, b) => sepM(b) - sepM(a))) {
    out.push(`| ${f} | ${two.map((s) => triNum(m.sets[s]!.auc.confirmedVsNoCatalogMatch![f]?.auc ?? null)).join(" | ")} | ${two.map((s) => triNum(m.sets[s]!.auc.confirmedVsRest![f]?.auc ?? null)).join(" | ")} |`);
  }
  out.push("\n## Outcome curves (octile bins): confirmed share and no-text share, 95 % photo-bootstrap interval\n");
  for (const f of ["lapVar", "lapVarNorm", "lapVarRel", "blurRatio", "radial", "edgeDist", "shortPx", "boxScore", "rmsContrast", "highlightFrac", "offAxisDeg", "bandEnd", "mean"]) {
    for (const s of two) {
      const c = m.sets[s]!.curves![f];
      if (!c) continue;
      out.push(`**${f}**, ${short(s)}\n`, "| bin | n | confirmed | no-text |", "|---|---:|---:|---:|");
      for (const b of c.bins) out.push(`| ${b.lo} – ${b.hi} | ${b.n} | ${triPct(b.confirmed)} | ${triPct(b.noText)} |`);
      out.push("");
    }
  }
  out.push("## Where failures cluster: per-photo-normalised failure residual (percentage points)\n");
  out.push("Each cell: share of spines centred there that are not confirmed, minus each photo's own failure share, pooled. Positive = worse than the photo's average. `·` = no spine. Grid oriented to the photos (pilot-000 portrait 6 × 8, yardstick landscape 8 × 6).\n");
  const cell = (x: number | null) => (x === null ? "·" : `${x >= 0 ? "+" : ""}${Math.round(x * 100)}`).padStart(4);
  for (const s of two) {
    const g = m.sets[s]!.heatmap!, t = m.sets[s]!.heatmapNoText!;
    out.push(`**${short(s)}**: not-confirmed residual · no-text residual · spines per cell\n`, "```");
    g.residual.forEach((row, r) => out.push(`${row.map(cell).join("")}   ${t.residual[r]!.map(cell).join("")}   ${g.count[r]!.map((n) => String(n).padStart(4)).join("")}`));
    out.push("```\n");
  }
  out.push("## Controls\n");
  out.push("Subsets: share confirmed and share no-text (95 % photo-bootstrap interval).\n");
  out.push(`| subset | ${two.map((s) => `${short(s)} n`).join(" | ")} | ${two.map((s) => `${short(s)} confirmed`).join(" | ")} | ${two.map((s) => `${short(s)} no-text`).join(" | ")} |`, "|---|---:|---:|---:|---:|---:|---:|");
  for (const k of ["lying", "partlyOutOfFrame", "inFrameUpright"]) {
    const c = two.map((s) => m.controls[s]!.bySubset[k]!);
    out.push(`| ${k} | ${c.map((x) => x.n).join(" | ")} | ${c.map((x) => triPct(x.confirmed)).join(" | ")} | ${c.map((x) => triPct(x.noText)).join(" | ")} |`);
  }
  out.push("\nIn-frame upright spines only, confirmed vs no-text AUC; and among boxes where PP-OCR read any text, confirmed vs no-catalog-match AUC:\n");
  out.push(`| feature | ${two.map((s) => `${short(s)} upright, vs no-text`).join(" | ")} | ${two.map((s) => `${short(s)} text read, vs no-match`).join(" | ")} |`, "|---|---:|---:|---:|---:|");
  const fs = [...new Set(two.flatMap((s) => [...Object.keys(m.controls[s]!.inFrameUpright.confirmedVsNoText), ...Object.keys(m.controls[s]!.ppocrReadText.confirmedVsNoCatalogMatch)]))];
  for (const f of fs) {
    out.push(`| ${f} | ${two.map((s) => triNum(m.controls[s]!.inFrameUpright.confirmedVsNoText[f]?.auc ?? null)).join(" | ")} | ${two.map((s) => triNum(m.controls[s]!.ppocrReadText.confirmedVsNoCatalogMatch[f]?.auc ?? null)).join(" | ")} |`);
  }
  out.push("");
  const md = m.model;
  out.push("## Descriptive model (pilot-000; confirmed vs no-text)\n");
  out.push(`Features fixed before fitting: ${md.features.join(", ")}. Split: ${md.split} (train ${md.train.photos} photos / ${md.train.n} spines, held out ${md.test.photos} / ${md.test.n}). No tuning.\n`);
  out.push("| | train AUC | held-out AUC | yardstick b2 AUC (transfer, no refit) |", "|---|---:|---:|---:|");
  const tr = md.transferToYardstick[YARD("b2")] as { logisticAuc: Tri; treeAuc: Tri };
  out.push(`| logistic | ${triNum(md.logistic.trainAuc as Tri)} | ${triNum(md.logistic.heldOutAuc as Tri)} | ${triNum(tr.logisticAuc)} |`);
  out.push(`| depth-3 tree | ${triNum(md.tree.trainAuc as Tri)} | ${triNum(md.tree.heldOutAuc as Tri)} | ${triNum(tr.treeAuc)} |`);
  out.push("\nLogistic weights on standardised features: " + Object.entries(md.logistic.weights).map(([k, w]) => `${k} ${w > 0 ? "+" : ""}${w.toFixed(2)}`).join(", ") + ".\n");
  out.push("```", ...md.tree.rules, "```\n");
  out.push("## Candidate thresholds (hypotheses; cut chosen on pilot-000, checked on yardstick b2)\n");
  out.push("The cut is the pilot decile that best splits the text-read share (any outcome but no-text). Shares with 95 % photo-bootstrap intervals.\n");
  out.push("| feature | cut | pilot below: n, text read, confirmed | pilot at/above | yard b2 below | yard b2 at/above |", "|---|---:|---|---|---|---|");
  const side = (x: { n: number; textRead: Tri; confirmed: Tri } | undefined) => (x ? `${x.n}: ${triPct(x.textRead)}, ${triPct(x.confirmed)}` : "–");
  for (const t of m.thresholds) out.push(`| ${t.feature} | ${t.cut} | ${side(t.pilot.below)} | ${side(t.pilot.atOrAbove)} | ${side(t.yardstickB2?.below)} | ${side(t.yardstickB2?.atOrAbove)} |`);
  out.push("\n## Image level: Spearman ρ between a photo's feature and its outcome (95 % bootstrap over photos)\n");
  for (const s of two) {
    const il = m.sets[s]!.imageLevel!;
    out.push(`**${short(s)}**: ${il.outcome}, ${il.photos} photos\n`, "| photo feature | ρ |", "|---|---:|");
    for (const [k, v] of Object.entries(il)) if (v && typeof v === "object") out.push(`| ${k} | ${triNum((v as { spearman: Tri }).spearman)} |`);
    out.push("");
  }
  return out.join("\n") + "\n";
}

function render(): void {
  const py = join(HELPER, ".venv", "bin", "python");
  for (const set of [PILOT, YARD("b2")]) {
    const out = join(PRIV, "renders", set);
    mkdirSync(out, { recursive: true });
    const r = spawnSync(py, ["-I", join(HELPER, "render.py"), "--detect", join(ROOT, "f0", set, "detect.jsonl"), "--images", join(PRIV, "features", `${set}.images.jsonl`), "--scores", join(PRIV, "scores", `${set}.jsonl`), "--out", out, "--label", set], { stdio: ["ignore", "inherit", "inherit"] });
    if (r.status !== 0) throw new Error(`render.py failed on ${set}`);
  }
  log("renders written under the data root's private/q1/renders/");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  if (cmd === "features") features();
  else if (cmd === "analyse") analyse();
  else if (cmd === "render") render();
  else {
    process.stderr.write("usage: q1-cli.ts features | analyse | render\n");
    process.exit(2);
  }
}
