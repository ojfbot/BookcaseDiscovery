# Catalog staging: ISFDB (C-1)

The MVP catalog is ISFDB only (OC20). Card C-1 stages ISFDB's database dump into one local SQLite file. C-3 builds fragment retrieval on it. Nothing here is committed data: the dump and the staging file live under `$BOOKCASE_DATA` (default `~/data/bookcase-discovery/`), never in the repo.

| | |
|---|---|
| Dump | `backup-MySQL-55-2026-10-31.zip`, **dump date 2026-10-31** (ISFDB names its backups by date; the file inside is a MySQL 5.5.62 `mysqldump`, host `localhost`, database `isfdb`) |
| Size | 368,069,427 bytes zipped; 1,633,212,359 bytes as a dump (one entry, `cygdrive/d/ISFDB/Backups/backup-MySQL-55-2026-10-31`) |
| Raw copy | `$BOOKCASE_DATA/raw/isfdb/backup-MySQL-55-2026-10-31.zip` |
| Staging file | `$BOOKCASE_DATA/catalog/isfdb-staging.sqlite` (about 890 MB, indexes included) |
| Code | `src/catalog/mysqldump.ts` (streaming parser), `src/catalog/isfdb-staging.ts` (schema, load, content hash), `src/catalog/spot-check.ts`, `src/catalog/isfdb-import.ts` (CLI), `src/catalog/isbn.ts` |
| Commands | `pnpm catalog:import [--dump <file>] [--out <file>] [--date YYYY-MM-DD]`, `pnpm catalog:check [--db <file>]` |
| Tests | `test/isfdb-mysqldump.test.ts`, `test/isfdb-staging.test.ts`, fixture `test/fixtures/isfdb/mini-dump.sql` (hand-written, invented ids) |

## Terms

- **Licence: CC BY 4.0.** The ISFDB site footer says "This work is licensed under a Creative Commons Attribution 4.0 International License", linking https://creativecommons.org/licenses/by/4.0/. The conductor verified this in a browser on 2026-11-02 (`docs/licences.md`, conductor verification). Attribution text is in `NOTICE`.
- **Backup-specific terms: UNVERIFIED.** ISFDB's downloads page (`https://www.isfdb.org/wiki/index.php/ISFDB_Downloads`) needs a login and sits behind a Cloudflare bot check. No agent read it. The owner logged in, copied the Google Drive link of the newest MySQL 5.5 backup, and the conductor fetched that file; this card did not touch the page, log in, or use a mirror. If the page puts terms on the backups beyond CC BY 4.0 (for example on redistribution of the dump itself), they are not recorded here. The repo does not redistribute the dump or the staging file, so the risk is limited to local use. Logged as a deviation in `implementation-notes.md`.

## How the import works

1. `openDump` streams the dump: `unzip -p` for a `.zip` (exactly one entry is required), `zlib` for a `.gz`, the bytes as they are otherwise. Nothing is extracted to disk or held whole in memory.
2. `MysqlDumpParser` is a byte-level state machine over arbitrary chunks. It reads `CREATE TABLE` column names and `INSERT INTO \`t\` VALUES (...),(...);` rows for the staged tables only and skips every other line. Values are `number | string | null`; strings are UTF-8 decoded (the dump says `SET NAMES utf8`). A statement, string, escape or multi-byte character may straddle a chunk boundary; a test feeds the parser one byte at a time.
3. It refuses what it does not know: an `INSERT` with a column list, hex literals, a malformed row, a dump that ends mid-statement. Errors carry a byte offset.
4. The loader maps columns by **name** from each table's `CREATE TABLE`, so a re-ordered column does not shift data. It fails if a kept column is missing, a row's length differs from its table's, a row comes before its `CREATE TABLE`, or a staged table is absent.
5. Rows go into a `.partial` SQLite file in one transaction (no journal, synchronous off). Indexes are made after the load. The file is renamed into place only after the content hash is computed and `meta` is written, so a failed run leaves no staging file.

