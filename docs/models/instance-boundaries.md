# Book instance boundaries and overlap resolution (F-R1)

Research card F-R1, 2026-11-03 (`claude/fr1-boundaries`). **Question:** detected and segmented books often overlap
each other, which is physically impossible (owner, 2026-11-03). How often, why, and what pass would settle real
boundaries? The owner wants:
- an extra pass that re-segments overlap regions in finer tiles and stitches true edges;
- book geometry and per-book information treated as separate passes, at different resolutions and tilings.

This card is research plus a label-free measurement on cached data. It made no pipeline change, used no GPU (S-1
holds it), and downloaded nothing. No photo, title, path or image id went into any search or external service.
Four threads ran in parallel:
- (a) dense, thin objects, searched on arXiv directly;
- (b) non-overlapping partitions;
- (c) boundary refinement;
- (d) tiling.

Each thread read primary sources. The claims the design rests on were re-opened for this doc (**re-checked** below).
The companion card F-R2 (per-book information extraction) covers reading.

Labels, as in [`identification-research.md`](../catalog/identification-research.md):
- **verified**: read in the primary source (paper, repo code, model card, licence file) or in this repo's own
  reports;
- **snippet**: seen only in a search summary or an abstract listing;
- **hypothesis**: inferred, including all arithmetic and every timing not measured here.

Real-use figures (`pilot-000`) are machine agreement, never accuracy (INV-17). The yardstick is a PROXY (OC35).

## Answer first

- **The invariant is broken, at the same rate on both sets.** **9.3 %** of mask-claimed pixels are claimed by two or
  more books' masks: `pilot-000` 9.3 % (7.8–10.9), yardstick 9.3 % (7.3–11.3). The target is 0.
  - **Per box:** 31 % of boxes share at least 5 % of their mask with another box.
  - **Per crop:** 40 % of `pilot-000` reader crops hold at least 10 % of a neighbour's pixels.
  - Source: [`evals/FR1/report.md`](../../evals/FR1/report.md) (verified, this repo).
- **Box overlap is mostly legitimate; pixel conflict mostly is not a boundary problem.**
  - **Box overlap is common and mostly harmless.** 54 % of neighbouring pairs' oriented boxes overlap, but only a
    quarter of those pairs also share mask pixels.
  - **Contested pixels mostly come from one book segmented twice.** Of the pixels in dispute:
    - **63 %** on `pilot-000` (76 % on the yardstick) belong to **nested or duplicate** masks;
    - 32 % to **partial** conflicts, where one mask takes 20–80 % of its neighbour;
    - **5 %** to thin **boundary bleed**.
  - **So the first step is an instance gate, not a refiner.** It is a cheap CPU rule that decides which detection is
    the book. Today's NMS caps box IoU at 0.45 and lets nested boxes through by design.
