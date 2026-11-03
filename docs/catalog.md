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

---

# Catalog index and retrieval (C-3)

C-3 turns the staging file into `catalog/catalog.sqlite` (under `$BOOKCASE_DATA`, never in the repo) and answers "which works could these OCR fragments mean?" for identification (I-1), label resolution (V-3) and the reading profile (R-1).

| | |
|---|---|
| Code | `src/catalog/normalize.ts`, `build.ts`, `retrieve.ts`, `golden.ts`, `cli.ts` |
| Commands | `bookcase catalog build`, `bookcase catalog query <text>... [-k N] [--json]`, `bookcase catalog eval [--run-id <id>]` |
| Output | `$BOOKCASE_DATA/catalog/catalog.sqlite` (426 MB, built in about 15 s from the 2026-10-31 staging; schema version 1 in `PRAGMA user_version` and `meta`) |
| Golden set | `evals/golden/fragments.jsonl` (161 queries) |
| Run record | `evals/C3-catalog-retrieval/{metrics.json,report.md}` |
| Tests | `test/catalog-normalize.test.ts`, `test/catalog-retrieve.test.ts` (hand-built staging file in `test/helpers/mini-staging.ts`) |

```
bookcase catalog build
bookcase catalog query "GIBS NEUROM"
bookcase catalog query "SN0W CRASH" "SNOW CRASH STEPHENSON" -k 5    # two readings (variants) of one spine
```

## What is a work

A **work** is a root ISFDB title (`title_parent = 0`) of one of six types, with at least one edition: `NOVEL`, `COLLECTION`, `OMNIBUS`, `ANTHOLOGY`, `CHAPBOOK`, `NONFICTION`. Short fiction, poems, essays, reviews, interviews, cover art and interior art are parts of books, not books on a shelf; `SERIAL` and `EDITOR` are magazine-level. The six are the book-level title types: they are also the content types a book `pub_ctype` carries (`MAGAZINE` and `FANZINE` are publication types, not title types). Result on the 2026-10-31 dump: **340,829 works** and **943,917 editions** (an edition is a (publication, work) pair: an omnibus publication appears once for the omnibus and once for each novel in it).

