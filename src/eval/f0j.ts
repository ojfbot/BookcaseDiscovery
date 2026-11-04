// F-0j: zone, read per line, emit fields (evals/F0j/report.md, pre-registration; design
// docs/models/per-book-extraction.md §5). The pieces the runner (`f0j-cli.ts`) composes: a reader's line variants,
// the catalog's author name forms behind the zoner's `author` role, and the label-free checks (leave one reader out,
// Wilson bounds). Roles and thresholds are src/perceive/zones.ts's.
import type { DatabaseSync } from "node:sqlite";
import { normalize, tokenize } from "../catalog/normalize.ts";
import type { EdgeProfile, ZoneLine } from "../perceive/zones.ts";
import type { Reading } from "./f0.ts";

/** One region as zone.py measured it (`zones.jsonl`): its reading frame, its lines, contrast and edge profile. */
export interface ZoneRecord {
  id: string;
  frame: { W: number; H: number; rot: number };
  lines: (ZoneLine & { quad: [number, number][]; angle: number; scale: number; page: string; cell: number; rect: [number, number, number, number] })[];
  noise: number;
  contrast: number;
  profile: EdgeProfile;
  seconds: number;
  error?: string;
}

/** One mosaic page of line cells (`zones.jsonl`). */
export interface PageRecord {
  page: string;
  photo: string;
  path: string;
  width: number;
  height: number;
}

/** A line's reading id: its mosaic page and cell. */
export const lineId = (l: { page: string; cell: number }): string => `${l.page}:${l.cell}`;

interface Pick {
  text: string;
  confidence: number;
}

/** A reader's most confident non-empty text of one line, at one rotation or at any. */
export function lineText(r: Reading | undefined, rotation?: number): Pick | null {
  if (!r || r.error) return null;
  let best: Pick | null = null;
  for (const v of r.variants) {
    const text = v.text.replace(/\s+/g, " ").trim();
    if (!text || (rotation !== undefined && v.rotation !== rotation)) continue;
    if (!best || v.confidence > best.confidence) best = { text, confidence: v.confidence };
  }
  return best;
}

/**
 * The three pre-registered line variants of one reader on one region (`order`: line ids in reading order): every line
 * at 0° in reading order, every line at 180° in reverse order, every line at its own most confident rotation.
 */
export function lineVariants(order: readonly string[], read: (id: string) => Reading | undefined): string[] {
  const join = (ids: readonly string[], at: (id: string) => Pick | null) =>
    ids.map(at).filter((p): p is Pick => p !== null).map((p) => p.text).join(" ").trim();
  const out = [join(order, (id) => lineText(read(id), 0)), join([...order].reverse(), (id) => lineText(read(id), 180)), join(order, (id) => lineText(read(id)))];
  return [...new Set(out.filter((t) => t.length >= 2))];
}

/** A reader's whole-crop reading with its line variants appended: one reading, one retrieval, one vote (INV-6). */
export function withLines(whole: Reading | undefined, variants: readonly string[], reader: Reading["reader"], id: string): Reading | undefined {
  if (variants.length === 0) return whole;
  const base: Reading = whole && !whole.error ? whole : { id, reader, variants: [], seconds: 0 };
  return { ...base, variants: [...base.variants, ...variants.map((text) => ({ rotation: 0, text, confidence: 0 }))] };
}

// --- the catalog's author name forms (the zoner's `author` role) ------------------------------------------

export interface AuthorIndex {
  /** Normalised author forms, given-first and surname-first. */
  forms: Set<string>;
  /** Works per author surname (last token of a given-first form). */
  surname: Map<string, number>;
  /** Works with the word in one of their title forms. */
  titleWord: Map<string, number>;
}

/** Built from the set's own catalog (`works.author_norm`, `works.title_norm`). */
export function authorIndex(db: DatabaseSync): AuthorIndex {
  const forms = new Set<string>();
  const surname = new Map<string, number>();
  const titleWord = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const row of db.prepare("SELECT author_norm, title_norm FROM works").iterate() as Iterable<{ author_norm: string; title_norm: string }>) {
    const sur = new Set<string>();
    for (const f of row.author_norm.split("|")) {
      const t = tokenize(f.trim());
      if (t.length === 0) continue;
      forms.add(t.join(" "));
      if (t.length > 1) forms.add([t[t.length - 1]!, ...t.slice(0, -1)].join(" "));
      sur.add(t[t.length - 1]!);
    }
    for (const s of sur) bump(surname, s);
    const words = new Set<string>();
    for (const f of row.title_norm.split("|")) for (const w of tokenize(f.replace(/^[A-Z]:/, "").trim())) words.add(w);
    for (const w of words) bump(titleWord, w);
  }
  return { forms, surname, titleWord };
}

/**
 * Does this text read as an author's name (pre-registered)? A run of two or three of its tokens is a catalog author
 * form, or it has at most three tokens and its last is a catalog surname held on at least half as many works as an
 * author surname as works carry it in a title.
 */
export function isAuthorText(ix: AuthorIndex, text: string): boolean {
  const t = tokenize(normalize(text));
  for (const n of [2, 3]) for (let i = 0; i + n <= t.length; i++) if (ix.forms.has(t.slice(i, i + n).join(" "))) return true;
  if (t.length === 0 || t.length > 3) return false;
  const last = t[t.length - 1]!;
  if (last.length < 2 || !/\p{L}/u.test(last)) return false;
  const s = ix.surname.get(last) ?? 0;
  return s >= 1 && s >= 0.5 * (ix.titleWord.get(last) ?? 0);
}

// --- label-free checks -----------------------------------------------------------------------------------

/** Wilson score interval upper bound for k of n (95 %). */
export function wilsonUpper(k: number, n: number, z = 1.96): number | null {
  if (n === 0) return null;
  const p = k / n;
  const d = 1 + (z * z) / n;
  return (p + (z * z) / (2 * n) + z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
}

/** What one accept becomes when one reader is dropped and the box is re-decided. */
export type LoroOutcome = "same" | "other" | "none";

/** Leave one reader out over a set's accepts: (accept, dropped reader) cases by outcome; rule 4 reads `other`. */
export function loroSummary(cases: readonly LoroOutcome[]) {
  const n = cases.length;
  const count = (o: LoroOutcome) => cases.filter((c) => c === o).length;
  const other = count("other");
  return { cases: n, same: count("same"), other, none: count("none"), otherShare: n ? other / n : null, otherWilsonUpper: wilsonUpper(other, n) };
}
