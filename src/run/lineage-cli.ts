// `bookcase lineage <restamp|show>`: the one-time re-stamp pass for derived files written before DL-3, and a look
// at one file's stamp. Classes: src/eval/lineage-classes.ts; the graph: docs/lineage.md. Output is counts only.
import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import { dataRoot } from "../ledger/images.ts";
import { lineagePath, readLineage, restampedStamp, writeLineage, type LineageStamp } from "../ledger/lineage.ts";
import { modelHashes, readModelsManifest, MANIFEST_COMMAND } from "../ledger/models.ts";

export const lineageUsage = `usage: bookcase lineage <command>

commands:
  restamp [--dry-run]   give every derived file under the data root that has no lineage stamp one: F-0's stage
                        caches, H-2's depth stage files, F-0i's partition and TS-0's dataset versions. A file that
                        already has a stamp is left alone, so the pass can run again. The stamp records that it was
                        re-stamped and which fields (the weights, the catalog) it took from the current state.
  show <file>           print the stamp beside <file>

Run \`${MANIFEST_COMMAND}\` first: a stamp names models by the manifest's hashes.`;

export interface RestampCounts {
  found: number;
  stamped: number;
  already: number;
  byClass: Record<string, { found: number; stamped: number; already: number }>;
  seconds: number;
}

/** Every regular file under `root` whose folder is not skipped, relative to `root`. Sidecars and torn tails are left out. */
function* walk(root: string, skip: Set<string>, rel = ""): Generator<string> {
  const dir = join(root, rel);
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const r = rel ? join(rel, e.name) : e.name;
    if (e.isDirectory()) {
      if (!skip.has(e.name)) yield* walk(root, skip, r);
    } else if (e.isFile() && !e.name.endsWith(".lineage.json") && !e.name.endsWith(".torn") && !e.name.endsWith(".tmp")) yield r;
  }
}

/**
 * The re-stamp pass. Idempotent: a file with a stamp is counted and left as it is. With `dryRun` nothing is written.
 */
export async function restamp(root: string = dataRoot(), opts: { dryRun?: boolean; now?: Date } = {}): Promise<RestampCounts> {
  const t0 = Date.now();
  if (!readModelsManifest(root)) throw new Error(`no models manifest at the data root: run \`${MANIFEST_COMMAND}\` first`);
  // Loaded here: the classes pull in the catalog and the experiments' loaders.
  const { classOf, DATASET_SCHEMA, DEPTH_MODELS, DEPTH_STAGE_SCHEMA, FACES_SCHEMA, PARTITION_MODELS, PARTITION_SCHEMA, SKIP_DIRS } = await import("../eval/lineage-classes.ts");
  const { armsOf, readJsonl, stageExpect } = await import("../eval/f0.ts");
  const { versionStampParts } = await import("../eval/ts0-cli.ts");
  const now = opts.now ?? new Date();
  const counts: RestampCounts = { found: 0, stamped: 0, already: 0, byClass: {}, seconds: 0 };
  const tally = (cls: string, k: "found" | "stamped" | "already") => {
    counts[k]++;
    (counts.byClass[cls] ??= { found: 0, stamped: 0, already: 0 })[k]++;
  };
  for (const rel of walk(root, SKIP_DIRS)) {
    const c = classOf(rel);
    if (!c) continue;
    const file = join(root, rel);
    const cls = c.kind === "stage" ? `f0/${c.stage}` : c.kind;
    tally(cls, "found");
    if (existsSync(lineagePath(file))) {
      tally(cls, "already");
      continue;
    }
    let stamp: LineageStamp;
    if (c.kind === "stage") {
      const e = stageExpect(c.stage, c.stage === "detect" ? armsOf(readJsonl<{ arm?: string }>(file)) : [], root);
      stamp = restampedStamp({ schema: e.schema!, models: e.models }, Object.keys(e.models!).length ? ["models"] : [], now);
    } else if (c.kind === "depth-stage" || c.kind === "faces") {
      stamp = restampedStamp({ schema: c.kind === "faces" ? FACES_SCHEMA : DEPTH_STAGE_SCHEMA, models: modelHashes(DEPTH_MODELS, root) }, ["models"], now);
    } else if (c.kind === "partition") {
      stamp = restampedStamp({ schema: PARTITION_SCHEMA, models: modelHashes(PARTITION_MODELS, root) }, ["models"], now);
    } else {
      const p = versionStampParts(root, join(root, rel, ".."));
      stamp = restampedStamp({ schema: { ...DATASET_SCHEMA, version: p.schemaVersion }, boxSet: p.boxSet, models: p.models, catalog: p.catalog }, p.assumed, now);
    }
    if (!opts.dryRun) writeLineage(file, stamp);
    tally(cls, "stamped");
  }
  counts.seconds = (Date.now() - t0) / 1000;
  return counts;
}

export async function lineageCommand(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { "dry-run": { type: "boolean" }, help: { type: "boolean", short: "h" } } });
  } catch (e) {
    console.error(`bookcase lineage: ${e instanceof Error ? e.message : e}\n\n${lineageUsage}`);
    return 1;
  }
  const [cmd, arg] = parsed.positionals;
  if (parsed.values.help || !cmd) {
    console.log(lineageUsage);
    return parsed.values.help ? 0 : 1;
  }
  try {
    if (cmd === "restamp") {
      const r = await restamp(undefined, { dryRun: parsed.values["dry-run"] });
      for (const [cls, c] of Object.entries(r.byClass).sort()) console.log(`${cls.padEnd(16)} found ${String(c.found).padStart(4)}  stamped ${String(c.stamped).padStart(4)}  already ${String(c.already).padStart(4)}`);
      console.log(`${parsed.values["dry-run"] ? "would stamp" : "stamped"} ${r.stamped} of ${r.found} files (${r.already} already stamped) in ${r.seconds.toFixed(1)} s`);
      return 0;
    }
    if (cmd === "show") {
      if (!arg) throw new Error("show needs a file");
      const s = readLineage(arg);
      if (!s) {
        console.error(`${relative(dataRoot(), arg)}: no lineage stamp`);
        return 1;
      }
      console.log(JSON.stringify(s, null, 1));
      return 0;
    }
  } catch (e) {
    console.error(`bookcase lineage ${cmd}: ${e instanceof Error ? e.message : e}`);
    return 1;
  }
  console.error(`bookcase lineage: unknown command "${cmd}"\n\n${lineageUsage}`);
  return 1;
}
