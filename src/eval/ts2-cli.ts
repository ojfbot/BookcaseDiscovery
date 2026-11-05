// TS-2 runner: the distilled spine reader (evals/TS2/prereg.md).
//
//   node src/eval/ts2-cli.ts data             # CPU: strong-class train rows -> training crops (private/models/ts2/data/)
//   node src/eval/ts2-cli.ts train            # GPU (MLX): LoRA on the local Qwen3-VL-4B 8-bit -> private/models/ts2/adapter/
//   node src/eval/ts2-cli.ts read <set> [--free] [--dry-run]   # GPU (MLX): the student on the set's decision-relevant boxes
//   node src/eval/ts2-cli.ts analyse          # CPU: arms and measures -> evals/TS2/{metrics.json,report.md}
//   node src/eval/ts2-cli.ts register         # CPU: models/registry/ts2-spine-reader.json (no path, private-only)
//
// <set> is pilot-000 (its val photos only) or yardstick. Every crop, reading and per-box record stays under the data
// root (private/models/ts2/, private/ts2/<set>/); only aggregates reach evals/TS2/. Each GPU step first checks that
// no other mlx, torch or qwen job runs, and logs its minutes to private/ts2/gpu.jsonl. No profile input (INV-13).
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { catalogPaths, openCatalog } from "../catalog/cli.ts";
import { retrieve, scoreWorks, type Candidate } from "../catalog/retrieve.ts";
import { dataRoot, ImageStore } from "../ledger/images.ts";
import { cropFor, F0_CROP } from "../perceive/crop.ts";
import { loadReadings, readJsonl, topFor, variantsOf, type Detection, type Reading, type ReaderName } from "./f0.ts";
import { compactJson, yardstickTruth } from "./q1-cli.ts";
import { loadBoxSet } from "./rb1.ts";
import { contentHash, LabelRow, sha256 } from "./ts0.ts";
import {
  agreement,
  armAccept,
  armMeasures,
  ARMS,
  BAR,
  decisionRelevant,
  keeps,
  secondsPerCrop,
  steerCandidates,
  studentConfirms,
  targetText,
  trainRows,
  bestRotation,
  TS2,
  type AgreeRow,
  type ArmRow,
  type BaseBox,
  type StudentVote,
} from "./ts2.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const ROOT = dataRoot();
const HELPER = join(REPO, "helpers", "train");
const MODELS = join(ROOT, "private", "models", "ts2");
const DATA = join(MODELS, "data");
const ADAPTER = join(MODELS, "adapter");
const PRIV = join(ROOT, "private", "ts2");
const GPU_LOG = join(PRIV, "gpu.jsonl");
const LEDGER = join(ROOT, "datasets", "label-ledger");
const log = (s: string): void => console.error(`[ts2] ${new Date().toISOString().slice(11, 19)} ${s}`);
const r4 = (x: number) => Math.round(x * 10000) / 10000;

type SetName = "pilot-000" | "yardstick";
/** Each set's cached F-0 stage (detections, readings), H-2's base decisions and catalog, as H-2 and F-0b read them. */
const SETS: Record<SetName, { stage: string; decisions: string; catalog: () => string; image: (id: string) => string }> = {
  "pilot-000": {
    stage: join(ROOT, "f0e", "pilot-000", "bands+strips"),
    decisions: join(ROOT, "private", "h2", "pilot-000", "base-decisions.jsonl"),
    catalog: () => catalogPaths().catalog,
    image: (id) => {
      const p = new ImageStore(ROOT).find(id);
      if (!p) throw new Error("a pilot-000 working copy is missing from the image store");
      return p;
    },
  },
  yardstick: {
    stage: join(ROOT, "f0", "yardstick-library-b2"),
    decisions: join(ROOT, "private", "h2", "yardstick-library-b2", "base-decisions.jsonl"),
    catalog: () => join(ROOT, "proxy", "library-dataset", "f0-inventory-catalog.sqlite"),
    image: (id) => join(ROOT, "proxy", "library-dataset", "images", `${id}.jpg`),
  },
};
const isSet = (s: string | undefined): s is SetName => s === "pilot-000" || s === "yardstick";

