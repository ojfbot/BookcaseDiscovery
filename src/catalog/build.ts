// Build `catalog/catalog.sqlite` from the ISFDB staging file (C-3). The staging file keeps ISFDB's own
// tables; this step decides what a *work* is, folds variants in, normalises, and builds the three FTS5
// trigram indexes that `retrieve` reads. docs/catalog.md has the rules and the reasons. With `openLibrary` set
// (C-5), the Open Library staging file is crosswalked and merged in the same transaction (`ol-merge.ts`).
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { decodeEntities, normalize, splitSubtitle, surnameFirstToGivenFirst } from "./normalize.ts";
import { attachOpenLibrary, mergeOpenLibrary, type MergeCounts } from "./ol-merge.ts";

/**
 * Bump when a table or column of catalog.sqlite changes. `PRAGMA user_version` and `meta.schema_version` hold it.
 * 2 (C-5): `editions.source`. Version 1 files have no other difference, so readers accept both (`READABLE_SCHEMA_VERSIONS`).
 * 3 (C-9): `editions.publishers` and `editions.pub_series`. Readers that do not read them open every version.
 */
export const CATALOG_SCHEMA_VERSION = 3;
export const READABLE_SCHEMA_VERSIONS: readonly number[] = [1, 2, 3];

/**
 * ISFDB `title_ttype` values that count as a *work* on a shelf: whole books. Short fiction, essays, poems,
 * reviews, interviews, cover art and interior art are parts of books, not books; `SERIAL` and `EDITOR`
 * are magazine-level records; `MAGAZINE` and `FANZINE` are publication types, not title types.
 */
/** One-letter codes for the kinds of title form, used as a prefix in `works.title_norm` ('S:dune'). */
export const TITLE_KIND = { title: "T", main: "M", subtitle: "S", variant: "V", "variant-main": "W", "variant-subtitle": "X" } as const;

export const WORK_TTYPES = ["NOVEL", "COLLECTION", "OMNIBUS", "ANTHOLOGY", "CHAPBOOK", "NONFICTION"] as const;

/** How many user tags a work keeps (most-applied first). */
const MAX_TAGS = 8;
const MAX_SERIES_DEPTH = 4;

const SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;

CREATE TABLE works (
  id            TEXT PRIMARY KEY,   -- opaque: 'isfdb:<title_id>'
  title         TEXT NOT NULL,      -- the main title (before the first ': ')
  subtitle      TEXT,               -- the rest, if any
  authors       TEXT NOT NULL,      -- JSON array of canonical names, in ISFDB link order
  series        TEXT,               -- the direct series title
  series_num    TEXT,               -- position in it as ISFDB writes it ('1', '2a')
  year          INTEGER,            -- first-publication year, NULL if unknown
  ttype         TEXT NOT NULL,      -- NOVEL, COLLECTION, ...
  language      TEXT,
  non_genre     INTEGER NOT NULL,   -- ISFDB's non-genre flag
  graphic       INTEGER NOT NULL,   -- ISFDB's graphic-format flag
  tags          TEXT NOT NULL,      -- JSON array of user tags, most-applied first
  sources       TEXT NOT NULL,      -- JSON array of {source, id, ...}: where the work came from (OC32 joins on this)
  edition_count INTEGER NOT NULL,
  title_norm    TEXT NOT NULL,      -- normalised title forms, '|'-separated, each 'K:text' (K = a TITLE_KIND code: own title, subtitle splits, variant titles)
  author_norm   TEXT NOT NULL,      -- normalised author name forms, '|'-separated (own and variant authors)
  series_norm   TEXT NOT NULL       -- normalised series forms, '|'-separated (the series and its parents)
) WITHOUT ROWID;

CREATE TABLE editions (
  edition_id  TEXT NOT NULL,        -- opaque: 'isfdb-pub:<pub_id>'
  work_id     TEXT NOT NULL,
  isbn13      TEXT,
  isbn        TEXT,                 -- as ISFDB has it
  publisher   TEXT,                 -- the (first) publisher string
  publishers  TEXT,                 -- JSON array of every publisher string, in order, when there are 2+ (Open Library; C-9)
  pub_series  TEXT,                 -- the ISFDB publisher series the edition belongs to (C-9)
  year        INTEGER,
  title       TEXT,                 -- the title printed on this edition
  format      TEXT,                 -- ISFDB pub_ptype: pb, tp, hc, ...; Open Library physical_format as recorded
  source      TEXT NOT NULL DEFAULT 'isfdb', -- 'isfdb' or 'openlibrary' (edition_id 'ol:OL<n>M')
  PRIMARY KEY (work_id, edition_id)
) WITHOUT ROWID;
CREATE INDEX editions_isbn13 ON editions(isbn13);
CREATE INDEX editions_edition ON editions(edition_id);

