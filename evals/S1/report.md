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
