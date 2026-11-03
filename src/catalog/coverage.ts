// Catalog coverage on machine reads (card C-4).
//
//   drawSample -> resolveBox (Open Library search, then LoC SRU) -> isfdbHolds -> estimateCoverage
//
// The question: of the spines whose book is readable, what share does ISFDB hold? No hand labels exist
// (OC36), so a box counts as **readable** when an outside catalog resolves its cached reader text to one
// book: a record whose normalised title is in a reader's text and whose author surname is in some
// reader's text (`RESOLVE`). The resolved record's ISBNs, then its clean title and author, are looked up
// in ISFDB. This adapts docs/catalog/backend-options.md §5, which assumed labelled spines.
//
// Live calls are rate-limited and every response is cached under the data root's `catalog/coverage/`, so
// a rerun makes no calls. Everything per box (reader text, queries, records) is private; only the
// aggregates from `estimateCoverage` leave through the CLI. Method and results: evals/C4/report.md.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { ReaderName, Reading, SpineDecision } from "../eval/f0.ts";
import { quantile, rng } from "../eval/q1.ts";
import { toIsbn13 } from "./isbn.ts";
import { confusableReadings, editDistance, normalize, skeleton, splitSubtitle, STOPWORDS, surnameFirstToGivenFirst, tokenize, tokensWithInitials } from "./normalize.ts";
import { retrieve } from "./retrieve.ts";

// ---------------------------------------------------------------------------------------------
// Pre-registered constants (evals/C4/report.md § Method). Changing one after the full run is a new run.
// ---------------------------------------------------------------------------------------------

/** F-0 outcomes that are sampled. `no-text` is a perception gap, not a catalog gap, and is left out. */
export const STRATA = ["no-catalog-match", "single-reader", "readers-disagree", "confirmed"] as const;
export type Stratum = (typeof STRATA)[number];

/** Boxes drawn per stratum for the measured sample. */
export const SAMPLE: Record<Stratum, number> = { "no-catalog-match": 120, "single-reader": 60, "readers-disagree": 15, confirmed: 40 };
/** Confirmed boxes drawn first, disjoint from the sample: the only rows the thresholds may be tuned on. */
export const TUNING_CONFIRMED = 20;
export const SEED = 20261103;
export const BOOTSTRAP_REPS = 10000;

export const LIMITS = {
  /** Records read from each response. */
  records: 10,
  /** Queries per box, per source. A box stops at its first resolving record. */
  olQueriesPerBox: 8,
  locQueriesPerBox: 2,
  /** Keyword tokens taken from one reading. */
  keywordTokens: 10,
  /** Record authors whose surnames are tried. */
  recordAuthors: 3,
} as const;

/** The resolution rule: when an outside record is the book the readers read. */
export const RESOLVE = {
  /** The record's main title must have at least this many letters and digits outside stopwords. */
  minTitleChars: 4,
  /** Titles with up to this many content tokens need every token in one reader's text... */
  allTokensUpTo: 3,
  /** ...longer titles need this share of them. */
  longTitleShare: 0.8,
  /**
   * A truncated title also matches (backend-options §5: the label's title a prefix of the record's): the
   * record's first k content tokens are in the reading, k is at least this share of them, and those
   * tokens hold at least `prefixMinChars` letters.
   */
  prefixShare: 0.5,
  prefixMinChars: 6,
  /** Tokens shorter than this match exactly (or by skeleton, or 0/O-style readings) only. */
  fuzzyMinLength: 5,
  /** A surname shorter than this must match exactly. */
  minFuzzySurname: 3,
} as const;

/** Subjects that mark a record as speculative fiction, for the rough SF / non-SF split. Noisy by design. */
export const SF_SUBJECT =
  /science fiction|science-fiction|ciencia ficci|fantasy|fantastic fiction|speculative|horror|dystopia|utopia|cyberpunk|steampunk|space opera|time travel|extraterrestrial|alien|dragons|wizards|magic|vampire|zombie|apocalyp|robots|interplanetary|life on other planets|supernatural/i;

// ---------------------------------------------------------------------------------------------
// Sample
// ---------------------------------------------------------------------------------------------

export function stratumOf(d: Pick<SpineDecision, "accepted" | "reason">): Stratum | null {
  if (d.accepted) return "confirmed";
  if (d.reason === null || d.reason === "no-text") return null;
  return d.reason;
}

