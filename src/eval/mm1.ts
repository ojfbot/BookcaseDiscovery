// MM-1 · spine pixels and embeddings: one private record per box of RB-1's box set, with its upright strip and two
// embeddings (DINOv2 base for how the copy looks, SigLIP 2 base for an image space shared with text), keyed to the
// box, the box set and the model revision (INV-14). Records only: nothing here changes a decision. The appearance
// switch is off and nothing reads it yet; MM-2 is the shadow-mode card, and pixels never confirm alone (owner,
// 2026-11-04). Pure, plus the record schema; the runner is `src/eval/mm1-cli.ts`, the pre-registration
// `evals/MM1/prereg.md`.

import { z } from "zod";
import { APPEARANCE_DEFAULT, APPEARANCE_MODES, type AppearanceMode } from "../identify/appearance.ts";
import { READERS, type ReaderName } from "./f0.ts";
import { rng } from "./q1.ts";
import { RUNGS } from "./q2.ts";
import { isTrainable } from "./set-roles.ts";
import { BASES, contentHash, sha256, type Basis } from "./ts0.ts";

// --- the appearance switch -------------------------------------------------------------------------------

// The switch itself lives in identify, which reads it (DL-4: identify never imports eval); MM-1 re-exports it.
export { APPEARANCE_DEFAULT, APPEARANCE_MODES, type AppearanceMode } from "../identify/appearance.ts";

/** `--appearance <mode>`; the default when absent. An unknown mode is an error, never a silent default. */
export function appearanceMode(argv: readonly string[] = process.argv): AppearanceMode {
  const k = argv.indexOf("--appearance");
  if (k < 0) return APPEARANCE_DEFAULT;
  const v = argv[k + 1];
  if (!APPEARANCE_MODES.includes(v as AppearanceMode)) throw new Error(`--appearance: expected one of ${APPEARANCE_MODES.join(", ")}`);
  return v as AppearanceMode;
}

// --- constants ---------------------------------------------------------------------------------------------

export const MM1 = {
  schemaVersion: "mm1/1",
  /** The upright strip (helpers/embed/embed.py): the detection polygon warped upright, long side capped. */
  strip: { method: "upright-warp", polygon: "detection", longSide: 512 },
  models: {
    dinov2: { repo: "facebook/dinov2-base", dir: "dinov2-base", input: { canvas: [112, 448], pad: "imagenet-mean", feature: "pooler-cls" } },
    siglip2: { repo: "google/siglip2-base-patch16-naflex", dir: "siglip2-base-patch16-naflex", input: { maxPatches: 256, feature: "image-pooled" } },
  },
  /** Sets, stored and reported apart (OC35). The yardstick's records are for evaluation only. */
  sets: ["pilot-000", "yardstick"],
  evaluationOnly: { "pilot-000": false, yardstick: true },
  bootstrap: { reps: 2000, seed: 20261105 },
} as const;

export type ModelName = keyof typeof MM1.models;
export const MODELS = Object.keys(MM1.models) as ModelName[];
export type MmSet = (typeof MM1.sets)[number];

/** Any set that is not a declared training source (DL-5's set roles, fail closed): never trained on (OC35). Its records carry `evaluationOnly: true`. */
export const isEvaluationOnly = (set: string): boolean => !isTrainable(set);

// --- keys (INV-14) -----------------------------------------------------------------------------------------

type Pt = [number, number];

/** The strip's cache key: the box, its polygon and the strip method. A model change never re-cuts a strip. */
export const stripKey = (boxId: string, polygon: readonly Pt[]): string => sha256(`${boxId}\u0000${JSON.stringify(polygon)}\u0000${JSON.stringify(MM1.strip)}`).slice(0, 24);

/** One model's embedding folder name: its revision and input spec, so a changed input never reuses a vector. */
export const embedDir = (model: ModelName, revision: string): string => `${model}@${contentHash({ revision, input: MM1.models[model].input }).slice(0, 12)}`;

/** The box set's hash: every kept box with its detection polygon and (where F-0i changed it) exclusive outline. */
export const boxSetHash = (set: string, boxes: { id: string; polygon: readonly Pt[]; outline: readonly Pt[] | null }[]): string =>
  contentHash({ set, boxes: [...boxes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) });

/** The model revision: both checkpoints' Hugging Face revisions, their inputs, the strip method and the helper. */
export const modelRevision = (revisions: Record<ModelName, string>, helperSha: string): string =>
  contentHash({ strip: MM1.strip, models: Object.fromEntries(MODELS.map((m) => [m, { ...MM1.models[m], revision: revisions[m] }])), helper: helperSha });

/** A records file's version: deterministic from the box set and the model revision. */
export const recordsVersion = (boxSet: string, revision: string): string => `mm-${contentHash({ schema: MM1.schemaVersion, boxSet, revision }).slice(0, 12)}`;

// --- the record --------------------------------------------------------------------------------------------

const Hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const Reader = z.enum(READERS as [ReaderName, ...ReaderName[]]);
const Vec = z.strictObject({ path: z.string().min(1), dims: z.number().int().positive(), revision: z.string().min(1) });

export const MmRecord = z.strictObject({
  schemaVersion: z.literal(MM1.schemaVersion),
  version: z.string().regex(/^mm-[0-9a-f]{12}$/),
  /** INV-14: the box, the box set and the model revision. */
  key: z.strictObject({ boxId: z.string().min(1), boxSet: Hex64, modelRevision: Hex64 }),
  set: z.string().min(1),
  /** True on a yardstick or audit set: for evaluation only, never a training or gallery input (OC35). */
  evaluationOnly: z.boolean(),
  /** The cached reads of each reader that read the box (private: they hold reader text). */
  readings: z.partialRecord(Reader, z.strictObject({ crop: z.string(), variants: z.array(z.strictObject({ rotation: z.number(), text: z.string(), confidence: z.number() })) })),
  /** TS-0's label rule on the cached F-0, F-0g and F-0h decisions; null with no label or a copy/context conflict. */
  basis: z.enum(BASES).nullable(),
  workId: z.string().min(1).nullable(),
  readers: z.array(Reader),
  conflict: z.boolean(),
  /** confirmed-by-copy: the copy whose work this box takes (F-0g's `from`); the two stay two records (INV-4). */
  copyOf: z.string().min(1).nullable(),
  rung: z.enum(RUNGS),
  /** TS-0's export version holding this box's label, when it has one. */
  ledger: z.strictObject({ version: z.string().regex(/^v-[0-9a-f]{12}$/), split: z.string().min(1) }).nullable(),
  strip: z.strictObject({ key: z.string().regex(/^[0-9a-f]{24}$/), path: z.string().min(1), size: z.tuple([z.number().int(), z.number().int()]), valid: z.boolean() }),
  embeddings: z.strictObject({ dinov2: Vec, siglip2: Vec }),
});
export type MmRecord = z.infer<typeof MmRecord>;

/** INV-4: one record per physical copy. Two records with one box id would be a merge or a duplicate; refuse both. */
export function assertOneRecordPerCopy(records: readonly Pick<MmRecord, "key">[]): void {
  const seen = new Set<string>();
  for (const r of records) {
    if (seen.has(r.key.boxId)) throw new Error("MM-1: two records for one box (INV-4: copies are never merged)");
    seen.add(r.key.boxId);
  }
}

/** OC35: a records file holds one set, and a yardstick's records are all marked for evaluation only. */
export function assertSeparated(set: string, records: readonly Pick<MmRecord, "set" | "evaluationOnly">[]): void {
  for (const r of records) {
    if (r.set !== set) throw new Error("MM-1: a records file mixes sets (OC35: never pooled)");
    if (r.evaluationOnly !== isEvaluationOnly(set)) throw new Error("MM-1: a record's evaluation-only mark does not match its set");
  }
}

// --- measures (evals/MM1/prereg.md) ------------------------------------------------------------------------

export const cosine = (a: Float32Array, b: Float32Array): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
};

/** One unordered pair of records: its similarity and the photos (by index) its two boxes are in. */
export interface Pair {
  s: number;
  a: number;
  b: number;
}

export interface Box {
  id: string;
  photo: number;
  basis: Basis | null;
  workId: string | null;
  copyOf: string | null;
  valid: boolean;
}

export interface PairSets {
  /** M1: a confirmed-by-copy box and the copy it takes its work from. */
  copy: Pair[];
  /** M1's control: every other pair of boxes in one photo (pairs of one work left out). */
  samePhoto: Pair[];
  /** M2: same-work pairs where both boxes are `readers-agree` (no pixel test chose them). */
  sameWorkText: Pair[];
  /** M3: same-work pairs of confirmed boxes, any basis. */
  sameWork: Pair[];
  /** M2, M3: different-work pairs of confirmed boxes, any basis. */
  differentWork: Pair[];
}

/** Every pair the measures read, from boxes with a valid strip. `sim(i, j)` is the cosine of boxes i and j. */
export function pairSets(boxes: readonly Box[], sim: (i: number, j: number) => number): PairSets {
  const out: PairSets = { copy: [], samePhoto: [], sameWorkText: [], sameWork: [], differentWork: [] };
  const idx = new Map(boxes.map((b, i) => [b.id, i]));
  const live = boxes.map((b, i) => [b, i] as const).filter(([b]) => b.valid);
  for (const [b, i] of live) {
    if (b.basis !== "confirmed-by-copy" || !b.copyOf) continue;
    const j = idx.get(b.copyOf);
    if (j !== undefined && boxes[j]!.valid) out.copy.push({ s: sim(i, j), a: b.photo, b: boxes[j]!.photo });
  }
  for (let x = 0; x < live.length; x++) {
    const [p, i] = live[x]!;
    for (let y = x + 1; y < live.length; y++) {
      const [q, j] = live[y]!;
      const same = !!p.workId && p.workId === q.workId;
      const both = !!p.workId && !!q.workId;
      if (p.photo === q.photo && !same) out.samePhoto.push({ s: sim(i, j), a: p.photo, b: q.photo });
      if (!both) continue;
      const pair = { s: sim(i, j), a: p.photo, b: q.photo };
      if (same) {
        out.sameWork.push(pair);
        if (p.basis === "readers-agree" && q.basis === "readers-agree") out.sameWorkText.push(pair);
      } else out.differentWork.push(pair);
    }
  }
  return out;
}

