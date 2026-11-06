// identify's decision core (OC34 as amended by OC36): the accept rule a reader's catalog candidate must pass, and the
// vote that accepts a work only when two independent readers confirm it, uniquely. Everything else stays unknown with
// its reason. Pure; it lives in identify, where production reads it (DL-4), and `src/eval/f0.ts` re-exports it.
// Spec: docs/machine-labelling.md.

import type { GuardArm } from "../catalog/lookalike.ts";
import type { CounterKind } from "../catalog/rarity.ts";
import type { Candidate } from "../catalog/retrieve.ts";
import type { ReaderName } from "./readers.ts";

/** Acceptance thresholds (OC36 yardstick 2). Conservative; see docs/machine-labelling.md. */
export const ACCEPT = {
  /**
   * Retrieval evidence score of the agreed work, for each agreeing reader. Set from C-3's golden run, never from
   * the yardstick: no-match top scores reached 0.721, correct top-1 scores went down to 0.71.
   */
  minScore: 0.72,
  /** The title field must be explained, not just the author. */
  minTitleEvidence: 0.8,
  /** Share of the reading's tokens the work explains. */
  minCoverage: 0.5,
  /** Readers that must name the same work. */
  minReaders: 2,
} as const;

export type UnknownReason = "no-text" | "no-catalog-match" | "single-reader" | "readers-disagree";

export interface SpineDecision {
  id: string;
  imageId: string;
  boxScore: number;
  /** Top confirmed work per reader (null: the reader's best candidate failed the bar, or it read nothing). */
  confirmed: Partial<Record<ReaderName, string | null>>;
  /** Top candidate per reader, confirmed or not. */
  top: Partial<Record<ReaderName, string | null>>;
  readText: Partial<Record<ReaderName, boolean>>;
  accepted: Candidate | null;
  agreeing: ReaderName[];
  reason: UnknownReason | null;
  hard: boolean;
  /** C-6: readers whose confirmation the lookalike guard withdrew, and the arm that did (absent without a guard). */
  lookalike?: Partial<Record<ReaderName, GuardArm>>;
  /** C-7: readers whose confirmation counter-evidence withdrew, and which kind (absent without the rarity basis). */
  counter?: Partial<Record<ReaderName, CounterKind>>;
}

/** Does the catalog confirm this candidate as the book (OC36 yardstick 2)? */
export function confirms(c: Candidate | undefined): boolean {
  if (!c) return false;
  const title = c.evidence.find((e) => e.field === "title")?.score ?? 0;
  return c.score >= ACCEPT.minScore && title >= ACCEPT.minTitleEvidence && c.queryCoverage >= ACCEPT.minCoverage;
}

/** What each reader said about one spine: read any text, its top candidate, and the work it confirms (if any). */
export interface ReaderVotes {
  readText: SpineDecision["readText"];
  top: SpineDecision["top"];
  confirmed: SpineDecision["confirmed"];
}

/** F-0's vote: two readers confirming one work, uniquely, accept it; otherwise the reason it stays unknown. */
export function vote(v: ReaderVotes): Pick<SpineDecision, "agreeing" | "reason" | "hard"> & { acceptedId: string | null } {
  const votes = new Map<string, ReaderName[]>();
  for (const [reader, w] of Object.entries(v.confirmed) as [ReaderName, string | null][]) {
    if (w) votes.set(w, [...(votes.get(w) ?? []), reader]);
  }
  const ranked = [...votes.entries()].sort((a, b) => b[1].length - a[1].length);
  const best = ranked[0];
  const unique = best && (ranked.length === 1 || ranked[1]![1].length < best[1].length);
  let acceptedId: string | null = null;
  let agreeing: ReaderName[] = [];
  let reason: UnknownReason | null = null;
  if (best && best[1].length >= ACCEPT.minReaders && unique) {
    acceptedId = best[0];
    agreeing = best[1];
  } else if (!Object.values(v.readText).some(Boolean)) reason = "no-text";
  else if (votes.size === 0) reason = "no-catalog-match";
  else if (votes.size > 1) reason = "readers-disagree";
  else reason = "single-reader";
  // Hard crop (OC10 rule, served by the local VLM): the two OCR readers have not settled it.
  const hard = !(v.confirmed.vision && v.confirmed.vision === v.confirmed.ppocr);
  return { acceptedId, agreeing, reason, hard };
}
