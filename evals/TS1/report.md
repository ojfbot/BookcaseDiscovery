# TS1: reader error-overlap audit (TS-1)

## Pre-registration (committed before the first full run)

Fixed 2026-11-04, before any full-set run of the audit. Nothing below is changed after seeing a full result; any
change is logged as a deviation in `implementation-notes.md`, and the report says which figures it touches.

**Question.** F-0 accepts a label when two of its three readers name one catalog work that passes the bar. Tri-training
and OCR-ensemble work says agreement is good evidence only when the readers' errors are **uncorrelated**. Are they?

- Apple Vision and PP-OCRv5 are both detect-then-recognise OCR engines, so their errors may overlap.
- Qwen3-VL's mistakes tend to be fluent: a Qwen agreement on a plausible title may be weaker evidence.

TS-0 (ledger export) and TS-2 (distilled reader) will train only on labels that pass agreement plus the catalog check.
This audit tells them how much each kind of agreement can be trusted. **It is an audit: it changes no decision**, and
nothing in F-0's accept rule, the catalog or the decision layer is touched.

**Sets, never merged (OC35).**

- **`pilot-000`**: 31 real-use photos; Q-3's kept boxes (F-0e's `bands+strips` boxes after the shipped not-a-book
  filter and F-0i's partition) with F-0's cached decision on F-0e's cached readings (H-2's `base-decisions`, the
  decisions Q-3 audited). Every figure is **machine agreement, never accuracy** (INV-17). It is a dev set (OC11).
- **Yardstick (PROXY)**: the 40-image Library Dataset sample, F-0's B2 boxes after the same filter and partition,
  with F-0's cached decision. It has real titles (each image's annotated books, matched to the library's inventory
  catalog as Q-1 and Q-3 do). **Evaluation only: never trained or tuned on.** Its catalog is a closed inventory of
  15,229 books, an easier catalog than ISFDB, so its wrong shares are optimistic for open-catalog use.

