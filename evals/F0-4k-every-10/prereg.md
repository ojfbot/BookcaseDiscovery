# F0-4k-every-10: the still stages on every 10th 4K frame of `sf-store-003`, `sf-store-004` and `sf-store-005` (pre-registration)

This was fixed on 2026-11-15, before any model step of this card ran. The owner chose the run on #100's projection:
"Every 10th, all three".

This card measures and tunes nothing. No threshold, model, crop, tiling, reader cap or rule changes. **Every figure is
machine agreement between the stack's own stages and readers, never accuracy** (INV-17). There are no hand labels
(OC36). Nothing below changes after a result is seen. A later change is a deviation: it is logged under
`## Deviations` in `implementation-notes.md` and named in `report.md`.

**Question.** How do the still stages behave on every 10th 4K frame of each of the three 2026-11-11 sessions? The still
stages are steps 1 to 11 of `docs/ingest.md`, "Stage order". Their figures are compared with #100's 20-frame sample of
`sf-store-003` and with #98's 1080p frames of the same store. A second question: how close was #100's time projection
to the actual run? The answer is a list of observations and a time comparison, not a verdict. No figure here chooses
anything, so no measure has a threshold.

## 1. Sets, run and units

- **Three sample parts, one per session.** Each part is run, committed and **reported on its own**. Sessions are never
  pooled into one rate. Each part takes every 10th frame of its session's frame list, in list order: the 10th, 20th,
  and so on.

  | part | session's frames | part's frames | session's role |
  |---|---:|---:|---|
  | `sf-store-003.frames.every-10` | 823 | 82 | training source (NS-K3) |
  | `sf-store-004.frames.every-10` | 816 | 81 | held out (the store already held out as `sf-store-002`) |
  | `sf-store-005.frames.every-10` | 577 | 57 | held out (a new store; the conservative default until the owner rules) |

  A frame is a photo the session's private frame list names (`samplePart`, `src/eval/set-paths.ts`, from #100,
  unchanged). Each part caches beside its session under its own name. No part is declared, so no part is exported,
  trained on or manifested. The 1 fps sweeps put a part's neighbouring frames about 10 s apart.
