# C11: the Open Library catalog (v2) on the store samples, re-decided from cache (pre-registration)

This was fixed on 2026-11-16, before any re-decision of this card ran. The owner's ruling: "After every-10th, add it".

This card measures and tunes nothing. No threshold, reader, crop, catalog or rule changes, and F-0's `ACCEPT` bar is
unchanged. **The default catalog stays `catalog.sqlite` (v1).** Switching is the owner's call, not this card's.
**Every figure is machine agreement between the readers and a catalog, never accuracy** (INV-17). There are no hand
labels (OC36), and a real-use set has no truth, so a box v2 gains is not judged right or wrong. Nothing below changes
after a result is seen. A later change is a deviation: it is logged under `## Deviations` in `implementation-notes.md`
and named in `report.md`.

**Question.** On each store sample, with F-0's cached readings and F-0's bar unchanged, how many boxes does v2
(`catalog-v2.sqlite`, ISFDB plus Open Library) confirm that v1 (ISFDB only) does not, how many does it lose or switch,
and which v1 `no-catalog-match` boxes move to which outcome? That sizes how much of the store `no-catalog-match` share
is a catalog gap. No measure here has a threshold, and no figure here chooses anything.

## 1. Sets, run and units

- **Six sets, each reported on its own.** Sets are never pooled, and stills and frames are never pooled.

  | set | from | kind | session's role |
  |---|---|---|---|
  | `sf-store-003.stills` | #100 | 16 48 MP stills | training source |
  | `sf-store-003.frames.every-41` | #100 | 20 4K frames | training source |
  | `sf-store-001.every-3` | #98 | 205 1080p frames | training source |
  | `sf-store-003.frames.every-10` | #101 | 82 4K frames | training source |
  | `sf-store-004.frames.every-10` | #101 | 81 4K frames | **held out** (OC35) |
  | `sf-store-005.frames.every-10` | #101 | 57 4K frames | **held out** (OC35) |

- **Unit: F-0's own run.** Each set's F-0 `decisions.jsonl` (three readers, qwen capped at 40 crops per image) and its
  reader caches, under the data root's `f0/<set>/`. Not F-0c's base decision on F-0e's default boxes; the two differ
  by 0 to 1 accepted boxes on #100's sets. A box is a detected spine region. Frames of one sweep overlap, and **no
  figure is deduplicated across frames**: a per-box share is not a per-book share.
- **Run.** `node src/eval/c5-eval.ts lookalike --set <set> --run C11 --min-reproduced 0.99`, one set at a time, in the
  table's order, on this Mac's CPU. No GPU, no model step, no stage rerun. A process guard refuses any network fetch
  (`--import` of a no-fetch module), with `HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 UV_OFFLINE=1`, as #98 and #100
  ran. `BOOKCASE_CATALOG` is never set: `c5-eval.ts` takes v1 as `catalog.sqlite` and v2 as `catalog-v2.sqlite`.
  - `--run C11` writes this card's parts under the data root's `catalog/c11/` (aggregates) and `catalog/c11/private/`
    (the re-decision cache: box ids, work ids, reasons), never under C-5's `catalog/c5/`.
  - `c5-eval.ts publish --run C11` joins only those parts into `evals/C11/metrics.json`. `publish` without `--run`
    (C-5's record) is never run by this card.
- **Gate.** The command first re-decides each set on v1 and records `reproducedCachedDecisions`: the share of boxes
  whose accepted work and reason equal F-0's cached decision. If it is **below 0.99** on a set, the command stops before
  v2 (`--min-reproduced 0.99`), and the card stops and reports it. `lookalike` picks the reading set (crop-clip, or all
  crops) that reproduces best, as it did for C-5; the one used is reported.
- **Time stop.** Each set's wall time is measured. If any set passes **2 hours**, the card stops and reports.
- **Held out (OC35).** `sf-store-004` and `sf-store-005` are re-decided for measurement only. Before they run, the card
  confirms that `lookalike --set` writes nothing that can reach training, an export or a gallery (see `report.md`).
  Their figures are aggregates only, and nothing is tuned after seeing them.

## 2. Measures (per set, counts beside every share)

1. **Confirmed** on v1 and on v2, and the paired difference in confirmed share, with the photo-cluster bootstrap (95 %,
   2,000 resamples, seed 1). Reported, not called significant.
2. **Transitions** v1 to v2: gained, lost, switched (and how many switched to an Open Library work), same.
3. **Outcome mix** on v1 and on v2 (`accepted`, `single-reader`, `readers-disagree`, `no-catalog-match`, `no-text`), and
   the full v1-outcome to v2-outcome flow.
   - **Headline:** the share of v1 `no-catalog-match` boxes that v2 accepts, with the photo-cluster bootstrap.
   - Secondary: the share of v1 `no-catalog-match` boxes that leave `no-catalog-match` for any outcome.
4. **Lost boxes** by the reason v2 gives.
5. **Open Library works** among v2's accepts.
6. **Top-candidate margin** quantiles (all readings, and readings whose top confirms), as C-5 reports them.
7. **Quoted, not recomputed:** the yardstick's (`yardstick-library-b2`, PROXY) wrong accepts per spine on v1 and v2
   (`evals/C5/metrics.json`), and on C-6's arm (c) and C-7's `c7` (`evals/C6/`, `evals/C7/`). The yardstick's wrong
   rate is not a prediction for the store, and the store's gained accepts are not judged.
8. **Wall time** per set (v1 re-decision and v2 re-decision), and whether a step was served from the private cache.

Not run (optional in the brief, left for a later card): the re-decision on `catalog-v2-c9.sqlite`, and C-6's and C-7's
arms on the store sets.

## 3. Public record

Aggregates only, in `evals/C11/{prereg.md,metrics.json,report.md}`. No titles, authors, work ids, reader text, image
ids, file names, store names, private paths or capture times.

## Amendment, 2026-11-16 (the conductor's ruling, before any figure was read)

The stills' v2 re-decision ran at about 0.5–0.7 s per box, so the two largest sets project near or past the 2-hour
stop. Asked before any set reached it, the conductor ruled:

- **The 2-hour stop applies per set.** A set that reaches it is stopped and reported as timed out, with its elapsed
  time, boxes done and rate. No partial v2 figure is reported for it, and nothing it leaves under the data root is
  deleted. The card goes on to the next set. The reproduction gate still stops the whole card.
- **Order:** `sf-store-003.stills`, `sf-store-003.frames.every-41`, `sf-store-003.frames.every-10`,
  `sf-store-005.frames.every-10`, then `sf-store-004.frames.every-10` and `sf-store-001.every-3`.
- Unchanged: the cap, the method, the sets, the measures. A timed-out set goes to a later card on the owner's word.
