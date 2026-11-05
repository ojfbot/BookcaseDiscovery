// DL-5 · eval hygiene: counts only. How many works (and, as far as anything records it, physical copies) sit on both
// sides of TS-0's frozen F-1 split, and how many past cards read the public yardstick or decided a keep rule on it.
// Nothing is decided by a keep rule here, so there is no pre-registration. Pure; the runner is src/eval/dl5-cli.ts.

// --- work-level split leakage ---------------------------------------------------------------------------------

/** The fields of a label-ledger row (TS-0's `LabelRow`) the leakage count reads. */
export interface LeakRow {
  workId: string;
  split: string;
  imageSha256: string;
  strong: boolean;
  readers: readonly string[];
}

/** One F-0g copy-group member: the group (an id within one set) and the photo it stands in. */
export interface CopyMember {
  group: string;
  imageId: string;
}

/** TS-2's training rows: the strong class, train split, two readers or more (`trainRows` in src/eval/ts2.ts). */
const trainsTs2 = (r: LeakRow) => r.split === "train" && r.strong && r.readers.length >= 2;

/**
 * Works and labels by which side of the split they fall on. A work is **in both** when it has a label on a `train`
 * photo and one on a `val` photo. A physical copy is one work, so works in both bound the copies in both from above;
 * F-0g's copy groups are the only copy identity recorded, and a group that spans photos could straddle the split.
 */
export function leakage(rows: readonly LeakRow[], copies: readonly CopyMember[], splitOf: (imageId: string) => string | undefined) {
  const sides = new Map<string, Set<string>>();
  for (const r of rows) sides.set(r.workId, (sides.get(r.workId) ?? new Set()).add(r.split));
  const both = new Set([...sides].filter(([, s]) => s.has("train") && s.has("val")).map(([w]) => w));
  const only = (split: string) => [...sides.values()].filter((s) => s.size === 1 && s.has(split)).length;
  const ts2Works = new Set(rows.filter(trainsTs2).map((r) => r.workId));
  const val = rows.filter((r) => r.split === "val");

  const groups = new Map<string, Set<string>>();
  for (const c of copies) groups.set(c.group, (groups.get(c.group) ?? new Set()).add(c.imageId));
  const spans = [...groups.values()];
  const splitsOf = (imgs: Set<string>) => new Set([...imgs].map((i) => splitOf(i) ?? "unknown"));

  return {
    labels: rows.length,
    photos: { train: new Set(rows.filter((r) => r.split === "train").map((r) => r.imageSha256)).size, val: new Set(val.map((r) => r.imageSha256)).size },
    works: { all: sides.size, trainOnly: only("train"), valOnly: only("val"), heldOutOnly: only("held-out"), inBoth: both.size },
    labelsOnWorksInBoth: { train: rows.filter((r) => r.split === "train" && both.has(r.workId)).length, val: val.filter((r) => both.has(r.workId)).length },
    /** The leakage TS-2 can see: val labels whose work is among TS-2's own training targets. */
    ts2: { trainWorks: ts2Works.size, valLabels: val.length, valLabelsOnTrainWorks: val.filter((r) => ts2Works.has(r.workId)).length, valWorksInTrain: new Set(val.filter((r) => ts2Works.has(r.workId)).map((r) => r.workId)).size },
    copies: {
      groups: spans.length,
      groupsSpanningPhotos: spans.filter((s) => s.size > 1).length,
      groupsStraddlingSplit: spans.filter((s) => { const sp = splitsOf(s); return sp.has("train") && sp.has("val"); }).length,
      /** Upper bound: a copy on both sides is a work on both sides. */
      copiesInBothAtMost: both.size,
    },
  };
}

// --- yardstick reuse by card ----------------------------------------------------------------------------------

/** What an eval folder holds: its `metrics.json` and the text of its `prereg.md` and `report.md`. */
export interface CardEval {
  card: string;
  metrics: unknown;
  text: string;
}

/** Cards whose keep rule chose on the yardstick in a way neither text test below can see, with the reason. */
export const GATED_BY_READING: Readonly<Record<string, string>> = {
  F0: "the box arms B1 to B4 were compared on the yardstick's title score and B2 kept as the default",
};

const YARD = /yardstick/i;
/** A sentence that states a keep condition: a numbered criterion, the keep rule, the verdict, or kept if/when. */
const KEEP = /\bK\d+[a-z]?\b|keep rule|kept (if|when)|keep when|verdict/i;

function* leaves(v: unknown, key = ""): Generator<[string, unknown]> {
  if (Array.isArray(v)) for (const x of v) yield* leaves(x, key);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) yield* leaves(x, k);
  else yield [key, v];
}

function* keys(v: unknown): Generator<string> {
  if (Array.isArray(v)) for (const x of v) yield* keys(x);
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      yield k;
      yield* keys(x);
    }
}

export type Use = "gated" | "read" | "not read";

/** A prereg or report as blocks: paragraphs and list items, with table rows and headings left out. */
export function blocks(text: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.length) out.push(cur.join(" ").replace(/\s+/g, " ").trim());
    cur = [];
  };
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("|") || t.startsWith("#") || t.startsWith("<!--")) flush();
    else {
      if (/^([-*]|\d+\.)\s/.test(t)) flush();
      cur.push(t);
    }
  }
  flush();
  return out;
}

/**
 * How a card used the yardstick. **read**: its metrics name the yardstick in a key, or in a scope string as PROXY or
 * the Library Dataset (a string saying the yardstick is not used names neither). **gated**: read, and a keep
 * condition was decided on it: a pass/fail (boolean) metric keyed to the yardstick, a paragraph or list item of its
 * prereg or report that names both the yardstick and a keep condition, or an entry in `GATED_BY_READING`. A text
 * heuristic: it can miss a gate, or count a paragraph that names a keep condition beside a yardstick figure.
 */
export function yardstickUse(e: CardEval): { use: Use; via: string | null } {
  const ls = [...leaves(e.metrics)];
  const read = [...keys(e.metrics)].some((k) => YARD.test(k)) || ls.some(([, v]) => typeof v === "string" && /PROXY|Library Dataset/.test(v));
  if (!read) return { use: "not read", via: null };
  if (ls.some(([k, v]) => typeof v === "boolean" && YARD.test(k))) return { use: "gated", via: "boolean metric" };
  if (blocks(e.text).some((b) => YARD.test(b) && KEEP.test(b))) return { use: "gated", via: "keep paragraph" };
  if (GATED_BY_READING[e.card]) return { use: "gated", via: "by reading" };
  return { use: "read", via: null };
}

// --- the yardstick's parts ------------------------------------------------------------------------------------

/**
 * F-0's deterministic sample (src/eval/f0-cli.ts `yardstick`): of the annotated images on disk, sorted, every
 * `step`-th from the middle of each stride, `limit` of them. The stride starts were the smoke-test images looked at
 * while the pipeline was built. Returns indices into the sorted list.
 */
export function yardstickParts(n: number, limit = 40): { step: number; sample: number[]; smoke: number[] } {
  const step = Math.max(2, Math.floor(n / limit));
  const idx = [...Array(n).keys()];
  return { step, sample: idx.filter((i) => i % step === Math.floor(step / 2)).slice(0, limit), smoke: idx.filter((i) => i % step === 0) };
}

/** Rule of three: the 95 % upper bound on a rate when 0 events are seen in n trials. */
export const ruleOfThree = (n: number): number | null => (n > 0 ? 3 / n : null);
