# NS3: Q-1's centre / edge / half-distance test — pre-registration

Fixed 2026-11-05, before the shoot. **No measurement was taken for this card.** No shoot data exists. Nothing below
changes after seeing a result; a change is a deviation in `implementation-notes.md`, and the report
(`evals/NS3/report.md`) says which figures it touches. The stills are in `docs/capture-protocol.md` §6.

**Not measured here.** The two uncoached sweeps per case and phone (§6) are recorded and ingested (K-3: hashes, no
audio track) and nothing else. Their measures belong to T-2, V-5′ and G-SWEEP and are pre-registered there.

**Question.** Q-1 found text read on 62 % of boxes beyond 0.56 of the half-diagonal against 83 % inside (pilot-000;
**H2**, position), and a weak penalty for a short side under 92 px (70 % against 76 %; **H6**, resolution; untested,
expected to bind on 12 MP whole cases; `evals/Q1/report.md`). Position and size travel together in a normal photo.
Does the outer-ring penalty survive when box size is held fixed, and does the size penalty survive when position is?

## Design

One stretch of about eight spines on one shelf, main 1×, 48 MP, controlled (protocol stills, `arm: q1-*`): stills 1–4
= {centre, edge of frame} × {normal distance, half distance}. Still 5 = the 12 MP whole-case shot of §4. Same visit,
same light. "0.5× distance" is read as half the distance, not the 0.5× lens button; all five use the main lens.

## Measure (within each still; no book is merged across stills, which is unplanned: `docs/capture/coverage.md` §5)

Boxes are RB-1's kept boxes per still. *Outcome* = rung `text-read` or above. Features are Q-1's, from the working
copy (`helpers/coverage/features.py`): **radial** = distance of the box centre from the frame centre over the half
diagonal, *outer* above **0.5612** (Q-2's `EDGE_RADIAL`); **short side** in pixels. Strata are short-side tertiles
over the pooled boxes of stills 1–4 (Q-1's `quantileEdges`).

- **H2 test.** Within each short-side stratum, outcome share of outer boxes minus inner boxes; pooled by box count.
- **H6 test.** Within each radial class (outer, inner), outcome share of boxes under 92 px short side minus 92 px and over.
- **12 MP.** Outcome share by short-side stratum for still 5 against the same strata in stills 1–4, and the share of
  still 5's boxes under 92 px.
- **Edge against lens distortion.** `pilot-000` is 27 ultra-wide and 4 main-lens photos and Q-1 did not split by lens:
  the same outer-minus-inner gap is recomputed by lens class on `pilot-000`'s cached features (no new run) and set
  beside the controlled main-lens result.

Every figure is **machine agreement, never accuracy** (INV-17, OC36). No interval: five stills are five clusters and
boxes share their still's light and focus. Counts are given for every cell; a cell under 20 boxes is reported empty.

## Verdicts (hypotheses to check, not tuned)

- **H2 holds** if the pooled outer-minus-inner gap is at least **10 points** and positive in every stratum with at
  least 20 boxes on each side. **H6 holds** by the same rule for the size gap in both radial classes.
- Both, one, or neither can hold. **H2 holding on the main lens** says the outer-ring penalty is not only the
  ultra-wide's distortion, provided the main lens's own distortion is small (a hypothesis; not measured here).
  **H2 failing on the main lens while `pilot-000`'s ultra-wide gap stands** points at distortion or the lens.
- The overlay's first cheap coverage signal (Q-1's H2 and H6 candidates) is kept, changed or dropped on these.

## What it cannot say

One stretch of one shelf, one phone, one visit: a direction. The main lens is not the ultra-wide, so lens
distortion proper is only inferred by contrast with `pilot-000`. A hand-held "edge" varies by a thumb width.
