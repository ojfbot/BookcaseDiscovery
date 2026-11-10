// Fixture manifests (K-3). Two files per fixture, split by the OC9 boundary:
//  - the public manifest, `fixtures/<session>/manifest.json` in the repo: hashes, dimensions, setting, shelf
//    index and the derivative flag. Built from the ledger alone, so it can be rebuilt at any time. No capture
//    time, no GPS, no store, no file names, no images (`contracts/fixture-manifest.schema.json`).
//  - the private manifest, `<data root>/private/fixtures/<session>.json`: everything the public one leaves
//    out that later cards need (file names, capture instants, device, lens class, edit status). GPS is never
//    read, so it is in neither.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeFileDurable } from "../ledger/durable.ts";
import { fixtureManifestSchemaErrors } from "../ledger/schemas.ts";
import type { Ledger } from "../ledger/index.ts";
import type { FileOutcome, IngestResult } from "./ingest.ts";

export interface PublicManifest {
  schemaVersion: 1;
  session: string;
  photos: {
    hash: string;
    workingCopyHash: string;
    format: "heic" | "jpeg";
    width: number;
    height: number;
    setting: string;
    shelfIndex?: number;
    flags?: "edited-derivative"[];
  }[];
  rejected: { hash?: string; reasons: string[] }[];
}

const byHash = (a: { hash?: string }, b: { hash?: string }): number => (a.hash ?? "￿").localeCompare(b.hash ?? "￿");

/** The public manifest of `session`, from the ledger's images and rejections. Throws if it would not validate. */
export function publicManifest(ledger: Ledger, session: string): PublicManifest {
  const photos = ledger
    .images(session)
    .map((i) => ({
      hash: i.imageHash,
      workingCopyHash: i.workingCopyHash,
      format: i.format,
      width: i.width,
      height: i.height,
      setting: i.setting,
      ...(i.shelfIndex !== undefined ? { shelfIndex: i.shelfIndex } : {}),
      ...(i.flags?.length ? { flags: i.flags } : {}),
    }))
    .sort(byHash);
  const rejected = ledger
    .rejections(session)
    .map((r) => ({ ...(r.fileHash ? { hash: r.fileHash } : {}), reasons: r.reasons }))
    .sort(byHash);
  const manifest: PublicManifest = { schemaVersion: 1, session, photos, rejected };
  const errors = fixtureManifestSchemaErrors(manifest);
  if (errors.length) throw new Error(`manifest for ${session} does not validate: ${errors.join("; ")}`);
  if (!photos.length && !rejected.length) throw new Error(`manifest: the ledger has no photos for session ${session}`);
  return manifest;
}

export const stringifyManifest = (manifest: unknown): string => `${JSON.stringify(manifest, null, 2)}\n`;

export function writePublicManifest(manifest: PublicManifest, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stringifyManifest(manifest));
}

export const LENS_CLASSES = ["main", "ultra-wide", "telephoto", "unknown"] as const;
export type LensClass = (typeof LENS_CLASSES)[number];

// --- capture provenance (NS-4) -------------------------------------------------------------------------------
//
// The capture-provenance vocabulary every label row and manifest row carries (docs/dataset.md, CONTEXT.md *capture
// provenance*): which device tier and lens produced a frame or still, and how it was taken. The values come from the
// private fixture manifest (device and lens are read from EXIF at ingest) and, for a shoot that has one, from the
// capture sidecar (docs/capture-protocol.md §9), which a later ingest card writes into `provenance` below.

/** The device tier (CONTEXT.md *device tier*): what rear depth the phone has. `metric-depth` is the development and teacher side only. */
export const DEVICE_CLASSES = ["metric-depth", "relative-stereo", "none"] as const;
export type DeviceClass = (typeof DEVICE_CLASSES)[number];

/** How a frame or still was taken (CONTEXT.md *capture mode*). The two sweep modes need a case id on every row. */
export const CAPTURE_MODES = ["shopper-still", "protocol-still", "natural-sweep", "rich-session"] as const;
export type CaptureMode = (typeof CAPTURE_MODES)[number];
export const SWEEP_MODES: readonly CaptureMode[] = ["natural-sweep", "rich-session"];

/** The controlled photo settings (OC6); any other named setting is a protocol too. `real-use` (OC35) is the shopper's. */
export const PROTOCOL_SETTINGS = ["whole-12", "whole-48", "shelf-48", "overview"] as const;

/**
 * The capture mode a photo setting implies, until the capture sidecar says: `real-use` is a `shopper-still` (a handheld
 * shot the way a shopper would take it, OC35) and every controlled or otherwise named setting is a `protocol-still`.
 * A sweep is never a still, so neither sweep mode comes from a setting.
 */
export function captureModeOf(setting: string): CaptureMode {
  return setting === "real-use" ? "shopper-still" : "protocol-still";
}

/**
 * The device tier of an EXIF device string ("Apple iPhone 17 Pro"), or null when the table does not know the model:
 * the build then refuses, rather than guess, until the sidecar or this table says. The table is a heuristic over
 * Apple's model names: a numbered Pro iPhone from the 12 Pro on carries LiDAR (`metric-depth`); a numbered non-Pro
 * iPhone from the 11 on, a Plus before it and the X, XS and XS Max have two rear cameras (`relative-stereo`); the SE,
 * XR, the `e` models and the plain numbered iPhones before the 11 have one (`none`). iPads are not classed here:
 * only the 2020 and later iPad Pro has LiDAR, and the model string does not say the year.
 */
