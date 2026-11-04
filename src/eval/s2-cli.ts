// S-2 runner: the headroom map, from H-2's cached depth stage and F-0i's instance partition, CPU only
// (pre-registered in evals/S2/report.md).
//
//   node src/eval/s2-cli.ts stage <set>      # helpers/depth/stage.py on H-2's cache: keys per photo (all hits)
//   node src/eval/s2-cli.ts shelf <set>      # helpers/shelf/shelf.py on the partition: rows, planes, voids (+ box shares)
//   node src/eval/s2-cli.ts headroom <set>   # helpers/shelf/headroom.py: regions, classes, occupied regions; F-0k's and Q-3's files
//   node src/eval/s2-cli.ts spot             # the pre-registered blind spot-check sheet (pilot-000, private)
//   node src/eval/s2-cli.ts analyse          # evals/S2/{metrics.json,report.md}: aggregates only
//   node src/eval/s2-cli.ts render <set>     # the data root's private/s2/renders/<set>/ (private still study)
//
// Sets (OC35, never merged): pilot-000 with F-0e's `bands+strips` boxes, the yardstick with F-0's B2 boxes; both after
// the shipped not-a-book filter and F-0i's partition of it (kept box set, exclusive outlines). Everything per photo,
// row, region or box goes under the data root's `private/s2/`.
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dataRoot } from "../ledger/images.ts";
import { readJsonl, type Detection } from "./f0.ts";
import { kinds } from "./f0c.ts";
import { imagesOf, SETS, type SetName } from "./f0c-cli.ts";
import type { Tri } from "./f0e.ts";
import { evidenceFor } from "./f0f-cli.ts";
import { compactJson } from "./q1-cli.ts";
import { clusterBootstrap, quantile, rate, rng } from "./q1.ts";
import { applyOnLip, ELEVATIONS, elevationOf, pitches, type Elevation, type LipFeatures, type ShelfRow } from "./s1.ts";
import {
  adequacy,
  checkKinds,
  CLASS_KEYS,
  classShare,
  explainedByKnown,
  frontNoBox,
  headroomShare,
  inHeadroom,
  partitionTops,
  recalled,
  S2,
  unknownPx,
  type ClassKey,
  type HeadroomRow,
  type KnownBox,
  type KnownRec,
  type Region,
  type RegionRec,
  type RowRec,
} from "./s2.ts";

type Point = [number, number];
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const ROOT = dataRoot();
const PRIV = join(ROOT, "private", "s2");
const H2_CACHE = join(ROOT, "private", "h2", "cache");
const F0I_SET: Record<SetName, string> = { "pilot-000": "pilot-000", yardstick: "yardstick-library-b2" };
const NAMES: SetName[] = ["pilot-000", "yardstick"];
const REPS = 2000;
/** `--first N`: a smoke run on the first N photos in input order (crashes only, never a measure). */
const FIRST = process.argv.includes("--first") ? Number(process.argv[process.argv.indexOf("--first") + 1]) : undefined;
const setDir = (set: SetName): string => {
  const d = join(PRIV, set, FIRST ? "smoke" : "");
  mkdirSync(d, { recursive: true });
  return d;
};
const log = (s: string): void => console.error(`[s2] ${s}`);
const isSet = (s: string | undefined): s is SetName => s === "pilot-000" || s === "yardstick";
const py = (helper: string) => {
  const p = join(REPO, "helpers", helper, ".venv", "bin", "python");
  if (!existsSync(p)) throw new Error(`helpers/${helper} has no .venv: run \`uv sync\` there first`);
  return p;
};
const loadDets = (path: string): Map<string, Detection> => new Map(readJsonl<Detection>(path).filter((d) => !d.error).map((d) => [d.id, d]));
/** F-0c's detections: the base's spines and bands verbatim, plus the cover pass's boxes (as S-1 reads them). */
const detsOf = (set: SetName) => loadDets(join(ROOT, "f0c", set, "detect.jsonl"));

function spawnTo(out: string, args: string[], what: string): void {
  const fd = openSync(out, "w");
  const r = spawnSync(py("depth"), args, { stdio: ["ignore", fd, "inherit"] });
  closeSync(fd);
  if (r.status !== 0) throw new Error(`${what} failed`);
}

// --- inputs ------------------------------------------------------------------------------------------------

interface PartRow {
  id: string;
  state: "kept" | "dropped";
  reason: string | null;
  outline?: Point[];
}

