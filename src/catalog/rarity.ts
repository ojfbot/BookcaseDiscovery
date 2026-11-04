// C-7 rarity-weighted evidence and counter-evidence. F-0's bar asks how well a reader's text explains its top work;
// on an open catalog that is not enough, because a title match counts the same whether a hundred books share the
// title or one does, and nothing in the bar counts *against* a work. Record linkage solves the first with
// term-frequency weighting from the catalog's own statistics (Fellegi-Sunter; Splink), with no labels (OC36). This
// module builds those statistics into a sidecar file beside the catalog, computes the evidence for one confirmed
// candidate on one reader's text, and says which counter-evidence, if any, withdraws the confirmation. It never adds
// an accept or switches one to another work. Constants are pre-registered in evals/C7/report.md and never tuned.
//
//   statsPathFor("…/catalog-v2.sqlite") -> "…/catalog-v2.stats.sqlite"   (the catalog file itself is never written)
//   buildStats(catalogPath)                                            one pass over works and editions
//   rarityBasis(db, openStats(path)) -> counterCheck(basis, candidate, ranked, variants)
import { existsSync, renameSync, rmSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { LOOKALIKE, lookalikeGuard, sameBook, type TitleForms } from "./lookalike.ts";
import { normalize, STOPWORDS, tokenize } from "./normalize.ts";
import type { Candidate, FieldEvidence } from "./retrieve.ts";

export const RARITY = {
  /**
   * Namesake share: a confirmation that rests on the title alone needs its book to carry *more than* this share of
   * the matched title form's editions (all books holding the form; duplicates of one book counted together). Among
   * the books a title fits, a shelf copy is one of them in proportion to how often each was published, so above 0.5
   * the candidate is more likely than all its namesakes together. Not a ranking: it can only withdraw.
   */
  shareMin: 0.5,
  /** A second field that pins the book among its namesakes: a surname read (C-6's `secondAuthor`) or the series at F-0's title bar. */
  secondAuthor: LOOKALIKE.secondAuthor,
  secondSeries: LOOKALIKE.secondSeries,
  /** Read words shorter than this never count against a work: `retrieve` trusts no shorter token alone (its substring and fuzzy floors). */
  wordMinLength: 4,
  /** A read word counts against a work only if at least this many catalog works carry it: a word seen once may be an OCR accident. */
  wordMinWorks: 2,
  /** How deep in the reader's ranked candidates a rival author is looked for (C-6's depth). */
  depth: LOOKALIKE.depth,
} as const;

/**
 * Function words that mark a reading's language. Only words exclusive to one list are used (shared ones such as
 * "del" or "una" are dropped by `exclusiveWords`), and words that are also common names or English words were left
 * out ("le", "von", "die", "den", "mit", "et").
 */
export const LANGUAGE_WORDS: Record<string, readonly string[]> = {
  English: ["the", "and", "of", "with", "from"],
  Spanish: ["el", "los", "las", "del", "una", "con", "por", "para"],
  Catalan: ["els", "amb", "del", "per", "una", "les"],
  French: ["les", "des", "du", "une", "avec", "pour"],
  German: ["der", "das", "und", "ein", "eine", "dem"],
  Italian: ["il", "gli", "della", "delle", "dei", "del", "con", "per", "una"],
};

export function exclusiveWords(lists: Record<string, readonly string[]> = LANGUAGE_WORDS): Map<string, string> {
  const seen = new Map<string, Set<string>>();
  for (const [lang, words] of Object.entries(lists)) for (const w of words) seen.set(w, (seen.get(w) ?? new Set()).add(lang));
  return new Map([...seen].filter(([, l]) => l.size === 1).map(([w, l]) => [w, [...l][0]!]));
}
const LANGUAGE_OF = exclusiveWords();
const FUNCTION_WORDS = new Set(Object.values(LANGUAGE_WORDS).flat());

// ---------------------------------------------------------------------------------------------
// Statistics sidecar
// ---------------------------------------------------------------------------------------------

/** Bump when a table of the sidecar changes. */
export const STATS_SCHEMA_VERSION = 1;

/** The sidecar beside a catalog file: `catalog.sqlite` -> `catalog.stats.sqlite`. */
export function statsPathFor(catalogPath: string): string {
  return `${catalogPath.replace(/\.sqlite$/, "")}.stats.sqlite`;
}

/** Size and modification time of the catalog file: the sidecar is refused when they no longer match. */
export function catalogStamp(path: string): string {
  const st = statSync(path);
  return `${st.size}:${Math.round(st.mtimeMs)}`;
}

/** A work's primary author surname (last token of the first-listed author), "" without an author: the duplicate key with the title. */
export function primarySurname(authors: readonly string[]): string {
  return tokenize(normalize(authors[0] ?? "")).at(-1) ?? "";
}

/** Whole and main title forms, own and variant (`title_norm` kinds T, M, V, W): the forms a spine's title is. */
const WHOLE = /^[TMVW]:/;

export interface StatsCounts {
  works: number;
  books: number;
  titleForms: number;
  titleBooks: number;
  words: number;
  authorForms: number;
  seconds: number;
}

/**
 * Builds the statistics sidecar from a catalog, read-only: title form -> works, books and editions; (title form,
 * primary surname) -> works and editions; word -> works carrying it in a title, author or series form, and works
 * with an edition whose publisher carries it; author form -> works. Writes `<out>.partial` and renames it.
 */
export function buildStats(catalogPath: string, out = statsPathFor(catalogPath), log: (s: string) => void = () => {}): StatsCounts {
  const t0 = performance.now();
  const cat = new DatabaseSync(catalogPath, { readOnly: true });
  const partial = `${out}.partial`;
  rmSync(partial, { force: true });
  const db = new DatabaseSync(partial);
  db.exec("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA temp_store = FILE;");
  db.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE raw_title (norm TEXT NOT NULL, surname TEXT NOT NULL, editions INTEGER NOT NULL, own INTEGER NOT NULL);
    CREATE TABLE raw_author (norm TEXT NOT NULL);
  `);
  const insTitle = db.prepare("INSERT INTO raw_title VALUES (?, ?, ?, ?)");
  const insAuthor = db.prepare("INSERT INTO raw_author VALUES (?)");
  const words = new Map<string, number>();
  let works = 0;
  db.exec("BEGIN");
  for (const w of cat.prepare("SELECT authors, edition_count, title_norm, author_norm, series_norm FROM works").iterate() as Iterable<{ authors: string; edition_count: number; title_norm: string; author_norm: string; series_norm: string }>) {
    works++;
    const surname = primarySurname(JSON.parse(w.authors) as string[]);
    const editions = Math.max(1, w.edition_count);
    const entries = w.title_norm.split("|").filter((e) => e !== "");
    const whole = new Map<string, boolean>();
    for (const e of entries) if (WHOLE.test(e)) whole.set(e.slice(2), (whole.get(e.slice(2)) ?? false) || e[0] === "T");
    for (const [norm, own] of whole) insTitle.run(norm, surname, editions, own ? 1 : 0);
    const authors = new Set(w.author_norm.split("|").filter((a) => a !== ""));
    for (const a of authors) insAuthor.run(a);
    const toks = new Set<string>();
    for (const f of [...entries.map((e) => e.slice(2)), ...authors, ...w.series_norm.split("|")]) for (const t of tokenize(f)) toks.add(t);
    for (const t of toks) words.set(t, (words.get(t) ?? 0) + 1);
    if (works % 500_000 === 0) log(`stats: ${works} works`);
  }
  db.exec("COMMIT");
  log(`stats: ${works} works read; publishers`);
  const pub = new Map<string, number>();
  let last: string | null = null;
  let seen = new Set<string>();
  const flush = () => {
    for (const t of seen) pub.set(t, (pub.get(t) ?? 0) + 1);
    seen = new Set();
  };
  // editions' primary key is (work_id, edition_id), so this scan comes grouped by work.
  for (const e of cat.prepare("SELECT work_id, publisher FROM editions WHERE publisher IS NOT NULL AND publisher <> ''").iterate() as Iterable<{ work_id: string; publisher: string }>) {
    if (e.work_id !== last) flush(), (last = e.work_id);
    for (const t of tokenize(normalize(e.publisher))) seen.add(t);
  }
  flush();
  cat.close();
  log("stats: aggregating");
  db.exec(`
    CREATE TABLE title_books (norm TEXT NOT NULL, surname TEXT NOT NULL, works INTEGER NOT NULL, editions INTEGER NOT NULL, PRIMARY KEY (norm, surname)) WITHOUT ROWID;
    INSERT INTO title_books SELECT norm, surname, count(*), sum(editions) FROM raw_title GROUP BY norm, surname;
    CREATE TABLE title_totals (norm TEXT PRIMARY KEY, works INTEGER NOT NULL, books INTEGER NOT NULL, editions INTEGER NOT NULL) WITHOUT ROWID;
    INSERT INTO title_totals SELECT norm, sum(works), count(*), sum(editions) FROM title_books GROUP BY norm;
    CREATE TABLE author_works (norm TEXT PRIMARY KEY, works INTEGER NOT NULL) WITHOUT ROWID;
    INSERT INTO author_works SELECT norm, count(*) FROM raw_author GROUP BY norm;
    CREATE TABLE words (token TEXT PRIMARY KEY, works INTEGER NOT NULL, pub_works INTEGER NOT NULL) WITHOUT ROWID;
  `);
  const books = (db.prepare("SELECT count(*) AS n FROM (SELECT DISTINCT norm, surname FROM raw_title WHERE own = 1)").get() as { n: number }).n;
  db.exec("DROP TABLE raw_title; DROP TABLE raw_author; BEGIN");
  const insWord = db.prepare("INSERT INTO words VALUES (?, ?, ?)");
  for (const t of new Set([...words.keys(), ...pub.keys()])) insWord.run(t, words.get(t) ?? 0, pub.get(t) ?? 0);
  db.exec("COMMIT");
  const count = (table: string) => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
  const counts: StatsCounts = { works, books, titleForms: count("title_totals"), titleBooks: count("title_books"), words: count("words"), authorForms: count("author_works"), seconds: 0 };
  const meta = db.prepare("INSERT INTO meta VALUES (?, ?)");
  for (const [k, v] of Object.entries({ schema_version: STATS_SCHEMA_VERSION, catalog_stamp: catalogStamp(catalogPath), works, books, built: new Date().toISOString() })) meta.run(k, String(v));
  db.exec(`PRAGMA user_version = ${STATS_SCHEMA_VERSION}; VACUUM;`);
  db.close();
  renameSync(partial, out);
  counts.seconds = Math.round((performance.now() - t0) / 100) / 10;
  log(`stats: ${out} in ${counts.seconds} s`);
  return counts;
}

/** Memoised lookups on one sidecar. */
export interface CatalogStats {
  works: number;
  books: number;
  /** Works, books and editions holding one whole or main title form. */
  title(norm: string): { works: number; books: number; editions: number };
  /** Editions of the book (title form, primary surname); 0 when that book does not hold the form. */
  bookEditions(norm: string, surname: string): number;
  /** Works carrying a word in a title, author or series form, and works with an edition whose publisher carries it. */
  word(token: string): { works: number; pubWorks: number };
  authorWorks(norm: string): number;
  close(): void;
}

/** Opens a sidecar; refuses one built from another state of the catalog file (`catalogPath`, when given). */
export function openStats(path: string, catalogPath?: string): CatalogStats {
  if (!existsSync(path)) throw new Error(`${path} does not exist; run \`bookcase catalog stats\` first`);
  const db = new DatabaseSync(path, { readOnly: true });
  const meta = Object.fromEntries((db.prepare("SELECT key, value FROM meta").all() as Array<{ key: string; value: string }>).map((r) => [r.key, r.value]));
  if (Number(meta.schema_version) !== STATS_SCHEMA_VERSION) throw new Error(`${path} has stats schema ${meta.schema_version}, this code reads ${STATS_SCHEMA_VERSION}`);
  if (catalogPath && meta.catalog_stamp !== catalogStamp(catalogPath)) throw new Error(`${path} was built from another state of ${catalogPath}; rebuild it`);
  const memo = <K, V>(f: (k: K) => V) => {
    const m = new Map<K, V>();
    return (k: K) => {
      if (!m.has(k)) m.set(k, f(k));
      return m.get(k)!;
    };
  };
  const qTitle = db.prepare("SELECT works, books, editions FROM title_totals WHERE norm = ?");
  const qBook = db.prepare("SELECT editions FROM title_books WHERE norm = ? AND surname = ?");
  const qWord = db.prepare("SELECT works, pub_works FROM words WHERE token = ?");
  const qAuthor = db.prepare("SELECT works FROM author_works WHERE norm = ?");
  return {
    works: Number(meta.works),
    books: Number(meta.books),
    title: memo((norm: string) => (qTitle.get(norm) as { works: number; books: number; editions: number } | undefined) ?? { works: 0, books: 0, editions: 0 }),
    bookEditions: (norm, surname) => (qBook.get(norm, surname) as { editions: number } | undefined)?.editions ?? 0,
    word: memo((t: string) => {
      const r = qWord.get(t) as { works: number; pub_works: number } | undefined;
      return { works: r?.works ?? 0, pubWorks: r?.pub_works ?? 0 };
    }),
    authorWorks: memo((norm: string) => (qAuthor.get(norm) as { works: number } | undefined)?.works ?? 0),
    close: () => db.close(),
  };
}

