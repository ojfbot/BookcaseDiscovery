# helpers/coverage

Python (`uv`, its own `.venv`: numpy and the same pinned OpenCV as `helpers/label`) for the capture-quality cards.
Q-1's runner is `src/eval/q1-cli.ts` ([`evals/Q1/report.md`](../../evals/Q1/report.md)); Q-2's is `src/eval/q2-cli.ts`
([`evals/Q2/report.md`](../../evals/Q2/report.md)), and Q-2b's, the same analysis on the current default boxes, is
`src/eval/q2b-cli.ts` ([`evals/Q2b/report.md`](../../evals/Q2b/report.md)).

```
uv sync
python -I features.py --detect detect.jsonl --images images.jsonl > features.jsonl   # one line per detected spine
python -I render.py --detect … --images … --scores … --out DIR --label SET            # private overlay renders
python -I geometry.py --detect detect.jsonl --images images.jsonl > geometry.jsonl   # Q-2: top seam per box
python -I render_q2.py --detect … --images … --table … --fill-p P --seam-off S --out DIR --label SET
python -I overlap.py --set S --detect … --outlines … --table … --faces … --images … > metrics.json   # F-R1
python -I resolve.py plan|resolve --set S --detect … --outlines … --table … --decisions … --images … --out DIR  # F-0i
python -I resolve.py own --requests R --out DIR                                         # F-0i `mask=own` crops
python -I strata.py --set S --detect … --outlines … --table … --images … --faces … --pairs … --part DIR  # F-0i strata
python -I render_f0i.py --detect … --outlines … --table … --images … --part DIR --out DIR --label SET
```

- `features.py`: for each 4-point polygon in working-copy pixels (EXIF orientation ignored), the perspective crop
  with its long axis vertical, then short/long side, long-axis angle, Laplacian detail (native, at a 32 px short
  side, and the native-to-half-scale ratio), edge density, grey mean, RMS and 5–95 % contrast, clipped highlight and
  shadow fractions, saturation, hue, value, position in the frame (normalised centre, radial distance, edge
  distance, share outside the frame) and in the machine shelf band (along, across, distance to the band's end).
- `render.py`: JPEGs and an `index.html` for the owner to open locally. Its `--out` must be a private folder under
  the data root; renders hold photos and never enter the repo.
- `geometry.py` (Q-2): the "top seam", the strongest colour step across the spine within 20 % beyond to 30 % inside
  the box's top end, as a signed share of the long side (negative: the box cuts the spine's top; positive: it
  overshoots onto the top face or shelf), plus the top end's height in the frame.
- `render_q2.py` (Q-2): per photo, measured fill (teacher), predicted fill (student, solid at or above FILL_P),
  measured against predicted, and the top-edge overlay. Same privacy rule as `render.py`.

- `overlap.py` (F-R1): how often detected books overlap, by box and by mask, on cached outlines
  ([`evals/FR1`](../../evals/FR1/report.md)).
- `resolve.py` (F-0i, the **instance partition**; runner `src/eval/f0i-cli.ts`, results
  [`evals/F0i`](../../evals/F0i/report.md)): `plan` runs the instance gate on the rasterised outlines (duplicates,
  two-book parents and pieces inside one spine dropped; a wide parent with one child becomes its remainder) and
  plans each remaining conflict group's rotated tile and square windows with joint prompts for
  `helpers/label/partition.py`; `resolve` gives every pixel two or more books claim to one of them (depth override,
  a seam on R3-A's seam evidence: H-2's normals and a Retinex edge map, the SAM logit argmax, fallbacks), then the
  validity rule, refit boxes, lossless exclusive outlines, label maps and per-boundary provenance; `own` writes the
  `mask=own` reader crops (neighbour-owned pixels filled) as one lossless mosaic per photo. Every threshold is a
  constant at the top, pre-registered.
- `strata.py` (F-0i): the reported strata of the report's addendum (cover-kind pairs, low-contrast neighbours with
  the top-face cause apart, merged-mask splits, seam evidence by source, end provenance for F-0m), from the
  partition's private files; it never changes the partition.
- `render_f0i.py` (F-0i): before and after with per-book coloured mask fills and zooms on the largest conflict groups.
  Same privacy rule as `render.py`.

Everything per box, per pair or per photo goes under the data root's `private/`; stdout is aggregates. stderr carries
progress only. `test/f0i.test.ts` runs `resolve.py` on a synthetic photo. Tested by `test/q1.test.ts` and `test/q2.test.ts` on synthetic images (skipped when `.venv` is absent).
