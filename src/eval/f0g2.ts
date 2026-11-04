// F-0g2 pooled reading: when no copy in an F-0g copy group is confirmed, each reader model's text of all the copies
// is fused character by character (centre-star consensus over overlap alignments, as in multi-frame OCR fusion) and
// looked up once in the catalog. The copies are different crops of different physical books, so the fused reading
// is new pixel evidence; but one reader model's errors correlate across copies, so each model casts one vote for the
// group however many copies it read (INV-6), and two models must confirm one work. A copy takes the work as
// `confirmed-by-pooling` only through F-0g's per-copy tests; copies are never merged (INV-4). Pure functions; the
// runner is f0g2-cli.ts. Spec: docs/machine-labelling.md, keep rule: evals/F0g2/report.md.
import { normalize } from "../catalog/normalize.ts";
import { vote, READERS, type ReaderName, type ReaderVotes, type UnknownReason } from "./f0.ts";
import { consistentReaders, contradiction, type DecisionBasis, type Fit, type GuardReason, type ReaderTop, type SpineEvidence, type WorkRef } from "./f0g.ts";

export const POOL = {
  /** Overlap alignment scores: a match, a mismatch, a gap inside the aligned span (end gaps are free). */
  match: 1,
  mismatch: -1,
  gap: -1,
  /** Two texts overlap (are aligned and fused) when their best alignment scores at least this. */
  minOverlap: 3,
  /** Candidates retrieved for a pooled reading; the first is the model's vote. */
  depth: 3,
} as const;

// --- overlap alignment ---------------------------------------------------------------------------------------

/** One aligned column: a character index in each text, or -1 for a gap. */
export type Column = [number, number];

export interface Alignment {
  score: number;
  /** Columns inside the aligned span, in order. */
  cols: Column[];
  /** The aligned span in each text, [start, end). Outside it are the free end gaps. */
  a: [number, number];
  b: [number, number];
}

/**
 * Overlap (semi-global) alignment of `a` and `b`: end gaps on both texts are free, so a fragment can be a prefix, a
 * suffix or a piece of the other. Inside the span, match +1, mismatch −1, gap −1. Ties in the traceback prefer the
 * diagonal, then a gap in `b`.
 */
export function overlapAlign(a: string, b: string): Alignment {
  const n = a.length;
  const m = b.length;
  const H = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      H[i]![j] = Math.max(H[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? POOL.match : POOL.mismatch), H[i - 1]![j]! + POOL.gap, H[i]![j - 1]! + POOL.gap);
  // The best cell on the last row or column: one text has ended, the rest of the other is a free end gap.
  let bi = n;
  let bj = 0;
  let best = -Infinity;
  for (let j = 0; j <= m; j++) if (H[n]![j]! > best) (best = H[n]![j]!), (bi = n), (bj = j);
  for (let i = 0; i <= n; i++) if (H[i]![m]! > best) (best = H[i]![m]!), (bi = i), (bj = m);
  const cols: Column[] = [];
  let i = bi;
  let j = bj;
  while (i > 0 && j > 0) {
    const h = H[i]![j]!;
    if (h === H[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? POOL.match : POOL.mismatch)) cols.push([--i, --j]);
    else if (h === H[i - 1]![j]! + POOL.gap) cols.push([--i, -1]);
    else cols.push([-1, --j]);
  }
  cols.reverse();
  // Trim gap columns at the span's ends: a leading or trailing gap is an end gap, which is free.
  while (cols.length && (cols[0]![0] < 0 || cols[0]![1] < 0)) cols.shift();
  while (cols.length && (cols.at(-1)![0] < 0 || cols.at(-1)![1] < 0)) cols.pop();
  if (cols.length === 0) return { score: Math.max(0, best), cols, a: [0, 0], b: [0, 0] };
  return { score: best, cols, a: [cols[0]![0], cols.at(-1)![0] + 1], b: [cols[0]![1], cols.at(-1)![1] + 1] };
}

// --- fusion --------------------------------------------------------------------------------------------------

/** One copy's text from one reader model: its variants (`variantsOf`), in shelf order. */
export interface CopyText {
  copy: string;
  variants: string[];
}

