// `ingest`: an exported folder in, verified originals in the store and ledger out (INV-11, INV-12).
// Order per file: hash the original, copy it read-only, validate, make the GPS-stripped working copy,
// emit one event. The source folder is only ever read.
import { mkdirSync, mkdtempSync, openSync, closeSync, readSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { z } from "zod";
import { PhotoSettingSchema } from "../ledger/index.ts";
import type { Ledger, PhotoSetting } from "../ledger/index.ts";
import { exiftoolReader, hasExiftool, nativeReader } from "./metadata.ts";
import type { MetadataReader, PhotoMeta } from "./metadata.ts";
import { ImageStore, sha256File } from "./store.ts";
import type { ImageFormat } from "./store.ts";
import { makeWorkingCopy, pixelSize, WorkingCopyError } from "./working-copy.ts";

export const DEFAULT_MIN_PIXELS = 12_000_000;

export type RejectReason = "below-min-resolution" | "no-exif" | "unsupported-format" | "zero-byte" | "icloud-placeholder";
export type DerivativeSignal = "IMG_E name" | ".AAE sidecar" | "Software tag" | "EXIF size differs from pixels";

export interface IngestOptions {
  folder: string;
  session: string;
  ledger: Ledger;
  /** Data root (`$BOOKCASE_DATA`). */
  dataDir: string;
  /** Filename → setting, or `{setting, shelfIndex}`. */
  settings?: Record<string, SettingEntry>;
  minPixels?: number;
  /** `false` forces the sips + native-EXIF route even when exiftool is installed. */
  useExiftool?: boolean;
  runId?: string;
  now?: () => Date;
}

const SettingEntrySchema = z.union([
  PhotoSettingSchema,
  z.strictObject({ setting: PhotoSettingSchema, shelfIndex: z.number().int().min(0).optional() }),
]);
export const SettingsMapSchema = z.record(z.string(), SettingEntrySchema);
export type SettingEntry = z.infer<typeof SettingEntrySchema>;

export function loadSettingsMap(path: string): Record<string, SettingEntry> {
  return SettingsMapSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export interface FileOutcome {
  fileName: string;
  verdict: "accepted" | "rejected";
  reasons: RejectReason[];
  /** Why the file looks like an edited derivative (accepted anyway: OC35). */
  derivativeSignals: DerivativeSignal[];
  megapixels?: number;
  setting?: PhotoSetting;
  imageHash?: string;
  workingCopyHash?: string;
}

export interface IngestResult {
  session: string;
  outcomes: FileOutcome[];
  /** Settings-map entries that matched no file. */
  unmatchedSettings: string[];
  /** Files that skipped (sidecars, hidden files) and were not considered images. */
  ignored: string[];
  metadataReader: MetadataReader["name"];
}

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

function sniff(path: string): ImageFormat | null {
  const head = Buffer.alloc(12);
  const fd = openSync(path, "r");
  try {
    readSync(fd, head, 0, 12, 0);
  } finally {
    closeSync(fd);
  }
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg";
  if (head.subarray(4, 8).toString("latin1") === "ftyp" && HEIC_BRANDS.has(head.subarray(8, 12).toString("latin1"))) return "heic";
  return null;
}

/** `YYYY:MM:DD HH:MM:SS[.f]` plus an optional `±HH:MM` offset → ISO 8601. No offset: labelled `Z` (logged deviation). */
export function captureInstant(dateTimeOriginal: string | undefined, offset: string | undefined): string | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d+)?$/.exec(dateTimeOriginal ?? "");
  if (!m || m[1] === "0000" || m[2] === "00" || m[3] === "00") return null;
  const zone = offset && /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : "Z";
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ?? ""}${zone}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** The Software value a camera writes is a bare version (iOS: `26.0.1`); anything else names an editor. */
const cameraSoftware = (software: string): boolean => /^\d+(\.\d+)*$/.test(software);

function derivativeSignals(fileName: string, siblings: Set<string>, meta: PhotoMeta, stored: { width: number; height: number }): DerivativeSignal[] {
  const signals: DerivativeSignal[] = [];
  const stem = basename(fileName, extname(fileName));
  if (/^IMG_E\d+/i.test(fileName)) signals.push("IMG_E name");
  const sidecars = [stem, stem.replace(/^IMG_E/i, "IMG_")].map((s) => `${s}.aae`.toLowerCase());
  if (sidecars.some((s) => siblings.has(s))) signals.push(".AAE sidecar");
  if (meta.software && !cameraSoftware(meta.software)) signals.push("Software tag");
  if (meta.exifWidth && meta.exifHeight && (meta.exifWidth !== stored.width || meta.exifHeight !== stored.height))
    signals.push("EXIF size differs from pixels");
  return signals;
}

/** Without a settings-map entry, a whole-case setting is inferred from the size (logged deviation). */
const inferSetting = (pixels: number): PhotoSetting => (pixels >= 24_000_000 ? "whole-48" : "whole-12");

const IGNORED = (name: string): boolean => name.toLowerCase().endsWith(".aae") || name === ".DS_Store" || (name.startsWith(".") && !name.endsWith(".icloud"));

