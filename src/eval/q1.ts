// Q-1 first failure-pattern pass: the statistics. Pure functions over per-spine rows (features from
// helpers/coverage, outcomes from F-0's decisions); the runner is q1-cli.ts. Every interval is a cluster
// bootstrap over photos, because spines in one photo share its light, focus and distance.

export const OUTCOMES = [
  "confirmed",
  "unknown:no-text",
  "unknown:no-catalog-match",
  "unknown:single-reader",
  "unknown:readers-disagree",
  "rejected/wrong",
] as const;
export type Outcome = (typeof OUTCOMES)[number];

export interface Row {
  id: string;
  imageId: string;
  outcome: Outcome;
  /** Numeric features; null when not measurable (e.g. a polygon wholly outside the image). */
  f: Record<string, number | null>;
}

/** Deterministic PRNG (mulberry32), so every interval in metrics.json reproduces. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** Bin edges at quantiles of the values (ties collapse), so each bin holds roughly the same count. */
export function quantileEdges(values: number[], bins: number): number[] {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (s.length === 0) return [];
  const edges = [s[0]!];
  for (let i = 1; i < bins; i++) {
    const e = quantile(s, i / bins);
    if (e > edges[edges.length - 1]!) edges.push(e);
  }
  if (s[s.length - 1]! > edges[edges.length - 1]!) edges.push(s[s.length - 1]!);
  else edges.push(edges[edges.length - 1]!);
  // A mostly-constant feature (a flag, or a fraction that is usually 0) collapses to one bin: split it into
  // "equal to the minimum" and "above it" instead.
  if (edges.length < 3) {
    const next = s.find((v) => v > s[0]!);
    if (next !== undefined) return [s[0]!, next, s[s.length - 1]!];
  }
  return edges;
}

/** Index of the bin holding x: bins are [e0,e1), [e1,e2) … with the last one closed. -1 outside. */
export function binOf(x: number, edges: number[]): number {
  if (edges.length < 2 || x < edges[0]! || x > edges[edges.length - 1]!) return -1;
  for (let i = 1; i < edges.length; i++) if (x < edges[i]!) return i - 1;
  return edges.length - 2;
}

/** Rows grouped by photo, the unit the bootstrap resamples. */
export function byImage<T extends { imageId: string }>(rows: T[]): T[][] {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const g = m.get(r.imageId);
    if (g) g.push(r);
    else m.set(r.imageId, [r]);
  }
  return [...m.keys()].sort().map((k) => m.get(k)!);
}

/**
 * Point estimate and 95 % percentile interval of `stat` under a cluster bootstrap: photos are drawn with
 * replacement and `stat` is recomputed on the pooled rows. Returns null when the statistic is undefined.
 */
export function clusterBootstrap<T extends { imageId: string }>(
  rows: T[],
  stat: (rows: T[]) => number | null,
  reps = 1000,
  seed = 1,
): { value: number; lo: number; hi: number } | null {
  const value = stat(rows);
  if (value === null || !Number.isFinite(value)) return null;
  const groups = byImage(rows);
  const rand = rng(seed);
  const draws: number[] = [];
  for (let r = 0; r < reps; r++) {
    const sample: T[] = [];
    for (let i = 0; i < groups.length; i++) sample.push(...groups[Math.floor(rand() * groups.length)]!);
    const v = stat(sample);
    if (v !== null && Number.isFinite(v)) draws.push(v);
  }
  draws.sort((a, b) => a - b);
  return { value, lo: quantile(draws, 0.025), hi: quantile(draws, 0.975) };
}

export const rate = <T>(pred: (r: T) => boolean, of: (r: T) => boolean = () => true) => (rows: T[]): number | null => {
  let n = 0, k = 0;
  for (const r of rows) if (of(r)) { n++; if (pred(r)) k++; }
  return n ? k / n : null;
};

/** Mann-Whitney AUC: P(score of a positive > score of a negative), ties counted half. */
export function auc(pos: number[], neg: number[]): number | null {
  if (pos.length === 0 || neg.length === 0) return null;
  const all = [...pos.map((v) => ({ v, p: 1 })), ...neg.map((v) => ({ v, p: 0 }))].sort((a, b) => a.v - b.v);
  let rankSum = 0;
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j < all.length && all[j]!.v === all[i]!.v) j++;
    const mid = (i + j + 1) / 2; // 1-based mean rank of the tie block
    for (let k = i; k < j; k++) if (all[k]!.p) rankSum += mid;
    i = j;
  }
  return (rankSum - (pos.length * (pos.length + 1)) / 2) / (pos.length * neg.length);
}

