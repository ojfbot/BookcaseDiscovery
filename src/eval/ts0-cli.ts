// TS-0 runner: the label ledger export, with F-1's manifest and grouped splits. CPU only, from caches.
//
//   bookcase dataset build [--set pilot-000]   # $BOOKCASE_DATA/datasets/label-ledger/<version>/ (private)
//   bookcase dataset report                    # evals/TS0/{metrics.json,report.md}: aggregates only
//
// The box set is RB-1's (`loadBoxSet`): F-0i's partition's kept boxes less NB-3's `on-lip`. Labels come from F-0's
// cached decisions (H-2's base decisions), F-0g's copies and F-0h's context decisions; rungs from Q-2b's table; title
// rarity and C-7's evidence from the v1 catalog and its statistics sidecar. The version key is a hash of the box set
// and the model revision (detector, readers, crops, catalog, acceptance bar and every cache read), so any change to
// either gives a new version and nothing is overwritten. Rows, paths and the dHash cache stay under `datasets/`.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { captureModeOf, deviceClassOf, privateManifestPath, publicManifest, type PrivateManifest } from "../capture/manifest.ts";
import { sessionLedgerPath } from "../capture/cli.ts";
import { buildManifestPhotos, DATASET, DatasetManifest, manifestCounts, readDatasetManifest, straddlingGroups, type DatasetPhotoInput, type FrozenSplits } from "../capture/dataset.ts";
import { dhashFile } from "../capture/phash.ts";
import { catalogPaths, openCatalog } from "../catalog/cli.ts";
import { catalogStamp, counterEvidence, openStats, RARITY, rarityBasis, rarityEvidence, statsPathFor } from "../catalog/rarity.ts";
import type { Candidate } from "../catalog/retrieve.ts";
import { writeFileDurable } from "../ledger/durable.ts";
import { dataRoot, ImageStore } from "../ledger/images.ts";
import { checkLineage, makeStamp, writeLineage, type LineageStamp } from "../ledger/lineage.ts";
import { modelHashes } from "../ledger/models.ts";
import { DATASET_SCHEMA } from "./lineage-classes.ts";
import { SqliteLedger } from "../ledger/sqlite.ts";
import { cropName, F0_CROP } from "../perceive/crop.ts";
import { ACCEPT, ARM_MODELS, armsOf, loadReadings, rankedFor, readJsonl, READER_MODELS, READERS, stageExpect, variantsOf, type Arm, type Detection, type ReaderName, type Reading } from "./f0.ts";
import { compactJson } from "./q1-cli.ts";
import type { Rung } from "./q2.ts";
import { loadBoxSet, type PartitionRow } from "./rb1.ts";
import { isSession, setPaths } from "./set-paths.ts";
import { assertManifestable, heldOutSessions } from "./set-roles.ts";
import { ownTitleForm, rarityOf, type Rarity } from "./ts1.ts";
import {
  assertExportable,
  assertTrainable,
  BASES,
  contentHash,
  labelCounts,
  labelOf,
  labelRow,
  parseLabelRow,
  sha256,
  TS0,
  versionKey,
  type BoxEvidence,
  type LabelRow,
  type SharedBacking,
} from "./ts0.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const log = (s: string): void => console.error(`[ts0] ${new Date().toISOString().slice(11, 19)} ${s}`);

/**
 * Where a set's machine-label caches are (NS-K2: by set-paths' convention, so any declared session has them).
 * `assertTrainable` runs first in `setInputs`, so only a training source gets this far; the yardstick never does.
 */
const sourceOf = (set: string, root: string): { session: string; detect: string; readings: string; decisions: string; copies: string; context: string; rungs: string } => {
  const p = setPaths(set, root);
  return {
    session: set,
    // F-0c's detection on F-0e's shipped whole-case default (bands+strips), as Q-3 reads it.
    detect: join(p.f0c, "detect.jsonl"),
    readings: p.base,
    decisions: join(p.h2, "base-decisions.jsonl"),
    copies: join(p.f0g, "copies.jsonl"),
    context: join(p.f0h, "decisions.jsonl"),
    rungs: p.q2bTable,
  };
};

