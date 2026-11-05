# TS2: distilled spine reader — pre-registration

Fixed 2026-11-05, before any training run and before any student output exists. Nothing below changes after seeing
a result. Any change is logged as a deviation in `implementation-notes.md`, and the report (`evals/TS2/report.md`)
says which figures it touches. The constants live in `src/eval/ts2.ts` (`TS2`) at this commit.

**Question.** F-0 labels a spine when two of three readers (Apple Vision, PP-OCRv5, Qwen3-VL-4B 8-bit) confirm the
same catalog work. TS-0 exported those labels; TS-1 found that reader errors correlate on shared and one-word titles,
so its **strong class** (a distinctive title, two readers agreeing, no third-reader dissent) is the clean subset. Does
a Qwen3-VL LoRA **student** trained on the strong class, with its decoding steered towards C-3's catalog candidates,
raise confirmed books without raising wrong accepts, either as a **fourth reader** or as a **replacement for the
slowest reader**?

**Sets, never merged (OC35).** Both on RB-1's box set (F-0i's partition less NB-3's `on-lip` boxes; `loadBoxSet`).

- **`pilot-000` val** (the 7 photos F-1 froze as `val`): every figure is **machine agreement with the confirmed work,
  never accuracy** (INV-17).
- **Yardstick (PROXY, library shelves)**: the 40-image Library Dataset sample with F-0's B2 boxes and its inventory
  catalog. **Evaluation only**: nothing is trained or tuned on it.

## Training data

- **Ledger:** TS-0's label ledger, version `v-4e0ec70a69de` (`bookcase dataset build` on main 17e9b74 names it in
  `latest.json`). F-1's frozen splits as built; nothing is re-split.
- **Rows trained on** (`trainRows`): `split = train` **and** `strong` (TS-1's filter: distinctive title,
  `readers-agree`, two readers, no dissenting reader, no third-reader dissent). Every row is passed through TS-0's
  `assertTrainable` (OC35: throws on a yardstick, PROXY or audit set) and `assertMachineBasis` (OC36: throws on any
  basis but the three shipped machine bases, so no hand label) **before** filtering.
- **Never trained on:** labels only one reader voted for, the `val` split, the yardstick and any audit or PROXY set,
  hand labels, copy and context labels (not strong by definition).
- **Counts known before fixing this text (disclosed):** the ledger holds 824 labels. **379** are strong and in
  `train`, on **22** of the 24 train photos (the brief said about 470: that is the strong count over both splits);
  93 strong labels are in `val`. By agreeing pair, the 379 are 288 Vision+PP-OCR, 77 Vision+Qwen and 14 PP-OCR+Qwen.
  This is a small set. A null result is not evidence that distillation cannot work at a larger scale.
- **Crop:** the crop the readers read, F-0's original method (`rect;rot=fixed`, `F0_CROP`: the detection rectangle,
  perspective-corrected exactly as `helpers/label/read.py` cuts it, long side at most 1,600 px).
- **Rotation trained at** (`bestRotation`): F-0 reads each spine at 90° and 270°. A label is trained at the rotation
  whose agreeing readers' text gives the label's work the higher C-3 evidence score (`scoreWorks`). A label where
  neither rotation scores above 0 is dropped and counted.
- **Target** (`targetText`): the catalog's title, a newline, the catalog's authors joined by `, `, after F-0's spine
  prompt (`QWEN_PROMPT` in `helpers/label/read.py`, unchanged). The student learns to name the work in the catalog's
  form.
- **Apple Vision.** Labels with Vision in the agreeing pair (365 of the 379) carry a reader whose terms keep its output
  private. The weights are therefore **private-only**: no G-W or G-PUB release, nothing uploaded anywhere. The
  registry record (`models/registry/ts2-spine-reader.json`) says so.

## The student

- **Base:** the local `qwen3-vl-4b-8bit` (Qwen3-VL-4B-Instruct, MLX 8-bit), the weights F-0's reader R2 uses. LoRA on
  the quantized model (mlx-vlm 0.7.11, `helpers/train/`).
