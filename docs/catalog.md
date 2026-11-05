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

`works` (id, title, subtitle, authors JSON, series, series_num, year, ttype, language, non_genre, graphic, tags JSON, sources JSON, edition_count, plus three normalised form columns the scorer reads), `editions` (edition_id, work_id, isbn13, isbn, publisher, publishers, pub_series, year, title, format; indexed on `isbn13`; `publishers` and `pub_series` since schema 3, § Imprint data (C-9)), `authors` / `work_authors`, `series` / `work_series`, and the forms tables `title_forms`, `author_forms`, `series_forms` that the three FTS5 indexes `fts_title`, `fts_author`, `fts_series` point at (`tokenize='trigram'`, contentless, so the text is stored once). `meta` carries the staging content hash and dump date, the work types and row counts. `year` is the first-publication year (`NULL` for `0000` and `8888` dates).

## Normalisation

One function, `normalize`, is used for the index and for the query. Unicode-decompose, drop combining marks, spell out letters that do not decompose (ß ø æ œ ł đ þ), lower-case, `&` to "and", delete apostrophes and periods (`Ender's` → `enders`, `J.R.R.` → `jrr`, `J. R. R.` → `j r r`), every other run of non-letters to one space. Forms the matcher understands on top of that:

- **Initials.** A run of single-letter tokens also reads as one joined token (`j r r` ≙ `jrr`), on both sides. A one-letter token matches a word that starts with it at half weight (`P. K. DICK` finds `Philip K. Dick`).
- **"Surname, Given" and field order.** Matching is token-level and order-free, so `HERBERT, FRANK DUNE`, `DUNE FRANK HERBERT` and `FRANK HERBERT DUNE` are the same query. ISFDB's legal name (`Dick, Philip Kindred`) is turned round and indexed as a second author form.
- **0/O, 1/l/I, 5/S, 8/B.** A mixed token has its digits read as letters (`neur0mancer`), a mostly-digit token its letters as digits (`I984`).
- **rn/m, vv/w, cl/d** collapse to one skeleton on both sides (match worth 0.9; also used to widen the FTS query).
- **Split words.** Adjacent OCR tokens are also read joined (`neuro mancer` → `neuromancer`, up to three tokens).

## How `retrieve` works

