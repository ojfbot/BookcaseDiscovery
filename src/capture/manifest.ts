// Fixture manifests (K-3). Two files per fixture, split by the OC9 boundary:
//  - the public manifest, `fixtures/<session>/manifest.json` in the repo: hashes, dimensions, setting, shelf
//    index and the derivative flag. Built from the ledger alone, so it can be rebuilt at any time. No capture
//    time, no GPS, no store, no file names, no images (`contracts/fixture-manifest.schema.json`).
//  - the private manifest, `<data root>/private/fixtures/<session>.json`: everything the public one leaves
//    out that later cards need (file names, capture instants, device, lens class, edit status). GPS is never
//    read, so it is in neither.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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

export type LensClass = "ultra-wide" | "main" | "telephoto" | "unknown";

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
        nativeSize: isNativeSize(d.storedWidth, d.storedHeight),
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
  writeFileSync(path, stringifyManifest(manifest), { mode: 0o600 });
  return path;
}
