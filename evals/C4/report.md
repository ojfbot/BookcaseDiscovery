# C4: catalog gap on `pilot-000`

Card C-4, 2026-11-03. **Question:** on `pilot-000`, of the spine boxes whose book is readable, what share does
ISFDB hold? Among F-0's `no-catalog-match` boxes, how many are (a) in ISFDB but missed by our matching, (b) real
books ISFDB does not hold, (c) unresolved? The owner chose to measure this before reopening the Open Library import
(backlog #4; `docs/catalog/backend-options.md` § Ruling).

**Real-use data, machine reads only (OC35, OC36).** No hand labels exist and the owner draws no boxes and types no
titles, so "readable" is defined operationally below. Every figure is machine agreement with outside catalogs,
not accuracy (INV-17). Aggregates only: the per-box table stays in the data root's `private/c4/`.

## Answer first

- **ISFDB holds 59.5 % (95 % interval 48.6–71.2 %) of `pilot-000`'s readable labels** (bound A, unresolved boxes
  excluded). The floor, with every unresolved box counted as not in ISFDB, is 16.2 % (12.6–19.9 %).
- **The pre-registered OC20 trigger fires:** 59.5 % < 85 %, and the whole interval is below 85 %. It still fires if
  all 718 F-0-confirmed boxes are counted as in ISFDB (66.4 %, 57.2–76.5 %). **Recommendation: reopen backlog #4**
  with a different filter than the preserved C-2 card (below).
- **Open Library closes almost all of the readable gap:** ISFDB ∪ Open Library covers 95.9 % (89.8–100 %) of
  readable labels; LoC adds the last 4.1 %. About three quarters of the readable books ISFDB lacks are non-SF by
  their subjects (73 %, 53–91 %; rough).
- **`no-catalog-match` (3,435 boxes) splits:** (a) in ISFDB but missed by matching **3.3 %** (0.8–6.7 %), (b) real
  books ISFDB doesn't hold **15.0 %** (9.2–21.7 %), (c) unresolved **81.7 %** (74.2–88.3 %).
- **Most of `unknown` is still unresolved, not a proven catalog gap.** The resolver reads only 60 % of boxes whose
  text F-0 already matched (sanity check below), so a large part of "unresolved" is readable books the rule
  could not pin down (no author on the spine or in the read text, truncated crops), not garbled text.

## Method (pre-registered)

This section was committed before the full sample was run. The only tuning was on 20 F-0-confirmed boxes drawn
apart from the sample (the tuning set); nothing below was changed after the sample was drawn and run. Constants
live in `src/catalog/coverage.ts` (`SAMPLE`, `LIMITS`, `RESOLVE`, `SF_SUBJECT`); `metrics.json` echoes them.

It adapts backend-options §5. §5 assumed hand-labelled spines and clean labels; here the label is whatever
F-0's readers read, so an outside catalog stands in for the label and the resolution rule stands in for "readable".

### 1. Sample

- **Population:** F-0's 6,894 `pilot-000` boxes (box arm B2), stratified by F-0 outcome. `no-text` (1,738) is
  excluded: no reader read anything, a perception gap rather than a catalog gap.
- **Draw:** seeded (`SEED` 20261103), stratified, without replacement. Box ids are sorted, then shuffled per stratum
  with the seed, so the draw does not depend on file order.
- **Sizes:** `no-catalog-match` 120 of 3,435; `single-reader` 60 of 923; `readers-disagree` 15 of 80; `confirmed` 40
  of 718 (after a separate 20-box confirmed tuning set, drawn first from the same shuffle).
