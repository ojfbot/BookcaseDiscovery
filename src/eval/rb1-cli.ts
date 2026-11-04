// RB-1 runner: the batched re-baseline's summary. Each downstream card re-ran once on RB-1's box set (src/eval/rb1.ts)
// with its own CLI; this reads every card's metrics as first published (git, at the base commit) and as re-run (the
// working tree), and writes the side-by-side figures:
//
//   node src/eval/rb1-cli.ts summary   # each card's evals/<card>/{metrics.json,report.md} re-baseline section, and evals/RB1/
//
// Aggregates only: everything read is an evals/ file. The two sets are reported apart (OC35); `pilot-000` figures are
// machine agreement, never accuracy (INV-17). Run the cards first, in RB-1's order (evals/RB1/report.md).

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
/** main before RB-1: every card's figures as first published, on its own box set. */
export const BASE = "116f4e9";
export const DATE = "2026-11-04";
export const SECTION = `## Re-baseline ${DATE} (F-0i + NB-3 on-lip)`;
const log = (s: string): void => console.error(`[rb1] ${s}`);

type Json = Record<string, unknown>;
type SetName = "pilot-000" | "yardstick";
/** One headline figure: where it sits in a card's metrics, how to print it, which set it belongs to. */
interface Figure {
  set: SetName;
  label: string;
  path: string;
  /** Multiply for printing (100 for a share shown in %). */
  scale?: number;
  /** Decimals after scaling. */
  dp?: number;
}
/** A keep rule or go rule: its verdict path in metrics (true = ships / go). */
interface Verdict {
  label: string;
  path: string;
}
interface Card {
  card: string;
  dir: string;
  figures: Figure[];
  verdicts: Verdict[];
  /** What the card's own CLI re-ran (shown in the section). */
  rerun: string;
  /** Hand-written reading of the delta, above the generated table. */
  notes: string[];
  /** For a report whose generated tables start with `###` headings: a `##` heading for them, so they do not read as this section's. */
  tablesHeading?: string;
}

export function at(m: unknown, path: string): unknown {
  let x: unknown = m;
  for (const k of path.split(".")) {
    if (x === null || typeof x !== "object") return undefined;
    x = Array.isArray(x) && /^\d+$/.test(k) ? x[Number(k)] : (x as Json)[k.replace(/~/g, ".")];
  }
  return x;
}

