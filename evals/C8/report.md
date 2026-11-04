# C8: candidate generation, rare words first

Card C-8, 2026-11-03. **Question:** on the open catalog (`catalog-v2.sqlite`, C-5), `retrieve` generates candidates
with one FTS5 trigram query per index that ORs every phrase of the reading and keeps the 250 best-ranked forms.
Common words then fill the 250 slots and push a rare title word out (C-5's `n025`: "philip" forms crowd out "ubik"),
and ranking every form that holds any phrase makes v2's p95 549 ms against v1's 94 ms. Does generating from the
rarest read words first (C-R2 §1.5) win that recall back and bring p95 under 300 ms, without losing candidate
recall on the yardstick?

Counts and shares only. Real-use figures (`pilot-000`) are machine agreement, never accuracy (INV-17); the
yardstick is a PROXY (OC35), evaluated and never tuned on; the two are never pooled. No hand labels (OC36). The
default catalog stays `catalog.sqlite` (v1): switching to v2 is not this card's call.

## Pre-registration

Written and committed before any measured run of C-8's generation: no yardstick or `pilot-000` reading was retrieved
with it, and the golden set's test half was not run with it. The generation's constants are `GENERATION` in
`src/catalog/retrieve.ts`, frozen in this commit with the code that uses them.

### What was looked at before this commit (flagged)

- **Today's generation on the whole golden set**, v1 and v2, to reproduce C-5's figures (it does: v2 noisy top-5
  95.6 %, out of the top 5 `n025`, `n062`, `n066`; p95 513 ms against C-5's 549 ms). A stage profile of that run put
  70 % of v2's time in the title FTS query and 21 % in the author FTS query; scoring took 5 %.
- **The phrases of today's 12 slowest golden queries** (both halves) with each phrase's match count on v2. That is
  how the cost was found: halves of long words (`tion` matches 619,465 title forms, `stat` 60,379) and 3-letter
  fragments (`ion` 742,517), each ranked in full by FTS5's bm25. A probe of single phrases on v2 (`ing` 437 ms,
  `world` 57 ms, `ubik` 0.2 ms) showed the cost follows the number of matching forms, and that C-7's word df does
  not predict it for fragments (`tation`: df 2, 35,474 substring matches).
- **C-8's generation on the golden set's dev half only** (78 scored queries), v1 and v2, while it was built. Every
  change below followed a dev result, as C-3's convention requires. While reading one dev query's line, its test
  twin's line (text only) was printed next to it; no test-half result was seen.
- **A smoke test of the harness** on today's generation only: 41 yardstick readings on v1, compared with C-7's cached
  top works (41 of 41 the same). No C-8 generation ran on either reading set.

### Development log (dev half only)

| step | change | dev result that led to the next step |
|---|---|---|
| 1 | Exact title lookup of every run of read tokens; then per-token trigram queries rarest first (df), each ranked by that token alone, capped at 40, into a pool of 250; halves only for long tokens the catalog does not hold as a word | v2: p95 191 ms; `n025` recovered; **`n001` lost** (a two-word title and a two-word author: ranked by one word alone, shorter forms holding that word win the 40 slots) |
| 2 | Rank each token's query by co-occurrence with the rarer tokens already queried | v2: recall back (noisy dev top-5 100 %), **p95 976 ms** (every query merges the rarer tokens' lists again) |
| 3 | Instead: one co-occurrence query over the 4 rarest catalog words first (60 forms), then the per-token queries ranked alone; a join of adjacent tokens or a 0/O reading generates only when the catalog holds it as a word (a long phrase that matches nothing still reads its trigrams' lists: 10-50 ms each) | v1 and v2: clean and noisy dev top-5 100 %; v2 p95 213 ms, v1 61 ms. **Frozen.** |
| — | Probe, not adopted: skip the per-token query of a token whose df exceeds 40, 1,000 or 5,000 | dev recall unchanged; v2 p95 106-163 ms. Not adopted: C-R2's design queries common words while the pool has room, and noisy real reads may hold only one correct, common word; yardstick recall is a hard exit |

### The generation (`retrieve`, this commit)

Once per call, over the text of all its variants (today: once per variant):

1. **Exact titles first.** Every run of up to 10 read tokens (a lone stopword excluded) is looked up in
   `title_forms(norm)` (a B-tree index); up to 50 works per run, most editions first. These do not count toward the
   pool. Short titles with no trigram ("It") are found here.
2. **Token queries, rarest first.** Each read token of 3 or more characters that is not a stopword, each join of
   adjacent tokens and each 0/O-style reading that the catalog holds as a word, ordered by C-7's df (the sidecar's
   `words` table: works carrying the token in a title, author or series form), then the longer, then the text. A
   token's query holds the token and its skeleton; a read token of 7+ letters the catalog does not hold is searched
   by its halves too. **No phrase under 3 characters goes to the trigram index.**
