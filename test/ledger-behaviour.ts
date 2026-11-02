// The Ledger behaviour every implementation must show. `ledger-memory.test.ts` and
// `ledger-sqlite.test.ts` each call `ledgerBehaviour` with their own factory, so the two cannot drift.
import { describe, expect, it } from "vitest";
import { LedgerError } from "../src/ledger/index.ts";
import type { Ledger, LedgerEvent, NewEvent } from "../src/ledger/index.ts";
import { adjudication, example, make, runStarted, scenario, spine, status } from "./helpers/ledger-fixtures.ts";

export interface LedgerOptions {
  crossCheck?: boolean;
}

export function ledgerBehaviour(name: string, open: (options?: LedgerOptions) => Ledger): void {
  function filled(options?: LedgerOptions): Ledger {
    const ledger = open(options);
    for (const e of scenario()) ledger.append(e);
    return ledger;
  }

  describe(name, () => {
    it("assigns seq from 1 and returns the stored event", () => {
      const ledger = open();
      const [first, second] = scenario();
      expect(ledger.lastSeq()).toBe(0);
      expect(ledger.append(first!).seq).toBe(1);
      expect(ledger.append(second!).seq).toBe(2);
      expect(ledger.lastSeq()).toBe(2);
    });

    it("events(after) returns only later events, oldest first", () => {
      const ledger = filled();
      const all = [...ledger.events()];
      expect(all.map((e) => e.seq)).toEqual(all.map((_, i) => i + 1));
      expect([...ledger.events(all.length - 2)].map((e) => e.seq)).toEqual([all.length - 1, all.length]);
      expect([...ledger.events(all.length)]).toEqual([]);
    });

    it("hands out copies: mutating a result never changes the ledger", () => {
      const ledger = filled();
      const before = JSON.stringify(ledger.viewDump());
      const obs = ledger.observation("obs-001")!;
      obs.texts.length = 0;
      obs.spine.polygon[0] = [0, 0];
      ([...ledger.events()][0] as LedgerEvent).ts = "1999-01-01T00:00:00Z";
      expect(JSON.stringify(ledger.viewDump())).toBe(before);
    });

    it("refuses an event that fails its contract, and an event that carries a seq", () => {
      const ledger = open();
      expect(() => ledger.append({ ...example("RunStarted"), type: "RunFinished" } as NewEvent)).toThrow(LedgerError);
      expect(() => ledger.append({ ...example("RunStarted"), seq: 5 } as unknown as NewEvent)).toThrow(/assigns seq/);
      expect(ledger.lastSeq()).toBe(0);
    });

    it("refuses events about things it has not seen, and duplicate ids, leaving the ledger unchanged", () => {
      const ledger = open();
      const spine = example("SpineObserved");
      const refused: NewEvent[] = [
        example("TextObserved"),
        example("StatusChanged"),
        example("WorkItemOpened"),
        example("WorkItemClosed"),
        example("RecommendationIssued"),
        example("RecommendationRevised"),
        example("IdentityCorrected.is"),
      ];
      for (const e of refused) expect(() => ledger.append(e), e.type).toThrow(LedgerError);
      ledger.append(spine);
      expect(() => ledger.append(spine)).toThrow(/already exists/);
      expect(ledger.lastSeq()).toBe(1);
      expect(ledger.observations()).toHaveLength(1);
    });

    it("builds the views from the events", () => {
      const ledger = filled();
      const one = ledger.observation("obs-001")!;
      expect(one.spine.ordinal).toBe(0);
      expect(one.texts).toHaveLength(1);
      expect(one.hypotheses?.unknown.score).toBeDefined();
      expect(one.adjudications).toHaveLength(1);
      expect(one.band).toEqual({ observationId: "obs-001", band: "probable", workId: "work-alpha" });
      expect(one.status).toBe("resolved");
      expect(one.corrections).toEqual([{ kind: "is", workId: "work-alpha" }]);

      const two = ledger.observation("obs-002")!;
      expect(two.band).toEqual({ observationId: "obs-002", band: "unknown", reason: "strategies-exhausted" });
      expect(two.status).toBe("unresolved");
      expect(two.hypotheses).toBeNull();

      expect(ledger.observations({ sessionId: "session-synthetic" })).toHaveLength(2);
      expect(ledger.observations({ imageHash: "0".repeat(64) })).toEqual([]);
      expect(ledger.images("session-synthetic")).toHaveLength(1);
      expect(ledger.rejections("session-synthetic")).toHaveLength(1);
      expect(ledger.workItems({ open: true })).toEqual([]);
      expect(ledger.workItems({ open: false })).toHaveLength(1);
      expect(ledger.workItems()[0]!.resolution).toBe("fulfilled");

      const [recommendation] = ledger.recommendations();
      expect(recommendation).toMatchObject({ recommendationId: "rec-001", revisions: 1 });
      expect(recommendation!.current.rank).toBe(2);
    });

    it("a preference changes no view; a correction changes only that observation's corrections (INV-7)", () => {
      const ledger = filled();
      const before = ledger.viewDump();
      ledger.append(example("PreferenceRecorded"));
      expect(ledger.viewDump()).toEqual(before);
      ledger.append(example("IdentityCorrected.not"));
      const after = ledger.viewDump();
      expect(after.recommendations).toEqual(before.recommendations);
      expect(after.observations[0]!.corrections).toHaveLength(2);
      expect(after.observations[1]).toEqual(before.observations[1]);
    });

    it("replaying the log into a fresh ledger gives an identical event list and view dump", () => {
      const original = filled();
      const replayed = open();
      for (const { seq: _seq, ...event } of original.events()) replayed.append(event as NewEvent);
      expect([...replayed.events()]).toEqual([...original.events()]);
      expect(JSON.stringify(replayed.viewDump())).toBe(JSON.stringify(original.viewDump()));
    });

    it("agrees with the JSON Schema on every event of the run when crossCheck is on", () => {
      expect(filled({ crossCheck: true }).lastSeq()).toBe(scenario().length);
    });

    it("builds the run view: budget, spend counted without cache hits, outcome", () => {
      const ledger = filled();
      const [run] = ledger.runs();
      expect(run).toMatchObject({ runId: "run-synthetic-001", usage: { adjudications: 1, inputTokens: 900, outputTokens: 40 } });
      expect(run!.started.budget).toEqual({ maxAdjudications: 50, maxSpendUsd: 1.5 });
      expect(run!.finished?.outcome).toBe("paused");
      expect(ledger.run("run-synthetic-001")).toEqual(run);
      expect(ledger.run("nope")).toBeUndefined();
    });

    it("refuses a second RunStarted for a run, a RunFinished for an unknown run, and a second RunFinished", () => {
      const ledger = open();
      ledger.append(runStarted({}));
      expect(() => ledger.append(runStarted({}))).toThrow(/already exists/);
      expect(() => ledger.append({ ...example("RunFinished"), runId: "other" } as NewEvent)).toThrow(/unknown run/);
      ledger.append(example("RunFinished"));
      expect(() => ledger.append(example("RunFinished"))).toThrow(/already finished/);
      expect(ledger.lastSeq()).toBe(2);
    });
  });

  describe(`${name}: status machine (INV-1, INV-2)`, () => {
    /** A run with `budget`, and obs-001 at `unresolved`. */
    function started(budget: Parameters<typeof runStarted>[0] = { maxAdjudications: 50 }): Ledger {
      const ledger = open();
      ledger.append(runStarted(budget));
      ledger.append(spine("obs-001"));
      ledger.append(status("obs-001", null, "unresolved"));
      return ledger;
    }

    it("accepts every transition in the table", () => {
      for (const [from, to] of [
        ["unresolved", "resolved"],
        ["unresolved", "needs-pixels"],
        ["needs-pixels", "unresolved"],
        ["needs-pixels", "resolved"],
        ["paused", "unresolved"],
      ] as const) {
        const ledger = started({ maxAdjudications: 0 }); // a spent budget, so a pause is allowed
        if (from === "needs-pixels") ledger.append(status("obs-001", "unresolved", "needs-pixels"));
        if (from === "paused") ledger.append(status("obs-001", "unresolved", "paused", { kind: "budget-spent" }));
        ledger.append(status("obs-001", from, to));
        expect(ledger.observation("obs-001")!.status, `${from} -> ${to}`).toBe(to);
      }
      const ledger = started({ maxAdjudications: 0 });
      ledger.append(status("obs-001", "unresolved", "needs-pixels"));
      ledger.append(status("obs-001", "needs-pixels", "paused", { kind: "budget-spent" }));
      expect(ledger.observation("obs-001")!.status).toBe("paused");
    });

    it("rejects an illegal transition and leaves the status and the log unchanged", () => {
      const ledger = started();
      const before = ledger.lastSeq();
      const illegal: [Parameters<typeof status>[1], Parameters<typeof status>[2], RegExp][] = [
        ["unresolved", "unresolved", /not a legal transition/], // a status to itself
        ["unresolved", "paused", /needs cause budget-spent/], // pause without a spent budget
        ["resolved", "unresolved", /its status is unresolved/], // `from` must be the current status
        [null, "unresolved", /its status is unresolved/], // a first status only once
      ];
      for (const [from, to, why] of illegal) expect(() => ledger.append(status("obs-001", from, to)), `${from} -> ${to}`).toThrow(why);
      const fresh = open();
      fresh.append(spine("obs-009"));
      expect(() => fresh.append(status("obs-009", null, "resolved"))).toThrow(/not a legal transition/);
      expect(ledger.lastSeq()).toBe(before);
      expect(ledger.observation("obs-001")!.status).toBe("unresolved");
    });

    it("has no way out of resolved except a trigger, and no way into paused or needs-pixels from it", () => {
      const ledger = started();
      ledger.append(status("obs-001", "unresolved", "resolved"));
      expect(() => ledger.append(status("obs-001", "resolved", "unresolved"))).toThrow(/needs a trigger cause/);
      expect(() => ledger.append(status("obs-001", "resolved", "paused", { kind: "budget-spent" }))).toThrow(/not a legal transition/);
      expect(() => ledger.append(status("obs-001", "resolved", "needs-pixels"))).toThrow(/not a legal transition/);
      expect(() => ledger.append(status("obs-001", "resolved", "unresolved", { kind: "budget-spent" }))).toThrow(/does not fit/);
      expect(ledger.observation("obs-001")!.status).toBe("resolved");
    });

    it("reopens a resolved spine on a catalog refresh, which has no event to cite", () => {
      const ledger = started();
      ledger.append(status("obs-001", "unresolved", "resolved"));
      ledger.append(status("obs-001", "resolved", "unresolved", { kind: "catalog-refresh" }));
      expect(ledger.observation("obs-001")!.status).toBe("unresolved");
    });

    it("reopens on a new image, a correction of that spine, or a model change, each citing a later event of the right kind", () => {
      /** obs-001 resolved at seq 4, then a new image (5), a correction of it (6), and a second run (7). */
      const ready = (): Ledger => {
        const ledger = started();
        ledger.append(status("obs-001", "unresolved", "resolved"));
        ledger.append(example("ImageAssetIngested"));
        ledger.append(make("IdentityCorrected", { observationId: "obs-001", correction: { kind: "is", workId: "work-alpha" } }));
        ledger.append(runStarted({}, "run-two"));
        return ledger;
      };
      const reopen = (kind: "new-image" | "correction" | "model-change", eventSeq: number) =>
        status("obs-001", "resolved", "unresolved", { kind, eventSeq });

      const ledger = ready();
      expect(() => ledger.append(reopen("new-image", 6)), "wrong kind of event").toThrow(/not a ImageAssetIngested/);
      expect(() => ledger.append(reopen("correction", 5))).toThrow(/not a correction/);
      expect(() => ledger.append(reopen("model-change", 5))).toThrow(/not a RunStarted/);
      expect(() => ledger.append(reopen("correction", 99)), "an event that does not exist yet").toThrow(/not earlier/);
      expect(() => ledger.append(reopen("correction", 8)), "the event itself").toThrow(/not earlier/);
      expect(() => ledger.append(reopen("correction", 4)), "the event that resolved it").toThrow(/not later than when the spine was resolved/);
      expect(() => ledger.append(reopen("correction", 1)), "before it was resolved").toThrow(/not later than when the spine was resolved/);
      expect(ledger.observation("obs-001")!.status).toBe("resolved");

      for (const [kind, eventSeq] of [["new-image", 5], ["correction", 6], ["model-change", 7]] as const) {
        const l = ready();
        l.append(reopen(kind, eventSeq));
        expect(l.observation("obs-001")!.status, kind).toBe("unresolved");
      }

      // a trigger is spent once the spine is resolved again
      const again = ready();
      again.append(reopen("new-image", 5));
      again.append(status("obs-001", "unresolved", "resolved"));
      expect(() => again.append(reopen("new-image", 5))).toThrow(/not later than when the spine was resolved/);
    });

    it("a correction reopens only the spine it corrects", () => {
      const ledger = started();
      ledger.append(spine("obs-002", 1));
      ledger.append(status("obs-002", null, "unresolved"));
      ledger.append(status("obs-001", "unresolved", "resolved")); // 6
      ledger.append(status("obs-002", "unresolved", "resolved")); // 7
      ledger.append(make("IdentityCorrected", { observationId: "obs-002", correction: { kind: "unreadable" } })); // 8
      expect(() => ledger.append(status("obs-001", "resolved", "unresolved", { kind: "correction", eventSeq: 8 }))).toThrow(/corrects another spine/);
      ledger.append(status("obs-002", "resolved", "unresolved", { kind: "correction", eventSeq: 8 }));
    });

    it("takes no cause where the table says none", () => {
      const ledger = started();
      expect(() => ledger.append(status("obs-001", "unresolved", "resolved", { kind: "catalog-refresh" }))).toThrow(/takes no cause/);
    });

    it("budget exhaustion gives paused, and the queue persists (INV-2)", () => {
      const ledger = started({ maxAdjudications: 1 });
      ledger.append(spine("obs-002", 1));
      ledger.append(status("obs-002", null, "unresolved"));
      ledger.append(make("WorkItemOpened", { workItemId: "wi-1", kind: "closer-photo", observationId: "obs-002", shelf: 0, ordinal: 1, reason: "missing-pixels" }));
      const pause = (id: string) => status(id, "unresolved", "paused", { kind: "budget-spent" });

      expect(() => ledger.append(pause("obs-001")), "budget not spent yet").toThrow(/has not spent its budget/);
      ledger.append(adjudication("obs-001", 100));
      expect(() => ledger.append(adjudication("obs-002", 100)), "the cap is reached").toThrow(/spent its budget/);
      ledger.append(adjudication("obs-002", 100, true)); // a cache hit costs nothing

      ledger.append(pause("obs-001"));
      ledger.append(pause("obs-002"));
      expect(ledger.observations().map((o) => o.status)).toEqual(["paused", "paused"]);
      expect(ledger.workItems({ open: true }), "the unresolved queue persists").toHaveLength(1);
      expect(ledger.run("run-synthetic-001")!.usage).toEqual({ adjudications: 1, inputTokens: 100, outputTokens: 0 });

      // never closed: the only way on is back to unresolved
      expect(() => ledger.append(status("obs-001", "paused", "resolved"))).toThrow(/not a legal transition/);
      ledger.append(status("obs-001", "paused", "unresolved"));
      expect(ledger.observation("obs-001")!.status).toBe("unresolved");
    });

    it("counts tokens against maxTokens, and lets the last call overshoot", () => {
      const ledger = started({ maxTokens: 150 });
      ledger.append(adjudication("obs-001", 100));
      ledger.append(adjudication("obs-001", 100)); // 100 < 150 when it started: allowed, now 200
      expect(() => ledger.append(adjudication("obs-001", 1))).toThrow(/spent its budget/);
      ledger.append(status("obs-001", "unresolved", "paused", { kind: "budget-spent" }));
    });

    it("accepts a pause for a spend cap it cannot count, and refuses one with no budget on record", () => {
      const spend = started({ maxSpendUsd: 1 });
      spend.append(status("obs-001", "unresolved", "paused", { kind: "budget-spent" })); // the scheduler's claim (I-5)
      const unstarted = open();
      unstarted.append(spine("obs-001"));
      unstarted.append(status("obs-001", null, "unresolved"));
      expect(() => unstarted.append(status("obs-001", "unresolved", "paused", { kind: "budget-spent" }))).toThrow(/never started/);
      const unlimited = started({});
      expect(() => unlimited.append(status("obs-001", "unresolved", "paused", { kind: "budget-spent" }))).toThrow(/has not spent/);
    });
  });
}
