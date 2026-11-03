# Q2: teacher table and first student (capture quality)

Run 2026-11-03, card Q-2 ([`docs/capture/coverage.md`](../../docs/capture/coverage.md) §5 and the Q-2 row of §6).
**Question:** give every detected box a coverage rung (the teacher). Can cheap still-tier signals predict whether a box
reaches `text-read`, the fill line (the student)? And does the owner's observation hold, that top edges are missed at
frame edges and in oblique views where a book's top face shows beside its spine?

**Inputs.** F-0's cached stage outputs (B2 boxes, three readers, decisions) and Q-1's private per-box features, for
`pilot-000` (31 real-use photos, 6,894 boxes) and yardstick B2 (40 Library Dataset images, 1,132 boxes, PROXY). There
were no new model runs: one new pixel pass measures each box's top edge. Rungs are **machine agreement, not
accuracy** (INV-17). The two sets are reported side by side, never pooled (OC35). The student is **trained on
`pilot-000` only**: leave-one-image-out there, then one fit on all 31 photos scores the yardstick unchanged (H-0
§4.3). Every interval is a 95 % photo bootstrap (1,000 draws). For any comparison between models, the draw is paired
across them.

## Verdict

**NO-GO on the predicted fill.** The student's AUC on `pilot-000` is **0.729 (0.69–0.76)**, under the 0.75 bar.

The gain half of the rule passes easily: **+0.28 (0.21 to 0.34)** over crop width, and +0.20 (0.16 to 0.25) even
over crop width ranked in its best direction with hindsight. The shortfall is not a fold artefact either: the
in-sample AUC is also 0.73.

Per §5, the live layer shows `seen` only, and the fill waits for measured outcomes. **FILL_P = 0.70**, Q-0's start,
is kept because no score reaches the 90 % precision target (best 82 %). At 0.70 the student fills 39 % of
`pilot-000` boxes, and 78 % (73–82) of those fills are measured at `text-read` or above.

## Findings

1. **The teacher splits `no-catalog-match` about in half, and τ = 0.71.** Two readers "agree" when the shorter
   squashed reading matches some substring of the longer one at similarity ≥ τ. τ is the smallest value at which
   only 1 % of null pairs agree. A null pair is one reader on a box against another reader on a *different* box of
   the same photo, so it cannot truly agree. At τ = 0.71, 81 % of catalog-confirmed `pilot-000` boxes also agree
   (88 % on the yardstick). That is the agreement test's hit rate on text known to be legible.
   - **`pilot-000`:** of the 3,435 `no-catalog-match` boxes, 1,695 become `text-read` (legible, not in the ISFDB
     catalog) and 1,740 stay `text-present` (garbled). Over all detected boxes the rungs are spine-found 25 %,
     text-present 25 %, text-read 25 %, matched 15 % and confirmed 10 %. Half the boxes reach the fill line.
   - **Yardstick:** 76 % of `no-catalog-match` is legible. Its null pass is 5 % at the same τ: library shelves have
     more near-identical neighbours, such as series and call-number labels.
2. **The box-score floor stays at Q-1's 0.225.** Below it, `spine-found` is 36 % of `pilot-000` boxes against 17 %
   above, and 61 % against 11 % on the yardstick. So the floor removes mostly blank or false boxes, as §5 intends.
   - Raising the floor lowers the student's AUC: from 0.75 with no floor to 0.72 at 0.30. False boxes are easy
     negatives.
   - With no floor the student would touch 0.75. It would do that by counting likely false boxes, which is exactly
     what §5's floor forbids.
   - Lying boxes are also left out (195 at or above the floor). F-0's reader cannot read them (Q-1 finding 3), so
     their rung is a pipeline artefact. Letting them back in changes nothing (0.73).
3. **The student is box detail plus tilt.** The monotone fit keeps two of S-S2's five signals:
   - **detail** (`lapVarNorm`, +0.95 SD; dropping it costs 0.20 AUC);
   - **tilt** (−0.30 SD; dropping it costs 0.012, interval excludes 0).

   It drops the other three in all 31 folds, because each comes out against its hypothesised sign:
   - **crop width:** wider boxes are read *less* often at 46 MP;
   - **glare share:** clipped highlights go with glossy print, as in Q-1;
   - **distance of mean luma from mid-grey.**

   Learning every direction freely reaches 0.749. But that variant learns "wider is worse", which does not hold
   off this camera: its calibration on the yardstick collapses (ECE 0.44). The sign constraint is what lets the
   student transfer at all.