export interface SampledBox {
  id: string;
  stratum: Stratum;
  role: "tuning" | "sample";
}

/**
 * Seeded, stratified draw without replacement. Ids are sorted before the shuffle, so the draw depends on
 * the seed and the set of boxes only, never on file order.
 */
export function drawSample(
  decisions: Pick<SpineDecision, "id" | "accepted" | "reason">[],
  seed = SEED,
  sizes: Record<Stratum, number> = SAMPLE,
  tuning = TUNING_CONFIRMED,
): { boxes: SampledBox[]; population: Record<Stratum, number> } {
  const byStratum = new Map<Stratum, string[]>(STRATA.map((s) => [s, []]));
  for (const d of decisions) {
    const s = stratumOf(d);
    if (s) byStratum.get(s)!.push(d.id);
  }
  const population = Object.fromEntries(STRATA.map((s) => [s, byStratum.get(s)!.length])) as Record<Stratum, number>;
  const boxes: SampledBox[] = [];
  STRATA.forEach((s, i) => {
    const ids = [...byStratum.get(s)!].sort();
    const rand = rng(seed + i);
    for (let j = ids.length - 1; j > 0; j--) {
      const k = Math.floor(rand() * (j + 1));
      [ids[j], ids[k]] = [ids[k]!, ids[j]!];
    }
    const t = s === "confirmed" ? Math.min(tuning, ids.length) : 0;
    for (const id of ids.slice(0, t)) boxes.push({ id, stratum: s, role: "tuning" });
    for (const id of ids.slice(t, t + sizes[s])) boxes.push({ id, stratum: s, role: "sample" });
  });
  return { boxes, population };
}

// ---------------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------------

export interface ReaderText {
  reader: ReaderName;
  text: string;
}

/** Every distinct reading of a box, Qwen first (it was asked for title then author), then by confidence. */
export function readerTexts(reads: Partial<Record<ReaderName, Reading>>): ReaderText[] {
  const out: ReaderText[] = [];
  const seen = new Set<string>();
  for (const reader of ["qwen", "vision", "ppocr"] as ReaderName[]) {
    const r = reads[reader];
    if (!r || r.error) continue;
    for (const v of [...r.variants].sort((a, b) => b.confidence - a.confidence)) {
      const key = normalize(v.text);
      if (key.length < 2 || seen.has(key)) continue;
      seen.add(key);
      out.push({ reader, text: v.text.trim() });
    }
  }
  return out;
}

/** Qwen's answer is "title first, then author, one per line" (helpers/label/read.py). */
export function qwenFields(text: string): { title: string; author: string | null } {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter((l) => normalize(l) !== "");
  return { title: lines[0] ?? "", author: lines[1] ?? null };
}

/** Tokens worth sending to a live search: three or more characters, a letter in them, no stopwords. */
export function keywordTokens(text: string): string[] {
  const toks = tokenize(normalize(text)).filter((t) => t.length >= 3 && /\p{L}/u.test(t) && !STOPWORDS.has(t));
  return [...new Set(toks)].slice(0, LIMITS.keywordTokens);
}

export type Source = "openlibrary" | "loc";

export interface LiveQuery {
  source: Source;
  /** `fielded`: Qwen's title and author lines; `line`: one text line's tokens; `keywords`: a reading's tokens joined with OR. */
  kind: "fielded" | "line" | "keywords";
  reader: ReaderName;
  url: string;
}

const OL_SEARCH = "https://openlibrary.org/search.json";
const OL_FIELDS = "key,title,subtitle,author_name,isbn,subject,first_publish_year";
// The LoC SRU endpoint named in backend-options §1a. It answers on plain HTTP; HTTPS on port 210 timed out.
const LOC_SRU = "http://lx2.loc.gov:210/LCDB";

const olUrl = (params: Record<string, string>) =>
  `${OL_SEARCH}?${new URLSearchParams({ ...params, fields: OL_FIELDS, limit: String(LIMITS.records) }).toString()}`;
const locUrl = (cql: string) =>
  `${LOC_SRU}?${new URLSearchParams({ version: "1.1", operation: "searchRetrieve", query: cql, maximumRecords: String(LIMITS.records), recordSchema: "mods" }).toString()}`;

/**
 * The searches for one box, in the order they are tried: Qwen's title and author lines as fields; then
 * each text line of each reading on its own (a spine prints title and author as separate lines, and
 * both search engines AND plain terms, so a garbled line elsewhere cannot empty the result); then each
 * whole reading's tokens joined with OR, so relevance ranking can surface the book through misreads.
 * The search only proposes records; the resolution rule decides.
 */
