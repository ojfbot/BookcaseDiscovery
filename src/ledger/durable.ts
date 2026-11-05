// Crash-safe file writes (DL-1). Nothing is backed up until a NAS exists (an accepted risk), so the files that
// cannot be rebuilt — facts and frozen history — must survive a killed process or a power cut whole.
//
//   writeFileDurable(path, text)    temporary file beside it, fsync, rename over, fsync the folder:
//                                   a reader sees the old file or the new one, never half of either
//   openAppender(path)              line appends for stage caches, fsynced at most every `syncMs` and on close;
//                                   a crash loses at most the last unsynced lines, and `readJsonl` skips a torn one
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fstatSync, fsyncSync, ftruncateSync, openSync, readSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { dirname, relative, sep } from "node:path";
import { dataRoot } from "./images.ts";

/** A path as logs show it: relative to the data root when inside it, so no private folder names reach a log. */
export function shownPath(path: string): string {
  const rel = relative(dataRoot(), path);
  return rel && !rel.startsWith("..") && !rel.startsWith(sep) ? rel : path;
}

/** fsync a folder so a rename or a new name in it is on disk. Some platforms cannot open a folder: skipped there. */
export function fsyncDir(dir: string): void {
  let fd: number;
  try {
    fd = openSync(dir, "r");
  } catch {
    return;
  }
  try {
    fsyncSync(fd);
  } catch (e) {
    if (!["EISDIR", "EINVAL", "EPERM", "EBADF"].includes((e as NodeJS.ErrnoException).code ?? "")) throw e;
  } finally {
    closeSync(fd);
  }
}

/**
 * Replace `path` with `data` atomically and durably. The temporary name is unique per call, so two writers never
 * share one; it is removed if anything fails before the rename. `mode` applies to a new file (less the umask).
 */
export function writeFileDurable(path: string, data: string | Uint8Array, opts: { mode?: number } = {}): void {
  const tmp = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    const fd = openSync(tmp, "w", opts.mode ?? 0o666);
    try {
      writeFileSync(fd, data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  fsyncDir(dirname(path));
}

export interface Appender {
  /** Append text (whole lines, each ending in "\n"). */
  write(text: string): void;
  /** fsync and close. Safe to call twice. */
  close(): void;
}

/**
 * Stage appends are fsynced at most this often. Measured on 200,000 synthetic 340-byte lines (68 MB, M4): one
 * `appendFileSync` per line 4.3 s, this appender 0.5 s, an fsync per line about 4 ms a line (some 800 s).
 */
export const APPEND_SYNC_MS = 1000;

/**
 * Open `path` for line appends. If its last line is torn (a writer killed mid-line), the fragment is moved to
 * `<path>.torn` first — kept, never deleted — so new lines never land behind it and the cache stays readable.
 */
export function openAppender(path: string, opts: { syncMs?: number; log?: (s: string) => void } = {}): Appender {
  const syncMs = opts.syncMs ?? APPEND_SYNC_MS;
  const created = !existsSync(path);
  setAsideTornTail(path, opts.log ?? ((s) => process.stderr.write(`${s}\n`)));
  const fd = openSync(path, "a");
  if (created) fsyncDir(dirname(path));
  let last = Date.now();
  let open = true;
  return {
    write(text) {
      writeSync(fd, text);
      if (syncMs <= 0 || Date.now() - last >= syncMs) {
        fsyncSync(fd);
        last = Date.now();
      }
    },
    close() {
      if (!open) return;
      open = false;
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    },
  };
}

/** The byte offset where the file's last line starts, and that line (without its newline). Reads backwards in chunks. */
export function lastLine(fd: number, size: number): { start: number; text: string } {
  const chunk = 64 * 1024;
  let end = size;
  // A final newline ends the last line; it is not part of it.
  if (end > 0) {
    const b = Buffer.alloc(1);
    readSync(fd, b, 0, 1, end - 1);
    if (b[0] === 0x0a) end--;
  }
  const parts: Buffer[] = [];
  let pos = end;
  while (pos > 0) {
    const n = Math.min(chunk, pos);
    const buf = Buffer.alloc(n);
    readSync(fd, buf, 0, n, pos - n);
    const nl = buf.lastIndexOf(0x0a);
    if (nl >= 0) {
      parts.unshift(buf.subarray(nl + 1));
      return { start: pos - n + nl + 1, text: Buffer.concat(parts).toString("utf8") };
    }
    parts.unshift(buf);
    pos -= n;
  }
  return { start: 0, text: Buffer.concat(parts).toString("utf8") };
}

const parses = (s: string): boolean => {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
};

/**
 * A JSONL file whose last line does not parse has a torn tail. Move it to `<path>.torn` (appended, fsynced) and cut
 * the file back to the line before it. A last line that parses but lacks its newline gets one. Returns the bytes moved.
 */
export function setAsideTornTail(path: string, log: (s: string) => void = () => {}): number {
  if (!existsSync(path)) return 0;
  const fd = openSync(path, "r+");
  try {
    const size = fstatSync(fd).size;
    if (size === 0) return 0;
    const { start, text } = lastLine(fd, size);
    if (text.trim() === "" || parses(text)) {
      const b = Buffer.alloc(1);
      readSync(fd, b, 0, 1, size - 1);
      if (b[0] !== 0x0a) {
        writeSync(fd, "\n", size);
        fsyncSync(fd);
      }
      return 0;
    }
    const torn = Buffer.alloc(size - start);
    readSync(fd, torn, 0, torn.length, start);
    const side = openSync(`${path}.torn`, "a");
    try {
      writeSync(side, torn);
      if (torn[torn.length - 1] !== 0x0a) writeSync(side, "\n");
      fsyncSync(side);
    } finally {
      closeSync(side);
    }
    fsyncDir(dirname(path));
    ftruncateSync(fd, start);
    fsyncSync(fd);
    log(`append: ${shownPath(path)}: moved a torn last line (${torn.length} bytes) to ${path.split("/").at(-1)}.torn`);
    return torn.length;
  } finally {
    closeSync(fd);
  }
}