4. **The student sees "is there crisp detail", not "is it legible".** Filled boxes against `spine-found` give AUC
   0.86 (`pilot-000`) and 0.94 (yardstick). Filled against `text-present` give only 0.63 and 0.60. The fill line
   runs exactly through the hard pair, garbled against legible, and no S-S2 signal sees that difference.
5. **Calibration holds at home and shifts away.** On `pilot-000`, ECE is 0.028 (0.022–0.054) and Brier 0.199. The
   reliability curve tracks the diagonal up to a score of 0.8, then flattens near 0.78 measured. On the yardstick,
   AUC transfers (0.80, 0.75–0.87), but the student is under-confident (ECE 0.28): shelf-scale crops are easier, at
   82 % filled against 60 %. Any live use needs recalibration in the target domain.
6. **The owner's top-edge pattern is real, and it sits where the owner saw it.** The top seam is the strongest
   colour step across the spine near its top (`helpers/coverage/geometry.py`). On `pilot-000`, the share of boxes
   whose top is off the spine's top edge rises from 37 % (centre, top not in view) to 79 % (centre, top in view) and
   72 % (edge, top in view). Overshoot dominates: the box runs past the spine's top edge onto the top face or the
   shelf behind, in 54 % and 47 % of boxes. The private top-edge renders show it shelf by shelf. Readability falls in
   the same cells: 70 % filled at the centre against 46 % at the edge, and 68 % with the top out of view against
   44 % in view (34 % at the edge with the top in view).
7. **But the box edge explains little beyond the view itself.** Adding the two geometry features (top-seam offset,
   box height against its band) gives ΔAUC **+0.009 (0.002 to 0.015)** on `pilot-000` and **+0.015 (0.002 to 0.027)**
   on the yardstick: real but small. Within a cell, the overshoot and clean boxes read alike, except at the edge
   with the top out of view (47 % against 64 %). Where the top is in view, the features add nothing (−0.012, −0.026
   to 0.001). The view itself, as the top end's height in the frame, adds +0.012 (0.000 to 0.023). Reading: the
   oblique view costs reads, and the overshooting box is its visible trace. It is not a second, independent cause.
   - **Unvalidated:** the seam is a heuristic, checked on synthetic images and by eye on the renders, against no
     labels.
   - **Yardstick:** its shelf-scale strips have only 30 boxes with the top in view, so it cannot test the oblique
     half.

## What Q-3, Q-4 and Q-5 should take from this

- **Q-3 (coverage map on stills).**
  - Draw the **measured** map from this teacher: τ 0.71, floor 0.225, lying boxes outside, and a segment's rung as
    the minimum over its boxes. Draw the **predicted** map with the student at FILL_P 0.70 for comparison only,
    since the rule says no-go for live use.
  - Expect the two to disagree mostly by under-filling. At 0.70, half the measured-filled boxes are predicted
    patchy: the orange cells in the agreement renders.
  - Report κ separately for centre and edge, and for top-in-view and not. The edge cells and the shelves seen from
    above are where both layers go patchy.
- **Q-4 (pixels and blur).**
  - Crop width carries no signal at 46 MP; it even points the wrong way. Degrading to 1080p and 4K is the only way
    to find where S-L1 starts to bind, so measure it there.
  - Detail is the student's one strong term, and blur attacks it directly. Track the `logDetail` weight and the
    student's calibration under each degradation, and refit and recalibrate per domain. The yardstick's ECE 0.28
    is the warning.
- **Q-5 (glare and angle).**
  - Clipped-highlight share is the wrong glare measure: it rises with glossy print. Use S-L5 as written, connected
    highlight blobs away from text.
  - Tilt helps a little. The larger angle effect is **vertical**: books whose tops face the camera read 24 points
    less often. Add the viewing elevation of the top (here `topBelowCentre`), with the overshoot class as its pixel
    cue, and split by the INV-20 viewpoint bucket.
  - A cheap pipeline test follows from finding 7: re-read the overshooting boxes trimmed to their seam, from F-0's
    cached crops, in the spirit of Q-1's rotation fix. If reads rise, the fix belongs in the box step, not in
    capture.
