// The live track's ledger behaviour (S9, card T-0) that every implementation must show. Called from
// `ledger-memory.test.ts` and `ledger-sqlite.test.ts` beside `ledgerBehaviour`, so the two cannot drift.
import { describe, expect, it } from "vitest";
import type { Ledger, NewEvent } from "../src/ledger/index.ts";
import type { LedgerOptions } from "./ledger-behaviour.ts";
import { example, make, runStarted } from "./helpers/ledger-fixtures.ts";
import { card, fill, live, liveScenario } from "./helpers/live-fixtures.ts";

const SEQ = {
  trackStable: 4,
  readings: 7,
  lookup: 8,
  request: 9,
  result: 10,
  cacheHit: 11,
  proposed: 12,
  revised1: 13,
  undo: 14,
  revised2: 15,
  lost: 16,
  retracted: 17,
};

export function liveBehaviour(name: string, open: (options?: LedgerOptions) => Ledger): void {
  /** A ledger holding the first `n` events of the live scenario. */
  const upTo = (n: number, options?: LedgerOptions): Ledger => fill(open(options), liveScenario().slice(0, n));

  /** The event is refused with a message matching `pattern`, and the ledger is exactly as it was. */
  function refuse(ledger: Ledger, event: NewEvent, pattern: RegExp): void {
    const last = ledger.lastSeq();
    const dump = JSON.stringify(ledger.viewDump());
    expect(() => ledger.append(event)).toThrow(pattern);
    expect(ledger.lastSeq()).toBe(last);
    expect(JSON.stringify(ledger.viewDump())).toBe(dump);
  }

  describe(`${name}: live track (S9)`, () => {
    it("takes the whole live scenario, and builds the track, card and request views", () => {
      const ledger = upTo(liveScenario().length);
      expect(ledger.lastSeq()).toBe(19);
      expect(ledger.tracks()).toEqual([
        { trackId: "track-001", current: expect.objectContaining({ state: "stable", previous: "lost", lastFrame: 210 }), reachedStable: true },
      ]);
      const [c] = ledger.cards();
      expect(c).toMatchObject({ cardId: "card-001", status: "retracted", revisions: 2, undoable: [] });
      expect(c!.current).toEqual(card({ rank: 1, band: "verified", rationale: "Synthetic rationale: an ISBN was read." }));
      expect(ledger.adjudicationRequests()).toEqual([expect.objectContaining({ requestId: "adj-001", answered: true })]);
    });

    it("counts a live adjudication result against the run's budget, and a cache hit not at all (INV-2)", () => {
      const ledger = upTo(SEQ.result);
      expect(ledger.run("run-synthetic-001")!.usage).toEqual({ adjudications: 1, inputTokens: 900, outputTokens: 40 });
      ledger.append(live("AdjudicationCacheHit", { sourceEventSeq: SEQ.result }));
      expect(ledger.run("run-synthetic-001")!.usage).toEqual({ adjudications: 1, inputTokens: 900, outputTokens: 40 });
    });

    it("refuses a request once the run's counted cap is spent, but still serves a cache hit (INV-2)", () => {
      const ledger = open();
      const events = liveScenario();
      ledger.append(runStarted({ maxAdjudications: 1 }));
      fill(ledger, events.slice(1, SEQ.result));
      refuse(ledger, live("AdjudicationRequested", { requestId: "adj-002", lookupEventSeq: SEQ.lookup }), /spent its budget/);
      ledger.append(live("AdjudicationCacheHit", { sourceEventSeq: SEQ.result }));
    });

    it("applies the same checks when crossCheck is on", () => {
      expect(upTo(19, { crossCheck: true }).lastSeq()).toBe(19);
    });
  });

  describe(`${name}: tracks`, () => {
    it("refuses an edge that is not the track's next one", () => {
      const ledger = upTo(2); // run, born
      refuse(ledger, live("Track.born"), /already exists/);
      refuse(ledger, live("Track.lost", { trackId: "track-404", previous: "stable" }), /unknown track/);
      refuse(ledger, live("Track.lost"), /is born, not stable/); // previous says stable
      refuse(ledger, live<"Track">("Track.stable", { sessionId: "other-session" }), /belongs to session/);
      refuse(ledger, live<"Track">("Track.stable", { firstFrame: 5 }), /firstFrame is fixed/);
      refuse(ledger, live<"Track">("Track.stable", { firstFrame: 130, lastFrame: 129 }), /after lastFrame/);
      ledger.append(live("Track.stable"));
      refuse(ledger, live<"Track">("Track.lost", { lastFrame: 125 }), /lastFrame goes back/);
    });

    it("lets a lost track recover only if it had been stable", () => {
      const lostFirst = upTo(2);
      lostFirst.append(live<"Track">("Track.lost", { previous: "born" }));
      refuse(lostFirst, live("Track.recovered"), /lost before it was ever stable/);

      const recovered = upTo(SEQ.lost);
      recovered.append(live("Track.recovered"));
      expect(recovered.tracks()[0]!.current.state).toBe("stable");
    });

    it("refuses events about a track the ledger has not seen", () => {
      const ledger = open();
      for (const event of [
        live("TrackWindow"),
        live("OcrReading"),
        live("LookupResult", { readingEventSeqs: [1] }),
        live("AdjudicationRequested", { lookupEventSeq: 1 }),
        live("AdjudicationCacheHit", { sourceEventSeq: 1 }),
        live("CardProposed", { evidenceEventSeqs: [1] }),
      ]) {
        refuse(ledger, event, /unknown track/);
      }
    });

    it("refuses a window whose best frame lies outside it, or that holds more frames than it spans", () => {
      const ledger = upTo(SEQ.trackStable);
      const window = live<"TrackWindow">("TrackWindow").payload;
      refuse(ledger, live<"TrackWindow">("TrackWindow", { startFrame: 150, endFrame: 149 }), /after endFrame/);
      refuse(ledger, live<"TrackWindow">("TrackWindow", { bestFrame: { ...window.bestFrame, frameIndex: 200 } }), /outside the window/);
      refuse(ledger, live<"TrackWindow">("TrackWindow", { frameCount: 31 }), /do not fit/);
    });
  });

  describe(`${name}: lookups and adjudication`, () => {
    it("refuses a lookup that cites an event that is not an earlier reading of the same track", () => {
      const ledger = upTo(SEQ.readings);
      refuse(ledger, live<"LookupResult">("LookupResult", { readingEventSeqs: [3] }), /not OcrReading/);
      refuse(ledger, live<"LookupResult">("LookupResult", { readingEventSeqs: [6, 99] }), /not earlier|names no event/);
      ledger.append(live<"Track">("Track.born", { trackId: "track-002" }));
      ledger.append(live<"OcrReading">("OcrReading", { trackId: "track-002" })); // seq 9
      refuse(ledger, live<"LookupResult">("LookupResult", { readingEventSeqs: [9] }), /of another track/);
    });

    it("refuses a request that cites no lookup, another track's lookup, or a different candidate set", () => {
      const ledger = upTo(SEQ.lookup);
      refuse(ledger, live<"AdjudicationRequested">("AdjudicationRequested", { lookupEventSeq: 6 }), /not LookupResult/);
      refuse(ledger, live<"AdjudicationRequested">("AdjudicationRequested", { lookupEventSeq: 8, candidateSetHash: "9".repeat(64) }), /candidateSetHash differs/);
      refuse(ledger, live<"AdjudicationRequested">("AdjudicationRequested", { lookupEventSeq: 8, trackId: "track-404" }), /unknown track/);
    });

    it("answers a request once, under its own cache key", () => {
      const ledger = upTo(SEQ.request);
      refuse(ledger, live<"AdjudicationResult">("AdjudicationResult", { requestId: "adj-404" }), /unknown request/);
      refuse(ledger, live<"AdjudicationResult">("AdjudicationResult", { cropHash: "9".repeat(64) }), /cropHash differs/);
      refuse(ledger, live<"AdjudicationResult">("AdjudicationResult", { model: "other-model" }), /model differs/);
      ledger.append(live("AdjudicationResult"));
      refuse(ledger, live("AdjudicationResult"), /already answered/);
      refuse(ledger, live("AdjudicationRequested", { lookupEventSeq: SEQ.lookup }), /already exists/);
    });

    it("serves a cache hit only from an earlier answer with the same key and choice", () => {
      const ledger = upTo(SEQ.result);
      refuse(ledger, live<"AdjudicationCacheHit">("AdjudicationCacheHit", { sourceEventSeq: SEQ.request }), /not AdjudicationResult or AdjudicationRecorded/);
      refuse(ledger, live<"AdjudicationCacheHit">("AdjudicationCacheHit", { sourceEventSeq: SEQ.result, choice: null }), /choice differs/);
      refuse(ledger, live<"AdjudicationCacheHit">("AdjudicationCacheHit", { sourceEventSeq: SEQ.result, model: "other-model" }), /model differs/);
      refuse(ledger, live<"AdjudicationCacheHit">("AdjudicationCacheHit", { sourceEventSeq: 11 }), /not earlier/);
    });
  });

  describe(`${name}: cards are never revised or undone silently (INV-21)`, () => {
    const was = () => card();
    const now = () => card({ rank: 1, band: "probable" });
    const revise = (change: Partial<ReturnType<typeof live<"CardRevised">>["payload"]> = {}): NewEvent =>
      live<"CardRevised">("CardRevised", { card: now(), previous: was(), reasonEventSeqs: [SEQ.result], ...change });

    it("refuses a card that already exists, is unknown, or whose evidence is not an earlier event", () => {
      const ledger = upTo(SEQ.proposed);
      refuse(ledger, live("CardProposed", { evidenceEventSeqs: [SEQ.lookup] }), /already exists/);
      refuse(ledger, live<"CardProposed">("CardProposed", { cardId: "card-2", evidenceEventSeqs: [99] }), /not earlier/);
      refuse(ledger, live<"CardProposed">("CardProposed", { cardId: "card-2", evidenceEventSeqs: [13] }), /not earlier/);
      refuse(ledger, revise({ cardId: "card-404" }), /unknown card/);
    });

    it("accepts a revision only when previous is the card as it is and diff is exactly what changed", () => {
      const ledger = upTo(SEQ.proposed);
      refuse(ledger, revise({ previous: card({ rank: 3 }) }), /previous is not/);
      refuse(ledger, revise({ diff: [{ field: "rank", from: 2, to: 1 }] }), /diff is not exactly/); // band missing
      refuse(ledger, revise({ diff: [{ field: "band", from: "candidate", to: "probable" }, { field: "rank", from: 2, to: 1 }] }), /diff is not exactly/); // order
      refuse(ledger, revise({ diff: [{ field: "rank", from: 2, to: 1 }, { field: "band", from: "candidate", to: "verified" }] }), /diff is not exactly/); // wrong value
      refuse(ledger, revise({ card: was(), diff: [{ field: "rank", from: 2, to: 2 }] }), /nothing changed/);
      refuse(ledger, revise({ reasonEventSeqs: [99] }), /not earlier/);
      refuse(ledger, revise({ card: card({ rank: 1, band: "probable", trackId: "track-404" }), diff: [
        { field: "rank", from: 2, to: 1 },
        { field: "trackId", from: "track-001", to: "track-404" },
        { field: "band", from: "candidate", to: "probable" },
      ] }), /diff is not exactly|unknown track/);
      ledger.append(revise());
      expect(ledger.cards()[0]).toMatchObject({ revisions: 1, undoable: [SEQ.revised1] });
      expect(ledger.cards()[0]!.current).toEqual(now());
    });

    it("an identity change is a revision too: workId in the diff", () => {
      const ledger = upTo(SEQ.proposed);
      const other = card({ workId: "work-beta" });
      ledger.append(revise({ card: other, diff: [{ field: "workId", from: "work-alpha", to: "work-beta" }] }));
      expect(ledger.cards()[0]!.current.workId).toBe("work-beta");
    });

    it("undoes the latest revision, one at a time, to exactly what it replaced", () => {
      const ledger = upTo(SEQ.revised1);
      ledger.append(revise({ card: card({ rank: 3, band: "probable" }), previous: now(), reasonEventSeqs: [SEQ.lookup], diff: [{ field: "rank", from: 1, to: 3 }] })); // seq 14
      expect(ledger.cards()[0]!.undoable).toEqual([13, 14]);
      refuse(ledger, live<"CardUndo">("CardUndo", { revisionEventSeq: 13, restored: was() }), /not card "card-001"'s latest revision/);
      refuse(ledger, live<"CardUndo">("CardUndo", { revisionEventSeq: 14, restored: was() }), /restored is not/);
      ledger.append(live<"CardUndo">("CardUndo", { revisionEventSeq: 14, restored: now() }));
      expect(ledger.cards()[0]).toMatchObject({ undoable: [13], revisions: 2 });
      expect(ledger.cards()[0]!.current).toEqual(now());
      ledger.append(live<"CardUndo">("CardUndo", { revisionEventSeq: 13, restored: was() }));
      expect(ledger.cards()[0]).toMatchObject({ undoable: [] });
      expect(ledger.cards()[0]!.current).toEqual(was());
      refuse(ledger, live<"CardUndo">("CardUndo", { revisionEventSeq: 13, restored: was() }), /latest revision to undo \(none\)/);
    });

    it("refuses an undo that names an event that is not a revision of this card", () => {
      const ledger = upTo(SEQ.proposed);
      refuse(ledger, live<"CardUndo">("CardUndo", { revisionEventSeq: SEQ.proposed, restored: was() }), /latest revision to undo \(none\)/);
    });

    it("a retracted card is final: it can neither be revised nor undone nor retracted again", () => {
      const ledger = upTo(SEQ.retracted - 1); // after the second revision, track lost
      refuse(ledger, live<"CardRetracted">("CardRetracted", { last: was(), reasonEventSeqs: [SEQ.lost] }), /last is not/);
      refuse(ledger, live<"CardRetracted">("CardRetracted", { reasonEventSeqs: [99] }), /not earlier|last is not/);
      ledger.append(live<"CardRetracted">("CardRetracted", { last: card({ rank: 1, band: "verified", rationale: "Synthetic rationale: an ISBN was read." }), reasonEventSeqs: [SEQ.lost] }));
      expect(ledger.cards()[0]).toMatchObject({ status: "retracted", undoable: [] });
      refuse(ledger, revise(), /was retracted/);
      refuse(ledger, live<"CardUndo">("CardUndo", { revisionEventSeq: SEQ.revised2, restored: was() }), /was retracted/);
      refuse(ledger, live<"CardRetracted">("CardRetracted", { reasonEventSeqs: [SEQ.lost] }), /was retracted/);
    });
  });
}
