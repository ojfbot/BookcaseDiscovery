// `bookcase catalog coverage` (card C-4): catalog gap on a machine-labelled session.
//
//   bookcase catalog coverage --tune                 the confirmed tuning rows only (thresholds may be tuned here)
//   bookcase catalog coverage [--run-id C4]          the pre-registered sample; --run-id writes evals/<id>/metrics.json
//   bookcase catalog coverage --plan [--all]         no network: how many live calls the run would make (C-10)
//   options: --session <name> (default pilot-000), --offline (cache only: a rerun makes no calls), --db <file>,
//            --budget <n> (live requests this run may make, default LOOKUP.defaultBudget), --no-local (skip the
//            local catalog tier), --all (with --plan: every box with text, not only the sample)
//
// When Q-2's private teacher table exists (`private/q2/table/<session>.jsonl`), the sampled
// `no-catalog-match` rows are also split by its rung (post hoc, not part of the pre-registered design).
//
// Inputs are F-0's cached stages under the data root (`f0/<session>/`) and F-0g's copy groups
// (`private/f0g/<session>/copies.jsonl`, when present). Live responses go through C-10's lookup cache
// (`catalog/coverage/v2/`, migrated from C-4's `catalog/coverage/` on first use); boxes try the cache, then
// records known for their copy group or work, then the local catalogs (`--db` and `catalog-v2.sqlite`), before
// any live call. The per-box table (reader text, queries, records) goes to `private/c4/` for `--run-id C4` and
// to `private/coverage/<run id>/` otherwise. Only counts and shares are printed or written to the repo.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { dataRoot } from "../ledger/images.ts";
import { loadReadings, readJsonl, stageDir, type SpineDecision } from "../eval/f0.ts";
import { catalogPaths, openCatalog } from "./cli.ts";
import {
  BOOTSTRAP_REPS,
  drawSample,
  estimateCoverage,
  LIMITS,
  openLookup,
  readerTexts,
  RESOLVE,
  resolveBox,
  rungSplit,
  SAMPLE,
  SEED,
  SPACING_MS,
  STRATA,
  stratumOf,
  TUNING_CONFIRMED,
  type BoxClass,
  type BoxResult,
  type OutsideRecord,
  type SampledBox,
} from "./coverage.ts";
import { copyKey, KnownIndex, LOOKUP } from "./lookup.ts";
import { localTier } from "./lookup-local.ts";
import { outcomeOf, planC4, planSummary, type Outcome } from "./lookup-plan.ts";

const usage = `usage: bookcase catalog coverage [--tune] [--plan [--all]] [--session <name>] [--offline] [--budget <n>] [--no-local] [--db <file>] [--run-id <id>]`;

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
    resolvedBy: resolvedBy(c),
    isfdbBy: isfdbBy(c),
  };
}

const resolvedBy = (rs: BoxResult[]) => ({ openlibrary: rs.filter((r) => r.resolvedBy === "openlibrary").length, loc: rs.filter((r) => r.resolvedBy === "loc").length, isfdb: rs.filter((r) => r.resolvedBy === "isfdb").length });
const isfdbBy = (rs: BoxResult[]) => ({ isbn: rs.filter((r) => r.isfdb?.how === "isbn").length, titleAuthor: rs.filter((r) => r.isfdb?.how === "title-author").length, local: rs.filter((r) => r.isfdb?.how === "local").length });

/** F-0g's copy groups of a session as each member's `copyKey`. Empty when F-0g has not run on it. */
function copyGroups(root: string, session: string): Map<string, string> {
  const rows = readJsonl<{ id: string; group: number }>(join(root, "private", "f0g", session, "copies.jsonl"));
  const members = new Map<number, string[]>();
  for (const r of rows) members.set(r.group, [...(members.get(r.group) ?? []), r.id]);
  const out = new Map<string, string>();
  for (const ids of members.values()) for (const id of ids) out.set(id, copyKey(ids));
  return out;
}

const outcomes = (rs: BoxResult[]) => {
  const out: Partial<Record<Outcome, number>> = {};
  for (const r of rs) out[outcomeOf(r)] = (out[outcomeOf(r)] ?? 0) + 1;
  return out;
};

