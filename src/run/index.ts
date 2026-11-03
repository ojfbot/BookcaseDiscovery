// `run` module: the CLI router behind `bin/bookcase`. Commands are stubs until their cards land.
import { catalogCommand } from "../catalog/cli.ts";
import { ingestCommand, manifestCommand } from "../capture/cli.ts";
import { profileCommand } from "../recommend/cli.ts";
import { reportCommand } from "../report/cli.ts";
import { jobsCommand } from "./jobs-cli.ts";
import { replayCommand } from "./replay.ts";

export const moduleName = "run";

export const commands = ["ingest", "perceive", "identify", "recommend", "replay", "report", "manifest", "eval", "catalog", "profile", "jobs"] as const;
export type Command = (typeof commands)[number];

const usage = `usage: bookcase <command> [args]

commands:
  ${commands.join("\n  ")}

Every command is a stub until its card lands (docs/plan/DELIVERY-PLAN.md §3).`;

export function main(argv: string[]): number | Promise<number> {
  const [cmd] = argv;
  if (!cmd || cmd === "--help" || cmd === "-h") {
    console.log(usage);
    return 0;
  }
  if (cmd === "ingest") return ingestCommand(argv.slice(1));
  if (cmd === "catalog") return catalogCommand(argv.slice(1));
  if (cmd === "profile") return profileCommand(argv.slice(1));
  if (cmd === "replay") return replayCommand(argv.slice(1));
  if (cmd === "manifest") return manifestCommand(argv.slice(1));
  if (cmd === "report") return reportCommand(argv.slice(1));
  if (cmd === "jobs") return jobsCommand(argv.slice(1));
  if ((commands as readonly string[]).includes(cmd)) {
    console.error(`bookcase ${cmd}: not implemented yet`);
    return 2;
  }
  console.error(`bookcase: unknown command "${cmd}"\n\n${usage}`);
  return 1;
}
