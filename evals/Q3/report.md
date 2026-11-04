# Q3: gap audit (Q-3)

## Pre-registration (committed before the first full run)

Fixed 2026-11-04, before any full-set run of the audit. Nothing below is changed after seeing a full result; any
change is logged as a deviation in `implementation-notes.md`, and the report says which figures it touches.

**Question.** The owner sees many books on the shelves that never get a label. For every book a person can see on
`pilot-000` (and, kept apart, on the yardstick), where on Q-0's coverage ladder did the machine stop, and why? Which
causes lose the most books, so that the experiment queue works on the biggest first?

**A baseline, not a final number.** The box set is F-0i's partition (#51). It changes again after F-0m (ends),
F-0k (missed-book recovery) and NB-3, and every figure here is to be re-run on each new box set, never carried over.

**Sets, never merged (OC35).**

- **`pilot-000`**: 31 real-use photos; F-0e's default `bands+strips` boxes after the shipped not-a-book filter,
  F-0i's partition of them (its kept boxes), and F-0e's cached readers with F-0's decision on them. Every figure is
  **machine agreement, never accuracy** (INV-17). It is a dev set (OC11).
- **Yardstick (PROXY)**: the 40-image Library Dataset sample with F-0's B2 boxes after the same filter and F-0i's
  partition. Its catalog is the library's closed inventory. Evaluation only: never trained or tuned on.

No hand labels (OC36). Nothing is trained. No GPU and no model run: every input is an existing private cache. The
one new computation over text is a catalog lookup (below) on the local catalog files, with no network call.

**Looked at before fixing the rules (disclosed).** Record shapes and counts of the caches below (which fields exist,
how many boxes sit at each Q-2b rung, how many S-2 stretches are `frontNoBox`), and the owner's labelling-gaps
example. No cause was computed and no cross-tabulation was run. The code is debugged on synthetic records (the
tests) and smoke-run on the first two `pilot-000` photos in input order for crashes only; any rule change after that
is a logged deviation.

### Inputs (all cached; the data root's private folders)

| what | `pilot-000` | yardstick |
|---|---|---|
| kept boxes | F-0i `partition.jsonl` (`state` kept) | the same |
| teacher rung per box | Q-2b's table (τ 0.72, its own box set) | Q-2b's yardstick table |
| decision bases beyond `readers-agree` | F-0g `copies.jsonl` (`confirmed-by-copy`), F-0h `decisions.jsonl` (`confirmed-by-context`) | the same, yardstick files |
| F-0's decision (reason, readers) | H-2's `base-decisions.jsonl` | the same |
| per-box pixels and position | Q-2b's re-measured Q-1 features (`mean`, `rmsContrast`, `outFrac`, `radial`, `cut`, `lying`, `band`) | Q-1's B2 features |
| face shares, elevation, side case | H-2 `faces.jsonl` (`shares`, `elevationDeg`, `ownPlane`) | the same |
| covers, shelf labels | F-0c's detections and `kinds` with F-0f's evidence (as S-1 and S-2 read them) | the same |
| rows and undetected stretches | S-2 `shelf.jsonl` (rows, polylines) and `gaps.jsonl` | the same |
| catalog-v2 (ISFDB plus Open Library, C-5) | re-decision of F-0's readings, below | not used (closed inventory) |

### Who counts as a book a person can see

1. **Detected:** every box F-0i keeps. Its rung is Q-2b's teacher rung, raised to `confirmed` when F-0g or F-0h
   confirmed it (`confirmed-by-copy`, `confirmed-by-context`). Boxes F-0i dropped are duplicates and pieces of a kept
   book (its G2 found no book lost) and count for nothing.
2. **Undetected, from row gaps:** each S-2 stretch flagged `frontNoBox` (an outline gap facing front, under half
   inside any detection box) holds **max(1, round(length))** books, length in median spine widths. Rung `seen`.
   A stretch whose reconstructed centre (below) lies inside a counted face-out cover is that cover's book and is not
   counted again.