export interface Fusion {
  /** The centre: the copy and its variant (normalised) every other text is aligned to. */
  centre: { copy: string; text: string };
  /** Each copy's chosen variant (normalised), in input order. */
  chosen: { copy: string; text: string; score: number; overlaps: boolean }[];
  /** Consensus over the centre and the texts that overlap it. */
  fusedAligned: string;
  /** fusedAligned, then each text that does not overlap the centre. */
  fusedAll: string;
  /** Copies in fusedAligned (the centre and those overlapping it), and in fusedAll (every copy with text). */
  alignedCopies: string[];
  allCopies: string[];
}

const clean = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Most votes wins; a tie goes to `prefer` when it is among the leaders, else to the first leader in vote order. */
function majority(votes: string[], prefer: string): string {
  const n = new Map<string, number>();
  for (const v of votes) n.set(v, (n.get(v) ?? 0) + 1);
  const top = Math.max(...n.values());
  if (n.get(prefer) === top) return prefer;
  return votes.find((v) => n.get(v) === top)!;
}

/**
 * Fuse one reader model's texts of a copy group (pre-registered in evals/F0g2/report.md). The centre is the variant
 * that aligns best, summed over the other copies, with each one's best-matching variant (ties: longer, then shelf
 * order); every other copy contributes its variant that aligns best with the centre, so rotations line up without
 * the catalog. Over each centre character the texts spanning it vote (their aligned character, or a deletion);
 * between two centre characters a run is inserted only when a strict majority of the spanning texts insert it;
 * ties go to the centre; texts running past the centre's ends extend it (the longest overhang on each side). Null
 * when fewer than two copies have text.
 */
export function fuse(texts: CopyText[]): Fusion | null {
  const copies = texts
    .map((t) => ({ copy: t.copy, variants: [...new Set(t.variants.map((v) => clean(normalize(v))).filter((v) => v.length > 0))] }))
    .filter((t) => t.variants.length > 0);
  if (copies.length < 2) return null;
  const memo = new Map<string, Alignment>();
  const align = (a: string, b: string): Alignment => {
    const k = `${a}\u0000${b}`;
    if (!memo.has(k)) memo.set(k, overlapAlign(a, b));
    return memo.get(k)!;
  };
  let centre = { k: 0, text: copies[0]!.variants[0]!, total: -Infinity };
  copies.forEach((c, k) => {
    for (const v of c.variants) {
      const total = copies.reduce((s, o, q) => (q === k ? s : s + Math.max(...o.variants.map((u) => align(v, u).score))), 0);
      if (total > centre.total || (total === centre.total && v.length > centre.text.length)) centre = { k, text: v, total };
    }
  });
  const C = centre.text;
  const L = C.length;
  const chosen = copies.map((c, k) => {
    if (k === centre.k) return { copy: c.copy, text: C, score: Infinity, overlaps: true, al: null as Alignment | null };
    let pick = { text: c.variants[0]!, al: align(C, c.variants[0]!) };
    for (const u of c.variants.slice(1)) {
      const al = align(C, u);
      if (al.score > pick.al.score) pick = { text: u, al };
    }
    return { copy: c.copy, text: pick.text, score: pick.al.score, overlaps: pick.al.score >= POOL.minOverlap, al: pick.al };
  });
  // Votes per centre position and per insertion slot (slot p sits before centre position p), centre first.
  const pos: string[][] = [...C].map((ch) => [ch]);
  const ins: string[][] = Array.from({ length: L + 1 }, () => [""]);
  let left = "";
  let right = "";
  for (const c of chosen) {
    if (!c.al || !c.overlaps) continue;
    const t = c.text;
    const [a0, a1] = c.al.a;
    const [b0, b1] = c.al.b;
    let run = "";
    let last = -1;
    for (const [i, j] of c.al.cols) {
      if (i < 0) {
        run += t[j]!;
        continue;
      }
      // The slot before a centre character is voted on by the texts spanning both of its sides.
      if (last >= 0) ins[i]!.push(run);
      run = "";
      pos[i]!.push(j < 0 ? "" : t[j]!);
      last = i;
    }
    if (a0 === 0 && b0 > 0 && b0 > left.length) left = t.slice(0, b0);
    if (a1 === L && b1 < t.length && t.length - b1 > right.length) right = t.slice(b1);
  }
  let out = left;
  for (let p = 0; p < L; p++) {
    if (p > 0) {
      // A run is inserted only when a strict majority of the texts spanning the slot insert that run.
      const vs = ins[p]!;
      const runs = vs.filter((v) => v !== "");
      if (runs.length > 0) {
        const r = majority(runs, runs[0]!);
        if (runs.filter((v) => v === r).length * 2 > vs.length) out += r;
      }
    }
    out += majority(pos[p]!, C[p]!);
  }
  out += right;
  const fusedAligned = clean(out);
  const unaligned = chosen.filter((c) => !c.overlaps).map((c) => c.text);
  return {
    centre: { copy: copies[centre.k]!.copy, text: C },
    chosen: chosen.map(({ copy, text, score, overlaps }) => ({ copy, text, score: Number.isFinite(score) ? score : -1, overlaps })),
    fusedAligned,
    fusedAll: clean([fusedAligned, ...unaligned].join(" ")),
    alignedCopies: chosen.filter((c) => c.overlaps).map((c) => c.copy),
    allCopies: chosen.map((c) => c.copy),
  };
}

