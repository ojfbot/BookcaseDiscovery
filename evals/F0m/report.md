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
