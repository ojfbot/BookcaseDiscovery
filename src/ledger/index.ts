// `ledger` module. Contracts and the in-memory ledger (L-1); the status machine, SQLite ledger,
// image store and replay (L-2); the live track's rules (T-0).
export const moduleName = "ledger";

export * from "./contracts.ts";
export * from "./helper-contracts.ts";
export type {
  CardView,
  Ledger,
  ObservationView,
  RecommendationView,
  RequestView,
  RunView,
  TrackView,
  ViewDump,
  WorkItemView,
} from "./ledger.ts";
export { LedgerError } from "./ledger.ts";
export { MemoryLedger } from "./memory.ts";
export type { MemoryLedgerOptions } from "./memory.ts";
export { emptyState, apply, toDump } from "./views.ts";
export type { ViewState } from "./views.ts";
export { SqliteLedger } from "./sqlite.ts";
export type { SqliteLedgerOptions } from "./sqlite.ts";
export { TRANSITIONS, checkAdjudication, checkStatusChange, countedCapReached, findTransition } from "./status.ts";
export type { Cause, CauseClass, StatusContext, Transition } from "./status.ts";
export {
  agreeingObservationCount,
  conditionKey,
  diffCards,
  nextCard,
  nextTrack,
  observationCount,
  observations,
} from "./live.ts";
export type { LiveContext } from "./live.ts";
export { ImageStore, dataRoot, sha256Hex } from "./images.ts";
export type { StoredImage } from "./images.ts";
export { diffValues, replay } from "./replay.ts";
export type { ReplayResult } from "./replay.ts";
