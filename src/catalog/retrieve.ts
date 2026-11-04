// Fragment retrieval over catalog.sqlite (C-3).
//
//   retrieve(db, variants, k) -> candidates with per-field match evidence
//
// A *variant* is one reading of a whole spine (P-1 emits several: rotations, language correction on or
// off); all the text of one spine goes into one variant, in any order. Retrieval never forces a match:
// it returns what the catalog holds that the fragments could mean, with scores that say how well, and
// the caller (I-1) appends `unknown`. A weak candidate has a low score; nothing here applies a threshold.
//
// Two stages. (1) Candidate generation. By default C-3's: per variant, one FTS5 trigram OR-query per index
// over the tokens, their skeletons, halves of long words, 0/O readings and joins, the best 250 forms by
// bm25, plus the whole variant as an exact title. With `generation: "c8"` (opt-in: its keep rule failed,
// evals/C8/report.md), once over all the variants' text: every run of read tokens as an exact title first,
// then one small trigram query per read token, rarest first by the catalog's df (C-7's sidecar), until each
// index has given `ftsLimit` forms. (2) Scoring in code, per variant and field, against the normalised
// forms: exact, prefix (truncation), substring (cropping), skeleton (rn/m, vv/w, cl/d), and edit distance
// 1-2 (2 for long words), with initials and "Surname, Given" order handled by token-level matching, so
// field order never matters.
import { existsSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { confusableReadings, editDistance, normalize, skeleton, STOPWORDS, tokenize } from "./normalize.ts";
import { openStats, statsPathFor } from "./rarity.ts";

export type MatchHow = "exact" | "skeleton" | "prefix" | "substring" | "fuzzy" | "initial";

export interface TokenMatch {
  /** The OCR token (or joined/alternative reading) that matched. */
  query: string;
  /** The catalog token it matched. */
  field: string;
  how: MatchHow;
  /** 0..1 */
  score: number;
}

export interface FieldEvidence {
  /** Which catalog field. Maps to the contracts' Evidence kinds: title-fragment, author-fragment, series. */
  field: "title" | "author" | "series";
  /** 0..1: how well the best form of the field is explained by the fragments. */
  score: number;
  /** The normalised form that matched best. */
  form: string;
  /** For title: which form of the title (title, main, subtitle, variant, ...). */
  formKind?: string;
  matches: TokenMatch[];
}

export interface Candidate {
  workId: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  series: string | null;
  seriesNum: string | null;
  year: number | null;
  ttype: string;
  editionCount: number;
  /** 0..1 evidence score; not a probability. */
  score: number;
  /** Share of the fragments' (weighted) tokens that some field explains. */
  queryCoverage: number;
  /** Index into `variants` of the reading that gave the best score. */
  variant: number;
  evidence: FieldEvidence[];
}

export interface RetrieveOptions {
  /** Forms each FTS index (title, author, series) may give before scoring: the pool (default 250). */
  ftsLimit?: number;
  /** Most works taken from one matched author or series (default 400). */
  expandLimit?: number;
  /** Forms one token's trigram query may add to a pool (default `GENERATION.perToken`). */
  perToken?: number;
  /**
   * Other readings of the same spine (other readers' text) whose tokens may generate candidates too. They are
   * never scored against: every candidate is scored on `variants` alone, so a reader's vote stays its own (INV-6).
   */
  generateFrom?: string[];
  /** Catalog df of a token; default the statistics sidecar beside the catalog file (`catalogDf`). */
  df?: ((token: string) => number) | null;
  /**
   * Candidate generation: `c3` (default), C-3's one OR-query per index and variant; `c8`, rare words first. C-8's keep
   * rule failed on yardstick candidate recall on v2 (evals/C8/report.md), so `c8` is opt-in. `perToken`, `df` and
   * `generateFrom` apply to `c8` only.
   */
  generation?: "c3" | "c8";
}

// ---------------------------------------------------------------------------------------------
// Tunable weights. Everything that shapes ranking is in this block; docs/catalog.md lists the history.
// ---------------------------------------------------------------------------------------------
export const WEIGHTS = {
  /** Noisy-or weights: how much a perfect match in the field alone is worth. */
  title: 0.85,
  author: 0.55,
  series: 0.45,
  /** The final score is multiplied by (floor + (1 - floor) * queryCoverage). */
  coverageFloor: 0.55,
  /** Forms scoring under this are not used to pull works in. */
  minFormScore: 0.25,
  /** Within author scoring: the surname's share; the rest is the given names and initials. */
  surnameShare: 0.7,
  /**
   * A title form that is only part of the recorded title is worth less than the whole: a spine that says
   * only "DUNE" is better explained by the novel "Dune" than by "Chapterhouse: Dune". Keys are TITLE_KIND codes.
   */
  formKind: { T: 1, M: 0.95, S: 0.85, V: 0.97, W: 0.92, X: 0.8 } as Record<string, number>,
} as const;

/** Candidate generation (C-8). Fixed before C-8's measured runs (evals/C8/report.md); docs/catalog.md lists the history. */
export const GENERATION = {
  /** Forms one token's trigram query may add to a pool of `ftsLimit`. */
  perToken: 40,
  /** Works taken from one exact title lookup, most editions first. */
  exactPerSpan: 50,
  /** Longest run of read tokens looked up as an exact title. */
  maxSpan: 10,
  /** A token at least this long that the catalog does not hold as a word is also searched by its halves. */
  halveFrom: 7,
  /** The rarest catalog words in the reading queried together first, and the forms that query may add. */
  cooccurWords: 4,
  cooccur: 60,
} as const;

const KIND_NAME: Record<string, string> = { T: "title", M: "main", S: "subtitle", V: "variant", W: "variant-main", X: "variant-subtitle" };

interface Unit {
  /** The text compared with catalog tokens. */
  text: string;
  /** Indices of the OCR tokens this unit reads. */
  covers: number[];
  /** True when a joined or alternative reading, not one OCR token as it stands. */
  derived: boolean;
}

function tokenWeight(t: string): number {
  return (STOPWORDS.has(t) ? 0.25 : 1) * (t.length === 1 ? 0.4 : 1);
}

function similarity(u: string, f: string): { how: MatchHow; score: number } | null {
  if (u === f) return { how: "exact", score: 1 };
  if (u.length === 1 || f.length === 1) {
    // One side is an initial: it matches a word beginning with that letter.
    const [short, long] = u.length === 1 ? [u, f] : [f, u];
    return long.length > 1 && long.startsWith(short) ? { how: "initial", score: 0.5 } : null;
  }
  if (skeleton(u) === skeleton(f)) return { how: "skeleton", score: 0.9 };
  if (u.length >= 3 && f.length > u.length && f.startsWith(u)) return { how: "prefix", score: 0.55 + 0.4 * (u.length / f.length) };
  if (u.length >= 4 && f.length > u.length && f.includes(u)) return { how: "substring", score: 0.45 + 0.3 * (u.length / f.length) };
  if (f.length >= 4 && u.length >= 3) {
    const max = f.length >= 9 ? 2 : 1;
    const d = editDistance(u, f, max);
    if (d <= max) return { how: "fuzzy", score: 0.85 * (1 - d / f.length) };
  }
  return null;
}

interface FieldMatch {
  /** Weighted share of the field's tokens explained. */
  cover: number;
  matches: TokenMatch[];
  /** Per field token (not extras): best match score. */
  perToken: number[];
  /** OCR token index -> best match score, for the coverage of the query. */
  queryCovered: Map<number, number>;
  fieldTokens: string[];
}

/**
 * Matches the OCR units against one normalised catalog form. Greedy: the best (similarity x weight)
 * pairs first; a unit and the catalog tokens it reads are used once.
 */
function matchForm(units: Unit[], form: string): FieldMatch {
  const base = tokenize(form);
  // Catalog units: each base token, plus the joined form of every run of single letters ("j r r" -> "jrr").
  const fUnits: Array<{ text: string; covers: number[] }> = base.map((t, i) => ({ text: t, covers: [i] }));
  let run: number[] = [];
  for (let i = 0; i <= base.length; i++) {
    const t = base[i];
    if (t !== undefined && t.length === 1 && /\p{L}/u.test(t)) {
      run.push(i);
    } else {
      if (run.length >= 2) fUnits.push({ text: run.map((j) => base[j]).join(""), covers: run });
      run = [];
    }
  }
  const totalWeight = base.reduce((s, t) => s + tokenWeight(t), 0) || 1;

  interface Pair { u: number; f: number; how: MatchHow; score: number; gain: number }
  const pairs: Pair[] = [];
  units.forEach((u, ui) => {
    fUnits.forEach((f, fi) => {
      const s = similarity(u.text, f.text);
      if (!s) return;
      const weight = f.covers.reduce((a, j) => a + tokenWeight(base[j]!), 0);
      pairs.push({ u: ui, f: fi, how: s.how, score: s.score, gain: s.score * weight });
    });
  });
  pairs.sort((a, b) => b.gain - a.gain);

  const usedQ = new Set<number>();
  const usedF = new Set<number>();
  const perToken: number[] = new Array(base.length).fill(0);
  const queryCovered = new Map<number, number>();
  const matches: TokenMatch[] = [];
  for (const p of pairs) {
    const u = units[p.u]!;
    const f = fUnits[p.f]!;
    if (u.covers.some((i) => usedQ.has(i)) || f.covers.some((j) => usedF.has(j))) continue;
    u.covers.forEach((i) => usedQ.add(i));
    f.covers.forEach((j) => {
      usedF.add(j);
      perToken[j] = p.score;
    });
    u.covers.forEach((i) => queryCovered.set(i, Math.max(queryCovered.get(i) ?? 0, p.score)));
    matches.push({ query: u.text, field: f.text, how: p.how, score: Math.round(p.score * 1000) / 1000 });
  }
  const explained = base.reduce((s, t, j) => s + tokenWeight(t) * perToken[j]!, 0);
  return { cover: explained / totalWeight, matches, perToken, queryCovered, fieldTokens: base };
}

/** Author score: the surname (last token) carries `surnameShare`; the given names and initials the rest. */
function authorScore(fm: FieldMatch): number {
  const n = fm.fieldTokens.length;
  if (n === 0) return 0;
  const surname = fm.perToken[n - 1] ?? 0;
  if (n === 1) return surname;
  let gw = 0;
  let ge = 0;
  for (let j = 0; j < n - 1; j++) {
    const w = tokenWeight(fm.fieldTokens[j]!);
    gw += w;
    ge += w * fm.perToken[j]!;
  }
  const given = gw > 0 ? ge / gw : 1;
  return WEIGHTS.surnameShare * surname + (1 - WEIGHTS.surnameShare) * given;
}

/** The OCR units for one variant: tokens, joined initials, adjacent joins (split words), 0/O-style readings. */
function buildUnits(tokens: string[]): Unit[] {
  const units: Unit[] = [];
  tokens.forEach((t, i) => {
    units.push({ text: t, covers: [i], derived: false });
    for (const alt of confusableReadings(t)) units.push({ text: alt, covers: [i], derived: true });
  });
  // Joined initials: a run of single letters ("j r r") reads as "jrr" too.
  let run: number[] = [];
  const flush = () => {
    if (run.length >= 2) units.push({ text: run.map((i) => tokens[i]).join(""), covers: [...run], derived: true });
    run = [];
  };
  tokens.forEach((t, i) => {
    if (t.length === 1 && /\p{L}/u.test(t)) run.push(i);
    else flush();
  });
  flush();
  // Adjacent joins: "neuro mancer" reads as "neuromancer". Up to three tokens, only when the result is long
  // enough to mean something.
  for (let i = 0; i < tokens.length; i++) {
    let joined = tokens[i]!;
    for (let j = i + 1; j < Math.min(tokens.length, i + 3); j++) {
      joined += tokens[j]!;
      if (joined.length >= 5) {
        const covers = [];
        for (let x = i; x <= j; x++) covers.push(x);
        units.push({ text: joined, covers, derived: true });
        for (const alt of confusableReadings(joined)) units.push({ text: alt, covers, derived: true });
      }
    }
  }
  return units;
}

const PHRASE = /^[\p{L}\p{N}]+$/u;

/** One read token's trigram query: its phrases, and how common the token is in the catalog. */
export interface TokenQuery {
  token: string;
  /** Works carrying the token as a word (C-7's df); 0 when the catalog has no such word (often a misread). */
  df: number;
  phrases: string[];
}

/**
 * The trigram queries for a set of units, rarest token first (df, then the longer token, then the token). No phrase
 * under 3 characters: the trigram index cannot match it, and a stopword never generates. A token the catalog holds as
 * a word is searched as it stands (and by its skeleton); only an unknown read token of `halveFrom` letters or more is
 * searched by its halves too, because a half is a substring that thousands of unrelated forms share ("tion").
 */
function tokenQueries(units: Unit[], df: ((t: string) => number) | null): TokenQuery[] {
  const byToken = new Map<string, TokenQuery>();
  for (const u of units) {
    if (u.covers.length === 1 && !u.derived && STOPWORDS.has(u.text)) continue;
    if (byToken.has(u.text) || u.text.length < 3 || STOPWORDS.has(u.text) || !PHRASE.test(u.text)) continue;
    const d = df ? df(u.text) : 0;
    // A join ("neuro mancer") or an alternative reading ("sn0w" as "snow") is a guess about the read text: it
    // generates only when the catalog holds it as a word. A long phrase that matches nothing still costs its
    // trigrams' lists.
    if (u.derived && df && d === 0) continue;
    const phrases = new Set([u.text]);
    const sk = skeleton(u.text); // "neurornancer" is searched as "neuromancer" too
    if (sk.length >= 3 && PHRASE.test(sk)) phrases.add(sk);
    // One wrong character in a long word still leaves its other half intact (one read token, not a join).
    if (d === 0 && u.covers.length === 1 && u.text.length >= GENERATION.halveFrom) {
      const mid = Math.ceil(u.text.length / 2);
      phrases.add(u.text.slice(0, mid));
      phrases.add(u.text.slice(mid - 1));
    }
    byToken.set(u.text, { token: u.text, df: d, phrases: [...phrases] });
  }
  // Without a df table, the longer token is taken as the rarer.
  return [...byToken.values()].sort((a, b) => a.df - b.df || b.token.length - a.token.length || (a.token < b.token ? -1 : a.token > b.token ? 1 : 0));
}

/** The trigram queries retrieval would issue for these readings, in order (for tests and C-8's report). */
export function tokenQueriesFor(readings: string[], df: ((t: string) => number) | null): TokenQuery[] {
  return tokenQueries(readings.flatMap((r) => buildUnits(tokenize(normalize(r)))), df);
}

const matchExpr = (phrases: string[]) => phrases.map((p) => `"${p}"`).join(" OR ");

/** Every run of up to `maxSpan` read tokens, as an exact title: "ubik philip k dick" holds "ubik". */
function exactSpans(tokens: string[]): string[] {
  const out = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 1; j <= Math.min(tokens.length, i + GENERATION.maxSpan); j++) {
      if (j === i + 1 && STOPWORDS.has(tokens[i]!)) continue;
      out.add(tokens.slice(i, j).join(" "));
    }
  }
  return [...out];
}

