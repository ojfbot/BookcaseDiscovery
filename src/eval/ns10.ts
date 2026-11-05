// NS-10: multi-view label fusion on pilot-000's capture groups. Pre-registered in evals/NS10/prereg.md (constants and
// rules below are its numbers); method in docs/models/multiview-fusion.md. Pure functions: association of boxes
// across the stills of one case from their footprints on the shelf plane, candidate labels, and the card's measures
// with a case-level bootstrap. The geometry (MapAnything) is helpers/fusion/; the runner is ns10-cli.ts.
//
// Every figure is machine agreement with a named reference, never accuracy (OC36). Nothing here writes to the label
// ledger: candidates are a private file, and admission to TS-0 is a later card and the owner's decision.
import { quantile, rng } from "./q1.ts";

export const NS10 = {
  /** Smallest intersection over union of two footprints for the boxes to be one book (prereg §3, hypothesis). */
  iouMin: 0.5,
  /** A box's second candidate within this much IoU of its best makes the match a tie (prereg §3 rule 4). */
  tieBand: 0.05,
  /** Fewest confident pixels for a box to be lifted into the group's frame. */
  minPixels: 50,
  /** The case-level bootstrap (as NS1 and NS5). */
  reps: 2000,
  seed: 20261105,
  /** Verdict: association precision (point estimate) at least this (prereg §5, hypothesis). */
  precisionFloor: 0.8,
  /** Verdict: groups with pose success, at least this many of the cases (prereg §5). */
  poseSuccessMin: 4,
  /** Fewer cases than this get per-case values only (NS1's floor). */
  minCasesForInterval: 5,
} as const;

/** One box's footprint on the group's shelf plane, in the plane's (along-shelf, up) coordinates (helpers/fusion/lift.py). */
export interface Footprint {
  /** `<photo>:<i>`, F-0's box id. */
  id: string;
  photo: string;
  lifted: boolean;
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/** What the readers of one box confirmed (F-0's `confirmed`): the works that passed the bar, with the reader. */
export type Confirmed = Partial<Record<"vision" | "ppocr" | "qwen", string | null>>;

export const worksOf = (c: Confirmed | undefined): string[] => [...new Set(Object.values(c ?? {}).filter((w): w is string => !!w))].sort();

export function iou(a: Footprint, b: Footprint): number {
  const w = Math.min(a.u1, b.u1) - Math.max(a.u0, b.u0);
  const h = Math.min(a.v1, b.v1) - Math.max(a.v0, b.v0);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  const union = (a.u1 - a.u0) * (a.v1 - a.v0) + (b.u1 - b.u0) * (b.v1 - b.v0) - inter;
  return union > 0 ? inter / union : 0;
}

export interface FusedBook {
  /** Member box ids, in a stable order. */
  members: string[];
  /** The stills the members are in: no still appears twice. */
  photos: string[];
  /** A member's cross-view match was decided by the reading tie-break (prereg §3 rule 4). */
  tieBroken: boolean;
}

/**
 * Prereg §3: one case's boxes into fused books. Greedy by descending IoU over cross-view pairs at or above `iouMin`;
 * a pair merges when each is the other's best match in its view (mutual) and the two fused books share no still.
 * Where a box has several candidates in a view within `tieBand` of its best, the one whose reading agrees (if exactly
 * one does) wins; otherwise the box has no match in that view. Reading agreement never creates a pair.
 */
export function associate(boxes: readonly Footprint[], agrees: (a: string, b: string) => boolean = () => false, opts: { iouMin?: number; tieBand?: number } = {}): FusedBook[] {
  const iouMin = opts.iouMin ?? NS10.iouMin;
  const tieBand = opts.tieBand ?? NS10.tieBand;
  const lifted = boxes.filter((b) => b.lifted);
  const photos = [...new Set(lifted.map((b) => b.photo))].sort();
  const byPhoto = new Map(photos.map((p) => [p, lifted.filter((b) => b.photo === p)]));
  const tie = new Set<string>();

  // best[a][photo] = the box of `photo` a matches, or null (none, or an unresolved tie).
  const best = new Map<string, Map<string, string | null>>();
  for (const a of lifted) {
    const m = new Map<string, string | null>();
    for (const p of photos) {
      if (p === a.photo) continue;
      const cands = (byPhoto.get(p) ?? []).map((b) => ({ b, v: iou(a, b) })).filter((c) => c.v >= iouMin).sort((x, y) => y.v - x.v || x.b.id.localeCompare(y.b.id));
      if (cands.length === 0) continue;
      const top = cands[0]!;
      const close = cands.filter((c) => top.v - c.v <= tieBand);
      if (close.length === 1) m.set(p, top.b.id);
      else {
        const agreeing = close.filter((c) => agrees(a.id, c.b.id));
        if (agreeing.length === 1) (m.set(p, agreeing[0]!.b.id), tie.add(a.id));
        else m.set(p, null);
      }
    }
    best.set(a.id, m);
  }

  const pairs: { a: string; b: string; v: number }[] = [];
  const fp = new Map(lifted.map((b) => [b.id, b]));
  for (const a of lifted) {
    for (const bId of best.get(a.id)!.values()) {
      // Each pair once (from its smaller id), and only when it is mutual.
      if (!bId || a.id >= bId || best.get(bId)?.get(a.photo) !== a.id) continue;
      pairs.push({ a: a.id, b: bId, v: iou(a, fp.get(bId)!) });
    }
  }
  pairs.sort((x, y) => y.v - x.v || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));