No hand labels (OC36). No GPU and no model run: every input is an existing private cache. The only new lookups are
catalog reads by work id (a work's title forms and the C-7 statistics sidecar), local, no network.

**Looked at before fixing the measures (disclosed).** F-0's published per-pair agreement table (`evals/F0/report.md`),
F-0's routing rule in `src/eval/f0.ts`, record shapes and join counts of the caches below, and Q-3's published
stratum counts. No error, agreement or dissent figure was computed on either set's per-box records before this commit.
The code is debugged on synthetic records (the tests).

### The structural fact that shapes this audit

F-0 sends a crop to Qwen only when it is **hard**: Vision and PP-OCR have not confirmed the same work
(`hard = !(vision && vision === ppocr)` in `vote`), capped per photo (40 on `pilot-000`, 15 on the yardstick). So:

1. Qwen never reads a crop on which Vision and PP-OCR agree. A Vision+PP-OCR label has **no third reader**.
2. On every crop Qwen reads, Vision and PP-OCR did not co-confirm one work. Every pair measure involving Qwen is
   **conditional on that**, and is reported as such, never as Qwen's unconditional error rate.
3. A Vision+Qwen label is a crop where PP-OCR confirmed nothing or another work; a PP-OCR+Qwen label is a crop where
   Vision confirmed nothing or another work. "Qwen plus one OCR" means, by construction, the other OCR failed.

### Reference sets

- **Yardstick: the annotation.** Independent of the stack. A reader's confirmation is **right** if its work is among
  the image's annotated inventory works, **wrong** if not. The truth is image-level (no spine geometry), so a reader
  confirming a neighbour's title counts right: wrong shares are lower bounds.
- **`pilot-000`: catalog-confirmed books.** The only independent check there is the catalog, so the reference set is
  every kept box F-0 accepted (`readers-agree`: two or more readers name one work that passes the bar). Its work is the
  reference work. **It is biased towards books the readers already got right**: by construction it holds only books
  at least two readers read well enough for the catalog, never a book no pair got right. `confirmed-by-copy` (F-0g)
  and `confirmed-by-context` (F-0h) spines are **not** added: both bases are built to exclude a reader confirming
  another work, so they cannot show reader error. Its size is reported, overall and per photo.

On `pilot-000`'s reference set, **every pair contains at least one reader that set the reference**, so P(both wrong)
is 0 by construction for every pair, and a leave-pair-out reference (the third reader's confirmation) is degenerate
under the routing above (with PP-OCR or Vision as the reference for a Qwen pair, the other OCR reader is wrong on
every Qwen-read crop; with Qwen as the reference, Vision and PP-OCR never co-confirm). The joint-error measures are
therefore computed **on the yardstick only**, and `pilot-000` gets the measurable proxy: **third-reader dissent**.

### Per-box reader outcomes

For each reader R ∈ {Vision, PP-OCR, Qwen} on a box: **read** (R was asked: in the decision's `top`), **confirmed
work** (R's top candidate passing F-0's bar, or none), **top work** (R's top candidate, passing or not).

Yardstick error events, per reader on a box it read:

- **E (wrong confirmation)**, primary: R confirms a work that is not annotated in the image. This is the error that
  can become a wrong training label.
- **F (fail)**, secondary: R does not confirm an annotated work (abstaining counts as failing). The classic
  ensemble sense of error; its overlap is dominated by shared difficulty (a spine neither can read).

### Measures

**M1 Pair error overlap (yardstick).** For each pair (Vision–PP-OCR, Vision–Qwen, PP-OCR–Qwen), over boxes read by
both (for Qwen pairs: the Qwen-read hard crops), for E and for F:

- n; P(A wrong), P(B wrong); P(both wrong) and the independence product P(A wrong)·P(B wrong);
- **lift** = P(both wrong) ÷ (P(A wrong)·P(B wrong));
- **phi** (Pearson correlation of the two 0/1 indicators) and **Yule's Q** = (ad − bc) / (ad + bc), with 0.5 added
  to every cell when any cell is 0 (Haldane; flagged);
- **P(same wrong work)**: both confirm one work and it is wrong; and the share of joint wrong confirmations that are
  the same work;
- **agreement wrong share**: of boxes where both confirm the same work, the share that is wrong.

**M2 Label wrong share by agreeing set (yardstick).** F-0's accepted labels, split by the readers that agreed
(Vision+PP-OCR, Vision+Qwen, PP-OCR+Qwen, all three): count and share wrong. The number TS-0 and TS-2 filter on.

**M3 Reader wrong share (yardstick).** Per reader, the share of its confirmations that are wrong: on every box it
read, and like for like on the Qwen-read crops. Tests the fluent-VLM caveat directly.

**M4 Reference set (`pilot-000`).** Size, per photo, and composition by agreeing set.

**M5 Third-reader dissent (both sets).** For each two-reader label, the reader outside the agreement, if it read the
crop: **dissents** (confirms another work), **contradicts** (its top candidate is another work, below the bar),
**supports** (its top candidate is the label's work, below the bar), or **read nothing**; or **not read** (Qwen on a
crop it was not sent). Dissent share is over labels whose third reader read the crop. If the dissenter is right, the
pair agreed on the same wrong work, so on `pilot-000` dissent is the label-free proxy for M1's same-wrong measure. On
the yardstick each outcome also gets its labels' wrong share, which says how much a `pilot-000` dissent means.

**M6 Title rarity of the label.** Each accepted label's work is **shared** if more than one catalog work holds its
own main title form (the `T:` form in `title_norm`, counted in the set's C-7 statistics sidecar `title_totals`), or
its title is one token; otherwise **distinctive**. M2's wrong share (yardstick) and M5's dissent share (`pilot-000`)
are split by agreeing set × rarity. A cheap label-free proxy for C-6 and C-7's namesake risk.

**Intervals.** 95 % percentile intervals from a photo-cluster bootstrap (photos drawn with replacement, the statistic
recomputed on the pooled boxes; 2,000 draws, seed 1; Q-1's `clusterBootstrap`). Each yardstick image is its own
cluster (40 images, 40 distinct source photos). A statistic undefined in a draw (an empty denominator) is skipped in
that draw; the number of usable draws is kept in `metrics.json`.

**Strata (Q-3's, where cheap).** M1, M2 and M5 are also split by:

- **elevation**: Q-3's per-book `elevation` (above / level / below eye level, or unknown);
- **dark or low contrast**: the box's mean luma or RMS contrast (Q-2b's features on `pilot-000`, Q-1's on the
  yardstick) below Q-3's published dark bar for that set (luma 57.4 / contrast 39.7 on `pilot-000`, 61.8 / 27.2 on
  the yardstick: the 5th percentile of each set's confirmed boxes);
- **side case**: Q-3's `case` (main / side).

A stratum cell with fewer than 30 boxes in its denominator is reported as counts only, with no interval or ratio.

### Recommendation rule (fixed now, applied to the results)

For each agreeing set, on the yardstick (M2) and, where measurable, `pilot-000` (M5):

- **Strong**: M2 wrong share's upper bound ≤ 10 %, M1's E lift for that pair has a lower bound ≤ 1 (no evidence of
  overlapping wrong confirmations), and, where the third reader can be read, `pilot-000` dissent's upper bound ≤ 10 %.
- **Weak**: not strong, and M2's point wrong share ≤ 20 %.
- **Exclude**: M2's point wrong share > 20 %.
- When two sets' intervals overlap, they are reported as **not separable at this sample size**, and the one with the
  higher point estimate takes the more conservative tier.
- **Qwen plus one OCR** gets an "extra support" recommendation (a distinctive title per M6, or a context anchor in the
  sense of F-0h) if it is not strong, or if its wrong labels (yardstick) or dissents (`pilot-000`) sit mostly (more than
  half) in **shared** titles.

The rule recommends only. TS-0 and TS-2 decide what to implement; nothing here changes F-0.

### Private outputs (the data root's `private/ts1/<set>/`, never in the repository)

`boxes.jsonl`: one record per kept box with each reader's read, confirmed and top flags, the agreeing set, the strata,
the rarity class and (yardstick) right/wrong per reader. Only aggregates reach `evals/TS1/`.