/** F-0i's partition by photo, then by box index. */
function partitionOf(set: SetName): Map<string, Map<number, PartRow>> {
  const p = join(ROOT, "private", "f0i", F0I_SET[set], "partition.jsonl");
  if (!existsSync(p)) throw new Error(`${set}: no F-0i partition at the data root's private/f0i/`);
  const out = new Map<string, Map<number, PartRow>>();
  for (const r of readJsonl<PartRow>(p)) {
    const k = r.id.lastIndexOf(":");
    const photo = r.id.slice(0, k);
    if (!out.has(photo)) out.set(photo, new Map());
    out.get(photo)!.set(Number(r.id.slice(k + 1)), r);
  }
  return out;
}

interface StagePhoto {
  id: string;
  geometryKey: string;
  facesKey: string;
}

function stage(set: SetName): void {
  const dir = join(PRIV, set);
  mkdirSync(dir, { recursive: true });
  const images = join(dir, "images.jsonl");
  writeFileSync(images, imagesOf(set).map((i) => JSON.stringify({ id: i.id, image: i.path })).join("\n") + "\n");
  const out = join(dir, "stage.jsonl");
  // The same detections and options as H-2 (and S-1), so its keys decide what is reused.
  const args = ["-I", join(REPO, "helpers", "depth", "stage.py"), "--images", images, "--detect", join(SETS[set].base, "detect.jsonl"), "--cache", H2_CACHE, "--exif-fov"];
  // CPU lane: a geometry miss would load MoGe-2 on the GPU, so every photo's geometry must already be cached.
  spawnTo(out, [...args, "--keys"], `stage.py --keys on ${set}`);
  const missing = readJsonl<{ path: string }>(out).filter((k) => !existsSync(k.path)).length;
  if (missing) throw new Error(`${set}: ${missing} photos have no cached geometry; S-2 runs on the CPU only`);
  spawnTo(out, args, `stage.py on ${set}`);
  const photos = readJsonl<{ photo?: boolean; hit?: { geometry: boolean; faces: boolean } }>(out).filter((x) => x.photo);
  log(`${set}: ${photos.length} photos, ${photos.filter((p) => !p.hit?.geometry || !p.hit?.faces).length} cache misses`);
}

function stagePhotos(set: SetName): Map<string, StagePhoto> {
  const path = join(PRIV, set, "stage.jsonl");
  if (!existsSync(path)) throw new Error(`${set}: run \`s2-cli.ts stage ${set}\` first`);
  return new Map(readJsonl<StagePhoto & { photo?: boolean }>(path).filter((x) => x.photo).map((x) => [x.id, x]));
}

const geometryDir = (key: string) => join(H2_CACHE, "geometry", "moge-2-vitl-normal@cb0e8bb", `${key}.npz`);

/** Per photo: its detection, the shipped kinds, the partition and the depth stage's files. */
function photos(set: SetName) {
  const dets = detsOf(set);
  const keys = stagePhotos(set);
  const ev = evidenceFor(set);
  const part = partitionOf(set);
  return [...dets.values()].slice(0, FIRST ?? Infinity).flatMap((d) => {
    const k = keys.get(d.id);
    const p = part.get(d.id);
    if (!k || !p) return [];
    const shipped = kinds({ ...d, covers: [] }, ev.get(d.id)).spines;
    return [{ d, shipped, part: p, npz: geometryDir(k.geometryKey), faces: join(H2_CACHE, "faces", k.geometryKey, `${k.facesKey}.json`), classmap: join(H2_CACHE, "faces", k.geometryKey, `${k.facesKey}.png`) }];
  });
}

// --- shelf: S-1's rows on the partition -----------------------------------------------------------------

function shelf(set: SetName): void {
  const dir = setDir(set);
  const lines = photos(set).map(({ d, part, npz, faces, classmap }) => {
    const outlines: Record<number, Point[]> = {};
    for (const [i, r] of part) if (r.state === "kept" && r.outline && r.outline.length >= 3) outlines[i] = r.outline;
    return JSON.stringify({
      id: d.id,
      width: d.width,
      height: d.height,
      npz,
      faces,
      classmap,
      spines: d.spines.map((s, i) => ({ polygon: s.polygon, kept: part.get(i)?.state === "kept" })),
      outlines,
      covers: (d.covers ?? []).map((c) => ({ polygon: c.polygon })),
      bands: d.bands.map((b) => ({ polygon: b.polygon })),
      medianWidth: d.gaps.medianWidth,
      anyBoxes: [...d.spines.map((s) => s.polygon), ...(d.covers ?? []).map((c) => c.polygon)],
    });
  });
  const inputs = join(dir, "shelf-inputs.jsonl");
  writeFileSync(inputs, lines.join("\n") + "\n");
  log(`${set}: shelf rows on the partition over ${lines.length} photos`);
  spawnTo(join(dir, "shelf.jsonl"), ["-I", join(REPO, "helpers", "shelf", "shelf.py"), "--inputs", inputs, "--maps", join(dir, "shelf-maps")], `shelf.py on ${set}`);
}