interface Prepared {
  exact: ReturnType<DatabaseSync["prepare"]>;
  c3Exact: ReturnType<DatabaseSync["prepare"]>;
  ftsTitle: ReturnType<DatabaseSync["prepare"]>;
  ftsAuthor: ReturnType<DatabaseSync["prepare"]>;
  ftsSeries: ReturnType<DatabaseSync["prepare"]>;
  expandAuthor: ReturnType<DatabaseSync["prepare"]>;
  expandSeries: ReturnType<DatabaseSync["prepare"]>;
}

/** Every statement retrieval runs, by name (the query-plan test checks none scans a table). */
export const RETRIEVE_SQL = {
  exact: "SELECT tf.work_id AS work_id FROM title_forms tf JOIN works w ON w.id = tf.work_id WHERE tf.norm = ? ORDER BY w.edition_count DESC LIMIT ?",
  c3Exact: "SELECT work_id FROM title_forms WHERE norm = ? LIMIT 50",
  ftsTitle: "SELECT f.rowid AS id, tf.work_id AS work_id, tf.norm AS norm FROM fts_title f JOIN title_forms tf ON tf.id = f.rowid WHERE fts_title MATCH ? ORDER BY f.rank LIMIT ?",
  ftsAuthor: "SELECT f.rowid AS id, af.author_id AS author_id, af.norm AS norm FROM fts_author f JOIN author_forms af ON af.id = f.rowid WHERE fts_author MATCH ? ORDER BY f.rank LIMIT ?",
  ftsSeries: "SELECT f.rowid AS id, sf.series_id AS series_id, sf.norm AS norm FROM fts_series f JOIN series_forms sf ON sf.id = f.rowid WHERE fts_series MATCH ? ORDER BY f.rank LIMIT ?",
  expandAuthor: "SELECT wa.work_id AS work_id FROM work_authors wa JOIN works w ON w.id = wa.work_id WHERE wa.author_id = ? ORDER BY w.edition_count DESC LIMIT ?",
  expandSeries: "SELECT ws.work_id AS work_id FROM work_series ws JOIN works w ON w.id = ws.work_id WHERE ws.series_id = ? ORDER BY w.edition_count DESC LIMIT ?",
} as const;

