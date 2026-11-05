// KN-3 shelf signals: what a shop's own shelving says about its confirmed books, as features `recommend` may read.
// Three signals, from **confirmed** books only (TS-0's shipped bases), shared book knowledge and never taste:
//   - co-shelving: which works the shop puts together, same row first, then the same case, weighted by distance;
//   - section terms: a row's SC-1 sign (through KN-1's `SECTION_GENRES`) and its confirmed members' section mix
//     (KN-2's `buildMix`), as genre and form terms;
//   - out-of-place: a confirmed work whose genre or form differs from the rest of its row (KN-2's stress-test rule).
//     A discovery signal: it is surfaced, never a penalty.
// One way (INV-13): this file reads catalog and identify outputs; nothing under identify, perceive or catalog may
// import it (test/shelf-signals.test.ts). It never reads the profile, seeds, vocabulary or a lens; those may only
// consume its output, inside recommend. No popularity: no edition count, rating or year, and a work's neighbours keep
// their maximum weight over its sightings, never a sum, so a work seen often is not raised over one seen once.
// The switch defaults to `off`; promotion is the owner's ruling (evals/KN3). Constants are pre-registered in
// evals/KN3/prereg.md and never tuned. Pure functions; the runner is src/eval/kn3-cli.ts.
import { SECTION_GENRES, type SectionFamily } from "../catalog/work-features.ts";
import { buildMix, majorityForm, PRIOR, type FeatureLookup, type SectionMix, type SectionSign, type WorkFeatureTerms } from "../identify/section-prior.ts";

// --- the switch ----------------------------------------------------------------------------------------------

/**
 * `off`: no signal is built. `shadow`: signals are built and logged; nothing ranks on them. `on`: the features
 * reach recommend's ranking (an owner ruling, after the verdicts in evals/KN3).
 */
export const SHELF_SIGNAL_MODES = ["off", "shadow", "on"] as const;
export type ShelfSignalMode = (typeof SHELF_SIGNAL_MODES)[number];
export const SHELF_SIGNAL_DEFAULT: ShelfSignalMode = "off";

export function parseShelfSignalMode(s: string | undefined): ShelfSignalMode {
  if (s === undefined) return SHELF_SIGNAL_DEFAULT;
  if (!(SHELF_SIGNAL_MODES as readonly string[]).includes(s)) throw new Error(`shelf signals: unknown mode "${s}" (${SHELF_SIGNAL_MODES.join(" | ")})`);
  return s as ShelfSignalMode;
}

// --- constants (pre-registered) ------------------------------------------------------------------------------

export const SHELF = {
  /** A case pair (same photo, another row) weighs this over its bands' distance; a row pair weighs 1 / positions. */
  caseWeight: 0.25,
  /** SC-1's sign gives section terms when its record's confidence is at least this (KN-2's floor). */
  signMinConfidence: PRIOR.signMinConfidence,
} as const;

// --- inputs --------------------------------------------------------------------------------------------------

/** One F-0h row: its key, its case (a photo, on `pilot-000`), its band and its book boxes left to right. */
export interface ShelfRow {
  key: string;
  caseKey: string;
  band: number;
  members: readonly string[];
}

/** A confirmed box: its work and the basis that confirmed it (TS-0's `readers-agree`, copy or context). */
export interface ConfirmedBox {
  workId: string;
  basis: string;
}

export interface ShelfInput {
  rows: readonly ShelfRow[];
  /** Box id to confirmed work. A box absent here is unconfirmed and carries no signal. */
  confirmed: ReadonlyMap<string, ConfirmedBox>;
  /** KN-1's shared book knowledge per work (null: nothing known). */
  features: FeatureLookup;
  /** SC-1's sign per row key, where one was read. */
  signs: ReadonlyMap<string, SectionSign>;
}

/** One confirmed box standing in a row. */
export interface Sighting {
  boxId: string;
  workId: string;
  basis: string;
  rowKey: string;
  caseKey: string;
  band: number;
  /** Index among the row's book boxes, confirmed or not, so distance is physical. */
  position: number;
}

export function sightingsOf(rows: readonly ShelfRow[], confirmed: ReadonlyMap<string, ConfirmedBox>): Sighting[] {
  const out: Sighting[] = [];
  for (const r of rows)
    r.members.forEach((boxId, position) => {
      const c = confirmed.get(boxId);
      if (c) out.push({ boxId, workId: c.workId, basis: c.basis, rowKey: r.key, caseKey: r.caseKey, band: r.band, position });
    });
  return out;
}