`retrieve(db, variants, k = 10)` takes alternative readings of **one whole spine** (all its lines in one string, any order, as P-1's text variants give them) and returns at most `k` candidates, best first, each work once with the evidence of the variant that scored it highest (repeated agreement is not summed, INV-6). A candidate carries `workId`, title, subtitle, authors, series, year, `editionCount`, `score`, `queryCoverage`, the winning `variant` index and `evidence[]`: for each of title, author and series the score, the matched normalised form, the form kind (`title`, `main`, `subtitle`, `variant`, …) and every token match (`neurom` → `neuromancer`, `prefix`, 0.77). Those map one to one onto `title-fragment`, `author-fragment` and `series` in the `Evidence` contract.

1. **Generate.** FTS5 trigram queries, one OR-query per field, from the OCR tokens (3+ letters, stopwords skipped), their 0/O readings, joined neighbours, skeletons and, for words of 7+ letters, both halves (one wrong character leaves the other half intact). The best 250 forms per field by bm25 are scored in code; forms that explain at least 0.25 of themselves pull their works in; the best 12 authors and 8 series add their works (400 per author or series, most-edited first). The whole variant is also looked up as an exact title (short titles such as `IT` have no trigram). C-8's rare-words-first generation is opt-in (`generation: "c8"`; § Candidate generation, rare words first).
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


---

# Open Library breadth import (C-5)

C-4 measured that ISFDB holds 59.5 % (48.6–71.2) of `pilot-000`'s readable labels, which fires OC20's reopening
rule, and that about three quarters of the missing books are not SF. C-5 adds Open Library to the local index in
the two layers C-4 proposed, crosswalked to ISFDB, as a **new file**: `$BOOKCASE_DATA/catalog/catalog-v2.sqlite`.
`catalog.sqlite` is not touched; readers pick the file with `BOOKCASE_CATALOG` (below). Results:
[`evals/C5/report.md`](../evals/C5/report.md).

| | |
|---|---|
| Dumps | Open Library monthly dumps of **2026-10-31**: `ol_dump_{works,editions,authors}_2026-10-31.txt.gz` from `https://archive.org/download/ol_dump_2026-10-31/` (the `_latest` links on https://openlibrary.org/developers/dumps redirect there). Sizes and MD5 checked against the item's `_files.xml`. Covers are not downloaded. |
| Raw copy | `$BOOKCASE_DATA/catalog/ol-dumps/2026-10-31/` (kept; the owner decides on deleting them) |
| Measurement | `$BOOKCASE_DATA/catalog/ol-measure/2026-10-31/` (per-work facts as raw arrays, `counts.json`) |
| Staging file | `$BOOKCASE_DATA/catalog/ol-staging.sqlite` (kept works, their editions, their authors) |
| Catalog | `$BOOKCASE_DATA/catalog/catalog-v2.sqlite`, schema version 2 |
| Code | `src/catalog/ol-dump.ts` (streaming reader, measuring pass, layers, staging), `src/catalog/ol-merge.ts` (crosswalk and merge), `src/catalog/ol-import.ts` (CLI), `src/catalog/c5-eval.ts` (evaluation) |
| Commands | `pnpm catalog:ol measure`, `pnpm catalog:ol stage`, `bookcase catalog build --ol-staging $BOOKCASE_DATA/catalog/ol-staging.sqlite` (writes `catalog-v2.sqlite` unless `--out` says otherwise) |
| Tests | `test/catalog-openlibrary.test.ts`, synthetic dump in `test/helpers/mini-ol-dump.ts` (invented ids, public example books) |

## Reading the dumps

A dump line is `type \t key \t revision \t last_modified \t JSON`. The dumps are untrusted data: `dumpRecords`
streams the gzip through `readline`, parses each wanted line with `JSON.parse` and nothing else, skips (and counts)
lines that are malformed or longer than 4 MB, and never holds a file whole. On later passes a line is filtered on
its type and key before it is parsed. Open Library ids (`/works/OL45804W`) become numbers, and the per-work facts
the filter needs live in typed arrays indexed by that number (about 0.4 GB for every work in the dump).

Measuring (`measure`): works (which exist, the work's own `first_publish_date`, shelf-held title candidates),
authors (surnames of those candidates' authors), editions (count per work, earliest `publish_date`, any English
edition, shelf-held ISBNs). A work's **first year** is the earliest four-digit year in 1450–2027 found in its own
`first_publish_date` or any edition's `publish_date` (Open Library search computes `first_publish_year` from the
editions the same way). An edition belongs to its first `works` entry; editions with no work, or a work missing from
the works dump (redirected or deleted), are counted and dropped. **English** means at least one edition lists
`/languages/eng`.

## The two layers (C-4's proposal)

1. **Shelf-held** (always on): works that match a book C-4's resolver resolved on a scanned session, read from the
   private per-box tables `private/c4/<session>.{sample,tuning}.jsonl`. Matched by the record's Open Library work
   key, else any of its ISBNs on any edition, else the title key (main title, trailing parenthetical dropped,
   normalised, leading article dropped) plus one of its first three authors' surnames (C-4's `surnameOf`).
2. **Breadth**: English-language works first published in 1960 or later with at least two editions.

A kept work keeps **every** edition (all languages), with its ISBN-10/13 (`isbns`, all valid ISBN-13s; `isbn13`, the
first), title (with subtitle), publisher (the first listed; since C-9 also every distinct publisher string, `ol_editions.publishers`, staging schema 2), publish year and physical format, and its authors'
names. The layer is stored on the work's `sources` entry (`shelf`, `breadth` or `shelf+breadth`).

## Crosswalk and merge

`buildCatalog` builds the ISFDB catalog exactly as C-3 does, then, in the same transaction, `mergeOpenLibrary`
walks the staged works in id order:

1. **ISBN.** Each Open Library edition's ISBN-13s against ISFDB's `editions.isbn13`. The ISFDB work most of them
   point at wins; an equal title key adds half a vote, because an omnibus edition's ISBN points at the omnibus and
   at every novel in it. Only ISFDB works are targets.
2. **Title plus author.** Otherwise, the work's title key equals the key of an ISFDB title form (any kind: the
   title, its main part or subtitle, a variant), and an Open Library author's surname is one of that work's author
   surnames. Several hits: the one with the most editions.
