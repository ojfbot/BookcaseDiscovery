// TS-2 · distilled spine reader (pre-registered in evals/TS2/prereg.md): a Qwen3-VL LoRA student trained on TS-0's
// strong class, scored against F-0's three readers as a fourth reader and as a replacement for the slowest one.
//
// Pure: the training filter, the rotation a label is trained at, the catalog candidates that steer the student's
// decoding, the arms' votes and the measures. The runner is src/eval/ts2-cli.ts; the decoder is
// helpers/train/read_student.py. Steering lives in this eval harness only: F-0's readers, `decide` and identify's
// runners are untouched, and no default changes. Weights are private-only (models/registry/ts2-spine-reader.json).
import type { Candidate } from "../catalog/retrieve.ts";
import { ACCEPT, confirms, vote, type ReaderName } from "./f0.ts";
import { byImage, clusterBootstrap, quantile, rng } from "./q1.ts";
import { assertMachineBasis, assertTrainable, type LabelRow } from "./ts0.ts";

/** The student's reader name in the arms' votes (never one of F-0's `READERS`). */
export const STUDENT = "student" as const;
export type ArmReader = ReaderName | typeof STUDENT;

export const TS2 = {
  /** TS-0's ledger version the card was pre-registered on (a rebuild that changes it is a deviation). */
  ledgerVersion: "v-4e0ec70a69de",
  /** The base: the local Qwen3-VL-4B-Instruct 8-bit MLX weights F-0's reader R2 uses; LoRA on the quantized model. */
  base: { name: "qwen3-vl-4b-instruct-8bit", dir: "qwen3-vl-4b-8bit" },
  /** LoRA and optimiser settings, fixed before any run (helpers/train/train.py passes them to mlx-vlm). */
  lora: {
    rank: 8,
    alpha: 16,
    dropout: 0.05,
    learningRate: 1e-4,
    epochs: 2,
    batchSize: 1,
    seed: 20261105,
    maxSeqLength: 1024,
    trainOnCompletions: true,
    trainVision: false,
  },
  /** Decoding: greedy, F-0's spine prompt (read.py `QWEN_PROMPT`), F-0's token cap. */
  decode: { maxTokens: 48, temperature: 0 },
  /**
   * Catalog steering: the top `k` C-3 candidates from Vision's and PP-OCR's readings of the same box, merged by score.
   * While the student's output is still a token prefix of a candidate's target, each candidate's next token gets
   * `bias` added to its logit; once it leaves every candidate it decodes free (the unmatched fallback).
   */
  steer: { k: 5, bias: 2.0, from: ["vision", "ppocr"] as readonly ReaderName[] },
  /** The reader the replacement arm swaps out: the slowest per crop over both sets' cached readings (prereg). */
  replaces: "qwen" as ReaderName,
  /** GPU budget in minutes, training and eval together; the exploratory free-decoding arm runs only above `ablationFloor` left. */
  gpuBudgetMin: 120,
  ablationFloor: 25,
  reps: 2000,
  seed: 20261105,
} as const;

// --- training data ------------------------------------------------------------------------------------------

export type Exclusion = "val-split" | "not-strong" | "one-reader";

/**
 * The rows the student trains on: TS-1's strong class, train split only. Every row is checked against OC35
 * (`assertTrainable`) and OC36 (`assertMachineBasis`) first, so a yardstick, audit or hand-labelled row throws rather
 * than being filtered. Single-reader labels and the val split never pass.
 */
export function trainRows(rows: readonly LabelRow[]): { rows: LabelRow[]; excluded: Record<Exclusion, number> } {
  const excluded: Record<Exclusion, number> = { "val-split": 0, "not-strong": 0, "one-reader": 0 };
  const out: LabelRow[] = [];
  for (const r of rows) {
    assertTrainable(r.set);
    assertMachineBasis(r.basis);
    if (r.split !== "train") excluded["val-split"]++;
    else if (r.readers.length < 2) excluded["one-reader"]++;
    else if (!r.strong) excluded["not-strong"]++;
    else out.push(r);
  }
  for (const r of out) if (r.split !== "train" || !r.strong || r.readers.length < 2) throw new Error("TS-2: a non-trainable row passed the filter");
  return { rows: out, excluded };
}

/** The student's target: the work as the catalog has it, in the spine prompt's shape (title, then authors). */
export function targetText(work: { title: string; authors: readonly string[] }): string {
  const title = work.title.replace(/\s+/g, " ").trim();
  const authors = work.authors.map((a) => a.replace(/\s+/g, " ").trim()).filter(Boolean);
  return authors.length ? `${title}\n${authors.join(", ")}` : title;
}

/**
 * The rotation a label is trained at: the one whose agreeing readers' text gives the label's work the highest
 * retrieval evidence (F-0 reads every spine at 90° and 270°; one of them is upside down). Ties go to the first.
 */
