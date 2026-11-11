// Q-2b runner: Q-2's teacher and student, unchanged, on the current default boxes, and SAM 2.1 outlines for U-4.
//
//   node src/eval/q2b-cli.ts features   # features.py, Q-1's table and geometry.py on the default pilot-000 boxes (CPU)
//   node src/eval/q2b-cli.ts analyse    # evals/Q2b/{metrics.json,report.md}; per-box tables stay private
//   node src/eval/q2b-cli.ts render     # Q-2's private renders on the new boxes
//   node src/eval/q2b-cli.ts outlines   # helpers/label/outline.py on every kept pilot-000 box (GPU; resumable)
//   node src/eval/q2b-cli.ts diag       # not pre-registered: the same run with τ held at Q-2's value (private)
//   node src/eval/q2b-cli.ts u4         # U-4's still study before (F-0b outlines) and after (these); keeps both summaries
//   node src/eval/q2b-cli.ts all        # features, diag, analyse, render (outlines and u4 first, for Part B's aggregates)
//   node src/eval/q2b-cli.ts features|outlines <session>   # NS-K2: the same steps on any other declared session
//   node src/eval/q2b-cli.ts table <session>               # NS-K2: its rung table at analyse's τ (no student scores)
//
// The population is the current default: on pilot-000, F-0e's `bands+strips` boxes with the readers F-0e ran on
// them and F-0's decision (F-0c's cached `base-decisions`); on the yardstick, F-0's own B2 run, which F-0e left as
// the default for shelf-scale photos. the shipped not-a-book filter (F-0c's shape rules and F-0f's shelf-label rules, cover pass off) drops boxes on both sets before
// anything is computed. Everything per box or per photo goes under the data root's `private/q2b/`.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dataRoot } from "../ledger/images.ts";
import { readJsonl, type Detection } from "./f0.ts";
import { kinds } from "./f0c.ts";
import { evidenceFor } from "./f0f-cli.ts";
import { loadBoxSet, pilotOutlines, preRb1 } from "./rb1.ts";
import { area, clipConvex, growQuad, MASK_COVER, PIECE_INSIDE, type Pt } from "../report/display-draw.ts";
import { quantile } from "./q1.ts";
import { rowsFrom, type Decision as Q1Decision, type Raw, type Reading } from "./q1-cli.ts";
import { PILOT, Q2_RUN, YARD, analyse, geometry, render, rungTable, type Run, type SetInputs } from "./q2-cli.ts";
import { acceptSet, needs, setPaths } from "./set-paths.ts";
import { imagesOf } from "./f0c-cli.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROOT = dataRoot();
const PRIV = join(ROOT, "private", "q2b");
const BASE = join(ROOT, "f0e", PILOT, "bands+strips");

const log = (s: string) => process.stderr.write(`q2b: ${s}\n`);

/** Box ids the shipped not-a-book rules keep as spines: F-0c's shape rules and F-0f's shelf-label rules (cover pass off). */
export function spineIds(detect: string, set: string): Set<string> {
  const ev = evidenceFor(set);
  const keep = new Set<string>();
  for (const d of readJsonl<Detection>(detect)) {
    if (d.error) continue;
    kinds({ ...d, covers: [] }, ev.get(d.id)).spines.forEach((b, i) => b.kind === "spine" && keep.add(`${d.id}:${i}`));
  }
  if (preRb1()) return keep;
  // RB-1's box set: less the boxes F-0i's partition drops and NB-3's `on-lip` boxes.
  const box = loadBoxSet(set);
  return new Set([...keep].filter(box.keeps));
}

/** Each set's kept ids, computed on first use (the yardstick's on F-0's own B2 run, a session's on its default). */
const kept = new Map<string, Set<string>>();
const keepOf = (set: string) => (id: string) => {
  if (!kept.has(set)) kept.set(set, set === YARD ? spineIds(join(Q2_RUN.sets[YARD]!.stage, "detect.jsonl"), "yardstick") : spineIds(join(setPaths(set, ROOT).base, "detect.jsonl"), set));
  return kept.get(set)!.has(id);
};

/**
 * A session's Q-2b inputs (NS-K2, src/eval/set-paths.ts): F-0e's `bands+strips` boxes and readings, F-0c's cached
 * base decisions, Q-1's features and table re-measured on those boxes, and the shipped not-a-book filter.
 */
