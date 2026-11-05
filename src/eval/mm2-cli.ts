// MM-2 runner: the gallery and gallery-free appearance arms in shadow mode, beside each cached F-0 decision
// (evals/MM2/prereg.md).
//
//   node src/eval/mm2-cli.ts ranked <set>                      # CPU: each reader's C-3 top-10 per box, cached
//   node src/eval/mm2-cli.ts texts <set>                       # CPU: SigLIP 2 text vectors of every pool work's title
//   node src/eval/mm2-cli.ts shadow <set> --appearance shadow  # both arms beside every F-0 decision (private log)
//   node src/eval/mm2-cli.ts analyse                           # both sets -> evals/MM2/{metrics.json,report.md}
//
// <set> is pilot-000 or yardstick, logged and reported apart (OC35). The gallery is built from pilot-000's F-1 train
// photos only; the yardstick is only ever a query. `shadow` needs `--appearance shadow` and does nothing when the
// switch is off (the default); `candidate` and `vote` are refused. Ranked lists, text vectors and shadow rows (work
// ids, reader-derived scores) stay under the data root's private/mm2/; only aggregates reach evals/MM2/. No decision
// is changed, and identify's own runners are not touched.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { catalogPaths, openCatalog } from "../catalog/cli.ts";
import { retrieve, scoreWorks } from "../catalog/retrieve.ts";
import {
  APPEARANCE,
  freeArm,
  galleryArm,
  marginThreshold,
  nearestEntries,
  quantile,
  shadowOnly,
  simulateCandidate,
  textThreshold,
  titleText,
  visualThreshold,
  type GalleryEntry,
  type Template,
} from "../identify/appearance.ts";
import { dataRoot } from "../ledger/images.ts";
import { SETS } from "./f0c-cli.ts";
import { confirms, readJsonl, READERS, variantsOf, type ReaderName, type SpineDecision } from "./f0.ts";
import { appearanceMode, MmRecord, pairBootstrap, type Interval } from "./mm1.ts";
import { assertUnchanged, bookKey, LOOKALIKE_KINDS, lookalikeKind, countOf, MM2, newAccept, ShadowRow, shareOf, stressPairs, type Mm2Set, type StressModel } from "./mm2.ts";
import { compactJson, yardstickTruth } from "./q1-cli.ts";
import { contentHash, sha256 } from "./ts0.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const ROOT = dataRoot();
const MM = join(ROOT, "private", "mm");
const PRIV = join(ROOT, "private", "mm2");
const SIGLIP = join(ROOT, "models", "siglip2-base-patch16-naflex");
const HELPER = join(REPO, "helpers", "embed");
const log = (s: string): void => console.error(`[mm2] ${new Date().toISOString().slice(11, 19)} ${s}`);
const r4 = (x: number) => Math.round(x * 10000) / 10000;
const isSet = (s: string | undefined): s is Mm2Set => s === "pilot-000" || s === "yardstick";