  const parent = new Map(boxes.map((b) => [b.id, b.id]));
  const find = (x: string): string => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x)!)), parent.get(x)!));
  const stills = new Map(boxes.map((b) => [b.id, new Set([b.photo])]));
  const tied = new Map(boxes.map((b) => [b.id, false]));
  for (const { a, b } of pairs) {
    const ra = find(a), rb = find(b);
    if (ra === rb) continue;
    const sa = stills.get(ra)!, sb = stills.get(rb)!;
    if ([...sa].some((p) => sb.has(p))) continue; // two boxes of one still never join one fused book
    parent.set(rb, ra);
    for (const p of sb) sa.add(p);
    tied.set(ra, tied.get(ra)! || tied.get(rb)! || tie.has(a) || tie.has(b));
  }
  const groups = new Map<string, string[]>();
  for (const b of boxes) groups.set(find(b.id), [...(groups.get(find(b.id)) ?? []), b.id]);
  return [...groups.entries()]
    .map(([root, members]) => {
      const m = members.sort();
      return { members: m, photos: [...new Set(m.map((id) => boxes.find((b) => b.id === id)!.photo))].sort(), tieBroken: tied.get(root) ?? false };
    })
    .sort((x, y) => x.members[0]!.localeCompare(y.members[0]!));
}

// --- candidate labels ----------------------------------------------------------------------------------------------

export interface FusedReading {
  photo: string;
  box: string;
  works: string[];
}

export interface Candidate {
  members: { photo: string; box: string }[];
  /** The work readers of at least two different stills agree on. */
  workId: string;
  /** Stills whose readers confirmed it. */
  views: number;
  /** Another confirmed work in a member box (a new conflict, still written). */
  conflict: boolean;
  labelSource: "multiview-fusion";
  rgbRecoverable: "yes" | "unknown";
}

/**
 * Prereg §3 rule 5: a candidate when readers from at least two different stills confirm one work. Several works with
 * the same view count is ambiguous and gets none. `rgbRecoverable` is `yes` because the agreeing readings are of an RGB
 * view (every reading here is); `unknown` is reserved for evidence that is geometry alone.
 */
export function candidateOf(book: FusedBook, readings: ReadonlyMap<string, string[]>): Candidate | null {
  const perWork = new Map<string, Set<string>>();
  const all = new Set<string>();
  for (const id of book.members) {
    for (const w of readings.get(id) ?? []) {
      all.add(w);
      perWork.set(w, (perWork.get(w) ?? new Set()).add(photoOfId(id)));
    }
  }
  const ranked = [...perWork.entries()].filter(([, s]) => s.size >= 2).sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
  if (ranked.length === 0) return null;
  if (ranked.length > 1 && ranked[1]![1].size === ranked[0]![1].size) return null;
  const [workId, views] = ranked[0]!;
  return {
    members: book.members.map((id) => ({ photo: photoOfId(id), box: id })),
    workId,
    views: views.size,
    conflict: all.size > 1,
    labelSource: "multiview-fusion",
    rgbRecoverable: "yes",
  };
}

export const photoOfId = (boxId: string): string => boxId.slice(0, boxId.lastIndexOf(":"));

// --- measures --------------------------------------------------------------------------------------------------------