export function liveQueries(texts: ReaderText[], source: Source): LiveQuery[] {
  const out: LiveQuery[] = [];
  const push = (q: LiveQuery) => {
    if (!out.some((o) => o.url === q.url)) out.push(q);
  };
  const and = (kw: string[]) => (source === "openlibrary" ? olUrl({ q: kw.join(" ") }) : locUrl(kw.join(" ")));
  for (const t of texts) {
    if (t.reader !== "qwen") continue;
    const f = qwenFields(t.text);
    const title = keywordTokens(f.title);
    const author = f.author ? keywordTokens(f.author) : [];
    if (title.length > 0 && author.length > 0) {
      const url = source === "openlibrary"
        ? olUrl({ title: title.join(" "), author: author.join(" ") })
        : locUrl(`dc.title="${title.join(" ")}" and dc.creator="${author.join(" ")}"`);
      push({ source, kind: "fielded", reader: t.reader, url });
    }
  }
  for (const t of texts) {
    for (const line of t.text.split(/\n+/)) {
      const kw = keywordTokens(line);
      if (kw.join("").length >= 4) push({ source, kind: "line", reader: t.reader, url: and(kw) });
    }
  }
  for (const t of texts) {
    const kw = keywordTokens(t.text);
    if (kw.length >= 2) push({ source, kind: "keywords", reader: t.reader, url: source === "openlibrary" ? olUrl({ q: kw.join(" OR ") }) : locUrl(kw.join(" or ")) });
  }
  return out.slice(0, source === "openlibrary" ? LIMITS.olQueriesPerBox : LIMITS.locQueriesPerBox);
}

/** One query for a clean title and author: is this book in that source at all? */
export function cleanQuery(source: Source, title: string, author: string): string {
  const t = keywordTokens(title).join(" ");
  const a = keywordTokens(author).join(" ");
  return source === "openlibrary" ? olUrl({ title: t, author: a }) : locUrl(`dc.title="${t}" and dc.creator="${a}"`);
}

// ---------------------------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------------------------

export interface OutsideRecord {
  source: Source;
  id: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  isbns: string[];
  subjects: string[];
  year: number | null;
}

export function parseOpenLibrary(body: string): OutsideRecord[] {
  const j = JSON.parse(body) as { docs?: Array<Record<string, unknown>> };
  return (j.docs ?? []).map((d) => ({
    source: "openlibrary" as const,
    id: String(d.key ?? ""),
    title: String(d.title ?? ""),
    subtitle: typeof d.subtitle === "string" ? d.subtitle : null,
    authors: Array.isArray(d.author_name) ? d.author_name.map(String) : [],
    isbns: Array.isArray(d.isbn) ? d.isbn.map(String) : [],
    subjects: Array.isArray(d.subject) ? d.subject.map(String) : [],
    year: typeof d.first_publish_year === "number" ? d.first_publish_year : null,
  }));
}

function xmlText(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_m, n: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[n]!)
    .trim();
}

const all = (xml: string, re: RegExp) => [...xml.matchAll(re)].map((m) => m[1] ?? "");