export function sessionInputs(set: string): SetInputs {
  const p = setPaths(set, ROOT);
  return { stage: p.base, decisions: join(p.f0c, "base-decisions.jsonl"), features: p.q2bFeatures, images: p.q2bImages, table: p.q2bQ1Table, keep: keepOf(set) };
}

/** Q-2b's run narrowed to one session, for the per-session steps (features, outlines, table). */
const sessionRun = (set: string): Run => (set === PILOT ? Q2B_RUN : { ...Q2B_RUN, sets: { [set]: sessionInputs(set) } });

/** F-0c's slim decision (accepted is a work id) in the shape Q-1's table expects. */
interface Slim { id: string; imageId: string; accepted: string | null; reason: Q1Decision["reason"] }

export const Q2B_RUN: Run = {
  ...Q2_RUN,
  id: "Q2b",
  card: "Q-2b",
  cli: "q2b-cli.ts",
  priv: PRIV,
  evalDir: join(REPO, "evals", "Q2b"),
  question: "Q-2's teacher and student, pre-registered and unchanged, on the current default boxes (F-0e bands+strips on pilot-000, F-0c's and F-0f's not-a-book filter on): does the predicted fill now pass Q-2's go rule",
  inputs: "pilot-000 (31 photos): F-0e bands+strips boxes, the readers F-0e ran on them, F-0's decision (F-0c's cached base decisions); yardstick-library B2 (40 Library Dataset images, PROXY): F-0's own B2 run, the default for shelf-scale photos; both after the shipped not-a-book filter (F-0c shape rules, F-0f shelf-label rules); Q-1's features and Q-2's top-seam geometry re-measured on the new pilot-000 boxes",
  sets: {
    // The same 31 working copies as Q-1's list (set-paths keeps that one literal).
    [PILOT]: sessionInputs(PILOT),
    [YARD]: { ...Q2_RUN.sets[YARD]!, keep: keepOf(YARD) },
  },
  prelude: (m) => {
    const q2 = JSON.parse(readFileSync(join(REPO, "evals", "Q2", "metrics.json"), "utf8")) as M;
    const main = compare(q2, m as unknown as M);
    const u4 = outlinesForU4();
    if (u4) main.json.outlinesForU4 = u4;
    const diagPath = join(DIAG.evalDir, "metrics.json");
    if (!existsSync(diagPath)) return main;
    const d = compare(q2, JSON.parse(readFileSync(diagPath, "utf8")) as M, `Q-2b at τ = ${q2.teacher.tau}`);
    const note = `\n### Not pre-registered: τ held at Q-2's ${q2.teacher.tau}\n\nThe null procedure gives a different τ on the new boxes, which moves boxes between \`text-present\` and \`text-read\`. This diagnostic re-runs everything with τ fixed at Q-2's value, to separate the label shift from the box change. It is outside the go rule.\n\n`;
    return { json: { ...main.json, notPreRegistered: { tauHeldAtQ2: (d.json.vsQ2 as { q2b: unknown }).q2b } }, md: main.md + note + d.md.slice(d.md.indexOf("| figure")) };
  },
};

/** Not pre-registered: Q-2b with τ held at Q-2's value; aggregates stay private, the main report quotes them. */
const DIAG: Run = { ...Q2B_RUN, id: "Q2b-diag", priv: join(PRIV, "diag-tau"), evalDir: join(PRIV, "diag-tau"), geometryDir: join(PRIV, "geometry"), prelude: undefined };

function diag(): void {
  const q2 = JSON.parse(readFileSync(join(REPO, "evals", "Q2", "metrics.json"), "utf8")) as M;
  analyse({ ...DIAG, tau: q2.teacher.tau });
}

// --- features: the CPU pixel pass on the new boxes ---------------------------------------------------------

/**
 * Q-1's features and table and Q-2's top seam on one session's default boxes. With no session, pilot-000's as first
 * run (its geometry step re-measures the yardstick too); a new session first writes its own image list (NS-K2).
 */