const preparedCache = new WeakMap<DatabaseSync, Prepared>();
function prepared(db: DatabaseSync): Prepared {
  let p = preparedCache.get(db);
  if (!p) {
    p = Object.fromEntries(Object.entries(RETRIEVE_SQL).map(([k, sql]) => [k, db.prepare(sql)])) as unknown as Prepared;
    preparedCache.set(db, p);
  }
  return p;
}

const dfCache = new WeakMap<DatabaseSync, ((t: string) => number) | null>();
/**
 * The catalog df of a token, from the statistics sidecar beside the catalog file (`bookcase catalog stats`, C-7):
 * works carrying the token in a title, author or series form. Null when the catalog has no sidecar, or one built from
 * another state of the file (a warning, once): retrieval then takes the longer token as the rarer.
 */
export function catalogDf(db: DatabaseSync): ((t: string) => number) | null {
  if (dfCache.has(db)) return dfCache.get(db)!;
  let df: ((t: string) => number) | null = null;
  const path = db.location();
  if (path && existsSync(statsPathFor(path))) {
    try {
      const stats = openStats(statsPathFor(path), path);
      df = (t) => stats.word(t).works;
    } catch (e) {
      console.error(`retrieve: ${(e as Error).message}; ordering tokens by length`);
    }
  }
  dfCache.set(db, df);
  return df;
}

