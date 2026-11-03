// F-0d imprint tie-break: a spine's read publisher or imprint reorders, never adds, a reader's catalog vote.
//
// F-0 lets each reader vote for its top retrieval candidate when that candidate passes the catalog bar
// (`confirms`), and accepts a work two readers vote for. Here, for a spine F-0 left unknown, each reader's top three
// candidates that pass the bar are checked against the read imprint: if some of them have an edition from that
// publisher and some do not, the reader votes for the best one that does. Votes are then counted as F-0 counts them.
// So an imprint can only choose between candidates the text already supports, two readers must still agree, and a
// spine F-0 accepted is never touched. Spec: evals/F0d/report.md.
import type { DatabaseSync } from "node:sqlite";
import { editionKeys, imprintMatches, type ImprintTable } from "../catalog/imprint.ts";
import { retrieve, type Candidate } from "../catalog/retrieve.ts";
import { ACCEPT, confirms, READERS, variantsOf, type Reading, type ReaderName, type SpineDecision } from "./f0.ts";

/** Candidates per reader the tie-break may choose among: the same retrieval call F-0 makes (top 3). */
export const TIE_K = 3;

/** One reader's top `TIE_K` candidates, cached by its readings. */
export function candidatesFor(db: DatabaseSync, r: Reading | undefined, cache: Map<string, Candidate[]>): Candidate[] {
  const variants = variantsOf(r);
  if (variants.length === 0) return [];
  const key = variants.join("\u0000");
  if (!cache.has(key)) cache.set(key, retrieve(db, variants, TIE_K));
  return cache.get(key)!;
}

export interface TieBreak {
  /** The decision after the tie-break (F-0's own when nothing changed). */
  decision: SpineDecision;
  /** Readers whose vote the imprint moved to another candidate. */
  switched: ReaderName[];
  /** Did the imprint separate some reader's passing candidates (some match, some do not)? */
  fired: boolean;
}

/**
 * Re-vote one spine with an imprint. `base` is F-0's decision on the same readings; `lists` each reader's
 * candidates (`candidatesFor`); `matches` says whether a work has an edition from the read imprint.
 */
export function tieBreak(base: SpineDecision, lists: Partial<Record<ReaderName, Candidate[]>>, matches: (workId: string) => boolean): TieBreak {
  if (base.accepted) return { decision: base, switched: [], fired: false };
  const confirmed: SpineDecision["confirmed"] = { ...base.confirmed };
  const cands = new Map<string, Candidate>();
  const switched: ReaderName[] = [];
  let fired = false;
  for (const reader of READERS) {
    const passing = (lists[reader] ?? []).filter((c) => confirms(c));
    for (const c of passing) if (!cands.has(c.workId)) cands.set(c.workId, c);
    if (!(reader in base.confirmed)) continue;
    const hit = passing.filter((c) => matches(c.workId));
    if (hit.length === 0 || hit.length === passing.length) continue;
    fired = true;
    if (confirmed[reader] !== hit[0]!.workId) {
      confirmed[reader] = hit[0]!.workId;
      switched.push(reader);
    }
  }
  if (switched.length === 0) return { decision: base, switched, fired };
  const votes = new Map<string, ReaderName[]>();
  for (const [reader, w] of Object.entries(confirmed) as [ReaderName, string | null][]) if (w) votes.set(w, [...(votes.get(w) ?? []), reader]);
  const ranked = [...votes.entries()].sort((a, b) => b[1].length - a[1].length);
  const best = ranked[0];
  const unique = best && (ranked.length === 1 || ranked[1]![1].length < best[1].length);
  // Acceptance is F-0's rule, and the accepted work must itself carry the imprint: a reader switching away from a
  // work never makes another work win.
  if (!(best && best[1].length >= ACCEPT.minReaders && unique && matches(best[0]))) return { decision: { ...base, confirmed }, switched, fired };
  return { decision: { ...base, confirmed, accepted: cands.get(best[0])!, agreeing: best[1], reason: null }, switched, fired };
}

/**
 * Could any imprint change this spine? True when some passing candidate, if it alone carried the imprint, would be
 * accepted: the spines worth an imprint read.
 */
export function reorderable(base: SpineDecision, lists: Partial<Record<ReaderName, Candidate[]>>): boolean {
  if (base.accepted) return false;
  const works = new Set(Object.values(lists).flatMap((l) => (l ?? []).filter((c) => confirms(c)).map((c) => c.workId)));
  return [...works].some((w) => tieBreak(base, lists, (x) => x === w).decision.accepted !== null);
}

/** Per work, the imprint keys of every edition (segments and their ISFDB parents), memoised. */
export function workImprints(db: DatabaseSync, table: ImprintTable): (workId: string) => string[] {
  const stmt = db.prepare("SELECT DISTINCT publisher FROM editions WHERE work_id = ? AND publisher IS NOT NULL AND publisher != ''");
  const memo = new Map<string, string[]>();
  return (workId) => {
    let keys = memo.get(workId);
    if (!keys) {
      const set = new Set<string>();
      for (const r of stmt.all(workId) as { publisher: string }[]) for (const k of editionKeys(table, r.publisher)) set.add(k);
      keys = [...set];
      memo.set(workId, keys);
    }
    return keys;
  };
}

/** Does `workId` have an edition from the house `imprint` (a key) names? */
export const carries = (keysOf: (workId: string) => string[], imprint: string | null) => (workId: string): boolean =>
  imprintMatches(imprint, keysOf(workId));