3. **Undetected, face-out:** each cover F-0c's `kinds` keeps as `face-out` (F-0f's shelf-label rules on) that no kept
   box absorbs (no kept box with at least 60 % of its area inside it, F-0c's absorbed rule) is one book at rung `seen`:
   the shipped default runs no cover pass, and the spine path's shape filter drops covers.
4. **Reported apart, not in the headline:** S-2's `headroomFrontNoBox` regions (S-2's adequacy check failed: about
   one in five such regions held an object), and outline gaps whose dominant class is `cover` with under half inside
   any box (a leaning book or the case's side). Counts only.

`not-seen` holds no book on a still: every book counted is in the photo. Books in rows with no detected boxes, and
past a row's last box (S-1 grows a row only through empty back panel), are invisible to this audit, so every
`seen` count is a **lower bound**.

**Gap polygon.** S-2 records a stretch as `from`/`to` in median spine widths along its row's polyline. Its place in
working-copy pixels is reconstructed from the row's stored polyline and zone: the row's start is S-1's first bin, at
the first book's centre on the polyline less half a median width, rounded down to S-1's quarter-width bin and offset
by `booksW[0]`; the stretch runs along the polyline from there, and across it spans the zone (the middle half of
the books' height) grown to the full height (twice the zone about its middle). Reported check, not a rule: the share
of `frontNoBox` stretches whose reconstructed polygon is under half inside kept boxes (S-2 measured it on pixels).

### The stop rung and the cause

A book's **stop rung** is its rung; a book is **lost** when it stops below `confirmed`. Each lost book gets **one
primary cause**: the first rule in its rung's list below that holds. Every rule that holds is recorded too, and
reported as "any cause" counts beside the primary ones.

Thresholds (fixed here):

- **dark or low contrast:** crop mean luma, or RMS contrast, below the 5th percentile of the same set's `confirmed`
  boxes (`readers-agree`), from the same feature file: darker or flatter than almost any box the readers did read.
- **outer ring:** Q-1's radial distance above 0.5612 (Q-2's `EDGE_RADIAL`, Q-1's H2 cut).
- **top face:** H-2's `top` share at least 0.15 (H-1's over-select bar) and the largest share other than `front`.
- **occlusion:** at least 25 % of the book's area inside a shelf-talker or blank-card box (F-0f's kinds), or inside a
  kept face-out cover that does not absorb it.
- **face-out piece:** at least 60 % of a kept box's area inside a kept face-out cover (F-0c's absorbed rule).
- **frame cut:** a box with Q-1's `outFrac` above 0; a gap polygon or cover with any corner outside the frame or
  within 1 % of the frame's long side of its edge.
