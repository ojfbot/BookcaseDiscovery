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
// Live calls go through C-10's lookup cache (`lookup.ts`): rate-limited, budgeted, cached under the data root's
// `catalog/coverage/v2/` on a normalized key, and tried only after the cache, known and local tiers (`resolveBox`),
// so a rerun makes no calls. Everything per box (reader text, queries, records) is private; only the
// aggregates from `estimateCoverage` leave through the CLI. Method and results: evals/C4/report.md.
import type { DatabaseSync } from "node:sqlite";
import type { ReaderName, Reading, SpineDecision } from "../eval/f0.ts";
import { quantile, rng } from "../eval/q1.ts";
import { toIsbn13 } from "./isbn.ts";
import { confusableReadings, editDistance, normalize, skeleton, splitSubtitle, STOPWORDS, surnameFirstToGivenFirst, tokenize, tokensWithInitials } from "./normalize.ts";
import { LookupCache, type Answer, type From, type KnownIndex, type LookupOptions, type Source } from "./lookup.ts";
import { retrieve } from "./retrieve.ts";

export { SPACING_MS, USER_AGENT, type FetchLike, type Source } from "./lookup.ts";

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

/** How a query combines its tokens: Open Library `title=`/`author=` or LoC `dc.title`/`dc.creator`; all of them; any of them. */
export type Shape = "fielded" | "and" | "or";

const keyTokens = (s: string) => [...new Set(tokenize(normalize(s)).filter((t) => t.length >= 3 && /\p{L}/u.test(t) && !STOPWORDS.has(t)))].sort();

/** A query's shape and normalized parts, read back from its URL (the inverse of `liveQueries`' builders). */
export function queryParts(source: Source, url: string): { shape: Shape; title: string[]; author: string } {
  const p = new URL(url).searchParams;
  const author = (a: string) => surnameOf(a) ?? keyTokens(a).join(" ");
  if (source === "openlibrary") {
    if (p.has("title")) return { shape: "fielded", title: keyTokens(p.get("title") ?? ""), author: author(p.get("author") ?? "") };
    const q = p.get("q") ?? "";
    return q.includes(" OR ") ? { shape: "or", title: keyTokens(q.split(" OR ").join(" ")), author: "" } : { shape: "and", title: keyTokens(q), author: "" };
  }
  const cql = p.get("query") ?? "";
  const f = cql.match(/^dc\.title="([^"]*)" and dc\.creator="([^"]*)"$/);
  if (f) return { shape: "fielded", title: keyTokens(f[1]!), author: author(f[2]!) };
  return cql.includes(" or ") ? { shape: "or", title: keyTokens(cql.split(" or ").join(" ")), author: "" } : { shape: "and", title: keyTokens(cql), author: "" };
}

/**
 * The cache key of a query (C-10): source, shape, its keyword tokens de-duplicated and sorted, and for a
 * fielded query the author's surname. Token order, repeated tokens and author spellings that share a surname
 * give one key, so reader variants of one spine share a cache entry.
 */
export function queryKey(source: Source, url: string): string {
  const k = queryParts(source, url);
  // A query with no keyword token at all (none is built today) keeps its own entry rather than share an empty key.
  if (k.title.length === 0 && k.author === "") return `${source}|url|${url}`;
  return `${source}|${k.shape}|${k.title.join(" ")}|${k.author}`;
}

export function parseRecords(source: Source, body: string): OutsideRecord[] {
  return source === "openlibrary" ? parseOpenLibrary(body) : parseMods(body);
}

/** C-10's lookup cache with C-4's query key and parsers. `root` is the data root's `catalog/coverage/`. */
export function openLookup(root: string, opts: Omit<LookupOptions, "keyOf" | "recordIds"> = {}): LookupCache {
  return new LookupCache(root, { ...opts, keyOf: queryKey, recordIds: (source, body) => parseRecords(source, body).map((r) => r.id) });
}

// ---------------------------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------------------------

