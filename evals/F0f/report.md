# F0f: perspective-aware spine tops and a shelf-label filter (F-0f)

Run 2026-11-03, card F-0f. Two owner observations on F-0c's renders: **lower rows lose the spine's upper bound**
(the camera looks down on low shelves and up at high ones, so each row is seen from its own angle), and **shelf
labels and cards are kept as books** (a shelf-talker card kept as a face-out cover, a blank white card kept as a
cover, genre strips on the shelf edges). Two sets, never merged (OC35): **`pilot-000`** (31 real-use photos; every
reader figure is **machine agreement, never accuracy**, INV-17) and the **yardstick (PROXY, library shelves)**, the
40-image Library Dataset sample, used to evaluate only. No hand labels (OC36), no paid calls, nothing trained or tuned
on the yardstick. Aggregates only; photos, crops, reads and titles stay under the data root.

## Pre-registration (written before any full-run result)

Fixed after looking at two `pilot-000` photos (the owner's two examples) as overlays and before any arm ran on the
full sets; the thresholds are the constants in `helpers/label/detect.py` (`ROW_*`, `TOPS_*`, `ANGLE_DEV`) and
`src/eval/f0f.ts` (`KEEP`, `LABEL`).

**Base.** Each set's shipped default with its cached boxes and readings: on `pilot-000` F-0e's `bands+strips`
boxes, read with the shipped crop (`rect;rot=fixed;clip=frame`); on the yardstick F-0's own B2 run. Every arm is a
post step on those cached boxes (`detect.py --from`), so an unchanged box keeps its cached readings and only changed
boxes are read again.

**Rows.** A box's row is its upright neighbours (within 6 median spine widths either side, vertical extents
overlapping by half, leaning within 15°), not the band polygon, which perspective and chained shelves stretch. Its
spine height is the p90 of their long sides; its top and bottom lines are robust lines through the ends of the whole
neighbours (at least 0.8 of that height); its lean is a robust line in x through the neighbours' signed leans
(spines converge to one vanishing point, so lean changes linearly across a row).

**Arms** (cheapest first):

- *(c) `angles`*: an upright box leaning more than 6° off its row's fitted lean is turned about its centre to it
  (no re-mask).
- *(b) `tops`*: an upright box whose top end is more than 0.12 row spine heights short of its row's top line is
  extended along its own axis to that line (at most 1.1 row spine heights long) and re-masked with SAM 2.1: the
  extended box as prompt, positive points on the box and on the new part, negative points on the nearest row
  neighbour either side. The mask stands only if it covers at least half the extension, is at most 1.3× as wide,
  leans within 6° and stays in the box's column, and holds no more than half of any box from another column (F-0e's
  `extend` failed by swallowing thin neighbours). Boxes then mostly inside a grown box are dropped as its pieces.
  *`ends`*: the same at both ends.
- *(a) per-band rectification* (re-detect each band warped fronto-parallel) needs a full detection run per photo; it
  is run only if neither (b) nor (c) passes.

**Measures, per set.** *Partial-height share*: F-0e's measure, upright boxes under 0.55 of their band's spine height.
*Top-seam error*: the share of upright boxes whose top is off Q-2's top seam (`helpers/coverage/geometry.py`) by more
than 0.05 of the long side, either way, with its cut and overshoot parts. *Off-row lean*: the share of upright boxes
leaning more than 6° off their row's fit. Each by the band's elevation in the frame (thirds of the height). Arms
against the base: paired photo bootstrap; reads: share at `text-read` and `confirmed`, distinct confirmed works per
photo; on the yardstick, titles (recall, precision, wrong accepts per image), paired image bootstrap. Intervals are
95 %, 2,000 resamples, seed 1.

**Keep rules.**

- *`tops` / `ends`* ship as the whole-case default only if, on `pilot-000`, the partial-height share falls with an
  interval wholly below 0, the top-seam error falls (point estimate below 0), and distinct confirmed works per photo
  do not fall (interval not wholly below 0); and on the yardstick neither title recall falls nor wrong accepts per
  image rise beyond their intervals. An arm failing the geometry part is not read.
