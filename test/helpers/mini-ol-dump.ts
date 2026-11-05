// A tiny hand-written Open Library dump (works, editions, authors) for the C-5 tests. Ids are invented; the
// books are public examples. Written gzipped, in the dumps' own line format.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { DumpFiles } from "../../src/catalog/ol-dump.ts";

const line = (type: string, key: string, rec: object) => `${type}\t${key}\t1\t2026-10-01T00:00:00\t${JSON.stringify({ key, type: { key: type }, ...rec })}`;
const work = (n: number, title: string, authors: number[], extra: object = {}) =>
  line("/type/work", `/works/OL${n}W`, { title, authors: authors.map((a) => ({ author: { key: `/authors/OL${a}A` }, type: { key: "/type/author_role" } })), ...extra });
const edition = (n: number, w: number | null, extra: object = {}) => line("/type/edition", `/books/OL${n}M`, { ...(w === null ? {} : { works: [{ key: `/works/OL${w}W` }] }), ...extra });
const eng = { languages: [{ key: "/languages/eng" }] };

export const MINI_OL = {
  works: [
    work(1, "Neuromancer", [1]), // ISBN crosswalk to the mini ISFDB (pub 401)
    work(2, "Red Mars", [2]), // title + surname crosswalk (ISFDB pub 403 has no ISBN)
    work(3, "The Joy of Cooking", [3], { first_publish_date: "1931" }), // first published before 1960: not breadth
    work(4, "Moonwalking with Einstein", [4], { subtitle: "The Art and Science of Remembering Everything" }), // breadth, new work
    work(5, "Un livre", [5]), // French only: not breadth
    work(6, "Single Edition Book", [6]), // one edition: not breadth, but shelf-held by ISBN
    work(7, "Shelf Title Match", [7]), // shelf-held by title + surname
    work(8, "Gödel, Escher, Bach", [8]), // breadth, author with diacritics
    line("/type/redirect", "/works/OL9W", { location: "/works/OL4W" }), // not a work
    work(4, "Moonwalking with Einstein (duplicate line)", [4]), // a key seen twice counts once
    "/type/work\t/works/OL10W\t1\t2026-10-01\t{not json", // skipped
  ],
  editions: [
    edition(101, 1, { ...eng, title: "Neuromancer", publish_date: "1984", isbn_10: ["0441569595"], publishers: ["Ace"] }),
    edition(102, 1, { ...eng, title: "Neuromancer", publish_date: "2004", isbn_13: ["9780441012039"], publishers: ["Ace"], physical_format: "Paperback" }),
    edition(201, 2, { ...eng, title: "Red Mars", publish_date: "June 1993", publishers: ["Bantam"] }),
    edition(202, 2, { ...eng, title: "Red Mars", publish_date: "1993" }),
    edition(301, 3, { ...eng, title: "The Joy of Cooking", publish_date: "1975" }),
    edition(302, 3, { ...eng, title: "The Joy of Cooking", publish_date: "1997" }),
    edition(401, 4, { ...eng, title: "Moonwalking with Einstein", subtitle: "The Art and Science of Remembering Everything", publish_date: "2011", isbn_13: ["9781594202292"], publishers: ["Penguin Press", "Penguin Group", "Penguin Press"] }),
    edition(402, 4, { ...eng, publish_date: "c2012", isbn_13: ["978-0-14-312053-7"] }),
    edition(501, 5, { languages: [{ key: "/languages/fre" }], publish_date: "1990" }),
    edition(502, 5, { languages: [{ key: "/languages/fre" }], publish_date: "1991" }),
    edition(601, 6, { ...eng, publish_date: "2001", isbn_13: ["9780000000002"] }),
    edition(701, 7, { ...eng, publish_date: "1950" }),
    edition(801, 8, { ...eng, publish_date: "1979", isbn_10: ["0465026850"] }),
    edition(802, 8, { ...eng, publish_date: "1999" }),
    edition(901, null, { ...eng, publish_date: "2000" }), // no work
    edition(902, 42, { ...eng, publish_date: "2000" }), // a work not in the works dump
  ],
  authors: [
    line("/type/author", "/authors/OL1A", { name: "William Gibson" }),
    line("/type/author", "/authors/OL2A", { name: "Kim Stanley Robinson" }),
    line("/type/author", "/authors/OL3A", { name: "Rombauer, Irma S." }),
    line("/type/author", "/authors/OL4A", { name: "Joshua Foer" }),
    line("/type/author", "/authors/OL5A", { name: "Anonyme" }),
    line("/type/author", "/authors/OL6A", { name: "Pat Example" }),
    line("/type/author", "/authors/OL7A", { name: "Sam Shelfwriter" }),
    line("/type/author", "/authors/OL8A", { name: "Douglas R. Hofstadter" }),
  ],
};

/** The C-4-style private table rows that make works 6 and 7 shelf-held (a record with an ISBN; one by title + author). */
export const MINI_SHELF_ROWS = [
  { id: "x:0", record: { source: "loc", id: "lccn-1", title: "Another Title Entirely", authors: ["Example, Pat"], isbns: ["9780000000002"], subjects: [], year: null, subtitle: null } },
  { id: "x:1", record: { source: "openlibrary", id: "/works/OL70000W", title: "Shelf Title Match (a novel)", authors: ["Sam Shelfwriter"], isbns: [], subjects: [], year: null, subtitle: null } },
  { id: "x:2", record: null },
];

export function writeMiniOlDump(dir: string): DumpFiles {
  const files: DumpFiles = { works: join(dir, "ol_dump_works_2026-10-31.txt.gz"), editions: join(dir, "ol_dump_editions_2026-10-31.txt.gz"), authors: join(dir, "ol_dump_authors_2026-10-31.txt.gz") };
  for (const k of ["works", "editions", "authors"] as const) writeFileSync(files[k], gzipSync(`${MINI_OL[k].join("\n")}\n`));
  return files;
}

export function writeMiniShelf(dir: string): string {
  const p = join(dir, "mini.sample.jsonl");
  writeFileSync(p, `${MINI_SHELF_ROWS.map((r) => JSON.stringify(r)).join("\n")}\n`);
  return p;
}
