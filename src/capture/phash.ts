// F-1: the perceptual hash behind near-duplicate flags. A 64-bit difference hash (dHash, as `imagehash.dhash`): the
// photo shrunk to 9 x 8 grey pixels, one bit per horizontal neighbour pair, set where the left pixel is brighter.
// `sips` does the shrinking (macOS, like the report's display derivative); the bits are computed here. CPU only.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const DHASH_W = 9;
export const DHASH_H = 8;

/** dHash of a `DHASH_W` x `DHASH_H` grey image (row-major, top row first), as 16 hex digits. */
export function dhash(grey: ArrayLike<number>): string {
  if (grey.length !== DHASH_W * DHASH_H) throw new Error(`dhash: want ${DHASH_W * DHASH_H} pixels, got ${grey.length}`);
  let hex = "";
  let nibble = 0, bits = 0;
  for (let y = 0; y < DHASH_H; y++)
    for (let x = 0; x < DHASH_W - 1; x++) {
      nibble = (nibble << 1) | (grey[y * DHASH_W + x]! > grey[y * DHASH_W + x + 1]! ? 1 : 0);
      if (++bits === 4) (hex += nibble.toString(16)), (nibble = 0), (bits = 0);
    }
  return hex;
}

/** Grey pixels (ITU-R 601 luma, top row first) of an uncompressed 24- or 32-bit BMP. */
export function bmpGrey(buf: Buffer): { width: number; height: number; grey: Uint8Array } {
  if (buf.toString("latin1", 0, 2) !== "BM") throw new Error("bmp: not a BMP file");
  const offset = buf.readUInt32LE(10);
  const width = buf.readInt32LE(18);
  const rawHeight = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28);
  const compression = buf.readUInt32LE(30);
  // BI_RGB, or BI_BITFIELDS with the usual BGRA masks (what `sips` writes at 32 bits).
  if ((bpp !== 24 && bpp !== 32) || (compression !== 0 && compression !== 3)) throw new Error(`bmp: unsupported ${bpp}-bit, compression ${compression}`);
  const height = Math.abs(rawHeight);
  const bytes = bpp / 8;
  const stride = Math.ceil((width * bytes) / 4) * 4;
  const grey = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    // Positive height: rows stored bottom-up.
    const row = offset + (rawHeight > 0 ? height - 1 - y : y) * stride;
    for (let x = 0; x < width; x++) {
      const p = row + x * bytes;
      grey[y * width + x] = Math.round(0.299 * buf[p + 2]! + 0.587 * buf[p + 1]! + 0.114 * buf[p]!);
    }
  }
  return { width, height, grey };
}

/** dHash of an image file, shrunk by `sips` (aspect not kept, as dHash wants). */
export function dhashFile(path: string): string {
  const dir = mkdtempSync(join(tmpdir(), "bookcase-dhash-"));
  try {
    const out = join(dir, "small.bmp");
    execFileSync("sips", ["-s", "format", "bmp", "-z", String(DHASH_H), String(DHASH_W), path, "--out", out], { stdio: "pipe" });
    // sips warns and exits 0 on a file it cannot read.
    if (!existsSync(out)) throw new Error("dhash: sips could not read the image");
    const { width, height, grey } = bmpGrey(readFileSync(out));
    if (width !== DHASH_W || height !== DHASH_H) throw new Error(`dhash: sips gave ${width}x${height}`);
    return dhash(grey);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
