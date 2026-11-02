// Synthetic events for the ledger tests, built from the contract examples.
import { readFileSync } from "node:fs";
import type { EventType, NewEvent, Payload } from "../../src/ledger/index.ts";

export const example = (name: string): NewEvent =>
  JSON.parse(readFileSync(new URL(`../fixtures/contracts/${name}.json`, import.meta.url), "utf8"));

/** An event with the examples' envelope. */
export function make<T extends EventType>(type: T, payload: Payload<T>, runId = "run-synthetic-001"): NewEvent {
  return { type, ts: "2026-11-02T10:00:00Z", runId, payload } as NewEvent;
}

/** A SpineObserved event for `id`, ordinal `ordinal`. */
export function spine(id: string, ordinal = 0): NewEvent {
  const base = example("SpineObserved") as Extract<NewEvent, { type: "SpineObserved" }>;
  return make("SpineObserved", { ...base.payload, observationId: id, ordinal });
}

export function status(
  observationId: string,
  from: Payload<"StatusChanged">["from"],
  to: Payload<"StatusChanged">["to"],
  cause?: Payload<"StatusChanged">["cause"],
): NewEvent {
  return make("StatusChanged", { observationId, from, to, ...(cause ? { cause } : {}) });
}

export function runStarted(budget: Payload<"RunStarted">["budget"], runId = "run-synthetic-001"): NewEvent {
  const base = example("RunStarted") as Extract<NewEvent, { type: "RunStarted" }>;
  return make("RunStarted", { ...base.payload, budget }, runId);
}

export function adjudication(observationId: string, tokens: number, cached = false, runId = "run-synthetic-001"): NewEvent {
  const base = example("AdjudicationRecorded") as Extract<NewEvent, { type: "AdjudicationRecorded" }>;
  return make("AdjudicationRecorded", { ...base.payload, observationId, cached, inputTokens: tokens, outputTokens: 0 }, runId);
}

/** A small synthetic run: one resolved spine, one unknown spine with a closer-photo work item, one recommendation. */
export function scenario(): NewEvent[] {
  const rec = example("RecommendationIssued");
  const revised = example("RecommendationRevised");
  return [
    example("RunStarted"),
    example("ScanSessionOpened"),
    example("ImageAssetIngested"),
    example("ImageRejected"),
    spine("obs-001", 0),
    spine("obs-002", 1),
    example("StatusChanged.first"),
    status("obs-002", null, "unresolved"),
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