interface Plane {
  found: boolean;
  inliers: number;
  normal?: number[];
  d?: number;
  up?: [number, number];
  side?: [number, number];
}
interface Stretch {
  from: number;
  to: number;
  kind: "void" | "outline-gap";
  behind: number | null;
  dominant?: string;
  where?: "end" | "interior";
  segments?: [number, number];
  boxShare?: number | null;
}
type SRow = ShelfRow & { spineOffset?: number; planes?: Record<"board" | "lip" | "back", Plane>; voids?: { lengthW: number; stretches: Stretch[] } };
interface ShelfOut {
  id: string;
  rows: SRow[];
  boxes: (LipFeatures | null)[];
}

function shelfOut(set: SetName): Map<string, ShelfOut> {
  const path = join(setDir(set), "shelf.jsonl");
  if (!existsSync(path)) throw new Error(`${set}: run \`s2-cli.ts shelf ${set}\` first`);
  return new Map(readJsonl<ShelfOut>(path).map((x) => [x.id, x]));
}

// --- headroom ----------------------------------------------------------------------------------------------

interface HeadroomOut {
  id: string;
  rows: (HeadroomRow & { aboveBand?: number; topLine?: Point[]; boardLine?: Point[] })[];
  regions: (Region & { contour: Point[]; rect: Point[]; aboveTopM: number; dSpineM: number; classes: Record<string, number> })[];
  known: KnownBox[];
  seconds: number;
}

function headroom(set: SetName): void {
  const dir = setDir(set);
  const sh = shelfOut(set);
  const lines: string[] = [];
  for (const { d, shipped, part, npz, faces } of photos(set)) {
    const s = sh.get(d.id);
    if (!s) continue;
    const kept = [...part].filter(([, r]) => r.state === "kept").map(([i]) => i).sort((a, b) => a - b);
    const outlines = new Map(kept.flatMap((i) => (part.get(i)!.outline ? [[i, part.get(i)!.outline!] as const] : [])));
    const onLip = new Set(applyOnLip({ spines: shipped, covers: [], dropped: [], spineHeight: null, medianWidth: 0 }, d, s.boxes).spines.flatMap((b, i) => (b.why === "on-lip" ? [i] : [])));
    const checks = checkKinds(d, shipped, part, onLip);
    const tops = partitionTops(d, kept, outlines);
    const rows = s.rows.filter((r) => !r.skip && r.frame);
    const ps = pitches(rows);
    lines.push(JSON.stringify({
      id: d.id,
      width: d.width,
      height: d.height,
      npz,
      faces,
      medianWidth: d.gaps.medianWidth,
      standing: checks.flatMap((c, i) => (c.kind === "standing" && outlines.has(i) ? [{ box: i, outline: outlines.get(i) }] : [])),
      tops: Object.fromEntries(tops),
      rows: rows.map((r) => {
        const p = ps.find((x) => x.lower === r.band);
        const up = p ? rows.find((x) => x.band === p.upper) : undefined;
        const lip = up?.planes?.lip;
        return {
          band: r.band,
          frame: r.frame,
          c: r.spineOffset,
          b0: r.base,
          bt: r.top,
          level: r.level,
          elevationDeg: r.elevationDeg ?? null,
          above: up && lip?.found ? { band: up.band, frame: up.frame, lip: { normal: lip.normal, d: lip.d, up: lip.up, side: lip.side } } : null,
        };
      }),
      boxes: checks,
    }));
  }
  const inputs = join(dir, "headroom-inputs.jsonl");
  writeFileSync(inputs, lines.join("\n") + "\n");
  log(`${set}: headroom over ${lines.length} photos`);
  spawnTo(join(dir, "headroom.jsonl"), ["-I", join(REPO, "helpers", "shelf", "headroom.py"), "--inputs", inputs, "--maps", join(dir, "maps")], `headroom.py on ${set}`);
  handOver(set);
}