const CATALOG: Record<Mm2Set, string> = { "pilot-000": catalogPaths().catalog, yardstick: SETS.yardstick.catalog };
const H2: Record<Mm2Set, string> = { "pilot-000": "pilot-000", yardstick: "yardstick-library-b2" };
const dir = (...p: string[]): string => {
  const d = join(PRIV, ...p);
  mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
};
const imageOf = (id: string): string => id.slice(0, id.lastIndexOf(":"));
const readF32 = (path: string): Float32Array => {
  const b = readFileSync(path);
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const writeAtomic = (path: string, text: string): void => {
  writeFileSync(`${path}.tmp`, text, { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
};
const catalogStamp = (path: string): string => {
  const s = statSync(path);
  return `${s.size}:${Math.round(s.mtimeMs)}`;
};

// --- inputs --------------------------------------------------------------------------------------------------

function loadRecords(set: Mm2Set): { version: string; rows: MmRecord[] } {
  const d = join(MM, set, "records");
  if (!existsSync(join(d, "latest.json"))) throw new Error(`no MM-1 records for ${set}: run \`mm1-cli.ts records ${set}\``);
  const { version } = JSON.parse(readFileSync(join(d, "latest.json"), "utf8")) as { version: string };
  return { version, rows: readJsonl<unknown>(join(d, `${version}.jsonl`)).map((r) => MmRecord.parse(r)) };
}

/** A record's readings as F-0's retrieval variants, per reader that read the box. */
const variantsBy = (r: MmRecord): Partial<Record<ReaderName, string[]>> =>
  Object.fromEntries(READERS.filter((k) => r.readings[k]).map((k) => [k, variantsOf({ id: r.key.boxId, reader: k, variants: r.readings[k]!.variants, seconds: 0 })]));

/** F-1's frozen split and split group per photo, from the label ledger version the pre-registration names. */
function splits(): Map<string, { split: "train" | "val" | "held-out"; group: string }> {
  const p = join(ROOT, "datasets", "label-ledger", MM2.ledger, "manifest.json");
  if (!existsSync(p)) throw new Error(`no label ledger ${MM2.ledger} at the data root (bookcase dataset build)`);
  const m = JSON.parse(readFileSync(p, "utf8")) as { photos: { sha256: string; split: "train" | "val" | "held-out"; splitGroup: string }[] };
  return new Map(m.photos.map((x) => [x.sha256, { split: x.split, group: x.splitGroup }]));
}

interface Work {
  id: string;
  title: string;
  authors: string[];
  key: string;
}

function worksOf(db: DatabaseSync, ids: Iterable<string>): Map<string, Work> {
  const q = db.prepare("SELECT id, title, authors, title_norm FROM works WHERE id = ?");
  const out = new Map<string, Work>();
  for (const id of ids) {
    const w = q.get(id) as { id: string; title: string; authors: string; title_norm: string } | undefined;
    if (!w) continue;
    const authors = JSON.parse(w.authors) as string[];
    out.set(id, { id, title: w.title, authors, key: bookKey(w.title_norm, authors) });
  }
  return out;
}

// --- ranked: each reader's C-3 candidates (CPU) --------------------------------------------------------------------

interface RankedRow {
  id: string;
  ranked: Partial<Record<ReaderName, string[]>>;
}

const rankedPath = (set: Mm2Set) => join(dir(set), "ranked.jsonl");

function ranked(set: Mm2Set): void {
  const { version, rows } = loadRecords(set);
  const stamp = { records: version, catalog: catalogStamp(CATALOG[set]), depth: APPEARANCE.free.poolDepth };
  const meta = join(dir(set), "ranked.json");
  if (existsSync(meta) && readFileSync(meta, "utf8").trim() === JSON.stringify(stamp)) return log(`${set}: ranked lists cached`);
  const db = openCatalog(CATALOG[set]);
  const cache = new Map<string, string[]>();
  const out: RankedRow[] = [];
  const t0 = Date.now();
  rows.forEach((r, k) => {
    const rk: RankedRow["ranked"] = {};
    for (const [reader, vs] of Object.entries(variantsBy(r)) as [ReaderName, string[]][]) {
      if (!vs.length) continue;
      const key = vs.join("\u0000");
      if (!cache.has(key)) cache.set(key, retrieve(db, vs, APPEARANCE.free.poolDepth).map((c) => c.workId));
      rk[reader] = cache.get(key)!;
    }
    out.push({ id: r.key.boxId, ranked: rk });
    if ((k + 1) % 500 === 0) log(`${set}: ${k + 1} / ${rows.length} (${Math.round((Date.now() - t0) / 1000)} s)`);
  });
  const ids = new Set(out.flatMap((o) => Object.values(o.ranked).flat()));
  for (const r of rows) if (r.workId) ids.add(r.workId);
  const works = worksOf(db, ids);
  db.close();
  writeAtomic(rankedPath(set), out.map((o) => JSON.stringify(o)).join("\n") + "\n");
  writeAtomic(join(dir(set), "works.jsonl"), [...works.values()].map((w) => JSON.stringify(w)).join("\n") + "\n");
  writeFileSync(meta, JSON.stringify(stamp) + "\n", { mode: 0o600 });
  log(`${set}: ranked ${rows.length} records (${cache.size} distinct readings, ${works.size} works) in ${Math.round((Date.now() - t0) / 1000)} s`);
}

// --- texts: SigLIP 2's text tower (CPU) ----------------------------------------------------------------------------

/** The text vectors' folder: the checkpoint's revision, the token length and the helper, so a change never reuses one. */
function textDir(): string {
  const meta = join(SIGLIP, ".cache", "huggingface", "download", "model.safetensors.metadata");
  const revision = readFileSync(meta, "utf8").split("\n")[0]!.trim();
  return join(PRIV, "text", `siglip2@${contentHash({ revision, maxTokens: APPEARANCE.free.maxTokens, helper: sha256(readFileSync(join(HELPER, "text.py"))) }).slice(0, 12)}`);
}
const textKey = (template: Template, text: string): string => sha256(`${template}\u0000${text}`).slice(0, 24);
const loadWorks = (set: Mm2Set): Map<string, Work> => new Map(readJsonl<Work>(join(dir(set), "works.jsonl")).map((w) => [w.id, w]));

async function texts(set: Mm2Set): Promise<void> {
  const works = loadWorks(set);
  if (!works.size) throw new Error(`${set}: no works (run \`mm2-cli.ts ranked ${set}\` first)`);
  const out = textDir();
  mkdirSync(out, { recursive: true, mode: 0o700 });
  const reqs = new Map<string, string>();
  for (const w of works.values()) for (const t of APPEARANCE.free.templates) {
    const text = titleText(t, w.title, w.authors);
    reqs.set(textKey(t, text), text);
  }
  const py = join(HELPER, ".venv", "bin", "python");
  if (!existsSync(py)) throw new Error("helpers/embed has no .venv: run `uv sync` there first");
  const t0 = Date.now();
  const lines: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(py, ["-I", join(HELPER, "text.py"), "--siglip2", SIGLIP, "--out", out, "--device", "cpu"], { stdio: ["pipe", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c: string) => lines.push(...c.split("\n").filter((l) => l.trim())));
    let err = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c: string) => (err = (err + c).slice(-2000)));
    child.stdin.end([...reqs].map(([key, text]) => JSON.stringify({ key, text }) + "\n").join(""));
    child.once("error", reject);
    child.once("close", (code) => (code === 0 ? resolve() : reject(new Error(`text.py exited ${code}: ${err.split("\n").filter(Boolean).at(-1) ?? ""}`))));
  });
  const res = lines.map((l) => JSON.parse(l) as { ready?: Record<string, unknown>; done?: { embedded: number; cached: number; seconds: number } });
  const done = res.find((x) => x.done)?.done;
  const run = { set, at: new Date().toISOString(), device: "cpu", texts: reqs.size, ...done, wallSeconds: Math.round((Date.now() - t0) / 1000), ready: res.find((x) => x.ready)?.ready ?? null };
  writeFileSync(join(PRIV, "text-runs.jsonl"), JSON.stringify(run) + "\n", { flag: "a", mode: 0o600 });
  log(`${set}: ${reqs.size} texts (${done?.embedded ?? 0} embedded) in ${run.wallSeconds} s on the CPU`);
}