export function deviceClassOf(device: string): DeviceClass | null {
  const m = /\biPhone\s+(?:(\d{1,2})(e)?|(SE|XR|XS|X))(?:\s+(Pro|Plus|mini|Max))?(?:\s+Max)?\b/i.exec(device);
  if (!m) return null;
  const [, number, eModel, letters, suffix] = m;
  if (letters) return letters.toUpperCase() === "X" || letters.toUpperCase() === "XS" ? "relative-stereo" : "none";
  const n = Number(number);
  if (eModel) return "none";
  if (suffix?.toLowerCase() === "pro") return n >= 12 ? "metric-depth" : "relative-stereo";
  if (n >= 11) return "relative-stereo";
  return suffix?.toLowerCase() === "plus" ? "relative-stereo" : "none";
}

/**
 * Lens class from the EXIF focal length (OC35): the 35 mm equivalent when recorded (up to 18 mm ultra-wide,
 * up to 40 mm main, beyond that telephoto), else the real focal length in mm (under 4 ultra-wide, up to 8
 * main, beyond that telephoto: an iPhone's 2.2 mm / 6.8 mm / 9+ mm lenses). No focal length: `unknown`.
 */
export function lensClass(focalLengthMm?: number, focalLength35mm?: number): LensClass {
  if (focalLength35mm !== undefined) return focalLength35mm <= 18 ? "ultra-wide" : focalLength35mm <= 40 ? "main" : "telephoto";
  if (focalLengthMm !== undefined) return focalLengthMm < 4 ? "ultra-wide" : focalLengthMm <= 8 ? "main" : "telephoto";
  return "unknown";
}

/** The iPhone camera's own pixel grids: 48 MP and 12 MP, either orientation. A stored size off this grid was resampled (K-2). */
const NATIVE_SIZES = new Set(["8064x6048", "6048x8064", "4032x3024", "3024x4032"]);
export const isNativeSize = (width: number, height: number): boolean => NATIVE_SIZES.has(`${width}x${height}`);

export interface PrivateManifest {
  schemaVersion: 1;
  session: string;
  ingestedWith: { metadataReader: IngestResult["metadataReader"] };
  photos: {
    fileName: string;
    hash: string;
    workingCopyHash: string;
    format: string;
    width: number;
    height: number;
    storedWidth: number;
    storedHeight: number;
    orientation: number;
    megapixels: number;
    setting: string;
    capturedAt: string;
    device: string;
    lens: { class: LensClass; model?: string; focalLengthMm?: number; focalLength35mm?: number };
    edited: boolean;
    derivativeSignals: string[];
    /** The stored pixels are on the camera's native grid. Off it, the file was resampled even if `edited` is false (K-2: EXIF rewritten to match). */
    nativeSize: boolean;
    /**
     * NS-4, add-only: what the capture sidecar (docs/capture-protocol.md §9) says about this file, written by the ingest
     * card that reads sidecars. Absent on every manifest written before it; the dataset build then derives the device
     * class from `device` (`deviceClassOf`) and the capture mode from `setting` (`captureModeOf`), with no case id.
     */
    provenance?: { deviceClass: DeviceClass; captureMode: CaptureMode; bookcaseId?: string };
  }[];
  rejected: { fileName: string; hash?: string; reasons: string[] }[];
}

/** The private manifest of one ingest run: it carries file names and capture instants, so it never leaves `$BOOKCASE_DATA`. */
export function privateManifest(result: IngestResult): PrivateManifest {
  const photos = result.outcomes
    .filter((o): o is FileOutcome & Required<Pick<FileOutcome, "details" | "imageHash" | "workingCopyHash" | "setting" | "megapixels">> => o.verdict === "accepted")
    .map((o) => {
      const d = o.details;
      return {
        fileName: o.fileName,
        hash: o.imageHash,
        workingCopyHash: o.workingCopyHash,
        format: d.format,
        width: d.width,
        height: d.height,
        storedWidth: d.storedWidth,
        storedHeight: d.storedHeight,
        orientation: d.orientation,
        megapixels: Number(o.megapixels.toFixed(2)),
        setting: o.setting,
        capturedAt: d.capturedAt,
        device: d.device,
        lens: {
          class: lensClass(d.focalLengthMm, d.focalLength35mm),
          ...(d.lensModel ? { model: d.lensModel } : {}),
          ...(d.focalLengthMm !== undefined ? { focalLengthMm: d.focalLengthMm } : {}),
          ...(d.focalLength35mm !== undefined ? { focalLength35mm: d.focalLength35mm } : {}),
        },
        edited: o.derivativeSignals.length > 0,
        derivativeSignals: o.derivativeSignals,
        // A frame (NS-K frame mode) is native when it is on its clip's grid; a still, when it is on the camera's.
        nativeSize: d.nativeSize ?? isNativeSize(d.storedWidth, d.storedHeight),
        ...(d.provenance ? { provenance: d.provenance } : {}),
      };
    });
  const rejected = result.outcomes
    .filter((o) => o.verdict === "rejected")
    .map((o) => ({ fileName: o.fileName, ...(o.imageHash ? { hash: o.imageHash } : {}), reasons: o.reasons }));
  return { schemaVersion: 1, session: result.session, ingestedWith: { metadataReader: result.metadataReader }, photos, rejected };
}

/** `<data root>/private/fixtures/<session>.json` */
export const privateManifestPath = (dataDir: string, session: string): string => join(dataDir, "private", "fixtures", `${session}.json`);

export function writePrivateManifest(dataDir: string, manifest: PrivateManifest): string {
  const path = privateManifestPath(dataDir, manifest.session);
  mkdirSync(dirname(path), { recursive: true });
  // Ingest facts (file names, capture instants): nothing rebuilds them, so the write is atomic and durable (DL-1).
  writeFileDurable(path, stringifyManifest(manifest), { mode: 0o600 });
  return path;
}
