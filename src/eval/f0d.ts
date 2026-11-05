// F-0d imprint tie-break: a spine's read publisher or imprint reorders, never adds, a reader's catalog vote.
//
// F-0 lets each reader vote for its top retrieval candidate when that candidate passes the catalog bar
// (`confirms`), and accepts a work two readers vote for. Here, for a spine F-0 left unknown, each reader's top three
// candidates that pass the bar are checked against the read imprint: if some of them have an edition from that
// publisher and some do not, the reader votes for the best one that does. Votes are then counted as F-0 counts them.
// So an imprint can only choose between candidates the text already supports, two readers must still agree, and a
// spine F-0 accepted is never touched. Spec: evals/F0d/report.md.
//
// C-9 adds rule IMP-1 (`imprintContrast`), the other side: on a spine F-0 accepted, an imprint can withhold the
// accept, never confirm or switch it. Off by default (`IMP1.enabled`). Spec: docs/catalog/identification-research.md
// §3.2; evals/C9/.
import type { DatabaseSync } from "node:sqlite";
import { editionImprintKeys, editionKeys, imprintMatches, type ImprintTable, type ParentLinks } from "../catalog/imprint.ts";
import { LOOKALIKE } from "../catalog/lookalike.ts";
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

// --- C-9: rule IMP-1, the imprint contrast ------------------------------------------------------------------------

/**
 * IMP-1 (C-9). `enabled` is the switch, off by default: no runner withholds unless it is turned on. A runner-up counts
 * when its score is within the lookalike margin (C-6's `LOOKALIKE.margin`) of the accepted work's in the same reader's
 * ranked list.
 */
export const IMP1 = { enabled: false, margin: LOOKALIKE.margin } as const;

export interface ContrastInput {
  /** The work F-0 accepted. */
  accepted: Candidate;
  /** The readers that voted for it. */
  agreeing: readonly ReaderName[];
  /** Each reader's ranked candidates (`retrieve` to `LOOKALIKE.depth`). */
  lists: Partial<Record<ReaderName, Candidate[]>>;
  /** The read imprint key, already through the hygiene (`usableImprint`); null: no usable read. */
  imprint: string | null;
  /** Does a work carry the read house through what its editions say (`strict` keys)? */
  carriesStrict: (workId: string) => boolean;
  /** Does it, counting undated parents too (`any` keys)? */
  carriesAny: (workId: string) => boolean;
  /** One book, so never each other's runner-up (`sameBook`). */
  same: (a: Candidate, b: Candidate) => boolean;
}

export interface Contrast {
  withhold: boolean;
  /** The runner-up that carries the house, when the rule withholds. */
  rival: Candidate | null;
  /** Did some agreeing reader have a passing runner-up within the margin at all? */
  close: boolean;
}

/**
 * IMP-1 (§3.2): withhold an accept when the accepted work's editions lack the read house, even through an undated
 * parent, **and** a runner-up within the margin that passes F-0's bar on its own carries it through what its editions
 * say. The imprint never enters retrieval or a score, never adds a reader (it is Qwen's read of the same crop, INV-6),
 * and never moves the accept to the runner-up: the spine becomes unknown with both shown.
 */
export function imprintContrast(i: ContrastInput): Contrast {
  let close = false;
  for (const reader of i.agreeing) {
    const ranked = i.lists[reader] ?? [];
    const own = ranked.find((c) => c.workId === i.accepted.workId);
    if (!own) continue;
    for (const c of ranked) {
      if (c.workId === own.workId || own.score - c.score > IMP1.margin || !confirms(c) || i.same(own, c)) continue;
      close = true;
      if (i.imprint && !i.carriesAny(i.accepted.workId) && i.carriesStrict(c.workId)) return { withhold: true, rival: c, close };
    }
  }
  return { withhold: false, rival: null, close };
}

/** A spine decision with IMP-1 applied, when `enabled`. F-0's reasons have no imprint kind, so a withheld spine is
 * `readers-disagree` (two passing works, one carrying the house), with the contrast recorded beside it. */
export function applyImprintContrast(d: SpineDecision, c: Contrast, enabled: boolean = IMP1.enabled): SpineDecision & { imprintContrast?: { accepted: string; rival: string } } {
  if (!enabled || !c.withhold || !d.accepted || !c.rival) return d;
  return { ...d, accepted: null, agreeing: [], reason: "readers-disagree", imprintContrast: { accepted: d.accepted.workId, rival: c.rival.workId } };
}

/** Per work, its strict and any imprint keys over every edition (C-9 data: all publisher strings, series, parents). */
export function workImprintKeys(db: DatabaseSync, table: ImprintTable, links?: ParentLinks, opts: { publishers?: boolean; series?: boolean } = {}): (workId: string) => { strict: string[]; any: string[] } {
  const cols = (db.prepare("SELECT name FROM pragma_table_info('editions')").all() as { name: string }[]).map((c) => c.name);
  const pubs = opts.publishers !== false && cols.includes("publishers") ? "publishers" : "NULL AS publishers";
  const series = opts.series !== false && cols.includes("pub_series") ? "pub_series" : "NULL AS pub_series";
  const stmt = db.prepare(`SELECT publisher, ${pubs}, ${series}, year FROM editions WHERE work_id = ?`);
  const memo = new Map<string, { strict: string[]; any: string[] }>();
  return (workId) => {
    let keys = memo.get(workId);
    if (!keys) {
      const strict = new Set<string>(), any = new Set<string>();
      for (const r of stmt.all(workId) as { publisher: string | null; publishers: string | null; pub_series: string | null; year: number | null }[]) {
        const k = editionImprintKeys(table, { publisher: r.publisher, publishers: r.publishers, pubSeries: r.pub_series, year: r.year }, links);
        for (const x of k.strict) strict.add(x);
        for (const x of k.any) any.add(x);
      }
      keys = { strict: [...strict], any: [...any] };
      memo.set(workId, keys);
    }
    return keys;
  };
}
