# F0c: cover-out arm (F-0c)

Run 2026-11-03, card F-0c. **Question:** can face-out books (shown cover-forward, which F-0's prompt and aspect filter
drop) be detected, read from their cover text and identified through F-0's catalog bar, and can non-book boxes be
flagged at detection, without hurting spine outcomes? Two sets, never merged (OC35): **`pilot-000`** (31 real-use
photos; every reader figure is **machine agreement, never accuracy**, INV-17) and the **yardstick (PROXY, library
shelves)**, the 40-image Library Dataset sample, used to evaluate only. No hand labels (OC36), no paid calls, nothing
trained or tuned on the yardstick. **Text only** (owner ruling, 2026-11-03): covers are identified from the words
printed on them; there is no cover-image matching, no cover download and no image embedding against a catalog.
Aggregates only; photos, crops, reads and titles stay under the data root.

## Pre-registration (written before the cover reads)

Fixed before any cover was read or decided; the thresholds are the constants `COVER` and `NOT_A_BOOK` in
`src/eval/f0c.ts`.

**Arm.** The base is each set's shipped default with its cached boxes, readings and decisions: on `pilot-000`
F-0e's `bands+strips` boxes read with the shipped crop (`rect;rot=fixed;clip=frame`); on the yardstick F-0's own B2
run (its 3100/1300 grid is still the default). The cover pass adds boxes and the kinds remove some; no spine box is
re-read or re-decided, so a spine's own outcome cannot change and every change in a measure comes from boxes added or
removed.

1. **Cover pass** (`detect.py` post step `covers`): Grounding DINO base with the prompt `book cover.` on the
   shelf-scale grid (3100 px tiles, 1300 px overlap) of every photo, SAM 2.1 masks, minimum-area rectangles, boxes
   over 35 % of a tile dropped, cover-shaped boxes only (long side under twice the short), duplicates removed as for
   spines. The spine path runs first and is not touched: with only this step, `--from` copies the cached spines,
   bands and gaps verbatim.
2. **Kinds** (`kinds` in `f0c.ts`, every box one `Spine.kind`):
   - a cover-pass box is **`face-out`** when its short side over long side is 0.5–0.9 (a portrait cover is 0.6–0.8,
     widened for perspective and mask slack), its short side is at least 1.5 median spine widths, its long side at
     most twice the photo's spine height (p90 of upright boxes), and spine-path boxes cover under half of it (more is
     a group of spines shelved side by side); otherwise it is dropped;
   - a spine-path box with at least 60 % of its area inside a kept cover is part of that book: the cover stands for
     it (**absorbed**, one book one box);
   - a spine-path box is **`not-a-book`** when it lies flat (more than 60° from vertical) and is longer than 1.5 of
     its band's spine heights (a shelf lip or a row of book ends), or lies flat and is shorter than 0.35 of them and
     thinner than 0.6 median widths (a strip), or holds at least 30 % of each of two or more kept covers (a row of
     face-out books); every other spine-path box is **`spine`**.
3. **Cover reading.** Crop `rect;rot=cover;clip=frame`: the mask rectangle's whole face, clipped to the frame as F-0b
   ships, read as it stands (portrait at 0°; a landscape crop, a book lying on its side, at 90° and 270°), never at
   the spine rotations. Every kept cover goes to all three readers: Vision and PP-OCR as for spines, and Qwen3-VL with
   a cover prompt that asks for the title, the author and the imprint as printed, warns that the lettering is large
   and stylised, and allows `none` and `unreadable`. The catalog sees Qwen's title and author, never the imprint.
   OCR readings go to the catalog whole, as spine readings do.
4. **Identify** with F-0's `decide` and catalog bar unchanged (two readers, one work, score ≥ 0.72, title evidence
   ≥ 0.8, coverage ≥ 0.5), on each set's default catalog (`catalog.sqlite` for `pilot-000`, the closed inventory for
   the yardstick).

