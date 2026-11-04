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

## Findings (run 2026-11-04, after the pre-registration above)

Aggregates are in [`metrics.json`](metrics.json); the tables below the marker are generated. The two sets are
reported apart (OC35). `pilot-000` figures are machine agreement, never accuracy (INV-17). Metres are MoGe-2's,
whose scale is unverified (S-1). Nothing ran on the GPU: every photo was a depth-cache hit. After the full run one
aggregation bug was fixed: the photo bootstrap of regions per photo counted a photo drawn twice only once, which put
the point estimate outside its interval. Only that interval changed.

1. **The headroom is mapped on `pilot-000`: about a fifth of each bay, and mostly accounted for.**
   - 117 of 167 rows have a board line, 45 are open and 5 have no top line.
   - Headroom is **19.7 % (16.9–23.0)** of a row's bay by pixels. In metres the gap from the books' tops to the
     board is 10.4 cm (p50; IQR 8.9–12.4), **29 % of the pitch**. That agrees with S-1's books filling a median 0.72
     of their ceiling, from an independent measurement.
   - Of headroom pixels: **empty 46.4 % (36.9–56.1), occluded 38.1 % (28.7–47.2), occupied 13.8 % (12.1–15.6),
     unknown 1.6 % (1.0–2.7)**. Depth is valid nearly everywhere; unknown is mostly speckle.
2. **What the camera sees above the books depends on elevation, as the geometry predicts.**
   - Below eye level, the camera looks past the books onto the back panel: empty 73.6 %.
   - At eye level, it is about half occluded (52.6 %).
   - Above eye level, it sees the board's underside: occluded 88.9 %, empty 4.6 %.
   - So "is there room above these books?" can be answered only for rows at or below eye level. Above it the map
     says *unseen*, not *empty*, as the brief asked.
