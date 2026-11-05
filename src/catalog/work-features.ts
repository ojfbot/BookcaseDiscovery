// Shared book knowledge (card KN-1): the `work_features` table. Genre, subject and form terms per catalog work, each
// with its provenance (source, record id, fetched date). These are catalog facts, the same for every reader, so
// `identify` may read them (KN-2's genre prior) and `recommend` reads them through its crosswalk (R-0 §2.4, R-2).
// Nothing here knows the reader: this file imports nothing from `recommend/` or the profile (INV-13; the wall test in
// test/work-features.test.ts follows its imports).
//
// Sources, both from bulk files already on disk (docs/catalog.md § Shared book knowledge):
//   - ISFDB title tags (the staged `tags` and `tag_mapping`), public tags only, every tag (not `works.tags`' top 8);
//   - Open Library work subjects, read once from the works dump into a small extract (`extractOlSubjects`), joined to
//     catalog works through C-5's crosswalk (`works.sources` on a v2 build, or the crosswalk alone on a v1 build).
// LC subjects, LC genre/form terms and BISAC have no published bulk file on disk; they are not sourced (see
// implementation-notes.md, KN-1). An Open Library subject shaped like a BISAC heading is still an Open Library subject.
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dumpRecords, olNum } from "./ol-dump.ts";
import { decodeEntities } from "./normalize.ts";

export const FEATURE_SOURCES = ["isfdb-tag", "openlibrary-subject"] as const;
export type FeatureSource = (typeof FEATURE_SOURCES)[number];
export const FEATURE_KINDS = ["genre", "form", "subject"] as const;
export type FeatureKind = (typeof FEATURE_KINDS)[number];

export const WORK_FEATURES_SCHEMA = `
CREATE TABLE work_features (
  work_id   TEXT NOT NULL,        -- works.id
  kind      TEXT NOT NULL,        -- 'genre', 'form' or 'subject'
  term      TEXT NOT NULL,        -- the source's value: entities decoded, case-folded, spaces collapsed
  canon     TEXT,                 -- the canonical genre or form ('science-fiction', 'short-stories'); NULL for a subject
  family    TEXT,                 -- the canon's family ('sf', 'fantasy', 'form', ...); NULL for a subject
  count     INTEGER NOT NULL,     -- ISFDB: distinct users who applied the tag to the work; Open Library: records carrying it
  source    TEXT NOT NULL,        -- 'isfdb-tag' or 'openlibrary-subject'
  record_id TEXT NOT NULL,        -- the source record: 'isfdb-tag:<tag_id>', or 'OL<n>W' (the lowest when several carry it)
  fetched   TEXT NOT NULL,        -- the source dump's date, YYYY-MM-DD
  PRIMARY KEY (work_id, source, term)
) WITHOUT ROWID;
CREATE INDEX work_features_canon ON work_features(canon);
`;

export interface WorkFeature {
  workId: string;
  kind: FeatureKind;
  term: string;
  canon: string | null;
  family: string | null;
  count: number;
  source: FeatureSource;
  recordId: string;
  fetched: string;
}

// ---------------------------------------------------------------------------------------------
// Classification: genre, form or subject
// ---------------------------------------------------------------------------------------------

/**
 * Canonical genres and forms, each with its family and the case-folded values that name it. A value is a genre or
 * form when it, or one of its segments (`Fiction, science fiction, general`; `Mars (Planet) -- Fiction`), is one of
 * these. Everything else is a subject. The list is configuration; growing it changes no identity decision.
 */
