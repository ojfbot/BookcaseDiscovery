# F0i: instance partition (F-0i)

## Pre-registration (committed before the first full run)

Fixed 2026-11-03, before any full-set run of the gate, the conflict tiles or the resolve step. Nothing below is
changed after seeing a full result; any change is logged as a deviation in `implementation-notes.md`, and the report
says which figures it touches. The design is [`docs/models/instance-boundaries.md`](../../docs/models/instance-boundaries.md)
§5 (F-R1), with F-R3's seam evidence (R3-A, [`docs/models/image-representations.md`](../../docs/models/image-representations.md) §8)
folded in.

**Question.** Can a post-detection pass make every visible pixel belong to at most one book (the owner's rule,
2026-11-03), without losing a book the readers confirm? And does reading the partitioned boxes help the readers?

**Sets, never merged (OC35).**

- **`pilot-000`**: 31 real-use photos, F-0e's default `bands+strips` boxes after the shipped not-a-book filter
  (F-0c's shape rules, F-0f's shelf-label rules, cover pass off: Q-2b's 6,121 kept ids), Q-2b's SAM 2.1 outlines,
  and the readers F-0e cached with F-0's decision on them (H-2's `base-decisions`). Every reader figure is **machine
  agreement, never accuracy** (INV-17). It is a dev set (OC11).
- **Yardstick (PROXY)**: the 40-image Library Dataset sample with F-0's B2 boxes after the same filter (1,116 kept
  ids), F-0b's SAM 2.1 outlines, F-0's cached readers and decisions. *Confirmed* = accepted and annotated in the
  image; *wrong* = accepted, not annotated. Evaluation only: never trained or tuned on.
- **Depth**: H-2's MoGe-2 cache (`moge-2-vitl-normal@cb0e8bb`), looked up by the working copy's SHA-256 as F-R1 did.

No hand labels (OC36). Nothing is trained. Box ids (`photo:index`) are never renumbered: a dropped box keeps its id
with a reason.

**Looked at before fixing the rules (disclosed).** Nothing from a run of this card. The thresholds are F-R1 §5's and
F-R3's, written before any partition existed. The code is debugged on synthetic masks (the tests) and smoke-run on the
first two `pilot-000` photos in input order for crashes only; any threshold change after that is a logged deviation.

### Step 1: instance gate (CPU, no model)

