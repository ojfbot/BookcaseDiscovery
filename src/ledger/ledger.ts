// The Ledger interface every module writes through (ADR §1). L-1 ships the in-memory
// implementation (`memory.ts`); L-2 adds SQLite (`sqlite.ts`) behind the same interface.
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

/** One run and what it has spent so far (INV-2). */
export interface RunView {
  runId: string;
  started: Payload<"RunStarted">;
  /** Counted from `AdjudicationRecorded` events of this run that were not cache hits. */
  usage: { adjudications: number; inputTokens: number; outputTokens: number };
  /** Null while the run is open. */
  finished: Payload<"RunFinished"> | null;
}

/** One live track and where it stands (S9). */
export interface TrackView {
  trackId: string;
  /** The latest `Track` edge. */
  current: Payload<"Track">;
  /** Whether it has ever been `stable`; a track lost before that is not resumed. */
  reachedStable: boolean;
}

/** One live card and its history in brief (INV-21). */
export interface CardView {
  cardId: string;
  current: Payload<"CardProposed">["card"];
  status: "active" | "retracted";
  /** How many `CardRevised` events it has had. */
  revisions: number;
  /** `seq` of each revision that can still be undone, oldest first; undo takes the last. */
  undoable: number[];
}

/** One live adjudication request and whether it has been answered. */
export interface RequestView {
  requestId: string;
  requested: Payload<"AdjudicationRequested">;
  answered: boolean;
}

/** A plain, ordered dump of every view; equal dumps mean equal state. Replay is checked on this. */
export interface ViewDump {
  images: Payload<"ImageAssetIngested">[];
  rejections: Payload<"ImageRejected">[];
  observations: ObservationView[];
  workItems: WorkItemView[];
  recommendations: RecommendationView[];
  runs: RunView[];
  tracks: TrackView[];
  cards: CardView[];
  adjudicationRequests: RequestView[];
}

export interface Ledger {
  /**
   * Validate and store an event; returns it with its `seq`. Rejects (throws) an event that fails its
   * contract, or that names an observation, work item, recommendation or run the ledger has not seen,
   * or that breaks the status machine or a run's budget (`status.ts`). A refused event leaves the
   * ledger unchanged. The ledger never stamps time: `ts` is the emitter's, so replay is deterministic.
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
  run(runId: string): RunView | undefined;
  runs(): RunView[];
  /** Live tracks in the order they were born. */
  tracks(): TrackView[];
  /** Live cards in the order they were proposed. */
  cards(): CardView[];
  /** Live adjudication requests in the order they were made. */
  adjudicationRequests(): RequestView[];
  images(sessionId?: string): Payload<"ImageAssetIngested">[];
  rejections(sessionId?: string): Payload<"ImageRejected">[];

  viewDump(): ViewDump;
}

/** Thrown by `append` when an event is refused. */
export class LedgerError extends Error {}
