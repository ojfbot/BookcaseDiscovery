// F-1 · dataset manifest, grouped splits, near-duplicate flags (docs/plan/DELIVERY-PLAN.md §S10, docs/dataset.md).
//
// Every photo a dataset version uses gets one manifest row under `$BOOKCASE_DATA/datasets/` (private): its
// content-addressed path, hash, size, session, store, bookcase, shelf, setting, capture group, split group and split.
// A **split group** is the unit a split is assigned to, so nothing that could leak sits on both sides of a split: a
// capture group (one session's run of photos with no capture gap over `captureGapSeconds`), joined with every other
// photo of the same bookcase and every near-duplicate (a dHash within `nearDuplicateBits`). Pure, apart from nothing:
// the dHash itself is computed in `phash.ts`, the files are read by the `dataset` CLI. The repo holds only this schema
// and aggregate counts.
import { z } from "zod";

export const DATASET = {
  schemaVersion: 1,
  /** A run of one session's photos with no gap over this many seconds is one capture group (one case, one stand). */
  captureGapSeconds: 120,
  /** Two photos whose 64-bit dHashes differ in at most this many bits are near-duplicates. */
  nearDuplicateBits: 8,
  /** The share of trainable photos assigned to `val`, filled group by group in seeded order. */
  valShare: 0.2,
  seed: 1,
  /** Sessions whose photos are frozen held-out from the start (F-1: `sf-store-002` is reserved). */
  heldOutSessions: ["sf-store-002"] as readonly string[],
} as const;

export const SPLITS = ["train", "val", "held-out"] as const;
export type Split = (typeof SPLITS)[number];
/** Most conservative first: a group touching a frozen held-out photo is held out, one touching `val` is `val`. */
const SPLIT_RANK: Record<Split, number> = { "held-out": 0, val: 1, train: 2 };

/** One photo as the build reads it from a fixture's ledger, its private manifest and the image store. */
export interface DatasetPhotoInput {
  /** The working copy's SHA-256: the key every stage and box id uses. */
  sha256: string;
  /** The untouched original's SHA-256 (INV-12). */
  originalSha256: string;
  /** The working copy's path in the image store, relative to the data root. */
  path: string;
  size: number;
  session: string;
  storeId: string | null;
  bookcaseId: string | null;
  shelf: number | null;
  setting: string;
  /** ISO instant from the private fixture manifest; used for capture groups and never written to the manifest. */
  capturedAt: string | null;
  /** 64-bit dHash as 16 hex digits, or null when the photo could not be hashed. */
  dhash: string | null;
}

const Hex64 = z.string().regex(/^[0-9a-f]{64}$/);
export const ManifestPhoto = z.strictObject({
  sha256: Hex64,
  originalSha256: Hex64,
  path: z.string().regex(/^images\/sha256\//),
  size: z.number().int().nonnegative(),
  session: z.string().min(1),
  storeId: z.string().nullable(),
  bookcaseId: z.string().nullable(),
  shelf: z.number().int().nonnegative().nullable(),
  setting: z.string().min(1),
  dhash: z.string().regex(/^[0-9a-f]{16}$/).nullable(),
  captureGroup: z.string().min(1),
  splitGroup: z.string().min(1),
  split: z.enum(SPLITS),
  /** Working-copy hashes of this photo's near-duplicates, and whether one of them is in another capture group. */
  nearDuplicates: z.array(Hex64),
  crossGroupNearDuplicate: z.boolean(),
});
export type ManifestPhoto = z.infer<typeof ManifestPhoto>;

export const DatasetManifest = z.strictObject({
  schemaVersion: z.literal(DATASET.schemaVersion),
  dataset: z.string().min(1),
  version: z.string().regex(/^v-[0-9a-f]{12}$/),
  constants: z.strictObject({
    captureGapSeconds: z.number(),
    nearDuplicateBits: z.number(),
    valShare: z.number(),
    seed: z.number(),
    heldOutSessions: z.array(z.string()),
  }),
  photos: z.array(ManifestPhoto),
});
export type DatasetManifest = z.infer<typeof DatasetManifest>;

/** Frozen assignments: once a photo has a split it keeps it in every later version (F-1's frozen held-out groups). */
export interface FrozenSplits {
  seed: number;
  photos: Record<string, Split>;
}

// --- near-duplicates ----------------------------------------------------------------------------------------

export function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < a.length; i += 8) {
    let x = (parseInt(a.slice(i, i + 8), 16) ^ parseInt(b.slice(i, i + 8), 16)) >>> 0;
    while (x) (x &= x - 1), d++;
  }
  return d;
}

/** Every unordered pair of photos whose dHashes are within `bits`, as index pairs. */
export function nearDuplicatePairs(hashes: (string | null)[], bits: number = DATASET.nearDuplicateBits): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < hashes.length; i++)
    for (let j = i + 1; j < hashes.length; j++) {
      const a = hashes[i], b = hashes[j];
      if (a && b && hamming(a, b) <= bits) out.push([i, j]);
    }
  return out;
}

