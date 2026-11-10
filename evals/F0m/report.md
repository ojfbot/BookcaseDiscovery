# F0m: spine end edges (F-0m)

## Pre-registration (committed before the first full run)

Fixed 2026-11-04, before any full-set run of the snap, the seams or the readers. Nothing below is changed after
seeing a full result. Any change is logged as a deviation in `implementation-notes.md`, and the report says which
figures it touches.

**Question.** The owner's renders show two problems:

- outlines blur where a spine turns its corner into the paper-edge top face;
- bottom edges are often missing.

Can each kept book's top end be snapped to the depth stage's front-to-top normal crease, and its bottom end to S-1's
board top (or the lip that hides it), so that a row's ends line up? And does reading the snapped boxes help the
readers?

**Sets, never merged (OC35).**

- **`pilot-000`** (31 real-use photos):
  - boxes: F-0e's default `bands+strips` boxes, after the shipped not-a-book filter and F-0i's partition (5,761 kept
    boxes), with F-0i's exclusive outlines and label maps;
  - depth: H-2's MoGe-2 cache (`moge-2-vitl-normal@cb0e8bb`), its band frames and face rows;
  - planes: S-1's rows, as S-2 re-ran `shelf.py` on the partition (`private/s2/pilot-000/shelf.jsonl`);
  - readers: those F-0e cached, with F-0's decision on them (H-2's `base-decisions`).

  Every reader figure is **machine agreement, never accuracy** (INV-17). It is a dev set (OC11).
- **Yardstick (PROXY)**: the 40-image Library Dataset sample with F-0's B2 boxes, after the same filter and F-0i's
  partition (1,040 kept boxes), the same depth cache and S-2's rows. *Confirmed* = accepted and annotated in the
  image; *wrong* = accepted, not annotated. Evaluation only: never trained or tuned on.

No hand labels (OC36). Nothing is trained. Box ids (`photo:index`) never change. F-0i's dropped boxes stay dropped,
and unseparated neighbours are F-0i's problem, not this card's.

**Looked at before fixing the rules (disclosed).** The owner's two examples were matched to their `pilot-000` photo
by ORB and confirmed by eye (both are glow-overlay screenshots of one bay). The snap was run on that photo only, and
on the first two photos of `pilot-000` and the first of the yardstick (crashes only). On the example photo's
render, two things changed before this text was fixed:

- the width of an outline grown to its end line comes from the outline's middle half, not from its tapered end;
- the growth fills the spine's column on that end's half, not only past the outline's last pixel.

Neither changes where an end line falls. No measure was computed before this commit.

### The snap (`helpers/depth/ends.py`, CPU, no model)

Per kept box with an outline: `a` is its detection rectangle's long axis (pointing down the image), `L` its length,
`W` its width, and `t` the coordinate along `a`. A box tilted more than 30° from vertical is left alone. Its
outline's least and greatest `t` are its current ends.

- **Top: the front-to-top crease.**
  - **Strip:** a strip of the depth map along the axis, 0.3 W either side of it, from 0.25 L beyond the outline's top
    to 0.5 L inside it.
  - **Classes:** each map pixel is classed by `faces.py`'s `classify` in the box's own frame (its band's, or its
    `ownPlane` frame), with the box's own spine-plane offset.
  - **Profile:** per bin of one map pixel along the axis, the share of `front` and of `top` pixels.
  - **Crease:** the bin boundary that maximises the mean of (top − front) over the window above it plus the mean of
    (front − top) over the window below it. The window is max(3 map px, 0.06 L).
  - **Found** when the top share above it is ≥ 0.4 and the front share below it is ≥ 0.5.
  - **End line:** through the crease on the axis, along the projected side direction of the band frame.
- **Bottom: the board top, or the lip that hides it.** This needs an S-1 row on the box's band (not an `ownPlane`
  side case) with a found board top or lip (`levelSource` board or lip).
  - **Book position:** `a_i` and `c_i` are the medians of `s · P` and `n_f · P` over the box's front pixels.
  - **Contact:** the point `a_i s + level u + c_i n_f`.
  - **Lip edge:** when the lip is found, the point on the lip plane at side `a_i` and the lip's p95 height.
  - **Projection:** both through MoGe-2's intrinsics. The end is the one higher in the image: from above that is the
    contact, from below the lip edge that hides the books' feet.
  - **Snaps** when it moves the outline's bottom by at most 0.25 L, either way. Otherwise the bottom is
    `implausible` and unchanged.