export const datasetDir = (root: string): string => join(root, "datasets", TS0.dataset);

interface BaseDecision {
  id: string;
  imageId: string;
  top: Partial<Record<ReaderName, string | null>>;
  confirmed: Partial<Record<ReaderName, string | null>>;
  accepted: { workId: string } | null;
  agreeing: ReaderName[];
}
interface CopyRow { id: string; basis: string | null; workId: string | null; consistent?: ReaderName[] }
interface ContextRow { id: string; basis: string | null; workId: string | null; readers: ReaderName[] }

const fileHash = (path: string): string => sha256(readFileSync(path));
const must = (path: string, what: string): string => {
  if (!existsSync(path)) throw new Error(`no ${what} at the data root (${relative(dataRoot(), path)})`);
  return path;
};
const split = (id: string): [string, number] => {
  const k = id.lastIndexOf(":");
  return [id.slice(0, k), Number(id.slice(k + 1))];
};

// --- photos: F-1's manifest input -------------------------------------------------------------------------

function photosOf(session: string, root: string): DatasetPhotoInput[] {
  assertManifestable(session);
  const ledgerPath = must(sessionLedgerPath(root, session), "fixture ledger");
  const ledger = new SqliteLedger(ledgerPath, { readOnly: true });
  let pub;
  try {
    pub = publicManifest(ledger, session);
  } finally {
    ledger.close();
  }
  // NS-4: the capture provenance comes from the private manifest (device and lens from EXIF; the sidecar's fields when
  // an ingest wrote them), so a session without one cannot be manifested.
  const priv = JSON.parse(readFileSync(must(privateManifestPath(root, session), "private fixture manifest (capture provenance)"), "utf8")) as PrivateManifest;
  const facts = new Map(priv.photos.map((p) => [p.hash, p]));
  const store = new ImageStore(root);
  const cachePath = join(root, "datasets", "cache", "dhash.json");
  const cache: Record<string, string | null> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};
  const out = pub.photos.map((p): DatasetPhotoInput => {
    const file = store.find(p.workingCopyHash);
    if (!file) throw new Error(`${session}: a working copy is missing from the image store`);
    if (!(p.workingCopyHash in cache)) {
      try {
        cache[p.workingCopyHash] = dhashFile(file);
      } catch {
        cache[p.workingCopyHash] = null;
      }
    }
    const fact = facts.get(p.hash);
    if (!fact) throw new Error(`${session}: a photo is not in the private fixture manifest (re-run \`bookcase ingest\`)`);
    const deviceClass = fact.provenance?.deviceClass ?? deviceClassOf(fact.device);
    if (!deviceClass) throw new Error(`${session}: the device tier of a photo's device is unknown: add it to \`deviceClassOf\` (src/capture/manifest.ts) or supply a capture sidecar (docs/capture-protocol.md §9)`);
    return {
      sha256: p.workingCopyHash,
      originalSha256: p.hash,
      path: relative(root, file),
      size: statSync(file).size,
      session,
      storeId: null,
      bookcaseId: fact.provenance?.bookcaseId ?? null,
      shelf: p.shelfIndex ?? null,
      setting: p.setting,
      capturedAt: fact.capturedAt ?? null,
      dhash: cache[p.workingCopyHash] ?? null,
      deviceClass,
      lens: fact.lens.class,
      captureMode: fact.provenance?.captureMode ?? captureModeOf(p.setting),
    };
  });
  mkdirSync(join(root, "datasets", "cache"), { recursive: true });
  writeFileDurable(cachePath, JSON.stringify(cache, null, 1) + "\n");
  return out;
}

// --- one set's labels -------------------------------------------------------------------------------------

interface SetInputs {
  set: string;
  kept: string[];
  boxSetHash: string;
  revision: Record<string, unknown>;
  /** The detector arms the set's detection cache was made with: what its lineage stamp names. */
  arms: Arm[];
  evidence: (id: string) => BoxEvidence;
  polygon: (id: string) => [number, number][];
  outline: (id: string) => [number, number][] | null;
  rung: (id: string) => Rung;
  readings: Map<string, Partial<Record<ReaderName, Reading>>>;
}

