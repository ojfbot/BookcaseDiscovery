// F0-frames: aggregates of the still stages (docs/ingest.md "Stage order", steps 1 to 11) on a session's caches, the
// same code for `pilot-000` (48 MP stills) and `sf-store-001` (about 2 MP video frames). Machine agreement between the
// stack's own stages and readers, never accuracy (INV-17); no hand labels exist (OC36). Reads caches; writes only
// evals/F0-frames/metrics.json (aggregates). Pre-registration: evals/F0-frames/prereg.md.
//
//   node src/eval/f0-frames-cli.ts measure --timing-pilot <tsv> --timing-full <tsv>   # metrics.json
//   node src/eval/f0-frames-cli.ts pilot --timing-pilot <tsv>    # time only, when the card stops after the pilot
//   node src/eval/f0-frames-cli.ts sample --run F0-4k --parts <a,b> --references <c,d> --timing <part>=<tsv> …
//        [--project-from <frames part> --project <s1,s2> --project-every 1,3,10]   # F-0 on 4K: parts apart, projected
//
// The timing files are the run's own clock: one row per command (step, name, seconds, peak resident bytes, exit). An
// attempt stopped from outside (the process was killed, so the runner wrote no row) is entered by hand with the exit
// `interrupted`, its seconds from its start to its log's last write.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { dataRoot } from "../ledger/images.ts";
import { loadReadings, READERS, readJsonl, variantsOf, type Detection, type ReaderName } from "./f0.ts";
import { loadBoxSet } from "./rb1.ts";
import { REAL_USE_SCOPE, samplePart, sessionImages, setPaths } from "./set-paths.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const r4 = (x: number): number => Math.round(x * 10000) / 10000;
const share = (n: number, d: number): number | null => (d > 0 ? r4(n / d) : null);
const photoOf = (boxId: string): string => boxId.slice(0, boxId.lastIndexOf(":"));

/** Nearest-rank quantile of a list (null when empty). */
export function quantile(xs: number[], q: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]!;
}

export function spread(xs: number[]): { count: number; mean: number | null; p10: number | null; p50: number | null; p90: number | null; min: number | null; max: number | null } {
  return {
    count: xs.length,
    mean: xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null,
    p10: quantile(xs, 0.1),
    p50: quantile(xs, 0.5),
    p90: quantile(xs, 0.9),
    min: xs.length ? Math.min(...xs) : null,
    max: xs.length ? Math.max(...xs) : null,
  };
}

/** Counts of a key over rows, with each count's share of all rows. */
export function mix<T>(rows: T[], key: (r: T) => string): Record<string, { count: number; share: number | null }> {
  const c = new Map<string, number>();
  for (const r of rows) c.set(key(r), (c.get(key(r)) ?? 0) + 1);
  return Object.fromEntries([...c].sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, { count: n, share: share(n, rows.length) }]));
}

/** Copy groups and how many photos each spans (F-0g groups are numbered across the whole set). */
export function copyGroupSpan(rows: { id: string; group: number }[]): { groups: number; groupedBoxCount: number; multiFrameGroups: number; boxesInMultiFrameGroups: number; groupsBySize: Record<string, { count: number; share: number | null }> } {
  const g = new Map<number, { photos: Set<string>; n: number }>();
  for (const r of rows) {
    const e = g.get(r.group) ?? { photos: new Set<string>(), n: 0 };
    e.photos.add(photoOf(r.id));
    e.n++;
    g.set(r.group, e);
  }
  const multi = [...g.values()].filter((e) => e.photos.size > 1);
  return { groups: g.size, groupedBoxCount: rows.length, multiFrameGroups: multi.length, boxesInMultiFrameGroups: multi.reduce((s, e) => s + e.n, 0), groupsBySize: mix([...g.values()], (e) => String(e.n)) };
}

/** Work recurrence: of the accepted works, those accepted in two or more photos, and the accepted boxes whose work is accepted in another photo. */
export function recurrence(accepted: { id: string; workId: string }[]): { acceptedBoxCount: number; acceptedWorks: number; worksInTwoOrMoreFrames: number; acceptedBoxesRecurring: number; acceptedBoxesRecurringShare: number | null } {
  const photos = new Map<string, Set<string>>();
  for (const a of accepted) photos.set(a.workId, (photos.get(a.workId) ?? new Set()).add(photoOf(a.id)));
  const recurring = accepted.filter((a) => photos.get(a.workId)!.size > 1).length;
  return {
    acceptedBoxCount: accepted.length,
    acceptedWorks: photos.size,
    worksInTwoOrMoreFrames: [...photos.values()].filter((p) => p.size > 1).length,
    acceptedBoxesRecurring: recurring,
    acceptedBoxesRecurringShare: share(recurring, accepted.length),
  };
}