/** LoC SRU MODS records. A small, tolerant reader of the fields used here, not a MODS parser. */
export function parseMods(xml: string): OutsideRecord[] {
  return all(xml, /<mods\b[^>]*>([\s\S]*?)<\/mods>/g).map((m, i) => {
    // The first titleInfo that is not an alternative, abbreviated, translated or uniform title.
    const titleInfo = [...m.matchAll(/<titleInfo\b([^>]*)>([\s\S]*?)<\/titleInfo>/g)].find((t) => !/\btype=/.test(t[1]!))?.[2] ?? "";
    const nonSort = xmlText(all(titleInfo, /<nonSort\b[^>]*>([\s\S]*?)<\/nonSort>/g)[0] ?? "");
    const title = `${nonSort ? `${nonSort} ` : ""}${xmlText(all(titleInfo, /<title\b[^>]*>([\s\S]*?)<\/title>/g)[0] ?? "")}`.replace(/[\s/:;,.]+$/, "");
    const subtitle = xmlText(all(titleInfo, /<subTitle\b[^>]*>([\s\S]*?)<\/subTitle>/g)[0] ?? "").replace(/[\s/:;,.]+$/, "") || null;
    const names = [...m.matchAll(/<name\b([^>]*)>([\s\S]*?)<\/name>/g)]
      .filter((n) => /type="personal"/.test(n[1]!))
      .sort((a, b) => Number(/usage="primary"/.test(b[1]!)) - Number(/usage="primary"/.test(a[1]!)))
      .map((n) => [...n[2]!.matchAll(/<namePart(?![^>]*type="(?:date|termsOfAddress)")[^>]*>([\s\S]*?)<\/namePart>/g)].map((p) => xmlText(p[1]!)).join(" "))
      .map((n) => n.replace(/[\s,.]+$/, ""))
      .filter((n) => n !== "");
    const isbns = all(m, /<identifier type="isbn"[^>]*>([\s\S]*?)<\/identifier>/g).map((s) => xmlText(s).split(/\s/)[0]!).filter(Boolean);
    const subjects = [
      ...all(m, /<topic[^>]*>([\s\S]*?)<\/topic>/g),
      ...all(m, /<genre[^>]*>([\s\S]*?)<\/genre>/g),
    ].map((s) => xmlText(s).replace(/[\s.]+$/, ""));
    const id = xmlText(all(m, /<recordIdentifier[^>]*>([\s\S]*?)<\/recordIdentifier>/g)[0] ?? "") || xmlText(all(m, /<identifier type="lccn"[^>]*>([\s\S]*?)<\/identifier>/g)[0] ?? "") || `loc#${i}`;
    const year = Number((all(m, /<dateIssued[^>]*>([\s\S]*?)<\/dateIssued>/g).join(" ").match(/\d{4}/) ?? [])[0]) || null;
    return { source: "loc" as const, id, title, subtitle, authors: names, isbns, subjects, year };
  });
}

// ---------------------------------------------------------------------------------------------
// Resolution rule
// ---------------------------------------------------------------------------------------------

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "phd", "md"]);
/** Words that mark an author as an organisation, whose last word is no surname. */
const ORGANISATION =
  /\b(collection|foundation|fundacion|society|association|institute|university|library|press|publishing|publishers|inc|ltd|company|corporation|council|committee|department|staff|editors|museum|nursery|gardens|group|bureau|office)\b/;

/** "Gibson, William," and "William Gibson" -> "gibson". Null for organisations and when no usable surname is left. */
export function surnameOf(name: string): string | null {
  const norm = normalize(surnameFirstToGivenFirst(name.replace(/[\s,.;]+$/, "")));
  const toks = tokenize(norm).filter((t) => !SUFFIXES.has(t) && !/^\d+$/.test(t));
  if (toks.length > 4 || ORGANISATION.test(norm)) return null;
  const s = toks[toks.length - 1];
  return s && s.length >= 2 ? s : null;
}

/** A record's main title as content tokens (stopwords dropped unless nothing else is left). */
export function titleTokens(title: string): string[] {
  const main = splitSubtitle(title.replace(/\s*\([^)]*\)\s*$/, "")).main;
  const toks = tokenize(normalize(main));
  const content = toks.filter((t) => !STOPWORDS.has(t));
  return content.length ? content : toks;
}

/** Does a reader token read as this record token, allowing OCR damage? */
export function tokenMatch(readerTok: string, recordTok: string, minFuzzy: number = RESOLVE.fuzzyMinLength): boolean {
  if (readerTok === recordTok || skeleton(readerTok) === skeleton(recordTok)) return true;
  if (confusableReadings(readerTok).includes(recordTok)) return true;
  if (recordTok.length < minFuzzy || readerTok.length < minFuzzy - 1) return false;
  const max = recordTok.length >= 9 ? 2 : 1;
  return editDistance(readerTok, recordTok, max) <= max;
}

/** A reading's tokens, initials joined, plus each adjacent pair joined (a word split by a line break). */
export function readingTokens(text: string): string[] {
  const toks = tokensWithInitials(normalize(text));
  const plain = tokenize(normalize(text));
  for (let i = 0; i + 1 < plain.length; i++) toks.push(plain[i]! + plain[i + 1]!);
  return toks;
}

export function titleInReading(title: string[], reading: string[]): boolean {
  if (title.join("").length < RESOLVE.minTitleChars) return false;
  const found = title.map((t) => reading.some((r) => tokenMatch(r, t)));
  const hit = found.filter(Boolean).length;
  const need = title.length <= RESOLVE.allTokensUpTo ? title.length : Math.ceil(RESOLVE.longTitleShare * title.length);
  if (hit >= need) return true;
  const k = found.indexOf(false);
  return k / title.length >= RESOLVE.prefixShare && title.slice(0, k).join("").length >= RESOLVE.prefixMinChars;
}

