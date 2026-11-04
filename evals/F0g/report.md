# F0g: copy groups (F-0g)

Run 2026-11-03, card F-0g. **Question:** bookstores shelve several copies of one book side by side. Can neighbouring
spines that look the same be grouped as copies, without grouping the books of one author's series in matching
jackets, and can a confirmed copy lend its identity to an unconfirmed twin as recorded evidence (never a bypass, never
a merge; INV-4)? Two sets, never merged (OC35): **`pilot-000`** (31 real-use photos; every reader figure is
**machine agreement, never accuracy**, INV-17) and the **yardstick (PROXY, library shelves)**, the 40-image Library
Dataset sample, used to evaluate only. No hand labels (OC36), no paid calls, nothing trained or tuned on the yardstick.
Aggregates only; photos, crops, reads and titles stay under the data root.

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

<!-- tables -->
