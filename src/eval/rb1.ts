// RB-1 · batched re-baseline: the box set every downstream card re-runs on once (evals/RB1/report.md).
//
// The box set is F-0i's partition (#51) of the shipped default boxes after F-0c's and F-0f's not-a-book kinds, less
// the boxes NB-3's shipped cause (`on-lip`, #61) adds to not-a-book. Box ids and detection rectangles never change
// (F-0i's refit crop did not ship); a kept box F-0i changed carries its exclusive outline. Pure, plus one loader.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { dataRoot } from "../ledger/images.ts";
import { checkLineage } from "../ledger/lineage.ts";
import { modelHashes } from "../ledger/models.ts";
import { readJsonl } from "./f0.ts";
import { PARTITION_MODELS, PARTITION_SCHEMA } from "./lineage-classes.ts";
import { NB3_SHIP, type NB3Why } from "./nb3.ts";
import { acceptSet, setPaths } from "./set-paths.ts";

/** The sets RB-1's own summary re-ran. `loadBoxSet` takes any declared session too (NS-K2, src/eval/set-paths.ts). */
export type RB1Set = "pilot-000" | "yardstick";
/** Why RB-1's box set leaves a box out that the pre-RB-1 inputs kept. */
export type RB1Drop = "f0i-dropped" | NB3Why;

export interface PartitionRow {
  id: string;
  state: "kept" | "dropped";
  reason: string | null;
  changed: boolean;
  outline: [number, number][];
}
export interface Nb3Flag {
  id: string;
  causes: NB3Why[];
}

/**
 * Boxes RB-1 leaves out, with why: every box the partition drops, then every kept box whose first NB-3 cause is one
 * `NB3_SHIP` turns on. A box the partition never saw (not-a-book before F-0i) is not listed: the old filter keeps it out.
 */
export function boxSetDrops(partition: PartitionRow[], flags: Nb3Flag[]): Map<string, RB1Drop> {
  const out = new Map<string, RB1Drop>();
  for (const p of partition) if (p.state === "dropped") out.set(p.id, "f0i-dropped");
  const kept = new Set(partition.filter((p) => p.state === "kept").map((p) => p.id));
  for (const f of flags) {
    const first = f.causes[0];
    if (first && NB3_SHIP[first] && kept.has(f.id)) out.set(f.id, first);
  }
  return out;
}

export interface BoxSet {
  /** `<imageId>:<i>` → why RB-1 leaves it out. */
  drops: Map<string, RB1Drop>;
  /** Every partition row by box id (kept and dropped). */
  rows: Map<string, PartitionRow>;
  /** Is this box in RB-1's box set, given the old filter already kept it? */
  keeps: (id: string) => boolean;
}

/** RB-1's box set for one set (a declared session or `yardstick`), from F-0i's `partition.jsonl` and NB-3's `flags.jsonl` under the data root's `private/`. */
export function loadBoxSet(set: string, root = dataRoot()): BoxSet {
  // F-0i names the yardstick by its B2 run; NB-3 calls it `yardstick` (both in set-paths).
  const paths = setPaths(acceptSet("RB-1", set), root);
  const part = join(paths.f0i, "partition.jsonl");
  const flags = join(paths.nb3, "flags.jsonl");
  if (!existsSync(part)) throw new Error(`${set}: no F-0i partition at the data root's private/f0i/`);
  if (!existsSync(flags)) throw new Error(`${set}: no NB-3 flags at the data root's private/nb3/ (run nb3-cli.ts flags ${set})`);
  // DL-3: the partition must name the weights the models manifest names now.
  checkLineage(part, { schema: PARTITION_SCHEMA, models: modelHashes(PARTITION_MODELS, root) });
  const rows = readJsonl<PartitionRow>(part);
  const drops = boxSetDrops(rows, readJsonl<Nb3Flag>(flags));
  return { drops, rows: new Map(rows.map((r) => [r.id, r])), keeps: (id) => !drops.has(id) };
}

/** `--box-set pre-rb1` reproduces a card's figures as first published; the default is RB-1's box set. */
export const preRb1 = (): boolean => process.argv.includes("--box-set") && process.argv[process.argv.indexOf("--box-set") + 1] === "pre-rb1";

/**
 * Each `pilot-000` box's own outline, as U-4, Q-2b's U-4 aggregates and S-1 read it: on RB-1's box set, F-0i's
 * exclusive outline of every kept box (it supersedes Q-2b's SAM 2.1 outline); before, Q-2b's SAM 2.1 outline.
 */
export function pilotOutlines(root = dataRoot()): { id: string; outline?: [number, number][]; seconds?: number; error?: string }[] {
  if (preRb1()) return readJsonl(join(root, "private", "q2b", "outlines", "pilot-000.jsonl"));
  const box = loadBoxSet("pilot-000", root);
  return [...box.rows.values()].filter((r) => box.keeps(r.id) && r.state === "kept").map((r) => ({ id: r.id, outline: r.outline }));
}
