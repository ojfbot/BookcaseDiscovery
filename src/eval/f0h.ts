// F-0h neighbour context: a spine beside a confirmed book (an anchor) is probably by the same author, so the anchor
// proposes its author's and its series' other works, and the spine's own reader text, misread by a letter or two, may
// pick one of them. Context proposes; the spine's own text confirms. Context stands in for the second reader only,
// never for title evidence, and never reads the profile (INV-13: it is what stands on this shelf in this photo, not
// taste). Spines with no usable text get a ranked hypothesis, never a confirmation. Pure functions over cached
// detections, decisions, reader tokens and catalog facts; the runner is f0h-cli.ts. Only aggregates leave
// $BOOKCASE_DATA (evals/F0h/). Constants are pre-registered in evals/F0h/report.md and never tuned.
import { createHash } from "node:crypto";
import { sameAuthor, sameWork, type WorkRef } from "../catalog/lookalike.ts";
import { editDistance, normalize, skeleton, STOPWORDS, tokenize } from "../catalog/normalize.ts";
import type { CounterKind } from "../catalog/rarity.ts";
import { ACCEPT, type Detection, type ReaderName } from "./f0.ts";
import { boxRows, median } from "./f0e.ts";
import { LABEL } from "./f0f.ts";

export { sameAuthor, sameWork, type WorkRef };

export const CONTEXT = {
  /** Rows: a box joins the open row whose last box overlaps it vertically by this share of the shorter height ... */
  rowOverlap: 0.5,
  /** ... and leaves a gap of at most this many median spine widths. */
  rowGapWidths: 3,
  /** An anchor stands at most this many places from the target in its row. */
  anchorReach: 2,
  /** A bracket holds at most this many unconfirmed spines between its two same-author anchors. */
  bracketMaxGap: 5,
  /** Proposals per reader (K); a larger set keeps its best by the reader's text score. */
  maxProposals: 60,
  /** Edit distance allowed per title token: up to `editShort` below `longFrom` letters, `editLong` from there. */
  editShort: 1,
  editLong: 2,
  longFrom: 7,
  /** A skeleton match (rn/m, vv/w, cl/d) costs one edit. */
  skeletonCost: 1,
  /** A title token is distinctive when fewer than this share of the catalog's works carry it (C-7's sidecar) ... */
  distinctiveShare: 0.001,
  /** ... it is not a stopword, and it has at least this many letters. */
  distinctiveMinLetters: 3,
  /** Matched characters (length minus cost) cover at least this share of the title's non-stopword characters. */
  titleCover: 0.8,
  /** One distinctive token alone is enough only with this many letters at cost 0..`oneWordMaxCost`. */
  oneWordMinLetters: 6,
  oneWordMaxCost: 1,
  /** Retrieval's own scoring of the proposal on the reading: F-0's title bar drops to this, only through the token test. */
  minTitleEvidence: 0.6,
  /** ... and F-0's coverage bar stays. */
  minCoverage: ACCEPT.minCoverage,
  /** The winner's cost must undercut every passing proposal of a different book by at least this. */
  margin: 2,
  /** The reader's own top retrieval candidate, another book that passes F-0's bar, may lead the winner by at most this. */
  openCatalogLead: 0.05,
  /** Usable text: some reader read a non-stopword token of at least this many letters. */
  usableMinLetters: 3,
  /** A row is ordered by author when this share of its consecutive confirmed pairs (at least `orderedMinPairs`) is in order. */
  orderedShare: 0.8,
  orderedMinPairs: 3,
  /** Hypotheses: works whose titles sort between an ordered bracket's two titles weigh this much; the top few are kept. */
  bracketWeight: 2,
  hypothesisTop: 5,
  /** A shelf strip labels the row whose bottoms are at most this many median spine heights above its top. */
  stripBelowHeights: 1,
  /** A gap between consecutive boxes of at least this many median widths is a detection-gap flag inside a bracket. */
  gapWidths: 0.5,
  /** Neighbour shuffle: seeds and the author-works buckets anchors are drawn within (upper bounds; the last is open). */
  shuffleSeeds: 20,
  seed: 20261103,
  worksBuckets: [1, 5, 20, 60],
  /** pilot-000 photos sorted by the sha256 of their id: the first this many are half A (order statistics), the rest half B. */
  halfA: 15,
} as const;

