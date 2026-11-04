# C6: lookalike guard for open catalogs, then the catalog-v2 switch

Card C-6, 2026-11-03. **Question:** C-5's `catalog-v2.sqlite` (ISFDB plus Open Library) lifts first-sighting
coverage of `pilot-000`'s readable labels from 60 % to 84 %, but on the yardstick (PROXY) F-0's unchanged bar lets
more lookalikes through: wrong accepts per spine 0.5 % → 1.5 % (+1.0 point, 0.2–1.7), about 40 % of accepts. Can a
**lookalike guard** on F-0's accept rule hold wrong accepts at v1's level while keeping v2's extra confirmations, so
the default catalog can switch to v2?

Counts and shares only. Real-use figures (`pilot-000`) are machine agreement, never accuracy (INV-17); the
yardstick is a PROXY (OC35); the two are never pooled. No hand labels (OC36). Nothing below was tuned on the
yardstick or on `pilot-000`.

## Answer first

- **No arm passes the pre-registered keep rule, so the default stays `catalog.sqlite` (v1).** That holds under rule 4
  as briefed (deciding) and under the pre-registered alternative 4′. `F-0h` stays blocked on this card's switch.
- **The closest is arm (c), short title.** It passes the yardstick, `pilot-000` and golden top-5 conditions:
  - yardstick wrong accepts per spine: **0.71 % (0.18–1.32)**, against v1's 0.53 % (0.10–1.05); paired +0.18 points
    (−0.50 to 0.87);
  - `pilot-000` confirmations: **12.6 %** of spines, against v1's 10.4 %; paired +2.2 points (0.2–4.5).

  It fails rule 4 because it refuses six golden-correct v1 confirmations: five are bare one-word titles, the sixth is
  n025, the one golden query it refuses that names its author (given names only, author evidence 0.3). n025 also
  fails 4′.
- **No arm can make both sets work:**
  - the margin alone (a) and author evidence alone (b) keep too many yardstick lookalikes (1.15 % and 1.06 % per
    spine, over v1's 1.05 % bound);
  - every combination withdraws too many `pilot-000` confirmations: the interval of the gain over v1 reaches below 0.
- **Unguarded v2 is reproduced exactly** (C-5's re-decisions: 1.000 on both sets and both catalogs). Every guard
  withdraws only yardstick accepts that C-5's judge calls wrong:
  - on v2, 4 to 10 per arm, every one wrong;
  - on v1, 3 to 5, every one wrong.
- **The guard costs nothing measurable:** golden p95 is 485 ms with it and 487 ms without it, on v2. v2's own
  retrieval stays 5.9× slower than v1's (p95 487 ms against 86 ms). A smaller per-author expansion does not help
  (below).

## Pre-registration

Written and committed before anything was run on `catalog-v2.sqlite`. The only v2 access before this commit was a
schema look (the `title_norm` format and the `title_forms.kind` counts), no retrieval and no decision. The guard
constants are `LOOKALIKE` in `src/catalog/lookalike.ts`, frozen in this commit.

### What the guard is

A test on **one reader's** ranked candidates (`retrieve` on that reader's variants, the same scoring and ranking as
F-0, depth 50). A reader confirms a work only when its top candidate passes F-0's bar (`confirms`, unchanged) **and**
passes the guard's arms in force. Then F-0's vote runs unchanged: two readers must confirm the same work. The guard
can only withdraw a reader's confirmation, so it can never add an accept or switch one to another work (with three
readers, a withdrawn vote leaves either the same majority or no majority). A spine it stops falls to F-0's existing
reasons (`single-reader`, `no-catalog-match`, `readers-disagree`); no new reason is added to the label notes.