export interface Bin {
  lo: number;
  hi: number;
  n: number;
  counts: Partial<Record<Outcome, number>>;
  /** Share confirmed, with its photo-bootstrap interval. */
  confirmed: [number, number, number] | null;
  /** Share where no reader produced any text. */
  noText: [number, number, number] | null;
}

const r4 = (x: number) => Math.round(x * 10000) / 10000;
const tri = (b: { value: number; lo: number; hi: number } | null): [number, number, number] | null =>
  b ? [r4(b.value), r4(b.lo), r4(b.hi)] : null;

/** Outcome curve for one feature: quantile bins, outcome counts, confirmed and no-text rates with intervals. */
export function curve(rows: Row[], feature: string, bins = 8, reps = 1000, edgesIn?: number[]): { edges: number[]; bins: Bin[] } {
  const has = rows.filter((r) => r.f[feature] !== null && r.f[feature] !== undefined && Number.isFinite(r.f[feature]!));
  const edges = edgesIn ?? quantileEdges(has.map((r) => r.f[feature]!), bins);
  const nb = Math.max(0, edges.length - 1);
  // Per photo and bin: [spines, confirmed, no-text]. The bootstrap redraws photos and pools these counts.
  const groups = byImage(has).map((g) => {
    const c = Array.from({ length: nb }, () => [0, 0, 0]);
    for (const r of g) {
      const b = binOf(r.f[feature]!, edges);
      if (b < 0) continue;
      c[b]![0]!++;
      if (r.outcome === "confirmed") c[b]![1]!++;
      if (r.outcome === "unknown:no-text") c[b]![2]!++;
    }
    return c;
  });
  const pooled = (gs: number[][][]) => {
    const t = Array.from({ length: nb }, () => [0, 0, 0]);
    for (const g of gs) for (let b = 0; b < nb; b++) for (let j = 0; j < 3; j++) t[b]![j]! += g[b]![j]!;
    return t;
  };
  const point = pooled(groups);
  const rand = rng(11);
  const draws = Array.from({ length: nb }, () => [[] as number[], [] as number[]]);
  for (let rep = 0; rep < reps && groups.length; rep++) {
    const t = pooled(Array.from({ length: groups.length }, () => groups[Math.floor(rand() * groups.length)]!));
    for (let b = 0; b < nb; b++) if (t[b]![0]) { draws[b]![0]!.push(t[b]![1]! / t[b]![0]!); draws[b]![1]!.push(t[b]![2]! / t[b]![0]!); }
  }
  const ci = (v: number, d: number[]): [number, number, number] => {
    d.sort((a, b) => a - b);
    return [r4(v), r4(quantile(d, 0.025)), r4(quantile(d, 0.975))];
  };
  const out: Bin[] = [];
  for (let b = 0; b < nb; b++) {
    const counts: Partial<Record<Outcome, number>> = {};
    for (const r of has) if (binOf(r.f[feature]!, edges) === b) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
    const n = point[b]![0]!;
    out.push({
      lo: r4(edges[b]!),
      hi: r4(edges[b + 1]!),
      n,
      counts,
      confirmed: n ? ci(point[b]![1]! / n, draws[b]![0]!) : null,
      noText: n ? ci(point[b]![2]! / n, draws[b]![1]!) : null,
    });
  }
  return { edges: edges.map(r4), bins: out };
}

/**
 * How well one feature alone separates two outcome groups. `auc` is oriented so > 0.5 means larger values go
 * with `pos`; `separation` is max(auc, 1 - auc), the direction-free strength.
 */
export function separation(rows: Row[], feature: string, pos: (o: Outcome) => boolean, neg: (o: Outcome) => boolean, reps = 1000) {
  const use = rows.filter((r) => (pos(r.outcome) || neg(r.outcome)) && r.f[feature] !== null && Number.isFinite(r.f[feature]!));
  const stat = (rs: Row[]) => auc(rs.filter((r) => pos(r.outcome)).map((r) => r.f[feature]!), rs.filter((r) => neg(r.outcome)).map((r) => r.f[feature]!));
  const b = clusterBootstrap(use, stat, reps, 7);
  if (!b) return null;
  return { n: use.length, auc: tri(b)!, separation: r4(Math.max(b.value, 1 - b.value)), higherIsPos: b.value >= 0.5 };
}

