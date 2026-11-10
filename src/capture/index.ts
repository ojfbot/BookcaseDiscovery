// `capture` module: ingest of exported originals, the content-addressed image store, GPS-stripped working copies.
export const moduleName = "capture";

export { DEFAULT_MIN_PIXELS, formatTable, ingest, loadSettingsMap } from "./ingest.ts";
export type { DerivativeSignal, FileOutcome, FrameFact, IngestOptions, IngestResult, RejectReason, SettingEntry } from "./ingest.ts";
export { ingestCommand, ingestUsage, manifestCommand, manifestUsage, sessionLedgerPath } from "./cli.ts";
export { isNativeSize, lensClass, privateManifest, privateManifestPath, publicManifest, writePrivateManifest, writePublicManifest } from "./manifest.ts";
export type { LensClass, PrivateManifest, PublicManifest } from "./manifest.ts";
export type { ImageFormat } from "./working-copy.ts";
export { addSeconds, clipFrames, clipIngest, clipManifestPath, clipPath, defaultVideoTools, frameManifestPath, mergePrivateManifest, quicktimeInstant, readClipManifest, readFrameManifest, sessionCounts, VIDEO_CODECS } from "./clip.ts";
export type { ClipManifest, ClipMeta, ClipProbe, ClipRow, FrameManifest, FramesReport, StripReport, VideoTools } from "./clip.ts";
