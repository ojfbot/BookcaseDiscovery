# Alternate image representations: separating books from everything else (F-R3)

Research card F-R3, 2026-11-03. The owner's idea: don't only look at the pixels as the eye sees them. Push the
photo into other "registers" (colour spaces, illumination changes, noise, edges, shadows) to separate books from
shelves, shadows, signage, store background and each other, and to discard what is not a book. This card surveys
the families, measures the cheap ones on cached `pilot-000` data on the CPU ([`evals/FR3`](../../evals/FR3/report.md)),
and says what to try in which pass. Its focus is the **input representation**. Refining masks is F-R1's thread
([`docs/models/instance-boundaries.md`](instance-boundaries.md), branch `claude/fr1-boundaries`).

Evidence labels: **verified** (a primary source was read: paper or abstract page, repo, licence file, model card),
**snippet** (a search result or secondary source), **hypothesis** (reasoning, not checked). Spike figures are
**measured** on `pilot-000`: machine agreement on cached outlines and depth, never accuracy (INV-17).

## Answer first

- **Top recommendation: use the normals H-2 already caches, plus a Retinex (log-contrast) edge map, as seam
  evidence to split and re-prompt conflicting masks in pass 1 (F-0i).** It costs no new model and no download. In
  the CPU spike, normal-discontinuity edges land on the seam between neighbouring spines at 0.55 of heights against
  RGB's 0.33 (chance 0.23); Retinex is the best colour-only map at 0.45 (measured, `evals/FR3`). Proposed card
  **R3-A** (§8).
- **The owner's idea works, in one specific form: re-renderings that divide out brightness.** Retinex,
  rg-chromaticity, c1c2c3 and the log-chromaticity shadow invariant all find seams RGB misses (+0.08 to +0.13 on
  the seam measure); Lab and opponent channels, which keep brightness linear, do not (measured). Likely why: the
  gaps between books are dark, and ratio or log maps weigh a step in the dark like a step in the light
  (hypothesis).
