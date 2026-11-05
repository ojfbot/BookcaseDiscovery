# C10: catalog lookup efficiency — pre-registration

Fixed 2026-11-05, before any real-data run of this card's code. Nothing below changes after seeing a result. Any
change is logged as a deviation in `implementation-notes.md`, and the report (`evals/C10/report.md`) says which
figures it touches. The constants live in `src/catalog/lookup.ts` (`LOOKUP`) at the commit that adds this file's
report.

**Question.** C-4 (`src/catalog/coverage.ts`) resolves cached reader text against live Open Library search and LoC
SRU. The owner ruled on 2026-11-05 that live lookups stay on by default, but "we can't just look up every entry every
time it fires". How many live calls does a new photo cost once lookups are local first, never repeated, deduplicated,
budgeted and planned, and does C-4's published measurement survive the change unaltered?

No hand labels (OC36). Nothing is trained. No GPU. No paid API. Counts only: no query text, title, image id or record
leaves the data root.

## What changes (the design under test)

Per box, the resolver walks **tiers** in this order and records which one answered:

1. **`cache`** — each of the box's C-4 queries (C-4's builder, `liveQueries`, unchanged: fielded, per line, OR; Open
   Library then LoC) whose **normalized key** has a fresh cache entry, in C-4's order. The first record that
   `resolves` the box wins, as in C-4.
2. **`known`** — only when some query of the box has no fresh entry (a live call would be needed): records already
   resolved for the box's **copy group** (F-0g, `private/f0g/<session>/copies.jsonl`) or for its F-0 accepted work,
   in this run or in an earlier run (persisted beside the cache), tried against the box's **own** reads with the same
   rule. Copies are never merged (INV-4): a known record must pass this box's own reads.
3. **`local`** — still only when a live call would be needed: `retrieve` (C-3) on the box's readings against the
   ISFDB catalog in use (`--db`, default `catalog.sqlite`), then against `catalog-v2.sqlite`'s Open Library works
   (`ol:` ids); the top 10 works per catalog become records (title, authors, edition ISBNs) and the same `resolves`
   rule decides. Tier names: `local-isfdb`, `local-openlibrary`.
4. **`known-skip`** — a box whose copy group or F-0 work is already resolved, but whose own reads did not pass the
   known record or any local record, makes **no** live call. It keeps its own class from its own evidence (so it is
   `unresolved` unless a cached query resolved it), flagged and counted.
5. **`live`** — the remaining queries with no fresh entry, in C-4's order, Open Library then LoC, each normalized key
   called at most once per run, under the run's **budget**. C-4's spacing (1.1 s Open Library, 6.5 s LoC), retries
   (three, with backoff) and identifying User-Agent are kept.

A box LoC resolves is checked for the Open Library union with C-4's clean title-and-author query, through the same
tiers (cache, then `catalog-v2` Open Library works, then live).

Cache-before-local is deliberate: a cached response is the evidence C-4 used and costs nothing, so a fully cached run
reproduces C-4, and the local tiers replace **live calls**, not cached ones.

### Normalized key

`<source>|<shape>|<title>|<author>`, where shape is `fielded` (Open Library `title=`/`author=`, LoC
`dc.title`/`dc.creator`), `and` (Open Library `q=` plain, LoC CQL plain) or `or` (Open Library `q=` with ` OR `, LoC
CQL with ` or `). `<title>` is the query's keyword tokens (C-4's `keywordTokens`, which uses C-3's `normalize`),
de-duplicated and sorted. `<author>` is, for `fielded`, the surname (`surnameOf`) of the author parameter, or its
sorted keyword tokens when it has no surname; empty otherwise. The key is computed from the query's URL parameters,
so an old URL and a new query get the same key by one function. Sorting merges token orders and repeated tokens;
the surname merges author spellings ("william gibson", "w gibson", "gibson"). Reader variants of one spine thereby
share an entry.

### Expiry and schema