// --- shadow ------------------------------------------------------------------------------------------------------

interface Ctx {
  set: Mm2Set;
  records: MmRecord[];
  dbs: Record<Mm2Set, DatabaseSync>;
  works: Record<Mm2Set, Map<string, Work>>;
  ranked: Map<string, RankedRow["ranked"]>;
  vec: (r: MmRecord, m: StressModel) => Float32Array;
}

const vecOf = (set: Mm2Set) => {
  const cache = new Map<string, Float32Array>();
  return (r: MmRecord, m: StressModel): Float32Array => {
    const k = `${m}\u0000${r.key.boxId}`;
    if (!cache.has(k)) cache.set(k, readF32(join(MM, set, r.embeddings[m].path)));
    return cache.get(k)!;
  };
};

/** The best title evidence any one reader's text gives each work (retrieval's own scoring); 0 with no text. */
function textAgreement(db: DatabaseSync, vs: Partial<Record<ReaderName, string[]>>, workIds: string[]): Map<string, number> {
  const out = new Map(workIds.map((w) => [w, 0]));
  if (!workIds.length) return out;
  for (const v of Object.values(vs)) {
    if (!v?.length) continue;
    for (const [w, c] of scoreWorks(db, v, workIds)) out.set(w, Math.max(out.get(w) ?? 0, c.evidence.find((e) => e.field === "title")?.score ?? 0));
  }
  return out;
}

/** Does this reader's text confirm the work by F-0's full bar? */
const passesBar = (db: DatabaseSync, vs: Partial<Record<ReaderName, string[]>>) => (reader: ReaderName, w: string): boolean =>
  !!vs[reader]?.length && confirms(scoreWorks(db, vs[reader]!, [w]).get(w));

interface Calibration {
  gallery: { entries: number; works: number; groups: number; photos: number };
  visual: Record<StressModel, ReturnType<typeof visualThreshold> & { median: number | null }>;
  text: ReturnType<typeof textThreshold> & { lookalikes: number; max: number | null; atOrAbove: Record<string, number> };
  margin: ReturnType<typeof marginThreshold> & { rows: number; byDelta: Record<string, { proposals: number; agreement: number | null }> };
  nearDuplicateFlags: number;
}

/** The gallery and every threshold, from pilot-000's train photos only. */
function calibrate(p: Ctx, sp: ReturnType<typeof splits>): { gallery: Record<StressModel, GalleryEntry[]>; recs: MmRecord[]; cal: Calibration } {
  const recs = p.records.filter((r) => r.workId && r.strip.valid && sp.get(imageOf(r.key.boxId))?.split === "train" && !r.evaluationOnly);
  const entry = (m: StressModel) => recs.map((r) => ({ id: r.key.boxId, group: sp.get(imageOf(r.key.boxId))!.group, workId: r.workId!, vec: p.vec(r, m) }));
  const gallery = { siglip2: entry("siglip2"), dinov2: entry("dinov2") };
  const key = (w: string) => p.works["pilot-000"].get(w)?.key ?? w;
  const visual = {} as Calibration["visual"];
  for (const m of MM2.stressModels) {
    const g = gallery[m];
    const across: number[] = [], within: number[] = [], all: number[] = [];
    for (let i = 0; i < g.length; i++)
      for (let j = i + 1; j < g.length; j++) {
        if (g[i]!.workId !== g[j]!.workId) continue;
        let s = 0;
        for (let k = 0; k < g[i]!.vec.length; k++) s += g[i]!.vec[k]! * g[j]!.vec[k]!;
        all.push(s);
        if (g[i]!.group !== g[j]!.group) across.push(s);
        else if (imageOf(g[i]!.id) === imageOf(g[j]!.id)) within.push(s);
      }
    visual[m] = { ...visualThreshold(across, within), median: quantile(all, 0.5) };
  }
  // τt: train visual lookalikes (SigLIP 2, other split groups, other books) and the text side's agreement.
  const tauV = visual.siglip2.tau;
  const texts: number[] = [];
  for (const r of recs) {
    const q = p.vec(r, "siglip2");
    const group = sp.get(imageOf(r.key.boxId))!.group;
    const ws = new Set(nearestEntries(q, group, gallery.siglip2).filter((n) => n.cos >= tauV).map((n) => gallery.siglip2[n.entry]!.workId).filter((w) => key(w) !== key(r.workId!)));
    if (!ws.size) continue;
    const t = textAgreement(p.dbs["pilot-000"], variantsBy(r), [...ws]);
    for (const n of nearestEntries(q, group, gallery.siglip2)) {
      if (n.cos < tauV) break;
      const w = gallery.siglip2[n.entry]!.workId;
      if (key(w) !== key(r.workId!)) texts.push(t.get(w)!);
    }
  }
  // δ: train boxes with an F-0 readers-agree accept in their pool.
  const base = decisionsOf("pilot-000");
  const pool = poolOf(p);
  const rows: { margin: number | null; agrees: boolean }[] = [];
  for (const r of p.records) {
    const d = base.get(r.key.boxId);
    if (!r.strip.valid || sp.get(imageOf(r.key.boxId))?.split !== "train" || !d?.accepted) continue;
    const pl = pool(r, "title");
    if (!pl.some((x) => x.workId === d.accepted!.workId)) continue;
    const f = freeArm(p.vec(r, "siglip2"), pl, 0);
    rows.push({ margin: f.margin, agrees: f.top?.workId === d.accepted.workId });
  }
  const m = JSON.parse(readFileSync(join(ROOT, "datasets", "label-ledger", MM2.ledger, "manifest.json"), "utf8")) as { photos: { nearDuplicates: string[] }[] };
  return {
    gallery,
    recs,
    cal: {
      gallery: { entries: recs.length, works: new Set(recs.map((r) => r.workId)).size, groups: new Set(gallery.siglip2.map((e) => e.group)).size, photos: new Set(recs.map((r) => imageOf(r.key.boxId))).size },
      visual,
      // Diagnostics beside the rule (not part of it): how the text side and the margin behave at each grid value.
      text: { ...textThreshold(texts), lookalikes: texts.length, max: texts.length ? Math.max(...texts) : null, atOrAbove: Object.fromEntries(APPEARANCE.text.grid.map((g) => [g, texts.filter((t) => t >= g).length])) },
      margin: {
        ...marginThreshold(rows),
        rows: rows.length,
        byDelta: Object.fromEntries(APPEARANCE.free.grid.map((d) => {
          const made = rows.filter((x) => x.margin !== null && x.margin >= d);
          return [d, { proposals: made.length, agreement: made.length ? r4(made.filter((x) => x.agrees).length / made.length) : null }];
        })),
      },
      nearDuplicateFlags: m.photos.reduce((s, x) => s + x.nearDuplicates.length, 0),
    },
  };
}