**Same book.** Two candidates are one book when they are one work id; or have the same normalised title by a shared
author surname (F-0g's `sameWork`, moved to `src/catalog/lookalike.ts` and re-exported by F-0g); or, by a shared
surname, share a main title or any whole or main title form, own or variant (`title_norm` kinds T, M, V, W;
subtitle-only forms are left out, since "a novel" is not a title). Open Library duplicate works of one book and
ISFDB omnibuses recorded under one of their books' titles are therefore one book and never each other's lookalike.
A crosswalked record is already one work id.

### Arms (each alone, then combinations)

| arm | rule | constant | why this value |
|---|---|---|---|
| **(a) margin** | the work's score beats the best *different* book among the reader's top 50 by at least the margin | `margin` **0.01** | `retrieve` ranks by score in hundredths, then by edition count. Under 0.01 the work won on popularity, not on the text. One fully matched surname on a fully matched title adds 0.058 to the noisy-or, at least 0.032 after the coverage factor; a 0.03 margin would refuse a golden query that names its author and beats a same-author graphic adaptation by 0.017 (below). |
| **(b) author evidence** | when the matched title form has one content word (stopwords dropped), or is held by `sharedBooks` or more distinct books in the catalog, author evidence must be above 0 | `sharedBooks` **2** (Open Library duplicates counted once; scan cap 200 works) | A title held by two books cannot say which one on its own. "Many" is set at its least value because the margin already handles a namesake that is in the reader's candidates; this arm asks for some author evidence whenever the catalog shows the title is ambiguous. |
| **(c) short title** | a one-content-word title match needs a second field confirmed: author evidence ≥ 0.5 or series evidence ≥ 0.8 | `secondAuthor` **0.5**, `secondSeries` **0.8** | 0.5 is a surname read with small error (surname share 0.7 × a prefix or fuzzy match of at least 0.72); series uses F-0's title bar. |
| **a+b+c** | all three | | the combination briefed |
| **a+b** | (a) and (b) | | added before any v2 run, because the golden check below shows (c) refuses a golden confirmation that carries author evidence |

### Golden calibration on v1 (the only data looked at to set constants)

C-3's 161 golden fragments on `catalog.sqlite` (v1), one query read as one reader. 147 queries have a top-1 that
passes F-0's bar and is the expected work ("golden-correct confirmations"); 2 have a top-1 that passes the bar and
is not (one clean, one `none`). With the constants above, the arms refuse these golden-correct confirmations:

| arm | refused | which (golden ids) | author evidence in the query |
|---|---:|---|---|
| (a) margin | 2 | c074, c075 (bare one-word titles; the expected book ties another book of the same title and wins on edition count) | none |
| (b) author | 8 | c074, c075, c077–c081 (bare titles), n037 (series and title, no author) | none |
| (c) short | 6 | c074, c075, c077–c080, and **n025** (a truncated author: given names only, author evidence 0.3) | n025 only |

(a) also refuses the one clean golden query v1 confirms *wrongly* (c076: a namesake of another author wins by 0.004).

So **every arm refuses at least one golden-correct v1 confirmation**, and all such refusals except n025 rest on the
title alone. A guard against namesakes refuses a bare title that another book shares; that is its purpose. The
golden set deliberately holds bare one-word titles and titles shared with other books (`docs/catalog.md`), so the
card's fourth keep condition read literally can be met by no arm. That is recorded here, before any v2 result, and
logged as a deviation (`implementation-notes.md`).

### Keep rule

Comparisons are against **v1 as shipped** (no guard). For each arm, on v2 with the arm:

1. **Yardstick (PROXY):** wrong accepts per spine are not above v1's upper bound, and the paired difference
   (v2+arm − v1) has a lower bound ≤ 0.
2. **`pilot-000`:** the paired difference in confirmed share (v2+arm − v1) has a lower bound above 0.
3. **Golden:** clean top-5 on v2 is at least 90 % (the guard does not touch retrieval; any change here is a bug).
4. **Golden-correct v1 confirmations:** the arm, applied on v1, refuses none of them.
   - **4 (strict, deciding):** none of the 147.
   - **4′ (pre-registered alternative, for the owner to rule on; not deciding here):** none of those with author
     evidence above 0 in the query, i.e. the guard may refuse confirmations that rest on the title alone.

An arm passes when 1–4 hold. If several pass, the one with the most `pilot-000` confirmations is chosen (ties: fewer
yardstick wrong accepts). **The default switches to v2 only if an arm passes under 4 (strict).** By the calibration
above none can, so this card is expected to keep v1 as the default; the report gives every arm's verdict under 4′
as well, so the owner can rule on 4′ without a post-hoc change. If no arm passes under 4′ either, the report says
what would be needed (a fresh labelled sample, or F-0h's neighbour evidence).

### Measurement

- **Data:** F-0's cached reader output per spine, the reading set C-5 used (`all-crops`), re-decided offline. No
  re-detection, no re-reading, no GPU. `pilot-000`: 31 photos, 6,894 spines. Yardstick `yardstick-library-b2`: 40
  photos, 1,132 spines.
- **Reproduction gate:** unguarded re-decisions on v1 and v2 must match C-5's cached re-decisions (accepted work and
  reason) on at least 99.9 % of spines, or the run stops.
- **Yardstick judge:** C-5's `isAnnotated` as published (ISBN on any edition, else main title plus an author
  surname, Spanish and Catalan articles dropped). Any change is logged and applied to every arm.
