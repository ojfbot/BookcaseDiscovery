// Replay (INV-14): rebuild the views from the event log into a fresh database and diff them against
// the source's. Events are appended through the same `append`, so the rebuild is checked by the same
// contracts and status machine as the original run.
import { existsSync } from "node:fs";
import type { NewEvent } from "./contracts.ts";
import { SqliteLedger } from "./sqlite.ts";

export interface ReplayResult {
  /** Events replayed. */
  events: number;
  /** True when the event lists and every view are equal. */
  identical: boolean;
  /** One line per difference, at most `MAX_DIFFERENCES`. */
  differences: string[];
}

const MAX_DIFFERENCES = 50;

/** Deep, path-wise differences between two plain values; empty when equal. */
export function diffValues(a: unknown, b: unknown, path = "$", out: string[] = []): string[] {
  if (out.length >= MAX_DIFFERENCES) return out;
  if (Object.is(a, b)) return out;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${path}: length ${a.length} != ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) diffValues(a[i], b[i], `${path}[${i}]`, out);
  } else if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of [...keys].sort()) {
      const x = (a as Record<string, unknown>)[k];
      const y = (b as Record<string, unknown>)[k];
      if (x === undefined && y !== undefined) out.push(`${path}.${k}: missing != ${JSON.stringify(y)}`);
      else if (y === undefined && x !== undefined) out.push(`${path}.${k}: ${JSON.stringify(x)} != missing`);
      else diffValues(x, y, `${path}.${k}`, out);
    }
  } else {
    out.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
  return out;
}

/**
 * Replay the ledger at `sourcePath` into a new database at `targetPath`, which must not exist.
 * Never writes to the source.
 */
export function replay(sourcePath: string, targetPath: string): ReplayResult {
  if (!existsSync(sourcePath)) throw new Error(`replay: no such database: ${sourcePath}`);
  if (existsSync(targetPath)) throw new Error(`replay: ${targetPath} exists; --to wants a fresh database`);
  const source = new SqliteLedger(sourcePath, { readOnly: true });
  let target: SqliteLedger | undefined;
  try {
    target = new SqliteLedger(targetPath);
    let count = 0;
    for (const { seq, ...event } of source.events()) {
      count++;
      if (seq !== count) return { events: count - 1, identical: false, differences: [`event ${count}: source seq jumps to ${seq}`] };
      try {
        target.append(event as NewEvent);
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error);
        return { events: count - 1, identical: false, differences: [`event ${seq} (${event.type}) refused on replay: ${why}`] };
      }
    }
    const differences = [
      ...diffValues([...source.events()], [...target.events()], "events"),
      ...diffValues(source.viewDump(), target.viewDump(), "views"),
    ].slice(0, MAX_DIFFERENCES);
    return { events: count, identical: differences.length === 0, differences };
  } finally {
    target?.close();
    source.close();
  }
}