function decisionsOf(set: Mm2Set): Map<string, SpineDecision> {
  const p = join(ROOT, "private", "h2", H2[set], "base-decisions.jsonl");
  if (!existsSync(p)) throw new Error(`no cached F-0 decisions for ${set}`);
  return new Map(readJsonl<SpineDecision>(p).map((d) => [d.id, d]));
}

/** A record's gallery-free pool: its readers' ranked works with their title vectors (works without one dropped). */
function poolOf(c: Ctx) {
  const td = textDir();
  const cache = new Map<string, Float32Array | null>();
  return (r: MmRecord, t: Template): { workId: string; vec: Float32Array }[] => {
    const ids = [...new Set(Object.values(c.ranked.get(r.key.boxId) ?? {}).flat())];
    const out: { workId: string; vec: Float32Array }[] = [];
    for (const id of ids) {
      const w = c.works[c.set].get(id);
      if (!w) continue;
      const k = textKey(t, titleText(t, w.title, w.authors));
      if (!cache.has(k)) cache.set(k, existsSync(join(td, `${k}.f32`)) ? readF32(join(td, `${k}.f32`)) : null);
      const v = cache.get(k);
      if (v) out.push({ workId: id, vec: v });
    }
    return out;
  };
}

function context(set: Mm2Set, dbs: Record<Mm2Set, DatabaseSync>): Ctx {
  const meta = join(PRIV, set, "ranked.json");
  if (!existsSync(meta)) throw new Error(`${set}: no ranked lists (run \`mm2-cli.ts ranked ${set}\`)`);
  return {
    set,
    records: loadRecords(set).rows,
    dbs,
    works: { "pilot-000": loadWorks("pilot-000"), yardstick: set === "yardstick" ? loadWorks("yardstick") : new Map() },
    ranked: new Map(readJsonl<RankedRow>(rankedPath(set)).map((r) => [r.id, r.ranked])),
    vec: vecOf(set),
  };
}