function python(): string {
  const p = join(HELPER, ".venv", "bin", "python");
  if (!existsSync(p)) throw new Error("helpers/train has no .venv: run `uv sync` there first");
  return p;
}

// --- shared inputs ------------------------------------------------------------------------------------------

function ledgerRows(): LabelRow[] {
  const { version } = JSON.parse(readFileSync(join(LEDGER, "latest.json"), "utf8")) as { version: string };
  if (version !== TS2.ledgerVersion) throw new Error(`TS-2 was pre-registered on ${TS2.ledgerVersion}; latest.json names ${version}`);
  return readFileSync(join(LEDGER, version, "labels.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => LabelRow.parse(JSON.parse(l)));
}

function frozenSplits(): Map<string, string> {
  const s = JSON.parse(readFileSync(join(LEDGER, "splits.json"), "utf8")) as { photos: Record<string, string> };
  return new Map(Object.entries(s.photos));
}

function baseBoxes(set: SetName): BaseBox[] {
  const box = loadBoxSet(set);
  return readJsonl<{ id: string; imageId: string; confirmed: BaseBox["confirmed"]; readText: BaseBox["readText"]; accepted: { workId: string } | null }>(SETS[set].decisions)
    .filter((d) => box.keeps(d.id))
    .map((d) => ({ id: d.id, imageId: d.imageId, confirmed: d.confirmed, readText: d.readText, accepted: d.accepted?.workId ?? null }));
}

const loadDets = (set: SetName): Map<string, Detection> =>
  new Map(readJsonl<Detection>(join(SETS[set].stage, "detect.jsonl")).filter((d) => !d.error).map((d) => [d.id, d]));

const splitId = (id: string): [string, number] => {
  const k = id.lastIndexOf(":");
  return [id.slice(0, k), Number(id.slice(k + 1))];
};

/** The boxes the student reads on a set (prereg): decision-relevant boxes; on pilot-000, val photos only, plus val labels' boxes. */
function readSet(set: SetName): Set<string> {
  const boxes = baseBoxes(set);
  if (set === "yardstick") return new Set(boxes.filter(decisionRelevant).map((b) => b.id));
  const splits = frozenSplits();
  const val = (img: string) => splits.get(img) === "val";
  const ids = new Set(boxes.filter((b) => val(b.imageId) && decisionRelevant(b)).map((b) => b.id));
  for (const r of ledgerRows()) if (r.split === "val") ids.add(r.boxId);
  for (const id of ids) if (!val(splitId(id)[0])) throw new Error("TS-2: a train photo's box is in the eval read set");
  return ids;
}

// --- GPU discipline -----------------------------------------------------------------------------------------

/** OC: one GPU job at a time. Throws when another mlx, torch or qwen process is running. */
function assertGpuFree(): void {
  const r = spawnSync("pgrep", ["-fl", "mlx|torch|qwen"], { encoding: "utf8" });
  const others = (r.stdout ?? "").split("\n").filter((l) => l.trim());
  if (others.length > 0) throw new Error(`${others.length} other mlx/torch/qwen process(es) running: wait for the GPU lane`);
}

function gpuMinutes(): number {
  return readJsonl<{ seconds: number }>(GPU_LOG).reduce((s, x) => s + x.seconds, 0) / 60;
}

function spendable(step: string): void {
  const used = gpuMinutes();
  if (used >= TS2.gpuBudgetMin) throw new Error(`GPU budget spent (${used.toFixed(1)} of ${TS2.gpuBudgetMin} min) before ${step}`);
  log(`GPU so far ${used.toFixed(1)} of ${TS2.gpuBudgetMin} min`);
}

function logGpu(step: string, t0: number, extra: Record<string, unknown> = {}): void {
  mkdirSync(PRIV, { recursive: true });
  appendFileSync(GPU_LOG, `${JSON.stringify({ step, seconds: Math.round((Date.now() - t0) / 100) / 10, ...extra })}\n`);
}

/** Run the student helper with JSONL on stdin; stdout lines append to `out`; only `read:`/`crops:` progress is logged. */
function runHelper(args: string[], requests: object[], out: string | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(python(), ["-I", join(HELPER, "read_student.py"), ...args], { stdio: ["pipe", "pipe", "pipe"], cwd: HELPER });
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      if (out && line.trim()) appendFileSync(out, `${line}\n`);
    });
    let tail = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c: string) => {
      tail = (tail + c).slice(-2000);
      for (const l of c.split("\n")) if (/^(read|crops):/.test(l)) log(l);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(requests.map((r) => `${JSON.stringify(r)}\n`).join(""));
    child.once("error", reject);
    child.once("close", (code) => (code === 0 ? resolve() : reject(new Error(`read_student.py exited ${code}: ${tail.split("\n").filter((l) => /Error|error/.test(l)).slice(-2).join(" | ").slice(0, 300)}`))));
  });
}