- **Yardstick figures:** confirmations, wrong accepts, wrong share of accepts, wrong per spine; paired differences
  against v1.
- **`pilot-000` figures:** confirmations, distinct accepted works per photo (mean over photos), unknowns by reason,
  Open Library works among accepts; how many of C-5's 34 switched confirmations (v1 accepted one work, v2 another)
  each arm withdraws.
- **Golden:** top-1, top-5 and top-10, clean and noisy, on v1 and v2; per arm, golden-correct and golden-wrong
  confirmations refused, on v1 and on v2.
- **Intervals:** paired photo bootstrap (`clusterBootstrap`), 95 %, 2,000 resamples, seed 1. C-5 used another seed,
  so v1's interval here differs slightly from C-5's; the keep rule uses this card's.
- **Latency:** p50 and p95 per `retrieve` on the 161 golden queries (warm), on v1, v2 and v2 + guard (retrieve plus
  the guard's own lookups). Reported, not gating.
- **v1 with the guard:** every arm is also run on v1 and reported.

## Results

Run 2026-11-03 on main `4d3c991` plus this card's code, on the build Mac (node v24.22.1). Numbers:
`metrics.json`. Intervals: paired photo bootstrap, 95 %, 2,000 resamples, seed 1.

**Reproduction gate.** Unguarded re-decisions match C-5's cached re-decisions (accepted work and reason) on
**1.000** of spines, on both sets and both catalogs. The yardstick judge is C-5's, unchanged.

### Yardstick `yardstick-library-b2` (PROXY: 40 photos, 1,132 spines)

The keep rule needs wrong accepts per spine **≤ 1.05 %** (v1's upper bound) and a paired lower bound ≤ 0.

| arm | catalog | confirmed | wrong accepts | **wrong per spine** | wrong share of accepts | paired Δ wrong per spine vs v1 | accepts withdrawn (all wrong) | K1 |
|---|---|---:|---:|---:|---:|---:|---:|:-:|
| none | v1 | 13 | 6 | 0.53 % (0.10–1.05) | 46 % (23–83) | — | — | |
| none | v2 | 44 | 17 | 1.50 % (0.66–2.46) | 39 % (20–62) | +0.97 (0.21–1.77) | — | ✗ |
| (a) margin | v2 | 40 | 13 | 1.15 % (0.38–2.01) | 33 % (14–56) | +0.62 (−0.10–1.44) | 4 | ✗ |
| (b) author | v2 | 39 | 12 | 1.06 % (0.38–1.82) | 31 % (13–57) | +0.53 (−0.20–1.31) | 5 | ✗ |
| **(c) short** | v2 | 35 | 8 | **0.71 % (0.18–1.32)** | 23 % (8–44) | +0.18 (−0.50–0.87) | 9 | ✓ |
| a+b+c | v2 | 34 | 7 | 0.62 % (0.09–1.25) | 21 % (5–41) | +0.09 (−0.55–0.77) | 10 | ✓ |
| a+b | v2 | 38 | 11 | 0.97 % (0.28–1.75) | 29 % (11–54) | +0.44 (−0.27–1.23) | 6 | ✓ |

**With the guard on v1:**

| guard on v1 | confirmed | wrong accepts | wrong per spine | accepts withdrawn (all wrong) |
|---|---:|---:|---:|---:|
| (a) | 10 | 3 | 0.27 % | 3 |
| (b), (c), a+b+c, a+b | 8 | 1 | 0.09 % | 5 |

The one yardstick spine that switched work from v1 to v2 is withdrawn by every arm.

### `pilot-000` (real use, machine agreement only: 31 photos, 6,894 spines)

The keep rule needs the paired Δ in confirmed share against v1 to have a lower bound **above 0**.

| arm | catalog | confirmed | confirmed share | **paired Δ vs v1** | distinct works per photo | paired Δ | Open Library works | accepts withdrawn | K2 |
|---|---|---:|---:|---:|---:|---:|---:|---:|:-:|
| none | v1 | 718 | 10.4 % (6.7–14.0) | — | 20.1 (12.1–28.8) | — | — | — | |
| none | v2 | 992 | 14.4 % (11.3–17.1) | +4.0 (2.1–6.2) | 28.3 (20.7–36.5) | +8.2 (4.4–12.8) | 342 | — | ✓ |
| (a) margin | v2 | 877 | 12.7 % (9.7–15.5) | +2.3 (0.6–4.3) | 24.8 (17.5–32.7) | +4.7 (1.4–8.6) | 269 | 115 | ✓ |
| (b) author | v2 | 837 | 12.1 % (9.2–14.8) | +1.7 (−0.2–4.0) | 23.6 (16.5–31.3) | +3.5 (−0.2–7.8) | 268 | 155 | ✗ |
| **(c) short** | v2 | 870 | 12.6 % (9.7–15.2) | **+2.2 (0.2–4.5)** | 24.6 (17.7–32.4) | +4.5 (0.5–9.3) | 274 | 122 | ✓ |
| a+b+c | v2 | 777 | 11.3 % (8.4–13.9) | +0.9 (−1.1–3.1) | 21.8 (15.1–29.3) | +1.7 (−2.0–6.0) | 230 | 215 | ✗ |
| a+b | v2 | 813 | 11.8 % (8.9–14.4) | +1.4 (−0.4–3.5) | 22.9 (15.9–30.4) | +2.8 (−0.8–6.9) | 250 | 179 | ✗ |

**With the guard on v1:**

| guard on v1 | confirmed | confirmed share | paired Δ vs unguarded v1 |
|---|---:|---:|---:|
| (a) | 666 | 9.7 % | −0.8 (−1.0 to −0.5) |
| (b) | 611 | 8.9 % | −1.6 (−2.1 to −1.1) |
| (c) | 633 | 9.2 % | −1.2 (−1.6 to −0.9) |
| a+b+c | 584 | 8.5 % | −1.9 (−2.5 to −1.4) |
| a+b | 603 | 8.8 % | −1.7 (−2.2 to −1.1) |

**C-5's 34 switched confirmations** (v1 accepted one work, v2 another):

| arm | withdrawn on v2 |
|---|---:|
| (a) | 12 |
| (b) | 13 |
| (c) | 16 |
| a+b+c | 19 |
| a+b | 14 |

None goes back to v1's work: the guard cannot switch an accept. A withdrawn spine falls mostly to `no-catalog-match`
(both readers withdrawn) or `single-reader`. `readers-disagree` falls from 189 to 73–89. Without labels, a withdrawn
`pilot-000` confirmation cannot be called right or wrong (INV-17).

### Golden fragments (C-3's 161 queries)

**Retrieval is unchanged by the guard.**

| catalog | clean top-1 | clean top-5 (bar ≥ 90 %) | noisy top-1 | noisy top-5 |
|---|---:|---:|---:|---:|
| v1 | 98.9 % | 100 % | 95.6 % | 100 % |
| v2 | 98.9 % | **100 %** ✓ | 94.1 % | 95.6 % |

These are the same as C-5's.

**Golden-correct confirmations refused**, out of 147 on v1 and 146 on v2:

| arm | on v1 (K4) | with author evidence (K4′) | on v2 | golden-wrong confirmations refused (v1 / v2) |
|---|---|---|---|---|
| (a) | 2: c074, c075 | none | 3: c074, c075, c077 | 1 of 2 / 4 of 7 |
| (b) | 8: c074, c075, c077–c081, n037 | none | 8: the same | 1 of 2 / 2 of 7 |
| (c) | 6: c074, c075, c077, c079, c080, **n025** | **n025** | 5: the same less n025 | 0 / 0 |
| a+b+c | 9: the union | **n025** | 8 | 1 of 2 / 4 of 7 |
| a+b | 8 | none | 8 | 1 of 2 / 4 of 7 |

Notes on the table:

- Golden-wrong confirmations include the `none`-class queries, whose books v2 now holds.
- On v2, n025's top-1 no longer passes F-0's bar (C-5's candidate-cap loss), so there is nothing to refuse.
- (c) leaves c078 alone: it confirms its series.

### Keep rule

| arm | K1 yardstick | K2 `pilot-000` | K3 golden top-5 | K4 strict | K4′ | **passes (4)** | **passes (4′)** |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| (a) margin | ✗ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ |
| (b) author | ✗ | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ |
| (c) short | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| a+b+c | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |
| a+b | ✓ | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ |

**Verdict: no switch. The default stays v1.** The guard ships as an option of `decide`, off unless a caller passes
it. Nothing in F-0's runners turns it on, and no v1 decision changes.

## What would be needed

1. **A ruling on bare and author-light titles.** (c) passes everything except one golden query that names its author
   only by given names (n025). Two changes would let (c) pass:
   - read "a second field confirmed" as any author evidence (author > 0);
   - make 4′ the deciding rule.

   Either is a new pre-registration on fresh data, never a retune on these numbers.
2. **A fresh labelled sample.** The yardstick has 44 v2 accepts and 17 wrong ones, so every arm's interval is wide:
   (c)'s wrong per spine runs 0.18–1.32 %. A few hundred labelled real-use spines would settle K1 directly. On
   `pilot-000`, (c)'s gain over v1 clears zero by 0.2 points.
3. **F-0h's neighbour evidence.** Most refused spines are bare titles that the guard cannot tell apart on their own
   text. Neighbours (same author, same series, same shelf section) are the second field those spines lack.

## Latency

`retrieve` per call, warm, in ms:

| catalog | golden p50 | golden p95 | golden max | `pilot-000` readings p50 | `pilot-000` readings p95 |
|---|---:|---:|---:|---:|---:|
| v1 | 32.8 | 85.8 | 120.6 | 47 | 322 |
| v2 | 181.1 | **487.3** | 1,632 | 288 | 2,209 |
| v2 + guard (all arms) | 180.8 | **484.9** | 1,606 | — | — |

- The golden runs had the host to themselves.
- The reading runs had 7 processes sharing it beside H-2's GPU work, so their figures are high in absolute terms;
  use them only as v1 against v2.
- The guard's own cost (one runner-up scan of candidates already scored, a memoised title-holder count) is below
  the run-to-run noise.

**Cheap fix, untested:** a per-author expansion cap of 100 instead of 400 kept golden top-5 (clean 100 %, noisy
95.6 %) but did not cut p95 (578 ms). Per-author expansion is not where v2's time goes. The likelier lever is C-5's
first mechanism: the title FTS query ORs every phrase of a reading, so common words pull in thousands of Open
Library forms before scoring. Two proposals:

- cap rows per phrase rather than per query;
- run rare phrases first and stop once the candidate set is full.

Either is a `retrieve` change for its own card, re-scored on the golden set.

## Caveats

- **The yardstick is small and a PROXY.** It is a Barcelona library, and C-5's judge approximates identity (title
  plus surname, or ISBN). Every withdrawn yardstick accept was judged wrong, but the counts are 4 to 10.
- **`pilot-000` is machine agreement.** Withdrawn confirmations there are not known to be wrong.
- **K4 failed by construction** under the briefed arms (pre-registration, above). It was recorded before any v2 run,
  together with 4′. One v2 schema look happened before the pre-registration commit; no retrieval or decision did.
- **"Same book" is lenient by a shared surname.** Two different books with one title by two authors of one surname
  count as one book and do not trip the margin.
