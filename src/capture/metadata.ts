// Reading photo metadata. `exiftool` is the reader when installed. Without it a small native JPEG
// EXIF reader answers the same questions (HEIC needs exiftool: sips cannot expose DateTimeOriginal,
// Orientation or GPS, checked on macOS 27). Values here never leave the process except as the
// contract fields (capturedAt, size); GPS is only ever tested for presence, never read.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export interface PhotoMeta {
  make?: string;
  model?: string;
  /** EXIF `DateTimeOriginal`, `YYYY:MM:DD HH:MM:SS`. */
  dateTimeOriginal?: string;
  /** EXIF `OffsetTimeOriginal`, `+HH:MM`. */
  offsetTimeOriginal?: string;
  /** EXIF Orientation 1–8; 1 when absent. */
  orientation: number;
  software?: string;
  /** The pixel size the camera recorded in EXIF (not the stored pixels). */
  exifWidth?: number;
  exifHeight?: number;
  /** Lens model and focal lengths in mm, as recorded; read by exiftool only (private manifest, OC35). */
  lensModel?: string;
  focalLengthMm?: number;
  focalLength35mm?: number;
}

export interface Probe {
  /** Any GPS tag present, EXIF or XMP. */
  hasGps: boolean;
  orientation: number;
}

export interface MetadataReader {
  readonly name: "exiftool" | "native";
  read(path: string): PhotoMeta;
  /** The read-back after stripping: is there still GPS, and what is the Orientation? */
  probe(path: string): Probe;
}

const text = (v: unknown): string | undefined => (v === undefined || v === null || v === "" ? undefined : String(v).trim() || undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export function hasExiftool(): boolean {
  try {
    execFileSync("exiftool", ["-ver"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function exiftoolReader(): MetadataReader {
  const run = (args: string[]): string => execFileSync("exiftool", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  return {
    name: "exiftool",
    read(path) {
      const out = run([
        "-json", "-n", "-Make", "-Model", "-DateTimeOriginal", "-OffsetTimeOriginal", "-Orientation", "-Software",
        "-ExifImageWidth", "-ExifImageHeight", "-LensModel", "-FocalLength", "-FocalLengthIn35mmFormat", path,
      ]);
      const r = (JSON.parse(out) as Record<string, unknown>[])[0] ?? {};
      return {
        make: text(r.Make),
        model: text(r.Model),
        dateTimeOriginal: text(r.DateTimeOriginal),
        offsetTimeOriginal: text(r.OffsetTimeOriginal),
        orientation: num(r.Orientation) ?? 1,
        software: text(r.Software),
        exifWidth: num(r.ExifImageWidth),
        exifHeight: num(r.ExifImageHeight),
        lensModel: text(r.LensModel),
        focalLengthMm: num(r.FocalLength),
        focalLength35mm: num(r.FocalLengthIn35mmFormat),
      };
    },
    probe(path) {
      // `-a` lists duplicates, `-G1` the group; a GPS tag in any group (EXIF, XMP, MakerNote) counts.
      const gps = run(["-a", "-s3", "-G1", "-*GPS*", path]).trim();
      const o = JSON.parse(run(["-json", "-n", "-Orientation", path]))[0] as Record<string, unknown>;
      return { hasGps: gps.length > 0, orientation: num(o.Orientation) ?? 1 };
    },
  };
}

// ---- native JPEG EXIF reader (the no-exiftool path) ----

const TAGS = { make: 0x010f, model: 0x0110, orientation: 0x0112, software: 0x0131, exifIfd: 0x8769, gpsIfd: 0x8825 };
const EXIF_TAGS = { dateTimeOriginal: 0x9003, offsetTimeOriginal: 0x9011, width: 0xa002, height: 0xa003 };
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 7: 1 };

interface Parsed extends PhotoMeta {
  hasGps: boolean;
}

/** Parse the EXIF and XMP APP1 segments of a JPEG. Unreadable or absent EXIF gives the empty result. */
export function parseJpegMetadata(buf: Buffer): Parsed {
  const out: Parsed = { orientation: 1, hasGps: false };
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return out;
  let pos = 2;
  while (pos + 4 <= buf.length && buf[pos] === 0xff) {
    const marker = buf[pos + 1];
    if (marker === 0xda || marker === 0xd9) break; // start of scan / end of image
    const len = buf.readUInt16BE(pos + 2);
    const start = pos + 4;
    const end = Math.min(pos + 2 + len, buf.length);
    if (marker === 0xe1) {
      const seg = buf.subarray(start, end);
      if (seg.subarray(0, 6).toString("latin1") === "Exif\0\0") parseTiff(seg.subarray(6), out);
      else if (seg.subarray(0, 28).toString("latin1").startsWith("http://ns.adobe.com/xap/1.0/") && /GPS/.test(seg.toString("latin1"))) out.hasGps = true;
    }
    pos += 2 + len;
  }
  return out;
}

function parseTiff(tiff: Buffer, out: Parsed): void {
  const little = tiff.subarray(0, 2).toString("latin1") === "II";
  if (!little && tiff.subarray(0, 2).toString("latin1") !== "MM") return;
  const u16 = (o: number) => (little ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o: number) => (little ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  const entries = (ifd: number): Map<number, { type: number; count: number; at: number }> => {
    const map = new Map<number, { type: number; count: number; at: number }>();
    if (ifd + 2 > tiff.length) return map;
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > tiff.length) break;
      const type = u16(e + 2);
      const count = u32(e + 4);
      const size = (TYPE_SIZE[type] ?? 1) * count;
      map.set(u16(e), { type, count, at: size <= 4 ? e + 8 : u32(e + 8) });
    }
    return map;
  };
  const str = (e?: { count: number; at: number }): string | undefined =>
    e && e.at + e.count <= tiff.length ? text(tiff.subarray(e.at, e.at + e.count).toString("latin1").replace(/\0.*$/s, "")) : undefined;
  const int = (e?: { type: number; at: number }): number | undefined => (e ? (e.type === 3 ? u16(e.at) : e.type === 4 ? u32(e.at) : undefined) : undefined);

  try {
    const ifd0 = entries(u32(4));
    out.make = str(ifd0.get(TAGS.make));
    out.model = str(ifd0.get(TAGS.model));
    out.software = str(ifd0.get(TAGS.software));
    out.orientation = int(ifd0.get(TAGS.orientation)) ?? 1;
    if (ifd0.has(TAGS.gpsIfd)) out.hasGps = true;
    const exifPtr = int(ifd0.get(TAGS.exifIfd));
    if (exifPtr !== undefined) {
      const exif = entries(exifPtr);
      out.dateTimeOriginal = str(exif.get(EXIF_TAGS.dateTimeOriginal));
      out.offsetTimeOriginal = str(exif.get(EXIF_TAGS.offsetTimeOriginal));
      out.exifWidth = int(exif.get(EXIF_TAGS.width));
      out.exifHeight = int(exif.get(EXIF_TAGS.height));
    }
  } catch {
    // truncated EXIF: keep what was read
  }
}

export function nativeReader(): MetadataReader {
  return {
    name: "native",
    read(path) {
      const { hasGps: _gps, ...meta } = parseJpegMetadata(readFileSync(path));
      return meta;
    },
    probe(path) {
      const p = parseJpegMetadata(readFileSync(path));
      return { hasGps: p.hasGps, orientation: p.orientation };
    },
  };
}
