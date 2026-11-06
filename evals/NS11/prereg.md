# NS11: mono-geometry student distilled from MoGe-2 — pre-registration

Fixed 2026-11-05, before the teacher table is built and before any student is trained. **No measurement was taken for
this card.** No student weight exists, no target table exists, and the only numbers below are ones already in the
repository (H-2's counts and timing) or choices made here. The trainer, the table builder and the scorer are specified
here, not built. Nothing below changes after seeing a result. **A later change is a deviation: it is logged under
`## Deviations` in `implementation-notes.md` and named in `report.md` with the figures it touches.** Every threshold is a
*hypothesis*, a choice with no measurement behind it (INV-17). Every figure the card reports is **agreement with a named
teacher**, which is itself a machine output with no ground truth under it: never accuracy on real use (OC36).

**Question.** Can a small model that sees only the RGB pixels of one detected box (and the box's own outline) reproduce,
for that box, the three face shares and the mean surface normal that MoGe-2 computes from the whole photo, well enough
to beat a trivial constant that already knows the shelf's average? The student is a candidate for the on-device loop
(NS-12) and for the viewing-angle coverage signal (S-L6, `docs/capture/coverage.md`). The go rule for any claim of lift on
held-out degraded-tier sessions is `evals/NS5/prereg.md` (commit 9341c63, the owner's picks of 2026-11-05).
This is a **development run**: it builds and measures the pipeline so the caches, the registry record and the Core ML
export exist when NS-3's sweeps and the non-Pro sessions arrive. It decides no lift claim.

## 1. Teacher

- **Model.** `Ruicheng/moge-2-vitl-normal` (MIT) at Hugging Face revision `cb0e8bbd6b1e243589717c78e750b1ba4c093acf`
  (weights sha256 `280741fd09bc3f403ccff9967784c2a391b52d2c0742ae3efdb21d9f90cc1a01`), MoGe code commit
  `b942f00bdc2a2a23ebb474fbe034d487e6dcceec`, long side 2048, field of view from EXIF where the working copy is a full
  sensor frame (`stage.py --exif-fov`, as H-2 ran it). Its outputs are a **label generator**, never a model input (OC38).
- **Face classes.** `helpers/depth/faces.py`, sha256
  `fec353c222d34a52ca88907de986779912a9615722e7a2b75237e35ddef78ed4` (and `geometry.py`
  `40c3d2a655bc5b7e5be5c988263844672ce44d568550d1a163e32c736e2dc40d`). Each box pixel is classed front, edge, top, under,
  cover or behind against its shelf band's frame. This card does not change either file.
- **No new teacher runs.** The targets are read from H-2's caches (`private/h2/cache/`, per photo a geometry `.npz` and a
  faces `.json`, keyed as `helpers/depth/README.md` says) and from H-2's per-box files (`faces.jsonl`, `stage-latest.jsonl`)
  of both sets. If a photo's cache entry is missing, the card runs the existing `helpers/depth/stage.py` unchanged on that
  photo, and says so in the report (count and reason). Any such run is a deviation.
- **Labels.** Every target row carries `labelSource: mono-geometry` and `rgbRecoverable: yes`: MoGe-2 computed the label
  from RGB alone, so a model that sees RGB could in principle recover it (NS-4, NS-5 §5).

## 2. Sets, boxes and splits

- **Sets.**
  - `pilot-000` (role `training-source`): 31 real-use stills, 5,757 kept boxes (RB-1's box set as H-2 measured it), all
    `deviceClass: metric-depth` by device check, `captureMode: shopper-still`, no case ids (`caseId` null).
  - The public yardstick `yardstick-library-b2` (role `yardstick`, **PROXY**): 40 stills, 1,038 kept boxes. **Never trained
    on, never used to choose anything** (OC35; the run asserts both roles through `src/eval/set-roles.ts`, and refuses to
    start if the yardstick appears on the training side). It is an evaluation set only.
- **Box set.** The boxes of H-2's `faces.jsonl` for each set (the kept boxes), minus the rows described next. A box is
  **admitted** when its `skip` is null and its **three-way mass** is at least 0.5, where the mass is
  (front + top + cover) pixels over all of the box's pixels. A box below 0.5 is mostly edge, under or behind pixels, and
  its three-way distribution would be a ratio of a few pixels. The admitted count, the excluded count and the reasons are
  reported (counts only).
- **Split groups (pilot-000).** F-1's split groups from the ledger manifest `v-f495741be2c5`: six groups of 6, 13, 5, 2, 3
  and 2 stills. In this set each split group equals one capture group (a stand within 120 s; NS10's prereg records the
  same). The frozen split puts four groups (24 stills) in `train` and two (7 stills) in `val`. `pilot-000` has no case
  ids, so the **split group stands in for the case**, as NS10 did (a stand-in; logged as a deviation). A split group is
  never divided: **no photo is in both a training and a held-out side, and no split group is in both.**
- **Yardstick groups.** The yardstick has no F-1 split groups; its unit for baselines and intervals is the **photo**.

## 3. Student

- **Family and size.** One architecture, **GeometryStudentNet**: a ResNet-style convolutional network, trained **from
  scratch**. No base checkpoint is used or fetched (every pretrained model under `$BOOKCASE_DATA/models/` is more than
  ten times the size cap). Stem: 3×3 convolution, 24 channels, stride 2. Four stages of two basic residual blocks with 24,
  48, 96 and 192 channels, stride 2 at the start of stages two to four; batch normalisation and ReLU; global average
  pooling. A geometry branch of two 32-unit layers over the 12 numbers below, concatenated with the pooled image
  features, then one 128-unit layer and two linear heads (3 face logits; a 3-vector, normalised to unit length, for the
  normal). **Ceiling: under 10 million parameters.** The exact count is measured and recorded in the registry record; I
  expect it near 1.5 million, which is an estimate, not a measurement.
- **Input.** (a) The box's **crop**: the axis-aligned rectangle around the box's outline (the detector's polygon in the
  working copy), grown by 20 % of its sides, clamped to the photo, **letterboxed** to 128×128 (aspect kept, zero padding
  after standardisation). (b) The box's **geometry vector**, 12 numbers from the detection alone: centre x and y over the
  photo's width and height; rectangle width and height over the photo's long side; the outline's long and short side over
  the photo's long side; sine and cosine of twice the long axis's angle; log of long over short; the `cut` flag; the
  photo's width over its height; the grown rectangle's width over its height. **No band id, no elevation, no depth, no
  teacher output enters as an input** (OC38). The geometry vector is a function of the detection's outline, which any
  device tier produces.
- **Hardware.** Training on MPS; the evaluation of the trained weights on MPS (batch) and a single-image measurement on
  the Mac (section 6). Nothing runs on Yuri.

## 4. Targets, loss and recipe

- **Face shares.** Per box a 3-way distribution over (**spine**, **top**, **cover**) = (front, top, cover) pixel counts of
  `faces.py`, each over their sum. Edge, under and behind pixels are left out of the distribution (they are in the
  mass filter of section 2). The student's face head is a softmax over three logits.
- **Mean normal.** Per box the unit vector along the **mean of the MoGe-2 normals over the box's valid pixels**, in the
  **camera frame** (OpenCV axes: x right, y down, z forward). The pixels are exactly `faces.py`'s: the box outline
  scaled to the map, eroded by one pixel, intersected with the valid mask (finite points and normals). The table builder
  imports `box_mask` from `faces.py` read-only. The student's normal head is normalised to unit length.
- **Loss.** For each box, the sum of (a) the Kullback–Leibler divergence from the teacher's 3-way distribution to the
  student's softmax, and (b) `1 − cos` between the student's unit normal and the teacher's mean normal. Equal weight on
  the two terms; equal weight on every box.
- **Recipe, fixed now, never tuned on any held-out data.** AdamW, peak learning rate 0.002, weight decay 0.0001, batch
  size 64, 40 epochs, a 2-epoch linear warm-up then cosine decay to zero; the **final-epoch weights** are the ones scored
  (no early stopping, no checkpoint picking). Augmentation: brightness and contrast scaling within ±20 %; a random
  resized crop of 90–100 % of the 128×128 crop with the geometry vector unchanged; no flips (a flip would change the sign
  of the normal's x component and the meaning of top and cover). Seed 20261105 (as NS5's bootstrap).
- **Declared scheme (NS-5 §5).** The scheme is `drop-unrecoverable`. The training set's rows by `labelSource` ×
  `rgbRecoverable` will be reported before the first step as: every row `mono-geometry` × `yes`, none in the weighted
  cells, so the scheme removes nothing. There is no `single-view` label for these targets, so NS-5 §1's
  no-privileged-information arm **does not exist for this card**; the trivial baselines of section 5 stand in for it
  in this development run and are not that arm.

## 5. Runs, measures and the development keep rule

**Runs** (all with the recipe above, one seed each unless stated):

- **Leave-one-split-group-out (LOGO).** Six models; each trains on the five other split groups of `pilot-000` and predicts
  the held-out group's boxes. The union of the six held-out predictions covers all 5,757 (admitted) boxes, each predicted
  by a model that never saw its photo or its split group. **The development keep rule is scored on these.** The reason:
  the frozen split's validation holds **two** groups, and a bootstrap over two groups has three distinct resamples and
  no information; six groups is the least that can carry an interval.
- **Frozen split (the artifact).** One model trained on the four frozen `train` groups, scored on the two frozen `val`
  groups and on the yardstick. This is the weight that is exported to Core ML and registered. Its recipe is repeated with
  two more seeds (20261106, 20261107), reported for spread; the registered artifact is the seed 20261105 run.

**Baselines (trivial, per box prediction).**

- **Per-split-group mean** (the development baseline): every box of a held-out split group gets that group's own mean
  3-way distribution and that group's own unit mean normal, taken over the group's teacher targets. It is an **oracle
  constant**: it knows the stand's average, which the student does not, so beating it takes per-box information.
- **Training mean** (secondary, reported): the mean target of the training groups; what a model that learned only the
  average would predict.
- On the yardstick: the **per-photo mean** (oracle constant, the unit being the photo) and the `pilot-000` training mean.

**Measures** (per box, then as distributions; teacher agreement, not accuracy):

1. **Face-class agreement, top-1:** the share of boxes whose argmax of (spine, top, cover) is the teacher's. Reported
   with each class's recall, because the spine class dominates (counts of boxes by teacher class are reported).
2. **Mean absolute share error:** `(1/3) Σ |student_c − teacher_c|` over the three classes, per box.
3. **Normal angular error:** the angle in degrees between the student's and the teacher's mean normal, per box.

Each is reported as a distribution over boxes (10th, 25th, 50th, 75th, 90th and 99th percentiles, and the mean), and as
a per-group table (one row per split group, groups unnamed: g1 to g6), with **95 % percentile bootstrap intervals over
split groups** (2,000 resamples of the six groups, resampling groups with replacement and recomputing the pooled value;
seed 20261105). The yardstick's intervals are over **photos** (also 2,000 resamples). Boxes are not independent within a
photo or a stand, so no interval is drawn over boxes.

**Development keep rule.** The student is **kept** (as a development candidate, not a product claim) only if, on the six
LOGO held-out groups, **both** hold:

- **K1.** The pooled mean absolute share error is lower than the per-split-group-mean baseline's by **at least 10 %
  relative** (point estimate), and the 95 % group-bootstrap interval of the relative reduction has its lower end above 0.
- **K2.** The pooled median normal angular error is lower than the baseline's by **at least 2.0 degrees** (point
  estimate), and the 95 % group-bootstrap interval of the difference has its lower end above 0.

Top-1 agreement is reported and gates nothing. If K1 or K2 fails, the verdict is **not kept**, and the report says
which, and by how much. The frozen-split model and the yardstick are reported beside the rule and decide nothing (the
yardstick is PROXY, a different camera and place, and its baseline is a per-photo oracle).

## 6. Core ML export, latency and cost

- **Export.** The frozen-split artifact is converted with `coremltools` (an `mlprogram`, float16 weights, an image input
  of 128×128 RGB with the standardisation folded in, and the 12-number geometry vector as a second input). If the export
  fails, the report says why; **the architecture is not changed after the fact**.
- **Measured on the Mac only** (the phone benchmark is NS-9's): package size on disk, and single-box latency (one crop,
  batch of one) as the median and 90th percentile over 300 predictions after 30 warm-up calls, for the compute units
  `CPU_ONLY`, `CPU_AND_GPU`, `ALL`. Also the PyTorch MPS throughput at batch 64, for the per-photo cost. Latency from
  this Mac says nothing certain about an iPhone.
- **Cost avoided.** MoGe-2's measured cost per photo from H-2 (evals/H2/metrics.json: inference p50 0.99 s, whole stage
  p50 3.2 s per cold photo on MPS, model load 7.6 s) against the student's measured cost for the boxes of a photo
  (the set's mean boxes per photo times the per-box time). H-2's figures and this card's are different runs on one
  machine, reported as two measurements, not one ratio of equals.

## 7. Compute, rights and what this card does not do

- **Wall-time cap: two hours of training and scoring together**, all nine training runs included (budget estimate: under
  forty minutes; an estimate, not a measurement). The scripts stop after the run that would exceed the cap, and the
  report says which runs are missing; a missing run is never replaced by a smaller recipe. Peak memory and each run's
  wall time are reported.
- **No download.** No weight, checkpoint or dataset is fetched. The run sets `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`
  and points `TORCH_HOME` at an empty private folder, so `torch.hub` cannot fetch source or weights; any attempt is
  reported. Python packages for the new helper (`coremltools`) come from the package index through `uv`, which is a code
  dependency and not a model; the report names it.
- **Data hygiene.** Everything per box or per photo (the target table, crop caches, predictions, weights) stays under the
  data root (`private/ns11/`, `models/`); the repository gets `evals/NS11/{prereg.md,metrics.json,report.md}`
  (aggregates only), the registry record, code and docs. Nothing under the data root is deleted.
- **Rights.** NS-5 §8 holds training on app-captured depth until the Apple Developer Program License Agreement is read.
  This card uses **no app-captured depth**: its labels come from MoGe-2 run on the RGB working copies, and the student
  sees RGB. If the owner reads the stills' depth channel as covered anyway, the conductor should hold the PR.

## 8. NS-5 statement

- **The real column has 0 cases.** NS-5's real degraded-tier column admits only sessions recorded at capture as
  `relative-stereo` or `none` with `captureMode: natural-sweep`. **No such session exists**: every `pilot-000` still is
  `metric-depth`, `shopper-still`, with `caseId` null. The owner's minimum is 14 cases, a 93.75 % one-sided lower bound
  that must clear 2.5 percentage points, and a fixed down-weight of 0.3 for the weighted cells.
- **Verdict under NS-5: insufficient data.** Not a go and not a no-go. This card measures none of G-SWEEP's measures
  (instance recall, `text-read` share, fused character error rate), names no primary measure among them, and builds no
  `single-view` comparison arm; it reports teacher agreement only.
- **What unlocks it.** (a) NS-3's degraded-tier sweeps and the borrowed non-Pro phone's natural-sweep sessions, recorded at
  capture with a case id (14 cases or more in one column); (b) a `single-view`-labelled comparison arm for the same
  recipe, or a stated reason that none can exist for these targets; (c) the Apple agreement reading, if app-captured depth
  is ever used. Until then the student is a measured artifact and nothing more.
