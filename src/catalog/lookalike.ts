// C-6 lookalike guard: on an open catalog a spine's text can fit a book and its namesakes equally well (another
// book with the same title by someone else, a one-word title that is also a common word). F-0's bar asks how well
// the text explains a work, never whether it explains that work better than every other one. The guard asks it, as
// a test on one reader's ranked candidates: a reader confirms a work only when it also passes the guard on that
// reader's text. Pure functions over `retrieve`'s output, plus one catalog lookup (how many books hold a title
// form). Constants are pre-registered in evals/C6/report.md and never tuned on the yardstick.
import type { DatabaseSync } from "node:sqlite";
import { normalize, splitSubtitle, STOPWORDS, tokenize } from "./normalize.ts";
import type { Candidate } from "./retrieve.ts";

export const LOOKALIKE = {
  /**
   * (a) Margin: the work's score must beat the best *different* book in the reader's candidates by at least this.
   * `retrieve` ranks scores by hundredths and breaks ties by edition count, so under 0.01 the work won on
   * popularity, not on the text. (One fully matched surname adds at least 0.03; that larger gap would also refuse
   * golden queries that name the author and beat a same-author adaptation by 0.017; evals/C6/report.md.)
   */
  margin: 0.01,
  /** How deep in the reader's ranked candidates the runner-up is looked for (scoring is unchanged; only the cut). */
  depth: 50,
  /**
   * (b) Author evidence: a work whose matched title form is one content word, or is held by at least this many
   * distinct books in the catalog (Open Library duplicates counted once), needs author evidence above 0.
   */
  sharedBooks: 2,
  /** Books looked at when counting a title form's holders (the count only needs to reach `sharedBooks`). */
  sharedScan: 200,
  /**
   * (c) Short title: a one-content-word title match needs a second field confirmed. Author: at least a surname read
   * with a small error (`surnameShare` 0.7 x a prefix or fuzzy match of at least 0.72 = 0.5). Series: F-0's title bar.
   */
  secondAuthor: 0.5,
  secondSeries: 0.8,
} as const;

export type GuardArm = "margin" | "author" | "short";
export const GUARD_ARMS: readonly GuardArm[] = ["margin", "author", "short"];

/** The work fields the same-book test reads (F-0g's `WorkRef` and `Candidate` both have them). */
export interface WorkRef {
  workId: string;
  title: string;
  authors: string[];
}

const titleKey = (t: string): string => tokenize(normalize(t)).join(" ");
const mainKey = (t: string): string => titleKey(splitSubtitle(t).main);
const surnames = (authors: string[]): Set<string> => new Set(authors.map((a) => tokenize(normalize(a)).at(-1) ?? "").filter(Boolean));

/** The same work: one id, or the same normalised title by a shared surname (the catalog holds some works twice). */
export function sameWork(a: WorkRef, b: WorkRef): boolean {
  if (a.workId === b.workId) return true;
  if (titleKey(a.title) !== titleKey(b.title)) return false;
  const sb = surnames(b.authors);
  return [...surnames(a.authors)].some((s) => sb.has(s));
}

/** Two works by a shared author (surname): a series run in matching jackets is the case F-0g's guard is for. */
export function sameAuthor(a: WorkRef, b: WorkRef): boolean {
  const sb = surnames(b.authors);
  return [...surnames(a.authors)].some((s) => sb.has(s));
}

/** A work's whole and main title forms, own and variant (`title_norm` kinds T, M, V, W; subtitle-only forms left out). */
export type TitleForms = (workId: string) => ReadonlySet<string>;

/** `title_norm` ('K:text|K:text') as the set of its whole and main forms. */
export function wholeAndMainForms(titleNorm: string): Set<string> {
  return new Set(titleNorm.split("|").filter((f) => /^[TMVW]:/.test(f)).map((f) => f.slice(2)));
}

/**
 * One book in the guard's sense: `sameWork`, or the same main title (before ": ") or a shared whole or main title
 * form (with `forms`), by a shared surname. Open Library keeps duplicate work records of one book, some with the
 * subtitle folded into the title, and ISFDB records an omnibus under the title of a book it holds; they are one book
 * here, so they never count as each other's lookalike. A crosswalked record is already the same work id.
 */
export function sameBook(a: WorkRef, b: WorkRef, forms?: TitleForms): boolean {
  if (sameWork(a, b)) return true;
  if (!sameAuthor(a, b)) return false;
  if (mainKey(a.title) === mainKey(b.title)) return true;
  if (!forms) return false;
  const fb = forms(b.workId);
  return [...forms(a.workId)].some((f) => fb.has(f));
}

const evidence = (c: Candidate, field: "title" | "author" | "series") => c.evidence.find((e) => e.field === field);

