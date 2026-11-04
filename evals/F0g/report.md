# F0g: copy groups (F-0g)

Run 2026-11-03, card F-0g. **Question:** bookstores shelve several copies of one book side by side. Can neighbouring
spines that look the same be grouped as copies, without grouping the books of one author's series in matching
jackets, and can a confirmed copy lend its identity to an unconfirmed twin as recorded evidence (never a bypass, never
a merge; INV-4)? Two sets, never merged (OC35): **`pilot-000`** (31 real-use photos; every reader figure is
**machine agreement, never accuracy**, INV-17) and the **yardstick (PROXY, library shelves)**, the 40-image Library
Dataset sample, used to evaluate only. No hand labels (OC36), no paid calls, nothing trained or tuned on the yardstick.
Aggregates only; photos, crops, reads and titles stay under the data root.

**Box set.** Each set's default boxes (`pilot-000`: F-0e `bands+strips`; yardstick: F-0's B2 run) less the boxes
F-0c's and F-0f's not-a-book rules flag (24 on `pilot-000`, 16 on the yardstick), as shipped on main `9653345`, with
F-0's cached readings and decisions. First measured on the boxes before F-0f, with no not-a-book box left out;
re-measured below, with the same constants and keep rule.

## Pre-registration (written before calibration and before any group was formed)

The neighbour pairs and their appearance similarities were computed before this was written; no label was joined to
them. The constants are `COPY`, `VISUAL` and `CALIBRATION` in `src/eval/f0g.ts` and `src/eval/f0g-cli.ts`.

**Base.** Each set's shipped default with its cached boxes, readings and F-0 decisions, as F-0c measured it: on
`pilot-000` F-0e's `bands+strips` boxes read with the shipped crop; on the yardstick F-0's own B2 run. No box is
re-detected or re-read and F-0's decision is unchanged, so every change comes from propagation.

1. **Neighbours** (`neighbours`): upright boxes (long side within 30° of vertical) in one shelf band, not nested in a
   larger box; each box is paired with the nearest box to its right that stands on the same shelf (vertical extents
   overlap by 60 % of the shorter), is not the same spine twice (centres at least 0.6 of the narrower width apart) and
   leaves a gap of at most 0.6 median spine widths. Lying books and boxes outside every band are not paired.
2. **Visual sameness** (`helpers/label/appearance.py`, pixels only, no model): each spine is warped to an upright
   16 x 96 px strip (top end up). Three similarities: normalised cross-correlation of the grey strips (best over
   shifts of up to 4 px along and 1 px across), the Bhattacharyya coefficient of hue x saturation histograms plus a
   lightness histogram of the grey pixels, and the colour layout along the spine (mean Lab distance over 12
   segments). With the two size ratios (long sides, short sides) they feed a logistic score.
3. **Calibration** (`calibrate`, pilot-000 only): positives are neighbours whose works F-0 confirmed on both sides
   and are the same work; negatives are those confirmed as different works. The threshold is the score at which
   **2 % of the negatives pass**, fitted on all of pilot-000, and the out-of-fold pass shares (3 photo folds) are
   reported. Copies must also be the same size: long sides within 15 % and short sides within 40 %, and both strips
   in frame. Same work is not the same edition (a hardback beside a paperback is a positive here), so positives
   that fail the visual test are expected and correct: the copy group is per appearance.
4. **Series guard** (`pairGuard`): a visually same pair is linked only if no read contradicts. Both confirmed: same
   work. One confirmed with work W: the other is not confirmed as another work, none of its readers confirms another
   work, and no reader's top candidate is another title with title evidence ≥ 0.8 that outscores W on that reader's
   text (C-3's scoring, `scoreWorks`). Neither confirmed: their strong title reads (passing the bar or title
   evidence ≥ 0.8) must share a work where both have one. Where both have an imprint read, it must be the same.
5. **Copy groups and propagation** (`copyGroups`, `propagate`): runs of linked neighbours. In a group whose
   confirmed copies name one work W, each unconfirmed copy is **`confirmed-by-copy`** if its own reads do not
   contradict W (as above) and at least one of its readers is consistent with W (W's title evidence on that reader's
   text ≥ 0.5, or W is its top candidate). A group whose confirmed copies disagree propagates nothing. Every copy
   keeps its own decision and box (INV-4); the source copy and the consistent readers are recorded.

