// Expansion (card R-1): "read all of William Gibson" becomes one `read` entry per Gibson novel in the
// catalog, each marked `expanded: true`. Only the compact seed (`scope: all-works`) is stored in
// `profile/seeds.json`; the per-novel entries are generated here at build time, from the catalog
// (`$BOOKCASE_DATA/catalog/catalog.sqlite`, C-3). That keeps the public file three lines long and
// reviewable, and the catalog (not a hand-typed list) decides what "all" means.
//
// What counts as a novel (docs/recommend/taste-model.md §3; this is the card's decision):
//   - a catalog work (a root ISFDB title with an edition) whose `ttype` is NOVEL, linked to the author
//     as a credited author (`work_authors.alias = 0`), so a co-written novel counts and a variant's
//     pseudonymous or translated credit does not; and
//   - with at least one edition that is not audio-only. ISFDB files some audio-only productions as
//     NOVEL (an Audible Original adapted from a screenplay, say); "read" is a claim about a book the
//     owner could have read, so an audio-only title is left out rather than marked read.
// Collections, omnibuses, anthologies, chapbooks and non-fiction are not novels and are not expanded.
// Both lists are reported, so what was left out is visible (the O-4 review sheet shows them).
//
// Only `read` seeds expand. A `liked` or `cooler` author stays at author level: expanding it would
// state a verdict on every title the owner never rated (taste-model.md §6.3, "author liked, title not
// rated"). R-2 reads those authors' works from the catalog with `worksOfAuthor`.
import type { DatabaseSync } from "node:sqlite";
import type { ResolvedEntry, ResolvedProfile } from "./profile.ts";

export const EXPANDED_TTYPES = ["NOVEL"] as const;

export interface CatalogWork {
  id: string;
  title: string;
  year: number | null;
  authors: string[];
}

export interface Exclusion extends CatalogWork {
  ttype: string;
  reason: "not-a-novel" | "audio-only";
}

export interface AuthorWorks {
  /** False when the catalog has no author by this canonical name. */
  found: boolean;
  novels: CatalogWork[];
  excluded: Exclusion[];
}

interface Row {
  id: string;
  title: string;
  year: number | null;
  authors: string;
  ttype: string;
  has_text: number;
}

/**
 * The works the catalog credits to an author, split into novels and the rest. The name is the ISFDB
 * canonical name, matched exactly; two authors by one name would be a catalog fault, so it throws.
 */
export function worksOfAuthor(db: DatabaseSync, name: string): AuthorWorks {
  const authors = db.prepare("SELECT id FROM authors WHERE name = ?").all(name) as { id: number }[];
  if (authors.length === 0) return { found: false, novels: [], excluded: [] };
  if (authors.length > 1) throw new Error(`the catalog has ${authors.length} authors named "${name}"`);
  const rows = db
    .prepare(
      `SELECT w.id, w.title, w.year, w.authors, w.ttype,
              EXISTS (SELECT 1 FROM editions e WHERE e.work_id = w.id AND (e.format IS NULL OR e.format NOT LIKE '%audio%')) AS has_text
         FROM works w JOIN work_authors wa ON wa.work_id = w.id
        WHERE wa.author_id = ? AND wa.alias = 0
        ORDER BY w.year IS NULL, w.year, w.title, w.id`,
    )
    .all(authors[0]!.id) as unknown as Row[];
  const novels: CatalogWork[] = [];
  const excluded: Exclusion[] = [];
  for (const r of rows) {
    const work: CatalogWork = { id: r.id, title: r.title, year: r.year, authors: JSON.parse(r.authors) as string[] };
    if (!(EXPANDED_TTYPES as readonly string[]).includes(r.ttype)) excluded.push({ ...work, ttype: r.ttype, reason: "not-a-novel" });
    else if (!r.has_text) excluded.push({ ...work, ttype: r.ttype, reason: "audio-only" });
    else novels.push(work);
  }
  return { found: true, novels, excluded };
}

export interface ExpansionReport {
  seedId: string;
  author: string;
  found: boolean;
  novels: CatalogWork[];
  excluded: Exclusion[];
  /** Why a seed that asked for expansion was not expanded. */
  skipped?: string;
}

export interface Expansion {
  profile: ResolvedProfile;
  reports: ExpansionReport[];
}

const wantsExpansion = (e: ResolvedEntry) => !e.expanded && e.relation === "read" && e.scope === "all-works";

/**
 * Add the generated `read` entries. Any expanded entry already in the profile is dropped first, so
 * running this twice gives the same profile. Each generated entry carries its seed's relation and
 * provenance: the claim is the owner's, only the list of titles is the catalog's.
 */
export function expandProfile(profile: ResolvedProfile, db: DatabaseSync): Expansion {
  const kept = profile.entries.filter((e) => !e.expanded);
  const generated: ResolvedEntry[] = [];
  const reports: ExpansionReport[] = [];
  for (const seed of kept.filter(wantsExpansion)) {
    if (seed.subject.kind !== "author") {
      reports.push({ seedId: seed.id, author: seed.subject.name, found: false, novels: [], excluded: [], skipped: `expansion of a ${seed.subject.kind} is not supported` });
      continue;
    }
    const { found, novels, excluded } = worksOfAuthor(db, seed.subject.name);
    reports.push({ seedId: seed.id, author: seed.subject.name, found, novels, excluded });
    for (const w of novels) {
      generated.push({
        id: `${seed.id}:${w.id}`,
        subject: { kind: "work", name: w.title, id: w.id },
        relation: seed.relation,
        scope: "one-work",
        expanded: true,
        expandedFrom: seed.id,
        provenance: seed.provenance,
        origin: seed.origin,
      });
    }
  }
  return { profile: { ...profile, entries: [...kept, ...generated] }, reports };
}