/** The keep rule's fixed fractions (evals/F0h/report.md). */
export const KEEP = {
  shuffleMean: 0.1,
  shuffleP95: 0.15,
  loroWrong: 0.05,
  stressWrong: 0.05,
} as const;

// --- halves -------------------------------------------------------------------------------------------------

/** Photo ids sorted by the sha256 of the id: the first `CONTEXT.halfA` are half A, the rest half B. */
export function halves(ids: readonly string[], halfA: number = CONTEXT.halfA): { a: Set<string>; b: Set<string> } {
  const h = (s: string) => createHash("sha256").update(s).digest("hex");
  const sorted = [...ids].sort((x, y) => (h(x) < h(y) ? -1 : h(x) > h(y) ? 1 : 0));
  return { a: new Set(sorted.slice(0, halfA)), b: new Set(sorted.slice(halfA)) };
}

// --- rows ---------------------------------------------------------------------------------------------------

export interface Row {
  band: number;
  /** Box indices in order along the shelf. */
  members: number[];
  /** Gap between consecutive members, in median spine widths (members.length - 1 entries). */
  gaps: number[];
  /** The row's bottom (median of its boxes' bottoms), x extent and median box height, in image pixels. */
  bottom: number;
  left: number;
  right: number;
  height: number;
}

/**
 * Rows of upright book boxes (not nested in a larger box) in each shelf band, in order along x. A box joins the
 * open row whose last box overlaps it vertically by `rowOverlap` of the shorter height and leaves a gap of at most
 * `rowGapWidths` median widths (the most overlapping one); otherwise it opens a new row. Lying books, face-outs and
 * boxes outside every band are in no row.
 */
export function buildRows(det: Detection, isBook: (i: number) => boolean = () => true): Row[] {
  const rows = boxRows(det);
  const mw = det.gaps.medianWidth || median(rows.map((r) => r.g.short)) || 1;
  const byBand = new Map<number, number[]>();
  rows.forEach((r, i) => {
    if (r.band >= 0 && r.upright && !r.inside && isBook(i)) byBand.set(r.band, [...(byBand.get(r.band) ?? []), i]);
  });
  const out: Row[] = [];
  for (const [band, idx] of [...byBand].sort((a, b) => a[0] - b[0])) {
    idx.sort((a, b) => rows[a]!.g.cx - rows[b]!.g.cx);
    const open: { members: number[]; gaps: number[] }[] = [];
    for (const i of idx) {
      const g = rows[i]!.g;
      let best: { k: number; ov: number; gap: number } | null = null;
      open.forEach((o, k) => {
        const last = rows[o.members.at(-1)!]!.g;
        const ov = Math.max(0, Math.min(last.bottom, g.bottom) - Math.max(last.top, g.top));
        const shorter = Math.min(last.bottom - last.top, g.bottom - g.top);
        const gap = Math.max(0, g.cx - last.cx - (last.short + g.short) / 2) / mw;
        if (ov < CONTEXT.rowOverlap * shorter || gap > CONTEXT.rowGapWidths) return;
        if (!best || ov > best.ov) best = { k, ov, gap };
      });
      if (best) {
        const b: { k: number; ov: number; gap: number } = best;
        open[b.k]!.members.push(i);
        open[b.k]!.gaps.push(Math.round(b.gap * 100) / 100);
      } else open.push({ members: [i], gaps: [] });
    }
    for (const o of open) {
      const gs = o.members.map((i) => rows[i]!.g);
      out.push({
        band,
        members: o.members,
        gaps: o.gaps,
        bottom: median(gs.map((g) => g.bottom)),
        left: Math.min(...gs.map((g) => g.left)),
        right: Math.max(...gs.map((g) => g.right)),
        height: median(gs.map((g) => g.bottom - g.top)),
      });
    }
  }
  return out;
}

// --- anchors and brackets -----------------------------------------------------------------------------------