/** A pair's weight when photos are drawn with counts `m`: m_a·m_b across two photos, m_a within one. */
const weightOf = (p: Pair, m: ArrayLike<number>): number => (p.a === p.b ? m[p.a]! : m[p.a]! * m[p.b]!);

/** Weighted Mann-Whitney AUC: P(a positive's similarity > a negative's), ties half. Both lists sorted by `s`. */
export function weightedAuc(pos: readonly Pair[], neg: readonly Pair[], m: ArrayLike<number>): number | null {
  let wp = 0, wn = 0, acc = 0, below = 0;
  let j = 0;
  for (let i = 0; i < pos.length; ) {
    const v = pos[i]!.s;
    while (j < neg.length && neg[j]!.s < v) below += weightOf(neg[j++]!, m);
    let tie = 0;
    for (let k = j; k < neg.length && neg[k]!.s === v; k++) tie += weightOf(neg[k]!, m);
    let w = 0;
    for (; i < pos.length && pos[i]!.s === v; i++) w += weightOf(pos[i]!, m);
    acc += w * (below + tie / 2);
    wp += w;
  }
  for (const n of neg) wn += weightOf(n, m);
  return wp > 0 && wn > 0 ? acc / (wp * wn) : null;
}

/** Weighted median of a list sorted by `s`: the first value whose cumulative weight reaches half. */
export function weightedMedian(sorted: readonly Pair[], m: ArrayLike<number>): number | null {
  let total = 0;
  for (const p of sorted) total += weightOf(p, m);
  if (total <= 0) return null;
  let c = 0;
  for (const p of sorted) {
    c += weightOf(p, m);
    if (c >= total / 2) return p.s;
  }
  return null;
}

/** Weighted share of pairs with similarity strictly above `t`. */
export function shareAbove(pairs: readonly Pair[], t: number, m: ArrayLike<number>): number | null {
  let w = 0, k = 0;
  for (const p of pairs) {
    const x = weightOf(p, m);
    w += x;
    if (p.s > t) k += x;
  }
  return w > 0 ? k / w : null;
}

export function weightedMean(pairs: readonly Pair[], m: ArrayLike<number>): number | null {
  let w = 0, s = 0;
  for (const p of pairs) {
    const x = weightOf(p, m);
    w += x;
    s += x * p.s;
  }
  return w > 0 ? s / w : null;
}

/**
 * The lookalike rate (M3): the share of different-work confirmed pairs nearer than the median same-work pair.
 * The threshold is the median itself, recomputed in every bootstrap draw.
 */
export function lookalikeRate(sameWork: readonly Pair[], differentWork: readonly Pair[], m: ArrayLike<number>): number | null {
  const t = weightedMedian(sameWork, m);
  return t === null ? null : shareAbove(differentWork, t, m);
}

export interface Interval {
  value: number;
  lo: number;
  hi: number;
}

/**
 * Photo-cluster bootstrap for statistics over pairs, whose two boxes may sit in two photos: each draw resamples the
 * set's photos with replacement and weights a pair by how often its photos were drawn (`weightOf`). Point value at
 * unit weights; 95 % percentile interval. Null when the statistic is undefined on the full set.
 */
export function pairBootstrap(photos: number, stat: (m: ArrayLike<number>) => number | null, reps: number = MM1.bootstrap.reps, seed: number = MM1.bootstrap.seed): Interval | null {
  const value = stat(new Float64Array(photos).fill(1));
  if (value === null || !Number.isFinite(value)) return null;
  const rand = rng(seed);
  const draws: number[] = [];
  const m = new Float64Array(photos);
  for (let r = 0; r < reps; r++) {
    m.fill(0);
    for (let k = 0; k < photos; k++) m[Math.floor(rand() * photos)]!++;
    const v = stat(m);
    if (v !== null && Number.isFinite(v)) draws.push(v);
  }
  draws.sort((a, b) => a - b);
  const q = (p: number) => draws[Math.min(draws.length - 1, Math.max(0, Math.round(p * (draws.length - 1))))]!;
  return draws.length ? { value, lo: q(0.025), hi: q(0.975) } : null;
}

export const bySim = (pairs: Pair[]): Pair[] => pairs.sort((x, y) => x.s - y.s);