- **For the go rule, next time.** The missing signal is text presence: S-S3, PP-OCR detection only or Vision text
  rectangles. The student fails on garbled against legible (AUC 0.63), and S-S3 is the cheapest signal that sees
  text at all. Q-5, or a Q-2b, should add it before the predicted fill is retried.

## Private outputs

Everything per box or per photo lives under the data root's `private/q2/`, never in the repo:
- `geometry/`: the top seam per box;
- `table/`: rung, population flag, student, baseline and geometry scores, and the top class per box;
- `renders/<set>/index.html`, per photo:
  - the measured fill;
  - the predicted fill (solid at or above FILL_P);
  - measured against predicted (blue: predicted filled but measured below, the closer-look case; orange: measured
    filled but predicted patchy);
  - the top-edge overlay: the seam drawn across each box, overshoot magenta and cut orange, with the frame-edge
    ellipse and the top-in-view line.

Regenerate everything with `node src/eval/q2-cli.ts all`, after `uv sync` in `helpers/coverage` and Q-1's
`features` and `analyse`.

<!-- Tables below are generated by `node src/eval/q2-cli.ts analyse`; edit above this line only. -->

## Teacher table: coverage rung per detected box (B2)

τ = 0.71 (string agreement), box-score floor = 0.225. Counts are machine agreement, not accuracy.

| set | group | n | spine-found | text-present | text-read | matched | confirmed |
|---|---|---:|---:|---:|---:|---:|---:|
| pilot-000 | all detected | 6894 | 1738 (25 %) | 1740 (25 %) | 1695 (25 %) | 1003 (15 %) | 718 (10 %) |
| pilot-000 | below floor | 2741 | 989 (36 %) | 777 (28 %) | 494 (18 %) | 356 (13 %) | 125 (5 %) |
| pilot-000 | lying, at/above floor | 195 | 95 (49 %) | 44 (23 %) | 44 (23 %) | 9 (5 %) | 3 (2 %) |
| pilot-000 | **student population** | 3958 | 654 (17 %) | 919 (23 %) | 1157 (29 %) | 638 (16 %) | 590 (15 %) |
| yardstick B2 | all detected | 1132 | 290 (26 %) | 99 (9 %) | 313 (28 %) | 161 (14 %) | 269 (24 %) |
| yardstick B2 | below floor | 320 | 194 (61 %) | 38 (12 %) | 54 (17 %) | 12 (4 %) | 22 (7 %) |
| yardstick B2 | lying, at/above floor | 19 | 11 (58 %) | 5 (26 %) | 0 (0 %) | 1 (5 %) | 2 (11 %) |
| yardstick B2 | **student population** | 793 | 85 (11 %) | 56 (7 %) | 259 (33 %) | 148 (19 %) | 245 (31 %) |

- pilot-000: 31 photos; filled share of the population 60 % (55–65); 0 boxes left out for an unmeasurable feature.
- yardstick B2: 40 photos; filled share of the population 82 % (77–87); 0 boxes left out for an unmeasurable feature; 22 accepted boxes name a work not in the photo's annotations (kept at `confirmed`: the teacher cannot see annotations).

### Setting τ: null pairing versus real agreement

Null pass: share of null pairs (one reader on a box, another reader on a different box of the same photo) at or above τ. Accepted pass: share of catalog-confirmed boxes whose readers' strings agree at τ. No-match pass: share of `no-catalog-match` boxes promoted to `text-read`.

| τ | pilot-000 null | accepted | no-match | yardstick B2 null | accepted | no-match |
|---:|---:|---:|---:|---:|---:|---:|
| 0.6 | 4 % | 92 % | 60 % | 10 % | 97 % | 84 % |
| 0.7 | 1 % | 84 % | 50 % | 5 % | 89 % | 77 % |
| **0.71** | 1 % | 81 % | 49 % | 5 % | 88 % | 76 % |
| 0.75 | 1 % | 79 % | 46 % | 4 % | 85 % | 73 % |
| 0.8 | 1 % | 73 % | 41 % | 3 % | 81 % | 68 % |
| 0.85 | 0 % | 69 % | 34 % | 2 % | 74 % | 60 % |
| 0.9 | 0 % | 64 % | 28 % | 2 % | 66 % | 52 % |
| 0.95 | 0 % | 52 % | 22 % | 1 % | 56 % | 45 % |
| 1 | 0 % | 42 % | 19 % | 1 % | 45 % | 38 % |