On the rasterised outlines (full working-copy resolution), per photo, every pair sharing at least 1 % of the smaller
mask (F-R1's conflict), with mask IoU and IoM (intersection over the smaller mask):

| rule | test | action |
|---|---|---|
| duplicate | IoU ≥ 0.5, or IoM ≥ 0.85 with an area ratio under 1.3 | drop the lower box score × mask score (pairs by IoU, highest first) |
| merged parent | a parent holding two or more children at IoM ≥ 0.8 whose union covers ≥ 70 % of it | drop the parent (a two-book mask) |
| one child, parent is one spine | one child at IoM ≥ 0.8; the parent's detection-rectangle short side ≤ 1.6 row median widths | drop the child (a label block, a piece) |
| one child, parent is a group | as above, parent wider than 1.6 row median widths | keep the child; the parent becomes its **remainder** (parent minus child), a step 2 member |

- Parents are taken smallest first, so nested chains settle from the inside out. A parent whose children cover under
  70 % is treated as a group (remainder = parent minus the children).
- **Row median width:** the median detection-rectangle short side of the kept boxes whose centre lies in the same
  detection band polygon (the first holding it); boxes in no band take the photo's median.
- **Accepted-work guard (pre-registered so that no book is lost by geometry):** the gate never drops a box that is
  the only box in its photo whose cached decision accepts a given work. For a duplicate, the drop moves to the other
  box when that one is not such a sole acceptor; when both are, neither is dropped and the pair goes to step 2. A
  guarded child stays as a group child; a guarded merged parent stays as a member. The guard reads the cached
  decision's accepted work only, never the yardstick's annotations.
- Physical copies are never collapsed (INV-4): only pixel overlap triggers a rule, so two adjacent identical copies
  with exclusive masks are untouched.

### Step 2: conflict tiles (GPU, SAM 2.1 base-plus)

- **Groups:** connected components of the pairs still in conflict after the gate (post-gate masks; remainders as
  members).
- **Tile frame:** rotated so the members' mean long axis (detection rectangles, sign-aligned) is vertical; covers
  the members' masks, padded across and along by max(32 px, 0.3 photo median widths).
- **Windows:** squares, never squashed. Side S = the tile's width clamped to [301, 602] px, so SAM's 1,024 px input
  is 1.7–3.4 times the photo scale. Along the axis, windows step with 25 % overlap. A tile wider than 602 px is cut
  into across-subgroups of consecutive members (by across position), neighbouring subgroups sharing one member.
- **Prompts per member per window (one joint call per window):** its detection rectangle (a remainder: its own
  minimum-area rectangle) as an axis-aligned box in the rotated window, clipped to it; positive points at the
  distance-transform peak of its **exclusive core** (its mask minus every other member's) in each third of the core's
  length (at most 3, those inside the window); a negative point at each other in-window member's core peak (middle
  third). A member is prompted in a window when its clipped box is at least 4 px each way and at least 1 % of its
  mask lies in the window.
- **Output:** per member per window, SAM's low-resolution logits (multimask off), cached under the data root's
  `private/f0i/<set>/logits/` by a job key (model revision, `partition.py`'s hash, the group's member ids and
  geometry). Logits from overlapping windows are blended with border-distance weights (a linear ramp over 0.15 S).

### Step 3: resolve (CPU)

Only **contested pixels** (claimed by two or more post-gate members of a group) change hands; every other pixel stays
with its single claimant. For each contested pixel, in order:

1. **Depth override:** a pair whose exclusive parts' median depths differ by at least **5 %** of the nearer
   (clearly protruding or receding; F-R1's 3 % separated 41 % of pairs, so this is stricter) gives each of its
   contested pixels to the member whose median depth is nearer the pixel's (valid depth only). Source `depth`.
2. **Seam:** in each two-member contested set where the members stand side by side (their core centroids differ more
   across the axis than along it), a minimum-cost seam along the axis (1-D dynamic program over rows of at least
   8 contested rows, moving at most 2 px a row). Cost per position = −4 × edge evidence + the logit disagreement
   (for each pixel, the sigmoid-probability margin of the member it is *not* given). Source `seam`.
   - **Edge evidence (R3-A):** the mean of two maps, each rank-normalised per photo over the valid depth map: the
     across-axis gradient of H-2's normals (root sum of squares over the three channels) and the across-axis
     gradient of a multi-scale Retinex of luma (σ 8, 32, 128 map px, as F-R3). A gradient counts only where its
     direction is within 15° of the across direction (an edge running within 15° of the spine axis). Computed at the
     depth map's resolution and warped to the tile.
   - **Weak seam:** mean evidence along the seam under 1.25 × the mean over the contested pixels → fall back.
3. **Logit argmax** among the pixel's claimants that have logits (also for three or more claimants). Source
   `tile-argmax`.
4. **Fallbacks:** no claimant with logits → nearest exclusive core (distance transform); then higher box score ×
   mask score. Source `fallback`.

**Validity.** A member keeping under 60 % of its clipped mask (post-gate mask cut to its detection rectangle grown as
U-4 draws it, F-R1's baseline) is flagged; under 30 % it is dropped as absorbed (the accepted-work guard applies:
flagged instead).

**Refit and outlines.** A member is **changed** when it lost at least 2 % of its post-gate mask, or is a remainder.
Its refit box is the minimum-area rectangle of the largest connected part of its exclusive mask; an unchanged box
keeps its detection rectangle. Each kept box's exclusive outline is its mask's largest outer contour, lossless (no
simplification), and the photo's partition is also written as a label map.

### Step 4: provenance and cache

Under the data root's `private/f0i/<set>/` only: `gate.jsonl`, `groups.jsonl`, `tiles.jsonl`, `partition.jsonl`
(per box: kept or dropped with a reason, exclusive outline, refit polygon), `boundaries.jsonl` (per shared boundary:
source, tile id, transform and scale, model revision, prompts, edge support, logit margin, pixels before and after)
and the label maps. The repo gets aggregates only.

### Readers (F-0b's procedure, as H-2 ran it)

On the **changed set**: kept boxes whose crop changes under `refit` (any corner more than 1 px from the
`rect;rot=fixed;clip=frame` crop of the detection rectangle). Vision and PP-OCR on every changed box; F-0's Qwen
hard-crop selection per photo (cap 40 on `pilot-000`, 15 on the yardstick), the changed boxes competing with the
cached first-pass state of the photo's other kept boxes; F-0's unchanged `decide` and catalog bar as at this branch's
base (C-7 is changing the accept rule in parallel; this card does not touch it). Basis `readers-agree` only.

- **`clip`** (before): `rect;rot=fixed;clip=frame` on the detection rectangle (cached readings reused where the crop
  equals the cached one).
- **`refit`**: `rect;rot=fixed;clip=frame` on the refit box.
- **`refit+own`**: the same polygon with every pixel another kept box owns filled with the median colour of the
  crop's pixels no book owns (the whole crop's median when those are under 5 % of it). Crop name
  `rect;rot=fixed;clip=frame;mask=own`, so readings never mix.

### Measures

- **M1, overlap rate** (the invariant violation): pixels claimed by two or more kept outlines ÷ pixels claimed by at
  least one, pooled per photo, 95 % photo bootstrap (1,000 draws, seed 1), on the **rasterised exclusive outlines**
  (what downstream polygon consumers read; the label map is 0 by construction). Before = F-R1's figure from the same
  code.
- **M2, neighbour pixels in reader crops:** the share of kept boxes whose crop rectangle holds at least 10 % pixels
  of another kept box's outline and not its own (F-R1's definition); before on the detection rectangles and the
  original outlines, after on the partition's boxes (refit where changed) and exclusive outlines. The change in
  percentage points with a paired photo bootstrap (2,000 draws).
