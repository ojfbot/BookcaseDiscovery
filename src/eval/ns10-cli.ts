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
  moge: { angleDeg: number[]; relDepth: number[]; scaleRatio: number[]; ownAngleDeg?: number[] } | null;
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

  /** Tallies for one IoU floor; the candidates and rows of the pre-registered floor are written from the same pass. */
  const run = (iouMin: number, sink?: { candidates: (Candidate & { group: string })[]; bookRows: unknown[] }): CaseTally[] =>
    I.groups.map((g, gi) => {
      const boxes = I.kept.filter((id) => g.photos.some((p) => p.id === photoOfId(id)));
      const fpRows = boxes.map((id) => byGroup.get(g.name)?.find((f) => f.id === id) ?? { id, photo: photoOfId(id), group: g.name, lifted: false, u0: 0, u1: 0, v0: 0, v1: 0 });
      const agrees = (a: string, b: string): boolean => facts.get(a)!.works.some((w) => facts.get(b)!.works.includes(w));
      const books: FusedBook[] = associate(fpRows, agrees, { iouMin });
      const t = tallyCase(`case ${gi + 1}`, boxes.map((id) => facts.get(id)!), books, new Set(fpRows.filter((f) => f.lifted).map((f) => f.id)));
      const readings = new Map(boxes.map((id) => [id, facts.get(id)!.works]));
      const cands = books.map((b) => candidateOf(b, readings)).filter((c): c is Candidate => !!c);
      tallyCandidates(t, cands);
      if (sink) {
        for (const c of cands) sink.candidates.push({ ...c, group: g.name });
        for (const b of books) if (b.members.length > 1) sink.bookRows.push({ group: g.name, ...b });
      }
      return t;
    });
  const tallies: CaseTally[] = [];
  const candidates: (Candidate & { group: string })[] = [];
  const bookRows: unknown[] = [];
  const perCase: Record<string, unknown>[] = [];
  const sink = { candidates, bookRows };
  tallies.push(...run(NS10.iouMin, sink));
  for (const t of tallies) perCase.push({ ...t });

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
      M1_booksPerGroup: { boxesBefore: sum((t) => t.boxCount), fusedBooksAfter: sum((t) => t.fusedBooks), joinedBooks: sum((t) => t.joinedBooks), boxesInJoinedBooks: sum((t) => t.boxesInJoined), liftedBoxes: sum((t) => t.lifted), boxesInJoinedShare: M((t) => t.boxesInJoined, (t) => t.boxCount) },
      M2_gainShare: { gainedAndAgree: gain.num, singleReaderBoxes: gain.den, share: gain },
      M2b_newConflicts: { conflicts: sum((t) => t.conflict), share: M((t) => t.conflict, (t) => t.singleReader) },
      M2c_gainAmongVisibleTwice: { singleReaderInFusedBooks: sum((t) => t.singleReaderJoined), share: M((t) => t.gain, (t) => t.singleReaderJoined) },
      M3_frameEdgeReadElsewhere: { frameEdgeBoxes: sum((t) => t.frameEdge), readElsewhere: sum((t) => t.frameEdgeReadElsewhere), share: M((t) => t.frameEdgeReadElsewhere, (t) => t.frameEdge) },
      M3b_frameEdgeAgree: { withOwnReading: sum((t) => t.frameEdgeReadOwn), agree: sum((t) => t.frameEdgeReadAgree), share: M((t) => t.frameEdgeReadAgree, (t) => t.frameEdgeReadOwn) },
      M3c_frameEdgeUnreadReadElsewhere_supplementary: { frameEdgeBoxesWithNoOwnReading: sum((t) => t.frameEdgeUnread), readElsewhere: sum((t) => t.frameEdgeUnreadReadElsewhere), share: M((t) => t.frameEdgeUnreadReadElsewhere, (t) => t.frameEdgeUnread) },
      M4_copySafety: { fusedBooksWithTwoBoxesOfOneStill: sum((t) => t.copyBooksSameStill), fusedBooksWithTwoBoxesOfOneCopyGroup: sum((t) => t.copyBooksSameGroup), exact: true },
      M4b_copyExposure: { fusedBooksWithACopyGroupMember: sum((t) => t.copyExposure), ofThoseDecidedByTieBreak: sum((t) => t.copyExposureTied) },
      M5_associationPrecision: { pairsBothRead: precision.den, sameWork: precision.num, share: precision },
      M5b_sameWorkPairRecovery: { unambiguousSameWorkPairs: sum((t) => t.sameWorkPairs), merged: sum((t) => t.sameWorkMerged), share: M((t) => t.sameWorkMerged, (t) => t.sameWorkPairs) },
      candidates: { fusedBooksWithACandidate: sum((t) => t.candidates), withAConflict: sum((t) => t.candidateConflicts) },
    },
    // Supplementary, not pre-registered: the same association at other IoU floors (nothing was tuned on these).
    sensitivity: [0.1, 0.3, 0.5, 0.7].map((floor) => {
      const ts = floor === NS10.iouMin ? tallies : run(floor);
      const P = (num: (t: CaseTally) => number, den: (t: CaseTally) => number) => pooled(ts, num, den);
      return {
        iouMin: floor,
        joinedBooks: ts.reduce((s2, t) => s2 + t.joinedBooks, 0),
        gain: P((t) => t.gain, (t) => t.singleReader),
        conflicts: ts.reduce((s2, t) => s2 + t.conflict, 0),
        precision: P((t) => t.pairsSame, (t) => t.pairsRead),
        sameWorkRecovery: P((t) => t.sameWorkMerged, (t) => t.sameWorkPairs),
        copyBooks: ts.reduce((s2, t) => s2 + t.copyBooksSameStill + t.copyBooksSameGroup, 0),
      };
    }),
    perCase: perCase.map((t, i) => {
      const g = geoByGroup.get(I.groups[i]!.name);
      return {
        ...t,
        teacher: g ? { views: g.views, poseOk: g.poseOk, viewsUsable: g.viewsUsable, seconds: g.seconds, peakRssMb: g.peakRssMb, peakMpsMb: g.peakMpsMb, mogeAngleDegMedian: median(g.moge?.angleDeg ?? []), mogeAngleDegP90: p90(g.moge?.angleDeg ?? []), mogeRelDepthMedian: median(g.moge?.relDepth ?? []), mogeRelDepthP90: p90(g.moge?.relDepth ?? []), mogeScaleRatioMedian: median(g.moge?.scaleRatio ?? []) } : null,
      };
    }),
    teacher: {
      groupsWithPoseSuccess: poseGroups,
      /** MapAnything's confidence is not bounded by 1 (every box median is 1.0 or more), so prereg §2's "above 0.5" is met by any finite pose; the stricter count below needs two views on the group's plane. */
      groupsWithTwoUsableViews: geo.filter((g) => g.viewsUsable >= 2).length,
      viewsOnGroupPlane: geo.reduce((s2, g) => s2 + g.viewsUsable, 0),
      viewsTotal: geo.reduce((s2, g) => s2 + g.views, 0),
      mogeOwnPlaneAngleDegMax: Math.max(...geo.flatMap((g) => g.moge?.ownAngleDeg ?? [0])),
      mogeAngleDegMedian: median(geo.flatMap((g) => g.moge?.angleDeg ?? [])),
      mogeAngleDegP90: p90(geo.flatMap((g) => g.moge?.angleDeg ?? [])),
      mogeRelDepthMedian: median(geo.flatMap((g) => g.moge?.relDepth ?? [])),
      mogeRelDepthP90: p90(geo.flatMap((g) => g.moge?.relDepth ?? [])),
    },
  };
  mkdirSync("evals/NS10", { recursive: true });
  writeFileSync("evals/NS10/metrics.json", JSON.stringify(metrics, null, 1) + "\n");
  writeFileSync("evals/NS10/report.md", reportOf(metrics as unknown as Metrics));
  log(`verdict ${verdict.verdict}: ${verdict.because}`);
  log(`gain ${gain.num}/${gain.den}; copy-safety ${sum((t) => t.copyBooksSameStill + t.copyBooksSameGroup)}; precision ${precision.value}`);
}