export function surnameInReading(surname: string, reading: string[]): boolean {
  return reading.some((r) => (surname.length < RESOLVE.minFuzzySurname ? r === surname : tokenMatch(r, surname)));
}

/**
 * The record resolves the box when its main title is in one reader's text and one of its first
 * (personal) authors' surnames is in some reader's text, the same reader or another, read by a token
 * that is not itself a title word (so one word cannot be both).
 */
export function resolves(rec: OutsideRecord, texts: ReaderText[]): boolean {
  const title = titleTokens(rec.title);
  const readings = texts.map((t) => readingTokens(t.text));
  if (!readings.some((r) => titleInReading(title, r))) return false;
  const surnames = rec.authors.slice(0, LIMITS.recordAuthors).map(surnameOf).filter((s): s is string => s !== null);
  const notTitle = readings.map((r) => r.filter((tok) => !title.some((t) => skeleton(tok) === skeleton(t))));
  return surnames.some((s) => notTitle.some((r) => surnameInReading(s, r)));
}

// ---------------------------------------------------------------------------------------------
// ISFDB check
// ---------------------------------------------------------------------------------------------

export interface IsfdbHit {
  workId: string;
  how: "isbn" | "title-author";
}

const noArticle = (t: string) => t.replace(/^(the|a|an) /, "");
const sameTitle = (x: string, y: string) => {
  const [a, b] = [noArticle(x), noArticle(y)];
  return a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `);
};

/**
 * Does ISFDB hold the resolved book? First any of the record's ISBNs against `editions.isbn13`; otherwise
 * `retrieve` with the clean title plus author, accepting a work whose normalised title form equals the
 * record's main title (or one is a whole-word prefix of the other) and which has an author with the
 * record's surname.
 */
export function isfdbHolds(db: DatabaseSync, rec: OutsideRecord): IsfdbHit | null {
  const isbns = [...new Set(rec.isbns.map(toIsbn13).filter((x): x is string => x !== null))];
  for (let i = 0; i < isbns.length; i += 500) {
    const chunk = isbns.slice(i, i + 500);
    const row = db.prepare(`SELECT work_id FROM editions WHERE isbn13 IN (${chunk.map(() => "?").join(",")}) LIMIT 1`).get(...chunk) as { work_id: string } | undefined;
    if (row) return { workId: row.work_id, how: "isbn" };
  }
  const main = normalize(splitSubtitle(rec.title).main);
  const surnames = new Set(rec.authors.slice(0, LIMITS.recordAuthors).map(surnameOf).filter((s): s is string => s !== null));
  if (main === "" || surnames.size === 0) return null;
  const form = db.prepare("SELECT title_norm, author_norm FROM works WHERE id = ?");
  for (const c of retrieve(db, [`${rec.title} ${rec.authors.slice(0, LIMITS.recordAuthors).join(" ")}`], 10)) {
    const w = form.get(c.workId) as { title_norm: string; author_norm: string } | undefined;
    if (!w) continue;
    const titles = w.title_norm.split("|").map((f) => f.slice(2));
    const authors = w.author_norm.split("|").map((a) => tokenize(a).at(-1) ?? "");
    if (titles.some((t) => sameTitle(t, main)) && authors.some((a) => surnames.has(a))) return { workId: c.workId, how: "title-author" };
  }
  return null;
}

export type Genre = "sf" | "non-sf" | "no-subjects";

export function genreOf(rec: OutsideRecord): Genre {
  if (rec.subjects.length === 0) return "no-subjects";
  return rec.subjects.some((s) => SF_SUBJECT.test(s)) ? "sf" : "non-sf";
}

// ---------------------------------------------------------------------------------------------
// Live calls: rate-limited, cached
// ---------------------------------------------------------------------------------------------

/** Identifies the app; no email address (card brief), so Open Library's 1 request/s unidentified rate applies. */
export const USER_AGENT = "BookcaseDiscovery/0.0 (catalog coverage measurement, card C-4; +https://github.com/ojfbot/BookcaseDiscovery)";
/** Minimum spacing between calls: Open Library at most 1/s, LoC at most 10/min, each with a margin. */
export const SPACING_MS: Record<Source, number> = { openlibrary: 1100, loc: 6500 };

export type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<{ status: number; text(): Promise<string> }>;

export interface LiveOptions {
  fetch?: FetchLike;
  /** Refuse to call out: a cache miss is an error (a rerun must make no calls). */
  offline?: boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class LiveCache {
  calls: Record<Source, number> = { openlibrary: 0, loc: 0 };
  hits: Record<Source, number> = { openlibrary: 0, loc: 0 };
  errors: Record<Source, number> = { openlibrary: 0, loc: 0 };
  private last: Record<Source, number> = { openlibrary: -Infinity, loc: -Infinity };
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  readonly dir: string;
  private readonly opts: LiveOptions;

  constructor(dir: string, opts: LiveOptions = {}) {
    this.dir = dir;
    this.opts = opts;
    this.fetchImpl = opts.fetch ?? ((url, init) => fetch(url, init));
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? (() => Date.now());
  }

  path(source: Source, url: string): string {
    return join(this.dir, source, `${createHash("sha256").update(url).digest("hex")}.json`);
  }

  /** The response body, from the cache or the source. Null when the source failed three times (not cached). */
  async get(source: Source, url: string): Promise<string | null> {
    const p = this.path(source, url);
    if (existsSync(p)) {
      this.hits[source]++;
      return (JSON.parse(readFileSync(p, "utf8")) as { body: string }).body;
    }
    if (this.opts.offline) throw new Error(`offline: no cached ${source} response for a query (cache key ${p.slice(-69, -5)})`);
    for (let attempt = 1; attempt <= 3; attempt++) {
      const wait = this.last[source] + SPACING_MS[source] - this.now();
      if (wait > 0) await this.sleep(wait);
      this.last[source] = this.now();
      this.calls[source]++;
      try {
        const res = await this.fetchImpl(url, { headers: { "User-Agent": USER_AGENT, Accept: source === "loc" ? "application/xml" : "application/json" } });
        if (res.status === 200) {
          const body = await res.text();
          mkdirSync(join(this.dir, source), { recursive: true });
          writeFileSync(p, JSON.stringify({ url, status: 200, fetchedAt: new Date(this.now()).toISOString(), body }));
          return body;
        }
        if (res.status !== 429 && res.status < 500) break;
      } catch {
        // network error: retry
      }
      await this.sleep(attempt * (source === "loc" ? 30000 : 10000));
    }
    this.errors[source]++;
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// One box
// ---------------------------------------------------------------------------------------------

export type BoxClass = "in-isfdb" | "not-in-isfdb" | "unresolved";

export interface BoxResult {
  id: string;
  stratum: Stratum;
  role: SampledBox["role"];
  cls: BoxClass;
  resolvedBy: Source | null;
  /** The resolving record (private table only). */
  record: OutsideRecord | null;
  isfdb: IsfdbHit | null;
  /** Does Open Library hold the resolved book (it resolved it, or a clean title+author query finds it)? */
  inOpenLibrary: boolean;
  genre: Genre | null;
  queries: { source: Source; kind: LiveQuery["kind"]; url: string; records: number }[];
  /** For confirmed boxes: F-0's accepted work, and whether the ISFDB check found the same one. */
  f0WorkId: string | null;
  agreesWithF0: boolean | null;
}

async function firstResolving(live: LiveCache, queries: LiveQuery[], texts: ReaderText[], log: BoxResult["queries"]): Promise<OutsideRecord | null> {
  for (const q of queries) {
    const body = await live.get(q.source, q.url);
    const recs = body === null ? [] : q.source === "openlibrary" ? parseOpenLibrary(body) : parseMods(body);
    log.push({ source: q.source, kind: q.kind, url: q.url, records: recs.length });
    const hit = recs.slice(0, LIMITS.records).find((r) => resolves(r, texts));
    if (hit) return hit;
  }
  return null;
}

export async function resolveBox(
  db: DatabaseSync,
  live: LiveCache,
  box: SampledBox,
  reads: Partial<Record<ReaderName, Reading>>,
  f0WorkId: string | null,
): Promise<BoxResult> {
  const texts = readerTexts(reads);
  const queries: BoxResult["queries"] = [];
  let record = await firstResolving(live, liveQueries(texts, "openlibrary"), texts, queries);
  let resolvedBy: Source | null = record ? "openlibrary" : null;
  let inOpenLibrary = record !== null;
  if (!record) {
    record = await firstResolving(live, liveQueries(texts, "loc"), texts, queries);
    if (record) {
      resolvedBy = "loc";
      // Union with Open Library is measured on the clean label (§5), not on the OCR.
      const url = cleanQuery("openlibrary", record.title, record.authors[0] ?? "");
      const body = await live.get("openlibrary", url);
      const recs = body === null ? [] : parseOpenLibrary(body);
      queries.push({ source: "openlibrary", kind: "fielded", url, records: recs.length });
      inOpenLibrary = recs.some((r) => resolves(r, [{ reader: "qwen", text: `${record!.title} ${record!.authors.join(" ")}` }]));
    }
  }
  const isfdb = record ? isfdbHolds(db, record) : null;
  const cls: BoxClass = !record ? "unresolved" : isfdb ? "in-isfdb" : "not-in-isfdb";
  return {
    id: box.id,
    stratum: box.stratum,
    role: box.role,
    cls,
    resolvedBy,
    record,
    isfdb,
    inOpenLibrary,
    genre: record && !isfdb ? genreOf(record) : null,
    queries,
    f0WorkId,
    agreesWithF0: f0WorkId === null || !isfdb ? null : isfdb.workId === f0WorkId,
  };
}

// ---------------------------------------------------------------------------------------------
// Estimates
// ---------------------------------------------------------------------------------------------

export interface Interval {
  value: number;
  lo: number;
  hi: number;
}

type Row = Pick<BoxResult, "stratum" | "cls" | "inOpenLibrary" | "genre">;
const UNKNOWN: Stratum[] = ["no-catalog-match", "single-reader", "readers-disagree"];

interface Totals {
  /** Weighted boxes: readable and in ISFDB, of which F-0 left `unknown` (match miss), readable and not, unresolved. */
  inIsfdb: number;
  missIn: number;
  notIn: number;
  notInOpenLibrary: number;
  unresolved: number;
  genre: Record<Genre, number>;
  byStratum: Record<string, Record<BoxClass, number>>;
}

/**
 * `confirmedWhole`: count every F-0-confirmed box as readable and in ISFDB instead of weighting its
 * sampled rows (the sensitivity variant; the primary estimate measures confirmed boxes like the rest).
 */
function totals(rows: Row[], population: Record<Stratum, number>, confirmedWhole: boolean): Totals {
  const t: Totals = { inIsfdb: confirmedWhole ? population.confirmed : 0, missIn: 0, notIn: 0, notInOpenLibrary: 0, unresolved: 0, genre: { sf: 0, "non-sf": 0, "no-subjects": 0 }, byStratum: {} };
  for (const s of confirmedWhole ? UNKNOWN : STRATA) {
    const rs = rows.filter((r) => r.stratum === s);
    const share: Record<BoxClass, number> = { "in-isfdb": 0, "not-in-isfdb": 0, unresolved: 0 };
    if (rs.length === 0) {
      t.byStratum[s] = share;
      continue;
    }
    const w = population[s] / rs.length;
    for (const r of rs) {
      share[r.cls] += 1 / rs.length;
      if (r.cls === "in-isfdb") {
        if (s === "confirmed") t.inIsfdb += w;
        else t.missIn += w;
      }
      else if (r.cls === "not-in-isfdb") {
        t.notIn += w;
        if (r.inOpenLibrary) t.notInOpenLibrary += w;
        t.genre[r.genre ?? "no-subjects"] += w;
      } else t.unresolved += w;
    }
    t.byStratum[s] = share;
  }
  t.inIsfdb += t.missIn;
  return t;
}

/** Every reported share, as a function of one (re)sample. */
function shares(rows: Row[], population: Record<Stratum, number>): Record<string, number> {
  const t = totals(rows, population, false);
  const whole = totals(rows, population, true);
  const readable = t.inIsfdb + t.notIn;
  const asNot = readable + t.unresolved;
  const unknown = UNKNOWN.reduce((a, s) => a + population[s], 0);
  const out: Record<string, number> = {
    "isfdb.unresolvedExcluded": t.inIsfdb / readable,
    "isfdb.unresolvedAsNotInIsfdb": t.inIsfdb / asNot,
    "isfdbOrOpenLibrary.unresolvedExcluded": (t.inIsfdb + t.notInOpenLibrary) / readable,
    "isfdbOrOpenLibrary.unresolvedAsNotInIsfdb": (t.inIsfdb + t.notInOpenLibrary) / asNot,
    "isfdbOrOpenLibraryOrLoc.unresolvedExcluded": readable / readable,
    "isfdbOrOpenLibraryOrLoc.unresolvedAsNotInIsfdb": readable / asNot,
    "matchMiss.ofReadable": t.missIn / readable,
    "notInIsfdb.sf": t.genre.sf / t.notIn,
    "notInIsfdb.nonSf": t.genre["non-sf"] / t.notIn,
    "notInIsfdb.noSubjects": t.genre["no-subjects"] / t.notIn,
    "sampledUnknown.inIsfdbMatchMiss": t.missIn / unknown,
    "sampledUnknown.notInIsfdb": t.notIn / unknown,
    "sampledUnknown.unresolved": t.unresolved / unknown,
    "confirmedWhole.isfdb.unresolvedExcluded": whole.inIsfdb / (whole.inIsfdb + whole.notIn),
    "confirmedWhole.isfdb.unresolvedAsNotInIsfdb": whole.inIsfdb / (whole.inIsfdb + whole.notIn + whole.unresolved),
  };
  for (const [s, c] of Object.entries(t.byStratum)) {
    out[`${s}.${s === "confirmed" ? "inIsfdb" : "inIsfdbMatchMiss"}`] = c["in-isfdb"];
    out[`${s}.notInIsfdb`] = c["not-in-isfdb"];
    out[`${s}.unresolved`] = c.unresolved;
  }
  return out;
}

export interface CoverageEstimate {
  /** Each share with its stratified bootstrap 95 % percentile interval. */
  shares: Record<string, Interval>;
  /** Weighted box counts on the whole set (point estimates). */
  weighted: { readableInIsfdb: number; matchMiss: number; readableNotInIsfdb: number; notInIsfdbInOpenLibrary: number; unresolved: number };
  sample: Record<Stratum, { population: number; sampled: number; counts: Record<BoxClass, number> }>;
}

/**
 * Weighted estimates over the measured sample: every stratum, F-0-confirmed included, is weighted back
 * to its F-0 population (N_h / n_h). F-0's confirmation is machine agreement and can name the wrong book,
 * so confirmed boxes are measured like the rest; `confirmedWhole.*` is the variant that counts all of
 * them as readable and in ISFDB. Intervals: stratified bootstrap (rows resampled within each stratum),
 * percentile 2.5 / 97.5.
 */
export function estimateCoverage(results: Row[], population: Record<Stratum, number>, reps = BOOTSTRAP_REPS, seed = SEED): CoverageEstimate {
  const point = totals(results, population, false);
  const value = shares(results, population);
  const byS = new Map(STRATA.map((s) => [s, results.filter((r) => r.stratum === s)]));
  const rand = rng(seed);
  const draws = new Map<string, number[]>(Object.keys(value).map((k) => [k, []]));
  for (let i = 0; i < reps; i++) {
    const rows: Row[] = [];
    for (const rs of byS.values()) for (let j = 0; j < rs.length; j++) rows.push(rs[Math.floor(rand() * rs.length)]!);
    for (const [k, v] of Object.entries(shares(rows, population))) if (Number.isFinite(v)) draws.get(k)!.push(v);
  }
  const r4 = (x: number) => Math.round(x * 10000) / 10000;
  const out: Record<string, Interval> = {};
  for (const [k, v] of Object.entries(value)) {
    const d = draws.get(k)!.sort((a, b) => a - b);
    out[k] = { value: r4(v), lo: r4(quantile(d, 0.025)), hi: r4(quantile(d, 0.975)) };
  }
  const sample = Object.fromEntries(
    STRATA.map((s) => {
      const rs = results.filter((r) => r.stratum === s);
      const counts: Record<BoxClass, number> = { "in-isfdb": 0, "not-in-isfdb": 0, unresolved: 0 };
      for (const r of rs) counts[r.cls]++;
      return [s, { population: population[s], sampled: rs.length, counts }];
    }),
  ) as CoverageEstimate["sample"];
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    shares: out,
    weighted: {
      readableInIsfdb: r1(point.inIsfdb),
      matchMiss: r1(point.missIn),
      readableNotInIsfdb: r1(point.notIn),
      notInIsfdbInOpenLibrary: r1(point.notInOpenLibrary),
      unresolved: r1(point.unresolved),
    },
    sample,
  };
}
