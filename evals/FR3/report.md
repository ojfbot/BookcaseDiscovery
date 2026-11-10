# FR3: alternate image representations, CPU spike (F-R3)

## Pre-registration (committed before the first spike run)

Fixed 2026-11-03, before any representation was computed on a photo. Nothing below changes after a result is seen;
any change is a logged deviation (`implementation-notes.md`) and the report names the figures it touches.

**Question.** Do cheap, label-free re-renderings of a photo (colour spaces, illumination invariants, a classical
albedo/shading split, edges, lines and band-pass energy) put their edges where books end, more than the RGB photo
does, and do simple per-pixel values separate known not-a-book regions from book faces? CPU only, no model runs,
no downloads, no training except the leave-one-photo-out check in M5.

**Set.** `pilot-000` only (real use, a dev set, OC11); every figure is machine agreement, never accuracy (INV-17).
The yardstick is not used. No hand labels (OC36).

**Sample (fixed by rule, not by eye).** The 10 `pilot-000` photos with the smallest SHA-256 of `"F-R3/" + photo id`.
M4's flagged class pools all 31 photos, because the shipped filter flags only 24 boxes in the set.

**Inputs (all cached, nothing recomputed).** Working copies; F-0e's `bands+strips` boxes; the shipped not-a-book
filter's kept ids (Q-2b's table, 6,121 of 6,145 boxes); Q-2b's SAM 2.1 outlines; H-2's MoGe-2 point maps and normals
(`moge-2-vitl-normal@cb0e8bb`, 2048 px long side) and class maps. All work is at the point map's resolution: the
working copy is resized to it (area interpolation) and every polygon is scaled by the map's `scale`. S-1 voids are
used only if cached when the spike runs.

**Representations.** Each yields an edge map E (Sobel magnitude after a Gaussian of σ = 1 px; for several channels,
the root sum of squares of each channel's gradient, each channel first divided by its image-wide robust spread,
IQR/1.349).

| family | name | what |
|---|---|---|
| baseline | `gray`, `rgb` | luma; the three sRGB channels |
| (a) colour | `lab`, `lab-L`, `lab-C`, `hsv-S`, `hsv-V`, `opponent`, `rg-chroma`, `c1c2c3` | CIELAB (all, L\*, chroma C\*); HSV saturation and value; opponent O1 O2 O3; r, g; Gevers–Smeulders c1c2c3 |
| (a) invariant | `log-chroma` | Finlayson–Drew–Lu 1-D invariant: geometric-mean log-chromaticity projected at the angle (1° steps) that minimises its histogram entropy (Scott bins, 5–95 % trimmed), per photo, on the sRGB values as stored (no linearisation) |
| (a) contrast | `clahe-L` | CLAHE on L\* (clip 2, 8 × 8 tiles) |
| (b) intrinsic | `retinex`, `bilateral-albedo` | multi-scale Retinex on luma, σ ∈ {8, 32, 128} px; log luma minus its bilateral-filtered self (σ space 16 px, σ colour 0.3) |
| (c) edges | `canny`, `coherent`, `aligned`, `dog` | Canny on luma (thresholds 0.66 and 1.33 × median luma); gradient × structure-tensor coherence (σ = 4 px); gradient × cos² to the dominant orientation at spine scale (σ = 12 px); \|DoG\| (σ 1 vs 3 px) |
| (c) lines | `lsd`, `lsd-long` | LSD segments drawn 1 px wide, value log(1 + length); `lsd-long` keeps segments ≥ 40 px |
| (c) geometry | `depth`, `normals` | \|∇ log z\| from H-2's points; root sum of squares of the normal channels' gradients |
| fused | `fuse-colour`, `fuse-rgb+depth` | mean of per-photo rank-normalised E of {`lab`, `opponent`, `log-chroma`, `retinex`}; of {`rgb`, `depth`, `normals`} |

**Measures.** Per photo, then the mean over photos with a 95 % photo bootstrap (2,000 draws, seed 1); every
comparison with `rgb` is the paired per-photo difference, bootstrapped the same way. AUCs are Mann–Whitney with
ties at one half, on at most 50,000 sampled pixels per class per photo (seed 1).

