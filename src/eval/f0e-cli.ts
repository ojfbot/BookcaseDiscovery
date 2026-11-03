// F-0e runner. `node src/eval/f0e-cli.ts diagnose|measure|publish`.
// diagnose: the overlap hypothesis on cached pilot-000 detections (no rerun).
// detect --set pilot-000|yardstick --label <arm>: run one F-0e arm (F0E_ARMS) and measure it.
// measure --set pilot-000|yardstick --label <arm>: piece measures of one arm's cached detections, as an aggregate part.
// publish: joins the parts into evals/F0e/. Private inputs stay under $BOOKCASE_DATA; only aggregates leave.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { dataRoot, ImageStore } from "../ledger/images.ts";
import { openCatalog } from "../catalog/cli.ts";
import type { Candidate } from "../catalog/retrieve.ts";
import { CASE_TILING, decide, loadReadings, pyReaderStage, readJsonl, visionStage, type Detection, type InputImage, type SpineDecision } from "./f0.ts";
import { agreementChange, diagnose, measure, rungCounts, titleDelta } from "./f0e.ts";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const log = (s: string): void => console.error(`[f0e] ${s}`);

const loadDets = (path: string): Detection[] => readJsonl<Detection>(path).filter((d) => !d.error);


// --- detection arms ------------------------------------------------------------------------------

/**
 * F-0e arms. Tiling arms run the detector afresh; post arms re-run only detect.py's post steps (SAM re-masks) on
 * another arm's cached spines, adding their time to that arm's. `base` is F-0's cache.
 */
export const F0E_ARMS: Record<string, { env: Record<string, string>; from?: string }> = {
  tall: { env: { F0_TILE: "1600", F0_OVERLAP: "700", F0_TILE_H: "2600", F0_OVERLAP_Y: "1900" } },
  bands: { env: { F0_TILE: "1600", F0_OVERLAP: "700", F0_LAYOUT: "bands" } },
  join: { env: { F0_POST: "join" }, from: "base" },
  extend: { env: { F0_POST: "extend" }, from: "base" },
  strips: { env: { F0_POST: "strips" }, from: "base" },
  "strips+extend": { env: { F0_POST: "strips,extend" }, from: "base" },
  "tall+strips": { env: { F0_POST: "strips" }, from: "tall" },
  "tall+join": { env: { F0_POST: "join" }, from: "tall" },
  "tall+extend": { env: { F0_POST: "extend" }, from: "tall" },
  "tall+strips+extend": { env: { F0_POST: "strips,extend" }, from: "tall" },
};

/** Cached detections of one arm on one set: F-0's own for `base`, else $BOOKCASE_DATA/f0e/<set>/<arm>/. */
export function armPath(set: string, arm: string): string {
  const f0Set = set === "yardstick" ? "yardstick-library-b2" : set;
  return arm === "base" ? join(dataRoot(), "f0", f0Set, "detect.jsonl") : join(dataRoot(), "f0e", set, arm, "detect.jsonl");
}

function imagesOf(set: string): { id: string; image: string }[] {
  const base = loadDets(armPath(set, "base"));
  if (set === "yardstick") return base.map((d) => ({ id: d.id, image: join(dataRoot(), "proxy", "library-dataset", "images", `${d.id}.jpg`) }));
  const store = new ImageStore(dataRoot());
  return base.map((d) => ({ id: d.id, image: store.find(d.id)! }));
}

async function detectArm(set: string, arm: string, scaleEnv: Record<string, string>, limit = Infinity): Promise<void> {
  const cfg = F0E_ARMS[arm];
  if (!cfg) throw new Error(`unknown arm ${arm}; one of ${Object.keys(F0E_ARMS).join(", ")}`);
  const out = armPath(set, arm);
  mkdirSync(join(out, ".."), { recursive: true });
  const done = new Set(loadDets(out).map((d) => d.id));
  const reqs = imagesOf(set).slice(0, limit).filter((r) => !done.has(r.id));
  if (reqs.length === 0) return;
  const helper = join(REPO_ROOT, "helpers", "label");
  const args = ["run", "--project", helper, "python", join(helper, "detect.py"), ...(cfg.from ? ["--from", armPath(set, cfg.from)] : [])];
  await new Promise<void>((resolve, reject) => {
    const child = spawn("uv", args, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, F0_ARM: "b2", ...scaleEnv, ...cfg.env } });
    let buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c: string) => {
      buf += c;
      const lines = buf.split("\n");
      buf = lines.pop()!;
      for (const l of lines) if (l.trim()) writeFileSync(out, `${l}\n`, { flag: "a" });
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c: string) => c.split("\n").filter((l) => l.startsWith("detect:")).forEach((l) => log(l.replace(/^detect: [0-9a-f_A-Za-z.-]{6,} /, "detect: ").slice(0, 100))));
    child.stdin.end(reqs.map((r) => `${JSON.stringify(r)}\n`).join(""));
    child.once("error", reject);
    child.once("close", (code) => (code === 0 ? resolve() : reject(new Error(`detect.py exited ${code}`))));
  });
}