- **Finer resolution alone will not fix it.** The cached outlines already resolve a median spine at about 90 mask
  pixels across (verified: SAM's processor squashes each tall box window to 1,024²). Conflict tracks the **prompt**
  instead:
  - pairs with a lean of 15° or more conflict twice as often as upright ones (19 % against 9 %);
  - the outline prompt is the axis-aligned box, which for a leaning spine covers its neighbours.

  So conflict tiles should be **re-prompted jointly**: oriented boxes, negative points on the neighbours, and one
  owner per pixel by logit (SAM 2's own non-overlap rule, already in the processor we use). Then a **seam** settles
  each shared edge.
- **Depth is a weak cue between neighbours, so it is an override, not the rule.**
  - Only 41 % of conflicting pairs differ in depth by 3 % or more.
  - Even then, the contested pixels sit nearer the nearer book in only 57 % (51–62).
  - Flush spines differ by about 1 % in depth, and MoGe-2's map is about 3.6 times coarser than the photo.
  - Use depth where a book clearly protrudes, recedes or stands behind. Use the image edge everywhere else.
- **Recommendation: card F-0i, "instance partition"** (§5). It has four steps:
  1. a CPU instance gate (duplicates, nesting, merged two-book masks);
  2. GPU re-segmentation of conflict groups only, on rotated tiles with joint prompts;
  3. a CPU seam and depth override that resolve to an exclusive partition;
  4. a provenance record of where every boundary came from.

  **Cost and keep rule.**
  - **GPU:** about 10–15 minutes for both sets (hypothesis).
  - **Exit:** the overlap rate falls to ≤ 0.5 %.
  - **Readers:** reader changes ship only on F-0b's keep rule plus F-0e's yardstick guard.
  - **Night runs:** the GPU and reader jobs fit the M3 Max at night under §7's admission rule, once it has joined.
- **Not now:**
  - rotated-box detectors (mmrotate-era CUDA ops, aerial weights, no book class);
  - SKU-110K's EM-Merger (axis-aligned Keras code, licence not stated);
  - learned occlusion order (CUDA, no licence);
  - the CC BY-NC refiners (CRM, RCF);
  - a full detection re-tiling (§4.4).

  These are listed with reasons in §3.

## 1. The measurement (summary)

Full tables are in [`evals/FR1/report.md`](../../evals/FR1/report.md) and [`metrics.json`](../../evals/FR1/metrics.json).
Inputs:
- **`pilot-000`:** F-0e's default `bands+strips` boxes (6,121 after the not-a-book filter), Q-2b's SAM 2.1 outlines.
- **Yardstick:** F-0's B2 boxes (1,116), F-0b's outlines.
- **Depth:** H-2's MoGe-2 cache.

| | `pilot-000` | yardstick |
|---|---:|---:|
| pixel overlap rate (target 0) | 9.3 % (7.8–10.9) | 9.3 % (7.3–11.3) |
| ... with each mask clipped to its own box | 7.0 % (6.0–8.2) | 8.0 % (6.4–9.7) |
| neighbouring pairs: box overlap / mask conflict | 54 % / 15 % | 68 % / 15 % |
| box-overlap pixels: one mask / both / none | 61 / 28 / 11 % | 59 / 30 / 12 % |
| contested pixels: nested / duplicate / partial / bleed | 41 / 22 / 32 / 5 % | 46 / 30 / 21 / 3 % |
| nested box pairs that also conflict as masks | 85 % | 69 % |
| conflict by larger tilt: < 5° / 5–15° / ≥ 15° | 9 / 18 / 19 % | 10 / 20 / 19 % |
| conflict given box overlap: below / level / above eye level | 30 / 22 / 17 % | 21 / 21 / 15 % |
| conflict: side by side / end to end | 18 / 1.2 % | 15 / 6 % |
| reader crops with ≥ 10 % neighbour pixels | 40 % | 36 % |
| `confirmed`, crops with / without that (correlational) | 8.0 / 14.6 % | 17 / 28 % |
| conflicting pairs depth-separated (≥ 3 %) | 41 % | 35 % |

**Reading the strata.**
- **Lean and low rows** raise conflict. That fits an axis-aligned prompt over a leaning spine, and top faces on low
  rows (H-1, H-2).
- **Nesting** is almost always a real conflict: a whole spine holding a piece of itself, or a two-book mask holding
  one book.
- **Fragments are no worse than whole spines** since F-0e.

## 2. Why the masks overlap (causes, with evidence)

1. **Duplicate and nested instances survive NMS.**
   - **The rule:** `detect.py`'s NMS suppresses at rotated IoU 0.45, and a box yields to one holding it only if it is
     cut by a tile edge (`inside` 1.01; verified, code).
   - **The arithmetic:** a spine inside a two-spine box has IoU about 0.5. Two neighbours spilling 20–30 px into each
     other have IoU 0.1–0.2. So IoU is the wrong overlap measure for thin objects (hypothesis, arithmetic, thread a).
   - **What others use:** SAM 3's paper states intersection over the smaller mask (IoM) is more effective than IoU
     for nested instances (verified, arXiv 2511.16719).
2. **The prompt covers neighbours.**
   - **What the code does:** the outline prompt is the polygon's axis-aligned extent (verified, `outline.py`).
     Detection prompts SAM with Grounding DINO's axis-aligned boxes (verified, `detect.py`).
   - **The evidence:** for a leaning spine those rectangles take in neighbours, and conflict doubles with lean
     (verified, FR1).
3. **SAM's notion of an object is not a book's.**
   - **The yardstick's own paper says so:** the Library Dataset (2407.19812, arXiv) found SAM "everything" merging
     adjacent books and splitting two-colour spines; 256 of 6,912 segments were merged books (verified).
   - **Others found it too:** a COCO-pretrained detector "merged several adjacent spines" (2210.10110, verified).
4. **Resolution matters at detection, less in the outlines.**
   - **At detection:** SAM 2's processor resizes any input to 1,024 × 1,024 without keeping its aspect (verified,
     transformers `Sam2ImageProcessor.size` and `Sam2Processor._normalize_coordinates`). F-0e's 1,600 × ~1,215 band
     tiles are squashed 0.64 across and 0.84 down. A median 140 px spine lands at about 90 input px, about 22 mask
     pixels (hypothesis, arithmetic, thread d).
   - **In the outlines:** the window is box plus 15 % margin, stretched to 1,024 across, so a median spine is about
     90 mask pixels (hypothesis, arithmetic).
   - **Implication:** the outlines are already fine across the spine and still conflict, so resolution is not the
     main lever.
5. **Top faces and covers.** Below eye level, masks run onto books' tops (H-1, H-2), which touch the neighbours'
   tops. Conflict given box overlap is 30 % below eye level against 17 % above (verified, FR1).

## 3. What the literature and tools offer

### 3.1 Instance identity in packed scenes (thread a, arXiv)

| method | source | licence, size | MPS | fit to spines | cost |
|---|---|---|---|---|---|
| **Panoptic-style pixel ownership** | panoptic quality paper 1801.00868 §7; MaskFormer 2107.06278; Mask2Former 2112.01527 | no model needed | tensor ops | **high**: one owner per pixel (hypothesis) | ms per band |
| **IoM duplicate and nesting rules**, Matrix NMS decay | SAM 3 2511.16719 (verified); SOLOv2 2003.10152 (AdelaiDet, BSD-2, academic) | reimplemented | CPU | **high** for the 63–76 % nested and duplicate share (hypothesis) | under 1 ms |
| **Core-and-expand** (PSENet kernels; divider NMS on a text-saliency profile) | 1903.12473, 1611.07385 (verified) | heuristic, no training | CPU | medium-high: splits merged neighbours (hypothesis) | under 1 s a band |
| SAM 3 text-prompted instances | 2511.16719; `facebook/sam3` (gated, SAM License, 860 M params, verified) | custom licence | HF port is pure PyTorch (hypothesis); B1 already measured 37 GB MPS | medium-high, but no non-overlap constraint (verified) | 1–3 min a photo (hypothesis) |
| EM-Merger + Soft-IoU (SKU-110K) | 1904.00853; repo has no licence stated (verified) | Keras | port needed | medium: axis-aligned Gaussians (hypothesis) | EM halves throughput (verified) |
| YOLO11/26-OBB | ultralytics, AGPL-3.0 | n–x | MPS | low zero-shot; medium once our partitions can serve as pseudo-labels (hypothesis) | 0.05–0.15 s a tile |
| Rotated detectors (Oriented R-CNN, R3Det, RoI Transformer, S2A-Net, rotated RTMDet, ARS-DETR) | mmrotate / OBBDetection, Apache-2.0 | R50-class | **blocked**: mmcv rotated ops and DCN (hypothesis) | low: aerial weights, no book class | — |
| Soft-NMS, Adaptive NMS, CrowdDet Set NMS | 1704.04503, 1904.03629, 2003.09163 | — | — | low: they rescore boxes, never remove pixel overlap (hypothesis) | — |

### 3.2 Turning masks into a partition (thread b)

- **Panoptic FPN** (Detectron2, Apache-2.0), verified in code:
  - pastes instances by score;
  - drops an instance if over half its mask is already taken.
- **Mask2Former and HF post-processing**: each pixel goes to the argmax of score × mask probability. A segment is kept
  only if it keeps 80 % of its area. **Re-checked:** `overlap_mask_area_threshold: float = 0.8` in the cached
  transformers copy.
- **SAM 2's non-overlap rule**: a per-pixel logit argmax across objects, losers clamped.
  - **Re-checked:** HF's `Sam2ImageProcessor.post_process_masks(..., apply_non_overlapping_constraints=False)`
    applies it to the masks of one call.
  - It is off by default, and `detect.py` does not pass it, so it is available in the stack we already run.
- **Splitting a contested region:**

  | method | licence | cost per photo (hypothesis) | fit |
  |---|---|---|---|
  | minimum-cost seam along the spine axis (`skimage.graph.MCP_Geometric`, or a 1-D dynamic program) | BSD-3 | 0.2–30 s, CPU | **high** |
  | marker-controlled watershed (3+ instances meeting) | BSD-3 | 1–8 s, CPU | **high** |
  | random walker | BSD-3 | 15 s – 7 min | medium |
  | DenseCRF | MIT, build issues | 15–75 s | medium-low |
  | graph cut | PyMaxflow is **GPL** | 8–45 s | avoid |
  | GrabCut | — | 15–75 s | low: neighbours share colours |

  All are verified in docs or code.
- **Depth as order.**
  - The Depth Pro boundary test (inverse-depth ratio over 1.05–1.25; verified, `boundary_metrics.py`) will not fire
    between flush spines, at about a 1.01 ratio (hypothesis).
  - FR1 confirms it is weak here: only 41 % of conflicting pairs are depth-separated (verified).
  - The layered-model literature's rule, "the front layer owns", applies only where the step is real.

### 3.3 Boundary refinement at higher resolution (thread c)

| candidate | refines a given mask? | two touching instances? | licence; HF | size | MPS | fit |
|---|---|---|---|---|---|---|
| **SAM 2.1 base-plus on a rotated, upsampled conflict tile** | takes box, point and mask prompts (verified) | yes, one prompt set per spine | Apache-2.0; `facebook/sam2.1-hiera-base-plus` | 80.9 M (verified, card) | pure PyTorch (in use) | **high**: already cached and validated |
| **SAMRefiner** prompt recipe (points, elastic box, Gaussian mask prompt from a coarse mask) | yes (verified, abstract) | per mask | MIT; no HF repo | on top of SAM | logic is pure PyTorch (hypothesis) | **high** as a recipe |
| HQ-SAM (ViT-B) / HQ-SAM 2 | prompted | yes | Apache-2.0; `lkeab/hq-sam`, `syscv-community/sam-hq-vit-base` (verified) | HQ-SAM 2 is Large only, 224.7 M (verified) | likely (hypothesis) | medium-high: one comparison arm |
| CascadePSP | yes, one binary mask | **no** | MIT; `hkchengrex/CascadePSP-onnx` (verified) | ResNet-50 | CPU supported (verified) | medium: may merge same-coloured neighbours |
| BPR (boundary patches) | yes, per instance | yes | Apache-2.0; no HF | HRNet | mmcv 1.x build on Mac (hypothesis) | medium |
| SegRefiner, CRM, ZIM, BiRefNet | — | — | CRM and RCF are **CC BY-NC**; ZIM's licence conflicts; BiRefNet uses deformable conv (MPS gap, snippet) | — | — | low or blocked |

**Edge evidence.** For the seam's cost:
- **TEED** (MIT, 58 K params, `fal/teed`, verified);
- **DexiNed** (MIT, `kornia/dexined`, verified);
- a classical gradient profile across the axis on the rotated tile, which needs no model.

Avoid PiDiNet ("research purpose" licence, verified) and RCF (CC BY-NC-SA, verified). Spines carry strong internal
edges (title bands), so only edges that run within about 15° of the spine axis and persist along it count
(hypothesis).

### 3.4 Tiling (thread d)

- **SAHI's default merge would repeat F-0e's `extend` failure** (verified, code). The defaults are GREEDYNMM matched
  by intersection over the smaller (IOS) at 0.5. A merge unions both boxes and masks, so a thin spine half inside a
  leaning neighbour's box is swallowed (hypothesis, from that code).
- **StarDist's tiling rule fits** (verified, `stardist/big.py`):
  - every object must be smaller than the overlap;
  - each tile owns only objects clear of its edges;
  - masks are never merged across tiles.

  F-0e's cut-share curve is this rule's prediction.
- **SAM's own paper and HQ-SAM.** SAM's paper concedes it misses fine structures that zoom-in methods catch
  (verified). HQ-SAM raises boundary IoU from 71.1 to 81.8 (verified).
- **No tiling paper gives a pixels-per-object rule for thin objects** (thread d found none). The rule below is a
  hypothesis to measure.

## 4. Design choices behind F-0i

1. **Gate before refining.**
   - **Why:** nested and duplicate masks are most contested pixels. They are cheap to settle by rule, and every one
     settled is a tile the GPU need not run.
   - **How:** intersection over the smaller mask (IoM) replaces IoU, as SAM 3 does.
2. **Re-prompt jointly, not one box at a time.**
   - **What each tile gets:** every member of a conflict group is prompted in one call, on a tile rotated so their
     mean axis is vertical. Each member gets:
     - its oriented box (tight once rotated);
     - positive points at the distance-transform peaks of its exclusive core;
     - negative points on its neighbours' cores.
   - **Owner per pixel:** SAM 2's non-overlap argmax.
   - **Why:** this attacks the measured cause (the prompt) with the model we already run.
3. **Resolution is set by the spine, not by the photo.**
   - **Tile size:** each conflict tile is padded across by max(32 px, 0.3 median widths) and covers the members'
     whole length. It is made square before SAM, never squashed.
   - **Scale:** about 1.7–3.4 times the photo scale, so a median spine is at least about 110 input px (hypothesis:
     thread d's rule, p10 ≥ 64 and p50 ≥ 110 input px; to be measured).
   - **Groups:** a group wider than about 600 px is split at a conflict-free spine.
4. **One owner per book across tiles (StarDist).**
   - A box belongs to the tile that holds it with the largest margin.
   - Masks from different tiles are never unioned. Where tiles overlap, logits are averaged with border-distance
     weights (BPR's and CascadePSP's rule; verified).
5. **Seam, then depth, then fallbacks.** A minimum-cost seam runs along the spine axis inside each two-member
   contested band. Its cost is edge evidence (gradient across the axis; TEED as an arm) plus the two members' logit
   difference. Depth and normals override only where the pair is depth-separated.
   - **Fallbacks, in order:**
     1. a weak seam (no stronger than its surroundings) falls back to logit argmax;
     2. without logits, to a distance-transform split;
     3. score order is the last resort.
6. **Provenance on every boundary.** Each shared boundary segment records:
   - its source: `outline`, `gate`, `tile-argmax`, `seam`, `depth`, `fallback`;
   - the tile id, the affine transform and scale, and the model and checkpoint hash;
   - the prompts, the edge support and the logit margin;
   - the overlap before and after.
7. **Ids are stable.** Box ids are `photo:index`. F-0i never renumbers: a dropped box keeps its id with a reason. So
   caches keyed by id are invalidated only for boxes F-0i changed.
8. **Two passes, two tilings (the owner's split).**
   - **Geometry** (this card): detection's band tiles, then conflict tiles at a spine-set scale. The output is an
     exclusive mask and a refit oriented box per book.
   - **Per-book information** (F-R2): a reader crop per book at reader resolution, cut from the geometry pass's box.
     The crop either keeps neighbour pixels or masks them (an arm, §5).
   - A full detection re-tiling (band-square tiles, per-band straightening from MoGe-2 normals; thread d) is **a later
     card**. It changes every box and invalidates every cache, so it should follow F-0i's measure, not precede it.

## 5. Proposed card F-0i · instance partition

**Goal.** Every visible pixel belongs to at most one book. Measure what that does for readers, and ship the reader
change only if it helps.

**Entry conditions.**
- S-1 has merged and the GPU is free, or the M3 Max has joined the queue (`docs/ops/compute-fleet.md` §10).
- The pre-registration (below, with the thresholds as constants) is committed before the first tile runs.
- F-R2 has named its crop interface, so the `mask=own` arm matches what F-R2 will read.
- Inputs as FR1:
  - `pilot-000`: F-0e's boxes, Q-2b's outlines;
  - yardstick: F-0's B2 boxes, F-0b's outlines;
  - H-2's depth cache.

**Steps.**
1. **Gate** (CPU, no model). On mask IoM and IoU:
   - **Duplicate** (IoU ≥ 0.5, or IoM ≥ 0.85 with an area ratio under 1.3): keep the higher box score × mask score.
   - **Merged parent:** a parent holding two or more children at IoM ≥ 0.8 that cover ≥ 70 % of it is a two-book
     mask, so the parent goes.
   - **One child in a parent:**
     - if the parent's short side is ≤ 1.6 row median widths, the parent is the whole spine and the child (a label
       block, a piece) goes;
     - otherwise the parent is a group: the child stays, and the parent's remainder goes to step 2 as a member to
       re-prompt.
2. **Conflict tiles** (GPU, SAM 2.1 base-plus). Connected groups of the remaining conflicts (partial and bleed), per
   §4.2–4.4. The output is per-member logits, cached by job key.
3. **Resolve** (CPU): argmax inside each tile, the seam in each contested band, the depth override, the fallbacks.
   Then the validity rule:
   - a member keeping under 60 % of its clipped mask is flagged;
   - one keeping under 30 % is dropped as absorbed.

   Each book's oriented box is refit on its exclusive mask.
4. **Provenance and cache.** Under `private/f0i/<set>/`:
   - `partition.jsonl`: per box, its exclusive outline, refit polygon, kept or dropped with a reason;
   - `boundaries.jsonl`: per segment, §4.6's fields;
   - `tiles.jsonl`.

   The repo gets aggregates only.
5. **Readers** (F-0b's procedure, `src/eval/f0b-cli.ts run`). Only boxes whose crop changed are re-read with Vision
   and PP-OCR. F-0's Qwen hard-crop selection is re-run per photo. Arms:
   - **`refit`**: `rect;rot=fixed;clip=frame` on the refit box;
   - **`refit+own`**: the same crop with neighbour-owned pixels filled with the crop's median background. The crop
     method gets a new name (say `rect;rot=fixed;clip=frame;mask=own`), so readings are never mixed.

**Measures** (label-free, as FR1's code).
- **Overlap rate** (the invariant violation): pixels claimed twice ÷ claimed, per set. The target is 0, by
  construction, except where a fallback leaves a pixel unassigned rather than double-claimed.
- **Neighbour pixels in crops:** the share of reader crops with ≥ 10 % neighbour pixels, before and after.
- **Readers:**
  - share at `text-read` and `confirmed` among changed boxes;
  - distinct confirmed works per photo;
  - on the yardstick, title recall, precision and wrong accepts per image.
- **Cost:** tiles per photo, GPU seconds per photo, peak MPS.
- **Provenance mix:** the share of boundary length by source.

**Keep rule** (F-0b's, plus F-0e's guard). These ship as the default only if all hold:

1. **Geometry exit, both sets:** the overlap rate is ≤ 0.5 %, and the share of crops with ≥ 10 % neighbour pixels
   falls, with its interval below 0.
2. **`pilot-000` confirmed:** the confirmed share among changed boxes has an interval that excludes 0 upward.
3. **`pilot-000` works:** distinct confirmed works per photo do not fall (point change ≥ 0).
4. **Yardstick confirmed and wrong accepts:** the confirmed share does not fall beyond its interval, and wrong
   accepts do not rise beyond theirs.
5. **Yardstick titles:** title recall does not fall beyond its interval. This is the guard F-0e's `extend` failed.

If 1 passes and 2–5 fail, the partition still ships as a geometry cache, like H-2's face labels, for U-4, H-2 and
F-0g. The reader crop stays `rect;rot=fixed;clip=frame`.

**Files.**
- **New:**
  - `helpers/label/partition.py`: the tiles, SAM 2.1 with joint prompts, logits out;
  - `helpers/coverage/resolve.py`: the gate, seam, depth override and provenance, on numpy, OpenCV and
    scikit-image (BSD-3; a new lockfile dependency);
  - `src/eval/f0i-cli.ts`;
  - `evals/F0i/`.
- **Changed:**
  - `src/perceive/crop.ts`: a `mask=own` crop variant, off by default;
  - `src/run/job-kinds.ts`: new kinds (§6).
- **Untouched:** `detect.py`, `contracts/`, the default pipeline.

**GPU budget** (hypothesis, from FR1's counts).

| | conflicting pairs after the gate (estimate) | conflict groups | encodes | time |
|---|---:|---:|---:|---:|
| `pilot-000` | about 1,300 (partial + bleed), about 42 a photo | about 20–30 a photo | about 900 | **5–10 min** |
| yardstick | about 145 | about 3–5 a photo | about 160 | **1–2 min** |

- **Per encode:** 0.15–0.4 s for one SAM 2.1 base-plus encode on MPS, plus about 15 ms per prompt set.
- **Readers:** about 1,900 changed `pilot-000` boxes: Vision about 4 min, PP-OCR about 11 min on 3 CPU workers, Qwen
  at most 1,240 crops at about 2 s, about 40 min.
- **Peak MPS:** SAM 2.1 base-plus alone is well under detection's 15 GB (hypothesis: about 4–6 GB), and Qwen is about
  5 GB of weights.

**Caches it invalidates.** Only for boxes F-0i changes or drops, because ids are stable:

| cache | why |
|---|---|
| F-0e readings, F-0c's `base-decisions` | crop changed |
| Q-2b outlines | the partition's exclusive outlines replace them |
| Q-2b table and τ | Q-2b's lesson: τ belongs to a box set and is re-derived, never carried across |
| H-2 faces and the `face3d` subset | per-box face shares are measured inside the box |
| F-0g copy-group evidence | neighbour pairs, sizes and appearance change where boxes are dropped or refit |
| F-0f rows | row membership and lines |
| U-4's study | which outline is drawn |
| S-1 voids | where S-1 derives gaps from spines |

The MoGe-2 depth cache is per photo and stays valid.

## 6. Run plan for two hosts (`bookcase jobs`)

**Today's kinds.** `read-vision` is implemented (`src/run/job-kinds.ts`). `detect`, `read-ppocr`, `read-qwen`,
`render` and `test-suite` are inventoried in `docs/ops/compute-fleet.md` §3 but not yet wrapped.

**Hosts.**
- **Yojimbo** (M4 Pro, 48 GB): always on, but its GPU is held by S-1 and card sessions.
- **The laptop** (M3 Max, 64 GB): nights and idle. It is **not yet joined**; that needs the owner's §10 steps.

**Night rule.** §7 admits a job for unattended night runs only if:
- it has a deterministic success check (output hash, schema, or a pre-registered rule);
- it has no effect outside the owner's machines.

| kind | new? | bound | peak memory (hypothesis unless noted) | per unit | both sets | Yojimbo (48 GB, busy) | laptop (64 GB, nights) | night-admissible |
|---|---|---|---|---|---|---|---|---|
| `overlap-measure` (this card's `overlap.py`) | new | CPU | about 1 GB (a photo's claim count) | 2–5 s a photo (measured here, 71 photos in under 2 min) | 2 min | **yes**, by day | yes | yes: schema plus output hash (deterministic) |
| `depth-stage` (H-2 `stage.py`) | inventory gap | GPU | MoGe-2 ViT-L, about 3–4 GB | 3.2 s a photo (verified, H-2); 0.08 s on a cache hit | cache hits only | yes | yes | yes: H-2's cache check |
| `instance-gate` (step 1) | new | CPU | small | under 1 s a photo | under 2 min | **yes** | yes | yes: deterministic, output hash |
| `refine-tiles` (step 2, SAM 2.1 base-plus) | new | GPU (MPS) | about 4–6 GB | about 10–20 s a photo | 7–12 min | only when the GPU is free (one GPU job per host) | **preferred** | yes: schema, plus a rule that every conflict group has a logit file. MPS output is not bit-exact, so success is the rule, not the hash |
| `partition` (step 3, seam and provenance) | new | CPU | about 1–2 GB | 2–30 s a photo | about 5 min | **yes** | yes | yes: deterministic given the logits, output hash |
| `read-vision` | exists | ANE, light | small | 0.13 s a crop | about 5 min | yes | yes | yes |
| `read-ppocr` | inventory | CPU | 1–2 GB a worker | 1 s a crop | about 11 min on 3 workers | yes (CPU) | yes | yes |
| `read-qwen` (at most 40 hard crops a photo) | inventory | GPU (MLX) | about 5 GB | 1.5–2.5 s a crop | about 40–50 min | contended | **preferred** | yes: the success check is the schema; the go rule is pre-registered, so the arm is night-admissible (§7 row 1) |
| `render` (private before/after pages) | inventory | CPU | small | seconds a photo | minutes | yes | yes | yes ("renders for review in the morning") |
| keep-rule verdict (`f0i-cli.ts analyse`) | — | CPU | small | — | under 1 min | yes | yes | yes: a pre-registered rule; **the merge and default switch stay day-shift** (owner present) |

**Order for one night on the laptop:**
1. `refine-tiles`;
2. `read-qwen`;
3. `render`.

Yojimbo's CPU runs `instance-gate`, `partition`, `read-vision` and `read-ppocr` by day. The morning report
(`bookcase jobs report`) carries only counts and machine-hours.

**If the laptop has not joined:** the whole run fits Yojimbo once S-1 frees the GPU. That is about an hour end to
end, most of it Qwen (hypothesis).

## 7. Re-checked claims

The claims this design rests on were re-opened for this doc in the transformers copy the helpers' uv cache holds:

- **The squash.** SAM 2's processor resizes to `{"height": 1024, "width": 1024}` and normalises box coordinates by
  width and height separately, so non-square tiles are squashed, not padded (verified, `image_processing_sam2.py`,
  `processing_sam2.py`).
- **The non-overlap rule.** `post_process_masks` has `apply_non_overlapping_constraints=False`, which keeps only the
  highest-scoring object at each location (verified).
- **Mask2Former's keep share.** `overlap_mask_area_threshold` defaults to 0.8 (verified).
- **NMS.** `detect.py` suppresses at rotated IoU 0.45, and its `inside` share is 1.01 (verified, code).

## 8. Open questions

- **Is the merged-parent rule safe on face-out covers?** F-0c absorbs spine boxes inside a kept cover, and the gate
  must not undo that. Run the gate after F-0c's kinds, on spines only.
- **Will joint prompts recover books the detector merged?** The merged-parent remainder is re-prompted, but no box
  ground truth exists. A small blind spot check, like H-2's exit (b) protocol, on a fresh session would say.
- **TEED or a classical gradient for the seam?** This is an arm inside F-0i; the default is the classical profile,
  which needs no download.

## Sources

- **Thread notes:** each thread's full notes and link lists are kept outside the repo, with the card group's
  session notes (`fr1-thread-a.md` to `fr1-thread-d.md`), and are summarised above.
- **arXiv:** 2407.19812 (Library Dataset), 1611.07385, 2210.10110, 1904.00853 (SKU-110K), 2511.16719 (SAM 3),
  2003.10152 (SOLOv2), 1801.00868, 2107.06278, 2112.01527, 1903.12473, 2202.06934 (SAHI), 2306.01567 (HQ-SAM),
  2502.06756 (SAMRefiner), 2104.05239 (BPR), 2304.02643 (SAM), 2003.09163 (CrowdDet), 1704.04503 (Soft-NMS).
- **Code:**
  - https://github.com/facebookresearch/sam2
  - https://github.com/facebookresearch/detectron2 (`panoptic_fpn.py`)
  - https://github.com/huggingface/transformers (`sam2`, `mask2former`)
  - https://github.com/stardist/stardist (`big.py`)
  - https://github.com/obss/sahi
  - https://github.com/SysCV/sam-hq
  - https://github.com/linyq2117/SAMRefiner
  - https://github.com/hkchengrex/CascadePSP
  - https://github.com/xavysp/TEED
  - https://github.com/apple/ml-depth-pro (`boundary_metrics.py`)
  - https://github.com/llabres/library-dataset
- **Hugging Face:**
  - https://huggingface.co/facebook/sam2.1-hiera-base-plus
  - https://huggingface.co/lkeab/hq-sam
  - https://huggingface.co/syscv-community/sam-hq-vit-base
  - https://huggingface.co/hkchengrex/CascadePSP-onnx
  - https://huggingface.co/fal/teed
  - https://huggingface.co/kornia/dexined
  - https://huggingface.co/facebook/sam3 (gated)
  - https://huggingface.co/Ruicheng/moge-2-vitl-normal
