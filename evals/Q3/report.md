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
