// The working copy: the GPS-stripped, orientation-normalised copy every later stage reads (INV-12).
//
// Frame rule (conductor ruling on L-1 deviation 2): pixels are rotated per EXIF Orientation and the
// tag is cleared, so a polygon in the working copy's decoded pixels is in one frame.
//
// Two routes, both read back before the copy is accepted:
//  - exiftool, Orientation already 1: `exiftool -gps:all= -o` — lossless, pixels untouched.
//  - sips (no exiftool, or Orientation ≠ 1): decode through BMP, which sips renders with the
//    Orientation applied and which carries no metadata, then re-encode. A direct sips re-encode
//    keeps GPS and the tag (checked), so it is never used.
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import type { MetadataReader, PhotoMeta } from "./metadata.ts";

export type ImageFormat = "jpeg" | "heic";

export interface Size {
  width: number;
  height: number;
}

/** Decoded pixel size, as `sips` reports it (the stored grid, before any Orientation tag). */
export function pixelSize(path: string): Size {
  const out = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", path], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const width = Number(/pixelWidth:\s*(\d+)/.exec(out)?.[1]);
  const height = Number(/pixelHeight:\s*(\d+)/.exec(out)?.[1]);
  if (!width || !height) throw new Error(`sips could not read the pixel size of ${path}`);
  return { width, height };
}

export interface WorkingCopyResult {
  /** Path of the new file (in `tmpDir`). */
  path: string;
  /** Which route made it. */
  route: "exiftool" | "sips";
  size: Size;
}

export class WorkingCopyError extends Error {}

/** Orientation 5–8 swap width and height. */
const swaps = (orientation: number): boolean => orientation >= 5 && orientation <= 8;

function viaExiftool(src: string, dst: string): void {
  // `-gps:all=` clears the EXIF GPS group; the XMP GPS properties go too. Metadata beyond GPS is kept.
  execFileSync("exiftool", ["-q", "-gps:all=", "-xmp:gps*=", "-o", dst, src], { stdio: "pipe" });
}

function viaSips(src: string, dst: string, format: ImageFormat, tmpDir: string): void {
  const bmp = join(tmpDir, `${Math.random().toString(36).slice(2)}.bmp`);
  try {
    execFileSync("sips", ["-s", "format", "bmp", src, "--out", bmp], { stdio: "pipe" });
    const options = format === "jpeg" ? ["-s", "formatOptions", "best"] : [];
    execFileSync("sips", ["-s", "format", format, ...options, bmp, "--out", dst], { stdio: "pipe" });
  } finally {
    rmSync(bmp, { force: true });
  }
}

/**
 * Make the working copy of `src` at `dst` (which must not exist). Throws `WorkingCopyError`, and
 * leaves no file, if the read-back finds GPS, a leftover Orientation, or an unexpected size.
 */
export function makeWorkingCopy(args: {
  src: string;
  dst: string;
  tmpDir: string;
  format: ImageFormat;
  meta: PhotoMeta;
  stored: Size;
  reader: MetadataReader;
}): WorkingCopyResult {
  const { src, dst, tmpDir, format, meta, stored, reader } = args;
  const attempt = (route: "exiftool" | "sips"): WorkingCopyResult => {
    rmSync(dst, { force: true });
    if (route === "exiftool") viaExiftool(src, dst);
    else viaSips(src, dst, format, tmpDir);
    const probe = reader.probe(dst);
    if (probe.hasGps) throw new WorkingCopyError("GPS survived in the working copy");
    if (probe.orientation !== 1) throw new WorkingCopyError(`working copy has Orientation ${probe.orientation}, expected 1`);
    const size = pixelSize(dst);
    const expected = swaps(meta.orientation) ? { width: stored.height, height: stored.width } : stored;
    if (size.width !== expected.width || size.height !== expected.height)
      throw new WorkingCopyError(`working copy is ${size.width}x${size.height}, expected ${expected.width}x${expected.height}`);
    return { path: dst, route, size };
  };

  const routes: ("exiftool" | "sips")[] = reader.name === "exiftool" && meta.orientation === 1 ? ["exiftool", "sips"] : ["sips"];
  let last: unknown;
  for (const route of routes) {
    try {
      return attempt(route);
    } catch (e) {
      last = e;
      rmSync(dst, { force: true });
    }
  }
  throw new WorkingCopyError(`no working copy: ${last instanceof Error ? last.message : last}`);
}