// ---------------------------------------------------------------------------------------------
// Evidence on one confirmed candidate
// ---------------------------------------------------------------------------------------------

/** What the catalog's statistics say about one reader's top candidate: new fields beside `retrieve`'s scores. */
export interface RarityEvidence {
  /** The title form the candidate matched with, and its kind (`retrieve`'s `formKind`). */
  form: string;
  formKind: string | null;
  /** Works, distinct books (title plus primary surname) and editions holding that form. */
  titleWorks: number;
  titleBooks: number;
  titleEditions: number;
  /** Editions of the candidate's own book under that form (0 when the form is only its subtitle). */
  bookEditions: number;
  /** Namesake share: bookEditions / (all editions holding the form, the candidate's book included). */
  share: number;
  /** Rarity-weighted title evidence: title evidence x log2(catalog works / works holding the form), in bits. */
  titleBits: number;
  author: number;
  series: number;
  /** Works under the matched author form (null without author evidence). */
  authorWorks: number | null;
  /** Read words the candidate leaves unexplained that count (`countsAgainst`), and the fewest works any of them occurs in. */
  unexplainedWords: number;
  rarestUnexplained: number | null;
  /** A different book in the reader's candidates has a surname read from words this candidate leaves unexplained. */
  rivalAuthor: boolean;
  /** The reading's language from its function words (null: none, or mixed), and the candidate work's. */
  readingLanguage: string | null;
  candidateLanguage: string | null;
}

