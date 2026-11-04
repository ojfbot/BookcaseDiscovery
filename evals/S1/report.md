# S1: shelf structure and voids (S-1)

## Pre-registration (committed before the first full run)

Fixed 2026-11-03, before any full-set run of the shelf step. Nothing below is changed after seeing a full result;
any change is logged as a deviation in `implementation-notes.md`, and the report says which figures it touches.

**Question.** From H-2's cached point maps, normals and band frames, can each shelf row's planes be fitted: the
board's top, the back panel and the lip (the board's front edge)? Where are the voids, the stretches of a row with no
book? Do the planes bound book sizes and the metric scale? And does a geometric test, `on-lip`, catch shelf labels
that F-0f's text filter misses without removing books?

**Sets, never merged (OC35).**

- **`pilot-000`**: 31 real-use photos, F-0e's default `bands+strips` boxes, Q-2b's SAM 2.1 outlines. Every figure is
  **machine agreement, never accuracy** (INV-17). It is a dev set (OC11).
- **Yardstick (PROXY)**: the 40-image Library Dataset sample with F-0's B2 boxes. It has no outlines, so boxes stand
  in. Evaluation only: never trained or tuned on.

No hand labels (OC36). Nothing is trained. Both sets use the shipped not-a-book filter (F-0c's shape rules, F-0f's
shelf-label rules, cover pass off) to decide which boxes are books.

**Inputs.** The depth stage is read through `helpers/depth/stage.py` with H-2's cache and options, so its keys
decide what is reused (all hits): MoGe-2 ViT-L normal at revision `cb0e8bb`, 2048 px long side, EXIF field of view
where the working copy keeps a full frame. Each band's frame (spine-plane normal n_f, up u, side s) is H-2's, as are
the class maps.

**Looked at before fixing the rules (disclosed).** The step was developed on the first six `pilot-000` photos in the
input order, as overlays: planes, voids and candidate on-lip boxes. That look changed four things:

- the row now stops at its books' ends unless the stretch beyond is behind (the first draft ran onto the case's
  uprights);
- books off the row's Theil-Sen line are dropped from its polyline (a side case's books pulled it across);
- the board-top level is the inliers' median height, not the plane offset;
- the on-lip zone was narrowed from ±4 cm about the lip to ±1 cm, and boxes cut by the frame and upright boxes were
  excluded. Frame-cut spine ends just under a lip had passed the wider zone.

A run over all 31 photos was started once by mistake during development and stopped before any of its output was
read. No yardstick photo was looked at.

### Part 1: shelf planes

For each band with at least three book boxes on its own frame (not an `ownPlane` side case) and at least three with
`front` pixels, `helpers/shelf/shelf.py` measures:

- the spine-plane offset c, the median n_f . P of their `front` pixels;
- the books' base b0 and top bt, the medians over books of each book's p5 and p95 of u . P;
- the row's side extent, p2–p98 of s . P.

Candidates are valid map pixels outside every book outline (or box), within the side extent ±5 cm, and from 60 cm
behind to 30 cm in front of the spine plane:

| plane | normal within 30° of | height (u . P) | depth |
|---|---|---|---|
| board top | u | b0 − 6 cm to b0 + 4 cm | — |
| lip | n_f | b0 − 8 cm to b0 + 1 cm | not more than 3 cm behind c |
| back panel | n_f | b0 to bt + 10 cm | more than 8 cm behind c (H-1's `behind`) |

**Fit.** RANSAC: 200 three-point draws on at most 20,000 candidates, a normal within 20° of the prior, inliers within
1.5 cm, then two SVD refits on the inliers.

**Found** when at least 150 map pixels are inliers and they span at least 20 % of the row's side extent (5 % for the
back panel, which shows only in gaps and above the books).

**Elevation** is the median of the band's boxes' `elevationDeg`, in H-1's strata: below is under −10°, level is
±10°, above is over 10°.

**Measures, per set:** the share of rows with each plane found, overall and by elevation, with 95 % photo-cluster
bootstrap intervals (2,000 draws, seed 1). Also each plane's inlier RMS (median).

**Expected** (*hypothesis*, not a rule):

- board tops mostly below eye level, where the camera sees them;
- lips at every elevation;
- back panels where the books leave them visible.

### Part 2: voids

The unit is Q-0's coverage segment (`docs/capture/coverage.md` §2). Position is arc length along the polyline
through the row's book centres, in median spine widths (`gaps.medianWidth`); a coverage segment is two of them. No
new unit.

