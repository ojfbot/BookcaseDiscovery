# F0-4k: the still stages on a sample of `sf-store-003` (4K frames and 48 MP stills): pre-registration

Fixed 2026-11-14, before any model step of this card runs. This card samples, measures, projects and stops: it tunes
nothing. No threshold, model, crop, tiling, reader cap or rule changes for 4K frames or for the stills. **Every figure
is machine agreement between the stack's own stages and readers, never accuracy** (INV-17). There are no hand labels
(OC36). Nothing below changes after a result is seen. A later change is a deviation: it is logged under
`## Deviations` in `implementation-notes.md` and named in `report.md`.

**Question.** How do the still stages (steps 1 to 11 of `docs/ingest.md`, "Stage order") behave on the 2026-11-11
capture level (4K frames at 2160 × 3840, about 8.3 MP, from 1 fps sweeps; and 48 MP stills of the same store), against
the same figures on 1080p frames of the same store (`sf-store-001.every-3`, F-0 on frames, #98) and on `pilot-000`
(31 stills of about 48 MP)? And how long would steps 1 to 11 take on the whole of `sf-store-003`, `sf-store-004` and
`sf-store-005`? The answer is a list of observations and a time projection for the owner's sizing decision, not a
verdict. No figure here chooses anything, so no measure has a threshold.

## 1. Sets, run and units

- **Two sample parts of `sf-store-003`** (training-source session, NS-K3), each run and **reported on its own; stills
  and frames are never pooled**:
  - **`sf-store-003.stills`**: all 16 stills of the session's image list, in list order.
  - **`sf-store-003.frames.every-41`**: the 41st, 82nd, …, 820th of the session's 823 frames, in list order: 20 frames.
  A frame is a photo the session's private frame list names; a still is one it does not (`samplePart`,
  `src/eval/set-paths.ts`). Each part caches beside the session under its own name, so its caches never mix with a
  later run's. Neither part is declared, so neither is exported, trained on or manifested.
- **References, read from their existing caches on the data root; nothing is rerun**:
  - **`sf-store-001.every-3`**: 205 frames at 1080 × 1920 (about 2.1 MP), the same store, the 2026-11-07 shoot. Its
    figures are #98's (`evals/F0-frames/metrics.json`), recomputed from the same caches by the same code.
  - **`pilot-000`**: 31 stills of about 48 MP.
- **Comparisons**: the frames part against `sf-store-001.every-3` (frames against frames: what changed from 1080p to
  4K at the same store), and the stills part against `pilot-000` (stills against stills). Both parts are also shown
  against both references, for completeness. Every rate is shown beside its count.
- **Run**: steps 1 to 11 in the documented order on this Mac, one model step at a time, first the stills part, then
  the frames part. The first pass uses `--box-set pre-rb1` where the doc says (Q-2b's outlines and table, H-2's stage
  and base). F-0g and F-0h run on RB-1's box set. Every cache carries DL-3's lineage stamp, as the stages write it. The
  catalog is the local one. A process guard refuses any network fetch, and the model helpers run offline. **Stop rule
  (the brief's, not a measurement)**: if any step fails on either part, the card stops and reports the failure.
- **Unit**: a box (a detected spine region) or an image (a frame or a still). Frames of one sweep overlap, and every
  41st frame is about 41 s apart, so neighbouring frames of this sample overlap much less than `sf-store-001.every-3`'s
  (about 3 s apart). **No figure is deduplicated across images.** A per-box share is not a per-book share.
- **Default boxes**: F-0e's `bands+strips` boxes and their readings, which every later step reads. **F-0's own run** is
  reported beside them, because it is the only step whose decisions use all three readers.

## 2. Measures (each part and each reference, the same code, from the caches)

The measures are #98's (`evals/F0-frames/prereg.md` §2), unchanged:

1. **Images**: in the part; processed (a detection row without an error, in F-0's run and in the default boxes);
   failed (a row with an error, or no row).
2. **Boxes per image**: on the default boxes and on F-0's own run: total, mean, p10, p50, p90, min, max.
3. **Reader coverage**: for each reader (`vision`, `ppocr`, `qwen`), the share of default boxes with a reading row,
   and the share with a reading (at least one variant with non-empty text). `qwen` reads only hard crops, up to 40 per
   image, so its share is reported with that cap noted.
4. **Reader agreement**: on the base decision (F-0c, readers `vision` and `ppocr`): the share of boxes where both
   confirm the same work, of all boxes and of the boxes where both confirm a work. On F-0's own run: the same for each
   reader pair, and the count where two or three readers agree.
5. **Base decision**: the share accepted, and the basis mix (`accepted`, `single-reader`, `readers-disagree`,
   `no-catalog-match`, `no-text`), each with its count. The same on F-0's own run.
6. **F-0i partition**: boxes kept and dropped, with their shares; dropped by reason; kept by role.
7. **NB-3 flags**: flagged boxes by cause (`pixel`, `depth`, `on-lip` and their combinations), **the `pixel`-cause
   share especially**, and the size of RB-1's box set.
8. **F-0g copy groups**: groups; boxes in groups; group sizes; the basis mix of grouped boxes; groups that span more
   than one image (expected 0 by construction; measured, not assumed). **Work recurrence**: of the works the base
   decision accepts, how many are accepted in two or more images, and how many accepted boxes have their work accepted
   in another image too. Machine agreement: two images may show two copies of one work. At about 41 s spacing, the
   frames part's recurrence is not comparable in level with `sf-store-001.every-3`'s (about 3 s); it is reported, not
   compared as a rate.
9. **F-0h**: boxes by basis and usable.
10. **Time**: wall seconds per step, and per image, for each part (the runner's clock), and peak resident memory per
    step (`/usr/bin/time -l`). The frames part's seconds per frame are set against #98's 149 s per frame (30,556 s /
    205 frames). For each set, the model seconds that the caches record (detection seconds per image, reader seconds
    per crop) are compared per image.

**Comparison.** For each rate, the figures side by side and the difference (the part minus the reference), with the
counts beside every share. There are no confidence intervals and no difference is called significant: nothing is
tested, the samples are small (16 and 20 images), and the frames are not independent.

## 3. The projection (frames only)

From the frames part's per-step wall seconds, linear in frames: each step's seconds × (frames to run ÷ 20), summed.
For each of `sf-store-003` (823 frames), `sf-store-004` (816) and `sf-store-005` (577), three run sizes: all frames,
every 3rd frame (⌊n / 3⌋) and every 10th frame (⌊n / 10⌋). The arithmetic is shown in `report.md`. The projection is
linear; a step whose time grows faster than its input (F-0h was noted as possibly superlinear in #98) makes it a lower
bound, and the report says so. The 16 stills are measured, not projected: there are no more stills in the shoot.
**No larger run starts in this card**; the owner chooses its size.

## 4. The capture-tier note (report.md)

What changed from 1080p frames (`sf-store-001.every-3`) to 4K frames at the same store, and how the 2026-11-11 stills
compare with `pilot-000`'s: the rates that moved most, in either direction, and the time per image. Stated as
observations, with no tuning and no proposed threshold. Reasons it gives (more pixels per spine, a different shoot,
a different lighting or sweep, the sample's spacing) are hypotheses and named as hypotheses.

## 5. What the repo gets

Aggregates only: `evals/F0-4k/{prereg.md,metrics.json,report.md}`. Per-box and per-image outputs stay in the stage
caches under the data root. No frame, still, crop, OCR text, title, author, image id, clip, still or frame name,
camera number, capture time, store, GPS or path is written to the repo, the PR or the commits.
