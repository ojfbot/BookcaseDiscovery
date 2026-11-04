# Q2b: Q-2's student on whole-spine boxes, and real outlines for U-4

Run 2026-11-03, card Q-2b ([`docs/capture/coverage.md`](../../docs/capture/coverage.md) §5, §6; [Q-2](../Q2/report.md)).
**Question.** Q-2's predicted fill was NO-GO, with a warning that it might shift once the detector stopped breaking
spines into pieces. F-0e has since made shelf-aligned `bands+strips` tiling the whole-case default, and F-0c's
not-a-book filter is on. Does Q-2's student, unchanged, now pass Q-2's go rule on the current default boxes?

**Inputs.** On `pilot-000` (31 real-use photos), F-0e's `bands+strips` boxes, the three readers F-0e ran on them,
and F-0's decision on those readings (F-0c's cached copy, same v1 catalog). On the yardstick (40 Library Dataset
images, PROXY), F-0's own B2 run, which F-0e left as the default for shelf-scale photos. F-0c's not-a-book rules
(cover pass off) drop 7 of 6,145 `pilot-000` boxes and 12 of 1,132 yardstick boxes before anything is computed.
Q-1's still features and Q-2's top-seam geometry were re-measured on the new boxes (CPU pixel pass). No reader or
detector was re-run for Part A; Part B ran SAM 2.1 on the GPU. Rungs are **machine agreement, not accuracy**
(INV-17). The sets are reported side by side, never pooled (OC35), and every interval is a 95 % photo bootstrap
(1,000 draws, paired across models).

**Pre-registered: Q-2's rule, unchanged.** τ comes from Q-2's exact null procedure on `pilot-000`. The box-score
floor is 0.225, lying boxes are left out, and the student uses the same five features, monotone, fit leave one
photo out on `pilot-000` only, with the yardstick scored unchanged. The go rule is AUC ≥ 0.75 and a gain over crop
width whose interval excludes 0. Nothing about the model changed before the results. The code is Q-2's own
(`q2-cli.ts`, now driven by a run config; re-running Q-2 through it reproduces `evals/Q2/metrics.json` exactly). One
extra variant, τ held at Q-2's 0.71, was added **after** seeing the results and is labelled not pre-registered.

## Verdict

**NO-GO again.** The student's AUC on `pilot-000` is **0.695 (0.64–0.74)**, against Q-2's 0.729 (0.69–0.76) and the
0.75 bar. The gain half passes, as before: **+0.25 (0.18 to 0.32)** over crop width.

- **Whole-only and all-box results agree.** On whole boxes only, the student gives 0.667 (0.61–0.72): also NO-GO.
- **FILL_P stays at 0.70**, Q-0's start. No score reaches the 90 % precision target; the best is 73 %, against
  Q-2's 82 %. At 0.70 the student fills 30 % of boxes, and **73 % (65–79)** of those fills are measured at
  `text-read` or above. Q-2 had 78 % (73–82).
- **Not pre-registered:** with τ held at Q-2's 0.71, the AUC is 0.714 (0.67–0.76) and the precision at FILL_P is
  77 % (70–82). That is still NO-GO. About half of the drop comes from the label shift, and half from the new boxes.

## Findings

1. **The pieces are gone from the population.** Boxes cut by a tile edge fell from 37.5 % of the student
   population to 2.1 %. Whole boxes rose from 47 % to 77 %. Q-2's partial measure (under 0.55 of the band
   polygon's height) rose from 16 % to 21 %. F-0e warned that this measure moves with how bands come out. Against
   the band's spine height, F-0e measured partials falling from 8.1 % to 5.3 %. So this is now mostly a
   population of whole spines.
2. **Whole spines did not help the student; they made it slightly worse.** Q-2's caveat was that the result might
   shift once F-0e landed. It shifted down, inside the intervals.
   - **By kind:** whole boxes give 0.67 (0.62–0.72) and partial boxes 0.78 (0.74–0.81). Short boxes are the easy
     cases. Whole spines are the hard population, and there are now more of them.
   - **Weights:** the student is still box detail plus tilt. The detail weight fell from 0.95 to 0.81 SD, and tilt
     from −0.30 to −0.17. Crop width, glare share and luma are dropped in all 31 folds, as in Q-2.
   - **Reading:** a whole spine nearly always shows some crisp texture, so "is there detail" separates less well.
3. **The hard pair got harder.** Filled boxes against `spine-found` give 0.87 (Q-2: 0.86). Filled against
   `text-present` give only **0.59 (0.54–0.65)** (Q-2: 0.63). The fill line still runs through garbled against
   legible, and no S-S2 signal sees that difference.
4. **τ moved from 0.71 to 0.76 under the same rule, and it is fragile.** On the new boxes, the null pairing's false
   agreement sits just above 1 % from 0.70 to 0.75 (1.2 % to 1.0 %), so the 1 % rule lands at 0.76. On F-0's
   boxes it was 0.9 % at 0.71. A plausible cause is that whole-spine readings are longer, so unrelated spines
   share more substrings, such as publisher or series words. This is a hypothesis; it was not checked.
   - **Effect:** at 0.76, 41 % of `no-catalog-match` boxes become `text-read`, against 49 % in Q-2. This moves
     boxes into the hard negative class.
   - **Lesson:** τ belongs to a box set. Re-derive it whenever the detector changes; never carry it across.