/** A box's facts the measures read, joined by the runner from F-0, F-0g and Q-3's frame functions. */
export interface BoxFacts {
  id: string;
  photo: string;
  /** F-0's unaccepted reason `single-reader`. */
  singleReader: boolean;
  /** Q-3's frame-edge (`cut` or `outer`). */
  frameEdge: boolean;
  /** The works the box's readers confirmed (F-0). */
  works: string[];
  /** F-0g copy group within the photo (`<photo>:<group>`) when it has two or more boxes, else null. */
  copyGroup: string | null;
}

/** Counts for one case; every ratio is a pooled sum of these over cases. */
export interface CaseTally {
  case: string;
  stills: number;
  boxCount: number;
  lifted: number;
  fusedBooks: number;
  /** Fused books of two or more boxes. */
  joinedBooks: number;
  boxesInJoined: number;
  singleReader: number;
  singleReaderJoined: number;
  gain: number;
  conflict: number;
  frameEdge: number;
  frameEdgeReadElsewhere: number;
  frameEdgeReadAgree: number;
  /** Frame-edge boxes read elsewhere that carry a confirmed work of their own (M3b's denominator). */
  frameEdgeReadOwn: number;
  /** Supplementary (not pre-registered): frame-edge boxes with no confirmed work of their own, and those read in full elsewhere. */
  frameEdgeUnread: number;
  frameEdgeUnreadReadElsewhere: number;
  copyBooksSameStill: number;
  copyBooksSameGroup: number;
  copyExposure: number;
  copyExposureTied: number;
  pairsRead: number;
  pairsSame: number;
  sameWorkPairs: number;
  sameWorkMerged: number;
  candidates: number;
  candidateConflicts: number;
}

export function tallyCase(name: string, boxes: readonly BoxFacts[], books: readonly FusedBook[], liftedIds: ReadonlySet<string>): CaseTally {
  const facts = new Map(boxes.map((b) => [b.id, b]));
  const bookOf = new Map<string, FusedBook>();
  for (const bk of books) for (const m of bk.members) bookOf.set(m, bk);
  const t: CaseTally = {
    case: name, stills: new Set(boxes.map((b) => b.photo)).size, boxCount: boxes.length, lifted: liftedIds.size, fusedBooks: books.length,
    joinedBooks: 0, boxesInJoined: 0, singleReader: 0, singleReaderJoined: 0, gain: 0, conflict: 0, frameEdge: 0, frameEdgeReadElsewhere: 0,
    frameEdgeReadAgree: 0, frameEdgeReadOwn: 0, frameEdgeUnread: 0, frameEdgeUnreadReadElsewhere: 0, copyBooksSameStill: 0, copyBooksSameGroup: 0, copyExposure: 0, copyExposureTied: 0,
    pairsRead: 0, pairsSame: 0, sameWorkPairs: 0, sameWorkMerged: 0, candidates: 0, candidateConflicts: 0,
  };
  for (const bk of books) {
    if (bk.members.length > 1) (t.joinedBooks++, (t.boxesInJoined += bk.members.length));
    // M4: exact copy safety.
    if (new Set(bk.members.map((m) => facts.get(m)!.photo)).size < bk.members.length) t.copyBooksSameStill++;
    const cg = bk.members.map((m) => facts.get(m)!.copyGroup).filter((g): g is string => !!g);
    if (new Set(cg).size < cg.length) t.copyBooksSameGroup++;
    if (cg.length > 0 && bk.members.length > 1) (t.copyExposure++, bk.tieBroken && t.copyExposureTied++);
    // M5: cross-view pairs inside a fused book where both boxes carry a confirmed work.
    for (let i = 0; i < bk.members.length; i++)
      for (let j = i + 1; j < bk.members.length; j++) {
        const a = facts.get(bk.members[i]!)!, b = facts.get(bk.members[j]!)!;
        if (a.photo === b.photo || a.works.length === 0 || b.works.length === 0) continue;
        t.pairsRead++;
        if (a.works.some((w) => b.works.includes(w))) t.pairsSame++;
      }
  }
  for (const b of boxes) {
    const bk = bookOf.get(b.id)!;
    const others = bk.members.filter((m) => facts.get(m)!.photo !== b.photo).map((m) => facts.get(m)!);
    const joined = others.length > 0;
    if (b.singleReader) {
      t.singleReader++;
      if (joined) t.singleReaderJoined++;
      const seen = new Set(others.flatMap((o) => o.works));
      if (seen.size > 0) {
        if (b.works.some((w) => seen.has(w))) t.gain++;
        else t.conflict++;
      }
    }
    if (b.frameEdge) {
      t.frameEdge++;
      const full = others.filter((o) => !o.frameEdge && o.works.length > 0);
      if (b.works.length === 0) (t.frameEdgeUnread++, full.length > 0 && t.frameEdgeUnreadReadElsewhere++);
      if (full.length > 0) {
        t.frameEdgeReadElsewhere++;
        if (b.works.length > 0) {
          t.frameEdgeReadOwn++;
          if (full.some((o) => o.works.some((w) => b.works.includes(w)))) t.frameEdgeReadAgree++;
        }
      }
    }
  }
  // M5b: cross-view pairs of boxes confirming one work, with no copy of that work in either still (unambiguous).
  const byPhoto = new Map<string, BoxFacts[]>();
  for (const b of boxes) byPhoto.set(b.photo, [...(byPhoto.get(b.photo) ?? []), b]);
  const copiesOf = (photo: string, w: string): number => (byPhoto.get(photo) ?? []).filter((b) => b.works.includes(w)).length;
  const photos = [...byPhoto.keys()].sort();
  for (let i = 0; i < photos.length; i++)
    for (let j = i + 1; j < photos.length; j++)
      for (const a of byPhoto.get(photos[i]!)!)
        for (const w of a.works) {
          if (copiesOf(photos[i]!, w) !== 1 || copiesOf(photos[j]!, w) !== 1) continue;
          const b = byPhoto.get(photos[j]!)!.find((x) => x.works.includes(w))!;
          t.sameWorkPairs++;
          if (bookOf.get(a.id) === bookOf.get(b.id)) t.sameWorkMerged++;
        }
  return t;
}