export const LEXICON: ReadonlyArray<{ canon: string; kind: "genre" | "form"; family: string; names: readonly string[] }> = [
  { canon: "science-fiction", kind: "genre", family: "sf", names: ["science fiction", "sf", "sci-fi", "scifi", "science-fiction", "speculative fiction", "science fiction and fantasy"] },
  { canon: "space-opera", kind: "genre", family: "sf", names: ["space opera"] },
  { canon: "cyberpunk", kind: "genre", family: "sf", names: ["cyberpunk", "cyberpunk fiction", "cyberpunk culture"] },
  { canon: "steampunk", kind: "genre", family: "sf", names: ["steampunk", "steampunk fiction"] },
  { canon: "military-sf", kind: "genre", family: "sf", names: ["military sf", "military science fiction"] },
  { canon: "hard-sf", kind: "genre", family: "sf", names: ["hard sf", "hard science fiction"] },
  { canon: "dystopian", kind: "genre", family: "sf", names: ["dystopia", "dystopias", "dystopian", "dystopian fiction"] },
  { canon: "utopian", kind: "genre", family: "sf", names: ["utopia", "utopias", "utopian fiction"] },
  { canon: "post-apocalyptic", kind: "genre", family: "sf", names: ["post apocalypse", "post-apocalypse", "post-apocalyptic", "post-apocalyptic fiction", "apocalyptic fiction"] },
  { canon: "alternate-history", kind: "genre", family: "sf", names: ["alternate history", "alternative history", "alternative histories (fiction)", "alternate histories (fiction)"] },
  { canon: "climate-fiction", kind: "genre", family: "sf", names: ["climate fiction", "cli-fi"] },
  { canon: "science-fantasy", kind: "genre", family: "sf", names: ["science fantasy"] },
  { canon: "litrpg", kind: "genre", family: "sf", names: ["litrpg"] },
  { canon: "fantasy", kind: "genre", family: "fantasy", names: ["fantasy", "fantasy fiction", "contemporary fantasy", "christian fantasy"] },
  { canon: "urban-fantasy", kind: "genre", family: "fantasy", names: ["urban fantasy"] },
  { canon: "epic-fantasy", kind: "genre", family: "fantasy", names: ["epic fantasy", "high fantasy"] },
  { canon: "dark-fantasy", kind: "genre", family: "fantasy", names: ["dark fantasy"] },
  { canon: "historical-fantasy", kind: "genre", family: "fantasy", names: ["historical fantasy"] },
  { canon: "sword-and-sorcery", kind: "genre", family: "fantasy", names: ["sword and sorcery"] },
  { canon: "magical-realism", kind: "genre", family: "fantasy", names: ["magical realism", "magic realism (literature)"] },
  { canon: "fairy-tales", kind: "genre", family: "fantasy", names: ["fairy tales", "retold fairy tales"] },
  { canon: "animal-fantasy", kind: "genre", family: "fantasy", names: ["animal fantasy"] },
  { canon: "horror", kind: "genre", family: "horror", names: ["horror", "horror fiction", "horror stories", "horror tales"] },
  { canon: "gothic", kind: "genre", family: "horror", names: ["gothic", "gothic fiction"] },
  { canon: "weird", kind: "genre", family: "horror", names: ["weird", "weird fiction", "new weird"] },
  { canon: "lovecraftian", kind: "genre", family: "horror", names: ["lovecraftian", "cthulhu mythos"] },
  { canon: "ghost-stories", kind: "genre", family: "horror", names: ["ghost stories"] },
  { canon: "occult-and-supernatural", kind: "genre", family: "horror", names: ["occult and supernatural", "paranormal fiction"] },
  { canon: "mystery", kind: "genre", family: "crime", names: ["mystery", "mystery fiction", "mystery and detective stories", "detective and mystery stories", "mystery and detective", "detective", "detective fiction", "detective stories", "mysteries"] },
  { canon: "crime", kind: "genre", family: "crime", names: ["crime", "crime fiction", "noir", "noir fiction"] },
  { canon: "paranormal-mystery", kind: "genre", family: "crime", names: ["paranormal mystery"] },
  { canon: "thriller", kind: "genre", family: "thriller", names: ["thriller", "thrillers", "thrillers (fiction)", "suspense", "suspense fiction", "supernatural thriller"] },
  { canon: "spy", kind: "genre", family: "thriller", names: ["spy stories", "spy fiction", "espionage", "espionage fiction", "espionage and spy"] },
  { canon: "romance", kind: "genre", family: "romance", names: ["romance", "romance fiction", "love stories", "romantic fiction", "romantic suspense"] },
  { canon: "paranormal-romance", kind: "genre", family: "romance", names: ["paranormal romance"] },
  { canon: "fantasy-romance", kind: "genre", family: "romance", names: ["fantasy romance", "romantasy"] },
  { canon: "futuristic-romance", kind: "genre", family: "romance", names: ["futuristic romance", "time-travel romance"] },
  { canon: "historical-fiction", kind: "genre", family: "historical", names: ["historical fiction", "historical", "historical novels"] },
  { canon: "western", kind: "genre", family: "western", names: ["western", "westerns", "western stories", "western fiction", "weird west"] },
  { canon: "humorous", kind: "genre", family: "humour", names: ["humorous", "humor", "humour", "humorous fiction", "humorous stories", "comic fiction"] },
  { canon: "satire", kind: "genre", family: "humour", names: ["satire", "satirical fiction", "satirical literature"] },
  { canon: "literary-fiction", kind: "genre", family: "literary", names: ["literary", "literary fiction"] },
  { canon: "political-fiction", kind: "genre", family: "literary", names: ["political fiction"] },
  { canon: "psychological-fiction", kind: "genre", family: "literary", names: ["psychological fiction", "psychological"] },
  { canon: "adventure", kind: "genre", family: "adventure", names: ["adventure", "adventure stories", "adventure fiction", "action and adventure", "action", "sea stories", "adventure and adventurers"] },
  { canon: "war-fiction", kind: "genre", family: "war", names: ["war stories", "war fiction"] },
  { canon: "erotica", kind: "genre", family: "erotica", names: ["erotica", "erotic fiction", "erotic stories"] },
  { canon: "fiction", kind: "form", family: "form", names: ["fiction", "fiction in english"] },
  { canon: "novel", kind: "form", family: "form", names: ["novel", "novels", "romans"] },
  { canon: "novella", kind: "form", family: "form", names: ["novella", "novellas", "novelette"] },
  { canon: "short-stories", kind: "form", family: "form", names: ["short stories", "short story", "short story collection", "stories", "collection", "single-author collection", "short stories (single author)", "nouvelles"] },
  { canon: "anthology", kind: "form", family: "form", names: ["anthology", "anthologies", "original anthology"] },
  { canon: "poetry", kind: "form", family: "form", names: ["poetry", "poems", "verse", "prose poem", "scifaiku", "horrorku"] },
  { canon: "drama", kind: "form", family: "form", names: ["drama", "plays"] },
  { canon: "graphic-novel", kind: "form", family: "form", names: ["graphic novel", "graphic novels", "comics", "comic books, strips, etc.", "comics and graphic novels", "comic books"] },
  { canon: "nonfiction", kind: "form", family: "form", names: ["nonfiction", "non-fiction"] },
  { canon: "essays", kind: "form", family: "form", names: ["essays"] },
  { canon: "biography", kind: "form", family: "form", names: ["biography", "biographies", "autobiography", "memoir", "memoirs", "biography and autobiography"] },
  { canon: "criticism", kind: "form", family: "form", names: ["criticism", "literary criticism", "criticism and interpretation", "history and criticism"] },
  { canon: "letters", kind: "form", family: "form", names: ["letters", "correspondence"] },
  { canon: "reference", kind: "form", family: "form", names: ["reference", "encyclopedias", "dictionaries", "bibliography"] },
  { canon: "picture-book", kind: "form", family: "form", names: ["picture books", "picture book"] },
];

