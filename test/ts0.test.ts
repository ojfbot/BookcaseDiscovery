// TS-0: the label ledger export (src/eval/ts0.ts): bases, TS-1's filter fields, the strong class, OC35 and OC36.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildManifestPhotos, type DatasetPhotoInput, type ManifestPhoto } from "../src/capture/dataset.ts";
import { build } from "../src/eval/ts0-cli.ts";
import {
  assertExportable,
  assertMachineBasis,
  assertTrainable,
  canonicalJson,
  isStrong,
  labelCounts,
  labelOf,
  labelRow,
  LabelRow,
  versionKey,
  type BoxEvidence,
  type RowContext,
} from "../src/eval/ts0.ts";

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
  ...over,
});
const manifestOf = (photos: DatasetPhotoInput[]) => ({ version: "v-000000000000", photos: buildManifestPhotos(photos, null).photos });
const PHOTO: ManifestPhoto = manifestOf([photoInput()]).photos[0]!;

const box = (over: Partial<BoxEvidence["decision"]> = {}, rest: Partial<BoxEvidence> = {}): BoxEvidence => ({
  id: `${IMG}:3`,
  imageId: IMG,
  decision: { top: { vision: "w1", ppocr: "w1" }, confirmed: { vision: "w1", ppocr: "w1" }, accepted: "w1", agreeing: ["vision", "ppocr"], ...over },
  copy: null,
  context: null,
  ...rest,
});
const ctx = (over: Partial<RowContext> = {}): RowContext => ({
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
  photo: PHOTO,
  ...over,
});
const rowOf = (e: BoxEvidence, c: Partial<RowContext> = {}) => {
  const l = labelOf(e);
  if (!l || l === "conflict") throw new Error("no label");
  return labelRow(e, l, ctx(c));
};

describe("which label a box gets", () => {
  it("F-0's accept is `readers-agree`, ahead of copy and context", () => {
    expect(labelOf(box({}, { copy: { workId: "w2", readers: ["vision"] } }))).toEqual({ basis: "readers-agree", workId: "w1", readers: ["vision", "ppocr"] });
  });

  it("an unconfirmed box takes F-0g's copy or F-0h's context basis", () => {
    const un = { accepted: null, agreeing: [] };
    expect(labelOf(box(un, { copy: { workId: "w2", readers: ["ppocr", "vision"] } }))).toEqual({ basis: "confirmed-by-copy", workId: "w2", readers: ["vision", "ppocr"] });
    expect(labelOf(box(un, { context: { workId: "w3", readers: ["qwen"] } }))).toEqual({ basis: "confirmed-by-context", workId: "w3", readers: ["qwen"] });
    // Copy and context agreeing: the copy basis, F-0g's being the earlier card.
    expect(labelOf(box(un, { copy: { workId: "w2", readers: ["ppocr"] }, context: { workId: "w2", readers: ["vision"] } }))).toEqual({ basis: "confirmed-by-copy", workId: "w2", readers: ["ppocr"] });
  });

  it("copy and context naming different works is a conflict, never a label", () => {
    expect(labelOf(box({ accepted: null, agreeing: [] }, { copy: { workId: "w2", readers: [] }, context: { workId: "w3", readers: [] } }))).toBe("conflict");
  });

  it("an unconfirmed box with no raised basis has no label", () => {
    expect(labelOf(box({ accepted: null, agreeing: [] }))).toBeNull();
  });
});

describe("TS-1's label-filter fields", () => {
  it("records the agreeing pair, and V+P labels have no third reader", () => {
    const r = rowOf(box());
    expect(r.agreeing).toBe("vision+ppocr");
    expect(r.thirdReader).toEqual({ reader: "qwen", outcome: "not-read" });
    expect(r.dissenting).toEqual([]);
  });

  it("a third reader confirming another work dissents", () => {
    const r = rowOf(box({ top: { vision: "w1", qwen: "w1", ppocr: "w9" }, confirmed: { vision: "w1", qwen: "w1", ppocr: "w9" }, agreeing: ["vision", "qwen"] }));
    expect(r.agreeing).toBe("vision+qwen");
    expect(r.thirdReader).toEqual({ reader: "ppocr", outcome: "dissents" });
    expect(r.dissenting).toEqual(["ppocr"]);
    expect(r.strong).toBe(false);
  });

  it("a third reader whose top is the label's work supports it", () => {
    const r = rowOf(box({ top: { vision: "w1", qwen: "w1", ppocr: "w1" }, confirmed: { vision: "w1", qwen: "w1", ppocr: null }, agreeing: ["vision", "qwen"] }));
    expect(r.thirdReader).toEqual({ reader: "ppocr", outcome: "supports" });
    expect(r.strong).toBe(true);
  });

  it("C-7's backing is kept for shared titles only", () => {
    const backing = { namesakeTest: false, authorRead: true };
    expect(rowOf(box(), { rarity: "shared", backing }).sharedBacking).toEqual(backing);
    expect(rowOf(box(), { rarity: "distinctive", backing }).sharedBacking).toBeNull();
  });

  it("a work with no own title form counts as shared, the cautious side", () => {
    const r = rowOf(box(), { rarity: null });
    expect(r.titleClass).toBe("shared");
    expect(r.strong).toBe(false);
  });
});