- **Variants are folded in.** An ISFDB variant (translation, retitling, pseudonymous edition; `title_parent` points at the root) is not a work of its own. Its title becomes an alias title of the root, its authors become alias authors, and its publications are the root's editions. A spine can print the US title, the translated title or the pseudonym, and all of them find the one work. 101,863 variant titles of the kept types exist; no variant has a variant parent.
- **All languages and non-genre titles are kept** (ISFDB's flags are stored: `works.language`, `non_genre`, `graphic`). A bookshelf holds translations and non-genre books, and dropping them is a later, reversible filter on a column.
- **Authors** are the `canonical_author` links with `ca_status = 1`, in link order, on the root; variants' authors are aliases (`work_authors.alias = 1`) and searchable but not shown as the work's authors.
- **Subtitle.** ISFDB has no subtitle column. A title is split at its first `": "`; `works.title` is the part before, `works.subtitle` the part after, and the three forms (whole, main, subtitle alone) are all searchable. A subtitle-only match is worth 0.85 of a whole-title match, a main-only match 0.95 (`WEIGHTS.formKind`). Display text is `title: subtitle`.
- **Series** is the work's direct series, with its parents (to four levels) searchable: a spine that says "CYBERPUNK COLLECTION" finds the books of a series nested under it.
- **Tags** are the eight most-applied user tags per work (by distinct users), as a JSON array. They include award and list tags (R-0, OC33); their `tag_status` is not interpreted.
- **`sources`** is a JSON array of `{source:"isfdb", id:<title_id>, dump:<date>}`. A work's id is the opaque string `isfdb:<title_id>`; an edition's is `isfdb-pub:<pub_id>`. OC32's later backends add their own `source` entries and can join on this.
- **ISFDB stores non-Latin text as numeric entities** (`&#1057;&#1086;…`; 60,502 titles). C-1's staging kept them as they are; the build decodes them everywhere (`decodeEntities`), so a Cyrillic or Japanese title is searchable and displayable.

## Tables

`works` (id, title, subtitle, authors JSON, series, series_num, year, ttype, language, non_genre, graphic, tags JSON, sources JSON, edition_count, plus three normalised form columns the scorer reads), `editions` (edition_id, work_id, isbn13, isbn, publisher, year, title, format; indexed on `isbn13`), `authors` / `work_authors`, `series` / `work_series`, and the forms tables `title_forms`, `author_forms`, `series_forms` that the three FTS5 indexes `fts_title`, `fts_author`, `fts_series` point at (`tokenize='trigram'`, contentless, so the text is stored once). `meta` carries the staging content hash and dump date, the work types and row counts. `year` is the first-publication year (`NULL` for `0000` and `8888` dates).

## Normalisation

One function, `normalize`, is used for the index and for the query. Unicode-decompose, drop combining marks, spell out letters that do not decompose (ß ø æ œ ł đ þ), lower-case, `&` to "and", delete apostrophes and periods (`Ender's` → `enders`, `J.R.R.` → `jrr`, `J. R. R.` → `j r r`), every other run of non-letters to one space. Forms the matcher understands on top of that:

- **Initials.** A run of single-letter tokens also reads as one joined token (`j r r` ≙ `jrr`), on both sides. A one-letter token matches a word that starts with it at half weight (`P. K. DICK` finds `Philip K. Dick`).
- **"Surname, Given" and field order.** Matching is token-level and order-free, so `HERBERT, FRANK DUNE`, `DUNE FRANK HERBERT` and `FRANK HERBERT DUNE` are the same query. ISFDB's legal name (`Dick, Philip Kindred`) is turned round and indexed as a second author form.
- **0/O, 1/l/I, 5/S, 8/B.** A mixed token has its digits read as letters (`neur0mancer`), a mostly-digit token its letters as digits (`I984`).
- **rn/m, vv/w, cl/d** collapse to one skeleton on both sides (match worth 0.9; also used to widen the FTS query).
- **Split words.** Adjacent OCR tokens are also read joined (`neuro mancer` → `neuromancer`, up to three tokens).

## How `retrieve` works

`retrieve(db, variants, k = 10)` takes alternative readings of **one whole spine** (all its lines in one string, any order, as P-1's text variants give them) and returns at most `k` candidates, best first, each work once with the evidence of the variant that scored it highest (repeated agreement is not summed, INV-6). A candidate carries `workId`, title, subtitle, authors, series, year, `editionCount`, `score`, `queryCoverage`, the winning `variant` index and `evidence[]`: for each of title, author and series the score, the matched normalised form, the form kind (`title`, `main`, `subtitle`, `variant`, …) and every token match (`neurom` → `neuromancer`, `prefix`, 0.77). Those map one to one onto `title-fragment`, `author-fragment` and `series` in the `Evidence` contract.

1. **Generate.** FTS5 trigram queries, one OR-query per field, from the OCR tokens (3+ letters, stopwords skipped), their 0/O readings, joined neighbours, skeletons and, for words of 7+ letters, both halves (one wrong character leaves the other half intact). The best 250 forms per field by bm25 are scored in code; forms that explain at least 0.25 of themselves pull their works in; the best 12 authors and 8 series add their works (400 per author or series, most-edited first). The whole variant is also looked up as an exact title (short titles such as `IT` have no trigram).
2. **Score each work** against every form of its title, author and series: exact (1), skeleton (0.9), prefix (0.55 + 0.4 × length ratio; this is truncation), substring (0.45 + 0.3 × ratio; this is cropping), edit distance 1 (or 2 for 9+ letters; 0.85 × (1 − d/len)), initial (0.5). Tokens are matched greedily, best first, each used once; stopwords weigh a quarter and single letters 0.4. The title and series score is the weighted share of the form that the fragments explain; the author score is 0.7 × the surname's match + 0.3 × the given names' (a surname alone scores 0.7).
3. **Combine.** `1 − (1 − 0.85·T)(1 − 0.55·A)(1 − 0.45·S)`, times `0.55 + 0.45 × queryCoverage`, where `queryCoverage` is the share of the OCR tokens that some field explains. Words in the fragments that nothing explains cost score; a second field that explains them gains it.
4. **Rank** by score in steps of 0.01, then by number of editions, then by score, then id. Edition count is a catalog fact (not the reader's profile, INV-13), and it decides only between near-equal scores: a bare `GATEWAY` returns the most-published work called Gateway first. It is shown as `editionCount`.

All weights are in `WEIGHTS` in `retrieve.ts`.

**What `retrieve` does not do.** It applies no threshold and never appends `unknown`; I-1 does (INV-5, OC32). **`score` is an evidence score, not a probability, and it does not separate "right" from "nothing here"**: on the golden set the top candidate of the six no-match queries (cookbooks, atlases, a dictionary) scored up to 0.721, while the lowest score of a correct top-1 was 0.71 (`REVELATION SP ALASTAIR REYNOLDS`, a title cut to two letters). A fixed score threshold would drop real matches; I-1/I-2 should decide `unknown` on evidence structure (which fields matched, `queryCoverage`, margin to the second candidate) and calibrate on the fixture. Reversed reading direction, series runs and shelf neighbours are I-1's.

## The golden set and how corpus-generated inflation was avoided

`evals/golden/fragments.jsonl`: 87 `clean`, 68 `noisy`, 6 `none` queries. One JSON object per line: `id`, `class`, `noise[]` tags, `split`, `variants[]` (the fragments), `expect {title, author}`, and for noisy ones `base` (the clean twin). Public catalog knowledge only: known science-fiction books and their authors; the owner-public seeds (Gibson, Kim Stanley Robinson, Stephenson; OC9) are among them. No photo, no OCR of a photo, nothing from `$BOOKCASE_DATA`.

U14 M3 warns that a set generated from the corpus it scores is inflated: its queries are by construction the strings the index holds. What was done:

1. **The queries were written by hand, from memory of what a spine prints,** before any query was run, not sampled from `catalog.sqlite` or from ISFDB rows. Titles and authors were chosen for variety (famous and mid-list books, one-word titles, common words, initials, compound surnames, diacritics, a subtitle, multi-author books, books that share a title with others).
2. **Noise is hand-applied** to a clean twin, one named mechanism per tag: `ocr-0O`, `ocr-1l`, `ocr-rn-m`, `split-words`, `truncated-author`, `truncated-title`, `series-larger` (the series name is large and only a fragment of the title survives), `surname-first`, `initials`, `multi-variant`, and a few combinations. Nothing was generated by perturbing index strings.
3. **Targets are looked up by exact normalised title and author, never from retrieval output** (`targetWorks`). A query whose book is absent from the catalog is a catalog gap, reported and left out of the rates. There were none.
4. **The index was consulted once per query, only to confirm the book exists,** and the only edit that allowed was spelling the *expected* title or author as ISFDB records it (`Kurt Vonnegut, Jr.`, `Walter M. Miller, Jr.`). No fragment was changed after seeing a result. Five probe queries were run against the index while the matcher was being built, before the golden set existed (`GIBS NEUROM`, `neur0mancer gibson`, `NEURO MANCER`, `J R R TOLKIEN`, `dune`); two of them concern books that are also in the set.
5. **Dev and test halves.** `split` alternates by position: every code change that followed a result was made against `dev` failures only, and `test` stayed unused for tuning. The numbers below are for both halves and each separately.
6. **Honest limits.** The first 59 clean queries came out at 100 % top-5, so a second batch of 28 harder ones (lesser-known books, bare one-word titles) was added; none of those was run before it was fixed. The queries were still written by someone who knew how the matcher works. The noise is plausible OCR error written by hand, not measured OCR error. Numbers on real spines come from E-3/I-1 on the fixture, and will be lower.

**Tuning log** (everything changed after seeing a result): (a) before the golden set was first run, title forms were discounted by kind after a probe showed a subtitle-alone match tying the novel it names (`Chapterhouse: Dune` against "DUNE"); (b) one dev failure, `NEUROrnANCER` (n047), added the skeleton form of each token to the FTS query; (c) an index on `title_forms(norm)` removed a 25 ms table scan per variant. No weight in `WEIGHTS` was tuned against the set.

## Exit numbers

`evals/C3-catalog-retrieval/`, 2026-11-02, golden sha256 `9b464c41…`, staging content hash `b22bea09…`, on the build Mac (node v24.22.1).

| subset | queries | top-1 | **top-5** | top-10 |
|---|---:|---:|---:|---:|
| **clean** (exit: ≥ 90 % top-5) | 87 | 98.9 % | **100.0 %** | 100.0 % |
| clean, dev / test | 44 / 43 | 100 % / 97.7 % | 100 % / 100 % | |
| **noisy** (recorded) | 68 | 95.6 % | **100.0 %** | 100.0 % |
| noisy, dev / test | 34 / 34 | 97.1 % / 94.1 % | 100 % / 100 % | |

Weakest noisy tags by top-1 (top-5 is 100 % for every tag): `truncated-title` 83.3 % (6), `ocr-1l` 80 % (5), `split-words` 93.8 % (16), `truncated-author` 92.9 % (14). Counts per tag are small; read them as direction, not rate.

**Latency** (`retrieve` per query, warm cache after one untimed pass, 161 queries, ~35 ms mean): **p50 31.5 ms, p95 78.7 ms**, max 110 ms; a second run gave p95 80.2 ms. No target (card). The cost per variant is dominated by FTS and the JS scoring of up to a few thousand works; I-1 with 4 to 6 variants per spine should expect 100 to 200 ms per spine. Cheap levers if that matters: `ftsLimit`, `expandLimit`, dropping the skeleton and half-word phrases.

## Not verified

- Real OCR. All noise is hand-written; the rates above say the matcher handles those mechanisms, not that P-1's output is that kind of noise.
- Recall outside the golden set. 161 queries on well-known books; a large catalog has long-tail titles with common-word names, where the cap of 250 forms per FTS query and 400 works per author could cut a true match. No test exercises that.
- `ca_status = 1` as "author" and `tags.tag_status` carry over from C-1's not-verified list.
- On-device behaviour: the iOS FTS5/trigram probe is a later card.

---

# Catalog coverage on machine reads (C-4)

C-4 measures what share of a session's readable spines ISFDB holds, using F-0's cached reader text instead of hand labels (OC36). It adapts the coverage method of `docs/catalog/backend-options.md` §5: an outside catalog resolves the reader text to a book (the **readable label**, `CONTEXT.md`), and the resolved book's ISBNs, then its clean title and author, are looked up in ISFDB. Method, thresholds and results: [`evals/C4/report.md`](../evals/C4/report.md).

| | |
|---|---|
| Code | `src/catalog/coverage.ts` (sample, queries, MODS / Open Library parsing, resolution rule, ISFDB check, estimates), `src/catalog/coverage-cli.ts` |
| Commands | `bookcase catalog coverage --tune` (the confirmed tuning rows), `bookcase catalog coverage [--run-id C4] [--offline] [--session <name>]` |
| Inputs | F-0's stage cache `f0/<session>/{decisions,vision,ppocr,qwen}.jsonl` and `catalog/catalog.sqlite`, under `$BOOKCASE_DATA` |
| Live sources | Open Library search (≤ 1 request/s), then LoC SRU `lx2.loc.gov:210/LCDB` over HTTP (≤ 10 requests/min), keyless, app User-Agent with no email address |
| Cache | every response under `$BOOKCASE_DATA/catalog/coverage/{openlibrary,loc}/<sha256 of URL>.json`; `--offline` reruns make no calls and fail on a miss |
| Output | the per-box table in the data root's `private/c4/<session>.<role>.jsonl` (reader text, queries, records: private); aggregates in `evals/<run-id>/metrics.json` |
| Tests | `test/catalog-coverage.test.ts` (mocked fetch, public example titles, the mini staging catalog) |

The live APIs are verifiers, not a search backend (backend-options §2): neither tolerates OCR noise, so the queries are per text line (AND) and per reading (OR), and the resolution rule, not the engine's ranking, decides whether a record is the book.

