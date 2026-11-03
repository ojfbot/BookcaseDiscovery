// F-0 runner. `node src/eval/f0-cli.ts pilot|yardstick|publish [--limit n] [--qwen-cap n] [--run-id id]`.
// pilot: machine-labels a fixture session from the ledger (real use; machine agreement, never accuracy).
// yardstick: runs the same pipeline on the Library Dataset (PROXY) and scores titles against its own labels.
// Private outputs go under $BOOKCASE_DATA; only aggregates are written to evals/<run-id>/.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { buildCatalog } from "../catalog/build.ts";
import { openCatalog } from "../catalog/cli.ts";
import { createSchema } from "../catalog/isfdb-staging.ts";
import { normalize, surnameFirstToGivenFirst } from "../catalog/normalize.ts";
import type { Candidate } from "../catalog/retrieve.ts";
import { dataRoot, ImageStore } from "../ledger/images.ts";
import {
  ACCEPT,
  buildLabelSet,
  decide,
  detectStage,
  loadReadings,
  machineAgreement,
  pyReaderStage,
  ROTATIONS,
  stageDir,
  visionStage,
  ARMS,
  CASE_TILING,
  SHELF_TILING,
  type Arm,
  type Tiling,
  type Detection,
  type InputImage,
  type SpineDecision,
} from "./f0.ts";
import { LabelSet } from "./labels.ts";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const log = (s: string): void => console.error(`[f0] ${s}`);