5. **Teacher rungs on the new boxes (all detected):** spine-found 22 %, text-present 30 %, text-read 21 %, matched
   15 %, confirmed 12 %. Q-2 had 25 %, 25 %, 25 %, 15 % and 10 %. The confirmed share rose by 2 points, as F-0e
   reported. Lying boxes at or above the floor fell from 195 to 38 (F-0e's `strips` step, then the not-a-book
   filter).
6. **Calibration holds at home, a little worse, and shifts away as before.**
   - **`pilot-000`:** ECE 0.043 (Q-2: 0.028). The reliability curve flattens near 0.68–0.74 measured above a score
     of 0.7.
   - **Yardstick:** the AUC transfers at 0.78 (0.72–0.85). The student is under-confident there (ECE 0.30), as in
     Q-2.
7. **The owner's top-edge pattern holds on whole spines.** Boxes whose tops face the camera read 40 % of the time,
   against 65 % for the rest. Adding the geometry features gives ΔAUC +0.010 (0.003 to 0.019): still small.

## What follows

- **The live layer shows `seen` only** (§5), and the fill waits for measured outcomes. Q-3 draws the measured map
  from this teacher: τ 0.76 and floor 0.225 on the current default boxes.
- **The bar is out of reach for S-S2 signals alone**, on whole spines even more than on pieces. The next retry
  should add S-S3 text presence (PP-OCR detection only, or Vision text rectangles), pre-registered on these
  boxes. Q-2 already named it the next lever, and finding 3 is why.
- **FILL_P remains Q-0's 0.70 placeholder.** Precision at its best is 73 %, far from 90 %.

## Part B: real outlines for U-4

F-0b's `helpers/label/outline.py` (SAM 2.1 base-plus, prompted with each box's axis-aligned extent), unchanged, on
every kept default `pilot-000` box: 6,138 boxes on the GPU (MPS), no errors, median 0.34 s a box. U-4's study now
takes each box's own outline and its own Q-2b rung (U-4's loader, source `q2b`). A box is drawn from its outline when
the outline covers at least 60 % of it, U-4's rule unchanged. The first study is kept as source `f0b`, and
re-rendering it reproduces its summary exactly.

| measure | U-4 first study: F-0b outlines on F-0's boxes, Q-2 rungs | Q-2b outlines and rungs |
|---|---:|---:|
| spines drawn | 6,145 | 6,138 (not-a-book left out) |
| **drawn from a real mask outline** | **69 %** | **83.2 %** |
| median mask share of a box | 0.76 | 0.82 |
| filled (rung ≥ `text-read`) | 48.2 % | 48.1 % |
| `spine-found` | 30.1 % | 22.2 % |

- **Why 17 % still fall back to the box.** In 16.5 % of boxes, the mask covers under 60 % of the box: SAM took part
  of the spine, such as a label block. In 0.4 %, the mask lies mostly outside the box. Cut boxes fall back more
  often (24 %) than whole (17 %) or partial (16 %) ones.
- **Rungs are now the box's own.** Before, a spine with no attached F-0 piece stayed `spine-found`; now every spine
  carries its own teacher rung. The filled share barely moves: Q-2's τ 0.71, taking the best of a spine's pieces,
  and Q-2b's τ 0.76 on whole spines land at the same 48 %.

U-4's still-image feel proxies, on the shape each variant draws (`docs/capture/display-modes.md` §3):

| variant | outline drawn | jaggedness p90 | perturbation wobble (median) | area CV (median) |
|---|---|---|---|---|
| dev, labelling | box | 0 → 0 | 1.00 → 1.00 | 0.018 → 0.018 |
| `user-glow` | mask hull, 2 passes | 0 → 0 | 0.752 → 0.753 | 0.018 → 0.019 |
| `user-veil` | mask hull, 3 passes | 0 → 0 | 0.743 → 0.744 | 0.018 → 0.019 |
| `user-ridge` | raw mask, 1 pass | 0.051 → 0.058 | 0.791 → 0.791 | 0.019 → 0.019 |

The proxies hardly move: more spines are drawn from masks, and the hull variants stay convex. The raw-mask ridges
gain a slightly longer jagged tail, as more raw outlines are drawn. The re-rendered study is at the data root's
`private/u4/renders/pilot-000/index.html`; `user-glow` is the page's default A.

## Private outputs

Everything per box or per photo lives under the data root's `private/q2b/`, never in the repo:
- `features/`, `q1table/`, `geometry/`: Q-1's features, Q-1's table and Q-2's top seam on the new boxes;
- `table/`: rung, population flag, student and baseline scores per box (the U-4 study reads its rungs from here);
- `renders/pilot-000/index.html`: Q-2's renders on the new boxes (measured fill, predicted fill, agreement, top
  edge);
- `diag-tau/`: the not-pre-registered τ = 0.71 run;
- `outlines/pilot-000.jsonl`: one SAM 2.1 outline per kept box.

Regenerate with `node src/eval/q2b-cli.ts all` after `uv sync` in `helpers/coverage`. Outlines need
`uv sync` in `helpers/label` and the GPU: `node src/eval/q2b-cli.ts outlines`. Then run
`node src/eval/u4-cli.ts render`.

<!-- Tables below are generated by `node src/eval/q2b-cli.ts analyse`; edit above this line only. -->

## Q-2 against Q-2b (pilot-000)

Q-2: F-0's B2 boxes. Q-2b: the current default (F-0e `bands+strips`, F-0c's not-a-book filter). Same teacher procedure, same student, same rule; intervals are 95 % paired photo bootstraps within each run.

