// `bookcase dataset <build|report>`: F-1's dataset manifest and grouped splits, with TS-0's label ledger
// (docs/dataset.md). Everything built is private, under $BOOKCASE_DATA/datasets/; only `report`'s aggregates reach
// the repo.
import { parseArgs } from "node:util";

export const datasetUsage = `usage: bookcase dataset <command> [options]

commands:
  build     the label ledger: manifest, grouped splits and one row per machine label, as a new version under
            $BOOKCASE_DATA/datasets/label-ledger/<version>/ (the version is a hash of the box set and model revision)
  report    evals/TS0/{metrics.json,report.md} from the latest version: counts by class, basis, rung and split

options:
  --set <name>       build: a set to export (repeatable; default pilot-000). Yardstick and audit sets are refused.
  --version <v>      report: a version other than the latest

Run build again after any box-set or model change: a new version is written beside the old ones.`;

export async function datasetCommand(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { set: { type: "string", multiple: true }, version: { type: "string" }, help: { type: "boolean", short: "h" } } });
  } catch (e) {
    console.error(`bookcase dataset: ${e instanceof Error ? e.message : e}\n\n${datasetUsage}`);
    return 1;
  }
  const { values, positionals } = parsed;
  const [cmd] = positionals;
  if (values.help || !cmd) {
    console.log(datasetUsage);
    return values.help ? 0 : 1;
  }
  try {
    // Loaded on demand: the runner pulls in the catalog and every experiment's loaders.
    const ts0 = await import("../eval/ts0-cli.ts");
    if (cmd === "build") {
      const r = ts0.build(values.set?.length ? values.set : undefined);
      console.log(`${r.version}: ${r.labels} labels on ${r.photos} photos`);
      return 0;
    }
    if (cmd === "report") {
      console.log(`evals/TS0 written for ${ts0.report(undefined, values.version)}`);
      return 0;
    }
  } catch (e) {
    console.error(`bookcase dataset ${cmd}: ${e instanceof Error ? e.message : e}`);
    return 1;
  }
  console.error(`bookcase dataset: unknown command "${cmd}"\n\n${datasetUsage}`);
  return 1;
}
