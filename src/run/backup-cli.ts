// `bookcase backup <snapshot|run|verify|restore-drill> --target <mount>` (DL-6, docs/backup.md): versioned copies of
// the data root on a mounted share, a re-hash of them, and a drill that rebuilds TS-0's dataset from a restore.
// Output is counts, bytes and seconds only: never the target's path, the data root's path or a file name.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statfsSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { catalogPaths } from "../catalog/cli.ts";
import { statsPathFor } from "../catalog/rarity.ts";
import {
  backupRun,
  backupSnapshot,
  BackupTargetError,
  CLASS_ORDER,
  DEFAULT_KEEP,
  freshDir,
  latestManifest,
  readManifest,
  removeDrillScratch,
  restoreSnapshot,
  RESTORE_DRILL_DIR,
  strayEmptyFiles,
  verifySnapshot,
  type BackupClass,
  type ClassCounts,
  type RunResult,
} from "../ledger/backup.ts";
import { dataRoot } from "../ledger/images.ts";

const BIN = fileURLToPath(new URL("../../bin/bookcase", import.meta.url));

export const backupUsage = `usage: bookcase backup <command> --target <mount> [options]

commands:
  snapshot        a consistent copy of every fact database (the event ledgers) through SQLite's own backup path,
                  as a "ledgers" snapshot: quick, safe while a writer is open
  run             the fact databases first, then every other file under the data root, into a new dated snapshot;
                  a file unchanged since the last run is not copied again, and nothing on the target is overwritten
  verify          re-hash the latest snapshot's copies against its fact manifest (facts always; the rest by size
                  unless --all) and report counts
  restore-drill   restore the latest snapshot into a fresh scratch root under the data root's ${RESTORE_DRILL_DIR}/<date>/,
                  replay its ledgers, rebuild TS-0's dataset there and compare the version with the live one;
                  a clean pass deletes the scratch root, a failed one leaves it for inspection

options:
  --target <mount>    the mounted share (or a folder on it); this repo writes only inside its ${"`bookcase-discovery/`"} folder
  --keep <n>          run, snapshot: snapshots of that kind to keep (default ${DEFAULT_KEEP}); older ones are pruned
  --snapshot <id>     verify, restore-drill: a snapshot other than the latest
  --all               verify: re-hash every class, not only the facts
  --concurrency <n>   files in flight at once (default 8)
  --keep-scratch      restore-drill: leave the scratch root in place after a clean pass too

The credentials file under labels/ is never opened or copied. Nothing under the data root is ever deleted but a
clean drill's own scratch root.`;

const gb = (b: number): string => `${(b / 1e9).toFixed(2)} GB`;
const pad = (s: string | number, n: number): string => String(s).padStart(n);

function printRun(r: RunResult, root: string, target: string): void {
  const m = r.manifest;
  for (const cls of CLASS_ORDER) {
    const c: ClassCounts = m.counts[cls];
    if (!c.files) continue;
    console.log(`${cls.padEnd(13)} files ${pad(c.files, 7)}  bytes ${pad(c.bytes, 14)} (${gb(c.bytes)})  new ${pad(c.newFiles, 7)} (${gb(c.newBytes)})  ${pad(c.seconds.toFixed(1), 7)} s`);
  }
  const total = CLASS_ORDER.reduce((s, c) => s + m.counts[c].bytes, 0);
  const added = CLASS_ORDER.reduce((s, c) => s + m.counts[c].newBytes, 0);
  console.log(`snapshot ${m.snapshot} (${m.kind}): ${m.files.length} files and ${m.symlinks.length} symlinks, ${gb(total)} in the snapshot, ${gb(added)} new on the target, in ${r.seconds.toFixed(1)} s`);
  if (m.kind === "full") console.log(`${Object.keys(m.lineage).length} lineage stamps recorded; ${m.excluded} entries left out (the credentials file among them); ${m.changedDuringRun} files changed while being read`);
  if (r.pruned.snapshots) console.log(`pruned ${r.pruned.snapshots} old snapshots and ${r.pruned.bodies} bodies no kept snapshot names (${gb(r.pruned.bytes)})`);
  const strays = strayEmptyFiles(root);
  if (strays) console.log(`${strays} empty files at the data root's top level (reported, not removed)`);
  try {
    const fs = statfsSync(target);
    console.log(`target: ${gb(fs.bavail * fs.bsize)} free of ${gb(fs.blocks * fs.bsize)}`);
  } catch {
    // Some shares do not report their size.
  }
}

const sha256 = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