| figure | Q-2 | Q-2b |
|---|---:|---:|
| detected boxes | 6894 | 6138 |
| student population (floor, upright, measurable) | 3958 | 3555 |
| filled share of the population | 60 % (55–65) | 58 % (52–63) |
| τ | 0.71 | 0.76 |
| **student AUC (leave one photo out)** | 0.729 (0.69–0.76) | 0.695 (0.64–0.74) |
| **gain over crop width** | +0.276 (0.212 to 0.336) | +0.248 (0.176 to 0.317) |
| gain over crop width, best direction with hindsight | +0.204 (0.159 to 0.248) | +0.171 (0.107 to 0.224) |
| student AUC in sample (optimistic) | 0.733 (0.70–0.77) | 0.701 (0.65–0.74) |
| filled vs spine-found only | 0.864 (0.84–0.88) | 0.870 (0.84–0.89) |
| filled vs text-present only | 0.633 (0.60–0.67) | 0.594 (0.54–0.65) |
| ECE | 0.028 (0.02–0.05) | 0.043 (0.03–0.07) |
| Brier | 0.199 (0.19–0.21) | 0.213 (0.20–0.23) |
| yardstick AUC (one pilot fit, unchanged) | 0.803 (0.75–0.87) | 0.782 (0.72–0.85) |
| yardstick ECE | 0.281 (0.24–0.32) | 0.298 (0.26–0.34) |
| FILL_P | 0.7 (target not met) | 0.7 (target not met) |
| best precision (≥ 5 % filled) | 82.5 % | 72.7 % |
| at FILL_P: share predicted filled | 39 % (33–45) | 30 % (24–34) |
| **at FILL_P: precision of "filled"** | 78 % (73–82) | 73 % (65–79) |
| at FILL_P: recall | 51 % (45–55) | 37 % (33–42) |
| population: cut by a tile edge | 37.5 % | 2.1 % |
| population: partial (under 0.55 of band) | 15.6 % | 20.9 % |
| population: whole | 46.8 % | 77.0 % |
| cut boxes per photo, median (all detected) | 28.9 % | 3.5 % |
| whole only: n | 1854 | 2737 |
| whole only: student AUC | 0.723 (0.68–0.77) | 0.667 (0.61–0.72) |
| whole only: gain over crop width | +0.187 (0.122 to 0.248) | +0.274 (0.192 to 0.347) |
| whole only: Q-2's rule | NO-GO | NO-GO |
| **verdict by Q-2's rule** | NO-GO | NO-GO |

Whole-only and all-box results agree on the verdict: whole only NO-GO, all boxes NO-GO.

### Not pre-registered: τ held at Q-2's 0.71

The null procedure gives a different τ on the new boxes, which moves boxes between `text-present` and `text-read`. This diagnostic re-runs everything with τ fixed at Q-2's value, to separate the label shift from the box change. It is outside the go rule.

| figure | Q-2 | Q-2b at τ = 0.71 |
|---|---:|---:|
| detected boxes | 6894 | 6138 |
| student population (floor, upright, measurable) | 3958 | 3555 |
| filled share of the population | 60 % (55–65) | 60 % (55–65) |
| τ | 0.71 | 0.71 |
| **student AUC (leave one photo out)** | 0.729 (0.69–0.76) | 0.714 (0.67–0.76) |
| **gain over crop width** | +0.276 (0.212 to 0.336) | +0.293 (0.221 to 0.362) |
| gain over crop width, best direction with hindsight | +0.204 (0.159 to 0.248) | +0.193 (0.130 to 0.241) |
| student AUC in sample (optimistic) | 0.733 (0.70–0.77) | 0.719 (0.68–0.76) |
| filled vs spine-found only | 0.864 (0.84–0.88) | 0.870 (0.85–0.89) |
| filled vs text-present only | 0.633 (0.60–0.67) | 0.613 (0.56–0.66) |
| ECE | 0.028 (0.02–0.05) | 0.033 (0.03–0.06) |
| Brier | 0.199 (0.19–0.21) | 0.203 (0.19–0.22) |
| yardstick AUC (one pilot fit, unchanged) | 0.803 (0.75–0.87) | 0.804 (0.75–0.87) |
| yardstick ECE | 0.281 (0.24–0.32) | 0.294 (0.25–0.34) |
| FILL_P | 0.7 (target not met) | 0.7 (target not met) |
| best precision (≥ 5 % filled) | 82.5 % | 77.7 % |
| at FILL_P: share predicted filled | 39 % (33–45) | 38 % (32–44) |
| **at FILL_P: precision of "filled"** | 78 % (73–82) | 77 % (70–82) |
| at FILL_P: recall | 51 % (45–55) | 49 % (44–53) |
| population: cut by a tile edge | 37.5 % | 2.1 % |
| population: partial (under 0.55 of band) | 15.6 % | 20.9 % |
| population: whole | 46.8 % | 77.0 % |
| cut boxes per photo, median (all detected) | 28.9 % | 3.5 % |
| whole only: n | 1854 | 2737 |
| whole only: student AUC | 0.723 (0.68–0.77) | 0.689 (0.64–0.74) |
| whole only: gain over crop width | +0.187 (0.122 to 0.248) | +0.329 (0.256 to 0.389) |
| whole only: Q-2's rule | NO-GO | NO-GO |
| **verdict by Q-2's rule** | NO-GO | NO-GO |

Whole-only and all-box results agree on the verdict: whole only NO-GO, all boxes NO-GO.

## Teacher table: coverage rung per detected box (B2)

τ = 0.76 (string agreement), box-score floor = 0.225. Counts are machine agreement, not accuracy.