- *`angles`* changes no box's length, so the partial-height test cannot apply. It ships only if, on `pilot-000`, the
  boxes it turned reach `confirmed` more often than the same boxes did before (paired photo bootstrap of the
  confirmed share among changed boxes, interval wholly above 0), works per photo do not fall, and the yardstick is not
  hurt as above.

**Shelf labels and cards (Part B).** A box is `not-a-book` with a sub-reason when:

- *`shelf-strip`*: its reader text names a store section the way a shelf strip does ("Fiction/Fantasy",
  "Alphabetical by Author") — genre words alone are not enough, since imprints print "fantasy" on spines;
- *`shelf-talker`*: its reader text is recommendation phrasing ("Like ⟨author⟩?", "Now try", "If you like", "Staff
  pick", "Educators save");
- *`blank-card`*: no reader found text on it, it is cover-shaped or lying flat, and its pixels are a flat white card
  (mostly low-saturation bright pixels and few edges, `helpers/label/probe.py`).

Price stickers on a book are part of the book and match none of these. The filter ships if it removes **no confirmed
book** on either set (a confirmed box is two readers agreeing on one catalog work). F-0c's cover arm is re-run with
the filter to report whether false covers like the shelf-talker card are gone; F-0c's keep verdict is not changed.

**Looked at before fixing the label shapes** (disclosed): the first draft of the label rules matched words only. Viewing
every box it removed, before any perspective arm was read, showed two face-out covers whose box reaches down over the
genre strip on their shelf edge (so their readers also read the strip) and four white upright book sides or page
blocks taken as blank cards. The shapes above (strips strip-shaped and flat; blank cards flat and at least 75 % white)
were added then; they only remove false positives. Each reader variant is tested on its own, so a pattern never spans
two readings ("SCIENCE FICTION" and "FANTASY" read separately are an imprint, not a strip).

## Verdict

- **Diagnosis: the view angle changes by row, the boxes mostly do not.** Spines share one vanishing point per photo;
  what changes from row to row is the view elevation. On `pilot-000`, rows in the bottom third of the frame are seen
  from above, and their books' top faces show:
  - Q-2's top-seam error rises from 36 % of upright boxes in the top third to 74 % in the bottom third, its cut part
    from 5 % to 24 %. But the seam is the strongest colour step near the box top, and from above that is often the far
    edge of the top face against the dark shelf back, past the spine's real top. In the private galleries most
    bottom-third "cut" boxes end where the spine ends.
  - Geometry, against each box's own row: boxes whose top is short of the row's top line are no more common low in the
    frame (15 %, 12 %, 16 % by third). Partial-height boxes rise a little (4.5 % to 7.1 %).
  - Boxes leaning more than 6° off their row's fitted lean rise from 1.2 % to 9.5 %. Most are books that really lean
    (see `angles` below), so the owner's "tilt wrong" is mostly the box following a leaning book across its neighbours'
    lean, not a box at the wrong angle.
  - Rows high in the frame converge downward (85 % of boxes' rows; −2.8° of lean per 1000 px), as a camera pitched
    down gives; low rows hardly converge (52 %; −0.3°), where books lean either way.
- **No perspective step ships** (no pre-registered rule is met).
  - *`tops`* grows 144 `pilot-000` boxes to their row's top line; SAM declines most candidates (the rest of the spine is
    hidden by a card, or the box was a short book). Partial height −0.4 points (−0.8 to +0.2), top-seam error **+0.3
    points** (0.1 to 0.6): no geometry pass, so not read. *`ends`* (both ends): partial −0.7 (−1.3 to +0.1), seam
    error +0.3. On the yardstick both cut partial boxes (−2.0 and −4.2 points) but raise overshoot.
  - *`angles`* turns 396 `pilot-000` boxes to their row's lean. The boxes it turned were confirmed **33 times before and
    19 after** (−3.5 points, −6.1 to −1.0), and distinct confirmed works fell by **0.42 a photo (−0.74 to −0.16)**: the
    turned boxes were mostly right. The yardstick was not hurt (recall −0.3 points, −0.9 to +0.3; no wrong accepts).
  - *(a) per-band rectification* was pre-registered to run when (b) and (c) both fail. It was not run (logged deviation):
    it needs a new detection layout and a full detection run while another card held the GPU, and the diagnosis
    undercuts its premise (boxes stop short no more often low in the frame; the extra lean there is real).
- **Shelf labels and cards: the filter ships by default** (no confirmed book removed on either set). On the default's
  spine path it removes 17 `pilot-000` boxes on top of F-0c's flags (6 shelf-talkers, 4 genre strips, 7 blank cards),
  none confirmed and 2 at `text-read` (a strip and a talker whose words partly match a title or author); on the
  yardstick 4 white shelf lips, none read. On F-0c's cover arm it removes **13 of 142 kept covers** (8 shelf-talkers,
  5 blank cards), none confirmed; face-out boxes fall from 4.6 to 4.2 a photo, distinct confirmed works do not change
  (+0.03, 0.00 to 0.10). **Both false covers in the owner's examples are gone**: the shelf-talker card (now
  `shelf-talker`) and the blank white card (now `blank-card`). F-0c's keep verdict is unchanged: the cover pass stays
  off. Most genre strips never became a box at all (F-0e's `strips` and F-0c's flags already drop flat strips), so
  only 4 were left to name.