/**
 * Fills one index's pool of `limit` forms: first the forms holding several of the rarest catalog words (one query,
 * `cooccur` forms at most), then each token's query, rarest first, adding up to `perToken` forms not already in the
 * pool, until it is full. Common words are reached only if the rarer ones leave room.
 */
function fillPool<R extends { id: number }>(stmt: ReturnType<DatabaseSync["prepare"]>, queries: TokenQuery[], limit: number, perToken: number): R[] {
  const pool = new Map<number, R>();
  if (limit <= 0) return [];
  const add = (expr: string, cap: number) => {
    let added = 0;
    for (const r of stmt.all(expr, cap + pool.size) as unknown as R[]) {
      if (pool.has(r.id)) continue;
      pool.set(r.id, r);
      if (++added >= cap || pool.size >= limit) break;
    }
  };
  // Ranked by one word alone, the shortest forms holding it win; a two-word title or a given name plus surname needs
  // its words together. One query over the rarest words' short lists finds those; the commoner lists are not read.
  const words = queries.filter((q) => q.df > 0).slice(0, GENERATION.cooccurWords);
  if (words.length >= 2) add(matchExpr(words.map((q) => q.token)), Math.min(limit, GENERATION.cooccur));
  for (const q of queries) {
    if (pool.size >= limit) break;
    add(matchExpr(q.phrases), Math.min(perToken, limit - pool.size));
  }
  return [...pool.values()];
}

