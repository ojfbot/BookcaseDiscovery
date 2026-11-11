// F-0 runner. `node src/eval/f0-cli.ts pilot|yardstick|publish [--limit n] [--qwen-cap n] [--run-id id]`.
// pilot: machine-labels a fixture session from the ledger (real use; machine agreement, never accuracy). --session takes
// any session declared in src/eval/set-roles.ts (NS-K2; default pilot-000).
// yardstick: runs the same pipeline on the Library Dataset (PROXY) and scores titles against its own labels.
// Private outputs go under $BOOKCASE_DATA; only aggregates are written to evals/<run-id>/.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { buildCatalog } from "../catalog/build.ts";
import { catalogPaths, openCatalog } from "../catalog/cli.ts";
import { createSchema } from "../catalog/isfdb-staging.ts";
import { normalize, surnameFirstToGivenFirst } from "../catalog/normalize.ts";
import type { Candidate } from "../catalog/retrieve.ts";
import { dataRoot, ImageStore } from "../ledger/images.ts";
import { cropName } from "../perceive/crop.ts";
import {
  ACCEPT,
  buildLabelSet,
  decide,
  detectStage,
  probeStage,
  loadReadings,
  machineAgreement,
  pyReaderStage,
  readJsonl,
  CROP,
  stackFor,
  stageDir,
  visionStage,
  ARMS,
  ARM_NAMES,
  CASE_TILING,
  SHELF_TILING,
  type Arm,
  type Tiling,
  type Detection,
  type InputImage,
  type SpineDecision,
} from "./f0.ts";
import { kinds, type BoxKind } from "./f0c.ts";
import { acceptSet, samplePart, sessionImages, setPaths } from "./set-paths.ts";
import { evidenceOf, type BoxEvidence } from "./f0f.ts";
import { applyNb3, NB3_SHIP, type NB3Evidence } from "./nb3.ts";
import { depthStage } from "./nb3-stage.ts";
import { LabelSet } from "./labels.ts";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const log = (s: string): void => console.error(`[f0] ${s}`);

async function pipeline(images: InputImage[], db: DatabaseSync, dir: string, qwenCap: number, arm: Arm = "b2", tiling: Tiling = CASE_TILING) {
  const dets = await detectStage(images, dir, log, arm, tiling);
  const probes = await probeStage(images, dir, log);
  // F-0c: boxes the not-a-book rules flag (shelf lips, rows of book ends, flat strips) are labelled so and never read.
  const flat = notABook(dets);
  const readable = new Set(images.flatMap((img) => (dets.get(img.id)?.spines ?? []).flatMap((_, i) => (flat(img.id, i).kind === "spine" ? [`${img.id}:${i}`] : []))));
  // Per-spine provenance (producer, readers, scores, catalog id or reason) is private: decisions.jsonl beside the stages.
  await visionStage(images, dets, dir, log, CROP, readable);
  log("ppocr: reading");
  await pyReaderStage("ppocr", images, dets, dir, log, readable);
  // F-0f: shelf labels and cards (genre strips, shelf-talkers, blank cards), from what Vision and PP-OCR read and the
  // pixel probe, are not-a-book too and never go to Qwen.
  const ocr = loadReadings(dir, CROP);
  const evidence = (imageId: string, ref: string) => {
    const r = ocr.get(`${imageId}:${ref.slice(1)}`);
    return r ? evidenceOf(r, probes.get(`${imageId}:${ref}`)) : undefined;
  };
  // NB-3: the shipped causes (on-lip, depth, pixel; evals/NB3) after F-0c's and F-0f's kinds, from the depth stage
  // and the version-2 pixel probe. Not-a-book here too, and never sent to Qwen.
  const needsDepth = NB3_SHIP["on-lip"] || NB3_SHIP.depth;
  const depth = needsDepth ? depthStage(images, dets, dir, dataRoot(), (id, i) => flat(id, i).kind === "spine", log) : new Map();
  const kindOf = notABook(dets, evidence, (imageId, i) => {
    const e = evidence(imageId, `s${i}`);
    const dp = depth.get(`${imageId}:${i}`);
    return { lip: dp?.lip ?? null, faces: dp?.faces ?? null, probe: probes.get(`${imageId}:s${i}`) ?? null, textFound: e ? e.textFound : true };
  });
  const cache = new Map<string, Candidate | undefined>();
  const decideAll = (): SpineDecision[] => {
    const readings = loadReadings(dir, CROP);
    return images.flatMap((img) =>
      (dets.get(img.id)?.spines ?? []).map((s, i) => {
        const id = `${img.id}:${i}`;
        return decide(db, id, img.id, s.boxScore, readings.get(id) ?? {}, cache);
      }),
    );
  };
  // Hard crops go to the local VLM, capped per image: the run's compute ceiling stands in for OC10's spend cap.
  const first = decideAll();
  const hard = new Set<string>();
  for (const img of images) {
    first
      .filter((d) => d.imageId === img.id && d.hard && kindOf(img.id, Number(d.id.slice(img.id.length + 1))).kind === "spine" && Object.values(d.readText).some(Boolean))
      .sort((a, b) => b.boxScore - a.boxScore)
      .slice(0, qwenCap)
      .forEach((d) => hard.add(d.id));
  }
  log(`qwen: ${hard.size} hard crops`);
  await pyReaderStage("qwen", images, dets, dir, log, hard);
  const decisions = decideAll();
  writeFileSync(join(dir, "decisions.jsonl"), decisions.map((d) => JSON.stringify({ ...d, accepted: d.accepted && { workId: d.accepted.workId, score: d.accepted.score, queryCoverage: d.accepted.queryCoverage } })).join("\n") + "\n");
  return { dets, decisions, readings: loadReadings(dir, CROP), hardSelected: hard.size, hardTotal: first.filter((d) => d.hard).length, kindOf };
}