export function bestRotation(scores: readonly { rotation: number; score: number }[]): number | null {
  let best: { rotation: number; score: number } | null = null;
  for (const s of scores) if (!best || s.score > best.score) best = s;
  return best && best.score > 0 ? best.rotation : null;
}

// --- steering -----------------------------------------------------------------------------------------------

/** The steering candidates: each source reader's ranked candidates, merged (best score per work), top `k`. */
export function steerCandidates(ranked: readonly (readonly Candidate[])[], k: number = TS2.steer.k): Candidate[] {
  const best = new Map<string, Candidate>();
  for (const list of ranked) for (const c of list) if (!best.has(c.workId) || best.get(c.workId)!.score < c.score) best.set(c.workId, c);
  return [...best.values()].sort((a, b) => b.score - a.score || a.workId.localeCompare(b.workId)).slice(0, k);
}

// --- arms ---------------------------------------------------------------------------------------------------

/** F-0's base decision on one kept box: what each cached reader confirmed. */
export interface BaseBox {
  id: string;
  imageId: string;
  confirmed: Partial<Record<ReaderName, string | null>>;
  readText: Partial<Record<ReaderName, boolean>>;
  accepted: string | null;
}

/**
 * The boxes a student read can change: those where some cached reader confirmed a work. A box with no confirmation
 * cannot reach two votes with one more reader, nor lose one when a reader is replaced.
 */
export const decisionRelevant = (b: BaseBox): boolean => Object.values(b.confirmed).some(Boolean);

export const ARMS = ["base", "fourth", "replace"] as const;
export type Arm = (typeof ARMS)[number];

/** The student's say on one box: its top work confirmed by the catalog bar (null: read, nothing confirmed). */
export interface StudentVote {
  confirmed: string | null;
  readText: boolean;
}

/**
 * One arm's accept, by F-0's own vote (two readers confirming one work, uniquely). `fourth`: the cached three plus the
 * student. `replace`: the student stands in for `TS2.replaces` on the boxes that reader read (F-0's routing), and the
 * replaced reader's votes are dropped everywhere.
 */
export function armAccept(arm: Arm, b: BaseBox, s: StudentVote | undefined, replacedRead: boolean): string | null {
  const confirmed: Partial<Record<ArmReader, string | null>> = { ...b.confirmed };
  const readText: Partial<Record<ArmReader, boolean>> = { ...b.readText };
  if (arm === "fourth" && s) (confirmed[STUDENT] = s.confirmed), (readText[STUDENT] = s.readText);
  if (arm === "replace") {
    delete confirmed[TS2.replaces];
    delete readText[TS2.replaces];
    if (s && replacedRead) (confirmed[STUDENT] = s.confirmed), (readText[STUDENT] = s.readText);
  }
  // F-0's `vote` reads its maps by entry, so a fifth key votes like any reader.
  return vote({ confirmed: confirmed as Record<ReaderName, string | null>, readText: readText as Record<ReaderName, boolean>, top: {} }).acceptedId;
}

/** The student's confirmed work from its best-ranked candidate: F-0's bar, unchanged. */
export const studentConfirms = (c: Candidate | undefined): string | null => (c && confirms(c) ? c.workId : null);

// --- measures -----------------------------------------------------------------------------------------------

export type Outcome = "confirmed" | "wrong" | "none";

/** Yardstick (PROXY): an accept is `confirmed` when the work is annotated in the photo, else `wrong`. */
export const outcomeOf = (accepted: string | null, truth: ReadonlySet<string> | undefined): Outcome =>
  !accepted ? "none" : !truth || truth.has(accepted) ? "confirmed" : "wrong";

/** One box under every arm, the bootstrap's row. */
export interface ArmRow {
  id: string;
  imageId: string;
  accepted: Record<Arm, string | null>;
  /** Yardstick only. */
  truth?: ReadonlySet<string>;
}

type Tri = { value: number; lo: number; hi: number } | null;

const count = (rows: readonly ArmRow[], arm: Arm, o: Outcome): number => rows.filter((r) => outcomeOf(r.accepted[arm], r.truth) === o).length;