- **M1, outline boundaries.** AUC of E at pixels within 1 px of a kept box's Q-2b outline boundary against pixels
  inside a kept outline at least 4 px from any outline boundary (book interiors: text, art, texture). *Circular for
  colour*: SAM drew the outlines on the RGB photo, so this favours whatever SAM sees.
- **M2, depth and normal discontinuities.** Reference edges: pixels inside the books' region (kept outlines grown by
  6 px, valid map) at or above the 95th percentile of either \|∇ log z\| or the normal gradient there. AUC of E at
  those against pixels in the region at least 3 px from them. `depth`, `normals` and `fuse-rgb+depth` are circular
  here and reported as reference only.
- **M3, spine-to-spine seams.** Pairs: kept upright boxes (within 15° of vertical) of one band, consecutive by
  centre, with vertical extents overlapping by at least half the shorter and a gap between them of at most half the
  narrower's width. The seam at a height is midway between the left box's right side and the right box's left
  side. At 9 heights spread over the middle 60 % of the overlap, take E along the image row within half the
  narrower width of the seam. A height is a **hit** when every position of the profile's maximum lies within
  max(2 px, 0.1 × the narrower width) of the seam; a zero profile is a miss. Per pair the hit share; per photo the
  mean over pairs. Chance is reported (tolerance window over profile length).
- **M4, not-a-book against book faces (per-pixel values, not edges).** Book: H-2 `front` pixels of kept boxes.
  Classes: **flagged** (pixels inside boxes the shipped filter flags; all 31 photos), **behind** and **under**
  (H-2 classes inside kept boxes: gaps, back wall, shelf undersides), **outside** (valid map pixels outside every
  box grown by 8 px: shelves, store, signage, and any missed book). Features: luma, L\*, a\*, b\*, C\*, S, V, O1, O2,
  r, g, `log-chroma`, `retinex`, `bilateral-albedo`, local edge density (mean `rgb` E over 15 × 15), `dog` energy
  (same window), coherence, and relative depth (z over the photo's median `front` z). AUC per feature and class,
  reported as max(AUC, 1 − AUC) with the direction. Depth is circular against `behind`.
- **M5, combined (leave one photo out).** Logistic regression on standardised M4 features, book against all
  non-book classes pooled, trained on 9 sample photos and scored (AUC) on the held-out one; two feature sets:
  colour and texture only, and those plus relative depth.

**What counts as worth a GPU arm (decision rule).** A representation is carried forward when, against `rgb`, its
paired difference on M2 or M3 has a 95 % interval wholly above 0 (M1 alone is not enough: it is circular). A per-pixel
feature is carried to the not-a-book discard when its M4 AUC is at least 0.75 with the interval's lower end at least
0.70 for a class, or M5 adds at least 0.03 AUC with depth over without.

**Expected (hypotheses, not rules).** `log-chroma` and `retinex` beat `rgb` on M3 where gaps are shadows; `aligned`
and `lsd-long` beat `rgb` on M3 by ignoring text; colour features separate `outside` (wood) at AUC > 0.75 but not
`flagged` (white card against white books); depth separates `behind` (circular) and helps M5.

## Verdict

Run 2026-11-03 on the pre-registered sample (10 photos, 2,362 kept boxes with outlines, 1,794 seam pairs; M4's
flagged class over the 18 photos holding flagged boxes). CPU only, about 5 s a photo for every representation and
measure. Every figure is machine agreement on cached outlines and depth, **never accuracy** (INV-17).

1. **H-2's normals are the strongest seam cue, and they are already cached.** Normal-discontinuity edges sit on the
   seam between neighbouring spines at **0.546 (0.494–0.597)** of heights against `rgb`'s 0.326 (+0.220, 0.160 to
   0.282), with chance at 0.23, and they line up best with outline boundaries (M1 0.819). Depth jumps (\|∇ log z\|)
   do not help seams at all (+0.003, −0.059 to +0.069): neighbouring spines stand in one plane, so what turns at a
   seam is the surface direction, not the distance. In the private renders depth edges mark shelf lips and the
   tops of rows, and normal edges outline individual spines.
