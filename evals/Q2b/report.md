# Q2b: Q-2's student on whole-spine boxes, and real outlines for U-4

Run 2026-11-03, card Q-2b ([`docs/capture/coverage.md`](../../docs/capture/coverage.md) §5, §6; [Q-2](../Q2/report.md)).
**Question.** Q-2's predicted fill was NO-GO, with a warning that it might shift once the detector stopped breaking
spines into pieces. F-0e has since made shelf-aligned `bands+strips` tiling the whole-case default, and the
not-a-book filter is on (F-0c's shape rules and F-0f's shelf-label rules). Does Q-2's student, unchanged, now pass
Q-2's go rule on the current default boxes?

**Box set measured.** On `pilot-000` (31 real-use photos), F-0e's `bands+strips` boxes, with the three readers F-0e
ran on them and F-0's decision on those readings (F-0c's cached copy, same v1 catalog). On the yardstick (40 Library
Dataset images, PROXY), F-0's own B2 run, which F-0e left as the default for shelf-scale photos. The shipped
not-a-book rules (cover pass off) drop boxes before anything is computed:
- **`pilot-000`:** 24 of 6,145 boxes, 7 by F-0c's shape rules and 17 by F-0f's shelf-label rules;
- **yardstick:** 16 of 1,132 boxes, 12 and 4.

F-0f's rules use each box's Vision and PP-OCR text and F-0f's cached pixel probe, so applying them needed no new
model run. Q-1's still features and Q-2's top-seam geometry were re-measured on the new boxes (a CPU pixel pass).
No reader or detector was re-run for Part A; Part B ran SAM 2.1 on the GPU. Rungs are **machine agreement, not
accuracy** (INV-17). The sets are reported side by side, never pooled (OC35). Every interval is a 95 % photo
bootstrap (1,000 draws, paired across models).

**Pre-registered: Q-2's rule, unchanged.**
- **τ** comes from Q-2's exact null procedure on `pilot-000`.
- **Population:** the box-score floor is 0.225, and lying boxes are left out.
- **Student:** the same five features, monotone, fit leaving one photo out, on `pilot-000` only. The yardstick is
  scored unchanged.
- **Go rule:** AUC ≥ 0.75, and a gain over crop width whose interval excludes 0.

Nothing about the model changed before the results. The code is Q-2's own (`q2-cli.ts`, now driven by a run config;
re-running Q-2 through it reproduces `evals/Q2/metrics.json` exactly).
- **One variant is not pre-registered.** τ held at Q-2's 0.71 was added after seeing a first run, made before
  F-0f's labels were removed, in which τ had moved to 0.76.

## Verdict

**NO-GO again.** The student's AUC on `pilot-000` is **0.711 (0.66–0.75)**. Q-2 had 0.729 (0.69–0.76), and the bar
is 0.75. The gain half passes, as before: **+0.30 (0.23 to 0.37)** over crop width.

- **Whole-only and all-box results agree.** On whole boxes only, the student gives 0.686 (0.63–0.73): also NO-GO.
- **FILL_P stays at 0.70**, Q-0's start. No score reaches the 90 % precision target; the best is 76 %, against
  Q-2's 82 %.
- **At FILL_P 0.70:** the student fills 36 % of boxes. **76 % (69–82)** of those fills are measured at `text-read`
  or above. Q-2 had 78 % (73–82).
- **Not pre-registered:** with τ held at Q-2's 0.71, the AUC is 0.714 (0.67–0.76), and the precision at FILL_P is
  77 % (70–82). That is still NO-GO, and almost the same as the main run.

## Findings

1. **The pieces are gone from the population.** Boxes cut by a tile edge fell from 37.5 % of the student
   population to 2.1 %. Whole boxes rose from 47 % to 77 %. Q-2's partial measure (under 0.55 of the band
   polygon's height) rose from 16 % to 21 %. F-0e warned that this measure moves with how bands come out. Against
   the band's spine height, F-0e measured partials falling from 8.1 % to 5.3 %. So this is now mostly a population
   of whole spines.
2. **Whole spines did not help the student.** Q-2's caveat was that the result might shift once F-0e landed. It
   moved slightly down, inside the intervals.
   - **By kind:** whole boxes give 0.69 (0.64–0.73) and partial boxes 0.79 (0.74–0.82). Short boxes are the easy
     cases. Whole spines are the hard population, and there are now more of them.
   - **Weights:** the student is still box detail plus tilt. The detail weight fell from 0.95 to 0.88 SD, and tilt
     from −0.30 to −0.20. Crop width, glare share and luma are dropped in all 31 folds, as in Q-2.
   - **Reading:** a whole spine nearly always shows some crisp texture, so "is there detail" separates less well.
3. **The hard pair stays hard.** Filled boxes against `spine-found` give 0.87 (Q-2: 0.86). Filled against
   `text-present` give only **0.61 (0.56–0.66)** (Q-2: 0.63). The fill line still runs through garbled against
   legible, and no S-S2 signal sees that difference.