export function tallyCandidates(t: CaseTally, candidates: readonly Candidate[]): void {
  t.candidates = candidates.length;
  t.candidateConflicts = candidates.filter((c) => c.conflict).length;
}

/** A pooled ratio over cases and the case-level percentile bootstrap (2.5 % to 97.5 %); null interval under the floor. */
export function pooled(cases: readonly CaseTally[], num: (t: CaseTally) => number, den: (t: CaseTally) => number, reps: number = NS10.reps, seed: number = NS10.seed) {
  const ratio = (xs: readonly CaseTally[]): number | null => {
    const d = xs.reduce((s, x) => s + den(x), 0);
    return d === 0 ? null : xs.reduce((s, x) => s + num(x), 0) / d;
  };
  const value = ratio(cases);
  let interval: { lo: number; hi: number } | null = null;
  if (cases.length >= NS10.minCasesForInterval) {
    const rand = rng(seed);
    const draws: number[] = [];
    for (let r = 0; r < reps; r++) {
      const v = ratio(Array.from({ length: cases.length }, () => cases[Math.floor(rand() * cases.length)]!));
      if (v !== null) draws.push(v);
    }
    draws.sort((a, b) => a - b);
    if (draws.length > 0) interval = { lo: quantile(draws, 0.025), hi: quantile(draws, 0.975) };
  }
  return { value, num: cases.reduce((s, x) => s + num(x), 0), den: cases.reduce((s, x) => s + den(x), 0), interval };
}

export interface Verdict {
  verdict: "fails" | "keep" | "not-shown";
  because: string;
}

/** Prereg §5, in order. `poseSuccessGroups` is the number of groups the teacher placed; `cases` the number of cases. */
export function verdictOf(m: { copyBooks: number; poseSuccessGroups: number; gain: { value: number | null; interval: { lo: number; hi: number } | null }; precision: number | null }): Verdict {
  if (m.copyBooks > 0) return { verdict: "fails", because: `copy safety: ${m.copyBooks} fused book(s) hold two boxes of one still or one copy group` };
  if (m.poseSuccessGroups < NS10.poseSuccessMin) return { verdict: "fails", because: `pose success in ${m.poseSuccessGroups} groups, under ${NS10.poseSuccessMin}` };
  const lo = m.gain.interval?.lo ?? null;
  if (lo === null) return { verdict: "not-shown", because: "no interval (too few cases or no single-reader box)" };
  if (!(lo > 0)) return { verdict: "not-shown", because: "the gain share's interval reaches 0" };
  if (m.precision === null || m.precision < NS10.precisionFloor) return { verdict: "not-shown", because: `association precision ${m.precision === null ? "undefined" : m.precision.toFixed(3)} is under ${NS10.precisionFloor}` };
  return { verdict: "keep", because: "copy safety is exact, the gain share's lower bound is above 0 and the association precision clears the floor" };
}