function features(set: string = PILOT): void {
  const py = join(REPO, "helpers", "coverage", ".venv", "bin", "python");
  if (!existsSync(py)) throw new Error("helpers/coverage has no .venv: run `uv sync` there first");
  const run = sessionRun(set);
  const inp = run.sets[set]!;
  needs("Q-2b", set, "F-0c base decisions", inp.decisions, `f0c-cli.ts base ${set}`);
  mkdirSync(dirname(inp.features), { recursive: true });
  if (set !== PILOT) writeFileSync(inp.images, imagesOf(set).map((i) => JSON.stringify({ id: i.id, image: i.path })).join("\n") + "\n");
  const fd = openSync(inp.features, "w");
  log(`${set}: Q-1 features on the default boxes`);
  const r = spawnSync(py, ["-I", join(REPO, "helpers", "coverage", "features.py"), "--detect", join(inp.stage, "detect.jsonl"), "--images", inp.images], { stdio: ["ignore", fd, "inherit"] });
  closeSync(fd);
  if (r.status !== 0) throw new Error("features.py failed");
  // Q-1's per-box table, by Q-1's own code. pilot-000 has no annotations, so only acceptance and reason matter.
  const dec = new Map(readJsonl<Slim>(inp.decisions).map((d): [string, Q1Decision] => [d.id, { id: d.id, imageId: d.imageId, accepted: d.accepted ? { workId: d.accepted } : null, reason: d.reason }]));
  const pp = new Map(readJsonl<Reading>(join(inp.stage, "ppocr.jsonl")).map((x) => [x.id, x]));
  const rows = rowsFrom(readJsonl<Raw>(inp.features), dec, pp, null);
  mkdirSync(dirname(inp.table), { recursive: true });
  writeFileSync(inp.table, rows.map((x) => JSON.stringify(x)).join("\n") + "\n");
  log(`${set}: ${rows.length} boxes measured`);
  if (set === PILOT) geometry(Q2B_RUN);
  else geometry(run, [set]);
}

/**
 * A session's rung table (TS-0's rungs, F-0i's kept ids), NS-K2: Q-2's teacher at the τ Q-2b's analysis set on
 * pilot-000's null pairing (evals/Q2b/metrics.json), on the session's kept boxes. pilot-000's own table is written
 * by `analyse`, with the student's scores, and is never rewritten here.
 */
function table(set: string): void {
  if (set === PILOT) throw new Error(`Q-2b: ${PILOT}'s rung table is written by \`q2b-cli.ts analyse\`; \`table\` is for the other sessions`);
  const inp = sessionRun(set).sets[set]!;
  needs("Q-2b", set, "F-0c base decisions", inp.decisions, `f0c-cli.ts base ${set}`);
  needs("Q-2b", set, "Q-1 features", inp.table, `q2b-cli.ts features ${set}`);
  const tau = (JSON.parse(readFileSync(join(Q2B_RUN.evalDir, "metrics.json"), "utf8")) as { teacher: { tau: number } }).teacher.tau;
  const n = rungTable(sessionRun(set), set, tau);
  log(`${set}: rung table for ${n} kept boxes at τ ${tau} under the data root's private/q2b/table/`);
}

// --- outlines: SAM 2.1 box-prompted masks for U-4 ----------------------------------------------------------

/** Every kept default box of a session (pilot-000 by default) through F-0b's outline.py; ids already done are skipped (resume). */
async function outlines(set: string = PILOT): Promise<void> {
  const py = join(REPO, "helpers", "label", ".venv", "bin", "python");
  if (!existsSync(py)) throw new Error("helpers/label has no .venv: run `uv sync` there first");
  const inp = sessionRun(set).sets[set]!;
  needs("Q-2b", set, "image list", inp.images, `q2b-cli.ts features ${set}`);
  const out = setPaths(set, ROOT).outlines;
  mkdirSync(dirname(out), { recursive: true });
  const done = new Set(existsSync(out) ? readJsonl<{ id: string }>(out).map((x) => x.id) : []);
  const image = new Map(readJsonl<{ id: string; image: string }>(inp.images).map((x) => [x.id, x.image]));
  const keep = keepOf(set);
  const reqs: string[] = [];
  for (const d of readJsonl<Detection>(join(inp.stage, "detect.jsonl"))) {
    if (d.error) continue;
    d.spines.forEach((s, i) => {
      const id = `${d.id}:${i}`;
      if (keep(id) && !done.has(id)) reqs.push(JSON.stringify({ id, image: image.get(d.id), polygon: s.polygon }));
    });
  }
  log(`outlines: ${reqs.length} boxes to segment (${done.size} already done)`);
  if (!reqs.length) return;
  const fd = openSync(out, "a");
  const child = spawn(py, ["-I", join(REPO, "helpers", "label", "outline.py")], { stdio: ["pipe", fd, "inherit"], env: { ...process.env, OMP_NUM_THREADS: "4" } });
  child.stdin!.end(reqs.join("\n") + "\n");
  const code = await new Promise<number | null>((res) => child.once("close", res));
  closeSync(fd);
  if (code !== 0) throw new Error(`outline.py exited ${code}`);
  log("outlines written under the data root's private/q2b/outlines/");
}