## Student: AUC, gain over the crop-width baseline, calibration

pilot-000 scores are leave-one-image-out; the yardstick is scored by one fit on all of pilot-000, unchanged. Intervals: paired photo bootstrap.

| model | pilot-000 AUC | Δ vs baseline | Δ vs student | ECE | Brier | yardstick B2 AUC | Δ vs baseline | Δ vs student | ECE | Brier |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline | 0.45 (0.42–0.49) | – | – | 0.041 (0.022–0.072) | 0.241 (0.231–0.254) | 0.45 (0.39–0.50) | – | – | 0.246 (0.194–0.289) | 0.208 (0.202–0.216) |
| student | 0.73 (0.69–0.76) | +0.276 (0.212 to 0.336) | – | 0.028 (0.022–0.054) | 0.199 (0.187–0.211) | 0.80 (0.75–0.87) | +0.355 (0.265 to 0.459) | – | 0.281 (0.236–0.324) | 0.188 (0.173–0.205) |
| student-logCropWidthPx | 0.73 (0.69–0.76) | +0.276 (0.212 to 0.336) | +0.000 (0.000 to 0.000) | 0.028 (0.022–0.054) | 0.199 (0.187–0.211) | 0.80 (0.75–0.87) | +0.355 (0.265 to 0.459) | +0.000 (0.000 to 0.000) | 0.281 (0.236–0.324) | 0.188 (0.173–0.205) |
| student-logDetail | 0.53 (0.49–0.56) | +0.075 (0.024 to 0.126) | -0.202 (-0.257 to -0.155) | 0.007 (0.009–0.067) | 0.239 (0.228–0.252) | 0.50 (0.41–0.57) | +0.051 (-0.039 to 0.126) | -0.305 (-0.413 to -0.223) | 0.200 (0.151–0.242) | 0.185 (0.176–0.197) |
| student-glareShare | 0.73 (0.69–0.76) | +0.276 (0.212 to 0.336) | +0.000 (0.000 to 0.000) | 0.028 (0.022–0.054) | 0.199 (0.187–0.211) | 0.80 (0.75–0.87) | +0.355 (0.265 to 0.459) | +0.000 (0.000 to 0.000) | 0.281 (0.236–0.324) | 0.188 (0.173–0.205) |
| student-lumaOffMid | 0.73 (0.69–0.76) | +0.276 (0.212 to 0.336) | +0.000 (0.000 to 0.000) | 0.028 (0.022–0.054) | 0.199 (0.187–0.211) | 0.80 (0.75–0.87) | +0.355 (0.265 to 0.459) | +0.000 (0.000 to 0.000) | 0.281 (0.236–0.324) | 0.188 (0.173–0.205) |
| student-tiltDeg | 0.72 (0.68–0.75) | +0.264 (0.201 to 0.321) | -0.012 (-0.019 to -0.003) | 0.027 (0.020–0.056) | 0.202 (0.192–0.214) | 0.80 (0.74–0.87) | +0.352 (0.258 to 0.459) | -0.003 (-0.011 to 0.005) | 0.302 (0.257–0.345) | 0.202 (0.188–0.220) |
| student+heightOffBand | 0.73 (0.69–0.76) | +0.278 (0.212 to 0.337) | +0.001 (-0.002 to 0.004) | 0.026 (0.019–0.051) | 0.199 (0.187–0.211) | 0.81 (0.75–0.87) | +0.361 (0.272 to 0.464) | +0.005 (-0.002 to 0.012) | 0.281 (0.235–0.325) | 0.188 (0.172–0.208) |
| student+topSeamOff | 0.74 (0.70–0.77) | +0.284 (0.220 to 0.341) | +0.007 (0.002 to 0.013) | 0.026 (0.022–0.053) | 0.196 (0.184–0.209) | 0.81 (0.76–0.87) | +0.365 (0.274 to 0.463) | +0.009 (-0.005 to 0.024) | 0.274 (0.232–0.316) | 0.183 (0.167–0.203) |
| student+geometry | 0.74 (0.70–0.77) | +0.285 (0.219 to 0.343) | +0.009 (0.002 to 0.014) | 0.023 (0.019–0.049) | 0.196 (0.183–0.210) | 0.82 (0.77–0.88) | +0.371 (0.285 to 0.469) | +0.015 (0.002 to 0.027) | 0.276 (0.234–0.318) | 0.183 (0.167–0.204) |
| diag:signFree | 0.75 (0.71–0.78) | +0.296 (0.232 to 0.353) | +0.020 (0.008 to 0.029) | 0.019 (0.017–0.045) | 0.193 (0.180–0.205) | 0.82 (0.77–0.88) | +0.370 (0.291 to 0.463) | +0.015 (-0.005 to 0.036) | 0.436 (0.386–0.485) | 0.309 (0.282–0.341) |
| diag:student+viewElevation | 0.74 (0.71–0.77) | +0.289 (0.230 to 0.343) | +0.012 (0.000 to 0.023) | 0.036 (0.027–0.060) | 0.194 (0.182–0.206) | 0.80 (0.75–0.87) | +0.356 (0.264 to 0.453) | +0.001 (-0.016 to 0.016) | 0.238 (0.196–0.279) | 0.163 (0.148–0.179) |

