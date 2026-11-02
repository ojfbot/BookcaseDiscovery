// `bookcase profile check | build | review` (card R-1).
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { catalogPaths, openCatalog } from "../catalog/cli.ts";
import { dataRoot } from "../ledger/images.ts";
import { expandProfile } from "./expand.ts";
import type { Expansion } from "./expand.ts";
import { centreSeeds, checkProfileFile, loadProfile, publishProblems, readProfileFile, SEEDS_PATH } from "./profile.ts";
import { renderReviewSheet } from "./review.ts";
import { checkVocabulary, loadVocabulary } from "./vocabulary.ts";

const usage = `usage: bookcase profile <command>

  check   [--seeds <file>]                        validate profile/seeds.json (publishable) and the vocabulary
  build   [--seeds <file>] [--overlay <file>] [--catalog <file>] [--out <file>]
                                                  seeds + overlay, "read all" expanded against the catalog;
                                                  writes <data root>/private/profile.json
  review  (same options, --out defaults to <data root>/private/profile-review.html)
                                                  the short O-4 sheet for the owner

The overlay defaults to <data root>/private/profile-overlay.json and is optional. Everything written
goes under <data root>/private/, never into the repo.`;

function privatePaths(env: NodeJS.ProcessEnv = process.env) {
  const dir = join(dataRoot(env), "private");
  return { overlay: join(dir, "profile-overlay.json"), profile: join(dir, "profile.json"), review: join(dir, "profile-review.html") };
}

function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.partial`, text);
  renameSync(`${path}.partial`, path);
}

function resolve(values: { seeds?: string; overlay?: string; catalog?: string }): Expansion {
  const priv = privatePaths();
  const profile = loadProfile({ seeds: values.seeds ?? SEEDS_PATH, overlay: values.overlay ?? priv.overlay });
  const db = openCatalog(values.catalog ?? catalogPaths().catalog);
  try {
    return expandProfile(profile, db);
  } finally {
    db.close();
  }
}

function summarise({ profile, reports }: Expansion): string[] {
  const out = reports.map((r) =>
    r.skipped ? `${r.author}: not expanded (${r.skipped})` : r.found ? `${r.author}: ${r.novels.length} novels expanded, ${r.excluded.length} works not counted` : `${r.author}: not in the catalog`,
  );
  for (const r of profile.refused) out.push(`overlay ${r.where} "${r.id}" refused: ${r.reason}`);
  const seeds = centreSeeds(profile).map((s) => `${s.subject.name} ${s.relation} ${s.weight}`);
  out.push(`centre seeds: ${seeds.join(", ") || "none"}`);
  return out;
}

export function profileCommand(argv: string[]): number {
  const [cmd, ...rest] = argv;
  const options = { seeds: { type: "string" as const }, overlay: { type: "string" as const }, catalog: { type: "string" as const }, out: { type: "string" as const } };
  try {
    if (cmd === "check") {
      const { values } = parseArgs({ args: rest, options, strict: true });
      const seeds = readProfileFile(values.seeds ?? SEEDS_PATH);
      const vocabulary = loadVocabulary();
      const problems = [...publishProblems(seeds, { vocabulary }), ...checkVocabulary(vocabulary)];
      if (problems.length) {
        console.error(problems.map((p) => `  - ${p}`).join("\n"));
        return 1;
      }
      console.log(`ok: ${seeds.entries.length} seed entries, ${seeds.nodes.length} nodes, ${vocabulary.terms.length} vocabulary terms`);
      return 0;
    }
    if (cmd === "build" || cmd === "review") {
      const { values } = parseArgs({ args: rest, options, strict: true });
      const result = resolve(values);
      const bad = checkProfileFile({ schemaVersion: 1, entries: result.profile.entries, nodes: result.profile.nodes });
      if (bad.length) throw new Error(bad.join("; "));
      const priv = privatePaths();
      const out = values.out ?? (cmd === "build" ? priv.profile : priv.review);
      writeAtomic(out, cmd === "build" ? `${JSON.stringify(result.profile, null, 2)}\n` : renderReviewSheet(result.profile, result.reports));
      for (const line of summarise(result)) console.log(line);
      console.log(`wrote ${out}`);
      return 0;
    }
  } catch (err) {
    console.error(`bookcase profile ${cmd}: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  console.log(usage);
  return cmd === undefined || cmd === "--help" || cmd === "-h" ? 0 : 1;
}
