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

## Findings (run 2026-11-04, after the pre-registration above)

Every `pilot-000` figure is machine agreement, never accuracy (INV-17). The yardstick is a PROXY, never trained on
(OC35), and the two are never pooled. Intervals are 95 % photo-cluster bootstraps.

### Answer first

- **No, not as it stands.** On the yardstick, the readers' wrong confirmations are strongly correlated, and when two
  readers are both wrong they name **the same wrong work every time** (11 of 11 for Vision–PP-OCR, 10 of 10 for
  Vision–Qwen). Vision–PP-OCR: P(both wrong) 1.1 % against 0.03 % under independence, **lift 36.7 (21.2 to 74.9),
  phi 0.62 (0.37 to 0.82)**, Yule's Q 0.99. Of PP-OCR's 13 wrong confirmations, 11 are Vision's too.
- **The overlap comes from the catalog step the readers share, not from the OCR engines alone.** Two readers that both
  read a spine's printed words correctly reach the same catalog candidate, right or wrong, because one `retrieve` and one
  bar sit behind every reader. Agreement therefore protects against misreads, not against **namesakes and catalog
  gaps**. The title-rarity split (M6) is the largest effect in the audit: yardstick labels on a **shared** or one-word
  title are wrong **38.2 % (13.2–68.6)** of the time (13/34), labels on a **distinctive** title **3.9 % (1.1–7.4)**
  (9/232), whichever pair agreed (Vision+PP-OCR 3.4 %, Vision+Qwen 4.3 %).
- **The fluent-VLM caveat is not borne out on the yardstick.** Qwen's confirmations are wrong 11.0 % (5.7–17.9) of
  the time, Vision's on the same crops 12.8 % (3.6–25.3). Vision+Qwen labels look worse (12.5 %, 2.7–25.7, against
  Vision+PP-OCR's 6.6 %, 2.7–11.2), but the intervals overlap, and 6 of its 10 wrong labels are the annotated book under
  a second inventory record (exploratory check below): at book level Vision+Qwen is 5.0 % (1.2–9.5), Vision+PP-OCR
  6.6 %.
- **`pilot-000`'s reference set: 726 catalog-confirmed boxes (438–1,056), 23.4 a photo, 12.6 % of kept boxes.**
  544 (75 %) are Vision+PP-OCR, 144 Vision+Qwen, 38 PP-OCR+Qwen, and **none** have all three readers: the routing makes
  that impossible (Qwen is never sent a crop Vision and PP-OCR agree on).
- **Third-reader dissent on `pilot-000`.** The OCR reader outside a Qwen agreement confirms a *different* work on
  **9.0 % (4.4–14.3)** of Vision+Qwen labels and 10.5 % (2.5–20.0) of PP-OCR+Qwen labels. On the yardstick the same
  dissent is 0 of 80 and 0 of 19. So on ISFDB, an open catalog with many namesakes, either the pair or the dissenter is
  wrong on about one Qwen label in ten; which one, no label-free measure can say. Vision+PP-OCR labels have **no third
  reader** at all on either set.
- **Failures overlap too** (F: not confirming an annotated work): Vision–PP-OCR phi 0.68 (0.61 to 0.74), Vision–Qwen
  0.46, PP-OCR–Qwen 0.22. That is shared difficulty (a spine neither can read), the expected kind; it costs recall,
  not label quality.

### Recommendation for TS-0's and TS-2's label filter (recommend only; nothing implemented)

The pre-registered rule, applied (table at the end): **no agreeing set is `strong`.** Vision+PP-OCR is `weak` (its E
lift's lower bound is 21, far above 1, and its wrong share's upper bound 11.2 % is above 10 %); Vision+Qwen is `weak`
(wrong share up to 25.7 %); PP-OCR+Qwen is unmeasured (19 yardstick labels, under the 30-box minimum) and is treated as
weak; the three-reader set cannot occur. Vision+PP-OCR and Vision+Qwen are not separable at this sample size. Qwen plus
one OCR gets the **extra support** recommendation, as the rule requires for a set that is not strong.

