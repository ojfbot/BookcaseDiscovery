# Multi-view label fusion (NS-10)

Card NS-10, 2026-11-05. Question: of the books `pilot-000` reads once (`single-reader`) or cuts at the frame edge, how
many gain a reading from a **different view** of the same physical book when F-0's outputs are fused across the stills of
one capture group, with physical copies kept apart? Pre-registration: [`evals/NS10/prereg.md`](../../evals/NS10/prereg.md).
Results: [`evals/NS10/report.md`](../../evals/NS10/report.md), `metrics.json`. The card trains no student and writes
nothing to the label ledger.

**Why it is shaped this way.** Multi-view data is a label generator and an evaluation reference, never a model input
(OC38). The unit is the discrete, bounded, identified physical book (INV-4, INV-25): two copies of one work never share
a fused book. A different viewpoint is a distinct condition (INV-20). Fusion helps association more than geometry on a
near-planar shelf, and it makes a wrong label consistently wrong (readers' errors correlate, `evals/TS1/report.md`), so
every figure is machine agreement, never accuracy (OC36).

## Method

1. **Cases and views.** `pilot-000` has no `bookcaseId`, so the **capture group** (F-1: stills of one stand within
   120 s) is the case: 6 groups of 13, 6, 5, 3, 2 and 2 stills. A view is a still. Boxes are RB-1's box set (5,757
   boxes); a box's outline is F-0i's exclusive outline.
2. **Stage A, the teacher** (`helpers/fusion/stage.py`). MapAnything (Apache-2.0 variant, revision `00f9c245bbcb`) gets
   the group's stills at a 518 px long side and returns, per still, a pose, intrinsics, a metric point map in the group's
   common frame and a confidence map. One process per group; MPS; bf16 autocast.
3. **Lift** (`helpers/fusion/lift.py`). Each box's outline picks its pixels on the map. One RANSAC plane is fitted per
   group to those points, and a still whose box points lie more than 15 % of the median depth off it is `off-plane` and is
   not lifted. A lifted box is the rectangle between the 5th and 95th percentile of its points' (along-shelf, up)
   coordinates on the plane. The same stage compares each still's plane with H-2's MoGe-2 plane for the same still.
4. **Association** (`src/eval/ns10.ts`, CPU). Greedy by descending footprint IoU (floor 0.5) over cross-still pairs
   that are each other's best match in the other still and whose two fused books share no still. A box with several
   candidates within 0.05 IoU of its best is matched by reading agreement if exactly one agrees, else not matched.
   Reading agreement never creates a pair (it is the thing measured).
5. **Candidates.** A fused book with readers from two or more different stills confirming one work gets a
   `multiview-fusion` candidate (`rgbRecoverable: yes`, as every reading is of an RGB still), with a conflict mark when
   another member confirms a different work. Candidates are `private/fusion/<set>/candidates.jsonl`, stamped
   (`FUSION_CANDIDATES_SCHEMA`, `docs/lineage.md`). Admission to TS-0 is a later card and the owner's decision.

**A reading** is a reader's confirmed work from F-0's decision (the work that reader's top candidate names when it passes
F-0's bar), as the H-2 base decisions the ledger is built from hold it. `single-reader` is F-0's unaccepted reason of that
name (one work confirmed by one reader). `frame-edge` is Q-3's `cut` (any corner within 1 % of the frame's long side of
an edge, or outside) or `outer` (radial distance above 0.5612) position, computed with Q-3's functions.

## Caches (all private, under the data root's `private/fusion/<set>/`)

| File | What | Keyed by |
|---|---|---|
| `groups.jsonl`, `boxes.jsonl` | the helper's inputs (`ns10-cli.ts prepare`) | the manifest version and RB-1's box set |
| `geometry/map-anything-apache@<rev7>/<key>/` | per-still `.npz` and `group.json` sidecar | model, revision, weight hash, MapAnything commit, `stage.py` hash, long side, precision, each still's SHA-256 |
| `runs/*.jsonl` | `stage.py`'s timing and memory rows, one per group | not a cache |
| `footprints.jsonl`, `geometry.jsonl` | per-box footprints, per-group summaries | `lift.py` run |
| `candidates.jsonl`, `books.jsonl` | candidates (stamped) and fused books of two or more | `ns10-cli.ts fuse` |

## What the stills could and could not test

- **Could:** whether a feed-forward multi-view model registers handheld stills of one case well enough to put the same
  spine on the same footprint; whether the association keeps copies apart (it does by construction: the same-still rule);
  how often a second still names the same work.
- **Could not:** accuracy of any label (no ground truth; machine agreement only); a sweep's temporal continuity, motion
  blur or the camera path's occlusion; the association rule's behaviour on contiguous frames; groups of one case
  taken on different days. Six cases, one of them holding 13 of 31 stills, give intervals as wide as the report shows.
- **Not independent of F-0:** the readers that supply the second reading are the readers that supplied the first; an error
  they share is agreed by every view.

## What changes when sweep clips arrive

A clip is a frame sequence with a continuous camera path, so the association becomes tracking: pose is smooth and
neighbouring frames overlap almost fully, which lifts the overlap that was the stills' limit (the report's M2c and
`joinedBooks`). The Stage A cache is keyed per view hash, so a clip's frames drop in as a group; the sweep needs a
sliding window (a 13-still group already peaked at 8.7 GB of MPS memory) and the per-case union of books as the
reference (NS5 §2). A sweep rule is pre-registered by the card that has the clips. The copy-safety check carries over
unchanged, but its guarantee (two boxes in one still never merge) does not: in a sequence the same copy appears in many
frames, so the rule must become a track-level one (two simultaneous boxes never share a track) before it can be exact.

## Licences and downloads

The weights and the code are Apache-2.0 ([`docs/licences.md`](../licences.md)). The one approved download was
`facebook/map-anything-apache` at `00f9c245bbcb` (4.91 GB). MapAnything's encoder also builds its DINOv2 model from
torch hub's copy of `facebookresearch/dinov2` (`main`, code only, about 4.5 MB, no weights): an unpinned implicit
download, logged as a deviation, with the hash of the code used recorded in each group's sidecar.
