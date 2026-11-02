import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ImageStore, dataRoot } from "../src/ledger/index.ts";

const dir = mkdtempSync(join(tmpdir(), "bookcase-images-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const bytes = new TextEncoder().encode("synthetic image bytes, not a photo");

describe("ImageStore", () => {
  it("stores at images/sha256/<aa>/<bb>/<hash>.<ext> under the data root", () => {
    const store = new ImageStore(join(dir, "a"));
    const { hash, path, created } = store.put(bytes, "jpeg");
    expect(hash).toBe(sha(bytes));
    expect(created).toBe(true);
    expect(relative(join(dir, "a"), path)).toBe(join("images", "sha256", hash.slice(0, 2), hash.slice(2, 4), `${hash}.jpeg`));
    expect(readFileSync(path)).toEqual(Buffer.from(bytes));
    expect(store.pathFor(hash, ".JPEG")).toBe(path);
  });

  it("is idempotent: the same bytes are the same file, written once", () => {
    const store = new ImageStore(join(dir, "b"));
    const first = store.put(bytes, "heic");
    const mtime = statSync(first.path).mtimeMs;
    const second = store.put(bytes, "heic");
    expect(second).toEqual({ ...first, created: false });
    expect(statSync(second.path).mtimeMs).toBe(mtime);
  });

  it("makes the stored file read-only and leaves no temp file behind", () => {
    const store = new ImageStore(join(dir, "c"));
    const { path } = store.put(bytes, "jpeg");
    expect(statSync(path).mode & 0o222).toBe(0);
    expect(readdirSync(join(path, "..")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("puts a file from disk without touching it", () => {
    const source = join(dir, "source.bin");
    writeFileSync(source, bytes);
    const before = statSync(source).mtimeMs;
    const stored = new ImageStore(join(dir, "d")).putFile(source, "jpeg");
    expect(stored.hash).toBe(sha(bytes));
    expect(statSync(source).mtimeMs).toBe(before);
    expect(readFileSync(source)).toEqual(Buffer.from(bytes));
  });

  it("finds a stored file by hash alone, and reports a missing one", () => {
    const store = new ImageStore(join(dir, "e"));
    const { hash, path } = store.put(bytes, "heic");
    expect(store.find(hash)).toBe(path);
    expect(store.has(hash)).toBe(true);
    expect(store.has("0".repeat(64))).toBe(false);
    expect(store.find("0".repeat(64))).toBeUndefined();
  });

  it("verifies that the bytes still hash to their name", () => {
    const store = new ImageStore(join(dir, "f"));
    const { hash, path } = store.put(bytes, "jpeg");
    expect(store.verify(hash)).toBe(true);
    chmodSync(path, 0o644);
    writeFileSync(path, "tampered");
    expect(store.verify(hash)).toBe(false);
    expect(store.verify("1".repeat(64))).toBe(false);
  });

  it("refuses a bad hash or extension, so a path never escapes the store", () => {
    const store = new ImageStore(join(dir, "g"));
    expect(() => store.pathFor("../../etc/passwd", "jpeg")).toThrow(/SHA-256/);
    expect(() => store.pathFor("A".repeat(64), "jpeg")).toThrow(/SHA-256/);
    expect(() => store.pathFor("a".repeat(64), "../x")).toThrow(/extension/);
    expect(() => store.put(bytes, "")).toThrow(/extension/);
  });
});

describe("dataRoot", () => {
  it("is $BOOKCASE_DATA, else ~/data/bookcase-discovery", () => {
    expect(dataRoot({ BOOKCASE_DATA: "/somewhere/else" })).toBe("/somewhere/else");
    expect(dataRoot({})).toBe(join(homedir(), "data", "bookcase-discovery"));
    expect(dataRoot({ BOOKCASE_DATA: "  " })).toBe(join(homedir(), "data", "bookcase-discovery"));
  });
});