4. **τ is 0.72 here, and it is fragile.** The null pairing's false agreement sits near the 1 % line from 0.70 to
   0.75 (1.01 % to 0.90 %). So small changes in the box set move τ by several hundredths.
   - **The shelf labels:** before F-0f's shelf-label rules dropped 17 boxes, the same procedure gave **0.76**, and
     the AUC was 0.695. A plausible cause, not checked box by box: shelf-talkers and genre strips repeat text
     across a photo, so they agree with each other by chance in the null pairing.
   - **Effect at 0.76:** 41 % of `no-catalog-match` boxes became `text-read`, against 45 % at 0.72 and 49 % in Q-2.
     The lower share moved boxes into the hard negative class.
   - **Lesson:** τ belongs to a box set, and to the not-a-book filter. Re-derive it whenever either changes, and
     never carry it across.
5. **Teacher rungs on the new boxes (all detected):**
   - **Q-2b:** spine-found 22 %, text-present 28 %, text-read 23 %, matched 15 %, confirmed 12 %.
   - **Q-2:** 25 %, 25 %, 25 %, 15 % and 10 %.
   - **Confirmed:** up by 2 points, as F-0e reported.
   - **Lying boxes at or above the floor:** down from 195 to 32 (F-0e's `strips` step, then the not-a-book filter).
6. **Calibration holds at home and shifts away, as in Q-2.**
   - **`pilot-000`:** ECE 0.035 (Q-2: 0.028).
   - **Yardstick:** the AUC transfers at 0.80 (0.75–0.87). The student is under-confident there (ECE 0.30), as in
     Q-2.
7. **The owner's top-edge pattern holds on whole spines.**
   - **Readability:** boxes whose tops face the camera read 42 % of the time, against 68 % for the rest.
   - **Geometry features:** adding them gives ΔAUC +0.013 (0.004 to 0.021). That is still small.
   - **The seam's `cut` class is unreliable on low rows.** H-1 (`evals/H1/report.md`, finding 7) found that Q-2's
     colour top seam locks onto either edge of a visible top face. So where the top faces the camera, a "cut" box
     is often the top face's far edge, not a cut spine. Here that is 24 % of top-in-view boxes. Treat the seam's
     cut/overshoot split there as a measure of top-face overlap, not of where the box ends. Q-2's pre-registered
     features and rule are unchanged.

## What follows

- **The live layer shows `seen` only** (§5), and the fill waits for measured outcomes. Q-3 draws the measured map
  from this teacher: τ 0.72 and floor 0.225 on the current default boxes, with the not-a-book filter on.
- **S-S2 signals alone do not reach the bar**, and whole spines make that clearer. The next retry should add S-S3
  text presence (PP-OCR detection only, or Vision text rectangles), pre-registered on these boxes. Q-2 already
  named it the next lever, and finding 3 is why.
- **FILL_P remains Q-0's 0.70 placeholder.** Precision at its best is 76 %, far from 90 %.

## Part B: real outlines for U-4

F-0b's `helpers/label/outline.py` ran unchanged on the GPU (MPS). It is SAM 2.1 base-plus, prompted with each box's
axis-aligned extent.
- **Run:** 6,138 boxes, all kept before F-0f's shelf-label rules landed; no errors; median 0.34 s a box.
- **Now kept:** 6,121 boxes. The 17 boxes now marked as shelf labels are left out of everything below.
- **Loader:** U-4's study now takes each box's own outline and its own Q-2b rung (source `q2b`).
- **Rule:** a box is drawn from its outline when the outline covers at least 60 % of it. This is U-4's rule,
  unchanged.
- **First study:** kept as source `f0b`; re-rendering it reproduces its summary exactly.

| measure | U-4 first study: F-0b outlines on F-0's boxes, Q-2 rungs | Q-2b outlines and rungs |
|---|---:|---:|
| spines drawn | 6,145 | 6,121 (not-a-book left out) |
| **drawn from a real mask outline** | **69 %** | **83.2 %** |
| median mask share of a box | 0.76 | 0.82 |
| filled (rung ≥ `text-read`) | 48.2 % | 50.2 % |
| `spine-found` | 30.1 % | 22.1 % |

- **Why 17 % still fall back to the box:**
  - **Under-covering masks (16.5 %):** the mask covers under 60 % of the box, because SAM took part of the spine,
    such as a label block.
  - **Masks outside the box (0.4 %):** the mask lies mostly outside the box.
  - **By kind:** cut boxes fall back more often (24 %) than whole (17 %) or partial (16 %) ones.
- **Rungs are now the box's own.** Before, a spine with no attached F-0 piece stayed `spine-found`. Now every spine
  carries its own teacher rung.
- **Top faces on low rows.** The prompt is the detector's box, and H-1 found that on low rows those boxes take in
  the book's top face. So the masks there can include the top face too. H-2's spine-face trim is the step that
  removes it; these outlines are its input.

U-4's still-image feel proxies, on the shape each variant draws (`docs/capture/display-modes.md` §3):

| variant | outline drawn | jaggedness p90 | perturbation wobble (median) | area CV (median) |
|---|---|---|---|---|
| dev, labelling | box | 0 → 0 | 1.00 → 1.00 | 0.018 → 0.018 |
| `user-glow` | mask hull, 2 passes | 0 → 0 | 0.752 → 0.752 | 0.018 → 0.018 |
| `user-veil` | mask hull, 3 passes | 0 → 0 | 0.743 → 0.744 | 0.018 → 0.018 |
| `user-ridge` | raw mask, 1 pass | 0.051 → 0.059 | 0.791 → 0.791 | 0.019 → 0.019 |

The proxies hardly move. More spines are drawn from masks, and the hull variants stay convex. The raw-mask ridges
gain a slightly longer jagged tail, because more raw outlines are drawn. The re-rendered study is at the data
root's `private/u4/renders/pilot-000/index.html`; `user-glow` is the page's default A.

## Private outputs

Everything per box or per photo lives under the data root's `private/q2b/`, never in the repo:
- `features/`, `q1table/`, `geometry/`: Q-1's features, Q-1's table and Q-2's top seam on the new boxes;
- `table/`: rung, population flag, student and baseline scores per box (the U-4 study reads its rungs from here);
- `renders/pilot-000/index.html`: Q-2's renders on the new boxes (measured fill, predicted fill, agreement, top
  edge);
