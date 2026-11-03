# helpers/coverage

Python (`uv`, its own `.venv`: numpy and the same pinned OpenCV as `helpers/label`) for card Q-1's capture-quality
pass. The runner is `src/eval/q1-cli.ts`; the method and results are in [`evals/Q1/report.md`](../../evals/Q1/report.md).

```
uv sync
python -I features.py --detect detect.jsonl --images images.jsonl > features.jsonl   # one line per detected spine
python -I render.py --detect … --images … --scores … --out DIR --label SET            # private overlay renders
```

- `features.py`: for each 4-point polygon in working-copy pixels (EXIF orientation ignored), the perspective crop
  with its long axis vertical, then short/long side, long-axis angle, Laplacian detail (native, at a 32 px short
  side, and the native-to-half-scale ratio), edge density, grey mean, RMS and 5–95 % contrast, clipped highlight and
  shadow fractions, saturation, hue, value, position in the frame (normalised centre, radial distance, edge
  distance, share outside the frame) and in the machine shelf band (along, across, distance to the band's end).
- `render.py`: JPEGs and an `index.html` for the owner to open locally. Its `--out` must be a private folder under
  the data root; renders hold photos and never enter the repo.

stderr carries progress only. Tested by `test/q1.test.ts` on a synthetic image (skipped when `.venv` is absent).