// --- the pooled vote -----------------------------------------------------------------------------------------

/** One copy of a group as pooling sees it: its evidence (F-0g's reader tops) and its reader texts per model. */
export interface PoolCopy {
  ev: SpineEvidence;
  texts: Partial<Record<ReaderName, string[]>>;
}

/** A pooled reading's variants, and which copies each comes from. */
export interface PooledReading {
  variants: string[];
  sources: string[][];
  /** How many leading variants are fused (0 without fusion or with text on fewer than two copies). */
  fused: number;
  fusion: Fusion | null;
}

/**
 * Reader model R's pooled reading of a group: the fused-aligned and fused-all texts (when two or more copies have R
 * text and fusion is on), then every copy's own R variants. One reading, so one retrieval and one vote.
 */
export function pooledReading(group: PoolCopy[], reader: ReaderName, fusion = true): PooledReading {
  const texts = group.map((c) => ({ copy: c.ev.id, variants: c.texts[reader] ?? [] }));
  const f = fusion ? fuse(texts) : null;
  const variants: string[] = [];
  const sources: string[][] = [];
  if (f) {
    variants.push(f.fusedAligned);
    sources.push(f.alignedCopies);
    if (f.fusedAll !== f.fusedAligned) variants.push(f.fusedAll), sources.push(f.allCopies);
  }
  const fused = variants.length;
  for (const t of texts) for (const v of t.variants) variants.push(v), sources.push([t.copy]);
  return { variants, sources, fused, fusion: f };
}

/** A pooled reading's top catalog candidate (the caller's `retrieve`, top `POOL.depth`), with the winning variant. */
export type Lookup = (variants: string[]) => (NonNullable<ReaderTop["top"]> & { coverage: number; variant: number }) | null;

export interface PooledVote {
  reader: ReaderName;
  copiesRead: number;
  /** Copies in the fused-all text (0: no fusion). */
  copiesFused: number;
  top: (WorkRef & { score: number; titleEvidence: number; coverage: number; passes: boolean }) | null;
  /** The winning variant is a fused text, not one copy's own. */
  fromFused: boolean;
  sources: string[];
}

export type PooledBasis = DecisionBasis | "confirmed-by-pooling";

export interface PoolDecision {
  id: string;
  basis: PooledBasis | null;
  workId: string | null;
  /** confirmed-by-pooling: the copies whose text is in a supporting model's winning variant, and those models. */
  sources?: string[];
  readers?: ReaderName[];
  /** This copy's own readers consistent with the work. */
  consistent?: ReaderName[];
  blocked?: GuardReason | "no-consistent-reader" | "no-pooled-vote";
}

