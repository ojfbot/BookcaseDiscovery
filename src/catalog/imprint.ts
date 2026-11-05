// Publisher imprints (F-0d): what a spine's publisher mark says, matched against the catalog's edition publishers.
//
//   imprintKey("Tor Books") -> "tor"          one read imprint, normalised
//   publisherKeys("Del Rey / Ballantine")     -> ["del rey", "ballantine"]
//   buildImprintTable(publisherCounts)        -> each publisher string's keys plus the parents ISFDB pairs them with
//   imprintMatches("tor", keys)               -> exact key, or a whole-word prefix of one ("tor" ~ "tor teen")
//   editionImprintKeys(table, edition, links) -> (C-9) strict and any keys of one edition: every publisher string,
//                                                its publisher series, dated and undated parents
//   wikidataParents(rows, isfdbName)          -> (C-9) Wikidata P749/P127 parent links, joined to ISFDB by P1239
//   shelfMark("N BEL", surnames)              -> (C-9) "cutter": a library sticker, not a house
//
// ISFDB writes an imprint of a larger house as "Imprint / Publisher" ("Del Rey / Ballantine", "Puffin / Penguin
// Books (US)"), so each " / " segment is a key and the later segments are the earlier one's parents. Book-club and
// distributor segments (SFBC, BOMC, ...) are keys but never parents: a club edition says nothing about the house.
// An imprint is a clue, never identity: nothing here confirms a work, it only says whether a candidate's editions
// carry the publisher a spine shows.
import { normalize, tokenize } from "./normalize.ts";

/** Tokens that name the kind of business, not the business: dropped when something of 3+ letters is left. */
const GENERIC = new Set([
  "books", "book", "press", "publishing", "publishers", "publisher", "publications", "publication", "pub", "pubs",
  "inc", "ltd", "llc", "co", "company", "corp", "corporation", "group", "media", "paperbacks", "paperback",
  "editorial", "ediciones", "edicions", "editions", "edition", "edizioni", "editora", "editores", "verlag",
  "imprint", "logo", "the",
]);

/** Segments that are a club or a distributor's edition, never a parent house. */
const CLUB = /\b(sfbc|bomc|qpbc|bce|book club|science fiction book club|guild|doubleday book and music clubs|quality paperback)\b/;

/**
 * Names the same house goes by that ISFDB does not pair with " / " (public, factual). Keys and values are
 * `imprintKey` forms. Kept short on purpose: a wrong alias would make two houses match.
 */
export const ALIASES: Readonly<Record<string, string>> = {
  "tom doherty associates": "tor",
  "tom doherty": "tor",
  "harper collins": "harpercollins",
  "nal": "new american library",
};

/** One name, normalised: diacritics, case and punctuation as the catalog's `normalize`, generic words dropped. */
export function imprintKey(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = normalize(name.replace(/\([^)]*\)/g, " "));
  const tokens = tokenize(n);
  if (tokens.length === 0) return null;
  const kept = tokens.filter((t) => !GENERIC.has(t));
  const key = kept.join(" ").length >= 3 ? kept.join(" ") : tokens.join(" ");
  return ALIASES[key] ?? key;
}