2. **Colour re-renderings that divide out brightness find seams that RGB misses.** Against `rgb` on M3:
   multi-scale **Retinex +0.127** (0.101 to 0.151), **rg-chromaticity +0.106**, **c1c2c3 +0.105**, the
   **log-chromaticity invariant +0.084**, HSV saturation +0.063; all also agree better with depth and normal edges
   (M2 +0.04 to +0.07). Representations that keep brightness linear do not: Lab −0.012 (−0.032 to +0.008), opponent −0.004,
   chroma C\* −0.025. CLAHE gives +0.031. *Hypothesis for why:* the gaps between books are dark, and a linear
   gradient there is small; ratio and log representations weigh a step in the dark the same as a step in the light.
3. **Orientation helps, global alignment much less.** Gradient × structure-tensor coherence: +0.071 on M3.
   Gradient aligned to the dominant spine-scale orientation: only +0.018. LSD segments hit seams well (+0.116) but
   are sparse, so they score badly on M1 and M2 (AUC ≈ 0.55): line segments are a seam *locator*, not a boundary
   map. Canny scores 0.038 on M3, an artefact of the pre-registered tie rule (a binary map often has two maxima in
   a profile, which counts as a miss); Canny's M1 and M2 are also near chance (0.53, 0.51).
4. **Two expected wins did not come.** The bilateral albedo/shading split is *worse* than RGB on every measure
   (M1 −0.045, M2 −0.057). Fusing rank-normalised maps dilutes the best member: `fuse-rgb+depth` (0.469 on M3)
   is below `normals` alone (0.546), and `fuse-colour` (0.375) below `retinex` alone (0.453).
5. **The pre-registered carry rule passes 15 of 23 representations against `rgb`.** Most pass by small margins;
   the large effects are `normals` (+0.22), `fuse-rgb+depth` (+0.14), `retinex` (+0.13), `lsd` (+0.12),
   `rg-chroma` and `c1c2c3` (+0.11), `log-chroma` (+0.08) and `coherent` (+0.07). Even the best single cue finds the
   seam at only about half of heights, so no representation is a seam detector on its own.
6. **Not-a-book regions separate by brightness, warmth and texture; gaps only by depth.**
   - *Flagged boxes* (shelf labels and strips) are brighter (L\* separation 0.812, 0.744–0.871) and less saturated
     (S 0.786) than book faces. This is partly circular: F-0f's blank-card rule already flags flat white card by
     its pixel probe. Colour confirms the filter, it does not extend it.
   - *Shelf undersides* (H-2 `under`) are warm and dark: red chromaticity r 0.856, L\* 0.825.
   - *Outside every box* (shelves, store, signage, missed books) is smoother: edge density 0.767, band-pass (DoG)
     energy 0.759; books carry more fine texture.
   - *Gaps and back wall* (H-2 `behind`) pass only on relative depth (0.826), which is how `behind` is defined.
     No colour feature reaches the bar (best r 0.745). So a shadow gap is not told from a dark book by colour.
   - *Combined* (M5, leave one photo out): colour and texture alone give **0.825 (0.803–0.847)** held-out AUC for
     book faces against all not-a-book pixels; adding relative depth adds +0.010 (−0.008 to +0.025), short of the
     0.03 bar.
7. **The log-chromaticity angle is stable across this store's photos**: 9 of 10 photos at 158–161°, one at 8°.
   One lighting setup gives one invariant direction, as Finlayson's model expects, despite JPEG and phone tone
   curves (it says nothing about other stores).

**Carried forward** (recommendations: `docs/models/image-representations.md`): normals and a Retinex
(log-contrast) edge map as seam evidence for pass 1; LSD as a seam locator for prompts; edge density and warm
chromaticity as per-box not-a-book features. Not carried: bilateral albedo, DoG and Canny as boundary maps, Lab and
opponent channels, rank fusion as specified, depth as an extra per-pixel not-a-book feature.

