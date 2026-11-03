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

<!-- findings -->

<!-- tables --><!-- /tables -->