const BY_NAME = new Map<string, (typeof LEXICON)[number]>();
for (const e of LEXICON) for (const n of e.names) BY_NAME.set(n, e);

/** Leading words a lookup may drop: audience and nationality qualifiers ('juvenile fantasy', 'american science fiction'). */
const QUALIFIERS = ["juvenile", "young adult", "young-adult", "ya", "children's", "childrens", "teen", "adult", "american", "english", "british", "canadian", "australian", "irish", "scottish", "french", "german", "russian", "japanese", "polish", "italian", "spanish", "chinese"];
/** Segments that carry nothing: BISAC's `general`, LCSH's `etc.`. */
const FILLER = new Set(["general", "etc.", "etc", "other"]);

/** Case-fold, decode entities, `&` to `and`, collapse spaces. The form `term` is stored in. */
export function foldTerm(raw: string): string {
  return decodeEntities(raw).toLowerCase().replace(/&/g, " and ").replace(/\s+/g, " ").trim();
}

function lookup(seg: string): (typeof LEXICON)[number] | undefined {
  let s = seg.trim();
  for (let guard = 0; guard < 4; guard++) {
    const hit = BY_NAME.get(s) ?? BY_NAME.get(s.replace(/\.$/, ""));
    if (hit) return hit;
    const q = QUALIFIERS.find((w) => s.startsWith(`${w} `));
    if (!q) return undefined;
    s = s.slice(q.length + 1);
  }
  return undefined;
}

