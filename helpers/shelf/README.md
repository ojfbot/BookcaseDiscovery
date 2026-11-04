# helpers/shelf

Card S-2's **headroom map** (`headroom.py`, `render_s2.py`; [`evals/S2/report.md`](../../evals/S2/report.md), runner
`src/eval/s2-cli.ts`) builds on S-1's rows, below. Card S-1's shelf structure: per shelf row, the planes of the board's top, the back panel and the lip (the board's
front edge), the row's **voids**, and per box the features of S-1's geometric `on-lip` label test. It reads the depth
stage's cache (`helpers/depth`, H-2) and runs nothing on the GPU. Pre-registration and results:
[`evals/S1/report.md`](../../evals/S1/report.md). Runner: `src/eval/s1-cli.ts`.

There is no environment of its own. `shelf.py`, `render.py` and `spot.py` run in `helpers/depth`'s `.venv`, since
`shelf.py` imports `faces.py`. `segment.py` runs in `helpers/label`'s, which has transformers and SAM 3.

```
python -I shelf.py --inputs inputs.jsonl [--maps DIR] > shelf.jsonl       # planes, voids, lip features per photo (CPU)
python -I render.py --inputs … --shelf … --maps … --flags … --images … --out DIR   # private still study
python -I spot.py --key key.jsonl --images … --out DIR                     # the blind spot-check sheet (private)
python -I segment.py --inputs … --maps … --flags … --images …               # prior art: OneFormer (ADE20K), SAM 3 "shelf"
python -I headroom.py --inputs inputs.jsonl [--maps DIR] > headroom.jsonl   # S-2: headroom region and classes per row (CPU)
python -I render_s2.py --headroom … --inputs … --maps … --images … --out DIR # S-2's private still study
```

- **`shelf.py`.** Per band (F-0's row of boxes) that has a frame in the depth stage:
  - the books' spine plane, base and top;
  - three RANSAC planes with orientation priors from the band's frame: the board top (normal near up, at the
    books' base), the lip (normal near the spine plane's, just under the base, not behind the books) and the back
    panel (normal near the spine plane's, more than 8 cm behind it);
  - each plane's inliers, RMS and extent, the board-top level, and the board depth (lip to back panel);
  - the row's voids in Q-0's coverage-segment unit (arc length along the polyline through the book centres, in
    median spine widths): uncovered runs of at least half a width, confirmed by H-1's `behind` class, with the
    disagreements kept apart (`outline-gap`, `behind-under-outline`);
  - per spine-path and cover-pass box, the lip features `on-lip` reads.

  Every threshold is a module constant, named in the docstring.
- **`headroom.py`** (S-2). Per S-1 row (shelf.py re-run on F-0i's partition): the region between the books' top curve
  (F-0f's fitted top lines, recomputed on the partition) and the **board line** (the lower edge of the board above's
  lip face, from the row's pitch partner), every pixel in it that is not a standing book classed **empty** (more
  than 8 cm behind the spine plane), **occluded** (the board's underside or its lip), **occupied** (a surface at the
  books' depth above their tops, in 8-connected regions of a minimum size) or **unknown** (no depth, foreground,
  speckle). Rows without a board line are `open` and reported apart. Each occupied region is checked against the
  default's own boxes (stacked, not-a-book, on-lip, others). Given `anyBoxes`, `shelf.py` also writes each stretch's
  share inside any detection box (Q-3's box-less `front` faces).
- **`render.py`.** Per photo, the plane inliers, voids and disagreements as colours over the photo, the row
  polylines, the filter's flags (cyan) and `on-lip`'s (magenta), plus an `index.html`.
- **`segment.py`.** Two off-the-shelf shelf masks, scored against `shelf.py`'s lip and board-top inliers, the kept
  books and the flagged boxes. Counts only.

Point maps, label maps, per-box rows, renders and the spot sheet all hold private photo geometry. They stay under
the data root's `private/s1/`. `test/s1.test.ts` runs `shelf.py` on a synthetic shelf, and is skipped when
`helpers/depth/.venv` is absent.