/**
 * Failure heatmap on a cols x rows grid of normalised image coordinates. `rate` is the pooled share of
 * spines in the cell that are not confirmed; `residual` is normalised per photo: each photo's own failure
 * rate is subtracted from its spines first, so a photo that failed everywhere does not colour every cell.
 */
export function heatmap(rows: Row[], cols: number, rowsN: number, fail: (o: Outcome) => boolean = (o) => o !== "confirmed") {
  const n = Array.from({ length: rowsN }, () => new Array<number>(cols).fill(0));
  const k = Array.from({ length: rowsN }, () => new Array<number>(cols).fill(0));
  const res = Array.from({ length: rowsN }, () => new Array<number>(cols).fill(0));
  for (const g of byImage(rows)) {
    const base = g.filter((r) => fail(r.outcome)).length / g.length;
    for (const r of g) {
      const cx = r.f.cx, cy = r.f.cy;
      if (cx === null || cy === null || cx === undefined || cy === undefined) continue;
      const c = Math.min(cols - 1, Math.max(0, Math.floor(cx * cols)));
      const w = Math.min(rowsN - 1, Math.max(0, Math.floor(cy * rowsN)));
      const f = fail(r.outcome) ? 1 : 0;
      n[w]![c]!++;
      k[w]![c]! += f;
      res[w]![c]! += f - base;
    }
  }
  const div = (a: number[][]) => a.map((row, w) => row.map((v, c) => (n[w]![c]! ? r4(v / n[w]![c]!) : null)));
  return { cols, rows: rowsN, count: n, rate: div(k), residual: div(res) };
}

/** Spearman rank correlation (ties averaged). */
export function spearman(x: number[], y: number[]): number | null {
  if (x.length < 3 || x.length !== y.length) return null;
  const rank = (v: number[]) => {
    const idx = v.map((val, i) => ({ val, i })).sort((a, b) => a.val - b.val);
    const r = new Array<number>(v.length);
    for (let i = 0; i < idx.length; ) {
      let j = i;
      while (j < idx.length && idx[j]!.val === idx[i]!.val) j++;
      for (let k = i; k < j; k++) r[idx[k]!.i] = (i + j - 1) / 2;
      i = j;
    }
    return r;
  };
  const rx = rank(x), ry = rank(y);
  const mx = rx.reduce((a, b) => a + b, 0) / rx.length, my = ry.reduce((a, b) => a + b, 0) / ry.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < rx.length; i++) {
    sxy += (rx[i]! - mx) * (ry[i]! - my);
    sxx += (rx[i]! - mx) ** 2;
    syy += (ry[i]! - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

// --- descriptive models (no tuning; fit on one split, scored on the other) ---------------------------

/** Holdout by photo: every `k`-th photo in sorted id order is held out. */
export function splitByImage<T extends { imageId: string }>(rows: T[], k = 3): { train: T[]; test: T[] } {
  const ids = [...new Set(rows.map((r) => r.imageId))].sort();
  const held = new Set(ids.filter((_, i) => i % k === k - 1));
  return { train: rows.filter((r) => !held.has(r.imageId)), test: rows.filter((r) => held.has(r.imageId)) };
}

export interface Logistic {
  features: string[];
  mean: number[];
  sd: number[];
  /** Intercept first, then one weight per standardised feature. */
  weights: number[];
}

/** Logistic regression by Newton's method on standardised features, with a fixed tiny ridge for stability. */
export function fitLogistic(x: number[][], y: number[], features: string[], iters = 25, ridge = 1e-4): Logistic {
  const d = features.length;
  const mean = features.map((_, j) => x.reduce((a, r) => a + r[j]!, 0) / x.length);
  const sd = features.map((_, j) => Math.sqrt(x.reduce((a, r) => a + (r[j]! - mean[j]!) ** 2, 0) / x.length) || 1);
  const z = x.map((r) => [1, ...r.map((v, j) => (v - mean[j]!) / sd[j]!)]);
  const w = new Array<number>(d + 1).fill(0);
  for (let it = 0; it < iters; it++) {
    const g = new Array<number>(d + 1).fill(0);
    const h = Array.from({ length: d + 1 }, () => new Array<number>(d + 1).fill(0));
    for (let i = 0; i < z.length; i++) {
      const p = 1 / (1 + Math.exp(-z[i]!.reduce((a, v, j) => a + v * w[j]!, 0)));
      for (let a = 0; a <= d; a++) {
        g[a]! += (p - y[i]!) * z[i]![a]!;
        for (let b = 0; b <= d; b++) h[a]![b]! += p * (1 - p) * z[i]![a]! * z[i]![b]!;
      }
    }
    for (let a = 1; a <= d; a++) { g[a]! += ridge * w[a]!; h[a]![a]! += ridge; }
    const step = solve(h, g);
    for (let a = 0; a <= d; a++) w[a]! -= step[a]!;
  }
  return { features, mean, sd, weights: w };
}

export function predictLogistic(m: Logistic, x: number[]): number {
  const s = m.weights[0]! + x.reduce((a, v, j) => a + m.weights[j + 1]! * ((v - m.mean[j]!) / m.sd[j]!), 0);
  return 1 / (1 + Math.exp(-s));
}

/** Gaussian elimination with partial pivoting; small dense systems only. */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[p]![c]!)) p = r;
    [m[c], m[p]] = [m[p]!, m[c]!];
    const piv = m[c]![c]! || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r]![c]! / piv;
      for (let k = c; k <= n; k++) m[r]![k]! -= f * m[c]![k]!;
    }
  }
  return m.map((row, i) => row[n]! / (m[i]![i]! || 1e-12));
}

