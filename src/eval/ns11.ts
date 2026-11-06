// NS-11 · mono-geometry student (pre-registered in evals/NS11/prereg.md): the teacher table and the scorer.
//
// Pure: the three-way target from MoGe-2's face counts, the admission filter, the baselines, the measures, the group
// bootstrap, the development keep rule and the report text. The runner is src/eval/ns11-cli.ts; the student, the
// crops and the teacher's mean normal are helpers/geometry-student/student.py. Every figure is agreement with MoGe-2
// (a machine output), never accuracy on real use (OC36). The yardstick is PROXY: an evaluation set, never trained on.
import { quantile, rng } from "./q1.ts";

export const NS11 = {
  card: "NS-11",
  /** The bootstrap's seed (as NS5's) and its number of resamples. */
  seed: 20261105,
  reps: 2000,
  /** A box is admitted when front + top + cover pixels are at least this share of all its pixels (prereg §2). */
  minMass: 0.5,
  /** The development keep rule (prereg §5). */
  k1RelativeMargin: 0.1,
  k2DegreeMargin: 2.0,
  percentiles: [0.1, 0.25, 0.5, 0.75, 0.9, 0.99] as const,
  labelSource: "mono-geometry",
  rgbRecoverable: "yes",
  /** The teacher (prereg §1). */
  teacher: {
    model: "Ruicheng/moge-2-vitl-normal",
    revision: "cb0e8bbd6b1e243589717c78e750b1ba4c093acf",
    weightsSha256: "280741fd09bc3f403ccff9967784c2a391b52d2c0742ae3efdb21d9f90cc1a01",
    mogeCommit: "b942f00bdc2a2a23ebb474fbe034d487e6dcceec",
    facesSha256: "fec353c222d34a52ca88907de986779912a9615722e7a2b75237e35ddef78ed4",
    geometrySha256: "40c3d2a655bc5b7e5be5c988263844672ce44d568550d1a163e32c736e2dc40d",
    licence: "MIT",
  },
} as const;

/** The three faces as keys of the emitted files (the privacy guard refuses a bare `spine` key in evals/). */
export const FACE_NAMES = ["spineFace", "topFace", "coverFace"] as const;
export type Vec3 = [number, number, number];

/** One of H-2's per-box stage rows: the six face classes' pixel counts (faces.py's CLASSES) and the box's pixels. */
export interface FaceCounts {
  front: number;
  edge: number;
  top: number;
  under: number;
  cover: number;
  behind: number;
  pixels: number;
}

/** The three-way target (spine = front, top, cover, each over their sum) and the mass it was taken from. */
export function threeWay(c: FaceCounts): { shares: Vec3; mass: number } | null {
  const sum = c.front + c.top + c.cover;
  if (c.pixels <= 0 || sum <= 0) return null;
  return { shares: [c.front / sum, c.top / sum, c.cover / sum], mass: sum / c.pixels };
}

export type Exclusion = "no-face-row" | "no-normal" | "low-mass";

/** The admission rule of prereg §2: a face row, a mean normal, and at least `minMass` of the pixels in the three classes. */
export function admit(counts: FaceCounts | null, normal: Vec3 | null): { ok: true; shares: Vec3; mass: number } | { ok: false; why: Exclusion } {
  if (!counts) return { ok: false, why: "no-face-row" };
  if (!normal) return { ok: false, why: "no-normal" };
  const t = threeWay(counts);
  if (!t || t.mass < NS11.minMass) return { ok: false, why: "low-mass" };
  return { ok: true, ...t };
}

// --- vectors -------------------------------------------------------------------------------------------------

const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
export function unit(v: readonly number[]): Vec3 {
  const n = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
  return [v[0]! / n, v[1]! / n, v[2]! / n];
}
/** The angle between two unit vectors in degrees. */
export const angleDeg = (a: readonly number[], b: readonly number[]): number => (Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180) / Math.PI;
/** `(1/3) Σ |p_c − y_c|`: the per-box mean absolute share error. */
export const shareError = (p: readonly number[], y: readonly number[]): number => (Math.abs(p[0]! - y[0]!) + Math.abs(p[1]! - y[1]!) + Math.abs(p[2]! - y[2]!)) / 3;
export const argmax = (v: readonly number[]): number => (v[1]! > v[0]! && v[1]! >= v[2]! ? 1 : v[2]! > v[0]! && v[2]! > v[1]! ? 2 : 0);