- **Default unchanged with the steps off.** `detect.py` with only F-0e's `strips` step, from the cached default boxes,
  returns spines, bands and gaps JSON-equal to `origin/main`'s `detect.py` on all 31 `pilot-000` photos and all 40
  yardstick images. F-0c's `kinds` without evidence is F-0c's (unit test). The pipeline change is the label filter only.

## What to try next

1. **Measure the spine top, not the top face.** Q-2's seam takes the strongest step; from above that is the top face's
   far edge. A seam that takes the *first* strong step past the spine colour, or one checked against the row's top
   line, would make "cut" mean cut. Re-run this diagnosis with it before any further top fix.
2. **Per-band rectification (a)**, on a fresh real-use set, if the better seam still shows low rows cut short.
3. **Shelf labels on a new store.** The patterns are this store's wording ("Like ⟨author⟩? Now try…"). A new set will
   bring new wording; the blank-card and strip shapes should carry over, the talker phrases may not.

## Limits

- `pilot-000` has no box ground truth: the measures are geometry and machine agreement, not box accuracy.
- The top seam is Q-2's heuristic, unvalidated against labels, and confounded by top faces in oblique views (above).
- The label rules were shaped on `pilot-000`'s own boxes (disclosed above); their no-harm result is on the same set.
  The yardstick, a library, has none of these objects, so it tests harm only.
- The `angles` reads add new crops for 396 boxes, read with F-0's original crop as the base was.

<!-- tables -->
### Diagnosis by row elevation: `pilot-000` (real use; reads are machine agreement, never accuracy, INV-17)

Default boxes: 5962 upright boxes, 5784 with a row (three neighbours, two whole), 5869 with a measured top seam. Pooled shares, 95 % photo-cluster bootstrap. A row's third is where its box centre sits in the frame: the top third is seen from below, the bottom third from above.