/** Where a target's context comes from: one anchor (P1 author, P2 series), or a bracket of two same-author anchors. */
export interface Context {
  /** Row positions of the anchors within reach. */
  anchors: number[];
  /** Brackets around the target: positions of L and R. */
  brackets: [number, number][];
}

/**
 * Context for each unconfirmed position of a row. `confirmed(p)` is the work at position p when it may anchor
 * (F-0's `readers-agree`, or a wider set in a reported arm), null otherwise; `unconfirmed(p)` says whether p is a
 * target candidate (unknown, not copy-confirmed). Only targets with an anchor or a bracket are returned.
 */
export function contexts(n: number, confirmed: (p: number) => WorkRef | null, unconfirmed: (p: number) => boolean): Map<number, Context> {
  const out = new Map<number, Context>();
  for (let p = 0; p < n; p++) {
    if (!unconfirmed(p)) continue;
    const anchors: number[] = [];
    for (let d = 1; d <= CONTEXT.anchorReach; d++) for (const q of [p - d, p + d]) if (q >= 0 && q < n && confirmed(q)) anchors.push(q);
    const brackets: [number, number][] = [];
    // The nearest confirmed spine on each side, with only unconfirmed spines between it and the target.
    let l = p - 1;
    while (l >= 0 && !confirmed(l) && unconfirmed(l)) l--;
    let r = p + 1;
    while (r < n && !confirmed(r) && unconfirmed(r)) r++;
    if (l >= 0 && r < n && confirmed(l) && confirmed(r) && r - l - 1 <= CONTEXT.bracketMaxGap && sameAuthor(confirmed(l)!, confirmed(r)!)) brackets.push([l, r]);
    if (anchors.length || brackets.length) out.set(p, { anchors: anchors.sort((a, b) => Math.abs(a - p) - Math.abs(b - p) || a - b), brackets });
  }
  return out;
}

// --- the title test ------------------------------------------------------------------------------------------

/** A reader's tokens as matching units: each token, and each join of two adjacent tokens (a split word). */
export function readUnits(tokens: readonly string[]): { text: string; covers: number[] }[] {
  const units = tokens.map((t, i) => ({ text: t, covers: [i] }));
  for (let i = 0; i + 1 < tokens.length; i++) units.push({ text: tokens[i]! + tokens[i + 1]!, covers: [i, i + 1] });
  return units;
}

/** The cost of matching title token `t` with read unit `u`, or null when they do not match. */
export function tokenCost(t: string, u: string): number | null {
  if (t === u) return 0;
  if (skeleton(t) === skeleton(u)) return CONTEXT.skeletonCost;
  const max = t.length >= CONTEXT.longFrom ? CONTEXT.editLong : CONTEXT.editShort;
  const d = editDistance(u, t, max);
  return d <= max ? d : null;
}

export interface TitleFit {
  pass: boolean;
  /** Matched costs plus the length of every unmatched non-stopword title token. */
  cost: number;
  /** Matched characters (length minus cost) over the title's non-stopword characters. */
  cover: number;
  /** Distinctive title tokens, and how many matched. */
  distinctive: number;
  distinctiveMatched: number;
  /** The first rule that failed. */
  failed: "token" | "cover" | "one-word" | null;
}

const content = (t: string) => !STOPWORDS.has(t);

/**
 * Does one reading's tokens explain a title form? Every distinctive title token must match (exact, skeleton, or
 * within the edit bound), matched characters cover `titleCover` of the title, and either two distinctive tokens
 * match or one long one does at a small cost. Read units are used once; title tokens are matched longest first.
 */
