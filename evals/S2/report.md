# S2: headroom map (S-2)

## Pre-registration (committed before the first full run)

Fixed 2026-11-04, before any full-set run of the headroom step. Nothing below is changed after seeing a full result;
any change is logged as a deviation in `implementation-notes.md`, and the report says which figures it touches.

**Question.** Above each shelf row's books and below the board over them lies a strip of the photo nobody reads
today: the **headroom**. What is in it? For every headroom pixel, is the back panel showing (**empty**), is the view
blocked by the board (**occluded**: unseen, not empty), does something stand or lie there (**occupied**: a book lying
flat, a sign, a shelf-talker), or can the depth stage not say (**unknown**)? Do the occupied regions agree with the
boxes the pipeline already has for books lying flat and for not-a-book things? The occupied regions are F-0k's input
(missed-book recovery); the row gaps and box-less `front` faces are Q-3's (the gap audit).

**Sets, never merged (OC35).**

- **`pilot-000`**: 31 real-use photos, F-0e's default `bands+strips` boxes after the shipped not-a-book filter, and
  F-0i's instance partition of them (#51): its kept box set (5,761 of 6,121) and their exclusive outlines. Every
  figure is **machine agreement, never accuracy** (INV-17). It is a dev set (OC11).
- **Yardstick (PROXY)**: the 40-image Library Dataset sample with F-0's B2 boxes after the same filter and F-0i's
  partition (1,040 of 1,116 kept). Evaluation only: never trained or tuned on.

No hand labels (OC36). Nothing is trained. No GPU: every step reads H-2's depth cache (MoGe-2 ViT-L normal at
`cb0e8bb`, looked up through `stage.py` with H-2's options, so its keys decide the hits) and F-0i's private partition.

**Looked at before fixing the rules (disclosed).** Nothing from a run of this card. The rules below are written from
S-1's and F-0i's reports and code. The code is debugged on synthetic scenes (the tests) and smoke-run on the first two
`pilot-000` photos in input order for crashes only; any threshold change after that is a logged deviation.

### Step 1: shelf rows on the partition

S-1's `shelf.py` is re-run unchanged in its rules on the partition: a box is a kept book when F-0i keeps it, and its
outline is F-0i's exclusive outline (S-1 used Q-2b's outlines and every filter-kept box). This gives each row its
frame (spine-plane normal n_f, up u, side s), spine-plane offset c, the books' base b0 and top bt, its planes (board
top, lip, back panel), its level and its voids, re-baselined on the partition as F-0i's report asks. A row is an
S-1 row: a band with a frame of its own and at least three book boxes with `front` pixels. Board pitch pairs rows
by S-1's rule (`pitches` in `src/eval/s1.ts`, unchanged).

### Step 2: the headroom region, per row (2-D, at the depth map's resolution)

- **Book tops: F-0f's fitted top line on the partition.** F-0f's `rowFits` (`src/eval/f0f.ts`, its `ROW` constants
  unchanged) runs on the partition's kept boxes (detection rectangles; dropped boxes take no part). Each fitted box's
  top line is a Theil-Sen line through its whole neighbours' top ends, where a box's top end is now taken from its
  exclusive outline: the point on the box's long axis level with the outline's furthest extent up that axis. (F-0f
  took the rectangle's end.)
- **The row's top curve.** Per map column across the row (from the leftmost to the rightmost extent of the row's
  standing books), the median of the top lines of the row's fitted boxes whose x-extent covers the column; columns
  covered by none are interpolated linearly between their neighbours (held flat past the ends). A row with no
  fitted box is skipped (`no-top-line`).
- **The board above.** The row's pitch partner above (S-1's rule). When that row's lip is found, the lip's face is
  the valid map pixels within 1.5 cm of its plane (S-1's inlier distance), with u . P (the upper row's frame) from
  its inliers' p5 − 1 cm to p95 + 1 cm and s . P within its side extent ± 5 cm (S-1's `on-lip` face). Per column,
  the lowest lip-face pixel above the top curve; a Theil-Sen line through those is the **board line**, kept when
  they cover at least 20 % of the row's columns (S-1's span bar). Source `lip`.
- **Open rows.** A row with no board line (no pitch partner above, or one without a found lip, or too few lip
  columns) gets an **open** region instead, reported apart and never in the headline figures: from the top curve up
  one row spine height (the median `h` of its fits), clipped to the frame.
- **Region.** Per column, the map pixels from just below the board line down to just above the top curve. A column
  where the board line is not above the top curve holds none.
- **Book pixels leave the region.** A region pixel is a **book** pixel, not headroom, when it lies inside a kept
  standing box's exclusive outline (any row's: a box whose long side is within 60° of vertical, F-0c's `flatDeg`),
  or when it faces up (H-1's `top` class in the row's frame), lies no more than 3 cm above bt and not more than 8 cm
  behind the spine plane: a standing book's own top face. Kept boxes lying flat stay in the headroom: they are what
  it may hold.

### Step 3: classify every headroom pixel