interface WorkRow {
  id: string;
  title: string;
  subtitle: string | null;
  authors: string;
  series: string | null;
  series_num: string | null;
  year: number | null;
  ttype: string;
  edition_count: number;
  title_norm: string;
  author_norm: string;
  series_norm: string;
}

interface Scored {
  work: WorkRow;
  score: number;
  coverage: number;
  evidence: FieldEvidence[];
}

interface BestForm { form: string; kind?: string; fm: FieldMatch; score: number }

/** `forms` entries are plain normalised text, or 'K:text' when `kinded` (title forms). */
function bestForm(units: Unit[], forms: string[], measure: (fm: FieldMatch) => number, kinded = false): BestForm | null {
  let best: BestForm | null = null;
  for (const entry of forms) {
    if (entry === "") continue;
    const kind = kinded ? entry[0] : undefined;
    const form = kinded ? entry.slice(2) : entry;
    const fm = matchForm(units, form);
    const score = measure(fm) * (kind ? (WEIGHTS.formKind[kind] ?? 1) : 1);
    if (!best || score > best.score) best = { form, ...(kind ? { kind } : {}), fm, score };
  }
  return best && best.score > 0 ? best : null;
}

function scoreWork(w: WorkRow, units: Unit[], tokens: string[]): Scored {
  const titleBest = bestForm(units, w.title_norm.split("|"), (fm) => fm.cover, true);
  const authorBest = bestForm(units, w.author_norm === "" ? [] : w.author_norm.split("|"), authorScore);
  const seriesBest = bestForm(units, w.series_norm === "" ? [] : w.series_norm.split("|"), (fm) => fm.cover);

  const evidence: FieldEvidence[] = [];
  const covered = new Map<number, number>();
  const take = (field: FieldEvidence["field"], b: BestForm | null) => {
    if (!b) return 0;
    evidence.push({ field, score: Math.round(b.score * 1000) / 1000, form: b.form, ...(b.kind ? { formKind: KIND_NAME[b.kind] } : {}), matches: b.fm.matches });
    for (const [i, s] of b.fm.queryCovered) covered.set(i, Math.max(covered.get(i) ?? 0, s));
    return b.score;
  };
  const t = take("title", titleBest);
  const a = take("author", authorBest);
  const s = take("series", seriesBest);

  const qWeight = tokens.reduce((x, tok) => x + tokenWeight(tok), 0) || 1;
  const qCovered = tokens.reduce((x, tok, i) => x + tokenWeight(tok) * (covered.get(i) ?? 0), 0);
  const coverage = Math.min(1, qCovered / qWeight);
  const noisyOr = 1 - (1 - WEIGHTS.title * t) * (1 - WEIGHTS.author * a) * (1 - WEIGHTS.series * s);
  const score = noisyOr * (WEIGHTS.coverageFloor + (1 - WEIGHTS.coverageFloor) * coverage);
  return { work: w, score, coverage, evidence };
}

