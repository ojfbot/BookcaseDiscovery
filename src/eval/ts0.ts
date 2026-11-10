// TS-0 · label ledger export: one versioned training set from every experiment's machine labels, on RB-1's box set.
//
// Each row is one confirmed label: its decision basis, the readers that voted, its coverage rung, TS-1's label-filter
// fields (title class, agreeing pair, third-reader dissent, whether C-7's namesake test or an author read backs a
// shared title), the F-1 split of its photo and, since NS-4, its capture provenance (device tier, lens, capture mode,
// case, near-duplicate cluster, label source, RGB-recoverability). The **strong class** (distinctive title, two
// readers, no dissent) is flagged, never filtered: TS-2 chooses. Only declared training sources are exported (OC35,
// DL-5's set roles; a held-out session is manifested but gets no row), and only machine bases are (OC36: no hand
// labels). Pure; the runner is src/eval/ts0-cli.ts. Rows live only under the data root's `datasets/`; the repo gets
// the schema, this code and the aggregates in evals/TS0.
import { createHash } from "node:crypto";
import { z } from "zod";
import { LEGACY_PROVENANCE, SPLITS, type DatasetManifest, type ManifestPhoto } from "../capture/dataset.ts";
import { CAPTURE_MODES, DEVICE_CLASSES, LENS_CLASSES, SWEEP_MODES } from "../capture/manifest.ts";
import { READERS, type ReaderName } from "./f0.ts";
import { assertManifestable, assertTrainable } from "./set-roles.ts";
import { RUNGS, type Rung } from "./q2.ts";
import { AGREEING, agreeingKey, THIRD_OUTCOMES, thirdOf, type Agreeing, type Box, type Rarity } from "./ts1.ts";

export const TS0 = {
  /** 2 since NS-4: every row carries its capture provenance. A schema-1 row is read with `LEGACY_PROVENANCE` (`parseLabelRow`). */
  schemaVersion: 2,
  dataset: "label-ledger",
  /** The sets with machine labels to export. Only real-use and controlled fixtures; never a yardstick (OC35). */
  sets: ["pilot-000"] as readonly string[],
} as const;

/** The decision bases that ship (`confirmed-by-pooling`, F-0g2, did not). All machine-made (OC36). */
export const BASES = ["readers-agree", "confirmed-by-copy", "confirmed-by-context"] as const;
export type Basis = (typeof BASES)[number];
export type TitleClass = Rarity;

/**
 * NS-4: the evidence family a label came from, beside `basis`, which keeps its meaning. `single-view` is every label
 * today (one photo, its readers). The others name labels no card makes yet: from monocular geometry (H-2), from fusing
 * views of one sweep, from LiDAR depth as privileged information, or from LiDAR as a scale prompt to mono geometry.
 */
export const LABEL_SOURCES = ["single-view", "mono-geometry", "multiview-fusion", "lidar-privileged", "lidar-scale"] as const;
export type LabelSource = (typeof LABEL_SOURCES)[number];

/** NS-4: whether a model that sees RGB alone could in principle recover the label (`yes` for every label today). */
export const RGB_RECOVERABLE = ["yes", "no", "unknown"] as const;
export type RgbRecoverable = (typeof RGB_RECOVERABLE)[number];

/** What a label row written before NS-4 is read as, beyond its photo's `LEGACY_PROVENANCE`: a single-view label, recoverable from RGB. */
export const LEGACY_LABEL_PROVENANCE = { ...LEGACY_PROVENANCE, caseId: null, labelSource: "single-view", rgbRecoverable: "yes" } as const;

/**
 * OC35: throws unless the set is a declared `training-source` (DL-5: by its role in src/eval/set-roles.ts, fail closed,
 * with the old name test as a second check). Re-exported so every exporter and trainer calls the one guard.
 */
export { assertTrainable };

/** OC36: throws for anything but a shipped machine basis (an owner correction, a tap, a hand label). */
export function assertMachineBasis(basis: string): asserts basis is Basis {
  if (!(BASES as readonly string[]).includes(basis)) throw new Error(`TS-0: basis "${basis}" is not a shipped machine basis (OC36: no hand labels)`);
}

// --- hashes and the version key -----------------------------------------------------------------------------

/** JSON with every object's keys sorted, so equal content hashes equally. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as object)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

export const sha256 = (s: string | Uint8Array): string => createHash("sha256").update(s).digest("hex");
export const contentHash = (v: unknown): string => sha256(canonicalJson(v));

/** The export's version: deterministic from the box-set and model-revision hashes (and this schema). */
export function versionKey(boxSet: string, modelRevision: string): string {
  return `v-${contentHash({ schema: TS0.schemaVersion, dataset: TS0.dataset, boxSet, modelRevision }).slice(0, 12)}`;
}