/** The mean target of a set of rows: the mean 3-way distribution and the unit mean normal (the trivial baselines). */
export function meanTarget(rows: readonly { y: Vec3; n: Vec3 }[]): { y: Vec3; n: Vec3 } {
  const y: Vec3 = [0, 0, 0];
  const n: Vec3 = [0, 0, 0];
  for (const r of rows) for (let k = 0; k < 3; k++) (y[k] = y[k]! + r.y[k]!), (n[k] = n[k]! + r.n[k]!);
  return { y: y.map((v) => v / rows.length) as Vec3, n: unit(n) };
}

// --- the scored rows ---------------------------------------------------------------------------------------

/** One box's teacher target, the student's prediction and the two baselines'. `unit` is the bootstrap's cluster. */
export interface Scored {
  unit: string;
  y: Vec3;
  n: Vec3;
  student: { y: Vec3; n: Vec3 };
  oracle: { y: Vec3; n: Vec3 };
  trainMean: { y: Vec3; n: Vec3 };
}

export interface PerBox {
  shareErr: number;
  angle: number;
  top1: boolean;
  teacherClass: number;
  predictedClass: number;
}

export type Arm = "student" | "oracle" | "trainMean";
export const ARMS: readonly Arm[] = ["student", "oracle", "trainMean"];

export function perBox(r: Scored, arm: Arm): PerBox {
  const p = r[arm];
  const tc = argmax(r.y);
  const pc = argmax(p.y);
  return { shareErr: shareError(p.y, r.y), angle: angleDeg(p.n, r.n), top1: tc === pc, teacherClass: tc, predictedClass: pc };
}

export const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
export function median(xs: readonly number[]): number {
  return quantile([...xs].sort((a, b) => a - b), 0.5);
}

export interface Interval {
  value: number;
  lo: number;
  hi: number;
}

/** Percentile bootstrap over clusters: `stat` gets the drawn cluster list (with repeats); null when the statistic is undefined. */
export function clusterInterval(clusters: readonly string[], stat: (drawn: readonly string[]) => number, reps: number = NS11.reps, seed: number = NS11.seed): Interval {
  const value = stat(clusters);
  if (clusters.length < 2) return { value, lo: NaN, hi: NaN };
  const rand = rng(seed);
  const draws: number[] = [];
  for (let r = 0; r < reps; r++) {
    const drawn = Array.from({ length: clusters.length }, () => clusters[Math.floor(rand() * clusters.length)]!);
    const v = stat(drawn);
    if (Number.isFinite(v)) draws.push(v);
  }
  draws.sort((a, b) => a - b);
  return { value, lo: quantile(draws, 0.025), hi: quantile(draws, 0.975) };
}

const r4 = (x: number): number => (Number.isFinite(x) ? Math.round(x * 10000) / 10000 : x);
const round = (i: Interval): Interval => ({ value: r4(i.value), lo: r4(i.lo), hi: r4(i.hi) });

/** Rows grouped by cluster, in the order of `order`. */
export function byUnit<T extends { unit: string }>(rows: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) (m.get(r.unit) ?? m.set(r.unit, []).get(r.unit)!).push(r);
  return m;
}

export interface Distribution {
  boxCount: number;
  mean: Interval;
  quantiles: Record<string, number>;
  median: Interval;
}

function distribution(units: Map<string, number[]>, clusters: string[]): Distribution {
  const all = [...units.values()].flat().sort((a, b) => a - b);
  const pooled = (stat: (xs: number[]) => number) => (drawn: readonly string[]) => stat(drawn.flatMap((u) => units.get(u)!));
  return {
    boxCount: all.length,
    mean: round(clusterInterval(clusters, pooled(mean))),
    quantiles: Object.fromEntries(NS11.percentiles.map((q) => [`p${Math.round(q * 100)}`, r4(quantile(all, q))])),
    median: round(clusterInterval(clusters, pooled(median))),
  };
}

