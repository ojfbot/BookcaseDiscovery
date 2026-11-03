# Q1: first failure-pattern pass (capture quality)

Run 2026-11-02, card Q-1. **Question:** what in the image separates spines the pipeline read and confirmed from
spines it detected but could not read or match, and where in a photo do failures cluster? This is the first
measurement for a coverage overlay (regions fill in when captured well enough); Q-0 owns the coverage unit and the
outcome ladder, so the outcome classes here are F-0's, kept simple to remap.

**Inputs.** F-0's cached stage outputs, no new model runs: B2 boxes, three readers and decisions for `pilot-000`
(31 real-use photos, 6,894 boxes; machine agreement only, never accuracy: INV-17, OC35), and B1–B4 for 40 Library
Dataset images (PROXY; the yardstick has per-image title truth, so an accepted label is `confirmed` or
`rejected/wrong`). Features come from the working-copy pixels inside each polygon (`helpers/coverage/features.py`):
size, rotation, Laplacian detail, exposure, glare, colour, position in the frame and in the machine shelf band, box
scores. **Scope:** detected boxes only. A book never detected cannot be located (the Library Dataset releases no
geometry, and the Zhong/Yang box set returned HTTP 504 on three tries), so this is about failures *after* detection.
Every interval is a 95 % cluster bootstrap over photos (1,000 draws), because spines in one photo share its light,
focus and distance. No training on the yardstick (H-0 §4.3): the one fitted model is fit on pilot-000 and only
scored on the yardstick.

## Findings

1. **Crisp detail inside the box is the strongest image signal, and it transfers.** Laplacian variance of the
   box, resampled to a 32 px short side (`lapVarNorm`), separates confirmed from no-text at AUC 0.90 (0.88–0.91) on
   pilot-000 and 0.88–0.98 on all four yardstick arms. Below the pilot cut (≈ 1,030), text is read on 45 % of boxes
   against 87 % above; the same cut on yardstick B2 gives 46 % against 94 %. Native-pixel `lapVar` is as strong on
   the pilot but its scale does not carry across cameras (the pilot cut puts 89 % of yardstick boxes below it), so
   the normalised form is the candidate signal. **Caveat:** inside a box, printed text *is* the detail. The
   native-to-half-scale energy ratio (`blurRatio`) is *higher* on no-text boxes (AUC 0.18, i.e. 0.82 the other way),
   which is what noise over a plain surface looks like, not mildly soft text. So the no-text pile is mostly boxes
   with nothing legible above noise: plain spines, non-book boxes, or text blurred past recognition. This pass
   cannot split those three; next experiment 2 does.
2. **Failures cluster at the frame's edges and bottom, and that survives the obvious confounds.** No-text share
   rises from 10 % in the centre to 46 % in the outer radial octile (pilot) and from 13 % to 55 % (yardstick B2).
   Restricted to in-frame, upright boxes, distance from centre still separates at AUC 0.71 (0.66–0.76) pilot and
   0.73 (0.66–0.80) yardstick. Normalised per photo, the pilot's bottom row of cells is 23–34 points worse than its
   photo on no-text, and the central cells of the middle rows 13–19 points better; the yardstick strips fail at their top and bottom
   edges. Edge distortion, steeper viewing angle and the floor-level shelf all fit; this pass cannot separate them
   (next experiment 4).
3. **Spines lying flat almost never confirm, and the cause is the reader crop, not the photo.** 407 pilot boxes have
   a horizontal long axis: 1 % confirmed (0–3) and 56 % no-text, against 12 % and 21 % for in-frame upright boxes;
   the yardstick agrees (2 %, 77 %). F-0 keeps each crop in image orientation and reads it turned 90° and 270° only,
   so a lying spine reaches the readers with its text vertical. Cheap to fix (next experiment 1). Boxes partly out
   of frame (679) also fail: 1 % confirmed.
4. **Pixels per spine is not the limit at 46 MP.** On pilot-000 the short side runs 25–580 px (median ≈ 140) and
   barely separates confirmed from no-text (AUC 0.53; text read 70 % below 92 px vs 76 % above). On the yardstick
   it matters more (AUC 0.63–0.93 across arms), and its smallest octile (< 140 px) is the worst. A whole-case 12 MP
   shot would halve every short side and put most pilot spines under 92 px, so resolution becomes the hypothesis to
   test there, not here.
5. **The biggest pilot bucket is a matching problem the image cannot explain.** Half of pilot boxes (3,435) are
   `no-catalog-match`. Against confirmed, no capture feature reaches AUC 0.65 (detail 0.61, among boxes PP-OCR read:
   0.61 and lower). The pilot catalog is ISFDB (SF only) and the shelves are not, so much of this bucket is books
   not in the catalog, not bad capture. The coverage overlay should not promise to turn these green.
6. **Exposure and colour matter little per spine.** RMS contrast and the 5–95 % range help modestly (AUC 0.62–0.76);
   glare as clipped highlights goes the *other* way on pilot (boxes with some highlight are read more, AUC 0.72),
   because bright lettering and gloss come with print; hue and saturation are flat. At photo level, the pilot's
   per-photo confirmed share falls with median brightness (Spearman −0.75, −0.86 to −0.51, 31 photos), which is
   worth a look but may be which shelves were shot brightly, not exposure.
7. **A five-feature description is enough to draw a first overlay.** Logistic regression on log short side, log
   detail, contrast, glare and radial position, fit on 21 pilot photos, gives held-out AUC 0.89 (0.79–0.93) on the
   other 10 and 0.88 (0.74–0.96) on yardstick B2 without refitting; detail carries most weight (+2.29 per SD), then
   size (+0.95) and position (−0.52). The depth-3 tree splits almost only on detail, then position and size, and
   transfers worse (0.69). Description only: no tuning, one split, one camera.

## Candidate thresholds for the first cheap coverage signal (hypotheses)

Each cut was picked on pilot-000 (decile that best splits the text-read share) and checked on yardstick B2. They
are hypotheses to re-test on a fresh session, not settings.

- **H1 detail:** box detail at 32 px short side `lapVarNorm` < ≈ 1,000 → text read ≈ 45 % (pilot 40–51, yard
  38–55) vs ≈ 90 % above (pilot 84–90, yard 88–98). Best single signal; blank-vs-blur unresolved.
- **H2 position:** radial distance > 0.56 of the half-diagonal → text read 62 % (55–69) vs 83 % (78–88) pilot;
  54 % (44–63) vs 81 % (74–88) yard. Survives restricting to in-frame upright boxes.
- **H3 box confidence:** B2 box score < 0.225 → text read 64 % (56–70) vs 82 % (77–86) pilot; 40 % (31–49) vs
  88 % (84–91) yard. Free at detection time.
- **H4 contrast:** RMS contrast < 37 grey levels → text read 54 % (49–59) vs 77 % (71–82) pilot; 48 % (39–59) vs
  84 % (78–89) yard.
- **H5 geometry:** box lying flat, or any part outside the frame → confirmed ≈ 1 % (pilot). The first is a pipeline
  fix; the second is a "this spine is not captured yet" signal as it stands.
