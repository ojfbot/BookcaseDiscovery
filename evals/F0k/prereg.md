# F0k: missed-book recovery — pre-registration

Fixed 2026-11-04, before any GPU call and before any full-set run. Nothing below changes after seeing a result. Any
change is logged as a deviation in `implementation-notes.md`, and the report (`evals/F0k/report.md`) says which
figures it touches.

**Question.** Q-3 found that 86 % of `pilot-000` books stop below `confirmed`, and some were never boxed. Do the
places that existing cards already flag as "a book should be here" hold books the detector missed? Re-prompt the
detector there, keep F-0i's instance rules, read the new boxes with F-0's readers and accept rule unchanged, and
count what is confirmed.

**Sets, never merged (OC35).**

- **`pilot-000`** (31 real-use photos): F-0e's default `bands+strips` boxes, after the shipped not-a-book filter and
  F-0i's partition (F-0i's kept boxes, exclusive outlines and label maps). Readers and decisions: H-2's
  `base-decisions` on F-0e's cached readers. Every reader figure is **machine agreement, never accuracy** (INV-17).
  A dev set (OC11).
- **Yardstick (PROXY)**: the 40-image Library Dataset sample with F-0's B2 boxes, after the same filter and F-0i's
  partition. *Confirmed* = accepted and annotated in the image; *wrong* = accepted, not annotated. Evaluation only:
  never trained or tuned on.

No hand labels (OC36). Nothing is trained. **Existing box ids (`photo:index`) never change**, and no existing box,
outline or cached reading is edited. A **recovered box** gets a new id: `photo:<n + k>`, where `n` is the photo's
detection count and `k` counts the photo's candidate pool (below) in a fixed order. Every recovered box carries
`recoveredBy: "f0k"`, its arm's source, its region and its tile. Downstream caches (F-0g, Q-2b, H-2, S-1, F-0h) are
**not** re-run on the new box set; the conductor batches that after F-0m, F-0k and NB-3.

**Looked at before fixing this text (disclosed).** The three input files' row counts and fields, their counts per
photo (below), and one F-0i label map's value range. No image, crop or region was looked at; no model was run.

## Candidate regions (the arms' sources)

All in working-copy pixels. A **candidate region** is a place an earlier card flagged as possibly holding a book no
kept box stands for. A region never confirms anything: only a box the detector finds there, read by two agreeing
readers under F-0's bar, can.

1. **`row-gaps`** — F-0h's detection-gap flags (`private/f0h/<set>/detection-gaps.jsonl`; `pilot-000` holds 3, the
   yardstick 0):
   - `box-gap` (a gap of at least F-0h's width between two consecutive boxes inside a bracket): the rectangle between
     the two boxes `between[0]`, `between[1]` of the stage's `detect.jsonl`. Along the unit axis `u` from the first
     box's centre to the second's, it runs from the first box's greatest projection to the second's least; across
     (`n`, perpendicular), from the least to the greatest projection of both boxes' corners. Skipped (counted) when
     that along-range is empty.
   - `s1-front-outline-gap` (S-1's front-facing outline gap inside a bracket): the S-1 stretch it came from, found in
     S-1's own `shelf.jsonl` row on that band (kind `outline-gap`, dominant `front`, width equal to the flag's, its
     middle between the two bracket boxes along the row line, the first such), rebuilt with Q-3's `gapPolygon`.
2. **`front-stretches`** — S-1's front-face stretches with no outline, as S-2 recomputed them on the partition
   (`private/s2/<set>/gaps.jsonl`, `frontNoBox` true; 153 on `pilot-000`, 14 on the yardstick), rebuilt with Q-3's
   `gapPolygon` on S-2's `shelf.jsonl` row line and the photo's median spine width, exactly as Q-3 rebuilt them.
3. **`headroom`** — S-2's occupied headroom regions no box explains (`private/s2/<set>/regions.jsonl`, `candidate`
   true; 206 on `pilot-000`, 43 on the yardstick), as their `contour` scaled back to working-copy pixels. **S-2 did
   not meet adequacy** (recall), so these are candidates only.

**Region caps per photo.** At most **12 regions per source per photo**, largest polygon area first (ties: file
order). Counted before capping: `front-stretches` reaches 12 on two `pilot-000` photos, `headroom` exceeds 12 on four
(at most 16). The union arm takes every region its sources keep (so at most 36 per photo).

