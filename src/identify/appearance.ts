// MM-2 · appearance in shadow mode: what two appearance arms would say beside one F-0 decision, without changing it
// (evals/MM2/prereg.md). Pure: vectors, scores and the cached decision come in, a shadow result goes out.
//
// - The gallery arm: a self-gallery of confirmed copies (one entry per copy, INV-4). A match fuses visual nearness
//   with text agreement, the readers' evidence for the entry's work; nearness alone never qualifies.
// - The gallery-free arm: SigLIP 2's image-to-title similarity over the text path's own candidates, so it can only
//   re-order works the readers already retrieved.
//
// Pixels never confirm alone (owner, 2026-11-04). In the candidate simulation a proposal is only something a reader
// may test with F-0's full bar; each reader model still casts at most one vote (INV-6) and appearance casts none.
// Nothing here reads taste or the owner's reading context (INV-13). The runner is `src/eval/mm2-cli.ts`.

import { vote, type ReaderVotes, type UnknownReason } from "./decision.ts";
import { READERS, type ReaderName } from "./readers.ts";

// --- the appearance switch -------------------------------------------------------------------------------

/**
 * How identify may use appearance: `off` (the default) records nothing and reads nothing; `shadow` (MM-2) logs what
 * appearance would say beside the text decision; `candidate` lets it propose works for the readers to test;
 * `vote` lets it add evidence to a text decision. In no mode do pixels confirm alone. MM-1 re-exports it; MM-2 runs in `shadow`.
 */
export const APPEARANCE_MODES = ["off", "shadow", "candidate", "vote"] as const;
export type AppearanceMode = (typeof APPEARANCE_MODES)[number];
export const APPEARANCE_DEFAULT: AppearanceMode = "off";

export const APPEARANCE = {
  /** The visual model of both arms (MM-1: SigLIP 2's same-work AUC 0.977 against DINOv2's 0.813). */
  model: "siglip2",
  gallery: {
    /** F-1 splits a gallery entry may come from: never `val`, `held-out` or an evaluation-only set (OC35). */
    splits: ["train"],
    /** Nearest entries a query looks at for a proposal. */
    depth: 20,
  },
  visual: {
    /** τv is the lower of this quantile of two kinds of same-work pairs (across split groups; within one photo). */
    quantile: 0.1,
    /** A kind with fewer pairs than this is not used for τv. */
    minPairs: 10,
  },
  /** τt: the smallest grid value no train visual lookalike reaches; F-0's title bar when none qualifies. */
  text: { grid: [0.5, 0.6, 0.7, 0.8], fallback: 0.8 },
  free: {
    /** Each reader's C-3 candidates that form the pool. */
    poolDepth: 10,
    minPool: 2,
    /** δ: the smallest margin at which the proposal agrees with F-0's accept on train boxes at least `agreement`. */
    grid: [0, 0.01, 0.02, 0.03, 0.05, 0.08],
    fallback: 0.08,
    agreement: 0.95,
    maxTokens: 64,
    /** The primary text template; `title+author` is reported beside it without a keep rule. */
    templates: ["title", "title+author"],
  },
} as const;

export type Template = (typeof APPEARANCE.free.templates)[number];

/**
 * MM-2 runs only in `shadow`. `off` (the default) means the runner does nothing; `candidate` and `vote` let
 * appearance reach a decision, which is MM-3's and the owner's to rule on, so they are refused here.
 */
export function shadowOnly(mode: AppearanceMode): boolean {
  if (mode === "candidate" || mode === "vote") throw new Error(`appearance: \`${mode}\` is owner gated (MM-3); MM-2 runs in shadow only`);
  return mode === "shadow";
}

/** The text a work's title becomes for SigLIP 2's text tower: lowercased (it was trained so), whitespace collapsed. */
export function titleText(template: Template, title: string, authors: readonly string[]): string {
  const t = template === "title" ? title : `${title} ${authors[0] ?? ""}`;
  return t.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

export const dot = (a: Float32Array, b: Float32Array): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
};