/** Run `bookcase <args>` with `env`, its output captured: it names private paths, so only counts are passed on. */
function bookcase(args: string[], env: NodeJS.ProcessEnv): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [BIN, ...args], { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

export interface DrillResult {
  scratch: string;
  restore: Awaited<ReturnType<typeof restoreSnapshot>>;
  replays: { ledgers: number; identical: number; events: number; seconds: number };
  build: { version: string | null; labels: number; photos: number; seconds: number };
  live: { version: string | null; labelsMatch: boolean | null };
  ok: boolean;
}

/**
 * The restore drill: the latest snapshot's facts, derived and unclassified files, the models manifest and the catalog
 * TS-0 reads, restored into a fresh scratch root; then `bookcase replay` on each restored ledger and `bookcase dataset
 * build` with the scratch root as the data root. Dataset versions are not restored, so the build writes its version
 * anew. The caller deletes the scratch root after a clean pass (`removeDrillScratch`).
 */
export async function restoreDrill(target: string, opts: { root?: string; snapshot?: string; now?: Date; concurrency?: number; env?: NodeJS.ProcessEnv } = {}): Promise<DrillResult> {
  const root = opts.root ?? dataRoot();
  const env = opts.env ?? process.env;
  const m = opts.snapshot ? readManifest(target, opts.snapshot) : latestManifest(target);
  if (!m) throw new Error("the target has no full snapshot yet: run `bookcase backup run` first");
  const { datasetDir } = await import("../eval/ts0-cli.ts");
  const datasetRel = relative(root, datasetDir(root));
  const liveCatalog = catalogPaths({ ...env, BOOKCASE_DATA: root }).catalog;
  const catalogRel = relative(root, liveCatalog);
  const catalogInside = !catalogRel.startsWith("..") && !isAbsolute(catalogRel);
  const statsRel = relative(root, statsPathFor(liveCatalog));
  const sameFile = (p: string, base: string): boolean => p === base || p.startsWith(`${base}.`) || p.startsWith(`${base}-`);
  const want = (p: string, cls: BackupClass): boolean => {
    if (p.startsWith(datasetRel + sep)) {
      const rest = p.slice(datasetRel.length + 1);
      if (rest.startsWith("v-") || rest.startsWith("latest.json")) return false;
    }
    if (cls === "fact" || cls === "derived" || cls === "unclassified") return true;
    if (p === join("models", "manifest.json")) return true;
    return catalogInside && (sameFile(p, catalogRel) || sameFile(p, statsRel));
  };
  const scratch = freshDir(join(root, RESTORE_DRILL_DIR), (opts.now ?? new Date()).toISOString().slice(0, 10));
  const restore = await restoreSnapshot(target, m, scratch, want, { concurrency: opts.concurrency });

  const childEnv: NodeJS.ProcessEnv = { ...env, BOOKCASE_DATA: scratch };
  delete childEnv.BOOKCASE_ALLOW_STALE;
  if (env.BOOKCASE_CATALOG && isAbsolute(env.BOOKCASE_CATALOG) && catalogInside) childEnv.BOOKCASE_CATALOG = join(scratch, catalogRel);

  const t1 = Date.now();
  const ledgers = m.files.filter((e) => e.consistent && /^ledger[/\\][^/\\]+\.sqlite$/.test(e.path)).map((e) => e.path);
  const replays = { ledgers: ledgers.length, identical: 0, events: 0, seconds: 0 };
  for (const rel of ledgers) {
    const r = bookcase(["replay", join(scratch, rel), "--to", join(scratch, "replay", rel)], childEnv);
    const n = /replayed (\d+) events/.exec(r.stdout + r.stderr);
    replays.events += n ? Number(n[1]) : 0;
    if (r.status === 0) replays.identical++;
  }
  replays.seconds = (Date.now() - t1) / 1000;

  const t2 = Date.now();
  const b = bookcase(["dataset", "build"], childEnv);
  const got = /^(v-[0-9a-f]+): (\d+) labels on (\d+) photos/m.exec(b.stdout);
  const build = { version: got?.[1] ?? null, labels: got ? Number(got[2]) : 0, photos: got ? Number(got[3]) : 0, seconds: (Date.now() - t2) / 1000 };
  if (b.status !== 0 || !got) {
    // The build's own message names the missing input relative to the data root; pass its last line on.
    const last = b.stderr.trim().split("\n").at(-1) ?? "";
    console.error(`dataset build in the scratch root failed: ${last.replaceAll(scratch, "<scratch>")}`);
  }

  const latest = join(datasetDir(root), "latest.json");
  const liveVersion = existsSync(latest) ? (JSON.parse(readFileSync(latest, "utf8")) as { version: string }).version : null;
  let labelsMatch: boolean | null = null;
  if (build.version && liveVersion === build.version) {
    const a = join(datasetDir(root), liveVersion, "labels.jsonl");
    const c = join(datasetDir(scratch), build.version, "labels.jsonl");
    labelsMatch = existsSync(a) && existsSync(c) ? sha256(a) === sha256(c) : null;
  }
  const ok = replays.identical === replays.ledgers && !!build.version && build.version === liveVersion && labelsMatch !== false;
  return { scratch, restore, replays, build, live: { version: liveVersion, labelsMatch }, ok };
}

export async function backupCommand(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        target: { type: "string" },
        keep: { type: "string" },
        snapshot: { type: "string" },
        all: { type: "boolean" },
        concurrency: { type: "string" },
        "keep-scratch": { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (e) {
    console.error(`bookcase backup: ${e instanceof Error ? e.message : e}\n\n${backupUsage}`);
    return 1;
  }
  const { values, positionals } = parsed;
  const [cmd] = positionals;
  if (values.help || !cmd) {
    console.log(backupUsage);
    return values.help ? 0 : 1;
  }
  if (!["snapshot", "run", "verify", "restore-drill"].includes(cmd)) {
    console.error(`bookcase backup: unknown command "${cmd}"\n\n${backupUsage}`);
    return 1;
  }
  const target = values.target;
  if (!target) {
    console.error(`bookcase backup ${cmd}: --target <mount> is required\n\n${backupUsage}`);
    return 1;
  }
  const keep = values.keep === undefined ? undefined : Number(values.keep);
  const concurrency = values.concurrency === undefined ? undefined : Number(values.concurrency);
  const root = dataRoot();
  try {
    if (cmd === "snapshot" || cmd === "run") {
      const r = cmd === "run" ? await backupRun(root, target, { keep, concurrency, log: (s) => console.error(`[backup] ${s}`) }) : await backupSnapshot(root, target, { keep });
      printRun(r, root, target);
      return 0;
    }
    if (cmd === "verify") {
      const v = await verifySnapshot(target, { snapshot: values.snapshot, all: values.all, concurrency });
      for (const cls of CLASS_ORDER) {
        const c = v.byClass[cls];
        if (!c.checked) continue;
        console.log(`${cls.padEnd(13)} checked ${pad(c.checked, 7)}  ok ${pad(c.ok, 7)}  missing ${pad(c.missing, 4)}  changed ${pad(c.changed, 4)}${c.sizeOnly ? `  (${c.sizeOnly} by size)` : ""}`);
      }
      console.log(`snapshot ${v.snapshot}: ${v.ok ? "verified" : "FAILED"} in ${v.seconds.toFixed(1)} s`);
      return v.ok ? 0 : 1;
    }
    const d = await restoreDrill(target, { root, snapshot: values.snapshot, concurrency });
    for (const cls of CLASS_ORDER) {
      const c = d.restore.byClass[cls];
      if (c.files) console.log(`restored ${cls.padEnd(13)} files ${pad(c.files, 7)}  bytes ${pad(c.bytes, 14)} (${gb(c.bytes)})`);
    }
    console.log(`restored ${d.restore.files} files and ${d.restore.symlinks} symlinks (${gb(d.restore.bytes)}) in ${d.restore.seconds.toFixed(1)} s${d.restore.skippedSymlinks ? `; ${d.restore.skippedSymlinks} symlinks pointing outside the restore not recreated` : ""}`);
    console.log(`replay: ${d.replays.identical} of ${d.replays.ledgers} ledgers identical (${d.replays.events} events) in ${d.replays.seconds.toFixed(1)} s`);
    console.log(`dataset build: ${d.build.version ?? "failed"} (${d.build.labels} labels on ${d.build.photos} photos) in ${d.build.seconds.toFixed(1)} s`);
    console.log(`live version ${d.live.version ?? "none"}: ${d.build.version === d.live.version ? "matches" : "DIFFERS"}${d.live.labelsMatch === null ? "" : d.live.labelsMatch ? ", labels identical" : ", labels DIFFER"}`);
    const where = `the data root's ${relative(root, d.scratch)}/`;
    if (d.ok && !values["keep-scratch"]) {
      const freed = removeDrillScratch(root, d.scratch);
      console.log(`scratch root ${where} deleted after the clean pass (${freed} bytes, ${gb(freed)} freed)`);
    } else {
      console.log(`scratch root left in place: ${where}${d.ok ? "" : " (for inspection)"}`);
    }
    return d.ok ? 0 : 1;
  } catch (e) {
    console.error(`bookcase backup ${cmd}: ${e instanceof BackupTargetError ? e.message : e instanceof Error ? e.message.replaceAll(target, "<target>").replaceAll(root, "<data root>") : e}`);
    return e instanceof BackupTargetError ? 3 : 1;
  }
}
