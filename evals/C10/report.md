# C10: catalog lookup efficiency

Card C-10, 2026-11-05. Pre-registration: [`prereg.md`](prereg.md) (commit 5efdb73, before any real-data run).
Figures: [`metrics.json`](metrics.json), written by `node src/catalog/lookup-eval.ts publish`. Counts only: no query
text, title, record, image id or time leaves the data root.

**Question.** The owner ruled on 2026-11-05 that live catalog lookups stay on by default, but "we can't just look up
every entry every time it fires". How many live calls does a new photo cost once lookups are local first, never
repeated, deduplicated, budgeted and planned? And does C-4's published measurement survive the change unaltered?

## Answer first

- **G1 passes.** C-4's sample and tuning set rerun with **0 live calls** and reproduce **every** figure in
  `evals/C4/metrics.json` exactly (`estimate` with its seeded bootstrap intervals, `confirmedSanity`, `resolvedBy`,
  `isfdbBy`). The tuning set matches C-4's report too. Both arms pass: all tiers on (the default) and `--no-local`.
  **0 of 255 boxes** differ from C-4's private table (class, resolving record, union flag, genre, ISFDB hit, query
  count). The cache-hit counts are C-4's to the unit (1,024 Open Library, 291 LoC).
- **K1: live calls per new photo** (unseen set: the yardstick's 40 B2 photos, planned with no network):
  - C-10 plans **15.0 to 141.8 calls a photo** (lower to upper bound); C-4's behaviour on the same boxes plans **19.8
    to 192.4**. That is **24 % fewer** at the lower bound and **26 % fewer** at the upper.
  - Boxes that need any call: **626 of 842**, against 825.
  - Local hit rate **23.8 %**: 196 boxes answered locally, 176 of them by `catalog-v2`'s Open Library works.
  - Cache hit rate 0.3 %, as expected for photos never looked up.
  - On `pilot-000`'s 31 photos, every box with text (secondary; C-4's sample is cached), C-10 plans **90.5 to 779.0
    calls a photo** against C-4's **136.1 to 1,207.4**: about **35 % fewer**. The local hit rate is 31.3 %, and copy
    groups and works save 139 more boxes.
- **On C-4's own 235 boxes, from a cold cache** (post hoc, zero network: every "live" answer replayed from the warm
  store): C-10 would have made **935 calls** (697 Open Library, 238 LoC) where C-4 made **1,317**, **29 % fewer**.
  Without the local tier, 1,276 calls (−3 %), with C-4's classes exactly.
- **Batching stays off.** Attribution on cached responses fails the gate for three of four cells. The fourth (Open
  Library fielded) passed narrowly, but a 9-call live check reproduced only 38 of 60 subqueries' top-10s. Every
  query stays a single call.
- **The budget works on real data.** On the yardstick's sample, `--budget 50` stopped at exactly 50 requests (41
  Open Library, 9 LoC) and reported 154 boxes incomplete and 1,335 keys skipped. The local tier had already
  answered 55 boxes without a call.
- **Live calls spent by this card: 59** (9 for the batch check, 50 for the budget smoke run). The allowance was
  under 200.

## What changed

The design is in `prereg.md` § What changes. In short, a box tries tiers in this order and records which one answered:

1. **`cache`**: its C-4 queries with a fresh entry, in C-4's order.
2. **`known`**: a record already resolved for its copy group (F-0g) or its F-0 work, tried on its own reads.
3. **`local-isfdb`, `local-openlibrary`**: catalog works under C-4's resolution rule.
4. **`known-skip`**: no live call for a box whose copy or work is already resolved but whose own reads pass nothing.
5. **`live`**: within the run's budget.

Tiers 2–5 run only when a live call would otherwise be needed. So a fully cached box is resolved exactly as C-4
resolved it. That is why G1 holds with the local tier on.

- **Normalized key** (`queryKey`): source, shape, the sorted de-duplicated keyword tokens, and a fielded query's
  author surname.