// --- the gallery arm -------------------------------------------------------------------------------------------

/** One confirmed copy: its vector, its split group and its work. One per physical copy, never merged (INV-4). */
export interface GalleryEntry {
  id: string;
  group: string;
  workId: string;
  vec: Float32Array;
}

export interface Near {
  entry: number;
  cos: number;
}

/** Every entry outside the query's split group, nearest first (ties by entry order). */
export function nearestEntries(vec: Float32Array, group: string, gallery: readonly GalleryEntry[]): Near[] {
  const out: Near[] = [];
  gallery.forEach((e, i) => {
    if (e.group !== group) out.push({ entry: i, cos: dot(vec, e.vec) });
  });
  return out.sort((a, b) => b.cos - a.cos || a.entry - b.entry);
}

export interface GalleryMatch {
  workId: string;
  cos: number;
  text: number;
  fused: number;
}

export interface GalleryResult {
  /** The nearest entry outside the query's group, at any distance (logged; never evidence on its own). */
  nearest: { workId: string; cos: number } | null;
  /** Works with an entry within τv among the `depth` nearest. */
  near: number;
  /** Near works whose text agreement fell short: nearness alone, never proposed. */
  nearOnly: string[];
  matches: GalleryMatch[];
  proposal: string | null;
}

/**
 * The gallery arm on one query: of the `depth` nearest entries, those within τv; each work's best entry fused with
 * the query's text agreement for that work (`textOf`, 0..1). A work is proposed only when both sides pass.
 */
export function galleryArm(
  near: readonly Near[],
  gallery: readonly GalleryEntry[],
  textOf: (workId: string) => number,
  tauV: number,
  tauT: number,
  depth: number = APPEARANCE.gallery.depth,
): GalleryResult {
  const top = near[0];
  const best = new Map<string, number>();
  for (const n of near.slice(0, depth)) {
    if (n.cos < tauV) break;
    const w = gallery[n.entry]!.workId;
    if (!best.has(w)) best.set(w, n.cos);
  }
  const matches: GalleryMatch[] = [];
  const nearOnly: string[] = [];
  for (const [workId, cos] of best) {
    const text = textOf(workId);
    if (text >= tauT) matches.push({ workId, cos, text, fused: cos * text });
    else nearOnly.push(workId);
  }
  matches.sort((a, b) => b.fused - a.fused || b.cos - a.cos || (a.workId < b.workId ? -1 : 1));
  return {
    nearest: top ? { workId: gallery[top.entry]!.workId, cos: top.cos } : null,
    near: best.size,
    nearOnly: nearOnly.sort(),
    matches,
    proposal: matches[0]?.workId ?? null,
  };
}

// --- the gallery-free arm --------------------------------------------------------------------------------------

export interface FreeResult {
  pool: number;
  top: { workId: string; cos: number } | null;
  /** The top's cosine less the runner-up's; null with fewer than two pool works. */
  margin: number | null;
  proposal: string | null;
}

/** The gallery-free arm: the pool's works by image-to-title cosine; the top is proposed when it clears `delta`. */
export function freeArm(vec: Float32Array, pool: readonly { workId: string; vec: Float32Array }[], delta: number): FreeResult {
  const scored = pool.map((p) => ({ workId: p.workId, cos: dot(vec, p.vec) })).sort((a, b) => b.cos - a.cos || (a.workId < b.workId ? -1 : 1));
  const top = scored[0] ?? null;
  const margin = scored.length >= APPEARANCE.free.minPool ? scored[0]!.cos - scored[1]!.cos : null;
  return { pool: scored.length, top, margin, proposal: margin !== null && margin >= delta ? top!.workId : null };
}

// --- the candidate simulation ----------------------------------------------------------------------------------

export interface Simulated {
  acceptedId: string | null;
  agreeing: ReaderName[];
  reason: UnknownReason | null;
  /** Readers that confirmed the proposal (each had confirmed no work of its own). */
  takers: ReaderName[];
}

