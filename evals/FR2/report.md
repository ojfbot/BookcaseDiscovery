# FR2: where the readers lose a book (F-R2 measurement)

Research card F-R2, 2026-11-03. **Question:** before designing a per-book second pass (pass 2), where do today's
readers fail? Is it too few pixels, the size of the text, stylised type, text set across the spine, or low
contrast? This is label-free and uses cached data only: no new reader runs, no GPU, no downloads. Design and sources:
[`docs/models/per-book-extraction.md`](../../docs/models/per-book-extraction.md).

Two sets, never merged (OC35):
- **`pilot-000`**: 31 real-use photos with F-0e's default `bands+strips` boxes (6,145), the three readers F-0e
  cached on them, and F-0c's cached `base-decisions`. Every figure is **machine agreement, never accuracy** (INV-17).
- **Yardstick (PROXY)**: F-0's 40-image Library Dataset sample with B2 boxes (1,132) and F-0's cached readers and
  decisions. *Confirmed* means accepted and annotated in the image; *wrong* means accepted but not annotated.

No hand labels (OC36). Nothing was trained or tuned. Aggregates are in [`metrics.json`](metrics.json). Per-box rows
are under the data root's `private/fr2/`. Code: `scripts/fr2-measure.py`, `scripts/fr2-aggregate.py`,
`scripts/fr2-truth.ts`. Intervals are 95 % photo-cluster bootstraps of the pooled share (2,000 draws, seed 1).

## Method

1. **Box geometry, every box, no model.** Each polygon is clamped to the frame (approximating `clip=frame`) and
   measured as `read.py` cuts it:
   - the short side (across the spine, which bounds a line's height once the crop is turned 90°);
   - the long side;
   - the **effective short side**, after `read.py`'s 1,600 px cap on the long side. That cap applies to what PP-OCR
     and Qwen see; Vision reads at full resolution.
2. **Contrast, every box, no model.** Each crop is warped to a 64 px short side. The measure is the distance between
   the two Otsu class means of its grey levels (0–255), a lettering-against-ground proxy.
3. **Text lines, seeded sample, CPU.** No reader caches text boxes (`ocr-response` carries text and confidence
   only), so PP-OCRv5's server **detector alone** ran on the CPU over 700 `pilot-000` and 350 yardstick crops. The
   draw was seeded (20261103) from boxes with a short side of at least 6 px, each crop cut exactly as `read.py` cuts
   it at 90°. Two things are recorded per crop:
   - each line box's short side, its **line height** in the pixels the recogniser receives;
   - whether the line runs across the spine instead of along it (a **column**: stacked letters, or text set across
     a wide spine).

   The detector's boxes include DB's unclip margin, so a line height is an upper bound on glyph height
   (hypothesis: roughly 1.3–1.6× the cap height).
4. **Outcomes per box**, from the cached decisions:
   - any reader read text;
   - Vision and PP-OCR each read text;
   - each reader's top candidate passed F-0's bar;
   - accepted (on the yardstick, also confirmed or wrong).

   For the stylised-type proxy: on the hard crops Qwen read, how often Qwen passes the bar while neither OCR reader
   does.

## Findings

1. **Pass 1 does not starve the readers of pixels at the box level.**
   - On `pilot-000` the crop's short side is p10 76, median 140 and p90 270 px. Only **6.6 %** of crops hit the
     1,600 px cap, and those are shrunk to a median 0.87.
   - Boxes under 64 effective px are **4.8 %** (294). They do read worse: text 59–73 % against 79 %, confirmed
     4–5 % against 12.5 % at ≥ 96 px.
   - The unknown pools sit at the same sizes as the confirmed boxes (short-side medians below), and **no** box in
     any pool is under 24 effective px.
   - On the yardstick the spines are long (median 2,141 px), so **72 %** of crops are capped (median scale 0.69).
     The effective short side is still a median 206 px.

   | `pilot-000` pool | boxes | short side p50 (px) | contrast p50 | contrast < 45 | cut by a tile |
   |---|---:|---:|---:|---:|---:|
   | confirmed | 731 | 139 | 111.5 | 0.1 % | 2.3 % |
   | no-catalog-match | 3,121 | 144 | 110.0 | 0.4 % | 3.8 % |
   | no-text | 1,365 | 132 | 98.5 | 2.1 % | 7.4 % |
   | single-reader | 862 | 139 | 108.5 | 0.3 % | 2.6 % |
   | readers-disagree | 66 | 150 | 102.2 | 1.5 % | 6.1 % |

2. **When a text line is there, the readers almost always read something; the loss is between reading and
   confirming.**
   - On the `pilot-000` sample, crops with a detected line reach `text-read` at **98 %** in every height bin from
     24 px up.
   - Their confirmed share is low all the same, and rises with the tallest line. By the tallest line's height in
     recogniser pixels:

     | tallest line | crops | confirmed |
     |---|---:|---|
     | 16–24 px | 12 | 0 % |
     | 24–32 px | 30 | 6.7 % (0–17.2) |
     | 32–48 px | 133 | 12.8 % (6.5–18.7) |
     | ≥ 48 px | 326 | 17.5 % (10.9–24.4) |

   - The no-catalog-match pool (3,121, the largest) has the same size and contrast as the confirmed pool. So it is a
     **reading-correctness, field and catalog problem, not a pixel-count problem** (hypothesis on cause; the
     equality is measured).
3. **Titles are big enough. Secondary lines often are not.**
   - The tallest line in a crop is a median **59 px** (p10 33) on `pilot-000` and 65 px on the yardstick: above
     PP-OCR's 48 px recogniser height and its 32 px lower training height (thread (b)).
   - Across all 1,536 detected `pilot-000` lines, though:
     - **31.6 %** are under 32 px;
     - 14.4 % are under 24 px;
     - 2.2 % are under 16 px.
   - The second-tallest line, where an author or imprint usually sits, is under 32 px in **26.3 %** of crops with
     two or more lines (6.6 % on the yardstick). 26.7 % of `pilot-000` text crops have their smallest line under
     24 px.
   - Title and author lines are close in size (tallest over second, median **1.22**), so "the largest line is the
     title" is a weak rule. Thread (a) found a published counterexample: series titles set larger than titles.
   - Upscaling per line therefore targets the author and imprint fields, which C-7 needs most against namesakes.
4. **Stylised type: half of Qwen's catalog passes have no OCR partner.**
   - On the 1,230 `pilot-000` hard crops Qwen read, its top candidate passes the bar on 413. On **201 of them
     (48.7 %)** neither Vision nor PP-OCR passes.
   - On the yardstick: 228 passes, 127 (55.7 %) without an OCR partner.
   - Two-reader agreement (INV-6) holds these back, as it should. It is the spine-side twin of F-0c's cover finding.
   - A pass-2 reader that is **independent of Qwen** and reads stylised lettering is worth more than a bigger Qwen.
5. **28 % of crops hold no detectable text line, and pass 2 cannot fix those.**
   - The share is 28.4 % on `pilot-000` and 26.3 % on the yardstick. On those crops a reader read text 23.6 %
     (16.8–30.4) of the time on `pilot-000`, and none was confirmed.
   - They are textless spines, non-books, gaps, or text the detector misses. Fixing them is pass 1's job (F-0i's
     clean regions), not pass 2's.
