// DL-6: versioned backup of the data root to a mounted share, its verify and its restore, on a synthetic data root and
// a synthetic target built here. The real run against the owner's share is reported in the PR, counts only.
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backupRun,
  backupSnapshot,
  BackupTargetError,
  classOfPath,
  CREDENTIALS_FILE,
  isExcluded,
  latestManifest,
  listSnapshots,
  readManifest,
  restoreSnapshot,
  TENANT_DIR,
  verifySnapshot,
} from "../src/ledger/backup.ts";
import { backupCommand } from "../src/run/backup-cli.ts";

const base = mkdtempSync(join(tmpdir(), "dl6-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

const sha = (b: string | Buffer): string => createHash("sha256").update(b).digest("hex");
const SECRET = "synthetic-login-do-not-copy-7c1e";

let n = 0;
let root: string;
let target: string;
let clock: number;
const now = (): Date => new Date((clock += 1000));

function put(rel: string, body: string, mode = 0o644): void {
  const p = join(root, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, body);
  chmodSync(p, mode);
}

/** Every file under the target, read whole: what a leak would have to be found in. */
function targetFiles(dir = target): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? targetFiles(join(dir, e.name)) : [join(dir, e.name)]));
}

beforeEach(() => {
  n++;
  root = join(base, `root-${n}`);
  target = join(base, `target-${n}`);
  mkdirSync(root);
  mkdirSync(target);
  clock = Date.parse("2026-11-07T20:00:00Z");
  put("images/sha256/aa/bb/one.jpg", "pixels-1");
  put("raw/pilot/IMG_0001.HEIC", "original-1");
  put("labels/tasks.json", '{"tasks":1}');
  put(CREDENTIALS_FILE, SECRET, 0o600);
  put("private/fixtures/pilot.json", '{"photos":[]}', 0o600);
  put("private/h2/pilot/stage-a.jsonl", '{"id":"x"}\n');
  put("private/h2/pilot/stage-a.jsonl.lineage.json", JSON.stringify({ schema: { name: "h2/depth-stage", version: 1 } }));
  put("private/restore-drill/2026-11-01/ledger/old.sqlite", "a previous drill");
  put("datasets/label-ledger/splits.json", '{"frozen":true}');
  put("f0c/pilot/detect.jsonl", '{"id":"d"}\n');
  put("models/manifest.json", '{"models":[]}');
  put("catalog/catalog.sqlite", "not really a catalog");
  put("ledger.sqlite", "");
});

describe("classes", () => {
  it("sorts paths into facts, derived, re-fetchable and unclassified by the repo's lineage classes", () => {
    expect(classOfPath(join("ledger", "pilot.sqlite"))).toBe("fact");
    expect(classOfPath(join("private", "fixtures", "pilot.json"))).toBe("fact");
    expect(classOfPath(join("datasets", "label-ledger", "splits.json"))).toBe("fact");
    expect(classOfPath(join("private", "h2", "pilot", "stage-a.jsonl"))).toBe("derived");
    expect(classOfPath(join("f0e", "pilot", "x", "qwen.jsonl"))).toBe("derived");
    expect(classOfPath(join("proxy", "set", "a.json"))).toBe("derived");
    expect(classOfPath(join("models", "manifest.json"))).toBe("refetchable");
    expect(classOfPath(join("catalog", "catalog.sqlite"))).toBe("refetchable");
    expect(classOfPath("ledger.sqlite")).toBe("unclassified");
    expect(classOfPath(join("private", "profile.json"))).toBe("unclassified");
    expect(classOfPath(join("somewhere-new", "a.json"))).toBe("unclassified");
  });

  it("leaves out the credentials file, the drill's scratch roots and a fact database's WAL, never a catalog's", () => {
    expect(isExcluded(CREDENTIALS_FILE)).toBe(true);
    expect(isExcluded(join("private", "restore-drill"))).toBe(true);
    expect(isExcluded(join("ledger", "pilot.sqlite-wal"))).toBe(true);
    expect(isExcluded(join("ledger", "pilot.sqlite-shm"))).toBe(true);
    expect(isExcluded(join("catalog", "catalog.sqlite-wal"))).toBe(false);
    expect(isExcluded(join("labels", "tasks.json"))).toBe(false);
  });
});

