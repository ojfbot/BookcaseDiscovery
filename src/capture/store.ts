// Content-addressed image store: `images/sha256/<aa>/<bb>/<hash>.<ext>` under the data root (L-2 may
// supersede this helper; the layout is the plan's). Files are stored read-only and never rewritten.
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type ImageFormat = "jpeg" | "heic";

const EXTENSION: Record<ImageFormat, string> = { jpeg: "jpg", heic: "heic" };

/** `$BOOKCASE_DATA`, defaulting to `~/data/bookcase-discovery/`. Never inside a checkout. */
export function dataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.BOOKCASE_DATA || join(homedir(), "data", "bookcase-discovery");
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export class ImageStore {
  readonly root: string;

  constructor(dataDir: string) {
    this.root = join(dataDir, "images", "sha256");
  }

  /** Where the file with this hash lives (or would live). */
  pathFor(hash: string, format: ImageFormat): string {
    return join(this.root, hash.slice(0, 2), hash.slice(2, 4), `${hash}.${EXTENSION[format]}`);
  }

  /** Copy `src` into the store under `hash` and make it read-only. Already stored: no-op. */
  put(src: string, hash: string, format: ImageFormat, options: { move?: boolean } = {}): string {
    const dest = this.pathFor(hash, format);
    if (existsSync(dest)) return dest;
    mkdirSync(join(dest, ".."), { recursive: true });
    if (options.move) renameSync(src, dest);
    else copyFileSync(src, dest);
    chmodSync(dest, 0o444);
    return dest;
  }
}
