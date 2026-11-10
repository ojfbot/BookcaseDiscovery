// `run` module: the CLI router behind `bin/bookcase`.
import { backupCommand } from "./backup-cli.ts";
import { catalogCommand } from "../catalog/cli.ts";
import { datasetCommand } from "./dataset-cli.ts";
import { ingestCommand, manifestCommand } from "../capture/cli.ts";
import { profileCommand } from "../recommend/cli.ts";
import { reportCommand } from "../report/cli.ts";
import { fleetCommand } from "./fleet-cli.ts";
import { jobsCommand } from "./jobs-cli.ts";
import { lineageCommand } from "./lineage-cli.ts";
import { modelsCommand } from "./models-cli.ts";
import { replayCommand } from "./replay.ts";

export const moduleName = "run";

export const commands = ["ingest", "perceive", "identify", "recommend", "replay", "report", "manifest", "eval", "catalog", "profile", "jobs", "dataset", "models", "lineage", "backup", "fleet"] as const;
export type Command = (typeof commands)[number];

const usage = `usage: bookcase <command> [args]

commands:
  ${commands.join("\n  ")}

Commands are implemented as their cards land (docs/plan/DELIVERY-PLAN.md §3).`;

export function main(argv: string[]): number | Promise<number> {
  const [cmd] = argv;
  if (!cmd || cmd === "--help" || cmd === "-h") {
    console.log(usage);
    return 0;
  }
  if (cmd === "ingest") return ingestCommand(argv.slice(1));
  if (cmd === "catalog" && argv[1] === "coverage") {
    // C-4's evaluation runner lives in src/eval/ (DL-4b); the catalog module never imports it.
    return import("../eval/coverage-cli.ts")
      .then((m) => m.coverageCommand(argv.slice(2), process.env))
      .catch((e: unknown) => {
        console.error(`bookcase catalog coverage: ${(e as Error).message}`);
        return 1;
      });
  }
  if (cmd === "catalog") return catalogCommand(argv.slice(1));
  if (cmd === "profile") return profileCommand(argv.slice(1));
  if (cmd === "replay") return replayCommand(argv.slice(1));
  if (cmd === "manifest") return manifestCommand(argv.slice(1));
  if (cmd === "report") return reportCommand(argv.slice(1));
  if (cmd === "fleet") return fleetCommand(argv.slice(1));
  if (cmd === "jobs") return jobsCommand(argv.slice(1));
  if (cmd === "dataset") return datasetCommand(argv.slice(1));
  if (cmd === "models") return modelsCommand(argv.slice(1));
  if (cmd === "lineage") return lineageCommand(argv.slice(1));
  if (cmd === "backup") return backupCommand(argv.slice(1));
  if ((commands as readonly string[]).includes(cmd)) {
    console.error(`bookcase ${cmd}: not implemented yet`);
    return 2;
  }
  console.error(`bookcase: unknown command "${cmd}"\n\n${usage}`);
  return 1;
}