// --- groups ---------------------------------------------------------------------------------------------------

class UnionFind {
  readonly parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) i = this.parent[i] = this.parent[this.parent[i]!]!;
    return i;
  }
  union(a: number, b: number): void {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

const epoch = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t / 1000 : null;
};

/**
 * Capture groups: per session, photos in capture order split wherever the gap exceeds `gapSeconds`. A session's photos
 * with no capture instant form one group of their own (the conservative choice: they may be one stand). Returns each
 * photo's group index, numbered in input order of each group's first member.
 */
export function captureGroups(photos: Pick<DatasetPhotoInput, "session" | "capturedAt">[], gapSeconds: number = DATASET.captureGapSeconds): number[] {
  const uf = new UnionFind(photos.length);
  const bySession = new Map<string, number[]>();
  photos.forEach((p, i) => bySession.set(p.session, [...(bySession.get(p.session) ?? []), i]));
  for (const idx of bySession.values()) {
    const timed = idx.filter((i) => epoch(photos[i]!.capturedAt) !== null).sort((a, b) => epoch(photos[a]!.capturedAt)! - epoch(photos[b]!.capturedAt)! || a - b);
    for (let k = 1; k < timed.length; k++) {
      if (epoch(photos[timed[k]!]!.capturedAt)! - epoch(photos[timed[k - 1]!]!.capturedAt)! <= gapSeconds) uf.union(timed[k - 1]!, timed[k]!);
    }
    const untimed = idx.filter((i) => epoch(photos[i]!.capturedAt) === null);
    for (let k = 1; k < untimed.length; k++) uf.union(untimed[0]!, untimed[k]!);
  }
  return renumber(photos.map((_, i) => uf.find(i)));
}

/** Split groups: capture groups joined across the same bookcase (any session) and across near-duplicate pairs. */
export function splitGroups(photos: Pick<DatasetPhotoInput, "bookcaseId" | "storeId">[], capture: number[], nearPairs: [number, number][]): number[] {
  const uf = new UnionFind(photos.length);
  const firstOfCapture = new Map<number, number>();
  const firstOfCase = new Map<string, number>();
  photos.forEach((p, i) => {
    const c = capture[i]!;
    if (firstOfCapture.has(c)) uf.union(firstOfCapture.get(c)!, i);
    else firstOfCapture.set(c, i);
    if (p.bookcaseId !== null) {
      // A bookcase id is only unique within its store.
      const k = `${p.storeId ?? ""}\u0000${p.bookcaseId}`;
      if (firstOfCase.has(k)) uf.union(firstOfCase.get(k)!, i);
      else firstOfCase.set(k, i);
    }
  });
  for (const [a, b] of nearPairs) uf.union(a, b);
  return renumber(photos.map((_, i) => uf.find(i)));
}

function renumber(roots: number[]): number[] {
  const ids = new Map<number, number>();
  return roots.map((r) => {
    if (!ids.has(r)) ids.set(r, ids.size);
    return ids.get(r)!;
  });
}

// --- splits ---------------------------------------------------------------------------------------------------