describe("the strong class is flagged, never filtered", () => {
  it("needs a distinctive title, two agreeing readers and no dissent", () => {
    const base = { basis: "readers-agree" as const, titleClass: "distinctive" as const, readers: ["vision", "ppocr"] as const, dissenting: [], thirdReader: null };
    expect(isStrong({ ...base, readers: [...base.readers] })).toBe(true);
    expect(isStrong({ ...base, readers: [...base.readers], titleClass: "shared" })).toBe(false);
    expect(isStrong({ ...base, readers: ["vision"] })).toBe(false);
    expect(isStrong({ ...base, readers: [...base.readers], basis: "confirmed-by-context" })).toBe(false);
    expect(isStrong({ ...base, readers: [...base.readers], dissenting: ["qwen"] })).toBe(false);
  });

  it("weak labels are rows too, with strong: false", () => {
    const rows = [rowOf(box()), rowOf(box(), { rarity: "shared" }), rowOf(box({ accepted: null, agreeing: [] }, { context: { workId: "w3", readers: ["qwen"] } }), { rung: "matched" })];
    expect(rows.map((r) => r.strong)).toEqual([true, false, false]);
    expect(rows.map((r) => r.basis)).toEqual(["readers-agree", "readers-agree", "confirmed-by-context"]);
  });
});

describe("OC35: yardstick and audit sets are never exported", () => {
  it.each(["yardstick", "yardstick-library-b2", "proxy-library", "pilot-000-audit", "sf-store-001-AUDIT-slice"])("refuses %s", (set) => {
    expect(() => assertTrainable(set)).toThrow(/never exported/);
  });

  it.each(["pilot-000", "sf-store-001", "sf-store-002"])("allows %s", (set) => {
    expect(() => assertTrainable(set)).not.toThrow();
  });

  it("a row from a yardstick set cannot be made", () => {
    expect(() => rowOf(box(), { set: "yardstick" })).toThrow(/never exported/);
  });

  it("the export check refuses a yardstick row and a yardstick photo in the manifest", () => {
    const good = rowOf(box());
    const m = manifestOf([photoInput()]);
    expect(() => assertExportable([good], m)).not.toThrow();
    expect(() => assertExportable([{ ...good, set: "yardstick-library-b2" }], m)).toThrow(/never exported/);
    const withYard = manifestOf([photoInput(), photoInput({ sha256: hex(9), session: "yardstick" })]);
    expect(() => assertExportable([good], withYard)).toThrow(/never exported/);
  });

  it("the export check refuses a row whose photo is not in the manifest, or whose split differs", () => {
    const good = rowOf(box());
    expect(() => assertExportable([{ ...good, imageSha256: hex(99) }], manifestOf([photoInput()]))).toThrow(/not in the manifest/);
    expect(() => assertExportable([{ ...good, split: good.split === "val" ? "train" : "val" }], manifestOf([photoInput()]))).toThrow(/split/);
  });

  it("`build` refuses a yardstick set before it reads anything", () => {
    const empty = mkdtempSync(join(tmpdir(), "ts0-"));
    expect(() => build(["yardstick-library-b2"], empty)).toThrow(/never exported/);
    expect(() => build(["pilot-000", "yardstick"], empty)).toThrow(/never exported/);
  });
});

describe("OC36: machine bases only, no hand labels", () => {
  it.each(["user-asserted", "identity-corrected", "owner", "confirmed-by-pooling", ""])("refuses basis %j", (b) => {
    expect(() => assertMachineBasis(b)).toThrow(/OC36/);
  });

  it("a row with a non-machine basis fails the schema and the export check", () => {
    const good = rowOf(box());
    expect(() => LabelRow.parse({ ...good, basis: "user-asserted" })).toThrow();
    expect(() => assertExportable([{ ...good, basis: "user-asserted" as never }], manifestOf([photoInput()]))).toThrow(/OC36/);
  });
});

describe("version key (INV-14)", () => {
  it("is deterministic from the box-set and model-revision hashes, and moves with either", () => {
    const v = versionKey(hex(1), hex(2));
    expect(v).toMatch(/^v-[0-9a-f]{12}$/);
    expect(versionKey(hex(1), hex(2))).toBe(v);
    expect(versionKey(hex(3), hex(2))).not.toBe(v);
    expect(versionKey(hex(1), hex(3))).not.toBe(v);
  });

  it("canonical JSON ignores key order", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }));
  });

  it("every row carries the version, box set and model revision", () => {
    const r = rowOf(box());
    expect([r.version, r.boxSet, r.modelRevision]).toEqual(["v-000000000000", hex(1), hex(2)]);
  });
});

describe("aggregates", () => {
  it("count by class, basis, rung and split with no ids, titles or paths", () => {
    const rows = [rowOf(box()), rowOf(box(), { rarity: "shared", backing: { namesakeTest: true, authorRead: false }, work: { title: "Secret Title", authors: ["Someone"] } })];
    const c = labelCounts(rows);
    expect(c.labels).toBe(2);
    expect(c.strong.all).toEqual({ strong: 1, "not strong": 1 });
    expect(c.sharedBacking.all["namesake test"]).toBe(1);
    expect(c.rung.all.confirmed).toBe(2);
    const text = JSON.stringify(c);
    expect(text).not.toMatch(/Secret Title|Someone|w1|images\/|[0-9a-f]{16}/);
  });
});