- **Outline.**
  - **Cut:** the exclusive outline is cut to the inside of each snapped end line.
  - **Grow:** where the line lies past the outline, the outline is grown to it. The growth is the spine's column (the
    outline's p5–p95 across extent on its middle half) on the box's half nearer that end.
  - **Ownership:** a grown pixel another kept box owns in F-0i's label map is never taken. A pixel two boxes grow
    into goes to the one whose axis is nearer.
  - **New outline:** the mask's largest outer contour, lossless, as F-0i writes them, plus a new label map.
- **Box:** the detection rectangle with each snapped end moved to where its end line crosses the axis. Its axis and
  width are unchanged. An end that did not snap keeps the rectangle's own end.

### Readers (F-0b's procedure, as H-2 and F-0i ran it)

The **changed set** is the kept boxes whose snapped box gives a `rect;rot=fixed;clip=frame` crop differing from
their detection rectangle's (any corner more than 1 px apart).

- **`clip`** (before): the shipped crop on the detection rectangle. Cached readings are reused where the crop equals
  the cached one.
- **`snap`**: the shipped crop on the snapped box. This is a whole-spine crop, crease to board; nothing is trimmed to
  a piece.

Reading follows F-0b's procedure:

- Vision and PP-OCR read every changed box.
- Qwen reads hard crops under F-0's selection per photo (cap 40 on `pilot-000`, 15 on the yardstick). The changed
  boxes compete with the cached first-pass state of the photo's other kept boxes.
- Decisions use F-0's unchanged `decide` and catalog bar, with basis `readers-agree` only.

Qwen runs on the GPU. It is this card's only GPU step, run only once the conductor confirms the GPU is free.
**Fallback, fixed now:** if the conductor does not grant it, both arms are decided on Vision and PP-OCR alone (Qwen
readings dropped in both), and the report says so.

### Measures

Every interval is a 95 % paired photo-cluster bootstrap with 2,000 draws.

- **M1, row-end residuals** (end-edge consistency against F-0f's fitted lines).
  - **Rows and lines:** in each arm, F-0f's `rowFits` on that arm's kept boxes (before: the detection rectangles;
    after: the snapped boxes) gives each upright box its row's top and bottom lines and spine height `h`.
  - **Residual:** an end's residual is its distance to its row's line along the box's own axis, in units of `h`,
    capped at 0.5.
  - **Figure:** the mean residual over boxes, bottom and top apart. The change is after − before.
  - **Rule:** bottoms carry the rule, since books stand on one board. Tops are reported, since books differ in height.
- **M2, Q-2's top-seam error** (F-0f's measure): the share of upright kept boxes whose top is more than 0.05 of the
  long side off `helpers/coverage/geometry.py`'s top seam.
  - **Arms:** before on the detection rectangles, after on the snapped boxes.
  - **Reported:** the change, its cut and overshoot parts, and the change by thirds of the frame.
  - **Expected confound, written before any result:** F-0f found that from above, Q-2's seam often takes the top
    face's far edge, not the spine's top. A box snapped to the crease can then read as "cut". The rule uses the
    whole-set figure regardless.
- **M3, partition invariant:** the overlap rate of the new outlines (pixels claimed by two or more ÷ pixels claimed
  by at least one, pooled over photos), before and after.
- **M4, lost outlines:** kept boxes whose snapped mask is empty. Should be 0.
- **M5, readers on the changed set:** text read, confirmed and (yardstick) wrong, before → after.
- **M6, books lost** (`pilot-000`): the number of distinct (photo, work) pairs confirmed over the whole set, before
  and after. Changed boxes take the arm's decision and the rest their cached one. The pairs confirmed before by some
  box and by none after are reported as a count.
- **M7, yardstick titles:** title recall and precision per image (F-0e's `titleDelta`).
- **Reported, not in a rule:**
  - snap counts by status and bottom source;
  - moves as shares of `L` (p10, median, p90);
  - the area claimed before and after;
  - strata by H-1's elevation (below eye level < −10°, level, above > 10°);
  - strata by F-0i's `ends` provenance (an end F-0i moved, or the original outline's);
  - whole against cut or partial boxes;
  - CPU seconds per photo, and reader calls.

