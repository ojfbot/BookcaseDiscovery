// Synthetic photos for tests, generated in a temp dir with sips + exiftool. Nothing image-like is committed.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

export const toolsAvailable = (): boolean => {
  try {
    execFileSync("exiftool", ["-ver"], { stdio: "pipe" });
    execFileSync("sips", ["--help"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
};

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Buffer): number => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer): Buffer => {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
};

/** An RGB PNG whose pixel at (x, y) is `color(x, y)`. */
export function png(width: number, height: number, color: (x: number, y: number) => [number, number, number]): Buffer {
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const o = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) rows.set(color(x, y), o + 1 + x * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n", "latin1"), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

export const RED: [number, number, number] = [255, 0, 0];
export const BLUE: [number, number, number] = [0, 0, 255];
/** Red top-left quadrant on blue: any rotation or flip moves the red corner. */
export const quadrant = (w: number, h: number) => (x: number, y: number) => (x < w / 2 && y < h / 2 ? RED : BLUE);

export interface PhotoSpec {
  width: number;
  height: number;
  format?: "jpeg" | "heic";
  /** Camera EXIF; `false` leaves the file with no EXIF at all. */
  exif?: false | { make?: string; model?: string; dateTimeOriginal?: string; offset?: string; software?: string };
  orientation?: number;
  gps?: boolean;
  /** Override the EXIF pixel size (to model a re-rendered derivative). */
  exifSize?: [number, number];
}

const FAKE_GPS = ["-GPSLatitude=1", "-GPSLatitudeRef=N", "-GPSLongitude=2", "-GPSLongitudeRef=E", "-XMP-exif:GPSLatitude=1,0N"];

// A HEIC keeps its orientation in the container (`irot`), not in EXIF, and exiftool cannot write it.
// ImageIO writes it when asked, so a HEIC with an orientation is made by a one-off Swift script.
const HEIC_SCRIPT = `import ImageIO
import Foundation
import UniformTypeIdentifiers
let a = CommandLine.arguments
let img = CGImageSourceCreateImageAtIndex(CGImageSourceCreateWithURL(URL(fileURLWithPath: a[1]) as CFURL, nil)!, 0, nil)!
let dst = CGImageDestinationCreateWithURL(URL(fileURLWithPath: a[2]) as CFURL, UTType.heic.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dst, img, [kCGImagePropertyOrientation: Int(a[3])!] as CFDictionary)
if !CGImageDestinationFinalize(dst) { exit(1) }
`;

export const swiftAvailable = (): boolean => {
  try {
    execFileSync("swift", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
};

export class Workbench {
  readonly dir = mkdtempSync(join(tmpdir(), "bookcase-k1-"));
  #n = 0;

  path(...parts: string[]): string {
    return join(this.dir, ...parts);
  }

  /** Write a synthetic photo at `<dir>/<relative>` and return its path. */
  photo(relative: string, spec: PhotoSpec): string {
    const out = this.path(relative);
    const src = this.path(`.src-${this.#n++}.png`);
    writeFileSync(src, png(spec.width, spec.height, quadrant(spec.width, spec.height)));
    if (spec.format === "heic" && spec.orientation) {
      const script = this.path(`.heic-${this.#n}.swift`);
      writeFileSync(script, HEIC_SCRIPT);
      execFileSync("swift", [script, src, out, String(spec.orientation)], { stdio: "pipe" });
      rmSync(script);
    } else {
      execFileSync("sips", ["-s", "format", spec.format ?? "jpeg", src, "--out", out], { stdio: "pipe" });
    }
    rmSync(src);
    const args: string[] = ["-overwrite_original", "-q"];
    if (spec.exif !== false) {
      const e = { make: "Apple", model: "iPhone Test", dateTimeOriginal: "2026:01:02 03:04:05", offset: "-07:00", ...spec.exif };
      args.push(`-Make=${e.make}`, `-Model=${e.model}`, `-DateTimeOriginal=${e.dateTimeOriginal}`, `-OffsetTimeOriginal=${e.offset}`);
      if (e.software) args.push(`-Software=${e.software}`);
      if (spec.orientation && spec.format !== "heic") args.push(`-Orientation#=${spec.orientation}`);
      if (spec.exifSize) args.push(`-ExifImageWidth=${spec.exifSize[0]}`, `-ExifImageHeight=${spec.exifSize[1]}`);
    }
    if (spec.gps) args.push(...FAKE_GPS);
    execFileSync("exiftool", [...args, out], { stdio: "pipe" });
    return out;
  }

  cleanup(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

export const exif = (path: string, ...tags: string[]): Record<string, unknown> =>
  (JSON.parse(execFileSync("exiftool", ["-json", "-n", ...tags, path], { encoding: "utf8" })) as Record<string, unknown>[])[0]!;

export const gpsTags = (path: string): string[] =>
  execFileSync("exiftool", ["-a", "-s3", "-G1", "-*GPS*", path], { encoding: "utf8" }).split("\n").filter(Boolean);

/** Read one pixel of a decoded image (via a BMP render), as [r, g, b]. */
export function pixelAt(path: string, x: number, y: number, dir: string): [number, number, number] {
  const bmp = join(dir, `.px-${Math.random().toString(36).slice(2)}.bmp`);
  execFileSync("sips", ["-s", "format", "bmp", path, "--out", bmp], { stdio: "pipe" });
  const b = execFileSync("cat", [bmp], { maxBuffer: 1 << 28 });
  rmSync(bmp);
  const offset = b.readUInt32LE(10);
  const w = b.readInt32LE(18);
  const h = b.readInt32LE(22);
  const bpp = b.readUInt16LE(28) / 8;
  const stride = Math.ceil((w * bpp) / 4) * 4;
  const row = h > 0 ? h - 1 - y : y;
  const o = offset + row * stride + x * bpp;
  return [b[o + 2]!, b[o + 1]!, b[o]!];
}