// --- evals/NS10/report.md, from metrics.json alone (aggregates only) ------------------------------------------------

type Ratio = { value: number | null; num: number; den: number; interval: { lo: number; hi: number } | null };
interface Metrics {
  verdict: { verdict: string; because: string };
  cases: number;
  stills: number;
  constants: { iouMin: number; tieBand: number };
  measures: Record<string, Record<string, unknown> & { share?: Ratio }>;
  sensitivity: { iouMin: number; joinedBooks: number; gain: Ratio; conflicts: number; precision: Ratio; sameWorkRecovery: Ratio; copyBooks: number }[];
  perCase: Record<string, unknown>[];
  teacher: Record<string, number | null>;
}

const pct = (x: number | null): string => (x === null ? "n/a" : `${(100 * x).toFixed(1)} %`);
const fmt = (r: Ratio | undefined): string => (!r ? "n/a" : `${r.num}/${r.den} = ${pct(r.value)}${r.interval ? ` (${pct(r.interval.lo)} to ${pct(r.interval.hi)})` : " (no interval)"}`);
const num = (x: unknown, d = 1): string => (typeof x === "number" ? x.toFixed(d) : "n/a");

export function reportOf(m: Metrics): string {
  const M = m.measures;
  const t = m.teacher;
  const rows = m.perCase.map((c) => {
    const x = c as Record<string, number | Record<string, number | boolean | null> | null>;
    const te = x.teacher as Record<string, number | boolean | null> | null;
    return `| ${x.case} | ${x.stills} | ${x.boxCount} | ${x.lifted} | ${x.fusedBooks} | ${x.joinedBooks} | ${x.singleReader} | ${x.gain} / ${x.conflict} | ${x.frameEdgeReadElsewhere} | ${x.candidates} | ${te?.viewsUsable ?? "n/a"} of ${te?.views ?? "n/a"} | ${num(te?.seconds)} | ${num(te?.peakRssMb, 0)} | ${num(te?.peakMpsMb, 0)} |`;
  });
  const lifted = (M.M1_booksPerGroup as Record<string, number>).liftedBoxes;
  const byGain = [...m.perCase].sort((p, q) => (q.gain as number) - (p.gain as number))[0] as Record<string, number | string>;
  const dominant = `${byGain.case} (${byGain.stills} stills, ${byGain.singleReader} of the ${M.M2_gainShare.share?.den} single-reader boxes) holds ${byGain.gain} of the ${M.M2_gainShare.share?.num} gains, so the bootstrap's lower bound is set by the cases that gained nothing.`;
  const sens = m.sensitivity.map((s) => `| ${s.iouMin}${s.iouMin === m.constants.iouMin ? " (pre-registered)" : ""} | ${s.joinedBooks} | ${fmt(s.gain)} | ${s.conflicts} | ${fmt(s.precision)} | ${fmt(s.sameWorkRecovery)} | ${s.copyBooks} |`);
  return `# NS10: multi-view label fusion on pilot-000 capture groups — report

Pre-registered in [\`prereg.md\`](prereg.md) (fixed 2026-11-05, before the teacher was downloaded). Teacher: MapAnything, Apache-2.0
variant (\`facebook/map-anything-apache\`, revision \`00f9c245bbcb\`). Constants: IoU floor ${m.constants.iouMin}, tie band ${m.constants.tieBand}. Method, caches and
limits: [\`docs/models/multiview-fusion.md\`](../../docs/models/multiview-fusion.md). Numbers: [\`metrics.json\`](metrics.json).

> **Every figure below is machine agreement on ${m.stills} stills of one real-use set (${m.cases} capture groups standing in for cases), not accuracy. No
> sweep clip was fused.** The readers' errors correlate (\`evals/TS1/report.md\`); agreement between two views is no evidence a
> label is right. Intervals are case-level bootstrap percentiles (2.5 % to 97.5 %, 2,000 resamples, seed 20261105) over
> ${m.cases} cases of 2 to 13 stills: wide, and the report does not read them as more than that.

## Verdict (prereg §5)

**${m.verdict.verdict.toUpperCase()}** — ${m.verdict.because}. Under the keep rule: copy safety is exact (${(M.M4_copySafety as Record<string, unknown>).fusedBooksWithTwoBoxesOfOneStill} fused books hold two boxes of
one still, ${(M.M4_copySafety as Record<string, unknown>).fusedBooksWithTwoBoxesOfOneCopyGroup} hold two of one F-0g copy group); the share of \`single-reader\` boxes that gained a second reading from a different view is
${fmt(M.M2_gainShare.share)}; association precision is ${fmt(M.M5_associationPrecision.share)} against the 0.80 floor. Nothing was written to the label ledger.

## Measures (prereg §4)

| Measure | Value |
|---|---|
| M1 boxes before / fused books after | ${(M.M1_booksPerGroup as Record<string, number>).boxesBefore} / ${(M.M1_booksPerGroup as Record<string, number>).fusedBooksAfter}; ${(M.M1_booksPerGroup as Record<string, number>).joinedBooks} fused books hold two or more boxes (${(M.M1_booksPerGroup as Record<string, number>).boxesInJoinedBooks} boxes, ${fmt((M.M1_booksPerGroup as Record<string, Ratio>).boxesInJoinedShare)}); ${(M.M1_booksPerGroup as Record<string, number>).liftedBoxes} boxes were lifted |
| **M2 \`single-reader\` boxes that gained a second-view reading that agrees** | ${fmt(M.M2_gainShare.share)} |
| M2b new conflicts (another view confirms a different work) | ${(M.M2b_newConflicts as Record<string, number>).conflicts}: ${fmt(M.M2b_newConflicts.share)} |
| M2c gain among \`single-reader\` boxes in a fused book of two or more | ${fmt(M.M2c_gainAmongVisibleTwice.share)} |
| M3 \`frame-edge\` boxes that are in a fused book with a member read fully in another view | ${fmt(M.M3_frameEdgeReadElsewhere.share)} |
| M3b of those with a reading of their own, the share that agrees | ${fmt(M.M3b_frameEdgeAgree.share)} |
| M3c (supplementary, not pre-registered) frame-edge boxes with no reading of their own, read in full elsewhere | ${fmt(M.M3c_frameEdgeUnreadReadElsewhere_supplementary.share)} |
| **M4 copy safety (exact)** | ${(M.M4_copySafety as Record<string, number>).fusedBooksWithTwoBoxesOfOneStill + (M.M4_copySafety as Record<string, number>).fusedBooksWithTwoBoxesOfOneCopyGroup} fused books with two boxes of one still or one copy group |
| M4b copy exposure | ${(M.M4b_copyExposure as Record<string, number>).fusedBooksWithACopyGroupMember} fused books of two or more have a member in an F-0g copy group; ${(M.M4b_copyExposure as Record<string, number>).ofThoseDecidedByTieBreak} were decided by the reading tie-break |
| M5 association precision (merged pairs where both boxes carry a confirmed work: same work) | ${fmt(M.M5_associationPrecision.share)} |
| M5b same-work pair recovery (unambiguous cross-view pairs naming one work that were merged) | ${fmt(M.M5b_sameWorkPairRecovery.share)} |
| Candidates (\`multiview-fusion\`: readers from two or more stills agree) | ${(M.candidates as Record<string, number>).fusedBooksWithACandidate} fused books, ${(M.candidates as Record<string, number>).withAConflict} with a dissenting work in another member |

## Per case

| Case | Stills | Boxes | Lifted | Fused books | Of 2+ boxes | \`single-reader\` | Gain / conflict | Frame-edge read elsewhere | Candidates | Views on the plane | Infer s | Peak RSS MB | Peak MPS MB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
${rows.join("\n")}

The teacher's runtime excludes the one-time model load (about 19 s). Memory is the process's high-water mark (RSS) and MPS's driver allocation, one process per group.

## The teacher on these stills (consistency, not truth)

- Groups with finite poses: ${t.groupsWithPoseSuccess} of ${m.cases} by the pre-registered rule. **That rule is vacuous**: MapAnything's confidence is not a probability (the median over every group's boxes is 1.0 or more), so the
  "above 0.5" test passes for any finite pose. The stricter count, groups with two or more views on the group's shelf plane, is ${t.groupsWithTwoUsableViews} of ${m.cases}; ${t.viewsOnGroupPlane} of ${t.viewsTotal} views lie on their group's plane.
- Against MoGe-2 (H-2) for the same stills, the angle between the teacher's group plane and MoGe-2's own plane in each still: median ${num(t.mogeAngleDegMedian)}°, 90th percentile ${num(t.mogeAngleDegP90)}°;
  relative depth difference along the box rays after matching scale: median ${num(t.mogeRelDepthMedian, 3)}, 90th percentile ${num(t.mogeRelDepthP90, 3)}.
- **Supplementary (not pre-registered):** the teacher's plane fitted to each still alone against MoGe-2's: at most ${num(t.mogeOwnPlaneAngleDegMax)}° in every still of every group. Each view's own geometry agrees with MoGe-2; where the group plane
  disagrees with a view (the large angles above), the two stills' relative pose is inconsistent with one shelf plane. These stills cannot say whether that is the teacher's relative pose or a case whose stills face two different surfaces.

## IoU floor sensitivity (supplementary, not pre-registered, nothing tuned on it)

| IoU floor | Fused books of 2+ | Gain | Conflicts | Precision | Same-work recovery | Copy-unsafe books |
|---|---|---|---|---|---|---|
${sens.join("\n")}

## What this does and does not show

- The verdict reads the pre-registered IoU floor. The other floors were added after the first run, for this table only; none was chosen to change the verdict. A zero-width interval means one case supplied every pair.
- ${lifted} of ${M.M1_booksPerGroup.boxesBefore} boxes were lifted (the rest were in a view off its group's plane, or had too few confident pixels), and ${M.M1_booksPerGroup.boxesInJoinedBooks} boxes ended in a fused book of two or more.
- ${dominant}
- A gain here is a second reader (from another still) naming the same work as the single reader: machine agreement, not a correct label, and not admitted to TS-0.
`;
}

const cmd = process.argv[2];
if (cmd === "prepare") prepare();
else if (cmd === "fuse") fuse();
else {
  console.error("usage: ns10-cli.ts prepare | fuse");
  process.exit(2);
}