const WORK_COLS = "id, title, subtitle, authors, series, series_num, year, ttype, edition_count, title_norm, author_norm, series_norm";

function fetchWorks(db: DatabaseSync, ids: string[]): WorkRow[] {
  const out: WorkRow[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = db.prepare(`SELECT ${WORK_COLS} FROM works WHERE id IN (${chunk.map(() => "?").join(",")})`).all(...chunk) as unknown as WorkRow[];
    out.push(...rows);
  }
  return out;
}

/** C-3: FTS5 phrases for one variant. */
function c3Phrases(units: Unit[]): string[] {
  const seen = new Set<string>();
  const add = (p: string) => {
    if (p.length >= 3 && !STOPWORDS.has(p) && /^[\p{L}\p{N}]+$/u.test(p)) seen.add(p);
  };
  for (const u of units) {
    if (u.covers.length === 1 && !u.derived && STOPWORDS.has(u.text)) continue;
    add(u.text);
    add(skeleton(u.text)); // "neurornancer" is searched as "neuromancer" too
    // One wrong character in a long word still leaves its other half intact.
    if (u.text.length >= 7) {
      const mid = Math.ceil(u.text.length / 2);
      add(u.text.slice(0, mid));
      add(u.text.slice(mid - 1));
    }
  }
  return [...seen];
}

