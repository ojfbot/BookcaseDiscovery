// Fragment retrieval over catalog.sqlite (C-3).
//
//   retrieve(db, variants, k) -> candidates with per-field match evidence
//
// A *variant* is one reading of a whole spine (P-1 emits several: rotations, language correction on or
// off); all the text of one spine goes into one variant, in any order. Retrieval never forces a match:
// it returns what the catalog holds that the fragments could mean, with scores that say how well, and
// the caller (I-1) appends `unknown`. A weak candidate has a low score; nothing here applies a threshold.
//
// Two stages. (1) Candidate generation: FTS5 trigram queries over title, author and series forms, using
// the OCR tokens, their halves (so one wrong character in a long word still leaves a hit), 0/O-style
// readings and adjacent-token joins (split words). (2) Scoring in code, per field, against the
// normalised forms: exact, prefix (truncation), substring (cropping), skeleton (rn/m, vv/w, cl/d), and
// edit distance 1-2 (2 for long words), with initials and "Surname, Given" order handled by
// token-level matching, so field order never matters.
import type { DatabaseSync } from "node:sqlite";
import { confusableReadings, editDistance, normalize, skeleton, STOPWORDS, tokenize } from "./normalize.ts";

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
  /** Forms taken from each FTS query before scoring (default 250). */
  ftsLimit?: number;
  /** Most works taken from one matched author or series (default 400). */
  expandLimit?: number;
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

/** FTS5 phrases for one variant. */
function ftsPhrases(units: Unit[]): string[] {
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

const matchExpr = (phrases: string[]) => phrases.map((p) => `"${p}"`).join(" OR ");

interface Prepared {
  select: {
    ftsTitle: ReturnType<DatabaseSync["prepare"]>;
    ftsAuthor: ReturnType<DatabaseSync["prepare"]>;
    ftsSeries: ReturnType<DatabaseSync["prepare"]>;
  };
}
const preparedCache = new WeakMap<DatabaseSync, Prepared>();
function prepared(db: DatabaseSync): Prepared {
  let p = preparedCache.get(db);
  if (!p) {
    p = {
      select: {
        ftsTitle: db.prepare("SELECT tf.work_id AS work_id, tf.norm AS norm FROM fts_title f JOIN title_forms tf ON tf.id = f.rowid WHERE fts_title MATCH ? ORDER BY f.rank LIMIT ?"),
        ftsAuthor: db.prepare("SELECT af.author_id AS author_id, af.norm AS norm FROM fts_author f JOIN author_forms af ON af.id = f.rowid WHERE fts_author MATCH ? ORDER BY f.rank LIMIT ?"),
        ftsSeries: db.prepare("SELECT sf.series_id AS series_id, sf.norm AS norm FROM fts_series f JOIN series_forms sf ON sf.id = f.rowid WHERE fts_series MATCH ? ORDER BY f.rank LIMIT ?"),
      },
    };
    preparedCache.set(db, p);
  }
  return p;
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

function retrieveOne(db: DatabaseSync, variant: string, opts: Required<RetrieveOptions>): Scored[] {
  const tokens = tokenize(normalize(variant));
  if (tokens.length === 0) return [];
  const units = buildUnits(tokens);
  const phrases = ftsPhrases(units);
  const p = prepared(db).select;
  const candidates = new Set<string>();

  // The whole normalised variant as a title is always tried exactly: short titles ("It") have no trigram.
  const whole = tokens.join(" ");
  for (const r of db.prepare("SELECT work_id FROM title_forms WHERE norm = ? LIMIT 50").all(whole) as Array<{ work_id: string }>) candidates.add(r.work_id);

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
    const expandAuthor = db.prepare("SELECT wa.work_id FROM work_authors wa JOIN works w ON w.id = wa.work_id WHERE wa.author_id = ? ORDER BY w.edition_count DESC LIMIT ?");
    for (const a of authorIds.slice(0, 12)) for (const r of expandAuthor.all(a.id, opts.expandLimit) as Array<{ work_id: string }>) candidates.add(r.work_id);

    const seriesIds: Array<{ id: number; score: number }> = [];
    for (const r of p.ftsSeries.all(expr, opts.ftsLimit) as Array<{ series_id: number; norm: string }>) {
      const s = matchForm(units, r.norm).cover;
      if (s >= WEIGHTS.minFormScore) seriesIds.push({ id: r.series_id, score: s });
    }
    seriesIds.sort((a, b) => b.score - a.score);
    const expandSeries = db.prepare("SELECT ws.work_id FROM work_series ws JOIN works w ON w.id = ws.work_id WHERE ws.series_id = ? ORDER BY w.edition_count DESC LIMIT ?");
    for (const s of seriesIds.slice(0, 8)) for (const r of expandSeries.all(s.id, opts.expandLimit) as Array<{ work_id: string }>) candidates.add(r.work_id);
  }
  if (candidates.size === 0) return [];

  const works = fetchWorks(db, [...candidates]);
  return works.map((w) => scoreWork(w, units, tokens));
}

/**
 * Candidates for one spine. `variants` are alternative readings of the whole spine (all its text in one
 * string, any order). Returns at most `k` candidates, best first; a work found by several variants appears
 * once, with the evidence of the variant that scored it highest.
 */
export function retrieve(db: DatabaseSync, variants: string[], k = 10, options: RetrieveOptions = {}): Candidate[] {
  const opts: Required<RetrieveOptions> = { ftsLimit: options.ftsLimit ?? 250, expandLimit: options.expandLimit ?? 400 };
  const best = new Map<string, Scored & { variant: number }>();
  variants.forEach((v, i) => {
    for (const s of retrieveOne(db, v, opts)) {
      const prev = best.get(s.work.id);
      if (!prev || s.score > prev.score) best.set(s.work.id, { ...s, variant: i });
    }
  });
  const ranked = [...best.values()]
    .filter((s) => s.score > 0)
    .sort((a, b) => Math.round(b.score * 100) - Math.round(a.score * 100) || b.work.edition_count - a.work.edition_count || b.score - a.score || (a.work.id < b.work.id ? -1 : 1))
    .slice(0, k);
  return ranked.map(toCandidate);
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