function setInputs(set: string, root: string): SetInputs {
  assertTrainable(set);
  const src = sourceOf(set, root);
  const box = loadBoxSet(set, root);
  const kept = [...box.rows.values()].filter((r: PartitionRow) => r.state === "kept" && box.keeps(r.id)).map((r) => r.id).sort();
  const detRows = readJsonl<Detection>(must(src.detect, "detection"));
  const arms = armsOf(detRows);
  // DL-3: the detection cache must name the weights the manifest names now (the readings are checked by `loadReadings`).
  checkLineage(src.detect, stageExpect("detect", arms, root));
  const dets = new Map(detRows.filter((d) => !d.error).map((d) => [d.id, d]));
  const polygon = (id: string) => {
    const [img, i] = split(id);
    const s = dets.get(img)?.spines[i];
    if (!s) throw new Error(`${set}: a kept box with no detection`);
    return s.polygon as [number, number][];
  };
  const outline = (id: string) => {
    const r = box.rows.get(id);
    return r?.changed ? r.outline : null;
  };
  const boxSetHash = contentHash({ set, boxes: kept.map((id) => ({ id, polygon: polygon(id), outline: outline(id) })) });

  const decisions = new Map(readJsonl<BaseDecision>(must(src.decisions, "F-0 base decisions")).map((d) => [d.id, d]));
  const copies = new Map(readJsonl<CopyRow>(must(src.copies, "F-0g copies")).filter((c) => c.basis === "confirmed-by-copy" && c.workId).map((c) => [c.id, c]));
  const context = new Map(readJsonl<ContextRow>(must(src.context, "F-0h decisions")).filter((c) => c.basis === "confirmed-by-context" && c.workId).map((c) => [c.id, c]));
  const rungs = new Map(readJsonl<{ id: string; rung: Rung }>(must(src.rungs, "Q-2b rung table")).map((r) => [r.id, r.rung]));
  const readings = loadReadings(src.readings);

  const readerFiles = Object.fromEntries(READERS.map((r) => [r, join(src.readings, `${r}.jsonl`)]).filter(([, p]) => existsSync(p)).map(([r, p]) => [r, fileHash(p!)]));
  const readerModels = Object.fromEntries(READERS.map((r) => [r, [...new Set([...readings.values()].flatMap((x) => (x[r] ? [(x[r] as Reading & { reader: string }).reader] : [])))].sort()]));
  const crops = [...new Set([...readings.values()].flatMap((x) => Object.values(x).map((r) => r!.crop ?? cropName(F0_CROP))))].sort();
  const revision = {
    detector: [...new Set([...dets.values()].map((d) => `${d.arm ?? "b2"}|${d.layout ?? ""}`))].sort(),
    readers: readerModels,
    crops,
    caches: { readings: readerFiles, decisions: fileHash(src.decisions), copies: fileHash(src.copies), context: fileHash(src.context), rungs: fileHash(src.rungs) },
  };

  const evidence = (id: string): BoxEvidence => {
    const d = decisions.get(id);
    if (!d) throw new Error(`${set}: a kept box with no F-0 decision`);
    const c = copies.get(id), x = context.get(id);
    return {
      id,
      imageId: d.imageId,
      decision: { top: d.top, confirmed: d.confirmed, accepted: d.accepted?.workId ?? null, agreeing: d.agreeing },
      copy: c ? { workId: c.workId!, readers: c.consistent ?? [] } : null,
      context: x ? { workId: x.workId!, readers: x.readers } : null,
    };
  };
  const rung = (id: string) => {
    const r = rungs.get(id);
    if (!r) throw new Error(`${set}: a kept box with no rung`);
    return r;
  };
  return { set, kept, boxSetHash, revision, arms, evidence, polygon, outline, rung, readings };
}

/** The models a version depends on: every source set's detector arms and the three readers. */
const datasetModels = (arms: readonly Arm[]): string[] => [...new Set([...arms.flatMap((a) => ARM_MODELS[a]), ...READERS.flatMap((r) => READER_MODELS[r])])].sort();