/** C-3: generation and scoring for one variant (one OR-query per index over all its phrases, the best 250 forms). */
function c3One(db: DatabaseSync, variant: string, opts: { ftsLimit: number; expandLimit: number }): Scored[] {
  const tokens = tokenize(normalize(variant));
  if (tokens.length === 0) return [];
  const units = buildUnits(tokens);
  const phrases = c3Phrases(units);
  const p = prepared(db);
  const candidates = new Set<string>();

  // The whole normalised variant as a title is always tried exactly: short titles ("It") have no trigram.
  const whole = tokens.join(" ");
  for (const r of p.c3Exact.all(whole) as Array<{ work_id: string }>) candidates.add(r.work_id);

  if (phrases.length > 0) {
    const expr = matchExpr(phrases);
    for (const r of p.ftsTitle.all(expr, opts.ftsLimit) as Array<{ work_id: string; norm: string }>) {
      if (matchForm(units, r.norm).cover >= WEIGHTS.minFormScore) candidates.add(r.work_id);
    }
    const authorIds: Array<{ id: number; score: number }> = [];
    for (const r of p.ftsAuthor.all(expr, opts.ftsLimit) as Array<{ author_id: number; norm: string }>) {
      const s = authorScore(matchForm(units, r.norm));
      if (s >= WEIGHTS.minFormScore) authorIds.push({ id: r.author_id, score: s });
    }
    authorIds.sort((a, b) => b.score - a.score);
    for (const a of authorIds.slice(0, 12)) for (const r of p.expandAuthor.all(a.id, opts.expandLimit) as Array<{ work_id: string }>) candidates.add(r.work_id);

    const seriesIds: Array<{ id: number; score: number }> = [];
    for (const r of p.ftsSeries.all(expr, opts.ftsLimit) as Array<{ series_id: number; norm: string }>) {
      const s = matchForm(units, r.norm).cover;
      if (s >= WEIGHTS.minFormScore) seriesIds.push({ id: r.series_id, score: s });
    }
    seriesIds.sort((a, b) => b.score - a.score);
    for (const s of seriesIds.slice(0, 8)) for (const r of p.expandSeries.all(s.id, opts.expandLimit) as Array<{ work_id: string }>) candidates.add(r.work_id);
  }
  if (candidates.size === 0) return [];

  const works = fetchWorks(db, [...candidates]);
  return works.map((w) => scoreWork(w, units, tokens));
}

/** Candidate works for a set of readings (generation only; nothing is scored against `generateFrom`). */
function generate(db: DatabaseSync, readings: string[], opts: { ftsLimit: number; expandLimit: number; perToken: number; df: ((t: string) => number) | null }): Set<string> {
  const p = prepared(db);
  const candidates = new Set<string>();
  const units: Unit[] = [];
  const spans = new Set<string>();
  for (const text of readings) {
    const tokens = tokenize(normalize(text));
    if (tokens.length === 0) continue;
    units.push(...buildUnits(tokens));
    for (const s of exactSpans(tokens)) spans.add(s);
  }
  // Exact titles first: a clean read is an index lookup, and short titles ("It") have no trigram.
  for (const s of spans) for (const r of p.exact.all(s, GENERATION.exactPerSpan) as Array<{ work_id: string }>) candidates.add(r.work_id);

  const queries = tokenQueries(units, opts.df);
  if (queries.length === 0) return candidates;
  for (const r of fillPool<{ id: number; work_id: string; norm: string }>(p.ftsTitle, queries, opts.ftsLimit, opts.perToken)) {
    if (matchForm(units, r.norm).cover >= WEIGHTS.minFormScore) candidates.add(r.work_id);
  }
  const authorIds: Array<{ id: number; score: number }> = [];
  for (const r of fillPool<{ id: number; author_id: number; norm: string }>(p.ftsAuthor, queries, opts.ftsLimit, opts.perToken)) {
    const s = authorScore(matchForm(units, r.norm));
    if (s >= WEIGHTS.minFormScore) authorIds.push({ id: r.author_id, score: s });
  }
  authorIds.sort((a, b) => b.score - a.score || a.id - b.id);
  const authors = [...new Set(authorIds.map((a) => a.id))].slice(0, 12);
  for (const a of authors) for (const r of p.expandAuthor.all(a, opts.expandLimit) as Array<{ work_id: string }>) candidates.add(r.work_id);

  const seriesIds: Array<{ id: number; score: number }> = [];
  for (const r of fillPool<{ id: number; series_id: number; norm: string }>(p.ftsSeries, queries, opts.ftsLimit, opts.perToken)) {
    const s = matchForm(units, r.norm).cover;
    if (s >= WEIGHTS.minFormScore) seriesIds.push({ id: r.series_id, score: s });
  }
  seriesIds.sort((a, b) => b.score - a.score || a.id - b.id);
  const series = [...new Set(seriesIds.map((s) => s.id))].slice(0, 8);
  for (const s of series) for (const r of p.expandSeries.all(s, opts.expandLimit) as Array<{ work_id: string }>) candidates.add(r.work_id);
  return candidates;
}

