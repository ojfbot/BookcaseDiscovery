// NS-4: capture-provenance fields on TS-0's label rows and F-1's manifest rows (src/eval/ts0.ts, src/capture/dataset.ts,
// src/capture/manifest.ts), read with defaults when written before NS-4; a held-out session manifested and frozen but
// never exported (DL-5's gap, src/eval/set-roles.ts); the schema bump refused by DL-3's reader until rebuilt.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { sessionLedgerPath } from "../src/capture/cli.ts";
import { buildManifestPhotos, DATASET, dupClusters, LEGACY_PROVENANCE, manifestCounts, ManifestPhoto, readDatasetManifest, type DatasetPhotoInput } from "../src/capture/dataset.ts";
import { CAPTURE_MODES, captureModeOf, DEVICE_CLASSES, deviceClassOf, LENS_CLASSES, SWEEP_MODES } from "../src/capture/manifest.ts";
import { DATASET_SCHEMA } from "../src/eval/lineage-classes.ts";
import { assertManifestable, heldOutSessions, manifestRefusal, MANIFEST_ROLES, SET_ROLES, type SetRegistry } from "../src/eval/set-roles.ts";
import { manifestSessions } from "../src/eval/ts0-cli.ts";
import { assertExportable, LABEL_SOURCES, labelCounts, labelOf, labelRow, LabelRow, LEGACY_LABEL_PROVENANCE, parseLabelRow, RGB_RECOVERABLE, TS0, type BoxEvidence, type RowContext } from "../src/eval/ts0.ts";
import { checkLineage, LineageError, makeStamp, writeLineage } from "../src/ledger/lineage.ts";

const hex = (n: number) => n.toString(16).padStart(64, "0");
const IMG = hex(7);
const photoInput = (over: Partial<DatasetPhotoInput> = {}): DatasetPhotoInput => ({
  sha256: IMG,
  originalSha256: hex(8),
  path: `images/sha256/00/00/${IMG}.jpg`,
  size: 1,
  session: "pilot-000",
  storeId: null,
  bookcaseId: null,
  shelf: null,
  setting: "real-use",
  capturedAt: null,
  dhash: null,
  deviceClass: "metric-depth",
  lens: "ultra-wide",
  captureMode: "shopper-still",
  ...over,
});
const manifestOf = (photos: DatasetPhotoInput[], heldOut: readonly string[] = DATASET.heldOutSessions) => ({
  version: "v-000000000000",
  photos: buildManifestPhotos(photos, null, { ...DATASET, heldOutSessions: heldOut }).photos,
});
const box = (): BoxEvidence => ({
  id: `${IMG}:3`,
  imageId: IMG,
  decision: { top: { vision: "w1", ppocr: "w1" }, confirmed: { vision: "w1", ppocr: "w1" }, accepted: "w1", agreeing: ["vision", "ppocr"] },
  copy: null,
  context: null,
});
const ctx = (photo: ManifestPhoto, over: Partial<RowContext> = {}): RowContext => ({
  version: "v-000000000000",
  boxSet: hex(1),
  modelRevision: hex(2),
  set: "pilot-000",
  crop: "rect;rot=fixed;clip=none",
  polygon: [
    [0, 0],
    [1, 0],
    [1, 5],
    [0, 5],
  ],
  outline: null,
  rung: "confirmed",
  work: { title: "T", authors: ["A"] },
  rarity: "distinctive",
  backing: null,
  photo,
  labelSource: "single-view",
  rgbRecoverable: "yes",
  ...over,
});
const rowOf = (photo: ManifestPhoto, over: Partial<RowContext> = {}) => {
  const l = labelOf(box());
  if (!l || l === "conflict") throw new Error("no label");
  return labelRow(box(), l, ctx(photo, over));
};