- **Polyline.** It runs through the book centres sorted along the band and is smoothed across by a running median
  of five. Books more than half a median book height off the centres' Theil-Sen line are left out. It is extended
  straight at both ends.
- **Zone.** The middle half of the books' height about the polyline.
- **Bins.** A quarter of a width each. A bin is **uncovered** when under half its zone pixels are inside a kept
  book's outline: Q-2b's on `pilot-000`, the box on the yardstick (and for `pilot-000` boxes without one).
- **Row extent.** The books' own extent. It grows past either end only through bins that are uncovered and mostly
  `behind`, and the first bin that is not ends it.
- **Candidate void.** A run of uncovered bins at least half a width long (F-0's gap test).
- **Void.** A candidate where at least half its uncovered valid pixels are `behind`: faces.py's classify with the
  row's frame, i.e. front-facing and more than 8 cm behind the spine plane, so the back panel shows.
- **Disagreements.**
  - `outline-gap`: a candidate that is not behind. Its dominant class is reported: `front` is a book or a book's
    part with no outline; `cover` is a leaning book or the case's side.
  - `behind-under-outline`: a run of at least half a width of covered bins whose covered pixels are mostly behind,
    i.e. an outline over a void.

**Measures, per set:**

- **void share per row** (void length over row length), its distribution, and the pooled share with a photo
  bootstrap;
- interior against end voids;
- the outline-gap share of uncovered length, with its dominant classes;
- behind-under-outline length per row;
- the share of behind length that outlines leave uncovered;
- per row, the Spearman correlation of void share with F-0's gap share (`bands[].gap / span`), a cross-check: F-0
  sees interior gaps only.

### Part 3: book-size bounds and metric scale

- **Level** of a row: the board top's inliers' median height if found, else the lip's top (p95), else b0.
- **Board pitch.**
  - Pair rows within one photo whose spine-plane normals are within 10° and whose side extents overlap by at least
    half the narrower. Each row is paired with the nearest row above it, and pairs 10–60 cm apart are kept.
  - The pitch is the upper row's level minus the lower row's, reported by the weaker source (board < lip < base).
  - The pitch is the **height ceiling** of the lower row's books.
  - **Measure:** the share of those books (kept, H-2 `heightM`) taller than the ceiling, and the median ratio of
    book height to ceiling.
- **Board depth.** Where lip and back panel are both found: the median n_f . P of the lip's inliers minus the back
  panel's. It is the **depth ceiling**.
  - **Measure:** the share of the row's books whose H-2 depth was `seen` (not borrowed or default) and exceeds it.
- **Scale (stays *hypothesis* unless something verifies it).**
  - **Standard-shelf assumption** (*snippet*: store and library shelving runs 9–12 in deep and is spaced about
    11–14 in): clear depth 0.23–0.31 m, pitch 0.28–0.36 m.
  - The **implied scale** is the range's midpoint over the measured median, per set, for depth and pitch apart.
  - The two scales are compared with each other, and with:
    - H-1's shortfall: seen book depth, median 8.2 cm against 13–24 cm;
    - spine heights (H-2 `heightM`) against the known ranges: mass-market about 17–18 cm, trade 20–23 cm,
      hardcover 23–25 cm;
    - **page counts where already available.** Confirmed `pilot-000` works (`isfdb:<id>`) are joined to ISFDB
      staging's `pubs.pub_pages` through `pub_content`, using the median page count over the work's publications.
      The slope of H-2 `widthM` on pages in mm a page (Theil-Sen) is compared with paper at about 0.05–0.10 mm a
      page (*snippet*).
  - None of these verifies scale. They can only agree or disagree.

### Part 4: the geometric label test `on-lip` (a post step, `src/eval/s1.ts`)

A box the shipped kinds keep (a `spine`, or a kept `face-out` cover in F-0c's cover arm) becomes `not-a-book`,
sub-reason **`on-lip`**, when all of these hold for the row whose lip face holds most of its pixels:

1. that row's lip is found, at most 8 cm tall (inliers p5–p95), and its top within 3 cm of the row's board-top
   level;
2. at least 60 % of the box's valid map pixels lie on the lip's face: height from the inliers' p5 − 1 cm to
   max(level, p95) + 1 cm, and side within the lip's extent ±5 cm;
3. the median signed distance to the lip plane is at least −1.5 cm (not behind the lip face);
4. the median n_f . P is at least the row's spine plane (in front of the books' faces);
5. the box lies flat (long side more than 45° from vertical, as F-0f's strip rule): the lip face is horizontal;
6. the box is inside the frame, at least 0.5 % of the frame's long side from every edge: a box the frame cuts hides
   its extent.

The constants are `ON_LIP` in `src/eval/s1.ts`, together with shelf.py's zone and plane constants.

**Measures.**

- Boxes removed by sub-reason, on the spine path and on F-0c's kept covers, on both sets.
- **Removed confirmed** (accepted, two readers on one work: a lower bound on books removed) and **removed at
  `text-read`** (an upper hint), from F-0c's cached base decisions and F-0f's cover decisions.
- On `pilot-000`, the 2 × 2 of F-0f's flags against `on-lip` over all spine-path boxes and cover-pass boxes F-0c
  keeps, and the count flagged by neither.
- On the yardstick, against the shipped default: title recall, wrong accepts per image and distinct confirmed works
  per image, by paired image bootstrap. F-0c's cover arm is run with the step on and off, as F-0f did: face-out boxes
  per photo and distinct confirmed works per photo.

**Blind spot check of the new catches (agent, not labels).** The sample:

- the `pilot-000` boxes `on-lip` removes that F-0f does not (all, or 40 drawn with seed 3 if more);
- 20 kept spine-path boxes drawn with seed 3 from those `on-lip` does not flag, whose centre lies within one row
  height of a found lip.

The sample is shuffled. Each box is shown on its photo with 25 % context and no machine output, and judged *a shelf
label, sign, card, strip or part of the shelf: not a book?* (yes, no or unclear). The judgements stay private and
are never used as labels or to tune anything.

**Keep rule.** `on-lip` ships by default only if all three hold:

1. it removes **no confirmed book** on either set, on the spine path or in the cover arm;
2. **it catches labels F-0f misses.** On `pilot-000` it removes at least 3 boxes F-0f does not flag, and at least
   80 % of those judged in the spot check are judged *not a book*;
3. **the yardstick is not hurt:** title recall does not fall and wrong accepts per image do not rise beyond their
   intervals (an interval wholly below, or wholly above, 0 fails), and distinct confirmed works per image do not
   fall beyond theirs.

If any fails, `on-lip` stays off. It stays available as a reported flag, and the default's not-a-book kinds are
unchanged.

### Part 5: prior art (brief)

Two segmenters run on both sets, each at its processor's default size:

- **OneFormer Swin-L on ADE20K** (`shi-labs/oneformer_ade20k_swin_large` @ `4a5bac8`, MIT tag, ungated, 0.9 GB),
  semantic task, classes `shelf` and `bookcase`;
- **SAM 3** (local weights) prompted with `shelf`, all instances above score 0.3 merged.

**Measures, per set:**

- the share of S-1's lip inliers and board-top inliers inside the model's shelf mask (OneFormer: `shelf` ∪
  `bookcase`, also each apart);
- the share of kept book outline (or box) pixels inside it (leakage);
- the share of `on-lip`-removed and F-0f-flagged boxes with at least half their pixels inside it;
- seconds a photo.

**Verdict rule:** a segmenter is *worth a card* as a shelf cue if lip-inlier recall is at least 0.7 and book
leakage at most 0.1 on both sets. Otherwise it is noted and dropped. ADE20K's data terms make this an
evaluation-only use.

### Part 6: private still study

`private/s1/renders/<set>/index.html` under the data root shows, per photo:

- the plane inliers: board top, lip, back panel;
- voids, outline gaps and behind-under-outline stretches;
- row polylines;
- F-0f's and F-0c's flags, and `on-lip` flags.

### Queue rule

If `on-lip` ships, the default not-a-book kinds change. F-0g, Q-2b and H-2 figures then need re-baselining, and the
conductor schedules that.

## Findings (run 2026-11-03, after the pre-registration above)

Aggregates are in [`metrics.json`](metrics.json), and the tables below the marker are generated. The two sets are
reported apart (OC35). `pilot-000` figures are machine agreement, never accuracy (INV-17). Metres are MoGe-2's,
whose scale is unverified.

1. **Lips are found on almost every row, and board tops wherever the camera looks down.**
   - On `pilot-000` (168 rows), the lip is found on 96.4 % of rows (93.8–98.8), at every elevation.
   - The board top is found on 83.0 % of rows below eye level, 58.8 % at eye level and 0 % above, as the geometry
     predicts.
   - The back panel is found on 60.1 % of rows: most at eye level (88.2 %), where the camera sees over the books,
     and fewest above it (30.0 %).
   - The yardstick (48 rows, mostly square-on) agrees: lip 93.8 %, board top 66.7 %, back panel 54.2 %.
   - Inlier RMS is 0.1–0.6 cm. The planes are flat in MoGe's map: they show its smoothness, not the shelf's
     flatness.
2. **Real voids are rare; most uncovered stretches are books without an outline.**
   - On `pilot-000`, 1.2 % of row length (0.4–2.2) is void, and 14.3 % of rows hold one: a bookstore keeps its
     shelves full.
   - Uncovered runs of half a width or more make up 12.2 % of row length, and 90 % of that length is not behind. By
     length, those outline gaps are 72 % `front` (a spine face at the spine plane with no outline: a book Q-2b's
     outline or the detector missed) and 24 % `cover` (a leaning book or the case's side).
   - So an outline gap is a missed book far more often than a void. That suits Q-0's "patchy" places better than F-0's
     gap share does: they correlate with F-0's gap share at Spearman 0.35 on `pilot-000` and 0.60 on the yardstick.
     Confirmed voids correlate only weakly (0.15, 0.14).
   - No void was found at a row's end on either set. Rows stop at the case's upright unless the stretch beyond is
     behind, and none was.
   - **Yardstick caveat:** where a library band takes in a near shelf and books on a further shelf seen through it,
     the far books lie more than 8 cm behind the near spine plane. They then count as `behind`: false voids, and
     `behind-under-outline` at 5.7 % of row length, against 1.3 % on `pilot-000`. The yardstick's void share
     (1.7 %) is inflated by this.
3. **Board pitch bounds book height, and the standard-shelf scale is believable but not verified.**
   - On `pilot-000`, 119 adjacent row pairs give a pitch of 35.6 cm (p50; IQR 33.3–39.3). Only 1.4 % of books are
     taller than their row's ceiling, and a book takes a median 0.72 of it.
   - Board depth, lip to back panel (97 rows), has a median of 31.4 cm. But its lower quartile is 12.7 cm: where
     only part of a back panel shows, the fit can take a nearer surface. 14.2 % of seen book depths exceed it.
   - Against a standard shelf (0.23–0.31 m deep, 0.28–0.36 m pitch: an assumption, not verified), MoGe's metres
     come out long by the same factor both ways. The implied scale is 0.86 from depth and 0.90 from pitch, which
     agree within 5 %. That matches H-1's "metric scale looks 20–25 % high" on one photo.
   - Rescaled, the median spine height falls from 25.5 cm to 21.9–23.0 cm, plausible for a mix of mass-market, trade
     and hardcover books.
   - **H-1's depth shortfall is not a scale error.** Rescaling makes the seen book depth smaller still (8.2 → 7.0–7.3
     cm, against 13–24 cm), so it comes from foreshortening and occlusion, as H-1 supposed.
   - Page counts (722 confirmed boxes, 509 works with an ISFDB count) agree only loosely. Width rises with pages
     (Spearman 0.45), with a Theil-Sen slope of 0.050 mm a page against paper at about 0.05–0.10. The edition on the
     shelf is unknown and its page count is a median over editions, which flattens the slope.
   - The yardstick has only 5 pitch pairs (its photos rarely hold two rows of one case) and 24 board depths, so its
     scale figures (0.80, 0.70) are thin.
   - **So the scale stays *hypothesis*.** Two shelf-based estimates agree with each other and with spine heights, but
     a known reference, LiDAR or multi-view is needed to verify it.
4. **`on-lip` meets its keep rule.**
   - On `pilot-000` it removes 4 spine-path boxes the default keeps, and no kept cover. None was confirmed, and 1 was
     at `text-read`.
   - On the yardstick it removes 2 boxes, none confirmed and none read. Titles, wrong accepts and distinct works
     per image are unchanged.
   - On `pilot-000`, all 4 removed boxes are boxes F-0f does not flag. In the blind spot check, all 4 were judged
     *not a book* (two section strips, a "film reference" strip and a label clip on a shelf edge), and 0 of the 20
     controls were.
   - Against F-0f over every spine-path box and kept cover, `on-lip` also flags 13 of the 31 boxes F-0f flags. The
     rest are shelf-talkers and cards standing above the lip or hanging below it, which the ±1 cm zone leaves to
     F-0f's text rules by design.
   - Viewed after the run (evaluation only): of the 2 yardstick removals, one is a section strip on the lip. The
     other is a box across the bottom ends of two books, a fragment that no reader read. It is not a label, though
     removing it lost nothing.
   - **What this changes:** the default's not-a-book kinds, by 4 boxes in 6,121 on `pilot-000` and 2 in 1,116 on the
     yardstick.
     - The rule is ready as a post step: `applyOnLip` in `src/eval/s1.ts`, after F-0c's and F-0f's kinds.
     - It is **not yet wired into `f0-cli.ts`**, because the default pipeline has no depth stage: `on-lip` needs
       H-2's point map, and `f0.ts` is C-6's while it runs (logged as a deviation).
     - Wiring the depth stage into the default path, then re-baselining F-0g, Q-2b and H-2 on the new kinds, is for
       the conductor to schedule.
5. **Prior art: neither off-the-shelf segmenter is worth a card as a shelf cue.** The pre-registered bar was lip
   recall of at least 0.7 and book leakage of at most 0.1, on both sets.
   - OneFormer's `shelf ∪ bookcase` covers 87 % of S-1's lip inliers on `pilot-000`, with 9.9 % of book pixels
     inside. On the yardstick it covers 28 %: its `bookcase` class takes the whole store case, and library shelving
     is labelled neither way.
   - SAM 3's `shelf` keeps books out (0.7 % and 2.9 %) and finds board tops well (88 %, 96 %). But it covers only
     71 % and 31 % of the lips, and 1 of `on-lip`'s 4 boxes.
   - Cost: 0.6–0.8 s a photo for OneFormer and 1.6 s for SAM 3 on MPS, against 1.7–4.9 s for S-1's own step, which
     runs on the CPU after the cached depth stage.
   - The geometry gives what a mask cannot: the lip as a plane, so "on the lip and in front of the books" can be
     tested at all.
6. **Cost.** The shelf step takes a median 4.9 s a `pilot-000` photo and 1.7 s a yardstick photo, on the CPU,
   reading the depth stage's cache (every photo a cache hit).

## What this does not show

- No box accuracy, and no proof that a found plane is the real board. `pilot-000` has no ground truth. The planes
  were checked by eye on the six dev photos and the still study, not measured.
- The `on-lip` spot check is one agent's judgement on 4 catches and 20 controls, not labels. The rule was shaped on
  six `pilot-000` photos, and its no-harm result is on the same set plus the yardstick.
- Metric scale is not verified, and neither is the standard-shelf assumption (*snippet*).
- Shelf-talkers above or below a lip are left to F-0f by design. A store whose labels are not on the lip gains
  nothing from `on-lip`.

## Private outputs

Everything per photo or box is under the data root's `private/s1/`:

- per set: `inputs.jsonl`, `shelf.jsonl`, the label maps (`maps/`), `flags.jsonl` and `segment.jsonl`;
- the spot-check sheet with its key and judgements (`pilot-000/spot/`);
- the still study (`renders/<set>/index.html`).

None of it is in the repository.

## Re-baseline 2026-11-04 (F-0i + NB-3 on-lip)

Re-run once on RB-1's box set ([evals/RB1](../RB1/report.md)): F-0i's partition (#51) of the shipped default boxes, less NB-3's `on-lip` boxes (#61). Box ids and detection rectangles are unchanged; F-0m (#60) and F-0k (#62) shipped nothing. Before: main 116f4e9, as published. Generated by `node src/eval/rb1-cli.ts summary`; the tables below this section are the re-run's.

What re-ran: `s1-cli.ts shelf` on both sets (planes, voids and lip features from H-2's cached depth stage, CPU), then `analyse`. Rows are covered by RB-1's books, with F-0i's exclusive outlines on `pilot-000` (the yardstick has none: boxes stand in, as before). The `on-lip` test itself still runs on the shipped kinds, as pre-registered.

- The lip is found on 98 % of `pilot-000` rows (96 % before) and the back panel on 62 % (60 %), on RB-1's books and F-0i's outlines. Voids stay rare; their share does not move.
- The `on-lip` figures reproduce exactly (4 and 2 boxes, none confirmed): its test reads box polygons, which F-0i keeps.

**pilot-000** (machine agreement, never accuracy (INV-17))

| figure | as published | RB-1 |
|---|---|---|
| rows | 168 | 167 |
| **void share** (pooled, %) | 1.2 (0.4 to 2.2) | 1.2 (0.4 to 2.2) |
| rows with a void (%) | 14.3 (8.0 to 21.8) | 14.4 (8.1 to 21.9) |
| candidate share (%) | 12.2 (9.9 to 14.8) | 12.4 (10.1 to 15.0) |
| of candidates, `outline-gap` (%) | 90.3 (84.2 to 96.6) | 90.3 (84.3 to 96.5) |
| `on-lip` removes (spine path) | 4 | 4 |
| `on-lip` removes confirmed | 0 | 0 |

**yardstick** (PROXY, library shelves)

| figure | as published | RB-1 |
|---|---|---|
| rows | 48 | 48 |
| void share (pooled, %) | 1.7 (0.6 to 3.2) | 1.8 (0.7 to 3.3) |
| candidate share (%) | 7.4 (4.5 to 10.7) | 7.5 (4.8 to 10.5) |
| `on-lip` removes (spine path) | 2 | 2 |

**`on-lip` keep rule met:** yes → yes (no flip).

<!-- generated by src/eval/s1-cli.ts analyse: edit above this line -->

## pilot-000 (real use (OC35): machine agreement, never accuracy (INV-17))

31 photos; shelf step 4.28 s a photo (p50, CPU, after the cached depth stage).

### Shelf planes

167 rows in 31 photos (skipped: few-books 15, no-frame 19). Share of rows with each plane found; 95 % photo bootstrap.

| rows | n | board top | lip | back panel | all three |
|---|---:|---|---|---|---|
| all | 167 | 58.7 % (52.5–64.7) | 98.2 % (96.0–100.0) | 62.3 % (54.1–70.5) | 41.9 % (36.0–48.8) |
| below eye level | 93 | 83.9 % (76.3–91.0) | 97.9 % (94.6–100.0) | 65.6 % (57.1–74.7) | 54.8 % (46.7–63.8) |
| level eye level | 34 | 58.8 % (42.9–75.0) | 100.0 % (100.0–100.0) | 88.2 % (76.5–97.1) | 55.9 % (40.0–72.7) |
| above eye level | 40 | 0.0 % (0.0–0.0) | 97.5 % (91.7–100.0) | 32.5 % (12.8–52.5) | 0.0 % (0.0–0.0) |

Inlier RMS, p50: board top 0.3 cm, lip 0.5 cm, back panel 0.6 cm.

### Voids (median spine widths; a coverage segment is two)

167 rows; row length p25 / p50 / p75 20.75 / 26.75 / 35.875 widths.

| measure | value |
|---|---|
| **void share** (void length / row length, pooled) | **1.2 % (0.4–2.2)** |
| void share per row, p50 / p90 | 0.0 % / 3.6 % |
| rows with a void | 14.4 % (8.1–21.9) |
| of void length, at a row's end | 0.0 % |
| candidate share (uncovered runs ≥ ½ width / row length) | 12.4 % (10.1–15.0) |
| of candidates, `outline-gap` (not behind) | 90.3 % (84.3–96.5) |
| `outline-gap` by dominant class (length) | front 73 %, cover 22 %, top 3 %, edge 1 %, under 1 %, behind 0 % |
| `behind-under-outline` (length / row length) | 1.5 % (0.7–2.4) |
| voids over behind length | 45.8 % (22.7–68.9) |
| Spearman, void share against F-0's gap share (rows) | 0.1492 (candidates: 0.3415) |

### Book-size bounds and scale (MoGe-2 metres, unverified)

| measure | value |
|---|---|
| board pitch: pairs (photos) | 119 (29) |
| pitch p25 / p50 / p75 | 33.3 cm / 35.4 cm / 38.4 cm |
| pitch p50 by source: board / lip / base | 35.5 cm (54) / 35.5 cm (64) / 18.8 cm (1) |
| books taller than their ceiling (pitch) | 1.0 % (0.4–1.7) |
| book height / ceiling, p50 / p90 | 0.7194 / 0.8392 |
| board depth: rows (photos) | 103 (31) |
| board depth p25 / p50 / p75 | 12.6 cm / 31.3 cm / 34.2 cm |
| seen book depths deeper than the board | 9.3 % (4.2–15.4) |
| implied scale from depth / from pitch (standard shelf) | 0.863 / 0.903 (ratio 0.9557) |
| spine height p50, raw → × depth scale / × pitch scale | 25.5 cm → 22.0 cm / 23.0 cm |
| seen book depth p50, raw → × depth scale / × pitch scale | 8.2 cm → 7.0 cm / 7.4 cm |
| page counts: confirmed boxes (works) with an ISFDB count | 722 (509) |
| width on pages: Theil-Sen slope, Spearman | 0.0498 mm a page, 0.4481 (pages p50 401.75, width p50 4.4 cm) |

### `on-lip`

*Removed confirmed* is a lower bound on real books removed; *at `text-read`* an upper hint.

| boxes | boxes | removed by `on-lip` | removed confirmed | removed at `text-read` |
|---|---:|---:|---:|---:|
| default spine path (cover pass off), after F-0c's and F-0f's flags | 6121 | 4 | 0 | 1 |
| F-0c's kept covers (F-0f on) | 129 | 0 | 0 | 0 |

Against F-0f over every spine-path box and every cover F-0c keeps (6287): both 13, F-0f only 18, **`on-lip` only 4**, neither 6252.

Spine path with `on-lip` against the default: works per photo +0.00 (0.00 to 0.00), confirmed share +0.0 pts (0.0 to 0.0). Cover arm: face-out boxes per photo 4.16 (3.00 to 5.39) → 4.16 (3.00 to 5.39); works per photo +0.00 (0.00 to 0.00).

### Prior art: off-the-shelf shelf masks

| model | mask | lip inliers inside | board-top inliers inside | book pixels inside (leakage) | `on-lip` boxes inside | F-0f boxes inside | s / photo |
|---|---|---|---|---|---:|---:|---:|
| oneformer | shelf | 15.5 % (1.2–32.6) | 19.8 % (1.3–40.4) | 0.3 % (0.0–0.7) | 0/4 | 0/18 | 0.573 |
| oneformer | bookcase | 71.6 % (55.2–84.6) | 73.0 % (53.1–91.2) | 9.6 % (7.5–12.3) | 4/4 | 14/18 | 0.573 |
| oneformer | shelf+bookcase | 87.1 % (84.1–89.5) | 92.8 % (88.2–96.2) | 9.9 % (7.9–12.4) | 4/4 | 14/18 | 0.573 |
| sam3 | shelf | 71.1 % (67.4–74.6) | 87.5 % (82.0–91.1) | 0.7 % (0.4–1.1) | 1/4 | 5/18 | 1.633 |

## yardstick (PROXY (library shelves): Library Dataset sample, box arm B2; confirmed = accepted and annotated in the image)

40 photos; shelf step 1.51 s a photo (p50, CPU, after the cached depth stage).

### Shelf planes

48 rows in 40 photos (skipped: no-frame 15, few-books 7). Share of rows with each plane found; 95 % photo bootstrap.

| rows | n | board top | lip | back panel | all three |
|---|---:|---|---|---|---|
| all | 48 | 66.7 % (54.4–78.7) | 91.7 % (82.6–98.1) | 58.3 % (44.9–72.3) | 39.6 % (27.7–52.3) |
| below eye level | 15 | 80.0 % (57.1–100.0) | 86.7 % (66.7–100.0) | 80.0 % (60.0–100.0) | 53.3 % (28.6–78.6) |
| level eye level | 30 | 66.7 % (48.3–82.8) | 93.3 % (83.3–100.0) | 53.3 % (34.5–71.0) | 36.7 % (17.2–55.2) |
| above eye level | 3 | 0.0 % (0.0–0.0) | 100.0 % (100.0–100.0) | 0.0 % (0.0–0.0) | 0.0 % (0.0–0.0) |

Inlier RMS, p50: board top 0.1 cm, lip 0.5 cm, back panel 0.5 cm.

### Voids (median spine widths; a coverage segment is two)

48 rows; row length p25 / p50 / p75 12.25 / 18.125 / 24.125 widths.

| measure | value |
|---|---|
| **void share** (void length / row length, pooled) | **1.8 % (0.7–3.3)** |
| void share per row, p50 / p90 | 0.0 % / 7.0 % |
| rows with a void | 22.9 % (11.4–35.6) |
| of void length, at a row's end | 0.0 % |
| candidate share (uncovered runs ≥ ½ width / row length) | 7.5 % (4.8–10.5) |
| of candidates, `outline-gap` (not behind) | 75.3 % (62.5–88.4) |
| `outline-gap` by dominant class (length) | front 69 %, cover 22 %, top 4 %, under 4 % |
| `behind-under-outline` (length / row length) | 5.4 % (2.6–9.1) |
| voids over behind length | 22.9 % (13.7–31.8) |
| Spearman, void share against F-0's gap share (rows) | 0.1022 (candidates: 0.5334) |

### Book-size bounds and scale (MoGe-2 metres, unverified)

| measure | value |
|---|---|
| board pitch: pairs (photos) | 5 (4) |
| pitch p25 / p50 / p75 | 19.0 cm / 45.8 cm / 46.8 cm |
| pitch p50 by source: board / lip / base | 19.0 cm (1) / 46.8 cm (3) / 13.6 cm (1) |
| books taller than their ceiling (pitch) | 44.6 % (0.0–87.1) |
| book height / ceiling, p50 / p90 | 0.7203 / 1.8721 |
| board depth: rows (photos) | 25 (23) |
| board depth p25 / p50 / p75 | 24.2 cm / 34.5 cm / 39.9 cm |
| seen book depths deeper than the board | 2.0 % (0.3–5.1) |
| implied scale from depth / from pitch (standard shelf) | 0.783 / 0.699 (ratio 1.1202) |
| spine height p50, raw → × depth scale / × pitch scale | 26.9 cm → 21.1 cm / 18.8 cm |
| seen book depth p50, raw → × depth scale / × pitch scale | 10.5 cm → 8.2 cm / 7.3 cm |

### `on-lip`

*Removed confirmed* is a lower bound on real books removed; *at `text-read`* an upper hint.

| boxes | boxes | removed by `on-lip` | removed confirmed | removed at `text-read` |
|---|---:|---:|---:|---:|
| default spine path (cover pass off), after F-0c's and F-0f's flags | 1116 | 2 | 0 | 0 |
| F-0c's kept covers (F-0f on) | 21 | 0 | 0 | 0 |

Against F-0f over every spine-path box and every cover F-0c keeps (1153): both 2, F-0f only 4, **`on-lip` only 3**, neither 1144.

Spine path with `on-lip` against the default: works per photo +0.00 (0.00 to 0.00), confirmed share +0.0 pts (0.0 to 0.1). Cover arm: face-out boxes per photo 0.53 (0.25 to 0.85) → 0.53 (0.25 to 0.85); works per photo +0.00 (0.00 to 0.00). Yardstick titles: recall +0.0 pts (0.0 to 0.0), precision +0.0 pts (0.0 to 0.0), wrong accepts per image +0.00 (0.00 to 0.00), distinct confirmed works per image +0.00 (0.00 to 0.00).

### Prior art: off-the-shelf shelf masks

| model | mask | lip inliers inside | board-top inliers inside | book pixels inside (leakage) | `on-lip` boxes inside | F-0f boxes inside | s / photo |
|---|---|---|---|---|---:|---:|---:|
| oneformer | shelf | 22.0 % (9.6–38.2) | 36.3 % (16.8–59.2) | 2.0 % (0.9–3.2) | 1/2 | 1/6 | 0.7525 |
| oneformer | bookcase | 6.2 % (1.0–13.7) | 15.9 % (4.5–31.6) | 1.0 % (0.3–1.8) | 0/2 | 0/6 | 0.7525 |
| oneformer | shelf+bookcase | 28.2 % (14.7–46.0) | 52.2 % (32.4–75.7) | 3.0 % (1.9–4.2) | 1/2 | 1/6 | 0.7525 |
| sam3 | shelf | 30.9 % (17.1–49.1) | 95.5 % (93.8–96.8) | 2.9 % (1.6–4.6) | 0/2 | 3/6 | 1.6225 |

## Spot check and verdict

Blind agent spot check (`pilot-000`): `on-lip`'s new catches judged *not a book* 4 of 4 (0 unclear); controls 0 of 20 (0 unclear). One agent's judgement, never labels.

| no confirmed book removed (both sets) | catches labels F-0f misses | yardstick not hurt | `on-lip` keep rule |
|---|---|---|---|
| yes (0) | yes (4 new) | yes | **met: a ready post step, not yet wired into the default pipeline (finding 4)** |
