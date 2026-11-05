// NS-10 runner: multi-view label fusion on pilot-000's capture groups. CPU only; the geometry stage is helpers/fusion/.
//
//   node src/eval/ns10-cli.ts prepare   # private/fusion/pilot-000/{groups,boxes}.jsonl: the helper's inputs
//   node src/eval/ns10-cli.ts fuse      # association, candidates.jsonl (stamped), evals/NS10/{metrics.json,report.md}
//
// Reads, never rewrites: F-1's manifest (capture groups), RB-1's box set, F-0c's detections, F-0i's outlines, H-2's base
// decisions (the readers' confirmed works), F-0g's copy groups. Never writes to the label ledger (prereg §5): candidates
// are a private file; only aggregates leave the data root. Prereg: evals/NS10/prereg.md.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileDurable } from "../ledger/durable.ts";
import { dataRoot } from "../ledger/images.ts";
import { checkLineage, makeStamp, writeLineage } from "../ledger/lineage.ts";
import { modelHashes } from "../ledger/models.ts";
import { FUSION_CANDIDATES_SCHEMA, FUSION_MODELS } from "./lineage-classes.ts";
import { armsOf, readJsonl, stageExpect, type Detection, type ReaderName } from "./f0.ts";
import { associate, candidateOf, NS10, photoOfId, pooled, tallyCandidates, tallyCase, verdictOf, worksOf, type BoxFacts, type Candidate, type CaseTally, type Footprint, type FusedBook } from "./ns10.ts";
import { Q3, centroid, frameCut, radialOf } from "./q3.ts";
import { contentHash } from "./ts0.ts";
import { loadBoxSet } from "./rb1.ts";
import { readDatasetManifest } from "../capture/dataset.ts";

const SET = "pilot-000";
const log = (s: string): void => console.error(`[ns10] ${new Date().toISOString().slice(11, 19)} ${s}`);

interface Layout {
  root: string;
  fusion: string;
}
const layout = (root = dataRoot()): Layout => ({ root, fusion: join(root, "private", "fusion", SET) });

interface BaseDecision {
  id: string;
  imageId: string;
  confirmed: Partial<Record<ReaderName, string | null>>;
  accepted: { workId: string } | null;
  reason: string | null;
}
interface CopyRow {
  id: string;
  group: number;
}

interface Inputs {
  /** Kept box ids (RB-1's box set), sorted. */
  kept: string[];
  dets: Map<string, Detection>;
  outline: (id: string) => [number, number][];
  decisions: Map<string, BaseDecision>;
  copies: Map<string, number>;
  boxSetHash: string;
  /** Capture groups, sorted by size (largest first), each with its stills' working-copy hashes and files. */
  groups: { name: string; photos: { id: string; image: string }[] }[];
}

function inputs(L: Layout): Inputs {
  const { root } = L;
  const box = loadBoxSet(SET, root);
  const kept = [...box.rows.values()].filter((r) => r.state === "kept" && box.keeps(r.id)).map((r) => r.id).sort();
  const detPath = join(root, "f0c", SET, "detect.jsonl");
  const detRows = readJsonl<Detection>(detPath);
  checkLineage(detPath, stageExpect("detect", armsOf(detRows), root));
  const dets = new Map(detRows.filter((d) => !d.error).map((d) => [d.id, d]));
  const split = (id: string): [string, number] => [id.slice(0, id.lastIndexOf(":")), Number(id.slice(id.lastIndexOf(":") + 1))];
  const outline = (id: string): [number, number][] => {
    const r = box.rows.get(id);
    if (r && r.outline && r.outline.length >= 3) return r.outline;
    const [img, i] = split(id);
    return dets.get(img)!.spines[i]!.polygon as [number, number][];
  };
  const polygon = (id: string): [number, number][] => {
    const [img, i] = split(id);
    return dets.get(img)!.spines[i]!.polygon as [number, number][];
  };
  // The box-set hash as TS-0 computes it, so the candidates' stamp names the same box set as the ledger version.
  const boxSetHash = contentHash({ set: SET, boxes: kept.map((id) => ({ id, polygon: polygon(id), outline: box.rows.get(id)?.changed ? box.rows.get(id)!.outline : null })) });
  const decisions = new Map(readJsonl<BaseDecision>(join(root, "private", "h2", SET, "base-decisions.jsonl")).map((d) => [d.id, d]));
  const copies = new Map(readJsonl<CopyRow>(join(root, "private", "f0g", SET, "copies.jsonl")).map((c) => [c.id, c.group]));
  const version = JSON.parse(readFileSync(join(root, "datasets", "label-ledger", "latest.json"), "utf8")).version as string;
  const manifest = readDatasetManifest(JSON.parse(readFileSync(join(root, "datasets", "label-ledger", version, "manifest.json"), "utf8")));
  const byGroup = new Map<string, { id: string; image: string }[]>();
  for (const p of manifest.photos.filter((x) => x.session === SET)) byGroup.set(p.captureGroup, [...(byGroup.get(p.captureGroup) ?? []), { id: p.sha256, image: join(root, p.path) }]);
  const groups = [...byGroup.entries()].map(([name, photos]) => ({ name, photos: photos.sort((a, b) => a.id.localeCompare(b.id)) })).sort((a, b) => b.photos.length - a.photos.length || a.name.localeCompare(b.name));
  return { kept, dets, outline, decisions, copies, boxSetHash, groups };
}