/** F-0k's `regions.jsonl` and Q-3's `gaps.jsonl`, both private. */
function handOver(set: SetName): void {
  const dir = setDir(set);
  const hr = readJsonl<HeadroomOut>(join(dir, "headroom.jsonl"));
  const sh = shelfOut(set);
  const regions: string[] = [];
  const gaps: string[] = [];
  for (const p of hr) {
    p.regions.forEach((r, k) =>
      regions.push(JSON.stringify({ kind: "headroom-occupied", id: `${p.id}:${r.band}:${k}`, imageId: p.id, candidate: r.explainedBy === null, ...r })),
    );
    for (const row of sh.get(p.id)?.rows ?? []) {
      if (!row.voids) continue;
      const free = p.regions.filter((r) => r.band === row.band && r.explainedBy === null && r.dominant === "front" && r.overlaps.length === 0);
      gaps.push(JSON.stringify({
        imageId: p.id,
        band: row.band,
        unit: "median spine widths (a coverage segment is two)",
        lengthW: row.voids.lengthW,
        stretches: row.voids.stretches.map((s) => ({ ...s, frontNoBox: frontNoBox(s) })),
        headroomFrontNoBox: free.map((r) => ({ rect: r.rect, px: r.px, aboveTopM: r.aboveTopM })),
      }));
    }
  }
  writeFileSync(join(dir, "regions.jsonl"), regions.join("\n") + "\n");
  writeFileSync(join(dir, "gaps.jsonl"), gaps.join("\n") + "\n");
  log(`${set}: ${regions.length} occupied regions (F-0k) and ${gaps.length} rows of gaps (Q-3) under the data root's private/s2/${set}/`);
}

// --- spot check (pre-registered): unexplained occupied regions, blind --------------------------------------------

const SPOT_N = 20;

function spot(): void {
  const set: SetName = "pilot-000";
  const dir = join(PRIV, set);
  const cands = readJsonl<{ imageId: string; rect: Point[]; candidate: boolean; source?: string }>(join(dir, "regions.jsonl")).filter((r) => r.candidate);
  const rand = rng(3);
  const a = [...cands];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  const rows = a.slice(0, SPOT_N).map((r, n) => ({ n, id: r.imageId, polygon: r.rect, group: r.source ?? "lip" }));
  const out = join(dir, "spot");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "key.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const r = spawnSync(py("depth"), ["-I", join(REPO, "helpers", "shelf", "spot.py"), "--key", join(out, "key.jsonl"), "--images", join(dir, "images.jsonl"), "--out", out], { stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) throw new Error("spot.py failed");
  log(`spot: ${rows.length} of ${cands.length} unexplained regions under the data root's private/s2/${set}/spot/; judge into judged.jsonl {n, judgement: yes|no|unclear}`);
}

// --- analyse: aggregates only ------------------------------------------------------------------------------

const r4 = (x: number) => Math.round(x * 10000) / 10000;
const triOf = (b: { value: number; lo: number; hi: number } | null): Tri => (b ? [r4(b.value), r4(b.lo), r4(b.hi)] : null);
const boot = <T extends { imageId: string }>(rows: T[], stat: (rs: T[]) => number | null): Tri => triOf(clusterBootstrap(rows, stat, REPS, 1));
const sorted = (xs: number[]) => [...xs].filter(Number.isFinite).sort((a, b) => a - b);
const q = (xs: number[], p: number): number | null => (xs.length ? r4(quantile(sorted(xs), p)) : null);
const quart = (xs: number[]) => ({ n: sorted(xs).length, p25: q(xs, 0.25), p50: q(xs, 0.5), p75: q(xs, 0.75) });
const countBy = <T,>(xs: T[], key: (x: T) => string) => xs.reduce<Record<string, number>>((m, x) => ((m[key(x)] = (m[key(x)] ?? 0) + 1), m), {});

function classTable(rows: RowRec[]) {
  const unknown = CLASS_KEYS.filter((k) => k.startsWith("unknown")) as ClassKey[];
  return {
    rows: rows.length,
    headroomShare: boot(rows, headroomShare),
    empty: boot(rows, classShare(["empty"])),
    occluded: boot(rows, classShare(["occluded"])),
    occupied: boot(rows, classShare(["occupied"])),
    unknown: boot(rows, classShare(unknown)),
    unknownBy: Object.fromEntries(unknown.map((k) => [k.slice(8), boot(rows, classShare([k]))])),
  };
}