3. A **crosswalked** work adds no Work. Its editions whose ISBN the ISFDB work lacks become editions of the ISFDB
   work (`edition_id` `ol:OL<n>M`, `source` `openlibrary`), and `{source: "openlibrary", id: "OL<n>W", dump,
   layer}` is appended to the ISFDB work's `sources`. Several Open Library works can fold into one ISFDB work.
4. Every **other** kept work becomes a Work `ol:OL<n>W` with its own editions, title forms (whole title; main title
   and subtitle when there is one) and authors. `ttype` is `BOOK` (Open Library has no work type), `language` is
   `English` when an edition is, `non_genre` and `graphic` are 0 (not flagged), `tags` are empty (Open Library
   subjects are a different vocabulary from ISFDB's user tags and are not imported), and there is no series.
5. **Authors** are matched by normalised name: an Open Library author whose name (or "Surname, Given" turned round)
   normalises to an existing author form reuses that author; otherwise one new author per distinct normalised name,
   id `1_000_000_000 + <Open Library author number>`. Open Library holds many duplicate author records ("Stephen
   King" several times), and separate rows would crowd the twelve author slots `retrieve` expands.

Open Library's own duplicate works (two records for one book) are not merged with each other; they become two
works with the same forms. `retrieve`'s ranking and scoring are unchanged.

**Schema version 2** adds `editions.source` (`isfdb` or `openlibrary`); nothing else changed, so every reader accepts
version 1 and 2 files (`READABLE_SCHEMA_VERSIONS`). `works.edition_count` is the number of edition rows the work has
in the catalog, so a crosswalked ISFDB work's count includes the Open Library editions added to it. `meta` records
`sources`, `openlibrary_dump_date`, `rows.isfdbWorks` and the merge counts (`openlibrary.*`).

## Choosing the catalog file

`BOOKCASE_CATALOG` names the catalog every reader opens (`catalogPaths().catalog`: `bookcase catalog query|eval|
coverage`, `bookcase recommend`, and the F-0, F-0b, F-0c, F-0d and F-0e runners): a file name in `$BOOKCASE_DATA/catalog/` or an absolute
path. Unset, it is `catalog.sqlite`, as before. `--db` flags still override it. `bookcase catalog build` without
`--ol-staging` always writes `catalog.sqlite`; with it, `catalog-v2.sqlite`.

```
BOOKCASE_CATALOG=catalog-v2.sqlite bookcase catalog query "MOONWALKING EINSTEIN FOER"
```

# Lookalike guard for open catalogs (C-6)

On an open catalog a spine's text can fit a book and its **lookalikes** equally well: another book with the same
title by someone else, a one-word title that is also a common word, a title many books share. F-0's bar
(`ACCEPT`: score ≥ 0.72, title evidence ≥ 0.8, coverage ≥ 0.5, two readers agree) asks how well the text explains a
work, never whether it explains that work better than every other one. C-5 measured the cost on the yardstick: wrong
accepts per spine 0.5 % on v1, 1.5 % on v2. The **lookalike guard** (`src/catalog/lookalike.ts`) asks the second
question. Pre-registration, results and the verdict: `evals/C6/report.md`.

**Where it sits.** On each reader's ranked candidates (`retrieve` on that reader's variants, depth 50, scoring and
ranking unchanged), after F-0's bar: a reader confirms its top work only if the work also passes the arms in force.
F-0's vote is unchanged, so the guard can withdraw a vote but never add an accept or switch one to another work. A
spine it stops keeps F-0's reasons (`single-reader`, `no-catalog-match`, `readers-disagree`); `decide` records which
arm withdrew which reader (`SpineDecision.lookalike`). `decide(…, guard)` takes it as an option; nothing applies it
unless a caller passes one.

**Same book.** One work id; or one normalised title by a shared author surname (F-0g's `sameWork`, now shared from
`lookalike.ts`); or, by a shared surname, one main title or a shared whole or main title form, own or variant
(`title_norm` kinds T, M, V, W). Open Library duplicate works and an ISFDB omnibus recorded under one of its books'
titles are one book and never each other's lookalike.

| arm | rule | constant (`LOOKALIKE`) |
|---|---|---|
| **margin** | the work beats the best *different* book among the reader's candidates by at least the margin | 0.01: `retrieve` ranks by hundredths, then edition count, so under 0.01 the work won on popularity |
| **author evidence** | a one-content-word title form, or one held by two or more distinct books (`titleHolders`, duplicates counted once), needs author evidence above 0 | `sharedBooks` 2 |
| **short title** | a one-content-word title needs a second field confirmed: author evidence ≥ 0.5 (a surname) or series ≥ 0.8 | `secondAuthor` 0.5, `secondSeries` 0.8 |

Commands (offline; per-reading and per-spine files stay in the data root's private folder (`private/c6/`)):

```
node src/catalog/c6-eval.ts readings --set pilot-000 --catalog v2 [--shard 1/4]
node src/catalog/c6-eval.ts decide --set pilot-000
node src/catalog/c6-eval.ts golden
node src/catalog/c6-eval.ts publish            # evals/C6/metrics.json
```

**Result (2026-11-03): the default stays `catalog.sqlite`.** No arm passed the pre-registered keep rule:

- The margin alone and author evidence alone kept too many yardstick lookalikes.
- Every combination withdrew too many `pilot-000` confirmations.
- The short-title arm passed the yardstick and `pilot-000` conditions. It failed on golden queries that v1 confirms
  correctly from a bare title or from an author's given names alone.

`BOOKCASE_CATALOG=catalog-v2.sqlite` still selects v2 by hand (above), with no guard. What a switch would need is in
`evals/C6/report.md` § What would be needed.

# Rarity basis: rarity-weighted evidence and counter-evidence (C-7)

F-0's bar measures how well a reader's text explains a work. It cannot see that a title match on a word a hundred
books share is weaker than one on a word only one book uses, and nothing in it counts *against* a work. C-7 adds both
from the catalog's own statistics, with no labels (record linkage's term-frequency adjustment; C-R2,
`docs/catalog/identification-research.md` §1.2–1.4). Pre-registration, results and the verdict:
`evals/C7/report.md`.

**Statistics sidecar.** `bookcase catalog stats [--db <catalog>]` reads a catalog and writes `<catalog>.stats.sqlite`
beside it (`catalog.stats.sqlite`: 5 s, 34 MB; `catalog-v2.stats.sqlite`: 87 s, 404 MB). The catalog file is never
written. The sidecar records the catalog's size and modification time, and `openStats` refuses it against any other
state, so rebuild it after every catalog build.

| table | key | value |
|---|---|---|
| `title_totals` | whole or main title form, own or variant (kinds T, M, V, W) | works, books, editions |
| `title_books` | (title form, primary author surname): one book, so duplicates and crosswalks collapse | works, editions |
| `words` | token | works carrying it in a title, author or series form; works with an edition whose publisher carries it |
| `author_works` | author form | works |

**Evidence** (`rarityEvidence`, new fields beside `retrieve`'s scores; `retrieve` itself is unchanged): the matched
form's works, books and editions; the **namesake share** (the candidate's book's share of those editions); the
**rarity-weighted title evidence** in bits; the unexplained read words that count and the rarest of them; whether
another book's author was read; the reading's and the work's language.

**Counter-evidence** (`counterEvidence`; constants `RARITY` in `src/catalog/rarity.ts`):

| kind | withdraws a reader's confirmation when |
|---|---|
| namesake | no surname (author ≥ 0.5) or series (≥ 0.8) was read and the namesake share is ≤ 0.5, or the form is only the work's subtitle |
| unexplained | the reading holds a word (≥ 4 letters, no digit, in ≥ 2 works, not an imprint word) that the work does not explain and that occurs in fewer works than the matched title form |
| author | the work's own author was not read, and a different book among the reader's top 50 has a surname read from words this work leaves unexplained |
| language | the reading's exclusive function words mark one non-English language, and the work is English and matched its own title |

**Where it sits.** After F-0's bar, on each reader's ranked candidates (depth 50), after C-6's guard arms if any:
`decide(…, { guard, ranked, rarity: { basis, kinds } })`, with `basis = rarityBasis(db, openStats(statsPathFor(path), path))`.
It only withdraws votes, so it never adds an accept or switches one; `SpineDecision.counter` records which kind
withdrew which reader.

Commands (offline; per-reading and per-spine files stay in the data root's private folder, `private/c7/`):

```
bookcase catalog stats --db "$BOOKCASE_DATA/catalog/catalog-v2.sqlite"
node src/catalog/c7-eval.ts readings --set pilot-000 --catalog v2 [--shard 1/4]
node src/catalog/c7-eval.ts decide --set pilot-000
node src/catalog/c7-eval.ts golden
node src/catalog/c7-eval.ts publish            # evals/C7/metrics.json
```

**Result (2026-11-03): the default stays `catalog.sqlite`.** Neither eligible arm (the full basis, or the basis with
C-6's margin) passed the pre-registered keep rule:

- The full basis passed the yardstick conditions: wrong share of accepts 38.6 % → 25.7 %, wrong per spine 0.80 %, 26
  of 27 correct accepts kept.
- It failed `pilot-000`: +1.35 points over v1, with an interval reaching below 0. Most of the loss is the author kind.
- It refused one golden-correct v1 confirmation (C-6's (c) refused six) and two on v2. Both are bare common-word
  titles whose book holds under half of its title's editions.

The basis stays an option of `decide`, off unless a caller passes it. What would close the gap is in
`evals/C7/report.md` § What would close the gap.

# Candidate generation, rare words first (C-8)

C-R2 §1.5 asked for candidates from the rarest read words first. `retrieve(db, variants, k, { generation: "c8" })` does
that; **the default stays C-3's generation**, because C-8's pre-registered keep rule failed on yardstick candidate
recall on v2 (`evals/C8/report.md`). F-0 and every other caller are unchanged.

**What `c8` does,** once over the text of all the variants (C-3 generates per variant):

1. Every run of up to 10 read tokens is looked up as an exact title (`title_forms(norm)`, 50 works per run, most
   editions first). These do not count toward the pool.
2. Each read token of 3+ letters that is not a stopword, and each join or 0/O reading that the catalog holds as a word,
   becomes one trigram query: the token and its skeleton, plus both halves for a read token of 7+ letters the catalog
   does not hold. Queries are ordered by df (works carrying the token in a title, author or series form, from C-7's
   sidecar `<catalog>.stats.sqlite`), then the longer token.
3. Each index (title, author, series) fills a pool of 250 forms: one query ORing the 4 rarest catalog words (60
   forms), then each token's query rarest first, 40 new forms each, until full. Expansion and scoring are C-3's.
4. `generateFrom` adds other readings of the spine (other readers' text) to generation only; candidates are scored on
   `variants` alone, so each reader's vote stays its own (INV-6).

Constants: `GENERATION` in `retrieve.ts`. Without a sidecar (or with a stale one, a warning) every token has df 0, so
the longer token goes first. `catalogDf(db)` finds the sidecar beside the catalog file (`db.location()`).

**Why C-3's generation is slow on v2.** FTS5 ranks every form that holds a phrase before it applies `LIMIT`, so the cost
follows how many forms hold each phrase *as a substring*. C-3's single OR-query holds the halves of long words
(`tion`: 619,465 title forms on v2) and 3-letter fragments (`ion`: 742,517). Word df does not predict this for
fragments (`tation`: df 2, 35,474 forms), which is why `c8` halves only words the catalog does not know. Every
statement `retrieve` runs uses an index on v2 (`EXPLAIN QUERY PLAN`; a unit test fails on a table scan).

**Numbers** (`evals/C8/`, 2026-11-04):

| | C-3 (default) | `c8` |
|---|---:|---:|
| golden clean top-5, v1 / v2 | 100 % / 100 % | 100 % / 100 % |
| golden noisy top-5, v1 / v2 | 100 % / 95.6 % | 100 % / 95.6 % |
| golden p95 (median of 3), v1 / v2 | 82 ms / 497 ms | **67 ms / 238 ms** |
| yardstick candidate recall at depth 50, v1 / v2 | 3.7 % / 15.2 % | 3.7 % / **13.2 %** (−2.0 points, −3.7 to −0.6) |
| F-0 accepts, yardstick v2 (wrong) | 44 (17) | 44 (17) |
| F-0 accepts, `pilot-000` v2 | 992 | 960 (−0.46 points, −0.80 to −0.12) |

The recall loss is the list's tail: 26 of the 27 readings that lost the right work had it at rank 15-49 under C-3,
and 20 of them still generate it, below rank 50.

# Imprint data (C-9)

F-0d found that a read imprint matches a confirmed work's houses on 39.5 % of boxes against 7.8 % chance, and C-R2
(§3.4) traced the misses to the catalog's data: Open Library's import kept only the first publisher of an edition,
ISFDB's publisher series were staged but unused, and the parent houses were three hand aliases plus ISFDB's
"Imprint / Publisher" pairs. C-9 adds the data, and rule IMP-1 uses it (`src/eval/f0d.ts`). Pre-registration and
verdicts: `evals/C9/prereg.md`, `evals/C9/report.md`.

**Schema version 3** adds two `editions` columns; readers that do not read them open versions 1–3.

| column | holds | source |
|---|---|---|
| `publishers` | JSON array of every distinct publisher string, in order, when an edition has 2 or more; `NULL` when `publisher` is the only one | Open Library `publishers` (staging schema 2, `ol_editions.publishers`) |
| `pub_series` | the ISFDB publisher series the edition belongs to | ISFDB `pubs.pub_series_id` → `pub_series.pub_series_name` |

`publisher` is unchanged (the first string), so every pre-C-9 reader sees the same data. A version 1 Open Library
staging file still merges (its editions get `publishers = NULL`).

**Imprint keys of an edition** (`editionImprintKeys` in `src/catalog/imprint.ts`) come in two strengths:

- **strict**: what the edition itself says. Every " / " segment of every publisher string, its publisher series,
  and a **dated** Wikidata parent whose dates cover the edition's year.
- **any**: strict plus the undated parents: F-0d's ISFDB-derived pairs (`buildImprintTable`), undated Wikidata
  links, and dated ones when the edition has no year.

F-0d's tie-break and p1 read `any`; IMP-1 withholds only on a rival's `strict` match.

**Counts and verdicts** (2026-10-31 dumps): 531,138 Open Library editions carry 2+ publisher strings; 141,382
ISFDB editions carry a publisher series; the Wikidata export gives 393 parent links on 282 houses (116 dated). The
data fix moved p1 by one box (+2.8 points, under the pre-registered 10) and IMP-1's yardstick arm was uninformative,
so both stay off and the default catalogs are unchanged (`evals/C9/report.md`).

**Wikidata parents** (`wikidataParents`): one SPARQL query (`WIKIDATA_QUERY` in `src/catalog/c9-eval.ts`) for
every item with an ISFDB publisher ID (P1239) and a parent organisation (P749) or owner (P127), with the
statement's start and end (P580/P582). Each side is named by ISFDB's publisher name when it has a P1239 id, else by
its English label. Wikidata is CC0. The export stays private (the data root's `private/c9/wikidata/<date>.json`,
with the query and the response's SHA-256); committing it as repo data needs the owner's OK. Links are one level
deep (an imprint's parent, not the parent's parent).

**Shelf-mark filter** (`shelfMark`, `usableImprint`): a read imprint that holds a digit, or whose words are all at
most 3 letters with one of them beginning a surname of the box's candidate authors, is a library sticker and is
dropped before IMP-1. Label-free; its cost is a real house name that begins a candidate's surname.

| Builds (C-9) | `bookcase catalog build --out $BOOKCASE_DATA/catalog/catalog-c9.sqlite`; `pnpm catalog:ol stage --out $BOOKCASE_DATA/catalog/ol-staging-c9.sqlite`, then `bookcase catalog build --ol-staging …/ol-staging-c9.sqlite --out $BOOKCASE_DATA/catalog/catalog-v2-c9.sqlite`. Today's `catalog.sqlite`, `catalog-v2.sqlite` and `ol-staging.sqlite` are not touched. |
|---|---|
| Evaluation | `node src/catalog/c9-eval.ts wikidata`, `lists --set <name> --catalog <v1\|v2>`, `analyse` |
| Tests | `test/f0d-imprint.test.ts` (keys, parents, shelf marks, IMP-1), `test/catalog-openlibrary.test.ts` (columns, staging v1) |


# Shared book knowledge: `work_features` (KN-1)

The recommender has two halves (owner ruling, 2026-11-04). **Shared book knowledge** is genre, subject and form: catalog
facts, the same for every reader, which may support `identify`. **Personal taste** is the profile and the lenses, which
stay behind INV-13. KN-1 builds the first half as a catalog table, `work_features`, in `src/catalog/work-features.ts`.
That file imports nothing from `src/recommend/` or the profile, so `identify` can read it (KN-2's genre prior, in shadow
mode). `recommend` reads the same rows through R-0's crosswalk (`crosswalkFeatures` in `src/recommend/vocabulary.ts`),
not a copy. Nothing in `identify` reads the table yet.

**Schema version 4** adds the table. Every other table is version 3's, and readers open versions 1–4. Each build
always fills it from ISFDB's tags. With `--ol-subjects`, the build adds Open Library subjects too.

| column | holds |
|---|---|
| `work_id` | `works.id` |
| `kind` | `genre`, `form` or `subject` (`classify`) |
| `term` | the source's value: entities decoded, case-folded, `&` → `and`, spaces collapsed |
| `canon`, `family` | the canonical genre or form (`science-fiction`, `short-stories`) and its family (`sf`, `fantasy`, `form`, …); `NULL` for a subject |
| `count` | ISFDB: distinct users who applied the tag to the work's titles; Open Library: the linked records that carry the subject |
| `source` | `isfdb-tag` or `openlibrary-subject` |
| `record_id` | the source record: `isfdb-tag:<tag_id>`, or `OL<n>W` (the lowest, when several carry the subject) |
| `fetched` | the source dump's date |

The key is (`work_id`, `source`, `term`), and `canon` is indexed.

**Sources** (both are bulk files already on disk; nothing is fetched per book):

- **ISFDB tags.** Every public tag on the work's root and variant titles. That is all of them, not just `works.tags`'
  top 8, and `works.tags` itself is unchanged. ISFDB's private tags (`tag_status` 1) are left out: they are mostly
  bookkeeping, such as reading logs, holdings and e-text sources.
- **Open Library subjects.** The `subjects` field of the 2026-10-31 works dump, read once into
  `catalog/ol-subjects-<date>.sqlite` by `pnpm catalog:ol subjects --staging <ol-staging>`. Only the staged *breadth*
  works are read. A work staged only because it is on the owner's shelves (layer `shelf`, C-5) is left out, so the
  table does not depend on one reader's shelves. Places, people and times are not read, because R-0 gives setting no
  weight. Subjects reach catalog works through C-5's crosswalk (ISBN, then title plus author surname):
  - **on a v2 build**, the merge's own crosswalk;
  - **on a v1 build**, `--ol-crosswalk <ol-staging>` runs the same crosswalk without merging. It adds no edition, work,
    author or `sources` entry, so the catalog stays ISFDB-only and identical to a plain build.
- **Not sourced:** LC subject headings, LC genre/form terms and BISAC. No published bulk file of LC *records* is on disk.
  The only cached LC records are C-4's coverage cache, which was queried with spine text from the owner's shelves, so
  using it would make the shared table depend on those shelves. Open Library subjects shaped like BISAC headings
  (`Fiction, science fiction, general`) are kept as Open Library subjects. See `implementation-notes.md` (KN-1).

**Not book facts** (`NOT_BOOK_FACTS`) never enter the table:

- popularity and canon signals: awards, nominations, best-of and reading lists, bestseller lists (OC33);
- adaptations;
- bookkeeping: holdings, e-text sources, bundles, reading logs, accessibility flags, bare years.

**Genre, form or subject** (`classify`, `LEXICON`). A value is checked against a lexicon of about 60 canonical genres
and forms, with their names. It is checked whole first, then segment by segment, splitting on `--`, `/`, `,` and `;`.
A leading audience or nationality word may be dropped (`juvenile fantasy`, `american science fiction`).

- If any segment names a genre, the value is that genre, and the last such segment wins
  (`Fiction, science fiction, space opera` → `space-opera`).
- If every non-filler segment names a form, the value is that form (`Fiction, general` → `fiction`).
- Otherwise it is a subject. So LCSH's topic plus form subdivision (`Mars (Planet) -- Fiction`, OL's `Texas, fiction`)
  is a subject.

The lexicon is configuration. Growing it changes no identity decision.

**Counts** (2026-10-31 dumps, `catalog-kn1.sqlite`):

- 631,048 rows on 138,200 of 340,829 works;
- 182,471 rows from ISFDB tags and 448,577 from Open Library subjects;
- 116,704 Open Library works crosswalked to 69,233 ISFDB works that carry a subject;
- 24,584 private-tag links skipped and 16,184 values dropped as not book facts.

The aggregates on confirmed works are in `evals/KN1/report.md`.

**Reproduction.** `catalog-kn1.sqlite` holds the same rows as today's `catalog.sqlite` in every version-1 table. Every
F-0 accept on `pilot-000` and the yardstick re-decides to the same work on both (`node src/catalog/kn1-eval.ts gate`,
1.000).

| Builds (KN-1) | `pnpm catalog:ol subjects --staging $BOOKCASE_DATA/catalog/ol-staging-c9.sqlite` (about 1 min), then `bookcase catalog build --out $BOOKCASE_DATA/catalog/catalog-kn1.sqlite --ol-subjects …/ol-subjects-2026-10-31.sqlite --ol-crosswalk …/ol-staging-c9.sqlite` (about 90 s). A v2 build takes `--ol-staging` in place of `--ol-crosswalk`. Today's `catalog.sqlite`, `catalog-v2.sqlite` and C-9's files are not touched. |
|---|---|
| Readers | `workFeatures(db, workId)`, `workGenres(features)` and `hasWorkFeatures(db)` in `src/catalog/work-features.ts`; `crosswalkFeatures(vocabulary, features)` in `src/recommend/vocabulary.ts` |
| Evaluation | `node src/catalog/kn1-eval.ts gate --set <pilot-000\|yardstick>`, then `analyse` |
| Tests | `test/work-features.test.ts` (classification, drop list, provenance, extract, crosswalk-only build, recommend crosswalk, the wall); `test/catalog-openlibrary.test.ts` (schema 4) |
