// Merge the Open Library staging file into a catalog being built (C-5). Runs inside `buildCatalog`'s transaction,
// after the ISFDB works, editions and forms are in place.
//
// Crosswalk, per Open Library work: (1) ISBN: its editions' ISBN-13s against ISFDB's `editions.isbn13`; the ISFDB
// work most of them point at wins (a title match breaks ties, since an omnibus edition's ISBN points at every work
// in it). (2) Otherwise title plus author: the work's title key equals an ISFDB title form's, and an Open Library
// author's surname is one of that work's author surnames. A crosswalked work creates no new Work: its editions
// (those whose ISBN the ISFDB work lacks) are added to the ISFDB work and its id is added to the work's `sources`.
// Every other kept Open Library work becomes a Work `ol:OL<n>W`. Work and Edition stay separate (CONTEXT.md).
import type { DatabaseSync } from "node:sqlite";
import { normalize, splitSubtitle, surnameFirstToGivenFirst, tokenize } from "./normalize.ts";
import { READABLE_OL_STAGING_VERSIONS, titleKey } from "./ol-dump.ts";
import { surnameOf } from "./coverage.ts";

/** Open Library has no work type; its works are stored with this `ttype`. */
export const OL_TTYPE = "BOOK";
/** Author ids for authors only Open Library knows: this offset plus the Open Library author number. */
export const OL_AUTHOR_ID_BASE = 1_000_000_000;

export interface MergeCounts {
  olWorks: number;
  crosswalkIsbn: number;
  /** ISBN crosswalks whose Open Library title key matches no title form of the ISFDB work (a quality probe). */
  crosswalkIsbnTitleDiffers: number;
  crosswalkTitleAuthor: number;
  newWorks: number;
  newWorksShelf: number;
  editionsAdded: number;
  editionsToIsfdbWorks: number;
  newAuthors: number;
  reusedIsfdbAuthors: number;
}

interface OlWork { id: number; title: string; subtitle: string | null; authors: string; year: number | null; english: number; layer: string }
interface OlEdition { id: number; isbn13: string | null; isbns: string; isbn: string | null; publisher: string | null; publishers: string | null; year: number | null; title: string | null; format: string | null }

const noArticle = (t: string) => t.replace(/^(the|a|an) /, "");

/**
 * Attaches the staging file as schema `ol` (outside any transaction: SQLite refuses ATTACH inside one); returns its dump
 * date. A version 1 file has no `publishers` column: its editions keep the first publisher only.
 */
export function attachOpenLibrary(db: DatabaseSync, stagingPath: string): string {
  db.exec(`ATTACH DATABASE 'file:${stagingPath.replace(/\\/g, "/")}?mode=ro' AS ol`);
  const meta = Object.fromEntries((db.prepare("SELECT key, value FROM ol.meta").all() as Array<{ key: string; value: string }>).map((r) => [r.key, r.value]));
  if (!READABLE_OL_STAGING_VERSIONS.includes(Number(meta.schema_version))) {
    db.exec("DETACH DATABASE ol");
    throw new Error(`unsupported Open Library staging schema_version ${meta.schema_version}`);
  }
  return meta.dump_date ?? "";
}

/** Merges the attached `ol` staging schema into the catalog's tables. Call inside the build's transaction. */
export function mergeOpenLibrary(db: DatabaseSync, dumpDate: string, log: (s: string) => void = () => {}): MergeCounts {
  return merge(db, dumpDate, log);
}