**Arms.** `row-gaps`, `front-stretches`, `headroom` (each source alone), and `all` (the three together). The base is
the current box set (no recovery).

## The recovery pass

### Re-prompt (GPU: `helpers/label/recover.py detect`)

One **re-prompt tile** per region, with F-0e's tiling settings for the set:

- **`pilot-000`** (`CASE_TILING`, band layout): tiles 1600 px wide. Horizontally, one tile centred on the region's
  bounding box, clamped to the image; a region wider than 1600 px gets tiles stepping 900 px (1600 − 700) across it.
  Vertically, the union of the region's band polygon's extent (the stage's `bands[band]`, when the region has one)
  and the region's bounding box, grown by F-0e's band margin (12 % of that height) above and below, clamped.
- **Yardstick** (`SHELF_TILING`, the 3100/1300 grid): a 3100 px square tile centred on the region's bounding box,
  clamped; a larger region gets tiles stepping 1800 px.

On each tile, detect.py's `candidates` unchanged: Grounding DINO base, prompt `book spine.`, box threshold 0.15, text
threshold 0.15, boxes over 35 % of the tile dropped, SAM 2.1 base-plus masks on the boxes, each mask's largest contour
and its minimum-area rectangle; a box within 6 px of an inner tile edge is `cut`. The mask's largest outer contour is
kept with the candidate.

A candidate belongs to its region when its rectangle's centre lies inside the region polygon grown by half the
photo's median spine width (`gaps.medianWidth`). Then, per region, detect.py's own filters with the **photo's** median
spine width: `narrow` (short side at most 2.5 widths), `strips` (cut and lying flat beyond 60°: dropped), and
`as_spines`' aspect floor (1.5). What survives is the region's **candidate pool**. Pools are computed once per region,
so every arm draws on the same candidates and the same ids.

### Gate (CPU: `recover.py gate`, F-0i's constants, existing boxes fixed)

Per arm and photo, on the pools of that arm's regions:

1. **Among new candidates:** detect.py's `nms` (whole before cut, then box score; IoU 0.45; a cut box yields to one
   holding 30 % of it).
2. **Against the existing kept boxes**, from F-0i's label map (each kept box's exclusive pixels; value = index + 1):
   - **duplicate**: IoU ≥ 0.5 with one kept box, or intersection over the smaller ≥ 0.85 with an area ratio < 1.3:
     dropped;
   - **piece-of**: ≥ 0.8 of the candidate's mask inside one kept box: dropped.

   F-0i would have turned a wide existing parent into a remainder; existing boxes never change here, so a candidate
   is the only side that can lose.
3. **Exclusive mask:** the candidate's mask minus every kept box's pixels and minus the pixels of new boxes ranked
   before it (box score × mask score, then pool order). Its **kept share** (exclusive ÷ original) under 0.3 (F-0i's
   `ABSORB_KEEP`): dropped as `absorbed`. Otherwise it is a recovered box. Its outline is the exclusive mask's largest
   component; its **polygon** (the reader crop's box) is that component's minimum-area rectangle, so it holds no
   existing box's pixels by construction. Overlap rate with the existing outlines: 0 by construction.
4. **Not-a-book:** the shipped rules. F-0c's geometric flags (`kinds` in `src/eval/f0c.ts`, covers off) on the photo's
   detection with that arm's recovered boxes appended: a flagged recovered box is never read. After Vision and
   PP-OCR, F-0f's shelf-label rules (`labelWhy`, from their text and the pixel probe `probe.py`) mark more; those go
   to no Qwen and count as not-a-book. S-1's `on-lip` is not wired into the default, so it is not applied.

### Readers and decisions (F-0's, unchanged)

- **Crop:** the shipped `rect;rot=fixed;clip=frame` on the recovered box's polygon.
- **Vision and PP-OCR** read every recovered box that is not flagged.
- **Qwen**, per photo, under F-0's cap (40 on `pilot-000`, 15 on the yardstick). The competitors are the photo's
  existing kept boxes that hold a cached Qwen reading (the cached selection) and the arm's recovered boxes that are
  first-pass hard, still spine-kind after the shelf-label rules and read some text; sorted by box score, the top
  `cap` get Qwen. A recovered box in the top `cap` is read. **An existing box pushed out of the top `cap` is
  displaced:** it is re-decided from its cached Vision and PP-OCR readings without its Qwen reading. (F-0b's
  procedure kept every other box's cached state; here a recovered box that takes a Qwen slot costs the box it takes
  it from.)
- **Decision:** F-0's `decide` and catalog bar, unchanged (two readers agree on a work whose top candidate scores
  ≥ 0.72, with title ≥ 0.8 and coverage ≥ 0.5), basis `readers-agree` only. `pilot-000` on the shipped catalog;
  the yardstick on its inventory catalog, as F-0b.
