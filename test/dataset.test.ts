// F-1: dataset manifest, grouped splits, near-duplicate flags (src/capture/dataset.ts, src/capture/phash.ts).
import { describe, expect, it } from "vitest";
import {
  assignSplits,
  buildManifestPhotos,
  captureGroups,
  DATASET,
  hamming,
  ManifestPhoto,
  manifestCounts,
  nearDuplicatePairs,
  splitGroups,
  straddlingGroups,
  type DatasetPhotoInput,
  type FrozenSplits,
} from "../src/capture/dataset.ts";
import { bmpGrey, dhash, DHASH_H, DHASH_W } from "../src/capture/phash.ts";
import { rng } from "../src/eval/q1.ts";

const hex = (n: number) => n.toString(16).padStart(64, "0");
const at = (s: number) => new Date(Date.UTC(2026, 9, 31, 12) + s * 1000).toISOString();
const photo = (i: number, over: Partial<DatasetPhotoInput> = {}): DatasetPhotoInput => ({
  sha256: hex(i + 1),
  originalSha256: hex(1000 + i),
  path: `images/sha256/00/00/${hex(i + 1)}.jpg`,
  size: 100,
  session: "pilot-000",
  storeId: null,
  bookcaseId: null,
  shelf: null,
  setting: "real-use",
  capturedAt: at(i * 600),
  dhash: null,
  ...over,
});

describe("dHash", () => {
  it("sets a bit where the left pixel is brighter, row by row", () => {
    const rising = Array.from({ length: DHASH_W * DHASH_H }, (_, i) => i % DHASH_W);
    expect(dhash(rising)).toBe("0000000000000000");
    expect(dhash(rising.map((v) => 8 - v))).toBe("ffffffffffffffff");
    const firstRowFalls = rising.map((v, i) => (i < DHASH_W ? 8 - v : v));
    expect(dhash(firstRowFalls)).toBe("ff00000000000000");
  });

  it("refuses a grid of the wrong size", () => {
    expect(() => dhash([1, 2, 3])).toThrow(/72 pixels/);
  });

  it("reads a bottom-up 24-bit BMP top row first", () => {
    const w = 3, h = 2, stride = 12;
    const buf = Buffer.alloc(54 + stride * h);
    buf.write("BM", 0, "latin1");
    buf.writeUInt32LE(54, 10);
    buf.writeInt32LE(w, 18);
    buf.writeInt32LE(h, 22);
    buf.writeUInt16LE(24, 28);
    // Stored bottom row first: the bottom row is white, the top row black.
    for (let x = 0; x < w; x++) buf.fill(255, 54 + x * 3, 54 + x * 3 + 3);
    const { width, height, grey } = bmpGrey(buf);
    expect([width, height]).toEqual([3, 2]);
    expect([...grey]).toEqual([0, 0, 0, 255, 255, 255]);
  });

  it("counts differing bits", () => {
    expect(hamming("0000000000000000", "0000000000000000")).toBe(0);
    expect(hamming("0000000000000000", "ffffffffffffffff")).toBe(64);
    expect(hamming("00000000000000f0", "0000000100000000")).toBe(5);
  });
});

describe("capture groups and split groups", () => {
  it("cuts a session's capture order at gaps over the threshold", () => {
    const ps = [0, 30, 60, 60 + DATASET.captureGapSeconds + 1, 60 + DATASET.captureGapSeconds + 100].map((s, i) => photo(i, { capturedAt: at(s) }));
    expect(captureGroups(ps)).toEqual([0, 0, 0, 1, 1]);
  });

  it("never joins two sessions on time, and keeps a session's untimed photos together", () => {
    const ps = [photo(0, { capturedAt: at(0) }), photo(1, { session: "b", capturedAt: at(1) }), photo(2, { capturedAt: null }), photo(3, { capturedAt: null })];
    expect(captureGroups(ps)).toEqual([0, 1, 2, 2]);
  });

  it("joins one bookcase across sessions (within its store) and near-duplicates anywhere", () => {
    const ps = [
      photo(0, { bookcaseId: "case-1", storeId: "s1" }),
      photo(1, { session: "b", bookcaseId: "case-1", storeId: "s1" }),
      photo(2, { session: "c", bookcaseId: "case-1", storeId: "s2" }),
      photo(3, { session: "d" }),
      photo(4, { session: "e" }),
    ];
    const cap = captureGroups(ps);
    expect(new Set(cap).size).toBe(5);
    expect(splitGroups(ps, cap, [[3, 4]])).toEqual([0, 0, 1, 2, 2]);
  });

  it("flags near-duplicates within the bit threshold only", () => {
    const pairs = nearDuplicatePairs(["0000000000000000", "00000000000000ff", "0000000000000fff", null], 8);
    expect(pairs).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });
});