/** Each arm's confirmed and wrong totals, and its change from the base with a 95 % photo-cluster interval. */
export function armMeasures(rows: ArmRow[], reps: number = TS2.reps, seed: number = TS2.seed) {
  const photos = byImage(rows).length;
  const out: Record<string, unknown> = { photos, rows: rows.length };
  for (const arm of ARMS) {
    const conf = count(rows, arm, "confirmed");
    const wrong = count(rows, arm, "wrong");
    out[arm] = {
      accepted: conf + wrong,
      confirmed: conf,
      wrong,
      ...(arm === "base"
        ? {}
        : {
            deltaConfirmed: clusterBootstrap(rows, (rs) => count(rs, arm, "confirmed") - count(rs, "base", "confirmed"), reps, seed),
            deltaWrong: clusterBootstrap(rows, (rs) => count(rs, arm, "wrong") - count(rs, "base", "wrong"), reps, seed),
            gained: rows.filter((r) => !r.accepted.base && r.accepted[arm]).length,
            lost: rows.filter((r) => r.accepted.base && !r.accepted[arm]).length,
            changed: rows.filter((r) => r.accepted.base && r.accepted[arm] && r.accepted.base !== r.accepted[arm]).length,
          }),
    };
  }
  return out as { photos: number; rows: number } & Record<Arm, { accepted: number; confirmed: number; wrong: number; deltaConfirmed?: Tri; deltaWrong?: Tri; gained?: number; lost?: number; changed?: number }>;
}

/**
 * The pre-registered keep rule, per arm, on the yardstick (PROXY): confirmed books rise with the 95 % interval above 0,
 * and wrong accepts do not rise (the arm's total is at most the base's).
 */
export function keeps(m: ReturnType<typeof armMeasures>, arm: Exclude<Arm, "base">): { keep: boolean; confirmedUp: boolean; wrongNotUp: boolean } {
  const a = m[arm];
  const confirmedUp = !!a.deltaConfirmed && a.deltaConfirmed.value > 0 && a.deltaConfirmed.lo > 0;
  const wrongNotUp = a.wrong <= m.base.wrong;
  return { keep: confirmedUp && wrongNotUp, confirmedUp, wrongNotUp };
}

/** `pilot-000` val, machine agreement (INV-17): one val label and the work the student confirmed on its box. */
export interface AgreeRow {
  imageId: string;
  workId: string;
  strong: boolean;
  student: string | null;
  read: boolean;
}

/** Share of val labels whose work the student confirms, all labels and strong only, with photo-cluster intervals. */
export function agreement(rows: AgreeRow[], reps: number = TS2.reps, seed: number = TS2.seed) {
  const share = (pick: (r: AgreeRow) => boolean) => (rs: AgreeRow[]) => {
    const xs = rs.filter(pick);
    return xs.length ? xs.filter((r) => r.student === r.workId).length / xs.length : null;
  };
  const side = (pick: (r: AgreeRow) => boolean) => ({
    labels: rows.filter(pick).length,
    photos: byImage(rows.filter(pick)).length,
    agree: rows.filter((r) => pick(r) && r.student === r.workId).length,
    otherWork: rows.filter((r) => pick(r) && r.student && r.student !== r.workId).length,
    noConfirm: rows.filter((r) => pick(r) && !r.student).length,
    share: clusterBootstrap(rows.filter(pick), share(() => true), reps, seed),
  });
  return { all: side(() => true), strong: side((r) => r.strong) };
}

/** Seconds a crop (both rotations), mean with a 95 % percentile interval over crops (a plain bootstrap). */
export function secondsPerCrop(xs: readonly number[], reps: number = TS2.reps, seed: number = TS2.seed): Tri {
  if (xs.length === 0) return null;
  const mean = (v: readonly number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const rand = rng(seed);
  const draws: number[] = [];
  for (let r = 0; r < reps; r++) {
    let s = 0;
    for (let i = 0; i < xs.length; i++) s += xs[Math.floor(rand() * xs.length)]!;
    draws.push(s / xs.length);
  }
  draws.sort((a, b) => a - b);
  return { value: mean(xs), lo: quantile(draws, 0.025), hi: quantile(draws, 0.975) };
}

/**
 * Exploratory (not pre-registered): on the boxes the fourth arm gains, which cached reader the student agreed with,
 * whether its output was a steering candidate verbatim, and the outcome. Asks whether steering towards Vision's and
 * PP-OCR's candidates makes the student share their errors (TS-1's correlated-error finding).
 */
export function gainBreakdown(rows: { base: BaseBox; accepted: string | null; truth?: ReadonlySet<string>; verbatim: boolean }[]) {
  const out: Record<string, { confirmed: number; wrong: number }> = {};
  for (const r of rows) {
    if (r.base.accepted || !r.accepted) continue;
    const partners = (Object.entries(r.base.confirmed) as [ReaderName, string | null][]).filter(([, w]) => w === r.accepted).map(([k]) => k).sort().join("+") || "none";
    const key = `${partners}|${r.verbatim ? "verbatim" : "own"}`;
    const o = outcomeOf(r.accepted, r.truth);
    out[key] ??= { confirmed: 0, wrong: 0 };
    if (o === "confirmed") out[key].confirmed++;
    else if (o === "wrong") out[key].wrong++;
  }
  return out;
}

/** The acceptance bar the student's reads are held to (F-0's, re-exported so the report can print it). */
export const BAR = ACCEPT;