export interface ArmScore {
  shareError: Distribution;
  angleDeg: Distribution;
  top1: Interval;
  /** Per teacher class: boxes and the share a prediction agrees on. */
  recall: Record<string, { boxCount: number; agree: number }>;
}

/** One arm's measures over `rows`, intervals by `unit` (split group on pilot-000, photo on the yardstick). */
export function scoreArm(rows: readonly Scored[], arm: Arm): ArmScore {
  const clusters = [...byUnit(rows).keys()].sort();
  const boxes = rows.map((r) => ({ unit: r.unit, ...perBox(r, arm) }));
  const per = byUnit(boxes);
  const col = (f: (b: PerBox) => number) => new Map([...per].map(([u, bs]) => [u, bs.map(f)]));
  const top1 = (drawn: readonly string[]) => {
    const bs = drawn.flatMap((u) => per.get(u)!);
    return bs.filter((b) => b.top1).length / bs.length;
  };
  const recall: ArmScore["recall"] = {};
  FACE_NAMES.forEach((name, c) => {
    const of = boxes.filter((b) => b.teacherClass === c);
    recall[name] = { boxCount: of.length, agree: of.filter((b) => b.top1).length };
  });
  return {
    shareError: distribution(col((b) => b.shareErr), clusters),
    angleDeg: distribution(col((b) => b.angle), clusters),
    top1: round(clusterInterval(clusters, top1)),
    recall,
  };
}

export interface Comparison {
  /** `1 − student's mean share error / the baseline's`, pooled; K1's quantity. */
  shareErrorReduction: Interval;
  /** `the baseline's median angle − the student's`, in degrees, pooled; K2's quantity. */
  medianAngleGain: Interval;
}

/** The student against one baseline, bootstrapped over the same cluster resamples (a paired comparison). */
export function compare(rows: readonly Scored[], baseline: Arm): Comparison {
  const clusters = [...byUnit(rows).keys()].sort();
  const per = byUnit(rows.map((r) => ({ unit: r.unit, s: perBox(r, "student"), b: perBox(r, baseline) })));
  const shareErrorReduction = (drawn: readonly string[]) => {
    const bs = drawn.flatMap((u) => per.get(u)!);
    return 1 - mean(bs.map((x) => x.s.shareErr)) / mean(bs.map((x) => x.b.shareErr));
  };
  const medianAngleGain = (drawn: readonly string[]) => {
    const bs = drawn.flatMap((u) => per.get(u)!);
    return median(bs.map((x) => x.b.angle)) - median(bs.map((x) => x.s.angle));
  };
  return { shareErrorReduction: round(clusterInterval(clusters, shareErrorReduction)), medianAngleGain: round(clusterInterval(clusters, medianAngleGain)) };
}

export interface KeepRule {
  k1: { passes: boolean; reduction: Interval; margin: number };
  k2: { passes: boolean; gain: Interval; marginDegrees: number };
  kept: boolean;
}

/** The development keep rule (prereg §5): both K1 and K2, each a point estimate at its margin and an interval above 0. */
export function keepRule(c: Comparison): KeepRule {
  const k1 = c.shareErrorReduction.value >= NS11.k1RelativeMargin && c.shareErrorReduction.lo > 0;
  const k2 = c.medianAngleGain.value >= NS11.k2DegreeMargin && c.medianAngleGain.lo > 0;
  return {
    k1: { passes: k1, reduction: c.shareErrorReduction, margin: NS11.k1RelativeMargin },
    k2: { passes: k2, gain: c.medianAngleGain, marginDegrees: NS11.k2DegreeMargin },
    kept: k1 && k2,
  };
}