## Limits

- **M1 is circular for colour**: SAM drew Q-2b's outlines on the RGB photo. M2 is circular for the depth-derived
  maps. M3's seam is placed from the boxes' sides, which carry their own error, so a hit means "agrees with the
  detector's seam", not "on the true gap".
- `pilot-000` is one store and a dev set; 10 photos is a small sample (intervals are photo bootstraps). The
  yardstick was not used. Nothing was trained except M5's leave-one-photo-out logistic regression on machine
  classes (H-2's face split, the shipped filter's flags).
- Class labels for M4 are machine output: H-2's face split and the filter's flags. `outside` includes any book no
  box found. S-1's voids were not cached when the spike ran.
- Work is at 2048 px (H-2's map), a quarter of the working copy: thin spines and hairline gaps are near the
  resolution floor. The representations use stored sRGB values; nothing is linearised.

## Private outputs

Under the data root's `private/fr3/`: `per-photo.jsonl` (per-photo measures), `renders/` (a contact sheet of every
edge map per sample photo, `index.html`), `run.log`. To regenerate (CPU, about 2 minutes): `uv sync` in `helpers/representations`, then run `spike.py` with the
cached inputs its README lists, writing stdout to `evals/FR3/metrics.json`.

## Deviations

- M3's band membership is not stored in the detection record; a box takes the first band polygon holding its centre
  (logged; found by a crash before any metric existed).
- The first full run's carry flag excluded the depth-derived maps outright; the pre-registration excludes them from
  M2 only. Fixed and re-run before the report was written; the measures were identical (deterministic), only the
  `carry` flag of `normals` and `fuse-rgb+depth` changed (logged).

<!-- Tables below are generated from metrics.json. -->

### Edge maps against `rgb` (10 sample photos)

Seam chance level (M3): 0.228 (0.221–0.234). 1794 seam pairs, 2362 outlines. Sorted by M3. *Carry* is the pre-registered rule: M3 (or M2, where not circular) better than `rgb` with the interval wholly above 0.

