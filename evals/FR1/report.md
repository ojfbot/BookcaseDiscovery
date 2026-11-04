# FR1: how often detected books overlap (F-R1, measurement)

Run 2026-11-03, research card F-R1 ([`docs/models/instance-boundaries.md`](../../docs/models/instance-boundaries.md)).
**Question.** The owner saw detected and segmented books overlap each other, which is physically impossible. How
often does it happen on the current default, where, and how much of it is real?

**The nuance.** In a 2D photo two *oriented boxes* may overlap legitimately: a leaning book's rectangle covers the
corner of its upright neighbour, and perspective skews a row. *Visible pixels* may not: each belongs to one book.
So the invariant is a non-overlapping partition of visible pixels, and box overlap is reported only to tell the two
apart.

**What was measured.** CPU only, cached data only: no model ran, no GPU (S-1 holds it). Two sets, never merged
(OC35):
- **`pilot-000`** (31 real-use photos): F-0e's `bands+strips` boxes after the shipped not-a-book filter (6,121
  boxes), with Q-2b's cached SAM 2.1 outline for every box.
- **Yardstick** (PROXY, 40 library photos): F-0's B2 boxes, the default for shelf-scale photos, after the same
  filter (1,116 boxes), with F-0b's cached SAM 2.1 outline for every box.
- **Depth:** H-2's cached MoGe-2 point maps and normals, for all 71 photos.

Rungs are Q-2b's teacher rungs: **machine agreement, never accuracy** (INV-17). Every interval is a 95 % photo
bootstrap (1,000 draws, seed 1). Aggregates only. The per-pair, per-box and per-photo tables are in the data root's
`private/fr1/`. The code is [`helpers/coverage/overlap.py`](../../helpers/coverage/overlap.py).

**Which masks these are.** Detection's own masks (the ones each box's rectangle is fitted to) are not cached. The
outlines are a second SAM 2.1 base-plus pass, prompted with each box's axis-aligned extent in a window of the box
plus 15 % (`helpers/label/outline.py`). That is the mask set every downstream stage uses today (U-4's study, H-2's
faces). SAM's processor squashes that tall, thin window to 1,024 × 1,024 (verified in transformers'
`Sam2ImageProcessor` and `Sam2Processor`). A median spine is therefore about 90 mask pixels across, about four
times finer than at detection's 1,600 px tiles. So these conflicts are **not mainly a resolution problem** (see
finding 4).

## Verdict

- **The invariant is broken on both sets, at the same rate.** **9.3 %** of the pixels that some mask claims are
  claimed by two or more masks: `pilot-000` 9.3 % (7.8–10.9), yardstick 9.3 % (7.3–11.3). The target is 0.
  - **Per box:** 31 % of boxes on each set have at least 5 % of their mask claimed by another box too.
  - **Per pair:** 15 % of neighbouring pairs conflict, 30.6 conflicting pairs per 100 boxes on `pilot-000` and 26.7
    on the yardstick.