| set | group | n | spine-found | text-present | text-read | matched | confirmed |
|---|---|---:|---:|---:|---:|---:|---:|
| pilot-000 | all detected | 6138 | 1361 (22 %) | 1827 (30 %) | 1291 (21 %) | 928 (15 %) | 731 (12 %) |
| pilot-000 | below floor | 2545 | 779 (31 %) | 866 (34 %) | 406 (16 %) | 338 (13 %) | 156 (6 %) |
| pilot-000 | lying, at/above floor | 38 | 28 (74 %) | 5 (13 %) | 2 (5 %) | 3 (8 %) | 0 (0 %) |
| pilot-000 | **student population** | 3555 | 554 (16 %) | 956 (27 %) | 883 (25 %) | 587 (17 %) | 575 (16 %) |
| yardstick B2 | all detected | 1120 | 280 (25 %) | 116 (10 %) | 294 (26 %) | 161 (14 %) | 269 (24 %) |
| yardstick B2 | below floor | 310 | 185 (60 %) | 39 (13 %) | 52 (17 %) | 12 (4 %) | 22 (7 %) |
| yardstick B2 | lying, at/above floor | 17 | 10 (59 %) | 4 (24 %) | 0 (0 %) | 1 (6 %) | 2 (12 %) |
| yardstick B2 | **student population** | 793 | 85 (11 %) | 73 (9 %) | 242 (31 %) | 148 (19 %) | 245 (31 %) |

- pilot-000: 31 photos; filled share of the population 58 % (52–63); 0 boxes left out for an unmeasurable feature.
- yardstick B2: 40 photos; filled share of the population 80 % (75–84); 0 boxes left out for an unmeasurable feature; 22 accepted boxes name a work not in the photo's annotations (kept at `confirmed`: the teacher cannot see annotations).

### Setting τ: null pairing versus real agreement

Null pass: share of null pairs (one reader on a box, another reader on a different box of the same photo) at or above τ. Accepted pass: share of catalog-confirmed boxes whose readers' strings agree at τ. No-match pass: share of `no-catalog-match` boxes promoted to `text-read`.

| τ | pilot-000 null | accepted | no-match | yardstick B2 null | accepted | no-match |
|---:|---:|---:|---:|---:|---:|---:|
| 0.6 | 4 % | 95 % | 59 % | 10 % | 97 % | 85 % |
| 0.7 | 1 % | 85 % | 48 % | 6 % | 89 % | 77 % |
| 0.75 | 1 % | 78 % | 43 % | 5 % | 85 % | 73 % |
| **0.76** | 1 % | 77 % | 41 % | 4 % | 84 % | 72 % |
| 0.8 | 1 % | 73 % | 37 % | 3 % | 81 % | 68 % |
| 0.85 | 1 % | 67 % | 31 % | 3 % | 74 % | 60 % |
| 0.9 | 0 % | 61 % | 25 % | 2 % | 66 % | 53 % |
| 0.95 | 0 % | 50 % | 19 % | 1 % | 56 % | 45 % |
| 1 | 0 % | 41 % | 16 % | 1 % | 45 % | 39 % |

## Student: AUC, gain over the crop-width baseline, calibration

pilot-000 scores are leave-one-image-out; the yardstick is scored by one fit on all of pilot-000, unchanged. Intervals: paired photo bootstrap.