| representation | family | M1 outline AUC | Δ vs rgb | M2 depth-edge AUC | Δ vs rgb | M3 seam hits | Δ vs rgb | carry |
|---|---|---:|---:|---:|---:|---:|---:|---|
| `normals` | (c) geometry | 0.819 (0.797–0.841) | +0.158 (+0.126 to +0.190) | 0.906 (0.897–0.916) *(circular)* | +0.280 (+0.268 to +0.290) | 0.546 (0.494–0.597) | +0.220 (+0.160 to +0.282) | **yes** |
| `fuse-rgb+depth` | fused | 0.830 (0.813–0.850) | +0.169 (+0.148 to +0.194) | 0.926 (0.919–0.935) *(circular)* | +0.300 (+0.288 to +0.310) | 0.469 (0.436–0.508) | +0.144 (+0.104 to +0.187) | **yes** |
| `retinex` | (b) intrinsic | 0.741 (0.733–0.749) | +0.080 (+0.054 to +0.103) | 0.685 (0.667–0.703) | +0.059 (+0.042 to +0.074) | 0.453 (0.426–0.480) | +0.127 (+0.101 to +0.151) | **yes** |
| `lsd` | (c) lines | 0.555 (0.547–0.562) | -0.106 (-0.128 to -0.088) | 0.530 (0.526–0.534) | -0.096 (-0.114 to -0.081) | 0.442 (0.421–0.464) | +0.116 (+0.086 to +0.146) | **yes** |
| `rg-chroma` | (a) colour | 0.717 (0.706–0.730) | +0.056 (+0.028 to +0.084) | 0.665 (0.642–0.686) | +0.039 (+0.013 to +0.064) | 0.432 (0.407–0.456) | +0.106 (+0.072 to +0.132) | **yes** |
| `c1c2c3` | (a) colour | 0.732 (0.721–0.742) | +0.071 (+0.045 to +0.094) | 0.690 (0.668–0.711) | +0.064 (+0.047 to +0.080) | 0.430 (0.405–0.456) | +0.105 (+0.071 to +0.135) | **yes** |
| `log-chroma` | (a) invariant | 0.680 (0.667–0.693) | +0.019 (-0.008 to +0.046) | 0.627 (0.601–0.660) | +0.001 (-0.028 to +0.033) | 0.409 (0.384–0.433) | +0.084 (+0.047 to +0.111) | **yes** |
| `coherent` | (c) edges | 0.723 (0.713–0.733) | +0.062 (+0.048 to +0.075) | 0.677 (0.658–0.697) | +0.051 (+0.034 to +0.065) | 0.397 (0.376–0.418) | +0.071 (+0.051 to +0.089) | **yes** |
| `hsv-S` | (a) colour | 0.712 (0.702–0.721) | +0.051 (+0.029 to +0.070) | 0.691 (0.670–0.710) | +0.065 (+0.051 to +0.079) | 0.389 (0.364–0.412) | +0.063 (+0.029 to +0.090) | **yes** |
| `fuse-colour` | fused | 0.716 (0.705–0.729) | +0.055 (+0.042 to +0.068) | 0.661 (0.640–0.682) | +0.035 (+0.020 to +0.052) | 0.375 (0.355–0.398) | +0.050 (+0.029 to +0.066) | **yes** |
| `lsd-long` | (c) lines | 0.542 (0.537–0.548) | -0.119 (-0.137 to -0.102) | 0.517 (0.512–0.523) | -0.110 (-0.123 to -0.097) | 0.359 (0.338–0.382) | +0.033 (+0.011 to +0.055) | **yes** |
| `clahe-L` | (a) contrast | 0.673 (0.660–0.687) | +0.012 (+0.003 to +0.022) | 0.629 (0.616–0.645) | +0.003 (-0.004 to +0.009) | 0.356 (0.335–0.376) | +0.031 (+0.023 to +0.038) | **yes** |
| `hsv-V` | (a) colour | 0.663 (0.645–0.683) | +0.002 (-0.000 to +0.005) | 0.626 (0.612–0.642) | +0.000 (-0.003 to +0.004) | 0.348 (0.327–0.371) | +0.023 (+0.015 to +0.032) | **yes** |
| `aligned` | (c) edges | 0.678 (0.662–0.696) | +0.017 (+0.010 to +0.025) | 0.632 (0.618–0.650) | +0.006 (-0.002 to +0.013) | 0.344 (0.320–0.364) | +0.018 (+0.015 to +0.021) | **yes** |
| `lab-L` | (a) colour | 0.656 (0.639–0.675) | -0.005 (-0.007 to -0.002) | 0.625 (0.610–0.642) | -0.001 (-0.004 to +0.001) | 0.333 (0.312–0.354) | +0.007 (+0.004 to +0.011) | **yes** |
| `depth` | (c) geometry | 0.689 (0.663–0.718) | +0.028 (+0.001 to +0.061) | 0.861 (0.846–0.874) *(circular)* | +0.234 (+0.215 to +0.251) | 0.329 (0.274–0.392) | +0.003 (-0.059 to +0.069) | no |
| `rgb` | baseline | 0.661 (0.642–0.682) | +0.000 (+0.000 to +0.000) | 0.626 (0.611–0.645) | +0.000 (+0.000 to +0.000) | 0.326 (0.303–0.347) | +0.000 (+0.000 to +0.000) | no |
| `opponent` | (a) colour | 0.673 (0.652–0.698) | +0.012 (+0.006 to +0.018) | 0.631 (0.613–0.652) | +0.005 (-0.003 to +0.011) | 0.322 (0.294–0.353) | -0.004 (-0.022 to +0.016) | no |
| `gray` | baseline | 0.646 (0.628–0.665) | -0.015 (-0.018 to -0.013) | 0.618 (0.603–0.636) | -0.008 (-0.011 to -0.006) | 0.320 (0.297–0.341) | -0.006 (-0.010 to -0.002) | no |
| `bilateral-albedo` | (b) intrinsic | 0.616 (0.602–0.635) | -0.045 (-0.056 to -0.034) | 0.569 (0.549–0.597) | -0.057 (-0.064 to -0.048) | 0.319 (0.300–0.341) | -0.006 (-0.025 to +0.013) | no |
| `lab` | (a) colour | 0.671 (0.650–0.695) | +0.010 (+0.003 to +0.017) | 0.626 (0.605–0.649) | -0.000 (-0.009 to +0.008) | 0.313 (0.289–0.340) | -0.012 (-0.032 to +0.008) | no |
| `lab-C` | (a) colour | 0.645 (0.627–0.667) | -0.016 (-0.026 to -0.008) | 0.616 (0.595–0.638) | -0.010 (-0.020 to -0.001) | 0.301 (0.278–0.323) | -0.025 (-0.047 to -0.005) | no |
| `dog` | (c) edges | 0.620 (0.609–0.631) | -0.041 (-0.052 to -0.030) | 0.604 (0.595–0.614) | -0.022 (-0.037 to -0.009) | 0.298 (0.277–0.320) | -0.028 (-0.038 to -0.017) | no |
| `canny` | (c) edges | 0.530 (0.523–0.536) | -0.131 (-0.149 to -0.114) | 0.514 (0.508–0.520) | -0.113 (-0.126 to -0.100) | 0.038 (0.028–0.051) | -0.288 (-0.310 to -0.264) | no |

