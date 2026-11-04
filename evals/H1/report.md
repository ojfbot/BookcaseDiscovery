# H1: 3D book volumes spike (H-1)

Run 2026-11-03, card H-1. **Question:** can monocular depth and normals split each detected spine box into its
**spine face** and the other faces it takes in (a receding cover, a top face, the back wall)? How many boxes
over-select, and is trimming to the spine face feasible? One set: **`pilot-000`** (31 real-use photos), with
F-0e's default `bands+strips` boxes (B2) unchanged. The owner's 2026-11-03 example is one of these photos and is
also reported on its own. Every figure is a **machine measurement, not accuracy** (INV-17). There are no hand
labels, and nothing was trained. `pilot-000` is a dev set, so the numbers are optimistic (OC11). Aggregates are in
[`metrics.json`](metrics.json); the survey and recommendation are in
[`docs/models/3d-volumes.md`](../../docs/models/3d-volumes.md).

**Method.** `helpers/depth/` ([README](../../helpers/depth/README.md)):

1. MoGe-2 ViT-L with the normal head (MIT) gives a metric point map and normals per photo, with its long side at
   2048 px, on MPS.
2. Each shelf band gets a spine-plane normal (the mode of its boxes' normals), an up direction (from horizontal
   surfaces) and an offset.
3. Each box pixel is classed by its normal's angle to the spine plane: front under 30°, edge 30–45°, other at
   45° or more. Other pixels split into top, under or cover by direction. A front-facing pixel more than 8 cm
   behind the plane is "behind".
4. A box **over-selects** when top, under, cover and behind make up at least 15 % of its pixels.
5. The **trim** is the largest connected spine-face region's minimum-area rectangle. It counts as **feasible**
   when it holds at least 80 % of the face, is at least 85 % pure and keeps at least half the box's length.

Every threshold was fixed before the first run. Elevation is measured at the box's centre against the horizon:
*below* means more than 10° below eye level, so the shelf is seen from above. Intervals are 95 % photo bootstraps
(2,000 draws).

## Findings

1. **About half of all boxes over-select, and three quarters of those below eye level do.**

   | | boxes | over-select | top px | cover px |
   |---|---|---|---|---|
   | All `pilot-000` | 6,145 | **49.2 % (46.4–52.7)** | 10.8 % | 8.0 % |
   | below eye level | 3,432 | **74.5 % (71.5–77.8)** | 18.8 % | 7.9 % |
   | level (±10°) | 1,192 | 19.9 % (16.4–23.9) | 0.7 % | 9.2 % |
   | above eye level | 1,521 | 15.3 % (13.3–17.4) | 0.0 % | 7.3 % |
   | Owner's example | 143 | 51.7 % | 12.7 % | 7.6 % |
   | its boxes below eye level | 72 | 88.9 % | 24.3 % | 8.0 % |

   Of the over-selecting boxes, 66.9 % take in mostly a **top face**, 25.3 % mostly a **receding cover** and 7.6 %
   mostly the **back wall or a gap**. Shelf undersides are 0.2 %. This is the owner's observation in numbers: on
   low rows the box runs onto the book's top, and wherever books lean or the shot is angled it takes in a cover.
   Above eye level no top faces show, as the geometry predicts: 0.0 % of pixels.
2. **Trimming to the spine face is feasible for 57.7 % (53.4–61.5) of over-selecting boxes**, and for 79.1 % of all
   boxes. A feasible trim keeps a median 75 % of the box's area (interquartile range 68–79 %). On the owner's
   example the trims stop at each book's top edge on the low rows, the fix the owner described. In the
   renders, the infeasible cases are boxes whose face splits into pieces: a box spanning two spines, a leaning
   book whose face a neighbour's cover crosses, or a box that is mostly not a book (the case's side, a corner).
   They were not counted by kind.
