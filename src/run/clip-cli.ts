// `bookcase clip ingest <folder> --session <name> [--permission-note <text>]`
// `bookcase clip frames <session> [--rate 1] [--ledger <db>]`
// `bookcase clip report <session>`
// The CLI sits in src/run/ because it checks the set role (src/eval/set-roles.ts), which src/capture/ may not import (DL-4).
import { parseArgs } from "node:util";
import { ImageStore, SqliteLedger, dataRoot } from "../ledger/index.ts";
import { assertManifestable } from "../eval/set-roles.ts";
import { clipFrames, clipIngest, sessionCounts } from "../capture/clip.ts";
import { sessionLedgerPath } from "../capture/cli.ts";

export const clipUsage = `usage: bookcase clip <ingest|frames|report> ...

  bookcase clip ingest <folder> --session <name> [--permission-note <text>]
      Per clip in <folder> (read only): hash the original, write an audio-free copy (no re-encode) to
      $BOOKCASE_DATA/video/sha256/<aa>/<hash>.mov and add a row to the private clip manifest
      (<data root>/private/fixtures/<session>/clips.json). A clip already ingested is skipped.
      --permission-note   the store-permission note kept on each new row (private manifest only)

  bookcase clip frames <session> [--rate 1] [--ledger <db>]
      Per audio-free clip not yet done: the sharpest frame in each 1/rate s window, entered into the image store
      through ingest's frame mode (setting real-use), with the lineage in .../<session>/frames.json.
      --ledger   the session's SQLite ledger (default: $BOOKCASE_DATA/ledger/<session>.sqlite)

  bookcase clip report <session>
      Counts only: clips, durations, tracks before and after, frames, sharpness, storage.

The session must be declared in src/eval/set-roles.ts as a training source or held out (fail closed).`;

const fail = (msg: string): number => {
  console.error(`bookcase clip: ${msg}`);
  return 1;
};

const mib = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

export function clipCommand(argv: string[], env: NodeJS.ProcessEnv = process.env): number {
  const [sub, ...rest] = argv;
  if (!sub || sub === "--help" || sub === "-h") {
    console.log(clipUsage);
    return sub ? 0 : 1;
  }
  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      options: { session: { type: "string" }, "permission-note": { type: "string" }, rate: { type: "string" }, ledger: { type: "string" }, help: { type: "boolean", short: "h" } },
    });
  } catch (e) {
    return fail(`${e instanceof Error ? e.message : e}\n\n${clipUsage}`);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    console.log(clipUsage);
    return 0;
  }
  const dataDir = dataRoot(env);
  try {
    if (sub === "ingest") {
      if (positionals.length !== 1 || !values.session) return fail(clipUsage);
      assertManifestable(values.session, "NS-K");
      const result = clipIngest({ folder: positionals[0]!, session: values.session, dataDir, permission: values["permission-note"] });
      const by = (v: string) => result.outcomes.filter((o) => o.verdict === v).length;
      const reasons = [...new Set(result.outcomes.flatMap((o) => o.reasons))];
      console.log(`session ${values.session}: ${by("stored")} clip(s) stored audio-free, ${by("skipped")} already ingested, ${by("refused")} refused${reasons.length ? ` (${reasons.join(", ")})` : ""}`);
      console.log(`clip manifest: ${result.manifest.clips.length} clip(s), ${result.manifest.refused.length} refused`);
      return 0;
    }
    if (sub === "frames") {
      if (positionals.length !== 1) return fail(clipUsage);
      const session = positionals[0]!;
      assertManifestable(session, "NS-K");
      const rate = values.rate === undefined ? 1 : Number(values.rate);
      if (!(rate > 0 && Number.isFinite(rate))) return fail("--rate must be a positive number");
      const ledger = new SqliteLedger(values.ledger ?? sessionLedgerPath(dataDir, session));
      try {
        const r = clipFrames({ session, dataDir, ledger, rate });
        console.log(`session ${session}: ${r.clipsDone} clip(s) framed, ${r.clipsSkipped} already done, ${r.framesKept} frame(s) kept, ${r.ingest?.outcomes.length ?? 0} entered into the image store`);
      } finally {
        ledger.close();
      }
      return 0;
    }
    if (sub === "report") {
      if (positionals.length !== 1) return fail(clipUsage);
      const store = new ImageStore(dataDir);
      const c = sessionCounts(dataDir, positionals[0]!, (h) => store.find(h));
      console.log(JSON.stringify({ ...c, storage: { originals: mib(c.originalBytes), audioFreeClips: mib(c.clipBytes), frames: mib(c.frameBytes) } }, null, 2));
      return 0;
    }
    return fail(`unknown subcommand "${sub}"\n\n${clipUsage}`);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}