/**
 * Candidates for one spine. `variants` are alternative readings of the whole spine (all its text in one
 * string, any order). Returns at most `k` candidates, best first; a work found by several variants appears
 * once, with the evidence of the variant that scored it highest.
 */
export function retrieve(db: DatabaseSync, variants: string[], k = 10, options: RetrieveOptions = {}): Candidate[] {
  const best = new Map<string, Scored & { variant: number }>();
  const ftsLimit = options.ftsLimit ?? 250;
  const expandLimit = options.expandLimit ?? 400;
  if ((options.generation ?? "c3") === "c3") {
    variants.forEach((v, i) => {
      for (const s of c3One(db, v, { ftsLimit, expandLimit })) {
        const prev = best.get(s.work.id);
        if (!prev || s.score > prev.score) best.set(s.work.id, { ...s, variant: i });
      }
    });
    return rank(best, k);
  }
  const opts = { ftsLimit, expandLimit, perToken: options.perToken ?? GENERATION.perToken, df: options.df === undefined ? catalogDf(db) : options.df };
  const ids = generate(db, [...variants, ...(options.generateFrom ?? [])], opts);
  if (ids.size === 0) return [];
  const works = fetchWorks(db, [...ids]);
  variants.forEach((v, i) => {
    const tokens = tokenize(normalize(v));
    if (tokens.length === 0) return;
    const units = buildUnits(tokens);
    for (const w of works) {
      const s = scoreWork(w, units, tokens);
      if (s.score <= 0) continue;
      const prev = best.get(w.id);
      if (!prev || s.score > prev.score) best.set(w.id, { ...s, variant: i });
    }
  });
  return rank(best, k);
}

function rank(best: Map<string, Scored & { variant: number }>, k: number): Candidate[] {
  return [...best.values()]
    .filter((s) => s.score > 0)
    .sort((a, b) => Math.round(b.score * 100) - Math.round(a.score * 100) || b.work.edition_count - a.work.edition_count || b.score - a.score || (a.work.id < b.work.id ? -1 : 1))
    .slice(0, k)
    .map(toCandidate);
}

function toCandidate(s: Scored & { variant: number }): Candidate {
  return {
    workId: s.work.id,
    title: s.work.title,
    subtitle: s.work.subtitle,
    authors: JSON.parse(s.work.authors) as string[],
    series: s.work.series,
    seriesNum: s.work.series_num,
    year: s.work.year,
    ttype: s.work.ttype,
    editionCount: s.work.edition_count,
    score: Math.round(s.score * 1000) / 1000,
    queryCoverage: Math.round(s.coverage * 1000) / 1000,
    variant: s.variant,
    evidence: s.evidence,
  };
}

/**
 * Score named works against one spine's readings, with retrieval's own scoring and no candidate generation: how
 * well each work explains the text, whether or not retrieval would have ranked it (F-0g asks this of a copy's
 * reads for its neighbour's work). Works the catalog does not hold are absent; a work no variant explains at all
 * comes back with score 0.
 */
export function scoreWorks(db: DatabaseSync, variants: string[], workIds: string[]): Map<string, Candidate> {
  const works = fetchWorks(db, [...new Set(workIds)]);
  const best = new Map<string, Scored & { variant: number }>();
  variants.forEach((v, i) => {
    const tokens = tokenize(normalize(v));
    if (tokens.length === 0) return;
    const units = buildUnits(tokens);
    for (const w of works) {
      const s = scoreWork(w, units, tokens);
      const prev = best.get(w.id);
      if (!prev || s.score > prev.score) best.set(w.id, { ...s, variant: i });
    }
  });
  for (const w of works) if (!best.has(w.id)) best.set(w.id, { work: w, score: 0, coverage: 0, evidence: [], variant: -1 });
  return new Map([...best].map(([id, s]) => [id, toCandidate(s)]));
}