/**
 * What the re-stamp pass (DL-3, `bookcase lineage restamp`) can say about a version built before stamps: its box set
 * from `build.json`, the weights its source sets' detection caches name and the readers' (as the manifest hashes them
 * now), and the current catalog's stamp when there is one. The pass records which of these it assumed.
 */
export function versionStampParts(root: string, dir: string): { boxSet: string; models: Record<string, string>; catalog: string | null; assumed: string[]; schemaVersion: number } {
  const b = JSON.parse(readFileSync(join(dir, "build.json"), "utf8")) as { boxSet: string; sets: string[] };
  // NS-4: a version's own schema is its manifest's, so a legacy version is stamped as what it is and refused as stale.
  const schemaVersion = (JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { schemaVersion?: number }).schemaVersion ?? 1;
  const arms = b.sets.flatMap((s) => {
    const detect = isSession(s) ? sourceOf(s, root).detect : undefined;
    return detect && existsSync(detect) ? armsOf(readJsonl<Detection>(detect)) : [];
  });
  const catalogPath = catalogPaths().catalog;
  const catalog = existsSync(catalogPath) ? catalogStamp(catalogPath) : null;
  return { boxSet: b.boxSet, models: modelHashes(datasetModels(arms), root), catalog, assumed: ["models", "catalog"], schemaVersion };
}

/**
 * The sessions a build manifests (NS-4, DL-5's gap): every source set's session, and every session the registry declares
 * `held-out` that has a fixture ledger at the data root. A held-out session sits in the manifest with its split
 * frozen as `held-out` from its first build on; no row is made on its photos and the export guard refuses one.
 */
export function manifestSessions(root: string, sets: readonly string[]): { sessions: string[]; heldOut: string[] } {
  const sources = [...new Set(sets)];
  const heldOut = heldOutSessions().filter((s) => !sources.includes(s) && existsSync(sessionLedgerPath(root, s)));
  return { sessions: [...sources, ...heldOut], heldOut };
}

// --- build ------------------------------------------------------------------------------------------------

export interface BuildResult {
  version: string;
  dir: string;
  labels: number;
  photos: number;
}

