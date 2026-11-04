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
<!-- generated by src/eval/h2-cli.ts analyse: edit above this line -->

## pilot-000 (real use (OC35): machine agreement, never accuracy (INV-17))

### Face shares

6121 kept boxes in 31 photos; 6121 measured, 0 skipped (no pixels, no frame or under 20 map pixels). Over-selecting: **49.4 % (46.4–52.6)**. Of those, trim feasible: 57.8 % (53.5–61.7), so 1745 `face3d` candidates; a feasible trim keeps 68 % / 75 % / 79 % of the box (quartiles). Own spine plane: 19.3 %. Top facet drawn (top face visible, depth not default): 57.2 %.

| boxes | n | over-select | front px | edge px | top px | under px | cover px | behind px |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| all | 6121 | 49.4 % (46.4–52.6) | 73.1 % | 5.8 % | 10.8 % | 0.3 % | 8.0 % | 1.9 % |
| below eye level | 3420 | 74.6 % (71.4–77.9) | 65.2 % | 5.9 % | 18.9 % | 0.0 % | 7.9 % | 2.1 % |
| level eye level | 1183 | 20.0 % (16.2–23.9) | 81.9 % | 5.3 % | 0.7 % | 0.3 % | 9.2 % | 2.6 % |
| above eye level | 1518 | 15.3 % (13.4–17.3) | 84.8 % | 6.1 % | 0.0 % | 1.1 % | 7.3 % | 0.8 % |

Mostly which extra face, over-selecting boxes: top 66.9 %, behind 7.6 %, cover 25.3 %, under 0.2 %.

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

## yardstick-library-b2 (PROXY: Library Dataset sample, box arm B2; confirmed = accepted and annotated in the image)

### Face shares

1116 kept boxes in 40 photos; 1116 measured, 0 skipped (no pixels, no frame or under 20 map pixels). Over-selecting: **50.7 % (43.6–57.8)**. Of those, trim feasible: 38.0 % (30.2–44.8), so 215 `face3d` candidates; a feasible trim keeps 68 % / 76 % / 81 % of the box (quartiles). Own spine plane: 6.9 %. Top facet drawn (top face visible, depth not default): 35.9 %.

| boxes | n | over-select | front px | edge px | top px | under px | cover px | behind px |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| all | 1116 | 50.7 % (43.6–57.8) | 75.6 % | 4.6 % | 3.6 % | 0.1 % | 11.2 % | 4.9 % |
| below eye level | 409 | 65.0 % (51.0–74.9) | 71.2 % | 4.2 % | 9.0 % | 0.0 % | 13.1 % | 2.4 % |
| level eye level | 637 | 42.9 % (35.7–50.7) | 77.9 % | 4.8 % | 1.3 % | 0.1 % | 10.1 % | 5.9 % |
| above eye level | 70 | 38.6 % (23.6–72.7) | 73.2 % | 4.7 % | 0.1 % | 0.5 % | 12.4 % | 9.2 % |

Mostly which extra face, over-selecting boxes: cover 50 %, top 23.7 %, behind 26.1 %, under 0.2 %.

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

215 boxes in the subset. Shares in % of them, before → after (Δ points; 95 % paired photo-bootstrap interval). Confirmed = accepted and annotated in the image; wrong = accepted, not annotated. In frame, the before arm reproduces the cached decision on 100 % of boxes.

| boxes | n | photos | text read | confirmed | wrong |
|---|---:|---:|---|---|---|
| **all** | 215 | 37 | 87 → 85.6 (-1.4; -3.4 to 0) | 33.5 → 31.6 (-1.9; -4.6 to 0.5) | 1.9 → 2.3 (+0.5; 0 to 1.6) |
|   below eye level | 130 | 20 | 86.2 → 84.6 (-1.5; -4.9 to 0) | 33.1 → 31.5 (-1.5; -5 to 2.2) | 1.5 → 1.5 (+0; 0 to 0) |
|   level | 77 | 27 | 89.6 → 88.3 (-1.3; -4.5 to 0) | 36.4 → 33.8 (-2.6; -8 to 2.1) | 2.6 → 3.9 (+1.3; 0 to 4.2) |
|   above eye level | 8 | 6 | 75 → 75 (+0; 0 to 0) | 12.5 → 12.5 (+0; 0 to 0) | 0 → 0 (+0; 0 to 0) |
|   mostly a top face | 87 | 12 | 80.5 → 80.5 (+0; 0 to 0) | 33.3 → 31 (-2.3; -6.2 to 2.2) | 3.4 → 3.4 (+0; 0 to 0) |
|   mostly a cover | 122 | 37 | 92.6 → 90.2 (-2.5; -5.7 to 0) | 34.4 → 32.8 (-1.6; -5.4 to 1.6) | 0.8 → 1.6 (+0.8; 0 to 3) |
|   mostly behind | 5 | 5 | 80 → 80 (+0; 0 to 0) | 20 → 20 (+0; 0 to 0) | 0 → 0 (+0; 0 to 0) |
|   whole boxes | 169 | 33 | 94.1 → 92.9 (-1.2; -3.5 to 0) | 39.6 → 38.5 (-1.2; -4.4 to 1.6) | 1.8 → 2.4 (+0.6; 0 to 2.1) |
|   cut or partial boxes | 46 | 16 | 60.9 → 58.7 (-2.2; -7.7 to 0) | 10.9 → 6.5 (-4.3; -9.4 to 0) | 2.2 → 2.2 (+0; 0 to 0) |
|   in frame | 194 | 34 | 88.1 → 86.6 (-1.5; -4.1 to 0) | 33.5 → 32 (-1.5; -4.2 to 1) | 2.1 → 2.6 (+0.5; 0 to 1.9) |
|   partly out of frame | 21 | 9 | 76.2 → 76.2 (+0; 0 to 0) | 33.3 → 28.6 (-4.8; -17.7 to 18.2) | 0 → 0 (+0; 0 to 0) |

| reader | calls | seconds |
|---|---:|---:|
| vision | 430 → 430 | 40 → 39 |
| ppocr | 430 → 430 | 683 → 684 |
| qwen | 188 → 184 | 245 → 241 |