export function ingest(options: IngestOptions): IngestResult {
  const { folder, session, ledger, dataDir } = options;
  const minPixels = options.minPixels ?? DEFAULT_MIN_PIXELS;
  const now = options.now ?? (() => new Date());
  const runId = options.runId ?? `ingest-${now().toISOString()}`;
  const reader = options.useExiftool === false || !hasExiftool() ? nativeReader() : exiftoolReader();

  const src = realpathSync(resolve(folder));
  if (!statSync(src).isDirectory()) throw new Error(`ingest: ${folder} is not a folder`);
  const store = new ImageStore(dataDir);
  mkdirSync(store.root, { recursive: true });
  if (!relative(src, realpathSync(store.root)).startsWith("..")) throw new Error("ingest: the data root is inside the source folder; the source is never written to");

  const names = readdirSync(src, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name).sort();
  const siblings = new Set(names.map((n) => n.toLowerCase()));
  const files = names.filter((n) => !IGNORED(n));
  const ignored = names.filter(IGNORED);
  const settings = options.settings ?? {};
  const unmatchedSettings = Object.keys(settings).filter((k) => !names.includes(k));

  const emit = <T extends "ScanSessionOpened" | "ImageAssetIngested" | "ImageRejected">(type: T, payload: Extract<Parameters<Ledger["append"]>[0], { type: T }>["payload"]) =>
    ledger.append({ type, ts: now().toISOString(), runId, payload } as Parameters<Ledger["append"]>[0]);

  emit("ScanSessionOpened", { sessionId: session, minPixels });

  const tmpDir = mkdtempSync(join(dataDir, "images", ".ingest-"));
  const outcomes: FileOutcome[] = [];
  try {
    for (const fileName of files) {
      const path = join(src, fileName);
      const reject = (reasons: RejectReason[], extra: Partial<FileOutcome> = {}): void => {
        emit("ImageRejected", { sessionId: session, fileName, ...(extra.imageHash ? { fileHash: extra.imageHash } : {}), reasons });
        outcomes.push({ fileName, verdict: "rejected", reasons, derivativeSignals: [], ...extra });
      };

      if (fileName.endsWith(".icloud")) {
        reject(["icloud-placeholder"]);
        continue;
      }
      if (statSync(path).size === 0) {
        reject(["zero-byte"]);
        continue;
      }
      const format = sniff(path);
      if (!format) {
        reject(["unsupported-format"]);
        continue;
      }
      if (format === "heic" && reader.name === "native")
        throw new Error("ingest: HEIC needs exiftool (sips cannot expose DateTimeOriginal, Orientation or GPS); install it with `brew install exiftool`");

      // INV-12: hash first, then store a read-only copy of the original. Rejected files are not stored.
      const imageHash = sha256File(path);
      const meta = reader.read(path);
      const stored = pixelSize(path);
      const megapixels = (stored.width * stored.height) / 1e6;

      const reasons: RejectReason[] = [];
      if (stored.width * stored.height < minPixels) reasons.push("below-min-resolution");
      const capturedAt = captureInstant(meta.dateTimeOriginal, meta.offsetTimeOriginal);
      if (!meta.make || !meta.model || !capturedAt) reasons.push("no-exif");
      if (reasons.length) {
        reject(reasons, { imageHash, megapixels });
        continue;
      }

      store.put(path, imageHash, format);
      const entry = settings[fileName];
      const setting = (typeof entry === "string" ? entry : entry?.setting) ?? inferSetting(stored.width * stored.height);
      const shelfIndex = typeof entry === "object" ? entry.shelfIndex : undefined;
      const signals = derivativeSignals(fileName, siblings, meta, stored);

      const wcTmp = join(tmpDir, `${imageHash}.${format === "jpeg" ? "jpg" : "heic"}`);
      let wc;
      try {
        wc = makeWorkingCopy({ src: path, dst: wcTmp, tmpDir, format, meta, stored, reader });
      } catch (e) {
        if (e instanceof WorkingCopyError) throw new Error(`ingest: ${fileName}: ${e.message}`);
        throw e;
      }
      const workingCopyHash = sha256File(wc.path);
      store.put(wc.path, workingCopyHash, format, { move: true });

      emit("ImageAssetIngested", {
        sessionId: session,
        imageHash,
        workingCopyHash,
        format,
        width: wc.size.width,
        height: wc.size.height,
        setting,
        capturedAt: capturedAt!,
        ...(shelfIndex !== undefined ? { shelfIndex } : {}),
        ...(signals.length ? { flags: ["edited-derivative" as const] } : {}),
      });
      outcomes.push({ fileName, verdict: "accepted", reasons: [], derivativeSignals: signals, megapixels, setting, imageHash, workingCopyHash });
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  return { session, outcomes, unmatchedSettings, ignored, metadataReader: reader.name };
}

/** The accept/reject table printed at the end of `bookcase ingest`. Names and counts only; no GPS, no capture times. */
export function formatTable(result: IngestResult): string {
  const rows = result.outcomes.map((o) => [
    o.fileName,
    o.verdict === "accepted" ? "ACCEPT" : "REJECT",
    o.megapixels === undefined ? "-" : o.megapixels.toFixed(1),
    o.setting ?? "-",
    o.verdict === "rejected" ? o.reasons.join(", ") : o.derivativeSignals.length ? `edited-derivative (${o.derivativeSignals.join("; ")})` : "",
  ]);
  const head = ["file", "verdict", "MP", "setting", "reasons / flags"];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (r: string[]) => r.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd();
  const accepted = result.outcomes.filter((o) => o.verdict === "accepted").length;
  const flagged = result.outcomes.filter((o) => o.derivativeSignals.length).length;
  const out = [line(head), line(widths.map((w) => "-".repeat(w))), ...rows.map(line), ""];
  out.push(`session ${result.session}: ${accepted} accepted (${flagged} flagged edited-derivative), ${result.outcomes.length - accepted} rejected`);
  if (result.unmatchedSettings.length) out.push(`settings map names ${result.unmatchedSettings.length} file(s) not in the folder`);
  return out.join("\n");
}
