// The live track's rules (S9, card T-0) that a JSON Schema cannot say: they compare a payload with
// another payload or with the ledger's state. Pure functions; `views.ts` (memory) and `sqlite.ts`
// call the same ones, so the two ledgers refuse the same events. Shapes are in `contracts/events/`.
import { CARD_FIELDS } from "./contracts.ts";
import type { CardFieldChange, CardState, EventType, OcrCondition, Payload } from "./contracts.ts";
import { LedgerError } from "./ledger.ts";
import type { CardView, RequestView, TrackView } from "./ledger.ts";

// ---- INV-20: one observation per condition ----

/** The key of an INV-20 condition: readings with equal keys differ only in time. */
export const conditionKey = (condition: OcrCondition): string => `${condition.viewpoint}/${condition.exposure}`;

interface Reading {
  trackId: string;
  condition: OcrCondition;
}

/**
 * Group readings into observations (INV-20): one per (track, condition). Two readings of one track
 * under the same condition are one observation however many there are; the same condition on another
 * track is another observation. Insertion order is kept.
 */
export function observations<T extends Reading>(readings: Iterable<T>): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const r of readings) {
    const key = `${r.trackId}\u0000${conditionKey(r.condition)}`;
    const group = groups.get(key);
    if (group) group.push(r);
    else groups.set(key, [r]);
  }
  return groups;
}

/** How many observations the readings make (INV-20). */
export const observationCount = (readings: Iterable<Reading>): number => observations(readings).size;

/**
 * How many independent observations read `text`: observations with at least one reading of that
 * text. A band may rise only when this is 2 or more across different conditions (INV-20, the
 * temporal analogue of INV-6); I-3 owns the rule, this is its counting half.
 */
export function agreeingObservationCount(readings: Iterable<Reading & { text: string }>, text: string): number {
  let n = 0;
  for (const group of observations(readings).values()) if (group.some((r) => r.text === text)) n++;
  return n;
}

// ---- the context the checks run in ----

export interface LiveContext {
  /** `seq` the event being checked will have. */
  seq: number;
  /** An event already in the log. */
  eventAt(seq: number): { type: EventType; payload: unknown } | undefined;
  hasTrack(trackId: string): boolean;
}

const fail = (type: string, why: string): never => {
  throw new LedgerError(`${type}: ${why}`);
};

function requireTrack(type: string, trackId: string, ctx: LiveContext): void {
  if (!ctx.hasTrack(trackId)) fail(type, `unknown track "${trackId}"`);
}

/** Every cited position names an earlier event; with `only`, one of those types. */
function requireEarlier(type: string, what: string, seqs: readonly number[], ctx: LiveContext, only?: EventType[]): void {
  for (const s of seqs) {
    if (s >= ctx.seq) fail(type, `${what} ${s} is not earlier than this event`);
    const cited = ctx.eventAt(s);
    if (!cited) fail(type, `${what} ${s} names no event`);
    if (only && !only.includes(cited!.type)) fail(type, `${what} ${s} is a ${cited!.type}, not ${only.join(" or ")}`);
  }
}

// ---- tracks ----

/** Next state of a track's view after `p`, or a LedgerError if `p` is not a legal edge for `existing`. */
export function nextTrack(p: Payload<"Track">, existing: TrackView | undefined): TrackView {
  const id = p.trackId;
  if (p.firstFrame > p.lastFrame) fail("Track", `"${id}" firstFrame ${p.firstFrame} is after lastFrame ${p.lastFrame}`);
  if (p.previous === null) {
    if (existing) fail("Track", `track "${id}" already exists`);
    return { trackId: id, current: p, reachedStable: false };
  }
  if (!existing) return fail("Track", `unknown track "${id}"`);
  const was = existing.current;
  if (was.state !== p.previous) fail("Track", `"${id}" is ${was.state}, not ${p.previous}`);
  if (p.sessionId !== was.sessionId) fail("Track", `"${id}" belongs to session "${was.sessionId}"`);
  if (p.firstFrame !== was.firstFrame) fail("Track", `"${id}" firstFrame is fixed at ${was.firstFrame}`);
  if (p.lastFrame < was.lastFrame) fail("Track", `"${id}" lastFrame goes back from ${was.lastFrame} to ${p.lastFrame}`);
  if (p.previous === "lost" && p.state === "stable" && !existing.reachedStable) {
    fail("Track", `"${id}" was lost before it was ever stable; a new track starts instead`);
  }
  return { trackId: id, current: p, reachedStable: existing.reachedStable || p.state === "stable" };
}

