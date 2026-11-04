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

stderr carries progress only. Tested by `test/q1.test.ts` and `test/q2.test.ts` on synthetic images (skipped when `.venv` is absent).