- `diag-tau/`: the not-pre-registered τ = 0.71 run;
- `outlines/pilot-000.jsonl`: one SAM 2.1 outline per box (H-2's input).

To regenerate:
1. Run `uv sync` in `helpers/coverage`, then `node src/eval/q2b-cli.ts all`.
2. For the outlines, run `uv sync` in `helpers/label`, then `node src/eval/q2b-cli.ts outlines` (GPU).
3. Run `node src/eval/q2b-cli.ts u4`, then `analyse` again, so `metrics.json` picks up U-4's before and after.

<!-- Tables below are generated by `node src/eval/q2b-cli.ts analyse`; edit above this line only. -->

## Q-2 against Q-2b (pilot-000)

Q-2: F-0's B2 boxes. Q-2b: the current default (F-0e `bands+strips`, F-0c's and F-0f's not-a-book filter). Same teacher procedure, same student, same rule; intervals are 95 % paired photo bootstraps within each run.

| figure | Q-2 | Q-2b |
|---|---:|---:|
| detected boxes | 6894 | 6121 |
| student population (floor, upright, measurable) | 3958 | 3555 |
| filled share of the population | 60 % (55–65) | 60 % (54–65) |
| τ | 0.71 | 0.72 |
| **student AUC (leave one photo out)** | 0.729 (0.69–0.76) | 0.711 (0.66–0.75) |
| **gain over crop width** | +0.276 (0.212 to 0.336) | +0.297 (0.225 to 0.368) |
| gain over crop width, best direction with hindsight | +0.204 (0.159 to 0.248) | +0.192 (0.128 to 0.240) |
| student AUC in sample (optimistic) | 0.733 (0.70–0.77) | 0.717 (0.67–0.75) |
| filled vs spine-found only | 0.864 (0.84–0.88) | 0.871 (0.85–0.89) |
| filled vs text-present only | 0.633 (0.60–0.67) | 0.611 (0.56–0.66) |
| ECE | 0.028 (0.02–0.05) | 0.035 (0.03–0.06) |
| Brier | 0.199 (0.19–0.21) | 0.205 (0.19–0.22) |
| yardstick AUC (one pilot fit, unchanged) | 0.803 (0.75–0.87) | 0.802 (0.75–0.87) |
| yardstick ECE | 0.281 (0.24–0.32) | 0.298 (0.25–0.34) |
| FILL_P | 0.7 (target not met) | 0.7 (target not met) |
| best precision (≥ 5 % filled) | 82.5 % | 76.4 % |
| at FILL_P: share predicted filled | 39 % (33–45) | 36 % (30–42) |
| **at FILL_P: precision of "filled"** | 78 % (73–82) | 76 % (69–82) |
| at FILL_P: recall | 51 % (45–55) | 46 % (41–51) |
| population: cut by a tile edge | 37.5 % | 2.1 % |
| population: partial (under 0.55 of band) | 15.6 % | 20.9 % |
| population: whole | 46.8 % | 77.0 % |
| cut boxes per photo, median (all detected) | 28.9 % | 3.5 % |
| whole only: n | 1854 | 2737 |
| whole only: student AUC | 0.723 (0.68–0.77) | 0.686 (0.63–0.73) |
| whole only: gain over crop width | +0.187 (0.122 to 0.248) | +0.332 (0.260 to 0.395) |
| whole only: Q-2's rule | NO-GO | NO-GO |
| **verdict by Q-2's rule** | NO-GO | NO-GO |

Whole-only and all-box results agree on the verdict: whole only NO-GO, all boxes NO-GO.

### Not pre-registered: τ held at Q-2's 0.71

The null procedure gives a different τ on the new boxes, which moves boxes between `text-present` and `text-read`. This diagnostic re-runs everything with τ fixed at Q-2's value, to separate the label shift from the box change. It is outside the go rule.

| figure | Q-2 | Q-2b at τ = 0.71 |
|---|---:|---:|
| detected boxes | 6894 | 6121 |
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

τ = 0.72 (string agreement), box-score floor = 0.225. Counts are machine agreement, not accuracy.

| set | group | n | spine-found | text-present | text-read | matched | confirmed |
|---|---|---:|---:|---:|---:|---:|---:|
| pilot-000 | all detected | 6121 | 1354 (22 %) | 1697 (28 %) | 1413 (23 %) | 926 (15 %) | 731 (12 %) |
| pilot-000 | below floor | 2534 | 777 (31 %) | 811 (32 %) | 454 (18 %) | 336 (13 %) | 156 (6 %) |
| pilot-000 | lying, at/above floor | 32 | 23 (72 %) | 5 (16 %) | 1 (3 %) | 3 (9 %) | 0 (0 %) |
| pilot-000 | **student population** | 3555 | 554 (16 %) | 881 (25 %) | 958 (27 %) | 587 (17 %) | 575 (16 %) |
| yardstick B2 | all detected | 1116 | 276 (25 %) | 99 (9 %) | 311 (28 %) | 161 (14 %) | 269 (24 %) |
| yardstick B2 | below floor | 306 | 181 (59 %) | 37 (12 %) | 54 (18 %) | 12 (4 %) | 22 (7 %) |
| yardstick B2 | lying, at/above floor | 17 | 10 (59 %) | 4 (24 %) | 0 (0 %) | 1 (6 %) | 2 (12 %) |
| yardstick B2 | **student population** | 793 | 85 (11 %) | 58 (7 %) | 257 (32 %) | 148 (19 %) | 245 (31 %) |

- pilot-000: 31 photos; filled share of the population 60 % (54–65); 0 boxes left out for an unmeasurable feature.
- yardstick B2: 40 photos; filled share of the population 82 % (77–86); 0 boxes left out for an unmeasurable feature; 22 accepted boxes name a work not in the photo's annotations (kept at `confirmed`: the teacher cannot see annotations).

### Setting τ: null pairing versus real agreement

Null pass: share of null pairs (one reader on a box, another reader on a different box of the same photo) at or above τ. Accepted pass: share of catalog-confirmed boxes whose readers' strings agree at τ. No-match pass: share of `no-catalog-match` boxes promoted to `text-read`.

| τ | pilot-000 null | accepted | no-match | yardstick B2 null | accepted | no-match |
|---:|---:|---:|---:|---:|---:|---:|
| 0.6 | 4 % | 95 % | 59 % | 10 % | 97 % | 85 % |
| 0.7 | 1 % | 85 % | 48 % | 6 % | 89 % | 77 % |
| **0.72** | 1 % | 82 % | 45 % | 6 % | 86 % | 76 % |
| 0.75 | 1 % | 78 % | 43 % | 5 % | 85 % | 73 % |
| 0.8 | 1 % | 73 % | 37 % | 3 % | 81 % | 68 % |
| 0.85 | 1 % | 67 % | 31 % | 3 % | 74 % | 60 % |
| 0.9 | 0 % | 61 % | 25 % | 2 % | 66 % | 53 % |
| 0.95 | 0 % | 50 % | 19 % | 1 % | 56 % | 45 % |
| 1 | 0 % | 41 % | 16 % | 1 % | 45 % | 39 % |

## Student: AUC, gain over the crop-width baseline, calibration

pilot-000 scores are leave-one-image-out; the yardstick is scored by one fit on all of pilot-000, unchanged. Intervals: paired photo bootstrap.

| model | pilot-000 AUC | Δ vs baseline | Δ vs student | ECE | Brier | yardstick B2 AUC | Δ vs baseline | Δ vs student | ECE | Brier |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline | 0.41 (0.38–0.45) | – | – | 0.082 (0.052–0.111) | 0.243 (0.234–0.254) | 0.44 (0.38–0.50) | – | – | 0.241 (0.191–0.283) | 0.207 (0.200–0.214) |
| student | 0.71 (0.66–0.75) | +0.297 (0.225 to 0.368) | – | 0.035 (0.028–0.062) | 0.205 (0.191–0.223) | 0.80 (0.75–0.87) | +0.361 (0.272 to 0.464) | – | 0.298 (0.254–0.340) | 0.199 (0.185–0.217) |
| student-logCropWidthPx | 0.71 (0.66–0.75) | +0.297 (0.225 to 0.368) | +0.000 (0.000 to 0.000) | 0.035 (0.028–0.062) | 0.205 (0.191–0.223) | 0.80 (0.75–0.87) | +0.361 (0.272 to 0.464) | +0.000 (0.000 to 0.000) | 0.298 (0.254–0.340) | 0.199 (0.185–0.217) |
| student-logDetail | 0.49 (0.47–0.53) | +0.080 (0.038 to 0.127) | -0.216 (-0.273 to -0.153) | 0.028 (0.013–0.068) | 0.241 (0.232–0.253) | 0.50 (0.41–0.57) | +0.057 (-0.033 to 0.131) | -0.304 (-0.412 to -0.222) | 0.214 (0.165–0.256) | 0.191 (0.183–0.202) |
| student-glareShare | 0.71 (0.66–0.75) | +0.297 (0.225 to 0.368) | +0.000 (0.000 to 0.000) | 0.035 (0.028–0.062) | 0.205 (0.191–0.223) | 0.80 (0.75–0.87) | +0.361 (0.272 to 0.464) | +0.000 (0.000 to 0.000) | 0.298 (0.254–0.340) | 0.199 (0.185–0.217) |
| student-lumaOffMid | 0.71 (0.66–0.75) | +0.297 (0.225 to 0.368) | +0.000 (0.000 to 0.000) | 0.035 (0.028–0.062) | 0.205 (0.191–0.223) | 0.80 (0.75–0.87) | +0.361 (0.272 to 0.464) | +0.000 (0.000 to 0.000) | 0.298 (0.254–0.340) | 0.199 (0.185–0.217) |
| student-tiltDeg | 0.70 (0.66–0.75) | +0.289 (0.217 to 0.359) | -0.007 (-0.013 to -0.002) | 0.028 (0.023–0.065) | 0.207 (0.193–0.224) | 0.80 (0.74–0.87) | +0.357 (0.264 to 0.463) | -0.003 (-0.010 to 0.003) | 0.313 (0.269–0.356) | 0.209 (0.195–0.227) |
| student+heightOffBand | 0.71 (0.66–0.75) | +0.296 (0.224 to 0.369) | -0.001 (-0.003 to 0.002) | 0.037 (0.027–0.063) | 0.205 (0.191–0.223) | 0.81 (0.75–0.87) | +0.366 (0.280 to 0.469) | +0.006 (-0.002 to 0.014) | 0.302 (0.258–0.348) | 0.203 (0.187–0.223) |
| student+topSeamOff | 0.72 (0.68–0.77) | +0.309 (0.235 to 0.381) | +0.012 (0.005 to 0.020) | 0.035 (0.025–0.062) | 0.201 (0.186–0.220) | 0.81 (0.76–0.87) | +0.368 (0.278 to 0.463) | +0.007 (-0.010 to 0.024) | 0.292 (0.252–0.335) | 0.197 (0.180–0.217) |
| student+geometry | 0.72 (0.68–0.77) | +0.309 (0.234 to 0.383) | +0.013 (0.004 to 0.021) | 0.038 (0.028–0.066) | 0.201 (0.186–0.220) | 0.82 (0.77–0.88) | +0.378 (0.296 to 0.474) | +0.017 (-0.001 to 0.032) | 0.301 (0.262–0.344) | 0.201 (0.185–0.224) |
| diag:signFree | 0.74 (0.69–0.77) | +0.323 (0.253 to 0.390) | +0.026 (0.012 to 0.037) | 0.025 (0.020–0.052) | 0.198 (0.184–0.215) | 0.81 (0.75–0.88) | +0.370 (0.291 to 0.463) | +0.009 (-0.013 to 0.033) | 0.449 (0.399–0.498) | 0.323 (0.295–0.355) |
| diag:student+viewElevation | 0.72 (0.68–0.76) | +0.309 (0.240 to 0.374) | +0.013 (-0.003 to 0.026) | 0.051 (0.038–0.072) | 0.200 (0.185–0.217) | 0.80 (0.75–0.86) | +0.360 (0.272 to 0.456) | -0.000 (-0.018 to 0.016) | 0.257 (0.216–0.299) | 0.175 (0.161–0.191) |
| diag:student+fragment | 0.71 (0.66–0.75) | +0.297 (0.226 to 0.368) | +0.000 (-0.002 to 0.002) | 0.034 (0.026–0.061) | 0.205 (0.191–0.223) | 0.80 (0.74–0.87) | +0.357 (0.268 to 0.463) | -0.003 (-0.009 to 0.004) | 0.304 (0.259–0.347) | 0.204 (0.190–0.221) |

- pilot-000: n = 3555 boxes in 31 photos, filled share 60 % (54–64).
- yardstick B2: n = 793 boxes in 40 photos, filled share 82 % (77–86).

Weights of the full pilot-000 fit, on standardised features (0 = dropped by the monotone rule). Folds dropping: of 31 leave-one-out fits, how many dropped the feature.

| model | logCropWidthPx | logDetail | glareShare | lumaOffMid | tiltDeg | heightOffBand | topSeamOff | topBelowCentre | cutByTile | heightOverBand | dropped (full fit) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| baseline | -0.05 |  |  |  |  |  |  |  |  |  | – |
| student | 0.00 (31/31) | 0.88 | 0.00 (31/31) | 0.00 (31/31) | -0.20 |  |  |  |  |  | logCropWidthPx, lumaOffMid, glareShare |
| student-logCropWidthPx |  | 0.88 | 0.00 (31/31) | 0.00 (31/31) | -0.20 |  |  |  |  |  | lumaOffMid, glareShare |
| student-logDetail | 0.00 (31/31) |  | 0.00 (31/31) | 0.00 (31/31) | -0.15 |  |  |  |  |  | glareShare, lumaOffMid, logCropWidthPx |
| student-glareShare | 0.00 (31/31) | 0.88 |  | 0.00 (31/31) | -0.20 |  |  |  |  |  | logCropWidthPx, lumaOffMid |
| student-lumaOffMid | 0.00 (31/31) | 0.88 | 0.00 (31/31) |  | -0.20 |  |  |  |  |  | logCropWidthPx, glareShare |
| student-tiltDeg | 0.00 (31/31) | 0.86 | 0.00 (31/31) | 0.00 (31/31) |  |  |  |  |  |  | logCropWidthPx, lumaOffMid, glareShare |
| student+heightOffBand | 0.00 (31/31) | 0.88 | 0.00 (31/31) | 0.00 (31/31) | -0.18 | -0.08 |  |  |  |  | logCropWidthPx, lumaOffMid, glareShare |
| student+topSeamOff | 0.00 (31/31) | 0.89 | 0.00 (31/31) | 0.00 (31/31) | -0.18 |  | -0.30 |  |  |  | logCropWidthPx, lumaOffMid, glareShare |
| student+geometry | 0.00 (31/31) | 0.89 | 0.00 (31/31) | 0.00 (31/31) | -0.16 | -0.11 | -0.31 |  |  |  | logCropWidthPx, lumaOffMid, glareShare |
| diag:signFree | -0.43 | 1.08 | -0.00 | 0.13 | -0.14 |  |  |  |  |  | – |
| diag:student+viewElevation | 0.00 (31/31) | 0.88 | 0.00 (30/31) | 0.00 (31/31) | -0.15 |  |  | -0.34 |  |  | logCropWidthPx, lumaOffMid, glareShare |
| diag:student+fragment | 0.00 (31/31) | 0.88 | 0.00 (31/31) | 0.00 (31/31) | -0.20 |  |  |  | -0.08 | 0.00 (31/31) | logCropWidthPx, lumaOffMid, glareShare, heightOverBand |

### Reliability (student; 10 equal-width bins of the predicted score)

| bin | pilot-000 n | mean score | measured filled | yardstick B2 n | mean score | measured filled |
|---|---:|---:|---:|---:|---:|---:|
| 0.0–0.1 | 17 | 0.07 | 0.00 | 20 | 0.07 | 0.00 |
| 0.1–0.2 | 103 | 0.15 | 0.14 | 41 | 0.15 | 0.27 |
| 0.2–0.3 | 210 | 0.26 | 0.20 | 54 | 0.26 | 0.56 |
| 0.3–0.4 | 301 | 0.35 | 0.33 | 62 | 0.36 | 0.77 |
| 0.4–0.5 | 415 | 0.45 | 0.45 | 110 | 0.45 | 0.84 |
| 0.5–0.6 | 502 | 0.55 | 0.62 | 194 | 0.56 | 0.91 |
| 0.6–0.7 | 715 | 0.65 | 0.69 | 192 | 0.65 | 0.94 |
| 0.7–0.8 | 833 | 0.75 | 0.76 | 103 | 0.74 | 0.93 |
| 0.8–0.9 | 449 | 0.84 | 0.76 | 17 | 0.83 | 0.94 |
| 0.9–1.0 | 10 | 0.91 | 0.70 | 0 | – | – |

## Go rule

Student AUC on pilot-000 0.71 (0.66–0.75) (rule: ≥ 0.75); gain over crop width +0.297 (0.225 to 0.368) (rule: interval excludes 0). **NO-GO** on the predicted fill.

Unrounded: student 0.711; sign-free diagnostic 0.737.

Robustness (paired photo bootstrap). Oracle width: crop width ranked in the better direction with hindsight, no folds. Against each negative: filled boxes versus `spine-found` only, and versus `text-present` only. In-sample: the full pilot-000 fit scored on its own training rows (optimistic).

| set | oracle width AUC | student − oracle width | student vs spine-found | student vs text-present | student in-sample |
|---|---:|---:|---:|---:|---:|
| pilot-000 | 0.52 (0.50–0.56) | +0.192 (0.128 to 0.240) | 0.87 (0.85–0.89) | 0.61 (0.56–0.66) | 0.72 (0.67–0.75) |
| yardstick B2 | 0.56 (0.51–0.61) | +0.244 (0.181 to 0.311) | 0.94 (0.90–0.97) | 0.61 (0.51–0.72) | 0.80 (0.75–0.86) |

Diagnostic, not the go rule: the same five features with every direction learned give 0.74 (0.69–0.77), gain +0.323 (0.253 to 0.390) (would not pass).

## Operating point (FILL_P)

No score reaches the precision target on pilot-000 (best 76 % where at least 5 % are filled). FILL_P = **0.7**, Q-0's starting value, proposed unchanged.

| set | filled share | precision (measured ≥ text-read) | recall |
|---|---:|---:|---:|
| pilot-000 | 36 % (30–42) | 76 % (69–82) | 46 % (41–51) |
| yardstick B2 | 15 % (11–19) | 93 % (89–98) | 17 % (13–22) |

| score ≥ | pilot-000 filled | precision | recall | yardstick B2 filled | precision | recall |
|---:|---:|---:|---:|---:|---:|---:|
| 0.30 | 91 % | 64 % | 97 % | 86 % | 90 % | 94 % |
| 0.35 | 87 % | 66 % | 95 % | 82 % | 91 % | 91 % |
| 0.40 | 82 % | 67 % | 93 % | 78 % | 91 % | 86 % |
| 0.45 | 77 % | 69 % | 89 % | 70 % | 91 % | 78 % |
| 0.50 | 71 % | 71 % | 84 % | 64 % | 93 % | 72 % |
| 0.55 | 64 % | 72 % | 77 % | 54 % | 93 % | 61 % |
| 0.60 | 56 % | 73 % | 69 % | 39 % | 94 % | 45 % |
| 0.65 | 47 % | 75 % | 59 % | 29 % | 94 % | 33 % |
| 0.70 | 36 % | 76 % | 46 % | 15 % | 93 % | 17 % |
| 0.75 | 25 % | 76 % | 32 % | 8 % | 92 % | 9 % |
| 0.80 | 13 % | 76 % | 17 % | 2 % | 94 % | 2 % |
| 0.85 | 4 % | 75 % | 5 % | 0 % | 100 % | 0 % |
| 0.90 | 0 % | 70 % | 0 % | 0 % | – | 0 % |
| 0.95 | 0 % | – | 0 % | 0 % | – | 0 % |

## Sensitivity: box-score floor, lying boxes, detector fragments

| population | pilot-000 n | student AUC | baseline AUC | gain | filled | yardstick B2 n | student AUC | baseline AUC | gain | filled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| noFloor | 6043 | 0.73 (0.70–0.76) | 0.36 (0.32–0.40) | +0.373 (0.302 to 0.429) | 51 % (44–56) | 1066 | 0.85 (0.81–0.89) | 0.64 (0.59–0.69) | +0.208 (0.150 to 0.264) | 69 % (61–76) |
| floor0.20 | 4475 | 0.72 (0.67–0.75) | 0.35 (0.31–0.39) | +0.367 (0.286 to 0.434) | 56 % (50–62) | 871 | 0.82 (0.77–0.87) | 0.43 (0.38–0.49) | +0.382 (0.305 to 0.464) | 78 % (72–83) |
| floor0.225 | 3555 | 0.71 (0.66–0.75) | 0.41 (0.37–0.45) | +0.297 (0.219 to 0.368) | 60 % (54–65) | 793 | 0.80 (0.75–0.86) | 0.44 (0.39–0.50) | +0.361 (0.274 to 0.454) | 82 % (77–86) |
| floor0.25 | 2630 | 0.69 (0.63–0.74) | 0.49 (0.45–0.52) | +0.200 (0.125 to 0.279) | 64 % (59–70) | 703 | 0.78 (0.70–0.86) | 0.47 (0.41–0.54) | +0.303 (0.194 to 0.419) | 85 % (80–89) |
| floor0.30 | 1160 | 0.65 (0.56–0.74) | 0.53 (0.48–0.58) | +0.118 (0.017 to 0.235) | 72 % (66–78) | 490 | 0.71 (0.57–0.86) | 0.45 (0.36–0.58) | +0.263 (0.043 to 0.454) | 91 % (87–95) |
| floor0.225+lying | 3587 | 0.71 (0.66–0.75) | 0.42 (0.38–0.46) | +0.291 (0.213 to 0.361) | 59 % (53–64) | 810 | 0.79 (0.72–0.85) | 0.45 (0.39–0.51) | +0.332 (0.246 to 0.425) | 81 % (75–85) |
| floor0.225, whole only (no cut or partial) | 2737 | 0.69 (0.63–0.73) | 0.35 (0.33–0.39) | +0.332 (0.260 to 0.395) | 61 % (56–65) | 645 | 0.73 (0.64–0.82) | 0.45 (0.38–0.53) | +0.272 (0.141 to 0.406) | 87 % (82–91) |

## Detector fragments

Cut: the detector flagged the box as cut by a detector tile edge. Partial: not cut, but shorter than 0.55 of its shelf band's height. Per-photo medians over all detected boxes (partial: over upright boxes). The student columns score the go-rule student on each kind; +fragment adds the cut flag and height over band (a separate row, outside the go rule).

| set | kind | n | share of population | filled | student AUC | student+fragment AUC |
|---|---|---:|---:|---:|---:|---:|
| pilot-000 | whole | 2737 | 77 % | 61 % (55–66) | 0.69 (0.64–0.73) | 0.69 (0.64–0.73) |
| pilot-000 | cut | 74 | 2 % | 47 % (33–59) | 0.74 (0.62–0.85) | 0.71 (0.59–0.83) |
| pilot-000 | partial | 744 | 21 % | 57 % (41–69) | 0.79 (0.74–0.82) | 0.79 (0.74–0.82) |
| yardstick B2 | whole | 645 | 81 % | 87 % (81–91) | 0.73 (0.63–0.84) | 0.73 (0.63–0.84) |
| yardstick B2 | cut | 59 | 7 % | 81 % (72–91) | 0.86 (0.64–0.97) | 0.86 (0.64–0.97) |
| yardstick B2 | partial | 89 | 11 % | 48 % (31–64) | 0.93 (0.85–0.97) | 0.93 (0.85–0.97) |

- pilot-000: per photo, median 3 % of boxes cut by a tile edge and 18 % of upright boxes partial.
- yardstick B2: per photo, median 1 % of boxes cut by a tile edge and 13 % of upright boxes partial.

## Owner hypothesis: top edges at frame edges and in oblique views

Single-feature separation of filled from not filled (AUC > 0.5: larger values go with filled).

| feature | pilot-000 | yardstick B2 |
|---|---:|---:|
| heightOffBand | 0.47 (0.43–0.50) | 0.38 (0.31–0.46) |
| heightOffBandSigned | 0.53 (0.50–0.56) | 0.63 (0.56–0.70) |
| topSeamOff | 0.40 (0.37–0.43) | 0.44 (0.40–0.49) |
| topSeamSigned | 0.44 (0.41–0.47) | 0.47 (0.40–0.55) |
| topY | 0.41 (0.38–0.45) | 0.40 (0.32–0.51) |

Top-seam class over all detected boxes: pilot-000 clean 45 %, overshoot 37 %, cut 16 %, none 2 %; yardstick B2 clean 52 %, overshoot 32 %, cut 16 %, none 0 %.

Breakdown by frame position and by whether the camera looks down onto the top (student population). Filled: teacher share ≥ text-read. Top classes: share of boxes and their filled share. ΔAUC: student+geometry minus student, within the cell.

**pilot-000**

| cell | n | photos | filled | clean: share, filled | overshoot: share, filled | cut: share, filled | student AUC | +geometry AUC | ΔAUC |
|---|---:|---:|---:|---|---|---|---:|---:|---:|
| all | 3555 | 31 | 60 % (53–65) | 50 %, 67 % (60–73) | 35 %, 52 % (46–58) | 13 %, 55 % (48–61) | 0.71 (0.66–0.75) | 0.72 (0.68–0.77) | +0.013 (0.004 to 0.021) |
| centre | 2107 | 31 | 71 % (65–76) | 58 %, 72 % (67–78) | 29 %, 66 % (60–73) | 13 %, 71 % (62–80) | 0.67 (0.61–0.72) | 0.67 (0.61–0.73) | +0.006 (-0.004 to 0.016) |
| edge | 1448 | 31 | 44 % (38–49) | 38 %, 53 % (43–64) | 44 %, 39 % (33–44) | 14 %, 35 % (28–41) | 0.71 (0.66–0.75) | 0.72 (0.67–0.76) | +0.011 (-0.003 to 0.026) |
| topNotInView | 2442 | 31 | 68 % (62–73) | 62 %, 71 % (65–77) | 28 %, 58 % (51–66) | 8 %, 79 % (69–85) | 0.68 (0.62–0.73) | 0.70 (0.64–0.75) | +0.018 (0.007 to 0.030) |
| topInView | 1113 | 29 | 42 % (35–48) | 24 %, 39 % (30–49) | 51 %, 45 % (38–51) | 24 %, 38 % (29–45) | 0.72 (0.67–0.77) | 0.70 (0.64–0.75) | -0.026 (-0.040 to -0.011) |
| centreTopNotInView | 1617 | 31 | 75 % (70–80) | 69 %, 74 % (69–80) | 21 %, 75 % (67–82) | 10 %, 81 % (73–88) | 0.65 (0.58–0.72) | 0.65 (0.58–0.72) | +0.003 (-0.006 to 0.013) |
| centreTopInView | 490 | 27 | 55 % (46–63) | 22 %, 53 % (43–64) | 58 %, 56 % (47–65) | 21 %, 55 % (36–69) | 0.66 (0.58–0.72) | 0.64 (0.56–0.71) | -0.018 (-0.036 to 0.004) |
| edgeTopNotInView | 825 | 31 | 53 % (46–60) | 48 %, 63 % (52–72) | 43 %, 43 % (37–50) | 5 %, 66 % (45–81) | 0.67 (0.60–0.72) | 0.70 (0.64–0.74) | +0.033 (0.015 to 0.052) |
| edgeTopInView | 623 | 29 | 31 % (24–37) | 25 %, 29 % (19–41) | 46 %, 34 % (24–42) | 27 %, 28 % (20–33) | 0.74 (0.67–0.80) | 0.70 (0.63–0.76) | -0.040 (-0.061 to -0.016) |

**yardstick B2**

| cell | n | photos | filled | clean: share, filled | overshoot: share, filled | cut: share, filled | student AUC | +geometry AUC | ΔAUC |
|---|---:|---:|---:|---|---|---|---:|---:|---:|
| all | 793 | 40 | 82 % (77–86) | 50 %, 85 % (81–88) | 34 %, 80 % (72–88) | 16 %, 79 % (65–90) | 0.80 (0.75–0.86) | 0.82 (0.77–0.87) | +0.017 (0.001 to 0.031) |
| centre | 643 | 40 | 87 % (82–91) | 49 %, 89 % (85–93) | 35 %, 86 % (79–91) | 16 %, 82 % (70–92) | 0.79 (0.70–0.87) | 0.81 (0.73–0.88) | +0.019 (0.001 to 0.038) |
| edge | 150 | 37 | 61 % (50–73) | 53 %, 68 % (58–80) | 30 %, 49 % (32–73) | 15 %, 65 % (42–88) | 0.79 (0.71–0.90) | 0.82 (0.75–0.91) | +0.030 (-0.011 to 0.059) |
| topNotInView | 763 | 40 | 83 % (80–87) | 51 %, 86 % (82–89) | 33 %, 81 % (74–88) | 16 %, 82 % (70–92) | 0.79 (0.71–0.86) | 0.81 (0.74–0.87) | +0.019 (0.001 to 0.038) |
| topInView | 30 | 6 | 43 % (26–78) | 27 %, 50 % (13–86) | 53 %, 50 % (0–75) | 20 %, 17 % (0–100) | 0.91 (0.76–1.00) | 0.89 (0.69–1.00) | -0.014 (-0.086 to 0.028) |
| centreTopNotInView | 626 | 40 | 88 % (83–91) | 50 %, 89 % (85–93) | 34 %, 87 % (80–92) | 16 %, 83 % (71–93) | 0.77 (0.67–0.86) | 0.79 (0.70–0.87) | +0.021 (0.002 to 0.045) |
| centreTopInView | 17 | 5 | 59 % (40–100) | 18 %, 67 % (0–100) | 71 %, 67 % (56–100) | 12 %, 0 % (0–0) | 1.00 (1.00–1.00) | 1.00 (1.00–1.00) | +0.000 (0.000 to 0.000) |
| edgeTopNotInView | 137 | 37 | 65 % (56–74) | 55 %, 69 % (59–80) | 30 %, 54 % (33–79) | 14 %, 74 % (53–93) | 0.80 (0.70–0.90) | 0.83 (0.75–0.92) | +0.033 (-0.012 to 0.068) |
| edgeTopInView | 13 | 3 | 23 % (0–60) | 38 %, 40 % (0–67) | 31 %, 0 % (0–0) | 31 %, 25 % (0–100) | 0.70 (0.50–0.75) | 0.70 (0.50–0.75) | +0.000 (0.000 to 0.000) |