3. **The pool, per index** (title, author, series), 250 forms: first one query ORing the 4 rarest catalog words
   (60 forms at most), then each token's query rarest first, up to 40 new forms each, until the pool holds 250.
   Forms scoring under 0.25 are dropped (unchanged), the top 12 authors and top 8 series are expanded (400 works
   each, unchanged; an author or series reached by two forms now counts once).
4. **Scoring is unchanged:** every candidate is scored against each variant's own text; the best variant wins.

Without a statistics sidecar beside the catalog (or with a stale one, a warning), every token has df 0, so the
longer token goes first and every join and reading generates.

**All readers' tokens may generate** (`generateFrom`): other readers' text of the same spine joins steps 1-3, but
no candidate is ever scored against it, so each reader still votes on its own text (INV-6). F-0's decision layer
(`src/eval/f0.ts`) is not this card's file, so this card measures that use and recommends it or not.

### Arms

| arm | generation | readings |
|---|---|---|
| `base` | today's (`retrieve.ts` at `3778d46`, written from git into the private folder) | each reader's own text |
| **`c8`** | this commit's | each reader's own text |
| `c8u` | this commit's, with `generateFrom` = the spine's other readers' text | each reader's own text, scored on it alone |

### Measurement

- **Golden:** C-3's 161 queries and harness (`runGolden`, k = 10, one warm-up pass, one timed pass), `base` and
  `c8`, v1 and v2, **three repeats** back to back; latency gates on the **median of the three p95s**. Top-1, top-5
  and top-10 per class and half; every query out of the top 5 on either generation, with its rank at depth 50;
  every rank that changed.
- **F-0's cached readings:** the reading set C-5, C-6 and C-7 used (`all-crops`): `pilot-000` 31 photos, 6,894
  spines; `yardstick-library-b2` 40 photos, 1,132 spines. One `retrieve` per reading to depth 50 (C-6's depth, the
  deepest any F-0 rule reads), per arm and catalog, in 4 processes.
- **Reproduction gates** (the run stops under 0.999): `base`'s top work and F-0's bar match C-7's cached facts on
  every reading, and `base`'s re-decisions match C-5's cached ones (accepted work and reason).
- **F-0's decision layer:** F-0's default rule (`decide` without a guard: two readers confirm one work with score
  ≥ 0.72, title ≥ 0.8 and coverage ≥ 0.5), re-voted from the cached facts per arm. Per set and catalog: confirmed,
  gained, lost and switched against `base`; on the yardstick, wrong and correct accepts by C-5's judge
  (`isAnnotated`); on `pilot-000`, confirmations only. Under `c8u`, accepts that only the shared generation makes are
  counted separately (C-R2 §1.7: weaker evidence).
- **Yardstick candidate recall:** per spine with any read text, whether some reader's list (depth 50) holds a work
  C-5's judge calls right; also at depth 1 and 5, and per reading. The judge is per image (a work right for any
  annotated book of the photo), so recall is generous in level; the paired difference against `base` is the figure.
- **Intervals:** paired photo bootstrap (`clusterBootstrap`), 95 %, 2,000 resamples, seed 1 (C-6's and C-7's).
- **Query plans:** `EXPLAIN QUERY PLAN` of every statement `retrieve` runs, on v2; a unit test fails on any table scan.

### Keep rule

C-8's generation (`c8`) is kept when K1, K3 and K4 all hold:

1. **K1, golden clean:** top-5 ≥ 90 % on v1 and on v2 (C-3's bar).
2. **K2, golden noisy:** top-5 back to 100 % on v1 and v2; otherwise every noisy query out of the top 5 is listed with
   its mechanism. K2 does not fail the card; an unexplained loss would be a bug.
3. **K3, latency:** golden p95 (median of three runs) ≤ 300 ms on v2. v1's p95 is reported beside it.
4. **K4, yardstick candidate recall:** `c8` − `base` at depth 50, per spine, ≥ −1.0 point **on v1 and on v2**
   (point estimates; the paired intervals are reported).

Reported, not gating: F-0's accepts and wrong accepts per set and catalog (downstream cards re-baseline on them),
reading latency (the readings run as 4 processes beside other sessions), `pilot-000` machine agreement.

**If `c8` passes**, the new generation is `retrieve`'s, and F-0 runs on it with no other change. **If it fails**, the
report names the condition and this card's change to `retrieve` does not merge as it stands.

**`c8u`** is recommended for F-0's decision layer (a follow-up change to `src/eval/f0.ts`) only if `c8` passes, and on
**both** catalogs `c8u`'s recall at depth 50 is above `c8`'s and its yardstick wrong accepts are not above `c8`'s.

## Results

(Not run yet.)
