// `bookcase replay <db> --to <fresh db>`: rebuild the views from the event log and diff them (L-2, INV-14).
import { replay } from "../ledger/replay.ts";

const usage = "usage: bookcase replay <db> --to <fresh db>\n\nRebuilds the views of <db> from its events into <fresh db> (which must not exist) and diffs them.\nExit 0 when identical, 1 when they differ, 2 on a usage error or an unreadable database.";

export function replayCommand(args: string[]): number {
  const to = args.indexOf("--to");
  const rest = args.filter((_, i) => i !== to && i !== to + 1);
  if (to < 0 || !args[to + 1] || rest.length !== 1 || rest[0]!.startsWith("-")) {
    console.error(usage);
    return 2;
  }
  try {
    const result = replay(rest[0]!, args[to + 1]!);
    if (result.identical) {
      console.log(`replayed ${result.events} events into ${args[to + 1]}: views identical`);
      return 0;
    }
    console.error(`replayed ${result.events} events into ${args[to + 1]}: views DIFFER`);
    for (const d of result.differences) console.error(`  ${d}`);
    return 1;
  } catch (error) {
    console.error(`bookcase replay: ${error instanceof Error ? error.message : error}`);
    return 2;
  }
}