**Measures, per set.** Face-out boxes kept per photo; covers at `text-read` and confirmed (pooled, photo-cluster
bootstrap); **new works per photo**: works confirmed from a cover that no spine box of the default confirmed in the
same photo; per arm against the base, paired photo bootstrap of distinct confirmed works per photo, confirmed and
`text-read` shares, works lost; on the yardstick, paired image bootstrap of title recall and precision, confirmed
(annotated) works and wrong accepts per image; not-a-book flags by rule, on the default boxes and on F-0's original
boxes (where F-0b counted its lying boxes), with removed boxes that were confirmed (a lower bound on real books removed)
and at `text-read` (an upper hint); seconds per photo for the cover pass and per cover for each reader. Intervals are
95 %, 2,000 resamples, seed 1.

**Arms.** *filter* (not-a-book boxes removed, cover pass off), *covers* (covers added, absorbed boxes removed),
*full* (both).

**Keep rules.**

- **Cover pass** ships by default only if, on `pilot-000`, the *covers* arm's change in distinct confirmed works
  per photo has an interval excluding 0 upward, **and** on the yardstick neither confirmed works per image nor title
  precision falls beyond its interval (interval wholly below 0), nor do wrong accepts per image rise beyond theirs
  (interval wholly above 0).
- **Not-a-book filter** ships by default only if the *filter* arm's change in distinct confirmed works per photo on
  `pilot-000` is not wholly below 0 and the yardstick passes the same test. Its gain is cleaner boxes and fewer reads,
  not more books, so it is held to no-harm, not to a lift.

**Looked at before fixing the rules** (disclosed): the cover pass's raw boxes on three `pilot-000` photos and the
remaining flat boxes on three others, as overlays, with no reader output. They showed that the cover prompt fires
mostly on groups of spines (hence the group rule), that a face-out display across the aisle shows covers under two
spine widths (hence 1.5, not 2.5), and that the flat boxes left after F-0e's `strips` are mostly shelf lips, rows of
distant face-out covers and shelf labels (hence the cover-row rule). Shelf labels are not caught by any rule.

## Verdict

- **Cover pass: off by default** (the pre-registered rule is not met). On `pilot-000` it keeps **4.6 face-out boxes
  a photo** (3.5 to 5.8; 142 in 28 of 31 photos). 28.9 % of them reach `text-read` (20.4–38.4) and **3.5 % are
  confirmed** (5 covers, 1.3–6.2). All 5 are **new works**, confirmed by no spine box of the default nor by F-0's
  original run: **+0.16 a photo (0.03 to 0.29)**. But the covers absorb 104 spine-path boxes, and 2 of those were
  confirmed spines, so the *covers* arm's change in distinct confirmed works per photo is **+0.10 (−0.03 to 0.23)**.
  The rule asked for that interval to exclude 0, so the step stays available (`F0_POST=covers`, `f0c-cli.ts`) but
  off. The yardstick is unhurt: one cover confirmed, annotated in its image and found by no spine box, no wrong
  accept, recall +0.1 points (0.0 to 0.5), precision +0.0 (0.0 to 0.1). It has few covers (0.5 a photo), so it can
  say little about cover wrong accepts.
- **Why covers stay unknown: the OCR readers, not the catalog bar's design.** Of 142 pilot covers, 98 are
  `no-catalog-match` and 34 `single-reader`. Qwen with the cover prompt reads text on 129 and its top candidate passes
  the bar on 35; Vision passes on 9, PP-OCR on 6. *Post hoc* (not pre-registered): on 28 of Qwen's 35 passing covers
  neither OCR reader passes, and on 19 of the 35 an OCR reader's top three hold Qwen's work below the bar. OCR text
  on a cover is short (median 5 tokens) rather than diluted by blurbs, so the large, stylised lettering is what defeats
  Vision and PP-OCR. Two-reader agreement stops these covers, as it should for a single generative reader.
