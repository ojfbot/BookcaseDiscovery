# H2: spine-face trim and face labels (H-2)

## Pre-registration (committed before the first reader run)

Fixed 2026-11-03, before any `face3d` crop was read. Nothing below is changed after seeing a result; any change
is logged as a deviation and the report says which figures it touches.

**Question.** Does reading each over-selecting box through its spine-face trim (H-1's feasible trim, `face3d`) lift
F-0's outcomes against the shipped crop `rect;rot=fixed;clip=frame`? Separately: per-box face shares for every
default box, a `user-glow-volume` display variant, and the cost of geometry plus faces.

**Sets, never merged (OC35).**

- **`pilot-000`**: F-0e's default `bands+strips` boxes, after the shipped not-a-book filter (F-0c's shape rules,
  F-0f's shelf-label rules, cover pass off). The readers F-0e cached on them, and F-0's decision (F-0c's cached
  `base-decisions`). Every figure is **machine agreement, never accuracy** (INV-17). It is a dev set (OC11).
- **Yardstick (PROXY)**: the 40-image Library Dataset sample with F-0's B2 boxes (the default for shelf-scale
  photos), after the same filter, F-0's cached readers and decisions. *Confirmed* = accepted and annotated in the
  image; *wrong* = accepted, not annotated. Never trained or tuned on.

No hand labels (OC36). Nothing is trained.

**Geometry and faces.** MoGe-2 ViT-L with the normal head (`Ruicheng/moge-2-vitl-normal` at revision `cb0e8bb`,
MIT), 2048 px long side, MPS. EXIF field of view where the working copy keeps a full sensor frame (as H-1), MoGe's
estimate otherwise. `helpers/depth/faces.py` with every H-1 threshold unchanged, run on all of a photo's boxes (as
H-1) and reported on the boxes the filter keeps.

**The `face3d` subset.** A box is in it when all three hold:

