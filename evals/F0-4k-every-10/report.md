# F0-4k-every-10: the still stages on every 10th 4K frame of `sf-store-003`, `sf-store-004` and `sf-store-005`

**Scope, 2026-11-15 to 2026-11-16: the owner's sizing decision on #100's projection ("Every 10th, all three"), run
to the end.** Three sample parts ran, one per session, each on its own: `sf-store-003.frames.every-10` (82 of 823
frames), `sf-store-004.frames.every-10` (81 of 816) and `sf-store-005.frames.every-10` (57 of 577). Sessions are never
pooled into one rate. Steps 1 to 11 of `docs/ingest.md` ("Stage order") ran on all three, and every one of the 24
commands exited 0 on its first and only attempt on every part. Every figure below is **machine agreement** between the
stack's own stages and readers, **never accuracy** (INV-17). There are no hand labels (OC36). Every figure is measured
from the caches, and all counts are in `metrics.json`. The references, `sf-store-003.frames.every-41` (#100) and
`sf-store-001.every-3` (#98), were read from their existing caches and not rerun. Their figures in `metrics.json` are
identical, field for field, to those in `evals/F0-4k/metrics.json`. Nothing was tuned. The pre-registration is
`prereg.md`, committed before any model step ran.

## Run

- **Where**: this Mac (48 GiB), one model step at a time, nothing else on the GPU, with `caffeinate -i` around the
  runner. The sessions ran one after another: `sf-store-003`, then `sf-store-004`, then `sf-store-005`. Each session's
  aggregates were committed when it finished. The catalog was the local default, `catalog.sqlite`, unchanged from #98
  and #100. A process guard refused any network fetch, and none was attempted in any part. The model helpers ran
  offline. Nothing was downloaded, and `contracts/` is unchanged. `--box-set pre-rb1` was used where the doc says
  (Q-2b's outlines and table, H-2's stage and base); F-0g and F-0h ran on RB-1's box set.
- **Frames**: 82 of 82, 81 of 81 and 57 of 57 were processed, and 0 failed, both in F-0's own run and in the default
  boxes. No attempt failed and none was interrupted. No step read a stale or unstamped cache, so the stale-cache
  allowance was never used. The only warning in the logs is the SAM2 checkpoint-type notice, which #98 and #100 also
  logged.
- **Unit**: a box or a frame. Frames of one sweep overlap, and neighbouring frames of these parts are about 10 s apart.
  No figure is deduplicated across frames, so a per-box share is not a per-book share.
- **Overlap with #100**: `sf-store-003.frames.every-10` shares exactly 2 of its 82 frames with
  `sf-store-003.frames.every-41` (the 410th and the 820th). The two parts are separate caches, and neither is
  deduplicated against the other.

## Held out (OC35)

`sf-store-004` and `sf-store-005` are held out. Before they ran, the card confirmed in code and tests that nothing
steps 1 to 11 write can reach a training pool, an export or a gallery. The tests are in
`test/f0-4k-every-10.test.ts`.

- `set-roles.ts` declares both sessions `held-out`, and `assertTrainable` refuses them.
- The every-10 parts are not declared, so `assertTrainable` and `assertManifestable` refuse them. That holds for
  `sf-store-003`'s part too.
- F-1's `DATASET.heldOutSessions` names only `sf-store-002`. But TS-0's build, the only caller of `buildManifestPhotos`,
  unions it with the registry's `heldOutSessions()`, so `sf-store-004` and `sf-store-005` are frozen `held-out` in its
  split.
- The appearance gallery takes the `train` split only, and MM-2 calls `assertTrainable` on every record.
- Steps 1 to 11 open the session ledger read-only. They write only to the part's own stage caches, never to the label
  ledger, a dataset or a gallery.

The held-out parts' figures are reported here as aggregates only, and nothing was tuned on them.

## Time

Seconds are wall seconds from the runner's clock. Every step ran once, so there was nothing to sum across attempts.
Peak memory is the peak resident size from `/usr/bin/time -l`; on every part it was reached in F-0c read.

| part | frames | seconds | hours | s per frame | × #100's 284.0 | × #98's 149.05 | peak resident MB |
|---|---:|---:|---:|---:|---:|---:|---:|
| `sf-store-003.frames.every-10` | 82 | 24,129 | 6.70 | 294.3 | 1.04 | 1.97 | 12,384 |
| `sf-store-004.frames.every-10` | 81 | 28,562 | 7.93 | 352.6 | 1.24 | 2.37 | 11,809 |
| `sf-store-005.frames.every-10` | 57 | 17,568 | 4.88 | 308.2 | 1.09 | 2.07 | 12,121 |
| all three | 220 | 70,259 | 19.52 | 319.4 | 1.12 | 2.14 | |

Model seconds per frame, as the caches record them (detection on the default boxes, then each reader):

| part | detect | `vision` | `ppocr` | `qwen` |
|---|---:|---:|---:|---:|
| `sf-store-003.frames.every-10` | 9.52 | 10.22 | 56.96 | 39.35 |
| `sf-store-004.frames.every-10` | 13.24 | 12.27 | 71.74 | 44.48 |
| `sf-store-005.frames.every-10` | 8.46 | 34.09 | 59.46 | 38.35 |
| `sf-store-003.frames.every-41` (#100) | 10.18 | 9.65 | 57.05 | 39.70 |
| `sf-store-001.every-3` (#98, 1080p) | 3.62 | 4.23 | 25.61 | 28.72 |

The per-step seconds of every part, with each step set against #98, are in `metrics.json` (`time`).

## The projection check

#100's rule (`evals/F0-4k/prereg.md` §3): each step's seconds on `sf-store-003.frames.every-41` (20 frames) × (the
part's frames ÷ 20), rounded per step and summed. The check reproduces #100's projected figures exactly: 23,287 s,
23,004 s and 16,190 s, which make 62,481 s in all (a test pins this). Ratio = actual ÷ projected.

| step | `003.every-10` projected → actual (ratio) | `004.every-10` projected → actual (ratio) | `005.every-10` projected → actual (ratio) |
|---|---:|---:|---:|
| F-0 | 7,671 → 8,725 (1.14) | 7,578 → 8,806 (1.16) | 5,332 → 5,456 (1.02) |
| F-0e detect bands | 849 → 786 (0.93) | 838 → 1,076 (1.28) | 590 → 485 (0.82) |
| F-0e detect bands+strips | 12 → 9 (0.75) | 12 → 6 (0.5) | 9 → 5 (0.56) |
| F-0e read bands+strips | 7,019 → 6,992 (1) | 6,934 → 8,503 (1.23) | 4,879 → 6,525 (1.34) |
| F-0c detect | 295 → 267 (0.91) | 292 → 343 (1.17) | 205 → 167 (0.81) |
| F-0c read | 1,037 → 1,011 (0.97) | 1,025 → 1,987 (1.94) | 721 → 635 (0.88) |
| F-0c base | 648 → 637 (0.98) | 640 → 954 (1.49) | 450 → 579 (1.29) |
| F-0f probe | 8 → 10 (1.25) | 8 → 14 (1.75) | 6 → 6 (1) |
| Q-2b features | 37 → 33 (0.89) | 36 → 34 (0.94) | 26 → 20 (0.77) |
| Q-2b outlines | 2,386 → 2,542 (1.07) | 2,357 → 3,546 (1.5) | 1,659 → 1,673 (1.01) |
| Q-2b table | 4 → 1 (0.25) | 4 → 1 (0.25) | 3 → 1 (0.33) |
| H-2 stage | 57 → 50 (0.88) | 57 → 48 (0.84) | 40 → 33 (0.83) |
| H-2 base | 636 → 631 (0.99) | 628 → 926 (1.47) | 442 → 576 (1.3) |
| F-0i plan | 8 → 7 (0.88) | 8 → 5 (0.63) | 6 → 2 (0.33) |
| F-0i tiles | 652 → 607 (0.93) | 644 → 555 (0.86) | 453 → 274 (0.6) |
| F-0i resolve | 361 → 384 (1.06) | 356 → 329 (0.92) | 251 → 179 (0.71) |
| NB-3 stage | 8 → 6 (0.75) | 8 → 7 (0.88) | 6 → 4 (0.67) |
| NB-3 shelf | 185 → 188 (1.02) | 182 → 223 (1.23) | 128 → 130 (1.02) |
| NB-3 probe | 8 → 10 (1.25) | 8 → 13 (1.63) | 6 → 6 (1) |
| NB-3 flags | 4 → 0 (0) | 4 → 1 (0.25) | 3 → 1 (0.33) |
| F-0g pairs | 8 → 8 (1) | 8 → 10 (1.25) | 6 → 5 (0.83) |
| F-0g evidence | 549 → 578 (1.05) | 543 → 841 (1.55) | 382 → 528 (1.38) |
| F-0g copies | 0 → 1 (–) | 0 → 1 (–) | 0 → 1 (–) |
| F-0h decide | 845 → 646 (0.76) | 834 → 333 (0.4) | 587 → 277 (0.47) |
| **total** | **23,287 → 24,129 (1.04)** | **23,004 → 28,562 (1.24)** | **16,190 → 17,568 (1.09)** |

**In all: 62,481 s (17.36 h) projected, 70,259 s (19.52 h) actual, ratio 1.12.** The run took 7,778 s (2.16 h) more
than projected: 842 s on `sf-store-003`, 5,558 s on `sf-store-004` and 1,378 s on `sf-store-005`. Steps under 15 s
have ratios that are rounding noise at 1-second resolution, and they are not read here.

Steps whose ratio stands out, with possible reasons. **These are hypotheses, not measured causes.**

- **`sf-store-004`'s box-driven steps**: F-0c read 1.94, F-0g evidence 1.55, Q-2b outlines 1.50, F-0c base 1.49,
  H-2 base 1.47 and F-0e read 1.23. #100's rule scales by frames, but these steps do work per box. `sf-store-004` has
  136.14 boxes per frame against 93.65 in the reference (× 1.45), while `sf-store-003` (99.83, × 1.07) and
  `sf-store-005` (95.04, × 1.01) are close to it. A rule that also scaled by boxes per frame might have projected
  `sf-store-004` better. That rule was not pre-registered, so it is not computed here.
- **`sf-store-005`'s F-0e read bands+strips, 1.34**: its boxes per frame are close to the reference, but its `vision`
  reader took 34.09 s per frame against 9.65 to 12.27 on the other 4K parts. Its readers also found text on more boxes
  (`vision` 0.756, against 0.632 and 0.703 on the other two parts), and a box with text may take longer to read. Why
  `vision` alone slowed is not known.
- **F-0h decide, 0.40 to 0.76 on all three**: it came in under projection everywhere. A fixed start-up cost, measured
  once on #100's 20 frames and spread over more frames here, fits that, but this was not measured.
- **F-0, 1.02 to 1.16**: the largest step, and close to projection on every part.

## Agreement: each part beside the two references

Counts stand beside every share. The parts are not independent samples of anything, frames overlap, and nothing is
tested, so no difference is called significant. The differences, each part minus each reference, are in
`metrics.json` (`difference`).

| measure | `003.every-10` | `004.every-10` | `005.every-10` | `003.every-41` | `001.every-3` |
|---|---:|---:|---:|---:|---:|
| spacing between neighbouring frames | ≈ 10 s | ≈ 10 s | ≈ 10 s | ≈ 41 s | ≈ 3 s |
| resolution | 4K | 4K | 4K | 4K | 1080p |
| frames processed / failed | 82 / 0 | 81 / 0 | 57 / 0 | 20 / 0 | 205 / 0 |
| default boxes | 8,186 | 11,027 | 5,417 | 1,873 | 11,828 |
| boxes per frame: mean (p10 / p50 / p90) | 99.83 (51 / 97 / 138) | 136.14 (88 / 133 / 198) | 95.04 (34 / 91 / 153) | 93.65 (55 / 86 / 121) | 57.7 (17 / 56 / 98) |
| boxes per frame: min / max | 23 / 195 | 8 / 230 | 12 / 250 | 36 / 148 | 5 / 170 |
| `vision`: boxes with text | 5,177 (0.632) | 7,756 (0.703) | 4,096 (0.756) | 1,116 (0.596) | 6,221 (0.526) |
| `ppocr`: boxes with text | 5,196 (0.635) | 7,530 (0.683) | 4,134 (0.763) | 1,169 (0.624) | 6,575 (0.556) |
| `qwen`: boxes with a reading row (cap 40 per frame) | 3,078 (0.376) | 3,154 (0.286) | 2,019 (0.373) | 750 (0.400) | 5,743 (0.485) |
| **base: accepted** | **580 (0.071)** | **525 (0.048)** | **301 (0.056)** | **163 (0.087)** | **556 (0.047)** |
| base: `no-catalog-match` | 4,142 (0.506) | 6,768 (0.614) | 3,512 (0.648) | 878 (0.469) | 5,360 (0.453) |
| base: `no-text` | 2,551 (0.312) | 2,820 (0.256) | 1,062 (0.196) | 625 (0.334) | 4,606 (0.389) |
| base: `single-reader` | 830 (0.101) | 851 (0.077) | 504 (0.093) | 186 (0.099) | 1,158 (0.098) |
| base: `readers-disagree` | 83 (0.010) | 63 (0.006) | 38 (0.007) | 21 (0.011) | 148 (0.013) |
| base: `vision`+`ppocr` same work, of both confirming | 341 of 386 (0.883) | 366 of 414 (0.884) | 198 of 223 (0.888) | 94 of 100 (0.940) | 291 of 337 (0.864) |
| F-0 run: accepted | 585 (0.071) | 520 (0.047) | 290 (0.054) | 162 (0.086) | 545 (0.046) |
| F-0 run: `no-catalog-match` | 4,134 (0.505) | 6,778 (0.615) | 3,443 (0.647) | 880 (0.470) | 5,251 (0.447) |
| F-0 run: `vision`+`ppocr` same work, of both confirming | 342 of 388 (0.881) | 370 of 414 (0.894) | 192 of 214 (0.897) | 93 of 98 (0.949) | 280 of 328 (0.854) |
| F-0 run: `vision`+`qwen` same work, of both confirming | 207 of 254 (0.815) | 131 of 159 (0.824) | 86 of 101 (0.851) | 54 of 73 (0.740) | 222 of 317 (0.700) |
| F-0 run: `ppocr`+`qwen` same work, of both confirming | 36 of 68 (0.529) | 19 of 39 (0.487) | 12 of 20 (0.600) | 15 of 20 (0.750) | 43 of 87 (0.494) |
| F-0 run: two / three readers agree | 585 / 0 | 520 / 0 | 290 / 0 | 162 / 0 | 545 / 0 |
| F-0i: dropped, of rows | 379 of 8,153 (0.046) | 340 of 10,952 (0.031) | 124 of 5,385 (0.023) | 108 of 1,865 (0.058) | 357 of 11,650 (0.031) |
| F-0i dropped: `piece-of` / `duplicate` / `merged-parent` / `absorbed` | 219 / 111 / 43 / 6 | 145 / 94 / 97 / 4 | 73 / 35 / 14 / 2 | 63 / 30 / 14 / 1 | 191 / 96 / 60 / 10 |
| NB-3: flagged, of the partition | 202 (0.025) | 509 (0.046) | 103 (0.019) | 69 (0.037) | 328 (0.028) |
| NB-3: `pixel` cause, of flags | 144 (0.713) | 436 (0.857) | 70 (0.680) | 27 (0.391) | 284 (0.866) |
| NB-3: `depth` cause, of flags | 39 (0.193) | 33 (0.065) | 22 (0.214) | 39 (0.565) | 31 (0.095) |
| NB-3: `on-lip` / `depth+pixel` | 12 / 7 | 33 / 7 | 11 / 0 | 2 / 1 | 11 / 2 |
| RB-1 box set | 7,762 | 10,579 | 5,250 | 1,755 | 11,282 |
| F-0g: groups; boxes in groups (of default) | 307; 737 (0.090) | 433; 1,002 (0.091) | 252; 582 (0.107) | 58; 133 (0.071) | 395; 918 (0.078) |
| F-0g: groups spanning more than one frame | 0 | 0 | 0 | 0 | 0 |
| F-0g: grouped with no basis / `readers-agree` / `confirmed-by-copy` | 639 / 83 / 15 | 896 / 91 / 15 | 539 / 32 / 11 | 97 / 33 / 3 | 849 / 57 / 12 |
| works accepted; in two or more frames | 418; 66 | 339; 89 | 206; 32 | 125; 4 | 333; 108 |
| accepted boxes whose work recurs in another frame | 184 (0.317) | 252 (0.480) | 100 (0.332) | 9 (0.055) | 315 (0.567) |
| F-0h: `confirmed-by-context`, of rows | 64 of 1,012 (0.063) | 26 of 902 (0.029) | 55 of 656 (0.084) | 21 of 250 (0.084) | 44 of 1,181 (0.037) |
| F-0h: usable | 776 | 714 | 579 | 191 | 850 |

"Base" is F-0c's base decision (readers `vision` and `ppocr`) on F-0e's default boxes. "F-0 run" is F-0's own run with
three readers. On every part the two differ by at most 11 accepted boxes.

### Against the 4K reference (`sf-store-003.frames.every-41`)

- `sf-store-003`'s every-10 part, the same session at a quarter of the spacing, stands close to #100's sample on most
  measures. Its accepted share is 0.071 against 0.087 (580 of 8,186 against 163 of 1,873). Its `no-catalog-match` share
  is 0.506 against 0.469. Its boxes per frame are 99.83 against 93.65. Its `vision`+`ppocr` agreement is 0.883 against
  0.940, on 386 boxes against 100.
- #100's 20 frames are a small sample of the same sweep. The every-10 part has about four times as many frames, so its
  figures are the firmer of the two for `sf-store-003`.
- NB-3's cause mix moved most: `depth` is 0.193 of flags here, against 0.565 in #100 (39 of 202 against 39 of 69).
  Whether #100's figure was small-sample noise is a hypothesis, not tested.

### Against the 1080p reference (`sf-store-001.every-3`)

- All three 4K parts have more boxes per frame (95 to 136, against 57.7), and their readers find text on more boxes
  (`vision` 0.632 to 0.756, against 0.526). #100 saw the same against 1080p.
- The accepted share on `sf-store-003` (0.071) is above 1080p's 0.047, the same store four days earlier. On
  `sf-store-004` (0.048) and `sf-store-005` (0.056) it is close to 1080p's.
- `no-text` falls from 0.389 at 1080p to 0.196–0.312 at 4K, while `no-catalog-match` rises from 0.453 to 0.506–0.648.

## Recurrence: how comparable it is

Work recurrence depends on the spacing between frames, so it is not a rate to compare across spacings. At about 3 s
neighbouring frames overlap heavily, at about 41 s they barely overlap, and these parts sit at about 10 s.

- **Comparable**: the three every-10 parts with each other. All are 1 fps sweeps at the same spacing. Even so, sweep
  speed and shelf depth differ by session, so the same spacing is not the same overlap.
- **Not comparable as rates**: any every-10 part against #100 (about 41 s) or #98 (about 3 s). They are shown side by
  side only to show the ordering. On `sf-store-003`'s store, recurring accepted boxes go 0.055 at about 41 s, 0.317 at
  about 10 s and 0.567 at about 3 s (the 3 s figure is from `sf-store-001`, the same store at 1080p). The order follows
  the spacing.
- `sf-store-004`'s recurrence, 0.480 at the same spacing, is higher than `sf-store-003`'s 0.317 and `sf-store-005`'s
  0.332. Hypotheses: a slower sweep, so neighbouring frames overlap more; or the same books near many frames' centres.
  The sweep speed was not measured.
- F-0g found no copy group spanning more than one frame on any part. That is measured, not assumed, and it is the same
  as #98 and #100.

## Store-to-store observations (hypotheses only)

`sf-store-003` and `sf-store-004` are different stores, and `sf-store-005` is a third. These notes describe how the
figures differ. **Every reason given is a hypothesis.** Nothing was tuned on them, and no threshold is proposed.

- **`no-catalog-match` is higher on the two held-out sessions**: 0.614 on `sf-store-004` and 0.648 on `sf-store-005`,
  against 0.506 on `sf-store-003`. Their readers find text on as many boxes or more (`vision` 0.703 and 0.756, against
  0.632), and `no-text` is lower (0.256 and 0.196, against 0.312). So more text is read, but less of it matches.
  - Hypothesis: the stores' stock differs in how much of it the ISFDB-only catalog holds.
  - C-11, the catalog v2 re-decision on these same parts, is the card that would size that, from cache.
- **`sf-store-004` is the densest**: 136.14 boxes per frame against about 95 to 100 on the other two parts. It also
  has the most NB-3 flags (0.046 of the partition, 0.857 of them `pixel`) and the most F-0i `merged-parent` drops
  (97, against 43 and 14). Hypotheses: denser or deeper shelves, wider framing, or more small items between books.
  `sf-store-004` is the same store as `sf-store-002` (1080p, held out), which has no F-0 run yet. That run would be the
  same-store comparison.
- **`sf-store-005` reads the most text but accepts few of the reads**. It has the highest reader coverage (`vision`
  0.756, `ppocr` 0.763) and the lowest `no-text` (0.196), yet the highest `no-catalog-match` (0.648). Hypotheses:
  better lighting or a closer sweep for reading, and stock the catalog holds less of.
- **Reader agreement is steady across the stores**: `vision`+`ppocr` agree on the same work for 0.883 to 0.888 of the
  boxes where both confirm one. That points away from reading quality as the main difference between the stores.

## Changes (code and records)

- `src/eval/f0-frames-cli.ts`, extended rather than copied:
  - `projectionCheck` (exported) and the `sample` options `--check-projection <earlier metrics.json>` and `--card`;
  - the check reads the earlier card's committed projection basis and writes `projectionCheck` into this card's
    `metrics.json`, per part and in total.
- `test/f0-4k-every-10.test.ts`: 9 tests.
  - The check reproduces #100's projected figures and computes its ratios as stated, with a null where one side is
    missing.
  - The OC35 guards hold for the two held-out sessions' parts: refused for training and manifests, measured by every
    stage, frozen `held-out` in TS-0's split, and kept out of the appearance gallery.
- No stage code changed: no fix was needed, and nothing was tuned.
- **No deviation.** The run followed the pre-registration. Nothing was added under `## Deviations` in
  `implementation-notes.md`.

## What was not done

- `sf-store-002`'s F-0 run, the stills, TS-0, TS-2, training, tracking and fusion, faces, tuning, protocol edits.
- No live catalog lookup, no download or install from the network, no `contracts/` change.