- Cache schema version **2** (C-4's URL-keyed files are version 1), stored in each entry and in `meta.json`.
- **Positive** (HTTP 200, at least one record): kept, no expiry.
- **No-match** (HTTP 200, no record): TTL **30 days**. **Failed** (HTTP error on every try): TTL **7 days**.
  A network error is not cached (as in C-4).
- An expired entry counts as missing (it needs a live call). When no call may be made (`--offline`, budget spent),
  the stale entry is served and counted as `stale`.

### Migration

On first open, every version-1 file under `$BOOKCASE_DATA/catalog/coverage/{openlibrary,loc}/` is read and written
into the version-2 store (`catalog/coverage/v2/`) under its normalized key, its original URL kept in `legacyUrls`.
The version-1 files stay where they are, unmodified. When several version-1 entries share a key, the positive one
wins, then the earliest fetched; the others' URLs are kept on the entry. Counted: entries migrated, keys with more
than one entry (**collisions**), and collisions whose bodies give different top-10 record ids.

### Plan and budget

- `bookcase catalog coverage --plan` walks the cache, known and local tiers with no network and prints, per source,
  the live calls the run **would** make: an upper bound (every distinct key with no fresh entry among boxes left
  unresolved, plus one clean check per box that could reach LoC) and a lower bound (the distinct first such key per
  box). `--all` plans every box with text, not only C-4's sample (plan only).
- `--budget <n>` caps live **requests** (retries included) per run. Default **100**. Once reached, no further call is
  made; the skipped keys and the boxes left incomplete are reported, and the metrics say `complete: false`.
  `--offline` keeps C-4's meaning (a cache miss is an error).

### Batching

Each run's queries are de-duplicated by key before the first call (the plan step). **Combining queries into one
call** (Open Library `(A) OR (B)`, LoC CQL `or`) is adopted only if attribution is measured safe on cached data
first:

- **Attribution rule.** A record is attributed to an `and` or `fielded` query when every query token matches
  (`tokenMatch`) a token of the record's returned fields (title, subtitle, authors, subjects). An `or` query cannot be
  attributed (any one token suffices), so `or` queries are never batched.
- **Measured on every cached positive `and`/`fielded` response:** attribution recall (share of its top-10 records
  the rule gives back to their own query) and cross-attribution (share of those records the rule would also give to
  the next distinct query of the same source and shape in C-4's run order).
- **Gate:** batch a source's `and`/`fielded` queries only if recall ≥ **0.99** and cross-attribution ≤ **0.01**.
  Even then, a batched response ranks all subqueries together, so a subquery's top 10 can be crowded out; that is
  only measurable with live calls, so a passing gate is followed by a live check of at most **40** calls comparing
  batched with cached single responses before anything is switched on. A failing gate means **stay single**, no
  batching code path, no live calls spent on it, and the report says so.

## Evaluation

### G1 — C-4 reproduces with zero live calls

On C-4's sample (`pilot-000`, seed 20261103, the same 235 sample and 20 tuning boxes), after migration:

- **G1a** `bookcase catalog coverage --run-id C10-g1 --budget 0` (all tiers on, the default) and **G1b** the same
  with `--no-local`.
- **Pass:** both make **0 live calls**, report 0 skipped keys, and reproduce every figure in `evals/C4/metrics.json`
  under `estimate`, `confirmedSanity`, `resolvedBy` and `isfdbBy` exactly (the 10,000-rep bootstrap is seeded, so
  intervals must match too). The tuning set's `sanity` must match C-4's tuning run. Any difference is explained box
  by box in counts (which tier, which class transition, collision or expiry), never waved through.
- `postHoc` and `network` are not compared (`network` is expected to change: 0 calls, all cache hits).

### K1 — live calls per new photo, cache and local hit rates

- **Before** (C-4's call log): C-4's published counts (1,030 Open Library and 287 LoC calls on 235 sampled boxes of
  31 photos) and the version-1 cache's own record (entries and fetch times), giving calls per sampled box and, scaled
  to every box with text, calls per photo. Cache hit rate and local hit rate before: as measured from that log (C-4
  had no local tier: 0 by construction).
- **After**, with **no extra live calls** (`--plan`, budget irrelevant):
  - **Unseen photo set:** the yardstick's B2 session (`f0/yardstick-library-b2`, 40 photos, 842 boxes with text;
    evaluation only, PROXY, OC35), `--plan --all`: planned live calls per photo (lower and upper bound, per source),
    and the share of boxes answered by each tier (`cache`, `known`, `local-isfdb`, `local-openlibrary`, would go
    live, `known-skip`). Its **before** is the same session planned with C-4's behaviour (URL-keyed, no local, no
    known, no skip): distinct uncached URLs, upper bound.
  - **`pilot-000`, every box with text** (5,156; secondary, the photos are not unseen): the same two plans.
  - **Cache hit rate** = distinct keys with a fresh entry ÷ distinct keys a run asks for; **local hit rate** = boxes
    answered by a `local-*` tier ÷ boxes that reached the local tier.
- Reported as counts and shares, per photo and per box. No threshold: K1 is descriptive.

### Live call allowance

Any live call this card makes, for any purpose, totals **under 200**, within C-4's rate limits, logged as counts in
the report. Planned spend: 0 for G1 and K1; at most 40 for the batching live check, only if the cached gate passes;
at most 50 for one budgeted smoke run on the yardstick (`--budget 50`) that shows the budget stopping and reporting.

## Files

`src/catalog/lookup.ts` (cache, key, TTL, migration, budget, attribution), `src/catalog/lookup-plan.ts` (tiers,
local records, planner), `src/catalog/coverage.ts`, `src/catalog/coverage-cli.ts`, `test/lookup*.test.ts`,
`test/catalog-coverage.test.ts`, `evals/C10/{prereg.md,report.md,metrics.json}`.
