// C-10 evaluation (evals/C10/prereg.md): G1 (C-4 reproduces with zero live calls), K1 (live calls per new photo),
// the batching attribution gate and its live check, and the published metrics.
//
//   node src/catalog/lookup-eval.ts g1              compare private/c10/g1{a,b}.*.json and tables with C-4
//   node src/catalog/lookup-eval.ts attribution     cached-data attribution per source and shape
//   node src/catalog/lookup-eval.ts batch-check     live check of batched Open Library fielded queries (≤ 40 calls)
//   node src/catalog/lookup-eval.ts replay          C-4's sample from a cold cache, "live" answers replayed from the warm store
//   node src/catalog/lookup-eval.ts publish         evals/C10/metrics.json from private/c10/*.json (counts only)
//
// The coverage command writes the G1 and K1 inputs: `bookcase catalog coverage [--tune] --budget 0 [--no-local]`
// and `--plan --all [--session <name>]`, their stdout saved under the data root's `private/c10/`.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataRoot } from "../ledger/images.ts";
import { loadReadings, readJsonl, stageDir, type SpineDecision } from "../eval/f0.ts";
import { catalogPaths, openCatalog } from "./cli.ts";
import { drawSample, openLookup, parseOpenLibrary, resolveBox, type BoxResult, type FetchLike, type OutsideRecord } from "./coverage.ts";
import { copyKey, KnownIndex, LOOKUP, SPACING_MS, USER_AGENT, type CacheEntry, type Source } from "./lookup.ts";
import { localTier } from "./lookup-local.ts";
import { attributable, attribution, cachedEntries, planSummary } from "./lookup-plan.ts";

const ROOT = dataRoot();
const PRIV = join(ROOT, "private", "c10");
const C4 = JSON.parse(readFileSync(join("evals", "C4", "metrics.json"), "utf8")) as Record<string, unknown>;
const load = (name: string) => JSON.parse(readFileSync(join(PRIV, name), "utf8")) as Record<string, unknown>;
const save = (name: string, v: unknown) => writeFileSync(join(PRIV, name), `${JSON.stringify(v, null, 2)}\n`);

/** Paths under `want` whose value differs in `got` (keys `got` adds are not compared). */
function differences(got: unknown, want: unknown, path = ""): string[] {
  if (want !== null && typeof want === "object" && !Array.isArray(want)) {
    return Object.entries(want).flatMap(([k, v]) => differences((got as Record<string, unknown> | undefined)?.[k], v, `${path}.${k}`));
  }
  return JSON.stringify(got) === JSON.stringify(want) ? [] : [path];
}

/** C-4's tuning-run sanity (evals/C4/report.md § Sanity check: 13 of 20 resolve, 12 in ISFDB, one not). */
const C4_TUNING = { n: 20, resolved: 13, inIsfdb: 12, notInIsfdb: 1 };

function g1() {
  const fields = ["estimate", "confirmedSanity", "resolvedBy", "isfdbBy"] as const;
  const box = (r: BoxResult) => JSON.stringify([r.cls, r.resolvedBy, r.record?.id ?? null, r.inOpenLibrary, r.genre, r.isfdb, r.agreesWithF0, r.queries.length]);
  const c4Tables = Object.fromEntries((["sample", "tuning"] as const).map((role) => [role, new Map(readJsonl<BoxResult>(join(ROOT, "private", "c4", `pilot-000.${role}.jsonl`)).map((r) => [r.id, r]))]));
  const out: Record<string, unknown> = {};
  for (const arm of ["g1a", "g1b"] as const) {
    const s = load(`${arm}.sample.json`) as Record<string, Record<string, unknown>>;
    const t = load(`${arm}.tuning.json`) as Record<string, Record<string, unknown>>;
    const diffs = fields.flatMap((f) => differences(s[f], C4[f], f));
    const extra = { resolvedByIsfdb: (s.resolvedBy as Record<string, number>).isfdb ?? 0, isfdbByLocal: (s.isfdbBy as Record<string, number>).local ?? 0 };
    const calls = [s.network!.calls, t.network!.calls].map((c) => (c as Record<string, number>).openlibrary + (c as Record<string, number>).loc);
    const skipped = [s.lookup!.keys, t.lookup!.keys].map((k) => Object.values((k as Record<string, Record<string, number>>).skipped).reduce((a, b) => a + b, 0));
    const tuningDiffs = differences(t.sanity, C4_TUNING, "tuning");
    const tableDiffs = (["sample", "tuning"] as const).map((role) => {
      const table = existsSync(join(PRIV, `${arm}.${role}.table.jsonl`)) ? readJsonl<BoxResult>(join(PRIV, `${arm}.${role}.table.jsonl`)) : null;
      return table === null ? null : table.filter((r) => { const c = c4Tables[role]!.get(r.id); return !c || box(c) !== box(r); }).length;
    });
    out[arm] = {
      local: s.lookup!.local,
      liveCalls: calls[0]! + calls[1]!,
      skippedKeys: skipped[0]! + skipped[1]!,
      differingFigures: diffs.length + tuningDiffs.length,
      differing: [...diffs, ...tuningDiffs],
      addedZero: extra.resolvedByIsfdb === 0 && extra.isfdbByLocal === 0,
      boxesDifferingFromC4Table: { sample: tableDiffs[0], tuning: tableDiffs[1] },
      outcomes: s.lookup!.outcomes,
      cacheHits: s.network!.cacheHits,
      c4CacheHits: (C4.network as Record<string, unknown>).cacheHits,
      pass: calls[0]! + calls[1]! === 0 && skipped[0]! + skipped[1]! === 0 && diffs.length + tuningDiffs.length === 0 && extra.resolvedByIsfdb === 0 && extra.isfdbByLocal === 0,
    };
  }
  save("g1.json", out);
  console.log(JSON.stringify(out, null, 2));
}

