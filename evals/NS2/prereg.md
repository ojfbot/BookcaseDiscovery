# NS2: low rows level arm — pre-registration

Fixed 2026-11-05, before the shoot. **No measurement was taken for this card.** No shoot data exists. Nothing below
changes after seeing a result; a change is a deviation in `implementation-notes.md`, and the report
(`evals/NS2/report.md`) says which figures it touches. The arm is in `docs/capture-protocol.md` §3b.

**Question.** Is `top-face` (642 of 6,064 books, 10.6 %, every one below eye level) a viewing-angle proxy: do boxes on
low rows stop spilling onto the top face, and read better, when the lens is level with the shelf instead of above it?
Also `single-reader`, 426 of its 740 boxes below eye level (`evals/Q3/report.md`). On `pilot-000` the share of boxes
lost (stopping below `confirmed`) is 76–83 % on S-1 rows 1–3 and 91–92 % on rows 4, 5 and 6+ (Q-3), and H-2's
reader-side fixes were neutral, so this decides whether capture or geometry owns the bucket.

## Design

Same case, same visit, same distance, same lens (main 1×, 48 MP, protocol stills). For each shelf at S-1 row 4 or
below (`shelfIndex` ≥ 4, 0 = top; the lowest two if the case is shorter), the **standing** shot of §3 and a **level**
shot of §3b are a pair. One extra standing shot of the first level-shot shelf (`per-shelf-repeat`) is the **noise
reference**. Real use (shopper stills) is not part of this arm, so the arm is **controlled** and says so.
Machine agreement, never accuracy (INV-17, OC36).

## Measures

Per shelf and shot, over boxes kept by RB-1's box set on that still:

- **Readable share** = boxes at rung `text-read` or above (Q-0's fill line) over all kept boxes. **Gain** *d* = level
  minus standing, per shelf; reported per `shelfIndex` and pooled (boxes summed).
- **`top-face` share** and **`single-reader` share**: Q-3's primary-cause rules, unchanged (`top-face` is H-2's `top`
  share ≥ 0.15 and the largest non-front share), over the same boxes; level against standing.
- **Noise reference** = |readable share (repeat) − readable share (first standing shot)| on the one shelf shot twice.
- **Tilt.** Each still's `tilt` (`pitchDegrees`, `rollDegrees`, `source`; the field is specified in the protocol §9)
  in the private manifest. Reported: pitch of the standing and level shots per shelf, and the readable share against
  |pitch|, where `source` is not `none`. Never in a public file.

No interval: a case gives two or three shelves and the cluster is the shelf. Per-shelf pairs are reported with box counts.

## Hypothesis (judged after the shoot)

**H-NS2: `top-face` is a viewing-angle proxy** — on the same shelves, the level shots carry less than half the
standing shots' `top-face` share, with every paired shelf lower (the "half" is a hypothesis, not a measurement).

## Verdict

- **Supported** (capture owns the bucket; the app's nudge or coach should ask for a lower, level view) if H-NS2
  holds and the pooled gain in readable share exceeds the noise reference.
- **Not supported** (geometry owns it; a box-shape fix in the pipeline) if the level shots' `top-face` share is not
  lower in every pair, or is no less than half.
- **Undecided** if no shelf in the standing shots has a `top-face` share (the contrast is empty) or the gain is
  inside the noise reference; the report says which.

## What it cannot say

Two or three shelves of one case: a direction, not an estimate for other cases. Level and standing shots differ
also in what they see of each shelf's lip and the shelf below it. The tilt `source` is unproven on this phone
(protocol §9). Whether a shopper will crouch is the app's question, not this card's.
