// SC-1 shelf-context reader: what a store's own signage says about its rows. Text found on a photo's non-book regions
// (not-a-book boxes, S-1's lip, F-0i's partition gaps between a row's boxes, and the space no box covers) is classed
// by a small lexicon (and, where the two readers leave it open, a few-shot Qwen answer) into section, ordering rule,
// letter range or divider, promotion or talker, price, or other; each cue is scoped spatially (a strip on a lip covers
// its row, a divider marks a surname boundary, an end-cap sign covers its case), and the cues of a row make its
// **shelf context** record. Naive few-shot: nothing is trained per store. Shelf context is never a sole confirmer
// and it is not taste (INV-13); promotions, talkers and prices are never evidence of what is on the shelf. Pure
// functions; the runner is sc1-cli.ts. Constants are pre-registered in evals/SC1/prereg.md and never tuned.
import { surnameKey, stripLabels, type Row, type RowContext, type WorkRef } from "./f0h.ts";
import { LABEL } from "./f0f.ts";
import { rng, quantile } from "./q1.ts";

export const SC1 = {
  /** Vision line detection: square tiles of this many stored pixels, overlapping by this many. */
  tile: 2048,
  tileOverlap: 256,
  /** A line crop is padded by this share of its height on every side before PP-OCR and Qwen read it. */
  cropPad: 0.15,
  /** A line counts as on S-1's lip when this share of its quad's map pixels carry the lip label. */
  lipShare: 0.5,
  /** A unit counts only when its confidence (below) is at least this. */
  minConfidence: 0.3,
  /** Confidence: the readers' mean confidence, times 1 when two readers agree on the class, else this. */
  singleReader: 0.5,
  /** A divider's row: nearest row along y whose x-span holds the divider's centre, within this many row heights. */
  dividerReach: 1,
  /** An end-cap or header sign covers its case: rows below it whose centre x lies within its x-span widened by this many sign widths each side. */
  caseWiden: 1,
  /** Qwen few-shot: at most this many lines per photo (largest first), only where needed (`needsQwen`). */
  qwenPerPhoto: { "pilot-000": 12, yardstick: 6 } as Record<string, number>,
  /** Sign-like text: at least this many letters. */
  signMinLetters: 4,
  /** Shuffle controls: permutations and seed. */
  shuffles: 1000,
  seed: 20261104,
} as const;

export type CueClass = "section" | "ordering" | "letter" | "promotion" | "price" | "other";
export const CUE_CLASSES: CueClass[] = ["section", "ordering", "letter", "promotion", "price", "other"];

/** Genre families a section sign is mapped to (and a catalog work's facets, `workFamilies`). */
export type Family =
  | "sf-fantasy"
  | "sf"
  | "fantasy"
  | "horror"
  | "mystery"
  | "romance"
  | "young-adult"
  | "children"
  | "graphic"
  | "poetry-drama"
  | "classics"
  | "literature"
  | "nonfiction";

// --- the lexicon (fixed before the run) ----------------------------------------------------------------------------

