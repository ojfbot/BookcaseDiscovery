// Spot checks over the staging database (C-1 exit): a known title must resolve to its author and
// carry ISBNs. The seeds are the owner's public authors (OC9 allows these).
import type { DatabaseSync } from "node:sqlite";

export interface SpotCheckCase {
  title: string;
  author: string;
}

export const SPOT_CHECKS: ReadonlyArray<SpotCheckCase> = [
  { title: "Neuromancer", author: "William Gibson" },
  { title: "Red Mars", author: "Kim Stanley Robinson" },
  { title: "Snow Crash", author: "Neal Stephenson" },
];

export interface SpotCheckEdition {
  pubId: number;
  pubTitle: string;
  year: string | null;
  publisher: string | null;
  isbn: string | null;
  isbn13: string | null;
}

export interface SpotCheckResult {
  case: SpotCheckCase;
  ok: boolean;
  /** NOVEL titles with this exact title whose canonical author is `author`, variants (`title_parent`) included. */
  workIds: number[];
  /** Distinct canonical author names on those works. */
  authors: string[];
  editions: SpotCheckEdition[];
}

/**
 * A *work* here is a NOVEL `titles` row with the exact title and a `canonical_author` link to the
 * author. Its *editions* are the `pubs` that hold the work or any variant of it (`title_parent`)
 * through `pub_content`. Passes when at least one work is found and at least one edition has a valid ISBN.
 */
export function spotCheck(db: DatabaseSync, c: SpotCheckCase): SpotCheckResult {
  const works = db
    .prepare(
      `SELECT DISTINCT t.title_id AS id
         FROM titles t
         JOIN canonical_author ca ON ca.title_id = t.title_id
         JOIN authors a ON a.author_id = ca.author_id
        WHERE t.title_title = ? AND t.title_ttype = 'NOVEL' AND t.title_parent = 0 AND a.author_canonical = ?
        ORDER BY t.title_id`,
    )
    .all(c.title, c.author) as Array<{ id: number }>;
  const workIds = works.map((w) => w.id);
  if (workIds.length === 0) return { case: c, ok: false, workIds, authors: [], editions: [] };

  const marks = workIds.map(() => "?").join(",");
  const authors = (
    db
      .prepare(
        `SELECT DISTINCT a.author_canonical AS name
           FROM canonical_author ca JOIN authors a ON a.author_id = ca.author_id
          WHERE ca.title_id IN (${marks}) ORDER BY name`,
      )
      .all(...workIds) as Array<{ name: string }>
  ).map((r) => r.name);

  const editions = (
    db
      .prepare(
        `SELECT DISTINCT p.pub_id AS pubId, p.pub_title AS pubTitle, p.pub_year AS year, pr.publisher_name AS publisher,
                p.pub_isbn AS isbn, p.isbn13 AS isbn13
           FROM titles t
           JOIN pub_content pc ON pc.title_id = t.title_id
           JOIN pubs p ON p.pub_id = pc.pub_id
           LEFT JOIN publishers pr ON pr.publisher_id = p.publisher_id
          WHERE t.title_id IN (${marks}) OR t.title_parent IN (${marks})
          ORDER BY p.pub_year = '0000-00-00', p.pub_year, p.pub_id`,
      )
      .all(...workIds, ...workIds) as unknown as SpotCheckEdition[]
  ).map((e) => ({ ...e }));

  const ok = authors.includes(c.author) && editions.some((e) => e.isbn13 !== null);
  return { case: c, ok, workIds, authors, editions };
}

export function runSpotChecks(db: DatabaseSync, cases: ReadonlyArray<SpotCheckCase> = SPOT_CHECKS): SpotCheckResult[] {
  return cases.map((c) => spotCheck(db, c));
}