function analyseSet(set: SetName) {
  const dir = join(PRIV, set);
  const hr = readJsonl<HeadroomOut>(join(dir, "headroom.jsonl"));
  const sh = shelfOut(set);
  const rowsAll: RowRec[] = hr.flatMap((p) => p.rows.map((r) => ({ ...r, imageId: p.id, elevation: elevationOf(r.elevationDeg) })));
  const lipRows = rowsAll.filter((r) => r.source === "lip");
  const openRows = rowsAll.filter((r) => r.source === "open");
  const regions: RegionRec[] = hr.flatMap((p) => p.regions.map((r) => ({ ...r, imageId: p.id, elevation: elevationOf(p.rows.find((x) => x.band === r.band)?.elevationDeg) })));
  const lipRegions = regions.filter((r) => r.source === "lip");
  const known: KnownRec[] = hr.flatMap((p) => p.known.map((k) => ({ ...k, imageId: p.id })));
  const photoIds = hr.map((p) => ({ imageId: p.id }));

  // M1, M2, M3 over rows with a board line; by elevation; open rows apart.
  const byElevation = Object.fromEntries(ELEVATIONS.map((e) => [e, classTable(lipRows.filter((r) => r.elevation === e))])) as Record<Elevation, ReturnType<typeof classTable>>;
  const rowShare = lipRows.flatMap((r) => (r.headroomPx! + r.standingPx! > 0 ? [r.headroomPx! / (r.headroomPx! + r.standingPx!)] : []));
  const gapOverPitch = lipRows.flatMap((r) => (r.gapM != null && r.pitchUpM != null && r.pitchUpM > 0 ? [r.gapM / r.pitchUpM] : []));
  const perRow = lipRegions.length / Math.max(lipRows.length, 1);
  // Per drawn photo, so a photo drawn twice by the bootstrap counts its regions twice.
  const regionsPerPhoto = (rs: { imageId: string }[]) => {
    const n = countBy(rs, (r) => r.imageId);
    return (photos: { imageId: string }[]) => (photos.length ? photos.reduce((s, p) => s + (n[p.imageId] ?? 0), 0) / photos.length : null);
  };

  // M4: agreement with the default's own boxes (rows with a board line; open rows apart).
  const kinds4 = ["stacked", "not-a-book", "on-lip", "dropped", "standing", "cover-pass"] as const;
  const explained = (rs: RegionRec[]) => ({
    regions: rs.length,
    explainedShare: boot(rs, rate(explainedByKnown)),
    explainedPxShare: boot(rs, (x) => {
      const t = x.reduce((s, r) => s + r.px, 0);
      return t ? x.filter(explainedByKnown).reduce((s, r) => s + r.px, 0) / t : null;
    }),
    byKind: Object.fromEntries(kinds4.map((k) => [k, rs.filter((r) => r.explainedBy === k).length])),
    notABookBy: countBy(rs.filter((r) => r.explainedBy === "not-a-book"), (r) => r.overlaps[0]?.why ?? "?"),
    unexplained: rs.filter((r) => r.explainedBy === null).length,
    unexplainedNoBox: rs.filter((r) => r.explainedBy === null && r.overlaps.length === 0).length,
    dominant: countBy(rs, (r) => r.dominant),
  });
  const recallOf = (ks: KnownRec[]) => {
    const inn = ks.filter(inHeadroom);
    return { n: ks.length, inHeadroom: inn.length, recalled: inn.filter(recalled).length, recall: boot(inn, rate(recalled)) };
  };
  const openKnown = known.map((k) => ({ ...k, headroomPx: k.openHeadroomPx ?? 0, occupiedPx: k.openOccupiedPx ?? 0 }));
  const knownDefault = known.filter((k) => k.kind === "stacked" || k.kind === "not-a-book");

  // Reported: the re-baseline of S-1's planes and voids on the partition, Q-3's outputs, cost.
  const sRows = [...sh.values()].flatMap((p) => p.rows.filter((r) => !r.skip && r.planes).map((r) => ({ ...r, imageId: p.id })));
  const found = (k: "board" | "lip" | "back") => boot(sRows, rate((r) => !!r.planes?.[k].found));
  const vRows = sRows.filter((r) => r.voids);
  const len = (r: (typeof vRows)[number], pred: (s: Stretch) => boolean) => r.voids!.stretches.filter(pred).reduce((s, x) => s + (x.to - x.from), 0);
  const lenShare = (pred: (s: Stretch) => boolean) => boot(vRows, (rs) => {
    const t = rs.reduce((s, r) => s + r.voids!.lengthW, 0);
    return t ? rs.reduce((s, r) => s + len(r, pred), 0) / t : null;
  });
  const stretches = vRows.flatMap((r) => r.voids!.stretches);
  const secs = hr.map((p) => p.seconds);

  const skipped = countBy(rowsAll.filter((r) => r.skip), (r) => r.skip!);
  return {
    scope: SETS[set].scope,
    photos: hr.length,
    secondsPerPhotoP50: q(secs, 0.5),
    rows: { all: rowsAll.length, lip: lipRows.length, open: openRows.length, skipped },
    m1: {
      headroomShare: boot(lipRows, headroomShare),
      rowShare: quart(rowShare),
      gapM: quart(lipRows.flatMap((r) => (r.gapM != null ? [r.gapM] : []))),
      gapOverPitch: quart(gapOverPitch),
    },
    m2: classTable(lipRows),
    byElevation,
    m3: {
      occupied: boot(lipRows, classShare(["occupied"])),
      regions: lipRegions.length,
      regionsPerRow: r4(perRow),
      regionsPerPhoto: boot(photoIds, regionsPerPhoto(lipRegions)),
      regionPx: quart(lipRegions.map((r) => r.px)),
    },
    m4: {
      explained: explained(lipRegions),
      recall: { known: recallOf(knownDefault), stacked: recallOf(known.filter((k) => k.kind === "stacked")), notABook: recallOf(known.filter((k) => k.kind === "not-a-book")), onLip: recallOf(known.filter((k) => k.kind === "on-lip")) },
      notABookInHeadroomBy: countBy(known.filter((k) => k.kind === "not-a-book" && inHeadroom(k)), (k) => k.why ?? "?"),
    },
    open: { ...classTable(openRows), explained: explained(regions.filter((r) => r.source === "open")), recall: recallOf(openKnown.filter((k) => k.kind === "stacked" || k.kind === "not-a-book")) },
    rebaseline: {
      rows: sRows.length,
      found: { board: found("board"), lip: found("lip"), back: found("back") },
      voidShare: lenShare((s) => s.kind === "void"),
      outlineGapShare: lenShare((s) => s.kind === "outline-gap"),
    },
    q3: {
      rows: vRows.length,
      stretches: countBy(stretches, (s) => s.kind),
      frontNoBox: stretches.filter(frontNoBox).length,
      frontNoBoxShare: lenShare(frontNoBox),
      boxShareOfOutlineGaps: quart(stretches.filter((s) => s.kind === "outline-gap" && s.boxShare != null).map((s) => s.boxShare!)),
      headroomFrontNoBox: regions.filter((r) => r.explainedBy === null && r.dominant === "front" && r.overlaps.length === 0).length,
    },
  };
}