/**
 * Each box's kind under the shipped rules: the not-a-book flags (evals/F0c, kept by its no-harm rule) and, given a
 * box's reader text and pixel probe, the shelf-label rules (evals/F0f, which removed no confirmed book). The cover
 * pass is off by default (it did not pass its keep rule), so no box is face-out here. Given NB-3's evidence, the
 * causes evals/NB3 shipped (`NB3_SHIP`) run after them.
 */
function notABook(dets: Map<string, Detection>, evidence?: (imageId: string, ref: string) => BoxEvidence | undefined, nb3?: (imageId: string, i: number) => NB3Evidence) {
  const by = new Map(
    [...dets].map(([id, d]) => {
      const k = kinds({ ...d, covers: [] }, evidence && ((ref) => evidence(id, ref)));
      return [id, nb3 && Object.values(NB3_SHIP).some(Boolean) ? applyNb3(k, d, (i) => nb3(id, i)) : k.spines] as const;
    }),
  );
  return (imageId: string, i: number): { kind: BoxKind; why: string } => by.get(imageId)?.[i] ?? { kind: "spine", why: "spine" };
}

/** Each run writes its part (aggregates only) under $BOOKCASE_DATA/f0/parts/; `publish` joins the parts into evals/F0/. */
function writeEval(part: string, metrics: object, report: string): string {
  const dir = join(dataRoot(), "f0", "parts");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${part}.json`), `${JSON.stringify(metrics, null, 2)}\n`);
  writeFileSync(join(dir, `${part}.md`), report);
  return dir;
}

function publish(runId: string): void {
  const dir = join(dataRoot(), "f0", "parts");
  const parts = ["yardstick-b1", "yardstick-b2", "yardstick-b3", "yardstick-b4", "pilot"].filter((p) => existsSync(join(dir, `${p}.json`)));
  const metrics = Object.fromEntries(parts.map((p) => [p, JSON.parse(readFileSync(join(dir, `${p}.json`), "utf8"))]));
  const out = join(REPO_ROOT, "evals", runId);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "metrics.json"), `${JSON.stringify({ runId, card: "F-0", ...metrics }, null, 2)}\n`);
  const intro = `# ${runId}: machine labelling (F-0)\n\nTwo scores, never merged (OC35, OC36): the **yardstick (PROXY)** scores the pipeline against labels it did not\nproduce; **\`pilot-000\` (real use)** reports machine agreement only. Method: \`docs/machine-labelling.md\`.\n\n`;
  const body = parts.map((p) => readFileSync(join(dir, `${p}.md`), "utf8").replace(/^# /, "## ").replace(/\n# /g, "\n## ")).join("\n");
  writeFileSync(join(out, "report.md"), intro + armsTable(metrics) + body);
  log(`published ${parts.join(" + ")} -> evals/${runId}/`);
}

// --- pilot (real use) --------------------------------------------------------------------------

function fixtureImages(root: string, session: string): InputImage[] {
  const ledger = new DatabaseSync(join(root, "ledger", `${session}.sqlite`), { readOnly: true });
  const rows = ledger.prepare("SELECT payload FROM events WHERE type = 'ImageAssetIngested' ORDER BY seq").all() as { payload: string }[];
  ledger.close();
  const store = new ImageStore(root);
  return rows
    .map((r) => JSON.parse(r.payload) as { sessionId: string; imageHash: string; workingCopyHash: string; setting: string })
    .filter((e) => e.sessionId === session)
    .map((e) => {
      const path = store.find(e.workingCopyHash);
      if (!path) throw new Error(`working copy missing from the image store: ${e.workingCopyHash.slice(0, 12)}`);
      return { id: e.workingCopyHash, photoHash: e.imageHash, path, setting: e.setting };
    });
}

async function pilot(session: string, limit: number, qwenCap: number, runId: string, dryRun = false): Promise<void> {
  // NS-K2: any declared session (a training source, or a held-out one, which is labelled to be measured and never
  // trained on); an undeclared name is refused before anything runs.
  acceptSet("F-0", session);
  const root = dataRoot();
  // A sample part (`<session>.every-<n>`) takes its session's ledger photos that its image list names, nothing else.
  const part = samplePart(session);
  const all = fixtureImages(root, part?.session ?? session);
  const sample = part ? new Set(sessionImages(session, root).map((i) => i.id)) : null;
  const images = (sample ? all.filter((i) => sample.has(i.id)) : all).slice(0, limit);
  // --dry-run (NS-K2): the photos the run would take, all found in the image store; no model loads, nothing is written.
  if (dryRun) {
    const cached = new Set(readJsonl<{ id: string; error?: string }>(join(setPaths(session, root).f0, "detect.jsonl")).filter((d) => !d.error).map((d) => d.id));
    log(`${session}: ${images.length} photos from the ledger, every working copy in the image store; ${images.filter((i) => cached.has(i.id)).length} already detected (dry run, nothing written)`);
    return;
  }
  const db = openCatalog(catalogPaths().catalog);
  const dir = stageDir(root, session);
  const t0 = Date.now();
  const { dets, decisions, readings, hardSelected, hardTotal, kindOf } = await pipeline(images, db, dir, qwenCap);
  const set = LabelSet.parse(buildLabelSet(session, images, dets, new Map(decisions.map((d) => [d.id, d])), kindOf));
  mkdirSync(join(root, "labels"), { recursive: true });
  writeFileSync(join(root, "labels", `${session}.machine.json`), `${JSON.stringify(set, null, 2)}\n`);
  const metrics = {
    runId,
    card: "F-0",
    session,
    scope: "real-use (OC35): machine agreement, never accuracy (INV-17); no V-6 taps exist",
    date: new Date().toLocaleDateString("en-CA"), // local date, as in the logs
    stack: stackFor("b2", "pilot"),
    accept: ACCEPT,
    cropMethod: cropName(CROP),
    tiling: CASE_TILING,
    qwenCapPerImage: qwenCap,
    hardSelection: { total: hardTotal, sentToQwen: hardSelected },
    wallSeconds: Math.round((Date.now() - t0) / 1000),
    ...machineAgreement(dets, decisions, readings),
  };
  // pilot-000's part keeps its name; another session's part is its own, so it never overwrites pilot-000's.
  const dir2 = writeEval(session === "pilot-000" ? "pilot" : `pilot-${session}`, metrics, pilotReport(metrics as unknown as PilotMetrics));
  log(`labels: ${set.photos.length} photos, ${decisions.length} spines -> $BOOKCASE_DATA/labels/${session}.machine.json`);
  log(`aggregates -> ${dir2}`);
}

type PilotMetrics = ReturnType<typeof machineAgreement> & { session: string; runId: string; date: string; qwenCapPerImage: number; hardSelection: { total: number; sentToQwen: number }; wallSeconds: number };

const pct = (x: number | null | undefined): string => (x === null || x === undefined ? "n/a" : `${(x * 100).toFixed(1)} %`);

function pilotReport(m: PilotMetrics): string {
  const r = m.readerAgreement;
  const rt = m.runtimeSeconds;
  return `# ${m.runId}: machine labels on \`${m.session}\` (F-0, real use)

Run ${m.date}. **Real-use data (OC35). Every figure is machine agreement, not accuracy (INV-17)**: no person checked
any of it, and no V-6 taps exist yet. Aggregates only; labels stay in \`$BOOKCASE_DATA/labels/${m.session}.machine.json\`.

Stack: one box producer (Grounding DINO base → SAM 2.1 base-plus, tiled). SAM 3 (B1) arrived mid-card and was run on
the yardstick only, so box agreement between two producers is unavailable here. Readers: Apple Vision, PP-OCRv5 server, and Qwen3-VL-4B (8-bit, local) on hard
crops only (at most ${m.qwenCapPerImage} per image). No paid calls: **spend per spine $0**.

| | value |
|---|---:|
| images | ${m.images} |
| spine boxes | ${m.spineCount} (per image p50 ${m.spinesPerImage.p50}, min ${m.spinesPerImage.min}, max ${m.spinesPerImage.max}) |
| box score p10 / p50 / p90 | ${m.boxScore.p10} / ${m.boxScore.p50} / ${m.boxScore.p90} |
| **catalog-confirmed share** (≥ 2 readers name one ISFDB work that passes the bar) | **${pct(m.catalogConfirmed.share)}** (${m.catalogConfirmed.count}) |
| confirmed by 2 / by 3 readers | ${m.agreeingReaders.two} / ${m.agreeingReaders.three} |
| **gap share** (band length covered by no box, gaps ≥ ½ median spine width) | **${pct(m.gaps.gapShare)}** (${m.gaps.gapCount} gaps) |
| hard crops (OCR readers not agreed) / sent to Qwen | ${m.hardSelection.total} / ${m.hardSelection.sentToQwen} |
| accepted with Qwen among the agreeing readers | ${m.hardCrops.acceptedAfterQwen} |

**Unknown, by reason:** ${Object.entries(m.unknownByReason).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}.

**Reader agreement** (spines where both readers' top candidate passed the catalog bar; share naming the same work):

| pair | read by both | both confirmed a work | same work |
|---|---:|---:|---:|
| Vision vs PP-OCR | ${r.visionPpocr.spinesReadByBoth} | ${r.visionPpocr.bothConfirmedSomething} | ${r.visionPpocr.sameWork} (${pct(r.visionPpocr.sameWorkShare)}) |
| Vision vs Qwen (OCR vs VLM) | ${r.visionQwen.spinesReadByBoth} | ${r.visionQwen.bothConfirmedSomething} | ${r.visionQwen.sameWork} (${pct(r.visionQwen.sameWorkShare)}) |
| PP-OCR vs Qwen (OCR vs VLM) | ${r.ppocrQwen.spinesReadByBoth} | ${r.ppocrQwen.bothConfirmedSomething} | ${r.ppocrQwen.sameWork} (${pct(r.ppocrQwen.sameWorkShare)}) |

Per reader, spines whose top candidate passed the bar: ${Object.entries(m.perReaderConfirmed).map(([k, v]) => `${k} ${v.confirmed}/${v.read}`).join(", ")}.

**Runtime** (one Mac, M-series, 48 GB): detection p50 ${rt.detectPerImage.p50} s per image (max ${rt.detectPerImage.max}, total ${rt.detectPerImage.total} s);
Vision ${rt.vision.total} s for ${rt.vision.cropCount} crops; PP-OCR ${rt.ppocr.total} s for ${rt.ppocr.cropCount} crops (p50 ${rt.ppocr.perCropP50} s);
Qwen ${rt.qwen.total} s for ${rt.qwen.cropCount} crops (p50 ${rt.qwen.perCropP50} s). Wall clock for this invocation ${m.wallSeconds} s (cached stages are not re-run).
`;
}

// --- yardstick (PROXY): Library Dataset titles ----------------------------------------------------

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(field), (field = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field), rows.push(row), (row = []), (field = "");
    } else field += ch;
  }
  if (field !== "" || row.length) row.push(field), rows.push(row);
  return rows.filter((r) => r.length > 1);
}