### Keep rules

**The snapped outlines and box ends ship as a geometry cache** (the box set and outlines downstream cards read) when
all of these hold:

- **G1:** on `pilot-000`, the bottom residual (M1) falls, with its interval wholly below 0.
- **G2:** on `pilot-000`, Q-2's top-seam error (M2) does not rise beyond its interval (lower end ≤ 0).
- **G3:** on both sets, the overlap rate after is ≤ 0.5 % and no outline is lost (M3, M4).
- **G4:** on the yardstick, the bottom residual does not rise beyond its interval (lower end ≤ 0), and nor does the
  top-seam error.

**The snapped box ships as the reader crop's polygon** only if all of these hold (F-0b's rule; "keep only if no
confirmed book is lost" is read as H-2's and F-0i's works guard):

1. The geometry cache ships.
2. `pilot-000`: the confirmed-share interval on the changed set excludes 0 upward.
3. `pilot-000`: distinct confirmed works do not fall (point change ≥ 0). The count of (photo, work) pairs lost is
   reported beside it.
4. Yardstick: the confirmed share does not fall beyond its interval (upper end ≥ 0), and wrong accepts do not rise
   beyond theirs (lower end ≤ 0).
5. Yardstick: title recall does not fall beyond its interval (upper end ≥ 0).

If the reader crop fails, the shipped crop stays `rect;rot=fixed;clip=frame` on the detection rectangle, and the
geometry cache's verdict stands on its own.

**Not done here.** Downstream caches are not re-baselined. The conductor batches that after F-0k and NB-3; this
report lists which caches the snap invalidates.

## Verdict (run 2026-11-04, after the pre-registration above)

Aggregates are in [`metrics.json`](metrics.json); the tables below the marker are generated by
`src/eval/f0m-cli.ts analyse`. `pilot-000` figures are machine agreement, never accuracy (INV-17); the two sets are
reported apart (OC35). The conductor granted the Qwen step (caps 40 and 15, same pin and cache in both arms; 21 GPU
minutes on the yardstick, 61 on `pilot-000`), so the primary figures use all three readers. The no-Qwen fallback was
also computed and is reported under Findings.

- **The geometry cache does not ship.** Two of the five pre-registered conditions fail:
  - **G1 fails.** The `pilot-000` bottom residual barely moves: 0.0423 → 0.0411 row spine heights (−0.0013; −0.0047
    to 0.0024). The yardstick's falls (−0.0108; −0.0177 to −0.0038), but it carries no rule.
  - **G3 fails on one count.** Overlap stays far under 0.5 % (`pilot-000` 0.05 % → 0.10 %, yardstick 0.15 % →
    0.14 %), but **2 `pilot-000` outlines are lost** (see Findings 4).
  - G2 and G4 hold. Q-2's top-seam error *falls*: −16.4 points (−20.8 to −12.0) on `pilot-000`, −9.5 (−14.2 to −5.0)
    on the yardstick.
- **The reader crop stays `rect;rot=fixed;clip=frame` on the detection rectangle.**
  - Rule 1 fails, because the geometry does not ship.
  - Rule 2 also fails on its own: `pilot-000` confirmed **+0.2 points (−0.4 to 0.9)** on the 4,763 changed boxes.
  - Rules 3–5 hold:
    - distinct confirmed works 639 → 647 (+8; −6 to 16), with 84 (photo, work) pairs lost and 92 gained;
    - yardstick confirmed +0.9 (−1.1 to 2.7), wrong −0.1 (−0.5 to 0);
    - yardstick title recall +0.5 (−1.9 to 2.5).

## Findings