type SetMetrics = ReturnType<typeof analyseSet>;

function spotResult() {
  const p = join(PRIV, "pilot-000", "spot", "judged.jsonl");
  if (!existsSync(p)) return null;
  const j = readJsonl<{ n: number; judgement: "yes" | "no" | "unclear" }>(p);
  return { judged: j.length, yes: j.filter((x) => x.judgement === "yes").length, no: j.filter((x) => x.judgement === "no").length, unclear: j.filter((x) => x.judgement === "unclear").length };
}

function analyse(): void {
  const sets = Object.fromEntries(NAMES.map((s) => [s, analyseSet(s)])) as Record<SetName, SetMetrics>;
  const p = sets["pilot-000"];
  const v = adequacy(p.m2.unknown?.[0] ?? null, p.m4.recall.known.recall?.[0] ?? null);
  const m = {
    card: "S-2",
    question: "What lies between each shelf row's book tops and the board above: empty, occluded, occupied or unknown?",
    model: "moge-2-vitl-normal@cb0e8bb (H-2 cache); F-0i partition (#51); S-1 shelf rows re-run on it",
    rule: S2,
    sets,
    spotCheck: spotResult(),
    adequacy: v,
  };
  const out = join(REPO, "evals", "S2");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "metrics.json"), compactJson(m) + "\n");
  const rp = join(out, "report.md");
  const MARK = "<!-- generated by src/eval/s2-cli.ts analyse: edit above this line -->";
  const old = existsSync(rp) ? readFileSync(rp, "utf8") : "";
  const head = old.includes(MARK) ? old.slice(0, old.indexOf(MARK)) : old.trimEnd() + "\n\n";
  writeFileSync(rp, head + MARK + "\n\n" + tablesMd(m));
  log("evals/S2/{metrics.json,report.md} written");
}

