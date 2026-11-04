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

## Findings (run 2026-11-04, after the pre-registration above)

Pre-registration: commit `fb8a7c3`. The pixel thresholds were calibrated on `pilot-000` alone and committed in
`395cce8`, before the first `flags` run on either set: `edgeDensity` ≤ 0.042, `bandpass` ≤ 0.0211 and `warm` ≥
0.4674, from 2,304 reference boxes. Aggregates are in [`metrics.json`](metrics.json); the tables below the marker are
generated. The two sets are reported apart (OC35). `pilot-000` figures are machine agreement, never accuracy (INV-17).

1. **Verdict: only `on-lip` ships.** `depth` and `pixel` fail the keep rule's second condition and stay off as reported
   flags (`NB3_SHIP`).
   - **`on-lip`** removes 4 `pilot-000` boxes (0 to 9) and 2 yardstick boxes (0 to 5) from F-0i's partition. None was
     confirmed. The blind check judged all 4 `pilot-000` catches *not a book*. These are S-1's catches: the partition
     kept all of them.
   - **`depth`** would remove 45 `pilot-000` boxes (21 to 74) and 100 yardstick boxes (50 to 164). None was confirmed
     or read. But the blind check judged **0 of 20** *not a book*.
   - **`pixel`** would remove 32 `pilot-000` boxes (22 to 44) and 6 yardstick boxes (2 to 12). None was confirmed.
     The check judged **5 of 18** *not a book*, with 2 unclear.
   - The controls (kept boxes with no reader text and no cause) were judged *not a book* 0 of 20.
2. **F-0f's rule alone would have passed all three causes, wrongly.** No cause removes a confirmed book on either set,
   and yardstick titles, wrong accepts and distinct works are unchanged. For `depth` and `pixel` this follows from the
   text guard: they act only where no reader found text. The pre-registered spot check is what showed that their
   catches are mostly unread books, not shelves. This is why it was added to the brief's rule (logged as a deviation).
3. **What `depth` catches is books whose face the face split puts behind the spine plane** (hypothesis, from
   aggregates). All 45 `pilot-000` and all 100 yardstick catches are `behind`-dominant; none is `under`. On
   `pilot-000`, 32 of 45 lie more than 10° below eye level (median −39°), where the camera looks down onto the rows. On
   the yardstick, most catches sit at eye level. That matches S-1's caveat that a far shelf seen through a near one
   counts as `behind`. The likely cause is the band's spine-plane offset, a single median per band. A book standing
   back from the row, or a row seen steeply from above, lands more than 8 cm behind it. The mechanism is not
   measured here.
4. **`pixel` does find smooth, warm boxes, but most are plain spines.** Its catches' medians, against the kept rest
   (`pilot-000`):
   - edge density 0.032 against 0.077;
   - band-pass 0.015 against 0.040;
   - warm r 0.50 against 0.35;
   - luma 0.30 against 0.41.

   That is the wood signature F-R3 predicted per pixel, but at box level plain brown and orange spines with no
   readable text share it. The 95th percentile of book-face warmth is not a book/wood boundary.
5. **What ships changes little.** With `on-lip` on, the partition's kept set loses 4 of 5,761 boxes on `pilot-000`
   and 2 of 1,040 on the yardstick. No work and no confirmed spine is lost.
6. **Default path.** `f0-cli.ts` now runs the depth stage (`src/eval/nb3-stage.ts`: `helpers/depth/stage.py` on H-2's
   cache, then `helpers/shelf/shelf.py`) whenever a shipped cause needs it, which `on-lip` does. The NB-3 post step
   runs after F-0c's and F-0f's kinds, before Qwen. On a photo with no cached geometry this runs MoGe-2 (GPU). This
   card ran only a smoke of the wiring on two cached `pilot-000` photos (geometry and faces hits, lip features for
   every box); the default pipeline itself was not run.

## What this does not show

- No box accuracy. The spot check is one agent's judgement on 62 boxes, not labels, and only on `pilot-000`. The
  yardstick has no check, so its 100 `depth` catches are unjudged.
- Whether a fixed `depth` rule would work. Candidate fixes for a fresh card (hypotheses): a per-box offset against the
  box's row neighbours rather than the band median; requiring the S-1 back panel to be found at the box's depth; or
  restricting `depth` to eye-level rows. A version of `pixel` would need a reference that includes plain spines, or a
  second cue.
- Covers: out of scope (cover pass off, the partition is spine-path only).

## Caches invalidated by what ships (`on-lip` on the partition; not re-baselined here)

The kept-box set (−4 `pilot-000`, −2 yardstick), so:

- Q-2b's τ;
- H-2's face shares (those boxes' rows);
- F-R1's tables;
- S-1's and S-2's per-row figures;
- Q-3's audit and catalog-v2 re-decision.

The conductor batches these after F-0m and F-0k. The version-2 probe is a new cache (`private/nb3/<set>/probe.jsonl`);
F-0f's version-1 probe files stay valid for its own fields.

