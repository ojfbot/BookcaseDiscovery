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
