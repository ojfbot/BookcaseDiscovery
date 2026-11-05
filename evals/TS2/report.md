# TS-2 · distilled spine reader (2026-11-05)

**Answer. Neither arm is kept.** A Qwen3-VL-4B LoRA student, trained on TS-0's 379 strong-class `train` labels and
steered towards C-3's catalog candidates, was scored on the yardstick (PROXY, library shelves; evaluation only):

- **As a fourth reader** it adds **+83 confirmed books (61 to 107)** but also **+11 wrong accepts (5 to 18)**: 33
  wrong, against the base's 22. The keep rule needs wrong accepts not to rise, so it fails. Among the accepts it adds,
  11.7 % are wrong; among the base's accepts, 8.3 % are.
- **As Qwen's replacement** it gives **−18 confirmed (−27 to −10)** and −2 wrong (−6 to 0). On the boxes Qwen reads,
  the student confirms fewer works than Qwen does. Fails.

The pre-registration is `evals/TS2/prereg.md` (commit 367460c, before any training). The two sets are reported apart
(OC35). `pilot-000` figures are machine agreement with the confirmed work, never accuracy (INV-17). No default
changed: F-0's readers, `decide` and identify's runners are untouched.

## What the result says, and what it does not

- **The student is not an independent reader.** 79 of the 94 boxes the fourth arm gains are the student agreeing
  with **Qwen** (70 confirmed, 9 wrong), so 9 of the 11 new wrong accepts are among them. The student is Qwen's own weights plus a LoRA, so it
  makes Qwen's mistakes. A second Qwen-family vote is not a second opinion. This is TS-1's correlated-error finding
  again, coming this time from shared weights instead of the shared catalog step (exploratory: the breakdown below was
  not pre-registered).
- **Steering made no measurable difference.** Free decoding (exploratory) gives +82 confirmed (59 to 107) and +11
  wrong (5 to 18) as a fourth reader, and −17 and −3 as the replacement: within a box or two of the steered arm. The
  steered output was a catalog candidate verbatim on 21.3 % of rotations, but those reads mostly confirm what the free
  read confirms anyway.
- **No speed gain.** The student runs at 2.97 s a crop on the yardstick, against Qwen's 2.77 s (same architecture plus
  a LoRA). Replacing Qwen saves no time, and PP-OCR (3.48 s) is in fact the slower reader on this set.
- **The training set is small**: 379 labels on 22 photos, two epochs, untuned hyperparameters. The reported
  training loss fell from about 0.55 early on to 0.07 at the end. This null result says nothing about distillation
  at a larger scale. It does say that a Qwen student cannot be the extra vote that F-0's two-reader rule counts on.
- **`pilot-000` val (machine agreement).** The student confirms the label's work on 130 of 157 val labels (82.8 %)
  and on 84 of the 93 strong ones (90.3 %). With 6 photos, one of which dominates, the photo-cluster intervals run
  from 12.5 to 86.2 % and from 50.0 to 92.2 %: they are not informative. The agreement is not independent of the
  labels either, since the student was steered by the same readers' candidates. As a fourth reader on the val photos
  it adds 85 accepts (0 to 172). These are machine agreements, not checked books, and the yardstick shows that about
  1 in 9 such additions is wrong.

## What ran

1. **Data (CPU).** `ts2-cli.ts data`: TS-0's ledger `v-4e0ec70a69de`, filtered by `trainRows` (`assertTrainable`
   and `assertMachineBasis` on every row first). It keeps 379 rows, all strong and all in `train`. It left out 157
   val labels, 226 train labels outside the strong class and 62 single-reader train labels. Each label is trained at
   its better rotation (242 at 90°, 137 at 270°), with the catalog's title and authors as the target.
2. **Train (GPU, 20.3 min).** mlx-vlm 0.7.11 LoRA on the local 8-bit base: rank 8, alpha 16, dropout 0.05,
   learning rate 1e-4, 2 epochs (758 steps), loss on the completion only, vision tower frozen. No checkpoint was
   picked on any eval set.
3. **Read (GPU).** The student read every decision-relevant box: 414 on the yardstick (20.6 min steered, 20.3 min
   free) and 291 on the `pilot-000` val photos (8.0 min). That is 69.2 of the 120 GPU-minutes. It read with F-0's
   prompt, crop and rotations, and its reads were held to F-0's acceptance bar.
4. **Analyse (CPU).** `ts2-cli.ts analyse` writes this report's tables and `metrics.json`. `ts2-cli.ts register`
   writes `models/registry/ts2-spine-reader.json`.

The base arm reproduces RB-1's yardstick figures (266 accepts, 22 wrong). Deviations are logged in
`implementation-notes.md`:

- the strong train count (379, not about 470);
- torch in `helpers/train`;
- "slowest reader" depends on the set;
- the decision-relevant read set;
- the idle worker the GPU check ignores.

## Weights