describe("backup run", () => {
  it("snapshots a ledger consistently while a writer holds it open", async () => {
    mkdirSync(join(root, "ledger"));
    const path = join(root, "ledger", "pilot.sqlite");
    const w = new DatabaseSync(path);
    w.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; PRAGMA user_version = 2; CREATE TABLE events (seq INTEGER PRIMARY KEY, body TEXT)");
    for (let i = 1; i <= 50; i++) w.prepare("INSERT INTO events (body) VALUES (?)").run(`committed-${i}`);
    // The committed rows are still in the WAL; a copy of the main file alone would not have them.
    w.exec("BEGIN IMMEDIATE");
    for (let i = 1; i <= 20; i++) w.prepare("INSERT INTO events (body) VALUES (?)").run(`uncommitted-${i}`);
    try {
      await backupRun(root, target, { now });
    } finally {
      w.exec("ROLLBACK");
      w.close();
    }
    const m = latestManifest(target)!;
    const entry = m.files.find((e) => e.path === join("ledger", "pilot.sqlite"))!;
    expect(entry.consistent).toBe(true);
    expect(m.files.some((e) => e.path.endsWith("-wal") || e.path.endsWith("-shm"))).toBe(false);
    const dest = join(base, `restored-${n}`);
    await restoreSnapshot(target, m, dest, (p) => p.startsWith("ledger"));
    const r = new DatabaseSync(join(dest, "ledger", "pilot.sqlite"), { readOnly: true });
    try {
      expect((r.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check).toBe("ok");
      expect((r.prepare("SELECT count(*) AS n FROM events").get() as { n: number }).n).toBe(50);
      expect((r.prepare("SELECT count(*) AS n FROM events WHERE body LIKE 'uncommitted%'").get() as { n: number }).n).toBe(0);
      expect((r.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(2);
    } finally {
      r.close();
    }
  });

  it("copies every file once, records the lineage stamps it saw, and leaves out the credentials file and drill roots", async () => {
    const r = await backupRun(root, target, { now });
    const m = r.manifest;
    expect(m.kind).toBe("full");
    expect(m.files.map((e) => e.path)).not.toContain(CREDENTIALS_FILE);
    expect(m.files.some((e) => e.path.includes("restore-drill"))).toBe(false);
    expect(m.counts.fact.files).toBe(5);
    expect(m.counts.derived.files).toBe(3);
    expect(m.counts.refetchable.files).toBe(2);
    expect(m.counts.unclassified.files).toBe(1);
    expect(m.excluded).toBe(2);
    expect(m.lineage[join("private", "h2", "pilot", "stage-a.jsonl")]).toEqual({ schema: { name: "h2/depth-stage", version: 1 } });
    for (const e of m.files) expect(sha(readFileSync(join(target, TENANT_DIR, "objects", "sha256", e.sha256.slice(0, 2), e.sha256)))).toBe(e.sha256);
  });

  it("never copies the credentials file or writes its name anywhere on the target or in the output", async () => {
    const out: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((s: string) => void out.push(s));
    const err = vi.spyOn(console, "error").mockImplementation((s: string) => void out.push(s));
    try {
      vi.stubEnv("BOOKCASE_DATA", root);
      expect(await backupCommand(["run", "--target", target])).toBe(0);
      expect(await backupCommand(["verify", "--target", target])).toBe(0);
    } finally {
      spy.mockRestore();
      err.mockRestore();
      vi.unstubAllEnvs();
    }
    for (const f of targetFiles()) {
      const body = readFileSync(f, "utf8");
      expect(body).not.toContain("ls-credentials");
      expect(body).not.toContain(SECRET);
    }
    expect(existsSync(join(target, TENANT_DIR, "objects", "sha256", sha(SECRET).slice(0, 2), sha(SECRET)))).toBe(false);
    const text = out.join("\n");
    expect(text).not.toContain("ls-credentials");
    expect(text).not.toContain(target);
    expect(text).not.toContain(root);
    expect(text).not.toContain("IMG_0001");
    expect(text).toMatch(/2 empty files|1 empty files/);
  });

  it("does not copy an unchanged file again", async () => {
    await backupRun(root, target, { now });
    const second = (await backupRun(root, target, { now })).manifest;
    expect(listSnapshots(target)).toHaveLength(2);
    for (const c of Object.values(second.counts)) expect(c.newFiles).toBe(0);
    put("f0c/pilot/detect.jsonl", '{"id":"d"}\n{"id":"e"}\n');
    const third = (await backupRun(root, target, { now })).manifest;
    expect(third.counts.derived.newFiles).toBe(1);
    expect(third.counts.fact.newFiles).toBe(0);
  });

  it("keeps a copy of a file deleted at the source", async () => {
    const first = (await backupRun(root, target, { now })).manifest;
    rmSync(join(root, "raw", "pilot", "IMG_0001.HEIC"));
    const second = (await backupRun(root, target, { now })).manifest;
    const gone = join("raw", "pilot", "IMG_0001.HEIC");
    expect(second.files.map((e) => e.path)).not.toContain(gone);
    expect(readManifest(target, first.snapshot).files.map((e) => e.path)).toContain(gone);
    expect((await verifySnapshot(target, { snapshot: first.snapshot })).ok).toBe(true);
    const dest = join(base, `restored-${n}`);
    await restoreSnapshot(target, first, dest, (p) => p === gone);
    expect(readFileSync(join(dest, gone), "utf8")).toBe("original-1");
  });

  it("prunes only snapshots beyond --keep, and only bodies no kept snapshot names", async () => {
    const first = (await backupRun(root, target, { now })).manifest;
    put("labels/tasks.json", '{"tasks":2}');
    await backupRun(root, target, { now });
    const r = await backupRun(root, target, { now, keep: 2 });
    expect(r.pruned.snapshots).toBe(1);
    expect(r.pruned.bodies).toBe(1);
    expect(listSnapshots(target)).not.toContain(first.snapshot);
    expect((await verifySnapshot(target)).ok).toBe(true);
  });

  it("keeps ledger-only snapshots apart from full ones", async () => {
    mkdirSync(join(root, "ledger"));
    const db = new DatabaseSync(join(root, "ledger", "pilot.sqlite"));
    db.exec("CREATE TABLE events (seq INTEGER PRIMARY KEY)");
    db.close();
    await backupRun(root, target, { now });
    const s = (await backupSnapshot(root, target, { now })).manifest;
    expect(s.kind).toBe("ledgers");
    expect(s.files.map((e) => e.path)).toEqual([join("ledger", "pilot.sqlite")]);
    expect(latestManifest(target)!.kind).toBe("full");
  });
});

describe("verify and restore", () => {
  it("fails verify when one byte of a fact's copy changes on the target", async () => {
    const m = (await backupRun(root, target, { now })).manifest;
    expect((await verifySnapshot(target)).ok).toBe(true);
    const e = m.files.find((x) => x.path === join("labels", "tasks.json"))!;
    const body = join(target, TENANT_DIR, "objects", "sha256", e.sha256.slice(0, 2), e.sha256);
    const bytes = readFileSync(body);
    bytes[0] = bytes[0]! ^ 1;
    chmodSync(body, 0o644);
    writeFileSync(body, bytes);
    const v = await verifySnapshot(target);
    expect(v.ok).toBe(false);
    expect(v.byClass.fact.changed).toBe(1);
    expect(v.byClass.fact.ok).toBe(v.byClass.fact.checked - 1);
    await expect(restoreSnapshot(target, m, join(base, `restored-${n}`), (p) => p === e.path)).rejects.toThrow(/does not match its hash/);
  });

  it("restores bytes, modes and mtimes into a fresh folder, and refuses one that exists", async () => {
    const m = (await backupRun(root, target, { now })).manifest;
    const dest = join(base, `restored-${n}`);
    const c = await restoreSnapshot(target, m, dest, () => true);
    expect(c.files).toBe(m.files.length);
    const fixture = join("private", "fixtures", "pilot.json");
    expect(readFileSync(join(dest, fixture), "utf8")).toBe('{"photos":[]}');
    expect(statSync(join(dest, fixture)).mode & 0o777).toBe(0o600);
    expect(Math.floor(statSync(join(dest, fixture)).mtimeMs)).toBe(Math.floor(statSync(join(root, fixture)).mtimeMs));
    expect(existsSync(join(dest, CREDENTIALS_FILE))).toBe(false);
    await expect(restoreSnapshot(target, m, dest, () => true)).rejects.toThrow(/exists already/);
  });

  it("refuses a manifest on the shared target that names a path outside the data root or a malformed hash", async () => {
    const m = (await backupRun(root, target, { now })).manifest;
    const file = join(target, TENANT_DIR, "snapshots", m.snapshot, "backup-manifest.json");
    for (const tamper of [{ path: join("..", "..", "escape") }, { path: "/etc/x" }, { sha256: "../../../x" }]) {
      chmodSync(file, 0o600);
      writeFileSync(file, JSON.stringify({ ...m, files: [{ ...m.files[0]!, ...tamper }] }));
      expect(() => readManifest(target, m.snapshot)).toThrow(/refused/);
      await expect(verifySnapshot(target)).rejects.toThrow(/refused/);
    }
  });

  it("recreates a symlink that points at or below its folder and skips any other, so no chain leaves the restore", async () => {
    mkdirSync(join(root, "jobs", "run"), { recursive: true });
    symlinkSync("run", join(root, "jobs", "latest"));
    symlinkSync(base, join(root, "jobs", "outside"));
    // Each looks inside on its own; through each other they would climb out.
    symlinkSync("up/..", join(root, "jobs", "a"));
    symlinkSync("../..", join(root, "jobs", "up"));
    const m = (await backupRun(root, target, { now })).manifest;
    expect(m.symlinks).toHaveLength(4);
    const dest = join(base, `restored-${n}`);
    const c = await restoreSnapshot(target, m, dest, () => true);
    expect(c.symlinks).toBe(1);
    expect(c.skippedSymlinks).toBe(3);
    expect(readlinkSync(join(dest, "jobs", "latest"))).toBe("run");
    for (const l of ["outside", "a", "up"]) expect(() => lstatSync(join(dest, "jobs", l))).toThrow();
  });

  it("refuses a manifest that names another snapshot than its folder", async () => {
    const m = (await backupRun(root, target, { now })).manifest;
    const file = join(target, TENANT_DIR, "snapshots", m.snapshot, "backup-manifest.json");
    writeFileSync(file, JSON.stringify({ ...m, snapshot: ".." }));
    expect(() => readManifest(target, m.snapshot)).toThrow(/refused/);
  });

  it("reports a missing target without naming it, and does not create it", async () => {
    const gone = join(base, `not-mounted-${n}`);
    await expect(backupRun(root, gone, { now })).rejects.toBeInstanceOf(BackupTargetError);
    expect(existsSync(gone)).toBe(false);
    const err: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((s: string) => void err.push(s));
    try {
      expect(await backupCommand(["verify", "--target", gone])).toBe(3);
    } finally {
      spy.mockRestore();
    }
    expect(err.join("\n")).toMatch(/mounted and unlocked/);
    expect(err.join("\n")).not.toContain(gone);
  });
});