interface Decision { id: string; accepted: string | null; confirmed: Partial<Record<ReaderName, string | null>>; agreeing?: string[]; reason: string | null }

/** The accepted boxes of a decision file and their work (F-0c's `accepted` is the work id itself, or null). */
export const acceptedBoxes = (ds: Pick<Decision, "id" | "accepted">[]): { id: string; workId: string }[] =>
  ds.flatMap((d) => (d.accepted ? [{ id: d.id, workId: d.accepted }] : []));

/** The basis of a decision: `accepted`, else its reason. */
const basisOf = (d: Decision): string => (d.accepted ? "accepted" : (d.reason ?? "none"));

function pairAgreement(ds: Decision[], a: ReaderName, b: ReaderName) {
  const both = ds.filter((d) => d.confirmed[a] && d.confirmed[b]);
  const same = both.filter((d) => d.confirmed[a] === d.confirmed[b]).length;
  return { bothConfirmed: both.length, sameWork: same, sameWorkShareOfAll: share(same, ds.length), sameWorkShareOfBothConfirmed: share(same, both.length) };
}

function decisionFigures(ds: Decision[], readers: ReaderName[]) {
  const pairs: Record<string, ReturnType<typeof pairAgreement>> = {};
  for (let i = 0; i < readers.length; i++) for (let j = i + 1; j < readers.length; j++) pairs[`${readers[i]}+${readers[j]}`] = pairAgreement(ds, readers[i]!, readers[j]!);
  const accepted = ds.filter((d) => d.accepted).length;
  return {
    decisionCount: ds.length,
    accepted,
    acceptedShare: share(accepted, ds.length),
    basisMix: mix(ds, basisOf),
    readerPairs: pairs,
    ...(ds.some((d) => d.agreeing) ? { agreeingReaders: { two: ds.filter((d) => d.agreeing?.length === 2).length, three: ds.filter((d) => d.agreeing?.length === 3).length } } : {}),
  };
}

const sum = (xs: (number | undefined)[]): number => xs.reduce<number>((s, x) => s + (typeof x === "number" ? x : 0), 0);

/** Frames a set is measured against: its manifest's photos, or for a sample part the frames it takes from its session. */
export function frameCount(set: string, root = dataRoot(), repo = REPO): number {
  if (samplePart(set)) return sessionImages(set, root, repo).length;
  return (JSON.parse(readFileSync(join(repo, "fixtures", set, "manifest.json"), "utf8")) as { photos: unknown[] }).photos.length;
}