export function build(sets: readonly string[] = TS0.sets, root = dataRoot()): BuildResult {
  for (const s of sets) assertTrainable(s);
  const t0 = Date.now();
  const inputs = sets.map((s) => setInputs(s, root));
  const catalogPath = catalogPaths().catalog;
  const statsPath = statsPathFor(catalogPath);
  const boxSet = contentHash(Object.fromEntries(inputs.map((i) => [i.set, i.boxSetHash])));
  const catalog = catalogStamp(catalogPath);
  const modelRevision = contentHash({
    sets: Object.fromEntries(inputs.map((i) => [i.set, i.revision])),
    catalog: { file: catalogPath.split("/").at(-1), stamp: catalog, stats: catalogStamp(statsPath) },
    accept: ACCEPT,
    bases: BASES,
    rarity: RARITY,
    dataset: DATASET,
  });
  const version = versionKey(boxSet, modelRevision);
  const dir = join(datasetDir(root), version);
  // DL-3: the version's lineage stamp, one sidecar per file: the box set, the weights, the catalog and this code.
  const stamp = makeStamp({ schema: DATASET_SCHEMA, boxSet, models: modelHashes(datasetModels(inputs.flatMap((i) => i.arms)), root), catalog });
  log(`version ${version} (box set ${boxSet.slice(0, 12)}, model revision ${modelRevision.slice(0, 12)})`);

  // F-1: the manifest and its grouped splits. Frozen assignments are kept across versions.
  const splitsPath = join(datasetDir(root), "splits.json");
  const frozen: FrozenSplits | null = existsSync(splitsPath) ? JSON.parse(readFileSync(splitsPath, "utf8")) : null;
  const { sessions, heldOut } = manifestSessions(root, sets);
  if (heldOut.length) log(`manifesting ${heldOut.length} held-out session(s) with their split frozen; no row is exported from them`);
  // The registry's held-out sessions are frozen `held-out` like F-1's reserved ones.
  const constants = { ...DATASET, heldOutSessions: [...new Set([...DATASET.heldOutSessions, ...heldOutSessions()])].sort() };
  const photos = sessions.flatMap((s) => photosOf(s, root));
  const built = buildManifestPhotos(photos, frozen, constants);
  const manifest = DatasetManifest.parse({
    schemaVersion: DATASET.schemaVersion,
    dataset: TS0.dataset,
    version,
    constants: { captureGapSeconds: constants.captureGapSeconds, nearDuplicateBits: constants.nearDuplicateBits, valShare: constants.valShare, seed: constants.seed, heldOutSessions: constants.heldOutSessions },
    photos: built.photos,
  });
  if (straddlingGroups(manifest.photos).length) throw new Error("F-1: a group straddles splits");
  const photoOf = new Map(manifest.photos.map((p) => [p.sha256, p]));

  // TS-0: one row per confirmed label.
  const db = openCatalog(catalogPath);
  const stats = openStats(statsPath, catalogPath);
  const basis = rarityBasis(db, stats);
  const workRow = db.prepare("SELECT title, authors, title_norm FROM works WHERE id = ?");
  const works = new Map<string, { title: string; authors: string[]; rarity: Rarity | null }>();
  const workOf = (id: string) => {
    if (!works.has(id)) {
      const w = workRow.get(id) as { title: string; authors: string; title_norm: string } | undefined;
      if (!w) throw new Error("a label's work is not in the catalog");
      const form = ownTitleForm(w.title_norm);
      works.set(id, { title: w.title, authors: JSON.parse(w.authors) as string[], rarity: rarityOf(form, form === null ? 0 : stats.title(form).works) });
    }
    return works.get(id)!;
  };
  const ranked = new Map<string, Candidate[]>();
  /** C-7's evidence from each voting reader whose top candidate is the label's work; null when none is. */
  const backingOf = (reads: Partial<Record<ReaderName, Reading>>, readers: ReaderName[], workId: string): SharedBacking | null => {
    let seen = false;
    const b: SharedBacking = { namesakeTest: false, authorRead: false };
    for (const r of readers) {
      const cands = rankedFor(db, reads[r], ranked);
      const c = cands[0];
      if (!c || c.workId !== workId) continue;
      seen = true;
      const e = rarityEvidence(basis, c, cands, variantsOf(reads[r]));
      if (!counterEvidence(e).namesake) b.namesakeTest = true;
      if (e.author >= RARITY.secondAuthor) b.authorRead = true;
    }
    return seen ? b : null;
  };

  const rows: LabelRow[] = [];
  const skipped = { conflict: 0, noLabel: 0 };
  for (const inp of inputs) {
    for (const id of inp.kept) {
      const e = inp.evidence(id);
      const l = labelOf(e);
      if (l === "conflict") {
        skipped.conflict++;
        continue;
      }
      if (!l) {
        skipped.noLabel++;
        continue;
      }
      const photo = photoOf.get(e.imageId);
      if (!photo) throw new Error(`${inp.set}: a labelled box's photo is not in the fixture manifest`);
      const w = workOf(l.workId);
      const reads = inp.readings.get(id) ?? {};
      const rarity = w.rarity;
      rows.push(
        labelRow(e, l, {
          version,
          boxSet,
          modelRevision,
          set: inp.set,
          crop: reads[l.readers[0]!]?.crop ?? cropName(F0_CROP),
          polygon: inp.polygon(id),
          outline: inp.outline(id),
          rung: inp.rung(id),
          work: { title: w.title, authors: w.authors },
          rarity,
          backing: rarity === "distinctive" ? null : backingOf(reads, l.readers, l.workId),
          photo,
          // NS-4: every label today is one photo's readers, recoverable from RGB.
          labelSource: "single-view",
          rgbRecoverable: "yes",
        }),
      );
    }
  }
  stats.close();
  db.close();
  assertExportable(rows, manifest);

  commitVersion(root, dir, {
    "manifest.json": JSON.stringify(manifest, null, 1) + "\n",
    "labels.jsonl": rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""),
    "build.json": JSON.stringify({ version, boxSet, modelRevision, sets, keptBoxes: inputs.reduce((s, i) => s + i.kept.length, 0), skipped, manifest: manifestCounts(manifest.photos), labels: labelCounts(rows) }, null, 1) + "\n",
  }, built.frozen, version, stamp);
  log(`${rows.length} labels on ${manifest.photos.length} photos (${skipped.conflict} copy/context conflicts) in ${Math.round((Date.now() - t0) / 1000)} s`);
  return { version, dir, labels: rows.length, photos: manifest.photos.length };
}

