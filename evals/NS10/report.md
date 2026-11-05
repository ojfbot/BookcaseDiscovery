# NS10: multi-view label fusion on pilot-000 capture groups — report

Pre-registered in [`prereg.md`](prereg.md) (fixed 2026-11-05, before the teacher was downloaded). Teacher: MapAnything, Apache-2.0
variant (`facebook/map-anything-apache`, revision `00f9c245bbcb`). Constants: IoU floor 0.5, tie band 0.05. Method, caches and
limits: [`docs/models/multiview-fusion.md`](../../docs/models/multiview-fusion.md). Numbers: [`metrics.json`](metrics.json).

> **Every figure below is machine agreement on 31 stills of one real-use set (6 capture groups standing in for cases), not accuracy. No
> sweep clip was fused.** The readers' errors correlate (`evals/TS1/report.md`); agreement between two views is no evidence a
> label is right. Intervals are case-level bootstrap percentiles (2.5 % to 97.5 %, 2,000 resamples, seed 20261105) over
> 6 cases of 2 to 13 stills: wide, and the report does not read them as more than that.

## Verdict (prereg §5)

**NOT-SHOWN** — the gain share's interval reaches 0. Under the keep rule: copy safety is exact (0 fused books hold two boxes of
one still, 0 hold two of one F-0g copy group); the share of `single-reader` boxes that gained a second reading from a different view is
26/814 = 3.2 % (0.0 % to 4.7 %); association precision is 32/60 = 53.3 % (0.0 % to 100.0 %) against the 0.80 floor. Nothing was written to the label ledger.

## Measures (prereg §4)

| Measure | Value |
|---|---|
| M1 boxes before / fused books after | 5757 / 5426; 275 fused books hold two or more boxes (606 boxes, 606/5757 = 10.5 % (4.3 % to 13.2 %)); 2448 boxes were lifted |
| **M2 `single-reader` boxes that gained a second-view reading that agrees** | 26/814 = 3.2 % (0.0 % to 4.7 %) |
| M2b new conflicts (another view confirms a different work) | 22: 22/814 = 2.7 % (0.0 % to 4.5 %) |
| M2c gain among `single-reader` boxes in a fused book of two or more | 26/81 = 32.1 % (0.0 % to 50.0 %) |
| M3 `frame-edge` boxes that are in a fused book with a member read fully in another view | 32/2373 = 1.3 % (0.1 % to 2.2 %) |
| M3b of those with a reading of their own, the share that agrees | 9/20 = 45.0 % (0.0 % to 100.0 %) |
| M3c (supplementary, not pre-registered) frame-edge boxes with no reading of their own, read in full elsewhere | 12/1889 = 0.6 % (0.0 % to 1.2 %) |
| **M4 copy safety (exact)** | 0 fused books with two boxes of one still or one copy group |
| M4b copy exposure | 31 fused books of two or more have a member in an F-0g copy group; 0 were decided by the reading tie-break |
| M5 association precision (merged pairs where both boxes carry a confirmed work: same work) | 32/60 = 53.3 % (0.0 % to 100.0 %) |
| M5b same-work pair recovery (unambiguous cross-view pairs naming one work that were merged) | 23/357 = 6.4 % (0.0 % to 11.8 %) |
| Candidates (`multiview-fusion`: readers from two or more stills agree) | 30 fused books, 6 with a dissenting work in another member |

## Per case

