// MM-1 runner: spine strips and embeddings on each set's RB-1 box set (evals/MM1/prereg.md).
//
//   node src/eval/mm1-cli.ts embed <set>     # GPU (MPS): strips and both embeddings for boxes not cached, then records
//   node src/eval/mm1-cli.ts records <set>   # CPU: the set's records from the caches (every vector must exist)
//   node src/eval/mm1-cli.ts analyse         # both sets: counts and the label-free checks -> evals/MM1/{metrics.json,report.md}
//
// <set> is pilot-000 or yardstick, stored and reported apart (OC35); the yardstick's records are evaluation-only.
// Strips, vectors and records (reader text, work ids) stay under the data root's private/mm/<set>/; only aggregates
// reach evals/MM1/. Cached stage folders of earlier cards are read, never written. Nothing here reads or changes a
// decision, and the appearance switch stays off (`appearanceMode`). Checkpoints are read from the data root's
// models/ and never fetched here.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dataRoot } from "../ledger/images.ts";
import { cropName, F0_CROP } from "../perceive/crop.ts";
import { imagesOf, SETS } from "./f0c-cli.ts";
import { loadReadings, readJsonl, READERS, type Detection, type ReaderName } from "./f0.ts";
import { compactJson } from "./q1-cli.ts";
import type { Rung } from "./q2.ts";
import { loadBoxSet } from "./rb1.ts";
import { labelOf, sha256, type BoxEvidence } from "./ts0.ts";
import {
  appearanceMode,
  assertOneRecordPerCopy,
  assertSeparated,
  boxSetHash,
  bySim,
  cosine,
  embedDir,
  isEvaluationOnly,
  lookalikeRate,
  MM1,
  MmRecord,
  modelRevision,
  MODELS,
  pairBootstrap,
  pairSets,
  recordsVersion,
  stripKey,
  weightedAuc,
  weightedMean,
  weightedMedian,
  type Box,
  type Interval,
  type MmSet,
  type ModelName,
} from "./mm1.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const ROOT = dataRoot();
const PRIV = join(ROOT, "private", "mm");
const HELPER = join(REPO, "helpers", "embed");
const log = (s: string): void => console.error(`[mm1] ${new Date().toISOString().slice(11, 19)} ${s}`);
const r4 = (x: number) => Math.round(x * 10000) / 10000;

/** Each set's caches under the data root (each earlier card names the yardstick its own way). */
const SOURCES = (set: MmSet) => {
  const h = set === "pilot-000" ? "pilot-000" : "yardstick-library-b2";
  return {
    detect: join(SETS[set].base, "detect.jsonl"),
    readings: SETS[set].base,
    decisions: join(ROOT, "private", "h2", h, "base-decisions.jsonl"),
    copies: join(ROOT, "private", "f0g", set, "copies.jsonl"),
    context: join(ROOT, "private", "f0h", set, "decisions.jsonl"),
    rungs: join(ROOT, "private", "q2b", "table", `${h}.jsonl`),
  };
};

const must = (path: string, what: string): string => {
  if (!existsSync(path)) throw new Error(`no ${what} at the data root (${relative(ROOT, path)})`);
  return path;
};
const split = (id: string): [string, number] => {
  const k = id.lastIndexOf(":");
  return [id.slice(0, k), Number(id.slice(k + 1))];
};
const setDir = (set: MmSet): string => {
  const d = join(PRIV, set);
  mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
};

// --- models (INV-14) ---------------------------------------------------------------------------------------

/** A checkpoint's Hugging Face revision, from the download's own metadata beside the weights. */
function revisionOf(model: ModelName): string {
  const meta = must(join(ROOT, "models", MM1.models[model].dir, ".cache", "huggingface", "download", "model.safetensors.metadata"), `${model} checkpoint`);
  const rev = readFileSync(meta, "utf8").split("\n")[0]!.trim();
  if (!/^[0-9a-f]{40}$/.test(rev)) throw new Error(`${model}: no revision in the download metadata`);
  return rev;
}
const revisions = (): Record<ModelName, string> => Object.fromEntries(MODELS.map((m) => [m, revisionOf(m)])) as Record<ModelName, string>;
const helperSha = (): string => sha256(readFileSync(join(HELPER, "embed.py")));

