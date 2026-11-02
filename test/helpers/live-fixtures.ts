// Synthetic live-track events (S9, card T-0) for the ledger tests, built from the contract examples.
import type { EventType, Ledger, NewEvent, Payload } from "../../src/ledger/index.ts";
import { example, make } from "./ledger-fixtures.ts";

type Of<T extends EventType> = Extract<NewEvent, { type: T }>;

/** The example `name` with `change` merged into its payload. */
export function live<T extends EventType>(name: string, change: Partial<Payload<T>> = {}): Of<T> {
  const base = example(name) as Of<T>;
  return make(base.type, { ...base.payload, ...change } as Payload<T>) as Of<T>;
}

export const card = (change: Partial<Payload<"CardProposed">["card"]> = {}): Payload<"CardProposed">["card"] => ({
  ...(example("CardProposed") as Of<"CardProposed">).payload.card,
  ...change,
});

/**
 * A live session of one track, exercising every live event type. The comment on each line is the
 * `seq` it gets (events cite each other by seq).
 */
export function liveScenario(): NewEvent[] {
  const was = card(); // rank 2, candidate
  const now = card({ rank: 1, band: "probable" });
  const later = card({ rank: 1, band: "verified", rationale: "Synthetic rationale: an ISBN was read." });
  return [
    example("RunStarted"), //                                                   1
    live("Track.born"), //                                                      2
    live("FrameSample"), //                                                     3
    live("Track.stable"), //                                                    4
    live("TrackWindow"), //                                                     5
    live("OcrReading"), //                                                      6  frontal / normal
    live("OcrReading.fast-dim"), //                                             7  left-oblique / under
    live("LookupResult", { readingEventSeqs: [6, 7] }), //                      8
    live("AdjudicationRequested", { lookupEventSeq: 8 }), //                    9
    live("AdjudicationResult"), //                                              10
    live("AdjudicationCacheHit", { sourceEventSeq: 10 }), //                    11
    live("CardProposed", { evidenceEventSeqs: [8] }), //                        12
    live("CardRevised", { card: now, previous: was, reasonEventSeqs: [10], diff: [
      { field: "rank", from: 2, to: 1 },
      { field: "band", from: "candidate", to: "probable" },
    ] }), //                                                                    13
    live("CardUndo", { revisionEventSeq: 13, restored: was }), //               14
    live("CardRevised", { card: later, previous: was, reasonEventSeqs: [11], diff: [
      { field: "rank", from: 2, to: 1 },
      { field: "band", from: "candidate", to: "verified" },
      { field: "rationale", from: was.rationale, to: later.rationale },
    ] }), //                                                                    15
    live("Track.lost"), //                                                      16
    live("CardRetracted", { last: later, reasonEventSeqs: [16] }), //           17
    live("Track.recovered"), //                                                 18
    example("RunFinished"), //                                                  19
  ];
}

/** Append every event, returning the ledger. */
export function fill(ledger: Ledger, events: NewEvent[]): Ledger {
  for (const e of events) ledger.append(e);
  return ledger;
}

/** The ledger's events as JSON Lines: the format of a recorded event file. */
export const exportLines = (ledger: Ledger): string =>
  [...ledger.events()].map((e) => JSON.stringify({ seq: e.seq, type: e.type, ts: e.ts, runId: e.runId, payload: e.payload })).join("\n") + "\n";
