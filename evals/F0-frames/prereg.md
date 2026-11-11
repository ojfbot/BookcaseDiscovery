# F0-frames: the still stages on `sf-store-001` (video tier): pre-registration

Fixed 2026-11-11, before the full run on `sf-store-001`. A 20-frame pilot ran first, to check the data scaling and
the time, and it is the only run so far. Its figures are not looked at for any measure below except time. This
card measures; it tunes nothing. No threshold, model, crop, tiling, reader cap or rule changes for frames. **Every
figure is machine agreement between the stack's own stages and readers, never accuracy** (INV-17). There are no hand
labels (OC36). Nothing below changes after a result is seen. A later change is a deviation: it is logged under
`## Deviations` in `implementation-notes.md` and named in `report.md`.

**Question.** How do the still stages (steps 1 to 11 of `docs/ingest.md`, "Stage order") behave on about 2 MP video
frames (1080×1920, 1 fps sweeps), against the same figures on `pilot-000` (31 stills of about 48 MP) from the caches
`pilot-000` already has? The answer is a list of observations for the video pipeline, not a verdict. No figure here
chooses anything, so no measure has a threshold.

## 1. Sets, run and units

- **`sf-store-001`**: training-source session (NS-K), 616 frames from 15 clips; every frame of its public manifest,
  in list order (`sessionImages`). **`sf-store-002`** (held-out) is not run.
- **`pilot-000`**: 31 stills. Its figures are read from its existing caches on the data root. Nothing is rerun.
- **Run**: steps 1 to 11 in the documented order on this Mac, one model step at a time. The first pass uses
  `--box-set pre-rb1` where the doc says (Q-2b's outlines and table, H-2's stage and base). F-0g and F-0h run on
  RB-1's box set. Every cache carries DL-3's lineage stamp, as the stages write it. The catalog is the local one. A
  process guard refuses any network fetch, and the model helpers run offline.
- **Pilot**: the sample part `sf-store-001.every-30` (the 30th, 60th, …, 600th frame: 20 frames). It caches beside
  the session under its own name, so its caches never mix with the full run's. Only its time is used: to project the
  full run (per-step seconds × 616 / 20). The card's own stop rule (the brief, not a measurement) applies: stop if the
  projection is over 10 hours or a step fails.
- **Unit**: a box (a detected spine region) or a frame. Frames of one sweep overlap, so one physical book is counted
  once per frame it appears in. `pilot-000`'s stills also overlap, less. **No figure is deduplicated across frames.**
  This is why a per-box share on frames is not a per-book share.
- **Default boxes**: F-0e's `bands+strips` boxes and their readings (`f0e/<set>/bands+strips/`), which every later
  step reads. **F-0's own run** (`f0/<set>/`) is reported beside them, because it is the only step whose decisions use
  all three readers.

## 2. Measures (both sets, the same code, from the caches)

1. **Frames**: in the manifest; processed (a detection row without an error, in F-0's run and in the default boxes);
   failed (a row with an error, or no row).
2. **Boxes per frame**: on the default boxes and on F-0's own run: total, mean, p10, p50, p90, min, max.
3. **Reader coverage**: for each reader (`vision`, `ppocr`, `qwen`), the share of default boxes with a reading row,
   and the share with a reading (at least one variant with non-empty text). `qwen` reads only hard crops, up to 40 per
   photo, so its share is reported with that cap noted.
4. **Reader agreement**: on the base decision (F-0c `base-decisions.jsonl`, readers `vision` and `ppocr`): the share
   of boxes where both confirm the same work, of all boxes and of the boxes where both confirm a work. On F-0's own
   run: the same for each reader pair, and the share where two or three readers agree.
5. **Base decision**: the share accepted, and the basis mix: the count and share of each outcome (`accepted`,
   `single-reader`, `readers-disagree`, `no-catalog-match`, `no-text`). The same on F-0's own run.
6. **F-0i partition**: boxes kept and dropped, with their shares; dropped by reason (`piece-of`, `duplicate`,
   `merged-parent`, `absorbed`); kept by role.
7. **NB-3 flags**: flagged boxes by cause (`pixel`, `depth`, `on-lip` and their combinations), and the size of
   RB-1's box set (F-0i's kept boxes less NB-3's `on-lip`).
8. **F-0g copy groups**: groups; boxes in groups; group sizes; the basis mix of grouped boxes (`readers-agree`,
   `confirmed-by-copy`, none). **Groups that span more than one frame, and the boxes in them.** F-0g pairs neighbours
   inside one photo, so this figure is expected to be 0 by construction. It is measured, not assumed. The cross-frame
   signal the later tracking and fusion card needs is therefore also measured as **work recurrence**: of the works the
   base decision accepts, how many are accepted in two or more frames, and how many accepted boxes have their work
   accepted in another frame too. Recurrence is machine agreement: two frames may show two copies of one work.
9. **F-0h**: boxes by basis (`confirmed-by-context`, none) and usable.
10. **Time**: wall seconds per step and per frame on `sf-store-001` (the runner's clock), and peak resident memory
    per step (`/usr/bin/time -l`). The pilot's projection is set against the actual time. For both sets, the model
    seconds that the caches record (detection seconds per photo, reader seconds per crop) are compared per frame.

**Comparison.** For each rate, both figures side by side and the difference (`sf-store-001` minus `pilot-000`). Counts
are in `metrics.json`. There are no confidence intervals: nothing is tested, and the frames are not independent.

## 3. The video-tier note (report.md)

The note says what changed against `pilot-000`, and which steps look most sensitive to the 2 MP frames: those whose
rates moved most, in either direction. It states these as observations, with no tuning and no proposed threshold.
Reasons it gives for a change (fewer pixels per spine, motion blur, overlapping frames) are hypotheses. It names them
as hypotheses.

## 4. What the repo gets

Aggregates only: `evals/F0-frames/{prereg.md,metrics.json,report.md}`. Per-box and per-frame outputs stay in the
stage caches under the data root. No frame, crop, OCR text, title, author, image id, clip or frame name, capture time,
store or path is written to the repo, the PR or the commits.
