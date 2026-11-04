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

(pending)