1. it **over-selects** (H-1: top, under, cover and behind pixels at least 15 % of the box);
2. its **trim is feasible** (H-1: the largest connected spine-face region holds at least 80 % of the face, the
   rectangle is at least 85 % face, and keeps at least half the box's length);
3. its `face3d` crop differs from its `clip=frame` crop (any corner more than 1 px apart, as F-0b counts a change).

**The crop.** `face3d;rot=fixed;clip=frame`: the trim's rectangle (working-copy pixels), clipped to the frame,
read at F-0's 90° and 270°.

**Arms.** Both run on the same subset by F-0b's procedure (`src/eval/f0b-cli.ts` `run`): Vision and PP-OCR on
every subset box; F-0's Qwen hard-crop selection per photo (cap 40 on `pilot-000`, 15 on the yardstick), the
subset's boxes competing with the cached first-pass state of the photo's other boxes; F-0's unchanged `decide`
and catalog bar. The basis is `readers-agree` only; `confirmed-by-copy` (F-0g) is not applied, in either arm.

- **before**: `rect;rot=fixed;clip=frame`. A box whose clip crop equals its cached crop (in frame) keeps its
  cached readings; a box partly out of frame is re-read.
- **after**: `face3d;rot=fixed;clip=frame`. Every subset box is re-read (by rule 3 its crop changed). Boxes outside
  the subset keep their cached readings and decisions in both arms.

**Measures.** Shares of the subset's boxes, before → after, with 95 % paired photo-cluster bootstrap intervals of
the change (2,000 draws, in percentage points, F-0b's seeds): text read (any reader text), confirmed and, on the
yardstick, wrong. On `pilot-000` also **distinct confirmed works**: the number of distinct accepted work ids over
the whole set (subset boxes take the arm's decision, all others their cached one), before → after, with the same
bootstrap. Reported, not in the rule: strata by elevation (below, level, above eye level), by the dominant extra
face (top, cover, behind), whole against cut-or-partial boxes, in frame against partly out; reader calls.

**Keep rule (F-0b's, plus the works guard).** `face3d` ships as the default crop for subset boxes only if all hold:

1. `pilot-000`: the confirmed-share interval excludes 0 upward (lower end above 0);
2. `pilot-000`: distinct confirmed works do not fall (point change at least 0);
3. yardstick: the confirmed share does not fall beyond its interval (upper end at least 0);
4. yardstick: the wrong-accept share does not rise beyond its interval (lower end at most 0).

If any fails, the shipped crop stays `rect;rot=fixed;clip=frame`, `face3d` stays off, and the face labels and the
display variant still ship.

**Exit (c), cost.** Per photo, wall time from opening the working copy to the faces written: decode and resize,
MoGe-2 inference on MPS (synchronised), saving the cache, and the face split on the CPU. Model load (once per
process) is excluded and reported apart. Measured on a cold cache over `pilot-000`, with this card the only heavy
GPU job. **Pass when every photo takes at most 5 s**; the median, 90th percentile and maximum are reported. A
second run over the same photos must be all cache hits.

**Exit (b), spot check on a fresh session: protocol only, not run here.** H-1's spot check used `pilot-000`, a dev
set on which one threshold (the per-box plane fallback) was tuned. Exit (b) needs a session the method has never
seen, and none exists yet. When one does:

1. **Session.** The first real-use scan session ingested after H-2 merges, not `pilot-000`, with at least 10
   photos. No photo of it is opened by the agent before the sample is drawn.
2. **Frozen code.** The H-2 merge commit, MoGe-2 at `cb0e8bb`, `faces.py` thresholds as merged. Nothing is changed
   after the run starts; a needed change voids the check and is logged.
3. **Run.** Default detection, the shipped not-a-book filter, then the depth stage.
4. **Sample.** Seed 2. 40 boxes the machine flags as over-selecting and 20 it does not, at most 4 per photo,
   drawn uniformly within each group, then shuffled together. If fewer than 40 are flagged, all flagged boxes and
   twice as many unflagged.
5. **Blind judging.** Each box is shown as its oriented box on the photo with 25 % context and no machine output.
   The judge answers one question: *does the box take in something other than the book's spine face (its top, a
   receding cover, the back wall or a gap, a neighbour) over at least about a sixth of it?* — yes, no or unclear.
   The judge is the owner, or a fresh agent session that has seen none of the session's outputs. Judgements stay
   private and are never used as labels or to tune anything (OC36).
6. **Score.** Agreement = judged boxes (unclear excluded) where the answer matches the machine's flag. **Pass at
   85 % or more**, reported with a Wilson 95 % interval and the unclear count. Secondary, not gating: on flagged
   boxes with a feasible trim, whether the trim stops at the spine face without cutting its lettering.
7. **If it fails,** the face labels stay as recorded but are not used downstream until a new card re-examines
   them.

**Exit (d)** is the owner's: they judge `user-glow-volume` on the private still study.

## Findings (run 2026-11-03, after the pre-registration above)

Aggregates are in [`metrics.json`](metrics.json); the tables below the marker are generated. `pilot-000` figures are
machine agreement, never accuracy (INV-17), and the two sets are reported apart (OC35).

1. **The `face3d` crop fails the keep rule, so it stays off.** The shipped crop is still
   `rect;rot=fixed;clip=frame`. On the 1,745 `pilot-000` subset boxes (28.5 % of the 6,121 kept boxes):
   - confirmed −0.3 points (−1.2 to 0.7), so rule 1 fails;
   - text read −0.9 (−1.9 to 0.1);
   - distinct confirmed works over the whole set 519 → 512 (−7; −11 to 3), so rule 2 fails.

   On the yardstick's 215 boxes, the confirmed share does not fall beyond its interval (−1.9; −4.6 to 0.5) and wrong
   accepts do not rise beyond theirs (+0.5; 0 to 1.6), so rules 3 and 4 hold. The face labels and the display
   variant ship anyway, as the plan said.
2. **Trimming a top face is neutral for the readers; trimming a cover costs.**
   - Most `pilot-000` subset boxes are below eye level and mostly take in a top face (1,501 boxes): confirmed +0.1
     (−0.9 to 1.2). The readers already cope with a box that runs onto the book's top.
   - Boxes whose extra face is mostly a receding cover (238) lose confirmed −2.5 (−4.5 to −0.4) on `pilot-000`, and
     −1.6 (−5.4 to 1.6) on the yardstick's 122. A cover beside a spine often carries the title or the author too.
   - Cut-or-partial boxes lose text read, −2.4 (−3.9 to −1.1). That is F-0b's finding again: trimming a piece of a
     spine loses text.
   - These strata were not in the rule. A top-only trim would be a new hypothesis for a fresh session, not a
     re-test on these sets.
3. **The face split is reproducible and cached.** The stage gives H-1's face split exactly, on all 6,145
   `pilot-000` boxes. A second run is all cache hits (0.08 s a photo). On the kept boxes:
   - 49.4 % (46.4–52.6) over-select on `pilot-000`, 74.6 % below eye level;
   - 50.7 % (43.6–57.8) on the yardstick, where the extra face is mostly a cover (50 %) or the back wall (26 %),
     not a top (24 %): library shelves are seen square-on;
   - the trim is feasible for 57.8 % of over-selecting boxes on `pilot-000` and 38.0 % on the yardstick.
4. **Exit (c) fails by the strict rule on one photo of 71.** Across `pilot-000`, geometry plus faces took a median
   3.2 s a photo on MPS (p90 3.6 s), with these parts:
   - inference about 1.0 s;
   - saving the cache about 1.0 s;
   - the face split on the CPU about 1.0 s.

   The first photo of the first run took 5.8 s, because its inference took 3.7 s. A later fresh process (the
   yardstick run, also a cold cache) took at most 3.8 s on every photo, its first included. So the outlier looks
   like a one-time MPS warm-up (*hypothesis*). Every other photo was at most 3.6 s. The rule was "every photo at
   most 5 s", so exit (c) is **not met as pre-registered**. Two cheap fixes, not tried: one warm-up inference at
   model load, and saving the cache off the critical path.
5. **Exit (b) is not run.** No fresh real-use session exists yet. The protocol above is fixed for when one does.
6. **Exit (d) is the owner's.** The still study is at the data root's `private/h2/renders/pilot-000/index.html`
   (A: `user-glow`, B: `user-glow-volume`). There:
   - 28.5 % of spines are cut back to their spine face;
   - 57.2 % have a visible top face, which lights on read spines only.

**Arms check.** In frame, the `clip` arm reads the cached crop, and it reproduces the cached decision on 100 % of
those boxes on both sets. So the before arm is the shipped pipeline, not a re-run artefact.

**Reader cost.** Calls are equal by construction (one crop, two rotations); `face3d` sent 500 crops to Qwen against
512. The seconds in the tables mix cached readings (timed when other cards shared the GPU) with fresh ones, so
compare calls, not seconds.

## Private outputs

Everything per photo or box is under the data root's `private/h2/`:

- the stage cache (`cache/`);
- per set, `faces.jsonl` (face shares per kept box), the stage logs, `base-decisions.jsonl`, and each arm's readings
  and decisions;
- the still study (`renders/pilot-000/`).

None of it is in the repository.

## Re-baseline 2026-11-04 (F-0i + NB-3 on-lip)

Re-run once on RB-1's box set ([evals/RB1](../RB1/report.md)): F-0i's partition (#51) of the shipped default boxes, less NB-3's `on-lip` boxes (#61). Box ids and detection rectangles are unchanged; F-0m (#60) and F-0k (#62) shipped nothing. Before: main 116f4e9, as published. Generated by `node src/eval/rb1-cli.ts summary`; the tables below this section are the re-run's.

What re-ran: `h2-cli.ts faces` (new: the per-box face file on the kept boxes, from the latest stage run; no depth runs), then `analyse`. Face rows are keyed by detection rectangle, which F-0i keeps, so a changed box's row is unchanged and only dropped rows leave. The `face3d` arm decisions were cached on a superset and are read on the new subset; no reader ran.

- The `face3d` subset shrinks with the kept boxes (1,745 → 1,652 on `pilot-000`, 215 → 199 on the yardstick); every part of the keep rule reads as before.

**pilot-000** (machine agreement, never accuracy (INV-17))

| figure | as published | RB-1 |
|---|---|---|
| over-selecting kept boxes (%) | 49.4 (46.4 to 52.6) | 49.1 (46.1 to 52.6) |
| trim feasible, of over-selecting (%) | 57.8 (53.5 to 61.7) | 58.4 (53.9 to 62.7) |
| **`face3d` confirmed Δ (pts)** | -0.3 (-1.2 to 0.7) | -0.4 (-1.4 to 0.6) |
| distinct confirmed works, `face3d` arm | 512 | 511 |
| distinct confirmed works Δ (`face3d` − `clip`) | -7 (-11 to 3) | -8 (-11 to 2) |

**yardstick** (PROXY, library shelves)

| figure | as published | RB-1 |
|---|---|---|
| over-selecting kept boxes (%) | 50.7 (43.6 to 57.8) | 49.9 (42.6 to 57.3) |
| `face3d` confirmed Δ (pts) | -1.9 (-4.6 to 0.5) | -2.0 (-5.1 to 0.6) |
| `face3d` wrong Δ (pts) | 0.5 (0.0 to 1.6) | 0.5 (0.0 to 1.7) |

**`face3d` crop ships:** no → no (no flip).

<!-- generated by src/eval/h2-cli.ts analyse: edit above this line -->

## pilot-000 (real use (OC35): machine agreement, never accuracy (INV-17))

### Face shares

5757 kept boxes in 31 photos; 5757 measured, 0 skipped (no pixels, no frame or under 20 map pixels). Over-selecting: **49.1 % (46.1–52.5)**. Of those, trim feasible: 58.4 % (53.9–62.7), so 1652 `face3d` candidates; a feasible trim keeps 68 % / 75 % / 79 % of the box (quartiles). Own spine plane: 18.8 %. Top face drawn (top face visible, depth not default): 56.4 %.

| boxes | n | over-select | front px | edge px | top px | under px | cover px | behind px |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| all | 5757 | 49.1 % (46.1–52.5) | 73.3 % | 5.9 % | 10.5 % | 0.3 % | 8.1 % | 1.9 % |
| below eye level | 3168 | 75.0 % (71.5–78.4) | 65.2 % | 6.0 % | 18.8 % | 0.0 % | 7.9 % | 2.1 % |
| level eye level | 1114 | 20.3 % (16.4–24.4) | 81.7 % | 5.3 % | 0.7 % | 0.3 % | 9.3 % | 2.7 % |
| above eye level | 1475 | 15.3 % (13.3–17.4) | 84.8 % | 6.1 % | 0.0 % | 1.0 % | 7.2 % | 0.8 % |

Mostly which extra face, over-selecting boxes: top 66.7 %, behind 7.5 %, cover 25.6 %, under 0.2 %.

### Cost (exit c)

Cold cache, 31 photos on mps; seconds per photo, p50 / p90 / max. Model load 7.63 s once per process, not counted. EXIF field of view on 17 photos.

| step | p50 | p90 | max |
|---|---:|---:|---:|
| decode | 0.145 | 0.153 | 0.154 |
| infer | 0.99 | 0.998 | 3.663 |
| save | 1.01 | 1.081 | 1.2 |
| faces | 1.037 | 1.278 | 1.373 |
| total | 3.225 | 3.552 | 5.788 |

Second run: 31 photos, all cache hits, 0.075 s a photo (p50).

### `face3d` against `clip=frame`

1652 boxes in the subset. Shares in % of them, before → after (Δ points; 95 % paired photo-bootstrap interval). Machine agreement, never accuracy (INV-17). In frame, the before arm reproduces the cached decision on 100 % of boxes.

| boxes | n | photos | text read | confirmed |
|---|---:|---:|---|---|
| **all** | 1652 | 31 | 79.6 → 78.7 (-0.9; -2 to 0.1) | 11.3 → 10.8 (-0.4; -1.4 to 0.6) |
|   below eye level | 1512 | 30 | 79.2 → 78.7 (-0.5; -1.3 to 0.3) | 11.1 → 10.8 (-0.3; -1.2 to 0.8) |
|   level | 70 | 24 | 88.6 → 81.4 (-7.1; -16.9 to 0) | 11.4 → 7.1 (-4.3; -8.1 to 0) |
|   above eye level | 70 | 23 | 78.6 → 75.7 (-2.9; -15 to 6.9) | 14.3 → 14.3 (+0; -5.1 to 6.9) |
|   mostly a top face | 1419 | 30 | 79.2 → 78.6 (-0.6; -1.2 to 0.2) | 10.9 → 10.8 (-0.1; -1 to 1.1) |
|   mostly a cover | 228 | 30 | 82.9 → 79.8 (-3.1; -7.3 to 0.8) | 14 → 11.4 (-2.6; -4.7 to -0.5) |
|   mostly behind | 4 | 3 | 50 → 50 (+0; -50 to 100) | 0 → 0 (+0; 0 to 0) |
|   whole boxes | 975 | 31 | 83.9 → 84 (+0.1; -1.2 to 1.2) | 11.8 → 11.5 (-0.3; -1.4 to 1) |
|   cut or partial boxes | 677 | 27 | 73.4 → 71 (-2.4; -4 to -1) | 10.5 → 9.9 (-0.6; -2.1 to 1.3) |
|   in frame | 1514 | 31 | 80.1 → 79 (-1.1; -2 to -0.1) | 11.5 → 11.2 (-0.3; -1.4 to 0.8) |
|   partly out of frame | 138 | 26 | 74.6 → 75.4 (+0.7; -3.1 to 5.5) | 8.7 → 7.2 (-1.4; -3.1 to 0) |

Distinct confirmed works over the whole set: 519 → 511 (-8; -11 to 2).

| reader | calls | seconds |
|---|---:|---:|
| vision | 3304 → 3304 | 719 → 225 |
| ppocr | 3304 → 3304 | 3211 → 2160 |
| qwen | 504 → 492 | 712 → 417 |

## yardstick-library-b2 (PROXY: Library Dataset sample, box arm B2; confirmed = accepted and annotated in the image)

### Face shares

1038 kept boxes in 40 photos; 1038 measured, 0 skipped (no pixels, no frame or under 20 map pixels). Over-selecting: **49.9 % (42.6–57.3)**. Of those, trim feasible: 38.4 % (30.3–45.5), so 199 `face3d` candidates; a feasible trim keeps 68 % / 76 % / 81 % of the box (quartiles). Own spine plane: 6.9 %. Top face drawn (top face visible, depth not default): 36 %.

| boxes | n | over-select | front px | edge px | top px | under px | cover px | behind px |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| all | 1038 | 49.9 % (42.6–57.3) | 76.0 % | 4.5 % | 3.6 % | 0.1 % | 10.9 % | 4.8 % |
| below eye level | 381 | 63.8 % (49.2–74.2) | 71.4 % | 4.2 % | 8.9 % | 0.0 % | 13.0 % | 2.5 % |
| level eye level | 590 | 42.2 % (34.7–50.3) | 78.6 % | 4.7 % | 1.2 % | 0.1 % | 9.8 % | 5.6 % |
| above eye level | 67 | 38.8 % (23.6–75.0) | 72.4 % | 4.9 % | 0.1 % | 0.5 % | 12.3 % | 9.9 % |

Mostly which extra face, over-selecting boxes: cover 49 %, top 23.9 %, behind 26.8 %, under 0.2 %.

### Cost (exit c)

Cold cache, 40 photos on mps; seconds per photo, p50 / p90 / max. Model load 3.42 s once per process, not counted. EXIF field of view on 0 photos.

| step | p50 | p90 | max |
|---|---:|---:|---:|
| decode | 0.05 | 0.0757 | 0.094 |
| infer | 1.0235 | 1.0481 | 1.312 |
| save | 0.8815 | 1.1741 | 1.248 |
| faces | 0.765 | 1.1053 | 1.571 |
| total | 2.623 | 3.4242 | 3.818 |

Second run: 40 photos, all cache hits, 0.0595 s a photo (p50).

### `face3d` against `clip=frame`

199 boxes in the subset. Shares in % of them, before → after (Δ points; 95 % paired photo-bootstrap interval). Confirmed = accepted and annotated in the image; wrong = accepted, not annotated. In frame, the before arm reproduces the cached decision on 100 % of boxes.

| boxes | n | photos | text read | confirmed | wrong |
|---|---:|---:|---|---|---|
| **all** | 199 | 37 | 87.4 → 85.9 (-1.5; -3.7 to 0) | 35.7 → 33.7 (-2; -5.1 to 0.6) | 2 → 2.5 (+0.5; 0 to 1.7) |
|   below eye level | 122 | 20 | 86.9 → 85.2 (-1.6; -5.2 to 0) | 35.2 → 33.6 (-1.6; -5.3 to 2.3) | 1.6 → 1.6 (+0; 0 to 0) |
|   level | 69 | 26 | 89.9 → 88.4 (-1.4; -5.2 to 0) | 39.1 → 36.2 (-2.9; -9.1 to 2.4) | 2.9 → 4.3 (+1.4; 0 to 4.8) |
|   above eye level | 8 | 6 | 75 → 75 (+0; 0 to 0) | 12.5 → 12.5 (+0; 0 to 0) | 0 → 0 (+0; 0 to 0) |
|   mostly a top face | 79 | 12 | 82.3 → 82.3 (+0; 0 to 0) | 36.7 → 34.2 (-2.5; -7 to 2.3) | 3.8 → 3.8 (+0; 0 to 0) |
|   mostly a cover | 114 | 37 | 92.1 → 89.5 (-2.6; -6 to 0) | 36 → 34.2 (-1.8; -5.8 to 1.7) | 0.9 → 1.8 (+0.9; 0 to 3.2) |
|   mostly behind | 5 | 5 | 80 → 80 (+0; 0 to 0) | 20 → 20 (+0; 0 to 0) | 0 → 0 (+0; 0 to 0) |
|   whole boxes | 160 | 31 | 93.8 → 92.5 (-1.2; -3.6 to 0) | 41.3 → 40 (-1.2; -4.5 to 1.7) | 1.9 → 2.5 (+0.6; 0 to 2.3) |
|   cut or partial boxes | 39 | 16 | 61.5 → 59 (-2.6; -8.6 to 0) | 12.8 → 7.7 (-5.1; -12.1 to 0) | 2.6 → 2.6 (+0; 0 to 0) |
|   in frame | 179 | 34 | 88.8 → 87.2 (-1.7; -4.4 to 0) | 35.8 → 34.1 (-1.7; -4.6 to 1.1) | 2.2 → 2.8 (+0.6; 0 to 2) |
|   partly out of frame | 20 | 9 | 75 → 75 (+0; 0 to 0) | 35 → 30 (-5; -18.2 to 18.2) | 0 → 0 (+0; 0 to 0) |

| reader | calls | seconds |
|---|---:|---:|
| vision | 398 → 398 | 37 → 37 |
| ppocr | 398 → 398 | 627 → 630 |
| qwen | 178 → 174 | 228 → 225 |

## Verdict

| pilot-000 confirmed interval excludes 0 upward | pilot-000 distinct works not down | yardstick confirmed not down | yardstick wrong not up | keep |
|---|---|---|---|---|
| no | no | yes | yes | **off** |
