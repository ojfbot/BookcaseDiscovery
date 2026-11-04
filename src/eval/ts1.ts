// TS-1 reader error-overlap audit (pre-registered in evals/TS1/report.md): do F-0's readers make the same mistakes?
// Pure: per-box reader outcomes in, pair overlap, label wrong shares and third-reader dissent out, each with a
// photo-cluster bootstrap. The runner is src/eval/ts1-cli.ts. Nothing here touches F-0's decision.
import { tokenize } from "../catalog/normalize.ts";
import type { ReaderName } from "./f0.ts";
import { byImage, quantile, rng } from "./q1.ts";

export const TS1 = {
  reps: 2000,
  seed: 1,
  /** A stratum cell with fewer boxes in its denominator is reported as counts only. */
  minCell: 30,
  /** Q-3's published dark bars (evals/Q3/metrics.json): the 5th percentile of each set's confirmed boxes. */
  darkBar: { "pilot-000": { luma: 57.4, contrast: 39.7 }, yardstick: { luma: 61.8, contrast: 27.2 } },
  /** Recommendation rule: strong needs M2's upper bound at most this, weak its point at most `weakMax`. */
  strongMax: 0.1,
  weakMax: 0.2,
} as const;

export type SetName = "pilot-000" | "yardstick";
export const PAIRS: [ReaderName, ReaderName][] = [
  ["vision", "ppocr"],
  ["vision", "qwen"],
  ["ppocr", "qwen"],
];
export const AGREEING = ["vision+ppocr", "vision+qwen", "ppocr+qwen", "vision+ppocr+qwen"] as const;
export type Agreeing = (typeof AGREEING)[number];
export type Rarity = "shared" | "distinctive";

/** One kept box: what each reader said, the label, its strata and (yardstick) what the annotation says. */
export interface Box {
  id: string;
  /** The bootstrap's cluster: the photo. */
  imageId: string;
  /** Readers asked (a key in the decision's `top`), with their top and confirmed works. */
  top: Partial<Record<ReaderName, string | null>>;
  confirmed: Partial<Record<ReaderName, string | null>>;
  accepted: string | null;
  agreeing: ReaderName[];
  elevation: string;
  dark: boolean;
  side: boolean;
  /** M6, for accepted boxes only. */
  rarity: Rarity | null;
  /** Yardstick: works annotated in the image. Absent on `pilot-000`. */
  truth?: ReadonlySet<string>;
  /** Yardstick, exploratory: `truth` plus every inventory record of the same book (title form and primary surname). */
  truthBook?: ReadonlySet<string>;
  /** Yardstick, exploratory: a wrong label's relation to the annotation. */
  wrongKind?: WrongKind | null;
}

export const readBy = (b: Box, r: ReaderName): boolean => r in b.top;
export const agreeingKey = (rs: readonly ReaderName[]): Agreeing | null => {
  const k = (["vision", "ppocr", "qwen"] as const).filter((r) => rs.includes(r)).join("+");
  return (AGREEING as readonly string[]).includes(k) ? (k as Agreeing) : null;
};

/** E: the reader confirms a work the image does not hold. Needs the yardstick's truth. */
export const wrongConf = (b: Box, r: ReaderName): boolean => {
  const w = b.confirmed[r];
  return !!w && !b.truth!.has(w);
};
/** F: the reader does not confirm an annotated work (abstaining fails). */
export const fails = (b: Box, r: ReaderName): boolean => {
  const w = b.confirmed[r];
  return !(w && b.truth!.has(w));
};

/** M6: shared when more than one work holds the title form, or the title is one token. */
export function rarityOf(titleForm: string | null, worksHoldingIt: number): Rarity | null {
  if (titleForm === null) return null;
  return worksHoldingIt > 1 || tokenize(titleForm).length <= 1 ? "shared" : "distinctive";
}

/** The work's own main title form: the first `T:` entry of a works row's `title_norm`. */
export function ownTitleForm(titleNorm: string): string | null {
  const e = titleNorm.split("|").find((x) => x.startsWith("T:"));
  return e ? e.slice(2) : null;
}

/** A work as the yardstick's book-level check sees it: own title form and primary surname. */
export interface BookKey { title: string | null; surname: string }
export type WrongKind = "same-book-other-record" | "namesake" | "same-author" | "unrelated";
export const WRONG_KINDS: WrongKind[] = ["same-book-other-record", "namesake", "same-author", "unrelated"];

/**
 * Exploratory (after the results, not pre-registered): how a wrong label relates to the image's annotated books.
 * The library's inventory holds some books twice, under two records, so a "wrong" label can be the right book.
 */
export function wrongKindOf(label: BookKey, annotated: readonly BookKey[]): WrongKind {
  const sameTitle = (a: BookKey) => a.title !== null && a.title === label.title;
  if (annotated.some((a) => sameTitle(a) && a.surname === label.surname)) return "same-book-other-record";
  if (annotated.some(sameTitle)) return "namesake";
  if (annotated.some((a) => a.surname !== "" && a.surname === label.surname)) return "same-author";
  return "unrelated";
}