/**
 * Write one version beside the others (a re-run of the same version rewrites identical content), then the frozen
 * splits, then `latest.json`. Every file goes through `writeFileDurable` (DL-1): `splits.json` is frozen history no
 * rebuild can regenerate, so a crash must leave the previous one whole, and `latest.json` must never name a
 * version whose files are not all on disk. Each file gets its lineage stamp (DL-3) as `<file>.lineage.json`, written
 * after the file, so a crash between the two leaves a file with no stamp, which readers refuse.
 */
export function commitVersion(root: string, dir: string, files: Record<string, string>, splits: FrozenSplits, version: string, stamp: LineageStamp): void {
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    writeFileDurable(join(dir, name), text, { mode: 0o600 });
    writeLineage(join(dir, name), stamp);
  }
  writeFileDurable(join(datasetDir(root), "splits.json"), JSON.stringify(splits, null, 1) + "\n", { mode: 0o600 });
  writeFileDurable(join(datasetDir(root), "latest.json"), JSON.stringify({ version }) + "\n");
}

// --- report: aggregates only ------------------------------------------------------------------------------

interface BuildJson {
  version: string;
  sets: string[];
  keptBoxes: number;
  skipped: { conflict: number; noLabel: number };
  manifest: ReturnType<typeof manifestCounts>;
  labels: ReturnType<typeof labelCounts>;
}

const MARK = "<!-- generated by `bookcase dataset report`: edit above this line -->";

