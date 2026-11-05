// The local tier of catalog lookups (card C-10): before any live call, the box's readings are retrieved
// against the local catalogs and each candidate work is tried as a record under C-4's resolution rule.
//
//   readings -> retrieve(ISFDB catalog, top 10) -> retrieve(catalog-v2, top 10, Open Library works only) -> resolves?
//
// A local work becomes an `OutsideRecord`: its main title and subtitle, its authors, its editions' ISBNs, and
// for an ISFDB work its tags as subjects. Only the rule decides; retrieval only proposes.
import type { DatabaseSync } from "node:sqlite";
import { resolves, type LocalTier, type OutsideRecord, type ReaderText } from "./coverage.ts";
import { LOOKUP } from "./lookup.ts";
import { retrieve } from "./retrieve.ts";

interface WorkRow {
  id: string;
  title: string;
  subtitle: string | null;
  authors: string;
  tags: string;
  sources: string;
  year: number | null;
}

/** A catalog work as a record; null when the work is not in this catalog. */
export function workRecord(db: DatabaseSync, id: string): OutsideRecord | null {
  const w = db.prepare("SELECT id, title, subtitle, authors, tags, sources, year FROM works WHERE id = ?").get(id) as WorkRow | undefined;
  if (!w) return null;
  const isbns = (db.prepare("SELECT DISTINCT isbn13 FROM editions WHERE work_id = ? AND isbn13 IS NOT NULL").all(id) as { isbn13: string }[]).map((e) => e.isbn13);
  const ol = id.startsWith("ol:");
  return {
    source: ol ? "openlibrary" : "isfdb",
    id,
    title: w.title,
    subtitle: w.subtitle,
    authors: JSON.parse(w.authors) as string[],
    isbns,
    subjects: ol ? [] : (JSON.parse(w.tags) as string[]),
    year: w.year,
  };
}

const heldByOpenLibrary = (sources: string) => (JSON.parse(sources) as { source: string }[]).some((s) => s.source === "openlibrary");

/**
 * `isfdb` is the ISFDB catalog in use (the coverage command's `--db`); `v2` is `catalog-v2.sqlite`, whose
 * Open Library works (`ol:` ids) are the second local tier. Without `v2` only the ISFDB tier runs.
 */
export function localTier(isfdb: DatabaseSync, v2: DatabaseSync | null, k: number = LOOKUP.localTopK): LocalTier {
  const first = (db: DatabaseSync, variants: string[], keep: (id: string) => boolean, texts: ReaderText[]) => {
    for (const c of retrieve(db, variants, k)) {
      if (!keep(c.workId)) continue;
      const rec = workRecord(db, c.workId);
      if (rec && resolves(rec, texts)) return rec;
    }
    return null;
  };
  return {
    resolve(texts) {
      const variants = texts.map((t) => t.text);
      if (variants.length === 0) return null;
      const own = first(isfdb, variants, () => true, texts);
      if (own) return { tier: "local-isfdb", record: own };
      const ol = v2 ? first(v2, variants, (id) => id.startsWith("ol:"), texts) : null;
      return ol ? { tier: "local-openlibrary", record: ol } : null;
    },
    inOpenLibrary(record) {
      if (!v2) return false;
      if (record.source === "isfdb") {
        const row = v2.prepare("SELECT sources FROM works WHERE id = ?").get(record.id) as { sources: string } | undefined;
        if (row && heldByOpenLibrary(row.sources)) return true;
      }
      const clean = [{ reader: "qwen" as const, text: `${record.title} ${record.authors.join(" ")}` }];
      for (const c of retrieve(v2, [clean[0].text], k)) {
        const row = v2.prepare("SELECT sources FROM works WHERE id = ?").get(c.workId) as { sources: string } | undefined;
        if (!row || !heldByOpenLibrary(row.sources)) continue;
        const rec = workRecord(v2, c.workId);
        if (rec && resolves(rec, clean)) return true;
      }
      return false;
    },
  };
}