- **References.** They are read from existing caches and not rerun. Their figures are recomputed by the same code.
  - **`sf-store-003.frames.every-41`** (#100): 20 4K frames of `sf-store-003`, about 41 s apart.
    `sf-store-003.frames.every-10` shares exactly 2 of its 82 frames with it: the 410th and the 820th, the multiples of
    410 within 823. The two parts are separate caches, and neither is deduplicated against the other.
  - **`sf-store-001.every-3`** (#98): 205 1080p frames of the same store as `sf-store-003`, about 3 s apart, shot on
    2026-11-07.
  - `sf-store-002` is the same store as `sf-store-004`, shot at 1080p on 2026-11-07. It has no F-0 run yet. It is
    named here only as a later comparison for `sf-store-004`, and nothing in this card compares against it.
- **Comparisons.** Each part against `sf-store-003.frames.every-41` (4K against 4K) and against `sf-store-001.every-3`
  (4K against 1080p). The three parts also stand side by side, which gives the store-to-store observations. Every rate
  is shown beside its count.
- **Run.** Steps 1 to 11 run in the documented order on this Mac, one model step at a time, with the sessions in the
  order `sf-store-003`, `sf-store-004`, `sf-store-005`. `--box-set pre-rb1` is used where the doc says (Q-2b's
  outlines and table, H-2's stage and base). F-0g and F-0h run on RB-1's box set. Every cache carries DL-3's lineage
  stamp, as the stages write it. The catalog is the local default, `catalog.sqlite`, unchanged from #98 and #100. A
  process guard refuses any network fetch, and the model helpers run offline. `caffeinate -i` wraps the runner. Each
  session's aggregates are committed when that session finishes.
- **Stop rule** (the brief's rule, not a measurement). If any step fails on a frame, the card stops and reports it.
- **Held out (OC35).** Before `sf-store-004` and `sf-store-005` run, the card confirms in code and tests that nothing
  these steps write can reach a training pool, an export or a gallery. Their figures are reported as aggregates only,
  and nothing is tuned on them.
- **Unit.** A box (a detected spine region) or an image (a frame). Frames of one sweep overlap. **No figure is
  deduplicated across frames.** A per-box share is not a per-book share.
- **Default boxes.** F-0e's `bands+strips` boxes and their readings, which every later step reads. F-0's own run is
  reported beside them.

## 2. Measures (each part and each reference, by the same code, from the caches)

These are #100's measures (`evals/F0-4k/prereg.md` §2), unchanged:

1. **Images**: in the part; processed (a detection row with no error, in F-0's run and in the default boxes); failed
   (a row with an error, or no row).
2. **Boxes per image**, on the default boxes and on F-0's own run: total, mean, p10, p50, p90, min and max.
3. **Reader coverage**, for each reader (`vision`, `ppocr`, `qwen`): the share of default boxes with a reading row, and
   the share with a reading (at least one variant with non-empty text). `qwen` reads at most 40 hard crops per image.
4. **Reader agreement.** On the base decision (F-0c, readers `vision` and `ppocr`): the share of boxes where both
   confirm the same work, out of all boxes and out of the boxes where both confirm a work. On F-0's own run: the same
   for each reader pair, plus the count where two or three readers agree.
5. **Base decision**: the share accepted, and the basis mix (`accepted`, `single-reader`, `readers-disagree`,
   `no-catalog-match`, `no-text`), each with its count. The same on F-0's own run.
6. **F-0i partition**: boxes kept and dropped, with their shares; dropped by reason; kept by role.
7. **NB-3 flags**: flagged boxes by cause (`pixel`, `depth`, `on-lip` and their combinations), and the size of RB-1's
   box set.
8. **F-0g copy groups**: groups, boxes in groups, group sizes, the basis mix of grouped boxes, and groups spanning more
   than one image (measured, not assumed). **Work recurrence**: how many accepted works are accepted in two or more
   images, and how many accepted boxes have their work accepted in another image too. This is machine agreement: two
   images may show two copies of one work.
   - The parts' frames are about 10 s apart, against about 41 s in #100 and about 3 s in #98, so recurrence depends on
     spacing. It is reported with the spacing beside it. Only the three parts here, at the same spacing, are set side
     by side as rates.
9. **F-0h**: boxes by basis, and usable boxes.
10. **Time**: wall seconds per step and per frame for each part (the runner's clock, every attempt summed, an
    interrupted attempt counted apart from a failed one), and peak resident memory per step (`/usr/bin/time -l`).
    Each part's seconds per frame are set against #100's 284.0 and #98's 149.05. So are the model seconds the caches
    record per frame.

## 3. The projection check

#100's projection rule is fixed in `evals/F0-4k/prereg.md` §3: each step's seconds on `sf-store-003.frames.every-41`
(20 frames) × (the part's frames ÷ 20), rounded per step and summed. #100 projected 23,287 s for 82 frames of
`sf-store-003`, 23,004 s for 81 frames of `sf-store-004` and 16,190 s for 57 frames of `sf-store-005`: 62,481 s
(17.36 h) in all.

For each part and for the three together, the check reports:

- **per step**: projected seconds, actual seconds, and actual ÷ projected;
- **in total**: projected against actual seconds and hours, and actual ÷ projected.

The figures are shown with the arithmetic. No figure is called good or bad. A step whose ratio stands out is named,
with possible reasons given as hypotheses: for example, a fixed start-up cost spread over more frames, or a step that
grows faster than its input.

## 4. Store-to-store observations (report.md)

`report.md` notes how the three sessions differ from each other and from the references. These are two stores, and
one of them is new: `sf-store-005`. Possible reasons, such as a different store, shelf layout, lighting or sweep, or
the catalog's coverage of each store's books, are hypotheses and named as hypotheses. Nothing is tuned, and no
threshold is proposed.

## 5. What the repo gets

Aggregates only: `evals/F0-4k-every-10/{prereg.md,metrics.json,report.md}`. Per-box and per-image outputs stay in the
stage caches under the data root. None of the following is written to the repo, the PR or the commits: a frame, crop,
OCR text, title, author, image id, file name, camera number, capture time, store name, GPS, permission detail or path.
