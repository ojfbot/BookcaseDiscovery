// DL-1: crash-safe writes for files nothing can rebuild, torn-line tolerant stage caches, and the catalog stamped by
// content. A crash is simulated by a write that puts half its bytes down and throws, as a killed process would.
import * as realFs from "node:fs";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const crash = vi.hoisted(() => ({ on: null as string | null }));
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  const writeFileSync = ((target: Parameters<typeof fs.writeFileSync>[0], data: string | NodeJS.ArrayBufferView, opts?: Parameters<typeof fs.writeFileSync>[2]) => {
    const text = typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf8");
    if (crash.on && text.includes(crash.on)) {
      fs.writeFileSync(target, text.slice(0, Math.floor(text.length / 2)), opts);
      throw new Error("simulated crash mid-write");
    }
    return fs.writeFileSync(target, data, opts);
  }) as typeof fs.writeFileSync;
  return { ...fs, default: { ...fs, writeFileSync, fsyncSync: vi.fn(fs.fsyncSync) }, writeFileSync, fsyncSync: vi.fn(fs.fsyncSync) };
});

const { buildCatalog } = await import("../src/catalog/build.ts");
const { buildStats, catalogStamp, legacyStamp, openStats, restampStats, stampRecordPath, statsPathFor } = await import("../src/catalog/rarity.ts");
const { readJsonl } = await import("../src/eval/f0.ts");
const { commitVersion, datasetDir } = await import("../src/eval/ts0-cli.ts");
const { openAppender, writeFileDurable } = await import("../src/ledger/durable.ts");
const { writePrivateManifest, privateManifestPath } = await import("../src/capture/manifest.ts");
const { makeMiniStaging: miniStaging } = await import("./helpers/mini-staging.ts");

const dir = mkdtempSync(join(tmpdir(), "dl1-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => {
  crash.on = null;
  vi.mocked(realFs.fsyncSync).mockClear();
});

