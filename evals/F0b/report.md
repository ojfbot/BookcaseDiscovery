# F0b: reader-crop geometry (F-0b)

Run 2026-11-03, card F-0b. **Question:** does changing how a spine's crop is cut and turned before it reaches the
readers lift F-0's outcomes, on the spines Q-1 found failing (lying flat, at the frame's edge) and on the owner's
oblique-top cases? Two sets, never merged (OC35): **`pilot-000`** (31 real-use photos, B2 boxes; every figure is
**machine agreement, never accuracy**, INV-17) and the **yardstick (PROXY)**, the 40-image Library Dataset sample with
B2 boxes, where `confirmed` means accepted *and* annotated in the image and `wrong` means accepted but not annotated.
No hand labels (OC36); nothing was trained or tuned on the yardstick. Every threshold below was fixed before the
first reading.

**Method.** F-0's cached boxes; each variant changes one crop step (`src/perceive/crop.ts`), re-reads only the boxes
that step touches with Vision and PP-OCR, re-runs F-0's Qwen hard-crop selection (same per-photo cap, the variant's
boxes competing with the rest of the photo's cached state), and re-decides with F-0's unchanged agreement rules and
catalog bar. *Before* is F-0's cached decision for the same box. Intervals are 95 % paired photo-cluster bootstraps
(2,000 draws) of the change in share, in percentage points. Masks are not in F-0's cache, so the face test re-derives
them (SAM 2.1 prompted with each polygon's box; `helpers/label/outline.py`). The keep rule: the `pilot-000`
confirmed-share interval excludes 0 upward, and on the yardstick the confirmed share does not fall, nor the
wrong-accept share rise, beyond its interval.

## Findings

1. **Clipping the crop to the frame ships.** `ocr-vision` refuses a polygon that runs past the photo's edge, so F-0
   never read 627 `pilot-000` and 79 yardstick boxes with Vision; such a box could be confirmed only by PP-OCR and
   Qwen agreeing. Trimming the polygon to the part inside the frame (614 pilot / 70 yardstick boxes, excluding
   boxes the orient step would also change): confirmed **+1.1 points (0.2 to 2.0)** on `pilot-000` (1.3 → 2.4 %)
   and **+10.0 (3.2 to 15.2)** on the yardstick (17.1 → 27.1 %), with no wrong accepts before or after. Text read
   +1.1 (−1.3 to 3.2) and +1.4 (0 to 5.5). Cost: about 1,140 more Vision calls per `pilot-000` pass (0.13 s each
   when the GPU is free); PP-OCR and Qwen calls unchanged. Shipped as `rect;rot=fixed;clip=frame`.
2. **Orienting from the long axis does not lift lying boxes, because most of them are not spines.** Read at 0°/180°
   (all four below aspect 2), the 407 lying `pilot-000` boxes moved +0.2 (−2.2 to 2.8) on text read and −0.5
   (−2.0 to 0.7) on confirmed; the yardstick's 66, +1.5 and 0. Every reading was checked to have used the new
   rotations. The private renders show why: these boxes are mostly shelf lips, rows of book bottoms, gaps and
   face-out covers, not spines lying flat, so there is nothing to read the right way round. Q-1's finding 3 (a crop
   bug) is not confirmed; the lever is filtering non-spine boxes at detection. The squat-upright stratum (132 pilot
   boxes under aspect 2, now also read at 0°/180°) did gain text, +4.5 (1.5 to 7.6), but confirmed +1.5 (0 to 3.3)
   does not exclude 0. Off by default.
