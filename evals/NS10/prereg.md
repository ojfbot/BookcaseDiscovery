# NS10: multi-view label fusion on pilot-000 capture groups — pre-registration

Fixed 2026-11-05, before the teacher is downloaded and before any run. **No measurement was taken for this card.** No
MapAnything weight is on disk, no geometry was computed, no association was run, and no code below was written (the
scorer and the helper are specified here, not built). Nothing below changes after seeing a result. **A later change is
a deviation: it is logged under `## Deviations` in `implementation-notes.md` and named in `report.md` with the figures
it touches.** Every threshold marked *hypothesis* is a proposal with no measurement behind it (INV-17); every figure
the card reports is **machine agreement with a named reference, never accuracy** (OC36).

**Question.** Of the books that `pilot-000` reads only once (F-0's `single-reader`) or cuts at the frame edge (Q-3's
`frame-edge`), how many gain a second reading from a **different view** of the same physical book when F-0's outputs
are fused across the stills of one capture group, with physical copies kept apart? The card trains no student. It
produces candidate labels (`labelSource: multiview-fusion`) and measures them; the go rule for any student trained on
them is `evals/NS5/prereg.md`. Multi-view data is a label generator and an evaluation reference, never a model input
(OC38). Fusion makes a wrong label consistently wrong and the readers' errors correlate (`evals/TS1/report.md`), so
agreement between views is no evidence that a label is right.

## 1. Units and populations

- **Unit: a physical book, per case** (INV-4, INV-25). Two copies of one work are two books and never share a fused
  book or a label.
- **Case.** `pilot-000` has no `bookcaseId` (every ledger row's `caseId` is null), so the case is stood in for by the
  **F-1 capture group** (stills of one stand within 120 s; `splitGroup` equals `captureGroup` in all 31 stills, so no
  group shares a split group with another). That makes 6 cases. This is a stand-in, logged as a deviation; the
  candidate rows leave `caseId` null and name the capture group in their own field. The groups hold 13, 6, 5, 3, 2
  and 2 stills.
- **Views.** The stills of one capture group, working copies as F-1 manifests them. A **different view** is a
  different still: INV-20's distinct condition (a different viewpoint). Two boxes in one still are one view.
- **Boxes.** RB-1's box set on `pilot-000` (F-0i's kept boxes minus NB-3's ship flags), 5,757 boxes in the 31 stills.
  A box's outline is F-0i's exclusive outline, else F-0's rectangle.
- **A reading.** One reader's (`vision`, `ppocr`, `qwen`) **confirmed work** for a box: the work that reader's top
  catalog candidate names when it passes F-0's bar (`ACCEPT`: evidence score 0.72, title evidence 0.8, query coverage
  0.5; with C-6's guard and C-7's counter-evidence as the stored decision applied them). It is read from F-0's
  `decisions.jsonl` as it stands for the label ledger version `v-f495741be2c5`; nothing is re-decided. Two readings
  agree when they name the same `workId`. (TS-1 and F-0 compare works by id; the catalog holds some works twice, and
  that conservative reading under-counts agreement. `sameWork` in `src/catalog/lookalike.ts` is not applied.)
- **`single-reader` box.** A box whose F-0 decision is not accepted and whose reason is `single-reader`: exactly one
  work is confirmed, by exactly one reader. Its reading is that work.
- **`frame-edge` box.** A box Q-3 calls `cut` by the frame (`frameCut`) or `outer` (`radialOf` at Q-3's ring bar),
  computed from the box's polygon and photo size with Q-3's own functions, not read from Q-3's older cache.
- **A fused book.** One association (section 3): the boxes of different views taken to be one physical book. A box
  seen in one view only is a fused book of one.

## 2. Teacher and geometry (Stage A)

- **Teacher.** `facebook/map-anything-apache` at revision `00f9c245bbcb` (Apache-2.0, 4.91 GB, one
  `model.safetensors`), the only download this card makes. RGB views in; no intrinsics, poses or depth are given as
  inputs, so the teacher uses the views alone. Its outputs (per view: camera pose, intrinsics, a metric point map and
  a confidence map) are a **label generator** and never a model input.
- **Run.** One forward pass per capture group on all of the group's stills (the 13-still group included, unless
  memory refuses it: then it is split and logged). Resolution and view-count are the model's defaults; the first
  group's peak memory decides whether to continue (section 7).
