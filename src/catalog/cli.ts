// `bookcase catalog build | query | eval` (card C-3) and `coverage` (card C-4, in coverage-cli.ts).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { isAbsolute, join } from "node:path";
import { parseArgs } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { dataRoot } from "../ledger/images.ts";
import { buildCatalog, catalogFileSize, READABLE_SCHEMA_VERSIONS } from "./build.ts";
import { loadGolden, runGolden } from "./golden.ts";
import { buildStats, statsPathFor } from "./rarity.ts";
import type { GoldenRun } from "./golden.ts";
import { retrieve, WEIGHTS } from "./retrieve.ts";
import type { Candidate } from "./retrieve.ts";

const usage = `usage: bookcase catalog <command>

  build  [--staging <file>] [--out <file>] [--ol-staging <file>]
                                                 build catalog.sqlite from the ISFDB staging file; --ol-staging also merges
                                                 the Open Library staging file (C-5; then --out defaults to catalog-v2.sqlite)
  stats  [--db <file>]                           build the statistics sidecar beside a catalog (C-7: <catalog>.stats.sqlite;
                                                 the catalog file itself is not written)
  query  <text>... [-k N] [--json] [--db <file>] retrieve candidates; each <text> is one reading (variant) of the spine
  eval   [--golden <file>] [--db <file>] [--run-id <id>] [--k N]
                                                 score retrieve on the golden fragments; --run-id writes evals/<id>/{metrics.json,report.md}
  coverage [--tune] [--session <name>] [--offline] [--db <file>] [--run-id <id>]
                                                 catalog gap on an F-0 session through Open Library and LoC (C-4); --run-id writes evals/<id>/metrics.json

Files default to $BOOKCASE_DATA/catalog/{isfdb-staging,catalog}.sqlite (default root ~/data/bookcase-discovery/).
BOOKCASE_CATALOG selects the catalog file every reader opens: a file name under $BOOKCASE_DATA/catalog/
(e.g. catalog-v2.sqlite) or an absolute path. Default catalog.sqlite.`;

const fmt = (n: number) => n.toLocaleString("en-US");

/** The catalog file readers open: `BOOKCASE_CATALOG` (a file name in the catalog folder, or an absolute path), else catalog.sqlite. */
export function catalogPaths(env: NodeJS.ProcessEnv = process.env) {
  const dir = join(dataRoot(env), "catalog");
  const chosen = env.BOOKCASE_CATALOG?.trim();
  return {
    staging: join(dir, "isfdb-staging.sqlite"),
    olStaging: join(dir, "ol-staging.sqlite"),
    catalog: chosen ? (isAbsolute(chosen) ? chosen : join(dir, chosen)) : join(dir, "catalog.sqlite"),
    catalogV2: join(dir, "catalog-v2.sqlite"),
  };
}

export function openCatalog(path: string): DatabaseSync {
  if (!existsSync(path)) throw new Error(`${path} does not exist; run \`bookcase catalog build\` first`);
  const db = new DatabaseSync(path, { readOnly: true });
  const v = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (!READABLE_SCHEMA_VERSIONS.includes(v)) {
    db.close();
    throw new Error(`${path} has schema version ${v}, this code reads ${READABLE_SCHEMA_VERSIONS.join(" and ")}; rebuild with \`bookcase catalog build\``);
  }
  return db;
}