**Measures, per set.** Copy groups per photo and group sizes; groups with a confirmed copy; extra confirmed boxes per
photo (paired photo bootstrap) and as a share of boxes; **wrong groupings**: of visually same neighbours whose works
F-0 confirmed on both sides, the share that are different works (and how many survive the guard); **one-reader
views**: for each such pair, each reader of one side alone, as if that side were a `single-reader` unknown, is
propagated to or not (same work: recall; different works: wrong propagations; precision); **series-guard hard
negatives**: confirmed neighbours that are different works by a shared author; the share whose one-reader views are
blocked (the guard's pass rate), and the share that pass the visual test; work-level copies per work on a shelf band
(any edition); on the yardstick, accepted boxes whose work is not annotated in the image (wrong accepts) and boxes
labelled a work beyond its annotated copies, before and with propagation; seconds. Intervals are 95 %, 2,000
resamples, photo bootstrap.

**Keep rule.** Ship propagation only if **(a)** on `pilot-000` the extra confirmed boxes per photo have a 95 %
interval excluding 0, and **(b)** on the yardstick wrong accepts do not rise beyond their interval: the paired
per-image change in wrong accepts has a lower bound ≤ 0, and the wrong share of accepted boxes with propagation
stays inside the base's 95 % interval. If either fails, propagation stays off and copy groups are reported only.

## Results

### Re-measured on F-0f's box set (main 9653345)

F-0f (#38) made shelf labels and cards `not-a-book` by default. F-0g first ran on every default box. The flagged
boxes are now left out before pairing, as if not detected. Every flagged box lies flat or sits outside every band,
so none was ever paired. But a spine nested in a flagged box was skipped as a piece of a larger box; leaving the
flagged boxes out frees those, adding 8 `pilot-000` pairs and 6 yardstick pairs.
Calibration is unchanged: the same 263 confirmed pairs and the same fitted score, so `VISUAL` did not move. No new
imprint read was needed (the GPU was not used). **The verdict holds: propagation stays on.**

| headline | before F-0f | on F-0f's box set |
|---|---|---|
| `pilot-000` boxes / not-a-book left out | 6,145 / 0 | 6,121 / 24 |
| `pilot-000` neighbour pairs | 4,416 | 4,424 |
| **copy groups per photo** (`pilot-000`) | 4.97 (3.39 to 6.65), 154 | **5.00 (3.45 to 6.65), 155** |
| group sizes 2 / 3 / 4+ | 128 / 22 / 4 | 129 / 22 / 4 |
| groups with a confirmed copy | 41 | 41 |
| **extra confirmed boxes per photo** (confirmed-by-copy) | 0.29 (0.06 to 0.58), 9 boxes | **0.29 (0.06 to 0.58), 9 boxes** |
| visually same, both confirmed: different works | 9.8 % (2.7–19.4) of 41; 0 after the guard | 9.8 % (2.7–19.4) of 41; 0 after the guard |
| hard negatives visually the same | 4.3 % (1.0–8.8) of 92 | 4.3 % (1.0–8.8) of 92 |
| **series guard: hard-negative one-reader views blocked** | 420 of 420 | **420 of 420** |
| one-reader views: right work / wrong work propagated | 96.3 % of 162 / 0 of 17 | 96.3 % of 162 / 0 of 17 |
| yardstick boxes / not-a-book left out | 1,132 / 0 | 1,116 / 16 |
| yardstick copy groups; propagated | 15; 0 | 15; 0 |
| yardstick wrong accepts | 22 → 22 (8.2 %) | 22 → 22 (8.2 %) |
| keep rule | met | **met** |

The new pairs add one group of two unconfirmed copies on `pilot-000` and nothing on the yardstick, so no decision changed.

### Verdict

- **Keep rule met: propagation ships** as the recorded decision basis `confirmed-by-copy`, beside F-0's
  `readers-agree`. On `pilot-000` it adds **0.29 confirmed boxes a photo (0.06 to 0.58)**, 9 boxes in all (+0.15
  points of boxes), each a copy beside a confirmed twin whose own readers support the work (Qwen on 7, Vision on 6,
  PP-OCR on 3). Distinct works per photo cannot change: propagation only labels more copies of works already
  confirmed. The lift is small because few unconfirmed boxes sit in a group with a confirmed copy (12 in 31 photos).
- **The yardstick part of the rule passes vacuously.** Library shelves rarely hold copies side by side: 15 copy
  groups in 40 images, one with a confirmed copy and none with an unconfirmed one, so nothing propagated and wrong
  accepts stayed at 22 (8.2 % of accepted). The yardstick shows the visual test and guard do not invent copies on
  library shelves; it cannot show propagation's error rate. That comes from the one-reader views below.
- **Copies are common in the bookstore.** Of `pilot-000` neighbours that F-0 confirmed on both sides, 28 % are the
  same work (74 of 263). Copy groups: **5.00 a photo (3.45 to 6.65)**, 155 in 26 of 31 photos, mostly pairs (129),
  22 of three and 4 of four or more; 41 hold a confirmed copy. At the work level, 86 works have two or more copies
  on one shelf band, and 52 of those are not all in one copy group (another edition or look beside them, or a copy
  the visual test missed); they are still counted together as copies of the work.
- **Visual sameness is a weak filter on its own and the guard is needed.** Out of fold the visual test passes 59 % of
  same-work confirmed neighbours (positives include different editions, which it should not pass) and 3.2 % of
  different-work ones. Of visually same neighbours both confirmed, 9.8 % (2.7–19.4) are different works (4 of 41);
  the guard rejects all 4. One author's series in matching jackets is the reason: visually same 4.3 % of hard
  negatives (shared author, different work) against 0.0 % of other different-work neighbours.
- **Series guard: no hard negative propagated.** Hiding a confirmed copy and keeping one of its readers at a time
  (the commonest unconfirmed state, `single-reader`), 420 of 420 hard-negative views are blocked; of the 44 whose
  reader is below F-0's bar on its own, 26 are blocked by the series rule (another title read with title evidence
  ≥ 0.8 that outscores the work) and 18 by the consistency rule. On all confirmed pairs that look the same, one-reader
  views propagate the right work 96 % of the time (57 % when the reader is below the bar) and never the wrong one
  (0 of 17). That is an estimate on 41 pairs, not a guarantee: the intervals are wide.
- **Imprint guard.** It split 1 `pilot-000` pair and 2 yardstick pairs. `pilot-000` imprints were read only on the
  23 members of groups where propagation could happen (the F-0d reads sit on F-0's older boxes).
- **Cost.** Appearance similarities take 0.28 s a photo (9 s for `pilot-000`); the guard, groups and propagation
  under a second a set once each spine's reader tops are cached (832 s for `pilot-000`, the same catalog calls F-0's
  decision makes).

### Limits

- Calibration had 263 pairs from 17 photos, on the dev set it is then measured on (OC11): optimistic.
- Lying books (stacks) and boxes outside every band are never paired.
- The yardstick scores groupings at image level only (no masks locally): a propagated label on another book whose
  twin is annotated would not show as wrong.
- `pilot-000` figures are machine agreement: two copies confirmed as one work can both be wrong.

<!-- tables -->
### Calibration (pilot-000, confirmed neighbours)

263 neighbour pairs in frame with both identities confirmed in 17 photos: 74 same work, 189 different works. Out of fold (3 photo folds): 59.5 % of same-work pairs and 3.2 % of different-work pairs pass the visual test.

### pilot-000 (real use): machine agreement, never accuracy

31 photos, 6121 boxes, 4424 neighbour pairs (4398 in frame). Intervals: 95 % photo bootstrap.

| measure | value |
|---|---|
| visually the same | 252 pairs |
| rejected by the series guard | 67 (reads-differ 40, reads-other-title 14, reader-confirms-other 8, accepted-differ 4, imprint-differs 1) |
| **copy groups per photo** | **5.00 (3.45 to 6.65)** (155 groups in 26 photos) |
| groups with a confirmed copy, per photo | 1.32 (0.65 to 2.10) (41) |
| group sizes | 2 copies: 129, 3 copies: 22, 4+ copies: 4 |
| confirmed boxes (F-0, two readers) | 731; per photo 23.58 (13.93 to 33.77) |
| **extra confirmed boxes per photo (confirmed-by-copy)** | **0.29 (0.06 to 0.58)** (9 boxes; +0.15 pts (0.03–0.28) of boxes) |
| unconfirmed copies not propagated | no-consistent-reader 2, reads-other-title 1 |
| readers consistent with the work, on propagated copies | qwen 7, vision 6, ppocr 3 |
| neighbours both confirmed: different works | 71.9 % (66.5–78.3) of 263 |
| **visually-same neighbours both confirmed: different works** (the visual test's wrong groupings) | **9.8 % (2.7–19.4)** of 41; left after the guard: 0 |
| one-reader views of a confirmed copy: propagated, same work | 96.3 % (92.6–99.3) of 162 (reader below the bar: 57.1 % (37.5–81.8) of 14) |
| one-reader views: propagated, different work (wrong) | 0.0 % (0.0–0.0) of 17 (reader below the bar: 0.0 % (0.0–0.0) of 1) |
| propagation precision on one-reader views | 100.0 % (100.0–100.0) |
| **hard negatives** (both confirmed, different works, shared author) | 92 pairs; visually the same: 4.3 % (1.0–8.8) (other different-work pairs: 0.0 % (0.0–0.0)) |
| hard negatives, full reads: rejected by the guard | 4 of 4 visually same |
| **series guard: hard-negative one-reader views blocked** | **100.0 % (100.0–100.0)** of 420 (visually same only: 100.0 % (100.0–100.0) of 17; reader below the bar: 100.0 % (100.0–100.0) of 44) |
| blocked by | reader-confirms-other 376, reads-other-title 26, no-consistent-reader 18 |
| copies per work on one shelf band (work level, any edition) | 1: 547, 2: 74, 3: 7, 4+: 5 |
| works with two or more copies on a band; of them in more than one copy group or alone (another edition or look) | 86; 52 |
| runtime | appearance p50 0.281 s a photo (9 s in all); guard, groups and propagation 0 s for the set |

### yardstick (PROXY, library shelves)

40 photos, 1116 boxes, 673 neighbour pairs (672 in frame). Intervals: 95 % photo bootstrap.

| measure | value |
|---|---|
| visually the same | 29 pairs |
| rejected by the series guard | 7 (reads-differ 3, reads-other-title 2, imprint-differs 2) |
| **copy groups per photo** | **0.38 (0.15 to 0.63)** (15 groups in 9 photos) |
| groups with a confirmed copy, per photo | 0.03 (0.00 to 0.07) (1) |
| group sizes | 2 copies: 9, 3 copies: 5, 4+ copies: 1 |
| confirmed boxes (F-0, two readers) | 269; per photo 6.72 (5.12 to 8.38) |
| **extra confirmed boxes per photo (confirmed-by-copy)** | **0.00 (0.00 to 0.00)** (0 boxes; +0.00 pts (0.00–0.00) of boxes) |
| unconfirmed copies not propagated | none |
| readers consistent with the work, on propagated copies | none |
| neighbours both confirmed: different works | 97.7 % (91.7–100.0) of 85 |
| **visually-same neighbours both confirmed: different works** (the visual test's wrong groupings) | **66.7 % (0.0–100.0)** of 3; left after the guard: 0 |
| one-reader views of a confirmed copy: propagated, same work | 100.0 % (100.0–100.0) of 6 (reader below the bar: 100.0 % (100.0–100.0) of 2) |
| one-reader views: propagated, different work (wrong) | 0.0 % (0.0–0.0) of 10 (reader below the bar: 0.0 % (0.0–0.0) of 2) |
| propagation precision on one-reader views | 100.0 % (100.0–100.0) |
| **hard negatives** (both confirmed, different works, shared author) | 19 pairs; visually the same: 0.0 % (0.0–0.0) (other different-work pairs: 3.1 % (0.0–8.0)) |
| hard negatives, full reads: rejected by the guard | 0 of 0 visually same |
| **series guard: hard-negative one-reader views blocked** | **100.0 % (100.0–100.0)** of 84 (visually same only: – of 0; reader below the bar: 100.0 % (100.0–100.0) of 8) |
| blocked by | reader-confirms-other 76, reads-other-title 8 |
| copies per work on one shelf band (work level, any edition) | 1: 252, 2: 7, 3: 1 |
| works with two or more copies on a band; of them in more than one copy group or alone (another edition or look) | 8; 7 |
| **yardstick wrong accepts** (accepted work not annotated in the image) | 22 → 22; per image Δ 0.00 (0.00 to 0.00); share of accepted 8.2 % (3.6–13.9) → 8.2 % (3.6–13.9) |
| boxes labelled a work beyond its annotated copies | 6 → 6 |
| runtime | appearance p50 0.052 s a photo (2 s in all); guard, groups and propagation 0 s for the set |

### Keep rule

| part | met |
|---|---|
| pilot-000 confirmed boxes rise, interval excluding 0 | yes |
| yardstick wrong accepts do not rise beyond their interval | yes |
| **ship propagation** | **yes** |