- **Weights:** every stratum, `confirmed` included, is weighted back to its F-0 population (N_h / n_h). F-0's
  confirmation is machine agreement and can name the wrong book (the tuning set found one confirmed box whose
  spine names a different author's book of the same title), so confirmed boxes are measured like the rest. A
  sensitivity variant counts all 718 as readable and in ISFDB.

### 2. Resolving a box from its cached reader text

Inputs are F-0's cached readings only (`f0/pilot-000/{vision,ppocr,qwen}.jsonl`); no photo or crop is opened. A
box's **readings** are every distinct reader variant (rotation and correction setting), Qwen first, then by
confidence. Qwen was prompted for "title first, then author, one per line", so its first line is taken as the
title and its second as the author.

Queries, in order, stopping at the first record that resolves the box:

1. **Fielded** (Qwen only): Open Library `title=<line 1>&author=<line 2>`; LoC `dc.title="…" and dc.creator="…"`.
2. **Per line:** each text line of each reading, its keyword tokens ANDed (both engines AND plain terms, so a
   garbled line elsewhere cannot empty the result). A line needs 4+ letters of keywords.
3. **OR across the reading:** each reading's keyword tokens joined with OR, so the engine's ranking can surface
   the book through misread tokens.

Keyword tokens: C-3's `normalize`, then tokens of 3+ characters containing a letter, stopwords dropped, at most 10.
At most **8 Open Library** queries per box, then, only for boxes Open Library did not resolve, at most **2 LoC SRU**
queries. The first 10 records of each response are tested.

- Open Library search API (keyless), at most 1 request/s (1.1 s spacing); LoC SRU (`lx2.loc.gov:210/LCDB`, MODS,
  keyless), at most 10 requests/min (6.5 s spacing). User-Agent names BookcaseDiscovery and the repository; no
  email address. Every response is cached under the data root's `catalog/coverage/`, keyed by the URL's SHA-256;
  `--offline` reruns from the cache and fails on any miss.

### 3. Resolution rule ("readable")

A record **resolves** the box when both hold (`resolves` in `coverage.ts`):

- **Title.** The record's main title (before the first `": "`, a trailing parenthetical dropped), normalised by
  C-3's `normalize`, stopwords dropped unless nothing else is left. It must hold at least **4** letters/digits.
  It is in a reading when, in one reading's tokens (initials joined, adjacent pairs joined):
  - a title of **≤ 3** content tokens has **every** token present; a longer title has **≥ 80 %** of them; or
  - (truncated spine, §5's prefix rule) the title's first k tokens are present, **k ≥ 50 %** of the title's
    tokens, and those k tokens hold **≥ 6** letters.
- **Author.** The surname of one of the record's first **3** authors is present in some reading (the same reader
  or another), read by a token that is not itself a title word. The surname is the last word after
  `"Surname, Given"` is turned round, with Jr/Sr/II/III/PhD dropped. Organisations (a name of more than 4 words, or
  one containing collection, foundation, society, press, university, library and the like) have no surname.

Token match: exact; C-3's skeleton (rn/m, vv/w, cl/d); C-3's 0/O-style digit readings; or, for record tokens of
**5+** letters, edit distance **1** (**2** from 9 letters). Surnames under 3 letters match exactly only.

A box no record resolves is **unresolved**: garbled or partial text, a spine whose author is not printed or not
read (series boxes, anthologies, many spines print only a title), or a book in neither source. These cannot be
told apart without a person.

### 4. Is the resolved book in ISFDB?

1. Any of the record's ISBNs (Open Library lists every edition's) against `editions.isbn13`.
2. Otherwise `retrieve()` with the record's clean title and authors (top 10), accepting a work whose normalised
   title form equals the record's main title (leading article ignored), or one is a whole-word prefix of the other,
   **and** which has an author with the record's surname.