The 2026-10-31 dump parsed in about 35 s (1.63 GB, 11.9 M staged rows), 0 strings with invalid UTF-8.

## Content hash

`sha256` over, for each staged table in a fixed order, a header line `#<table> <columns>` and then every row ordered by the table's key, each as a JSON array. It covers the staged data only. `meta` (import time, file sizes) is outside it, so two parses of the same dump give the same hash. It is stored in `meta.content_hash` and printed by both commands.

Two independent parses of the 2026-10-31 dump (the second into a different file) gave the same hash:

```
b22bea092bedf73789b37c06ee611e0e77cf80266c04df245e0b28b171295f3c
```

## Counts (dump 2026-10-31)

| table | rows |
|---|---:|
| authors | 305,299 |
| canonical_author | 2,861,816 |
| titles | 2,562,192 |
| pubs | 967,341 |
| pub_authors | 1,057,937 |
| pub_content | 4,303,980 |
| publishers | 43,102 |
| pub_series | 11,225 |
| series | 59,993 |
| tags | 18,432 |
| tag_mapping | 361,858 |
| languages | 170 |

673,428 pubs have a non-empty `pub_isbn`; 673,399 of them are valid ISBN-10/13 (29 fail the check digit). 276,182 titles are `NOVEL`, 202,802 of them root works (`title_parent = 0`). Referential checks found no orphan `pub_content.pub_id`, `canonical_author.author_id`, or `tag_mapping.tag_id`.

## Field map

Staged tables keep ISFDB's table and column names. Only the columns below are staged; the rest of ISFDB (images, prices, notes, views, ratings, awards, verifications, user data, the MediaWiki tables) is not. The staging schema is `createSchema` in `src/catalog/isfdb-staging.ts`; `PRAGMA user_version` and `meta.schema_version` hold the version (1).

Vocabulary (`CONTEXT.md`): an ISFDB **title** is a **Work**, and an ISFDB **publication** (`pubs`) is an **Edition**.

| staged table | columns | meaning |
|---|---|---|
| `titles` | `title_id` | a work (or a story, essay, cover art: see `title_ttype`) |
| | `title_title` | its title as ISFDB records it |
| | `title_ttype` | `NOVEL`, `COLLECTION`, `ANTHOLOGY`, `SHORTFICTION`, `ESSAY`, `COVERART`, ... (16 values) |
| | `title_parent` | `0` for a root work; otherwise the `title_id` it is a **variant** of (translation, retitling, pseudonym edition) |
| | `title_copyright` | first-publication date as text `YYYY-MM-DD`, with `00` for unknown month or day |
| | `series_id`, `title_seriesnum`, `title_seriesnum_2` | series membership and position (`_2` is the text form, e.g. `1a`) |
| | `title_language` | `languages.lang_id` |
| | `title_non_genre`, `title_graphic` | `Yes`/`No` flags |
| `authors` | `author_id`, `author_canonical` | the author's canonical name (`William Gibson`) |
| | `author_legalname`, `author_lastname`, `author_language` | legal name, surname, `languages.lang_id` |
| `canonical_author` | `ca_id`, `title_id`, `author_id`, `ca_status` | the **canonical author link** from a work to its author(s) |
| `pubs` | `pub_id`, `pub_title` | an edition and its printed title |
| | `pub_year` | date as text `YYYY-MM-DD`, `00` parts for unknown; `0000-00-00` = unknown (21,972); `8888-…` = unpublished (729) |
| | `publisher_id` | `publishers.publisher_id` |
| | `pub_isbn` | **as typed**: ISBN-10 or -13, with or without hyphens |
| | `isbn13` | **derived** by this card: digits only, an ISBN-10 converted, `NULL` if absent or the check digit fails |
| | `pub_tag`, `pub_pages`, `pub_ptype`, `pub_ctype`, `pub_catalog` | ISFDB's pub tag, page count, format (`pb`, `tp`, `hc`, ...), content type (`NOVEL`, `COLLECTION`, ...), catalog number |
| | `pub_series_id`, `pub_series_num` | the publisher's series (e.g. "Ace Science Fiction Specials") and number |
| `pub_authors` | `pa_id`, `pub_id`, `author_id` | the authors credited **on the edition** |
| `pub_content` | `pubc_id`, `title_id`, `pub_id`, `pubc_page` | **pub contents**: which works an edition holds, with page |
| `publishers` | `publisher_id`, `publisher_name` | |
| `pub_series` | `pub_series_id`, `pub_series_name` | publisher series |
| `series` | `series_id`, `series_title`, `series_parent`, `series_type`, `series_parent_position` | work series, nested through `series_parent` |
| `tags` | `tag_id`, `tag_name`, `tag_status` | user tags. `tag_status` 1 appears on 1,645 rows; **its meaning is not documented anywhere this card could read**, so it is carried, not interpreted |
| `tag_mapping` | `tagmap_id`, `tag_id`, `title_id`, `user_id` | a tag applied to a work by a user. Tags include award and best-of-list tags (R-0, OC33): they are popularity signals as well as taste |
| `languages` | `lang_id`, `lang_name`, `lang_code` | |
| `meta` | `key`, `value` | `dump_file`, `dump_date`, `dump_bytes`, `dump_stream_bytes`, `imported_at`, `content_hash`, `invalid_utf8_strings`, `schema_version`, `rows.<table>` |