// --- 1. co-shelving --------------------------------------------------------------------------------------------

export type ShelfScope = "row" | "case";

/** Two sightings' co-shelving weight and scope: 1 / d in one row, `caseWeight` / bands apart in one case, else none. */
export function pairWeight(a: Sighting, b: Sighting): { weight: number; scope: ShelfScope } | null {
  if (a.workId === b.workId || a.caseKey !== b.caseKey) return null;
  if (a.rowKey === b.rowKey) return { weight: 1 / Math.max(1, Math.abs(a.position - b.position)), scope: "row" };
  return { weight: SHELF.caseWeight / Math.max(1, Math.abs(a.band - b.band)), scope: "case" };
}

export interface Neighbour {
  workId: string;
  weight: number;
  scope: ShelfScope;
}

/**
 * Each work's co-shelving neighbours: every other work it shares a case with, at the maximum weight over its sightings
 * (never a sum), scope `row` when any row sighting gave it. Sorted by weight, then work id.
 */
export function coShelving(sightings: readonly Sighting[]): Map<string, Neighbour[]> {
  const best = new Map<string, Map<string, Neighbour>>();
  const byCase = new Map<string, Sighting[]>();
  for (const s of sightings) byCase.set(s.caseKey, [...(byCase.get(s.caseKey) ?? []), s]);
  const note = (from: string, to: string, w: { weight: number; scope: ShelfScope }) => {
    const m = best.get(from) ?? new Map<string, Neighbour>();
    best.set(from, m);
    const old = m.get(to);
    const scope: ShelfScope = old?.scope === "row" || w.scope === "row" ? "row" : "case";
    m.set(to, { workId: to, weight: Math.max(old?.weight ?? 0, w.weight), scope });
  };
  for (const ss of byCase.values())
    for (let i = 0; i < ss.length; i++)
      for (let j = i + 1; j < ss.length; j++) {
        const w = pairWeight(ss[i]!, ss[j]!);
        if (!w) continue;
        note(ss[i]!.workId, ss[j]!.workId, w);
        note(ss[j]!.workId, ss[i]!.workId, w);
      }
  const r4 = (x: number) => Math.round(x * 10000) / 10000;
  return new Map(
    [...best].map(([w, m]) => [w, [...m.values()].map((n) => ({ ...n, weight: r4(n.weight) })).sort((a, b) => b.weight - a.weight || (a.workId < b.workId ? -1 : 1))]),
  );
}

// --- 2. section terms ------------------------------------------------------------------------------------------

/** SC-1's sign as section terms: its `SECTION_GENRES` families as genre terms, its canons as form terms. */
export interface SignTerms {
  family: string;
  confidence: number;
  genre: readonly string[];
  form: readonly string[];
}

/** A sign's terms, or null when it is too weak or its family maps to nothing (young-adult, classics). */
export function signTermsOf(sign: SectionSign | null | undefined): SignTerms | null {
  if (!sign || sign.confidence < SHELF.signMinConfidence) return null;
  const want = SECTION_GENRES[sign.family as SectionFamily];
  if (!want || (want.families.length === 0 && want.canons.length === 0)) return null;
  return { family: sign.family, confidence: sign.confidence, genre: want.families, form: want.canons };
}

/** KN-2's sign mapping for the mix: genre families only (as `signTerms` in section-prior-cli.ts). */
const mixSignTerms = (family: string): readonly string[] => SECTION_GENRES[family as SectionFamily]?.families ?? [];

export interface RowSection {
  rowKey: string;
  sign: SignTerms | null;
  /** KN-2's section mix of the row's confirmed members, sign included as KN-2 weighs it. */
  mix: SectionMix | null;
}

const featuresOf = (ids: readonly string[], confirmed: ReadonlyMap<string, ConfirmedBox>, features: FeatureLookup): (WorkFeatureTerms | null)[] =>
  ids.filter((id) => confirmed.has(id)).map((id) => features(confirmed.get(id)!.workId));