- **Colour cannot tell a shadow gap from a dark book; geometry can.** No colour feature separates H-2's `behind`
  pixels (gaps, back wall) from book faces at the bar; only depth does (measured). For the shadow confound the
  candidates are depth (H-2, S-1's voids) and, as a GPU arm, Marigold-IID's albedo/shading split, the only learned
  intrinsic model with a licence an AGPL repo can use (verified). Off-the-shelf shadow detectors are mostly
  unlicensed and trained on outdoor cast shadows (verified).
- **For the not-a-book discard, brightness, warmth and texture help; most of it is already in F-0f.** Shelf labels
  are brighter and less saturated than books (F-0f's whiteness rule, confirmed); shelf undersides are warm and
  dark; shelves and background carry less fine texture than books. Per-box edge density and warm chromaticity are
  the new features worth a CPU card (**R3-C**). Colour and texture together give 0.83 held-out AUC per pixel; depth
  adds 0.01 (measured).
- **Pass 2 (per-book reading, F-R2's F-0j): nothing measured here earns a change yet.** Keep colour transforms away
  from the readers' crops; a CLAHE-on-L crop for dark boxes is a cheap reader arm to try only after F-0j's
  extraction lands (hypothesis).
- **"Add noise and see what survives"** is used as (1) diffusion features, (2) stability under perturbation,
  (3) masked autoencoders and DINO's augmentation training, (4) SAM's stability score (§5). The useful, cheap part
  here is (2) and (4): a consistency vote over jittered prompts or photometric views, and SAM's own score, which the
  pipeline's logits already allow (hypothesis). Diffusion features re-buy what DINO gives at several times the
  cost; the exception worth a GPU arm is Marigold-IID (hypothesis).
- **GPU arms, later and in order:** SAM re-prompts on seams (R3-A), photometric-view consensus on conflict tiles
  (R3-B), then DINOv2 patch clustering and Marigold-IID shading on the same harness (R3-D). DINOv3 has the best
  dense features but is gated behind a Meta form, so it stays an optional backend; DINOv2 (Apache-2.0, ungated) is
  the default (verified). Run plan in §9.

## 1. Photometric and colour-space transforms, illumination invariance (thread a)

| method | primary source | implementation and licence | size and hardware | fit |
|---|---|---|---|---|
| CIELAB (L\*, a\*, b\*, C\*, h°) | CIE 1976 | OpenCV `cvtColor`, Apache-2.0 (verified) | per pixel, ms; CPU, MPS via Kornia (snippet) | see §6 for the measured fit |
| HSV (S, V) | Smith 1978 | OpenCV, scikit-image (verified) | ms | hue is unstable at low S and V, which is exactly the shadow gaps (verified: Akiyama & Ito 1998 put pink paper behind their books to avoid it) |
| Opponent O1 O2 O3 | van de Sande, Gevers, Snoek, TPAMI 2010 ([PDF](https://staff.fnwi.uva.nl/th.gevers/pub/GeversPAMI10.pdf)) | a few lines of NumPy | ms | O1, O2 shift-invariant to light intensity (snippet) |
| rg-chromaticity, c1c2c3, l1l2l3 | Gevers & Smeulders, Pattern Recognition 32(3), 1999 ([PDF](https://staff.fnwi.uva.nl/th.gevers/pub/GeversPR99.pdf)) | NumPy | ms | invariant to shading and geometry under white light; noise explodes as intensity falls (snippet) |
| Log-chromaticity 1-D invariant (entropy minimisation) | Finlayson, Drew, Lu, ECCV 2004 ([page](https://www.cs.sfu.ca/~mark/ftp/Eccv04/)); IJCV 85, 2009 | **no official code** (verified); re-implemented in `helpers/representations` | < 1 s a photo subsampled; CPU | assumes Lambertian surfaces, near-Planckian light and narrow-band sensors, "reasonably well" when violated (verified); phone tone curves and JPEG are a real violation (hypothesis) |
| CLAHE | Zuiderveld, Graphics Gems IV, 1994 | OpenCV `createCLAHE`, Apache-2.0 | tens of ms | a detector input, never a colour-rule input: it changes chroma and value (hypothesis) |
| Retinex (SSR/MSR/MSRCR) | Jobson, Rahman, Woodell, IEEE TIP 6(7), 1997 (snippet) | no canonical repo; NumPy | three large blurs, 1–3 s | halos at strong shelf edges (hypothesis) |

Bookshelf-specific colour work: Akiyama & Ito (MVA 1998, verified, full text) take edges on intensity, two hue
phases and saturation, keep the per-pixel maximum, keep only longitudinal edge directions to suppress title text,
then run a Hough transform. That is the pre-deep-learning version of this card's best measured cue (§6). No paper
was found that detects shelves or wood by colour in bookshelf photos (snippet: searched, none found). One related
result: invariant greyscale and shading-attenuated channels added to RGB lifted a skin-lesion segmenter by 4–12
points of Jaccard (Abhishek, Hamarneh & Drew, [arXiv:2003.10111](https://arxiv.org/abs/2003.10111), verified
abstract) — but that network was trained with the channels; ours are frozen.

## 2. Intrinsic decomposition and shadow removal (thread b)

The licence is the gate. Only one learned intrinsic model is clean for an AGPL repo.

| method | licence | size | Apple silicon | training domain | fit for "shadow gap or dark spine" |
|---|---|---|---|---|---|
| **Marigold-IID Lighting v1.1** ([repo](https://github.com/prs-eth/Marigold), [card](https://hf.co/prs-eth/marigold-iid-lighting-v1-1)) | code Apache-2.0, weights OpenRAIL++-M (verified) | 866 M (SD2-based, verified) | README has an `--apple_silicon` MPS flag (verified); 4 steps, ensemble 1 | synthetic indoor, Hypersim (snippet) | **medium-high** (hypothesis): albedo plus diffuse shading plus residual; a gap is low shading at mid albedo, a dark spine low albedo |
| Careaga & Aksoy, ordinal shading and colourful diffuse ([repo](https://github.com/compphoto/Intrinsic)) | **academic use only, patent pending** (verified) | multi-stage | plain PyTorch (verified), MPS untested | mixed real and rendered | blocked by licence; offline comparison only |
| RGB↔X ([repo](https://github.com/zheng95z/rgbx)) | **Adobe Research Licence, non-commercial** (verified) | 866 M | diffusers (hypothesis) | synthetic indoor | blocked |
| IntrinsicAnything ([repo](https://github.com/zju3dv/IntrinsicAnything)) | code needs registration (PRL v1.0); weights tagged Apache-2.0 (conflicting, verified) | diffusion | not checked | object-centric, needs masks | low |
| FDRNet ([repo](https://github.com/rayleizhu/FDRNet)) | MIT (verified) | not checked | not checked | SBU/ISTD cast shadows | low-medium: built to stop treating dark as shadow (verified title), the one licence-clean detector worth a try |
| BDRAR, MTMT, SILT, SDDNet, DC-ShadowNet, ShadowDiffusion, HomoFormer, AdapterShadow | **no licence file** (verified): all rights reserved | 12–100 M | several list CUDA 11 (verified) | SBU/ISTD/UCF/SRD | low: wrong domain (outdoor cast shadows) |
| ShadowFormer ([repo](https://github.com/GuoLanqing/ShadowFormer)), DocShadow/FSENet ([repo](https://github.com/CXH-Research/DocShadow-SD7K)) | MIT (verified) | small (hypothesis) | no custom ops (hypothesis) | ISTD/SRD; flat documents | low for gaps; DocShadow medium for flattening cover lighting before OCR |
| SAM-Adapter ([repo](https://github.com/tianrun-chen/SAM-Adapter-PyTorch)) | MIT (verified) | SAM backbone | not checked | ISTD among its tasks (snippet) | medium as a framework, but it needs our own gap labels |
| Bell et al., Intrinsic Images in the Wild ([repo](https://github.com/seanbell/intrinsic)) | MIT (verified) | classical CRF | CPU | real indoor, human pairwise judgements | medium as an idea (pairwise reflectance), dated code |

Domain point (hypothesis): shadow datasets are mostly cast shadows outdoors or on the ground. The gaps between
books are *attached* shadow and ambient occlusion inside a recess, which an intrinsic shading layer models directly
and which H-2's depth already sees as "behind". Classical parts measured in the spike: multi-scale Retinex and a
bilateral albedo/shading split.

## 3. Edge, gradient and frequency maps; lines; depth edges (thread c)

| method | source | licence | cost | fit |
|---|---|---|---|---|
| Sobel/Scharr, Canny, LoG/DoG, structure tensor (coherence, orientation), Gabor | classical; OpenCV, scikit-image | Apache-2.0, BSD-3 (snippet) | ms | see §6 |
| Phase congruency | Kovesi, Videre 1999 ([article](https://cs.rochester.edu/u/brown/Videre/001/articles/Kovesi/index.html)) | `phasepack` port, MIT/"other" (snippet) | log-Gabor bank, slower | contrast-invariant, so dark-on-dark gaps (hypothesis); not measured |
| LSD (von Gioi) | `cv2.createLineSegmentDetector` | removed from OpenCV 3.4.6–3.4.15 and 4.1.0–4.5.3 over a licence conflict, restored in 4.5.4 / 3.4.16 (verified, [docs](https://docs.opencv.org/4.5.4/db/d73/classcv_1_1LineSegmentDetector.html)) | fast, parameter-free | measured (§6) |
| EDLines, FLD | `cv2.ximgproc` (contrib) | Apache-2.0 (snippet) | faster than LSD | same role as LSD; not measured |
| M-LSD ([repo](https://github.com/navervision/mlsd)) | AAAI 2022, [arXiv:2106.00186](https://arxiv.org/abs/2106.00186) | Apache-2.0 (verified) | ≈ 0.6 M params, CPU (snippet) | medium: trained on wireframes |
| DeepLSD, ScaleLSD, HAWP, SOLD2 | CVPR 2023/2025, TPAMI 2023, CVPR 2021 | MIT (verified) | CUDA-tested installs (verified) | medium for a later bake-off; DeepLSD includes vanishing-point estimation (verified) |
| TEED ([repo](https://github.com/xavysp/TEED)) | ICCVW 2023 | MIT (verified) | **58 K params** (verified), CPU | high as the cheap learned edge channel (hypothesis) |
| DexiNed, PiDiNet | WACV 2020; ICCV 2021 | MIT; PiDiNet's header says "research purpose" (verified) | small | medium; PiDiNet's licence is ambiguous |
| HED, RCF, EDTER, DiffusionEdge | ICCV 2015, TPAMI 2019, CVPR 2022, AAAI 2024 | not confirmed / MIT / Apache-2.0 | heavy or dated | low |
| SAM's own boundaries | SAM paper §7.2 ([arXiv:2304.02643](https://arxiv.org/abs/2304.02643)) | Apache-2.0 | already in the pipeline | BSDS500 ODS 0.768 against HED 0.788, zero-shot (verified) |
| Depth and normal discontinuities | MoGe's scripts use `depth_edge(rtol≈0.03–0.04)` and `normals_edge(tol=5°)` (snippet); Gupta et al. CVPR 2013 | MIT | free from H-2's cache | measured (§6) |

Spine literature (verified unless marked): Hu, Tang & Lei (SPIE 2016) split shelves on near-horizontal Canny lines
and books on near-vertical ones; Tsai et al. (ACM MM 2011, snippet) reproject each spine between detected lines;
the Smart Library paper ([arXiv:1611.07385](https://arxiv.org/abs/1611.07385), snippet) warns that Hough-based
splitting breaks under lighting change and low contrast. No paper turns line pairs into SAM prompts for shelves
(snippet: searched, none found). SAM takes points, boxes and a mask prompt; an edge map cannot be an input channel
without retraining (hypothesis), so edges should **generate prompts or score masks**, not feed the encoder.

## 4. Test-time augmentation and multi-view consistency, no training (thread d; arXiv searched directly)

| work | arXiv | code, licence | forward passes | fit |
|---|---|---|---|---|
| SAM's stability score | [2304.02643](https://arxiv.org/abs/2304.02643); SAM 2 [2408.00714](https://arxiv.org/abs/2408.00714) | sam2 `utils/amg.py`, Apache-2.0 (verified) | ≈ 0 | **high**: IoU of the mask thresholded at ±1 logit (verified defaults: offset 1.0, threshold 0.95); a merged pair of similar spines should score low (hypothesis) |
| SAM-U, multi-box prompt jitter | [2307.04973](https://arxiv.org/abs/2307.04973) | none found | encoder 1×, decoder N× | **high**: per-pixel uncertainty from jittered box prompts, cheap with SAM 2's reused embedding |
| FNPC | [2308.10382](https://arxiv.org/abs/2308.10382) | — | N boxes | high: uses that uncertainty to fix false-negative and false-positive pixels without training (verified abstract) |
| Wang et al., TTA aleatoric uncertainty | [1807.07356](https://arxiv.org/abs/1807.07356) | none found | N | high as a pattern: transforms → per-pixel variance → uncertainty |
| Better aggregation in TTA | [2011.11156](https://arxiv.org/abs/2011.11156) | — | N | the caution: plain averaging "can change many correct predictions into incorrect" (verified abstract); gate fusion by agreement |
| SegTTA | [2604.17451](https://arxiv.org/abs/2604.17451) | no licence | 4 views × K | high as a recipe: gamma, contrast, blur and noise views fused by weighted vote over a frozen SAM 2 variant (medical) |
| UR-SAM, PerSAM | [2311.10529](https://arxiv.org/abs/2311.10529), [2305.03048](https://arxiv.org/abs/2305.03048) | —, MIT | N prompts; 1–2 | medium: prompt augmentation and rectification; cascaded re-prompting |
| Robustness of SAM to corruptions | [2306.07713](https://arxiv.org/abs/2306.07713), [2305.06422](https://arxiv.org/abs/2305.06422) | — | eval | SAM is texture-biased, so photometric views really change its output: disagreement is informative (hypothesis) |
| RobustSAM | [2406.09627](https://arxiv.org/abs/2406.09627) | MIT | 1 | low: SAM-1 based, 8-GPU training |
| Stable-SAM, SAM-TTA, SAM-TTT, UncertainSAM, RUAC | 2311.15776, 2506.05221, 2509.11884, 2505.05049, 2605.10603 | mixed | trained heads or gradient steps | low: not training-free; RUAC names the failure ("one IoU per mask misses pixel reliability near boundaries") |
| TCSR-Monitor | [2608.16748](https://arxiv.org/abs/2608.16748) | — | 1 + cheap cues | medium-high as a design: confidence plus shape and quality cues for a flag-for-review rule |

No arXiv paper does training-free photometric-view TTA for SAM 2 on natural images (verified by search); the closest
are SegTTA (medical) and SAM-U/FNPC (prompt-side).

## 5. Features learned through augmentation and noise (thread e)

| model | licence | size, memory at ≈ 1024 px | MPS / MLX | repo | fit |
|---|---|---|---|---|---|
| **DINOv2** ViT-B/L/g | Apache-2.0, ungated (verified) | 86 M / 304 M / 1.1 B; L ≈ 3–6 GB (hypothesis) | transformers on MPS; bicubic position interpolation falls back to CPU (snippet) | [facebookresearch/dinov2](https://github.com/facebookresearch/dinov2) | **high**: clean licence; patch clustering of spine, shelf and background |
| **DINOv3** ViT-S…H+, 7B; ConvNeXt | DINOv3 Licence, **gated** behind a Meta form (verified) | 21 M–840 M; 7B 6.7 B params, ≈ 14 GB fp16 (hypothesis) | transformers ≥ 4.56, timm ≥ 1.0.20 (verified); repo tested on Linux/CUDA only (verified); community MLX ports (snippet) | [facebookresearch/dinov3](https://github.com/facebookresearch/dinov3), [arXiv:2508.10104](https://arxiv.org/abs/2508.10104) | best dense features (Gram anchoring keeps patch features local at high resolution, verified abstract); **adoption blocked by gating** in a no-accounts project; use restrictions are "further restrictions" under AGPL §7 — never vendor (hypothesis, not legal advice) |
| Feature upsamplers: JAFAR, LoftUp, AnyUp, FeatUp | Apache-2.0, MIT, CC-BY-4.0 weights, MIT (verified) | < 10 M (hypothesis) | pure PyTorch; AnyUp without NATTEN (snippet) | [JAFAR](https://github.com/PaulCouairon/JAFAR), [LoftUp](https://github.com/andrehuang/loftup), [AnyUp](https://github.com/wimmerth/anyup), [FeatUp](https://github.com/mhamilton723/FeatUp) | **high**: a 16 px patch is about one thin spine; JAFAR has DINOv3 checkpoints (verified) |
| TokenCut, Deep Spectral Methods, MaskCut/CutLER, FOUND | MIT; no licence; CC-BY-NC; Apache-2.0 with a trained decoder (verified) | graph on 4–5 k tokens, < 1 GB | NumPy/SciPy | linked in each | medium-high: re-implement normalised cut or spectral clustering on DINOv2 patches |
| DIFT (SD 2.x) | MIT code, OpenRAIL++-M weights (verified/snippet) | ≈ 1.3 B; 768 px × 8 ensemble, 8–12 GB (hypothesis) | untested | [Tsingularity/dift](https://github.com/Tsingularity/dift) | low: re-buys DINO at 3–10× the compute |
| DiffSeg ("Diffuse, Attend, and Segment") | MIT + SD (verified) | SD plus BLIP; 2 × 11 GB GPUs suggested (verified) | TensorFlow/CUDA | [google/diffseg](https://github.com/google/diffseg) | low: porting cost, oversegments texture (hypothesis) |
| ODISE, VPD, Diffusion Hyperfeatures, EmerDiff | CC-BY-NC-SA / trained heads / no code (snippet) | — | — | — | excluded |
| Marigold depth and normals, E2E-FT, Lotus, StableNormal, GeoWizard | Apache-2.0 code, OpenRAIL++-M weights (verified for Marigold) | 866 M, 4–8 GB at 768 px (hypothesis) | Marigold `--apple_silicon` (verified) | [prs-eth/Marigold](https://github.com/prs-eth/Marigold) | low over MoGe-2: neighbouring spines differ by millimetres in depth at 1–3 m (hypothesis) |
| MAE | CC-BY-NC 4.0 (verified) | 86–632 M | MPS OK (hypothesis) | [facebookresearch/mae](https://github.com/facebookresearch/mae) | low: licence, and frozen MAE features probe poorly (snippet) |

**Already on disk (hypothesis to check):** MoGe-2's encoder is a vendored DINOv2 (Apache-2.0 module in MIT code;
the DINOv2 encoder is snippet). Its patch tokens may be tappable inside H-2's existing run, with no new download.

### "Add noise and see what signal survives", in plain words

It is used four ways in practice:

1. **Diffusion features.** A diffusion model is trained to remove noise at every strength. To clean a heavily
   noised photo it must know what things look like; with a little noise it only fixes texture. Reading its inner
   activations at a middle noise level (DIFT's timestep) gives a map where parts of the same kind of thing look
   alike. The noise is a training device; you turn it off when you use the features.
2. **Stability under perturbation.** Run the same segmentation on slightly changed inputs (shifted, rescaled,
   recoloured, a little noise) and keep the boundaries that come back every time. A real gap between books
   survives; an edge made by glare, JPEG blocks or a shadow fringe flickers. This is §4.
3. **Masked and denoising autoencoders.** Hide or corrupt most patches and train the model to fill them in: it
   learns which parts belong together. Same idea as 1, with masking instead of noise. DINO is trained on
   augmentations (crops, colour jitter, blur) for the same reason: features that survive them are about objects,
   not lighting.
4. **SAM's stability score.** Threshold SAM's soft mask a bit higher and a bit lower and compare. A crisp object
   barely changes; a mushy region (a shadow, two blended spines) changes a lot. The pipeline already computes the
   logits this needs.

**Does it buy anything here?** (hypothesis) Diffusion features mostly re-buy what DINO already gives, at several
times the compute, with worse licences and no MPS-ready code. The perturbation idea (2 and 4) is the useful, cheap
one: as a consistency vote on SAM masks it costs only extra decoder passes. The one diffusion model worth a GPU arm
is Marigold-IID, because albedo against shading is exactly "shadow or dark book".

## 6. What the CPU spike measured

`helpers/representations/spike.py`, pre-registered in [`evals/FR3/report.md`](../../evals/FR3/report.md): 10
`pilot-000` photos fixed by a hash rule, 23 representations plus RGB, at H-2's 2048 px map, about 5 s a photo on the
CPU. Measured, machine agreement only:

| cue | seam hits (M3), RGB 0.326, chance 0.23 | agrees with depth/normal edges (M2), RGB 0.626 | outline boundaries (M1, circular for colour), RGB 0.661 |
|---|---:|---:|---:|
| `normals` (H-2 cache) | **0.546** | (circular) | **0.819** |
| `retinex` | **0.453** | 0.685 | 0.741 |
| `lsd` segments | 0.442 | 0.530 (sparse) | 0.555 |
| `rg-chroma` / `c1c2c3` | 0.432 / 0.430 | 0.665 / 0.690 | 0.717 / 0.732 |
| `log-chroma` invariant | 0.409 | 0.627 | 0.680 |
| `coherent` (gradient × coherence) | 0.397 | 0.677 | 0.723 |
| `hsv-S` | 0.389 | 0.691 | 0.712 |
| `depth` (\|∇ log z\|) | 0.329 | (circular) | 0.689 |
| `lab` | 0.313 | 0.626 | 0.671 |
| `bilateral-albedo` | 0.319 | 0.569 | 0.616 |

Full tables with intervals and paired differences: `evals/FR3`. What it shows:

- **Seams are turns of the surface, not jumps in distance.** Normals find seams; depth does not (neighbouring
  spines share a plane). Depth edges mark shelf lips and row tops.
- **Brightness-normalised colour beats linear colour** on every measure; see the answer.
- **Lines locate seams but are no boundary map**: LSD hits seams almost as well as Retinex but covers too few
  pixels to score as a boundary map.
- **What did not work:** the bilateral albedo split (worse than RGB), DoG, Canny under the seam tie rule, and
  rank-mean fusion (it dilutes its best member).
- **Not-a-book:** shelf labels by brightness and low saturation (partly circular with F-0f's probe), shelf
  undersides by warm chromaticity and darkness, the outside-the-boxes region by low texture; gaps only by depth.

## 7. Which representation in which pass

| pass | what to try | evidence | why |
|---|---|---|---|
| **Pass 1, geometry: F-0i's conflict tiles and detection** | (1) normals + Retinex edges + LSD segments as **seam evidence** to split partial-conflict and bleed pairs and to place SAM prompts (positive on each side, negative on the seam); (2) SAM's stability score and box-jitter variance as free uncertainty; (3) photometric views (CLAHE-L, a Retinex tone-mapped RGB) through the same detector on conflict tiles, fused by mask-IoU consensus, never by averaging | (1) measured cue strength, prompt use is hypothesis; (2) verified mechanism, untested here; (3) hypothesis (SegTTA, SAM-U pattern) | F-R1: a third of contested pixels are partial conflicts, the refinement target; nested and duplicate masks are an instance question, which views and stability scores can vote on |
| **Pass 2, per-book reading: F-R2's F-0j** | nothing yet; after F-0j lands, a CLAHE-on-L crop as a reader arm for dark boxes; DocShadow (MIT) to flatten cover lighting only if covers return | hypothesis | readers are trained on natural images; colour-space crops are out of distribution. H-2's `face3d` trim already covers the geometry side |
| **Not-a-book discard: S-1, F-0c, F-0f** | per-box edge density and band-pass energy (shelf, wood, store), warm chromaticity r and darkness (shelf undersides), brightness and low saturation (cards, already F-0f); gaps and voids from S-1's depth, not colour | measured (M4) per pixel; per-box rule untested | per-pixel separation 0.76–0.86 for the classes that pass; gaps fail on colour |

Not recommended now: diffusion features (DIFT, DiffSeg), MAE, learned shadow detectors (licences and domain),
DINOv3 as a default (gating), learned edge detectors before the classical seam evidence has been tried in R3-A.

## 8. Proposed cards

Ids are provisional; the conductor assigns real ones.

#### R3-A · Seam evidence for conflicting masks (pass 1, feeds F-0i)
- **goal:** split partial-conflict and boundary-bleed mask pairs along measured seams and re-prompt SAM 2.1, so
  fewer visible pixels are claimed twice.
- **entry:** F-R1 merged (its pair classes and overlap measure); F-0i's conflict-tile definition known; H-2's cache
  present; this card merged; a GPU slot (S-1 finished).
- **do:**
  - CPU: per conflicting pair, the seam evidence in the contested strip (normal edges + Retinex edges, column
    profile along the pair's axis, LSD segments within 10° of the spine axis) and a proposed split line; abstain
    when no seam peak clears a pre-registered margin.
  - GPU: re-prompt each box of a split pair with its side of the split as the box, a positive point on its centre
    line and a negative point across the seam.
  - Pre-register: F-R1's contested-pixel share falls (interval below 0); distinct confirmed works do not fall;
    the yardstick's titles are not hurt.
- **files:** `helpers/representations/seams.py` (new), a new re-prompt script beside `helpers/label/outline.py`
  (that file unchanged), `src/eval/r3a-cli.ts`, `evals/R3A/`. Never `detect.py` or `contracts/`.
- **GPU budget:** about 1,300 `pilot-000` pairs (F-R1: 531 partial, 769 bleed) × 2 prompts at Q-2b's 0.3–0.8 s a
  prompt: about 15–35 min on MPS; the yardstick about 5 min (hypothesis from Q-2b's per-outline seconds).
- **caches invalidated:** none of detection. It writes a new outline set keyed by the split rule. Only if it ships
  as default: Q-2b's outlines are superseded, so H-2's face shares on changed boxes, F-R1's overlap tables, S-1's
  voids (they read outlines) and U-4's renders re-run.
- **tier:** T2 · M · Low.

#### R3-B · Photometric-view consensus on conflict tiles (pass 1, detection)
- **goal:** flag and resolve nested and duplicate detections by asking whether they survive other views of the
  same tile.
- **entry:** R3-A's result read (so the views are tested against a seam-aware baseline); F-0i's conflict tiles;
  a GPU slot.
- **do:** run the shipped detector on each conflict tile as-is and on two views (CLAHE on L\*, a Retinex
  tone-mapped RGB); match masks across views by IoU; keep consensus masks, flag disagreements; record SAM's
  stability score for every mask (a post step reading logits, behind a flag). Pre-register the consensus IoU and
  the keep rule (F-0e's style: conflicts fall, works do not).
- **files:** a `detect.py` post step (`--from`, as F-0e's arms), `src/eval/r3b-cli.ts`, `evals/R3B/`.
- **GPU budget:** 2 extra detections of the conflict tiles only. At F-0e's 78 s a photo for the full layout and
  conflict tiles at a quarter of tiles (hypothesis), about 40 s a photo, 20 min for `pilot-000`.
- **caches invalidated:** none by default (a new arm directory). If it ships: F-0e's default boxes, and with them
  every downstream cache keyed by boxes (readers' changed boxes, Q-2b τ and table, H-2 faces, F-R1, S-1).
- **tier:** T2 · M · Med (touches detection's post steps).

#### R3-C · Per-box pixel features in the not-a-book discard (CPU)
- **goal:** catch shelf, wood and store-background boxes that F-0c's shapes and F-0f's text and whiteness miss.
- **entry:** S-1 merged (its on-lip test and voids are the geometric half); this card merged.
- **do:** extend the pixel probe with per-box edge density, band-pass energy, warm chromaticity and darkness from
  the warped crop; one pre-registered rule; F-0f's keep rule (removes no confirmed book on either set).
- **files:** `helpers/label/probe.py` (new fields, new probe version), `src/eval/f0f.ts` (`labelWhy`), an eval CLI.
- **GPU budget:** 0.
- **caches invalidated:** F-0f's probe files (new version key); the kept-box set, so Q-2b's τ must be re-derived
  (Q-2b finding 4), and H-2's face-share file, F-R1's tables and S-1's per-row figures re-run on the new kept set.
- **tier:** T2 · S · Low.

#### R3-D · Learned label-free features on the same harness (GPU research)
- **goal:** say whether DINOv2 patch features or Marigold-IID shading add seam or not-a-book evidence beyond the
  cached normals and Retinex.
- **entry:** R3-A read; owner's nod for downloads (DINOv2-L, Apache-2.0, about 1.2 GB; Marigold-IID Lighting v1.1,
  OpenRAIL++-M, SD2-sized); first check whether MoGe-2's own DINOv2 encoder tokens can be tapped in H-2's run.
- **do:** add `dinov2` (feature-distance gradient after a JAFAR or LoftUp upsampler, and k-means classes per band
  tile) and `iid-shading` / `iid-albedo` maps to `spike.py`; the same pre-registered measures and sample; a new
  sample of 10 photos as a check.
- **files:** `helpers/representations/` only.
- **GPU budget:** under 1 h (§9).
- **caches invalidated:** none (new cache keyed by model revision under `private/fr3/`).
- **tier:** T2 · M · Low.

## 9. Two-host run plan

Hosts per `docs/ops/compute-fleet.md`: **Yojimbo** (48 GB, this host) and **Yuri** (the 64 GB laptop, a worker only
after the owner's N-2 steps). One GPU worker per host. Night shift runs only admitted jobs with a deterministic
success check and a pre-registered rule (§7 there); downloads and licence acceptance are day-shift owner acts.

| job kind | model | peak memory | per unit | `pilot-000` | Yojimbo | Yuri | night-admissible |
|---|---|---|---|---|---|---|---|
| `representations` | none (this spike) | small, under 2 GB (hypothesis) | 5.4–5.7 s a photo, CPU (measured) | 3 min | yes | yes | yes: deterministic, schema-checked |
| `seams-reprompt` (R3-A) | SAM 2.1 base-plus | a few GB (hypothesis; detection's SAM step) | 0.3–0.8 s a prompt (Q-2b, measured there) | 15–35 min | yes | yes | yes, once its rule is pre-registered |
| `detect-tta` (R3-B) | Grounding DINO + SAM 2.1 | as `detect`: ≈ 11 GB RSS, 15 GB MPS (measured, compute-fleet §3) | ≈ 40 s a photo for two views of conflict tiles (hypothesis) | ≈ 20 min | yes | yes | yes (a pre-registered detector arm) |
| `features-dinov2` (R3-D) | DINOv2 ViT-L/14, 304 M | 3–6 GB (hypothesis) | 0.5–1 s a 1022 px tile on MPS (hypothesis); F-0e's 987 band tiles | 8–16 min | yes | yes | yes after the download (day shift) |
| `features-dinov3` | DINOv3 ViT-L/16 300 M; ViT-7B 6.7 B | L: as DINOv2; 7B: ≈ 14 GB weights fp16 plus activations, 25–35 GB (hypothesis) | 7B several s a tile (hypothesis) | L ≈ 15 min; 7B ≈ 1–2 h | L yes; 7B only with no other GPU job | yes, 7B fits with room | **no** until the owner accepts Meta's gated licence (an account act); then yes |
| `iid-marigold` (R3-D) | Marigold-IID Lighting v1.1, 866 M, 4 steps | 4–8 GB at 768 px (hypothesis) | 5–15 s a photo at 768 px; band crops several times that (hypothesis) | 5–30 min | yes | yes | yes after the download |
| `shadow-detect` | FDRNet (MIT) | — | — | not planned | — | — | — |

Split: the CPU kinds run on whichever host is idle. Put `features-dinov3` 7B, if the owner ever opts in, on Yuri;
everything else fits either host, so the queue's ordinary claiming applies. None is API-bound.

## 10. Glossary for the owner (plain language)

- **Colour space** — another way to write a pixel's colour: Lab (lightness plus two colour axes), HSV (hue,
  saturation, brightness), opponent (red–green, yellow–blue, brightness).
- **Chromaticity** (rg, c1c2c3) — colour with brightness divided out, so a book in shadow keeps the same value.
- **Illumination invariant / log-chromaticity image** — a grey image computed so that a shadow and the lit surface
  next to it come out the same; material changes still show. Finlayson's method finds the right direction per
  photo by making the image as "simple" (lowest entropy) as possible.
- **CLAHE** — local contrast stretching, tile by tile, so dark shelves get visible detail.
- **Retinex** — dividing each pixel by the average brightness around it, roughly what the eye does to ignore
  lighting.
- **Intrinsic decomposition (albedo against shading)** — splitting a photo into "what colour the surface is" and
  "how much light falls on it". A shadow changes shading; a dark book has dark albedo.
- **Edge map, structure tensor, coherence** — where brightness changes; whether the changes nearby all run the same
  way (long straight spine edges) or every way (text).
- **Line segment detector (LSD)** — finds straight line pieces in an image.
- **Depth and normal discontinuities** — places where the distance to the camera jumps, or where the surface turns
  (the normal is the direction a surface faces).
- **Test-time augmentation (TTA), multi-view consistency** — run the same model on slightly changed versions of
  the photo and trust what agrees; disagreement is a measure of doubt.
- **Stability score** — SAM's check of how much a mask changes when its cut-off moves a little.
- **Self-supervised features, DINO, patch features** — a model trained without labels to give the same answer for
  augmented copies of an image; its per-patch outputs group parts of the same kind of thing.
- **Feature upsampler** — turns coarse patch features (one per 14–16 px) into per-pixel ones.
- **Diffusion features, Marigold** — reading the insides of an image-generating model (or one fine-tuned from it
  for depth, normals or albedo) as a description of the scene.
- **Masked autoencoder (MAE)** — a model trained to fill in hidden image patches.
- **Spine seam, seam evidence** — this card's words: the line between two neighbouring spines, and the measured
  signals (normal edges, Retinex edges, line segments) that say where it is (`CONTEXT.md`).
