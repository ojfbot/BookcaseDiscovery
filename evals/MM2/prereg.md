# MM2: multimodal self-gallery, shadow mode — pre-registration

Fixed 2026-11-05, before any shadow or decision run on either set. Nothing below changes after seeing a result. Any
change is logged as a deviation in `implementation-notes.md`, and the report (`evals/MM2/report.md`) says which
figures it touches. The constants live in `src/identify/appearance.ts` (`APPEARANCE`) and `src/eval/mm2.ts` (`MM2`)
at this commit.

**Question.** The owner ruled (2026-11-04) that identify becomes multimodal, with visual evidence always tied to the
read text and the identified work, "because many books will look similar"; pixels never confirm alone. MM-1 stored an
upright strip and two embeddings per box. MM-2 asks what two appearance arms *would* say beside every F-0 decision,
and whether they would be safe and useful as `candidate` (propose works for the readers to test):

- the **gallery arm**: a self-gallery of the owner's own confirmed copies, where a match fuses visual nearness with
  text agreement;
- the **gallery-free arm**: SigLIP 2's image-to-title similarity over the text path's own candidates.

**This card changes no decision.** The appearance switch is set to `shadow` for MM-2's runner only; its default stays
`off`. Both arms' results are logged privately next to each cached F-0 decision, and a test checks that the decision
is unchanged. `candidate` and `vote` are refused (MM-3, owner gated). One vote per reader model (INV-6) is untouched,
appearance casts no vote, and nothing under `src/identify/` reads the profile (INV-13). The keep rule below is for a
*promotion* to `candidate`, which is the owner's ruling; MM-2 reports whether each arm passes it and recommends,
nothing more.

## Sets, never pooled (OC35)

Both on RB-1's box set, through MM-1's appearance records (`private/mm/<set>/records/`, version in `latest.json`).

- **`pilot-000`** (real use). Every figure is **machine agreement, never accuracy** (INV-17). F-1's frozen splits
  (the label ledger's manifest, `v-4e0ec70a69de`): the **gallery is built from `train` photos only**; the reported
  queries are the **`val` photos** (held-out split groups). `train` boxes are shadow-logged too, each against the
  gallery less its own split group, and only calibrate thresholds.
- **Yardstick (PROXY)**: evaluation only. Its boxes are queries against the `pilot-000` train gallery and never a
  gallery entry or a calibration input. Truth is each image's annotated inventory works (`yardstickTruth`, as TS-1
  reads it). A different shop and catalog: the gallery arm on the yardstick is a cross-fixture lookalike test, not a
  re-find.

No hand labels (OC36). Nothing is trained (no yardstick training, OC35). No fetched cover or catalog image (G-IMG stays
closed): the gallery holds only crops of the owner's own photos, and the gallery-free arm compares a crop with
catalog *text*.

**Looked at before fixing this text (disclosed).** The manifest's split and group counts (`pilot-000`: 24 train
photos in 4 split groups, 7 val photos in 2; split groups are the capture groups; no store or bookcase ids; no
near-duplicate flags). The SigLIP 2 text tower run once on CPU on one synthetic title to check it loads. MM-1's
report. No strip, reading, embedding, candidate list or decision of either set was looked at for MM-2.

## The arms

**Visual model.** SigLIP 2 (MM-1's M2 AUC 0.977 against DINOv2's 0.813) is the arm's model. DINOv2 is reported in the
stress test only.

**Gallery.** One entry per confirmed `pilot-000` train copy with a valid strip: its SigLIP 2 vector, its readings and
its work id (TS-0's label rule, as MM-1 records it). One entry per physical copy; copies are never merged (INV-4).

**Gallery arm.** For a query box with a valid strip:

1. *Nearness*: the 20 nearest entries by cosine, outside the query's own split group, kept when the cosine is at least
   the visual threshold **τv**.
2. *Text agreement* with an entry: the best title evidence any one of the query's readers gives the entry's work,
   with retrieval's own scoring (`scoreWorks`, the catalog the entry's work is in). A reader with no text gives 0.
3. *Fused match*: an entry matches when its cosine ≥ τv **and** text agreement ≥ the text threshold **τt**. Fused
   score = cosine × text agreement. The **proposal** is the work of the best-scoring matching entry (ties: higher
   cosine, then work id). An entry that is near but fails the text side is logged as `near-only` and never proposed:
   nearness alone never qualifies.

**Gallery-free arm.** For a query box with a valid strip and text:

1. *Pool*: the union of its readers' C-3 top-10 candidates (`retrieve(db, variants, 10)`, default generation) on its
   own set's catalog.
2. Each pool work's title as text — lowercased (SigLIP 2 was trained on lowercased text), whitespace collapsed —
   through SigLIP 2's text tower (padded to 64 tokens), L2-normalised; the image-to-title cosine with the box's
   SigLIP 2 vector. A secondary template, `{title} {first author}`, is reported without a keep rule.