- pilot-000: n = 3958 boxes in 31 photos, filled share 60 % (54–65).
- yardstick B2: n = 793 boxes in 40 photos, filled share 82 % (77–86).

Weights of the full pilot-000 fit, on standardised features (0 = dropped by the monotone rule). Folds dropping: of 31 leave-one-out fits, how many dropped the feature.

| model | logCropWidthPx | logDetail | glareShare | lumaOffMid | tiltDeg | heightOffBand | topSeamOff | topBelowCentre | dropped (full fit) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| baseline | -0.07 |  |  |  |  |  |  |  | – |
| student | 0.00 (31/31) | 0.95 | 0.00 (31/31) | 0.00 (31/31) | -0.30 |  |  |  | logCropWidthPx, lumaOffMid, glareShare |
| student-logCropWidthPx |  | 0.95 | 0.00 (31/31) | 0.00 (31/31) | -0.30 |  |  |  | lumaOffMid, glareShare |
| student-logDetail | 0.00 (31/31) |  | 0.00 (31/31) | 0.00 (31/31) | -0.22 |  |  |  | glareShare, lumaOffMid, logCropWidthPx |
| student-glareShare | 0.00 (31/31) | 0.95 |  | 0.00 (31/31) | -0.30 |  |  |  | logCropWidthPx, lumaOffMid |
| student-lumaOffMid | 0.00 (31/31) | 0.95 | 0.00 (31/31) |  | -0.30 |  |  |  | logCropWidthPx, glareShare |
| student-tiltDeg | 0.00 (31/31) | 0.93 | 0.00 (31/31) | 0.00 (31/31) |  |  |  |  | logCropWidthPx, lumaOffMid, glareShare |
| student+heightOffBand | 0.00 (31/31) | 0.95 | 0.00 (31/31) | 0.00 (31/31) | -0.29 | -0.11 |  |  | logCropWidthPx, lumaOffMid, glareShare |
| student+topSeamOff | 0.00 (31/31) | 0.96 | 0.00 (31/31) | 0.00 (31/31) | -0.28 |  | -0.26 |  | logCropWidthPx, lumaOffMid, glareShare |
| student+geometry | 0.00 (31/31) | 0.96 | 0.00 (31/31) | 0.00 (31/31) | -0.27 | -0.10 | -0.25 |  | logCropWidthPx, lumaOffMid, glareShare |
| diag:signFree | -0.40 | 1.12 | -0.01 | 0.13 | -0.22 |  |  |  | – |
| diag:student+viewElevation | 0.00 (31/31) | 0.95 | 0.00 (16/31) | 0.00 (31/31) | -0.24 |  |  | -0.34 | logCropWidthPx, lumaOffMid, glareShare |

### Reliability (student; 10 equal-width bins of the predicted score)

| bin | pilot-000 n | mean score | measured filled | yardstick B2 n | mean score | measured filled |
|---|---:|---:|---:|---:|---:|---:|
| 0.0–0.1 | 46 | 0.07 | 0.00 | 20 | 0.06 | 0.00 |
| 0.1–0.2 | 134 | 0.16 | 0.09 | 40 | 0.14 | 0.25 |
| 0.2–0.3 | 218 | 0.25 | 0.24 | 47 | 0.25 | 0.57 |
| 0.3–0.4 | 326 | 0.35 | 0.36 | 56 | 0.35 | 0.71 |
| 0.4–0.5 | 433 | 0.45 | 0.45 | 95 | 0.45 | 0.85 |
| 0.5–0.6 | 528 | 0.55 | 0.58 | 170 | 0.56 | 0.90 |
| 0.6–0.7 | 715 | 0.65 | 0.69 | 196 | 0.65 | 0.93 |
| 0.7–0.8 | 863 | 0.75 | 0.77 | 132 | 0.74 | 0.94 |
| 0.8–0.9 | 646 | 0.84 | 0.79 | 37 | 0.83 | 0.95 |
| 0.9–1.0 | 49 | 0.91 | 0.78 | 0 | – | – |