/** Every pre-registered measure on one set, from its caches under the data root. */
export function measureSet(set: string, root = dataRoot()) {
  const p = setPaths(set, root);
  const manifest = frameCount(set, root);
  const f0Det = readJsonl<Detection & { error?: string }>(join(p.f0, "detect.jsonl"));
  const defDet = readJsonl<Detection & { error?: string }>(join(p.base, "detect.jsonl"));
  const ok = (rows: (Detection & { error?: string })[]) => rows.filter((d) => !d.error);
  const frames = {
    manifest,
    f0Run: { processed: ok(f0Det).length, failed: manifest - ok(f0Det).length },
    defaultBoxes: { processed: ok(defDet).length, failed: manifest - ok(defDet).length },
  };
  const boxesPerFrame = { defaultBoxes: spread(ok(defDet).map((d) => d.spines.length)), f0Run: spread(ok(f0Det).map((d) => d.spines.length)) };

  // Reader coverage on the default boxes (every box id `<photo>:<i>` of the default detections).
  const boxIds = ok(defDet).flatMap((d) => d.spines.map((_, i) => `${d.id}:${i}`));
  const readings = loadReadings(p.base);
  const readerCoverage = Object.fromEntries(
    READERS.map((r) => {
      const rows = boxIds.filter((id) => readings.get(id)?.[r]).length;
      const read = boxIds.filter((id) => variantsOf(readings.get(id)?.[r]).length > 0).length;
      return [r, { readingRows: rows, rowShare: share(rows, boxIds.length), withText: read, withTextShare: share(read, boxIds.length) }];
    }),
  );

  const base = readJsonl<Decision>(join(p.f0c, "base-decisions.jsonl"));
  const f0Decisions = readJsonl<Decision>(join(p.f0, "decisions.jsonl"));

  const partition = readJsonl<{ id: string; state: string; reason: string | null; role: string }>(join(p.f0i, "partition.jsonl"));
  const kept = partition.filter((r) => r.state === "kept");
  const flags = readJsonl<{ id: string; causes: string[] }>(join(p.nb3, "flags.jsonl"));
  const box = loadBoxSet(set, root);

  const copies = readJsonl<{ id: string; group: number; groupSize: number; basis: string | null }>(join(p.f0g, "copies.jsonl"));
  const f0h = readJsonl<{ id: string; basis: string | null; usable: boolean }>(join(p.f0h, "decisions.jsonl"));

  const readerSeconds = Object.fromEntries(READERS.map((r) => [r, Math.round(sum([...readings.values()].map((x) => x[r]?.seconds)))]));
  return {
    set,
    scope: REAL_USE_SCOPE,
    frames,
    boxesPerFrame,
    defaultBoxCount: boxIds.length,
    readerCoverage,
    baseDecision: decisionFigures(base, ["vision", "ppocr"]),
    f0RunDecision: decisionFigures(f0Decisions, [...READERS]),
    partition: {
      rows: partition.length,
      kept: kept.length,
      dropped: partition.length - kept.length,
      keptShare: share(kept.length, partition.length),
      droppedByReason: mix(partition.filter((r) => r.state !== "kept"), (r) => r.reason ?? "none"),
      keptByRole: mix(kept, (r) => r.role),
    },
    notABookFlags: {
      flagged: flags.length,
      flaggedShareOfPartition: share(flags.length, partition.length),
      byCause: mix(flags, (f) => f.causes.join("+")),
      rb1BoxSet: kept.filter((r) => box.keeps(r.id)).length,
    },
    copyGroups: {
      ...copyGroupSpan(copies),
      groupedShareOfDefault: share(copies.length, boxIds.length),
      basisMix: mix(copies, (c) => c.basis ?? "none"),
    },
    workRecurrence: recurrence(acceptedBoxes(base)),
    contextDecisions: { rows: f0h.length, byBasis: mix(f0h, (r) => r.basis ?? "none"), usable: f0h.filter((r) => r.usable).length },
    modelSeconds: {
      f0RunDetectPerFrame: share(sum(ok(f0Det).map((d) => (d as { seconds?: number }).seconds)), ok(f0Det).length),
      defaultDetectPerFrame: share(sum(ok(defDet).map((d) => (d as { seconds?: number }).seconds)), ok(defDet).length),
      defaultReaderSecondsPerFrame: Object.fromEntries(READERS.map((r) => [r, share(readerSeconds[r]!, ok(defDet).length)])),
    },
  };
}

/** Differences (b minus a) of every rate in two measured sets: each numeric leaf named as a share, mean, median or per-frame figure. */
export function differences(a: unknown, b: unknown, key = ""): unknown {
  if (typeof a === "number" && typeof b === "number") return /share|mean|p50|perframe/i.test(key) ? r4(b - a) : undefined;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a)) return undefined;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(b)) {
    if (!(k in a)) continue;
    const d = differences((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], /^[a-z]/.test(k) && !/^(vision|ppocr|qwen)$/.test(k) && !k.includes("+") && !k.includes("-") ? k : key);
    if (d !== undefined && !(typeof d === "object" && Object.keys(d as object).length === 0)) out[k] = d;
  }
  return out;
}

/** One command's clock row. `exit` is null for an attempt interrupted from outside (not a failure of the step). */
export interface TimingRow { step: string; name: string; seconds: number; maxRssBytes: number | null; exit: number | null }

export function readTiming(path: string): TimingRow[] {
  return readFileSync(path, "utf8").trim().split("\n").slice(1).map((l) => {
    const [step, name, seconds, rss, exit] = l.split("\t");
    return { step: step!, name: name!, seconds: Number(seconds), maxRssBytes: rss ? Number(rss) : null, exit: exit === "interrupted" ? null : Number(exit) };
  });
}