Depth or normal reference edges lying within 2 px of an outline boundary: 0.629 (0.610–0.647).

### Not-a-book against book faces, per-pixel values (M4)

Pixels: book 12,313,109; flagged 197,515 (all 18 photos holding flagged boxes); behind 134,655; under 82,448; outside 9,813,106. Separation is max(AUC, 1 − AUC); the top five features per class.

| class | feature | separation | higher on | carry (≥ 0.75, lower end ≥ 0.70) |
|---|---|---:|---|---|
| flagged | luma | 0.815 (0.747–0.875) | flagged | **yes** |
| flagged | L* | 0.812 (0.744–0.871) | flagged | **yes** |
| flagged | V | 0.795 (0.733–0.850) | flagged | **yes** |
| flagged | S | 0.786 (0.733–0.835) | book | **yes** |
| flagged | rel-depth | 0.753 (0.678–0.830) | flagged | no |
| behind | rel-depth | 0.826 (0.747–0.895) | behind | **yes** |
| behind | r | 0.745 (0.694–0.793) | behind | no |
| behind | V | 0.718 (0.662–0.774) | book | no |
| behind | L* | 0.717 (0.658–0.777) | book | no |
| behind | luma | 0.716 (0.655–0.774) | book | no |
| under | r | 0.856 (0.831–0.884) | under | **yes** |
| under | L* | 0.825 (0.791–0.860) | book | **yes** |
| under | luma | 0.823 (0.791–0.858) | book | **yes** |
| under | V | 0.812 (0.784–0.842) | book | **yes** |
| under | retinex | 0.807 (0.785–0.829) | book | **yes** |
| outside | edge-density | 0.767 (0.750–0.785) | book | **yes** |
| outside | dog-energy | 0.759 (0.737–0.778) | book | **yes** |
| outside | r | 0.723 (0.695–0.750) | outside | no |
| outside | O1 | 0.685 (0.661–0.709) | outside | no |
| outside | b* | 0.676 (0.654–0.696) | outside | no |

### Combined, leave one photo out (M5)

| features | held-out AUC, book vs not-a-book |
|---|---:|
| colour and texture | 0.825 (0.803–0.847) |
| plus relative depth | 0.835 (0.804–0.864) |
| depth's gain | +0.010 (-0.008 to +0.025) (rule: ≥ 0.03; not met) |

### Cost and checks

- Seconds per photo (CPU, 2048 px, everything): p50 5.67, max 5.88; representations p50 1.57, edge maps p50 0.92.
- Log-chromaticity invariant angle per photo (degrees): 8, 158, 158, 158, 159, 159, 159, 159, 159, 161.
- S-1 voids cached: no (not used).
