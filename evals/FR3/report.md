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
