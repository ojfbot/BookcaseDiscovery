// F-0j: zone, read per line, emit fields (evals/F0j/report.md, pre-registration; design
// docs/models/per-book-extraction.md §5). The pieces the runner (`f0j-cli.ts`) composes: a reader's line variants,
// the catalog's author name forms behind the zoner's `author` role, and the label-free checks (leave one reader out,
// Wilson bounds). Roles and thresholds are src/perceive/zones.ts's.
import type { DatabaseSync } from "node:sqlite";
import { sameBook } from "../catalog/lookalike.ts";
import { normalize, tokenize } from "../catalog/normalize.ts";
import { scoreWorks, type Candidate } from "../catalog/retrieve.ts";
import type { EdgeProfile, ZoneLine } from "../perceive/zones.ts";
import { ACCEPT, confirms, type Reading } from "./f0.ts";

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

/** Rotation choice for a reader's line texts: 0°, 180°, or each line's most confident. */
export type LineRotation = 0 | 180 | "best";

/** A reader's text of some lines (`ids` in reading order), at one rotation choice; 180° reads them in reverse. */
export function linesText(ids: readonly string[], read: (id: string) => Reading | undefined, rot: LineRotation): string {
  const order = rot === 180 ? [...ids].reverse() : ids;
  return order
    .map((id) => lineText(read(id), rot === "best" ? undefined : rot))
    .filter((p): p is Pick => p !== null)
    .map((p) => p.text)
    .join(" ")
    .trim();
}

/**
 * The three pre-registered line variants of one reader on one region (`order`: line ids in reading order): every line
 * at 0° in reading order, every line at 180° in reverse order, every line at its own most confident rotation.
 */
export function lineVariants(order: readonly string[], read: (id: string) => Reading | undefined): string[] {
  const out = ([0, 180, "best"] as const).map((r) => linesText(order, read, r));
  return [...new Set(out.filter((t) => t.length >= 2))];
}

/** Which rotation choice a reader's nomination won with: the variant its top candidate came from, else "best". */
export function wonWith(order: readonly string[], read: (id: string) => Reading | undefined, winner: string | undefined): LineRotation {
  if (winner === undefined) return "best";
  const w = winner.replace(/\s+/g, " ").trim();
  if (w === linesText(order, read, 0)) return 0;
  if (w === linesText(order, read, 180)) return 180;
  return "best";
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

// --- fields (arms B and C) --------------------------------------------------------------------------------

/** A reader's fields: its text of the title group's and the author group's lines (null when there is none). */
export interface Fields {
  title: string | null;
  author: string | null;
}

/** The pre-registered field rule's constants: F-0's bar applied to the field text, and C-7's author threshold. */
export const FIELD = { minScore: ACCEPT.minScore, minTitle: ACCEPT.minTitleEvidence, minCoverage: ACCEPT.minCoverage, author: 0.5 } as const;

const evidence = (c: Candidate | undefined, f: "title" | "author"): number => c?.evidence.find((e) => e.field === f)?.score ?? 0;

/** One reader's confirmation under the field rule, and how it got (or lost) it. */
export interface FieldVote {
  work: string | null;
  path: "whole" | "field" | null;
  /** The author field withdrew a confirmation (another book's author was read). */
  counter: boolean;
}

/**
 * Arm B's rule for one reader (pre-registered): the whole-string path first (F-0's bar on its top candidate); else the
 * candidate with the best score on the fields alone, if it passes F-0's bar on the fields and no other book ties it;
 * then the author field withdraws a confirmation whose work's authors explain it below 0.5 while another book in the
 * reader's ranked candidates explains it at 0.5 or more.
 */
export function fieldVote(db: DatabaseSync, ranked: readonly Candidate[], fields: Fields | null): FieldVote {
  let work: Candidate | null = null;
  let path: FieldVote["path"] = null;
  if (confirms(ranked[0])) (work = ranked[0]!), (path = "whole");
  else if (fields?.title && ranked.length) {
    const text = [fields.title, fields.author ?? ""].join(" ").trim();
    const scored = [...scoreWorks(db, [text], ranked.map((c) => c.workId)).values()].sort((a, b) => b.score - a.score);
    const best = scored[0];
    const tie = best && scored.some((c) => c !== best && !sameBook(best, c) && Math.round(c.score * 100) === Math.round(best.score * 100));
    if (best && !tie && best.score >= FIELD.minScore && evidence(best, "title") >= FIELD.minTitle && best.queryCoverage >= FIELD.minCoverage)
      (work = ranked.find((c) => c.workId === best.workId)!), (path = "field");
  }
  if (!work || !fields?.author) return { work: work?.workId ?? null, path, counter: false };
  const byAuthor = scoreWorks(db, [fields.author], ranked.map((c) => c.workId));
  const own = evidence(byAuthor.get(work.workId), "author");
  const rival = ranked.some((c) => !sameBook(work!, c) && evidence(byAuthor.get(c.workId), "author") >= FIELD.author);
  if (own < FIELD.author && rival) return { work: null, path, counter: true };
  return { work: work.workId, path, counter: false };
}

/** Does a field's text match a work (title evidence at F-0's bar, author evidence at 0.5)? Reported, not a rule. */
export function fieldMatches(db: DatabaseSync, workId: string, f: Fields): { title: boolean | null; author: boolean | null } {
  const one = (text: string | null, field: "title" | "author", bar: number) => (text ? evidence(scoreWorks(db, [text], [workId]).get(workId), field) >= bar : null);
  return { title: one(f.title, "title", FIELD.minTitle), author: one(f.author, "author", FIELD.author) };
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