- **H6 resolution (untested here):** short side < ≈ 92 px is a weak penalty at 46 MP (text read 70 % vs 76 %);
  expected to bind for 12 MP whole-case photos.

## What to try next (ranked by expected information per hour)

1. **Rotation from the box's long axis** (≈ 1 h). Read the 407 + 66 lying boxes with 0°/180° added and re-score from
   the cached crops. Directly tests finding 3; if confirmed share moves toward the upright 12 %, it is a pipeline
   fix in F-0's reader request, worth about 6 % of pilot boxes.
2. **Look at 100 no-text boxes** (≈ 45 min, stratified by detail octile, from the private renders). Sort into plain
   spine / not a book / blurred text / legible. Decides whether the top signal measures capture (blur) or detection
   (blank boxes), which changes what the overlay should ask the user to do (hold still vs nothing to read here).
3. **Same shelf, centre vs edge, near vs far** (≈ 30 min owner shooting + 30 min run). Four shots of one shelf:
   in the centre and at the frame edge, at 1× and 0.5× distance, plus one 12 MP whole-case shot. A controlled test
   of H2 against H6 and of the edge effect against lens distortion.
4. **Split `no-catalog-match`** (≈ 1 h). Sample 100 pilot boxes and check whether the book is in ISFDB at all.
   Sets the ceiling a capture overlay can claim on this shelf and whether matching, not capture, is the next lever.
5. **Box recall on Zhong/Yang** when figshare stops returning 504 (≈ 2 h). The only way to see the failures this
   pass cannot: spines never detected, the holes in a coverage map.

## Private outputs

The per-spine table (`table/`), modelled scores (`scores/`), features and the overlay renders live under the data
root's `private/q1/`, never in the repo. `renders/pilot-000/index.html` and `renders/yardstick-library-b2/index.html`
show, per photo: every box filled by outcome; every box filled by the model's readability (red 0 → green 1); and a
coarse grid filled by mean modelled readability with undetected cells hatched, a first glimpse of the overlay.
Regenerate with `node src/eval/q1-cli.ts features`, `analyse`, `render` (`uv sync` in `helpers/coverage` first).

<!-- Tables below are generated by `node src/eval/q1-cli.ts analyse`; edit above this line only. -->

## Outcomes per detected spine

| set | photos | detected | confirmed | unknown:no-text | unknown:no-catalog-match | unknown:single-reader | unknown:readers-disagree | rejected/wrong |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| pilot-000 | 31 | 6894 | 718 (10 %) | 1738 (25 %) | 3435 (50 %) | 923 (13 %) | 80 (1 %) | 0 (0 %) |
| yard b1 | 40 | 1504 | 265 (18 %) | 756 (50 %) | 341 (23 %) | 118 (8 %) | 0 (0 %) | 24 (2 %) |
| yard b2 | 40 | 1132 | 247 (22 %) | 290 (26 %) | 412 (36 %) | 160 (14 %) | 1 (0 %) | 22 (2 %) |
| yard b3 | 40 | 4389 | 328 (7 %) | 2641 (60 %) | 1211 (28 %) | 171 (4 %) | 1 (0 %) | 37 (1 %) |
| yard b4 | 40 | 1529 | 236 (15 %) | 730 (48 %) | 399 (26 %) | 139 (9 %) | 1 (0 %) | 24 (2 %) |

## Single-feature separation: confirmed vs no-text (AUC, 95 % photo-bootstrap interval)

AUC > 0.5: larger values go with confirmed. Sorted by pilot-000 separation |AUC − 0.5|. Reader-side features (PP-OCR) are part of the outcome and shown only for scale.