// --- data: the training crops -------------------------------------------------------------------------------

async function data(): Promise<void> {
  const all = ledgerRows();
  const { rows, excluded } = trainRows(all);
  const readings = loadReadings(SETS["pilot-000"].stage);
  const db = openCatalog(SETS["pilot-000"].catalog());
  const reqs: { image: string; polygon: [number, number][]; rotation: number; target: string }[] = [];
  const keys: string[] = [];
  let noRotation = 0;
  for (const r of rows) {
    const c = cropFor({ polygon: r.polygon }, { width: 0, height: 0 }, F0_CROP)!;
    if (c.crop !== r.crop) throw new Error(`TS-2: ledger crop ${r.crop} is not F-0's original crop`);
    const reads = readings.get(r.boxId) ?? {};
    const scores = c.rotations.map((rotation) => {
      const texts = r.readers.flatMap((rd) => (reads[rd]?.variants ?? []).filter((v) => v.rotation === rotation).map((v) => v.text.replace(/\s+/g, " ").trim()).filter((t) => t.length >= 2));
      return { rotation, score: texts.length ? (scoreWorks(db, texts, [r.workId]).get(r.workId)?.score ?? 0) : 0 };
    });
    const rotation = bestRotation(scores);
    if (rotation === null) {
      noRotation++;
      continue;
    }
    const target = targetText(r);
    reqs.push({ image: join(ROOT, r.path), polygon: c.polygon, rotation, target });
    keys.push(`${r.boxId}|${rotation}|${target}`);
  }
  db.close();
  mkdirSync(DATA, { recursive: true });
  writeFileSync(join(DATA, "train.jsonl"), "");
  await runHelper(["crops", "--out", DATA], reqs, null);
  const summary = {
    ledgerVersion: TS2.ledgerVersion,
    ledgerLabels: all.length,
    trainRows: rows.length,
    trained: reqs.length,
    droppedNoRotation: noRotation,
    excluded,
    photos: new Set(rows.map((r) => r.imageSha256)).size,
    byPair: Object.fromEntries([...new Set(rows.map((r) => r.agreeing ?? "one"))].sort().map((k) => [k, rows.filter((r) => (r.agreeing ?? "one") === k).length])),
    rotations: Object.fromEntries([90, 270].map((rot) => [rot, reqs.filter((q) => q.rotation === rot).length])),
    trainingSetHash: sha256(keys.sort().join("\n")),
  };
  writeFileSync(join(DATA, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  log(`data: ${reqs.length} training crops from ${rows.length} strong train rows (${noRotation} without a scored rotation)`);
}

// --- train --------------------------------------------------------------------------------------------------

async function train(): Promise<void> {
  assertGpuFree();
  spendable("train");
  if (!existsSync(join(DATA, "train.jsonl"))) throw new Error("no training data: run `ts2-cli.ts data` first");
  const L = TS2.lora;
  const args = [
    "-I", "-m", "mlx_vlm.train",
    "--model", join(ROOT, "models", TS2.base.dir),
    "--data", DATA,
    "--train-type", "lora",
    "--lora-rank", String(L.rank),
    "--lora-alpha", String(L.alpha),
    "--lora-dropout", String(L.dropout),
    "--learning-rate", String(L.learningRate),
    "--optimizer", "adam",
    "--epochs", String(L.epochs),
    "--batch-size", String(L.batchSize),
    "--seed", String(L.seed),
    "--max-seq-length", String(L.maxSeqLength),
    L.trainOnCompletions ? "--train-on-completions" : "--no-train-on-completions",
    "--steps-per-report", "25",
    "--steps-per-save", "1000000",
    "--output-path", ADAPTER,
  ];
  mkdirSync(ADAPTER, { recursive: true });
  const t0 = Date.now();
  const logPath = join(MODELS, "train.log");
  writeFileSync(logPath, "");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(python(), args, { stdio: ["ignore", "pipe", "pipe"], cwd: HELPER });
    const sink = (c: Buffer) => {
      appendFileSync(logPath, c);
      // Loss lines only; the full log stays under the data root.
      for (const l of c.toString("utf8").split("\n")) if (/loss/i.test(l)) log(`train: ${l.trim().slice(0, 120)}`);
    };
    child.stdout.on("data", sink);
    child.stderr.on("data", sink);
    child.once("error", reject);
    child.once("close", (code) => (code === 0 ? resolve() : reject(new Error(`mlx_vlm.train exited ${code} (log under the data root's private/models/ts2/)`))));
  }).finally(() => logGpu("train", t0));
  log(`train: adapter written under the data root's private/models/ts2/adapter/ in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}

// --- read: the student on a set's read set ------------------------------------------------------------------

const outPath = (set: SetName, free: boolean) => join(PRIV, set, `student-${free ? "free" : "steered"}.jsonl`);

async function read(set: SetName, free: boolean, dryRun: boolean): Promise<void> {
  if (!dryRun) {
    assertGpuFree();
    spendable(`read ${set}${free ? " free" : ""}`);
    if (free && TS2.gpuBudgetMin - gpuMinutes() < TS2.ablationFloor) throw new Error(`fewer than ${TS2.ablationFloor} GPU-minutes left: the free-decoding arm does not run (prereg)`);
    if (!existsSync(join(ADAPTER, "adapters.safetensors"))) throw new Error("no adapter: run `ts2-cli.ts train` first");
  }
  const ids = readSet(set);
  const dets = loadDets(set);
  const readings = loadReadings(SETS[set].stage);
  const db = openCatalog(SETS[set].catalog());
  const out = outPath(set, free);
  mkdirSync(join(PRIV, set), { recursive: true });
  const done = new Set(readJsonl<{ id: string; error?: string }>(out).filter((r) => !r.error).map((r) => r.id));
  const ranked = new Map<string, Candidate[]>();
  const rank = (r: Reading | undefined): Candidate[] => {
    const v = variantsOf(r);
    if (!v.length) return [];
    const k = v.join("\u0000");
    if (!ranked.has(k)) ranked.set(k, retrieve(db, v, TS2.steer.k));
    return ranked.get(k)!;
  };
  const reqs = [...ids]
    .filter((id) => !done.has(id))
    .sort()
    .flatMap((id) => {
      const [img, i] = splitId(id);
      const det = dets.get(img);
      const s = det?.spines[i];
      if (!det || !s) return [];
      const c = cropFor(s, det, F0_CROP);
      if (!c) return [];
      const cands = free ? [] : steerCandidates(TS2.steer.from.map((rd) => rank(readings.get(id)?.[rd]))).map(targetText);
      return [{ id, image: SETS[set].image(img), polygon: c.polygon, rotations: c.rotations, candidates: cands }];
    });
  db.close();
  log(`read ${set} (${free ? "free" : "steered"}): ${reqs.length} boxes to read, ${done.size} cached, ${reqs.filter((r) => r.candidates.length).length} with steering candidates`);
  if (dryRun) return;
  const t0 = Date.now();
  await runHelper(["read", "--adapter", ADAPTER, ...(free ? ["--free"] : [])], reqs, out).finally(() => logGpu(`read:${set}:${free ? "free" : "steered"}`, t0, { boxes: reqs.length }));
}

// --- analyse ------------------------------------------------------------------------------------------------

interface StudentRead {
  id: string;
  variants: { rotation: number; text: string; confidence: number }[];
  steered?: boolean[];
  seconds: number;
  error?: string;
}

function studentVotes(set: SetName, free: boolean, db: DatabaseSync): { votes: Map<string, StudentVote>; seconds: number[]; steeredShare: number | null; errors: number } {
  const rows = readJsonl<StudentRead>(outPath(set, free));
  const cache = new Map<string, Candidate | undefined>();
  const votes = new Map<string, StudentVote>();
  const seconds: number[] = [];
  let steered = 0, variants = 0, errors = 0;
  for (const r of rows) {
    if (r.error) {
      errors++;
      continue;
    }
    const reading: Reading = { id: r.id, reader: "qwen", variants: r.variants, seconds: r.seconds };
    votes.set(r.id, { confirmed: studentConfirms(topFor(db, reading, cache)), readText: variantsOf(reading).length > 0 });
    seconds.push(r.seconds);
    for (const s of r.steered ?? []) (variants++, s && steered++);
  }
  return { votes, seconds, steeredShare: variants ? steered / variants : null, errors };
}

/** Each kept box under the three arms, the student's vote taken from `free` or steered reads. */
function armRows(set: SetName, votes: Map<string, StudentVote>, only?: (b: BaseBox) => boolean): ArmRow[] {
  const replacedRead = new Set(readJsonl<{ id: string }>(join(SETS[set].stage, `${TS2.replaces}.jsonl`)).map((r) => r.id));
  const truth = set === "yardstick" ? yardstickTruth() : null;
  return baseBoxes(set)
    .filter((b) => !only || only(b))
    .map((b) => {
      const s = votes.get(b.id);
      const accepted = Object.fromEntries(ARMS.map((a) => [a, a === "base" ? b.accepted : armAccept(a, b, s, replacedRead.has(b.id))])) as ArmRow["accepted"];
      return { id: b.id, imageId: b.imageId, accepted, ...(truth ? { truth: truth.get(b.imageId) ?? new Set<string>() } : {}) };
    });
}

/** Seconds a crop of each cached reader on a set's read set. */
function readerSeconds(set: SetName, ids: Set<string>) {
  const out: Record<string, unknown> = {};
  for (const rd of ["vision", "ppocr", "qwen"] as ReaderName[]) {
    const xs = readJsonl<{ id: string; seconds: number; error?: string }>(join(SETS[set].stage, `${rd}.jsonl`)).filter((r) => !r.error && ids.has(r.id)).map((r) => r.seconds);
    out[rd] = { n: xs.length, secondsPerCrop: tri(secondsPerCrop(xs)) };
  }
  return out;
}

const tri = (t: { value: number; lo: number; hi: number } | null | undefined) => (t ? [r4(t.value), r4(t.lo), r4(t.hi)] : null);
const triAll = (m: ReturnType<typeof armMeasures>) =>
  Object.fromEntries(
    Object.entries(m).map(([k, v]) => [k, v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([kk, vv]) => [kk, vv && typeof vv === "object" && "lo" in (vv as object) ? tri(vv as never) : vv])) : v]),
  );

function analyse(): void {
  const metrics: Record<string, unknown> = { card: "TS-2", prereg: "evals/TS2/prereg.md", ledgerVersion: TS2.ledgerVersion, bar: BAR, constants: { lora: TS2.lora, decode: TS2.decode, steer: { k: TS2.steer.k, bias: TS2.steer.bias, from: TS2.steer.from }, replaces: TS2.replaces } };
  const summaryPath = join(DATA, "summary.json");
  if (existsSync(summaryPath)) {
    const s = JSON.parse(readFileSync(summaryPath, "utf8"));
    metrics.training = { trainRows: s.trainRows, trained: s.trained, droppedNoRotation: s.droppedNoRotation, excluded: s.excluded, photos: s.photos, byPair: s.byPair, rotations: s.rotations };
  }
  const verdict: Record<string, unknown> = {};
  // Yardstick (PROXY): the keep rule's set.
  {
    const db = openCatalog(SETS.yardstick.catalog());
    const ids = readSet("yardstick");
    const yard: Record<string, unknown> = { scope: "PROXY (library shelves): evaluation only", readSet: ids.size, readers: readerSeconds("yardstick", ids) };
    for (const free of [false, true]) {
      if (!existsSync(outPath("yardstick", free))) continue;
      const sv = studentVotes("yardstick", free, db);
      const m = armMeasures(armRows("yardstick", sv.votes));
      const arm = free ? "free" : "steered";
      yard[arm] = { read: sv.votes.size, errors: sv.errors, steeredOutputShare: sv.steeredShare === null ? null : r4(sv.steeredShare), secondsPerCrop: tri(secondsPerCrop(sv.seconds)), arms: triAll(m), keep: { fourth: keeps(m, "fourth"), replace: keeps(m, "replace") } };
      if (!free) verdict.yardstick = { fourth: keeps(m, "fourth").keep, replace: keeps(m, "replace").keep };
    }
    db.close();
    metrics.yardstick = yard;
  }
  // pilot-000 val: machine agreement (INV-17).
  {
    const db = openCatalog(SETS["pilot-000"].catalog());
    const ids = readSet("pilot-000");
    const splits = frozenSplits();
    const pilot: Record<string, unknown> = { scope: "real use, val split: machine agreement with the confirmed work, never accuracy (INV-17)", readSet: ids.size, readers: readerSeconds("pilot-000", ids) };
    if (existsSync(outPath("pilot-000", false))) {
      const sv = studentVotes("pilot-000", false, db);
      const labels = ledgerRows().filter((r) => r.split === "val");
      const agree: AgreeRow[] = labels.map((l) => ({ imageId: l.imageSha256, workId: l.workId, strong: l.strong, student: sv.votes.get(l.boxId)?.confirmed ?? null, read: sv.votes.has(l.boxId) }));
      const ag = agreement(agree);
      const m = armMeasures(armRows("pilot-000", sv.votes, (b) => splits.get(b.imageId) === "val"));
      pilot.steered = {
        read: sv.votes.size,
        errors: sv.errors,
        steeredOutputShare: sv.steeredShare === null ? null : r4(sv.steeredShare),
        secondsPerCrop: tri(secondsPerCrop(sv.seconds)),
        agreement: { all: { ...ag.all, share: tri(ag.all.share) }, strong: { ...ag.strong, share: tri(ag.strong.share) } },
        // Machine agreement only: "confirmed" here is every accept (no truth on real use).
        arms: triAll(m),
      };
    }
    db.close();
    metrics["pilot-000"] = pilot;
  }
  metrics.gpu = {
    minutes: r4(gpuMinutes()),
    budget: TS2.gpuBudgetMin,
    bySteps: Object.fromEntries(Array.from(readJsonl<{ step: string; seconds: number }>(GPU_LOG).reduce((m, x) => m.set(x.step, (m.get(x.step) ?? 0) + x.seconds / 60), new Map<string, number>()), ([k, v]) => [k, r4(v)])),
  };
  metrics.verdict = verdict;
  const dir = join(REPO, "evals", "TS2");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "metrics.json"), `${compactJson(metrics)}\n`);
  const rp = join(dir, "report.md");
  const MARK = "<!-- generated by src/eval/ts2-cli.ts analyse: edit above this line -->";
  const head = existsSync(rp) ? readFileSync(rp, "utf8").split(MARK)[0]! : "# TS-2 · distilled spine reader\n\n";
  writeFileSync(rp, `${head}${MARK}\n\n${tables(metrics)}`);
  log("analyse: evals/TS2/{metrics.json,report.md}");
}

// --- report tables ------------------------------------------------------------------------------------------

const ci = (t: unknown, dp = 1, scale = 1): string => {
  if (!Array.isArray(t)) return "–";
  const [v, lo, hi] = (t as number[]).map((x) => (x * scale).toFixed(dp));
  return `${v} (${lo} to ${hi})`;
};

function armTable(a: any, conf: string, wrong: string): string[] {
  const out = [`| arm | accepted | ${conf} | ${wrong} | Δ ${conf} (95 %) | Δ ${wrong} (95 %) | gained | lost | changed |`, "|---|---|---|---|---|---|---|---|---|"];
  for (const arm of ARMS) {
    const x = a[arm];
    out.push(`| ${arm} | ${x.accepted} | ${x.confirmed} | ${x.wrong} | ${arm === "base" ? "–" : ci(x.deltaConfirmed, 0)} | ${arm === "base" ? "–" : ci(x.deltaWrong, 0)} | ${x.gained ?? "–"} | ${x.lost ?? "–"} | ${x.changed ?? "–"} |`);
  }
  return out;
}

function tables(m: any): string {
  const out: string[] = [];
  const y = m.yardstick;
  out.push("## Yardstick (PROXY, library shelves; evaluation only)", "", `Student read set: ${y.readSet} decision-relevant boxes.`, "");
  for (const arm of ["steered", "free"]) {
    const s = y[arm];
    if (!s) {
      out.push(`### ${arm === "steered" ? "Steered student (pre-registered)" : "Free-decoding student (exploratory)"}`, "", "Not run.", "");
      continue;
    }
    out.push(`### ${arm === "steered" ? "Steered student (pre-registered)" : "Free-decoding student (exploratory)"}`, "", `Read ${s.read} boxes (${s.errors} errors); output exactly a candidate on ${s.steeredOutputShare === null ? "–" : `${(s.steeredOutputShare * 100).toFixed(1)} %`} of rotations.`, "");
    out.push(...armTable(s.arms, "confirmed", "wrong"), "");
    out.push(`Keep rule: fourth reader **${s.keep.fourth.keep ? "kept" : "not kept"}** (confirmed up: ${s.keep.fourth.confirmedUp}; wrong not up: ${s.keep.fourth.wrongNotUp}); replacing ${m.constants.replaces} **${s.keep.replace.keep ? "kept" : "not kept"}** (confirmed up: ${s.keep.replace.confirmedUp}; wrong not up: ${s.keep.replace.wrongNotUp}).`, "");
  }
  const p = m["pilot-000"];
  out.push("## `pilot-000` val (machine agreement, never accuracy)", "", `Student read set: ${p.readSet} boxes on the val photos.`, "");
  if (!p.steered) out.push("Not run.", "");
  else {
    const g = p.steered.agreement;
    out.push("| val labels | labels | photos | student confirms the label's work | another work | nothing | agreement (95 %) |", "|---|---|---|---|---|---|---|");
    for (const k of ["all", "strong"]) out.push(`| ${k} | ${g[k].labels} | ${g[k].photos} | ${g[k].agree} | ${g[k].otherWork} | ${g[k].noConfirm} | ${ci(g[k].share, 1, 100)} % |`);
    out.push("", "Arms on the val photos (every accept is machine agreement; no truth):", "", ...armTable(p.steered.arms, "accepted†", "–"), "", "† On real use the table's \"confirmed\" column counts every accept and \"wrong\" is always 0.", "");
  }
  out.push("## Speed (seconds a crop, both rotations; mean, 95 % interval over crops)", "", "| set | student (steered) | student (free) | Vision | PP-OCR | Qwen |", "|---|---|---|---|---|---|");
  for (const [set, s] of [["yardstick", y], ["pilot-000 val", p]] as [string, any][])
    out.push(`| ${set} | ${ci(s.steered?.secondsPerCrop, 2)} | ${ci(s.free?.secondsPerCrop, 2)} | ${ci(s.readers.vision.secondsPerCrop, 2)} | ${ci(s.readers.ppocr.secondsPerCrop, 2)} | ${ci(s.readers.qwen.secondsPerCrop, 2)} (n ${s.readers.qwen.n}) |`);
  out.push("", `GPU: ${m.gpu.minutes.toFixed(1)} of ${m.gpu.budget} min (${Object.entries(m.gpu.bySteps).map(([k, v]) => `${k} ${(v as number).toFixed(1)}`).join(", ")}).`, "");
  return out.join("\n");
}