// --- tables -------------------------------------------------------------------------------------------------

const pct = (t: Tri) => (t ? `${(t[0] * 100).toFixed(1)} % (${(t[1] * 100).toFixed(1)}–${(t[2] * 100).toFixed(1)})` : "—");
const pctQ = (x: { n: number; p25: number | null; p50: number | null; p75: number | null }) =>
  x.n ? `${[x.p25, x.p50, x.p75].map((v) => (v === null ? "—" : `${(v * 100).toFixed(1)} %`)).join(" / ")} (n ${x.n})` : "—";
const cmQ = (x: { n: number; p25: number | null; p50: number | null; p75: number | null }) =>
  x.n ? `${[x.p25, x.p50, x.p75].map((v) => (v === null ? "—" : `${(v * 100).toFixed(1)} cm`)).join(" / ")} (n ${x.n})` : "—";
const yn = (b: boolean | null) => (b === null ? "—" : b ? "yes" : "no");
const kv = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ") || "none";

function tablesMd(m: { sets: Record<SetName, SetMetrics>; spotCheck: ReturnType<typeof spotResult>; adequacy: ReturnType<typeof adequacy> }): string {
  const out: string[] = [];
  for (const set of NAMES) {
    const s = m.sets[set];
    out.push(`## ${set} (${s.scope})\n`);
    out.push(`${s.photos} photos; headroom step ${s.secondsPerPhotoP50} s a photo (p50, CPU, after the cached depth stage and the shelf rows).\n`);
    out.push(`${s.rows.all} S-1 rows on the partition: **${s.rows.lip} with a board line**, ${s.rows.open} open (reported apart), skipped: ${kv(s.rows.skipped)}.\n`);
    out.push("### M1–M3: headroom and its classes (rows with a board line)\n");
    out.push("Headroom share = headroom pixels ÷ (headroom + the row's standing books' pixels). Class shares are of headroom pixels and sum to 1. 95 % photo bootstrap.\n");
    out.push("| rows | n | headroom share | empty | occluded | **occupied** | unknown |\n|---|---:|---|---|---|---|---|");
    const line = (name: string, t: ReturnType<typeof classTable>) => `| ${name} | ${t.rows} | ${pct(t.headroomShare)} | ${pct(t.empty)} | ${pct(t.occluded)} | ${pct(t.occupied)} | ${pct(t.unknown)} |`;
    out.push(line("all", s.m2));
    for (const e of ELEVATIONS) out.push(line(`${e} eye level`, s.byElevation[e]));
    out.push(line("open rows (apart)", s.open));
    out.push(`\nUnknown by cause: invalid depth ${pct(s.m2.unknownBy.invalid ?? null)}, foreground ${pct(s.m2.unknownBy.foreground ?? null)}, speckle ${pct(s.m2.unknownBy.speckle ?? null)}.\n`);
    out.push("| measure | value |\n|---|---|");
    out.push(`| headroom share per row, p25 / p50 / p75 | ${pctQ(s.m1.rowShare)} |`);
    out.push(`| headroom gap (board line's lip face p5 − books' top), p25 / p50 / p75 (MoGe-2 metres, unverified) | ${cmQ(s.m1.gapM)} |`);
    out.push(`| headroom gap ÷ pitch, p25 / p50 / p75 | ${pctQ(s.m1.gapOverPitch)} |`);
    out.push(`| occupied regions (rows with a board line) | ${s.m3.regions} (${s.m3.regionsPerRow} a row; ${s.m3.regionsPerPhoto ? `${s.m3.regionsPerPhoto[0].toFixed(2)} a photo (${s.m3.regionsPerPhoto[1].toFixed(2)}–${s.m3.regionsPerPhoto[2].toFixed(2)})` : "—"}) |`);
    out.push(`| region size, map pixels, p25 / p50 / p75 | ${s.m3.regionPx.p25} / ${s.m3.regionPx.p50} / ${s.m3.regionPx.p75} |`);
    out.push(`| dominant class of the regions | ${kv(s.m4.explained.dominant)} |\n`);
    out.push("### M4: agreement with the default's own boxes\n");
    const ex = s.m4.explained;
    out.push("| measure | value |\n|---|---|");
    out.push(`| regions explained by a stacked or not-a-book box (count) | ${pct(ex.explainedShare)} of ${ex.regions} |`);
    out.push(`| the same, by pixels | ${pct(ex.explainedPxShare)} |`);
    out.push(`| explained by kind | ${kv(ex.byKind)}; unexplained ${ex.unexplained} (${ex.unexplainedNoBox} overlap no box at all) |`);
    out.push(`| not-a-book explainers by sub-reason | ${kv(ex.notABookBy)} |`);
    const rc = s.m4.recall;
    const rline = (name: string, x: typeof rc.known) => `| recall of ${name}: in headroom → occupied | ${x.n} boxes, ${x.inHeadroom} in headroom, ${x.recalled} recalled: ${pct(x.recall)} |`;
    out.push(rline("stacked + not-a-book", rc.known));
    out.push(rline("stacked (kept, lying flat)", rc.stacked));
    out.push(rline("not-a-book (shipped filter)", rc.notABook));
    out.push(rline("`on-lip` (S-1's flag, not the default)", rc.onLip));
    out.push(`| not-a-book boxes in headroom by sub-reason | ${kv(s.m4.notABookInHeadroomBy)} |`);
    out.push(`| open rows: regions explained / recall | ${pct(s.open.explained.explainedShare)} of ${s.open.explained.regions}; ${s.open.recall.recalled} of ${s.open.recall.inHeadroom} |\n`);
    out.push("### Reported: S-1 on the partition, and Q-3's outputs\n");
    const rb = s.rebaseline;
    out.push("| measure | value |\n|---|---|");
    out.push(`| rows (S-1's rule, on the partition) | ${rb.rows} |`);
    out.push(`| board top / lip / back panel found | ${pct(rb.found.board)} / ${pct(rb.found.lip)} / ${pct(rb.found.back)} |`);
    out.push(`| void share (void length ÷ row length) | ${pct(rb.voidShare)} |`);
    out.push(`| outline-gap share | ${pct(rb.outlineGapShare)} |`);
    out.push(`| stretches by kind | ${kv(s.q3.stretches)} |`);
    out.push(`| outline gaps' share inside any box, p25 / p50 / p75 | ${pctQ(s.q3.boxShareOfOutlineGaps)} |`);
    out.push(`| **\`front\` outline gaps with no box** (Q-3): count, length share | ${s.q3.frontNoBox}, ${pct(s.q3.frontNoBoxShare)} |`);
    out.push(`| unexplained \`front\` headroom regions overlapping no box (Q-3) | ${s.q3.headroomFrontNoBox} |\n`);
  }
  const sc = m.spotCheck;
  out.push("## Spot check and adequacy\n");
  out.push(sc ? `Blind agent spot check (\`pilot-000\`, unexplained occupied regions): *something other than the shelf* ${sc.yes} of ${sc.judged}, no ${sc.no}, unclear ${sc.unclear}. One agent's judgement, never labels.\n` : "Spot check not run.\n");
  const v = m.adequacy;
  out.push("| unknown share ≤ 25 % | recall of known content ≥ 60 % | adequate as F-0k's search input |\n|---|---|---|");
  out.push(`| ${yn(v.unknown)} | ${yn(v.recall)} | **${v.adequate === null ? "—" : v.adequate ? "yes" : "no: read the map as a candidate list only"}** |`);
  return out.join("\n") + "\n";
}