/**
 * Genre, form or subject for one folded value. A value names a genre when any segment does (the most specific
 * segment, the last, wins); a form when every non-filler segment is a form; otherwise it is a subject, which keeps
 * `Texas, fiction` and `Mars (Planet) -- Fiction` (topic plus form subdivision) as subjects.
 */
export function classify(term: string): { kind: FeatureKind; canon: string | null; family: string | null } {
  const whole = lookup(term);
  if (whole) return { kind: whole.kind, canon: whole.canon, family: whole.family };
  const segs = term.split(/\s*(?:--|\/|;|,)\s*/).filter((s) => s !== "" && !FILLER.has(s));
  const hits = segs.map(lookup);
  const genres = hits.filter((h) => h?.kind === "genre");
  if (genres.length > 0) {
    const g = genres.at(-1)!;
    return { kind: "genre", canon: g.canon, family: g.family };
  }
  if (segs.length > 0 && hits.every((h) => h?.kind === "form")) {
    const f = hits.at(-1)!;
    return { kind: "form", canon: f.canon, family: f.family };
  }
  return { kind: "subject", canon: null, family: null };
}

/**
 * Values that are not facts about the book and never enter the table: popularity and canon signals (awards,
 * best-of and reading lists, bestseller lists; OC33), adaptations, and bookkeeping (holdings, e-text sources,
 * reading logs, accessibility flags). ISFDB's private tags are left out before this list is tried.
 */
export const NOT_BOOK_FACTS: readonly RegExp[] = [
  /award|nominee|finalist|winner|shortlist|longlist/,
  /\bbest\b|years best|year's best|reading list|core collection|must read|1001 books|sf: the 100|top \d+|\d+ best/,
  /^into-|adapted|adaptation/,
  /bestseller|best seller|^nyt:|new york times/,
  /accessible book|protected daisy|in library|lending library|overdrive|large type|large print|internet archive|project gutenberg|librivox|google books|open_syllabus|reading level|^read\b|to-read|kindle|e-?book|audible|audiobook|bundle$|^\d{4}$/,
  /^user rating|\bvotes?\b/,
];

export const notABookFact = (term: string): boolean => NOT_BOOK_FACTS.some((re) => re.test(term));

// ---------------------------------------------------------------------------------------------
// Open Library subjects extract (async; read once from the works dump)
// ---------------------------------------------------------------------------------------------

export const OL_SUBJECTS_SCHEMA_VERSION = 1;

export interface OlSubjectsResult {
  out: string;
  works: number;
  withSubjects: number;
  lines: number;
  seconds: number;
}

/**
 * Read `subjects` from the Open Library works dump for every breadth work the staging file kept, into a small SQLite file
 * (`ol_subjects`: work number, subjects JSON, revision, last_modified). Places, people and times are not read: R-0
 * gives setting no weight (taste-model.md §2.1). The dump is a published bulk file; nothing is fetched.
 */