In the row's frame, with faces.py's `classify` (H-1's classes, unchanged), in this order:

1. **unknown (invalid)**: no valid depth at the pixel;
2. **occluded**: on the board above's lip face, or facing down (`under`: the board's underside);
3. **empty**: more than 8 cm behind the spine plane (faces.py's `BEHIND_M`): the back panel or the case's inside,
   seen past the books;
4. **unknown (foreground)**: more than 15 cm in front of the spine plane: something between the camera and the shelf;
5. **occupied candidate**: everything else, i.e. a surface standing at the books' depth above their tops: `front`,
   `edge`, `cover`, or `top` higher than the 3 cm book-top band.

Occupied candidates are joined into 8-connected components. A component of at least max(30, (½ median spine
width)²) map pixels is an **occupied region**; smaller ones are **unknown (speckle)**.

"Above eye level" needs no rule of its own: there the camera looks up, and the space over the books shows as the
board's underside (`under`) and its lip, so it comes out occluded; below eye level the camera looks down, past the
books' tops, onto the back panel (empty).

### Step 4: what each occupied region is checked against

The existing boxes, all from the shipped default (no new flag):

- **stacked**: a box the partition keeps whose long side is more than 60° from vertical (F-0c's `flatDeg`): a book
  lying flat;
- **not-a-book**: a box the shipped filter drops (F-0c's shape kinds and F-0f's shelf labels, by sub-reason);
- **on-lip**: S-1's `on-lip` flag, reported apart (it is not the default);
- **other**: any other box (a partition-dropped box, a standing box's rectangle, an F-0c cover-pass box), reported
  only.

A region is **explained** by the kind of box covering the largest share of its pixels when that share is at least
30 %. An unexplained region is a missed-book (or missed-object) candidate for F-0k.

### Measures, per set (both sets apart; 95 % photo-cluster bootstrap, 2,000 draws, seed 1)

- **M1, headroom share.** Over rows with a board line: headroom pixels ÷ (headroom pixels + the row's standing
  books' outline pixels), pooled. Also by elevation (H-1's strata, the row's median `elevationDeg`), the per-row
  distribution, and in metres: the **headroom gap** (the board line's lip-face p5 of u . P in the row's frame, minus
  bt) over the row's pitch (that p5 minus the row's level), per row, p25/p50/p75.
- **M2, class shares.** Of headroom pixels: empty, occluded, occupied, unknown (with unknown's three causes); they
  sum to 1. By elevation too.
- **M3, occupied share.** Occupied pixels ÷ headroom pixels, pooled; occupied regions per row and per photo.
- **M4, agreement with existing boxes.**
  - **Explained share**: the share of occupied regions (and of their pixels) explained by a stacked or not-a-book box;
    each kind apart, on-lip and other apart.
  - **Recall of known content**: of the stacked and not-a-book boxes with at least half their valid map pixels in
    headroom (region pixels not book pixels), the share with at least half those pixels occupied. Each kind apart.
    Few boxes qualify, so counts are given beside every share.
- **Reported, not in a rule:** open rows (count, and their class shares apart); rows skipped by cause; seconds a
  photo (CPU); the void share and plane-found rates of Step 1 against S-1's figures (the re-baseline F-0i's report
  asks for); Q-3's outputs (below) as counts and length shares.

### Adequacy check (pre-registered; S-2 changes no default, so it has no keep rule)

The map is **adequate as F-0k's search input** when, on `pilot-000`:

1. the unknown share of headroom pixels (M2) is at most 25 %, and
2. M4's recall of known content (stacked and not-a-book together) is at least 60 % (point estimate; the interval
   is reported).

If (2) fails, F-0k must read the map as a candidate list only: an absent occupied region would not mean an empty
headroom. Either way the regions are written.

### Blind spot check (agent, not labels)

From `pilot-000`'s **unexplained** occupied regions, 20 drawn with seed 3 (all, if fewer), shuffled, each shown on
its photo with 25 % context and no machine output. Judged: *is there something in this headroom other than the
shelf: a book lying flat or leaning, a sign or card, another object* (yes, no, unclear)? Judgements stay private and
never tune or label anything. Reported as counts.

### Private outputs (under the data root's `private/s2/<set>/`, never in the repository)

- `regions.jsonl` (**F-0k's input**): one line per occupied region: photo, row, exclusive contour and
  minimum-area rectangle in working-copy pixels, pixel count, height above the books' tops and offset from the spine
  plane (MoGe-2 metres), class mix, the boxes it overlaps with their shares, and `explainedBy` (null for a
  candidate).
- `gaps.jsonl` (**Q-3's input**): per row, Step 1's stretches on the partition (voids and outline gaps, in median
  spine widths and coverage segments, as S-1 writes them) with each stretch's share of uncovered pixels inside any
  detection box, flagged `frontNoBox` when it is an outline gap whose dominant class is `front` and under half of it
  lies in any box; and the row's unexplained occupied regions whose dominant class is `front` and that overlap no
  box at all.
- `headroom.jsonl` (per row: region source, pixel counts per class, gap and pitch), the label maps (`maps/`), and
  the still study `private/s2/renders/<set>/index.html`.