/** `prepare`: the helper's inputs (private). */
function prepare(): void {
  const L = layout();
  const I = inputs(L);
  mkdirSync(L.fusion, { recursive: true });
  const byPhoto = new Map(I.groups.flatMap((g) => g.photos.map((p) => [p.id, g.name] as const)));
  writeFileDurable(join(L.fusion, "groups.jsonl"), I.groups.map((g, i) => JSON.stringify({ group: g.name, index: i + 1, views: g.photos })).join("\n") + "\n");
  const rows: string[] = [];
  for (const id of I.kept) {
    const photo = photoOfId(id);
    const det = I.dets.get(photo)!;
    if (!byPhoto.has(photo)) continue;
    rows.push(JSON.stringify({ id, photo, group: byPhoto.get(photo), width: det.width, height: det.height, polygon: I.outline(id) }));
  }
  writeFileDurable(join(L.fusion, "boxes.jsonl"), rows.join("\n") + "\n");
  log(`${I.groups.length} groups (${I.groups.map((g) => g.photos.length).join(", ")} stills), ${rows.length} boxes -> ${L.fusion}`);
}

interface GeometryRow {
  group: string;
  views: number;
  poseOk: boolean;
  /** Views the lift could place (pose and plane fit usable). */
  viewsUsable: number;
  seconds: number | null;
  peakRssMb: number | null;
  peakMpsMb: number | null;
  moge: { angleDeg: number[]; relDepth: number[]; scaleRatio: number[] } | null;
}

const median = (xs: number[]): number | null => (xs.length === 0 ? null : [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)]!);
const p90 = (xs: number[]): number | null => (xs.length === 0 ? null : [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(0.9 * xs.length) - 1)]!);