- **Expiry.** Positive entries are kept. No-match entries expire after 30 days, failed ones after 7. Cache schema 2.
- **Migration.** C-4's 1,450 URL-keyed files became 1,439 entries (1,127 Open Library, 312 LoC). Nine keys collected
  more than one file (8 and 1), and **none of the nine differ** in their top-10 record ids. The version-1 files are
  untouched.
- **Budget** (`--budget`, default 100 requests per run, retries included). **Plan** (`--plan [--all]`): the calls a
  run would make, with no network.

## G1: C-4 reproduces with zero live calls

| arm | live calls | skipped keys | figures differing from C-4 | boxes differing from C-4's table |
|---|---:|---:|---:|---:|
| G1a: all tiers (default), `--budget 0` | 0 | 0 | 0 | 0 of 235 sample, 0 of 20 tuning |
| G1b: `--no-local`, `--budget 0` | 0 | 0 | 0 | 0 of 235 sample, 0 of 20 tuning |

- Every sampled box was answered by the `cache` tier: 72 resolve, 163 stay unresolved, as in C-4.
- The added counters (`resolvedBy.isfdb`, `isfdbBy.local`) are 0.
- Nothing needed explaining: no collision changed a response, and no entry had expired. C-4's one failed Open
  Library query is two days old, within its 7-day TTL.
- That failed query becomes stale on 2026-11-10. After that, a rerun with any budget retries it once (up to three
  requests). With `--offline` or `--budget 0`, the stale failure is served as before.

## K1: live calls per new photo, cache and local hit rates