3. The **proposal** is the pool's top work by cosine when the pool has at least two works and the top beats the
   runner-up by at least the margin **δ**. It is always one of the text path's own candidates.

The text tower runs on the CPU (no GPU lane is needed); the run's wall time is reported.

## Thresholds, set on `pilot-000` train only

- **τv** (MM-1: near-duplicates across photos raise the same-work threshold, so it is controlled). Same-work pairs of
  train entries in two forms: **across split groups** (possibly one copy photographed twice) and **within one photo**
  (two boxes, so two physical copies). τv is the **lower** of the two 10th percentiles, so more lookalikes reach the
  text side; with fewer than 10 pairs in one form the other is used. Both quantiles and MM-1's median threshold are
  reported, with the stress test at each.
- **τt**: the smallest value in {0.5, 0.6, 0.7, 0.8} at which no train **visual lookalike** pair (below) passes the
  text side. If none does, τt = 0.8 (F-0's own title bar) and the calibration failure is reported.
- **δ**: the smallest value in {0, 0.01, 0.02, 0.03, 0.05, 0.08} at which, over train boxes with an F-0
  `readers-agree` accept that lies in the pool, the proposal (when made) equals the accepted work in at least 95 %
  (machine agreement). If none does, 0.08 and the failure is reported.

## The candidate simulation (what `candidate` would do; never applied)

For each arm separately: every reader that read text but confirms no work in F-0's cached decision tests the arm's
proposal with F-0's full bar (`confirms` on `scoreWorks` for that work: score ≥ 0.72, title ≥ 0.8, coverage ≥ 0.5). A
reader that confirms its own top keeps it. F-0's vote then runs unchanged (two readers, uniquely). Each reader model
still casts at most one vote (INV-6); appearance casts none, so a proposal no reader confirms goes nowhere. On the
yardstick, a gallery proposal is a `pilot-000` catalog work and is right only when its book (own title form and
primary surname, TS-1's book key) is an annotated book of the image.

## Measures (per set; never pooled)

Intervals are 95 % percentile intervals of a **photo-cluster bootstrap** over the *query* photos (2,000 draws, seed
20261105); the gallery is held fixed. Reported on `pilot-000` val and on the yardstick.

- **M0 counts.** Gallery entries, works, split groups; queries; valid strips; pool sizes; text-tower texts and wall
  time; the thresholds and their calibration counts.
- **S1 coverage.** Share of query boxes with a proposal, per arm, by F-0 outcome (accepted; each unknown reason); and
  `near-only` shares for the gallery arm.
- **S2 agreement.** On F-0-accepted boxes, the share whose proposal is the accepted work (on the yardstick, also the
  share whose proposal is an annotated book).
- **S3 candidate simulation.** New accepts (F-0 `unknown` → accepted); on the yardstick, new wrong and new right
  accepts against truth, beside F-0's own wrong accepts. (By construction no accepted box changes work.)
- **L1 lookalike stress test (gallery arm).** A **visual lookalike** pair is a query box and a gallery entry in
  different split groups, of **different books** (different book keys: two catalog records of one book are not a
  lookalike), with cosine ≥ τv. Queries: on `pilot-000` val, F-0-confirmed boxes (their machine work); on the
  yardstick, every box with text, against entries whose book is not annotated in its image. Reported: the pair count,
  the share passing the text side (text agreement ≥ τt), and the share that become the box's proposal. At τv, at both
  quantiles, at MM-1's median, and for DINOv2 at its own τv.
- **Near-duplicate control.** Same-work pair counts in both forms, the near-duplicate flags in the manifest, and the
  gap between the two quantiles.

## Keep rule (for a promotion to `candidate`: the owner rules)

Per arm, all must hold:

- **K1 lookalike stress test** (gallery arm): **no** visual lookalike pair passes the fused match on `pilot-000` val
  or on the yardstick, at τv. Pairs nearer than the threshold must be separated by the text side.
- **K2 no rise in yardstick wrong accepts**: the candidate simulation adds **zero** wrong accepts on the yardstick.
- **K3 a gain**: the candidate simulation's new accepts on `pilot-000` val have a 95 % lower bound above 0, or it
  adds at least one right accept on the yardstick.

Passing is a recommendation to the owner; failing means the arm stays in shadow. **Cross-shop proof waits for a
second fixture**: there is one shop so far, so nothing here claims the arms generalise to another store.

## What would count as a surprise (written down, not a rule)

- τv's two quantiles more than 0.1 apart: near-duplicates drive the threshold.
- A gallery proposal on more than half of F-0's `readers-disagree` boxes: appearance is not the tie-break it looks
  like; look before MM-3.
- The gallery-free arm agreeing with F-0's accept on under 80 % of accepted boxes: SigLIP 2 reads titles worse than
  MM-1's AUC suggests.

## Out of scope

Any decision change; any edit to identify's existing runners; `candidate` and `vote` (MM-3); fetched or catalog images
(G-IMG); fine-tuning; a second fixture.