## Go rule

Student AUC on pilot-000 0.73 (0.69–0.76) (rule: ≥ 0.75); gain over crop width +0.276 (0.212 to 0.336) (rule: interval excludes 0). **NO-GO** on the predicted fill.

Unrounded: student 0.729; sign-free diagnostic 0.749.

Robustness (paired photo bootstrap). Oracle width: crop width ranked in the better direction with hindsight, no folds. Against each negative: filled boxes versus `spine-found` only, and versus `text-present` only. In-sample: the full pilot-000 fit scored on its own training rows (optimistic).

| set | oracle width AUC | student − oracle width | student vs spine-found | student vs text-present | student in-sample |
|---|---:|---:|---:|---:|---:|
| pilot-000 | 0.52 (0.50–0.55) | +0.204 (0.159 to 0.248) | 0.86 (0.84–0.88) | 0.63 (0.60–0.67) | 0.73 (0.70–0.77) |
| yardstick B2 | 0.55 (0.51–0.60) | +0.251 (0.193 to 0.315) | 0.94 (0.90–0.97) | 0.60 (0.51–0.72) | 0.80 (0.75–0.86) |

Diagnostic, not the go rule: the same five features with every direction learned give 0.75 (0.71–0.78), gain +0.296 (0.232 to 0.353) (would not pass).

## Operating point (FILL_P)

No score reaches the precision target on pilot-000 (best 82 % where at least 5 % are filled). FILL_P = **0.7**, Q-0's starting value, proposed unchanged.

| set | filled share | precision (measured ≥ text-read) | recall |
|---|---:|---:|---:|
| pilot-000 | 39 % (33–45) | 78 % (73–82) | 51 % (45–55) |
| yardstick B2 | 21 % (17–26) | 94 % (90–98) | 24 % (19–30) |

| score ≥ | pilot-000 filled | precision | recall | yardstick B2 filled | precision | recall |
|---:|---:|---:|---:|---:|---:|---:|
| 0.30 | 90 % | 65 % | 97 % | 87 % | 90 % | 94 % |
| 0.35 | 86 % | 67 % | 95 % | 83 % | 91 % | 92 % |
| 0.40 | 82 % | 68 % | 92 % | 79 % | 91 % | 88 % |
| 0.45 | 77 % | 70 % | 89 % | 73 % | 91 % | 82 % |
| 0.50 | 71 % | 72 % | 84 % | 67 % | 92 % | 76 % |
| 0.55 | 64 % | 73 % | 79 % | 58 % | 93 % | 65 % |
| 0.60 | 57 % | 75 % | 71 % | 46 % | 93 % | 52 % |
| 0.65 | 49 % | 76 % | 62 % | 34 % | 94 % | 39 % |
| 0.70 | 39 % | 78 % | 51 % | 21 % | 94 % | 24 % |
| 0.75 | 28 % | 79 % | 37 % | 11 % | 93 % | 13 % |
| 0.80 | 18 % | 79 % | 23 % | 5 % | 95 % | 5 % |
| 0.85 | 8 % | 82 % | 10 % | 1 % | 100 % | 2 % |
| 0.90 | 1 % | 78 % | 2 % | 0 % | – | 0 % |
| 0.95 | 0 % | – | 0 % | 0 % | – | 0 % |

## Sensitivity: box-score floor and lying boxes