- **Pose success** (per group): the teacher returns finite poses and a confidence map whose median over the boxes'
  pixels is above 0.5 for every view. A view that fails stays unfused (its boxes are books of one); the group's
  success share is reported.
- **Shelf plane.** Per group, one plane is fitted (RANSAC, 2,000 draws, inlier distance 1 % of the median depth) to the
  teacher's 3D points inside the group's kept boxes in the common frame. A view whose boxes lie more than 15 % of the
  median depth off the group's plane in median is flagged `off-plane` and stays unfused (*hypothesis*: thresholds
  chosen before seeing data; changing them is a deviation).
- **Consistency check against MoGe-2 (not truth).** For each still, the teacher's plane (in that still's camera
  frame) against H-2's MoGe-2 spine-plane for the same still, over the rays of the still's kept-box pixels: the
  **angle** between the normals and the **median relative depth difference** along those rays after the teacher's
  and MoGe-2's scale are matched by the median depth ratio, reported with the ratio. Per group and overall, as
  medians and the 90th percentile over stills. Two models that agree can both be wrong; disagreement is a flag for
  the report, not a gate.

## 3. Association (Stage B, CPU)

Applied identically in every group; the rule is written before any association is computed.

1. **Lift.** Each box's outline pixels go to 3D through the teacher's point map and the pose into the common frame,
   keeping pixels whose confidence is above the group's median confidence. A box with fewer than 50 such pixels is not
   lifted (a book of one).
2. **Footprint on the plane.** The 3D points are projected onto the group's shelf plane in a basis of (along-shelf `u`,
   up `v`), `v` being the plane projection of the common frame's up direction (the first view's up). The footprint is
   the axis-aligned rectangle spanned by the 5th to 95th percentile of the points' `u` and `v`.
3. **Overlap.** For boxes in two different views, the intersection over union (IoU) of their footprints.
4. **Association.** Greedy by descending IoU over all cross-view pairs, a pair merging two fused books when (a) the IoU
   is at least **0.5** (*hypothesis*), (b) the two fused books hold **no box of a common still** (the constraint: two
   boxes in one still never join one fused book, which makes two copies of one work in one still stay two books), and
   (c) for each of the two boxes, the candidate is its best match in the other view by IoU (a mutual best match, so a
   shelf of look-alike spines is not chained). Reading agreement is **not** an input of the association: it is the
   thing measured, and using it would make the gain circular. Where a box has two candidates within 0.05 IoU, the one
   whose reading agrees (if any) wins; with no reading to tell them apart the tie is dropped and neither merges.
5. **Candidate label.** A fused book gets a `multiview-fusion` candidate when readers from at least two **different
   views** confirm the same work (readings from one still never make a candidate, whatever the readers). A candidate
   with a dissenting confirmed work in another member box is marked and counted as a conflict, still written.
   `rgbRecoverable: yes` when a member's RGB reading is among the agreeing readings (always, here); `unknown`
   otherwise (reserved for fusions whose evidence is geometry only; none is made).
6. **Copy groups.** F-0g's copy groups (`private/f0g/pilot-000/copies.jsonl`) are read, never rewritten. Two boxes of
   one copy group are in one still, so (4b) already keeps them apart; the check below asserts it from the output.
   `dupClusterId` is null for `pilot-000` (no near-duplicate flags), and the fused book carries the manifest's value.

## 4. Measures and estimators

All counts per case (capture group) and overall. **Overall values are pooled ratios over the 6 cases**; the interval is
a **case-level bootstrap**: 2,000 resamples of the cases with replacement, seed 20261105 (as NS1 and NS5), the 2.5th
and 97.5th percentile of the pooled ratio. The case is the resampling unit, since boxes within a case share light,
shelf and camera path. Fewer than 5 cases would give per-case values only (not the case here: 6). No p-value is
derived from boxes. The 6 cases are few and unequal in size (2 to 13 stills): the intervals are expected to be wide
and the report says so.