// --- readers for one arm, and the change in machine agreement --------------------------------------

/** F-0's reader stages and decision on one arm's cached boxes (as f0-cli's pipeline, which is not importable). */
async function readArm(set: string, arm: string, qwenCap = 40): Promise<SpineDecision[]> {
  const dir = arm === "base" ? join(dataRoot(), "f0", set) : join(armPath(set, arm), "..");
  const dets = new Map(loadDets(armPath(set, arm)).map((d) => [d.id, d]));
  const images: InputImage[] = imagesOf(set).map((r) => ({ id: r.id, photoHash: "", path: r.image, setting: "" }));
  const db = openCatalog(join(dataRoot(), "catalog", "catalog.sqlite"));
  const cache = new Map<string, Candidate | undefined>();
  const decideAll = (): SpineDecision[] => {
    const readings = loadReadings(dir);
    return images.flatMap((img) => (dets.get(img.id)?.spines ?? []).map((s, i) => decide(db, `${img.id}:${i}`, img.id, s.boxScore, readings.get(`${img.id}:${i}`) ?? {}, cache)));
  };
  if (arm !== "base") {
    await visionStage(images, dets, dir, log);
    await pyReaderStage("ppocr", images, dets, dir, log);
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
  }
  return decideAll();
}


// --- parts and publish ---------------------------------------------------------------------------

const partsDir = () => {
  const dir = join(dataRoot(), "f0e", "parts");
  mkdirSync(dir, { recursive: true });
  return dir;
};