/** Content words of the title form the work matched with (stopwords dropped). */
export function titleWords(c: Candidate): number {
  const form = evidence(c, "title")?.form ?? "";
  return tokenize(form).filter((t) => !STOPWORDS.has(t)).length;
}

/** The best-scoring different book among `ranked` (the reader's candidates, best first), or null. */
export function runnerUp(c: Candidate, ranked: Candidate[], forms?: TitleForms): Candidate | null {
  return ranked.slice(0, LOOKALIKE.depth).find((r) => !sameBook(c, r, forms)) ?? null;
}

/** The gap between the work and the best different book in the reader's candidates (the work's score when there is none). */
export function marginOf(c: Candidate, ranked: Candidate[], forms?: TitleForms): number {
  return Math.round((c.score - (runnerUp(c, ranked, forms)?.score ?? 0)) * 1000) / 1000;
}

/**
 * How many distinct books hold this normalised title form, up to `sharedScan` works (Open Library duplicates and
 * crosswalks counted once: works by a shared surname are one book; a work with no author is a book of its own).
 */
export function titleHolders(db: DatabaseSync, form: string): number {
  const rows = db
    .prepare("SELECT DISTINCT w.authors AS authors FROM title_forms tf JOIN works w ON w.id = tf.work_id WHERE tf.norm = ? LIMIT ?")
    .all(form, LOOKALIKE.sharedScan) as Array<{ authors: string }>;
  const books: Array<Set<string>> = [];
  for (const r of rows) {
    const s = surnames(JSON.parse(r.authors) as string[]);
    const book = s.size > 0 ? books.find((b) => [...s].some((x) => b.has(x))) : undefined;
    if (book) for (const x of s) book.add(x);
    else books.push(s);
  }
  return books.length;
}

/** The catalog facts the guard needs about one confirmed candidate on one reader's text. */
export interface GuardInput {
  candidate: Candidate;
  /** The reader's candidates, best first (the candidate among them). */
  ranked: Candidate[];
  /** Distinct books holding the candidate's matched title form (`titleHolders`). */
  holders: number;
  /** Title forms per work, for the same-book test (without it, only the main title is compared). */
  forms?: TitleForms;
}

/** Which arm stops this confirmation, or null when it passes every arm in `arms`. Arms are checked in order a, b, c. */
export function lookalikeWhy(g: GuardInput, arms: ReadonlySet<GuardArm>): GuardArm | null {
  const c = g.candidate;
  if (arms.has("margin") && marginOf(c, g.ranked, g.forms) < LOOKALIKE.margin) return "margin";
  const oneWord = titleWords(c) <= 1;
  const author = evidence(c, "author")?.score ?? 0;
  if (arms.has("author") && (oneWord || g.holders >= LOOKALIKE.sharedBooks) && author <= 0) return "author";
  if (arms.has("short") && oneWord && author < LOOKALIKE.secondAuthor && (evidence(c, "series")?.score ?? 0) < LOOKALIKE.secondSeries) return "short";
  return null;
}

/** A guard over one open catalog: the arms in force and a memoised title-holder count. */
export interface LookalikeGuard {
  arms: ReadonlySet<GuardArm>;
  holders: (form: string) => number;
  forms: TitleForms;
}

export function lookalikeGuard(db: DatabaseSync, arms: Iterable<GuardArm> = GUARD_ARMS): LookalikeGuard {
  const held = new Map<string, number>();
  const formsOf = new Map<string, Set<string>>();
  const get = db.prepare("SELECT title_norm FROM works WHERE id = ?");
  return {
    arms: new Set(arms),
    holders: (form) => {
      let n = held.get(form);
      if (n === undefined) held.set(form, (n = titleHolders(db, form)));
      return n;
    },
    forms: (workId) => {
      let f = formsOf.get(workId);
      if (!f) formsOf.set(workId, (f = wholeAndMainForms((get.get(workId) as { title_norm: string } | undefined)?.title_norm ?? "")));
      return f;
    },
  };
}

/** The guard on one confirmed candidate: null when it passes. */
export function guardCheck(guard: LookalikeGuard, candidate: Candidate, ranked: Candidate[]): GuardArm | null {
  if (guard.arms.size === 0) return null;
  const form = evidence(candidate, "title")?.form ?? "";
  // The holder count needs a catalog query; only arm (b) reads it, and only when the title is not one word already.
  const needsHolders = guard.arms.has("author") && titleWords(candidate) > 1 && (evidence(candidate, "author")?.score ?? 0) <= 0;
  return lookalikeWhy({ candidate, ranked, holders: needsHolders ? guard.holders(form) : 0, forms: guard.forms }, guard.arms);
}