/**
 * What `candidate` would decide: each reader that read text but confirms no work tests the proposal with F-0's full
 * bar (`passes`); a reader that confirms its own top keeps it. F-0's vote then runs unchanged, so an accept still
 * needs two reader models naming one work, and a proposal no reader confirms goes nowhere.
 */
export function simulateCandidate(base: ReaderVotes, proposal: string | null, passes: (reader: ReaderName, workId: string) => boolean): Simulated {
  const confirmed = { ...base.confirmed };
  const takers: ReaderName[] = [];
  if (proposal) {
    for (const r of READERS) {
      if (!base.readText[r] || confirmed[r]) continue;
      if (passes(r, proposal)) (confirmed[r] = proposal), takers.push(r);
    }
  }
  const v = vote({ readText: base.readText, top: base.top, confirmed });
  return { acceptedId: v.acceptedId, agreeing: v.agreeing, reason: v.reason, takers };
}

// --- thresholds, set on train only -----------------------------------------------------------------------------

/** Nearest-rank quantile of an unsorted list; null when empty. */
export function quantile(xs: readonly number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]!;
}

export interface VisualThreshold {
  tau: number;
  acrossGroups: number | null;
  withinPhoto: number | null;
  pairs: { acrossGroups: number; withinPhoto: number };
  used: "acrossGroups" | "withinPhoto" | "lower";
}

/**
 * τv: the lower of the `quantile` of same-work cosines across split groups (perhaps one copy shot twice, which MM-1
 * found raises the threshold) and within one photo (two boxes, so two copies). Lower lets more lookalikes reach the
 * text side, the conservative way for the stress test.
 */
export function visualThreshold(acrossGroups: readonly number[], withinPhoto: readonly number[], q: number = APPEARANCE.visual.quantile, min: number = APPEARANCE.visual.minPairs): VisualThreshold {
  const a = acrossGroups.length >= min ? quantile(acrossGroups, q) : null;
  const w = withinPhoto.length >= min ? quantile(withinPhoto, q) : null;
  if (a === null && w === null) throw new Error("appearance: too few same-work pairs to set the visual threshold");
  const pairs = { acrossGroups: acrossGroups.length, withinPhoto: withinPhoto.length };
  if (a === null) return { tau: w!, acrossGroups: a, withinPhoto: w, pairs, used: "withinPhoto" };
  if (w === null) return { tau: a, acrossGroups: a, withinPhoto: w, pairs, used: "acrossGroups" };
  return { tau: Math.min(a, w), acrossGroups: a, withinPhoto: w, pairs, used: "lower" };
}

/** τt: the smallest grid value that every train lookalike's text agreement stays under. */
export function textThreshold(lookalikeTexts: readonly number[]): { tau: number; calibrated: boolean } {
  const max = lookalikeTexts.reduce((m, x) => Math.max(m, x), -Infinity);
  const g = APPEARANCE.text.grid.find((t) => max < t);
  return g === undefined ? { tau: APPEARANCE.text.fallback, calibrated: false } : { tau: g, calibrated: true };
}

/** δ: the smallest margin at which proposals agree with F-0's accept at least `agreement` of the time. */
export function marginThreshold(rows: readonly { margin: number | null; agrees: boolean }[]): { delta: number; calibrated: boolean; agreement: number | null; proposals: number } {
  for (const d of APPEARANCE.free.grid) {
    const made = rows.filter((r) => r.margin !== null && r.margin >= d);
    const share = made.length ? made.filter((r) => r.agrees).length / made.length : null;
    if (share !== null && share >= APPEARANCE.free.agreement) return { delta: d, calibrated: true, agreement: share, proposals: made.length };
  }
  const d = APPEARANCE.free.fallback;
  const made = rows.filter((r) => r.margin !== null && r.margin >= d);
  return { delta: d, calibrated: false, agreement: made.length ? made.filter((r) => r.agrees).length / made.length : null, proposals: made.length };
}
