# F0h: neighbour-context hypotheses and bracketed runs (F-0h)

Card F-0h, 2026-11-03. **Question:** a spine beside a confirmed book by the same author is probably that author's
too. Can a confirmed neighbour (an **anchor**) propose its author's and its series' other works, so that the
spine's own reader text, misread by a letter or two, can pick one of a few dozen works instead of being lost among
a 340k-work catalog's namesakes? Context may stand in for **the second reader only**, never for title evidence.
Spines with no usable text get a displayable **hypothesis**, never a confirmation.

Two sets, never merged (OC35): **`pilot-000`** (31 real-use bookstore photos; every figure is **machine agreement,
never accuracy**, INV-17) and the **yardstick (PROXY, library shelves)**, the 40-image Library Dataset sample, used
to evaluate only. No hand labels (OC36), no paid calls, nothing trained or tuned on the yardstick, CPU only.
Aggregates only: photos, crops, reads, titles and author names stay under the data root.

**Context is shelf evidence, not taste (INV-13).** Everything here comes from what stands on this shelf in this
photo and from the catalog. The profile, seeds, overlay and lenses are never read.

## Answer first

- **The keep rule is met on all four parts: `confirmed-by-context` ships as a recorded, switchable basis.** F-0's
  accept rule and default catalog are unchanged.
- **`pilot-000`, half B** (16 photos, machine agreement):
  - 56 context accepts, **+3.50 confirmed boxes a photo (1.19 to 6.25)**, +1.73 points of boxes.
  - On all 31 photos (secondary): 90 accepts, +2.90 a photo (1.45 to 4.58).
