# NS11: mono-geometry student distilled from MoGe-2 (development run)

Pre-registration: [`prereg.md`](prereg.md), committed before the teacher table and before any training. Every figure here is **agreement with MoGe-2**, a machine output with no ground truth under it. **Nothing in this report is accuracy on real use** (OC36, INV-17): the student reproduces a teacher's guess about the faces of detected boxes on 31 stills of one phone and on a public yardstick.

## Verdicts

- **Development keep rule: KEPT.** K1 (share error at least 10 % below the per-group-mean baseline, interval above 0): passes, reduction 52.8 % (50.3 % to 57.3 %). K2 (median normal error at least 2.0 degrees below it, interval above 0): passes, gain 10.05 degrees (8.55 to 11.57). Six split groups, leave-one-group-out.
- **NS-5: insufficient data.** The real degraded-tier column has **0 cases** (the owner's minimum is 14, with a 93.75 % one-sided lower bound that must clear 2.5 points). No degraded-tier session exists. This is neither a go nor a no-go, and no lift is claimed.

## What was run

- Teacher: `Ruicheng/moge-2-vitl-normal` at `cb0e8bb` (MIT), with `faces.py` at `fec353c2`. Targets read from H-2's caches; **no new MoGe-2 run**.
- Student: GeometryStudentNet, from scratch, 1,604,318 parameters (ceiling 10 million), input a 128×128 letterboxed crop of the box plus a 12-number geometry vector of the detection's outline; outputs three face shares and a unit normal. Loss: KL divergence on the shares plus (1 − cosine) on the normal.
- 9 runs on MPS: six leave-one-split-group-out models (the keep rule), and the frozen-split model with three seeds (the registered artifact is seed 20261105). Recipe fixed in the pre-registration, never tuned.

## Population

| Set | Role | Photos | Kept boxes | Admitted | Excluded (mass under 0.5) | Teacher top-1 class: spine / top / cover |
|---|---|---|---|---|---|---|
| pilot-000 | training source (real use) | 31 | 5757 | 5592 | 165 | 5431 / 141 / 20 |
| yardstick-library-b2 | yardstick (PROXY), evaluation only | 40 | 1038 | 906 | 132 | 888 / 11 / 7 |

Every admitted row is `labelSource: mono-geometry`, `rgbRecoverable: yes` (5592 + 906); scheme `drop-unrecoverable` removes none. The teacher calls the **spine** face the largest of the three for 97.1 % of `pilot-000` boxes, so top-1 agreement is dominated by one class and gates nothing.

## Development keep rule: leave-one-split-group-out (6 groups)

Each of the 6 split groups is predicted by a model trained on the other five (5592 boxes). The **baseline** is the per-split-group mean: the group's own mean distribution and unit mean normal, an oracle constant. Intervals: 2000 resamples of the groups.

| Mean absolute share error | mean (95 % interval) | median (95 % interval) | p10 | p25 | p75 | p90 | p99 |
|---|---|---|---|---|---|---|---|
| student | 0.052 (0.044 to 0.061) | 0.032 (0.026 to 0.037) | 0.004 | 0.012 | 0.070 | 0.125 | 0.273 |
| per-group mean (oracle) | 0.110 (0.097 to 0.133) | 0.101 (0.083 to 0.126) | 0.045 | 0.075 | 0.128 | 0.176 | 0.367 |
| training mean | 0.112 (0.103 to 0.131) | 0.109 (0.105 to 0.113) | 0.046 | 0.073 | 0.120 | 0.183 | 0.388 |

(per box, over the pooled boxes; intervals are bootstrap over clusters)

| Normal angular error (degrees) | mean (95 % interval) | median (95 % interval) | p10 | p25 | p75 | p90 | p99 |
|---|---|---|---|---|---|---|---|
| student | 13.092 (10.116 to 14.742) | 9.536 (7.232 to 11.658) | 2.589 | 4.888 | 17.843 | 27.743 | 54.242 |
| per-group mean (oracle) | 25.634 (21.764 to 27.646) | 19.589 (16.165 to 22.889) | 7.573 | 12.125 | 34.417 | 53.830 | 81.904 |
| training mean | 25.845 (21.495 to 28.062) | 19.501 (14.896 to 23.369) | 7.957 | 11.832 | 35.272 | 53.144 | 81.949 |

(per box; degrees between unit mean normals)

| Top-1 face-class agreement with the teacher | share (95 % interval) | spine boxes agreed | top boxes agreed | cover boxes agreed |
|---|---|---|---|---|
| student | 0.976 (0.954 to 0.987) | 5388 / 5431 | 69 / 141 | 0 / 20 |
| per-group mean (oracle) | 0.971 (0.935 to 0.987) | 5431 / 5431 | 0 / 141 | 0 / 20 |
| training mean | 0.971 (0.935 to 0.987) | 5431 / 5431 | 0 / 141 | 0 / 20 |

| Comparison | Share error: relative reduction (95 % interval) | Median normal error: gain in degrees (95 % interval) |
|---|---|---|
| student vs per-group mean (the rule) | 52.8 (50.3 to 57.3) % | 10.05 (8.55 to 11.57) |
| student vs training mean | 53.6 (51.0 to 58.8) % | 9.96 (7.01 to 11.96) |

Per split group (groups unnamed, in sorted order of their keys):

| Group | Boxes | Student: share error / median angle / top-1 | Per-group mean: share error / median angle / top-1 |
|---|---|---|---|
| g1 | 455 | 0.083 / 10.05 / 92.5 % | 0.161 / 21.71 / 88.1 % |
| g2 | 2683 | 0.051 / 12.93 / 98.4 % | 0.101 / 24.19 / 98.4 % |
| g3 | 669 | 0.057 / 8.91 / 94.9 % | 0.137 / 16.42 / 94.0 % |
| g4 | 511 | 0.036 / 8.18 / 99.4 % | 0.082 / 21.12 / 99.4 % |
| g5 | 711 | 0.054 / 7.07 / 97.3 % | 0.125 / 16.24 / 97.5 % |
| g6 | 563 | 0.038 / 6.50 / 99.8 % | 0.087 / 14.33 / 99.6 % |

## Frozen split (the registered artifact)

Trained on the four frozen `train` groups (24 stills), scored on the 2 frozen `val` groups (7 stills). two validation groups: point values only, no interval (a bootstrap over two groups has three distinct resamples).

| Arm | Boxes | Share error: mean / p50 / p90 | Normal error (degrees): mean / p50 / p90 | Top-1 |
|---|---|---|---|---|
| student | 1232 | 0.049 / 0.029 / 0.121 | 10.57 / 7.53 / 22.32 | 97.6 % |
| per-group mean (oracle) | 1232 | 0.114 / 0.097 / 0.190 | 23.37 / 15.44 / 61.42 | 96.6 % |
| training mean | 1232 | 0.117 / 0.113 / 0.193 | 23.14 / 13.85 / 63.35 | 96.6 % |

Seed spread of the student on `val` (3 seeds): mean share error 0.047 to 0.049; median normal error 7.09 to 7.53 degrees; top-1 96.8 % to 97.6 %.

## Yardstick (PROXY; never trained on; decides nothing)

906 boxes in 40 photos; the cluster is the photo, the oracle baseline is the photo's own mean. A different camera, place and lens from the training stills: this shows how the pilot-trained student carries to unseen conditions, as agreement with the same teacher.

| Mean absolute share error | mean (95 % interval) | median (95 % interval) | p10 | p25 | p75 | p90 | p99 |
|---|---|---|---|---|---|---|---|
| student | 0.133 (0.119 to 0.148) | 0.114 (0.097 to 0.131) | 0.027 | 0.059 | 0.185 | 0.265 | 0.420 |
| per-photo mean (oracle) | 0.075 (0.063 to 0.089) | 0.057 (0.051 to 0.066) | 0.016 | 0.034 | 0.093 | 0.152 | 0.336 |
| training mean | 0.102 (0.093 to 0.112) | 0.089 (0.080 to 0.097) | 0.042 | 0.074 | 0.115 | 0.153 | 0.411 |

(per box, over the pooled boxes; intervals are bootstrap over clusters)

| Normal angular error (degrees) | mean (95 % interval) | median (95 % interval) | p10 | p25 | p75 | p90 | p99 |
|---|---|---|---|---|---|---|---|
| student | 18.993 (17.614 to 20.588) | 15.801 (14.184 to 17.643) | 5.801 | 9.409 | 24.750 | 35.372 | 68.283 |
| per-photo mean (oracle) | 14.004 (12.292 to 15.729) | 9.406 (8.019 to 10.883) | 2.132 | 4.565 | 16.473 | 29.031 | 81.306 |
| training mean | 15.295 (13.624 to 17.020) | 10.625 (9.338 to 11.687) | 3.517 | 5.985 | 17.686 | 30.765 | 79.713 |

(per box; degrees between unit mean normals)

| Top-1 face-class agreement with the teacher | share (95 % interval) | spine boxes agreed | top boxes agreed | cover boxes agreed |
|---|---|---|---|---|
| student | 0.884 (0.850 to 0.912) | 796 / 888 | 3 / 11 | 2 / 7 |
| per-photo mean (oracle) | 0.980 (0.963 to 0.993) | 888 / 888 | 0 / 11 | 0 / 7 |
| training mean | 0.980 (0.963 to 0.993) | 888 / 888 | 0 / 11 | 0 / 7 |

| Comparison | Share error: relative reduction (95 % interval) | Median normal error: gain in degrees (95 % interval) |
|---|---|---|
| student vs per-photo mean | -77.1 (-117.8 to -46.8) % | -6.39 (-8.57 to -4.44) |
| student vs pilot-000 training mean | -30.5 (-48.7 to -15.6) % | -5.18 (-7.09 to -3.35) |

## Exploratory ablations (not pre-registered; no keep rule; labelled so)

Added after the nine registered runs came back strong on `pilot-000` and weak on the yardstick, to ask whether the crop's pixels carry the signal or the box's position and shape do. Same recipe, same six leave-one-group-out folds, same measures; **they decide nothing** and change no verdict. `no image`: the geometry branch, trunk and heads only. `no geometry`: the full network with the 12-number vector set to zero.

| Arm | LOGO share error: mean (95 % interval) | LOGO median normal error, degrees | Share error vs the per-group mean | Normal gain vs the per-group mean, degrees | Yardstick share error: mean | Yardstick median normal error, degrees |
|---|---|---|---|---|---|---|
| full student (registered) | 0.052 (0.044 to 0.061) | 9.54 (7.23 to 11.66) | 52.8 (50.3 to 57.3) % reduction | 10.05 (8.55 to 11.57) | 0.133 (0.119 to 0.148) | 15.80 (14.18 to 17.64) |
| no image (geometry vector only) | 0.067 (0.058 to 0.073) | 12.82 (10.63 to 13.92) | 39.0 (33.9 to 46.8) % reduction | 6.77 (5.13 to 8.98) | 0.128 (0.119 to 0.139) | 10.84 (9.67 to 12.52) |
| no geometry (crop only) | 0.056 (0.049 to 0.067) | 11.61 (8.65 to 14.35) | 49.0 (46.8 to 53.2) % reduction | 7.98 (7.36 to 9.08) | 0.078 (0.070 to 0.088) | 12.89 (11.64 to 14.17) |

- Against the full student on the same folds, the no image arm's relative share-error reduction is -29.4 (-37.2 to -16.2) % and its median-normal-error gain -3.28 (-4.50 to -1.95) degrees (a negative figure means the arm is worse than the full student).
- Against the full student on the same folds, the no geometry arm's relative share-error reduction is -8.2 (-13.5 to -5.9) % and its median-normal-error gain -2.08 (-2.70 to -0.99) degrees (a negative figure means the arm is worse than the full student).

## Core ML on the Mac, and the teacher's cost avoided

Export: `coremltools` 9.0, `mlprogram`, float16, minimum deployment iOS17. **Package size 3.09 MiB** (3,244,445 bytes).

| Compute units | Single-box latency, median (ms) | p90 (ms) | Load (s) | Max abs share difference vs float32 PyTorch | Max normal difference (degrees) | Top-1 same |
|---|---|---|---|---|---|---|
| CPU_ONLY | 0.59 | 0.61 | 0.05 | 0.0017 | 0.249 | 100.0 % |
| CPU_AND_GPU | 0.67 | 0.79 | 0.09 | 0.0008 | 0.091 | 100.0 % |
| CPU_AND_NE | 0.22 | 0.26 | 0.17 | 0.0010 | 0.088 | 100.0 % |
| ALL | 0.22 | 0.26 | 0.18 | 0.0010 | 0.088 | 100.0 % |

Latency is a batch of one crop through the Python call (its overhead included) after 30 warm-up calls, 300 timed; on this Mac, not an iPhone (NS-9 measures the phone).

Teacher cost (H-2, `pilot-000`, cold photos on MPS): MoGe-2 inference 0.99 s a photo at the median, the whole stage 3.23 s (decode, inference, cache write, faces), plus 7.6 s once to load. Student cost for the 180.4 admitted boxes of an average `pilot-000` photo: 0.042 s batched on MPS (4314 boxes a second); one box at a time through Core ML: CPU_ONLY 0.106 s, CPU_AND_GPU 0.121 s, CPU_AND_NE 0.040 s, ALL 0.039 s. These are two runs of one machine, not a ratio of equals; the student's time covers its forward passes only: cutting the crops from the photo is not measured.

## Training

| Run | Kind | Seed | Train rows | Eval rows | Epoch-1 loss | Final loss | Wall seconds |
|---|---|---|---|---|---|---|---|
| logo-1 | logo | 20261105 | 5137 | 455 | 0.4183 | 0.0232 | 206 |
| logo-2 | logo | 20261105 | 2909 | 2683 | 0.4789 | 0.0295 | 120 |
| logo-3 | logo | 20261105 | 4923 | 669 | 0.4335 | 0.0243 | 206 |
| logo-4 | logo | 20261105 | 5081 | 511 | 0.4154 | 0.0254 | 205 |
| logo-5 | logo | 20261105 | 4881 | 711 | 0.4397 | 0.0250 | 194 |
| logo-6 | logo | 20261105 | 5029 | 563 | 0.4167 | 0.0231 | 201 |
| frozen-20261105 | frozen | 20261105 | 4360 | 1232 | 0.4448 | 0.0277 | 180 |
| frozen-20261106 | frozen | 20261106 | 4360 | 1232 | 0.4749 | 0.0285 | 178 |
| frozen-20261107 | frozen | 20261107 | 4360 | 1232 | 0.6917 | 0.0334 | 184 |

Training wall time: the 9 registered runs **27.9 minutes**, the exploratory ablations 19.8 minutes, **47.7 minutes in all** of the 120-minute cap (the Core ML export and scoring are a few seconds each). Peak resident memory 1641 MiB; peak MPS allocation 1232 MiB. Training is not bit-reproducible on MPS; the seed, the data order and the recipe are fixed.

## NS-5 column

The real degraded-tier column has **0 cases** against the owner's minimum of 14. Verdict under `evals/NS5/prereg.md`: **insufficient data**. Every `pilot-000` still is `metric-depth` and `shopper-still` with no case id, so no row can enter it; this card scores none of G-SWEEP's measures and builds no `single-view` comparison arm (there is no non-privileged label for these targets). **Unlocked by:** NS-3's degraded-tier sweeps and the borrowed non-Pro phone's natural-sweep sessions, recorded at capture with case ids (14 or more in one column); a comparison arm or a stated reason none exists; and the Apple agreement reading if app-captured depth is ever used.

## What this does not show

- A teacher's guess is not the book's real faces: where MoGe-2 mislabels a face, the student learns the mislabel, and it is rewarded for agreeing. The top-face class (the steep-angle proxy of H-2) is rare in these stills, and the spine class dominates.
- One phone, six stands: leave-one-group-out over six groups is the least that carries an interval, and it is wide. The yardstick is another camera and place, as agreement only.
- The geometry vector comes from detection outlines of this stack's detector; a different detector on a phone gives different outlines.
- The Mac's Core ML latency says nothing certain about an iPhone.