function shadow(set: Mm2Set): void {
  if (!shadowOnly(appearanceMode())) return log("appearance is off (the default): nothing to do; pass --appearance shadow");
  const t0 = Date.now();
  const dbs = { "pilot-000": openCatalog(CATALOG["pilot-000"]), yardstick: set === "yardstick" ? openCatalog(CATALOG.yardstick) : (null as unknown as DatabaseSync) };
  const sp = splits();
  const pilot = context("pilot-000", dbs);
  const { gallery, cal } = calibrate(pilot, sp);
  writeAtomic(join(dir(), "calibration.json"), JSON.stringify(cal) + "\n");
  log(`calibrated on ${cal.gallery.entries} train entries: τv ${r4(cal.visual.siglip2.tau)}, τt ${cal.text.tau}, δ ${cal.margin.delta}`);
  const c = set === "pilot-000" ? pilot : context(set, dbs);
  const db = dbs[set];
  const base = decisionsOf(set);
  const truth = set === "yardstick" ? yardstickTruth() : null;
  const keysByImage = new Map<string, Set<string>>();
  const truthKeys = (img: string): Set<string> => {
    if (!keysByImage.has(img)) {
      const t = [...(truth?.get(img) ?? [])];
      const found = worksOf(db, t.filter((w) => !c.works.yardstick.has(w)));
      keysByImage.set(img, new Set(t.map((w) => c.works.yardstick.get(w)?.key ?? found.get(w)?.key ?? w)));
    }
    return keysByImage.get(img)!;
  };
  const keyP = (w: string) => pilot.works["pilot-000"].get(w)?.key ?? w;
  const galleryKeys = new Set(gallery.siglip2.map((e) => keyP(e.workId)));
  /** Yardstick only: is a work (of either catalog) an annotated book of the image? */
  const rightOf = (img: string, w: string | null, galleryWork: boolean): boolean | null => {
    if (!truth || !w) return null;
    if (!galleryWork && truth.get(img)?.has(w)) return true;
    return truthKeys(img).has(galleryWork ? keyP(w) : (c.works.yardstick.get(w)?.key ?? w));
  };
  const floors = Object.fromEntries(MM2.stressModels.map((m) => [m, Math.min(...[cal.visual[m].tau, cal.visual[m].acrossGroups, cal.visual[m].withinPhoto, cal.visual[m].median].filter((x): x is number => x !== null))]));
  const floor = (m: StressModel): number => floors[m]!;
  const pool = poolOf(c);
  const photos = new Map<string, number>();
  const rows: ShadowRow[] = [];
  let mismatch = 0;
  for (const r of c.records) {
    const id = r.key.boxId, img = imageOf(id);
    const d = base.get(id);
    if (!d) throw new Error(`${set}: a record with no cached F-0 decision`);
    if (!photos.has(img)) photos.set(img, photos.size);
    const s = set === "pilot-000" ? sp.get(img) : { split: "eval" as const, group: "yardstick" };
    if (!s || s.split === "held-out") throw new Error(`${set}: a photo with no F-1 split`);
    const votes = { readText: d.readText, top: d.top, confirmed: d.confirmed };
    if (simulateCandidate(votes, null, () => false).acceptedId !== (d.accepted?.workId ?? null)) mismatch++;
    const vs = variantsBy(r);
    const hasText = Object.values(vs).some((v) => v && v.length);
    const f0: ShadowRow["f0"] = { accepted: d.accepted?.workId ?? null, agreeing: d.agreeing, reason: d.reason, readText: d.readText, top: d.top, confirmed: d.confirmed, right: truth ? (d.accepted ? truth.get(img)?.has(d.accepted.workId) ?? false : null) : null };
    const row: ShadowRow = { schemaVersion: MM2.schemaVersion, id, set, split: s.split, group: s.group, photo: photos.get(img)!, f0, label: r.workId, inGallery: false, validStrip: r.strip.valid, gallery: null, free: null, stress: { siglip2: [], dinov2: [] } };
    row.inGallery = truth ? [...truthKeys(img)].some((k) => galleryKeys.has(k)) : !!f0.accepted && galleryKeys.has(keyP(f0.accepted));
    // The query's own book for the lookalike kind: F-0's accept (on the yardstick, only when it is an annotated book).
    const ownKey = f0.accepted && (!truth || f0.right) ? (truth ? (c.works.yardstick.get(f0.accepted)?.key ?? null) : keyP(f0.accepted)) : null;
    if (r.strip.valid) {
      // Gallery arm, and the stress pairs: visual lookalikes of this box at or above the floor threshold.
      const lookalike = (w: string): boolean =>
        set === "yardstick" ? hasText && !truthKeys(img).has(keyP(w)) : !!f0.accepted && keyP(w) !== keyP(f0.accepted);
      const near: Record<StressModel, ReturnType<typeof nearestEntries>> = { siglip2: nearestEntries(c.vec(r, "siglip2"), s.group, gallery.siglip2), dinov2: nearestEntries(c.vec(r, "dinov2"), s.group, gallery.dinov2) };
      const need = new Set<string>();
      for (const n of near.siglip2.slice(0, APPEARANCE.gallery.depth)) if (n.cos >= cal.visual.siglip2.tau) need.add(gallery.siglip2[n.entry]!.workId);
      for (const m of MM2.stressModels) for (const n of near[m]) {
        if (n.cos < floor(m)) break;
        if (lookalike(gallery[m][n.entry]!.workId)) need.add(gallery[m][n.entry]!.workId);
      }
      const text = textAgreement(dbs["pilot-000"], vs, [...need]);
      const g = galleryArm(near.siglip2, gallery.siglip2, (w) => text.get(w) ?? 0, cal.visual.siglip2.tau, cal.text.tau);
      const gs = simulateCandidate(votes, g.proposal, passesBar(dbs["pilot-000"], vs));
      row.gallery = { ...g, proposalRight: rightOf(img, g.proposal, true), simulated: gs, simulatedRight: rightOf(img, gs.acceptedId, gs.takers.length > 0 && gs.acceptedId === g.proposal) };
      for (const m of MM2.stressModels) for (const n of near[m]) {
        if (n.cos < floor(m)) break;
        const w = gallery[m][n.entry]!.workId;
        if (!lookalike(w)) continue;
        if (m === "siglip2") row.stress.siglip2.push({ cos: r4(n.cos), text: r4(text.get(w) ?? 0), proposed: g.proposal === w, kind: lookalikeKind(ownKey, keyP(w)) });
        else row.stress.dinov2.push({ cos: r4(n.cos), text: r4(text.get(w) ?? 0) });
      }
      // Gallery-free arm: image-to-title over the text path's own candidates.
      if (hasText) {
        const f = freeArm(c.vec(r, "siglip2"), pool(r, "title"), cal.margin.delta);
        const f2 = freeArm(c.vec(r, "siglip2"), pool(r, "title+author"), cal.margin.delta);
        const fs = simulateCandidate(votes, f.proposal, passesBar(db, vs));
        row.free = { ...f, proposalRight: rightOf(img, f.proposal, false), simulated: fs, simulatedRight: rightOf(img, fs.acceptedId, false), secondary: { top: f2.top?.workId ?? null, margin: f2.margin, proposal: f2.proposal } };
      }
    }
    assertUnchanged({ accepted: d.accepted?.workId ?? null, agreeing: d.agreeing, reason: d.reason, confirmed: d.confirmed }, row.f0);
    rows.push(ShadowRow.parse(row));
  }
  if (mismatch) throw new Error(`${set}: F-0's vote does not reproduce ${mismatch} cached decision(s)`);
  writeAtomic(join(dir(set), "shadow.jsonl"), rows.map((x) => JSON.stringify(x)).join("\n") + "\n");
  log(`${set}: ${rows.length} shadow rows in ${Math.round((Date.now() - t0) / 1000)} s`);
}