6. **Low contrast hurts sharply but is rare on `pilot-000`.**
   - Contrast under 60 covers 218 `pilot-000` boxes (3.5 %): text 41–57 % against 81 % above 80, confirmed 2–3 %
     against 12.9 %.
   - On the yardstick, 17.6 % of the no-text pool has contrast under 45 (library spines with faded or metallic
     lettering; hypothesis).
7. **Column text is common but not where the losses are.**
   - 15.0 % (10.2–20.6) of `pilot-000` text crops have a line running across the spine (11.2 % on the yardstick).
   - Their outcomes match the rest: confirmed 13.3 % (5.1–25.0) against 15.5 % (9.9–21.0).
   - **Wide boxes** show the orientation cost in another way. At a short side of 192 px or more, Vision's
     `text-read` drops to 63.3 % and its pass rate to 14.6 % (against 69.3 % and 23.1 % at 96–128 px), while
     PP-OCR's `text-read` rises to 78.7 %. Hypothesis: Vision reads wide boxes only at the spine rotations
     (90°/270°), so text set across them comes out sideways, while PP-OCR's textline classifier turns its lines.
     Zoning by line orientation removes that dependence.
8. **Cost of the line detector:** 0.28 s a crop at the median on the CPU for `pilot-000` (0.34 s on the yardstick),
   on the capped crops.

## What this means for pass 2

- **Resolution is a per-line lever, not a per-box one.** Re-cut the crop at a higher resolution only where a line is
  small. Per-line upscaling to the recogniser's native height is the cheap version. The title rarely needs it; the
  author and imprint often do.
- **The largest gains are in reading correctness and evidence structure.** That means a second independent reader
  for stylised type, separate title and author fields for C-7, and imprint as a contrast (IMP-1). Pixels come
  second.
- **Pass 2 needs clean regions.** About a quarter of crops have no text to read, and cut boxes lose text (F-0b,
  H-2). The design is F-0j in the research doc.

## Limits

- Text height is the detector's box height, an upper bound on glyph height. The detector also misses some text, so
  the no-line share mixes "no text" with "missed text".
- The line sample is 700 + 350 crops, so the per-bin intervals are wide. The geometry and contrast measures cover
  every box.
- Sizing clamps the polygon to the frame rather than running `crop.ts`'s `clipToFrame`. Only the 10 % of
  `pilot-000` boxes partly out of frame can differ.
- The `pilot-000` population is the 6,145 boxes F-0c decided. That includes the 24 the shipped not-a-book filter
  later drops, none of them confirmed. The yardstick is F-0's 1,132 B2 boxes, also unfiltered.
- One bookstore, one library and one camera. `pilot-000` figures are machine agreement.
