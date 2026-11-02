// The Ledger interface every module writes through (ADR §1). L-1 ships the in-memory
// implementation (`memory.ts`); L-2 adds SQLite behind the same interface.
import type { LedgerEvent, NewEvent, Payload, Status } from "./contracts.ts";

/** One spine and everything the ledger knows about it. Observation, hypothesis and band stay separate (INV-3). */
export interface ObservationView {
  observationId: string;
  spine: Payload<"SpineObserved">;
  /** Every OCR variant, in the order observed. */
  texts: Payload<"TextObserved">[];
  /** The most recent proposal. */
  hypotheses: Payload<"HypothesesProposed"> | null;
  adjudications: Payload<"AdjudicationRecorded">[];
  /** The most recent band. */
  band: Payload<"BandAssigned"> | null;
  /** The most recent status. */
  status: Status | null;
  corrections: Payload<"IdentityCorrected">["correction"][];
}

export interface WorkItemView {
  workItemId: string;
  opened: Payload<"WorkItemOpened">;
  /** Null while open. */
  resolution: Payload<"WorkItemClosed">["resolution"] | null;
}

export interface RecommendationView {
  recommendationId: string;
  rankingVersion: string;
  current: Payload<"RecommendationIssued">["recommendation"];
  /** How many times it has been revised (INV-21). */
  revisions: number;
}

/** A plain, ordered dump of every view; equal dumps mean equal state. Replay is checked on this. */
export interface ViewDump {
  images: Payload<"ImageAssetIngested">[];
  rejections: Payload<"ImageRejected">[];
  observations: ObservationView[];
  workItems: WorkItemView[];
  recommendations: RecommendationView[];
}

export interface Ledger {
  /**
   * Validate and store an event; returns it with its `seq`. Rejects (throws) an event that fails its
   * contract, or that names an observation, work item or recommendation the ledger has not seen.
   * The ledger never stamps time: `ts` is the emitter's, so replay is deterministic.
   */
  append(event: NewEvent): LedgerEvent;
  /** Events with `seq` greater than `after` (default 0: all), oldest first. */
  events(after?: number): Iterable<LedgerEvent>;
  /** `seq` of the newest event; 0 when empty. */
  lastSeq(): number;

  observation(observationId: string): ObservationView | undefined;
  observations(filter?: { sessionId?: string; imageHash?: string }): ObservationView[];
  workItems(filter?: { open?: boolean }): WorkItemView[];
  recommendations(): RecommendationView[];
  images(sessionId?: string): Payload<"ImageAssetIngested">[];
  rejections(sessionId?: string): Payload<"ImageRejected">[];

  viewDump(): ViewDump;
}

/** Thrown by `append` when an event is refused. */
export class LedgerError extends Error {}