| family | feature | pilot-000 | yard b1 | yard b2 | yard b3 | yard b4 |
|---|---|---:|---:|---:|---:|---:|
| readerSide | ppocrConf | 0.99 (0.99–1.00) | 1.00 (1.00–1.00) | 1.00 (1.00–1.00) | 1.00 (0.99–1.00) | 1.00 (1.00–1.00) |
| readerSide | ppocrAny | 0.97 (0.97–0.98) | 1.00 (1.00–1.00) | 0.99 (0.98–1.00) | 0.99 (0.99–1.00) | 1.00 (0.99–1.00) |
| sharpness | lapVarNorm | 0.90 (0.88–0.91) | 0.98 (0.96–0.99) | 0.88 (0.79–0.96) | 0.95 (0.92–0.97) | 0.95 (0.92–0.98) |
| sharpness | lapVar | 0.88 (0.83–0.91) | 0.70 (0.45–0.89) | 0.83 (0.69–0.93) | 0.67 (0.50–0.81) | 0.63 (0.36–0.92) |
| sharpness | blurRatio | 0.18 (0.14–0.22) | 0.23 (0.05–0.49) | 0.14 (0.04–0.28) | 0.24 (0.10–0.42) | 0.32 (0.05–0.59) |
| sharpness | lapVarRel | 0.78 (0.74–0.82) | 0.71 (0.65–0.77) | 0.80 (0.69–0.90) | 0.74 (0.70–0.78) | 0.77 (0.71–0.85) |
| sharpness | imgLapVar | 0.77 (0.69–0.83) | 0.29 (0.19–0.44) | 0.43 (0.29–0.57) | 0.37 (0.27–0.49) | 0.32 (0.18–0.50) |
| sharpness | edgeDensity | 0.76 (0.73–0.80) | 0.83 (0.65–0.96) | 0.76 (0.66–0.85) | 0.83 (0.73–0.90) | 0.78 (0.65–0.92) |
| detector | boxScore | 0.76 (0.72–0.79) | 0.98 (0.96–0.99) | 0.89 (0.84–0.93) | 0.86 (0.82–0.90) | 0.95 (0.92–0.98) |
| position | radial | 0.26 (0.22–0.31) | 0.35 (0.21–0.50) | 0.26 (0.18–0.35) | 0.33 (0.22–0.45) | 0.37 (0.20–0.52) |
| position | edgeDist | 0.73 (0.68–0.78) | 0.64 (0.50–0.78) | 0.73 (0.65–0.81) | 0.65 (0.54–0.75) | 0.62 (0.48–0.78) |
| detector | maskScore | 0.73 (0.69–0.75) | 0.98 (0.96–0.99) | 0.73 (0.66–0.78) | 0.76 (0.71–0.81) | 0.87 (0.79–0.92) |
| exposure | highlightFrac | 0.72 (0.69–0.76) | 0.48 (0.42–0.55) | 0.53 (0.49–0.58) | 0.49 (0.45–0.54) | 0.48 (0.41–0.58) |
| position | cy | 0.32 (0.28–0.36) | 0.80 (0.69–0.88) | 0.61 (0.45–0.74) | 0.69 (0.59–0.80) | 0.66 (0.51–0.83) |
| resolution | longPx | 0.68 (0.59–0.75) | 0.97 (0.93–0.98) | 0.91 (0.85–0.94) | 0.92 (0.89–0.95) | 0.96 (0.91–0.98) |
| exposure | p95p5 | 0.66 (0.63–0.69) | 0.69 (0.55–0.82) | 0.74 (0.66–0.80) | 0.68 (0.59–0.76) | 0.68 (0.56–0.82) |
| shelfBand | bandSpineCount | 0.63 (0.53–0.72) | 0.49 (0.37–0.63) | 0.58 (0.46–0.71) | 0.40 (0.29–0.52) | 0.44 (0.36–0.54) |
| exposure | rmsContrast | 0.62 (0.60–0.65) | 0.68 (0.55–0.81) | 0.76 (0.69–0.82) | 0.68 (0.59–0.76) | 0.69 (0.57–0.82) |
| rotation | absLongAxisDeg | 0.38 (0.34–0.43) | 0.55 (0.46–0.63) | 0.39 (0.32–0.47) | 0.41 (0.35–0.46) | 0.48 (0.38–0.55) |
| resolution | aspect | 0.61 (0.56–0.65) | 0.80 (0.72–0.86) | 0.76 (0.70–0.81) | 0.73 (0.67–0.78) | 0.77 (0.68–0.84) |
| position | outFrac | 0.42 (0.39–0.44) | 0.53 (0.47–0.58) | 0.49 (0.46–0.51) | 0.52 (0.48–0.56) | 0.53 (0.49–0.57) |
| shelfBand | bandEnd | 0.58 (0.54–0.61) | 0.60 (0.55–0.67) | 0.64 (0.57–0.71) | 0.59 (0.55–0.64) | 0.62 (0.57–0.70) |
| exposure | shadowFrac | 0.57 (0.53–0.61) | 0.66 (0.59–0.72) | 0.64 (0.55–0.72) | 0.60 (0.55–0.65) | 0.69 (0.62–0.75) |
| rotation | lying | 0.44 (0.42–0.45) | 0.48 (0.46–0.49) | 0.41 (0.38–0.45) | 0.41 (0.38–0.43) | 0.47 (0.45–0.49) |
| rotation | offAxisDeg | 0.44 (0.40–0.49) | 0.56 (0.47–0.64) | 0.49 (0.41–0.58) | 0.48 (0.43–0.52) | 0.50 (0.41–0.57) |
| colour | saturation | 0.45 (0.41–0.48) | 0.44 (0.35–0.52) | 0.44 (0.38–0.51) | 0.44 (0.37–0.50) | 0.46 (0.37–0.53) |
| colour | value | 0.53 (0.49–0.57) | 0.56 (0.45–0.69) | 0.55 (0.46–0.63) | 0.61 (0.51–0.70) | 0.50 (0.40–0.66) |
| resolution | shortPx | 0.53 (0.47–0.59) | 0.93 (0.88–0.96) | 0.63 (0.55–0.70) | 0.85 (0.80–0.90) | 0.87 (0.77–0.93) |
| exposure | mean | 0.53 (0.48–0.57) | 0.55 (0.44–0.70) | 0.54 (0.45–0.61) | 0.59 (0.49–0.68) | 0.50 (0.40–0.66) |
| position | cx | 0.53 (0.47–0.57) | 0.50 (0.40–0.61) | 0.44 (0.35–0.55) | 0.50 (0.44–0.56) | 0.42 (0.33–0.53) |
| shelfBand | bandAcross | 0.52 (0.49–0.55) | 0.59 (0.51–0.69) | 0.58 (0.48–0.67) | 0.62 (0.56–0.68) | 0.54 (0.45–0.64) |
| shelfBand | inBand | 0.51 (0.51–0.52) | 0.51 (0.51–0.52) | 0.52 (0.51–0.53) | 0.51 (0.50–0.51) | 0.51 (0.50–0.51) |
| resolution | megapixels | 0.49 (0.36–0.62) | 0.31 (0.17–0.49) | 0.45 (0.32–0.59) | 0.37 (0.26–0.48) | 0.34 (0.19–0.53) |

## Single-feature separation: confirmed vs no-catalog-match, and confirmed vs everything else

| feature | pilot-000 vs no-match | yard b2 vs no-match | pilot-000 vs rest | yard b2 vs rest |
|---|---:|---:|---:|---:|
| ppocrConf | 0.72 (0.67–0.77) | 0.58 (0.54–0.63) | 0.79 (0.75–0.83) | 0.71 (0.67–0.76) |
| boxScore | 0.64 (0.58–0.69) | 0.60 (0.52–0.66) | 0.67 (0.63–0.71) | 0.66 (0.61–0.71) |
| imgLapVar | 0.63 (0.52–0.71) | 0.39 (0.28–0.51) | 0.66 (0.57–0.73) | 0.42 (0.32–0.52) |
| lapVarNorm | 0.62 (0.58–0.66) | 0.49 (0.42–0.55) | 0.70 (0.66–0.73) | 0.59 (0.54–0.65) |
| lapVar | 0.61 (0.54–0.68) | 0.53 (0.46–0.60) | 0.68 (0.63–0.73) | 0.64 (0.58–0.69) |
| maskScore | 0.61 (0.57–0.65) | 0.62 (0.56–0.66) | 0.64 (0.61–0.67) | 0.63 (0.59–0.68) |
| cy | 0.41 (0.37–0.46) | 0.56 (0.49–0.63) | 0.39 (0.35–0.43) | 0.57 (0.51–0.64) |
| blurRatio | 0.41 (0.35–0.48) | 0.47 (0.40–0.53) | 0.36 (0.31–0.41) | 0.36 (0.29–0.42) |
| edgeDensity | 0.58 (0.54–0.62) | 0.39 (0.32–0.46) | 0.62 (0.59–0.66) | 0.49 (0.43–0.55) |
| radial | 0.42 (0.39–0.46) | 0.40 (0.35–0.47) | 0.38 (0.34–0.42) | 0.37 (0.32–0.42) |
| lapVarRel | 0.58 (0.54–0.61) | 0.51 (0.45–0.57) | 0.63 (0.60–0.66) | 0.62 (0.57–0.66) |
| megapixels | 0.43 (0.32–0.53) | 0.41 (0.31–0.51) | 0.46 (0.36–0.55) | 0.44 (0.34–0.53) |
| edgeDist | 0.57 (0.53–0.61) | 0.59 (0.53–0.64) | 0.61 (0.58–0.65) | 0.63 (0.58–0.67) |
| highlightFrac | 0.56 (0.53–0.60) | 0.46 (0.42–0.51) | 0.61 (0.57–0.64) | 0.49 (0.45–0.53) |
| absLongAxisDeg | 0.44 (0.41–0.50) | 0.47 (0.42–0.53) | 0.43 (0.40–0.47) | 0.44 (0.40–0.48) |
| aspect | 0.56 (0.52–0.59) | 0.58 (0.52–0.65) | 0.56 (0.54–0.59) | 0.66 (0.61–0.70) |
| shadowFrac | 0.55 (0.51–0.60) | 0.47 (0.41–0.53) | 0.55 (0.52–0.59) | 0.53 (0.47–0.59) |
| value | 0.45 (0.41–0.49) | 0.56 (0.51–0.62) | 0.48 (0.44–0.52) | 0.55 (0.50–0.60) |
| p95p5 | 0.55 (0.52–0.58) | 0.48 (0.41–0.54) | 0.57 (0.55–0.60) | 0.56 (0.51–0.61) |
| mean | 0.45 (0.41–0.50) | 0.56 (0.50–0.61) | 0.48 (0.44–0.52) | 0.54 (0.49–0.59) |
| bandSpineCount | 0.54 (0.46–0.62) | 0.47 (0.38–0.58) | 0.57 (0.48–0.64) | 0.52 (0.45–0.60) |
| longPx | 0.54 (0.48–0.61) | 0.57 (0.49–0.63) | 0.58 (0.52–0.65) | 0.65 (0.59–0.71) |
| outFrac | 0.46 (0.44–0.47) | 0.49 (0.47–0.52) | 0.45 (0.44–0.46) | 0.49 (0.47–0.51) |
| saturation | 0.46 (0.43–0.50) | 0.47 (0.41–0.54) | 0.46 (0.43–0.49) | 0.46 (0.41–0.51) |
| offAxisDeg | 0.47 (0.43–0.52) | 0.49 (0.43–0.54) | 0.46 (0.43–0.50) | 0.48 (0.43–0.53) |
| ppocrAny | 0.53 (0.52–0.54) | 0.51 (0.50–0.53) | 0.65 (0.63–0.68) | 0.67 (0.63–0.70) |
| shortPx | 0.48 (0.43–0.53) | 0.46 (0.39–0.51) | 0.50 (0.46–0.54) | 0.48 (0.42–0.54) |
| bandEnd | 0.52 (0.48–0.56) | 0.57 (0.53–0.62) | 0.54 (0.50–0.57) | 0.58 (0.54–0.63) |
| lying | 0.48 (0.48–0.49) | 0.49 (0.48–0.50) | 0.47 (0.46–0.48) | 0.47 (0.45–0.48) |
| bandAcross | 0.52 (0.49–0.54) | 0.51 (0.45–0.58) | 0.52 (0.50–0.55) | 0.54 (0.48–0.59) |
| rmsContrast | 0.51 (0.48–0.54) | 0.47 (0.41–0.53) | 0.54 (0.51–0.56) | 0.56 (0.52–0.62) |
| inBand | 0.50 (0.50–0.50) | 0.51 (0.50–0.51) | 0.50 (0.50–0.51) | 0.51 (0.51–0.52) |
| cx | 0.50 (0.46–0.54) | 0.50 (0.44–0.56) | 0.51 (0.47–0.54) | 0.47 (0.42–0.52) |