**Before (C-4's call log).**
- C-4 made 1,030 Open Library and 287 LoC calls on 235 sampled boxes from 29 photos: **5.60 calls a box**.
- Within that run only 1.1 % (Open Library) and 1.4 % (LoC) of queries repeated an earlier URL.
- Under the normalized key, its 1,013 distinct Open Library URLs are 1,006 keys and its 287 LoC URLs are 286. So
  across boxes, de-duplication alone saves little on C-4's sample.
- Local hit rate before: 0, since C-4 had no local tier.

**After: the unseen photo set** (`yardstick-library-b2`, 40 photos, 842 boxes with text, PROXY, `--plan --all`).

| | boxes needing a call | lower bound (OL + LoC) | upper bound (OL + LoC + clean checks) | per photo, lower – upper |
|---|---:|---:|---:|---:|
| C-4's behaviour (URL-keyed, no local or known tier) | 825 | 790 + 1 = 791 | 5,332 + 1,537 + 825 = 7,694 | 19.8 – 192.4 |
| C-10 (all tiers, default) | 626 | 600 + 1 = 601 | 3,881 + 1,165 + 626 = 5,672 | 15.0 – 141.8 |
| change | −24.1 % | −24.0 % | −26.3 % | |

**Where the yardstick's boxes end under C-10:**

| tier | boxes |
|---|---:|
| `local-openlibrary` | 176 |
| `local-isfdb` | 20 |
| `known` | 3 |
| would go live | 626 |
| no query to send (no keyword text) | 17 |
| `cache`, `known-skip` | 0 |

- **Cache hit rate:** 17 of 5,063 distinct keys asked had a fresh entry (0.3 %). The yardstick was never looked up,
  so this is the unseen case by design.
- **Local hit rate:** 196 of 822 boxes that reached the local tier (23.8 %).
- **Which local catalog answers:** on these library shelves, mostly non-SF, `catalog-v2`'s Open Library breadth layer
  does almost all of it (176 against 20 ISFDB).
- The 600 distinct first keys are close to one per box. Reader variants of one spine and copies on a shelf rarely
  give two boxes the same first query here.

**After: `pilot-000`, every box with text** (secondary; 31 photos, 5,156 boxes, `--plan --all`). The photos are not
unseen: C-4's 255 sampled and tuning boxes are cached.

| | boxes needing a call | lower bound (OL + LoC) | upper bound (OL + LoC + clean checks) | per photo, lower – upper |
|---|---:|---:|---:|---:|
| C-4's behaviour | 4,607 | 4,214 + 4 = 4,218 | 25,320 + 7,614 + 4,495 = 37,429 | 136.1 – 1,207.4 |
| C-10 (all tiers, default) | 2,980 | 2,801 + 4 = 2,805 | 15,985 + 5,187 + 2,978 = 24,150 | 90.5 – 779.0 |
| change | −35.3 % | −33.5 % | −35.5 % | |

**Where `pilot-000`'s boxes end under C-10:**

| tier | boxes |
|---|---:|
| `local-isfdb` | 862 |
| `local-openlibrary` | 516 |
| `cache` | 232 |
| `known` | 99 |
| `known-skip` | 40 |
| would go live | 2,980 |
| unresolved with no call needed (no query, or every query cached and none resolves) | 427 |

- **Cache hit rate:** 1,375 of 22,547 distinct keys (6.1 %).
- **Local hit rate:** 1,378 of 4,398 boxes (31.3 %).
- **Copy groups and works save calls here** (99 `known` + 40 `known-skip`). That tier is empty on the yardstick,
  whose copy groups are not read (Caveats).
- **Plan cost:** one hour of CPU for 5,156 boxes and 29 minutes for 842. Both plans ran at once on one machine, and
  the local tier is the cost.

### Post hoc: C-4's sample replayed from a cold cache

Not pre-registered (added after G1 and the plans were designed). The run uses C-4's sample, an empty cache and C-10's
tiers. Each call a tier sends out is answered from the warm version-2 store, so no network is used. A failed entry
answers HTTP 500, so its three tries count. All 935 keys were in the store.

| | Open Library calls | LoC calls | total | vs C-4's 1,317 | in ISFDB / not / unresolved |
|---|---:|---:|---:|---:|---|
| C-4 (published run) | 1,030 | 287 | 1,317 | — | 50 / 22 / 163 |
| C-10, no local tier | 991 | 285 | 1,276 | −3.1 % | 50 / 22 / 163 |
| C-10, all tiers (default) | 697 | 238 | 935 | −29.0 % | 65 / 31 / 139 |

**Where the calls go.**
- With all tiers on, the local tier answered **88 boxes** (64 by an ISFDB work, 24 by a `catalog-v2` Open Library
  work) of the 222 that reached it: a local hit rate of **39.6 %**.
- One box was a `known-skip`.
- The rest of the calls come from the **139 boxes nothing resolves**. Each still walks all of C-4's queries (up to 8
  Open Library, then 2 LoC). That cap, C-4's pre-registered `LIMITS`, is now the main cost.

**The local tier makes more boxes readable.** It resolves 24 boxes that C-4's live search left unresolved (139
unresolved against 163). So a coverage run with it on is a **different measurement** from C-4's:
- "Readable" now includes books a local catalog resolves.
- ISFDB-held books become easier to resolve than non-ISFDB ones, which is the bias C-4's bound A assumes away.

This does not touch G1, because the local tier only replaces live calls. But a fresh coverage estimate on new data
should say which tiers were on. `--no-local` gives C-4's definition at a 3 % saving.

## Batching

**Attribution on cached data.** A record is attributed to a query when every query token is in the record's returned
title, subtitle, authors or subjects. Gate: recall ≥ 0.99 and cross-attribution ≤ 0.01.

| source, shape | cached positive queries | records (top 10) | recall | cross-attribution | gate |
|---|---:|---:|---:|---:|---|
| Open Library, `and` | 452 | 3,973 | 0.689 | 0.057 | fails |
| Open Library, `fielded` | 30 | 114 | 0.991 | 0.009 | passes |
| LoC, `and` | 129 | 1,161 | 0.765 | 0.008 | fails |
| LoC, `fielded` | 4 | 18 | 0.667 | 0.000 | fails |

- **`and` queries cannot be attributed.** Open Library's `q=` and LoC's CQL match fields a response does not return
  (publishers, places, contents, stemmed forms), so about a quarter to a third of their records cannot be given back
  to their own query.
