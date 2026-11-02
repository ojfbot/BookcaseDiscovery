import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LedgerError, MemoryLedger } from "../src/ledger/index.ts";
import type { LedgerEvent, NewEvent } from "../src/ledger/index.ts";

const example = (name: string): NewEvent => JSON.parse(readFileSync(new URL(`./fixtures/contracts/${name}.json`, import.meta.url), "utf8"));

/** A small synthetic run: one resolved spine, one unknown spine with a closer-photo work item, one recommendation. */
function scenario(): NewEvent[] {
  const spine1 = example("SpineObserved");
  const spine2 = structuredClone(spine1) as Extract<NewEvent, { type: "SpineObserved" }>;
  spine2.payload.observationId = "obs-002";
  spine2.payload.ordinal = 1;
  const rec = example("RecommendationIssued");
  const revised = example("RecommendationRevised");
  return [
    example("RunStarted"),
    example("ScanSessionOpened"),
    example("ImageAssetIngested"),
    example("ImageRejected"),
    spine1,
    spine2,
    example("StatusChanged.first"),
    { ...example("StatusChanged.first"), payload: { observationId: "obs-002", from: null, to: "unresolved" } } as NewEvent,
    example("TextObserved"),
    example("HypothesesProposed"),
    example("AdjudicationRecorded"),
    example("BandAssigned.probable"),
    example("StatusChanged"),
    example("BandAssigned.unknown"),
    example("WorkItemOpened"),
    rec,
    revised,
    example("PreferenceRecorded"),
    example("IdentityCorrected.is"),
    example("WorkItemClosed"),
    example("RunFinished"),
  ];
}

function filled(options?: ConstructorParameters<typeof MemoryLedger>[0]): MemoryLedger {
  const ledger = new MemoryLedger(options);
  for (const e of scenario()) ledger.append(e);
  return ledger;
}

describe("MemoryLedger", () => {
  it("assigns seq from 1 and returns the stored event", () => {
    const ledger = new MemoryLedger();
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
    const ledger = new MemoryLedger();
    expect(() => ledger.append({ ...example("RunStarted"), type: "RunFinished" } as NewEvent)).toThrow(LedgerError);
    expect(() => ledger.append({ ...example("RunStarted"), seq: 5 } as unknown as NewEvent)).toThrow(/assigns seq/);
    expect(ledger.lastSeq()).toBe(0);
  });

  it("refuses events about things it has not seen, and duplicate ids, leaving the ledger unchanged", () => {
    const ledger = new MemoryLedger();
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
    const replayed = new MemoryLedger();
    for (const { seq: _seq, ...event } of original.events()) replayed.append(event as NewEvent);
    expect([...replayed.events()]).toEqual([...original.events()]);
    expect(JSON.stringify(replayed.viewDump())).toBe(JSON.stringify(original.viewDump()));
  });

  it("agrees with the JSON Schema on every event of the run when crossCheck is on", () => {
    expect(filled({ crossCheck: true }).lastSeq()).toBe(scenario().length);
  });
});