export function isDark(luma: number | null, contrast: number | null, bar: { luma: number; contrast: number }): boolean {
  return (luma !== null && luma < bar.luma) || (contrast !== null && contrast < bar.contrast);
}

// --- 2x2 statistics ------------------------------------------------------------------------------------------

/** a: both wrong, b: A only, c: B only, d: neither. */
export interface Cells { a: number; b: number; c: number; d: number }

export function phi({ a, b, c, d }: Cells): number | null {
  const den = Math.sqrt((a + b) * (c + d) * (a + c) * (b + d));
  return den === 0 ? null : (a * d - b * c) / den;
}

/** Yule's Q, with 0.5 added to every cell when any is 0 (Haldane). */
export function yuleQ(t: Cells): { q: number | null; haldane: boolean } {
  const haldane = t.a === 0 || t.b === 0 || t.c === 0 || t.d === 0;
  const { a, b, c, d } = haldane ? { a: t.a + 0.5, b: t.b + 0.5, c: t.c + 0.5, d: t.d + 0.5 } : t;
  const den = a * d + b * c;
  return { q: den === 0 ? null : (a * d - b * c) / den, haldane };
}

export function lift({ a, b, c, d }: Cells): number | null {
  const n = a + b + c + d;
  if (n === 0) return null;
  const pa = (a + b) / n, pb = (a + c) / n;
  return pa * pb === 0 ? null : a / n / (pa * pb);
}

// --- bootstrap over per-photo tallies -----------------------------------------------------------------------

export interface Interval { value: number; lo: number; hi: number; draws: number }

/**
 * Q-1's `clusterBootstrap` on summed per-photo tallies: the same photo draws (byImage's order, `rng(seed)`), so each
 * statistic equals `clusterBootstrap` of the pooled rows, but every statistic of one tally shares one pass.
 */
export function tallyBootstrap<T extends { imageId: string }, K extends string>(
  rows: T[],
  tally: (r: T) => number[],
  stats: Record<K, (t: number[]) => number | null>,
  reps: number = TS1.reps,
  seed: number = TS1.seed,
): Record<K, Interval | null> {
  const groups = byImage(rows).map((g) => g.map(tally).reduce(add, []));
  const total = groups.reduce(add, []);
  const keys = Object.keys(stats) as K[];
  const draws = Object.fromEntries(keys.map((k) => [k, [] as number[]])) as Record<K, number[]>;
  const rand = rng(seed);
  for (let r = 0; r < reps && groups.length > 0; r++) {
    let sum: number[] = [];
    for (let i = 0; i < groups.length; i++) sum = add(sum, groups[Math.floor(rand() * groups.length)]!);
    for (const k of keys) {
      const v = stats[k](sum);
      if (v !== null && Number.isFinite(v)) draws[k].push(v);
    }
  }
  const out = {} as Record<K, Interval | null>;
  for (const k of keys) {
    const v = stats[k](total);
    const d = draws[k].sort((x, y) => x - y);
    out[k] = v === null || !Number.isFinite(v) || d.length === 0 ? null : { value: v, lo: quantile(d, 0.025), hi: quantile(d, 0.975), draws: d.length };
  }
  return out;
}

function add(s: number[], t: number[]): number[] {
  const out = s.slice();
  for (let i = 0; i < t.length; i++) out[i] = (out[i] ?? 0) + t[i]!;
  return out;
}

const div = (n: number | undefined, d: number | undefined): number | null => (!d ? null : (n ?? 0) / d);

// --- M1: pair error overlap (yardstick) ----------------------------------------------------------------------

export type ErrorKind = "E" | "F";
const errorOf = (k: ErrorKind) => (k === "E" ? wrongConf : fails);

/** Tally: [n, a, b, c, d, sameWrong, agree, agreeWrong]. */
export function pairTally(a: ReaderName, b: ReaderName, k: ErrorKind) {
  const err = errorOf(k);
  return (x: Box): number[] => {
    if (!readBy(x, a) || !readBy(x, b)) return [0, 0, 0, 0, 0, 0, 0, 0];
    const ea = err(x, a), eb = err(x, b);
    const ca = x.confirmed[a], cb = x.confirmed[b];
    const agree = !!ca && ca === cb;
    const agreeWrong = agree && !x.truth!.has(ca!);
    return [1, +(ea && eb), +(ea && !eb), +(!ea && eb), +(!ea && !eb), +agreeWrong, +agree, +agreeWrong];
  };
}

const cellsOf = (t: number[]): Cells => ({ a: t[1] ?? 0, b: t[2] ?? 0, c: t[3] ?? 0, d: t[4] ?? 0 });
export const PAIR_STATS = {
  pA: (t: number[]) => div((t[1] ?? 0) + (t[2] ?? 0), t[0]),
  pB: (t: number[]) => div((t[1] ?? 0) + (t[3] ?? 0), t[0]),
  pBoth: (t: number[]) => div(t[1], t[0]),
  product: (t: number[]) => {
    const pa = div((t[1] ?? 0) + (t[2] ?? 0), t[0]), pb = div((t[1] ?? 0) + (t[3] ?? 0), t[0]);
    return pa === null || pb === null ? null : pa * pb;
  },
  lift: (t: number[]) => lift(cellsOf(t)),
  phi: (t: number[]) => phi(cellsOf(t)),
  yuleQ: (t: number[]) => yuleQ(cellsOf(t)).q,
  pSameWrong: (t: number[]) => div(t[5], t[0]),
  sameOfJoint: (t: number[]) => div(t[5], t[1]),
  agreeWrongShare: (t: number[]) => div(t[7], t[6]),
};