export interface PoolResult {
  work: WorkRef | null;
  /** Why the group has no pooled work (F-0's vote reasons). */
  reason: UnknownReason | null;
  votes: PooledVote[];
  supporting: ReaderName[];
  decisions: PoolDecision[];
}

/**
 * Pool one copy group (members in shelf order, none `readers-agree`). Each reader model with text on any copy casts
 * one vote: its pooled reading's top candidate, confirming when it passes F-0's bar. F-0's `vote` needs two models
 * confirming one work, uniquely. Each copy then takes the work as `confirmed-by-pooling` only if its own reads do not
 * contradict it and one of its own readers is consistent with it (F-0g's tests). One decision per copy (INV-4).
 */
export function poolGroup(group: PoolCopy[], lookup: Lookup, fit: Fit, fusion = true): PoolResult {
  const votes: PooledVote[] = [];
  const v: ReaderVotes = { readText: {}, top: {}, confirmed: {} };
  for (const reader of READERS) {
    const copiesRead = group.filter((c) => (c.texts[reader] ?? []).length > 0).length;
    if (copiesRead === 0) continue;
    const pr = pooledReading(group, reader, fusion);
    const hit = lookup(pr.variants);
    const top = hit ? { workId: hit.workId, title: hit.title, authors: hit.authors, score: hit.score, titleEvidence: hit.titleEvidence, coverage: hit.coverage, passes: hit.passes } : null;
    votes.push({ reader, copiesRead, copiesFused: pr.fusion ? pr.fusion.allCopies.length : 0, top, fromFused: Boolean(hit && hit.variant < pr.fused), sources: hit ? pr.sources[hit.variant] ?? [] : [] });
    v.readText[reader] = true;
    v.top[reader] = top?.workId ?? null;
    v.confirmed[reader] = top?.passes ? top.workId : null;
  }
  const { acceptedId, agreeing, reason } = vote(v);
  if (!acceptedId) return { work: null, reason, votes, supporting: [], decisions: group.map((c) => ({ id: c.ev.id, basis: null, workId: null, blocked: "no-pooled-vote" })) };
  const t = votes.find((x) => x.top?.workId === acceptedId)!.top!;
  const work: WorkRef = { workId: t.workId, title: t.title, authors: t.authors };
  const support = votes.filter((x) => agreeing.includes(x.reader));
  const sources = [...new Set(support.flatMap((x) => x.sources))];
  const decisions = group.map((c): PoolDecision => {
    const why = contradiction(c.ev, work, fit);
    if (why) return { id: c.ev.id, basis: null, workId: null, blocked: why };
    const consistent = consistentReaders(c.ev, work, fit);
    if (consistent.length === 0) return { id: c.ev.id, basis: null, workId: null, blocked: "no-consistent-reader" };
    return { id: c.ev.id, basis: "confirmed-by-pooling", workId: work.workId, sources, readers: agreeing, consistent };
  });
  return { work, reason: null, votes, supporting: agreeing, decisions };
}

// --- evaluation views ----------------------------------------------------------------------------------------

/** A copy as an evaluation view sees it: confirmation hidden and, optionally, one reader model removed. */
export function viewOf(c: PoolCopy, drop?: ReaderName): PoolCopy {
  const texts = { ...c.texts };
  if (drop) delete texts[drop];
  return { ev: { ...c.ev, accepted: null, readers: c.ev.readers.filter((r) => r.reader !== drop) }, texts };
}

/** F-0 would decide this copy without pooling: two of its own readers confirm one work. */
export function selfDecides(ev: SpineEvidence): boolean {
  const n = new Map<string, number>();
  for (const r of ev.readers) if (r.top?.passes) n.set(r.top.workId, (n.get(r.top.workId) ?? 0) + 1);
  return [...n.values()].some((k) => k >= 2);
}

/** Wilson score interval's upper bound for k of n (95 %). */
export function wilsonUpper(k: number, n: number, z = 1.96): number | null {
  if (n === 0) return null;
  const p = k / n;
  const d = 1 + (z * z) / n;
  return Math.min(1, (p + (z * z) / (2 * n) + z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d);
}