3. **The spine-face crop (the owner's oblique-top hypothesis) helps on the yardstick but does not pass the rule.**
   On boxes flagged at the frame's edge (radial > 0.56, Q-1's H2 cut), partly out of frame, or oblique by their
   mask (sides converging > 2°, or a second plane at an end): `pilot-000` confirmed +0.8 (0.1 to 1.4) over 4,146
   boxes, but in frame only +0.7 (−0.1 to 1.4), most of the overall lift being the out-of-frame boxes' clip; text
   read **fell** −2.5 (−3.4 to −1.7). On the yardstick, confirmed rose +7.4 (2.5 to 12.6) and in frame +6.0 (1.2 to
   11.9), but wrong accepts also rose, +1.3 (0.5 to 2.1), and text read fell −3.8 (−5.7 to −2.2): it hurts the
   yardstick by the rule. Off by default. The `remask` control (the re-derived mask's plain rectangle, no side fit
   or trim) moved the yardstick's in-frame confirmed share by −1.2 (−3.1 to 0.4), so there the face's lift comes from
   the side fit and trim, not from segmenting at a higher resolution. On `pilot-000` the control and the face are
   indistinguishable in frame (confirmed +0.4, −0.3 to 1.2, against +0.7), and the control keeps text read (+0.5,
   −0.5 to 1.6) where the face loses it (−2.8): the trim is what costs text. In the private renders the trim does remove a
   book's top face where it shows beside the spine, the owner's case, but it also trims a spine's own top where a
   neighbour's mask bleeds into the bulge test, and many F-0 rectangles span two adjacent spines. That fits text
   read falling while matches rise: shorter, cleaner crops match more often and read less.
4. **Padding the ends does nothing.** 4 % at each end of the long axis on the same flagged boxes: yardstick
   confirmed +0.4 (−1.3 to 2.2), wrong 0 (−0.6 to 0.4); `pilot-000` text read +0.7 (0.1 to 1.3), confirmed +0.2 (−0.3 to 0.8), in frame +0.1 (−0.5 to 0.7). Off by
   default.
5. **Cost.** Re-read calls per box equal the method's rotations; only orient adds calls (four rotations on squat
   boxes, about a third more calls on its subset). Reader *seconds* in the tables below were measured while another card's models
   shared the GPU and three PP-OCR pools shared the CPU, so the after-times are inflated; compare calls, not seconds.

6. **Whole boxes against cut or partial ones (for F-0e).** On `pilot-000`, 3,825 of 6,894 boxes (55 %) are pieces of
   a spine: cut by a tile edge, or with a long side under 55 % of their machine shelf band's height (363 of 1,132 on
   the yardstick). F-0e re-tiles detection to remove most of them, so every variant is also split by box state;
   lifts on whole boxes are the ones that should carry over. Boxes in no band count as whole unless cut. **Clip**
   holds on whole boxes: +1.2 (0 to 2.6) on `pilot-000`, +10.3 (2.2 to 16.9) on the yardstick, so the
   pilot interval touches 0 on that stratum alone; the keep verdict stays on the pooled rule. **Face** hurts mainly on
   pieces: there the yardstick's text read falls −8.7 (−12.4 to −5.5) and confirmed does not rise, while on whole
   yardstick boxes confirmed rises +11.4 (5.8 to 18.0) with wrong accepts +1.6 (0.5 to 2.8). Trimming a box that is
   already a fragment loses text; the face crop is worth re-testing once F-0e's whole-spine boxes exist, still
   against the same keep rule. **Orient** and **pad** do not move on either stratum.

## What to try next

1. **Split boxes that span two spines and drop non-spine boxes at detection** (shelf lips, gaps, face-out covers).
   The renders show both are common; they cap what any crop change can do.