| model | pilot-000 AUC | Δ vs baseline | Δ vs student | ECE | Brier | yardstick B2 AUC | Δ vs baseline | Δ vs student | ECE | Brier |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline | 0.45 (0.41–0.48) | – | – | 0.015 (0.007–0.067) | 0.246 (0.239–0.255) | 0.45 (0.38–0.51) | – | – | 0.251 (0.201–0.295) | 0.223 (0.218–0.228) |
| student | 0.69 (0.64–0.74) | +0.248 (0.176 to 0.317) | – | 0.043 (0.035–0.072) | 0.213 (0.199–0.230) | 0.78 (0.72–0.85) | +0.333 (0.236 to 0.439) | – | 0.298 (0.256–0.341) | 0.212 (0.198–0.228) |
| student-logCropWidthPx | 0.69 (0.64–0.74) | +0.248 (0.176 to 0.317) | +0.000 (0.000 to 0.000) | 0.043 (0.035–0.072) | 0.213 (0.199–0.230) | 0.78 (0.72–0.85) | +0.333 (0.236 to 0.439) | +0.000 (0.000 to 0.000) | 0.298 (0.256–0.341) | 0.212 (0.198–0.228) |
| student-logDetail | 0.49 (0.46–0.52) | +0.040 (-0.002 to 0.086) | -0.209 (-0.269 to -0.147) | 0.037 (0.018–0.077) | 0.245 (0.238–0.255) | 0.51 (0.43–0.58) | +0.062 (-0.031 to 0.138) | -0.271 (-0.374 to -0.183) | 0.214 (0.168–0.256) | 0.204 (0.198–0.212) |
| student-glareShare | 0.69 (0.64–0.74) | +0.248 (0.176 to 0.317) | +0.000 (0.000 to 0.000) | 0.043 (0.035–0.072) | 0.213 (0.199–0.230) | 0.78 (0.72–0.85) | +0.333 (0.236 to 0.439) | +0.000 (0.000 to 0.000) | 0.298 (0.256–0.341) | 0.212 (0.198–0.228) |
| student-lumaOffMid | 0.69 (0.64–0.74) | +0.248 (0.176 to 0.317) | +0.000 (0.000 to 0.000) | 0.043 (0.035–0.072) | 0.213 (0.199–0.230) | 0.78 (0.72–0.85) | +0.333 (0.236 to 0.439) | +0.000 (0.000 to 0.000) | 0.298 (0.256–0.341) | 0.212 (0.198–0.228) |
| student-tiltDeg | 0.69 (0.64–0.74) | +0.242 (0.169 to 0.308) | -0.006 (-0.012 to -0.001) | 0.036 (0.024–0.069) | 0.214 (0.200–0.231) | 0.78 (0.72–0.84) | +0.328 (0.229 to 0.439) | -0.005 (-0.011 to 0.002) | 0.312 (0.268–0.355) | 0.221 (0.208–0.237) |
| student+heightOffBand | 0.69 (0.64–0.74) | +0.248 (0.175 to 0.318) | -0.001 (-0.003 to 0.002) | 0.045 (0.036–0.073) | 0.213 (0.199–0.231) | 0.79 (0.73–0.85) | +0.338 (0.243 to 0.441) | +0.006 (-0.001 to 0.012) | 0.303 (0.260–0.347) | 0.215 (0.201–0.233) |
| student+topSeamOff | 0.71 (0.65–0.76) | +0.259 (0.186 to 0.326) | +0.011 (0.004 to 0.018) | 0.043 (0.032–0.068) | 0.210 (0.194–0.228) | 0.79 (0.73–0.85) | +0.342 (0.243 to 0.442) | +0.009 (-0.006 to 0.023) | 0.294 (0.255–0.336) | 0.209 (0.195–0.227) |
| student+geometry | 0.71 (0.65–0.76) | +0.259 (0.184 to 0.328) | +0.010 (0.003 to 0.019) | 0.044 (0.034–0.071) | 0.210 (0.194–0.228) | 0.80 (0.74–0.86) | +0.350 (0.259 to 0.447) | +0.018 (0.004 to 0.030) | 0.303 (0.262–0.346) | 0.213 (0.197–0.232) |
| diag:signFree | 0.72 (0.67–0.76) | +0.277 (0.210 to 0.339) | +0.028 (0.013 to 0.041) | 0.029 (0.022–0.058) | 0.206 (0.191–0.223) | 0.79 (0.73–0.85) | +0.341 (0.260 to 0.433) | +0.009 (-0.018 to 0.036) | 0.450 (0.402–0.497) | 0.335 (0.307–0.367) |
| diag:student+viewElevation | 0.71 (0.66–0.75) | +0.261 (0.195 to 0.323) | +0.013 (-0.003 to 0.027) | 0.055 (0.044–0.077) | 0.208 (0.194–0.225) | 0.78 (0.72–0.84) | +0.331 (0.229 to 0.429) | -0.002 (-0.019 to 0.014) | 0.259 (0.220–0.301) | 0.189 (0.176–0.204) |
| diag:student+fragment | 0.70 (0.64–0.74) | +0.249 (0.178 to 0.317) | +0.001 (-0.002 to 0.003) | 0.044 (0.036–0.073) | 0.213 (0.199–0.230) | 0.78 (0.72–0.84) | +0.328 (0.230 to 0.433) | -0.005 (-0.011 to 0.003) | 0.305 (0.260–0.348) | 0.217 (0.204–0.232) |

- pilot-000: n = 3555 boxes in 31 photos, filled share 58 % (52–62).
- yardstick B2: n = 793 boxes in 40 photos, filled share 80 % (75–84).

Weights of the full pilot-000 fit, on standardised features (0 = dropped by the monotone rule). Folds dropping: of 31 leave-one-out fits, how many dropped the feature.

| model | logCropWidthPx | logDetail | glareShare | lumaOffMid | tiltDeg | heightOffBand | topSeamOff | topBelowCentre | cutByTile | heightOverBand | dropped (full fit) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| baseline | -0.07 |  |  |  |  |  |  |  |  |  | – |
| student | 0.00 (31/31) | 0.81 | 0.00 (31/31) | 0.00 (31/31) | -0.17 |  |  |  |  |  | logCropWidthPx, lumaOffMid, glareShare |
| student-logCropWidthPx |  | 0.81 | 0.00 (31/31) | 0.00 (31/31) | -0.17 |  |  |  |  |  | lumaOffMid, glareShare |
| student-logDetail | 0.00 (31/31) |  | 0.00 (31/31) | 0.00 (31/31) | -0.13 |  |  |  |  |  | glareShare, lumaOffMid, logCropWidthPx |
| student-glareShare | 0.00 (31/31) | 0.81 |  | 0.00 (31/31) | -0.17 |  |  |  |  |  | logCropWidthPx, lumaOffMid |
| student-lumaOffMid | 0.00 (31/31) | 0.81 | 0.00 (31/31) |  | -0.17 |  |  |  |  |  | logCropWidthPx, glareShare |
| student-tiltDeg | 0.00 (31/31) | 0.80 | 0.00 (31/31) | 0.00 (31/31) |  |  |  |  |  |  | logCropWidthPx, lumaOffMid, glareShare |
| student+heightOffBand | 0.00 (31/31) | 0.81 | 0.00 (31/31) | 0.00 (31/31) | -0.16 | -0.07 |  |  |  |  | logCropWidthPx, lumaOffMid, glareShare |
| student+topSeamOff | 0.00 (31/31) | 0.82 | 0.00 (31/31) | 0.00 (31/31) | -0.15 |  | -0.27 |  |  |  | logCropWidthPx, lumaOffMid, glareShare |
| student+geometry | 0.00 (31/31) | 0.82 | 0.00 (31/31) | 0.00 (31/31) | -0.14 | -0.09 | -0.27 |  |  |  | logCropWidthPx, lumaOffMid, glareShare |
| diag:signFree | -0.42 | 1.01 | -0.01 | 0.13 | -0.12 |  |  |  |  |  | – |
| diag:student+viewElevation | 0.00 (31/31) | 0.81 | 0.00 (30/31) | 0.00 (31/31) | -0.13 |  |  | -0.32 |  |  | logCropWidthPx, lumaOffMid, glareShare |
| diag:student+fragment | 0.00 (31/31) | 0.81 | 0.00 (31/31) | 0.00 (31/31) | -0.17 |  |  |  | -0.08 | 0.00 (31/31) | logCropWidthPx, lumaOffMid, heightOverBand, glareShare |

