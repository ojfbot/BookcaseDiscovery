# helpers/label

Python (`uv`, its own `.venv`) for card F-0's machine labelling: the spine box producer and two of the three readers
named in [`docs/models/open-weights.md`](../../docs/models/open-weights.md). The runner is `src/eval/f0-cli.ts`; the
method is [`docs/machine-labelling.md`](../../docs/machine-labelling.md).

```
uv sync
uv run python detect.py < images.jsonl > detections.jsonl          # {"id", "image"} per line
uv run python read.py --reader ppocr < requests.jsonl > out.jsonl   # ocr-request lines (contracts/helpers/)
uv run python read.py --reader qwen  < requests.jsonl > out.jsonl
uv run python outline.py < boxes.jsonl > outlines.jsonl            # F-0b: {"id", "image", "polygon"} per line
uv run python imprint.py < requests.jsonl > out.jsonl              # F-0d: read.py's requests; publisher / imprint
```

- `detect.py`: Grounding DINO base (`book spine.`) on overlapping tiles → SAM 2.1 base-plus masks → minimum-area
  rotated rectangles as 4-point polygons in working-copy pixels; machine shelf bands and the gap test.
- `read.py`: crops each polygon like `ocr-vision` does (perspective-corrected, corners clockwise from the one nearest
  the image's top-left, then turned clockwise by each rotation) and reads it with PP-OCRv5 server (det + rec +
  textline classifier, CPU) or Qwen3-VL-4B-Instruct 8-bit (MLX). The polygon and rotations come from the runner's
  crop method (`src/perceive/crop.ts`); an optional `crop` key in the request is echoed back as provenance.
- `outline.py` (card F-0b): re-segments a cached box with SAM 2.1 base-plus from its polygon's axis-aligned box and
  returns the mask's simplified outer contour, which the crop-geometry experiment needs (F-0's cache keeps only the
  minimum-area rectangle).
- `render_f0b.py` (card F-0b): private before/after renders of crops; the runner writes them under the data root's
  `private/f0b/renders/`.
- `imprint.py` (card F-0d): the imprint read, a separate Qwen3-VL-4B variant that cuts crops with `read.py`'s `crop`
  and answers JSON (`title`, `author`, `imprint`, `imprint_from`: `text` or `logo`). `read.py` is unchanged, so F-0's
  cached reads stay valid. `render_f0d.py`: the private review page under `private/f0d/renders/`.

Weights are read from `$BOOKCASE_DATA/models/` and never fetched or committed. stderr carries progress only, never
recognised text. `pyproject.toml` pins OpenCV to one version: paddlex and another dependency both install `cv2`.
This sits apart from `helpers/detect/` (P-2's YOLO detector); see the F-0 deviation in `implementation-notes.md`.