Reading the pre-registered measures together, the filter that the numbers support is by **title rarity first,
agreeing pair second**. The rule tiers by pair only; this split is an interpretation of M6, which was pre-registered
as a measure but not as a tier.

| label (two readers agree and pass the bar) | yardstick wrong | `pilot-000` evidence | recommended use |
|---|---:|---|---|
| any pair, **distinctive** title, third reader not dissenting | 3.9 % (1.1–7.4) | 483 of 726 labels (11 of them dissented) | **strong**: train on it |
| Vision+PP-OCR, **shared** or one-word title | 6/22 | 184 labels, no third reader | **weak**: hold out, or require C-7's namesake test or an author read |
| Qwen + one OCR, **shared** or one-word title | 7/12 (record), 1/12 (book level) | 59 labels, 6 dissented | **weak**: require extra support (author evidence, or an F-0h context anchor) |
| any label whose third reader **confirms another work** | none on the yardstick | 17 labels (13 V+Q, 4 P+Q) | **exclude** until a dissent's meaning is measured |

- **Qwen + one OCR needs extra support only where every pair does**, on shared titles. On distinctive titles it is no
  worse than the OCR pair on the yardstick (4.3 % against 3.4 %). Its added risk on `pilot-000` is the 9–10 % dissent,
  which the "exclude on dissent" row already removes.
- **A second OCR engine is not a second opinion on the catalog.** Its value is coverage (it confirms what the other
  missed), not independence. A rarity or counter-evidence check (C-7) is the only stage that addresses the errors that
  actually survive agreement.
- Every yardstick wrong share here is optimistic for `pilot-000`: the yardstick's catalog is a closed inventory of
  15,229 books, and Vision and PP-OCR confirm different works on 8.4 % of the `pilot-000` boxes they both confirm, against 0 %
  on the yardstick.

### Exploratory, after the results (not pre-registered)

- **What the wrong labels are.** Of the yardstick's 22 wrong labels: 6 are **the annotated book under another inventory
  record** (the inventory holds some books twice: about 440 records share a title form and primary surname with another), all of them
  Vision+Qwen; 5 are namesakes (the title of an annotated book, another author); 11 relate to no annotated book.
  None share only an author. The book-level figures are in the generated section; the pre-registered (record-level)
  figures above stay primary, and the rule is applied to them.
- **At book level the overlap is larger, not smaller**: Vision–PP-OCR lift 55.0 (33.0 to 111.6), phi 0.76 (0.53 to
  0.91); Vision–Qwen lift 22.9 (10.8 to 43.5). Shared-title labels are 20.6 % (6.7–42.3) wrong, distinctive 3.9 %.

### Strata (Q-3's)

- **Elevation.** `pilot-000` dissent on Vision+Qwen labels is highest below eye level (15.0 %, 7.9–22.9) and lowest at
  eye level (4.3 %, 0–9.4). The intervals barely overlap: suggestive, not shown. On the yardstick, eye-level Vision+Qwen
  labels are 18.5 % (4.5–36.4) wrong at record level, most of them the duplicate records above.
- **Dark or low contrast.** Few labels (68 on `pilot-000`, 27 on the yardstick, 6 of them wrong): counts only.
- **Side case.** 70 `pilot-000` labels and 4 yardstick labels: counts only.

### Limits

- **Small yardstick.** 40 images give 266 labels and 22 wrong ones; every interval is wide. Running F-0 on more of the
  Library Dataset's 388 annotated images (a GPU job) is the way to tighten them.
- **Image-level truth.** A reader confirming a neighbour's book counts right, so wrong shares are lower bounds. The 11
  "unrelated" wrong labels may include books the annotation leaves out.
- **Conditional Qwen measures.** Every Qwen figure is over hard crops only, where Vision and PP-OCR did not co-confirm
  one work, capped per photo.