export function titleFit(titleTokens: readonly string[], readTokens: readonly string[], distinctive: (t: string) => boolean): TitleFit {
  const units = readUnits(readTokens);
  const used = new Set<number>();
  const words = titleTokens.filter(content);
  const order = words.map((t, i) => ({ t, i })).sort((a, b) => b.t.length - a.t.length || a.i - b.i);
  const costOf = new Map<number, number>();
  for (const { t, i } of order) {
    let best: { cost: number; u: number } | null = null;
    units.forEach((u, k) => {
      if (u.covers.some((c) => used.has(c))) return;
      const c = tokenCost(t, u.text);
      if (c !== null && (!best || c < best.cost)) best = { cost: c, u: k };
    });
    if (best) {
      const b: { cost: number; u: number } = best;
      costOf.set(i, b.cost);
      units[b.u]!.covers.forEach((c) => used.add(c));
    }
  }
  const total = words.reduce((s, t) => s + t.length, 0) || 1;
  const matchedChars = words.reduce((s, t, i) => s + (costOf.has(i) ? Math.max(0, t.length - costOf.get(i)!) : 0), 0);
  const cost = words.reduce((s, t, i) => s + (costOf.has(i) ? costOf.get(i)! : t.length), 0);
  const dist = words.map((t, i) => ({ t, i })).filter(({ t }) => t.length >= CONTEXT.distinctiveMinLetters && distinctive(t));
  const dm = dist.filter(({ i }) => costOf.has(i));
  const cover = Math.round((matchedChars / total) * 1000) / 1000;
  let failed: TitleFit["failed"] = null;
  if (dist.length === 0 || dm.length < dist.length) failed = "token";
  else if (cover < CONTEXT.titleCover) failed = "cover";
  else if (!(dm.length >= 2 || dm.some(({ t, i }) => t.length >= CONTEXT.oneWordMinLetters && costOf.get(i)! <= CONTEXT.oneWordMaxCost))) failed = "one-word";
  return { pass: failed === null, cost, cover, distinctive: dist.length, distinctiveMatched: dm.length, failed };
}

/** Normalised tokens of a text (a reader variant or a title form). */
export const tokensOf = (s: string): string[] => tokenize(normalize(s));

/** Usable text: some reading holds a non-stopword token of at least `usableMinLetters` letters. */
export function usableText(variants: readonly string[]): boolean {
  return variants.some((v) => tokensOf(v).some((t) => content(t) && (t.match(/\p{L}/gu) ?? []).length >= CONTEXT.usableMinLetters));
}

// --- one reader's trial ---------------------------------------------------------------------------------------

/** One proposal scored on one reader's text: the best of its title forms and variants, and retrieval's own scoring. */
export interface ProposalFit {
  work: WorkRef;
  fit: TitleFit;
  /** `scoreWorks` on the reader's variants: score, title evidence and query coverage. */
  score: number;
  titleEvidence: number;
  coverage: number;
}

export type TrialWhy = "no-proposal-passes" | "bar" | "margin" | "open-catalog-winner" | `counter:${CounterKind}`;

export interface ReaderTrial {
  reader: ReaderName;
  workId: string | null;
  why: TrialWhy | null;
  /** The winner's cost, and the runner-up's (a passing proposal of a different book), when there is one. */
  cost?: number;
  runnerCost?: number | null;
}

/** What a reader's trial needs beyond the fits: one-book test, its own top candidate, and C-7's counter-evidence. */
export interface TrialSide {
  sameBook: (a: WorkRef, b: WorkRef) => boolean;
  /** The reader's top retrieval candidate (unchanged retrieval) and whether it passes F-0's bar. */
  openTop: (WorkRef & { score: number; passes: boolean }) | null;
  /** C-7's counter-evidence on the winner, all kinds (null: none fires). */
  counter: (w: ProposalFit) => CounterKind | null;
}

/**
 * One reader against its proposals. The passing proposals (title test and the lowered bar) are ranked by cost; the
 * cheapest wins only if every passing proposal of a different book costs at least `margin` more, the reader's own
 * top candidate (another book passing F-0's bar) does not lead it by more than `openCatalogLead`, and no C-7
 * counter-evidence fires on it.
 */