Classes: **`in-isfdb`** (within F-0's `unknown` strata this is **`in-isfdb-match-miss`**: ISFDB holds the book and
F-0's matching missed it, a C-3 retrieval lever, not a catalog gap), **`not-in-isfdb`**, **`unresolved`**. A box
resolved through LoC is checked against Open Library once more with the clean title and author (§5: the catalog,
not the reader), for the union. **SF / non-SF** for `not-in-isfdb` comes from the record's subjects
(`SF_SUBJECT`: science fiction, fantasy, horror, dystopia, …). Subjects are noisy, so this split is rough.

### 5. Estimates

- **ISFDB coverage of readable labels**, two bounds: **A** unresolved excluded (treated as unreadable; the §5
  definition and the primary figure), **B** unresolved counted as not in ISFDB (a floor).
- **Unions:** ISFDB ∪ Open Library; ISFDB ∪ Open Library ∪ LoC. Under bound A the three-source union is 100 % by
  construction (readable means an outside source resolved it), so only its bound B is informative.
- Class shares within `no-catalog-match`, `single-reader` and `readers-disagree`; the match-miss share of readable
  labels, kept separate.
- **Intervals:** stratified bootstrap, 10,000 resamples within each stratum, percentile 95 %.

### 6. Decision rule (backend-options §5, pre-registered)

- If ISFDB covers **< 85 %** of readable labels (bound A point estimate), the OC20 trigger fires and backlog #4
  reopens. The interval is reported beside it.
- If the best union still covers **< 95 %**, the remainder is reported as the catalog-gap share of `unknown`
  (OC32), never forced.

## Results

Run 2026-11-03 on F-0's B2 caches. 235 sampled boxes, mean 5.6 queries a box: Open Library 1,030 live calls, LoC
287 (about 55 minutes at the rate limits); one Open Library query returned HTTP 500 on every try and is recorded as
a failure. Spend $0. `bookcase catalog coverage --offline --run-id C4` reproduces `metrics.json` with no calls.

### Sample and classes

| stratum (F-0 outcome) | population | sampled | in ISFDB | not in ISFDB | unresolved |
|---|---:|---:|---:|---:|---:|
| `no-catalog-match` | 3,435 | 120 | 4 | 18 | 98 |
| `single-reader` | 923 | 60 | 17 | 3 | 40 |
| `readers-disagree` | 80 | 15 | 5 | 1 | 9 |
| `confirmed` | 718 | 40 | 24 | 0 | 16 |
| `no-text` (excluded) | 1,738 | — | — | — | — |

Resolved boxes: 68 by Open Library, 4 by LoC. In-ISFDB checks: 49 by ISBN, 1 by clean title and author.

### ISFDB coverage of readable labels

| catalog | A: unresolved excluded | B: unresolved as not in ISFDB |
|---|---:|---:|
| **ISFDB** | **59.5 %** (48.6–71.2) | 16.2 % (12.6–19.9) |
| ISFDB ∪ Open Library | 95.9 % (89.8–100) | 26.1 % (20.7–31.5) |
| ISFDB ∪ Open Library ∪ LoC | 100 % (by construction) | 27.2 % (21.8–32.7) |
| ISFDB, all 718 confirmed counted as in ISFDB (sensitivity) | 66.4 % (57.2–76.5) | 21.7 % (18.9–24.9) |

Weighted to the whole set: about 834 readable boxes ISFDB holds (403 of them F-0 left `unknown`), 567 readable
boxes it does not (510 of those in Open Library), and 3,756 unresolved.

### Shares within F-0's `unknown` strata

| stratum | in ISFDB, match miss | not in ISFDB | unresolved |
|---|---:|---:|---:|
| `no-catalog-match` | 3.3 % (0.8–6.7) | 15.0 % (9.2–21.7) | 81.7 % (74.2–88.3) |
| `single-reader` | 28.3 % (16.7–40.0) | 5.0 % (0.0–11.7) | 66.7 % (55.0–78.3) |
| `readers-disagree` | 33.3 % (13.3–60.0) | 6.7 % (0.0–20.0) | 60.0 % (33.3–86.7) |
| all three, weighted (4,438 boxes) | 9.1 % (5.8–12.7) | 12.8 % (8.0–18.0) | 78.2 % (72.2–84.0) |

**Match miss, kept separate:** 28.8 % (19.1–38.7 %) of readable labels are books ISFDB holds that F-0 did not
confirm, mostly `single-reader` boxes, where one reader found the work and no second reader agreed. That is a
matching and agreement lever (a C-3 / F-0 follow-up), not a catalog gap.

**Not in ISFDB, by subject (rough):** SF 12.8 % (0–29 %), non-SF 73.4 % (53–91 %), no subjects 13.8 % (1–30 %).
Subject tags are noisy (a non-fiction book about magic counts as SF here, and many SF records carry only "Fiction"),
so read this as "mostly non-SF", not as a precise split.

### Sanity check: F-0-confirmed boxes

Of 40 sampled confirmed boxes, **24 resolve, and all 24 come back in ISFDB** (23 by ISBN). 22 resolve to the
work F-0 accepted and 2 to a different ISFDB work by the same author (F-0 picked the author's other book). In 13
of the 16 that do not resolve, no reading holds the surname of F-0's author: the spine's author was not read, and
the rule needs it. In
the separate tuning set (20 boxes), 13 resolved, 12 in ISFDB; one confirmed box's spine names a book of the same
title by a different author, which ISFDB does not hold. So F-0's confirmations are mostly right but not always,
which is why the confirmed stratum is measured rather than assumed.

The **resolver's sensitivity** on text known to be good is therefore about 60 % (24/40; 45–75 %). On the `unknown`
strata, whose text is worse, it is lower. Bound A assumes a box's chance of resolving does not depend on whether
ISFDB holds it; that is untested.

### Post hoc (not pre-registered): Q-2's reader-agreement rung

Q-2 merged after this design was committed, so the sample was not stratified by its rung. Among the 120 sampled
`no-catalog-match` boxes, split by Q-2's rung (τ 0.71):

| Q-2 rung | population | sampled | in ISFDB | not in ISFDB | unresolved | resolved |
|---|---:|---:|---:|---:|---:|---:|
| `text-read` (readers agree) | 1,695 | 57 | 2 | 15 | 40 | 29.8 % (19.3–42.1) |
| `text-present` (readers disagree) | 1,740 | 63 | 2 | 3 | 58 | 7.9 % (1.6–15.9) |

`text-read` boxes resolve **21.9 points more often** (8.4–35.6), and 15 of the 18 not-in-ISFDB books sit in
that rung. As a free proxy for "readable" it has recall 77 % (17 of 22 resolved boxes) and precision 30 % (17 of
57). It concentrates the real books well, but most `text-read` boxes still do not resolve. Post-stratifying by rung
gives the same `no-catalog-match` shares as the pre-registered weighting (3.3 / 15.4 / 81.3 %).

## Decision rule and recommendation

**The OC20 trigger fires** (backend-options §5 and § Ruling): ISFDB covers 59.5 % of readable labels, below 85 %,
on the owner's own real-use set. That alone reopens **backlog #4 (the Open Library import)**. The second trigger,
non-SF shelves in scope, is also met: three quarters of the readable books ISFDB lacks are non-SF.

**Rewrite the filter.** The preserved C-2 card filters Open Library to SF. Here that would admit about 13 % of the
readable books ISFDB is missing, so it would barely move coverage. Proposed instead, two layers:

1. **Shelf-held (always on).** Keep the Open Library works, and their editions, whose ISBN or normalised title plus
   author surname matches a book the live verifiers resolved on any scanned session (this card's resolution rule).
   Crosswalk to ISFDB by ISBN and merge into C-3's index, so a later scan matches locally and fuzzily. **Size:** on
   `pilot-000`, about 510 works (the weighted count of readable not-in-ISFDB boxes Open Library holds; an upper
   bound on distinct works, since copies repeat). That is about 16 per photo: kilobytes, not the 12 GB dump. Its
   limit: it only holds books something has already resolved, so it fixes repeat scans, not first sightings.
2. **Breadth (for first sightings on non-SF shelves).** The live APIs cannot match OCR noise (backend-options §2),
   so a first-time non-SF spine needs a local fuzzy index. A candidate subset is English-language works first
   published 1960 or later with at least two editions: Open Library's search counted **4.0 million** such works
   on 2026-11-03. *Hypothesis:* the search counts were unstable (two broader count queries returned HTTP 500 and one
   variant returned 0). At C-3's 426 MB per 341k works, that is on the order of 5 GB of index if it scales
   linearly. Whether that disk and build time is worth it is the owner's call; layer 1 needs no such decision.

**Catalog-gap share of `unknown` (OC32).** The best union (ISFDB ∪ Open Library ∪ LoC) reaches 100 % of readable
labels by construction and 27.2 % under bound B, so the < 95 % clause applies only to bound B, and its remainder is
mostly "unresolved", not a measured gap. What is measured: of F-0's 6,176 `unknown` boxes, **about 9 %
(567) are readable books ISFDB lacks**: the catalog gap that Open Library would close (510 of them).
About 7 % (403) are match misses, 28 % (1,738) have no text, and about 56 % (3,469) are unresolved.

## Caveats

- **No hand labels.** "Readable" means an outside catalog resolved the reader text under the rule above. It
  misses readable spines that print no author, show a truncated title, or are read too poorly, and it cannot tell a
  garbled spine from a book in no source. Every figure is machine agreement (INV-17).
- **Broken spine boxes.** F-0e (in flight) is fixing boxes that cut spines short. Short boxes shorten reader text
  and inflate `unresolved`; the coverage estimate should be rerun once F-0e lands (`--offline` reuses every cached
  query, and only new queries hit the network).
- **Small strata.** `readers-disagree` has 15 rows and the not-in-ISFDB genre split rests on 22 resolved books;
  their intervals are wide.
- **Open Library holds what it holds.** The union with Open Library is measured through its search index. A
  record the search found but whose ISBNs are missing can still be in ISFDB; one clean title-and-author `retrieve`
  is the only fallback.
- **One fixture, one store's shelves.** Real use, 31 photos. Another shop or a library will differ.
