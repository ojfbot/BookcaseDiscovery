# C4: catalog gap on `pilot-000`

Card C-4, 2026-11-03. **Question:** on `pilot-000`, of the spine boxes whose book is readable, what share does
ISFDB hold? Among F-0's `no-catalog-match` boxes, how many are (a) in ISFDB but missed by our matching, (b) real
books ISFDB does not hold, (c) unresolved? The owner chose to measure this before reopening the Open Library import
(backlog #4; `docs/catalog/backend-options.md` § Ruling).

**Real-use data, machine reads only (OC35, OC36).** No hand labels exist and the owner draws no boxes and types no
titles, so "readable" is defined operationally below. Every figure is machine agreement with outside catalogs,
not accuracy (INV-17). Aggregates only: the per-box table stays in the data root's `private/c4/`.

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

Pending: the sample runs after this method is committed.