describe("the vocabulary", () => {
  it("has the brief's values, in a fixed order", () => {
    expect(DEVICE_CLASSES).toEqual(["metric-depth", "relative-stereo", "none"]);
    expect(LENS_CLASSES).toEqual(["main", "ultra-wide", "telephoto", "unknown"]);
    expect(CAPTURE_MODES).toEqual(["shopper-still", "protocol-still", "natural-sweep", "rich-session"]);
    expect(LABEL_SOURCES).toEqual(["single-view", "mono-geometry", "multiview-fusion", "lidar-privileged", "lidar-scale"]);
    expect(RGB_RECOVERABLE).toEqual(["yes", "no", "unknown"]);
    expect(SWEEP_MODES).toEqual(["natural-sweep", "rich-session"]);
  });

  it("derives the capture mode from the photo setting until a sidecar says", () => {
    expect(captureModeOf("real-use")).toBe("shopper-still");
    for (const s of ["whole-12", "whole-48", "shelf-48", "overview", "shelf-pass-2"]) expect(captureModeOf(s)).toBe("protocol-still");
  });

  it("classes Apple's model names by rear depth, and refuses what it does not know", () => {
    expect(deviceClassOf("Apple iPhone 17 Pro")).toBe("metric-depth");
    expect(deviceClassOf("Apple iPhone 12 Pro Max")).toBe("metric-depth");
    expect(deviceClassOf("Apple iPhone 11 Pro")).toBe("relative-stereo");
    expect(deviceClassOf("Apple iPhone 16")).toBe("relative-stereo");
    expect(deviceClassOf("Apple iPhone 13 mini")).toBe("relative-stereo");
    expect(deviceClassOf("Apple iPhone XS Max")).toBe("relative-stereo");
    expect(deviceClassOf("Apple iPhone 8 Plus")).toBe("relative-stereo");
    expect(deviceClassOf("Apple iPhone 16e")).toBe("none");
    expect(deviceClassOf("Apple iPhone SE")).toBe("none");
    expect(deviceClassOf("Apple iPhone XR")).toBe("none");
    expect(deviceClassOf("Apple iPhone 8")).toBe("none");
    expect(deviceClassOf("Apple iPad Pro")).toBeNull();
    expect(deviceClassOf("Google Pixel 9")).toBeNull();
    expect(deviceClassOf("")).toBeNull();
  });
});

describe("the fields on a label row", () => {
  it("come from the photo's manifest row and the labelling card", () => {
    const m = manifestOf([photoInput({ bookcaseId: "case-a", storeId: "s" })]);
    const r = rowOf(m.photos[0]!);
    expect(r.schemaVersion).toBe(2);
    expect([r.deviceClass, r.lens, r.captureMode, r.caseId, r.dupClusterId, r.labelSource, r.rgbRecoverable]).toEqual(["metric-depth", "ultra-wide", "shopper-still", "case-a", null, "single-view", "yes"]);
    expect(() => assertExportable([r], m)).not.toThrow();
  });

  it("caseId is the existing bookcaseId: null on a still with none, required on a sweep row", () => {
    const still = rowOf(manifestOf([photoInput()]).photos[0]!);
    expect(still.caseId).toBeNull();
    for (const mode of SWEEP_MODES) {
      expect(() => LabelRow.parse({ ...still, captureMode: mode })).toThrow(/must name its case/);
      expect(() => ManifestPhoto.parse({ ...manifestOf([photoInput()]).photos[0]!, captureMode: mode })).toThrow(/must name its case/);
      expect(() => LabelRow.parse({ ...still, captureMode: mode, caseId: "case-a" })).not.toThrow();
    }
  });

  it("refuses a value outside the vocabulary", () => {
    const r = rowOf(manifestOf([photoInput()]).photos[0]!);
    expect(() => LabelRow.parse({ ...r, deviceClass: "lidar" })).toThrow();
    expect(() => LabelRow.parse({ ...r, captureMode: "live" })).toThrow();
    expect(() => LabelRow.parse({ ...r, labelSource: "hand" })).toThrow();
    expect(() => LabelRow.parse({ ...r, rgbRecoverable: true })).toThrow();
  });

  it("the export check refuses a row whose provenance differs from its photo's", () => {
    const m = manifestOf([photoInput()]);
    const r = rowOf(m.photos[0]!);
    expect(() => assertExportable([{ ...r, deviceClass: "none" }], m)).toThrow(/capture provenance differs/);
    expect(() => assertExportable([{ ...r, caseId: "case-b" }], m)).toThrow(/capture provenance differs/);
  });

  it("counts the fields with no case or cluster ids in the aggregates", () => {
    const m = manifestOf([photoInput({ bookcaseId: "secret-case-id", storeId: "s" })]);
    const c = labelCounts([rowOf(m.photos[0]!), rowOf(m.photos[0]!, { labelSource: "mono-geometry", rgbRecoverable: "unknown" })]);
    expect(c.deviceClass.all).toEqual({ "metric-depth": 2, "relative-stereo": 0, none: 0 });
    expect(c.captureMode.all["shopper-still"]).toBe(2);
    expect(c.labelSource.all).toMatchObject({ "single-view": 1, "mono-geometry": 1 });
    expect(c.rgbRecoverable.all).toMatchObject({ yes: 1, unknown: 1 });
    expect(c.withCase).toBe(2);
    expect(JSON.stringify(c)).not.toMatch(/secret-case-id/);
  });
});