// --- analyse: aggregates only --------------------------------------------------------------------------------------

type Tri = [number, number, number] | null;
const tri = (i: Interval | null): Tri => (i ? [r4(i.value), r4(i.lo), r4(i.hi)] : null);

function analyseSet(set: Mm2Set, cal: Calibration) {
  const all = readJsonl<unknown>(join(PRIV, set, "shadow.jsonl")).map((x) => ShadowRow.parse(x));
  if (!all.length) throw new Error(`${set}: no shadow rows (run \`mm2-cli.ts shadow ${set} --appearance shadow\`)`);
  // Queries: pilot-000's val photos (held-out split groups); every yardstick photo. Photos re-indexed for the bootstrap.
  const q = all.filter((r) => r.split !== "train");
  const idx = new Map<number, number>();
  const rows = q.map((r) => {
    if (!idx.has(r.photo)) idx.set(r.photo, idx.size);
    return { ...r, photo: idx.get(r.photo)! };
  });
  const n = idx.size;
  const boot = (f: (m: ArrayLike<number>) => number | null) => tri(pairBootstrap(n, f));
  const outcomes = ["accepted", "no-text", "no-catalog-match", "single-reader", "readers-disagree"] as const;
  const outcome = (r: ShadowRow) => (r.f0.accepted ? "accepted" : r.f0.reason!);
  const yard = set === "yardstick";
  const arm = (a: "gallery" | "free") => ({
    coverage: boot((m) => shareOf(rows, (r) => r.validStrip, (r) => !!r[a]?.proposal, m)),
    coverageBy: Object.fromEntries(outcomes.map((o) => [o, boot((m) => shareOf(rows, (r) => r.validStrip && outcome(r) === o, (r) => !!r[a]?.proposal, m))])),
    agreement: boot((m) => shareOf(rows, (r) => !!r.f0.accepted && !!r[a]?.proposal, (r) => r[a]!.proposal === r.f0.accepted, m)),
    agreementRight: yard ? boot((m) => shareOf(rows, (r) => !!r.f0.accepted && !!r[a]?.proposal, (r) => r[a]!.proposalRight === true, m)) : undefined,
    proposals: rows.filter((r) => r[a]?.proposal).length,
    takers: rows.filter((r) => (r[a]?.simulated.takers.length ?? 0) > 0).length,
    newAccepts: boot((m) => countOf(rows, (r) => newAccept(r, a), m)),
    newAcceptsN: rows.filter((r) => newAccept(r, a)).length,
    newWrong: yard ? rows.filter((r) => newAccept(r, a) && r[a]!.simulatedRight === false).length : undefined,
    newRight: yard ? rows.filter((r) => newAccept(r, a) && r[a]!.simulatedRight === true).length : undefined,
    newWrongCi: yard ? boot((m) => countOf(rows, (r) => newAccept(r, a) && r[a]!.simulatedRight === false, m)) : undefined,
  });
  const nearOnly = boot((m) => shareOf(rows, (r) => r.validStrip, (r) => (r.gallery?.nearOnly.length ?? 0) > 0, m));
  const stress = (model: StressModel) => {
    const pairs = stressPairs(rows, model);
    const v = cal.visual[model];
    const at = (t: number | null) => {
      if (t === null) return null;
      const above = pairs.filter((p) => p.s >= t);
      return {
        threshold: r4(t),
        pairs: above.length,
        queries: new Set(rows.filter((r) => r.stress[model].some((p) => p.cos >= t)).map((r) => r.id)).size,
        passText: above.filter((p) => p.text >= cal.text.tau).length,
        passTextShare: boot((m) => {
          let w = 0, k = 0;
          for (const p of above) (w += m[p.a]!), (k += p.text >= cal.text.tau ? m[p.a]! : 0);
          return w > 0 ? k / w : null;
        }),
        proposed: model === "siglip2" ? above.filter((p) => p.proposed).length : null,
      };
    };
    return { tau: at(v.tau), acrossGroups: at(v.acrossGroups), withinPhoto: at(v.withinPhoto), median: at(v.median) };
  };
  return {
    scope: yard ? "PROXY (library shelves), evaluation only; truth = the image's annotated works (OC35)" : "real use, F-1 val split groups: machine agreement, never accuracy (INV-17)",
    photos: n,
    queries: rows.length,
    validStrips: rows.filter((r) => r.validStrip).length,
    withText: rows.filter((r) => r.free).length,
    byOutcome: Object.fromEntries(outcomes.map((o) => [o, rows.filter((r) => outcome(r) === o).length])),
    f0WrongAccepts: yard ? rows.filter((r) => r.f0.right === false).length : undefined,
    f0Accepts: rows.filter((r) => r.f0.accepted).length,
    inGallery: rows.filter((r) => r.inGallery).length,
    passingKinds: Object.fromEntries(LOOKALIKE_KINDS.map((k) => [k, rows.reduce((s, r) => s + r.stress.siglip2.filter((p) => p.cos >= cal.visual.siglip2.tau && p.text >= cal.text.tau && p.kind === k).length, 0)])),
    poolMedian: quantile(rows.filter((r) => r.free).map((r) => r.free!.pool), 0.5),
    gallery: { ...arm("gallery"), nearOnly },
    free: { ...arm("free"), secondaryAgreement: boot((m) => shareOf(rows, (r) => !!r.f0.accepted && !!r.free?.secondary.proposal, (r) => r.free!.secondary.proposal === r.f0.accepted, m)) },
    stress: { siglip2: stress("siglip2"), dinov2: stress("dinov2") },
  };
}

