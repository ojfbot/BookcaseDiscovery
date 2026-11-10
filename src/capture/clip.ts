// Clips (NS-K, video): a folder of camera clips in, audio-free clips and selected frames out.
//
//   clipIngest   per clip: hash the untouched original (INV-12), read its facts with exiftool and AVFoundation, write
//                the audio-free copy (helpers/video/strip-audio.swift: passthrough, no re-encode) to
//                `<data root>/video/sha256/<aa>/<hash>.mov`, keyed by the audio-free copy's hash, verify it (no audio
//                track, the same video sample count and duration), and add one row to the private clip manifest.
//   clipFrames   per audio-free clip: the sharpest frame in each window (helpers/video/frames.py, OpenCV), entered into
//                the image store through ingest's frame mode, with the frame lineage in the private frame manifest.
//
// Both manifests live under `<data root>/private/fixtures/<session>/` (a fact folder in DL-6's backup classes), beside
// the private fixture manifest. They hold file names, capture instants and the permission note, so they never leave
// the data root; the repo sees counts only. No ledger event describes a clip (contracts/ is owner-gated): a clip's
// facts are in its manifest, and its frames reach the ledger as ordinary `ImageAssetIngested` events.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, realpathSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileDurable } from "../ledger/durable.ts";
import { makeStamp, writeLineage } from "../ledger/lineage.ts";
import type { Ledger } from "../ledger/index.ts";
import { ingest } from "./ingest.ts";
import type { FrameFact, IngestResult } from "./ingest.ts";
import { deviceClassOf, privateManifest, privateManifestPath, stringifyManifest, writePrivateManifest } from "./manifest.ts";
import type { DeviceClass, PrivateManifest } from "./manifest.ts";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const STRIP_HELPER = join(REPO_ROOT, "helpers", "video", "strip-audio.swift");
export const FRAMES_HELPER = join(REPO_ROOT, "helpers", "video", "frames.py");
/** The Python environment the frame helper runs in: numpy and opencv-python 4.10.0.84, nothing else. */
export const FRAMES_ENV = join(REPO_ROOT, "helpers", "coverage");

/** H.264 and HEVC, by their QuickTime sample-description codes. Anything else is refused. */
export const VIDEO_CODECS: Record<string, "h264" | "hevc"> = { avc1: "h264", avc3: "h264", hvc1: "hevc", hev1: "hevc" };
const CLIP_EXT = /\.(mov|mp4|m4v)$/i;

export type ClipRefusal = "no-video-track" | "unsupported-codec" | "no-capture-time" | "zero-byte" | "location-tag";

export interface TrackInfo {
  trackId: number;
  /** AVFoundation's media type: `vide`, `soun`, `meta`, ... */
  mediaType: string;
  codecs: string[];
  samples: number;
  durationSeconds: number;
  width?: number;
  height?: number;
  nominalFrameRate?: number;
}

export interface ClipProbe {
  durationSeconds: number;
  tracks: TrackInfo[];
}

export interface StripReport {
  dropped: number[];
  copied: { trackId: number; mediaType: string; samples: number }[];
  associations: number;
}

/** What exiftool says about a clip. Never printed; the capture instant and device go to the private manifest. */
export interface ClipMeta {
  make?: string;
  model?: string;
  /** QuickTime `CreationDate` (the camera's local time with its offset), as ISO 8601. */
  capturedAt?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  frameRate?: number;
  rotation?: number;
  /** Any GPS or location tag, in any group. Tested for presence only, never read. */
  hasLocation: boolean;
}

export interface FrameRow {
  file: string;
  window: number;
  frameIndex: number;
  timestampSeconds: number;
  sharpness: number;
  windowMedianSharpness: number;
  windowFrames: number;
}

export interface FramesReport {
  extractor: { name: string; version: number; opencv: string; backend: string };
  parameters: Record<string, unknown>;
  decodedFrames: number;
  nominalFps: number;
  width: number;
  height: number;
  frames: FrameRow[];
}