| population | pilot-000 n | student AUC | baseline AUC | gain | filled | yardstick B2 n | student AUC | baseline AUC | gain | filled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| noFloor | 6487 | 0.75 (0.72–0.78) | 0.42 (0.38–0.48) | +0.326 (0.257 to 0.386) | 51 % (45–57) | 1066 | 0.85 (0.81–0.90) | 0.64 (0.59–0.69) | +0.211 (0.152 to 0.267) | 69 % (61–76) |
| floor0.20 | 4879 | 0.74 (0.70–0.77) | 0.41 (0.37–0.46) | +0.324 (0.250 to 0.396) | 57 % (51–62) | 871 | 0.82 (0.77–0.87) | 0.44 (0.39–0.49) | +0.379 (0.302 to 0.463) | 78 % (72–83) |
| floor0.225 | 3958 | 0.73 (0.69–0.76) | 0.45 (0.41–0.49) | +0.276 (0.209 to 0.342) | 60 % (54–65) | 793 | 0.80 (0.75–0.86) | 0.45 (0.39–0.50) | +0.355 (0.268 to 0.450) | 82 % (77–87) |
| floor0.25 | 3047 | 0.72 (0.68–0.76) | 0.44 (0.40–0.48) | +0.278 (0.211 to 0.348) | 65 % (59–70) | 703 | 0.78 (0.70–0.86) | 0.48 (0.41–0.55) | +0.295 (0.183 to 0.411) | 85 % (81–89) |
| floor0.30 | 1438 | 0.72 (0.67–0.77) | 0.52 (0.47–0.58) | +0.201 (0.116 to 0.284) | 72 % (66–77) | 490 | 0.72 (0.57–0.86) | 0.46 (0.36–0.58) | +0.254 (0.024 to 0.450) | 91 % (88–95) |
| floor0.225+lying | 4153 | 0.73 (0.70–0.77) | 0.48 (0.45–0.52) | +0.248 (0.188 to 0.309) | 59 % (53–64) | 812 | 0.78 (0.72–0.85) | 0.46 (0.40–0.52) | +0.324 (0.240 to 0.417) | 81 % (75–85) |

## Owner hypothesis: top edges at frame edges and in oblique views

Single-feature separation of filled from not filled (AUC > 0.5: larger values go with filled).

| feature | pilot-000 | yardstick B2 |
|---|---:|---:|
| heightOffBand | 0.45 (0.43–0.48) | 0.39 (0.31–0.47) |
| heightOffBandSigned | 0.51 (0.48–0.54) | 0.62 (0.55–0.70) |
| topSeamOff | 0.42 (0.39–0.44) | 0.44 (0.39–0.49) |
| topSeamSigned | 0.45 (0.42–0.47) | 0.47 (0.40–0.55) |
| topY | 0.40 (0.37–0.43) | 0.40 (0.31–0.51) |

Top-seam class over all detected boxes: pilot-000 clean 43 %, overshoot 37 %, cut 18 %, none 2 %; yardstick B2 clean 52 %, overshoot 32 %, cut 16 %, none 0 %.

Breakdown by frame position and by whether the camera looks down onto the top (student population). Filled: teacher share ≥ text-read. Top classes: share of boxes and their filled share. ΔAUC: student+geometry minus student, within the cell.

**pilot-000**

| cell | n | photos | filled | clean: share, filled | overshoot: share, filled | cut: share, filled | student AUC | +geometry AUC | ΔAUC |
|---|---:|---:|---:|---|---|---|---:|---:|---:|
| all | 3958 | 31 | 60 % (54–65) | 47 %, 66 % (59–72) | 36 %, 55 % (48–60) | 17 %, 59 % (52–64) | 0.73 (0.69–0.76) | 0.74 (0.70–0.77) | +0.009 (0.002 to 0.015) |
| centre | 2381 | 31 | 70 % (64–75) | 53 %, 72 % (65–77) | 30 %, 68 % (63–74) | 17 %, 67 % (58–74) | 0.70 (0.65–0.74) | 0.71 (0.66–0.75) | +0.008 (0.001 to 0.015) |
| edge | 1577 | 31 | 46 % (39–52) | 37 %, 53 % (43–62) | 44 %, 41 % (34–47) | 16 %, 46 % (40–52) | 0.72 (0.68–0.75) | 0.72 (0.68–0.76) | +0.007 (-0.005 to 0.018) |
| topNotInView | 2652 | 31 | 68 % (62–73) | 58 %, 71 % (64–77) | 28 %, 61 % (54–68) | 13 %, 73 % (65–78) | 0.71 (0.65–0.75) | 0.72 (0.67–0.77) | +0.013 (0.003 to 0.023) |
| topInView | 1306 | 31 | 44 % (38–50) | 24 %, 40 % (32–49) | 50 %, 47 % (40–54) | 25 %, 44 % (35–50) | 0.73 (0.70–0.76) | 0.72 (0.68–0.76) | -0.012 (-0.026 to 0.001) |
| centreTopNotInView | 1793 | 31 | 74 % (69–78) | 63 %, 74 % (67–79) | 22 %, 75 % (69–80) | 15 %, 75 % (67–81) | 0.67 (0.61–0.73) | 0.68 (0.62–0.74) | +0.009 (-0.001 to 0.019) |
| centreTopInView | 588 | 30 | 57 % (48–65) | 21 %, 56 % (45–68) | 54 %, 60 % (52–68) | 25 %, 51 % (37–63) | 0.74 (0.69–0.78) | 0.73 (0.67–0.78) | -0.005 (-0.024 to 0.011) |
| edgeTopNotInView | 859 | 31 | 56 % (47–64) | 46 %, 64 % (52–75) | 42 %, 47 % (38–56) | 9 %, 64 % (51–78) | 0.71 (0.65–0.76) | 0.73 (0.67–0.78) | +0.019 (0.003 to 0.034) |
| edgeTopInView | 718 | 31 | 34 % (28–40) | 26 %, 30 % (22–38) | 47 %, 34 % (26–43) | 25 %, 38 % (31–44) | 0.70 (0.65–0.75) | 0.69 (0.63–0.74) | -0.017 (-0.034 to 0.000) |