describe("splits", () => {
  it("fills val from whole groups to about its share, the rest to train", () => {
    const ps = Array.from({ length: 40 }, (_, i) => photo(i));
    const groups = ps.map((_, i) => Math.floor(i / 2));
    const s = assignSplits(ps, groups, null);
    const val = s.filter((x) => x === "val").length;
    expect(val).toBeGreaterThanOrEqual(8);
    expect(val).toBeLessThanOrEqual(12);
    expect(s.filter((x) => x === "held-out")).toEqual([]);
  });

  it("holds out a reserved session's groups, whatever the seed", () => {
    const ps = [photo(0), photo(1, { session: "sf-store-002" }), photo(2, { session: "sf-store-002" })];
    expect(assignSplits(ps, [0, 1, 1], null).slice(1)).toEqual(["held-out", "held-out"]);
  });

  it("keeps frozen assignments, and a group touching a frozen held-out photo is held out", () => {
    const ps = Array.from({ length: 6 }, (_, i) => photo(i));
    const frozen: FrozenSplits = { seed: 1, photos: { [hex(1)]: "val", [hex(3)]: "held-out", [hex(4)]: "train" } };
    // Photos 2 and 3 now share a group (say a near-duplicate found later): the held-out side wins.
    const s = assignSplits(ps, [0, 1, 2, 2, 3, 4], frozen);
    expect(s[0]).toBe("val");
    expect(s[2]).toBe("held-out");
    expect(s[3]).toBe("held-out");
  });

  it("is deterministic for the same photos and seed", () => {
    const ps = Array.from({ length: 30 }, (_, i) => photo(i));
    const g = ps.map((_, i) => i % 7);
    expect(assignSplits(ps, g, null)).toEqual(assignSplits([...ps], [...g], null));
  });
});

describe("no group straddles splits (F-1 exit test)", () => {
  const random = (seed: number): { photos: DatasetPhotoInput[]; frozen: FrozenSplits | null } => {
    const r = rng(seed);
    const n = 5 + Math.floor(r() * 60);
    const sessions = ["pilot-000", "sf-store-001", "sf-store-002", "sf-store-003"];
    const cases = ["c1", "c2", "c3", null, null];
    const hashes = Array.from({ length: 6 }, () => Math.floor(r() * 0xffff).toString(16).padStart(4, "0").repeat(4));
    const photos = Array.from({ length: n }, (_, i) =>
      photo(i, {
        session: sessions[Math.floor(r() * sessions.length)]!,
        bookcaseId: cases[Math.floor(r() * cases.length)]!,
        storeId: r() < 0.5 ? "s1" : "s2",
        capturedAt: r() < 0.1 ? null : at(Math.floor(r() * 5000)),
        // A few shared dHashes, so near-duplicates join groups across sessions and capture groups.
        dhash: r() < 0.3 ? hashes[Math.floor(r() * hashes.length)]! : r() < 0.9 ? Math.floor(r() * 2 ** 31).toString(16).padStart(16, "0") : null,
      }),
    );
    const frozen = r() < 0.5 ? null : { seed: 1, photos: Object.fromEntries(photos.filter(() => r() < 0.3).map((p) => [p.sha256, (["train", "val", "held-out"] as const)[Math.floor(r() * 3)]!])) };
    return { photos, frozen };
  };

  it.each(Array.from({ length: 200 }, (_, i) => i + 1))("seed %i: capture groups, bookcases and near-duplicates each sit in one split", (seed) => {
    const { photos, frozen } = random(seed);
    const { photos: rows, frozen: next } = buildManifestPhotos(photos, frozen);
    expect(straddlingGroups(rows)).toEqual([]);
    const byHash = new Map(rows.map((r) => [r.sha256, r]));
    const splitOf = (p: DatasetPhotoInput) => byHash.get(p.sha256)!.split;
    // Same bookcase (in one store): one split. Near-duplicates: one split. Reserved session: held out.
    for (const a of photos)
      for (const b of photos) {
        if (a.bookcaseId !== null && a.bookcaseId === b.bookcaseId && a.storeId === b.storeId) expect(splitOf(a)).toBe(splitOf(b));
        if (byHash.get(a.sha256)!.nearDuplicates.includes(b.sha256)) expect(splitOf(a)).toBe(splitOf(b));
      }
    for (const p of photos) if (p.session === "sf-store-002" && !frozen?.photos[p.sha256]) expect(["held-out", ...Object.values(frozen?.photos ?? {})]).toContain(splitOf(p));
    // Every photo is recorded in the frozen assignments, and a second build changes nothing.
    expect(Object.keys(next.photos)).toEqual(expect.arrayContaining(photos.map((p) => p.sha256)));
    expect(buildManifestPhotos(photos, next).photos).toEqual(rows);
  });

  it("the straddle check itself catches a straddling group", () => {
    const row = (split: "train" | "val", g: string) => ({ captureGroup: g, splitGroup: g, split });
    expect(straddlingGroups([row("train", "a"), row("val", "a"), row("val", "b")])).toEqual(["a"]);
  });
});

describe("manifest rows", () => {
  it("carry no capture instant and validate strictly", () => {
    const { photos } = buildManifestPhotos([photo(0), photo(1)], null);
    for (const p of photos) {
      expect(p).not.toHaveProperty("capturedAt");
      expect(() => ManifestPhoto.parse({ ...p, capturedAt: "x" })).toThrow();
    }
  });

  it("refuse a photo listed twice", () => {
    expect(() => buildManifestPhotos([photo(0), photo(0)], null)).toThrow(/twice/);
  });

  it("count groups and near-duplicates without hashes or paths", () => {
    const ps = [photo(0, { dhash: "0000000000000000" }), photo(1, { dhash: "0000000000000001", capturedAt: at(50000) }), photo(2)];
    const counts = manifestCounts(buildManifestPhotos(ps, null).photos);
    expect(counts.nearDuplicatePairs).toEqual({ all: 1, acrossCaptureGroups: 1 });
    expect(counts.straddling).toBe(0);
    expect(JSON.stringify(counts)).not.toMatch(/[0-9a-f]{12}|images\//);
  });
});