async function pipeline(images: InputImage[], db: DatabaseSync, dir: string, qwenCap: number, arm: Arm = "b2", tiling: Tiling = CASE_TILING) {
  const dets = await detectStage(images, dir, log, arm, tiling);
  // Per-spine provenance (producer, readers, scores, catalog id or reason) is private: decisions.jsonl beside the stages.
  await visionStage(images, dets, dir, log);
  log("ppocr: reading");
  await pyReaderStage("ppocr", images, dets, dir, log);
  const cache = new Map<string, Candidate | undefined>();
  const decideAll = (): SpineDecision[] => {
    const readings = loadReadings(dir);
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
      .filter((d) => d.imageId === img.id && d.hard && Object.values(d.readText).some(Boolean))
      .sort((a, b) => b.boxScore - a.boxScore)
      .slice(0, qwenCap)
      .forEach((d) => hard.add(d.id));
  }
  log(`qwen: ${hard.size} hard crops`);
  await pyReaderStage("qwen", images, dets, dir, log, hard);
  const decisions = decideAll();
  writeFileSync(join(dir, "decisions.jsonl"), decisions.map((d) => JSON.stringify({ ...d, accepted: d.accepted && { workId: d.accepted.workId, score: d.accepted.score, queryCoverage: d.accepted.queryCoverage } })).join("\n") + "\n");
  return { dets, decisions, readings: loadReadings(dir), hardSelected: hard.size, hardTotal: first.filter((d) => d.hard).length };
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

async function pilot(session: string, limit: number, qwenCap: number, runId: string): Promise<void> {
  const root = dataRoot();
  const images = fixtureImages(root, session).slice(0, limit);
  const db = openCatalog(join(root, "catalog", "catalog.sqlite"));
  const dir = stageDir(root, session);
  const t0 = Date.now();
  const { dets, decisions, readings, hardSelected, hardTotal } = await pipeline(images, db, dir, qwenCap);
  const set = LabelSet.parse(buildLabelSet(session, images, dets, new Map(decisions.map((d) => [d.id, d]))));
  mkdirSync(join(root, "labels"), { recursive: true });
  writeFileSync(join(root, "labels", `${session}.machine.json`), `${JSON.stringify(set, null, 2)}\n`);
  const metrics = {
    runId,
    card: "F-0",
    session,
    scope: "real-use (OC35): machine agreement, never accuracy (INV-17); no V-6 taps exist",
    date: new Date().toISOString().slice(0, 10),
    stack: STACK,
    accept: ACCEPT,
    rotations: ROTATIONS,
    tiling: CASE_TILING,
    qwenCapPerImage: qwenCap,
    hardSelection: { total: hardTotal, sentToQwen: hardSelected },
    wallSeconds: Math.round((Date.now() - t0) / 1000),
    ...machineAgreement(dets, decisions, readings),
  };
  const dir2 = writeEval("pilot", metrics, pilotReport(metrics as unknown as PilotMetrics));
  log(`labels: ${set.photos.length} photos, ${decisions.length} spines -> $BOOKCASE_DATA/labels/${session}.machine.json`);
  log(`aggregates -> ${dir2}`);
}

const ARM_NAMES: Record<Arm, string> = {
  b1: "sam3 (text prompt, masks direct)",
  b2: "grounding-dino-base -> sam2.1-hiera-base-plus",
  b3: "owlv2-base-patch16-ensemble -> sam2.1-hiera-base-plus",
  b4: "mm-grounding-dino-large-all -> sam2.1-hiera-base-plus",
};

const STACK = {
  boxProducer: "B2: grounding-dino-base ('book spine.') -> sam2.1-hiera-base-plus, tiled; min-area rect -> 4-point polygon",
  boxProducers: 1,
  boxAgreement: "unavailable on pilot-000: SAM 3 (B1) arrived mid-card and ran on the yardstick only; B2 confidence and the gap test stand in",
  readers: ["R1 apple-vision .accurate (helpers/ocr-vision)", "R2 qwen3-vl-4b-instruct-8bit (mlx), hard crops only", "R3 pp-ocrv5 server det+rec + textline classifier"],
  paidVlm: "skipped: no API key or spend ceiling set (checklist #7)",
};

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

async function yardstick(limit: number, qwenCap: number, runId: string, arm: Arm): Promise<void> {
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
  const dir = stageDir(root, `yardstick-library-${arm}`);
  const t0 = Date.now();
  const { dets, decisions, readings, hardSelected, hardTotal } = await pipeline(images, db, dir, qwenCap, arm, SHELF_TILING);
  let tp = 0, predN = 0, gtN = 0, authorOk = 0, notDetected = 0, notInInv = 0;
  const perImage: { recall: number | null; precision: number | null }[] = [];
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
    tiling: SHELF_TILING,
    yardstick: "Library Dataset (Llabrés et al. 2024, MIT), split images; titles only. PROXY: library shelves, not bookstore",
    date: new Date().toISOString().slice(0, 10),
    stack: STACK,
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
  const dir2 = writeEval(`yardstick-${arm}`, metrics, yardstickReport(metrics));
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

/** One row per box arm, all on the same yardstick sample, scored the same way. */
function armsTable(metrics: Record<string, any>): string {
  const rows = (["yardstick-b1", "yardstick-b2", "yardstick-b3", "yardstick-b4"] as const).filter((k) => metrics[k]).map((k) => {
    const m = metrics[k];
    const rt = m.machine.runtimeSeconds;
    return `| ${(m.arm ?? "b2").toUpperCase()} | ${m.boxArm ?? ARM_NAMES.b2} | ${m.images} | ${m.machine.spineCount} | ${m.machine.spinesPerImage.p50} (${m.machine.spinesPerImage.max}) | ${pct(m.title.recall)} | ${pct(m.title.precision)} | ${pct(m.author.share)} | ${pct(m.machine.gaps.gapShare)} | ${rt.detectPerImage.p50} | ${m.machine.memoryMb.detectorPeakRss ?? "n/a"} / ${m.machine.memoryMb.detectorPeakMps ?? "n/a"} | ${m.machine.memoryMb.detectorDevice ?? "mps"} |`;
  });
  if (rows.length < 2) return "";
  return `## Box arms on the yardstick (PROXY)

Same ${metrics["yardstick-b2"]?.images ?? ""} held-out images, same prompt (\`book spine\`), tiling, SAM 2.1 masks, readers and acceptance bar; only the box detector
changes. Box recall and precision stay pending (no box ground truth), so arms are compared through the end-to-end title score.

| arm | detector → masks | images | boxes | boxes/image p50 (max) | title recall | title precision | author | gap share | detect s/image p50 | detector peak MB (RSS / MPS) | device |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
${rows.join("\n")}

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
  },
});
const limit = Number(values.limit);
const qwenCap = Number(values["qwen-cap"]);
const cmd = positionals[0];
if (cmd === "pilot") await pilot(values.session!, limit, qwenCap, values["run-id"] ?? "F0-pilot-000");
else if (cmd === "yardstick") {
  const arm = values.arm as Arm;
  if (!ARMS.includes(arm)) throw new Error(`--arm must be one of ${ARMS.join(", ")}`);
  await yardstick(limit, qwenCap, values["run-id"] ?? "F0-yardstick", arm);
}
else if (cmd === "publish") publish(values["run-id"] ?? "F0");
else {
  console.error("usage: node src/eval/f0-cli.ts pilot|yardstick|publish [--limit n] [--qwen-cap n] [--run-id id] [--session id] [--arm b2|b3|b4]");
  process.exit(2);
}