/** The external tools a clip passes through; swapped for fakes in tests. */
export interface VideoTools {
  probe(path: string): ClipProbe;
  strip(src: string, dst: string): StripReport;
  meta(path: string): ClipMeta;
  frames(clip: string, outDir: string, rate: number): FramesReport;
}

/** `YYYY:MM:DD HH:MM:SS[.f]±HH:MM` (QuickTime CreationDate) → ISO 8601. No offset: null (the instant is unknown). */
export function quicktimeInstant(value: string | undefined): string | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value?.trim() ?? "");
  if (!m || m[1] === "0000") return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ?? ""}${m[8]}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** `instant` plus `seconds`, written in `instant`'s own offset, to the millisecond. */
export function addSeconds(instant: string, seconds: number): string {
  const zone = /(Z|[+-]\d{2}:\d{2})$/.exec(instant)?.[1];
  if (!zone) throw new Error(`addSeconds: no offset in "${instant}"`);
  const offsetMin = zone === "Z" ? 0 : (zone[0] === "-" ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)));
  const ms = Date.parse(instant) + Math.round(seconds * 1000);
  const local = new Date(ms + offsetMin * 60_000).toISOString(); // the wall clock in that offset, labelled Z
  return local.replace(/Z$/, zone);
}

function swift(args: string[]): string {
  return execFileSync("swift", ["-suppress-warnings", STRIP_HELPER, ...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

export function defaultVideoTools(): VideoTools {
  return {
    probe: (path) => JSON.parse(swift(["probe", path])) as ClipProbe,
    strip: (src, dst) => JSON.parse(swift(["strip", src, dst])) as StripReport,
    meta(path) {
      const run = (args: string[]) => execFileSync("exiftool", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
      const r = (JSON.parse(run(["-json", "-n", "-Make", "-Model", "-CreationDate", "-Duration", "-ImageWidth", "-ImageHeight", "-VideoFrameRate", "-Rotation", path])) as Record<string, unknown>[])[0] ?? {};
      const located = run(["-ee", "-a", "-s3", "-G1", "-*GPS*", "-*Location*", path]).trim();
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
      const str = (v: unknown) => (v === undefined || v === null || String(v).trim() === "" ? undefined : String(v).trim());
      return {
        make: str(r.Make),
        model: str(r.Model),
        capturedAt: quicktimeInstant(str(r.CreationDate)) ?? undefined,
        durationSeconds: num(r.Duration),
        width: num(r.ImageWidth),
        height: num(r.ImageHeight),
        frameRate: num(r.VideoFrameRate),
        rotation: num(r.Rotation),
        hasLocation: located.length > 0,
      };
    },
    frames(clip, outDir, rate) {
      const out = execFileSync(
        "uv",
        ["run", "--frozen", "--offline", "--project", FRAMES_ENV, "python", "-I", FRAMES_HELPER, clip, outDir, "--rate", String(rate)],
        { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
      );
      return JSON.parse(out) as FramesReport;
    },
  };
}

export function sha256OfFile(path: string): string {
  const hash = createHash("sha256");
  const buf = Buffer.alloc(8 * 1024 * 1024);
  const fd = openSync(path, "r");
  try {
    for (let n; (n = readSync(fd, buf, 0, buf.length, null)) > 0; ) hash.update(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

// --- the clip store and the private manifests --------------------------------------------------------------------

/** `<data root>/video/sha256/<aa>/<hash>.mov`: one level of fan-out (a session has tens of clips, not thousands). */
export const clipPath = (dataDir: string, hash: string): string => join(dataDir, "video", "sha256", hash.slice(0, 2), `${hash}.mov`);
export const clipManifestPath = (dataDir: string, session: string): string => join(dataDir, "private", "fixtures", session, "clips.json");
export const frameManifestPath = (dataDir: string, session: string): string => join(dataDir, "private", "fixtures", session, "frames.json");

export const CLIP_MANIFEST_VERSION = 1;
export const FRAME_MANIFEST_VERSION = 1;
/** The frame manifest's file class in its lineage stamp (DL-3). */
export const FRAME_MANIFEST_SCHEMA = { name: "clip-frames", version: FRAME_MANIFEST_VERSION } as const;

export interface TrackSummary {
  mediaType: string;
  codecs: string[];
  samples: number;
}

export interface ClipRow {
  fileName: string;
  /** SHA-256 of the untouched original (with its audio). */
  originalHash: string;
  /** SHA-256 of the audio-free copy: the clip's key in `video/`. */
  hash: string;
  originalBytes: number;
  bytes: number;
  durationSeconds: number;
  frameRate: number;
  width: number;
  height: number;
  rotation: number;
  codec: "h264" | "hevc";
  videoSamples: number;
  tracksBefore: TrackSummary[];
  tracksAfter: TrackSummary[];
  /** The metadata tracks survived the copy (else the copy is video alone; logged as a deviation). */
  metadataTracksKept: boolean;
  device: string;
  deviceClass: DeviceClass | null;
  /** The stock Camera app's default session (CONTEXT.md *rich session*: a default session keeps what INV-22 allows). */
  captureMode: "default-session";
  /** The camera chose the lens; a clip's metadata does not name it. */
  lens: "camera-picked";
  capturedAt: string;
  /** One private case label per clip. */
  bookcaseId: string;
  /** The case map is an assumption: the owner gave none, so each clip is taken to show one case. */
  caseIdSource: "assumed-per-clip";
  permission?: string;
  ingestedAt: string;
}

export interface ClipManifest {
  schemaVersion: typeof CLIP_MANIFEST_VERSION;
  session: string;
  clips: ClipRow[];
  refused: { fileName: string; hash?: string; reasons: ClipRefusal[] }[];
}

export interface FrameManifestRow {
  /** SHA-256 of the frame JPEG: its image hash and its working-copy hash. */
  frameHash: string;
  fileName: string;
  window: number;
  frameIndex: number;
  timestampSeconds: number;
  sharpness: number;
  windowMedianSharpness: number;
  windowFrames: number;
}

export interface FrameManifestClip {
  /** The audio-free clip the frames came from, and its original. */
  clipHash: string;
  originalHash: string;
  bookcaseId: string;
  extractor: FramesReport["extractor"];
  parameters: FramesReport["parameters"];
  decodedFrames: number;
  /** The decoder saw every video sample the container holds. */
  decodedAllSamples: boolean;
  width: number;
  height: number;
  extractedAt: string;
  frames: FrameManifestRow[];
}

export interface FrameManifest {
  schemaVersion: typeof FRAME_MANIFEST_VERSION;
  session: string;
  clips: FrameManifestClip[];
}

function readJson<T>(path: string): T | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null;
}

export const readClipManifest = (dataDir: string, session: string): ClipManifest | null => readJson<ClipManifest>(clipManifestPath(dataDir, session));
export const readFrameManifest = (dataDir: string, session: string): FrameManifest | null => readJson<FrameManifest>(frameManifestPath(dataDir, session));

/** Durable, owner-only: these facts are not rebuilt from anything (DL-1). */
function writePrivate(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileDurable(path, stringifyManifest(value), { mode: 0o600 });
}

const summary = (tracks: TrackInfo[]): TrackSummary[] => tracks.map((t) => ({ mediaType: t.mediaType, codecs: t.codecs, samples: t.samples }));
const videoTrack = (p: ClipProbe): TrackInfo | undefined => p.tracks.find((t) => t.mediaType === "vide");

// --- clip ingest -------------------------------------------------------------------------------------------------

export interface ClipIngestOptions {
  folder: string;
  session: string;
  dataDir: string;
  tools?: VideoTools;
  /** The store-permission note for every clip this run adds (private manifest only). */
  permission?: string;
  now?: () => Date;
}

export interface ClipOutcome {
  verdict: "stored" | "skipped" | "refused";
  reasons: ClipRefusal[];
  row?: ClipRow;
}

export interface ClipIngestResult {
  session: string;
  outcomes: ClipOutcome[];
  manifest: ClipManifest;
}

/** Durations equal to the millisecond: the container's timescale is finer, and passthrough keeps every sample time. */
const sameDuration = (a: number, b: number): boolean => Math.abs(a - b) < 0.001;

export function clipIngest(options: ClipIngestOptions): ClipIngestResult {
  const { session, dataDir } = options;
  const tools = options.tools ?? defaultVideoTools();
  const now = options.now ?? (() => new Date());
  const src = realpathSync(resolve(options.folder));
  if (!statSync(src).isDirectory()) throw new Error(`clip ingest: ${options.folder} is not a folder`);
  const videoRoot = join(dataDir, "video");
  mkdirSync(videoRoot, { recursive: true });
  if (!relative(src, realpathSync(videoRoot)).startsWith("..")) throw new Error("clip ingest: the data root is inside the source folder; the source is never written to");

  const manifest: ClipManifest = readClipManifest(dataDir, session) ?? { schemaVersion: CLIP_MANIFEST_VERSION, session, clips: [], refused: [] };
  if (manifest.schemaVersion !== CLIP_MANIFEST_VERSION) throw new Error(`clip ingest: the clip manifest of ${session} is version ${manifest.schemaVersion}, this code writes ${CLIP_MANIFEST_VERSION}`);
  const seen = new Set([...manifest.clips.map((c) => c.originalHash), ...manifest.refused.flatMap((r) => (r.hash ? [r.hash] : []))]);

  const names = readdirSync(src, { withFileTypes: true }).filter((d) => d.isFile() && !d.name.startsWith(".") && CLIP_EXT.test(d.name)).map((d) => d.name).sort();
  const outcomes: ClipOutcome[] = [];
  const tmp = mkdtempSync(join(videoRoot, ".ingest-"));
  try {
    for (const fileName of names) {
      const path = join(src, fileName);
      const refuse = (reasons: ClipRefusal[], hash?: string): void => {
        manifest.refused.push({ fileName, ...(hash ? { hash } : {}), reasons });
        outcomes.push({ verdict: "refused", reasons });
      };
      if (statSync(path).size === 0) {
        if (!manifest.refused.some((r) => r.fileName === fileName && !r.hash)) refuse(["zero-byte"]);
        else outcomes.push({ verdict: "skipped", reasons: [] });
        continue;
      }
      // INV-12: the untouched original is hashed before anything else reads it.
      const originalHash = sha256OfFile(path);
      if (seen.has(originalHash)) {
        outcomes.push({ verdict: "skipped", reasons: [] });
        continue;
      }
      seen.add(originalHash);

      const before = tools.probe(path);
      const video = videoTrack(before);
      if (!video) {
        refuse(["no-video-track"], originalHash);
        continue;
      }
      const codec = video.codecs.map((c) => VIDEO_CODECS[c]).find(Boolean);
      if (!codec) {
        refuse(["unsupported-codec"], originalHash);
        continue;
      }
      const meta = tools.meta(path);
      if (!meta.capturedAt) {
        refuse(["no-capture-time"], originalHash);
        continue;
      }

      const out = join(tmp, `${originalHash}.mov`);
      const report = tools.strip(path, out);
      if (sha256OfFile(path) !== originalHash) throw new Error(`clip ingest: ${fileName} changed while it was being read`);
      const after = tools.probe(out);
      const afterVideo = videoTrack(after);
      if (after.tracks.some((t) => t.mediaType === "soun")) throw new Error(`clip ingest: ${fileName}: the copy still has an audio track`);
      if (!afterVideo || afterVideo.samples !== video.samples) throw new Error(`clip ingest: ${fileName}: the copy has ${afterVideo?.samples ?? 0} video samples, the original ${video.samples}`);
      if (!sameDuration(after.durationSeconds, before.durationSeconds)) throw new Error(`clip ingest: ${fileName}: the copy lasts ${after.durationSeconds} s, the original ${before.durationSeconds} s`);
      if (report.copied.find((c) => c.mediaType === "vide")?.samples !== video.samples) throw new Error(`clip ingest: ${fileName}: the helper copied a different number of video samples`);
      const outMeta = tools.meta(out);
      if (outMeta.hasLocation) {
        rmSync(out, { force: true });
        refuse(["location-tag"], originalHash);
        continue;
      }

      const hash = sha256OfFile(out);
      const dest = clipPath(dataDir, hash);
      mkdirSync(dirname(dest), { recursive: true });
      if (!existsSync(dest)) {
        chmodSync(out, 0o444);
        renameSync(out, dest);
      } else rmSync(out, { force: true });

      const metaBefore = before.tracks.filter((t) => t.mediaType === "meta").length;
      const device = [meta.make, meta.model].filter(Boolean).join(" ");
      const row: ClipRow = {
        fileName,
        originalHash,
        hash,
        originalBytes: statSync(path).size,
        bytes: statSync(dest).size,
        durationSeconds: before.durationSeconds,
        frameRate: video.nominalFrameRate ?? meta.frameRate ?? 0,
        width: video.width ?? meta.width ?? 0,
        height: video.height ?? meta.height ?? 0,
        rotation: meta.rotation ?? 0,
        codec,
        videoSamples: video.samples,
        tracksBefore: summary(before.tracks),
        tracksAfter: summary(after.tracks),
        metadataTracksKept: after.tracks.filter((t) => t.mediaType === "meta").length === metaBefore,
        device,
        deviceClass: deviceClassOf(device),
        captureMode: "default-session",
        lens: "camera-picked",
        capturedAt: meta.capturedAt,
        bookcaseId: `clip-${manifest.clips.length + 1}`,
        caseIdSource: "assumed-per-clip",
        ...(options.permission ? { permission: options.permission } : {}),
        ingestedAt: now().toISOString(),
      };
      manifest.clips.push(row);
      outcomes.push({ verdict: "stored", reasons: [], row });
      // Written after every clip, so a crash loses at most the clip in hand (its copy is re-made on the next run).
      writePrivate(clipManifestPath(dataDir, session), manifest);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  writePrivate(clipManifestPath(dataDir, session), manifest);
  return { session, outcomes, manifest };
}

// --- frames ------------------------------------------------------------------------------------------------------

export interface ClipFramesOptions {
  session: string;
  dataDir: string;
  ledger: Ledger;
  rate?: number;
  tools?: VideoTools;
  now?: () => Date;
  /** Passed to ingest: `false` forces the native metadata reader (tests). */
  useExiftool?: boolean;
}

export interface ClipFramesResult {
  session: string;
  clipsDone: number;
  clipsSkipped: number;
  framesKept: number;
  ingest: IngestResult | null;
  manifest: FrameManifest;
}

const pad = (n: number) => String(n).padStart(6, "0");

export function clipFrames(options: ClipFramesOptions): ClipFramesResult {
  const { session, dataDir, ledger } = options;
  const rate = options.rate ?? 1;
  const tools = options.tools ?? defaultVideoTools();
  const now = options.now ?? (() => new Date());
  const clips = readClipManifest(dataDir, session);
  if (!clips?.clips.length) throw new Error(`clip frames: session ${session} has no ingested clips (run \`bookcase clip ingest\` first)`);
  const manifest: FrameManifest = readFrameManifest(dataDir, session) ?? { schemaVersion: FRAME_MANIFEST_VERSION, session, clips: [] };
  if (manifest.schemaVersion !== FRAME_MANIFEST_VERSION) throw new Error(`clip frames: the frame manifest of ${session} is version ${manifest.schemaVersion}, this code writes ${FRAME_MANIFEST_VERSION}`);
  const done = new Set(manifest.clips.map((c) => c.clipHash));
  const inLedger = new Set(ledger.images(session).map((i) => i.imageHash));

  const imagesDir = join(dataDir, "images");
  mkdirSync(imagesDir, { recursive: true });
  const work = mkdtempSync(join(imagesDir, ".frames-"));
  const batch = join(work, "batch");
  mkdirSync(batch);
  const facts: Record<string, FrameFact> = {};
  const pending: { clip: ClipRow; report: FramesReport; rows: FrameManifestRow[] }[] = [];
  let clipsSkipped = 0;
  let result: IngestResult | null = null;
  try {
    for (const clip of clips.clips) {
      if (done.has(clip.hash)) {
        clipsSkipped++;
        continue;
      }
      const file = clipPath(dataDir, clip.hash);
      if (!existsSync(file) || sha256OfFile(file) !== clip.hash) throw new Error(`clip frames: the audio-free copy of ${clip.bookcaseId} is missing or changed`);
      const out = join(work, clip.hash);
      const report = tools.frames(file, out, rate);
      const rows: FrameManifestRow[] = [];
      for (const f of report.frames) {
        const fileName = `${clip.bookcaseId}-frame-${pad(f.frameIndex)}.jpg`;
        const frameHash = sha256OfFile(join(out, f.file));
        rows.push({ frameHash, fileName, window: f.window, frameIndex: f.frameIndex, timestampSeconds: f.timestampSeconds, sharpness: f.sharpness, windowMedianSharpness: f.windowMedianSharpness, windowFrames: f.windowFrames });
        // A frame already in the ledger (a run that stopped after ingest) is not entered twice.
        if (inLedger.has(frameHash)) continue;
        renameSync(join(out, f.file), join(batch, fileName));
        facts[fileName] = {
          capturedAt: addSeconds(clip.capturedAt, f.timestampSeconds),
          device: clip.device,
          nativeSize: report.width === clip.width && report.height === clip.height,
          // A pass of the stock camera over a case, uncoached: a natural sweep (CONTEXT.md), one assumed case per clip.
          ...(clip.deviceClass ? { provenance: { deviceClass: clip.deviceClass, captureMode: "natural-sweep" as const, bookcaseId: clip.bookcaseId } } : {}),
        };
      }
      pending.push({ clip, report, rows });
    }

    if (Object.keys(facts).length) {
      result = ingest({ folder: batch, session, ledger, dataDir, frames: facts, useExiftool: options.useExiftool, now, runId: `clip-frames-${now().toISOString()}` });
      const refused = result.outcomes.filter((o) => o.verdict !== "accepted");
      if (refused.length) throw new Error(`clip frames: ${refused.length} frame(s) were refused by ingest (${[...new Set(refused.flatMap((o) => o.reasons))].join(", ")})`);
      mergePrivateManifest(dataDir, privateManifest(result));
    }
    for (const { clip, report, rows } of pending) {
      manifest.clips.push({
        clipHash: clip.hash,
        originalHash: clip.originalHash,
        bookcaseId: clip.bookcaseId,
        extractor: report.extractor,
        parameters: report.parameters,
        decodedFrames: report.decodedFrames,
        decodedAllSamples: report.decodedFrames === clip.videoSamples,
        width: report.width,
        height: report.height,
        extractedAt: now().toISOString(),
        frames: rows,
      });
    }
    const path = frameManifestPath(dataDir, session);
    writePrivate(path, manifest);
    writeLineage(path, makeStamp({ schema: FRAME_MANIFEST_SCHEMA }, now()));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  const framesKept = pending.reduce((n, p) => n + p.rows.length, 0);
  return { session, clipsDone: pending.length, clipsSkipped, framesKept, ingest: result, manifest };
}

/** Add this run's photos to the session's private fixture manifest (frames arrive clip by clip, run by run). */
export function mergePrivateManifest(dataDir: string, fresh: PrivateManifest): string {
  const old = readJson<PrivateManifest>(privateManifestPath(dataDir, fresh.session));
  if (!old) return writePrivateManifest(dataDir, fresh);
  const have = new Set(old.photos.map((p) => p.hash));
  return writePrivateManifest(dataDir, {
    ...old,
    photos: [...old.photos, ...fresh.photos.filter((p) => !have.has(p.hash))],
    rejected: [...old.rejected, ...fresh.rejected],
  });
}

// --- counts (the report in docs/ingest.md) -----------------------------------------------------------------------

const quantile = (sorted: number[], q: number): number => {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
};

export interface SessionCounts {
  session: string;
  clips: number;
  refused: number;
  durationSeconds: number;
  /** Clips whose copy has no audio track, and the same video sample count. */
  audioFree: number;
  samplesEqual: number;
  metadataTracksKept: number;
  tracksBefore: Record<string, number>;
  tracksAfter: Record<string, number>;
  codecs: Record<string, number>;
  frameRates: number[];
  sizes: Record<string, number>;
  deviceClasses: Record<string, number>;
  originalBytes: number;
  clipBytes: number;
  framesKept: number;
  frameBytes: number;
  clipsWithFrames: number;
  decodedAllSamples: number;
  decoders: Record<string, number>;
  sharpness: { p10: number; p25: number; median: number; p75: number; p90: number; min: number; max: number } | null;
  /** The kept frame's sharpness over its window's median. */
  gainOverMedian: { p10: number; median: number; p90: number } | null;
}

const tally = (values: string[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
};

/** Counts only: nothing here names a clip, a frame, a time or a place. */
export function sessionCounts(dataDir: string, session: string, findFrame: (hash: string) => string | undefined): SessionCounts {
  const clips = readClipManifest(dataDir, session);
  if (!clips) throw new Error(`clip report: session ${session} has no clip manifest`);
  const frames = readFrameManifest(dataDir, session);
  const kept = frames?.clips.flatMap((c) => c.frames) ?? [];
  const s = kept.map((f) => f.sharpness).sort((a, b) => a - b);
  const g = kept.filter((f) => f.windowMedianSharpness > 0).map((f) => f.sharpness / f.windowMedianSharpness).sort((a, b) => a - b);
  const r = (v: number) => Number(v.toFixed(2));
  return {
    session,
    clips: clips.clips.length,
    refused: clips.refused.length,
    durationSeconds: r(clips.clips.reduce((n, c) => n + c.durationSeconds, 0)),
    audioFree: clips.clips.filter((c) => !c.tracksAfter.some((t) => t.mediaType === "soun")).length,
    samplesEqual: clips.clips.filter((c) => c.tracksAfter.find((t) => t.mediaType === "vide")?.samples === c.videoSamples).length,
    metadataTracksKept: clips.clips.filter((c) => c.metadataTracksKept).length,
    tracksBefore: tally(clips.clips.flatMap((c) => c.tracksBefore.map((t) => `${t.mediaType}:${t.codecs.join("+")}`))),
    tracksAfter: tally(clips.clips.flatMap((c) => c.tracksAfter.map((t) => `${t.mediaType}:${t.codecs.join("+")}`))),
    codecs: tally(clips.clips.map((c) => c.codec)),
    frameRates: [...new Set(clips.clips.map((c) => Number(c.frameRate.toFixed(2))))].sort((a, b) => a - b),
    sizes: tally(clips.clips.map((c) => `${c.width}x${c.height}`)),
    deviceClasses: tally(clips.clips.map((c) => c.deviceClass ?? "unknown")),
    originalBytes: clips.clips.reduce((n, c) => n + c.originalBytes, 0),
    clipBytes: clips.clips.reduce((n, c) => n + c.bytes, 0),
    framesKept: kept.length,
    frameBytes: kept.reduce((n, f) => {
      const p = findFrame(f.frameHash);
      return n + (p ? statSync(p).size : 0);
    }, 0),
    clipsWithFrames: frames?.clips.length ?? 0,
    decodedAllSamples: frames?.clips.filter((c) => c.decodedAllSamples).length ?? 0,
    decoders: tally(frames?.clips.map((c) => `opencv ${c.extractor.opencv} ${c.extractor.backend}`) ?? []),
    sharpness: s.length ? { p10: r(quantile(s, 0.1)), p25: r(quantile(s, 0.25)), median: r(quantile(s, 0.5)), p75: r(quantile(s, 0.75)), p90: r(quantile(s, 0.9)), min: r(s[0]!), max: r(s.at(-1)!) } : null,
    gainOverMedian: g.length ? { p10: r(quantile(g, 0.1)), median: r(quantile(g, 0.5)), p90: r(quantile(g, 0.9)) } : null,
  };
}