const records = (path: string): Record<string, string>[] => {
  const [head, ...rows] = parseCsv(readFileSync(path, "utf8"));
  return rows.map((r) => Object.fromEntries(head!.map((h, i) => [h, r[i] ?? ""])));
};

const cleanTitle = (t: string): string => t.replace(/\s+:\s+/g, ": ").replace(/\s+/g, " ").trim();
/** "Bunge, Mario, 1919-2020" -> "Mario Bunge". */
const cleanAuthor = (a: string): string =>
  surnameFirstToGivenFirst(a.replace(/,\s*(\d{4}-?(\d{4})?|\(.*\))\s*$/, "").replace(/\s+/g, " ").trim());

/**
 * The yardstick's closed-set catalog: the Library Dataset's own inventory (15,229 books), staged in the ISFDB
 * staging shape and indexed by C-3's own build, so the yardstick runs the same retrieval code as the fixture.
 * Title ids are the inventory's 1-based row numbers.
 */
function inventoryCatalog(lib: string, out: string): void {
  if (existsSync(out)) return;
  const staging = `${out}.staging.sqlite`;
  const db = new DatabaseSync(staging);
  createSchema(db);
  const ins = (table: string, rows: (string | number | null)[][]) => {
    const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    const st = db.prepare(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`);
    for (const r of rows) st.run(...r);
  };
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run("schema_version", "1");
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run("content_hash", "library-dataset-inventory");
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run("dump_date", "2024-01-01");
  ins("languages", [[1, "Unknown", "und"]]);
  ins("publishers", [[1, "Library"]]);
  const inv = records(join(lib, "data", "target_lists", "library_books.csv"));
  const authors = new Map<string, number>();
  const titles: (string | number | null)[][] = [];
  const canon: (string | number | null)[][] = [];
  const pubs: (string | number | null)[][] = [];
  const content: (string | number | null)[][] = [];
  inv.forEach((b, i) => {
    const id = i + 1;
    titles.push([id, cleanTitle(b.title ?? ""), 0, 0, null, "0000-00-00", "NOVEL", 0, 1, "No", "No"]);
    for (const raw of (b.author ?? "").split(";").map((s) => s.trim()).filter(Boolean)) {
      const name = cleanAuthor(raw);
      if (!authors.has(name)) authors.set(name, authors.size + 1);
      canon.push([canon.length + 1, id, authors.get(name)!, 1]);
    }
    pubs.push([id, cleanTitle(b.title ?? ""), `L${id}`, "0000-00-00", 1, null, "tp", "NOVEL", null, 0, null, null, (b.isbn ?? "").replace(/\D/g, "") || null]);
    content.push([id, id, id, "1"]);
  });
  ins("authors", [...authors].map(([name, id]) => [id, name, null, name.split(" ").pop() ?? name, 1]));
  ins("titles", titles);
  ins("canonical_author", canon);
  ins("pubs", pubs);
  ins("pub_content", content);
  db.close();
  buildCatalog({ staging, out, log });
}

async function yardstick(limit: number, qwenCap: number, runId: string, arm: Arm, post: string[] = []): Promise<void> {
  // --post (F-0e): detect.py post steps on the shelf-scale tiling, in their own stage folder and part.
  const tiling: Tiling = post.length ? { ...SHELF_TILING, post } : SHELF_TILING;
  const name = [arm, ...post].join("+");
  const root = dataRoot();
  const lib = join(root, "proxy", "library-dataset");
  const imgDir = join(lib, "images");
  if (!existsSync(imgDir) || readdirSync(imgDir).length === 0) throw new Error(`yardstick images missing: ${imgDir}`);
  const catalogPath = join(lib, "f0-inventory-catalog.sqlite");
  inventoryCatalog(lib, catalogPath);
  const db = openCatalog(catalogPath);
  const ann = records(join(lib, "data", "annotations", "library_books_annotations.csv"));
  const inv = records(join(lib, "data", "target_lists", "library_books.csv"));
  const byIsbn = new Map<string, string>();
  const byTitle = new Map<string, string>();
  inv.forEach((b, i) => {
    const isbn = (b.isbn ?? "").replace(/\D/g, "");
    if (isbn) byIsbn.set(isbn, String(i + 1));
    byTitle.set(normalize(cleanTitle(b.title ?? "")), String(i + 1));
  });
  const workIdOf = new Map<string, string>();
  for (const r of db.prepare("SELECT id FROM works").all() as { id: string }[]) workIdOf.set(r.id.replace(/^isfdb:/, ""), r.id);
  // Ground truth per image: annotated books (not "not_book"), mapped to inventory works.
  const gt = new Map<string, { works: Set<string>; notInInventory: number; authors: Set<string> }>();
  for (const a of ann) {
    if (a.not_book === "True") continue;
    const g = gt.get(a.image_name!) ?? { works: new Set(), notInInventory: 0, authors: new Set() };
    const t = byIsbn.get((a.isbn ?? "").replace(/\D/g, "")) ?? byTitle.get(normalize(cleanTitle(a.title ?? "")));
    const w = t ? workIdOf.get(t) : undefined;
    if (w) g.works.add(w);
    else g.notInInventory++;
    for (const raw of (a.author ?? "").split(";")) if (raw.trim()) g.authors.add(normalize(cleanAuthor(raw)).split(" ").pop()!);
    gt.set(a.image_name!, g);
  }
  // Deterministic sample: every k-th annotated image that exists on disk, from the middle of each stride. The
  // stride starts (i % step === 0) were the smoke-test images looked at while building the pipeline; they stay out.
  const names = [...gt.keys()].filter((n) => existsSync(join(imgDir, n))).sort();
  const step = Math.max(2, Math.floor(names.length / limit));
  const sample = names.filter((_, i) => i % step === Math.floor(step / 2)).slice(0, limit);
  const images: InputImage[] = sample.map((n) => ({ id: n.replace(/\.jpg$/i, ""), photoHash: "0".repeat(64), path: join(imgDir, n), setting: "proxy" }));
  const dir = stageDir(root, `yardstick-library-${name}`);
  const t0 = Date.now();
  const { dets, decisions, readings, hardSelected, hardTotal } = await pipeline(images, db, dir, qwenCap, arm, tiling);
  let tp = 0, predN = 0, gtN = 0, authorOk = 0, notDetected = 0, notInInv = 0;
  const perImage: { recall: number | null; precision: number | null }[] = [];
  const perImageCounts: [number, number, number][] = []; // [annotated, hits, accepted] in sample order, for paired arm comparisons
  for (const img of images) {
    const g = gt.get(`${img.id}.jpg`)!;
    const acc = decisions.filter((d) => d.imageId === img.id && d.accepted);
    const pred = new Set(acc.map((d) => d.accepted!.workId));
    const hit = [...pred].filter((w) => g.works.has(w)).length;
    tp += hit;
    predN += pred.size;
    gtN += g.works.size;
    notInInv += g.notInInventory;
    authorOk += acc.filter((d) => d.accepted!.authors.some((a) => g.authors.has(normalize(a).split(" ").pop()!))).length;
    notDetected += Math.max(0, g.works.size - (dets.get(img.id)?.spines.length ?? 0));
    perImage.push({ recall: g.works.size ? hit / g.works.size : null, precision: pred.size ? hit / pred.size : null });
    perImageCounts.push([g.works.size, hit, pred.size]);
  }
  const accepted = decisions.filter((d) => d.accepted).length;
  const unknownByReason: Record<string, number> = {};
  for (const d of decisions) if (d.reason) unknownByReason[d.reason] = (unknownByReason[d.reason] ?? 0) + 1;
  const r4 = (x: number) => Math.round(x * 10000) / 10000;
  const metrics = {
    runId,
    card: "F-0",
    arm,
    boxArm: ARM_NAMES[arm],
    tiling,
    yardstick: "Library Dataset (Llabrés et al. 2024, MIT), split images; titles only. PROXY: library shelves, not bookstore",
    date: new Date().toLocaleDateString("en-CA"), // local date, as in the logs
    stack: stackFor(arm, "yardstick", tiling),
    accept: ACCEPT,
    catalog: "the dataset's own inventory (library_books.csv, closed set), indexed with C-3's build and retrieve",
    images: images.length,
    annotatedImagesAvailable: names.length,
    groundTruth: { books: gtN, notInInventory: notInInv },
    title: {
      truePositives: tp,
      predicted: predN,
      recall: gtN ? r4(tp / gtN) : null,
      precision: predN ? r4(tp / predN) : null,
      perImageRecallP50: median(perImage.map((p) => p.recall)),
      perImagePrecisionP50: median(perImage.map((p) => p.precision)),
      perImageCounts,
    },
    author: { acceptedWithAuthorInImage: authorOk, accepted, share: accepted ? r4(authorOk / accepted) : null },
    misses: {
      total: gtN - tp,
      notDetectedLowerBound: notDetected,
      acceptedWrong: predN - tp,
      unknownSpinesByReason: unknownByReason,
    },
    boxMetrics: { status: "pending", why: "Zhong/Yang set (figshare file 24026015) returned HTTP 504 on 2026-11-02; Library Dataset geometry is not released" },
    hardCrops: { total: hardTotal, sentToQwen: hardSelected },
    qwenCapPerImage: qwenCap,
    wallSeconds: Math.round((Date.now() - t0) / 1000),
    machine: machineAgreement(dets, decisions, readings),
  };
  const dir2 = writeEval(`yardstick-${name}`, metrics, yardstickReport(metrics));
  log(`aggregates -> ${dir2}`);
}

function median(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x !== null).sort((a, b) => a - b);
  return v.length ? Math.round(v[Math.floor(v.length / 2)]! * 10000) / 10000 : null;
}

function yardstickReport(m: ReturnType<typeof Object> & Record<string, any>): string {
  const rt = m.machine.runtimeSeconds;
  return `# ${m.runId}${m.arm && m.arm !== "b2" ? `-${m.arm}` : ""}: F-0 pipeline on the yardstick (PROXY), box arm ${(m.arm ?? "b2").toUpperCase()}

Run ${m.date}. **PROXY**: the Library Dataset (Llabrés et al. 2024, MIT; library shelves in Catalan and Spanish, not a
bookstore). It was not produced by this stack and is never trained on (OC36). Titles are matched against the dataset's
own inventory (closed set, ${"15,229"} books) through C-3's index and retrieval. Sample: ${m.images} of ${m.annotatedImagesAvailable} annotated split images, every k-th by name.

| title (image-level, against the annotation) | value |
|---|---:|
| ground-truth books in sample | ${m.groundTruth.books} (+${m.groundTruth.notInInventory} annotated but not matched to the inventory, left out) |
| accepted predictions | ${m.title.predicted} |
| **title recall** | **${pct(m.title.recall)}** (${m.title.truePositives}) |
| **title precision** | **${pct(m.title.precision)}** |
| per-image recall p50 / precision p50 | ${pct(m.title.perImageRecallP50)} / ${pct(m.title.perImagePrecisionP50)} |
| **author accuracy** (accepted labels whose author's surname is among the image's annotated authors) | **${pct(m.author.share)}** (${m.author.acceptedWithAuthorInImage}/${m.author.accepted}) |

**Misses by reason** (${m.misses.total} ground-truth books not found): at least ${m.misses.notDetectedLowerBound} by too few boxes
(image had fewer boxes than annotated books); ${m.misses.acceptedWrong} accepted labels were wrong books. Detected spines left unknown:
${Object.entries(m.misses.unknownSpinesByReason).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}. Without spine geometry in the annotation a
miss cannot be tied to one box, so these are counts side by side, not a partition.

**Box recall and precision: pending.** ${m.boxMetrics.why}.

Machine figures on the sample: ${m.machine.spineCount} boxes, catalog-confirmed ${pct(m.machine.catalogConfirmed.share)}, gap share ${pct(m.machine.gaps.gapShare)}.
Runtime: detection p50 ${rt.detectPerImage.p50} s per image; PP-OCR p50 ${rt.ppocr.perCropP50} s per crop; Qwen p50 ${rt.qwen.perCropP50} s per crop
(${m.hardCrops.sentToQwen} of ${m.hardCrops.total} hard crops, cap ${m.qwenCapPerImage} per image). Spend $0.
`;
}

/**
 * Paired bootstrap over images (fixed seed, 10,000 resamples): 95 % interval of arm − base for pooled recall and
 * precision. Both arms ran on the same images in the same order, so each resample draws image indices once.
 */
function pairedDelta(arm: [number, number, number][], base: [number, number, number][], n = 10_000): { recall: [number, number, number]; precision: [number, number, number] } | null {
  if (arm.length !== base.length || arm.length === 0) return null;
  let seed = 0x2f0;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const stat = (idx: number[]) => {
    let g = 0, ha = 0, pa = 0, hb = 0, pb = 0;
    for (const i of idx) {
      g += arm[i]![0];
      ha += arm[i]![1];
      pa += arm[i]![2];
      hb += base[i]![1];
      pb += base[i]![2];
    }
    return [g ? ha / g - hb / g : 0, (pa ? ha / pa : 0) - (pb ? hb / pb : 0)] as const;
  };
  const all = arm.map((_, i) => i);
  const point = stat(all);
  const rs: number[] = [], ps: number[] = [];
  for (let k = 0; k < n; k++) {
    const [r, p] = stat(all.map(() => Math.floor(rand() * all.length)));
    rs.push(r);
    ps.push(p);
  }
  const r4 = (x: number) => Math.round(x * 10000) / 10000;
  const ci = (xs: number[], x: number): [number, number, number] => {
    xs.sort((a, b) => a - b);
    return [r4(x), r4(xs[Math.floor(0.025 * n)]!), r4(xs[Math.floor(0.975 * n)]!)];
  };
  return { recall: ci(rs, point[0]), precision: ci(ps, point[1]) };
}

const pp = (d: [number, number, number] | undefined): string =>
  d ? `${d[0] >= 0 ? "+" : ""}${(d[0] * 100).toFixed(1)} (${(d[1] * 100).toFixed(1)} to ${(d[2] * 100).toFixed(1)})` : "—";

/** One row per box arm, all on the same yardstick sample, scored the same way. */
function armsTable(metrics: Record<string, any>): string {
  const rows = (["yardstick-b1", "yardstick-b2", "yardstick-b3", "yardstick-b4"] as const).filter((k) => metrics[k]).map((k) => {
    const m = metrics[k];
    const rt = m.machine.runtimeSeconds;
    const base = metrics["yardstick-b2"]?.title.perImageCounts;
    const d = k !== "yardstick-b2" && base && m.title.perImageCounts ? pairedDelta(m.title.perImageCounts, base) : null;
    if (d) m.vsB2 = d;
    const stages = Math.round((rt.detectPerImage.total + rt.vision.total + rt.ppocr.total + rt.qwen.total) / m.images);
    return `| ${(m.arm ?? "b2").toUpperCase()} | ${m.boxArm ?? ARM_NAMES.b2} | ${m.images} | ${m.machine.spineCount} | ${m.machine.spinesPerImage.p50} (${m.machine.spinesPerImage.max}) | ${pct(m.title.recall)} | ${pp(d?.recall)} | ${pct(m.title.precision)} | ${pp(d?.precision)} | ${pct(m.author.share)} | ${stages} | ${pct(m.machine.gaps.gapShare)} | ${rt.detectPerImage.p50} | ${m.machine.memoryMb.detectorPeakRss ?? "n/a"} / ${m.machine.memoryMb.detectorPeakMps ?? "n/a"} | ${m.machine.memoryMb.detectorDevice ?? "mps"} |`;
  });
  if (rows.length < 2) return "";
  const arms = Object.values(metrics).filter((m: any) => m?.vsB2);
  const side = (f: "recall" | "precision", up: boolean) =>
    arms.filter((m: any) => (up ? m.vsB2[f][1] > 0 : m.vsB2[f][2] < 0)).map((m: any) => m.arm.toUpperCase()).join(", ") || "none";
  const verdict = `Intervals that exclude 0: recall above B2: ${side("recall", true)}; recall below B2: ${side("recall", false)}; precision above B2: ${side("precision", true)}; precision below B2: ${side("precision", false)}.`;
  return `## Box arms on the yardstick (PROXY)

Same ${metrics["yardstick-b2"]?.images ?? ""} held-out images, same prompt (\`book spine\`), tiling, readers and acceptance bar; only the box step
changes (B2–B4 feed SAM 2.1; B1 is SAM 3 alone). Box recall and precision stay pending (no box ground truth), so arms are
compared through the end-to-end title score. Δ vs B2 is in percentage points with a paired bootstrap 95 % interval over the
images (10,000 resamples); an interval that spans 0 is not a clear difference. "All stages" is detection plus every reader's
summed stage time, divided by images (PP-OCR's three CPU workers are summed, not wall clock).

| arm | box step | images | boxes | boxes/image p50 (max) | title recall | Δ recall vs B2 | title precision | Δ precision vs B2 | author | all stages s/image | gap share | detect s/image p50 | detector peak MB (RSS / MPS) | device |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
${rows.join("\n")}

${verdict} Stage times were taken one arm at a time on one Mac, but other work shared the GPU at times, so compare them loosely.

`;
}

// --- main --------------------------------------------------------------------------------------

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    limit: { type: "string", default: "1000" },
    "qwen-cap": { type: "string", default: "40" },
    "run-id": { type: "string" },
    session: { type: "string", default: "pilot-000" },
    arm: { type: "string", default: "b2" },
    post: { type: "string", default: "" },
    // DL-3: read a stage cache whose lineage stamp is missing or names other weights (`staleAllowed` in src/ledger/lineage.ts).
    "allow-stale": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});
const limit = Number(values.limit);
const qwenCap = Number(values["qwen-cap"]);
const cmd = positionals[0];
if (cmd === "pilot") await pilot(values.session!, limit, qwenCap, values["run-id"] ?? `F0-${values.session}`, values["dry-run"]);
else if (cmd === "yardstick") {
  const arm = values.arm as Arm;
  if (!ARMS.includes(arm)) throw new Error(`--arm must be one of ${ARMS.join(", ")}`);
  await yardstick(limit, qwenCap, values["run-id"] ?? "F0-yardstick", arm, values.post!.split(",").filter(Boolean));
}
else if (cmd === "publish") publish(values["run-id"] ?? "F0");
else {
  console.error("usage: node src/eval/f0-cli.ts pilot|yardstick|publish [--limit n] [--qwen-cap n] [--run-id id] [--session id] [--dry-run] [--arm b2|b3|b4] [--post strips,extend]");
  process.exit(2);
}
