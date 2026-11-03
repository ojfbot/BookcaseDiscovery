# Demo wireframes

> **Illustrative, pre-ruling.** These are low-fidelity demo wireframes of the northstar experience. They are not the overlay UX spec: lenses, k, label states, visual treatment and hysteresis are set by U-1 (`docs/live/overlay-ux.md`, OC30) and built by T-5 and T-7a. Where these drawings and that spec disagree, the spec wins.
>
> **Synthetic content only.** The shelves are drawn. Titles and authors are invented, apart from a few public-domain classics. No photo, crop or OCR text from any shoot is used (OC9).

| Screen | Shows | Northstar property |
|---|---|---|
| [01 · Shelf in view](01-live-view.svg) | The phone pointed at a shelf. Under the active lens (Recommended), at most k spines are highlighted, each with one label; every other spine gets a quiet box. | P1: recommendations located on their spines. The live surface is the OC24 goal experience (S9). |
| [02 · Tap a spine](02-spine-detail.svg) | Tapping a spine opens its alternatives and evidence: band and status, candidates including the explicit `unknown`, readings by condition, catalog agreement and versions. | P2: identity is an evidence band, never a forced match. P1: the per-spine explanation. |
| [03 · Needs a closer look](03-closer-look.svg) | The "closer look" lens shows the spines the app could not settle, each with its reason (`missing-pixels`, `no-catalog-candidate`). A `needs-pixels` spine can request a 48 MP still. | P1: unresolved spines stay visible with reasons. G-LIVE item 3. |
| [04 · Picks with a why](04-recommendations.svg) | Recommendation cards, ranked against the reader's seeds. Each card has a "why" (what it shares with the seeds and where it departs; R-0's temperature), a band, a "show on shelf" link, and a was/now/why revision with undo. | P1: explained recommendations. INV-13 (taste ranks, never identifies) and INV-21/INV-24 (visible, batched revisions). |
| [05 · The batch report](05-batch-report.svg) | The local HTML report for a photographed bookcase: every spine boxed by status and band, a ranked list with click-to-locate, and the unresolved queue with reasons and work items. | P1 as the northstar states it: the G-MVP surface. W-1 built the scaffold; W-2 adds recommendations. |

P3 (built in public without leaking private data) is why every screen is drawn rather than photographed.

## Vocabulary

The terms are the plan's: status (`unresolved`, `resolved`, `paused`, `needs-pixels`), band (`verified`, `probable`, `candidate`, `unknown`), unresolved reasons, lens, k, and temperature (the ring MIDDLE; the sectors SIDEWAYS and FARTHER). See [`CONTEXT.md`](../../CONTEXT.md), [`docs/recommend/taste-model.md`](../recommend/taste-model.md) and `docs/plan/REQUIREMENTS.md` (OC30, OC31, INV-13, INV-21, INV-24).