export interface OutsideRecord {
  /** `isfdb`: a work of the local ISFDB catalog, proposed by the local tier (C-10). */
  source: Source | "isfdb";
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
  /** `local`: the resolving record is itself an ISFDB work (C-10's local tier). */
  how: "isbn" | "title-author" | "local";
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
// One box: tiers (C-10)
// ---------------------------------------------------------------------------------------------

export type BoxClass = "in-isfdb" | "not-in-isfdb" | "unresolved";

/**
 * Which tier answered a box: a fresh cached response (`cache`, or `stale` when no call could be made), a record
 * already resolved for its copy group or work (`known`), a local catalog's work (`local-isfdb`,
 * `local-openlibrary`), or a live call (`live`).
 */
export type Tier = "cache" | "stale" | "known" | "local-isfdb" | "local-openlibrary" | "live";

/** The local tier (`lookup-local.ts`): catalog works tried as records under the same resolution rule. */
export interface LocalTier {
  resolve(texts: ReaderText[]): { tier: "local-isfdb" | "local-openlibrary"; record: OutsideRecord } | null;
  /** Does a local Open Library work hold this record's book (the clean-label union check)? */
  inOpenLibrary(record: OutsideRecord): boolean;
}

export interface TierContext {
  local?: LocalTier | null;
  known?: KnownIndex<OutsideRecord> | null;
  /** The box's copy group key (`copyKey`), when F-0g put it in one. */
  copy?: string | null;
}

export interface BoxResult {
  id: string;
  stratum: Stratum;
  role: SampledBox["role"];
  cls: BoxClass;
  resolvedBy: OutsideRecord["source"] | null;
  /** Which tier answered (null: unresolved). */
  tier: Tier | null;
  /** No live call was made for this box although one was needed: its copy or work was resolved (`known`), or the budget was spent (`budget`). */
  skipped: "known" | "budget" | null;
  /** Queries with no fresh cache entry: the box needed the tiers past the cache. */
  pending: number;
  /** The resolving record (private table only). */
  record: OutsideRecord | null;
  isfdb: IsfdbHit | null;
  /** Does Open Library hold the resolved book (it resolved it, or a clean title+author query finds it)? */
  inOpenLibrary: boolean;
  genre: Genre | null;
  queries: { source: Source; kind: LiveQuery["kind"]; url: string; key: string; from: From; records: number }[];
  /** For confirmed boxes: F-0's accepted work, and whether the ISFDB check found the same one. */
  f0WorkId: string | null;
  agreesWithF0: boolean | null;
}

async function ask(cache: LookupCache, q: Pick<LiveQuery, "source" | "kind" | "url">, log: BoxResult["queries"]): Promise<{ answer: Answer; recs: OutsideRecord[] }> {
  const answer = await cache.get(q.source, q.url);
  const recs = answer.body === null ? [] : parseRecords(q.source, answer.body);
  log.push({ source: q.source, kind: q.kind, url: q.url, key: answer.key, from: answer.from, records: recs.length });
  return { answer, recs };
}

const firstResolving = (recs: OutsideRecord[], texts: ReaderText[]) => recs.slice(0, LIMITS.records).find((r) => resolves(r, texts)) ?? null;

/**
 * Resolves one box through the tiers (evals/C10/prereg.md): every query with a fresh cache entry in C-4's
 * order (Open Library, then LoC); then, only if some query would need a live call, a record known for the
 * box's copy group or work, then the local catalogs; a box whose copy or work is already resolved stops
 * there; the rest go live in C-4's order, within the cache's budget. A fully cached box is resolved exactly as
 * C-4 resolved it.
 */
export async function resolveBox(
  db: DatabaseSync,
  cache: LookupCache,
  box: SampledBox,
  reads: Partial<Record<ReaderName, Reading>>,
  f0WorkId: string | null,
  ctx: TierContext = {},
): Promise<BoxResult> {
  const texts = readerTexts(reads);
  const queries: BoxResult["queries"] = [];
  const pending: LiveQuery[] = [];
  let hit: { record: OutsideRecord; tier: Tier } | null = null;
  let skipped: BoxResult["skipped"] = null;
  for (const q of [...liveQueries(texts, "openlibrary"), ...liveQueries(texts, "loc")]) {
    if (cache.peek(q.source, q.url).state !== "fresh") {
      pending.push(q);
      continue;
    }
    const record = firstResolving((await ask(cache, q, queries)).recs, texts);
    if (record) {
      hit = { record, tier: "cache" };
      break;
    }
  }
  const copy = ctx.copy ?? null;
  if (!hit && pending.length > 0) {
    const known = ctx.known?.recordsFor(copy, f0WorkId).find((r) => resolves(r, texts));
    if (known) hit = { record: known, tier: "known" };
    const local = hit ? null : ctx.local?.resolve(texts);
    if (local) hit = local;
    if (!hit && ctx.known?.has(copy, f0WorkId)) skipped = "known";
    else if (!hit) {
      for (const q of pending) {
        const { answer, recs } = await ask(cache, q, queries);
        if (answer.from === "skipped") skipped = "budget";
        const record = firstResolving(recs, texts);
        if (record) {
          hit = { record, tier: answer.from === "stale" ? "stale" : "live" };
          break;
        }
      }
    }
  }
  const record = hit?.record ?? null;
  let inOpenLibrary = record?.source === "openlibrary";
  if (record?.source === "loc") {
    // Union with Open Library is measured on the clean label (§5), not on the OCR.
    const q = { source: "openlibrary" as const, kind: "fielded" as const, url: cleanQuery("openlibrary", record.title, record.authors[0] ?? "") };
    const clean = [{ reader: "qwen" as const, text: `${record.title} ${record.authors.join(" ")}` }];
    if (cache.peek(q.source, q.url).state !== "fresh" && ctx.local?.inOpenLibrary(record)) inOpenLibrary = true;
    else {
      const { answer, recs } = await ask(cache, q, queries);
      if (answer.from === "skipped") skipped ??= "budget";
      inOpenLibrary = recs.some((r) => resolves(r, clean));
    }
  } else if (record?.source === "isfdb") inOpenLibrary = ctx.local?.inOpenLibrary(record) ?? false;
  if (record) ctx.known?.add(copy, f0WorkId, record);
  const isfdb = !record ? null : record.source === "isfdb" ? { workId: record.id, how: "local" as const } : isfdbHolds(db, record);
  const cls: BoxClass = !record ? "unresolved" : isfdb ? "in-isfdb" : "not-in-isfdb";
  return {
    id: box.id,
    stratum: box.stratum,
    role: box.role,
    cls,
    resolvedBy: record?.source ?? null,
    tier: hit?.tier ?? null,
    skipped,
    pending: pending.length,
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
  /** The same two, within F-0's `unknown` strata only. */
  unknownNotIn: number;
  unknownUnresolved: number;
  genre: Record<Genre, number>;
  byStratum: Record<string, Record<BoxClass, number>>;
}

/**
 * `confirmedWhole`: count every F-0-confirmed box as readable and in ISFDB instead of weighting its
 * sampled rows (the sensitivity variant; the primary estimate measures confirmed boxes like the rest).
 */
function totals(rows: Row[], population: Record<Stratum, number>, confirmedWhole: boolean): Totals {
  const t: Totals = { inIsfdb: confirmedWhole ? population.confirmed : 0, missIn: 0, notIn: 0, notInOpenLibrary: 0, unresolved: 0, unknownNotIn: 0, unknownUnresolved: 0, genre: { sf: 0, "non-sf": 0, "no-subjects": 0 }, byStratum: {} };
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
        if (s !== "confirmed") t.unknownNotIn += w;
        if (r.inOpenLibrary) t.notInOpenLibrary += w;
        t.genre[r.genre ?? "no-subjects"] += w;
      } else {
        t.unresolved += w;
        if (s !== "confirmed") t.unknownUnresolved += w;
      }
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
    "sampledUnknown.notInIsfdb": t.unknownNotIn / unknown,
    "sampledUnknown.unresolved": t.unknownUnresolved / unknown,
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

// ---------------------------------------------------------------------------------------------
// Post-hoc: does Q-2's reader-agreement rung predict "readable"? (not pre-registered; secondary)
// ---------------------------------------------------------------------------------------------

export interface RungSplit {
  /** Per rung, among the sampled `no-catalog-match` rows: sampled boxes, class counts, resolved share. */
  rungs: Record<string, { population: number; sampled: number; counts: Record<BoxClass, number>; resolved: Interval }>;
  /** Resolved share in `text-read` minus in `text-present`, with a bootstrap interval. */
  resolvedDifference: Interval | null;
  /** `no-catalog-match` class shares re-weighted by rung population (post-stratified), with intervals. */
  postStratified: Record<BoxClass, Interval>;
}

/**
 * Splits the sampled `no-catalog-match` rows by a per-box rung (Q-2's `text-read` = readers agree,
 * `text-present` = they do not). The sample was not stratified by rung, so this is post-stratification
 * on a fixed sample: per-rung counts are whatever the draw gave.
 */
export function rungSplit(results: Pick<BoxResult, "id" | "stratum" | "cls">[], rungOf: Map<string, string>, rungPopulation: Record<string, number>, reps = BOOTSTRAP_REPS, seed = SEED): RungSplit {
  const rows = results.filter((r) => r.stratum === "no-catalog-match");
  const rungs = Object.keys(rungPopulation);
  const by = new Map(rungs.map((g) => [g, rows.filter((r) => rungOf.get(r.id) === g)]));
  const resolvedShare = (rs: { cls: BoxClass }[]) => (rs.length ? rs.filter((r) => r.cls !== "unresolved").length / rs.length : NaN);
  const post = (m: Map<string, { cls: BoxClass }[]>): Record<BoxClass, number> => {
    const out: Record<BoxClass, number> = { "in-isfdb": 0, "not-in-isfdb": 0, unresolved: 0 };
    const total = rungs.reduce((a, g) => a + (m.get(g)!.length ? rungPopulation[g]! : 0), 0);
    for (const g of rungs) {
      const rs = m.get(g)!;
      for (const r of rs) out[r.cls] += rungPopulation[g]! / rs.length / total;
    }
    return out;
  };
  const diff = (m: Map<string, { cls: BoxClass }[]>) => resolvedShare(m.get("text-read") ?? []) - resolvedShare(m.get("text-present") ?? []);
  const rand = rng(seed);
  const draws = { diff: [] as number[], rung: new Map(rungs.map((g) => [g, [] as number[]])), post: { "in-isfdb": [] as number[], "not-in-isfdb": [] as number[], unresolved: [] as number[] } };
  for (let i = 0; i < reps; i++) {
    const m = new Map([...by].map(([g, rs]) => [g, rs.map(() => rs[Math.floor(rand() * rs.length)]!)]));
    const d = diff(m);
    if (Number.isFinite(d)) draws.diff.push(d);
    for (const g of rungs) {
      const v = resolvedShare(m.get(g)!);
      if (Number.isFinite(v)) draws.rung.get(g)!.push(v);
    }
    for (const [k, v] of Object.entries(post(m)) as [BoxClass, number][]) draws.post[k].push(v);
  }
  const r4 = (x: number) => Math.round(x * 10000) / 10000;
  const iv = (value: number, d: number[]): Interval => {
    const s = [...d].sort((a, b) => a - b);
    return { value: r4(value), lo: r4(quantile(s, 0.025)), hi: r4(quantile(s, 0.975)) };
  };
  const d0 = diff(by);
  return {
    rungs: Object.fromEntries(
      rungs.map((g) => {
        const rs = by.get(g)!;
        const counts: Record<BoxClass, number> = { "in-isfdb": 0, "not-in-isfdb": 0, unresolved: 0 };
        for (const r of rs) counts[r.cls]++;
        return [g, { population: rungPopulation[g]!, sampled: rs.length, counts, resolved: iv(resolvedShare(rs), draws.rung.get(g)!) }];
      }),
    ),
    resolvedDifference: Number.isFinite(d0) ? iv(d0, draws.diff) : null,
    postStratified: Object.fromEntries((Object.entries(post(by)) as [BoxClass, number][]).map(([k, v]) => [k, iv(v, draws.post[k])])) as Record<BoxClass, Interval>,
  };
}
