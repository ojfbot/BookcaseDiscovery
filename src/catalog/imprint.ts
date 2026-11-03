// Publisher imprints (F-0d): what a spine's publisher mark says, matched against the catalog's edition publishers.
//
//   imprintKey("Tor Books") -> "tor"          one read imprint, normalised
//   publisherKeys("Del Rey / Ballantine")     -> ["del rey", "ballantine"]
//   buildImprintTable(publisherCounts)        -> each publisher string's keys plus the parents ISFDB pairs them with
//   imprintMatches("tor", keys)               -> exact key, or a whole-word prefix of one ("tor" ~ "tor teen")
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