function attributionCmd() {
  const cache = openLookup(join(ROOT, "catalog", "coverage"), { budget: 0 });
  const a = attribution({ openlibrary: cachedEntries(cache, "openlibrary"), loc: cachedEntries(cache, "loc") });
  save("attribution.json", a);
  console.log(JSON.stringify(a, null, 2));
}

/**
 * The live check for the one cell that passed the cached gate (Open Library `fielded`): cached positive
 * fielded queries, in cache order, batched 5 and then 10 to a `q=` call; each subquery's attributed records
 * (response order, top 10) against its cached single response's top-10 ids. Plain fetch with C-4's spacing
 * and User-Agent; the batched responses are not cached (their keys would mean other queries).
 */
async function batchCheck(maxCalls = 40) {
  const cache = openLookup(join(ROOT, "catalog", "coverage"), { budget: 0 });
  const entries = cachedEntries(cache, "openlibrary").filter((e) => e.outcome === "match" && e.key.split("|")[1] === "fielded");
  const parts = (e: CacheEntry) => {
    const [, , title, author] = e.key.split("|");
    return { title: title!.split(" "), author: author!.split(" ").filter(Boolean) };
  };
  const batches: CacheEntry[][] = [];
  for (const size of [5, 10]) for (let i = 0; i + size <= entries.length; i += size) batches.push(entries.slice(i, i + size));
  if (batches.length > maxCalls) throw new Error(`${batches.length} calls planned, over the ${maxCalls} allowance`);
  let calls = 0;
  let last = -Infinity;
  const rows: { size: number; subqueries: number; reproduced: number; singleRecords: number; recovered: number; status: number }[] = [];
  for (const batch of batches) {
    const q = batch.map((e) => { const p = parts(e); return `(title:(${p.title.join(" ")})${p.author.length ? ` AND author:(${p.author.join(" ")})` : ""})`; }).join(" OR ");
    const url = `https://openlibrary.org/search.json?${new URLSearchParams({ q, fields: "key,title,subtitle,author_name,isbn,subject,first_publish_year", limit: String(10 * batch.length) }).toString()}`;
    const wait = last + SPACING_MS.openlibrary - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    calls++;
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
    const body = res.status === 200 ? await res.text() : null;
    const recs = body === null ? [] : parseOpenLibrary(body);
    let reproduced = 0;
    let singleRecords = 0;
    let recovered = 0;
    for (const e of batch) {
      const p = parts(e);
      const tokens = [...p.title, ...p.author];
      const single = parseOpenLibrary(e.body!).slice(0, 10).map((r) => r.id);
      const got = recs.filter((r) => attributable(r, tokens)).slice(0, 10).map((r) => r.id);
      singleRecords += single.length;
      recovered += single.filter((id) => got.includes(id)).length;
      if (single.length === got.length && single.every((id) => got.includes(id))) reproduced++;
    }
    rows.push({ size: batch.length, subqueries: batch.length, reproduced, singleRecords, recovered, status: res.status });
  }
  const sum = (k: "subqueries" | "reproduced" | "singleRecords" | "recovered", size?: number) => rows.filter((r) => size === undefined || r.size === size).reduce((a, r) => a + r[k], 0);
  const out = {
    cell: "openlibrary fielded",
    calls,
    bySize: Object.fromEntries([5, 10].map((s) => [s, { calls: rows.filter((r) => r.size === s).length, subqueries: sum("subqueries", s), reproduced: sum("reproduced", s), recordRecall: Math.round((sum("recovered", s) / sum("singleRecords", s)) * 10000) / 10000 }])),
    httpErrors: rows.filter((r) => r.status !== 200).length,
    switchOn: sum("reproduced") === sum("subqueries") && rows.every((r) => r.status === 200),
  };
  save("batch-check.json", out);
  console.log(JSON.stringify(out, null, 2));
}

