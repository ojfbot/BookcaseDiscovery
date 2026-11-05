# NS5: privileged-depth go rule — pre-registration

Fixed 2026-11-05, before any teacher or student exists. **No measurement was taken for this card.** No teacher, student
or baseline has been trained, no fused label exists, no degraded-tier session has been recorded, and no code was written
(the scorers and checks below are specified, not built). Nothing below changes after seeing a result. **A later change
to this rule is a deviation: it is logged under `## Deviations` in `implementation-notes.md` and named in the
experiment's `report.md`, with the figures it touches.** Numbers that would be thresholds are ranges the owner picks
from (owner's picks table, below); each range is a **proposal**, not a measurement (INV-17).

**Question.** A student that sees RGB only is trained on labels made with privileged information (LiDAR depth, or labels
fused across the frames of a rich session). Does it beat a student trained without that information, on frames the
deployment phones could have produced? Privileged information helps most when it separates clean from noisy examples
and hurts when it is too predictive of the label (Ortiz-Jimenez et al., 2023); a three-dimensional-evidence teacher's
targets should be down-weighted by how much they depend on the evidence (Hu et al., 2026). Multi-view fusion makes a
wrong label consistently wrong, and readers' errors correlate (`evals/TS1/report.md`), so agreement with a fused label is
no evidence that the label is right. Opt-in rich sessions are a label generator and an evaluation reference, never a
model input (OC38, `decisions/adr/draft-rich-session-retention.md`).

**Governs.** **NS-10** (multi-view label fusion) and **NS-11** (mono-geometry student), and any later card that trains an
RGB-only student on `multiview-fusion`, `mono-geometry` or `lidar-privileged` labels. Each pre-registers, before it
trains, what §8 leaves to it, and cites this file by its commit.

## 1. Arms

- **Student.** Takes RGB only, at inference and in training. Depth, pose, confidence maps and video are never a model
  input (OC38). Its training targets come from the privileged label source under test, admitted by §5.
- **No-privileged-information baseline.** The same architecture, initialisation, recipe, tuning budget, random seeds and
  **training frames** as the student, with targets from `labelSource: single-view` rows only. It is the only comparator.
  A baseline given less tuning than the student is a deviation.
- **Same pipeline.** Every other stage (tracker, readers, catalog build) is identical across arms, and both arms carry the
  same lineage stamp (DL-3), fixed before either is scored. Tuning of any kind uses the `val` split only, never held-out.
- **Diagnostic, not gated.** An arm that trains on the privileged labels with every weight at 1, ignoring §5, may be run
  to show whether the recoverability rule mattered. It never decides a verdict.

## 2. What is scored: two columns, never pooled

A **session** is scored only if it is a declared held-out session (`src/eval/set-roles.ts`) and uncoached (captureMode
`natural-sweep`, or a frame of a `rich-session` taken as an uncoached sweep). Held-out sessions are manifested and never
exported (`docs/dataset.md`), so scoring reads each arm's pipeline outputs for the session, not label rows.

| Column | Rows admitted | What it is | Can it decide a verdict? |
|---|---|---|---|
| **Real degraded tier** | `deviceClass` `relative-stereo` or `none`, **recorded at capture** (§6), `captureMode: natural-sweep` | Real use (OC39): sessions on the borrowed non-Pro phone and later non-Pro phones | **Yes, the only one** |
| **Simulated degraded tier** | `deviceClass: metric-depth` captures with depth withheld at ingest (G-SWEEP ruling 4) | A simulation: same frames, no depth channel | No: reported apart, labelled "simulated", never a real-use number and never a substitute for a missing real column |

Scored on neither: the yardstick, PROXY, audit and training-source sets (`assertTrainable`'s roles); protocol stills.
Shopper stills are reported descriptively beside the columns and decide nothing. The per-case reference of §3 is fixed
once, **before either arm is read**, from sources that neither arm and neither teacher produced (the stamped still path's
readings of that case, and the lab's exact instance ground truth on a synthetic replay): a reference built from the
teacher under test would grade the teacher against itself.

## 3. Measures and estimators

The three G-SWEEP measures a student can move (`docs/gates/G-SWEEP.md`, measures 1 and 3). **Unit: a physical book, per
case** (INV-25); copies of one work are separate books. Each is computed per case and arm, over the case's visible
physical books, then differenced **student minus baseline on the same held-out frames**, per case: the paired comparison.
Every figure is **machine agreement with a named reference, never accuracy** (INV-17, OC36); the report says so beside
each table, for the teacher's labels as much as for the student's output.

| Measure | Per-case value | Reference | Direction (one-sided) |
|---|---|---|---|
| **Instance recall** | Books that end the sweep as exactly one track carrying one identity at `text-read` or above, over the case's visible physical books | Lab replays: exact. Real case: the per-case union across its stills and sweeps (`CONTEXT.md`, *per-case union*), built under §2's rule | Student **higher** |
| **`text-read` share** | Books at rung `text-read` or above over the case's visible physical books (Q-0's fill line) | The same per-case union | Student **higher** |
| **Fused character error rate** | Edit distance of the fused track reading to the still path's accurate reading of the same spine on 48 MP, summed over the case's paired books, over summed reference characters; books with no still reading are excluded and counted | The still path's reading (a machine reading) | Student **lower** |

- **Aggregate.** The mean of the per-case differences, **cases weighted equally**. The book-pooled difference (sum over
  books) is reported beside it and decides nothing. Seeds: each arm is trained with the same declared seeds, a case's
  value is the mean over seeds, and the spread over seeds is reported (their number is §8's).
- **Interval.** Bootstrap over **cases**: the case is the resampling unit, since frames and books within a case share
  light, shelf and camera path and are not independent. 2,000 resamples of the cases, seed 20261105 (as NS1), the
  percentile interval of the aggregate. No p-value is derived from books or frames.
- **Primary and secondary.** Each experiment names **one primary measure before it trains** (default: instance recall,
  the sweep gate's headline). The other two are secondary: reported with the same estimator.
- **Insufficient data.** A column with fewer than the owner's pick of cases (the table below; never fewer than 5, NS1's
  floor, under which not even an interval is drawn) gets per-case values only and the verdict **insufficient data**, never
  a go or a no-go. A column is one *capture mode × device class*; cases are counted in it, not in the pooled set.

## 4. Verdict

For one experiment, in the real degraded-tier column only:

- **Go** if every check in §6 passes, the real column holds at least the owner's minimum number of cases, and the primary
  measure's one-sided lower bound of the lift (the bound at the owner's confidence level, in the direction of the table
  above) lies **above the owner's margin** (the margin may be 0, which is the card's bare rule: the interval excludes
  0), and no secondary measure's interval lies wholly on the harmful side (a veto).
- **No-go** if the real column has enough cases and the primary rule fails. The report then says whether the lift was
  positive, and whether the diagnostic arm (§1) differs from the gated student.
- **Insufficient data** if the real column has too few cases, or no real degraded-tier session exists yet. A simulated
  column that passes is reported as **simulated only: not a go**, and the gate (G-SWEEP) is told so in those words.
- **Invalid run** if any §6 check fails: no verdict, and the report names the check.

### Owner's picks (proposals; the owner picks before `evals/NS10/` or `evals/NS11/` exists)

| Quantity | Proposed range (label: proposal) | Owner's pick | Date |
|---|---|---|---|
| Minimum cases in the real column | 8 to 20 (floor 5, NS1's) | | |
| One-sided confidence level of the lower bound | 90 % to 97.5 % | | |
| Margin the lower bound must clear (percentage points; 0 = the card's bare rule) | 0 to 5 | | |
| Fixed down-weight, if the scheme `fixed-downweight` is used | 0.1 to 0.5 | | |

## 5. The recoverability rule (operational)

A label is **admissible as a training target for an RGB-only student** by its `labelSource` and `rgbRecoverable`:

| `labelSource` | `rgbRecoverable: yes` | `no` or `unknown` |
|---|---|---|
| `single-view` | admitted | weighted by the declared scheme |
| `mono-geometry` | admitted | weighted by the declared scheme |
| `multiview-fusion` | admitted | weighted by the declared scheme |
| `lidar-privileged` | admitted | **excluded** (weight 0): too predictive of the label to be learned from RGB |
| `lidar-scale` | **never a target** | **never a target** |

- `unknown` is never read as `yes`. `lidar-scale` is used only as a metric scale when scoring (for example turning a
  relative geometry error into one in centimetres), never in a loss, and never to build a training target.
- **Declare before training.** Each experiment states one **named scheme** for the weighted cells, and the counts of
  rows by `labelSource` × `rgbRecoverable` in its training set, before the first step of training:
  - `drop-unrecoverable`: weight 0 for `no` and `unknown`.
  - `fixed-downweight`: one fixed weight in (0, 1) for `no` and `unknown`, from the owner's pick.
  - `dependence-downweight` (after Hu et al., 2026): weight = 1 minus the label's **dependence on the privileged
    evidence**, where the experiment defines the dependence measure (for example, how far the teacher's output moves when
    the evidence is withheld), computes it on training frames only, and states it before training.
- A scheme chosen or changed after seeing a held-out result is a deviation (header).

## 6. Leakage checks (each one a script's assertion, run before any verdict)

Held-out is the frozen `held-out` split (`splits.json`) of the dataset version both arms name (`v-…`). Field names are
those of `docs/dataset.md` (NS-4): `caseId` (the existing `bookcaseId`), `session`, `dupClusterId`, `deviceClass`,
`lens`, `captureMode`, `labelSource`, `rgbRecoverable`; there is no `deviceModel`.

1. **Case.** No `caseId` appears in both the training or tuning side and the held-out side. A held-out row has a
   non-null `caseId`.
2. **Session.** No `session` appears on both sides.
3. **Duplicate cluster.** No non-null `dupClusterId` appears on both sides. A fused scene's frames share one, so a scene
   is wholly on one side.
4. **Set role.** Every training and tuning row's set has the role `training-source`; no scored session is a
   `training-source`; no set with the role `yardstick`, `proxy` or `audit` is on either side.
5. **Fused scene.** No frame of a held-out case is an input to any teacher or fusion fit; every `multiview-fusion` label
   in training cites only training-side frames; no fused scene is both trained on and scored. A teacher fitted on a
   case that is later held out invalidates the run.
6. **Frozen split.** `splits.json` is read at the lineage stamp both arms record; no photo's split moved after the arms
   began training.
7. **Columns.** No `metric-depth` row is in the real column; no simulated row appears in the real column's counts; each
   column's cases are counted separately.
8. **Recorded at capture.** Every row in the real column has its device class from the capture sidecar or the NS-6
   manifest (`provenance.deviceClass` on the private manifest photo), not from the legacy default or an EXIF table alone.

## 7. What the current data can and cannot say

- **No degraded-tier session exists.** Every `pilot-000` row (824 labels, version `v-f495741be2c5`, 31 photos) has
  `deviceClass: metric-depth`, `captureMode: shopper-still`, `labelSource: single-view`, `rgbRecoverable: yes`, `caseId`
  null and no duplicate cluster. They are stills from one LiDAR phone: no row can enter the real column, and none is a
  sweep. A schema-1 file read with `--allow-stale` carries the **legacy default**, `metric-depth`, which names a tier
  nobody checked and counts as `deviceClass` **unknown** for any degraded-tier claim. The field cannot tell that
  default from a value derived from the EXIF device string, so check 8 admits only what a session recorded itself.
- **No `deviceModel`.** Device-model shift is measured **by session**, not by model: the report gives the lift per
  session, and a single session is not a model.
- **No fused label exists** (`labelSource` is `single-view` for every row), so the diagnostic and the privileged arm have
  nothing to train on yet; this file was written first so the bar is not fitted to a result.

## 8. What this rule does not cover (NS-10 and NS-11 pre-register these themselves)

- **The teacher's own quality**: how consistent fused labels are across views, or how LiDAR compares with mono geometry
  (NS-8's keep rule), and the teacher's agreement with the still path. §3 reports teacher labels as machine agreement;
  a teacher that is wrong consistently still looks good there.
- **The choice of model**, its recipe, the number of seeds and the training frames' sampling.
- **Compute budget** and lane (parity between the arms is §1's; the amount is the experiment's).
- **Rights**: whether the Apple Developer Program License Agreement allows training on app-captured depth is unread
  (the ADR's research ticket); no training starts before it is answered.
- **Cost and latency** on the phone: G-SWEEP's other measures (identity switches, time to first card, thermal).

## After the experiments

NS-10 and NS-11 each write their own `prereg.md` under §8's items, cite this file by commit, and publish
aggregates only (`metrics.json`, `report.md`); a run, its checks (§6) and any deviation are named in its report.