## Outcome curves (octile bins): confirmed share and no-text share, 95 % photo-bootstrap interval

**lapVar**, pilot-000

| bin | n | confirmed | no-text |
|---|---:|---:|---:|
| 7.01 – 26.2463 | 862 | 2 % (1–3) | 61 % (54–66) |
| 26.2463 – 39.68 | 860 | 4 % (2–6) | 48 % (42–53) |
| 39.68 – 54.145 | 863 | 6 % (4–9) | 36 % (31–40) |
| 54.145 – 74.08 | 861 | 9 % (6–12) | 26 % (21–31) |
| 74.08 – 101.3837 | 863 | 12 % (8–16) | 14 % (11–17) |
| 101.3837 – 143.43 | 860 | 14 % (9–19) | 10 % (8–12) |
| 143.43 – 222.32 | 863 | 17 % (10–22) | 5 % (3–6) |
| 222.32 – 1265.72 | 862 | 20 % (11–27) | 2 % (1–4) |

**lapVar**, yard b2

| bin | n | confirmed | no-text |
|---|---:|---:|---:|
| 3.14 – 6.85 | 141 | 4 % (1–8) | 82 % (69–91) |
| 6.85 – 9.555 | 142 | 9 % (5–15) | 51 % (34–66) |
| 9.555 – 13.0925 | 142 | 19 % (11–27) | 25 % (13–40) |
| 13.0925 – 17.625 | 141 | 25 % (17–32) | 12 % (5–20) |
| 17.625 – 23.4 | 139 | 31 % (20–41) | 9 % (5–15) |
| 23.4 – 30.1325 | 144 | 32 % (22–43) | 7 % (3–13) |
| 30.1325 – 44.0525 | 141 | 33 % (22–46) | 4 % (1–8) |
| 44.0525 – 263.49 | 142 | 23 % (14–37) | 15 % (1–36) |

**lapVarNorm**, pilot-000

| bin | n | confirmed | no-text |
|---|---:|---:|---:|
| 10.73 – 454.12 | 862 | 1 % (0–1) | 70 % (65–75) |
| 454.12 – 848.4575 | 862 | 3 % (2–5) | 47 % (42–52) |
| 848.4575 – 1315.4775 | 861 | 5 % (4–7) | 33 % (27–39) |
| 1315.4775 – 1889.575 | 862 | 9 % (6–12) | 22 % (18–26) |
| 1889.575 – 2616.355 | 862 | 14 % (10–19) | 14 % (11–17) |
| 2616.355 – 3573.98 | 861 | 16 % (10–21) | 8 % (6–11) |
| 3573.98 – 5152.995 | 862 | 17 % (11–22) | 4 % (3–6) |
| 5152.995 – 15386.31 | 862 | 19 % (12–25) | 3 % (2–5) |

**lapVarNorm**, yard b2

| bin | n | confirmed | no-text |
|---|---:|---:|---:|
| 10.86 – 183.54 | 142 | 1 % (0–5) | 92 % (86–96) |
| 183.54 – 507.26 | 141 | 14 % (8–22) | 60 % (48–71) |
| 507.26 – 898.16 | 142 | 24 % (16–32) | 23 % (14–33) |
| 898.16 – 1315.055 | 141 | 31 % (21–42) | 9 % (3–15) |
| 1315.055 – 1695.6663 | 141 | 29 % (18–41) | 9 % (2–18) |
| 1695.6663 – 2226.01 | 142 | 30 % (22–38) | 3 % (1–6) |
| 2226.01 – 2920.715 | 141 | 26 % (17–34) | 3 % (0–7) |
| 2920.715 – 9064.92 | 142 | 20 % (12–31) | 7 % (0–21) |

**lapVarRel**, pilot-000

| bin | n | confirmed | no-text |
|---|---:|---:|---:|
| 0.0543 – 0.4579 | 862 | 4 % (2–6) | 52 % (46–60) |
| 0.4579 – 0.6304 | 862 | 5 % (3–8) | 40 % (32–47) |
| 0.6304 – 0.8006 | 861 | 8 % (5–11) | 32 % (24–40) |
| 0.8006 – 1 | 854 | 9 % (6–13) | 26 % (18–34) |
| 1 – 1.2757 | 870 | 13 % (8–18) | 20 % (14–27) |
| 1.2757 – 1.6637 | 861 | 14 % (9–19) | 15 % (10–21) |
| 1.6637 – 2.3641 | 862 | 16 % (10–21) | 9 % (5–14) |
| 2.3641 – 17.6896 | 862 | 15 % (9–21) | 7 % (5–11) |