// --- one set's boxes ----------------------------------------------------------------------------------------

interface Inputs {
  set: MmSet;
  kept: string[];
  polygon: (id: string) => [number, number][];
  boxSet: string;
  evidence: (id: string) => BoxEvidence;
  copyOf: (id: string) => string | null;
  rung: (id: string) => Rung;
  readings: ReturnType<typeof loadReadings>;
}

interface BaseDecision {
  id: string;
  imageId: string;
  top: Partial<Record<ReaderName, string | null>>;
  confirmed: Partial<Record<ReaderName, string | null>>;
  accepted: { workId: string } | null;
  agreeing: ReaderName[];
}

function inputs(set: MmSet): Inputs {
  const src = SOURCES(set);
  const box = loadBoxSet(set, ROOT);
  const kept = [...box.rows.values()].filter((r) => r.state === "kept" && box.keeps(r.id)).map((r) => r.id).sort();
  const dets = new Map(readJsonl<Detection>(must(src.detect, "detection")).filter((d) => !d.error).map((d) => [d.id, d]));
  const polygon = (id: string) => {
    const [img, i] = split(id);
    const s = dets.get(img)?.spines[i];
    if (!s) throw new Error(`${set}: a kept box with no detection`);
    return s.polygon as [number, number][];
  };
  const outline = (id: string) => {
    const r = box.rows.get(id);
    return r?.changed ? r.outline : null;
  };
  const decisions = new Map(readJsonl<BaseDecision>(must(src.decisions, "F-0 base decisions")).map((d) => [d.id, d]));
  const copies = new Map(
    readJsonl<{ id: string; basis: string | null; workId: string | null; from?: string; consistent?: ReaderName[] }>(must(src.copies, "F-0g copies"))
      .filter((c) => c.basis === "confirmed-by-copy" && c.workId)
      .map((c) => [c.id, c]),
  );
  const context = new Map(
    readJsonl<{ id: string; basis: string | null; workId: string | null; readers: ReaderName[] }>(must(src.context, "F-0h decisions"))
      .filter((c) => c.basis === "confirmed-by-context" && c.workId)
      .map((c) => [c.id, c]),
  );
  const rungs = new Map(readJsonl<{ id: string; rung: Rung }>(must(src.rungs, "Q-2b rung table")).map((r) => [r.id, r.rung]));
  return {
    set,
    kept,
    polygon,
    boxSet: boxSetHash(set, kept.map((id) => ({ id, polygon: polygon(id), outline: outline(id) }))),
    evidence: (id) => {
      const d = decisions.get(id);
      if (!d) throw new Error(`${set}: a kept box with no F-0 decision`);
      const c = copies.get(id), x = context.get(id);
      return {
        id,
        imageId: d.imageId,
        decision: { top: d.top, confirmed: d.confirmed, accepted: d.accepted?.workId ?? null, agreeing: d.agreeing },
        copy: c ? { workId: c.workId!, readers: c.consistent ?? [] } : null,
        context: x ? { workId: x.workId!, readers: x.readers } : null,
      };
    },
    copyOf: (id) => copies.get(id)?.from ?? null,
    rung: (id) => {
      const r = rungs.get(id);
      if (!r) throw new Error(`${set}: a kept box with no rung`);
      return r;
    },
    readings: loadReadings(src.readings),
  };
}

// --- embed: strips and vectors (GPU) -------------------------------------------------------------------------

/** Wait until no other GPU job (mlx, torch or Qwen) is running; count only python, mlx or Vision executables. */
function waitForGpu(): void {
  const pat = "mlx|torch|qwen|(read|detect|partition|stage|recover|zone|fields|imprint|faces|ends|outline|train)\\.py|ocr-vision";
  for (let n = 0; ; n++) {
    const pids = (spawnSync("pgrep", ["-f", pat], { encoding: "utf8" }).stdout ?? "").split("\n").filter((x) => x.trim() && Number(x) !== process.pid);
    const others = pids.filter((p) => /python|mlx|ocr-vision/i.test(spawnSync("ps", ["-o", "comm=", "-p", p], { encoding: "utf8" }).stdout ?? ""));
    if (!others.length) return;
    if (n % 10 === 0) log(`GPU busy (${others.length} job(s)); waiting`);
    spawnSync("sleep", ["60"]);
  }
}

