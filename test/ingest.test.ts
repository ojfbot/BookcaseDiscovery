import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { formatTable, ingest, ingestCommand } from "../src/capture/index.ts";
import type { IngestResult } from "../src/capture/index.ts";
import { parseJpegMetadata } from "../src/capture/metadata.ts";
import { ImageStore, MemoryLedger } from "../src/ledger/index.ts";
import { main } from "../src/run/index.ts";
import { exif, gpsTags, pixelAt, swiftAvailable, toolsAvailable, Workbench } from "./helpers/synth.ts";
import type { PhotoSpec } from "./helpers/synth.ts";

const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
/** A snapshot of a folder: names, sizes, mtimes and hashes. Equal before and after means untouched. */
const snapshot = (dir: string) =>
  readdirSync(dir).sort().map((n) => [n, statSync(join(dir, n)).size, statSync(join(dir, n)).mtimeMs, sha(join(dir, n))]);

const MIN = 10_000; // small synthetic images; the default-minimum cases below use real sizes

describe.skipIf(!toolsAvailable())("ingest (synthetic photos)", () => {
  const wb = new Workbench();
  let n = 0;
  afterAll(() => wb.cleanup());

  /** A fresh source folder holding the given files, and a fresh data dir. */
  function setup(files: Record<string, PhotoSpec>) {
    const id = n++;
    const folder = wb.path(`in-${id}`);
    mkdirSync(folder);
    for (const [name, spec] of Object.entries(files)) wb.photo(join(`in-${id}`, name), spec);
    const dataDir = wb.path(`data-${id}`);
    mkdirSync(dataDir);
    return { folder, dataDir, ledger: new MemoryLedger() };
  }
  const run = (s: ReturnType<typeof setup>, extra: Partial<Parameters<typeof ingest>[0]> = {}): IngestResult =>
    ingest({ folder: s.folder, session: "test-session", ledger: s.ledger, dataDir: s.dataDir, minPixels: MIN, ...extra });

  describe("exit criteria", () => {
    it("accepts a JPEG with EXIF at the default 12 MP minimum", () => {
      const s = setup({ "IMG_0001.jpg": { width: 4032, height: 3024 } });
      const before = snapshot(s.folder);
      const result = ingest({ folder: s.folder, session: "test-session", ledger: s.ledger, dataDir: s.dataDir });
      expect(result.outcomes).toMatchObject([{ fileName: "IMG_0001.jpg", verdict: "accepted", derivativeSignals: [] }]);
      const [asset] = s.ledger.images();
      expect(asset).toMatchObject({ sessionId: "test-session", format: "jpeg", width: 4032, height: 3024, setting: "whole-12", capturedAt: "2026-01-02T03:04:05-07:00" });
      expect(asset!.flags).toBeUndefined();
      expect(snapshot(s.folder)).toEqual(before); // the source is never modified
    });

    it("rejects a 1.7 MP image with no EXIF as below-min-resolution and no-exif", () => {
      const s = setup({ "IMG_0002.jpg": { width: 1600, height: 1100, exif: false } });
      const result = ingest({ folder: s.folder, session: "test-session", ledger: s.ledger, dataDir: s.dataDir });
      expect(result.outcomes[0]).toMatchObject({ verdict: "rejected", reasons: ["below-min-resolution", "no-exif"] });
      expect(s.ledger.rejections()).toMatchObject([{ fileName: "IMG_0002.jpg", reasons: ["below-min-resolution", "no-exif"] }]);
      expect(s.ledger.images()).toEqual([]);
      expect(existsSync(join(s.dataDir, "images", "sha256", result.outcomes[0]!.imageHash!.slice(0, 2)))).toBe(false); // not stored
    });

    it("gives a GPS-tagged input a working copy with no GPS, and leaves the original as it was", () => {
      const s = setup({ "IMG_0003.jpg": { width: 200, height: 100, gps: true } });
      const original = join(s.folder, "IMG_0003.jpg");
      expect(gpsTags(original).length).toBeGreaterThan(0);
      const originalHash = sha(original);
      run(s);
      const [asset] = s.ledger.images();
      expect(asset!.imageHash).toBe(originalHash);
      const store = new ImageStore(s.dataDir);
      const stored = store.find(asset!.imageHash)!;
      const working = store.find(asset!.workingCopyHash)!;
      expect(sha(stored)).toBe(originalHash);
      // one store for the whole repo: the ledger's layout, images/sha256/<aa>/<bb>/<hash>.<ext>
      expect(stored).toBe(join(s.dataDir, "images", "sha256", originalHash.slice(0, 2), originalHash.slice(2, 4), `${originalHash}.jpg`));
      expect(gpsTags(working)).toEqual([]);
      expect(sha(working)).toBe(asset!.workingCopyHash);
      expect(asset!.workingCopyHash).not.toBe(originalHash);
      expect(sha(original)).toBe(originalHash);
    });

    it("flags an IMG_E name, and still accepts it (OC35)", () => {
      const s = setup({ "IMG_E0004.jpg": { width: 200, height: 100 } });
      const result = run(s);
      expect(result.outcomes[0]).toMatchObject({ verdict: "accepted", derivativeSignals: ["IMG_E name"] });
      expect(s.ledger.images()[0]!.flags).toEqual(["edited-derivative"]);
    });
  });

  describe("derivative signals", () => {
    it("flags a sibling .AAE, a foreign Software tag, and EXIF size ≠ stored pixels (either way)", () => {
      const s = setup({
        "IMG_0010.jpg": { width: 200, height: 100 },
        "IMG_0011.jpg": { width: 200, height: 100, exif: { software: "Photoshop 25" } },
        "IMG_0012.jpg": { width: 200, height: 100, exif: { software: "26.0.1" } }, // the camera's own: an iOS version
        "IMG_0013.jpg": { width: 200, height: 100, exifSize: [100, 200] }, // the transpose, as the K-2 portrait derivatives
        "IMG_0014.jpg": { width: 200, height: 100, exifSize: [300, 150] }, // a non-native size
        "IMG_0015.jpg": { width: 200, height: 100, orientation: 6 }, // a camera portrait: EXIF size = stored size, tag set
      });
      
      writeFileSync(join(s.folder, "IMG_0010.AAE"), "<plist/>");
      const byName = Object.fromEntries(run(s).outcomes.map((o) => [o.fileName, o]));
      expect(byName["IMG_0010.jpg"]!.derivativeSignals).toEqual([".AAE sidecar"]);
      expect(byName["IMG_0011.jpg"]!.derivativeSignals).toEqual(["Software tag"]);
      expect(byName["IMG_0012.jpg"]!.derivativeSignals).toEqual([]);
      expect(byName["IMG_0013.jpg"]!.derivativeSignals).toEqual(["EXIF size differs from pixels"]);
      expect(byName["IMG_0014.jpg"]!.derivativeSignals).toEqual(["EXIF size differs from pixels"]);
      expect(byName["IMG_0015.jpg"]!.derivativeSignals).toEqual([]);
      expect(Object.values(byName).every((o) => o.verdict === "accepted")).toBe(true);
      expect(byName["IMG_0010.jpg"]!.fileName).toBe("IMG_0010.jpg");
      expect(s.ledger.images().filter((i) => i.flags).length).toBe(4);
    });
  });

  describe("polygon frame: the working copy is orientation-normalised", () => {
    it("Orientation 6 gives a working copy with swapped size and Orientation 1, pixels rotated", () => {
      const s = setup({ "IMG_0020.jpg": { width: 200, height: 100, orientation: 6, gps: true } });
      run(s);
      const [asset] = s.ledger.images();
      expect(asset).toMatchObject({ width: 100, height: 200 });
      const working = new ImageStore(s.dataDir).find(asset!.workingCopyHash)!;
      expect(exif(working, "-Orientation").Orientation ?? 1).toBe(1);
      expect(gpsTags(working)).toEqual([]);
      // the stored red top-left quadrant, rotated 90° clockwise for display, sits top-right
      const [r, , b] = pixelAt(working, 99, 0, s.dataDir);
      expect(r).toBeGreaterThan(200);
      expect(b).toBeLessThan(60);
      expect(pixelAt(working, 0, 0, s.dataDir)[2]).toBeGreaterThan(200);
    });

    it.each([3, 8])("Orientation %i is normalised too", (orientation) => {
      const s = setup({ "IMG_0021.jpg": { width: 200, height: 100, orientation } });
      run(s);
      const [asset] = s.ledger.images();
      expect([asset!.width, asset!.height]).toEqual(orientation === 8 ? [100, 200] : [200, 100]);
      expect(exif(new ImageStore(s.dataDir).find(asset!.workingCopyHash)!, "-Orientation").Orientation ?? 1).toBe(1);
    });

    it("an Orientation 1 working copy keeps the original's pixel size and is lossless-stripped", () => {
      const s = setup({ "IMG_0022.jpg": { width: 200, height: 100, gps: true } });
      const result = run(s);
      expect(s.ledger.images()[0]).toMatchObject({ width: 200, height: 100 });
      expect(result.outcomes[0]!.workingCopyHash).toBeDefined();
    });
  });

  describe("HEIC", () => {
    it.skipIf(!swiftAvailable())("accepts a HEIC, strips its GPS, normalises its orientation", () => {
      const s = setup({
        "IMG_0030.heic": { width: 200, height: 100, format: "heic", gps: true },
        "IMG_0031.heic": { width: 200, height: 100, format: "heic", orientation: 6, gps: true },
      });
      run(s);
      const images = s.ledger.images();
      expect(images.map((i) => i.format)).toEqual(["heic", "heic"]);
      expect(images.map((i) => [i.width, i.height])).toEqual([[200, 100], [100, 200]]);
      for (const i of images) {
        const working = new ImageStore(s.dataDir).find(i.workingCopyHash)!;
        expect(gpsTags(working)).toEqual([]);
        expect(exif(working, "-Orientation").Orientation ?? 1).toBe(1);
      }
    });
  });

  describe("rejects", () => {
    it("zero-byte, .icloud placeholder, unsupported format; ignores sidecars and hidden files", () => {
      const s = setup({ "IMG_0040.jpg": { width: 200, height: 100 } });
      writeFileSync(join(s.folder, "IMG_0041.jpg"), "");
      writeFileSync(join(s.folder, ".IMG_0042.HEIC.icloud"), "placeholder");
      writeFileSync(join(s.folder, "IMG_0043.jpg"), "not a picture at all");
      writeFileSync(join(s.folder, "IMG_0044.png"), Buffer.from("\x89PNG\r\n\x1a\nrest", "latin1"));
      writeFileSync(join(s.folder, "IMG_0040.AAE"), "<plist/>");
      writeFileSync(join(s.folder, ".DS_Store"), "x");
      const result = run(s);
      const verdicts = Object.fromEntries(result.outcomes.map((o) => [o.fileName, [o.verdict, ...o.reasons]]));
      expect(verdicts).toEqual({
        ".IMG_0042.HEIC.icloud": ["rejected", "icloud-placeholder"],
        "IMG_0040.jpg": ["accepted"],
        "IMG_0041.jpg": ["rejected", "zero-byte"],
        "IMG_0043.jpg": ["rejected", "unsupported-format"],
        "IMG_0044.png": ["rejected", "unsupported-format"],
      });
      expect(result.ignored.sort()).toEqual([".DS_Store", "IMG_0040.AAE"]);
      const rej = s.ledger.rejections();
      expect(rej.find((r) => r.fileName === "IMG_0041.jpg")!.fileHash).toBeUndefined();
      expect(rej.find((r) => r.fileName === "IMG_0043.jpg")!.fileHash).toBeUndefined();
    });

    it.each([
      ["no Make", { make: "" }],
      ["no Model", { model: "" }],
      ["no DateTimeOriginal", { dateTimeOriginal: "" }],
    ])("EXIF missing: %s", (_label, exifOverride) => {
      const s = setup({ "IMG_0050.jpg": { width: 200, height: 100, exif: exifOverride } });
      expect(run(s).outcomes[0]).toMatchObject({ verdict: "rejected", reasons: ["no-exif"] });
    });

    it("below the session minimum, in either orientation", () => {
      const s = setup({ "a.jpg": { width: 100, height: 200 }, "b.jpg": { width: 200, height: 100 }, "c.jpg": { width: 100, height: 50 } });
      const verdicts = Object.fromEntries(run(s, { minPixels: 20_000 }).outcomes.map((o) => [o.fileName, o.verdict]));
      expect(verdicts).toEqual({ "a.jpg": "accepted", "b.jpg": "accepted", "c.jpg": "rejected" });
    });
  });

  describe("store and ledger", () => {
    it("stores originals and working copies read-only under images/sha256/<aa>/<bb>/<hash>.<ext>", () => {
      const s = setup({ "IMG_0060.jpg": { width: 200, height: 100 } });
      run(s);
      const [asset] = s.ledger.images();
      for (const h of [asset!.imageHash, asset!.workingCopyHash]) {
        const p = join(s.dataDir, "images", "sha256", h.slice(0, 2), h.slice(2, 4), `${h}.jpg`);
        expect(existsSync(p)).toBe(true);
        expect(statSync(p).mode & 0o222).toBe(0);
      }
      expect(readdirSync(join(s.dataDir, "images")).filter((d) => d.startsWith(".ingest-"))).toEqual([]);
    });

    it("applies the settings map; infers whole-12 / whole-48 by size otherwise", () => {
      const s = setup({ "a.jpg": { width: 200, height: 100 }, "b.jpg": { width: 200, height: 100 }, "c.jpg": { width: 200, height: 100 } });
      const result = run(s, { settings: { "a.jpg": "overview", "b.jpg": { setting: "shelf-48", shelfIndex: 3 }, "ghost.jpg": "whole-12" } });
      const by = Object.fromEntries(s.ledger.images().map((i, k) => [result.outcomes[k]!.fileName, i]));
      expect(by["a.jpg"]).toMatchObject({ setting: "overview" });
      expect(by["a.jpg"]!.shelfIndex).toBeUndefined();
      expect(by["b.jpg"]).toMatchObject({ setting: "shelf-48", shelfIndex: 3 });
      expect(by["c.jpg"]).toMatchObject({ setting: "whole-12" });
      expect(result.unmatchedSettings).toEqual(["ghost.jpg"]);
    });

    it("opens the session first", () => {
      const s = setup({ "a.jpg": { width: 200, height: 100 } });
      run(s, { runId: "run-1" });
      expect([...s.ledger.events()].map((e) => [e.seq, e.type, e.runId])).toEqual([[1, "ScanSessionOpened", "run-1"], [2, "ImageAssetIngested", "run-1"]]);
    });

    it("refuses a data root inside the source folder", () => {
      const s = setup({ "a.jpg": { width: 200, height: 100 } });
      expect(() => run(s, { dataDir: join(s.folder, "data") })).toThrow(/never written to/);
    });
  });

  describe("without exiftool (sips + native EXIF reader)", () => {
    it("reads JPEG EXIF natively, strips GPS by re-encode, and proves it by read-back", () => {
      const s = setup({
        "IMG_0070.jpg": { width: 200, height: 100, gps: true },
        "IMG_0071.jpg": { width: 200, height: 100, gps: true, orientation: 6, exif: { software: "Photoshop 25" } },
        "IMG_0072.jpg": { width: 100, height: 50, exif: false },
      });
      const result = run(s, { useExiftool: false });
      expect(result.metadataReader).toBe("native");
      expect(result.outcomes.map((o) => [o.fileName, o.verdict, ...o.reasons, ...o.derivativeSignals])).toEqual([
        ["IMG_0070.jpg", "accepted"],
        ["IMG_0071.jpg", "accepted", "Software tag"],
        ["IMG_0072.jpg", "rejected", "below-min-resolution", "no-exif"],
      ]);
      const images = s.ledger.images();
      expect(images.map((i) => [i.width, i.height, i.capturedAt])).toEqual([[200, 100, "2026-01-02T03:04:05-07:00"], [100, 200, "2026-01-02T03:04:05-07:00"]]);
      for (const i of images) {
        const working = new ImageStore(s.dataDir).find(i.workingCopyHash)!;
        expect(gpsTags(working)).toEqual([]); // checked by a different reader than the one that proved it
        expect(exif(working, "-Orientation").Orientation ?? 1).toBe(1);
      }
    });

    it("refuses HEIC rather than guess", () => {
      const s = setup({ "a.heic": { width: 200, height: 100, format: "heic" } });
      expect(() => run(s, { useExiftool: false })).toThrow(/HEIC needs exiftool/);
    });

    it("the native reader agrees with exiftool on a GPS-tagged file, and sees no GPS in a stripped one", () => {
      const s = setup({ "a.jpg": { width: 200, height: 100, gps: true, orientation: 8 } });
      const p = join(s.folder, "a.jpg");
      expect(parseJpegMetadata(readFileSync(p))).toMatchObject({ make: "Apple", model: "iPhone Test", orientation: 8, hasGps: true, exifWidth: 200, exifHeight: 100, dateTimeOriginal: "2026:01:02 03:04:05" });
      run(s);
      const working = new ImageStore(s.dataDir).find(s.ledger.images()[0]!.workingCopyHash)!;
      expect(parseJpegMetadata(readFileSync(working)).hasGps).toBe(false);
    });
  });

  describe("table and CLI", () => {
    it("prints the accept/reject table, with no GPS or capture times in it", () => {
      const s = setup({ "IMG_0080.jpg": { width: 200, height: 100, gps: true }, "IMG_E0081.jpg": { width: 200, height: 100 }, "IMG_0082.jpg": { width: 10, height: 10, exif: false } });
      const table = formatTable(run(s));
      expect(table).toContain("IMG_E0081.jpg  ACCEPT");
      expect(table).toContain("edited-derivative (IMG_E name)");
      expect(table).toContain("below-min-resolution, no-exif");
      expect(table).toContain("2 accepted (1 flagged edited-derivative), 1 rejected");
      expect(table).not.toMatch(/2026|GPS|latitude/i);
    });

    it("bookcase ingest writes events as JSON Lines under $BOOKCASE_DATA and exits 0", () => {
      const s = setup({ "a.jpg": { width: 200, height: 100 }, "b.jpg": { width: 10, height: 10, exif: false } });
      const map = wb.path("map.json");
      writeFileSync(map, JSON.stringify({ "a.jpg": { setting: "shelf-48", shelfIndex: 1 } }));
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        const args = [s.folder, "--session", "cli-session", "--settings", map, "--min-pixels", String(MIN)];
        expect(ingestCommand(args, { BOOKCASE_DATA: s.dataDir })).toBe(0);
        expect(String(log.mock.calls.at(-2)?.[0] ?? log.mock.calls[0]?.[0])).toContain("ACCEPT");
      } finally {
        log.mockRestore();
      }
      const lines = readFileSync(join(s.dataDir, "events", "cli-session.ingest.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
      expect(lines.map((e) => e.type)).toEqual(["ScanSessionOpened", "ImageAssetIngested", "ImageRejected"]);
      expect(lines[1].payload).toMatchObject({ setting: "shelf-48", shelfIndex: 1 });
    });

    it("usage errors exit 1 without touching anything", () => {
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        expect(main(["ingest"])).toBe(1);
        expect(ingestCommand(["x", "--session", "s", "--min-pixels", "abc"], {})).toBe(1);
        expect(ingestCommand(["/no/such/folder", "--session", "s"], { BOOKCASE_DATA: wb.path("never") })).toBe(1);
      } finally {
        err.mockRestore();
      }
    });
  });
});