/** TrackWindow: the window is ordered, the best frame is inside it, and it holds that many frames at most. */
export function checkTrackWindow(p: Payload<"TrackWindow">, ctx: LiveContext): void {
  const type = "TrackWindow";
  requireTrack(type, p.trackId, ctx);
  if (p.startFrame > p.endFrame) fail(type, `startFrame ${p.startFrame} is after endFrame ${p.endFrame}`);
  const best = p.bestFrame.frameIndex;
  if (best < p.startFrame || best > p.endFrame) fail(type, `best frame ${best} is outside the window ${p.startFrame}-${p.endFrame}`);
  if (p.frameCount > p.endFrame - p.startFrame + 1) fail(type, `${p.frameCount} frames do not fit in the window ${p.startFrame}-${p.endFrame}`);
}

export function checkOcrReading(p: Payload<"OcrReading">, ctx: LiveContext): void {
  requireTrack("OcrReading", p.trackId, ctx);
}

export function checkLookup(p: Payload<"LookupResult">, ctx: LiveContext): void {
  const type = "LookupResult";
  requireTrack(type, p.trackId, ctx);
  requireEarlier(type, "reading", p.readingEventSeqs, ctx, ["OcrReading"]);
  for (const s of p.readingEventSeqs) {
    if ((ctx.eventAt(s)!.payload as Payload<"OcrReading">).trackId !== p.trackId) fail(type, `reading ${s} is of another track`);
  }
}

// ---- adjudication ----

export function checkRequest(p: Payload<"AdjudicationRequested">, existing: RequestView | undefined, ctx: LiveContext): void {
  const type = "AdjudicationRequested";
  if (existing) fail(type, `request "${p.requestId}" already exists`);
  requireTrack(type, p.trackId, ctx);
  requireEarlier(type, "lookup", [p.lookupEventSeq], ctx, ["LookupResult"]);
  const lookup = ctx.eventAt(p.lookupEventSeq)!.payload as Payload<"LookupResult">;
  if (lookup.trackId !== p.trackId) fail(type, `lookup ${p.lookupEventSeq} is of another track`);
  if (lookup.candidateSetHash !== p.candidateSetHash) fail(type, `candidateSetHash differs from lookup ${p.lookupEventSeq}'s`);
}

const KEY = ["model", "cropHash", "candidateSetHash"] as const;

/** A result answers an open request once, under the request's own cache key. */
export function checkResult(p: Payload<"AdjudicationResult">, request: RequestView | undefined): void {
  const type = "AdjudicationResult";
  if (!request) return fail(type, `unknown request "${p.requestId}"`);
  if (request.answered) fail(type, `request "${p.requestId}" is already answered`);
  for (const k of KEY) if (p[k] !== request.requested[k]) fail(type, `${k} differs from request "${p.requestId}"'s`);
}

/** A cache hit repeats an earlier answer exactly: same cache key, same choice. */
export function checkCacheHit(p: Payload<"AdjudicationCacheHit">, ctx: LiveContext): void {
  const type = "AdjudicationCacheHit";
  requireTrack(type, p.trackId, ctx);
  requireEarlier(type, "source", [p.sourceEventSeq], ctx, ["AdjudicationResult", "AdjudicationRecorded"]);
  const source = ctx.eventAt(p.sourceEventSeq)!.payload as Payload<"AdjudicationResult"> | Payload<"AdjudicationRecorded">;
  for (const k of KEY) if (p[k] !== source[k]) fail(type, `${k} differs from source ${p.sourceEventSeq}'s`);
  if (p.choice !== source.choice) fail(type, `choice differs from source ${p.sourceEventSeq}'s`);
}