export function report(root = dataRoot(), version?: string): string {
  const v = version ?? (JSON.parse(readFileSync(must(join(datasetDir(root), "latest.json"), "dataset build"), "utf8")) as { version: string }).version;
  const dir = join(datasetDir(root), v);
  // DL-3: the version is refused when the weights or the catalog it names have changed (its box set is its own).
  checkLineage(must(join(dir, "build.json"), "dataset build"), (s) => ({ schema: DATASET_SCHEMA, models: modelHashes(Object.keys(s.models), root), catalog: catalogStamp(catalogPaths().catalog) }));
  const b = JSON.parse(readFileSync(join(dir, "build.json"), "utf8")) as BuildJson;
  // Recount from the rows themselves, so the report never trusts a stale summary.
  const rows = readFileSync(join(dir, "labels.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => parseLabelRow(JSON.parse(l)));
  const manifest = readDatasetManifest(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")));
  assertExportable(rows, manifest);
  const m = {
    card: "TS-0",
    // Every exported set is a training source: real use, whatever its name (NS-K2).
    scope: `${b.sets.join(", ")}, real use (OC35): machine labels, never accuracy (INV-17); the yardstick is never exported`,
    version: v,
    sets: b.sets,
    keptBoxes: b.keptBoxes,
    skipped: b.skipped,
    constants: { dataset: DATASET, bases: BASES },
    manifest: manifestCounts(manifest.photos),
    labels: labelCounts(rows),
  };
  const out = join(REPO, "evals", "TS0");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "metrics.json"), compactJson(m) + "\n");
  const rp = join(out, "report.md");
  const text = existsSync(rp) ? readFileSync(rp, "utf8") : "# TS-0 · label ledger export\n\n";
  const head = text.includes(MARK) ? text.slice(0, text.indexOf(MARK)) : text.trimEnd() + "\n\n";
  writeFileSync(rp, head + MARK + "\n\n" + tablesMd(m));
  log(`report: evals/TS0/{metrics.json,report.md} for ${v}`);
  return v;
}

type Counts = Record<string, number>;
type BySplit = { all: Counts; train: Counts; val: Counts; "held-out": Counts };

function table(title: string, x: BySplit): string[] {
  const keys = Object.keys(x.all);
  const out = [`| ${title} | all | train | val | held-out |`, "|---|---:|---:|---:|---:|"];
  for (const k of keys) out.push(`| ${k} | ${x.all[k] ?? 0} | ${x.train[k] ?? 0} | ${x.val[k] ?? 0} | ${x["held-out"][k] ?? 0} |`);
  return out;
}

function tablesMd(m: { version: string; keptBoxes: number; skipped: { conflict: number; noLabel: number }; manifest: ReturnType<typeof manifestCounts>; labels: ReturnType<typeof labelCounts> }): string {
  const { manifest: p, labels: l } = m;
  const out: string[] = [];
  out.push(`## Version \`${m.version}\`\n`);
  out.push(`${m.keptBoxes} kept boxes on RB-1's box set; **${l.labels} labels** on ${l.photos} photos. ${m.skipped.noLabel} boxes have no label; ${m.skipped.conflict} have a copy and a context label naming different works and are left out.\n`);
  out.push("### Photos and splits (F-1)\n");
  out.push("| split | photos | capture groups | split groups | labels |\n|---|---:|---:|---:|---:|");
  for (const s of ["train", "val", "held-out"] as const) out.push(`| ${s} | ${p.bySplit[s]} | ${p.captureGroups[s]} | ${p.splitGroups[s]} | ${l.bySplit[s]} |`);
  out.push(`\nNear-duplicate photo pairs: ${p.nearDuplicatePairs.all} (${p.nearDuplicatePairs.acrossCaptureGroups} across capture groups, each joined into one split group), in ${p.dupClusters} near-duplicate clusters. Photos with no dHash: ${p.unhashed}. Groups straddling a split: **${p.straddling}**.\n`);
  out.push("### Capture provenance (NS-4)\n");
  out.push("Photos by device tier, lens and capture mode; labels by the same and by label source and RGB-recoverability. Counts only.\n");
  const line = (title: string, c: Record<string, number>) => `| ${title} | ${Object.entries(c).map(([k, n]) => `${k} ${n}`).join(" · ")} |`;
  out.push("| photos | counts |\n|---|---|", line("device class", p.byDeviceClass), line("lens", p.byLens), line("capture mode", p.byCaptureMode), `| with a case id | ${p.withCase} |`, "");
  out.push(...table("device class", l.deviceClass as BySplit), "");
  out.push(...table("lens", l.lens as BySplit), "");
  out.push(...table("capture mode", l.captureMode as BySplit), "");
  out.push(...table("label source", l.labelSource as BySplit), "");
  out.push(...table("RGB-recoverable", l.rgbRecoverable as BySplit), "");
  out.push(`Labels with a case id: ${l.withCase}; in a near-duplicate cluster: ${l.inDupCluster}.\n`);
  out.push("### Labels\n");
  out.push(...table("strong class", l.strong as BySplit), "");
  out.push(...table("title class", l.titleClass as BySplit), "");
  out.push(...table("decision basis", l.basis as BySplit), "");
  out.push(...table("coverage rung", l.rung as BySplit), "");
  out.push(...table("agreeing readers", l.agreeing as BySplit), "");
  out.push(...table("third reader (two-reader `readers-agree`)", l.thirdReader as BySplit), "");
  out.push(...table("any reader dissents", l.dissenting as BySplit), "");
  out.push(...table("shared title backed by", l.sharedBacking as BySplit), "");
  out.push("| basis · title class · class | labels |\n|---|---:|");
  for (const [k, n] of Object.entries(l.basisByClass).sort()) out.push(`| ${k.split("|").join(" · ")} | ${n} |`);
  out.push(`\nLabels on photos with a near-duplicate: ${l.nearDuplicatePhotoLabels}.`);
  return out.join("\n") + "\n";
}