### Reliability (student; 10 equal-width bins of the predicted score)

| bin | pilot-000 n | mean score | measured filled | yardstick B2 n | mean score | measured filled |
|---|---:|---:|---:|---:|---:|---:|
| 0.0–0.1 | 16 | 0.08 | 0.00 | 19 | 0.07 | 0.00 |
| 0.1–0.2 | 97 | 0.16 | 0.10 | 41 | 0.15 | 0.24 |
| 0.2–0.3 | 221 | 0.26 | 0.20 | 57 | 0.26 | 0.54 |
| 0.3–0.4 | 326 | 0.35 | 0.32 | 69 | 0.36 | 0.80 |
| 0.4–0.5 | 476 | 0.45 | 0.44 | 137 | 0.45 | 0.80 |
| 0.5–0.6 | 580 | 0.55 | 0.65 | 208 | 0.55 | 0.91 |
| 0.6–0.7 | 789 | 0.65 | 0.68 | 178 | 0.64 | 0.93 |
| 0.7–0.8 | 787 | 0.75 | 0.74 | 74 | 0.74 | 0.89 |
| 0.8–0.9 | 260 | 0.83 | 0.68 | 10 | 0.81 | 1.00 |
| 0.9–1.0 | 3 | 0.91 | 0.67 | 0 | – | – |

## Go rule

Student AUC on pilot-000 0.69 (0.64–0.74) (rule: ≥ 0.75); gain over crop width +0.248 (0.176 to 0.317) (rule: interval excludes 0). **NO-GO** on the predicted fill.

Unrounded: student 0.695; sign-free diagnostic 0.723.

Robustness (paired photo bootstrap). Oracle width: crop width ranked in the better direction with hindsight, no folds. Against each negative: filled boxes versus `spine-found` only, and versus `text-present` only. In-sample: the full pilot-000 fit scored on its own training rows (optimistic).

| set | oracle width AUC | student − oracle width | student vs spine-found | student vs text-present | student in-sample |
|---|---:|---:|---:|---:|---:|
| pilot-000 | 0.52 (0.50–0.56) | +0.171 (0.107 to 0.224) | 0.87 (0.84–0.89) | 0.59 (0.54–0.65) | 0.70 (0.65–0.74) |
| yardstick B2 | 0.55 (0.51–0.61) | +0.231 (0.169 to 0.289) | 0.94 (0.90–0.97) | 0.60 (0.51–0.70) | 0.78 (0.73–0.84) |

Diagnostic, not the go rule: the same five features with every direction learned give 0.72 (0.67–0.76), gain +0.277 (0.210 to 0.339) (would not pass).

## Operating point (FILL_P)

No score reaches the precision target on pilot-000 (best 73 % where at least 5 % are filled). FILL_P = **0.7**, Q-0's starting value, proposed unchanged.

| set | filled share | precision (measured ≥ text-read) | recall |
|---|---:|---:|---:|
| pilot-000 | 30 % (24–34) | 73 % (65–79) | 37 % (33–42) |
| yardstick B2 | 11 % (8–14) | 90 % (83–99) | 12 % (9–15) |

| score ≥ | pilot-000 filled | precision | recall | yardstick B2 filled | precision | recall |
|---:|---:|---:|---:|---:|---:|---:|
| 0.30 | 91 % | 62 % | 97 % | 85 % | 88 % | 94 % |
| 0.35 | 86 % | 63 % | 95 % | 82 % | 89 % | 91 % |
| 0.40 | 81 % | 65 % | 92 % | 77 % | 89 % | 85 % |
| 0.45 | 75 % | 67 % | 88 % | 69 % | 90 % | 77 % |
| 0.50 | 68 % | 69 % | 82 % | 59 % | 91 % | 68 % |
| 0.55 | 60 % | 71 % | 74 % | 47 % | 93 % | 55 % |
| 0.60 | 52 % | 71 % | 63 % | 33 % | 92 % | 38 % |
| 0.65 | 41 % | 72 % | 52 % | 19 % | 92 % | 22 % |
| 0.70 | 30 % | 73 % | 37 % | 11 % | 90 % | 12 % |
| 0.75 | 18 % | 71 % | 22 % | 4 % | 90 % | 4 % |
| 0.80 | 7 % | 68 % | 9 % | 1 % | 100 % | 2 % |
| 0.85 | 2 % | 69 % | 2 % | 0 % | – | 0 % |
| 0.90 | 0 % | 67 % | 0 % | 0 % | – | 0 % |
| 0.95 | 0 % | – | 0 % | 0 % | – | 0 % |

## Sensitivity: box-score floor, lying boxes, detector fragments

