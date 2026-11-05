// MM-2 · multimodal self-gallery in shadow mode: the private shadow row logged beside each cached F-0 decision, and
// the measures over those rows (evals/MM2/prereg.md). Pure; the arms are `src/identify/appearance.ts`, the runner
// `src/eval/mm2-cli.ts`. Nothing here changes a decision.

import { z } from "zod";
import { primarySurname } from "../catalog/rarity.ts";
import { READERS, type ReaderName } from "./f0.ts";
import { MM1, type Pair } from "./mm1.ts";
import { ownTitleForm } from "./ts1.ts";

export const MM2 = {
  schemaVersion: "mm2/1",
  /** F-1's frozen splits: the label ledger version the pre-registration names. */
  ledger: "v-4e0ec70a69de",
  sets: MM1.sets,
  /** The stress test is also reported for DINOv2, at its own τv (no keep rule). */
  stressModels: ["siglip2", "dinov2"],
  bootstrap: MM1.bootstrap,
} as const;

export type Mm2Set = (typeof MM2.sets)[number];
export type StressModel = (typeof MM2.stressModels)[number];

/**
 * TS-1's book key: a work's own title form and primary surname. Two catalog records of one book share it, so a pair
 * with one key is never a lookalike; across two catalogs it is how a gallery work is checked against the yardstick.
 */
export function bookKey(titleNorm: string, authors: readonly string[]): string {
  return `${ownTitleForm(titleNorm) ?? ""}\u0000${primarySurname(authors)}`;
}

/**
 * Diagnostic: how a lookalike's book relates to the query's (by book key): a **namesake** shares the title form, a
 * **same-author** book the surname; `unknown` when the query's own book is not known (a yardstick box F-0 left open).
 */
export const LOOKALIKE_KINDS = ["namesake", "same-author", "unrelated", "unknown"] as const;
export type LookalikeKind = (typeof LOOKALIKE_KINDS)[number];
export function lookalikeKind(query: string | null, entry: string): LookalikeKind {
  if (query === null) return "unknown";
  const [qt, qs] = query.split("\u0000"), [et, es] = entry.split("\u0000");
  return qt === et ? "namesake" : qs && qs === es ? "same-author" : "unrelated";
}

// --- the shadow row (private, under the data root's private/mm2/<set>/) ------------------------------------------

const Reader = z.enum(READERS as [ReaderName, ...ReaderName[]]);
const Readers = z.array(Reader);
const Works = z.partialRecord(Reader, z.string().nullable());
const Reason = z.enum(["no-text", "no-catalog-match", "single-reader", "readers-disagree"]).nullable();
const Sim = z.strictObject({ acceptedId: z.string().nullable(), agreeing: Readers, reason: Reason, takers: Readers });
/** On the yardstick: is the work an annotated book of the image (book key)? Null on `pilot-000` or with no work. */
const Right = z.boolean().nullable();

export const ShadowRow = z.strictObject({
  schemaVersion: z.literal(MM2.schemaVersion),
  id: z.string().min(1),
  set: z.string().min(1),
  /** `train` and `val` on `pilot-000` (F-1's frozen split of the photo); `eval` on the yardstick. */
  split: z.enum(["train", "val", "eval"]),
  group: z.string().min(1),
  photo: z.number().int().nonnegative(),
  /** The cached F-0 decision as read, unchanged. */
  f0: z.strictObject({ accepted: z.string().nullable(), agreeing: Readers, reason: Reason, readText: z.partialRecord(Reader, z.boolean()), top: Works, confirmed: Works, right: Right }),
  /** The appearance record's label (TS-0's rule): the work the stress test treats as this box's. */
  label: z.string().nullable(),
  /** Diagnostic: is the box's F-0 work (on the yardstick, an annotated book) held by some gallery entry (book key)? */
  inGallery: z.boolean(),
  validStrip: z.boolean(),
  gallery: z
    .strictObject({
      nearest: z.strictObject({ workId: z.string(), cos: z.number() }).nullable(),
      near: z.number().int(),
      nearOnly: z.array(z.string()),
      matches: z.array(z.strictObject({ workId: z.string(), cos: z.number(), text: z.number(), fused: z.number() })),
      proposal: z.string().nullable(),
      proposalRight: Right,
      simulated: Sim,
      simulatedRight: Right,
    })
    .nullable(),
  free: z
    .strictObject({
      pool: z.number().int(),
      top: z.strictObject({ workId: z.string(), cos: z.number() }).nullable(),
      margin: z.number().nullable(),
      proposal: z.string().nullable(),
      proposalRight: Right,
      simulated: Sim,
      simulatedRight: Right,
      /** The secondary template's top and margin (no keep rule). */
      secondary: z.strictObject({ top: z.string().nullable(), margin: z.number().nullable(), proposal: z.string().nullable() }),
    })
    .nullable(),
  /** Visual lookalike pairs at or above the stress floor: cosine, text agreement, and whether it became the proposal. */
  stress: z.strictObject({
    siglip2: z.array(z.strictObject({ cos: z.number(), text: z.number(), proposed: z.boolean(), kind: z.enum(LOOKALIKE_KINDS) })),
    dinov2: z.array(z.strictObject({ cos: z.number(), text: z.number() })),
  }),
});
export type ShadowRow = z.infer<typeof ShadowRow>;

/** The decision the shadow log carries must be the cached one: anything else means a run changed a decision. */
export function assertUnchanged(before: Pick<ShadowRow["f0"], "accepted" | "agreeing" | "reason" | "confirmed">, after: ShadowRow["f0"]): void {
  const k = (d: typeof before) => JSON.stringify([d.accepted, d.agreeing, d.reason, d.confirmed]);
  if (k(before) !== k(after)) throw new Error("MM-2: a shadow row's F-0 decision differs from the cached one (shadow mode changes none)");
}

// --- measures over query photos ---------------------------------------------------------------------------------

/** Weighted share of `of` rows that `hit`, a row weighted by its photo's draw count. */
export function shareOf<T extends { photo: number }>(rows: readonly T[], of: (r: T) => boolean, hit: (r: T) => boolean, m: ArrayLike<number>): number | null {
  let w = 0, k = 0;
  for (const r of rows) {
    if (!of(r)) continue;
    const x = m[r.photo]!;
    w += x;
    if (hit(r)) k += x;
  }
  return w > 0 ? k / w : null;
}

/** Weighted count of rows that `hit` (for bootstrapped counts such as new accepts). */
export function countOf<T extends { photo: number }>(rows: readonly T[], hit: (r: T) => boolean, m: ArrayLike<number>): number {
  let k = 0;
  for (const r of rows) if (hit(r)) k += m[r.photo]!;
  return k;
}

/** One stress pair as MM-1's bootstrap sees it: both ends weighted by the query's photo (the gallery is fixed). */
export const stressPairs = (rows: readonly ShadowRow[], model: StressModel): (Pair & { text: number; proposed: boolean })[] =>
  rows.flatMap((r) => r.stress[model].map((p) => ({ s: p.cos, a: r.photo, b: r.photo, text: p.text, proposed: "proposed" in p ? (p as { proposed: boolean }).proposed : false })));

/** F-0 left the box unknown and the candidate simulation accepts it. */
export const newAccept = (r: ShadowRow, arm: "gallery" | "free"): boolean => !r.f0.accepted && !!r[arm]?.simulated.acceptedId;