| measure | all | top third | middle third | bottom third |
|---|---:|---:|---:|---:|
| upright boxes (photos) | 5962 (31) | 1531 (29) | 2145 (31) | 2286 (30) |
| partial height (band spine height) | 5.3 % (4.0–7.0) | 4.5 % (2.3–6.7) | 4.1 % (2.8–5.6) | 7.1 % (4.5–10.5) |
| top-seam error (top off the seam by > 0.05) | 53.9 % (49.9–58.3) | 36.1 % (29.0–45.3) | 44.9 % (40.3–49.7) | 74.1 % (68.1–79.1) |
| … of it, top cut (seam beyond the box) | 16.1 % (14.0–18.2) | 5.2 % (3.7–6.6) | 15.0 % (12.3–17.8) | 24.4 % (20.8–27.5) |
| … of it, overshoot (seam inside the box) | 37.8 % (34.6–41.6) | 30.9 % (23.2–41.1) | 29.8 % (26.9–33.1) | 49.7 % (45.3–53.5) |
| top short of the row's top line (> 0.12 row heights) | 14.5 % (12.3–16.5) | 15.2 % (11.8–18.4) | 12.0 % (9.2–15.2) | 16.3 % (13.5–19.2) |
| leaning off the row (> 6°) | 6.9 % (5.9–7.9) | 1.2 % (0.5–2.2) | 8.3 % (6.3–10.3) | 9.5 % (7.8–11.4) |
| boxes whose row holds five or more | | 1481 | 2079 | 2154 |
| their row's convergence, p50 (degrees of lean per 1000 px; < 0 spines converge downward) | | -2.7503 | -2.1972 | -0.251 |
| … converging downward | | 85 % | 72 % | 52 % |
| … top line, abs slope p50 | | 0.0721 | 0.062 | 0.056 |

### Arms against the default boxes: `pilot-000` (real use; reads are machine agreement, never accuracy, INV-17)

Each arm is a post step on the default's cached boxes; changes are arm minus default, paired photo bootstrap (95 %).

| arm | boxes (default 6145) | boxes changed | partial height (band spine height) | top-seam error (top off the seam by > 0.05) | … of it, top cut (seam beyond the box) | … of it, overshoot (seam inside the box) | top short of the row's top line (> 0.12 row heights) | leaning off the row (> 6°) | post-step s/photo |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| angles | 6145 | 396 | +0.0 pts (0.0 to 0.0) | +0.1 pts (-0.2 to 0.3) | -0.0 pts (-0.3 to 0.2) | +0.1 pts (-0.2 to 0.3) | -0.1 pts (-0.3 to 0.2) | -5.3 pts (-6.1 to -4.5) | 0.1 (0.1 to 0.1) |
| tops | 6126 | 144 | -0.4 pts (-0.8 to 0.2) | +0.3 pts (0.1 to 0.6) | +0.1 pts (-0.1 to 0.3) | +0.3 pts (-0.0 to 0.5) | -2.4 pts (-2.9 to -1.9) | +0.0 pts (-0.1 to 0.2) | 18.8 (14.5 to 23.4) |
| ends | 6111 | 196 | -0.7 pts (-1.3 to 0.1) | +0.3 pts (-0.1 to 0.6) | +0.1 pts (-0.1 to 0.4) | +0.1 pts (-0.2 to 0.5) | -2.1 pts (-2.7 to -1.7) | -0.0 pts (-0.2 to 0.1) | 26.7 (20.9 to 33.0) |

Bottom third only: angles partial +0.0 pts (0.0 to 0.0), seam error +0.2 pts (-0.2 to 0.6); tops partial -0.4 pts (-0.9 to 0.0), seam error -0.1 pts (-0.5 to 0.4); ends partial -0.4 pts (-1.2 to 0.5), seam error +0.1 pts (-0.5 to 0.7).

| arm (read) | `text-read` share | confirmed share | confirmed boxes per photo | **distinct confirmed works per photo** | works lost per photo | changed boxes confirmed, before → after | change in their confirmed share |
|---|---:|---:|---:|---:|---:|---:|---:|
| angles | -0.1 pts (-0.3 to 0.1) | -0.2 pts (-0.4 to -0.1) | -0.45 (-0.84 to -0.13) | **-0.42 (-0.74 to -0.16)** | 0.48 (0.23 to 0.77) | 33/396 → 19/396 | -3.5 pts (-6.1 to -1.0) |