- **Hyperparameters (`TS2.lora`), not tuned:** rank 8, alpha 16, dropout 0.05, learning rate 1e-4 (Adam), 2 epochs,
  batch 1, seed 20261105, maximum sequence 1,024 tokens, loss on the completion only, vision tower frozen (LoRA on the
  language model's default target modules).
- **No validation split is used for early stopping or for picking a checkpoint.** The adapter after the last step is
  the student. `pilot-000` val is never seen in training.
- Weights and adapters go under the data root's `private/models/ts2/`. The repo gets code, tests, the registry record
  and aggregates.

## Decoding: steered towards the catalog (eval harness only)

- **Prompt and cap:** F-0's spine prompt, greedy (temperature 0), at most 48 new tokens, both rotations (90°, 270°),
  as F-0's Qwen reader.
- **Candidates** (`steerCandidates`): C-3 retrieval (`retrieve`, top 5) on **Vision's and PP-OCR's** cached readings of
  the same box (not Qwen's, so one student read serves both arms), merged by best score per work, top **k = 5**. Each
  candidate's target is `targetText` of the work. The catalog is the set's own: v1 ISFDB for `pilot-000`, the
  inventory catalog for the yardstick.
- **Steering** (`helpers/train/steer.py`): while the tokens generated so far are a token prefix of at least one
  candidate's target, the next token of each such candidate (and the end token when a candidate is complete) gets
  **+2.0** added to its logit. Once the output leaves every candidate, nothing is added: the student decodes free.
  This is the **unmatched fallback**: a spine whose text is not among the candidates is read as it is.
- **Scored like any reader:** the student's two rotations are its retrieval variants (`variantsOf`); its top C-3
  candidate must pass F-0's bar unchanged (score ≥ 0.72, title evidence ≥ 0.8, coverage ≥ 0.5) to count as its
  confirmation.
- **Untouched:** `helpers/label/read.py`, F-0's `decide`, identify's runners and every default. The steering lives in
  `helpers/train/read_student.py` and `src/eval/ts2*.ts` only.

## Arms

All three on F-0's plain vote (`vote` in `src/eval/f0.ts`: two readers confirming one work, uniquely), from H-2's
cached base decisions (`private/h2/<set>/base-decisions.jsonl`), on RB-1's kept boxes:

- **base:** Vision, PP-OCR, Qwen as cached.
- **fourth:** the three plus the student, on every box it read.
- **replace:** the student stands in for **Qwen**, on exactly the boxes Qwen read under F-0's routing (hard crops, per
  photo cap); Qwen's votes are dropped everywhere. Qwen is the slowest reader per crop over both sets' cached
  readings: 2.85 s a crop pooled (`pilot-000` 2.92 s on 1,230 reads, yardstick 2.69 s on 478) against PP-OCR's 2.05 s
  and Vision's under 0.6 s. These timings were looked at before fixing this text.

**Which boxes the student reads** (`decisionRelevant`): every kept box where at least one cached reader confirmed a
work. On any other box neither arm can change the decision: one more vote cannot make two, and a dropped vote that
was never cast cannot lose an accept. Counts, known before fixing this text: **414 of 1,038** yardstick boxes; **288
of 1,249** on the 7 `pilot-000` val photos, plus the val labels' boxes outside that set (3), **291** in all (6 of the 7
val photos hold a label). No train photo is read at eval time.

## Measures

**Yardstick (PROXY), the keep rule's set.** Per arm: accepted, **confirmed** (the accepted work is annotated in the
photo; `yardstickTruth` in `src/eval/q1-cli.ts`) and **wrong** accepts; the change from base in confirmed and in wrong
with a **95 % photo-cluster bootstrap** (2,000 draws, seed 20261105, the photo resampled); boxes gained, lost and
changed.

**`pilot-000` val, machine agreement (INV-17).**

1. **Agreement with the confirmed work:** the share of val labels whose work the student confirms on that box, for all
   157 val labels and for the 93 strong ones, with a 95 % photo-cluster interval (6 photos: wide). Also the labels it
   confirms another work on, and the labels it confirms nothing on. *Caveat fixed in advance:* the labels come from
   Vision and PP-OCR votes and the student is steered by Vision's and PP-OCR's candidates, so this agreement is not
   independent of the label; the free-decoding arm below is the check.
2. **Arms on the val photos:** accepted per arm, gained, lost and changed against base, with photo-cluster intervals on
   the change in accepted. Machine agreement only: a gain is "two machines agree", not "right".

**Speed:** the student's seconds a crop (both rotations, steering included), mean with a 95 % interval over crops,
beside each cached reader's.

## Keep rule (per arm, on the yardstick)

The student is **kept** as a fourth reader (or as Qwen's replacement) when, for that arm on the yardstick:

1. confirmed books rise: the change in confirmed has its point estimate above 0 **and its 95 % interval's lower bound
   above 0**; and
2. wrong accepts do not rise: the arm's wrong accepts are **at most** the base's.

Either arm may be kept, both, or neither. `pilot-000` val does not enter the rule; a fall in agreement there is
reported, not hidden. "Kept" means **recommended for a later card to wire in**: this card changes no default.

## GPU order and budget

120 GPU-minutes in all, training and eval. Order: (1) train; (2) steered student on the yardstick's 414 boxes;
(3) steered student on the 291 `pilot-000` val boxes; (4) exploratory, only if at least 25 minutes remain: the
student decoding **free** (no steering) on the yardstick's 414 boxes, to separate the LoRA's effect from the
steering's. If the budget would be exceeded the run stops and the report says what did not run. Each step starts only
when no other `mlx`, `torch` or `qwen` job is running (`pgrep -fl 'mlx|torch|qwen'`).

## What the repo gets

`src/eval/ts2.ts`, `src/eval/ts2-cli.ts`, `test/ts2.test.ts`, `helpers/train/`, `models/registry/ts2-spine-reader.json`
(name, base revision, ledger version, hyperparameters, private-only; no path), and `evals/TS2/{prereg.md,metrics.json,
report.md}`: aggregates only. No crop, reading, title, image id or model output leaves the data root.