// --- one box's label ------------------------------------------------------------------------------------------

/** What the experiments' caches say about one kept box of the box set. */
export interface BoxEvidence {
  id: string;
  imageId: string;
  /** F-0's decision (`readers-agree`). */
  decision: {
    top: Partial<Record<ReaderName, string | null>>;
    confirmed: Partial<Record<ReaderName, string | null>>;
    accepted: string | null;
    agreeing: ReaderName[];
  };
  /** F-0g's `confirmed-by-copy`, with the box's own readers consistent with the work. */
  copy: { workId: string; readers: ReaderName[] } | null;
  /** F-0h's `confirmed-by-context`, with the readers whose text picked the work. */
  context: { workId: string; readers: ReaderName[] } | null;
}

export interface Label {
  basis: Basis;
  workId: string;
  readers: ReaderName[];
}

/**
 * The box's label: F-0's accept first (the raised bases only apply to boxes F-0 left `unknown`); else F-0g's copy or
 * F-0h's context. When copy and context name different works the box is a conflict and gets no label.
 */
export function labelOf(e: BoxEvidence): Label | "conflict" | null {
  if (e.decision.accepted) return { basis: "readers-agree", workId: e.decision.accepted, readers: order(e.decision.agreeing) };
  const { copy, context } = e;
  if (copy && context && copy.workId !== context.workId) return "conflict";
  if (copy) return { basis: "confirmed-by-copy", workId: copy.workId, readers: order(copy.readers) };
  if (context) return { basis: "confirmed-by-context", workId: context.workId, readers: order(context.readers) };
  return null;
}

const order = (rs: readonly ReaderName[]): ReaderName[] => READERS.filter((r) => rs.includes(r));

export interface ThirdReader {
  reader: ReaderName;
  outcome: (typeof THIRD_OUTCOMES)[number];
}

/** TS-1's M5 on a two-reader `readers-agree` label; null for any other label. */
export function thirdReaderOf(e: BoxEvidence, l: Label): ThirdReader | null {
  if (l.basis !== "readers-agree") return null;
  const box: Box = { id: e.id, imageId: e.imageId, top: e.decision.top, confirmed: e.decision.confirmed, accepted: l.workId, agreeing: e.decision.agreeing, elevation: "", dark: false, side: false, rarity: null };
  return thirdOf(box);
}

/** Readers that confirm a different work than the label's. */
export const dissentingOf = (e: BoxEvidence, l: Label): ReaderName[] => READERS.filter((r) => !!e.decision.confirmed[r] && e.decision.confirmed[r] !== l.workId);

/** C-7's evidence on a shared title, from the voting readers: the namesake test passes, or a reader read the author. */
export interface SharedBacking {
  namesakeTest: boolean;
  authorRead: boolean;
}

/** The strong class (TS-1): a distinctive title, two readers agreeing (`readers-agree`), and no dissenting reader. */
export function isStrong(l: { basis: Basis; titleClass: TitleClass; readers: readonly ReaderName[]; dissenting: readonly ReaderName[]; thirdReader: ThirdReader | null }): boolean {
  return l.basis === "readers-agree" && l.titleClass === "distinctive" && l.readers.length >= 2 && l.dissenting.length === 0 && l.thirdReader?.outcome !== "dissents";
}

// --- rows -----------------------------------------------------------------------------------------------------

const Hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const Reader = z.enum(READERS as [ReaderName, ...ReaderName[]]);
const Pt = z.tuple([z.number(), z.number()]);