- **Most box overlap is legitimate; most pixel overlap is not a boundary problem.**
  - **Box overlap is common, and three quarters of it is legitimate.** 54 % of neighbouring pairs' oriented boxes
    overlap on `pilot-000` (68 % on the yardstick). Only 26 % (23–29) of those pairs (21 % on the yardstick) also
    share mask pixels. Of the pixels where two boxes overlap, 61 % are claimed by exactly one mask, 28 % by both
    and 11 % by neither.
  - **Most contested pixels come from one book segmented twice, not from a disputed edge.** By pixels:

    | conflict type (by the smaller mask's share inside the other) | `pilot-000` pairs | `pilot-000` contested pixels | yardstick pairs | yardstick contested pixels |
    |---|---:|---:|---:|---:|
    | nested (≥ 80 % inside, IoU < 0.5) | 427 | **41 %** | 119 | **46 %** |
    | duplicate (IoU ≥ 0.5) | 144 | **22 %** | 36 | **30 %** |
    | partial (20–80 % inside) | 531 | 32 % | 65 | 21 % |
    | boundary bleed (under 20 % inside) | 769 | 5 % | 78 | 3 % |
    | all conflicts (≥ 1 % of the smaller mask) | 1,871 | 100 % | 298 | 100 % |

    So nesting and duplicates are **63 %** of contested pixels on `pilot-000` and **76 %** on the yardstick. These
    are an *instance* question (which detection is the book), settled by suppression, not by finer edges.
  - **Boundary bleed is frequent but thin:** 41 % of conflicting pairs on `pilot-000`, but 5 % of contested pixels.
  - **The middle class is the refinement target:** partial conflicts, where one mask takes 20–80 % of its
    neighbour, hold about a third of contested pixels. F-0b's renders showed many rectangles spanning two adjacent
    spines.
- **Leaning books conflict twice as often, which points at the prompt.**
  - **By lean:** pairs whose more tilted member leans under 5° conflict 9.3 % (8.0–10.9) of the time. At 5–15°
    it is 17.6 %, and at 15° or more 19.3 % (16.7–22.4). The yardstick shows the same pattern (9.9 %, 20.4 %,
    18.6 %).
  - **Why (hypothesis, consistent with this):** the outline prompt is the box's axis-aligned extent, and for a
    leaning spine that rectangle covers its neighbours.
  - **Clipping alone does little:** cutting each mask to its own oriented box (grown as U-4 draws it) only lowers the
    rate from 9.3 % to 7.0 % (6.0–8.2) on `pilot-000`, and from 9.3 % to 8.0 % on the yardstick. Most contested
    pixels lie inside both boxes.
- **Below eye level conflicts more often.** Of box-overlapping pairs, 30 % (26–34) conflict below eye level,
  against 22 % at eye level and 17 % (15–20) above it (H-2's view elevation). By frame thirds it is 30 % at the
  bottom against 18 % at the top. That fits H-1 and H-2: low-row boxes take in top faces, so masks there spill onto
  neighbours' tops.
- **Readers see neighbours.**
  - **How often:** 40 % (37–43) of `pilot-000` reader crops (`rect;rot=fixed;clip=frame`) hold at least 10 % of
    another mask's pixels. The yardstick figure is 36 % (30–42).
  - **How much:** the median crop's share is 6 %, the 90th percentile 33 %.
  - **Effect on outcomes, correlational and not causal:** crops that take in a neighbour reach `confirmed` 8.0 %
    (5.3–10.6) of the time, against 14.6 % (9.2–19.6) for the others. On the yardstick it is 17 % against 28 %.
    The intervals overlap, and wider or harder boxes may simply be both.
- **Depth is a weak cue between neighbours.** In conflicting pairs, the two masks' exclusive parts differ in median
  depth by 2.3 % at the median, and by 3 % or more in only 41 % (33–47) of pairs. Where they do differ, the
  contested pixels sit nearer the nearer book's depth in only 57 % (51–62) of pairs. Normals differ by 14° at the
  median. So depth can decide protruding, recessed and back-row books, but not flush neighbours. The image edge has
  to settle those.

## Findings

1. **Nested boxes are almost all real conflicts.** Of neighbouring pairs whose oriented boxes nest (≥ 80 % of the
   smaller inside the larger), 85 % (81–89) on `pilot-000` and 69 % (61–77) on the yardstick also nest or overlap as
   masks, against 12 % and 9 % for other pairs.
   - **Why they survive:** NMS lets nested boxes through by design. Its `inside` share is 1.01, so only boxes cut by
     a tile edge yield to a box holding them.
   - **How common:** 6.5 nested pairs per 100 boxes on `pilot-000` and 17.6 on the yardstick.
   - **The masks agree:** in nested mask pairs, the larger mask is 2.8 times the smaller at the median, so a whole
     spine holds a piece of itself (F-0e's "inside a larger box", a label block).
2. **NMS caps box IoU, not box containment.**
   - **IoU stops at the cap:** box IoU never passes NMS's 0.45 (one pair on `pilot-000`).
   - **Containment does not:** box intersection over the smaller box passes 0.5 in 15 % of overlapping pairs on
     `pilot-000` (1,050 of 6,868) and 24 % on the yardstick.
3. **Conflicts are side by side.** Side-by-side pairs conflict 18 % of the time, end-to-end pairs (stacked in one
   column) 1.2 %. The overlap is across spines, not along them.
4. **Masks are already fine; their prompts are not.** Finding 2 of the verdict, together with the outline window
   arithmetic above:
   - **Resolution:** a median spine is about 90 mask pixels across.
   - **Prompt geometry:** conflict tracks lean (the axis-aligned prompt) and nesting (duplicate detections).
   - **The design consequence** ([instance-boundaries.md §5](../../docs/models/instance-boundaries.md)): conflict
     tiles should be re-prompted with oriented boxes and negative points on the neighbours, and resolved jointly.
     Higher resolution is part of it, but not the lever.
5. **Fragments are no worse.** By fragment, piece/piece pairs conflict 16.8 %, piece/whole 11.7 %, whole/whole
   14.7 %, with overlapping intervals.

## Measures

- **Neighbouring pair:** two kept boxes whose oriented rectangles touch when each is grown by a quarter of the
  photo's median spine width, or that overlap.
- **Box overlap:** the oriented rectangles intersect (`cv2.rotatedRectangleIntersection`, as `detect.py`).
- **Mask conflict:** the outlines share at least 1 % of the smaller one's pixels (rasterised at full working-copy
  resolution).
- **Pixel overlap rate:** pixels claimed by two or more outlines ÷ pixels claimed by at least one, pooled per photo.
- **Neighbour in crop:** pixels of a box's oriented rectangle that another outline claims and its own does not.
- **Depth-separated:** the two exclusive parts' median depths differ by at least 3 % of the nearer one.

Thresholds are constants at the top of `overlap.py`. They were set before the first full run and not changed after.

## Limits

- **No box or mask ground truth.** A conflict is two masks disagreeing; which one is right is not known here. The
  rate is the invariant violation, a defect count by definition, not an accuracy figure.
- **These are the outline pass's masks, not detection's.** The rectangles readers crop come from detection's own
  masks, which are not cached; the box figures use those rectangles, the mask figures use the outlines.
- **The readers' rung split by neighbour share is correlational.** Only a re-read after resolving (F-0i) can say
  whether excluding neighbours helps.

## To regenerate

1. Run `uv sync` in `helpers/coverage`.
2. For each set, run `python -I helpers/coverage/overlap.py` with its `--detect`, `--outlines`, `--table` (Q-2b's
   table, which holds the kept box ids), `--faces` and `--images` (H-2's) and `--set`.
3. Put the two outputs under `sets` in `metrics.json`.

<!-- tables -->
### Overlap figures by set

| figure | `pilot-000` | yardstick (PROXY) |
|---|---:|---:|
| photos / kept boxes / boxes with an outline | 31 / 6,121 / 6,121 | 40 / 1,116 / 1,116 |
| neighbouring pairs | 12,680 | 2,062 |
| **pixel overlap rate (target 0)** | **9.3 % (7.8–10.9)** | **9.3 % (7.3–11.3)** |
| pixel overlap rate, masks clipped to their own box | 7.0 % (6.0–8.2) | 8.0 % (6.4–9.7) |
| neighbouring pairs whose boxes overlap | 54.2 % (51.2–57.3) | 68.1 % (66.3–70.4) |
| neighbouring pairs whose masks conflict | 14.8 % (13.2–16.7) | 14.5 % (12.0–16.6) |
| box-overlapping pairs whose masks conflict | 26.1 % (23.3–29.2) | 20.9 % (17.3–24.2) |
| conflicting pairs whose boxes do not overlap | 4.2 % (2.6–5.7) | 1.7 % (0.3–3.7) |
| box-overlap pixels: one mask / both / none | 61 % / 28 % / 11 % | 59 % / 30 % / 12 % |
| conflicting pairs per 100 boxes | 30.6 | 26.7 |
| nested box pairs per 100 boxes | 6.5 | 17.6 |
| boxes with ≥ 5 % of their mask also claimed by another | 30.6 % (26.6–35.0) | 30.8 % (25.6–35.7) |
| reader crops with ≥ 10 % neighbour pixels | 40.3 % (37.5–42.9) | 35.8 % (29.9–41.7) |
| neighbour share of a crop, p50 / p90 | 6.2 % / 32.8 % | 4.5 % / 36.2 % |
| `confirmed`, crops with / without ≥ 10 % neighbour | 8.0 % (5.3–10.6) / 14.6 % (9.2–19.6) | 17.3 % (11.1–24.5) / 27.9 % (20.6–35.4) |
| conflicting pairs depth-separated (≥ 3 %) | 40.5 % (32.9–47.2) | 35.2 % (29.4–41.7) |
| ... of those, contested pixels nearer the nearer book | 56.7 % (51.4–62.0) | 63.4 % (51.0–72.9) |
| depth gap / normal gap in conflicting pairs, p50 | 2.3 % / 13.9° | 1.9 % / 18.7° |

### Box overlap by IoU and by intersection over the smaller (overlapping neighbouring pairs)

| | (0, 0.05] | (0.05, 0.2] | (0.2, 0.45] or (0.2, 0.5] | (0.45, 1] or (0.5, 0.8] | (0.8, 1] |
|---|---:|---:|---:|---:|---:|
| `pilot-000` box IoU | 3,434 | 2,136 | 1,297 | 1 | — |
| `pilot-000` box IoS | 2,270 | 1,805 | 1,715 | 678 | 372 |
| yardstick box IoU | 731 | 383 | 290 | 0 | — |
| yardstick box IoS | 477 | 306 | 262 | 163 | 180 |

IoU bins are (0, 0.05], (0.05, 0.2], (0.2, 0.45], (0.45, 1]; IoS bins (0, 0.05], (0.05, 0.2], (0.2, 0.5], (0.5,
0.8], (0.8, 1].

### Mask conflict by stratum: `pilot-000` (share of neighbouring pairs; given box overlap in brackets)

| stratum | value | mask conflict | (given box overlap) |
|---|---|---:|---:|
| view elevation (H-2) | below eye level | 15.2 % (13.2–17.4) | 29.8 % (26.0–33.5) |
| | level | 15.3 % (13.2–17.5) | 22.0 % (19.0–25.3) |
| | above eye level | 12.1 % (10.3–14.1) | 17.3 % (14.9–20.2) |
| frame third | bottom | 15.6 % (13.5–17.8) | 30.4 % (26.9–34.2) |
| | middle | 14.5 % (12.7–16.5) | 25.0 % (20.5–29.8) |
| | top | 12.5 % (10.8–14.7) | 17.9 % (15.3–20.6) |
| larger tilt of the pair | under 5° | 9.3 % (8.0–10.9) | 16.0 % (13.8–18.6) |
| | 5–15° | 17.6 % (15.4–20.2) | 32.2 % (28.6–35.8) |
| | 15° or more | 19.3 % (16.7–22.4) | 35.0 % (30.0–40.5) |
| lean difference | under 3° | 15.1 % (13.0–17.7) | 23.7 % (20.5–27.7) |
| | 3–10° | 15.7 % (13.5–18.2) | 33.7 % (30.0–38.0) |
| | 10° or more | 12.2 % (10.2–14.7) | 25.0 % (21.2–29.0) |
| kind | whole / whole | 14.7 % (13.0–17.1) | 23.9 % (21.8–26.4) |
| | piece / whole | 11.7 % (9.0–14.6) | 27.1 % (22.9–31.0) |
| | piece / piece | 16.8 % (13.3–20.0) | 30.3 % (23.1–36.3) |
| orientation | upright / upright | 15.0 % (13.2–17.0) | 26.7 % (23.6–30.2) |
| | upright / lying | 3.8 % (1.0–7.9) | 6.9 % (2.4–14.1) |
| arrangement | side by side | 18.1 % (16.0–20.4) | 27.5 % (24.3–31.0) |
| | end to end | 1.2 % (0.5–2.3) | 6.4 % (2.8–11.0) |
| boxes nested | yes | 85.0 % (81.1–89.0) | |
| | no | 12.5 % (10.8–14.3) | |

The yardstick strata, which follow the same pattern with wider intervals, are in [`metrics.json`](metrics.json).
<!-- /tables -->