| population | pilot-000 n | student AUC | baseline AUC | gain | filled | yardstick B2 n | student AUC | baseline AUC | gain | filled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| noFloor | 6043 | 0.72 (0.68–0.75) | 0.34 (0.31–0.38) | +0.384 (0.317 to 0.440) | 49 % (42–54) | 1066 | 0.84 (0.80–0.88) | 0.63 (0.58–0.68) | +0.205 (0.150 to 0.259) | 67 % (60–74) |
| floor0.20 | 4475 | 0.70 (0.65–0.74) | 0.40 (0.36–0.44) | +0.302 (0.216 to 0.376) | 54 % (48–59) | 871 | 0.80 (0.75–0.85) | 0.44 (0.38–0.50) | +0.356 (0.274 to 0.443) | 76 % (70–81) |
| floor0.225 | 3555 | 0.69 (0.65–0.74) | 0.45 (0.41–0.48) | +0.248 (0.174 to 0.324) | 58 % (52–63) | 793 | 0.78 (0.73–0.84) | 0.45 (0.39–0.51) | +0.333 (0.237 to 0.430) | 80 % (75–84) |
| floor0.25 | 2630 | 0.67 (0.61–0.73) | 0.50 (0.46–0.53) | +0.166 (0.088 to 0.249) | 62 % (56–67) | 703 | 0.76 (0.70–0.84) | 0.48 (0.41–0.56) | +0.283 (0.166 to 0.410) | 83 % (79–87) |
| floor0.30 | 1160 | 0.61 (0.53–0.71) | 0.53 (0.48–0.58) | +0.082 (-0.007 to 0.194) | 69 % (63–75) | 490 | 0.70 (0.58–0.82) | 0.47 (0.36–0.59) | +0.231 (0.029 to 0.411) | 90 % (86–93) |
| floor0.225+lying | 3593 | 0.70 (0.65–0.74) | 0.46 (0.42–0.49) | +0.241 (0.168 to 0.314) | 57 % (51–62) | 810 | 0.77 (0.71–0.83) | 0.46 (0.40–0.52) | +0.309 (0.212 to 0.408) | 79 % (74–83) |
| floor0.225, whole only (no cut or partial) | 2737 | 0.67 (0.61–0.72) | 0.39 (0.36–0.43) | +0.274 (0.192 to 0.347) | 58 % (53–63) | 645 | 0.70 (0.62–0.79) | 0.46 (0.39–0.54) | +0.241 (0.114 to 0.371) | 85 % (80–89) |

## Detector fragments

Cut: the detector flagged the box as cut by a detector tile edge. Partial: not cut, but shorter than 0.55 of its shelf band's height. Per-photo medians over all detected boxes (partial: over upright boxes). The student columns score the go-rule student on each kind; +fragment adds the cut flag and height over band (a separate row, outside the go rule).

| set | kind | n | share of population | filled | student AUC | student+fragment AUC |
|---|---|---:|---:|---:|---:|---:|
| pilot-000 | whole | 2737 | 77 % | 58 % (53–63) | 0.67 (0.62–0.72) | 0.67 (0.62–0.72) |
| pilot-000 | cut | 74 | 2 % | 45 % (32–56) | 0.73 (0.62–0.85) | 0.70 (0.59–0.82) |
| pilot-000 | partial | 744 | 21 % | 56 % (40–67) | 0.78 (0.74–0.81) | 0.78 (0.74–0.81) |
| yardstick B2 | whole | 645 | 81 % | 85 % (79–89) | 0.70 (0.62–0.80) | 0.70 (0.62–0.80) |
| yardstick B2 | cut | 59 | 7 % | 80 % (70–88) | 0.86 (0.66–0.96) | 0.86 (0.66–0.96) |
| yardstick B2 | partial | 89 | 11 % | 47 % (29–62) | 0.92 (0.84–0.97) | 0.92 (0.84–0.97) |

- pilot-000: per photo, median 3 % of boxes cut by a tile edge and 18 % of upright boxes partial.
- yardstick B2: per photo, median 1 % of boxes cut by a tile edge and 13 % of upright boxes partial.

## Owner hypothesis: top edges at frame edges and in oblique views

Single-feature separation of filled from not filled (AUC > 0.5: larger values go with filled).

| feature | pilot-000 | yardstick B2 |
|---|---:|---:|
| heightOffBand | 0.47 (0.44–0.51) | 0.39 (0.32–0.46) |
| heightOffBandSigned | 0.53 (0.50–0.56) | 0.62 (0.55–0.69) |
| topSeamOff | 0.41 (0.38–0.44) | 0.43 (0.39–0.47) |
| topSeamSigned | 0.45 (0.42–0.48) | 0.48 (0.42–0.55) |
| topY | 0.42 (0.38–0.45) | 0.41 (0.33–0.51) |

Top-seam class over all detected boxes: pilot-000 clean 45 %, overshoot 37 %, cut 16 %, none 2 %; yardstick B2 clean 52 %, overshoot 32 %, cut 16 %, none 0 %.

Breakdown by frame position and by whether the camera looks down onto the top (student population). Filled: teacher share ≥ text-read. Top classes: share of boxes and their filled share. ΔAUC: student+geometry minus student, within the cell.

**pilot-000**