// ---- cards (INV-21) ----

/** The fields in which two cards differ, in `CARD_FIELDS` order, as a `CardRevised.diff`. */
export function diffCards(previous: CardState, now: CardState): CardFieldChange[] {
  return CARD_FIELDS.flatMap((field) =>
    previous[field] === now[field] ? [] : [{ field, from: previous[field], to: now[field] } as CardFieldChange],
  );
}

const sameCard = (a: CardState, b: CardState): boolean => diffCards(a, b).length === 0;

function requireActive(type: string, id: string, existing: CardView | undefined): CardView {
  if (!existing) return fail(type, `unknown card "${id}"`);
  if (existing.status === "retracted") fail(type, `card "${id}" was retracted`);
  return existing;
}

/** Next state of a card's view after a card event, or a LedgerError. */
export function nextCard(
  event:
    | { type: "CardProposed"; payload: Payload<"CardProposed"> }
    | { type: "CardRevised"; payload: Payload<"CardRevised"> }
    | { type: "CardRetracted"; payload: Payload<"CardRetracted"> }
    | { type: "CardUndo"; payload: Payload<"CardUndo"> },
  existing: CardView | undefined,
  ctx: LiveContext,
): CardView {
  const { type } = event;
  switch (event.type) {
    case "CardProposed": {
      const p = event.payload;
      if (existing) fail(type, `card "${p.cardId}" already exists`);
      requireTrack(type, p.card.trackId, ctx);
      requireEarlier(type, "evidence", p.evidenceEventSeqs, ctx);
      return { cardId: p.cardId, current: p.card, status: "active", revisions: 0, undoable: [] };
    }
    case "CardRevised": {
      const p = event.payload;
      const card = requireActive(type, p.cardId, existing);
      if (!sameCard(card.current, p.previous)) fail(type, `previous is not card "${p.cardId}"'s current state`);
      const expected = diffCards(p.previous, p.card);
      if (expected.length === 0) fail(type, "nothing changed");
      if (JSON.stringify(expected) !== JSON.stringify(p.diff.map(({ field, from, to }) => ({ field, from, to })))) {
        fail(type, `diff is not exactly the changed fields; expected ${JSON.stringify(expected)}`);
      }
      requireTrack(type, p.card.trackId, ctx);
      requireEarlier(type, "reason", p.reasonEventSeqs, ctx);
      return { ...card, current: p.card, revisions: card.revisions + 1, undoable: [...card.undoable, ctx.seq] };
    }
    case "CardRetracted": {
      const p = event.payload;
      const card = requireActive(type, p.cardId, existing);
      if (!sameCard(card.current, p.last)) fail(type, `last is not card "${p.cardId}"'s current state`);
      requireEarlier(type, "reason", p.reasonEventSeqs, ctx);
      return { ...card, status: "retracted", undoable: [] };
    }
    case "CardUndo": {
      const p = event.payload;
      const card = requireActive(type, p.cardId, existing);
      const latest = card.undoable[card.undoable.length - 1];
      if (latest !== p.revisionEventSeq) {
        fail(type, `${p.revisionEventSeq} is not card "${p.cardId}"'s latest revision to undo (${latest ?? "none"})`);
      }
      const revision = ctx.eventAt(latest)!.payload as Payload<"CardRevised">;
      if (!sameCard(revision.previous, p.restored)) fail(type, `restored is not what revision ${latest} replaced`);
      return { ...card, current: p.restored, undoable: card.undoable.slice(0, -1) };
    }
  }
}