export type CounterKind = "namesake" | "unexplained" | "author" | "language";
export const COUNTER_KINDS: readonly CounterKind[] = ["namesake", "unexplained", "author", "language"];

const evidenceOf = (c: Candidate, field: FieldEvidence["field"]) => c.evidence.find((e) => e.field === field);
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** The read words a candidate's evidence uses (a joined unit explains each word inside it). */
function explainedBy(c: Candidate): (token: string) => boolean {
  const queries = c.evidence.flatMap((e) => e.matches.map((m) => m.query));
  return (t) => queries.some((q) => q === t || q.includes(t));
}

/** An unexplained read word that can count against a work: long enough, a real catalog word, not an imprint word. */
export function countsAgainst(token: string, stats: Pick<CatalogStats, "word">): boolean {
  if (token.length < RARITY.wordMinLength || /\d/.test(token) || STOPWORDS.has(token) || FUNCTION_WORDS.has(token)) return false;
  const w = stats.word(token);
  // An imprint word (publisher strings carry it on at least as many works as titles, authors and series do) is the
  // edition's, not the book's: spines print it, and no title has to explain it.
  return w.works >= RARITY.wordMinWorks && w.pubWorks < w.works;
}

/** The reading's language: the one language whose exclusive function words it holds beyond the candidate's own title. */
export function readingLanguage(tokens: readonly string[], titleTokens: ReadonlySet<string> = new Set()): string | null {
  const langs = new Set<string>();
  for (const t of tokens) {
    const l = LANGUAGE_OF.get(t);
    if (l && !titleTokens.has(t)) langs.add(l);
  }
  return langs.size === 1 ? [...langs][0]! : null;
}