- **Before:** the cached decisions of the existing kept boxes. **Reproduction check, reported:** the share of
  existing kept boxes whose cached accepted work `decide` reproduces from the cached readings used for displacement.

## GPU budget and the no-run fallback

The card holds the Yojimbo GPU lane. Before each GPU step: `pgrep` for any running mlx, torch or Qwen job (Fleet
Runner `read-qwen` included); if one runs, wait for it to finish.

- **Budget: 120 GPU-minutes for the whole card**, both sets, detection and Qwen together. Expected: about 400
  re-prompt tiles (≈ 15 min) and a few hundred Qwen crops (≈ 30 min).
- **Order:** yardstick detection, `pilot-000` detection, then Qwen (yardstick, then `pilot-000`).
- **No-run fallback:** an arm whose re-prompt detection did not finish inside the budget is reported **not run** with
  verdict **off**; the box set stays as it is and nothing ships for it.
- **No-Qwen fallback:** if detection finishes but Qwen cannot run inside the budget, every arm is decided with
  recovered boxes read by Vision and PP-OCR only and no displacement, and the report says so.

## Measures

Every interval is a 95 % paired photo-cluster bootstrap with 2,000 draws over per-photo changes (a photo drawn twice
counts twice, as F-0j fixed it), seed 61.

- **M1, `pilot-000` confirmed books:** distinct confirmed (photo, work) pairs over the whole set, per photo, summed;
  before (the existing kept boxes' cached decisions) → after (the same with displaced boxes re-decided, plus the
  recovered boxes' decisions). Reported beside it: confirmed recovered boxes, (photo, work) pairs lost to
  displacement, and **echo accepts** (a recovered box accepting a work an existing box in that photo already
  accepts; never a new pair).
- **M2, yardstick wrong accepts:** accepted and not annotated in the image, counted per photo, summed, before → after.
  Reported beside it: right accepts (accepted and annotated), title recall and precision per image (F-0e's
  `titleDelta`), and the wrong-accept share over all read boxes.
- **Reported, not in a rule:** per arm and set, regions (by kind, capped), tiles, candidates in regions, pool size,
  gate counts by reason, recovered boxes, not-a-book flags, text read, Qwen selected, displaced boxes, new confirmed
  and wrong accepts by source; recovered boxes by H-1 elevation where the depth stage covers them; GPU and CPU
  seconds.

## Keep rule (per arm)

An arm is **kept** when all of these hold:

- **K1:** on `pilot-000`, M1's change has its interval wholly above 0 (lower end > 0). Machine agreement (INV-17).
- **K2:** on the yardstick, M2's change does not rise beyond its interval (lower end ≤ 0).
- **K0:** the arm ran (not the no-run fallback).

Otherwise it is **off**. A kept arm's recovered boxes may join the default box set as an opt-in recovery pass, behind
the re-baseline the conductor batches. If several arms are kept, the one with the larger `pilot-000` M1 change is
recommended. `headroom` alone can be kept only through its readers: a region never confirms on its own.

**Not done here.** No downstream cache is re-run. The report lists which caches the recovered boxes would invalidate.

## Private outputs

The data root's `private/f0k/<set>/`: `regions.jsonl`, `tiles.jsonl` and `pool.jsonl` (the re-prompt), per arm
`<arm>/boxes.jsonl` (recovered boxes with provenance and outlines), `<arm>/detect.jsonl` (the detection with recovered
boxes appended), the readers and `decisions.jsonl`. Only aggregates reach the repo (`evals/F0k/report.md`,
`metrics.json`).