/** A seeded, stable order key for a group (FNV-1a over the seed and its smallest member hash). */
export function orderKey(seed: number, groupKey: string): number {
  let h = 0x811c9dc5 ^ seed;
  for (const ch of `${seed}:${groupKey}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Assign each split group one split (GroupShuffleSplit-style). In order: a group with a frozen photo takes the most
 * conservative frozen split among its photos; a group with a photo from a held-out session is `held-out`; the rest,
 * in seeded order, go to `val` while it is under its share of the trainable photos and the group does not overshoot
 * it by more than half, else to `train`. Returns each photo's split.
 */
export function assignSplits(
  photos: Pick<DatasetPhotoInput, "sha256" | "session">[],
  groups: number[],
  frozen: FrozenSplits | null,
  constants: { valShare: number; seed: number; heldOutSessions: readonly string[] } = DATASET,
): Split[] {
  const members = new Map<number, number[]>();
  groups.forEach((g, i) => members.set(g, [...(members.get(g) ?? []), i]));
  const split = new Map<number, Split>();
  for (const [g, idx] of members) {
    const pinned = idx.map((i) => frozen?.photos[photos[i]!.sha256]).filter((s): s is Split => !!s);
    if (pinned.length) split.set(g, pinned.sort((a, b) => SPLIT_RANK[a] - SPLIT_RANK[b])[0]!);
    else if (idx.some((i) => constants.heldOutSessions.includes(photos[i]!.session))) split.set(g, "held-out");
  }
  const trainable = [...members].filter(([g]) => split.get(g) !== "held-out").reduce((s, [, idx]) => s + idx.length, 0);
  const target = constants.valShare * trainable;
  let val = [...members].filter(([g]) => split.get(g) === "val").reduce((s, [, idx]) => s + idx.length, 0);
  const open = [...members]
    .filter(([g]) => !split.has(g))
    .map(([g, idx]) => ({ g, n: idx.length, key: orderKey(constants.seed, idx.map((i) => photos[i]!.sha256).sort()[0]!) }))
    .sort((a, b) => a.key - b.key || a.g - b.g);
  for (const o of open) {
    if (val < target && val + o.n <= target * 1.5) {
      split.set(o.g, "val");
      val += o.n;
    } else split.set(o.g, "train");
  }
  return groups.map((g) => split.get(g)!);
}

// --- manifest -------------------------------------------------------------------------------------------------

/** A group's name in the manifest: its session(s) and its smallest member hash, short. Private like the rest. */
const groupName = (prefix: string, idx: number[], photos: DatasetPhotoInput[]): string =>
  `${prefix}:${[...new Set(idx.map((i) => photos[i]!.session))].sort().join("+")}:${idx.map((i) => photos[i]!.sha256).sort()[0]!}`;

/** The manifest's photo rows and the frozen assignments to write back. Throws on a duplicate photo. */
export function buildManifestPhotos(
  photos: DatasetPhotoInput[],
  frozen: FrozenSplits | null,
  constants: typeof DATASET = DATASET,
): { photos: ManifestPhoto[]; frozen: FrozenSplits } {
  const seen = new Set<string>();
  for (const p of photos) {
    if (seen.has(p.sha256)) throw new Error("dataset: a photo is listed twice");
    seen.add(p.sha256);
  }
  const capture = captureGroups(photos, constants.captureGapSeconds);
  const near = nearDuplicatePairs(photos.map((p) => p.dhash), constants.nearDuplicateBits);
  const groups = splitGroups(photos, capture, near);
  const splits = assignSplits(photos, groups, frozen, constants);
  const idxOf = (ids: number[]) => {
    const m = new Map<number, number[]>();
    ids.forEach((g, i) => m.set(g, [...(m.get(g) ?? []), i]));
    return m;
  };
  const captureIdx = idxOf(capture), groupIdx = idxOf(groups);
  const partners = photos.map(() => [] as number[]);
  for (const [a, b] of near) partners[a]!.push(b), partners[b]!.push(a);
  const rows = photos.map((p, i) => {
    const { capturedAt: _private, ...rest } = p;
    return ManifestPhoto.parse({
      ...rest,
      captureGroup: groupName("cg", captureIdx.get(capture[i]!)!, photos),
      splitGroup: groupName("sg", groupIdx.get(groups[i]!)!, photos),
      split: splits[i]!,
      nearDuplicates: partners[i]!.map((j) => photos[j]!.sha256).sort(),
      crossGroupNearDuplicate: partners[i]!.some((j) => capture[j] !== capture[i]),
    });
  });
  rows.sort((a, b) => a.sha256.localeCompare(b.sha256));
  const out: FrozenSplits = { seed: frozen?.seed ?? constants.seed, photos: { ...(frozen?.photos ?? {}) } };
  for (const r of rows) out.photos[r.sha256] = r.split;
  return { photos: rows, frozen: out };
}

/** Split groups found on both sides of a split: always empty for a manifest this module built. */
export function straddlingGroups(photos: Pick<ManifestPhoto, "captureGroup" | "splitGroup" | "split">[]): string[] {
  const bad = new Set<string>();
  for (const key of ["captureGroup", "splitGroup"] as const) {
    const seen = new Map<string, Split>();
    for (const p of photos) {
      const s = seen.get(p[key]);
      if (s && s !== p.split) bad.add(p[key]);
      seen.set(p[key], p.split);
    }
  }
  return [...bad].sort();
}

/** Aggregate counts for the public report: no hashes, no paths. */
export function manifestCounts(photos: ManifestPhoto[]) {
  const per = <K extends string>(f: (p: ManifestPhoto) => K) => {
    const m: Record<string, number> = {};
    for (const p of photos) m[f(p)] = (m[f(p)] ?? 0) + 1;
    return m;
  };
  const groupsIn = (key: "captureGroup" | "splitGroup") =>
    Object.fromEntries(SPLITS.map((s) => [s, new Set(photos.filter((p) => p.split === s).map((p) => p[key])).size]));
  const pairs = photos.reduce((s, p) => s + p.nearDuplicates.length, 0) / 2;
  const capOf = new Map(photos.map((p) => [p.sha256, p.captureGroup]));
  const cross = photos.reduce((s, p) => s + p.nearDuplicates.filter((q) => capOf.get(q) !== p.captureGroup).length, 0) / 2;
  return {
    photos: photos.length,
    bySplit: Object.fromEntries(SPLITS.map((s) => [s, photos.filter((p) => p.split === s).length])),
    bySession: per((p) => p.session),
    bySetting: per((p) => p.setting),
    captureGroups: groupsIn("captureGroup"),
    splitGroups: groupsIn("splitGroup"),
    nearDuplicatePairs: { all: pairs, acrossCaptureGroups: cross },
    unhashed: photos.filter((p) => p.dhash === null).length,
    straddling: straddlingGroups(photos).length,
  };
}