export async function extractOlSubjects(opts: { works: string; staging: string; out: string; dumpDate: string; log?: (s: string) => void }): Promise<OlSubjectsResult> {
  const log = opts.log ?? (() => {});
  const t0 = Date.now();
  if (!existsSync(opts.works)) throw new Error(`works dump not found: ${opts.works}`);
  if (!existsSync(opts.staging)) throw new Error(`Open Library staging file not found: ${opts.staging}`);
  const st = new DatabaseSync(opts.staging, { readOnly: true });
  const kept = new Set<number>();
  // Breadth works only: a work staged only because it is on the owner's shelves (layer 'shelf', C-5) would make the
  // shared table depend on one reader's shelves.
  for (const r of st.prepare("SELECT id FROM ol_works WHERE layer <> 'shelf'").iterate() as Iterable<{ id: number }>) kept.add(r.id);
  st.close();
  log(`ol subjects: ${kept.size.toLocaleString("en-US")} staged breadth works`);

  mkdirSync(dirname(opts.out), { recursive: true });
  const partial = `${opts.out}.partial`;
  rmSync(partial, { force: true });
  const db = new DatabaseSync(partial);
  try {
    db.exec("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;");
    db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
      CREATE TABLE ol_subjects (id INTEGER PRIMARY KEY, subjects TEXT NOT NULL, revision INTEGER, last_modified TEXT);`);
    const ins = db.prepare("INSERT OR REPLACE INTO ol_subjects (id, subjects, revision, last_modified) VALUES (?, ?, ?, ?)");
    const stats = { lines: 0, skipped: 0, kept: 0 };
    db.exec("BEGIN");
    for await (const { key, rec } of dumpRecords(opts.works, stats, (type, k) => type === "/type/work" && kept.has(olNum(k, "W") ?? -1))) {
      const id = olNum(key, "W")!;
      const raw = Array.isArray(rec.subjects) ? rec.subjects : [];
      const subjects = [...new Set(raw.filter((s): s is string => typeof s === "string").map((s) => s.trim()).filter((s) => s !== ""))];
      if (subjects.length === 0) continue;
      ins.run(id, JSON.stringify(subjects), typeof rec.revision === "number" ? rec.revision : null, typeof rec.last_modified === "object" && rec.last_modified ? String((rec.last_modified as { value?: unknown }).value ?? "") || null : null);
      if (++stats.kept % 500_000 === 0) log(`ol subjects: ${stats.kept.toLocaleString("en-US")} works with subjects`);
    }
    const meta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
    meta.run("schema_version", String(OL_SUBJECTS_SCHEMA_VERSION));
    meta.run("dump_date", opts.dumpDate);
    meta.run("dump_file", opts.works.split("/").at(-1)!);
    const withSubjects = (db.prepare("SELECT COUNT(*) AS n FROM ol_subjects").get() as { n: number }).n;
    meta.run("rows.ol_subjects", String(withSubjects));
    meta.run("dump_lines", String(stats.lines));
    db.exec("COMMIT");
    db.exec(`PRAGMA user_version = ${OL_SUBJECTS_SCHEMA_VERSION}`);
    db.close();
    rmSync(opts.out, { force: true });
    renameSync(partial, opts.out);
    return { out: opts.out, works: kept.size, withSubjects, lines: stats.lines, seconds: (Date.now() - t0) / 1000 };
  } catch (e) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    rmSync(partial, { force: true });
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------
// The build step (inside buildCatalog's transaction)
// ---------------------------------------------------------------------------------------------

export interface FeatureCounts {
  rows: number;
  works: number;
  isfdbRows: number;
  isfdbPrivateSkipped: number;
  olRows: number;
  olWorksLinked: number;
  notABookFact: number;
  byKind: Record<FeatureKind, number>;
}

/**
 * Fill `work_features`. Call inside the build's transaction, after the works (and any Open Library merge) are in
 * place. `st` (ISFDB staging) must be attached; `subj` (an Open Library subjects extract) is read when attached,
 * through `temp.ol_crosswalk (work_id, ol_id)`, which the Open Library merge or crosswalk step fills.
 */
export function fillWorkFeatures(db: DatabaseSync, opts: { isfdbDate: string; olDate: string | null; log?: (s: string) => void }): FeatureCounts {
  const log = opts.log ?? (() => {});
  db.exec(WORK_FEATURES_SCHEMA);
  const counts: FeatureCounts = { rows: 0, works: 0, isfdbRows: 0, isfdbPrivateSkipped: 0, olRows: 0, olWorksLinked: 0, notABookFact: 0, byKind: { genre: 0, form: 0, subject: 0 } };
  const ins = db.prepare("INSERT INTO work_features (work_id, kind, term, canon, family, count, source, record_id, fetched) VALUES (?,?,?,?,?,?,?,?,?)");
  const put = (workId: string, term: string, count: number, source: FeatureSource, recordId: string, fetched: string) => {
    const c = classify(term);
    ins.run(workId, c.kind, term, c.canon, c.family, count, source, recordId, fetched);
    counts.byKind[c.kind]++;
    counts.rows++;
  };

  // ISFDB: every public tag on the work's member titles (root and variants), counted by distinct user.
  log("work features: isfdb tags");
  counts.isfdbPrivateSkipped = (db.prepare(`SELECT COUNT(*) AS n FROM member m JOIN st.tag_mapping tm ON tm.title_id = m.member_id JOIN st.tags tg ON tg.tag_id = tm.tag_id
     WHERE tg.tag_status <> 0 AND m.root_id IN (SELECT root_id FROM root_count)`).get() as { n: number }).n;
  const byWorkTerm = new Map<string, { count: number; tagId: number }>();
  let lastRoot = -1;
  const flush = (root: number) => {
    for (const [term, v] of byWorkTerm) {
      put(`isfdb:${root}`, term, v.count, "isfdb-tag", `isfdb-tag:${v.tagId}`, opts.isfdbDate);
      counts.isfdbRows++;
    }
    byWorkTerm.clear();
  };
  for (const r of db.prepare(`
      SELECT m.root_id AS root, tg.tag_id AS tag_id, tg.tag_name AS name, COUNT(DISTINCT tm.user_id) AS n
        FROM member m JOIN st.tag_mapping tm ON tm.title_id = m.member_id JOIN st.tags tg ON tg.tag_id = tm.tag_id
       WHERE tg.tag_status = 0 AND m.root_id IN (SELECT root_id FROM root_count)
       GROUP BY m.root_id, tg.tag_id
       ORDER BY m.root_id, tg.tag_id`).iterate() as Iterable<{ root: number; tag_id: number; name: string; n: number }>) {
    if (r.root !== lastRoot) {
      if (lastRoot >= 0) flush(lastRoot);
      lastRoot = r.root;
    }
    const term = foldTerm(r.name);
    if (term === "") continue;
    if (notABookFact(term)) {
      counts.notABookFact++;
      continue;
    }
    // Two tag records that fold to one term (`Cyberpunk`, `cyberpunk`): counts add, the lower tag id is the record.
    const prev = byWorkTerm.get(term);
    if (prev) prev.count += r.n;
    else byWorkTerm.set(term, { count: r.n, tagId: r.tag_id });
  }
  if (lastRoot >= 0) flush(lastRoot);

  // Open Library: each linked Open Library work's subjects, onto the catalog work it crosswalks to (or is).
  const hasSubj = (db.prepare("SELECT COUNT(*) AS n FROM pragma_database_list WHERE name = 'subj'").get() as { n: number }).n > 0;
  if (hasSubj && opts.olDate) {
    log("work features: open library subjects");
    const terms = new Map<string, { count: number; ol: number }>();
    let last: string | null = null;
    const flushOl = (workId: string) => {
      for (const [term, v] of terms) {
        put(workId, term, v.count, "openlibrary-subject", `OL${v.ol}W`, opts.olDate!);
        counts.olRows++;
      }
      terms.clear();
      counts.olWorksLinked++;
    };
    for (const r of db.prepare(`
        SELECT x.work_id AS work_id, x.ol_id AS ol_id, s.subjects AS subjects FROM temp.ol_crosswalk x JOIN subj.ol_subjects s ON s.id = x.ol_id
         ORDER BY x.work_id, x.ol_id`).iterate() as Iterable<{ work_id: string; ol_id: number; subjects: string }>) {
      if (r.work_id !== last) {
        if (last !== null) flushOl(last);
        last = r.work_id;
      }
      const seen = new Set<string>();
      for (const s of JSON.parse(r.subjects) as string[]) {
        const term = foldTerm(s);
        if (term === "" || seen.has(term)) continue;
        seen.add(term);
        if (notABookFact(term)) {
          counts.notABookFact++;
          continue;
        }
        const prev = terms.get(term);
        if (prev) prev.count++;
        else terms.set(term, { count: 1, ol: r.ol_id });
      }
    }
    if (last !== null) flushOl(last);
  }
  counts.works = (db.prepare("SELECT COUNT(DISTINCT work_id) AS n FROM work_features").get() as { n: number }).n;
  return counts;
}

/** Attach an Open Library subjects extract as schema `subj` (outside any transaction); returns its dump date. */
export function attachOlSubjects(db: DatabaseSync, path: string): string {
  if (!existsSync(path)) throw new Error(`Open Library subjects file not found: ${path} (run pnpm catalog:ol subjects)`);
  db.exec(`ATTACH DATABASE 'file:${path.replace(/\\/g, "/")}?mode=ro' AS subj`);
  const meta = Object.fromEntries((db.prepare("SELECT key, value FROM subj.meta").all() as Array<{ key: string; value: string }>).map((r) => [r.key, r.value]));
  if (Number(meta.schema_version) !== OL_SUBJECTS_SCHEMA_VERSION) {
    db.exec("DETACH DATABASE subj");
    throw new Error(`unsupported Open Library subjects schema_version ${meta.schema_version}`);
  }
  return meta.dump_date ?? "";
}

// ---------------------------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------------------------

/** Does this catalog file carry `work_features` (schema 4 and later)? */
export function hasWorkFeatures(db: DatabaseSync): boolean {
  return (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'work_features'").get() as { n: number }).n > 0;
}

interface Row {
  work_id: string;
  kind: FeatureKind;
  term: string;
  canon: string | null;
  family: string | null;
  count: number;
  source: FeatureSource;
  record_id: string;
  fetched: string;
}

const toFeature = (r: Row): WorkFeature => ({ workId: r.work_id, kind: r.kind, term: r.term, canon: r.canon, family: r.family, count: r.count, source: r.source, recordId: r.record_id, fetched: r.fetched });

/** Every feature of one work, by source then term. Empty when the catalog has no `work_features` table. */
export function workFeatures(db: DatabaseSync, workId: string): WorkFeature[] {
  if (!hasWorkFeatures(db)) return [];
  return (db.prepare("SELECT * FROM work_features WHERE work_id = ? ORDER BY source, term").all(workId) as unknown as Row[]).map(toFeature);
}

/** The canonical genres (and forms) of one work, per source: what KN-2's genre prior reads. */
export function workGenres(features: WorkFeature[], kinds: readonly FeatureKind[] = ["genre"]): Record<FeatureSource, string[]> {
  const out: Record<FeatureSource, string[]> = { "isfdb-tag": [], "openlibrary-subject": [] };
  for (const f of features) if (f.canon && kinds.includes(f.kind) && !out[f.source].includes(f.canon)) out[f.source].push(f.canon);
  return out;
}

/** A work's shared book knowledge as KN-2 reads it: genre and subject terms, and one form, each a row with provenance. */
export interface WorkKnowledge {
  workId: string;
  genres: WorkFeature[];
  subjects: WorkFeature[];
  /** The one form term (`pickForm`), or null when no source names one. */
  form: WorkFeature | null;
  /** Every form row, for audit. */
  forms: WorkFeature[];
}

/**
 * The one form of a work, from its form rows: a specific form (`novel`, `short-stories`, …) over the bare `fiction`,
 * then the most-carried (`count`), then ISFDB over Open Library, then the term. ISFDB's `works.ttype` is not used:
 * the yardstick's inventory catalog writes NOVEL for every book, so it is not a fact there.
 */
export function pickForm(forms: readonly WorkFeature[]): WorkFeature | null {
  const rank = (f: WorkFeature) => [f.canon === "fiction" ? 1 : 0, -f.count, FEATURE_SOURCES.indexOf(f.source), f.term] as const;
  const sorted = [...forms].sort((a, b) => {
    const x = rank(a);
    const y = rank(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
    return 0;
  });
  return sorted[0] ?? null;
}

/** `workFeatures` split for KN-2: genres, subjects and one form. */
export function workKnowledge(db: DatabaseSync, workId: string): WorkKnowledge {
  const all = workFeatures(db, workId);
  const forms = all.filter((f) => f.kind === "form");
  return { workId, genres: all.filter((f) => f.kind === "genre"), subjects: all.filter((f) => f.kind === "subject"), form: pickForm(forms), forms };
}

// ---------------------------------------------------------------------------------------------
// Store sections (SC-1) → genre and form terms
// ---------------------------------------------------------------------------------------------

/** SC-1's section families (`Family` in src/eval/sc1.ts; test/work-features.test.ts checks the two lists agree). */
export const SECTION_FAMILIES = ["sf-fantasy", "sf", "fantasy", "horror", "mystery", "romance", "young-adult", "children", "graphic", "poetry-drama", "classics", "literature", "nonfiction"] as const;
export type SectionFamily = (typeof SECTION_FAMILIES)[number];

/**
 * What a store section says in `work_features` terms: the genre families (`LEXICON`'s `family`) and the canons
 * (genre or form) a book shelved there may carry. Empty means the section names nothing the table records:
 * audience (`young-adult`, `children`, beyond picture books) and canon (`classics`) are not genres or forms here.
 */
export const SECTION_GENRES: Readonly<Record<SectionFamily, { families: readonly string[]; canons: readonly string[] }>> = {
  "sf-fantasy": { families: ["sf", "fantasy"], canons: [] },
  sf: { families: ["sf"], canons: [] },
  fantasy: { families: ["fantasy"], canons: [] },
  horror: { families: ["horror"], canons: [] },
  mystery: { families: ["crime", "thriller"], canons: [] },
  romance: { families: ["romance"], canons: [] },
  "young-adult": { families: [], canons: [] },
  children: { families: [], canons: ["picture-book"] },
  graphic: { families: [], canons: ["graphic-novel"] },
  "poetry-drama": { families: [], canons: ["poetry", "drama"] },
  classics: { families: [], canons: [] },
  literature: { families: ["literary"], canons: [] },
  nonfiction: { families: [], canons: ["nonfiction", "essays", "biography", "criticism", "letters", "reference"] },
};

/**
 * Does a work's shared book knowledge fit a store section? `true` when one of its genre or form rows names the
 * section's families or canons; `false` when it has genre or form rows and none does; `null` (unknown) when the
 * section maps to nothing or the work has no genre or form row. A missing term is never evidence against a section.
 */
export function sectionFits(section: SectionFamily, features: readonly WorkFeature[]): boolean | null {
  const want = SECTION_GENRES[section];
  if (want.families.length === 0 && want.canons.length === 0) return null;
  const typed = features.filter((f) => f.kind !== "subject" && f.canon !== null);
  if (typed.length === 0) return null;
  return typed.some((f) => (f.kind === "genre" && f.family !== null && want.families.includes(f.family)) || want.canons.includes(f.canon!));
}