**lapVarRel**, yard b2

| bin | n | confirmed | no-text |
|---|---:|---:|---:|
| 0.1471 – 0.4536 | 142 | 3 % (0–6) | 78 % (61–94) |
| 0.4536 – 0.6668 | 141 | 17 % (10–25) | 45 % (29–60) |
| 0.6668 – 0.8282 | 142 | 18 % (10–25) | 25 % (14–40) |
| 0.8282 – 1 | 131 | 24 % (15–32) | 18 % (7–31) |
| 1 – 1.2128 | 151 | 28 % (19–38) | 11 % (4–18) |
| 1.2128 – 1.54 | 142 | 27 % (18–37) | 7 % (3–12) |
| 1.54 – 2.1291 | 141 | 32 % (24–40) | 8 % (3–14) |
| 2.1291 – 12.1199 | 142 | 25 % (15–43) | 14 % (1–32) |

**blurRatio**, pilot-000

| bin | n | confirmed | no-text |
|---|---:|---:|---:|
| 0.1207 – 0.1465 | 862 | 17 % (11–22) | 7 % (5–10) |
| 0.1465 – 0.1544 | 855 | 14 % (9–19) | 10 % (7–13) |
| 0.1544 – 0.1618 | 864 | 12 % (8–16) | 11 % (9–14) |
| 0.1618 – 0.17 | 863 | 13 % (9–18) | 16 % (12–20) |
| 0.17 – 0.1807 | 865 | 11 % (7–15) | 19 % (14–24) |
| 0.1807 – 0.1966 | 859 | 9 % (5–13) | 31 % (26–36) |
| 0.1966 – 0.2321 | 864 | 5 % (2–10) | 44 % (33–52) |
| 0.2321 – 0.753 | 862 | 1 % (0–2) | 64 % (54–73) |

**blurRatio**, yard b2

| bin | n | confirmed | no-text |
|---|---:|---:|---:|
| 0.1181 – 0.1524 | 142 | 29 % (18–50) | 16 % (0–41) |
| 0.1524 – 0.1616 | 141 | 28 % (18–40) | 3 % (0–7) |
| 0.1616 – 0.1701 | 141 | 33 % (23–47) | 3 % (0–7) |
| 0.1701 – 0.1804 | 142 | 22 % (14–31) | 5 % (1–10) |
| 0.1804 – 0.1914 | 140 | 31 % (21–39) | 10 % (5–17) |
| 0.1914 – 0.2183 | 143 | 23 % (15–32) | 22 % (13–34) |
| 0.2183 – 0.286 | 141 | 5 % (2–9) | 62 % (47–76) |
| 0.286 – 0.5067 | 142 | 4 % (0–8) | 83 % (71–93) |

**radial**, pilot-000

| bin | n | confirmed | no-text |
|---|---:|---:|---:|
| 0.0063 – 0.246 | 862 | 15 % (9–22) | 10 % (6–14) |
| 0.246 – 0.3444 | 862 | 15 % (9–21) | 14 % (9–21) |
| 0.3444 – 0.4351 | 861 | 14 % (9–19) | 18 % (12–23) |
| 0.4351 – 0.5068 | 862 | 9 % (6–13) | 18 % (13–24) |
| 0.5068 – 0.5735 | 862 | 10 % (6–15) | 27 % (20–35) |
| 0.5735 – 0.6331 | 860 | 9 % (6–13) | 32 % (25–40) |
| 0.6331 – 0.7145 | 862 | 6 % (4–9) | 36 % (29–43) |
| 0.7145 – 0.9756 | 863 | 4 % (2–5) | 46 % (39–54) |

**radial**, yard b2

| bin | n | confirmed | no-text |
|---|---:|---:|---:|
| 0.0051 – 0.1682 | 142 | 32 % (22–43) | 13 % (3–27) |
| 0.1682 – 0.2615 | 141 | 33 % (23–43) | 13 % (5–22) |
| 0.2615 – 0.3399 | 142 | 29 % (20–38) | 15 % (8–23) |
| 0.3399 – 0.4027 | 141 | 21 % (12–32) | 22 % (9–35) |
| 0.4027 – 0.4787 | 141 | 16 % (10–24) | 23 % (9–36) |
| 0.4787 – 0.5542 | 142 | 22 % (14–32) | 28 % (18–39) |
| 0.5542 – 0.6467 | 141 | 13 % (6–22) | 36 % (27–47) |
| 0.6467 – 0.882 | 142 | 8 % (4–14) | 55 % (44–66) |

**edgeDist**, pilot-000

| bin | n | confirmed | no-text |
|---|---:|---:|---:|
| 0.0015 – 0.0621 | 862 | 4 % (2–6) | 47 % (41–54) |
| 0.0621 – 0.0967 | 862 | 6 % (3–9) | 38 % (29–46) |
| 0.0967 – 0.1392 | 860 | 12 % (7–17) | 27 % (20–34) |
| 0.1392 – 0.1825 | 860 | 9 % (5–13) | 26 % (19–34) |
| 0.1825 – 0.2215 | 861 | 10 % (6–14) | 22 % (16–29) |
| 0.2215 – 0.2886 | 864 | 14 % (9–20) | 19 % (13–26) |
| 0.2886 – 0.3459 | 863 | 15 % (9–20) | 13 % (8–19) |
| 0.3459 – 0.4955 | 862 | 14 % (9–21) | 10 % (7–14) |

**edgeDist**, yard b2

| bin | n | confirmed | no-text |
|---|---:|---:|---:|
| 0.0059 – 0.0768 | 142 | 10 % (5–15) | 55 % (47–63) |
| 0.0768 – 0.1385 | 141 | 14 % (9–20) | 38 % (27–49) |
| 0.1385 – 0.1939 | 142 | 22 % (13–31) | 21 % (11–32) |
| 0.1939 – 0.2356 | 139 | 16 % (9–25) | 26 % (12–40) |
| 0.2356 – 0.2847 | 142 | 16 % (8–27) | 27 % (13–39) |
| 0.2847 – 0.3293 | 143 | 31 % (21–42) | 14 % (8–21) |
| 0.3293 – 0.3976 | 141 | 35 % (26–45) | 11 % (5–19) |
| 0.3976 – 0.4969 | 142 | 30 % (20–44) | 13 % (2–30) |

**shortPx**, pilot-000

| bin | n | confirmed | no-text |
|---|---:|---:|---:|
| 25.5 – 78.9 | 860 | 5 % (2–8) | 30 % (25–37) |
| 78.9 – 99.8 | 863 | 12 % (7–17) | 27 % (21–34) |
| 99.8 – 118.2 | 860 | 13 % (8–18) | 26 % (20–34) |
| 118.2 – 137.8 | 858 | 13 % (8–17) | 26 % (19–34) |
| 137.8 – 162.725 | 868 | 14 % (9–19) | 24 % (20–30) |
| 162.725 – 196.475 | 861 | 9 % (5–13) | 22 % (17–28) |
| 196.475 – 246.1 | 861 | 9 % (6–13) | 23 % (17–30) |
| 246.1 – 582.9 | 863 | 8 % (5–12) | 23 % (16–29) |