/** Per-cluster summary rows (clusters unnamed: g1, g2, ...) for the report: box count and the student's and oracle's means. */
export function perCluster(rows: readonly Scored[]): { cluster: string; boxCount: number; student: { shareError: number; medianAngle: number; top1: number }; oracle: { shareError: number; medianAngle: number; top1: number } }[] {
  const out = [];
  let k = 0;
  for (const [, rs] of [...byUnit(rows)].sort(([a], [b]) => a.localeCompare(b))) {
    const sum = (arm: Arm) => {
      const bs = rs.map((r) => perBox(r, arm));
      return { shareError: r4(mean(bs.map((b) => b.shareErr))), medianAngle: r4(median(bs.map((b) => b.angle))), top1: r4(bs.filter((b) => b.top1).length / bs.length) };
    };
    out.push({ cluster: `g${++k}`, boxCount: rs.length, student: sum("student"), oracle: sum("oracle") });
  }
  return out;
}

/** The set's own teacher class counts (what the top-1 baseline up against): boxes by the argmax of the teacher's shares. */
export function classCounts(ys: readonly Vec3[]): Record<string, number> {
  const out: Record<string, number> = { spineFace: 0, topFace: 0, coverFace: 0 };
  for (const y of ys) out[FACE_NAMES[argmax(y)]!]!++;
  return out;
}

// --- the report --------------------------------------------------------------------------------------------