3. **Face splitting works on a blind spot check.** The H-1 agent, not the owner, looked at 60 random boxes: 40
   flagged as over-selecting and 20 not, shuffled, judged before reading which was which. 7 were unclear. Of the
   53 judged, the machine and the agent agree on 47 (89 %):
   - Of 35 flagged boxes, 33 show a real top face, cover or background.
   - The 2 errors are a dark spine in a dim corner, called "behind", and a book lying tilted on others, whose own
     spine was called "cover".
   - Of 18 unflagged boxes, 4 show a small extra face (7–12 % of the box), below the 15 % cut.
4. **One spine plane per band is wrong on angled whole-case photos.** In the first run every band had one plane,
   and the side case of an angled shot shares bands with the front case. So its spines were read as covers, and
   over-selection came out 58.1 % (55.0–61.4), cover-driven. Giving a box whose dominant vertical face is more than
   35° from its band's plane a plane of its own (1,180 boxes, 19 %) fixed it in the renders, and is what the table
   above reports. Both runs are in `metrics.json`. The fallback was added after seeing a render, so it was tuned
   on this dev set (logged as a deviation).
5. **The spine plane is flat to a few centimetres.** Within a frame, the interquartile spread of spine-face offsets
   has a median of 2.4 cm (quartiles 1.2–4.6). That suits a per-shelf plane fit and a vanishing-direction prior.
6. **Cuboids can be drawn, but their depth is weak.** Every box with a spine face (6,138) gets a cuboid. Its depth
   is seen on the book's own top or cover for 53 %, borrowed from the band's median for 40 %, and a 20 cm default
   for 6 %. The seen depth has a median of 8.2 cm (10th–90th percentile 3.8–18.3). That is short of the 13–24 cm a
   book is deep (*hypothesis*): a top face seen from just above is foreshortened, and part of it is hidden by the
   shelf or a neighbour. Metric scale is unverified. Spine heights have a median of 25.5 cm (14.5–29.8) and
   thicknesses 4.5 cm (2.5–8.7). They are plausible as a mix but run high on the owner's example (29.4 cm for what
   look like computer books, *hypothesis*: about 23–24 cm). So relative geometry is usable today, and absolute
   size needs LiDAR or a known reference.
7. **The colour top seam only half agrees.** Q-2's colour-step top seam (`helpers/coverage/geometry.py`) ran on the
   same boxes. Boxes it calls *overshoot* have more top-face pixels than boxes *at the edge* (12.2 % against 7.4 %),
   as expected. But boxes it calls *cut* have the most (17.7 %). The colour step seems to lock onto either edge of
   a visible top face, so it cannot tell "box ends on the top face" from "box cuts the spine". Normals can.
8. **MoGe's own field of view is close, but not close enough to skip EXIF.** On the 17 photos that keep the
   sensor's full frame, its estimate is off by a median of 2.9° from the EXIF value (90th percentile 5.3°, worst
   12.9°). The run uses EXIF where it exists, and MoGe's estimate for cropped photos.
9. **Cost.** MoGe-2 took a median 1.95 s a photo on MPS (worst 2.37 s), with the GPU shared with other card
   sessions; the weights are 1.3 GB. The face split took a median 1.3 s a photo on CPU. That is about 1.7 minutes
   for all of `pilot-000`, against detection's 78 s a photo.

## What this does not show

- **No reader or identity lift was measured.** F-0b found that a mask-based spine-face trim raised matches but
  cost text on `pilot-000`. A normals-based trim should be re-tested under F-0b's keep rule before any default
  changes: that is the build card's exit criterion, not this spike's.
- **No yardstick run.** Library shelves are mostly square-on, so they would test the "level" stratum only.
- **No multi-view.** `pilot-000` holds stills of different cases, not several views of one, so the owner's "many
  angles" case could not be tested. It needs a guided sweep or a burst of stills of one shelf.
- The visual check is one agent's judgement on 60 boxes. It is not a label set and not accuracy.

## Private outputs

The page at the data root's `private/h1/renders/index.html` shows, for each of the 31 photos (the owner's example
first): the photo, normals, depth, the face split, the trims and the cuboids. Per-photo geometry, class maps and
per-box rows sit beside it under `private/h1/`. None of it enters the repo.