/** The catalog side the evidence needs beyond the sidecar: each work's language and title forms (same-book test). */
export interface RarityBasis {
  stats: CatalogStats;
  language: (workId: string) => string | null;
  forms: TitleForms;
}

export function rarityBasis(db: DatabaseSync, stats: CatalogStats): RarityBasis {
  const lang = new Map<string, string | null>();
  const get = db.prepare("SELECT language FROM works WHERE id = ?");
  return {
    stats,
    language: (id) => {
      if (!lang.has(id)) lang.set(id, (get.get(id) as { language: string | null } | undefined)?.language ?? null);
      return lang.get(id)!;
    },
    forms: lookalikeGuard(db, []).forms,
  };
}

/**
 * The evidence for `c`, the top candidate of one reader's `ranked` candidates on `variants` (`retrieve`'s input; the
 * candidate's `variant` says which one scored it).
 */
export function rarityEvidence(basis: RarityBasis, c: Candidate, ranked: readonly Candidate[], variants: readonly string[]): RarityEvidence {
  const { stats } = basis;
  const title = evidenceOf(c, "title");
  const form = title?.form ?? "";
  const totals = stats.title(form);
  const own = stats.bookEditions(form, primarySurname(c.authors));
  // A candidate that matched a subtitle-only form is not among the form's holders; it still competes with them.
  const mass = totals.editions + (own > 0 ? 0 : Math.max(1, c.editionCount));
  const author = evidenceOf(c, "author");
  const tokens = tokenize(normalize(variants[c.variant] ?? variants[0] ?? ""));
  const explained = explainedBy(c);
  const against = tokens.filter((t) => !explained(t) && countsAgainst(t, stats));
  const counts = against.map((t) => stats.word(t).works);

  let rivalAuthor = false;
  if ((author?.score ?? 0) < RARITY.secondAuthor) {
    for (const r of ranked.slice(0, RARITY.depth)) {
      if (r.workId === c.workId) continue;
      const ra = evidenceOf(r, "author");
      if (!ra || ra.score < RARITY.secondAuthor || sameBook(c, r, basis.forms)) continue;
      const words = ra.matches.filter((m) => m.how !== "initial").map((m) => m.query);
      // The rival's name must come from words this candidate leaves unexplained, and not only from imprint words.
      if (words.length > 0 && !words.some(explained) && words.some((q) => q.split(" ").some((t) => stats.word(t).pubWorks < stats.word(t).works))) {
        rivalAuthor = true;
        break;
      }
    }
  }

  return {
    form,
    formKind: title?.formKind ?? null,
    titleWorks: totals.works,
    titleBooks: totals.books,
    titleEditions: totals.editions,
    bookEditions: own,
    share: r3(own > 0 ? own / mass : Math.max(1, c.editionCount) / mass),
    titleBits: r3((title?.score ?? 0) * Math.log2(Math.max(1, stats.works) / Math.max(1, totals.works))),
    author: author?.score ?? 0,
    series: evidenceOf(c, "series")?.score ?? 0,
    authorWorks: author ? stats.authorWorks(author.form) : null,
    unexplainedWords: against.length,
    rarestUnexplained: counts.length ? Math.min(...counts) : null,
    rivalAuthor,
    readingLanguage: readingLanguage(tokens, new Set(tokenize(form))),
    candidateLanguage: basis.language(c.workId),
  };
}