| cell | n | photos | filled | clean: share, filled | overshoot: share, filled | cut: share, filled | student AUC | +geometry AUC | ΔAUC |
|---|---:|---:|---:|---|---|---|---:|---:|---:|
| all | 3555 | 31 | 58 % (51–63) | 50 %, 64 % (57–70) | 35 %, 51 % (45–56) | 13 %, 54 % (47–59) | 0.69 (0.65–0.74) | 0.71 (0.65–0.76) | +0.010 (0.003 to 0.019) |
| centre | 2107 | 31 | 68 % (62–73) | 58 %, 70 % (64–76) | 29 %, 64 % (57–70) | 13 %, 69 % (59–77) | 0.64 (0.58–0.70) | 0.65 (0.59–0.71) | +0.005 (-0.004 to 0.015) |
| edge | 1448 | 31 | 43 % (36–48) | 38 %, 51 % (42–61) | 44 %, 38 % (33–44) | 14 %, 34 % (27–40) | 0.70 (0.65–0.74) | 0.71 (0.66–0.75) | +0.008 (-0.004 to 0.021) |
| topNotInView | 2442 | 31 | 65 % (59–71) | 62 %, 68 % (62–75) | 28 %, 57 % (49–63) | 8 %, 77 % (67–84) | 0.66 (0.60–0.72) | 0.67 (0.61–0.73) | +0.015 (0.004 to 0.027) |
| topInView | 1113 | 29 | 40 % (34–46) | 24 %, 38 % (29–48) | 51 %, 44 % (37–50) | 24 %, 36 % (27–44) | 0.72 (0.66–0.76) | 0.69 (0.63–0.74) | -0.025 (-0.039 to -0.011) |
| centreTopNotInView | 1617 | 31 | 72 % (67–77) | 69 %, 71 % (65–77) | 21 %, 72 % (64–79) | 10 %, 80 % (71–87) | 0.62 (0.55–0.70) | 0.62 (0.55–0.70) | +0.001 (-0.008 to 0.011) |
| centreTopInView | 490 | 27 | 53 % (44–61) | 22 %, 53 % (43–64) | 58 %, 54 % (44–62) | 21 %, 51 % (32–66) | 0.65 (0.55–0.72) | 0.63 (0.54–0.70) | -0.016 (-0.033 to 0.002) |
| edgeTopNotInView | 825 | 31 | 52 % (44–59) | 48 %, 61 % (50–70) | 43 %, 42 % (36–49) | 5 %, 66 % (45–81) | 0.66 (0.59–0.71) | 0.69 (0.62–0.74) | +0.029 (0.013 to 0.046) |
| edgeTopInView | 623 | 29 | 31 % (24–37) | 25 %, 28 % (19–39) | 46 %, 34 % (24–42) | 27 %, 27 % (19–33) | 0.74 (0.66–0.79) | 0.70 (0.63–0.76) | -0.040 (-0.061 to -0.016) |

**yardstick B2**

| cell | n | photos | filled | clean: share, filled | overshoot: share, filled | cut: share, filled | student AUC | +geometry AUC | ΔAUC |
|---|---:|---:|---:|---|---|---|---:|---:|---:|
| all | 793 | 40 | 80 % (76–84) | 50 %, 84 % (80–87) | 34 %, 78 % (70–86) | 16 %, 74 % (61–85) | 0.78 (0.72–0.84) | 0.80 (0.74–0.85) | +0.018 (0.005 to 0.030) |
| centre | 643 | 40 | 85 % (80–89) | 49 %, 88 % (84–92) | 35 %, 83 % (77–90) | 16 %, 78 % (66–87) | 0.76 (0.67–0.84) | 0.78 (0.70–0.85) | +0.018 (0.003 to 0.036) |
| edge | 150 | 37 | 60 % (50–72) | 53 %, 68 % (58–80) | 30 %, 49 % (32–73) | 15 %, 57 % (38–78) | 0.80 (0.71–0.90) | 0.83 (0.75–0.91) | +0.032 (0.001 to 0.056) |
| topNotInView | 763 | 40 | 82 % (78–85) | 51 %, 85 % (81–88) | 33 %, 79 % (71–87) | 16 %, 77 % (66–87) | 0.77 (0.70–0.84) | 0.79 (0.72–0.86) | +0.021 (0.007 to 0.038) |
| topInView | 30 | 6 | 40 % (17–70) | 27 %, 38 % (0–69) | 53 %, 50 % (0–75) | 20 %, 17 % (0–100) | 0.90 (0.60–0.98) | 0.86 (0.46–0.95) | -0.042 (-0.198 to 0.000) |
| centreTopNotInView | 626 | 40 | 86 % (81–90) | 50 %, 89 % (84–92) | 34 %, 84 % (77–90) | 16 %, 79 % (68–89) | 0.74 (0.64–0.83) | 0.76 (0.67–0.85) | +0.023 (0.006 to 0.042) |
| centreTopInView | 17 | 5 | 53 % (20–91) | 18 %, 33 % (0–100) | 71 %, 67 % (56–100) | 12 %, 0 % (0–0) | 0.99 (0.33–1.00) | 0.92 (0.00–1.00) | -0.069 (-0.857 to 0.000) |
| edgeTopNotInView | 137 | 37 | 64 % (54–72) | 55 %, 69 % (59–80) | 30 %, 54 % (33–79) | 14 %, 63 % (46–83) | 0.80 (0.71–0.91) | 0.84 (0.76–0.92) | +0.035 (-0.002 to 0.065) |
| edgeTopInView | 13 | 3 | 23 % (0–60) | 38 %, 40 % (0–67) | 31 %, 0 % (0–0) | 31 %, 25 % (0–100) | 0.70 (0.50–0.75) | 0.70 (0.50–0.75) | +0.000 (0.000 to 0.000) |

