# F0-4k: the still stages on a sample of `sf-store-003` (4K frames and 48 MP stills)

**Scope, 2026-11-15: a sample, measured and projected, then stopped for the owner's sizing decision.** Two sample parts
of `sf-store-003` ran, each on its own: `sf-store-003.stills` (all 16 stills of the session) and
`sf-store-003.frames.every-41` (20 of the session's 823 frames, 0.0243). Stills and frames are never pooled. No larger
run started. Steps 1 to 11 of `docs/ingest.md` ("Stage order") ran on both parts, and the last attempt of every one of
the 24 commands exited 0 on both. Every figure below is **machine agreement** between the stack's own stages and
readers, **never accuracy** (INV-17). There are no hand labels (OC36). Every figure is measured from the caches, and all
counts are in `metrics.json`. The references, `sf-store-001.every-3` (#98: 205 frames at 1080p, the same store) and
`pilot-000` (31 stills of about 48 MP), were read from their existing caches; nothing of them was rerun, and their
figures in `metrics.json` are identical, field for field, to `evals/F0-frames/metrics.json`.

## Run

- **Where**: this Mac (48 GiB), one model step at a time, nothing else on the GPU. The catalog was local. A process
  guard refused any network fetch, and none was attempted in either part. The model helpers ran offline. Nothing was
  downloaded, and `contracts/` is unchanged. `--box-set pre-rb1` was used where the doc says (Q-2b's outlines and table,
  H-2's stage and base); F-0g and F-0h ran on RB-1's box set.
- **Images**: 16 of 16 stills and 20 of 20 frames were processed, and 0 failed, both in F-0's own run and in the default
  boxes. For 6 of the stills' 5,039 default boxes, and 1 of the frames' 1,873, `vision` and `ppocr` wrote no reading
  row.
- **Interruptions and environment stops (stills part only; none changed a measure)**:
  - F-0, attempt 1 (737 s, exit 1): the Apple Vision OCR helper had not been built in this new worktree. It was built
    from the same source as #98's, with no remote dependencies.
  - F-0, attempt 2 (1,091 s): killed from outside when the owner restarted Claude. It is counted as an interruption,
    not a failure.
  - F-0, attempt 3 (1 s, exit 1): DL-3's lineage check refused the `ppocr` cache that the killed attempt had left
    unstamped. The cache was whole (every row parses, no repeated id, it ends on a newline).
  - F-0, attempt 4 (2,694 s, exit 0): one rerun with the stale-cache allowance. It read that one cache anyway (one
    "reading anyway" line, no other) and stamped all five of F-0's caches.
  - Q-2b features, attempt 1 (0 s, exit 1): the coverage helper's environment did not exist in this worktree. It was
    created offline from the lockfile (`uv sync --offline --frozen`, from uv's local cache).

  All of these are logged under `## Deviations` in `implementation-notes.md`. The frames part ran after both fixes and
  had no failed or interrupted attempt.
- **Unit**: a box or an image. Frames of one sweep overlap; this sample's frames are about 41 s apart, against #98's
  about 3 s. No figure is deduplicated across images, so a per-box share is not a per-book share.

## Time

Seconds are wall seconds from the runner's clock, with every attempt of a step summed (as #98 did). Peak memory is the
peak resident size from `/usr/bin/time -l`.

| part | images | seconds | seconds per image | against #98's 149 s per frame | peak resident MB |
|---|---:|---:|---:|---:|---:|
| `sf-store-003.frames.every-41` | 20 | 5,680 | 284.0 | × 1.91 | 15,292 (F-0c read) |
| `sf-store-003.stills`, all attempts | 16 | 15,173 | 948.3 | × 6.36 | 20,605 (F-0c read) |
| `sf-store-003.stills`, completed attempts only | 16 | 13,344 | 834.0 | × 5.60 | 20,605 (F-0c read) |
| `sf-store-001.every-3` (#98) | 205 | 30,556 | 149.05 | × 1 | 7,633 (F-0c read) |

The stills' failed and interrupted attempts add 1,829 s (737 + 1,091 + 1 + 0). Part of their work was kept: the reader
caches resume, and attempt 4 read the killed attempt's `ppocr` rows. So the completed-attempts figure is the lower
figure and the summed figure the upper one. #98's per-frame figure is the comparison the brief names; it is set
against the stills only for scale, since a still is not a frame.

| step | command | stills s (attempts) | s per still | stills peak MB | frames s | s per frame | frames peak MB | #98 s per frame |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | F-0 | 4,523 (4) | 282.69 | 10,749 | 1,871 | 93.55 | 5,643 | 51.47 |
| 2 | F-0e detect bands | 773 | 48.31 | 7,706 | 207 | 10.35 | 4,179 | 3.63 |
| 2 | F-0e detect bands+strips | 9 | 0.56 | 804 | 3 | 0.15 | 474 | 0.03 |
| 2 | F-0e read bands+strips | 4,756 | 297.25 | 11,047 | 1,712 | 85.60 | 5,644 | 48.82 |
| 3 | F-0c detect | 302 | 18.88 | 5,815 | 72 | 3.60 | 3,708 | 1.39 |
| 3 | F-0c read | 333 | 20.81 | 20,605 | 253 | 12.65 | 15,292 | 5.56 |
| 3 | F-0c base | 406 | 25.38 | 444 | 158 | 7.90 | 397 | 3.64 |
| 4 | F-0f probe | 8 | 0.50 | 510 | 2 | 0.10 | 153 | 0.06 |
| 5 | Q-2b features | 39 (2) | 2.44 | 728 | 9 | 0.45 | 284 | 0.13 |
| 5 | Q-2b outlines | 1,577 | 98.56 | 1,294 | 582 | 29.10 | 732 | 18.59 |
| 5 | Q-2b table | 0 | 0 | 217 | 1 | 0.05 | 178 | 0 |
| 6 | H-2 stage | 20 | 1.25 | 579 | 14 | 0.70 | 502 | 0.43 |
| 6 | H-2 base | 403 | 25.19 | 450 | 155 | 7.75 | 401 | 3.35 |
| 7 | F-0i plan | 13 | 0.81 | 587 | 2 | 0.10 | 153 | 0.02 |
| 7 | F-0i tiles | 691 | 43.19 | 1,679 | 159 | 7.95 | 819 | 3.26 |
| 7 | F-0i resolve | 618 | 38.63 | 2,619 | 88 | 4.40 | 827 | 1.55 |
| 8 | NB-3 stage | 3 | 0.19 | 311 | 2 | 0.10 | 291 | 0.05 |
| 8 | NB-3 shelf | 111 | 6.94 | 1,162 | 45 | 2.25 | 962 | 1.36 |
| 8 | NB-3 probe | 7 | 0.44 | 505 | 2 | 0.10 | 151 | 0.06 |
| 8 | NB-3 flags | 0 | 0 | 494 | 1 | 0.05 | 242 | 0 |
| 10 | F-0g pairs | 8 | 0.50 | 528 | 2 | 0.10 | 246 | 0.04 |
| 10 | F-0g evidence | 353 | 22.06 | 427 | 134 | 6.70 | 405 | 2.80 |
| 10 | F-0g copies | 1 | 0.06 | 496 | 0 | 0 | 252 | 0 |
| 11 | F-0h decide | 219 | 13.69 | 1,169 | 206 | 10.30 | 2,303 | 2.77 |

RB-1 (step 9) is the box set NB-3's flags write. It has no command of its own, as in #98.

**Model seconds the caches record, per image** (detection on the default boxes; reader seconds summed over crops):

| | frames part | `sf-store-001.every-3` | stills part | `pilot-000` |
|---|---:|---:|---:|---:|
| detection | 10.18 | 3.62 | 47.91 | 84.32 |
| `vision` | 9.65 | 4.23 | 85.56 | 99.65 |
| `ppocr` | 57.05 | 25.61 | 302.31 | 371.42 |
| `qwen` | 39.70 | 28.72 | 54.63 | 115.74 |

A 4K frame has about 4 times a 1080p frame's pixels (8.3 MP against 2.1 MP), and it took 1.91 times the wall time.
Detection took 2.8 times as long, `ppocr` 2.2 times and `qwen` 1.4 times. Per default box, the frames part took 3.03 s
(5,680 / 1,873), against 2.58 s (30,556 / 11,828) at 1080p.

## The projection (frames only)

The rule is fixed in `prereg.md` §3. Each step's seconds on the 20 sampled frames are multiplied by (frames to run ÷ 20),
rounded per step, and summed. That is 5,680 s ÷ 20 = 284 s per frame. A run of every n-th frame takes ⌊frames ÷ n⌋
frames.

| session | frames | all frames | every 3rd | every 10th |
|---|---:|---:|---:|---:|
| `sf-store-003` | 823 | 823 × 284 ≈ 233,730 s (64.9 h) | 274 × 284 ≈ 77,815 s (21.6 h) | 82 × 284 ≈ 23,287 s (6.5 h) |
| `sf-store-004` | 816 | 816 × 284 ≈ 231,746 s (64.4 h) | 272 × 284 ≈ 77,247 s (21.5 h) | 81 × 284 ≈ 23,004 s (6.4 h) |
| `sf-store-005` | 577 | 577 × 284 ≈ 163,870 s (45.5 h) | 192 × 284 ≈ 54,527 s (15.1 h) | 57 × 284 ≈ 16,190 s (4.5 h) |
| **all three** | **2,216** | **629,346 s (174.8 h, about 7.3 days)** | **738 frames: 209,589 s (58.2 h)** | **220 frames: 62,481 s (17.4 h)** |

Each figure (s) is the per-step sum. It differs from frames × 284 by a few seconds, from rounding each step. The runs
assume one Mac, one model step at a time, and no failed attempts.

**How far to trust it.** The projection is linear in frames, and two things pull it in opposite directions; neither
was measured here:

- A step whose time grows faster than its input (#98 noted F-0h as possibly superlinear) makes the projection a lower
  bound. F-0h took 10.30 s per frame here, against 2.77 s at 1080p.
- A fixed start-up cost per command (loading a model) is spread over 20 frames here, and would be spread over hundreds
  in a larger run. That makes the projection an upper bound for those steps.

In #98, a linear projection from a 20-frame pilot was 14% above the actual run (35,663 s projected, 30,556 s actual).
That is one earlier observation, not a correction applied here. The 4K frames' peak memory (15.3 GB, in F-0c read) fits
in this Mac's 48 GiB. The stills' (20.6 GB) does too.

The 16 stills are measured, not projected: they are all the stills of the shoot.

## Agreement: each part beside its reference

Counts stand beside every share. The differences are the part minus the reference, in points. The samples are small
(16 and 20 images), the frames are not independent, and nothing is tested, so no difference is called significant.
The full table, with both parts against both references, is in `metrics.json` (`sets` and `difference`).

### Frames: `sf-store-003.frames.every-41` (4K) against `sf-store-001.every-3` (1080p)

| measure | 4K frames | 1080p frames | difference |
|---|---:|---:|---:|
| default boxes | 1,873 | 11,828 | |
| boxes per image: mean (p10 / p50 / p90) | 93.65 (55 / 86 / 121) | 57.70 (17 / 56 / 98) | +35.95 |
| `vision`: boxes with text | 1,116 (0.596) | 6,221 (0.526) | +7.0 |
| `ppocr`: boxes with text | 1,169 (0.624) | 6,575 (0.556) | +6.8 |
| `qwen`: boxes with a reading row (cap of 40 per image) | 750 (0.400) | 5,743 (0.485) | −8.5 |
| base: accepted | 163 (0.087) | 556 (0.047) | +4.0 |
| base: `no-catalog-match` | 878 (0.469) | 5,360 (0.453) | +1.6 |
| base: `no-text` | 625 (0.334) | 4,606 (0.389) | −5.5 |
| base: `single-reader` | 186 (0.099) | 1,158 (0.098) | +0.1 |
| base: `readers-disagree` | 21 (0.011) | 148 (0.013) | −0.1 |
| base: `vision` and `ppocr` confirm the same work, of both confirming | 94 of 100 (0.940) | 291 of 337 (0.864) | +7.6 |
| F-0 run: accepted | 162 (0.086) | 545 (0.046) | +4.0 |
| F-0 run: `vision`+`qwen` same work, of both confirming | 54 of 73 (0.740) | 222 of 317 (0.700) | +4.0 |
| F-0 run: `ppocr`+`qwen` same work, of both confirming | 15 of 20 (0.750) | 43 of 87 (0.494) | +25.6 |
| F-0 run: two / three readers agree | 162 / 0 | 545 / 0 | |
| F-0i: dropped | 108 of 1,865 (0.058) | 357 of 11,650 (0.031) | +2.7 |
| F-0i dropped: `piece-of` / `duplicate` / `merged-parent` / `absorbed` | 63 / 30 / 14 / 1 | 191 / 96 / 60 / 10 | |
| NB-3: flagged, of the partition | 69 (0.037) | 328 (0.028) | +0.9 |
| NB-3: `pixel` cause, of flags | 27 (0.391) | 284 (0.866) | −47.5 |
| NB-3: `depth` cause, of flags | 39 (0.565) | 31 (0.094) | +47.1 |
| NB-3: `on-lip` / `depth+pixel` | 2 / 1 | 11 / 2 | |
| RB-1 box set | 1,755 | 11,282 | |
| F-0g: groups; boxes in groups | 58; 133 (0.071) | 395; 918 (0.078) | −0.7 |
| F-0g: groups spanning more than one image | 0 | 0 | |
| F-0g: grouped boxes with no basis | 97 of 133 (0.729) | 849 of 918 (0.925) | −19.6 |
| F-0g: grouped `readers-agree` / `confirmed-by-copy` | 33 / 3 | 57 / 12 | |
| works accepted; in two or more images | 125; 4 | 333; 108 | (not comparable, below) |
| accepted boxes whose work recurs | 9 (0.055) | 315 (0.566) | (not comparable) |
| F-0h: `confirmed-by-context`, of rows | 21 of 250 (0.084) | 44 of 1,181 (0.037) | +4.7 |
| F-0h: usable | 191 | 850 | |

### Stills: `sf-store-003.stills` against `pilot-000`

| measure | 2026-11-11 stills | `pilot-000` | difference |
|---|---:|---:|---:|
| images | 16 | 31 | |
| default boxes | 5,039 | 6,145 | |
| boxes per image: mean (p10 / p50 / p90) | 314.94 (230 / 327 / 369) | 198.23 (58 / 193 / 321) | +116.71 |
| `vision`: boxes with text | 3,178 (0.631) | 4,116 (0.670) | −3.9 |
| `ppocr`: boxes with text | 3,227 (0.640) | 4,526 (0.737) | −9.7 |
| `qwen`: boxes with a reading row (cap of 40 per image) | 640 (0.127) | 1,230 (0.200) | −7.3 |
| base: accepted | 235 (0.047) | 731 (0.119) | −7.2 |
| base: `no-catalog-match` | 2,864 (0.568) | 3,121 (0.508) | +6.0 |
| base: `no-text` | 1,610 (0.319) | 1,365 (0.222) | +9.7 |
| base: `single-reader` | 318 (0.063) | 862 (0.140) | −7.7 |
| base: `readers-disagree` | 12 (0.002) | 66 (0.011) | −0.8 |
| base: `vision` and `ppocr` confirm the same work, of both confirming | 190 of 196 (0.969) | 549 of 603 (0.910) | +5.9 |
| F-0 run: accepted | 235 (0.047) | 718 (0.104) | −5.8 |
| F-0 run: `vision`+`qwen` same work, of both confirming | 37 of 41 (0.902) | 135 of 167 (0.808) | +9.4 |
| F-0 run: `ppocr`+`qwen` same work, of both confirming | 8 of 10 (0.800) | 34 of 57 (0.597) | +20.3 |
| F-0i: dropped | 207 of 5,031 (0.041) | 360 of 6,121 (0.059) | −1.8 |
| NB-3: flagged, of the partition | 140 (0.028) | 81 (0.013) | +1.5 |
| NB-3: `pixel` cause, of flags | 102 (0.729) | 32 (0.395) | +33.4 |
| NB-3: `depth` cause, of flags | 27 (0.193) | 44 (0.543) | −35.0 |
| RB-1 box set | 4,818 | 5,757 | |
| F-0g: groups; boxes in groups | 149; 360 (0.071) | 154; 338 (0.055) | +1.6 |
| F-0g: grouped boxes with no basis | 330 of 360 (0.917) | 251 of 338 (0.743) | +17.4 |
| works accepted; in two or more images | 158; 32 | 516; 85 | |
| accepted boxes whose work recurs | 102 (0.434) | 220 (0.301) | +13.3 |
| F-0h: `confirmed-by-context`, of rows | 20 of 431 (0.046) | 89 of 985 (0.090) | −4.4 |
| F-0h: usable | 357 | 864 | |

## The capture-tier note (observations, not tuning)

These are the figures that moved most. Each cause named is a hypothesis unless it says otherwise. Nothing here proposes
a threshold or a change.

**1080p to 4K frames, same store** (two shoots, four days apart, so the shoot changed as well as the resolution):

- **The base decision accepts about twice as often** (163 of 1,873, 0.087, against 556 of 11,828, 0.047). `vision` and
  `ppocr` find text on about 7 points more of the boxes, and `no-text` falls by 5.5 points. Where both confirm a work,
  they agree more often (0.940 against 0.864). More pixels per spine is a hypothesis.
- **More boxes per frame** (mean 93.65 against 57.70, and p10 55 against 17). The detector finding more spines at more
  pixels, and a different sweep or framing, are both hypotheses.
- **`qwen` reads a smaller share of boxes** (0.400 against 0.485). Part of this is arithmetic: it reads up to 40 hard
  crops per image, and a 4K frame has more boxes.
- **NB-3's flag causes return to the stills' mix.** The `pixel` cause falls from 0.866 to 0.391 of flags, and `depth`
  rises from 0.094 to 0.565. That is close to `pilot-000`'s 0.395 and 0.543. #98 named depth on 2 MP frames as a
  hypothesis for the 1080p mix; this observation is consistent with it, and does not test it.
- **Copy groups carry more evidence** (0.729 of grouped boxes with no basis, against 0.925), and F-0h's context rule
  confirms 0.084 of its rows, against 0.037. Both follow the rise in reader text.
- **F-0i drops more boxes** (0.058 against 0.031); a little over half are `piece-of` in both (0.583 and 0.535 of drops).
- **Work recurrence is not comparable.** 9 accepted boxes (0.055) have their work accepted in another frame, against
  0.566 at 1080p. This sample's frames are about 41 s apart against about 3 s, so they overlap much less (as `prereg.md`
  §2 says).
- **Time per frame is 1.91 times #98's**, for about 4 times the pixels. Per box it is 3.03 s against 2.58 s.

**The 2026-11-11 stills against `pilot-000`** (a different shoot):

- **More boxes per still** (mean 314.94 against 198.23, and p10 230 against 58). The shelves photographed and the
  framing are hypotheses.
- **The base decision accepts less than half as often** (235 of 5,039, 0.047, against 731 of 6,145, 0.119). Both
  `no-catalog-match` (+6.0 points) and `no-text` (+9.7) rise. The local catalog covering this store's books less well,
  and smaller spines per box at more boxes per still, are hypotheses. Where `vision` and `ppocr` both confirm a work,
  they agree more often (0.969 against 0.910).
- **NB-3 flags more, and by pixels** (0.028 against 0.013 of the partition; `pixel` 0.729 against 0.395 of flags).
- **Accepted works recur across stills more often** (0.434 of accepted boxes, against 0.301). Overlapping stills of
  the same shelves are a hypothesis.
- **Model seconds per still are lower than `pilot-000`'s** (detection 47.9 against 84.3; `ppocr` 302 against 371),
  although each still has more boxes. Smaller crops per box and a different software or machine state are hypotheses.

## Changes (code and records)

- `samplePart` in `src/eval/set-paths.ts` adds the sample parts `<session>.stills` and `<session>.frames.every-<n>`.
  Stills and frames are told apart by the session's private frame list, not by size, and the code refuses to split a
  session without that list or with another session's list. `<session>.every-<n>`, `pilot-000`'s and the yardstick's
  paths and lists are unchanged. A part is never declared, so it is never exported, trained on or manifested. Tests are
  in `test/f0-4k-sample.test.ts`.
- `src/eval/f0-frames-cli.ts`, extended rather than copied: the `sample` subcommand (each part apart, against each
  reference, with time per step against #98 and the projection). Every attempt of a step is summed, and an attempt
  killed from outside is counted as interrupted, not failed. Tests are in `test/f0-4k-sample.test.ts`.
- No stage code changed for 4K frames or for the stills: no fix was needed, and nothing was tuned.
- Three deviations are logged in `implementation-notes.md`: the OCR helper built in the new worktree, the resume after
  the owner's restart (the unstamped `ppocr` cache), and the coverage helper's environment created offline.

## What was not done

- Any larger run: all frames, every 3rd or every 10th of `sf-store-003`, `sf-store-004` or `sf-store-005`. The owner
  chooses its size from the projection above.
- No live catalog lookup, no download or install from the network, no `contracts/` change.