// --- U-4: the still study before and after, and why a box keeps its box shape ------------------------------

const U4_SUMMARY = join(ROOT, "private", "u4", "renders", PILOT, "summary.json");

function u4Study(): void {
  for (const [source, keep] of [["f0b", "u4-before-summary.json"], ["q2b", "u4-after-summary.json"]] as const) {
    log(`U-4 study, source ${source}`);
    const r = spawnSync(process.execPath, [join(REPO, "src", "eval", "u4-cli.ts"), "render", "--source", source], { stdio: ["ignore", "ignore", "inherit"] });
    if (r.status !== 0) throw new Error(`u4-cli render --source ${source} failed`);
    writeFileSync(join(PRIV, keep), readFileSync(U4_SUMMARY));
  }
}

/** Aggregates of the outline run and of U-4's study before and after; null until both have run. */
function outlinesForU4(): Record<string, unknown> | null {
  const path = join(PRIV, "outlines", `${PILOT}.jsonl`);
  const before = join(PRIV, "u4-before-summary.json"), after = join(PRIV, "u4-after-summary.json");
  if (!existsSync(path) || !existsSync(before) || !existsSync(after)) return null;
  const rows: { id: string; outline?: Pt[]; seconds?: number; error?: string }[] = pilotOutlines();
  const keep = keepOf(PILOT); // outlines were run before F-0f's shelf-label rules; count only boxes kept now
  const byId = new Map(rows.filter((r) => r.outline && keep(r.id)).map((r) => [r.id, r.outline!]));
  const kind = new Map(readJsonl<{ id: string; fragment: string }>(join(PRIV, "table", `${PILOT}.jsonl`)).map((r) => [r.id, r.fragment]));
  // U-4's own rule per box (display-draw attachPieces): most of the mask inside the grown box, covering 60 % of it.
  let shaped = 0, outside = 0, under = 0;
  const tot: Record<string, number> = {}, fb: Record<string, number> = {};
  for (const d of readJsonl<Detection>(join(BASE, "detect.jsonl")))
    d.spines.forEach((s, i) => {
      const o = byId.get(`${d.id}:${i}`);
      if (!o) return;
      const q = s.polygon as unknown as Pt[];
      const c = clipConvex(o, growQuad(q, 0.03, 0.08));
      const k = kind.get(`${d.id}:${i}`) ?? "whole";
      tot[k] = (tot[k] ?? 0) + 1;
      if (area(c) / (area(o) || 1) < PIECE_INSIDE) outside++;
      else if (Math.min(1, area(c) / (area(q) || 1)) < MASK_COVER) under++;
      else return void shaped++;
      fb[k] = (fb[k] ?? 0) + 1;
    });
  const n = byId.size, r4 = (x: number) => Math.round(x * 10000) / 10000;
  const secs = rows.flatMap((r) => (r.seconds === undefined ? [] : [r.seconds])).sort((a, b) => a - b);
  const pick = (p: string) => {
    const x = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    return { source: x.source ?? "f0b", spineCount: x.spines, maskShapedPct: x.maskShaped, maskShareP50: x.maskShareP50, filledPct: x.filled, rungsPct: x.rungs, proxies: x.proxies };
  };
  return {
    run: { model: preRb1() ? "sam2.1-hiera-base-plus, box-prompted (helpers/label/outline.py)" : "F-0i's exclusive outlines (partition, #51), cut from the SAM 2.1 box-prompted outlines", boxCount: rows.length, errors: rows.filter((r) => r.error).length, secondsP50: secs.length ? r4(quantile(secs, 0.5)) : null },
    rule: `drawn from its outline when at least ${PIECE_INSIDE * 100} % of the mask lies inside the box (grown 3 % along, 8 % across) and covers at least ${MASK_COVER * 100} % of it`,
    shaped: r4(shaped / n), maskMostlyOutsideBox: r4(outside / n), maskUnderCover: r4(under / n),
    boxShapeByKind: Object.fromEntries(Object.entries(tot).map(([k, v]) => [k, r4((fb[k] ?? 0) / v)])),
    before: pick(before),
    after: pick(after),
  };
}