export function formatCandidates(cands: Candidate[]): string {
  if (cands.length === 0) return "(no candidates)";
  return cands
    .map((c, i) => {
      const head = `${String(i + 1).padStart(2)}. ${c.score.toFixed(3)}  ${c.title}${c.subtitle ? `: ${c.subtitle}` : ""} — ${c.authors.join(", ") || "(no author)"}`;
      const meta = [c.year ?? "", c.series ? `${c.series}${c.seriesNum ? ` #${c.seriesNum}` : ""}` : "", `${c.editionCount} editions`, c.workId].filter((x) => x !== "").join(" · ");
      const ev = c.evidence.map((e) => `${e.field} ${e.score.toFixed(2)} "${e.form}"${e.formKind && e.formKind !== "title" ? ` (${e.formKind})` : ""} ← ${e.matches.map((m) => `${m.query}:${m.how}`).join(" ")}`);
      return [head, `      ${meta}`, ...ev.map((x) => `      ${x}`)].join("\n");
    })
    .join("\n");
}

function gitCommit(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function metaOf(db: DatabaseSync): Record<string, string> {
  return Object.fromEntries((db.prepare("SELECT key, value FROM meta").all() as Array<{ key: string; value: string }>).map((r) => [r.key, r.value]));
}

export function metricsJson(run: GoldenRun, runId: string, meta: Record<string, string>, goldenSha: string, catalogBytes: number, now: Date): Record<string, unknown> {
  return {
    runId,
    card: "C-3",
    date: now.toISOString().slice(0, 10),
    code: gitCommit(),
    golden: { file: run.goldenFile, sha256: goldenSha, queries: run.queries, catalogGaps: run.gaps.length },
    catalog: {
      schemaVersion: Number(meta.schema_version),
      stagingContentHash: meta.staging_content_hash,
      stagingDumpDate: meta.staging_dump_date,
      workTypes: meta.work_ttypes,
      works: Number(meta["rows.works"]),
      editions: Number(meta["rows.editions"]),
      bytes: catalogBytes,
    },
    k: run.k,
    rates: run.rates,
    latencyMs: { ...run.latencyMs, note: "per retrieve() call (all variants of one query), warm cache after one untimed pass" },
    host: { cpu: cpus()[0]?.model ?? "unknown", cores: cpus().length, node: process.version, platform: process.platform },
    noMatchScores: run.none,
    topScoreWhenTop1Correct: run.hitTopScore,
    weights: WEIGHTS,
  };
}

const pct = (x: number) => `${(x * 100).toFixed(1)} %`;

export function reportMarkdown(run: GoldenRun, runId: string, metrics: Record<string, unknown>): string {
  const rows = Object.entries(run.rates).map(([name, r]) => `| ${name} | ${r.n} | ${pct(r.top1)} | ${pct(r.top5)} | ${pct(r.top10)} | ${r.mrr.toFixed(3)} |`);
  const miss = run.results.filter((r) => r.class !== "none" && r.inCatalog && (r.rank === null || r.rank > 5));
  const lat = run.latencyMs;
  return [
    `# ${runId}: catalog retrieval on the golden fragments (C-3)`,
    "",
    `Golden file \`${run.goldenFile}\`, ${run.queries} queries; run on ${(metrics as { date: string }).date}, code ${(metrics as { code: string | null }).code ?? "unknown"}.`,
    run.gaps.length ? `Catalog gaps (expected work not in the catalog, left out of the rates): ${run.gaps.join(", ")}.` : "Catalog gaps: none (every expected work exists in the catalog).",
    "",
    "| subset | queries | top-1 | top-5 | top-10 | MRR |",
    "|---|---:|---:|---:|---:|---:|",
    ...rows,
    "",
    `Latency per \`retrieve\` call: p50 ${lat.p50} ms, **p95 ${lat.p95} ms**, max ${lat.max} ms, mean ${lat.mean} ms over ${lat.n} calls (warm cache).`,
    "",
    run.none ? `No-match queries (${run.none.n}, nothing in the catalog should be the book): top candidate score max ${run.none.topScoreMax}, median ${run.none.topScoreMedian}.` : "",
    run.hitTopScore ? `Top score when the top-1 candidate is right (${run.hitTopScore.n} queries): min ${run.hitTopScore.min}, 10th percentile ${run.hitTopScore.p10}, median ${run.hitTopScore.median}.` : "",
    "",
    miss.length ? `Queries whose expected work is not in the top 5 (${miss.length}): ${miss.map((r) => `${r.id}${r.rank ? ` (rank ${r.rank})` : ""}`).join(", ")}.` : "Every scored query has its expected work in the top 5.",
    "",
  ].join("\n");
}

export function catalogCommand(argv: string[], env: NodeJS.ProcessEnv = process.env): number | Promise<number> {
  const [cmd, ...rest] = argv;
  const paths = catalogPaths(env);
  if (cmd === "coverage") {
    return import("./coverage-cli.ts")
      .then((m) => m.coverageCommand(rest, env))
      .catch((e: unknown) => {
        console.error(`bookcase catalog coverage: ${(e as Error).message}`);
        return 1;
      });
  }
  try {
    if (cmd === "build") {
      const { values } = parseArgs({ args: rest, options: { staging: { type: "string" }, out: { type: "string" }, "ol-staging": { type: "string" } } });
      const ol = values["ol-staging"];
      // Never write the default catalog.sqlite with Open Library merged in: readers may have it open (C-5).
      const out = values.out ?? (ol ? paths.catalogV2 : join(dataRoot(env), "catalog", "catalog.sqlite"));
      const t = (s: string) => console.error(`${new Date().toISOString().slice(11, 19)} ${s}`);
      const r = buildCatalog({ staging: values.staging ?? paths.staging, out, ...(ol ? { openLibrary: ol } : {}), log: t });
      console.log(`built ${r.out} in ${r.seconds.toFixed(1)} s (${fmt(catalogFileSize(r.out))} bytes)`);
      for (const [k, v] of Object.entries(r.counts)) console.log(`  ${k.padEnd(14)} ${fmt(v).padStart(10)}`);
      if (r.openLibrary) for (const [k, v] of Object.entries(r.openLibrary)) console.log(`  openlibrary.${k.padEnd(26)} ${fmt(v).padStart(10)}`);
      console.log(`  staging content hash ${r.stagingHash}`);
      return 0;
    }
    if (cmd === "stats") {
      const { values } = parseArgs({ args: rest, options: { db: { type: "string" } } });
      const catalog = values.db ?? paths.catalog;
      const t = (s: string) => console.error(`${new Date().toISOString().slice(11, 19)} ${s}`);
      const c = buildStats(catalog, statsPathFor(catalog), t);
      console.log(`built ${statsPathFor(catalog)} in ${c.seconds} s`);
      for (const [k, v] of Object.entries(c)) if (k !== "seconds") console.log(`  ${k.padEnd(12)} ${fmt(v).padStart(10)}`);
      return 0;
    }
    if (cmd === "query") {
      const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { k: { type: "string", short: "k" }, json: { type: "boolean" }, db: { type: "string" } } });
      if (positionals.length === 0) {
        console.error(usage);
        return 1;
      }
      const db = openCatalog(values.db ?? paths.catalog);
      const k = values.k ? Number(values.k) : 10;
      const t0 = performance.now();
      const cands = retrieve(db, positionals, k);
      const ms = performance.now() - t0;
      db.close();
      console.log(values.json ? JSON.stringify(cands, null, 2) : `${formatCandidates(cands)}\n\n${cands.length} candidate(s) in ${ms.toFixed(0)} ms`);
      return 0;
    }
    if (cmd === "eval") {
      const { values } = parseArgs({ args: rest, options: { golden: { type: "string" }, db: { type: "string" }, "run-id": { type: "string" }, k: { type: "string" } } });
      const goldenPath = values.golden ?? "evals/golden/fragments.jsonl";
      const db = openCatalog(values.db ?? paths.catalog);
      const run = runGolden(db, loadGolden(goldenPath), goldenPath, values.k ? Number(values.k) : 10);
      const meta = metaOf(db);
      db.close();
      const runId = values["run-id"] ?? "C3-adhoc";
      const goldenSha = createHash("sha256").update(readFileSync(goldenPath)).digest("hex");
      const metrics = metricsJson(run, runId, meta, goldenSha, catalogFileSize(values.db ?? paths.catalog), new Date());
      const report = reportMarkdown(run, runId, metrics);
      console.log(report);
      if (values["run-id"]) {
        const dir = join("evals", values["run-id"]);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
        writeFileSync(join(dir, "report.md"), report);
        console.log(`wrote ${dir}/metrics.json and ${dir}/report.md`);
      }
      const clean = run.rates.clean!;
      return clean.top5 >= 0.9 ? 0 : 1;
    }
  } catch (e) {
    console.error(`bookcase catalog: ${(e as Error).message}`);
    return 1;
  }
  console.error(usage);
  return cmd === undefined || cmd === "--help" || cmd === "-h" ? 0 : 1;
}