const vecPath = (set: MmSet, model: ModelName, rev: string, key: string) => join(PRIV, set, "emb", embedDir(model, rev), `${key}.f32`);
const stripPath = (set: MmSet, key: string) => join(PRIV, set, "strips", `${key}.png`);

async function embed(set: MmSet): Promise<void> {
  const inp = inputs(set);
  const revs = revisions();
  const dir = setDir(set);
  const photos = new Map(imagesOf(set).map((i) => [i.id, i.path]));
  const byPhoto = new Map<string, string[]>();
  for (const id of inp.kept) {
    const key = stripKey(id, inp.polygon(id));
    if (existsSync(stripPath(set, key)) && MODELS.every((m) => existsSync(vecPath(set, m, revs[m], key)))) continue;
    const [img] = split(id);
    byPhoto.set(img, [...(byPhoto.get(img) ?? []), id]);
  }
  const order = [...photos.keys()].filter((p) => byPhoto.has(p));
  log(`${set}: ${inp.kept.length} boxes; ${[...byPhoto.values()].reduce((s, x) => s + x.length, 0)} to embed in ${order.length} photos`);
  if (order.length) {
    const py = join(HELPER, ".venv", "bin", "python");
    if (!existsSync(py)) throw new Error("helpers/embed has no .venv: run `uv sync` there first");
    waitForGpu();
    const t0 = Date.now();
    const lines: string[] = [];
    const args = [
      "-I", join(HELPER, "embed.py"),
      "--dinov2", join(ROOT, "models", MM1.models.dinov2.dir),
      "--siglip2", join(ROOT, "models", MM1.models.siglip2.dir),
      "--strips", join(dir, "strips"),
      "--dinov2-out", join(dir, "emb", embedDir("dinov2", revs.dinov2)),
      "--siglip2-out", join(dir, "emb", embedDir("siglip2", revs.siglip2)),
    ];
    await new Promise<void>((resolve, reject) => {
      const child = spawn(py, args, { stdio: ["pipe", "pipe", "pipe"] });
      let buf = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (c: string) => {
        buf += c;
        const parts = buf.split("\n");
        buf = parts.pop()!;
        lines.push(...parts.filter((l) => l.trim()));
      });
      // stderr carries photo ordinals only; keep its last lines for a failure, never echo library chatter.
      let err = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (c: string) => (err = (err + c).slice(-2000)));
      child.stdin.end(order.map((p, k) => JSON.stringify({ photo: k, image: photos.get(p), boxes: byPhoto.get(p)!.map((id) => ({ key: stripKey(id, inp.polygon(id)), polygon: inp.polygon(id) })) }) + "\n").join(""));
      child.once("error", reject);
      child.once("close", (code) => (code === 0 ? resolve() : reject(new Error(`embed.py exited ${code}: ${err.split("\n").filter(Boolean).at(-1) ?? ""}`))));
    });
    const wall = (Date.now() - t0) / 1000;
    const out = lines.map((l) => JSON.parse(l) as { ready?: { loadSeconds: number; dims: Record<ModelName, number> }; photo?: number; error?: string; boxes?: { cached: boolean }[]; seconds?: Record<string, number> });
    const ready = out.find((o) => o.ready)?.ready;
    const errors = out.filter((o) => o.error).length;
    const rows = out.filter((o) => o.boxes);
    const embedded = rows.reduce((s, o) => s + o.boxes!.filter((b) => !b.cached).length, 0);
    const sum = (k: string) => rows.reduce((s, o) => s + (o.seconds?.[k] ?? 0), 0);
    const t = { set, at: new Date().toISOString(), wallSeconds: Math.round(wall), loadSeconds: ready?.loadSeconds ?? null, dims: ready?.dims ?? null, photos: rows.length, errors, embedded, seconds: { strip: r4(sum("strip")), dinov2: r4(sum("dinov2")), siglip2: r4(sum("siglip2")) } };
    appendFileSync(join(PRIV, "gpu.jsonl"), JSON.stringify(t) + "\n");
    log(`${set}: ${embedded} boxes embedded in ${rows.length} photos (${errors} failed) in ${Math.round(wall)} s`);
    if (errors) throw new Error(`${set}: ${errors} photo(s) failed in embed.py; re-run to retry them`);
  }
  records(set);
}