| Case | Stills | Boxes | Lifted | Fused books | Of 2+ boxes | `single-reader` | Gain / conflict | Frame-edge read elsewhere | Candidates | Views on the plane | Infer s | Peak RSS MB | Peak MPS MB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| case 1 | 13 | 2778 | 910 | 2575 | 156 | 507 | 25 / 18 | 29 | 28 | 3 of 13 | 10.6 | 10371 | 8745 |
| case 2 | 6 | 473 | 433 | 445 | 28 | 23 | 1 / 0 | 1 | 2 | 6 of 6 | 6.1 | 10340 | 7638 |
| case 3 | 5 | 675 | 303 | 627 | 39 | 13 | 0 / 0 | 0 | 0 | 5 of 5 | 5.0 | 10334 | 7638 |
| case 4 | 3 | 729 | 390 | 677 | 52 | 38 | 0 / 4 | 2 | 0 | 3 of 3 | 2.3 | 10324 | 6572 |
| case 5 | 2 | 528 | 173 | 528 | 0 | 114 | 0 / 0 | 0 | 0 | 1 of 2 | 1.6 | 10317 | 6572 |
| case 6 | 2 | 574 | 239 | 574 | 0 | 119 | 0 / 0 | 0 | 0 | 1 of 2 | 1.6 | 10320 | 6572 |

The teacher's runtime excludes the one-time model load (about 19 s). Memory is the process's high-water mark (RSS) and MPS's driver allocation, one process per group.

## The teacher on these stills (consistency, not truth)

- Groups with finite poses: 6 of 6 by the pre-registered rule. **That rule is vacuous**: MapAnything's confidence is not a probability (the median over every group's boxes is 1.0 or more), so the
  "above 0.5" test passes for any finite pose. The stricter count, groups with two or more views on the group's shelf plane, is 4 of 6; 19 of 31 views lie on their group's plane.
- Against MoGe-2 (H-2) for the same stills, the angle between the teacher's group plane and MoGe-2's own plane in each still: median 4.2°, 90th percentile 73.7°;
  relative depth difference along the box rays after matching scale: median 0.025, 90th percentile 0.519.
- **Supplementary (not pre-registered):** the teacher's plane fitted to each still alone against MoGe-2's: at most 6.6° in every still of every group. Each view's own geometry agrees with MoGe-2; where the group plane
  disagrees with a view (the large angles above), the two stills' relative pose is inconsistent with one shelf plane. These stills cannot say whether that is the teacher's relative pose or a case whose stills face two different surfaces.

## IoU floor sensitivity (supplementary, not pre-registered, nothing tuned on it)

| IoU floor | Fused books of 2+ | Gain | Conflicts | Precision | Same-work recovery | Copy-unsafe books |
|---|---|---|---|---|---|---|
| 0.1 | 420 | 28/814 = 3.4 % (0.0 % to 5.1 %) | 26 | 41/74 = 55.4 % (25.0 % to 77.8 %) | 30/357 = 8.4 % (1.5 % to 40.9 %) | 0 |
| 0.3 | 390 | 28/814 = 3.4 % (0.0 % to 5.1 %) | 25 | 40/71 = 56.3 % (25.0 % to 100.0 %) | 29/357 = 8.1 % (1.5 % to 34.5 %) | 0 |
| 0.5 (pre-registered) | 275 | 26/814 = 3.2 % (0.0 % to 4.7 %) | 22 | 32/60 = 53.3 % (0.0 % to 100.0 %) | 23/357 = 6.4 % (0.0 % to 11.8 %) | 0 |
| 0.7 | 109 | 10/814 = 1.2 % (0.0 % to 1.8 %) | 6 | 13/20 = 65.0 % (65.0 % to 65.0 %) | 7/357 = 2.0 % (0.0 % to 2.2 %) | 0 |

## What this does and does not show

- The verdict reads the pre-registered IoU floor. The other floors were added after the first run, for this table only; none was chosen to change the verdict. A zero-width interval means one case supplied every pair.
- 2448 of 5757 boxes were lifted (the rest were in a view off its group's plane, or had too few confident pixels), and 606 boxes ended in a fused book of two or more.
- case 1 (13 stills, 507 of the 814 single-reader boxes) holds 25 of the 26 gains, so the bootstrap's lower bound is set by the cases that gained nothing.
- A gain here is a second reader (from another still) naming the same work as the single reader: machine agreement, not a correct label, and not admitted to TS-0.
