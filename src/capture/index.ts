// `capture` module: ingest of exported originals, the content-addressed image store, GPS-stripped working copies.
export const moduleName = "capture";

export { DEFAULT_MIN_PIXELS, formatTable, ingest, loadSettingsMap } from "./ingest.ts";
export type { DerivativeSignal, FileOutcome, IngestOptions, IngestResult, RejectReason, SettingEntry } from "./ingest.ts";
export { ingestCommand, ingestUsage } from "./cli.ts";
export { ImageStore, dataRoot, sha256File } from "./store.ts";
export type { ImageFormat } from "./store.ts";
