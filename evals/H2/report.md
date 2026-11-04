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