- **M3, readers on the changed set:** text read, confirmed (and on the yardstick wrong), before → after per arm,
  95 % paired photo-cluster bootstrap of the change (2,000 draws, percentage points, F-0b's seeds).
- **M4, distinct confirmed works** (`pilot-000`, whole set): before = every kept box's cached decision; after = the
  partition's kept boxes, changed boxes taking the arm's decision and the rest their cached one; dropped boxes count
  for nothing. Paired photo bootstrap.
- **M5, yardstick titles** (F-0e's guard): pooled title recall and precision per image from [annotated, hits,
  accepted], before and after as in M4, F-0e's `titleDelta`.
- **M6, book loss by geometry:** (photo, work) pairs accepted before by a box the partition drops and by no surviving
  box (cached decisions). By the guard it should be 0; it is counted, not assumed.
- **Reported, not in a rule:** gate counts by rule; groups, windows and encodes per photo; GPU seconds per photo and
  peak MPS memory; the provenance mix (share of contested pixels and of boundary length by source); the strong-seam
  share; a classical seam arm (across-axis luma gradient at full resolution in place of R3-A's evidence) computed on
  the CPU only, reported as the share of seam-decided pixels that would change hands and its strong-seam share.

### Keep rules

**The partition (masks, outlines, label maps) ships as a geometry cache** when both hold on both sets:

- **G1:** M1 ≤ 0.5 % (point estimate; the interval is reported);
- **G2:** M6 = 0.

**A reader crop (`refit`, then `refit+own`, each against `clip`) ships as the default** only if all hold (F-R1 §5:
F-0b's rule, H-2's works guard, F-0e's yardstick guard):

1. G1 and G2 hold, and on both sets M2's change has its interval below 0;
2. `pilot-000`: the confirmed-share interval on the changed set excludes 0 upward;
3. `pilot-000`: distinct confirmed works do not fall (point change ≥ 0);
4. yardstick: the confirmed share does not fall beyond its interval (upper end ≥ 0) and wrong accepts do not rise
   beyond theirs (lower end ≤ 0);
5. yardstick: title recall does not fall beyond its interval (upper end ≥ 0).

If both arms pass, the one with the larger `pilot-000` confirmed change ships. If a crop fails, the reader crop stays
`rect;rot=fixed;clip=frame`.
### Addendum: reported strata (fixed 2026-11-03, after the main run, before any stratum was computed)

The conductor relayed the owner's examples after the main run: face-out covers standing in front of spine rows,
similar-tone neighbours (dark on dark, white on white) and runs of books never separated. These are **reported
strata, not rule changes**: no threshold or rule above moves, and no stratum enters a keep rule. Thresholds:

- **Cover-kind conflicts.** The population is the shipped filter's kept boxes, which hold spine-kind boxes only
  (F-0c's cover pass is off by default; its face-out boxes are not in the set). The in-population proxy is a
  conflicting pair with at least one member whose H-2 `cover` share is at least 0.15 (H-1's over-select bar) and is
  its dominant extra face. Reported: how many such pairs, what the gate did to them, and which step decided their
  contested pixels (the depth override should take a cover standing proud).
- **Low-contrast neighbours.** Neighbouring pairs (F-R1's definition, its pair table) whose exclusive cores (each
  outline minus the other) differ in mean CIELAB colour by **ΔE76 < 10**. Reported against the other neighbouring
  pairs, both sets apart: the pair conflict rate and contested pixels before and after; gate actions that split
  a merged mask (merged parents and remainders whose children form a low-contrast pair); and, per seam run, whether
  each evidence map alone (normals, Retinex, full-resolution luma) would pass the strong-seam margin.
- **Top-face cause.** Within the low-contrast stratum, a pair is **top-face** when either member's H-2 `top` share is
  at least 0.15, otherwise **tone only**.
- **Ends (for F-0m).** Per kept box, whether its outline's top and bottom ends (along its detection axis, `top` =
  up the image) moved by more than 2 px in the partition, and if so which step moved them; otherwise `outline`.
  F-0i does not refine ends.
- **Owner examples** are matched to their photos by `helpers/label/match_examples.py` (ORB, as F-0g); their photos
  lead the private render. Ids stay private.

## Verdict (run 2026-11-03, after the pre-registration above)

Aggregates are in [`metrics.json`](metrics.json); the tables below the marker are generated by
`src/eval/f0i-cli.ts analyse`. `pilot-000` reader figures are machine agreement, never accuracy (INV-17); the two
sets are reported apart (OC35).

- **The partition ships as a geometry cache.** Both conditions hold on both sets:
  - **G1, overlap:** pixels claimed twice fall from **9.3 % to 0.05 %** (0.03–0.07) on `pilot-000` and from
    **9.3 % to 0.15 %** (0.03–0.30) on the yardstick, against a target of ≤ 0.5 %. The residue is not a resolve
    failure: pairs sharing under 1 % of the smaller mask are below F-R1's conflict line and are never grouped, and a
    remainder's single outer contour cannot carry a hole.
  - **G2, no book lost:** 0 on both sets. The gate and the validity rule dropped 360 `pilot-000` and 76 yardstick
    boxes; 5 and 3 of them accepted a work, and in every case another surviving box in the photo accepts the same
    work. The accepted-work guard fired 13 times on `pilot-000` and 22 times on the yardstick.
- **Neither reader crop ships; the shipped crop stays `rect;rot=fixed;clip=frame`.**
  - **`refit`** (the shipped crop on the refit box): `pilot-000` confirmed −0.6 points (−1.8 to 0.8) on the 1,001
    changed boxes, distinct confirmed works 629 → 623 (−6; −10 to 2); yardstick confirmed −4.5 (−9.0 to −0.8).
    Rules 2, 3 and 4 fail.
  - **`refit+own`** (neighbour-owned pixels filled): text read falls −8.4 (−11.0 to −6.1) and confirmed −1.4
    (−2.7 to −0.2) on `pilot-000`, works 629 → 618 (−11; −13 to −1). The yardstick holds (confirmed +1.5, −4.2 to
    8.4; title recall +0.8, −0.3 to 1.9), but rules 2 and 3 fail on `pilot-000`.
  - **Rule 1 fails before the readers do:** the share of crops holding ≥ 10 % neighbour pixels *rises* on
    `pilot-000` by 1.9 points (0.7 to 3.4) and falls on the yardstick by an interval that includes 0 (−0.9; −2.5
    to 0.9).

## Findings

1. **The gate does most of the work, as F-R1 predicted.** On `pilot-000` it dropped 138 duplicates, 196 pieces
   inside one spine and 18 two-book parents, and turned 127 wide parents into remainders; the yardstick's figures
   are 35, 31, 8 and 44. What is left is 647 conflict groups on `pilot-000` (21 a photo) and 80 on the yardstick.
2. **The pre-registered refit box is the reason the readers do not gain.** The refit box is the minimum-area
   rectangle of a book's exclusive mask, and it is looser than detection's rectangle, which was fitted to
   detection's own masks. On the changed `pilot-000` boxes the median crop's neighbour share rises from 14 % to
   26 % (remainders 11 % to 38 %), while the 4,760 unchanged boxes stay at 4 %. The exclusive mask is correct; the
   rectangle drawn around it is not a spine face. A tighter fit (the detection rectangle cut to the exclusive mask,
   or F-0b's side-line fit on the exclusive outline) is a new hypothesis for a fresh card, not a re-test here.
3. **Masking neighbours costs text.** `mask=own` fills a median 26 % of a changed `pilot-000` crop (remainders 38 %; yardstick 30 % and 34 %).
   Text read falls on both sets, most on remainders (−20 points on `pilot-000`) and flagged boxes (−28): the filled
   region is often where the readers found the text, because the refit box sits partly on a neighbour.
4. **Provenance.** Of the 23.4 M contested `pilot-000` pixels, 38 % went by seam, 37 % by logit argmax, 25 % by
   depth and under 0.1 % by the fallbacks (yardstick: 19 %, 59 %, 22 %). By boundary length, 46 % of `pilot-000`'s
   shared edges are outline edges that were never in dispute, 8 % were drawn by the gate (a remainder against its
   child), 27 % by argmax, 14 % by seam and 6 % by depth.
5. **R3-A's seam evidence is selective.** 490 of 1,100 `pilot-000` seam runs passed the strong-seam margin (29 of
   57 on the yardstick). The classical arm (across-axis luma gradient at full resolution, reported only) passes
   874 and 51, and would hand 4.2 % (2.4 %) of the compared pixels to the other book. Higher-resolution luma edges
   clear the margin more often because title bands and texture also make them; which arm is closer to the true
   seam is not measurable without boundary labels.
6. **Cost.** SAM 2.1 base-plus ran 3,012 windows on `pilot-000` (0.41 s each, 39 GPU seconds a photo) and 719 on
   the yardstick (0.34 s, 6 s a photo), peak MPS 6.1 GB, no errors and no group without logits. The CPU steps took
   about 1 s a photo for the plan and 15–25 s for the resolve, the classical arm included.

## Reported strata (addendum; not in a keep rule)

Figures are in the generated tables below (*Reported strata*); the private render leads with the owner's examples.

7. **Face-out covers never reach the partition.** The shipped filter keeps spine-kind boxes only, and F-0c's cover
   pass is off, so a cover standing in front of a spine row is not a box. In the owner's cover-out example the covers
   carry no mask on either side of the render. So the gate cannot read a cover as nesting or a duplicate, nor drop
   the spines behind it, and the depth override is never asked to give a cover its pixels: that case is untested.
   The pre-fixed in-population proxy (a member whose H-2 `cover` share is ≥ 15 % and its dominant extra face) holds
   339 conflicting `pilot-000` pairs and 132 on the yardstick, resolved like the rest (depth 30 % and 29 % of their
   contested pixels). On library shelves seen square-on that proxy is mostly a spine's own receding cover, not a
   face-out book, so it over-counts. When the cover pass is switched on, a cover's conflicts need their own rule
   (front layer owns) before the gate runs; logged.
8. **Low-contrast neighbours are not where conflict concentrates.** 2,226 of 12,648 `pilot-000` neighbouring pairs
   (18 %) and 407 of 2,051 on the yardstick have exclusive cores under ΔE76 10. Their conflict rate before is
   15.2 % against 14.4 % for the others (yardstick 16.0 % against 13.5 %), and after the partition both are near 0
   (0.13 % and 0.25 %). In the stratum the seam decides more of the contested pixels on `pilot-000` (60 % against
   34 %) and depth less (7 % against 30 %). On the yardstick it is the reverse: seam 13 %, depth 40 %.
   - **Top-face cause apart:** 1,241 of the 2,226 low-contrast `pilot-000` pairs have a member whose top share is
     ≥ 15 %. They conflict more (16.4 % against 13.7 % for tone only), and the seam decides 62 % of their contested
     pixels against 53 %.
   - **Seam evidence by source, per seam run in the stratum** (share passing the strong-seam margin with each map
     alone): normals 41 %, Retinex 60 %, full-resolution luma 84 %, combined 47 % on `pilot-000`. Tone-only pairs
     pass least (normals 31 %, Retinex 47 %, combined 33 %). Passing the margin is not being right: luma passes most
     because title bands and texture also make strong vertical edges.
9. **The merged-mask split is mostly not a low-contrast event.** Of the gate's 18 merged parents and 127 remainders
   on `pilot-000`, 2 and 23 have children (or child and remainder) under ΔE76 10; 13 of those 25 have the top-face
   cause. Yardstick: 4 and 16 of 8 and 44. Runs that SAM segmented as one mask with no child detection inside are
   untouched by the gate (§ Limits); the owner's "bottom edges unseparated" example could not be matched to a photo
   with confidence (ORB 41 inliers against 16, SIFT 381 against 372 on a different photo), so it is not placed.
10. **Ends (for F-0m).** F-0i moved an outline's top end on 85 kept `pilot-000` boxes (argmax 31, depth 26, seam 20,
    gate 8) and its bottom end on 71; every other end (5,676 tops, 5,690 bottoms) is the original outline's.
    Yardstick: 16 tops, 18 bottoms. `partition.jsonl` records it per box (`ends`).

## Caches that change if the partition is adopted

Box ids are stable, so only boxes the partition drops or changes are affected: 360 dropped and 1,001 changed on
`pilot-000`, 76 and 134 on the yardstick. The private partition lives under the data root's `private/f0i/<set>/`
(`partition.jsonl`, `boundaries.jsonl`, `gate.jsonl`, `groups.jsonl`, `tiles.jsonl`, label maps, logits).

| cache | needs re-baselining? | why |
|---|---|---|
| Q-2b outlines (and F-0b's on the yardstick) | **yes, superseded** | the exclusive outlines replace them; dropped boxes have none. Q-2b's τ belongs to its box set and is re-derived, never carried over. |
| F-0g copy-group evidence | **yes** | neighbour pairs and sizes change where boxes are dropped; appearance changes where a remainder's mask shrinks. |
| H-2 faces and the `face3d` subset | **yes, for dropped boxes only** | the face split is measured inside the detection rectangle, which the shipped crop keeps; dropped boxes' rows go. Boxes would need re-measuring only if a refit box were adopted, and it is not. |
| S-1 voids | **yes** | voids are derived from the outlines; the claimed union shrinks 0.7 % on `pilot-000` and 1.1 % on the yardstick (dropped and absorbed boxes, residual pixels left unowned). |
| F-0e readings, F-0c `base-decisions`, F-0's decisions | no | the reader crop does not change; a consumer should ignore dropped boxes' decisions (none is a photo's only acceptor of its work). |
| U-4 still study | yes, if it draws outlines | it should draw the exclusive outlines. |
| MoGe-2 depth cache | no | per photo. |

## Limits

- **No mask or box ground truth.** The overlap rate is a defect count by definition; whether each contested pixel
  went to the right book is not known. The private render (`private/f0i/renders/<set>/index.html`) is for the
  owner's eye.
- **Only contested pixels move.** A book SAM never segmented, or a two-book mask with no child detection inside it,
  is unchanged; F-0j's `multi-book` flag or a fresh look at S-1's missed books is the route for those.
- **Reader figures share F-0b's caveats:** changed boxes compete for Qwen's cap with the cached state of the rest,
  and `decide` is as at this branch's base while C-7 changes the accept rule in parallel.

<!-- generated by src/eval/f0i-cli.ts analyse: edit above this line -->

## Geometry, both sets

| figure | `pilot-000` | yardstick (PROXY) |
|---|---:|---:|
| photos / kept boxes before / after | 31 / 6121 / 5761 | 40 / 1116 / 1040 |
| **overlap rate before** | 9.3 % (7.8 %–10.9 %) | 9.3 % (7.3 %–11.3 %) |
| **overlap rate after (target ≤ 0.5 %)** | 0.05 % (0.03 %–0.07 %) | 0.15 % (0.03 %–0.30 %) |
| crops with ≥ 10 % neighbour pixels, before → after | 40.2 % → 42.2 % | 35.8 % → 34.9 % |
| ... change, points (95 % paired interval) | 1.9 (0.7 to 3.4) | -0.9 (-2.5 to 0.9) |
| book loss by geometry (M6) | 0 (dropped boxes that accepted a work: 5) | 0 (dropped boxes that accepted a work: 3) |
| changed boxes / refit / changed crops (the reader set) | 1001 / 1001 / 1001 | 134 / 134 / 134 |
| flagged (kept under 60 % of the clipped mask) | 67 | 9 |
| conflict groups / windows (encodes) | 647 / 3012 | 80 / 719 |
| groups without logits | 0 | 0 |
| GPU seconds per photo / peak MPS | 39.4 s / 5.9 GB | 6.1 s / 4.6 GB |
| contested pixels resolved | 23,417,687 | 10,290,418 |

### Gate

| rule | pilot-000 | yardstick-library-b2 |
|---|---:|---:|
| absorbed | 8 | 2 |
| duplicate | 138 | 35 |
| group: children under the cover share | 31 | 12 |
| guard: absorbed kept | 0 | 1 |
| guard: duplicate kept | 0 | 1 |
| guard: duplicate swapped | 6 | 8 |
| guard: merged parent kept | 0 | 1 |
| guard: piece kept | 7 | 11 |
| merged-parent | 18 | 8 |
| piece-of | 196 | 31 |
| remainder | 127 | 44 |

### Provenance

| source | pilot-000 contested pixels | pilot-000 boundary length | yardstick-library-b2 contested pixels | yardstick-library-b2 boundary length |
|---|---:|---:|---:|---:|
| outline | 0.0 % | 45.8 % | 0.0 % | 39.8 % |
| gate | 0.0 % | 8.3 % | 0.0 % | 18.5 % |
| tile-argmax | 37.1 % | 26.8 % | 58.6 % | 30.8 % |
| seam | 37.9 % | 13.6 % | 19.4 % | 6.0 % |
| depth | 25.0 % | 5.6 % | 22.0 % | 4.8 % |
| fallback | 0.0 % | 0.0 % | 0.1 % | 0.0 % |

Seams: pilot-000 490 strong of 1100 runs (classical arm: 874 strong; it would give 4.2 % of the compared pixels to the other book); yardstick-library-b2 29 strong of 57 runs (classical arm: 51 strong; it would give 2.4 % of the compared pixels to the other book).

### Reported strata (addendum; not in a keep rule)

Neighbouring pairs (F-R1's table): 12680 (12648 with a colour on both cores) | 2062 (2051 with a colour on both cores). Pair conflict = masks share ≥ 1 % of the smaller; pair overlap = contested ÷ the pair's union, pooled.

| stratum | set | pairs | conflict before → after | pair overlap before → after | pairs with a member dropped | contested pixels: seam / argmax / depth | seam runs | strong: combined / normals / Retinex / luma |
|---|---|---:|---|---|---:|---|---:|---|
| low-contrast (ΔE76 < 10) | pilot-000 | 2226 | 15.2 % → 0.13 % | 2.2 % → 0.01 % | 230 | 60 % / 33 % / 7 % | 291 | 47 % / 41 % / 60 % / 84 % |
| low-contrast (ΔE76 < 10) | yardstick-library-b2 | 407 | 16.0 % → 0.25 % | 2.7 % → 0.01 % | 65 | 13 % / 46 % / 40 % | 20 | 50 % / 50 % / 50 % / 95 % |
| ... tone only | pilot-000 | 985 | 13.7 % → 0.00 % | 1.8 % → 0.01 % | 82 | 53 % / 35 % / 12 % | 107 | 33 % / 31 % / 47 % / 78 % |
| ... tone only | yardstick-library-b2 | 322 | 14.6 % → 0.00 % | 2.5 % → 0.01 % | 48 | 1 % / 63 % / 36 % | 14 | 43 % / 50 % / 43 % / 93 % |
| ... top-face cause | pilot-000 | 1241 | 16.4 % → 0.24 % | 2.5 % → 0.01 % | 148 | 62 % / 32 % / 6 % | 184 | 55 % / 47 % / 68 % / 88 % |
| ... top-face cause | yardstick-library-b2 | 85 | 21.2 % → 1.18 % | 3.4 % → 0.01 % | 17 | 48 % / 1 % / 50 % | 6 | 67 % / 50 % / 67 % / 100 % |
| other neighbours | pilot-000 | 10422 | 14.4 % → 0.08 % | 2.5 % → 0.01 % | 1550 | 34 % / 36 % / 30 % | 807 | 44 % / 39 % / 57 % / 78 % |
| other neighbours | yardstick-library-b2 | 1644 | 13.5 % → 0.06 % | 2.5 % → 0.01 % | 325 | 21 % / 61 % / 18 % | 37 | 51 % / 43 % / 62 % / 86 % |
| cover-kind member | pilot-000 | 2337 | 14.5 % → 0.09 % | 2.2 % → 0.02 % | 321 | 34 % / 36 % / 30 % | 174 | 44 % / 36 % / 56 % / 82 % |
| cover-kind member | yardstick-library-b2 | 778 | 17.0 % → 0.39 % | 3.1 % → 0.02 % | 179 | 17 % / 53 % / 29 % | 20 | 60 % / 50 % / 70 % / 95 % |

Merged-mask splits by the gate (merged parents dropped / remainders made): pilot-000: low-contrast 2 / 23 (top-face cause 2 / 11), other 16 / 104; yardstick-library-b2: low-contrast 4 / 16 (top-face cause 0 / 3), other 4 / 28.

Ends for F-0m (kept boxes; which step moved the outline's top / bottom end, else `outline`): pilot-000: top outline 5676, gate 8, tile-argmax 31, seam 20, depth 26; bottom outline 5690, gate 8, tile-argmax 34, seam 11, depth 18. yardstick-library-b2: top outline 1024, gate 2, tile-argmax 6, seam 2, depth 6; bottom outline 1022, gate 3, tile-argmax 7, seam 1, depth 7.

## pilot-000: `refit` against `clip` (real use (OC35): machine agreement, never accuracy (INV-17))

1001 changed boxes. Shares in % of them, before → after (Δ points; 95 % paired photo-bootstrap interval).

| boxes | n | photos | text read | confirmed |
|---|---:|---:|---|---|
| **all** | 1001 | 31 | 69.7 → 69.6 (-0.1; -2.3 to 1.8) | 6.3 → 5.7 (-0.6; -1.8 to 0.8) |
|   remainders | 123 | 30 | 94.3 → 90.2 (-4.1; -9.4 to 0) | 8.1 → 7.3 (-0.8; -4.3 to 2.7) |
|   other changed boxes | 878 | 31 | 66.3 → 66.7 (+0.5; -1.6 to 2.2) | 6 → 5.5 (-0.6; -1.8 to 0.7) |
|   flagged | 67 | 21 | 74.6 → 70.1 (-4.5; -15.9 to 2.9) | 4.5 → 6 (+1.5; 0 to 4) |
|   whole boxes | 534 | 31 | 81.5 → 80.1 (-1.3; -3.9 to 0.9) | 8.4 → 6.9 (-1.5; -3.1 to 0) |
|   cut or partial boxes | 467 | 28 | 56.3 → 57.6 (+1.3; -1.9 to 4.2) | 3.9 → 4.3 (+0.4; -0.9 to 2.2) |

Distinct confirmed works over the whole set (per photo, summed): 629 → 623 (-6; -10 to 2).

| reader | calls | seconds |
|---|---:|---:|
| vision | 2002 → 2002 | 419 → 136 |
| ppocr | 2002 → 2002 | 1859 → 1574 |
| qwen | 200 → 202 | 287 → 217 |

## pilot-000: `own` against `clip` (real use (OC35): machine agreement, never accuracy (INV-17))

1001 changed boxes. Shares in % of them, before → after (Δ points; 95 % paired photo-bootstrap interval).

| boxes | n | photos | text read | confirmed |
|---|---:|---:|---|---|
| **all** | 1001 | 31 | 69.7 → 61.3 (-8.4; -11 to -6.1) | 6.3 → 4.9 (-1.4; -2.7 to -0.2) |
|   remainders | 123 | 30 | 94.3 → 74 (-20.3; -30.4 to -11.5) | 8.1 → 5.7 (-2.4; -7.9 to 2.6) |
|   other changed boxes | 878 | 31 | 66.3 → 59.6 (-6.7; -9.8 to -3.7) | 6 → 4.8 (-1.3; -2.6 to -0.1) |
|   flagged | 67 | 21 | 74.6 → 46.3 (-28.4; -40 to -19.1) | 4.5 → 3 (-1.5; -6.8 to 3.1) |
|   whole boxes | 534 | 31 | 81.5 → 73.2 (-8.2; -11.3 to -5.5) | 8.4 → 5.6 (-2.8; -4.8 to -0.8) |
|   cut or partial boxes | 467 | 28 | 56.3 → 47.8 (-8.6; -12.6 to -5.1) | 3.9 → 4.1 (+0.2; -1 to 1.5) |

Distinct confirmed works over the whole set (per photo, summed): 629 → 618 (-11; -13 to -1).

| reader | calls | seconds |
|---|---:|---:|
| vision | 2002 → 2002 | 419 → 198 |
| ppocr | 2002 → 2002 | 1859 → 1380 |
| qwen | 200 → 186 | 287 → 212 |

## yardstick-library-b2: `refit` against `clip` (PROXY: Library Dataset sample, box arm B2; confirmed = accepted and annotated in the image)

134 changed boxes. Shares in % of them, before → after (Δ points; 95 % paired photo-bootstrap interval).

| boxes | n | photos | text read | confirmed | wrong |
|---|---:|---:|---|---|---|
| **all** | 134 | 33 | 67.2 → 66.4 (-0.7; -3.2 to 1.8) | 16.4 → 11.9 (-4.5; -9 to -0.8) | 0.7 → 0 (-0.7; -2.5 to 0) |
|   remainders | 44 | 24 | 70.5 → 68.2 (-2.3; -7.7 to 0) | 11.4 → 11.4 (+0; 0 to 0) | 0 → 0 (+0; 0 to 0) |
|   other changed boxes | 90 | 25 | 65.6 → 65.6 (+0; -2.7 to 3.4) | 18.9 → 12.2 (-6.7; -13 to -1) | 1.1 → 0 (-1.1; -4 to 0) |
|   flagged | 9 | 8 | 77.8 → 66.7 (-11.1; -27.3 to 0) | 22.2 → 11.1 (-11.1; -27.3 to 0) | 11.1 → 0 (-11.1; -37.5 to 0) |
|   whole boxes | 81 | 32 | 84 → 82.7 (-1.2; -4.1 to 0) | 23.5 → 18.5 (-4.9; -11.1 to 1) | 1.2 → 0 (-1.2; -3.8 to 0) |
|   cut or partial boxes | 53 | 14 | 41.5 → 41.5 (+0; -4.8 to 6.5) | 5.7 → 1.9 (-3.8; -9.8 to 0) | 0 → 0 (+0; 0 to 0) |

Titles over the whole set: recall 36.9 % → 36.3 % (-0.6 (-1.4 to 0.2) points), precision 92.7 % → 92.9 % (0.3 (-0.2 to 1.0)).

| reader | calls | seconds |
|---|---:|---:|
| vision | 268 → 268 | 24 → 31 |
| ppocr | 268 → 268 | 505 → 720 |
| qwen | 92 → 102 | 156 → 262 |

## yardstick-library-b2: `own` against `clip` (PROXY: Library Dataset sample, box arm B2; confirmed = accepted and annotated in the image)

134 changed boxes. Shares in % of them, before → after (Δ points; 95 % paired photo-bootstrap interval).

| boxes | n | photos | text read | confirmed | wrong |
|---|---:|---:|---|---|---|
| **all** | 134 | 33 | 67.2 → 62.7 (-4.5; -9.7 to 0) | 16.4 → 17.9 (+1.5; -4.2 to 8.4) | 0.7 → 1.5 (+0.7; -1.9 to 3.3) |
|   remainders | 44 | 24 | 70.5 → 68.2 (-2.3; -7.3 to 0) | 11.4 → 13.6 (+2.3; -10.2 to 13.5) | 0 → 2.3 (+2.3; 0 to 8.1) |
|   other changed boxes | 90 | 25 | 65.6 → 60 (-5.6; -13.3 to 0) | 18.9 → 20 (+1.1; -6.1 to 10.6) | 1.1 → 1.1 (+0; -3.5 to 2.8) |
|   flagged | 9 | 8 | 77.8 → 55.6 (-22.2; -54.5 to 0) | 22.2 → 22.2 (+0; -37.5 to 50) | 11.1 → 0 (-11.1; -37.5 to 0) |
|   whole boxes | 81 | 32 | 84 → 82.7 (-1.2; -3.8 to 0) | 23.5 → 28.4 (+4.9; -5 to 15.4) | 1.2 → 1.2 (+0; -3.2 to 3.8) |
|   cut or partial boxes | 53 | 14 | 41.5 → 32.1 (-9.4; -23.1 to 0) | 5.7 → 1.9 (-3.8; -9.8 to 0) | 0 → 1.9 (+1.9; 0 to 5.7) |

Titles over the whole set: recall 36.9 % → 37.7 % (0.8 (-0.3 to 1.9) points), precision 92.7 % → 92.5 % (-0.2 (-1.5 to 0.9)).

| reader | calls | seconds |
|---|---:|---:|
| vision | 268 → 268 | 24 → 96 |
| ppocr | 268 → 268 | 505 → 645 |
| qwen | 92 → 84 | 156 → 145 |

## Verdict

Partition (geometry cache): overlap target met yes, no book lost yes: **ships**. Neighbour-crop share falls on both sets: no.

| arm | geometry and neighbour crops | pilot confirmed up | pilot works not down | yardstick confirmed not down | yardstick wrong not up | yardstick recall not down | keep |
|---|---|---|---|---|---|---|---|
| refit | no | no | no | no | yes | yes | **off** |
| own | no | no | no | yes | yes | yes | **off** |

Reader crop: **stays `rect;rot=fixed;clip=frame`**.