// --- the comparison with Q-2 ------------------------------------------------------------------------------

type Tri = [number, number, number] | null;
interface M {
  teacher: { tau: number; sets: Record<string, { detected: { n: number }; population: { n: number }; populationFilled: Tri }> };
  student: {
    scores: Record<string, { models: Record<string, Record<string, Tri>> }>;
    goRule: { studentAuc: [number, number, number]; gainOverBaseline: [number, number, number]; go: boolean; robustness: Record<string, Record<string, Tri>> };
    operatingPoint: { fillP: number; targetMet: boolean; bestPrecision: number; atFillP: Record<string, Record<string, Tri>> };
    sensitivity: Record<string, Record<string, { n: number; student: Tri; gain: Tri }>>;
  };
  fragments: { sets: Record<string, { perPhotoMedian: { cutByTile: number | null; partialOfUpright: number | null }; population: Record<string, { n: number; share: number | null }> }> };
}

const WHOLE = "floor0.225, whole only (no cut or partial)";
const passes = (auc: Tri, gain: Tri) => !!auc && !!gain && auc[0] >= 0.75 && gain[0] > 0 && (gain[1] > 0 || gain[2] < 0);

/** One row per figure Q-2 reported, Q-2 beside Q-2b; aggregates only. */
export function compare(q2: M, q2b: M, label = "Q-2b"): { json: Record<string, unknown>; md: string } {
  const pick = (m: M) => {
    const s = m.student, p = s.scores[PILOT]!.models.student!, y = s.scores[YARD]!.models.student!, r = s.goRule.robustness[PILOT]!;
    const w = s.sensitivity[WHOLE]![PILOT]!, f = m.fragments.sets[PILOT]!;
    return {
      detected: m.teacher.sets[PILOT]!.detected.n,
      population: m.teacher.sets[PILOT]!.population.n,
      filled: m.teacher.sets[PILOT]!.populationFilled,
      tau: m.teacher.tau,
      auc: s.goRule.studentAuc as Tri,
      gain: s.goRule.gainOverBaseline as Tri,
      gainOverOracleWidth: r.gainOverOracleWidth ?? null,
      inSample: r.studentInSample ?? null,
      vsSpineFound: r.studentVsSpineFound ?? null,
      vsTextPresent: r.studentVsTextPresent ?? null,
      ece: p.ece ?? null,
      brier: p.brier ?? null,
      yardAuc: y.auc ?? null,
      yardEce: y.ece ?? null,
      fillP: s.operatingPoint.fillP,
      fillTargetMet: s.operatingPoint.targetMet,
      bestPrecision: s.operatingPoint.bestPrecision,
      fillPrecision: s.operatingPoint.atFillP[PILOT]!.precision ?? null,
      fillShare: s.operatingPoint.atFillP[PILOT]!.filledShare ?? null,
      fillRecall: s.operatingPoint.atFillP[PILOT]!.recall ?? null,
      cutShare: f.population.cut!.share,
      partialShare: f.population.partial!.share,
      wholeShare: f.population.whole!.share,
      cutPerPhotoMedian: f.perPhotoMedian.cutByTile,
      wholeOnly: { n: w.n, auc: w.student, gain: w.gain, go: passes(w.student, w.gain) },
      go: s.goRule.go,
    };
  };
  const a = pick(q2), b = pick(q2b);
  const agree = b.wholeOnly.go === b.go;
  const n2 = (t: Tri) => (t ? `${t[0].toFixed(3)} (${t[1].toFixed(2)}–${t[2].toFixed(2)})` : "–");
  const sg = (t: Tri) => (t ? `${t[0] >= 0 ? "+" : ""}${t[0].toFixed(3)} (${t[1].toFixed(3)} to ${t[2].toFixed(3)})` : "–");
  const pc = (x: number | null) => (x === null ? "–" : `${(x * 100).toFixed(1)} %`);
  const tp = (t: Tri) => (t ? `${(t[0] * 100).toFixed(0)} % (${(t[1] * 100).toFixed(0)}–${(t[2] * 100).toFixed(0)})` : "–");
  const rows: [string, string, string][] = [
    ["detected boxes", String(a.detected), String(b.detected)],
    ["student population (floor, upright, measurable)", String(a.population), String(b.population)],
    ["filled share of the population", tp(a.filled), tp(b.filled)],
    ["τ", String(a.tau), String(b.tau)],
    ["**student AUC (leave one photo out)**", n2(a.auc), n2(b.auc)],
    ["**gain over crop width**", sg(a.gain), sg(b.gain)],
    ["gain over crop width, best direction with hindsight", sg(a.gainOverOracleWidth), sg(b.gainOverOracleWidth)],
    ["student AUC in sample (optimistic)", n2(a.inSample), n2(b.inSample)],
    ["filled vs spine-found only", n2(a.vsSpineFound), n2(b.vsSpineFound)],
    ["filled vs text-present only", n2(a.vsTextPresent), n2(b.vsTextPresent)],
    ["ECE", n2(a.ece), n2(b.ece)],
    ["Brier", n2(a.brier), n2(b.brier)],
    ["yardstick AUC (one pilot fit, unchanged)", n2(a.yardAuc), n2(b.yardAuc)],
    ["yardstick ECE", n2(a.yardEce), n2(b.yardEce)],
    ["FILL_P", `${a.fillP}${a.fillTargetMet ? "" : " (target not met)"}`, `${b.fillP}${b.fillTargetMet ? "" : " (target not met)"}`],
    ["best precision (≥ 5 % filled)", pc(a.bestPrecision), pc(b.bestPrecision)],
    ["at FILL_P: share predicted filled", tp(a.fillShare), tp(b.fillShare)],
    ["**at FILL_P: precision of \"filled\"**", tp(a.fillPrecision), tp(b.fillPrecision)],
    ["at FILL_P: recall", tp(a.fillRecall), tp(b.fillRecall)],
    ["population: cut by a tile edge", pc(a.cutShare), pc(b.cutShare)],
    ["population: partial (under 0.55 of band)", pc(a.partialShare), pc(b.partialShare)],
    ["population: whole", pc(a.wholeShare), pc(b.wholeShare)],
    ["cut boxes per photo, median (all detected)", pc(a.cutPerPhotoMedian), pc(b.cutPerPhotoMedian)],
    ["whole only: n", String(a.wholeOnly.n), String(b.wholeOnly.n)],
    ["whole only: student AUC", n2(a.wholeOnly.auc), n2(b.wholeOnly.auc)],
    ["whole only: gain over crop width", sg(a.wholeOnly.gain), sg(b.wholeOnly.gain)],
    ["whole only: Q-2's rule", a.wholeOnly.go ? "GO" : "NO-GO", b.wholeOnly.go ? "GO" : "NO-GO"],
    ["**verdict by Q-2's rule**", a.go ? "GO" : "NO-GO", b.go ? "GO" : "NO-GO"],
  ];
  const md = [
    "## Q-2 against Q-2b (pilot-000)\n",
    "Q-2: F-0's B2 boxes. Q-2b: the current default (F-0e `bands+strips`, F-0c's and F-0f's not-a-book filter). Same teacher procedure, same student, same rule; intervals are 95 % paired photo bootstraps within each run.\n",
    `| figure | Q-2 | ${label} |`,
    "|---|---:|---:|",
    ...rows.map(([k, x, y]) => `| ${k} | ${x} | ${y} |`),
    "",
    `Whole-only and all-box results ${agree ? "agree" : "disagree"} on the verdict: whole only ${b.wholeOnly.go ? "GO" : "NO-GO"}, all boxes ${b.go ? "GO" : "NO-GO"}.\n`,
  ].join("\n");
  return { json: { vsQ2: { q2: a, q2b: b, wholeAndAllAgree: agree } }, md };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  const set = process.argv[3];
  // features, outlines and table take one declared session (NS-K2); with none, features and outlines run pilot-000's.
  const session = (): string => (set === undefined || set.startsWith("--") ? PILOT : acceptSet("Q-2b", set));
  if (cmd === "features") features(session());
  else if (cmd === "table") table(acceptSet("Q-2b", set));
  else if (cmd === "analyse") analyse(Q2B_RUN);
  else if (cmd === "render") render(Q2B_RUN, [PILOT]);
  else if (cmd === "outlines") await outlines(session());
  else if (cmd === "diag") diag();
  else if (cmd === "u4") u4Study();
  else if (cmd === "all") { features(); diag(); analyse(Q2B_RUN); render(Q2B_RUN, [PILOT]); }
  else {
    process.stderr.write("usage: q2b-cli.ts features [session] | table <session> | outlines [session] | analyse | render | diag | u4 | all\n");
    process.exit(2);
  }
}