1. **The top crease does what the owner asked, and Q-2's seam agrees.**
   - **Where it fires:** below eye level, the crease is found on 2,464 of 3,170 `pilot-000` boxes, and above eye
     level on none (no top face shows from below).
   - **How far:** the median snapped top moves 14 % of the box's length inward: the paper-edge top face comes off.
   - **Seam error:** below eye level it falls from 70.5 % to 40.3 % (−30.1; −36.5 to −23.0); the bottom third of
     the frame falls from 74.4 % to 41.1 %; the overshoot part from 37.5 % to 23.3 %; the cut part does not rise
     (−2.2; −4.5 to 0.2).
   - **Against the expectation:** the confound pre-registered from F-0f (the seam taking the top face's far edge)
     did not dominate. At the crease, the spine's colour against white page tops is the strongest step.
2. **Bottoms were already consistent as boxes; the change is in outlines, which M1 does not measure.**
   - **Detection rectangles:** their bottoms were already on their row's line (0.042 of a spine height on average).
     Snapping them leaves that unchanged (G1).
   - **Outlines:** the change is in the exclusive outlines, cut or grown to the board contact. The median bottom move
     is −2.4 % of the length (p10 −9.5 %, p90 +3.5 %): mostly trimming SAM's spill onto the board, sometimes growing
     a short outline down.
   - **Sources:** of 4,010 snapped `pilot-000` bottoms, 2,650 end on the lip's top edge, 879 on the board contact
     and 481 on the lip level where no board top was found.
   - **Not snapped:** 567 are `implausible` (more than a quarter of the box's length off) and left alone; 1,021
     boxes have no S-1 row (no band, or a side case on its own plane).
   - **Not pre-registered:** the measure the owner's complaint needs is the same residual on *outline* ends. It is a
     hypothesis for a fresh pre-registration, not a re-test here.
3. **Top residuals rise, as expected for books of different heights.** `pilot-000` +0.037 (0.030 to 0.046), all of
   it below eye level (+0.067). Snapped tops sit on each book's own crease, and unsnapped neighbours keep their
   overshoot, so a row's tops scatter more around one fitted line. The rule was put on bottoms for this reason.
4. **Two outlines lost: a defect in the pre-registered step, left unfixed here.**
   - **Cause:** both boxes are pieces whose exclusive outline covers only the top part of a long detection rectangle.
   - **Mechanism:** the crease window reaches half the *rectangle's* length inside the outline's top. That is past
     the outline's own bottom, so the cut keeps nothing.
   - **Fix (not run):** bound the window by the outline's length, and keep the original outline when a cut leaves
     nothing. Changing it after the result would be a post-hoc re-test, so it is logged, not run. G1 fails either
     way.
5. **The readers barely notice the ends.**
   - **Text read** falls a little on both sets (−0.5, −0.6 points), most on cut or partial boxes (−1.0 on
     `pilot-000`): F-0b's finding that trimming a piece costs text.
   - **Confirmed** does not move on `pilot-000`. On the yardstick the boxes with a snapped top gain +1.8 (0.4 to 3.7),
     a stratum, not a rule.
   - **Without Qwen** (the pre-registered fallback, computed for comparison):
     - `pilot-000` confirmed −0.3 (−0.7 to 0.2) and works 509 → 498 (−11; −14 to 2);
     - yardstick confirmed +1.8 (0.2 to 3.5) and title recall +1.8 (0.1 to 3.8).

     Qwen, reading the hard crops, absorbs most of the difference.
6. **F-0i's moved ends.** The snap moved 61 of the 85 tops and 25 of the 71 bottoms that F-0i's resolve had moved on
   `pilot-000`. Their residuals behave like the rest (bottoms −0.0001; tops +0.041).
7. **Cost.** The snap takes 5.0 CPU seconds a photo on `pilot-000` and 2.5 on the yardstick, from the depth cache and
   S-2's rows; no SAM re-prompt was needed. The readers took about 1.5 h of CPU and 82 minutes of GPU for Qwen.

## Caches it invalidates if it ships

It does not ship as pre-registered, so nothing is invalidated now. If a later card adopts the snapped ends:

| cache | needs re-baselining? | why |
|---|---|---|
| the box set (box polygons' ends) | **yes** | 4,830 `pilot-000` and 778 yardstick kept boxes move an end; box ids are unchanged and no box is added or dropped |
| F-0i's exclusive outlines and label maps | **yes, superseded** | the snapped outlines and label maps in the data root's `private/f0m/<set>/` replace them; claimed pixels fall 5 % on `pilot-000` |
| S-1 voids and S-2 headroom (rows, top curve, gaps) | **yes** | voids and gaps come from the outlines; S-2's top curve comes from F-0f's lines on the box ends |
| H-2 face shares | **yes, for moved boxes** | the face split is measured inside the box polygon |
| Q-3's gap audit (`top-face` and `frame-edge` causes) | **yes** | its causes read H-2's shares and the box geometry |
| F-0g / F-0g2 copy-group appearance, F-0h rows | **yes** | appearance strips are warped from the box polygon; rows from box positions |
| NB-3's pixel probe | **yes** | it reads the warped box crop |
| Q-2b outlines and τ, U-4 still study | **yes** | they draw or score the outlines |
| reader caches (Vision, PP-OCR, Qwen) and F-0's decisions | no | the reader crop does not change |
| MoGe-2 depth cache, S-1 planes | no | per photo, independent of boxes |

The re-baselining is the conductor's, batched after F-0k and NB-3.

## Limits

- **No box or mask ground truth.** Whether a crease or a contact is right is not measured. The private render
  (`private/f0m/renders/<set>/index.html`, the owner's example photo first) is for the owner's eye.
- **Unvalidated geometry.** The depth stage's metres are unverified (S-1), and the lip's p95 stands in for its top
  edge.
- **Reader caveats as F-0b's.** Changed boxes compete for Qwen's cap with the cached state of the rest, and 4,763
  changed boxes are most of the set, so the cap binds on almost every photo.

<!-- generated by src/eval/f0m-cli.ts analyse: edit above this line -->

## The snap, both sets

| figure | `pilot-000` | yardstick (PROXY) |
|---|---|---|
| photos / kept boxes | 31 / 5761 | 40 / 1040 |
| top ends by status | no-crease 3058, snapped 2552, lying 149, few-front 2 | no-crease 712, snapped 274, lying 52, few-front 2 |
| bottom ends by status | snapped 4010, no-row 1021, implausible 567, lying 149, no-plane 12, few-front 2 | snapped 740, implausible 172, no-row 71, lying 52, no-plane 3, few-front 2 |
| snapped bottoms by source | lip-edge 2650, board 879, lip-level 481 | lip-edge 498, lip-level 125, board 117 |
| top move, share of length (p10 / median / p90; + trims) | -0.0733 / 0.1429 / 0.3057 | 0.0061 / 0.1148 / 0.2206 |
| bottom move, share of length (p10 / median / p90; − trims) | -0.0952 / -0.0243 / 0.035 | -0.1165 / -0.0369 / 0.069 |
| boxes with a moved polygon / outlines lost | 4830 / 2 | 778 / 0 |
| pixels claimed, before → after | 708,015,917 → 674,393,172 | 503,622,455 → 488,396,780 |
| **overlap rate before → after (target ≤ 0.5 %)** | 0.05 (0.03 to 0.07) → 0.10 (0.03 to 0.21) | 0.15 (0.03 to 0.31) → 0.14 (0.02 to 0.31) |
| F-0i-moved ends snapped (top; bottom) | 61 of 85; 25 of 71 | 4 of 16; 8 of 18 |
| CPU seconds per photo | 4.9913 | 2.4535 |

Snapped ends by H-1 elevation (boxes / tops snapped / bottoms snapped):

| elevation | pilot-000 | yardstick-library-b2 |
|---|---|---|
| below | 3170 / 2464 / 1965 | 382 / 223 / 291 |
| level | 1114 / 88 / 874 | 591 / 51 / 406 |
| above | 1477 / 0 / 1171 | 67 / 0 / 43 |
| unknown | 0 / 0 / 0 | 0 / 0 / 0 |

## M1: row-end residuals (row spine heights, capped at 0.5; after − before, 95 % paired interval)

| ends | pilot-000 before → after | change | yardstick-library-b2 before → after | change |
|---|---|---|---|---|
| **bottom** | 0.0423 → 0.0411 (n 5388) | -0.0013 (-0.0047 to 0.0024) | 0.0861 → 0.0753 (n 937) | -0.0108 (-0.0177 to -0.0038) |
| top | 0.0681 → 0.1055 (n 5388) | 0.0374 (0.0295 to 0.0456) | 0.1058 → 0.1193 (n 937) | 0.0135 (0.0057 to 0.0213) |
|   bottom, below eye level | 0.0608 → 0.0612 (n 2922) | 0.0004 (-0.0067 to 0.0073) | 0.0646 → 0.0487 (n 350) | -0.0159 (-0.0254 to -0.0072) |
|   top, below eye level | 0.0665 → 0.1332 (n 2922) | 0.0667 (0.0519 to 0.0814) | 0.1047 → 0.1339 (n 350) | 0.0292 (0.0110 to 0.0475) |
|   bottom, level eye level | 0.0175 → 0.0141 (n 1045) | -0.0034 (-0.0054 to -0.0011) | 0.1063 → 0.0983 (n 530) | -0.0080 (-0.0177 to 0.0032) |
|   top, level eye level | 0.0662 → 0.0683 (n 1045) | 0.0022 (-0.0001 to 0.0046) | 0.1121 → 0.1168 (n 530) | 0.0047 (-0.0001 to 0.0102) |
|   bottom, above eye level | 0.0223 → 0.0195 (n 1421) | -0.0029 (-0.0071 to 0.0015) | 0.0297 → 0.0257 (n 57) | -0.0040 (-0.0123 to 0.0000) |
|   top, above eye level | 0.0730 → 0.0759 (n 1421) | 0.0028 (0.0017 to 0.0040) | 0.0523 → 0.0527 (n 57) | 0.0003 (-0.0001 to 0.0014) |
|   bottoms F-0i moved | 0.1244 → 0.1243 (n 59) | -0.0001 (-0.0202 to 0.0182) | 0.1596 → 0.1226 (n 15) | -0.0370 (-0.0714 to 0.0072) |
|   tops F-0i moved | 0.0753 → 0.1167 (n 78) | 0.0414 (0.0174 to 0.0698) | 0.1566 → 0.1772 (n 15) | 0.0206 (-0.0196 to 0.0891) |

## M2: Q-2's top-seam error (share of upright kept boxes off the seam by > 0.05 of the long side)

| part | pilot-000 before → after | change (points) | yardstick-library-b2 before → after | change (points) |
|---|---|---|---|---|
| **any** | 53.4 % → 37.0 % | -16.4 (-20.8 to -12.0) | 48.0 % → 38.5 % | -9.5 (-14.2 to -5.0) |
| cut | 15.8 % → 13.6 % | -2.2 (-4.5 to 0.2) | 16.1 % → 16.3 % | 0.2 (-1.7 to 2.2) |
| overshoot | 37.5 % → 23.3 % | -14.2 (-17.2 to -11.2) | 31.9 % → 22.2 % | -9.7 (-15.0 to -5.0) |
|   top third of the frame | 35.8 % → 35.4 % | -0.4 (-1.0 to 0.3) | 46.2 % → 38.8 % | -7.3 (-21.8 to -0.5) |
|   middle third of the frame | 43.7 % → 33.4 % | -10.4 (-14.8 to -6.2) | 48.1 % → 39.4 % | -8.7 (-14.8 to -3.2) |
|   bottom third of the frame | 74.4 % → 41.1 % | -33.3 (-40.4 to -25.3) | 48.8 % → 33.8 % | -15.0 (-26.5 to -2.3) |
|   below eye level | 70.5 % → 40.3 % | -30.1 (-36.5 to -23.0) | 57.5 % → 38.5 % | -19.1 (-26.0 to -11.0) |
|   level eye level | 30.9 % → 31.9 % | 1.0 (-0.3 to 2.4) | 41.8 % → 37.3 % | -4.5 (-9.5 to -0.5) |
|   above eye level | 34.1 % → 33.6 % | -0.5 (-1.1 to 0.1) | 46.8 % → 48.4 % | 1.6 (0.0 to 5.8) |

## pilot-000: readers, `snap` against `clip` (real use (OC35): machine agreement, never accuracy (INV-17))

4763 changed boxes; Qwen: F-0's hard-crop selection. Shares in % of them, before → after (Δ points; 95 % paired photo-bootstrap interval).

| boxes | n | photos | text read | confirmed |
|---|---:|---:|---|---|
| **all** | 4763 | 31 | 82 → 81.5 (-0.5; -1.1 to -0.1) | 13.9 → 14.1 (+0.2; -0.4 to 0.9) |
|   top snapped | 2539 | 30 | 77 → 76.5 (-0.5; -1.2 to 0.3) | 10.8 → 11.1 (+0.3; -0.3 to 0.8) |
|   bottom only | 2224 | 31 | 87.9 → 87.2 (-0.6; -1.5 to 0.1) | 17.4 → 17.4 (+0; -1 to 1.2) |
|   below eye level | 2746 | 30 | 76.9 → 76.3 (-0.6; -1.3 to 0.1) | 11.3 → 11.4 (+0.1; -0.6 to 0.7) |
|   level or above | 2017 | 31 | 89.1 → 88.6 (-0.5; -1.4 to 0.3) | 17.5 → 17.7 (+0.2; -0.9 to 1.5) |
|   whole boxes | 3173 | 31 | 86.4 → 86.1 (-0.3; -1 to 0.4) | 14.1 → 14.4 (+0.3; -0.5 to 1.3) |
|   cut or partial boxes | 1590 | 30 | 73.3 → 72.3 (-1; -1.9 to -0.3) | 13.5 → 13.3 (-0.1; -0.9 to 0.6) |

Distinct confirmed works over the whole set (per photo, summed): 639 → 647 (+8; -6 to 16); (photo, work) pairs lost 84, gained 92.

| reader | calls | seconds |
|---|---:|---:|
| vision | 9516 → 9516 | 2268 → 1277 |
| ppocr | 9516 → 9516 | 9061 → 6529 |
| qwen | 2162 → 2158 | 2966 → 1883 |

## yardstick-library-b2: readers, `snap` against `clip` (PROXY: Library Dataset sample, box arm B2; confirmed = accepted and annotated in the image)

773 changed boxes; Qwen: F-0's hard-crop selection. Shares in % of them, before → after (Δ points; 95 % paired photo-bootstrap interval).

| boxes | n | photos | text read | confirmed | wrong |
|---|---:|---:|---|---|---|
| **all** | 773 | 40 | 82.5 → 81.9 (-0.6; -1.4 to -0.1) | 29.1 → 30 (+0.9; -1.1 to 2.7) | 2.5 → 2.3 (-0.1; -0.5 to 0) |
|   top snapped | 274 | 17 | 79.9 → 78.8 (-1.1; -3.3 to 0) | 28.8 → 30.7 (+1.8; 0.4 to 3.7) | 1.8 → 1.8 (+0; -1 to 1) |
|   bottom only | 499 | 39 | 84 → 83.6 (-0.4; -1 to 0) | 29.3 → 29.7 (+0.4; -2.5 to 3) | 2.8 → 2.6 (-0.2; -0.6 to 0) |
|   below eye level | 313 | 25 | 85.6 → 84.7 (-1; -2.7 to 0) | 32.3 → 33.2 (+1; -1.6 to 3.6) | 1.6 → 1.6 (+0; -1 to 0.9) |
|   level or above | 460 | 35 | 80.4 → 80 (-0.4; -1.1 to 0) | 27 → 27.8 (+0.9; -1.3 to 3.3) | 3 → 2.8 (-0.2; -0.7 to 0) |
|   whole boxes | 638 | 40 | 91.8 → 91.2 (-0.6; -1.5 to 0) | 33.5 → 34.2 (+0.6; -1.5 to 2.5) | 2.8 → 2.7 (-0.2; -0.5 to 0) |
|   cut or partial boxes | 135 | 28 | 38.5 → 37.8 (-0.7; -2.8 to 0) | 8.1 → 10.4 (+2.2; -1.5 to 7.9) | 0.7 → 0.7 (+0; 0 to 0) |

Titles over the whole set: recall 38.1 % → 38.6 % (0.5 (-1.9 to 2.5) points), precision 92.9 % → 93.3 % (0.4 (-0.2 to 1.3)).

| reader | calls | seconds |
|---|---:|---:|
| vision | 1546 → 1546 | 137 → 136 |
| ppocr | 1546 → 1546 | 2449 → 2598 |
| qwen | 726 → 696 | 965 → 989 |

## Verdict (generated)

| geometry rule | met |
|---|---|
| G1 pilot bottom residual falls (interval below 0) | no |
| G2 pilot seam error not up beyond its interval | yes |
| G3 overlap ≤ 0.5 % and no outline lost, both sets | no |
| G4 yardstick bottom residual not up beyond its interval | yes |
| G4 yardstick seam error not up beyond its interval | yes |

Geometry cache (snapped outlines and box ends): **does not ship**.

| reader rule | met |
|---|---|
| 1 geometry ships | no |
| 2 pilot confirmed interval excludes 0 upward | no |
| 3 pilot distinct works not down | yes |
| 4 yardstick confirmed not down | yes |
| 4 yardstick wrong not up | yes |
| 5 yardstick title recall not down | yes |

Reader crop on the snapped box: **off; the crop stays `rect;rot=fixed;clip=frame` on the detection rectangle**.
