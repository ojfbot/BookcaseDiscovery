// Content-addressed image store (ADR §10, INV-12): `<root>/images/sha256/<aa>/<bb>/<hash>.<ext>`,
// where `aa` and `bb` are the first two byte pairs of the hash. Originals and working copies live in
// the same store, told apart by their hashes. The store sits under `$BOOKCASE_DATA`, never in the
// repo, and a stored file is never rewritten: the same bytes are the same path.
//
// Other modules (K-1's ingest) agree with this one only through the path layout above.
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeFileDurable } from "./durable.ts";

const HASH = /^[0-9a-f]{64}$/;
const EXT = /^[a-z0-9]{1,8}$/;

/** `$BOOKCASE_DATA`, or `~/data/bookcase-discovery/` when unset. */
export function dataRoot(env: Record<string, string | undefined> = process.env): string {
  return env.BOOKCASE_DATA?.trim() || join(homedir(), "data", "bookcase-discovery");
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface StoredImage {
  hash: string;
  path: string;
  /** False when the bytes were already in the store. */
  created: boolean;
}

export class ImageStore {
  /** The directory that holds `sha256/`: `<data root>/images`. */
  readonly root: string;

  /** `dataDir` is the data root (`$BOOKCASE_DATA`); the store is its `images/` directory. */
  constructor(dataDir: string = dataRoot()) {
    this.root = join(dataDir, "images");
  }

  static #ext(ext: string): string {
    const e = ext.replace(/^\./, "").toLowerCase();
    if (!EXT.test(e)) throw new Error(`image store: bad extension "${ext}"`);
    return e;
  }

  static #hash(hash: string): string {
    if (!HASH.test(hash)) throw new Error(`image store: not a lower-case hex SHA-256: "${hash}"`);
    return hash;
  }

  /** Where `hash` with `ext` lives. The file need not exist. */
  pathFor(hash: string, ext: string): string {
    ImageStore.#hash(hash);
    return join(this.root, "sha256", hash.slice(0, 2), hash.slice(2, 4), `${hash}.${ImageStore.#ext(ext)}`);
  }

  /** The stored file for `hash`, whatever its extension, or undefined. */
  find(hash: string): string | undefined {
    ImageStore.#hash(hash);
    const dir = join(this.root, "sha256", hash.slice(0, 2), hash.slice(2, 4));
    if (!existsSync(dir)) return undefined;
    const name = readdirSync(dir).find((f) => f.startsWith(`${hash}.`) && !f.endsWith(".tmp"));
    return name && join(dir, name);
  }

  has(hash: string): boolean {
    return this.find(hash) !== undefined;
  }

  /**
   * Store `bytes`; returns their hash and path. Idempotent: bytes already stored are left alone.
   * The file is written beside its destination and renamed into place, so a reader never sees half a
   * file, and it is made read-only so nothing rewrites an original (INV-12).
   */
  put(bytes: Uint8Array, ext: string): StoredImage {
    const hash = sha256Hex(bytes);
    const path = this.pathFor(hash, ext);
    if (existsSync(path)) return { hash, path, created: false };
    mkdirSync(join(path, ".."), { recursive: true });
    // fsynced before and after the rename (DL-1): an original is a fact nothing can rebuild.
    writeFileDurable(path, bytes, { mode: 0o444 });
    chmodSync(path, 0o444);
    return { hash, path, created: true };
  }

  /** Store the file at `source` (read, never modified). */
  putFile(source: string, ext: string): StoredImage {
    return this.put(readFileSync(source), ext);
  }

  /** True when the stored file's bytes still hash to `hash`. */
  verify(hash: string): boolean {
    const path = this.find(hash);
    return path !== undefined && sha256Hex(readFileSync(path)) === hash;
  }
}
