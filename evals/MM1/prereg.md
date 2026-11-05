# MM1: spine pixels and embeddings — pre-registration

Fixed 2026-11-05, before the full run on either set. Nothing below changes after seeing a result. Any change is
logged as a deviation in `implementation-notes.md`, and the report (`evals/MM1/report.md`) says which figures it
touches. The constants live in `src/eval/mm1.ts` (`MM1`) and `helpers/embed/embed.py` at this commit.

**Question.** The owner's ruling (2026-11-04) makes identify multimodal, with visual evidence always tied to the read
text and the identified work, because many books look alike. Before any card uses appearance (MM-2 shadow mode, MM-3
promotion), store for every box an upright spine strip and two embeddings, and measure, without any label beyond the
machine decisions already cached, whether the embeddings separate copies of one work from other books, and how often
different works look nearer than copies of one work do.

**This card changes no decision.** There is no keep rule. The appearance switch (`off | shadow | candidate | vote`)
is added with the default `off`, and nothing reads it. Pixels never confirm alone, in any mode.

## Sets, never pooled (OC35)

Both on RB-1's box set (F-0i's partition, less NB-3's `on-lip` boxes; `loadBoxSet`), every kept box.

- **`pilot-000`** (real use, F-0e's `bands+strips` boxes). Every figure is **machine agreement, never accuracy**
  (INV-17).
- **Yardstick (PROXY)**: the Library Dataset sample with F-0's B2 boxes and its inventory catalog. Stored apart, every
  record marked `evaluationOnly`, never trained on and never a gallery input.

No hand labels (OC36). Nothing is trained. No fetched cover or catalog image is used (G-IMG stays closed): the only
pixels are crops of the set's own photos.

**Looked at before fixing this text (disclosed).** Cache row counts per set (kept boxes, decisions, rungs, readings,
`confirmed-by-copy` and `confirmed-by-context` counts), and one synthetic three-rectangle image through the helper to
check that it runs. No strip, crop, photo, reading or embedding of either set was looked at.

## Records

One record per kept box, so one per physical copy (INV-4); copies of one work are never merged. Each record holds:

- **key** (INV-14): box id, the box-set hash (every kept box with its detection polygon and, where F-0i changed it,
  its exclusive outline) and the model revision (both checkpoints' Hugging Face revisions, their input specs, the
  strip method and the helper's hash). The records file's version is a hash of the two.
- the box's cached readings per reader (F-0's crop), its **decision basis** and work id by TS-0's label rule
  (`labelOf`: F-0's `readers-agree` accept first, else F-0g's `confirmed-by-copy` or F-0h's `confirmed-by-context`;
  a copy/context disagreement is a conflict with no work), the copy it takes its work from (`confirmed-by-copy`), its
  Q-2b coverage rung, and TS-0's export version and split where the label ledger holds the box;
- the strip's key, size and validity, and the two vectors' paths, dimensions and revisions.

Everything lives under the data root's `private/mm/<set>/`. A re-run with the same box, polygon, strip method and
model revision hits the cache and recomputes nothing.

## Pixels and models

- **Strip:** the detection polygon warped to an upright rectangle (long side top to bottom, the top being the short
  end nearer the image's top, as F-0g's `appearance.py` cuts it), at the working copy's scale with the long side
  capped at 512 px, stored as PNG. `valid` is false when under 80 % of it lies inside the frame. The detection
  rectangle is used, not F-0i's outline, because the readers read it and F-0i's crop did not ship.
- **DINOv2 base** (`facebook/dinov2-base`, Apache-2.0): the strip fitted inside a 112 × 448 canvas, aspect kept,
  padded with the ImageNet mean; the layer-normed CLS token.
- **SigLIP 2 base NaFlex** (`google/siglip2-base-patch16-naflex`, Apache-2.0): the processor's own aspect-preserving
  resize to at most 256 patches; the image tower's pooled output, in the space the text tower shares. NaFlex rather
  than the fixed 224 × 224 checkpoint, which would squash a spine into a square.
- Both vectors L2-normalised, float32, on MPS. Similarity is the cosine.

## Measures (per set, per model; never pooled across sets or models)

Only boxes with a valid strip. **Confirmed** boxes are those with a basis and a work id. Intervals are 95 %
percentile intervals of a **photo-cluster bootstrap**, 2,000 draws, seed 20261105: each draw resamples the set's
photos with replacement and weights a pair by how often its photos were drawn (m_a·m_b for two photos, m_a for one).

- **M0 counts.** Records by set, basis and rung; valid strips; conflicts; boxes with a TS-0 label; embedding
  dimensions; milliseconds per strip for cutting and for each model; GPU wall time.
- **M1 copy check.** Positives: each `confirmed-by-copy` box with the copy it took its work from (F-0g's `from`).
  Control: every other pair of boxes in one photo, any basis or none, pairs of one confirmed work left out. Reported:
  the AUC (P(a copy pair is nearer than a control pair), ties half) and both mean cosines. *Circular by design:*
  F-0g found these pairs with a pixel test (NCC, colour histogram, colour profile), so a high AUC is a sanity check
  that the embeddings see what that test saw, not independent evidence. The yardstick has no `confirmed-by-copy`
  boxes, so M1 is reported on `pilot-000` only.
- **M2 same work by text.** Positives: pairs of `readers-agree` boxes naming one work, in one photo or across photos;
  no pixel test chose them. Negatives: pairs of confirmed boxes (any basis) naming different works. Reported: the AUC
  and both mean cosines.
- **M3 lookalike rate.** The median cosine of same-work pairs of confirmed boxes (any basis) is the threshold, and the
  rate is the share of different-work confirmed pairs whose cosine is above it. The median is recomputed in every
  bootstrap draw. Also reported restricted to pairs within one photo, since a same-work pair across photos can be one
  physical copy photographed twice (overlapping shots), which would raise the median. This is the rate MM-2's stress
  test will start from.

## What would count as a surprise (written down, not a rule)

- M1 AUC below 0.8 on either model: the embeddings do not see what F-0g's pixel test saw; look at the strip cut
  before MM-2.
- M2 AUC near 0.5: appearance carries no same-work signal beyond chance on real-use crops; MM-2's gallery would need
  more than a nearest-neighbour vote.
- A lookalike rate above 20 %: one in five different-work pairs looks nearer than half the same-work pairs, which is
  the owner's "many books look alike" in numbers, and the reason pixels never confirm alone.

## Out of scope

Any decision change, a gallery or nearest-neighbour search (MM-2), text-to-image scoring with SigLIP 2's text tower
(MM-2), fetched or catalog images (G-IMG), training or fine-tuning, and the yardstick's annotations (not read).