- **No `pilot-000` joint-error measure.** The reference set cannot show a pair both wrong (each pair holds a reader that
  set the reference), and the routing leaves no independent third reader for the OCR pair. Measuring Vision+PP-OCR
  dissent would take a Qwen read of a sample of agreed crops (a GPU job, and a routing change for F-0's owner).
- **Baseline.** The box set changes with F-0m, F-0k and NB-3; re-run `boxes` and `analyse` on each new box set.


<!-- generated by src/eval/ts1-cli.ts analyse: edit above this line -->

## pilot-000 (real use (OC35): machine agreement, never accuracy (INV-17))

31 photos, 5761 kept boxes. Read by: Vision 5761, PP-OCR 5761, Qwen 1209. Intervals are 95 % photo-cluster bootstraps (2000 draws); cells under 30 boxes are counts only.

### Reference set and labels (M4)

Catalog-confirmed (F-0 accepted) boxes: **726 (438–1056)**, 23.419 a photo, 12.6 % of kept boxes.

| agreeing readers | labels |
|---|---:|
| all | 726 |
| Vision+PP-OCR | 544 |
| Vision+Qwen | 144 |
| PP-OCR+Qwen | 38 |
| Vision+PP-OCR+Qwen | 0 |

**Also reported (not in a rule): co-confirmation.** Boxes both readers read; both confirm a work; those works differ (at least one reader is wrong).

| pair | read by both | both confirm | differ |
|---|---:|---:|---:|
| Vision+PP-OCR | 5761 | 594 | 50 |
| Vision+Qwen | 1209 | 169 | 25 |
| PP-OCR+Qwen | 1209 | 60 | 22 |

### Third-reader dissent (M5)

Per two-reader label, the reader outside the agreement. Dissent share is over labels whose third reader read the crop.

| agreeing | labels | dissents | contradicts | supports | read-nothing | not-read | dissent share |
|---|---:|---:|---:|---:|---:|---:|---:|
| Vision+PP-OCR | 544 | 0 | 0 | 0 | 0 | 544 | 0/0 |
| Vision+Qwen | 144 | 13 | 60 | 62 | 9 | 0 | 13/144, 9 % (4.4–14.3) |
| PP-OCR+Qwen | 38 | 4 | 12 | 12 | 10 | 0 | 4/38, 10.5 % (2.5–20) |

### Title rarity of the label (M6)

| agreeing | shared: labels, dissent | distinctive: labels, dissent |
|---|---:|---:|
| all | 243 | 483 |
| Vision+PP-OCR | 184, 0/0 | 360, 0/0 |
| Vision+Qwen | 43, 5/43, 11.6 % (2.4–23.8) | 101, 8/101, 7.9 % (3.5–13.6) |
| PP-OCR+Qwen | 16, 1/16 | 22, 3/22 |
| Vision+PP-OCR+Qwen | 0 | 0 |

### Strata

| stratum | value | boxes | labels | V+P | V+Q | P+Q | V+Q dissent | P+Q dissent |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| elevation | above | 1477 | 240 | 171 | 58 | 11 | 5/58, 8.6 % (1.9–18) | 1/11 |
| elevation | below | 3170 | 312 | 254 | 40 | 18 | 6/40, 15 % (7.9–22.9) | 2/18 |
| elevation | level | 1114 | 174 | 119 | 46 | 9 | 2/46, 4.3 % (0–9.4) | 1/9 |
| dark or low contrast | dark/low | 928 | 68 | 46 | 18 | 4 | 0/18 | 2/4 |
| dark or low contrast | not | 4833 | 658 | 498 | 126 | 34 | 13/126, 10.3 % (5.4–16.1) | 2/34, 5.9 % (0–12.8) |
| case | main | 4681 | 656 | 488 | 134 | 34 | 12/134, 9 % (4.5–13.9) | 4/34, 11.8 % (2.9–22.6) |
| case | side | 1080 | 70 | 56 | 10 | 4 | 1/10 | 0/4 |

## yardstick (PROXY (library shelves): Library Dataset sample, box arm B2; truth = the image's annotated inventory works)

40 photos, 1040 kept boxes. Read by: Vision 1040, PP-OCR 1040, Qwen 459. Intervals are 95 % photo-cluster bootstraps (2000 draws); cells under 30 boxes are counts only.

### Reference set and labels (M4, M2)

Catalog-confirmed (F-0 accepted) boxes: **266 (202–331)**, 6.65 a photo, 25.6 % of kept boxes.

| agreeing readers | labels wrong / labels, share wrong |
|---|---:|
| all | 22/266, 8.3 % (3.7–14.2) |
| Vision+PP-OCR | 11/167, 6.6 % (2.7–11.2) |
| Vision+Qwen | 10/80, 12.5 % (2.7–25.7) |
| PP-OCR+Qwen | 1/19 |
| Vision+PP-OCR+Qwen | 0/0 |

**Also reported (not in a rule): co-confirmation.** Boxes both readers read; both confirm a work; those works differ (at least one reader is wrong).

| pair | read by both | both confirm | differ |
|---|---:|---:|---:|
| Vision+PP-OCR | 1040 | 167 | 0 |
| Vision+Qwen | 459 | 81 | 1 |
| PP-OCR+Qwen | 459 | 19 | 0 |

### Pair error overlap (M1)

E = wrong confirmation (primary); F = fails to confirm an annotated work (secondary). Qwen pairs are over Qwen-read crops only, where Vision and PP-OCR did not co-confirm one work. † Haldane-corrected Yule's Q (a zero cell).

| pair (E) | boxes read by both | P(A wrong) | P(B wrong) | P(both) | P(A)·P(B) | lift | phi | Yule's Q | P(same wrong work) | same of joint | agreement wrong share |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Vision+PP-OCR | 1040 | 2.3 % (1.1–3.8) | 1.3 % (0.6–2) | 1.1 % (0.4–1.8) (11) | 0 % (0–0.1) | 36.7 (21.2 to 74.9) | 0.62 (0.37 to 0.82) | 0.99 (0.98 to 1.00) | 1.1 % (0.4–1.8) (11) | 100 % (100–100) | 6.6 % (2.7–11.2) (11/167) |
| Vision+Qwen | 459 | 2.4 % (0.6–5.1) | 5.2 % (2.7–8.4) | 2.2 % (0.4–4.8) (10) | 0.1 % (0–0.4) | 17.4 (10.6 to 31.7) | 0.60 (0.28 to 0.79) | 0.99 (0.95 to 1.00) | 2.2 % (0.4–4.8) (10) | 100 % (100–100) | 12.5 % (2.7–25.7) (10/80) |
| PP-OCR+Qwen | 459 | 0.4 % (0–1.1) | 5.2 % (2.7–8.4) | 0.2 % (0–0.7) (1) | 0 % (0–0.1) | 9.6 (0.0 to 26.1) | 0.13 (-0.02 to 0.35) | 0.90 (0.49 to 0.98) | 0.2 % (0–0.7) (1) | 100 % (100–100) | 5.3 % (0–16.7) (1/19) |

| pair (F) | boxes read by both | P(A wrong) | P(B wrong) | P(both) | P(A)·P(B) | lift | phi | Yule's Q | P(same wrong work) | same of joint | agreement wrong share |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Vision+PP-OCR | 1040 | 76.4 % (70.3–82.2) | 82.6 % (77.2–87.2) | 74 % (67.6–79.8) (770) | 63.1 % (54.6–71.5) | 1.2 (1.1 to 1.2) | 0.68 (0.61 to 0.74) | 0.96 (0.94 to 0.98) | 1.1 % (0.4–1.8) (11) | 1.4 % (0.6–2.4) | 6.6 % (2.7–11.2) (11/167) |
| Vision+Qwen | 459 | 83.7 % (79.2–87.8) | 57.7 % (50.6–65) | 56.6 % (49.5–63.8) (260) | 48.3 % (40.5–56.3) | 1.2 (1.1 to 1.2) | 0.46 (0.38 to 0.53) | 0.93 (0.85 to 0.99) | 2.2 % (0.4–4.8) (10) | 3.8 % (0.8–8.2) | 12.5 % (2.7–25.7) (10/80) |
| PP-OCR+Qwen | 459 | 95.9 % (93.5–97.7) | 57.7 % (50.6–65) | 57.5 % (50.4–64.8) (264) | 55.3 % (48.2–62.7) | 1.0 (1.0 to 1.1) | 0.22 (0.14 to 0.29) | 0.93 (0.74 to 0.97) | 0.2 % (0–0.7) (1) | 0.4 % (0–1.3) | 5.3 % (0–16.7) (1/19) |

### Reader wrong share (M3)

| reader | of its confirmations, wrong (all reads) | on Qwen-read crops |
|---|---:|---:|
| Vision | 24/269, 8.9 % (4.5–14.3) | 11/86, 12.8 % (3.6–25.3) |
| PP-OCR | 13/194, 6.7 % (3.2–10.8) | 2/21 |
| Qwen | 24/218, 11 % (5.7–17.9) | 24/218, 11 % (5.7–17.9) |

### Exploratory, after the results (not pre-registered): what the wrong labels are

The library's inventory holds some books under two records. A wrong label is **same book, other record** when its title form and primary surname match an annotated book in the image; **namesake** when only the title matches; **same author** when only the surname does.

| agreeing | same-book-other-record | namesake | same-author | unrelated |
|---|---:|---:|---:|---:|
| all | 6 | 5 | 0 | 11 |
| Vision+PP-OCR | 0 | 4 | 0 | 7 |
| Vision+Qwen | 6 | 1 | 0 | 3 |
| PP-OCR+Qwen | 0 | 0 | 0 | 1 |
| Vision+PP-OCR+Qwen | 0 | 0 | 0 | 0 |

At book level (every record of an annotated book counts right):

| agreeing readers | labels wrong / labels, share wrong | shared title | distinctive title |
|---|---:|---:|---:|
| all | 16/266, 6 % (2.7–9.8) | 7/34, 20.6 % (6.7–42.3) | 9/232, 3.9 % (1.1–7.4) |
| Vision+PP-OCR | 11/167, 6.6 % (2.7–11.2) | 6/22 | 5/145, 3.4 % (0–8) |
| Vision+Qwen | 4/80, 5 % (1.2–9.5) | 1/10 | 3/70, 4.3 % (0–8.5) |
| PP-OCR+Qwen | 1/19 | 0/2 | 1/17 |
| Vision+PP-OCR+Qwen | 0/0 | 0/0 | 0/0 |

| pair (E) | boxes read by both | P(A wrong) | P(B wrong) | P(both) | P(A)·P(B) | lift | phi | Yule's Q | P(same wrong work) | same of joint | agreement wrong share |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Vision+PP-OCR | 1040 | 1.5 % (0.7–2.5) | 1.3 % (0.6–2) | 1.1 % (0.4–1.8) (11) | 0 % (0–0.1) | 55.0 (33.0 to 111.6) | 0.76 (0.53 to 0.91) | 1.00 (0.99 to 1.00) | 1.1 % (0.4–1.8) (11) | 100 % (100–100) | 6.6 % (2.7–11.2) (11/167) |
| Vision+Qwen | 459 | 1.1 % (0.2–2.1) | 3.5 % (1.8–5.5) | 0.9 % (0.2–1.8) (4) | 0 % (0–0.1) | 22.9 (10.8 to 43.5) | 0.44 (0.16 to 0.65) | 0.99 (0.90 to 1.00) | 0.9 % (0.2–1.8) (4) | 100 % (100–100) | 5 % (1.2–9.5) (4/80) |
| PP-OCR+Qwen | 459 | 0.4 % (0–1.1) | 3.5 % (1.8–5.5) | 0.2 % (0–0.7) (1) | 0 % (0–0) | 14.3 (0.0 to 36.8) | 0.17 (-0.01 to 0.40) | 0.93 (0.66 to 0.99) | 0.2 % (0–0.7) (1) | 100 % (100–100) | 5.3 % (0–16.7) (1/19) |

| reader | of its confirmations, wrong (all reads) | on Qwen-read crops |
|---|---:|---:|
| Vision | 16/269, 5.9 % (2.8–9.5) | 5/86, 5.8 % (1.4–10.5) |
| PP-OCR | 13/194, 6.7 % (3.2–10.8) | 2/21 |
| Qwen | 16/218, 7.3 % (3.8–11.6) | 16/218, 7.3 % (3.8–11.6) |

### Third-reader dissent (M5)

Per two-reader label, the reader outside the agreement. Dissent share is over labels whose third reader read the crop. Wrong share of the labels with each outcome in brackets.

| agreeing | labels | dissents | contradicts | supports | read-nothing | not-read | dissent share |
|---|---:|---:|---:|---:|---:|---:|---:|
| Vision+PP-OCR | 167 | 0 | 0 | 0 | 0 | 167 [11 wrong] | 0/0 |
| Vision+Qwen | 80 | 0 | 10 [0 wrong] | 69 [10 wrong] | 1 [0 wrong] | 0 | 0/80, 0 % (0–0) |
| PP-OCR+Qwen | 19 | 0 | 0 | 8 [0 wrong] | 11 [1 wrong] | 0 | 0/19 |

### Title rarity of the label (M6)

| agreeing | shared title: wrong | distinctive title: wrong |
|---|---:|---:|
| all | 13/34, 38.2 % (13.2–68.6) | 9/232, 3.9 % (1.1–7.4) |
| Vision+PP-OCR | 6/22 | 5/145, 3.4 % (0–8) |
| Vision+Qwen | 7/10 | 3/70, 4.3 % (0–8.5) |
| PP-OCR+Qwen | 0/2 | 1/17 |
| Vision+PP-OCR+Qwen | 0/0 | 0/0 |

### Strata

| stratum | value | boxes | labels wrong (all) | V+P wrong | V+Q wrong | P+Q wrong | V–P E lift | V–Q E lift | P–Q E lift |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| elevation | above | 67 | 0/4 | 0/1 | 0/1 | 0/2 | n 67 | n 23 | n 23 |
| elevation | below | 382 | 6/105, 5.7 % (1.5–10) | 5/70, 7.1 % (1.6–11.8) | 0/25 | 1/10 | 39.0 (18.0 to 89.2) | n 161 | 16.1 (0.0 to 72.1) |
| elevation | level | 591 | 16/157, 10.2 % (3.7–19.6) | 6/96, 6.3 % (1.5–13.6) | 10/54, 18.5 % (4.5–36.4) | 0/7 | 34.8 (19.7 to 87.9) | 13.9 (8.6 to 26.4) | n 275 |
| dark or low contrast | dark/low | 136 | 6/27 | 2/13 | 3/10 | 1/4 | 18.1 (0.0 to 67.5) | 8.0 (3.7 to 29.0) | 8.0 (3.7 to 31.0) |
| dark or low contrast | not | 904 | 16/239, 6.7 % (2.9–11.4) | 9/154, 5.8 % (2.1–10.3) | 7/70, 10 % (2.1–20.7) | 0/15 | 42.8 (26.2 to 88.9) | 18.7 (10.8 to 33.2) | 0.0 (0.0 to 0.0) |
| case | main | 968 | 22/262, 8.4 % (3.7–14.3) | 11/166, 6.6 % (2.7–11.3) | 10/77, 13 % (2.9–26.6) | 1/19 | 37.0 (21.5 to 76.6) | 16.8 (10.3 to 30.4) | 18.5 (11.2 to 32.2) |
| case | side | 72 | 0/4 | 0/1 | 0/3 | 0/0 | n 72 | n 16 | n 16 |

## Recommendation rule, applied

| agreeing | yardstick labels wrong | E lift lower bound | pilot dissent upper bound | tier |
|---|---:|---:|---:|---|
| Vision+PP-OCR | 6.6 % (2.7–11.2) | 21.24 | n/a | **weak** |
| Vision+Qwen | 12.5 % (2.7–25.7) | 10.64 | 0.14 | **weak** |
| PP-OCR+Qwen | — | 0.00 | 0.20 | **unmeasured** |
| Vision+PP-OCR+Qwen | — | n/a | n/a | **unmeasured** |

Not separable at this sample size (overlapping intervals): Vision+PP-OCR vs Vision+Qwen.

| Qwen plus one OCR | tier | yardstick wrong: shared / distinctive | pilot dissent: shared / distinctive | extra support |
|---|---|---:|---:|---|
| Vision+Qwen | weak | 7 / 3 | 5 / 8 | yes |
| PP-OCR+Qwen | unmeasured | 0 / 1 | 1 / 3 | yes |