/** The metrics file's shape is the runner's (src/eval/ns11-cli.ts `score`); the renderer reads it loosely. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Metrics = Record<string, any>;

const f = (x: number | null | undefined, d = 3): string => (x === null || x === undefined || !Number.isFinite(x) ? "n/a" : x.toFixed(d));
const iv = (i: Interval | null | undefined, d = 3): string => (!i ? "n/a" : Number.isFinite(i.lo) ? `${f(i.value, d)} (${f(i.lo, d)} to ${f(i.hi, d)})` : f(i.value, d));
const pct = (x: number | null | undefined, d = 1): string => (x === null || x === undefined || !Number.isFinite(x) ? "n/a" : `${(x * 100).toFixed(d)} %`);
const mib = (b: number): string => `${(b / 1048576).toFixed(0)} MiB`;

function armTable(arms: Metrics, label: string): string {
  const names: Record<string, string> = { student: "student", oracle: label, trainMean: "training mean" };
  const rows = (measure: "shareError" | "angleDeg", unitName: string): string[] => {
    const head = `| ${measure === "shareError" ? "Mean absolute share error" : "Normal angular error (degrees)"} | mean (95 % interval) | median (95 % interval) | p10 | p25 | p75 | p90 | p99 |\n|---|---|---|---|---|---|---|---|`;
    const body = ["student", "oracle", "trainMean"].map((a) => {
      const d = arms[a][measure];
      const q = d.quantiles;
      return `| ${names[a]} | ${iv(d.mean)} | ${iv(d.median)} | ${f(q.p10)} | ${f(q.p25)} | ${f(q.p75)} | ${f(q.p90)} | ${f(q.p99)} |`;
    });
    return [head, ...body, `\n(${unitName})`];
  };
  const top = ["student", "oracle", "trainMean"].map((a) => {
    const t = arms[a];
    const rc = t.recall;
    return `| ${names[a]} | ${iv(t.top1)} | ${rc.spineFace.agree} / ${rc.spineFace.boxCount} | ${rc.topFace.agree} / ${rc.topFace.boxCount} | ${rc.coverFace.agree} / ${rc.coverFace.boxCount} |`;
  });
  return [
    ...rows("shareError", "per box, over the pooled boxes; intervals are bootstrap over clusters"),
    "",
    ...rows("angleDeg", "per box; degrees between unit mean normals"),
    "",
    "| Top-1 face-class agreement with the teacher | share (95 % interval) | spine boxes agreed | top boxes agreed | cover boxes agreed |\n|---|---|---|---|---|",
    ...top,
  ].join("\n");
}

/** `report.md`: aggregates only, no photo, crop, id or path. Written from `metrics.json`; the verdict lines come first. */
export function renderReport(m: Metrics): string {
  const rule = m.keepRule;
  const logo = m.logo;
  const t = m.training;
  const L: string[] = [];
  L.push("# NS11: mono-geometry student distilled from MoGe-2 (development run)", "");
  L.push(`Pre-registration: [\`prereg.md\`](prereg.md), committed before the teacher table and before any training. Every figure here is **agreement with MoGe-2**, a machine output with no ground truth under it. **Nothing in this report is accuracy on real use** (OC36, INV-17): the student reproduces a teacher's guess about the faces of detected boxes on 31 stills of one phone and on a public yardstick.`, "");
  L.push("## Verdicts", "");
  if (rule) {
    L.push(`- **Development keep rule: ${rule.kept ? "KEPT" : "NOT KEPT"}.** K1 (share error at least 10 % below the per-group-mean baseline, interval above 0): ${rule.k1.passes ? "passes" : "fails"}, reduction ${pct(rule.k1.reduction.value)} (${pct(rule.k1.reduction.lo)} to ${pct(rule.k1.reduction.hi)}). K2 (median normal error at least 2.0 degrees below it, interval above 0): ${rule.k2.passes ? "passes" : "fails"}, gain ${f(rule.k2.gain.value, 2)} degrees (${f(rule.k2.gain.lo, 2)} to ${f(rule.k2.gain.hi, 2)}). Six split groups, leave-one-group-out.`);
  } else L.push(`- **Development keep rule: not scored.** Runs missing: ${m.missingRuns.join(", ")}.`);
  L.push(`- **NS-5: insufficient data.** The real degraded-tier column has **0 cases** (the owner's minimum is 14, with a 93.75 % one-sided lower bound that must clear 2.5 points). No degraded-tier session exists. This is neither a go nor a no-go, and no lift is claimed.`, "");

  L.push("## What was run", "");
  L.push(`- Teacher: \`${m.teacher.model}\` at \`${m.teacher.revision.slice(0, 7)}\` (${m.teacher.licence}), with \`faces.py\` at \`${m.teacher.facesSha256.slice(0, 8)}\`. Targets read from H-2's caches; **no new MoGe-2 run**.`);
  L.push(`- Student: GeometryStudentNet, from scratch, ${t.runs[0]?.params?.toLocaleString("en-US") ?? "n/a"} parameters (ceiling 10 million), input a 128×128 letterboxed crop of the box plus a 12-number geometry vector of the detection's outline; outputs three face shares and a unit normal. Loss: KL divergence on the shares plus (1 − cosine) on the normal.`);
  L.push(`- ${t.runs.length} runs on ${t.device?.toUpperCase()}: six leave-one-split-group-out models (the keep rule), and the frozen-split model with three seeds (the registered artifact is seed ${NS11.seed}). Recipe fixed in the pre-registration, never tuned.`, "");
  const p = m.population;
  L.push("## Population", "");
  L.push("| Set | Role | Photos | Kept boxes | Admitted | Excluded (mass under 0.5) | Teacher top-1 class: spine / top / cover |\n|---|---|---|---|---|---|---|");
  L.push(`| pilot-000 | training source (real use) | ${p.pilot.photos} | ${p.pilot.keptBoxes} | ${p.pilot.admitted} | ${p.pilot.excluded["low-mass"]} | ${p.teacherClasses.pilot.spineFace} / ${p.teacherClasses.pilot.topFace} / ${p.teacherClasses.pilot.coverFace} |`);
  L.push(`| yardstick-library-b2 | yardstick (PROXY), evaluation only | ${p.yardstick.photos} | ${p.yardstick.keptBoxes} | ${p.yardstick.admitted} | ${p.yardstick.excluded["low-mass"]} | ${p.teacherClasses.yardstick.spineFace} / ${p.teacherClasses.yardstick.topFace} / ${p.teacherClasses.yardstick.coverFace} |`, "");
  L.push(`Every admitted row is \`labelSource: mono-geometry\`, \`rgbRecoverable: yes\` (${p.pilot.admitted} + ${p.yardstick.admitted}); scheme \`drop-unrecoverable\` removes none. The teacher calls the **spine** face the largest of the three for ${pct(p.teacherClasses.pilot.spineFace / p.pilot.admitted)} of \`pilot-000\` boxes, so top-1 agreement is dominated by one class and gates nothing.`, "");

  if (logo) {
    L.push("## Development keep rule: leave-one-split-group-out (6 groups)", "");
    L.push(`Each of the ${logo.groups} split groups is predicted by a model trained on the other five (${logo.boxCount} boxes). The **baseline** is the per-split-group mean: the group's own mean distribution and unit mean normal, an oracle constant. Intervals: ${m.bootstrap.reps} resamples of the groups.`, "");
    L.push(armTable(logo.arms, "per-group mean (oracle)"), "");
    L.push("| Comparison | Share error: relative reduction (95 % interval) | Median normal error: gain in degrees (95 % interval) |\n|---|---|---|");
    L.push(`| student vs per-group mean (the rule) | ${iv({ value: logo.vsOracle.shareErrorReduction.value * 100, lo: logo.vsOracle.shareErrorReduction.lo * 100, hi: logo.vsOracle.shareErrorReduction.hi * 100 }, 1)} % | ${iv(logo.vsOracle.medianAngleGain, 2)} |`);
    L.push(`| student vs training mean | ${iv({ value: logo.vsTrainMean.shareErrorReduction.value * 100, lo: logo.vsTrainMean.shareErrorReduction.lo * 100, hi: logo.vsTrainMean.shareErrorReduction.hi * 100 }, 1)} % | ${iv(logo.vsTrainMean.medianAngleGain, 2)} |`, "");
    L.push("Per split group (groups unnamed, in sorted order of their keys):", "");
    L.push("| Group | Boxes | Student: share error / median angle / top-1 | Per-group mean: share error / median angle / top-1 |\n|---|---|---|---|");
    for (const g of logo.perGroup) L.push(`| ${g.cluster} | ${g.boxCount} | ${f(g.student.shareError)} / ${f(g.student.medianAngle, 2)} / ${pct(g.student.top1)} | ${f(g.oracle.shareError)} / ${f(g.oracle.medianAngle, 2)} / ${pct(g.oracle.top1)} |`);
    L.push("");
  }

  const fz = m.frozen;
  if (fz) {
    L.push("## Frozen split (the registered artifact)", "");
    L.push(`Trained on the four frozen \`train\` groups (24 stills), scored on the ${fz.valGroups} frozen \`val\` groups (7 stills). ${fz.note}.`, "");
    L.push("| Arm | Boxes | Share error: mean / p50 / p90 | Normal error (degrees): mean / p50 / p90 | Top-1 |\n|---|---|---|---|---|");
    for (const a of ["student", "oracle", "trainMean"]) {
      const x = fz.student[a];
      L.push(`| ${a === "oracle" ? "per-group mean (oracle)" : a === "trainMean" ? "training mean" : "student"} | ${x.boxCount} | ${f(x.shareError.mean)} / ${f(x.shareError.p50)} / ${f(x.shareError.p90)} | ${f(x.angleDeg.mean, 2)} / ${f(x.angleDeg.p50, 2)} / ${f(x.angleDeg.p90, 2)} | ${pct(x.top1)} |`);
    }
    L.push("", `Seed spread of the student on \`val\` (${fz.seeds.length} seeds): mean share error ${f(fz.seedSpread.shareError.min)} to ${f(fz.seedSpread.shareError.max)}; median normal error ${f(fz.seedSpread.medianAngle.min, 2)} to ${f(fz.seedSpread.medianAngle.max, 2)} degrees; top-1 ${pct(fz.seedSpread.top1.min)} to ${pct(fz.seedSpread.top1.max)}.`, "");
  }

  const y = m.yardstick;
  if (y) {
    L.push("## Yardstick (PROXY; never trained on; decides nothing)", "");
    L.push(`${y.boxCount} boxes in ${y.photos} photos; the cluster is the photo, the oracle baseline is the photo's own mean. A different camera, place and lens from the training stills: this shows how the pilot-trained student carries to unseen conditions, as agreement with the same teacher.`, "");
    L.push(armTable(y.arms, "per-photo mean (oracle)"), "");
    L.push("| Comparison | Share error: relative reduction (95 % interval) | Median normal error: gain in degrees (95 % interval) |\n|---|---|---|");
    L.push(`| student vs per-photo mean | ${iv({ value: y.vsOracle.shareErrorReduction.value * 100, lo: y.vsOracle.shareErrorReduction.lo * 100, hi: y.vsOracle.shareErrorReduction.hi * 100 }, 1)} % | ${iv(y.vsOracle.medianAngleGain, 2)} |`);
    L.push(`| student vs pilot-000 training mean | ${iv({ value: y.vsTrainMean.shareErrorReduction.value * 100, lo: y.vsTrainMean.shareErrorReduction.lo * 100, hi: y.vsTrainMean.shareErrorReduction.hi * 100 }, 1)} % | ${iv(y.vsTrainMean.medianAngleGain, 2)} |`, "");
  }

  const ex = m.exploratory ?? {};
  if (Object.keys(ex).length) {
    L.push("## Exploratory ablations (not pre-registered; no keep rule; labelled so)", "");
    L.push("Added after the nine registered runs came back strong on `pilot-000` and weak on the yardstick, to ask whether the crop's pixels carry the signal or the box's position and shape do. Same recipe, same six leave-one-group-out folds, same measures; **they decide nothing** and change no verdict. `no image`: the geometry branch, trunk and heads only. `no geometry`: the full network with the 12-number vector set to zero.", "");
    L.push("| Arm | LOGO share error: mean (95 % interval) | LOGO median normal error, degrees | Share error vs the per-group mean | Normal gain vs the per-group mean, degrees | Yardstick share error: mean | Yardstick median normal error, degrees |\n|---|---|---|---|---|---|---|");
    const pctIv = (i: Interval): string => iv({ value: i.value * 100, lo: i.lo * 100, hi: i.hi * 100 }, 1) + " %";
    const row = (label: string, logoArm: Metrics, vs: Metrics, yard: Metrics | null): string => `| ${label} | ${iv(logoArm.shareError.mean)} | ${iv(logoArm.angleDeg.median, 2)} | ${pctIv(vs.shareErrorReduction)} reduction | ${iv(vs.medianAngleGain, 2)} | ${yard ? iv(yard.arm.shareError.mean) : "n/a"} | ${yard ? iv(yard.arm.angleDeg.median, 2) : "n/a"} |`;
    if (m.logo) L.push(row("full student (registered)", m.logo.arms.student, m.logo.vsOracle, m.yardstick ? { arm: m.yardstick.arms.student } : null));
    for (const [k, label] of [["geomonly", "no image (geometry vector only)"], ["croponly", "no geometry (crop only)"]] as const)
      if (ex[k]) L.push(row(label, ex[k].logo.arm, ex[k].logo.vsOracle, ex[k].yardstick));
    L.push("");
    for (const [k, label] of [["geomonly", "no image"], ["croponly", "no geometry"]] as const)
      if (ex[k]) L.push(`- Against the full student on the same folds, the ${label} arm's relative share-error reduction is ${pctIv(ex[k].logo.vsFullStudent.shareErrorReduction)} and its median-normal-error gain ${iv(ex[k].logo.vsFullStudent.medianAngleGain, 2)} degrees (a negative figure means the arm is worse than the full student).`);
    L.push("");
  }

  const c = m.coreml;
  L.push("## Core ML on the Mac, and the teacher's cost avoided", "");
  if (c?.exported) {
    L.push(`Export: \`coremltools\` ${c.coremltools}, \`mlprogram\`, float16, minimum deployment ${c.minimumDeployment}. **Package size ${(c.packageBytes / 1048576).toFixed(2)} MiB** (${c.packageBytes.toLocaleString("en-US")} bytes).`, "");
    L.push("| Compute units | Single-box latency, median (ms) | p90 (ms) | Load (s) | Max abs share difference vs float32 PyTorch | Max normal difference (degrees) | Top-1 same |\n|---|---|---|---|---|---|---|");
    for (const [k, v] of Object.entries(c.latencyMs as Record<string, Metrics>)) {
      const a = c.agreement?.[k];
      L.push(v.error ? `| ${k} | failed: ${v.error} | | | | | |` : `| ${k} | ${f(v.median, 2)} | ${f(v.p90, 2)} | ${f(v.loadSeconds, 2)} | ${f(a?.maxAbsShareDiff, 4)} | ${f(a?.maxNormalDiffDeg, 3)} | ${pct(a?.top1Same)} |`);
    }
    L.push("", `Latency is a batch of one crop through the Python call (its overhead included) after ${30} warm-up calls, ${c.latencyMs.ALL?.timedCalls ?? 300} timed; on this Mac, not an iPhone (NS-9 measures the phone).`);
  } else L.push(`Core ML export **failed**: ${c?.error ?? "not run"}. The architecture was not changed.`);
  const cost = m.cost;
  L.push("", `Teacher cost (H-2, \`pilot-000\`, cold photos on MPS): MoGe-2 inference ${f(cost.teacher.inferenceP50Seconds, 2)} s a photo at the median, the whole stage ${f(cost.teacher.wholeStageP50Seconds, 2)} s (decode, inference, cache write, faces), plus ${f(cost.teacher.modelLoadSeconds, 1)} s once to load. Student cost for the ${f(cost.student.admittedBoxesPerPhoto, 1)} admitted boxes of an average \`pilot-000\` photo: ${cost.student.mpsSecondsPerPhoto === null ? "n/a" : `${f(cost.student.mpsSecondsPerPhoto, 3)} s batched on MPS (${f(cost.student.mpsBatch64BoxesPerSecond, 0)} boxes a second)`}; one box at a time through Core ML: ${Object.entries(cost.student.coreMlSecondsPerPhotoOneByOne as Record<string, number>).map(([k, v]) => `${k} ${f(v, 3)} s`).join(", ") || "n/a"}. These are two runs of one machine, not a ratio of equals; ${cost.student.note}.`, "");

  L.push("## Training", "");
  L.push("| Run | Kind | Seed | Train rows | Eval rows | Epoch-1 loss | Final loss | Wall seconds |\n|---|---|---|---|---|---|---|---|");
  for (const r of t.runs) L.push(`| ${r.name} | ${r.kind} | ${r.seed} | ${r.trainRows} | ${r.evalRows} | ${f(r.firstLoss, 4)} | ${f(r.finalLoss, 4)} | ${f(r.wallSeconds, 0)} |`);
  L.push("", `Training wall time: the ${t.runs.length} registered runs **${f(t.registeredWallSeconds / 60, 1)} minutes**, the exploratory ablations ${f(t.ablationWallSeconds / 60, 1)} minutes, **${f(t.totalWallSeconds / 60, 1)} minutes in all** of the 120-minute cap (the Core ML export and scoring are a few seconds each). Peak resident memory ${mib(t.peakRssBytes)}; peak MPS allocation ${mib(t.peakMpsAllocatedBytes)}. Training is not bit-reproducible on MPS; the seed, the data order and the recipe are fixed.`, "");

  L.push("## NS-5 column", "");
  L.push(`The real degraded-tier column has **0 cases** against the owner's minimum of ${m.ns5.minimumCases}. Verdict under \`evals/NS5/prereg.md\`: **insufficient data**. Every \`pilot-000\` still is \`metric-depth\` and \`shopper-still\` with no case id, so no row can enter it; this card scores none of G-SWEEP's measures and builds no \`single-view\` comparison arm (there is no non-privileged label for these targets). **Unlocked by:** NS-3's degraded-tier sweeps and the borrowed non-Pro phone's natural-sweep sessions, recorded at capture with case ids (14 or more in one column); a comparison arm or a stated reason none exists; and the Apple agreement reading if app-captured depth is ever used.`, "");

  L.push("## What this does not show", "");
  L.push("- A teacher's guess is not the book's real faces: where MoGe-2 mislabels a face, the student learns the mislabel, and it is rewarded for agreeing. The top-face class (the steep-angle proxy of H-2) is rare in these stills, and the spine class dominates.");
  L.push("- One phone, six stands: leave-one-group-out over six groups is the least that carries an interval, and it is wide. The yardstick is another camera and place, as agreement only.");
  L.push("- The geometry vector comes from detection outlines of this stack's detector; a different detector on a phone gives different outlines.");
  L.push("- The Mac's Core ML latency says nothing certain about an iPhone.");
  return L.join("\n") + "\n";
}