const MARK = "<!-- generated by `node src/eval/mm2-cli.ts analyse`: edit above this line -->";

function analyse(): void {
  const cal = JSON.parse(readFileSync(join(PRIV, "calibration.json"), "utf8")) as Calibration;
  const sets = Object.fromEntries(MM2.sets.map((s) => [s, analyseSet(s, cal)])) as Record<Mm2Set, ReturnType<typeof analyseSet>>;
  const runs = readJsonl<{ set: string; texts: number; embedded?: number; seconds?: number; wallSeconds: number }>(join(PRIV, "text-runs.jsonl"));
  const p = sets["pilot-000"], y = sets.yardstick;
  const k1 = p.stress.siglip2.tau!.passText === 0 && y.stress.siglip2.tau!.passText === 0;
  const keep = (a: "gallery" | "free") => {
    const K2 = y[a].newWrong === 0;
    const K3 = (p[a].newAccepts?.[1] ?? 0) > 0 || (y[a].newRight ?? 0) > 0;
    const K1 = a === "gallery" ? k1 : null;
    return { K1, K2, K3, passes: (K1 ?? true) && K2 && K3 };
  };
  const m = {
    runId: "MM2",
    card: "MM-2",
    note: "Aggregates only. Shadow rows, ranked lists and text vectors are private (data root, private/mm2/). pilot-000 is machine agreement on F-1's val split groups, never accuracy (INV-17); the yardstick is PROXY and evaluation only. Never pooled (OC35). Shadow mode: no decision changes. Promotion to candidate is the owner's ruling; one shop so far, so no cross-shop claim.",
    appearance: "shadow (MM-2's runner only; the default stays off)",
    ledger: MM2.ledger,
    model: APPEARANCE.model,
    bootstrap: { ...MM2.bootstrap, cluster: "query photo; gallery fixed" },
    calibration: cal,
    textTower: { device: "cpu", texts: runs.reduce((s, r) => s + r.texts, 0), embedded: runs.reduce((s, r) => s + (r.embedded ?? 0), 0), wallSeconds: runs.reduce((s, r) => s + r.wallSeconds, 0), gpuSeconds: 0 },
    sets,
    keep: { gallery: keep("gallery"), free: keep("free") },
  };
  const out = join(REPO, "evals", "MM2");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "metrics.json"), compactJson(m) + "\n");
  const rp = join(out, "report.md");
  const text = existsSync(rp) ? readFileSync(rp, "utf8") : "# MM-2 · multimodal self-gallery, shadow mode\n\n";
  const head = text.includes(MARK) ? text.slice(0, text.indexOf(MARK)) : text.trimEnd() + "\n\n";
  writeFileSync(rp, head + MARK + "\n\n" + tablesMd(m));
  log("analyse: evals/MM2/{metrics.json,report.md}");
}

const f3 = (t: Tri | undefined) => (t ? `${t[0].toFixed(3)} (${t[1].toFixed(3)}–${t[2].toFixed(3)})` : "–");
const pc = (t: Tri | undefined) => (t ? `${(100 * t[0]).toFixed(1)} % (${(100 * t[1]).toFixed(1)}–${(100 * t[2]).toFixed(1)})` : "–");
const ct = (t: Tri | undefined) => (t ? `${t[0].toFixed(0)} (${t[1].toFixed(0)}–${t[2].toFixed(0)})` : "–");
const yn = (b: boolean | null) => (b === null ? "n/a" : b ? "pass" : "**fail**");