/** Every " / " segment of an ISFDB publisher string, as keys, in order. */
export function publisherKeys(publisher: string | null | undefined): string[] {
  if (!publisher) return [];
  const out: string[] = [];
  for (const seg of publisher.split(" / ")) {
    const k = imprintKey(seg);
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

const isClub = (key: string): boolean => CLUB.test(key);

/** A parent counts when it has this many editions with the imprint and this share of the imprint's editions. */
export const PARENT = { minEditions: 10, minShare: 0.05 } as const;

export interface ImprintTable {
  /** Distinct publisher strings read, and the keys and parent links they gave. */
  strings: number;
  keys: number;
  /** key -> its parent houses (ISFDB "Imprint / Publisher" pairs that pass `PARENT`). */
  parents: Map<string, Set<string>>;
  /** key -> editions carrying it. */
  editions: Map<string, number>;
}

/** Build the table from (publisher string, edition count) pairs, as `SELECT publisher, count(*) ... GROUP BY publisher`. */
export function buildImprintTable(rows: Iterable<readonly [string, number]>): ImprintTable {
  const editions = new Map<string, number>();
  const pairs = new Map<string, Map<string, number>>();
  let strings = 0;
  for (const [publisher, n] of rows) {
    const keys = publisherKeys(publisher);
    if (keys.length === 0) continue;
    strings++;
    for (const k of keys) editions.set(k, (editions.get(k) ?? 0) + n);
    for (let i = 0; i < keys.length; i++) {
      if (isClub(keys[i]!)) continue;
      for (const p of keys.slice(i + 1)) {
        if (isClub(p)) continue;
        const m = pairs.get(keys[i]!) ?? new Map<string, number>();
        m.set(p, (m.get(p) ?? 0) + n);
        pairs.set(keys[i]!, m);
      }
    }
  }
  const parents = new Map<string, Set<string>>();
  for (const [k, m] of pairs) {
    const total = editions.get(k) ?? 0;
    const ps = [...m].filter(([, n]) => n >= PARENT.minEditions && n >= PARENT.minShare * total).map(([p]) => p);
    if (ps.length > 0) parents.set(k, new Set(ps));
  }
  return { strings, keys: editions.size, parents, editions };
}

/** The keys one edition publisher string matches under: its segments and their parents. */
export function editionKeys(table: ImprintTable, publisher: string | null | undefined): string[] {
  const out = new Set<string>();
  for (const k of publisherKeys(publisher)) {
    out.add(k);
    for (const p of table.parents.get(k) ?? []) out.add(p);
  }
  return [...out];
}

/**
 * Does a read imprint name one of these keys? Exact, or the read key is a whole-word prefix of a key ("tor" ~
 * "tor teen", "penguin" ~ "penguin canada"), which needs 3+ letters so a stray letter matches nothing.
 */
export function imprintMatches(read: string | null, keys: Iterable<string>): boolean {
  if (!read || read.replace(/[^\p{L}\p{N}]/gu, "").length < 3) return false;
  for (const k of keys) if (k === read || k.startsWith(`${read} `)) return true;
  return false;
}

// --- C-9: every publisher string, publisher series, dated parents, shelf marks ------------------------------------

/** One edition's imprint fields as the catalog holds them (schema 3; older files have only `publisher`). */
export interface EditionImprint {
  publisher: string | null;
  /** JSON array of every publisher string (Open Library editions with 2+), or null. */
  publishers?: string | null;
  /** The ISFDB publisher series. */
  pubSeries?: string | null;
  year?: number | null;
}

/**
 * A parent house from Wikidata: the child (an ISFDB publisher, joined by P1239) has `parent` as its parent
 * organisation (P749) or owner (P127). `start`/`end` are the statement's P580/P582 years; a link with neither is
 * undated. Keys are `imprintKey` forms.
 */
export interface ParentLink {
  child: string;
  parent: string;
  start: number | null;
  end: number | null;
}

/** Child key -> its Wikidata parent links. */
export type ParentLinks = ReadonlyMap<string, readonly ParentLink[]>;

const isoYear = (v: string | undefined): number | null => {
  const m = v ? /^(-?\d{1,4})-/.exec(v) : null;
  return m ? Number(m[1]) : null;
};

/** One row of the SPARQL export (`c9-eval.ts wikidata`): string values as the query service returns them. */
export interface WikidataRow {
  isfdb: string;
  itemLabel?: string;
  parentLabel?: string;
  parentIsfdb?: string;
  start?: string;
  end?: string;
}

/**
 * The parent table from the export. Each side's name is ISFDB's publisher name for its P1239 id when ISFDB has it,
 * else the item's English label (a bare Q-id means no label: skipped). Club segments and self-links are dropped,
 * and repeated statements are kept once.
 */
export function wikidataParents(rows: Iterable<WikidataRow>, isfdbName: (id: string) => string | undefined): Map<string, ParentLink[]> {
  const out = new Map<string, ParentLink[]>();
  const named = (label: string | undefined) => (label && !/^Q\d+$/.test(label) ? label : undefined);
  for (const r of rows) {
    const child = imprintKey(isfdbName(r.isfdb) ?? named(r.itemLabel));
    const parent = imprintKey((r.parentIsfdb ? isfdbName(r.parentIsfdb) : undefined) ?? named(r.parentLabel));
    if (!child || !parent || child === parent || isClub(child) || isClub(parent)) continue;
    const link: ParentLink = { child, parent, start: isoYear(r.start), end: isoYear(r.end) };
    const list = out.get(child) ?? [];
    if (!list.some((l) => l.parent === link.parent && l.start === link.start && l.end === link.end)) list.push(link);
    out.set(child, list);
  }
  return out;
}

const dated = (l: ParentLink) => l.start !== null || l.end !== null;
const covers = (l: ParentLink, year: number) => (l.start === null || year >= l.start) && (l.end === null || year <= l.end);

/**
 * The keys one edition matches under (C-9). `strict` is what the edition itself says: every segment of every
 * publisher string, its publisher series, and a dated Wikidata parent whose dates cover the edition's year. `any`
 * adds the undated parents: ISFDB-derived (`table.parents`), undated Wikidata links, and dated links when the edition
 * has no year. IMP-1 withholds only on `strict`; a match through an undated parent counts for the reorder only.
 */
export function editionImprintKeys(table: ImprintTable, ed: EditionImprint, links?: ParentLinks): { strict: Set<string>; any: Set<string> } {
  const direct = new Set<string>();
  const strings = [ed.publisher, ...(ed.publishers ? (JSON.parse(ed.publishers) as string[]) : [])];
  for (const s of strings) for (const k of publisherKeys(s)) direct.add(k);
  const strict = new Set(direct);
  const series = imprintKey(ed.pubSeries);
  if (series && !isClub(series)) strict.add(series);
  const any = new Set(strict);
  for (const k of direct) {
    if (isClub(k)) continue;
    for (const p of table.parents.get(k) ?? []) any.add(p);
    for (const l of links?.get(k) ?? []) {
      if (dated(l) && typeof ed.year === "number") {
        if (covers(l, ed.year)) {
          strict.add(l.parent);
          any.add(l.parent);
        }
      } else any.add(l.parent);
    }
  }
  return { strict, any };
}

/**
 * Is a read imprint a library shelf mark rather than a house (C-9 hygiene, fixed before the run)? `digit`: the read
 * holds a digit (a class number, "821.134"). `cutter`: every word is at most 3 letters and one of them begins a
 * surname of the box's candidate authors (a Cutter mark, "N BEL"). Label-free: the candidates come from the box's
 * own readers, never from an annotation.
 */
export function shelfMark(raw: string | null | undefined, surnames: Iterable<string>): "digit" | "cutter" | null {
  if (!raw) return null;
  if (/\p{Nd}/u.test(raw)) return "digit";
  const words = tokenize(normalize(raw));
  if (words.length === 0 || words.some((w) => w.length > 3)) return null;
  const sn = [...surnames].map((s) => tokenize(normalize(s)).at(-1) ?? "").filter((s) => s.length > 0);
  return words.some((w) => sn.some((s) => s.startsWith(w))) ? "cutter" : null;
}

/** A read key IMP-1 may use: 3+ letters, not a club, not a shelf mark. */
export function usableImprint(key: string | null, raw: string | null, surnames: Iterable<string>): boolean {
  if (!key || key.replace(/[^\p{L}\p{N}]/gu, "").length < 3 || isClub(key)) return false;
  return shelfMark(raw, surnames) === null;
}