### Shelf labels and cards: `pilot-000` (real use; reads are machine agreement, never accuracy, INV-17)

*Removed confirmed* is a lower bound on real books removed (two readers agreed on one catalog work); *at `text-read`* an upper hint.

| boxes | boxes | removed | by rule | removed confirmed | removed at `text-read` |
|---|---:|---:|---|---:|---:|
| default spine path (cover pass off), on top of F-0c's flags | 6145 | 17 | blank-card 7, shelf-strip 4, shelf-talker 6 | 0 | 2 |
| F-0c's kept covers | 142 | 13 | shelf-talker 8, blank-card 5 | 0 | 4 |

F-0c's cover arm with the filter: face-out boxes per photo 4.58 (3.45 to 5.77) → 4.16 (3.00 to 5.39); against it without the filter, distinct confirmed works per photo +0.03 (0.00 to 0.10), confirmed share +0.1 pts (0.0 to 0.1). Spine path with the filter against the default: works per photo +0.00 (0.00 to 0.00), confirmed share +0.0 pts (0.0 to 0.1).

### Diagnosis by row elevation: Yardstick (PROXY, library shelves; evaluation only)

Default boxes: 1064 upright boxes, 1019 with a row (three neighbours, two whole), 1060 with a measured top seam. Pooled shares, 95 % photo-cluster bootstrap. A row's third is where its box centre sits in the frame: the top third is seen from below, the bottom third from above.

| measure | all | top third | middle third | bottom third |
|---|---:|---:|---:|---:|
| upright boxes (photos) | 1064 (40) | 139 (20) | 740 (40) | 185 (24) |
| partial height (band spine height) | 18.2 % (12.8–24.3) | 30.1 % (12.3–61.5) | 15.0 % (8.9–22.0) | 21.9 % (14.1–32.4) |
| top-seam error (top off the seam by > 0.05) | 47.5 % (41.7–53.1) | 46.0 % (32.8–60.0) | 47.8 % (41.2–54.3) | 47.8 % (31.5–57.3) |
| … of it, top cut (seam beyond the box) | 15.8 % (12.8–18.8) | 10.1 % (4.3–16.1) | 15.6 % (11.5–19.7) | 21.2 % (14.0–28.1) |
| … of it, overshoot (seam inside the box) | 31.7 % (25.5–37.7) | 36.0 % (19.0–53.7) | 32.2 % (26.0–38.7) | 26.6 % (14.3–36.7) |
| top short of the row's top line (> 0.12 row heights) | 22.1 % (17.9–26.5) | 8.7 % (3.0–16.7) | 18.7 % (14.5–23.1) | 45.1 % (32.2–71.7) |
| leaning off the row (> 6°) | 6.1 % (3.9–8.5) | 2.7 % (0.0–10.3) | 6.8 % (3.9–9.8) | 5.8 % (1.0–8.6) |
| boxes whose row holds five or more | | 109 | 783 | 117 |
| their row's convergence, p50 (degrees of lean per 1000 px; < 0 spines converge downward) | | -0.9173 | -0.5172 | -0.444 |
| … converging downward | | 65 % | 64 % | 60 % |
| … top line, abs slope p50 | | 0.0277 | 0.0735 | 0.0468 |

### Arms against the default boxes: Yardstick (PROXY, library shelves; evaluation only)

Each arm is a post step on the default's cached boxes; changes are arm minus default, paired photo bootstrap (95 %).