/** A figure for printing: a number, a [value, lo, hi] interval, an {n, lo, hi} count or a boolean. */
export function show(v: unknown, scale = 1, dp = 2): string {
  const f = (x: number) => (Math.round(x * scale * 10 ** dp) / 10 ** dp).toFixed(dp);
  if (v === undefined || v === null) return "–";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return f(v);
  if (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number")) return `${f(v[0])} (${f(v[1])} to ${f(v[2])})`;
  const o = v as { n?: number; lo?: number; hi?: number; value?: number; delta?: number };
  if (typeof o === "object" && (typeof o.n === "number" || typeof o.value === "number" || typeof o.delta === "number")) {
    const n = (o.n ?? o.value ?? o.delta)!;
    return typeof o.lo === "number" && typeof o.hi === "number" ? `${f(n)} (${f(o.lo)} to ${f(o.hi)})` : f(n);
  }
  return JSON.stringify(v);
}

/** Q-3's causes by books lost, as ranked in one set's metrics. */
export function ranking(m: unknown, set: SetName): { cause: string; n: number; lo: number; hi: number; residual: boolean }[] {
  const r = (at(m, `sets.${set}.ranked`) ?? []) as { cause: string; residual: boolean; lost: { n: number; lo: number; hi: number } }[];
  return r.map((x) => ({ cause: x.cause, n: x.lost.n, lo: x.lost.lo, hi: x.lost.hi, residual: x.residual }));
}

const PILOT_NOTE = "machine agreement, never accuracy (INV-17)";
const YARD_NOTE = "PROXY, library shelves";

export const CARDS: Card[] = [
  {
    card: "F-0g",
    dir: "F0g",
    rerun: "`f0g-cli.ts pairs` (appearance on every photo again), `evidence` (only newly paired spines scored), `imprint --dry-run` (0 boxes to read: no GPU), `analyse`. `VISUAL` stays frozen; `calibrate` was not re-run.",
    figures: [
      { set: "pilot-000", label: "boxes", path: "sets.pilot-000.boxCount", dp: 0 },
      { set: "pilot-000", label: "neighbour pairs", path: "sets.pilot-000.neighbourPairs", dp: 0 },
      { set: "pilot-000", label: "copy groups per photo", path: "sets.pilot-000.groups.perPhoto" },
      { set: "pilot-000", label: "groups with a confirmed copy", path: "sets.pilot-000.groups.identified", dp: 0 },
      { set: "pilot-000", label: "confirmed boxes (F-0)", path: "sets.pilot-000.propagation.confirmedBase", dp: 0 },
      { set: "pilot-000", label: "**extra confirmed boxes per photo** (confirmed-by-copy)", path: "sets.pilot-000.propagation.extraConfirmedPerPhoto" },
      { set: "pilot-000", label: "confirmed-by-copy boxes", path: "sets.pilot-000.propagation.confirmedByCopy", dp: 0 },
      { set: "pilot-000", label: "visually same, both confirmed: different works (%)", path: "sets.pilot-000.wrongGroupings.visualDifferentWorkShare", scale: 100, dp: 1 },
      { set: "pilot-000", label: "hard-negative one-reader views", path: "sets.pilot-000.seriesGuard.viewsAll", dp: 0 },
      { set: "pilot-000", label: "of them blocked (%)", path: "sets.pilot-000.seriesGuard.viewsAllBlocked", scale: 100, dp: 1 },
      { set: "yardstick", label: "boxes", path: "sets.yardstick.boxCount", dp: 0 },
      { set: "yardstick", label: "copy groups", path: "sets.yardstick.groups.total", dp: 0 },
      { set: "yardstick", label: "confirmed-by-copy boxes", path: "sets.yardstick.propagation.confirmedByCopy", dp: 0 },
      { set: "yardstick", label: "wrong accepts with propagation", path: "sets.yardstick.yardstick.wrongAcceptsWith", dp: 0 },
      { set: "yardstick", label: "wrong share of accepted (%)", path: "sets.yardstick.yardstick.wrongShareOfAcceptedWith", scale: 100, dp: 1 },
    ],
    verdicts: [{ label: "propagation ships (`confirmed-by-copy`)", path: "keep.ship" }],
    tablesHeading: "## Tables (re-run on RB-1's box set)",
    notes: [
      "Net of the pairs dropped boxes took with them and the pairs freed (spines no longer nested in a dropped parent), `pilot-000` loses 57 neighbour pairs and the yardstick gains 14. The same 9 boxes are confirmed by copy; one `pilot-000` group of two is gone.",
      "F-0g2 reads these pairs too (`runSet`); its own figures were not re-run here.",
    ],
  },
  {
    card: "Q-2b",
    dir: "Q2b",
    rerun: "`q2b-cli.ts u4` (U-4's still study, both sources), `diag`, `analyse`, `render`. Q-1's features and Q-2's top-seam geometry are per box on unchanged detection rectangles, so their caches stand; `features` and `outlines` (GPU) were not re-run. U-4's outlines are now F-0i's exclusive outlines.",
    figures: [
      { set: "pilot-000", label: "detected boxes", path: "teacher.sets.pilot-000.detected.n", dp: 0 },
      { set: "pilot-000", label: "student population", path: "teacher.sets.pilot-000.population.n", dp: 0 },
      { set: "pilot-000", label: "τ", path: "teacher.tau" },
      { set: "pilot-000", label: "filled share of the population (%)", path: "teacher.sets.pilot-000.populationFilled", scale: 100, dp: 1 },
      { set: "pilot-000", label: "**student AUC** (leave one photo out)", path: "student.goRule.studentAuc", dp: 3 },
      { set: "pilot-000", label: "gain over crop width", path: "student.goRule.gainOverBaseline", dp: 3 },
      { set: "pilot-000", label: "whole only: student AUC", path: "fragments.sets.pilot-000.population.whole.aucStudent", dp: 3 },
      { set: "pilot-000", label: "precision of \"filled\" at FILL_P (%)", path: "student.operatingPoint.atFillP.pilot-000.precision", scale: 100, dp: 1 },
      { set: "pilot-000", label: "U-4 boxes drawn from their own outline (%)", path: "outlinesForU4.shaped", scale: 100, dp: 1 },
      { set: "pilot-000", label: "U-4 filled spines (%)", path: "outlinesForU4.after.filledPct", scale: 1, dp: 1 },
      { set: "yardstick", label: "detected boxes", path: "teacher.sets.yardstick-library-b2.detected.n", dp: 0 },
      { set: "yardstick", label: "student population", path: "teacher.sets.yardstick-library-b2.population.n", dp: 0 },
      { set: "yardstick", label: "student AUC (one pilot fit)", path: "student.scores.yardstick-library-b2.models.student.auc", dp: 3 },
      { set: "yardstick", label: "precision of \"filled\" at FILL_P (%)", path: "student.operatingPoint.atFillP.yardstick-library-b2.precision", scale: 100, dp: 1 },
    ],
    verdicts: [{ label: "Q-2's go rule (GO)", path: "student.goRule.go" }],
    notes: [
      "τ moves 0.72 → 0.73 under the null procedure, inside the fragile band Q-2b reported (0.70–0.76).",
      "U-4's mask-shaped share falls because F-0i's exclusive outlines cut each box to the pixels it owns: more boxes are covered under 60 % by their own outline and are drawn as their box. This is the partition doing what it was built for, not an outline loss.",
    ],
  },
  {
    card: "H-2",
    dir: "H2",
    rerun: "`h2-cli.ts faces` (new: the per-box face file on the kept boxes, from the latest stage run; no depth runs), then `analyse`. Face rows are keyed by detection rectangle, which F-0i keeps, so a changed box's row is unchanged and only dropped rows leave. The `face3d` arm decisions were cached on a superset and are read on the new subset; no reader ran.",
    figures: [
      { set: "pilot-000", label: "over-selecting kept boxes (%)", path: "sets.pilot-000.faces.overSelects", scale: 100, dp: 1 },
      { set: "pilot-000", label: "trim feasible, of over-selecting (%)", path: "sets.pilot-000.faces.trimFeasibleOfOverSelecting", scale: 100, dp: 1 },
      { set: "pilot-000", label: "**`face3d` confirmed Δ (pts)**", path: "sets.pilot-000.face3d.all.confirmed", dp: 1 },
      { set: "pilot-000", label: "distinct confirmed works, `face3d` arm", path: "sets.pilot-000.face3d.distinctConfirmedWorks.after", dp: 0 },
      { set: "pilot-000", label: "distinct confirmed works Δ (`face3d` − `clip`)", path: "sets.pilot-000.face3d.distinctConfirmedWorks.delta", dp: 0 },
      { set: "yardstick", label: "over-selecting kept boxes (%)", path: "sets.yardstick-library-b2.faces.overSelects", scale: 100, dp: 1 },
      { set: "yardstick", label: "`face3d` confirmed Δ (pts)", path: "sets.yardstick-library-b2.face3d.all.confirmed", dp: 1 },
      { set: "yardstick", label: "`face3d` wrong Δ (pts)", path: "sets.yardstick-library-b2.face3d.all.wrong", dp: 1 },
    ],
    verdicts: [{ label: "`face3d` crop ships", path: "verdict.keep" }],
    notes: ["The `face3d` subset shrinks with the kept boxes (1,745 → 1,652 on `pilot-000`, 215 → 199 on the yardstick); every part of the keep rule reads as before."],
  },
  {
    card: "S-1",
    dir: "S1",
    rerun: "`s1-cli.ts shelf` on both sets (planes, voids and lip features from H-2's cached depth stage, CPU), then `analyse`. Rows are covered by RB-1's books, with F-0i's exclusive outlines on `pilot-000` (the yardstick has none: boxes stand in, as before). The `on-lip` test itself still runs on the shipped kinds, as pre-registered.",
    figures: [
      { set: "pilot-000", label: "rows", path: "sets.pilot-000.voids.rows", dp: 0 },
      { set: "pilot-000", label: "**void share** (pooled, %)", path: "sets.pilot-000.voids.voidShare", scale: 100, dp: 1 },
      { set: "pilot-000", label: "rows with a void (%)", path: "sets.pilot-000.voids.rowsWithVoid", scale: 100, dp: 1 },
      { set: "pilot-000", label: "candidate share (%)", path: "sets.pilot-000.voids.candidateShare", scale: 100, dp: 1 },
      { set: "pilot-000", label: "of candidates, `outline-gap` (%)", path: "sets.pilot-000.voids.outlineGapShareOfCandidates", scale: 100, dp: 1 },
      { set: "pilot-000", label: "`on-lip` removes (spine path)", path: "sets.pilot-000.onLip.spinePath.removed", dp: 0 },
      { set: "pilot-000", label: "`on-lip` removes confirmed", path: "sets.pilot-000.onLip.spinePath.removedConfirmed", dp: 0 },
      { set: "yardstick", label: "rows", path: "sets.yardstick.voids.rows", dp: 0 },
      { set: "yardstick", label: "void share (pooled, %)", path: "sets.yardstick.voids.voidShare", scale: 100, dp: 1 },
      { set: "yardstick", label: "candidate share (%)", path: "sets.yardstick.voids.candidateShare", scale: 100, dp: 1 },
      { set: "yardstick", label: "`on-lip` removes (spine path)", path: "sets.yardstick.onLip.spinePath.removed", dp: 0 },
    ],
    verdicts: [{ label: "`on-lip` keep rule met", path: "verdict.ships" }],
    notes: [
      "The lip is found on 98 % of `pilot-000` rows (96 % before) and the back panel on 62 % (60 %), on RB-1's books and F-0i's outlines. Voids stay rare; their share does not move.",
      "The `on-lip` figures reproduce exactly (4 and 2 boxes, none confirmed): its test reads box polygons, which F-0i keeps.",
    ],
  },
  {
    card: "F-0h",
    dir: "F0h",
    rerun: "`f0h-cli.ts analyse` on both sets: rows of RB-1's books (through F-0g's `loadBooks`) and S-1's re-run voids for the detection-gap flags. The keep rule is unchanged.",
    figures: [
      { set: "pilot-000", label: "half B: book boxes", path: "sets.pilot-000.eval.bookBoxes", dp: 0 },
      { set: "pilot-000", label: "half B: confirmed-by-context", path: "sets.pilot-000.eval.confirmedByContext", dp: 0 },
      { set: "pilot-000", label: "**half B: extra confirmed per photo**", path: "sets.pilot-000.eval.extraConfirmedPerPhoto" },
      { set: "pilot-000", label: "all 31 photos: confirmed-by-context", path: "sets.pilot-000.all.confirmedByContext", dp: 0 },
      { set: "pilot-000", label: "shuffle: share of real accepts (%)", path: "sets.pilot-000.shuffle.meanRatio", scale: 100, dp: 1 },
      { set: "pilot-000", label: "shuffle: p95 seed (%)", path: "sets.pilot-000.shuffle.p95Ratio", scale: 100, dp: 1 },
      { set: "pilot-000", label: "leave one reader out: wrong of accepted", path: "sets.pilot-000.loro.all.wrong", dp: 0 },
      { set: "pilot-000", label: "leave one reader out: accepted", path: "sets.pilot-000.loro.all.accepted", dp: 0 },
      { set: "yardstick", label: "book boxes", path: "sets.yardstick.eval.bookBoxes", dp: 0 },
      { set: "yardstick", label: "confirmed-by-context", path: "sets.yardstick.eval.confirmedByContext", dp: 0 },
      { set: "yardstick", label: "wrong accepts with context (22 without)", path: "sets.yardstick.yardstick.wrongAcceptsWith", dp: 0 },
      { set: "yardstick", label: "wrong share of accepts with context (%)", path: "sets.yardstick.yardstick.wrongShareWith", scale: 100, dp: 1 },
    ],
    verdicts: [{ label: "`confirmed-by-context` ships", path: "keep.ship" }],
    tablesHeading: "## Tables (re-run on RB-1's box set)",
    notes: [
      "One `pilot-000` context accept is gone: the box itself was a piece F-0i dropped. No accept is new, so the owner's neighbour-context example (a readable neighbour nested in an oversized box) is still not recovered by the partition.",
      "The shuffle's p95 seed rises 7.2 % → 9.1 % of real accepts, still under the 15 % bound.",
    ],
  },
  {
    card: "Q-3",
    dir: "Q3",
    rerun: "`q3-cli.ts v2` (cached rows reused; every box at `text-present` or `text-read` under Q-2b's new rungs was already cached), `audit pilot-000`, `audit yardstick`, `analyse`. Inputs: Q-2b's new rungs, F-0g's and F-0h's new bases, H-2's new face file, on RB-1's box set; S-2's rows and gaps as cached (S-2 ran on the partition).",
    figures: [
      { set: "pilot-000", label: "books a person can see", path: "sets.pilot-000.books", dp: 0 },
      { set: "pilot-000", label: "**lost below `confirmed`**", path: "sets.pilot-000.lost", dp: 0 },
      { set: "pilot-000", label: "lost share (%)", path: "sets.pilot-000.lostShare", scale: 100, dp: 1 },
      { set: "yardstick", label: "books a person can see", path: "sets.yardstick.books", dp: 0 },
      { set: "yardstick", label: "lost below `confirmed`", path: "sets.yardstick.lost", dp: 0 },
      { set: "yardstick", label: "lost share (%)", path: "sets.yardstick.lostShare", scale: 100, dp: 1 },
      { set: "yardstick", label: "annotated books found (reference, %)", path: "yardstickReference.foundShare", scale: 100, dp: 1 },
    ],
    verdicts: [],
    notes: [
      "Q-3 already ran on F-0i's partition, so its books move only with NB-3's `on-lip` boxes and with the upstream re-runs (Q-2b's rungs at τ 0.73, F-0g's and F-0h's bases, H-2's face file).",
      "The ranking holds: the same five causes lead in the same order on both sets, and every change is well inside its interval. `catalog-gap` falls by 36 on `pilot-000`, with fewer detected boxes at `text-read` in Q-2b's re-run (1,413 → 1,301).",
    ],
  },
];

// --- summary -------------------------------------------------------------------------------------------------

function before(dir: string): Json {
  return JSON.parse(execFileSync("git", ["show", `${BASE}:evals/${dir}/metrics.json`], { cwd: REPO, encoding: "utf8" })) as Json;
}
const after = (dir: string): Json => JSON.parse(readFileSync(join(REPO, "evals", dir, "metrics.json"), "utf8")) as Json;

export interface Row {
  set: SetName;
  figure: string;
  before: string;
  after: string;
}
export function rows(c: Card, b: Json, a: Json): Row[] {
  return c.figures.map((f) => ({ set: f.set, figure: f.label, before: show(at(b, f.path), f.scale, f.dp), after: show(at(a, f.path), f.scale, f.dp) }));
}
export function verdicts(c: Card, b: Json, a: Json): { label: string; before: boolean | null; after: boolean | null; flips: boolean }[] {
  return c.verdicts.map((v) => {
    const x = at(b, v.path), y = at(a, v.path);
    const bx = typeof x === "boolean" ? x : null, by = typeof y === "boolean" ? y : null;
    return { label: v.label, before: bx, after: by, flips: bx !== null && by !== null && bx !== by };
  });
}

/** Q-3's ranking side by side: rank, cause, books lost before and after (non-residual causes first, as ranked). */
export function rankTable(b: Json, a: Json, set: SetName, top = 8): string[] {
  const rb = ranking(b, set), ra = ranking(a, set);
  const old = new Map(rb.map((r, i) => [r.cause, { ...r, rank: i + 1 }]));
  const out = ["| rank now | cause | books lost now | rank before | books lost before |", "|---|---|---|---|---|"];
  ra.slice(0, top).forEach((r, i) => {
    const o = old.get(r.cause);
    out.push(`| ${i + 1} | \`${r.cause}\`${r.residual ? " (residual)" : ""} | ${r.n} (${Math.round(r.lo)}–${Math.round(r.hi)}) | ${o?.rank ?? "–"} | ${o ? `${o.n} (${Math.round(o.lo)}–${Math.round(o.hi)})` : "–"} |`);
  });
  return out;
}

function table(rs: Row[], set: SetName): string[] {
  const xs = rs.filter((r) => r.set === set);
  if (!xs.length) return [];
  return [`**${set}** (${set === "pilot-000" ? PILOT_NOTE : YARD_NOTE})`, "", "| figure | as published | RB-1 |", "|---|---|---|", ...xs.map((r) => `| ${r.figure} | ${r.before} | ${r.after} |`), ""];
}

function section(c: Card, b: Json, a: Json): string {
  const vs = verdicts(c, b, a);
  const out = [
    SECTION,
    "",
    `Re-run once on RB-1's box set ([evals/RB1](../RB1/report.md)): F-0i's partition (#51) of the shipped default boxes, less NB-3's \`on-lip\` boxes (#61). Box ids and detection rectangles are unchanged; F-0m (#60) and F-0k (#62) shipped nothing. Before: main ${BASE}, as published. Generated by \`node src/eval/rb1-cli.ts summary\`; the tables below this section are the re-run's.`,
    "",
    `What re-ran: ${c.rerun}`,
    "",
    ...c.notes.map((n) => `- ${n}`),
    ...(c.notes.length ? [""] : []),
    ...table(rows(c, b, a), "pilot-000"),
    ...table(rows(c, b, a), "yardstick"),
  ];
  if (c.card === "Q-3") {
    out.push("Causes by books lost (`pilot-000`, machine agreement):", "", ...rankTable(b, a, "pilot-000"), "");
    out.push("Causes by books lost (yardstick, PROXY):", "", ...rankTable(b, a, "yardstick", 5), "");
  }
  for (const v of vs) out.push(`**${v.label}:** ${show(v.before)} → ${show(v.after)}${v.flips ? " — **flips** (reported, not acted on: defaults do not change in RB-1)" : " (no flip)"}.`, "");
  if (c.tablesHeading) out.push(c.tablesHeading, "");
  return out.join("\n");
}

/** A card's metrics text with RB-1's block as its last key, the card's own formatting kept; an earlier block is replaced. */
export function withRebaseline(text: string, block: object): string {
  const KEY = `,\n  "rebaseline": `;
  const own = text.includes(KEY) ? `${text.slice(0, text.indexOf(KEY))}\n}` : text.trimEnd();
  if (!own.endsWith("}")) throw new Error("metrics.json does not end in an object");
  const body = JSON.stringify(block, null, 2).replace(/\n/g, "\n  ");
  return `${own.slice(0, -1).trimEnd()}${KEY}${body}\n}\n`;
}

/** Put the section just above the report's generated marker, replacing an earlier copy of it. */
export function placeSection(report: string, body: string): string {
  const start = report.indexOf(SECTION);
  const marker = report.search(/^<!-- (tables|generated|Tables)/m);
  if (start >= 0) {
    const end = report.slice(start + SECTION.length).search(/^(<!-- (tables|generated|Tables)|## (?!Tables \(re-run))/m);
    return report.slice(0, start) + body + "\n" + (end < 0 ? "" : report.slice(start + SECTION.length + end));
  }
  return marker < 0 ? `${report.trimEnd()}\n\n${body}\n` : report.slice(0, marker) + body + "\n" + report.slice(marker);
}

function summary(): void {
  const cards = CARDS.map((c) => {
    const b = before(c.dir), a = after(c.dir);
    const rp = join(REPO, "evals", c.dir, "report.md");
    writeFileSync(rp, placeSection(readFileSync(rp, "utf8"), section(c, b, a)));
    const rs = rows(c, b, a), vs = verdicts(c, b, a);
    writeFileSync(join(REPO, "evals", c.dir, "metrics.json"), withRebaseline(readFileSync(join(REPO, "evals", c.dir, "metrics.json"), "utf8"), { run: "RB1", date: DATE, base: BASE, figures: rs, verdicts: vs }));
    log(`${c.card}: ${rs.length} figures, ${vs.filter((v) => v.flips).length} verdict flips`);
    return { c, b, a, rs, vs };
  });
  const q3 = cards.find((x) => x.c.card === "Q-3")!;
  const top = (m: Json, set: SetName) => ranking(m, set).filter((r) => !r.residual).slice(0, 5).map((r) => ({ cause: r.cause, lost: [r.n, r.lo, r.hi] }));
  const metrics = {
    runId: "RB1",
    card: "RB-1",
    date: DATE,
    base: BASE,
    boxSet: "F-0i's partition (#51) of the shipped default boxes less NB-3's on-lip boxes (#61); F-0m (#60) and F-0k (#62) shipped nothing",
    cards: cards.map(({ c, rs, vs }) => ({ card: c.card, figures: rs, verdicts: vs })),
    flips: cards.flatMap(({ c, vs }) => vs.filter((v) => v.flips).map((v) => ({ card: c.card, verdict: v.label, before: v.before, after: v.after }))),
    q3TopCauses: { "pilot-000": { before: top(q3.b, "pilot-000"), after: top(q3.a, "pilot-000") }, yardstick: { before: top(q3.b, "yardstick"), after: top(q3.a, "yardstick") } },
  };
  const dir = join(REPO, "evals", "RB1");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
  const rp = join(dir, "report.md");
  const MARK = "<!-- generated by src/eval/rb1-cli.ts summary: edit above this line -->";
  let head: string;
  try {
    const old = readFileSync(rp, "utf8");
    head = old.includes(MARK) ? old.slice(0, old.indexOf(MARK)) : `${old.trimEnd()}\n\n`;
  } catch {
    head = "# RB-1 · batched re-baseline\n\n";
  }
  const gen = [MARK, "", "## Every card's headline figures, as published and on RB-1's box set", ""];
  for (const { c, rs, vs } of cards) {
    gen.push(`### ${c.card} ([report](../${c.dir}/report.md))`, "", ...table(rs, "pilot-000"), ...table(rs, "yardstick"));
    for (const v of vs) gen.push(`${v.label}: ${show(v.before)} → ${show(v.after)}${v.flips ? " — **flips**" : " (no flip)"}.`, "");
  }
  gen.push("### Q-3 causes by books lost", "", "`pilot-000` (machine agreement):", "", ...rankTable(q3.b, q3.a, "pilot-000"), "", "Yardstick (PROXY):", "", ...rankTable(q3.b, q3.a, "yardstick", 5), "");
  writeFileSync(rp, head + gen.join("\n"));
  log(`evals/RB1/{metrics.json,report.md}; ${metrics.flips.length} verdict flips`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  if (cmd === "summary") summary();
  else {
    console.error("usage: node src/eval/rb1-cli.ts summary");
    process.exit(2);
  }
}
