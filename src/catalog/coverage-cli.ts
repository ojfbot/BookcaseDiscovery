// `bookcase catalog coverage` (card C-4): catalog gap on a machine-labelled session.
//
//   bookcase catalog coverage --tune                 the confirmed tuning rows only (thresholds may be tuned here)
//   bookcase catalog coverage [--run-id C4]          the pre-registered sample; --run-id writes evals/<id>/metrics.json
//   options: --session <name> (default pilot-000), --offline (cache only: a rerun makes no calls), --db <file>
//
// Inputs are F-0's cached stages under the data root (`f0/<session>/`). Live responses are cached under the
// data root's `catalog/coverage/`; the per-box table (reader text, queries, records) goes to its
// `private/c4/`. Only counts and shares are printed or written to the repo.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { dataRoot } from "../ledger/images.ts";
import { loadReadings, readJsonl, stageDir, type SpineDecision } from "../eval/f0.ts";
import { catalogPaths, openCatalog } from "./cli.ts";
import {
  BOOTSTRAP_REPS,
  drawSample,
  estimateCoverage,
  LIMITS,
  LiveCache,
  RESOLVE,
  resolveBox,
  SAMPLE,
  SEED,
  SPACING_MS,
  STRATA,
  TUNING_CONFIRMED,
  type BoxClass,
  type BoxResult,
} from "./coverage.ts";

const usage = `usage: bookcase catalog coverage [--tune] [--session <name>] [--offline] [--db <file>] [--run-id <id>]`;

function gitCommit(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function classCounts(rs: BoxResult[]): Record<BoxClass, number> {
  const c: Record<BoxClass, number> = { "in-isfdb": 0, "not-in-isfdb": 0, unresolved: 0 };
  for (const r of rs) c[r.cls]++;
  return c;
}

/** The confirmed rows as a resolver check: how many resolve, and to the work F-0 accepted. */
function sanity(rs: BoxResult[]) {
  const c = rs.filter((r) => r.stratum === "confirmed");
  return {
    n: c.length,
    resolved: c.filter((r) => r.cls !== "unresolved").length,
    inIsfdb: c.filter((r) => r.cls === "in-isfdb").length,
    sameWorkAsF0: c.filter((r) => r.agreesWithF0 === true).length,
    otherIsfdbWork: c.filter((r) => r.agreesWithF0 === false).length,
    notInIsfdb: c.filter((r) => r.cls === "not-in-isfdb").length,
    resolvedBy: { openlibrary: c.filter((r) => r.resolvedBy === "openlibrary").length, loc: c.filter((r) => r.resolvedBy === "loc").length },
    isfdbBy: { isbn: c.filter((r) => r.isfdb?.how === "isbn").length, titleAuthor: c.filter((r) => r.isfdb?.how === "title-author").length },
  };
}

export async function coverageCommand(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { tune: { type: "boolean" }, session: { type: "string" }, offline: { type: "boolean" }, db: { type: "string" }, "run-id": { type: "string" }, help: { type: "boolean", short: "h" } },
  });
  if (values.help) {
    console.log(usage);
    return 0;
  }
  const session = values.session ?? "pilot-000";
  const root = dataRoot(env);
  const dir = stageDir(root, session);
  const decisions = readJsonl<SpineDecision>(join(dir, "decisions.jsonl"));
  if (decisions.length === 0) throw new Error(`no F-0 decisions for ${session}; run \`pnpm f0 pilot\` first`);
  const readings = loadReadings(dir);
  const { boxes, population } = drawSample(decisions);
  const role = values.tune ? "tuning" : "sample";
  const todo = boxes.filter((b) => b.role === role);
  const f0Work = new Map(decisions.map((d) => [d.id, d.accepted?.workId ?? null]));
  const live = new LiveCache(join(root, "catalog", "coverage"), { offline: values.offline });
  const db = openCatalog(values.db ?? catalogPaths(env).catalog);
  const log = (s: string) => process.stderr.write(`coverage: ${s}\n`);
  const results: BoxResult[] = [];
  const t0 = performance.now();
  try {
    for (const box of todo) {
      results.push(await resolveBox(db, live, box, readings.get(box.id) ?? {}, f0Work.get(box.id) ?? null));
      if (results.length % 10 === 0 || results.length === todo.length) {
        const c = classCounts(results);
        log(`${results.length}/${todo.length} boxes; in ${c["in-isfdb"]}, not-in ${c["not-in-isfdb"]}, unresolved ${c.unresolved}; calls OL ${live.calls.openlibrary} LoC ${live.calls.loc}`);
      }
    }
  } finally {
    db.close();
  }
  const priv = join(root, "private", "c4");
  mkdirSync(priv, { recursive: true });
  writeFileSync(join(priv, `${session}.${role}.jsonl`), results.map((r) => JSON.stringify(r)).join("\n") + "\n");

  const noText = decisions.filter((d) => d.reason === "no-text").length;
  const network = { calls: live.calls, cacheHits: live.hits, failedQueries: live.errors, seconds: Math.round((performance.now() - t0) / 1000) };
  if (role === "tuning") {
    console.log(JSON.stringify({ session, role, sanity: sanity(results), network }, null, 2));
    return 0;
  }
  const estimate = estimateCoverage(results, population);
  const metrics = {
    runId: values["run-id"] ?? "C4-adhoc",
    card: "C-4",
    date: new Date().toISOString().slice(0, 10),
    code: gitCommit(),
    session,
    population: { ...population, "no-text": noText, total: decisions.length },
    design: { seed: SEED, sample: SAMPLE, tuningConfirmed: TUNING_CONFIRMED, bootstrapReps: BOOTSTRAP_REPS, resolve: RESOLVE, limits: LIMITS, spacingMs: SPACING_MS },
    estimate,
    confirmedSanity: sanity(results),
    queries: {
      perBoxMean: Math.round((results.reduce((a, r) => a + r.queries.length, 0) / results.length) * 100) / 100,
      boxesByStratum: Object.fromEntries(STRATA.map((s) => [s, results.filter((r) => r.stratum === s).length])),
    },
    resolvedBy: { openlibrary: results.filter((r) => r.resolvedBy === "openlibrary").length, loc: results.filter((r) => r.resolvedBy === "loc").length },
    isfdbBy: { isbn: results.filter((r) => r.isfdb?.how === "isbn").length, titleAuthor: results.filter((r) => r.isfdb?.how === "title-author").length },
    network,
    spendUsd: 0,
  };
  console.log(JSON.stringify(metrics, null, 2));
  if (values["run-id"]) {
    const out = join("evals", values["run-id"]);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
    log(`wrote ${out}/metrics.json`);
  }
  return 0;
}