CREATE TABLE title_forms (id INTEGER PRIMARY KEY, work_id TEXT NOT NULL, kind TEXT NOT NULL, norm TEXT NOT NULL);
CREATE INDEX title_forms_work ON title_forms(work_id);
CREATE INDEX title_forms_norm ON title_forms(norm);

CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE work_authors (work_id TEXT NOT NULL, author_id INTEGER NOT NULL, alias INTEGER NOT NULL, PRIMARY KEY (work_id, author_id)) WITHOUT ROWID;
CREATE INDEX work_authors_author ON work_authors(author_id);
CREATE TABLE author_forms (id INTEGER PRIMARY KEY, author_id INTEGER NOT NULL, norm TEXT NOT NULL);

CREATE TABLE series (id INTEGER PRIMARY KEY, title TEXT NOT NULL, parent_id INTEGER);
CREATE TABLE work_series (work_id TEXT NOT NULL, series_id INTEGER NOT NULL, depth INTEGER NOT NULL, PRIMARY KEY (work_id, series_id)) WITHOUT ROWID;
CREATE INDEX work_series_series ON work_series(series_id);
CREATE TABLE series_forms (id INTEGER PRIMARY KEY, series_id INTEGER NOT NULL, norm TEXT NOT NULL);

CREATE VIRTUAL TABLE fts_title  USING fts5(norm, content='', tokenize='trigram');
CREATE VIRTUAL TABLE fts_author USING fts5(norm, content='', tokenize='trigram');
CREATE VIRTUAL TABLE fts_series USING fts5(norm, content='', tokenize='trigram');
`;

export interface BuildResult {
  out: string;
  counts: Record<string, number>;
  stagingHash: string | null;
  openLibrary: MergeCounts | null;
  seconds: number;
}

type Row = Record<string, string | number | bigint | null | Uint8Array>;

const typeList = WORK_TTYPES.map((t) => `'${t}'`).join(",");

function yearOf(date: string | null | undefined): number | null {
  if (!date) return null;
  const y = Number(date.slice(0, 4));
  return Number.isInteger(y) && y > 0 && y < 8000 ? y : null;
}

export function buildCatalog(opts: { staging: string; out: string; openLibrary?: string; now?: () => Date; log?: (s: string) => void }): BuildResult {
  const log = opts.log ?? (() => {});
  const t0 = Date.now();
  if (!existsSync(opts.staging)) throw new Error(`staging file not found: ${opts.staging} (run pnpm catalog:import)`);
  if (opts.openLibrary && !existsSync(opts.openLibrary)) throw new Error(`Open Library staging file not found: ${opts.openLibrary} (run pnpm catalog:ol stage)`);
  mkdirSync(dirname(opts.out), { recursive: true });
  const partial = `${opts.out}.partial`;
  rmSync(partial, { force: true });

  const db = new DatabaseSync(partial);
  try {
    db.exec("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;");
    db.exec(SCHEMA);
    db.exec(`ATTACH DATABASE 'file:${opts.staging.replace(/\\/g, "/")}?mode=ro' AS st`);
    const stMeta = Object.fromEntries((db.prepare("SELECT key, value FROM st.meta").all() as Array<{ key: string; value: string }>).map((r) => [r.key, r.value]));
    if (Number(stMeta.schema_version) !== 1) throw new Error(`unsupported staging schema_version ${stMeta.schema_version}`);
    const olDumpDate = opts.openLibrary ? attachOpenLibrary(db, opts.openLibrary) : null;

    db.exec("BEGIN");

    // 1. member -> root map. A root work is a book-level title with no parent; its variants (translations,
    //    retitlings, pseudonymous editions) are other titles whose title_parent is the root.
    log("works: choosing roots and variants");
    db.exec(`
      CREATE TEMP TABLE member AS
        SELECT title_id AS member_id, title_id AS root_id, 0 AS is_variant FROM st.titles
         WHERE title_parent = 0 AND title_ttype IN (${typeList})
        UNION ALL
        SELECT v.title_id, v.title_parent, 1 FROM st.titles v JOIN st.titles r ON r.title_id = v.title_parent
         WHERE r.title_parent = 0 AND r.title_ttype IN (${typeList}) AND v.title_ttype IN (${typeList});
      CREATE INDEX temp.member_member ON member(member_id);
      CREATE INDEX temp.member_root ON member(root_id);
      CREATE TEMP TABLE root_pub AS
        SELECT DISTINCT m.root_id AS root_id, pc.pub_id AS pub_id FROM member m JOIN st.pub_content pc ON pc.title_id = m.member_id;
      CREATE INDEX temp.root_pub_root ON root_pub(root_id);
      CREATE TEMP TABLE root_count AS SELECT root_id, COUNT(*) AS n FROM root_pub GROUP BY root_id;
    `);

    // 2. editions
    log("editions");
    db.exec(`
      INSERT INTO editions (edition_id, work_id, isbn13, isbn, publisher, pub_series, year, title, format)
      SELECT 'isfdb-pub:' || p.pub_id, 'isfdb:' || rp.root_id, p.isbn13, NULLIF(p.pub_isbn, ''), pb.publisher_name, NULLIF(ps.pub_series_name, ''),
             CASE WHEN CAST(substr(p.pub_year, 1, 4) AS INTEGER) BETWEEN 1 AND 7999 THEN CAST(substr(p.pub_year, 1, 4) AS INTEGER) END,
             p.pub_title, NULLIF(p.pub_ptype, '')
        FROM root_pub rp JOIN st.pubs p ON p.pub_id = rp.pub_id LEFT JOIN st.publishers pb ON pb.publisher_id = p.publisher_id
        LEFT JOIN st.pub_series ps ON ps.pub_series_id = p.pub_series_id;
    `);

    // 3. series (all of them; works point at a chain)
    const seriesRows = (db.prepare("SELECT series_id AS id, series_title AS title, NULLIF(series_parent, 0) AS parent FROM st.series").all() as Array<{ id: number; title: string; parent: number | null }>).map((s) => ({ ...s, title: decodeEntities(s.title) }));
    const seriesById = new Map(seriesRows.map((s) => [s.id, s]));
    const insSeries = db.prepare("INSERT INTO series (id, title, parent_id) VALUES (?, ?, ?)");
    for (const s of seriesRows) insSeries.run(s.id, s.title, s.parent);
    const seriesChain = (id: number): number[] => {
      const chain: number[] = [];
      let cur: number | undefined | null = id;
      while (cur && seriesById.has(cur) && chain.length < MAX_SERIES_DEPTH && !chain.includes(cur)) {
        chain.push(cur);
        cur = seriesById.get(cur)!.parent;
      }
      return chain;
    };

    // 4. side data per root, loaded once and grouped in memory
    log("authors, aliases, tags");
    const authorsByRoot = new Map<number, Array<{ id: number; name: string; alias: boolean }>>();
    const authorForms = new Map<number, { name: string; legal: string | null }>();
    for (const r of db.prepare(`
        SELECT m.root_id AS root, m.is_variant AS alias, a.author_id AS id, a.author_canonical AS name, a.author_legalname AS legal
          FROM member m JOIN st.canonical_author ca ON ca.title_id = m.member_id AND ca.ca_status = 1
          JOIN st.authors a ON a.author_id = ca.author_id
         WHERE m.root_id IN (SELECT root_id FROM root_count)
         ORDER BY m.root_id, m.is_variant, ca.ca_id`).iterate() as Iterable<Row>) {
      const root = r.root as number;
      let list = authorsByRoot.get(root);
      if (!list) authorsByRoot.set(root, (list = []));
      const id = r.id as number;
      const existing = list.find((x) => x.id === id);
      if (existing) {
        if (!r.alias) existing.alias = false;
      } else {
        list.push({ id, name: decodeEntities(r.name as string), alias: r.alias === 1 });
      }
      authorForms.set(id, { name: decodeEntities(r.name as string), legal: (r.legal as string | null) || null });
    }
    const aliasTitlesByRoot = new Map<number, string[]>();
    for (const r of db.prepare(`
        SELECT DISTINCT m.root_id AS root, t.title_title AS title FROM member m JOIN st.titles t ON t.title_id = m.member_id
         WHERE m.is_variant = 1 AND m.root_id IN (SELECT root_id FROM root_count)`).iterate() as Iterable<Row>) {
      const root = r.root as number;
      let list = aliasTitlesByRoot.get(root);
      if (!list) aliasTitlesByRoot.set(root, (list = []));
      list.push(r.title as string);
    }
    const tagsByRoot = new Map<number, string[]>();
    for (const r of db.prepare(`
        SELECT root, name FROM (
          SELECT m.root_id AS root, tg.tag_name AS name, COUNT(DISTINCT tm.user_id) AS n
            FROM member m JOIN st.tag_mapping tm ON tm.title_id = m.member_id JOIN st.tags tg ON tg.tag_id = tm.tag_id
           WHERE m.root_id IN (SELECT root_id FROM root_count)
           GROUP BY m.root_id, tg.tag_id)
         ORDER BY root, n DESC, name`).iterate() as Iterable<Row>) {
      const root = r.root as number;
      let list = tagsByRoot.get(root);
      if (!list) tagsByRoot.set(root, (list = []));
      if (list.length < MAX_TAGS) list.push(decodeEntities(r.name as string));
    }

    // 5. authors table and forms
    const insAuthor = db.prepare("INSERT INTO authors (id, name) VALUES (?, ?)");
    const insAuthorForm = db.prepare("INSERT INTO author_forms (id, author_id, norm) VALUES (?, ?, ?)");
    const insFtsAuthor = db.prepare("INSERT INTO fts_author (rowid, norm) VALUES (?, ?)");
    const formsOfAuthor = new Map<number, string[]>();
    let authorFormId = 0;
    const usedAuthors = new Set<number>();
    for (const list of authorsByRoot.values()) for (const a of list) usedAuthors.add(a.id);
    for (const id of [...usedAuthors].sort((a, b) => a - b)) {
      const a = authorForms.get(id)!;
      insAuthor.run(id, a.name);
      const forms = new Set<string>();
      forms.add(normalize(a.name));
      if (a.legal) forms.add(normalize(surnameFirstToGivenFirst(a.legal)));
      forms.delete("");
      formsOfAuthor.set(id, [...forms]);
      for (const f of forms) {
        authorFormId++;
        insAuthorForm.run(authorFormId, id, f);
        insFtsAuthor.run(authorFormId, f);
      }
    }

    // 6. works
    log("works: forms and indexes");
    const insWork = db.prepare(`INSERT INTO works (id, title, subtitle, authors, series, series_num, year, ttype, language, non_genre, graphic, tags, sources,
        edition_count, title_norm, author_norm, series_norm) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insTitleForm = db.prepare("INSERT INTO title_forms (id, work_id, kind, norm) VALUES (?, ?, ?, ?)");
    const insFtsTitle = db.prepare("INSERT INTO fts_title (rowid, norm) VALUES (?, ?)");
    const insWorkAuthor = db.prepare("INSERT INTO work_authors (work_id, author_id, alias) VALUES (?, ?, ?)");
    const insWorkSeries = db.prepare("INSERT INTO work_series (work_id, series_id, depth) VALUES (?, ?, ?)");
    const insSeriesForm = db.prepare("INSERT INTO series_forms (id, series_id, norm) VALUES (?, ?, ?)");
    const insFtsSeries = db.prepare("INSERT INTO fts_series (rowid, norm) VALUES (?, ?)");
    const seriesFormDone = new Set<number>();
    let seriesFormId = 0;
    let titleFormId = 0;
    let workCount = 0;
    const dumpDate = stMeta.dump_date ?? null;

    const rows = db.prepare(`
      SELECT t.title_id AS id, t.title_title AS title, t.series_id AS series_id, t.title_seriesnum_2 AS num2, t.title_seriesnum AS num,
             t.title_copyright AS copyright, t.title_ttype AS ttype, l.lang_name AS language, t.title_non_genre AS non_genre,
             t.title_graphic AS graphic, c.n AS editions
        FROM st.titles t JOIN root_count c ON c.root_id = t.title_id LEFT JOIN st.languages l ON l.lang_id = t.title_language
       ORDER BY t.title_id`);
    for (const r of rows.iterate() as Iterable<Row>) {
      const id = r.id as number;
      const workId = `isfdb:${id}`;
      const full = decodeEntities(r.title as string);
      const { main, subtitle } = splitSubtitle(full);

      // title forms: the title as recorded; the main part and the subtitle alone; each variant title likewise
      const forms = new Map<string, string>(); // norm -> kind (first kind wins)
      const add = (text: string, kind: string) => {
        const n = normalize(text);
        if (n !== "" && !forms.has(n)) forms.set(n, kind);
      };
      add(full, "title");
      if (subtitle) {
        add(main, "main");
        add(subtitle, "subtitle");
      }
      for (const alt of aliasTitlesByRoot.get(id) ?? []) {
        const s = splitSubtitle(decodeEntities(alt));
        add(decodeEntities(alt), "variant");
        if (s.subtitle) {
          add(s.main, "variant-main");
          add(s.subtitle, "variant-subtitle");
        }
      }
      for (const [norm, kind] of forms) {
        titleFormId++;
        insTitleForm.run(titleFormId, workId, kind, norm);
        insFtsTitle.run(titleFormId, norm);
      }
      const titleNorm = [...forms].map(([norm, kind]) => `${TITLE_KIND[kind as keyof typeof TITLE_KIND]}:${norm}`).join("|");

      const authorList = authorsByRoot.get(id) ?? [];
      const authorNorms = new Set<string>();
      for (const a of authorList) {
        insWorkAuthor.run(workId, a.id, a.alias ? 1 : 0);
        for (const f of formsOfAuthor.get(a.id) ?? []) authorNorms.add(f);
      }
      const names = authorList.filter((a) => !a.alias).map((a) => a.name);

      const seriesIds = r.series_id ? seriesChain(r.series_id as number) : [];
      const seriesNorms: string[] = [];
      seriesIds.forEach((sid, depth) => {
        insWorkSeries.run(workId, sid, depth);
        const n = normalize(seriesById.get(sid)!.title);
        if (n !== "") seriesNorms.push(n);
        if (!seriesFormDone.has(sid)) {
          seriesFormDone.add(sid);
          if (n !== "") {
            seriesFormId++;
            insSeriesForm.run(seriesFormId, sid, n);
            insFtsSeries.run(seriesFormId, n);
          }
        }
      });

      const num = (r.num2 as string | null) || (r.num ? String(r.num) : null);
      insWork.run(
        workId, main, subtitle, JSON.stringify(names),
        seriesIds.length ? seriesById.get(seriesIds[0]!)!.title : null, seriesIds.length ? num : null,
        yearOf(r.copyright as string), r.ttype as string, (r.language as string | null) ?? null,
        r.non_genre === "Yes" ? 1 : 0, r.graphic === "Yes" ? 1 : 0, JSON.stringify(tagsByRoot.get(id) ?? []),
        JSON.stringify([{ source: "isfdb", id, dump: dumpDate }]),
        r.editions as number, titleNorm, [...authorNorms].join("|"), seriesNorms.join("|"),
      );
      workCount++;
    }

    // 7. Open Library (C-5): crosswalk to the ISFDB works above, add the rest as works of their own
    const ol = olDumpDate !== null ? { dumpDate: olDumpDate, counts: mergeOpenLibrary(db, olDumpDate, log) } : null;

    const counts: Record<string, number> = { works: (db.prepare("SELECT COUNT(*) AS n FROM works").get() as { n: number }).n, isfdbWorks: workCount };
    for (const t of ["editions", "authors", "work_authors", "series", "work_series", "title_forms", "author_forms", "series_forms"]) {
      counts[t] = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    }
    const insMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
    insMeta.run("schema_version", String(CATALOG_SCHEMA_VERSION));
    insMeta.run("built_at", (opts.now ?? (() => new Date()))().toISOString());
    insMeta.run("staging_content_hash", stMeta.content_hash ?? "");
    insMeta.run("staging_dump_date", dumpDate ?? "");
    insMeta.run("work_ttypes", WORK_TTYPES.join(","));
    for (const [k, v] of Object.entries(counts)) insMeta.run(`rows.${k}`, String(v));
    insMeta.run("sources", ol ? "isfdb,openlibrary" : "isfdb");
    if (ol) {
      insMeta.run("openlibrary_dump_date", ol.dumpDate);
      for (const [k, v] of Object.entries(ol.counts)) insMeta.run(`openlibrary.${k}`, String(v));
    }

    db.exec("COMMIT");
    log("optimising");
    db.exec("INSERT INTO fts_title(fts_title) VALUES('optimize'); INSERT INTO fts_author(fts_author) VALUES('optimize'); INSERT INTO fts_series(fts_series) VALUES('optimize');");
    db.exec("DETACH DATABASE st");
    if (ol) db.exec("DETACH DATABASE ol");
    db.exec(`PRAGMA user_version = ${CATALOG_SCHEMA_VERSION}`);
    db.close();
    rmSync(opts.out, { force: true });
    renameSync(partial, opts.out);
    return { out: opts.out, counts, stagingHash: stMeta.content_hash ?? null, openLibrary: ol?.counts ?? null, seconds: (Date.now() - t0) / 1000 };
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

export function catalogFileSize(path: string): number {
  return statSync(path).size;
}