function tablesMd(m: { calibration: Calibration; textTower: { texts: number; wallSeconds: number }; sets: Record<Mm2Set, ReturnType<typeof analyseSet>>; keep: Record<"gallery" | "free", { K1: boolean | null; K2: boolean; K3: boolean; passes: boolean }> }): string {
  const c = m.calibration;
  const o: string[] = [];
  o.push("## Gallery and thresholds (pilot-000 train only)\n");
  o.push(`Gallery: ${c.gallery.entries} confirmed copies of ${c.gallery.works} works, ${c.gallery.photos} photos in ${c.gallery.groups} split groups. Near-duplicate flags in the manifest: ${c.nearDuplicateFlags}.\n`);
  o.push("| model | same-work pairs across groups / within a photo | 10th pct across groups | 10th pct within a photo | τv (lower) | median (MM-1 style) |\n|---|---|---:|---:|---:|---:|");
  for (const k of MM2.stressModels) {
    const v = c.visual[k];
    const f = (x: number | null) => (x === null ? "–" : x.toFixed(3));
    o.push(`| ${k} | ${v.pairs.acrossGroups} / ${v.pairs.withinPhoto} | ${f(v.acrossGroups)} | ${f(v.withinPhoto)} | ${f(v.tau)} | ${f(v.median)} |`);
  }
  o.push(`\nτt = ${c.text.tau} (${c.text.calibrated ? "calibrated" : "**not calibrated: fallback**"}; ${c.text.lookalikes} train lookalike pairs, highest text agreement ${c.text.max === null ? "–" : c.text.max.toFixed(3)}). δ = ${c.margin.delta} (${c.margin.calibrated ? "calibrated" : "**not calibrated: fallback**"}; ${c.margin.rows} train accepts in their pool, ${c.margin.proposals} proposals at δ, agreement ${c.margin.agreement === null ? "–" : (100 * c.margin.agreement).toFixed(1) + " %"}). Text tower: ${m.textTower.texts} texts on the CPU in ${m.textTower.wallSeconds} s; no GPU time.\n`);
  o.push("## Keep rule (for a promotion to `candidate`: the owner rules)\n");
  o.push("| arm | K1 lookalike stress | K2 no new yardstick wrong accepts | K3 a gain | verdict |\n|---|---|---|---|---|");
  for (const a of ["gallery", "free"] as const) o.push(`| ${a === "gallery" ? "gallery" : "gallery-free"} | ${yn(m.keep[a].K1)} | ${yn(m.keep[a].K2)} | ${yn(m.keep[a].K3)} | ${m.keep[a].passes ? "passes: may be put to the owner" : "stays in shadow"} |`);
  o.push("");
  for (const [s, v] of Object.entries(m.sets) as [Mm2Set, ReturnType<typeof analyseSet>][]) {
    const yard = s === "yardstick";
    o.push(`## ${s}${yard ? " (PROXY, evaluation only)" : " val (real use: machine agreement, never accuracy)"}\n`);
    o.push(`${v.photos} photos, ${v.queries} queries (${v.validStrips} valid strips, ${v.withText} with text). F-0: ${v.f0Accepts} accepted${yard ? `, ${v.f0WrongAccepts} of them wrong` : ""}; ${Object.entries(v.byOutcome).filter(([k]) => k !== "accepted").map(([k, x]) => `${x} ${k}`).join(", ")}. Median pool: ${v.poolMedian ?? "–"} works. ${yard ? "Boxes in an image with an annotated book" : "F-0-accepted boxes whose work"} the gallery holds (book key): ${v.inGallery}.\n`);
    o.push("| measure | gallery | gallery-free |\n|---|---|---|");
    const row = (name: string, f: (x: any) => string) => o.push(`| ${name} | ${f(v.gallery)} | ${f(v.free)} |`);
    row("S1 proposal share (valid strips)", (x) => pc(x.coverage));
    for (const k of Object.keys(v.byOutcome)) row(`S1 … on F-0 \`${k}\``, (x) => pc(x.coverageBy[k]));
    row("S2 proposal = F-0's accept", (x) => pc(x.agreement));
    if (yard) row("S2 proposal is an annotated book (on accepted)", (x) => pc(x.agreementRight));
    row("proposals / boxes where a reader takes one", (x) => `${x.proposals} / ${x.takers}`);
    row("S3 new accepts (candidate simulation)", (x) => `${x.newAcceptsN} — ${ct(x.newAccepts)}`);
    if (yard) row("S3 new wrong / new right accepts", (x) => `${x.newWrong} / ${x.newRight}`);
    o.push(`\nGallery \`near-only\` (near but the text side fails): ${pc(v.gallery.nearOnly)}. Gallery-free, secondary template (\`title+author\`), proposal = F-0's accept: ${pc(v.free.secondaryAgreement)}.\n`);
    o.push(`### L1 lookalike stress test (${s})\n`);
    o.push("| model | threshold | value | lookalike pairs (queries) | pass the text side | share (95 %) | became the proposal |\n|---|---|---:|---:|---:|---|---:|");
    for (const k of MM2.stressModels)
      for (const t of ["tau", "acrossGroups", "withinPhoto", "median"] as const) {
        const x = v.stress[k][t];
        if (!x) continue;
        o.push(`| ${k} | ${t === "tau" ? "τv" : t} | ${x.threshold.toFixed(3)} | ${x.pairs} (${x.queries}) | ${x.passText} | ${pc(x.passTextShare)} | ${x.proposed ?? "–"} |`);
      }
    o.push(`\nSigLIP 2 lookalike pairs passing the text side at τv, by kind: ${Object.entries(v.passingKinds).map(([k, x]) => `${x} ${k}`).join(", ")}.\n`);
  }
  return o.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, set] = process.argv.slice(2);
  if (cmd === "analyse") analyse();
  else if (cmd === "ranked" && isSet(set)) ranked(set);
  else if (cmd === "texts" && isSet(set)) await texts(set);
  else if (cmd === "shadow" && isSet(set)) shadow(set);
  else {
    console.error("usage: mm2-cli.ts ranked|texts <pilot-000|yardstick> | shadow <set> --appearance shadow | analyse");
    process.exit(2);
  }
}