### Things C-3 needs to know

- **`ca_status`.** Observed values: `1` on every kind of work (the author link; 2.68 M rows), `3` only on `REVIEW` titles (161,388 rows), `2` on 19,112 rows (not inspected further; probably interviews). For "who wrote this work" filter `ca_status = 1`. This reading is from the data, not from ISFDB documentation.
- **A work has editions through `pub_content`, and variants matter.** A translation or retitled edition is a *variant* title with `title_parent` pointing at the root work. Editions of Neuromancer are found by `pub_content.title_id IN (root, its variants)`, as `spot-check.ts` does. `pubs.pub_title` can differ from the work's title.
- **Dates are text with holes.** `pub_year` and `title_copyright` use `00` for unknown parts and `0000-00-00` for unknown. Do not cast them to dates blindly.
- **ISBNs are not unique per edition.** Many pubs share one ISBN (reprints recorded separately); 673,428 pubs carry 629,804 distinct valid ISBN-13s.
- **`title_title` is not normalised.** C-3 decides case, diacritics, leading articles and subtitles.
- A staged `NOVEL`-only filter is not applied: stories, essays and art are in `titles`. `title_ttype = 'NOVEL'` keeps 276,182 rows; `COLLECTION`, `OMNIBUS`, `ANTHOLOGY` and `CHAPBOOK` also appear on shelves.
- No FTS or trigram index is built here. C-3 owns it (`node:sqlite`'s SQLite has FTS5 trigram; `docs/probe.md`).

## Exit checks, run on the 2026-10-31 dump

`pnpm catalog:import` stages and prints the counts, hash and spot checks; `pnpm catalog:check` prints them again from the staged file and exits non-zero if a spot check fails. A spot check passes when an exact-title `NOVEL` root work has a `canonical_author` link to the named author **and** at least one of its editions has a valid ISBN. The seeds are the owner's public authors (OC9 allows them).

| title | author | work (`title_id`) | editions | example ISBN-13 |
|---|---|---:|---:|---|
| Neuromancer | William Gibson | 1475 | 112 | 9780441569564 (Ace, 1984-07) |
| Red Mars | Kim Stanley Robinson | 1330 | 65 | 9780246138811 (HarperCollins UK, 1992-09) |
| Snow Crash | Neal Stephenson | 1182 | 62 | 9780553351927 (Bantam Spectra, 1992-06) |

## Not verified

- ISFDB's backup terms (above).
- That `ca_status = 2` means interviewee, and `tags.tag_status = 1`'s meaning.
- That the dump is complete: counts were checked against the AUTO_INCREMENT values and the stats page order of magnitude (967,341 pubs staged against C-R's 967,479 from the weekly stats report), not against any ISFDB checksum.
