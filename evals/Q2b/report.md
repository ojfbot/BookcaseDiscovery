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

## Re-baseline 2026-11-04 (F-0i + NB-3 on-lip)

Re-run once on RB-1's box set ([evals/RB1](../RB1/report.md)): F-0i's partition (#51) of the shipped default boxes, less NB-3's `on-lip` boxes (#61). Box ids and detection rectangles are unchanged; F-0m (#60) and F-0k (#62) shipped nothing. Before: main 116f4e9, as published. Generated by `node src/eval/rb1-cli.ts summary`; the tables below this section are the re-run's.

What re-ran: `q2b-cli.ts u4` (U-4's still study, both sources), `diag`, `analyse`, `render`. Q-1's features and Q-2's top-seam geometry are per box on unchanged detection rectangles, so their caches stand; `features` and `outlines` (GPU) were not re-run. U-4's outlines are now F-0i's exclusive outlines.

- τ moves 0.72 → 0.73 under the null procedure, inside the fragile band Q-2b reported (0.70–0.76).
- U-4's mask-shaped share falls because F-0i's exclusive outlines cut each box to the pixels it owns: more boxes are covered under 60 % by their own outline and are drawn as their box. This is the partition doing what it was built for, not an outline loss.

**pilot-000** (machine agreement, never accuracy (INV-17))

| figure | as published | RB-1 |
|---|---|---|
| detected boxes | 6121 | 5757 |
| student population | 3555 | 3478 |
| τ | 0.72 | 0.73 |
| filled share of the population (%) | 59.6 (54.1 to 64.7) | 59.2 (53.6 to 64.2) |
| **student AUC** (leave one photo out) | 0.711 (0.664 to 0.754) | 0.710 (0.661 to 0.753) |
| gain over crop width | 0.297 (0.225 to 0.368) | 0.305 (0.232 to 0.377) |
| whole only: student AUC | 0.688 (0.640 to 0.734) | 0.687 (0.638 to 0.735) |
| precision of "filled" at FILL_P (%) | 75.9 (68.8 to 81.5) | 75.4 (68.0 to 81.0) |
| U-4 boxes drawn from their own outline (%) | 83.2 | 79.2 |
| U-4 filled spines (%) | 50.2 | 51.0 |

**yardstick** (PROXY, library shelves)

| figure | as published | RB-1 |
|---|---|---|
| detected boxes | 1116 | 1038 |
| student population | 793 | 757 |
| student AUC (one pilot fit) | 0.802 (0.746 to 0.870) | 0.797 (0.732 to 0.861) |
| precision of "filled" at FILL_P (%) | 93.3 (88.7 to 98.0) | 91.8 (86.4 to 97.7) |

**Q-2's go rule (GO):** no → no (no flip).

<!-- Tables below are generated by `node src/eval/q2b-cli.ts analyse`; edit above this line only. -->

## Q-2 against Q-2b (pilot-000)

Q-2: F-0's B2 boxes. Q-2b: the current default (F-0e `bands+strips`, F-0c's and F-0f's not-a-book filter). Same teacher procedure, same student, same rule; intervals are 95 % paired photo bootstraps within each run.

| figure | Q-2 | Q-2b |
|---|---:|---:|
| detected boxes | 6894 | 5757 |
| student population (floor, upright, measurable) | 3958 | 3478 |
| filled share of the population | 60 % (55–65) | 59 % (54–64) |
| τ | 0.71 | 0.73 |
| **student AUC (leave one photo out)** | 0.729 (0.69–0.76) | 0.710 (0.66–0.75) |
| **gain over crop width** | +0.276 (0.212 to 0.336) | +0.305 (0.232 to 0.377) |
| gain over crop width, best direction with hindsight | +0.204 (0.159 to 0.248) | +0.191 (0.127 to 0.238) |
| student AUC in sample (optimistic) | 0.733 (0.70–0.77) | 0.715 (0.67–0.75) |
| filled vs spine-found only | 0.864 (0.84–0.88) | 0.872 (0.85–0.90) |
| filled vs text-present only | 0.633 (0.60–0.67) | 0.610 (0.56–0.66) |
| ECE | 0.028 (0.02–0.05) | 0.037 (0.03–0.07) |
| Brier | 0.199 (0.19–0.21) | 0.206 (0.19–0.22) |
| yardstick AUC (one pilot fit, unchanged) | 0.803 (0.75–0.87) | 0.797 (0.73–0.86) |
| yardstick ECE | 0.281 (0.24–0.32) | 0.294 (0.25–0.34) |
| FILL_P | 0.7 (target not met) | 0.7 (target not met) |
| best precision (≥ 5 % filled) | 82.5 % | 75.6 % |
| at FILL_P: share predicted filled | 39 % (33–45) | 35 % (29–41) |
| **at FILL_P: precision of "filled"** | 78 % (73–82) | 75 % (68–81) |
| at FILL_P: recall | 51 % (45–55) | 45 % (39–49) |
| population: cut by a tile edge | 37.5 % | 2.1 % |
| population: partial (under 0.55 of band) | 15.6 % | 20.8 % |
| population: whole | 46.8 % | 77.1 % |
| cut boxes per photo, median (all detected) | 28.9 % | 3.5 % |
| whole only: n | 1854 | 2682 |
| whole only: student AUC | 0.723 (0.68–0.77) | 0.685 (0.63–0.74) |
| whole only: gain over crop width | +0.187 (0.122 to 0.248) | +0.338 (0.266 to 0.400) |
| whole only: Q-2's rule | NO-GO | NO-GO |
| **verdict by Q-2's rule** | NO-GO | NO-GO |

Whole-only and all-box results agree on the verdict: whole only NO-GO, all boxes NO-GO.

### Not pre-registered: τ held at Q-2's 0.71

The null procedure gives a different τ on the new boxes, which moves boxes between `text-present` and `text-read`. This diagnostic re-runs everything with τ fixed at Q-2's value, to separate the label shift from the box change. It is outside the go rule.

| figure | Q-2 | Q-2b at τ = 0.71 |
|---|---:|---:|
| detected boxes | 6894 | 5757 |
| student population (floor, upright, measurable) | 3958 | 3478 |
| filled share of the population | 60 % (55–65) | 60 % (55–65) |
| τ | 0.71 | 0.71 |
| **student AUC (leave one photo out)** | 0.729 (0.69–0.76) | 0.716 (0.67–0.76) |
| **gain over crop width** | +0.276 (0.212 to 0.336) | +0.310 (0.237 to 0.379) |
| gain over crop width, best direction with hindsight | +0.204 (0.159 to 0.248) | +0.197 (0.135 to 0.242) |
| student AUC in sample (optimistic) | 0.733 (0.70–0.77) | 0.721 (0.68–0.76) |
| filled vs spine-found only | 0.864 (0.84–0.88) | 0.872 (0.85–0.90) |
| filled vs text-present only | 0.633 (0.60–0.67) | 0.615 (0.57–0.66) |
| ECE | 0.028 (0.02–0.05) | 0.032 (0.03–0.06) |
| Brier | 0.199 (0.19–0.21) | 0.202 (0.19–0.22) |
| yardstick AUC (one pilot fit, unchanged) | 0.803 (0.75–0.87) | 0.810 (0.75–0.87) |
| yardstick ECE | 0.281 (0.24–0.32) | 0.292 (0.25–0.33) |
| FILL_P | 0.7 (target not met) | 0.7 (target not met) |
| best precision (≥ 5 % filled) | 82.5 % | 78.5 % |
| at FILL_P: share predicted filled | 39 % (33–45) | 39 % (33–45) |
| **at FILL_P: precision of "filled"** | 78 % (73–82) | 77 % (70–82) |
| at FILL_P: recall | 51 % (45–55) | 50 % (45–54) |
| population: cut by a tile edge | 37.5 % | 2.1 % |
| population: partial (under 0.55 of band) | 15.6 % | 20.8 % |
| population: whole | 46.8 % | 77.1 % |
| cut boxes per photo, median (all detected) | 28.9 % | 3.5 % |
| whole only: n | 1854 | 2682 |
| whole only: student AUC | 0.723 (0.68–0.77) | 0.693 (0.64–0.74) |
| whole only: gain over crop width | +0.187 (0.122 to 0.248) | +0.347 (0.277 to 0.407) |
| whole only: Q-2's rule | NO-GO | NO-GO |
| **verdict by Q-2's rule** | NO-GO | NO-GO |

Whole-only and all-box results agree on the verdict: whole only NO-GO, all boxes NO-GO.

## Teacher table: coverage rung per detected box (B2)

τ = 0.73 (string agreement), box-score floor = 0.225. Counts are machine agreement, not accuracy.

| set | group | n | spine-found | text-present | text-read | matched | confirmed |
|---|---|---:|---:|---:|---:|---:|---:|
| pilot-000 | all detected | 5757 | 1235 (21 %) | 1620 (28 %) | 1301 (23 %) | 875 (15 %) | 726 (13 %) |
| pilot-000 | below floor | 2248 | 673 (30 %) | 736 (33 %) | 384 (17 %) | 303 (13 %) | 152 (7 %) |
| pilot-000 | lying, at/above floor | 31 | 22 (71 %) | 5 (16 %) | 1 (3 %) | 3 (10 %) | 0 (0 %) |
| pilot-000 | **student population** | 3478 | 540 (16 %) | 879 (25 %) | 916 (26 %) | 569 (16 %) | 574 (17 %) |
| yardstick B2 | all detected | 1038 | 258 (25 %) | 94 (9 %) | 272 (26 %) | 148 (14 %) | 266 (26 %) |
| yardstick B2 | below floor | 264 | 166 (63 %) | 30 (11 %) | 40 (15 %) | 8 (3 %) | 20 (8 %) |
| yardstick B2 | lying, at/above floor | 17 | 10 (59 %) | 4 (24 %) | 0 (0 %) | 1 (6 %) | 2 (12 %) |
| yardstick B2 | **student population** | 757 | 82 (11 %) | 60 (8 %) | 232 (31 %) | 139 (18 %) | 244 (32 %) |

- pilot-000: 31 photos; filled share of the population 59 % (54–64); 0 boxes left out for an unmeasurable feature.
- yardstick B2: 40 photos; filled share of the population 81 % (76–85); 0 boxes left out for an unmeasurable feature; 22 accepted boxes name a work not in the photo's annotations (kept at `confirmed`: the teacher cannot see annotations).

### Setting τ: null pairing versus real agreement

Null pass: share of null pairs (one reader on a box, another reader on a different box of the same photo) at or above τ. Accepted pass: share of catalog-confirmed boxes whose readers' strings agree at τ. No-match pass: share of `no-catalog-match` boxes promoted to `text-read`.

| τ | pilot-000 null | accepted | no-match | yardstick B2 null | accepted | no-match |
|---:|---:|---:|---:|---:|---:|---:|
| 0.6 | 4 % | 95 % | 60 % | 11 % | 97 % | 85 % |
| 0.7 | 1 % | 85 % | 49 % | 6 % | 89 % | 77 % |
| **0.73** | 1 % | 81 % | 45 % | 5 % | 86 % | 74 % |
| 0.75 | 1 % | 78 % | 43 % | 5 % | 85 % | 73 % |
| 0.8 | 1 % | 72 % | 37 % | 3 % | 81 % | 68 % |
| 0.85 | 0 % | 67 % | 32 % | 2 % | 74 % | 60 % |
| 0.9 | 0 % | 60 % | 26 % | 2 % | 66 % | 54 % |
| 0.95 | 0 % | 50 % | 20 % | 1 % | 55 % | 47 % |
| 1 | 0 % | 41 % | 16 % | 1 % | 44 % | 40 % |

## Student: AUC, gain over the crop-width baseline, calibration

pilot-000 scores are leave-one-image-out; the yardstick is scored by one fit on all of pilot-000, unchanged. Intervals: paired photo bootstrap.

| model | pilot-000 AUC | Δ vs baseline | Δ vs student | ECE | Brier | yardstick B2 AUC | Δ vs baseline | Δ vs student | ECE | Brier |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline | 0.40 (0.37–0.44) | – | – | 0.067 (0.041–0.097) | 0.243 (0.235–0.254) | 0.43 (0.37–0.50) | – | – | 0.240 (0.192–0.282) | 0.209 (0.203–0.216) |
| student | 0.71 (0.66–0.75) | +0.305 (0.232 to 0.377) | – | 0.037 (0.031–0.067) | 0.206 (0.192–0.224) | 0.80 (0.73–0.86) | +0.365 (0.267 to 0.467) | – | 0.294 (0.252–0.338) | 0.201 (0.186–0.219) |
| student-logCropWidthPx | 0.71 (0.66–0.75) | +0.305 (0.232 to 0.377) | +0.000 (0.000 to 0.000) | 0.037 (0.031–0.067) | 0.206 (0.192–0.224) | 0.80 (0.73–0.86) | +0.365 (0.267 to 0.467) | +0.000 (0.000 to 0.000) | 0.294 (0.252–0.338) | 0.201 (0.186–0.219) |
| student-logDetail | 0.50 (0.47–0.53) | +0.095 (0.050 to 0.144) | -0.210 (-0.269 to -0.148) | 0.028 (0.012–0.065) | 0.242 (0.233–0.253) | 0.50 (0.42–0.57) | +0.066 (-0.030 to 0.145) | -0.298 (-0.411 to -0.204) | 0.210 (0.165–0.253) | 0.194 (0.186–0.204) |
| student-glareShare | 0.71 (0.66–0.75) | +0.305 (0.232 to 0.377) | +0.000 (0.000 to 0.000) | 0.037 (0.031–0.067) | 0.206 (0.192–0.224) | 0.80 (0.73–0.86) | +0.365 (0.267 to 0.467) | +0.000 (0.000 to 0.000) | 0.294 (0.252–0.338) | 0.201 (0.186–0.219) |
| student-lumaOffMid | 0.71 (0.66–0.75) | +0.305 (0.232 to 0.377) | +0.000 (0.000 to 0.000) | 0.037 (0.031–0.067) | 0.206 (0.192–0.224) | 0.80 (0.73–0.86) | +0.365 (0.267 to 0.467) | +0.000 (0.000 to 0.000) | 0.294 (0.252–0.338) | 0.201 (0.186–0.219) |
| student-tiltDeg | 0.70 (0.65–0.75) | +0.297 (0.223 to 0.370) | -0.008 (-0.014 to -0.002) | 0.029 (0.023–0.065) | 0.208 (0.194–0.226) | 0.79 (0.73–0.86) | +0.362 (0.259 to 0.469) | -0.003 (-0.010 to 0.004) | 0.311 (0.268–0.354) | 0.212 (0.197–0.230) |
| student+heightOffBand | 0.71 (0.66–0.75) | +0.304 (0.231 to 0.376) | -0.001 (-0.003 to 0.001) | 0.037 (0.030–0.065) | 0.206 (0.192–0.224) | 0.80 (0.74–0.86) | +0.369 (0.272 to 0.470) | +0.004 (-0.003 to 0.011) | 0.296 (0.254–0.341) | 0.204 (0.189–0.223) |
| student+topSeamOff | 0.72 (0.67–0.77) | +0.318 (0.242 to 0.390) | +0.012 (0.005 to 0.021) | 0.039 (0.028–0.065) | 0.202 (0.187–0.221) | 0.80 (0.74–0.86) | +0.368 (0.266 to 0.465) | +0.003 (-0.014 to 0.020) | 0.289 (0.250–0.332) | 0.200 (0.183–0.219) |
| student+geometry | 0.72 (0.67–0.77) | +0.317 (0.240 to 0.390) | +0.012 (0.004 to 0.021) | 0.038 (0.029–0.067) | 0.202 (0.187–0.221) | 0.81 (0.75–0.87) | +0.375 (0.279 to 0.470) | +0.011 (-0.004 to 0.025) | 0.295 (0.257–0.339) | 0.203 (0.186–0.225) |
| diag:signFree | 0.73 (0.69–0.77) | +0.330 (0.259 to 0.397) | +0.024 (0.011 to 0.035) | 0.032 (0.025–0.056) | 0.200 (0.185–0.217) | 0.80 (0.73–0.87) | +0.368 (0.282 to 0.459) | +0.003 (-0.022 to 0.032) | 0.440 (0.392–0.488) | 0.320 (0.293–0.352) |
| diag:student+viewElevation | 0.72 (0.68–0.76) | +0.317 (0.248 to 0.383) | +0.012 (-0.003 to 0.026) | 0.049 (0.038–0.072) | 0.201 (0.186–0.218) | 0.79 (0.73–0.86) | +0.362 (0.262 to 0.464) | -0.002 (-0.015 to 0.010) | 0.254 (0.219–0.297) | 0.178 (0.163–0.195) |
| diag:student+fragment | 0.71 (0.66–0.75) | +0.305 (0.232 to 0.377) | +0.000 (-0.002 to 0.002) | 0.036 (0.030–0.065) | 0.206 (0.192–0.224) | 0.79 (0.73–0.86) | +0.360 (0.264 to 0.464) | -0.004 (-0.010 to 0.002) | 0.301 (0.258–0.342) | 0.206 (0.192–0.224) |

- pilot-000: n = 3478 boxes in 31 photos, filled share 59 % (54–64).
- yardstick B2: n = 757 boxes in 40 photos, filled share 81 % (76–86).

Weights of the full pilot-000 fit, on standardised features (0 = dropped by the monotone rule). Folds dropping: of 31 leave-one-out fits, how many dropped the feature.

| model | logCropWidthPx | logDetail | glareShare | lumaOffMid | tiltDeg | heightOffBand | topSeamOff | topBelowCentre | cutByTile | heightOverBand | dropped (full fit) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| baseline | -0.04 |  |  |  |  |  |  |  |  |  | – |
| student | 0.00 (31/31) | 0.87 | 0.00 (31/31) | 0.00 (31/31) | -0.20 |  |  |  |  |  | logCropWidthPx, lumaOffMid, glareShare |
| student-logCropWidthPx |  | 0.87 | 0.00 (31/31) | 0.00 (31/31) | -0.20 |  |  |  |  |  | lumaOffMid, glareShare |
| student-logDetail | 0.00 (29/31) |  | 0.00 (31/31) | 0.00 (31/31) | -0.15 |  |  |  |  |  | glareShare, lumaOffMid, logCropWidthPx |
| student-glareShare | 0.00 (31/31) | 0.87 |  | 0.00 (31/31) | -0.20 |  |  |  |  |  | logCropWidthPx, lumaOffMid |
| student-lumaOffMid | 0.00 (31/31) | 0.87 | 0.00 (31/31) |  | -0.20 |  |  |  |  |  | logCropWidthPx, glareShare |
| student-tiltDeg | 0.00 (31/31) | 0.86 | 0.00 (31/31) | 0.00 (31/31) |  |  |  |  |  |  | logCropWidthPx, lumaOffMid, glareShare |
| student+heightOffBand | 0.00 (31/31) | 0.87 | 0.00 (31/31) | 0.00 (31/31) | -0.19 | -0.06 |  |  |  |  | logCropWidthPx, lumaOffMid, glareShare |
| student+topSeamOff | 0.00 (31/31) | 0.88 | 0.00 (31/31) | 0.00 (31/31) | -0.18 |  | -0.30 |  |  |  | logCropWidthPx, lumaOffMid, glareShare |
| student+geometry | 0.00 (31/31) | 0.88 | 0.00 (31/31) | 0.00 (31/31) | -0.17 | -0.09 | -0.31 |  |  |  | logCropWidthPx, lumaOffMid, glareShare |
| diag:signFree | -0.41 | 1.06 | 0.01 | 0.13 | -0.15 |  |  |  |  |  | – |
| diag:student+viewElevation | 0.00 (31/31) | 0.87 | 0.00 (31/31) | 0.00 (31/31) | -0.16 |  |  | -0.33 |  |  | logCropWidthPx, lumaOffMid, glareShare |
| diag:student+fragment | 0.00 (31/31) | 0.87 | 0.00 (31/31) | 0.00 (31/31) | -0.20 |  |  |  | -0.08 | 0.00 (31/31) | logCropWidthPx, lumaOffMid, glareShare, heightOverBand |

### Reliability (student; 10 equal-width bins of the predicted score)

| bin | pilot-000 n | mean score | measured filled | yardstick B2 n | mean score | measured filled |
|---|---:|---:|---:|---:|---:|---:|
| 0.0–0.1 | 17 | 0.07 | 0.00 | 20 | 0.07 | 0.00 |
| 0.1–0.2 | 105 | 0.15 | 0.13 | 38 | 0.14 | 0.26 |
| 0.2–0.3 | 206 | 0.26 | 0.18 | 54 | 0.26 | 0.56 |
| 0.3–0.4 | 301 | 0.35 | 0.34 | 60 | 0.36 | 0.78 |
| 0.4–0.5 | 417 | 0.45 | 0.43 | 104 | 0.45 | 0.83 |
| 0.5–0.6 | 499 | 0.55 | 0.64 | 194 | 0.55 | 0.90 |
| 0.6–0.7 | 712 | 0.65 | 0.68 | 177 | 0.65 | 0.94 |
| 0.7–0.8 | 796 | 0.75 | 0.75 | 94 | 0.74 | 0.91 |
| 0.8–0.9 | 416 | 0.84 | 0.76 | 16 | 0.83 | 0.94 |
| 0.9–1.0 | 9 | 0.91 | 0.67 | 0 | – | – |

## Go rule

Student AUC on pilot-000 0.71 (0.66–0.75) (rule: ≥ 0.75); gain over crop width +0.305 (0.232 to 0.377) (rule: interval excludes 0). **NO-GO** on the predicted fill.

Unrounded: student 0.710; sign-free diagnostic 0.734.

Robustness (paired photo bootstrap). Oracle width: crop width ranked in the better direction with hindsight, no folds. Against each negative: filled boxes versus `spine-found` only, and versus `text-present` only. In-sample: the full pilot-000 fit scored on its own training rows (optimistic).

| set | oracle width AUC | student − oracle width | student vs spine-found | student vs text-present | student in-sample |
|---|---:|---:|---:|---:|---:|
| pilot-000 | 0.52 (0.50–0.55) | +0.191 (0.127 to 0.238) | 0.87 (0.85–0.90) | 0.61 (0.56–0.66) | 0.72 (0.67–0.75) |
| yardstick B2 | 0.57 (0.51–0.63) | +0.229 (0.160 to 0.298) | 0.94 (0.90–0.97) | 0.61 (0.51–0.72) | 0.80 (0.74–0.85) |

Diagnostic, not the go rule: the same five features with every direction learned give 0.73 (0.69–0.77), gain +0.330 (0.259 to 0.397) (would not pass).

## Operating point (FILL_P)

No score reaches the precision target on pilot-000 (best 76 % where at least 5 % are filled). FILL_P = **0.7**, Q-0's starting value, proposed unchanged.

| set | filled share | precision (measured ≥ text-read) | recall |
|---|---:|---:|---:|
| pilot-000 | 35 % (29–41) | 75 % (68–81) | 45 % (39–49) |
| yardstick B2 | 15 % (11–19) | 92 % (86–98) | 16 % (12–21) |

| score ≥ | pilot-000 filled | precision | recall | yardstick B2 filled | precision | recall |
|---:|---:|---:|---:|---:|---:|---:|
| 0.30 | 91 % | 64 % | 97 % | 85 % | 89 % | 94 % |
| 0.35 | 86 % | 65 % | 95 % | 82 % | 90 % | 91 % |
| 0.40 | 82 % | 67 % | 93 % | 77 % | 90 % | 86 % |
| 0.45 | 76 % | 69 % | 88 % | 70 % | 91 % | 78 % |
| 0.50 | 70 % | 71 % | 84 % | 64 % | 92 % | 72 % |
| 0.55 | 63 % | 72 % | 76 % | 53 % | 93 % | 61 % |
| 0.60 | 56 % | 73 % | 68 % | 38 % | 93 % | 44 % |
| 0.65 | 46 % | 74 % | 58 % | 27 % | 94 % | 32 % |
| 0.70 | 35 % | 75 % | 45 % | 15 % | 92 % | 16 % |
| 0.75 | 24 % | 76 % | 30 % | 7 % | 93 % | 8 % |
| 0.80 | 12 % | 76 % | 16 % | 2 % | 94 % | 2 % |
| 0.85 | 4 % | 72 % | 5 % | 0 % | 100 % | 0 % |
| 0.90 | 0 % | 67 % | 0 % | 0 % | – | 0 % |
| 0.95 | 0 % | – | 0 % | 0 % | – | 0 % |

## Sensitivity: box-score floor, lying boxes, detector fragments

| population | pilot-000 n | student AUC | baseline AUC | gain | filled | yardstick B2 n | student AUC | baseline AUC | gain | filled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| noFloor | 5684 | 0.73 (0.69–0.76) | 0.34 (0.30–0.38) | +0.389 (0.322 to 0.447) | 51 % (45–57) | 990 | 0.86 (0.81–0.90) | 0.65 (0.59–0.70) | +0.209 (0.151 to 0.265) | 69 % (61–75) |
| floor0.20 | 4335 | 0.71 (0.67–0.75) | 0.38 (0.33–0.42) | +0.338 (0.253 to 0.410) | 56 % (50–62) | 822 | 0.82 (0.77–0.87) | 0.42 (0.36–0.48) | +0.399 (0.311 to 0.489) | 77 % (71–82) |
| floor0.225 | 3478 | 0.71 (0.66–0.75) | 0.40 (0.36–0.44) | +0.305 (0.225 to 0.378) | 59 % (54–64) | 757 | 0.80 (0.74–0.86) | 0.43 (0.37–0.50) | +0.365 (0.272 to 0.462) | 81 % (76–86) |
| floor0.25 | 2598 | 0.69 (0.63–0.74) | 0.47 (0.44–0.51) | +0.213 (0.133 to 0.292) | 64 % (58–69) | 679 | 0.78 (0.72–0.86) | 0.46 (0.39–0.54) | +0.320 (0.210 to 0.432) | 84 % (80–88) |
| floor0.30 | 1156 | 0.64 (0.54–0.73) | 0.53 (0.47–0.58) | +0.111 (0.009 to 0.228) | 71 % (65–77) | 477 | 0.71 (0.58–0.85) | 0.46 (0.36–0.59) | +0.248 (0.040 to 0.433) | 91 % (87–94) |
| floor0.225+lying | 3509 | 0.71 (0.66–0.75) | 0.41 (0.37–0.45) | +0.299 (0.219 to 0.370) | 59 % (53–64) | 774 | 0.78 (0.71–0.85) | 0.44 (0.38–0.51) | +0.335 (0.242 to 0.433) | 80 % (75–84) |
| floor0.225, whole only (no cut or partial) | 2682 | 0.69 (0.63–0.74) | 0.35 (0.32–0.38) | +0.338 (0.266 to 0.400) | 60 % (55–65) | 622 | 0.72 (0.63–0.82) | 0.44 (0.37–0.52) | +0.285 (0.159 to 0.418) | 86 % (81–90) |

## Detector fragments

Cut: the detector flagged the box as cut by a detector tile edge. Partial: not cut, but shorter than 0.55 of its shelf band's height. Per-photo medians over all detected boxes (partial: over upright boxes). The student columns score the go-rule student on each kind; +fragment adds the cut flag and height over band (a separate row, outside the go rule).

| set | kind | n | share of population | filled | student AUC | student+fragment AUC |
|---|---|---:|---:|---:|---:|---:|
| pilot-000 | whole | 2682 | 77 % | 60 % (55–65) | 0.69 (0.64–0.74) | 0.69 (0.64–0.74) |
| pilot-000 | cut | 74 | 2 % | 47 % (33–59) | 0.74 (0.62–0.85) | 0.71 (0.59–0.83) |
| pilot-000 | partial | 722 | 21 % | 57 % (41–68) | 0.78 (0.74–0.82) | 0.78 (0.74–0.82) |
| yardstick B2 | whole | 622 | 82 % | 86 % (81–90) | 0.72 (0.63–0.83) | 0.72 (0.63–0.83) |
| yardstick B2 | cut | 59 | 8 % | 81 % (72–91) | 0.86 (0.64–0.97) | 0.86 (0.64–0.97) |
| yardstick B2 | partial | 76 | 10 % | 43 % (27–58) | 0.91 (0.83–0.97) | 0.91 (0.83–0.97) |

- pilot-000: per photo, median 4 % of boxes cut by a tile edge and 16 % of upright boxes partial.
- yardstick B2: per photo, median 0 % of boxes cut by a tile edge and 11 % of upright boxes partial.

## Owner hypothesis: top edges at frame edges and in oblique views

Single-feature separation of filled from not filled (AUC > 0.5: larger values go with filled).

| feature | pilot-000 | yardstick B2 |
|---|---:|---:|
| heightOffBand | 0.47 (0.44–0.51) | 0.37 (0.31–0.43) |
| heightOffBandSigned | 0.53 (0.50–0.56) | 0.63 (0.56–0.72) |
| topSeamOff | 0.40 (0.37–0.44) | 0.45 (0.41–0.49) |
| topSeamSigned | 0.45 (0.41–0.47) | 0.48 (0.42–0.56) |
| topY | 0.42 (0.38–0.45) | 0.41 (0.32–0.50) |

Top-seam class over all detected boxes: pilot-000 clean 46 %, overshoot 37 %, cut 16 %, none 2 %; yardstick B2 clean 51 %, overshoot 32 %, cut 16 %, none 0 %.

Breakdown by frame position and by whether the camera looks down onto the top (student population). Filled: teacher share ≥ text-read. Top classes: share of boxes and their filled share. ΔAUC: student+geometry minus student, within the cell.

**pilot-000**

| cell | n | photos | filled | clean: share, filled | overshoot: share, filled | cut: share, filled | student AUC | +geometry AUC | ΔAUC |
|---|---:|---:|---:|---|---|---|---:|---:|---:|
| all | 3478 | 31 | 59 % (53–64) | 50 %, 66 % (59–72) | 35 %, 52 % (46–58) | 13 %, 54 % (47–60) | 0.71 (0.66–0.75) | 0.72 (0.67–0.77) | +0.012 (0.004 to 0.021) |
| centre | 2061 | 31 | 70 % (65–75) | 58 %, 72 % (67–78) | 29 %, 65 % (59–72) | 13 %, 70 % (59–78) | 0.66 (0.60–0.72) | 0.67 (0.61–0.73) | +0.007 (-0.003 to 0.018) |
| edge | 1417 | 31 | 43 % (37–49) | 39 %, 53 % (43–63) | 44 %, 39 % (33–45) | 14 %, 35 % (28–41) | 0.71 (0.66–0.75) | 0.72 (0.67–0.76) | +0.009 (-0.004 to 0.024) |
| topNotInView | 2392 | 31 | 67 % (61–73) | 62 %, 71 % (64–77) | 28 %, 58 % (50–65) | 8 %, 79 % (69–85) | 0.68 (0.61–0.73) | 0.69 (0.63–0.75) | +0.018 (0.007 to 0.030) |
| topInView | 1086 | 29 | 41 % (34–47) | 23 %, 38 % (29–48) | 51 %, 45 % (38–51) | 25 %, 37 % (27–44) | 0.72 (0.67–0.77) | 0.70 (0.64–0.75) | -0.027 (-0.042 to -0.012) |
| centreTopNotInView | 1584 | 31 | 75 % (70–79) | 69 %, 74 % (68–80) | 21 %, 74 % (66–81) | 10 %, 81 % (72–88) | 0.64 (0.57–0.72) | 0.65 (0.58–0.72) | +0.004 (-0.005 to 0.016) |
| centreTopInView | 477 | 27 | 55 % (45–62) | 21 %, 54 % (43–63) | 58 %, 56 % (46–63) | 21 %, 52 % (34–67) | 0.66 (0.57–0.72) | 0.64 (0.55–0.71) | -0.019 (-0.038 to 0.002) |
| edgeTopNotInView | 808 | 31 | 53 % (45–60) | 49 %, 62 % (51–72) | 43 %, 43 % (36–50) | 4 %, 69 % (48–86) | 0.67 (0.59–0.72) | 0.70 (0.63–0.75) | +0.030 (0.013 to 0.050) |
| edgeTopInView | 609 | 29 | 31 % (24–37) | 25 %, 28 % (19–39) | 46 %, 34 % (25–43) | 28 %, 27 % (20–33) | 0.74 (0.66–0.79) | 0.70 (0.63–0.76) | -0.040 (-0.061 to -0.017) |

**yardstick B2**

| cell | n | photos | filled | clean: share, filled | overshoot: share, filled | cut: share, filled | student AUC | +geometry AUC | ΔAUC |
|---|---:|---:|---:|---|---|---|---:|---:|---:|
| all | 757 | 40 | 81 % (77–86) | 50 %, 84 % (81–88) | 34 %, 79 % (72–87) | 16 %, 77 % (63–88) | 0.80 (0.74–0.86) | 0.81 (0.75–0.87) | +0.011 (-0.005 to 0.023) |
| centre | 614 | 40 | 86 % (81–90) | 49 %, 89 % (85–92) | 35 %, 85 % (79–91) | 16 %, 80 % (67–90) | 0.77 (0.67–0.86) | 0.78 (0.69–0.86) | +0.013 (-0.005 to 0.031) |
| edge | 143 | 37 | 61 % (50–73) | 53 %, 67 % (57–79) | 30 %, 49 % (32–73) | 15 %, 64 % (41–88) | 0.81 (0.74–0.90) | 0.83 (0.76–0.91) | +0.022 (-0.010 to 0.045) |
| topNotInView | 727 | 40 | 83 % (79–86) | 51 %, 85 % (82–89) | 33 %, 81 % (73–88) | 16 %, 80 % (68–91) | 0.78 (0.71–0.86) | 0.80 (0.73–0.87) | +0.012 (-0.005 to 0.030) |
| topInView | 30 | 6 | 43 % (26–78) | 27 %, 50 % (13–86) | 53 %, 50 % (0–75) | 20 %, 17 % (0–100) | 0.91 (0.76–1.00) | 0.89 (0.63–1.00) | -0.018 (-0.150 to 0.023) |
| centreTopNotInView | 597 | 40 | 87 % (83–91) | 50 %, 89 % (85–93) | 34 %, 86 % (80–92) | 16 %, 81 % (69–92) | 0.75 (0.64–0.85) | 0.77 (0.66–0.86) | +0.015 (-0.005 to 0.035) |
| centreTopInView | 17 | 5 | 59 % (40–100) | 18 %, 67 % (0–100) | 71 %, 67 % (56–100) | 12 %, 0 % (0–0) | 1.00 (1.00–1.00) | 1.00 (1.00–1.00) | +0.000 (0.000 to 0.000) |
| edgeTopNotInView | 130 | 37 | 65 % (55–73) | 55 %, 69 % (59–79) | 30 %, 54 % (33–78) | 14 %, 72 % (50–93) | 0.82 (0.74–0.90) | 0.84 (0.76–0.91) | +0.023 (-0.011 to 0.049) |
| edgeTopInView | 13 | 3 | 23 % (0–60) | 38 %, 40 % (0–67) | 31 %, 0 % (0–0) | 31 %, 25 % (0–100) | 0.70 (0.50–0.75) | 0.70 (0.50–0.75) | +0.000 (0.000 to 0.000) |