function writePart(name: string, value: object): void {
  writeFileSync(join(partsDir(), `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
  log(`part ${name} -> $BOOKCASE_DATA/f0e/parts/`);
}

function publish(): void {
  const dir = partsDir();
  const parts = Object.fromEntries(
    readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(join(dir, f), "utf8"))]),
  );
  const out = join(REPO_ROOT, "evals", "F0e");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "metrics.json"), `${JSON.stringify({ runId: "F0e", card: "F-0e", ...parts }, null, 2)}\n`);
  // The tables are generated; report.md's prose is written by hand around the marker.
  const report = join(out, "report.md");
  const marker = /<!-- tables -->[\s\S]*<!-- \/tables -->/;
  const tables = `<!-- tables -->\n${tablesMd(parts)}<!-- /tables -->`;
  const prev = existsSync(report) ? readFileSync(report, "utf8") : "# F0e: whole-spine boxes (F-0e)\n\n<!-- tables --><!-- /tables -->\n";
  writeFileSync(report, prev.replace(marker, tables));
  log(`published ${Object.keys(parts).length} parts -> evals/F0e/`);
}

const pc = (t: [number, number, number] | null | undefined): string => (t ? `${(t[0] * 100).toFixed(1)} % (${(t[1] * 100).toFixed(1)}–${(t[2] * 100).toFixed(1)})` : "n/a");
const x = (t: [number, number, number] | null | undefined): string => (t ? `${t[0].toFixed(2)} (${t[1].toFixed(2)}–${t[2].toFixed(2)})` : "n/a");

/** Markdown tables from the parts: arms per set, never merged (OC35). */
export function tablesMd(parts: Record<string, any>): string {
  const out: string[] = [];
  for (const [set, title] of [["pilot-000", "`pilot-000` (real use)"], ["yardstick", "Yardstick (PROXY, library shelves; evaluation only, nothing tuned on it)"]] as const) {
    const arms = Object.values(parts).filter((m: any) => m.set === set && m.pooled);
    if (arms.length === 0) continue;
    arms.sort((a: any, b: any) => (a.arm === "base" ? -1 : b.arm === "base" ? 1 : String(a.arm).localeCompare(String(b.arm))));
    out.push(`### Box measures by arm: ${title}\n`);
    out.push("Pooled shares with 95 % photo-bootstrap intervals; ratios are arm / base on the same photos (median over photos).\n");
    out.push("| arm | boxes | cut | partial (band polygon) | partial (band spine height) | stacked in a column | inside a larger box | boxes per band ÷ (length ÷ median width), p50 | upright box length vs base | boxes vs base | detect s/photo p50 | detect time vs base |");
    out.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
    for (const m of arms as any[]) {
      out.push(`| ${m.arm} | ${m.boxes} | ${pc(m.pooled.cut)} | ${pc(m.pooled.partial)} | ${pc(m.pooled.partialSpine)} | ${pc(m.pooled.touching)} | ${pc(m.pooled.inside)} | ${x(m.photoMedian.boxesPerBand)} | ${x(m.vsBase?.uprightLong)} | ${x(m.vsBase?.boxes)} | ${m.photoMedian.detectSeconds?.[0] ?? "n/a"} | ${x(m.vsBase?.detectSeconds)} |`);
    }
    out.push("");
  }
  for (const t of Object.values(parts).filter((m: any) => m.titleArm) as any[]) {
    out.push(`### Yardstick titles with \`${t.titleArm}\` (PROXY, ${t.images} images, evaluation only)\n`);
    out.push(`| | B2 base | B2 +${t.titleArm} | change (paired image bootstrap, 95 %) |\n|---|---:|---:|---:|`);
    out.push(`| spine boxes | ${t.base.spines} | ${t.arm.spines} | |`);
    out.push(`| accepted labels | ${t.base.accepted} | ${t.arm.accepted} | |`);
    out.push(`| title recall | ${(t.base.recall * 100).toFixed(1)} % | ${(t.arm.recall * 100).toFixed(1)} % | ${pts(t.delta?.recall)} |`);
    out.push(`| title precision | ${(t.base.precision * 100).toFixed(1)} % | ${(t.arm.precision * 100).toFixed(1)} % | ${pts(t.delta?.precision)} |`);
    out.push("");
  }
  for (const a of Object.values(parts).filter((m: any) => m.delta && m.armName) as any[]) {
    out.push(`### Readers on \`${a.armName}\` against the base boxes: \`${a.set}\` (machine agreement, not accuracy)\n`);
    out.push("| | base | " + a.armName + " | change (paired photo bootstrap, 95 %) |\n|---|---:|---:|---:|");
    out.push(`| boxes | ${a.base.boxes} | ${a.arm.boxes} | per photo ${x(a.delta.boxesPerPhoto)} |`);
    out.push(`| share at \`text-present\` | ${(a.base.textPresentShare * 100).toFixed(1)} % | ${(a.arm.textPresentShare * 100).toFixed(1)} % | |`);
    out.push(`| share at \`text-read\` (a reader's top candidate passes the bar) | ${(a.base.textReadShare * 100).toFixed(1)} % | ${(a.arm.textReadShare * 100).toFixed(1)} % | ${pts(a.delta.textReadShare)} |`);
    out.push(`| share \`confirmed\` | ${(a.base.confirmedShare * 100).toFixed(1)} % | ${(a.arm.confirmedShare * 100).toFixed(1)} % | ${pts(a.delta.confirmedShare)} |`);
    out.push(`| \`text-read\` boxes per photo | | | ${x(a.delta.textReadPerPhoto)} |`);
    out.push(`| \`confirmed\` boxes per photo | ${a.base.confirmedPerPhoto} | ${a.arm.confirmedPerPhoto} | ${x(a.delta.confirmedPerPhoto)} |`);
    out.push(`| distinct confirmed works per photo | ${a.base.worksPerPhoto} | ${a.arm.worksPerPhoto} | ${x(a.delta.worksPerPhoto)} |`);
    out.push("");
  }
  return out.join("\n") + "\n";
}

const pts = (t: [number, number, number] | null | undefined): string => (t ? `${(t[0] * 100).toFixed(1)} pts (${(t[1] * 100).toFixed(1)} to ${(t[2] * 100).toFixed(1)})` : "n/a");

// --- main ----------------------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      set: { type: "string" },
      label: { type: "string" },
      tile: { type: "string" },
      overlap: { type: "string" },
      limit: { type: "string" },
    },
  });
  const cmd = positionals[0];
  const f0 = join(dataRoot(), "f0");
  if (cmd === "diagnose") {
    const set = values.set ?? "pilot-000";
    const dets = loadDets(join(f0, set, "detect.jsonl"));
    writePart(`diagnose-${values.label ?? set}`, { set: set.startsWith("yardstick") ? "yardstick (PROXY)" : "pilot-000 (real use)", ...diagnose(dets, Number(values.tile ?? CASE_TILING.tile), Number(values.overlap ?? CASE_TILING.overlap)) });
  } else if (cmd === "measure") {
    const set = values.set ?? "pilot-000";
    const path = armPath(set, values.label!);
    if (!existsSync(path)) throw new Error(`no detections for ${set} ${values.label}`);
    writePart(`measure-${set}-${values.label}`, { set, arm: values.label, ...measure(loadDets(path), loadDets(armPath(set, "base"))) });
  } else if (cmd === "detect") {
    const set = values.set ?? "pilot-000";
    // The yardstick keeps F-0's shelf-scale tiling; post arms inherit it from the cache they refine.
    const scale: Record<string, string> = set === "yardstick" ? { F0_TILE: "3100", F0_OVERLAP: "1300" } : {};
    await detectArm(set, values.label!, scale, Number(values.limit ?? Infinity));
    writePart(`measure-${set}-${values.label}`, { set, arm: values.label, ...measure(loadDets(armPath(set, values.label!)), loadDets(armPath(set, "base"))) });
  } else if (cmd === "render") {
    // Private before/after renders under the data root's private/f0e/renders/<set>/index.html (photos; never the repo).
    const set = values.set ?? "pilot-000";
    const [before, after] = (values.label ?? "base,tall").split(",");
    const priv = join(dataRoot(), "private", "f0e");
    mkdirSync(priv, { recursive: true });
    const list = join(priv, `images-${set}.jsonl`);
    writeFileSync(list, imagesOf(set).map((r) => `${JSON.stringify(r)}\n`).join(""));
    const helper = join(REPO_ROOT, "helpers", "label");
    const args = ["run", "--project", helper, "python", "-I", join(helper, "render_f0e.py"), "--before", armPath(set, before!), "--after", armPath(set, after!),
      "--images", list, "--out", join(priv, "renders", set), "--label", set, "--names", `${before},${after}`];
    await new Promise<void>((resolve, reject) => spawn("uv", args, { stdio: ["ignore", "ignore", "inherit"] }).once("close", (c) => (c === 0 ? resolve() : reject(new Error(`render exited ${c}`)))));
    log(`renders written under the data root's private/f0e/renders/${set}/`);
  } else if (cmd === "read") {
    // Readers on one arm's boxes, then machine agreement (never accuracy, INV-17) against F-0's base run.
    const set = values.set ?? "pilot-000";
    const base = rungCounts(await readArm(set, "base"));
    const arm = rungCounts(await readArm(set, values.label!));
    writePart(`agreement-${set}-${values.label}`, { set, armName: values.label, scope: "machine agreement, not accuracy (INV-17)", ...agreementChange(base, arm) });
  } else if (cmd === "title") {
    // Yardstick titles for an F-0 yardstick run with --post (its part in $BOOKCASE_DATA/f0/parts/) against B2.
    const read = (p: string) => JSON.parse(readFileSync(join(f0, "parts", `${p}.json`), "utf8"));
    const base = read("yardstick-b2");
    const arm = read(`yardstick-b2+${values.label}`);
    writePart(`title-yardstick-${values.label}`, {
      set: "yardstick",
      titleArm: values.label,
      scope: "PROXY (library shelves): title recall and precision against the dataset's own labels",
      images: arm.images,
      base: { recall: base.title.recall, precision: base.title.precision, accepted: base.author.accepted, spines: base.machine.spineCount },
      arm: { recall: arm.title.recall, precision: arm.title.precision, accepted: arm.author.accepted, spines: arm.machine.spineCount },
      delta: titleDelta(base.title.perImageCounts, arm.title.perImageCounts),
    });
  } else if (cmd === "publish") publish();
  else {
    console.error("usage: node src/eval/f0e-cli.ts diagnose|measure|publish [--set dir] [--label arm]");
    process.exit(2);
  }
}