**yardstick B2**

| cell | n | photos | filled | clean: share, filled | overshoot: share, filled | cut: share, filled | student AUC | +geometry AUC | ΔAUC |
|---|---:|---:|---:|---|---|---|---:|---:|---:|
| all | 793 | 40 | 82 % (78–87) | 50 %, 85 % (82–89) | 34 %, 80 % (72–88) | 16 %, 79 % (65–90) | 0.80 (0.75–0.87) | 0.82 (0.77–0.87) | +0.015 (0.002 to 0.027) |
| centre | 643 | 40 | 87 % (83–91) | 49 %, 90 % (86–93) | 35 %, 86 % (79–91) | 16 %, 82 % (70–92) | 0.79 (0.70–0.87) | 0.81 (0.73–0.88) | +0.018 (0.004 to 0.033) |
| edge | 150 | 37 | 61 % (50–73) | 53 %, 68 % (58–80) | 30 %, 49 % (32–73) | 15 %, 65 % (42–88) | 0.79 (0.71–0.90) | 0.81 (0.73–0.90) | +0.025 (-0.004 to 0.046) |
| topNotInView | 763 | 40 | 84 % (80–87) | 51 %, 86 % (83–90) | 33 %, 81 % (74–88) | 16 %, 82 % (70–92) | 0.79 (0.71–0.86) | 0.81 (0.74–0.87) | +0.017 (0.003 to 0.033) |
| topInView | 30 | 6 | 43 % (26–78) | 27 %, 50 % (13–86) | 53 %, 50 % (0–75) | 20 %, 17 % (0–100) | 0.91 (0.76–1.00) | 0.88 (0.63–1.00) | -0.023 (-0.150 to 0.017) |
| centreTopNotInView | 626 | 40 | 88 % (84–91) | 50 %, 90 % (86–94) | 34 %, 87 % (80–92) | 16 %, 83 % (71–93) | 0.77 (0.67–0.86) | 0.79 (0.70–0.87) | +0.019 (0.004 to 0.036) |
| centreTopInView | 17 | 5 | 59 % (40–100) | 18 %, 67 % (0–100) | 71 %, 67 % (56–100) | 12 %, 0 % (0–0) | 1.00 (1.00–1.00) | 1.00 (1.00–1.00) | +0.000 (0.000 to 0.000) |
| edgeTopNotInView | 137 | 37 | 65 % (56–74) | 55 %, 69 % (59–80) | 30 %, 54 % (33–79) | 14 %, 74 % (53–93) | 0.79 (0.70–0.90) | 0.82 (0.74–0.91) | +0.027 (-0.007 to 0.054) |
| edgeTopInView | 13 | 3 | 23 % (0–60) | 38 %, 40 % (0–67) | 31 %, 0 % (0–0) | 31 %, 25 % (0–100) | 0.70 (0.50–0.75) | 0.70 (0.50–0.75) | +0.000 (0.000 to 0.000) |