// --- render (private) ------------------------------------------------------------------------------------------

function render(set: SetName): void {
  const dir = join(PRIV, set);
  const r = spawnSync(py("depth"), ["-I", join(REPO, "helpers", "shelf", "render_s2.py"), "--headroom", join(dir, "headroom.jsonl"), "--inputs", join(dir, "headroom-inputs.jsonl"), "--maps", join(dir, "maps"), "--images", join(dir, "images.jsonl"), "--out", join(PRIV, "renders", set)], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (r.status !== 0) throw new Error(`render_s2.py failed on ${set}`);
  log(`${set}: still study under the data root's private/s2/renders/${set}/`);
}

// --- main ---------------------------------------------------------------------------------------------------

const [cmd, arg] = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  const sets = isSet(arg) ? [arg] : NAMES;
  if (cmd === "stage") sets.forEach(stage);
  else if (cmd === "shelf") sets.forEach(shelf);
  else if (cmd === "headroom") sets.forEach(headroom);
  else if (cmd === "handover") sets.forEach(handOver);
  else if (cmd === "render") sets.forEach(render);
  else if (cmd === "spot") spot();
  else if (cmd === "analyse") analyse();
  else {
    console.error("usage: s2-cli.ts stage|shelf|headroom|handover|render|spot|analyse [set]");
    process.exit(2);
  }
}