2. **A narrower face trim**, applied only where a second plane is a top face (the end nearer the camera's
   viewpoint, at the frame's edge) rather than wherever the mask bulges. To be judged on a fresh real-use session,
   not re-tuned on these two sets.
3. **Re-run F-0 on `pilot-000` with the shipped crop** to refresh its published aggregates. Every reading record
   now names its crop, so the re-run re-reads with `clip=frame`.

## Private outputs

Outlines, per-variant readings and decisions are under the data root's `private/f0b/<set>/`; before/after renders
(per-photo overviews and per-box crop pairs, changed outcomes first) are at `private/f0b/renders/<set>/index.html`.
Nothing per box or per photo is in the repository.

## Limits

- Masks for the face test are re-derived per box, not F-0's tile-pass masks; shipping the face crop would need
  detection to keep its outlines (`DetectedSpine.outline`), which it does not yet do.
- A variant's boxes compete for Qwen's per-photo cap against the other boxes' cached state; boxes outside the variant
  are not re-decided if displaced.
- The 54 `pilot-000` boxes (13 yardstick) that are partly out of frame and also changed by orient (lying or squat)
  were measured under orient only; the shipped clip changes them too, unmeasured.
- One camera, one bookstore and one library; `pilot-000` figures are machine agreement.

<!-- generated by src/eval/f0b-cli.ts analyse: edit above this line -->

## pilot-000 (real use (OC35): machine agreement, never accuracy (INV-17))

6894 boxes in 31 photos; mask outlines for 6894. Lying 407, squat upright 132, partly out of frame 668, at the frame's edge 2776, oblique by the mask 3274 (a second plane trimmed: 2144); flagged for the face and pad tests 4146; cut by a tile edge or under 55 % of their band's height 3825.

Shares in % of the boxes in each row, before → after (Δ points; 95 % paired photo-bootstrap interval). Machine agreement, never accuracy (INV-17).

| variant | boxes | photos | crop changed | text-read | confirmed |
|---|---:|---:|---:|---|---|
| **orient** | 539 | 31 | 539 | 47.7 → 49 (+1.3; -0.9 to 3.8) | 1.9 → 1.9 (+0; -1.3 to 1.1) |
|   orient: lying | 407 | 31 |  | 44.2 → 44.5 (+0.2; -2.2 to 2.8) | 1.5 → 1 (-0.5; -2 to 0.7) |
|   orient: squat upright | 132 | 27 |  | 58.3 → 62.9 (+4.5; 1.5 to 7.6) | 3 → 4.5 (+1.5; 0 to 3.3) |
|   orient: whole boxes | 69 | 19 |  | 39.1 → 44.9 (+5.8; -3.1 to 15.4) | 0 → 1.4 (+1.4; 0 to 4.3) |
|   orient: cut or partial boxes | 470 | 31 |  | 48.9 → 49.6 (+0.6; -1.6 to 2.8) | 2.1 → 1.9 (-0.2; -1.5 to 0.9) |
| **clip** | 614 | 31 | 602 | 56.5 → 57.7 (+1.1; -1.3 to 3.2) | 1.3 → 2.4 (+1.1; 0.2 to 2) |
|   clip: whole boxes | 417 | 31 |  | 61.4 → 62.8 (+1.4; -1.4 to 4.7) | 1.2 → 2.4 (+1.2; 0 to 2.6) |
|   clip: cut or partial boxes | 197 | 30 |  | 46.2 → 46.7 (+0.5; -3.7 to 4.1) | 1.5 → 2.5 (+1; -1 to 2.7) |
| **face** | 4146 | 31 | 4146 | 71.1 → 68.6 (-2.5; -3.4 to -1.7) | 8.1 → 8.9 (+0.8; 0.1 to 1.4) |
|   face: in frame | 3532 | 31 |  | 73.7 → 70.9 (-2.8; -3.9 to -1.8) | 9.3 → 10 (+0.7; -0.1 to 1.4) |
|   face: partly out of frame | 614 | 31 |  | 56.5 → 55.7 (-0.8; -3.1 to 1.2) | 1.3 → 2.8 (+1.5; 0.3 to 2.6) |
|   face: whole boxes | 2086 | 31 |  | 75.6 → 73.3 (-2.3; -3.3 to -1.4) | 8 → 8.7 (+0.7; -0.3 to 1.7) |
|   face: cut or partial boxes | 2060 | 31 |  | 66.6 → 63.9 (-2.7; -4.2 to -1.3) | 8.3 → 9.1 (+0.8; 0 to 1.6) |
|   face: out of frame, vs clip | 614 | 31 |  | 57.7 → 55.7 (-2; -4.3 to 0.2) | 2.4 → 2.8 (+0.3; -0.5 to 1.2) |
| **pad** | 4146 | 31 | 4146 | 71.1 → 71.8 (+0.7; 0.1 to 1.3) | 8.1 → 8.4 (+0.2; -0.3 to 0.8) |
|   pad: in frame | 3532 | 31 |  | 73.7 → 74.5 (+0.8; 0.2 to 1.5) | 9.3 → 9.4 (+0.1; -0.5 to 0.7) |
|   pad: partly out of frame | 614 | 31 |  | 56.5 → 56.7 (+0.2; -2.4 to 2.5) | 1.3 → 2.6 (+1.3; 0.2 to 2.3) |
|   pad: whole boxes | 2086 | 31 |  | 75.6 → 76.1 (+0.5; -0.6 to 1.4) | 8 → 8.2 (+0.3; -0.6 to 1.3) |
|   pad: cut or partial boxes | 2060 | 31 |  | 66.6 → 67.5 (+0.9; 0.2 to 1.8) | 8.3 → 8.5 (+0.2; -0.4 to 0.7) |
|   pad: out of frame, vs clip | 614 | 31 |  | 57.7 → 56.7 (-1; -2.2 to 0.1) | 2.4 → 2.6 (+0.2; -0.4 to 0.7) |
| **remask** | 4146 | 31 | 4140 | 71.1 → 72 (+0.8; -0.2 to 1.9) | 8.1 → 8.7 (+0.6; -0.1 to 1.3) |
|   remask: in frame | 3532 | 31 |  | 73.7 → 74.2 (+0.5; -0.5 to 1.6) | 9.3 → 9.7 (+0.4; -0.3 to 1.2) |
|   remask: partly out of frame | 614 | 31 |  | 56.5 → 59.1 (+2.6; -0.9 to 6) | 1.3 → 2.9 (+1.6; 0.3 to 2.9) |
|   remask: whole boxes | 2086 | 31 |  | 75.6 → 75.9 (+0.3; -1.1 to 1.9) | 8 → 8.3 (+0.3; -0.6 to 1.2) |
|   remask: cut or partial boxes | 2060 | 31 |  | 66.6 → 68 (+1.4; 0.1 to 2.7) | 8.3 → 9.1 (+0.8; -0.1 to 1.8) |
|   remask: out of frame, vs clip | 614 | 31 |  | 57.7 → 59.1 (+1.5; -0.7 to 3.7) | 2.4 → 2.9 (+0.5; -0.4 to 1.4) |

Cost on the same boxes, before → after: reader calls (one crop at one rotation) and summed reader seconds.

| variant | Vision calls | Vision s | PP-OCR calls | PP-OCR s | Qwen calls | Qwen s |
|---|---:|---:|---:|---:|---:|---:|
| orient | 976 → 1296 | 67 → 219 | 1078 → 1448 | 656 → 1827 | 168 → 294 | 135 → 730 |
| clip | 76 → 1212 | 70 → 355 | 1228 → 1212 | 870 → 2122 | 198 → 202 | 177 → 452 |
| face | 7140 → 8216 | 504 → 1273 | 8292 → 8290 | 5127 → 8109 | 1290 → 1264 | 1048 → 1540 |
| pad | 7140 → 8274 | 504 → 2236 | 8292 → 8274 | 5127 → 7794 | 1290 → 1298 | 1048 → 2108 |
| remask | 7140 → 8256 | 504 → 1711 | 8292 → 8256 | 5127 → 8542 | 1290 → 1292 | 1048 → 1132 |

## yardstick-library-b2 (PROXY: Library Dataset sample, box arm B2; confirmed = accepted and annotated in the image)

1132 boxes in 40 photos; mask outlines for 1132. Lying 66, squat upright 31, partly out of frame 83, at the frame's edge 273, oblique by the mask 456 (a second plane trimmed: 328); flagged for the face and pad tests 557; cut by a tile edge or under 55 % of their band's height 363.

Shares in % of the boxes in each row, before → after (Δ points; 95 % paired photo-bootstrap interval). Confirmed = accepted and annotated in the image; wrong = accepted, not annotated.

| variant | boxes | photos | crop changed | text-read | confirmed | wrong |
|---|---:|---:|---:|---|---|---|
| **orient** | 97 | 25 | 97 | 28.9 → 29.9 (+1; -2.8 to 3.9) | 1 → 1 (+0; 0 to 0) | 2.1 → 2.1 (+0; 0 to 0) |
|   orient: lying | 66 | 22 |  | 22.7 → 24.2 (+1.5; -4.3 to 5.7) | 1.5 → 1.5 (+0; 0 to 0) | 3 → 3 (+0; 0 to 0) |
|   orient: squat upright | 31 | 16 |  | 41.9 → 41.9 (+0; 0 to 0) | 0 → 0 (+0; 0 to 0) | 0 → 0 (+0; 0 to 0) |
|   orient: whole boxes | 19 | 11 |  | 21.1 → 15.8 (-5.3; -13.6 to 0) | 0 → 0 (+0; 0 to 0) | 10.5 → 10.5 (+0; 0 to 0) |
|   orient: cut or partial boxes | 78 | 23 |  | 30.8 → 33.3 (+2.6; 0 to 5.2) | 1.3 → 1.3 (+0; 0 to 0) | 0 → 0 (+0; 0 to 0) |
| **clip** | 70 | 20 | 70 | 78.6 → 80 (+1.4; 0 to 5.5) | 17.1 → 27.1 (+10; 3.2 to 15.2) | 0 → 0 (+0; 0 to 0) |
|   clip: whole boxes | 58 | 17 |  | 86.2 → 86.2 (+0; 0 to 0) | 20.7 → 31 (+10.3; 2.2 to 16.9) | 0 → 0 (+0; 0 to 0) |
|   clip: cut or partial boxes | 12 | 8 |  | 41.7 → 50 (+8.3; 0 to 30) | 0 → 8.3 (+8.3; 0 to 30) | 0 → 0 (+0; 0 to 0) |
| **face** | 557 | 40 | 557 | 72.7 → 68.9 (-3.8; -5.7 to -2.2) | 17.6 → 25 (+7.4; 2.5 to 12.6) | 0.9 → 2.2 (+1.3; 0.5 to 2.1) |
|   face: in frame | 487 | 40 |  | 71.9 → 68 (-3.9; -6.1 to -2.1) | 17.7 → 23.6 (+6; 1.2 to 11.9) | 1 → 2.5 (+1.4; 0.6 to 2.4) |
|   face: partly out of frame | 70 | 20 |  | 78.6 → 75.7 (-2.9; -8.3 to 0) | 17.1 → 34.3 (+17.1; 4.6 to 30) | 0 → 0 (+0; 0 to 0) |
|   face: whole boxes | 385 | 40 |  | 87.3 → 85.7 (-1.6; -3.4 to 0) | 22.6 → 34 (+11.4; 5.8 to 18) | 1.3 → 2.9 (+1.6; 0.5 to 2.8) |
|   face: cut or partial boxes | 172 | 30 |  | 40.1 → 31.4 (-8.7; -12.4 to -5.5) | 6.4 → 4.7 (-1.7; -5.8 to 3) | 0 → 0.6 (+0.6; 0 to 1.7) |
|   face: out of frame, vs clip | 70 | 20 |  | 80 → 75.7 (-4.3; -10.8 to 0) | 27.1 → 34.3 (+7.1; -3.7 to 17.3) | 0 → 0 (+0; 0 to 0) |
| **pad** | 557 | 40 | 557 | 72.7 → 72.7 (+0; -0.7 to 0.8) | 17.6 → 18 (+0.4; -1.3 to 2.2) | 0.9 → 0.9 (+0; -0.6 to 0.4) |
|   pad: in frame | 487 | 40 |  | 71.9 → 72.1 (+0.2; -0.5 to 1) | 17.7 → 17 (-0.6; -2.2 to 1) | 1 → 0.8 (-0.2; -0.7 to 0) |
|   pad: partly out of frame | 70 | 20 |  | 78.6 → 77.1 (-1.4; -5.7 to 0) | 17.1 → 24.3 (+7.1; 0 to 11.9) | 0 → 1.4 (+1.4; 0 to 5.8) |
|   pad: whole boxes | 385 | 40 |  | 87.3 → 87.3 (+0; -0.7 to 0.8) | 22.6 → 23.1 (+0.5; -1.7 to 2.9) | 1.3 → 1.3 (+0; -0.9 to 0.7) |
|   pad: cut or partial boxes | 172 | 30 |  | 40.1 → 40.1 (+0; -1.7 to 1.8) | 6.4 → 6.4 (+0; -2 to 2.6) | 0 → 0 (+0; 0 to 0) |
|   pad: out of frame, vs clip | 70 | 20 |  | 80 → 77.1 (-2.9; -8.6 to 0) | 27.1 → 24.3 (-2.9; -8.9 to 0) | 0 → 1.4 (+1.4; 0 to 5.9) |
| **remask** | 557 | 40 | 557 | 72.7 → 72 (-0.7; -2.2 to 0.6) | 17.6 → 18 (+0.4; -1.8 to 2.8) | 0.9 → 1.3 (+0.4; -0.4 to 1) |
|   remask: in frame | 487 | 40 |  | 71.9 → 70.8 (-1; -2.6 to 0.4) | 17.7 → 16.4 (-1.2; -3.1 to 0.4) | 1 → 1.2 (+0.2; -0.5 to 0.8) |
|   remask: partly out of frame | 70 | 20 |  | 78.6 → 80 (+1.4; 0 to 5.1) | 17.1 → 28.6 (+11.4; 2.9 to 19.8) | 0 → 1.4 (+1.4; 0 to 3.3) |
|   remask: whole boxes | 385 | 40 |  | 87.3 → 86.8 (-0.5; -1.8 to 0.5) | 22.6 → 22.9 (+0.3; -2.6 to 3.7) | 1.3 → 1.8 (+0.5; -0.5 to 1.4) |
|   remask: cut or partial boxes | 172 | 30 |  | 40.1 → 39 (-1.2; -4.4 to 2.1) | 6.4 → 7 (+0.6; -2.3 to 3.8) | 0 → 0 (+0; 0 to 0) |
|   remask: out of frame, vs clip | 70 | 20 |  | 80 → 80 (+0; 0 to 0) | 27.1 → 28.6 (+1.4; -4.7 to 8.8) | 0 → 1.4 (+1.4; 0 to 3.4) |

Cost on the same boxes, before → after: reader calls (one crop at one rotation) and summed reader seconds.

| variant | Vision calls | Vision s | PP-OCR calls | PP-OCR s | Qwen calls | Qwen s |
|---|---:|---:|---:|---:|---:|---:|
| orient | 168 → 258 | 15 → 18 | 194 → 292 | 220 → 438 | 28 → 52 | 49 → 198 |
| clip | 8 → 140 | 7 → 29 | 140 → 140 | 253 → 778 | 88 → 78 | 127 → 321 |
| face | 982 → 1102 | 93 → 110 | 1114 → 1114 | 1902 → 2247 | 476 → 372 | 699 → 1323 |
| pad | 982 → 1112 | 93 → 400 | 1114 → 1112 | 1902 → 3208 | 476 → 470 | 699 → 1268 |
| remask | 982 → 1110 | 93 → 265 | 1114 → 1110 | 1902 → 4135 | 476 → 460 | 699 → 917 |

## Verdicts

| variant | pilot-000 confirmed interval excludes 0 upward | yardstick not hurt | keep |
|---|---|---|---|
| orient | no | yes | **off** |
| clip | yes | yes | **keep** |
| face | yes | no | **off** |
| pad | no | yes | **off** |