## Private outputs

Under the data root's `private/nb3/`: per set `images.jsonl`, `stage.jsonl`, `shelf-inputs.jsonl`, `shelf.jsonl`,
`shelf-maps/`, `probe.jsonl` and `flags.jsonl`; `calibration.json`; the spot-check sheet with its key and judgements
(`pilot-000/spot/`). None of it is in the repository.

<!-- generated by src/eval/nb3-cli.ts analyse: edit above this line -->

## pilot-000 (real use (OC35): machine agreement, never accuracy (INV-17))

31 photos, 5761 kept boxes on F-0i's partition. Evidence: face split on 5761, version-2 probe on 5761; 1239 with no reader text.

Extra discards (a box counts under its first cause: on-lip, depth, pixel). *Removed confirmed* is a lower bound on real books removed; *at `text-read`* an upper hint. Counts with a 95 % photo bootstrap interval.

| cause | removed | held at all | removed confirmed | removed at `text-read` | removed at `text-present` |
|---|---:|---:|---:|---:|---:|
| `on-lip` | 4 (0 to 9) | 4 | 0 | 1 | 3 |
| `depth` | 45 (21 to 74) | 45 | 0 | 0 | 0 |
| `pixel` | 32 (22 to 44) | 33 | 0 | 0 | 0 |
| **NB-3 (all causes)** | 81 (53 to 113) | 81 | 0 | 1 | 3 |

Boxes held by more than one cause: depth+pixel 1.

Median pixel values (version-2 probe) of each cause's removals against the kept rest:

| boxes | edge density | band-pass | warm (r) | luma |
|---|---:|---:|---:|---:|
| kept | 0.0767 | 0.0395 | 0.3513 | 0.4059 |
| on-lip | 0.0675 | 0.0393 | 0.3317 | 0.8454 |
| depth | 0.0477 | 0.0252 | 0.3577 | 0.4302 |
| pixel | 0.0315 | 0.0147 | 0.4981 | 0.2981 |

Readers with every cause on, against the partition's kept set: works per photo +0.00 (0.00 to 0.00), confirmed per photo +0.00 (0.00 to 0.00), confirmed share +0.2 (0.1 to 0.3) pts, boxes per photo -2.61 (-3.68 to -1.71).

## yardstick (PROXY (library shelves): Library Dataset sample, box arm B2; confirmed = accepted and annotated in the image)

40 photos, 1040 kept boxes on F-0i's partition. Evidence: face split on 1040, version-2 probe on 1040; 261 with no reader text.

Extra discards (a box counts under its first cause: on-lip, depth, pixel). *Removed confirmed* is a lower bound on real books removed; *at `text-read`* an upper hint. Counts with a 95 % photo bootstrap interval.

| cause | removed | held at all | removed confirmed | removed confirmed and annotated | removed at `text-read` | removed at `text-present` |
|---|---:|---:|---:|---:|---:|---:|
| `on-lip` | 2 (0 to 5) | 2 | 0 | 0 | 0 | 1 |
| `depth` | 100 (50 to 164) | 100 | 0 | 0 | 0 | 0 |
| `pixel` | 6 (2 to 12) | 15 | 0 | 0 | 0 | 0 |
| **NB-3 (all causes)** | 108 (58 to 173) | 108 | 0 | 0 | 0 | 1 |

Boxes held by more than one cause: depth+pixel 9.

Median pixel values (version-2 probe) of each cause's removals against the kept rest:

| boxes | edge density | band-pass | warm (r) | luma |
|---|---:|---:|---:|---:|
| kept | 0.0545 | 0.0283 | 0.3737 | 0.4969 |
| on-lip | 0.0555 | 0.0308 | 0.3496 | 0.7909 |
| depth | 0.0264 | 0.0132 | 0.399 | 0.4707 |
| pixel | 0.0251 | 0.0114 | 0.496 | 0.2582 |

Readers with every cause on, against the partition's kept set: works per photo +0.00 (0.00 to 0.00), confirmed per photo +0.00 (0.00 to 0.00), confirmed share +3.0 (1.7 to 4.6) pts, boxes per photo -2.70 (-4.33 to -1.45). Yardstick titles: recall +0.0 (0.0 to 0.0) pts, precision +0.0 (0.0 to 0.0) pts, wrong accepts per image +0.00 (0.00 to 0.00), distinct confirmed works per image +0.00 (0.00 to 0.00).

## Spot check and verdict

Blind agent spot check (`pilot-000`), judged *not a book*: on-lip 4 of 4 (0 unclear); depth 0 of 20 (0 unclear); pixel 5 of 18 (2 unclear); control 0 of 20 (0 unclear). One agent's judgement, never labels.

| cause | no confirmed book removed (both sets) | spot check ≥ 80 % not a book | ships by default |
|---|---|---|---|
| `on-lip` | yes | yes | **yes** |
| `depth` | yes | **no** | **no** |
| `pixel` | yes | **no** | **no** |