export async function coverageCommand(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      tune: { type: "boolean" },
      plan: { type: "boolean" },
      all: { type: "boolean" },
      session: { type: "string" },
      offline: { type: "boolean" },
      budget: { type: "string" },
      "no-local": { type: "boolean" },
      db: { type: "string" },
      "run-id": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
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
  if (values.all && !values.plan) throw new Error("--all plans every box with text; it needs --plan (estimates are weighted to the sample)");
  const budget = values.budget === undefined ? LOOKUP.defaultBudget : Number(values.budget);
  if (!Number.isInteger(budget) || budget < 0) throw new Error(`--budget must be a whole number of live requests, got ${values.budget}`);
  const { boxes, population } = drawSample(decisions);
  const role = values.tune ? "tuning" : "sample";
  const todo: SampledBox[] = values.all
    ? decisions.flatMap((d) => (stratumOf(d) ? [{ id: d.id, stratum: stratumOf(d)!, role: "sample" as const }] : []))
    : boxes.filter((b) => b.role === role);
  const f0Work = new Map(decisions.map((d) => [d.id, d.accepted?.workId ?? null]));
  const coverageDir = join(root, "catalog", "coverage");
  const cache = openLookup(coverageDir, { offline: values.offline, budget, plan: values.plan });
  const log = (s: string) => process.stderr.write(`coverage: ${s}\n`);
  if (cache.migration) log(`migrated C-4's cache to schema ${LOOKUP.schema}: ${JSON.stringify(cache.migration)}`);
  const copies = copyGroups(root, session);
  const known = new KnownIndex<OutsideRecord>(join(cache.dir, "known.json"));
  const db = openCatalog(values.db ?? catalogPaths(env).catalog);
  const v2Path = catalogPaths(env).catalogV2;
  const v2 = values["no-local"] || !existsSync(v2Path) ? null : new DatabaseSync(v2Path, { readOnly: true });
  const local = values["no-local"] ? null : localTier(db, v2);
  const results: BoxResult[] = [];
  const t0 = performance.now();
  try {
    for (const box of todo) {
      results.push(await resolveBox(db, cache, box, readings.get(box.id) ?? {}, f0Work.get(box.id) ?? null, { local, known, copy: copies.get(box.id) ?? null }));
      if (results.length % 10 === 0 || results.length === todo.length) {
        const c = classCounts(results);
        log(`${results.length}/${todo.length} boxes; in ${c["in-isfdb"]}, not-in ${c["not-in-isfdb"]}, unresolved ${c.unresolved}; calls OL ${cache.calls.openlibrary} LoC ${cache.calls.loc}`);
      }
    }
  } finally {
    db.close();
    v2?.close();
  }
  if (values.plan) {
    const plan = {
      session,
      boxes: values.all ? "every box with text" : role,
      photos: new Set(decisions.filter((d) => todo.some((b) => b.id === d.id)).map((d) => d.imageId)).size,
      local: local ? (v2 ? "isfdb+openlibrary" : "isfdb") : "off",
      c10: planSummary(results, cache),
      c4: planC4(todo.map((b) => readerTexts(readings.get(b.id) ?? {})), coverageDir),
    };
    console.log(JSON.stringify(plan, null, 2));
    return 0;
  }
  known.save();
  const priv = values["run-id"] === "C4" ? join(root, "private", "c4") : join(root, "private", "coverage", values["run-id"] ?? "adhoc");
  mkdirSync(priv, { recursive: true });
  writeFileSync(join(priv, `${session}.${role}.jsonl`), results.map((r) => JSON.stringify(r)).join("\n") + "\n");

  const noText = decisions.filter((d) => d.reason === "no-text").length;
  const network = { calls: cache.calls, cacheHits: cache.hits, failedQueries: cache.errors, seconds: Math.round((performance.now() - t0) / 1000) };
  const used = cache.calls.openlibrary + cache.calls.loc;
  const lookup = {
    schema: LOOKUP.schema,
    local: local ? (v2 ? "isfdb+openlibrary" : "isfdb") : "off",
    outcomes: outcomes(results),
    keys: cache.summary(),
    budget: { limit: values.offline ? 0 : budget, used, incompleteBoxes: results.filter((r) => r.skipped === "budget").length },
    knownSkipped: results.filter((r) => r.skipped === "known").length,
    complete: results.every((r) => r.skipped !== "budget"),
    migration: cache.migration,
  };
  if (!lookup.complete) log(`budget spent: ${lookup.budget.incompleteBoxes} boxes are incomplete; rerun to continue`);
  if (role === "tuning") {
    console.log(JSON.stringify({ session, role, sanity: sanity(results), network, lookup }, null, 2));
    return 0;
  }
  const estimate = estimateCoverage(results, population);
  const q2Path = join(root, "private", "q2", "table", `${session}.jsonl`);
  let q2Rung: ReturnType<typeof rungSplit> | null = null;
  if (existsSync(q2Path)) {
    const rungOf = new Map(readJsonl<{ imageId: string; index: number; rung: string }>(q2Path).map((r) => [`${r.imageId}:${r.index}`, r.rung]));
    const rungPopulation: Record<string, number> = {};
    for (const d of decisions) if (d.reason === "no-catalog-match") rungPopulation[rungOf.get(d.id) ?? "none"] = (rungPopulation[rungOf.get(d.id) ?? "none"] ?? 0) + 1;
    q2Rung = rungSplit(results, rungOf, rungPopulation);
  }
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
    postHoc: { note: "not pre-registered: added after the sample was drawn (conductor request, Q-2 merged mid-run)", q2RungNoCatalogMatch: q2Rung },
    queries: {
      perBoxMean: Math.round((results.reduce((a, r) => a + r.queries.length, 0) / results.length) * 100) / 100,
      boxesByStratum: Object.fromEntries(STRATA.map((s) => [s, results.filter((r) => r.stratum === s).length])),
    },
    resolvedBy: resolvedBy(results),
    isfdbBy: isfdbBy(results),
    network,
    lookup,
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
