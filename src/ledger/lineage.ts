// Lineage stamps (DL-3). The ledger holds facts; everything else under the data root is derived data that can be
// rebuilt, and every derived file names what produced it, so a stale file is told from a fresh one by a comparison
// of hashes and never by recomputing anything:
//
//   boxSet      the box-set hash TS-0 computes (null for a file upstream of any box set, such as a detection cache)
//   models      model folder name -> content hash of its weights, from the models manifest (src/ledger/models.ts)
//   catalog     the catalog's content stamp (`catalogStamp` in src/catalog/rarity.ts), null when no catalog was read
//   codeCommit  the git commit of the code that wrote the file, and whether the tree was dirty
//   schema      the file class and its own format version
//   writtenAt   when the file was written
//
// The stamp is a sidecar, `<file>.lineage.json`, beside the file it describes. A first line inside the file would
// have changed `readJsonl` (src/eval/f0.ts) and its callers, and the Python helpers that read the same JSONL files
// (resolve.py, stage.py, strata.py) read them line by line with no header. The sidecar is written durably after the
// file it describes, so a crash between the two leaves a file with no stamp or an old one, which a reader refuses.
//
// A reader compares the stamp's `schema`, `boxSet`, `models` and `catalog` with the inputs it has in hand and refuses
// on the first difference, naming the field, unless `--allow-stale` (or BOOKCASE_ALLOW_STALE=1) is given. The commit
// is recorded for provenance and reported, never compared: every merge would otherwise refuse every cache, and the
// owner's caches take hours of GPU time to rebuild. A file with no stamp is refused too, naming the re-stamp pass
// (`bookcase lineage restamp`). Derivation graph: docs/lineage.md.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { shownPath, writeFileDurable } from "./durable.ts";

export const LINEAGE_VERSION = 1;

/** A file class and its own format version: what a reader must understand to read the rows. */
export interface LineageSchema {
  name: string;
  version: number;
}

export interface CodeCommit {
  /** The commit of the repository the writer ran from; null when it could not be read (no git, no repository). */
  commit: string | null;
  /** Whether `src/` or `helpers/` had uncommitted changes when the file was written. */
  dirty: boolean;
}

export interface LineageStamp {
  lineageVersion: number;
  schema: LineageSchema;
  boxSet: string | null;
  /** Model folder name -> `sha256:<hex>` of its weights (the models manifest's hash). */
  models: Record<string, string>;
  /** `sha256:<hex>` of the catalog read, or null when none was. */
  catalog: string | null;
  codeCommit: CodeCommit;
  writtenAt: string;
  /** Present when the stamp was written by the re-stamp pass, not by the writer that made the file. */
  restamped?: {
    at: string;
    /** The fields taken from the current state rather than known: the pass assumes nothing changed since the write. */
    assumed: string[];
  };
}

/** What a reader expects: only the fields given are compared, and a field the stamp lacks counts as a difference. */
export interface LineageExpect {
  schema?: LineageSchema;
  boxSet?: string;
  models?: Record<string, string>;
  catalog?: string;
}

export class LineageError extends Error {
  /** The stamp field that differs (`models.<name>`, `catalog`, `boxSet`, `schema.version`), or `stamp` when there is none. */
  readonly field: string;
  readonly file: string;
  constructor(message: string, field: string, file: string) {
    super(message);
    this.name = "LineageError";
    this.field = field;
    this.file = file;
  }
}

export const RESTAMP_COMMAND = "bookcase lineage restamp";

export const lineagePath = (file: string): string => `${file}.lineage.json`;

/** True when the caller asked to read stale or unstamped files anyway: `--allow-stale` on the command line or BOOKCASE_ALLOW_STALE=1. */
export function staleAllowed(argv: readonly string[] = process.argv, env: Record<string, string | undefined> = process.env): boolean {
  return argv.includes("--allow-stale") || env.BOOKCASE_ALLOW_STALE === "1";
}

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const commitCache = new Map<string, CodeCommit>();

/** The commit and dirty state of `repo` (default: this repository), read once per process. Null commit without git. */
export function codeCommit(repo: string = REPO_ROOT): CodeCommit {
  const hit = commitCache.get(repo);
  if (hit) return hit;
  let out: CodeCommit;
  try {
    const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const commit = git("rev-parse", "HEAD");
    const dirty = git("status", "--porcelain", "--", "src", "helpers", "bin") !== "";
    out = { commit: /^[0-9a-f]{40}$/.test(commit) ? commit : null, dirty };
  } catch {
    out = { commit: null, dirty: false };
  }
  commitCache.set(repo, out);
  return out;
}

/** For tests: forget the cached commit. */
export function resetCodeCommitCache(): void {
  commitCache.clear();
}

/** A stamp for a file written now, by this code. */
export function makeStamp(parts: { schema: LineageSchema; boxSet?: string | null; models?: Record<string, string>; catalog?: string | null }, now: Date = new Date()): LineageStamp {
  return {
    lineageVersion: LINEAGE_VERSION,
    schema: parts.schema,
    boxSet: parts.boxSet ?? null,
    models: sortedModels(parts.models ?? {}),
    catalog: parts.catalog ?? null,
    codeCommit: codeCommit(),
    writtenAt: now.toISOString(),
  };
}

/**
 * A stamp for a file written before DL-3, by the re-stamp pass: the fields in `assumed` are the current state, taken
 * on the assumption that nothing changed since the file was written; the commit that wrote it is unknown.
 */