export function rowSection(row: ShelfRow, input: Pick<ShelfInput, "confirmed" | "features" | "signs">): RowSection {
  const sign = input.signs.get(row.key) ?? null;
  return { rowKey: row.key, sign: signTermsOf(sign), mix: buildMix(featuresOf(row.members, input.confirmed, input.features), sign, mixSignTerms) };
}

// --- 3. out of place (discovery) --------------------------------------------------------------------------------

/** One confirmed row member against the rest of its row. `null`: not determinable on that facet. */
export interface PlaceCheck {
  boxId: string;
  workId: string;
  rowKey: string;
  genre: boolean | null;
  form: boolean | null;
}

/**
 * KN-2's stress-test rule, each confirmed member left out of its own row: **form** out of place when its form differs
 * from the others' `majorityForm`; **genre** out of place when the others' mix knows the genre facet and none of the
 * member's genres is in it. Both need both sides known; a missing term is never evidence.
 */
export function placeChecks(row: ShelfRow, input: Pick<ShelfInput, "confirmed" | "features" | "signs">): PlaceCheck[] {
  const sign = input.signs.get(row.key) ?? null;
  const out: PlaceCheck[] = [];
  for (const id of row.members) {
    const c = input.confirmed.get(id);
    if (!c) continue;
    const own = input.features(c.workId);
    const others = featuresOf(
      row.members.filter((x) => x !== id),
      input.confirmed,
      input.features,
    );
    const maj = majorityForm(others);
    const mix = buildMix(others, sign, mixSignTerms);
    const form = own?.form != null && maj !== null ? own.form !== maj : null;
    const genre = mix !== null && mix.weight.genre > 0 && own !== null && own.genre.length > 0 ? own.genre.every((g) => !mix.shares.genre[g]) : null;
    out.push({ boxId: id, workId: c.workId, rowKey: row.key, genre, form });
  }
  return out;
}

export const isOutOfPlace = (p: Pick<PlaceCheck, "genre" | "form">): boolean => p.genre === true || p.form === true;

// --- all three, under the switch ---------------------------------------------------------------------------------

export interface ShelfSignals {
  sightings: Sighting[];
  coShelved: Map<string, Neighbour[]>;
  sections: Map<string, RowSection>;
  places: PlaceCheck[];
}

/** The three signals for a set of rows, or null under `off`. */
export function shelfSignals(mode: ShelfSignalMode, input: ShelfInput): ShelfSignals | null {
  if (mode === "off") return null;
  const sightings = sightingsOf(input.rows, input.confirmed);
  return {
    sightings,
    coShelved: coShelving(sightings),
    sections: new Map(input.rows.map((r) => [r.key, rowSection(r, input)])),
    places: input.rows.flatMap((r) => placeChecks(r, input)),
  };
}

/** What recommend reads for one work: shared book knowledge about where the shop shelves it. Never a penalty. */
export interface WorkShelfFeatures {
  workId: string;
  neighbours: Neighbour[];
  sections: { rowKey: string; sign: SignTerms | null; genre: Record<string, number>; form: Record<string, number> }[];
  outOfPlace: { rowKey: string; facets: ("genre" | "form")[] }[];
  /** True when the work stands out from a row it is shelved in: a reason to surface it, never to lower it. */
  discovery: boolean;
}

export function workShelfFeatures(s: ShelfSignals, workId: string): WorkShelfFeatures {
  const rows = [...new Set(s.sightings.filter((x) => x.workId === workId).map((x) => x.rowKey))].sort();
  const outOfPlace = s.places
    .filter((p) => p.workId === workId && isOutOfPlace(p))
    .map((p) => ({ rowKey: p.rowKey, facets: (["genre", "form"] as const).filter((f) => p[f] === true) }));
  return {
    workId,
    neighbours: s.coShelved.get(workId) ?? [],
    sections: rows.map((k) => {
      const r = s.sections.get(k);
      return { rowKey: k, sign: r?.sign ?? null, genre: { ...(r?.mix?.shares.genre ?? {}) }, form: { ...(r?.mix?.shares.form ?? {}) } };
    }),
    outOfPlace,
    discovery: outOfPlace.length > 0,
  };
}

/** The features recommend's ranking may read under a mode: none unless `on`. `shadow` builds and logs only. */
export function featuresUnder(mode: ShelfSignalMode, s: ShelfSignals | null, workId: string): WorkShelfFeatures | null {
  return mode === "on" && s ? workShelfFeatures(s, workId) : null;
}