export function readerTrial(reader: ReaderName, fits: readonly ProposalFit[], side: TrialSide): ReaderTrial {
  const titled = fits.filter((f) => f.fit.pass);
  if (titled.length === 0) return { reader, workId: null, why: "no-proposal-passes" };
  const passing = titled.filter((f) => f.titleEvidence >= CONTEXT.minTitleEvidence && f.coverage >= CONTEXT.minCoverage);
  if (passing.length === 0) return { reader, workId: null, why: "bar" };
  const ranked = [...passing].sort((a, b) => a.fit.cost - b.fit.cost || b.score - a.score || (a.work.workId < b.work.workId ? -1 : 1));
  const win = ranked[0]!;
  const runner = ranked.slice(1).find((f) => !side.sameBook(win.work, f.work)) ?? null;
  const base = { reader, cost: win.fit.cost, runnerCost: runner?.fit.cost ?? null };
  if (runner && runner.fit.cost < win.fit.cost + CONTEXT.margin) return { ...base, workId: null, why: "margin" };
  const top = side.openTop;
  if (top && top.passes && !side.sameBook(win.work, top) && top.score > win.score + CONTEXT.openCatalogLead) return { ...base, workId: null, why: "open-catalog-winner" };
  const k = side.counter(win);
  if (k) return { ...base, workId: null, why: `counter:${k}` };
  return { ...base, workId: win.work.workId, why: null };
}

// --- the spine's decision -------------------------------------------------------------------------------------

export type ContextWhy = TrialWhy | "no-reader-text" | "conflicting-reader" | "readers-disagree";

export interface ContextDecision {
  id: string;
  basis: "confirmed-by-context" | null;
  workId: string | null;
  readers: ReaderName[];
  why: ContextWhy | null;
  trials: ReaderTrial[];
}

/**
 * The spine's outcome from its readers' trials. Readers that pass must name one work; no reader may confirm a
 * different work under F-0's bar (`confirmedBy`: each reader's base confirmation). One passing reader is enough:
 * context stands in for the second.
 */
export function decideContext(id: string, trials: readonly ReaderTrial[], confirmedBy: Partial<Record<ReaderName, WorkRef | null>>, same: (a: WorkRef, b: WorkRef) => boolean, workOf: (workId: string) => WorkRef): ContextDecision {
  const ok = trials.filter((t) => t.workId);
  if (trials.length === 0) return { id, basis: null, workId: null, readers: [], why: "no-reader-text", trials: [] };
  if (ok.length === 0) {
    // The reason closest to an accept: the latest rule reached by any reader.
    const rank = (w: ContextWhy | null) => (w === null ? 9 : w.startsWith("counter") ? 4 : ["no-proposal-passes", "bar", "margin", "open-catalog-winner"].indexOf(w));
    const why = [...trials].sort((a, b) => rank(b.why) - rank(a.why))[0]!.why;
    return { id, basis: null, workId: null, readers: [], why, trials: [...trials] };
  }
  const w = workOf(ok[0]!.workId!);
  if (ok.some((t) => !same(workOf(t.workId!), w))) return { id, basis: null, workId: null, readers: [], why: "readers-disagree", trials: [...trials] };
  if (Object.values(confirmedBy).some((c) => c && !same(c, w))) return { id, basis: null, workId: null, readers: [], why: "conflicting-reader", trials: [...trials] };
  return { id, basis: "confirmed-by-context", workId: w.workId, readers: ok.map((t) => t.reader), why: null, trials: [...trials] };
}

// --- order statistics ------------------------------------------------------------------------------------------

/** A sort key for an author: the primary author's surname, normalised. */
export const surnameKey = (w: WorkRef): string => tokensOf(w.authors[0] ?? "").at(-1) ?? "";

/** A sort key for a title: normalised, a leading article dropped. */
export function titleKey(title: string): string {
  const t = tokensOf(title);
  return (["the", "a", "an"].includes(t[0] ?? "") ? t.slice(1) : t).join(" ");
}

/**
 * Consecutive confirmed pairs of a row in shelf order (keys of the confirmed spines, left to right; pairs with equal
 * keys skipped): how many there are and how many are in non-decreasing order.
 */
export function orderPairs(keys: readonly string[]): { pairs: number; inOrder: number } {
  let pairs = 0;
  let inOrder = 0;
  for (let i = 0; i + 1 < keys.length; i++) {
    if (keys[i] === keys[i + 1]) continue;
    pairs++;
    if (keys[i]! < keys[i + 1]!) inOrder++;
  }
  return { pairs, inOrder };
}

