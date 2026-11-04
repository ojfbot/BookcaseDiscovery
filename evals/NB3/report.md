# NB3: not-a-book v3 (NB-3)

## Pre-registration (committed before the first full run)

Fixed 2026-11-04, before any full-set run of the rule. Nothing below is changed after seeing a full result; any
change is logged as a deviation in `implementation-notes.md`, and the report says which figures it touches.

**Question.** On F-0i's partition (the current box set), do three label-free evidence sources, under one rule, catch
shelf, wood, store-background and sign boxes that F-0c's shapes and F-0f's text and whiteness rules miss, without
removing a book the readers confirm? The sources are H-2's depth stage (its face split), S-1's `on-lip` test, and
F-R3's card R3-C (per-box pixel values from the warped crop, `docs/models/image-representations.md` §8).

**Sets, never merged (OC35).**

- **`pilot-000`**: 31 real-use photos, F-0e's default `bands+strips` boxes after the shipped not-a-book filter (F-0c's
  shape rules, F-0f's shelf-label rules, cover pass off) and F-0i's partition of them: the 5,761 kept boxes. Readers
  and decisions are F-0c's cached base (`base-decisions`). Every figure is **machine agreement, never accuracy**
  (INV-17). It is a dev set (OC11).
- **Yardstick (PROXY)**: the 40-image Library Dataset sample with F-0's B2 boxes after the same filter and F-0i's
  partition: the 1,040 kept boxes. *Confirmed* = accepted; *confirmed and annotated* = accepted and annotated in the
  image. Evaluation only: never trained or tuned on; the pixel thresholds come from `pilot-000` alone.

No hand labels (OC36). Nothing is trained. Covers are out of scope: the cover pass is off by default and F-0i's
partition holds spine-path boxes only.

**Inputs, all cached, CPU only.**

- **Depth stage**: H-2's MoGe-2 cache (`moge-2-vitl-normal@cb0e8bb`), read through `helpers/depth/stage.py` with H-2's
  detections and options, so its keys decide reuse. The runner first lists the keys (`--keys`) and stops if any
  photo's geometry is not cached, so no GPU job can start. The face split per box is H-2's, on the detection
  rectangle (the partition keeps box ids and detection rectangles).
- **Lip features**: `helpers/shelf/shelf.py` on the partition, as S-2 runs it (kept boxes and their exclusive
  outlines), giving S-1's per-box lip features.
- **Pixel probe, version 2**: `helpers/label/probe.py` gains four values on each box's warped crop (short side 64 px,
  4 px inset): `edgeDensity` (mean RGB Sobel magnitude), `bandpass` (mean |G(σ 1) − G(σ 3)| of luma), `warm` (mean red
  chromaticity r) and `luma` (mean luma). Lines carry `version: 2`; F-0f's version-1 values are unchanged.
- **Reader text**: F-0f's `textFound` (any Vision or PP-OCR variant holds text), as F-0f's blank-card rule reads it.

**Looked at before fixing the rules (disclosed).** The code was smoke-run on the first two `pilot-000` photos in input
order, for crashes only. Before writing the rule, one count was read over the kept sets: the share of kept boxes with
no reader text (about a fifth on both sets), to know that a text guard leaves a population to act on. No cause was
evaluated on any box before this commit, and no photo was looked at.

### The rule (`src/eval/nb3.ts`)

A box the shipped kinds and the partition keep becomes `not-a-book` when any cause holds. Its sub-reason is the first
that holds, in this order:

1. **`on-lip`** (S-1, unchanged): `onLip` in `src/eval/s1.ts` with S-1's constants.
2. **`depth`**: no reader text, H-2's face split measured on at least 15 map pixels, at most 20 % `front` (the spine
   face) and at least 60 % `behind` (a gap, the back wall) plus `under` (a shelf's underside). Shares are over every
   measured pixel. `top` and `cover` do not count: a book's top face and a receding cover are books.
3. **`pixel`**: no reader text, and smooth and warm on the version-2 probe: `edgeDensity` and `bandpass` both at most
   their 5th percentile and `warm` at least its 95th percentile over the **reference boxes**.
   - Reference: `pilot-000` kept boxes whose readers found text and whose face split is at least 80 % `front`
     (machine-said book faces). The percentiles are computed once by `nb3-cli.ts calibrate`, which reads only the
     reference boxes' probe values, and are written into `NB3.pixel` in a commit before the first `flags` run. The
     same numbers apply to the yardstick.
   - `luma` (darkness) is recorded but not in the rule. F-R3 found undersides dark *and* warm, and `depth`'s `under`
     already names undersides; dark alone also matches plain dark spines and shadow gaps.

The text guard on `depth` and `pixel` is deliberate: no confirmed book can then be removed by them, so their keep rule
leans on the spot check below.

### Measures

Per set, apart:

- **Extra discards** by cause (first cause) and for the whole rule, as counts with a 95 % photo bootstrap interval
  (2,000 draws, seed 1), plus the number of boxes each cause holds for at all and the overlaps.
- **Removed confirmed** (a lower bound on books removed), on the yardstick also **removed confirmed and annotated**,
  and **removed at `text-read`** and **at `text-present`** (upper hints), from the cached base decisions.
- With every cause on, against the partition's kept set: works, confirmed and boxes per photo, confirmed share (paired
  photo bootstrap); on the yardstick, title recall and precision, wrong accepts and distinct confirmed works per image.
- The median version-2 pixel values of each cause's removals against the kept rest.

**Blind spot check of the catches (agent, not labels).** On `pilot-000`: up to 20 boxes per cause, drawn with seed 3
from the boxes whose first cause it is, and 20 controls drawn with seed 3 from kept boxes no cause holds and no reader
found text on. Shuffled; each box shown on its photo with 25 % context and no machine output (`helpers/shelf/spot.py`),
judged *a shelf, wood, wall, gap, sign, card or strip: not a book?* (yes, no or unclear) by an agent that has not
seen the rule's output. The judgements stay private and are never used as labels or to tune anything.

### Keep rule

A cause ships by default (`NB3_SHIP` in `src/eval/nb3.ts`, read by `f0-cli.ts`) only if both hold:

1. **F-0f's rule**: it removes **no confirmed book** on either set (no removal accepted; on the yardstick none
   accepted, annotated or not).
2. **It removes non-books**: at least 80 % of its judged catches in the spot check are judged *not a book*, with at
   least 3 judged. With fewer than 3, a cause does not ship, except `on-lip`, which then keeps S-1's met spot check
   (`evals/S1`).

A cause that fails stays available as a reported flag and is off. If no cause ships, the default's not-a-book kinds
are unchanged and the depth stage stays out of the default path's run (it is wired, gated on `NB3_SHIP`).

**Caches it invalidates if any cause ships** (not re-baselined here; the conductor batches them after F-0m and
F-0k): the kept-box set; Q-2b's τ; H-2's face shares (the dropped boxes' rows); F-R1's tables; S-1's per-row figures
(and S-2's, which read the same rows); Q-3's audit and catalog-v2 re-decision.