function merge(db: DatabaseSync, dumpDate: string, log: (s: string) => void): MergeCounts {
  const counts: MergeCounts = { olWorks: 0, crosswalkIsbn: 0, crosswalkIsbnTitleDiffers: 0, crosswalkTitleAuthor: 0, newWorks: 0, newWorksShelf: 0, editionsAdded: 0, editionsToIsfdbWorks: 0, newAuthors: 0, reusedIsfdbAuthors: 0 };

  log("open library: crosswalk tables");
  const worksByIsbn = new Map<string, string[]>();
  for (const r of db.prepare("SELECT isbn13, work_id FROM editions WHERE isbn13 IS NOT NULL").iterate() as Iterable<{ isbn13: string; work_id: string }>) {
    const list = worksByIsbn.get(r.isbn13);
    if (!list) worksByIsbn.set(r.isbn13, [r.work_id]);
    else if (!list.includes(r.work_id)) list.push(r.work_id);
  }
  const worksByTitle = new Map<string, string[]>();
  const titleKeysOf = new Map<string, Set<string>>();
  for (const r of db.prepare("SELECT work_id, norm FROM title_forms").iterate() as Iterable<{ work_id: string; norm: string }>) {
    const k = noArticle(r.norm);
    const list = worksByTitle.get(k);
    if (!list) worksByTitle.set(k, [r.work_id]);
    else if (!list.includes(r.work_id)) list.push(r.work_id);
    let ks = titleKeysOf.get(r.work_id);
    if (!ks) titleKeysOf.set(r.work_id, (ks = new Set()));
    ks.add(k);
  }
  const authorIdByNorm = new Map<string, number>();
  for (const r of db.prepare("SELECT author_id, norm FROM author_forms ORDER BY author_id, id").iterate() as Iterable<{ author_id: number; norm: string }>) {
    if (!authorIdByNorm.has(r.norm)) authorIdByNorm.set(r.norm, r.author_id);
  }
  const isfdbAuthorIds = new Set(authorIdByNorm.values());

  const workRow = db.prepare("SELECT author_norm, edition_count, sources FROM works WHERE id = ?");
  const surnamesOfWork = (id: string): Set<string> => {
    const r = workRow.get(id) as { author_norm: string } | undefined;
    return new Set((r?.author_norm ?? "").split("|").filter(Boolean).map((a) => tokenize(a).at(-1) ?? ""));
  };
  const edCount = (id: string) => ((workRow.get(id) as { edition_count: number } | undefined)?.edition_count ?? 0);

  const olAuthor = db.prepare("SELECT name FROM ol.ol_authors WHERE id = ?");
  const hasPublishers = (db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('ol_editions', 'ol') WHERE name = 'publishers'").get() as { n: number }).n > 0;
  const olEditions = db.prepare(`SELECT id, isbn13, isbns, isbn, publisher, ${hasPublishers ? "publishers" : "NULL AS publishers"}, year, title, format FROM ol.ol_editions WHERE work_id = ? ORDER BY id`);
  const isbnsOnWork = db.prepare("SELECT isbn13 FROM editions WHERE work_id = ? AND isbn13 IS NOT NULL");
  const insEdition = db.prepare("INSERT OR IGNORE INTO editions (edition_id, work_id, isbn13, isbn, publisher, publishers, year, title, format, source) VALUES (?,?,?,?,?,?,?,?,?, 'openlibrary')");
  const updWork = db.prepare("UPDATE works SET sources = ?, edition_count = edition_count + ? WHERE id = ?");
  const insWork = db.prepare(`INSERT INTO works (id, title, subtitle, authors, series, series_num, year, ttype, language, non_genre, graphic, tags, sources,
      edition_count, title_norm, author_norm, series_norm) VALUES (?,?,?,?,NULL,NULL,?,?,?,0,0,'[]',?,?,?,?,'')`);
  const insTitleForm = db.prepare("INSERT INTO title_forms (id, work_id, kind, norm) VALUES (?, ?, ?, ?)");
  const insFtsTitle = db.prepare("INSERT INTO fts_title (rowid, norm) VALUES (?, ?)");
  const insAuthor = db.prepare("INSERT INTO authors (id, name) VALUES (?, ?)");
  const insAuthorForm = db.prepare("INSERT INTO author_forms (id, author_id, norm) VALUES (?, ?, ?)");
  const insFtsAuthor = db.prepare("INSERT INTO fts_author (rowid, norm) VALUES (?, ?)");
  const insWorkAuthor = db.prepare("INSERT OR IGNORE INTO work_authors (work_id, author_id, alias) VALUES (?, ?, 0)");
  let titleFormId = (db.prepare("SELECT COALESCE(MAX(id), 0) AS n FROM title_forms").get() as { n: number }).n;
  let authorFormId = (db.prepare("SELECT COALESCE(MAX(id), 0) AS n FROM author_forms").get() as { n: number }).n;
  const formsOfAuthor = new Map<number, string[]>();

  /** The catalog author for an Open Library author: an existing author with the same normalised name, or a new one. */
  const authorFor = (olId: number): { id: number; name: string; forms: string[] } | null => {
    const raw = (olAuthor.get(olId) as { name: string } | undefined)?.name;
    if (!raw) return null;
    const name = surnameFirstToGivenFirst(raw.replace(/[\s,;]+$/, ""));
    const forms = [...new Set([normalize(name), normalize(raw)])].filter((f) => f !== "");
    if (forms.length === 0) return null;
    for (const f of forms) {
      const id = authorIdByNorm.get(f);
      if (id !== undefined) {
        if (isfdbAuthorIds.has(id)) counts.reusedIsfdbAuthors++;
        return { id, name, forms: formsOfAuthor.get(id) ?? [f] };
      }
    }
    const id = OL_AUTHOR_ID_BASE + olId;
    insAuthor.run(id, name);
    for (const f of forms) {
      authorFormId++;
      insAuthorForm.run(authorFormId, id, f);
      insFtsAuthor.run(authorFormId, f);
      authorIdByNorm.set(f, id);
    }
    formsOfAuthor.set(id, forms);
    counts.newAuthors++;
    return { id, name, forms };
  };

  log("open library: works");
  for (const w of db.prepare("SELECT id, title, subtitle, authors, year, english, layer FROM ol.ol_works ORDER BY id").iterate() as Iterable<OlWork>) {
    if (++counts.olWorks % 500_000 === 0) log(`open library: ${counts.olWorks.toLocaleString("en-US")} works`);
    const eds = olEditions.all(w.id) as unknown as OlEdition[];
    const key = titleKey(w.title);
    const authorIds = JSON.parse(w.authors) as number[];

    // 1. ISBN crosswalk
    let target: string | null = null;
    const votes = new Map<string, number>();
    for (const e of eds) {
      for (const isbn of JSON.parse(e.isbns) as string[]) for (const wid of worksByIsbn.get(isbn) ?? []) votes.set(wid, (votes.get(wid) ?? 0) + 1);
    }
    if (votes.size > 0) {
      const ranked = [...votes].map(([wid, v]) => ({ wid, v: v + (titleKeysOf.get(wid)?.has(key) ? 0.5 : 0) })).sort((a, b) => b.v - a.v || (a.wid < b.wid ? -1 : 1));
      target = ranked[0]!.wid;
      counts.crosswalkIsbn++;
      if (!titleKeysOf.get(target)?.has(key)) counts.crosswalkIsbnTitleDiffers++;
    }
    // 2. title plus author surname
    let olSurnames: Set<string> | null = null;
    if (!target && key !== "") {
      const cands = worksByTitle.get(key) ?? [];
      if (cands.length > 0) {
        olSurnames = new Set(authorIds.map((a) => (olAuthor.get(a) as { name: string } | undefined)?.name).map((n) => (n ? surnameOf(n) : null)).filter((s): s is string => s !== null));
        const hits = cands.filter((c) => !c.startsWith("ol:") && [...surnamesOfWork(c)].some((s) => olSurnames!.has(s)));
        if (hits.length > 0) {
          target = hits.sort((a, b) => edCount(b) - edCount(a) || (a < b ? -1 : 1))[0]!;
          counts.crosswalkTitleAuthor++;
        }
      }
    }

    if (target) {
      const have = new Set((isbnsOnWork.all(target) as Array<{ isbn13: string }>).map((r) => r.isbn13));
      let added = 0;
      for (const e of eds) {
        if (e.isbn13 && have.has(e.isbn13)) continue;
        insEdition.run(`ol:OL${e.id}M`, target, e.isbn13, e.isbn, e.publisher, e.publishers, e.year, e.title, e.format);
        if (e.isbn13) have.add(e.isbn13);
        added++;
      }
      const row = workRow.get(target) as { sources: string };
      const sources = JSON.parse(row.sources) as unknown[];
      sources.push({ source: "openlibrary", id: `OL${w.id}W`, dump: dumpDate, layer: w.layer });
      updWork.run(JSON.stringify(sources), added, target);
      counts.editionsAdded += added;
      counts.editionsToIsfdbWorks += added;
      continue;
    }

    // 3. a new Work
    const workId = `ol:OL${w.id}W`;
    const { main, subtitle } = w.subtitle ? { main: w.title, subtitle: w.subtitle } : splitSubtitle(w.title);
    const full = subtitle ? `${main}: ${subtitle}` : main;
    const forms = new Map<string, string>(); // norm -> kind code
    const add = (text: string, kind: string) => {
      const n = normalize(text);
      if (n !== "" && !forms.has(n)) forms.set(n, kind);
    };
    add(full, "T");
    if (subtitle) {
      add(main, "M");
      add(subtitle, "S");
    }
    if (forms.size === 0) continue;
    for (const [norm, kind] of forms) {
      titleFormId++;
      insTitleForm.run(titleFormId, workId, ({ T: "title", M: "main", S: "subtitle" } as Record<string, string>)[kind]!, norm);
      insFtsTitle.run(titleFormId, norm);
    }
    const names: string[] = [];
    const authorNorms = new Set<string>();
    for (const a of authorIds) {
      const au = authorFor(a);
      if (!au) continue;
      insWorkAuthor.run(workId, au.id);
      if (!names.includes(au.name)) names.push(au.name);
      for (const f of au.forms) authorNorms.add(f);
    }
    for (const e of eds) insEdition.run(`ol:OL${e.id}M`, workId, e.isbn13, e.isbn, e.publisher, e.publishers, e.year, e.title, e.format);
    insWork.run(
      workId, main, subtitle, JSON.stringify(names), w.year, OL_TTYPE, w.english ? "English" : null,
      JSON.stringify([{ source: "openlibrary", id: `OL${w.id}W`, dump: dumpDate, layer: w.layer }]), eds.length,
      [...forms].map(([norm, kind]) => `${kind}:${norm}`).join("|"), [...authorNorms].join("|"),
    );
    counts.newWorks++;
    if (w.layer !== "breadth") counts.newWorksShelf++;
    counts.editionsAdded += eds.length;
  }
  return counts;
}
