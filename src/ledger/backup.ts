// NAS backup and restore (DL-6, docs/backup.md). The data root lives on one internal disk; this copies it, versioned,
// to a mounted share the owner names on the command line, and proves a restore works.
//
//   classOfPath(rel)        fact | derived | refetchable | unclassified, from the first folder of the path
//   backupLedgers(...)      a consistent copy of every SQLite file among the facts, through `VACUUM INTO`, which reads
//                           one committed state even while a writer is open (a plain copy can capture a torn WAL)
//   backupRun(...)          the ledgers, then every other file, into a content-addressed store on the target; one
//                           dated snapshot folder holding `backup-manifest.json` (the fact manifest) per run
//   verifySnapshot(...)     re-hash the copies on the target against a manifest: counts only
//   restoreSnapshot(...)    write a snapshot's files into a fresh folder, checking every byte against its hash
//
// The share refuses hard links, so a dated folder of full copies would cost the whole data root on every run. Each
// file body is stored once instead, named by its sha256 (`objects/sha256/<aa>/<hash>`, the image store's layout), and
// a snapshot is the manifest that maps every path to its body. A file whose size and mtime match the previous
// snapshot's entry is not read or copied again. Nothing is ever deleted from a kept snapshot: a file deleted at the
// source is simply absent from the next manifest while the older ones still name its body. Only `--keep` prunes, and
// only bodies no kept manifest names.
//
// Never logged: the target's path, the data root's path, or any file name. The credentials file is never opened.
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync, chmodSync } from "node:fs";
import { open, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { writeFileDurable } from "./durable.ts";

export const BACKUP_MANIFEST = "backup-manifest.json";
export const BACKUP_MANIFEST_VERSION = 1;
/** The folder this repo owns on the target: the share is shared with other tenants. */
export const TENANT_DIR = "bookcase-discovery";
/** Snapshots kept by `backup run` unless `--keep` says otherwise (sizing: docs/backup.md). */
export const DEFAULT_KEEP = 4;

/** Label Studio's local login (`scripts/label-studio.sh`). Never opened, hashed, copied or named in output. */
export const CREDENTIALS_FILE = join("labels", "ls-credentials.txt");
/** Where `bookcase backup restore-drill` writes its scratch roots, under the data root; never backed up itself. */
export const RESTORE_DRILL_DIR = join("private", "restore-drill");

/**
 * The classes decide the verify order and the restore drill, not what is copied: everything is copied.
 *
 *   fact          cannot be rebuilt: the event ledgers, originals, labels, the private fixture manifests (with the
 *                 permission log) and the frozen dataset history
 *   derived       stage caches, depth and fusion caches, `proxy/`: lineage-stamped and rebuildable, some at hours of GPU
 *   refetchable   `models/` (pinned by revision) and `catalog/` (dumps re-downloadable, catalogs rebuildable)
 *   unclassified  anything the list above does not name; treated like a fact (hashed and re-hashed) until it is named
 */
export type BackupClass = "fact" | "derived" | "refetchable" | "unclassified";
export const CLASS_ORDER: readonly BackupClass[] = ["fact", "unclassified", "derived", "refetchable"];

const FACT_DIRS = new Set(["ledger", "images", "raw", "labels", "datasets"]);
const REFETCHABLE_DIRS = new Set(["models", "catalog"]);

export function classOfPath(rel: string): BackupClass {
  const parts = rel.split(sep);
  if (parts.length === 1) return "unclassified";
  const [top, second] = parts;
  if (FACT_DIRS.has(top!)) return "fact";
  if (REFETCHABLE_DIRS.has(top!)) return "refetchable";
  if (top === "private") {
    if (second === "fixtures") return "fact";
    // A loose file under private/ is not a stage cache.
    return parts.length === 2 ? "unclassified" : "derived";
  }
  if (/^f0[a-z0-9]*$/.test(top!) || top === "proxy") return "derived";
  return "unclassified";
}

/** A fact SQLite file: copied through SQLite's own backup path, never as bytes. */
export const isFactDatabase = (rel: string): boolean => rel.endsWith(".sqlite") && classOfPath(rel) === "fact";

/** Left out of every snapshot: the credentials file, the drill's own scratch roots, SQLite's shared-memory index and a fact database's WAL and journal (its consistent copy holds them). */
export function isExcluded(rel: string): boolean {
  if (rel === CREDENTIALS_FILE) return true;
  if (rel === RESTORE_DRILL_DIR || rel.startsWith(RESTORE_DRILL_DIR + sep)) return true;
  if (rel.endsWith(".sqlite-shm")) return true;
  const m = /^(.*\.sqlite)-(wal|journal)$/.exec(rel);
  return !!m && isFactDatabase(m[1]!);
}

export interface FileEntry {
  path: string;
  class: BackupClass;
  size: number;
  mtimeMs: number;
  mode: number;
  sha256: string;
  /** True for a fact database copied through `VACUUM INTO`. */
  consistent?: true;
}

export interface SymlinkEntry {
  path: string;
  class: BackupClass;
  symlink: string;
}

export interface ClassCounts {
  files: number;
  bytes: number;
  /** Bodies written to the target by this run; the rest were already there. */
  newFiles: number;
  newBytes: number;
  seconds: number;
}

/** `backup-manifest.json`, the fact manifest: one per snapshot, written last, so a snapshot without one never happened. */
export interface BackupManifest {
  version: number;
  /** `full` from `backup run`; `ledgers` from `backup snapshot`, which copies the fact databases only. */
  kind: "full" | "ledgers";
  snapshot: string;
  startedAt: string;
  finishedAt: string;
  files: FileEntry[];
  symlinks: SymlinkEntry[];
  /** Every lineage stamp the run saw, keyed by the path of the file it describes (DL-3). */
  lineage: Record<string, unknown>;
  counts: Record<BackupClass, ClassCounts>;
  /** Files left out (the credentials file among them): a count, never names. */
  excluded: number;
  /** Files whose bytes changed while the run read them: the copy is the bytes it read, under their own hash. */
  changedDuringRun: number;
}

export class BackupTargetError extends Error {}

const tenant = (target: string): string => join(target, TENANT_DIR);
const objectPath = (target: string, hash: string): string => join(tenant(target), "objects", "sha256", hash.slice(0, 2), hash);
const snapshotsDir = (target: string): string => join(tenant(target), "snapshots");
const incomingDir = (target: string): string => join(tenant(target), "incoming");
const emptyCounts = (): Record<BackupClass, ClassCounts> =>
  Object.fromEntries(CLASS_ORDER.map((c) => [c, { files: 0, bytes: 0, newFiles: 0, newBytes: 0, seconds: 0 }])) as Record<BackupClass, ClassCounts>;

/**
 * Check the target is there and takes writes, and clear this repo's own leftover temporaries on it. The share is
 * encrypted and locked after a NAS reboot until the owner unlocks it, so a missing or read-only target is reported,
 * never retried. The message never names the path.
 */
export function openTarget(target: string, opts: { write: boolean }): void {
  let st;
  try {
    st = statSync(target);
  } catch {
    throw new BackupTargetError("the target does not exist: is the share mounted and unlocked?");
  }
  if (!st.isDirectory()) throw new BackupTargetError("the target is not a folder");
  if (!opts.write) return;
  try {
    mkdirSync(tenant(target), { recursive: true, mode: 0o700 });
    mkdirSync(incomingDir(target), { recursive: true, mode: 0o700 });
    const probe = join(incomingDir(target), `probe-${randomUUID()}`);
    writeFileSync(probe, "");
    rmSync(probe);
  } catch {
    throw new BackupTargetError("the target is not writable: is the share mounted read-write and unlocked?");
  }
  // A crashed run's temporaries; a day old, so a run going on at the same time keeps its own.
  for (const name of readdirSync(incomingDir(target))) {
    const p = join(incomingDir(target), name);
    try {
      if (Date.now() - statSync(p).mtimeMs > 24 * 3600 * 1000) rmSync(p, { force: true, recursive: true });
    } catch {
      // Gone already.
    }
  }
}

/** Snapshot ids sort by time: `2026-11-07T23-51-02Z` (no colons, which SMB refuses). */
export const snapshotId = (d: Date): string => d.toISOString().replace(/\.\d+Z$/, "Z").replaceAll(":", "-");

/** The target's snapshots that have a manifest, oldest first. */
export function listSnapshots(target: string): string[] {
  let names: string[];
  try {
    names = readdirSync(snapshotsDir(target));
  } catch {
    return [];
  }
  return names.filter((n) => {
    try {
      return statSync(join(snapshotsDir(target), n, BACKUP_MANIFEST)).isFile();
    } catch {
      return false;
    }
  }).sort();
}

const SHA256 = /^[0-9a-f]{64}$/;
/** A relative path with no `..`, empty or absolute part: what a manifest may name, so a restore stays in its folder. */
const safeRel = (p: unknown): boolean => typeof p === "string" && p.length > 0 && !isAbsolute(p) && !p.split(/[/\\]/).some((x) => x === ".." || x === "" || x === ".");

/**
 * Read and check a snapshot's manifest. The share is shared with other tenants, so a manifest is not trusted: every
 * hash must be a sha256 and every path relative and inside the data root, or the whole manifest is refused.
 */
export function readManifest(target: string, snapshot: string): BackupManifest {
  if (!safeRel(snapshot) || snapshot.includes("/")) throw new Error("not a snapshot id");
  const m = JSON.parse(readFileSync(join(snapshotsDir(target), snapshot, BACKUP_MANIFEST), "utf8")) as BackupManifest;
  const bad = !Array.isArray(m.files) || !Array.isArray(m.symlinks) || m.files.some((e) => !safeRel(e.path) || typeof e.sha256 !== "string" || !SHA256.test(e.sha256) || !Number.isInteger(e.size) || !CLASS_ORDER.includes(e.class)) || m.symlinks.some((x) => !safeRel(x.path) || typeof x.symlink !== "string");
  if (bad || m.snapshot !== snapshot || (m.kind !== "full" && m.kind !== "ledgers")) throw new Error("a snapshot's manifest names a path outside the data root, a malformed hash or another snapshot: refused");
  return m;
}

/** The newest snapshot of `kind`, or null when the target has none. */
export function latestManifest(target: string, kind: BackupManifest["kind"] = "full"): BackupManifest | null {
  for (const s of listSnapshots(target).reverse()) {
    const m = readManifest(target, s);
    if (m.kind === kind) return m;
  }
  return null;
}

// --- walking the data root ------------------------------------------------------------------------------------

interface Found {
  rel: string;
  kind: "file" | "symlink";
}

/** Every regular file and symlink under `root`, sorted, minus the exclusions; symlinks are recorded, never followed. */
function walk(root: string, onExcluded: () => void): Found[] {
  const out: Found[] = [];
  const visit = (rel: string): void => {
    for (const e of readdirSync(rel ? join(root, rel) : root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const r = rel ? join(rel, e.name) : e.name;
      if (isExcluded(r)) {
        onExcluded();
        continue;
      }
      if (e.isSymbolicLink()) out.push({ rel: r, kind: "symlink" });
      else if (e.isDirectory()) visit(r);
      else if (e.isFile()) out.push({ rel: r, kind: "file" });
    }
  };
  visit("");
  return out;
}

// --- copying bodies -------------------------------------------------------------------------------------------

const CHUNK = 4 * 1024 * 1024;

async function hashFile(path: string): Promise<string> {
  const h = createHash("sha256");
  const fd = await open(path, "r");
  try {
    const buf = Buffer.allocUnsafe(CHUNK);
    for (;;) {
      const { bytesRead } = await fd.read(buf, 0, CHUNK, null);
      if (!bytesRead) break;
      h.update(buf.subarray(0, bytesRead));
    }
  } finally {
    await fd.close();
  }
  return h.digest("hex");
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy `src` into the target's store, hashing the bytes as they are written: the body is named by what was read, so
 * a file that changed after it was hashed is stored under its new hash, never under a wrong one. The temporary is
 * fsynced before the rename into place.
 */
async function storeBody(target: string, src: string): Promise<{ sha256: string; size: number; created: boolean }> {
  const tmp = join(incomingDir(target), randomUUID());
  const h = createHash("sha256");
  let size = 0;
  const rd = await open(src, "r");
  const wr = await open(tmp, "wx", 0o600);
  try {
    const buf = Buffer.allocUnsafe(CHUNK);
    for (;;) {
      const { bytesRead } = await rd.read(buf, 0, CHUNK, null);
      if (!bytesRead) break;
      h.update(buf.subarray(0, bytesRead));
      await wr.write(buf, 0, bytesRead);
      size += bytesRead;
    }
    await wr.sync();
  } finally {
    await rd.close();
    await wr.close();
  }
  const sha256 = h.digest("hex");
  const dest = objectPath(target, sha256);
  if (await exists(dest)) {
    rmSync(tmp, { force: true });
    return { sha256, size, created: false };
  }
  mkdirSync(dirname(dest), { recursive: true });
  renameSync(tmp, dest);
  return { sha256, size, created: true };
}

/** Run `tasks` with at most `limit` in flight: the share's round trips, not the disk, set the pace. */
async function pool<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) await task(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// --- the run --------------------------------------------------------------------------------------------------

export interface RunOptions {
  /** Full snapshots to keep; older ones are pruned after the new one is written. */
  keep?: number;
  /** Bodies copied at once. */
  concurrency?: number;
  now?: () => Date;
  log?: (s: string) => void;
}

export interface RunResult {
  manifest: BackupManifest;
  seconds: number;
  pruned: { snapshots: number; bodies: number; bytes: number };
}

/**
 * The consistent copy of every fact database (`backup snapshot`, and the first step of `backup run`): `VACUUM INTO` a
 * private temporary folder from a read-only connection, which sees the last committed state whatever a writer has
 * open, then into the target's store. A plain copy of the file can catch a WAL half checkpointed.
 */
export async function backupLedgers(root: string, target: string, counts: Record<BackupClass, ClassCounts>, rels?: readonly string[]): Promise<FileEntry[]> {
  const t0 = Date.now();
  const dbs = rels ?? walk(root, () => {}).filter((f) => f.kind === "file" && isFactDatabase(f.rel)).map((f) => f.rel);
  const scratch = mkdtempSync(join(tmpdir(), "bookcase-backup-"));
  const out: FileEntry[] = [];
  try {
    for (const rel of dbs) {
      const src = join(root, rel);
      const st = statSync(src);
      const copy = join(scratch, "copy.sqlite");
      const db = new DatabaseSync(src, { readOnly: true });
      try {
        db.prepare("VACUUM INTO ?").run(copy);
      } finally {
        db.close();
      }
      const body = await storeBody(target, copy);
      rmSync(copy, { force: true });
      out.push({ path: rel, class: "fact", size: body.size, mtimeMs: st.mtimeMs, mode: st.mode & 0o777, sha256: body.sha256, consistent: true });
      const c = counts.fact;
      c.files++;
      c.bytes += body.size;
      if (body.created) {
        c.newFiles++;
        c.newBytes += body.size;
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  counts.fact.seconds += (Date.now() - t0) / 1000;
  return out;
}

function writeManifest(target: string, m: BackupManifest): void {
  const dir = join(snapshotsDir(target), m.snapshot);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileDurable(join(dir, BACKUP_MANIFEST), JSON.stringify(m) + "\n", { mode: 0o600 });
}

/** `backup snapshot`: the fact databases alone, as a `ledgers` snapshot. Cheap enough to run after every session. */
export async function backupSnapshot(root: string, target: string, opts: RunOptions = {}): Promise<RunResult> {
  const now = opts.now ?? (() => new Date());
  const started = now();
  openTarget(target, { write: true });
  const counts = emptyCounts();
  const files = await backupLedgers(root, target, counts);
  const manifest: BackupManifest = { version: BACKUP_MANIFEST_VERSION, kind: "ledgers", snapshot: uniqueSnapshot(target, started), startedAt: started.toISOString(), finishedAt: now().toISOString(), files, symlinks: [], lineage: {}, counts, excluded: 0, changedDuringRun: 0 };
  writeManifest(target, manifest);
  const pruned = prune(target, opts.keep ?? DEFAULT_KEEP, "ledgers");
  return { manifest, seconds: (now().getTime() - started.getTime()) / 1000, pruned };
}

function uniqueSnapshot(target: string, d: Date): string {
  const base = snapshotId(d);
  const taken = new Set(listSnapshots(target));
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}

/**
 * `backup run`: the fact databases first (consistent copies), then every other file by class in verify order. A file
 * whose size and mtime match the previous full snapshot's entry keeps that entry's hash and is not read; any other
 * file is hashed here and copied only when the target has no body with that hash.
 */
export async function backupRun(root: string, target: string, opts: RunOptions = {}): Promise<RunResult> {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? (() => {});
  const started = now();
  openTarget(target, { write: true });
  const previous = new Map((latestManifest(target)?.files ?? []).map((e) => [e.path, e]));
  let excluded = 0;
  const found = walk(root, () => excluded++);
  const counts = emptyCounts();
  const files = await backupLedgers(root, target, counts, found.filter((f) => f.kind === "file" && isFactDatabase(f.rel)).map((f) => f.rel));
  log(`fact databases: ${files.length} consistent copies`);
  const symlinks: SymlinkEntry[] = [];
  const lineage: Record<string, unknown> = {};
  let changedDuringRun = 0;
  for (const cls of CLASS_ORDER) {
    const t0 = Date.now();
    const mine = found.filter((f) => classOfPath(f.rel) === cls && !(f.kind === "file" && isFactDatabase(f.rel)));
    const c = counts[cls];
    await pool(mine, opts.concurrency ?? 8, async (f) => {
      const src = join(root, f.rel);
      if (f.kind === "symlink") {
        symlinks.push({ path: f.rel, class: cls, symlink: readlinkSync(src) });
        return;
      }
      const st = await stat(src);
      const prev = previous.get(f.rel);
      let entry: FileEntry;
      if (prev && !prev.consistent && prev.size === st.size && prev.mtimeMs === st.mtimeMs) {
        entry = { ...prev, class: cls, mode: st.mode & 0o777 };
      } else {
        const sha256 = await hashFile(src);
        if (await exists(objectPath(target, sha256))) {
          entry = { path: f.rel, class: cls, size: st.size, mtimeMs: st.mtimeMs, mode: st.mode & 0o777, sha256 };
        } else {
          const body = await storeBody(target, src);
          if (body.sha256 !== sha256) changedDuringRun++;
          entry = { path: f.rel, class: cls, size: body.size, mtimeMs: st.mtimeMs, mode: st.mode & 0o777, sha256: body.sha256 };
          if (body.created) {
            c.newFiles++;
            c.newBytes += body.size;
          }
        }
      }
      files.push(entry);
      c.files++;
      c.bytes += entry.size;
      if (f.rel.endsWith(".lineage.json")) {
        try {
          lineage[f.rel.slice(0, -".lineage.json".length)] = JSON.parse(readFileSync(src, "utf8"));
        } catch {
          // A torn or foreign sidecar is still copied; the manifest simply has no stamp for it.
        }
      }
    });
    c.seconds += (Date.now() - t0) / 1000;
    log(`${cls}: ${c.files} files, ${c.newFiles} new, in ${c.seconds.toFixed(1)} s`);
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  symlinks.sort((a, b) => a.path.localeCompare(b.path));
  const manifest: BackupManifest = { version: BACKUP_MANIFEST_VERSION, kind: "full", snapshot: uniqueSnapshot(target, started), startedAt: started.toISOString(), finishedAt: now().toISOString(), files, symlinks, lineage, counts, excluded, changedDuringRun };
  writeManifest(target, manifest);
  const pruned = prune(target, opts.keep ?? DEFAULT_KEEP, "full");
  return { manifest, seconds: (now().getTime() - started.getTime()) / 1000, pruned };
}

/**
 * Keep the newest `keep` snapshots of `kind`. A pruned snapshot's manifest goes first, then the bodies that no
 * remaining manifest (of either kind) names; a crash between the two leaves unreferenced bodies, never a manifest
 * naming a missing one.
 */
export function prune(target: string, keep: number, kind: BackupManifest["kind"]): { snapshots: number; bodies: number; bytes: number } {
  if (!Number.isInteger(keep) || keep < 1) throw new Error("--keep must be a whole number of at least 1");
  // Deleted by the folder name listSnapshots gave, never by a field read from the manifest.
  const all = listSnapshots(target).map((s) => ({ ...readManifest(target, s), snapshot: s }));
  const ofKind = all.filter((m) => m.kind === kind);
  const drop = ofKind.slice(0, Math.max(0, ofKind.length - keep));
  if (!drop.length) return { snapshots: 0, bodies: 0, bytes: 0 };
  const dropped = new Set(drop.map((m) => m.snapshot));
  const kept = new Set(all.filter((m) => !dropped.has(m.snapshot)).flatMap((m) => m.files.map((e) => e.sha256)));
  const orphans = new Map<string, number>();
  for (const m of drop) for (const e of m.files) if (!kept.has(e.sha256)) orphans.set(e.sha256, e.size);
  for (const m of drop) rmSync(join(snapshotsDir(target), m.snapshot), { recursive: true, force: true });
  let bytes = 0;
  for (const [hash, size] of orphans) {
    rmSync(objectPath(target, hash), { force: true });
    bytes += size;
  }
  return { snapshots: drop.length, bodies: orphans.size, bytes };
}

// --- verify ---------------------------------------------------------------------------------------------------

export interface VerifyCounts {
  checked: number;
  ok: number;
  missing: number;
  changed: number;
  /** Checked by size only (derived and re-fetchable classes, unless `all`). */
  sizeOnly: number;
}

export interface VerifyResult {
  snapshot: string;
  byClass: Record<BackupClass, VerifyCounts>;
  ok: boolean;
  seconds: number;
}

/**
 * Re-hash the target's copies against a manifest, in class order. Facts and unclassified files are always re-hashed;
 * derived and re-fetchable ones by size unless `all`. Reports counts, never names.
 */
export async function verifySnapshot(target: string, opts: { snapshot?: string; all?: boolean; concurrency?: number } = {}): Promise<VerifyResult> {
  const t0 = Date.now();
  openTarget(target, { write: false });
  const m = opts.snapshot ? readManifest(target, opts.snapshot) : latestManifest(target);
  if (!m) throw new Error("the target has no full snapshot yet: run `bookcase backup run` first");
  const byClass = Object.fromEntries(CLASS_ORDER.map((c) => [c, { checked: 0, ok: 0, missing: 0, changed: 0, sizeOnly: 0 }])) as Record<BackupClass, VerifyCounts>;
  for (const cls of CLASS_ORDER) {
    const c = byClass[cls];
    const deep = opts.all || cls === "fact" || cls === "unclassified";
    await pool(m.files.filter((e) => e.class === cls), opts.concurrency ?? 8, async (e) => {
      c.checked++;
      const p = objectPath(target, e.sha256);
      let size: number;
      try {
        size = (await stat(p)).size;
      } catch {
        c.missing++;
        return;
      }
      if (size !== e.size || (deep && (await hashFile(p)) !== e.sha256)) c.changed++;
      else {
        c.ok++;
        if (!deep) c.sizeOnly++;
      }
    });
  }
  const ok = CLASS_ORDER.every((c) => byClass[c].missing === 0 && byClass[c].changed === 0);
  return { snapshot: m.snapshot, byClass, ok, seconds: (Date.now() - t0) / 1000 };
}

// --- restore --------------------------------------------------------------------------------------------------

export interface RestoreCounts {
  files: number;
  bytes: number;
  symlinks: number;
  /** Symlinks with an absolute target or a `..` part: recorded in the manifest, not recreated. */
  skippedSymlinks: number;
  seconds: number;
  byClass: Record<BackupClass, { files: number; bytes: number }>;
}

/**
 * Write the entries `want` selects from manifest `m` into `dest`, which must not exist yet, with each file's mode and
 * mtime. Every body is re-hashed as it is read and a mismatch throws: a restore never writes bytes it cannot vouch for.
 */
export async function restoreSnapshot(target: string, m: BackupManifest, dest: string, want: (path: string, cls: BackupClass) => boolean, opts: { concurrency?: number } = {}): Promise<RestoreCounts> {
  const t0 = Date.now();
  openTarget(target, { write: false });
  try {
    lstatSync(dest);
    throw new Error("the restore folder exists already; a restore writes into a fresh one");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  mkdirSync(dest, { recursive: true, mode: 0o700 });
  const counts: RestoreCounts = { files: 0, bytes: 0, symlinks: 0, skippedSymlinks: 0, seconds: 0, byClass: Object.fromEntries(CLASS_ORDER.map((c) => [c, { files: 0, bytes: 0 }])) as RestoreCounts["byClass"] };
  const chosen = m.files.filter((e) => want(e.path, e.class));
  await pool(chosen, opts.concurrency ?? 8, async (e) => {
    const out = join(dest, e.path);
    mkdirSync(dirname(out), { recursive: true });
    const h = createHash("sha256");
    const rd = await open(objectPath(target, e.sha256), "r");
    const wr = await open(out, "wx", 0o600);
    try {
      const buf = Buffer.allocUnsafe(CHUNK);
      for (;;) {
        const { bytesRead } = await rd.read(buf, 0, CHUNK, null);
        if (!bytesRead) break;
        h.update(buf.subarray(0, bytesRead));
        await wr.write(buf, 0, bytesRead);
      }
      await wr.sync();
    } finally {
      await rd.close();
      await wr.close();
    }
    if (h.digest("hex") !== e.sha256) throw new Error(`a ${e.class} file's copy on the target does not match its hash: run \`bookcase backup verify\``);
    chmodSync(out, e.mode & 0o777);
    utimesSync(out, e.mtimeMs / 1000, e.mtimeMs / 1000);
    counts.files++;
    counts.bytes += e.size;
    counts.byClass[e.class].files++;
    counts.byClass[e.class].bytes += e.size;
  });
  // Links come after every file, and nothing is written after them. Only a relative target with no `..` part is
  // recreated: such a link points at or below its own folder, so no chain of them can leave the restore, however they
  // resolve through each other. Any other link, or one whose folder is reached through a link, is counted, not created.
  for (const s of m.symlinks.filter((x) => want(x.path, x.class))) {
    const out = join(dest, s.path);
    if (isAbsolute(s.symlink) || s.symlink.split(/[/\\]/).includes("..") || !folderWithoutLinks(dest, dirname(s.path))) {
      counts.skippedSymlinks++;
      continue;
    }
    symlinkSync(s.symlink, out);
    counts.symlinks++;
  }
  counts.seconds = (Date.now() - t0) / 1000;
  return counts;
}

/** Make `rel` under `base` one folder at a time, refusing any part that exists as something other than a folder. */
function folderWithoutLinks(base: string, rel: string): boolean {
  let p = base;
  for (const part of rel === "." ? [] : rel.split(sep)) {
    p = join(p, part);
    try {
      if (!lstatSync(p).isDirectory()) return false;
    } catch {
      mkdirSync(p, { mode: 0o700 });
    }
  }
  return true;
}

/** A fresh folder `<base>/<date>`, or `<date>-2`, `-3`… when that day already has one: a drill never reuses a root. */
export function freshDir(base: string, date: string): string {
  for (let i = 1; ; i++) {
    const p = join(base, i === 1 ? date : `${date}-${i}`);
    try {
      lstatSync(p);
    } catch {
      return p;
    }
  }
}

/** Empty regular files at the data root's top level: strays, reported and never removed. */
export function strayEmptyFiles(root: string): number {
  return readdirSync(root, { withFileTypes: true }).filter((e) => e.isFile() && statSync(join(root, e.name)).size === 0).length;
}