3. **Occupied regions are plentiful, but they are mostly the case, not things on the shelf.**
   - There are 284 occupied regions in rows with a board line: 9.2 a photo (7.0–11.4).
   - The blind spot check of 20 unexplained regions judged **4** to hold something other than the shelf (three
     leaning books, one book's top edge), **15 not** and 1 unclear.
   - The 15 misses are the case itself: the board's front edge just under the board line (6), and uprights and side
     walls (8), plus a case top.
   - The still study shows why. A row often spans two bays of one case, so the upright between them stands inside
     the row's headroom. It faces the camera at the spine plane's depth, so the geometry reads it as occupied. S-1's
     rows do not split at uprights; H-1's classes cannot tell an upright from a sign.
4. **Agreement with the default's own boxes is low, and the known content in the headroom is thin.**
   - Only **1.8 % (0.4–3.2)** of the regions (0.7 % of their pixels) are explained by a stacked or not-a-book box.
   - The shipped filter's 24 not-a-book boxes include **none in the headroom**: they are lip strips, talkers and cards
     below or on the lip.
   - Of 47 stacked boxes (kept, lying flat), 7 lie in the headroom. The map finds **2 of them occupied: 28.6 %
     (0.0–80.0)**. The other 5 are classed mostly *empty*: they lie more than 8 cm behind the spine plane, a book
     lying flat further back, and the pre-registered *empty* rule (anything that far behind) swallows them. This was
     seen after the run, in the label maps; nothing was changed.
   - Not in any rule: 107 of the 284 regions are mostly covered by a box from F-0c's cover pass, which is off by
     default. Whether those boxes are face-out books above the rows or the cover pass firing on the case is
     unjudged.
5. **The yardstick has almost no headroom with a board above.**
   - Library photos show one shelf, so 46 of 48 rows are open and only 2 have a board line. The headline measures
     there rest on 2 rows and mean nothing.
   - The open rows (reported apart) split empty 53.7 %, occluded 35.9 %, occupied 9.3 %.
6. **Adequacy check: not met.** The unknown share passes (1.6 % ≤ 25 %). Recall of known content fails (28.6 %
   against 60 %, on 7 boxes), and the spot check agrees.
   - **F-0k must read `regions.jsonl` as a candidate list only.** Its 206 unexplained `pilot-000` regions (lip and
     open rows) are about one real object in five by the spot check. An absent region does not mean an empty
     headroom: a book lying flat well back can be classed empty.
7. **Re-baseline of S-1 on the partition (reported).**
   - Planes are as S-1 found on `pilot-000`: lip 98.2 % against 96.4 %, board top 58.7 % against 58.3 %, back panel
     62.3 % against 60.1 %. The void share is unchanged at 1.2 %.
   - On the yardstick the void share rises from 1.7 % to 2.7 %: the partition dropped boxes, leaving more back panel
     uncovered.
8. **For Q-3 (`gaps.jsonl`).**
   - 153 `pilot-000` outline gaps face front with under half their pixels in any detection box: **4.3 % (3.3–5.6)
     of row length** is a spine-like face no box holds. A median outline gap is about half inside some box.
   - 25 unexplained, front-facing headroom regions overlap no box at all.
   - Yardstick: 14 such gaps, 2.5 %, and 6 regions.
9. **Cost.** 0.4 s a `pilot-000` photo for the headroom step and 0.2 s on the yardstick, on the CPU, after
   `shelf.py` (about 5 s a photo).

### What to try next (hypotheses, not run)

- **Split rows at the case's uprights** before mapping the headroom. An upright is a tall `front` or `cover` strip
  that reaches from the board up to the board above. That removes most of finding 3's misses.
- **Bound *empty* by the back panel, not by depth alone.** Count a pixel as empty only within a few centimetres of
  a found back-panel plane, else as occupied or unknown, so a book lying flat further back is not lost.
- **Trim the board line's own edge**, for example by 1 cm in u, so the board's front-edge strip (finding 3) falls
  outside the region.
- Each is a rule change for a fresh pre-registration, not a re-tune here.

## What this does not show

- No pixel or box accuracy: `pilot-000` has no ground truth, and the spot check is one agent's look at 20 regions,
  never labels.
- Whether the cover pass's boxes over occupied regions are books (finding 4).
- Anything on the yardstick beyond open rows (finding 5).

<!-- generated by src/eval/s2-cli.ts analyse: edit above this line -->

## pilot-000 (real use (OC35): machine agreement, never accuracy (INV-17))

31 photos; headroom step 0.41 s a photo (p50, CPU, after the cached depth stage and the shelf rows).

167 S-1 rows on the partition: **117 with a board line**, 45 open (reported apart), skipped: no-top-line 5.

### M1–M3: headroom and its classes (rows with a board line)

Headroom share = headroom pixels ÷ (headroom + the row's standing books' pixels). Class shares are of headroom pixels and sum to 1. 95 % photo bootstrap.

| rows | n | headroom share | empty | occluded | **occupied** | unknown |
|---|---:|---|---|---|---|---|
| all | 117 | 19.7 % (16.9–23.0) | 46.4 % (36.9–56.1) | 38.1 % (28.7–47.2) | 13.8 % (12.1–15.6) | 1.6 % (1.0–2.7) |
| below eye level | 77 | 13.6 % (9.3–19.3) | 73.6 % (63.7–79.6) | 4.2 % (2.5–7.2) | 19.1 % (15.2–24.9) | 3.1 % (1.6–6.3) |
| level eye level | 28 | 30.0 % (26.6–32.9) | 35.1 % (26.2–44.0) | 52.6 % (43.6–62.4) | 12.1 % (8.8–14.9) | 0.5 % (0.4–0.7) |
| above eye level | 12 | 22.0 % (18.7–25.8) | 4.6 % (1.5–9.4) | 88.9 % (83.2–93.5) | 4.5 % (2.6–6.2) | 1.1 % (0.6–1.5) |
| open rows (apart) | 45 | 33.0 % (23.2–40.4) | 29.5 % (11.1–40.2) | 46.0 % (35.0–62.6) | 24.1 % (17.7–32.6) | 0.5 % (0.3–0.8) |

Unknown by cause: invalid depth 0.0 % (0.0–0.0), foreground 0.4 % (0.0–1.3), speckle 1.2 % (0.9–1.6).

| measure | value |
|---|---|
| headroom share per row, p25 / p50 / p75 | 3.2 % / 14.0 % / 23.1 % (n 117) |
| headroom gap (board line's lip face p5 − books' top), p25 / p50 / p75 (MoGe-2 metres, unverified) | 8.9 cm / 10.4 cm / 12.4 cm (n 117) |
| headroom gap ÷ pitch, p25 / p50 / p75 | 25.9 % / 29.3 % / 32.8 % (n 117) |
| occupied regions (rows with a board line) | 284 (2.4274 a row; 9.16 a photo (6.97–11.42)) |
| region size, map pixels, p25 / p50 / p75 | 611.75 / 1240 / 2967 |
| dominant class of the regions | front 146, cover 118, top 19, edge 1 |

### M4: agreement with the default's own boxes

| measure | value |
|---|---|
| regions explained by a stacked or not-a-book box (count) | 1.8 % (0.4–3.2) of 284 |
| the same, by pixels | 0.7 % (0.1–1.7) |
| explained by kind | cover-pass 107, standing 18, dropped 4, stacked 3, not-a-book 2, on-lip 0; unexplained 150 (30 overlap no box at all) |
| not-a-book explainers by sub-reason | blank-card 1, spans-books 1 |
| recall of stacked + not-a-book: in headroom → occupied | 71 boxes, 7 in headroom, 2 recalled: 28.6 % (0.0–80.0) |
| recall of stacked (kept, lying flat): in headroom → occupied | 47 boxes, 7 in headroom, 2 recalled: 28.6 % (0.0–80.0) |
| recall of not-a-book (shipped filter): in headroom → occupied | 24 boxes, 0 in headroom, 0 recalled: — |
| recall of `on-lip` (S-1's flag, not the default): in headroom → occupied | 4 boxes, 0 in headroom, 0 recalled: — |
| not-a-book boxes in headroom by sub-reason | none |
| open rows: regions explained / recall | 1.0 % (0.0–3.0) of 103; 2 of 2 |

### Reported: S-1 on the partition, and Q-3's outputs

| measure | value |
|---|---|
| rows (S-1's rule, on the partition) | 167 |
| board top / lip / back panel found | 58.7 % (52.5–64.7) / 98.2 % (96.0–100.0) / 62.3 % (54.1–70.5) |
| void share (void length ÷ row length) | 1.2 % (0.4–2.2) |
| outline-gap share | 11.2 % (9.4–13.1) |
| stretches by kind | outline-gap 400, void 27 |
| outline gaps' share inside any box, p25 / p50 / p75 | 12.3 % / 47.9 % / 100.0 % (n 400) |
| **`front` outline gaps with no box** (Q-3): count, length share | 153, 4.3 % (3.3–5.6) |
| unexplained `front` headroom regions overlapping no box (Q-3) | 25 |

## yardstick (PROXY (library shelves): Library Dataset sample, box arm B2; confirmed = accepted and annotated in the image)

40 photos; headroom step 0.21 s a photo (p50, CPU, after the cached depth stage and the shelf rows).

48 S-1 rows on the partition: **2 with a board line**, 46 open (reported apart), skipped: none.

### M1–M3: headroom and its classes (rows with a board line)

Headroom share = headroom pixels ÷ (headroom + the row's standing books' pixels). Class shares are of headroom pixels and sum to 1. 95 % photo bootstrap.

| rows | n | headroom share | empty | occluded | **occupied** | unknown |
|---|---:|---|---|---|---|---|
| all | 2 | 32.1 % (16.2–59.6) | 26.8 % (26.7–26.9) | 0.4 % (0.2–0.8) | 70.7 % (70.1–71.9) | 2.1 % (0.6–2.8) |
| below eye level | 2 | 32.1 % (16.2–59.6) | 26.8 % (26.7–26.9) | 0.4 % (0.2–0.8) | 70.7 % (70.1–71.9) | 2.1 % (0.6–2.8) |
| level eye level | 0 | — | — | — | — | — |
| above eye level | 0 | — | — | — | — | — |
| open rows (apart) | 46 | 24.8 % (20.7–28.7) | 53.7 % (44.7–63.7) | 35.9 % (26.2–45.5) | 9.3 % (6.1–12.9) | 1.1 % (0.7–1.7) |

Unknown by cause: invalid depth 0.0 % (0.0–0.0), foreground 1.9 % (0.0–2.8), speckle 0.2 % (0.0–0.6).

| measure | value |
|---|---|
| headroom share per row, p25 / p50 / p75 | 27.0 % / 37.9 % / 48.8 % (n 2) |
| headroom gap (board line's lip face p5 − books' top), p25 / p50 / p75 (MoGe-2 metres, unverified) | 17.8 cm / 22.3 cm / 26.9 cm (n 2) |
| headroom gap ÷ pitch, p25 / p50 / p75 | 36.4 % / 46.8 % / 57.1 % (n 2) |
| occupied regions (rows with a board line) | 2 (1 a row; 0.05 a photo (0.00–0.13)) |
| region size, map pixels, p25 / p50 / p75 | 122968 / 148969 / 174970 |
| dominant class of the regions | front 2 |

### M4: agreement with the default's own boxes

| measure | value |
|---|---|
| regions explained by a stacked or not-a-book box (count) | 0.0 % (0.0–0.0) of 2 |
| the same, by pixels | 0.0 % (0.0–0.0) |
| explained by kind | stacked 0, not-a-book 0, on-lip 0, dropped 0, standing 0, cover-pass 0; unexplained 2 (0 overlap no box at all) |
| not-a-book explainers by sub-reason | none |
| recall of stacked + not-a-book: in headroom → occupied | 61 boxes, 1 in headroom, 1 recalled: 100.0 % (100.0–100.0) |
| recall of stacked (kept, lying flat): in headroom → occupied | 45 boxes, 1 in headroom, 1 recalled: 100.0 % (100.0–100.0) |
| recall of not-a-book (shipped filter): in headroom → occupied | 16 boxes, 0 in headroom, 0 recalled: — |
| recall of `on-lip` (S-1's flag, not the default): in headroom → occupied | 2 boxes, 1 in headroom, 1 recalled: 100.0 % (100.0–100.0) |
| not-a-book boxes in headroom by sub-reason | none |
| open rows: regions explained / recall | 1.5 % (0.0–4.8) of 67; 1 of 21 |

### Reported: S-1 on the partition, and Q-3's outputs

| measure | value |
|---|---|
| rows (S-1's rule, on the partition) | 48 |
| board top / lip / back panel found | 66.7 % (54.4–78.7) / 97.9 % (93.6–100.0) / 83.3 % (73.9–92.0) |
| void share (void length ÷ row length) | 2.7 % (0.9–4.8) |
| outline-gap share | 7.5 % (5.4–9.8) |
| stretches by kind | outline-gap 52, void 20 |
| outline gaps' share inside any box, p25 / p50 / p75 | 8.6 % / 44.6 % / 100.0 % (n 52) |
| **`front` outline gaps with no box** (Q-3): count, length share | 14, 2.5 % (1.0–4.3) |
| unexplained `front` headroom regions overlapping no box (Q-3) | 6 |

## Spot check and adequacy

Blind agent spot check (`pilot-000`, unexplained occupied regions): *something other than the shelf* 4 of 20, no 15, unclear 1. One agent's judgement, never labels.

| unknown share ≤ 25 % | recall of known content ≥ 60 % | adequate as F-0k's search input |
|---|---|---|
| yes | no | **no: read the map as a candidate list only** |