describe("rows and manifests written before NS-4 are read with defaults", () => {
  const legacyRow = () => {
    const { deviceClass: _d, lens: _l, captureMode: _c, caseId: _i, dupClusterId: _u, labelSource: _s, rgbRecoverable: _r, ...rest } = rowOf(manifestOf([photoInput()]).photos[0]!);
    return { ...rest, schemaVersion: 1 };
  };

  it("a schema-1 label row gets the legacy provenance and this schema's version", () => {
    const r = parseLabelRow(legacyRow());
    expect(r.schemaVersion).toBe(TS0.schemaVersion);
    expect(r).toMatchObject(LEGACY_LABEL_PROVENANCE);
    expect(LEGACY_LABEL_PROVENANCE).toEqual({ deviceClass: "metric-depth", lens: "unknown", captureMode: "shopper-still", caseId: null, dupClusterId: null, labelSource: "single-view", rgbRecoverable: "yes" });
    // The bare schema refuses it: the conversion is the reader's, on purpose.
    expect(() => LabelRow.parse(legacyRow())).toThrow();
    // An unknown schema is refused, not converted.
    expect(() => parseLabelRow({ ...legacyRow(), schemaVersion: 3 })).toThrow();
  });

  it("a schema-1 manifest gets the legacy provenance on every photo", () => {
    const built = manifestOf([photoInput()]).photos.map((p) => {
      const { deviceClass: _d, lens: _l, captureMode: _c, dupClusterId: _u, ...rest } = p;
      return rest;
    });
    const m = readDatasetManifest({ schemaVersion: 1, dataset: "label-ledger", version: "v-000000000000", constants: { captureGapSeconds: 120, nearDuplicateBits: 8, valShare: 0.2, seed: 1, heldOutSessions: [] }, photos: built });
    expect(m.schemaVersion).toBe(DATASET.schemaVersion);
    expect(m.photos[0]).toMatchObject(LEGACY_PROVENANCE);
    expect(() => readDatasetManifest({ schemaVersion: 1, dataset: "label-ledger", version: "v-000000000000", constants: {}, photos: "no" })).toThrow();
  });
});

describe("the schema bump is refused by DL-3's reader until the dataset is rebuilt", () => {
  const dir = mkdtempSync(join(tmpdir(), "ns4-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("a version stamped with schema 1 is stale, naming schema.version", () => {
    expect(DATASET_SCHEMA).toEqual({ name: "ts0/label-ledger", version: 2 });
    const file = join(dir, "build.json");
    writeFileSync(file, "{}\n");
    writeLineage(file, makeStamp({ schema: { name: "ts0/label-ledger", version: 1 }, boxSet: hex(1), models: { alpha: "sha256:a" }, catalog: "sha256:c" }));
    expect(() => checkLineage(file, { schema: DATASET_SCHEMA, models: { alpha: "sha256:a" }, catalog: "sha256:c" })).toThrow(/stale: schema\.version is 1 in the stamp, 2 now: rebuild it/);
    try {
      checkLineage(file, { schema: DATASET_SCHEMA });
    } catch (e) {
      expect(e).toBeInstanceOf(LineageError);
      expect((e as LineageError).field).toBe("schema.version");
    }
    writeLineage(file, makeStamp({ schema: DATASET_SCHEMA, boxSet: hex(1), models: { alpha: "sha256:a" }, catalog: "sha256:c" }));
    expect(() => checkLineage(file, { schema: DATASET_SCHEMA, models: { alpha: "sha256:a" }, catalog: "sha256:c" })).not.toThrow();
  });
});

describe("near-duplicate clusters", () => {
  it("are the connected components of the near-duplicate pairs, named only for photos that have one", () => {
    expect(dupClusters(5, [[0, 1], [1, 2], [3, 4]])).toEqual([0, 0, 0, 1, 1]);
    expect(dupClusters(3, [])).toEqual([0, 1, 2]);
    const same = "0000000000000000", far = "ffffffffffffffff";
    const photos = [photoInput({ sha256: hex(1), dhash: same }), photoInput({ sha256: hex(2), dhash: same }), photoInput({ sha256: hex(3), dhash: far })];
    const rows = buildManifestPhotos(photos, null).photos;
    expect(rows.map((p) => p.dupClusterId)).toEqual([`dc:pilot-000:${hex(1)}`, `dc:pilot-000:${hex(1)}`, null]);
    expect(manifestCounts(rows).dupClusters).toBe(1);
    expect(manifestCounts(rows).byDeviceClass).toEqual({ "metric-depth": 3, "relative-stereo": 0, none: 0 });
  });
});