describe("writeFileDurable", () => {
  it("fsyncs the file and its folder, and leaves no temporary file", () => {
    const p = join(dir, "durable", "a.json");
    mkdirSync(join(dir, "durable"), { recursive: true });
    writeFileDurable(p, '{"a":1}\n', { mode: 0o600 });
    expect(readFileSync(p, "utf8")).toBe('{"a":1}\n');
    expect(realFs.statSync(p).mode & 0o777).toBe(0o600);
    expect(vi.mocked(realFs.fsyncSync).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(realFs.readdirSync(join(dir, "durable"))).toEqual(["a.json"]);
  });

  it("keeps the previous file whole when the write is cut off", () => {
    const p = join(dir, "durable", "b.json");
    writeFileDurable(p, '{"v":"old"}\n');
    crash.on = "NEW";
    expect(() => writeFileDurable(p, '{"v":"NEW-NEW-NEW-NEW"}\n')).toThrow(/simulated crash/);
    expect(JSON.parse(readFileSync(p, "utf8"))).toEqual({ v: "old" });
    expect(realFs.readdirSync(join(dir, "durable")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("TS-0 commit: splits.json and latest.json survive a cut-off write", () => {
  it("leaves the previous frozen splits and latest version whole", () => {
    const root = join(dir, "ts0");
    const v1 = join(datasetDir(root), "v-1");
    commitVersion(root, v1, { "build.json": "{}\n" }, { photos: { aaaa: "train" } } as never, "v-1");
    crash.on = "MARKER";
    const v2 = join(datasetDir(root), "v-2");
    expect(() => commitVersion(root, v2, { "build.json": "{}\n" }, { photos: { aaaa: "train", MARKER: "val" } } as never, "v-2")).toThrow(/simulated crash/);
    expect(JSON.parse(readFileSync(join(datasetDir(root), "splits.json"), "utf8"))).toEqual({ photos: { aaaa: "train" } });
    expect(JSON.parse(readFileSync(join(datasetDir(root), "latest.json"), "utf8"))).toEqual({ version: "v-1" });
  });

  it("fsyncs splits.json and latest.json", () => {
    const root = join(dir, "ts0-sync");
    commitVersion(root, join(datasetDir(root), "v-1"), {}, { photos: {} } as never, "v-1");
    // splits.json and latest.json: a file and a folder fsync each.
    expect(vi.mocked(realFs.fsyncSync).mock.calls.length).toBeGreaterThanOrEqual(4);
  });
});

describe("private manifest (ingest facts)", () => {
  it("keeps the previous manifest whole when the write is cut off", () => {
    const m = { schemaVersion: 1, session: "s-dl1", ingestedWith: { metadataReader: "x" }, photos: [], rejected: [] } as never;
    writePrivateManifest(dir, m);
    crash.on = "MARKER";
    expect(() => writePrivateManifest(dir, { ...(m as object), ingestedWith: { metadataReader: "MARKER" } } as never)).toThrow(/simulated crash/);
    expect(JSON.parse(readFileSync(privateManifestPath(dir, "s-dl1"), "utf8")).ingestedWith.metadataReader).toBe("x");
  });
});

describe("readJsonl: a torn last line", () => {
  const p = join(dir, "stage.jsonl");

  it("is skipped, reported on stderr with the file and the count, and left in the file", () => {
    writeFileSync(p, '{"id":1}\n{"id":2}\n{"id":3,"re');
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(readJsonl<{ id: number }>(p).map((r) => r.id)).toEqual([1, 2]);
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/stage\.jsonl: skipped 1 torn last line .*after 2 rows/));
    err.mockRestore();
    expect(readFileSync(p, "utf8").endsWith('{"id":3,"re')).toBe(true);
  });

  it("still throws on a bad line anywhere else", () => {
    writeFileSync(p, '{"id":1}\n{"id":2,"re\n{"id":3}\n');
    expect(() => readJsonl(p)).toThrow(/line 2 of 3 is not JSON/);
  });

  it("reads a clean file, and one whose last line lacks only its newline, unchanged", () => {
    writeFileSync(p, '{"id":1}\n{"id":2}');
    expect(readJsonl<{ id: number }>(p).map((r) => r.id)).toEqual([1, 2]);
  });
});

describe("openAppender", () => {
  it("moves a torn tail to <file>.torn before appending, so the cache stays readable", () => {
    const p = join(dir, "append.jsonl");
    writeFileSync(p, '{"id":1}\n{"id":2,"re');
    const app = openAppender(p, { log: () => {} });
    app.write('{"id":3}\n');
    app.close();
    expect(readJsonl<{ id: number }>(p).map((r) => r.id)).toEqual([1, 3]);
    expect(readFileSync(`${p}.torn`, "utf8")).toBe('{"id":2,"re\n');
  });

  it("completes a last line that lacks only its newline", () => {
    const p = join(dir, "append2.jsonl");
    writeFileSync(p, '{"id":1}');
    const app = openAppender(p);
    app.write('{"id":2}\n');
    app.close();
    expect(readFileSync(p, "utf8")).toBe('{"id":1}\n{"id":2}\n');
    expect(existsSync(`${p}.torn`)).toBe(false);
  });

  it("fsyncs on close, and between writes only once the interval has passed", () => {
    const p = join(dir, "append3.jsonl");
    const app = openAppender(p, { syncMs: 60_000 });
    vi.mocked(realFs.fsyncSync).mockClear();
    for (let i = 0; i < 100; i++) app.write(`{"id":${i}}\n`);
    expect(vi.mocked(realFs.fsyncSync)).not.toHaveBeenCalled();
    app.close();
    app.close();
    expect(vi.mocked(realFs.fsyncSync)).toHaveBeenCalledTimes(1);
    expect(readJsonl(p)).toHaveLength(100);
  });
});

describe("catalogStamp by content", () => {
  const staging = join(dir, "staging.sqlite");
  beforeAll(() => miniStaging(staging));

  it("is the same for a rebuild from the same inputs at another time, and for a copy", () => {
    const a = join(dir, "cat-a.sqlite");
    const b = join(dir, "cat-b.sqlite");
    buildCatalog({ staging, out: a, now: () => new Date("2026-11-03T00:00:00Z") });
    buildCatalog({ staging, out: b, now: () => new Date("2026-11-05T00:00:00Z") });
    expect(catalogStamp(a)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(catalogStamp(b)).toBe(catalogStamp(a));
    const c = join(dir, "copy", "cat-a.sqlite");
    mkdirSync(join(dir, "copy"), { recursive: true });
    copyFileSync(a, c);
    expect(catalogStamp(c)).toBe(catalogStamp(a));
    // Read from meta: no stamp record is written beside a catalog built with the hash.
    expect(existsSync(stampRecordPath(a))).toBe(false);
  });

  it("hashes a pre-DL-1 catalog once, then reads the record; a touch or a copy keeps the stamp", () => {
    const old = join(dir, "old.sqlite");
    const db = new DatabaseSync(old);
    db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO meta VALUES ('schema_version', '1');");
    db.close();
    const first = catalogStamp(old);
    const rec = JSON.parse(readFileSync(stampRecordPath(old), "utf8"));
    expect(rec).toMatchObject({ schemaVersion: 1, sha256: first.slice(7) });
    // A record whose key matches is trusted, so a planted value comes back: the file was not read again.
    writeFileSync(stampRecordPath(old), JSON.stringify({ ...rec, sha256: "f".repeat(64) }));
    expect(catalogStamp(old)).toBe(`sha256:${"f".repeat(64)}`);
    // A touch changes the key: hashed again, to the same content stamp.
    const later = new Date(Date.now() + 60_000);
    utimesSync(old, later, later);
    expect(catalogStamp(old)).toBe(first);
    const copy = join(dir, "copy", "old.sqlite");
    copyFileSync(old, copy);
    expect(catalogStamp(copy)).toBe(first);
  });
});

describe("restampStats: the one-time re-stamp of a pre-DL-1 statistics sidecar", () => {
  it("replaces a matching size:mtime stamp with the content stamp, and refuses a sidecar of another state", () => {
    const staging = join(dir, "staging-r.sqlite");
    miniStaging(staging);
    const cat = join(dir, "cat-r.sqlite");
    buildCatalog({ staging, out: cat });
    buildStats(cat);
    const side = statsPathFor(cat);
    const set = (v: string) => {
      const db = new DatabaseSync(side);
      db.prepare("UPDATE meta SET value = ? WHERE key = 'catalog_stamp'").run(v);
      db.close();
    };
    set(legacyStamp(cat));
    expect(() => openStats(side, cat)).toThrow(/another state/);
    expect(restampStats(cat).outcome).toBe("restamped");
    expect(() => openStats(side, cat).close()).not.toThrow();
    expect(restampStats(cat).outcome).toBe("current");
    set("1:2");
    expect(() => restampStats(cat)).toThrow(/another state/);
  });
});