export const LEXICON = {
  /** A promotion or shelf-talker (F-0f's talker patterns plus store promotions). Never evidence. */
  promotion: [
    ...LABEL.talker,
    /\b(on\s+)?sale\b/i,
    /\b\d{1,2}\s*%\s*off\b/i,
    /\bdiscount\w*/i,
    /\bbest\s*-?\s*sell\w*/i,
    /\bnew\s+(releases?|arrivals?|in\s+paperback|titles|this\s+week)\b/i,
    /\bstaff\s+(picks?|recommend\w*|favou?rites?)\b/i,
    /\brecommend\w*/i,
    /\baward\w*|\bwinners?\b|\bprize\b/i,
    /\bsigned\b|\bautograph\w*/i,
    /\bbook\s*club\b/i,
    /\bfeatured\b|\bcoming\s+soon\b|\bpre-?order\w*/i,
    /\bbuy\s+(one|\d)|\b\d\s+for\s+\d\b/i,
    /\bgifts?\b|\bbargains?\b|\bclearance\b|\bdeals?\b/i,
    /\bfavou?rites?\b|\bmust[\s-]reads?\b|\bpicks?\s+of\b|\btop\s+\d+\b/i,
  ],
  /** A price. Never evidence. */
  price: [/[$£€¥]\s*\d/, /\b\d{1,4}[.,]\d{2}\b/],
  /** An ordering rule: alphabetical by author (F-0f's strip wording included). */
  ordering: [LABEL.strip[1]!, /\balpha\w*\s*(order\s*)?by\s*(author|writer|surname|last\s*name)/i, /\b(arranged|sorted|shelved|filed)\s+by\s+(author|surname|last\s*name)/i, /\bby\s+author\b/i],
  /** Section wording, first match wins (the combined forms before their parts). */
  sections: [
    ["sf-fantasy", /sci(ence)?[\s.-]*fi(ction)?\s*[/&+|Il1,]\s*(and\s+)?fantasy|fantasy\s*[/&+|,]\s*(and\s+)?sci(ence)?[\s.-]*fi|speculative|\bsff\b|\bsf\s*[/&]\s*f\b|fiction\s*[/|Il1]\s*[fp]an/i],
    ["sf", /sci(ence)?[\s.-]*fi(ction)?\b|\bsf\b/i],
    ["fantasy", /fantasy/i],
    ["horror", /horror/i],
    ["mystery", /myster(y|ies)|\bcrime\b|thrillers?|suspense|detective/i],
    ["romance", /romance/i],
    ["young-adult", /young\s+adult|\bya\b|\bteens?\b/i],
    ["children", /child(ren)?'?s?\b|\bkids\b|juvenile|picture\s+books?/i],
    ["graphic", /graphic\s+novels?|comics?\b|manga/i],
    ["poetry-drama", /poetry|poems|\bdrama\b|\bplays\b|theat(er|re)/i],
    ["classics", /classics?\b/i],
    ["nonfiction", /biograph|memoir|histor(y|ical\s+studies)|\bscience\b|philosoph|religio|cook(ing|books?|ery)|travel|self[\s-]help|psycholog|politic|business|economic|\bart\b|\bmusic\b|reference|essays|true\s+crime|\bnature\b|\bsports?\b|humou?r|\bhealth\b|non-?fiction|social\s+science|\blaw\b|mathemat|computers?|technolog|military|\bwar\b|crafts?|\bgames\b|puzzles|languages?\b|education|parenting|\bpets\b|gardening|occult|spiritual|mytholog|folklore/i],
    ["literature", /literature|literary|general\s+fiction|\bfiction\b/i],
  ] as [Family, RegExp][],
} as const;

/** One letter (A–Z), optionally one more lower-case letter: a divider or a range end ("M", "Mc"). */
const LETTER = String.raw`[A-Z][a-z]?`;
const RANGE_ONLY = new RegExp(String.raw`^\s*(${LETTER})\s*(?:[-–—~]|to|thru|through)\s*(${LETTER})\s*$`);
const RANGE_IN = new RegExp(String.raw`(?:^|[\s(:,])(${LETTER})\s*[-–—]\s*(${LETTER})(?=$|[\s),.])`);
const DIVIDER_ONLY = new RegExp(String.raw`^\s*(${LETTER})\s*$`);

/** What one reader's text says: its class and the fields it carries (only section, ordering and letter carry any). */
export interface Cue {
  cls: CueClass;
  family: Family | null;
  /** The section wording as read (letters and spaces, lower case), when the class is section or the text names one. */
  section: string | null;
  ordering: "author-alphabetical" | null;
  /** A letter range ["a", "c"] (lower case) or a divider letter. */
  range: [string, string] | null;
  divider: string | null;
}

const NONE: Cue = { cls: "other", family: null, section: null, ordering: null, range: null, divider: null };
const letters = (s: string) => (s.match(/\p{L}/gu) ?? []).length;
const wording = (s: string): string | null => s.toLowerCase().replace(/[^\p{L} ]+/gu, " ").replace(/\s+/g, " ").trim() || null;

/** Class one reader's text with the lexicon. Promotion and price come first and carry no fields. */
export function classify(raw: string): Cue {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return NONE;
  if (LEXICON.promotion.some((p) => p.test(text))) return { ...NONE, cls: "promotion" };
  if (LEXICON.price.some((p) => p.test(text))) return { ...NONE, cls: "price" };
  const ordering = LEXICON.ordering.some((p) => p.test(text)) ? "author-alphabetical" : null;
  const sec = LEXICON.sections.find(([, re]) => re.test(text));
  const family = sec ? sec[0] : null;
  const section = sec ? wording(text.match(sec[1])?.[0] ?? "") : null;
  const only = text.match(RANGE_ONLY);
  const inside = ordering || family || text.split(" ").length <= 3 ? text.match(RANGE_IN) : null;
  const r = only ?? inside;
  const range: [string, string] | null = r && r[1]!.toLowerCase() <= r[2]!.toLowerCase() ? [r[1]!.toLowerCase(), r[2]!.toLowerCase()] : null;
  const d = range ? null : text.match(DIVIDER_ONLY);
  const divider = d ? d[1]!.toLowerCase() : null;
  const cls: CueClass = ordering ? "ordering" : range || divider ? "letter" : family ? "section" : "other";
  return { cls, family, section, ordering, range, divider };
}

// --- one text unit: readers combined ---------------------------------------------------------------------------------

export type UnitReader = "vision" | "ppocr" | "qwen";

export interface ReaderText {
  reader: UnitReader;
  text: string;
  confidence: number;
  /** Qwen's own class answer (few-shot), when it gave one. */
  kind?: CueClass | null;
}

export interface UnitCue extends Cue {
  /** Readers whose class is the unit's class. */
  agreeing: UnitReader[];
  confidence: number;
  /** Why a unit carries no cue: promotion veto, readers disagree, a lone divider, or under the confidence floor. */
  dropped: "promotion" | "price" | "disagree" | "lone-divider" | "low-confidence" | "other" | null;
}

const PRIORITY: CueClass[] = ["ordering", "letter", "section"];

/**
 * Combine the readers of one unit. Any reader reading a promotion or price vetoes the unit (never evidence). The
 * class is the one most readers give (Qwen's few-shot answer is its vote when it gave one); a tie goes to the more
 * specific class (ordering, letter, section). A divider needs two agreeing readers on the same letter. Confidence is
 * the agreeing readers' mean confidence, times `singleReader` when only one reader gives the class.
 */
export function combine(texts: readonly ReaderText[]): UnitCue {
  const cues = texts.filter((t) => t.text.trim()).map((t) => {
    const c = classify(t.text);
    if (t.reader !== "qwen" || !t.kind) return { t, c, cls: c.cls };
    // Qwen's few-shot class is its vote; a section it names in words the lexicon has no family for keeps its wording.
    return { t, c: t.kind === "section" && !c.section ? { ...c, section: wording(t.text) } : c, cls: t.kind };
  });
  const base = { ...NONE, agreeing: [] as UnitReader[], confidence: 0 };
  for (const veto of ["promotion", "price"] as const) if (cues.some((x) => x.cls === veto)) return { ...base, cls: veto, dropped: veto };
  const votes = new Map<CueClass, typeof cues>();
  for (const x of cues) if (x.cls !== "other") votes.set(x.cls, [...(votes.get(x.cls) ?? []), x]);
  if (votes.size === 0) return { ...base, dropped: "other" };
  const top = Math.max(...[...votes.values()].map((v) => v.length));
  const cls = PRIORITY.find((c) => (votes.get(c)?.length ?? 0) === top)!;
  const mine = votes.get(cls)!;
  if (votes.size > 1 && top === 1 && cues.filter((x) => x.cls !== "other").length > 1 && !mine.some((x) => x.t.reader === "qwen")) return { ...base, dropped: "disagree" };
  // Fields come from the agreeing readers, best confidence first; Qwen's text when it is the class's only reader.
  const ordered = [...mine].sort((a, b) => b.t.confidence - a.t.confidence);
  const pick = <K extends keyof Cue>(k: K): Cue[K] => (ordered.find((x) => x.c[k] !== null)?.c[k] ?? null) as Cue[K];
  const conf = mine.reduce((s, x) => s + Math.min(1, Math.max(0, x.t.confidence)), 0) / mine.length;
  const confidence = Math.round(conf * (mine.length >= 2 ? 1 : SC1.singleReader) * 1000) / 1000;
  let divider = pick("divider");
  let range = pick("range");
  if (cls === "letter" && !range) {
    const ds = mine.map((x) => x.c.divider).filter(Boolean);
    if (ds.length < 2 || new Set(ds).size > 1) return { ...base, cls, dropped: "lone-divider" };
    divider = ds[0]!;
  }
  const cue: UnitCue = { cls, family: pick("family"), section: pick("section"), ordering: pick("ordering"), range, divider: range ? null : divider, agreeing: mine.map((x) => x.t.reader), confidence, dropped: null };
  return confidence < SC1.minConfidence ? { ...cue, dropped: "low-confidence" } : cue;
}

/**
 * Does a line need Qwen's few-shot read? When the two local readers leave its class open: they disagree (neither
 * reading a promotion or price), only one of them names a class, or neither does although the text looks like a sign
 * (at least `signMinLetters` letters in a reader's text).
 */
export function needsQwen(texts: readonly ReaderText[]): boolean {
  const local = texts.filter((t) => t.reader !== "qwen" && t.text.trim());
  const cls = local.map((t) => classify(t.text).cls);
  if (cls.some((c) => c === "promotion" || c === "price")) return false;
  const named = new Set(cls.filter((c) => c !== "other"));
  if (named.size > 1) return true;
  if (named.size === 1) return cls.filter((c) => c !== "other").length < 2;
  return local.some((t) => letters(t.text) >= SC1.signMinLetters);
}

/** Qwen's few-shot answer "KIND | TEXT" (or "unreadable"): its class vote and its reading. */
export function parseQwen(out: string): { kind: CueClass | null; text: string } {
  const line = out.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const m = line.match(/^\s*(section|ordering|letters?|promotion|price|other)\s*[|:]\s*(.*)$/i);
  if (!m) return { kind: null, text: /unreadable/i.test(line) ? "" : line };
  const k = m[1]!.toLowerCase();
  return { kind: (k.startsWith("letter") ? "letter" : k) as CueClass, text: m[2]!.trim() };
}

// --- regions and scope -------------------------------------------------------------------------------------------------

/** Where a unit's text was found. */
export type Region = "not-a-book" | "lip" | "gap" | "free";

export interface Bounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const boundsOf = (pts: readonly (readonly [number, number] | readonly number[])[]): Bounds => ({
  left: Math.min(...pts.map((p) => p[0]!)),
  right: Math.max(...pts.map((p) => p[0]!)),
  top: Math.min(...pts.map((p) => p[1]!)),
  bottom: Math.max(...pts.map((p) => p[1]!)),
});

const cx = (b: Bounds) => (b.left + b.right) / 2;
const cy = (b: Bounds) => (b.top + b.bottom) / 2;
export type ScopeRow = Pick<Row, "bottom" | "left" | "right" | "height"> & { key: string };

/** Does a line's centre lie inside a row's span (between its boxes' tops and bottoms, along its x-extent)? */
export const inRow = (b: Bounds, r: ScopeRow): boolean => cx(b) >= r.left && cx(b) <= r.right && cy(b) >= r.bottom - r.height && cy(b) <= r.bottom;

/** A unit's region: inside a not-a-book box, on the lip, in a row's span (a partition gap), or free. */
export function regionOf(b: Bounds, f: { inNotABook: boolean; lipShare: number | null }, rows: readonly ScopeRow[]): Region {
  if (f.inNotABook) return "not-a-book";
  if ((f.lipShare ?? 0) >= SC1.lipShare) return "lip";
  if (rows.some((r) => inRow(b, r))) return "gap";
  return "free";
}

export type ScopeLevel = "row" | "case" | "divider";
export interface Scope {
  level: ScopeLevel;
  rows: string[];
  /** For a divider: its x (the surname boundary along the row). */
  x?: number;
}

/** Strip-like boxes: F-0f's strips, F-0c's flat strips and long flat boxes, S-1's on-lip boxes. */
export const STRIP_WHY = new Set(["shelf-strip", "flat-strip", "spans-books", "on-lip"]);

/**
 * Scope one unit's cue:
 * - a divider marks a surname boundary at its x in the row nearest along y whose x-span holds it (within
 *   `dividerReach` row heights; the row above wins a tie);
 * - text on the lip or in a strip-like box, or any text F-0h's `stripLabels` places just below a row, covers that row;
 * - text inside a row's span (a partition gap or a card standing in the row) covers that row;
 * - anything else is an end-cap or header sign and covers its case: rows below it whose centre x lies within its
 *   x-span widened by `caseWiden` sign widths each side.
 * Null when no row is in scope.
 */
export function scopeOf(b: Bounds, region: Region, boxWhy: string | null, cue: Pick<Cue, "divider">, rows: readonly ScopeRow[]): Scope | null {
  if (cue.divider) {
    let best: { key: string; d: number; above: boolean } | null = null;
    for (const r of rows) {
      if (cx(b) < r.left || cx(b) > r.right) continue;
      const top = r.bottom - r.height;
      const d = cy(b) < top ? top - cy(b) : cy(b) > r.bottom ? cy(b) - r.bottom : 0;
      if (d > SC1.dividerReach * r.height) continue;
      const above = r.bottom <= cy(b);
      if (!best || d < best.d || (d === best.d && above && !best.above)) best = { key: r.key, d, above };
    }
    return best ? { level: "divider", rows: [best.key], x: cx(b) } : null;
  }
  const strip = region === "lip" || (region === "not-a-book" && boxWhy !== null && STRIP_WHY.has(boxWhy));
  const below = rows.filter((r) => stripLabels(b, r)).map((r) => r.key);
  if (strip || below.length) return below.length ? { level: "row", rows: below } : null;
  const inside = rows.filter((r) => inRow(b, r)).map((r) => r.key);
  if (inside.length) return { level: "row", rows: inside };
  const w = (b.right - b.left) * SC1.caseWiden;
  const caseRows = rows.filter((r) => (r.left + r.right) / 2 >= b.left - w && (r.left + r.right) / 2 <= b.right + w && r.bottom - r.height >= cy(b)).map((r) => r.key);
  return caseRows.length ? { level: "case", rows: caseRows } : null;
}

// --- the per-row shelf context record ------------------------------------------------------------------------------

/** One scoped cue: where it came from, what it says, how sure. */
export interface ScopedCue {
  unit: string;
  region: Region;
  level: ScopeLevel;
  cue: UnitCue;
  x?: number;
}

/** SC-1's per-row shelf context: F-0h's `RowContext` plus confidence, dividers and the cues' sources. */
export interface ShelfContext extends RowContext {
  confidence: number;
  dividers: { x: number; letter: string }[];
  /** The genre's family (null when the section wording maps to none). */
  family: Family | null;
  /** Scope level of each field's cue. */
  levels: { genre: ScopeLevel | null; ordering: ScopeLevel | null; letterRange: ScopeLevel | null };
  /** Where the genre's cue was read. */
  genreRegion: Region | null;
  cues: number;
}

const LEVEL_RANK: Record<ScopeLevel, number> = { divider: 0, row: 0, case: 1 };
const better = (a: ScopedCue, b: ScopedCue | undefined) => !b || LEVEL_RANK[a.level] < LEVEL_RANK[b.level] || (LEVEL_RANK[a.level] === LEVEL_RANK[b.level] && a.cue.confidence > b.cue.confidence);

/**
 * A row's shelf context from its scoped cues: each field from its row-level cue before a case-level one, then the more
 * confident; dividers in x order (one per letter and place). Null when no cue reaches the row.
 */
export function rowContext(cues: readonly ScopedCue[]): ShelfContext | null {
  const live = cues.filter((c) => !c.cue.dropped);
  if (!live.length) return null;
  let genre: ScopedCue | undefined, ordering: ScopedCue | undefined, range: ScopedCue | undefined;
  for (const c of live) {
    if (c.cue.section && better(c, genre)) genre = c;
    if (c.cue.ordering && better(c, ordering)) ordering = c;
    if (c.cue.range && better(c, range)) range = c;
  }
  const dividers = [...new Map(live.filter((c) => c.level === "divider" && c.cue.divider).map((c) => [`${c.cue.divider}@${Math.round(c.x!)}`, { x: Math.round(c.x!), letter: c.cue.divider! }])).values()].sort((a, b) => a.x - b.x);
  if (!genre && !ordering && !range && !dividers.length) return null;
  const used = [genre, ordering, range, ...live.filter((c) => c.level === "divider")].filter((c): c is ScopedCue => Boolean(c));
  const sources = [...new Set(used.map((c) => `${c.region}:${c.level}`))].sort();
  return {
    ordering: ordering ? "author-alphabetical" : null,
    genre: genre?.cue.section ?? null,
    letterRange: range?.cue.range ?? null,
    source: `sc1:${sources.join("+")}`,
    confidence: Math.max(...used.map((c) => c.cue.confidence)),
    dividers,
    family: genre?.cue.family ?? null,
    levels: { genre: genre?.level ?? null, ordering: ordering?.level ?? null, letterRange: range?.level ?? null },
    genreRegion: genre?.region ?? null,
    cues: used.length,
  };
}

/** F-0h's view of a shelf context: the `RowContext` fields only (F-0h reads `ordering`, for hypotheses only). */
export const asRowContext = (s: ShelfContext): RowContext => ({ ordering: s.ordering, genre: s.genre, letterRange: s.letterRange, source: s.source });

// --- label-free agreement measures --------------------------------------------------------------------------------------

/** A surname's comparison key against a letter bound: its first letters, as many as the bound has. */
const head = (surname: string, bound: string) => surname.slice(0, bound.length);
export const inRange = (surname: string, [lo, hi]: readonly [string, string]): boolean => head(surname, lo) >= lo && head(surname, hi) <= hi;
/** A book left of a divider files before its letter, a book right of it at or after. */
export const dividerSide = (surname: string, letter: string, right: boolean): boolean => (right ? head(surname, letter) >= letter : head(surname, letter) < letter);

/** A catalog work's genre facets (ISFDB tags, type and flags), mapped to the section families. Empty: unknown. */
export function workFamilies(w: { tags: readonly string[]; ttype: string | null; nonGenre: boolean; graphic: boolean }): Set<Family> {
  const t = w.tags.join(" | ").toLowerCase();
  const out = new Set<Family>();
  if (/science fiction|\bsf\b|sci-fi|space opera|cyberpunk|time travel|dystopi|aliens?\b|robots?\b|post-apocalyptic/.test(t)) out.add("sf");
  if (/fantasy|sword and sorcery|\bmagic\b|dragons?\b|fairy tale|wizards?\b|elves\b/.test(t)) out.add("fantasy");
  if (/horror|ghosts?\b|vampires?\b|zombies?\b|weird fiction|supernatural|lovecraft/.test(t)) out.add("horror");
  if (/myster|detective|\bcrime\b|thriller|\bnoir\b|suspense/.test(t)) out.add("mystery");
  if (/romance/.test(t)) out.add("romance");
  if (/young adult|\bya\b|\bteen/.test(t)) out.add("young-adult");
  if (/juvenile|children|middle grade|picture book/.test(t)) out.add("children");
  if (w.graphic || /graphic novel|\bcomics?\b|manga/.test(t)) out.add("graphic");
  if (w.ttype === "POEM" || /poetry/.test(t)) out.add("poetry-drama");
  if (w.ttype === "NONFICTION" || w.ttype === "ESSAY" || /non-?fiction|biograph|history of|criticism/.test(t)) out.add("nonfiction");
  if (/classic/.test(t)) out.add("classics");
  if (w.nonGenre || /literary|mainstream|classic/.test(t)) out.add("literature");
  return out;
}

/** Does a section family agree with a work's facets? SF/fantasy takes either; literature and classics take each other. */
export function familyAgrees(section: Family, work: ReadonlySet<Family>): boolean {
  if (section === "sf-fantasy") return work.has("sf") || work.has("fantasy");
  if (section === "literature") return work.has("literature") || work.has("classics");
  if (section === "classics") return work.has("classics") || work.has("literature");
  return work.has(section);
}

/** One row's evidence for the measures: its record, its confirmed works in shelf order, their x and families. */
export interface MeasureRow {
  imageId: string;
  key: string;
  context: ShelfContext | null;
  /** Confirmed spines in shelf order. */
  books: { x: number; surname: string; families: Set<Family> }[];
}

export const surnameOf = (w: WorkRef): string => surnameKey(w);

/** Letter agreement pairs (book, cue) of a set: range cues and divider cues, each pair agreeing or not. */
export function letterPairs(rows: readonly MeasureRow[], ctx: (r: MeasureRow) => ShelfContext | null = (r) => r.context): { imageId: string; kind: "range" | "divider"; agree: boolean }[] {
  const out: { imageId: string; kind: "range" | "divider"; agree: boolean }[] = [];
  for (const r of rows) {
    const c = ctx(r);
    if (!c) continue;
    for (const b of r.books) {
      if (!b.surname) continue;
      if (c.letterRange) out.push({ imageId: r.imageId, kind: "range", agree: inRange(b.surname, c.letterRange) });
      for (const d of c.dividers) out.push({ imageId: r.imageId, kind: "divider", agree: dividerSide(b.surname, d.letter, b.x > d.x) });
    }
  }
  return out;
}

/** Genre agreement pairs (book with known facets, row family). */
export function genrePairs(rows: readonly MeasureRow[], fam: (r: MeasureRow) => Family | null = (r) => r.context?.family ?? null): { imageId: string; agree: boolean }[] {
  const out: { imageId: string; agree: boolean }[] = [];
  for (const r of rows) {
    const f = fam(r);
    if (!f) continue;
    for (const b of r.books) if (b.families.size) out.push({ imageId: r.imageId, agree: familyAgrees(f, b.families) });
  }
  return out;
}

/** Consecutive confirmed pairs in surname order, over rows (F-0h's `orderPairs` rule: equal keys skipped). */
export function orderCounts(rows: readonly MeasureRow[]): { pairs: number; inOrder: number } {
  let pairs = 0, inOrder = 0;
  for (const r of rows) {
    const k = r.books.map((b) => b.surname).filter(Boolean);
    for (let i = 0; i + 1 < k.length; i++) {
      if (k[i] === k[i + 1]) continue;
      pairs++;
      if (k[i]! < k[i + 1]!) inOrder++;
    }
  }
  return { pairs, inOrder };
}

export interface ShuffleResult {
  real: number | null;
  n: number;
  mean: number | null;
  p95: number | null;
  /** Share of permutations at or above the real value (one-sided). */
  p: number | null;
}

/** A permutation control: `stat` on the real assignment, then on `shuffles` permutations drawn by `permute`. */
export function shuffleControl<T>(real: () => { value: number | null; n: number }, permute: (rand: () => number) => T, stat: (perm: T) => number | null, shuffles: number = SC1.shuffles, seed: number = SC1.seed): ShuffleResult {
  const r = real();
  if (r.value === null) return { real: null, n: r.n, mean: null, p95: null, p: null };
  const rand = rng(seed);
  const vals: number[] = [];
  for (let i = 0; i < shuffles; i++) {
    const v = stat(permute(rand));
    if (v !== null) vals.push(v);
  }
  if (!vals.length) return { real: r.value, n: r.n, mean: null, p95: null, p: null };
  vals.sort((a, b) => a - b);
  const r4 = (x: number) => Math.round(x * 10000) / 10000;
  return { real: r4(r.value), n: r.n, mean: r4(vals.reduce((s, v) => s + v, 0) / vals.length), p95: r4(quantile(vals, 0.95)), p: r4(vals.filter((v) => v >= r.value!).length / vals.length) };
}

/** Fisher–Yates permutation of a copy. */
export function permuted<T>(xs: readonly T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