- **Not-a-book filter: ships by default** (no harm, by its rule). After F-0e's `strips`, the default's boxes hold few
  non-book boxes the geometry rules can see: it flags **7 of 6,145** `pilot-000` boxes and **12 of 1,132** yardstick
  boxes. None was confirmed and none reached `text-read`, so it removed no known book. On F-0's original boxes, the
  ones F-0b inspected, the rules with covers remove **104 of its 407 lying boxes** (64 absorbed into face-out covers, 32
  spanning several books, 6 flat strips, 2 rows of covers). Across all 198 flagged boxes there, 5 were confirmed
  (lower bound on real books removed, mostly absorbed slivers) and 27 reached `text-read`. Distant face-out
  displays, gaps and shelf labels are not caught by geometry. The filter's gain is labels and fewer reads, not books.
- **Spine path unchanged.** With only the cover step, `--from` returned the cached spines, bands and gaps
  identical (JSON-equal) on all 31 + 40 photos. A fresh run on two yardstick images gave identical spines with the step on and
  off, and identical to F-0's cache. No spine box was re-read.
- **Cost.** The cover pass takes 18 s a photo on `pilot-000` (12 shelf-scale tiles; the default's detection is 69 s)
  and 5 s on the yardstick. Reading a cover takes 4.1 s at the median with all three readers (PP-OCR 2.1 s, Qwen 1.8 s, Vision
  0.1 s), 5.9 s on average: about 27 s a pilot photo for its 4.6 covers. Detection seconds were taken with other sessions on the
  machine.

## What to try next

1. **A cover reader the bar can count twice.** Pre-register a second reading of the same cover that is not Qwen:
   PP-OCR's largest lines only (title lettering is the largest), or Vision on an upscaled crop. Then re-run this arm
   unchanged. The 19 covers where OCR already holds Qwen's work in its top three are the target. Judge on a fresh
   real-use set, not on these 142.
2. **Tighten absorb before shipping covers.** Two confirmed spines were absorbed. A spine box that is confirmed and
   upright at full shelf height is likely a neighbour, not a sliver. That rule must be fixed before looking again.
3. **Shelf labels and distant displays** need pixels (mask texture, or a cheap text-density probe), which detections
   do not keep.


<!-- tables -->
### `pilot-000` (real use; machine agreement, never accuracy, INV-17)

31 photos, 6145 spine-path boxes (the default's cached boxes and readings).

| cover pass | value |
|---|---:|
| cover-prompt boxes (cover-shaped, after NMS) | 798 |
| dropped: not cover-shaped or sized / a group of spines | 236 / 420 |
| **face-out boxes kept, per photo** | **4.58 (3.45 to 5.77)** (142 in 28 photos) |
| spine-path boxes absorbed into a cover (of them confirmed / at `text-read`) | 104 (2 / 12) |
| covers with text (`text-present`) | 97.9 % (95.9–100.0) |
| **covers at `text-read`** (a reader's top candidate passes the bar) | **28.9 % (20.4–38.4)** |
| **covers confirmed** (two readers, one work, the bar) | **3.5 % (1.3–6.2)** (5) |
| per reader: read / with text / top candidate passes | vision 142/91/9, ppocr 142/98/6, qwen 142/129/35 |
| covers left unknown, by reason | no-catalog-match 98, single-reader 34, readers-disagree 2, no-text 3 |
| covers with an imprint read by Qwen | 57 |
| confirmed works from covers, per photo | 0.16 (0.03 to 0.29) |
| **new works per photo** (confirmed from a cover, by no spine box of the default) | **0.16 (0.03 to 0.29)** (5 in 5 photos) |
| new works per photo, also missed by F-0's original run | 0.16 (0.03 to 0.29) |

Arms against the default, paired photo bootstrap (95 %). *filter*: not-a-book boxes removed (cover pass off); *covers*: covers added and the spine-path boxes they absorb removed; *full*: both.

| arm | boxes per photo | `text-read` share | confirmed share | confirmed boxes per photo | **distinct confirmed works per photo** | works lost per photo |
|---|---:|---:|---:|---:|---:|---:|
| filter | -0.23 (-0.52 to -0.03) | +0.0 pts (0.0 to 0.1) | +0.0 pts (0.0 to 0.0) | +0.00 (0.00 to 0.00) | **+0.00 (0.00 to 0.00)** | 0.00 (0.00 to 0.00) |
| covers | +1.23 (0.26 to 2.26) | +0.3 pts (0.1 to 0.6) | -0.0 pts (-0.1 to 0.1) | +0.10 (-0.03 to 0.23) | **+0.10 (-0.03 to 0.23)** | 0.06 (0.00 to 0.16) |
| full | +1.03 (0.03 to 2.06) | +0.3 pts (0.1 to 0.6) | -0.0 pts (-0.1 to 0.1) | +0.10 (-0.03 to 0.23) | **+0.10 (-0.03 to 0.23)** | 0.06 (0.00 to 0.16) |

Not-a-book flags (counts; *removed confirmed* is a lower bound on real books wrongly removed, *at `text-read`* an upper hint):

| boxes | boxes | removed | by rule | removed confirmed | removed at `text-read` | F-0b lying boxes | lying removed | lying removed by rule | lying confirmed |
|---|---:|---:|---|---:|---:|---:|---:|---|---:|
| default, cover pass off | 6145 | 7 | flat-strip 2, spans-books 5 | 0 | 0 | 102 | 7 | flat-strip 2, spans-books 5 | 0 |
| default, with covers | 6145 | 110 | absorbed 104, flat-strip 2, spans-books 2, cover-row 2 | 2 | 12 | 102 | 33 | absorbed 27, flat-strip 2, spans-books 2, cover-row 2 | 0 |
| F-0's original boxes, with covers | 6894 | 198 | absorbed 158, spans-books 32, flat-strip 6, cover-row 2 | 5 | 27 | 407 | 104 | absorbed 64, spans-books 32, flat-strip 6, cover-row 2 | 6 |

Runtime: cover pass p50 18.01 s a photo (mean 18.9 (16.7 to 21.3); 11.8065 tiles a photo), against the default's detection p50 69.23 s. Cover readers: vision 82 s / 142 crops (p50 0.1447 s); ppocr 437 s / 142 crops (p50 2.1385 s); qwen 320 s / 142 crops (p50 1.7755 s). The default's readers: vision 3089 s / 6145 crops (p50 0.2032 s); ppocr 11514 s / 6145 crops (p50 1.404 s); qwen 3588 s / 1230 crops (p50 2.737 s).

### Yardstick (PROXY, library shelves; evaluation only)

40 photos, 1132 spine-path boxes (the default's cached boxes and readings).

| cover pass | value |
|---|---:|
| cover-prompt boxes (cover-shaped, after NMS) | 182 |
| dropped: not cover-shaped or sized / a group of spines | 97 / 64 |
| **face-out boxes kept, per photo** | **0.53 (0.25 to 0.85)** (21 in 11 photos) |
| spine-path boxes absorbed into a cover (of them confirmed / at `text-read`) | 11 (0 / 1) |
| covers with text (`text-present`) | 100.0 % (100.0–100.0) |
| **covers at `text-read`** (a reader's top candidate passes the bar) | **14.3 % (3.9–26.3)** |
| **covers confirmed** (two readers, one work, the bar) | **4.8 % (0.0–12.5)** (1) |
| per reader: read / with text / top candidate passes | vision 21/6/2, ppocr 21/7/0, qwen 21/20/2 |
| covers left unknown, by reason | single-reader 2, no-catalog-match 18 |
| covers with an imprint read by Qwen | 16 |
| confirmed works from covers, per photo | 0.03 (0.00 to 0.07) |
| **new works per photo** (confirmed from a cover, by no spine box of the default) | **0.03 (0.00 to 0.07)** (1 in 1 photos) |
| new works per photo, also missed by F-0's original run | 0.03 (0.00 to 0.07) |

Arms against the default, paired photo bootstrap (95 %). *filter*: not-a-book boxes removed (cover pass off); *covers*: covers added and the spine-path boxes they absorb removed; *full*: both.

| arm | boxes per photo | `text-read` share | confirmed share | confirmed boxes per photo | **distinct confirmed works per photo** | works lost per photo |
|---|---:|---:|---:|---:|---:|---:|
| filter | -0.30 (-0.55 to -0.07) | +0.4 pts (0.1 to 0.8) | +0.3 pts (0.1 to 0.5) | +0.00 (0.00 to 0.00) | **+0.00 (0.00 to 0.00)** | 0.00 (0.00 to 0.00) |
| covers | +0.25 (0.05 to 0.50) | -0.2 pts (-0.5 to 0.2) | -0.1 pts (-0.3 to 0.1) | +0.03 (0.00 to 0.07) | **+0.03 (0.00 to 0.07)** | 0.00 (0.00 to 0.00) |
| full | -0.05 (-0.40 to 0.28) | +0.2 pts (-0.3 to 0.9) | +0.1 pts (-0.1 to 0.5) | +0.03 (0.00 to 0.07) | **+0.03 (0.00 to 0.07)** | 0.00 (0.00 to 0.00) |

Yardstick titles (image level, against the annotation): base 241 of 653 annotated works found, 260 accepted. Covers alone: 1 accepted, 1 annotated (1 not found by a spine box), 0 wrong.

| arm | hits / accepted | Δ title recall | Δ title precision | Δ confirmed works per image | Δ wrong accepts per image |
|---|---:|---:|---:|---:|---:|
| filter | 241 / 260 | +0.0 pts (0.0 to 0.0) | +0.0 pts (0.0 to 0.0) | +0.00 (0.00 to 0.00) | +0.00 (0.00 to 0.00) |
| covers | 242 / 261 | +0.1 pts (0.0 to 0.5) | +0.0 pts (0.0 to 0.1) | +0.03 (0.00 to 0.07) | +0.00 (0.00 to 0.00) |
| full | 242 / 261 | +0.1 pts (0.0 to 0.5) | +0.0 pts (0.0 to 0.1) | +0.03 (0.00 to 0.07) | +0.00 (0.00 to 0.00) |

Not-a-book flags (counts; *removed confirmed* is a lower bound on real books wrongly removed, *at `text-read`* an upper hint):

| boxes | boxes | removed | by rule | removed confirmed | removed at `text-read` | F-0b lying boxes | lying removed | lying removed by rule | lying confirmed |
|---|---:|---:|---|---:|---:|---:|---:|---|---:|
| default, cover pass off | 1132 | 12 | flat-strip 8, spans-books 4 | 0 | 0 | 66 | 12 | flat-strip 8, spans-books 4 | 3 |
| default, with covers | 1132 | 23 | flat-strip 8, spans-books 4, absorbed 11 | 0 | 1 | 66 | 18 | flat-strip 8, spans-books 4, absorbed 6 | 3 |
| F-0's original boxes, with covers | 1132 | 23 | flat-strip 8, spans-books 4, absorbed 11 | 0 | 1 | 66 | 18 | flat-strip 8, spans-books 4, absorbed 6 | 3 |

Runtime: cover pass p50 5.335 s a photo (mean 6.1 (5.1 to 7.2); 6.4 tiles a photo), against the default's detection p50 5.08 s. Cover readers: vision 4 s / 21 crops (p50 0.173 s); ppocr 95 s / 21 crops (p50 2.511 s); qwen 71 s / 21 crops (p50 2.846 s). The default's readers: vision 190 s / 1132 crops (p50 0.1712 s); ppocr 3401 s / 1132 crops (p50 2.5805 s); qwen 1285 s / 478 crops (p50 2.4665 s).

### Keep rules

| rule | pilot-000 | yardstick | ships |
|---|---|---|---|
| cover pass | new works per photo excludes 0 upward: no | not hurt: yes | **no** |
| not-a-book filter | works per photo not down: yes | not hurt: yes | **yes** |

<!-- /tables -->
