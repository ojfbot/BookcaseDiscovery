// `pnpm labels:import <export.json> --session <id>`: Label Studio JSON export -> $BOOKCASE_DATA/labels/<session>.json
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { LabelSet, labelsDir } from "./labels.ts";
import { fromLabelStudio } from "./labelstudio.ts";
import type { LsTask } from "./labelstudio.ts";

const usage = "usage: pnpm labels:import <label-studio-export.json> --session <id>";

export function main(argv: string[], env: NodeJS.ProcessEnv = process.env): number {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { session: { type: "string" } } });
  const [exportPath] = positionals;
  if (!exportPath || !values.session) {
    console.error(usage);
    return 1;
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(values.session)) {
    console.error(`labels:import: session "${values.session}" must be lowercase letters, digits, dot, dash or underscore`);
    return 1;
  }
  const tasks = JSON.parse(readFileSync(exportPath, "utf8")) as LsTask[];
  if (!Array.isArray(tasks)) {
    console.error("labels:import: expected a Label Studio JSON export (an array of tasks)");
    return 1;
  }

  const dir = labelsDir(env);
  const target = `${dir}/${values.session}.json`;
  const existing = existsSync(target) ? LabelSet.parse(JSON.parse(readFileSync(target, "utf8"))) : undefined;
  const { labels, warnings } = fromLabelStudio(values.session, tasks, existing);

  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (existing) writeFileSync(`${target}.bak`, readFileSync(target)); // one rolling backup
  writeFileSync(`${target}.tmp`, JSON.stringify(labels, null, 2) + "\n", { mode: 0o600 });
  renameSync(`${target}.tmp`, target);

  for (const w of warnings) console.error(`warning: ${w}`);
  const spines = labels.photos.reduce((n, p) => n + p.spines.length, 0);
  console.log(`wrote ${labels.photos.length} photo(s), ${spines} spine(s) to ${target}`);
  return 0;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