export const LabelRow = z.strictObject({
  schemaVersion: z.literal(TS0.schemaVersion),
  version: z.string().regex(/^v-[0-9a-f]{12}$/),
  /** INV-14: the box set and the model revision that produced the label. */
  boxSet: Hex64,
  modelRevision: Hex64,
  set: z.string().min(1),
  boxId: z.string().min(1),
  imageSha256: Hex64,
  /** The working copy, relative to the data root. */
  path: z.string().regex(/^images\/sha256\//),
  /** Detection rectangle and (where F-0i changed the box) its exclusive outline, in working-copy pixels. */
  polygon: z.array(Pt).length(4),
  outline: z.array(Pt).nullable(),
  /** The crop method the readers read (F-0b). */
  crop: z.string().min(1),
  workId: z.string().min(1),
  title: z.string(),
  authors: z.array(z.string()),
  basis: z.enum(BASES),
  readers: z.array(Reader).min(1),
  agreeing: z.enum(AGREEING).nullable(),
  rung: z.enum(RUNGS),
  titleClass: z.enum(["distinctive", "shared"]),
  thirdReader: z.strictObject({ reader: Reader, outcome: z.enum(THIRD_OUTCOMES as [string, ...string[]]) }).nullable(),
  dissenting: z.array(Reader),
  sharedBacking: z.strictObject({ namesakeTest: z.boolean(), authorRead: z.boolean() }).nullable(),
  strong: z.boolean(),
  split: z.enum(SPLITS),
  captureGroup: z.string().min(1),
  splitGroup: z.string().min(1),
  nearDuplicate: z.boolean(),
  // NS-4: capture provenance, from the photo's manifest row (deviceClass, lens, captureMode, caseId, dupClusterId) and
  // from the labelling card (labelSource, rgbRecoverable). Add-only; see `LEGACY_LABEL_PROVENANCE`.
  deviceClass: z.enum(DEVICE_CLASSES),
  lens: z.enum(LENS_CLASSES),
  captureMode: z.enum(CAPTURE_MODES),
  /** The physical case (F-1's `bookcaseId`; never a second id): required on a sweep row, the unit of hold-out. */
  caseId: z.string().min(1).nullable(),
  dupClusterId: z.string().min(1).nullable(),
  labelSource: z.enum(LABEL_SOURCES),
  rgbRecoverable: z.enum(RGB_RECOVERABLE),
}).superRefine((r, ctx) => {
  if (SWEEP_MODES.includes(r.captureMode) && r.caseId === null) ctx.addIssue({ code: "custom", message: `a ${r.captureMode} label must name its case (caseId)`, path: ["caseId"] });
});
export type LabelRow = z.infer<typeof LabelRow>;

/**
 * Parse a row of this schema or an earlier one (the owner's add-only rule): a schema-1 row, written before NS-4, is
 * read with `LEGACY_LABEL_PROVENANCE`. Every reader of `labels.jsonl` goes through here; a stamped reader has already
 * refused a schema-1 dataset (DL-3) unless it allowed a stale file.
 */
export function parseLabelRow(raw: unknown): LabelRow {
  const r = raw as { schemaVersion?: unknown };
  if (r && r.schemaVersion === 1) return LabelRow.parse({ ...LEGACY_LABEL_PROVENANCE, ...(raw as object), schemaVersion: TS0.schemaVersion });
  return LabelRow.parse(raw);
}

/** Everything a row needs beyond the box's evidence. */
export interface RowContext {
  version: string;
  boxSet: string;
  modelRevision: string;
  set: string;
  crop: string;
  polygon: [number, number][];
  outline: [number, number][] | null;
  rung: Rung;
  work: { title: string; authors: string[] };
  /** TS-1's M6; null (no own title form) counts as shared, the cautious side. */
  rarity: Rarity | null;
  backing: SharedBacking | null;
  photo: ManifestPhoto;
  /** NS-4: how the label was made and whether RGB alone could recover it (the labelling card says; `single-view` and `yes` today). */
  labelSource: LabelSource;
  rgbRecoverable: RgbRecoverable;
}

export function labelRow(e: BoxEvidence, l: Label, c: RowContext): LabelRow {
  assertTrainable(c.set);
  assertMachineBasis(l.basis);
  if (c.photo.sha256 !== e.imageId) throw new Error("TS-0: a label's photo is not its manifest row");
  const titleClass: TitleClass = c.rarity ?? "shared";
  const thirdReader = thirdReaderOf(e, l);
  const dissenting = dissentingOf(e, l);
  const agreeing: Agreeing | null = l.readers.length >= 2 ? agreeingKey(l.readers) : null;
  return LabelRow.parse({
    schemaVersion: TS0.schemaVersion,
    version: c.version,
    boxSet: c.boxSet,
    modelRevision: c.modelRevision,
    set: c.set,
    boxId: e.id,
    imageSha256: e.imageId,
    path: c.photo.path,
    polygon: c.polygon,
    outline: c.outline,
    crop: c.crop,
    workId: l.workId,
    title: c.work.title,
    authors: c.work.authors,
    basis: l.basis,
    readers: l.readers,
    agreeing,
    rung: c.rung,
    titleClass,
    thirdReader,
    dissenting,
    sharedBacking: titleClass === "shared" ? c.backing : null,
    strong: isStrong({ basis: l.basis, titleClass, readers: l.readers, dissenting, thirdReader }),
    split: c.photo.split,
    captureGroup: c.photo.captureGroup,
    splitGroup: c.photo.splitGroup,
    nearDuplicate: c.photo.nearDuplicates.length > 0,
    deviceClass: c.photo.deviceClass,
    lens: c.photo.lens,
    captureMode: c.photo.captureMode,
    caseId: c.photo.bookcaseId,
    dupClusterId: c.photo.dupClusterId,
    labelSource: c.labelSource,
    rgbRecoverable: c.rgbRecoverable,
  });
}

/**
 * The last check before anything is written: every row from a trainable set, on a machine basis, of this version,
 * on a photo in the manifest from a trainable session, with the photo's provenance; every manifest photo from a
 * session that may be manifested (a training source, or a held-out session, which is frozen but gets no row: NS-4,
 * DL-5's gap). Throws on the first breach.
 */
export function assertExportable(rows: LabelRow[], manifest: Pick<DatasetManifest, "version" | "photos">): void {
  const photos = new Map(manifest.photos.map((p) => [p.sha256, p]));
  for (const p of manifest.photos) assertManifestable(p.session);
  for (const r of rows) {
    assertTrainable(r.set);
    assertMachineBasis(r.basis);
    if (r.version !== manifest.version) throw new Error("TS-0: a row from another version");
    const p = photos.get(r.imageSha256);
    if (!p) throw new Error("TS-0: a row's photo is not in the manifest");
    assertTrainable(p.session);
    if (p.split !== r.split || p.splitGroup !== r.splitGroup) throw new Error("TS-0: a row's split differs from its photo's");
    if (p.deviceClass !== r.deviceClass || p.lens !== r.lens || p.captureMode !== r.captureMode || p.bookcaseId !== r.caseId || p.dupClusterId !== r.dupClusterId)
      throw new Error("TS-0: a row's capture provenance differs from its photo's");
  }
}

// --- aggregates (the only thing that reaches the repo) -------------------------------------------------------

const tally = <T>(rows: T[], f: (r: T) => string, keys?: readonly string[]): Record<string, number> => {
  const out: Record<string, number> = Object.fromEntries((keys ?? []).map((k) => [k, 0]));
  for (const r of rows) out[f(r)] = (out[f(r)] ?? 0) + 1;
  return out;
};

const by = (rows: LabelRow[], f: (r: LabelRow) => string, keys?: readonly string[]) => ({
  all: tally(rows, f, keys),
  ...Object.fromEntries(SPLITS.map((s) => [s, tally(rows.filter((r) => r.split === s), f, keys)])),
});

/** Counts by class, basis, rung and split: no ids, no titles, no paths. */
export function labelCounts(rows: LabelRow[]) {
  const shared = rows.filter((r) => r.titleClass === "shared");
  return {
    labels: rows.length,
    photos: new Set(rows.map((r) => r.imageSha256)).size,
    bySplit: tally(rows, (r) => r.split, SPLITS),
    strong: by(rows, (r) => (r.strong ? "strong" : "not strong"), ["strong", "not strong"]),
    titleClass: by(rows, (r) => r.titleClass, ["distinctive", "shared"]),
    basis: by(rows, (r) => r.basis, BASES),
    rung: by(rows, (r) => r.rung, RUNGS),
    agreeing: by(rows, (r) => r.agreeing ?? "one reader", [...AGREEING, "one reader"]),
    thirdReader: by(rows, (r) => r.thirdReader?.outcome ?? "none", [...THIRD_OUTCOMES, "none"]),
    dissenting: by(rows, (r) => (r.dissenting.length ? "dissent" : "no dissent"), ["dissent", "no dissent"]),
    sharedBacking: by(shared, (r) => (!r.sharedBacking ? "unmeasured" : r.sharedBacking.authorRead ? "author read" : r.sharedBacking.namesakeTest ? "namesake test" : "neither"), ["author read", "namesake test", "neither", "unmeasured"]),
    basisByClass: tally(rows, (r) => `${r.basis}|${r.titleClass}|${r.strong ? "strong" : "not strong"}`),
    nearDuplicatePhotoLabels: rows.filter((r) => r.nearDuplicate).length,
    // NS-4: capture provenance, counts only (no case ids, no cluster ids).
    deviceClass: by(rows, (r) => r.deviceClass, DEVICE_CLASSES),
    lens: by(rows, (r) => r.lens, LENS_CLASSES),
    captureMode: by(rows, (r) => r.captureMode, CAPTURE_MODES),
    labelSource: by(rows, (r) => r.labelSource, LABEL_SOURCES),
    rgbRecoverable: by(rows, (r) => r.rgbRecoverable, RGB_RECOVERABLE),
    withCase: rows.filter((r) => r.caseId !== null).length,
    inDupCluster: rows.filter((r) => r.dupClusterId !== null).length,
  };
}