| # | Measure | Definition | Reference |
|---|---|---|---|
| M1 | Books per capture group, before and after | Before: the group's kept boxes summed over its stills. After: its fused books. Reported also as the share of boxes that joined a fused book of two or more | none (a count) |
| **M2** | **Gain share (the keep rule's measure)** | Of the `single-reader` boxes in `pilot-000`, the share that belong to a fused book holding a box of a different still whose readers confirm a reading, and **where one confirmed reading is the same work** (agree = gain) | machine agreement of another view's readers |
| M2b | New conflicts | Of the same `single-reader` boxes, the share where another view's box confirms a **different** work and none confirms the same (disagree) | idem |
| M2c | Visible-twice denominator | M2 over only the `single-reader` boxes that belong to a fused book of two or more (the reported companion; it decides nothing) | idem |
| M3 | Frame-edge reads | Of the `frame-edge` boxes, the share that belong to a fused book with a member box that is not `frame-edge` and holds a confirmed reading | idem |
| M3b | Agreeing frame-edge reads | M3 where the frame-edge box's own readers, if any confirm a work, agree with that member's | idem |
| **M4** | **Copy safety (exact)** | The count of fused books holding two boxes of one still, and the count holding two boxes that one F-0g copy group names, over all groups. Exact: no interval | the F-0g copy groups |
| M4b | Copy exposure | Fused books with a member box in an F-0g copy group of two or more, and of those, the number whose cross-view match was decided by a tie-break (rule 4's 0.05 band) | none (a count) |
| M5 | Association precision | Over the cross-view box pairs the association merged and for which **both** boxes carry a confirmed reading: the share naming the same work. Geometry alone decided the pair; the readings did not (the independent proxy, no near-duplicate flags exist) | machine agreement of both views' readers |
| M5b | Same-work pair recovery | Over the cross-view pairs of boxes both confirming one work, of which at most one box per still and view-pair is a copy (not ambiguous), the share the association merged | idem |
| M6 | Teacher cost | Runtime (load apart) and peak resident memory per group on MPS; pose success per group; the MoGe-2 consistency figures of section 2 | the process |

Every table in `report.md` is labelled **machine agreement on 31 stills of one real-use set, not accuracy**, and states
that **no sweep clip was fused**: a sweep's views are continuous and the association there is a different problem.

## 5. Verdict (the card's own keep rule; not NS5's, which is for students)

In order:

1. **Fails** if M4 is not zero: any fused book holds two boxes of one still, or two boxes of one F-0g copy group. The
   method fails regardless of any gain.
2. **Fails** if the teacher cannot place the cases: pose success is below 4 of the 6 groups.
3. **Keep** if M2's case-level interval has its **lower bound above 0** and M5's point estimate is **at least 0.80**
   (*hypothesis*: the association's agreement floor; no basis in a measurement) and M4 is zero.
4. **Not shown** otherwise (the M2 interval reaches 0, or the precision is under 0.80): the verdict names which, with
   the figures. Not a no-go on fusion for the full pipeline: six cases cannot decide that.

A *keep* admits **nothing to the label ledger** and trains nothing. Candidate rows go to the data root's private
`fusion/<session>/candidates.jsonl` with a lineage stamp. Admission to TS-0 is a later card and an owner decision.
M3 and M1 are reported with the same estimator and decide nothing.

## 6. What the stills can and cannot test

- Stills from slightly different positions (handheld, within 120 s) overlap partly; boxes in the overlap are the only
  ones fusion can touch. M2c reports that denominator so the gain is not read as a share of every box.
- The ultra-wide lens (27 of the 31 stills) makes spines at the frame's outer ring the `frame-edge` boxes; a second
  still taken a step along the shelf is the case M3 asks about.
- Stills carry no depth input here and no video: a sweep clip's temporal continuity and its occlusion by the camera
  path are untested. A fusion that works on stills is a necessary check for a sweep, not evidence about one.
- `deviceClass` is `metric-depth` by derivation for every row (an unrecorded default, `implementation-notes.md`,
  NS-5): this card's output stays out of NS5's real degraded-tier column whatever it finds.

## 7. Stopping rules (resources)

- **Memory.** Peak memory is measured on the first group the helper runs (the 3-still group). If the 13-still group's
  extrapolated peak exceeds the memory the machine reports free, the group is split in two and the split logged. If
  even the first group's peak exceeds free memory, the card stops and reports: it does not swap. The CC-BY-NC
  variants are excluded, and `facebook/map-anything-apache-v1` (2.25 GB) is fetched only after asking the conductor.
- **Dependencies.** A dependency with a licence incompatible with AGPL-3.0 (CC-BY-NC, GPL-incompatible) stops the card
  before it is installed.
- **Heavy slot.** Nothing else heavy runs while this card holds the lane; nothing runs on Yuri.

## 8. What is deliberately not decided here

The admission of any candidate to the label ledger, a student, NS-11's design, and the sweep clips' association. A
sweep rule is pre-registered by the card that has sweep clips.