/**
 * Post hoc (not pre-registered): C-4's sample and tuning boxes through C-10's tiers from an empty cache, every
 * "live" call answered from the warm version-2 store instead of the network (a failed entry answers HTTP 500,
 * so its three tries count). Zero network. The calls it counts are the calls C-10 would have made had it
 * run C-4's card from scratch, against C-4's 1,317.
 */
async function replay() {
  const warm = openLookup(join(ROOT, "catalog", "coverage"), { budget: 0 });
  const missing = { openlibrary: 0, loc: 0 } as Record<Source, number>;
  const f: FetchLike = async (url) => {
    const source: Source = url.startsWith("https://openlibrary.org") ? "openlibrary" : "loc";
    const p = warm.peek(source, url);
    if (!p.entry) missing[source]++;
    const body = p.entry?.body ?? null;
    return { status: body === null ? 500 : 200, text: async () => body ?? "" };
  };
  const decisions = readJsonl<SpineDecision>(join(stageDir(ROOT, "pilot-000"), "decisions.jsonl"));
  const readings = loadReadings(stageDir(ROOT, "pilot-000"));
  const f0Work = new Map(decisions.map((d) => [d.id, d.accepted?.workId ?? null]));
  const groups = new Map<number, string[]>();
  for (const r of readJsonl<{ id: string; group: number }>(join(ROOT, "private", "f0g", "pilot-000", "copies.jsonl"))) groups.set(r.group, [...(groups.get(r.group) ?? []), r.id]);
  const copies = new Map([...groups.values()].flatMap((ids) => ids.map((id) => [id, copyKey(ids)] as const)));
  const db = openCatalog(catalogPaths().catalog);
  const v2 = new DatabaseSync(catalogPaths().catalogV2, { readOnly: true });
  const out: Record<string, unknown> = { note: "post hoc, not pre-registered: zero network, live answers replayed from the warm store" };
  try {
    for (const local of [true, false]) {
      const cold = mkdtempSync(join(PRIV, "replay-"));
      try {
        const cache = openLookup(cold, { fetch: f, sleep: async () => {} });
        const known = new KnownIndex<OutsideRecord>();
        const results: BoxResult[] = [];
        for (const box of drawSample(decisions).boxes.filter((b) => b.role === "sample")) {
          results.push(await resolveBox(db, cache, box, readings.get(box.id) ?? {}, f0Work.get(box.id) ?? null, { local: local ? localTier(db, v2) : null, known, copy: copies.get(box.id) ?? null }));
        }
        const s = planSummary(results, cache);
        out[local ? "allTiers" : "noLocal"] = { boxes: results.length, calls: cache.calls, outcomes: s.outcomes, keys: s.keys, local: s.local, classes: { inIsfdb: results.filter((r) => r.cls === "in-isfdb").length, notInIsfdb: results.filter((r) => r.cls === "not-in-isfdb").length, unresolved: results.filter((r) => r.cls === "unresolved").length } };
      } finally {
        rmSync(cold, { recursive: true, force: true });
      }
    }
  } finally {
    db.close();
    v2.close();
  }
  out.missingFromWarmStore = missing;
  save("replay.json", out);
  console.log(JSON.stringify(out, null, 2));
}

function publish() {
  const g = load("g1.json");
  const plan = (name: string) => (existsSync(join(PRIV, name)) ? load(name) : null);
  const metrics = {
    runId: "C10",
    card: "C-10",
    date: new Date().toISOString().slice(0, 10),
    design: { lookup: LOOKUP },
    migration: (load("g1a.sample.json").lookup as Record<string, unknown>).migration,
    g1: g,
    k1: {
      before: { c4Run: { sampledBoxes: 235, photos: 31, calls: { openlibrary: 1030, loc: 287 } }, v1Cache: plan("k1.before.json") },
      yardstickB2: plan("k1.yardstick.plan.json"),
      pilot000All: plan("k1.pilot.plan.json"),
    },
    postHocReplayC4: plan("replay.json"),
    batching: { attribution: plan("attribution.json"), liveCheck: plan("batch-check.json") },
    liveCallsThisCard: plan("live-calls.json"),
    spendUsd: 0,
  };
  writeFileSync(join("evals", "C10", "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
  console.log("wrote evals/C10/metrics.json");
}

const [cmd] = process.argv.slice(2);
if (cmd === "g1") g1();
else if (cmd === "attribution") attributionCmd();
else if (cmd === "batch-check") await batchCheck();
else if (cmd === "replay") await replay();
else if (cmd === "publish") publish();
else {
  console.error("usage: node src/catalog/lookup-eval.ts g1 | attribution | batch-check | publish");
  process.exitCode = 1;
}