export function restampedStamp(parts: { schema: LineageSchema; boxSet?: string | null; models?: Record<string, string>; catalog?: string | null }, assumed: string[], now: Date = new Date()): LineageStamp {
  return { ...makeStamp(parts, now), codeCommit: { commit: null, dirty: false }, restamped: { at: now.toISOString(), assumed: [...assumed].sort() } };
}

const sortedModels = (m: Record<string, string>): Record<string, string> => Object.fromEntries(Object.keys(m).sort().map((k) => [k, m[k]!]));

/** Write `<file>.lineage.json` durably. Call after the file itself is on disk. */
export function writeLineage(file: string, stamp: LineageStamp): void {
  writeFileDurable(lineagePath(file), `${JSON.stringify(stamp, null, 1)}\n`);
}

/** The stamp beside `file`, or null when there is none. A stamp that is not JSON or not a stamp throws. */
export function readLineage(file: string): LineageStamp | null {
  const side = lineagePath(file);
  if (!existsSync(side)) return null;
  let s: unknown;
  try {
    s = JSON.parse(readFileSync(side, "utf8"));
  } catch (e) {
    throw new LineageError(`${shownPath(side)}: not JSON (${(e as Error).message})`, "stamp", file);
  }
  if (!isStamp(s)) throw new LineageError(`${shownPath(side)}: not a lineage stamp`, "stamp", file);
  return s;
}

function isStamp(s: unknown): s is LineageStamp {
  if (!s || typeof s !== "object") return false;
  const x = s as Record<string, unknown>;
  return (
    typeof x.lineageVersion === "number" &&
    !!x.schema &&
    typeof (x.schema as LineageSchema).name === "string" &&
    typeof (x.schema as LineageSchema).version === "number" &&
    (x.boxSet === null || typeof x.boxSet === "string") &&
    !!x.models &&
    typeof x.models === "object" &&
    (x.catalog === null || typeof x.catalog === "string") &&
    !!x.codeCommit &&
    typeof x.writtenAt === "string"
  );
}

/**
 * The fields of `stamp` that differ from `expect`, in a fixed order: `schema.name`, `schema.version`, `boxSet`,
 * `models.<name>` (sorted; a model the stamp lacks differs), then `catalog`. Empty when the stamp matches.
 */
export function lineageDiff(stamp: LineageStamp, expect: LineageExpect): { field: string; stamped: string | null; current: string }[] {
  const out: { field: string; stamped: string | null; current: string }[] = [];
  if (expect.schema) {
    if (stamp.schema.name !== expect.schema.name) out.push({ field: "schema.name", stamped: stamp.schema.name, current: expect.schema.name });
    if (stamp.schema.version !== expect.schema.version) out.push({ field: "schema.version", stamped: String(stamp.schema.version), current: String(expect.schema.version) });
  }
  if (expect.boxSet !== undefined && stamp.boxSet !== expect.boxSet) out.push({ field: "boxSet", stamped: stamp.boxSet, current: expect.boxSet });
  if (expect.models)
    for (const name of Object.keys(expect.models).sort()) {
      const stamped = stamp.models[name] ?? null;
      if (stamped !== expect.models[name]) out.push({ field: `models.${name}`, stamped, current: expect.models[name]! });
    }
  if (expect.catalog !== undefined && stamp.catalog !== expect.catalog) out.push({ field: "catalog", stamped: stamp.catalog, current: expect.catalog });
  return out;
}

const short = (h: string | null): string => (h === null ? "none" : h.length > 23 ? `${h.slice(0, 23)}…` : h);

export interface CheckOptions {
  allowStale?: boolean;
  log?: (s: string) => void;
}

/**
 * Open `file` for reading: compare its stamp with `expect` and throw a `LineageError` naming the first field that
 * differs, or naming the re-stamp pass when there is no stamp. A missing file is fine (nothing to be stale) and
 * returns null. With `allowStale` the difference is logged on stderr and the stamp (or null) returned. `expect` may
 * be a function of the stamp, for a reader that only knows that whatever the stamp names must be current.
 */
export function checkLineage(file: string, expect: LineageExpect | ((stamp: LineageStamp) => LineageExpect), opts: CheckOptions = {}): LineageStamp | null {
  if (!existsSync(file)) return null;
  const allow = opts.allowStale ?? staleAllowed();
  const log = opts.log ?? ((s: string) => process.stderr.write(`${s}\n`));
  const stamp = readLineage(file);
  if (!stamp) {
    const msg = `${shownPath(file)}: no lineage stamp (written before DL-3?): run \`${RESTAMP_COMMAND}\`, or pass --allow-stale`;
    if (!allow) throw new LineageError(msg, "stamp", file);
    log(`lineage: ${msg} (reading anyway)`);
    return null;
  }
  const diff = lineageDiff(stamp, typeof expect === "function" ? expect(stamp) : expect);
  if (diff.length) {
    const d = diff[0]!;
    const msg = `${shownPath(file)}: stale: ${d.field} is ${short(d.stamped)} in the stamp, ${short(d.current)} now${diff.length > 1 ? ` (and ${diff.length - 1} more)` : ""}: rebuild it, or pass --allow-stale`;
    if (!allow) throw new LineageError(msg, d.field, file);
    log(`lineage: ${msg} (reading anyway)`);
  }
  return stamp;
}