**shortPx**, yard b2

| bin | n | confirmed | no-text |
|---|---:|---:|---:|
| 43.2 – 139.3125 | 142 | 12 % (5–22) | 56 % (41–69) |
| 139.3125 – 182.55 | 141 | 26 % (16–37) | 30 % (19–40) |
| 182.55 – 228.5125 | 142 | 33 % (22–46) | 30 % (19–41) |
| 228.5125 – 270.25 | 141 | 22 % (12–33) | 24 % (15–33) |
| 270.25 – 330.325 | 141 | 22 % (14–32) | 20 % (11–29) |
| 330.325 – 399.3 | 142 | 22 % (14–29) | 23 % (16–30) |
| 399.3 – 533.75 | 141 | 21 % (13–28) | 11 % (6–18) |
| 533.75 – 1276.3 | 142 | 17 % (9–26) | 11 % (5–19) |

**boxScore**, pilot-000

| bin | n | confirmed | no-text |
|---|---:|---:|---:|
| 0.15 – 0.1766 | 861 | 4 % (2–6) | 45 % (39–51) |
| 0.1766 – 0.1993 | 858 | 4 % (2–7) | 35 % (29–43) |
| 0.1993 – 0.2204 | 866 | 5 % (2–7) | 30 % (23–38) |
| 0.2204 – 0.2431 | 861 | 8 % (4–11) | 25 % (19–33) |
| 0.2431 – 0.2651 | 863 | 10 % (6–13) | 21 % (15–27) |
| 0.2651 – 0.2914 | 859 | 15 % (9–21) | 18 % (14–23) |
| 0.2914 – 0.329 | 863 | 20 % (13–27) | 14 % (10–19) |
| 0.329 – 0.7733 | 863 | 17 % (10–26) | 14 % (9–20) |

**boxScore**, yard b2

| bin | n | confirmed | no-text |
|---|---:|---:|---:|
| 0.1501 – 0.1779 | 142 | 5 % (2–10) | 70 % (59–79) |
| 0.1779 – 0.2126 | 141 | 6 % (2–11) | 54 % (44–64) |
| 0.2126 – 0.2516 | 142 | 12 % (6–19) | 39 % (25–53) |
| 0.2516 – 0.284 | 141 | 28 % (20–38) | 20 % (12–29) |
| 0.284 – 0.3153 | 140 | 31 % (22–38) | 12 % (6–21) |
| 0.3153 – 0.3434 | 143 | 34 % (23–44) | 8 % (1–18) |
| 0.3434 – 0.3798 | 141 | 32 % (19–43) | 1 % (0–3) |
| 0.3798 – 0.6068 | 142 | 27 % (14–40) | 1 % (0–4) |

**rmsContrast**, pilot-000

| bin | n | confirmed | no-text |
|---|---:|---:|---:|
| 10.25 – 39.13 | 861 | 5 % (3–7) | 42 % (38–46) |
| 39.13 – 45.46 | 861 | 10 % (6–13) | 31 % (25–38) |
| 45.46 – 50.32 | 862 | 10 % (6–14) | 25 % (21–31) |
| 50.32 – 54.77 | 861 | 13 % (8–16) | 27 % (21–34) |
| 54.77 – 58.9 | 863 | 14 % (9–19) | 21 % (16–27) |
| 58.9 – 63.68 | 861 | 13 % (8–18) | 19 % (15–24) |
| 63.68 – 70.45 | 862 | 11 % (7–15) | 18 % (13–24) |
| 70.45 – 101.09 | 863 | 9 % (5–13) | 18 % (14–23) |

**rmsContrast**, yard b2

| bin | n | confirmed | no-text |
|---|---:|---:|---:|
| 6.92 – 28.9338 | 142 | 10 % (5–16) | 70 % (60–79) |
| 28.9338 – 36.3475 | 141 | 18 % (10–29) | 38 % (28–48) |
| 36.3475 – 42.3413 | 142 | 27 % (17–37) | 27 % (15–41) |
| 42.3413 – 47.23 | 141 | 20 % (13–29) | 25 % (16–34) |
| 47.23 – 51.6525 | 141 | 28 % (19–36) | 14 % (7–23) |
| 51.6525 – 56.6625 | 142 | 23 % (15–31) | 14 % (7–22) |
| 56.6625 – 62.78 | 140 | 22 % (13–34) | 12 % (4–23) |
| 62.78 – 89.76 | 143 | 27 % (18–39) | 4 % (0–9) |

**highlightFrac**, pilot-000

| bin | n | confirmed | no-text |
|---|---:|---:|---:|
| 0 – 0.0001 | 1623 | 5 % (3–7) | 46 % (39–52) |
| 0.0001 – 0.001 | 939 | 9 % (5–12) | 28 % (23–32) |
| 0.001 – 0.0035 | 862 | 11 % (7–15) | 23 % (18–28) |
| 0.0035 – 0.0085 | 869 | 15 % (10–19) | 20 % (16–25) |
| 0.0085 – 0.0172 | 873 | 11 % (7–15) | 15 % (11–20) |
| 0.0172 – 0.0332 | 865 | 14 % (8–20) | 14 % (10–19) |
| 0.0332 – 0.5354 | 863 | 14 % (9–20) | 14 % (10–19) |

**highlightFrac**, yard b2

| bin | n | confirmed | no-text |
|---|---:|---:|---:|
| 0 – 0.0001 | 975 | 22 % (16–28) | 28 % (21–35) |
| 0.0001 – 0.2365 | 157 | 19 % (10–32) | 11 % (2–23) |

**offAxisDeg**, pilot-000

| bin | n | confirmed | no-text |
|---|---:|---:|---:|
| 0 – 0.4 | 861 | 9 % (5–13) | 31 % (26–37) |
| 0.4 – 1.33 | 859 | 13 % (7–18) | 21 % (15–27) |
| 1.33 – 2.57 | 864 | 13 % (8–18) | 20 % (14–27) |
| 2.57 – 3.89 | 858 | 13 % (8–18) | 21 % (16–28) |
| 3.89 – 5.61 | 866 | 11 % (7–15) | 21 % (17–27) |
| 5.61 – 8.05 | 859 | 11 % (7–15) | 23 % (18–29) |
| 8.05 – 12.93 | 864 | 9 % (5–12) | 27 % (20–34) |
| 12.93 – 45 | 863 | 6 % (3–8) | 37 % (29–47) |

**offAxisDeg**, yard b2