// --- records ------------------------------------------------------------------------------------------------

const readF32 = (path: string): Float32Array => {
  const b = readFileSync(path);
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

/** TS-0's latest export, by box id, when it exists. */
function ledgerOf(set: MmSet): Map<string, { version: string; split: string; workId: string }> {
  const dir = join(ROOT, "datasets", "label-ledger");
  if (isEvaluationOnly(set) || !existsSync(join(dir, "latest.json"))) return new Map();
  const { version } = JSON.parse(readFileSync(join(dir, "latest.json"), "utf8")) as { version: string };
  const rows = readJsonl<{ boxId: string; set: string; split: string; workId: string }>(join(dir, version, "labels.jsonl"));
  return new Map(rows.filter((r) => r.set === set).map((r) => [r.boxId, { version, split: r.split, workId: r.workId }]));
}

export function records(set: MmSet): string {
  const inp = inputs(set);
  const revs = revisions();
  const rev = modelRevision(revs, helperSha());
  const version = recordsVersion(inp.boxSet, rev);
  const ledger = ledgerOf(set);
  let ledgerDisagrees = 0;
  const out: MmRecord[] = inp.kept.map((id) => {
    const key = stripKey(id, inp.polygon(id));
    const sp = must(stripPath(set, key), "strip (run `mm1-cli.ts embed` first)");
    const meta = JSON.parse(readFileSync(sp.replace(/\.png$/, ".json"), "utf8")) as { valid: boolean };
    const size = pngSize(sp);
    const l = labelOf(inp.evidence(id));
    const label = l === "conflict" || !l ? null : l;
    const lg = ledger.get(id);
    if (lg && lg.workId !== label?.workId) ledgerDisagrees++;
    const reads = inp.readings.get(id) ?? {};
    const vec = (m: ModelName) => {
      const p = must(vecPath(set, m, revs[m], key), `${m} vector (run \`mm1-cli.ts embed\` first)`);
      return { path: relative(join(PRIV, set), p), dims: readF32(p).length, revision: revs[m] };
    };
    return MmRecord.parse({
      schemaVersion: MM1.schemaVersion,
      version,
      key: { boxId: id, boxSet: inp.boxSet, modelRevision: rev },
      set,
      evaluationOnly: isEvaluationOnly(set),
      readings: Object.fromEntries(
        READERS.filter((r) => reads[r]).map((r) => [r, { crop: reads[r]!.crop ?? cropName(F0_CROP), variants: reads[r]!.variants.map((v) => ({ rotation: v.rotation, text: v.text, confidence: v.confidence })) }]),
      ),
      basis: label?.basis ?? null,
      workId: label?.workId ?? null,
      readers: label?.readers ?? [],
      conflict: l === "conflict",
      copyOf: label?.basis === "confirmed-by-copy" ? inp.copyOf(id) : null,
      rung: inp.rung(id),
      ledger: lg ? { version: lg.version, split: lg.split } : null,
      strip: { key, path: relative(join(PRIV, set), sp), size, valid: meta.valid },
      embeddings: { dinov2: vec("dinov2"), siglip2: vec("siglip2") },
    });
  });
  assertOneRecordPerCopy(out);
  assertSeparated(set, out);
  if (ledgerDisagrees) throw new Error(`${set}: ${ledgerDisagrees} record(s) name a different work than TS-0's ledger; rebuild the ledger (bookcase dataset build)`);
  const dir = join(setDir(set), "records");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${version}.jsonl`);
  writeFileSync(`${file}.tmp`, out.map((r) => JSON.stringify(r)).join("\n") + "\n", { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
  writeFileSync(join(dir, "latest.json"), JSON.stringify({ version, boxSet: inp.boxSet, modelRevision: rev, revisions: revs, records: out.length }) + "\n", { mode: 0o600 });
  log(`${set}: ${out.length} records, version ${version}`);
  return version;
}

/** A PNG's width and height from its IHDR chunk. */
function pngSize(path: string): [number, number] {
  const b = readFileSync(path);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

// --- analyse: aggregates only --------------------------------------------------------------------------------

function loadRecords(set: MmSet): MmRecord[] {
  const dir = join(PRIV, set, "records");
  const { version } = JSON.parse(readFileSync(must(join(dir, "latest.json"), `${set} records`), "utf8")) as { version: string };
  const rows = readJsonl<unknown>(join(dir, `${version}.jsonl`)).map((r) => MmRecord.parse(r));
  assertOneRecordPerCopy(rows);
  assertSeparated(set, rows);
  return rows;
}

const tri = (i: Interval | null): [number, number, number] | null => (i ? [r4(i.value), r4(i.lo), r4(i.hi)] : null);
const countBy = <T>(xs: T[], k: (x: T) => string): Record<string, number> => {
  const o: Record<string, number> = {};
  for (const x of xs) o[k(x)] = (o[k(x)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(o).sort());
};

function analyseSet(set: MmSet) {
  const t0 = Date.now();
  const recs = loadRecords(set);
  const photoIdx = new Map<string, number>();
  const boxes: Box[] = recs.map((r) => {
    const [img] = split(r.key.boxId);
    if (!photoIdx.has(img)) photoIdx.set(img, photoIdx.size);
    return { id: r.key.boxId, photo: photoIdx.get(img)!, basis: r.basis, workId: r.workId, copyOf: r.copyOf, valid: r.strip.valid };
  });
  const confirmed = recs.filter((r) => r.basis);
  const models: Record<string, unknown> = {};
  for (const m of MODELS) {
    const vecs = recs.map((r) => readF32(join(PRIV, set, r.embeddings[m].path)));
    const ps = pairSets(boxes, (i, j) => cosine(vecs[i]!, vecs[j]!));
    for (const k of Object.keys(ps) as (keyof typeof ps)[]) bySim(ps[k]);
    const n = photoIdx.size;
    const boot = (f: (w: ArrayLike<number>) => number | null) => tri(pairBootstrap(n, f));
    const within = { same: ps.sameWork.filter((p) => p.a === p.b), different: ps.differentWork.filter((p) => p.a === p.b) };
    models[m] = {
      dims: vecs[0]?.length ?? null,
      pairs: Object.fromEntries(Object.entries(ps).map(([k, v]) => [k, v.length])),
      sameWorkWithinPhoto: within.same.length,
      m1Copy: {
        auc: boot((w) => weightedAuc(ps.copy, ps.samePhoto, w)),
        meanCopy: boot((w) => weightedMean(ps.copy, w)),
        meanSamePhoto: boot((w) => weightedMean(ps.samePhoto, w)),
      },
      m2TextSameWork: {
        auc: boot((w) => weightedAuc(ps.sameWorkText, ps.differentWork, w)),
        meanSameWork: boot((w) => weightedMean(ps.sameWorkText, w)),
        meanDifferentWork: boot((w) => weightedMean(ps.differentWork, w)),
      },
      m3Lookalike: {
        medianSameWork: boot((w) => weightedMedian(ps.sameWork, w)),
        rate: boot((w) => lookalikeRate(ps.sameWork, ps.differentWork, w)),
        rateWithinPhoto: boot((w) => lookalikeRate(within.same, within.different, w)),
      },
    };
  }
  log(`${set}: analysed in ${Math.round((Date.now() - t0) / 1000)} s`);
  return {
    scope: set === "pilot-000" ? "real use (OC35): machine labels, never accuracy (INV-17)" : "PROXY (library shelves), evaluation only (OC35)",
    evaluationOnly: isEvaluationOnly(set),
    photos: photoIdx.size,
    records: recs.length,
    validStrips: recs.filter((r) => r.strip.valid).length,
    confirmed: confirmed.length,
    works: new Set(confirmed.map((r) => r.workId)).size,
    conflicts: recs.filter((r) => r.conflict).length,
    withLedgerLabel: recs.filter((r) => r.ledger).length,
    byBasis: countBy(recs, (r) => r.basis ?? "none"),
    byRung: countBy(recs, (r) => r.rung),
    byBasisRung: countBy(recs, (r) => `${r.basis ?? "none"}|${r.rung}`),
    stripLongSide: (() => {
      const xs = recs.map((r) => Math.max(...r.strip.size)).sort((a, b) => a - b);
      return { p10: xs[Math.floor(xs.length * 0.1)] ?? null, median: xs[Math.floor(xs.length / 2)] ?? null, p90: xs[Math.floor(xs.length * 0.9)] ?? null };
    })(),
    models,
  };
}

const MARK = "<!-- generated by `node src/eval/mm1-cli.ts analyse`: edit above this line -->";

function analyse(): void {
  const revs = revisions();
  const gpu = readJsonl<{ set: string; wallSeconds: number; loadSeconds: number | null; embedded: number; seconds: Record<string, number>; dims: Record<string, number> | null }>(join(PRIV, "gpu.jsonl"));
  const sets = Object.fromEntries(MM1.sets.map((s) => [s, analyseSet(s)]));
  const timing = (s: string) => {
    const g = gpu.filter((x) => x.set === s);
    const n = g.reduce((a, x) => a + x.embedded, 0);
    const sec = (k: string) => g.reduce((a, x) => a + (x.seconds[k] ?? 0), 0);
    return { runs: g.length, embedded: n, wallSeconds: g.reduce((a, x) => a + x.wallSeconds, 0), msPerStrip: n ? { strip: r4((1000 * sec("strip")) / n), dinov2: r4((1000 * sec("dinov2")) / n), siglip2: r4((1000 * sec("siglip2")) / n) } : null };
  };
  const m = {
    runId: "MM1",
    card: "MM-1",
    note: "Aggregates only. Records, strips and vectors are private (data root, private/mm/). pilot-000 is machine agreement, never accuracy (INV-17); the yardstick is PROXY and evaluation only. Never pooled (OC35). No keep rule: nothing changes a decision.",
    appearance: appearanceMode([]),
    models: Object.fromEntries(MODELS.map((k) => [k, { repo: MM1.models[k].repo, revision: revs[k], input: MM1.models[k].input, licence: "Apache-2.0" }])),
    // The strip method without its `polygon` key: the evals allowlist refuses per-spine field names.
    strip: { method: MM1.strip.method, cutFrom: "detection rectangle", longSide: MM1.strip.longSide },
    bootstrap: { ...MM1.bootstrap, cluster: "photo" },
    gpuSeconds: gpu.reduce((a, x) => a + x.wallSeconds, 0),
    timing: Object.fromEntries(MM1.sets.map((s) => [s, timing(s)])),
    sets,
  };
  const out = join(REPO, "evals", "MM1");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "metrics.json"), compactJson(m) + "\n");
  const rp = join(out, "report.md");
  const text = existsSync(rp) ? readFileSync(rp, "utf8") : "# MM-1 · spine pixels and embeddings\n\n";
  const head = text.includes(MARK) ? text.slice(0, text.indexOf(MARK)) : text.trimEnd() + "\n\n";
  writeFileSync(rp, head + MARK + "\n\n" + tablesMd(m));
  log("analyse: evals/MM1/{metrics.json,report.md}");
}

type Tri = [number, number, number] | null;
const f3 = (t: Tri) => (t ? `${t[0].toFixed(3)} (${t[1].toFixed(3)}–${t[2].toFixed(3)})` : "–");
const pc = (t: Tri) => (t ? `${(100 * t[0]).toFixed(1)} % (${(100 * t[1]).toFixed(1)}–${(100 * t[2]).toFixed(1)})` : "–");

function tablesMd(m: { gpuSeconds: number; timing: Record<string, { embedded: number; msPerStrip: Record<string, number> | null }>; sets: Record<string, ReturnType<typeof analyseSet>> }): string {
  const out: string[] = [];
  out.push("## Records\n");
  out.push("| set | photos | records | valid strips | confirmed | works | copy/context conflicts | with a TS-0 label |\n|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const [s, v] of Object.entries(m.sets)) out.push(`| ${s} | ${v.photos} | ${v.records} | ${v.validStrips} | ${v.confirmed} | ${v.works} | ${v.conflicts} | ${v.withLedgerLabel} |`);
  out.push("\n| set | basis | records |\n|---|---|---:|");
  for (const [s, v] of Object.entries(m.sets)) for (const [k, n] of Object.entries(v.byBasis)) out.push(`| ${s} | ${k} | ${n} |`);
  out.push("\n| set | rung | records |\n|---|---|---:|");
  for (const [s, v] of Object.entries(m.sets)) for (const [k, n] of Object.entries(v.byRung)) out.push(`| ${s} | ${k} | ${n} |`);
  out.push("\nBasis by rung is in `metrics.json` (`byBasisRung`).\n");
  out.push("## Embeddings and timings\n");
  out.push("| set | model | dims | strips embedded | ms per strip | strip long side p10 / median / p90 (px) |\n|---|---|---:|---:|---:|---|");
  for (const [s, v] of Object.entries(m.sets)) {
    const t = m.timing[s]!;
    for (const k of MODELS) out.push(`| ${s} | ${k} | ${(v.models[k] as { dims: number }).dims} | ${t.embedded} | ${t.msPerStrip ? t.msPerStrip[k]!.toFixed(1) : "–"} | ${v.stripLongSide.p10} / ${v.stripLongSide.median} / ${v.stripLongSide.p90} |`);
  }
  out.push(`\nStrip cutting (CPU, shared by both models): ${Object.entries(m.timing).map(([s, t]) => `${s} ${t.msPerStrip ? t.msPerStrip.strip!.toFixed(1) : "–"} ms`).join(", ")} per strip. GPU wall time in all: ${Math.round(m.gpuSeconds)} s.\n`);
  out.push("## Label-free checks (95 % photo-cluster bootstrap)\n");
  for (const [s, v] of Object.entries(m.sets)) {
    out.push(`### ${s}${v.evaluationOnly ? " (PROXY, evaluation only)" : " (real use: machine labels, never accuracy)"}\n`);
    out.push("| measure | dinov2 | siglip2 |\n|---|---|---|");
    const row = (name: string, f: (x: any) => string) => out.push(`| ${name} | ${MODELS.map((k) => f(v.models[k])).join(" | ")} |`);
    row("pairs: copy / same-photo control", (x) => `${x.pairs.copy} / ${x.pairs.samePhoto}`);
    row("M1 AUC, confirmed-by-copy pair vs same-photo pair", (x) => f3(x.m1Copy.auc));
    row("M1 mean cosine, copy pairs", (x) => f3(x.m1Copy.meanCopy));
    row("M1 mean cosine, same-photo pairs", (x) => f3(x.m1Copy.meanSamePhoto));
    row("pairs: same work (both readers-agree) / different work", (x) => `${x.pairs.sameWorkText} / ${x.pairs.differentWork}`);
    row("M2 AUC, same work (text) vs different work", (x) => f3(x.m2TextSameWork.auc));
    row("pairs: same work, any basis (within one photo)", (x) => `${x.pairs.sameWork} (${x.sameWorkWithinPhoto})`);
    row("M3 median same-work cosine", (x) => f3(x.m3Lookalike.medianSameWork));
    row("**M3 visual lookalike rate**: different-work pairs nearer than it", (x) => pc(x.m3Lookalike.rate));
    row("M3 within one photo only", (x) => pc(x.m3Lookalike.rateWithinPhoto));
    out.push("");
  }
  return out.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, set] = process.argv.slice(2);
  const isSet = (s: string | undefined): s is MmSet => s === "pilot-000" || s === "yardstick";
  if (cmd === "analyse") analyse();
  else if (cmd === "embed" && isSet(set)) await embed(set);
  else if (cmd === "records" && isSet(set)) records(set);
  else {
    console.error("usage: mm1-cli.ts embed|records <pilot-000|yardstick> | analyse");
    process.exit(2);
  }
}
