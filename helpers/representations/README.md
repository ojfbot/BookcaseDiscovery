# helpers/representations

Python (`uv`, its own `.venv`: NumPy and OpenCV contrib, CPU only). Card F-R3's spike: label-free alternate image
representations of a photo (colour spaces, illumination invariants, a classical albedo/shading split, edges, line
segments, band-pass energy, and H-2's depth and normals), each scored on cached data. No model runs, no downloads.
Nothing in the pipeline calls it. Survey and recommendations:
[`docs/models/image-representations.md`](../../docs/models/image-representations.md); pre-registration and results:
[`evals/FR3`](../../evals/FR3/report.md).

```
uv sync
python -I spike.py --images I --detect D --outlines O --table T --stage S --cache C --out PRIV [--no-render] > metrics.json
```

- Inputs are all caches: working copies (`--images`, id and path), the default boxes (`--detect`), Q-2b's SAM 2.1
  outlines (`--outlines`), the kept box ids after the shipped not-a-book filter (`--table`, Q-2b's table), H-2's
  stage rows (`--stage`, for each photo's geometry and faces keys) and H-2's cache (`--cache`). Work is at the point
  map's resolution (2048 px long side).
- F-R3's run used, relative to the data root: `private/f0f/images-pilot-000.jsonl`,
  `f0e/pilot-000/bands+strips/detect.jsonl`, `private/q2b/outlines/pilot-000.jsonl`, `private/q2b/table/pilot-000.jsonl`,
  `private/h2/pilot-000/stage-latest.jsonl`, `private/h2/cache`, and `private/fr3` as `--out`.
- The sample is fixed by rule: the 10 photos with the smallest SHA-256 of `"F-R3/" + photo id` (`sample_ids`).
- Measures (M1–M5) and thresholds are the module constants and the pre-registration in `evals/FR3/report.md`.
- stdout carries aggregates only; `PRIV/per-photo.jsonl` and `PRIV/renders/` (a contact sheet of every edge map per
  sample photo) hold private photo data and stay under the data root's `private/`. stderr names photo ordinals,
  never ids.
- `test/fr3.test.ts` runs the spike on two synthetic shelves (skipped when `.venv` is absent).