| bin | n | confirmed | no-text |
|---|---:|---:|---:|
| 0 – 0.23 | 141 | 15 % (7–23) | 43 % (32–54) |
| 0.23 – 0.93 | 139 | 27 % (17–39) | 18 % (11–26) |
| 0.93 – 1.6 | 144 | 30 % (20–41) | 20 % (11–29) |
| 1.6 – 2.33 | 141 | 17 % (10–26) | 21 % (14–28) |
| 2.33 – 3.22 | 141 | 25 % (16–35) | 22 % (11–33) |
| 3.22 – 4.6525 | 143 | 23 % (14–33) | 22 % (12–32) |
| 4.6525 – 6.63 | 141 | 26 % (14–38) | 21 % (10–36) |
| 6.63 – 45 | 142 | 11 % (3–19) | 39 % (22–57) |

**bandEnd**, pilot-000

| bin | n | confirmed | no-text |
|---|---:|---:|---:|
| 0.0058 – 0.0841 | 854 | 7 % (4–11) | 39 % (33–46) |
| 0.0841 – 0.1565 | 853 | 11 % (7–14) | 26 % (21–31) |
| 0.1565 – 0.2203 | 855 | 9 % (6–12) | 26 % (21–32) |
| 0.2203 – 0.2829 | 853 | 11 % (7–14) | 21 % (16–28) |
| 0.2829 – 0.3418 | 854 | 12 % (7–16) | 22 % (18–28) |
| 0.3418 – 0.3966 | 854 | 12 % (7–17) | 20 % (15–26) |
| 0.3966 – 0.4488 | 853 | 11 % (6–15) | 22 % (17–28) |
| 0.4488 – 0.5 | 855 | 12 % (7–17) | 22 % (17–27) |

**bandEnd**, yard b2

| bin | n | confirmed | no-text |
|---|---:|---:|---:|
| 0.0075 – 0.0754 | 139 | 13 % (7–19) | 51 % (42–60) |
| 0.0754 – 0.1417 | 139 | 14 % (8–21) | 29 % (18–40) |
| 0.1417 – 0.2123 | 139 | 22 % (14–31) | 20 % (12–28) |
| 0.2123 – 0.2718 | 139 | 20 % (12–28) | 21 % (10–32) |
| 0.2718 – 0.3306 | 139 | 27 % (17–39) | 22 % (13–30) |
| 0.3306 – 0.395 | 139 | 27 % (18–36) | 17 % (10–24) |
| 0.395 – 0.4512 | 139 | 21 % (13–31) | 19 % (8–30) |
| 0.4512 – 0.5 | 140 | 32 % (23–43) | 22 % (12–33) |

**mean**, pilot-000

| bin | n | confirmed | no-text |
|---|---:|---:|---:|
| 11.26 – 62.2825 | 862 | 10 % (6–13) | 34 % (29–40) |
| 62.2825 – 75.4825 | 862 | 12 % (8–16) | 26 % (21–32) |
| 75.4825 – 87.65 | 860 | 12 % (8–15) | 26 % (20–33) |
| 87.65 – 100.965 | 863 | 12 % (8–15) | 25 % (19–32) |
| 100.965 – 115.3925 | 862 | 9 % (6–13) | 23 % (17–29) |
| 115.3925 – 131.8325 | 861 | 11 % (7–16) | 25 % (20–30) |
| 131.8325 – 157.8113 | 862 | 8 % (5–12) | 25 % (20–32) |
| 157.8113 – 237.32 | 862 | 10 % (6–16) | 18 % (13–23) |

**mean**, yard b2

| bin | n | confirmed | no-text |
|---|---:|---:|---:|
| 15.35 – 76.9513 | 142 | 21 % (13–31) | 41 % (28–51) |
| 76.9513 – 93.54 | 141 | 18 % (12–26) | 22 % (11–35) |
| 93.54 – 109.3438 | 142 | 18 % (10–28) | 26 % (13–39) |
| 109.3438 – 124.155 | 141 | 17 % (9–26) | 19 % (12–28) |
| 124.155 – 139.255 | 141 | 22 % (14–32) | 14 % (8–22) |
| 139.255 – 153.6825 | 142 | 25 % (17–35) | 23 % (10–37) |
| 153.6825 – 170.17 | 141 | 30 % (18–40) | 25 % (16–37) |
| 170.17 – 230.51 | 142 | 23 % (15–32) | 35 % (25–46) |

## Where failures cluster: per-photo-normalised failure residual (percentage points)

Each cell: share of spines centred there that are not confirmed, minus each photo's own failure share, pooled. Positive = worse than the photo's average. `·` = no spine. Grid oriented to the photos (pilot-000 portrait 6 × 8, yardstick landscape 8 × 6).

**pilot-000**: not-confirmed residual · no-text residual · spines per cell

```
  +8  -2  -1  -8  +6  +3    +14  +6  -6  +2  +5 +27     71  75  66  67  55  55
  +4  -5  -4  -4  -1  +7     +6  +3  -4 -10  -2  +4    101 132 174 132 123 111
  -1  -5  -7 -15  -4  -4     -5 -13 -19 -13 -14  -9    112 153 173 163 136  88
  -3  -9  -6 -14 -10  +2     +1 -11 -14 -14  -8  +1    104 137 160 135 131 103
  +1  -4  -5  -3  -4  -1     -2 -16 -16 -15 -13  -7    167 183 216 209 167 119
  +5  +3  +4  +1  +4  +6     +2  -5  -5  -8  -8  -4    127 177 242 233 188 130
  +6  +6  +3  +4  +2  +4    +17 +16  +1 +10  +5  +9    134 190 222 247 179 116
  +6  +9  +3  +9  +8  +9    +34 +28 +24 +23 +30 +26    111 150 186 181 157 106
```

**yard b2**: not-confirmed residual · no-text residual · spines per cell

```
 +14 +10  +7 +12 +14 +14 +21 +20    -24 +36 +29 +82 +78 +60 +48 +57      3   3   5   3   2   4   3   6
  +3  +7   0  +8 +12  +6  +5  +8    +26  -6  +6 +17  +5 +16  +5 +24     18  14  17  25  18  16  15  16
  +6  +2  +5  +2 -10  +6  +0 +14    +24 -11 -13 -11 -13 -12 -22 +13     34  37  27  36  39  29  26  19
 +13  -4 -13 -12  -8  -7  +0 +10    +10 -10 -12 -13 -10  -8  +2  +7     37  61  66  73  73  69  79  54
 +11 -10 -23  -4  +4  +5  +2 +10     +9 -21 -19  +4  +9  +8  -1 +29     17  25  17  27  28  24  26  23
   · +33 +14 +26 +11 +19 +16  +6      ·  -8 +36 +43 +41 +48 +56 +44      0   1   2   3   4   3   1   4
```

## Controls

Subsets: share confirmed and share no-text (95 % photo-bootstrap interval).

| subset | pilot-000 n | yard b2 n | pilot-000 confirmed | yard b2 confirmed | pilot-000 no-text | yard b2 no-text |
|---|---:|---:|---:|---:|---:|---:|
| lying | 407 | 66 | 1 % (0–3) | 2 % (0–3) | 56 % (49–62) | 77 % (68–86) |
| partlyOutOfFrame | 679 | 86 | 1 % (1–3) | 16 % (8–24) | 45 % (36–54) | 28 % (18–43) |
| inFrameUpright | 5846 | 992 | 12 % (8–16) | 23 % (17–30) | 21 % (16–26) | 23 % (16–30) |