- **Where they come from.** 43 of the 56 are spines where one reader already passed F-0's bar alone, so context
  stands in for the missing second reader. The other 13 are the motivating case: a misread title that no reader got
  past F-0's bar, but whose text picks one of the anchor author's works by the edit margin.
  - P1 (the author's works) proposes every accept.
  - 35 accepts come from authors with more than 60 catalog works, where the cap keeps the 60 best by the reader's
    text score.
- **The context did the work.** With anchors drawn from other rows, accepts fall to 2.35 on average (4.2 % of the
  real arm; the 95th-percentile seed 7.2 %).
- **Leave one reader out found no wrong work.** Of 627 one-reader views of confirmed spines, 220 recover the same
  work, 0 name another and 407 abstain (wrong ≤ 1.7 %, Wilson). In the same-author stress subset: 220 of 420
  recovered, 0 wrong.
  - Views whose reader fails F-0's bar alone recover 5 of 60, none wrong. These views read cleaner than real
    single-reader spines.
- **Yardstick (PROXY).** 12 context accepts, one of them wrong. Wrong accepts go from 22 to 23 (per image +0.03,
  0.00 to 0.07); the wrong share of accepts stays at 8.2 %, inside its interval.
- **Order statistics (half A, for I-2).**
  - Of adjacent confirmed pairs that are different works, 40 % share an author.
  - 79 % (65–85) of consecutive confirmed pairs are in surname order; 12 of 21 rows are ordered (≥ 80 %).
  - Bracket purity is 95 % (of 42): misfiles exist but are rare. In ordered rows, 1.6 % of confirmed spines are out
    of order with both neighbours.
  - The library yardstick is less ordered (69 %) and less author-clustered (24 %).
- **Hypotheses.** 125 spines with no usable text get a ranked author-and-works hypothesis (adjacent 120, bracket 5).
  Checked by hiding every reader of a confirmed spine on half B, the hypothesis's top 5 holds the work 21 % of the
  time, and 38 % inside a bracket. Displayable, never a confirmation.
- **Shelf strips cover 5 of 316 `pilot-000` rows** (SC-1's baseline): 5 strips, 2 stating "alphabetical by author",
  1 row set ordered by one, 4 with a section recorded. None on the yardstick.
- **Detection gaps.** 2 brackets carry a flag for F-0k: 1 gap between boxes and 2 of S-1's `front` outline gaps.
- **The owner's examples** (matched privately; render under `private/f0h/renders/pilot-000/`, examples first):
  - The neighbour-context example is **not converted on this box set, for a detection reason.** The misread spine has
    no box of its own: it lies under one oversized, unread box spanning several spines. The readable neighbour's box
    is nested inside that box, so it is in no row. That is F-0i's instance-partition problem. Re-check it on F-0i's
    box set.
  - The author-run photo shows the behaviour designed for: a run of one author's spines with unread spines between
    them, which get bracket hypotheses. On that photo: 4 context accepts and 14 hypotheses (4 of them bracketed, 4 of
    the set's 5).

## Pre-registration (committed before the first context decision)

Before this commit: the design in `docs/catalog/identification-research.md` §2.3 was read, and one feasibility
count was run on each set (boxes per kind, F-0's unknown reasons, how many unknown spines stand within two places of
a confirmed one, and how many not-a-book boxes carry shelf-strip wording). No proposal set was built, no spine's
text was tested against one, and no order statistic was computed. The constants are `CONTEXT` in
`src/eval/f0h.ts`, frozen in this commit.

### Base

Each set's shipped default, as F-0g measured it: `pilot-000` F-0e's `bands+strips` boxes and readings; the yardstick
F-0's B2 run. F-0c's and F-0f's `not-a-book` boxes are left out as targets and anchors. F-0's decision (default
catalog v1 on `pilot-000`, the inventory catalog on the yardstick, no lookalike guard, no rarity basis) is the
cached `base-decisions.jsonl`, unchanged. No box is re-detected or re-read; the GPU is not used. F-0's accept rule
and default catalog are not changed: `confirmed-by-context` is a separate, recorded basis.

**Halves.** `pilot-000` photos are sorted by the sha256 of their id; the first 15 are **half A**, the other 16
**half B**. Half A gives the order statistics and the hypothesis priors. **Every keep-rule figure on `pilot-000` is
on half B.** All-photo figures are reported beside them, marked secondary. The yardstick is used whole.

### Rows

A row is a run of upright book boxes (long side within 30° of vertical, not nested in a larger box) in one shelf
band, in order along x. A box joins the open row whose last box overlaps it vertically by at least half the shorter
height and leaves a gap of at most 3 median spine widths; otherwise it starts a new row. Lying books, face-outs and
boxes outside every band are in no row: never targets, never anchors.

### Anchors and brackets

- **Anchor:** a spine F-0 accepted (`readers-agree`) in the target's row, at most 2 places away. Not
  `confirmed-by-copy`, not `confirmed-by-context`, so confirmations never chain. An arm that also admits
  `confirmed-by-copy` anchors (F-0g's private `copies.jsonl`) is reported separately and is not in the keep rule.
- **Bracket:** two anchors L and R in one row sharing an author (`sameAuthor`), with only unconfirmed spines between
  them, at most 5. Every spine between is bracketed by that author, at any distance from L and R.
- **Target:** a book box in a row that F-0 left `unknown` and F-0g did not confirm by copy, with at least one anchor
  or bracket.

### Proposals

- **P1:** every catalog work of each anchor work's authors (`work_authors`, aliases included).
- **P2:** every work in each anchor work's direct series (`work_series`, depth 0).
- Bracket proposals are P1 of the shared author.
- Deduplicated by work. The anchor's own work stays in (another edition beside it is possible).
- **K ≤ 60** per reader. A larger set keeps its 60 best by that reader's text score (`scoreWorks`, retrieval's own
  scoring). K before the cap is logged.

### The test (`confirmed-by-context`)

Per reader with text, on each of its variants, each proposal's title forms (own, main and variant titles: kinds T,
M, V, W) are matched against the reading's tokens and joins of two adjacent tokens. Each read unit is used once,
title tokens longest first.

- A title token **matches** a read unit exactly (cost 0), by skeleton (cost 1), or by edit distance d ≤ 1 for tokens
  of up to 6 letters and d ≤ 2 for 7 or more (cost d).
- A title token is **distinctive** when it is not a stopword, has at least 3 letters, and fewer than 0.1 % of the
  catalog's works carry it (C-7's statistics sidecar, `words.works`). Catalog statistics only.
- A proposal **passes** on a reader when all of these hold:
  1. every distinctive title token matches;
  2. matched characters (length minus cost) cover at least 0.8 of the title's non-stopword characters;
  3. two distinctive tokens match, or one of 6 or more letters at cost 0–1 (blocks one-word generic matches);
  4. retrieval's own scoring of the proposal on that reading (`scoreWorks`) has title evidence ≥ 0.6 and query
     coverage ≥ 0.5 (F-0's coverage bar; the title bar drops from 0.8 to 0.6 only through rules 1–3).
- Its **cost** D is the matched costs plus the length of every unmatched non-stopword title token.
- **Margin:** the lowest-cost passing proposal wins only if no passing proposal of a different book (C-6's
  `sameBook`) costs less than D + 2.
- **No open-catalog winner:** the reader's own top retrieval candidate (depth 50, unchanged retrieval), if it is a
  different book, does not pass F-0's bar with a score more than 0.05 above the winner's.
- **No counter-evidence:** C-7's four kinds (namesake, unexplained, author, language) are checked on the winner with
  the reader's ranked candidates (`counterCheck`, all kinds). Any one firing withdraws it.
- **No conflicting reader:** no reader of the spine confirms a different work under F-0's bar (the base decision's
  `confirmed`). A repeat LLM read counts once (INV-6): there is one Qwen record per spine.
- Readers that pass the test must name one work. One is enough.

The spine is then **`confirmed-by-context`**, recorded privately with its anchors (spine ids), source (P1, P2,
bracket), K, the supporting readers, D and the margin. Otherwise it stays `unknown` with the first rule that failed.

### Hypotheses

A target with **no usable text** (no reader read a token of 3 or more letters that is not a stopword) gets a
**hypothesis**, never a confirmation:

- **author likely:** the anchor's or the bracket's author, with the prior measured on half A: the bracket purity
  (share of confirmed spines between two same-author confirmed spines that are that author) for bracketed spines,
  the same-author adjacency rate for the rest;
- **works ranked:** P1 and P2 ranked by edition count (C-7's copy-frequency prior: a shelf copy is a work in
  proportion to how often it was published) times a position weight. In a bracket whose row is ordered by author
  and whose L and R titles are in title order, works whose titles sort between them weigh 2, others 1. Top 5 kept.

A row is **ordered by author** when a shelf strip below it says so, or when at least 0.8 of its consecutive
confirmed pairs (at least 3 pairs) are in non-decreasing primary-surname order.

### Shelf-strip cue

`not-a-book` boxes whose reader text matches F-0f's strip wording are shelf strips. Each labels the row(s) whose
books stand just above it (the strip's top within one median spine height below the row's bottoms, overlapping in
x). "Alphabetical by author" wording sets that row ordered by author; section wording is recorded as the row's
genre cue. On `pilot-000`'s v1 catalog (ISFDB, one genre) the genre cue cannot change a ranking, so it is recorded
and counted only. `shelf-talker` text is never evidence and is never read here.

**Implementation note (conductor, 2026-11-03, after this pre-registration and before any result was read).** A
dedicated shelf-context layer (SC-1) is queued to read section signs, letter tabs and end caps. So the strip cue sits
behind a `RowContext` record (ordering, genre, letter range, source), and its one source is F-0f's `shelf-strip`
boxes only, not every `not-a-book` box with strip wording as written above. The ordering it sets weighs hypotheses
only; no confirmation and no keep-rule figure reads it. Rows covered are reported as SC-1's baseline.

### Detection-gap flags

Inside every bracket, S-1's `outline-gap` stretches whose dominant class is `front` (a book face with no outline),
and gaps between consecutive boxes of at least half a median spine width, are written privately for F-0k
(`private/f0h/<set>/detection-gaps.jsonl`). Counts only here.

### Half A: order statistics (label-free, reported either way, for I-2)

On half A (half B and the yardstick beside it, descriptive): the same-author rate of adjacent confirmed pairs (and
of confirmed pairs at most 2 places apart), copies (same work) counted apart; per-row alphabetical-by-author
consistency and the share of rows with a break; bracket purity; how often shelf-strip text states an ordering;
misfile estimates (in ordered rows, confirmed spines out of order with both neighbours while the neighbours are in
order with each other).

### Controls

- **Neighbour shuffle** (half B; 20 seeds, 20261103 + s): each anchor work is replaced by an accepted spine's work
  drawn from another row (another band, or another photo) whose primary author has a similar number of catalog
  works (buckets 1, 2–5, 6–20, 21–60, 61+); a bracket's shared author is replaced by one draw. Same test.
- **Leave one reader out** (half B): on spines F-0 accepted that have an anchor or bracket (other than themselves),
  each reader with text alone, the rest hidden, run through F-0h. Recovered (same work), wrong (another work) or
  abstained. These spines read more cleanly than true single-reader ones; the subset whose reader fails F-0's bar
  alone is reported apart.
- **Same-author stress:** the leave-one-reader-out views whose spine shares an author with one of its anchors.

### Keep rule (all must hold, else `confirmed-by-context` stays off and is reported only)

1. **K1** (`pilot-000`, half B): extra confirmed boxes per photo from `confirmed-by-context`, 95 % photo bootstrap
   (2,000 draws), interval excluding 0.
2. **K2** (half B): the shuffled arm's accepts, mean over seeds, are at most 10 % of the real arm's, and the 95th
   percentile seed at most 15 %.
3. **K3** (yardstick): wrong accepts (accepted work not annotated in the image) do not rise beyond their interval:
   the paired per-image change has a lower bound ≤ 0, and the wrong share of accepts with context stays inside the
   base's 95 % interval. A library may not be ordered; that is reported, not failed.
4. **K4** (half B, leave one reader out): wrong views are at most 5 % of the views F-0h accepts (point; Wilson upper
   bound reported), and at most 5 % in the same-author stress subset. With no accepts the part is vacuous, and the
   report says so.

**Reported whatever the outcome:** accepts by source (P1, P2, bracket) and K bucket; which rule stops the rest;
C-7's kinds' withdrawals (attribution); the copy-anchor arm; hypotheses and their half-B hit rate (spines F-0
accepted between anchors, with all readers hidden: top-1 and top-5 contain the accepted work); half A's order
statistics; detection-gap flags; seconds.

**Forbidden:** changing a constant after any context decision; any profile input; any cover-image matching; `shelf-
talker` text as evidence.

**Re-baseline:** if F-0i (instance partition) merges first, the run is repeated on its box set with this rule
unchanged.

## Results

Run 2026-11-03 on main `d37d2c0`'s box sets (F-0i not merged), CPU only, 13 minutes. A first full run gave the same
figures. The only change before the reported run was the strip source behind `RowContext` (the conductor's note),
which changed no confirmation and no keep-rule figure. The second run added one reported split: whether a supporting
reader already passed F-0's bar alone. Two keys of `metrics.json` (`boxes`, `spines`) were renamed after the run for the
privacy guard's allowlist (`bookBoxes`, `n`); values unchanged.

### Limits

- **`pilot-000` is machine agreement.** An anchor confirmed by two readers can be wrong, and a context accept
  inherits its author. The yardstick's 1 wrong in 12 context accepts is the only check against labels, and it is
  small.
- **Leave one reader out uses spines two readers confirmed.** They read more cleanly than true single-reader ones,
  and the views below F-0's bar are few (60).
- **Nested boxes are in no row** (F-0g's rule). A spine inside an oversized box is neither a target nor an anchor
  until F-0i partitions such boxes.
- **The genre cue is recorded, not used:** v1 (ISFDB) holds one genre.
- **Hypotheses rank by edition count.** A store's back-list is not a catalog's popularity, so top-1 is weak (10 %).

<!-- tables -->
### pilot-000 (real use): machine agreement, never accuracy

**half B (16 photos):** 16 photos, 3238 book boxes, 404 confirmed by F-0. Intervals: 95 % photo bootstrap.

| measure | value |
|---|---|
| targets (unknown, not copy-confirmed, with an anchor or bracket) | 560 (no-catalog-match 294, single-reader 191, no-text 61, readers-disagree 14); usable text 492; in a bracket 42 |
| **confirmed-by-context** | **56**; extra per photo **3.50 (1.19 to 6.25)**; +1.73 pts (0.78–2.70) of boxes |
| accepts by F-0 reason | single-reader 43, no-catalog-match 13 |
| accepts by source | P1 21, P1+P2 17, P1+bracket 10, P1+P2+bracket 8 |
| accepts by K (proposals before the cap) | 61+ (capped) 35, 11-30 10, 31-60 6, 1-10 5 |
| accepts by supporting readers | vision 26, qwen 15, vision+ppocr 7, ppocr 6, vision+qwen 2 |
| accepts: supporting reader already at F-0's bar alone | a supporting reader at F-0's bar 43, no supporting reader at F-0's bar 13 |
| targets with usable text: outcome (first failing rule) | no-proposal-passes 408, confirmed-by-context 56, bar 14, margin 5, counter:namesake 5, open-catalog-winner 2, conflicting-reader 1, counter:author 1 |
| C-7 counter-evidence withdrawals (reader trials) | namesake 6, author 1 |
| copy-anchor arm (confirmed-by-copy may anchor; not in the keep rule) | 56 accepts; extra per photo 3.50 (1.19 to 6.25) |

**all photos (secondary):** 31 photos, 6121 book boxes, 731 confirmed by F-0. Intervals: 95 % photo bootstrap.

| measure | value |
|---|---|
| targets (unknown, not copy-confirmed, with an anchor or bracket) | 1007 (no-catalog-match 518, single-reader 346, no-text 114, readers-disagree 29); usable text 882; in a bracket 78 |
| **confirmed-by-context** | **90**; extra per photo **2.90 (1.45 to 4.58)**; +1.47 pts (0.81–2.12) of boxes |
| accepts by F-0 reason | single-reader 68, no-catalog-match 22 |
| accepts by source | P1 37, P1+P2 29, P1+P2+bracket 12, P1+bracket 11, bracket 1 |
| accepts by K (proposals before the cap) | 61+ (capped) 53, 11-30 15, 31-60 11, 1-10 11 |
| accepts by supporting readers | vision 38, qwen 21, ppocr 13, vision+ppocr 13, vision+qwen 5 |
| accepts: supporting reader already at F-0's bar alone | a supporting reader at F-0's bar 68, no supporting reader at F-0's bar 22 |
| targets with usable text: outcome (first failing rule) | no-proposal-passes 732, confirmed-by-context 90, bar 28, margin 14, counter:namesake 6, conflicting-reader 5, open-catalog-winner 3, readers-disagree 2, counter:author 2 |
| C-7 counter-evidence withdrawals (reader trials) | namesake 7, author 3 |
| copy-anchor arm (confirmed-by-copy may anchor; not in the keep rule) | 90 accepts; extra per photo 2.90 (1.45 to 4.58) |

| control | value |
|---|---|
| **neighbour shuffle** (20 seeds, half B (16 photos)) | real 56; shuffled mean 2.35 (seeds 4, 5, 3, 1, 1, 3, 3, 3, 2, 1, 4, 4, 0, 3, 1, 0, 4, 2, 1, 2); ratio mean 4.2 %, p95 seed 7.2 %; draws sharing the real anchor's author 1.2 % |
| **leave one reader out** | 627 views: recovered 220, wrong 0, abstained 407; wrong share of accepts 0.0 % (Wilson 0.0–1.7 %); recovered share of views 35.1 % |
| reader below F-0's bar alone | 60 views: recovered 5, wrong 0, abstained 55; wrong share of accepts 0.0 % (Wilson 0.0–43.5 %); recovered share of views 8.3 % |
| same-author stress | 420 views: recovered 220, wrong 0, abstained 200; wrong share of accepts 0.0 % (Wilson 0.0–1.7 %); recovered share of views 52.4 % |
| leave one reader out: why abstained | no-proposal-passes 381, margin 10, bar 8, counter:author 3, open-catalog-winner 2, counter:namesake 1, conflicting-reader 1, counter:unexplained 1 |
| hypotheses (no usable text) | 125 (adjacent 120, bracket 5) |
| hypothesis check: accepted spines, every reader hidden | 280 spines: top-1 10.4 % (6.3–14.4), top-5 21.4 % (17.0–23.5); bracketed 64: top-1 20.3 % (7.7–32.7), top-5 37.5 % (17.2–52.0) |
| detection-gap flags (inside brackets, for F-0k) | 2 brackets flagged; box gaps ≥ 0.5 widths 1; S-1 front outline gaps 2 |
| **row context from signage** (source: F-0f `shelf-strip` boxes; SC-1's baseline) | 5 strips, 2 stating an ordering; rows covered 5 of 316 (ordering 1, genre 4); other not-a-book boxes with strip wording, not read 0 |
| runtime | 701 s (CPU) |

**Order statistics, pilot-000, half A** (F-0's confirmed spines in rows; label-free):

| statistic | value |
|---|---|
| adjacent confirmed pairs | 114; same work (copies) 23.7 %; other work, same author 40.2 % |
| confirmed pairs ≤ 2 places apart, different works: same author | 36.5 % of 167 |
| confirmed spine shares an author with a confirmed spine ≤ 2 places away (hypothesis prior, adjacent) | 55.6 % of 216 |
| bracket purity (between two same-author confirmed spines: same author; hypothesis prior, bracket) | 95.2 % of 42 |
| consecutive confirmed pairs in surname order (rows with ≥ 3 pairs) | 78.7 % (64.9–85.2) of 122 pairs in 21 rows (random order: about 50 %); row median 83.3 % |
| rows ordered by author (≥ 80 % in order) | 12 of 21 (57.1 %); rows with a break 13 |
| misfile candidates in ordered rows | 2 (1.6 % of their confirmed spines) |
| rows labelled by a shelf strip | 2 |

**Order statistics, pilot-000, half B (descriptive)** (F-0's confirmed spines in rows; label-free):

| statistic | value |
|---|---|
| adjacent confirmed pairs | 160; same work (copies) 30.6 %; other work, same author 51.3 % |
| confirmed pairs ≤ 2 places apart, different works: same author | 46.2 % of 234 |
| confirmed spine shares an author with a confirmed spine ≤ 2 places away (hypothesis prior, adjacent) | 66.4 % of 280 |
| bracket purity (between two same-author confirmed spines: same author; hypothesis prior, bracket) | 96.9 % of 65 |
| consecutive confirmed pairs in surname order (rows with ≥ 3 pairs) | 83.3 % (72.7–89.2) of 150 pairs in 25 rows (random order: about 50 %); row median 83.3 % |
| rows ordered by author (≥ 80 % in order) | 15 of 25 (60.0 %); rows with a break 14 |
| misfile candidates in ordered rows | 8 (4.2 % of their confirmed spines) |
| rows labelled by a shelf strip | 3 |

### yardstick (PROXY, library shelves)

**all photos:** 40 photos, 1116 book boxes, 269 confirmed by F-0. Intervals: 95 % photo bootstrap.

| measure | value |
|---|---|
| targets (unknown, not copy-confirmed, with an anchor or bracket) | 253 (no-catalog-match 145, single-reader 84, no-text 24); usable text 227; in a bracket 6 |
| **confirmed-by-context** | **12**; extra per photo **0.30 (0.12 to 0.53)**; +1.08 pts (0.40–1.89) of boxes |
| accepts by F-0 reason | single-reader 12 |
| accepts by source | P1 11, P1+bracket 1 |
| accepts by K (proposals before the cap) | 1-10 11, 11-30 1 |
| accepts by supporting readers | qwen 11, ppocr 1 |
| accepts: supporting reader already at F-0's bar alone | a supporting reader at F-0's bar 12 |
| targets with usable text: outcome (first failing rule) | no-proposal-passes 201, confirmed-by-context 12, bar 11, counter:author 2, margin 1 |
| C-7 counter-evidence withdrawals (reader trials) | author 4 |
| copy-anchor arm (confirmed-by-copy may anchor; not in the keep rule) | 12 accepts; extra per photo 0.30 (0.12 to 0.53) |

| control | value |
|---|---|
| **neighbour shuffle** (20 seeds, all photos) | real 12; shuffled mean 0.4 (seeds 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1); ratio mean 3.3 %, p95 seed 8.3 %; draws sharing the real anchor's author 0.4 % |
| **leave one reader out** | 373 views: recovered 53, wrong 0, abstained 320; wrong share of accepts 0.0 % (Wilson 0.0–6.8 %); recovered share of views 14.2 % |
| reader below F-0's bar alone | 55 views: recovered 4, wrong 0, abstained 51; wrong share of accepts 0.0 % (Wilson 0.0–49.0 %); recovered share of views 7.3 % |
| same-author stress | 94 views: recovered 53, wrong 0, abstained 41; wrong share of accepts 0.0 % (Wilson 0.0–6.8 %); recovered share of views 56.4 % |
| leave one reader out: why abstained | no-proposal-passes 311, bar 6, margin 2, counter:author 1 |
| hypotheses (no usable text) | 26 (adjacent 26) |
| hypothesis check: accepted spines, every reader hidden | 159 spines: top-1 5.0 % (1.5–9.0), top-5 17.0 % (7.7–26.5); bracketed 12: top-1 33.3 % (14.3–66.7), top-5 58.3 % (43.5–100.0) |
| detection-gap flags (inside brackets, for F-0k) | 0 brackets flagged; box gaps ≥ 0.5 widths 0; S-1 front outline gaps 0 |
| **row context from signage** (source: F-0f `shelf-strip` boxes; SC-1's baseline) | 0 strips, 0 stating an ordering; rows covered 0 of 90 (ordering 0, genre 0); other not-a-book boxes with strip wording, not read 0 |
| **yardstick wrong accepts** (accepted work not annotated in the image) | 22 → 23 (context accepts 12); per image Δ 0.03 (0.00 to 0.07); share of accepts 8.2 % (3.6–13.9) → 8.2 % (3.9–13.6) |
| runtime | 78 s (CPU) |

**Order statistics, yardstick, all photos** (F-0's confirmed spines in rows; label-free):

| statistic | value |
|---|---|
| adjacent confirmed pairs | 85; same work (copies) 2.4 %; other work, same author 24.1 % |
| confirmed pairs ≤ 2 places apart, different works: same author | 19.3 % of 161 |
| confirmed spine shares an author with a confirmed spine ≤ 2 places away (hypothesis prior, adjacent) | 25.2 % of 159 |
| bracket purity (between two same-author confirmed spines: same author; hypothesis prior, bracket) | 100.0 % of 12 |
| consecutive confirmed pairs in surname order (rows with ≥ 3 pairs) | 69.4 % (60.7–78.4) of 111 pairs in 19 rows (random order: about 50 %); row median 66.7 % |
| rows ordered by author (≥ 80 % in order) | 8 of 19 (42.1 %); rows with a break 15 |
| misfile candidates in ordered rows | 2 (3.1 % of their confirmed spines) |
| rows labelled by a shelf strip | 0 |

### Keep rule

| part | met |
|---|---|
| K1 pilot-000 half B: extra confirmed boxes per photo, interval excluding 0 | yes |
| K2 shuffle: mean ≤ 10 % and p95 seed ≤ 15 % of real accepts | yes |
| K3 yardstick wrong accepts do not rise beyond their interval | yes |
| K4 leave one reader out: wrong ≤ 5 % of accepts, same-author stress ≤ 5 % | yes |
| **confirmed-by-context on** | **yes** |