- **`or` queries are never batched:** any one token suffices.

**Live check of the one passing cell.** The pass rule was fixed before the check; see the deviation in
`implementation-notes.md`.
- Thirty cached Open Library fielded queries were batched 5 and then 10 to one `q=` call (`(title:(…) AND
  author:(…)) OR …`, limit 10 per subquery): 9 calls.
- Batches of 5 reproduced **18 of 30** subqueries' top-10 record sets (record recall 0.78). Batches of 10
  reproduced **20 of 30** (0.82).
- The rule needed all of them, so **batching stays off**: every query is a single call.
- The query syntax differs from the `title=`/`author=` parameters, and a shared ranking crowds out records. Either
  alone changes which records a box is tested against, and so the measurement.

**What is batched instead.** Nothing is combined into one call. A run's queries are de-duplicated by normalized key
before calling: across boxes, across reader variants, and in the plan step.

## Live calls this card

| purpose | calls |
|---|---:|
| G1 (both arms, sample and tuning) | 0 |
| K1 plans, replay | 0 |
| Batching live check | 9 |
| Budget smoke run (`--session yardstick-library-b2 --budget 50`) | 50 |
| **Total** | **59** (allowance: under 200) |

All calls kept C-4's spacing and its identifying User-Agent, and none returned a failure. The budget smoke run, on
the yardstick's C-4-style sample (221 boxes):

- **Budget:** 50 requests used of 50, 41 Open Library and 9 LoC. 48 distinct keys were called; two requests were
  retries that then succeeded.
- **Skipped once the budget was spent:** 1,335 keys (1,042 Open Library, 293 LoC). 154 boxes are marked
  incomplete and the metrics say `complete: false`.
- **Answered without a call:** 55 boxes by the local tier, 50 of them by `catalog-v2`'s Open Library works.
- **No live answer resolved a box.** The 50 calls went to the first boxes in sample order, mostly
  `no-catalog-match` spines. Its figures are not a coverage estimate.
- A rerun continues from the cache, and only the skipped keys are called.

## Caveats

- **The yardstick is a proxy** (library shelves, OC35) and evaluation-only. Its photos were never looked up, which is
  what makes it "unseen".
- **Plan bounds are bounds.** The upper bound assumes every query of a box that would go live is called. The lower
  bound assumes each such box resolves on its first call. A real run lands between them; C-4's real run made 1,317
  calls against a C-4-behaviour upper bound of 2,013 on the same boxes (cold).
- **The yardstick's copy groups are not used.** The coverage command reads `private/f0g/<session>/copies.jsonl`, and
  F-0g wrote the yardstick's under another name. So `known` there works by F-0 work only, and its plan is
  conservative on that tier.
- **Local Open Library records carry no subjects.** A box resolved by a `catalog-v2` Open Library work that ISFDB
  lacks counts as `no-subjects` in the rough SF split.
- **The local tier trades CPU for calls.** It took about 2 s a box on the yardstick and 0.7 s on `pilot-000` (mostly
  `retrieve` on `catalog-v2`'s 4.2 M works). That is the same order as the 1.1 s spacing of the calls it saves. So it
  cuts load on the outside services more than it cuts wall time. The tier runs only for boxes that would otherwise go
  live; `--no-local` turns it off.
- **Expiry is untested on real data.** No entry is old enough yet. The tests cover it with a synthetic clock.

## Follow-ups (not done here)

- **Cap queries for boxes unlikely to resolve.** Most of the remaining calls are spent on boxes no query resolves (each
  walks up to 10 queries). C-4's post-hoc split found Q-2's `text-present` rung resolves 7.9 % of the time against 29.8 % for
  `text-read`. A per-rung query cap is the next lever, but it changes C-4's `LIMITS` and needs its own
  pre-registration.
- **Point the coverage command at a session's copy groups by box set, not by name**, so the yardstick's F-0g groups
  count.