export type Tree = { leaf: true; n: number; pos: number; p: number } | { leaf: false; feature: string; threshold: number; n: number; p: number; lo: Tree; hi: Tree };

/**
 * CART classification tree (Gini), depth-limited, candidate thresholds at 32 quantiles per feature, a fixed
 * minimum leaf size. Rows with a missing value in the split feature go to the `lo` side.
 */
export function fitTree(x: Record<string, number | null>[], y: number[], features: string[], depth = 3, minLeaf = 40): Tree {
  const idx = x.map((_, i) => i);
  const grow = (ids: number[], d: number): Tree => {
    const pos = ids.reduce((a, i) => a + y[i]!, 0);
    const p = ids.length ? pos / ids.length : 0;
    if (d === 0 || ids.length < 2 * minLeaf || pos === 0 || pos === ids.length) return { leaf: true, n: ids.length, pos, p: r4(p) };
    const gini = (k: number, n: number) => (n ? 1 - (k / n) ** 2 - (1 - k / n) ** 2 : 0);
    let best: { f: string; t: number; score: number; lo: number[]; hi: number[] } | null = null;
    for (const f of features) {
      const vals = ids.map((i) => x[i]![f]).filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
      const cands = new Set<number>();
      for (let q = 1; q < 32; q++) cands.add(quantile(vals, q / 32));
      for (const t of cands) {
        const lo = ids.filter((i) => { const v = x[i]![f]; return v === null || !(v > t); });
        const hi = ids.filter((i) => { const v = x[i]![f]; return v !== null && v > t; });
        if (lo.length < minLeaf || hi.length < minLeaf) continue;
        const kl = lo.reduce((a, i) => a + y[i]!, 0), kh = hi.reduce((a, i) => a + y[i]!, 0);
        const score = (lo.length * gini(kl, lo.length) + hi.length * gini(kh, hi.length)) / ids.length;
        if (!best || score < best.score) best = { f, t, score, lo, hi };
      }
    }
    if (!best || best.score >= gini(pos, ids.length)) return { leaf: true, n: ids.length, pos, p: r4(p) };
    return { leaf: false, feature: best.f, threshold: r4(best.t), n: ids.length, p: r4(p), lo: grow(best.lo, d - 1), hi: grow(best.hi, d - 1) };
  };
  return grow(idx, depth);
}

export function predictTree(t: Tree, x: Record<string, number | null>): number {
  while (!t.leaf) {
    const v = x[t.feature];
    t = v !== null && v !== undefined && v > t.threshold ? t.hi : t.lo;
  }
  return t.p;
}

/** The tree as indented if/else lines, for the report. */
export function treeLines(t: Tree, indent = ""): string[] {
  if (t.leaf) return [`${indent}→ ${(t.p * 100).toFixed(0)} % positive (n=${t.n})`];
  return [
    `${indent}if ${t.feature} ≤ ${t.threshold}:`,
    ...treeLines(t.lo, indent + "  "),
    `${indent}else:`,
    ...treeLines(t.hi, indent + "  "),
  ];
}