/** Which counter-evidence holds against the candidate (each kind on its own). */
export function counterEvidence(e: RarityEvidence): Record<CounterKind, boolean> {
  const pinned = e.author >= RARITY.secondAuthor || e.series >= RARITY.secondSeries;
  const ownForm = e.formKind === null || e.formKind === "title" || e.formKind === "main" || e.formKind === "subtitle";
  return {
    // The title alone does not pick this book among the books holding it (or it matched only a subtitle).
    namesake: !pinned && (e.bookEditions === 0 || e.share <= RARITY.shareMin),
    // The reading holds a word rarer in the catalog than the title it matched, and the candidate does not explain it.
    unexplained: e.rarestUnexplained !== null && e.rarestUnexplained < e.titleWorks,
    // The reading names another author (only when the candidate's own author was not read).
    author: e.rivalAuthor,
    // A reading in another language matched an English work's own title: another language's edition is another book
    // here (Open Library's breadth layer is English editions; ISFDB records translations as variant titles).
    language: ownForm && e.readingLanguage !== null && e.readingLanguage !== "English" && e.candidateLanguage === "English",
  };
}

/** The first counter-evidence among `kinds` that withdraws the confirmation, or null. */
export function counterWhy(e: RarityEvidence, kinds: Iterable<CounterKind> = COUNTER_KINDS): CounterKind | null {
  const ce = counterEvidence(e);
  for (const k of kinds) if (ce[k]) return k;
  return null;
}

/** The basis on one confirmed candidate: null when nothing counts against it. */
export function counterCheck(basis: RarityBasis, c: Candidate, ranked: readonly Candidate[], variants: readonly string[], kinds: Iterable<CounterKind> = COUNTER_KINDS): CounterKind | null {
  return counterWhy(rarityEvidence(basis, c, ranked, variants), kinds);
}