/** Per-step wall time: the pilot's, its projection to the full session (linear in frames), and the full run's. */
export function timing(pilot: TimingRow[], full: TimingRow[] | null, pilotFrames: number, fullFrames: number) {
  const scale = fullFrames / pilotFrames;
  const rows = pilot.map((p) => {
    const f = full?.filter((x) => x.name === p.name) ?? [];
    const actual = f.length ? sum(f.map((x) => x.seconds)) : null;
    return {
      step: p.step,
      name: p.name,
      pilotSeconds: p.seconds,
      projectedSeconds: Math.round(p.seconds * scale),
      fullSeconds: actual,
      fullSecondsPerFrame: actual === null ? null : Math.round((actual / fullFrames) * 100) / 100,
      pilotPeakResidentMb: p.maxRssBytes ? Math.round(p.maxRssBytes / 2 ** 20) : null,
      fullPeakResidentMb: f.length && f.some((x) => x.maxRssBytes) ? Math.round(Math.max(...f.map((x) => x.maxRssBytes ?? 0)) / 2 ** 20) : null,
    };
  });
  const tot = (k: "pilotSeconds" | "projectedSeconds" | "fullSeconds") => (rows.some((r) => r[k] === null) ? null : sum(rows.map((r) => r[k] ?? 0)));
  return { pilotFrames, fullFrames, rows, totals: { pilotSeconds: tot("pilotSeconds"), projectedSeconds: tot("projectedSeconds"), fullSeconds: tot("fullSeconds") } };
}

/** F-0's recorded model seconds per cache row (detection per photo, each reader per crop), and its rows per photo. */
export function f0ModelSeconds(set: string, root = dataRoot()) {
  const dir = setPaths(set, root).f0;
  const photos = readJsonl<{ error?: string }>(join(dir, "detect.jsonl")).filter((d) => !d.error).length;
  const decisions = readJsonl(join(dir, "decisions.jsonl")).length;
  const of = (name: string) => {
    const rows = readJsonl<{ seconds?: number }>(join(dir, `${name}.jsonl`));
    const total = sum(rows.map((r) => r.seconds));
    return { rows: rows.length, seconds: Math.round(total), secondsPerRow: share(total, rows.length), secondsPerFrame: share(total, photos), rowsPerFrame: share(rows.length, photos) };
  };
  const readers = Object.fromEntries(READERS.map((r) => [r, of(r)]));
  return { frames: photos, decisionCount: decisions, detect: of("detect"), readers, hardCropShare: share(readers.qwen!.rows, decisions) };
}

/**
 * What part of its session a sample part covers (null for a whole set): the run's scope, stated beside its figures. A
 * part by kind (F-0 on 4K) is counted against its session's photos of that kind: its stills, or its frames.
 */
export function sampleScope(set: string, frameCount: (s: string) => number = (s) => sessionImages(s).length) {
  const part = samplePart(set);
  if (!part) return null;
  const frames = frameCount(set);
  const sessionFrames = frameCount(part.kind === "stills" ? `${part.session}.stills` : part.kind === "frames" ? `${part.session}.frames.every-1` : part.session);
  return { session: part.session, ...(part.kind ? { kind: part.kind } : {}), every: part.every, frames, sessionFrames, frameShare: share(frames, sessionFrames) };
}

/**
 * One part's run time: per step and in total, per image, and its peak resident memory (F-0 on 4K). A step run more
 * than once (a rerun after a stop: the stages are idempotent and keep what the first attempt cached) counts the
 * seconds of every attempt, its peak over all of them, and the last attempt's exit. An attempt that failed (a non-zero
 * exit) and one interrupted from outside (exit null) are counted apart.
 */
export function partTime(rows: TimingRow[], images: number) {
  const perImage = (x: number) => (images > 0 ? Math.round((x / images) * 100) / 100 : null);
  const mb = (b: number) => (b > 0 ? Math.round(b / 2 ** 20) : null);
  const byName = new Map<string, TimingRow[]>();
  for (const r of rows) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
  const steps = [...byName.values()].map((rs) => {
    const seconds = sum(rs.map((r) => r.seconds));
    return { step: rs[0]!.step, name: rs[0]!.name, attempts: rs.length, seconds, secondsPerImage: perImage(seconds), peakResidentMb: mb(Math.max(...rs.map((r) => r.maxRssBytes ?? 0))), exit: rs.at(-1)!.exit };
  });
  const total = sum(rows.map((r) => r.seconds));
  return { images, commands: steps.length, commandsFailed: steps.filter((s) => s.exit !== 0).length, attemptsFailed: rows.filter((r) => r.exit !== null && r.exit !== 0).length, attemptsInterrupted: rows.filter((r) => r.exit === null).length, steps, totalSeconds: total, secondsPerImage: perImage(total), peakResidentMb: mb(Math.max(0, ...rows.map((r) => r.maxRssBytes ?? 0))) };
}