/** `fuse`: association, candidates and the measures. */
function fuse(): void {
  const L = layout();
  const I = inputs(L);
  const fps = readJsonl<Footprint & { group: string }>(join(L.fusion, "footprints.jsonl"));
  const geo = readJsonl<GeometryRow>(join(L.fusion, "geometry.jsonl"));
  const byGroup = new Map<string, (Footprint & { group: string })[]>();
  for (const f of fps) byGroup.set(f.group, [...(byGroup.get(f.group) ?? []), f]);

  const frameEdge = (id: string): boolean => {
    const det = I.dets.get(photoOfId(id))!;
    const poly = det.spines[Number(id.slice(id.lastIndexOf(":") + 1))]!.polygon as [number, number][];
    return frameCut(poly, det.width, det.height) || radialOf(centroid(poly), det.width, det.height) > Q3.outerRadial;
  };
  const copyGroupSizes = new Map<string, number>();
  for (const id of I.kept) {
    const g = I.copies.get(id);
    if (g !== undefined) copyGroupSizes.set(`${photoOfId(id)}:${g}`, (copyGroupSizes.get(`${photoOfId(id)}:${g}`) ?? 0) + 1);
  }
  const facts = new Map<string, BoxFacts>();
  for (const id of I.kept) {
    const d = I.decisions.get(id);
    if (!d) throw new Error("a kept box with no F-0 decision");
    const g = I.copies.get(id);
    const key = g === undefined ? null : `${photoOfId(id)}:${g}`;
    facts.set(id, {
      id,
      photo: photoOfId(id),
      singleReader: !d.accepted && d.reason === "single-reader",
      frameEdge: frameEdge(id),
      works: worksOf(d.confirmed),
      copyGroup: key && (copyGroupSizes.get(key) ?? 0) >= 2 ? key : null,
    });
  }

  const tallies: CaseTally[] = [];
  const candidates: (Candidate & { group: string })[] = [];
  const bookRows: unknown[] = [];
  const perCase: Record<string, unknown>[] = [];
  I.groups.forEach((g, gi) => {
    const boxes = I.kept.filter((id) => g.photos.some((p) => p.id === photoOfId(id)));
    const fpRows = boxes.map((id) => byGroup.get(g.name)?.find((f) => f.id === id) ?? { id, photo: photoOfId(id), group: g.name, lifted: false, u0: 0, u1: 0, v0: 0, v1: 0 });
    const agrees = (a: string, b: string): boolean => facts.get(a)!.works.some((w) => facts.get(b)!.works.includes(w));
    const books: FusedBook[] = associate(fpRows, agrees);
    const t = tallyCase(`case ${gi + 1}`, boxes.map((id) => facts.get(id)!), books, new Set(fpRows.filter((f) => f.lifted).map((f) => f.id)));
    const readings = new Map(boxes.map((id) => [id, facts.get(id)!.works]));
    const cands = books.map((b) => candidateOf(b, readings)).filter((c): c is Candidate => !!c);
    tallyCandidates(t, cands);
    tallies.push(t);
    for (const c of cands) candidates.push({ ...c, group: g.name });
    for (const b of books) if (b.members.length > 1) bookRows.push({ group: g.name, ...b });
    perCase.push({ ...t });
  });

  // candidates.jsonl: private, stamped, never the label ledger.
  const candPath = join(L.fusion, "candidates.jsonl");
  writeFileDurable(candPath, candidates.map((c) => JSON.stringify({ captureGroup: c.group, caseId: null, dupClusterId: null, ...c, members: c.members })).join("\n") + (candidates.length ? "\n" : ""));
  const mh = modelHashes(FUSION_MODELS, L.root);
  writeLineage(candPath, makeStamp({ schema: FUSION_CANDIDATES_SCHEMA, boxSet: I.boxSetHash, models: mh }));
  writeFileDurable(join(L.fusion, "books.jsonl"), bookRows.map((b) => JSON.stringify(b)).join("\n") + (bookRows.length ? "\n" : ""));

  // --- measures (prereg §4): pooled ratios, case-level bootstrap ---
  const M = (num: (t: CaseTally) => number, den: (t: CaseTally) => number) => pooled(tallies, num, den);
  const sum = (f: (t: CaseTally) => number): number => tallies.reduce((s, t) => s + f(t), 0);
  const gain = M((t) => t.gain, (t) => t.singleReader);
  const precision = M((t) => t.pairsSame, (t) => t.pairsRead);
  const poseGroups = geo.filter((g) => g.poseOk).length;
  const verdict = verdictOf({ copyBooks: sum((t) => t.copyBooksSameStill + t.copyBooksSameGroup), poseSuccessGroups: poseGroups, gain, precision: precision.value });
  const geoByGroup = new Map(geo.map((g) => [g.group, g]));
  const metrics = {
    schema: "ns10/metrics@1",
    set: SET,
    preregistration: "evals/NS10/prereg.md",
    note: "Machine agreement on 31 stills of one real-use set, not accuracy. No sweep clip was fused. The case is the F-1 capture group (pilot-000 has no bookcaseId).",
    constants: { iouMin: NS10.iouMin, tieBand: NS10.tieBand, minPixels: NS10.minPixels, bootstrap: { reps: NS10.reps, seed: NS10.seed }, precisionFloor: NS10.precisionFloor },
    cases: tallies.length,
    stills: sum((t) => t.stills),
    verdict,
    measures: {
      M1_booksPerGroup: { boxesBefore: sum((t) => t.boxes), fusedBooksAfter: sum((t) => t.fusedBooks), joinedBooks: sum((t) => t.joinedBooks), boxesInJoinedBooks: sum((t) => t.boxesInJoined), liftedBoxes: sum((t) => t.lifted), boxesInJoinedShare: M((t) => t.boxesInJoined, (t) => t.boxes) },
      M2_gainShare: { gainedAndAgree: gain.num, singleReaderBoxes: gain.den, share: gain },
      M2b_newConflicts: { conflicts: sum((t) => t.conflict), share: M((t) => t.conflict, (t) => t.singleReader) },
      M2c_gainAmongVisibleTwice: { singleReaderInFusedBooks: sum((t) => t.singleReaderJoined), share: M((t) => t.gain, (t) => t.singleReaderJoined) },
      M3_frameEdgeReadElsewhere: { frameEdgeBoxes: sum((t) => t.frameEdge), readElsewhere: sum((t) => t.frameEdgeReadElsewhere), share: M((t) => t.frameEdgeReadElsewhere, (t) => t.frameEdge) },
      M3b_frameEdgeAgree: { withOwnReading: sum((t) => t.frameEdgeReadOwn), agree: sum((t) => t.frameEdgeReadAgree), share: M((t) => t.frameEdgeReadAgree, (t) => t.frameEdgeReadOwn) },
      M4_copySafety: { fusedBooksWithTwoBoxesOfOneStill: sum((t) => t.copyBooksSameStill), fusedBooksWithTwoBoxesOfOneCopyGroup: sum((t) => t.copyBooksSameGroup), exact: true },
      M4b_copyExposure: { fusedBooksWithACopyGroupMember: sum((t) => t.copyExposure), ofThoseDecidedByTieBreak: sum((t) => t.copyExposureTied) },
      M5_associationPrecision: { pairsBothRead: precision.den, sameWork: precision.num, share: precision },
      M5b_sameWorkPairRecovery: { unambiguousSameWorkPairs: sum((t) => t.sameWorkPairs), merged: sum((t) => t.sameWorkMerged), share: M((t) => t.sameWorkMerged, (t) => t.sameWorkPairs) },
      candidates: { fusedBooksWithACandidate: sum((t) => t.candidates), withAConflict: sum((t) => t.candidateConflicts) },
    },
    perCase: perCase.map((t, i) => {
      const g = geoByGroup.get(I.groups[i]!.name);
      return {
        ...t,
        teacher: g ? { views: g.views, poseOk: g.poseOk, viewsUsable: g.viewsUsable, seconds: g.seconds, peakRssMb: g.peakRssMb, peakMpsMb: g.peakMpsMb, mogeAngleDegMedian: median(g.moge?.angleDeg ?? []), mogeAngleDegP90: p90(g.moge?.angleDeg ?? []), mogeRelDepthMedian: median(g.moge?.relDepth ?? []), mogeRelDepthP90: p90(g.moge?.relDepth ?? []), mogeScaleRatioMedian: median(g.moge?.scaleRatio ?? []) } : null,
      };
    }),
    teacher: {
      groupsWithPoseSuccess: poseGroups,
      mogeAngleDegMedian: median(geo.flatMap((g) => g.moge?.angleDeg ?? [])),
      mogeAngleDegP90: p90(geo.flatMap((g) => g.moge?.angleDeg ?? [])),
      mogeRelDepthMedian: median(geo.flatMap((g) => g.moge?.relDepth ?? [])),
      mogeRelDepthP90: p90(geo.flatMap((g) => g.moge?.relDepth ?? [])),
    },
  };
  mkdirSync("evals/NS10", { recursive: true });
  writeFileSync("evals/NS10/metrics.json", JSON.stringify(metrics, null, 1) + "\n");
  log(`verdict ${verdict.verdict}: ${verdict.because}`);
  log(`gain ${gain.num}/${gain.den}; copy-safety ${sum((t) => t.copyBooksSameStill + t.copyBooksSameGroup)}; precision ${precision.value}`);
}

const cmd = process.argv[2];
if (cmd === "prepare") prepare();
else if (cmd === "fuse") fuse();
else {
  console.error("usage: ns10-cli.ts prepare | fuse");
  process.exit(2);
}