describe("DL-5's gap: a held-out session is manifested and frozen, never exported", () => {
  const reg: SetRegistry = { "pilot-000": "training-source", "sf-store-002": "held-out", "lib-yard": "yardstick", "lib-proxy": "proxy", "pilot-audit": "audit" };

  it("the manifest guard admits training sources and held-out sessions only, fail closed, then by name", () => {
    expect(MANIFEST_ROLES).toEqual(["training-source", "held-out"]);
    expect(manifestRefusal("pilot-000", reg)).toBeNull();
    expect(manifestRefusal("sf-store-002", reg)).toBeNull();
    expect(manifestRefusal("sf-store-003", reg)).toBe("undeclared");
    for (const s of ["lib-yard", "lib-proxy", "pilot-audit"]) expect(manifestRefusal(s, reg)).toBe("role");
    expect(manifestRefusal("held-yardstick", { "held-yardstick": "held-out" })).toBe("name");
    expect(() => assertManifestable("sf-store-003", "TS-0", reg)).toThrow(/no declared set role and is never exported for training or manifested/);
    expect(() => assertManifestable("lib-yard", "TS-0", reg)).toThrow(/is a yardstick set and is never exported/);
    for (const role of SET_ROLES) expect(manifestRefusal("x", { x: role }) === null).toBe(MANIFEST_ROLES.includes(role));
    expect(heldOutSessions(reg)).toEqual(["sf-store-002"]);
  });

  it("its photos sit in the manifest with the split frozen as held-out", () => {
    const held = photoInput({ sha256: hex(9), session: "sf-store-002" });
    const m = manifestOf([photoInput(), held], ["sf-store-002"]);
    expect(m.photos.find((p) => p.session === "sf-store-002")!.split).toBe("held-out");
    expect(() => assertExportable([rowOf(m.photos.find((p) => p.session === "pilot-000")!)], m)).not.toThrow();
  });

  it("the registry's held-out sessions are frozen held-out even when F-1's constant does not name them", () => {
    const held = photoInput({ sha256: hex(9), session: "sf-store-002" });
    const { frozen } = buildManifestPhotos([photoInput(), held], null, { ...DATASET, heldOutSessions: [...DATASET.heldOutSessions, ...heldOutSessions()] });
    expect(frozen.photos[hex(9)]).toBe("held-out");
  });

  it("a row on one of its photos is refused: never exported for training", () => {
    const held = photoInput({ sha256: hex(9), session: "sf-store-002" });
    const m = manifestOf([photoInput(), held], ["sf-store-002"]);
    const heldPhoto = m.photos.find((p) => p.session === "sf-store-002")!;
    // labelRow itself refuses the set; a row smuggled onto a held-out photo under a trainable set name is refused by the export check.
    expect(() => rowOf(m.photos.find((p) => p.session === "pilot-000")!, { set: "sf-store-002" })).toThrow(/held-out set and is never exported/);
    const good = rowOf(m.photos.find((p) => p.session === "pilot-000")!);
    const smuggled: LabelRow = { ...good, imageSha256: heldPhoto.sha256, split: heldPhoto.split, captureGroup: heldPhoto.captureGroup, splitGroup: heldPhoto.splitGroup };
    expect(() => assertExportable([smuggled], m)).toThrow(/held-out set and is never exported/);
  });

  it("a yardstick, PROXY or audit session is still never manifested", () => {
    const m = manifestOf([photoInput(), photoInput({ sha256: hex(9), session: "yardstick" })]);
    expect(() => assertExportable([], m)).toThrow(/is a yardstick set and is never exported for training or manifested/);
  });

  it("the build manifests a held-out session only when its fixture ledger is at the data root", () => {
    const root = mkdtempSync(join(tmpdir(), "ns4-root-"));
    try {
      expect(manifestSessions(root, ["pilot-000"])).toEqual({ sessions: ["pilot-000"], heldOut: [] });
      const ledger = sessionLedgerPath(root, "sf-store-002");
      mkdirSync(join(ledger, ".."), { recursive: true });
      writeFileSync(ledger, "");
      expect(existsSync(ledger)).toBe(true);
      expect(manifestSessions(root, ["pilot-000"])).toEqual({ sessions: ["pilot-000", "sf-store-002"], heldOut: ["sf-store-002"] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
