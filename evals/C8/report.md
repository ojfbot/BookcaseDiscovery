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

## Answer first

- **The keep rule fails, on K4: yardstick candidate recall on v2 falls 2.0 points** (15.2 % → 13.2 %, paired
  −2.02, −3.68 to −0.61; 18 spines lost, 1 gained). On v1 it is unchanged (0 lost, 0 gained). K1 and K3 pass.
- **So `retrieve`'s default stays C-3's generation;** C-8's is opt-in (`generation: "c8"`). F-0 and every caller run
  exactly as before (checked: the default reproduces today's ranked lists, below). Nothing downstream re-baselines.
- **Latency target met.** Golden p95 on v2 **238 ms** against today's 497 ms (median of three runs); v1 67 ms against
  82 ms. Reading the per-token costs is what found the cause: C-3's one OR-query holds halves of long words and
  3-letter fragments that FTS5 must rank in full (`tion`: 619,465 forms on v2). No statement scans a table.
- **Golden:** clean top-5 100 % on both catalogs (K1). Noisy top-5 on v2 stays 95.6 %: `n025` (the cap loss C-8
  targets) comes back at rank 1, and `n036` is a new loss; `n062` and `n066` stay out (K2, each explained below).
- **F-0's decision layer barely moves.** Yardstick accepts and wrong accepts are identical on v1 (13, 6 wrong) and on
  v2 (44, 17 wrong; 2 gained and 2 lost, all 4 wrong). `pilot-000` v2 confirmations fall from 992 to 960, paired
  **−0.46 points (−0.80 to −0.12)**; v1 718 → 714 (−0.06, −0.15 to 0.02). Machine agreement only.
- **The recall loss is the list's tail.** 26 of the 27 readings that lost the right work had it at rank 15-49 under
  C-3; 20 of them still generate it, ranked below 50. 23 of the 27 are Open Library works.
- **Other readers' tokens (`c8u`) do not help:** recall on v2 is lower still (12.9 %, −2.26), so it is not
  recommended for F-0.

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

Run 2026-11-04 on `fc2a0c9` (the pre-registration commit) on the build Mac (12 cores, node v24.22.1). Golden ran
alone. The readings ran as 6 (v1) and then 9 (v2) processes beside other sessions, so their latencies are under
load. Numbers: `metrics.json`. Intervals: paired photo bootstrap, 95 %, 2,000 resamples, seed 1.

**Reproduction gates.** `base`'s top work and F-0's bar match C-7's cached facts on **1.000** of readings, and its
re-decisions match C-5's on **1.000** of spines, on both sets and both catalogs.

### Golden fragments (161 queries)

| catalog | generation | clean top-1 / top-5 | noisy top-1 / top-5 / top-10 | noisy test half top-5 | p50 | **p95 (3 runs)** | max |
|---|---|---:|---:|---:|---:|---:|---:|
| v1 | C-3 | 98.9 % / 100 % | 95.6 % / 100 % / 100 % | 100 % | 33 ms | 82.4 (81.7, 84.1, 82.4) | 117 ms |
| v1 | **`c8`** | 98.9 % / 100 % | 95.6 % / 100 % / 100 % | 100 % | 25 ms | **67.3** (67.3, 67.4, 65.2) | 89 ms |
| v2 | C-3 | 98.9 % / 100 % | 94.1 % / 95.6 % / 97.1 % | 94.1 % | 185 ms | 496.7 (496.7, 498.8, 495.7) | 1,662 ms |
| v2 | **`c8`** | 98.9 % / 100 % | 94.1 % / 95.6 % / 95.6 % | 91.2 % | 111 ms | **238.0** (238.0, 237.2, 246.6) | 1,056 ms |

On v1 no query's rank changed. On v2 three changed, all noisy, all in the test half except `n025`. The no-match
queries' top scores are unchanged (v2 max 0.933).

**Noisy queries out of the top 5 on v2** (K2):

| query | noise | C-3 rank | `c8` rank (depth 50) | mechanism |
|---|---|---:|---:|---|
| `n025` | truncated author | out | **1** | the cap loss C-8 targets: the rare title word now goes first |
| `n036` | truncated title | 1 | **not generated** | the co-occurrence query took the 4 rarest catalog words, and two of them were joins of read words that one work each holds as a word; spaced title forms never contain a join. The single-word queries for the title's common words rank shorter forms first. Scored directly, the target is 0.857 |
| `n062` | split words, truncated author | 8 | 13 | generated, but it scores 0.38 on any generation; the exact lookups of two 2-letter fragments add works titled exactly that, which now outrank it |
| `n066` | 1/l | 23 (depth) | 23 | C-5's crowding by same-word titles, unchanged |

### Yardstick candidate recall (PROXY: 40 photos, 842 spines with read text)

| catalog | arm | at 1 | at 5 | **anywhere (depth 50)** | Δ anywhere vs C-3 | spines lost / gained | per reading |
|---|---|---:|---:|---:|---:|---:|---:|
| v1 | C-3 | 2.97 % | 3.21 % | 3.68 % (0.14-8.73) | — | — | 3.45 % |
| v1 | **`c8`** | 2.97 % | 3.21 % | 3.68 % | **0.00** | 0 / 0 | 3.50 % |
| v1 | `c8u` | 2.97 % | 3.21 % | 3.56 % | −0.12 (−0.39 to 0.00) | 1 / 0 | 3.55 % |
| v2 | C-3 | 10.21 % | 12.35 % | 15.20 % (8.30-23.42) | — | — | 13.51 % |
| v2 | **`c8`** | 10.33 % | 11.64 % | 13.18 % (6.62-21.41) | **−2.02 (−3.68 to −0.61)** | 18 / 1 | 11.61 % |
| v2 | `c8u` | 10.45 % | 11.52 % | 12.95 % (6.62-20.66) | −2.26 (−3.86 to −0.95) | 19 / 0 | 12.00 % |

At depth 5, `c8` on v2 is −0.71 points (−1.53 to −0.12). The judge is per image, so the levels are generous (v1 holds
few of this Barcelona library's books); the paired differences are the figures.

**Where the 18 lost spines went** (27 readings that had the right work under C-3, aggregates only): the right work
sat at rank 3 in one reading and at 15-49 in the other 26; under `c8`, 20 of the 27 still generate it but rank it
below 50, and 7 do not generate it. 23 are Open Library works, 4 ISFDB. 20 of the 27 readings hold a token the
catalog does not know as a word. Reading: C-3's one ranked query reached weak, deep matches that the per-token pool
replaces with other candidates; they are below F-0's bar either way (no yardstick accept changed).

### F-0's decision layer, re-voted (F-0's default rule)

| set | catalog | arm | confirmed | gained / lost / switched vs C-3 | paired Δ confirmed share | wrong (correct) |
|---|---|---|---:|---:|---:|---:|
| yardstick | v1 | C-3, `c8`, `c8u` | 13 | 0 / 0 / 0 | 0 | 6 (7) |
| yardstick | v2 | C-3 | 44 | — | — | 17 (27) |
| yardstick | v2 | **`c8`** | 44 | 2 / 2 / 0 | 0.00 (−0.35 to 0.34) | 17 (27); the 2 gained and the 2 lost are all wrong |
| yardstick | v2 | `c8u` | 44 | 2 / 2 / 0 | 0.00 | 17 (27) |
| `pilot-000` | v1 | C-3 | 718 | — | — | |
| `pilot-000` | v1 | **`c8`** | 714 | 2 / 6 / 2 | −0.06 (−0.15 to 0.02) | |
| `pilot-000` | v1 | `c8u` | 718 | 4 / 4 / 2 | 0.00 (−0.06 to 0.07) | |
| `pilot-000` | v2 | C-3 | 992 | — | — | |
| `pilot-000` | v2 | **`c8`** | 960 | 25 / 57 / 6 | **−0.46 (−0.80 to −0.12)** | |
| `pilot-000` | v2 | `c8u` | 985 | 30 / 37 / 6 | −0.10 (−0.37 to 0.17) | |

`pilot-000` changes are machine agreement, never accuracy (INV-17). Under `c8u`, accepts that only the shared
generation makes (the reader's own generation does not accept that work): `pilot-000` 5 on v1 and 30 on v2,
yardstick 1 on v2. They are weaker evidence (C-R2 §1.7).

**Reading latency** (under load, per `retrieve` to depth 50): `pilot-000` v2 p50 / p95 292 / 2,239 ms (C-3) against
169 / 518 ms (`c8`) and 242 / 590 ms (`c8u`); yardstick v2 665 / 3,034 against 272 / 581 and 322 / 631. On v1,
`pilot-000` 40 / 275 against 29 / 164.

### Keep rule

| condition | v1 | v2 |
|---|:-:|:-:|
| K1 golden clean top-5 ≥ 90 % | ✓ 100 % | ✓ 100 % |
| K2 golden noisy top-5 100 %, or each loss explained | ✓ 100 % | explained (3 queries, above) |
| K3 golden p95 ≤ 300 ms on v2 | (67 ms) | ✓ 238 ms |
| K4 yardstick recall Δ ≥ −1.0 point | ✓ 0.00 | **✗ −2.02** |
| **`c8` passes** | | **✗** |
| `c8u` recommended (recall above `c8`'s, wrong accepts not above) | ✗ (3.56 < 3.68) | ✗ (12.95 < 13.18) |

**Verdict: `c8` fails K4 on v2.** As pre-registered, the change to `retrieve`'s default does not merge: the default
stays C-3's generation and C-8's ships opt-in, so nothing that runs today changes. After that change the default was
checked against the measured C-3 arm: identical ranked lists to depth 50 on all 2,037 yardstick readings on v1, on every 5th on v2 (408), and on
every 10th `pilot-000` reading on v1 (1,028) and every 20th on v2 (514); `c8` reproduces its measured lists on the
same readings.

## What would close the gap

Each needs its own pre-registration; none is a retune of these numbers, and the yardstick stays untouched for tuning.

1. **Co-occurrence over read tokens only.** `n036` lost because joins took two of the 4 co-occurrence slots; joins
   (and 0/O readings) could stay per-token queries only.
2. **Keep C-3's ranked query as a tail filler on v2.** The losses are deep, weak matches. Running C-3's OR-query with
   only catalog words (no halves, no fragments), after the pool, would keep most of the latency gain and refill the
   tail. Its p95 cost would have to be measured.
3. **Skip exact lookups of 1-2 letter runs** unless the whole reading is that short (`n062`).
4. **Measure on a recall set that is not the yardstick**, e.g. leave-one-reader-out on `pilot-000`: does a reader's
   list hold the work two other readers agreed on (label-free, INV-17).

## Caveats

- **The yardstick is small and a PROXY** with a per-image judge; 18 spines decide K4. The interval (−3.68 to −0.61)
  contains the −1 bar, so the point estimate decides, as pre-registered; the interval does exclude 0.
- **Reading latencies ran under load** beside other sessions; golden latency ran alone and gates.
- **The golden set shaped the design on its dev half** (development log); the test half was first run here, and its
  noisy losses (`n036`, `n062`) are reported as found.