In-frame upright spines only, confirmed vs no-text AUC; and among boxes where PP-OCR read any text, confirmed vs no-catalog-match AUC:

| feature | pilot-000 upright, vs no-text | yard b2 upright, vs no-text | pilot-000 text read, vs no-match | yard b2 text read, vs no-match |
|---|---:|---:|---:|---:|
| radial | 0.29 (0.24–0.34) | 0.27 (0.20–0.34) | 0.43 (0.39–0.46) | 0.41 (0.35–0.47) |
| edgeDist | 0.70 (0.64–0.76) | 0.73 (0.66–0.80) | – | – |
| lapVar | 0.87 (0.82–0.90) | 0.88 (0.78–0.95) | 0.61 (0.54–0.67) | 0.52 (0.45–0.60) |
| lapVarRel | 0.76 (0.72–0.81) | 0.84 (0.76–0.92) | 0.57 (0.54–0.61) | 0.51 (0.44–0.57) |
| boxScore | 0.77 (0.72–0.81) | 0.88 (0.83–0.92) | – | – |
| shortPx | 0.58 (0.53–0.64) | 0.65 (0.56–0.72) | 0.47 (0.43–0.52) | 0.45 (0.38–0.51) |
| blurRatio | – | – | 0.42 (0.35–0.48) | 0.47 (0.40–0.53) |
| rmsContrast | – | – | 0.50 (0.48–0.54) | 0.47 (0.40–0.53) |

## Descriptive model (pilot-000; confirmed vs no-text)

Features fixed before fitting: log1p(shortPx), log1p(lapVar), rmsContrast, highlightFrac, radial. Split: pilot-000 photos in sorted id order, every third held out (train 21 photos / 1749 spines, held out 10 / 707). No tuning.

| | train AUC | held-out AUC | yardstick b2 AUC (transfer, no refit) |
|---|---:|---:|---:|
| logistic | 0.91 (0.88–0.94) | 0.89 (0.79–0.93) | 0.88 (0.74–0.96) |
| depth-3 tree | 0.89 (0.85–0.91) | 0.84 (0.64–0.90) | 0.69 (0.57–0.77) |

Logistic weights on standardised features: log1p(shortPx) +0.95, log1p(lapVar) +2.29, rmsContrast -0.25, highlightFrac -0.05, radial -0.52.

```
if lapVar ≤ 79.2875:
  if lapVar ≤ 54.6588:
    if lapVar ≤ 22.3781:
      → 1 % positive (n=264)
    else:
      → 9 % positive (n=675)
  else:
    if shortPx ≤ 111.0625:
      → 10 % positive (n=107)
    else:
      → 42 % positive (n=156)
else:
  if radial ≤ 0.5406:
    if lapVar ≤ 114.75:
      → 60 % positive (n=99)
    else:
      → 88 % positive (n=294)
  else:
    if shortPx ≤ 98.6469:
      → 18 % positive (n=44)
    else:
      → 58 % positive (n=110)
```

## Candidate thresholds (hypotheses; cut chosen on pilot-000, checked on yardstick b2)

The cut is the pilot decile that best splits the text-read share (any outcome but no-text). Shares with 95 % photo-bootstrap intervals.

| feature | cut | pilot below: n, text read, confirmed | pilot at/above | yard b2 below | yard b2 at/above |
|---|---:|---|---|---|---|
| shortPx | 91.7 | 1378: 70 % (63–76), 7 % (5–10) | 5516: 76 % (70–81), 11 % (7–15) | 40: 30 % (14–49), 0 % (0–0) | 1092: 76 % (70–82), 23 % (17–28) |
| lapVar | 45.339 | 2068: 47 % (43–52), 3 % (2–5) | 4826: 86 % (83–89), 13 % (9–18) | 1006: 73 % (67–80), 22 % (16–28) | 126: 83 % (62–99), 21 % (13–34) |
| lapVarNorm | 1029.971 | 2068: 45 % (40–51), 2 % (1–3) | 4826: 87 % (84–90), 14 % (9–18) | 465: 46 % (38–55), 14 % (10–20) | 667: 94 % (88–98), 27 % (21–34) |
| rmsContrast | 37.063 | 690: 54 % (49–59), 4 % (3–7) | 6204: 77 % (71–82), 11 % (7–15) | 304: 48 % (39–59), 15 % (10–22) | 828: 84 % (78–89), 24 % (18–31) |
| highlightFrac | 0.0003 | 1993: 58 % (51–64), 5 % (3–8) | 4901: 82 % (77–86), 12 % (8–17) | 1017: 73 % (67–80), 22 % (17–28) | 115: 84 % (69–97), 19 % (8–35) |
| radial | 0.5612 | 4136: 83 % (78–88), 13 % (8–18) | 2758: 62 % (55–69), 7 % (4–9) | 859: 81 % (74–88), 25 % (19–33) | 273: 54 % (44–63), 11 % (6–16) |
| boxScore | 0.2253 | 2757: 64 % (56–70), 5 % (3–7) | 4137: 82 % (77–86), 14 % (9–19) | 321: 40 % (31–49), 6 % (3–10) | 811: 88 % (84–91), 28 % (22–35) |
| offAxisDeg | 14.84 | 6203: 76 % (70–81), 11 % (7–15) | 691: 61 % (51–70), 6 % (2–8) | 1108: 75 % (69–81), 22 % (17–29) | 24: 42 % (12–72), 0 % (0–0) |

## Image level: Spearman ρ between a photo's feature and its outcome (95 % bootstrap over photos)

**pilot-000**: per-photo confirmed share (machine agreement), 31 photos

| photo feature | ρ |
|---|---:|
| megapixels | -0.25 (-0.55–0.11) |
| imgLapVar | 0.41 (0.04–0.71) |
| detected | 0.38 (0.04–0.63) |
| medianShortPx | -0.23 (-0.56–0.13) |
| medianLapVar | 0.30 (-0.07–0.64) |
| medianRmsContrast | 0.18 (-0.16–0.48) |
| medianMean | -0.75 (-0.86–-0.51) |
| medianHighlightFrac | 0.08 (-0.25–0.44) |

**yard b2**: per-image title recall, 39 photos

| photo feature | ρ |
|---|---:|
| megapixels | -0.05 (-0.37–0.29) |
| imgLapVar | -0.10 (-0.44–0.23) |
| detected | -0.05 (-0.37–0.28) |
| medianShortPx | -0.17 (-0.49–0.15) |
| medianLapVar | 0.01 (-0.33–0.29) |
| medianRmsContrast | 0.03 (-0.27–0.34) |
| medianMean | -0.16 (-0.49–0.22) |
| medianHighlightFrac | -0.08 (-0.21–0.00) |
| annotatedBooks | 0.10 (-0.23–0.43) |
| detectedPerBook | -0.33 (-0.59–0.01) |