Adapter and training crops are under the data root's `private/models/ts2/`. They are **private-only**: 365 of the
379 labels have Apple Vision in the agreeing pair. No G-W or G-PUB release; nothing is uploaded anywhere. The
registry record holds the base revision, ledger version, training-set hash, hyperparameters and adapter hash, and no
path.

## Follow-ups (not done here)

- A student that does not share weights with any reader in the vote: a different base, or a rule that counts
  Qwen-family readers as one vote. That is the condition for a fourth reader to add independent evidence.
- **Hypothesis**, from the exploratory breakdown only: gains where the student agrees with Vision or PP-OCR rather
  than Qwen were 13 confirmed and 2 wrong (steered). That is too few to judge.
- More strong labels (more real-use sets through TS-0) before another distillation attempt.

<!-- generated by src/eval/ts2-cli.ts analyse: edit above this line -->

## Yardstick (PROXY, library shelves; evaluation only)

Student read set: 414 decision-relevant boxes.

### Steered student (pre-registered)

Read 414 boxes (0 errors); output exactly a candidate on 21.3 % of rotations.

| arm | accepted | confirmed | wrong | Δ confirmed (95 %) | Δ wrong (95 %) | gained | lost | changed |
|---|---|---|---|---|---|---|---|---|
| base | 266 | 244 | 22 | – | – | – | – | – |
| fourth | 360 | 327 | 33 | 83 (61 to 107) | 11 (5 to 18) | 94 | 0 | 0 |
| replace | 246 | 226 | 20 | -18 (-27 to -10) | -2 (-6 to 0) | 1 | 21 | 0 |

Fourth-reader gains by the cached reader the student agreed with, and whether its output was a steering candidate verbatim (exploratory):

| partner | student output | confirmed | wrong |
|---|---|---|---|
| ppocr | its own text | 2 | 0 |
| ppocr | a candidate, verbatim | 2 | 0 |
| qwen | its own text | 52 | 6 |
| qwen | a candidate, verbatim | 18 | 3 |
| vision | its own text | 6 | 2 |
| vision | a candidate, verbatim | 3 | 0 |

Keep rule: fourth reader **not kept** (confirmed up: true; wrong not up: false); replacing qwen **not kept** (confirmed up: false; wrong not up: true).

### Free-decoding student (exploratory)

Read 414 boxes (0 errors); output exactly a candidate on 0.0 % of rotations.

| arm | accepted | confirmed | wrong | Δ confirmed (95 %) | Δ wrong (95 %) | gained | lost | changed |
|---|---|---|---|---|---|---|---|---|
| base | 266 | 244 | 22 | – | – | – | – | – |
| fourth | 359 | 326 | 33 | 82 (59 to 107) | 11 (5 to 18) | 93 | 0 | 0 |
| replace | 246 | 227 | 19 | -17 (-27 to -8) | -3 (-8 to 0) | 2 | 22 | 0 |

Fourth-reader gains by the cached reader the student agreed with, and whether its output was a steering candidate verbatim (exploratory):

| partner | student output | confirmed | wrong |
|---|---|---|---|
| ppocr | its own text | 5 | 0 |
| qwen | its own text | 68 | 9 |
| vision | its own text | 9 | 2 |

Keep rule: fourth reader **not kept** (confirmed up: true; wrong not up: false); replacing qwen **not kept** (confirmed up: false; wrong not up: true).

## `pilot-000` val (machine agreement, never accuracy)

Student read set: 291 boxes on the val photos.

| val labels | labels | photos | student confirms the label's work | another work | nothing | agreement (95 %) |
|---|---|---|---|---|---|---|
| all | 157 | 6 | 130 | 11 | 16 | 82.8 (12.5 to 86.2) % |
| strong | 93 | 4 | 84 | 3 | 6 | 90.3 (50.0 to 92.2) % |

Arms on the val photos (every accept is machine agreement; there is no truth on real use):

| arm | accepted | Δ accepted (95 %) | gained | lost | changed |
|---|---|---|---|---|---|
| base | 144 | – | – | – | – |
| fourth | 229 | 85 (0 to 172) | 85 | 0 | 0 |
| replace | 140 | -4 (-8 to -1) | 2 | 6 | 0 |

## Speed (seconds a crop, both rotations; mean, 95 % interval over crops)

| set | student (steered) | student (free) | Vision | PP-OCR | Qwen |
|---|---|---|---|---|---|
| yardstick | 2.97 (2.88 to 3.06) | 2.94 (2.84 to 3.03) | 0.18 (0.18 to 0.18) | 3.48 (3.32 to 3.65) | 2.77 (2.66 to 2.88) (n 225) |
| pilot-000 val | 1.63 (1.59 to 1.68) | – | 0.18 (0.18 to 0.18) | 1.32 (1.24 to 1.41) | 2.65 (2.47 to 2.84) (n 65) |

GPU: 69.2 of 120 min (train 20.3, read:yardstick:steered 20.6, read:pilot-000:steered 8.0, read:yardstick:free 20.3).
