# Mono-geometry student (NS-11)

Run 2026-11-05 by card NS-11 (`claude/ns11-mono-geometry-student`). Pre-registration [`evals/NS11/prereg.md`](../../evals/NS11/prereg.md),
figures [`evals/NS11/report.md`](../../evals/NS11/report.md) and [`metrics.json`](../../evals/NS11/metrics.json), registry record
`models/registry/ns11-mono-geometry-student.json` (private-only). Code: `helpers/geometry-student/`,
`src/eval/ns11.ts`, `src/eval/ns11-cli.ts`.

**What it is.** A small RGB-only network (1.6 million parameters, trained from scratch) that predicts, for one detected
box, three **face shares** (spine, top, cover) and a coarse **mean surface normal** in the camera frame. The teacher is
MoGe-2 (`Ruicheng/moge-2-vitl-normal` at `cb0e8bb`, MIT) with `helpers/depth/faces.py`: heavy (about 1 s of inference a
photo on MPS, 3.2 s for H-2's whole stage), computed from the whole photo. The student never sees depth, a point map or a
teacher output; it sees the box's crop and a 12-number vector of the detection's outline (OC38: rich data is a label
generator, never a model input). Its targets are `labelSource: mono-geometry`, `rgbRecoverable: yes`: MoGe-2 made them
from RGB alone.

**Why.** The product must work on the degraded tier (phones without metric depth; S9 re-plan, PR #77), so geometry a phone
cannot sense has to be learned from RGB or not used. H-1 and H-2 found the faces are a real signal (a box over-selects
when it takes in a book's top or cover; the top bucket is probably a steep-angle proxy). If a model this size can
reproduce them, they can serve the on-device loop (NS-12) and the viewing-angle coverage signal (S-L6) without MoGe-2.

## Method

1. **Teacher table** (`ns11-cli.ts targets`, CPU, 12 s). From H-2's caches only (no new MoGe-2 run; every photo's cache entry was
   present and its key still matches the current `geometry.py`): per kept box, the face counts (front, top, cover over their
   sum: the **three-way** target), the mean of MoGe-2's normals over the box's pixels (exactly `faces.py`'s mask, checked
   against H-2's pixel counts for every box), the box outline, the F-1 split group. A box is admitted when front + top +
   cover are at least half its pixels: 5,592 of 5,757 on `pilot-000`, 906 of 1,038 on the yardstick. Stamped as class
   `mono-geometry-targets` (DL-3). Teacher calls the spine face the largest for 97 % of boxes, so top-1 agreement tells little.
2. **Student** (`helpers/geometry-student/student.py`). Input: the box's grown rectangle letterboxed to 128×128, and the
   12-number geometry vector. ResNet-style, 24/48/96/192 channels, two heads. Loss: KL divergence on the shares plus
   (1 − cosine) on the normal. AdamW, 40 epochs, batch 64, seed 20261105, MPS; about 3 minutes a run.
3. **Splits.** `pilot-000` has six F-1 split groups (each one capture group; no case ids). The keep rule is scored on six
   leave-one-split-group-out models, because the frozen split's two validation groups carry no interval. The registered
   artifact is the frozen-split model. The yardstick (PROXY) is evaluation only.
4. **Baseline.** The per-split-group mean: the group's own mean distribution and normal, an oracle constant.
5. **Core ML.** `coremltools` 9.0, float16 `mlprogram`; size and Mac latency measured, not the phone's (NS-9).

## What the stills could test

- **Kept under the development keep rule**, on the six held-out `pilot-000` stands: the share error is 53 % (50–57 %)
  below the per-group-mean baseline, and the median normal error 10 degrees (8.6–11.6) below it. Both clear their margins
  (10 %, 2 degrees) and their intervals sit above 0. This is agreement with MoGe-2 on stands photographed with one phone;
  the held-out stands share the training stands' camera.
- **It does not carry to the yardstick** (PROXY: a different camera, lens and place; never trained on). There the
  student's share error is 77 % *above* the per-photo oracle and 31 % above the training mean, and its median normal error is
  worse than both. A pilot-trained student is a model of this phone's geometry, not yet of shelves in general.
- **Exploratory ablations** (not pre-registered, one seed, no verdict): with no image (geometry vector only) the student
  keeps 39 % of the 53 %, so much of the signal is where the box sits in the photo and what shape it has, which a
  perspective prior explains; with no geometry vector (crop only) it keeps 49 %, so the pixels carry real signal too. The crop-only arm
  also transfers better to the yardstick (share error 0.078 against the full student's 0.133, and level with the
  per-photo oracle's 0.075), which suggests the absolute-position features are what fails on a new camera. That is a
  hypothesis for the next run, not a result to build on (INV-17).
- **The rare faces are not learned.** The top face is 2.5 % of `pilot-000` boxes' largest class and the cover 0.4 %; the
  student agrees with the teacher on 69 of 141 top boxes and 0 of 20 cover boxes. The shares are learned; the minority
  classes, which are what the steep-angle proxy would need, are not.
- **Cost.** 3.1 MiB on disk; one box in 0.22 ms on this Mac's Neural Engine path (0.59 ms CPU), so about 0.04 s for the
  180 boxes of an average `pilot-000` photo against MoGe-2's 1 s inference and 3.2 s stage. The phone is NS-9's measurement.

## What the sweeps will add

NS-5's real degraded-tier column has **0 cases** (owner's minimum 14): the verdict is **insufficient data**, and no lift is
claimed. What unlocks it: NS-3's degraded-tier sweeps and the borrowed non-Pro phone's natural-sweep sessions, recorded
at capture with case ids; a `single-view` comparison arm for the same recipe, or a stated reason none exists (there is no
non-privileged label for these targets, so the baseline would be a different kind of model); the Apple agreement reading
if app-captured depth is ever used. When they exist:

- re-run the leave-one-case-out evaluation with cases rather than capture groups, and score on a camera the model never saw
  (the yardstick showed that is where this fails);
- re-train without the absolute-position features, or with the crop alone, and pre-register that choice;
- score what the student is for: a coverage signal (viewing angle per book) and the on-device loop's cost, not agreement with MoGe-2.

Private files: `private/ns11/` under the data root (teacher table, crops, predictions, logs), weights and the Core ML
package under `models/ns11-mono-geometry-student/`. Nothing was deleted and nothing was downloaded; `coremltools` was the one package installed.
