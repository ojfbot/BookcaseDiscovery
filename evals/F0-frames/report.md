# F0-frames: the still stages on `sf-store-001` (video tier): stopped after the pilot

**Status, 2026-11-11: the card stopped after its pilot.** The 20-frame pilot ran steps 1 to 11 of `docs/ingest.md`
("Stage order") without a failure. Its time projects the full 616-frame run at **107,157 s (29.8 hours)**, over the
card's 10-hour stop line. Per the brief, the full run was not started. The pre-registered agreement measures
(`prereg.md`, measures 1 to 9) were **not computed**, on the pilot or on anything else. This report is time only, so
the pre-registration still holds for a later full run. Every figure is measured (INV-17). Agreement figures, when they
come, are machine agreement, never accuracy (OC36).

## The pilot

- **Sample**: the sample part `sf-store-001.every-30`: the 30th, 60th, …, 600th frame of the session's image list,
  20 frames. Its caches sit beside the session's under their own name. No `sf-store-001` cache was written.
- **Run**: this Mac, one model step at a time, nothing else on the GPU. Local catalog. A process guard refused any
  network fetch (none was attempted), and the model helpers ran offline. Every step exited 0, and every step's cache
  was written with its lineage stamp, as the stages do.
- **Projection**: each step's pilot seconds × 616 / 20 (linear in frames).

| step | command | pilot s | projected s | projected h | peak resident MB |
|---|---|---:|---:|---:|---:|
| 1 | F-0 | 1181 | 36375 | 10.10 | 5557 |
| 2 | F-0e detect bands | 92 | 2834 | 0.79 | 2041 |
| 2 | F-0e detect bands+strips | 7 | 216 | 0.06 | 446 |
| 2 | F-0e read bands+strips | 1146 | 35297 | 9.80 | 5566 |
| 3 | F-0c detect | 36 | 1109 | 0.31 | 1698 |
| 3 | F-0c read | 124 | 3819 | 1.06 | 6244 |
| 3 | F-0c base | 82 | 2526 | 0.70 | 385 |
| 4 | F-0f probe | 2 | 62 | 0.02 | 118 |
| 5 | Q-2b features | 6 | 185 | 0.05 | 165 |
| 5 | Q-2b outlines | 435 | 13398 | 3.72 | 692 |
| 5 | Q-2b table | 0 | 0 | 0.00 | 158 |
| 6 | H-2 stage | 11 | 339 | 0.09 | 514 |
| 6 | H-2 base | 78 | 2402 | 0.67 | 396 |
| 7 | F-0i plan | 1 | 31 | 0.01 | 131 |
| 7 | F-0i tiles | 77 | 2372 | 0.66 | 695 |
| 7 | F-0i resolve | 36 | 1109 | 0.31 | 482 |
| 8 | NB-3 stage | 2 | 62 | 0.02 | 283 |
| 8 | NB-3 shelf | 31 | 955 | 0.27 | 1036 |
| 8 | NB-3 probe | 2 | 62 | 0.02 | 111 |
| 8 | NB-3 flags | 0 | 0 | 0.00 | 157 |
| 10 | F-0g pairs | 1 | 31 | 0.01 | 159 |
| 10 | F-0g evidence | 68 | 2094 | 0.58 | 392 |
| 10 | F-0g copies | 0 | 0 | 0.00 | 161 |
| 11 | F-0h decide | 61 | 1879 | 0.52 | 953 |
| | **total** | **3479** | **107157** | **29.77** | |

Step 9 (RB-1) is a function, not a command. Peak resident memory is `/usr/bin/time -l`'s maximum resident set size
for the command and the helpers it waited on. Two projections are lower bounds:
- **H-2 stage**: its depth geometry (MoGe-2) was a cache hit on all 20 sample frames. The cache is content-addressed
  and was written by an earlier run, so the 11 s is mostly faces, not depth.
- **F-0h decide**: its leave-one-reader-out pass is not known to scale linearly in frames.

## Where the time goes (observations, not tuning)

- **Reading is 70% of the pilot** (2,451 of 3,479 s): F-0's readers (step 1) and F-0e's readers on the default boxes
  (step 2's read) each take about 10 projected hours. F-0e's read reads its own boxes with all three readers again.
  Q-2b's SAM 2.1 outlines are the next largest step (3.7 projected hours).
- **Per box, frames read faster than stills.** These are the model seconds F-0's caches record, per row:

| F-0's own run | `pilot-000` (31 stills) | `sf-store-001.every-30` (20 frames) |
|---|---:|---:|
| detection, seconds per photo | 71.16 | 3.98 |
| `vision`, seconds per crop | 0.123 | 0.078 |
| `ppocr`, seconds per crop | 1.201 | 0.384 |
| `qwen`, seconds per crop | 1.592 | 1.059 |
| decisions (boxes) per photo | 222.4 | 63.4 |
| `qwen` rows per photo (cap 40) | 40.0 | 29.4 |
| share of decisions sent to `qwen` as hard crops | 0.1799 | 0.4629 |

- **Why the run is long anyway: there are 20 times as many photos.** A frame costs F-0 about 59 s of wall time;
  `pilot-000`'s 31 stills cost F-0 about 13,300 model-seconds in all, while 616 frames project to 36,375 s.
- **More boxes go to `qwen` on frames.** The share of decisions sent to `qwen` as hard crops goes from 0.18 to 0.46.
  That one figure is reader coverage (pre-registered measure 3, on F-0's own run). It is reported only because it
  drives the time, and it is logged as a deviation (`implementation-notes.md`). Fewer pixels per spine making more
  crops "hard" is a hypothesis, not a finding.

## What was not done

- The full run on `sf-store-001`; measures 1 to 9; the video-tier note on agreement. All wait on the conductor's
  ruling on the projection.
- `sf-store-002`, TS-0 and TS-2 (later cards). No live catalog lookup, no download, no `contracts/` change.

## Code

- `samplePart` in `src/eval/set-paths.ts`, used by `sessionImages`, `acceptSet`, `setPaths` and F-0's photo list.
  It adds the sample part `<session>.every-<n>`. It is never declared, so it is never manifested, exported or trained
  on. Tests: `test/f0-frames-sample.test.ts` (pilot-000's and the whole session's paths and lists unchanged).
- `src/eval/f0-frames-cli.ts`: the pre-registered aggregates (`measure`, the same code on both sets) and this
  time-only record (`pilot`).