export function ordered(keys: readonly string[]): boolean {
  const o = orderPairs(keys);
  return o.pairs >= CONTEXT.orderedMinPairs && o.inOrder >= CONTEXT.orderedShare * o.pairs;
}

/**
 * Misfile candidates in a row's confirmed keys: a spine out of order with both neighbours while the neighbours are
 * in order with each other (indices into `keys`).
 */
export function misfiles(keys: readonly string[]): number[] {
  const out: number[] = [];
  for (let i = 1; i + 1 < keys.length; i++) {
    const [a, b, c] = [keys[i - 1]!, keys[i]!, keys[i + 1]!];
    if (a <= c && (b < a || b > c)) out.push(i);
  }
  return out;
}

// --- shelf strips --------------------------------------------------------------------------------------------

/** What a shelf strip's text says: a store section, and whether it states an ordering (alphabetical by author). */
export function stripCue(texts: readonly string[]): { strip: boolean; ordering: boolean } {
  const section = texts.some((t) => LABEL.strip[0]!.test(t));
  const ordering = texts.some((t) => LABEL.strip[1]!.test(t));
  return { strip: section || ordering, ordering };
}

/** Does a strip (its axis-aligned extent) label a row: its top just below the row's bottom, overlapping in x? */
export function stripLabels(strip: { top: number; left: number; right: number }, row: Pick<Row, "bottom" | "left" | "right" | "height">): boolean {
  const below = strip.top - row.bottom;
  return below >= -0.25 * row.height && below <= CONTEXT.stripBelowHeights * row.height && Math.min(strip.right, row.right) > Math.max(strip.left, row.left);
}

// --- hypotheses --------------------------------------------------------------------------------------------------

export interface HypothesisWork {
  workId: string;
  title: string;
  editions: number;
}

/**
 * Works ranked for a spine with no usable text: edition count (a shelf copy is a work in proportion to how often it
 * was published) times a position weight. In an ordered bracket with its two titles in title order, works whose
 * titles sort between them weigh `bracketWeight`. Shares of the kept top few, best first.
 */
export function rankHypothesis(works: readonly HypothesisWork[], bracket?: { left: string; right: string; ordered: boolean }): (HypothesisWork & { share: number })[] {
  const between = bracket && bracket.ordered && titleKey(bracket.left) <= titleKey(bracket.right);
  const weighted = works.map((w) => {
    const k = titleKey(w.title);
    const inside = between && k >= titleKey(bracket!.left) && k <= titleKey(bracket!.right);
    return { ...w, weight: Math.max(1, w.editions) * (inside ? CONTEXT.bracketWeight : 1) };
  });
  const total = weighted.reduce((s, w) => s + w.weight, 0) || 1;
  return weighted
    .sort((a, b) => b.weight - a.weight || (a.workId < b.workId ? -1 : 1))
    .slice(0, CONTEXT.hypothesisTop)
    .map(({ weight, ...w }) => ({ ...w, share: Math.round((weight / total) * 1000) / 1000 }));
}

// --- the neighbour shuffle ---------------------------------------------------------------------------------------

/** The author-works bucket of an author with n catalog works. */
export function worksBucket(n: number): number {
  const i = CONTEXT.worksBuckets.findIndex((b) => n <= b);
  return i < 0 ? CONTEXT.worksBuckets.length : i;
}

/** One draw from the pool: an anchor from another row, in the same author-works bucket (null when none is left). */
export function drawAnchor<T extends { rowKey: string; bucket: number }>(pool: readonly T[], rowKey: string, bucket: number, rand: () => number): T | null {
  const eligible = pool.filter((p) => p.rowKey !== rowKey && p.bucket === bucket);
  return eligible.length ? eligible[Math.floor(rand() * eligible.length)]! : null;
}

// --- Wilson interval -----------------------------------------------------------------------------------------

/** Wilson score interval (95 %) for k of n. */
export function wilson(k: number, n: number, z = 1.96): [number, number] | null {
  if (n === 0) return null;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - h) / d), Math.min(1, (c + h) / d)];
}