| arm | boxes (default 1132) | boxes changed | partial height (band spine height) | top-seam error (top off the seam by > 0.05) | … of it, top cut (seam beyond the box) | … of it, overshoot (seam inside the box) | top short of the row's top line (> 0.12 row heights) | leaning off the row (> 6°) | post-step s/photo |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| angles | 1132 | 62 | -0.2 pts (-0.7 to 0.0) | +0.6 pts (-0.2 to 1.4) | -0.1 pts (-0.7 to 0.6) | +0.7 pts (0.1 to 1.3) | -0.1 pts (-0.4 to 0.3) | -5.5 pts (-7.5 to -3.7) | 0.0 (0.0 to 0.0) |
| tops | 1118 | 67 | -2.0 pts (-3.4 to -1.0) | +2.6 pts (1.2 to 4.4) | +0.2 pts (-1.1 to 1.4) | +2.4 pts (1.1 to 3.9) | -6.6 pts (-8.8 to -4.7) | +0.3 pts (-0.3 to 0.8) | 3.5 (2.6 to 4.4) |
| ends | 1073 | 148 | -4.2 pts (-6.8 to -2.0) | +2.2 pts (0.4 to 3.9) | -0.3 pts (-1.7 to 1.0) | +2.5 pts (0.7 to 4.1) | -5.1 pts (-7.5 to -2.6) | +0.3 pts (-0.5 to 1.1) | 5.9 (4.5 to 7.3) |

Bottom third only: angles partial -0.4 pts (-1.7 to 0.0), seam error -0.3 pts (-1.7 to 1.0); tops partial -2.0 pts (-5.2 to 0.9), seam error +0.4 pts (-3.9 to 3.2); ends partial -2.6 pts (-6.5 to 1.1), seam error -0.8 pts (-8.0 to 5.1).

| arm (read) | `text-read` share | confirmed share | confirmed boxes per photo | **distinct confirmed works per photo** | works lost per photo | changed boxes confirmed, before → after | change in their confirmed share |
|---|---:|---:|---:|---:|---:|---:|---:|
| angles | -0.3 pts (-0.8 to 0.2) | +0.0 pts (-0.5 to 0.5) | +0.00 (-0.13 to 0.15) | **-0.05 (-0.15 to 0.05)** | 0.07 (0.00 to 0.17) | 8/62 → 8/62 | +0.0 pts (-7.8 to 10.0) |

| arm (yardstick titles) | hits / accepted | Δ title recall | Δ title precision | Δ wrong accepts per image |
|---|---:|---:|---:|---:|
| default | 241 / 260 | | | |
| angles | 239 / 258 | -0.3 pts (-0.9 to 0.3) | -0.1 pts (-0.2 to 0.0) | +0.00 (0.00 to 0.00) |

### Shelf labels and cards: Yardstick (PROXY, library shelves; evaluation only)

*Removed confirmed* is a lower bound on real books removed (two readers agreed on one catalog work); *at `text-read`* an upper hint.

| boxes | boxes | removed | by rule | removed confirmed | removed at `text-read` |
|---|---:|---:|---|---:|---:|
| default spine path (cover pass off), on top of F-0c's flags | 1132 | 4 | blank-card 4 | 0 | 0 |
| F-0c's kept covers | 21 | 0 | none | 0 | 0 |

F-0c's cover arm with the filter: face-out boxes per photo 0.53 (0.25 to 0.85) → 0.53 (0.25 to 0.85); against it without the filter, distinct confirmed works per photo +0.00 (0.00 to 0.00), confirmed share +0.1 pts (0.0 to 0.2). Spine path with the filter against the default: works per photo +0.00 (0.00 to 0.00), confirmed share +0.1 pts (0.0 to 0.2). Yardstick titles: recall +0.0 pts (0.0 to 0.0), precision +0.0 pts (0.0 to 0.0), wrong accepts per image +0.00 (0.00 to 0.00).

### Keep rules

| step | geometry (partial falls, seam error falls) | changed boxes read better | `pilot-000` works not down | yardstick unhurt | ships |
|---|---|---|---|---|---|
| angles | n/a | no | no | yes | **no** |
| tops | no | n/a | n/a | n/a | **no** |
| ends | no | n/a | n/a | n/a | **no** |

Shelf-label filter: confirmed books removed, `pilot-000` 0, yardstick 0: **ships**.

<!-- /tables -->