/** A reference run's per-step seconds per image (from its committed timing aggregates), beside a part's. */
export function perStepAgainst(part: ReturnType<typeof partTime>, reference: { name: string; fullSeconds: number | null }[], referenceImages: number) {
  return part.steps.map((s) => {
    const ref = reference.find((r) => r.name === s.name)?.fullSeconds ?? null;
    const refPer = ref === null ? null : Math.round((ref / referenceImages) * 100) / 100;
    return { name: s.name, secondsPerImage: s.secondsPerImage, referenceSecondsPerImage: refPer, ratio: refPer && s.secondsPerImage !== null ? Math.round((s.secondsPerImage / refPer) * 100) / 100 : null };
  });
}

/**
 * The linear projection of a run (F-0 on 4K, prereg §3): each step's sample seconds × (frames to run ÷ sample frames),
 * rounded per step and summed. `frames` names each run's frame count. A lower bound where a step grows faster than
 * its input.
 */
export function project(rows: TimingRow[], sampleFrames: number, runs: { session: string; every: number; frames: number }[]) {
  return runs.map((r) => {
    const perStep = rows.map((s) => Math.round((s.seconds * r.frames) / sampleFrames));
    const seconds = sum(perStep);
    return { ...r, seconds, hours: Math.round((seconds / 3600) * 100) / 100 };
  });
}

/** The card stopped after the pilot (its stop rule): time only. The pre-registered measures are not computed on the pilot. */
function pilotOnly(timingPilot: string, sample: string, set: string): object {
  return {
    runId: "F0-frames",
    card: "F-0 on frames",
    date: new Date().toLocaleDateString("en-CA"),
    status: "stopped after the pilot: the projected full run is over 10 hours (the card's stop rule); the full run was not started",
    scope: "time only; the pre-registered agreement measures were not computed on the pilot (prereg.md)",
    time: timing(readTiming(timingPilot), null, sessionImages(sample).length, sessionImages(set).length),
    f0ModelSeconds: { "pilot-000": f0ModelSeconds("pilot-000"), [sample]: f0ModelSeconds(sample) },
  };
}

/**
 * F-0 on 4K: each sample part and each reference measured on its own (never pooled), every part minus every
 * reference, each part's time against the reference frames' time, and the projection from the frames part. Writes
 * evals/<run>/metrics.json.
 */
function sampleRun(values: { run?: string; parts?: string; references?: string; timing?: string[]; "project-from"?: string; project?: string; "project-every"?: string }): void {
  const list = (x: string | undefined, what: string) => {
    const l = (x ?? "").split(",").map((v) => v.trim()).filter(Boolean);
    if (!l.length) throw new Error(`sample: name --${what}`);
    return l;
  };
  const run = values.run ?? "F0-4k";
  const parts = list(values.parts, "parts");
  const references = list(values.references, "references");
  const timings = new Map((values.timing ?? []).map((t) => {
    const i = t.indexOf("=");
    if (i < 0) throw new Error("sample: --timing <part>=<tsv>");
    return [t.slice(0, i), readTiming(t.slice(i + 1))] as const;
  }));
  const sets: Record<string, ReturnType<typeof measureSet>> = {};
  for (const s of [...references, ...parts]) sets[s] = measureSet(s);
  const difference: Record<string, unknown> = {};
  for (const p of parts) for (const r of references) difference[`${p} minus ${r}`] = differences(sets[r], sets[p]);
  // The reference frames' time: #98's committed aggregates (evals/F0-frames/metrics.json), never recomputed.
  const f0frames = JSON.parse(readFileSync(join(REPO, "evals", "F0-frames", "metrics.json"), "utf8")) as { sample: { frames: number }; time: { rows: { name: string; fullSeconds: number | null }[]; totals: { fullSeconds: number } } };
  const refImages = f0frames.sample.frames;
  const time = Object.fromEntries(parts.map((p) => {
    const rows = timings.get(p);
    if (!rows) return [p, null];
    const t = partTime(rows, sessionImages(p).length);
    return [p, { ...t, againstF0Frames: { referenceImages: refImages, referenceSecondsPerImage: Math.round((f0frames.time.totals.fullSeconds / refImages) * 100) / 100, perStep: perStepAgainst(t, f0frames.time.rows, refImages) } }];
  }));
  let projection: object | null = null;
  if (values["project-from"]) {
    const from = values["project-from"];
    const rows = timings.get(from);
    if (!rows) throw new Error(`sample: no --timing for ${from}`);
    const sampleFrames = sessionImages(from).length;
    const everys = list(values["project-every"] ?? "1,3,10", "project-every").map(Number);
    const runs = list(values.project, "project").flatMap((s) => everys.map((every) => ({ session: s, every, frames: sessionImages(`${s}.frames.every-${every}`).length })));
    const rowsOut = project(rows, sampleFrames, runs);
    const totals = everys.map((every) => {
      const of = rowsOut.filter((r) => r.every === every);
      const seconds = sum(of.map((r) => r.seconds));
      return { every, frames: sum(of.map((r) => r.frames)), seconds, hours: Math.round((seconds / 3600) * 100) / 100 };
    });
    projection = { from, sampleFrames, sampleSeconds: sum(rows.map((r) => r.seconds)), rule: "each step's sample seconds × (frames to run ÷ sample frames), rounded per step and summed; linear in frames, a lower bound where a step grows faster", runs: rowsOut, totals };
  }
  const metrics = {
    runId: run,
    card: "F-0 on 4K",
    date: new Date().toLocaleDateString("en-CA"),
    scope: "real use (OC35): machine agreement between the stack's own stages and readers, never accuracy (INV-17); no hand labels (OC36)",
    note: "Each part is measured on its own; stills and frames are never pooled. Frames overlap (1 fps sweeps): one physical book is counted once per image it appears in; nothing is deduplicated across images. Small samples: counts stand beside every share, and no difference is tested.",
    samples: Object.fromEntries([...parts, ...references].map((s) => [s, sampleScope(s)])),
    sets,
    difference,
    time,
    projection,
  };
  const out = join(REPO, "evals", run);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
  console.error(`[f0-frames] ${run} metrics -> evals/${run}/metrics.json (${parts.map((p) => `${p}: ${sets[p]!.defaultBoxCount}`).join(", ")} default boxes)`);
}