// --- register: the weights registry record ------------------------------------------------------------------

function register(): void {
  const meta = join(ROOT, "models", TS2.base.dir, ".cache", "huggingface", "download", "model.safetensors.metadata");
  const baseRevision = existsSync(meta) ? readFileSync(meta, "utf8").split("\n")[0]!.trim() : null;
  const adapter = join(ADAPTER, "adapters.safetensors");
  const summary = existsSync(join(DATA, "summary.json")) ? JSON.parse(readFileSync(join(DATA, "summary.json"), "utf8")) : null;
  const record = {
    name: "ts2-spine-reader",
    card: "TS-2",
    kind: "lora-adapter",
    base: { name: TS2.base.name, repo: "mlx-community/Qwen3-VL-4B-Instruct-8bit", revision: baseRevision, licence: "Apache-2.0" },
    trainer: { library: "mlx-vlm", version: "0.7.11" },
    ledger: { dataset: "label-ledger", version: TS2.ledgerVersion, class: "strong", split: "train", trainingSetHash: summary?.trainingSetHash ?? null, examples: summary?.trained ?? null },
    hyperparameters: TS2.lora,
    adapterSha256: existsSync(adapter) ? sha256(readFileSync(adapter)) : null,
    release: {
      status: "private-only",
      gates: { "G-W": "not eligible", "G-PUB": "not eligible" },
      why: "Trained on labels where Apple Vision is in the agreeing pair; Vision's output stays private. Nothing is uploaded anywhere.",
    },
    evals: "evals/TS2/report.md",
  };
  const dir = join(REPO, "models", "registry");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "ts2-spine-reader.json"), `${JSON.stringify(record, null, 2)}\n`);
  log(`register: models/registry/ts2-spine-reader.json (record hash ${contentHash(record).slice(0, 12)})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, set] = process.argv.slice(2);
  const free = process.argv.includes("--free");
  const run = async () => {
    if (cmd === "data") await data();
    else if (cmd === "train") await train();
    else if (cmd === "read" && isSet(set)) await read(set, free, process.argv.includes("--dry-run"));
    else if (cmd === "analyse") analyse();
    else if (cmd === "register") register();
    else {
      console.error("usage: ts2-cli.ts data | train | read <pilot-000|yardstick> [--free] [--dry-run] | analyse | register");
      process.exit(2);
    }
  };
  run().catch((e) => {
    console.error(`[ts2] ${(e as Error).message}`);
    process.exit(1);
  });
}
