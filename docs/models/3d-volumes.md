# 3D book volumes: open-weight survey and spike (H-1)

Checked 2026-11-03 by card H-1 (`claude/h1-book-volumes`).

**Question.** 2D spine boxes forced onto a 3D scene "over-select": a box takes in the spine *plus* a receding cover
and, on low rows, the book's top (owner, 2026-11-03). Which open-weight approaches on Hugging Face can infer book
faces, depth or cuboids from shelf photos? Which can extend the existing detection and segmentation into 3D, for a
more robust and more striking overlay?

**Answer, in short.**

- **Recommendation: extend the existing stack; don't replace it.** Add one monocular geometry model beside
  detection. **MoGe-2 ViT-L with the normal head** ([`Ruicheng/moge-2-vitl-normal`](https://huggingface.co/Ruicheng/moge-2-vitl-normal))
  is MIT-licensed, ungated, 1.3 GB, and runs on MPS in about 2 s a photo. From its normals and point map, a few
  hundred lines of plane geometry split each detected box into a spine face and other faces, trim it, and fit a
  book cuboid. Detection stays as it is: boxes from F-0e, outlines from SAM.
- **The spike says it is worth a build card** ([`evals/H1/report.md`](../../evals/H1/report.md)):
  - **49 % (46–53 %) of `pilot-000` boxes over-select**: **74 % below eye level**, mostly top faces, and 15–20 %
    elsewhere, mostly covers.
  - Trimming to the spine face is feasible for 58 % of the boxes that over-select.
  - A blind spot check of 60 boxes agreed with the face split on 47 of the 53 it could judge.
  - Book cuboids can be drawn, but their depth and metric scale are weak from one still.
- **Not yet:** monocular 3D box detectors (Cube R-CNN, OVMono3D, 3D-MOOD), SAM 3D Objects, and diffusion
  normal models. **Next for "many angles":** MapAnything (Apache-2.0 variant) or Depth Anything 3 (Base, Apache-2.0)
  on a sweep, once a multi-view capture of one shelf exists.
- **No owner action is needed** for the recommended path. Only optional models are gated or large: SAM 3D Objects
  (gated, SAM License, 13.1 GB) and VGGT-1B-Commercial (gated, 10.1 GB). Neither was downloaded.

## 1. Method and evidence labels

- Metadata came from the Hugging Face API (`/api/models/<repo>?blobs=true`: `gated`, `license:` tag, file sizes),
  as in H-0 ([`open-weights.md`](open-weights.md) §1). Sizes are the weight files listed in decimal MB. Where a
  repo stores one model in several formats or precisions, that total over-counts the download (marked *repo
  total*).
- Model cards (`README.md` front matter) were read from Hugging Face, and READMEs or LICENCE files from the
  official GitHub repos, by `curl`.
- Labels follow H-0:
  - **verified**: read by this card from the fetched page or JSON;
  - **snippet**: seen only in a search result, or the card's general knowledge, not re-read;
  - **hypothesis**: this card's inference, not measured (INV-17);
  - **UNVERIFIED**: could not be read.
- Licence readings are this card's reading of the text, not legal advice. As in H-0, "AGPL OK?" means: may AGPL-3.0
  code load these weights locally, from `$BOOKCASE_DATA/models/`, never redistributed?
- **No model has a published result on book spines or shelves.** Every "fit" cell below is a hypothesis, except
  where the spike measured it (MoGe-2).

## 2. Survey

### 2.1 Monocular depth and normals (family 1)

| model | repo | licence (label) | AGPL OK? | gated | weights | Apple silicon | runtime | maturity | fit: thin, close-packed cuboids |
|---|---|---|---|---|---|---|---|---|---|
| **MoGe-2 ViT-L + normals** (also ViT-B, ViT-S) | [`Ruicheng/moge-2-vitl-normal`](https://huggingface.co/Ruicheng/moge-2-vitl-normal) | MIT tag (verified); code MIT, DINOv2 part Apache-2.0 ([README](https://github.com/microsoft/MoGe), verified) | Yes | no (verified) | 1,324 MB (ViT-B 419, ViT-S 141) (verified) | **MPS works**: measured 1.95 s a photo at 2048 px. MoGe v3's main branch adds CUDA-only kernels, so the v2 commit is pinned (verified) | measured | MoGe-2 paper and demo; normals in the same pass (verified, README) | **Measured: good.** Spine faces, top faces and receding covers separate cleanly in the normal map; the per-band spine plane is flat to about 2.4 cm. Metric scale looks about 20–25 % high on one photo (*hypothesis*) |
| Depth Anything 3 Metric-Large / Mono-Large | [`depth-anything/DA3METRIC-LARGE`](https://huggingface.co/depth-anything/DA3METRIC-LARGE), [`…/DA3MONO-LARGE`](https://huggingface.co/depth-anything/DA3MONO-LARGE) | apache-2.0 tag, and "Apache 2.0" in the GitHub table (verified) | Yes | no (verified) | 1,337 MB each (verified) | Own package (`depth_anything_3`), xformers in the install line (verified); MPS UNVERIFIED | — | Nov 2025, widely downloaded (verified) | Depth only, no normal head: normals would come from depth gradients, noisier at spine edges (*hypothesis*). The best Apache-2.0 alternative to MoGe-2 |
| Depth Anything 3 Large-1.1 / Giant / Nested | [`depth-anything/DA3-LARGE-1.1`](https://huggingface.co/depth-anything/DA3-LARGE-1.1) | **Conflict:** HF tag and card say apache-2.0 for Large-1.1, the GitHub table says CC BY-NC 4.0 (verified, both). Giant and Nested: CC BY-NC 4.0 (verified) | **Flag** (take the stricter reading) | no | 1,644 MB; Giant 5,423; Nested 6,760 (verified) | as above | — | as above | Multi-view, see §2.3 |
| Depth Anything V2 Small / Base / Large | [`depth-anything/Depth-Anything-V2-Small-hf`](https://huggingface.co/depth-anything/Depth-Anything-V2-Small-hf) | Small apache-2.0; Base and Large cc-by-nc-4.0 (verified); Metric-Indoor variants have no tag (verified) | Small yes; Base and Large **no** | no | 99 / 390 / 1,341 MB (verified) | transformers, MPS likely (*hypothesis*); Core ML port of Small: [`apple/coreml-depth-anything-v2-small`](https://huggingface.co/apple/coreml-depth-anything-v2-small), apache-2.0 (verified) | — | mature | Relative disparity, no normals. Small is the on-device fallback (§2.5) |
| Depth Pro | [`apple/DepthPro-hf`](https://huggingface.co/apple/DepthPro-hf) | HF tag `apple-amlr`; card says "Apple-ASCL" (verified, both). The weights' licence text is not in the repo (UNVERIFIED) | **Flag** | no | 1,904 MB (verified) | transformers | — | mature | Sharp metric depth and its own focal estimate; no normals. Not needed while MoGe-2 is MIT |
| Metric3D v2 | [`JUGGHM/Metric3D`](https://huggingface.co/JUGGHM/Metric3D) | GitHub LICENSE BSD-2-Clause (verified); HF repo has no tag (verified); ONNX ports tagged cc0-1.0 (verified, search API) | Yes for the code; weights' terms not stated (*hypothesis*: BSD-2) | no | 8,246 MB *repo total*, 5 checkpoints (verified) | mmcv-style code, CUDA-first (*snippet*) | — | 2024, normals and depth | A viable normals alternative, with heavier tooling |
| UniDepth v2 | [`lpiccinelli/unidepth-v2-vitl14`](https://huggingface.co/lpiccinelli/unidepth-v2-vitl14) | GitHub LICENSE CC BY-NC 4.0 (verified); HF no tag (verified) | **No** | no | 2,831 MB *repo total* (verified) | — | — | — | Excluded on licence |
| Marigold depth / normals v1-1 | [`prs-eth/marigold-normals-v1-1`](https://huggingface.co/prs-eth/marigold-normals-v1-1) | openrail++ (verified) | Flag (use-based restrictions, *snippet*) | no | 15,481 MB *repo total* (verified) | diffusers | Diffusion, several steps a photo (*hypothesis*: tens of seconds) | mature | Sharp normals, but slow and over the 5 GB cap as a repo |
| StableNormal / Lotus normal | [`Stable-X/stable-normal-v0-1`](https://huggingface.co/Stable-X/stable-normal-v0-1), [`jingheya/lotus-normal-g-v1-1`](https://huggingface.co/jingheya/lotus-normal-g-v1-1) | apache-2.0 (verified) | Yes | no | 12,175 *repo total* / 4,319 MB (verified) | diffusers | diffusion (*hypothesis*: slow) | research | Normals only, no metric points; not needed with MoGe-2 |

**Can depth plus normals split a spine face from a receding cover or top face? Yes (measured).** In the normal
map the three faces fall into clean clusters: toward the camera, up, and along the shelf. The angle to a per-band
spine plane classifies them. Depth adds a fourth class, "behind" (back wall, gaps), which normals alone miss
because the back wall faces the camera too. On the owner's example 24 % of the pixels in boxes below eye level are
top faces (`evals/H1`).

### 2.2 Monocular 3D boxes (family 2)

| model | repo | licence (label) | AGPL OK? | gated | weights | Apple silicon | maturity | fit |
|---|---|---|---|---|---|---|---|---|
| Cube R-CNN (Omni3D) | [github.com/facebookresearch/omni3d](https://github.com/facebookresearch/omni3d) (not on HF under that name) | CC-BY-NC 4.0 ([README](https://github.com/facebookresearch/omni3d), verified) | **No** | — | UNVERIFIED | detectron2, CUDA (*snippet*) | 2023 | One box per object from a category list; Omni3D's indoor sets include books, but as loose objects, not packed spines (*hypothesis*) |
| OVMono3D | [`uva-cv-lab/ovmono3d_lift`](https://huggingface.co/uva-cv-lab/ovmono3d_lift) | apache-2.0 tag (verified); trained on Omni3D (verified, [README](https://github.com/UVA-Computer-Vision-Lab/ovmono3d)), whose data terms are not stated there (UNVERIFIED) | Flag (training-data terms) | no | UNVERIFIED | CUDA 12.1 (verified, README) | research | "Lifts" 2D boxes to 3D using depth and intrinsics. The README warns that in-the-wild results may be poor (verified). Our boxes plus MoGe-2 already give that lift, with a shelf-plane prior it lacks (*hypothesis*) |
| 3D-MOOD | [`RoyYang0714/3D-MOOD`](https://huggingface.co/RoyYang0714/3D-MOOD) | apache-2.0 tag (verified) | Yes (tag) | no | UNVERIFIED | UNVERIFIED | research | Open-set monocular 3D detection; not tested on dense small objects (*hypothesis*) |
| DetAny3D | not found on HF (search API, verified) | UNVERIFIED | — | — | — | — | research | — |
| **SAM 3D Objects** | [`facebook/sam-3d-objects`](https://huggingface.co/facebook/sam-3d-objects) | SAM License (verified, [README](https://github.com/facebookresearch/sam-3d-objects)); HF `license:other` | Flag, as SAM 3 (H-0) | **manual** (verified) | 13,106 MB *repo total* (verified) | CUDA-first (*hypothesis*) | Nov 2025 | Reconstructs shape, texture and layout for **one masked object** a call (verified, README). That's 40–200 calls a photo, and it hallucinates the hidden parts of a thin book. A "wow" demo for one face-out cover, not a shelf tool (*hypothesis*). Over the 5 GB cap and gated: owner action if ever wanted |

**Verdict: not yet.** None of these knows that books are thin cuboids standing on a known plane, packed side by
side. The spike's explicit geometry does: a shelf plane, a spine plane and an up direction, with each spine face
fitted inside them. A learned 3D box detector would also replace boxes that F-0e has already tuned.

### 2.3 Multi-view reconstruction (family 3: the owner's "many angles")

| model | repo | licence (label) | AGPL OK? | gated | weights | Apple silicon | fit |
|---|---|---|---|---|---|---|---|
| **MapAnything (Apache variant)** | [`facebook/map-anything-apache`](https://huggingface.co/facebook/map-anything-apache) | apache-2.0 (verified, card) | Yes | no (verified) | 4,914 MB (verified) | UNVERIFIED; README profiles GPU memory against view count (verified) | Feed-forward metric multi-view geometry: poses, depth and point maps from N images, plus depth completion (verified, card). The best licence fit for a sweep (*hypothesis*). At the 5 GB cap |
| MapAnything (default) | [`facebook/map-anything`](https://huggingface.co/facebook/map-anything) | cc-by-nc-4.0 (verified) | **No** | no | 4,914 MB | — | Use the Apache variant |
| Depth Anything 3 Base / Small (any-view) | [`depth-anything/DA3-BASE`](https://huggingface.co/depth-anything/DA3-BASE) | apache-2.0 (verified, tag and GitHub table) | Yes | no | 542 / 137 MB (verified) | own package; MPS UNVERIFIED | Multi-view depth and pose in one small model; "comparable to VGGT" is claimed for Large, not Base (verified, README). A cheap first try on a sweep |
| VGGT-1B / VGGT-1B-Commercial | [`facebook/VGGT-1B`](https://huggingface.co/facebook/VGGT-1B), [`…-Commercial`](https://huggingface.co/facebook/VGGT-1B-Commercial) | cc-by-nc-4.0; Commercial: `license:other`, **manual gate**; README: only that checkpoint allows commercial use (verified) | No / flag | Commercial: manual | 10,053 MB each *repo total* (verified) | — | Strong, but gated and over the cap |
| π3 / Pi3X | [`yyfz233/Pi3`](https://huggingface.co/yyfz233/Pi3), [`…/Pi3X`](https://huggingface.co/yyfz233/Pi3X) | Pi3: bsd-2-clause tag, but the card says academic use, "for commercial use, please contact the authors" (verified). Pi3X: cc-by-nc-4.0 (verified) | **Flag** / no | no | 3,835 / 5,440 MB (verified) | — | Excluded on licence |
| DUSt3R / MASt3R | [`naver/MASt3R_ViTLarge_BaseDecoder_512_catmlpdpt_metric`](https://huggingface.co/naver/MASt3R_ViTLarge_BaseDecoder_512_catmlpdpt_metric) | CC BY-NC-SA 4.0 plus training-data terms (verified, card) | **No** | no | 2,755 MB (verified) | — | Excluded on licence |
| Fast3R | [`jedyang97/Fast3R_ViT_Large_512`](https://huggingface.co/jedyang97/Fast3R_ViT_Large_512) | `license:other` (verified), text not read (UNVERIFIED) | Flag | no | 2,590 MB (verified) | — | — |
| Gaussian splatting (gsplat, OpenSplat, Brush) and Apple Object Capture (`PhotogrammetrySession` on macOS) | GitHub / Apple SDK | gsplat Apache-2.0, OpenSplat AGPL-3.0 (*snippet*) | Yes (*snippet*) | — | — | OpenSplat and Object Capture target Apple GPUs (*snippet*) | Needs posed views (from MapAnything or DA3). A splat or a mesh of a whole shelf is the most striking render, but it doesn't give per-book volumes without the same per-spine segmentation (*hypothesis*) |

**Verdict: the right path for "many angles", but it can't be tested yet.** `pilot-000` has no repeated views of
one shelf. The cheapest test is a burst of 5–10 stills of one shelf, or a guided sweep (T-9), run through
MapAnything-apache or DA3-Base. Each book's cuboid then gets its depth from the side it shows in an angled view,
which a single still can't give (finding 6 in `evals/H1`).

### 2.4 Planes and classical geometry (family 4)

No plane-segmentation model was found on Hugging Face under a usable licence (search API: "plane",
"planerecTR", verified). None is needed. The spike's geometry is the classical approach, driven by MoGe-2's
normals:

- a spine plane per shelf band (the mode of its boxes' normals), with a fallback plane for boxes on a side case;
- an up direction from horizontal surfaces (shelf tops and book tops), found in 383 of 428 frames on `pilot-000`;
- the shelf's side direction as their cross product.

These three directions are the scene's vanishing directions. They are the same quantities F-0f estimates from
lines for its per-row perspective, so the two can check each other (*hypothesis*).

### 2.5 On device (family 5, the live path, T-7a: for later)

- **iPhone Pro LiDAR through ARKit scene depth**, plus ARKit's vertical and horizontal plane anchors, would give
  the shelf and spine planes, and metric scale, live and free (*snippet*: LiDAR depth runs at a low resolution
  such as 256 × 192, at frame rate). That fixes the spike's weakest part, metric scale and book depth. The
  normals-based face split needs finer detail than LiDAR gives, so it would still come from a model or from the
  plane fit (*hypothesis*).
- **On-device model:** Depth Anything V2 Small as Core ML (apache-2.0, 289 MB *repo total*, verified) for relative
  depth. MoGe-2 ViT-S (141 MB, MIT) would be a candidate for a Core ML conversion (*hypothesis*, not tried).

## 3. What the spike showed

Full results: [`evals/H1/report.md`](../../evals/H1/report.md). The run used 31 `pilot-000` photos, F-0e boxes and
MoGe-2. Every figure is machine measurement, not accuracy.

- **Over-selection is common and follows the geometry.**
  - 49.2 % (46.4–52.7) of boxes over-select.
  - Below eye level it's 74.5 % (71.5–77.8), with 18.8 % of box pixels on top faces.
  - Level and above, it's 15–20 %, almost all receding covers.
  - On the owner's example it's 51.7 % overall and 88.9 % below eye level.
- **Face splitting works.**
  - In a blind spot check of 60 random boxes (by the agent, not the owner), 47 of the 53 judged agree.
  - Of the flagged boxes, 33 of 35 really take in a top, cover or background.
  - The errors: a book lying tilted (its own spine read as a cover), a dim corner, and small extras under the cut.
- **Trimming works for most over-selecting boxes**: 57.7 % (53.4–61.5) are feasible, keeping a median 75 % of the
  box. On the owner's example the trims stop at each book's top edge on the low rows.
- **Cuboids render, but depth from one still is short**: a median of 8.2 cm where books run 13–24 cm. Metric scale
  is unverified. Good enough for a drawn volume once a band's depth is borrowed; not good enough to measure books.
- **Cost:** 1.3 GB of weights, about 2 s a photo on MPS plus about 1.3 s on CPU. That is small next to detection.

## 4. How it would plug into detection

1. **Trim boxes to the spine face** (after detection, not inside `detect.py`). For each F-0e box, keep the trimmed
   rectangle when the trim is feasible and the box over-selects, and record the cut-off faces. This is the
   narrower, plane-aware face trim F-0b asked for (F-0b, "what to try next" 2). It removes a top face only where
   the normals show one, rather than wherever a mask bulges. It must pass F-0b's keep rule before it reaches the
   readers: F-0b's mask-based trim raised matches but cost text.
2. **Label every face.** Each box carries its `front`, `top`, `cover` and `behind` shares. Uses:
   - F-0c's not-a-book flag: a box that is mostly "behind" or "cover" is the case's side or a gap;
   - Q-2's top seam, which can't tell a top face from a cut spine (finding 7);
   - U-4's `user-glow`, which can hug the spine face and, in a "volume" variant, light the visible top face as a
     second, dimmer facet: the "wow" the owner asked for, from data we already have.
3. **Cuboid tracks for the live overlay.** A band's frame (spine plane, up, side) changes slowly across frames,
   so a book cuboid is a spine-face quad plus a depth, anchored to a stable track (T-0). Live, ARKit planes and
   LiDAR would supply the frame and the scale, and MoGe-2 (or a small Core ML model) the face split. In a guided
   sweep, multi-view (§2.3) fills in book depth from the angled views.

## 5. Proposed build card: H-2 · spine-face trim and face labels

- **Entry:**
  - H-1 merged.
  - F-0f's perspective and top-edge changes merged, because they touch the same top ends. H-2 runs on F-0f's
    boxes and compares its planes with F-0f's vanishing points.
  - Q-2b's outlines available.
  - GPU slot shared at modest concurrency.
- **Work:**
  - Promote `helpers/depth` from spike to a stage: cached geometry per working copy, keyed by model revision
    (INV-14).
  - Add a `face3d` crop method (`src/perceive/crop.ts`) using the feasible trim.
  - Add face shares to the per-spine record, as an optional field behind a contract change reviewed by L-1's
    owner. Not in this card.
  - Add a `user-glow-volume` display variant.
- **Exit:**
  - (a) On `pilot-000`, F-0b's keep rule for `face3d` against the shipped `clip=frame` crop: the confirmed-share
    interval excludes 0 upward, and the yardstick's confirmed share does not fall and wrong accepts do not rise,
    beyond their intervals.
  - (b) A fixed-before-run spot check on a *fresh* real-use session (not `pilot-000`) agrees on at least 85 % of
    judged boxes.
  - (c) Geometry plus faces take at most 5 s a photo on MPS.
  - (d) The owner approves the volume variant on the private still study.
  - If (a) fails, the face labels and the display variant still ship, and the reader crop stays off.
- **Later (H-3, multi-view):** on a burst or sweep of one shelf, compare book depth from MapAnything-apache or
  DA3-Base with the single-still depth, and render per-book cuboids. Needs a capture and a 4.9 GB download at the
  cap (owner's nod).

## 6. Downloads and owner actions

| item | repo | size | licence | gated | status |
|---|---|---|---|---|---|
| MoGe-2 ViT-L normal | [`Ruicheng/moge-2-vitl-normal`](https://huggingface.co/Ruicheng/moge-2-vitl-normal) @ `cb0e8bb` | 1,324 MB | MIT | no | **Downloaded** to `$BOOKCASE_DATA/models/moge-2-vitl-normal/` (official repo, pinned revision) |
| SAM 3D Objects | [`facebook/sam-3d-objects`](https://huggingface.co/facebook/sam-3d-objects) | 13,106 MB *repo total* | SAM License | **manual** | Not downloaded: gated and over the 5 GB cap. Owner action only if a single-object demo is wanted. Not recommended now |
| VGGT-1B-Commercial | [`facebook/VGGT-1B-Commercial`](https://huggingface.co/facebook/VGGT-1B-Commercial) | 10,053 MB *repo total* | other | **manual** | Not downloaded. MapAnything-apache covers the same need, ungated |
| MapAnything (Apache) | [`facebook/map-anything-apache`](https://huggingface.co/facebook/map-anything-apache) | 4,914 MB | Apache-2.0 | no | Not downloaded: no multi-view data yet (H-3) |

The code installs MoGe from its official GitHub repo at commit `b942f00` (MIT; the last v2 commit) into
`helpers/depth/.venv`. Weights are never fetched by the code and never committed.

## 7. What this card does not settle

- Whether a normals-based trim helps the readers: that is H-2's exit (a).
- Metric scale and book depth from one still. A known reference, LiDAR or multi-view would settle them.
- Whether the face split holds on a fresh session. Every number here is from the `pilot-000` dev set, and the
  per-box plane fallback was added after looking at it.
- The licence conflict on Depth Anything 3 Large-1.1 (HF says Apache-2.0, GitHub says CC BY-NC 4.0). It doesn't
  matter while MoGe-2 is the pick.

## 8. H-2: the depth stage, face shares and the `face3d` crop

Card H-2 built §5's card. Results: [`evals/H2/report.md`](../../evals/H2/report.md); the keep rule was
committed before the first reader run.

**The depth stage** (`helpers/depth/stage.py`, [README](../../helpers/depth/README.md)). Geometry per photo
and faces per box are each looked up in a cache before they are computed. The geometry key covers the model id,
its revision and weight hash, the MoGe code commit, the geometry code, the long side, the field of view and the
working copy's hash. The faces key covers the geometry key, the face code and the photo's boxes and bands. A re-run
is all cache hits. New boxes re-run only the face split (about 1 s a photo on the CPU); a new model revision
re-runs both. The cache holds the point map, normals and mask per photo, and per box the face-split rows, band
frames and a class map: what S-1 (shelf structure and voids) needs for gaps and shelf planes. It sits under the data
root's `private/h2/cache/`. On `pilot-000` the stage reproduces H-1's face split exactly, on all 6,145 boxes.

**Face shares per box.** For each default box after the shipped not-a-book filter (F-0e `bands+strips` on
`pilot-000`; F-0's B2 on the yardstick), the private file `private/h2/<set>/faces.jsonl` holds:

- the six shares;
- whether the box over-selects and whether its trim is feasible;
- the trim (where both hold);
- the visible top face;
- the elevation and the plane fallback.

**Proposed contract field (not in this card: `contracts/` is not edited).** An optional `faces` object on
`SpineObserved`, for a contract card that L-1's owner reviews:

```jsonc
"faces": {
  "model": { "id": "Ruicheng/moge-2-vitl-normal", "revision": "cb0e8bb…", "code": "<faces.py hash>" },
  "shares": { "front": 0.71, "edge": 0.06, "top": 0.19, "under": 0, "cover": 0.04, "behind": 0 }, // sum to 1
  "overSelects": true,          // top + under + cover + behind ≥ 0.15 of the box (H-1)
  "trim": [[x, y], …4],         // working-copy pixels; present only when the trim is feasible
  "topFace": [[x, y], …4] | null // the cuboid's top where the camera sees it (display only)
}
```

- Shares are machine measurements, never accuracy (INV-17).
- The `model` triple is the replay pin (INV-14).
- No pixels and no text are recorded (OC9).