function main(): void {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      "timing-pilot": { type: "string" }, "timing-full": { type: "string" }, set: { type: "string", default: "sf-store-001" }, pilot: { type: "string", default: "sf-store-001.every-30" },
      run: { type: "string" }, parts: { type: "string" }, references: { type: "string" }, timing: { type: "string", multiple: true }, "project-from": { type: "string" }, project: { type: "string" }, "project-every": { type: "string" },
    },
  });
  if (positionals[0] === "sample") return sampleRun(values);
  const set = values.set!;
  const write = (m: object) => {
    const out = join(REPO, "evals", "F0-frames");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "metrics.json"), `${JSON.stringify(m, null, 2)}\n`);
  };
  if (positionals[0] === "pilot") {
    if (!values["timing-pilot"]) throw new Error("pilot: name --timing-pilot <tsv>");
    write(pilotOnly(values["timing-pilot"], values.pilot!, set));
    console.error("[f0-frames] pilot time -> evals/F0-frames/metrics.json");
    return;
  }
  if (positionals[0] !== "measure") throw new Error("usage: f0-frames-cli.ts measure --timing-pilot <tsv> [--timing-full <tsv>] | pilot --timing-pilot <tsv> | sample --parts <a,b> --references <c,d> --timing <part>=<tsv> … [--project-from <part> --project <sessions> --project-every 1,3,10]");
  const reference = measureSet("pilot-000");
  const frames = measureSet(set);
  const pilotFrames = sessionImages(values.pilot!).length;
  const fullFrames = sessionImages(set).length;
  const time = values["timing-pilot"] ? timing(readTiming(values["timing-pilot"]), values["timing-full"] && existsSync(values["timing-full"]) ? readTiming(values["timing-full"]) : null, pilotFrames, fullFrames) : null;
  const metrics = {
    runId: "F0-frames",
    card: "F-0 on frames",
    date: new Date().toLocaleDateString("en-CA"),
    scope: "real use (OC35): machine agreement between the stack's own stages and readers, never accuracy (INV-17); no hand labels (OC36)",
    note: "Frames overlap (1 fps sweeps): one physical book is counted once per frame it appears in; nothing is deduplicated across frames.",
    sample: sampleScope(set),
    sets: { "pilot-000": reference, [set]: frames },
    difference: { of: `${set} minus pilot-000`, ...(differences(reference, frames) as object) },
    time,
  };
  write(metrics);
  console.error(`[f0-frames] metrics -> evals/F0-frames/metrics.json (${reference.defaultBoxCount} and ${frames.defaultBoxCount} default boxes)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