export function pairMeasures(boxes: Box[], a: ReaderName, b: ReaderName, k: ErrorKind) {
  const tally = pairTally(a, b, k);
  const t = boxes.map(tally).reduce(add, []);
  const counts = { n: t[0] ?? 0, ...cellsOf(t), sameWrong: t[5] ?? 0, agree: t[6] ?? 0, agreeWrong: t[7] ?? 0, haldane: yuleQ(cellsOf(t)).haldane };
  if (counts.n < TS1.minCell) return { counts, stats: null };
  return { counts, stats: tallyBootstrap(boxes, tally, PAIR_STATS) };
}

// --- M2 / M3 / M5: shares ------------------------------------------------------------------------------------

/** A share with its interval, or counts only under the cell minimum. */
export function shareOf(boxes: Box[], of: (b: Box) => boolean, hit: (b: Box) => boolean) {
  const tally = (b: Box) => (of(b) ? [1, +hit(b)] : [0, 0]);
  const t = boxes.map(tally).reduce(add, []);
  const n = t[0] ?? 0, k = t[1] ?? 0;
  if (n < TS1.minCell) return { n, k, share: null };
  return { n, k, share: tallyBootstrap(boxes, tally, { share: (x: number[]) => div(x[1], x[0]) }).share };
}

export const labelWrong = (b: Box): boolean => !!b.accepted && !b.truth!.has(b.accepted);
export const isLabel = (set: Agreeing | null) => (b: Box): boolean => !!b.accepted && (set === null || agreeingKey(b.agreeing) === set);

export type ThirdOutcome = "dissents" | "contradicts" | "supports" | "read-nothing" | "not-read";
export const THIRD_OUTCOMES: ThirdOutcome[] = ["dissents", "contradicts", "supports", "read-nothing", "not-read"];

/** M5: the reader outside a two-reader agreement, against the label's work. Null for any other box. */
export function thirdOf(b: Box): { reader: ReaderName; outcome: ThirdOutcome } | null {
  if (!b.accepted || b.agreeing.length !== 2) return null;
  const reader = (["vision", "ppocr", "qwen"] as const).find((r) => !b.agreeing.includes(r))!;
  if (!readBy(b, reader)) return { reader, outcome: "not-read" };
  const c = b.confirmed[reader], t = b.top[reader];
  if (c && c !== b.accepted) return { reader, outcome: "dissents" };
  if (!t) return { reader, outcome: "read-nothing" };
  return { reader, outcome: t === b.accepted ? "supports" : "contradicts" };
}
export const thirdRead = (b: Box): boolean => {
  const t = thirdOf(b);
  return !!t && t.outcome !== "not-read";
};

// --- strata ---------------------------------------------------------------------------------------------------

export const STRATA: Record<string, (b: Box) => string> = {
  elevation: (b) => b.elevation,
  "dark or low contrast": (b) => (b.dark ? "dark/low" : "not"),
  case: (b) => (b.side ? "side" : "main"),
};

/** Each stratum value's boxes, in a stable order. */
export function strata(boxes: Box[]): { stratum: string; value: string; boxes: Box[] }[] {
  const out: { stratum: string; value: string; boxes: Box[] }[] = [];
  for (const [stratum, f] of Object.entries(STRATA)) {
    const m = new Map<string, Box[]>();
    for (const b of boxes) m.set(f(b), [...(m.get(f(b)) ?? []), b]);
    for (const value of [...m.keys()].sort()) out.push({ stratum, value, boxes: m.get(value)! });
  }
  return out;
}

// --- recommendation -------------------------------------------------------------------------------------------

export type Tier = "strong" | "weak" | "exclude" | "unmeasured";

/**
 * The pre-registered rule for one agreeing set: M2's wrong share (yardstick), M1's E lift lower bound for its pair
 * (null for the three-reader set or an unmeasured pair) and `pilot-000` dissent's upper bound (null when unmeasurable).
 */
export function tierOf(wrong: Interval | null, liftLo: number | null, dissentHi: number | null): Tier {
  if (!wrong) return "unmeasured";
  if (wrong.value > TS1.weakMax) return "exclude";
  const strong = wrong.hi <= TS1.strongMax && (liftLo === null || liftLo <= 1) && (dissentHi === null || dissentHi <= TS1.strongMax);
  return strong ? "strong" : "weak";
}

/** Two intervals overlap: not separable at this sample size. */
export const overlaps = (x: Interval | null, y: Interval | null): boolean => !!x && !!y && x.lo <= y.hi && y.lo <= x.hi;