- **no band tile (gaps):** the gap's centre lies in no F-0e detection band polygon grown 12 % of its height above and
  below (F-0e's fine tiles run only along found bands).
- **doubtful box:** box score under Q-2's floor 0.225.

Cause codes (the brief's eight, the catalog pair split in two, plus three residuals marked †):

| code | means | sub-reasons |
|---|---|---|
| `frame-edge` | the frame cuts the book, or it sits in the lens's outer ring | `cut`, `outer` |
| `tiling-or-side-case` | a detector tile edge cut the box, the book stands in an angled side case (H-2 `ownPlane`), or no fine tile ran over the gap | `tile-cut`, `side-case`, `no-band-tile` |
| `shape-filter` | a face-out book: the spine path's shape filter drops its cover box, and at most a piece of it is boxed | `face-out`, `face-out-piece`, `dropped-shape` |
| `top-face` | the box runs onto the book's top face (over-selection) | — |
| `dark-or-low-contrast` | the crop is darker or flatter than almost any read box | `dark`, `low-contrast` |
| `occlusion` | a shelf-talker, card or face-out cover stands in front | `talker`, `cover` |
| `catalog-gap` | the text is readable, but no work in the catalog passes the bar | `open-catalog` (catalog-v2 passes), `no-local-catalog`, `inventory` (yardstick) |
| `misread` | text was read but garbled, or two readers name different works | `garbled`, `disagree` |
| `single-reader` | one reader passes the bar and no second agrees | — |
| `lying-flat` † | the box lies flat (Q-1: spines lying flat almost never confirm; reader orientation) | — |
| `doubtful-box` † | no text and a box score under the floor: probably not a book (Q-1) | — |
| `unattributed` † | no rule holds | — |

Rules per stop rung, first hit is primary:

- **`seen`, a gap book:** `frame-edge` (`cut`) → `occlusion` → `shape-filter` (`dropped-shape`: at least 25 % of the
  gap inside a box the filter dropped for its shape, or a cover the kinds rejected) → `tiling-or-side-case`
  (`no-band-tile`) → `dark-or-low-contrast` (both nearest kept boxes along the row meet the box rule) → `frame-edge`
  (`outer`, the gap's centre) → `unattributed`.
- **`seen`, a face-out cover:** `frame-edge` (`cut`) → `shape-filter` (`face-out`).
- **`spine-found`:** `frame-edge` (`cut`) → `tiling-or-side-case` (`tile-cut`, then `side-case`) → `occlusion` →
  `shape-filter` (`face-out-piece`) → `top-face` → `lying-flat` → `dark-or-low-contrast` → `frame-edge` (`outer`) →
  `doubtful-box` → `unattributed`.
- **`text-present`:** `catalog-gap` (`open-catalog`: two readers agree on one work on catalog-v2 under F-0's
  unchanged `decide` and bar; `pilot-000` only) → the capture list as for `spine-found`, up to `frame-edge`
  (`outer`) → `misread` (`garbled`).
- **`text-read`:** `catalog-gap` (`open-catalog` when at least one reader's top candidate on catalog-v2 passes F-0's
  bar, else `no-local-catalog`; on the yardstick `inventory`: its catalog holds every annotated book, so there the
  cell is a retrieval miss, not a missing record).
- **`matched`:** F-0's reason `single-reader` → `single-reader`; `readers-disagree` → `misread` (`disagree`).

The capture causes precede the text causes at `spine-found` and `text-present` because they say why the readers had
nothing usable; at `text-read` and `matched` the text was usable and the stop is the catalog or the accept rule.

**catalog-v2 re-decision (`pilot-000`).** For boxes stopping at `text-present` or `text-read` only, F-0's `decide`
runs unchanged on C-5's `catalog-v2.sqlite` with the same cached readings (the shipped crop), as C-5's evaluation
did. Cached privately by the catalog file's size and modification time. Catalog-v2 has more namesakes than v1 (C-5),
so `open-catalog` is evidence that an outside record explains the text, not proof of the book.

### Ranking measure

**Books lost per primary cause**, summed over the set, with a 95 % photo-cluster bootstrap interval (2,000 draws,
seed 1) on that count; causes are ranked by the point estimate, and the share of all lost books is given beside it.
The rung × cause table carries the same counts. Overlapping intervals are said to be a tie, not ranked apart.

### Splits (every count also split by)

- **elevation:** H-1's strata from the box's `elevationDeg` (below under −10°, level ±10°, above over 10°); a gap
  takes its row's elevation, a cover the elevation of its nearest kept box;
- **case:** `main` or `side` (H-2 `ownPlane`; a gap's row is never a side case, since S-1 skips them);
- **frame position:** `cut` (frame cut, as above), `outer` (outer ring), `centre`;
- **S-1 row:** the row's place among the photo's S-1 rows from the top (0, 1, 2, …, `6+`), by the mean height of
  its polyline; `none` for a book in no S-1 row (a side case, a band too short for a frame).

### Also reported

- Books per photo by stop rung; the reconstruction check above; any-cause counts; the doubtful boxes apart.
- **Yardstick reference:** annotated books, distinct annotated works accepted, and their difference with an
  interval. The yardstick's annotations carry no positions, so annotated books are not given rungs; this is the
  scale its box-level audit should be read against.

### Private outputs (the data root's `private/q3/<set>/`, never in the repository)

- `books.jsonl`: one line per book: id (box id, or photo plus row and stretch, or photo plus cover), kind
  (`box`, `gap`, `face-out`), stop rung, primary cause and sub-reason, every cause that held, and the splits.
- `v2.jsonl`: the catalog-v2 re-decision per box.
- `renders/index.html`: the still study. Its first section is the owner's labelling-gaps example (matched to its
  photo by `helpers/label/match_examples.py`, as F-0g, F-0h and F-0i did), drawn with each book's stop rung and
  primary cause; then the photos where the five largest causes lose most books.

The repository gets aggregates only: counts, shares and intervals, never an id, a title, a reading or a position.

## Findings (run 2026-11-04, after the pre-registration above)

Aggregates are in [`metrics.json`](metrics.json); the tables below the marker are generated by
`src/eval/q3-cli.ts analyse`. The two sets are reported apart (OC35). `pilot-000` figures are machine agreement,
never accuracy (INV-17). Every interval is a 95 % photo-cluster bootstrap. After the full run one aggregation bug was
fixed: the yardstick reference counted every image in the dataset's annotation file, not only the 40 sampled; only
that reference changed. One reported line was added after the run (gap books at a row's end, finding 6); no rule
moved.

**This is a baseline to re-run, not a final number.** The box set is F-0i's partition; F-0m, F-0k and NB-3 change it
again, and the audit is to be re-run on each new box set.

1. **Most books a person can see on `pilot-000` are lost, and most of them were boxed.**
   - The audit counts **6,068 books (5,058–7,130)**, about 196 a photo: 5,761 kept boxes, 225 books in row gaps
     with no box and 82 face-out covers the default does not box.
   - **5,244 (86 %) stop below `confirmed`.** Only 307 (236–384) stop at `seen` (never boxed). So the owner's
     "never labelled" books are mostly boxes that stop at a reading or matching rung, not missed detections.
   - The `seen` count is a lower bound (§ Limits).
2. **Top five causes on `pilot-000`, by books lost (primary cause):**

   | rank | cause | books lost | share | what it mostly is |
   |---:|---|---:|---:|---|
   | 1 | `catalog-gap` | 1,358 (1,001–1,748) | 25.9 % | readable text no v1 work passes; catalog-v2 has a passing record for 576 |
   | 2 | `frame-edge` | 877 (760–995) | 16.7 % | 634 cut by the frame, 243 in the lens's outer ring |
   | 3 | `single-reader` | 741 (511–974) | 14.1 % | one reader passes the bar and no second agrees |
   | 4 | `tiling-or-side-case` | 638 (437–885) | 12.2 % | 493 in angled side cases, 144 cut by a tile edge |
   | 5 | `top-face` | 634 (438–840) | 12.1 % | every one below eye level |

   - `catalog-gap` is clearly first: its interval clears the next.
   - Ranks 2–5 overlap, so they are a tie. `misread` follows (435: 374 garbled, 61 readers disagreeing). Then
     come `dark-or-low-contrast` (220) and `shape-filter` (116: face-out covers and their pieces).
   - `occlusion` (14) and `lying-flat` (11) are small.
   - The residuals are small too: `unattributed` 114 and `doubtful-box` 86.
3. **The capture causes concentrate where the owner's renders showed them.**
   - **Side cases:** they hold 1,099 books and lose 93 % of them, against 85 % in the main case.
   - **Frame cuts:** books the frame cuts lose 98 %.
   - **Top face:** all of it lies below eye level and grows down the case. It takes 0–2 books in the top two S-1
     rows and 182–192 in rows 5 and 6+.
   - **Bottom rows:** they lose most (rows 4 to 6+: 91–92 %, against 76 % in row 2).
4. **Most lost books stop at `text-present` (1,579) or `text-read` (1,320).** The readers saw text there.
   - At `text-present` the capture causes still explain most stops. They are mainly frame edge 398, top face 347,
     side case or tiling 289 and dark or flat 115. That leaves 374 as garbled text with no measured capture cause.
   - At `text-read` the stop is the catalog by definition. Catalog-v2 (ISFDB plus Open Library) passes at least one
     reader on 576 of these. On v2, two readers agree on 38 more `text-present` boxes.
5. **The yardstick (PROXY) ranks the same causes near the top, in a different order.**
   - The first two are `catalog-gap` 278 (35 %) and `single-reader` 135. Then come `frame-edge` 86,
     `tiling-or-side-case` 68 and `dark-or-low-contrast` 55.
   - Its catalog is the closed inventory, so its `catalog-gap` is mostly retrieval misses and unannotated books, not
     missing records.
   - Its reference: of 653 annotated inventory books in the 40 images, 250 distinct works are accepted. That leaves
     **403 (310–510) annotated books not found**.
6. **Some gap books are probably not books.**
   - 60 of the 225 `pilot-000` gap books lie within one width of their row's end. On the owner's example those
     stretches are the case's uprights beside a leaning end book, not missing books.
   - The rule counts them, as pre-registered; read the `seen` count with that in mind.
   - Rebuilding a gap's place from S-2's arc lengths is approximate: 49 % of the rebuilt polygons are under half
     inside kept boxes (S-2 measured all on pixels), at best 63 % with a half-width shift. So gap causes that depend
     on position (frame cut, occlusion, no band tile) are approximate. They touch 225 of 6,068 books.

## Cards this points to (ranked by books lost on `pilot-000`)

1. **Catalog: adopt an open catalog behind the guards.** This is C-5's catalog-v2 with C-6's lookalike guard and
   C-7's counter-evidence, plus C-8's rare-words-first retrieval (running). Up to 1,358 books: 576 where v2 already
   has a passing record, and 782 with readable text that no local catalog explains (C-4's LoC remainder, or text
   that agrees across readers but is still wrong). OC20's trigger already fired (C-4).
2. **Capture and stitching across stills** (877, frame edge). A book the frame cuts is usually whole in a
   neighbouring still. The cards: overlapping capture guidance (K-0, U-2's sweep), and a card to merge overlapping
   stills' books, which Q-0 §2 left unplanned. The outer ring (243) is Q-5's angle-and-glare signal.
3. **A second independent reader** (741, single reader). This is F-0j's per-book extraction (running): field reads
   on line crops, FR2's measured second reading for hard type. Qwen passes alone on about half its passes.
   Adjudication (I-4) is the paid fallback.
4. **Side cases** (493) **and tile cuts** (144). Detect side-case bands in their own rectified frame (H-1's
   `ownPlane`) rather than as part of the main case's bands. This is a new card; F-0e's tiling never targeted angled
   cases.
5. **Top-face over-selection below eye level** (634). F-0m (ends, queued) is the direct card. H-2's `face3d` trim
   failed its keep rule as a crop, so F-0m should cut the box end, not re-crop.
6. **Garbled text** (374) **and dark or flat crops** (220). These are F-0j's line crops and Q-4's resolution
   thresholds, and F-R3's representations (Retinex, contrast stretch) as a reader input.
7. **Face-out books and missed detections** (`shape-filter` 116, the `seen` books 307). The cards are F-0k
   (missed-book recovery, queued) and F-0c's cover pass with a front-layer rule (F-0i finding 7).

## Limits

- **Machine agreement, never accuracy** (INV-17). A `confirmed` book can be wrong, and the counts of books a person
  can see come from boxes, gaps and covers, never from a person counting.
- **`seen` is a lower bound.** Rows with no box, side cases (S-1 skips them), books past a row's last box and
  background cases are not counted. The `not-seen` rung is empty on stills by construction.
- **One primary cause per book.** The order is pre-registered, so a book with several causes counts under the
  first. The "any cause" column shows how often each cause held at all; `frame-edge` held for 1,670 books and
  `misread` for 1,640.
- **`open-catalog` is evidence, not proof.** Catalog-v2 carries more namesakes than v1 (C-5), so a passing v2
  record says an outside record explains the text, not that it names the book.
- **The dark bar is relative.** It is the 5th percentile of each set's own confirmed boxes, so it is set-relative,
  not an absolute exposure threshold.

<!-- generated by src/eval/q3-cli.ts analyse: edit above this line -->

## pilot-000 (real use (OC35): machine agreement, never accuracy (INV-17))

31 photos. **6068 (5058–7130.1) books** a person can see by the pre-registered count (195.7 a photo): 5761 kept boxes, 225 in row gaps with no box, 82 face-out covers the default does not box. **Lost (below `confirmed`): 5244 (4427.9–6061.1), 86.4 %.** Counts with 95 % photo-cluster bootstrap intervals (2000 draws).

### Books by stop rung

| rung | books |
|---|---:|
| `not-seen` | 0 (0–0) |
| `seen` | 307 (236–384) |
| `spine-found` | 1236 (957.8–1553) |
| `text-present` | 1579 (1266–1879) |
| `text-read` | 1320 (972.9–1709) |
| `matched` | 802 (559–1057) |
| `confirmed` | 824 (500–1199) |

### Causes ranked by books lost (primary cause)

| rank | cause | books lost | share of lost | any cause (held at all) | tie with the next? |
|---:|---|---:|---:|---:|---|
| 1 | `catalog-gap` | 1358 (1001–1748.1) | 25.9 % | 1358 | no |
| 2 | `frame-edge` | 877 (760–995) | 16.7 % | 1670 | yes |
| 3 | `single-reader` | 741 (511–974) | 14.1 % | 741 | yes |
| 4 | `tiling-or-side-case` | 638 (437–885) | 12.2 % | 820 | yes |
| 5 | `top-face` | 634 (438–840) | 12.1 % | 997 | yes |
| 6 | `misread` | 435 (331–545) | 8.3 % | 1640 | no |
| 7 | `dark-or-low-contrast` | 220 (147–305) | 4.2 % | 563 | yes |
| 8 | `shape-filter` | 116 (77–158) | 2.2 % | 199 | yes |
| 9 | `unattributed` † | 114 (78–151) | 2.2 % | 1461 | yes |
| 10 | `doubtful-box` † | 86 (44–134) | 1.6 % | 674 | no |
| 11 | `occlusion` | 14 (6–24) | 0.3 % | 32 | yes |
| 12 | `lying-flat` | 11 (5–18) | 0.2 % | 68 | — |

† a residual of the audit, not a cause a card works on.

### Rung × primary cause (books)

| rung | `frame-edge` | `tiling-or-side-case` | `shape-filter` | `top-face` | `dark-or-low-contrast` | `occlusion` | `catalog-gap` | `misread` | `single-reader` | `lying-flat` | `doubtful-box` | `unattributed` |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `seen` | 149 | 1 | 92 | 0 | 5 | 5 | 0 | 0 | 0 | 0 | 0 | 55 |
| `spine-found` | 330 | 348 | 18 | 287 | 100 | 2 | 0 | 0 | 0 | 6 | 86 | 59 |
| `text-present` | 398 | 289 | 6 | 347 | 115 | 7 | 38 | 374 | 0 | 5 | 0 | 0 |
| `text-read` | 0 | 0 | 0 | 0 | 0 | 0 | 1320 | 0 | 0 | 0 | 0 | 0 |
| `matched` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 61 | 741 | 0 | 0 | 0 |

### Sub-reasons of the primary cause (books)

| cause | sub-reasons |
|---|---|
| `frame-edge` | cut 634, outer 243 |
| `tiling-or-side-case` | side-case 493, tile-cut 144, no-band-tile 1 |
| `shape-filter` | dropped-shape 51, face-out 41, face-out-piece 24 |
| `top-face` | — 634 |
| `dark-or-low-contrast` | low-contrast 120, dark 100 |
| `occlusion` | cover 14 |
| `catalog-gap` | no-local-catalog 782, open-catalog 576 |
| `misread` | garbled 374, disagree 61 |
| `single-reader` | — 741 |
| `lying-flat` | — 11 |
| `doubtful-box` | — 86 |
| `unattributed` | — 114 |

### Split by elevation

| elevation | books | lost | lost share | `catalog-gap` | `frame-edge` | `single-reader` | `tiling-or-side-case` | `top-face` | `misread` |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| below | 3318 | 2957 | 89.1 % | 588 | 418 | 426 | 422 | 634 | 174 |
| level | 1211 | 1013 | 83.6 % | 414 | 131 | 118 | 91 | 0 | 144 |
| above | 1539 | 1274 | 82.8 % | 356 | 328 | 197 | 125 | 0 | 117 |

### Split by case

| case | books | lost | lost share | `catalog-gap` | `frame-edge` | `single-reader` | `tiling-or-side-case` | `top-face` | `misread` |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| main | 4969 | 4220 | 84.9 % | 1234 | 696 | 605 | 74 | 634 | 423 |
| side | 1099 | 1024 | 93.2 % | 124 | 181 | 136 | 564 | 0 | 12 |

### Split by frame position

| frame | books | lost | lost share | `catalog-gap` | `frame-edge` | `single-reader` | `tiling-or-side-case` | `top-face` | `misread` |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| centre | 3523 | 2911 | 82.6 % | 975 | 0 | 484 | 312 | 311 | 414 |
| outer | 1758 | 1562 | 88.9 % | 315 | 243 | 194 | 326 | 323 | 15 |
| cut | 787 | 771 | 98 % | 68 | 634 | 63 | 0 | 0 | 6 |

### Split by S-1 row (from the top)

| row | books | lost | lost share | `catalog-gap` | `frame-edge` | `single-reader` | `tiling-or-side-case` | `top-face` | `misread` |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 1128 | 1007 | 89.3 % | 298 | 344 | 113 | 80 | 0 | 74 |
| 1 | 1054 | 872 | 82.7 % | 351 | 99 | 124 | 81 | 2 | 115 |
| 2 | 872 | 664 | 76.1 % | 206 | 69 | 111 | 59 | 20 | 113 |
| 3 | 825 | 688 | 83.4 % | 164 | 87 | 124 | 97 | 93 | 59 |
| 4 | 590 | 535 | 90.7 % | 134 | 72 | 59 | 71 | 106 | 29 |
| 5 | 619 | 571 | 92.2 % | 101 | 38 | 94 | 79 | 192 | 19 |
| 6+ | 677 | 623 | 92 % | 74 | 71 | 86 | 130 | 182 | 17 |
| none | 303 | 284 | 93.7 % | 30 | 97 | 30 | 41 | 39 | 9 |

### Reported, not in a rule

| measure | value |
|---|---|
| dark bar (p5 of confirmed boxes): luma / RMS contrast | 57.4 / 39.7 |
| gap reconstruction: `frontNoBox` stretches whose rebuilt polygon is under half inside kept boxes | 75 of 153 (49 %) |
| gap books within one width of their row's end (in the headline; on the owner's example these were the case's uprights) | 60 of 225 |
| apart: S-2 `headroomFrontNoBox` regions | 25 |
| apart: `cover`-dominant outline gaps under half in any box (books by the gap rule) | 44 (59) |
| catalog-v2 re-decision: boxes / v1 decisions reproduced | 2923 / 100 % |

## yardstick (PROXY (library shelves): Library Dataset sample, box arm B2; confirmed = accepted and annotated in the image)

40 photos. **1077 (893–1276) books** a person can see by the pre-registered count (26.9 a photo): 1040 kept boxes, 24 in row gaps with no box, 13 face-out covers the default does not box. **Lost (below `confirmed`): 799 (625–985), 74.2 %.** Counts with 95 % photo-cluster bootstrap intervals (2000 draws).

### Books by stop rung

| rung | books |
|---|---:|
| `not-seen` | 0 (0–0) |
| `seen` | 37 (19–58) |
| `spine-found` | 259 (176–354) |
| `text-present` | 89 (56–127) |
| `text-read` | 278 (210–354) |
| `matched` | 136 (104–172) |
| `confirmed` | 278 (211–352) |

### Causes ranked by books lost (primary cause)

| rank | cause | books lost | share of lost | any cause (held at all) | tie with the next? |
|---:|---|---:|---:|---:|---|
| 1 | `catalog-gap` | 278 (210–351) | 34.8 % | 278 | no |
| 2 | `single-reader` | 135 (104–170) | 16.9 % | 135 | yes |
| 3 | `frame-edge` | 86 (56–123) | 10.8 % | 162 | yes |
| 4 | `tiling-or-side-case` | 68 (47–92) | 8.5 % | 73 | yes |
| 5 | `dark-or-low-contrast` | 55 (34–80) | 6.9 % | 94 | yes |
| 6 | `unattributed` † | 41 (20–66) | 5.1 % | 283 | yes |
| 7 | `doubtful-box` † | 37 (13–68) | 4.6 % | 167 | yes |
| 8 | `misread` | 34 (19–51) | 4.3 % | 90 | yes |
| 9 | `top-face` | 24 (3–59) | 3 % | 35 | yes |
| 10 | `shape-filter` | 19 (9–32) | 2.4 % | 26 | yes |
| 11 | `lying-flat` | 19 (5–39) | 2.4 % | 43 | yes |
| 12 | `occlusion` | 3 (0–9.1) | 0.4 % | 5 | — |

† a residual of the audit, not a cause a card works on.

### Rung × primary cause (books)

| rung | `frame-edge` | `tiling-or-side-case` | `shape-filter` | `top-face` | `dark-or-low-contrast` | `occlusion` | `catalog-gap` | `misread` | `single-reader` | `lying-flat` | `doubtful-box` | `unattributed` |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `seen` | 3 | 0 | 13 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 19 |
| `spine-found` | 52 | 50 | 6 | 21 | 52 | 1 | 0 | 0 | 0 | 18 | 37 | 22 |
| `text-present` | 31 | 18 | 0 | 3 | 3 | 0 | 0 | 33 | 0 | 1 | 0 | 0 |
| `text-read` | 0 | 0 | 0 | 0 | 0 | 0 | 278 | 0 | 0 | 0 | 0 | 0 |
| `matched` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 135 | 0 | 0 | 0 |

### Sub-reasons of the primary cause (books)

| cause | sub-reasons |
|---|---|
| `frame-edge` | outer 52, cut 34 |
| `tiling-or-side-case` | side-case 47, tile-cut 21 |
| `shape-filter` | face-out 10, face-out-piece 6, dropped-shape 3 |
| `top-face` | — 24 |
| `dark-or-low-contrast` | low-contrast 44, dark 11 |
| `occlusion` | cover 3 |
| `catalog-gap` | inventory 278 |
| `misread` | garbled 33, disagree 1 |
| `single-reader` | — 135 |
| `lying-flat` | — 19 |
| `doubtful-box` | — 37 |
| `unattributed` | — 41 |

### Split by elevation

| elevation | books | lost | lost share | `catalog-gap` | `single-reader` | `frame-edge` | `tiling-or-side-case` | `dark-or-low-contrast` | `misread` |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| below | 390 | 281 | 72.1 % | 109 | 59 | 26 | 23 | 14 | 12 |
| level | 616 | 451 | 73.2 % | 146 | 70 | 52 | 41 | 36 | 19 |
| above | 71 | 67 | 94.4 % | 23 | 6 | 8 | 4 | 5 | 3 |

### Split by case

| case | books | lost | lost share | `catalog-gap` | `single-reader` | `frame-edge` | `tiling-or-side-case` | `dark-or-low-contrast` | `misread` |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| main | 1005 | 731 | 72.7 % | 268 | 132 | 83 | 16 | 55 | 34 |
| side | 72 | 68 | 94.4 % | 10 | 3 | 3 | 52 | 0 | 0 |

### Split by frame position

| frame | books | lost | lost share | `catalog-gap` | `single-reader` | `frame-edge` | `tiling-or-side-case` | `dark-or-low-contrast` | `misread` |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| centre | 781 | 546 | 69.9 % | 224 | 100 | 0 | 30 | 31 | 33 |
| outer | 214 | 188 | 87.9 % | 40 | 18 | 52 | 38 | 24 | 1 |
| cut | 82 | 65 | 79.3 % | 14 | 17 | 34 | 0 | 0 | 0 |

### Split by S-1 row (from the top)

| row | books | lost | lost share | `catalog-gap` | `single-reader` | `frame-edge` | `tiling-or-side-case` | `dark-or-low-contrast` | `misread` |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 778 | 558 | 71.7 % | 192 | 92 | 58 | 38 | 48 | 22 |
| 1 | 182 | 143 | 78.6 % | 57 | 21 | 9 | 14 | 6 | 8 |
| 2 | 14 | 14 | 100 % | 2 | 5 | 7 | 0 | 0 | 0 |
| none | 103 | 84 | 81.6 % | 27 | 17 | 12 | 16 | 1 | 4 |

### Reported, not in a rule

| measure | value |
|---|---|
| dark bar (p5 of confirmed boxes): luma / RMS contrast | 61.8 / 27.2 |
| gap reconstruction: `frontNoBox` stretches whose rebuilt polygon is under half inside kept boxes | 12 of 14 (85.7 %) |
| gap books within one width of their row's end (in the headline; on the owner's example these were the case's uprights) | 4 of 24 |
| apart: S-2 `headroomFrontNoBox` regions | 6 |
| apart: `cover`-dominant outline gaps under half in any box (books by the gap rule) | 10 (16) |

## Yardstick reference (annotated books; PROXY)

40 images, 653 annotated books in the inventory, 250 distinct annotated works accepted (38.3 %); **403 (310–510) annotated books not found**. Annotations carry no positions, so these books get no rung.
