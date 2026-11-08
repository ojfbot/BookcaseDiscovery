import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

/** Release one bounds individual input blobs; models remain host-local. */
export const MAX_INPUT_BYTES = 16 * 1024 * 1024;
export const INPUT_HASH = /^[a-f0-9]{64}$/;
export const inputHash = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

export function readInput(dir: string, hash: string): Buffer {
  if (!INPUT_HASH.test(hash)) throw new Error("invalid-input");
  const file = join(dir, hash);
  if (statSync(file).size > MAX_INPUT_BYTES) throw new Error("invalid-input");
  const bytes = readFileSync(file);
  if (inputHash(bytes) !== hash) throw new Error("invalid-input");
  return bytes;
}

/** Publish complete, hash-checked bytes, syncing file and directory before acknowledgement. */
export function putInput(dir: string, hash: string, bytes: Uint8Array): void {
  if (!INPUT_HASH.test(hash) || bytes.length > MAX_INPUT_BYTES || inputHash(bytes) !== hash)
    throw new Error("invalid-input");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, hash);
  const temp = join(dir, `.input-${randomUUID()}`);
  try {
    const fd = openSync(temp, "wx", 0o400);
    try {
      writeFileSync(fd, bytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      linkSync(temp, file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      readInput(dir, hash);
    }
    const directory = openSync(dir, "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  } finally {
    unlinkSync(temp);
  }
}
